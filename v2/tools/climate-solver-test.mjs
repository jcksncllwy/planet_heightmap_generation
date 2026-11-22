// The GPU climate solver's test (js/gpu/climate-solver.js, lane gpuclimate): the whole climate — planetClimate's stages —
// with every solve on the GPU (float32) against the same climate solved on the CPU in float64 with the GPU's algorithm
// (climate/solver.js: the zebra smoother, the deep hierarchy, the coarsest level exact, every solve converged), and the GPU
// run twice, for determinism.
//   node v2/tools/climate-solver-test.mjs [--world test|earth|finish:<key>] [--cells 160000] [--reps 2]
// under Dawn (v2/tools/gpu-harness: `npm ci` there first). Worlds: `test` the climate-cells-test ground (continents, a 6 km
// range past the ice line, a sunk basin); `earth` Earth's own surface (tuning/climate's mesh of the ETOPO picture); a
// finished moment from the finish cache (tools/lib/finish-cache.mjs; its key). Exit 1 if a tolerance is missed or the GPU
// doesn't repeat itself.
// Tolerances (float32 against float64, each converged to CONVERGED_TOL), set against the float64 climate's own noise — the
// reference against itself solved to 3e-6 (--control): |ΔT| mean 4e-5–6e-5 °C, 99.9th percentile 2e-3, max 0.04–0.07 °C,
// |ΔP|/P max 0.04–0.07, Köppen 0–15 cells (test, Earth, 716130@600). Float32, where no ice decision flips (Earth, 831576@430,
// 12345@560): the same mean, p99.9 2e-3–8e-3 °C. Where one does (test: 1 sea-ice cell-month and 2 ice-sheet cells;
// 716130@600: 6 sea-ice cell-months), the flipped cell's albedo moves its region by hundredths: mean 3e-4, p99.9 0.015–0.027,
// max 0.3–0.6 °C. So the bulk is held tight, the tail to the flips' reach, and the decisions themselves counted:
//   · months: |ΔT| mean ≤ 1e-3 °C, 99.9th percentile ≤ 0.05 °C, max ≤ 1 °C; |ΔP| as a share of max(1 mm, P): mean ≤ 1e-3,
//     99.9th percentile ≤ 0.02, max ≤ 0.25;
//   · the decisions — the snow and ice albedo feedback can carry a hair across a threshold and grow it: sea ice (a month's
//     ice ≥ ½) on ≤ 1e-3 of the sea's cell-months, the ice sheets (perennial ≥ ½) on ≤ 1e-3 of the land's cells, and
//     Köppen per terrain cell — every class, the ice caps (EF) and the deserts (BW) — on ≤ 1e-3 of the land.
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { gpu } from './gpu-harness/dawn.mjs';
import { openDevice } from '../js/gpu/gpu-device.js';
import { climateSolverKit } from '../js/gpu/climate-solver.js';
import { HelmholtzSolver } from '../js/climate/solver.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { planetClimate, planetClimateAsync } from '../js/climate/climate.js';
import { KOPPEN_CLASSES as KOPPEN } from '../js/climate/koppen.js';

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CELLS = +arg('--cells', 160000), REPS = +arg('--reps', 2), WORLD = arg('--world', 'test');
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
setDelaunator(Delaunator);

