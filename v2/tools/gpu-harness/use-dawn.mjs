// Dawn as this Node process's navigator.gpu, so that the finish's erosion runs on the GPU just as in a browser, in any tool or suite:
//   NODE_OPTIONS="--import=$PWD/v2/tools/gpu-harness/use-dawn.mjs" node v2/tools/render-moment.mjs ...
// (absolute path: run-checks' children inherit it. Main thread only: the terrain pool's workers want no GPU. See "WebGPU" in v2/README.md)
import { isMainThread } from 'node:worker_threads';

if (isMainThread) {
    const { gpu } = await import('./dawn.mjs');
    Object.defineProperty(globalThis.navigator, 'gpu', { value: gpu, configurable: true });
}
