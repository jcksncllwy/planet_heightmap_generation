// Is a CPU/GPU difference bias or tie-break noise? Each run from one start: CPU and GPU, each also with every cell's neighbours
// listed in reverse (same mesh, other arbitrary choices). The spread between a path and its reversal is that path's noise.
//   node v2/tools/gpu-bias.mjs --dir FIXTURE [--runs 0,1,2,3]
import fs from 'node:fs';
import path from 'node:path';
import { gpu } from './gpu-harness/dawn.mjs';
import { erodeGPU } from '../js/gpu/erode-gpu.js';
import { openDevice } from '../js/gpu/gpu-device.js';
import { erodeLandscape, hollowCensus } from '../js/finish/finish-erode.js';
import { loadRun } from './gpu-fixture.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir'), RUNS = arg('--runs', '0,1,2,3').split(',').map(Number), opened = await openDevice(gpu);
for (const id of RUNS) {
    const { o, P } = loadRun(DIR, id), start = o.z.slice(), n = o.mesh.numCells, a0 = o.mesh.adjList, { adjOffset } = o.mesh, flip = a0.slice();
    const F = JSON.parse(fs.readFileSync(path.join(DIR, `run${id}`, 'closed.json'))).F, a = 4 * Math.PI * 6371 ** 2 / n;
    for (let c = 0; c < n; c++) { const lo = adjOffset[c], hi = adjOffset[c + 1]; for (let j = lo; j < hi; j++) flip[j] = a0[hi - 1 - (j - lo)]; }
    const stats = name => { o.mesh.adjList = a0; const H = hollowCensus(o.mesh, o.z, o.ocean, null, F.lakeMinKm2, 1e-3 * F.lakeMinDepthM); let land = 0, sum = 0; for (let c = 0; c < n; c++) if (!o.ocean[c]) { land++; sum += o.z[c]; } console.log(JSON.stringify({ run: id, name, ...H, meanM: +(1000 * sum / land).toFixed(3), landKm3: Math.round(sum * a) })); };
    o.z.set(start); stats('start');
    for (const [name, adj] of [['cpu', a0], ['cpuFlip', flip]]) { o.z.set(start); o.mesh.adjList = adj; erodeLandscape(o, P); stats(name); }
    for (const [name, adj] of [['gpu', a0], ['gpuFlip', flip]]) { o.z.set(start); o.mesh.adjList = adj; await erodeGPU(gpu, o, P, { device: opened }); stats(name); }
}
process.exit(0);
