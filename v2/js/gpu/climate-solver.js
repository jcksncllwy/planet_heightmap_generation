// The climate's Helmholtz solver on the GPU (lane gpuclimate; gpuscan #3): climate/solver.js's multigrid, its V-cycles
// in WGSL, for the finish's climate (climate/climate.js planetClimateAsync with `solver: await climateSolverKit(device)`).
//
// The operator — the rows' coefficients, their factorisation, the coarse levels' — is still built on the CPU in float64
// (HelmholtzSolver.setOperator: a few ms a call) and uploaded as float32; the cycles run here. What differs from the CPU's
// solver, and why:
//   · the smoother: zebra line Gauss–Seidel (solver.js relax, `zebra`): the rows of one colour are independent, so each
//     is a workgroup. A row's periodic tridiagonal system is solved by parallel cyclic reduction (Hockney 1965; the
//     non-periodic system, log₂ w steps in workgroup memory) and Sherman–Morrison for the corners, as the CPU's
//     factorisation does. The lexicographic sweep, row after row, would be 180 dispatches a sweep;
//   · the deep hierarchy (solver.js `deep`: 180 → 90 → 45 → 15 → 5 rows), its coarsest level (10 × 5) solved exactly by
//     its inverse (solver.js coarsestInverse, float64 on the CPU), as the zebra solver does on the CPU;
//   · every solve to convergence (solver.js CONVERGED_TOL): converged, the smoother and the hierarchy don't show in the
//     climate (solver.js has the measurements);
//   · float32, made safe two ways: the finest level works in correction form (each cycle solves A·E = f − A·X for the
//     correction E and adds it to X — iterative refinement: X keeps float32's precision of itself, the corrections
//     theirs), and the residual is taken in difference form, d₀·E + Σ k·(E − E_nb) with d₀ = the row sum worked out in
//     float64 — so near the poles, where the east–west coupling is ~10⁷ × the damping, the residual doesn't cancel
//     ~10⁹-sized products down to a few hundred;
//   · the convergence test on the GPU: each cycle's residual is reduced in a fixed order (per row, then over the rows: no
//     float atomics, so each run repeats itself to the bit), and a flag the later kernels read stops the cycles at the
//     CPU's rule (the residual under tol × |f| — beyond float32's own floor, RESID0 — or maxCycles). Cycles are sent in
//     batches; past the flag they return at once.
// What it skips: `apply` stays the CPU's (the ocean's one call a setup); the operator's build stays on the CPU.

import { HelmholtzSolver, DIRECT_MAXN, convergedSettings } from '../climate/solver.js';
import { storage, pipeline, bind, gpuWait } from './gpu-device.js';

const MAXW = 384;               // the widest row a workgroup's reduction holds (a 1° grid: 360)
const ROW_THREADS = 256;        // threads a row (each holds ≤ 2 of its cells; 128 and 64 were slower)
const MAX_BATCH = 8;            // cycles a submit at most

// ── WGSL ─────────────────────────────────────────────────────────────────────

const COMMON = /* wgsl */`
struct Dims { w: u32, h: u32, wc: u32, hc: u32, r: u32, parity: u32, n: u32, pad: u32 }
struct Flags { done: u32, cycles: u32, rel2: f32, over2: f32 }
struct Params { thr2: f32, maxCycles: u32, pad0: u32, pad1: u32 }
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn cdiv(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }
`;
// (each cell's coefficients, three arrays — what a kernel reads is what it pays for: K4 = (sub, sup, an, as), the row's
// couplings west, east and the rows' north, south; DX = (d₀, the excess, below), complex; Z = Sherman–Morrison's z)
// (A·E at cell c, in difference form: d₀·E + (−sub)(E − E_w) + (−sup)(E − E_e) + an(E − E_n) + as(E − E_s); `E` names the array)
const applyA = (E) => /* wgsl */`
fn applyA(c: u32, i: u32, j: u32) -> vec2f {
    let w = D.w; let o = j * w; let k = K4[c]; let e = ${E}[c];
    let ew = ${E}[o + select(i - 1u, w - 1u, i == 0u)]; let ee = ${E}[o + select(i + 1u, 0u, i == w - 1u)];
    var a = cmul(DX[c].xy, e) - k.x * (e - ew) - k.y * (e - ee);
    if (j > 0u) { a += k.z * (e - ${E}[c - w]); }
    if (j + 1u < D.h) { a += k.w * (e - ${E}[c + w]); }
    return a;
}`;
const SKIP = /* wgsl */`
var<workgroup> skipW: u32;
fn skipped(t: u32) -> bool { if (t == 0u) { skipW = flags.done; } return workgroupUniformLoad(&skipW) != 0u; }`;

