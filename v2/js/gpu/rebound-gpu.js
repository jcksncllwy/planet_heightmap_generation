// The erosion's rebound on the GPU (lane gpuerode M1; gpuscan #1): finish-erode.js rebounder's arithmetic, with the ground
// left where the solver keeps it. What moved since the last settling (taken off or laid on, the history's own uplift not
// counted: its isostasy is already in it) is blurred over the lithosphere's flexural reach, σ = ERODE reboundKm, by
// neighbour-mean passes, and its Airy share (ERODE rebound, ρc/ρm) taken back from the land. On a fine ladder rung the load
// is averaged onto the coarsest rung's mesh, blurred there and carried back (rebounder's `flex`).
// It was 66–77 % of the GPU erosion's own time at every rung on the CPU (~132 passes over the mesh, 26 times a 160K finish:
// gpuscan); here each pass is one dispatch.
// Reduced model, as rebounder's: a Gaussian load blur, not thin-plate flexure (no elastic thickness, no forebulge); the sea's
// floor doesn't move under the land's unloading — but with ERODE marine (lane marine) it settles under its own load, in a second pass: sediment laid under water sinks the floor by
// 1 − 1/SEDIMENT_LOAD_FACTOR of itself (water-loaded Airy, ρs 2.5 against water 1.03 over mantle 3.3: ~0.65), the land's share
// ρc/ρm by the same blur, so a shelf's fill makes its own room as Earth's do (Steckler & Watts 1978). Thin-plate flexure with Te from the column is a separate later lane.
// Determinism: no atomics; the coarse mean gathers each coarse cell's fine cells in index order (as meanOnto adds them), and
// the km³ it moved is a fixed-tree sum (fields.js). float32 throughout, where rebounder's per-cell sums are doubles:
// tools/rebound-gpu-test.mjs measures the difference against a float64 reference.

import { pipeline, readBack } from './gpu-device.js';
import { WG, INDEX_WGSL, dispatch, meshFields, sumPartials } from './fields.js';
import { SEDIMENT_LOAD_FACTOR } from '../tectonics/measure.js';

const R_EARTH = 6371;

const HEAD = /* wgsl */`
struct U { share: f32, lifted: f32, w: f32, column: u32, sea: f32, mode: u32 }
${INDEX_WGSL}`;
const MAIN = `@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg);`;

