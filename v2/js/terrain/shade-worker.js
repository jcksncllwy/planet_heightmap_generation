// The shading worker (terrain-pool.js runs one): it holds the terrain meshes, sent once each, and hillshades frames'
// heights (view/terrain-shade.js) so the page's thread does not — the same shading, off the page — and finds which
// water below sea level is cut off from the world ocean (world-ocean.js) and balances it on the zonal climate
// (basin-estimate.js): a lake, or dry ground. Runs as a browser
// module worker or a Node worker thread.

import { hillshade } from '../view/terrain-shade.js';
import { worldOcean } from './world-ocean.js';
import { estimateCutOff } from './basin-estimate.js';
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
            const mesh = meshes.get(msg.numCells), shade = hillshade(mesh, msg.heightKm, msg.opts);
            // (and the seas cut off from it balanced on the zonal climate: basin-estimate.js)
            const sea = msg.opts?.seaLevelKm ?? 0, W = estimateCutOff(mesh, msg.heightKm, worldOcean(mesh, msg.heightKm, sea), TERRAIN, sea);
            const { cut, dry, paintKm, bodies, oceanCells, seas } = W;
            post({ type: 'shaded', jobId: msg.jobId, shade, water: { cut, dry, paintKm, bodies, oceanCells, seas } }, [shade.buffer, cut.buffer, dry.buffer, ...(paintKm ? [paintKm.buffer] : [])]);
        }
    } catch (err) {
        post({ type: 'error', jobId: msg.jobId, message: err.stack ?? String(err) });
    }
}