// The finest level's residual F₀ = f − A·X (the next correction's right-hand side; E₀ cleared for it), and each row's share
// of its norm, Σ cos φ·|r|², and of the part of it float32 can act on. X is held to half a unit in its last place,
// ~2⁻²⁴·|X|, so even the nearest float32 X leaves a residual of ~2⁻²⁴·|X|·Σk a cell — near the poles, where Σk ~ 10⁷, tens of
// W/m² against a forcing of a few hundred: ~10⁻³ of |f| over the whole grid, which no float32 X goes under. So the test
// counts each cell's residual beyond twice that, Σ cos φ·max(0, |r|² − 4·noise²): the CPU's own test wherever the noise
// is negligible (nearly everywhere), and no demand on a cell already at float32's floor
const RESID0 = COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> D: Dims;
@group(0) @binding(1) var<storage, read> K4: array<vec4f>;
@group(0) @binding(2) var<storage, read> DX: array<vec4f>;
@group(0) @binding(3) var<storage, read> X: array<vec2f>;
@group(0) @binding(4) var<storage, read> Fin: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> F: array<vec2f>;
@group(0) @binding(6) var<storage, read_write> E: array<vec2f>;
@group(0) @binding(7) var<storage, read> rowW: array<f32>;
@group(0) @binding(8) var<storage, read_write> rowSum: array<vec2f>;
@group(0) @binding(9) var<storage, read_write> flags: Flags;
${applyA('X')}
${SKIP}
const HALF_ULP = ${2 ** -24};
var<workgroup> part: array<vec2f, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) t: u32) {
    if (skipped(t)) { return; }
    let j = wg.x;
    var s = vec2f(0.0);
    for (var i = t; i < D.w; i += 256u) {
        let c = j * D.w + i; let k = K4[c];
        let r = Fin[c] - applyA(c, i, j);
        F[c] = r; E[c] = vec2f(0.0);
        let noise = HALF_ULP * length(X[c]) * (abs(k.x) + abs(k.y) + k.z + k.w);
        let r2 = dot(r, r);
        s += vec2f(r2, max(0.0, r2 - 4.0 * noise * noise));
    }
    part[t] = s;
    workgroupBarrier();
    for (var k = 128u; k > 0u; k >>= 1u) { if (t < k) { part[t] += part[t + k]; } workgroupBarrier(); }
    if (t == 0u) { rowSum[j] = rowW[j] * part[0]; }
}`;

// The rows' shares summed in a fixed order; the flag set when the residual beyond float32's floor is under tol·|f|, or the
// cycles are spent
const NORM = COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> D: Dims;
@group(0) @binding(1) var<uniform> P: Params;
@group(0) @binding(2) var<storage, read> rowSum: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> flags: Flags;
${SKIP}
var<workgroup> part: array<vec2f, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) t: u32) {
    if (skipped(t)) { return; }
    var s = vec2f(0.0);
    for (var j = t; j < D.h; j += 256u) { s += rowSum[j]; }
    part[t] = s;
    workgroupBarrier();
    for (var k = 128u; k > 0u; k >>= 1u) { if (t < k) { part[t] += part[t + k]; } workgroupBarrier(); }
    if (t == 0u) {
        flags.rel2 = part[0].x; flags.over2 = part[0].y;
        if (part[0].y < P.thr2 || flags.cycles >= P.maxCycles) { flags.done = 1u; }
    }
}`;

