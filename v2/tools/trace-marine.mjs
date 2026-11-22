// Where the rivers' load ends, under the sea (lane marine, 2026-11-21; Jackson: "we need erosion and sediment deposition
// happening in the seas as well"). One moment, the history to it and its finish, measured the way the marine targets read:
//
//   · the history's sediment books to the moment (world.budget, km³): the land's bedrock worn, the hollows' fill, the rivers'
//     supply to their mouths and where it went — enclosed seas, passive shelves (crust.shelfKm3), the margins' rise and the
//     trench fans (riseKm3, fanKm3) — and the flooded continent (epeiric seas): its area by depth on the moment's surface
//     and the sediment the history's records hold on it;
//   · the finish's erosion: what its rivers hand to the sea (the last step's outflow, km³/Myr), binned by the receiving
//     cell's depth under today's sea and the crust under it; the deltas, the bayhead fill, the coast's sand lost offshore;
//   · the finished surface: land below 200 / 500 m and its median; the sea floor by depth over continental and ocean crust;
//     the shelf (sea to 200 m joined to the coast) as a share of the planet; the coastline's divider dimension D and length.
//
//   node v2/tools/trace-marine.mjs --seed 831576 --time 430 [--sim 40000] [--cells 160000] [--cont 41] [--json out.json]
// GEO_SIM_DAWN=1: the finish erodes on the GPU, as the page does. Heavy at 2.5M: sim-slots run -n 6 --gb 16.

import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { simulateCached } from './lib/history-cache.mjs';
import { pageWorld, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { FRAME_FIELDS, TerrainPool } from '../js/terrain/terrain-pool.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { coastLoops, coastFractal } from './lib/coast-fractal.mjs';

setDelaunator(Delaunator);
if (process.env.GEO_SIM_DAWN === '1') await import('./gpu-harness/use-dawn.mjs');
const { finishPlanet } = await import('../js/finish/finish.js');

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seed = +arg('--seed', 831576), time = +arg('--time', 430), sim = +arg('--sim', 40000), cells = +arg('--cells', 160000);
const cont = +arg('--cont', DEFAULT_CONT), jsonOut = arg('--json', null);
const R = 6371, DEPTH_M = [0, 20, 50, 130, 200, 500, 1000, 2000, 4000, 99999];
const binOf = m => { for (let i = 1; i < DEPTH_M.length; i++) if (m < DEPTH_M[i]) return i - 1; return DEPTH_M.length - 2; };
const binNames = DEPTH_M.slice(0, -1).map((d, i) => `${d}–${DEPTH_M[i + 1] === 99999 ? '' : DEPTH_M[i + 1]}`);
const continental = t => t === CrustType.CONTINENT || t === CrustType.CRATON;

// ── the history ──
const { scene, world } = pageWorld({ seed, cont, sim }), simMesh = buildSimMesh(sim, MESH_SEED);
let frame = null, budget = null, budgetBack = null;
const t0 = performance.now();
await simulateCached(world, { untilMyr: time, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
    if (Math.abs(f.time - (time - 100)) < 1e-6) budgetBack = f.budget;
    if (Math.abs(f.time - time) > 1e-6) return;
    frame = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]]));
    frame.plates = f.plates.map(p => p && { quat: p.quat });
    budget = f.budget;
} }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim, meshSeed: MESH_SEED, heights: {}, by: 'trace-marine' } });
const historyS = (performance.now() - t0) / 1000;
const keys = ['erodeErodedKm3', 'erodeLaidKm3', 'erodeFillTakenKm3', 'basinFillKm3', 'riverSupplyKm3', 'riverContSupplyKm3', 'seaFillKm3', 'seaOverflowKm3', 'shelfKm3', 'riseKm3', 'fanKm3', 'trenchKeptKm3', 'sedimentAllKm3'];
const books = {};
for (const k of keys) books[k] = { total: Math.round(budget[k] ?? 0), last100: Math.round((budget[k] ?? 0) - (budgetBack?.[k] ?? 0)) };

