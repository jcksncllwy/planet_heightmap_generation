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
// dt ≤ 1/max_c Σ D f/(d A); ICE.cfl of it, read every ICE.batch steps, at most ICE.dtMaxYr).
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
// The scheme's one leak: a margin cell can be asked for more ice than it holds in one step (the flux's overshoot, explicit
// steps' known fault at a steep margin); it stops at zero, and the books keep what that made (`made`), so a run reports it.
//
// Determinism: the step's dt is a maximum over cells through an atomic on the float's bits (positive floats order as their
// bits: the max is the same in any order); every other pass writes only its own cell. float32 throughout.

import { pipeline, readBack } from './gpu-device.js';
import { INDEX_WGSL, dispatch, meshFields } from './fields.js';

const R_M = 6.371e6;

/** The ice's constants (each a physical quantity, sourced above). */
export const ICE = Object.freeze({
    A: 1e-16,             // Glen's rate factor, Pa⁻³ a⁻¹ (EISMINT; Huybrechts et al. 1996)
    rhoIce: 910,          // kg/m³ (Cuffey & Paterson 2010)
    rhoSea: 1028,         // kg/m³, sea water
    rhoMantle: 3300,      // kg/m³, the asthenosphere the bed sinks into (Turcotte & Schubert 2002)
    g: 9.81,
    cfl: 0.5,             // of the explicit step's stability limit: room for D to grow within a batch
    batch: 20,            // steps between reads of the limit
    dtMaxYr: 50,          // the longest step, years
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
${MAIN}
    var s = 0.0; var area = 0.0;
    for (var k = k0; k < k1; k++) {
        let b = adj[k]; let ed = edge[k]; let d = ed.w; area += d * d; let hb = H[b];
        let gb = grounded(b);
        if (flows(gc, hc, gb, hb)) { s += u.gamma * h5(hc, hb) * face2((surf(b, gb) - sc) / d, ed.xyz, G2[c].xyz, G2[b].xyz) + dslide(hc, tc, hb, thawed(b, gb)); }
    }
    atomicMax(&rmax, bitcast<u32>(s * ISQ3 / (area * 0.25 * ISQ3)));
}`,
    // (one step: the flux across each face, then the mass balance, then the open sea's ice calved; the books per cell:
    // the balance applied, the ice the flux's overshoot made, the ice calved, metres of ice)
    step: `${HEAD}
@group(0) @binding(6) var<storage, read> G2: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> Hn: array<f32>;
@group(0) @binding(8) var<storage, read_write> books: array<vec4f>;
${MAIN}
    var div = 0.0; var area = 0.0; var touched = false;
    for (var k = k0; k < k1; k++) {
        let b = adj[k]; let ed = edge[k]; let d = ed.w; area += d * d; let hb = H[b]; let gb = grounded(b);
        touched = touched || (gb && hb > 0.0);
        if (flows(gc, hc, gb, hb)) {
            let ds = surf(b, gb) - sc;
            div += (u.gamma * h5(hc, hb) * face2(ds / d, ed.xyz, G2[c].xyz, G2[b].xyz) + dslide(hc, tc, hb, thawed(b, gb))) * ds;
        }
    }
    let h1 = hc + u.dt * div * ISQ3 / (area * 0.25 * ISQ3);
    let made = max(0.0, -h1); let h2 = max(h1, 0.0);
    let h3 = max(h2 + u.dt * force[c].y, 0.0);
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
    const speedB = mk('ice speeds', 8 * n);
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
    const g = (name, list) => device.createBindGroup({ layout: P_[name].getBindGroupLayout(0), entries: list.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const G = [0, 1].map(i => ({
        grad: g('grad', [...shared, Hb[i], G2]),
        rate: g('rate', [...shared, Hb[i], G2, rmax]),
        step: g('step', [...shared, Hb[i], G2, Hb[1 - i], booksB]),
        speed: g('speed', [...shared, Hb[i], G2, speedB]),
    }));
    let cur = 0;
    const pass = (e, name) => { const p = e.beginComputePass(); p.setPipeline(P_[name]); p.setBindGroup(0, G[cur][name]); dispatch(p, n); p.end(); };
    const run = async (years, { each = null, everyYears = 0 } = {}) => {
        let t = 0, steps = 0, dt = 0, next = 0;
        while (t < years) {
            // (a mass balance on the GPU from the ice as it stands, every everyYears: its passes into the encoder, before the limit)
            if (each && t >= next) { const e = device.createCommandEncoder(); each(e); device.queue.submit([e.finish()]); next = t + everyYears; }
            // (the limit, from the ice as it stands)
            writeU(0);
            device.queue.writeBuffer(rmax, 0, new Uint32Array(1));
            let e = device.createCommandEncoder();
            pass(e, 'grad'); pass(e, 'rate');
            device.queue.submit([e.finish()]);
            const r = new Float32Array((await readBack(device, rmax, Uint32Array)).buffer)[0];
            dt = Math.min(P.dtMaxYr, r > 0 ? P.cfl / r : Infinity);
            e = device.createCommandEncoder();
            for (let i = 0; i < P.batch && t < years; i++, steps++) {
                const h = Math.min(dt, years - t);
                if (h !== dt || i === 0) { device.queue.submit([e.finish()]); writeU(h); e = device.createCommandEncoder(); }
                pass(e, 'grad'); pass(e, 'step');
                cur = 1 - cur; t += h;
            }
            device.queue.submit([e.finish()]);
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
        return { volume, balance, made, calved, start };
    };
    return {
        run, setBed, setSmb, setTsurf, readH, speeds, books, area, force: forceB, P,
        setSea: m => { seaM = m; },
        get sea() { return seaM; },
        get H() { return Hb[cur]; },
        destroy: () => { for (const b of own) b.destroy(); },
    };
}
