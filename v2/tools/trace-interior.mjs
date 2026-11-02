// A continent's lakes: what share of it is water, how many bodies of what size, and of what kind by the air they stand in and
// the catchment that feeds them. With --around, the water nearest a point (a hover on the page) and its balance.
//   node v2/tools/trace-interior.mjs --seed 831576 --time 430 --cells 2500000 --key <the page's history> --around 24.9,-26.9 [--match 801,20.4,420] [--erode false] [--set key=value,…]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('--seed', 831576)), TIME = Number(arg('--time', 430)), CELLS = Number(arg('--cells', 2500000)), SIM = Number(arg('--sim', 40000));
const F = { ...FINISH };
for (const kv of (arg('--set', '') || '').split(/,(?=[A-Za-z_])/).filter(Boolean)) { const [k, v] = kv.split('='); F[k] = Number.isFinite(Number(v)) ? Number(v) : JSON.parse(v); }
if (arg('--erode', null) !== null) F.erode = JSON.parse(arg('--erode'));
const frame = await momentFrame(ROOT, { seed: SEED, cont: Number(arg('--cont', 30)), sim: SIM, time: TIME, key: arg('--key', null) });
const simMesh = buildSimMesh(SIM, MESH_SEED), pool = await TerrainPool.create(simMesh);
const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, debug: true, F, onStage: () => {} });
const { mesh, z, ocean, lake, lakeLevel } = fin, { lat, lon, hollow, hollowInfo, lakeSrc } = fin.layers, { adjOffset, adjList, numCells: n } = mesh, a = 4 * Math.PI * 6371 ** 2 / n;
const { tAnnual, pAnnual } = fin.climate.cell, pet = c => Math.max(F.petMinMm, F.petBaseMm + F.petPerC * tAnnual[c]);
const land = c => !ocean[c] || lake[c] > 0, NAME = ['dry', 'fresh', 'salt', 'pan'];

