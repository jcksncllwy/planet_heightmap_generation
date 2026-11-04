// The sea from a conserved water inventory over a history (lane ocean, 2026-11-03): at every 10 Myr frame, the history's
// ground (tectonics/ocean/inventory.js surfaceKm) filled from its lowest cell with a fixed volume of water, against the sea
// level main reckons (terrain/sea-level.js) and the land main draws (crust type). Per frame: the level, the land's share,
// the continental crust under the sea, closed below-sea hollows, and the volume main's own sea would take; the solve's cost.
// Usage: node v2/tools/ocean-drift.mjs [--seeds 626225,777,12345] [--until 1200] [--sim 40000] [--cont 29]
//        [--volume 1.332e9] [--json out.json]

import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { simulateCached } from './lib/history-cache.mjs';
import { pageWorld, MESH_SEED } from './lib/moment-frame.mjs';
import { FRAME_FIELDS } from '../js/terrain/terrain-pool.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { seaLevel } from '../js/terrain/sea-level.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { seaFilledUp } from '../js/tectonics/measure.js';
import { surfaceKm, pourOcean, volumeAt, EARTH_OCEAN_KM3 } from '../js/tectonics/ocean/inventory.js';

setDelaunator(Delaunator);
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seeds = flag('--seeds', '626225,777,12345').split(',').map(Number), until = Number(flag('--until', 1200));
const sim = Number(flag('--sim', 40000)), cont = Number(flag('--cont', 29)), jsonOut = flag('--json', null);
const volumes = flag('--volume', String(EARTH_OCEAN_KM3)).split(',').map(Number);
const H = terrainConfig({}), out = [];
const pct = x => (100 * x).toFixed(1);

for (const seed of seeds) {
    const { scene, world } = pageWorld({ seed, cont, sim }), simMesh = buildSimMesh(sim, MESH_SEED), n = simMesh.numCells;
    const z = new Float32Array(n), rows = [];
    let scratch = null;
    simulateCached(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
        const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]]));
        const t0 = performance.now();
        surfaceKm(fr, simMesh, H, z);
        const t1 = performance.now();
        const crustLand = w => fr.owner[w] >= 0 && (fr.type[w] !== CrustType.OCEAN || (fr.seaFillKm[w] > 0 && seaFilledUp(fr.time - fr.formedAt[w], fr.seaFillKm[w])));
        const main = seaLevel(fr, simMesh, H, crustLand);
        let contCells = 0, mainLand = 0, floorCells = 0, floorZ = 0;
        for (let w = 0; w < n; w++) { if (crustLand(w)) mainLand++; else { floorCells++; floorZ += z[w]; } if (fr.owner[w] >= 0 && (fr.type[w] === CrustType.CONTINENT || fr.type[w] === CrustType.CRATON)) contCells++; }
        const row = { seed, t: Math.round(fr.time), mainSeaKm: main.seaKm, ridgeSeaKm: main.ridgeSeaKm, mainLand: mainLand / n, contShare: contCells / n, floorShare: floorCells / n, floorKm: floorZ / Math.max(1, floorCells), solves: [] };
        for (const V of volumes) {
            const s0 = performance.now(), P = pourOcean(simMesh, z, V, scratch), s1 = performance.now();
            scratch = P.scratch;
            let contSea = 0, aboveMain = 0;
            for (let w = 0; w < n; w++) {
                if (P.sea[w] && fr.owner[w] >= 0 && (fr.type[w] === CrustType.CONTINENT || fr.type[w] === CrustType.CRATON)) contSea++;
            }
            row.solves.push({ V, levelKm: P.levelKm, land: 1 - P.seaCells / n, contFlooded: contSea / Math.max(1, contCells), closedBelow: P.below / n, ms: s1 - s0 });
        }
        // what main's own sea level would cost in water on this ground (its sea read as the connected flood below it)
        const P0 = pourOcean(simMesh, z, volumes[0], scratch);
        row.vAtMain = volumeAt(simMesh, z, P0.spill, main.seaKm);
        row.surfaceMs = t1 - t0;
        rows.push(row);
    } }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim, meshSeed: MESH_SEED, heights: {}, by: 'ocean-drift' } });
    out.push(...rows);
    const L = rows.map(r => r.solves[0].levelKm * 1000), land = rows.map(r => r.solves[0].land), cf = rows.map(r => r.solves[0].contFlooded);
    const mn = a => Math.min(...a), mx = a => Math.max(...a), mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const ms = rows.flatMap(r => r.solves.map(s => s.ms)).sort((a, b) => a - b);
    console.log(`seed ${seed} (${rows.length} frames, V ${volumes[0].toExponential(3)} km³): level ${mn(L).toFixed(0)}…${mx(L).toFixed(0)} m (mean ${mean(L).toFixed(0)}) · land ${pct(mn(land))}…${pct(mx(land))} % (mean ${pct(mean(land))}) · continental crust flooded ${pct(mn(cf))}…${pct(mx(cf))} %`);
    console.log(`   main: sea ${mn(rows.map(r => r.mainSeaKm * 1000)).toFixed(0)}…${mx(rows.map(r => r.mainSeaKm * 1000)).toFixed(0)} m · land ${pct(mn(rows.map(r => r.mainLand)))}…${pct(mx(rows.map(r => r.mainLand)))} % · water its sea would take ${(mn(rows.map(r => r.vAtMain)) / 1e9).toFixed(3)}…${(mx(rows.map(r => r.vAtMain)) / 1e9).toFixed(3)}e9 km³`);
    console.log(`   cost: pour median ${ms[ms.length >> 1].toFixed(1)} ms (max ${ms[ms.length - 1].toFixed(1)}), surface ${mean(rows.map(r => r.surfaceMs)).toFixed(1)} ms`);
    for (const r of rows.filter(r => r.t % 100 === 0)) console.log(`   t ${r.t}: ` + r.solves.map(s => `V ${(s.V / 1e9).toFixed(2)}e9 → ${(s.levelKm * 1000).toFixed(0)} m, land ${pct(s.land)} %, cont flooded ${pct(s.contFlooded)} %, closed-below ${pct(s.closedBelow)} %`).join(' | ') + ` · main ${(r.mainSeaKm * 1000).toFixed(0)} m land ${pct(r.mainLand)} % · cont ${pct(r.contShare)} % · open floor ${pct(r.floorShare)} % at ${(r.floorKm * 1000).toFixed(0)} m`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out));
