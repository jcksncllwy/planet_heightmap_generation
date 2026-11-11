// finish-erode.js's erodeLandscape on the GPU (lanes gpu and gpu-wire): what Add detail runs where WebGPU is there (finish.js).
// The network comes from FastFlow's depression routing (Jain, Kerbl, Gain, Finley & Cordonnier, CGF 43(7) 2024), after Cordonnier
// et al. 2019: every cell's way down gives basins; Borůvka's minimum spanning tree over them gives each basin's spill level, in
// O(log L) rounds and no priority queue. The spill levels give the filled surface, and the receivers follow as on the CPU.
// Differences from the paper:
//   · the mesh is irregular, so no donor matrix: a cell's donors are read off its neighbours.
//   · no rake-compress and no pointer-jumped solve. Those need the sums and the solve to be linear; ours have floors, lakes that
//     hold load up to their room, and a max at each lake. But the trees are shallow (450-610 levels at 2.5M on real ground), so
//     cells are sorted by their depth and swept level by level, which runs the CPU's own per-cell arithmetic, nothing reduced.
//   · closedBasins can take its flood from here (gpuClosed): its fill, parent and order, with the water balance left on the CPU.
//   · no carving through lakes: a flat's cells, lakes' included, drain by Barnes et al. 2014's two gradients, by two breadth-first sweeps.
//   · WGSL's lexicographic minimum: two atomicMin passes (the weight, then the edge's id among the cells at that weight). min is
//     commutative, so this holds no matter how threads interleave. Atomics are used only for that, for counters and for a level's
//     order, which nothing reads back: results don't depend on scheduling, so a machine repeats its own result.
// Limits: float32 throughout (the CPU's intermediates are doubles), so a near-tie between two slopes can fall the other way. Laying
// what lakes kept, closed basins and rebound stay on the CPU, with a readback a step.

import { openDevice, readBack } from './gpu-device.js';
import { deltaLayer, rebounder, layUp, closedOutlets, layClosed } from '../finish/finish-erode.js';
import { CLAMP_AFFINE_WGSL } from './fluvial-kernels.js';

const R_EARTH = 6371, EPS = 1e-5, WG = 128, NONE = 0x7FFFFFFF, INF = 0xFFFFFFFF, MAX_LEVELS = 1 << 16, EXPORT_WORDS = 7;
// (a Cell's words: struct Cell below. Tools reading the buffer back index by this)
export const CELL_WORDS = 10;

const HEAD = /* wgsl */`
struct U { n: u32, O: u32, a: f32, dt: f32, G: f32, m: f32, Gf: f32, kh: f32, h: f32, D: f32, Sc: f32 }
struct Rg { start: u32, count: u32 }
struct Cell { A: f32, e: f32, gross: f32, zNew: f32, q: f32, cap: f32, lid: u32, inlet: f32, qf: f32, area: f32 }
struct Out { lid: u32, e: f32, inlet: f32, trap: f32, q: f32, recv: u32, gross: f32 }
const NONE = 0x7FFFFFFFu; const INF = 0xFFFFFFFFu; const M = 0x7FFFFFFFu;
const EPS = ${EPS}f; const R_EARTH = ${R_EARTH}f; const BIG = 1e30f;
${CLAMP_AFFINE_WGSL}
fn enc(w: f32) -> u32 { let b = bitcast<u32>(w); return select(b ^ 0x80000000u, ~b, (b >> 31u) != 0u); }
`;

// Each kernel: the buffers it binds, and its body, run once for each `ix` entry in the dispatched range (c = the cell).
const T = { u: 'array<u32>', f: 'array<f32>', v: 'array<vec4f>', a: 'array<atomic<u32>>', C: 'array<Cell>', X: 'array<Out>' };
// (the solve's first map, with or without the hillslope term: a separate kernel, not a k_h of 0 — any hillslope expression in it
// changes how the compiler rounds the stream power's F, and the run with ERODE hillD 0 must be the one before it, to the bit)
const affineInitOf = HILL => ({ b: { recv: 'u', Zt: 'f', lpA: 'u', Kv: 'v', xyz: 'f', surf: 'f', cells: 'C', fA: 'v+' }, body: `
        let rr = recv[c]; let r = rr & M; let old = Zt[c];
        if (r == NONE) { fA[c] = vec4f(old, old, 0.0, old); return; }      // (an unresolved flat: it holds)
        let toOut = (rr >> 31u) != 0u;
        if (lpA[c] != NONE) {
            if (toOut) { let v = max(old, surf[r]); fA[c] = vec4f(v, v, 0.0, v); } else { fA[c] = vec4f(old, 0.0, 1.0, BIG); }
            return;
        }
        let Ac = max(cells[c].A, 1e-6);
        let d = vec3f(xyz[3u * r] - xyz[3u * c], xyz[3u * r + 1u] - xyz[3u * c + 1u], xyz[3u * r + 2u] - xyz[3u * c + 2u]);
        // (the layer it cuts: its own sediment above the rock's top, or the rock: finish-erode.js. Kv: k, the rock's top, the
        // sediment's k against the rock's, and the share of what it cuts that is mud; packed, so the kernel binds no more buffers.
        // No column: the top is out of reach, and no mud)
        let kv = Kv[c]; let layer = select(1.0, kv.z, old > kv.y + 1e-4);
        // (and the hillslopes and landslides the cell's slope stands for: Tzathas et al. 2024's k_h·A^−h, as FastFlow §5 —
        // a diffusivity D over Hack's flow length L ≈ 1.4·A^0.6 km (Hack 1957), a wave speed D/L: k_h = D/1.4, h = 0.6. ERODE hillD)
        let F = ${HILL ? '(kv.x * layer * pow(Ac, U_.m) + U_.kh * pow(cells[c].area, -U_.h))' : 'kv.x * layer * pow(Ac, U_.m)'} * U_.dt / (R_EARTH * length(d));
        if (toOut) { let v = min(old, (old + F * surf[r]) / (1.0 + F)); fA[c] = vec4f(v, v, 0.0, v); }
        else { fA[c] = vec4f(-BIG, old / (1.0 + F), F / (1.0 + F), old); }` });

