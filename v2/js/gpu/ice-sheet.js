// The ice sheet's flow on the GPU (lane iceage B2 (i), 2026-11-25): the shallow-ice approximation (SIA) on the terrain mesh,
// the ice's thickness H stepped under a surface mass balance (from the climate: B2 (ii), the degree-day kernel), the sea's
// level and the bed. It is what replaces the finish's prescribed ice (finish-ice.js: the reach rule, the plastic sheet) once
// B2 (iv) runs it to equilibrium.
//
// The physics (Hutter 1983; the EISMINT form, Huybrechts et al. 1996): an ice sheet much wider than thick deforms by the
// shear of its own weight, so its flux down the surface's slope is local,
//     ∂H/∂t = b + ∇·(D ∇s),   D = Γ H^{n+2} |∇s|^{n−1},   Γ = 2A (ρ_i g)^n / (n + 2),
// with s the surface, b the mass balance (m of ice a year), Glen's n = 3 and the rate factor A (ICE.A: EISMINT's 10⁻¹⁶ Pa⁻³ a⁻¹,
// ice at about −10 °C; Cuffey & Paterson 2010 Table 3.4 give 3.5·10⁻²⁵ s⁻¹ Pa⁻³ = 1.1·10⁻¹⁷ at −10 °C to 2.4·10⁻²⁴ (7.6·10⁻¹⁷)
// at 0 °C, so a sheet's mean ~10⁻¹⁶ with the enhancement of its fabric: E ≈ 1–5).
//
// The scheme: finite volume on the (near-hexagonal) Voronoi mesh, in the style of Mahaffy (1976). Each pair of neighbours
// trades ice across their shared face by D at the face (H from the two cells' mean, |∇s|² the face's own) times the difference of
// their surfaces; the face of a hexagon is its centres' distance over √3 and a cell's area Σ d²/(4√3) over its neighbours
// (a regular hexagon's (√3/2) d²): the face's length over the distance is 1/√3 on every face, and the flux a face carries
// leaves one cell for the other exactly, so the ice's volume is kept to float rounding (the books, below). The slope is the
// face's own, as Mahaffy's staggered grid has it: |∇s|² = (Δs/d)² across the face plus the square of the two cells' mean
// gradient along it, a cell's gradient (2/k) Σ (Δs/d) ê over its k faces (exact for a plane on a regular mesh). (The two
// cells' mean |∇s|², the first form, put a margin's cliff on every face of the cell beside it: its margin ran a cell out and
// its error did not fall with the mesh — check-ice-sheet's Halfar dome.) Explicit steps at the stability limit (Gershgorin:
// dt ≤ 1/max_c Σ D f/(d A); ICE.cfl of it every step, at most ICE.dtMaxYr — chosen on the GPU, its clock read back every
// ICE.batch steps: the CPU waits on the GPU that rarely).
//
// Sliding (the EISMINT II form, Payne et al. 2000 experiment H): where the bed is at its pressure-melting point the ice also
// slides, at u_b = B₀ τ_b, τ_b = ρ_i g H |∇s| the driving stress, B₀ = ICE.slideB (EISMINT II's 10⁻³ m a⁻¹ Pa⁻¹); its flux
// u_b H adds B₀ ρ_i g H² to D (same face, same scheme). The bed's temperature: Robin's (1955) steady column, heat conducted
// up from the ground (ICE.geoFlux, EISMINT II's 42 mW/m²) and carried down by the snow that buries it,
//     T_b = T_s + (G/k) l (√π/2) erf(H/l),   l = √(2κH/a)   (a > 0, the balance at the surface; Cuffey & Paterson 2010 §9.3),
// T_b = T_s + G H/k where the surface melts (a ≤ 0: no burial), T_s the surface's year-mean (the balance kernel's force.z, at
// most 0 °C), thawed where T_b reaches the melting point lowered by the ice's pressure (ICE.pmpKPerM). A cell slides or not
// (no partial thaw); a face slides by the share of its two cells that do. No heat from the sliding or the ice's own
// deformation (both thaw more bed in a real sheet: a reduced model's frozen bias).
//
// The sea and the front. Ice on a bed below the sea floats where it is thinner than ρ_w/ρ_i times the water's depth; floating
// ice has no bed to shear against, so the SIA doesn't hold there, and it has no shelf here: a floating cell
// · next to grounded ice is the front: it takes the grounded ice's flux (its surface the floating ice's freeboard,
//   s = sea + H (1 − ρ_i/ρ_w)) and keeps it until it is thick enough to ground, when the next cell out becomes the front —
//   the sheet advances across a sea as fast as its flux fills the water (the subgrid front of Albrecht et al. 2011, in its
//   simplest form: the cell is the front's fill);
// · anywhere else is open water: its ice (the snow that fell on it, or a front left behind) calves (the books count it).
// Ice flows between two cells only where one is grounded with ice on it, or both are grounded.
//
// Limits (a reduced model, what it skips):
// · sliding only as a linear Weertman law where the bed is thawed (below), no till, no water pressure, no effective
//   pressure (Budd et al. 1979's N): ice streams form where the bed thaws, but their width is the mesh's, not the bed's;
// · no ice shelves and no calving law at the front: a grounded front advances wherever its flux keeps up with the water's
//   depth (no Brown et al. 1982 / Benn et al. 2007 calving); floating ice away from the front is lost at once;
// · no temperature in the ice (one A everywhere), no longitudinal stress (the SIA's own: wrong over a few ice thicknesses at
//   divides, margins and steep beds), the bed fixed during a run (its isostatic sinking under the ice: B2 (iv), between runs);
// · the hexagon's face (d/√3) on the mesh's jittered cells, pentagons and heptagons alike: its error is what check-ice-sheet's
//   Halfar dome measures.
// Mass is conserved (lane iceemu E1a, 2026-11-27). An explicit step can ask a margin cell for more ice than it holds (the
// flux's overshoot at a steep margin, where the face's D is the two cells' mean H⁵: the empty cell's outflow is its full
// neighbour's). Clipping it at zero made ice from nothing: E0 measured that `made` was the whole of the grown sheets' growth
// (0.8–5.7× the accumulation, scaling with the step count). So each cell's outflow in a step is now limited to the ice it holds:
// the rate pass keeps its outflow rate (m/a), and every face's flux is scaled by its donor's share min(1, H/(dt·outflow)),
// the same factor on both sides of the face. A cell then can't go below zero, and `made` stays in the books only as
// float rounding (check-ice-sheet asserts it). This is the positivity limiter of finite-volume transport (the donor-cell
// bound; cf. Jarosch et al. 2013, who show the SIA's explicit steps lose or make mass at steep margins); it changes nothing
// where no cell runs dry within a step.
//
// Determinism: the step's dt is a maximum over cells through an atomic on the float's bits (positive floats order as their
// bits: the max is the same in any order); every other pass writes only its own cell. float32 throughout.

import { pipeline, readBack } from './gpu-device.js';
import { INDEX_WGSL, SUM_WG, dispatch, meshFields } from './fields.js';

const R_M = 6.371e6;

