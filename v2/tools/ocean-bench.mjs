// The inventory solve's cost by mesh size (lane ocean): pourOcean on a frame's ground carried to a finer mesh by nearest
// sim cell plus a little noise (so ties don't flatter the heap), the median of 5 solves.
// Usage: node v2/tools/ocean-bench.mjs [--cells 40000,640000,2500000] [--seed 626225] [--t 300]
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { momentFrame, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { surfaceKm, pourOcean, EARTH_OCEAN_KM3 } from '../js/tectonics/ocean/inventory.js';
import { REPO_ROOT } from './lib/history-cache.mjs';

setDelaunator(Delaunator);
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const sizes = flag('--cells', '40000,640000,2500000').split(',').map(Number), seed = Number(flag('--seed', 626225)), t = Number(flag('--t', 300));
const sim = buildSimMesh(40000, MESH_SEED), H = terrainConfig({});
const fr = await momentFrame(REPO_ROOT, { seed, cont: DEFAULT_CONT, sim: 40000, time: t });
const z0 = surfaceKm(fr, sim, H);
for (const n of sizes) {
    const t0 = performance.now(), mesh = n === 40000 ? sim : buildSimMesh(n, MESH_SEED), tm = performance.now() - t0;
    const z = new Float32Array(mesh.numCells);
    for (let c = 0; c < mesh.numCells; c++) z[c] = z0[sim.index.nearest(mesh.xyz[3 * c], mesh.xyz[3 * c + 1], mesh.xyz[3 * c + 2])] + 0.02 * Math.sin(c * 12.9898);
    let scratch = null, P;
    const ms = [];
    for (let i = 0; i < 5; i++) { const s = performance.now(); P = pourOcean(mesh, z, EARTH_OCEAN_KM3, scratch); scratch = P.scratch; ms.push(performance.now() - s); }
    ms.sort((a, b) => a - b);
    console.log(`${mesh.numCells} cells: pour median ${ms[2].toFixed(1)} ms (min ${ms[0].toFixed(1)}), level ${(P.levelKm * 1000).toFixed(0)} m, land ${(100 * (1 - P.seaCells / mesh.numCells)).toFixed(1)} % · mesh build ${(tm / 1000).toFixed(1)} s · rss ${(process.memoryUsage().rss / 1e9).toFixed(2)} GB`);
}
