// The stress inside the rigid plates, as a field (lane pstress; option (c) of the stress-field study: rigid plates + in-plate
// stress + damage on the crust rasters). step/plate-stress.js already has each cell's net load at the plate's rotation —
// the boundary forces, the mantle's drag under it, the couplings to other plates — which over a whole plate balances (the
// torque balance). A rigid plate carries that load to where it is balanced through its rock; the stress that takes is the
// solution of a thin elastic (or viscous) sheet loaded by it, free at its edges, with the plate's rigid turning left out:
//        ∇·T + f = 0 in the plate,   T n = 0 on its edges,   T_ij = 2η (ε_ij + δ_ij ε_kk)     [England & McKenzie 1982]
// For a stiff plate T does not depend on η (the strain does, ∝ 1/η, and goes to 0: the plate stays rigid), so it is solved at
// unit η. Each plate is its own problem (its edges are free: every force across a boundary is already in f), all at once.
//
// Reduced model, and its limits:
//  - solved on a stress mesh of its own, plateStressCells cells (~240 km apart at 10K), whatever the sim's resolution: the
//    stress varies over a plate's breadth, and a fixed mesh keeps the field the same on every sim mesh (check-scale). A
//    plate narrower than a few stress cells carries no stress here (it has no whole element);
//  - the plate's net imbalance — the speed caps' and the relaxation's share (torque-balance.js: a plate turns toward its
//    balance over relaxMyr) — is taken off as a load along the plate's own rigid turning, spread like drag;
//  - elastic, so it says where a plate is most pulled, not how it would deform once broken; the sheet of the stress-field
//    study (branch stressfield) was the deforming version, and cost ~10× the budget;
//  - the forces are the torque balance's, in its unit (config forceUnitNPerM: what a full slab pull carries per metre).
//
// Solver: conjugate gradients, 2 × 2 block-Jacobi, on the plates' stiffness plus a weak drag that pins their rigid turning
// (the load's own share along it taken off first), warm-started from the last solve where a node keeps its plate. CPU, deterministic (fixed order), so a seed builds one planet.

import { buildSimMesh } from '../../core/sim-mesh.js';
import { buildSheetMesh, toTangent, strainRates, stressToNPerM } from './sheet-mesh.js';
import { netTorques } from '../step/plate-stress.js';

const HOLD_KM = 10000;                   // the regularising drag's reach (below)
const meshes = new Map();                 // stress meshes by cell count (one per history size: built once)
const links = new WeakMap();              // sim mesh → { coarse, simTo, toSim } for each stress mesh

/** The stress mesh for a sim mesh, and the nearest-cell links both ways. */
export function stressMeshFor(simMesh, cells) {
    const n = Math.min(cells, simMesh.numCells);
    let byMesh = links.get(simMesh);
    if (!byMesh) links.set(simMesh, byMesh = new Map());
    let L = byMesh.get(n);
    if (L) return L;
    let coarse;
    if (n === simMesh.numCells) coarse = { mesh: simMesh, sm: buildSheetMesh(simMesh) };
    else {
        coarse = meshes.get(n);
        if (!coarse) { const mesh = buildSimMesh(n, 0x5f3e55); meshes.set(n, coarse = { mesh, sm: buildSheetMesh(mesh) }); }
    }
    const { xyz } = simMesh, cx = coarse.mesh.xyz, simTo = new Int32Array(simMesh.numCells), toSim = new Int32Array(n);
    if (coarse.mesh === simMesh) { for (let i = 0; i < n; i++) simTo[i] = toSim[i] = i; }
    else {
        for (let w = 0; w < simMesh.numCells; w++) simTo[w] = coarse.mesh.index.nearest(xyz[3 * w], xyz[3 * w + 1], xyz[3 * w + 2]);
        for (let k = 0; k < n; k++) toSim[k] = simMesh.index.nearest(cx[3 * k], cx[3 * k + 1], cx[3 * k + 2]);
    }
    byMesh.set(n, L = { ...coarse, simTo, toSim });
    return L;
}

/**
 * Solve the plates' stress on the world as it stands (after a torque balance: world.loads). Writes world.plateStress:
 * per stress-mesh node its plate (own, −1 none), the most tensile principal stress s1 and the least s2 (N/m, + tension),
 * and s1's direction (world frame, 3 per node); `simTo` maps a world cell to its node. @returns the solve's stats
 */
