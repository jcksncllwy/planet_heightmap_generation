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
import { mantleWarmth } from '../../terrain/sea-level.js';
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
 * sediment an enclosed sea laid, an oceanic plateau aside), both on the mantle's swell against their side's reference.
 * Read from a frame (FRAME_FIELDS). PROTOTYPE: ports the two formulas rather than sharing them — a wired version
 * extracts one per-cell surface for rivers.js, records.js and this. `swellKm`: the mantle's swell per cell, when the caller
 * has it (terrain/land-mask.js: sea-level.js seaLevel's sl.swellKm, the same mantleSwellKm × smoothed heat).
 */
export function surfaceKm(frame, simMesh, H, out = new Float32Array(simMesh.numCells), swellKm = null) {
    const n = simMesh.numCells, C = columnModel(H), heat = swellKm ? null : mantleWarmth(frame, simMesh, H), time = frame.time;
    const landRef = H.mantleSwellKm * H.mantleSwellLandRef, seaRef = H.mantleSwellKm * H.mantleSwellSeaRef;
    for (let w = 0; w < n; w++) {
        const swell = swellKm ? swellKm[w] : H.mantleSwellKm * heat[w], o = frame.owner[w], type = frame.type[w];
        if (o < 0 || type === CrustType.OCEAN) {
            const age = o >= 0 && frame.formedAt[w] >= 0 ? Math.max(0, time - frame.formedAt[w]) : 100;
            const lip = o >= 0 && frame.volcType[w] === VolcanicType.LIP ? H.lipSeaKm * Math.min(H.lipMaxKm, frame.volcKm[w]) : 0;
            out[w] = -filledSeaDepthKm(age, o >= 0 ? frame.seaFillKm?.[w] ?? 0 : 0) + lip + swell - seaRef
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
 * Pour `volumeKm3` of water onto the ground `z` (km) from its lowest cell and let it settle: the level (km) at which the
 * ground connected to the ocean below it holds that volume. One priority flood from the lowest cell gives every cell its
 * spill height — the lowest level at which the ocean reaches it (Barnes et al. 2014's priority flood) — and pops them in
 * that order, so the volume below a level is a running sum: V(L) = Σ (L − z) a over the cells whose spill is under L.
 * A basin behind a sill joins whole when the level reaches its sill; where the volume runs out inside that jump the level
 * holds at the sill (the basin part-filled: the Mediterranean refilling over Gibraltar). O(N log N).
 * @returns {{levelKm: number, sea: Uint8Array, seaCells: number, below: number, spill: Float32Array}} sea: 1 where the
 *   ocean stands; below: cells under the level but behind a higher sill (closed below-sea hollows: land).
 */
export function pourOcean(simMesh, z, volumeKm3, scratch = null) {
    const n = simMesh.numCells, { adjOffset, adjList } = simMesh, a = 4 * Math.PI * R * R / n, target = volumeKm3 / a;
    const S = scratch?.n === n ? scratch : { n, heap: new MinHeap(n), spill: new Float32Array(n), order: new Int32Array(n), sea: new Uint8Array(n) };
    const { heap, spill, order, sea } = S;
    let low = 0;
    for (let w = 1; w < n; w++) if (z[w] < z[low]) low = w;
    spill.fill(Infinity); heap.size = 0;
    spill[low] = z[low]; heap.push(z[low], low);
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
    // the sweep: cells join in spill order; the level is where the joined cells' room equals the volume
    let A = 0, Z = 0, levelKm = spill[order[count - 1]], joined = count;
    for (let i = 0; i < count; i++) {
        const s = spill[order[i]];
        if (A > 0 && A * s - Z >= target) { levelKm = Math.max((target + Z) / A, i > 0 ? spill[order[i - 1]] : -Infinity); joined = i; break; }
        A++; Z += z[order[i]];
    }
    if (joined === count) levelKm = (target + Z) / A;            // (more water than the whole world's relief: a water world)
    sea.fill(0);
    for (let i = 0; i < joined; i++) sea[order[i]] = 1;
    let below = 0;
    for (let w = 0; w < n; w++) if (!sea[w] && z[w] < levelKm) below++;
    return { levelKm, sea, seaCells: joined, below, spill, scratch: S };
}

/** The volume (km³) the ocean-connected ground holds up to `levelKm` (the inverse: what a level costs in water). */
export function volumeAt(simMesh, z, spill, levelKm) {
    const n = simMesh.numCells, a = 4 * Math.PI * R * R / n;
    let v = 0;
    for (let w = 0; w < n; w++) if (spill[w] < levelKm) v += levelKm - z[w];
    return v * a;
}
