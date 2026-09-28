// Circulation stage: sea-level pressure and near-surface winds, derived from the temperature stage. DOM-free.
//
// Pressure has two parts, both set by the planet's own temperatures (nothing is placed at Earth's latitudes):
//  • The zonal belts — the tropical low (ITCZ), the subtropical highs, the subpolar lows, the polar highs. The ITCZ
//    sits at the warmest latitude of the sea (the tropical rain belt follows the warmest ocean); each Hadley cell
//    reaches as far as Held & Hou's scaling allows for this planet's rotation, size and equator-to-pole contrast;
//    a Ferrel cell further out lies the subpolar low; the midlatitude pressure drop grows with the temperature
//    contrast across the storm belt (stronger westerlies in winter, on colder planets).
//  • Thermal lows and highs — air over ground warmer than its latitude's average rises and leaves low pressure; over
//    colder ground it sinks and piles up (hydrostatic: the lower troposphere warmer or colder). Smoothed at the
//    scale the atmosphere responds on (the Rossby radius). Summer continents get lows and the cooler oceans beside
//    them highs (the summer highs over the eastern oceans); winter continents get highs and the oceans lows.
//
// Winds follow from pressure with surface friction: along the isobars where the Coriolis force dominates, turned
// toward low pressure by friction (more over land), and straight down the pressure gradient at the equator — one
// linear balance (f k×u + r u = −∇p/ρ) covers all three.

import { LatLonGrid, coarsenField, refineField } from './grid.js';
import { PARAMS } from './config.js';

const OMEGA_ROT = 7.292e-5;       // s⁻¹, planet's rotation (Earth-like)
const R_PLANET = 6.371e6;         // m
const G_ACC = 9.81;               // m/s²
const TROPOPAUSE_M = 15000;       // m, tropical tropopause height (Held & Hou's H)
const RHO_AIR = 1.2;              // kg/m³
const F45 = 2 * OMEGA_ROT * Math.sin(Math.PI / 4);
const DEG = Math.PI / 180;

/**
 * The circulation stage. stage(ctx, temperature) → { u, v (12 × G, m/s, east / north), slp (12 × G, hPa),
 * conv (12 × G, low-level convergence, 1/s), itczLat (12 × grid.w, degrees), belts (per month), ms }.
 * temperature.monthlySL: sea-level temperature, 12 × G (°C).
 */
