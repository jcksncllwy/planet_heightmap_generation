// Shortening keeps the crust it consumes (lane crust, stage 1b; config.collisionVolume). Continental crust does not
// subduct as a slab: what a collision takes out of the map — the lower plate's edge going under, the overlap a weld
// absorbs — is folded into the crust above as thickness (Tibet's ~70 km crust is India's and Asia's own, shortened),
// less a small share the collision really returns to the mantle. Without this the engine deleted ~2.7–3.1 Gkm³ of
// continent per 1200 Myr cycle at collisions, ~2.5 AU against Earth's ~0.7 (crust-report.md §1).
// Reduced model, and its limits: the volume is laid on the upper plate's continent nearest the front, each cell filled to
// a thickest root before the next ring takes the rest (a plateau widening as it fills: Tibet grew outward, its edges the
// youngest); where it stands then is heights.js's (its collapse spreads it further); no lower-crustal channel flow, no
// eclogite foundering beyond the lost share.

import { CrustType } from '../model/crust.js';

/** The crust (km) of a continental cell of raster `cr`: its kind's as formed plus its root (measure.js columnModel C). */
export const crustOf = (cr, c, C) => Math.max(0, C.crust[cr.type[c]] + cr.rootKm[c]);

/** Σ crust (cell-km) over a plate's continent and craton. */
export function continentVolume(plate, C) {
    const { mask, type } = plate.crust;
    let v = 0;
    for (let c = 0; c < mask.length; c++) if (mask[c] && (type[c] === CrustType.CONTINENT || type[c] === CrustType.CRATON)) v += crustOf(plate.crust, c, C);
    return v;
}

/**
 * Lay `volKm` (cell-km of crust) on `plate`'s continent, from the raster cells `seeds` outward ring by ring, each cell's
 * root raised to at most `maxRootKm` (thickKm, the belt's record of thickening, follows). Cratons take none (too strong
 * to thicken: Lenardic & Moresi 1999). @returns {number} the volume that found no room (0 normally)
 */
export function layThickening(plate, mesh, seeds, volKm, maxRootKm, maxHops = 64) {
    if (!(volKm > 0)) return 0;
    const cr = plate.crust, { adjOffset, adjList } = mesh, seen = new Set();
    let ring = [];
    for (const c of seeds) if (!seen.has(c) && cr.mask[c] && cr.type[c] !== CrustType.OCEAN) { seen.add(c); ring.push(c); }
    for (let hop = 0; ring.length && volKm > 1e-9 && hop <= maxHops; hop++) {
        // (a ring at a time, shared evenly: the front's whole length thickens together, not its first cell)
        const room = ring.filter(c => cr.type[c] === CrustType.CONTINENT && cr.rootKm[c] < maxRootKm);
        let left = room.length;
        for (const c of room) {
            const add = Math.min(maxRootKm - cr.rootKm[c], volKm / left--);
            cr.rootKm[c] += add; cr.thickKm[c] += add; volKm -= add;
        }
        const next = [];
        for (const c of ring) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (!seen.has(nb) && cr.mask[nb] && cr.type[nb] !== CrustType.OCEAN && cr.type[nb] !== CrustType.ARC) { seen.add(nb); next.push(nb); }
        }
        ring = next;
    }
    plate.dirty = true;
    return Math.max(0, volKm);
}
