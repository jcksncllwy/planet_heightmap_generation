// Thin-plate elastic flexure on the sphere's mesh (lane flexure, 2026-11-22; gpuscan #1's follow-up): the lithosphere's
// answer to a load, in place of the Gaussian rebound blur. The plate bends as a thin elastic sheet over a fluid mantle,
//
//     ∇²(D ∇²w) + Δρ g w = q,      D = E Te³ / 12(1 − ν²),      α = (4D / Δρg)^¼   (Watts 2001, Isostasy and Flexure of the
//                                                                                    Lithosphere, ch. 3; Turcotte & Schubert 3-9)
//
// with w the deflection (down +), q the load, Te the plate's elastic thickness, cell by cell. A load wider than α is carried
// by buoyancy alone (Airy: w = q / Δρg); one narrower than α is spread over α by the plate's stiffness, and the ground
// beyond it rises — the forebulge, at ~πα from a line load at ~4 % of the trough (Turcotte & Schubert eq. 3-127).
//
// Here, in mantle-equivalent km: divided through by ρm g, the equation reads ∇²(B ∇²w) + s w = ℓ, B = D / ρm g (km⁴),
// s = Δρ / ρm (1 under air, (ρm − ρw)/ρm under the sea: its water fills the trough), ℓ = the load's thickness × its density
// over ρm (P.rebound × the change on land, as rebounder's Airy share; FLEX.seaLoad × it under the sea).
//
// The mesh's Laplacian is the finite-volume one on its Voronoi cells (plateOperator). Written L = M⁻¹K, K symmetric (the
// cotangent weights), M = diag(cell areas), the plate's operator times M,
//
//     A = K (B M⁻¹) K + M S,
//
// is symmetric positive definite, so conjugate gradients solve it (Jacobi-preconditioned: A's diagonal). This file holds the
// operator, Te from the history's crust and a float64 CPU solve — the reference the GPU's (flexure-gpu.js) is tested against
// (tools/flexure-test.mjs), and the frozen CPU erosion's solve.
//
// Reduced model, its limits: a thin plate (Te ≪ the load's width: true here, Te ≤ ~90 km against cells ≥ 14 km wide and loads
// wider); the variable-D operator written ∇²(D∇²w) without the (1 − ν) terms in D's gradients (exact for uniform D; Te's
// steps between provinces are where it errs — van Wees & Cloetingh 1994 show it small beside Te's own uncertainty); a flat
// plate on the sphere (membrane stresses matter past ~1000 km: Turcotte 1979; α ≤ ~170 km here); elastic and instant (no
// viscous relaxation of the mantle or the plate: a few kyr for the one, Myr for the other, both under the finish's span); no
// broken plates (a plate end at a trench or rift is a continuous plate whose Te thins there).

import { PLANET_RADIUS_KM as R } from '../core/sim-mesh.js';
import { CrustType } from '../tectonics/model/crust.js';

/**
 * The plate's constants. Te is quoted by its sources against E = 100 GPa and ν = 0.25 (Watts 2001 Table 6.1; Pérez-Gussinyé &
 * Watts 2005), so D carries the same pair: D is what flexure measures, Te × E^⅓ the product (heuristic: carry the fitted product).
 */
