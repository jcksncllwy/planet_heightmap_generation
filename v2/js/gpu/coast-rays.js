// The coast's waves on the GPU (lane gpucells M2; gpuscan's ranked #5): finish-coast.js's tracer — the far field on the
// climate's grid (every sea grid cell × direction marched up-wave over the open sea to the first land, then the seas grown
// back along the path, each season) and the near field on the mesh (every coast cell × direction walked up-wave cell by
// cell to the first land or out to waveNearKm, then the far field there, grown back the same way) — one thread a ray.
// The same arithmetic as the CPU tracer it replaced (tools/coast-rays-test.mjs keeps it as the float64 reference), in f32:
//   · a ray's place after s steps in closed form, p_s = cos(sθ)·p₀ + sin(sθ)·d₀ (its heading −sin·p₀ + cos·d₀), from float64
//     tables of cos(sθ), sin(sθ): one rounding, where marching the rotation step by step in f32 would add one a step;
//   · the walk to the cell nearest the ray's place compares a neighbour's (x_nb − x_c)·p with 0, not two dot products near
//     1 (f32 resolves 1 to 6e-8; the neighbours' dots differ by ~(edge/R)² ~ 1e-6): the CPU's choice but where the place lies
//     within ~1 m of the boundary between two cells;
//   · each mesh cell's climate grid cell, the start of every far-field ray and the tables are worked out in float64 on the CPU.
// So a ray takes the CPU's path but within a hair of a cell's or a grid cell's edge or a direction's boundary (a few in 10⁵
// steps), and its waves agree to f32's rounding (~1e-5 relative: the far field's bilinear weights at the ray's end, the
// exponentials of its growth). Deterministic on one machine (one thread a ray, no atomics); keyed by gpuFingerprint across GPUs.

import { pipeline, storage, readBack, bind } from './gpu-device.js';
import { meshFields, dispatch, INDEX_WGSL, WG } from './fields.js';

const R = 6371, D2R = Math.PI / 180;
const lit = v => { const s = String(v); return /[.eE]/.test(s) ? s : s + '.0'; };      // (an f64's shortest form, as a WGSL float)
const table = (name, xs) => `const ${name} = array<f32, ${xs.length}>(${xs.map(lit).join(', ')});`;

/** The WGSL both kernels share: the grid, the directions, the seas' growth. */
function shared(T) {
    const { D, w, h } = T, G = w * h, step = 180 / h;
    const up = Array.from({ length: D }, (_, d) => d * 2 * Math.PI / D + Math.PI);
    return /* wgsl */`
const D = ${D}u; const GW = ${w}u; const GH = ${h}u; const G = ${G}u; const STEP = ${lit(step)};
${table('COS_UP', up.map(Math.cos))}
${table('SIN_UP', up.map(Math.sin))}
@group(0) @binding(0) var<storage, read> gen: array<f32>;             // (season·G + g)·D + d: the fifth power of the wind toward d, then its fifth root
@group(0) @binding(1) var<storage, read_write> env: array<f32>;       // the sea ice (4·G), the grid's land (G: 0/1), the far field (4·G·D)
fn landAt(g: u32) -> bool { return env[4u * G + g] > 0.5; }
// (finish-coast.js gridCell: the grid cell at a place, from its lat and lon in degrees)
fn gridAt(la: f32, lo: f32) -> u32 {
    let i = u32(clamp(floor((lo + 180.0) / STEP), 0.0, f32(GW - 1u))); let j = u32(clamp(floor((90.0 - la) / STEP), 0.0, f32(GH - 1u)));
    return j * GW + i;
}
fn latOf(p: vec3f) -> f32 { return degrees(atan2(p.z, length(p.xy))); }
fn lonOf(p: vec3f) -> f32 { return degrees(atan2(p.y, p.x)); }
// (east and north at a place on the unit sphere)
fn eastAt(p: vec3f) -> vec3f { let hh = select(length(p.xy), 1e-12, length(p.xy) == 0.0); return vec3f(-p.y / hh, p.x / hh, 0.0); }
fn northAt(p: vec3f) -> vec3f { let hh = select(length(p.xy), 1e-12, length(p.xy) == 0.0); return vec3f(-p.z * p.x / hh, -p.z * p.y / hh, hh); }
// (the direction of travel, of D, of a ray heading dv at p — against it: dirOf(−east·dv, −north·dv); Math.round is floor(x + ½))
fn dirOf(p: vec3f, dv: vec3f) -> u32 {
    let a = atan2(-dot(dv, eastAt(p)), -dot(dv, northAt(p))) / ${lit(2 * Math.PI / D)};
    let k = i32(floor(a + 0.5));
    return u32(((k % i32(D)) + i32(D)) % i32(D));
}
// (1 − e^−x, without f32's cancellation where x is small)
fn oneMinusExp(x: f32) -> f32 { return select(1.0 - exp(-x), x * (1.0 - x * (0.5 - x / 6.0)), x < 0.01); }
// (the waves P arriving over a step of km at grid cell g, travelling toward d, season s: faded, grown toward a fully developed sea)
fn grow(P0: f32, g: u32, s: u32, d: u32, km: f32, fade: f32) -> f32 {
    let open = 1.0 - env[s * G + g]; let o = 2u * ((s * G + g) * D + d); let U = gen[o + 1u];
    var P = P0 * fade * open;
    let sat = ${lit(T.waveSatK)} * gen[o] * open;
    if (P < sat && U > 0.5) { P += (sat - P) * oneMinusExp(km / (${lit(T.waveFetchK)} * U * U)); }
    return P;
}`;
}

