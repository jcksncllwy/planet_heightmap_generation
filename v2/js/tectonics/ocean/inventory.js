// The ocean as a conserved water inventory (lane ocean, 2026-11-03; a study prototype, wired into nothing). Jackson:
// "modeling pouring an earth-like amount of water onto the planet and letting it settle to determine where oceans are."
// The sea's level is not a formula over the mantle's heat and the floor's age (terrain/sea-level.js) but the level at
// which a fixed volume of water, poured into the lowest ground and spilling outward, stands: the hypsometry of the
// ground connected to the ocean, integrated up to the level that holds the volume. What the formula reckons (a swell
// that lifts the ocean's floor pushes the water up; young ridges displace it) falls out of the volume by itself.
//
// Reduced model, and what it skips: (1) one water body, at equilibrium, filled from the lowest cell outward — ground
// below the level but behind a higher sill stays dry (land: the Dead Sea's, the Qattara's case; the finish's water
// balance decides what it holds); (2) no water held on the land (ice sheets, lakes, ground water: Earth's ice ~2.6e7 km³
// is ~2 % of the ocean, Charette & Smith 2010, a glacial lowstand of ~120 m), no seawater loading of the floor (the
// floor's depth–age law is already a water-loaded depth: measure.js seaDepthKm, Parsons & Sclater 1977) — so no
// hydro-isostatic feedback on the level; (3) the ground is the history's per-cell column (surfaceKm below), not the
// finish's shelves and slopes: the history has no drowned margin of its own beyond its crust's thinning.

import { CrustType, CrustFlag, VolcanicType } from '../model/crust.js';
import { columnModel, filledSeaDepthKm, arcSurfaceKm, ARC_ROOT_SHARE, LAND_SEDIMENT_LOAD_FACTOR } from '../measure.js';
import { mantleWarmth, youngFloorSwellKm } from '../../terrain/sea-level.js';
import { MinHeap } from '../../core/min-heap.js';

/** Earth's ocean, km³: 1.332e9 (Charette & Smith 2010, Oceanography 23(2): 112–114, from ETOPO1/Eakins & Sharman 2010's
 *  1.335e9 refined); its area 3.61e8 km² and mean depth 3.68 km. The planet here is Earth's size (R 6371 km), so no
 *  scaling: a planet of radius R would hold EARTH_OCEAN_KM3 × (R / 6371)² for an Earth-deep ocean. */
export const EARTH_OCEAN_KM3 = 1.332e9;
const R = 6371;

/**
 * Every cell's surface against today's datum (km, + up): what the water would stand on. Continental and arc crust as the
 * history's rivers stand it (tectonics/step/rivers.js: its column, uplift, start swells, flood basalt, the sediment in its
 * hollows, less what its rivers cut), sea floor as the terrain's records do (records.js: the depth–age law less the
 * sediment an enclosed sea laid and the rise its rivers laid off an open margin, riseKm3; an oceanic plateau aside), both on the mantle's swell against their side's reference.
 * Read from a frame (FRAME_FIELDS). PROTOTYPE: ports the two formulas rather than sharing them — a wired version
 * extracts one per-cell surface for rivers.js, records.js and this. `swellKm`: the mantle's swell per cell, when the caller
 * has it (terrain/land-mask.js: sea-level.js seaLevel's sl.swellKm, the same mantleSwellKm × smoothed heat).
 */
