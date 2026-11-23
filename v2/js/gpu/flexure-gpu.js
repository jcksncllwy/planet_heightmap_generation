// The thin plate's solve on the GPU (lane flexure, 2026-11-22): the operator of gpu/flexure.js, A = K (B/M) K + M S, solved by
// conjugate gradients preconditioned with one multigrid V-cycle — on the mesh shown and the coarser terrain meshes under it, a
// factor ~4 apart (10 000 · 4ᵏ cells: the erosion ladder's own rungs, so their maps are the ones it already made).
//
// Why multigrid: the plate's operator is fourth order, so its condition grows as (α/h)⁴ — a craton's α of ~140 km over the
// 2.5M mesh's 14 km cells is ~10⁴ — and Jacobi-preconditioned CG needs ~(α/h)² iterations: 937 at 640K for Te 70 to 10⁻⁸,
// ~3 000 at 2.5M. A V-cycle gets every wavelength to the mesh where it is a few cells long; MG-CG took 28 at 640K and 38 at
// 2.5M, alike (lane flexure's prototype). Each level: ν damped-Jacobi sweeps before and after (ω FLEX.mgOmega; the
// Jacobi-scaled operator's largest eigenvalue measured 2.6–2.8 on these meshes, so ω·λ < 2), the residual restricted by the
// transpose of the prolongation (each coarse cell gathers its fine cells' residual by the weights that carry its correction
// back — R = Pᵀ, so the V-cycle is symmetric and CG may use it), the coarsest (≤ 12 000 cells, ~240 km, where every plate is
// near-Airy) by more sweeps. Coarse levels' stiffness: the geometric mean of the fine cells' (log B averaged by the same
// weights); their buoyancy, the mean. Te must vary smoothly for that to hold (a 14 km step from 70 to 5 km took 156
// iterations): the finish interpolates it from the history's ~110 km mesh (finish.js elasticOn).
//
// Determinism: no atomics. Restriction gathers each coarse cell's fine cells in index order; every dot product is a fixed
// tree (256 a workgroup, then one workgroup over the partials in a fixed stride). The iteration count is read back every
// FLEX.mgCheck iterations against FLEX.mgTol; the same machine repeats its sequence, so its count, to the bit. float32
// throughout; tools/flexure-test.mjs holds it to the float64 reference (gpu/flexure.js solvePlateCPU).

import { pipeline, readBack } from './gpu-device.js';
import { WG, SUM_WG, INDEX_WGSL, dispatch, meshFields } from './fields.js';
import { FLEX, plateOperator, stiffnessKm4, flexuralLengthKm } from './flexure.js';
import { mapOnto } from '../core/mesh-maps.js';

const COARSEST = 12000;
// (the scalars the CG keeps on the GPU, by slot)
const RZ = 0, ALPHA = 1, BETA = 2, RR = 3, BB = 4;

/** The meshes' sizes under `n` cells: the largest 10 000 · 4ᵏ at most n / 2.5, then a factor 4 down to the coarsest. */
export function levelSizes(n) {
    const out = [];
    let m = n;
    while (m > COARSEST) {
        let s = 10000;
        while (s * 4 <= m / 2.5) s *= 4;
        if (s >= m) break;
        out.push(s); m = s;
    }
    return out;
}

const HEAD = INDEX_WGSL;
const MAIN = `@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg);`;
const SUM_MAIN = `var<workgroup> sh: array<f32, ${SUM_WG}>;
@compute @workgroup_size(${SUM_WG}) fn main(@builtin(local_invocation_index) l: u32, @builtin(workgroup_id) g: vec3u, @builtin(num_workgroups) nwg: vec3u) {`;
const TREE = `workgroupBarrier();
    for (var k = ${SUM_WG / 2}u; k > 0u; k >>= 1u) { if (l < k) { sh[l] += sh[l + k]; } workgroupBarrier(); }`;
