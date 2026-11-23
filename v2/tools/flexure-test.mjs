// The thin plate's tests (gpu/flexure.js, gpu/flexure-gpu.js, gpu/rebound-gpu.js; lane flexure, 2026-11-22):
//   1. the float64 CPU solve against the plate's analytic solutions on a uniform plate (Te 70 km on the 640K mesh: α 139 km,
//      4.6 cells), a load in one cell (w = P l²/2πD · −kei(r/l), l = (D/Δρg)^¼ = α/√2: Hetényi 1946; Brotchie & Silvester
//      1969) and a load along a great circle (w = w₀ e^(−x/α)(cos x/α + sin x/α), w₀ = V α³/8D: the forebulge at πα, its
//      height e^(−π) w₀ = 4.3 % — Turcotte & Schubert 3-127). Tolerances: the point load's profile within 3 % of w₀ beyond its
//      own cell, its forebulge's crest within ½ l and its height within 10 %; the line's w₀ within 3 %, its zero (3πα/4) within
//      3 %, its forebulge's crest within 5 % and height within 10 % (the mesh's Laplacian is second order: (h/α)² ≈ 5 %, and
//      the load lies on a band one cell wide, not a line);
//   1b. the coarse rung (--cells): a one-cell load's 1st and 2nd rings against the disk-load −kei (no checkerboard), and a
//      broad load (Gaussian σ 100 km) against the Hankel analytic;
//   2. the GPU's MG-CG against the float64 solve, with Te varying (the history's ~110 km cells, carried in log as finish.js
//      does) and half the planet sea: max |Δw| within 1e-3 of max |w| (f32 and mgTol 1e-5), twice bit for bit;
//   3. the GPU rebounder against the float64 rebounder (finish-erode.js), two settlings with the history's uplift discounted
//      and the rock's top moving: the ground and the rock's top within 1e-4 km max, twice bit for bit.
//   node v2/tools/flexure-test.mjs [--cells 160000] [--analytic 640000] [--reps 2]
// under Dawn (v2/tools/gpu-harness: `npm ci` there first). Exit 1 if a case misses its tolerance or does not repeat itself.
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { gpu } from './gpu-harness/dawn.mjs';
import { openDevice, readBack } from '../js/gpu/gpu-device.js';
import { FLEX, flexuralLengthKm, stiffnessKm4, solvePlateCPU, plateOperator, seaLoadShare } from '../js/gpu/flexure.js';
import { plateSolverGPU } from '../js/gpu/flexure-gpu.js';
import { reboundGPU, zBedBack } from '../js/gpu/rebound-gpu.js';
import { ERODE, rebounder } from '../js/finish/finish-erode.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { mapOnto } from '../js/core/mesh-maps.js';

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CELLS = +arg('--cells', 160000), ANALYTIC = +arg('--analytic', 640000), REPS = +arg('--reps', 2), R = 6371;
setDelaunator(Delaunator);
let failed = 0;
const line = (ok, text) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); };
const same = (A, B) => A.length === B.length && A.every((v, i) => Object.is(v, B[i]));

/** kei(x), the Kelvin function (Abramowitz & Stegun 9.9.12), by its series: float64 holds to x ≈ 10. */
function kei(x) {
    const q = x * x / 4, g = 0.5772156649015329;
    let ber = 0, bei = 0, sum = 0, f2k = 1, H = 0;
    for (let k = 0; k < 30; k++) {
        const f2k1 = f2k * (2 * k + 1), sg = k % 2 ? -1 : 1;
        H += 1 / (2 * k + 1) + (k > 0 ? 1 / (2 * k) : 0);
        ber += sg * Math.pow(q, 2 * k) / (f2k * f2k);
        bei += sg * Math.pow(q, 2 * k + 1) / (f2k1 * f2k1);
        sum += sg * (H - g) * Math.pow(q, 2 * k + 1) / (f2k1 * f2k1);
        f2k = f2k1 * (2 * k + 2);
    }
    return -Math.log(x / 2) * bei - Math.PI / 4 * ber + sum;
}

