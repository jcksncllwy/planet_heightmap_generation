// The GPU climate-per-cell kernels' test (js/gpu/climate-cells.js, lane gpucells M1): a real climate (planetClimate, its
// stages, on a terrain mesh with continents, mountains and a sunk basin) finished per cell on the GPU against the CPU's
// float64 arithmetic — climate/core.js finishCells (its months through onCell, its year and Köppen class), cell-stats.js's
// bytes from those months, and finish.js thawedWater with the year's Budyko–Fu runoff — twice each, for determinism.
//   node v2/tools/climate-cells-test.mjs [--cells 160000] [--reps 2]
// under Dawn (v2/tools/gpu-harness: `npm ci` there first). Exit 1 if a case misses its tolerance or does not repeat itself.
// Tolerances (the GPU's f32 against the CPU's f64 on the same f32 inputs; f32's step at 30 °C is 2e-6, at 3000 mm 2.4e-4):
//   · months, the year: |ΔT| max 1e-4 °C; |ΔP| max 1e-4 relative (to max(1 mm, P));
//   · Köppen: every class equal, or its difference explained — the CPU's classifier on the GPU's months (in f64) gives
//     the GPU's class (the port is exact; the months differ by a hair across a boundary) — on at most 1e-4 of the land;
//   · stats bytes: |Δ| ≤ 1 (a half level's rounding), on at most 1e-3 of the land;
//   · water: |Δ| ≤ 1e-3 mm + 1e-4 of the cell's year of rain (the water they share; PET: of itself) on the liquid water,
//     kept snow, potential evaporation and runoff, and thawed months equal —
//     except a cell with a month within 1e-3 °C of freezing (snow or rain: the kept snow steps there), at most 1e-4 of them.
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { gpu } from './gpu-harness/dawn.mjs';
import { openDevice } from '../js/gpu/gpu-device.js';
import { cellClimateGPU, waterCellsGPU } from '../js/gpu/climate-cells.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { planetClimate } from '../js/climate/climate.js';
import { CORE_DEFAULTS } from '../js/climate/core.js';
import { classifyCell } from '../js/climate/koppen.js';
import { cellStatsCollector, STAT_KEYS } from '../js/climate/cell-stats.js';
import { fuEvaporation } from '../js/climate/water.js';
import { thawedWater, potentialMonths, bilinear } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CELLS = +arg('--cells', 160000), REPS = +arg('--reps', 2);
const TOL = { T: 1e-4, Prel: 1e-4, koppenShare: 1e-4, statShare: 1e-3, waterAbs: 1e-3, waterRel: 1e-4, nearShare: 1e-4 };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

setDelaunator(Delaunator);
const mesh = terrainMesh(CELLS), n = mesh.numCells, { xyz } = mesh;
// (a ground: broad continents to 3 km, a high range to 6 km past the ice line, a basin sunk 400 m below the sea and cut off from it)
const z = new Float32Array(n), land = new Uint8Array(n);
for (let c = 0; c < n; c++) {
    const x = xyz[3 * c], y = xyz[3 * c + 1], w = xyz[3 * c + 2];
    let h = 1.2 * Math.sin(3 * x + 1) * Math.cos(2 * y - 0.5) + 0.7 * Math.sin(5 * w + 2 * x) + 0.25 * Math.sin(17 * y + 11 * w) - 0.35;
    h += 5 * Math.max(0, 1 - 30 * ((w - 0.5) ** 2 + (x - 0.6) ** 2));
    const basin = (x + 0.3) ** 2 + (y - 0.8) ** 2 + (w - 0.2) ** 2;
    if (basin < 0.01 && h > 0) h = -0.4 * (1 - basin / 0.01) + 0.05;
    z[c] = h; land[c] = h > 0 || basin < 0.01 ? 1 : 0;
}
const t0 = performance.now(), cpuMonths = new Float64Array(24 * n);
const res = planetClimate({ xyz, elevKm: z, axes: 'z-up', land }, { onCell: (r, T12, P12) => { for (let m = 0; m < 12; m++) { cpuMonths[24 * r + m] = T12[m]; cpuMonths[24 * r + 12 + m] = P12[m]; } } });
console.log(`climate on ${n.toLocaleString()} cells: ${((performance.now() - t0) / 1000).toFixed(1)} s (CPU, step 5 included)`);
const { lat, lon } = res.cell, L = land.reduce((a, b) => a + b, 0);
const cpuStats = cellStatsCollector(n, c => lat[c] * Math.PI / 180, { bytes: true });
for (let c = 0; c < n; c++) if (land[c]) cpuStats.add(c, cpuMonths.subarray(24 * c, 24 * c + 12), cpuMonths.subarray(24 * c + 12, 24 * c + 24));