export function solvePlateStress(world) {
    const { config, plates, owner, ownerCell, mesh } = world;
    if (!world.loads || !world.cellTorque) return null;
    const L = stressMeshFor(mesh, config.plateStressCells), { sm, simTo, toSim } = L, { n, nt, tri, r, e1, e2, rowStart, colIdx } = sm;
    const own = new Int32Array(n);
    for (let k = 0; k < n; k++) { const o = owner[toSim[k]]; own[k] = o >= 0 && !plates[o].isBackground && plates[o].alive ? o : -1; }
    // the plates' elements: wholly inside one plate
    const live = new Uint8Array(nt), active = new Uint8Array(n);
    for (let t = 0; t < nt; t++) {
        const a = own[tri[3 * t]];
        if (a >= 0 && a === own[tri[3 * t + 1]] && a === own[tri[3 * t + 2]]) { live[t] = 1; active[tri[3 * t]] = active[tri[3 * t + 1]] = active[tri[3 * t + 2]] = 1; }
    }
    // the load: each world cell's net force f = ρ × r (step/plate-stress.js ρ = r × f, f tangent) on its node — or, where
    // that node is not on the cell's plate's elements (an edge, a sliver), on the nearest that is, within two rings
    const f3 = new Float64Array(3 * n), rho = new Map(), { adjOffset, adjList } = L.mesh;
    let dropped = 0, total = 0;
    const nodeOf = (w, p) => {
        const k0 = simTo[w];
        if (own[k0] === p && active[k0]) return k0;
        let best = -1, bd = -2;
        const x = mesh.xyz[3 * w], y = mesh.xyz[3 * w + 1], z = mesh.xyz[3 * w + 2], cx = L.mesh.xyz;
        for (let a = adjOffset[k0]; a < adjOffset[k0 + 1]; a++) {
            const k1 = adjList[a];
            for (const k of [k1, ...adjList.subarray(adjOffset[k1], adjOffset[k1 + 1])]) {
                if (own[k] !== p || !active[k]) continue;
                const d = cx[3 * k] * x + cx[3 * k + 1] * y + cx[3 * k + 2] * z;
                if (d > bd) { bd = d; best = k; }
            }
        }
        return best;
    };
    for (let w = 0; w < mesh.numCells; w++) {
        const p = owner[w];
        if (p < 0 || plates[p].isBackground) continue;
        let R = rho.get(p);
        if (R === undefined) rho.set(p, R = netTorques(world, plates[p]));
        if (!R) continue;
        const c = ownerCell[w], tx = R[3 * c], ty = R[3 * c + 1], tz = R[3 * c + 2];
        const x = mesh.xyz[3 * w], y = mesh.xyz[3 * w + 1], z = mesh.xyz[3 * w + 2];
        const fx = ty * z - tz * y, fy = tz * x - tx * z, fz = tx * y - ty * x, m = Math.hypot(fx, fy, fz);
        total += m;
        const k = nodeOf(w, p);
        if (k < 0) { dropped += m; continue; }
        f3[3 * k] += fx; f3[3 * k + 1] += fy; f3[3 * k + 2] += fz;
    }
    const F = toTangent(sm, f3);
    for (let k = 0; k < n; k++) if (!active[k]) { F[2 * k] = 0; F[2 * k + 1] = 0; }
    // each plate's rigid turnings (the null space): node k's tangent velocity under a unit turn about axis a is a × r_k
    const modes = rigidModes(sm, own, active);
    const imbalance = project(modes, F, true);
    // the matrix: the live elements' stiffness at unit η
    const val = new Float64Array(colIdx.length), { Ke, where } = sm;
    for (let t = 0; t < nt; t++) if (live[t]) for (let q = 0; q < 36; q++) val[where[36 * t + q]] += Ke[36 * t + q];
    // …and a drag under every node against its turning away from the plate's rigid motion, as weak as a sheet's whose
    // stiffness outreaches it over HOLD_KM (√(η ⁄ c): the lid over the ocean's drag is ~7800 km, stress-field study). It
    // leaves the stress of a plate a few thousand km across as it is, and it holds what nothing else does: the pieces of a
    // plate whose elements part (two patches, or two joined at one node, each turn on their own at no strain)
    const hold = (6371 / HOLD_KM) ** 2;
    for (let k = 0; k < n; k++) if (active[k]) { val[sm.diagAt[2 * k]] += hold * sm.area[k]; val[sm.diagAt[2 * k + 1]] += hold * sm.area[k]; }
    // warm start: the last solution where a node has kept its plate
    const prev = world.plateStress, u = new Float64Array(2 * n);
    if (prev?.u && prev.u.length === 2 * n) for (let k = 0; k < n; k++) if (active[k] && prev.own[k] === own[k]) { u[2 * k] = prev.u[2 * k]; u[2 * k + 1] = prev.u[2 * k + 1]; }
    project(modes, u, false);
    const { iterations, rel } = pcg(sm, val, F, u, active, modes, config.plateStressTol, config.plateStressMaxIter);
    // the stress of each live element (T̂ = 2 (ε + δ tr ε) at η = 1), gathered at the nodes as a world-frame tensor
    const e = new Float64Array(3 * nt), ii = new Float64Array(nt), T6 = new Float64Array(6 * n), wsum = new Float64Array(n), { axis, triArea } = sm;
    strainRates(sm, u, e, ii);
    for (let t = 0; t < nt; t++) {
        if (!live[t]) continue;
        const s = e[3 * t], d = e[3 * t + 1], x = e[3 * t + 2], tss = 2 * (2 * s + d), ttt = 2 * (2 * d + s), tst = 2 * x;
        const S = axis.subarray(6 * t, 6 * t + 3), Tt = axis.subarray(6 * t + 3, 6 * t + 6), A = triArea[t];
        // T = tss S Sᵀ + ttt Tt Ttᵀ + tst (S Ttᵀ + Tt Sᵀ), as xx yy zz xy xz yz
        const comp = (i, j) => tss * S[i] * S[j] + ttt * Tt[i] * Tt[j] + tst * (S[i] * Tt[j] + Tt[i] * S[j]);
        const v = [comp(0, 0), comp(1, 1), comp(2, 2), comp(0, 1), comp(0, 2), comp(1, 2)];
        for (let c = 0; c < 3; c++) { const k = tri[3 * t + c]; for (let q = 0; q < 6; q++) T6[6 * k + q] += A * v[q]; wsum[k] += A; }
    }
    const unit = stressToNPerM(config), s1 = new Float32Array(n), s2 = new Float32Array(n), dir = new Float32Array(3 * n);
    for (let k = 0; k < n; k++) {
        if (!(wsum[k] > 0)) { s1[k] = s2[k] = NaN; continue; }
        const T = T6.subarray(6 * k, 6 * k + 6), a = e1.subarray(3 * k, 3 * k + 3), b = e2.subarray(3 * k, 3 * k + 3);
        const q = (p, o) => (T[0] * p[0] * o[0] + T[1] * p[1] * o[1] + T[2] * p[2] * o[2] + T[3] * (p[0] * o[1] + p[1] * o[0]) + T[4] * (p[0] * o[2] + p[2] * o[0]) + T[5] * (p[1] * o[2] + p[2] * o[1])) / wsum[k];
        const xx = q(a, a), yy = q(b, b), xy = q(a, b), m = (xx + yy) / 2, rad = Math.hypot((xx - yy) / 2, xy);
        s1[k] = (m + rad) * unit; s2[k] = (m - rad) * unit;
        const th = 0.5 * Math.atan2(2 * xy, xx - yy), c = Math.cos(th), sn = Math.sin(th);
        for (let i = 0; i < 3; i++) dir[3 * k + i] = c * a[i] + sn * b[i];
    }
    world.plateStress = { at: world.time, own, active, s1, s2, dir, u, simTo, n, mesh: L.mesh };
    // (the stress study's measure, for comparison with its numbers: 2η ε̇_II over the plates' elements, N/m)
    const tII = [];
    for (let t = 0; t < nt; t++) if (live[t]) tII.push(2 * ii[t] * unit);
    tII.sort((a, b) => a - b);
    const qt = p => tII.length ? tII[Math.floor(p * (tII.length - 1))] : NaN;
    return { iterations, rel, imbalance, dropped: total > 0 ? dropped / total : 0, nodes: n, tII: [qt(0.5), qt(0.9), qt(0.99)] };
}

