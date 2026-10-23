// The civ layer's bench (plans/CIV_PLAN.md §9.6, stage A′): the people on a test strip — one long continent, its climate
// the same everywhere (a winter-rain climate, Csa: the wild cereals' own), so what the rules do shows apart from what a
// world's geography does — at two details, so what changes with the cell size shows too. Measured:
//   - the farming front's speed, km/yr: each farmed cell's distance from the centre that reached it first, over the years
//     between (cells 1000–4000 km out), all of them and inland ones (400+ km from the sea: no coastal route); the record
//     ~0.6–1.3 km/yr (Pinhasi et al. 2005)
//   - the time from the onset of cultivation to domestication at each centre (the record ~2000 yr; Purugganan & Fuller 2009)
//   - the onset's rarity: cells where cultivation began, centres and regions per 10 M km², and regions per 10 M km² of
//     ideal land (a crop's wild form ≥ IDEAL_W; Earth 6.5: its 10 centres on its 15.5 M km² of such land)
//   - that the wild resources sum to the forager density (substrate.js food)
//
//   node --max-old-space-size=16000 v2/tools/civ-bench.mjs [--cells 160000,640000] [--set key=value ...]
//
// Output: a table, and v2/out/civ/bench/<cells>.json.

import fs from 'node:fs';
import path from 'node:path';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { classifyCell } from '../js/climate/koppen.js';
import { cellStatsCollector } from '../js/climate/cell-stats.js';
import { vectorCollector } from '../js/civ/disease.js';
import { cropCollector } from '../js/civ/crops.js';
import { civSubstrate, WILD_FOODS } from '../js/civ/substrate.js';
import { runCivSim } from '../js/civ/sim.js';
import { domesticates } from '../js/civ/econ.js';
import { CIV } from '../js/civ/civ-config.js';
import { OUT, MESH_SEED } from './lib/civ-world.mjs';
import { spreadKm } from '../js/core/min-heap.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SIZES = arg('--cells', '160000,640000').split(',').map(Number);
const sets = process.argv.flatMap((a, i) => (a === '--set' ? [process.argv[i + 1]] : []));
const C = { ...CIV };
for (const s of sets) { const [k, v] = s.split('='); C[k] = JSON.parse(v); }
const D = Math.PI / 180, R = 6371;
// the strip: 25–50° N, 80° W – 80° E (~14 000 × 2800 km)
const LAT = [25, 50], LON = [-80, 80];
// the onset's rarity against Earth's: regions per 10 M km² of ideal land, where some crop's wild form is at least IDEAL_W
// (the herds' left out: their wild forms cover most of the Old World's open country) — Earth's record (civ-sim.mjs's 10
// centres) over its own such land (Earth at 160k cells, the economy's wild forms)
const IDEAL_W = 0.5, EARTH_IDEAL = '6.5: 10 centres on 15.5 M km²; ~15 with the minor ones';

/** The strip world at n cells: as a finished moment gives the civ layer (civWorldFromFinish's fields). */
function stripWorld(N) {
    const mesh = buildSimMesh(N, MESH_SEED), n = mesh.numCells, xyz = mesh.xyz;
    const z = new Float32Array(n), ocean = new Uint8Array(n), lake = new Uint8Array(n), koppen = new Uint8Array(n);
    const tAnnual = new Float32Array(n).fill(NaN), pAnnual = new Float32Array(n).fill(NaN), lat = new Float32Array(n);
    const stats = cellStatsCollector(n, c => lat[c] * D, { bytes: true }), vec = vectorCollector(n), crops = cropCollector(n, c => lat[c] * D);
    const T12 = new Float64Array(12), P12 = new Float64Array(12);
    for (let c = 0; c < n; c++) {
        const la = Math.asin(xyz[3 * c + 2]) / D, lo = Math.atan2(xyz[3 * c + 1], xyz[3 * c]) / D;
        lat[c] = la;
        if (la < LAT[0] || la > LAT[1] || lo < LON[0] || lo > LON[1]) { ocean[c] = 1; z[c] = -3; continue; }
        // gentle hills (a ripple, so some ground is the wild cereals' hilly flanks): 0.2–0.9 km
        z[c] = 0.55 + 0.35 * Math.sin(lo * 0.9 * D * 10) * Math.sin(la * D * 25);
        let ts = 0, ps = 0;
        for (let m = 0; m < 12; m++) {
            T12[m] = 17 + 9 * Math.cos(2 * Math.PI * (m - 6.5) / 12);
            P12[m] = Math.max(2, 500 / 12 * (1 + 1.1 * Math.cos(2 * Math.PI * (m - 0.5) / 12)));
            ts += T12[m]; ps += P12[m];
        }
        tAnnual[c] = ts / 12; pAnnual[c] = ps; koppen[c] = classifyCell(T12, P12);
        stats.add(c, T12, P12); vec.add(c, T12, P12); crops.add(c, T12, P12);
    }
    return { mesh, z, ocean, lake, koppen, tAnnual, pAnnual, stats: stats.stats, rivers: null, loess: null, erg: null, ice: null, vector: vec.vector, crops: crops.crops };
}