function farKernel(T) {
    const n = T.farSteps, th = T.farStep / R, cs = [], sn = [];
    for (let s = 0; s <= n; s++) { cs.push(Math.cos(s * th)); sn.push(Math.sin(s * th)); }
    return /* wgsl */`${shared(T)}
@group(0) @binding(2) var<storage, read> start: array<f32>;           // each grid cell's centre on the unit sphere (3·G)
${INDEX_WGSL}
${table('CS', cs)}
${table('SN', sn)}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let t = flatIndex(id, nwg);
    if (t >= G * D) { return; }
    let g = t / D; let d = t % D;
    if (landAt(g)) { return; }
    let p0 = vec3f(start[3u * g], start[3u * g + 1u], start[3u * g + 2u]);
    let d0 = COS_UP[d] * northAt(p0) + SIN_UP[d] * eastAt(p0);
    var pathG: array<u32, ${n + 1}>; var pathD: array<u32, ${n + 1}>;
    pathG[0] = g; pathD[0] = d;
    var k = 0u;
    for (var s = 1u; s <= ${n}u; s++) {
        let p = CS[s] * p0 + SN[s] * d0; let dv = -SN[s] * p0 + CS[s] * d0;
        let gg = gridAt(latOf(p), lonOf(p));
        if (landAt(gg)) { break; }
        pathG[s] = gg; pathD[s] = dirOf(p, dv); k = s;
    }
    for (var s = 0u; s < 4u; s++) {
        var P = 0.0;
        for (var q = i32(k); q >= 0; q--) { P = grow(P, pathG[q], s, pathD[q], ${lit(T.farStep)}, ${lit(Math.exp(-T.farStep / T.swellDecayKm))}); }
        env[5u * G + (s * G + g) * D + d] = P;
    }
}`;
}

