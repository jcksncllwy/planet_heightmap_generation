// The lowland at a set of moments (lane lowland, 2026-10-31): each moment of each seed is finished at --cells and its land
// measured the way the targets read it, with the sea, the swell and the sediment's books beside it, so a change can be
// attributed. Land below 400 m, the land's mean height, the land's share of the planet, the continental crust under the
// sea, lakes and closed drainage (the finish's); the sea's level, the mean swell the land stands on; the sediment the
// history's books hold (hollows, enclosed seas), and a sha256 of the moment's heights (the fingerprint).
// Usage: node v2/tools/trace-lowland.mjs [--seeds 626225,777,12345] [--moments 300,600,950] [--sim 40000] [--cont 30]
//        [--cells 640000] [--terrain k=v,k=v] [--json out.json]
// Heavy at --cells 2500000: run through sim-slots, one at a time.

import crypto from 'node:crypto';
import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { simulateCached } from './lib/history-cache.mjs';
import { pageWorld, MESH_SEED } from './lib/moment-frame.mjs';
import { stageOf } from './lib/cycle-stage.mjs';
import { landWater } from './lib/land-water.mjs';
import { FRAME_FIELDS, TerrainPool } from '../js/terrain/terrain-pool.js';
import { finishPlanet } from '../js/finish/finish.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { seaLevel } from '../js/terrain/sea-level.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { columnModel } from '../js/tectonics/measure.js';