export const FLEX = {
    youngPa: 100e9,             // Young's modulus (Watts 2001)
    poisson: 0.25,              // Poisson's ratio (Watts 2001)
    mantleRho: 3300,            // kg/m³ (tectonics/measure.js's columns)
    waterRho: 1030,             // sea water (tectonics/measure.js)
    rockRho: 2700,              // what the land loses or gains (ERODE rebound's ρc/ρm = 0.82 is this over the mantle's)
    sedimentRho: 2500,          // compacted basin fill (tectonics/measure.js SEDIMENT_LOAD_FACTOR's)
    // Te by the crust (km). Continental Te from Pérez-Gussinyé & Watts 2005 (Nature 436: 381; coherence over Europe, Africa
    // and North America): Archean and Palaeoproterozoic lithosphere > 60 km (median ~70), Phanerozoic 20–40; Audet &
    // Bürgmann 2011 (Nat. Geosci. 4: 184) map the same split worldwide. Island arcs and live belts sit on hot, weak
    // lithosphere, 10–20 km (Watts 2001 §6.6; the Andean plateau 10–20, Tassara 2005; Tibet ~10, Jordan & Watts 2005).
    cratonTeKm: 70,
    continentTeKm: 30,
    arcTeKm: 15,
    // The sea floor's Te follows the 450 °C isotherm at its age (Watts & Burov 2003, Geophys. J. Int. 152: the oceanic Te
    // lies between the 300 and 600 °C isotherms, centred on ~450) in the plate model the sea's depth already uses (GDH1,
    // Stein & Stein 1992: plate 95 km, base 1450 °C, κ 0.804 mm²/s). Half-space at young ages, ~2.9 √t km; it saturates
    // at 95 × 450 / 1450 ≈ 29 km past ~100 Myr (Watts 2001 Fig. 6.25: the Pacific's seamounts, Te ~ 2.7 √t, to ~30–40).
    oceanIsoC: 450,
    gdh1PlateKm: 95,
    gdh1BaseC: 1450,
    gdh1KappaMm2: 0.804,
    oceanMinTeKm: 2,            // a ridge's crest: the brittle lid over the magma lens, a few km (Watts 2001 §6.4: Te ~ 2–5 at ridges)
    prehistoryAgeMyr: 100,      // floor the history found already there: of unknown age, taken as old (terrain/records.js's 100)
    // The solve (flexure-gpu.js): MG-preconditioned CG to a relative residual mgTol (1e-4: ~0.1 mm a km of load; f32's floor ~1e-6), read back every
    // mgCheck iterations, at most mgMaxIter; mgSweeps damped-Jacobi sweeps a level each way at mgOmega, mgCoarseSweeps on the
    // coarsest. Numerics, not physics: they decide how close to the plate's answer, not what it is.
    mgTol: 1e-4,
    mgCheck: 4,
    mgMaxIter: 64,
    mgSweeps: 2,
    mgOmega: 0.6,
    mgCoarseSweeps: 30,
};

/** The sea's load share: sediment laid under water (ρs − ρw)/ρm, its trough filled with water (buoyancy (ρm − ρw)/ρm). */
export const seaLoadShare = (F = FLEX) => (F.sedimentRho - F.waterRho) / F.mantleRho;

const SEC_MYR = 3.15576e13;

/** Flexural rigidity (N·m) of a plate `teKm` thick elastically. */
export function rigidity(teKm, F = FLEX) { const te = teKm * 1000; return F.youngPa * te * te * te / (12 * (1 - F.poisson * F.poisson)); }

/** Flexural length α (km) of a plate `teKm` thick, over a trough filled with density `fillRho` (air 0, water, sediment). */
export function flexuralLengthKm(teKm, fillRho = 0, F = FLEX) { return 1e-3 * Math.pow(4 * rigidity(teKm, F) / ((F.mantleRho - fillRho) * 9.81), 0.25); }

/** B = D / ρm g in km⁴: the operator's stiffness for a plate `teKm` thick. */
export function stiffnessKm4(teKm, F = FLEX) { return rigidity(teKm, F) / (F.mantleRho * 9.81) * 1e-12; }

