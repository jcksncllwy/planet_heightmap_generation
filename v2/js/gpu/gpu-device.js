// WebGPU compute, for browser and Node alike: the plumbing every kernel here shares. No build step and no
// dependency: it takes a `navigator.gpu`-shaped object, the page's own or Dawn's (v2/tools/gpu-harness).

/** A device with the adapter's largest buffers: the default binding limit (128 MB) is under a 10M mesh's adjacency. */
export async function openDevice(gpu, { powerPreference = 'high-performance', features = [] } = {}) {
    const adapter = await timed(gpu.requestAdapter({ powerPreference }), 'requestAdapter');
    if (!adapter) throw new Error('no WebGPU adapter');
    const L = adapter.limits, want = features.filter(f => adapter.features.has(f));
    const device = await timed(adapter.requestDevice({
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
    }), 'requestDevice');
    device.addEventListener?.('uncapturederror', e => console.error('WebGPU:', e.error.message));
    watchLost(device);
    return { adapter, device, info: adapter.info, limits: device.limits };
}

// (one device a `gpu`, opened once and kept: a device lost, to a driver reset or a sleeping GPU, is forgotten, so the next run opens another)
const opened = new WeakMap();
/** The device erosion shares across its runs, or null where there is no adapter to give one. */
export function sharedDevice(gpu) {
    if (!opened.has(gpu)) opened.set(gpu, openDevice(gpu).then(d => { d.device.lost?.then(() => opened.delete(gpu)); return d; }, () => (opened.delete(gpu), null)));
    return opened.get(gpu);
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
    await gpuWait(device, stage.mapAsync(GPUMapMode.READ), `reading back ${buffer.label || 'a buffer'}`);
    const out = new Type(stage.getMappedRange().slice(0));
    stage.unmap(); stage.destroy();
    return out;
}

/** A compute pipeline from WGSL, with its layout inferred. Compile errors throw here, not as a silent validation error later. */
export async function pipeline(device, code, entryPoint = 'main', constants) {
    const module = device.createShaderModule({ code });
    const info = await (module.getCompilationInfo ? gpuWait(device, module.getCompilationInfo(), `compiling ${entryPoint}`) : undefined);
    const bad = info?.messages?.filter(m => m.type === 'error') ?? [];
    if (bad.length) throw new Error(bad.map(m => `${entryPoint}:${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
    return gpuWait(device, device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint, constants } }), `building pipeline ${entryPoint}`);
}

/** A bind group from a list of buffers: bindings 0, 1, 2… in order. */
export function bind(device, pipe, buffers, group = 0) {
    return device.createBindGroup({ layout: pipe.getBindGroupLayout(group), entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
}

// ── A GPU that stops answering fails loudly (lane histprof, 2026-11-21) ──
// Two check-phase10 runs on Upwell sat 3.5 h at 0 % CPU while the GPU was shared with a game: a WebGPU promise (a buffer's
// map, the queue's done) that never settled, Dawn keeping the process alive. Every wait on the GPU goes through gpuWait: it
// throws, naming its stage, when the device is lost or the wait outlasts gpuTimeoutMs, and nothing retries it (a history
// or a finish that dies here is rerun by whoever asked for it; a quietly retried GPU step could differ from the first).

/** How long one GPU wait may take, ms: GEO_SIM_GPU_TIMEOUT_S (Node) or globalThis.geoSimGpuTimeoutS, else 120 s — a 2.5M
 *  finish's longest single wait is a few seconds; a contended GPU is slower, not 30× slower. */
export function gpuTimeoutMs() {
    const s = Number(globalThis.geoSimGpuTimeoutS ?? globalThis.process?.env?.GEO_SIM_GPU_TIMEOUT_S ?? 120);
    return 1000 * (s > 0 ? s : 120);
}

// (each device's loss, once: a rejection every waiter races, its message the device's own; handled here so a loss with no
// wait pending is not an unhandled rejection — the page and a long session open a device once and wait on it thousands
// of times, so one promise a device, not one a wait)
const lostOf = new WeakMap();
class GPULost extends Error {}
function watchLost(device) {
    if (lostOf.has(device) || !device.lost) return lostOf.get(device);
    const p = device.lost.then(info => {
        const why = `${info?.reason ?? 'unknown'}${info?.message ? `: ${info.message}` : ''}`;
        if (info?.reason !== 'destroyed') console.error(`WebGPU device lost (${why})`);
        throw new GPULost(why);
    });
    p.catch(() => {});
    lostOf.set(device, p);
    return p;
}

/** `promise` (a wait on `device`), or a throw naming `stage` if the device is lost first or the wait outlasts `ms`. */
export async function gpuWait(device, promise, stage, ms = gpuTimeoutMs()) {
    const lost = device ? watchLost(device) : null;
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`GPU hang: ${stage} did not finish in ${ms / 1000} s (the device lost or its queue stalled? GEO_SIM_GPU_TIMEOUT_S sets the limit)`)), ms); });
    try { return await Promise.race(lost ? [promise, late, lost] : [promise, late]); }
    catch (e) { throw e instanceof GPULost ? new Error(`GPU device lost during ${stage} (${e.message})`) : e; }
    finally { clearTimeout(timer); }
}

/** A wait before there is a device (the adapter, the device itself): the timeout alone. */
const timed = (promise, stage) => gpuWait(null, promise, stage);