const KERNELS = {
    copyZ: { b: { z: 'f', Zt: 'f+' }, body: 'Zt[c] = z[c];' },
    descend: { b: { adjOffset: 'u', adjList: 'u', Zt: 'f', ptrA: 'u+' }, body: `
        var bz = Zt[c]; var best = c;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) { let y = adjList[j]; let zy = Zt[y]; if (zy < bz || (zy == bz && y < best)) { bz = zy; best = y; } }
        ptrA[c] = best;` },
    jump: { b: { ptrA: 'u', ptrB: 'u+' }, body: 'ptrB[c] = ptrA[ptrA[c]];' },
    findRoots: { b: { ptrA: 'u', roots: 'u+', counter: 'a', compA: 'u+' }, body: `if (ptrA[c] == c) { let i = atomicAdd(&counter[0], 1u); roots[i] = c; compA[c] = c; }` },
    label: { b: { ptrA: 'u', compA: 'u', label: 'u+' }, body: 'label[c] = compA[ptrA[c]];' },
    resetBest: { b: { bestW: 'a', bestE: 'a' }, body: 'atomicStore(&bestW[c], INF); atomicStore(&bestE[c], INF);' },
    minWeight: { b: { adjOffset: 'u', adjList: 'u', Zt: 'f', label: 'u', bestW: 'a' }, body: `
        let a = label[c];
        if (a == U_.O) { return; }
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) { let y = adjList[j]; if (label[y] != a) { atomicMin(&bestW[a], enc(max(Zt[c], Zt[y]))); } }` },
    minEdge: { b: { adjOffset: 'u', adjList: 'u', Zt: 'f', label: 'u', bestW: 'u', bestE: 'a' }, body: `
        let a = label[c];
        if (a == U_.O) { return; }
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) {
            let y = adjList[j];
            if (label[y] == a || enc(max(Zt[c], Zt[y])) != bestW[a]) { continue; }
            var id = j;                                    // (an edge's id, the same from both ends: its slot at the lower cell)
            if (y < c) { for (var g = adjOffset[y]; g < adjOffset[y + 1u]; g++) { if (adjList[g] == c) { id = g; break; } } }
            atomicMin(&bestE[a], id);
        }` },
    pickEdge: { b: { adjOffset: 'u', adjList: 'u', Zt: 'f', label: 'u', bestW: 'u', bestE: 'u', hookTo: 'u+', hookW: 'f+' }, body: `
        let a = label[c];
        if (a == U_.O) { return; }
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) {
            let y = adjList[j]; let w = max(Zt[c], Zt[y]);
            if (label[y] == a || enc(w) != bestW[a]) { continue; }
            var id = j;
            if (y < c) { for (var g = adjOffset[y]; g < adjOffset[y + 1u]; g++) { if (adjList[g] == c) { id = g; break; } } }
            if (id == bestE[a]) { hookTo[a] = y; hookW[a] = w; }
        }` },
    hook: { b: { ptrA: 'u', compA: 'u', compB: 'u+', label: 'u', bestE: 'u', hookTo: 'u', hookW: 'f', parent: 'u+', weight: 'f+' }, body: `
        if (compA[c] != c || bestE[c] == INF) { compB[c] = compA[c]; return; }
        let t = label[hookTo[c]];
        if (t != U_.O && bestE[t] == bestE[c] && c < t) { compB[c] = c; return; }     // (the pair's survivor)
        compB[c] = t; parent[c] = ptrA[hookTo[c]]; weight[c] = hookW[c];` },
    flatten: { b: { compA: 'u', compB: 'u+' }, body: 'compB[c] = compA[compA[c]];' },
    active: { b: { compA: 'u', counter: 'a' }, body: 'if (compA[c] != U_.O) { atomicAdd(&counter[0], 1u); }' },
    levelInit: { b: { weight: 'f', parent: 'u', valA: 'f+', ptrB: 'u+' }, body: 'valA[c] = weight[c]; ptrB[c] = parent[c];' },
    levelJump: { b: { valA: 'f', valB: 'f+', ptrB: 'u', ptrC: 'u+' }, body: 'valB[c] = max(valA[c], valA[ptrB[c]]); ptrC[c] = ptrB[ptrB[c]];' },
    fillIn: { b: { Zt: 'f', ptrA: 'u', valA: 'f', fill: 'f+' }, body: 'fill[c] = max(Zt[c], valA[ptrA[c]]);' },
    receive: { b: { adjOffset: 'u', adjList: 'u', fill: 'f', surf: 'f', outlet: 'u', recv: 'u+', distA: 'u+', distB: 'u+' }, body: `
        let fc = fill[c];
        var drop = 0.0; var pick = NONE; var coast = NONE;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) {
            let y = adjList[j]; let isOut = outlet[y] != 0u; let s = fc - select(fill[y], surf[y], isOut);
            if (s > drop) { drop = s; pick = y; }
            if (isOut && coast == NONE) { coast = y; }
        }
        if (pick == NONE) { pick = coast; }
        recv[c] = pick;
        let d = select(0u, INF, pick == NONE);
        distA[c] = d; distB[c] = d;` },
    findFlat: { b: { recv: 'u', flats: 'u+', counter: 'a' }, body: 'if (recv[c] == NONE) { let i = atomicAdd(&counter[0], 1u); flats[i] = c; }' },
    flat: { b: { adjOffset: 'u', adjList: 'u', fill: 'f', outlet: 'u', distA: 'u', distB: 'u+', counter: 'a' }, body: `
        if (distA[c] != INF) { distB[c] = distA[c]; return; }
        let fc = fill[c];
        var best = INF;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) { let y = adjList[j]; if (outlet[y] == 0u && fill[y] == fc && distA[y] < best) { best = distA[y]; } }
        if (best == INF) { distB[c] = INF; atomicAdd(&counter[0], 1u); } else { distB[c] = best + 1u; }` },
    highInit: { b: { adjOffset: 'u', adjList: 'u', fill: 'f', outlet: 'u', hiA: 'u+', hiB: 'u+' }, body: `
        var h = 0u;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) { let y = adjList[j]; if (outlet[y] == 0u && fill[y] > fill[c]) { h = 1u; } }
        hiA[c] = h; hiB[c] = h;` },
    high: { b: { adjOffset: 'u', adjList: 'u', fill: 'f', outlet: 'u', distA: 'u', hiA: 'u', hiB: 'u+', counter: 'a' }, body: `
        if (hiA[c] != 0u) { hiB[c] = hiA[c]; return; }
        let fc = fill[c];
        var best = INF;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) { let y = adjList[j]; if (outlet[y] == 0u && fill[y] == fc && distA[y] != 0u && hiA[y] != 0u && hiA[y] < best) { best = hiA[y]; } }
        if (best == INF) { hiB[c] = 0u; atomicAdd(&counter[0], 1u); } else { hiB[c] = best + 1u; }` },
    pickFlat: { b: { adjOffset: 'u', adjList: 'u', fill: 'f', outlet: 'u', distA: 'u', hiA: 'u', recv: 'u+' }, body: `
        let fc = fill[c];
        var pick = NONE; var best = 0x7FFFFFFF;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) {
            let y = adjList[j];
            if (outlet[y] != 0u || fill[y] != fc || distA[y] == INF) { continue; }
            if (distA[y] == 0u) { pick = y; break; }
            let v = 2 * i32(distA[y]) - i32(hiA[y]);
            if (v < best) { best = v; pick = y; }
        }
        recv[c] = pick;` },
    flagRecv: { b: { recv: 'u+', outlet: 'u', ptrA: 'u+', depthA: 'u+' }, body: `
        let r = recv[c];
        if (r == NONE) { recv[c] = NONE; ptrA[c] = c; depthA[c] = 1u; return; }
        ptrA[c] = r; depthA[c] = 1u;
        if (outlet[r] != 0u) { recv[c] = r | 0x80000000u; }` },
    depthJump: { b: { depthA: 'u', depthB: 'u+', ptrA: 'u', ptrB: 'u+' }, body: 'depthB[c] = depthA[c] + depthA[ptrA[c]]; ptrB[c] = ptrA[ptrA[c]];' },
    histogram: { b: { depthA: 'u', hist: 'a' }, body: 'atomicAdd(&hist[depthA[c]], 1u);' },
    place: { b: { depthA: 'u', cursor: 'a', order: 'u+' }, body: 'order[atomicAdd(&cursor[depthA[c]], 1u)] = c;' },
    water: { b: { adjOffset: 'u', adjList: 'u', recv: 'u', water: 'f', cells: 'C+' }, body: `
        var v = U_.a * water[c]; var ar = U_.a;          // (A: the water's, by the rain; area: the ground's, km²)
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) { let y = adjList[j]; if ((recv[y] & M) == c) { v += cells[y].A; ar += cells[y].area; } }
        cells[c].A = v; cells[c].area = ar;` },
    // ── the stream power, pointer-jumped (fluvial-kernels.js): each cell's update as a clamped affine map of its receiver's
    // new surface — a reach min(old, (old + F·x)/(1 + F)), a lake max(old, x) — composed up the receiver chains in ⌈log₂ depth⌉
    // passes instead of a sweep a level. A cell draining to an outlet is a root: its map at the outlet's surface, a constant.
    // The lake ids ride the same jumps: a lake cell points at its receiver while that is the same lake (same fill), else at itself.
    // prep: the old ground (z, what the last step dropped, the uplift over dt), the chain's pointer and the lake's ──
    prep: { b: { recv: 'u', fill: 'f', z: 'f', dropped: 'f', lift: 'f', Zt: 'f+', lpA: 'u+', jpA: 'u+' }, body: `
        let rr = recv[c]; let r = rr & M; let root = (rr >> 31u) != 0u || r == NONE;
        Zt[c] = z[c] + dropped[c] + lift[c] * U_.dt;
        jpA[c] = select(r, c, root);
        if (fill[c] - z[c] > EPS) {
            var same = false;
            if (!root) { same = fill[r] - z[r] > EPS && fill[r] == fill[c]; }
            lpA[c] = select(c, r, same);
        } else { lpA[c] = NONE; }` },
    affineInit: affineInitOf(false), affineInitHill: affineInitOf(true),
    affineJump: { b: { fA: 'v', jpA: 'u', lpA: 'u', fB: 'v+', jpB: 'u+', lpB: 'u+' }, body: `
        let p = jpA[c]; fB[c] = compose(fA[c], fA[p]); jpB[c] = jpA[p];
        let l = lpA[c];
        if (l == NONE) { lpB[c] = NONE; } else { lpB[c] = lpA[l]; }` },
    affineApply: { b: { fA: 'v', jpA: 'u', lpA: 'u', Zt: 'f', cells: 'C+' }, body: `
        let h = clampAt(fA[c], clampAt(fA[jpA[c]], 0.0)); let old = Zt[c]; let l = lpA[c];
        cells[c].e = h;
        if (l != NONE) { cells[c].zNew = old; cells[c].gross = 0.0; cells[c].lid = l; }
        else { cells[c].zNew = h; cells[c].gross = max(old - h, 0.0); cells[c].lid = NONE; }` },
    // (the load and, of it, the mud, qf: finish-erode.js's Qs and Qf. A lake keeps mud in proportion; a reach drops the bed
    // material by G and the mud by Gf. No column: no mud, and the drop is q·G's, as it was before the split)
    load: { b: { adjOffset: 'u', adjList: 'u', recv: 'u', z: 'f', dropped: 'f+', trap: 'f+', Kv: 'v', cells: 'C+' }, body: `
        let lid = cells[c].lid; let rr = recv[c]; let r = rr & M; let toOut = (rr >> 31u) != 0u;
        let cut = cells[c].gross * U_.a;
        var q = cut; var qf = cut * Kv[c].w; var capIn = 0.0; var inlet = 0.0;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) {
            let y = adjList[j];
            if ((recv[y] & M) != c) { continue; }
            q += cells[y].q; qf += cells[y].qf;
            if (lid != NONE) { if (cells[y].lid == lid) { capIn += cells[y].cap; } else { inlet += cells[y].q; } }
        }
        cells[c].inlet = inlet; cells[c].cap = 0.0; dropped[c] = 0.0; trap[c] = 0.0;
        if (lid != NONE) {
            let room = capIn + max(0.0, cells[c].e - z[c]) * U_.a;
            if (!toOut && cells[r].lid == lid) { cells[c].q = q; cells[c].qf = qf; cells[c].cap = room; return; }
            let hold = min(q, room);
            if (q > 0.0) { qf *= 1.0 - hold / q; }
            trap[c] = hold; q -= hold;
        } else {
            let per = U_.a / max(cells[c].A, U_.a * 1e-3);
            let dm = qf * min(1.0, U_.Gf * per); let d = (q - qf) * min(1.0, U_.G * per) + dm;
            dropped[c] = d / U_.a; q -= d; qf -= dm;
        }
        cells[c].q = q; cells[c].qf = qf;` },
    commit: { b: { cells: 'C', z: 'f+' }, body: 'z[c] = cells[c].zNew;' },
    // ── nonlinear threshold diffusion (Roering et al. 1999: q = −D·S/(1 − (S/S_c)²)), one implicit step: each edge's
    // conductance at the step's slopes (capped at 0.99 S_c), then Jacobi sweeps of (I − dt·L)z′ = z. The outlets hold ──
    edgeCond: { b: { adjOffset: 'u', adjList: 'u', xyz: 'f', z: 'f', gE: 'f+' }, body: `
        let pc = vec3f(xyz[3u * c], xyz[3u * c + 1u], xyz[3u * c + 2u]);
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) {
            let y = adjList[j]; let d = R_EARTH * length(vec3f(xyz[3u * y], xyz[3u * y + 1u], xyz[3u * y + 2u]) - pc);
            let S = min(abs(z[y] - z[c]) / d, 0.99 * U_.Sc); let r = S / U_.Sc;
            gE[j] = U_.dt * (2.0 / (3.0 * d * d)) * U_.D / (1.0 - r * r);
        }` },
    jacobi: { b: { adjOffset: 'u', adjList: 'u', gE: 'f', z: 'f', dA: 'f', dB: 'f+' }, body: `
        var num = z[c]; var den = 1.0;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) { let g = gE[j]; num += g * dA[adjList[j]]; den += g; }
        dB[c] = num / den;` },
    exportCells: { b: { cells: 'C', recv: 'u', trap: 'f', exp: 'X+' }, index: 'i', body: `
        let v = cells[c];
        exp[i] = Out(v.lid, v.e, v.inlet, trap[c], v.q, recv[c], v.gross);` },
};

