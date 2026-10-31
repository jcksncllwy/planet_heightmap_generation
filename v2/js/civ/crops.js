// The crops' climate (plans/CIV_PLAN.md §9.2, §11): how many harvests a year each crop class takes on a place's twelve
// months — not a suitability but a count, so a land of two or three harvests stands out from one of one (the Nile, Bengal
// and Java from Iowa). Ported from upstream's Food tab (raguilar011095/planet_heightmap_generation, v2/js/farming/
// farming.js growingSeason, cropYields, climateSoil — © Robert Aguilar, GPL v3; plans/V2_FARMING_PLAN.md C2), on our
// crop classes and config (food-config.js):
//
//   · each month warm enough and wet enough — its rain, its snow's melt and the soil's water against its potential
//     evaporation (FAO's length of growing period; the finish's own snow and PET, finish-cover.js);
//   · each crop kind grows each month by degree-days from its base to its optimum, not too hot, wet enough and not
//     drowned; it ripens after its cycle; a run broken by a dry or a cold month is lost (winter grains sleep through
//     the cold, tropical roots through a dry season); harvests are a staircase — the next needs a whole cycle and a
//     turnaround more; rice sets grain only with a month warm enough to flower;
//   · rain-fed harvests discounted where the rains fail often (a dry year's, a seasonal one's: the Mediterranean's,
//     a monsoon's margins); watered harvests with ~60 mm a month brought (a desert river grows winter wheat, not paddy);
//   · a rotation: a second crop of another class in the months the first leaves (rice then winter wheat on the Yangtze,
//     wheat then millet on the Nile) — counted only in the rotation (farmland's one number), not in each class's own
//     harvests, which the economy adds up on its own (substrate.js food);
//   · and the soil's climate half (food-config.js): black earth under the temperate grasslands, leaching in the hot wet
//     tropics, podzol under boreal conifers — from the land's cover (finish-cover.js landCover).
//
//   winterCereal  wheat, barley, lentils: cool-season annuals, one harvest a year
//   summerCereal  maize where it is wet enough long enough; millets and sorghum, quick and drought-hardy
//   roots         yams, taro, cassava, sweet potato in the tropics; potatoes in cool highlands
//   paddy         flooded rice: standing water — rain past evaporation, or a river's or a marsh's
//   tree          bananas, breadfruit, coconut: frost-free and wet nearly all year (perennial: a season's suitability, 0–1,
//                 by the logic of FAO's agro-ecological zones and Ecocrop's limits — not harvests)
//
// Limits (what it skips): one place's mean year, so no run of bad years (climate-var.js has those); no day length (wheat's
// one harvest a year stands for it); no frost days within a month; water brought the year round, not by the river's
// season (basin irrigation's summer-dry fields: the Nile's summer grain comes out above its winter wheat); the soil's
// parent rock is not known yet (food-config parent.rock: middling ground everywhere but river silt, loess and dune sand).

import { thornthwaite } from '../climate/cell-stats.js';
import { FINISH, COVER } from '../finish/finish-config.js';
import { landCover, newCover } from '../finish/finish-cover.js';
import { FOOD } from './food-config.js';
import { unpackT, unpackP } from './months.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const S = (r, x) => smooth(r[0], r[1], x);
const lin = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
const trap = (p, t) => lin(p[0], p[1], t) * (1 - lin(p[2], p[3], t));

/** The crop classes that take harvests, in the order they are worked out. */
export const HARVEST_CLASSES = ['winterCereal', 'summerCereal', 'roots', 'paddy'];

// ── the months ──
/** A season to fill (reused place after place). */
export function newSeason() { return { rain: 0, warm: 0, wetness: 0, seasonality: 0, avail: new Float64Array(12), pet: new Float64Array(12) }; }

/**
 * A place's growing season from its twelve months (T °C, P mm; January first), into out: `rain` — the months that grow
 * crops on rain alone (each month's warmth × its wetness), `warm` — those warm enough, were water brought; each month's
 * water (`avail`, ÷ potential evaporation); the year's wetness (rain ÷ potential evaporation) and seasonality (Walsh &
 * Lawler's index: 0 even, ~0.8 the Mediterranean's, past 1.2 a monsoon margin's). The snow kept until it melts and the
 * soil's water carried into dry months, three years from bare dry ground so they settle into their round.
 */
