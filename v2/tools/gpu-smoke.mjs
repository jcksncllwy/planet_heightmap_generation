// The harness's smoke test: an adapter, and a pointer-jumping kernel (the operation FastFlow is built on) over 2.5M elements.
//   node v2/tools/gpu-smoke.mjs
import { gpu } from './gpu-harness/dawn.mjs';
import { openDevice, storage, readBack, pipeline, bind } from '../js/gpu/gpu-device.js';

const { device, info, limits } = await openDevice(gpu);
console.log('adapter', JSON.stringify({ vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, backend: info.backendType }));
console.log('limits', JSON.stringify({ binding: limits.maxStorageBufferBindingSize, buffer: limits.maxBufferSize, buffers: limits.maxStorageBuffersPerShaderStage, invocations: limits.maxComputeInvocationsPerWorkgroup }));

const n = 2_500_000, next = new Uint32Array(n);
for (let i = 0; i < n; i++) next[i] = Math.max(0, i - 1);          // one chain, the worst case: log₂ n passes reach the root
const code = /* wgsl */`
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < arrayLength(&src)) { dst[id.x] = src[src[id.x]]; }
}`;
const pipe = await pipeline(device, code);
const a = storage(device, next), b = storage(device, n * 4), ab = bind(device, pipe, [a, b]), ba = bind(device, pipe, [b, a]);
const passes = Math.ceil(Math.log2(n)) + 1, t0 = performance.now();
const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
pass.setPipeline(pipe);
for (let p = 0; p < passes; p++) { pass.setBindGroup(0, p % 2 ? ba : ab); pass.dispatchWorkgroups(Math.ceil(n / 256)); }
pass.end();
device.queue.submit([enc.finish()]);
await device.queue.onSubmittedWorkDone();
const t1 = performance.now(), out = await readBack(device, passes % 2 ? b : a, Uint32Array), t2 = performance.now();
let wrong = 0;
for (let i = 0; i < n; i++) if (out[i] !== 0) wrong++;
console.log(`pointer jumping: ${n} elements, ${passes} passes, ${(t1 - t0).toFixed(1)} ms, readback ${(t2 - t1).toFixed(1)} ms, wrong ${wrong}`);
process.exit(wrong ? 1 : 0);
