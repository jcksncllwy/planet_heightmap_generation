// The fluvial kernels' microtest (js/gpu/fluvial-kernels.js): each kernel on the GPU against its float64 CPU reference, on
// one mesh, twice for determinism, with its time a call. A synthetic sphere patch by default; a gpu-capture.mjs fixture's
// mesh and ground with --fixture, routed by a priority flood (see ROUTE below).
//   node v2/tools/fluvial-kernels-test.mjs [--side 400] [--fixture DIR --run 0] [--route flood|steepest] [--reps 3]
// under Dawn (v2/tools/gpu-harness: `npm ci` there first). Exit 1 if a kernel misses its tolerance or does not repeat itself.
import fs from 'node:fs';
import path from 'node:path';
import { gpu } from './gpu-harness/dawn.mjs';
import { openDevice } from '../js/gpu/gpu-device.js';
import { fluvialKernels, reference } from '../js/gpu/fluvial-kernels.js';

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const REPS = +arg('--reps', 3);

// a reproducible stream (mulberry32): the test's numbers are the same every run
let seed = 0x9e3779b9;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** A side × side lat-lon patch at the equator, ~15 km apart, 8 neighbours; its ground: broad hills, noise, a sea. */
function synthetic(side) {
    const n = side * side, step = 15 / 6371, xyz = new Float32Array(3 * n), z = new Float32Array(n), off = new Uint32Array(n + 1), list = [];
    for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) {
        const c = i * side + j, lat = (i - side / 2) * step, lon = (j - side / 2) * step;
        xyz[3 * c] = Math.cos(lat) * Math.cos(lon); xyz[3 * c + 1] = Math.cos(lat) * Math.sin(lon); xyz[3 * c + 2] = Math.sin(lat);
        z[c] = 1.2 * Math.sin(i / 37) * Math.cos(j / 53) + 0.6 * Math.sin((i + 2 * j) / 19) + 0.05 * rand() - 0.2;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
            const a = i + di, b = j + dj;
            if ((di || dj) && a >= 0 && b >= 0 && a < side && b < side) list.push(a * side + b);
        }
        off[c + 1] = list.length;
    }
    return { mesh: { numCells: n, adjOffset: off, adjList: Uint32Array.from(list), xyz }, z, land: Uint32Array.from(z, v => (v > 0 ? 1 : 0)), name: `synthetic ${side}²` };
}

