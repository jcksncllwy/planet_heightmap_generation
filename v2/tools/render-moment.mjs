// A detailed moment — the Evolution page's "Add detail" — rendered headlessly, for before/after comparisons of the finish:
// the history built to the moment (as the page builds it; cached in v2/out/frames/), the finish at the detail asked for,
// and the page's own painting of it (evolution/finish-view.js paintFinished: the palette, hillshade, lakes) written as
// PNGs — the planet and, optionally, a crop. Then the water the finish left, and any dry hollow: every dry cell's depth
// below the level water would stand at (a priority flood from the sea over the finished surface, lakes as water) — the
// "holes in the ground" a dried-out inland sea leaves.
//
//   node --max-old-space-size=16000 v2/tools/render-moment.mjs --seed 799224 --cont 30 --time 290
//        [--sim 40000] [--cells 2500000] [--width 4096] [--crop lon0,lon1,lat0,lat1] [--out name] [--palette relief]
//
// The page's link ?seed=…&cont=…&sim=… gives --seed, --cont and --sim; the moment is --time (Myr). Output: v2/out/moments/.

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { PNG } from 'pngjs';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { runHistory } from '../js/app/history-runner.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { TerrainPool, FRAME_FIELDS } from '../js/terrain/terrain-pool.js';
import { finishPlanet, finishRaster } from '../js/finish/finish.js';
import { paintFinished } from '../js/evolution/finish-view.js';
import { heightLutOf } from '../js/evolution/looks.js';
import { MinHeap } from '../js/core/min-heap.js';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('--seed', 12345)), CONT = Number(arg('--cont', 30)), SIM = Number(arg('--sim', 40000)), TIME = Number(arg('--time', 300));
const CELLS = Number(arg('--cells', 2500000)), W = Number(arg('--width', 4096)), PALETTE = arg('--palette', 'relief');
const CROP = arg('--crop', null)?.split(',').map(Number) ?? null;
const NAME = arg('--out', `moment-${SEED}-${TIME}-${Math.round(CELLS / 1000)}k`);
const MESH_SEED = 12345;                              // (the page's: every planet's sim mesh is the same; the seed shapes the world)
const R = 6371, t0 = performance.now(), secs = () => `${((performance.now() - t0) / 1000).toFixed(0)} s`;

// ── the moment's frame: the history as the page builds it (scene 'cycle', ending none), to the moment; cached ──
const frameDir = path.join(ROOT, 'v2', 'out', 'frames');
const frameFile = path.join(frameDir, `frame-${SEED}-${CONT}-${SIM}-${TIME}.bin`);
let frame;
if (fs.existsSync(frameFile)) frame = v8.deserialize(fs.readFileSync(frameFile)).frame;
else {
    const scene = TERRAIN_SCENES.find(s => s.id === 'cycle');
    // (the history is causal — Keep going runs on to the same history — so running to just past the moment gives it)
    await runHistory({ list: 'terrain', scene, ending: 'none', start: { continentalFraction: CONT / 100 }, lengthMyr: Math.ceil((TIME + 10) / 10) * 10, keep: false },
        buildSimMesh(SIM, MESH_SEED), SEED, 10, () => {}, f => {
            if (Math.abs(f.time - TIME) < 1e-6) { frame = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]])); frame.plates = f.plates.map(p => p && { quat: p.quat }); }
        });
    if (!frame) throw new Error(`no frame at ${TIME} Myr (moments come every 10 Myr)`);
    fs.mkdirSync(frameDir, { recursive: true });
    fs.writeFileSync(frameFile, v8.serialize({ frame }));
}
console.log(`frame ${TIME} Myr of seed ${SEED} (${secs()})`);

// ── the finish, as the page's worker runs it ──
const simMesh = buildSimMesh(SIM, MESH_SEED), pool = await TerrainPool.create(simMesh);
const DEBUG = process.argv.includes('--debug');
const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, debug: DEBUG, onStage: s => process.stdout.write(`${s}… `) });
console.log(`\nfinished at ${CELLS.toLocaleString()} cells (${secs()}); stages ms: ${Object.entries(fin.ms).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ')}`);

