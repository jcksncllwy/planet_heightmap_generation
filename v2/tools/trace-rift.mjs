// One body of water on a finished moment, below sea level, and why it is not sea: its floor, level, depth and volume; the
// crust under it (the history's frame); its sill to the world ocean and the barrier's length, on the surface before the carve
// and on the finished one; and its water balance.
//   node v2/tools/trace-rift.mjs --seed 831576 --time 340 --cells 2500000 --key <the page's history> --around 4.3,121.6 [--biggest] [--erode false]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { finishPlanet, oceanMask } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';
import { MinHeap } from '../js/core/min-heap.js';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('--seed', 831576)), TIME = Number(arg('--time', 340)), CELLS = Number(arg('--cells', 2500000)), SIM = Number(arg('--sim', 40000));
const F = { ...FINISH };
if (arg('--erode', null) !== null) F.erode = JSON.parse(arg('--erode'));
const frame = await momentFrame(ROOT, { seed: SEED, cont: Number(arg('--cont', DEFAULT_CONT)), sim: SIM, time: TIME, key: arg('--key', null), full: true });
const simMesh = buildSimMesh(SIM, MESH_SEED), pool = await TerrainPool.create(simMesh);
const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, debug: true, F, onStage: () => {} });
const { mesh, z, ocean, lake, lakeLevel } = fin, { lat, lon, before, hollow, hollowInfo, lakeSrc, rain } = fin.layers, { adjOffset, adjList, numCells: n, xyz } = mesh;
const a = 4 * Math.PI * 6371 ** 2 / n, R = 6371, tAnnual = fin.climate.cell.tAnnual;
const [la, lo] = arg('--around', '4.3,121.6').split(',').map(Number);
const away = c => { const d = Math.abs(lon[c] - lo); return Math.hypot(lat[c] - la, Math.min(d, 360 - d) * Math.cos(la * Math.PI / 180)); };
let at = -1;
for (let c = 0; c < n; c++) if (lake[c] && (at < 0 || away(c) < away(at))) at = c;
if (process.argv.includes('--biggest')) {
    // (or the biggest water: its cells joined whatever their kind, the system a neighbour-order test sees flip)
    const seen = new Uint8Array(n);
    let best = 0;
    for (let s = 0; s < n; s++) {
        if (seen[s] || !lake[s]) continue;
        const q = [s];
        seen[s] = 1;
        for (let i = 0; i < q.length; i++) for (let j = adjOffset[q[i]]; j < adjOffset[q[i] + 1]; j++) { const y = adjList[j]; if (!seen[y] && lake[y]) { seen[y] = 1; q.push(y); } }
        if (q.length > best) { best = q.length; at = s; }
    }
}
console.log(`nearest water to ${la},${lon === null ? '' : lo}: ${lat[at].toFixed(2)},${lon[at].toFixed(2)}, ${away(at).toFixed(2)}° off`);
// (the body: one kind, joined)
const inBody = new Uint8Array(n), body = [at];
inBody[at] = 1;
for (let i = 0; i < body.length; i++) for (let j = adjOffset[body[i]]; j < adjOffset[body[i] + 1]; j++) { const y = adjList[j]; if (!inBody[y] && lake[y] === lake[at]) { inBody[y] = 1; body.push(y); } }
let floor = Infinity, vol = 0, below = 0, P = 0, T = 0;
for (const c of body) { floor = Math.min(floor, z[c]); vol += (lakeLevel[c] - z[c]) * a; if (z[c] < 0) below++; P += rain[c]; T += tAnnual[c]; }
const h = hollowInfo[hollow[at]];
console.log(`BODY ${['', 'fresh', 'salt', 'pan'][lake[at]]}, src ${lakeSrc[at]}, ${Math.round(body.length * a)} km² (${(100 * below / body.length).toFixed(0)} % of it floored below sea level), level ${Math.round(1000 * lakeLevel[at])} m, floor ${Math.round(1000 * floor)} m, mean depth ${Math.round(1000 * vol / (body.length * a))} m, ${Math.round(vol)} km³; rain ${Math.round(P / body.length)} mm, ${(T / body.length).toFixed(1)} °C`);
// (its water balance full: what would evaporate off the whole hollow against what flows in. Near 1, the state is on a knife edge)
const pet = c => fin.layers?.pet?.[c] ?? 0 /* (the finish's own potential evaporation: the climate's Priestley–Taylor, debug layer) */;
let fullLoss = 0;
for (let c = 0; c < n; c++) if (hollow[c] === hollow[at] && z[c] < (h ? h.level : 0)) fullLoss += Math.max(0, F.lakeEvapShare * pet(c) - rain[c]) * 1e-6 * a;
if (h) console.log(`BALANCE inflow ${(h.inflow * 3.156e7 / 1e9).toFixed(1)} km³/yr against ${fullLoss.toFixed(1)} off the hollow full: ratio ${(h.inflow * 3.156e7 / 1e9 / fullLoss).toFixed(2)}`);
if (h) console.log(`HOLLOW ${JSON.stringify({ km2: Math.round(h.km2), rim: Math.round(1000 * h.level), levelNow: Math.round(1000 * h.levelNow), floor: Math.round(1000 * h.floor), sea: h.sea, closed: h.closed, inflowKm3: +(h.inflow * 3.156e7 / 1e9).toFixed(1) })}`);
// (the crust under it: the frame's nearest sim cell)
const sx = simMesh.xyz, N = simMesh.numCells, kinds = new Map(), owners = new Map();
const near = c => { let b = 0, bd = Infinity; for (let w = 0; w < N; w++) { const d = (sx[3 * w] - xyz[3 * c]) ** 2 + (sx[3 * w + 1] - xyz[3 * c + 1]) ** 2 + (sx[3 * w + 2] - xyz[3 * c + 2]) ** 2; if (d < bd) { bd = d; b = w; } } return b; };
const seenW = new Set();
for (let i = 0; i < body.length; i += Math.max(1, Math.floor(body.length / 2000))) seenW.add(near(body[i]));
let young = 0, ages = [];
for (const w of seenW) {
    const k = frame.type[w] === 0 ? 'oceanic' : 'continental';
    kinds.set(k, (kinds.get(k) ?? 0) + 1); owners.set(frame.owner[w], (owners.get(frame.owner[w]) ?? 0) + 1);
    if (frame.type[w] === 0) { ages.push(TIME - frame.formedAt[w]); if (TIME - frame.formedAt[w] < 50) young++; }
}
ages.sort((x, y) => x - y);
console.log(`CRUST over ${seenW.size} sim cells: ${JSON.stringify(Object.fromEntries(kinds))}, plates ${JSON.stringify(Object.fromEntries(owners))}; oceanic ages Myr ${ages.length ? `${ages[0].toFixed(0)}…${ages[ages.length - 1].toFixed(0)} (median ${ages[ages.length >> 1].toFixed(0)}, under 50: ${young})` : 'none'}`);
// (its sill to the world ocean, the barrier's dry length, the strait rule's weight on it)
const smooth = (x0, x1, x) => { const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0))); return t * t * (3 - 2 * t); };
const sill = (zz, label) => {
    const oc = oceanMask(mesh, zz), fill = new Float32Array(n).fill(Infinity), parent = new Int32Array(n).fill(-1), heap = new MinHeap(1 << 16), done = new Uint8Array(n);
    let inSea = 0;
    for (const c of body) if (oc[c]) inSea++;
    for (let c = 0; c < n; c++) if (oc[c]) { fill[c] = -Infinity; done[c] = 1; for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const y = adjList[k]; if (!oc[y]) { const v = Math.max(0, zz[y]); if (v < fill[y]) { fill[y] = v; parent[y] = c; heap.push(v, y); } } } }
    while (heap.size) {
        const c = heap.pop();
        if (done[c]) continue;
        done[c] = 1;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const y = adjList[k]; if (done[y]) continue; const v = Math.max(fill[c], Math.max(0, zz[y])); if (v < fill[y]) { fill[y] = v; parent[y] = c; heap.push(v, y); } }
    }
    let deep = body[0];
    for (const c of body) if (zz[c] < zz[deep]) deep = c;
    let km = 0, top = 0, cells = 0, dryCells = 0, c = deep;
    for (let g = 0; c >= 0 && !oc[c] && g < 1e6; g++) { const p = parent[c]; if (zz[c] > top) top = zz[c]; if (zz[c] >= 0) { dryCells++; if (p >= 0) km += R * Math.hypot(xyz[3 * p] - xyz[3 * c], xyz[3 * p + 1] - xyz[3 * c + 1], xyz[3 * p + 2] - xyz[3 * c + 2]); } cells++; c = p; }
    const open = (1 - smooth(F.straitSillM[0], F.straitSillM[1], 1000 * top)) * (1 - smooth(F.straitKm[0], F.straitKm[1], km));
    console.log(`SILL ${label}: body cells in the world ocean ${inSea}/${body.length}; deepest ${Math.round(1000 * zz[deep])} m; spill path ${cells} cells, ${dryCells} dry, ${Math.round(km)} km over dry land, sill ${Math.round(1000 * top)} m; the strait rule's weight ${open.toFixed(2)} (opens over 0.5), reaches the sea at ${c >= 0 ? `${lat[c].toFixed(1)},${lon[c].toFixed(1)}` : '-'}`);
};
sill(before, 'before the carve');
sill(z, 'finished');
console.log('stats', JSON.stringify({ straits: fin.stats.straits ?? null, cutOffSeas: fin.stats.cutOffSeas?.length ?? fin.stats.cutOffSeas ?? null, biggest: fin.stats.water.biggestLakesKm2 }));
process.exit(0);