function fixture(dir, id) {
    const read = (f, T) => { const b = fs.readFileSync(f); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
    const TYPES = { Int32Array, Uint32Array, Float32Array, Float64Array };
    const R = JSON.parse(fs.readFileSync(path.join(dir, `run${id}`, 'run.json'))), m = path.join(dir, `mesh${R.n}`), J = JSON.parse(fs.readFileSync(path.join(m, 'mesh.json')));
    const mesh = { numCells: J.numCells, adjOffset: read(path.join(m, 'adjOffset.bin'), TYPES[J.offType]), adjList: read(path.join(m, 'adjList.bin'), TYPES[J.adjType]), xyz: read(path.join(m, 'xyz.bin'), TYPES[J.xyzType]) };
    const z = read(path.join(dir, `run${id}`, 'z.bin'), Float32Array), ocean = read(path.join(dir, `run${id}`, 'ocean.bin'), Uint8Array);
    return { mesh, z, land: Uint32Array.from(ocean, o => (o ? 0 : 1)), name: `fixture ${path.basename(dir)} run${id} (${J.numCells} cells)` };
}

const { mesh, z, land, name } = argv.includes('--fixture') ? fixture(arg('--fixture'), +arg('--run', 0)) : synthetic(+arg('--side', 400));
const n = mesh.numCells;

// The tree every kernel runs on. --route flood (the default): a priority flood from the sea (the patch's edge where it has
// none), each land cell draining to the cell that flooded it, so depressions route through their spill and flats toward
// it, as the finish's depression routing does: real trees, hundreds of levels deep. Its lakes: where the fill stands above
// the ground. --route steepest: steepest descent on the raw ground, every pit its own root (shallow trees).
const ROUTE = arg('--route', 'flood'), recv = new Uint32Array(n), fill = Float32Array.from(z);
if (ROUTE === 'steepest') for (let c = 0; c < n; c++) {
    let best = c, bz = z[c];
    for (let j = mesh.adjOffset[c]; j < mesh.adjOffset[c + 1]; j++) { const y = mesh.adjList[j]; if (z[y] < bz || (z[y] === bz && y < best)) { bz = z[y]; best = y; } }
    recv[c] = best;
} else {
    const heapZ = [], heapC = [], seen = new Uint8Array(n);
    const push = (zz, c) => { let i = heapZ.length; heapZ.push(zz); heapC.push(c); while (i > 0) { const p = (i - 1) >> 1; if (heapZ[p] < zz || (heapZ[p] === zz && heapC[p] < c)) break; heapZ[i] = heapZ[p]; heapC[i] = heapC[p]; i = p; } heapZ[i] = zz; heapC[i] = c; };
    const pop = () => { const c = heapC[0], lz = heapZ.pop(), lc = heapC.pop(), m = heapZ.length; if (m) { let i = 0; for (;;) { let k = 2 * i + 1; if (k >= m) break; if (k + 1 < m && (heapZ[k + 1] < heapZ[k] || (heapZ[k + 1] === heapZ[k] && heapC[k + 1] < heapC[k]))) k++; if (lz < heapZ[k] || (lz === heapZ[k] && lc < heapC[k])) break; heapZ[i] = heapZ[k]; heapC[i] = heapC[k]; i = k; } heapZ[i] = lz; heapC[i] = lc; } return c; };
    let seeds = 0;
    for (let c = 0; c < n; c++) if (!land[c]) { recv[c] = c; seen[c] = 1; push(z[c], c); seeds++; }
    if (!seeds) for (let c = 0; c < n; c++) if (mesh.adjOffset[c + 1] - mesh.adjOffset[c] < 8) { recv[c] = c; seen[c] = 1; push(z[c], c); }
    while (heapZ.length) {
        const c = pop();
        for (let j = mesh.adjOffset[c]; j < mesh.adjOffset[c + 1]; j++) { const y = mesh.adjList[j]; if (seen[y]) continue; seen[y] = 1; recv[y] = c; fill[y] = Math.max(z[y], fill[c]); push(fill[y], y); }
    }
    for (let c = 0; c < n; c++) if (!seen[c]) recv[c] = c;          // (cut off from every seed: its own root)
}
let depthMax = 0;
{
    const depth = new Int32Array(n).fill(-1);
    for (let c0 = 0; c0 < n; c0++) {
        const chain = []; let c = c0;
        while (depth[c] < 0 && recv[c] !== c) { chain.push(c); c = recv[c]; }
        if (depth[c] < 0) depth[c] = 0;
        for (let k = chain.length - 1, d = depth[c]; k >= 0; k--) depth[chain[k]] = ++d;
    }
    for (let c = 0; c < n; c++) depthMax = Math.max(depthMax, depth[c]);
}

const { device, info } = await openDevice(gpu);
const K = await fluvialKernels(device, mesh);
console.log(`${name}, route ${ROUTE}: n ${n}, lakes ${fill.filter((f, c) => f > z[c] + 1e-5).length}, max degree ${K.W}, tree depth ${depthMax}, ${info?.vendor ?? ''} ${info?.architecture ?? ''} ${info?.description ?? ''}`.trim());

const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const q = (xs, p) => { const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
let failed = 0;
/** Run `go` REPS times (the first warms up), check it repeats itself, compare its result to the reference. */
async function check(label, go, ref, err, tol) {
    const outs = [], ms = [];
    for (let r = 0; r < REPS; r++) { const d0 = K.stats.dispatches, t = performance.now(); outs.push(await go()); ms.push({ t: performance.now() - t, d: K.stats.dispatches - d0 }); }
    const res = outs.map(o => o.out ?? o), repeat = res.every(o => same(o, res[0]));
    const e = err(res[0], ref), ok = repeat && e.p99 <= tol.p99 && e.max <= tol.max;
    if (!ok) failed++;
    const t = ms.slice(1).map(m => m.t), tMin = t.length ? Math.min(...t) : ms[0].t;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: err p99 ${e.p99.toExponential(2)} max ${e.max.toExponential(2)} (tol ${tol.p99}/${tol.max}) · repeats ${repeat} · ${tMin.toFixed(1)} ms a call (incl. upload + readback) · ${ms.at(-1).d} dispatches${outs[0].note ? ' · ' + outs[0].note : ''}`);
}
const absErr = (g, r) => { const d = new Float64Array(n); for (let c = 0; c < n; c++) d[c] = Math.abs(g[c] - r[c]); return { p99: q(d, 0.99), max: q(d, 1) }; };
const relErr = (g, r) => { const d = new Float64Array(n); for (let c = 0; c < n; c++) d[c] = Math.abs(g[c] - r[c]) / Math.max(1e-30, Math.abs(r[c])); return { p99: q(d, 0.99), max: q(d, 1) }; };

// 1. the max-affine solve: a stream-power step (F = K·dt/Δx spread over four decades), lakes where the flood filled (a tenth
// of the cells at random under --route steepest)
{
    const a = new Float32Array(n).fill(-Infinity), alpha = new Float32Array(n), beta = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        const old = z[c] + 0.01 * rand();
        if (ROUTE === 'flood' ? fill[c] > z[c] + 1e-5 : rand() < 0.1) { a[c] = old; alpha[c] = 0; beta[c] = 1; continue; }
        const F = 10 ** (4 * rand() - 2); alpha[c] = old / (1 + F); beta[c] = F / (1 + F);
    }
    const job = { recv, a, alpha, beta, h0: z };
    const ref = reference.solveAffine(job);
    await check('solveAffine', () => K.solveAffine(job), ref, absErr, { p99: 1e-5, max: 1e-3 });
}
// 2. drainage: cell area × a runoff spread over a decade
{
    const w = Float32Array.from({ length: n }, () => 200 * (0.1 + rand()));
    const ref = reference.drainage({ recv, w });
    await check('drainage', async () => { const r = await K.drainage({ recv, w }); return { out: r.sum, note: `${r.passes} passes` }; }, ref, relErr, { p99: 1e-5, max: 1e-3 });
}
// 3. threshold diffusion: a smoothing D (to exercise the solve), then the physical one (D = 0.01 m²/yr = 0.01 km²/Myr,
// Fernandes & Dietrich 1997; S_c 1.25, Roering et al. 1999) over 10 Myr, to measure what it does at this cell size
for (const [label, D] of [['diffuse D 50', 50], ['diffuse D 0.01 (physical)', 0.01]]) {
    const job = { z, land, dt: 10, D, Sc: 1.25, sweeps: 30 };
    const ref = reference.diffuse(mesh, job);
    let moved = 0; for (let c = 0; c < n; c++) moved = Math.max(moved, Math.abs(ref[c] - z[c]));
    await check(label, async () => ({ out: await K.diffuse(job), note: `the reference moves the ground ≤ ${(moved * 1000).toFixed(2)} m` }), ref, absErr, { p99: 1e-5, max: 1e-4 });
}

K.destroy();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