// One colour's rows (D.parity), each solved exactly with its neighbours' current E: parallel cyclic reduction of the row's
// tridiagonal system (its corners left out), then Sherman–Morrison for them (z and the row's constants from the CPU).
// The reduction carries each equation's excess s = b + a + c, not its diagonal b: near the poles b ≈ 2·kx ~ 10⁷ while the
// excess — the damping and the north–south coupling, what the row solves for — is ~10³, and float32 keeps b to ±1, so
// the row's own slow mode came out 10⁻³ wrong and the cycles stalled at a residual of ~10⁻³. Eliminating a neighbour
// keeps the excess free of cancellation, s' = s − k₁·s₋ − k₂·s₊ (k = a/b₋, c/b₊: the M-matrix's signs make every term
// add), and b = s − a − c is a sum of like-signed parts (Grassmann, Taksar & Heyman 1985's device for the same problem)
const SMOOTH = COMMON + /* wgsl */`
const WG = ${ROW_THREADS}u;
const MAXW = ${MAXW}u;
const PER = ${Math.ceil(MAXW / ROW_THREADS)};
@group(0) @binding(0) var<uniform> D: Dims;
@group(0) @binding(1) var<storage, read> K4: array<vec4f>;
@group(0) @binding(2) var<storage, read> DX: array<vec4f>;
@group(0) @binding(3) var<storage, read> Z: array<vec2f>;
@group(0) @binding(4) var<storage, read> rowK: array<vec4f>;
@group(0) @binding(5) var<storage, read> F: array<vec2f>;
@group(0) @binding(6) var<storage, read_write> E: array<vec2f>;
@group(0) @binding(7) var<storage, read_write> flags: Flags;
${SKIP}
var<workgroup> A: array<vec2f, MAXW>;
var<workgroup> S: array<vec2f, MAXW>;
var<workgroup> C: array<vec2f, MAXW>;
var<workgroup> R: array<vec2f, MAXW>;
@compute @workgroup_size(WG)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) t: u32) {
    if (skipped(t)) { return; }
    let j = 2u * wg.x + D.parity;
    let w = D.w; let o = j * w;
    for (var i = t; i < w; i += WG) {
        let c = o + i; let k = K4[c];
        var rhs = F[c];
        if (j > 0u) { rhs += k.z * E[c - w]; }
        if (j + 1u < D.h) { rhs += k.w * E[c + w]; }
        A[i] = vec2f(select(0.0, k.x, i > 0u), 0.0);
        C[i] = vec2f(select(0.0, k.y, i + 1u < w), 0.0);
        S[i] = DX[c].zw; R[i] = rhs;
    }
    workgroupBarrier();
    var na: array<vec2f, PER>; var ns: array<vec2f, PER>; var nc: array<vec2f, PER>; var nr: array<vec2f, PER>;
    for (var s = 1u; s < w; s <<= 1u) {
        var q = 0u;
        for (var i = t; i < w; i += WG) {
            var x = S[i]; var d = R[i];
            var a2 = vec2f(0.0); var c2 = vec2f(0.0);
            if (i >= s) { let m = i - s; let k1 = cdiv(A[i], S[m] - A[m] - C[m]); x -= cmul(k1, S[m]); d -= cmul(k1, R[m]); a2 = -cmul(k1, A[m]); }
            if (i + s < w) { let p = i + s; let k2 = cdiv(C[i], S[p] - A[p] - C[p]); x -= cmul(k2, S[p]); d -= cmul(k2, R[p]); c2 = -cmul(k2, C[p]); }
            na[q] = a2; ns[q] = x; nc[q] = c2; nr[q] = d; q++;
        }
        workgroupBarrier();
        q = 0u;
        for (var i = t; i < w; i += WG) { A[i] = na[q]; S[i] = ns[q]; C[i] = nc[q]; R[i] = nr[q]; q++; }
        workgroupBarrier();
    }
    for (var i = t; i < w; i += WG) { R[i] = cdiv(R[i], S[i]); }      // (every coupling eliminated: b = s)
    workgroupBarrier();
    let rk = rowK[j];
    let fact = cmul(R[0] + cmul(rk.xy, R[w - 1u]), rk.zw);
    for (var i = t; i < w; i += WG) { E[o + i] = R[i] - cmul(fact, Z[o + i]); }
}`;