// ── the finish, with a look at its erosion's outflow and its first surface ──
const out = { toSeaKm3PerMyr: new Float64Array(binNames.length * 2), lowKm: NaN };
let surface = null;
const observe = (name, mesh, z, sea, lake, outflow) => {
    if (name === 'surface') surface = { z: Float32Array.from(z), sea: Uint8Array.from(sea) };
    if (name !== 'erosion outflow' || !outflow) return;
    const n = mesh.numCells;
    for (let c = 0; c < n; c++) {
        const r = outflow.recv[c], q = outflow.q[c];
        if (sea[c] || r < 0 || !sea[r] || !(q > 0)) continue;
        out.toSeaKm3PerMyr[2 * binOf(Math.max(0, -z[r] * 1000)) + (contAt(mesh, r) ? 0 : 1)] += q;
    }
};
let typeAt = null;
const contAt = (mesh, c) => continental(typeAt(mesh, c));
const pool = await TerrainPool.create(simMesh), t1 = performance.now();
typeAt = (mesh, c) => { const w = simMesh.index.nearest(mesh.xyz[3 * c], mesh.xyz[3 * c + 1], mesh.xyz[3 * c + 2]); return frame.owner[w] >= 0 ? frame.type[w] : -1; };
const fin = await finishPlanet({ frame, simMesh, seed, cells, pool, closePool: true, observe });
const finishS = (performance.now() - t1) / 1000;
const { mesh, z, ocean } = fin, n = mesh.numCells, cellKm2 = 4 * Math.PI * R * R / n;

// ── the sea floor by depth and crust, on the first surface and the finished one; the history's records on it ──
const simOf = new Int32Array(n);
for (let c = 0; c < n; c++) simOf[c] = simMesh.index.nearest(mesh.xyz[3 * c], mesh.xyz[3 * c + 1], mesh.xyz[3 * c + 2]);
const seaFloor = (zz, sea) => {
    const rows = binNames.map(name => ({ depth: name, contMkm2: 0, oceanMkm2: 0, contSeaFillM: 0, contShelfKm3: 0, contRiseKm3: 0, nCont: 0 }));
    for (let c = 0; c < n; c++) {
        if (!sea[c]) continue;
        const w = simOf[c], row = rows[binOf(Math.max(0, -zz[c] * 1000))];
        if (frame.owner[w] >= 0 && continental(frame.type[w])) {
            row.contMkm2 += cellKm2 / 1e6; row.nCont++;
            row.contSeaFillM += (frame.seaFillKm?.[w] ?? 0) * 1000; row.contShelfKm3 += frame.shelfKm3?.[w] ?? 0; row.contRiseKm3 += frame.riseKm3?.[w] ?? 0;
        } else row.oceanMkm2 += cellKm2 / 1e6;
    }
    for (const r of rows) { r.contSeaFillM = r.nCont ? +(r.contSeaFillM / r.nCont).toFixed(1) : 0; r.contShelfKm3 = r.nCont ? +(r.contShelfKm3 / r.nCont).toFixed(1) : 0; r.contRiseKm3 = r.nCont ? +(r.contRiseKm3 / r.nCont).toFixed(1) : 0; r.contMkm2 = +r.contMkm2.toFixed(2); r.oceanMkm2 = +r.oceanMkm2.toFixed(2); delete r.nCont; }
    return rows;
};
// the shelf: sea to 200 m joined to the coast through such sea (lib/shelf-stats.mjs's measure)
const shelfShare = (zz, sea) => {
    const { adjOffset, adjList } = mesh, on = new Uint8Array(n), q = [];
    for (let c = 0; c < n; c++) { if (!sea[c] || zz[c] < -0.2) continue; for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (!sea[adjList[k]]) { on[c] = 1; q.push(c); break; } }
    for (let i = 0; i < q.length; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const nb = adjList[k]; if (!on[nb] && sea[nb] && zz[nb] >= -0.2) { on[nb] = 1; q.push(nb); } }
    return +(100 * q.length / n).toFixed(2);
};
const landStats = (zz, sea) => {
    const h = [];
    for (let c = 0; c < n; c++) if (!sea[c]) h.push(zz[c]);
    h.sort((a, b) => a - b);
    const below = km => +(100 * h.filter(v => v < km).length / Math.max(1, h.length)).toFixed(1);
    // (the relief: the land's high percentiles, and its mean slope between land neighbours, m/km — lane flexure)
    const { adjOffset, adjList, xyz } = mesh, at = q => Math.round(1000 * (h[Math.min(h.length - 1, Math.floor(q * h.length))] ?? NaN));
    let slope = 0, k = 0;
    for (let c = 0; c < n; c++) {
        if (sea[c]) continue;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
            const d = adjList[j];
            if (d < c || sea[d]) continue;
            const km = 6371 * Math.acos(Math.min(1, xyz[3 * c] * xyz[3 * d] + xyz[3 * c + 1] * xyz[3 * d + 1] + xyz[3 * c + 2] * xyz[3 * d + 2]));
            slope += Math.abs(zz[c] - zz[d]) * 1000 / km; k++;
        }
    }
    return { landPct: +(100 * h.length / n).toFixed(1), below200: below(0.2), below500: below(0.5), medianM: Math.round(1000 * (h[h.length >> 1] ?? NaN)), p90M: at(0.9), p99M: at(0.99), maxM: at(1), slopeMKm: +(slope / Math.max(1, k)).toFixed(2) };
};
// the shelf break: a sea cell under 800 m steeper than 0.009 km/km whose shallowest sea neighbour is gentler (lib/shelf-stats.mjs's
// rule, every coast: the median depth over such cells, m)
const breakM = (zz, sea) => {
    const { adjOffset, adjList, xyz } = mesh, g = new Float32Array(n).fill(NaN);
    const grad = t => { if (g[t] === g[t]) return g[t]; let m = 0; for (let k = adjOffset[t]; k < adjOffset[t + 1]; k++) { const q = adjList[k], d = R * Math.acos(Math.min(1, xyz[3 * t] * xyz[3 * q] + xyz[3 * t + 1] * xyz[3 * q + 1] + xyz[3 * t + 2] * xyz[3 * q + 2])); if (d > 0) m = Math.max(m, Math.abs(zz[q] - zz[t]) / d); } return (g[t] = m); };
    const d = [];
    for (let t = 0; t < n; t++) {
        if (!sea[t] || !(zz[t] > -0.8) || grad(t) < 0.009) continue;
        let up = -1, upZ = -Infinity;
        for (let k = adjOffset[t]; k < adjOffset[t + 1]; k++) { const q = adjList[k]; if (sea[q] && zz[q] > upZ) { upZ = zz[q]; up = q; } }
        if (up >= 0 && upZ > zz[t] && grad(up) < 0.009) d.push(-zz[t] * 1000);
    }
    d.sort((a, b) => a - b);
    return Math.round(d[d.length >> 1] ?? NaN);
};
const coast = sea => { const F = coastFractal(coastLoops(mesh, c => !!sea[c], null), () => 0, { kinds: ['all'] }); return { D: +F.all.D.toFixed(3), km: Math.round(F.all.km) }; };

