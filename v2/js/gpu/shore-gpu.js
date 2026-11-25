// The shoreline's sand on the GPU (lane coastwave): the one-line model of a sandy coast (Pelnard-Considère 1956; Ashton,
// Murray & Arnoult 2001, Nature 414; Ashton & Murray 2006, JGR 111 F04011/F04012) in its cellular form on the mesh.
//   · The waves drive sand along the shore at Q = K · Σ_d P_d · cos^1.2(α_d) · sin(α_d) km³/yr (CERC in deep-water terms:
//     P_d the deep-water power arriving from direction d, kW/m, the coast-rays' near field with its headlands' and islands'
//     shelter; α_d the angle between the waves and the shore's normal). Where the shore turns, Q changes along it, and the
//     difference is laid or taken: dV/dt = −∂Q/∂s. For waves within 45° of the normal that is a diffusion of the shore's
//     plan, μ = (K/D_sf)·P·cos^0.2 α (cos²α − 1.2 sin²α) (Ashton & Murray 2006 eq. 4–5): headlands are cut back and bays
//     filled; waves more slantwise than ~42° make it unstable (capes, spits).
//   · The shore's orientation is the gradient of the land's share smoothed over a cell or two: the cellular model's local
//     shoreline angle (Ashton et al. 2001 take it over neighbouring cells), at the mesh's own scale.
//   · The flux lives on the shore band: the world ocean's cells beside land and the land beside it no higher than a beach's
//     crest. Between two band cells it is the face's share of their mean flux, q̄ · ê · ℓ/W (ℓ a face's width, W the band's,
//     two rows: ℓ/W = 1/3 on the near-hexagonal mesh), so what one cell gives its neighbour takes: sand is conserved to the
//     float's rounding.
//   · Only loose sand moves (each cell's `loose`, km³, part of its height): a cell gives no more than it has (a donor limiter:
//     every outgoing face scaled by have/asked), so a rock coast with no sand is not moved by the drift — its cliffs are the
//     wave cut's (finish-coast.js), and the sand they shed, the rivers' and the shore's own are what the drift has.
//   · A sea cell deeper than the closure depth keeps what it is given as fill (the shoreface's toe: the waves cannot take it
//     back up), so a coast in deep water — a fjord, a ria's drowned valley, a steep active margin — advances slowly: its
//     cells need the whole depth filled before the shore moves, and the sand is locked into its floor as it arrives.
// What it skips: the cross-shore profile (one line: every depth of the band moves together), barriers and lagoons below the
// mesh's cell, overwash, wind-blown sand, and the waves' refraction beyond the near field's sheltering.
// Deterministic (gather only, no atomics); f32, so a GPU's rounding can differ (keyed by gpuFingerprint like the rays).

import { storage, readBack, gpuWait } from './gpu-device.js';
import { meshFields, dispatch, INDEX_WGSL, WG } from './fields.js';

const lit = v => { const s = String(v); return /[.eE]/.test(s) ? s : s + '.0'; };

