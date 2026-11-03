// The thin sheet's discretisation (stress-field study, branch stressfield; harvested for the in-plate stress of
// field/plate-stress-field.js). The sim mesh's Delaunay triangles, each a
// flat constant-strain element, velocities at the cells as 2 tangent components. A rotation of the sphere, v_i = ω × r_i, is
// a rotation of 3-space, so it strains no flat triangle at all: rigid plates are the stiffness's exact null space on any
// mesh, and in the rigid limit the sheet's balance IS step/torque-balance.js's D ω = T.
//
// Units, shared with the torque balance: lengths on the unit sphere, velocities in rad/Myr, forces in the history's unit
// (1 = slabPull over 100 km of trench, config.js forceUnitNPerM N/m). Stress in the solver's units, T̂, is force per unit
// length on the unit sphere: T (N/m) = T̂ × stressToNPerM(config).

import { PLANET_RADIUS_KM } from '../../core/sim-mesh.js';

const R_M = PLANET_RADIUS_KM * 1e3;
/** N/m per unit of the solver's stress: the force of 100 km of full slab pull (forceUnitNPerM × 10⁵ m), per radius. */
export const stressToNPerM = config => config.forceUnitNPerM * 1e5 / R_M;

/** @returns the triangles (each once, from the ring-ordered adjacency), tangent bases and per-element strain operators */
export function buildSheetMesh(mesh) {
    const { numCells: n, xyz, adjOffset, adjList } = mesh, tris = [];
    for (let a = 0; a < n; a++) {
        for (let k = adjOffset[a], end = adjOffset[a + 1]; k < end; k++) {
            const b = adjList[k], c = adjList[k + 1 < end ? k + 1 : adjOffset[a]];
            if (a < b && a < c) tris.push(a, b, c);        // (each triangle turns up once, at its lowest corner)
        }
    }
    const tri = Int32Array.from(tris), nt = tri.length / 3;
    if (nt !== 2 * n - 4) throw new Error(`${nt} triangles on ${n} cells: not a closed sphere (expected ${2 * n - 4})`);
    // tangent basis at each cell
    const e1 = new Float64Array(3 * n), e2 = new Float64Array(3 * n), r = new Float64Array(3 * n), area = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
        const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
        r[3 * i] = x; r[3 * i + 1] = y; r[3 * i + 2] = z;
        const ax = Math.abs(z) < 0.9 ? 0 : 1, ay = 0, az = Math.abs(z) < 0.9 ? 1 : 0;     // any axis not along r
        let ux = ay * z - az * y, uy = az * x - ax * z, uz = ax * y - ay * x;
        const m = Math.hypot(ux, uy, uz); ux /= m; uy /= m; uz /= m;
        e1[3 * i] = ux; e1[3 * i + 1] = uy; e1[3 * i + 2] = uz;
        e2[3 * i] = y * uz - z * uy; e2[3 * i + 1] = z * ux - x * uz; e2[3 * i + 2] = x * uy - y * ux;
    }
    // B: nt × 3 × 6 — (ε_ss, ε_tt, ε_st) of the element from its 6 tangent velocities
    const B = new Float64Array(18 * nt), triArea = new Float64Array(nt), width = new Float64Array(nt), axis = new Float64Array(6 * nt);   // axis: the element's s and t, world frame
    for (let t = 0; t < nt; t++) {
        const id = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]], p = id.map(i => [r[3 * i], r[3 * i + 1], r[3 * i + 2]]);
        const u = sub(p[1], p[0]), v = sub(p[2], p[0]), c = cross(u, v), twoA = Math.hypot(...c), m = scale(c, 1 / twoA);
        const s = scale(u, 1 / Math.hypot(...u)), tt = cross(m, s);
        triArea[t] = twoA / 2;
        axis.set(s, 6 * t); axis.set(tt, 6 * t + 3);
        width[t] = Math.sqrt(twoA * 2 / Math.sqrt(3));     // the side of the equilateral triangle of this area
        for (let i = 0; i < 3; i++) {
            const e = sub(p[(i + 2) % 3], p[(i + 1) % 3]), g = scale(cross(m, e), 1 / twoA);     // ∇ of this corner's shape function
            const gs = dot(g, s), gt = dot(g, tt), o = id[i];
            for (let d = 0; d < 2; d++) {
                const b = d === 0 ? [e1[3 * o], e1[3 * o + 1], e1[3 * o + 2]] : [e2[3 * o], e2[3 * o + 1], e2[3 * o + 2]];
                const vs = dot(b, s), vt = dot(b, tt), col = 2 * i + d;
                B[18 * t + col] = vs * gs; B[18 * t + 6 + col] = vt * gt; B[18 * t + 12 + col] = 0.5 * (vs * gt + vt * gs);
                area[o] += d === 0 ? twoA / 6 : 0;
            }
        }
    }
    // the elements' stiffness at unit viscosity: 2 A Bᵀ M B, upper triangle by rows, with M the sheet's law
    //   T_ij = 2 η (ε_ij + δ_ij ε_kk)   [England & McKenzie 1982: a sheet free to thicken]
    const Ke = new Float64Array(36 * nt);
    for (let t = 0; t < nt; t++) {
        const o = 18 * t, a2 = 2 * triArea[t];
        for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
            const si = B[o + i], ti = B[o + 6 + i], xi = B[o + 12 + i], sj = B[o + j], tj = B[o + 6 + j], xj = B[o + 12 + j];
            Ke[36 * t + 6 * i + j] = a2 * (si * (2 * sj + tj) + ti * (sj + 2 * tj) + 2 * xi * xj);
        }
    }
    // the sparse pattern on 2n unknowns, and where each element entry lands
    const rowStart = new Int32Array(2 * n + 1), cols = [];
    for (let i = 0; i < n; i++) {
        const nb = [i, ...adjList.subarray(adjOffset[i], adjOffset[i + 1])].sort((p, q) => p - q);
        for (let d = 0; d < 2; d++) {
            for (const j of nb) cols.push(2 * j, 2 * j + 1);
            rowStart[2 * i + d + 1] = cols.length;
        }
    }
    const colIdx = Int32Array.from(cols), where = new Int32Array(36 * nt);
    const find = (row, col) => { let lo = rowStart[row], hi = rowStart[row + 1] - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (colIdx[m] < col) lo = m + 1; else hi = m; } if (colIdx[lo] !== col) throw new Error('pattern'); return lo; };
    for (let t = 0; t < nt; t++) for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
        const I = 2 * tri[3 * t + (i >> 1)] + (i & 1), J = 2 * tri[3 * t + (j >> 1)] + (j & 1);
        where[36 * t + 6 * i + j] = find(I, J);
    }
    const diagAt = new Int32Array(2 * n), offAt = new Int32Array(2 * n);
    for (let i = 0; i < 2 * n; i++) { diagAt[i] = find(i, i); offAt[i] = find(i, i ^ 1); }
    return { mesh, n, nt, tri, r, e1, e2, area, B, Ke, triArea, width, axis, rowStart, colIdx, where, diagAt, offAt };
}

