// Whole-stage timing: every erosion run of a fixture on the CPU and the GPU, best of --reps. No per-step comparison: timing only.
//   node v2/tools/gpu-bench.mjs --dir FIXTURE [--reps 2] [--gpu-only]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gpu } from './gpu-harness/dawn.mjs';
import { erodeGPU } from '../js/gpu/erode-gpu.js';
import { openDevice } from '../js/gpu/gpu-device.js';
import { erodeLandscape } from '../js/finish/finish-erode.js';
import { loadRun } from './gpu-fixture.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }, has = k => process.argv.includes(k);
const DIR = arg('--dir'), REPS = Number(arg('--reps', 2)), runs = JSON.parse(fs.readFileSync(path.join(DIR, 'capture.json'))).runs;
const opened = await openDevice(gpu), best = (a, b) => (!a || b.total < a.total ? b : a), table = [];
console.log('machine', os.hostname(), os.cpus()[0].model, 'node', process.version, 'load', os.loadavg()[0].toFixed(1), JSON.stringify(opened.info.description));
for (const r of runs) {
    const { o, P } = loadRun(DIR, r.id), start = o.z.slice();
    let C = null, G = null;
    for (let i = 0; i < REPS; i++) {
        if (!has('--gpu-only')) { o.z.set(start); const t = performance.now(), R = erodeLandscape(o, P); C = best(C, { total: performance.now() - t, ms: R.ms }); }
        o.z.set(start); const t = performance.now(), R = await erodeGPU(gpu, o, P, { device: opened }); G = best(G, { total: performance.now() - t, ms: R.ms });
    }
    table.push({ run: r.id, n: r.n, steps: r.steps, cpuS: C && +(C.total / 1000).toFixed(2), gpuS: +(G.total / 1000).toFixed(2), cpu: C?.ms, gpu: G.ms });
    console.log(JSON.stringify(table[table.length - 1]));
}
const sum = k => table.reduce((v, t) => v + (t[k] ?? 0), 0);
console.log('TOTAL', JSON.stringify({ cpuS: +sum('cpuS').toFixed(2), gpuS: +sum('gpuS').toFixed(2), load: os.loadavg()[0].toFixed(1) }));
process.exit(0);