function nearKernel(T) {
    const n = T.nearSteps, th = T.nearStep / R, cs = [], sn = [];
    for (let s = 0; s <= n; s++) { cs.push(Math.cos(s * th)); sn.push(Math.sin(s * th)); }
    return /* wgsl */`${shared(T)}
@group(0) @binding(2) var<storage, read> adjOffset: array<u32>;
@group(0) @binding(3) var<storage, read> adjList: array<u32>;
@group(0) @binding(4) var<storage, read> xyz: array<f32>;
@group(0) @binding(5) var<storage, read> cellIn: array<u32>;          // each mesh cell's height (km, f32 bits), its climate grid cell
@group(0) @binding(6) var<storage, read> cells: array<u32>;           // the coast cells
@group(0) @binding(7) var<storage, read_write> outP: array<f32>;      // each coast cell's waves from each direction (kW/m)
${INDEX_WGSL}
${table('CS', cs)}
${table('SN', sn)}
fn pos(c: u32) -> vec3f { return vec3f(xyz[3u * c], xyz[3u * c + 1u], xyz[3u * c + 2u]); }
// (finish-coast.js walk: from cell c to the neighbour nearest p, while one is nearer — by (x_nb − x_c)·p > the best so far)
fn walk(c0: u32, p: vec3f) -> u32 {
    var c = c0;
    for (var it = 0u; it < 256u; it++) {
        let xc = pos(c); var best = 0.0; var next = c;
        for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) {
            let nb = adjList[k]; let r = dot(pos(nb) - xc, p);
            if (r > best) { best = r; next = nb; }
        }
        if (next == c) { break; }
        c = next;
    }
    return c;
}
// (the far field at a place, from the sea's grid cells around it only — finish-coast.js corners and farAt)
fn farAt(la: f32, lo: f32, s: u32, d: u32) -> f32 {
    let x = (lo + 180.0) / STEP - 0.5; let y = clamp((90.0 - la) / STEP - 0.5, 0.0, f32(GH - 1u));
    let x0 = floor(x); let y0 = floor(y); let fx = x - x0; let fy = y - y0;
    let xi = i32(x0); let yi = u32(y0); let W = i32(GW);
    let ia = u32(((xi % W) + W) % W); let ib = u32((((xi + 1) % W) + W) % W);
    let ja = min(GH - 1u, yi); let jb = min(GH - 1u, yi + 1u);
    let cg = array<u32, 4>(ja * GW + ia, ja * GW + ib, jb * GW + ia, jb * GW + ib);
    let cw = array<f32, 4>((1.0 - fx) * (1.0 - fy), fx * (1.0 - fy), (1.0 - fx) * fy, fx * fy);
    var sum = 0.0; var wsum = 0.0;
    for (var q = 0u; q < 4u; q++) {
        if (landAt(cg[q]) || !(cw[q] > 0.0)) { continue; }
        sum += cw[q] * env[5u * G + (s * G + cg[q]) * D + d]; wsum += cw[q];
    }
    return select(0.0, sum / wsum, wsum > 0.0);
}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let t = flatIndex(id, nwg);
    if (t >= arrayLength(&cells) * D) { return; }
    let i = t / D; let d = t % D; let c = cells[i];
    let p0 = pos(c);
    let d0 = COS_UP[d] * northAt(p0) + SIN_UP[d] * eastAt(p0);
    var nG: array<u32, ${n + 1}>; var nD: array<u32, ${n + 1}>;
    var cell = c; var k = 0u; var blocked = false; var p = p0;
    for (var s = 1u; s <= ${n}u; s++) {
        p = CS[s] * p0 + SN[s] * d0; let dv = -SN[s] * p0 + CS[s] * d0;
        cell = walk(cell, p);
        if (bitcast<f32>(cellIn[2u * cell]) >= 0.0) { blocked = true; break; }
        nG[s] = cellIn[2u * cell + 1u]; nD[s] = dirOf(p, dv); k = s;
    }
    if (blocked && k == 0u) { outP[t] = 0.0; return; }        // (a ray that met land at once — the land's side of the coast — brings nothing)
    let la = latOf(p); let lo = lonOf(p);
    var sum = 0.0;
    for (var s = 0u; s < 4u; s++) {
        var P = select(farAt(la, lo, s, d), 0.0, blocked);
        for (var q = i32(k); q >= 1; q--) { P = grow(P, nG[q], s, nD[q], ${lit(T.nearStep)}, ${lit(Math.exp(-T.nearStep / T.swellDecayKm))}); }
        sum += P;
    }
    outP[t] = sum / 4.0;
}`;
}

const pipes = new WeakMap();
function pipeOf(device, key, make) {
    if (!pipes.has(device)) pipes.set(device, new Map());
    const m = pipes.get(device);
    if (!m.has(key)) m.set(key, pipeline(device, make()));
    return m.get(key);
}

/** The climate grid's cell at (lat, lon), degrees — finish-coast.js gridCell, the same arithmetic. */
export function gridCell(grid, step, la, lo) {
    const i = Math.min(grid.w - 1, Math.max(0, Math.floor((lo + 180) / step))), j = Math.min(grid.h - 1, Math.max(0, Math.floor((90 - la) / step)));
    return j * grid.w + i;
}

/**
 * The coast's wave tracer on the GPU, from finish-coast.js's T = { D, w, h (the climate grid), gen5, genU (4 seasons × grid ×
 * D), si (4 × grid: the sea ice), landMask (grid), swellDecayKm, waveSatK, waveFetchK, farStep, farSteps, nearStep,
 * nearSteps }, the mesh and each cell's lat, lon (degrees). The far field is traced at once (`far()` reads it back: the test's);
 * `near(z, cells)` answers the waves at each of `cells` from each direction, the seasons' mean (kW/m; cells.length × D).
 * `destroy()` frees its buffers. One a coast: its grids stay on the GPU over its steps.
 */