/** The ice's constants (each a physical quantity, sourced above). */
export const ICE = Object.freeze({
    A: 1e-16,             // Glen's rate factor, Pa⁻³ a⁻¹ (EISMINT; Huybrechts et al. 1996)
    rhoIce: 910,          // kg/m³ (Cuffey & Paterson 2010)
    rhoSea: 1028,         // kg/m³, sea water
    rhoMantle: 3300,      // kg/m³, the asthenosphere the bed sinks into (Turcotte & Schubert 2002)
    g: 9.81,
    cfl: 0.5,             // of the explicit step's stability limit (Gershgorin's bound is not tight on a jittered mesh)
    batch: 100,           // steps between reads of the GPU's clock (the balance's updates and the run's end wait on it)
    dtMaxYr: 50,          // the longest step, years
    // the semi-implicit step (E1b): 'explicit' or 'semi' (Hindmarsh & Payne 1996: D frozen at the step's start, the surface
    // solved implicitly), its step (years) and its CG's iterations a step (Jacobi-preconditioned; the residual is booked)
    scheme: 'explicit',
    semiDtYr: 5,
    semiIters: 24,
    slideB: 1e-3,         // Weertman's sliding coefficient, m a⁻¹ Pa⁻¹, where the bed is thawed (EISMINT II: Payne et al. 2000, exp. H)
    geoFlux: 0.042,       // the ground's heat flux, W/m² (EISMINT II; Pollack et al. 1993: shields 40–50, continents' mean 65)
    kIce: 2.1,            // ice's conductivity, W m⁻¹ K⁻¹ (Cuffey & Paterson 2010)
    kappaIce: 34.4,       // ice's thermal diffusivity, m²/a (1.09·10⁻⁶ m²/s: Cuffey & Paterson 2010)
    pmpKPerM: 8.7e-4,     // the melting point's fall with depth, K per m of ice (air-saturated: Cuffey & Paterson 2010)
});

/** The bed's temperature under `H` m of ice whose surface's year-mean is `Ts` °C and balance `a` m/a of ice (Robin 1955), °C,
 *  and whether it is thawed (at the pressure-melting point): the kernel's thawed(), the reference check-ice-sheet holds it to. */
export function robinBed(Ts, a, H, P = ICE) {
    const ts = Math.min(Ts, 0), gk = P.geoFlux / P.kIce;
    let tb = ts + gk * H;
    if (a > 1e-4) { const l = Math.sqrt(2 * P.kappaIce * H / a), t = 1 / (1 + 0.3275911 * H / l), v = H / l;
        const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-v * v);
        tb = ts + gk * l * 0.88622693 * erf; }
    return { tb, thawed: H > 0 && tb >= -P.pmpKPerM * H };
}

/** Γ = 2A(ρ_i g)³/5 for n = 3, m⁻³ a⁻¹ in D = Γ H⁵ |∇s|² (m²/a). */
export const glenGamma = (P = ICE) => 2 * P.A * (P.rhoIce * P.g) ** 3 / 5;

// (the bindings every kernel shares: the uniform, the mesh's neighbours and distances (m), each cell's bed and mass balance)
const HEAD = /* wgsl */`
struct U { dt: f32, gamma: f32, sea: f32, flt: f32, slide: f32, geoK: f32, kappa: f32, pmp: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> off: array<u32>;
@group(0) @binding(2) var<storage, read> adj: array<u32>;
@group(0) @binding(3) var<storage, read> edge: array<vec4f>;      // (each face's unit direction from the cell, its centres' distance m)
@group(0) @binding(4) var<storage, read> force: array<vec4f>;      // (bed m, mass balance m/a of ice, surface's year-mean °C, -)
@group(0) @binding(5) var<storage, read> H: array<f32>;
${INDEX_WGSL}
// (grounded: on land, or thick enough to stand on the sea's floor; u.flt = ρ_i/ρ_w)
fn grounded(i: u32) -> bool { let b = force[i].x; return b >= u.sea || H[i] * u.flt > u.sea - b; }
// (the surface: the ice's top on its bed, or the freeboard of a floating front)
fn surf(i: u32, g: bool) -> f32 { return select(u.sea + H[i] * (1.0 - u.flt), force[i].x + H[i], g); }
// (ice flows across a face where both cells are grounded, or one is grounded with ice on it)
fn flows(gc: bool, hc: f32, gb: bool, hb: f32) -> bool { return (gc && gb) || (gc && hc > 0.0) || (gb && hb > 0.0); }
// (the face's H⁵, from the two cells' mean: a product, not pow — WGSL's pow is undefined at 0 and differs between GPUs)
fn h5(a: f32, b: f32) -> f32 { let h = 0.5 * (a + b); let h2 = h * h; return h2 * h2 * h; }
fn erf_(v: f32) -> f32 {
    let t = 1.0 / (1.0 + 0.3275911 * abs(v));
    let y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-v * v);
    return select(-y, y, v >= 0.0);
}
// (1 where the grounded ice's bed is thawed: Robin's column against the pressure-melting point)
fn thawed(i: u32, g: bool) -> f32 {
    let h = H[i]; if (!g || h <= 0.0 || u.slide <= 0.0) { return 0.0; }
    let f = force[i]; let ts = min(f.z, 0.0); let a = f.y;
    var tb = ts + u.geoK * h;
    if (a > 1e-4) { let l = sqrt(2.0 * u.kappa * h / a); tb = ts + u.geoK * l * 0.88622693 * erf_(h / l); }
    return select(0.0, 1.0, tb >= -u.pmp * h);
}
// (the face's sliding diffusivity B₀ ρ g H², by the share of its two cells thawed)
fn dslide(hc: f32, tc: f32, hb: f32, tb: f32) -> f32 { let h = 0.5 * (hc + hb); return u.slide * 0.5 * (tc + tb) * h * h; }
const ISQ3 = 0.57735027;
// (the face's |∇s|²: its own difference across, and the cells' mean gradient along it)
fn face2(dsd: f32, e: vec3f, gc: vec3f, gb: vec3f) -> f32 { let m = 0.5 * (gc + gb); let t = m - dot(m, e) * e; return dsd * dsd + dot(t, t); }`;
const MAIN = `@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg); if (c >= arrayLength(&H)) { return; }
    let hc = H[c]; let gc = grounded(c); let sc = surf(c, gc); let tc = thawed(c, gc); let k0 = off[c]; let k1 = off[c + 1u];`;

