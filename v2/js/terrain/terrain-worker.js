// A terrain worker (terrain-pool.js runs several): it holds the sim mesh and the positions of the terrain cells it is
// responsible for, builds the per-frame plan itself, and computes the surface of its chunks. Every terrain cell depends
// only on its position and the plan, so the pooled result is exactly the single-threaded one.
// Runs as a browser module worker or a Node worker thread.

import { preparePlan, surfaceRange, carveInputs, surfaceParts } from './synthesize.js';
import { sampleRange } from './terrain-mesh.js';
import { meshFromArrays } from '../core/sim-mesh.js';

const state = { sim: null, chunks: new Map() };          // chunk id → { xyz, cells, weights, samplerKey }
let post;
if (typeof self === 'undefined') {                         // Node worker thread
    const { parentPort } = await import('node:worker_threads');
    post = (msg, transfer) => parentPort.postMessage(msg, transfer);
    parentPort.on('message', handle);
} else {
    post = (msg, transfer) => self.postMessage(msg, transfer);
    self.onmessage = e => handle(e.data);
}

function handle(msg) {
    try {
        if (msg.type === 'sim') state.sim = meshFromArrays(msg.mesh);
        else if (msg.type === 'chunks') for (const c of msg.chunks) state.chunks.set(c.id, { xyz: c.xyz, cells: null, weights: null, samplerKey: null });
        else if (msg.type === 'job') runJob(msg);
    } catch (err) {
        post({ type: 'error', jobId: msg.jobId, message: err.stack ?? String(err) });
    }
}

function runJob({ jobId, frame, cfg, seed, edgeKm, parts: wantParts, carve: wantCarve, samplerKey, chunkIds }) {
    const plan = preparePlan(frame, state.sim, cfg, seed, edgeKm);
    for (const id of chunkIds) {
        const chunk = state.chunks.get(id), k = chunk.xyz.length / 3;
        // the sampler (warp + point location) depends on the mesh, the seed and the warp settings only: kept between frames
        let fresh = false;
        if (chunk.samplerKey !== samplerKey) {
            chunk.cells = new Int32Array(3 * k); chunk.weights = new Float32Array(3 * k);
            sampleRange(state.sim, chunk.xyz, cfg, seed, 0, k, chunk.cells, chunk.weights);
            chunk.samplerKey = samplerKey; fresh = true;
        }
        const heightKm = new Float32Array(k);
        const parts = wantParts ? surfaceParts(k) : null;
        const carve = wantCarve ? carveInputs(k) : null;
        surfaceRange(plan, cfg, seed, edgeKm, chunk.xyz, chunk.cells, chunk.weights, 0, k, heightKm, parts, carve);
        const out = { type: 'chunk', jobId, id, heightKm, parts, carve, cells: fresh ? chunk.cells.slice() : null, weights: fresh ? chunk.weights.slice() : null };
        const transfer = [heightKm.buffer, ...(parts ? Object.values(parts).map(a => a.buffer) : []), ...(carve ? Object.values(carve).map(a => a.buffer) : []), ...(fresh ? [out.cells.buffer, out.weights.buffer] : [])];
        post(out, transfer);
    }
    post({ type: 'done', jobId, kernels: plan.Ks[0].count + plan.Ks[1].count, volcanoes: plan.V.count });
}
