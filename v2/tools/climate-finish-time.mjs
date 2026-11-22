// The finish's climate stage, timed inside a real finish (Dawn): every stage's ms, and the climate solver's share (lane gpuclimate).
//   GEO_SIM_DAWN=1 node v2/tools/climate-finish-time.mjs [--seed 831576] [--time 430] [--cells 160000] [--sim 40000]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';
import { HelmholtzSolver } from '../js/climate/solver.js';
import { HelmholtzSolverGPU } from '../js/gpu/climate-solver.js';
await import('./gpu-harness/use-dawn.mjs');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let ms = 0, calls = 0;
// (the solves' wall time, the CPU's or the GPU's, whichever the finish uses)
for (const C of [HelmholtzSolver, HelmholtzSolverGPU]) {
    const solve = C.prototype.solve;
    C.prototype.solve = function (...a) { const t = performance.now(), r = solve.apply(this, a), done = (q) => { ms += performance.now() - t; calls++; return q; }; return r instanceof Promise ? r.then(done) : done(r); };
}
const SEED = +arg('--seed', 831576), TIME = +arg('--time', 430), SIM = +arg('--sim', 40000), CELLS = +arg('--cells', 160000);
const frame = await momentFrame(ROOT, { seed: SEED, cont: DEFAULT_CONT, sim: SIM, time: TIME });
const simMesh = buildSimMesh(SIM, MESH_SEED), pool = await TerrainPool.create(simMesh);
const t0 = performance.now();
const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, F: { ...FINISH }, onStage: () => {} });
console.log('FINISH', JSON.stringify({ seed: SEED, time: TIME, cells: CELLS, totalMs: Math.round(performance.now() - t0), solverMs: Math.round(ms), solverCalls: calls, rerun: fin.stats?.climateRerun ?? null, ms: Object.fromEntries(Object.entries(fin.ms).map(([k, v]) => [k, Math.round(v)])) }));
process.exit(0);