const KERNELS = {
    // (each cell's surface gradient, over the faces ice may cross)
    grad: `${HEAD}
@group(0) @binding(6) var<storage, read_write> G2: array<vec4f>;
${MAIN}
    var g = vec3f(0.0); var m = 0u;
    for (var k = k0; k < k1; k++) {
        let b = adj[k]; let gb = grounded(b); let ed = edge[k];
        if (flows(gc, hc, gb, H[b])) { g += (surf(b, gb) - sc) / ed.w * ed.xyz; m++; }
    }
    G2[c] = vec4f(select(vec3f(0.0), 2.0 * g / f32(m), m > 0u), 0.0);
}`,
    // (the step's stability limit: each cell's Σ D f/(d A), its largest through the float's bits)
    rate: `${HEAD}
@group(0) @binding(6) var<storage, read> G2: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> rmax: atomic<u32>;
@group(0) @binding(8) var<storage, read_write> outR: array<f32>;
${MAIN}
    var s = 0.0; var area = 0.0; var o = 0.0;
    for (var k = k0; k < k1; k++) {
        let b = adj[k]; let ed = edge[k]; let d = ed.w; area += d * d; let hb = H[b];
        let gb = grounded(b);
        if (flows(gc, hc, gb, hb)) {
            let ds = surf(b, gb) - sc; let D = u.gamma * h5(hc, hb) * face2(ds / d, ed.xyz, G2[c].xyz, G2[b].xyz) + dslide(hc, tc, hb, thawed(b, gb));
            s += D; o += max(0.0, -D * ds);
        }
    }
    atomicMax(&rmax, bitcast<u32>(s * ISQ3 / (area * 0.25 * ISQ3)));
    outR[c] = o * ISQ3 / (area * 0.25 * ISQ3);
}`,
    // (one step: the flux across each face, then the mass balance, then the open sea's ice calved; the books per cell:
    // the balance applied, the ice the flux's overshoot made, the ice calved, metres of ice)
    step: `${HEAD}
@group(0) @binding(6) var<storage, read> G2: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> Hn: array<f32>;
@group(0) @binding(8) var<storage, read_write> books: array<vec4f>;
@group(0) @binding(9) var<storage, read> clock: vec4f;               // (this step's dt, the time run, the run's end, -)
@group(0) @binding(10) var<storage, read> outR: array<f32>;
// (the share of its outflow a cell may give this step: all of it, or what it holds)
fn share(i: u32, dt: f32) -> f32 { let o = dt * outR[i]; return select(1.0, H[i] / o, o > H[i]); }
${MAIN}
    let dt = clock.x; let ac = share(c, dt);
    var div = 0.0; var area = 0.0; var touched = false;
    for (var k = k0; k < k1; k++) {
        let b = adj[k]; let ed = edge[k]; let d = ed.w; area += d * d; let hb = H[b]; let gb = grounded(b);
        touched = touched || (gb && hb > 0.0);
        if (flows(gc, hc, gb, hb)) {
            let ds = surf(b, gb) - sc;
            let q = (u.gamma * h5(hc, hb) * face2(ds / d, ed.xyz, G2[c].xyz, G2[b].xyz) + dslide(hc, tc, hb, thawed(b, gb))) * ds;
            div += q * select(ac, share(b, dt), q > 0.0);
        }
    }
    let h1 = hc + dt * div * ISQ3 / (area * 0.25 * ISQ3);
    let made = max(0.0, -h1); let h2 = max(h1, 0.0);
    let h3 = max(h2 + dt * force[c].y, 0.0);
    let calved = select(0.0, h3, !gc && !touched);
    Hn[c] = h3 - calved;
    books[c] += vec4f(h3 - h2, made, calved, 0.0);
}`,
    // (each cell's speeds, m/a: the surface's by deformation (2A/(n+1)) (ρg)³ H⁴ |∇s|³ = (5/4) Γ H⁴ |∇s|³, and the bed's by
    // sliding B₀ τ_b where thawed — what a trough's erosion reads (Herman et al. 2015: erosion ∝ u_b^l))
    speed: `${HEAD}
@group(0) @binding(6) var<storage, read> G2: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> out: array<vec2f>;
${MAIN}
    let gs = length(G2[c].xyz); let h2 = hc * hc;
    out[c] = select(vec2f(0.0), vec2f(1.25 * u.gamma * h2 * h2 * gs * gs * gs, u.slide * tc * hc * gs), gc && hc > 0.0);
}`,
};

// (the step's dt from the limit the rate pass left, on the GPU: its clock advanced, the limit cleared for the next step)
KERNELS.tick = /* wgsl */`
struct T { cfl: f32, dtMax: f32, pad0: f32, pad1: f32 }
@group(0) @binding(0) var<uniform> p: T;
@group(0) @binding(1) var<storage, read_write> rmax: atomic<u32>;
@group(0) @binding(2) var<storage, read_write> clock: vec4f;
@compute @workgroup_size(1) fn main() {
    let r = bitcast<f32>(atomicLoad(&rmax));
    let dt = min(select(p.dtMax, min(p.dtMax, p.cfl / r), r > 0.0), max(0.0, clock.z - clock.y));
    clock = vec4f(dt, clock.y + dt, clock.z, clock.w + select(0.0, 1.0, dt > 0.0));
    atomicStore(&rmax, 0u);
}`;

