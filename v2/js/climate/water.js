// The land's water ledger (lane water, 2026-11-06; model review U1): one account of what each place's rain becomes —
//   P = E + R + ΔS,   S the snow kept from year to year (a snowfield's, an ice sheet's accumulation), month by month
// through a year in its round (the soil's and the snowpack's seasonal stores fill and empty within it, so over the year
// only the kept snow is storage). The finish's runoff, rivers' seasons and lakes, the ice's discharge and the timeline's
// basin estimate all read it; the climate's own rain stage (rain.js) evaporates the land by the same potential
// evaporation (Priestley–Taylor) and closes against it (finish stats.waterLedger).
//
//  · Snow: each month below 0 °C falls as snow, the others as rain; the snow melts in months above freezing,
//    SNOW_MELT_MM_PER_C a month per °C (≈ 4 mm/day/°C, Braithwaite 2008, J. Glaciol. 54: 437 — the climate's own
//    MELT_MM_PER_C_MONTH, rain.js). Three years from bare ground: the pack settles into its round; what the third year
//    adds to it is kept (a store that never melts: no liquid water from it, and none of its rivers or lakes).
//  · The year's split of the liquid water (rain + melt) between the air and the rivers: Budyko's curve in Fu's form,
//    E = L (1 + Ep/L − (1 + (Ep/L)^ω)^{1/ω}), with Ep the climate's Priestley–Taylor potential evaporation and ω = 2.6
//    (Earth's catchments' mean, Zhang et al. 2004; Turc–Pike's ν = 2, the climate's own land law, is ω ≈ 2.7 — Yang et
//    al. 2008). Measured on the finished ground (tools/water-study.mjs, 3 seeds × 2 moments): its land evaporation is
//    0.97–1.01 of the climate's own (Eland), the books within ±1.3 %. A monthly bucket of the climate's own law (Turc–Pike
//    each month, the soil spilling over when full) evaporates ~8 % more than the climate did and runs off only 0.23–0.30
//    of the rain: monthly means lose the storms within the month, which make most of the runoff (Milly 1994, WRR 30:
//    2143) — the annual curve keeps them, so the year's split is Budyko's and the months only time it.
//  · The months: each month's evaporation k·Ep_m, at most the water the ground then holds (the month's liquid and the
//    soil's store, up to SOIL_MM), k set so the year's evaporation is Budyko's; what the full soil cannot hold runs off,
//    a share of it (baseShare) through the ground, which drains back to the rivers slowly (e-folding baseMonths).
//  · What it skips: the month's mean temperature only (a month a little below freezing on the mean has thawing days —
//    positive degree-days from the monthly spread, Braithwaite 1985); snow's sublimation and drift; frozen soil (water
//    infiltrates and evaporates as in summer); no store carried between years but the kept snow; lakes and wetlands
//    evaporate as their land does here (the lakes' extra loss, open water's over the land's, is the hollows', finish-basins.js).
//
// Soil: SOIL_MM, the plant-available water a root zone holds, ≈ 150 mm (Manabe 1969, Mon. Wea. Rev. 97: 739, the
// bucket's 15 cm; global mean plant-available capacity ≈ 100–200 mm). The cover reads it (finish-config.js COVER.soilMm).
// The climate's own rain stage keeps its tuned RAIN_SOIL_MM (87.5 mm within that range, fitted with the Köppen zones —
// tuning/climate): its bucket sets how much the land evaporates back into the air, the ledger's only when.

import { dailyInsolation, declination } from './insolation.js';
import { PARAMS } from './config.js';

// Priestley–Taylor (1972): a wet surface evaporates α·Δ/(Δ + γ) of its net radiation, α = 1.26; the net radiation the
// sunlight reaching the ground (SURFACE_SW of the top of the air's, clouds and air), less what it reflects (land, snow)
// and its net longwave loss. The climate's land (rain.js) and the timeline's zonal estimate (zonalPET) both use it.
export const LATENT = 2.5e6;                         // J/kg, latent heat of vaporisation
export const PT_ALPHA = 1.26;                        // Priestley–Taylor coefficient
export const SURFACE_SW = 0.55;                      // share of the top-of-atmosphere sunlight reaching the ground (clouds, air)
export const NET_LW = 50;                            // W/m², net longwave the ground loses
export const ALBEDO_LAND = 0.15, ALBEDO_SNOW = 0.6;
/** The slope Δ (hPa/K) of the saturation vapour pressure at air temperature T (°C) — Clausius–Clapeyron in Magnus'
 * form. Priestley–Taylor evaporates Δ/(Δ + γ) of the net radiation (γ = PSYCHRO: ~0.4 at 0 °C, ~0.6 at 15 °C, ~0.75 at
 * 25 °C); the finish's ice age cools its potential evaporation by it (finish-ice.js). */
