// The travel graph (plans/CIV_PLAN.md §10, stage T0; v2/js/civ/routes.js) on one world built as the page builds it, with
// the planet's monthly winds and currents: how fast each craft goes where, by month, and maps of the days from a place.
//
//   sim-slots run -n 1 --gb 3 -- node --max-old-space-size=8000 v2/tools/civ-travel.mjs [--seed 6] [--from lat,lon]
//
// Output: a table, and v2/out/civ/travel/<seed>-<craft>-<month>.png (days from the place: ≤ 1 day bright → a year dark).
// The world is cached apart from the ensemble's (theirs predate the winds, and the fingerprints are run on them).

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { OUT, MESH_SEED, frameOf, worldCode, writePng, pixelCells, ramp, drawText } from './lib/civ-world.mjs';
import { buildSimMesh, meshFromArrays } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { finishPlanet } from '../js/finish/finish.js';
import { civWorldFromFinish } from '../js/civ/civ-page.js';
import { civSubstrate } from '../js/civ/substrate.js';
import { travelGraph, travelDays, Craft, CRAFT_NAMES } from '../js/civ/routes.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('--seed', 6)), SIM = 40000, CELLS = 160000;
const spec = { seed: SEED, cont: [25, 30, 35, 40][SEED % 4], time: [200, 300, 400, 500, 600][SEED % 5] };
const D = Math.PI / 180;

/** The world as the page has it, with its winds and currents, cached. */
async function travelWorld({ seed, cont, time }) {
    const file = path.join(OUT, 'cache', `travel-${seed}-${cont}-${SIM}-${time}-${CELLS / 1000}k-${worldCode()}.bin`);
    if (fs.existsSync(file)) { const w = v8.deserialize(fs.readFileSync(file)); w.mesh = meshFromArrays(w.mesh); return w; }
    const simMesh = buildSimMesh(SIM, MESH_SEED), frame = await frameOf(seed, { cont, sim: SIM, time });
    const fin = await finishPlanet({ frame, simMesh, seed, cells: CELLS, pool: await TerrainPool.create(simMesh), closePool: true, civ: true });
    const w = civWorldFromFinish(fin), { mesh } = w;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, v8.serialize({ ...w, mesh: { numCells: mesh.numCells, xyz: mesh.xyz, adjOffset: mesh.adjOffset, adjList: mesh.adjList } }));
    return w;
}

const t0 = performance.now(), w = await travelWorld(spec), sub = civSubstrate(w), { mesh } = w, n = mesh.numCells;
console.log(`world ${SEED} (${spec.cont} % continent, ${spec.time} Myr), ${n.toLocaleString()} cells; winds and currents: ${w.flow ? `${w.flow.w}×${w.flow.h} grid` : 'none'} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
if (w.flow) {
    const mag = (U, V) => { let s = 0; for (let i = 0; i < U.length; i++) s += Math.hypot(U[i], V[i]); return s / U.length; };
    console.log(`  mean wind ${mag(w.flow.windU, w.flow.windV).toFixed(1)} m/s, mean current ${mag(w.flow.curU, w.flow.curV).toFixed(2)} m/s (all months, all the grid)`);
}

// ── each craft: km a day over each kind of edge, by month (the median over edges of the kind) ──
const { adjOffset, adjList } = mesh, water = c => w.ocean[c] || w.lake[c];
const kinds = { land: [], river: [], coast: [], sea: [] };
for (let c = 0; c < n; c++) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
    const b = adjList[k];
    if (!water(c) && !water(b)) (sub.river.q[c] >= 100 && sub.river.q[b] >= 100 ? kinds.river : kinds.land).push(k);
    else if (w.ocean[c] && w.ocean[b]) kinds.sea.push(k);
    else kinds.coast.push(k);
}
const len = new Float32Array(adjList.length);
for (let c = 0; c < n; c++) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const b = adjList[k], x = mesh.xyz; len[k] = 6371 * Math.acos(Math.min(1, x[3 * c] * x[3 * b] + x[3 * c + 1] * x[3 * b + 1] + x[3 * c + 2] * x[3 * b + 2])); }
const median = a => { const s = a.filter(v => v === v).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const graphs = [Craft.FOOT, Craft.PADDLE, Craft.SAIL].map(cr => travelGraph(w, sub, cr));
for (const g of graphs) {
    const row = Object.entries(kinds).map(([kind, ks]) => {
        const by = [0, 6].map(m => median(ks.map(k => (g.days[m * g.E + k] < Infinity ? len[k] / g.days[m * g.E + k] : 0))));
        return `${kind} ${by.map(v => v.toFixed(0)).join('/')}`;
    });
    console.log(`  ${CRAFT_NAMES[g.craft].padEnd(14)} km/day (Jan/Jul, median): ${row.join(' · ')}`);
}
// (sail: how much the wind's direction matters — an edge's days against its reverse's, at sea)
{
    const g = graphs[2], ratio = [];
    for (let c = 0; c < n; c++) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
        const b = adjList[k];
        if (!(w.ocean[c] && w.ocean[b]) || b < c) continue;
        let r = -1; for (let j = adjOffset[b]; j < adjOffset[b + 1]; j++) if (adjList[j] === c) r = j;
        if (r >= 0) ratio.push(Math.max(g.days[k], g.days[r]) / Math.min(g.days[k], g.days[r]));
    }
    ratio.sort((x, y) => x - y);
    console.log(`  sail at sea: an edge's slow way against its fast way, ×${ratio[ratio.length >> 1].toFixed(2)} (median), ×${ratio[Math.floor(0.9 * ratio.length)].toFixed(2)} (90th percentile), January`);
}

