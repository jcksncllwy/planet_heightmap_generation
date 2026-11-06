// The land and the sea, and the sea's level: one mask for the history, the terrain and the finish (standing goal #8,
// model review U3). Until 2026-11-06 each stage decided "is this land?" on its own: the terrain's records by the crust's
// height (a below-sea column joined to the ocean drowned), the history's rivers by its kind (sea-level.js landAndSea:
// every continent and arc land, however low), the finish's rock by z ≤ 0 (a closed hollow below the sea read as sea).
// On three histories × two moments (tools/datum-study.mjs, 160K) the rivers saw 16–42 Mkm² more land than the terrain
// draws, their sea stood 11–22 m off the terrain's, and 11–36 % of the cells they routed water through lay in its sea.
//
// Two halves, one rule: water below the sea's level is the sea where it is joined to the world ocean.
// - On the sim grid, from the crust (landMask, here): the records (terrain/records.js deriveRecords) and the history's
//   rivers (tectonics/step/rivers.js) both read it. The sea's level comes with it (sea-level.js seaLevel), reckoned on
//   this land.
// - On a drawn surface, from its heights (world-ocean.js worldOcean): the timeline's views, the finish's sea
//   (finish.js oceanMask) and its rock (finish-lithology.js) read that.
//
// Limits (a reduced model): the land is decided per sim cell (~120 km at 40K), by the column's isostatic height at
// the cell, against one sea level for the world; the drawn coast between land and sea cells is the margin's line
// (margin-line.js), which respects this mask (a cell keeps its side wherever its column stands clear of the sea).
// Small enclosed seas filled as lowland (pocketSeaKm2) are a stopgap rule (review heuristic 07), kept here so that
// every stage applies it alike until a coastal sediment surface fills them.

import { CrustType, CrustFlag } from '../tectonics/model/crust.js';
import { seaFilledUp, arcSurfaceKm, columnModel, ARC_ROOT_SHARE, LAND_SEDIMENT_LOAD_FACTOR } from '../tectonics/measure.js';
import { seaLevel, seaLevelAgain, liftRefKm, liftedDry } from './sea-level.js';
import { surfaceKm, pourOcean, EARTH_OCEAN_KM3 } from '../tectonics/ocean/inventory.js';

/** Is world cell w sea floor its rivers have filled to sea level (step/sea-fill.js)? */
export function filledUp(frame, w) { return !!frame.seaFillKm && frame.seaFillKm[w] > 0 && seaFilledUp(frame.time - frame.formedAt[w], frame.seaFillKm[w]); }

// a crust cell's own column, as the continental platform reckons it (deriveRecords): its kind as formed (an arc by its
// volcanoes' crust and its quiet) and its thickening or thinning since (lift), the start world's swells and the
// sediment the history's rivers laid on it. Against the land's swell reference; the swell itself is added by the caller
export function crustColumnKm(frame, cfg, CM, w) {
    const type = frame.type[w];
    let h, lift;
    if (type === CrustType.ARC) {
        // an island arc stands on the crust its volcanoes added while its slab fed them, by isostasy, hot while
        // active and cooling, sinking and worn down once silent (tectonics/measure.js arcSurfaceKm): a young arc a
        // submerged ridge its volcanoes break (the Marianas, Tonga), a long-fed one land (Japan), a remnant arc a
        // drowned ridge (the Kyushu–Palau Ridge). (Was by its age, and by its distance from a continent: an arc
        // stranded far from its trench stood as high as a live one — rings of land round the basins behind them)
        h = frame.flags[w] & CrustFlag.MARGIN_ISLE ? cfg.foreArcIsleKm : arcSurfaceKm(frame.arcKm[w], frame.time - frame.arcAt[w]);
        // (its thickening by belts: an arc's recorded thickening is mostly its own growth, already in its crust)
        lift = CM.slope[1] * ARC_ROOT_SHARE * Math.max(0, frame.rootKm[w]);
    } else {
        // (a continent's or a craton's column: its kind as formed, CM.ref, and its crust thickened or thinned since. A sea
        // closed off too small to keep — ocean crust under the land, unfilled — stands as a lowland platform, an ordinary
        // continent's column as formed)
        h = CM.ref[type === CrustType.OCEAN ? CrustType.CONTINENT : type];
        lift = CM.slope[type] * frame.rootKm[w];
    }
    lift = Math.fround(lift + frame.baseKm[w]);                         // (the start world's swells, as worn so far; as the platform stores it)
    return { h: h + lift + (frame.basinFillKm?.[w] ?? 0) / LAND_SEDIMENT_LOAD_FACTOR, lift };
}

