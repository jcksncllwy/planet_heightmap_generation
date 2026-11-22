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

import { openDevice, readBack, gpuWait } from './gpu-device.js';
import { deltaLayer, layUp, closedOutlets, layClosed } from '../finish/finish-erode.js';
import { meshFields, sumPartials } from './fields.js';
import { reboundGPU, zBedBack } from './rebound-gpu.js';
import { CLAMP_AFFINE_WGSL } from './fluvial-kernels.js';

// (the failure term's rate against the waves' K0: a slope failure is instant on a Myr step, so any rate that clears an
// oversteepened deposit within the step is the same; this one costs the solver no more than the waves' own at the cap, 1/(1 − 0.99²) ≈ 50)
const MARINE_FAIL = 0.02;     // (× r²/(1 − r²): 0 on a flat floor, ~0.97 of K0 at the cap)
// (the threshold hillslopes' landslides, ERODE reliefK > 0: Montgomery & Brandon 2002's E = K·Rz/(1 − (Rz/Rc)²) less its linear
// part, Rz the relief in a 10 km window read off the cell's slope to its receiver, Rz = S·D: finish-erode.js. As a rate on the
// cell's own drop, K·D·g(r)·S with g = r²/(1 − r²) at the step's start, r = S/S_c (capped at 0.99), so it joins the stream power's F)
const THR_WGSL = /* wgsl */`
fn thr(zc: f32, zr: f32, d: f32) -> f32 {
    let r = min(max(zc - zr, 0.0) / (d * U_.tS), 0.99);
    return U_.tK * (r * r / (1.0 - r * r)) * U_.dt / d;
}`;
const R_EARTH = 6371, EPS = 1e-5, WG = 128, NONE = 0x7FFFFFFF, INF = 0xFFFFFFFF, MAX_LEVELS = 1 << 16, EXPORT_WORDS = 8;
// (a Cell's words: struct Cell below. Tools reading the buffer back index by this)
export const CELL_WORDS = 10;

const HEAD = /* wgsl */`
struct U { n: u32, O: u32, a: f32, dt: f32, G: f32, m: f32, Gf: f32, kh: f32, h: f32, D: f32, Sc: f32, Kd: f32, wb: f32, sea: f32, mSc: f32, mFail: f32, tK: f32, tS: f32, pad0: f32, pad1: f32 }
struct Rg { start: u32, count: u32 }
struct Cell { A: f32, e: f32, gross: f32, zNew: f32, q: f32, cap: f32, lid: u32, inlet: f32, qf: f32, area: f32 }
struct Out { lid: u32, e: f32, inlet: f32, trap: f32, q: f32, recv: u32, gross: f32, at: u32 }
const NONE = 0x7FFFFFFFu; const INF = 0xFFFFFFFFu; const M = 0x7FFFFFFFu;
const EPS = ${EPS}f; const R_EARTH = ${R_EARTH}f; const BIG = 1e30f;
${CLAMP_AFFINE_WGSL}
fn enc(w: f32) -> u32 { let b = bitcast<u32>(w); return select(b ^ 0x80000000u, ~b, (b >> 31u) != 0u); }
`;

// Each kernel: the buffers it binds, and its body, run once for each `ix` entry in the dispatched range (c = the cell).
const T = { u: 'array<u32>', f: 'array<f32>', v: 'array<vec4f>', a: 'array<atomic<u32>>', C: 'array<Cell>', X: 'array<Out>' };
// (the solve's first map, with or without the hillslope term: a separate kernel, not a k_h of 0 — any hillslope expression in it
// changes how the compiler rounds the stream power's F, and the run with ERODE hillD 0 must be the one before it, to the bit)
const affineInitOf = (HILL, THR = false) => ({ fn: THR ? THR_WGSL : '', b: { recv: 'u', Zt: 'f', lpA: 'u', Kv: 'v', xyz: 'f', surf: 'f', cells: 'C', fA: 'v+', ...(THR ? { slide: 'f+' } : {}) }, body: `
        let rr = recv[c]; let r = rr & M; let old = Zt[c];${THR ? ' slide[c] = 0.0;' : ''}
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
        let kv = Kv[c]; let layer = select(1.0, kv.z, old > kv.y + 1e-4);${THR ? `
        // (the landslides' part of the step's cut, as a share of F: it goes to the receiver whole (load THR), none laid back here)
        let Ft = thr(old, select(Zt[r], surf[r], toOut), R_EARTH * length(d));` : ''}
        // (and the hillslopes and landslides the cell's slope stands for: Tzathas et al. 2024's k_h·A^−h, as FastFlow §5 —
        // a diffusivity D over Hack's flow length L ≈ 1.4·A^0.6 km (Hack 1957), a wave speed D/L: k_h = D/1.4, h = 0.6. ERODE hillD)
        let F = ${HILL ? '(kv.x * layer * pow(Ac, U_.m) + U_.kh * pow(cells[c].area, -U_.h))' : 'kv.x * layer * pow(Ac, U_.m)'} * U_.dt / (R_EARTH * length(d))${THR ? ' + Ft' : ''};
${THR ? '        slide[c] = Ft / max(F, 1e-30);\n' : ''}        if (toOut) { let v = min(old, (old + F * surf[r]) / (1.0 + F)); fA[c] = vec4f(v, v, 0.0, v); }
        else { fA[c] = vec4f(-BIG, old / (1.0 + F), F / (1.0 + F), old); }` });

// (the load from the headwaters down: with THR, the landslides' share of each cell's cut passes its own deposition)
const loadOf = THR => ({ b: { adjOffset: 'u', adjList: 'u', recv: 'u', z: 'f', dropped: 'f+', trap: 'f+', Kv: 'v', cells: 'C+', ...(THR ? { slide: 'f' } : {}) }, body: `
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
            let per = U_.a / max(cells[c].A, U_.a * 1e-3);${THR ? `
            // (the landslides' share of this cell's own cut rides past its deposition, to the receiver: a slide feeds its channel. Laid
            // back where it was cut, as a headwater lays all it carries (G·a/A ≥ 1), it would be cut again next step, net nothing)
            let sl = cut * slide[c]; let slf = sl * Kv[c].w; q -= sl; qf -= slf;` : ''}
            let dm = qf * min(1.0, U_.Gf * per); let d = (q - qf) * min(1.0, U_.G * per) + dm;
            dropped[c] = d / U_.a; q -= d; qf -= dm;${THR ? ' q += sl; qf += slf;' : ''}
        }
        cells[c].q = q; cells[c].qf = qf;` });

