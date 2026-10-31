// How much of the finish's climate stage is the Helmholtz solver: the GPU sketch's Amdahl limit. Times HelmholtzSolver.solve inside a finish.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';
import { HelmholtzSolver } from '../js/climate/solver.js';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let ms = 0, calls = 0, cycles = 0, cells = 0;
const solve = HelmholtzSolver.prototype.solve;
HelmholtzSolver.prototype.solve = function (...a) { const t = performance.now(), r = solve.apply(this, a); ms += performance.now() - t; calls++; cycles += r.cycles ?? 0; cells = this.levels?.[0]?.n ?? cells; return r; };
const SEED = 831576, TIME = 310, SIM = 40000, frame = await momentFrame(ROOT, { seed: SEED, cont: 30, sim: SIM, time: TIME });
const simMesh = buildSimMesh(SIM, MESH_SEED), pool = await TerrainPool.create(simMesh);
const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: 640000, pool, closePool: true, debug: true, F: { ...FINISH }, onStage: () => {} });
console.log('CLIMATE', JSON.stringify({ stageMs: Math.round(fin.ms.climate), solverMs: Math.round(ms), calls, cycles, cells }));
process.exit(0);
