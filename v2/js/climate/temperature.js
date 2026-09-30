// Temperature stage: a seasonal energy-balance model on the climate grid. DOM-free.
//
//   C·∂T/∂t = S·(1 − α) − (A + B·T) + D·∇²T − γ·(u·∇)T
//
//   S       sunlight (insolation.js; any axial tilt)
//   α       albedo: a base value rising toward the poles, and snow / sea ice where it is cold (smooth ramp)
//   A + B·T heat radiated to space
//   C       heat stored per degree: small over land, a mixed-layer ocean at sea — the source of continental
//           seasons, maritime mildness and the seasonal lag. Frozen sea stores little (ice insulates it).
//   D·∇²T   heat spread by weather and ocean
//   γ·u·∇T  heat carried by the winds (mild coasts downwind of the sea, cold coasts downwind of a continent)
//
// In the tropics, evaporation from wet ground and sea steadies the seasons (a larger B for the seasonal harmonics),
// and wet ground stays mild in its rainy season (below the grid, from the rain stage's rain).
//
// Solved directly for the yearly cycle — the annual mean and the first two harmonics — so no years of spin-up:
// each harmonic is one steady problem (solver.js). What depends on temperature itself (snow and ice, the seasonal
// swing of the winds) is updated over a few outer iterations. T is the sea-level temperature; the stage reports it
// at each grid cell's reference height (its mean land height), and the core lifts it to each terrain cell.

import { LatLonGrid, coarsenField, refineField } from './grid.js';
import { insolationTable, dailyInsolation, declination, SOLAR_CONSTANT } from './insolation.js';
import { HelmholtzSolver } from './solver.js';
import { PARAMS } from './config.js';
import { tropicsWeight, gaussianSmooth } from './circulation.js';

const SECONDS_PER_YEAR = 3.156e7;
const OMEGA = 2 * Math.PI / SECONDS_PER_YEAR;
const AIR_COLUMN_HEAT_CAP = 1.0e7;          // J/m²/K — the atmosphere's heat capacity per unit area
const SEAWATER_HEAT_CAP = 1025 * 3990;      // J/m³/K
const R_PLANET = 6.371e6;
const NT = 12;                              // samples per year for what is evaluated in time (≥ 5 for 2 harmonics)
const OUTER = 4;                            // outer iterations (snow / ice, seasonal winds)
const OUTER_WARM = 2;                       // … when starting from a previous run (temperature ↔ winds rounds)
const CC_SLOPE_25 = Math.exp(17.67 * 25 / 268.5) * 17.67 * 243.5 / (268.5 * 268.5);   // de_s/dT at 25 °C (relative units)
const WET_RAIN_MM = 800;                    // yearly rain at which land is ~63 % wet (evaporation not limited by water)
const BLOCK_FLOOR = 0.5;        // the share of a face that stays open over any ridge: the weather aloft
const EXPOSURE_KM = 700;                    // km: how far upwind the sea still makes land maritime (e-folding) …
const EXPOSURE_STEPS = 4;                   // … looked at over this many grid steps
const CURRENT_ROW_DEG = 6;                  // °: the currents' warmth and cold are relative to the sea within this of latitude
const WET_MONTH_MM = 100;                   // mm/month of rain at which the ground is ~63 % wet
const WET_SUN_REF = 400;                    // W/m² of daily sunlight (top of the air) at which TEMP_WET_COOL_C applies
/** Δ/(Δ+γ): the share of the available energy a wet surface evaporates (equilibrium evaporation), relative to 25 °C. */
const evapShareRaw = (T) => { const t = Math.max(-40, Math.min(45, T)), d = 4098 * 0.6108 * Math.exp(17.27 * t / (t + 237.3)) / ((t + 237.3) ** 2); return d / (d + 0.0665); };
const EVAP_SHARE_25 = evapShareRaw(25);
const evapShare = (T) => evapShareRaw(T) / EVAP_SHARE_25;
const CLOUD_RAIN_MM = 100;                  // mm/month of rain at which land is ~63 % cloud-covered
const WEAK_SUN = SOLAR_CONSTANT / 8;        // W/m² — half the planet's mean sunlight: below it, inversions form

/**
 * The temperature stage. Options: { tiltDeg = 23.44 }.
 * Returns stage(ctx, winds, init?) → { T (K anchors × G, °C at reference height), monthly (12 × G, same), monthlySL
 * (12 × G, sea level), iceFrac (G, share of the year a cell is snow- or ice-covered), state, timing }.
 * init: a previous run's `state` (same settings) to start from — used when temperature and winds are iterated
 * together; it then needs fewer outer iterations. qflux: the ocean's heating of the sea surface (W/m², core grid).
 * rain: monthly rain (12 × G, mm/month, core grid) from the rain stage, or null — then clouds shade rainy land and
 * leave dry land in full sun.
 */
