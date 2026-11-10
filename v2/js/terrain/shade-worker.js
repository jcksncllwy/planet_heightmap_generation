// The shading worker (terrain-pool.js runs one): it holds the terrain meshes, sent once each, and hillshades frames'
// heights (view/terrain-shade.js) so the page's thread does not — the same shading, off the page — and finds which
// water below sea level is cut off from the world ocean (world-ocean.js) and balances it on the zonal climate
// (basin-estimate.js): a lake, or dry ground — and lowers the world ocean by the water they hold. Runs as a browser
// module worker or a Node worker thread.

import { shadeWithWater } from './basin-estimate.js';
import { TERRAIN } from './terrain-config.js';

const meshes = new Map();                                  // numCells → { numCells, xyz, adjOffset, adjList }
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
        if (msg.type === 'mesh') meshes.set(msg.mesh.numCells, msg.mesh);
        else if (msg.type === 'shade') {
            // (the seas cut off from the world ocean balanced on the zonal climate, the ocean debited for what they hold —
            // basin-estimate.js — first: their dried ground is shaded as land)
            const shade = shadeWithWater(meshes.get(msg.numCells), msg.heightKm, msg.opts, TERRAIN), W = shade.water;
            delete shade.water;
            const { cut, dry, paintKm, bodies, oceanCells, seas, heldKm3, oceanFallKm } = W;
            post({ type: 'shaded', jobId: msg.jobId, shade, water: { cut, dry, paintKm, bodies, oceanCells, seas, heldKm3, oceanFallKm } }, [shade.buffer, cut.buffer, dry.buffer, ...(paintKm ? [paintKm.buffer] : [])]);
        }
    } catch (err) {
        post({ type: 'error', jobId: msg.jobId, message: err.stack ?? String(err) });
    }
}
