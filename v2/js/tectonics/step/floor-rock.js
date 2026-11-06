// The rivers' rock on the ocean floor (lane crustfu2, 2026-11-05): an open margin's rise (crust.riseKm3, step/trench-fans.js
// layRise) and an enclosed sea's fill (crust.seaFillKm, step/sea-fill.js). It rides its plate; where the floor ends, its rock
// is booked, never silently dropped:
//   · at a trench — or a plate that runs out of floor (step/ocean-plates.js) — it meets the trench as any incoming sediment
//     does: the plate drags the base of the section down the subduction channel, about accretionSedimentKm of it, and the
//     rest is scraped off into the prism (Clift & Vannucchi 2004; the channel: Cloos & Shreve 1988; the law of
//     step/sediment-subduction.js, × sedimentSubductionShare): world.budget.riseDownKm3 / riseKeptKm3, seaFillDownKm3 /
//     seaFillKeptKm3;
//   · where a floor cell is merged onto crust another plate already has there (ops/tidy-plates.js, ops/accrete-terrane.js) or
//     handed to the background ocean, its rock goes with it, onto that cell's riseKm3 (a sea's fill moved so becomes rise
//     rock: the books count the two together — check-invariants.mjs "the rivers' rock on the ocean floor closes").
// Records and books only: the history's path does not read them.

import { CrustType } from '../model/crust.js';

/** The rivers' rock on crust cell `c` (km³): its rise, and an ocean cell's sea fill. */
export function floorRockKm3(crust, c, cellAreaKm2) {
    return crust.riseKm3[c] + (crust.type[c] === CrustType.OCEAN ? crust.seaFillKm[c] * cellAreaKm2 : 0);
}

/** Book the rock on ocean cell `c` as it goes down a trench (call before the cell is removed). */
export function bookSubductedFloorRock(world, crust, c) {
    if (crust.type[c] !== CrustType.OCEAN) return;
    const A = world.mesh.cellAreaKm2, rise = crust.riseKm3[c], fill = crust.seaFillKm[c] * A;
    if (!(rise > 0) && !(fill > 0)) return;
    const B = world.budget, T = (rise + fill) / A, down = Math.min(1, world.config.accretionSedimentKm / T) * world.config.sedimentSubductionShare;
    B.riseDownKm3 = (B.riseDownKm3 ?? 0) + rise * down;
    B.riseKeptKm3 = (B.riseKeptKm3 ?? 0) + rise * (1 - down);
    B.seaFillDownKm3 = (B.seaFillDownKm3 ?? 0) + fill * down;
    B.seaFillKeptKm3 = (B.seaFillKeptKm3 ?? 0) + fill * (1 - down);
}

/** Cell `c` of `from` is dropped where `to` already has crust at `q`: its rock goes onto `q` (as rise rock). */
export function mergeFloorRock(world, to, q, from, c) {
    const v = floorRockKm3(from, c, world.mesh.cellAreaKm2);
    if (v > 0) to.riseKm3[q] += v;
}
