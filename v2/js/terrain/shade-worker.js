// The shading worker (terrain-pool.js runs one): it holds the terrain meshes, sent once each, and hillshades frames'
// heights (view/terrain-shade.js) so the page's thread does not — the same shading, off the page — and finds which
// water below sea level is cut off from the world ocean (world-ocean.js), for the views that tint it apart. Runs as a browser
// module worker or a Node worker thread.

import { hillshade } from '../view/terrain-shade.js';
import { worldOcean } from './world-ocean.js';

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
            const mesh = meshes.get(msg.numCells), shade = hillshade(mesh, msg.heightKm, msg.opts);
            const { cut, bodies, oceanCells } = worldOcean(mesh, msg.heightKm, msg.opts?.seaLevelKm ?? 0);
            post({ type: 'shaded', jobId: msg.jobId, shade, water: { cut, bodies, oceanCells } }, [shade.buffer, cut.buffer]);
        }
    } catch (err) {
        post({ type: 'error', jobId: msg.jobId, message: err.stack ?? String(err) });
    }
}