export function growingSeason(T, P, out = newSeason(), K = FOOD, F = FINISH, C = COVER) {
    const pet = out.pet;
    for (let m = 0; m < 12; m++) pet[m] = Math.max(5, (F.petBaseMm + F.petPerC * T[m]) / 12);
    let swe = 0, soil = 0, rain = 0, warm = 0;
    for (let cyc = 0; cyc < 3; cyc++) for (let m = 0; m < 12; m++) {
        const p = Math.max(0, P[m]), snowfall = p * S(C.snowPhase, T[m]);
        swe += snowfall;
        const melt = Math.min(swe, C.snowMeltMmPerC * Math.max(0, T[m]));
        swe = Math.max(0, swe - melt - C.snowLossMm * S(C.snowLossWarm, T[m]));
        const liquid = p - snowfall + melt, avail = (liquid + soil) / pet[m];
        soil = Math.min(K.soilMm, Math.max(0, soil + liquid - pet[m]));
        if (cyc < 2) continue;
        const w = S(K.warmC, T[m]);
        warm += w; rain += w * S(K.wetShare, avail);
        out.avail[m] = avail;
    }
    let Py = 0, Ey = 0, si = 0;
    for (let m = 0; m < 12; m++) { Py += Math.max(0, P[m]); Ey += pet[m]; }
    for (let m = 0; m < 12; m++) si += Math.abs(Math.max(0, P[m]) - Py / 12);
    out.rain = rain; out.warm = warm; out.wetness = Py / Ey; out.seasonality = Py > 0 ? si / Py : 0;
    return out;
}

// ── the harvests ──
/** A crop kind's warmth each month (past its base to its optimum, × not too hot) into therm — and whether the year's
 *  warmth could ripen it at all. */
function kindWarmth(c, T, therm, K) {
    let sum = 0;
    for (let m = 0; m < 12; m++) {
        const warm = Math.max(0, Math.min(1, (T[m] - c.base) / (c.opt - c.base)));
        therm[m] = warm > 0 ? warm * smooth(c.hot[1], c.hot[0], T[m]) : 0;
        sum += therm[m];
    }
    return sum > (1 - K.harvestRamp) * c.cycle;
}
/** A crop kind's growth each month (0…1) into rate — warm, wet enough (its water plus `brought` mm a month) and not drowned
 *  (unless a paddy) — and into pause, the cold months that only send a winter crop to sleep. */
function kindRates(c, T, therm, avail, pet, brought, rate, pause, K) {
    for (let m = 0; m < 12; m++) {
        if (!(therm[m] > 0)) { rate[m] = 0; pause[m] = c.dormant && T[m] < c.base + 4 && T[m] > K.dormantKillC ? 1 : 0; continue; }
        // (water brought tops a month up to what the crop wants, no further: nobody irrigates in the monsoon)
        const a0 = avail[m], a = brought > 0 && a0 < c.wet[1] ? Math.min(a0 + brought / pet[m], c.wet[1]) : a0;
        // (drowned by the month's water beyond what it evaporates, in mm: a monsoon's hundreds, not a thaw's few tens)
        rate[m] = therm[m] * S(c.wet, a) * (c.paddy ? 1 : smooth(c.soggy[1], c.soggy[0], (a - 1) * pet[m]));
        pause[m] = (c.dormant && rate[m] < K.harvestBreak && T[m] < c.base + 4 && T[m] > K.dormantKillC) || (c.dryDormant && rate[m] < K.harvestBreak) ? 1 : 0;
    }
}
/** The harvests a run of `L` months (growing fully) gives a crop of `cycle` months: a staircase, each step eased in. */
function harvestSteps(L, cycle, K, max) {
    let h = 0;
    for (let j = 1; j <= max; j++) {
        const at = j * cycle + (j - 1) * K.harvestTurn, s = smooth(at - K.harvestRamp * cycle, at, L);
        if (!(s > 0)) break;
        h += s;
    }
    return h;
}
/** The harvests a crop kind takes in a year from its runs of growing months; `free` (12, or null): the months it may use. */
function kindHarvests(rate, pause, c, free, K) {
    const brk = K.harvestBreak, max = c.max ?? K.maxHarvests;
    let start = -1;
    for (let m = 0; m < 12; m++) if ((free && !free[m]) || (rate[m] < brk && !pause[m])) { start = m; break; }
    // (no gap: the year one run, round and round — the wet tropics, a river delta's paddies)
    if (start < 0) { let L = 0; for (let m = 0; m < 12; m++) L += rate[m]; return harvestSteps(L, c.cycle, K, max); }
    let h = 0, L = 0;
    for (let i = 1; i <= 12; i++) {
        const m = (start + i) % 12;
        if ((free && !free[m]) || (rate[m] < brk && !pause[m])) { if (L > 0) h += harvestSteps(L, c.cycle, K, max); L = 0; } else L += rate[m];
    }
    return Math.min(h, max);
}

