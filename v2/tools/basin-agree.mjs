// The timeline's estimate of its cut-off seas (terrain/basin-estimate.js: the zonal climate) against what Add detail finds
// for the same moment (finish/finish-basins.js on the finish's own climate): per sea, do they agree whether water stands
// in it (wet: it fills to its sill, or keeps a lake the map can show) or not?
//
//   node v2/tools/basin-agree.mjs [--seeds 626225,831576,799224] [--times 300,600,900,1200] [--cells 160000]
//        [--finish 640000] [--sim 40000]
//
// Seas are matched by their lowest points (within matchKm, the nearer first); a sea only one side finds is counted apart.
// On a shared machine run it through sim-slots (sim-slots run -n 6 --gb 12).

import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { synthesizeTerrain } from '../js/terrain/synthesize.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { worldOcean } from '../js/terrain/world-ocean.js';
import { estimateCutOff } from '../js/terrain/basin-estimate.js';
import { finishPlanet } from '../js/finish/finish.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEEDS = arg('--seeds', '626225,831576,799224').split(',').map(Number), TIMES = arg('--times', '300,600,900,1200').split(',').map(Number);
const CELLS = Number(arg('--cells', 160000)), FIN = Number(arg('--finish', 640000)), SIM = Number(arg('--sim', 40000)), MATCH_KM = 500;
const R = 6371, cfg = terrainConfig(), simMesh = buildSimMesh(SIM, MESH_SEED), tm = terrainMesh(CELLS);
const kmBetween = (a, i, b, j) => R * Math.acos(Math.min(1, a[3 * i] * b[3 * j] + a[3 * i + 1] * b[3 * j + 1] + a[3 * i + 2] * b[3 * j + 2]));
const tot = { agree: 0, matched: 0, km2: 0, agreeKm2: 0, onlyT: 0, onlyF: 0, tWet: 0, fWet: 0 };
for (const seed of SEEDS) for (const time of TIMES) {
    const frame = await momentFrame(ROOT, { seed, cont: 30, sim: SIM, time });
    const T = synthesizeTerrain(frame, simMesh, tm, { seed });
    const est = estimateCutOff(tm, T.heightKm, worldOcean(tm, T.heightKm, 0), cfg).seas;
    const pool = await TerrainPool.create(simMesh);
    const fin = await finishPlanet({ frame, simMesh, seed, cells: FIN, pool, closePool: true, onStage: () => {} });
    const fm = terrainMesh(FIN), fs = fin.stats.cutOffSeas ?? [];
    const used = new Set(), rows = [];
    for (const f of fs) {
        let best = -1, bd = MATCH_KM;
        for (let i = 0; i < est.length; i++) if (!used.has(i)) { const d = kmBetween(fm.xyz, f.low, tm.xyz, est[i].low); if (d < bd) { bd = d; best = i; } }
        if (best < 0) { tot.onlyF++; rows.push(`  finish only: ${(f.km2 / 1e3).toFixed(0)}k km² ${f.wet ? 'wet' : 'dry'}`); continue; }
        used.add(best);
        const e = est[best], same = !!e.wet === !!f.wet;
        tot.matched++; tot.agree += same; tot.km2 += f.km2; tot.agreeKm2 += same ? f.km2 : 0; tot.tWet += !!e.wet; tot.fWet += !!f.wet;
        rows.push(`  ${same ? 'agree   ' : 'DISAGREE'} ${(f.km2 / 1e3).toFixed(0)}k km² floor ${(1000 * f.floorKm).toFixed(0)} m: timeline ${e.full ? 'full' : e.wet ? 'lake' : 'dry'}, finish ${f.full ? 'full' : f.wet ? 'lake' : 'dry'} (${bd.toFixed(0)} km apart)`);
    }
    for (let i = 0; i < est.length; i++) if (!used.has(i)) { tot.onlyT++; rows.push(`  timeline only: ${(est[i].km2 / 1e3).toFixed(0)}k km² ${est[i].wet ? 'wet' : 'dry'}`); }
    console.log(`seed ${seed} at ${time} Myr: ${est.length} seas on the timeline, ${fs.length} in the finish`);
    for (const r of rows) console.log(r);
}
console.log(`\nagree in sign on ${tot.agree} of ${tot.matched} matched seas (${(100 * tot.agree / Math.max(1, tot.matched)).toFixed(0)} %; by area ${(100 * tot.agreeKm2 / Math.max(1, tot.km2)).toFixed(0)} %); wet: timeline ${tot.tWet}, finish ${tot.fWet}; unmatched: timeline ${tot.onlyT}, finish ${tot.onlyF}`);
process.exit(0);
