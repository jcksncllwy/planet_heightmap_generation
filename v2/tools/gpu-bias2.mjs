// gpu-bias.mjs with replicates: each run, CPU and GPU, under K seeded rotations of every cell's neighbour list. Mean ± standard error
// of the hollows left, and of ponded volume: does a path differ from the other by more than ties can explain?
//   node v2/tools/gpu-bias2.mjs --dir FIXTURE [--reps 8] [--runs 0,1,2,3]
import fs from 'node:fs';
import path from 'node:path';
import { gpu } from './gpu-harness/dawn.mjs';
import { erodeGPU } from '../js/gpu/erode-gpu.js';
import { openDevice } from '../js/gpu/gpu-device.js';
import { erodeLandscape, hollowCensus } from '../js/finish/finish-erode.js';
import { loadRun } from './gpu-fixture.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir'), K = Number(arg('--reps', 8)), RUNS = arg('--runs', '0,1,2,3').split(',').map(Number), opened = await openDevice(gpu);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length, se = a => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1) / a.length); };
for (const id of RUNS) {
    const { o, P } = loadRun(DIR, id), start = o.z.slice(), n = o.mesh.numCells, a0 = o.mesh.adjList, { adjOffset } = o.mesh;
    const F = JSON.parse(fs.readFileSync(path.join(DIR, `run${id}`, 'closed.json'))).F;
    const out = { cpu: [], gpu: [] };
    for (let r = 1; r <= K; r++) {
        const rot = a0.slice();
        for (let c = 0; c < n; c++) { const lo = adjOffset[c], d = adjOffset[c + 1] - lo, s = Math.imul(c + 1, 2654435761 + 2 * r) >>> 13; for (let j = 0; j < d; j++) rot[lo + j] = a0[lo + (j + s) % d]; }
        for (const path_ of ['cpu', 'gpu']) {
            o.z.set(start); o.mesh.adjList = rot;
            if (path_ === 'cpu') erodeLandscape(o, P); else await erodeGPU(gpu, o, P, { device: opened });
            o.mesh.adjList = a0;
            const shown = hollowCensus(o.mesh, o.z, o.ocean, null, F.lakeMinKm2, 1e-3 * F.lakeMinDepthM), all = hollowCensus(o.mesh, o.z, o.ocean, null, 0, 0);
            out[path_].push({ open: shown.openMkm2, bodies: shown.openBodies, thin: shown.openUnder1kKm3Mkm2, all: all.openMkm2 });
        }
    }
    const row = { run: id, n };
    for (const k of ['open', 'bodies', 'thin', 'all']) { const c = out.cpu.map(v => v[k]), g = out.gpu.map(v => v[k]); row[k] = { cpu: +mean(c).toFixed(3), cpuSE: +se(c).toFixed(3), gpu: +mean(g).toFixed(3), gpuSE: +se(g).toFixed(3), t: +((mean(g) - mean(c)) / Math.hypot(se(c), se(g))).toFixed(1) }; }
    console.log(JSON.stringify(row));
}
process.exit(0);
