// The erosion's rebound on the GPU: the lithosphere bending under what the erosion moved (lane flexure, 2026-11-22; was lane
// gpuerode's Gaussian blur, gpuscan #1). What moved since the last settling — taken off or laid on, the history's own uplift
// not counted (its isostasy is already in it) — is a load on a thin elastic plate over the mantle (gpu/flexure.js), Te from
// the column (finish.js elasticOn); the plate's deflection, solved on the GPU (flexure-gpu.js), moves the ground, land and sea
// floor alike, and the rock's top with it.
// The load: on land the rock's density over the mantle's (ERODE rebound, ρc/ρm = 0.82: Airy's share when the load is wider than
// the plate's flexural length), the trough left to the air; under the sea the sediment's under water ((ρs − ρw)/ρm ≈ 0.45, the
// trough filled with water: its buoyancy (ρm − ρw)/ρm) — the sea's sediment load compensated, the gap marine's report left
// ("the second rebound pass stays off": a Gaussian has no forebulge, and drowned the coast). A narrow load is held up by the
// plate over α and bends the ground beside it; a wide one sinks by its Airy share.
// Limits: on land, the sediment laid (ρs 2.5) loads as rock (2.7); the plate answers at once (no viscous mantle or plate
// relaxation: kyr and Myr against the finish's ≤ 1 Myr span); and flexure.js's own (thin plate, flat, no broken ends).
// Determinism: flexure-gpu.js's (no atomics, fixed trees); the km³ moved is a fixed-tree sum (fields.js).

import { readBack, pipeline } from './gpu-device.js';
import { WG, INDEX_WGSL, dispatch, sumPartials } from './fields.js';
import { FLEX, seaLoadShare } from './flexure.js';
import { plateSolverGPU } from './flexure-gpu.js';
import { terrainMesh } from '../terrain/terrain-mesh.js';

const R_EARTH = 6371;

const HEAD = /* wgsl */`
struct U { land: f32, sea: f32, lifted: f32, column: u32 }
${INDEX_WGSL}`;
const MAIN = `@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg);`;

const KERNELS = {
    // (the load since the last settling, mantle-equivalent km, times the cell's area: the plate's right side)
    load: `${HEAD}
@group(0) @binding(0) var<uniform> U_: U;
@group(0) @binding(1) var<storage, read> z: array<f32>;
@group(0) @binding(2) var<storage, read> anchor: array<f32>;
@group(0) @binding(3) var<storage, read> lift: array<f32>;
@group(0) @binding(4) var<storage, read> ocean: array<u32>;
@group(0) @binding(5) var<storage, read> M: array<f32>;
@group(0) @binding(6) var<storage, read_write> b: array<f32>;
${MAIN}
    if (c >= arrayLength(&anchor)) { return; }
    let share = select(U_.land, U_.sea, ocean[c] != 0u);
    b[c] = M[c] * share * (z[c] - anchor[c] - lift[c] * U_.lifted);
}`,
    // (the ground moves by the plate's deflection, up where unloaded; the rock's top with it; the anchor is the ground now)
    apply: `${HEAD}
@group(0) @binding(0) var<uniform> U_: U;
@group(0) @binding(1) var<storage, read> w: array<f32>;
@group(0) @binding(2) var<storage, read_write> z: array<f32>;
@group(0) @binding(3) var<storage, read_write> anchor: array<f32>;
@group(0) @binding(4) var<storage, read_write> moved: array<f32>;
@group(0) @binding(5) var<storage, read_write> Kv: array<vec4f>;
${MAIN}
    if (c >= arrayLength(&anchor)) { return; }
    let dz = -w[c]; let now = z[c] + dz;
    z[c] = now; anchor[c] = now; moved[c] = dz;
    if (U_.column != 0u) { Kv[c].y += dz; }
}`,
};

const compiled = new WeakMap();
const pipelinesOf = device => {
    if (!compiled.has(device)) compiled.set(device, (async () => Object.fromEntries(await Promise.all(Object.entries(KERNELS).map(async ([k, code]) => [k, await pipeline(device, code)]))))());
    return compiled.get(device);
};