// ── the semi-implicit step (lane iceemu E1b, 2026-11-27; Hindmarsh & Payne 1996) ──
// The explicit step's limit is the stiffest face anywhere: thick ice on a steep raw bed took the live finish's dt to 0.012 a.
// Frozen at the step's start, D makes the flux linear in the new surface, so the step is a linear solve,
//     a_c (H′_c − H_c) = dt Σ_k C_k (s′_b − s′_c),   s′ = φ H′ + o   (φ 1, o the bed where grounded; φ 1 − ρ_i/ρ_w, o the sea
// at a floating front), then the balance and the calving as the explicit step has them (the flux first: a margin's inflow
// melts in the step it arrives — the balance first left a 10–50 a step's inflow to an empty ablation cell unmelted, ~30 %
// more ice on Earth's replay), C_k the face's D (the explicit step's, both sides alike) and a_c the cell's area as the
// explicit step counts it. In y = φ H′ the matrix diag a/φ + dt ΣC, off-diagonal −dt C is symmetric and positive definite:
// conjugate gradients, Jacobi-preconditioned, on the GPU (its scalars never leave it: three passes an iteration, each
// workgroup summing the last pass's partials itself), stopped at SEMI_TOL; the CPU dispatches a few more iterations than the
// last batch's worst step took (~0.2 ms a pass at 160K even idle), up to ICE.semiIters. The frozen D is the scheme's error
// and its limit: stable far past the explicit limit (Earth's replay 50 a, ~100× it), but a nonlinear sheet can oscillate at
// a long enough step — a batch whose limited fluxes still leave a cell SEMI_BAD_M below zero is run again from its start at
// half the step, which grows back after clean batches.
// Measured (lane iceemu E1b, Upwell Dawn, 160K): Halfar's dome at 20 a matches the explicit step's error (centre 0.84 vs
// 0.82 %, mean 53.7 vs 53.6 m); Earth's replay (95 kyr, coupled) ends at 27.6 Mkm², −118 m at 20 or 50 a against the
// explicit step's 28.4 Mkm², −120 m; ~4 ms a step at ~6 iterations, ~7 ms at ~16.
// Mass and the margin: a face whose donor (its higher surface at the step's start) holds no ice carries nothing (C 0) — the
// mean-H face would otherwise draw an empty cell on a high bed below zero, the explicit step's leak in implicit form; the
// solve's face fluxes are then applied as fluxes, each scaled by its donor's share min(1, (a H + inflow) / outflow), so the
// volume is conserved to the face and a cell that would go below zero gives only what it has and receives. What a chain of
// such cells still leaves below zero is clipped and booked (`made`, a check's number).
// (a partials array's total, the same in every workgroup: a fixed stride, then a fixed tree; every thread gets it)
// (the CG's stop: the preconditioned residual r·z down by SEMI_TOL² from the step's first — each pass reads it and does nothing
// once it holds, so a step pays for the iterations it needs, up to ICE.semiIters)
// (a step that overshot: the limited fluxes still left a cell more than SEMI_BAD_M below zero — ice the scheme would make —
// the frozen D's lag at a step far past the explicit limit, where the nonlinear sheet oscillates (Earth's replay at 50 a,
// round 5: made grew to 10¹⁴ km³); the batch is run again at half the step. A sound step's clip is ~10⁻⁹ of the ice)
const SEMI_BAD_M = '1.0';
const SEMI_TOL = 1e-4, SEMI_TOL2 = (SEMI_TOL * SEMI_TOL).toExponential(3);
const CG_SUM = (...names) => `var<workgroup> sh: array<f32, ${SUM_WG}>;
var<workgroup> tot: f32;
${names.map(a => `fn total_${a}(l: u32) -> f32 {
    var v = 0.0; for (var k = l; k < arrayLength(&${a}); k += ${SUM_WG}u) { v += ${a}[k]; }
    sh[l] = v; workgroupBarrier();
    for (var k = ${SUM_WG / 2}u; k > 0u; k >>= 1u) { if (l < k) { sh[l] += sh[l + k]; } workgroupBarrier(); }
    if (l == 0u) { tot = sh[0]; }
    return workgroupUniformLoad(&tot);       // (uniform: every thread its workgroup's one total, so a pass may stop on it)
}`).join('\n')}`;
const SK = {
    // (the frozen faces: C per face (0 where the donor is empty), the diagonal, the right side, the first guess y = φ H)
    si_coef: `${HEAD}
@group(0) @binding(6) var<storage, read> G2: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> coef: array<f32>;
@group(0) @binding(8) var<storage, read_write> sys: array<vec4f>;      // (diag, rhs, φ, a)
@group(0) @binding(9) var<storage, read_write> y: array<f32>;
@group(0) @binding(10) var<storage, read_write> cnt: array<u32>;       // (the CG's iterations: this step's, the most a step took)
fn offs(i: u32, g: bool) -> f32 { return select(u.sea, force[i].x, g); }
${MAIN}
    if (c == 0u) { cnt[1] = max(cnt[1], cnt[0]); cnt[0] = 0u; }
    var sc_ = 0.0; var rhs = 0.0; var area = 0.0; let oc = offs(c, gc);
    for (var k = k0; k < k1; k++) {
        let b = adj[k]; let ed = edge[k]; let d = ed.w; area += d * d; let hb = H[b]; let gb = grounded(b);
        var C = 0.0;
        if (flows(gc, hc, gb, hb)) {
            let ds = surf(b, gb) - sc;
            let empty = (ds > 0.0 && hb <= 0.0) || (ds < 0.0 && hc <= 0.0) || (ds == 0.0 && (hb <= 0.0 || hc <= 0.0));
            C = select(u.gamma * h5(hc, hb) * face2(ds / d, ed.xyz, G2[c].xyz, G2[b].xyz) + dslide(hc, tc, hb, thawed(b, gb)), 0.0, empty);
        }
        coef[k] = C; sc_ += C; rhs += C * (offs(b, gb) - oc);
    }
    let a = area * 0.25; let phi = select(1.0 - u.flt, 1.0, gc);
    sys[c] = vec4f(a / phi + u.dt * sc_, a * hc + u.dt * rhs, phi, a);
    y[c] = phi * hc;
}`,
    // (r = rhs − A y, z = r / diag)
    si_resid: `${HEAD}
@group(0) @binding(6) var<storage, read> coef: array<f32>;
@group(0) @binding(7) var<storage, read> sys: array<vec4f>;
@group(0) @binding(8) var<storage, read> y: array<f32>;
@group(0) @binding(9) var<storage, read_write> r: array<f32>;
@group(0) @binding(10) var<storage, read_write> z: array<f32>;
@group(0) @binding(11) var<storage, read_write> p: array<f32>;
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg); if (c >= arrayLength(&H)) { return; }
    var o = 0.0; for (var k = off[c]; k < off[c + 1u]; k++) { o += coef[k] * y[adj[k]]; }
    let s = sys[c]; let rv = s.y - (s.x * y[c] - u.dt * o);
    r[c] = rv; z[c] = rv / s.x; p[c] = rv / s.x;
}`,
    // (q = A p)
    si_ax: `${HEAD}
@group(0) @binding(6) var<storage, read> coef: array<f32>;
@group(0) @binding(7) var<storage, read> sys: array<vec4f>;
@group(0) @binding(8) var<storage, read> p: array<f32>;
@group(0) @binding(9) var<storage, read_write> q: array<f32>;
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg); if (c >= arrayLength(&H)) { return; }
    var o = 0.0; for (var k = off[c]; k < off[c + 1u]; k++) { o += coef[k] * p[adj[k]]; }
    q[c] = sys[c].x * p[c] - u.dt * o;
}`,
    // (y += α p, r −= α q, z = r / diag)
    si_upd1: `@group(0) @binding(0) var<storage, read> S: array<f32>;
@group(0) @binding(1) var<storage, read> p: array<f32>;
@group(0) @binding(2) var<storage, read> q: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<storage, read_write> r: array<f32>;
@group(0) @binding(5) var<storage, read_write> z: array<f32>;
@group(0) @binding(6) var<storage, read> sys: array<vec4f>;
${INDEX_WGSL}
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg); if (c >= arrayLength(&y)) { return; }
    let a = S[1]; y[c] += a * p[c]; let rv = r[c] - a * q[c]; r[c] = rv; z[c] = rv / sys[c].x;
}`,
    // (p = z + β p)
    si_upd2: `@group(0) @binding(0) var<storage, read> S: array<f32>;
@group(0) @binding(1) var<storage, read> z: array<f32>;
@group(0) @binding(2) var<storage, read_write> p: array<f32>;
${INDEX_WGSL}
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg); if (c >= arrayLength(&p)) { return; }
    p[c] = z[c] + S[2] * p[c];
}`,
    // (a dot product's partials, each workgroup of 256 by a fixed tree)
    si_dot: `@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> part: array<f32>;
var<workgroup> sh: array<f32, ${SUM_WG}>;
@compute @workgroup_size(${SUM_WG}) fn main(@builtin(local_invocation_index) l: u32, @builtin(workgroup_id) g: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let w = g.x + g.y * nwg.x; let i = w * ${SUM_WG}u + l;
    sh[l] = select(0.0, a[i] * b[i], i < arrayLength(&a));
    workgroupBarrier();
    for (var k = ${SUM_WG / 2}u; k > 0u; k >>= 1u) { if (l < k) { sh[l] += sh[l + k]; } workgroupBarrier(); }
    if (l == 0u) { part[w] = sh[0]; }
}`,
    // (the partials summed in a fixed stride and tree into the CG's scalars S = (rz, α, β, rr, bb, worst rr/bb):
    // mode 0 rz = Σ; 1 α = rz / Σ; 2 β = Σ / rz, rz = Σ; 3 rr = Σ; 4 bb = Σ; 5 rr = Σ and the worst rr/bb kept)
    si_fin: `struct F { mode: u32, count: u32, pad0: u32, pad1: u32 }
@group(0) @binding(0) var<uniform> f: F;
@group(0) @binding(1) var<storage, read> part: array<f32>;
@group(0) @binding(2) var<storage, read_write> S: array<f32>;
var<workgroup> sh: array<f32, ${SUM_WG}>;
@compute @workgroup_size(${SUM_WG}) fn main(@builtin(local_invocation_index) l: u32) {
    var v = 0.0; for (var k = l; k < f.count; k += ${SUM_WG}u) { v += part[k]; }
    sh[l] = v;
    workgroupBarrier();
    for (var k = ${SUM_WG / 2}u; k > 0u; k >>= 1u) { if (l < k) { sh[l] += sh[l + k]; } workgroupBarrier(); }
    if (l == 0u) {
        let s = sh[0];
        if (f.mode == 0u) { S[0] = s; }
        else if (f.mode == 1u) { S[1] = select(0.0, S[0] / s, s != 0.0); }
        else if (f.mode == 2u) { S[2] = select(0.0, s / S[0], S[0] != 0.0); S[0] = s; }
        else if (f.mode == 4u) { S[4] = s; }
        else { S[3] = s; S[5] = max(S[5], select(0.0, sqrt(s) / sqrt(S[4]), S[4] > 0.0)); }
    }
}`,
    // ── the CG fused to three passes an iteration: each pass's workgroups sum the partials they need themselves (the same
    // fixed stride and tree in every workgroup, so every one reads the same scalar), and leave their own partials for the next ──
    // (q = A p, and p·q's partials)
    cg_ax: `${HEAD}
@group(0) @binding(6) var<storage, read> coef: array<f32>;
@group(0) @binding(7) var<storage, read> sys: array<vec4f>;
@group(0) @binding(8) var<storage, read> p: array<f32>;
@group(0) @binding(9) var<storage, read_write> q: array<f32>;
@group(0) @binding(10) var<storage, read_write> pq: array<f32>;
@group(0) @binding(11) var<storage, read> rz0: array<f32>;
@group(0) @binding(12) var<storage, read> rzI: array<f32>;
${CG_SUM('rz0', 'rzI')}
@compute @workgroup_size(${SUM_WG}) fn main(@builtin(local_invocation_index) l: u32, @builtin(workgroup_id) g: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let w = g.x + g.y * nwg.x; let c = w * ${SUM_WG}u + l; var v = 0.0;
    let done = total_rz0(l) <= ${SEMI_TOL2} * total_rzI(l);
    if (!done && c < arrayLength(&H)) {
        var o = 0.0; for (var k = off[c]; k < off[c + 1u]; k++) { o += coef[k] * p[adj[k]]; }
        let qc = sys[c].x * p[c] - u.dt * o; q[c] = qc; v = p[c] * qc;
    }
    sh[l] = v; workgroupBarrier();
    for (var k = ${SUM_WG / 2}u; k > 0u; k >>= 1u) { if (l < k) { sh[l] += sh[l + k]; } workgroupBarrier(); }
    if (l == 0u) { pq[w] = sh[0]; }
}`,
    // (α = rz / p·q from the partials; y += α p, r −= α q, z = r / diag, and r·z's new partials)
    cg_upd1: `
@group(0) @binding(0) var<storage, read> pq: array<f32>;
@group(0) @binding(1) var<storage, read> rz0: array<f32>;
@group(0) @binding(2) var<storage, read_write> rz1: array<f32>;
@group(0) @binding(3) var<storage, read> p: array<f32>;
@group(0) @binding(4) var<storage, read> q: array<f32>;
@group(0) @binding(5) var<storage, read_write> y: array<f32>;
@group(0) @binding(6) var<storage, read_write> r: array<f32>;
@group(0) @binding(7) var<storage, read_write> z: array<f32>;
@group(0) @binding(8) var<storage, read> sys: array<vec4f>;
@group(0) @binding(9) var<storage, read> rzI: array<f32>;
${CG_SUM('pq', 'rz0', 'rzI')}
@compute @workgroup_size(${SUM_WG}) fn main(@builtin(local_invocation_index) l: u32, @builtin(workgroup_id) g: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let w = g.x + g.y * nwg.x; let c = w * ${SUM_WG}u + l;
    let a = total_pq(l); let rz = total_rz0(l); let alpha = select(0.0, rz / a, a != 0.0);
    let done = rz <= ${SEMI_TOL2} * total_rzI(l);
    if (done) { if (l == 0u) { rz1[w] = rz0[w]; } return; }
    var v = 0.0;
    if (c < arrayLength(&y)) { y[c] += alpha * p[c]; let rv = r[c] - alpha * q[c]; r[c] = rv; let zv = rv / sys[c].x; z[c] = zv; v = rv * zv; }
    sh[l] = v; workgroupBarrier();
    for (var k = ${SUM_WG / 2}u; k > 0u; k >>= 1u) { if (l < k) { sh[l] += sh[l + k]; } workgroupBarrier(); }
    if (l == 0u) { rz1[w] = sh[0]; }
}`,
    // (β = rz′ / rz; p = z + β p)
    cg_upd2: `
@group(0) @binding(0) var<storage, read> rz0: array<f32>;
@group(0) @binding(1) var<storage, read> rz1: array<f32>;
@group(0) @binding(2) var<storage, read> z: array<f32>;
@group(0) @binding(3) var<storage, read_write> p: array<f32>;
@group(0) @binding(4) var<storage, read> rzI: array<f32>;
@group(0) @binding(5) var<storage, read_write> cnt: array<u32>;
${CG_SUM('rz0', 'rz1', 'rzI')}
@compute @workgroup_size(${SUM_WG}) fn main(@builtin(local_invocation_index) l: u32, @builtin(workgroup_id) g: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let w = g.x + g.y * nwg.x; let c = w * ${SUM_WG}u + l;
    let b0 = total_rz0(l); let b1 = total_rz1(l); let beta = select(0.0, b1 / b0, b0 != 0.0);
    if (b0 <= ${SEMI_TOL2} * total_rzI(l)) { return; }
    if (c == 0u) { cnt[0] += 1u; }
    if (c < arrayLength(&p)) { p[c] = z[c] + beta * p[c]; }
}`,
    // (r = rhs − A y, z = r / diag, p = z, and r·z's partials)
    cg_resid: `${HEAD}
@group(0) @binding(6) var<storage, read> coef: array<f32>;
@group(0) @binding(7) var<storage, read> sys: array<vec4f>;
@group(0) @binding(8) var<storage, read> y: array<f32>;
@group(0) @binding(9) var<storage, read_write> r: array<f32>;
@group(0) @binding(10) var<storage, read_write> z: array<f32>;
@group(0) @binding(11) var<storage, read_write> p: array<f32>;
@group(0) @binding(12) var<storage, read_write> rz: array<f32>;
@group(0) @binding(13) var<storage, read_write> rzI: array<f32>;
var<workgroup> sh: array<f32, ${SUM_WG}>;
@compute @workgroup_size(${SUM_WG}) fn main(@builtin(local_invocation_index) l: u32, @builtin(workgroup_id) g: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let w = g.x + g.y * nwg.x; let c = w * ${SUM_WG}u + l; var v = 0.0;
    if (c < arrayLength(&y)) {
        var o = 0.0; for (var k = off[c]; k < off[c + 1u]; k++) { o += coef[k] * y[adj[k]]; }
        let s = sys[c]; let rv = s.y - (s.x * y[c] - u.dt * o); let zv = rv / s.x;
        r[c] = rv; z[c] = zv; p[c] = zv; v = rv * zv;
    }
    sh[l] = v; workgroupBarrier();
    for (var k = ${SUM_WG / 2}u; k > 0u; k >>= 1u) { if (l < k) { sh[l] += sh[l + k]; } workgroupBarrier(); }
    if (l == 0u) { rz[w] = sh[0]; rzI[w] = sh[0]; }
}`,
    // (the solve's face fluxes, m³ over the step / the face's geometry: each cell's outflow and inflow, and its share)
    si_flux: `${HEAD}
@group(0) @binding(6) var<storage, read> coef: array<f32>;
@group(0) @binding(7) var<storage, read> sys: array<vec4f>;
@group(0) @binding(8) var<storage, read> y: array<f32>;
@group(0) @binding(9) var<storage, read_write> shr: array<vec2f>;   // (the donor's share, the cell's area as the step counts it)
fn offs(i: u32, g: bool) -> f32 { return select(u.sea, force[i].x, g); }
${MAIN}
    let s1 = y[c] + offs(c, gc); var o = 0.0; var inn = 0.0;
    for (var k = k0; k < k1; k++) {
        let b = adj[k]; let qv = u.dt * coef[k] * (y[b] + offs(b, grounded(b)) - s1);
        o += max(0.0, -qv); inn += max(0.0, qv);
    }
    let have = sys[c].w * hc + inn;
    shr[c] = vec2f(select(1.0, have / o, o > have), sys[c].w);
}`,
    // (the fluxes applied, each scaled by its donor's share; the clip booked as made; the open sea's ice calved)
    si_apply: `${HEAD}
@group(0) @binding(6) var<storage, read> coef: array<f32>;
@group(0) @binding(7) var<storage, read_write> bad: array<u32>;      // (set where the limited fluxes still left a cell over SEMI_BAD_M below zero)
@group(0) @binding(8) var<storage, read> y: array<f32>;
@group(0) @binding(9) var<storage, read> shr: array<vec2f>;
@group(0) @binding(10) var<storage, read_write> Hn: array<f32>;
@group(0) @binding(11) var<storage, read_write> books: array<vec4f>;
fn offs(i: u32, g: bool) -> f32 { return select(u.sea, force[i].x, g); }
${MAIN}
    let s1 = y[c] + offs(c, gc); var div = 0.0; var touched = false;
    for (var k = k0; k < k1; k++) {
        let b = adj[k]; let gb = grounded(b); touched = touched || (gb && H[b] > 0.0);
        let qv = u.dt * coef[k] * (y[b] + offs(b, gb) - s1);
        div += qv * select(shr[c].x, shr[b].x, qv > 0.0);
    }
    let h1 = hc + div / shr[c].y;
    let made = max(0.0, -h1); let h2 = max(h1, 0.0);
    if (made > ${SEMI_BAD_M}) { bad[0] = 1u; }
    let h3 = max(h2 + u.dt * force[c].y, 0.0);
    let calved = select(0.0, h3, !gc && !touched);
    Hn[c] = h3 - calved;
    books[c] += vec4f(h3 - h2, made, calved, 0.0);
}`,
};
Object.assign(KERNELS, SK);