async function world(name) {
    if (name === 'earth') {
        const { loadEarthGrayscale } = await import('../../tuning/climate/lib/earth-context.mjs');
        const { buildEarthMesh } = await import('../../tuning/climate/lib/earth-mesh.mjs');
        const { elevToHeightKm } = await import('../../js/color-map.js');
        const { gray, width, height } = loadEarthGrayscale();
        const e = buildEarthMesh(gray, width, height, { N: CELLS }), z = new Float32Array(e.mesh.numRegions);
        for (let r = 0; r < z.length; r++) z[r] = elevToHeightKm(e.r_elevation[r]);
        return { xyz: e.r_xyz, elevKm: z, axes: 'y-up' };
    }
    if (name.startsWith('finish:')) {
        const { loadFinish } = await import('./lib/finish-cache.mjs');
        const f = await loadFinish(name.slice(7), { cells: true, mesh: true });
        if (!f) throw new Error(`no finished moment ${name.slice(7)} in the finish cache`);
        const n = f.mesh.numCells, land = new Uint8Array(n);
        for (let c = 0; c < n; c++) land[c] = f.cells.ocean[c] ? 0 : 1;
        return { xyz: f.mesh.xyz, elevKm: f.cells.z, axes: 'z-up', land };
    }
    const mesh = terrainMesh(CELLS), n = mesh.numCells, { xyz } = mesh;
    const z = new Float32Array(n), land = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
        const x = xyz[3 * c], y = xyz[3 * c + 1], w = xyz[3 * c + 2];
        let h = 1.2 * Math.sin(3 * x + 1) * Math.cos(2 * y - 0.5) + 0.7 * Math.sin(5 * w + 2 * x) + 0.25 * Math.sin(17 * y + 11 * w) - 0.35;
        h += 5 * Math.max(0, 1 - 30 * ((w - 0.5) ** 2 + (x - 0.6) ** 2));
        const basin = (x + 0.3) ** 2 + (y - 0.8) ** 2 + (w - 0.2) ** 2;
        if (basin < 0.01 && h > 0) h = -0.4 * (1 - basin / 0.01) + 0.05;
        z[c] = h; land[c] = h > 0 || basin < 0.01 ? 1 : 0;
    }
    return { xyz, elevKm: z, axes: 'z-up', land };
}
const input = await world(WORLD);
console.log(`world ${WORLD}: ${input.elevKm.length.toLocaleString()} cells`);
const stats = (label) => { const s = { label, calls: 0, cycles: 0, max: 0, ms: 0 }; return s; };
const counted = (make, s) => (...a) => {
    const solver = make(...a), solve = solver.solve.bind(solver);
    const key = `${solver.levels[0].w}x${solver.levels[0].h}${a[3]?.conservative ? 'C' : ''} D${a[1]}`;
    solver.solve = (...b) => {
        const t = performance.now(), r = solve(...b), tol = b[4]?.tol;
        const done = (q) => {
            s.calls++; s.cycles += q.cycles; s.max = Math.max(s.max, q.cycles); s.ms += performance.now() - t;
            const k = (s.by ??= {})[`${key} tol${tol}`] ??= { calls: 0, cycles: 0, max: 0, ms: 0, worstRel: 0 };
            k.calls++; k.cycles += q.cycles; k.max = Math.max(k.max, q.cycles); k.ms += performance.now() - t; k.worstRel = Math.max(k.worstRel, q.rel); k.worstFloor = Math.max(k.worstFloor ?? 0, q.beyondFloor ?? 0);
            return q;
        };
        return r instanceof Promise ? r.then(done) : done(r);
    };
    return solver;
};
let t = performance.now();
const cs = stats('cpu');
const ref = argv.includes('--no-ref') ? null : planetClimate(input, { solver: counted((g, D, Dx, o) => new HelmholtzSolver(g, D, Dx, { ...o, deep: true, zebra: true, converged: true }), cs) });
if (ref) console.log(`CPU float64 reference: ${(performance.now() - t).toFixed(0)} ms; solves ${cs.calls}, cycles ${cs.cycles} (max ${cs.max}), ${cs.ms.toFixed(0)} ms`);
const show = (s) => { for (const [k, v] of Object.entries(s.by)) console.log(`   ${k.padEnd(28)} ${String(v.calls).padStart(4)} solves ${String(v.cycles).padStart(5)} cycles (max ${v.max}) ${v.ms.toFixed(0).padStart(6)} ms, worst rel ${v.worstRel.toExponential(1)}${v.worstFloor ? ` (beyond floor ${v.worstFloor.toExponential(1)})` : ''}`); };
if (ref) show(cs);
// --control: the float64 climate's own sensitivity — the reference against itself solved to a third of CONVERGED_TOL (no GPU)
if (argv.includes('--control')) {
    const tight = planetClimate(input, { solver: (g, D, Dx, o) => new HelmholtzSolver(g, D, Dx, { ...o, deep: true, zebra: true, converged: 3e-6 }) });
    compare('float64 at 1e-5 against float64 at 3e-6 (control)', ref, tight, true);
    process.exit(0);
}
const { device, info } = await openDevice(gpu);
console.log(`GPU: ${info?.description || info?.architecture || '?'} (${info?.vendor || ''})`);
const runs = [];
for (let k = 0; k < REPS; k++) {
    const kit = await climateSolverKit(device), gs = stats('gpu');
    t = performance.now();
    const res = await planetClimateAsync(input, { solver: counted(kit, gs) });
    kit.release();
    console.log(`GPU run ${k}: ${(performance.now() - t).toFixed(0)} ms; solves ${gs.calls}, cycles ${gs.cycles} (max ${gs.max}), ${gs.ms.toFixed(0)} ms`);
    if (k === 0) show(gs);
    runs.push(res);
}
if (!ref) process.exit(0);
compare('GPU float32 against float64', ref, runs[0]);
function compare(label, ref, got, reportOnly = false) {
    console.log(`── ${label}`);
    const chk = reportOnly ? (ok, what) => console.log(`     ${what}`) : check;
    const a = ref.months, b = got.months;
    let dT = 0, sT = 0, dP = 0, sP = 0;
    const eT = new Float64Array(a.T.length), eP = new Float64Array(a.T.length);
    for (let i = 0; i < a.T.length; i++) {
        const d = Math.abs(a.T[i] - b.T[i]), e = Math.abs(a.P[i] - b.P[i]) / Math.max(1, a.P[i]);
        dT = Math.max(dT, d); sT += d; dP = Math.max(dP, e); sP += e; eT[i] = d; eP[i] = e;
    }
    eT.sort(); eP.sort();
    const q999 = (x) => x[Math.floor(0.999 * (x.length - 1))];
    const N = a.T.length, fmt = v => v.toExponential(2);
        let wT = 0, wP = 0;
        for (let i = 0; i < N; i++) { if (Math.abs(a.T[i] - b.T[i]) === dT) wT = i; if (Math.abs(a.P[i] - b.P[i]) / Math.max(1, a.P[i]) === dP) wP = i; }
        console.log(`     worst T: cell-month ${wT} ${a.T[wT].toFixed(3)} vs ${b.T[wT].toFixed(3)} °C; worst P: ${a.P[wP].toFixed(2)} vs ${b.P[wP].toFixed(2)} mm`);
    chk(sT / N <= 1e-3 && q999(eT) <= 0.05 && dT <= 1, `months' temperature: |ΔT| mean ${fmt(sT / N)} p99.9 ${fmt(q999(eT))} max ${fmt(dT)} °C (≤ 1e-3, 0.05, 1)`);
    chk(sP / N <= 1e-3 && q999(eP) <= 0.02 && dP <= 0.25, `months' rain: |ΔP|/P mean ${fmt(sP / N)} p99.9 ${fmt(q999(eP))} max ${fmt(dP)} (≤ 1e-3, 0.02, 0.25)`);
    // (sea ice by month and the ice sheets, on the climate's grids)
    const ra = ref.stages.temperature, rb = got.stages.temperature, G = ref.grid.size, lf = ref.surface.landFrac;
    let iceFlip = 0, seaN = 0;
    for (let m = 0; m < 12; m++) for (let g = 0; g < G; g++) {
        if (lf[g] >= 0.5) continue;
        seaN++;
        if ((ra.seaIce[m * G + g] >= 0.5) !== (rb.seaIce[m * G + g] >= 0.5)) iceFlip++;
    }
    chk(iceFlip <= 1e-3 * seaN, `sea ice (≥ ½) flips: ${iceFlip} of ${seaN.toLocaleString()} sea cell-months (≤ 1e-3)`);
    const pa = ra.state.perennial, pb = rb.state.perennial;
    let sheetFlip = 0, landG = 0;
    for (let g = 0; g < pa.length; g++) { if (!(lf[g] > 0)) continue; landG++; if ((pa[g] >= 0.5) !== (pb[g] >= 0.5)) sheetFlip++; }
    chk(sheetFlip <= 1e-3 * landG, `ice sheets (perennial ≥ ½) flips: ${sheetFlip} of ${landG.toLocaleString()} land cells (≤ 1e-3)`);
    // (Köppen per terrain cell: every class, and the two binary decisions the brief names — frozen (EF) and desert (BW))
    const ka = ref.cell.koppen, kb = got.cell.koppen, name = (k) => KOPPEN[k]?.code ?? String(k);
    let L = 0, any = 0, ef = 0, bw = 0;
    for (let c = 0; c < ka.length; c++) {
        if (!ka[c] && !kb[c]) continue;
        L++;
        if (ka[c] !== kb[c]) any++;
        if ((name(ka[c]) === 'EF') !== (name(kb[c]) === 'EF')) ef++;
        if (name(ka[c]).startsWith('BW') !== name(kb[c]).startsWith('BW')) bw++;
    }
    chk(any <= 1e-3 * L, `Köppen: ${any} of ${L.toLocaleString()} land cells differ (≤ 1e-3)`);
    chk(ef <= 1e-3 * L && bw <= 1e-3 * L, `ice caps (EF) flip on ${ef}, deserts (BW) on ${bw} land cells (each ≤ 1e-3)`);
}
const same = (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]));
if (runs.length > 1) check(same(runs[0].months.T, runs[1].months.T) && same(runs[0].months.P, runs[1].months.P), 'the GPU climate repeats itself to the bit');
process.exit(failed ? 1 : 0);
