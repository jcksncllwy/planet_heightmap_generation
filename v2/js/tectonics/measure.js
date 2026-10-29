// Measurements on Frames, shared by the lab's stat panels and the check scripts.

import { CrustType, VolcanicType, CrustFlag } from './model/crust.js';
import { BoundaryKind } from './model/world.js';
import { polarFrame } from '../core/sphere-geom.js';

/**
 * What kind of coast a continent's edge is (Phase 7b), for shelves and coastal ranges in Phase 8. The low bits say
 * what the plate does out to sea, the high bits which way the coast faces relative to the plate's motion.
 */
export const Margin = Object.freeze({
    NONE: 0,          // not a coast
    PASSIVE: 1,       // no trench offshore: a rifted, trailing or quiet edge — wide shelves, low coasts
    ACTIVE: 2,        // the plate's own trench offshore: narrow shelf, a coastal range
    TRANSFORM: 3,     // the plate slides past its neighbour here
    COLLISION: 4,     // land meets land
    TYPE: 7,          // mask for the above
    LEADING: 8,       // the coast faces the way the plate moves
    TRAILING: 16,     // the coast faces away from it
    EROSIVE: 32,      // an ACTIVE coast whose trench is erosive: the coast retreats (Phase 7c)
});

/**
 * Classify every coast of a frame. A coast is a land cell next to sea. It is ACTIVE if, going out to sea over its
 * own plate within marginReachKm, the first boundary met carries that plate's trench; PASSIVE if it is
 * a ridge, the lower plate's edge (its ocean going down another plate's trench), or nothing at all; TRANSFORM or
 * COLLISION likewise. Then LEADING / TRAILING by the angle between the coast's seaward normal and the plate's motion.
 * @returns {Uint8Array} Margin bits per world cell
 */
export function classifyMargins(frame, mesh, config) {
    const { numCells, adjOffset, adjList, xyz, edgeKm } = mesh, out = new Uint8Array(numCells);
    const reach = Math.max(1, Math.round(config.marginReachKm / edgeKm)), minSpeed = 0.3 * 10 / 6371;
    const land = w => frame.owner[w] >= 0 && frame.type[w] !== CrustType.OCEAN;
    const seen = new Int32Array(numCells).fill(-1);
    for (let w = 0; w < numCells; w++) {
        if (!land(w)) continue;
        let nx = 0, ny = 0, nz = 0, coast = false;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
            const nb = adjList[k];
            if (land(nb)) continue;
            coast = true;
            nx += xyz[3 * nb] - xyz[3 * w]; ny += xyz[3 * nb + 1] - xyz[3 * w + 1]; nz += xyz[3 * nb + 2] - xyz[3 * w + 2];
        }
        if (!coast) continue;
        // out to sea over this plate: the first boundary met says what the margin is
        const plate = frame.owner[w];
        let type = Margin.PASSIVE;
        seen[w] = w;
        search: for (let ring = [w], hop = 0; hop <= reach && ring.length; hop++) {
            const next = [];
            for (const c of ring) {
                const kind = frame.boundary[c];
                if (kind === BoundaryKind.OVERRIDING || frame.trench[c] > 0) { type = Margin.ACTIVE | (frame.flags[c] & CrustFlag.EROSIVE ? Margin.EROSIVE : 0); break search; }     // a trench is there (converging this instant or not)
                if (kind === BoundaryKind.TRANSFORM) { type = Margin.TRANSFORM; break search; }
                if (kind === BoundaryKind.COLLISION) { type = Margin.COLLISION; break search; }
                if (kind === BoundaryKind.RIDGE || kind === BoundaryKind.SUBDUCTING) break search;          // passive
                for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                    const nb = adjList[k];
                    if (seen[nb] === w || frame.owner[nb] !== plate || (land(nb) && hop > 0)) continue;      // seaward, on its own plate
                    seen[nb] = w; next.push(nb);
                }
            }
            ring = next;
        }
        // which way the coast faces, relative to the plate's motion
        const om = frame.plates[plate].omega, px = xyz[3 * w], py = xyz[3 * w + 1], pz = xyz[3 * w + 2];
        const vx = om[1] * pz - om[2] * py, vy = om[2] * px - om[0] * pz, vz = om[0] * py - om[1] * px, speed = Math.hypot(vx, vy, vz), nl = Math.hypot(nx, ny, nz);
        let motion = 0;
        if (speed > minSpeed && nl > 0) {
            const cos = (nx * vx + ny * vy + nz * vz) / (nl * speed);
            motion = cos > config.marginMotionCos ? Margin.LEADING : cos < -config.marginMotionCos ? Margin.TRAILING : 0;
        }
        out[w] = type | motion;
    }
    return out;
}