/** Depth (km) of an isotherm in GDH1's cooling plate at `ageMyr`: the plate model's series, bisected. */
export function plateIsothermKm(ageMyr, F = FLEX) {
    const a = F.gdh1PlateKm, r = F.oceanIsoC / F.gdh1BaseC, k = F.gdh1KappaMm2 * 1e-6 * Math.max(0, ageMyr) * SEC_MYR * 1e-6;   // κt in km²
    const T = z => { let s = z / a; for (let m = 1; m <= 60; m++) s += (2 / (Math.PI * m)) * Math.exp(-m * m * Math.PI * Math.PI * k / (a * a)) * Math.sin(m * Math.PI * z / a); return s; };
    let lo = 0, hi = a;
    for (let i = 0; i < 50; i++) { const m = 0.5 * (lo + hi); if (T(m) < r) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
}

// (the sea floor's Te by age, tabulated a Myr apart to 300: the series is slow and every ocean cell asks)
let oceanTable = null;
function oceanTeKm(ageMyr, F) {
    if (!oceanTable || oceanTable.F !== F) { const t = new Float64Array(301); for (let i = 0; i <= 300; i++) t[i] = Math.max(F.oceanMinTeKm, plateIsothermKm(i, F)); oceanTable = { F, t }; }
    const x = Math.max(0, Math.min(300, ageMyr)), i = Math.min(299, Math.floor(x)), f = x - i;
    return oceanTable.t[i] * (1 - f) + oceanTable.t[i + 1] * f;
}

/**
 * Te (km) on the history's mesh, from each cell's crust: a craton's, a continent's, an arc's, and the sea floor's by its age.
 * A continental cell in a belt the history still raises (frame.oroLast within `liveMyr`) is an arc's: hot and weak.
 */
export function elasticThicknessKm(frame, F = FLEX, liveMyr = 20) {
    const n = frame.type.length, te = new Float32Array(n), time = frame.time;
    for (let w = 0; w < n; w++) {
        const t = frame.type[w];
        if (frame.owner && frame.owner[w] < 0) { te[w] = F.oceanMinTeKm; continue; }        // (a gap between plates: a spreading crest)
        if (t === CrustType.OCEAN) te[w] = oceanTeKm(frame.formedAt[w] < 0 ? F.prehistoryAgeMyr : time - frame.formedAt[w], F);
        else if (t === CrustType.ARC) te[w] = F.arcTeKm;
        else {
            const live = frame.oroType && frame.oroType[w] && time - frame.oroLast[w] < liveMyr;
            te[w] = live ? F.arcTeKm : t === CrustType.CRATON ? F.cratonTeKm : F.continentTeKm;
        }
    }
    return te;
}

/**
 * The plate operator's pieces on a mesh: the finite-volume Laplacian on the mesh's Voronoi cells, (∇²f)ᵢ = (1/Aᵢ) Σⱼ (ℓᵢⱼ/dᵢⱼ)
 * (fⱼ − fᵢ), ℓᵢⱼ the Voronoi face between i and j and dᵢⱼ their distance — consistent on an irregular Delaunay mesh, where a
 * graph Laplacian (4/nᵢ Σ (fⱼ − fᵢ)/dᵢⱼ²) is not (the terrain mesh's cells have 4–8 neighbours). ℓᵢⱼ/dᵢⱼ is the cotangent
 * weight (cot a + cot b)/2 of the two triangles on the edge (the adjacency lists each cell's neighbours in ring order:
 * core/mesh-locate.js), Aᵢ = ¼ Σⱼ ℓᵢⱼ dᵢⱼ. Returns K's weights (per adjacency entry), its row sums, and M = A (km²). Kept
 * while the mesh is (WeakMap).
 */
const ops = new WeakMap();
export function plateOperator(mesh) {
    if (ops.has(mesh)) return ops.get(mesh);
    const { adjOffset, adjList, xyz, numCells: n } = mesh, wK = new Float32Array(adjList.length), rowK = new Float64Array(n), M = new Float32Array(n);
    // (the cotangent at corner k of the triangle (i, j, k): of the angle between k→i and k→j, on the chords — flat at a cell's scale)
    const cot = (i, j, k) => {
        const ux = xyz[3 * i] - xyz[3 * k], uy = xyz[3 * i + 1] - xyz[3 * k + 1], uz = xyz[3 * i + 2] - xyz[3 * k + 2];
        const vx = xyz[3 * j] - xyz[3 * k], vy = xyz[3 * j + 1] - xyz[3 * k + 1], vz = xyz[3 * j + 2] - xyz[3 * k + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        const sin = Math.hypot(cx, cy, cz);
        return sin > 1e-12 ? (ux * vx + uy * vy + uz * vz) / sin : 0;           // (a degenerate corner: no weight)
    };
    // (a cell with no area — only on a mesh whose neighbours are not in ring order, as gpuFingerprint's test patch — takes the
    // mesh's mean, so the operator stays finite there)
    const meanArea = mesh.cellAreaKm2 ?? (Math.sqrt(3) / 2) * (mesh.edgeKm ?? 1) ** 2;
    for (let c = 0; c < n; c++) {
        const a = adjOffset[c], b = adjOffset[c + 1], x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
        let s = 0, area = 0;
        for (let j = a; j < b; j++) {
            const d = adjList[j], prev = adjList[j > a ? j - 1 : b - 1], next = adjList[j + 1 < b ? j + 1 : a];
            const k = Math.max(0, 0.5 * (cot(c, d, prev) + cot(c, d, next)));
            const km = R * Math.acos(Math.max(-1, Math.min(1, x * xyz[3 * d] + y * xyz[3 * d + 1] + z * xyz[3 * d + 2])));
            wK[j] = k; s += k; area += 0.25 * k * km * km;
        }
        rowK[c] = s; M[c] = area > 0 ? area : meanArea;
    }
    const op = { wK, rowK, M };
    ops.set(mesh, op);
    return op;
}

/** A's diagonal for stiffness B (km⁴, per cell) and buoyancy s (per cell): Σⱼ Kᵢⱼ² Bⱼ/Mⱼ + (Bᵢ/Mᵢ)(Σⱼ Kᵢⱼ)² + Mᵢ sᵢ. */
export function plateDiagonal(mesh, op, B, s) {
    const { adjOffset, adjList, numCells: n } = mesh, { wK, rowK, M } = op, diag = new Float64Array(n);
    for (let c = 0; c < n; c++) {
        let v = 0;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const d = adjList[j]; v += wK[j] * wK[j] * B[d] / M[d]; }
        diag[c] = v + B[c] / M[c] * rowK[c] * rowK[c] + M[c] * s[c];
    }
    return diag;
}

/** out = A p (float64), with `t` scratch: t = (B/M) K p, then A p = K t + M s p. */
function applyA(mesh, op, B, s, p, out, t) {
    const { adjOffset, adjList, numCells: n } = mesh, { wK, M } = op;
    for (let c = 0; c < n; c++) {
        let v = 0;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) v += wK[j] * (p[adjList[j]] - p[c]);
        t[c] = B[c] / M[c] * v;
    }
    for (let c = 0; c < n; c++) {
        let v = 0;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) v += wK[j] * (t[adjList[j]] - t[c]);
        out[c] = v + M[c] * s[c] * p[c];
    }
}

