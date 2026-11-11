// Ice and the water cycle on one finished moment (lane ocean, questions 6 and 7; measure only):
//  · ice: the finish's last ice age (finish-ice.js: its extent, and its thickness a plastic sheet's, √(iceNyeKm × distance
//    to the margin), capped at iceMaxKm) and the moment's own ice (Köppen EF, the same law), as volumes and the sea-level
//    drop each would make taken from the ocean (ρ_ice/ρ_water 0.917/1.027 ≈ 0.89 of its volume as sea water, over the
//    ocean's area); then the sea lowered by the finish's fixed iceSeaDropKm and by the volume's own drop, and the shelf
//    bared and the land masses joined (land bridges) at each;
//  · water cycle: the moment's climate on the finished surface (climate/rain.js): global rain against evaporation per
//    anchor month, land's rain against land's evaporation, and the finish's runoff (its own Budyko: finish.js) against
//    land's P − E.
// Usage: node v2/tools/ocean-ice.mjs [--seed 626225] [--t 300] [--cells 2500000] [--json out.json]

import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { momentFrame, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { REPO_ROOT } from './lib/history-cache.mjs';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { planetClimate } from '../js/climate/climate.js';
import { KOPPEN_ID } from '../js/climate/koppen.js';
import { spreadKm } from '../js/core/min-heap.js';
import { pourOcean, volumeAt, EARTH_OCEAN_KM3 } from '../js/tectonics/ocean/inventory.js';

setDelaunator(Delaunator);
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seed = Number(flag('--seed', 626225)), t = Number(flag('--t', 300)), cells = Number(flag('--cells', 2500000)), jsonOut = flag('--json', null);
const F = FINISH, R = 6371, ICE_TO_WATER = 0.917 / 1.027;
const simMesh = buildSimMesh(40000, MESH_SEED), frame = await momentFrame(REPO_ROOT, { seed, cont: DEFAULT_CONT, sim: 40000, time: t });
const pool = await TerrainPool.create(simMesh);
const t0 = performance.now();
const fin = await finishPlanet({ frame, simMesh, seed, cells, pool, closePool: true, cfg: terrainConfig({}) });
const { mesh, z, ocean, glaciated } = fin, n = mesh.numCells, cellKm2 = 4 * Math.PI * R * R / n;
console.log(`finished ${n} cells in ${((performance.now() - t0) / 1000).toFixed(0)} s`);

// ── ice volume by the finish's own thickness law ──
const volumeOf = ice => {
    const toEdge = new Float32Array(n).fill(Infinity);
    for (let c = 0; c < n; c++) if (ice[c]) for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) if (!ice[mesh.adjList[k]]) { toEdge[c] = 0.5 * mesh.edgeKm; break; }
    spreadKm(mesh, toEdge, { canEnter: (a, b) => ice[b] === 1 });
    let v = 0, a = 0;
    for (let c = 0; c < n; c++) if (ice[c] && toEdge[c] < Infinity) { v += Math.min(F.iceMaxKm, Math.sqrt(F.iceNyeKm * toEdge[c])) * cellKm2; a += cellKm2; }
    return { km3: v, km2: a };
};
let oceanKm2 = 0;
for (let c = 0; c < n; c++) if (ocean[c]) oceanKm2 += cellKm2;
// ── the inventory on the finished ground (its shelves and slopes drawn): Earth's water poured, and what its own sea holds ──
const s0 = performance.now(), PO = pourOcean(mesh, z, EARTH_OCEAN_KM3), pourMs = performance.now() - s0;
let finLand = 0;
for (let c = 0; c < n; c++) if (!ocean[c]) finLand++;
const vAt0 = volumeAt(mesh, z, PO.spill, 0);
console.log(`inventory on the finished ground: Earth's ${EARTH_OCEAN_KM3.toExponential(3)} km³ → level ${(1000 * PO.levelKm).toFixed(0)} m, land ${(100 * (1 - PO.seaCells / n)).toFixed(1)} % (finish's own ${(100 * finLand / n).toFixed(1)} %), solve ${pourMs.toFixed(0)} ms · its sea at 0 holds ${(vAt0 / 1e9).toFixed(3)}e9 km³`);
const climate = planetClimate({ xyz: mesh.xyz, elevKm: z, axes: 'z-up' }, {});
const ef = new Uint8Array(n);
for (let c = 0; c < n; c++) ef[c] = !ocean[c] && climate.cell.koppen[c] === KOPPEN_ID.EF ? 1 : 0;
const lgm = volumeOf(glaciated), today = volumeOf(ef);
const dropOf = km3 => km3 * ICE_TO_WATER / oceanKm2;                // (first order: the ocean's area held fixed)
const lgmExtra = { km3: Math.max(0, lgm.km3 - today.km3) };
console.log(`ocean ${(oceanKm2 / 1e6).toFixed(0)} Mkm² · moment's own ice (EF) ${(today.km2 / 1e6).toFixed(2)} Mkm², ${(today.km3 / 1e6).toFixed(2)} Mkm³ → ${(1000 * dropOf(today.km3)).toFixed(0)} m of sea`);
console.log(`ice age ice ${(lgm.km2 / 1e6).toFixed(2)} Mkm², ${(lgm.km3 / 1e6).toFixed(2)} Mkm³ → ${(1000 * dropOf(lgm.km3)).toFixed(0)} m; beyond the moment's own: ${(1000 * dropOf(lgmExtra.km3)).toFixed(0)} m (finish assumes ${1000 * F.iceSeaDropKm} m)`);