// ── maps: days from a place, by craft, January and July ──
const from = arg('--from', null)?.split(',').map(Number);
let src;
if (from?.length === 2 && from.every(Number.isFinite)) { const [fla, flo] = from; src = mesh.index.nearest(Math.cos(fla * D) * Math.cos(flo * D), Math.cos(fla * D) * Math.sin(flo * D), Math.sin(fla * D)); }
else { src = -1; let best = -1; for (let c = 0; c < n; c++) if (sub.coastal[c] && !w.ocean[c] && !w.lake[c] && !w.ice?.[c] && sub.river.q[c] > best) { best = sub.river.q[c]; src = c; } }   // (the biggest river's mouth, free of ice)
const sx = mesh.xyz, slat = Math.asin(sx[3 * src + 2]) / D, slon = Math.atan2(sx[3 * src + 1], sx[3 * src]) / D;
console.log(`from ${slat.toFixed(1)}, ${slon.toFixed(1)}:`);
const W = 1024, H = W >> 1, pix = pixelCells(mesh, W), dir = path.join(OUT, 'travel');
fs.mkdirSync(dir, { recursive: true });
for (const g of graphs) for (const m of [0, 6]) {
    const t = travelDays(mesh, g, src, m), img = new Uint8Array(W * H * 4);
    let reach = [0, 0, 0];
    for (let c = 0; c < n; c++) if (!w.ocean[c]) { if (t[c] <= 30) reach[0]++; if (t[c] <= 90) reach[1]++; if (t[c] <= 365) reach[2]++; }
    for (let i = 0; i < W * H; i++) {
        const c = pix[i], d = t[c], o = 4 * i;
        if (d < Infinity) {
            // (bright near, dark far: log days, 1 → 365; bands every doubling)
            const u = Math.log2(Math.max(1, d)) / Math.log2(365), rgb = ramp(1 - u), band = Math.abs((Math.log2(Math.max(1, d)) % 1) - 0.5) < 0.04 ? 0.6 : 1, sea = w.ocean[c] ? 0.75 : 1;
            img[o] = rgb[0] * band * sea; img[o + 1] = rgb[1] * band * sea; img[o + 2] = rgb[2] * band * sea;
        } else if (w.ocean[c]) { img[o] = 12; img[o + 1] = 20; img[o + 2] = 40; } else { img[o] = img[o + 1] = img[o + 2] = 40; }
        img[o + 3] = 255;
    }
    const px = Math.round((slon + 180) / 360 * W), py = Math.round((90 - slat) / 180 * H);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const o = 4 * (((py + dy + H) % H) * W + ((px + dx + W) % W)); img[o] = img[o + 1] = img[o + 2] = 255; }
    const name = `${SEED}-${['foot', 'paddle', 'sail'][g.craft]}-${m ? 'jul' : 'jan'}.png`;
    drawText(img, W, H, 24, 12, m + 1);   // (the month's number: the small font has digits only)
    writePng(path.join(dir, name), W, H, img);
    const cellKm2 = sub.cellKm2;
    console.log(`  ${CRAFT_NAMES[g.craft].padEnd(14)} ${m ? 'July' : 'January'}: land within a month ${(reach[0] * cellKm2 / 1e6).toFixed(1)} M km², 3 months ${(reach[1] * cellKm2 / 1e6).toFixed(1)}, a year ${(reach[2] * cellKm2 / 1e6).toFixed(1)}  → ${name}`);
}
