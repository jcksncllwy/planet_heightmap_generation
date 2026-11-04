// The rift stage's floor at a moment (lane visual5, 2026-11-03: rifton-report known bug 2, "lacy rift shelves"): what the
// history says the stretched continent stands at, against what the terrain and the finish draw there. Rift-stage crust
// (step/rifting.js evolveRiftStages) is continental crust thinned to 1 − 0.2 … 1 − 0.7 of its own: its column stands
// 0.9–3.6 km under the sea (measure.js columnKm). The terrain read it as land (records.js, before visual5: land was crust not
// ocean), so its coast, shelf and rifted-margin sediment profile are drawn round it. Here, per moment, the sim cells of
// stretched crust (continent, a RIFT record, crust ≥ 15 % thinned) and the finish's cells over them: the column's depth,
// the records' platform, the finished surface's height in bands, and the margin profile's share (riftShare).
// Usage: node v2/tools/trace-riftshelf.mjs [--seed 831576] [--moments 340,430] [--sim 40000] [--cont 30] [--cells 640000]
// Heavy: run through sim-slots, one at a time.

import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { simulateCached } from './lib/history-cache.mjs';
import { pageWorld, MESH_SEED } from './lib/moment-frame.mjs';
import { FRAME_FIELDS, TerrainPool } from '../js/terrain/terrain-pool.js';
import { finishPlanet } from '../js/finish/finish.js';
import { CrustType, OrogenyType } from '../js/tectonics/model/crust.js';
import { deriveRecords } from '../js/terrain/records.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { columnModel } from '../js/tectonics/measure.js';

setDelaunator(Delaunator);
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seed = Number(flag('--seed', 831576)), moments = flag('--moments', '340,430').split(',').map(Number);
const sim = Number(flag('--sim', 40000)), cont = Number(flag('--cont', 30)), cells = Number(flag('--cells', 640000));
const cfg = terrainConfig({}), C = columnModel(cfg), until = Math.max(...moments);
const { scene, world } = pageWorld({ seed, cont, sim }), simMesh = buildSimMesh(sim, MESH_SEED), frames = new Map();
simulateCached(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
    if (!moments.some(t => Math.abs(f.time - t) < 1e-6)) return;
    const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]]));
    fr.plates = f.plates.map(p => p && { quat: p.quat });
    frames.set(Math.round(f.time), fr);
} }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim, meshSeed: MESH_SEED, heights: {}, by: 'trace-riftshelf' } });

const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN, f2 = v => v.toFixed(2);
for (const t of moments) {
    const fr = frames.get(t), rec = deriveRecords(fr, simMesh, cfg, seed), thin = -0.15 * C.crust[CrustType.CONTINENT];
    const stage = new Uint8Array(simMesh.numCells), col = [], plat = [], rs = [];
    let nStage = 0, nCont = 0;
    for (let w = 0; w < simMesh.numCells; w++) {
        if (fr.owner[w] < 0 || fr.type[w] !== CrustType.CONTINENT) continue;
        nCont++;
        if (fr.oroType[w] !== OrogenyType.RIFT || !(fr.rootKm[w] < thin)) continue;
        stage[w] = 1; nStage++;
        col.push(C.ref[CrustType.CONTINENT] + C.slope[CrustType.CONTINENT] * fr.rootKm[w]); plat.push(rec.platformKm[w] - rec.seaKm); rs.push(rec.riftShare[w]);
    }
    const pool = await TerrainPool.create(simMesh);
    const fin = await finishPlanet({ frame: fr, simMesh, seed, cells, pool, closePool: true, cfg });
    const { mesh, z, ocean } = fin, n = mesh.numCells, zs = [];
    // bands of the finished surface over stretched crust: dry land; shelf (sea to 200 m); slope (200–1000 m); deep (> 1 km)
    const band = { land: 0, shelf: 0, slope: 0, deep: 0 }, ctl = { land: 0, shelf: 0, slope: 0, deep: 0 };
    let lacy = 0, edges = 0;
    for (let c = 0; c < n; c++) {
        const w = simMesh.index.nearest(mesh.xyz[3 * c], mesh.xyz[3 * c + 1], mesh.xyz[3 * c + 2]), h = z[c];
        const b = !ocean[c] ? 'land' : h >= -0.2 ? 'shelf' : h >= -1 ? 'slope' : 'deep';
        if (stage[w]) {
            band[b]++; zs.push(h);
            // (how ragged: of a shelf cell's neighbours, the share that are deep — a planed shelf has a slope between)
            if (b === 'shelf') for (let j = mesh.adjOffset[c]; j < mesh.adjOffset[c + 1]; j++) { edges++; if (ocean[mesh.adjList[j]] && z[mesh.adjList[j]] < -1) lacy++; }
        } else if (fr.owner[w] >= 0 && fr.type[w] === CrustType.CONTINENT) ctl[b]++;
    }
    col.sort((a, b) => a - b); plat.sort((a, b) => a - b); rs.sort((a, b) => a - b); zs.sort((a, b) => a - b);
    const share = o => { const s = Object.values(o).reduce((a, b) => a + b, 0) || 1; return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(100 * v / s).toFixed(1)])); };
    console.log(`t ${t}: stretched sim cells ${nStage} of ${nCont} continent (${(100 * nStage / Math.max(1, nCont)).toFixed(1)} %)`);
    console.log(`  column (km, sea 0, no swell): p10 ${f2(q(col, 0.1))} p50 ${f2(q(col, 0.5))} p90 ${f2(q(col, 0.9))} · records platform − sea: p10 ${f2(q(plat, 0.1))} p50 ${f2(q(plat, 0.5))} p90 ${f2(q(plat, 0.9))} · riftShare p50 ${f2(q(rs, 0.5))} p90 ${f2(q(rs, 0.9))}`);
    console.log(`  finished surface over it (km): p10 ${f2(q(zs, 0.1))} p50 ${f2(q(zs, 0.5))} p90 ${f2(q(zs, 0.9))} · bands % ${JSON.stringify(share(band))} · other continent ${JSON.stringify(share(ctl))}`);
    console.log(`  shelf cells' neighbours deeper than 1 km: ${(100 * lacy / Math.max(1, edges)).toFixed(1)} %`);
    console.log('RESULT ' + JSON.stringify({ seed, t, nStage, nCont, col: [q(col, 0.1), q(col, 0.5), q(col, 0.9)], plat: [q(plat, 0.1), q(plat, 0.5), q(plat, 0.9)], z: [q(zs, 0.1), q(zs, 0.5), q(zs, 0.9)], band: share(band), ctl: share(ctl), lacy: lacy / Math.max(1, edges) }));
}