// ── the shelf bared and the land joined at a lowered sea (the ocean's connected flood from its cells, below the level) ──
const lowered = dropKm => {
    const sea = new Uint8Array(n), q = [];
    for (let c = 0; c < n; c++) if (ocean[c] && z[c] < -dropKm) { sea[c] = 1; q.push(c); }
    // (keep only what the world ocean still reaches: a strait shallower than the drop parts two seas)
    const comp = new Int32Array(n).fill(-1), sizes = [];
    for (const s of q) {
        if (comp[s] >= 0) continue;
        const id = sizes.length, st = [s]; comp[s] = id; let len = 0;
        while (st.length) { const c = st.pop(); len++; for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) { const nb = mesh.adjList[k]; if (sea[nb] && comp[nb] < 0) { comp[nb] = id; st.push(nb); } } }
        sizes.push(len);
    }
    let bared = 0;
    for (let c = 0; c < n; c++) if (ocean[c] && !sea[c]) bared += cellKm2;
    return { bared, masses: landMasses(c => !sea[c]), seas: sizes.filter(s => s * cellKm2 > 1e5).length };
};
function landMasses(isLand) {
    const comp = new Int32Array(n).fill(-1), sizes = [];
    for (let s = 0; s < n; s++) {
        if (!isLand(s) || comp[s] >= 0) continue;
        const id = sizes.length, st = [s]; comp[s] = id; let len = 0;
        while (st.length) { const c = st.pop(); len++; for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) { const nb = mesh.adjList[k]; if (isLand(nb) && comp[nb] < 0) { comp[nb] = id; st.push(nb); } } }
        sizes.push(len * cellKm2);
    }
    return sizes.filter(a => a > 1e5).sort((a, b) => b - a);
}
const now = landMasses(c => !ocean[c]), atFixed = lowered(F.iceSeaDropKm), atOwn = lowered(dropOf(lgmExtra.km3));
const fmt = m => `${m.length} masses > 0.1 Mkm² (largest ${m.slice(0, 4).map(a => (a / 1e6).toFixed(1)).join(', ')} Mkm²)`;
console.log(`today: ${fmt(now)}`);
console.log(`sea −${1000 * F.iceSeaDropKm} m: shelf bared ${(atFixed.bared / 1e6).toFixed(2)} Mkm², ${fmt(atFixed.masses)}`);
console.log(`sea −${(1000 * dropOf(lgmExtra.km3)).toFixed(0)} m (the ice's own): shelf bared ${(atOwn.bared / 1e6).toFixed(2)} Mkm², ${fmt(atOwn.masses)}`);

// ── the water cycle: the climate's rain and evaporation, and the finish's runoff ──
const rain = climate.stages.rain, g = climate.grid, G = g.size, K = rain.balance.length, lf = climate.surface.landFrac;
let P = 0, E = 0, Pl = 0, El = 0, Ps = 0, Es = 0;
for (let k = 0; k < K; k++) for (let j = 0; j < g.h; j++) {
    const wgt = g.rowArea[j];
    for (let i = 0; i < g.w; i++) {
        const c = j * g.w + i, p = rain.P[k * G + c] * wgt, e = rain.E[k * G + c] * wgt;
        P += p; E += e;
        if (lf[c] > 0.5) { Pl += p; El += e; } else { Ps += p; Es += e; }
    }
}
// (the finish's runoff: Budyko on the cell's annual rain and a temperature-only potential evaporation — finish.js)
let Pc = 0, Rc = 0, Ec = 0;
for (let c = 0; c < n; c++) {
    if (ocean[c]) continue;
    const p = Math.max(0, climate.cell.pAnnual[c]), E0 = Math.max(F.petMinMm, F.petBaseMm + F.petPerC * climate.cell.tAnnual[c]);
    if (!(p === p)) continue;
    const r = p > 0 ? Math.max(0, p - p * (1 + E0 / p - (1 + (E0 / p) ** F.budykoW) ** (1 / F.budykoW))) : 0;
    Pc += p * cellKm2; Rc += r * cellKm2; Ec += (p - r) * cellKm2;
}
const r3 = x => x.toFixed(3);
console.log(`climate anchors' P/E: ${rain.balance.map(r3).join(', ')} · whole year, area-weighted: P/E ${r3(P / E)}`);
console.log(`land (grid cells > 50 % land): P ${r3(Pl / P)} of global rain, E ${r3(El / E)} of global evaporation; land P − E = ${r3((Pl - El) / Pl)} of land rain; sea E − P = ${r3((Es - Ps) / Pl)} of land rain`);
console.log(`finish's cells: runoff ${r3(Rc / Pc)} of land rain (Budyko, temperature PET), its implied land evaporation ${r3(Ec / Pc)} of land rain`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ seed, t, n, oceanKm2, lgm, today, iceSeaDropKm: F.iceSeaDropKm, ownDropKm: dropOf(lgmExtra.km3), now, atFixed, atOwn, pour: { levelKm: PO.levelKm, land: 1 - PO.seaCells / n, ms: pourMs, vAt0 }, balance: rain.balance, P, E, Pl, El, Ps, Es, Pc, Rc, Ec }));
