// The fluvial lane's GPU kernels (lane fluvial-unify, design §2): the three parts of an erosion step that today's solver
// (erode-gpu.js) sweeps level by level, ~1,800 dispatches a step, done instead in O(log n) passes each, after FastFlow
// (Jain, Kerbl, Gain, Finley & Cordonnier, CGF 43(7) 2024):
//   · solveAffine — the implicit stream-power solve, pointer-jumped. FastFlow's Alg. 7 composes h_c = α_c + β_c·h_r up the
//     receiver tree; our lakes add a max (a lake's bed holds at its old height or the water under it), so each cell's update
//     is f_c(x) = max(a_c, α_c + β_c·x), β ≥ 0. That family is closed under composition,
//         f₁∘f₂ (x) = max(a₁, α₁ + β₁·a₂, (α₁ + β₁·α₂) + β₁·β₂·x),
//     so pointer jumping holds with the lakes in place: ⌈log₂ depth⌉ passes, then one apply at the roots' heights.
//   · drainage — the sum of a weight (area × runoff) over every cell upstream, by rake-and-compress over each cell's donor
//     row (FastFlow §4): a donor with no donors left is added and dropped (rake); one with a single donor is added and
//     replaced by that donor (compress); the rest wait. Each cell keeps s_c + Σ final(row) = final(c) through every pass.
//     ~2·log₂ n passes on real trees.
//   · diffuse — nonlinear threshold hillslope diffusion, q = −D·S / (1 − (S/S_c)²) (Roering, Kirchner & Dietrich 1999),
//     implicit: the edge conductances from the step's start (one Picard pass), then Jacobi sweeps of (I − dt·L_g)·z′ = z
//     on the mesh's graph Laplacian. Sea cells hold their height (Dirichlet). The Laplacian's edge weight is the hexagonal
//     lattice's, 2 / (3·d²) per neighbour at distance d (as tectonics/step/heights.js spreads uplift), generalised to the
//     irregular mesh by each edge's own length: no Voronoi edge lengths are kept, so this is the lattice approximation.
// Determinism: no atomics in any result (a donor row is gathered from the cell's own neighbour list, in its order), so a
// machine repeats its own result bit for bit. float32 throughout: the pointer-jumped composition differs from the sequential
// form by rounding only (tools/fluvial-kernels-test.mjs measures it against a float64 CPU reference).
// New processes are GPU only (lane ruling Q1): the CPU stream-power path in finish-erode.js stays as it is.

import { storage, readBack, pipeline, bind } from './gpu-device.js';

const WG = 128, ROW = 65535 * WG, BIG = 1e30, R_EARTH = 6371;

const HEAD = /* wgsl */`
struct U { n: u32, W: u32, dt: f32, D: f32, Sc: f32, R: f32, p0: f32, p1: f32 }
@group(0) @binding(0) var<uniform> U_: U;
const BIG = ${BIG}f;
`;