setDelaunator(Delaunator);
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seeds = flag('--seeds', '626225,777,12345').split(',').map(Number), moments = flag('--moments', '300,600,950').split(',').map(Number);
const sim = Number(flag('--sim', 40000)), cont = Number(flag('--cont', 30)), cells = Number(flag('--cells', 640000)), jsonOut = flag('--json', null);
// (--terrain k=v,k=v: the finish's terrain config changed on the same frames, the history untouched: e.g. mantleSwellKm=0)
const terrainOver = Object.fromEntries((flag('--terrain', '') || '').split(',').filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
const until = Math.max(...moments), rows = [], cfg = terrainConfig(terrainOver);

for (const seed of seeds) {
    const { scene, world } = pageWorld({ seed, cont, sim }), simMesh = buildSimMesh(sim, MESH_SEED), frames = new Map();
    simulateCached(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
        if (!moments.some(t => Math.abs(f.time - t) < 1e-6)) return;
        const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]]));
        fr.plates = f.plates.map(p => p && { quat: p.quat });
        frames.set(Math.round(f.time), { fr, stage: stageOf(f), budget: f.budget });
    } }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim, meshSeed: MESH_SEED, heights: {}, by: 'trace-lowland' } });
    for (const t of moments) {
        const { fr, stage, budget } = frames.get(t), pool = await TerrainPool.create(simMesh);
        const fin = await finishPlanet({ frame: fr, simMesh, seed, cells, pool, closePool: true, cfg });
        const W = landWater(fin, simMesh, fr), { mesh, z, ocean } = fin, n = mesh.numCells;
        // heights over the finish's own sea: the ocean's cells are its sea; a hollow below 0 inside the land is still land
        const land = new Float32Array(n);
        let m = 0, under = 0, crust = 0;
        for (let c = 0; c < n; c++) {
            if (!ocean[c]) land[m++] = z[c];
            const w = simMesh.index.nearest(mesh.xyz[3 * c], mesh.xyz[3 * c + 1], mesh.xyz[3 * c + 2]);
            if (fr.owner[w] >= 0 && (fr.type[w] === CrustType.CONTINENT || fr.type[w] === CrustType.CRATON)) { crust++; if (ocean[c]) under++; }
        }
        const dry = land.subarray(0, m).sort(), below = dry.reduce((a, h) => a + (h < 0.4 ? 1 : 0), 0) / Math.max(1, m);
        const rec = fin.stats.sea ?? null, row = { seed, t, stage, below400: 100 * below, meanKm: W.meanKm, medianKm: dry[m >> 1] ?? NaN, landShare: 100 * m / n, under: 100 * under / Math.max(1, crust),
            lakes: 100 * W.onLandKm2 / W.landKm2, closed: 100 * (fin.stats.water.endorheicShare ?? NaN), rec,
            basinFillMkm3: (budget.basinFillKm3 ?? 0) / 1e6, seaFillMkm3: (budget.seaFillKm3 ?? 0) / 1e6, shelfMkm3: (budget.shelfKm3 ?? 0) / 1e6, hash: crypto.createHash('sha256').update(Buffer.from(z.buffer, z.byteOffset, z.byteLength)).digest('hex').slice(0, 12) };
        // ── why: the static picture. The sea and the swell at this moment; how much crust there is to flood; the shelf (sea to
        // 200 m, joined or not); what the land's platform is made of; and how the targets answer the sea moved by dz, or the
        // swell scaled, on this surface as it stands (no coast redrawn: a first-order reading, not a run) ──
        const sl = seaLevel(fr, simMesh, cfg, w => fr.owner[w] >= 0 && fr.type[w] !== CrustType.OCEAN), C = columnModel(cfg), landRef = cfg.mantleSwellKm * cfg.mantleSwellLandRef;
        const near = new Int32Array(n);
        let shelf = 0;
        for (let c = 0; c < n; c++) { near[c] = simMesh.index.nearest(mesh.xyz[3 * c], mesh.xyz[3 * c + 1], mesh.xyz[3 * c + 2]); if (ocean[c] && z[c] >= -0.2) shelf++; }
        const parts = { col: 0, root: 0, base: 0, up: 0, fill: 0, swell: 0 };
        let simCont = 0, simLand = 0;
        for (let w = 0; w < simMesh.numCells; w++) {
            if (fr.owner[w] < 0) continue;
            const t = fr.type[w];
            if (t !== CrustType.CONTINENT && t !== CrustType.CRATON) continue;
            simCont++; simLand++;
            parts.col += C.ref[t]; parts.root += C.slope[t] * fr.rootKm[w]; parts.base += fr.baseKm[w]; parts.up += fr.upliftKm[w]; parts.fill += (fr.basinFillKm?.[w] ?? 0) / 4.125; parts.swell += sl.swellKm[w] - landRef - sl.seaKm;
        }
        for (const k in parts) parts[k] /= Math.max(1, simLand);
        const reading = (dz, swellScale) => {
            let l = 0, lo = 0, sum = 0, cr = 0, un = 0;
            for (let c = 0; c < n; c++) {
                const w = near[c], h = z[c] - dz - (ocean[c] ? 0 : (1 - swellScale) * (sl.swellKm[w] - landRef - sl.seaKm));
                const dry = !ocean[c] && h > 0, isCr = fr.owner[w] >= 0 && (fr.type[w] === CrustType.CONTINENT || fr.type[w] === CrustType.CRATON);
                if (isCr) { cr++; if (!dry) un++; }
                if (dry) { l++; sum += h; if (h < 0.4) lo++; }
            }
            return { dz, swellScale, below400: 100 * lo / Math.max(1, l), meanKm: sum / Math.max(1, l), landShare: 100 * l / n, under: 100 * un / Math.max(1, cr) };
        };
        // (the wedge: the rock on the coast now, and how thick it stands on a cell's own length of coast, km² of section over the margin's width)
        const sedRatio = cfg.riftCrustRho / cfg.riftSedRho, wedge = [];
        let shelfNow = 0;
        for (let w = 0; w < simMesh.numCells; w++) if (fr.owner[w] >= 0 && fr.shelfKm3?.[w] > 0) { shelfNow += fr.shelfKm3[w]; wedge.push(sedRatio * fr.shelfKm3[w] / simMesh.edgeKm / cfg.marginThinKm); }
        wedge.sort((a, b) => a - b);
        row.shelfNowMkm3 = shelfNow / 1e6; row.wedgeKm = wedge.length ? [wedge[wedge.length >> 1], wedge[Math.floor(0.9 * (wedge.length - 1))], wedge.at(-1)] : [0, 0, 0];
        row.seaKm = sl.seaKm; row.heatLand = sl.heatLand; row.heatSea = sl.heatSea; row.depthKm = sl.depthKm; row.ridgeSeaKm = sl.ridgeSeaKm;
        row.crustShare = 100 * crust / n; row.simCrustShare = 100 * simCont / simMesh.numCells; row.shelfShare = 100 * shelf / n; row.parts = parts;
        row.readings = [[0.1, 1], [0.2, 1], [0.3, 1], [0.4, 1], [0.5, 1], [0, 0.5], [0, 0], [0.2, 0.5], [0.3, 0.5]].map(([d, k]) => reading(d, k));
        rows.push(row);
        console.log(`   shelf rock ${row.shelfNowMkm3.toFixed(1)} Mkm³ now of ${row.shelfMkm3.toFixed(1)} laid; wedge mean thickness p50/p90/max ${row.wedgeKm.map(v => v.toFixed(1)).join('/')} km`);
        console.log(`   sea ${sl.seaKm.toFixed(3)} km · heat land ${sl.heatLand.toFixed(3)} sea ${sl.heatSea.toFixed(3)} · floor ${sl.depthKm.toFixed(2)} km (ridge term ${sl.ridgeSeaKm.toFixed(2)}) · crust ${row.crustShare.toFixed(1)} % · shelf ${row.shelfShare.toFixed(1)} % · parts ${Object.entries(parts).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(' ')}`);
        console.log(`${seed}@${t} ${(stage ?? 'between').padEnd(15)} below400 ${row.below400.toFixed(1)} % · mean ${row.meanKm.toFixed(3)} · median ${row.medianKm.toFixed(3)} km · land ${row.landShare.toFixed(1)} % · crust under sea ${row.under.toFixed(1)} % · lakes ${row.lakes.toFixed(2)} % · closed ${row.closed.toFixed(1)} % · basin fill ${row.basinFillMkm3.toFixed(1)}, sea fill ${row.seaFillMkm3.toFixed(1)} Mkm³ · ${row.hash}`);
    }
}
const mean = k => rows.reduce((a, r) => a + r[k], 0) / Math.max(1, rows.length);
console.log(`mean of ${rows.length}: below400 ${mean('below400').toFixed(1)} % · land mean ${mean('meanKm').toFixed(3)} km · land ${mean('landShare').toFixed(1)} % · crust under sea ${mean('under').toFixed(1)} % · lakes ${mean('lakes').toFixed(2)} % · closed ${mean('closed').toFixed(1)} %`);
for (const i of rows[0]?.readings.keys() ?? []) {
    const R = rows.map(r => r.readings[i]), m = k => R.reduce((a, r) => a + r[k], 0) / R.length;
    console.log(`  sea +${R[0].dz.toFixed(1)} km, swell x${R[0].swellScale}: below400 ${m('below400').toFixed(1)} % · land mean ${m('meanKm').toFixed(3)} km · land ${m('landShare').toFixed(1)} % · crust under sea ${m('under').toFixed(1)} %`);
}
console.log(`  crust ${mean('crustShare').toFixed(1)} % of the planet · shelf (sea to 200 m) ${mean('shelfShare').toFixed(1)} % · sea ${mean('seaKm').toFixed(3)} km · floor ${mean('depthKm').toFixed(2)} km`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
process.exit();
