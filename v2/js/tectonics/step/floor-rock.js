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
//     rock: the books count the two together — check-invariants.mjs "the rivers' rock on the ocean floor closes"). Two
//     columns made one can stand above the sea, or a cell can land on younger, shallower floor: what its water has no room
//     for runs on as the rise's own rock does (fill and spill, step/trench-fans.js layRise) — onto the nearest ocean cells
//     of the same plate with room under the sea's surface (lane riserock).
// Records and books only: the history's path does not read them.

import { CrustType } from '../model/crust.js';
import { seaDepthKm, SEDIMENT_LOAD_FACTOR } from '../measure.js';

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
    if (!(v > 0)) return;
    to.riseKm3[q] += v;
    if (to.type[q] === CrustType.OCEAN) spillOverBrim(world, to, q);
}

/** The rock (km³) ocean cell `c` can hold: its water to the sea's surface filled, Airy-loaded (measure.js
 * SEDIMENT_LOAD_FACTOR) — the floor's depth from its age (seaDepthKm). */
export function brimKm3(world, crust, c) {
    return SEDIMENT_LOAD_FACTOR * seaDepthKm(world.time - crust.formedAt[c]) * world.mesh.cellAreaKm2;
}

/** Ocean cell `q`'s rock above its brim runs on over `crust`'s own ocean cells, nearest first, each filled to its brim (a
 * raster shares the mesh's cells, so its neighbours are the mesh's — no world map needed: the merges run mid-shuffle).
 * What the whole plate has no room for stays on `q`: none is lost. */
function spillOverBrim(world, crust, q) {
    const A = world.mesh.cellAreaKm2, rock = c => crust.riseKm3[c] + crust.seaFillKm[c] * A;
    let left = Math.min(crust.riseKm3[q], rock(q) - brimKm3(world, crust, q));   // (only rise rock moves; a sea's fill is its own)
    if (!(left > 0)) return;
    const { adjOffset, adjList, numCells: n } = world.mesh;
    if (spill.seen?.length !== n) { spill.seen = new Int32Array(n); spill.tick = 0; }
    const seen = spill.seen, tick = ++spill.tick, ring = spill.ring;
    ring.length = 0; ring.push(q); seen[q] = tick;
    crust.riseKm3[q] -= left;
    for (let i = 0; i < ring.length && left > 0; i++) {
        const c = ring[i];
        if (i > 0) { const room = brimKm3(world, crust, c) - rock(c); if (room > 0) { const v = Math.min(room, left); crust.riseKm3[c] += v; left -= v; } }
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (seen[nb] !== tick && crust.mask[nb] && crust.type[nb] === CrustType.OCEAN) { seen[nb] = tick; ring.push(nb); } }
    }
}
const spill = { seen: null, tick: 0, ring: [] };