// Each kernel: the buffers it binds (binding 1, 2, … in order; '+' read_write) and its body, run for every cell c < n.
const T = { u: 'array<u32>', f: 'array<f32>', v: 'array<vec4f>', a: 'array<atomic<u32>>' };
const KERNELS = {
    // f_c ← f_c ∘ f_ptr(c), ptr ← ptr(ptr): a root (ptr = c) holds the identity (a = −BIG, α = 0, β = 1), so it stays one
    affineJump: { b: { fA: 'v', ptrA: 'u', fB: 'v+', ptrB: 'u+' }, body: `
        let p = ptrA[c]; let f = fA[c]; let g = fA[p];
        fB[c] = vec4f(max(-BIG, max(f.x, f.y + f.z * g.x)), f.y + f.z * g.y, f.z * g.z, 0.0);
        ptrB[c] = ptrA[p];` },
    affineApply: { b: { f: 'v', ptr: 'u', h0: 'f', h: 'f+' }, body: `
        let g = f[c]; h[c] = max(g.x, g.y + g.z * h0[ptr[c]]);` },
    // a cell's donors: its neighbours that drain to it, in its neighbour list's order (no atomics: the row's order is fixed)
    donorsInit: { b: { adjOffset: 'u', adjList: 'u', recv: 'u', w: 'f', sA: 'f+', cntA: 'u+', rowA: 'u+' }, body: `
        var k = 0u;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) { let y = adjList[j]; if (y != c && recv[y] == c) { rowA[c * U_.W + k] = y; k++; } }
        sA[c] = w[c]; cntA[c] = k;` },
    rakeCompress: { b: { sA: 'f', cntA: 'u', rowA: 'u', sB: 'f+', cntB: 'u+', rowB: 'u+' }, body: `
        var s = sA[c]; var k = 0u; let m = cntA[c];
        for (var i = 0u; i < m; i++) {
            let d = rowA[c * U_.W + i]; let md = cntA[d];
            if (md == 0u) { s += sA[d]; }
            else if (md == 1u) { s += sA[d]; rowB[c * U_.W + k] = rowA[d * U_.W]; k++; }
            else { rowB[c * U_.W + k] = d; k++; }
        }
        sB[c] = s; cntB[c] = k;` },
    pending: { b: { cntA: 'u', counter: 'a' }, body: 'if (cntA[c] != 0u) { atomicAdd(&counter[0], 1u); }' },
    // each neighbour slot's dt·w·D_eff: the slope capped short of S_c (0.99), where D_eff runs to 50·D
    edgeCond: { b: { adjOffset: 'u', adjList: 'u', xyz: 'f', z: 'f', G: 'f+' }, body: `
        let pc = vec3f(xyz[3u * c], xyz[3u * c + 1u], xyz[3u * c + 2u]);
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) {
            let y = adjList[j]; let d = U_.R * length(vec3f(xyz[3u * y], xyz[3u * y + 1u], xyz[3u * y + 2u]) - pc);
            let S = min(abs(z[y] - z[c]) / d, 0.99 * U_.Sc); let r = S / U_.Sc;
            G[j] = U_.dt * (2.0 / (3.0 * d * d)) * U_.D / (1.0 - r * r);
        }` },
    jacobi: { b: { adjOffset: 'u', adjList: 'u', G: 'f', z0: 'f', land: 'u', zA: 'f', zB: 'f+' }, body: `
        if (land[c] == 0u) { zB[c] = z0[c]; return; }
        var num = z0[c]; var den = 1.0;
        for (var j = adjOffset[c]; j < adjOffset[c + 1u]; j++) { let g = G[j]; num += g * zA[adjList[j]]; den += g; }
        zB[c] = num / den;` },
};

function wgsl(spec) {
    const decl = Object.entries(spec.b).map(([k, t], i) => `@group(0) @binding(${i + 1}) var<storage, ${t.endsWith('+') || t === 'a' ? 'read_write' : 'read'}> ${k}: ${T[t[0]]};`).join('\n');
    return `${HEAD}${decl}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u) {
    let c = id.y * ${ROW}u + id.x;
    if (c >= U_.n) { return; }
    ${spec.body}
}`;
}

// (built once a device: a cold compile takes seconds)
const built = new WeakMap();
const pipelinesOf = device => {
    if (!built.has(device)) built.set(device, Promise.all(Object.entries(KERNELS).map(async ([k, spec]) => [k, await pipeline(device, wgsl(spec))])).then(Object.fromEntries));
    return built.get(device);
};

