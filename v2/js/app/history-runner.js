// A scene's history, run in a worker when the page has workers (history-worker.js) — the page never freezes, and
// `onProgress(timeMyr)` reports each frame as it arrives — or right here where it has none (Node: the check scripts).

import { simulate } from '../tectonics/simulate.js';
import { terrainConfig } from '../terrain/terrain-config.js';
import { PackedFrame } from '../tectonics/frame-pack.js';

/**
 * @param {{list: string, scene: Object, heights?: Object}} which   the scene, the name of its list in history-worker.js,
 *        and overrides of the height constants the history evolves its heights with (terrain-config.js)
 * @returns {Promise<{frames: Object[], steps: number}>}
 */
export function runHistory({ list, scene, heights = {} }, simMesh, seed, snapshotEveryMyr, onProgress = () => {}) {
    if (typeof Worker === 'undefined') {
        const world = scene.build(simMesh, seed);
        world.config.heights = terrainConfig(heights);
        return Promise.resolve(simulate(world, { untilMyr: scene.maxMyr, drive: w => scene.drive(w), snapshotEveryMyr }));
    }
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./history-worker.js', import.meta.url), { type: 'module' }), frames = [];
        worker.onmessage = ({ data }) => {
            if (data.type === 'frame') { const frame = new PackedFrame(data.frame); frames.push(frame); onProgress(frame.time); }
            else if (data.type === 'done') { worker.terminate(); resolve({ frames, steps: data.steps }); }
            else { worker.terminate(); reject(new Error(`history worker: ${data.message}`)); }
        };
        worker.onerror = e => { worker.terminate(); reject(new Error(`history worker: ${e.message}`)); };
        worker.postMessage({ list, sceneId: scene.id, seed, snapshotEveryMyr, heights,
            mesh: { numCells: simMesh.numCells, xyz: simMesh.xyz, adjOffset: simMesh.adjOffset, adjList: simMesh.adjList } });
    });
}
