// The finish's land water against the climate's own (the runoff lane, Q7): for each seed@moment, the finish run at
// --cells, and its stats.waterStudy and lake/river stats printed as one JSON line.
//   node v2/tools/runoff-study.mjs --runs 831576@430,831576@340,626225@300 [--cont 30] [--sim 40000] [--cells 640000] [--set k=v,…]
// Run it through sim-slots (sim-slots run -n 4 --gb 8 --who runoff -- node …).
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
const CONT = Number(arg('--cont', 30)), SIM = Number(arg('--sim', 40000)), CELLS = Number(arg('--cells', 640000));
const F = { ...FINISH };
for (const kv of (arg('--set', '') || '').split(/,(?=[A-Za-z])/).filter(Boolean)) { const [k, v] = kv.split('='); F[k] = Number.isFinite(Number(v)) ? Number(v) : JSON.parse(v); }
const simMesh = buildSimMesh(SIM, MESH_SEED);
for (const run of arg('--runs', '831576@430').split(',')) {
    const [seed, time] = run.split('@').map(Number), t0 = performance.now();
    const frame = await momentFrame(ROOT, { seed, cont: CONT, sim: SIM, time });
    const pool = await TerrainPool.create(simMesh);
    const fin = await finishPlanet({ frame, simMesh, seed, cells: CELLS, pool, closePool: true, F });
    const s = fin.stats, pick = {};
    for (const k of Object.keys(s)) if (/lake|river|closed|endorh|salt|pan|playa|sea|water/i.test(k) && typeof s[k] !== 'object') pick[k] = s[k];
    console.log(JSON.stringify({ run, cells: CELLS, s: Math.round((performance.now() - t0) / 1000), finishMs: fin.ms, runoffShare: s.runoffShare, climateShare: s.climateRunoffShare, lakes: s.water, floods: s.floods, pick }));
}
process.exit(0);
