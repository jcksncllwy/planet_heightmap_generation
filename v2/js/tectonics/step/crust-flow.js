// Lower-crustal flow (lane crustmass S3, config.crustFlow; on since S5): thick crust spreads because its hot lower crust
// flows out from under it, toward where the ground stands lower (Bird 1991; Clark & Royden 2000, "topographic ooze"). It
// replaces heights.js's gravitational collapse (a threshold, collapseKm 5, and a hand-set rate, 2000 km²/Myr) with one law:
//
//   ∂h/∂t = ∇·(K ∇s),   K = ρc g h_ch³ ÷ (12 η)
//
// h the crust's thickness, s the ground's height (the column it stands on: measure.js columnModel), h_ch the part of the
// crust hot enough to flow, η that channel's viscosity. K is plane Poiseuille flow through a channel held at both walls —
// the lithostatic pressure under a surface slope, ρc g ∇s, drives a mean velocity h_ch² ∇p ÷ 12η (Turcotte & Schubert,
// Geodynamics §6-2), the flow Clark & Royden fitted to Tibet's margins and Clark, Bush & Royden 2005 write out.
//   · h_ch from a geotherm: a steady conductive one through the column (Turcotte & Schubert §4-8): the mantle's heat flow
//     (plateHeatMantleFlow, raised under insulated mantle exactly as the strength law has it — field/stress-step.js
//     heatFlowRise), plus the crust's own heat production (plateHeatFlowRef − plateHeatMantleFlow, 20 mW/m² on
//     plateCrustRefKm of crust, Hopper & Buck 1993), decaying with depth over crustHeatDepthKm (Lachenbruch 1970). Thickened
//     crust carries its heat production with it (thickened homogeneously, England & Thompson 1984), so thick crust warms its
//     own Moho and grows its own channel; a craton's thick, cold lithosphere passes less of the mantle's heat (a conductive
//     lid: × riftLithKm ÷ cratonLithKm), so a shield has no channel and blocks the flow — the steep margin against a strong
//     block (Sichuan) emerges instead of being ruled (heights.js's "not onto a craton's core").
//   · The channel is the crust hotter than crustChannelC: where melt-weakening brings it down to a channel's viscosity
//     (700–750 °C, Beaumont et al. 2004, JGR 109 B06406: channels form only with that drop; wet quartz alone does not).
//   · η: Clark & Royden's fit is of h_ch³ ÷ η (15 km ASSUMED, 1e18 Pa s under the gentle margins — their measurement is the
//     flux, not either factor). crustChannelViscosity null carries that flux to the geotherm's own channel under Tibet's
//     ~70 km crust (crustChannelRefKm): η = 1e18 × (h_ch,Tibet ÷ 15 km)³ (~2.6e19 Pa s: Beaumont et al.'s ~1e19, Hilley et al.
//     2005's ~1e19 when the whole lower crust flows). A number sets η outright (crustmass's sensitivity rows: 1e18, 1e20, 1e21).
//
//   · Thickened crust heats slowly (config.crustChannelLag): thickening stretches the geotherm with the crust, so at first the
//     channel is only the old one thickened (f × h_ch(h₀), f = h ÷ h₀: England & Thompson 1984's homogeneous thickening), and
//     it grows toward the steady channel over the column's diffusion time τ = h² ÷ (π² κ) (its slowest conductive mode;
//     κ = crustThermalDiffusivity), timed from the belt's last activity (crust.oroLast). So an active belt keeps its relief
//     and it collapses afterwards, as Earth's orogens do (Dewey 1988: extension follows thickening by ~10–30 Myr).
//
// Solved implicitly (backward Euler, conjugate gradients on each plate's continental cells), and applied as fluxes between
// cells, so it moves crust and never makes or loses any (the heights stage's rock closure holds to the float).
// Limits (a reduced model): the geotherm's transient is one exponential from the last thickening (no heat advected by the
// flow itself, no heating of thinned crust); uniform η in the channel (no stress or temperature dependence inside it); no flow across a plate's
// boundary nor onto ocean floor (oceanic lithosphere has no crustal channel: the channel ends at the continent's edge —
// area at the free edge is the strain term's, S4); an island arc's crust takes no part; the broad uplift does not flow
// (with crustPaidRelief there is none to flow: relief is the root's face).

import { CrustType, OrogenyType } from '../model/crust.js';
import { columnModel, crustThicknessKm, LAND_SEDIMENT_LOAD_FACTOR } from '../measure.js';
import { heatFlowRise } from '../field/stress-step.js';

const G = 9.81, SEC_PER_MYR = 3.156e13;
const FIT_ETA = 1e18, FIT_CHANNEL_KM = 15;        // Clark & Royden 2000: the gentle margins' viscosity, for their assumed channel