/** A volcanic pile smaller than this (km) is only the hotspot swell between eruptions, not a volcano. */
export const SEAMOUNT_KM = 1;
/** An island is worn down this fast (km/Myr) once it stops erupting — and the sea floor under it keeps sinking. */
export const ISLAND_EROSION_KM_PER_MYR = 0.15;

/** Depth of ocean floor of a given age (km), by half-space cooling (Parsons & Sclater), flattening out on old floor. */
export function seaDepthKm(crustAgeMyr) { return Math.min(6.4, 2.6 + 0.345 * Math.sqrt(Math.max(0, crustAgeMyr))); }

// ── An island arc's crest, from its crust (2026-10-28, branch arcs). An arc is ocean lithosphere with crust added to it by
// its volcanoes while its slab feeds them — 8 km at birth, 0.4 km/Myr while active, up to ~35 km (tectonics/config.js
// arcBirthKm…arcMaxKm; Izu-Bonin-Mariana 20–35 km after ~50 Myr, Kodaira et al. 2007; Calvert 2011) — and it stands by
// Airy isostasy on that crust: each km of crust more than the ocean's 7 km (White et al. 1992) lifts it
// (ρm − ρarc) ÷ (ρm − ρw) km under water, (ρm − ρarc) ÷ ρm km above it (Turcotte & Schubert 2002, §2.2). Arc crust is
// more mafic than continental crust — mean Vp ~6.8 km/s (Calvert 2011) — so denser: 2.97 g/cm³ by the Nafe–Drake curve
// (Brocher 2005); mantle 3.3, sea water 1.03. While active the mantle wedge keeps the arc's lithosphere hot (Hyndman et
// al. 2005): it stands on a ridge's floor (seaDepthKm(0)). Once it falls silent it cools and sinks like sea floor of that
// age (half-space, seaDepthKm(quiet): Parsons & Sclater 1977; Stein & Stein 1992), and what stood above the sea is worn
// down at the rate a dead volcanic island is (ISLAND_EROSION_KM_PER_MYR) — down to the sea, never below: the waves
// plane it, and then it sinks. So a young arc is a submerged ridge its volcanoes break (8–20 km: 2.4–0.7 km deep, the
// Marianas), a long-lived one is land (35 km: ~1 km up, Japan), and a remnant arc drowns — 20 km of crust 25 Myr after
// it fell silent lies 2.6 km down (the Kyushu–Palau Ridge, 2–3 km down ~25 Myr after the Shikoku Basin split it off:
// Ishizuka et al. 2011).
const OCEAN_CRUST_KM = 7, ARC_RHO = 2.97, MANTLE_RHO = 3.3, WATER_RHO = 1.03;
const ARC_LIFT_WET = (MANTLE_RHO - ARC_RHO) / (MANTLE_RHO - WATER_RHO), ARC_DRY_SHARE = (MANTLE_RHO - WATER_RHO) / MANTLE_RHO;
const arcStandKm = (crustKm, coolMyr) => { const e = (crustKm - OCEAN_CRUST_KM) * ARC_LIFT_WET - seaDepthKm(coolMyr); return e > 0 ? e * ARC_DRY_SHARE : e; };
/** How far an island arc's crust has grown, 0 at birth (8 km) … 1 at its fullest (35 km; tectonics/config.js arcBirthKm, arcMaxKm). */
export const arcGrowth = crustKm => Math.min(1, Math.max(0, (crustKm - 8) / (35 - 8)));
/** Where an island arc's surface stands against the sea (km; < 0 under water), from its crust (km) and how long it has been silent (Myr). */
export function arcSurfaceKm(crustKm, quietMyr) {
    const q = Math.max(0, quietMyr), up = arcStandKm(crustKm, 0);
    return arcStandKm(crustKm, q) - Math.min(ISLAND_EROSION_KM_PER_MYR * q, Math.max(0, up));
}