/** Sea pockets smaller than `maxKm2` (connected non-land cells enclosed by land) become land, in place. */
export function fillPockets(simMesh, land, maxKm2) {
    const { adjOffset, adjList, numCells: n } = simMesh, maxCells = maxKm2 / (4 * Math.PI * 6371 * 6371 / n);
    if (maxCells < 1) return;
    const seen = new Uint8Array(n), members = [];
    for (let s = 0; s < n; s++) {
        if (land[s] || seen[s]) continue;
        members.length = 0; members.push(s); seen[s] = 1;
        for (let i = 0; i < members.length; i++) {
            const c = members[i];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!land[nb] && !seen[nb]) { seen[nb] = 1; members.push(nb); } }
        }
        if (members.length < maxCells) for (const c of members) land[c] = 1;
    }
}

/**
 * The land and the sea on the sim grid, and the sea's level that answers them.
 * The frame is any view with its fields per world cell: owner, type, formedAt, flags, seaFillKm, basinFillKm, rootKm,
 * baseKm, upliftKm, arcKm, arcAt, mantleHeat (0–255), time — a snapshot (tectonics/snapshot.js), or the history's own
 * view of its plates (tectonics/step/rivers.js).
 * @param {Object} [out]  buffers to reuse: { land: Uint8Array, swellKm: Float32Array, seaColKm: Float32Array, dryHollow: Uint8Array,
 *                        heat: Float32Array (the mantle's smoothed warmth; made here, and kept on out, if missing) }
 * @returns {{land: Uint8Array, sl: Object, seaColKm: Float32Array, dryHollow: Uint8Array}}
 *   land 1 / sea 0; sl the sea's level and the swell (sea-level.js seaLevel); seaColKm the column of crust drowned (NaN
 *   elsewhere); dryHollow 1 on land standing below the sea with no way to it
 */