export async function coastRaysGPU(device, T, mesh, lat, lon) {
    const { D, w, h } = T, G = w * h, n = mesh.numCells, step = 180 / h;
    const gen = new Float32Array(2 * 4 * G * D);
    for (let o = 0; o < 4 * G * D; o++) { gen[2 * o] = T.gen5[o]; gen[2 * o + 1] = T.genU[o]; }
    const env = new Float32Array(5 * G + 4 * G * D);
    env.set(T.si, 0);
    for (let g = 0; g < G; g++) env[4 * G + g] = T.landMask[g] ? 1 : 0;
    const start = new Float32Array(3 * G);
    for (let g = 0; g < G; g++) {
        const j = Math.floor(g / w), i = g - j * w, la = (90 - (j + 0.5) * step) * D2R, lo = (-180 + (i + 0.5) * step) * D2R;
        start[3 * g] = Math.cos(la) * Math.cos(lo); start[3 * g + 1] = Math.cos(la) * Math.sin(lo); start[3 * g + 2] = Math.sin(la);
    }
    // (each mesh cell's height slot, filled per call, and its grid cell, once)
    const cellIn = new Uint32Array(2 * n), cz = new Float32Array(cellIn.buffer);
    for (let c = 0; c < n; c++) cellIn[2 * c + 1] = gridCell(T, step, lat[c], lon[c]);
    const key = [D, w, h, T.farSteps, T.farStep, T.nearSteps, T.nearStep, T.swellDecayKm, T.waveSatK, T.waveFetchK].join(':');
    const [farPipe, nearPipe] = await Promise.all([pipeOf(device, 'far:' + key, () => farKernel(T)), pipeOf(device, 'near:' + key, () => nearKernel(T))]);
    const F = meshFields(device, mesh), bGen = storage(device, gen), bEnv = storage(device, env), bStart = storage(device, start);
    {
        const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
        pass.setPipeline(farPipe); pass.setBindGroup(0, bind(device, farPipe, [bGen, bEnv, bStart])); dispatch(pass, G * D); pass.end();
        device.queue.submit([enc.finish()]);
    }
    const bCell = storage(device, cellIn.byteLength);
    return {
        async far() { const all = await readBack(device, bEnv); return all.slice(5 * G); },
        async near(z, cells) {
            const out = new Float32Array(cells.length * D);
            if (!cells.length) return out;
            for (let c = 0; c < n; c++) cz[2 * c] = z[c];
            device.queue.writeBuffer(bCell, 0, cellIn);
            const bCells = storage(device, Uint32Array.from(cells)), bOut = storage(device, out.byteLength);
            const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
            pass.setPipeline(nearPipe); pass.setBindGroup(0, bind(device, nearPipe, [bGen, bEnv, F.adjOffset, F.adjList, F.xyz, bCell, bCells, bOut])); dispatch(pass, cells.length * D); pass.end();
            device.queue.submit([enc.finish()]);
            const got = await readBack(device, bOut);
            bCells.destroy(); bOut.destroy();
            return got;
        },
        destroy() { bGen.destroy(); bEnv.destroy(); bStart.destroy(); bCell.destroy(); },
    };
}

/**
 * Both ray kernels on a small fixed sea — `mesh` and `z` (app/history-key.js gpuFingerprint's patch: its ground, lowered a km
 * so part of it is sea), a 10° grid of integer winds — for gpuFingerprint: the rays' f32 trig and exponentials are the vendor's,
 * so a GPU that answers them differently files its finishes apart. @returns {Promise<Float32Array[]>} what they answered, to hash
 */
export async function coastRaysProbe(device, mesh, z) {
    const n = mesh.numCells, D = 16, w = 36, h = 18, G = w * h, gen5 = new Float32Array(4 * G * D), genU = new Float32Array(4 * G * D), si = new Float32Array(4 * G), landMask = new Uint8Array(G);
    for (let o = 0; o < 4 * G * D; o++) { gen5[o] = (o * 37) % 1000; genU[o] = ((o * 13) % 20) * 0.5; }
    for (let g = 0; g < 4 * G; g++) si[g] = ((g * 7) % 10) / 20;
    for (let g = 0; g < G; g++) landMask[g] = g % 5 === 0 ? 1 : 0;
    const lat = new Float32Array(n), lon = new Float32Array(n), sea = new Float32Array(n), cells = [];
    for (let c = 0; c < n; c++) { lat[c] = 30 + (c % 48) * 0.25; lon[c] = -10 + Math.floor(c / 48) * 0.25; sea[c] = z[c] - 1; if (c % 7 === 0) cells.push(c); }
    const T = { D, w, h, gen5, genU, si, landMask, swellDecayKm: 3000, waveSatK: 1e-4, waveFetchK: 2.25, farStep: 150, farSteps: 8, nearStep: 1.5 * mesh.edgeKm, nearSteps: 4 };
    const rays = await coastRaysGPU(device, T, mesh, lat, lon);
    try { return [await rays.far(), await rays.near(sea, cells)]; } finally { rays.destroy(); }
}