// The depth (km) of the crustChannelC isotherm in crust `km` thick over mantle heat flow qm (mW/m²), tabulated.
const TAB_KM = 160, TAB_Q = 120;
let geoTable = null, geoKey = '';
function isothermTable(config) {
    const key = `${config.crustChannelC},${config.crustHeatDepthKm},${config.crustHeatConductivity},${config.crustSurfaceC},${config.plateHeatFlowRef},${config.plateHeatMantleFlow},${config.plateCrustRefKm}`;
    if (key === geoKey) return geoTable;
    const k = config.crustHeatConductivity, Tc = config.crustChannelC - config.crustSurfaceC;
    const qr0 = (config.plateHeatFlowRef - config.plateHeatMantleFlow) * 1e-3, hr0 = config.crustHeatDepthKm * 1e3;
    geoTable = new Float32Array((TAB_KM + 1) * (TAB_Q + 1));
    for (let i = 0; i <= TAB_KM; i++) {
        const f = i / config.plateCrustRefKm, qr = qr0 * f, hr = hr0 * Math.max(f, 1e-3), Hm = i * 1e3;
        for (let j = 0; j <= TAB_Q; j++) {
            const qm = j * 1e-3, T = z => qm * z / k + qr * hr / k * (1 - Math.exp(-z / hr));
            let z;
            if (T(Hm) < Tc) z = Hm;                    // (no crust that hot: the isotherm lies below the Moho)
            else { let lo = 0, hi = Hm; for (let it = 0; it < 40; it++) { const m = 0.5 * (lo + hi); if (T(m) < Tc) lo = m; else hi = m; } z = 0.5 * (lo + hi); }
            geoTable[i * (TAB_Q + 1) + j] = z / 1e3;
        }
    }
    geoKey = key;
    return geoTable;
}
/** The channel (km): crust `km` thick hotter than crustChannelC over mantle heat flow qm (mW/m²). */
export function channelKm(km, qm, config) {
    const t = isothermTable(config);
    const x = Math.max(0, Math.min(TAB_KM - 1e-6, km)), i = Math.floor(x), fx = x - i;
    const y = Math.max(0, Math.min(TAB_Q - 1e-6, qm)), j = Math.floor(y), fy = y - j, W = TAB_Q + 1;
    const z = (1 - fx) * ((1 - fy) * t[i * W + j] + fy * t[i * W + j + 1]) + fx * ((1 - fy) * t[(i + 1) * W + j] + fy * t[(i + 1) * W + j + 1]);
    return Math.max(0, km - z);
}
/** The channel's viscosity (Pa s): crustChannelViscosity, or Clark & Royden's flux carried to the geotherm's channel under Tibet. */
export function channelViscosity(config) {
    if (config.crustChannelViscosity != null) return config.crustChannelViscosity;
    const h = channelKm(config.crustChannelRefKm, config.plateHeatMantleFlow, config);
    return FIT_ETA * Math.pow(Math.max(h, 1e-3) / FIT_CHANNEL_KM, 3);
}

// the mantle heat each plate cell last saw, per world: module-level state keyed by plate id leaked one history's heat into the
// next in the same process (plate ids repeat), so the same seed did not replay (crustmass S5 gate, 2026-11-11)
const heatByWorld = new WeakMap();

/**
 * Lower-crustal flow over every plate for dt (Myr): the thickness (rootKm) of continental and craton cells moves down the
 * ground's slope at K (above). @returns {number} crust moved (km³, gross one-way), for the budget
 */