export function landMask(frame, simMesh, cfg, out = {}) {
    const n = simMesh.numCells, { adjOffset, adjList } = simMesh;
    const land = out.land?.length === n ? out.land : new Uint8Array(n);
    for (let w = 0; w < n; w++) {
        land[w] = frame.owner[w] >= 0 && (frame.type[w] !== CrustType.OCEAN || filledUp(frame, w)) ? 1 : 0;   // (an enclosed sea filled to sea level is lowland)
    }
    fillPockets(simMesh, land, cfg.pocketSeaKm2);
    // the mantle's swell under every cell, the land's and the sea floor's, and the sea's level that answers it and the
    // sea floor's age (terrain/sea-level.js): absolute — a supercontinent on its own warm mantle stands high as a whole,
    // and the sea falls against it (developer, 8b round 6, had it relative to the land's mean, so that a continent sitting
    // still did not lift every height; today's heights are now its datum instead)
    const swellKm = out.swellKm?.length === n ? out.swellKm : null, heat = out.heat?.length === n ? out.heat : (out.heat = new Float32Array(n));
    let sl = seaLevel(frame, simMesh, cfg, w => land[w] === 1, swellKm, heat);
    // a sediment-filled sea whose floor the mantle's swell has lifted above the sea: dry land — a lowland plain — though its
    // fill fell short of the room the history gives it (step/sea-fill.js: it reckons the floor's subsidence, not the
    // swell). Read as sea, its floor stood above the sea inside its own coast, and the margin's shelf and slope drawn down
    // from that coast left a moat round it (branch unified)
    let raised = 0;
    for (let w = 0; w < n; w++) if (!land[w] && liftedDry(frame, w, sl, cfg)) { land[w] = 1; raised++; }
    if (raised) sl = seaLevelAgain(frame, simMesh, cfg, w => land[w] === 1, heat, sl.swellKm);         // (the sea's level, with them as land)
    // the water inventory (cfg.waterInventory × Earth's ocean; lane sliders, Jackson 2026-11-03: "pouring an earth-like amount
    // of water onto the planet and letting it settle"): the sea's level is where that volume stands, poured onto every cell's
    // ground (tectonics/ocean/inventory.js surfaceKm, on the same swell) from the lowest — not reckoned from the mantle's
    // heat against a calibrated floor depth (sea-level.js). ONLY THE LEVEL CHANGES here: which cells may be sea (the crust's
    // kind, filled seas, pockets, lifted fills) stays the rules above until they retire, and the flood below drowns at this
    // level. (The pour's own sea differs from the mask's where ocean crust behind a sill stands above the level — land to
    // the pour, sea to the mask: an enclosed sea drawn at a continent's reference if it were made land, ~5 km too high)
    let pour = null;
    if (cfg.waterInventory > 0) {
        const z = surfaceKm(frame, simMesh, cfg, out.groundKm?.length === n ? out.groundKm : (out.groundKm = new Float32Array(n)), sl.swellKm);
        pour = pourOcean(simMesh, z, cfg.waterInventory * EARTH_OCEAN_KM3, out.pour);
        out.pour = pour.scratch;
        sl = { ...sl, seaKm: pour.levelKm };
    }
    // land is decided by height, not by the kind of crust (Jackson's ruling, 2026-11-03): any crust — continent, arc or
    // rifted floor — whose own column (crustColumnKm, with the mantle's swell) stands below the sea's level is sea where
    // it joins the open ocean: flooded from the sea over the cells below it. The threshold is the sea's level itself, not
    // the shelf break: ground between the two that joins the sea is drowned (a shelf is graded to wave base below the
    // water, not above it), and the margin's shelf ramp is drawn from the new coast. Its floor is its own column, not a
    // ridge's by age (seaColKm). Thinned continent read as land (Red Sea and Gulf of California floors, 1–3 km down;
    // young submerged arcs, 2–3 km down) was drawn on the land side with a shelf ramped up to sea level over it: blotchy,
    // lacy shelves and green strips (lane visual5, rifton-report known bug 2; Jackson's 460 bays). Ground below the sea
    // with no way to it stays land, a closed hollow (dryHollow): the Dead Sea's, the Caspian's, Qattara's, Turpan's —
    // whether it holds a lake, a salt pan or nothing is the water's balance (the finish's water pass), not this
    const seaColKm = out.seaColKm?.length === n ? out.seaColKm.fill(NaN) : new Float32Array(n).fill(NaN);
    const dryHollow = out.dryHollow?.length === n ? out.dryHollow.fill(0) : new Uint8Array(n);
    {
        // (each cell against the swell's reference for its own crust, as synthesize.js draws it — liftRefKm: an island arc
        // against the sea floor's, the rest against the land's; until 2026-11-05 every cell was held to the land's, so a pure
        // arc was flooded as if it stood mantleSwellKm × (land − sea ref) ≈ 0.27 km lower than it is drawn)
        const CM0 = columnModel(cfg), fillAt = w => frame.type[w] === CrustType.OCEAN && frame.seaFillKm?.[w] > 0;
        const below = new Float32Array(n).fill(NaN);           // (the column, for land standing below the sea; NaN elsewhere)
        for (let w = 0; w < n; w++) {
            if (!land[w] || frame.owner[w] < 0 || fillAt(w)) continue;          // (a filled sea's plain is graded to the sea's level)
            const col = crustColumnKm(frame, cfg, CM0, w).h, top = col + Math.max(0, frame.upliftKm[w]);
            if (top + sl.swellKm[w] - liftRefKm(cfg, frame.type[w] === CrustType.ARC ? 1 : 0) < sl.seaKm) below[w] = col;
        }
        const queue = []; let drowned = 0;
        for (let w = 0; w < n; w++) if (!land[w]) queue.push(w);
        for (let i = 0; i < queue.length; i++) {
            const c = queue[i];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const q = adjList[k];
                if (land[q] && below[q] === below[q]) { land[q] = 0; seaColKm[q] = below[q]; queue.push(q); drowned++; }
            }
        }
        for (let w = 0; w < n; w++) if (land[w] && below[w] === below[w]) dryHollow[w] = 1;
        if (drowned && !pour) sl = seaLevelAgain(frame, simMesh, cfg, w => land[w] === 1, heat, sl.swellKm);
    }
    return { land, sl, seaColKm, dryHollow };
}
