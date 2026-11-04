// The FSM wiring's probe (lane fsm-wire): one finished moment, its water's stats: the seas cut off from the ocean, the closed basins,
// the biggest lakes, and the water pass's own census. `node v2/tools/fsm-probe.mjs --seed 831576 --time 310 --cells 640000 [--set fsm=false]`
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
const SEED = Number(arg('--seed', 831576)), TIME = Number(arg('--time', 310)), CELLS = Number(arg('--cells', 640000));
const F = { ...FINISH };
for (const kv of (arg('--set', '') || '').split(/,(?=[A-Za-z_])/).filter(Boolean)) { const [k, v] = kv.split('='); F[k] = Number.isFinite(Number(v)) ? Number(v) : JSON.parse(v); }
const frame = await momentFrame(ROOT, { seed: SEED, cont: 30, sim: 40000, time: TIME });
const simMesh = buildSimMesh(40000, MESH_SEED), pool = await TerrainPool.create(simMesh);
const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, debug: true, F, onStage: () => {} });
const W = fin.stats.water;
console.log('SEAS ' + JSON.stringify(W.seas));
console.log('CLOSED ' + JSON.stringify({ n: W.closed.length, endo: +W.endorheicShare.toFixed(3), top: W.closed.slice(0, 8) }));
console.log('WATER ' + JSON.stringify({ share: +(100 * W.lakeShare).toFixed(2), byOrigin: W.byOriginShare, biggest: W.biggestLakesKm2, fresh: W.freshLakes, salt: W.saltLakes, pans: W.pans, filled: W.filledCells, kept: W.keptPockets, toSea: +W.toSeaShare.toFixed(3), toBasins: +W.toBasinsShare.toFixed(3), lost: +W.lostShare.toFixed(3), reaches: W.reaches, ms: fin.stats.ms?.water }));
if (W.fsm) console.log('FSM ' + JSON.stringify(W.fsm));
if (fin.layers.terminal) for (const t of fin.layers.terminal.slice(0, 6)) console.log('  ' + JSON.stringify(t));