function wgsl(name, spec) {
    const decl = Object.entries(spec.b).map(([k, t], i) => {
        const rw = t.endsWith('+') || t === 'a', ty = T[t[0]];
        return `@group(0) @binding(${i + 3}) var<storage, ${rw ? 'read_write' : 'read'}> ${k}: ${ty};`;
    }).join('\n');
    return `${HEAD}
@group(0) @binding(0) var<uniform> U_: U;
@group(0) @binding(1) var<uniform> R_: Rg;
@group(0) @binding(2) var<storage, read> ix: array<u32>;
${decl}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= R_.count) { return; }
    let i = R_.start + id.x; let c = ix[i];
    ${spec.body}
}`;
}

// (the pipelines, each with a layout whose range uniform takes a dynamic offset: built once a device, a cold compile being seconds)
const pipelines = new WeakMap();
const pipelinesOf = device => {
    if (!pipelines.has(device)) pipelines.set(device, (async () => {
        const out = {};
        await Promise.all(Object.entries(KERNELS).map(async ([name, spec]) => {
            const entries = [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } }, { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }];
            Object.values(spec.b).forEach((t, i) => entries.push({ binding: i + 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: t.endsWith('+') || t === 'a' ? 'storage' : 'read-only-storage' } }));
            const layout = device.createBindGroupLayout({ entries }), module = device.createShaderModule({ code: wgsl(name, spec) });
            const info = await module.getCompilationInfo?.(), bad = info?.messages?.filter(x => x.type === 'error') ?? [];
            if (bad.length) throw new Error(`${name}: ` + bad.map(x => `${x.lineNum}:${x.linePos} ${x.message}`).join('\n'));
            out[name] = { pipe: await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: 'main' } }), layout, spec };
        }));
        return out;
    })());
    return pipelines.get(device);
};