// (a field written into one component of the per-cell forcing: 0 the bed, 1 the balance, 2 the surface's year-mean — the
// others left as they are, so a balance kernel's output survives a new bed and the reverse)
const PUT = /* wgsl */`
@group(0) @binding(0) var<uniform> which: vec4u;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> force: array<vec4f>;
${INDEX_WGSL}
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg); if (c >= arrayLength(&src)) { return; }
    force[c][which.x] = src[c];
}`;
KERNELS.put = PUT;

const compiled = new WeakMap();
const pipelinesOf = device => {
    if (!compiled.has(device)) compiled.set(device, (async () => Object.fromEntries(await Promise.all(Object.entries(KERNELS).map(async ([k, code]) => [k, await pipeline(device, code)]))))());
    return compiled.get(device);
};

// (each face's centres' distance (m, the chord on the sphere's radius) and each cell's area Σ d²/(4√3), once a mesh)
const geometry = new WeakMap();
/** A mesh's distances (per adjacency, m), its faces' unit directions with them (edge: 4 per adjacency) and the scheme's cell areas (m²): the area the ice's volume is counted on. */
export function iceGeometry(mesh) {
    if (!geometry.has(mesh)) {
        const n = mesh.numCells, x = mesh.xyz, K = mesh.adjList.length, dist = new Float32Array(K), edge = new Float32Array(4 * K), area = new Float64Array(n);
        for (let c = 0; c < n; c++) for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) {
            const b = mesh.adjList[k], dx = x[3 * b] - x[3 * c], dy = x[3 * b + 1] - x[3 * c + 1], dz = x[3 * b + 2] - x[3 * c + 2], l = Math.hypot(dx, dy, dz), d = R_M * l;
            dist[k] = d; area[c] += d * d / (4 * Math.sqrt(3));
            edge[4 * k] = dx / l; edge[4 * k + 1] = dy / l; edge[4 * k + 2] = dz / l; edge[4 * k + 3] = d;
        }
        geometry.set(mesh, { dist, edge, area });
    }
    return geometry.get(mesh);
}