export function derivedCirculation() {
    return (ctx, temperature) => {
        const t0 = performance.now();
        const P = { ...PARAMS };
        const core = ctx.grid;
        const ratio = Math.round(P.CIRC_GRID_DEG / core.step);
        const g = ratio > 1 ? new LatLonGrid(core.step * ratio) : core;
        const G = g.size, w = g.w, h = g.h;
        const land = coarsen(core, g, ratio, ctx.surface.landFrac);
        const cosLat = Float64Array.from(g.lat, l => Math.cos(l * DEG));
        const dRad = g.step * DEG;

        const U = new Float32Array(12 * core.size), V = new Float32Array(12 * core.size), SLP = new Float32Array(12 * core.size);
        const CONV = new Float32Array(12 * core.size);
        const itczLat = new Float32Array(12 * core.w);
        const belts = [];
        const T = new Float64Array(G), p = new Float64Array(G), u = new Float64Array(G), v = new Float64Array(G), cv = new Float64Array(G);
        const Tz = new Float64Array(h), Tzs = new Float64Array(h), pz = new Float64Array(G);
        const tmp = new Float64Array(G), anom = new Float64Array(G);

        // The air's warmth as the atmosphere feels it: surface temperature brought to sea level at the free air's
        // lapse rate. A sunlit plateau is far warmer than free air at its height (an elevated heat source — the
        // summer low over Tibet and South Asia); an ice sheet colder (the highs over Antarctica and Greenland).
        const freeLapse = ctx.options.lapseRateCPerKm ?? 6.5;
        const href = new Float64Array(core.size);
        for (let c = 0; c < core.size; c++) { const hr = ctx.surface.meanLandKm[c]; href[c] = hr === hr ? Math.max(0, hr) : 0; }
        const Tfree = new Float64Array(core.size);
        const sea = new Float64Array(G);
        for (let c = 0; c < G; c++) sea[c] = 1 - land[c];

        // A month's zonal picture: the air's warmth on the grid (T), its zonal means — all cells, and weighted toward the
        // sea (for the ITCZ) — the ITCZ, and each hemisphere's equator-to-pole contrast
        const zAt = (lat) => { const y = Math.max(0, Math.min(h - 1, (90 - lat) / g.step - 0.5)); const j0 = Math.floor(y), f = y - j0; return Tz[j0] * (1 - f) + Tz[Math.min(h - 1, j0 + 1)] * f; };
        const polar = (sgn) => { let s = 0, n = 0; for (let lat = 60; lat <= 80; lat += 2) { s += zAt(sgn * lat); n++; } return s / n; };
        const zonalMonth = (m) => {
            const src = temperature.monthly.subarray(m * core.size, (m + 1) * core.size);
            for (let c = 0; c < core.size; c++) Tfree[c] = src[c] + freeLapse * href[c];
            T.set(coarsen(core, g, ratio, Tfree));
            let gSum = 0, gW = 0;
            for (let j = 0; j < h; j++) {
                let s = 0, ss = 0, ws = 0;
                for (let i = 0; i < w; i++) { const c = j * w + i, sw = (1 - land[c]) + 0.02; s += T[c]; ss += T[c] * sw; ws += sw; }
                Tz[j] = s / w; Tzs[j] = ss / ws;
                gSum += Tz[j] * cosLat[j]; gW += cosLat[j];
            }
            // ITCZ: warmest latitude of the sea's zonal mean, smoothed over ~5°
            const sm = smoothProfile(g, Tzs, 5);
            let jBest = -1;
            for (let j = 0; j < h; j++) if (Math.abs(g.lat[j]) <= 30 && (jBest < 0 || sm[j] > sm[jBest])) jBest = j;
            let itcz = g.lat[jBest];
            if (jBest > 0 && jBest < h - 1) {                         // parabolic refinement (rows run north → south)
                const a = sm[jBest - 1], b = sm[jBest], c = sm[jBest + 1], den = a - 2 * b + c;
                if (den < 0) itcz = g.lat[jBest] - g.step * 0.5 * (a - c) / den;
            }
            const Titcz = zAt(itcz);
            return { Tglobal: gSum / gW, itcz, dN: Titcz - polar(1), dS: Titcz - polar(-1) };
        };
        // The Hadley cells' width follows the planet's year-round equator-to-pole contrast more than each month's (Lindzen
        // & Hou 1988: the seasonal cells are not in balance with each month's heating), so the subtropical highs move with
        // the rain belt — poleward in summer, over the west coasts at 30–40°, equatorward in winter, letting the storms
        // in (Mediterranean climates). CIRC_HADLEY_SEASONAL: the share of each month's own contrast.
        let dNyear = 0, dSyear = 0;
        if (P.CIRC_HADLEY_SEASONAL < 1) for (let m = 0; m < 12; m++) { const z = zonalMonth(m); dNyear += z.dN / 12; dSyear += z.dS / 12; }
        const sea1 = P.CIRC_HADLEY_SEASONAL, year1 = 1 - sea1;

        for (let m = 0; m < 12; m++) {
            const { Tglobal, itcz, dN, dS } = zonalMonth(m);
            // Hadley-cell half-widths (Held & Hou) from each hemisphere's equator-to-pole contrast
            const Tref = Tglobal + 273.15;
            const hadley = (dT) => {
                const delta = Math.max(0.02, dT / Tref);
                return P.CIRC_HADLEY_SCALE * Math.sqrt(5 / 3 * G_ACC * TROPOPAUSE_M * delta / (OMEGA_ROT * OMEGA_ROT * R_PLANET * R_PLANET)) / DEG;
            };
            const hwN = hadley(sea1 * dN + year1 * dNyear), hwS = hadley(sea1 * dS + year1 * dSyear);
            const hiN = Math.min(itcz + hwN, 60), hiS = Math.max(itcz - hwS, -60);
            const loN = Math.min(hiN + P.CIRC_FERREL_DEG, 82), loS = Math.max(hiS - P.CIRC_FERREL_DEG, -82);
            // pressure drops: tropical (ITCZ to the highs); midlatitude — ∝ the temperature contrast across the storm
            // belt, and larger where that belt is open sea: continents and their mountains break up the zonal flow
            const beltSea = (a, b) => {                              // sea share of the belt between latitudes a and b
                let s = 0, n = 0;
                for (let j = 0; j < h; j++) { const la = g.lat[j]; if (la < Math.min(a, b) || la > Math.max(a, b)) continue; for (let i = 0; i < w; i++) { s += sea[j * w + i] * cosLat[j]; n += cosLat[j]; } }
                return n ? s / n : 0.5;
            };
            const midN = P.CIRC_MIDLAT_HPA_PER_K * Math.max(0, zAt(hiN) - zAt(loN)) * (1 + P.CIRC_OPEN_SEA_BOOST * beltSea(hiN, loN));
            const midS = P.CIRC_MIDLAT_HPA_PER_K * Math.max(0, zAt(hiS) - zAt(loS)) * (1 + P.CIRC_OPEN_SEA_BOOST * beltSea(hiS, loS));
            belts.push({ itcz, hiN, hiS, loN, loS, midN, midS });

            // The tropical trough follows each longitude's own warmest latitude (over the sea the warmest water,
            // over a summer continent its heat low — the monsoon trough), smoothed along ~20° of longitude.
            const trough = localTrough(g, T, h, w, hiN, hiS, itcz);
            for (let i = 0; i < w; i++) {
                const knots = [
                    [-90, -midS + P.CIRC_POLAR_HPA], [loS, -midS], [hiS, 0], [trough[i], -P.CIRC_TROPICAL_HPA], [hiN, 0], [loN, -midN], [90, -midN + P.CIRC_POLAR_HPA],
                ];
                for (let j = 0; j < h; j++) pz[j * w + i] = profileAt(knots, g.lat[j]);
            }

            // ── Thermal lows and highs: temperature against its latitude's average, at the Rossby scale ──
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = j * w + i; anom[c] = T[c] - Tz[j]; }
            gaussianSmooth(g, anom, tmp, P.CIRC_ROSSBY_KM);
            let mean = 0, mw = 0;
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const c = j * w + i;
                p[c] = pz[c] - P.CIRC_THERMAL_HPA_PER_K * anom[c];
                mean += p[c] * cosLat[j]; mw += cosLat[j];
            }
            mean /= mw;
            for (let c = 0; c < G; c++) p[c] += 1011 - mean;                  // the planet's mean sea-level pressure

            // ── Winds: f k×u + r u = −∇p/ρ, friction turning more over land ──
            const tanO = Math.tan(P.CIRC_TURN_OCEAN_DEG * DEG), tanL = Math.tan(P.CIRC_TURN_LAND_DEG * DEG);
            for (let j = 0; j < h; j++) {
                const f = 2 * OMEGA_ROT * Math.sin(g.lat[j] * DEG);
                const sx = 100 / (R_PLANET * Math.max(0.05, cosLat[j]) * 2 * dRad), sy = 100 / (R_PLANET * 2 * dRad);   // hPa → Pa, centred
                for (let i = 0; i < w; i++) {
                    const c = j * w + i;
                    const px = (p[j * w + (i + 1) % w] - p[j * w + (i - 1 + w) % w]) * sx;
                    const pn = j > 0 ? p[c - w] : p[c], ps = j < h - 1 ? p[c + w] : p[c];
                    const py = (pn - ps) * sy * (j > 0 && j < h - 1 ? 1 : 2);
                    const r = F45 * (tanO + (tanL - tanO) * land[c]);
                    const d = RHO_AIR * (r * r + f * f);
                    u[c] = -P.CIRC_SURFACE_WIND * (r * px + f * py) / d;
                    v[c] = -P.CIRC_SURFACE_WIND * (r * py - f * px) / d;
                }
            }
            // low-level convergence (−divergence), for the rain belt and later the rain stage
            for (let j = 0; j < h; j++) {
                const cj = Math.max(0.05, cosLat[j]);
                for (let i = 0; i < w; i++) {
                    const c = j * w + i;
                    const dudx = (u[j * w + (i + 1) % w] - u[j * w + (i - 1 + w) % w]) / (2 * dRad * R_PLANET * cj);
                    const vn = j > 0 ? v[c - w] * cosLat[j - 1] : 0, vs = j < h - 1 ? v[c + w] * cosLat[j + 1] : 0;
                    const dvdy = (vn - vs) / (2 * dRad * R_PLANET * cj);
                    cv[c] = -(dudx + dvdy);
                }
            }
            refine(g, core, ratio, u, U, m * core.size);
            refine(g, core, ratio, v, V, m * core.size);
            refine(g, core, ratio, p, SLP, m * core.size);
            refine(g, core, ratio, cv, CONV, m * core.size);
            // the rain belt per longitude: strongest convergence within 30° of the equator (smoothed)
            itczPerLongitude(g, cv, h, w, itczLat, m, core);
        }
        return { u: U, v: V, slp: SLP, conv: CONV, itczLat, belts, surfaceShare: P.CIRC_SURFACE_WIND, ms: performance.now() - t0, source: 'derived circulation' };
    };
}

