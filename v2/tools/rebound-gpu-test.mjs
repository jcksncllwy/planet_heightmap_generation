// The GPU rebound's microtest (js/gpu/rebound-gpu.js, lane gpuerode M1): two settlings on a real terrain mesh against a float64
// CPU reference of finish-erode.js rebounder's arithmetic, on the mesh itself and through a coarser rung's mesh (`flex`), with
// the rock column moving and the history's uplift discounted; twice each, for determinism; with its time a settling. The f32
// CPU rebounder's own error against the same reference is printed beside it, for scale.
//   node v2/tools/rebound-gpu-test.mjs [--cells 160000] [--coarse 40000] [--reps 3]
// under Dawn (v2/tools/gpu-harness: `npm ci` there first). Exit 1 if a case misses its tolerance or does not repeat itself.
// Tolerances (km, on the settled ground and the rock's top): p99 1e-6 (1 mm), max 5e-6 (5 mm) — float32's step at a few km of
// height is ~0.2 mm, and the blur's passes each round once (the f32 CPU rebounder lands within ~4e-7); the km³ within 1e-5.
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { gpu } from './gpu-harness/dawn.mjs';
import { openDevice, readBack } from '../js/gpu/gpu-device.js';
import { reboundGPU, blurPasses } from '../js/gpu/rebound-gpu.js';
import { ERODE, rebounder, flexOnto } from '../js/finish/finish-erode.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CELLS = +arg('--cells', 160000), COARSE = +arg('--coarse', 40000), REPS = +arg('--reps', 3), TOL = { p99: 1e-6, max: 5e-6, km3: 1e-5 };

let seed = 0x9e3779b9;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** A ground on the mesh (broad continents, km), its sea, an uplift (km/Myr) and two rounds of erosion and deposition to settle. */
function world(mesh) {
    const n = mesh.numCells, { xyz } = mesh, z0 = new Float32Array(n), ocean = new Uint8Array(n), uplift = new Float32Array(n), cut = [new Float32Array(n), new Float32Array(n)], zBed = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        const x = xyz[3 * c], y = xyz[3 * c + 1], w = xyz[3 * c + 2];
        const h = 1.4 * Math.sin(3 * x + 1) * Math.cos(2 * y - 0.5) + 0.8 * Math.sin(5 * w + 2 * x) + 0.3 * Math.sin(17 * y + 11 * w) + 0.02 * rand() - 0.3;
        z0[c] = h; ocean[c] = h < 0 ? 1 : 0; zBed[c] = h - 0.05 - 0.1 * rand();
        uplift[c] = ocean[c] ? 0 : 0.05 * Math.max(0, Math.sin(9 * x - 4 * y));
        // (what the rivers took off (−) or laid on (+): sharp, cell-scale, as erosion is, so the blur has something to smooth)
        for (const k of [0, 1]) cut[k][c] = ocean[c] ? 0 : (rand() < 0.1 ? 0.3 * rand() : -0.08 * rand() * Math.max(0, h));
    }
    return { z0, ocean, uplift, cut, zBed };
}

/** rebounder's arithmetic in float64: two settlings at t = 1 and 3 Myr, the ground cut between them. */
function reference(mesh, W, P, flex) {
    const n = mesh.numCells, a = 4 * Math.PI * 6371 * 6371 / n, z = Float64Array.from(W.z0), bed = Float64Array.from(W.zBed), anchor = Float64Array.from(W.z0), km3 = [];
    const blur = (m, d) => {
        const { passes, w } = blurPasses(m.edgeKm, P.reboundKm), next = new Float64Array(m.numCells);
        for (let p = 0; p < passes; p++) {
            for (let c = 0; c < m.numCells; c++) { let v = 0; const j0 = m.adjOffset[c], j1 = m.adjOffset[c + 1]; for (let j = j0; j < j1; j++) v += d[m.adjList[j]]; next[c] = d[c] + w * (v / (j1 - j0) - d[c]); }
            d.set(next);
        }
    };
    let since = 0;
    for (const [k, at] of [[0, 1], [1, 3]]) {
        for (let c = 0; c < n; c++) z[c] += W.cut[k][c] + W.uplift[c] * (at - since);
        const d = new Float64Array(n);
        for (let c = 0; c < n; c++) if (!W.ocean[c]) d[c] = z[c] - anchor[c] - W.uplift[c] * (at - since);
        since = at;
        if (flex) {
            const m = flex.mesh.numCells, sum = new Float64Array(m), cnt = new Uint32Array(m), dc = new Float64Array(m), { cells, weights, nearest } = flex.map;
            for (let i = 0; i < n; i++) { sum[nearest[i]] += d[i]; cnt[nearest[i]]++; }
            for (let c = 0; c < m; c++) dc[c] = cnt[c] ? sum[c] / cnt[c] : 0;
            blur(flex.mesh, dc);
            for (let i = 0; i < n; i++) d[i] = weights[3 * i] * dc[cells[3 * i]] + weights[3 * i + 1] * dc[cells[3 * i + 1]] + weights[3 * i + 2] * dc[cells[3 * i + 2]];
        } else blur(mesh, d);
        let moved = 0;
        for (let c = 0; c < n; c++) { if (W.ocean[c]) continue; const dz = -P.rebound * d[c]; z[c] += dz; bed[c] += dz; anchor[c] = z[c]; moved += dz * a; }
        km3.push(moved);
    }
    return { z, bed, km3 };
}