/** Working arrays for cropHarvests (reused place after place). */
export function cropWork(K = FOOD) {
    const kinds = [];
    HARVEST_CLASSES.forEach((name, g) => { for (const c of K.crops[name].kinds) kinds.push({ g, c }); });
    return { kinds, rate: kinds.map(() => new Float64Array(12)), pause: kinds.map(() => new Uint8Array(12)), therm: kinds.map(() => new Float64Array(12)),
        can: new Uint8Array(kinds.length), set: new Float64Array(kinds.length), h: new Float64Array(kinds.length), free: new Uint8Array(12), asleep: new Uint8Array(12),
        lead: new Int32Array(HARVEST_CLASSES.length), order: Array.from(HARVEST_CLASSES, (_, g) => g) };
}

/**
 * Each crop class's harvests a year at a place, from its months (T °C) and growingSeason's season — into out (by
 * HARVEST_CLASSES' keys): `<class>` by rain (discounted where the rains are unreliable) and `<class>W` watered (≥ by
 * rain), each its own crop's alone; and the best rotation — a class's crop and a second of another class in the months
 * it leaves, counted in the first's harvests (by its food against the other's) — `rot`, `rotCls` by rain and `rotW`,
 * `rotWCls` watered (rotCls: an index into HARVEST_CLASSES, −1 none); and `paddyF`, paddy flooded by a river or a marsh
 * (its warmth alone).
 */
export function cropHarvests(T, season, out = {}, K = FOOD, work = cropWork(K)) {
    const A = season.avail, E = season.pet, { kinds, rate, pause, therm, can, h, free } = work;
    const reliable = S(K.rainReliable, season.wetness) * (1 - K.seasonRisk * S(K.riskSeason, season.seasonality) * S(K.riskWet, season.wetness));
    // (each kind's warmth through the year, once; and whether water brought would change it: not where the rain already
    // gives it all it wants in every month it could grow — the watered year is then the rain-fed one)
    let Tmax = -Infinity;
    for (let m = 0; m < 12; m++) if (T[m] > Tmax) Tmax = T[m];
    for (let i = 0; i < kinds.length; i++) {
        can[i] = kindWarmth(kinds[i].c, T, therm[i], K) ? 1 : 0;
        // (a crop whose flowers want a warm month sets less grain without one: rice's chilled sterile)
        work.set[i] = kinds[i].c.flower ? smooth(kinds[i].c.flower[0], kinds[i].c.flower[1], Tmax) : 1;
        if (!(work.set[i] > 0)) can[i] = 0;
        let thirsty = 0;
        if (can[i]) for (let m = 0; m < 12; m++) if (therm[i][m] > 0 && A[m] < kinds[i].c.wet[1]) { thirsty = 1; break; }
        if (!thirsty) can[i] |= 2;
    }
    let rot = 0, rotCls = -1, rotV = 0, rotW = 0, rotWCls = -1, rotWV = 0;
    for (let w = 0; w < 2; w++) {
        const brought = w ? K.waterSupplyMm : 0;
        for (let i = 0; i < kinds.length; i++) {
            if (!can[i]) { h[i] = 0; rate[i].fill(0); continue; }
            if (w && can[i] & 2) continue;                    // (as by rain: its months, its harvests, already worked out)
            kindRates(kinds[i].c, T, therm[i], A, E, brought, rate[i], pause[i], K);
            h[i] = kinds[i].c.share * work.set[i] * kindHarvests(rate[i], pause[i], kinds[i].c, null, K);
        }
        // (each class's own crop, its best kind's; then the rotations, the likeliest best first — a class whose crop and a
        // second as big again could not beat the best so far is not worked out: the same answer, sooner)
        const lead = work.lead, order = work.order, rot0 = out._rot ??= new Float64Array(HARVEST_CLASSES.length);
        for (let g = 0; g < HARVEST_CLASSES.length; g++) {
            let l = -1;
            for (let i = 0; i < kinds.length; i++) if (kinds[i].g === g && (l < 0 || h[i] > h[l])) l = i;
            lead[g] = l; order[g] = g;
            const key = HARVEST_CLASSES[g];
            if (w) out[key + 'W'] = Math.max(h[l], out[key]); else out[key] = h[l] * reliable;
        }
        const wt = g => K.crops[HARVEST_CLASSES[g]].weight, bound = g => (w ? Math.max(2 * h[lead[g]], rot0[g]) : 2 * h[lead[g]] * reliable) * wt(g);
        order.sort((x, y) => bound(y) - bound(x));
        for (const g of order) {
            const l = lead[g], own = h[l], weight = wt(g);
            if (!w) rot0[g] = own * reliable;
            if (bound(g) <= (w ? rotWV : rotV)) continue;
            let e = own;
            if (e > 0.05) {
                // (the rotation's second crop: the best other class's, in the months the first does not grow in — the
                // lesser of the two: a rotation is named for its main food)
                let any = 0;
                for (let m = 0; m < 12; m++) { free[m] = rate[l][m] < K.relayAt ? 1 : 0; any += free[m]; }
                let relay = 0;
                if (any) for (let i = 0; i < kinds.length; i++) {
                    if (kinds[i].g === g || !(h[i] > 0.05)) continue;
                    const r = kinds[i].c.share * work.set[i] * kindHarvests(rate[i], pause[i], kinds[i].c, free, K) * wt(kinds[i].g) / weight;
                    if (r > relay) relay = r;
                }
                e += Math.min(relay, e);
            }
            if (w) {
                const ew = Math.max(e, rot0[g]);
                if (ew * weight > rotWV) { rotWV = ew * weight; rotW = ew; rotWCls = g; }
            } else {
                rot0[g] = e * reliable;
                if (e * reliable * weight > rotV) { rotV = e * reliable * weight; rot = e * reliable; rotCls = g; }
            }
        }
    }
    out.rot = rot; out.rotCls = rotCls; out.rotW = rotW; out.rotWCls = rotWCls;
    // (and paddy flooded from a river or a marsh, wherever the land holds water: its warmth alone)
    let pf = 0;
    const gp = HARVEST_CLASSES.indexOf('paddy');
    for (let i = 0; i < kinds.length; i++) if (kinds[i].g === gp && can[i]) pf = Math.max(pf, kinds[i].c.share * work.set[i] * kindHarvests(therm[i], work.asleep, kinds[i].c, null, K));
    out.paddyF = pf;
    return out;
}