// ── 1. the float64 solve against the analytic plate ──
{
    const mesh = terrainMesh(ANALYTIC), n = mesh.numCells, { xyz } = mesh, op = plateOperator(mesh), TE = 70;
    const alpha = flexuralLengthKm(TE), l = alpha / Math.SQRT2, Bk = stiffnessKm4(TE), B = new Float64Array(n).fill(Bk), s = new Float64Array(n).fill(1);
    // (a load in one cell: P = ℓ M, w₀ = P l² / 8B)
    const c0 = 12345, P = 1000, load = new Float64Array(n);
    load[c0] = P / op.M[c0];
    const t0 = performance.now(), pt = solvePlateCPU(mesh, B, s, load, { tol: 1e-9 });
    const w0 = P * l * l / (8 * Bk), x0 = [xyz[3 * c0], xyz[3 * c0 + 1], xyz[3 * c0 + 2]], bins = new Map();
    for (let c = 0; c < n; c++) {
        const r = R * Math.acos(Math.min(1, x0[0] * xyz[3 * c] + x0[1] * xyz[3 * c + 1] + x0[2] * xyz[3 * c + 2])) / l;
        if (r * l < 1.5 * mesh.edgeKm || r > 8) continue;
        const b = Math.round(r * 4) / 4, e = bins.get(b) ?? [0, 0];
        e[0] += pt.w[c]; e[1]++; bins.set(b, e);
    }
    let worst = 0, meshMin = [0, Infinity], kMin = [0, Infinity];
    for (const [b, [sum, k]] of bins) {
        const got = sum / k / w0, want = -kei(b) * 4 / Math.PI;
        worst = Math.max(worst, Math.abs(got - want));
        if (got < meshMin[1]) meshMin = [b, got];
    }
    for (let x = 3; x <= 7; x += 0.001) { const v = -kei(x) * 4 / Math.PI; if (v < kMin[1]) kMin = [x, v]; }
    line(worst <= 0.03 && Math.abs(meshMin[0] - kMin[0]) <= 0.5 && Math.abs(meshMin[1] / kMin[1] - 1) <= 0.1,
        `point load, Te ${TE} (α ${alpha.toFixed(0)} km, ${(alpha / mesh.edgeKm).toFixed(1)} cells): profile within ${(100 * worst).toFixed(1)} % of w₀ (tol 3) · forebulge at ${meshMin[0].toFixed(2)} l vs ${kMin[0].toFixed(2)} (tol ½) · height ${(100 * meshMin[1]).toFixed(2)} % vs ${(100 * kMin[1]).toFixed(2)} % of w₀ (tol 10 %) · ${pt.iterations} CG iterations, ${((performance.now() - t0) / 1000).toFixed(1)} s`);

    // (a band one cell wide along the equator of z: V per km of it)
    const band = new Float64Array(n), h = mesh.edgeKm;
    let vol = 0;
    for (let c = 0; c < n; c++) if (Math.abs(R * Math.asin(xyz[3 * c + 2])) < h / 2) { band[c] = 1; vol += op.M[c]; }
    const V = vol / (2 * Math.PI * R), ln = solvePlateCPU(mesh, B, s, band, { tol: 1e-9 }), W0 = V * alpha ** 3 / (8 * Bk), prof = new Map();
    for (let c = 0; c < n; c++) {
        const x = Math.abs(R * Math.asin(xyz[3 * c + 2])), b = Math.round(x / (0.05 * alpha));
        if (x > 5 * alpha) continue;
        const e = prof.get(b) ?? [0, 0];
        e[0] += ln.w[c]; e[1]++; prof.set(b, e);
    }
    const rows = [...prof.entries()].sort((a, b) => a[0] - b[0]).map(([b, [sum, k]]) => [b * 0.05 * alpha, sum / k]);
    let zero = NaN, bulge = [0, Infinity];
    for (let i = 1; i < rows.length; i++) {
        if (zero !== zero && rows[i][1] <= 0 && rows[i - 1][1] > 0) zero = rows[i - 1][0] + (rows[i][0] - rows[i - 1][0]) * rows[i - 1][1] / (rows[i - 1][1] - rows[i][1]);
        if (rows[i][1] < bulge[1]) bulge = rows[i];
    }
    const top = rows[0][1], hb = -bulge[1] / W0, want = Math.exp(-Math.PI);
    line(Math.abs(top / W0 - 1) <= 0.03 && Math.abs(zero / (0.75 * Math.PI * alpha) - 1) <= 0.03 && Math.abs(bulge[0] / (Math.PI * alpha) - 1) <= 0.05 && Math.abs(hb / want - 1) <= 0.1,
        `line load, Te ${TE}: w₀ ${(top / W0).toFixed(3)} of V α³/8D (tol 3 %) · zero at ${(zero / alpha).toFixed(3)} α vs 3π/4 = ${(0.75 * Math.PI).toFixed(3)} (tol 3 %) · forebulge at ${(bulge[0] / alpha).toFixed(2)} α vs π (tol 5 %), ${(100 * hb).toFixed(2)} % of w₀ vs ${(100 * want).toFixed(2)} (tol 10 %) · ${ln.iterations} CG iterations`);
}