/** Settings this solver does not have: a run asking for one goes to the CPU's. */
export const gpuCanRun = P => P.flatRule !== false && !P.lastClean && (P.routeEvery ?? 1) === 1 && !P.trace;

/** Build the solver for one run of one mesh. `gpu`: navigator.gpu or Dawn's. */
export async function erodeGPU(gpu, o, P, { onStep = null, device: shared = null, gpuClosed = false } = {}) {
    const { mesh, z, ocean, water, k, slow = null, m, column = null } = o, seaLvl = Math.fround(o.seaKm ?? 0);     // (a float32, as the CPU's: finish-erode.js)
    const { adjOffset, adjList, numCells: n, xyz } = mesh, a = 4 * Math.PI * R_EARTH * R_EARTH / n, dt = P.timeMyr / P.steps;
    const { device } = shared ?? await openDevice(gpu);
    const t00 = performance.now(), align = device.limits.minUniformBufferOffsetAlignment, ms = { setup: 0, flood: 0, upload: 0, closed: 0, route: 0, sort: 0, sweep: 0, readback: 0, lay: 0, encode: 0 };
    const U32 = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const B = {}, mk = (name, bytes) => (B[name] = device.createBuffer({ label: name, size: Math.max(4, bytes), usage: U32 }));
    const put = (name, arr) => device.queue.writeBuffer(B[name], 0, arr.buffer, arr.byteOffset, arr.byteLength);
    const up = (name, arr) => { mk(name, arr.byteLength); put(name, arr); };
    up('adjOffset', Uint32Array.from(adjOffset)); up('adjList', adjList instanceof Uint32Array ? adjList : Uint32Array.from(adjList)); up('xyz', xyz instanceof Float32Array ? xyz : Float32Array.from(xyz)); up('water', water);
    const K = new Float32Array(n);
    for (let c = 0; c < n; c++) K[c] = (P.kScale ?? 1) * k[c] * (slow ? slow[c] : 1);
    // (with the rock column, finish-lithology.js rockColumn: the rock's top, kept on the CPU as the rebound moves it, the
    // sediment's k against the rock's, and the mud's share of what is cut)
    const Kv = new Float32Array(4 * n), packK = () => { for (let c = 0; c < n; c++) { Kv[4 * c] = K[c]; Kv[4 * c + 1] = column ? column.zBed[c] : 1e30; Kv[4 * c + 2] = column ? column.loose[c] : 1; Kv[4 * c + 3] = column ? column.fine[c] : 0; } };
    packK(); up('Kv', Kv);
    // (the history's surface uplift, km/Myr, signed: o.uplift, finish-erode.js; none: zeros)
    up('lift', o.uplift ? Float32Array.from(o.uplift) : new Float32Array(n));
    mk('fA', 16 * n); mk('fB', 16 * n);
    for (const f of ['z', 'dropped', 'Zt', 'hookW', 'weight', 'valA', 'valB', 'fill', 'surf', 'trap']) mk(f, 4 * n);
    for (const u of ['ptrA', 'ptrB', 'ptrC', 'roots', 'label', 'bestW', 'bestE', 'hookTo', 'parent', 'recv', 'distA', 'distB', 'flats', 'depthA', 'depthB', 'order', 'outlet', 'list', 'hiA', 'hiB']) mk(u, 4 * n);
    // (threshold diffusion, ERODE diffD > 0: its edge conductances and the Jacobi pair; an even number of sweeps)
    const DIFF = (P.diffD ?? 0) > 0 ? 2 * Math.ceil((P.diffSweeps ?? 20) / 2) : 0;
    if (DIFF) { mk('gE', 4 * adjList.length); mk('dA', 4 * n); mk('dB', 4 * n); }
    mk('compA', 4 * (n + 1)); mk('compB', 4 * (n + 1)); mk('counter', 16); mk('hist', 4 * MAX_LEVELS); mk('cursor', 4 * MAX_LEVELS); mk('cells', 4 * CELL_WORDS * n); mk('exp', 4 * EXPORT_WORDS * n);
    const rangeBuf = device.createBuffer({ size: align * (MAX_LEVELS + 8), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const uniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const ub = new ArrayBuffer(64), uv = new DataView(ub);
    [n, n].forEach((v, i) => uv.setUint32(4 * i, v, true));
    [a, dt, P.G, m, P.GFine ?? P.G, (P.hillD ?? 0) / 1.4, 0.6, P.diffD ?? 0, P.diffSc ?? 1.25].forEach((v, i) => uv.setFloat32(8 + 4 * i, v, true));
    device.queue.writeBuffer(uniform, 0, ub);
    const stage = device.createBuffer({ size: 4 * MAX_LEVELS, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), count = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const P_ = await pipelinesOf(device);
    /** A bind group: `ix` the index buffer, `swap` renames buffers (ping-pong). */
    const group = (name, ix, swap = {}) => {
        const { layout, spec, pipe } = P_[name], entries = [{ binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: rangeBuf, size: 8 } }, { binding: 2, resource: { buffer: B[ix] } }];
        Object.keys(spec.b).forEach((bn, i) => entries.push({ binding: i + 3, resource: { buffer: B[swap[bn] ?? bn] } }));
        return { pipe, bg: device.createBindGroup({ layout, entries }) };
    };
    const run = (pass, g, slot, cnt) => { pass.setPipeline(g.pipe); pass.setBindGroup(0, g.bg, [slot * align]); pass.dispatchWorkgroups(Math.ceil(cnt / WG)); };
    const rng = new Uint32Array(align / 4 * 8), setRange = (slot, start, cnt) => { rng[0] = start; rng[1] = cnt; device.queue.writeBuffer(rangeBuf, slot * align, rng.buffer, 0, 8); };
    const SL = { list: 0, roots: 1, flats: 2 };
    const G = {
        ...(DIFF ? { edgeCond: group('edgeCond', 'list'), jacAB: group('jacobi', 'list'), jacBA: group('jacobi', 'list', { dA: 'dB', dB: 'dA' }) } : {}),
        copyZ: group('copyZ', 'list'), descend: group('descend', 'list'), jumpAB: group('jump', 'list'), jumpBA: group('jump', 'list', { ptrA: 'ptrB', ptrB: 'ptrA' }), findRoots: group('findRoots', 'list'), label: group('label', 'list'),
        resetBest: group('resetBest', 'roots'), minWeight: group('minWeight', 'list'), minEdge: group('minEdge', 'list'), pickEdge: group('pickEdge', 'list'), hook: group('hook', 'roots'),
        flatAB: group('flatten', 'roots', { compA: 'compB', compB: 'compA' }), flatBA: group('flatten', 'roots'), active: group('active', 'roots'),
        levelInit: group('levelInit', 'roots'), levelAB: group('levelJump', 'roots'), levelBA: group('levelJump', 'roots', { valA: 'valB', valB: 'valA', ptrB: 'ptrC', ptrC: 'ptrB' }),
        fillIn: group('fillIn', 'list'), receive: group('receive', 'list'), findFlat: group('findFlat', 'list'), flatAB2: group('flat', 'flats'), flatBA2: group('flat', 'flats', { distA: 'distB', distB: 'distA' }), highInit: group('highInit', 'flats'), highAB: group('high', 'flats'), highBA: group('high', 'flats', { hiA: 'hiB', hiB: 'hiA' }), pickFlat: group('pickFlat', 'flats'),
        flagRecv: group('flagRecv', 'list'), depthAB: group('depthJump', 'list'), depthBA: group('depthJump', 'list', { depthA: 'depthB', depthB: 'depthA', ptrA: 'ptrB', ptrB: 'ptrA' }), histogram: group('histogram', 'list'), place: group('place', 'list'),
        // (the solve's chains reuse the route's ptrB/ptrC and hiA/hiB: the route is done with them by then)
        prep: group('prep', 'list', { lpA: 'hiA', jpA: 'ptrB' }), affineInit: group((P.hillD ?? 0) > 0 ? 'affineInitHill' : 'affineInit', 'list', { lpA: 'hiA' }),
        jumpAB2: group('affineJump', 'list', { jpA: 'ptrB', jpB: 'ptrC', lpA: 'hiA', lpB: 'hiB' }), jumpBA2: group('affineJump', 'list', { fA: 'fB', fB: 'fA', jpA: 'ptrC', jpB: 'ptrB', lpA: 'hiB', lpB: 'hiA' }),
        applyA: group('affineApply', 'list', { jpA: 'ptrB', lpA: 'hiA' }), applyB: group('affineApply', 'list', { fA: 'fB', jpA: 'ptrC', lpA: 'hiB' }),
        water: group('water', 'order'), load: group('load', 'order'), commit: group('commit', 'list'), exportCells: group('exportCells', 'list'),
    };
    const readCount = async () => {
        const e = device.createCommandEncoder();
        e.copyBufferToBuffer(B.counter, 0, count, 0, 4);
        device.queue.submit([e.finish()]);
        await count.mapAsync(GPUMapMode.READ);
        const v = new Uint32Array(count.getMappedRange().slice(0))[0];
        count.unmap();
        return v;
    };
    const clearCounter = e => e.clearBuffer(B.counter);

    // ── the CPU's share: closed basins, and laying what lakes kept (as finish-erode.js does) ──
    let sink = null, base = null, sinkAt = null, basins = [], list = null, listLen = 0;
    // (closedBasins' flood, from the world ocean alone: the same network with its sinks not yet sinks. Its parent is the receiver here:
    // the lowest neighbour on the filled surface, as a flood's first relaxation is. Sorted on this side so that its order is deterministic)
    const flood = async () => {
        const t = performance.now();
        put('z', z); outlets(true);
        await route();
        const fill = await readBack(device, B.fill), rc = await readBack(device, B.recv, Uint32Array), depth = await readBack(device, B.depthA, Uint32Array);
        const parent = new Int32Array(n).fill(-1), order = new Int32Array(listLen), at = new Uint32Array(levels + 2);
        for (let i = 0; i < listLen; i++) at[depth[list[i]] + 1]++;
        for (let d = 1; d <= levels + 1; d++) at[d] += at[d - 1];
        for (let i = 0; i < listLen; i++) { const c = list[i]; parent[c] = rc[c] & NONE; order[at[depth[c]]++] = c; }
        ms.flood += performance.now() - t;
        return { fill, parent, order, count: listLen };
    };
    const closed = async () => {
        ({ sink, base, sinkAt, basins } = closedOutlets(o.closed(z, gpuClosed ? await flood() : null), z, n, sinkAt));
    };
    const outlets = (seaOnly = false) => {
        const out = new Uint32Array(n), surf = new Float32Array(n), Zs = new Float32Array(n), self = new Uint32Array(n), d0 = new Uint32Array(n), rec = new Uint32Array(n), lab = new Uint32Array(n);
        list = new Uint32Array(n); listLen = 0;
        for (let c = 0; c < n; c++) {
            if (ocean[c] || (!seaOnly && sink[c])) { out[c] = 1; surf[c] = ocean[c] ? seaLvl : base[c]; Zs[c] = ocean[c] ? seaLvl : base[c]; lab[c] = n; } else list[listLen++] = c;
            self[c] = c; rec[c] = c;
        }
        put('outlet', out); put('surf', surf); put('Zt', Zs); put('list', list); put('ptrA', self); put('ptrB', self); put('ptrC', self); put('label', lab); put('recv', rec); put('depthA', d0); put('depthB', d0); put('valA', Zs); put('valB', Zs);
        const comp = new Uint32Array(n + 1);
        for (let c = 0; c <= n; c++) comp[c] = c < n && out[c] ? n : c;
        put('compA', comp); put('compB', comp);
        setRange(SL.list, 0, listLen);
    };
    // ── a network: basins, their spanning tree, the filled surface, the receivers, the depth order ──
    let levels = 0, hist0 = null, guessRounds = 6, guessPasses = 8, guessHigh = 8;
    const route = async () => {
        const t0 = performance.now();
        let e = device.createCommandEncoder(), p = e.beginComputePass();
        run(p, G.copyZ, SL.list, listLen); run(p, G.descend, SL.list, listLen);
        const JUMPS = 14;
        for (let i = 0; i < JUMPS; i++) run(p, i % 2 ? G.jumpBA : G.jumpAB, SL.list, listLen);
        p.end();
        clearCounter(e); p = e.beginComputePass();
        run(p, G.findRoots, SL.list, listLen);
        p.end();
        device.queue.submit([e.finish()]);
        const roots = await readCount();
        setRange(SL.roots, 0, roots);
        // (rounds and flat passes in one submit, as many as last step took: a spare one changes nothing, and every wait for a
        // count costs more than the pass, above all in a browser)
        let rounds = 0, left = roots, was = -1;
        while (left > 0 && left !== was && rounds < 32) {
            was = left;
            const batch = rounds ? 1 : guessRounds;
            e = device.createCommandEncoder(); p = e.beginComputePass();
            for (let b = 0; b < batch; b++) {
                rounds++;
                run(p, G.label, SL.list, listLen); run(p, G.resetBest, SL.roots, roots); run(p, G.minWeight, SL.list, listLen); run(p, G.minEdge, SL.list, listLen); run(p, G.pickEdge, SL.list, listLen); run(p, G.hook, SL.roots, roots);
                for (let i = 0; i < 9; i++) run(p, i % 2 ? G.flatBA : G.flatAB, SL.roots, roots);
            }
            p.end();
            clearCounter(e); p = e.beginComputePass();
            run(p, G.active, SL.roots, roots);
            p.end();
            device.queue.submit([e.finish()]);
            left = await readCount();
        }
        guessRounds = rounds;
        e = device.createCommandEncoder(); p = e.beginComputePass();
        run(p, G.levelInit, SL.roots, roots);
        for (let i = 0; i < 12; i++) run(p, i % 2 ? G.levelBA : G.levelAB, SL.roots, roots);
        run(p, G.fillIn, SL.list, listLen); run(p, G.receive, SL.list, listLen);
        p.end();
        clearCounter(e); p = e.beginComputePass();
        run(p, G.findFlat, SL.list, listLen);
        p.end();
        device.queue.submit([e.finish()]);
        const flats = await readCount();
        setRange(SL.flats, 0, flats);
        // (a flat's two gradients: Barnes, Lehman & Mulla 2014, as finish-erode.js drainFlats: hops from its lower edge, in dist; from its
        // higher edge, in hi; each cell then takes the neighbour lowest on 2·dist − hi. Both end up in their A buffers.)
        const waves = async (first, next, one, two) => {
            let pending = flats, passes = 0, even = true;
            while (pending > 0) {
                const batch = passes ? 8 : first;
                e = device.createCommandEncoder();
                for (let b = 0; b < batch; b++) { if (b === batch - 1) clearCounter(e); p = e.beginComputePass(); run(p, even ? one : two, SL.flats, flats); even = !even; p.end(); }
                device.queue.submit([e.finish()]);
                passes += batch;
                const now = await readCount();
                if (now === pending) { pending = now; break; }
                pending = now;
            }
            if (!even) { e = device.createCommandEncoder(); clearCounter(e); p = e.beginComputePass(); run(p, two, SL.flats, flats); even = true; p.end(); device.queue.submit([e.finish()]); }
            next(passes);
            return pending;
        };
        let passes = 0;
        const pending = await waves(guessPasses, v => { passes = v; guessPasses = Math.max(8, v); }, G.flatAB2, G.flatBA2);
        e = device.createCommandEncoder(); p = e.beginComputePass();
        run(p, G.highInit, SL.flats, flats);
        p.end();
        device.queue.submit([e.finish()]);
        await waves(guessHigh, v => { guessHigh = Math.max(8, v); }, G.highAB, G.highBA);
        e = device.createCommandEncoder(); p = e.beginComputePass();
        run(p, G.pickFlat, SL.flats, flats);
        p.end();
        device.queue.submit([e.finish()]);
        e = device.createCommandEncoder(); p = e.beginComputePass();
        run(p, G.flagRecv, SL.list, listLen);
        const DJ = 12;
        for (let i = 0; i < DJ; i++) run(p, i % 2 ? G.depthBA : G.depthAB, SL.list, listLen);
        p.end();
        e.clearBuffer(B.hist); p = e.beginComputePass();
        run(p, G.histogram, SL.list, listLen);
        p.end();
        e.copyBufferToBuffer(B.hist, 0, stage, 0, 4 * MAX_LEVELS);
        device.queue.submit([e.finish()]);
        await stage.mapAsync(GPUMapMode.READ);
        const hist = new Uint32Array(stage.getMappedRange().slice(0));
        stage.unmap();
        const t1 = performance.now();
        const cursor = new Uint32Array(MAX_LEVELS);
        let at = 0; levels = 0;
        for (let d = 1; d < MAX_LEVELS; d++) { cursor[d] = at; if (hist[d]) { setRange(8 + d, at, hist[d]); levels = d; at += hist[d]; } }
        // (the jumps above reach 2^DJ hops: a deeper tree would come out misordered, without a sign. Real ones: ~600 levels at 2.5M)
        if (levels >= 1 << DJ || at !== listLen) throw new Error(`erosion network: ${levels} levels, ${at} of ${listLen} cells placed`);
        put('cursor', cursor);
        hist0 = hist;
        ms.route += t1 - t0; ms.sort += performance.now() - t1;
        return { roots, rounds, flats, passes, levels, placed: at, unresolved: pending };
    };
    const sweeps = async hist0 => {
        const t0 = performance.now(), e = device.createCommandEncoder();
        let p = e.beginComputePass();
        run(p, G.place, SL.list, listLen);
        for (let d = levels; d >= 1; d--) run(p, G.water, 8 + d, hist0[d]);
        const J = Math.max(1, Math.ceil(Math.log2(levels + 1)));     // (a chain is at most `levels` long: 2^J hops reach its root)
        run(p, G.prep, SL.list, listLen); run(p, G.affineInit, SL.list, listLen);
        for (let i = 0; i < J; i++) run(p, i % 2 ? G.jumpBA2 : G.jumpAB2, SL.list, listLen);
        run(p, J % 2 ? G.applyB : G.applyA, SL.list, listLen);
        for (let d = levels; d >= 1; d--) run(p, G.load, 8 + d, hist0[d]);
        run(p, G.commit, SL.list, listLen);
        if (DIFF) {
            // (the diffusion's guess and its RHS start as the step's ground; an even count of sweeps ends in dA)
            p.end(); e.copyBufferToBuffer(B.z, 0, B.dA, 0, 4 * n); e.copyBufferToBuffer(B.z, 0, B.dB, 0, 4 * n); p = e.beginComputePass();
            run(p, G.edgeCond, SL.list, listLen);
            for (let i = 0; i < DIFF; i++) run(p, i % 2 ? G.jacBA : G.jacAB, SL.list, listLen);
            p.end(); e.copyBufferToBuffer(B.dA, 0, B.z, 0, 4 * n); p = e.beginComputePass();
        }
        run(p, G.exportCells, SL.list, listLen);
        p.end();
        device.queue.submit([e.finish()]);
        ms.encode += performance.now() - t0;
        await device.queue.onSubmittedWorkDone();
        ms.sweep += performance.now() - t0;
    };
    const R = { route: [], toSea: 0, inClosed: 0 };
    const outQ = new Float32Array(n), outR = new Int32Array(n).fill(-1);       // (the last step's load out, km³/Myr, and its receiver: finish-erode.js bayheadFill)
    const lidF = new Int32Array(n), eF = new Float32Array(n), inlet = P.delta ? new Float64Array(n) : null, layDeltas = P.delta ? deltaLayer(mesh, z, inlet) : null;
    const settle = P.rebound > 0 ? rebounder(mesh, z, ocean, P, column, seaLvl, o.uplift ?? null, o.flex ?? null) : null, curve = [];
    let reboundKm3 = 0, overKm3 = 0;
    try {
        put('dropped', new Float32Array(n));
        await device.queue.onSubmittedWorkDone();
        ms.setup = performance.now() - t00;
        for (let s = 0; s < P.steps; s++) {
            let t = performance.now();
            if (settle && s > 0 && s % P.closedEvery === 0) { reboundKm3 += settle(s * dt); if (column) { packK(); put('Kv', Kv); } }
            if (s % P.closedEvery === 0) { await closed(); ms.closed += performance.now() - t; t = performance.now(); outlets(); }
            put('z', z);
            ms.upload += performance.now() - t;
            R.route.push(await route());
            await sweeps(hist0);
            t = performance.now();
            const zGPU = await readBack(device, B.z), ex = await readBack(device, B.exp, Uint32Array, 4 * EXPORT_WORDS * listLen), exF = new Float32Array(ex.buffer);
            ms.readback += performance.now() - t; t = performance.now();
            z.set(zGPU);
            const lakesCells = new Map(), sea0 = R.toSea, closed0 = R.inClosed;
            let eroded = 0, lakeCells = 0;
            lidF.fill(-1);
            if (inlet) inlet.fill(0);
            const last = s === P.steps - 1;
            for (let i = 0; i < listLen; i++) {
                const c = list[i], w = EXPORT_WORDS * i, lid = ex[w], rr = ex[w + 5], q = exF[w + 4];
                eF[c] = exF[w + 1];
                if (last) { outQ[c] = q / dt; outR[c] = rr & NONE; }
                eroded += exF[w + 6] * a;
                if (lid !== NONE) { lidF[c] = lid; lakeCells++; if (inlet) inlet[c] += exF[w + 2]; if (!lakesCells.has(lid)) lakesCells.set(lid, { cells: [], trap: 0 }); const L = lakesCells.get(lid); L.cells.push(c); const tr = exF[w + 3]; if (tr > 0) L.trap = tr; }
                if (rr >>> 31) { const r = rr & NONE; if (sinkAt[r] >= 0) { basins[sinkAt[r]].load += q; R.inClosed += q; if (inlet) inlet[r] += q; } else R.toSea += q; }
            }
            for (const [L, v] of lakesCells) if (v.trap > 0) {
                if (P.delta) layDeltas(v.cells, v.trap / a, c => eF[c], c => lidF[c] === L);
                else layUp(z, v.cells, v.trap / a, Infinity);
            }
            basins.forEach((Bn, b) => {
                if (!(Bn.load > 0)) return;
                overKm3 += layClosed(z, Bn, Bn.load / a, layDeltas) * a;
                Bn.load = 0;
            });
            ms.lay += performance.now() - t;
            // (the census erodeLandscape keeps. What was eroded went to the sea, to a closed basin, or stayed: the three add up)
            let shown = 0, shownKm2 = 0, one = 0;
            for (const v of lakesCells.values()) { const km2 = v.cells.length * a; if (km2 >= P.showKm2) { shown++; shownKm2 += km2; } if (v.cells.length === 1) one++; }
            const sea = R.toSea - sea0, shut = R.inClosed - closed0;
            curve.push({ shown, shownMkm2: +(shownKm2 / 1e6).toFixed(3), one, t: +((s + 1) * dt).toFixed(3), lakeMkm2: +(lakeCells * a / 1e6).toFixed(3), lakes: lakesCells.size, erodedKm3: Math.round(eroded), keptKm3: Math.round(eroded - sea - shut), seaKm3: Math.round(sea), closedKm3: Math.round(shut) });
            if (onStep) await onStep({ s, levels, route: R.route[s], read: async (name, Type = Float32Array) => readBack(device, B[name], Type), z });
        }
        const dr = await readBack(device, B.dropped);
        for (let c = 0; c < n; c++) if (dr[c] > 0) z[c] += dr[c];
    } finally {
        // (a 10M mesh's buffers are a couple of GB: they go now, not when a collector gets to them, the next run being about to want its own)
        for (const b of [...Object.values(B), rangeBuf, uniform, stage, count]) b.destroy();
    }
    if (settle && P.steps > 0) reboundKm3 += settle(P.timeMyr);
    let seaKm3 = 0, closedKm3 = 0, grossKm3 = 0;
    for (const p of curve) { seaKm3 += p.seaKm3; closedKm3 += p.closedKm3; grossKm3 += p.erodedKm3; }
    const perYr = v => +(v / Math.max(1e-9, P.timeMyr) * 1e-6).toFixed(2);
    const budget = { seaKm3PerYr: perYr(seaKm3), closedKm3PerYr: perYr(closedKm3), grossKm3PerYr: perYr(grossKm3), reboundKm3PerYr: perYr(reboundKm3), overRimKm3PerYr: perYr(overKm3) };
    return { curve, survivors: null, budget, ms: Object.fromEntries(Object.entries(ms).map(([key, v]) => [key, Math.round(v)])), route: R.route, toSeaKm3: R.toSea, closedKm3: R.inClosed, outflow: { q: outQ, recv: outR } };
}
