// The shoreline's sand on the GPU (lane coastwave): the one-line model of a sandy coast (Pelnard-Considère 1956; Ashton,
// Murray & Arnoult 2001, Nature 414; Ashton & Murray 2006, JGR 111 F04011/F04012) in its cellular form on the mesh.
//   · The waves drive sand along the shore at Q = K · Σ_d P_d · cos^1.2(α_d) · sin(α_d) km³/yr (CERC in deep-water terms:
//     P_d the deep-water power arriving from direction d, kW/m — gpu/coast-rays.js's near field, with its headlands' and
//     islands' shelter; α_d the angle between the waves and the shore's normal). Where the shore turns, Q changes along it,
//     and the difference is laid or taken: dV/dt = −∂Q/∂s. For waves within ~42° of the normal that is a diffusion of the
//     shore's plan, μ = (K/D)·P·cos^0.2 α (cos²α − 1.2 sin²α), D the depth the shore must be filled or cut through
//     (Ashton & Murray 2006 eq. 4–5): headlands are cut back and bays filled; waves more slantwise make it unstable (capes,
//     spits). The flux's divergence is taken as it is, not linearised, so both regimes come out of it.
//   · The shore's orientation is the gradient of the land's share smoothed over a cell or two: the cellular model's local
//     shoreline angle (Ashton et al. 2001 take it over neighbouring cells), at the mesh's own scale.
//   · The flux lives on the shore band: the open sea's cells beside land, and the land beside them no higher than a beach's
//     crest. Between two band cells it is the face's share of their mean flux, q̄ · ê · ℓ/W (ℓ a face's width, W the band's,
//     two rows: ℓ/W = 1/3 on the near-hexagonal mesh), so what one cell gives its neighbour takes: sand is conserved.
//   · Only loose sand moves (each cell's `loose`, km³, part of its height): a cell gives no more than it has (a donor limiter:
//     its outgoing faces scaled by have/asked), so a rock coast with no sand is not moved by the drift — its cliffs are the
//     wave cut's (finish-coast.js), and the sand they shed, the rivers' and the shore's own prism are what the drift has.
//   · A sea cell is land once filled to the sea's level: a shore in deep water — a fjord, a ria's drowned valley, a steep
//     margin — must be filled through its whole depth before it moves, so it moves least.
// What it skips: the cross-shore profile (one line: the band's every depth moves together), barriers and lagoons smaller than
// a cell, overwash, wind-blown sand, and the waves' refraction beyond the near field's sheltering.
// Cost: the kernels run over the band and the few rings its orientation reads (lists made once a call), not the mesh. Heights
// are carried as each cell's change since the call began (h = z − z0) so float32 keeps the sand's books on km-high ground.
// Deterministic (gather only, no atomics); f32, so a GPU's rounding can differ (keyed by gpuFingerprint like the rays).

import { storage, readBack, gpuWait } from './gpu-device.js';
import { meshFields, dispatch, INDEX_WGSL, WG } from './fields.js';

const lit = v => { const s = String(v); return /[.eE]/.test(s) ? s : s + '.0'; };

