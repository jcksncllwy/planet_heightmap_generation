// closedBasins with its flood from the GPU, against its own: same ground, every call of a fixture's run. Sinks, levels, cut-off seas, time.
//   node v2/tools/gpu-closed.mjs --dir FIXTURE [--runs 0,1,2,3]
import fs from 'node:fs';
import path from 'node:path';
import { gpu } from './gpu-harness/dawn.mjs';
import { erodeGPU } from '../js/gpu/erode-gpu.js';
import { openDevice } from '../js/gpu/gpu-device.js';
import { loadRun } from './gpu-fixture.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir'), RUNS = arg('--runs', '0,1,2,3').split(',').map(Number), opened = await openDevice(gpu);
for (const id of RUNS) {
    const { o, P } = loadRun(DIR, id), n = o.mesh.numCells, orig = o.closed;
    o.closed = (g, fl) => {
        const t0 = performance.now(), A = orig(g), t1 = performance.now(), Bb = orig(g, fl), t2 = performance.now();
        let sinkDiff = 0, sinkA = 0, sinkB = 0, baseDiff = 0, top = 0;
        for (let c = 0; c < n; c++) { if (A.sink[c]) sinkA++; if (Bb.sink[c]) sinkB++; if (A.sink[c] !== Bb.sink[c]) sinkDiff++; else if (A.sink[c]) { const d = Math.abs(A.base[c] - Bb.base[c]); if (d > 1e-6) baseDiff++; if (d > top) top = d; } }
        let wetA = 0, wetB = 0; for (let c = 0; c < n; c++) { if (A.water[c] === A.water[c]) wetA++; if (Bb.water[c] === Bb.water[c]) wetB++; }
        console.log(JSON.stringify({ run: id, n, cpuMs: Math.round(t1 - t0), restMs: Math.round(t2 - t1), basins: [A.basins, Bb.basins], sink: [sinkA, sinkB], sinkDiffer: sinkDiff, baseDiffer: baseDiff, topKm: +top.toFixed(4), wet: [wetA, wetB], seas: [A.seas.length, Bb.seas.length] }));
        return A;
    };
    const R = await erodeGPU(gpu, o, P, { device: opened, gpuClosed: true });
    console.log('  ms', JSON.stringify(R.ms));
}
process.exit(0);