// (the continents: land joined by adjacency, its lakes in it)
const cont = new Int32Array(n).fill(-1), conts = [];
for (let s = 0; s < n; s++) {
    if (cont[s] >= 0 || !land(s)) continue;
    const q = [s], id = conts.length;
    cont[s] = id;
    for (let i = 0; i < q.length; i++) for (let j = adjOffset[q[i]]; j < adjOffset[q[i] + 1]; j++) { const y = adjList[j]; if (cont[y] < 0 && land(y)) { cont[y] = id; q.push(y); } }
    conts.push({ id, cells: q.length, water: { 1: 0, 2: 0, 3: 0 }, bins: [0, 0, 0, 0], kinds: { 1: 0, 2: 0, 3: 0 } });
}
// (the bodies: one kind, joined by adjacency)
const seen = new Uint8Array(n), bodies = [];
for (let s = 0; s < n; s++) {
    if (seen[s] || !lake[s]) continue;
    const q = [s];
    seen[s] = 1;
    let rain = 0, evap = 0, depth = 0, sLat = 0, sLon = 0;
    for (let i = 0; i < q.length; i++) {
        const c = q[i];
        rain += pAnnual[c]; evap += pet(c); depth += lakeLevel[c] - z[c]; sLat += lat[c]; sLon += lon[c];
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (!seen[y] && lake[y] === lake[s]) { seen[y] = 1; q.push(y); } }
    }
    const N = q.length, km2 = N * a, h = hollowInfo[hollow[s]], C = conts[cont[s]];
    bodies.push({ s, cont: cont[s], kind: lake[s], km2, rain: rain / N, pet: evap / N, ratio: rain / evap, depthM: 1000 * depth / N, lat: sLat / N, lon: sLon / N, level: lakeLevel[s], src: lakeSrc[s], h });
    C.water[lake[s]] += N; C.kinds[lake[s]]++;
    C.bins[km2 < 1e3 ? 0 : km2 < 1e4 ? 1 : km2 < 1e5 ? 2 : 3]++;
}
const pick = conts.filter(C => C.cells * a > 1e6).sort((A, B) => B.cells - A.cells);
console.log('stats', JSON.stringify({ share: +(100 * fin.stats.water.lakeShare).toFixed(2), endo: fin.stats.water.endorheicShare, nan: fin.stats.water.nanHeights }));
if (fin.stats.census) for (const [k, v] of Object.entries(fin.stats.census)) console.log('CENSUS ' + k.padEnd(30) + JSON.stringify(v));
console.log('CONTINENTS: Mkm², lake share of it %, fresh/salt/pan %, bodies <1k/1k–10k/10k–100k/>100k km²');
for (const C of pick) {
    const pc = k => (100 * C.water[k] / C.cells).toFixed(2);
    console.log(`  ${(C.cells * a / 1e6).toFixed(1).padStart(6)}  ${(100 * (C.water[1] + C.water[2]) / C.cells).toFixed(2).padStart(5)}  ${pc(1)}/${pc(2)}/${pc(3)}  ${C.bins.join('/')}`);
}
console.log('BY AIR, whole world: P/PET over the body, bodies and Mkm² fresh / salt / pan');
for (const [lo, hi] of [[0, .2], [.2, .5], [.5, .75], [.75, 1], [1, 9]]) {
    const inB = k => bodies.filter(b => b.kind === k && b.ratio >= lo && b.ratio < hi), S = k => `${inB(k).length} ${(inB(k).reduce((v, b) => v + b.km2, 0) / 1e6).toFixed(3)}`;
    console.log(`  ${lo}–${hi}: ${S(1)} | ${S(2)} | ${S(3)}`);
}
const around = arg('--around', null);
if (around) {
    const [la, lo] = around.split(',').map(Number), near = s => { const d = Math.abs(lon[s] - lo); return Math.hypot(lat[s] - la, Math.min(d, 360 - d) * Math.cos(la * Math.PI / 180)); };
    let at = 0;
    for (let c = 1; c < n; c++) if (near(c) < near(at)) at = c;
    // (--match rain,temp: the page's hover read as what it says of the place, where its coordinates are not the mesh's)
    console.log(`AT THE COORDINATE: z ${Math.round(1000 * z[at])} m, rain ${Math.round(pAnnual[at])}, ${tAnnual[at].toFixed(1)} °C, ${land(at) ? 'land' : 'sea'}, water ${NAME[lake[at]]}`);
    const match = arg('--match', null)?.split(',').map(Number);
    if (match) {
        // (rain, °C and height together: three readings of one place)
        let best = Infinity;
        for (let c = 0; c < n; c++) {
            if (!land(c)) continue;
            const d = Math.abs(pAnnual[c] - match[0]) / 20 + Math.abs(tAnnual[c] - match[1]) / 0.3 + Math.abs(z[c] - match[2] / 1000) / 0.03 + (lake[c] ? 0 : 3);
            if (d < best) { best = d; at = c; }
        }
        console.log(`MATCH at ${lat[at].toFixed(2)},${lon[at].toFixed(2)} off by ${best.toFixed(1)}`);
    }
    const home = cont[at], show = b => {
        const area = b.km2, deficit = Math.max(0, F.lakeEvapShare * b.pet - b.rain), h = b.h;
        return `${NAME[b.kind]} ${Math.round(area)} km² at ${b.lat.toFixed(1)},${b.lon.toFixed(1)} src${b.src} level ${Math.round(1000 * b.level)} m, ${Math.round(b.depthM)} m deep, P ${Math.round(b.rain)} PET ${Math.round(b.pet)} P/PET ${b.ratio.toFixed(2)}; open water loses ${Math.round(deficit)} mm net, ${(deficit * area * 1e-6).toFixed(2)} km³/yr; hollow ${h ? Math.round(h.km2) : '-'} km² rim ${h ? Math.round(1000 * h.level) : '-'} m floor ${h ? Math.round(1000 * h.floor) : '-'} m, in ${h ? (h.inflow * 3.156e7 / 1e9).toFixed(2) : '-'} km³/yr, closed ${h?.closed}`;
    };
    const away = b => (lat[b.s] - lat[at]) ** 2 + (Math.min(Math.abs(lon[b.s] - lon[at]), 360 - Math.abs(lon[b.s] - lon[at])) * Math.cos(lat[at] * Math.PI / 180)) ** 2;
    const mine = bodies.filter(b => b.cont === home).sort((A, B) => away(A) - away(B));
    console.log(`AROUND ${around}: nearest cell z ${Math.round(1000 * z[at])} m, rain ${Math.round(pAnnual[at])}, ${tAnnual[at].toFixed(1)} °C, water ${NAME[lake[at]]}; continent ${(conts[home].cells * a / 1e6).toFixed(1)} Mkm²`);
    for (const b of mine.slice(0, 6)) console.log('  ' + show(b));
    // (this continent's waters by depth and kind, and how much of each hollow the water fills)
    const box = mine.filter(b => b.km2 >= 300), N = (f) => box.filter(f).length, kmOf = f => (box.filter(f).reduce((v, b) => v + b.km2, 0) / 1e3).toFixed(0);
    console.log(`  CONTINENT's bodies ≥300 km²: ${box.length}; mean depth <30 m ${N(b => b.depthM < 30)}, 30–100 ${N(b => b.depthM >= 30 && b.depthM < 100)}, >100 ${N(b => b.depthM >= 100)}; closed hollows ${N(b => b.h?.closed)} (${kmOf(b => b.h?.closed)}k km²), spilling ${N(b => b.h && !b.h.closed)} (${kmOf(b => b.h && !b.h.closed)}k km²)`);
    console.log(`  of which P/PET ≥ 0.5: fresh ${N(b => b.kind === 1 && b.ratio >= .5)} (${kmOf(b => b.kind === 1 && b.ratio >= .5)}k), salt ${N(b => b.kind === 2 && b.ratio >= .5)} (${kmOf(b => b.kind === 2 && b.ratio >= .5)}k)`);
}
process.exit(0);