const toSea = binNames.map((name, i) => ({ depth: name, contKm3PerMyr: Math.round(out.toSeaKm3PerMyr[2 * i]), oceanKm3PerMyr: Math.round(out.toSeaKm3PerMyr[2 * i + 1]) }));
const S = fin.stats;
const row = {
    seed, time, sim, cells, historyS: +historyS.toFixed(1), finishS: +finishS.toFixed(1), books,
    finishErosion: { keys: Object.keys(S.erode ?? {}), budget: S.erode?.budget ?? null, levels: (S.erode?.levels ?? []).map(l => ({ cells: l.cells, timeMyr: l.timeMyr, toSeaKm3: l.toSeaKm3, marineKm3: l.marineKm3, marineDriftKm3: l.marineDriftKm3, marineSub: l.marineSub, ms: l.ms?.marine })), late: S.erodeLate ? { toSeaKm3: Math.round(S.erodeLate.toSeaKm3 ?? NaN), marineKm3: Math.round(S.erodeLate.marineKm3 ?? NaN), marineDriftKm3: S.erodeLate.marineDriftKm3, marineSub: S.erodeLate.marineSub, ms: S.erodeLate.ms?.marine } : null },
    toSeaByDepth: toSea, deltas: S.deltas ?? null, bayhead: S.lowstand?.bayhead ?? null, coastStats: S.coast ?? null,
    surface: surface ? { land: landStats(surface.z, surface.sea), shelfPct: shelfShare(surface.z, surface.sea), breakM: breakM(surface.z, surface.sea), seaFloor: seaFloor(surface.z, surface.sea) } : null,
    finished: { land: landStats(z, ocean), shelfPct: shelfShare(z, ocean), breakM: breakM(z, ocean), coast: coast(ocean), seaFloor: seaFloor(z, ocean) },
};
console.log(JSON.stringify(row, null, 1));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(row, null, 1));
