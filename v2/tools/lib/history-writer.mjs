// The history cache's writer (history-cache.mjs): a thread of its own that packs, compresses and writes the frames a
// build hands it, so the history runs on meanwhile (packing and deflating a 40K-cell frame takes ~45 ms; handing it over
// ~3 ms). It counts each frame done in the shared counter, so the building thread can wait — synchronously — for every
// frame to be on disk before it lets go of the build lock.

import { parentPort, workerData } from 'node:worker_threads';
import { putFrame, logEvent } from './history-cache.mjs';

const done = new Int32Array(workerData.counter);
parentPort.on('message', ({ key, frame }) => {
    try { putFrame(key, frame); } catch (err) { logEvent({ event: 'write-failed', key, time: frame.time, error: err.message }); }
    Atomics.add(done, 0, 1);
    Atomics.notify(done, 0);
});