/** What the climate makes of a soil, from the land's cover (finish-cover.js landCover): black earth, leaching (before any
 *  renewal) and podzol, each 0…1. */
export function climateSoil(cv, out = {}, K = FOOD) {
    out.black = S(K.blackWet, cv.wetness) * S(K.blackWetMax, cv.wetness) * S(K.blackWarmest, cv.warmest) * S(K.blackColdest, cv.coldest);
    out.leach = S(K.leachWet, cv.wetness) * S(K.leachWarm, cv.tAnn);
    out.podzol = cv.tree * S(K.podzolNeedle, cv.needle) * S(K.podzolColdest, cv.coldest) * S(K.podzolWarmest, cv.warmest);
    return out;
}

// ── tree crops: a season's suitability (perennials take no count of harvests) ──
// T, the monthly-mean profile (°C: none below [0], full [1]–[2], none above [3]); wet, the water a month needs ((P +
// store) / PET: none at [0], full at [1]); months, the season (none at [0], full at [1]); rainMm, the rain over it
const TREE = { T: [15, 21, 32, 38], wet: [0.3, 0.7], months: [6, 10], rainMm: [700, 1400] }, STORE_MM = 100;
const tPet = new Float64Array(12), tWet = new Float64Array(12), tM = new Float64Array(12);
function treeSeason(T12, P12, latRad) {
    thornthwaite(T12, latRad, tPet);
    let s = 0;
    for (let cyc = 0; cyc < 2; cyc++) for (let k = 0; k < 12; k++) { const e = tPet[k]; tWet[k] = e > 1 ? (P12[k] + s) / e : 9; s = Math.min(STORE_MM, Math.max(0, s + P12[k] - e)); }
    for (let k = 0; k < 12; k++) tM[k] = trap(TREE.T, T12[k]) * lin(TREE.wet[0], TREE.wet[1], tWet[k]);
    const L = Math.min(12, Math.ceil(TREE.months[1]));
    let best = 0;
    for (let k0 = 0; k0 < 12; k0++) {
        let sum = 0, rain = 0;
        for (let k = 0; k < L; k++) { const j = (k0 + k) % 12; sum += tM[j]; rain += P12[j]; }
        best = Math.max(best, lin(TREE.months[0], TREE.months[1], sum) * lin(TREE.rainMm[0], TREE.rainMm[1], rain));
    }
    return best;
}