// ── A continent's surface, from its crust and its lithosphere (2026-10-28, branch unified) ── one isostatic column for
// every continental cell, in place of a fixed height per kind of crust. A column is its crust (thickness Hc, density ρc)
// and the mantle lithosphere under it down to its base a, both cooler toward the top along a linear geotherm from 0 °C to
// the asthenosphere's Tm (McKenzie 1978's lithosphere, the one terrain/margins.js stretches), floating on asthenosphere of
// density ρa = ρm (1 − α Tm). Against a column of asthenosphere alone it stands a − M ÷ ρa higher (M: its mass per area);
// and a column of asthenosphere alone stands H0 below the sea — read off the mid-ocean ridge, which is that column with
// 7 km of ocean crust on it under seaDepthKm(0) of water: H0 ≈ −2.4 km (Lachenbruch & Morgan 1990, Tectonophysics 174:
// 39–62 — their rule of thumb). Nothing here is set to a height: densities and temperatures (terrain-config.js, the
// same constants terrain/margins.js stretches) and the ridge. With continental crust's mean density, 2.83 g/cm³
// (Christensen & Mooney 1995), a 35 km crust on 125 km of lithosphere stands 0.22 km above the sea and Earth's mean
// crust, ~39 km, 0.84 km — Earth's mean land height. Each km of crust more lifts it (ρm − ρc)(1 − α Tm Hc / a) ÷ ρa ≈
// 0.155 km — so a km of rock worn off the top lowers the ground by only ~1/6 of it: the rest comes back as rebound (Airy;
// Molnar & England 1990, Nature 346: 29–34).
// A craton is a thicker crust (cratonCrustKm) on a thick, cold root (cratonLithKm, 200–350 km: Artemieva & Mooney
// 2001) that is chemically depleted — less dense than fertile mantle at the same temperature by cratonDepletion
// (1.1–1.5 % on average, Kaban et al. 2003, EPSL 209: 53–69; Jordan 1978's isopycnic hypothesis would have it cancel the
// root's cold, Kaban et al. find the cold wins a little). Its cold weighs it down, its depletion buoys it up: what is left
// is its freeboard.
// The record a cell carries (crust.rootKm) is its crust's thickness less its kind's as formed (riftCrustKm, cratonCrustKm):
// thickened by belts, thinned by erosion. The belts' broad relief (crust.upliftKm) and the start world's swells
// (crust.baseKm) are crust too — thickness counted in the height it lifts (÷ the column's slope gives its km) — kept
// apart only because the belts shape it (terrain/profiles.js). An island arc stands by its own column (arcSurfaceKm).
const columns = new WeakMap();
/** The share of an island arc's recorded thickening by belts that lifts it (the rest is its own growth, in its crust: arcSurfaceKm). */
export const ARC_ROOT_SHARE = 0.25;
/** The column's constants for a set of terrain constants: { H0, ref[type] (km above the sea, as formed), slope[type] (km per km of crust), crust[type] (km) }. */
export function columnModel(H) {
    let C = columns.get(H);
    if (C) return C;
    const rm = H.riftMantleRho / 1000, rc = H.riftCrustRho / 1000, rw = H.seaRho / 1000, aT = H.riftExpansion * H.riftMantleC, ra = rm * (1 - aT);
    const H0 = -seaDepthKm(0) * (ra - rw) / ra - OCEAN_CRUST_KM * (1 - H.oceanCrustRho / 1000 / ra);
    // (the mass of a column per area, its crust and its mantle lithosphere each at its mean temperature along the geotherm)
    const stand = (hc, a, dep) => a + H0 - (rc * (hc - aT * hc * hc / (2 * a)) + rm * (1 - dep) * ((a - hc) - aT * (a * a - hc * hc) / (2 * a))) / ra;
    const slope = (hc, a, dep) => (rm * (1 - dep) - rc) * (1 - aT * hc / a) / ra;
    const ord = [H.riftCrustKm, H.riftLithKm, 0], cra = [H.cratonCrustKm, H.cratonLithKm, H.cratonDepletion];
    C = { H0, ref: [0, stand(...ord), stand(...cra), stand(...ord)], slope: [0, slope(...ord), slope(...cra), slope(...ord)], crust: [OCEAN_CRUST_KM, H.riftCrustKm, H.cratonCrustKm, H.riftCrustKm] };
    columns.set(H, C);
    return C;
}
/** Where a continental column stands against the sea (km; mantle swell aside): its kind as formed, and its crust `rootKm` thicker (< 0: thinner). */
export function columnKm(H, type, rootKm) { const C = columnModel(H); return C.ref[type] + C.slope[type] * rootKm; }
/** A continental cell's crust (km): as formed, its thickening or thinning, and the crust its belts' relief and its swells stand for. */
export function crustThicknessKm(H, type, rootKm, upliftKm = 0, baseKm = 0) {
    const C = columnModel(H);
    return C.crust[type] + rootKm + (Math.max(0, upliftKm) + baseKm) / C.slope[type];
}

