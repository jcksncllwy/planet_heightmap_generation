// The computed climate's water per cell, for the timeline's cut-off seas (2026-11-10, the real-climate balance; Jackson
// approved). basin-estimate.js balances a sea cut off from the world ocean on the zonal climate (rain by latitude, less
// inland), which cannot know a rain shadow, a monsoon, or that a sea of tens of Mkm² makes its own rain. For a frame with
// such a sea (CLIMATE_MIN_KM2) the page computes the climate (climate/climate.js planetClimate, on its climate worker,
// at 3° — or takes the Climate tab's, at 1°, where it has one) and hands the shading worker this: each cell's year of
// rain, potential evaporation and runoff (mm), assembled as the finish assembles them (finish/finish.js, its own
// helpers — so the timeline's estimate and the finish disagree only by the finish's surface, not its sums):
//
//  · rain: the climate's per-cell year (pAnnual), its rare wet hotspots capped at F.rainMaxMm; ground the climate does not
//    classify (below sea level, the sea) takes its grid's year;
//  · runoff: the liquid share of it (thawedWater: snow kept where no month melts it) less Fu's evaporation (budykoW)
//    against the land's potential evaporation — the climate's Priestley–Taylor at its anchors, made months
//    (potentialMonths), summed over the year and read at the cell (bilinear);
//  · pet: that potential evaporation (at least F.petMinMm), what a hollow's open water loses.
// The ice's discharge (finish.js iceDischarge — the kept snow melting at a sheet's margin) is not run: a frame's view
// has no ice sheets, and its runoff only feeds the cut-off seas' catchments.

import { FINISH } from '../finish/finish-config.js';
import { thawedWater, potentialMonths, bilinear } from '../finish/finish.js';
import { CORE_DEFAULTS } from '../climate/core.js';
import { fuEvaporation } from '../climate/water.js';

/**
 * Each cell's year of water from planetClimate's result `res`, on the terrain the climate was computed on (`z`, km above
 * the sea): {rain, pet, runoff} (Float32Array, mm/year) — basin-estimate.js estimateCutOff's `climate`.
 */
export function climateWater(res, z, F = FINISH) {
    const n = z.length, G = res.grid.size, grid = { w: res.grid.w, h: res.grid.h }, { lat, lon } = res.cell;
    const gamma = CORE_DEFAULTS.lapseRateCPerKm, rain = Float32Array.from(res.cell.pAnnual);
    for (let c = 0; c < n; c++) if (rain[c] > F.rainMaxMm) rain[c] = F.rainMaxMm;
    // (the grid's year, for the ground the climate leaves unclassified — as the finish: finish.js, its climate stage)
    const pG = new Float32Array(G);
    for (let g = 0; g < G; g++) { let p = 0; for (let m = 0; m < 12; m++) p += res.months.P[m * G + g]; pG[g] = p; }
    for (let c = 0; c < n; c++) if (!(rain[c] === rain[c])) rain[c] = bilinear(grid, pG, lat[c], lon[c]);
    const liquid = thawedWater(res.months, res.surface.meanLandKm, grid, G, z, rain, lat, lon, gamma, F, n);
    const petM = potentialMonths(res, G, F), petG = new Float32Array(G);
    for (let g = 0; g < G; g++) for (let m = 0; m < 12; m++) petG[g] += Math.max(0, petM[m * G + g]);
    const pet = new Float32Array(n), runoff = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        const P = Math.max(0, liquid.rain[c]), E0 = Math.max(F.petMinMm, bilinear(grid, petG, lat[c], lon[c]));
        pet[c] = E0;
        runoff[c] = P - fuEvaporation(P, E0, F.budykoW);
    }
    return { rain, pet, runoff, gridDeg: 180 / res.grid.h };
}

/** The buffers of climateWater's result, to hand over. */
export const climateWaterTransfers = w => [w.rain.buffer, w.pet.buffer, w.runoff.buffer];