/** The tangent components (u1, u2 at each cell) of a 3-vector per cell. */
export function toTangent(sm, f3, out = new Float64Array(2 * sm.n)) {
    const { n, e1, e2 } = sm;
    for (let i = 0; i < n; i++) {
        const x = f3[3 * i], y = f3[3 * i + 1], z = f3[3 * i + 2];
        out[2 * i] = x * e1[3 * i] + y * e1[3 * i + 1] + z * e1[3 * i + 2];
        out[2 * i + 1] = x * e2[3 * i] + y * e2[3 * i + 1] + z * e2[3 * i + 2];
    }
    return out;
}
/** …and back to 3-vectors. */
export function toWorld(sm, u, out = new Float64Array(3 * sm.n)) {
    const { n, e1, e2 } = sm;
    for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) out[3 * i + d] = u[2 * i] * e1[3 * i + d] + u[2 * i + 1] * e2[3 * i + d];
    return out;
}

/** Each element's strain rate: writes (ε_ss, ε_tt, ε_st) to `e` (3 per element) and ε̇_II = √(½ ε_ij ε_ij), counting the
 *  vertical strain the sheet's thickening takes, to `ii` — both in 1/Myr. */
export function strainRates(sm, u, e, ii) {
    const { nt, tri, B } = sm;
    for (let t = 0; t < nt; t++) {
        const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2], o = 18 * t;
        const u0 = u[2 * a], u1 = u[2 * a + 1], u2 = u[2 * b], u3 = u[2 * b + 1], u4 = u[2 * c], u5 = u[2 * c + 1];
        const s = B[o] * u0 + B[o + 1] * u1 + B[o + 2] * u2 + B[o + 3] * u3 + B[o + 4] * u4 + B[o + 5] * u5;
        const d = B[o + 6] * u0 + B[o + 7] * u1 + B[o + 8] * u2 + B[o + 9] * u3 + B[o + 10] * u4 + B[o + 11] * u5;
        const x = B[o + 12] * u0 + B[o + 13] * u1 + B[o + 14] * u2 + B[o + 15] * u3 + B[o + 16] * u4 + B[o + 17] * u5;
        e[3 * t] = s; e[3 * t + 1] = d; e[3 * t + 2] = x;
        ii[t] = Math.sqrt(s * s + d * d + s * d + x * x);       // ½ (ε_ij ε_ij + (ε_kk)²) = s² + d² + sd + x²
    }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
