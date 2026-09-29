// A scene's history, run in a worker when the page has workers (history-worker.js) — the page never freezes, and
// `onProgress(timeMyr)` reports each frame as it arrives — or right here where it has none (Node: the check scripts).

import { simulate } from '../tectonics/simulate.js';
import { terrainConfig } from '../terrain/terrain-config.js';
import { PackedFrame } from '../tectonics/frame-pack.js';
import { historyEnding } from '../tectonics/ending.js';

/**
 * @param {{list: string, scene: Object, heights?: Object, ending?: string, start?: Object, lengthMyr?: number}} which   the
 *        scene, the name of its list in history-worker.js, overrides of the height constants the history evolves its
 *        heights with (terrain-config.js), the stage it should end in (tectonics/ending.js: it then runs on past its length
 *        until it is), start-world tunables for a scene that takes them, and a length other than the scene's
 * @param {(frame, index: number) => void} [onFrame]   each frame as it arrives (the Evolution page shows the planet as it builds)
 * @param {AbortSignal} [signal]   aborts the run (its worker is stopped; the promise rejects with an AbortError)
 * @returns {Promise<{frames: Object[], steps: number, stopped: boolean, complete: boolean}>}  stopped: it reached its
 *          ending; complete: it ran as far as a history may (so a longer run would not find more)
 */
export function runHistory({ list, scene, heights = {}, ending = 'none', start = {}, lengthMyr = null }, simMesh, seed, snapshotEveryMyr, onProgress = () => {}, onFrame = null, signal = null) {
    if (typeof Worker === 'undefined') {
        const world = scene.build(simMesh, seed, start);
        world.config.heights = terrainConfig(heights);
        const { untilMyr, stopAt } = historyEnding(lengthMyr ?? scene.maxMyr, ending, world.config);
        let n = 0;
        const r = simulate(world, { untilMyr, stopAt, drive: w => scene.drive(w), snapshotEveryMyr, onFrame: onFrame ? f => onFrame(f, n++) : null });
        return Promise.resolve({ ...r, complete: !r.stopped && ending !== 'none' });
    }
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./history-worker.js', import.meta.url), { type: 'module' }), frames = [];
        worker.onmessage = ({ data }) => {
            if (data.type === 'frame') { const frame = new PackedFrame(data.frame); frames.push(frame); onProgress(frame.time); onFrame?.(frame, frames.length - 1); }
            else if (data.type === 'done') { worker.terminate(); resolve({ frames, steps: data.steps, stopped: data.stopped, complete: !data.stopped && ending !== 'none', ms: data.ms, packMs: data.packMs }); }
            else { worker.terminate(); reject(new Error(`history worker: ${data.message}`)); }
        };
        worker.onerror = e => { worker.terminate(); reject(new Error(`history worker: ${e.message}`)); };
        signal?.addEventListener('abort', () => { worker.terminate(); reject(new DOMException('The history was stopped', 'AbortError')); }, { once: true });
        worker.postMessage({ list, sceneId: scene.id, seed, snapshotEveryMyr, heights, ending, start, lengthMyr,
            mesh: { numCells: simMesh.numCells, xyz: simMesh.xyz, adjOffset: simMesh.adjOffset, adjList: simMesh.adjList } });
    });
}
