#!/usr/bin/env node
// Why Earth's replay grows no northern sheets (lane iceage B2, 2026-11-25): the inception's suspects, measured on Earth's
// rebounded ice-free bed (ETOPO5 less today's ice, risen by Airy's share), by region. A diagnosis, not a check: nothing here
// is fitted, each line names a mechanism with its number.
//   · the orbit and the air: the summer's surface temperature at 116 ka and 21 ka against 0 ka (pre-industrial), the climate's
//     own (published inception cooling over northern Canada: compare);
//   · the snow kept through summer: the climate's own perennial snow (temperature.js's switch, its albedo) on (no ice given)
//     and off (input.ice given as none — what glacialSheets' rounds pass, B2 (iii)), and the balance under each;
//   · the climate feeling the ice: 21 ka with ICE-6G_C's 21 ka ice given (its albedo and its height) against ice-free — and
//     whether the degree-day balance on that ice is positive (could the sheet keep itself in this climate?).
//   node v2/tools/iceage-inception.mjs        (GPU: Dawn in Node)
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { earthSurfaceKm, earthIce, EARTH_ICE_MESH } from './lib/earth-surface.mjs';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { worldOcean } from '../js/terrain/world-ocean.js';
import { planetClimateAsync } from '../js/climate/climate.js';
import { CORE_DEFAULTS, seaLevelGrid } from '../js/climate/core.js';
import { climateSolverKit } from '../js/gpu/climate-solver.js';
import { cellClimateGPU } from '../js/gpu/climate-cells.js';
import { finishDevice } from '../js/gpu/finish-gpu.js';
import { FINISH } from '../js/finish/finish-config.js';
import { bilinear } from '../js/finish/finish.js';
import { systemOf, EARTH_CYCLE } from '../js/climate/planet-system.js';
import { pddBalance } from '../js/gpu/ice-balance.js';
import { ICE } from '../js/gpu/ice-sheet.js';

setDelaunator(Delaunator);
const t0 = performance.now(), F = FINISH, gamma = CORE_DEFAULTS.lapseRateCPerKm;
const mesh = terrainMesh(EARTH_ICE_MESH), n = mesh.numCells, x = mesh.xyz;
const S = earthSurfaceKm(mesh, { terrain: true }), I6 = earthIce(mesh);
if (S.error || I6.error || !I6.thickNowKm || !I6.thickLgmKm) { console.error(S.error ?? I6.error ?? 'no thickness in the ice artifact (make-earth-ice.mjs)'); process.exit(1); }
const lat = new Float32Array(n), lon = new Float32Array(n);
for (let c = 0; c < n; c++) { lat[c] = Math.asin(x[3 * c + 2]) * 180 / Math.PI; lon[c] = Math.atan2(x[3 * c + 1], x[3 * c]) * 180 / Math.PI; }
const bed = Float32Array.from(S.z, (v, c) => v - I6.thickNowKm[c] * (1 - ICE.rhoIce / ICE.rhoMantle));
const device = await finishDevice(), sys0 = systemOf(undefined);

const REGIONS = [
    ['N Canada (Keewatin, Baffin, Labrador: 55–75° N, 125–60° W)', (a, o) => a > 55 && a < 75 && o > -125 && o < -60 && !(a > 59 && o > -74), 1],
    ['Laurentide south (45–55° N, 110–60° W)', (a, o) => a > 45 && a <= 55 && o > -110 && o < -60, 1],
    ['Fennoscandia (58–72° N, 5–40° E)', (a, o) => a > 58 && a < 72 && o > 5 && o < 40, 1],
    ['Siberia (60–75° N, 90–150° E)', (a, o) => a > 60 && a < 75 && o > 90 && o < 150, 1],
    ['High Asia (25–45° N, 65–105° E)', (a, o) => a > 25 && a <= 45 && o > 65 && o < 105, 1],
    ['Greenland', (a, o) => a > 59 && a < 84 && o > -74 && o < -10, 1],
    ['Antarctica', a => a < -60, -1],
];