export const PSYCHRO = 0.66;
export function satSlope(T) {
    const tc = Math.max(-40, Math.min(45, T)), es = 6.112 * Math.exp(17.67 * tc / (tc + 243.5));
    return es * 17.67 * 243.5 / ((tc + 243.5) ** 2);
}

/**
 * The year's Priestley–Taylor potential evaporation (mm) of land at latitude `latDeg` with a zonal annual temperature Tc
 * (°C) — the rain stage's law (rain.js eLand) where only that is known (the timeline's basin estimate,
 * terrain/basin-estimate.js). Its months: the climate's daily-mean insolation at mid-month, and its seasons the
 * temperature stage's own land response to the year's harmonic of the absorbed sunlight, F̂ / (B + K + iωC) (B the
 * outgoing heat per degree, K the land column's exchange with its surroundings, C its heat capacity: config.js
 * TEMP_OLR_B, TEMP_LOCAL_K, TEMP_LAND_HEAT_CAP; temperature.js). Each month's snow (its albedo) and Δ/(Δ + γ) at that
 * month's temperature. What it skips: continentality and the sea's moderation (one land response for every place), the
 * air's dryness (as the climate's own), and the year's later harmonics.
 */
export function zonalPET(latDeg, Tc, tiltDeg = 23.44) {
    const phi = latDeg * Math.PI / 180, Q = new Float64Array(12);
    let a = 0, b = 0;
    for (let m = 0; m < 12; m++) {
        Q[m] = dailyInsolation(phi, declination(m + 0.5, tiltDeg));
        const t = 2 * Math.PI * (m + 0.5) / 12;
        a += Q[m] * Math.cos(t) / 6; b += Q[m] * Math.sin(t) / 6;
    }
    // (the seasons: T' = Re[F̂ e^{iωt} / (B + K + iωC)], F̂ = (1 − albedo)(a − ib))
    const absorbed = 1 - PARAMS.TEMP_ALBEDO, re = PARAMS.TEMP_OLR_B + PARAMS.TEMP_LOCAL_K, im = 2 * Math.PI / (365.25 * 86400) * PARAMS.TEMP_LAND_HEAT_CAP;
    const d = re * re + im * im, fr = absorbed * a, fi = -absorbed * b, xr = (fr * re + fi * im) / d, xi = (fi * re - fr * im) / d;
    let e = 0;
    for (let m = 0; m < 12; m++) { const t = 2 * Math.PI * (m + 0.5) / 12; e += pt(Q[m], Tc + xr * Math.cos(t) - xi * Math.sin(t)); }
    return e;
}

/** A month's Priestley–Taylor potential evaporation (mm) of land under daily-mean sunlight Q (W/m², top of the air) at
 *  T (°C): the rain stage's law (rain.js eLand), its snow (albedo) by the month's temperature. */
function pt(Q, T) {
    const snow = Math.min(1, Math.max(0, (2 - T) / 4)), alb = ALBEDO_LAND + (ALBEDO_SNOW - ALBEDO_LAND) * snow;
    const slope = satSlope(T), rn = Math.max(0, SURFACE_SW * (1 - alb) * Q - NET_LW);
    return PT_ALPHA * slope / (slope + PSYCHRO) * rn / LATENT * (30.44 * 86400);
}

/** Month m's (0 = January) potential evaporation (mm) at latitude latDeg and temperature T — pt at mid-month. */
export function monthPET(latDeg, m, T, tiltDeg = 23.44) {
    return pt(dailyInsolation(latDeg * Math.PI / 180, declination(m + 0.5, tiltDeg)), T);
}

/** zonalPET from a table (1° of latitude × 1 °C, −50…45 °C; bilinear) — built once per tilt: the basin estimate reads it
 *  for every cell of every frame. */