// (a cell's Laplacian-weighted neighbour sum of f: Σⱼ Kᵢⱼ (fⱼ − fᵢ))
const STENCIL = (f) => `var v = 0.0;
    let a = off[c]; let b = off[c + 1u]; let fc = ${f}[c];
    for (var j = a; j < b; j++) { v += wK[j] * (${f}[adj[j]] - fc); }`;
const OP = `@group(0) @binding(0) var<storage, read> off: array<u32>;
@group(0) @binding(1) var<storage, read> adj: array<u32>;
@group(0) @binding(2) var<storage, read> wK: array<f32>;`;

const kernels = omega => ({
    // (A's diagonal: Σⱼ Kᵢⱼ² Gⱼ + Gᵢ (Σⱼ Kᵢⱼ)² + Mᵢsᵢ, G = B/M)
    diag: `${HEAD}${OP}
@group(0) @binding(3) var<storage, read> rowK: array<f32>;
@group(0) @binding(4) var<storage, read> G: array<f32>;
@group(0) @binding(5) var<storage, read> Ms: array<f32>;
@group(0) @binding(6) var<storage, read_write> diag: array<f32>;
${MAIN}
    if (c + 1u >= arrayLength(&off)) { return; }
    var v = 0.0;
    for (var j = off[c]; j < off[c + 1u]; j++) { v += wK[j] * wK[j] * G[adj[j]]; }
    diag[c] = v + G[c] * rowK[c] * rowK[c] + Ms[c];
}`,
    // (the plate's moment: t = (B/M) K p)
    kp: `${HEAD}${OP}
@group(0) @binding(3) var<storage, read> G: array<f32>;
@group(0) @binding(4) var<storage, read> p: array<f32>;
@group(0) @binding(5) var<storage, read_write> t: array<f32>;
${MAIN}
    if (c + 1u >= arrayLength(&off)) { return; }
    ${STENCIL('p')}
    t[c] = G[c] * v;
}`,
    // (one damped-Jacobi sweep, from t = (B/M) K x: x += ω (b − A x) / diag)
    smooth: `${HEAD}${OP}
@group(0) @binding(3) var<storage, read> Ms: array<f32>;
@group(0) @binding(4) var<storage, read> t: array<f32>;
@group(0) @binding(5) var<storage, read> rhs: array<f32>;
@group(0) @binding(6) var<storage, read> diag: array<f32>;
@group(0) @binding(7) var<storage, read_write> x: array<f32>;
${MAIN}
    if (c + 1u >= arrayLength(&off)) { return; }
    ${STENCIL('t')}
    x[c] += ${omega} * (rhs[c] - v - Ms[c] * x[c]) / diag[c];
}`,
    // (the residual r = b − A x, from t = (B/M) K x)
    resid: `${HEAD}${OP}
@group(0) @binding(3) var<storage, read> Ms: array<f32>;
@group(0) @binding(4) var<storage, read> t: array<f32>;
@group(0) @binding(5) var<storage, read> rhs: array<f32>;
@group(0) @binding(6) var<storage, read> x: array<f32>;
@group(0) @binding(7) var<storage, read_write> r: array<f32>;
${MAIN}
    if (c + 1u >= arrayLength(&off)) { return; }
    ${STENCIL('t')}
    r[c] = rhs[c] - v - Ms[c] * x[c];
}`,
    // (A p, from t = (B/M) K p)
    ax: `${HEAD}${OP}
@group(0) @binding(3) var<storage, read> Ms: array<f32>;
@group(0) @binding(4) var<storage, read> t: array<f32>;
@group(0) @binding(5) var<storage, read> p: array<f32>;
@group(0) @binding(6) var<storage, read_write> q: array<f32>;
${MAIN}
    if (c + 1u >= arrayLength(&off)) { return; }
    ${STENCIL('t')}
    q[c] = v + Ms[c] * p[c];
}`,
    // (the coarse right side: each coarse cell gathers its fine cells' residual by the prolongation's weights, in index order)
    restrict: `${HEAD}
@group(0) @binding(0) var<storage, read> tOff: array<u32>;
@group(0) @binding(1) var<storage, read> tIdx: array<u32>;
@group(0) @binding(2) var<storage, read> tW: array<f32>;
@group(0) @binding(3) var<storage, read> r: array<f32>;
@group(0) @binding(4) var<storage, read_write> bc: array<f32>;
${MAIN}
    if (c + 1u >= arrayLength(&tOff)) { return; }
    var v = 0.0;
    for (var k = tOff[c]; k < tOff[c + 1u]; k++) { v += tW[k] * r[tIdx[k]]; }
    bc[c] = v;
}`,
    // (the coarse correction carried back: x += Σ₃ w · x_coarse)
    prolong: `${HEAD}
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> weights: array<f32>;
@group(0) @binding(2) var<storage, read> xc: array<f32>;
@group(0) @binding(3) var<storage, read_write> x: array<f32>;
${MAIN}
    if (c >= arrayLength(&x)) { return; }
    let i = 3u * c;
    x[c] += weights[i] * xc[cells[i]] + weights[i + 1u] * xc[cells[i + 1u]] + weights[i + 2u] * xc[cells[i + 2u]];
}`,
    zero: `${HEAD}
@group(0) @binding(0) var<storage, read_write> x: array<f32>;
${MAIN}
    if (c >= arrayLength(&x)) { return; }
    x[c] = 0.0;
}`,
    // (a dot product's partials: each workgroup of 256 by a fixed tree)
    dot: `@group(0) @binding(0) var<storage, read> u: array<f32>;
@group(0) @binding(1) var<storage, read> v: array<f32>;
@group(0) @binding(2) var<storage, read_write> part: array<f32>;
${SUM_MAIN}
    let w = g.x + g.y * nwg.x; let i = w * ${SUM_WG}u + l;
    sh[l] = select(0.0, u[i] * v[i], i < arrayLength(&u));
    ${TREE}
    if (l == 0u) { part[w] = sh[0]; }
}`,
    // (the partials summed by one workgroup, in a fixed stride and tree, and the CG's scalar made of it: mode 0 S[slot] = Σ,
    // 1 α = rz / Σ (Σ = p·Ap), 2 β = Σ / rz then rz = Σ (Σ = r·z))
    fin: `struct U { mode: u32, slot: u32, count: u32, pad: u32 }
@group(0) @binding(0) var<uniform> U_: U;
@group(0) @binding(1) var<storage, read> part: array<f32>;
@group(0) @binding(2) var<storage, read_write> S: array<f32>;
${SUM_MAIN}
    var v = 0.0;
    for (var k = l; k < U_.count; k += ${SUM_WG}u) { v += part[k]; }
    sh[l] = v;
    ${TREE}
    if (l == 0u) {
        let s = sh[0];
        if (U_.mode == 0u) { S[U_.slot] = s; }
        else if (U_.mode == 1u) { S[${ALPHA}] = select(0.0, S[${RZ}] / s, s != 0.0); }
        else { S[${BETA}] = select(0.0, s / S[${RZ}], S[${RZ}] != 0.0); S[${RZ}] = s; }
    }
}`,
    // (w += α p, r −= α Ap)
    upd1: `${HEAD}
@group(0) @binding(0) var<storage, read> S: array<f32>;
@group(0) @binding(1) var<storage, read> p: array<f32>;
@group(0) @binding(2) var<storage, read> q: array<f32>;
@group(0) @binding(3) var<storage, read_write> w: array<f32>;
@group(0) @binding(4) var<storage, read_write> r: array<f32>;
${MAIN}
    if (c >= arrayLength(&w)) { return; }
    let a = S[${ALPHA}];
    w[c] += a * p[c]; r[c] -= a * q[c];
}`,
    // (p = z + β p)
    upd2: `${HEAD}
@group(0) @binding(0) var<storage, read> S: array<f32>;
@group(0) @binding(1) var<storage, read> z: array<f32>;
@group(0) @binding(2) var<storage, read_write> p: array<f32>;
${MAIN}
    if (c >= arrayLength(&p)) { return; }
    p[c] = z[c] + S[${BETA}] * p[c];
}`,
});