/** The principal stresses at a world cell (N/m, + tension) and s1's direction, from the last solve; null where the cell's
 *  node is not on its plate's elements. */
export function stressAt(world, w, out = { s1: 0, s2: 0, dir: [0, 0, 0] }) {
    const S = world.plateStress;
    if (!S) return null;
    const k = S.simTo[w];
    if (!S.active[k] || S.own[k] !== world.owner[w] || !(S.s1[k] === S.s1[k])) return null;
    out.s1 = S.s1[k]; out.s2 = S.s2[k]; out.dir[0] = S.dir[3 * k]; out.dir[1] = S.dir[3 * k + 1]; out.dir[2] = S.dir[3 * k + 2];
    return out;
}

/** Per plate: its active nodes and an orthonormal basis of its three rigid turnings (tangent components, 2 per node). */
function rigidModes(sm, own, active) {
    const { n, r, e1, e2 } = sm, byPlate = new Map();
    for (let k = 0; k < n; k++) if (active[k]) { let l = byPlate.get(own[k]); if (!l) byPlate.set(own[k], l = []); l.push(k); }
    const out = [];
    for (const nodes of byPlate.values()) {
        const m = nodes.length, V = [new Float64Array(2 * m), new Float64Array(2 * m), new Float64Array(2 * m)];
        for (let j = 0; j < m; j++) {
            const k = nodes[j], x = r[3 * k], y = r[3 * k + 1], z = r[3 * k + 2];
            const turn = [[0, -z, y], [z, 0, -x], [-y, x, 0]];      // e_a × r for a = x, y, z
            for (let a = 0; a < 3; a++) {
                const v = turn[a];
                V[a][2 * j] = v[0] * e1[3 * k] + v[1] * e1[3 * k + 1] + v[2] * e1[3 * k + 2];
                V[a][2 * j + 1] = v[0] * e2[3 * k] + v[1] * e2[3 * k + 1] + v[2] * e2[3 * k + 2];
            }
        }
        // Gram–Schmidt (a plate of a few nodes may have fewer than three independent turnings)
        const basis = [];
        for (const v of V) {
            for (const b of basis) { let d = 0; for (let i = 0; i < v.length; i++) d += v[i] * b[i]; for (let i = 0; i < v.length; i++) v[i] -= d * b[i]; }
            let l = 0; for (let i = 0; i < v.length; i++) l += v[i] * v[i];
            l = Math.sqrt(l);
            if (l > 1e-9) { for (let i = 0; i < v.length; i++) v[i] /= l; basis.push(v); }
        }
        out.push({ nodes, basis });
    }
    return out;
}