function kernels(D) {
    const COS = [], SIN = [];
    for (let d = 0; d < D; d++) { const b = d * 2 * Math.PI / D; COS.push(Math.cos(b)); SIN.push(Math.sin(b)); }
    const head = /* wgsl */`
struct Par { dt: f32, K: f32, crest: f32, closure: f32, face: f32, cellKm2: f32, n: u32, pad: u32 };
@group(0) @binding(0) var<uniform> par: Par;
@group(0) @binding(1) var<storage, read> adjOffset: array<u32>;
@group(0) @binding(2) var<storage, read> adjList: array<u32>;
@group(0) @binding(3) var<storage, read> xyz: array<f32>;
@group(0) @binding(4) var<storage, read_write> z: array<f32>;
@group(0) @binding(5) var<storage, read_write> loose: array<f32>;
@group(0) @binding(6) var<storage, read> info: array<i32>;            // 2 a cell: 1 if the world ocean at the step's start or a coast cell
                                                                        //   beside it; its row in Pd, or −1
@group(0) @binding(7) var<storage, read_write> sm: array<f32>;         // the land's share, smoothed (2 a cell: ping, pong)
@group(0) @binding(8) var<storage, read> Pd: array<f32>;              // the waves arriving at the cell from each direction, kW/m
@group(0) @binding(9) var<storage, read_write> qv: array<f32>;        // 4 a cell: the band's flux, km³/yr along the shore; the donor limiter
${INDEX_WGSL}
const D = ${D}u;
const COS_B = array<f32, ${D}>(${COS.map(lit).join(', ')});
const SIN_B = array<f32, ${D}>(${SIN.map(lit).join(', ')});
fn pos(c: u32) -> vec3f { return vec3f(xyz[3u * c], xyz[3u * c + 1u], xyz[3u * c + 2u]); }
fn isSea(c: u32) -> bool { return z[c] < 0.0 && info[2u * c] == 1; }
fn band(c: u32) -> bool {
    let sea = isSea(c);
    if (!sea && z[c] > par.crest) { return false; }
    for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) { if (isSea(adjList[k]) != sea) { return true; } }
    return false;
}
fn flux(i: u32, j: u32) -> f32 {                                     // km³/yr from i to j through their face
    let e = pos(j) - pos(i); let p = pos(i); let et = normalize(e - dot(e, p) * p);
    let q = 0.5 * (vec3f(qv[4u * i], qv[4u * i + 1u], qv[4u * i + 2u]) + vec3f(qv[4u * j], qv[4u * j + 1u], qv[4u * j + 2u]));
    return dot(q, et) * par.face;
}
`;
    const k = (name, body) => /* wgsl */`${head}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg);
    if (c >= par.n) { return; }
${body}
}`;
    return {
        frac: k('frac', `    sm[2u * c] = select(1.0, 0.0, isSea(c));`),
        smooth: k('smooth', `    var t = sm[2u * c]; var w = 1.0;
    for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) { t += sm[2u * adjList[k]]; w += 1.0; }
    sm[2u * c + 1u] = t / w;`),
        back: k('back', `    sm[2u * c] = sm[2u * c + 1u];`),
        // (the band's flux: the shore's landward normal a from the smoothed share's gradient, its tangent t = p × a, and the
        // waves' drive along t; east and north at p as in finish-coast.js)
        qvec: k('qvec', `    qv[4u * c] = 0.0; qv[4u * c + 1u] = 0.0; qv[4u * c + 2u] = 0.0;
    let row = info[2u * c + 1u];
    if (!band(c) || row < 0) { return; }
    let p = pos(c); var g = vec3f(0.0);
    for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) { let j = adjList[k]; let e = pos(j) - p; g += (sm[2u * j] - sm[2u * c]) * e / max(dot(e, e), 1e-20); }
    g -= dot(g, p) * p;
    let gl = length(g);
    if (!(gl > 1e-12)) { return; }
    let a = g / gl; let t = cross(p, a);
    let h = max(length(p.xy), 1e-12); let ex = vec3f(-p.y / h, p.x / h, 0.0); let nx = vec3f(-p.z * p.x / h, -p.z * p.y / h, h);
    var q = 0.0; let r = u32(row) * D;
    for (var d = 0u; d < D; d++) {
        let P = Pd[r + d];
        if (!(P > 0.0)) { continue; }
        let u = COS_B[d] * nx + SIN_B[d] * ex;
        let ca = dot(u, a); let sa = dot(u, t);
        if (ca > 0.0) { q += P * pow(ca, 1.2) * sa; }
    }
    let Q = par.K * q;
    qv[4u * c] = Q * t.x; qv[4u * c + 1u] = Q * t.y; qv[4u * c + 2u] = Q * t.z;`),
        limit: k('limit', `    qv[4u * c + 3u] = 1.0;
    if (!band(c)) { return; }
    var out = 0.0;
    for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) { let j = adjList[k]; if (band(j)) { out += max(0.0, flux(c, j)); } }
    out *= par.dt;
    if (out > 0.0) { qv[4u * c + 3u] = min(1.0, max(0.0, loose[c]) / out); }`),
        // (each band cell gathers its faces: out at its own limiter, in at the giver's; the volume is part of its height)
        apply: k('apply', `    if (!band(c)) { return; }
    var net = 0.0;
    for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) {
        let j = adjList[k];
        if (!band(j)) { continue; }
        let f = flux(c, j);
        net -= select(f * qv[4u * j + 3u], f * qv[4u * c + 3u], f > 0.0);
    }
    let v = net * par.dt;
    let nl = max(0.0, loose[c] + v);
    z[c] += (nl - loose[c]) / par.cellKm2;
    loose[c] = select(nl, 0.0, z[c] < -par.closure && isSea(c));`),
    };
}