// A level's residual R = F − A·E
const RESID = COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> D: Dims;
@group(0) @binding(1) var<storage, read> K4: array<vec4f>;
@group(0) @binding(2) var<storage, read> DX: array<vec4f>;
@group(0) @binding(3) var<storage, read> E: array<vec2f>;
@group(0) @binding(4) var<storage, read> F: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> Rr: array<vec2f>;
@group(0) @binding(6) var<storage, read_write> flags: Flags;
${applyA('E')}
${SKIP}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) t: u32) {
    if (skipped(t)) { return; }
    let c = gid.x;
    if (c >= D.n) { return; }
    let j = c / D.w; let i = c - j * D.w;
    Rr[c] = F[c] - applyA(c, i, j);
}`;

// The residual onto the next coarser level (area-weighted r × r means: solver.js restrict), its correction cleared
const RESTRICT = COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> D: Dims;
@group(0) @binding(1) var<storage, read> Rf: array<vec2f>;
@group(0) @binding(2) var<storage, read> rowW: array<f32>;
@group(0) @binding(3) var<storage, read_write> Fc: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> Ec: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> flags: Flags;
${SKIP}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) t: u32) {
    if (skipped(t)) { return; }
    let C = gid.x;
    if (C >= D.wc * D.hc) { return; }
    let J = C / D.wc; let I = C - J * D.wc; let r = D.r;
    var acc = vec2f(0.0); var aw = 0.0;
    for (var q = 0u; q < r; q++) {
        let jf = r * J + q; let o = jf * D.w + r * I;
        var row = vec2f(0.0);
        for (var p = 0u; p < r; p++) { row += Rf[o + p]; }
        acc += rowW[jf] * row; aw += rowW[jf];
    }
    Fc[C] = acc / (f32(r) * aw);
    Ec[C] = vec2f(0.0);
}`;

// The coarser level's correction, interpolated bilinearly onto this level's cells (solver.js prolongAdd), added
const PROLONG = COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> D: Dims;
@group(0) @binding(1) var<storage, read> Ec: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> Ef: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> flags: Flags;
${SKIP}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) t: u32) {
    if (skipped(t)) { return; }
    let f = gid.x;
    if (f >= D.n) { return; }
    let j = f / D.w; let i = f - j * D.w; let rr = f32(D.r); let wc = i32(D.wc); let hc = i32(D.hc);
    let X = (f32(i) + 0.5) / rr - 0.5; let I0f = floor(X); let fx = X - I0f;
    let I0 = ((i32(I0f) % wc) + wc) % wc; let I1 = select(I0 + 1, 0, I0 + 1 == wc);
    let Y = (f32(j) + 0.5) / rr - 0.5; var J0 = i32(floor(Y)); var fy = Y - floor(Y);
    if (J0 < 0) { J0 = 0; fy = 0.0; }
    if (J0 >= hc - 1) { J0 = hc - 1; fy = 0.0; }
    let J1 = min(hc - 1, J0 + 1);
    let w00 = (1.0 - fx) * (1.0 - fy); let w10 = fx * (1.0 - fy); let w01 = (1.0 - fx) * fy; let w11 = fx * fy;
    Ef[f] += w00 * Ec[J0 * wc + I0] + w10 * Ec[J0 * wc + I1] + w01 * Ec[J1 * wc + I0] + w11 * Ec[J1 * wc + I1];
}`;

// The coarsest level solved exactly: E = A⁻¹·F, the inverse worked out on the CPU in float64 (solver.js coarsestInverse)
const COARSEST = COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> D: Dims;
@group(0) @binding(1) var<storage, read> inv: array<vec2f>;
@group(0) @binding(2) var<storage, read> F: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> E: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> flags: Flags;
${SKIP}
@compute @workgroup_size(${DIRECT_MAXN})
fn main(@builtin(local_invocation_index) t: u32) {
    if (skipped(t)) { return; }
    let n = D.n;
    if (t >= n) { return; }
    var s = vec2f(0.0);
    for (var c = 0u; c < n; c++) { s += cmul(inv[t * n + c], F[c]); }
    E[t] = s;
}`;

