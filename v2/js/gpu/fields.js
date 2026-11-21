// The GPU's resident field store and its small shared kit (lane gpuerode; gpuscan "Shared GPU infrastructure" 1 and 3):
//   · meshFields — a mesh's CSR adjacency and xyz, uploaded once a device and kept while the mesh is in use: a finish runs its
//     erosion on three or four meshes (the ladder's rungs and the polish), and every run of each re-uploaded them before.
//     Kept for the last MESHES meshes a device, the oldest destroyed when another comes (a 10M mesh's are ~0.5 GB).
//   · grid — a dispatch over any count: WebGPU caps a dispatch's workgroups at 65,535 a dimension (10M cells at 128 a group is
//     78,125), so counts past it run as rows; INDEX_WGSL turns the invocation back into its flat index.
//   · sumPartials — a deterministic sum: each workgroup of 256 sums its slice by a fixed tree in workgroup memory, and the
//     partials (one a 256 values) are added on this side in float64, in order. No float atomics, so the order never depends on
//     scheduling and a machine repeats its own sum to the bit (gpuscan "Determinism notes").

import { pipeline, readBack } from './gpu-device.js';

export const WG = 128, SUM_WG = 256, MAX_ROW = 65535;

/** The flat index of this invocation, in a kernel dispatched by grid(): `let i = flatIndex(id, nwg);` */
export const INDEX_WGSL = /* wgsl */`
fn flatIndex(id: vec3u, nwg: vec3u) -> u32 { return id.x + id.y * nwg.x * ${WG}u; }
`;

/** Workgroups (x, y) that cover `count` invocations at `wg` a group. */
export function grid(count, wg = WG) {
    const groups = Math.max(1, Math.ceil(count / wg)), x = Math.min(groups, MAX_ROW);
    return [x, Math.ceil(groups / x)];
}
/** Dispatch `count` invocations of the pipeline bound on `pass`. */
export const dispatch = (pass, count, wg = WG) => { if (count > 0) pass.dispatchWorkgroups(...grid(count, wg)); };

const STORE = new WeakMap(), MESHES = 4;
const usage = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
function upload(device, label, arr) {
    const b = device.createBuffer({ label, size: Math.max(4, arr.byteLength), usage: usage() });
    device.queue.writeBuffer(b, 0, arr.buffer, arr.byteOffset, arr.byteLength);
    return b;
}

/**
 * A mesh's resident buffers on `device`: { adjOffset, adjList (u32), xyz (f32), n }. Made on first use and kept; don't destroy
 * them (the store does, when it drops the mesh).
 */
export function meshFields(device, mesh) {
    if (!STORE.has(device)) STORE.set(device, []);
    const kept = STORE.get(device), at = kept.findIndex(e => e.mesh === mesh);
    if (at >= 0) { const [e] = kept.splice(at, 1); kept.push(e); return e.fields; }
    const fields = {
        n: mesh.numCells,
        adjOffset: upload(device, 'adjOffset', mesh.adjOffset instanceof Uint32Array ? mesh.adjOffset : Uint32Array.from(mesh.adjOffset)),
        adjList: upload(device, 'adjList', mesh.adjList instanceof Uint32Array ? mesh.adjList : Uint32Array.from(mesh.adjList)),
        xyz: upload(device, 'xyz', mesh.xyz instanceof Float32Array ? mesh.xyz : Float32Array.from(mesh.xyz)),
    };
    kept.push({ mesh, fields });
    while (kept.length > MESHES) { const { fields: f } = kept.shift(); f.adjOffset.destroy(); f.adjList.destroy(); f.xyz.destroy(); }
    return fields;
}

const SUM = /* wgsl */`
@group(0) @binding(0) var<storage, read> v: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
var<workgroup> s: array<f32, ${SUM_WG}>;
@compute @workgroup_size(${SUM_WG}) fn main(@builtin(local_invocation_index) l: u32, @builtin(workgroup_id) g: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let w = g.x + g.y * nwg.x; let i = w * ${SUM_WG}u + l;
    s[l] = select(0.0, v[i], i < arrayLength(&v));
    workgroupBarrier();
    for (var k = ${SUM_WG / 2}u; k > 0u; k >>= 1u) { if (l < k) { s[l] += s[l + k]; } workgroupBarrier(); }
    if (l == 0u) { out[w] = s[0]; }
}`;
const sums = new WeakMap();

/**
 * A summer for one f32 buffer of `count` values: `encode(enc)` adds its pass to a command encoder; `read()` (after that
 * encoder is submitted) answers the sum, in float64 over the partials. `destroy()` frees its partials.
 */
export async function sumPartials(device, buffer, count) {
    if (!sums.has(device)) sums.set(device, pipeline(device, SUM));
    const pipe = await sums.get(device), groups = Math.max(1, Math.ceil(count / SUM_WG));
    const out = device.createBuffer({ label: 'partials', size: 4 * groups, usage: usage() });
    const group = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer, size: 4 * count } }, { binding: 1, resource: { buffer: out } }] });
    return {
        encode(enc) { const p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, group); dispatch(p, count, SUM_WG); p.end(); },
        async read() { const part = await readBack(device, out); let t = 0; for (let i = 0; i < part.length; i++) t += part[i]; return t; },
        destroy() { out.destroy(); },
    };
}
