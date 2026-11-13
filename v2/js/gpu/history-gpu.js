// The GPU a history erodes on (lane graded, 2026-11-12): its own small file, so that app/history-key.js (gpuFingerprint) can
// reach it without importing the history — the finish worker imports history-key.js for mathFingerprint, and its code hash
// (tools/lib/finish-cache.mjs) must not follow it into the history's steps.

import { sharedDevice } from './gpu-device.js';

/** The refusal a history gives where there is no GPU (agent-brief "A GPU is required", 2026-11-12). */
export const GPU_REQUIRED = 'A GPU is required: the history erodes its land on the GPU (WebGPU; in Node, Dawn: v2/tools/gpu-harness/history-dawn.mjs, which the tools\' history cache and check-kit load). There is no CPU path.';

/** The GPU the history erodes on: this page's or worker's navigator.gpu, or Dawn's in Node (v2/tools/gpu-harness/history-dawn.mjs, or
 *  use-dawn.mjs) — refused clearly where there is none. */
export async function historyGPU(gpu = globalThis.navigator?.gpu ?? globalThis.geoSimHistoryGPU) {
    const opened = gpu ? await sharedDevice(gpu) : null;
    if (!opened) throw new Error(GPU_REQUIRED);
    return { gpu, opened };
}