/**
 * Latitude of the tropical trough per longitude: the warmest latitude within the Hadley cells, from temperature
 * smoothed ~20° along longitude and ~5° in latitude; kept ≥ 5° inside the subtropical highs.
 */
function localTrough(g, T, h, w, hiN, hiS, zonalItcz) {
    const out = new Float64Array(w), col = new Float64Array(h);
    const sLon = 10 / g.step, rLon = Math.ceil(2 * sLon);
    const lonW = Array.from({ length: 2 * rLon + 1 }, (_, k) => Math.exp(-0.5 * ((k - rLon) / sLon) ** 2));
    for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
            let s = 0, ws = 0;
            for (let d = -rLon; d <= rLon; d++) { const wt = lonW[d + rLon]; s += T[j * w + (i + d + w) % w] * wt; ws += wt; }
            col[j] = s / ws;
        }
        const sm = smoothProfile(g, col, 5);
        const lo = Math.max(hiS + 5, -35), hi = Math.min(hiN - 5, 35);
        let best = -Infinity, bestLat = zonalItcz;
        for (let j = 0; j < h; j++) { const la = g.lat[j]; if (la < lo || la > hi) continue; if (sm[j] > best) { best = sm[j]; bestLat = la; } }
        out[i] = bestLat;
    }
    // a little smoothing along longitude so the trough is a continuous line
    const sm2 = new Float64Array(w);
    for (let i = 0; i < w; i++) { let s = 0, n = 0; for (let d = -3; d <= 3; d++) { s += out[(i + d + w) % w]; n++; } sm2[i] = s / n; }
    return sm2;
}

