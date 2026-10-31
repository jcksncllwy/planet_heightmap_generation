// Saves what each erosion run of a finished moment starts from: mesh, fields, settings, as flat binary files. The GPU lane's
// fixture: tools can then run CPU and GPU erosion on the real inputs in seconds, on any machine, with no history or finish.
//   sim-slots run -n 6 --gb 16 --who gpu -- node --import ./v2/tools/gpu-harness/probe-hook.mjs v2/tools/gpu-capture.mjs --out DIR [--seed --time --cells]
import fs from 'node:fs';
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
const SEED = Number(arg('--seed', 831576)), TIME = Number(arg('--time', 310)), CELLS = Number(arg('--cells', 2500000)), SIM = 40000, OUT = arg('--out');
// (the erosion report's final design)
const DESIGN = { at: 'both', polishMyr: 0.3, polishSteps: 6, bury: true, rebound: 0.82, playaYears: 1, delta: true, ladder: [{ cells: 160000, timeMyr: 0.5, steps: 10 }, { cells: 640000, timeMyr: 0.2, steps: 4 }, { timeMyr: 0.1, steps: 2 }] };
fs.mkdirSync(OUT, { recursive: true });
const save = (dir, name, a) => fs.writeFileSync(path.join(dir, name + '.bin'), Buffer.from(a.buffer, a.byteOffset, a.byteLength));
const meshes = new Set(), runs = [];
let closedArgs = null;
globalThis.__closedArgs = a => { closedArgs = a; };
globalThis.__erodeEnter = (o, P) => {
    const n = o.mesh.numCells, id = runs.length, dir = path.join(OUT, `run${id}`), mdir = path.join(OUT, `mesh${n}`);
    fs.mkdirSync(dir, { recursive: true });
    if (!meshes.has(n)) { meshes.add(n); fs.mkdirSync(mdir, { recursive: true }); for (const k of ['adjOffset', 'adjList', 'xyz']) save(mdir, k, o.mesh[k]); fs.writeFileSync(path.join(mdir, 'mesh.json'), JSON.stringify({ numCells: n, edgeKm: o.mesh.edgeKm, adjType: o.mesh.adjList.constructor.name, offType: o.mesh.adjOffset.constructor.name, xyzType: o.mesh.xyz.constructor.name })); }
    for (const k of ['z', 'ocean', 'water', 'k', 'hold']) save(dir, k, o[k]);
    if (o.slow) save(dir, 'slow', o.slow);
    const closed = g => {
        const B = o.closed(g);
        if (closedArgs) {
            for (const k of ['runoff', 'pet', 'rain']) save(dir, k, closedArgs[k]);
            save(dir, 'closedOcean', closedArgs.ocean);
            fs.writeFileSync(path.join(dir, 'closed.json'), JSON.stringify({ cellKm2: closedArgs.cellKm2, F: closedArgs.F }));
            closedArgs = null;
        }
        return B;
    };
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ n, m: o.m, activeHold: o.activeHold, valleyKm: o.valleyKm, slow: !!o.slow, P, seed: SEED, time: TIME }));
    runs.push({ id, n, steps: P.steps, timeMyr: P.timeMyr });
    console.log('captured', JSON.stringify(runs[runs.length - 1]));
    return { ...o, closed };
};
const frame = await momentFrame(ROOT, { seed: SEED, cont: 30, sim: SIM, time: TIME });
const simMesh = buildSimMesh(SIM, MESH_SEED), pool = await TerrainPool.create(simMesh), t0 = performance.now();
const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, debug: true, F: { ...FINISH, erode: DESIGN }, onStage: () => {} });
fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify({ runs, seconds: (performance.now() - t0) / 1000, ms: fin.ms, erodeLevels: fin.stats.erode?.levels, polishMs: fin.stats.erodeLate?.ms }));
save(OUT, 'zFinal', fin.z);
console.log('done', JSON.stringify(fin.ms));
process.exit(0);