/**
 * A rebounder whose ground stays on the GPU. `z`: the solver's ground buffer (n f32), read for the anchor now, so upload the
 * ground first. `lift`: the history's uplift buffer (km/Myr; null: none). `Kv`: the solver's packed k buffer (vec4: its .y the
 * rock's top, moved with the ground; null: no column). `ocean`: the world ocean now (setOcean when it changes). `te`: the
 * plate's elastic thickness on this mesh (km; null: FLEX.continentTeKm everywhere). `meshOf`: the coarser terrain meshes.
 * @returns {Promise<{ settle(at: number): Promise<number>, setOcean(o: Uint8Array): void, destroy(): void, last: Object }>}
 *   settle: the ground settled in place on the GPU at the run's time `at` (Myr); answers the km³ the ground moved by.
 */
export async function reboundGPU(device, { mesh, z, lift = null, Kv = null, ocean, te = null, meshOf = terrainMesh, P, F = FLEX }) {
    const n = mesh.numCells, a = 4 * Math.PI * R_EARTH * R_EARTH / n, P_ = await pipelinesOf(device);
    const plate = await plateSolverGPU(device, { mesh, te: te ?? new Float32Array(n).fill(F.continentTeKm), meshOf, F });
    const U32 = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, own = [];
    const mk = (label, bytes) => { const b = device.createBuffer({ label, size: Math.max(16, bytes), usage: U32 }); own.push(b); return b; };
    const anchor = mk('anchor', 4 * n), moved = mk('moved', 4 * n), oc = mk('ocean', 4 * n);
    const liftB = lift ?? mk('lift0', 4 * n), KvB = Kv ?? mk('Kv0', 16);
    const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    own.push(uniform);
    const setOcean = o => { device.queue.writeBuffer(oc, 0, Uint32Array.from(o)); plate.setOcean(o); };
    setOcean(ocean);
    // (the anchor: the ground as it stands now)
    { const e = device.createCommandEncoder(); e.copyBufferToBuffer(z, 0, anchor, 0, 4 * n); device.queue.submit([e.finish()]); }
    const g = (name, list) => device.createBindGroup({ layout: P_[name].getBindGroupLayout(0), entries: list.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const G = { load: g('load', [uniform, z, anchor, liftB, oc, plate.M, plate.b]), apply: g('apply', [uniform, plate.w, z, anchor, moved, KvB]) };
    const sum = await sumPartials(device, moved, n), ub = new ArrayBuffer(16), uv = new DataView(ub), last = { solves: 0, maxIterations: 0, residual: 0 };
    let since = 0;
    const step = (p, name, grp) => { p.setPipeline(P_[name]); p.setBindGroup(0, grp); dispatch(p, n); };
    const settle = async (at = 0) => {
        uv.setFloat32(0, P.rebound, true); uv.setFloat32(4, seaLoadShare(F), true); uv.setFloat32(8, at - since, true); uv.setUint32(12, Kv ? 1 : 0, true);
        device.queue.writeBuffer(uniform, 0, ub);
        since = at;
        let e = device.createCommandEncoder(), p = e.beginComputePass();
        step(p, 'load', G.load);
        p.end();
        device.queue.submit([e.finish()]);
        const r = await plate.solve();
        last.solves++; last.maxIterations = Math.max(last.maxIterations, r.iterations); last.residual = Math.max(last.residual, r.residual);
        e = device.createCommandEncoder(); p = e.beginComputePass();
        step(p, 'apply', G.apply);
        p.end();
        sum.encode(e);
        device.queue.submit([e.finish()]);
        return (await sum.read()) * a;
    };
    return { settle, setOcean, last, destroy: () => { sum.destroy(); plate.destroy(); for (const b of own) b.destroy(); } };
}

/** Read a Kv buffer's rock tops back into a column's zBed (after the run: the GPU moved them with the ground). */
export async function zBedBack(device, Kv, column) {
    const kv = await readBack(device, Kv), zb = column.zBed;
    for (let c = 0; c < zb.length; c++) zb[c] = kv[4 * c + 1];
}