/** Smooth piecewise-cosine profile through (latitude, value) knots (sorted south → north). */
function profileAt(knots, lat) {
    for (let k = 1; k < knots.length; k++) {
        const [l0, v0] = knots[k - 1], [l1, v1] = knots[k];
        if (lat <= l1 || k === knots.length - 1) {
            const s = l1 > l0 ? Math.max(0, Math.min(1, (lat - l0) / (l1 - l0))) : 0;
            return v0 + (v1 - v0) * (1 - Math.cos(Math.PI * s)) / 2;
        }
    }
    return knots[knots.length - 1][1];
}

function smoothProfile(g, prof, sigmaDeg) {
    const h = g.h, out = new Float64Array(h), r = Math.ceil(2.5 * sigmaDeg / g.step);
    for (let j = 0; j < h; j++) {
        let s = 0, ws = 0;
        for (let d = -r; d <= r; d++) { const jj = j + d; if (jj < 0 || jj >= h) continue; const wt = Math.exp(-0.5 * (d * g.step / sigmaDeg) ** 2); s += prof[jj] * wt; ws += wt; }
        out[j] = s / ws;
    }
    return out;
}

/** Separable Gaussian smoothing on the sphere (σ in km): along latitude circles (wider in degrees toward the poles), then across. */
function gaussianSmooth(g, f, tmp, sigmaKm) {
    const w = g.w, h = g.h, sigDeg = sigmaKm / 111.2;
    for (let j = 0; j < h; j++) {
        const cl = Math.max(0.02, Math.cos(g.lat[j] * DEG));
        const sLon = Math.min(180, sigDeg / cl) / g.step;                      // σ in cells along the circle
        const r = Math.min(Math.floor(w / 2), Math.ceil(2.5 * sLon));
        const wt = new Float64Array(r + 1);
        let norm = 0;
        for (let d = 0; d <= r; d++) { wt[d] = Math.exp(-0.5 * (d / sLon) ** 2); norm += d ? 2 * wt[d] : wt[d]; }
        for (let i = 0; i < w; i++) {
            let s = f[j * w + i] * wt[0];
            for (let d = 1; d <= r; d++) s += (f[j * w + (i + d) % w] + f[j * w + (i - d + w * 8) % w]) * wt[d];
            tmp[j * w + i] = s / norm;
        }
    }
    const sLat = sigDeg / g.step, r = Math.ceil(2.5 * sLat);
    const wLat = new Float64Array(2 * r + 1);
    for (let d = -r; d <= r; d++) wLat[d + r] = Math.exp(-0.5 * (d / sLat) ** 2);
    for (let j = 0; j < h; j++) {
        let norm = 0;
        for (let d = -r; d <= r; d++) { const jj = j + d; if (jj >= 0 && jj < h) norm += wLat[d + r]; }
        for (let i = 0; i < w; i++) {
            let s = 0;
            for (let d = -r; d <= r; d++) { const jj = j + d; if (jj < 0 || jj >= h) continue; s += tmp[jj * w + i] * wLat[d + r]; }
            f[j * w + i] = s / norm;
        }
    }
}

function itczPerLongitude(g, cv, h, w, out, m, core) {
    const lat = new Float64Array(w);
    for (let i = 0; i < w; i++) {
        let best = -Infinity, bestLat = 0;
        for (let j = 0; j < h; j++) {
            if (Math.abs(g.lat[j]) > 30) continue;
            let s = 0, n = 0;
            for (let di = -5; di <= 5; di++) for (let dj = -1; dj <= 1; dj++) {
                const jj = j + dj; if (jj < 0 || jj >= h) continue;
                s += cv[jj * w + (i + di + w) % w]; n++;
            }
            if (s / n > best) { best = s / n; bestLat = g.lat[j]; }
        }
        lat[i] = bestLat;
    }
    // to the core grid's longitudes (nearest circulation column)
    for (let i = 0; i < core.w; i++) out[m * core.w + i] = lat[Math.min(w - 1, Math.floor(i * w / core.w))];
}

// Grid transfers (shared with the temperature stage)
const coarsen = (core, g, ratio, src) => coarsenField(core, g, ratio, src);
const refine = (g, core, ratio, src, out, offset) => refineField(g, core, ratio, src, out, offset);
