// The civ layer's disease burden (plans/CIV_PLAN.md; sources: plans/CIV_SOURCES.md §Disease): where the land itself makes
// people sick — from the planet's months, its standing water and how its people got there, never pinned to a place.
//
//   vector fever   mosquito-borne fever (malaria): transmission needs months warm enough for the parasite to develop in
//                  the mosquito and wet enough for it to breed, several of them running (Craig, Snow & le Sueur 1999's
//                  climate suitability, the MARA model). Standing water — a wetland, a river's marsh, irrigation
//                  canals — breeds it in a dry climate too: the warm months alone then decide
//   cold filter    the parasite travels with people, and only through country warm enough to keep it in transmission:
//                  where the way runs through cold (Beringia's), it is left behind — the Americas had none before 1492
//   snail fever    schistosomiasis: snails in warm, still, fresh water — irrigation's canals (Egypt's, from the Old
//                  Kingdom's mummies on; Kloos & David 2002), the same filter
//
// These cost people, not food: a share of the people a place would otherwise hold (sim.js).

import { CIV } from './civ-config.js';

const rise = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));

/**
 * One place's vector-fever climate from its twelve months (°C, mm): [suitability with its own rain, with standing water],
 * each 0–1 — the best run of `months` consecutive months, each month the lesser of its temperature's and its rain's
 * suitability (Craig et al. 1999: 0 at 18 °C, 1 from 22 to 32, 0 at 40; 0 at 0 mm, 1 from 80 mm; 5 months).
 */
export function vectorClimate(T12, P12, months = 5) {
    let best = 0, bestWarm = 0;
    for (let m0 = 0; m0 < 12; m0++) {
        let s = 1, sw = 1;
        for (let k = 0; k < months; k++) {
            const m = (m0 + k) % 12, t = T12[m];
            const ft = Math.min(rise(18, 22, t), 1 - rise(32, 40, t)), fp = rise(0, 80, P12[m]);
            s = Math.min(s, Math.min(ft, fp)); sw = Math.min(sw, ft);
        }
        if (s > best) best = s;
        if (sw > bestWarm) bestWarm = sw;
    }
    return [best, bestWarm];
}

/** A collector for the climate's onCell (as cell-stats.js): one byte each, 0–255 for 0–1. */
export function vectorCollector(n) {
    const rain = new Uint8Array(n), warm = new Uint8Array(n);
    return { vector: { rain, warm }, add(c, T12, P12) { const [a, b] = vectorClimate(T12, P12); rain[c] = Math.round(255 * a); warm[c] = Math.round(255 * b); } };
}

/**
 * Where the parasites reached (the cold filter): from the origin(s), over land, the glacial shelves and the era's short
 * crossings (`passable(a, b)`), only into cells warm enough to keep them in transmission (warm ≥ C.filterWarm; a shelf,
 * by `homeOf` its coast's).
 * @param w the world (w.vector: vectorCollector's); @returns Uint8Array, 1 where they are
 */
export function parasiteRange(w, origins, passable, C = CIV, homeOf = c => c) {
    const { mesh } = w, n = mesh.numCells, warm = w.vector?.warm, out = new Uint8Array(n);
    if (!warm) return out;
    const ok = c => { const h = homeOf(c); return h < 0 || warm[h] >= 255 * C.filterWarm; }, stack = [];   // (h < 0: water, crossed by boat)
    for (const c of origins) if (ok(c)) { out[c] = 1; stack.push(c); }
    while (stack.length) {
        const a = stack.pop();
        for (let k = mesh.adjOffset[a]; k < mesh.adjOffset[a + 1]; k++) {
            const b = mesh.adjList[k];
            if (!out[b] && passable(a, b) && ok(b)) { out[b] = 1; stack.push(b); }
        }
    }
    return out;
}

/**
 * The share of a place's people lost to disease, for its way of life: vector fever (by its own rain, or by its standing
 * water where it has some — a wetland, or irrigation), snail fever where it irrigates; foragers on the move less exposed.
 * @param h the place's home cell; @param range parasiteRange's; @param standing 0–1: its standing water; @param irrigating
 */
export function diseaseLoss(w, h, range, standing, irrigating, settled, C = CIV) {
    if (!range[h] || !w.vector) return 0;
    const rain = w.vector.rain[h] / 255, warm = w.vector.warm[h] / 255;
    const fever = rain + (Math.max(rain, warm) - rain) * standing;
    const snail = irrigating ? warm : 0;
    const loss = C.feverLoss * fever + C.snailLoss * snail;
    return Math.min(0.9, settled ? loss : loss * C.foragerExposure);
}