const PIPES = new WeakMap();
// (one explicit layout for every kernel: 'auto' would drop the bindings a kernel doesn't read, and one bind group serves all)
const READ = new Set([1, 2, 3, 6, 8]);
async function pipesOf(device, D) {
    if (!PIPES.has(device)) PIPES.set(device, new Map());
    const m = PIPES.get(device);
    if (!m.has(D)) {
        const entries = [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }];
        for (let b = 1; b <= 9; b++) entries.push({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: READ.has(b) ? 'read-only-storage' : 'storage' } });
        const bgl = device.createBindGroupLayout({ entries }), layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
        const K = kernels(D), pipes = {};
        for (const [k, code] of Object.entries(K)) {
            const module = device.createShaderModule({ code });
            const info = await gpuWait(device, module.getCompilationInfo(), `compiling shore ${k}`);
            const bad = info.messages.filter(x => x.type === 'error');
            if (bad.length) throw new Error(bad.map(x => `shore ${k}:${x.lineNum}:${x.linePos} ${x.message}`).join('\n'));
            pipes[k] = await gpuWait(device, device.createComputePipelineAsync({ layout, compute: { module, entryPoint: 'main' } }), `building shore ${k}`);
        }
        m.set(D, { pipes, bgl });
    }
    return m.get(D);
}

/**
 * The shore's sand moved over `substeps` steps of dt years. z (km) and loose (km³ a cell) are changed in place.
 * @param {Object} o { mesh, z, loose, open (Uint8Array), at (Int32Array: each cell's row in Pd, −1 none), Pd (Float32Array rows × D), D,
 *                     dt, substeps, K (km³/yr per kW/m), crestKm, closureKm, cellKm2, smooth (passes) }
 */
export async function shoreDriftGPU(device, o) {
    const { mesh, z, loose, D } = o, n = mesh.numCells, { pipes: P, bgl } = await pipesOf(device, D), MF = meshFields(device, mesh);
    const par = new ArrayBuffer(32), pf = new Float32Array(par), pu = new Uint32Array(par);
    pf[0] = o.dt; pf[1] = o.K; pf[2] = o.crestKm; pf[3] = o.closureKm; pf[4] = 1 / 3; pf[5] = o.cellKm2; pu[6] = n;
    const bPar = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(bPar, 0, par);
    const info = new Int32Array(2 * n);
    for (let c = 0; c < n; c++) { info[2 * c] = o.open[c] ? 1 : 0; info[2 * c + 1] = o.at[c]; }
    const bZ = storage(device, z), bL = storage(device, loose), bInfo = storage(device, info), bS = storage(device, 8 * n);
    const bPd = storage(device, o.Pd.length ? o.Pd : new Float32Array(1)), bQ = storage(device, 16 * n);
    const bufs = [bPar, MF.adjOffset, MF.adjList, MF.xyz, bZ, bL, bInfo, bS, bPd, bQ];
    const group = device.createBindGroup({ layout: bgl, entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const run = (pass, k) => { pass.setPipeline(P[k]); pass.setBindGroup(0, group); dispatch(pass, n); };
    for (let it = 0; it < o.substeps; it++) {
        const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
        run(pass, 'frac');
        for (let q = 0; q < (o.smooth ?? 2); q++) { run(pass, 'smooth'); run(pass, 'back'); }
        run(pass, 'qvec'); run(pass, 'limit'); run(pass, 'apply');
        pass.end(); device.queue.submit([enc.finish()]);
    }
    z.set(await readBack(device, bZ)); loose.set(await readBack(device, bL));
    for (const b of [bPar, bZ, bL, bInfo, bS, bPd, bQ]) b.destroy();
}
