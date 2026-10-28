// A rifted margin's cross-section (2026-10-28): where its shoreline, shelf break and slope lie, from how the crust thinned.
//
// The history keeps a rifted margin's continental crust at full thickness right to its rift line, where the new ocean
// began: the continent–ocean boundary (COB). On Earth that crust thins toward the COB across a zone 150–400 km wide — a
// proximal domain barely stretched, a necking zone where the crust thins from ~30 to ~10 km, a distal, hyperextended one
// tapering to nothing (Péron-Pinvidic et al. 2013, Mar. Pet. Geol. 43: 21–47) — and thinned crust stands lower by
// isostasy: at once as it stretches, and more as its heated lithosphere cools after (McKenzie 1978, EPSL 40: 25–32):
//
//     S = Si (1 − 1/β) + E0 (β/π) sin(π/β) (1 − e^(−t/τ))         (water-loaded; Si, E0 from the densities below)
//
// So the COB lies far offshore, at the foot of the slope, and about a fifth of the continental crust is under the sea.
// Here 1/β, the crust's share of its old thickness, is a smoothstep of the distance x from the COB over the zone's width
// W (terrain-config.js marginThinKm: narrower on a craton's cold, strong lithosphere — Buck 1991), and the margin's
// surface is the land's own height (its platform, the mantle's swell, its belts, as the terrain builds them) less S — so
// its shoreline is where that crosses the sea: a high rift shoulder still stands above it, a low platform does not.
//
// Sediment shed from the continent fills the drowned crust to a graded shelf: from the shore down to the break at
// shelfEdgeKm, prograding seaward as it comes (its supply: the continent's denudation, cfg.denudationKmPerMyr, over the
// margin's age), each km³ of it sinking the crust further under its weight (Airy: the fill is (ρm − ρw)/(ρm − ρs) ≈ 2.5
// times the water it replaces), as far as the end of the necking zone, beyond which the crust falls away to the distal
// basin and the sediment bypasses down the slope (the shelf break stands over the necking zone: Péron-Pinvidic et al.
// 2013). The slope below the break is the prism's front, at the continental slope's gradient (cfg.clinoformGradient),
// down to the sea floor beside the margin. A young margin has no prism yet: a narrow shelf and the thinned crust falling
// away beneath the sea (the Red Sea); a mature one, its shelf the width of its proximal and necking domains.
//
// Everything here is in units of W (u = x / W), so a margin's shoreline and break scale with its width and the tables
// are built once per set of constants.

import { flexuralLengthKm } from './cratons.js';
import { columnModel } from '../tectonics/measure.js';
import { CrustType } from '../tectonics/model/crust.js';

const smooth01 = u => { const t = u <= 0 ? 0 : u >= 1 ? 1 : u; return t * t * (3 - 2 * t); };
const M_STEPS = 20, U_STEPS = 200;
let cache = null;