export function surfaceKm(frame, simMesh, H, out = new Float32Array(simMesh.numCells), swellKm = null, seaRefKm = null) {
    const n = simMesh.numCells, C = columnModel(H), heat = swellKm ? null : mantleWarmth(frame, simMesh, H), time = frame.time;
    const landRef = H.mantleSwellKm * H.mantleSwellLandRef;
    // (the sea floor and an arc: the swell against the mantle under the young floor, terrain/sea-level.js youngFloorSwellKm)
    const seaRef = seaRefKm ?? youngFloorSwellKm(frame, swellKm ?? Float32Array.from(heat, h => H.mantleSwellKm * h));
    for (let w = 0; w < n; w++) {
        const swell = swellKm ? swellKm[w] : H.mantleSwellKm * heat[w], o = frame.owner[w], type = frame.type[w];
        if (o < 0 || type === CrustType.OCEAN) {
            const age = o >= 0 && frame.formedAt[w] >= 0 ? Math.max(0, time - frame.formedAt[w]) : 100;
            const lip = o >= 0 && frame.volcType[w] === VolcanicType.LIP ? H.lipSeaKm * Math.min(H.lipMaxKm, frame.volcKm[w]) : 0;
            // (the rivers' rock on it, Airy-loaded: an enclosed sea's fill and an open margin's rise, riseKm3 spread over its cell)
            const rockKm = o >= 0 ? (frame.seaFillKm?.[w] ?? 0) + (frame.riseKm3?.[w] ?? 0) / simMesh.cellAreaKm2 : 0;
            out[w] = -filledSeaDepthKm(age, rockKm) + lip + swell - seaRef
                + (o >= 0 ? (frame.basinFillKm?.[w] ?? 0) / LAND_SEDIMENT_LOAD_FACTOR : 0);
            continue;
        }
        let b, full;
        if (type === CrustType.ARC) {
            b = (frame.flags[w] & CrustFlag.MARGIN_ISLE) ? H.foreArcIsleKm : arcSurfaceKm(frame.arcKm[w], time - frame.arcAt[w]);
            full = b + C.slope[1] * ARC_ROOT_SHARE * Math.max(0, frame.rootKm[w]);
        } else { b = C.ref[type]; full = b + C.slope[type] * frame.rootKm[w]; }
        full += frame.upliftKm[w] + frame.baseKm[w]
            + (frame.volcType[w] === VolcanicType.LIP ? Math.max(0, H.lipLandKm * Math.min(H.lipMaxKm, frame.volcKm[w]) - frame.volcWornKm[w]) : 0);
        const relief = Math.max(0, full - Math.min(b, full)), laid = (frame.basinFillKm?.[w] ?? 0) / LAND_SEDIMENT_LOAD_FACTOR;
        out[w] = full + laid - Math.min(frame.riverIncKm?.[w] ?? 0, relief + laid + H.riverPlainKm)
            + swell - (type === CrustType.ARC ? seaRef : landRef);
    }
    return out;
}

/**
 * Pour `volumeKm3` of water onto the ground `z` (km) and let it settle: the level (km) at which the ground connected to
 * the ocean holds that volume. One priority flood from a start cell gives every cell its spill height — the lowest level
 * at which the water reaches it (Barnes et al. 2014's priority flood) — and pops them in that order, so the volume below a
 * level is a running sum: V(L) = Σ (L − z) a over the cells whose spill is under L. A basin behind a sill joins whole when
 * the level reaches its sill; where the volume runs out inside that jump the level holds at the sill and the two sides
 * share the water: one full, the other part-filled (the Mediterranean refilling over Gibraltar). O(N log N).
 *
 * From the ocean's side (lane pourstart, 2026-11-10; Jackson's ruling on waterflow's report): the flood starts at the
 * world's lowest cell, but when the volume runs out at the sill of the body it began in and the far side is the larger,
 * the start body was a basin cut off from the ocean, not the ocean — a trench or foredeep a collision sealed, deeper than
 * any of the ocean's own floor. Poured from there, the whole ocean became "the basin behind the sill" and the world's sea
 * stood at that sill (831576@360: +270 m, its neighbours −77 and −222 m; −166 m poured from the ocean's side). So the
 * pour starts again from the larger side's lowest cell: the ocean fills from its own floor and the cut-off basin is held
 * empty like every other hollow behind a sill (or part-filled over it, if the ocean reaches it). Measured by cell count
 * below the sill — the larger body is the ocean (waterflow §2.1: 16 Mkm² against the ocean's ~300). Up to 4 re-pours.
 *
 * Which side of a pinned sill takes the shortfall (pinsign, the same ruling): the ocean stands at the sill and the basin
 * is part-filled when the basin is arid — an evaporating basin draws down behind its sill in 10²–10⁴ years and the ocean
 * feeds its loss over the sill, so it never fills (waterflow §2.2; the Messinian). A humid basin fills itself brim-full
 * from its own catchment in as little, spills to the ocean, and the ocean stands below the sill by the water the basin
 * holds. `humid({ sillKm, basin, ocean })` (a caller's climate; null: always arid, the pour's answer before 2026-11-10)
 * decides, given the basin's cells (1 in `basin`: the far side, below the sill) and the ocean's (1 in `ocean`).
 *
 * A part-filled basin stands its water from the bottom up (the pour on its own cells, walled at the sill, recursively),
 * not in the heap's order among cells tied at the sill's spill (which painted a part-filled basin in patches).
 * @param {Object} [scratch]  buffers from an earlier call on the same mesh (the result's `scratch`)
 * @param {{fromOcean?: boolean, humid?: Function, bottom?: boolean}} [opts]  fromOcean (default true): re-pour from the
 *   ocean's side (false: from the lowest cell, the pour before 2026-11-10 — terrain-config pourFromOcean); humid: see
 *   above; bottom (internal): stand a basin from its bottom, no re-pour, no climate
 * @returns {{levelKm: number, sea: Uint8Array, topKm: Float32Array, seaCells: number, below: number, spill: Float32Array,
 *   restarts: number, pin: Object|null, scratch: Object}} levelKm: the ocean's level; sea: 1 where water stands (the
 *   ocean, and a basin it shares a pinned sill with); topKm: the water's surface on each sea cell (the ocean's level, or a
 *   basin's own: under the sill when part-filled, at it when brim-full; NaN on dry ground); below: cells under the level
 *   but behind a higher sill (closed below-sea hollows: land); restarts: re-pours from the ocean's side; pin: at a pinned
 *   sill, {sillKm, basinCells, oceanCells, basinKm3 (the water the basin holds), humid}, else null.
 */