/**
 * The deflection w (km, down +) of the plate under load ℓ (mantle-equivalent km), float64 Jacobi-preconditioned conjugate
 * gradients to a relative residual `tol`. `B`: stiffness per cell (stiffnessKm4 of Te); `s`: buoyancy per cell (Δρ/ρm).
 * @returns {{w: Float64Array, iterations: number, residual: number}}
 */
export function solvePlateCPU(mesh, B, s, load, { tol = 1e-8, maxIter = 20000, w0 = null } = {}) {
    const n = mesh.numCells, op = plateOperator(mesh), diag = plateDiagonal(mesh, op, B, s);
    const w = w0 ? Float64Array.from(w0) : new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n), t = new Float64Array(n);
    let bb = 0;
    for (let c = 0; c < n; c++) { const b = op.M[c] * load[c]; r[c] = b; bb += b * b; }
    if (w0) { applyA(mesh, op, B, s, w, Ap, t); for (let c = 0; c < n; c++) r[c] -= Ap[c]; }
    if (!(bb > 0)) return { w, iterations: 0, residual: 0 };
    let rz = 0;
    for (let c = 0; c < n; c++) { z[c] = r[c] / diag[c]; p[c] = z[c]; rz += r[c] * z[c]; }
    let it = 0, rr = 0;
    for (; it < maxIter; it++) {
        applyA(mesh, op, B, s, p, Ap, t);
        let pAp = 0;
        for (let c = 0; c < n; c++) pAp += p[c] * Ap[c];
        const a = rz / pAp;
        rr = 0;
        for (let c = 0; c < n; c++) { w[c] += a * p[c]; r[c] -= a * Ap[c]; rr += r[c] * r[c]; }
        if (rr <= tol * tol * bb) { it++; break; }
        let rz2 = 0;
        for (let c = 0; c < n; c++) { z[c] = r[c] / diag[c]; rz2 += r[c] * z[c]; }
        const beta = rz2 / rz;
        rz = rz2;
        for (let c = 0; c < n; c++) p[c] = z[c] + beta * p[c];
    }
    return { w, iterations: it, residual: Math.sqrt(rr / bb) };
}