// ── per place, and per cell (bytes) ──
/** Harvests a year kept in a byte: up to this many, finer where they are few (the byte ∝ √harvests). */
const HARVESTS_MAX = 6;
export const encHarvests = h => Math.max(0, Math.min(255, Math.round(255 * Math.sqrt(Math.max(0, h) / HARVESTS_MAX))));
export const decHarvests = b => HARVESTS_MAX * (b / 255) ** 2;
const unit = v => Math.max(0, Math.min(255, Math.round(255 * v)));
/** The bytes the finish keeps per land cell (w.crops), and how each is read back: harvests (encHarvests), shares (× 255),
 *  months (× 20), the rotations' classes (rotCls + 1 in the low nibble, rotWCls + 1 in the high). */
const H = ['h', encHarvests, decHarvests], U = ['u', unit, b => b / 255], M = ['m', v => Math.min(255, Math.round(20 * v)), b => b / 20];
export const CROP_BYTES = {
    winterCereal: H, winterCerealW: H, summerCereal: H, summerCerealW: H, roots: H, rootsW: H, paddy: H, paddyW: H, paddyF: H, rot: H, rotW: H,
    rotCls: ['c', null, null], tree: U, black: U, leach: U, podzol: U, rainMo: M, warmMo: M,
};
export const CROP_KEYS = Object.keys(CROP_BYTES);

/** Everything crops.js says of a place with these twelve months (°C, mm) at a latitude (radians), into out: cropHarvests'
 *  harvests and rotations, tree crops' suitability, climateSoil's, and the season's months by rain (rainMo) and warm
 *  (warmMo). `work`: cropWork's, newSeason's, newCover's (reused). */
export function cropClimate(T12, P12, latRad, out = {}, work = null) {
    const wk = work ?? (cropClimate._w ??= { crop: cropWork(), season: newSeason(), cover: newCover() });
    const s = growingSeason(T12, P12, wk.season);
    cropHarvests(T12, s, out, FOOD, wk.crop);
    landCover(T12, P12, wk.cover, FINISH, COVER, latRad * 180 / Math.PI);
    climateSoil(wk.cover, out);
    out.tree = treeSeason(T12, P12, latRad);
    out.rainMo = s.rain; out.warmMo = s.warm;
    return out;
}

/** A place's values back from its bytes (`crops`: {key: Uint8Array}) at cell c, into out (cropClimate's keys). */
export function cropsAt(crops, c, out = {}) {
    for (const k of CROP_KEYS) {
        const b = crops[k]?.[c] ?? 0, [kind, , dec] = CROP_BYTES[k];
        if (kind === 'c') { out.rotCls = (b & 15) - 1; out.rotWCls = (b >> 4) - 1; } else out[k] = dec(b);
    }
    return out;
}

/**
 * The crops' bytes (cropCollector's) for `n` cells, each read from the packed months (monthsCollector's) of its cell
 * `src[c]` in them (null: the same cell) at latitude latRadOf(c) — cells whose months are all zero (the sea, ice the
 * climate skipped) left at zero. Worked out on the cells the civ layer reads, not on every cell the finish details.
 */
export function cropsFromMonths(months, n, latRadOf, src = null) {
    const col = cropCollector(n, latRadOf), T12 = new Float64Array(12), P12 = new Float64Array(12);
    for (let c = 0; c < n; c++) {
        const o = 12 * (src ? src[c] : c);
        let any = 0;
        for (let m = 0; m < 12; m++) { const t = months.T[o + m], p = months.P[o + m]; T12[m] = unpackT(t); P12[m] = unpackP(p); any |= t | p; }
        if (any) col.add(c, T12, P12);
    }
    return col.crops;
}

/** A collector for the climate's onCell (as cell-stats.js): cropClimate's values, a byte each (CROP_BYTES). */
export function cropCollector(n, latRadOf) {
    const crops = Object.fromEntries(CROP_KEYS.map(k => [k, new Uint8Array(n)])), s = {}, work = { crop: cropWork(), season: newSeason(), cover: newCover() };
    return {
        crops, add(c, T12, P12) {
            cropClimate(T12, P12, latRadOf(c), s, work);
            for (const k of CROP_KEYS) {
                const [kind, enc] = CROP_BYTES[k];
                crops[k][c] = kind === 'c' ? (s.rotCls + 1) | ((s.rotWCls + 1) << 4) : enc(s[k]);
            }
        },
    };
}
