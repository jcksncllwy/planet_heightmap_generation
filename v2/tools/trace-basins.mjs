// The land's hollows through a history, and what the finish makes of them (lane basins, 2026-10-29). A hollow is land
// below its spill: the level a priority flood from the sea gives it, over the ground as the history's rivers route it
// (step/rivers.js: the land's height against the sea, the mantle's swell in, less the rivers' cuts). Every --every Myr:
// the land below spill (area, a share of the land, and volume), the largest hollow (area, deepest, where), and why it is
// low — the deepest cell against its rim, part by part (the column of its crust, belts' uplift — a foreland or a rift
// below 0 —, the start world's swells, the mantle's swell, the rivers' cuts) — and how old it is by the history's clocks
// (since a belt last worked it; the crust's age). At --finish moments the frame is finished at --cells and its water
// measured: lakes and playas (Mkm², a share of the land), the largest lakes, and the finished land below its spill.
// Usage: node v2/tools/trace-basins.mjs [--seeds 831576,626225] [--sim 40000] [--cont 30] [--until 1200] [--every 100]
//        [--finish 310@640000,600] [--cells 160000]
// Builds each history (no cache: the hollows are read off the world as it runs). Run through sim-slots.

import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { simulate } from '../js/tectonics/simulate.js';
import { pageWorld } from './lib/moment-frame.mjs';
import { lastDrainage } from '../js/tectonics/step/rivers.js';
import { heightsOf } from '../js/tectonics/step/heights.js';
import { columnModel } from '../js/tectonics/measure.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { FRAME_FIELDS, TerrainPool } from '../js/terrain/terrain-pool.js';
import { finishPlanet } from '../js/finish/finish.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { landWater } from './lib/land-water.mjs';