// X += E₀, and the cycle counted
const UPDATE = COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> D: Dims;
@group(0) @binding(1) var<storage, read> E: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> X: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> flags: Flags;
${SKIP}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) t: u32) {
    if (skipped(t)) { return; }
    let c = gid.x;
    if (c == 0u) { flags.cycles += 1u; }
    if (c < D.n) { X[c] += E[c]; }
}`;

// ── Host ─────────────────────────────────────────────────────────────────────

const kits = new WeakMap();
/**
 * The solver factory for climate/core.js's `solver` option, on `device`: (grid, D, Dx, opts) → a HelmholtzSolverGPU. Its
 * pipelines are compiled once a device. kit.release() frees the buffers of every solver it has made since the last release.
 */
export async function climateSolverKit(device) {
    if (!kits.has(device)) {
        kits.set(device, (async () => {
            const [resid0, norm, smooth, resid, restrict, prolong, coarsest, update] = await Promise.all(
                [RESID0, NORM, SMOOTH, RESID, RESTRICT, PROLONG, COARSEST, UPDATE].map(code => pipeline(device, code)));
            return { resid0, norm, smooth, resid, restrict, prolong, coarsest, update };
        })());
    }
    const pipes = await kits.get(device), made = [];
    const kit = (grid, D, Dx = D, opts = {}) => { const s = new HelmholtzSolverGPU(device, pipes, grid, D, Dx, opts); made.push(s); return s; };
    kit.release = () => { for (const s of made.splice(0)) s.destroy(); };
    return kit;
}

export class HelmholtzSolverGPU extends HelmholtzSolver {
    constructor(device, pipes, grid, D, Dx = D, opts = {}) {
        super(grid, D, Dx, { ...opts, deep: true, zebra: true, converged: true });
        this.device = device; this.pipes = pipes;
        const levels = this.levels, nL = levels.length, last = levels[nL - 1];
        if (levels.some(L => L.w > MAXW)) throw new Error(`climate-solver: rows wider than ${MAXW} cells (${levels[0].w})`);
        if (last.n > DIRECT_MAXN) throw new Error(`climate-solver: the coarsest level (${last.w}×${last.h}) is too large to solve directly`);
        const U = GPUBufferUsage, bufs = this.buffers = [];
        const buf = (size) => { const b = storage(device, Math.max(16, size)); bufs.push(b); return b; };
        const uni = (words) => { const b = device.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST }); device.queue.writeBuffer(b, 0, Uint32Array.from(words)); bufs.push(b); return b; };
        this.flags = buf(16);
        this.staging = device.createBuffer({ size: 16 + 8 * levels[0].n, usage: U.MAP_READ | U.COPY_DST }); bufs.push(this.staging);
        this.lastCycles = 4;
        this.params = device.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST }); bufs.push(this.params);
        this.g = levels.map((L, l) => {
            const C = levels[l + 1], dims = p => uni([L.w, L.h, C?.w ?? 0, C?.h ?? 0, C?.r ?? 1, p, L.n, 0]);
            return {
                K4: buf(L.n * 16), DX: buf(L.n * 16), Z: buf(L.n * 8), rowK: buf(L.h * 16), inv: l === nL - 1 ? buf(L.n * L.n * 8) : null, rowW: storage(device, Float32Array.from(L.rowWeight)),
                E: buf(L.n * 8), F: buf(L.n * 8), R: buf(L.n * 8), dims: [dims(0), dims(1)],
            };
        });
        for (const G of this.g) bufs.push(G.rowW);
        const G0 = this.g[0];
        G0.X = buf(levels[0].n * 8); G0.Fin = buf(levels[0].n * 8); G0.rowSum = buf(levels[0].h * 8);
        // (the bind groups, made once: a solve only writes its data and sends the cycles)
        const P = pipes, b = (pipe, list) => bind(device, pipe, list);
        this.bg = {
            resid0: b(P.resid0, [G0.dims[0], G0.K4, G0.DX, G0.X, G0.Fin, G0.F, G0.E, G0.rowW, G0.rowSum, this.flags]),
            norm: b(P.norm, [G0.dims[0], this.params, G0.rowSum, this.flags]),
            update: b(P.update, [G0.dims[0], G0.E, G0.X, this.flags]),
            levels: this.g.map((G, l) => {
                const C = this.g[l + 1];
                if (l === nL - 1) return { coarsest: b(P.coarsest, [G.dims[0], G.inv, G.F, G.E, this.flags]) };
                return {
                    smooth: [0, 1].map(p => b(P.smooth, [G.dims[p], G.K4, G.DX, G.Z, G.rowK, G.F, G.E, this.flags])),
                    resid: b(P.resid, [G.dims[0], G.K4, G.DX, G.E, G.F, G.R, this.flags]),
                    restrict: b(P.restrict, [G.dims[0], G.R, G.rowW, C.F, C.E, this.flags]),
                    prolong: b(P.prolong, [G.dims[0], C.E, G.E, this.flags]),
                };
            }),
        };
    }

    /** The CPU's operator (float64), uploaded: each cell's coefficients, each row's constants, the coarsest level's inverse. */
    setOperator(...args) {
        super.setOperator(...args);
        this.levels.forEach((L, l) => {
            const { w, h, n } = L;
            if (w < 2) throw new Error('climate-solver: a one-cell row');
            const k4 = new Float32Array(4 * n), dx = new Float32Array(4 * n), zz = new Float32Array(2 * n), rk = new Float32Array(h * 4);
            const { sub, sup, bdr, bdi, zr, zi } = L, An = L.an, As = L.as;
            for (let j = 0; j < h; j++) {
                const o = j * w, kn = L.foldNS || j === 0 ? 0 : L.knRow[j], ks = L.foldNS || j === h - 1 ? 0 : L.ksRow[j];
                for (let i = 0; i < w; i++) {
                    const c = o + i, q = 4 * c;
                    const an = j > 0 ? An[c] + kn : 0, as = j < h - 1 ? As[c] + ks : 0, rs = bdr[c] + sub[c] + sup[c];
                    // (d₀, the row sum, and the equation's excess over its row's own couplings, b + a + c, in float64)
                    k4[q] = sub[c]; k4[q + 1] = sup[c]; k4[q + 2] = an; k4[q + 3] = as;
                    dx[q] = rs - an - as; dx[q + 1] = bdi[c]; dx[q + 2] = rs; dx[q + 3] = bdi[c];
                    zz[2 * c] = zr[c]; zz[2 * c + 1] = zi[c];
                }
                // (a row's ends: the corners' corrections to the diagonal — solver.js factorRows: b₀ − γ with γ = −b₀, and
                // b_{w−1} − α·β/γ — plus the one coupling left in the row)
                const e = o + w - 1, gr = -bdr[o], gi = -bdi[o], beta = sub[o], alpha = sup[e], gm = gr * gr + gi * gi;
                dx[4 * o + 2] = bdr[o] - gr + sup[o]; dx[4 * o + 3] = bdi[o] - gi;
                dx[4 * e + 2] = bdr[e] - alpha * beta * gr / gm + sub[e]; dx[4 * e + 3] = bdi[e] + alpha * beta * gi / gm;
                rk.set(L.rowK.subarray(4 * j, 4 * j + 4), 4 * j);
            }
            const G = this.g[l], q = this.device.queue;
            q.writeBuffer(G.K4, 0, k4); q.writeBuffer(G.DX, 0, dx); q.writeBuffer(G.Z, 0, zz);
            if (G.inv) q.writeBuffer(G.inv, 0, Float32Array.from(L.inv));
            this.device.queue.writeBuffer(this.g[l].rowK, 0, rk);
        });
    }

    /** Solve in place (Tr/Ti: the first guess, then the solution), to convergence. Resolves to { cycles, rel }. */
    async solve(fr, fi, Tr, Ti, { maxCycles = 12, tol = 1e-5 } = {}) {
        ({ tol, maxCycles } = convergedSettings(tol, maxCycles));
        const { device } = this, L0 = this.levels[0], n = L0.n, G0 = this.g[0];
        let fnorm = 0;
        for (let c = 0; c < n; c++) fnorm += fr[c] * fr[c] + fi[c] * fi[c];
        fnorm = Math.sqrt(fnorm) || 1;
        const f = new Float32Array(2 * n), x = new Float32Array(2 * n);
        for (let c = 0; c < n; c++) { f[2 * c] = fr[c]; f[2 * c + 1] = fi[c]; x[2 * c] = Tr[c]; x[2 * c + 1] = Ti[c]; }
        device.queue.writeBuffer(G0.Fin, 0, f);
        device.queue.writeBuffer(G0.X, 0, x);
        device.queue.writeBuffer(this.flags, 0, new Uint32Array(4));
        const pv = new DataView(new ArrayBuffer(16));
        pv.setFloat32(0, (tol * fnorm) ** 2, true); pv.setUint32(4, maxCycles, true);
        device.queue.writeBuffer(this.params, 0, pv.buffer);
        // (the cycles sent in batches, the first as many as this solver's last solve took and one more — usually all it
        // needs — each batch ending with the flags and X copied out together, so a solve is mostly one wait)
        let first = true, sent = 0, flags, out;
        for (;;) {
            const batch = Math.min(maxCycles - sent, first ? Math.min(MAX_BATCH, Math.max(2, this.lastCycles + 1)) : MAX_BATCH);
            const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
            if (first) this.encodeResidual(pass);
            for (let k = 0; k < batch; k++) { this.encodeCycle(pass); this.encodeResidual(pass); }
            pass.end();
            enc.copyBufferToBuffer(this.flags, 0, this.staging, 0, 16);
            enc.copyBufferToBuffer(G0.X, 0, this.staging, 16, 8 * n);
            device.queue.submit([enc.finish()]);
            await gpuWait(device, this.staging.mapAsync(GPUMapMode.READ), 'the climate solver');
            const view = this.staging.getMappedRange();
            flags = new DataView(view.slice(0, 16));
            first = false; sent += batch;
            const done = flags.getUint32(0, true) || sent >= maxCycles;
            if (done) out = new Float32Array(view.slice(16, 16 + 8 * n));
            this.staging.unmap();
            if (done) break;
        }
        for (let c = 0; c < n; c++) { Tr[c] = out[2 * c]; Ti[c] = out[2 * c + 1]; }
        this.lastCycles = flags.getUint32(4, true);
        return { cycles: this.lastCycles, rel: Math.sqrt(flags.getFloat32(8, true)) / fnorm, beyondFloor: Math.sqrt(flags.getFloat32(12, true)) / fnorm };
    }

    encodeResidual(pass) {
        const G0 = this.g[0], L0 = this.levels[0];
        run(pass, this.pipes.resid0, this.bg.resid0, L0.h);
        run(pass, this.pipes.norm, this.bg.norm, 1);
    }

    /** One V-cycle on the correction: pre-smoothing colours 0, 1, 1, 0; post 1, 0, 0, 1 (solver.js vcycle's relax pairs). */
    encodeCycle(pass) {
        const P = this.pipes, B = this.bg.levels, Ls = this.levels, nL = Ls.length;
        const smooth = (l, p) => run(pass, P.smooth, B[l].smooth[p], Math.floor((Ls[l].h - p + 1) / 2));
        for (let l = 0; l < nL - 1; l++) {
            for (const p of [0, 1, 1, 0]) smooth(l, p);
            run(pass, P.resid, B[l].resid, Math.ceil(Ls[l].n / 256));
            run(pass, P.restrict, B[l].restrict, Math.ceil(Ls[l + 1].n / 256));
        }
        run(pass, P.coarsest, B[nL - 1].coarsest, 1);
        for (let l = nL - 2; l >= 0; l--) {
            run(pass, P.prolong, B[l].prolong, Math.ceil(Ls[l].n / 256));
            for (const p of [1, 0, 0, 1]) smooth(l, p);
        }
        run(pass, P.update, this.bg.update, Math.ceil(Ls[0].n / 256));
    }

    destroy() { for (const b of this.buffers) b.destroy(); this.buffers = []; }
}

function run(pass, pipe, group, count) {
    pass.setPipeline(pipe);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(count);
}

/**
 * The solver on a small fixed problem — a 6° grid (60 × 30 → 30 × 15 → 10 × 5), every input made of integers, winds and
 * a complex damping, two solves (advective and flux form) — for app/history-key.js gpuFingerprint's finish scope: the
 * cycles' float32 rounding and fused multiply-adds are the vendor's, so a GPU that answers them differently files its
 * finishes apart. @returns {Promise<ArrayBufferView[]>}  what it answered, to hash
 */
export async function climateSolverProbe(device) {
    const { LatLonGrid } = await import('../climate/grid.js');
    const kit = await climateSolverKit(device), g = new LatLonGrid(6), G = g.size, out = [];
    try {
        for (const conservative of [false, true]) {
            const s = kit(g, conservative ? 0 : 1, conservative ? 0 : 2, { conservative });
            const sr = new Float64Array(G), si = new Float64Array(G), u = new Float64Array(G), v = new Float64Array(G), f = new Float64Array(G), fi = new Float64Array(G);
            for (let c = 0; c < G; c++) { sr[c] = 1 + (c * 7) % 5; si[c] = (c * 3) % 4; u[c] = ((c * 11) % 21) - 10; v[c] = ((c * 13) % 9) - 4; f[c] = ((c * 17) % 400) - 150; fi[c] = (c * 5) % 30; }
            s.setOperator(sr, si, u, v, 1e6);
            const T = new Float64Array(G), Ti = new Float64Array(G);
            await s.solve(f, fi, T, Ti, { maxCycles: 12, tol: 1e-5 });
            out.push(Float32Array.from(T), Float32Array.from(Ti));
        }
    } finally { kit.release(); }
    return out;
}