const compiled = new WeakMap();
function pipelinesOf(device, omega) {
    if (!compiled.has(device)) compiled.set(device, new Map());
    const of = compiled.get(device), key = String(omega);
    if (!of.has(key)) of.set(key, (async () => Object.fromEntries(await Promise.all(Object.entries(kernels(omega.toFixed(6))).map(async ([k, code]) => [k, await pipeline(device, code)]))))());
    return of.get(key);
}

// (a fine field's mean over each coarse cell by the transpose's weights; a coarse cell no fine cell touches takes `empty`)
function tMean(T, v, nc, empty) {
    const out = new Float32Array(nc);
    for (let c = 0; c < nc; c++) { let a = 0, sw = 0; for (let k = T.off[c]; k < T.off[c + 1]; k++) { a += T.w[k] * v[T.idx[k]]; sw += T.w[k]; } out[c] = sw > 0 ? a / sw : empty; }
    return out;
}

// (a map's transpose: for each coarse cell, the fine cells whose 3 corners include it and those weights, in fine index order)
const transposes = new WeakMap();
function transposeOf(map, m) {
    if (transposes.has(map)) return transposes.get(map);
    const { cells, weights } = map, n = cells.length / 3, off = new Uint32Array(m + 1);
    for (let k = 0; k < 3 * n; k++) off[cells[k] + 1]++;
    for (let c = 0; c < m; c++) off[c + 1] += off[c];
    const at = off.slice(0, m), idx = new Uint32Array(3 * n), w = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) { const c = cells[3 * i + j], k = at[c]++; idx[k] = i; w[k] = weights[3 * i + j]; }
    const T = { off, idx, w };
    transposes.set(map, T);
    return T;
}

