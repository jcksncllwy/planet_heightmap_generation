// Who goes down when two pieces of crust converge. One rule, used by both the resolve
// pass (which crust to delete) and boundary classification (which side is the trench).

import { CrustType, CrustFlag } from '../model/crust.js';
import { arcBuoyancyKm } from '../measure.js';
import { TERRAIN } from '../../terrain/terrain-config.js';

/**
 * Is this crust too buoyant to subduct? Continental crust always; island-arc crust when its column — its crust and the
 * mantle lid under it, cooled since its slab last fed it — is lighter than the asthenosphere (measure.js arcBuoyancyKm,
 * Cloos 1993; lane contarea: was a fixed 17 km of crust, arcAccreteThickKm). A heavy arc goes down a trench like floor,
 * its light upper crust scraped off onto the upper plate (resolve.js, collision.js: measure.js arcScrapedKm3). A fore-arc
 * isle floats, and so does an arc the history never grew (arcKm 0: a scene's). `arcs`: the world (its time and terrain
 * constants) when arcs are judged by their column (config.arcRecycling); null, every arc floats.
 */
function floats(crust, cell, arcs) {
    const t = crust.type[cell];
    if (t === CrustType.OCEAN) return false;
    if (t !== CrustType.ARC || !arcs || !(crust.arcKm[cell] > 0) || (crust.flags[cell] & CrustFlag.MARGIN_ISLE) !== 0) return true;
    return arcFloats(crust, cell, arcs);
}

/** Does arc cell `cell` of `crust` float (its column lighter than the asthenosphere)? `world`: its time and terrain constants. */
export function arcFloats(crust, cell, world) {
    return arcBuoyancyKm(crust.arcKm[cell], world.time - crust.arcAt[cell], world.config.heights ?? TERRAIN) > 0;   // (heights.js heightsOf)
}

/**
 * Does crust (plateA, cellA) override crust (plateB, cellB)?
 * Returns true / false, or null when neither can subduct (land against land = collision).
 * `decided` is the id of the plate that overrides along this stretch of boundary, from the
 * segment-wise vote in boundaries.js (−1 = no decision yet); it settles ocean against ocean, where
 * the per-cell rules below would otherwise interleave and leave the front ragged.
 */
export function overrides(plateA, cellA, plateB, cellB, decided = -1, arcs = null) {
    const a = plateA.crust, b = plateB.crust;
    const landA = floats(a, cellA, arcs), landB = floats(b, cellB, arcs);
    if (landA && landB) return null;              // continental crust never subducts
    if (landA !== landB) return landA;            // ocean always goes under land

    // Ocean against ocean:
    // 0. the whole segment goes the way it was voted (one trench line, not a cell-by-cell patchwork)
    if (decided >= 0 && (decided === plateA.id || decided === plateB.id)) return decided === plateA.id;
    // 1. an established trench keeps its polarity (persistent subduction zones)
    const trenchA = (a.flags[cellA] & CrustFlag.TRENCH) !== 0, trenchB = (b.flags[cellB] & CrustFlag.TRENCH) !== 0;
    if (trenchA !== trenchB) return trenchA;
    // 2. the passive pre-history ocean always loses
    if (plateA.isBackground !== plateB.isBackground) return plateB.isBackground;
    // 3. older crust is colder and denser, so it sinks under younger crust
    if (a.formedAt[cellA] !== b.formedAt[cellB]) return a.formedAt[cellA] > b.formedAt[cellB];
    // 4. same age (two flanks of one ridge brushing each other): no physical preference, so the
    //    tie-break must not favour either plate — alternate by cell parity.
    return ((cellA ^ cellB) & 1) === 0 ? plateA.id < plateB.id : plateA.id > plateB.id;
}

