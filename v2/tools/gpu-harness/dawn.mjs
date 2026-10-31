// WebGPU in Node (Dawn, through the `webgpu` package in this folder's own package.json: `npm install` here). A tool-only
// dependency; the app has none. Timing runs want the discrete GPU where there is one, hence high-performance.
import { create, globals } from 'webgpu';

Object.assign(globalThis, globals);
export const gpu = create(process.env.GPU_BACKEND ? [`backend=${process.env.GPU_BACKEND}`] : []);