export function energyBalanceTemperature({ tiltDeg = 23.44 } = {}) {
    return (ctx, winds, init = null, qflux = null, rain = null, ocean = null) => {
        const t0 = performance.now();
        const P = { ...PARAMS };
        const core = ctx.grid;
        const ratio = Math.round(P.TEMP_GRID_DEG / core.step);
        const g = ratio > 1 ? new LatLonGrid(core.step * ratio) : core;
        const G = g.size, w = g.w, h = g.h;

        // Surface and winds on the energy-balance grid
        const landFrac = coarsen(core, g, ratio, ctx.surface.landFrac);
        const landKm = coarsen(core, g, ratio, ctx.surface.meanLandKm.map(v => (v === v ? Math.max(0, v) : 0)));
        const uM = new Float64Array(12 * G), vM = new Float64Array(12 * G);
        if (winds) for (let m = 0; m < 12; m++) {
            uM.set(coarsen(core, g, ratio, winds.u.subarray(m * core.size, (m + 1) * core.size)), m * G);
            vM.set(coarsen(core, g, ratio, winds.v.subarray(m * core.size, (m + 1) * core.size)), m * G);
        }
        const uBar = new Float64Array(G), vBar = new Float64Array(G);
        for (let m = 0; m < 12; m++) for (let c = 0; c < G; c++) { uBar[c] += uM[m * G + c] / 12; vBar[c] += vM[m * G + c] / 12; }
        // winds at the NT sample times (linear between mid-month values)
        const uT = new Float64Array(NT * G), vT = new Float64Array(NT * G);
        for (let k = 0; k < NT; k++) {
            const pos = 12 * k / NT - 0.5, m0 = Math.floor(pos), f = pos - m0, a = ((m0 % 12) + 12) % 12, b = (a + 1) % 12;
            for (let c = 0; c < G; c++) {
                uT[k * G + c] = (1 - f) * uM[a * G + c] + f * uM[b * G + c] - uBar[c];
                vT[k * G + c] = (1 - f) * vM[a * G + c] + f * vM[b * G + c] - vBar[c];
            }
        }

        // Clouds over land (with the rain stage's rain): cloudiness 1 − e^{−P/P₀} makes rainy land brighter and dry land
        // darker than the land's average — the average stays in the base albedo — so deserts get the full summer sun
        // and monsoon, rainforest and boreal summers are shaded. Per sample time, relative to the land's mean.
        let cloudT = null;
        if (rain && P.TEMP_CLOUD_ALBEDO > 0) {
            cloudT = new Float64Array(NT * G);
            const Pm = new Float64Array(12 * G);
            for (let m = 0; m < 12; m++) Pm.set(coarsen(core, g, ratio, rain.subarray(m * core.size, (m + 1) * core.size)), m * G);
            for (let k = 0; k < NT; k++) {
                const pos = 12 * k / NT - 0.5, m0 = Math.floor(pos), f = pos - m0, a = ((m0 % 12) + 12) % 12, b = (a + 1) % 12;
                let sum = 0, wsum = 0;
                for (let j = 0; j < h; j++) {
                    const cw = Math.cos(g.lat[j] * Math.PI / 180);
                    for (let i = 0; i < w; i++) {
                        const c = j * w + i, p = (1 - f) * Pm[a * G + c] + f * Pm[b * G + c];
                        const cf = 1 - Math.exp(-Math.max(0, p) / CLOUD_RAIN_MM);
                        cloudT[k * G + c] = cf; sum += cf * landFrac[c] * cw; wsum += landFrac[c] * cw;
                    }
                }
                const meanCf = wsum > 0 ? sum / wsum : 0;
                for (let c = 0; c < G; c++) cloudT[k * G + c] = P.TEMP_CLOUD_ALBEDO * (cloudT[k * G + c] - meanCf);
            }
        }

        // Sunlight and base albedo per row
        const Q = insolationTable(g.lat, tiltDeg, NT);
        const albBase = new Float64Array(h);
        for (let j = 0; j < h; j++) { const x = Math.sin(g.lat[j] * Math.PI / 180); albBase[j] = P.TEMP_ALBEDO + P.TEMP_ALBEDO_LAT * (1.5 * x * x - 0.5); }
        const gamma = P.TEMP_WIND_CARRY * AIR_COLUMN_HEAT_CAP;
        const Cl = P.TEMP_LAND_HEAT_CAP, Co = SEAWATER_HEAT_CAP * P.TEMP_OCEAN_MIX_M;
        // Large-scale height effect per cell (the core applies the standard rate below the grid): sunlit plateaus
        // cool gently with height, ground snowy most of the year like an ice sheet — blended by the snow's duration.
        const lapseEff = new Float64Array(G).fill(P.TEMP_PLATEAU_LAPSE);
        // An ice sheet forms only where snow survives the summer: from snow lasting ~70 % of the year to all of it
        const perennial = new Float64Array(G);
        const iceSheet = (share) => { const x = (share - 0.7) / 0.3; return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); };
        const iceRamp = (T) => {
            const x = (P.TEMP_ICE_WARM_C - T) / (P.TEMP_ICE_WARM_C - P.TEMP_ICE_COLD_C);
            return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
        };

        // Harmonics of sea-level temperature: T(t) = c0 + 2·Re(c1·e^{iθ}) + 2·Re(c2·e^{2iθ}), θ = 2π·t/12
        const c0 = new Float64Array(G), c1r = new Float64Array(G), c1i = new Float64Array(G), c2r = new Float64Array(G), c2i = new Float64Array(G);
        for (let j = 0; j < h; j++) {
            let q = 0; for (let k = 0; k < NT; k++) q += Q[k * h + j] / NT;
            const t = Math.max(-40, Math.min(35, (q * (1 - albBase[j]) - P.TEMP_OLR_A) / P.TEMP_OLR_B));
            for (let i = 0; i < w; i++) c0[j * w + i] = t;
        }
        const snowYear = new Float64Array(G), snowYearPrev = new Float64Array(G);   // share of the year the land is snowy
        const warm = !!(init && init.step === g.step && init.c0.length === G);
        if (warm) {
            c0.set(init.c0); c1r.set(init.c1r); c1i.set(init.c1i); c2r.set(init.c2r); c2i.set(init.c2i); snowYear.set(init.snowYear);
        }
        const outer = warm ? OUTER_WARM : OUTER;
        // heat the ocean's currents bring to (or take from) the sea's surface layer, W/m² (ocean.js)
        const qEbm = qflux ? coarsen(core, g, ratio, qflux) : null;

        const solver = new HelmholtzSolver(g, P.TEMP_DIFFUSIVITY, P.TEMP_DIFFUSIVITY_EW);
        // Mountains block the air near the ground, and the heat it carries and mixes, between the lowlands on either
        // side (the Himalaya keeps Tibet's cold out of India; the Sierra and Cascades keep the Pacific's air out of the
        // Great Basin; the Andes part Chile from Argentina). Each face between two cells is open by
        // e^{−(ridge above the lower side)/TEMP_BLOCK_KM}, the ridge taken strip by strip on the terrain's 1° grid (its
        // crest from one cell's centre to the next), so a range narrower than the grid still counts.
        const faces = P.TEMP_BLOCK_KM > 0 ? ridgeFaces(ctx, core, g, ratio, landKm, P.TEMP_BLOCK_KM) : null;
        const dRad = g.step * Math.PI / 180;
        const Tk = new Float64Array(G), iceYear = new Float64Array(G), seaIceYear = new Float64Array(G);
        const F0 = new Float64Array(G), F1r = new Float64Array(G), F1i = new Float64Array(G), F2r = new Float64Array(G), F2i = new Float64Array(G);
        const sr = new Float64Array(G).fill(P.TEMP_OLR_B), si = new Float64Array(G), zero = new Float64Array(G);
        const srSeason = new Float64Array(G);
        const beltYear = { itcz: 0, hiN: 30, hiS: -30 };           // the year's mean belts (from the winds, if derived)
        if (winds?.belts) { beltYear.hiN = 0; beltYear.hiS = 0; for (const b of winds.belts) { beltYear.itcz += b.itcz / 12; beltYear.hiN += b.hiN / 12; beltYear.hiS += b.hiS / 12; } }
        // land's wetness (0–1) from the rain stage's yearly rain, when there is one
        let landWet = null;
        if (rain) {
            landWet = new Float64Array(G);
            for (let m = 0; m < 12; m++) { const pm = coarsen(core, g, ratio, rain.subarray(m * core.size, (m + 1) * core.size)); for (let c = 0; c < G; c++) landWet[c] += pm[c]; }
            for (let c = 0; c < G; c++) landWet[c] = 1 - Math.exp(-Math.max(0, landWet[c]) / WET_RAIN_MM);
        }
        const C = new Float64Array(G);
        const stats = [];
        const prof = { setup: performance.now() - t0, forcing: 0, operator: 0, solve: 0, output: 0 };
        let tp;
        for (let it = 0; it < outer; it++) {
            tp = performance.now();
            F0.fill(0); F1r.fill(0); F1i.fill(0); F2r.fill(0); F2i.fill(0); iceYear.fill(0); seaIceYear.fill(0);
            snowYearPrev.set(snowYear); snowYear.fill(0);
            for (let c = 0; c < G; c++) { perennial[c] = iceSheet(snowYearPrev[c]); lapseEff[c] = P.TEMP_PLATEAU_LAPSE + (P.TEMP_ICE_LAPSE - P.TEMP_PLATEAU_LAPSE) * perennial[c]; }
            for (let k = 0; k < NT; k++) {
                const th = 2 * Math.PI * k / NT, co = Math.cos(th), sn = Math.sin(th), co2 = Math.cos(2 * th), sn2 = Math.sin(2 * th);
                for (let c = 0; c < G; c++) Tk[c] = c0[c] + 2 * (c1r[c] * co - c1i[c] * sn) + 2 * (c2r[c] * co2 - c2i[c] * sn2);
                for (let j = 0; j < h; j++) {
                    const q = Q[k * h + j], ab = albBase[j];
                    const sx = 1 / (R_PLANET * Math.cos(g.lat[j] * Math.PI / 180) * dRad), sy = 1 / (R_PLANET * dRad);
                    for (let i = 0; i < w; i++) {
                        const c = j * w + i, T = Tk[c], f = landFrac[c];
                        const sL = iceRamp(T - lapseEff[c] * landKm[c]), sO = iceRamp(T);
                        // snow on land: patchy seasonal snow reflects little; snow that survives the summer — an ice
                        // sheet — like sea ice
                        const albSnow = P.TEMP_ALBEDO_SNOW + (P.TEMP_ALBEDO_ICE - P.TEMP_ALBEDO_SNOW) * perennial[c];
                        let alb = ab + f * sL * (albSnow - ab) + (1 - f) * sO * (P.TEMP_ALBEDO_ICE - ab);
                        if (cloudT) alb += f * (1 - sL) * cloudT[k * G + c];          // clouds over snow-free land
                        snowYear[c] += sL / NT;
                        let gF = q * (1 - alb);
                        if (winds && gamma) {                   // the seasonal part of the winds' heat carrying
                            const du = uT[k * G + c], dv = vT[k * G + c];
                            const Tw = Tk[j * w + (i === 0 ? w - 1 : i - 1)], Te = Tk[j * w + (i === w - 1 ? 0 : i + 1)];
                            const gx = du > 0 ? (T - Tw) : (Te - T);
                            let gy = 0;
                            if (dv > 0 && j < h - 1) gy = T - Tk[c + w];
                            else if (dv < 0 && j > 0) gy = Tk[c - w] - T;
                            gF -= gamma * (du * gx * sx + dv * gy * sy);
                        }
                        F0[c] += gF; F1r[c] += gF * co; F1i[c] -= gF * sn; F2r[c] += gF * co2; F2i[c] -= gF * sn2;
                        iceYear[c] += (f * sL + (1 - f) * sO) / NT;
                        seaIceYear[c] += sO / NT;
                    }
                }
            }
            for (let c = 0; c < G; c++) {
                F0[c] = F0[c] / NT - P.TEMP_OLR_A + (qEbm ? qEbm[c] * (1 - landFrac[c]) : 0); F1r[c] /= NT; F1i[c] /= NT; F2r[c] /= NT; F2i[c] /= NT;
                const Cs = Co * (1 - seaIceYear[c]) + Cl * seaIceYear[c];            // frozen sea stores little heat
                C[c] = landFrac[c] * Cl + (1 - landFrac[c]) * Cs;
            }
            // Evaporation steadies the tropics' seasons: there a wet surface puts extra heating into evaporation, and
            // the even temperature aloft (the Hadley circulation's) lets it act locally — ≈ TEMP_EVAP_DAMPING
            // W m⁻² K⁻¹ at 25 °C, following the Clausius–Clapeyron slope, over the sea and over land as wet as its
            // yearly rain keeps it. Tropics only (tropicsWeight, from the year's belts): poleward, weather systems
            // mix the air and the energy balance's own seasons stand.
            if (P.TEMP_EVAP_DAMPING > 0) for (let j = 0; j < h; j++) {
                const wt = tropicsWeight(g.lat[j], beltYear.itcz, beltYear.hiN, beltYear.hiS);
                for (let i = 0; i < w; i++) {
                    const c = j * w + i;
                    if (wt === 0) { srSeason[c] = P.TEMP_OLR_B; continue; }
                    const t = Math.max(-40, Math.min(40, c0[c])), es = Math.exp(17.67 * t / (t + 243.5));
                    const cc = es * 17.67 * 243.5 / ((t + 243.5) ** 2) / CC_SLOPE_25;
                    const wet = (1 - landFrac[c]) * (1 - seaIceYear[c]) + landFrac[c] * (landWet ? landWet[c] : 0.5);
                    srSeason[c] = P.TEMP_OLR_B + P.TEMP_EVAP_DAMPING * wt * cc * wet;
                }
            } else srSeason.fill(P.TEMP_OLR_B);
            const relax = it === 0 && !warm ? 1 : 0.8;
            const tol = it === outer - 1 ? 1e-4 : 1e-3;
            prof.forcing += performance.now() - tp;
            const solveWith = (srArr, sigmaI, fr, fi, xr, xi) => {
                let ta = performance.now();
                solver.setOperator(srArr, sigmaI, winds ? uBar : null, winds ? vBar : null, gamma, faces);
                prof.operator += performance.now() - ta; ta = performance.now();
                const r = solveRelaxed(solver, fr, fi, xr, xi, relax, tol);
                prof.solve += performance.now() - ta;
                return r;
            };
            // annual mean, then the first and second harmonics of the year
            const n0 = solveWith(sr, zero, F0, zero, c0, null);
            for (let c = 0; c < G; c++) si[c] = OMEGA * C[c];
            const n1 = solveWith(srSeason, si, F1r, F1i, c1r, c1i);
            for (let c = 0; c < G; c++) si[c] = 2 * OMEGA * C[c];
            const n2 = solveWith(srSeason, si, F2r, F2i, c2r, c2i);
            stats.push({ it, cycles: [n0.cycles, n1.cycles, n2.cycles] });
        }
        tp = performance.now();

        // Land's own seasons, below the energy balance's scale. Its diffusion stands for the weather systems' poleward
        // heat transport — right for the planet, but over a continent of a few thousand km it ties the land to the sea
        // beside it (D·k² ≫ B), and Australia, southern Africa or the Great Basin lose most of their seasons while
        // Siberia keeps its own. Each column's own response to the season's forcing, with only a local exchange with its
        // surroundings (TEMP_LOCAL_K: the winds over ~1000 km) — F/(B + K + iωC) — is added back over land where it
        // departs from its region's (a Gaussian of TEMP_LOCAL_KM): an interior surrounded by land gains nothing, one
        // among seas gains the seasons of its size. Land the wind brings sea air to keeps the sea's mildness: the gain
        // is × (1 − the sea share upwind, along the year's mean wind, weighted e^{−d/EXPOSURE_KM}) — the UK and the
        // west coasts stay maritime, Australia's interior (the trades cross Queensland first) does not.
        // The air upwind of each land cell, along the year's mean wind (EXPOSURE_STEPS grid steps, each weighted
        // e^{−d/EXPOSURE_KM}): upwind(j, i, visit) calls visit(cell, weight) and returns how surely the wind brings it
        // (only a near-still mean wind brings it less surely); `inland` is 1 − that × the sea share upwind.
        const stepKmE = g.step * 111.2;
        const upwind = (j, i, visit) => {
            const c = j * w + i, sp = Math.hypot(uBar[c], vBar[c]);
            if (!winds || !(sp > 0.3)) return 0;
            const du = -uBar[c] / sp, dv = -vBar[c] / sp;
            let y = j + 0.5, x = i + 0.5;
            for (let k = 1; k <= EXPOSURE_STEPS; k++) {
                const cls = Math.max(0.1, Math.cos((90 - y * g.step) * Math.PI / 180));
                y -= dv; x += du / cls;
                if (y < 0 || y >= h) break;
                visit(Math.floor(y) * w + ((Math.floor(x) % w) + w) % w, Math.exp(-k * stepKmE / EXPOSURE_KM));
            }
            return Math.min(1, sp / 1);
        };
        const inland = new Float64Array(G).fill(1);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            const c = j * w + i; if (!(landFrac[c] > 0)) continue;
            let s = 0, ws = 0;
            const calm = upwind(j, i, (q, wk) => { s += wk * (1 - landFrac[q]); ws += wk; });
            if (ws > 0) inland[c] = 1 - calm * s / ws;
        }

        // The sea's own warmth below the energy balance's scale (which would spread it over thousands of km): a current
        // keeps TEMP_CURRENT_MEMORY of the temperature of the latitudes its water comes from (the ocean stage's
        // `carried`: poleward currents warm, equatorward ones cold). (Upwelling stays in the energy balance's ocean heat:
        // added here too, the equatorial cold tongue bent the trade winds and the Peru coast's the South American rain.)
        // The winds carry it onto the land downwind: TEMP_COAST_CARRY × the sea's anomaly along the land's upwind path
        // (mild Norway and north-west Europe; cool California, Peru and Namibia coasts). With it the rain stage sees
        // warm and cold seas: more evaporation and unstable air off warm ones, stable air off cold ones.
        if (ocean?.carried && P.TEMP_CURRENT_MEMORY > 0) {
            // (the whole anomaly, not only where it departs from its region: the eastern half of a gyre is cold as a
            // whole. But each latitude's sea keeps its mean — warm and cold relative to their latitude: the broad slow
            // equatorward half of a gyre covers more sea than its narrow poleward current, so the anomaly's own mean
            // would cool the subtropical seas ≈ 1 K and take the tropics' land rain to the sea. The mean is taken over
            // ±CURRENT_ROW_DEG of latitude, so a narrow sea between continents keeps its anomaly.)
            const seaAnom = new Float64Array(G);
            const carriedE = coarsen(core, g, ratio, ocean.carried);
            const rowSum = new Float64Array(h), rowArea = new Float64Array(h);
            for (let j = 0; j < h; j++) {
                for (let i = 0; i < w; i++) {
                    const c = j * w + i, s = (1 - landFrac[c]) * (1 - seaIceYear[c]);
                    if (!(s > 0)) continue;
                    seaAnom[c] = P.TEMP_CURRENT_MEMORY * carriedE[c];
                    rowSum[j] += s * seaAnom[c]; rowArea[j] += s;
                }
            }
            const band = Math.max(0, Math.round(CURRENT_ROW_DEG / g.step));
            for (let j = 0; j < h; j++) {
                let sum = 0, area = 0;
                for (let k = Math.max(0, j - band); k <= Math.min(h - 1, j + band); k++) { sum += rowSum[k]; area += rowArea[k]; }
                const mean = area > 0 ? sum / area : 0;
                for (let i = 0; i < w; i++) { const c = j * w + i; if (seaAnom[c]) seaAnom[c] -= mean; }
            }
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const c = j * w + i, f = landFrac[c];
                let carried = 0;
                if (f > 0 && P.TEMP_COAST_CARRY > 0) {
                    let s = 0, ws2 = 0;
                    const calm = upwind(j, i, (q, wk) => { s += wk * (1 - landFrac[q]) * seaAnom[q]; ws2 += wk; });
                    if (ws2 > 0) carried = P.TEMP_COAST_CARRY * calm * s / ws2;
                }
                c0[c] += (1 - f) * (1 - seaIceYear[c]) * seaAnom[c] + f * carried;
            }
        }

        if (P.TEMP_LOCAL_K > 0) {
            const ar = new Float64Array(G), ai = new Float64Array(G), sr2 = new Float64Array(G), si2 = new Float64Array(G), tmpS = new Float64Array(G);
            // (not over ice sheets: the ice holds their summers near freezing)
            const addLocal = (n, fr, fi, xr, xi) => {
                for (let c = 0; c < G; c++) {
                    const re = srSeason[c] + P.TEMP_LOCAL_K, im = n * OMEGA * C[c], d = re * re + im * im;
                    ar[c] = (fr[c] * re + fi[c] * im) / d; ai[c] = (fi[c] * re - fr[c] * im) / d;       // F / (re + i·im)
                }
                sr2.set(ar); si2.set(ai);
                gaussianSmooth(g, sr2, tmpS, P.TEMP_LOCAL_KM); gaussianSmooth(g, si2, tmpS, P.TEMP_LOCAL_KM);
                for (let c = 0; c < G; c++) {
                    const f = landFrac[c] * inland[c] * (1 - perennial[c]);
                    if (f > 0) { xr[c] += f * (ar[c] - sr2[c]); xi[c] += f * (ai[c] - si2[c]); }
                }
            };
            addLocal(1, F1r, F1i, c1r, c1i);
            addLocal(2, F2r, F2i, c2r, c2i);
        }

        // Surface air temperature at time t (months), on the energy-balance grid: the harmonics, and — near snowy or
        // icy ground under a weak sun — the winter inversion, the air by the ground colder than the air above it.
        const tmp = new Float64Array(G);
        const surfaceAt = (t, withInversion) => {
            const th = 2 * Math.PI * t / 12, co = Math.cos(th), sn = Math.sin(th), co2 = Math.cos(2 * th), sn2 = Math.sin(2 * th);
            const delta = declination(t, tiltDeg);
            const pos = t - 0.5, m0 = Math.floor(pos), fm = pos - m0, ma = ((m0 % 12) + 12) % 12, mb = (ma + 1) % 12;
            const U0sq = P.TEMP_INVERSION_WIND * P.TEMP_INVERSION_WIND;
            for (let j = 0; j < h; j++) {
                const q = dailyInsolation(g.lat[j] * Math.PI / 180, delta);
                let x = 1 - q / WEAK_SUN; x = x <= 0 ? 0 : x >= 1 ? 1 : x;
                const dark = x * x * (3 - 2 * x);
                for (let i = 0; i < w; i++) {
                    const c = j * w + i;
                    let T = c0[c] + 2 * (c1r[c] * co - c1i[c] * sn) + 2 * (c2r[c] * co2 - c2i[c] * sn2);
                    if (withInversion && dark > 0) {
                        const f = landFrac[c], snow = f * iceRamp(T - lapseEff[c] * landKm[c]) + (1 - f) * iceRamp(T);
                        let calm = 1;
                        if (winds) {
                            const u = (1 - fm) * uM[ma * G + c] + fm * uM[mb * G + c], v = (1 - fm) * vM[ma * G + c] + fm * vM[mb * G + c];
                            calm = 1 / (1 + (u * u + v * v) / U0sq);          // wind mixes the inversion away
                        }
                        T -= P.TEMP_INVERSION_C * snow * dark * calm;
                    }
                    tmp[c] = T;
                }
            }
            return tmp;
        };
        // Back to the core grid: monthly sea-level temperature (no inversion: used for the sea surface), and the
        // surface air temperature at each grid cell's reference height
        const href = ctx.surface.meanLandKm;
        for (let c = 0; c < G; c++) lapseEff[c] = P.TEMP_PLATEAU_LAPSE + (P.TEMP_ICE_LAPSE - P.TEMP_PLATEAU_LAPSE) * iceSheet(snowYear[c]);
        const lapseCore = new Float32Array(core.size);
        refine(g, core, ratio, lapseEff, lapseCore, 0);
        const heightCorrect = (out, offset) => {
            for (let c = 0; c < core.size; c++) { const hr = href[c] === href[c] ? Math.max(0, href[c]) : 0; out[offset + c] -= lapseCore[c] * hr; }
        };
        const monthlySL = new Float32Array(12 * core.size), monthly = new Float32Array(12 * core.size), seaIce = new Float32Array(12 * core.size);
        const iceTmp = new Float64Array(G);
        for (let m = 0; m < 12; m++) {
            const sl = surfaceAt(m + 0.5, false);
            for (let c = 0; c < G; c++) iceTmp[c] = landFrac[c] < 0.5 ? iceRamp(sl[c]) : 0;       // sea ice, by month
            refine(g, core, ratio, iceTmp, seaIce, m * core.size);
            refine(g, core, ratio, sl, monthlySL, m * core.size);
            refine(g, core, ratio, surfaceAt(m + 0.5, true), monthly, m * core.size);
            heightCorrect(monthly, m * core.size);
        }
        const K = ctx.anchorMonths.length, T = new Float32Array(K * core.size);
        ctx.anchorMonths.forEach((a, k) => { refine(g, core, ratio, surfaceAt(a + 0.5, true), T, k * core.size); heightCorrect(T, k * core.size); });
        // Continentality below the energy-balance grid: the sea's seasons are a fraction of the land's, so a 1° cell's
        // swing about its yearly mean scales with the land around it (within ~1.5°) against the land share the coarse
        // grid saw — coasts milder, interiors harsher, at the scale of single coastlines.
        if (P.TEMP_SEA_SWING < 1 && ratio > 1) {
            const lfCoarse = new Float32Array(core.size), lf = ctx.surface.landFrac, cw = core.w, ch = core.h;
            refine(g, core, ratio, landFrac, lfCoarse, 0);
            const a = P.TEMP_SEA_SWING, Kn = ctx.anchorMonths.length;
            for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
                const c = j * cw + i;
                if (!(lf[c] > 0)) continue;
                let s = 0, n = 0;
                for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= ch) continue; for (let di = -1; di <= 1; di++) { s += lf[jj * cw + (i + di + cw) % cw]; n++; } }
                const k = Math.max(0.6, Math.min(1.6, (a + (1 - a) * s / n) / (a + (1 - a) * lfCoarse[c])));
                let mean = 0; for (let m = 0; m < 12; m++) mean += monthly[m * core.size + c] / 12;
                for (let m = 0; m < 12; m++) { const q = m * core.size + c; monthly[q] = mean + (monthly[q] - mean) * k; }
                for (let q = 0; q < Kn; q++) { const x = q * core.size + c; T[x] = mean + (T[x] - mean) * k; }
            }
        }
        // Wet tropical ground stays mild. In the tropics the air aloft is nearly the same temperature everywhere (the
        // Coriolis force is weak, so the Hadley circulation evens it out) and the air by the ground follows its own
        // surface — which the energy balance, spreading any local heating over thousands of km, can't see. Rain keeps
        // the ground wet (1 − e^{−P/P₀}) and a wet surface spends the sun's heat on evaporation rather than warming
        // (Δ/(Δ+γ), the equilibrium evaporative share, larger in warm air): the rainy season stays mild and the dry
        // season before the rains is the hottest, as in the real monsoon lands. Full strength from the ITCZ to halfway
        // to each subtropical high, fading out at the high (the circulation's belts, month by month); poleward the
        // energy balance's own seasons stand.
        if (rain && P.TEMP_WET_COOL_C > 0) {
            const lf = ctx.surface.landFrac, N = core.size, cw = core.w, ch = core.h;
            const sunAt = new Float64Array(ch), belts = winds?.belts;
            const adjust = (out, off, t) => {
                const delta = declination(t, tiltDeg);
                const pos = t - 0.5, m0 = Math.floor(pos), f = pos - m0, a = ((m0 % 12) + 12) % 12, b = (a + 1) % 12;
                const bl = (key, def) => belts ? (1 - f) * belts[a][key] + f * belts[b][key] : def;
                const itcz = bl('itcz', 0), hiN = bl('hiN', 30), hiS = bl('hiS', -30);
                for (let j = 0; j < ch; j++) sunAt[j] = tropicsWeight(core.lat[j], itcz, hiN, hiS) * dailyInsolation(core.lat[j] * Math.PI / 180, delta) / WET_SUN_REF;
                for (let c = 0; c < N; c++) {
                    const s = sunAt[(c / cw) | 0];
                    if (!(lf[c] > 0) || s === 0) continue;
                    const p = (1 - f) * rain[a * N + c] + f * rain[b * N + c], wet = 1 - Math.exp(-Math.max(0, p) / WET_MONTH_MM);
                    out[off + c] -= P.TEMP_WET_COOL_C * lf[c] * s * evapShare(out[off + c]) * wet;
                }
            };
            for (let m = 0; m < 12; m++) adjust(monthly, m * N, m + 0.5);
            ctx.anchorMonths.forEach((a, k) => adjust(T, k * N, a + 0.5));
        }
        const iceCore = new Float32Array(core.size);
        refine(g, core, ratio, iceYear, iceCore, 0);
        prof.output = performance.now() - tp;
        const state = { step: g.step, c0, c1r, c1i, c2r, c2i, snowYear };
        return { T, monthly, monthlySL, seaIce, iceFrac: iceCore, state, solverStats: stats, profile: prof, ms: performance.now() - t0, source: 'energy balance' };
    };
}

