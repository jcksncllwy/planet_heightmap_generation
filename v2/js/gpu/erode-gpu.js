// finish-erode.js's erodeLandscape on the GPU (lane gpu, 2026-10-31; a spike, nothing in the app loads this).
// The network comes from FastFlow's depression routing (Jain, Kerbl, Gain, Finley & Cordonnier, CGF 43(7) 2024), after Cordonnier
// et al. 2019: every cell's way down gives basins; Borůvka's minimum spanning tree over them gives each basin's spill level, in
// O(log L) rounds and no priority queue. The spill levels give the filled surface, and the receivers follow as on the CPU.
// Differences from the paper:
//   · the mesh is irregular, so no donor matrix: a cell's donors are read off its neighbours.
//   · no rake-compress and no pointer-jumped solve. Those need the sums and the solve to be linear; ours have floors, lakes that
//     hold load up to their room, and a max at each lake. But the trees are shallow (450-610 levels at 2.5M on real ground), so
//     cells are sorted by their depth and swept level by level, which runs the CPU's own per-cell arithmetic, nothing reduced.
//   · no carving through lakes: a flat's cells reach its way out by a breadth-first sweep, as the flood's flat counter does.
//   · WGSL's lexicographic minimum: two atomicMin passes (the weight, then the edge's id among the cells at that weight). min is
//     commutative, so this holds no matter how threads interleave. Atomics are used only for that, for counters and for a level's
//     order, which nothing reads back: results don't depend on scheduling, so a machine repeats its own result.
// Limits: float32 throughout (the CPU's intermediates are doubles); a flat's internal receivers can differ from the flood's
// (ties broken by adjacency, not heap order), which moves water only inside a lake or along a dead-level flat. Laying what lakes
// kept, closed basins and rebound stay on the CPU, with a readback a step.

import { openDevice, readBack } from './gpu-device.js';

const R_EARTH = 6371, EPS = 1e-5, LAND_FLOOR = 0.002, WG = 128, NONE = 0x7FFFFFFF, INF = 0xFFFFFFFF, MAX_LEVELS = 1 << 16, EXPORT_WORDS = 6;

const HEAD = /* wgsl */`
struct U { n: u32, O: u32, a: f32, dt: f32, G: f32, perCell: f32, m: f32, pad: f32 }
struct Rg { start: u32, count: u32 }
struct Cell { A: f32, e: f32, gross: f32, zNew: f32, q: f32, cap: f32, lid: u32, inlet: f32 }
struct Out { lid: u32, e: f32, inlet: f32, trap: f32, q: f32, recv: u32 }
const NONE = 0x7FFFFFFFu; const INF = 0xFFFFFFFFu; const M = 0x7FFFFFFFu;
const EPS = ${EPS}f; const LF = ${LAND_FLOOR}f; const R_EARTH = ${R_EARTH}f;
fn enc(w: f32) -> u32 { let b = bitcast<u32>(w); return select(b ^ 0x80000000u, ~b, (b >> 31u) != 0u); }
`;