export function flowCrust(world, dt, H) {
    const { mesh, plates, config } = world, { adjOffset, adjList, edgeKm, numCells } = mesh;
    const C = columnModel(H), eta = channelViscosity(config), cellKm2 = mesh.cellAreaKm2 ?? 4 * Math.PI * 6371 * 6371 / numCells;
    // K in km²/Myr per km³ of channel: ρc g h³ ÷ 12η, h in m → m²/s → km²/Myr
    const kPerKm3 = H.riftCrustRho * G * 1e9 / (12 * eta) * SEC_PER_MYR / 1e6;
    const coef = dt * (2 / 3) / (edgeKm * edgeKm);      // (hexagonal-lattice Laplacian, as the heights' smoothing)
    const lid = H.riftLithKm / H.cratonLithKm;
    // the mantle's heat under each plate cell: world.mantleHeat at the world cell it shows at (a hidden cell keeps its last)
    let heatMap = heatByWorld.get(world); if (!heatMap) heatByWorld.set(world, heatMap = new Map());
    const heatOf = p => { let a = heatMap.get(p.id); if (!a) heatMap.set(p.id, a = new Float32Array(numCells)); return a; };
    if (world.mantleHeat) for (let w = 0; w < numCells; w++) { const p = plates[world.owner[w]]; if (p) heatOf(p)[world.ownerCell[w]] = world.mantleHeat[w]; }
    let moved = 0, iters = 0;
    for (const plate of plates) {
        if (!plate.alive || plate.crust.count === 0) continue;
        const crust = plate.crust, { mask, type, rootKm, upliftKm, baseKm, basinFillKm, oroType, oroLast } = crust, heat = heatOf(plate);
        // the plate's continental cells, and each one's channel conductance and ground height
        const cells = [];
        for (let c = 0; c < mask.length; c++) if (mask[c] && (type[c] === CrustType.CONTINENT || type[c] === CrustType.CRATON)) cells.push(c);
        const m = cells.length;
        if (m < 2) continue;
        const loc = localIndex(mask.length);
        const K = new Float64Array(m), s = new Float64Array(m), sl = new Float64Array(m);
        for (let i = 0; i < m; i++) {
            const c = cells[i], t = type[c];
            loc[c] = i + 1;
            const km = crustThicknessKm(H, t, rootKm[c], upliftKm[c], baseKm[c]);
            const qm = (config.plateHeatMantleFlow + heatFlowRise(heat[c], config)) * (t === CrustType.CRATON ? lid : 1);
            let h = channelKm(km, qm, config);
            const h0 = C.crust[t];
            if (config.crustChannelLag && km > h0 && oroType[c] !== OrogenyType.NONE && oroType[c] !== OrogenyType.RIFT) {
                const tau = km * km * 1e6 / (Math.PI * Math.PI * config.crustThermalDiffusivity) / SEC_PER_MYR;
                const start = Math.min(km, km / h0 * channelKm(h0, qm, config));
                h += (start - h) * Math.exp(-Math.max(0, world.time - oroLast[c]) / tau);
            }
            K[i] = kPerKm3 * h * h * h;
            sl[i] = C.slope[t];
            s[i] = C.ref[t] + C.slope[t] * rootKm[c] + Math.max(0, upliftKm[c]) + baseKm[c] + basinFillKm[c] / LAND_SEDIMENT_LOAD_FACTOR;
        }
        // edges (CSR): the channel's conductance between two cells in series, its harmonic mean (none where either has no channel)
        const off = new Int32Array(m + 1), nbs = [], as = [];
        let any = false;
        for (let i = 0; i < m; i++) {
            const c = cells[i];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const j = loc[adjList[k]] - 1;
                if (j < 0 || !(K[i] > 0) || !(K[j] > 0)) continue;
                const a = coef * 2 * K[i] * K[j] / (K[i] + K[j]);
                if (a > 1e-12) { nbs.push(j); as.push(a); any = true; }
            }
            off[i + 1] = nbs.length;
        }
        for (let i = 0; i < m; i++) loc[cells[i]] = 0;
        if (!any) continue;
        // backward Euler on s: s_i ÷ slope_i + Σ a_ij (s_i − s_j) = s_i,old ÷ slope_i (symmetric, positive definite)
        const x = solve(m, off, nbs, as, sl, s);
        iters += x.iters;
        // applied as fluxes between cells: whatever the solve's last digits, crust is only moved
        for (let i = 0; i < m; i++) {
            let d = 0;
            for (let e = off[i]; e < off[i + 1]; e++) d += as[e] * (x.s[nbs[e]] - x.s[i]);
            rootKm[cells[i]] += d;
            if (d > 0) moved += d;
        }
    }
    world.budget.crustFlowKm3 = (world.budget.crustFlowKm3 ?? 0) + moved * cellKm2;
    world.budget.crustFlowIters = (world.budget.crustFlowIters ?? 0) + iters;
    return moved * cellKm2;
}

let locBuf = null;
function localIndex(n) { if (!locBuf || locBuf.length !== n) locBuf = new Int32Array(n); return locBuf; }

/** Jacobi-preconditioned conjugate gradients for (D + L) x = D s0, D = 1/slope, L the edges' Laplacian; starts from s0. */
function solve(m, off, nbs, as, sl, s0) {
    const x = Float64Array.from(s0), r = new Float64Array(m), z = new Float64Array(m), p = new Float64Array(m), q = new Float64Array(m), dg = new Float64Array(m);
    const Ax = (v, out) => { for (let i = 0; i < m; i++) { let a = v[i] / sl[i]; for (let e = off[i]; e < off[i + 1]; e++) a += as[e] * (v[i] - v[nbs[e]]); out[i] = a; } };
    let bn = 0;
    for (let i = 0; i < m; i++) { let d = 1 / sl[i]; for (let e = off[i]; e < off[i + 1]; e++) d += as[e]; dg[i] = d; bn += (s0[i] / sl[i]) ** 2; }
    Ax(x, q);
    let rz = 0;
    for (let i = 0; i < m; i++) { r[i] = s0[i] / sl[i] - q[i]; z[i] = r[i] / dg[i]; p[i] = z[i]; rz += r[i] * z[i]; }
    const tol = 1e-20 * bn;
    let it = 0;
    for (; it < 500; it++) {
        let rr = 0;
        for (let i = 0; i < m; i++) rr += r[i] * r[i];
        if (rr <= tol) break;
        Ax(p, q);
        let pq = 0;
        for (let i = 0; i < m; i++) pq += p[i] * q[i];
        const al = rz / pq;
        let rz2 = 0;
        for (let i = 0; i < m; i++) { x[i] += al * p[i]; r[i] -= al * q[i]; z[i] = r[i] / dg[i]; rz2 += r[i] * z[i]; }
        const be = rz2 / rz; rz = rz2;
        for (let i = 0; i < m; i++) p[i] = z[i] + be * p[i];
    }
    return { s: x, iters: it };
}
