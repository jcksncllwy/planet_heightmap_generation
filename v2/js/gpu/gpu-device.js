// WebGPU compute, for browser and Node alike (lane gpu, 2026-10-31): the plumbing every kernel here shares. No build step and no
// dependency: it takes a `navigator.gpu`-shaped object, the page's own or Dawn's (v2/tools/gpu-harness). Nothing in the app
// loads this yet.

/** A device with the adapter's largest buffers: the default binding limit (128 MB) is under a 10M mesh's adjacency. */
export async function openDevice(gpu, { powerPreference = 'high-performance', features = [] } = {}) {
    const adapter = await gpu.requestAdapter({ powerPreference });
    if (!adapter) throw new Error('no WebGPU adapter');
    const L = adapter.limits, want = features.filter(f => adapter.features.has(f));
    const device = await adapter.requestDevice({
        requiredFeatures: want,
        requiredLimits: {
            maxStorageBufferBindingSize: L.maxStorageBufferBindingSize,
            maxBufferSize: L.maxBufferSize,
            maxStorageBuffersPerShaderStage: L.maxStorageBuffersPerShaderStage,
            maxComputeWorkgroupStorageSize: L.maxComputeWorkgroupStorageSize,
            maxComputeInvocationsPerWorkgroup: L.maxComputeInvocationsPerWorkgroup,
            maxComputeWorkgroupSizeX: L.maxComputeWorkgroupSizeX,
            maxComputeWorkgroupsPerDimension: L.maxComputeWorkgroupsPerDimension,
        },
    });
    device.addEventListener?.('uncapturederror', e => console.error('WebGPU:', e.error.message));
    return { adapter, device, info: adapter.info, limits: device.limits };
}

/** A storage buffer, filled from a typed array or empty at `size` bytes. */
export function storage(device, source, extra = 0) {
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | extra;
    if (typeof source === 'number') return device.createBuffer({ size: source, usage });
    const b = device.createBuffer({ size: source.byteLength, usage });
    device.queue.writeBuffer(b, 0, source.buffer, source.byteOffset, source.byteLength);
    return b;
}

/** A buffer's contents, back on this side: `Type` a typed-array constructor. */
export async function readBack(device, buffer, Type = Float32Array, bytes = buffer.size) {
    const stage = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(buffer, 0, stage, 0, bytes);
    device.queue.submit([enc.finish()]);
    await stage.mapAsync(GPUMapMode.READ);
    const out = new Type(stage.getMappedRange().slice(0));
    stage.unmap(); stage.destroy();
    return out;
}

/** A compute pipeline from WGSL, with its layout inferred. Compile errors throw here, not as a silent validation error later. */
export async function pipeline(device, code, entryPoint = 'main', constants) {
    const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo?.();
    const bad = info?.messages?.filter(m => m.type === 'error') ?? [];
    if (bad.length) throw new Error(bad.map(m => `${entryPoint}:${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
    return device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint, constants } });
}

/** A bind group from a list of buffers: bindings 0, 1, 2… in order. */
export function bind(device, pipe, buffers, group = 0) {
    return device.createBindGroup({ layout: pipe.getBindGroupLayout(group), entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
}
