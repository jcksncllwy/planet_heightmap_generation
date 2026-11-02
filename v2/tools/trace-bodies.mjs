// One connected water, one kind? Every body of a finished moment's water — lake cells joined by adjacency, whatever their kind
// or level, the sea apart — split by kind, level and source (finish-hydro.js lakeSrc): where two kinds touch, at what step in level.
//   node v2/tools/trace-bodies.mjs --seed 831576 --time 430 --cells 2500000 [--erode false] [--top 6] [--key <the page's history>] [--around lat,lon]
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
const SEED = Number(arg('--seed', 831576)), TIME = Number(arg('--time', 430)), CELLS = Number(arg('--cells', 2500000)), SIM = Number(arg('--sim', 40000)), TOP = Number(arg('--top', 6));
const F = { ...FINISH };
if (arg('--erode', null) !== null) F.erode = JSON.parse(arg('--erode'));
const frame = await momentFrame(ROOT, { seed: SEED, cont: Number(arg('--cont', 30)), sim: SIM, time: TIME, key: arg('--key', null) });
const simMesh = buildSimMesh(SIM, MESH_SEED), pool = await TerrainPool.create(simMesh);
const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, debug: true, F, onStage: () => {} });
const { mesh, z, ocean, lake, lakeLevel } = fin, { lakeSrc, lat, lon } = fin.layers, { adjOffset, adjList, numCells: n } = mesh, a = 4 * Math.PI * 6371 ** 2 / n;
const NAME = { 1: 'fresh', 2: 'salt', 3: 'pan' }, seen = new Uint8Array(n), bodies = [];
const nameOf = k => NAME[k] ?? `kind${k}`;
for (let s = 0; s < n; s++) {
    if (seen[s] || !lake[s]) continue;
    const q = [s], parts = new Map();
    seen[s] = 1;
    let touchSea = 0, mixedEdges = 0, sameLevelMixed = 0, maxStep = 0, sumLat = 0, sumLon = 0;
    for (let i = 0; i < q.length; i++) {
        const c = q[i], key = `${nameOf(lake[c])} src${lakeSrc[c]} ${(1000 * lakeLevel[c]).toFixed(0)}m`, P = parts.get(key) ?? { cells: 0, floor: Infinity, sea: 0 };
        P.cells++; if (z[c] < P.floor) P.floor = z[c];
        parts.set(key, P);
        sumLat += lat[c]; sumLon += lon[c];
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
            const y = adjList[j];
            if (ocean[y] && !lake[y]) { touchSea++; P.sea++; }
            if (!lake[y]) continue;
            if (lake[y] !== lake[c]) { mixedEdges++; const d = Math.abs(lakeLevel[y] - lakeLevel[c]); if (d < 0.002) sameLevelMixed++; if (d > maxStep) maxStep = d; }
            if (!seen[y]) { seen[y] = 1; q.push(y); }
        }
    }
    const kinds = new Set([...parts.keys()].map(k => k.split(' ')[0]));
    bodies.push({ Mkm2: q.length * a / 1e6, kinds: kinds.size, parts: parts.size, at: `${(sumLat / q.length).toFixed(1)}°, ${(sumLon / q.length).toFixed(1)}°`, touchSea, mixedEdges: mixedEdges / 2, sameLevelMixed: sameLevelMixed / 2, maxStepM: Math.round(1000 * maxStep),
        list: [...parts].sort((x, y) => y[1].cells - x[1].cells).slice(0, 8).map(([k, P]) => `${k}: ${(P.cells * a).toFixed(0)} km², floor ${(1000 * P.floor).toFixed(0)} m, sea edges ${P.sea}`) });
}
const mixed = bodies.filter(b => b.kinds > 1).sort((x, y) => y.Mkm2 - x.Mkm2), big = [...bodies].sort((x, y) => y.Mkm2 - x.Mkm2);
console.log(`RESULT ${JSON.stringify({ seed: SEED, time: TIME, cells: CELLS, erode: !!F.erode, bodies: bodies.length, mixed: mixed.length, mixedMkm2: +mixed.reduce((v, b) => v + b.Mkm2, 0).toFixed(3), sameLevelMixedEdges: mixed.reduce((v, b) => v + b.sameLevelMixed, 0), touchingSea: bodies.filter(b => b.touchSea).length })}`);
for (const b of [...mixed.slice(0, TOP), ...big.slice(0, 3)]) console.log(JSON.stringify({ ...b, Mkm2: +b.Mkm2.toFixed(3), list: undefined }) + '\n   ' + b.list.join('\n   '));
// --around: the biggest body within 6° of there, and every other water within 4 cells of its shore: its level, and the lowest
// dry ground on the way (the sill, as near as this mesh sees it)
const id = new Int32Array(n).fill(-1), B = [];
{
    for (let s = 0; s < n; s++) {
        if (id[s] >= 0 || !lake[s]) continue;
        const q = [s], me = B.length;
        id[s] = me;
        for (let i = 0; i < q.length; i++) for (let j = adjOffset[q[i]]; j < adjOffset[q[i] + 1]; j++) { const y = adjList[j]; if (lake[y] === lake[s] && Math.abs(lakeLevel[y] - lakeLevel[s]) < 1e-3 && id[y] < 0) { id[y] = me; q.push(y); } }
        B.push({ cells: q, kind: nameOf(lake[s]), level: lakeLevel[s], src: lakeSrc[s] });
    }
}
// the waters of different kinds within 3 cells of each other, fresh against salt: how far apart, and the step between their levels
{
    const pairs = new Map(), hop = new Int32Array(n), stamp = new Int32Array(n).fill(-1);
    B.forEach((b, me) => {
        if (b.kind !== 'salt' || b.cells.length * a < F.lakeMinKm2) return;
        let front = b.cells.slice();
        for (const c of front) { stamp[c] = me; hop[c] = 0; }
        for (let d = 1; d <= 3; d++) {
            const next = [];
            for (const c of front) for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
                const y = adjList[j];
                if (stamp[y] === me || ocean[y]) continue;
                stamp[y] = me;
                if (lake[y] === 1) { const key = me + ':' + id[y]; if (!pairs.has(key)) pairs.set(key, { salt: b, fresh: B[id[y]], hops: d - 1 }); continue; }
                if (!lake[y]) next.push(y);
            }
            front = next;
        }
    });
    const P = [...pairs.values()].sort((x, y) => y.fresh.cells.length - x.fresh.cells.length), step = p => Math.round(1000 * (p.fresh.level - p.salt.level));
    console.log(`NEAR ${P.length} fresh waters within 3 cells of a salt lake, ${(P.reduce((v, p) => v + p.fresh.cells.length * a, 0) / 1e6).toFixed(3)} Mkm²; touching ${P.filter(p => !p.hops).length}; steps m: under 10 ${P.filter(p => Math.abs(step(p)) < 10).length}, 10–50 ${P.filter(p => Math.abs(step(p)) >= 10 && Math.abs(step(p)) < 50).length}, over 50 ${P.filter(p => Math.abs(step(p)) >= 50).length}`);
    for (const p of P.slice(0, 10)) console.log(`   fresh src${p.fresh.src} ${(p.fresh.cells.length * a).toFixed(0)} km² beside salt src${p.salt.src} ${(p.salt.cells.length * a).toFixed(0)} km², ${p.hops} dry cells between, step ${step(p)} m, at ${lat[p.fresh.cells[0]].toFixed(1)}°, ${lon[p.fresh.cells[0]].toFixed(1)}°`);
}
if (arg('--around', null)) {
    const [la, lo] = arg('--around').split(',').map(Number);
    const near = c => Math.hypot(lat[c] - la, (lon[c] - lo) * Math.cos(la * Math.PI / 180)) < 6;
    const main = B.filter(b => near(b.cells[0]) || b.cells.some(near)).sort((x, y) => y.cells.length - x.cells.length)[0], me = B.indexOf(main), hop = new Int8Array(n).fill(-1), via = new Float32Array(n).fill(Infinity), found = new Map();
    let front = main.cells.slice();
    for (const c of front) hop[c] = 0;
    for (let d = 1; d <= 4; d++) {
        const next = [];
        for (const c of front) for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
            const y = adjList[j];
            if (hop[y] >= 0 || ocean[y]) continue;
            hop[y] = d;
            if (lake[y] && id[y] !== me) { const F0 = found.get(id[y]) ?? { hops: d, sillM: Math.round(1000 * via[c]) }; found.set(id[y], F0); continue; }
            via[y] = Math.min(via[c], z[y]);
            next.push(y);
        }
        front = next;
    }
    console.log(`AROUND ${main.kind} ${(main.cells.length * a).toFixed(0)} km², level ${(1000 * main.level).toFixed(0)} m, src${main.src}`);
    for (const [b, f] of [...found].sort((x, y) => B[y[0]].cells.length - B[x[0]].cells.length).slice(0, 24)) console.log(`   ${B[b].kind} src${B[b].src} ${(B[b].cells.length * a).toFixed(0)} km², level ${(1000 * B[b].level).toFixed(0)} m, ${f.hops} cells away, lowest dry ground between ${f.sillM} m, at ${lat[B[b].cells[0]].toFixed(1)}°, ${lon[B[b].cells[0]].toFixed(1)}°`);
}
process.exit(0);