/** The kernels on one device, and one mesh's buffers on it. `mesh`: { numCells, adjOffset, adjList, xyz } (the finish's). */
export async function fluvialKernels(device, mesh) {
    const P = await pipelinesOf(device), n = mesh.numCells;
    let W = 0;
    for (let c = 0; c < n; c++) W = Math.max(W, mesh.adjOffset[c + 1] - mesh.adjOffset[c]);
    const u32 = a => (a instanceof Uint32Array ? a : Uint32Array.from(a));
    const M = { adjOffset: storage(device, u32(mesh.adjOffset)), adjList: storage(device, u32(mesh.adjList)), xyz: storage(device, Float32Array.from(mesh.xyz)) };
    const uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const setU = ({ dt = 0, D = 0, Sc = 1 } = {}) => {
        const b = new ArrayBuffer(32), v = new DataView(b);
        v.setUint32(0, n, true); v.setUint32(4, W, true); v.setFloat32(8, dt, true); v.setFloat32(12, D, true); v.setFloat32(16, Sc, true); v.setFloat32(20, R_EARTH, true);
        device.queue.writeBuffer(uniform, 0, b);
    };
    const groups = Math.ceil(n / WG), gx = Math.min(groups, 65535), gy = Math.ceil(groups / 65535);
    /** One dispatch of kernel `k` over every cell, its buffers in the kernel's binding order. */
    const pass = (enc, k, buffers) => {
        const p = enc.beginComputePass();
        p.setPipeline(P[k]); p.setBindGroup(0, bind(device, P[k], [uniform, ...buffers])); p.dispatchWorkgroups(gx, gy); p.end();
    };
    const submit = enc => device.queue.submit([enc.finish()]);
    const temp = [];
    const buf = src => { const b = storage(device, src); temp.push(b); return b; };
    const done = () => { for (const b of temp.splice(0)) b.destroy(); };
    const stats = { dispatches: 0 };
    const count = k => (stats.dispatches += k);

    /**
     * h_c = f_c(h at the root of c's receiver chain), f_c(x) = max(a_c, α_c + β_c·x), for every cell. `recv`: each cell's
     * receiver (a root: itself); `a`, `alpha`, `beta`: Float32Arrays (a = −Infinity: none, at a root it is ignored: a root
     * takes h0); `h0`: the roots' heights. `jumps`: passes, default ⌈log₂ n⌉ (enough for any depth). @returns Float32Array h
     */
    async function solveAffine({ recv, a, alpha, beta, h0, jumps = Math.ceil(Math.log2(Math.max(2, n))) }) {
        const f = new Float32Array(4 * n), ptr = u32(recv);
        for (let c = 0; c < n; c++) {
            const root = ptr[c] === c;
            f[4 * c] = root ? -BIG : Math.max(-BIG, a[c]); f[4 * c + 1] = root ? 0 : alpha[c]; f[4 * c + 2] = root ? 1 : beta[c];
        }
        setU();
        const F = [buf(f), buf(16 * n)], Q = [buf(ptr), buf(4 * n)], H0 = buf(Float32Array.from(h0)), H = buf(4 * n);
        const enc = device.createCommandEncoder();
        for (let i = 0; i < jumps; i++) pass(enc, 'affineJump', [F[i & 1], Q[i & 1], F[(i + 1) & 1], Q[(i + 1) & 1]]);
        pass(enc, 'affineApply', [F[jumps & 1], Q[jumps & 1], H0, H]);
        submit(enc); count(jumps + 1);
        const out = await readBack(device, H);
        done();
        return out;
    }

    /**
     * The sum of `w` over each cell and every cell upstream of it on the receiver tree `recv` (a root: itself).
     * @returns {Promise<{ sum: Float32Array, passes: number }>}
     */
    async function drainage({ recv, w, chunk = Math.ceil(2 * Math.log2(Math.max(2, n))) }) {
        setU();
        const S = [buf(4 * n), buf(4 * n)], C = [buf(4 * n), buf(4 * n)], Rw = [buf(4 * n * W), buf(4 * n * W)];
        const RECV = buf(u32(recv)), Wt = buf(Float32Array.from(w)), counter = buf(new Uint32Array(1));
        let enc = device.createCommandEncoder();
        pass(enc, 'donorsInit', [M.adjOffset, M.adjList, RECV, Wt, S[0], C[0], Rw[0]]);
        count(1);
        let i = 0;
        // (passes in chunks, then a count of the rows still open: one readback a chunk, none a pass)
        for (;;) {
            for (let k = 0; k < chunk; k++, i++) pass(enc, 'rakeCompress', [S[i & 1], C[i & 1], Rw[i & 1], S[(i + 1) & 1], C[(i + 1) & 1], Rw[(i + 1) & 1]]);
            device.queue.writeBuffer(counter, 0, new Uint32Array(1));
            pass(enc, 'pending', [C[i & 1], counter]);
            submit(enc); count(chunk + 1);
            const [open] = await readBack(device, counter, Uint32Array);
            if (open === 0) break;
            if (i > 64 * Math.log2(Math.max(2, n))) throw new Error(`drainage: ${open} rows still open after ${i} passes`);
            enc = device.createCommandEncoder();
        }
        const sum = await readBack(device, S[i & 1]);
        done();
        return { sum, passes: i };
    }

    /**
     * One implicit step of nonlinear threshold diffusion over `dt` (Myr) with diffusivity `D` (km²/Myr) and critical slope
     * `Sc`, on the land (`land`: 1 per cell that moves); the rest hold. `sweeps` Jacobi sweeps. @returns Float32Array z′
     */
    async function diffuse({ z, land, dt, D, Sc, sweeps = 30 }) {
        setU({ dt, D, Sc });
        const Z0 = buf(Float32Array.from(z)), Zs = [buf(Float32Array.from(z)), buf(4 * n)], G = buf(4 * mesh.adjList.length), L = buf(u32(land));
        const enc = device.createCommandEncoder();
        pass(enc, 'edgeCond', [M.adjOffset, M.adjList, M.xyz, Z0, G]);
        for (let i = 0; i < sweeps; i++) pass(enc, 'jacobi', [M.adjOffset, M.adjList, G, Z0, L, Zs[i & 1], Zs[(i + 1) & 1]]);
        submit(enc); count(sweeps + 1);
        const out = await readBack(device, Zs[sweeps & 1]);
        done();
        return out;
    }

    const destroy = () => { done(); for (const b of [...Object.values(M), uniform]) b.destroy(); };
    return { n, W, solveAffine, drainage, diffuse, stats, destroy };
}