const { device, info } = await openDevice(gpu);
console.log(`GPU: ${info?.description || info?.architecture || '?'} (${info?.vendor || ''})`);
const q = (a, p) => { const s = Float64Array.from(a).sort(); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const fmt = v => v.toExponential(2);

// ── step 5: the months, the year, Köppen, the stats ──
const runs = [];
for (let k = 0; k < REPS; k++) {
    const t = performance.now(), g = await cellClimateGPU(device, res, xyz, z, land, {}, { months: true, stats: true });
    runs.push({ g, ms: performance.now() - t });
}
const g = runs[0].g;
console.log(`cellClimateGPU: ${runs.map(r => r.ms.toFixed(0)).join(' / ')} ms (${L.toLocaleString()} land cells)`);
const dT = [], dP = [];
let tMax = 0, pMax = 0;
for (let r = 0; r < g.cells.length; r++) {
    const c = g.cells[r];
    for (let m = 0; m < 12; m++) {
        const a = Math.abs(g.months[24 * r + m] - cpuMonths[24 * c + m]), P = cpuMonths[24 * c + 12 + m], b = Math.abs(g.months[24 * r + 12 + m] - P) / Math.max(1, P);
        dT.push(a); dP.push(b); tMax = Math.max(tMax, a); pMax = Math.max(pMax, b);
    }
}
console.log(`months: |ΔT| p99 ${fmt(q(dT, 0.99))} max ${fmt(tMax)} °C · |ΔP|/P p99 ${fmt(q(dP, 0.99))} max ${fmt(pMax)}`);
check(tMax <= TOL.T && pMax <= TOL.Prel, `twelve months within ${TOL.T} °C and ${TOL.Prel} of the rain`);
let yT = 0, yP = 0, sea = 0;
for (let c = 0; c < n; c++) {
    if (!land[c]) { if (g.koppen[c] !== 0 || g.tAnnual[c] === g.tAnnual[c]) sea++; continue; }
    yT = Math.max(yT, Math.abs(g.tAnnual[c] - res.cell.tAnnual[c])); yP = Math.max(yP, Math.abs(g.pAnnual[c] - res.cell.pAnnual[c]) / Math.max(1, res.cell.pAnnual[c]));
}
console.log(`year: |ΔtAnnual| max ${fmt(yT)} °C · |ΔpAnnual|/P max ${fmt(yP)}`);
check(yT <= TOL.T && yP <= TOL.Prel && sea === 0, 'the year within the same, and the sea class 0 with no year');
let kDiff = 0, kExplained = 0;
const T12 = new Float64Array(12), P12 = new Float64Array(12), kList = [];
for (let r = 0; r < g.cells.length; r++) {
    const c = g.cells[r];
    if (g.koppen[c] === res.cell.koppen[c]) continue;
    kDiff++;
    for (let m = 0; m < 12; m++) { T12[m] = g.months[24 * r + m]; P12[m] = g.months[24 * r + 12 + m]; }
    if (classifyCell(T12, P12) === g.koppen[c]) kExplained++;
    if (kList.length < 8) kList.push(`${c}: ${res.cell.koppen[c]}→${g.koppen[c]}`);
}
console.log(`Köppen: ${kDiff} of ${L.toLocaleString()} land cells differ${kDiff ? ` (${kList.join(', ')}); ${kExplained} explained by their months` : ''}`);
check(kDiff === kExplained && kDiff <= TOL.koppenShare * L, `Köppen equal, or each difference the months' hair across a boundary (≤ ${TOL.koppenShare} of the land)`);
let sOff = 0, sBig = 0;
for (const key of STAT_KEYS) {
    const a = g.stats[key], b = cpuStats.stats[key];
    for (let c = 0; c < n; c++) { const d = Math.abs(a[c] - b[c]); if (d) { sOff++; if (d > 1) sBig++; } }
}
console.log(`stats bytes: ${sOff} differ of ${(4 * L).toLocaleString()} (${sBig} by more than 1)`);
check(sBig === 0 && sOff <= TOL.statShare * 4 * L, `stats bytes within 1 level, on ≤ ${TOL.statShare} of them`);
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
check(runs.every(({ g: h }) => same(h.months, g.months) && same(h.koppen, g.koppen) && same(h.tAnnual, g.tAnnual) && STAT_KEYS.every(k => same(h.stats[k], g.stats[k]))), `repeats itself to the bit (${REPS} runs)`);

// ── the thaw gate and the runoff ──
const F = FINISH, gamma = CORE_DEFAULTS.lapseRateCPerKm, G = res.grid.size, climGrid = { w: res.grid.w, h: res.grid.h };
const pAnn = Float32Array.from(res.cell.pAnnual), pG = new Float32Array(G);
for (let c = 0; c < n; c++) if (pAnn[c] > F.rainMaxMm) pAnn[c] = F.rainMaxMm;
for (let gg = 0; gg < G; gg++) for (let m = 0; m < 12; m++) pG[gg] += res.months.P[m * G + gg];
for (let c = 0; c < n; c++) if (!(pAnn[c] === pAnn[c])) pAnn[c] = c % 97 ? bilinear(climGrid, pG, lat[c], lon[c]) : NaN;     // (a few cells with none: skipped)
const petM = potentialMonths(res, G, F), petG = new Float32Array(G);
for (let gg = 0; gg < G; gg++) for (let m = 0; m < 12; m++) petG[gg] += Math.max(0, petM[m * G + gg]);
const tc = performance.now(), liquid = thawedWater(res.months, res.surface.meanLandKm, climGrid, G, z, pAnn, lat, lon, gamma, F, n, land);
const ref = { pet: new Float32Array(n), runoff: new Float32Array(n) };
for (let c = 0; c < n; c++) {
    if (!(pAnn[c] === pAnn[c])) continue;
    const P = Math.max(0, liquid.rain[c]), E0 = Math.max(F.petMinMm, bilinear(climGrid, petG, lat[c], lon[c]));
    ref.pet[c] = E0; ref.runoff[c] = P - fuEvaporation(P, E0, F.budykoW);
}
const cpuWaterMs = performance.now() - tc;
const wargs = { grid: climGrid, months: res.months, hLand: res.surface.meanLandKm, petG, lat, lon, z, land, pAnn, gamma, meltPerC: F.snowMeltMmPerC, petMin: F.petMinMm, budykoW: F.budykoW };
const wruns = [];
for (let k = 0; k < REPS; k++) { const t = performance.now(), w = await waterCellsGPU(device, wargs); wruns.push({ w, ms: performance.now() - t }); }
const W = wruns[0].w;
console.log(`waterCellsGPU: ${wruns.map(r => r.ms.toFixed(0)).join(' / ')} ms (CPU ${cpuWaterMs.toFixed(0)} ms)`);
// (a cell with a month within 1e-3 °C of freezing, at its own height, as thawedWater takes it)
const Tsl = new Float32Array(12 * G);
for (let gg = 0; gg < G; gg++) { const hr = res.surface.meanLandKm[gg]; for (let m = 0; m < 12; m++) Tsl[m * G + gg] = res.months.T[m * G + gg] + gamma * (hr === hr ? hr : 0); }
const nearFreezing = c => {
    const x = (lon[c] + 180) / (180 / climGrid.h) - 0.5, y = Math.max(0, Math.min(climGrid.h - 1, (90 - lat[c]) / (180 / climGrid.h) - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i0 = ((x0 % climGrid.w) + climGrid.w) % climGrid.w, i1 = (i0 + 1) % climGrid.w, j1 = Math.min(climGrid.h - 1, y0 + 1);
    const h = gamma * (land[c] ? z[c] : 0);
    for (let m = 0; m < 12; m++) {
        const o = m * G, t = Tsl[o + y0 * climGrid.w + i0] * (1 - fx) * (1 - fy) + Tsl[o + y0 * climGrid.w + i1] * fx * (1 - fy) + Tsl[o + j1 * climGrid.w + i0] * (1 - fx) * fy + Tsl[o + j1 * climGrid.w + i1] * fx * fy - h;
        if (Math.abs(t) < 1e-3) return true;
    }
    return false;
};
const worst = { rain: 0, store: 0, pet: 0, runoff: 0 };
let wBad = 0, wNear = 0, nan = 0;
for (let c = 0; c < n; c++) {
    if (!(pAnn[c] === pAnn[c])) { if (W.rain[c] === W.rain[c] || W.store[c] === W.store[c] || W.runoff[c] !== 0) nan++; continue; }
    let off = W.thaw[c] !== liquid.thaw[c] || W.frozen[c] !== liquid.frozen[c];
    for (const [k, a, b] of [['rain', W.rain[c], liquid.rain[c]], ['store', W.store[c], liquid.store[c]], ['pet', W.pet[c], ref.pet[c]], ['runoff', W.runoff[c], ref.runoff[c]]]) {
        const d = Math.abs(a - b), tol = TOL.waterAbs + TOL.waterRel * (k === 'pet' ? Math.abs(b) : Math.max(0, pAnn[c]));
        if (d > tol) off = true; else worst[k] = Math.max(worst[k], d / tol);
    }
    if (off) { if (nearFreezing(c)) wNear++; else if (wBad++ < 5) console.log(`  cell ${c} z ${z[c].toFixed(3)} land ${land[c]}: rain ${W.rain[c]} / ${liquid.rain[c]} · kept ${W.store[c]} / ${liquid.store[c]} · pet ${W.pet[c]} / ${ref.pet[c]} · runoff ${W.runoff[c]} / ${ref.runoff[c]} · thaw ${W.thaw[c]} / ${liquid.thaw[c]}`); }
}
console.log(`water: worst |Δ| as a share of its tolerance — rain ${worst.rain.toFixed(3)} · kept ${worst.store.toFixed(3)} · PET ${worst.pet.toFixed(3)} · runoff ${worst.runoff.toFixed(3)}; ${wNear} cells off by a month at freezing, ${wBad} otherwise`);
check(wBad === 0 && wNear <= TOL.nearShare * n && nan === 0, `water within ${TOL.waterAbs} mm + ${TOL.waterRel} relative, thawed months equal (but ≤ ${TOL.nearShare} at freezing); none where no rain`);
check(wruns.every(({ w }) => ['rain', 'store', 'pet', 'runoff', 'thaw', 'frozen'].every(k => same(w[k], W[k]))), `water repeats itself to the bit (${REPS} runs)`);
device.destroy();
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