const KERNELS = {
    // (the load since the last settling: land only)
    load: `${HEAD}
@group(0) @binding(0) var<uniform> U_: U;
@group(0) @binding(1) var<storage, read> z: array<f32>;
@group(0) @binding(2) var<storage, read> anchor: array<f32>;
@group(0) @binding(3) var<storage, read> lift: array<f32>;
@group(0) @binding(4) var<storage, read> ocean: array<u32>;
@group(0) @binding(5) var<storage, read_write> d: array<f32>;
${MAIN}
    if (c >= arrayLength(&anchor)) { return; }
    // (mode 0: the land's own load, the sea's floor none — it holds under the land's unloading, as it always has; mode 1, with ERODE
    // marine: the sea's sediment, what the waves laid or took, at its water-loaded share against the land's (U_.sea), the land none)
    let sea = ocean[c] != 0u;
    if (U_.mode == 0u) { d[c] = select(z[c] - anchor[c] - lift[c] * U_.lifted, 0.0, sea); }
    else { d[c] = select(0.0, (z[c] - anchor[c]) * U_.sea, sea); }
}`,
    // (a fine field's mean over each coarse cell, its fine cells in index order; a coarse cell none fell in takes 0: meanOnto)
    mean: `${HEAD}
@group(0) @binding(0) var<storage, read> invOff: array<u32>;
@group(0) @binding(1) var<storage, read> invList: array<u32>;
@group(0) @binding(2) var<storage, read> d: array<f32>;
@group(0) @binding(3) var<storage, read_write> dc: array<f32>;
${MAIN}
    if (c + 1u >= arrayLength(&invOff)) { return; }
    let a = invOff[c]; let b = invOff[c + 1u];
    var v = 0.0;
    for (var k = a; k < b; k++) { v += d[invList[k]]; }
    dc[c] = select(0.0, v / f32(b - a), b > a);
}`,
    // (one neighbour-mean pass: flexBlur's)
    blur: `${HEAD}
@group(0) @binding(0) var<uniform> U_: U;
@group(0) @binding(1) var<storage, read> off: array<u32>;
@group(0) @binding(2) var<storage, read> adj: array<u32>;
@group(0) @binding(3) var<storage, read> src: array<f32>;
@group(0) @binding(4) var<storage, read_write> dst: array<f32>;
${MAIN}
    if (c + 1u >= arrayLength(&off)) { return; }
    var v = 0.0;
    let a = off[c]; let b = off[c + 1u];
    for (var j = a; j < b; j++) { v += src[adj[j]]; }
    let s = src[c];
    dst[c] = s + U_.w * (v / f32(b - a) - s);
}`,
    // (the coarse blur carried back to the fine mesh, by the 3 coarse cells around each fine one: carry)
    carry: `${HEAD}
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> weights: array<f32>;
@group(0) @binding(2) var<storage, read> dc: array<f32>;
@group(0) @binding(3) var<storage, read_write> d: array<f32>;
${MAIN}
    if (c >= arrayLength(&d)) { return; }
    let i = 3u * c;
    d[c] = weights[i] * dc[cells[i]] + weights[i + 1u] * dc[cells[i + 1u]] + weights[i + 2u] * dc[cells[i + 2u]];
}`,
    // (the land settles by its share of the blurred load; the rock's top moves with it; the anchor is the ground now)
    apply: `${HEAD}
@group(0) @binding(0) var<uniform> U_: U;
@group(0) @binding(1) var<storage, read> d: array<f32>;
@group(0) @binding(2) var<storage, read> ocean: array<u32>;
@group(0) @binding(3) var<storage, read_write> z: array<f32>;
@group(0) @binding(4) var<storage, read_write> anchor: array<f32>;
@group(0) @binding(5) var<storage, read_write> moved: array<f32>;
@group(0) @binding(6) var<storage, read_write> Kv: array<vec4f>;
${MAIN}
    if (c >= arrayLength(&anchor)) { return; }
    if (ocean[c] != 0u && U_.mode == 0u) { moved[c] = 0.0; return; }     // (mode 1: the sea's load sinks the floor and the coast beside it)
    let was = z[c]; let now = was - U_.share * d[c]; let dz = now - was;
    z[c] = now; anchor[c] = now; moved[c] = dz;
    if (U_.column != 0u) { Kv[c].y += dz; }
}`,
};

const compiled = new WeakMap();
const pipelinesOf = device => {
    if (!compiled.has(device)) compiled.set(device, (async () => Object.fromEntries(await Promise.all(Object.entries(KERNELS).map(async ([k, code]) => [k, await pipeline(device, code)]))))());
    return compiled.get(device);
};

// (each coarse cell's fine cells, in fine index order: meanOnto's sum, gathered. Made once a map)
const inverses = new WeakMap();
function inverseOf(map, m) {
    if (inverses.has(map)) return inverses.get(map);
    const near = map.nearest, n = near.length, off = new Uint32Array(m + 1), list = new Uint32Array(n);
    for (let i = 0; i < n; i++) off[near[i] + 1]++;
    for (let c = 0; c < m; c++) off[c + 1] += off[c];
    const at = off.slice(0, m);
    for (let i = 0; i < n; i++) list[at[near[i]]++] = i;
    const inv = { off, list };
    inverses.set(map, inv);
    return inv;
}

/** Neighbour-mean passes and their weight for σ = reachKm on a mesh of this spacing: flexBlur's. */
export function blurPasses(edgeKm, reachKm) {
    const need = 2 * reachKm * reachKm / (edgeKm * edgeKm), passes = Math.ceil(need / 0.5);
    return { passes, w: need / passes };
}

/**
 * A rebounder whose ground stays on the GPU. `z`: the solver's ground buffer (n f32), read for the anchor now, so upload the
 * ground first. `lift`: the history's uplift buffer (km/Myr; null: none). `Kv`: the solver's packed k buffer (vec4: its .y the
 * rock's top, moved with the ground; null: no column). `ocean`: the world ocean now (setOcean when it changes). `flex`: a
 * coarser mesh to blur on (rebounder's). @returns {{ settle(at: number): Promise<number>, setOcean(o: Uint8Array): void, destroy(): void }}
 *   settle: the ground settled in place on the GPU at the run's time `at` (Myr); answers the km³ the land moved by.
 */