// Each kernel: the buffers it binds, and its body, run once for each `ix` entry in the dispatched range (c = the cell).
const T = { u: 'array<u32>', f: 'array<f32>', a: 'array<atomic<u32>>', C: 'array<Cell>', X: 'array<Out>' };
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
    flat: { b: { adjOffset: 'u', adjList: 'u', fill: 'f', outlet: 'u', distA: 'u', distB: 'u+', recv: 'u+', counter: 'a' }, body: `
        if (distA[c] != INF) { distB[c] = distA[c]; return; }
        let fc = fill[c];
        var best = INF; var pick = NONE;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) { let y = adjList[j]; if (outlet[y] == 0u && fill[y] == fc && distA[y] < best) { best = distA[y]; pick = y; } }
        if (best == INF) { distB[c] = INF; atomicAdd(&counter[0], 1u); } else { distB[c] = best + 1u; recv[c] = pick; }` },
    flagRecv: { b: { recv: 'u+', outlet: 'u', ptrA: 'u+', depthA: 'u+' }, body: `
        let r = recv[c];
        if (r == NONE) { recv[c] = NONE; ptrA[c] = c; depthA[c] = 1u; return; }
        ptrA[c] = r; depthA[c] = 1u;
        if (outlet[r] != 0u) { recv[c] = r | 0x80000000u; }` },
    depthJump: { b: { depthA: 'u', depthB: 'u+', ptrA: 'u', ptrB: 'u+' }, body: 'depthB[c] = depthA[c] + depthA[ptrA[c]]; ptrB[c] = ptrA[ptrA[c]];' },
    histogram: { b: { depthA: 'u', hist: 'a' }, body: 'atomicAdd(&hist[depthA[c]], 1u);' },
    place: { b: { depthA: 'u', cursor: 'a', order: 'u+' }, body: 'order[atomicAdd(&cursor[depthA[c]], 1u)] = c;' },
    water: { b: { adjOffset: 'u', adjList: 'u', recv: 'u', water: 'f', cells: 'C+' }, body: `
        var v = U_.a * water[c];
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) { let y = adjList[j]; if ((recv[y] & M) == c) { v += cells[y].A; } }
        cells[c].A = v;` },
    solve: { b: { recv: 'u', fill: 'f', z: 'f', dropped: 'f', K: 'f', xyz: 'f', surf: 'f', cells: 'C+' }, body: `
        let rr = recv[c]; let r = rr & M; let toOut = (rr >> 31u) != 0u;
        var under = 0.0;
        if (toOut) { under = surf[r]; } else { under = cells[r].e; }
        let old = z[c] + dropped[c];
        if (fill[c] - z[c] > EPS) {
            cells[c].e = max(old, under); cells[c].zNew = old; cells[c].gross = 0.0;
            if (!toOut && cells[r].lid != NONE && fill[r] == fill[c]) { cells[c].lid = cells[r].lid; } else { cells[c].lid = c; }
            return;
        }
        cells[c].lid = NONE;
        let Ac = max(cells[c].A, 1e-6); let share = min(1.0, U_.perCell * sqrt(Ac / 1e4));
        let d = vec3f(xyz[3u * r] - xyz[3u * c], xyz[3u * r + 1u] - xyz[3u * c + 1u], xyz[3u * r + 2u] - xyz[3u * c + 2u]);
        let F = share * K[c] * pow(Ac, U_.m) * U_.dt / (R_EARTH * length(d));
        var h = (old + F * under) / (1.0 + F);
        if (h < LF + under) { h = min(old, LF + under); }
        cells[c].zNew = h; cells[c].e = h; cells[c].gross = max(old - h, 0.0);` },
    load: { b: { adjOffset: 'u', adjList: 'u', recv: 'u', z: 'f', dropped: 'f+', trap: 'f+', cells: 'C+' }, body: `
        let lid = cells[c].lid; let rr = recv[c]; let r = rr & M; let toOut = (rr >> 31u) != 0u;
        var q = cells[c].gross * U_.a; var capIn = 0.0; var inlet = 0.0;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) {
            let y = adjList[j];
            if ((recv[y] & M) != c) { continue; }
            q += cells[y].q;
            if (lid != NONE) { if (cells[y].lid == lid) { capIn += cells[y].cap; } else { inlet += cells[y].q; } }
        }
        cells[c].inlet = inlet; cells[c].cap = 0.0; dropped[c] = 0.0; trap[c] = 0.0;
        if (lid != NONE) {
            let room = capIn + max(0.0, cells[c].e - z[c]) * U_.a;
            if (!toOut && cells[r].lid == lid) { cells[c].q = q; cells[c].cap = room; return; }
            let hold = min(q, room);
            trap[c] = hold; q -= hold;
        } else {
            let d = q * min(1.0, U_.G * U_.a / max(cells[c].A, U_.a * 1e-3));
            dropped[c] = d / U_.a; q -= d;
        }
        cells[c].q = q;` },
    commit: { b: { cells: 'C', z: 'f+' }, body: 'z[c] = cells[c].zNew;' },
    exportCells: { b: { cells: 'C', recv: 'u', trap: 'f', exp: 'X+' }, index: 'i', body: `
        let v = cells[c];
        exp[i] = Out(v.lid, v.e, v.inlet, trap[c], v.q, recv[c]);` },
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