/** The same two settlings on the GPU (the ground uploaded as the solver keeps it: cut on this side, settled on the GPU). */
async function onGPU(device, mesh, W, P, flex) {
    const n = mesh.numCells, U = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const buf = arr => { const b = device.createBuffer({ size: arr.byteLength, usage: U }); device.queue.writeBuffer(b, 0, arr); return b; };
    const z = Float32Array.from(W.z0), Kv = new Float32Array(4 * n);
    for (let c = 0; c < n; c++) Kv[4 * c + 1] = W.zBed[c];
    const zB = buf(z), liftB = buf(W.uplift), KvB = buf(Kv), km3 = [], ms = [];
    const R = await reboundGPU(device, { mesh, z: zB, lift: liftB, Kv: KvB, ocean: W.ocean, flex, P });
    let since = 0;
    for (const [k, at] of [[0, 1], [1, 3]]) {
        for (let c = 0; c < n; c++) z[c] += W.cut[k][c] + W.uplift[c] * (at - since);
        since = at;
        device.queue.writeBuffer(zB, 0, z);
        const t = performance.now();
        km3.push(await R.settle(at));
        z.set(await readBack(device, zB));
        ms.push(performance.now() - t);
    }
    const kv = await readBack(device, KvB), bed = new Float32Array(n);
    for (let c = 0; c < n; c++) bed[c] = kv[4 * c + 1];
    R.destroy(); zB.destroy(); liftB.destroy(); KvB.destroy();
    return { z, bed, km3, ms };
}

/** The f32 CPU rebounder (finish-erode.js), the same two settlings: the path the GPU replaces, for scale. */
function onCPU(mesh, W, P, flex) {
    const n = mesh.numCells, z = Float32Array.from(W.z0), column = { zBed: Float32Array.from(W.zBed) }, km3 = [], t0 = performance.now();
    const settle = rebounder(mesh, z, W.ocean, P, column, 0, W.uplift, flex);
    let since = 0;
    for (const [k, at] of [[0, 1], [1, 3]]) { for (let c = 0; c < n; c++) z[c] += W.cut[k][c] + W.uplift[c] * (at - since); since = at; km3.push(settle(at)); }
    return { z, bed: column.zBed, km3, ms: (performance.now() - t0) / 2 };
}

function err(got, ref) {
    const e = Float64Array.from(got, (v, i) => Math.abs(v - ref[i])).sort();
    return { p99: e[Math.floor(0.99 * (e.length - 1))], max: e[e.length - 1] };
}
const same = (A, B) => A.length === B.length && A.every((v, i) => Object.is(v, B[i]));

setDelaunator(Delaunator);
const { device } = await openDevice(gpu);
const fine = terrainMesh(CELLS), coarse = terrainMesh(COARSE);
let failed = 0;
for (const [label, mesh, useFlex] of [[`on its own mesh (${COARSE} cells)`, coarse, false], [`through the coarse rung (${CELLS} on ${COARSE})`, fine, true]]) {
    const P = { ...ERODE, ladder: [{ cells: COARSE, timeMyr: 0.5, steps: 10 }, { timeMyr: 0.1, steps: 2 }] };
    const flex = useFlex ? flexOnto(mesh, P, terrainMesh) : null, W = world(mesh), ref = reference(mesh, W, P, flex);
    const runs = [];
    for (let r = 0; r < REPS; r++) runs.push(await onGPU(device, mesh, W, P, flex));
    const g = runs[0], repeat = runs.every(o => same(o.z, g.z) && same(o.bed, g.bed) && o.km3.every((v, i) => v === g.km3[i]));
    const ez = err(g.z, ref.z), eb = err(g.bed, ref.bed), ek = Math.max(...g.km3.map((v, i) => Math.abs(v - ref.km3[i]) / Math.abs(ref.km3[i])));
    const ok = repeat && Math.max(ez.p99, eb.p99) <= TOL.p99 && Math.max(ez.max, eb.max) <= TOL.max && ek <= TOL.km3;
    if (!ok) failed++;
    const cpu = onCPU(mesh, W, P, flex), cz = err(cpu.z, ref.z), passes = blurPasses((flex ? flex.mesh : mesh).edgeKm, P.reboundKm).passes;
    const tMin = Math.min(...runs.slice(1).flatMap(o => o.ms).concat(runs[0].ms));
    console.log(`${ok ? 'ok  ' : 'FAIL'} rebound ${label}: ground err p99 ${ez.p99.toExponential(2)} max ${ez.max.toExponential(2)} · rock top p99 ${eb.p99.toExponential(2)} max ${eb.max.toExponential(2)} km (tol ${TOL.p99}/${TOL.max}) · km³ rel ${ek.toExponential(2)} (tol ${TOL.km3}) · repeats ${repeat} · ${passes} passes · ${tMin.toFixed(1)} ms a settling (incl. upload + readback)`);
    console.log(`     (f32 CPU rebounder, for scale: ground err p99 ${cz.p99.toExponential(2)} max ${cz.max.toExponential(2)} km · ${cpu.ms.toFixed(0)} ms a settling · km³ ${ref.km3.map(v => v.toFixed(0)).join(', ')})`);
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
