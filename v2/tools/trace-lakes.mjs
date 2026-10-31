// Where a finished moment's lakes come from: each lake cell's maker in the hydrology (finish-hydro.js, debug), by area and
// by size of body, at any detail — for telling a world's lakes from the picture's cell size.
//   node v2/tools/trace-lakes.mjs --seed 831576 --time 310 [--cont 30] [--sim 40000] --cells 640000 [--set key=value,…] [--network]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';
import { networkShape, describe } from './lib/river-network.mjs';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('--seed', 831576)), CONT = Number(arg('--cont', 30)), SIM = Number(arg('--sim', 40000)), TIME = Number(arg('--time', 310)), CELLS = Number(arg('--cells', 640000));
const F = { ...FINISH };
for (const kv of (arg('--set', '') || '').split(/,(?=[A-Za-z_])/).filter(Boolean)) { const [k, v] = kv.split('='); F[k] = Number.isFinite(Number(v)) ? Number(v) : JSON.parse(v); }
const frame = await momentFrame(ROOT, { seed: SEED, cont: CONT, sim: SIM, time: TIME });
const simMesh = buildSimMesh(SIM, MESH_SEED), pool = await TerrainPool.create(simMesh);
const t0 = performance.now();
const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, debug: true, F, onStage: () => {} });
const { mesh, lake, ocean } = fin, { lakeSrc, tectonic, ice, basin, before, hollow, hollowInfo, lat, lon } = fin.layers, { adjOffset, adjList, numCells: n } = mesh;
const cellKm2 = 4 * Math.PI * 6371 ** 2 / n, W = fin.stats.water;
const NAMES = ['?', 'closed salt', 'closed full', 'sea', 'hollow kept', 'pocket fresh', 'pocket salt', 'late'];
const BINS = [1e3, 1e4, 1e5, 1e6, Infinity], rows = NAMES.map(() => ({ km2: 0, bodies: 0, bins: BINS.map(() => 0), binN: BINS.map(() => 0), tect: 0, ice: 0 }));
let landKm2 = 0, lakeKm2 = 0;
const open = { km2: 0, bodies: 0, big: 0 };       // (the fresh lakes the ice did not dig, no sea's remnant: Earth's rifts' and sags')
const top = [];
const seen = new Uint8Array(n);
for (let c = 0; c < n; c++) {
    if (ocean[c] && !lake[c]) continue;
    landKm2 += cellKm2;
    if (!lake[c] || lake[c] === 3 || seen[c]) continue;
    const src = lakeSrc[c], cells = [c];
    seen[c] = 1;
    for (let i = 0; i < cells.length; i++) for (let k = adjOffset[cells[i]]; k < adjOffset[cells[i] + 1]; k++) { const y = adjList[k]; if (!seen[y] && lakeSrc[y] === src && lake[y] === lake[c]) { seen[y] = 1; cells.push(y); } }
    const R = rows[src], km2 = cells.length * cellKm2;
    R.km2 += km2; R.bodies++; lakeKm2 += km2;
    const b = BINS.findIndex(x => km2 < x); R.bins[b] += km2; R.binN[b]++;
    let dB = 0, dZ = 0, low = cells[0];
    const lev = fin.lakeLevel[c];
    for (const x of cells) { dB += lev - before[x]; dZ += lev - fin.z[x]; if (fin.z[x] < fin.z[low]) low = x; }
    if (km2 >= 2e4) top.push({ km2, src, lat: lat[c], lon: lon[c], lev, depth: dZ / cells.length, depthBefore: dB / cells.length, max: lev - fin.z[low], h: hollowInfo[hollow[c]] ?? null });
    let iced = 0;
    for (const x of cells) { if (tectonic[x]) R.tect += cellKm2; if (ice[x] || basin[x] > 0.05) { R.ice += cellKm2; iced++; } }
    if (lake[c] === 1 && src !== 3 && !hollowInfo[hollow[c]]?.sea && iced < 0.5 * cells.length) { open.km2 += km2; open.bodies++; if (km2 > open.big) open.big = km2; }
}
console.log(`RESULT seed ${SEED} t ${TIME} cells ${CELLS} set ${arg('--set', '-')} lakeShare ${(100 * W.lakeShare).toFixed(2)} % lakes(no pans)/land ${(100 * lakeKm2 / landKm2).toFixed(2)} % fresh ${W.freshLakes} salt ${W.saltLakes} pans ${W.pans} kept ${JSON.stringify(W.keptPockets)} land ${(landKm2 / 1e6).toFixed(1)} Mkm² endo ${W.endorheicShare} ${((performance.now() - t0) / 1000).toFixed(0)} s`);
console.log(`  open fresh off the ice ${(open.km2 / 1e6).toFixed(3)} Mkm² = ${(100 * open.km2 / landKm2).toFixed(2)} % of land, ${(100 * open.km2 / Math.max(1, lakeKm2)).toFixed(0)} % of lakes, ${open.bodies} bodies, biggest ${(open.big / 1e3).toFixed(0)}K; without it ${(100 * (open.km2 - open.big) / landKm2).toFixed(2)} % of land`);
console.log(`  water stage ${Math.round(fin.ms.water)} ms`);
rows.forEach((R, i) => { if (R.bodies) console.log(`  ${NAMES[i].padEnd(13)} ${(R.km2 / 1e6).toFixed(2).padStart(6)} Mkm² ${String(R.bodies).padStart(5)} bodies; on tectonic mask ${(100 * R.tect / R.km2).toFixed(0)} %, ice ${(100 * R.ice / R.km2).toFixed(0)} %; by size <1K/10K/100K/1M/+ ${R.bins.map((b, j) => `${(b / 1e6).toFixed(2)}(${R.binN[j]})`).join(' ')}`); });
top.sort((a, b) => b.km2 - a.km2);
for (const t of top.slice(0, 24)) console.log(`  ${(t.km2 / 1e3).toFixed(0).padStart(5)}K ${NAMES[t.src].padEnd(12)} ${t.lat.toFixed(1)},${t.lon.toFixed(1)} level ${(1000 * t.lev).toFixed(0)} m, depth mean ${(1000 * t.depth).toFixed(0)} max ${(1000 * t.max).toFixed(0)} (pre-carve mean ${(1000 * t.depthBefore).toFixed(0)})` + (t.h ? `; hollow ${(t.h.km2 / 1e3).toFixed(0)}K level ${(1000 * t.h.level).toFixed(0)} floor ${(1000 * t.h.floor).toFixed(0)} now ${t.h.levelNow == null ? '-' : (1000 * t.h.levelNow).toFixed(0)} ${t.h.lake ? 'lake' : 'nolake'}${t.h.sea ? ' sea' : ''}${t.h.old ? ' old' : ''}${t.h.glacial ? ' glac' : ''}${t.h.closed ? ' closed' : ''} in ${Math.round(t.h.inflow)}` : ''));
if (process.argv.includes('--network')) {
    const { tAnnual, pAnnual } = fin.climate.cell, pet = c => Math.max(F.petMinMm, F.petBaseMm + F.petPerC * tAnnual[c]);
    console.log('network: ' + describe(networkShape({ mesh, recv: fin.layers.recv, land: c => !ocean[c], z: fin.z, lake, arid: c => pAnnual[c] < 0.5 * pet(c) })));
}
process.exit(0);
