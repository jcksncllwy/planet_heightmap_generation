// The civ layer's GPU (lane civgpu2; agent-brief "A GPU is required"): one context per page worker or tool, opened once and
// kept, holding the device and every civ kernel compiled on it. The device is gpu-device.js's sharedDevice, so in a Node
// tool the civ shares one device with the history's and the finish's erosion: Dawn's `gpu` object is the same one either way
// (gpu-harness/dawn.mjs). On the page the civ runs in its own worker (civ-worker.js), and a GPUDevice can't cross workers,
// so the civ worker opens its own: once, for every run it keeps.
//
// What uses it:
//   · the famine's years (civ/years-gpu.js): float32, so the GPU's years differ from the CPU's by rounding at the famine's
//     thresholds. Judged by distributions, not bits (Jackson, 2026-11-26).
//   · later, the culture layer's lects: an integer kernel (u32 hashes and counts, no float) gets ctx.device and compiles its
//     WGSL once by name with ctx.kernel('lects', code). Integer arithmetic is exact, so that kernel will give the same bits
//     on every GPU and on the CPU.
// A device lost (a driver reset, a sleeping GPU) is forgotten by sharedDevice; the next civGPU() opens another, with its own
// kernels compiled again.

import { sharedDevice, pipeline } from '../gpu/gpu-device.js';

const contexts = new WeakMap();

/** The civ GPU context: { device, info, kernel(name, wgsl, entry) → Promise<GPUComputePipeline> }. Throws, saying so,
 *  where there is no WebGPU adapter: the civ layer needs a GPU (its CPU years are a check, not a fallback). */
export async function civGPU(gpu = globalThis.navigator?.gpu ?? globalThis.geoSimHistoryGPU) {
    const opened = gpu ? await sharedDevice(gpu) : null;
    if (!opened) throw new Error('The People layer needs a GPU (WebGPU) and this browser or machine has none. In Node, load v2/tools/gpu-harness/use-dawn.mjs.');
    const { device, info } = opened;
    if (!contexts.has(device)) {
        const pipes = new Map();
        contexts.set(device, {
            device, info,
            /** A compute pipeline, compiled once per device for each name (a name's code is the same all run). */
            kernel(name, code, entry = 'main') {
                if (!pipes.has(name)) pipes.set(name, pipeline(device, code, entry));
                return pipes.get(name);
            },
        });
    }
    return contexts.get(device);
}

/** Which engine lives the famine's years: 'gpu' (the page's), or 'cpu' (the reference, to check the GPU against). Tools
 *  take --cpu or GEO_SIM_CIV_CPU=1; the page always uses the GPU. */
export const civEngineOf = (argv = globalThis.process?.argv ?? [], env = globalThis.process?.env ?? {}) =>
    (argv.includes('--cpu') || env.GEO_SIM_CIV_CPU === '1' ? 'cpu' : 'gpu');