const ll = x => [Math.cos(x.lat * D) * Math.cos(x.lon * D), Math.cos(x.lat * D) * Math.sin(x.lon * D), Math.sin(x.lat * D)];
const km = (a, b, xyz) => R * Math.acos(Math.max(-1, Math.min(1, xyz[3 * a] * xyz[3 * b] + xyz[3 * a + 1] * xyz[3 * b + 1] + xyz[3 * a + 2] * xyz[3 * b + 2])));
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };

const rows = [];
for (const N of SIZES) {
    const t0 = performance.now(), w = stripWorld(N), sub = civSubstrate(w, C), xyz = w.mesh.xyz, n = w.mesh.numCells;
    let landKm2 = 0, idealKm2 = 0, wildErr = 0;
    const DOM = domesticates(sub, C);
    for (let c = 0; c < n; c++) {
        if (w.ocean[c]) continue;
        landKm2 += sub.cellKm2;
        if (DOM.some(p => !p.herd && p.wild(c) >= IDEAL_W)) idealKm2 += sub.cellKm2;
        let s = 0; for (const f of WILD_FOODS) s += sub.food[f][c];
        wildErr = Math.max(wildErr, Math.abs(s - sub.forager[c]));
    }
    // (the people from the strip's west end)
    const start = w.mesh.index.nearest(Math.cos(36 * D) * Math.cos(-79 * D), Math.cos(36 * D) * Math.sin(-79 * D), Math.sin(36 * D));
    const res = runCivSim(w, sub, { origins: [start], vary: null, polities: false, C });
    const raw = res.centreCells;
    // the front: each farmed cell from the nearest centre domesticated before the cell farmed (cells 1000–4000 km from it)
    const speeds = [], inland = [], seaKm = new Float64Array(n).fill(Infinity);
    for (let c = 0; c < n; c++) if (sub.coastal[c]) seaKm[c] = 0;
    spreadKm(w.mesh, seaKm, { maxKm: 2000, canEnter: (a, b) => !w.ocean[b] });
    for (let c = 0; c < n; c++) {
        const f = res.farmBP[c];
        if (!(f === f)) continue;
        let best = null, bd = Infinity;
        for (const x of raw) if (x.bp > f + 1e-6) { const d = km(c, x.cell, xyz); if (d < bd) { bd = d; best = x; } }
        if (best && bd >= 1000 && bd <= 4000) { speeds.push(bd / (best.bp - f)); if (seaKm[c] >= 400) inland.push(bd / (best.bp - f)); }
    }
    const toDom = raw.map(x => res.onsetBP[x.cell] - x.bp).filter(v => v === v);
    let onsets = 0, farmed = 0;
    for (let c = 0; c < n; c++) { if (res.onsetBP[c] === res.onsetBP[c]) onsets++; if (res.farmBP[c] === res.farmBP[c]) farmed++; }
    const per10M = 1e7 / landKm2;
    // (regions: centres of any crop or herd within centreKm of one another — Earth's ~10 centres are regions, each with
    // several crops and animals)
    const regions = [];
    for (const x of res.centres) { const near = regions.find(g => g.some(y => km(w.mesh.index.nearest(...ll(y)), w.mesh.index.nearest(...ll(x)), xyz) < C.centreKm)); near ? near.push(x) : regions.push([x]); }
    const byPkg = {};
    for (const x of res.centres) byPkg[x.pkg] = (byPkg[x.pkg] ?? 0) + 1;
    const row = {
        cells: n, cellKm: +Math.sqrt(sub.cellKm2).toFixed(1), landMkm2: +(landKm2 / 1e6).toFixed(1),
        frontKmYr: { p25: +q(speeds, 0.25).toFixed(2), median: +median(speeds).toFixed(2), p75: +q(speeds, 0.75).toFixed(2), n: speeds.length },
        inlandKmYr: { p25: +q(inland, 0.25).toFixed(2), median: +median(inland).toFixed(2), p75: +q(inland, 0.75).toFixed(2), n: inland.length },
        onsetToDomYr: { min: Math.round(Math.min(...toDom)), median: Math.round(median(toDom)), max: Math.round(Math.max(...toDom)), n: toDom.length },
        onsetCellsPer10M: +(onsets * per10M).toFixed(1), centresPer10M: +(res.centres.length * per10M).toFixed(2), centres: res.centres.length, byPkg,
        regions: regions.length, regionsPer10M: +(regions.length * per10M).toFixed(2), idealMkm2: +(idealKm2 / 1e6).toFixed(1),
        regionsPerIdeal10M: +(regions.length * 1e7 / Math.max(1, idealKm2)).toFixed(2),
        firstCentreBP: res.centres.length ? Math.round(Math.max(...res.centres.map(c => c.bp))) : null,
        farmedShare: +(farmed / (landKm2 / sub.cellKm2)).toFixed(2), wildSumErr: wildErr, secs: +((performance.now() - t0) / 1000).toFixed(1),
    };
    rows.push(row);
    fs.mkdirSync(path.join(OUT, 'bench'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'bench', `${Math.round(N / 1000)}k.json`), JSON.stringify({ sets, ...row }, null, 1));
    console.log(`${Math.round(N / 1000)}k cells (${row.cellKm} km), ${row.landMkm2} M km² of strip — ${row.secs} s`);
    console.log(`  farming front     ${row.frontKmYr.p25} / ${row.frontKmYr.median} / ${row.frontKmYr.p75} km/yr (quartiles; record 0.6–1.3)`);
    console.log(`  … inland          ${row.inlandKmYr.p25} / ${row.inlandKmYr.median} / ${row.inlandKmYr.p75} km/yr (400+ km from the sea)`);
    console.log(`  onset → domestic  ${row.onsetToDomYr.min} / ${row.onsetToDomYr.median} / ${row.onsetToDomYr.max} yr over ${row.onsetToDomYr.n} centre cells (record ~2000)`);
    console.log(`  rarity            ${row.onsetCellsPer10M} onset cells, ${row.centresPer10M} centres per 10 M km² (${row.centres} centres; the first ${row.firstCentreBP} BP; Earth ~1 per 10 M km²)`);
    console.log(`  regions           ${row.regions} (${row.regionsPer10M} per 10 M km²): centres of any crop within ${C.centreKm} km; by crop ${JSON.stringify(byPkg)}`);
    console.log(`  … per ideal land  ${row.regionsPerIdeal10M} per 10 M km² of ${row.idealMkm2} M km² where a crop's wild form is ≥ ${IDEAL_W} (Earth ${EARTH_IDEAL})`);
    console.log(`  farmed by now     ${row.farmedShare} of the strip;  |Σ wild − forager| ≤ ${row.wildSumErr.toExponential(1)}`);
}
if (rows.length === 2) {
    const [a, b] = rows, r = (x, y) => (y / x).toFixed(2);
    console.log(`detail ×${(b.cells / a.cells).toFixed(0)}: front ×${r(a.frontKmYr.median, b.frontKmYr.median)}, inland ×${r(a.inlandKmYr.median, b.inlandKmYr.median)}, onset cells per area ×${r(a.onsetCellsPer10M, b.onsetCellsPer10M)}, centres per area ×${r(a.centresPer10M, b.centresPer10M)} (1.00 = the same at every detail)`);
}