const KERNELS = {
    // (a network's start, from its outlets (isOut) and the level each holds (lvl): outlets() fills the rest here, not with a dozen
    // n-sized uploads. Run over every cell (ix: the identity). Two kernels, to keep each under the storage-binding count)
    outletA: { b: { isOut: 'u', lvl: 'f', outlet: 'u+', surf: 'f+', Zt: 'f+', valA: 'f+', valB: 'f+', label: 'u+' }, body: `
        let o = isOut[c]; let v = select(0.0, lvl[c], o != 0u);
        outlet[c] = o; surf[c] = v; Zt[c] = v; valA[c] = v; valB[c] = v; label[c] = select(0u, U_.n, o != 0u);` },
    outletB: { b: { isOut: 'u', ptrA: 'u+', ptrB: 'u+', ptrC: 'u+', recv: 'u+', depthA: 'u+', depthB: 'u+', compA: 'u+', compB: 'u+' }, body: `
        let k = select(c, U_.n, isOut[c] != 0u);
        ptrA[c] = c; ptrB[c] = c; ptrC[c] = c; recv[c] = c; depthA[c] = 0u; depthB[c] = 0u; compA[c] = k; compB[c] = k;` },
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
    // (a root points at itself and adds nothing: an unresolved flat cell, recv NONE, is one. Adding its own depth doubled it every
    // jump, to 4096 levels and the network's throw, whenever a flat stayed unresolved: crustmass S5's flatter land, 2026-11-11)
    depthJump: { b: { depthA: 'u', depthB: 'u+', ptrA: 'u', ptrB: 'u+' }, body: 'let p = ptrA[c]; depthB[c] = depthA[c] + select(depthA[p], 0u, p == c); ptrB[c] = ptrA[p];' },
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
    affineInit: affineInitOf(false), affineInitHill: affineInitOf(true), affineInitThr: affineInitOf(false, true), affineInitHillThr: affineInitOf(true, true),
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
    load: loadOf(false), loadThr: loadOf(true),
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
    // ── the sea floor under the waves (lane marine, ERODE marine): one explicit step of q = −K(d)·∇z between sea cells, the wave's
    // diffusivity K(d) = K0 down to wave base and falling off below it as e^(−(d − wb)/wb), d the water's depth at the edge
    // (Kaufman et al. 1991; finish-erode.js). Each edge's exchange is the same number both ways (its depth and length are
    // symmetric in the pair), so what one cell gives its neighbour takes: the sea's sediment is conserved. A shore is a wall ──
    // One stage of RKL1 super-time-stepping (Meyer, Balsara & Aslam 2012, MNRAS 422): Y_j = μ Y_{j−1} + ν Y_{j−2} + μ̃ dt·L(Y_{j−1}),
    // μ + ν = 1 and L in flux form, so every stage conserves the sea's sediment as the plain explicit step does, and s stages
    // span (s² + s)/2 of its stable steps: ~90 stages, not ~3800, at 2.5M (cur: μ, ν, μ̃ of this stage)
    marine: { b: { adjOffset: 'u', adjList: 'u', xyz: 'f', seaF: 'u', cur: 'f', zb: 'f', mA: 'f', mP: 'f', mB: 'f+' }, body: `
        // (the stages carry each cell's change since the run began, h = z − zb: small numbers, so float32 keeps the sediment's books)
        let zc = zb[c] + mA[c]; let pc = vec3f(xyz[3u * c], xyz[3u * c + 1u], xyz[3u * c + 2u]); var acc = 0.0;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) {
            let y = adjList[j];
            if (seaF[y] == 0u) { continue; }
            if (seaF[c] < 2u && seaF[y] < 2u) { continue; }     // (an edge cold at both ends: seaWork's active set)
            let zy = zb[y] + mA[y]; let d = R_EARTH * length(vec3f(xyz[3u * y], xyz[3u * y + 1u], xyz[3u * y + 2u]) - pc);
            let depth = U_.sea - 0.5 * (zc + zy);
            // (and the sediment's failure: a deposit steeper than the continental slope's gradient slides and flows on down it, at any
            // depth — Roering et al. 1999's threshold form less its linear part, so a gentle floor feels nothing; and only sediment
            // the sea laid fails (the higher cell above where it started the run, zb), never the bedrock of a seamount or a trench wall)
            let r = min(abs(zy - zc) / d, 0.99 * U_.mSc) / U_.mSc;
            let laid = select(zy > zb[y], zc > zb[c], zc > zy);
            let fail = select(0.0, U_.mFail * r * r / (1.0 - r * r), laid);
            acc += (2.0 / (3.0 * d * d)) * U_.Kd * (exp(-max(0.0, depth - U_.wb) / U_.wb) + fail) * (zy - zc);
        }
        mB[c] = cur[0] * mA[c] + cur[1] * mP[c] + cur[2] * acc;` },
    exportCells: { b: { cells: 'C', recv: 'u', trap: 'f', exp: 'X+' }, index: 'i', body: `
        let v = cells[c];
        exp[i] = Out(v.lid, v.e, v.inlet, trap[c], v.q, recv[c], v.gross, i);` },
    // (a step's export but the last's: only what the CPU lays or books — lake cells and cells draining to an outlet — appended
    // (their order is the scheduler's: the CPU sorts them back into the list's by `at`), and every cell's cut for a fixed-tree sum)
    exportSome: { b: { cells: 'C', recv: 'u', trap: 'f', exp: 'X+', counter: 'a', gsum: 'f+' }, body: `
        let v = cells[c]; let rr = recv[c];
        gsum[i] = v.gross;
        if (v.lid == NONE && (rr >> 31u) == 0u) { return; }
        exp[atomicAdd(&counter[0], 1u)] = Out(v.lid, v.e, v.inlet, trap[c], v.q, rr, v.gross, i);` },
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
${spec.fn ?? ''}
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
            const info = module.getCompilationInfo ? await gpuWait(device, module.getCompilationInfo(), `erosion: compiling ${name}`) : null, bad = info?.messages?.filter(x => x.type === 'error') ?? [];
            if (bad.length) throw new Error(`${name}: ` + bad.map(x => `${x.lineNum}:${x.linePos} ${x.message}`).join('\n'));
            out[name] = { pipe: await gpuWait(device, device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: 'main' } }), `erosion: building ${name}`), layout, spec };
        }));
        return out;
    })());
    return pipelines.get(device);
};

// ── Buffers kept from run to run on small meshes (lane histprof) ──
// The history erodes its 40K mesh 107 times to 430 Myr, and each run made its ~50 buffers and ~60 bind groups afresh: ~1 s
// of a history on Chroma, ~0.5 s on Upwell. On a mesh of up to POOL_MAX_CELLS cells (the history's, the ladder's coarse
// rungs) they are kept per device and mesh and handed to the next run CLEARED TO ZERO, in one submit before any upload — as
// a new buffer starts — so a run sees what it always saw. Larger meshes' buffers (a 10M mesh's are a couple of GB) go when
// their run ends, as before. A run that finds the pool in use (two at once on one device) takes fresh buffers.
const POOL_MAX_CELLS = 250000, pools = new WeakMap();
function poolFor(device, mesh) {
    if (mesh.numCells > POOL_MAX_CELLS) return null;
    let byMesh = pools.get(device);
    if (!byMesh) pools.set(device, byMesh = new WeakMap());
    let pool = byMesh.get(mesh);
    if (!pool) byMesh.set(mesh, pool = makePool(device));
    if (pool.busy) return null;
    pool.open();
    return pool;
}
function makePool(device) {
    const kept = new Map(), cached = new Map();
    let pipes = null;
    const pool = {
        busy: false,
        open() {
            pool.busy = true;
            if (!kept.size) return;
            const e = device.createCommandEncoder();
            for (const b of kept.values()) e.clearBuffer(b);
            device.queue.submit([e.finish()]);
        },
        take(desc) {
            const b = kept.get(desc.label);
            if (b && b.size === desc.size && b.usage === desc.usage) return b;
            b?.destroy();
            cached.clear();                                  // (a bind group names its buffers: a new one wants new groups)
            const fresh = device.createBuffer(desc);
            kept.set(desc.label, fresh);
            return fresh;
        },
        groups: (key, P_) => (pipes === P_ ? cached.get(key) : null) ?? null,
        keepGroups(key, P_, G) { if (pipes !== P_) { cached.clear(); pipes = P_; } cached.set(key, G); },
        release() { pool.busy = false; },
    };
    return pool;
}