/**
 * A plate solver on `mesh` for Te `te` (km, per cell), resident on the GPU. Its finest level's `b` (n f32: M·ℓ, the load times
 * each cell's area) is the caller's to fill; `w` (n f32) holds the deflection after solve(); `M` (n f32) the cells' areas, for
 * the caller's load. setOcean(o): the buoyancy, air or sea water over each cell (1 per sea cell). `meshOf(cells)`: a terrain
 * mesh of about that many cells (terrain-mesh.js terrainMesh). `onMesh`: solve on the mesh itself, however fine (tests).
 * @returns {Promise<{b: GPUBuffer, w: GPUBuffer, M: GPUBuffer, setOcean(o: ArrayLike<number>): void, solve(): Promise<{iterations: number, residual: number}>, destroy(): void}>}
 */
export async function plateSolverGPU(device, { mesh, te, meshOf, F = FLEX, onMesh = false }) {
    const P_ = await pipelinesOf(device, F.mgOmega), own = [];
    const USE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const mk = (label, bytes) => { const b = device.createBuffer({ label, size: Math.max(16, bytes), usage: USE }); own.push(b); return b; };
    const up = (label, arr) => { const b = mk(label, arr.byteLength); device.queue.writeBuffer(b, 0, arr.buffer, arr.byteOffset, arr.byteLength); return b; };
    const g = (name, list) => device.createBindGroup({ layout: P_[name].getBindGroupLayout(0), entries: list.map((buffer, binding) => ({ binding, resource: { buffer } })) });

    // ── where the plate is solved: the coarsest of the mesh and its levels whose cells are no wider than the thinnest land
    // plate's own length, l = α/√2 of arcTeKm (31 km at 15 km: the belts, the arcs, the rifts). A deflection has no shape finer
    // than l — the Kelvin function's — so a finer mesh only re-resolves the load (flexure-test 1b: at h ≈ l a 60 km-wide load is
    // within 2 % of the Hankel solution, a 30 km one 7 %). The 2.5M ground (15 km cells) is bent on 640K's (30 km), a fourth of
    // the work and none of 2.5M's operator to build (lane flexure, 2026-11-23: the plate's cost at 2.5M, 24 s → see README).
    // What it skips: a load narrower than l on a plate thinner than arcTeKm's (young sea floor, Te 2–10 near the ridges: the
    // sea's sediment is thin there) spreads over a 30 km cell before it bends the plate. The mesh's load comes down by the
    // prolongation's transpose (Pᵀ: the load's volume kept), and the deflection goes back up by the prolongation (the 3 around).
    const all = [mesh, ...levelSizes(mesh.numCells).map(s => meshOf(s))], lMin = flexuralLengthKm(F.arcTeKm, 0, F) / Math.SQRT2;
    let s0 = 0;
    while (!onMesh && s0 + 1 < all.length && all[s0 + 1].edgeKm <= lMin) s0++;
    const meshes = all.slice(s0), L = [], nIn = mesh.numCells;
    const inMap = s0 ? mapOnto(meshes[0], mesh) : null, inT = inMap ? transposeOf(inMap, meshes[0].numCells) : null;
    const logB = Float32Array.from(te, t => Math.log(stiffnessKm4(Math.max(0.5, t), F)));
    let lb = inT ? tMean(inT, logB, meshes[0].numCells, Math.log(stiffnessKm4(F.continentTeKm, F))) : logB;
    for (let k = 0; k < meshes.length; k++) {
        const m = meshes[k], n = m.numCells, op = plateOperator(m);
        const map = k + 1 < meshes.length ? mapOnto(meshes[k + 1], m) : null, T = map ? transposeOf(map, meshes[k + 1].numCells) : null;
        const Gv = new Float32Array(n);
        for (let c = 0; c < n; c++) Gv[c] = Math.exp(lb[c]) / op.M[c];
        const adj = k === 0 ? meshFields(device, m) : { adjOffset: up('off', Uint32Array.from(m.adjOffset)), adjList: up('adj', Uint32Array.from(m.adjList)) };
        const lev = { mesh: m, n, op, map, T, off: adj.adjOffset, adj: adj.adjList, wK: up('wK', op.wK), rowK: up('rowK', Float32Array.from(op.rowK)), G: up('G', Gv),
            Ms: mk('Ms', 4 * n), diag: mk('diag', 4 * n), x: mk('x', 4 * n), b: mk('b', 4 * n), r: mk('r', 4 * n), t: mk('t', 4 * n) };
        if (map) {
            // (the next level's log stiffness: the fine cells' by the transpose's weights)
            lb = tMean(T, lb, meshes[k + 1].numCells, Math.log(stiffnessKm4(F.continentTeKm, F)));
            lev.cells = up('cells', Uint32Array.from(map.cells)); lev.weights = up('weights', Float32Array.from(map.weights));
            lev.tOff = up('tOff', T.off); lev.tIdx = up('tIdx', T.idx); lev.tW = up('tW', T.w);
        }
        L.push(lev);
    }
    for (let k = 0; k < L.length; k++) {
        const v = L[k], c = L[k + 1];
        v.G_ = { diag: g('diag', [v.off, v.adj, v.wK, v.rowK, v.G, v.Ms, v.diag]), kpX: g('kp', [v.off, v.adj, v.wK, v.G, v.x, v.t]),
            smooth: g('smooth', [v.off, v.adj, v.wK, v.Ms, v.t, v.b, v.diag, v.x]), resid: g('resid', [v.off, v.adj, v.wK, v.Ms, v.t, v.b, v.x, v.r]), zero: g('zero', [v.x]) };
        if (c) { v.G_.restrict = g('restrict', [v.tOff, v.tIdx, v.tW, v.r, c.b]); v.G_.prolong = g('prolong', [v.cells, v.weights, c.x, v.x]); }
    }

    // ── the CG's vectors on the finest level: the V-cycle reads its residual as level 0's right side (L[0].b is the CG's r) and
    // writes z into level 0's x ──
    // (bIn, w and M on the caller's mesh; bS and wS the solve's — the same buffers when the plate is solved on the mesh itself.
    // M: the Voronoi areas there, else the mesh's mean cell, 4πR²/n — the erosion's own measure of a cell's volume)
    const f = L[0], n = f.n, bIn = mk('load', 4 * nIn), w = mk('w', 4 * nIn), p = mk('p', 4 * n), q = mk('Ap', 4 * n), tq = mk('tq', 4 * n);
    const bS = s0 ? mk('loadS', 4 * n) : bIn, wS = s0 ? mk('wS', 4 * n) : w;
    const Mf = s0 ? up('M', new Float32Array(nIn).fill(4 * Math.PI * 6371 * 6371 / nIn)) : up('M', f.op.M), parts = Math.ceil(n / SUM_WG), part = mk('part', 4 * parts), S = mk('S', 32);
    const fins = {}, uni = (mode, slot) => { const u = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); own.push(u); device.queue.writeBuffer(u, 0, new Uint32Array([mode, slot, parts, 0])); return g('fin', [u, part, S]); };
    fins.rz = uni(0, RZ); fins.bb = uni(0, BB); fins.rr = uni(0, RR); fins.alpha = uni(1, 0); fins.beta = uni(2, 0);
    const r = f.b, z = f.x;
    const G = { kpP: g('kp', [f.off, f.adj, f.wK, f.G, p, tq]), ax: g('ax', [f.off, f.adj, f.wK, f.Ms, tq, p, q]),
        dotPq: g('dot', [p, q, part]), dotRz: g('dot', [r, z, part]), dotRr: g('dot', [r, r, part]), dotBb: g('dot', [bS, bS, part]),
        upd1: g('upd1', [S, p, q, wS, r]), upd2: g('upd2', [S, z, p]), zeroW: g('zero', [wS]),
        kpW: g('kp', [f.off, f.adj, f.wK, f.G, wS, tq]), residW: g('resid', [f.off, f.adj, f.wK, f.Ms, tq, bS, wS, r]) };
    if (s0) {
        const T = { off: up('tOff', inT.off), idx: up('tIdx', inT.idx), w: up('tW', inT.w) };
        G.down = g('restrict', [T.off, T.idx, T.w, bIn, bS]);
        G.zeroOut = g('zero', [w]);
        G.up = g('prolong', [up('cells', Uint32Array.from(inMap.cells)), up('weights', Float32Array.from(inMap.weights)), wS, w]);
    }

    const step = (pass, name, grp, count, wg) => { pass.setPipeline(P_[name]); pass.setBindGroup(0, grp); dispatch(pass, count, wg); };
    const sumTo = (pass, dotG, finG) => { step(pass, 'dot', dotG, n, SUM_WG); pass.setPipeline(P_.fin); pass.setBindGroup(0, finG); pass.dispatchWorkgroups(1); };
    // (one V-cycle: level 0's b → its x)
    const vcycle = pass => {
        for (let k = 0; k < L.length; k++) {
            const v = L[k], last = k === L.length - 1;
            step(pass, 'zero', v.G_.zero, v.n);
            for (let i = 0; i < (last ? F.mgCoarseSweeps : k ? F.mgSweeps : F.mgSweeps0 ?? F.mgSweeps); i++) { step(pass, 'kp', v.G_.kpX, v.n); step(pass, 'smooth', v.G_.smooth, v.n); }
            if (last) break;
            step(pass, 'kp', v.G_.kpX, v.n); step(pass, 'resid', v.G_.resid, v.n); step(pass, 'restrict', v.G_.restrict, L[k + 1].n);
        }
        for (let k = L.length - 2; k >= 0; k--) {
            const v = L[k];
            step(pass, 'prolong', v.G_.prolong, v.n);
            for (let i = 0; i < (k ? F.mgSweeps : F.mgSweeps0 ?? F.mgSweeps); i++) { step(pass, 'kp', v.G_.kpX, v.n); step(pass, 'smooth', v.G_.smooth, v.n); }
        }
    };
    const readS = async () => readBack(device, S);
    let lastOcean = null;

    return {
        b: bIn, w, M: Mf, levels: L.map(v => v.n), cells: nIn,
        setOcean(o) {
            // (the buoyancy: Δρ/ρm, air or the sea's water filling the trough; coarse levels the mean by the transpose's weights.
            // Asked at every closed-basin judge: nothing to do when the sea has not moved)
            if (lastOcean && lastOcean.length === nIn && lastOcean.every((v, c) => v === (o[c] ? 1 : 0))) return;
            lastOcean = Uint8Array.from(o, v => (v ? 1 : 0));
            const sea = (F.mantleRho - F.waterRho) / F.mantleRho;
            let s = new Float32Array(nIn);
            for (let c = 0; c < nIn; c++) s[c] = o[c] ? sea : 1;
            if (inT) s = tMean(inT, s, n, 1);
            const e = device.createCommandEncoder(), pass = e.beginComputePass();
            for (let k = 0; k < L.length; k++) {
                const v = L[k], ms = new Float32Array(v.n);
                for (let c = 0; c < v.n; c++) ms[c] = v.op.M[c] * s[c];
                device.queue.writeBuffer(v.Ms, 0, ms);
                step(pass, 'diag', v.G_.diag, v.n);
                if (v.T) {
                    const nc = L[k + 1].n, next = new Float32Array(nc);
                    for (let c = 0; c < nc; c++) { let a = 0, sw = 0; for (let j = v.T.off[c]; j < v.T.off[c + 1]; j++) { a += v.T.w[j] * s[v.T.idx[j]]; sw += v.T.w[j]; } next[c] = sw > 0 ? a / sw : 1; }
                    s = next;
                }
            }
            pass.end();
            device.queue.submit([e.finish()]);
        },
        /**
         * The deflection under `b` into `w`: from zero, or `warm` from what `w` holds (the last solve's: the plate is linear and a
         * settling's load is much like the last one's — the same rivers cutting, the same deltas building — so the CG starts
         * from that answer's residual, r = b − A w, and has less of the error to take out; the stop is still |r| ≤ mgTol |b|).
         */
        async solve(warm = false) {
            let e = device.createCommandEncoder(), pass;
            if (s0) { pass = e.beginComputePass(); step(pass, 'restrict', G.down, n); pass.end(); }
            if (warm) {
                pass = e.beginComputePass();
                step(pass, 'kp', G.kpW, n); step(pass, 'resid', G.residW, n);
            } else {
                e.copyBufferToBuffer(bS, 0, r, 0, 4 * n);
                pass = e.beginComputePass();
                step(pass, 'zero', G.zeroW, n);
            }
            sumTo(pass, G.dotBb, fins.bb);
            vcycle(pass);
            pass.end();
            e.copyBufferToBuffer(z, 0, p, 0, 4 * n);
            pass = e.beginComputePass();
            sumTo(pass, G.dotRz, fins.rz);
            pass.end();
            device.queue.submit([e.finish()]);
            let it = 0, rr = 0, bb = 0;
            while (it < F.mgMaxIter) {
                e = device.createCommandEncoder();
                pass = e.beginComputePass();
                for (let k = 0; k < F.mgCheck && it < F.mgMaxIter; k++, it++) {
                    step(pass, 'kp', G.kpP, n); step(pass, 'ax', G.ax, n);
                    sumTo(pass, G.dotPq, fins.alpha);
                    step(pass, 'upd1', G.upd1, n);
                    vcycle(pass);
                    sumTo(pass, G.dotRz, fins.beta);
                    step(pass, 'upd2', G.upd2, n);
                }
                sumTo(pass, G.dotRr, fins.rr);
                pass.end();
                device.queue.submit([e.finish()]);
                const Sv = await readS();
                rr = Sv[RR]; bb = Sv[BB];
                if (!(bb > 0) || rr <= F.mgTol * F.mgTol * bb) break;
            }
            if (s0) {
                e = device.createCommandEncoder(); pass = e.beginComputePass();
                step(pass, 'zero', G.zeroOut, nIn); step(pass, 'prolong', G.up, nIn);
                pass.end(); device.queue.submit([e.finish()]);
            }
            return { iterations: it, residual: bb > 0 ? Math.sqrt(rr / bb) : 0 };
        },
        destroy() { for (const b of own) b.destroy(); },
    };
}