/** Take the rigid turnings out of x (in place). @returns, if `measure`, the share of |x| they held */
function project(modes, x, measure) {
    let gone = 0, all = 0;
    if (measure) for (let i = 0; i < x.length; i++) all += x[i] * x[i];
    for (const { nodes, basis } of modes) for (const b of basis) {
        let d = 0;
        for (let j = 0; j < nodes.length; j++) { const k = nodes[j]; d += b[2 * j] * x[2 * k] + b[2 * j + 1] * x[2 * k + 1]; }
        for (let j = 0; j < nodes.length; j++) { const k = nodes[j]; x[2 * k] -= d * b[2 * j]; x[2 * k + 1] -= d * b[2 * j + 1]; }
        gone += d * d;
    }
    return measure && all > 0 ? Math.sqrt(gone / all) : 0;
}

/** Preconditioned CG on K u = F over the active nodes, the rigid turnings projected out. */
function pcg(sm, val, F, u, active, modes, tol, maxIter) {
    const { n, rowStart, colIdx, diagAt, offAt } = sm, N = 2 * n;
    const mul = (x, y) => {
        for (let i = 0; i < N; i++) {
            if (!active[i >> 1]) { y[i] = 0; continue; }
            let s = 0;
            for (let q = rowStart[i]; q < rowStart[i + 1]; q++) s += val[q] * x[colIdx[q]];
            y[i] = s;
        }
    };
    // 2 × 2 block inverse per node
    const inv = new Float64Array(4 * n);
    for (let k = 0; k < n; k++) {
        if (!active[k]) continue;
        const a = val[diagAt[2 * k]], b = val[offAt[2 * k]], c = val[offAt[2 * k + 1]], d = val[diagAt[2 * k + 1]], det = a * d - b * c;
        if (Math.abs(det) < 1e-300) continue;
        inv[4 * k] = d / det; inv[4 * k + 1] = -b / det; inv[4 * k + 2] = -c / det; inv[4 * k + 3] = a / det;
    }
    const prec = (x, y) => { for (let k = 0; k < n; k++) { const a = x[2 * k], b = x[2 * k + 1]; y[2 * k] = inv[4 * k] * a + inv[4 * k + 1] * b; y[2 * k + 1] = inv[4 * k + 2] * a + inv[4 * k + 3] * b; } };
    const res = new Float64Array(N), z = new Float64Array(N), p = new Float64Array(N), q = new Float64Array(N);
    mul(u, q);
    let fn = 0;
    for (let i = 0; i < N; i++) { res[i] = F[i] - q[i]; fn += F[i] * F[i]; }
    fn = Math.sqrt(fn);
    if (!(fn > 0)) return { iterations: 0, rel: 0 };
    prec(res, z); p.set(z);
    let rz = 0; for (let i = 0; i < N; i++) rz += res[i] * z[i];
    let it = 0, rel = 1;
    for (; it < maxIter; it++) {
        let rr = 0; for (let i = 0; i < N; i++) rr += res[i] * res[i];
        rel = Math.sqrt(rr) / fn;
        if (rel < tol) break;
        mul(p, q);
        let pq = 0; for (let i = 0; i < N; i++) pq += p[i] * q[i];
        if (!(pq > 0)) break;
        const alpha = rz / pq;
        for (let i = 0; i < N; i++) { u[i] += alpha * p[i]; res[i] -= alpha * q[i]; }
        prec(res, z);
        let rz2 = 0; for (let i = 0; i < N; i++) rz2 += res[i] * z[i];
        const beta = rz2 / rz; rz = rz2;
        for (let i = 0; i < N; i++) p[i] = z[i] + beta * p[i];
    }
    return { iterations: it, rel };
}
