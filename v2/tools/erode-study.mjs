// The erosion study (finish-erode.js; lane erosion, 2026-10-30): one finished moment, with or without the time-stepped erosion,
// measured: lakes, rivers, hypsometry, time. One RESULT line of JSON, for the report's tables.
//   node v2/tools/erode-study.mjs --seed 831576 --time 310 --cells 640000 [--erode '{"timeMyr":1,"steps":20}'] [--set key=value,…] [--label name]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';
import { Water } from '../js/finish/finish-hydro.js';
import { networkShape, describe } from './lib/river-network.mjs';
import { landWater } from './lib/land-water.mjs';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('--seed', 831576)), CONT = Number(arg('--cont', 30)), SIM = Number(arg('--sim', 40000)), TIME = Number(arg('--time', 310)), CELLS = Number(arg('--cells', 640000));
const F = { ...FINISH };
for (const kv of (arg('--set', '') || '').split(/,(?=[A-Za-z_])/).filter(Boolean)) { const [k, v] = kv.split('='); F[k] = Number.isFinite(Number(v)) ? Number(v) : JSON.parse(v); }
const erode = arg('--erode', null);
if (erode) F.erode = JSON.parse(erode);
const frame = await momentFrame(ROOT, { seed: SEED, cont: CONT, sim: SIM, time: TIME });
const simMesh = buildSimMesh(SIM, MESH_SEED), pool = await TerrainPool.create(simMesh);
const t0 = performance.now();
const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, debug: true, F, onStage: () => {} });
const seconds = (performance.now() - t0) / 1000;
const { mesh, z, ocean, lake } = fin, { ice, basin, lakeSrc } = fin.layers, n = mesh.numCells, cellKm2 = 4 * Math.PI * 6371 ** 2 / n;
let land = 0, low = 0, fresh = 0, salt = 0, pan = 0, openFree = 0, sum = 0;
for (let c = 0; c < n; c++) {
    if (ocean[c] && !lake[c]) continue;
    land++; sum += z[c]; if (z[c] < 0.4) low++;
    if (lake[c] === Water.SALT) salt++;
    else if (lake[c] === Water.PAN) pan++;
    else if (lake[c] === Water.FRESH) { fresh++; if (!ice[c] && !(basin[c] > 0.05)) openFree++; }
}
const W = fin.stats.water, LW = landWater(fin, simMesh, frame), pct = v => +(100 * v / land).toFixed(3);
const { tAnnual, pAnnual } = fin.climate.cell, pet = c => Math.max(F.petMinMm, F.petBaseMm + F.petPerC * tAnnual[c]);
const net = networkShape({ mesh, recv: fin.layers.recv, land: c => !ocean[c], z, lake, arid: c => pAnnual[c] < 0.5 * pet(c) });
const out = { label: arg('--label', erode ?? 'base'), seed: SEED, time: TIME, cells: CELLS, seconds: +seconds.toFixed(1),
    lakeShare: +(100 * W.lakeShare).toFixed(2), lakes: pct(fresh + salt), fresh: pct(fresh), salt: pct(salt), pan: pct(pan), openFreeNonGlacial: pct(openFree), onLand: +(100 * LW.onLandKm2 / LW.landKm2).toFixed(2),
    largestMkm2: +((LW.onLand[0]?.km2 ?? 0) / 1e6).toFixed(3), largest: LW.onLand[0]?.kind, largestAt: LW.onLand[0]?.at, top: LW.onLand.slice(0, 5).map(L => `${(L.km2 / 1e6).toFixed(2)}${L.kind[0]}@${L.at}`), freshLakes: W.freshLakes, saltLakes: W.saltLakes, pans: W.pans,
    endo: W.endorheicShare, landBelow400: pct(low), meanKm: +(sum / land).toFixed(3), belowSpillPct: +(100 * LW.belowKm2 / LW.landKm2).toFixed(2), hack: +net.hack.h.toFixed(2), horton: +net.horton.rb.toFixed(2), junction: +net.junction.medianDeg.toFixed(0),
    deadLevel: +(100 * net.broom.flatShare).toFixed(1), rising: +(100 * net.broom.riseShare).toFixed(1), straight: +(100 * net.broom.straightShare).toFixed(1), plainSinP90: +net.sinuosity.plainP90.toFixed(2), plainGrade: net.plainGrade.median, cutCells: W.cutCells, nan: W.nanHeights,
    ms: Object.fromEntries(Object.entries(fin.ms).map(([k, v]) => [k, Math.round(v)])), erodeMs: fin.stats.erode?.ms };