// The CPU references, float64, the same arithmetic in sequence (tools/fluvial-kernels-test.mjs): not a fallback (Q1).
export const reference = {
    solveAffine({ recv, a, alpha, beta, h0 }) {
        const n = recv.length, h = new Float64Array(n), done = new Uint8Array(n), stack = [];
        for (let c0 = 0; c0 < n; c0++) {
            let c = c0;
            while (!done[c] && recv[c] !== c) { stack.push(c); c = recv[c]; }
            if (!done[c]) { h[c] = h0[c]; done[c] = 1; }
            while (stack.length) { const x = stack.pop(); h[x] = Math.max(a[x], alpha[x] + beta[x] * h[recv[x]]); done[x] = 1; }
        }
        return h;
    },
    drainage({ recv, w }) {
        const n = recv.length, sum = Float64Array.from(w), indeg = new Uint32Array(n), queue = [];
        for (let c = 0; c < n; c++) if (recv[c] !== c) indeg[recv[c]]++;
        for (let c = 0; c < n; c++) if (!indeg[c]) queue.push(c);
        for (let q = 0; q < queue.length; q++) { const c = queue[q], r = recv[c]; if (r === c) continue; sum[r] += sum[c]; if (!--indeg[r]) queue.push(r); }
        return sum;
    },
    diffuse(mesh, { z, land, dt, D, Sc, sweeps = 30 }) {
        const { adjOffset, adjList, xyz } = mesh, n = mesh.numCells, G = new Float64Array(adjList.length);
        for (let c = 0; c < n; c++) for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
            const y = adjList[j], d = R_EARTH * Math.hypot(xyz[3 * y] - xyz[3 * c], xyz[3 * y + 1] - xyz[3 * c + 1], xyz[3 * y + 2] - xyz[3 * c + 2]);
            const S = Math.min(Math.abs(z[y] - z[c]) / d, 0.99 * Sc), r = S / Sc;
            G[j] = dt * (2 / (3 * d * d)) * D / (1 - r * r);
        }
        let A = Float64Array.from(z), B = new Float64Array(n);
        for (let i = 0; i < sweeps; i++) {
            for (let c = 0; c < n; c++) {
                if (!land[c]) { B[c] = z[c]; continue; }
                let num = z[c], den = 1;
                for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { num += G[j] * A[adjList[j]]; den += G[j]; }
                B[c] = num / den;
            }
            [A, B] = [B, A];
        }
        return A;
    },
};