setDelaunator(Delaunator);
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seeds = flag('--seeds', '831576').split(',').map(Number), sim = Number(flag('--sim', 40000)), cont = Number(flag('--cont', 30));
// (--terrain k=v,k=v: the finish's terrain config changed — e.g. cratonSagKm=0 to see what the terrain's own sags make)
const terrainOver = Object.fromEntries((flag('--terrain', '') || '').split(',').filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
const until = Number(flag('--until', 1200)), every = Number(flag('--every', 100)), cells = Number(flag('--cells', 160000));
// (a moment to finish, at --cells or its own: 310@640000)
const finishes = (flag('--finish', '') || '').split(',').filter(Boolean).map(x => { const [t, c] = x.split('@').map(Number); return { t, cells: c || cells }; }), finishAt = finishes.map(f => f.t);
const R = 6371, deg = 180 / Math.PI;
const latLon = (xyz, c) => `${(Math.asin(Math.max(-1, Math.min(1, xyz[3 * c + 2]))) * deg).toFixed(1)}°, ${(Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * deg).toFixed(1)}°`;

/** The world's hollows now, from the rivers' last drainage. */
function historyHollows(world) {
    const D = lastDrainage(), { mesh, plates, owner, ownerCell, time } = world, { adjOffset, adjList, numCells: n } = mesh;
    const cellKm2 = 4 * Math.PI * R * R / n, H = heightsOf(world.config), C = columnModel(H), landRef = H.mantleSwellKm * H.mantleSwellLandRef;
    const depth = new Float32Array(n);
    // (crust the history counts as land but standing below the sea and open to it — a drowned shelf, an arc still under
    // water — is sea, not a hollow: a flood from the sea over land below 0)
    const drowned = new Uint8Array(n), q0 = [];
    for (let w = 0; w < n; w++) if (!D.land[w]) for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) { const nb = adjList[k]; if (D.land[nb] && D.height[nb] < 0 && !drowned[nb]) { drowned[nb] = 1; q0.push(nb); } }
    for (let i = 0; i < q0.length; i++) for (let k = adjOffset[q0[i]]; k < adjOffset[q0[i] + 1]; k++) { const nb = adjList[k]; if (D.land[nb] && D.height[nb] < 0 && !drowned[nb]) { drowned[nb] = 1; q0.push(nb); } }
    let landKm2 = 0;
    for (let w = 0; w < n; w++) if (D.land[w] && !drowned[w]) { landKm2 += cellKm2; depth[w] = Math.max(0, D.fill[w] - D.height[w]); }
    // the parts of a cell's height (km): its column, belts' uplift, the start's swells, the mantle's swell, the cut
    const parts = w => {
        const crust = plates[owner[w]].crust, c = ownerCell[w], t = crust.type[c];
        if (t === CrustType.OCEAN) return { col: 0, up: 0, base: 0, swell: D.swellKm[w] - landRef, cut: 0 };
        return { col: t === CrustType.ARC ? 0 : C.ref[t] + C.slope[t] * crust.rootKm[c], up: crust.upliftKm[c], base: crust.baseKm[c], swell: D.swellKm[w] - landRef, cut: -crust.riverIncKm[c] };
    };
    const comp = new Int32Array(n).fill(-1), list = [];
    let belowKm2 = 0, volKm3 = 0;
    for (let w0 = 0; w0 < n; w0++) {
        if (depth[w0] < 1e-3 || comp[w0] >= 0) continue;
        const q = [w0]; comp[w0] = list.length;
        for (let i = 0; i < q.length; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const nb = adjList[k]; if (comp[nb] < 0 && depth[nb] >= 1e-3) { comp[nb] = list.length; q.push(nb); } }
        let deep = w0, vol = 0;
        for (const w of q) { vol += depth[w] * cellKm2; if (depth[w] > depth[deep]) deep = w; }
        belowKm2 += q.length * cellKm2; volKm3 += vol;
        list.push({ cells: q, km2: q.length * cellKm2, km3: vol, deep, depthKm: depth[deep] });
    }
    list.sort((a, b) => b.km2 - a.km2);
    for (const h of list.slice(0, 5)) {
        // its rim: the lowest neighbour outside it
        let rim = -1;
        for (const w of h.cells) for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) { const nb = adjList[k]; if (comp[nb] !== comp[w] && D.land[nb] && !drowned[nb] && (rim < 0 || D.height[nb] < D.height[rim])) rim = nb; }
        const a = parts(h.deep), b = rim >= 0 ? parts(rim) : a;
        h.why = Object.fromEntries(Object.keys(a).map(k => [k, +(b[k] - a[k]).toFixed(2)]));
        const crust = plates[owner[h.deep]].crust, c = ownerCell[h.deep];
        h.age = { crust: Math.round(time - crust.formedAt[c]), belt: crust.oroType[c] ? Math.round(time - crust.oroLast[c]) : null, type: crust.type[c], oro: crust.oroType[c] };
        h.at = latLon(mesh.xyz, h.deep);
    }
    return { landKm2, drownedKm2: q0.length * cellKm2, belowKm2, volKm3, list, depth };
}

