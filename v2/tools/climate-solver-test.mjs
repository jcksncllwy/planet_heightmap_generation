// The GPU climate solver's test (js/gpu/climate-solver.js, lane gpuclimate): the whole climate — planetClimate's stages —
// with every solve on the GPU (float32) against the same climate solved on the CPU in float64 with the GPU's algorithm
// (climate/solver.js: the zebra smoother, the deep hierarchy, the coarsest level exact, every solve converged), and the GPU
// run twice, for determinism.
//   node v2/tools/climate-solver-test.mjs [--world test|earth|finish:<key>] [--cells 160000] [--reps 2]
// under Dawn (v2/tools/gpu-harness: `npm ci` there first). Worlds: `test` the climate-cells-test ground (continents, a 6 km
// range past the ice line, a sunk basin); `earth` Earth's own surface (tuning/climate's mesh of the ETOPO picture); a
// finished moment from the finish cache (tools/lib/finish-cache.mjs; its key). Exit 1 if a tolerance is missed or the GPU
// doesn't repeat itself.
// Tolerances (float32 against float64, each converged to CONVERGED_TOL — itself the solvers' own noise: zebra against
// lexicographic, both converged, differed by up to 0.04 °C):
//   · months: |ΔT| mean ≤ 1e-3 °C, max ≤ 0.5 °C; |ΔP| ≤ 0.1 of max(1 mm, P), mean ≤ 1e-3 of it;
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
const a = ref.months, b = runs[0].months;
let dT = 0, sT = 0, dP = 0, sP = 0;
for (let i = 0; i < a.T.length; i++) {
    const d = Math.abs(a.T[i] - b.T[i]), e = Math.abs(a.P[i] - b.P[i]) / Math.max(1, a.P[i]);
    dT = Math.max(dT, d); sT += d; dP = Math.max(dP, e); sP += e;
}
const N = a.T.length, fmt = v => v.toExponential(2);
check(sT / N <= 1e-3 && dT <= 0.5, `months' temperature: |ΔT| mean ${fmt(sT / N)} max ${fmt(dT)} °C (≤ 1e-3, ≤ 0.5)`);
check(sP / N <= 1e-3 && dP <= 0.1, `months' rain: |ΔP|/P mean ${fmt(sP / N)} max ${fmt(dP)} (≤ 1e-3, ≤ 0.1)`);
// (sea ice by month and the ice sheets, on the climate's grids)
const ra = ref.stages.temperature, rb = runs[0].stages.temperature, G = ref.grid.size, lf = ref.surface.landFrac;
let iceFlip = 0, seaN = 0;
for (let m = 0; m < 12; m++) for (let g = 0; g < G; g++) {
    if (lf[g] >= 0.5) continue;
    seaN++;
    if ((ra.seaIce[m * G + g] >= 0.5) !== (rb.seaIce[m * G + g] >= 0.5)) iceFlip++;
}
check(iceFlip <= 1e-3 * seaN, `sea ice (≥ ½) flips: ${iceFlip} of ${seaN.toLocaleString()} sea cell-months (≤ 1e-3)`);
const pa = ra.state.perennial, pb = rb.state.perennial;
let sheetFlip = 0, landG = 0;
for (let g = 0; g < pa.length; g++) { if (!(lf[g] > 0)) continue; landG++; if ((pa[g] >= 0.5) !== (pb[g] >= 0.5)) sheetFlip++; }
check(sheetFlip <= 1e-3 * landG, `ice sheets (perennial ≥ ½) flips: ${sheetFlip} of ${landG.toLocaleString()} land cells (≤ 1e-3)`);
// (Köppen per terrain cell: every class, and the two binary decisions the brief names — frozen (EF) and desert (BW))
const ka = ref.cell.koppen, kb = runs[0].cell.koppen, name = (k) => KOPPEN[k]?.code ?? String(k);
let L = 0, any = 0, ef = 0, bw = 0;
for (let c = 0; c < ka.length; c++) {
    if (!ka[c] && !kb[c]) continue;
    L++;
    if (ka[c] !== kb[c]) any++;
    if ((name(ka[c]) === 'EF') !== (name(kb[c]) === 'EF')) ef++;
    if (name(ka[c]).startsWith('BW') !== name(kb[c]).startsWith('BW')) bw++;
}
check(any <= 1e-3 * L, `Köppen: ${any} of ${L.toLocaleString()} land cells differ (≤ 1e-3)`);
check(ef <= 1e-3 * L && bw <= 1e-3 * L, `ice caps (EF) flip on ${ef}, deserts (BW) on ${bw} land cells (each ≤ 1e-3)`);
const same = (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]));
if (runs.length > 1) check(same(runs[0].months.T, runs[1].months.T) && same(runs[0].months.P, runs[1].months.P), 'the GPU climate repeats itself to the bit');
process.exit(failed ? 1 : 0);