// ── the picture, painted as the page paints it ──
const raster = finishRaster(fin.mesh, fin.z, fin.ocean, W, null, fin.lake, fin.lakeLevel, null);
const H = W >> 1, image = { data: new Uint8ClampedArray(W * H * 4) };
paintFinished(raster, { width: W, image }, heightLutOf(PALETTE), { lakes: true, exaggeration: 20 });
const outDir = path.join(ROOT, 'v2', 'out', 'moments');
fs.mkdirSync(outDir, { recursive: true });
const writePng = (file, w, h, rgba) => { const p = new PNG({ width: w, height: h }); p.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength); fs.writeFileSync(file, PNG.sync.write(p)); };
writePng(path.join(outDir, `${NAME}.png`), W, H, image.data);
if (CROP) {
    const [lo0, lo1, la0, la1] = CROP, x0 = Math.floor((lo0 + 180) / 360 * W), x1 = Math.ceil((lo1 + 180) / 360 * W);
    const y0 = Math.floor((90 - la1) / 180 * H), y1 = Math.ceil((90 - la0) / 180 * H), cw = x1 - x0, ch = y1 - y0, crop = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) crop.set(image.data.subarray(4 * ((y0 + y) * W + x0), 4 * ((y0 + y) * W + x1)), 4 * y * cw);
    writePng(path.join(outDir, `${NAME}-crop.png`), cw, ch, crop);
}
console.log(`pictures → ${path.relative(ROOT, outDir)}/${NAME}${CROP ? '{,-crop}' : ''}.png (${secs()})`);

// ── the water, and the dry hollows: each dry land cell's depth below where water would stand (flood from the sea,
// lakes counted at their level) ──
const { adjOffset, adjList, numCells: n, xyz } = fin.mesh, cellKm2 = 4 * Math.PI * R * R / n, z = fin.z, lake = fin.lake, lev = fin.lakeLevel;
const fill = new Float32Array(n).fill(Infinity), heap = new MinHeap(1 << 16);
for (let c = 0; c < n; c++) if (fin.ocean[c]) { fill[c] = 0; heap.push(0, c); }
while (heap.size) {
    const c = heap.pop(), f = fill[c];
    for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
        const nb = adjList[k], ground = lake?.[nb] && lake[nb] !== 3 && lev[nb] === lev[nb] ? Math.max(z[nb], lev[nb]) : z[nb], g = Math.max(f, ground);
        if (g < fill[nb]) { fill[nb] = g; heap.push(g, nb); }
    }
}
const kinds = ['', 'fresh lake', 'salt lake', 'salt pan'], kindKm2 = [0, 0, 0, 0];
let dryBelowSea = 0, deepest = 0, deepestAt = -1;
const holeKm2 = { 50: 0, 150: 0, 300: 0 };
for (let c = 0; c < n; c++) {
    if (fin.ocean[c]) continue;
    if (lake?.[c]) { kindKm2[lake[c]] += cellKm2; if (lake[c] !== 3) continue; }
    if (z[c] < 0 && lake?.[c] !== 1 && lake?.[c] !== 2) dryBelowSea += cellKm2;
    const d = (fill[c] - z[c]) * 1000;                            // m below where water would stand
    for (const m of Object.keys(holeKm2)) if (d > Number(m)) holeKm2[m] += cellKm2;
    if (d > deepest) { deepest = d; deepestAt = c; }
}
const latOf = c => (Math.asin(Math.max(-1, Math.min(1, xyz[3 * c + 2]))) * 180 / Math.PI).toFixed(1), lonOf = c => (Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * 180 / Math.PI).toFixed(1);
// (the biggest dry hollows, each a connected patch of land more than 50 m below where water would stand)
const isHole = c => !fin.ocean[c] && !(lake?.[c] === 1 || lake?.[c] === 2) && (fill[c] - z[c]) > 0.05;
const seenHole = new Uint8Array(n), holes = [];
for (let s = 0; s < n; s++) {
    if (seenHole[s] || !isHole(s)) continue;
    const cells = [s];
    seenHole[s] = 1;
    let maxD = 0, at = s, wet = false;
    for (let i = 0; i < cells.length; i++) {
        const c = cells[i], d = fill[c] - z[c];
        if (d > maxD) { maxD = d; at = c; }
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (lake?.[nb]) wet = true; if (!seenHole[nb] && isHole(nb)) { seenHole[nb] = 1; cells.push(nb); } }
    }
    holes.push({ km2: cells.length * cellKm2, depthM: maxD * 1000, at, wet });
}
holes.sort((a, b) => b.km2 - a.km2);
const empty = holes.filter(h => !h.wet), emptyKm2 = m => Math.round(empty.filter(h => h.depthM > m).reduce((a, h) => a + h.km2, 0));
console.log(`empty basins (dry hollows with no water in or beside them): deeper than 150 m ${emptyKm2(150).toLocaleString()} km², deeper than 300 m ${emptyKm2(300).toLocaleString()} km²`);
console.log('biggest empty basins: ' + empty.slice(0, 8).map(h => `${latOf(h.at)}°,${lonOf(h.at)}° ${Math.round(h.km2).toLocaleString()} km² ${Math.round(h.depthM)} m`).join(' · '));
console.log(`water: ${kinds.slice(1).map((k, i) => `${k}s ${Math.round(kindKm2[i + 1]).toLocaleString()} km²`).join(' · ')}`);
console.log(`dry hollows (land below where water would stand): >50 m ${Math.round(holeKm2[50]).toLocaleString()} km² · >150 m ${Math.round(holeKm2[150]).toLocaleString()} km² · >300 m ${Math.round(holeKm2[300]).toLocaleString()} km²` +
    `; deepest ${Math.round(deepest)} m${deepestAt >= 0 ? ` at ${latOf(deepestAt)}°, ${lonOf(deepestAt)}°` : ''}; dry land below sea level ${Math.round(dryBelowSea).toLocaleString()} km²`);
