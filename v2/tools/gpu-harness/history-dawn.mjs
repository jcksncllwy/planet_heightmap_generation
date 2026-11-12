// Dawn as this Node process's GPU for the HISTORY's erosion (lane graded: a history needs a GPU, tectonics/simulate.js
// historyGPU), without making it navigator.gpu: the finish's erosion goes on choosing its engine as before (GEO_SIM_DAWN=1,
// use-dawn.mjs), so a check's finish runs where it ran. The same Dawn object either way (dawn.mjs), so one device.
// Main thread only, as use-dawn.mjs.
import { isMainThread } from 'node:worker_threads';

if (isMainThread && !globalThis.geoSimHistoryGPU) {
    try { globalThis.geoSimHistoryGPU = (await import('./dawn.mjs')).gpu; } catch { /* (no Dawn here: a history refuses, simulate.js GPU_REQUIRED) */ }
}
