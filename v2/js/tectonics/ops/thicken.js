// Shortening keeps the crust it consumes (lane crust, stage 1b; config.collisionVolume). Continental crust does not
// subduct as a slab: what a collision takes out of the map — the lower plate's edge going under, the overlap a weld
// absorbs — is folded into the crust above as thickness (Tibet's ~70 km crust is India's and Asia's own, shortened),
// less a small share the collision really returns to the mantle. Without this the engine deleted ~2.7–3.1 Gkm³ of
// continent per 1200 Myr cycle at collisions, ~2.5 AU against Earth's ~0.7 (crust-report.md §1).
// Reduced model, and its limits: the volume is laid across the collision's own belt on the upper plate, in the belt's
// plateau profile (1 − u², the shape spreadBelt thickens by: thickest behind the front, thinning to its far edge — the
// thin viscous sheet's crustal thickening across a deforming zone, England & Houseman 1986), each cell to a thickest root;
// what finds no room there goes on the continent nearest the front, each cell filled before the next ring takes the
// rest (a plateau widening as it fills: Tibet grew outward, its edges the youngest); where it stands then is heights.js's (its collapse spreads it further); no lower-crustal channel flow, no
// eclogite foundering beyond the lost share.

import { CrustType, OrogenyType } from '../model/crust.js';
import { bookRock } from '../rock-book.js';
import { spreadKm } from '../../core/min-heap.js';

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
 * Lay `volKm` (cell-km of crust) over `cells` in proportion to `weights` (each cell's root raised to at most `maxRootKm`;
 * what a full cell would have taken goes to the others: water-filling). @returns {number} the volume that found no room
 */
export function layProfile(plate, cells, weights, volKm, maxRootKm) {
    const cr = plate.crust;
    let open = cells.map((c, i) => i).filter(i => weights[i] > 0 && cr.rootKm[cells[i]] < maxRootKm);
    for (let pass = 0; open.length && volKm > 1e-9 && pass < 16; pass++) {
        let W = 0;
        for (const i of open) W += weights[i];
        let laid = 0;
        for (const i of open) {
            const c = cells[i], add = Math.min(maxRootKm - cr.rootKm[c], volKm * weights[i] / W);
            if (add > 0) cr.foldSeaFill(c);                  // (a sea's fill on it, shortened with it: its crust now — model/crust.js)
            cr.rootKm[c] += add; cr.thickKm[c] = Math.min(maxRootKm, cr.thickKm[c] + add); laid += add;
        }
        volKm -= laid;
        open = open.filter(i => cr.rootKm[cells[i]] < maxRootKm - 1e-9);
    }
    plate.dirty = true;
    return Math.max(0, volKm);
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
            if (add > 0) cr.foldSeaFill(c);                  // (as layProfile)
            // (thickKm, the record, is held to the same ceiling: a worn cell — its root below its record — takes volume
            // into its root again, but its record was already at most the ceiling, as the belts' own thickening is)
            cr.rootKm[c] += add; cr.thickKm[c] = Math.min(maxRootKm, cr.thickKm[c] + add); volKm -= add;
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

/**
 * The distance (km, along `plate`'s land) of each of its raster cells from the nearest of `seeds`, out to `maxKm` (Infinity
 * beyond, or across sea): where the crust a front shortened is laid (lane beltthick). A scratch array, valid until the next call.
 */
export function landDistanceKm(mesh, plate, seeds, maxKm) {
    const { mask, type } = plate.crust, n = mask.length;
    if (!nearScratch || nearScratch.length !== n) nearScratch = new Float32Array(n);
    const dist = nearScratch.fill(Infinity);
    for (const c of seeds) if (c >= 0 && c < n) dist[c] = 0;
    return spreadKm(mesh, dist, { canEnter: (a, b) => mask[b] && type[b] !== CrustType.OCEAN, maxKm });
}
let nearScratch = null;

/**
 * (config.collisionVolume, lane crust 1b) Crust a collision took out of the map — `volKm` cell-km, underthrust or absorbed
 * at a weld — goes into the upper plate's crust from `seeds` outward (ops/thicken.js), less collisionLostShare of it,
 * which goes back to the mantle. Booked in world.budget (cell-km) under `book` ('collision'; 'dock' for land the ops dock with no
 * room beside it: ops/scrape-arc.js, tidy-plates.js, accrete-terrane.js): <book>KeptKm, <book>LostKm, <book>UnplacedKm, and
 * the rock book <book>KeptKm3.
 * `since` (Myr): the collision's start — its belt is every collision-belt cell it has stamped since.
 */
export function keepConsumed(world, U, seeds, volKm, since, book = 'collision') {
    const { config, budget } = world, lost = volKm * config.collisionLostShare, kept = volKm - lost;
    // across the collision's belt on the upper plate — every cell it has stamped since it began, not only this step's: the
    // deforming zone is the belt the convergence built (England & Houseman 1986), and the weld, which absorbs the most, comes
    // after the seam has stalled, a step that stamps no belt at all (on seeds 1 and 2 of phase5's India the weld found no
    // cell stamped that step and ring-filled ~100 cells to the ceiling: a spike, not a plateau) — in its plateau profile
    // (1 − u²); the rest ring by ring from the front
    // (config.collisionKeepLocal, lane beltthick: only the belt cells within their own belt's reach of where this step's crust
    // was consumed — the crust shortened at a stretch of front thickens the belt behind that stretch, mass balance per km of
    // front: Δh = S·h₀ ÷ W. Was every collision-belt cell the upper plate had stamped since the collision began, wherever it
    // stood: a supercontinent's whole stock of belts, up to ~6,600 cells (~85 Mkm²) for one front, so a Tibet's worth of
    // shortening thickened each by a few hundred metres — lanes-2026-10-29/beltthick/report.md)
    const cr = U.crust, belt = [], weights = [], local = !!config.collisionKeepLocal;
    const near = local ? landDistanceKm(world.mesh, U, seeds, Math.max(config.belts.himalayan.maxKm, config.belts.ural.maxKm) * config.beltSpeedFactorMax) : null;
    for (let c = 0; c < cr.mask.length; c++) {
        if (!cr.mask[c] || cr.type[c] !== CrustType.CONTINENT || !(cr.beltAt[c] >= since) || !(cr.beltReach[c] > 0)) continue;
        if (cr.oroType[c] !== OrogenyType.HIMALAYAN && cr.oroType[c] !== OrogenyType.URAL) continue;
        if (local && !(near[c] <= cr.beltReach[c])) continue;
        belt.push(c); weights.push(1 - Math.min(1, cr.beltU[c]) ** 2);
    }
    const rest = layProfile(U, belt, weights, kept, config.underthrustMaxThickKm);
    const left = layThickening(U, world.mesh, seeds, rest, config.underthrustMaxThickKm);
    bookRock(`${book}KeptKm3`, (kept - left) * world.mesh.cellAreaKm2);        // (the rock book: laid back as thickness; the lost share and the unplaced are gone)
    budget[`${book}KeptKm`] = (budget[`${book}KeptKm`] ?? 0) + kept - left;
    budget[`${book}LostKm`] = (budget[`${book}LostKm`] ?? 0) + lost;
    budget[`${book}UnplacedKm`] = (budget[`${book}UnplacedKm`] ?? 0) + left;
    U.dirty = true;
}