// ── 1b. the coarse rung's plate (the ladder's 160K, where the window's most time runs): a load in one cell and broad loads ──
// A checkerboard mode in a discrete biharmonic shows as w changing sign from ring to ring about a one-cell load; there is
// none here where the plate is resolved (l ≥ the cell: Te 70 on 160K, both rings within 10 % of the disk-load −kei, all down).
// What the mesh does miss is the load cell's own share when l < h (lumped mass, the Laplacian's symbol under k² at the grid's
// scale): 1.7× the analytic cell mean at Te 15 on 160K, 1.35× on 640K, 1.06× at Te 70 on 640K (lane flexure, 2026-11-23,
// flexure/r/checker-*.log) — a grid-scale load is answered more locally than the plate would; a load as broad as a massif
// (a Gaussian of σ 100 km, the Hankel analytic w(0) = σ² ∫ e^(−k²σ²/2)/(1 + l⁴k⁴) k dk) is within 3 % at every Te.
{
    const mesh = terrainMesh(CELLS), n = mesh.numCells, { xyz, adjOffset, adjList } = mesh, op = plateOperator(mesh), s = new Float64Array(n).fill(1), c0 = 12345;
    const dist = c => R * Math.acos(Math.min(1, xyz[3 * c0] * xyz[3 * c] + xyz[3 * c0 + 1] * xyz[3 * c + 1] + xyz[3 * c0 + 2] * xyz[3 * c + 2]));
    const diskW = (r, A, l) => {           // (w at r of a unit volume spread evenly over a disk of area A)
        const a = Math.sqrt(A / Math.PI), N = 60;
        let v = 0;
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const rr = a * Math.sqrt((i + 0.5) / N), th = 2 * Math.PI * (j + 0.5) / N, d = Math.hypot(r - rr * Math.cos(th), rr * Math.sin(th)) / l; v += d > 10 ? 0 : -kei(d || 1e-9); }
        return v / (N * N) / (2 * Math.PI * l * l);
    };
    {
        const TE = 70, l = flexuralLengthKm(TE) / Math.SQRT2, B = new Float64Array(n).fill(stiffnessKm4(TE)), load = new Float64Array(n);
        load[c0] = 1 / op.M[c0];
        const { w } = solvePlateCPU(mesh, B, s, load, { tol: 1e-10 }), r1 = new Set(), r2 = new Set();
        for (let j = adjOffset[c0]; j < adjOffset[c0 + 1]; j++) r1.add(adjList[j]);
        for (const a of r1) for (let j = adjOffset[a]; j < adjOffset[a + 1]; j++) if (adjList[j] !== c0 && !r1.has(adjList[j])) r2.add(adjList[j]);
        const ring = S => { let got = 0, want = 0, up = 0; for (const c of S) { got += w[c]; want += diskW(dist(c), op.M[c0], l); if (w[c] <= 0) up++; } return { e: got / want - 1, up }; };
        const a = ring(r1), b = ring(r2);
        line(!a.up && !b.up && Math.abs(a.e) <= 0.1 && Math.abs(b.e) <= 0.1,
            `one cell's load, Te ${TE} on ${n} cells (l ${(l / mesh.edgeKm).toFixed(2)} cells): 1st ring ${a.up ? a.up + ' cells up' : 'all down'}, mean ${(100 * a.e).toFixed(1)} % off −kei · 2nd ring ${b.up ? b.up + ' cells up' : 'all down'}, ${(100 * b.e).toFixed(1)} % (tol 10 %; no checkerboard)`);
    }
    const out = []; let worst = 0;
    for (const TE of [15, 30, 70]) {
        const l = flexuralLengthKm(TE) / Math.SQRT2, B = new Float64Array(n).fill(stiffnessKm4(TE)), sg = 100, load = new Float64Array(n);
        for (let c = 0; c < n; c++) { const d = dist(c); load[c] = Math.exp(-d * d / (2 * sg * sg)); }
        const { w } = solvePlateCPU(mesh, B, s, load, { tol: 1e-10 });
        let a = 0; const dk = 1e-4; for (let k = dk / 2; k < 0.5; k += dk) a += Math.exp(-k * k * sg * sg / 2) / (1 + l ** 4 * k ** 4) * k * dk; a *= sg * sg;
        worst = Math.max(worst, Math.abs(w[c0] / a - 1)); out.push(`Te ${TE} ${w[c0].toFixed(3)} vs ${a.toFixed(3)}`);
    }
    line(worst <= 0.03, `a broad load (Gaussian σ 100 km) on ${n} cells: w(0) per unit load ${out.join(' · ')} — worst ${(100 * worst).toFixed(1)} % (tol 3 %)`);
}