/**
 * Sediment shallows a sea by less than its own thickness: the floor sinks under the load (Airy). Water of depth d
 * replaced by sediment s: s = d × (ρm − ρw) ÷ (ρm − ρs) — with mantle 3.3, sea water 1.03 and compacted basin fill
 * 2.5 g/cm³, s ≈ 2.84 d: ~17 km of sediment fills 6 km of water (Steckler & Watts 1978; the Black Sea's 14–19 km,
 * Nikishin et al. 2015; the Precaspian's ~20 km; the Gulf of Mexico's ~15 km, Salvador 1991).
 */
export const SEDIMENT_LOAD_FACTOR = (3.3 - 1.03) / (3.3 - 2.5);

/** Is a sea floor of this age filled to sea level by `fillKm` of sediment (a lowland now)? */
export function seaFilledUp(crustAgeMyr, fillKm) { return fillKm > 0 && fillKm >= SEDIMENT_LOAD_FACTOR * seaDepthKm(crustAgeMyr) - 1e-6; }

/** The sea floor's depth (km) under `fillKm` of sediment: what is left of seaDepthKm(age), never below sea level. */
export function filledSeaDepthKm(crustAgeMyr, fillKm) { return Math.max(0, seaDepthKm(crustAgeMyr) - fillKm / SEDIMENT_LOAD_FACTOR); }

/**
 * Where a hotspot volcano's summit stands relative to sea level now (km; > 0 = an island), or null if there is no
 * volcano here. The pile stands on the sea floor, which deepens as the crust ages; once the volcano stops erupting it
 * is worn down — so volcanoes break the surface near the plume and drown downstream (Hawaii, then the Emperor
 * seamounts). On a continent a volcano is on land: +Infinity.
 */
export function volcanoTopKm(frame, w) {
    if (frame.owner[w] < 0 || frame.volcType[w] !== VolcanicType.TRACK || frame.volcKm[w] < SEAMOUNT_KM) return null;
    if (frame.type[w] !== CrustType.OCEAN) return Infinity;
    const floor = seaDepthKm(frame.time - frame.formedAt[w]), worn = ISLAND_EROSION_KM_PER_MYR * (frame.time - frame.volcAt[w]);
    return frame.volcKm[w] - floor - worn;
}

/** Whole-frame tallies, in cells. */
export function frameTallies(frame) {
    const t = { gaps: 0, landOverOcean: 0, collision: 0, land: 0, newOcean: 0, oldOcean: 0, liveTrench: 0, dormantTrench: 0, provisional: 0 };
    const n = frame.owner.length;
    for (let w = 0; w < n; w++) {
        if (frame.owner[w] < 0) { t.gaps++; continue; }
        if (frame.provisional[w]) t.provisional++;
        if (frame.overlap[w] === 1) t.landOverOcean++;
        else if (frame.overlap[w] === 2) t.collision++;
        if (frame.type[w] !== CrustType.OCEAN) t.land++;
        else if (frame.formedAt[w] < 0) t.oldOcean++;
        else t.newOcean++;
        if (frame.trench[w] === 1) t.liveTrench++; else if (frame.trench[w] === 2) t.dormantTrench++;
    }
    t.cells = n;
    return t;
}