/** One climate on the ground `elevKm` (km, sea 0) at `epochKyr`, `ice` given (Uint8Array) or null (the climate's own snow). */
async function climateAt(name, epochKyr, elevKm, ice) {
    const tw = performance.now(), land = Uint8Array.from(worldOcean(mesh, elevKm, 0).ocean, o => o ? 0 : 1);
    const system = { ...sys0, orbit: { ...sys0.orbit, cycle: sys0.orbit.cycle ?? EARTH_CYCLE }, epochKyr }, opts = { system };
    const solver = await climateSolverKit(device);
    let res;
    try { res = await planetClimateAsync({ xyz: x, elevKm, axes: 'z-up', land, ...(ice ? { ice } : {}) }, { ...opts, cells: false, solver }); } finally { solver.release(); }
    const cell = await cellClimateGPU(device, res, x, elevKm, land, opts);
    const { Tsl, P } = seaLevelGrid(res.grid, res.surface, res.months, gamma);
    const G = res.grid.size, cg = { w: res.grid.w, h: res.grid.h }, layer = new Float32Array(G), iceFrac = res.stages.temperature.iceFrac;
    // (each month's layer once, onto the cells of every region: sea-level T and precipitation, the climate's perennial share)
    const cells = [], reg = [];
    for (let c = 0; c < n; c++) { if (!land[c]) continue; const r = REGIONS.findIndex(([, f]) => f(lat[c], lon[c])); if (r >= 0) { cells.push(c); reg.push(r); } }
    const K = cells.length, T12 = new Float32Array(12 * K), P12 = new Float32Array(12 * K), pere = new Float32Array(K);
    for (let m = 0; m < 12; m++) {
        layer.set(Tsl.subarray(m * G, (m + 1) * G)); for (let i = 0; i < K; i++) T12[m * K + i] = bilinear(cg, layer, lat[cells[i]], lon[cells[i]]) - gamma * Math.max(0, elevKm[cells[i]]);
        layer.set(P.subarray(m * G, (m + 1) * G)); for (let i = 0; i < K; i++) P12[m * K + i] = Math.max(0, bilinear(cg, layer, lat[cells[i]], lon[cells[i]]));
    }
    layer.set(iceFrac); for (let i = 0; i < K; i++) pere[i] = bilinear(cg, layer, lat[cells[i]], lon[cells[i]]);
    const out = [];
    for (let ri = 0; ri < REGIONS.length; ri++) {
        const [rname, , hemi] = REGIONS[ri], summer = [], bal = [], snow = [], pr = []; let pos = 0, k = 0;
        for (let i = 0; i < K; i++) {
            if (reg[i] !== ri) continue;
            const c = cells[i], Tm = [], Pm = []; let Ps = 0;
            for (let m = 0; m < 12; m++) { Tm.push(T12[m * K + i]); Pm.push(P12[m * K + i]); Ps += P12[m * K + i]; }
            const pA = Math.min(cell.pAnnual[c], F.rainMaxMm), sc = Ps > 0 && pA === pA ? pA / Ps : 1;
            const sm = hemi > 0 ? [5, 6, 7] : [11, 0, 1];
            summer.push(sm.reduce((s, m) => s + Tm[m], 0) / 3);
            const b = pddBalance(Tm, Pm.map(p => p * sc)) / 1000;      // (m w.e. a year)
            bal.push(b); if (b > 0) pos++;
            let sn = 0; for (let m = 0; m < 12; m++) sn += Pm[m] * sc * (Tm[m] < 1 ? 1 : 0);
            snow.push(sn / 1000); pr.push(pere[i]);
            k++;
        }
        if (!k) continue;
        const med = a => Float64Array.from(a).sort()[a.length >> 1], mean = a => a.reduce((s, v) => s + v, 0) / a.length;
        out.push({ region: rname, cells: k, summerC: med(summer), balance: med(bal), positive: pos / k, snowWe: med(snow), perennial: mean(pr) });
    }
    console.log(`\n── ${name} (${epochKyr} ka, ${ice ? 'ice given' : 'the climate\'s own snow'}; ${((performance.now() - tw) / 1000).toFixed(0)} s) ──`);
    for (const r of out) console.log(`  ${r.region.split(' (')[0].padEnd(18)} summer ${r.summerC.toFixed(1).padStart(6)} °C · balance median ${r.balance.toFixed(2).padStart(6)} m w.e./a, ${(100 * r.positive).toFixed(0).padStart(3)} % positive · snowfall ${r.snowWe.toFixed(2)} m w.e. · the climate's perennial share ${(100 * r.perennial).toFixed(0)} %`);
    return out;
}

const none = new Uint8Array(n);
const A = await climateAt('A: today (pre-industrial), ice-free', 0, bed, null);
const A0 = await climateAt('A0: today, ice given as none', 0, bed, none);
const B = await climateAt('B: inception, ice-free', 116, bed, null);
const B0 = await climateAt('B0: inception, ice given as none (the rounds\' form)', 116, bed, none);
const C = await climateAt('C: maximum, ice-free', 21, bed, null);
const C0 = await climateAt('C0: maximum, ice given as none (the rounds\' form)', 21, bed, none);
// (the maximum with ICE-6G_C's own ice on the bed: its surface the bed sunk by Airy's share plus its thickness)
const lgmElev = Float32Array.from(bed, (v, c) => I6.lgm[c] && I6.thickLgmKm[c] > 0 ? v - ICE.rhoIce / ICE.rhoMantle * I6.thickLgmKm[c] + I6.thickLgmKm[c] : v);
const lgmIce = Uint8Array.from(I6.lgm, (v, c) => v && I6.thickLgmKm[c] > 0 ? 1 : 0);
const D = await climateAt('D: maximum on ICE-6G_C\'s 21 ka ice (given)', 21, lgmElev, lgmIce);

console.log('\n── the differences (summer °C; balance m w.e./a) ──');
const d = (p, q, what) => { for (let i = 0; i < p.length; i++) { const a = p[i], b = q.find(r => r.region === a.region); if (b) console.log(`  ${what.padEnd(44)} ${a.region.split(' (')[0].padEnd(18)} summer ${(a.summerC - b.summerC).toFixed(1).padStart(5)} · balance ${(a.balance - b.balance).toFixed(2).padStart(6)} · positive ${(100 * (a.positive - b.positive)).toFixed(0).padStart(4)} pts`); } };
d(B, A, 'orbit + CO2 at 116 ka (own snow)');
d(C, A, 'orbit + CO2 at 21 ka (own snow)');
d(B0, B, 'perennial snow off at 116 ka (rounds\' form)');
d(C0, C, 'perennial snow off at 21 ka');
d(D, C0, 'ICE-6G_C\'s ice given at 21 ka');
console.log(`\n(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
console.log(`REPORT_JSON ${JSON.stringify({ inception: { A, A0, B, B0, C, C0, D } })}`);
process.exit(0);