/** Build the solver for one run of one mesh. `gpu`: navigator.gpu or Dawn's. */
export async function erodeGPU(gpu, o, P, { onStep = null, device: shared = null } = {}) {
    const { mesh, z, ocean, water, k, hold, slow = null, m, activeHold, valleyKm } = o;
    const { adjOffset, adjList, numCells: n, xyz } = mesh, a = 4 * Math.PI * R_EARTH * R_EARTH / n, dt = P.timeMyr / P.steps;
    const { device } = shared ?? await openDevice(gpu);
    const t00 = performance.now(), align = device.limits.minUniformBufferOffsetAlignment, ms = { setup: 0, upload: 0, closed: 0, route: 0, sort: 0, sweep: 0, readback: 0, lay: 0, encode: 0 };
    const U32 = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const B = {}, mk = (name, bytes) => (B[name] = device.createBuffer({ label: name, size: Math.max(4, bytes), usage: U32 }));
    const put = (name, arr) => device.queue.writeBuffer(B[name], 0, arr.buffer, arr.byteOffset, arr.byteLength);
    const up = (name, arr) => { mk(name, arr.byteLength); put(name, arr); };
    up('adjOffset', Uint32Array.from(adjOffset)); up('adjList', adjList instanceof Uint32Array ? adjList : Uint32Array.from(adjList)); up('xyz', xyz instanceof Float32Array ? xyz : Float32Array.from(xyz)); up('water', water);
    const K = new Float32Array(n);
    for (let c = 0; c < n; c++) K[c] = (P.kScale ?? 1) * k[c] * (1 - activeHold * hold[c]) * (slow ? slow[c] : 1);
    up('K', K);
    for (const f of ['z', 'dropped', 'Zt', 'hookW', 'weight', 'valA', 'valB', 'fill', 'surf', 'trap']) mk(f, 4 * n);
    for (const u of ['ptrA', 'ptrB', 'ptrC', 'roots', 'label', 'bestW', 'bestE', 'hookTo', 'parent', 'recv', 'distA', 'distB', 'flats', 'depthA', 'depthB', 'order', 'outlet', 'list']) mk(u, 4 * n);
    mk('compA', 4 * (n + 1)); mk('compB', 4 * (n + 1)); mk('counter', 16); mk('hist', 4 * MAX_LEVELS); mk('cursor', 4 * MAX_LEVELS); mk('cells', 32 * n); mk('exp', 4 * EXPORT_WORDS * n);
    const rangeBuf = device.createBuffer({ size: align * (MAX_LEVELS + 8), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const ub = new ArrayBuffer(32), uv = new DataView(ub);
    [n, n].forEach((v, i) => uv.setUint32(4 * i, v, true));
    [a, dt, P.G, valleyKm / Math.sqrt(a), m].forEach((v, i) => uv.setFloat32(8 + 4 * i, v, true));
    device.queue.writeBuffer(uniform, 0, ub);
    const stage = device.createBuffer({ size: 4 * MAX_LEVELS, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), count = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    // ── the pipelines, each with a layout whose range uniform takes a dynamic offset ──
    const P_ = {};
    await Promise.all(Object.entries(KERNELS).map(async ([name, spec]) => {
        const entries = [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } }, { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }];
        Object.values(spec.b).forEach((t, i) => entries.push({ binding: i + 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: t.endsWith('+') || t === 'a' ? 'storage' : 'read-only-storage' } }));
        const layout = device.createBindGroupLayout({ entries }), module = device.createShaderModule({ code: wgsl(name, spec) });
        const info = await module.getCompilationInfo?.(), bad = info?.messages?.filter(x => x.type === 'error') ?? [];
        if (bad.length) throw new Error(`${name}: ` + bad.map(x => `${x.lineNum}:${x.linePos} ${x.message}`).join('\n'));
        P_[name] = { pipe: await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: 'main' } }), layout, spec };
    }));
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
        copyZ: group('copyZ', 'list'), descend: group('descend', 'list'), jumpAB: group('jump', 'list'), jumpBA: group('jump', 'list', { ptrA: 'ptrB', ptrB: 'ptrA' }), findRoots: group('findRoots', 'list'), label: group('label', 'list'),
        resetBest: group('resetBest', 'roots'), minWeight: group('minWeight', 'list'), minEdge: group('minEdge', 'list'), pickEdge: group('pickEdge', 'list'), hook: group('hook', 'roots'),
        flatAB: group('flatten', 'roots', { compA: 'compB', compB: 'compA' }), flatBA: group('flatten', 'roots'), active: group('active', 'roots'),
        levelInit: group('levelInit', 'roots'), levelAB: group('levelJump', 'roots'), levelBA: group('levelJump', 'roots', { valA: 'valB', valB: 'valA', ptrB: 'ptrC', ptrC: 'ptrB' }),
        fillIn: group('fillIn', 'list'), receive: group('receive', 'list'), findFlat: group('findFlat', 'list'), flatAB2: group('flat', 'flats'), flatBA2: group('flat', 'flats', { distA: 'distB', distB: 'distA' }),
        flagRecv: group('flagRecv', 'list'), depthAB: group('depthJump', 'list'), depthBA: group('depthJump', 'list', { depthA: 'depthB', depthB: 'depthA', ptrA: 'ptrB', ptrB: 'ptrA' }), histogram: group('histogram', 'list'), place: group('place', 'list'),
        water: group('water', 'order'), solve: group('solve', 'order'), load: group('load', 'order'), commit: group('commit', 'list'), exportCells: group('exportCells', 'list'),
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
    const closed = () => {
        const C = o.closed(z);
        sink = C.sink; base = C.base; basins = [];
        sinkAt = sinkAt ?? new Int32Array(n);
        sinkAt.fill(-1);
        for (const L of C.lakes) if (sink[L.cells[0]]) { for (const c of L.cells) sinkAt[c] = basins.length; basins.push({ cells: L.cells, level: L.level, load: 0 }); }
    };
    const outlets = () => {
        const out = new Uint32Array(n), surf = new Float32Array(n), Zs = new Float32Array(n), self = new Uint32Array(n), d0 = new Uint32Array(n), rec = new Uint32Array(n), lab = new Uint32Array(n);
        list = new Uint32Array(n); listLen = 0;
        for (let c = 0; c < n; c++) {
            if (ocean[c] || sink[c]) { out[c] = 1; surf[c] = ocean[c] ? Math.min(0, z[c]) : base[c]; Zs[c] = ocean[c] ? 0 : base[c]; lab[c] = n; } else list[listLen++] = c;
            self[c] = c; rec[c] = c;
        }
        put('outlet', out); put('surf', surf); put('Zt', Zs); put('list', list); put('ptrA', self); put('ptrB', self); put('ptrC', self); put('label', lab); put('recv', rec); put('depthA', d0); put('depthB', d0); put('valA', Zs); put('valB', Zs);
        const comp = new Uint32Array(n + 1);
        for (let c = 0; c <= n; c++) comp[c] = c < n && out[c] ? n : c;
        put('compA', comp); put('compB', comp);
        setRange(SL.list, 0, listLen);
    };
    // ── a network: basins, their spanning tree, the filled surface, the receivers, the depth order ──
    let levels = 0, hist0 = null, guessRounds = 6, guessPasses = 8;
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
        let pending = flats, passes = 0, even = true;
        while (pending > 0) {
            const batch = passes ? 8 : guessPasses;
            e = device.createCommandEncoder();
            for (let b = 0; b < batch; b++) { if (b === batch - 1) clearCounter(e); p = e.beginComputePass(); run(p, even ? G.flatAB2 : G.flatBA2, SL.flats, flats); even = !even; p.end(); }
            device.queue.submit([e.finish()]);
            passes += batch;
            const now = await readCount();
            if (now === pending && passes > batch) break;
            pending = now;
        }
        guessPasses = Math.max(8, passes);
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
        put('cursor', cursor);
        hist0 = hist;
        ms.route += t1 - t0; ms.sort += performance.now() - t1;
        return { roots, rounds, flats, passes, levels, placed: at, unresolved: pending };
    };
    const sweeps = async hist0 => {
        const t0 = performance.now(), e = device.createCommandEncoder(), p = e.beginComputePass();
        run(p, G.place, SL.list, listLen);
        for (let d = levels; d >= 1; d--) run(p, G.water, 8 + d, hist0[d]);
        for (let d = 1; d <= levels; d++) run(p, G.solve, 8 + d, hist0[d]);
        for (let d = levels; d >= 1; d--) run(p, G.load, 8 + d, hist0[d]);
        run(p, G.commit, SL.list, listLen); run(p, G.exportCells, SL.list, listLen);
        p.end();
        device.queue.submit([e.finish()]);
        ms.encode += performance.now() - t0;
        await device.queue.onSubmittedWorkDone();
        ms.sweep += performance.now() - t0;
    };
    const R = { route: [], toSea: 0, inClosed: 0 };
    const lidF = new Int32Array(n), eF = new Float32Array(n), inlet = P.delta ? new Float64Array(n) : null, been = P.delta ? new Int32Array(n).fill(-1) : null;
    let walk = 0;
    const layDeltas = (cells, vol, surface, inside) => {
        const mouths = [];
        let all = 0;
        for (const c of cells) if (inlet[c] > 0) { mouths.push(c); all += inlet[c]; }
        if (!all) return layUp(z, cells, vol, Infinity);
        mouths.sort((x, y) => inlet[y] - inlet[x]);
        for (const c0 of mouths) {
            let left = vol * inlet[c0] / all;
            const q = [c0], id = walk++;
            been[c0] = id;
            for (let i = 0; i < q.length && left > 0; i++) {
                const c = q[i], room = surface(c) - z[c];
                if (room > 0) { const add = room < left ? room : left; z[c] += add; left -= add; }
                for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (been[y] !== id && inside(y)) { been[y] = id; q.push(y); } }
            }
        }
    };
    const anchor = P.rebound > 0 ? z.slice() : null;
    const settle = () => {
        const d = new Float32Array(n), next = new Float32Array(n);
        for (let c = 0; c < n; c++) if (!ocean[c]) d[c] = z[c] - anchor[c];
        const need = 2 * P.reboundKm * P.reboundKm / (mesh.edgeKm * mesh.edgeKm), passes = Math.ceil(need / 0.5), w = need / passes;
        for (let p = 0; p < passes; p++) {
            for (let c = 0; c < n; c++) { let v = 0, g = 0; for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { v += d[adjList[j]]; g++; } next[c] = d[c] + w * (v / g - d[c]); }
            d.set(next);
        }
        for (let c = 0; c < n; c++) { if (ocean[c]) continue; const was = z[c]; z[c] -= P.rebound * d[c]; if (was > 0 && z[c] < LAND_FLOOR) z[c] = Math.min(was, LAND_FLOOR); anchor[c] = z[c]; }
    };
    put('dropped', new Float32Array(n));
    await device.queue.onSubmittedWorkDone();
    ms.setup = performance.now() - t00;
    const dropped = new Float32Array(n);
    for (let s = 0; s < P.steps; s++) {
        let t = performance.now();
        if (P.rebound > 0 && s > 0 && s % P.closedEvery === 0) settle();
        if (s % P.closedEvery === 0) { closed(); ms.closed += performance.now() - t; t = performance.now(); outlets(); }
        put('z', z);
        ms.upload += performance.now() - t;
        R.route.push(await route());
        await sweeps(hist0);
        t = performance.now();
        const zGPU = await readBack(device, B.z), ex = await readBack(device, B.exp, Uint32Array, 4 * EXPORT_WORDS * listLen), exF = new Float32Array(ex.buffer);
        ms.readback += performance.now() - t; t = performance.now();
        z.set(zGPU);
        const NONE32 = NONE, lakesCells = new Map();
        lidF.fill(-1);
        if (inlet) inlet.fill(0);
        for (let i = 0; i < listLen; i++) {
            const c = list[i], w = EXPORT_WORDS * i, lid = ex[w], rr = ex[w + 5], q = exF[w + 4];
            eF[c] = exF[w + 1];
            if (lid !== NONE32) { lidF[c] = lid; if (inlet) inlet[c] += exF[w + 2]; if (!lakesCells.has(lid)) lakesCells.set(lid, { cells: [], trap: 0 }); const L = lakesCells.get(lid); L.cells.push(c); const tr = exF[w + 3]; if (tr > 0) L.trap = tr; }
            if (rr >>> 31) { const r = rr & NONE32; if (sinkAt[r] >= 0) { basins[sinkAt[r]].load += q; R.inClosed += q; if (inlet) inlet[r] += q; } else R.toSea += q; }
        }
        for (const [L, v] of lakesCells) if (v.trap > 0) {
            if (P.delta) layDeltas(v.cells, v.trap / a, c => eF[c], c => lidF[c] === L);
            else layUp(z, v.cells, v.trap / a, Infinity);
        }
        basins.forEach((Bn, b) => {
            if (!(Bn.load > 0)) return;
            if (P.delta) layDeltas(Bn.cells, Bn.load / a, () => Bn.level, c => sinkAt[c] === b);
            else layUp(z, Bn.cells, Bn.load / a, Bn.level);
            Bn.load = 0;
        });
        ms.lay += performance.now() - t;
        if (onStep) await onStep({ s, levels, route: R.route[s], read: async (name, Type = Float32Array) => readBack(device, B[name], Type), z });
    }
    const dr = await readBack(device, B.dropped);
    for (let c = 0; c < n; c++) if (dr[c] > 0) z[c] += dr[c];
    if (P.rebound > 0 && P.steps > 0) settle();
    if (!shared) Object.values(B).forEach(b => b.destroy());
    return { ms: Object.fromEntries(Object.entries(ms).map(([key, v]) => [key, Math.round(v)])), route: R.route, toSeaKm3: R.toSea, closedKm3: R.inClosed };
}

function layUp(z, cells, vol, top) {
    const h = Float32Array.from(cells, c => z[c]).sort();
    let level = h[0], left = vol, i = 1;
    for (; i < h.length; i++) { const need = i * (h[i] - level); if (need >= left) break; left -= need; level = h[i]; }
    level += left / i;
    if (level > top) level = top;
    for (const c of cells) if (z[c] < level) z[c] = level;
}