function kernels(D) {
    const COS = [], SIN = [];
    for (let d = 0; d < D; d++) { const b = d * 2 * Math.PI / D; COS.push(Math.cos(b)); SIN.push(Math.sin(b)); }
    const head = /* wgsl */`
struct Par { dt: f32, K: f32, crest: f32, face: f32, cellKm2: f32, nS: u32, nB: u32, pad: u32 };
@group(0) @binding(0) var<uniform> par: Par;
@group(0) @binding(1) var<storage, read> adjOffset: array<u32>;
@group(0) @binding(2) var<storage, read> adjList: array<u32>;
@group(0) @binding(3) var<storage, read> xyz: array<f32>;
@group(0) @binding(4) var<storage, read> z0: array<f32>;               // the ground when the call began, km
@group(0) @binding(5) var<storage, read_write> hl: array<f32>;         // 2 a cell: its change since (km), its loose sand (km³)
@group(0) @binding(6) var<storage, read_write> info: array<u32>;       // 3 a cell: 1 if the open sea (or a coast cell beside it) at the
                                                                        //   call's start; its row in Pd + 1 (0: none); 1 if in the band now
@group(0) @binding(7) var<storage, read_write> sm: array<f32>;         // the land's share, smoothed (2 a cell: ping, pong)
@group(0) @binding(8) var<storage, read> Pd: array<f32>;              // the waves arriving at the cell from each direction, kW/m
@group(0) @binding(9) var<storage, read_write> qv: array<f32>;        // 4 a cell: the band's flux, km³/yr along the shore; the limiter
@group(0) @binding(10) var<storage, read> list: array<u32>;           // the rings the orientation reads (nS), then the band's reach (nB)
${INDEX_WGSL}
const D = ${D}u;
const COS_B = array<f32, ${D}>(${COS.map(lit).join(', ')});
const SIN_B = array<f32, ${D}>(${SIN.map(lit).join(', ')});
fn pos(c: u32) -> vec3f { return vec3f(xyz[3u * c], xyz[3u * c + 1u], xyz[3u * c + 2u]); }
fn zz(c: u32) -> f32 { return z0[c] + hl[2u * c]; }
fn isSea(c: u32) -> bool { return zz(c) < 0.0 && info[3u * c] == 1u; }
fn inBand(c: u32) -> bool { return info[3u * c + 2u] == 1u; }
fn flux(i: u32, j: u32) -> f32 {                                     // km³/yr from i to j through their face
    let e = pos(j) - pos(i); let p = pos(i); let et = normalize(e - dot(e, p) * p);
    let q = 0.5 * (vec3f(qv[4u * i], qv[4u * i + 1u], qv[4u * i + 2u]) + vec3f(qv[4u * j], qv[4u * j + 1u], qv[4u * j + 2u]));
    return dot(q, et) * par.face;
}
`;
    // (S: over the orientation's rings; B: over the band's reach)
    const k = (over, body) => /* wgsl */`${head}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let li = flatIndex(id, nwg);
    if (li >= ${over === 'S' ? 'par.nS' : 'par.nB'}) { return; }
    let c = list[${over === 'S' ? 'li' : 'par.nS + li'}];
${body}
}`;
    return {
        frac: k('S', `    sm[2u * c] = select(1.0, 0.0, isSea(c));`),
        smooth: k('S', `    var t = sm[2u * c]; var w = 1.0;
    for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) { t += sm[2u * adjList[k]]; w += 1.0; }
    sm[2u * c + 1u] = t / w;`),
        back: k('S', `    sm[2u * c] = sm[2u * c + 1u];`),
        // (the band, once a substep: the open sea beside land, and land no higher than the crest beside the open sea)
        mark: k('B', `    let sea = isSea(c); var b = 0u;
    if (sea || zz(c) <= par.crest) { for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) { if (isSea(adjList[k]) != sea) { b = 1u; break; } } }
    info[3u * c + 2u] = b;`),
        // (the band's flux: the shore's landward normal a from the smoothed share's gradient, its tangent t = p × a, and the
        // waves' drive along t; east and north at p as in finish-coast.js)
        qvec: k('B', `    qv[4u * c] = 0.0; qv[4u * c + 1u] = 0.0; qv[4u * c + 2u] = 0.0;
    let row = info[3u * c + 1u];
    if (!inBand(c) || row == 0u) { return; }
    let p = pos(c); var g = vec3f(0.0);
    for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) { let j = adjList[k]; let e = pos(j) - p; g += (sm[2u * j] - sm[2u * c]) * e / max(dot(e, e), 1e-20); }
    g -= dot(g, p) * p;
    let gl = length(g);
    if (!(gl > 1e-12)) { return; }
    let a = g / gl; let tg = cross(p, a);
    let h = max(length(p.xy), 1e-12); let ex = vec3f(-p.y / h, p.x / h, 0.0); let nx = vec3f(-p.z * p.x / h, -p.z * p.y / h, h);
    var q = 0.0; let r = (row - 1u) * D;
    for (var d = 0u; d < D; d++) {
        let P = Pd[r + d];
        if (!(P > 0.0)) { continue; }
        let u = COS_B[d] * nx + SIN_B[d] * ex;
        let ca = dot(u, a); let sa = dot(u, tg);
        if (ca > 0.0) { q += P * pow(ca, 1.2) * sa; }
    }
    let Q = par.K * q;
    qv[4u * c] = Q * tg.x; qv[4u * c + 1u] = Q * tg.y; qv[4u * c + 2u] = Q * tg.z;`),
        limit: k('B', `    qv[4u * c + 3u] = 1.0;
    if (!inBand(c)) { return; }
    var out = 0.0;
    for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) { let j = adjList[k]; if (inBand(j)) { out += max(0.0, flux(c, j)); } }
    out *= par.dt;
    if (out > 0.0) { qv[4u * c + 3u] = min(1.0, max(0.0, hl[2u * c + 1u]) / out); }`),
        // (each band cell gathers its faces: out at its own limiter, in at the giver's; the volume is part of its height)
        apply: k('B', `    if (!inBand(c)) { return; }
    var net = 0.0;
    for (var k = adjOffset[c]; k < adjOffset[c + 1u]; k++) {
        let j = adjList[k];
        if (!inBand(j)) { continue; }
        let f = flux(c, j);
        net -= select(f * qv[4u * j + 3u], f * qv[4u * c + 3u], f > 0.0);
    }
    let was = hl[2u * c + 1u];
    let nl = max(0.0, was + net * par.dt);
    hl[2u * c] += (nl - was) / par.cellKm2;
    hl[2u * c + 1u] = nl;`),
    };
}

