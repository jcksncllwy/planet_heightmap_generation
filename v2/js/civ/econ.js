// The economy (plans/CIV_PLAN.md §9.3; sources: plans/CIV_SOURCES.md): what a cell's people eat, by return. Each resource
// (substrate.js FOODS) feeds so many people per km² at full skill; work goes where it returns the most, each resource's
// return falling as it is used up — so the low-ranked ones enter the diet as the high-ranked ones run short (the
// diet-breadth model: MacArthur & Pianka 1966; Kelly 2013). The domesticates (crops and herds) are things carried: a
// cell has one once a front of it has come (sim.js), and its organism is domesticated (D, 0–1) by use over ~2000 years.

import { CIV } from './civ-config.js';
import { FOODS, WILD_FOODS } from './substrate.js';

const lin = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));

/**
 * The domesticates: each crop class and the herds, with its wild form — how well the wild ancestors grow here (0–1), where
 * cultivation can begin and where the cultivated form can go before it is domesticated.
 *   from       the wild resource (FOODS) its wild form is: cultivating it takes those stands over
 *   wild(c)    the wild form's stands, 0–1: the packages' wild cereals and roots (substrate.js `wild`); tree crops in
 *              forest; rice and taro's wild forms in marshes and wet ground; wild sheep, goats and aurochs (`wildHerd`)
 *   suit(c)    the domesticated form's own suitability, 0–1 (its capacity against its best)
 */
export function domesticates(sub, C = CIV) {
    const full = f => { const x = C.cropFood[f]; return x.yieldKg * 100 * (1 - x.fallow) * (1 - 1 / x.seedRatio) / C.grainPerPersonKg; };
    const suitOf = f => { const a = sub.food[f], k = full(f); return c => Math.min(1, a[c] / k); };
    // (a wild form's stands by the crop's ground and season without the farmers' fallow: substrate.js `stand`)
    const standOf = f => { const a = sub.stand?.[f] ?? sub.food[f], k = full(f); return c => Math.min(1, a[c] / k); };
    let herdMax = 0;
    for (let c = 0; c < sub.n; c++) if (sub.food.herds[c] > herdMax) herdMax = sub.food.herds[c];
    return [
        { id: 'winterCereal', food: 'winterCereal', from: 'wildSeeds', cereal: true, wild: c => sub.wild.winterCereal[c], suit: suitOf('winterCereal') },
        { id: 'summerCereal', food: 'summerCereal', from: 'wildSeeds', cereal: true, wild: c => sub.wild.summerCereal[c], suit: suitOf('summerCereal') },
        { id: 'roots', food: 'roots', from: 'wildRoots', wild: c => sub.wild.tuber[c], suit: suitOf('roots') },
        // (ours: the wild forms of the tree crops in closed forest, of rice and taro in marshes and deltas, thinner than the
        // wild cereals' at their best)
        { id: 'tree', food: 'tree', from: 'nuts', wild: c => C.treeWild * standOf('tree')(c) * (1 - sub.open[c]), suit: suitOf('tree') },
        { id: 'flooded', food: 'flooded', from: 'wildSeeds', wild: c => C.floodedWild * standOf('flooded')(c) * sub.wetland[c], suit: suitOf('flooded') },
        { id: 'herds', food: 'herds', from: 'largeGame', herd: true, wild: c => sub.wildHerd[c], suit: c => (herdMax > 0 ? Math.min(1, sub.food.herds[c] / (0.5 * herdMax)) : 0) },
    ];
}

/** Each resource's return per hour at its best, as ranks only (Kelly 2013, ch. 3: large game first, seeds last). */
export const RANK = Object.freeze({ largeGame: 1, aquatic: 0.7, smallGame: 0.5, nuts: 0.4, wildRoots: 0.35, wildSeeds: 0.3,
    winterCereal: 0.25, summerCereal: 0.25, roots: 0.25, tree: 0.25, flooded: 0.25, herds: 0.6 });

/**
 * Equal marginal return: N people over resources of capacity K[r] (persons/km²) and best return a[r], each r's return
 * falling linearly to nothing as it is used up (a·(1 − x/K)). Every resource in use returns the same at the margin λ, so
 * x[r] = K[r]·(1 − λ/a[r]) for a[r] > λ, else 0 — solved by adding resources from the best down (water-filling). Past
 * Σ K, everything is used up (x = K). Writes x; returns λ (0 when the people are at or past what the land feeds).
 */
export function allocate(K, a, N, x, m = K.length, order = null) {
    let total = 0;
    for (let r = 0; r < m; r++) total += K[r];
    if (N >= total) { for (let r = 0; r < m; r++) x[r] = K[r]; return 0; }
    // (best return first)
    const o = order ?? Array.from({ length: m }, (_, i) => i);
    for (let i = 1; i < m; i++) { const r = o[i]; let j = i - 1; while (j >= 0 && a[o[j]] < a[r]) { o[j + 1] = o[j]; j--; } o[j + 1] = r; }
    let sK = 0, sKa = 0, lam = 0;
    for (let i = 0; i < m; i++) {
        const r = o[i];
        if (!(K[r] > 0) || !(a[r] > 0)) continue;
        sK += K[r]; sKa += K[r] / a[r];
        lam = (sK - N) / sKa;
        // (the next resource joins only if it returns more than the margin as it stands)
        let next = 0;
        for (let k = i + 1; k < m; k++) if (K[o[k]] > 0 && a[o[k]] > 0) { next = a[o[k]]; break; }
        if (lam >= next) break;
    }
    lam = Math.max(0, lam);
    for (let r = 0; r < m; r++) x[r] = K[r] > 0 && a[r] > lam ? K[r] * (1 - lam / a[r]) : 0;
    return lam;
}

/** How much of a complex skill (farming, herding) a people can hold: by the people within reach (Henrich 2004's idea; our
 *  form, N / (N + skillPeople)). */
export const skillCap = (people, C = CIV) => people / (people + C.skillPeople);

/** A skill's learning over a step: toward 1 by use (its share of the diet against useShare), fading when unused. */
export function learn(s, w, C = CIV) {
    if (w > 0.01) return s + (C.stepYears / C.skillYears) * Math.min(1, w / C.useShare) * (1 - s);
    return s * Math.max(0, 1 - C.stepYears / C.forgetYears);
}

/** Domestication's progress over a step: by use of the cultivated form (~domesticationYears at useShare of the diet). Herds
 *  go on past 1, to 2: their milk (the secondary products; Sherratt 1981), by use over dairyYears. */
export const domesticate = (D, w, herd = false, C = CIV) => (D < 1 ? Math.min(1, D + (C.stepYears / C.domesticationYears) * lin(0, C.useShare, w))
    : herd ? Math.min(2, D + (C.stepYears / C.dairyYears) * lin(0, C.useShare, w)) : D);

/** What a domesticate feeds at domestication D, persons/km²: its wild form's stands (Kwild), taken over by its cultivation,
 *  becoming the crop's own capacity (Kcrop) as it is domesticated (plans/CIV_PLAN.md §9.3); herds their meat alone until
 *  milked. 0 where it feeds less than the stands gathered wild: then no one cultivates (Winterhalder & Kennett 2006). */
export function cultivated(D, Kwild, Kcrop, herd = false, C = CIV) {
    const crop = Kcrop * (herd ? C.herdMeat + (1 - C.herdMeat) * Math.max(0, D - 1) : 1), k = Kwild + (crop - Kwild) * Math.min(1, D);
    return k >= Kwild ? k : 0;
}