// ── a test world on the GPU's mesh: Te on a 40K mesh (craton, continent, arc, sea floor by "age") carried in log; sea half ──
const { device } = await openDevice(gpu);
const mesh = terrainMesh(CELLS), n = mesh.numCells, { xyz } = mesh;
function world() {
    const sim = terrainMesh(40000), ts = new Float32Array(sim.numCells);
    for (let c = 0; c < sim.numCells; c++) {
        const x = sim.xyz[3 * c], y = sim.xyz[3 * c + 1], z = sim.xyz[3 * c + 2];
        ts[c] = z > 0.6 ? FLEX.cratonTeKm : z > 0 ? (Math.sin(7 * x + 3 * y) > 0.7 ? FLEX.arcTeKm : FLEX.continentTeKm) : 2 + 27 * Math.min(1, Math.abs(Math.sin(4 * x - 2 * y)));
    }
    const M = mapOnto(sim, mesh), te = new Float32Array(n), ocean = new Uint8Array(n), load = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        te[i] = Math.exp(M.weights[3 * i] * Math.log(ts[M.cells[3 * i]]) + M.weights[3 * i + 1] * Math.log(ts[M.cells[3 * i + 1]]) + M.weights[3 * i + 2] * Math.log(ts[M.cells[3 * i + 2]]));
        const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
        ocean[i] = z < 0 ? 1 : 0;
        // (valleys cut, a range worn down, a delta laid: a few hundred m, narrow and broad)
        load[i] = -0.3 * Math.max(0, Math.sin(31 * x + 17 * y)) * Math.max(0, Math.sin(23 * z + 5 * x)) - (Math.abs(x - 0.2) < 0.01 ? 0.5 : 0) + (ocean[i] && Math.abs(z + 0.05) < 0.03 ? 0.4 : 0);
    }
    return { te, ocean, load };
}
const W = world();

// ── 2. the GPU's MG-CG against the float64 solve ──
{
    const sea = (FLEX.mantleRho - FLEX.waterRho) / FLEX.mantleRho, op = plateOperator(mesh);
    const B = Float64Array.from(W.te, t => stiffnessKm4(t)), s = Float64Array.from(W.ocean, o => (o ? sea : 1));
    const t0 = performance.now(), ref = solvePlateCPU(mesh, B, s, W.load, { tol: 1e-10 }), tRef = performance.now() - t0;
    const plate = await plateSolverGPU(device, { mesh, te: W.te, meshOf: terrainMesh });
    plate.setOcean(W.ocean);
    const b = Float32Array.from(W.load, (v, c) => v * op.M[c]), runs = [];
    for (let r = 0; r < REPS; r++) {
        device.queue.writeBuffer(plate.b, 0, b);
        const t = performance.now(), it = await plate.solve(), w = await readBack(device, plate.w);
        runs.push({ w, it, ms: performance.now() - t });
    }
    plate.destroy();
    let mx = 0, e = 0;
    const errs = new Float64Array(n);
    for (let c = 0; c < n; c++) { mx = Math.max(mx, Math.abs(ref.w[c])); errs[c] = Math.abs(runs[0].w[c] - ref.w[c]); e = Math.max(e, errs[c]); }
    errs.sort();
    const repeat = runs.every(o => same(o.w, runs[0].w) && o.it.iterations === runs[0].it.iterations);
    line(e <= 1e-3 * mx && repeat, `plate solve on the GPU (${n} cells, levels ${plate.levels.join(' / ')}): max |Δw| ${(e / mx).toExponential(2)} of max |w| ${mx.toFixed(3)} km (tol 1e-3), p99 ${(errs[Math.floor(0.99 * (n - 1))] / mx).toExponential(2)} · ${runs[0].it.iterations} MG-CG iterations to ${runs[0].it.residual.toExponential(1)} · repeats ${repeat} · ${Math.min(...runs.map(o => o.ms)).toFixed(0)} ms a solve (float64 CPU: ${ref.iterations} CG iterations, ${(tRef / 1000).toFixed(1)} s)`);
}