// (a mesh's shortest edge, km, and its most neighbours: the marine step's stability bound, once a mesh)
const edgeFactsOf = new WeakMap();
function edgeFacts(mesh) {
    let f = edgeFactsOf.get(mesh);
    if (f) return f;
    const { adjOffset, adjList, xyz, numCells: n } = mesh;
    let dMin = Infinity, degMax = 0;
    for (let c = 0; c < n; c++) {
        degMax = Math.max(degMax, adjOffset[c + 1] - adjOffset[c]);
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; dMin = Math.min(dMin, R_EARTH * Math.hypot(xyz[3 * y] - xyz[3 * c], xyz[3 * y + 1] - xyz[3 * c + 1], xyz[3 * y + 2] - xyz[3 * c + 2])); }
    }
    edgeFactsOf.set(mesh, f = { dMin, degMax });
    return f;
}

/** Settings this solver does not have: a run asking for one goes to the CPU's. */
export const gpuCanRun = P => P.flatRule !== false && !P.lastClean && (P.routeEvery ?? 1) === 1 && !P.trace;

/** Build the solver for one run of one mesh. `gpu`: navigator.gpu or Dawn's. */
export async function erodeGPU(gpu, o, P, { onStep = null, device: shared = null, gpuClosed = false } = {}) {
    const { mesh, z, ocean, water, k, slow = null, m, column = null } = o, seaLvl = Math.fround(o.seaKm ?? 0);
    // (the sea's law works at the glacial cycle's time-weighted sea, o.marineSeaKm — the lowstand the main run erodes to; the polish's
    // rivers run to today's coast, but 0.3 Myr of waves at today's level is a highstand forty Holocenes long: it filled the inner shelf
    // to the brim and walled lagoons off behind it. Land and sea are still today's: seaLvl)
    const marSea = Math.fround(o.marineSeaKm ?? seaLvl);     // (a float32, as the CPU's: finish-erode.js)
    // (the waves' own ground, o.marineField (1/0 per cell; none: the whole sea), and the delta's, o.marineLay (none: the field): the
    // history's sea (step/surface-erosion.js, lane marine3) lays a river's load as a delta only on drowned continent — what a river
    // carries to the ocean floor is the mouths' (step/trench-fans.js) — but the waves work the whole sea, so what they carry off a
    // platform's edge goes down the slope. A cell outside the field is a wall to the waves; one outside the lay, to the delta's walk;
    // o.joinOcean false keeps every sea an outlet (the history's enclosed seas are seas, not lakes))
    const field = o.marineField ?? null, lay = o.marineLay ?? field, wet = c => ocean[c] === 1 && (!field || field[c] === 1), layWet = c => wet(c) && (!lay || lay[c] === 1);
    const { adjOffset, adjList, numCells: n, xyz } = mesh, a = 4 * Math.PI * R_EARTH * R_EARTH / n, dt = P.timeMyr / P.steps;
    const { device } = shared ?? await openDevice(gpu);
    const t00 = performance.now(), align = device.limits.minUniformBufferOffsetAlignment, ms = { setup: 0, marine: 0, marLay: 0, marGpu: 0, marWait: 0, marCoast: 0, flood: 0, upload: 0, rebound: 0, release: 0, closed: 0, route: 0, sort: 0, sweep: 0, readback: 0, lay: 0, encode: 0 };
    const U32 = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const pool = poolFor(device, mesh), buffer = desc => pool ? pool.take(desc) : device.createBuffer(desc);
    const B = {}, mk = (name, bytes) => (B[name] = buffer({ label: name, size: Math.max(4, bytes), usage: U32 }));
    const put = (name, arr) => device.queue.writeBuffer(B[name], 0, arr.buffer, arr.byteOffset, arr.byteLength);
    const up = (name, arr) => { mk(name, arr.byteLength); put(name, arr); };
    // (the mesh's adjacency and xyz are resident, kept across runs by fields.js: the store owns them, not this run)
    const MF = meshFields(device, mesh), resident = new Set([MF.adjOffset, MF.adjList, MF.xyz, MF.identity]);
    B.adjOffset = MF.adjOffset; B.adjList = MF.adjList; B.xyz = MF.xyz; B.all = MF.identity;
    up('water', water);
    const K = new Float32Array(n);
    for (let c = 0; c < n; c++) K[c] = (P.kScale ?? 1) * k[c] * (slow ? slow[c] : 1);
    // (with the rock column, finish-lithology.js rockColumn: the rock's top, which the rebound moves on the GPU (rebound-gpu.js:
    // column.zBed is written back after the run), the sediment's k against the rock's, and the mud's share of what is cut)
    const Kv = new Float32Array(4 * n);
    for (let c = 0; c < n; c++) { Kv[4 * c] = K[c]; Kv[4 * c + 1] = column ? column.zBed[c] : 1e30; Kv[4 * c + 2] = column ? column.loose[c] : 1; Kv[4 * c + 3] = column ? column.fine[c] : 0; }
    up('Kv', Kv);
    // (the history's surface uplift, km/Myr, signed: o.uplift, finish-erode.js; none: zeros)
    up('lift', o.uplift ? Float32Array.from(o.uplift) : new Float32Array(n));
    mk('fA', 16 * n); mk('fB', 16 * n);
    for (const f of ['z', 'dropped', 'Zt', 'hookW', 'weight', 'valA', 'valB', 'fill', 'surf', 'trap']) mk(f, 4 * n);
    for (const u of ['ptrA', 'ptrB', 'ptrC', 'roots', 'label', 'bestW', 'bestE', 'hookTo', 'parent', 'recv', 'distA', 'distB', 'flats', 'depthA', 'depthB', 'order', 'outlet', 'list', 'hiA', 'hiB']) mk(u, 4 * n);
    // (threshold diffusion, ERODE diffD > 0: its edge conductances and the Jacobi pair; an even number of sweeps)
    const DIFF = (P.diffD ?? 0) > 0 ? 2 * Math.ceil((P.diffSweeps ?? 20) / 2) : 0;
    if (DIFF) { mk('gE', 4 * adjList.length); mk('dA', 4 * n); mk('dB', 4 * n); }
    if ((P.reliefK ?? 0) > 0) mk('slide', 4 * n);
    // (the sea floor's waves, ERODE marine: the sea's cells as a list and a flag, the ping-pong's other half; the explicit step's
    // length kept under its stability bound on this mesh — every cell's exchanges at the shore's K0 summing to at most a half)
    const MAR = !!P.marine && P.marineK > 0 && P.marineWaveBaseKm > 0;
    let marSub = 0, marEvery = 1, spanOf = null, zb0 = null, spanNow = 0;
    const spans = new Map();
    if (MAR) {
        mk('seaF', 4 * n); mk('seaList', 4 * n); mk('mB', 4 * n); mk('mC', 4 * n); mk('cur', 16); mk('mH', 4 * n); up('zb', zb0 = Float32Array.from(z));
        const { dMin, degMax } = edgeFacts(mesh), most = 0.5 * 3 * dMin * dMin / (2 * degMax * P.marineK * (1 + MARINE_FAIL / (1 - 0.99 * 0.99)));
        // (the waves work every marEvery steps — the closed basins' judge's beat — over the span since: their reach in a step is
        // short of the shelf's width (√(K0·dt) ~40 km at 2.5M), and a span's load waits in seaIn for the delta. RKL's stages grow as the
        // span's square root, so a span of 5 costs ~half the GPU work of 5 single steps and a fifth of the lay, the books and the coast)
        marEvery = Math.max(1, P.marineEvery ?? P.closedEvery ?? 1);
        spanOf = steps => {
            let f = spans.get(steps);
            if (f) return f;
            const span = steps * dt, sub = Math.max(1, Math.ceil((Math.sqrt(1 + 8 * span / most) - 1) / 2)), Kd = P.marineK * span;     // ((s² + s)/2 ≥ span / most)
            // (the waves' reach: below this depth an edge's exchange in a span is under a thousandth of its cells' difference on
            // this mesh's shortest edge, K0·e^(−(d − wb)/wb)·span < 10⁻³·dMin² — the deep floor the waves leave as it is. seaWork works
            // only the cells above it or holding the sea's sediment (they or a neighbour 'hot'), and an edge cold at both ends not at
            // all: what one side of an edge gives the other takes, so the books close as on the whole ocean)
            const deep = P.marineWaveBaseKm * (1 + Math.log(Math.max(1, Kd / (1e-3 * dMin * dMin))));
            const st = new Float32Array(4 * sub), w1 = 2 / (sub * sub + sub);
            for (let j = 1; j <= sub; j++) { const mu = j === 1 ? 1 : (2 * j - 1) / j, nu = j === 1 ? 0 : -(j - 1) / j; st.set([mu, nu, mu * w1, 0], 4 * (j - 1)); }
            spans.set(steps, f = { sub, Kd, deep, st });
            return f;
        };
        marSub = spanOf(marEvery).sub;
        mk('stc', 16 * marSub);
    }
    mk('isOut', 4 * n); mk('lvl', 4 * n);
    mk('compA', 4 * (n + 1)); mk('compB', 4 * (n + 1));
    for (const name of ['compA', 'compB']) device.queue.writeBuffer(B[name], 4 * n, Uint32Array.of(n));      // (the ocean's own component: its slot n)
    mk('counter', 16); mk('hist', 4 * MAX_LEVELS); mk('cursor', 4 * MAX_LEVELS); mk('cells', 4 * CELL_WORDS * n); mk('exp', 4 * EXPORT_WORDS * n); mk('gsum', 4 * n);
    const rangeBuf = buffer({ label: 'ranges', size: align * (MAX_LEVELS + 8), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const uniform = buffer({ label: 'uniform', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const ub = new ArrayBuffer(80), uv = new DataView(ub), THR = (P.reliefK ?? 0) > 0;
    [n, n].forEach((v, i) => uv.setUint32(4 * i, v, true));
    [a, dt, P.G, m, P.GFine ?? P.G, (P.hillD ?? 0) / 1.4, 0.6, P.diffD ?? 0, P.diffSc ?? 1.25, 0, P.marineWaveBaseKm ?? 1, marSea, P.marineFailSlope ?? 0.05, MARINE_FAIL,
        THR ? P.reliefK * P.reliefWindowKm : 0, THR ? P.reliefKm / P.reliefWindowKm : 1].forEach((v, i) => uv.setFloat32(8 + 4 * i, v, true));
    device.queue.writeBuffer(uniform, 0, ub);
    const stage = buffer({ label: 'stage', size: 4 * MAX_LEVELS, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), count = buffer({ label: 'count', size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const P_ = await pipelinesOf(device);
    /** A bind group: `ix` the index buffer, `swap` renames buffers (ping-pong). */
    const group = (name, ix, swap = {}) => {
        const { layout, spec, pipe } = P_[name], entries = [{ binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: rangeBuf, size: 8 } }, { binding: 2, resource: { buffer: B[ix] } }];
        Object.keys(spec.b).forEach((bn, i) => entries.push({ binding: i + 3, resource: { buffer: B[swap[bn] ?? bn] } }));
        return { pipe, bg: device.createBindGroup({ layout, entries }) };
    };
    // (an empty range — no flats, no roots at a level — is skipped: a dispatch of 0 workgroups does nothing, and Dawn warns of each)
    const run = (pass, g, slot, cnt) => { if (!(cnt > 0)) return; pass.setPipeline(g.pipe); pass.setBindGroup(0, g.bg, [slot * align]); pass.dispatchWorkgroups(Math.ceil(cnt / WG)); };
    const rng = new Uint32Array(align / 4 * 8), setRange = (slot, start, cnt) => { rng[0] = start; rng[1] = cnt; device.queue.writeBuffer(rangeBuf, slot * align, rng.buffer, 0, 8); };
    const SL = { list: 0, roots: 1, flats: 2, all: 3, sea: 4 };
    const groupsKey = `${DIFF}|${(P.hillD ?? 0) > 0}|${MAR}|${THR}`, G = pool?.groups(groupsKey, P_) ?? {
        // (RKL's three rotating fields, z = X0, mB = X1, mC = X2: the first stage X0 → X1, then (A, P → out) by j mod 3)
        ...(MAR ? { mar1: group('marine', 'seaList', { mA: 'mH', mP: 'mH', mB: 'mB' }), mar2: group('marine', 'seaList', { mA: 'mB', mP: 'mH', mB: 'mC' }),
            mar0: group('marine', 'seaList', { mA: 'mC', mP: 'mB', mB: 'mH' }), mar4: group('marine', 'seaList', { mA: 'mH', mP: 'mC', mB: 'mB' }) } : {}),
        ...(DIFF ? { edgeCond: group('edgeCond', 'list'), jacAB: group('jacobi', 'list'), jacBA: group('jacobi', 'list', { dA: 'dB', dB: 'dA' }) } : {}),
        outletA: group('outletA', 'all'), outletB: group('outletB', 'all'),
        copyZ: group('copyZ', 'list'), descend: group('descend', 'list'), jumpAB: group('jump', 'list'), jumpBA: group('jump', 'list', { ptrA: 'ptrB', ptrB: 'ptrA' }), findRoots: group('findRoots', 'list'), label: group('label', 'list'),
        resetBest: group('resetBest', 'roots'), minWeight: group('minWeight', 'list'), minEdge: group('minEdge', 'list'), pickEdge: group('pickEdge', 'list'), hook: group('hook', 'roots'),
        flatAB: group('flatten', 'roots', { compA: 'compB', compB: 'compA' }), flatBA: group('flatten', 'roots'), active: group('active', 'roots'),
        levelInit: group('levelInit', 'roots'), levelAB: group('levelJump', 'roots'), levelBA: group('levelJump', 'roots', { valA: 'valB', valB: 'valA', ptrB: 'ptrC', ptrC: 'ptrB' }),
        fillIn: group('fillIn', 'list'), receive: group('receive', 'list'), findFlat: group('findFlat', 'list'), flatAB2: group('flat', 'flats'), flatBA2: group('flat', 'flats', { distA: 'distB', distB: 'distA' }), highInit: group('highInit', 'flats'), highAB: group('high', 'flats'), highBA: group('high', 'flats', { hiA: 'hiB', hiB: 'hiA' }), pickFlat: group('pickFlat', 'flats'),
        flagRecv: group('flagRecv', 'list'), depthAB: group('depthJump', 'list'), depthBA: group('depthJump', 'list', { depthA: 'depthB', depthB: 'depthA', ptrA: 'ptrB', ptrB: 'ptrA' }), histogram: group('histogram', 'list'), place: group('place', 'list'),
        // (the solve's chains reuse the route's ptrB/ptrC and hiA/hiB: the route is done with them by then)
        prep: group('prep', 'list', { lpA: 'hiA', jpA: 'ptrB' }), affineInit: group(`affineInit${(P.hillD ?? 0) > 0 ? 'Hill' : ''}${THR ? 'Thr' : ''}`, 'list', { lpA: 'hiA' }),
        jumpAB2: group('affineJump', 'list', { jpA: 'ptrB', jpB: 'ptrC', lpA: 'hiA', lpB: 'hiB' }), jumpBA2: group('affineJump', 'list', { fA: 'fB', fB: 'fA', jpA: 'ptrC', jpB: 'ptrB', lpA: 'hiB', lpB: 'hiA' }),
        applyA: group('affineApply', 'list', { jpA: 'ptrB', lpA: 'hiA' }), applyB: group('affineApply', 'list', { fA: 'fB', jpA: 'ptrC', lpA: 'hiB' }),
        water: group('water', 'order'), load: group(THR ? 'loadThr' : 'load', 'order'), commit: group('commit', 'list'), exportCells: group('exportCells', 'list'), exportSome: group('exportSome', 'list'),
    };
    pool?.keepGroups(groupsKey, P_, G);
    const readCount = async () => {
        const e = device.createCommandEncoder();
        e.copyBufferToBuffer(B.counter, 0, count, 0, 4);
        device.queue.submit([e.finish()]);
        await gpuWait(device, count.mapAsync(GPUMapMode.READ), 'erosion: reading a count');
        const v = new Uint32Array(count.getMappedRange().slice(0))[0];
        count.unmap();
        return v;
    };
    const clearCounter = e => e.clearBuffer(B.counter);

    // ── the CPU's share: closed basins, and laying what lakes kept (as finish-erode.js does) ──
    let sink = null, base = null, sinkAt = null, basins = [], listLen = 0;
    const list = new Uint32Array(n), outF = new Uint32Array(n), outL = new Float32Array(n);
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
    // (each target cell's spill level from the cells of `open`, each at its own ground: the minimax path, from this network's
    // basins and their spanning tree — finish.js seaDrying's sills, as its CPU flood finds them, the same max of the same heights.
    // A target no open cell reaches: Infinity, as there. The counts of what the network left undone are the run's, not this)
    const sills = async (open, targets) => {
        let any = false;
        for (let c = 0; c < n && !any; c++) any = open[c] === 1;
        if (!any) return Float32Array.from(targets, () => Infinity);
        const kept = { ...undone }, msRoute = ms.route, msSort = ms.sort;
        put('z', z); outlets(false, open, c => z[c]);
        const r = await route(), fill = await readBack(device, B.fill);
        Object.assign(undone, kept); ms.route = msRoute; ms.sort = msSort;
        return Float32Array.from(targets, c => (r.unjoined ? reaches(open, c, fill) : fill[c]));
    };
    // (whether an open cell reaches c at all: only asked when the network left a basin unjoined, i.e. never on a connected sphere)
    const reaches = (open, c0, fill) => {
        const seen = new Uint8Array(n), q = [c0];
        seen[c0] = 1;
        for (let i = 0; i < q.length; i++) for (let j = adjOffset[q[i]]; j < adjOffset[q[i] + 1]; j++) { const y = adjList[j]; if (open[y]) return fill[c0]; if (!seen[y]) { seen[y] = 1; q.push(y); } }
        return Infinity;
    };
    const closed = async tMyr => {
        // (a cut-off sea gone dry leaves the ocean first: finish-erode.js erodeLandscape; outlets() reads it after. Its sills come
        // from this network's flood: `sills`)
        if (o.release) { const t = performance.now(); await o.release(tMyr, z, sills); ms.release += performance.now() - t; }
        ({ sink, base, sinkAt, basins } = closedOutlets(o.closed(z, gpuClosed ? await flood() : null), z, n, sinkAt));
        // (the rebound's copy of the ocean: the release, and the judge itself (a breached sea joined: finish.js reflooded), change it in place)
        settle?.setOcean(ocean);
    };
    // (the cells that end the network, at the level each holds: the world ocean at the sea's surface and, but for a flood from the
    // sea alone, closed basins' outlets at their base. `at(c)`: another set's levels (sills: the open sea at its own ground))
    const outlets = (seaOnly = false, isOut = null, at = null) => {
        listLen = 0;
        for (let c = 0; c < n; c++) {
            if (isOut ? isOut[c] : ocean[c] || (!seaOnly && sink[c])) { outF[c] = 1; outL[c] = at ? at(c) : ocean[c] ? seaLvl : base[c]; } else { outF[c] = 0; outL[c] = 0; list[listLen++] = c; }
        }
        put('isOut', outF); put('lvl', outL); device.queue.writeBuffer(B.list, 0, list.buffer, 0, 4 * listLen);
        if (MAR) seaUp();
        setRange(SL.list, 0, listLen); setRange(SL.all, 0, n);
        const e = device.createCommandEncoder(), p = e.beginComputePass();
        run(p, G.outletA, SL.all, n); run(p, G.outletB, SL.all, n);
        p.end();
        device.queue.submit([e.finish()]);
    };
    // (the world ocean's cells, for the waves: as it stands — a release or a breach changes it in place)
    let seaLen = 0;
    const seaF = MAR ? new Uint32Array(n) : null, seaList = MAR ? new Uint32Array(n) : null;
    const seaUp = () => {
        seaLen = 0;
        for (let c = 0; c < n; c++) { const s = wet(c); seaF[c] = s ? 1 : 0; if (s) seaList[seaLen++] = c; }
        put('seaF', seaF); device.queue.writeBuffer(B.seaList, 0, seaList.buffer, 0, 4 * Math.max(1, seaLen)); setRange(SL.sea, 0, seaLen);
    };
    // (the coast moves with the sea's floor: a sea cell its fill has built above the sea's level is land — the rivers carry their
    // load on across it, as a delta builds out — and land the shelf's load has sunk below the sea's level, where the sea touches
    // it, is sea — a flood from the ocean through it. Not a closed basin's floor: its water is its own. Marine work only)
    // (a delta filled to the water is at the sea's level to within the stages' float32 rounding of h on a deep zb: ~1e-7 km)
    const AT_SEA = 1e-6;
    // (only the sea the world ocean joins, once as the run starts: a pocket of sea behind ground above it — a cell or a few the
    // coarser level's sea left on this one's finer ground, a lagoon — is a closed hollow the basins' judge takes as a lake. Left
    // an outlet at the sea's level, it filled in a step and stood its rivers' load in towers (marine2, 2026-11-21: a quarter of the
    // 640K level's sea load). The world ocean: the biggest body, as world-ocean.js takes it)
    const joinOcean = () => {
        const comp = new Int32Array(n).fill(-1), cq = new Int32Array(n);
        let best = -1, bestLen = 0, nc = 0, dropped = 0;
        for (let s = 0; s < n; s++) {
            if (!ocean[s] || comp[s] >= 0) continue;
            let len = 1; cq[0] = s; comp[s] = nc;
            for (let i = 0; i < len; i++) for (let j = adjOffset[cq[i]]; j < adjOffset[cq[i] + 1]; j++) { const y = adjList[j]; if (ocean[y] && comp[y] < 0) { comp[y] = nc; cq[len++] = y; } }
            if (len > bestLen) { best = nc; bestLen = len; }
            nc++;
        }
        if (nc > 1) for (let c = 0; c < n; c++) if (ocean[c] && comp[c] !== best) { ocean[c] = 0; dropped++; }
        R.pocketCells += dropped;
    };
    // (the sea's delta, all mouths at once: one walk outward from every mouth together, ring by ring, each cell filled to the sea's
    // level from the load of the mouth that reached it first — so each still lays nearest itself, as deltaLayer's walk does per
    // mouth, but a shelf many rivers share is crossed once a step, not once a river (the per-mouth walk: ~0.5 s a step at 640K).
    // Two fronts that meet are one delta from then on, their loads pooled (a
    // union of the mouths); ground a spent front holds is anyone's to cross. What a mouth's walk could not place, spillAt[mouth])
    const own = MAR ? new Int32Array(n).fill(-1) : null, wq = MAR ? new Int32Array(4 * n) : null;
    const seaDelta = (mouths, load, surface, inside, spillAt) => {
        const m = mouths.length, left = Float64Array.from(load), up = new Int32Array(m);
        for (let k = 0; k < m; k++) up[k] = k;
        const find = k => { while (up[k] !== k) { up[k] = up[up[k]]; k = up[k]; } return k; };
        let head = 0, tail = 0, spilt = 0;
        const touched = [];
        for (let k = 0; k < m; k++) { const c = mouths[k]; own[c] = k; touched.push(c); wq[tail++] = c; }
        while (head < tail) {
            const c = wq[head++], g = find(own[c]);
            if (!(left[g] > 0)) continue;
            const room = surface(c) - z[c];
            if (room > 0) { const put = room < left[g] ? room : left[g]; z[c] += put; left[g] -= put; }
            if (!(left[g] > 0)) continue;
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
                const y = adjList[j];
                if (!inside(y)) continue;
                if (own[y] < 0) { own[y] = g; touched.push(y); if (tail < wq.length) wq[tail++] = y; continue; }
                const h = find(own[y]);
                if (h === g) continue;
                if (left[h] > 0) { left[g] += left[h]; left[h] = 0; up[h] = g; }      // (two fronts met: one delta now, one load)
                else { own[y] = g; if (tail < wq.length) wq[tail++] = y; }               // (a spent front's ground: anyone's to cross)
            }
        }
        for (const c of touched) own[c] = -1;
        for (let k = 0; k < m; k++) if (up[k] === k && left[k] > 0) { spilt += left[k]; if (spillAt) spillAt[mouths[k]] += left[k]; }
        return spilt;
    };
    let coastMoved = false;
    const moveCoast = () => {
        let moved = 0;
        for (let c = 0; c < n; c++) if (ocean[c] && z[c] >= seaLvl - AT_SEA) { ocean[c] = 0; moved++; }
        const q = [];
        for (let c = 0; c < n; c++) if (ocean[c]) q.push(c);
        for (let i = 0; i < q.length; i++) for (let j = adjOffset[q[i]]; j < adjOffset[q[i] + 1]; j++) {
            const y = adjList[j];
            if (!ocean[y] && z[y] < seaLvl && !(sink && sink[y])) { ocean[y] = 1; q.push(y); moved++; }
        }
        if (moved) { coastMoved = true; R.coastMoved += moved; settle?.setOcean(ocean); }
    };
    // (the step's sea load, laid where each river meets the sea (seaIn, km³), then worked by the waves on the GPU: marSub stages of
    // the marine kernel. What the sea holds before and after is summed: the drift is the solver's rounding, booked, not hidden.
    // The load is laid as a delta: each mouth's fills the sea nearest it up to the sea's level (seaDelta), the front building out
    // over the shelf, never above the water — a step's whole load in its one receiving cell stood hundreds of metres over the sea
    // before the waves could spread it, an island the rivers then cut (marine2, 2026-11-21: 3.8 km with no moving coast, dry land
    // below the sea ×7 with it). Above the water a delta's top is the river's, not the sea's. The walk crosses the delta's own
    // plain, filled to the sea's level, as the river does to the open sea; never a closed basin's ground)
    const seaIn = MAR ? new Float64Array(n) : null, spillIn = MAR ? new Float64Array(n) : null, actList = MAR ? new Uint32Array(n) : null;
    const seaWork = async steps => {
        const t = performance.now(), F = spanOf(steps);
        if (steps !== spanNow) { device.queue.writeBuffer(B.stc, 0, F.st); device.queue.writeBuffer(uniform, 8 + 4 * 9, Float32Array.of(F.Kd)); spanNow = steps; }
        let laid = 0;
        const mouths = [], load = [];
        for (let i = 0; i < seaLen; i++) { const c = seaList[i]; if (seaIn[c] > 0) { laid += seaIn[c]; mouths.push(c); load.push(seaIn[c] / a); } }
        let left = laid > 0 ? seaDelta(mouths, load, () => marSea, c => layWet(c) || (Math.abs(z[c] - seaLvl) <= AT_SEA && !(sink && sink[c]) && !(lay && !lay[c])), spillIn) : 0;
        // (a pocket of sea full to its level behind ground above it — a lagoon its delta closed — holds no more: its river goes on to
        // the open sea, so what it could not hold goes to the nearest sea with room, over any ground but a closed basin's. In rounds:
        // a front that ran into one still laying merged with it, and ground a spent one held is free the next round)
        for (let round = 0; left > 0 && round < 8; round++) {
            const from = [], more = [];
            for (let i = 0; i < seaLen; i++) { const c = seaList[i]; if (spillIn[c] > 0) { from.push(c); more.push(spillIn[c]); spillIn[c] = 0; } }
            const was = left;
            left = seaDelta(from, more, c => layWet(c) ? marSea : -Infinity, c => !(sink && sink[c]) && !(lay && !lay[c]), spillIn);
            if (left > 0.98 * was) break;
        }
        spillIn.fill(0);
        // (what no walk placed — all the sea within reach full to its level: booked as passed on, not laid, as all the sea's load
        // was before its law)
        if (left > 0) { R.marineSpiltKm3 += left * a; laid -= left * a; }
        seaIn.fill(0);
        const tL = performance.now(); ms.marLay += tL - t;
        const h = new Float32Array(n);
        for (let c = 0; c < n; c++) h[c] = z[c] - zb0[c];
        put('mH', h);
        // (the active set: hot cells — above the waves' reach, or holding sediment the sea laid (h > 0, the failure's own test) — and
        // their sea neighbours; seaF 2 hot, 1 cold sea)
        for (let i = 0; i < seaLen; i++) { const c = seaList[i]; seaF[c] = marSea - z[c] < F.deep || h[c] > 0 ? 2 : 1; }
        let actLen = 0;
        for (let i = 0; i < seaLen; i++) {
            const c = seaList[i];
            let on = seaF[c] === 2;
            for (let j = adjOffset[c]; !on && j < adjOffset[c + 1]; j++) on = seaF[adjList[j]] === 2;
            if (on) actList[actLen++] = c;
        }
        put('seaF', seaF); device.queue.writeBuffer(B.seaList, 0, actList.buffer, 0, 4 * Math.max(1, actLen)); setRange(SL.sea, 0, actLen);
        R.marineActive += actLen / Math.max(1, seaLen);
        const e = device.createCommandEncoder();
        e.copyBufferToBuffer(B.mH, 0, B.mB, 0, 4 * n); e.copyBufferToBuffer(B.mH, 0, B.mC, 0, 4 * n);
        for (let j = 1; j <= F.sub; j++) {
            e.copyBufferToBuffer(B.stc, 16 * (j - 1), B.cur, 0, 16);
            const p = e.beginComputePass();
            run(p, j === 1 ? G.mar1 : j % 3 === 2 ? G.mar2 : j % 3 === 0 ? G.mar0 : G.mar4, SL.sea, actLen);
            p.end();
        }
        device.queue.submit([e.finish()]);
        const tW = performance.now();
        const hN = await readBack(device, F.sub % 3 === 0 ? B.mH : F.sub % 3 === 1 ? B.mB : B.mC);
        ms.marWait += performance.now() - tW;
        let after = 0;
        for (let c = 0; c < n; c++) if (wet(c)) { after += hN[c] - h[c]; z[c] = zb0[c] + hN[c]; }
        R.marineKm3 += laid; R.marineDriftKm3 += after * a; R.marineSteps++;
        const tC = performance.now(); ms.marGpu += tC - tL;
        moveCoast();
        ms.marCoast += performance.now() - tC;
        ms.marine += performance.now() - t;
    };
    // ── a network: basins, their spanning tree, the filled surface, the receivers, the depth order ──
    let levels = 0, hist0 = null, guessRounds = 6, guessPasses = 8, guessHigh = 8;
    // (what every network left undone, summed over the run: basins that never joined theirs downhill, flat cells left with no
    // receiver. Both should be 0: check-floods holds them there)
    const undone = { unjoined: 0, unresolved: 0 };
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
            const batch = rounds ? 1 : Math.max(1, guessRounds);
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
        // (a network with no inland minima, roots 0, takes no rounds: it must not teach the next one to take none. It did, and every
        // later network on that device skipped the hooking: its basins never joined, their fill was their own pit's, and the flats
        // on them stayed unresolved, recv NONE (crustmass S5's 777@300, 2026-11-11, hollowfix6))
        if (rounds) guessRounds = rounds;
        e = device.createCommandEncoder(); p = e.beginComputePass();
        run(p, G.levelInit, SL.roots, roots);
        // (a basin's spill chain is at most `roots` long, so ⌈log₂ roots⌉ jumps reach its end: the level is exact by construction,
        // with no count to wait for. Real chains are short (≤ 141 at 2.5M, 831576@430), so the fixed 12 (even) almost always rule)
        const LJ = Math.max(12, 2 * Math.ceil(Math.log2(roots + 1) / 2));
        for (let i = 0; i < LJ; i++) run(p, i % 2 ? G.levelBA : G.levelAB, SL.roots, roots);
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
        await gpuWait(device, stage.mapAsync(GPUMapMode.READ), 'erosion: reading the levels\' histogram');
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
        undone.unjoined += left; undone.unresolved += pending;
        return { roots, rounds, flats, passes, levels, placed: at, unjoined: left, unresolved: pending };
    };
    const sweeps = async (hist0, all) => {
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
        if (all) run(p, G.exportCells, SL.list, listLen);
        else { p.end(); e.clearBuffer(B.counter); e.clearBuffer(B.gsum); p = e.beginComputePass(); run(p, G.exportSome, SL.list, listLen); }
        p.end();
        if (!all) gsum.encode(e);
        device.queue.submit([e.finish()]);
        ms.encode += performance.now() - t0;
        await gpuWait(device, device.queue.onSubmittedWorkDone(), 'erosion: the sweeps');
        ms.sweep += performance.now() - t0;
    };
    const R = { route: [], toSea: 0, inClosed: 0, marineKm3: 0, marineDriftKm3: 0, coastMoved: 0, marineSpiltKm3: 0, pocketCells: 0, marineActive: 0, marineSteps: 0 }, recAt = new Uint32Array(n), gsum = await sumPartials(device, B.gsum, n);
    const outQ = new Float32Array(n), outR = new Int32Array(n).fill(-1);       // (the last step's load out, km³/Myr, and its receiver: finish-erode.js bayheadFill)
    const lidF = new Int32Array(n), eF = new Float32Array(n), inlet = P.delta ? new Float64Array(n) : null, layDeltas = P.delta ? deltaLayer(mesh, z, inlet) : null;
    const curve = [];
    let reboundKm3 = 0, overKm3 = 0, settle = null;
    if (MAR && o.joinOcean !== false) joinOcean();
    try {
        put('dropped', new Float32Array(n));
        // (the rebound settles the ground where it lies, on the GPU (rebound-gpu.js); its anchor is the ground as the run begins)
        if (P.rebound > 0) { put('z', z); settle = await reboundGPU(device, { mesh, z: B.z, lift: B.lift, Kv: column ? B.Kv : null, ocean, flex: o.flex ?? null, P }); }
        // (the GPU settles the ground and hands it back for the CPU's closed-basin judge: z on both sides agree, no upload needed)
        // (the plate loads what the ground holds: the ground and what the last step dropped on it, which the next step's solve takes up
        // (Zt). Settled on the bare ground, a headwater's deposit — all it cut, laid back (G·a/A ≥ 1), F·its drop high: kilometres on a
        // peak — read as taken off at every settling and put back at the end, and a near-local plate lifted the peak and then sank it
        // into pits beside it (lane erosionfix, 2026-11-22). `pending` false: the deposit is already on z, the run's last settling)
        const settleNow = async (at, pending = true) => {
            const dr = pending ? await readBack(device, B.dropped) : null;
            if (dr) for (let c = 0; c < n; c++) z[c] += dr[c];
            put('z', z); reboundKm3 += await settle.settle(at); z.set(await readBack(device, B.z));
            if (dr) for (let c = 0; c < n; c++) z[c] -= dr[c];
        };
        await gpuWait(device, device.queue.onSubmittedWorkDone(), 'erosion: setting up');
        ms.setup = performance.now() - t00;
        let marDone = 0;
        for (let s = 0; s < P.steps; s++) {
            let t = performance.now();
            let zUp = false;
            if (settle && s > 0 && s % P.closedEvery === 0) { await settleNow(s * dt); zUp = true; ms.rebound += performance.now() - t; t = performance.now(); }
            if (s % P.closedEvery === 0) { await closed(s * dt); ms.closed += performance.now() - t; t = performance.now(); outlets(); }
            else if (coastMoved) outlets();
            coastMoved = false;
            if (!zUp) put('z', z);
            ms.upload += performance.now() - t;
            R.route.push(await route());
            const last = s === P.steps - 1;
            await sweeps(hist0, last);
            t = performance.now();
            // (the last step reads every cell back (the load out: outflow); the others only what exportSome kept, sorted back into
            // the list's order so that every sum below runs in the order it always did)
            const kept = last ? listLen : await readCount(), zGPU = await readBack(device, B.z), ex = await readBack(device, B.exp, Uint32Array, Math.max(4, 4 * EXPORT_WORDS * kept)), exF = new Float32Array(ex.buffer);
            const at = new Uint32Array(kept);
            for (let r = 0; r < kept; r++) { const i = ex[EXPORT_WORDS * r + 7]; at[r] = i; recAt[i] = r; }
            if (!last) at.sort();
            ms.readback += performance.now() - t; t = performance.now();
            z.set(zGPU);
            const lakesCells = new Map(), sea0 = R.toSea, closed0 = R.inClosed;
            let eroded = last ? 0 : (await gsum.read()) * a, lakeCells = 0;
            lidF.fill(-1);
            if (inlet) inlet.fill(0);
            for (let k = 0; k < kept; k++) {
                const i = at[k], c = list[i], w = EXPORT_WORDS * recAt[i], lid = ex[w], rr = ex[w + 5], q = exF[w + 4];
                eF[c] = exF[w + 1];
                if (last) { outQ[c] = q / dt; outR[c] = rr & NONE; eroded += exF[w + 6] * a; }
                if (lid !== NONE) { lidF[c] = lid; lakeCells++; if (inlet) inlet[c] += exF[w + 2]; if (!lakesCells.has(lid)) lakesCells.set(lid, { cells: [], trap: 0 }); const L = lakesCells.get(lid); L.cells.push(c); const tr = exF[w + 3]; if (tr > 0) L.trap = tr; }
                if (rr >>> 31) { const r = rr & NONE; if (sinkAt[r] >= 0) { basins[sinkAt[r]].load += q; R.inClosed += q; if (inlet) inlet[r] += q; } else { R.toSea += q; if (seaIn && (!lay || lay[r])) seaIn[r] += q; } }
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
            if (MAR && ((s + 1) % marEvery === 0 || s === P.steps - 1)) { await seaWork(s + 1 - marDone); marDone = s + 1; }
            // (the census erodeLandscape keeps. What was eroded went to the sea, to a closed basin, or stayed: the three add up)
            let shown = 0, shownKm2 = 0, one = 0;
            for (const v of lakesCells.values()) { const km2 = v.cells.length * a; if (km2 >= P.showKm2) { shown++; shownKm2 += km2; } if (v.cells.length === 1) one++; }
            const sea = R.toSea - sea0, shut = R.inClosed - closed0;
            curve.push({ shown, shownMkm2: +(shownKm2 / 1e6).toFixed(3), one, t: +((s + 1) * dt).toFixed(3), lakeMkm2: +(lakeCells * a / 1e6).toFixed(3), lakes: lakesCells.size, erodedKm3: Math.round(eroded), keptKm3: Math.round(eroded - sea - shut), seaKm3: Math.round(sea), closedKm3: Math.round(shut) });
            if (onStep) await onStep({ s, levels, route: R.route[s], read: async (name, Type = Float32Array) => readBack(device, B[name], Type), z });
        }
        const dr = await readBack(device, B.dropped);
        for (let c = 0; c < n; c++) if (dr[c] > 0) z[c] += dr[c];
        if (settle && P.steps > 0) { const t = performance.now(); await settleNow(P.timeMyr, false); ms.rebound += performance.now() - t; }
        if (settle && column) await zBedBack(device, B.Kv, column);
    } finally {
        // (a 10M mesh's buffers are a couple of GB: they go now, not when a collector gets to them, the next run being about to want its own)
        settle?.destroy(); gsum.destroy();
        if (pool) pool.release();
        else for (const b of [...Object.values(B), rangeBuf, uniform, stage, count]) if (!resident.has(b)) b.destroy();
    }
    let seaKm3 = 0, closedKm3 = 0, grossKm3 = 0;
    for (const p of curve) { seaKm3 += p.seaKm3; closedKm3 += p.closedKm3; grossKm3 += p.erodedKm3; }
    const perYr = v => +(v / Math.max(1e-9, P.timeMyr) * 1e-6).toFixed(2);
    const budget = { seaKm3PerYr: perYr(seaKm3), closedKm3PerYr: perYr(closedKm3), grossKm3PerYr: perYr(grossKm3), reboundKm3PerYr: perYr(reboundKm3), overRimKm3PerYr: perYr(overKm3) };
    return { curve, survivors: null, budget, ms: Object.fromEntries(Object.entries(ms).map(([key, v]) => [key, Math.round(v)])), route: R.route, ...undone, toSeaKm3: R.toSea, closedKm3: R.inClosed, ...(MAR ? { marineKm3: R.marineKm3, marineDriftKm3: R.marineDriftKm3, marineSub: marSub, coastMovedCells: R.coastMoved, marineSpiltKm3: R.marineSpiltKm3, pocketCells: R.pocketCells, marineActive: +(R.marineActive / Math.max(1, R.marineSteps)).toFixed(3) } : {}), outflow: { q: outQ, recv: outR } };
}