if (DEBUG && fin.layers?.terminal) console.log('terminal basins (inflow, full evaporation m³/s):', JSON.stringify(fin.layers.terminal));
if (fin.stats?.water) console.log('hydrology:', JSON.stringify(fin.stats.water).slice(0, 400));
// (--probe "lat,lon;lat,lon": what the finish made of each place — its height, water kind and level)
const PROBE = arg('--probe', null);
if (PROBE) for (const pt of PROBE.split(';')) {
    const [la, lo] = pt.split(',').map(Number), D = Math.PI / 180, px = Math.cos(la * D) * Math.cos(lo * D), py = Math.cos(la * D) * Math.sin(lo * D), pz = Math.sin(la * D);
    let best = 0, bd = -2;
    for (let c = 0; c < n; c++) { const d = xyz[3 * c] * px + xyz[3 * c + 1] * py + xyz[3 * c + 2] * pz; if (d > bd) { bd = d; best = c; } }
    const c = best, kind = lake?.[c] ? kinds[lake[c]] : fin.ocean[c] ? 'sea' : 'land';
    console.log(`probe ${la}°,${lo}°: ${kind}, ground ${Math.round(z[c] * 1000)} m${lake?.[c] ? `, water at ${Math.round(lev[c] * 1000)} m` : ''}, water would stand at ${Math.round(fill[c] * 1000)} m`);
}
fs.writeFileSync(path.join(outDir, `${NAME}.json`), JSON.stringify({ seed: SEED, cont: CONT, sim: SIM, time: TIME, cells: CELLS, water: Object.fromEntries(kinds.slice(1).map((k, i) => [k, kindKm2[i + 1]])),
    dryHollowKm2: holeKm2, deepestDryM: deepest, dryBelowSeaKm2: dryBelowSea, stats: fin.stats }, null, 2));