// ── 3. the GPU rebounder against the float64 rebounder ──
{
    const P = { ...ERODE }, z0 = new Float32Array(n), uplift = new Float32Array(n), zBed = new Float32Array(n), cut = [new Float32Array(n), new Float32Array(n)];
    for (let c = 0; c < n; c++) {
        const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
        z0[c] = W.ocean[c] ? -2 - Math.abs(z) : 0.5 + 1.5 * Math.max(0, Math.sin(9 * x - 4 * y)); zBed[c] = z0[c] - 0.05;
        uplift[c] = W.ocean[c] ? 0 : 0.05 * Math.max(0, Math.sin(9 * x - 4 * y));
        cut[0][c] = W.load[c]; cut[1][c] = 0.5 * W.load[c] * Math.cos(5 * y);
    }
    const ref = (() => {
        const z = Float64Array.from(z0), column = { zBed: Float64Array.from(zBed) }, settle = rebounder(mesh, z, W.ocean, P, column, 0, uplift, W.te), km3 = [];
        let since = 0;
        for (const [k, at] of [[0, 1], [1, 3]]) { for (let c = 0; c < n; c++) z[c] += cut[k][c] + uplift[c] * (at - since); since = at; km3.push(settle(at)); }
        return { z, bed: column.zBed, km3 };
    })();
    const runs = [];
    for (let r = 0; r < REPS; r++) {
        const U = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, mk = arr => { const b = device.createBuffer({ size: arr.byteLength, usage: U }); device.queue.writeBuffer(b, 0, arr); return b; };
        const Kv = new Float32Array(4 * n);
        for (let c = 0; c < n; c++) Kv[4 * c + 1] = zBed[c];
        const z = z0.slice(), zB = mk(z), liftB = mk(uplift), KvB = mk(Kv), column = { zBed: new Float32Array(n) };
        const R_ = await reboundGPU(device, { mesh, z: zB, lift: liftB, Kv: KvB, ocean: W.ocean, te: W.te, P }), km3 = [];
        let since = 0;
        const t = performance.now();
        for (const [k, at] of [[0, 1], [1, 3]]) { for (let c = 0; c < n; c++) z[c] += cut[k][c] + uplift[c] * (at - since); since = at; device.queue.writeBuffer(zB, 0, z); km3.push(await R_.settle(at)); z.set(await readBack(device, zB)); }
        await zBedBack(device, KvB, column);
        runs.push({ z, bed: column.zBed, km3, ms: (performance.now() - t) / 2, it: R_.last.maxIterations });
        R_.destroy(); for (const b of [zB, liftB, KvB]) b.destroy();
    }
    let ez = 0, eb = 0;
    for (let c = 0; c < n; c++) { ez = Math.max(ez, Math.abs(runs[0].z[c] - ref.z[c])); eb = Math.max(eb, Math.abs(runs[0].bed[c] - ref.bed[c])); }
    const repeat = runs.every(o => same(o.z, runs[0].z) && same(o.bed, runs[0].bed) && o.km3.every((v, i) => v === runs[0].km3[i]));
    line(ez <= 1e-4 && eb <= 1e-4 && repeat, `rebound on the GPU (${n} cells, land ${ERODE.rebound} and sea ${seaLoadShare().toFixed(3)} shares): ground max err ${ez.toExponential(2)} km, rock top ${eb.toExponential(2)} (tol 1e-4) · km³ ${runs[0].km3.map(v => v.toFixed(0)).join(', ')} vs ${ref.km3.map(v => v.toFixed(0)).join(', ')} · repeats ${repeat} · ≤ ${runs[0].it} iterations · ${Math.min(...runs.map(o => o.ms)).toFixed(0)} ms a settling (incl. upload + readback)`);
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