export async function reboundGPU(device, { mesh, z, lift = null, Kv = null, ocean, flex = null, P }) {
    const n = mesh.numCells, a = 4 * Math.PI * R_EARTH * R_EARTH / n, P_ = await pipelinesOf(device);
    const U32 = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, own = [];
    const mk = (label, bytes) => { const b = device.createBuffer({ label, size: Math.max(16, bytes), usage: U32 }); own.push(b); return b; };
    const up = (label, arr) => { const b = mk(label, arr.byteLength); device.queue.writeBuffer(b, 0, arr.buffer, arr.byteOffset, arr.byteLength); return b; };
    const anchor = mk('anchor', 4 * n), d = mk('d', 4 * n), moved = mk('moved', 4 * n), oc = mk('ocean', 4 * n);
    const liftB = lift ?? up('lift0', new Float32Array(n)), KvB = Kv ?? mk('Kv0', 16);
    const uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    own.push(uniform);
    const setOcean = o => device.queue.writeBuffer(oc, 0, Uint32Array.from(o));
    setOcean(ocean);
    // (the anchor: the ground as it stands now)
    { const e = device.createCommandEncoder(); e.copyBufferToBuffer(z, 0, anchor, 0, 4 * n); device.queue.submit([e.finish()]); }
    const g = (name, list) => device.createBindGroup({ layout: P_[name].getBindGroupLayout(0), entries: list.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const blurMesh = flex ? flex.mesh : mesh, bm = blurMesh.numCells, BF = meshFields(device, blurMesh);
    const { passes, w } = blurPasses(blurMesh.edgeKm, P.reboundKm);
    // (the blur's ping-pong: on this mesh, d ⇄ e; on the coarse one, dc ⇄ ec)
    const e2 = mk('e', 4 * bm), src = flex ? mk('dc', 4 * bm) : d;
    const G = { load: g('load', [uniform, z, anchor, liftB, oc, d]), apply: g('apply', [uniform, d, oc, z, anchor, moved, KvB]),
        blurAB: g('blur', [uniform, BF.adjOffset, BF.adjList, src, e2]), blurBA: g('blur', [uniform, BF.adjOffset, BF.adjList, e2, src]) };
    if (flex) {
        const inv = inverseOf(flex.map, bm);
        G.mean = g('mean', [up('invOff', inv.off), up('invList', inv.list), d, src]);
        G.carry = g('carry', [up('cells', Uint32Array.from(flex.map.cells)), up('weights', Float32Array.from(flex.map.weights)), src, d]);
    }
    const sum = await sumPartials(device, moved, n), ub = new ArrayBuffer(32), uv = new DataView(ub);
    // (the sea floor's load against the land's share, so that share × it is its own water-loaded share: 0 with no marine work)
    const seaRatio = P.marine && P.rebound > 0 ? (1 - 1 / SEDIMENT_LOAD_FACTOR) / P.rebound : 0;
    let since = 0;
    const settle = async (at = 0) => {
        let km3 = await settleOnce(at, 0);
        if (seaRatio > 0) km3 += await settleOnce(at, 1);
        since = at;
        return km3;
    };
    const settleOnce = async (at, mode) => {
        uv.setFloat32(0, P.rebound, true); uv.setFloat32(4, at - since, true); uv.setFloat32(8, w, true); uv.setUint32(12, Kv ? 1 : 0, true); uv.setFloat32(16, seaRatio, true); uv.setUint32(20, mode, true);
        device.queue.writeBuffer(uniform, 0, ub);
        // (one pass a stretch: WebGPU orders a pass's dispatches, each seeing the last one's writes)
        const e = device.createCommandEncoder();
        let p = e.beginComputePass();
        const step = (name, grp, count) => { p.setPipeline(P_[name]); p.setBindGroup(0, grp); dispatch(p, count); };
        step('load', G.load, n);
        if (flex) step('mean', G.mean, bm);
        for (let i = 0; i < passes; i++) step('blur', i % 2 ? G.blurBA : G.blurAB, bm);
        p.end();
        if (passes % 2) e.copyBufferToBuffer(e2, 0, src, 0, 4 * bm);
        p = e.beginComputePass();
        if (flex) step('carry', G.carry, n);
        step('apply', G.apply, n);
        p.end();
        sum.encode(e);
        device.queue.submit([e.finish()]);
        return (await sum.read()) * a;
    };
    return { settle, setOcean, destroy: () => { sum.destroy(); for (const b of own) b.destroy(); } };
}

/** Read a Kv buffer's rock tops back into a column's zBed (after the run: the GPU moved them with the ground). */
export async function zBedBack(device, Kv, column) {
    const kv = await readBack(device, Kv), zb = column.zBed;
    for (let c = 0; c < zb.length; c++) zb[c] = kv[4 * c + 1];
}
