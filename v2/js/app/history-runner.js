// A scene's history, run in a worker when the page has workers (history-worker.js) — the page never freezes, and
// `onProgress(timeMyr)` reports each frame as it arrives — or right here where it has none (Node: the check scripts).

import { simulate } from '../tectonics/simulate.js';
import { terrainConfig } from '../terrain/terrain-config.js';
import { PackedFrame } from '../tectonics/frame-pack.js';
import { historyEnding } from '../tectonics/ending.js';

/**
 * @param {{list: string, scene: Object, heights?: Object, ending?: string}} which   the scene, the name of its list in
 *        history-worker.js, overrides of the height constants the history evolves its heights with (terrain-config.js),
 *        and the stage it should end in (tectonics/ending.js: it then runs on past the scene's length until it is)
 * @returns {Promise<{frames: Object[], steps: number, stopped: boolean, complete: boolean}>}  stopped: it reached its
 *          ending; complete: it ran as far as a history may (so a longer run would not find more)
 */
export function runHistory({ list, scene, heights = {}, ending = 'none' }, simMesh, seed, snapshotEveryMyr, onProgress = () => {}) {
    if (typeof Worker === 'undefined') {
        const world = scene.build(simMesh, seed);
        world.config.heights = terrainConfig(heights);
        const { untilMyr, stopAt } = historyEnding(scene.maxMyr, ending, world.config);
        const r = simulate(world, { untilMyr, stopAt, drive: w => scene.drive(w), snapshotEveryMyr });
        return Promise.resolve({ ...r, complete: !r.stopped && ending !== 'none' });
    }
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./history-worker.js', import.meta.url), { type: 'module' }), frames = [];
        worker.onmessage = ({ data }) => {
            if (data.type === 'frame') { const frame = new PackedFrame(data.frame); frames.push(frame); onProgress(frame.time); }
            else if (data.type === 'done') { worker.terminate(); resolve({ frames, steps: data.steps, stopped: data.stopped, complete: !data.stopped && ending !== 'none' }); }
            else { worker.terminate(); reject(new Error(`history worker: ${data.message}`)); }
        };
        worker.onerror = e => { worker.terminate(); reject(new Error(`history worker: ${e.message}`)); };
        worker.postMessage({ list, sceneId: scene.id, seed, snapshotEveryMyr, heights, ending,
            mesh: { numCells: simMesh.numCells, xyz: simMesh.xyz, adjOffset: simMesh.adjOffset, adjList: simMesh.adjList } });
    });
}