console.log('RESULT ' + JSON.stringify(out));
if (fin.stats.erode?.levels) console.log('LEVELS ' + JSON.stringify(fin.stats.erode.levels.map(L => ({ cells: L.cells, t: L.timeMyr, steps: L.steps, s: L.seconds, shown: L.last?.shownMkm2, budget: L.budget }))) + ' polish ' + JSON.stringify(fin.stats.erodeLate?.ms));
else if (fin.stats.erode) console.log('CURVE ' + fin.stats.erode.curve.map(p => `${p.t}:${p.lakeMkm2}(${p.lakes}; shown ${p.shownMkm2}/${p.shown}; 1-cell ${p.one}) e${p.erodedKm3} k${p.keptKm3} s${p.seaKm3} c${p.closedKm3}`).join(' | '));
if (fin.stats.erode?.survivors) { const V = fin.stats.erode.survivors; console.log('SURVIVORS ' + JSON.stringify({ byAge: V.byAge, shallow30m: V.shallow30m, smallInflow: V.smallInflow })); for (const h of V.top) console.log('  ' + JSON.stringify(h)); }
if (fin.stats.census) for (const [k, v] of Object.entries(fin.stats.census)) console.log('CENSUS ' + k.padEnd(30) + JSON.stringify(v));
// the fresh lakes off the ice: the biggest, and what they stand on
{
    const { adjOffset, adjList } = mesh, seen = new Uint8Array(n), bodies = [];
    for (let s = 0; s < n; s++) {
        if (seen[s] || lake[s] !== Water.FRESH) continue;
        const q = [s];
        seen[s] = 1;
        let iced = 0, deep = 0, dz = 0, nearIce = 0;
        for (let i = 0; i < q.length; i++) {
            const c = q[i];
            if (ice[c]) iced++;
            if (basin[c] > 0.05) deep++;
            dz += fin.lakeLevel[c] - z[c];
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (ice[y]) nearIce = 1; if (!seen[y] && lake[y] === Water.FRESH) { seen[y] = 1; q.push(y); } }
        }
        bodies.push({ km2: Math.round(q.length * cellKm2), depthM: Math.round(1000 * dz / q.length), lat: +fin.layers.lat[s].toFixed(1), lon: +fin.layers.lon[s].toFixed(1), level: Math.round(1000 * fin.lakeLevel[s]), iced: +(iced / q.length).toFixed(2), dug: +(deep / q.length).toFixed(2), src: lakeSrc[s], touchesIce: nearIce });
    }
    const off = bodies.filter(b => b.iced < 0.5 && b.dug < 0.5).sort((a, b) => b.km2 - a.km2), sum = f => +(off.filter(f).reduce((v, b) => v + b.km2, 0) / 1e6).toFixed(3);
    console.log('OFFICE ' + JSON.stringify({ bodies: off.length, Mkm2: sum(() => true), touchingIce: sum(b => b.touchesIce), under30m: sum(b => b.depthM < 30), bySrc: [1, 2, 3, 4, 5, 6, 7].map(i => sum(b => b.src === i)) }));
    for (const b of off.slice(0, 10)) console.log('  ' + JSON.stringify(b));
}
// every big body: how shallow, how ragged (shore cells over those of a disc of its area)
{
    const { adjOffset, adjList } = mesh, seen = new Uint8Array(n), big = [];
    for (let s = 0; s < n; s++) {
        if (seen[s] || !(lake[s] === Water.FRESH || lake[s] === Water.SALT)) continue;
        const q = [s];
        seen[s] = 1;
        let dz = 0, shore = 0, deep = 0;
        for (let i = 0; i < q.length; i++) {
            const c = q[i], d = fin.lakeLevel[c] - z[c];
            dz += d; if (d > deep) deep = d;
            let edge = 0;
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (lake[y] !== lake[s]) edge = 1; else if (!seen[y]) { seen[y] = 1; q.push(y); } }
            shore += edge;
        }
        if (q.length * cellKm2 >= 5e4) big.push({ km2: Math.round(q.length * cellKm2), kind: lake[s] === Water.SALT ? 's' : 'f', meanM: Math.round(1000 * dz / q.length), maxM: Math.round(1000 * deep), rag: +(shore / (2 * Math.sqrt(Math.PI * q.length))).toFixed(1), lat: +fin.layers.lat[s].toFixed(1), lon: +fin.layers.lon[s].toFixed(1), src: lakeSrc[s] });
    }
    big.sort((a, b) => b.km2 - a.km2);
    let sheet = 0, bigKm2 = 0;
    for (const b of big) { bigKm2 += b.km2; if (b.meanM < 30) sheet += b.km2; }
    console.log('BIG ' + JSON.stringify({ over50k: big.length, Mkm2: +(bigKm2 / 1e6).toFixed(3), sheetsUnder30mMkm2: +(sheet / 1e6).toFixed(3), meanRag: +(big.reduce((v, b) => v + b.rag * b.km2, 0) / (bigKm2 || 1)).toFixed(1) }));
    for (const b of big.slice(0, 8)) console.log('  ' + JSON.stringify(b));
}
process.exit(0);
