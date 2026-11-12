// (lane graded's probe: a page history to `--until` on the GPU, with the erosion's books and timing. Not a check)
import './gpu-harness/use-dawn.mjs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
setDelaunator(Delaunator);
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { simulate } from '../js/tectonics/simulate.js';
import { TECTONICS } from '../js/tectonics/config.js';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const seed = +arg('seed', 831576), sim = +arg('sim', 40000), until = +arg('until', 40);
const scene = TERRAIN_SCENES.find(s => s.id === 'cycle'), world = scene.build(buildSimMesh(sim, 12345), seed, { continentalFraction: TECTONICS.continentalFraction });
world.config.heights = terrainConfig({});
const t0 = performance.now();
let last = t0, prev = 0;
const r = await simulate(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => { const t = performance.now(), B = world.budget, e = (B.erodeErodedKm3 ?? 0) - (prev ?? 0); prev = B.erodeErodedKm3 ?? 0; console.log(`t=${f.time} ${((t - last) / 1000).toFixed(1)}s eroded ${(e / 10 / 1e6).toFixed(2)} km3/yr sea ${world.riverSea?.seaKm?.toFixed(3)}`); last = t; } });
const B = world.budget, G = v => ((v ?? 0) / 1e6).toFixed(2);
console.log(JSON.stringify({ steps: r.steps, s: +((performance.now() - t0) / 1000).toFixed(1), erodedMkm3: G(B.erodeErodedKm3), laidMkm3: G(B.erodeLaidKm3), fillTakenMkm3: G(B.erodeFillTakenKm3), unplacedMkm3: G(B.erodeUnplacedKm3), clampedMkm3: G(B.erodeClampedKm3), supplyMkm3: G(B.riverSupplyKm3), basinFillMkm3: G(B.basinFillKm3), erode: world.erodeTiming && { calls: world.erodeTiming.calls, s: +(world.erodeTiming.ms / 1000).toFixed(1), setupS: +(world.erodeTiming.setupMs / 1000).toFixed(1) } }));