const PIPES = new WeakMap();
// (one explicit layout for every kernel: 'auto' would drop the bindings a kernel doesn't read, and one bind group serves all)
const READ = new Set([1, 2, 3, 4, 8, 10]);
async function pipesOf(device, D) {
    if (!PIPES.has(device)) PIPES.set(device, new Map());
    const m = PIPES.get(device);
    if (!m.has(D)) {
        const entries = [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }];
        for (let b = 1; b <= 10; b++) entries.push({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: READ.has(b) ? 'read-only-storage' : 'storage' } });
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

/** Cells within `rings` hops of `seed` (seed first), as a Uint32Array. */
function ringsOf(mesh, seed, rings) {
    const { adjOffset, adjList, numCells: n } = mesh, seen = new Uint8Array(n), out = [];
    let front = [];
    for (const c of seed) if (!seen[c]) { seen[c] = 1; out.push(c); front.push(c); }
    for (let r = 0; r < rings; r++) {
        const next = [];
        for (const c of front) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const y = adjList[k]; if (!seen[y]) { seen[y] = 1; out.push(y); next.push(y); } }
        front = next;
    }
    return Uint32Array.from(out);
}

/**
 * The shore's sand moved over `substeps` steps of dt years. z (km) and loose (km³ a cell) are changed in place.
 * @param {Object} o { mesh, z, loose, open (Uint8Array: the open sea at the start, or a coast cell beside it), coast (the coast's
 *                     cells: land beside the open sea and the sea beside land), at (Int32Array: each cell's row in Pd, −1 none),
 *                     Pd (Float32Array rows × D), D, dt, substeps, K (km³/yr per kW/m), crestKm, cellKm2, smooth (passes) }
 * @returns {{bandCells: number, listCells: number}}
 */
export async function shoreDriftGPU(device, o) {
    const { mesh, z, loose, D } = o, n = mesh.numCells, { pipes: P, bgl } = await pipesOf(device, D), MF = meshFields(device, mesh);
    // (the band can move a cell a substep at most where a cell fills or empties; reach = the coast and 2 rings each way; the
    // orientation reads the smoothing's passes beyond it)
    const passes = o.smooth ?? 2, B = ringsOf(mesh, o.coast, 2), S = ringsOf(mesh, B, passes + 1), list = new Uint32Array(S.length + B.length);
    list.set(S); list.set(B, S.length);
    const par = new ArrayBuffer(32), pf = new Float32Array(par), pu = new Uint32Array(par);
    pf[0] = o.dt; pf[1] = o.K; pf[2] = o.crestKm; pf[3] = 1 / 3; pf[4] = o.cellKm2; pu[5] = S.length; pu[6] = B.length;
    const bPar = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(bPar, 0, par);
    const info = new Uint32Array(3 * n), hl = new Float32Array(2 * n), sm = new Float32Array(2 * n);
    for (let c = 0; c < n; c++) {
        info[3 * c] = o.open[c] ? 1 : 0; info[3 * c + 1] = o.at[c] + 1; hl[2 * c + 1] = loose[c];
        sm[2 * c] = z[c] < 0 && o.open[c] ? 0 : 1;                    // (beyond the rings: the share as it stands)
    }
    const bZ = storage(device, z), bHL = storage(device, hl), bInfo = storage(device, info), bS = storage(device, sm);
    const bPd = storage(device, o.Pd.length ? o.Pd : new Float32Array(1)), bQ = storage(device, 16 * n), bList = storage(device, list);
    const bufs = [bPar, MF.adjOffset, MF.adjList, MF.xyz, bZ, bHL, bInfo, bS, bPd, bQ, bList];
    const group = device.createBindGroup({ layout: bgl, entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const run = (pass, k, count) => { pass.setPipeline(P[k]); pass.setBindGroup(0, group); dispatch(pass, count); };
    for (let it = 0; it < o.substeps; it++) {
        const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
        run(pass, 'frac', S.length);
        for (let q = 0; q < passes; q++) { run(pass, 'smooth', S.length); run(pass, 'back', S.length); }
        run(pass, 'mark', B.length); run(pass, 'qvec', B.length); run(pass, 'limit', B.length); run(pass, 'apply', B.length);
        pass.end(); device.queue.submit([enc.finish()]);
    }
    const got = await readBack(device, bHL);
    for (const c of B) { z[c] += got[2 * c]; loose[c] = got[2 * c + 1]; }
    for (const b of [bPar, bZ, bHL, bInfo, bS, bPd, bQ, bList]) b.destroy();
    return { bandCells: B.length, listCells: S.length };
}
