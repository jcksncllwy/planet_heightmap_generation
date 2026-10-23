// The crops' climate (plans/CIV_PLAN.md §9.2): how well each crop class grows on a place's twelve months, 0–1, by the
// logic of FAO's agro-ecological zones (FAO 1978; GAEZ v4, Fischer et al. 2021). A month counts toward a crop's season by
// its temperature (the crop's profile, a trapezoid: Ecocrop's absolute and optimal limits, as monthly means) and its water
// (rain and the soil's store against potential evaporation: AEZ's growing period, P ≥ ½ PET, with a 100 mm store). The
// crop's suitability is its best run of season months, with enough rain over it — read against GAEZ v4's low-input
// rain-fed yields on Earth (tuning/civ/crop-check.mjs).
//
//   winterCereal  wheat, barley, lentils: cool-season annuals (Csa's winters, Dfb's summers, the tropics' highlands)
//   summerCereal  millets, sorghum, maize, dry rice: warm-season annuals, short seasons (the Sahel's millet in ~3 months)
//   roots         yams, taro, cassava, sweet potato in the tropics; potatoes in cool highlands
//   tree          bananas, breadfruit, coconut: frost-free and wet nearly all year
//   paddy         flooded rice and taro, rain-fed: a warm season with more rain than evaporation
//   paddyWarm     the same, its warmth alone: flooded from a river or a marsh, wherever the land holds water (substrate.js)
//   wheatWatered, milletWatered  the cereals' warmth alone: watered by canals (substrate.js, on irrigable land)

import { thornthwaite } from '../climate/cell-stats.js';

const lin = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
const trap = (p, t) => lin(p[0], p[1], t) * (1 - lin(p[2], p[3], t));

// each crop class: T, its monthly-mean profile (°C: none below [0], full [1]–[2], none above [3]); wet, the water a month
// needs ((P + store) / PET: none at [0], full at [1]); months, the season (none at [0], full at [1]); rainMm, the rain over
// the season (none at [0], full at [1]); soggy, how much an always-wet year costs (cereals: leaching, rot and blast in
// the humid tropics — GAEZ's low-input cereals are poor there; months with water ≥ 1.5 × PET, from 6 to all 12)
export const CROPS = {
    winterCereal: { T: [2, 8, 20, 27], wet: [0.3, 0.6], months: [3.5, 5], rainMm: [120, 320], soggy: 0.8 },
    summerCereal: { T: [9, 16, 30, 37], wet: [0.3, 0.6], months: [2, 4], rainMm: [200, 450], soggy: 0.8 },
    rootsWarm: { T: [16, 21, 31, 37], wet: [0.3, 0.6], months: [4, 7], rainMm: [400, 900] },
    rootsCool: { T: [3, 9, 20, 26], wet: [0.3, 0.6], months: [3, 4.5], rainMm: [200, 450] },
    tree: { T: [15, 21, 32, 38], wet: [0.3, 0.7], months: [6, 10], rainMm: [700, 1400] },
    paddy: { T: [15, 21, 32, 38], wet: [0.9, 1.4], months: [3, 4.5], rainMm: [700, 1200] },
};
export const CROP_KEYS = ['winterCereal', 'summerCereal', 'roots', 'tree', 'paddy', 'paddyWarm', 'wheatWatered', 'milletWatered'];
const STORE_MM = 100;

const pet = new Float64Array(12), wetness = new Float64Array(12), m = new Float64Array(12);

/** The months' water: (P + the soil's store) / PET, the store run round the year twice to settle. */
function monthWater(P12) {
    let s = 0;
    for (let cyc = 0; cyc < 2; cyc++) for (let k = 0; k < 12; k++) {
        const e = pet[k];
        wetness[k] = e > 1 ? (P12[k] + s) / e : 9;
        s = Math.min(STORE_MM, Math.max(0, s + P12[k] - e));
    }
}

/** A crop's suitability from the months (pet and wetness filled): the best season, its length and its rain. */
function season(c, T12, P12, ignoreWater = false) {
    for (let k = 0; k < 12; k++) m[k] = trap(c.T, T12[k]) * (ignoreWater ? 1 : lin(c.wet[0], c.wet[1], wetness[k]));
    const L = Math.min(12, Math.ceil(c.months[1]));
    let best = 0;
    for (let k0 = 0; k0 < (L === 12 ? 1 : 12); k0++) {
        let sum = 0, rain = 0;
        for (let k = 0; k < L; k++) { const j = (k0 + k) % 12; sum += m[j]; rain += P12[j]; }
        const s = lin(c.months[0], c.months[1], sum) * (ignoreWater ? 1 : lin(c.rainMm[0], c.rainMm[1], rain));
        if (s > best) best = s;
    }
    if (c.soggy && !ignoreWater) { let wet = 0; for (let k = 0; k < 12; k++) if (wetness[k] >= 1.5) wet++; best *= 1 - c.soggy * lin(6, 12, wet); }
    return best;
}

/** Each crop class's suitability (0–1) on twelve months (°C, mm) at a latitude (radians), into `out`. */
export function cropClimate(T12, P12, latRad, out = {}) {
    thornthwaite(T12, latRad, pet);
    monthWater(P12);
    out.winterCereal = season(CROPS.winterCereal, T12, P12);
    out.summerCereal = season(CROPS.summerCereal, T12, P12);
    out.roots = Math.max(season(CROPS.rootsWarm, T12, P12), season(CROPS.rootsCool, T12, P12));
    out.tree = season(CROPS.tree, T12, P12);
    out.paddy = season(CROPS.paddy, T12, P12);
    out.paddyWarm = season(CROPS.paddy, T12, P12, true);
    out.wheatWatered = season(CROPS.winterCereal, T12, P12, true);
    out.milletWatered = season(CROPS.summerCereal, T12, P12, true);
    return out;
}

/** A collector for the climate's onCell (as cell-stats.js): per crop class, one byte each, 0–255 for 0–1. */
export function cropCollector(n, latRadOf) {
    const crops = Object.fromEntries(CROP_KEYS.map(k => [k, new Uint8Array(n)])), s = {};
    return { crops, add(c, T12, P12) { cropClimate(T12, P12, latRadOf(c), s); for (const k of CROP_KEYS) crops[k][c] = Math.round(255 * s[k]); } };
}