/**
 * An ice sheet whose thickness stays on the GPU. `bed`: the ground under the ice, m against the datum the sea is given on
 * (n f32); `H`: the ice's thickness to start from, m (n f32; null: none); `smb`: the surface mass balance, m of ice a year
 * (n f32; null: none yet — a balance kernel writes `force`); `sea`: the sea's level, m.
 * @returns {Promise<{ run(years: number): Promise<{ steps: number, dt: number }>, setBed(b: Float32Array): void,
 *   setSmb(b: Float32Array): void, setTsurf(t: Float32Array): void, speeds(): Promise<Float32Array>, setSea(m: number): void, readH(): Promise<Float32Array>,
 *   books(): Promise<{ volume: number, balance: number, made: number, calved: number, start: number }>, destroy(): void }>}
 *   run: the sheet stepped `years` on; `each(encoder)`, if given, encodes a mass balance's passes from the ice as it stands
 *   (writing `force`'s balance), at the start and every `everyYears`. books: the ice's volume now and since the start, m³ — volume = start + balance + made − calved
 *   to the float's rounding.
 */
export async function iceSheetGPU(device, { mesh, bed, H = null, smb, sea = 0, P = ICE }) {
    const n = mesh.numCells, P_ = await pipelinesOf(device), M = meshFields(device, mesh), { edge, area } = iceGeometry(mesh);
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, own = [];
    const mk = (label, bytes) => { const b = device.createBuffer({ label, size: Math.max(16, bytes), usage }); own.push(b); return b; };
    const distB = mk('ice faces', 4 * edge.length), forceB = mk('ice bed+smb+Ts', 16 * n), G2 = mk('ice ∇s', 16 * n);
    const Hb = [mk('ice H', 4 * n), mk('ice H′', 4 * n)], booksB = mk('ice books', 16 * n), rmax = mk('ice rate', 4);
    const speedB = mk('ice speeds', 8 * n), clockB = mk('ice clock', 16), outB = mk('ice outflow', 4 * n);
    const tickU = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); own.push(tickU);
    device.queue.writeBuffer(tickU, 0, Float32Array.of(P.cfl, P.dtMaxYr, 0, 0));
    const uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    own.push(uniform);
    device.queue.writeBuffer(distB, 0, edge);
    const src = mk('ice put', 4 * n), which = [0, 1, 2].map(k => { const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, Uint32Array.of(k, 0, 0, 0)); own.push(b); return b; });
    const putG = which.map(w => device.createBindGroup({ layout: P_.put.getBindGroupLayout(0), entries: [w, src, forceB].map((buffer, binding) => ({ binding, resource: { buffer } })) }));
    const put = (k, a) => {
        device.queue.writeBuffer(src, 0, Float32Array.from(a));
        const e = device.createCommandEncoder(), p = e.beginComputePass();
        p.setPipeline(P_.put); p.setBindGroup(0, putG[k]); dispatch(p, n); p.end();
        device.queue.submit([e.finish()]);
    };
    const setBed = b => put(0, b), setSmb = b => put(1, b), setTsurf = t => put(2, t);
    setBed(bed);
    // (no surface temperature until a balance writes one: a bed far below freezing, frozen everywhere)
    setTsurf(new Float32Array(n).fill(-1000));
    if (smb) setSmb(smb);
    if (H) device.queue.writeBuffer(Hb[0], 0, Float32Array.from(H));
    let start = 0;
    if (H) for (let c = 0; c < n; c++) start += H[c] * area[c];
    const ub = new ArrayBuffer(32), uv = new DataView(ub);
    let seaM = sea;
    const writeU = dt => { uv.setFloat32(0, dt, true); uv.setFloat32(4, glenGamma(P), true); uv.setFloat32(8, seaM, true); uv.setFloat32(12, P.rhoIce / P.rhoSea, true);
        uv.setFloat32(16, (P.slideB ?? 0) * P.rhoIce * P.g, true); uv.setFloat32(20, (P.geoFlux ?? 0) / (P.kIce ?? 1), true); uv.setFloat32(24, P.kappaIce ?? 1, true); uv.setFloat32(28, P.pmpKPerM ?? 0, true);
        device.queue.writeBuffer(uniform, 0, ub); };
    const shared = [uniform, M.adjOffset, M.adjList, distB, forceB];
    const g = (name, list) => device.createBindGroup({ layout: P_[name].getBindGroupLayout(0), entries: list.map((buffer, binding) => buffer && ({ binding, resource: { buffer } })).filter(Boolean) });
    const G = [0, 1].map(i => ({
        grad: g('grad', [...shared, Hb[i], G2]),
        rate: g('rate', [...shared, Hb[i], G2, rmax, outB]),
        step: g('step', [...shared, Hb[i], G2, Hb[1 - i], booksB, clockB, outB]),
        speed: g('speed', [uniform, M.adjOffset, null, null, forceB, Hb[i], G2, speedB]),      // (it reads no faces: their bindings not in its layout)
    }));
    let cur = 0;
    const tickG = device.createBindGroup({ layout: P_.tick.getBindGroupLayout(0), entries: [tickU, rmax, clockB].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const pass = (e, name) => { const p = e.beginComputePass(); p.setPipeline(P_[name]); p.setBindGroup(0, G[cur][name]); dispatch(p, n); p.end(); };
    // ── the semi-implicit step's buffers and bind groups (E1b: P.scheme 'semi') ──
    const semi = P.scheme === 'semi' ? (() => {
        const K = mesh.adjList.length, parts = Math.max(1, Math.ceil(n / SUM_WG));
        const coef = mk('ice C', 4 * K), sys = mk('ice sys', 16 * n), y = mk('ice y', 4 * n), r = mk('ice r', 4 * n),
            z = mk('ice z', 4 * n), p = mk('ice p', 4 * n), q = mk('ice q', 4 * n), shr = mk('ice share', 8 * n), S = mk('ice S', 32), part = mk('ice partials', 4 * parts);
        const pqP = mk('ice p·q', 4 * parts), rzP = [mk('ice r·z', 4 * parts), mk('ice r·z′', 4 * parts)], rzI = mk('ice r·z₀', 4 * parts), cnt = mk('ice CG count', 16), bad = mk('ice overshoot', 16), Hbak = mk('ice H kept', 4 * n), booksBak = mk('ice books kept', 16 * n);
        const fins = [0, 1, 2, 3, 4, 5].map(mode => { const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); own.push(b);
            device.queue.writeBuffer(b, 0, Uint32Array.of(mode, parts, 0, 0)); return g('si_fin', [b, part, S]); });
        const dots = { pq: g('si_dot', [p, q, part]), rz: g('si_dot', [r, z, part]), rr: g('si_dot', [r, r, part]) };
        const per = [0, 1].map(i => ({
            grad: g('grad', [...shared, Hb[i], G2]),
            coef: g('si_coef', [...shared, Hb[i], G2, coef, sys, y, cnt]),
            resid: g('si_resid', [uniform, M.adjOffset, M.adjList, null, null, Hb[i], coef, sys, y, r, z, p]),
            ax: g('si_ax', [uniform, M.adjOffset, M.adjList, null, null, Hb[i], coef, sys, p, q]),
            upd1: g('si_upd1', [S, p, q, y, r, z, sys]),
            upd2: g('si_upd2', [S, z, p]),
            // (the fused CG: rz's partials ping-pong between two arrays by the iteration's parity)
            fresid: g('cg_resid', [uniform, M.adjOffset, M.adjList, null, null, null, coef, sys, y, r, z, p, rzP[0], rzI]),
            fax: [0, 1].map(j => g('cg_ax', [uniform, M.adjOffset, M.adjList, null, null, Hb[i], coef, sys, p, q, pqP, rzP[j], rzI])),
            fupd1: [0, 1].map(j => g('cg_upd1', [pqP, rzP[j], rzP[1 - j], p, q, y, r, z, sys, rzI])),
            fupd2: [0, 1].map(j => g('cg_upd2', [rzP[j], rzP[1 - j], z, p, rzI, cnt])),
            flux: g('si_flux', [uniform, M.adjOffset, M.adjList, null, forceB, Hb[i], coef, sys, y, shr]),
            apply: g('si_apply', [uniform, M.adjOffset, M.adjList, null, forceB, Hb[i], coef, bad, y, shr, Hb[1 - i], booksB]),
        }));
        const one = (pp, name, group, count = n, wg = 128) => { pp.setPipeline(P_[name]); pp.setBindGroup(0, group); dispatch(pp, count, wg); };
        const sum = (pp, dot, mode) => { one(pp, 'si_dot', dots[dot], n, SUM_WG); pp.setPipeline(P_.si_fin); pp.setBindGroup(0, fins[mode]); pp.dispatchWorkgroups(1); };
        // (one step into a pass: the balance, the frozen faces, the CG, the fluxes applied)
        const step = (pp, iters) => {
            const G_ = per[cur];
            one(pp, 'grad', G_.grad); one(pp, 'si_coef', G_.coef);
            if (P.semiFused === false) {
                one(pp, 'si_resid', G_.resid); sum(pp, 'rr', 4); sum(pp, 'rz', 0);
                for (let k = 0; k < iters; k++) { one(pp, 'si_ax', G_.ax); sum(pp, 'pq', 1); one(pp, 'si_upd1', G_.upd1); sum(pp, 'rz', 2); one(pp, 'si_upd2', G_.upd2); }
            } else {
                one(pp, 'cg_resid', G_.fresid, n, SUM_WG); sum(pp, 'rr', 4);
                for (let k = 0; k < iters; k++) { const j = k & 1; one(pp, 'cg_ax', G_.fax[j], n, SUM_WG); one(pp, 'cg_upd1', G_.fupd1[j], n, SUM_WG); one(pp, 'cg_upd2', G_.fupd2[j], n, SUM_WG); }
            }
            sum(pp, 'rr', 5);
            one(pp, 'si_flux', G_.flux); one(pp, 'si_apply', G_.apply);
            cur = 1 - cur;
        };
        return { step, S, cnt, bad, Hbak, booksBak };
    })() : null;
    let worstResid = 0, itersUsed = 0, retries = 0;
    const runSemi = async (years, { each = null, everyYears = 0 } = {}) => {
        let t = 0, steps = 0, next = 0;
        const dt0 = Math.min(P.semiDtYr, P.dtMaxYr);
        device.queue.writeBuffer(semi.S, 0, new Float32Array(8));
        // (the iterations dispatched a step: 16 at first, then a few more than the most any step of the last batch took
        // — a pass past the stop costs ~0.2 ms at 160K even idle, so the CPU trims the count; a step that hit it raises it)
        let iters = Math.min(P.semiIters, 16), dtNow = dt0, clean = 0;
        while (t < years * (1 - 1e-6)) {
            if (each && t >= next) { const e = device.createCommandEncoder(); each(e); device.queue.submit([e.finish()]); next = t + everyYears; }
            // (a batch of whole steps at one dt, no longer than the balance's interval; the last step shortened to the run's end)
            const left = years - t, dt = Math.min(dtNow, left), room = each ? Math.max(dt, Math.min(left, next - t)) : left;
            const k = Math.max(1, Math.min(P.batch, Math.floor(room / dt + 1e-6)));
            writeU(dt);
            // (the batch's start kept, so an overshooting batch can be run again at half the step)
            const cur0 = cur, e = device.createCommandEncoder();
            e.copyBufferToBuffer(Hb[cur], 0, semi.Hbak, 0, 4 * n); e.copyBufferToBuffer(booksB, 0, semi.booksBak, 0, 16 * n);
            const pp = e.beginComputePass();
            for (let i = 0; i < k; i++) semi.step(pp, iters);
            pp.end(); device.queue.submit([e.finish()]);
            if ((await readBack(device, semi.bad, Uint32Array))[0]) {
                const r = device.createCommandEncoder();
                r.copyBufferToBuffer(semi.Hbak, 0, Hb[cur0], 0, 4 * n); r.copyBufferToBuffer(semi.booksBak, 0, booksB, 0, 16 * n);
                device.queue.submit([r.finish()]); device.queue.writeBuffer(semi.bad, 0, new Uint32Array(1));
                cur = cur0; dtNow = dt / 2; retries++; clean = 0;
                if (dtNow < 1e-3) throw new Error('ice sheet: the semi-implicit step overshoots at any step');
                continue;
            }
            if (dtNow < dt0 && ++clean >= 4) { dtNow = Math.min(dt0, 2 * dtNow); clean = 0; }
            t += k * dt; steps += k;
            const used = (await readBack(device, semi.cnt, Uint32Array))[1]; device.queue.writeBuffer(semi.cnt, 4, new Uint32Array(1));
            iters = used >= iters ? Math.min(P.semiIters, 2 * iters) : Math.min(P.semiIters, used + 4);
            itersUsed = Math.max(itersUsed, used);
        }
        const Sv = await readBack(device, semi.S); worstResid = Math.max(worstResid, Sv[5]);
        return { steps, dt: dt0 };
    };
    const run = (years, opts = {}) => semi ? runSemi(years, opts) : runExplicit(years, opts);
    const runExplicit = async (years, { each = null, everyYears = 0 } = {}) => {
        let t = 0, steps = 0, dt = 0, next = 0;
        // (the GPU's clock: this step's dt, the time run, the run's end, the steps taken — every step its limit from the ice as
        // it stands (grad, rate), its dt (tick), then the step; the CPU reads the clock between batches)
        writeU(0);
        device.queue.writeBuffer(clockB, 0, Float32Array.of(0, 0, years, 0));
        device.queue.writeBuffer(rmax, 0, new Uint32Array(1));
        let per = P.batch, s0 = 0, t0 = 0;
        while (t < years * (1 - 1e-6)) {
            // (a mass balance on the GPU from the ice as it stands, every everyYears: its passes into the encoder)
            if (each && t >= next) { const e = device.createCommandEncoder(); each(e); device.queue.submit([e.finish()]); next = t + everyYears; }
            const e = device.createCommandEncoder();
            for (let i = 0; i < per; i++) {
                pass(e, 'grad'); pass(e, 'rate');
                const p = e.beginComputePass(); p.setPipeline(P_.tick); p.setBindGroup(0, tickG); p.dispatchWorkgroups(1); p.end();
                pass(e, 'step');
                cur = 1 - cur;
            }
            device.queue.submit([e.finish()]);
            const k = await readBack(device, clockB);
            t = k[1]; steps = k[3]; dt = k[0];
            // (a batch no longer than the balance's interval, at the steps' recent mean)
            const mean = steps > s0 ? (t - t0) / (steps - s0) : 0;
            per = each && mean > 0 ? Math.max(1, Math.min(P.batch, Math.ceil(everyYears / mean))) : P.batch;
            s0 = steps; t0 = t;
        }
        return { steps, dt };
    };
    const readH = () => readBack(device, Hb[cur]);
    /** Each cell's surface speed by deformation and its bed's by sliding, m/a (n × 2, interleaved), from the ice as it stands. */
    const speeds = async () => {
        writeU(0);
        const e = device.createCommandEncoder(); pass(e, 'grad'); pass(e, 'speed'); device.queue.submit([e.finish()]);
        return readBack(device, speedB);
    };
    const books = async () => {
        const h = await readH(), b = await readBack(device, booksB);
        let volume = 0, balance = 0, made = 0, calved = 0;
        for (let c = 0; c < n; c++) { const a = area[c]; volume += h[c] * a; balance += b[4 * c] * a; made += b[4 * c + 1] * a; calved += b[4 * c + 2] * a; }
        return { volume, balance, made, calved, start, residual: worstResid, retries, iterations: itersUsed };
    };
    return {
        run, setBed, setSmb, setTsurf, readH, speeds, books, area, force: forceB, P,
        setSea: m => { seaM = m; },
        setH: h => device.queue.writeBuffer(Hb[cur], 0, Float32Array.from(h)),
        get sea() { return seaM; },
        get H() { return Hb[cur]; },
        destroy: () => { for (const b of own) b.destroy(); },
    };
}
