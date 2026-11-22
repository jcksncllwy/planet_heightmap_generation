// Connected components on the GPU (lane gpucells M2; gpuscan "Shared GPU infrastructure" 4): the cells of a mask joined
// through the mesh's adjacency, each labelled with its component's smallest cell index — the same partition, and the same
// numbering, as a breadth-first flood that scans the cells in order (the first cell it meets of a body is that body's
// smallest), so a CPU flood's answers carry over exactly: integers only, nothing for a GPU to round.
//
// Shiloach–Vishkin's hook-and-jump (Shiloach & Vishkin 1982; as GPU connected components do it, e.g. Soman et al. 2010):
// each cell points at a cell of its component (its parent; a root points at itself). A hook pass takes every edge whose
// ends' roots differ and points the larger root at the smaller (atomicMin: whatever order the threads come in, a root ends
// at the least it was offered); a jump pass points every cell at its grandparent (pointer jumping: the trees halve in
// depth). Repeated until a hook pass changes nothing, every component is one star on its smallest cell. A round takes a
// hook and two jumps; components settle in O(log n) rounds in practice (a mesh's sea of 1.5M cells: ~10–20), where a plain
// label spread would take its diameter (thousands of cells). The rounds go in batches of ROUNDS a submit, with one
// readback of a "changed" counter a batch: the wait is the GPU's round trip, not the work.
// Deterministic on every GPU: the answer is the components' smallest indices, whatever the order the hooks land in.

import { pipeline, storage, readBack, bind } from './gpu-device.js';
import { meshFields, dispatch, INDEX_WGSL, WG } from './fields.js';

export const NONE = 0xFFFFFFFF;
const ROUNDS = 4;

const COMMON = /* wgsl */`
@group(0) @binding(0) var<storage, read> adjOffset: array<u32>;
@group(0) @binding(1) var<storage, read> adjList: array<u32>;
@group(0) @binding(2) var<storage, read_write> parent: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> changed: array<atomic<u32>>;
${INDEX_WGSL}
// (every kernel names every binding, so 'auto' layouts keep one bind group's shape: jump and flatten read neither the list nor the count)
fn bound() -> bool { return arrayLength(&adjList) + arrayLength(&changed) > 0u; }
fn rootOf(c: u32) -> u32 {
    var r = atomicLoad(&parent[c]);
    loop { let q = atomicLoad(&parent[r]); if (q == r) { break; } r = q; }
    return r;
}`;

// (hook: each masked cell's root, against each masked neighbour's: the larger root points at the smaller)
const HOOK = /* wgsl */`${COMMON}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg);
    if (c >= arrayLength(&adjOffset) - 1u) { return; }
    if (atomicLoad(&parent[c]) == ${NONE}u) { return; }
    for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) {
        let nb = adjList[k];
        if (nb < c || atomicLoad(&parent[nb]) == ${NONE}u) { continue; }       // (each edge once, from its lower end)
        let a = rootOf(c); let b = rootOf(nb);
        if (a == b) { continue; }
        let hi = max(a, b); let lo = min(a, b);
        let was = atomicMin(&parent[hi], lo);
        if (was != lo) { atomicAdd(&changed[0], 1u); }
    }
}`;

// (jump: each cell at its grandparent)
const JUMP = /* wgsl */`${COMMON}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg);
    if (c >= arrayLength(&adjOffset) - 1u) { return; }
    let p = atomicLoad(&parent[c]);
    if (p == ${NONE}u || !bound()) { return; }
    let g = atomicLoad(&parent[p]);
    if (g != p) { atomicStore(&parent[c], g); }
}`;

// (flatten, once no hook changes anything: the trees are fixed, so each cell straight to its root)
const FLAT = /* wgsl */`${COMMON}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg);
    if (c >= arrayLength(&adjOffset) - 1u) { return; }
    if (atomicLoad(&parent[c]) == ${NONE}u || !bound()) { return; }
    atomicStore(&parent[c], rootOf(c));
}`;

const pipes = new WeakMap();
function pipesOf(device) {
    if (!pipes.has(device)) pipes.set(device, Promise.all([pipeline(device, HOOK), pipeline(device, JUMP), pipeline(device, FLAT)]).then(([hook, jump, flat]) => ({ hook, jump, flat })));
    return pipes.get(device);
}

/**
 * The components of `mask` (1 = in) on `mesh` (its adjacency, resident: fields.js meshFields): each masked cell's label,
 * its component's smallest cell index; NONE where the mask is 0. Uint32Array(n).
 */
export async function componentLabels(device, mesh, mask) {
    const n = mesh.numCells, F = meshFields(device, mesh), init = new Uint32Array(n);
    for (let c = 0; c < n; c++) init[c] = mask[c] ? c : NONE;
    const { hook, jump, flat } = await pipesOf(device);
    const parent = storage(device, init), changed = storage(device, new Uint32Array(1));
    const bufs = [F.adjOffset, F.adjList, parent, changed], gh = bind(device, hook, bufs), gj = bind(device, jump, bufs), gf = bind(device, flat, bufs);
    const zero = new Uint32Array(1);
    const passes = (enc, list) => { for (const [pipe, group] of list) { const pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, group); dispatch(pass, n); pass.end(); } };
    try {
        for (let batch = 0; ; batch++) {
            if (batch > 64) throw new Error('componentLabels: the components did not settle in 256 rounds');
            device.queue.writeBuffer(changed, 0, zero);
            const enc = device.createCommandEncoder();
            for (let r = 0; r < ROUNDS; r++) passes(enc, [[hook, gh], [jump, gj], [jump, gj]]);
            device.queue.submit([enc.finish()]);
            const [k] = await readBack(device, changed, Uint32Array);
            if (k === 0) break;
        }
        const enc = device.createCommandEncoder();
        passes(enc, [[flat, gf]]);
        device.queue.submit([enc.finish()]);
        return await readBack(device, parent, Uint32Array);
    } finally { parent.destroy(); changed.destroy(); }
}
