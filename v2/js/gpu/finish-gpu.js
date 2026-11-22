// The GPU the finish's required GPU stages run on (lane gpucells, 2026-11-22: the climate per cell, gpu/climate-cells.js;
// agent-brief "A GPU is required"): the page's or worker's navigator.gpu, or in Node Dawn's — use-dawn.mjs, or
// history-dawn.mjs (the tools' history cache and check-kit load it), the same Dawn object either way, so one device. The
// finish's erosion still chooses its own engine (finish.js erosionSolver); these stages have no CPU path.

import { sharedDevice } from './gpu-device.js';

/** The refusal a finish gives where there is no GPU. */
export const FINISH_GPU_REQUIRED = 'A GPU is required: the finish works out each cell\'s climate on the GPU (WebGPU; in Node, Dawn: v2/tools/gpu-harness/history-dawn.mjs or use-dawn.mjs). There is no CPU path.';

/** The device the finish's GPU stages share (the erosion's too, where it runs on the GPU) — refused clearly where there is none. */
export async function finishDevice(gpu = globalThis.navigator?.gpu ?? globalThis.geoSimHistoryGPU) {
    const opened = gpu ? await sharedDevice(gpu) : null;
    if (!opened) throw new Error(FINISH_GPU_REQUIRED);
    return opened.device;
}