const M = x => (x / 1e6).toFixed(2);
for (const seed of seeds) {
    const { scene, world } = pageWorld({ seed, cont, sim });
    const frames = new Map(), depths = new Map(), t0 = Date.now();
    console.log(`\n── seed ${seed} (cont ${cont}, sim ${sim}) ──`);
    console.log('  Myr   land Mkm²  below spill Mkm² (% land)  volume Mkm³  hollows≥1e4km²  largest: Mkm², deepest km, at · why (rim − floor, km: col up base swell cut) · age (crust, since belt) ');
    simulate(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
        const t = Math.round(f.time);
        if (t === 0) return;
        const fin = finishAt.includes(t);
        if (t % every !== 0 && !fin) return;
        const h = historyHollows(world), big = h.list[0];
        if (fin) { const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]])); fr.plates = f.plates.map(p => p && { quat: p.quat }); frames.set(t, fr); depths.set(t, h.depth.slice()); }
        if (t % every !== 0) return;
        const n4 = h.list.filter(x => x.km2 >= 1e4).length;
        console.log(`  ${String(t).padStart(4)}  ${M(h.landKm2).padStart(8)} (+${M(h.drownedKm2)} drowned)  ${M(h.belowKm2).padStart(8)} (${(100 * h.belowKm2 / h.landKm2).toFixed(1)} %)  ${M(h.volKm3).padStart(10)}  ${String(n4).padStart(5)}   ` +
            (big ? `${M(big.km2)}, ${big.depthKm.toFixed(2)} at ${big.at} · ${Object.values(big.why).join(' ')} · ${big.age.crust} / ${big.age.belt ?? '—'} Myr (type ${big.age.type}, oro ${big.age.oro})` : '—'));
        // (the sediment the hollows hold: the crust's records now, and all they have kept against all the rivers sent)
        let fillKm3 = 0; const cellKm2 = 4 * Math.PI * R * R / world.mesh.numCells;
        for (let w = 0; w < world.mesh.numCells; w++) { const o = world.owner[w]; if (o >= 0) fillKm3 += (world.plates[o].crust.basinFillKm?.[world.ownerCell[w]] ?? 0) * cellKm2; }
        const B = world.budget ?? {};
        if (B.basinFillKm3) console.log(`        basin fill: ${M(fillKm3)} Mkm³ in the crust now; kept so far ${M(B.basinFillKm3)} Mkm³, enclosed seas ${M(B.seaFillKm3 ?? 0)} Mkm³`);
        for (const x of h.list.slice(1, 3)) console.log(`        next: ${M(x.km2)} Mkm², ${x.depthKm.toFixed(2)} km at ${x.at} · ${Object.values(x.why).join(' ')} · ${x.age.crust} / ${x.age.belt ?? '—'} Myr (oro ${x.age.oro})`);
    } });
    console.log(`  (history ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const { t, cells } of finishes) {
        const pool = await TerrainPool.create(world.mesh), t1 = Date.now();
        const fin = await finishPlanet({ frame: frames.get(t), simMesh: world.mesh, seed, cells, pool, closePool: true, cfg: terrainConfig(terrainOver) });
        const W = landWater(fin, world.mesh, frames.get(t), depths.get(t));
        console.log(`  finished at ${t} Myr, ${cells} cells (${((Date.now() - t1) / 1000).toFixed(0)} s): land ${M(W.landKm2)} Mkm²; lakes ${M(W.wetKm2)} Mkm² (${(100 * W.wetKm2 / W.landKm2).toFixed(1)} %), playas ${M(W.panKm2)}; ` +
            `land below spill ${M(W.belowKm2)} Mkm² (${(100 * W.belowKm2 / W.landKm2).toFixed(1)} %), ${M(W.volKm3)} Mkm³; endorheic ${(100 * (W.stats.endorheicShare ?? NaN)).toFixed(1)} %; land's mean height ${(1000 * W.meanKm).toFixed(0)} m${W.zBadKm2 > 0 ? ` (${M(W.zBadKm2)} Mkm² not finite)` : ''}`);
        const landLakes = W.lakes.filter(L => !L.sea), sum = a => a.reduce((x, L) => x + L.km2, 0);
        console.log(`     on land: ${M(sum(landLakes))} Mkm² (${(100 * sum(landLakes) / W.landKm2).toFixed(1)} % of land; ${(100 * landLakes.reduce((x, L) => x + L.overKm2, 0) / Math.max(1, sum(landLakes))).toFixed(0)} % of it over a history hollow), the largest ${M(landLakes[0]?.km2 ?? 0)}; on a cut-off sea's floor: ${M(sum(W.lakes.filter(L => L.sea)))} Mkm²`);
        for (const L of [...landLakes.slice(0, 5), ...W.lakes.filter(L => L.sea).slice(0, 2)]) console.log(`     ${L.sea ? 'sea ' : 'lake'} ${M(L.km2)} Mkm² ${L.kind}, ${(1000 * L.depthKm).toFixed(0)} m deep, level ${(1000 * L.levelKm).toFixed(0)} m, at ${L.at} · history's hollow there ${(1000 * L.histDepthKm).toFixed(0)} m, under ${(100 * L.histShare).toFixed(0)} % of it · ${L.crust}`);
    }
}
process.exit();