export function pourOcean(simMesh, z, volumeKm3, scratch = null, { fromOcean = true, humid = null, bottom = false } = {}) {
    const n = simMesh.numCells, a = 4 * Math.PI * R * R / n, target = volumeKm3 / a;
    const S = scratch?.n === n ? scratch : { n, heap: new MinHeap(n), spill: new Float32Array(n), order: new Int32Array(n), sea: new Uint8Array(n), topKm: new Float32Array(n) };
    const { spill, order, sea, topKm } = S;
    let low = 0;
    for (let w = 1; w < n; w++) if (z[w] < z[low]) low = w;
    let count = flood(simMesh, z, low, S), w0 = sweep(z, spill, order, count, target), restarts = 0;
    // (from the ocean's side: re-pour from the far side's lowest cell while the pour pins at its start body's sill and
    // the far side is the larger)
    while (fromOcean && !bottom && w0.pinned && restarts < 4) {
        const P = w0.levelKm, near = firstAt(spill, order, count, P);
        let far = 0, farLow = -1;
        for (let i = near; i < count && spill[order[i]] === P; i++) { const c = order[i]; if (z[c] < P) { far++; if (farLow < 0 || z[c] < z[farLow]) farLow = c; } }
        if (far <= near) break;
        count = flood(simMesh, z, farLow, S); w0 = sweep(z, spill, order, count, target); restarts++;
    }
    let levelKm = w0.levelKm, pin = null;
    sea.fill(0); topKm.fill(NaN);
    if (w0.pinned && !bottom) {
        // (the sill's two sides: the ocean, every cell under the sill's spill; the basin, every cell tied at it below it)
        const P = levelKm, near = firstAt(spill, order, count, P), basin = new Uint8Array(n), ocean = new Uint8Array(n);
        let roomBasin = 0, basinCells = 0;
        for (let i = 0; i < near; i++) ocean[order[i]] = 1;
        for (let i = near; i < count && spill[order[i]] === P; i++) { const c = order[i]; if (z[c] < P) { basin[c] = 1; basinCells++; roomBasin += P - z[c]; } }
        const wet = !!humid && roomBasin < target && humid({ sillKm: P, basin, ocean });
        if (wet) {
            // humid: the basin brim-full at its sill, the ocean below it by what the basin holds
            for (let c = 0; c < n; c++) if (basin[c]) { sea[c] = 1; topKm[c] = P; }
            const o = sweep(z, spill, order, near, target - roomBasin);
            levelKm = settle(simMesh, z, spill, order, near, target - roomBasin, o, S, a);
        } else levelKm = settle(simMesh, z, spill, order, count, target, w0, S, a);
        let held = 0;
        for (let c = 0; c < n; c++) if (basin[c] && sea[c]) held += topKm[c] - z[c];
        pin = { sillKm: P, basinCells, oceanCells: near, basinKm3: held * a, humid: !!wet };
    } else levelKm = settle(simMesh, z, spill, order, count, target, w0, S, a);
    let seaCells = 0, below = 0;
    for (let w = 0; w < n; w++) { seaCells += sea[w]; if (!sea[w] && z[w] < levelKm) below++; }
    return { levelKm, sea, topKm, seaCells, below, spill, restarts, pin, scratch: S };
}