let petTable = null;
export function zonalPETAt(latDeg, Tc, tiltDeg = 23.44) {
    if (petTable?.tilt !== tiltDeg) {
        const v = new Float32Array(91 * 96);
        for (let i = 0; i <= 90; i++) for (let k = 0; k < 96; k++) v[i * 96 + k] = zonalPET(i, k - 50, tiltDeg);
        petTable = { tilt: tiltDeg, v };
    }
    const y = Math.min(90, Math.abs(latDeg)), x = Math.max(0, Math.min(95, Tc + 50));
    const i = Math.min(89, Math.floor(y)), k = Math.min(94, Math.floor(x)), fy = y - i, fx = x - k, v = petTable.v;
    return (1 - fy) * ((1 - fx) * v[i * 96 + k] + fx * v[i * 96 + k + 1]) + fy * ((1 - fx) * v[(i + 1) * 96 + k] + fx * v[(i + 1) * 96 + k + 1]);
}

export const SNOW_MELT_MM_PER_C = 120;      // mm a month per °C above freezing (Braithwaite 2008: ≈ 4 mm/day/°C)
export const SOIL_MM = 150;                 // mm, the soil's plant-available water (Manabe 1969)

/** Budyko's curve (Fu): the year's evaporation (mm) from liquid water L with potential evaporation Ep, Fu's ω. */
export function fuEvaporation(L, Ep, w) {
    if (!(L > 0)) return 0;
    if (!(Ep > 0)) return 0;
    const f = Ep / L;
    return Math.min(L, Math.max(0, L * (1 + f - (1 + f ** w) ** (1 / w))));
}

/**
 * A place's snow through its year: liquid water (rain + melt) month by month into `liq` (12), and the snow its year
 * keeps (mm; returned). T12 at the place's own height (°C), P12 its rain (mm, ≥ 0).
 */
export function snowYear(T12, P12, liq, meltPerC = SNOW_MELT_MM_PER_C) {
    let snow = 0, start = 0;
    for (let cyc = 0; cyc < 3; cyc++) {
        if (cyc === 2) start = snow;
        for (let m = 0; m < 12; m++) {
            const T = T12[m], P = P12[m];
            if (T < 0) { snow += P; if (cyc === 2) liq[m] = 0; continue; }
            const melt = Math.min(snow, meltPerC * T);
            snow -= melt;
            if (cyc === 2) liq[m] = P + melt;
        }
    }
    return Math.max(0, snow - start);
}

/**
 * The months of a place's water: from its liquid water `liq` (12, snowYear's), its potential evaporation Ep12 (12, mm)
 * and the year's evaporation E (mm, Budyko's), the runoff of each month into `R` (12: the quick share and the ground's
 * drainage) and the evaporation into `E12` (12). Three years from a half-full soil, the third kept. The year's runoff is
 * Σliq − E (to rounding): the bisection finds the k with Σ min(k·Ep_m, held) = E.
 * @param {{soilMm: number, baseShare: number, baseMonths: number}} o  the soil's capacity, the share of the spill that
 *        goes through the ground and its drainage time (months)
 */
export function waterMonths(liq, Ep12, E, o, R, E12) {
    let L = 0, EpY = 0;
    for (let m = 0; m < 12; m++) { L += liq[m]; EpY += Ep12[m]; }
    R.fill(0); E12.fill(0);
    if (!(L > 0)) return;
    const Smax = o.soilMm, drain = 1 - Math.exp(-1 / o.baseMonths), base = o.baseShare;
    // (the year's evaporation of a demand k·Ep, run through the soil: three years, the third's)
    const year = (k, keep) => {
        let S = 0.5 * Smax, G = 0, e = 0;
        for (let cyc = 0; cyc < 3; cyc++) for (let m = 0; m < 12; m++) {
            const have = S + liq[m], et = Math.min(have, k * Ep12[m]);
            let s1 = have - et, spill = 0;
            if (s1 > Smax) { spill = s1 - Smax; s1 = Smax; }
            S = s1;
            const d = G * drain;
            G += base * spill - d;
            if (cyc === 2) { e += et; if (keep) { E12[m] = et; R[m] = (1 - base) * spill + d; } }
        }
        return e;
    };
    if (!(EpY > 0) || !(E > 0)) { year(0, true); return; }
    let lo = 0, hi = Math.max(1, E / EpY);
    while (year(hi, false) < E && hi < 1e6) hi *= 2;
    for (let it = 0; it < 30; it++) { const mid = 0.5 * (lo + hi); if (year(mid, false) < E) lo = mid; else hi = mid; if (hi - lo < 1e-4 * hi) break; }
    year(hi, true);
}