/** The constants of the model (km), from the densities and temperatures in cfg. */
export function marginConstants(cfg) {
    const key = [cfg.riftCrustKm, cfg.riftLithKm, cfg.riftMantleRho, cfg.riftCrustRho, cfg.riftSedRho, cfg.seaRho, cfg.riftExpansion, cfg.riftMantleC, cfg.marginNeckCrustKm, cfg.oceanCrustRho, cfg.shelfEdgeKm].join();
    if (cache?.key === key) return cache;
    const rm = cfg.riftMantleRho, rc = cfg.riftCrustRho, rw = cfg.seaRho, rs = cfg.riftSedRho, aT = cfg.riftExpansion * cfg.riftMantleC, tc = cfg.riftCrustKm, a = cfg.riftLithKm;
    // McKenzie (1978): the initial subsidence at β → ∞ and the thermal subsidence's scale, water-loaded (km)
    const Si = a * ((rm - rc) * (tc / a) * (1 - aT * tc / (2 * a)) - aT * rm / 2) / (rm * (1 - aT) - rw);
    const E0 = 4 * a * rm * aT / (Math.PI * Math.PI * (rm - rw));
    // above the sea the load is air, not water: the same crust stands this share as far down (and a depth below the sea
    // is the dry depth ÷ this); sediment in place of water sinks the crust this many times as far as the water it fills
    const fAir = (rm * (1 - aT) - rw) / (rm * (1 - aT)), kSed = (rm - rw) / (rm - rs);
    // the end of the necking zone: the crust thinned to marginNeckCrustKm
    let uNeck = 0;
    for (let i = 0, d = cfg.marginNeckCrustKm / tc; i <= 1000; i++) if (smooth01(i / 1000) >= d) { uNeck = i / 1000; break; }
    // where the history's crust edge lies across the zone (u): the history keeps a continent's area, not its thickness, so
    // its edge is where the crust would end at full thickness — the zone's crust, ∫ 1/β du, gathered against its hinge
    // (u = 1); the true COB lies that far beyond it, under the sea (crust volume kept through the stretching)
    let held = 0;
    for (let i = 0; i < 1000; i++) held += smooth01((i + 0.5) / 1000) / 1000;
    const uEdge = 1 - held;
    const C = { key, Si, E0, fAir, kSed, uNeck, uEdge, uShore: new Float64Array(M_STEPS + 1), fill: [] };
    // per maturity: the datum shoreline of a lowland platform (an ordinary continent's column as formed — the same
    // crust, lithosphere and densities: tectonics/measure.js columnModel), and the sediment it takes (per km of
    // margin, ÷ W: km) to fill the shelf from it seaward to each u, down to the necking zone's end
    const P = columnModel(cfg).ref[CrustType.CONTINENT], db = -cfg.shelfEdgeKm;
    for (let i = 0; i <= M_STEPS; i++) {
        const m = i / M_STEPS;
        let uS = 1;
        for (let j = 0; j <= 2000; j++) { const u = 0.5 + 0.5 * j / 2000; if (P - fAir * subsidence(C, u, m) >= 0) { uS = u; break; } }
        C.uShore[i] = uS;
        const F = new Float64Array(U_STEPS + 1), du = (uS - uNeck) / U_STEPS;
        for (let j = 1; j <= U_STEPS; j++) {
            const u = uS - (j - 0.5) * du, top = -db * (uS - u) / Math.max(1e-6, uS - uNeck), bed = Math.max(-1e3, P - subsidence(C, u, m));
            F[j] = F[j - 1] + (top > bed ? C.kSed * (top - bed) * du : 0);
        }
        C.fill.push(F);
    }
    return (cache = C);
}

/** McKenzie's subsidence (km, water-loaded) at u = x / W across a margin of maturity m = 1 − e^(−t/τ). */
export function subsidence(C, u, m) {
    const d = smooth01(u);                                                  // 1/β, the crust's share of its thickness
    if (d >= 1) return 0;
    const r = d <= 1e-9 ? 1 : (Math.sin(Math.PI * d) / (Math.PI * d));      // (β/π) sin(π/β)
    return C.Si * (1 - d) + C.E0 * r * m;
}

/**
 * A rifted margin's cross-section: the datum shoreline and the shelf break (km from the COB), for its thinned width W
 * (km), maturity m and the sediment it has received (km² per km of margin; Infinity: all it can hold).
 */
export function riftedMargin(C, W, m, sedKm2, out) {
    // (km from the COB; the caller moves them to the history's crust edge, C.uEdge × W landward of it)
    const fi = Math.min(M_STEPS, Math.max(0, m * M_STEPS)), i0 = Math.floor(fi), i1 = Math.min(M_STEPS, i0 + 1), f = fi - i0;
    const uS = C.uShore[i0] + f * (C.uShore[i1] - C.uShore[i0]);
    // how far the prism has built out: the u where the fill it takes reaches the sediment it has (both maturities' tables)
    const v = sedKm2 / Math.max(1, W), at = F => {
        if (!(v < F[U_STEPS])) return U_STEPS;
        let lo = 0, hi = U_STEPS;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (F[mid] > v) hi = mid; else lo = mid; }
        return lo + (v - F[lo]) / Math.max(1e-12, F[hi] - F[lo]);
    };
    const j = (1 - f) * at(C.fill[i0]) + f * at(C.fill[i1]);
    out[0] = W * uS;
    out[1] = W * (uS - (uS - C.uNeck) * j / U_STEPS);
    return out;
}

/** A passive margin's coastal plain (km): where the shelf's sediment load bends the land behind it down — the flexural
 *  moat, out to its first node 3πα/4 (Watts 2001) — for an elastic thickness by its maturity (cfg.marginElasticKm). */
export function flexuralPlainKm(cfg, m) {
    const [young, mature] = cfg.marginElasticKm;
    return 0.75 * Math.PI * flexuralLengthKm(young + (mature - young) * m);
}