// One priority flood from `start`: every cell's spill height, and the cells in the order they join. @returns their count
function flood(simMesh, z, start, S) {
    const { adjOffset, adjList } = simMesh, { heap, spill, order } = S;
    spill.fill(Infinity); heap.size = 0;
    spill[start] = z[start]; heap.push(z[start], start);
    let count = 0;
    while (heap.size) {
        const c = heap.pop();
        if (heap.lastKey > spill[c]) continue;
        order[count++] = c;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k], s = Math.max(spill[c], z[nb]);
            if (s < spill[nb]) { spill[nb] = s; heap.push(s, nb); }
        }
    }
    return count;
}

// The sweep: the first `count` cells join in spill order; the level is where the joined cells' room equals `target` (km
// × cells). pinned: the volume ran out inside a jump, so the level holds at the last joined cell's spill (a sill).
function sweep(z, spill, order, count, target) {
    let A = 0, Z = 0;
    for (let i = 0; i <= count; i++) {
        const s = i < count ? spill[order[i]] : Infinity;
        if (A > 0 && A * s - Z >= target) {
            const L = (target + Z) / A, sill = spill[order[i - 1]];
            return L < sill ? { levelKm: sill, joined: i, pinned: true } : { levelKm: L, joined: i, pinned: false };
        }
        if (i < count) { A++; Z += z[order[i]]; }
    }
    return { levelKm: (target + Z) / A, joined: count, pinned: false };       // (more water than the whole world's relief: a water world)
}

// (the first index in spill order whose spill is the sill's)
function firstAt(spill, order, count, P) {
    let i = 0;
    while (i < count && spill[order[i]] < P) i++;
    return i;
}

// Mark the water a sweep `w` over the first `count` cells leaves: the joined cells at its level; or, pinned at a sill,
// the near side full to it and the far side's share stood from its bottom. @returns the near side's level (km)
function settle(simMesh, z, spill, order, count, target, w, S, a) {
    const { sea, topKm } = S, L = w.levelKm;
    if (!w.pinned) { for (let i = 0; i < w.joined; i++) { sea[order[i]] = 1; topKm[order[i]] = L; } return L; }
    const near = firstAt(spill, order, count, L);
    let room = 0;
    for (let i = 0; i < near; i++) { sea[order[i]] = 1; topKm[order[i]] = L; room += L - z[order[i]]; }
    standFromBottom(simMesh, z, spill, order, near, count, L, (target - room) * a, sea, topKm);
    return L;
}

// A basin's share of the water (km³) stood from its bottom: the pour on its own cells — those tied at the sill's spill
// `P`, from order[near] on — every other cell walled off. Fills `sea` and `topKm` on its wet cells.
function standFromBottom(simMesh, z, spill, order, near, count, P, km3, sea, topKm) {
    if (!(km3 > 0)) return;
    const walled = new Float32Array(z.length).fill(Infinity);
    for (let i = near; i < count && spill[order[i]] === P; i++) walled[order[i]] = z[order[i]];
    const B = pourOcean(simMesh, walled, km3, null, { bottom: true });
    for (let c = 0; c < z.length; c++) if (B.sea[c] && walled[c] < Infinity) { sea[c] = 1; topKm[c] = B.topKm[c]; }
}

/** The volume (km³) the ocean-connected ground holds up to `levelKm` (the inverse: what a level costs in water). */
export function volumeAt(simMesh, z, spill, levelKm) {
    const n = simMesh.numCells, a = 4 * Math.PI * R * R / n;
    let v = 0;
    for (let w = 0; w < n; w++) if (spill[w] < levelKm) v += levelKm - z[w];
    return v * a;
}