/** Cell selector: cells of plate A or B that touch the other one (their mutual contact, e.g. a ridge). */
export function contactBetween(mesh, idA, idB) {
    const { adjOffset, adjList } = mesh;
    return (frame, w) => {
        const o = frame.owner[w];
        if (o !== idA && o !== idB) return false;
        const other = o === idA ? idB : idA;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) if (frame.owner[adjList[k]] === other) return true;
        return false;
    };
}

/**
 * Mean azimuth about `pole` (measured from `ref`, see core/sphere-geom.js polarFrame) of the selected
 * cells within ±bandDeg of ref's distance from the pole. Degrees; 0 if none. Default selection: ridge
 * cells. A circular mean, so cells either side of ±180° average correctly.
 */
export function meanAzimuthDeg(frame, xyz, pole, ref, select = (f, w) => f.boundary[w] === BoundaryKind.RIDGE, bandDeg = 10) {
    const toPolar = polarFrame(pole, ref), refColat = toPolar(ref[0], ref[1], ref[2]).colat;
    let sin = 0, cos = 0;
    for (let w = 0; w < frame.owner.length; w++) {
        if (!select(frame, w)) continue;
        const p = toPolar(xyz[3 * w], xyz[3 * w + 1], xyz[3 * w + 2]);
        if (Math.abs(p.colat - refColat) > bandDeg) continue;
        sin += Math.sin(p.azimuth * Math.PI / 180); cos += Math.cos(p.azimuth * Math.PI / 180);
    }
    return sin === 0 && cos === 0 ? 0 : Math.atan2(sin, cos) * 180 / Math.PI;
}

/**
 * Which row of WBP's speed table a plate belongs to right now, judged from the forces on it
 * (FramePlate.dynamics). `min…max` is the expected speed band in cm/yr.
 */
export const SITUATIONS = Object.freeze({
    subducting: { min: 8, max: 20, label: 'subducting ocean plate' },
    colliding: { min: 0, max: 10, label: 'in collision' },
    active: { min: 1.5, max: 5, label: 'active-margin continent (WBP: 2–5; a huge one like Eurasia 1.5)' },
    ringed: { min: 0, max: 2, label: 'pulled from opposite sides — most of the pull cancels' },
    passive: { min: 0, max: 1, label: 'passive — no trench of its own' },
});
const RINGED_TENSION = 0.6;       // more of the pull than this cancels itself → the plate is in a tug of war
                                  // (a continuum really: the two bands overlap between 1.5 and 2 cm/yr)
const MIN_FORCE_KM = 970;         // a margin shorter than this is a sliver, not a margin
const MIN_LOCK_KM2 = 127500;      // a collision has "locked on" once the overlap covers at least this much

/**
 * Has this plate (a FramePlate) settled at the speed its forces call for? Bands are only a fair test
 * then: a plate that is still spinning up, or braking after a collision, is between situations.
 */
export function isSteady(framePlate) {
    const d = framePlate.dynamics;
    if (!d) return true;
    return Math.abs(framePlate.speedCmYr - d.targetCmYr) <= Math.max(STEADY_ABS_CM_YR, STEADY_SHARE * d.targetCmYr);
}
const STEADY_ABS_CM_YR = 0.3, STEADY_SHARE = 0.15;

export function situationOf(dynamics) {
    if (!dynamics) return 'passive';
    const pull = dynamics.forces.find(f => f.name === 'slab pull'), suction = dynamics.forces.find(f => f.name === 'slab suction');
    if (dynamics.collisionKm2 >= MIN_LOCK_KM2) return 'colliding';
    if (pull.km >= MIN_FORCE_KM && pull.torque > suction.torque) return 'subducting';
    if (suction.km >= MIN_FORCE_KM) return dynamics.tension > RINGED_TENSION ? 'ringed' : 'active';
    return 'passive';
}