/**
 * Open share of each face of the energy-balance grid (faces.e: with the east neighbour, faces.n: with the north one):
 * e^{−(ridge − lower side)/H}, averaged over the 1° strips across the face; the ridge of a strip is the highest 1° mean
 * height from one cell's centre to the next, the sides the two cells' mean land heights.
 */
function ridgeFaces(ctx, core, g, ratio, landKm, hKm) {
    const w = g.w, h = g.h, G = g.size, cw1 = core.w, r2 = ratio >> 1, h1 = ctx.surface.meanKm;
    const hAt = (jj, ii) => { const v = h1[jj * cw1 + ((ii % cw1) + cw1) % cw1]; return v > 0 ? v : 0; };
    const faces = { e: new Float64Array(G).fill(1), n: new Float64Array(G).fill(1) };
    if (ratio < 2) return faces;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const c = j * w + i, ce = j * w + (i + 1) % w;
        let se = 0, sn = 0;
        const lowE = Math.min(landKm[c], landKm[ce]);
        for (let s = 0; s < ratio; s++) {
            let me = 0; for (let ii = i * ratio + r2; ii <= (i + 1) * ratio + r2; ii++) me = Math.max(me, hAt(j * ratio + s, ii));
            se += BLOCK_FLOOR + (1 - BLOCK_FLOOR) * Math.exp(-Math.max(0, me - lowE) / hKm);
            if (j > 0) {
                let mn = 0; for (let jj = (j - 1) * ratio + r2; jj <= j * ratio + r2; jj++) mn = Math.max(mn, hAt(jj, i * ratio + s));
                sn += BLOCK_FLOOR + (1 - BLOCK_FLOOR) * Math.exp(-Math.max(0, mn - Math.min(landKm[c], landKm[c - w])) / hKm);
            }
        }
        faces.e[c] = se / ratio;
        if (j > 0) faces.n[c] = sn / ratio;
    }
    return faces;
}

function solveRelaxed(solver, fr, fi, xr, xi, relax, tol) {
    const n = fr.length;
    const nr = new Float64Array(xr), ni = xi ? new Float64Array(xi) : new Float64Array(n);
    const res = solver.solve(fr, fi, nr, ni, { tol, maxCycles: 30 });
    for (let c = 0; c < n; c++) {
        xr[c] += relax * (nr[c] - xr[c]);
        if (xi) xi[c] += relax * (ni[c] - xi[c]);
    }
    return res;
}

// Grid transfers (shared with the circulation stage)
const coarsen = (core, g, ratio, src) => coarsenField(core, g, ratio, src);
const refine = (g, core, ratio, src, out, offset) => refineField(g, core, ratio, src, out, offset);
