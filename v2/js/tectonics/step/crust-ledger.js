// The crust ledger (config.crustLedger, off by default: the checks turn it on). Continental crust is made and lost only by
// named processes — arcs maturing into continent, fore-arc islands, erosive margins, underthrusting, a weld squeezing a
// strait shut — and every other stage of a step must leave it as it found it. With the ledger on, each stage of each step
// books the change it made to the planet's continental crust (continent and craton) and to its island-arc crust, in cells,
// to its own name: world.ledger[stage] = { land, arc }. The books balance by construction (their sum is the change since
// the ledger opened); what they say is WHICH stage made or lost the crust — check-invariants.mjs holds each stage to what
// its process may do.

import { CrustType } from '../model/crust.js';
import { crustThicknessKm, columnModel } from '../measure.js';
import { heightsOf } from './heights.js';
import { arcCrustKm } from './collision.js';

/** The only stages whose process may make or lose continental crust — the checks (check-invariants.mjs, check-phase6.mjs) hold
 *  every other stage to 0. (riftStage, lane pstress: a young rift's halves part through continent stretched thin, not new
 *  ocean, for their first riftBreakupKm — step/rifting.js evolveRiftStages spreads the zone's crust over more area, so the
 *  area ledger sees land made, the volume being the margins' thinning. subductionErosion, lane crust: a closing overriding
 *  trench eats its fore-arc continent until it founders — step/subduction-erosion.js. (heights made land only through the
 *  old collapse's collapseMakesArea, removed at crustmass S5: it is held to 0 again.)
 *  hiddenRemnants, lane crust: a plate subducted to its last arc or continent cells, hidden under its neighbours, accretes
 *  to the plate over it, and land landing on the host's own land is absorbed — step/ocean-plates.js accreteHiddenRemnants.) */
export const LAND_STAGES = ['collisions', 'marginIsles', 'sedimentSubduction', 'prismAccretion', 'subductionErosion', 'arcMaturation', 'tidy', 'riftStage', 'hiddenRemnants'];

/** The planet's continental and arc crust now, in cells (every live plate's raster). */
export function crustTally(world) {
    let land = 0, arc = 0;
    for (const p of world.plates) {
        if (!p.alive) continue;
        const { mask, type } = p.crust, n = mask.length;
        // (four cells at a time — the ledger counts every raster some twenty times a step: a fifth of a history's time,
        // cell by cell): a word of the mask (bytes 0 or 1) and of the types (CrustType, 0–3: bit 0 and bit 1 differ on
        // continent and craton, both are set on arc), each byte its own count, summed in a word up to 255 words at a time.
        // The same counts as cell by cell; a byte that is not a CrustType is counted cell by cell
        const M = words(mask), T = words(type), W = M.length;
        for (let i0 = 0; i0 < W; i0 += 255) {
            const e = Math.min(W, i0 + 255);
            let sumLand = 0, sumArc = 0;
            for (let i = i0; i < e; i++) {
                const m = M[i];
                if (m === 0) continue;
                const t = T[i];
                if (t & 0xFCFCFCFC) { for (let c = 4 * i; c < 4 * i + 4; c++) if (mask[c]) { const k = type[c]; if (k === CrustType.CONTINENT || k === CrustType.CRATON) land++; else if (k === CrustType.ARC) arc++; } continue; }
                const b0 = t & 0x01010101, b1 = (t >>> 1) & 0x01010101;
                sumLand += (b0 ^ b1) & m; sumArc += b0 & b1 & m;
            }
            land += (sumLand & 0xff) + ((sumLand >>> 8) & 0xff) + ((sumLand >>> 16) & 0xff) + (sumLand >>> 24);
            arc += (sumArc & 0xff) + ((sumArc >>> 8) & 0xff) + ((sumArc >>> 16) & 0xff) + (sumArc >>> 24);
        }
        for (let c = 4 * W; c < n; c++) {
            if (!mask[c]) continue;
            const t = type[c];
            if (t === CrustType.CONTINENT || t === CrustType.CRATON) land++; else if (t === CrustType.ARC) arc++;
        }
    }
    return { land, arc };
}
// (a byte array's whole words, as a Uint32Array over the same memory: made once per array — none if it does not start on
// a word, and then every cell is counted on its own)
const wordViews = new WeakMap();
function words(a) {
    let v = wordViews.get(a);
    if (!v) wordViews.set(a, v = a.byteOffset & 3 ? new Uint32Array(0) : new Uint32Array(a.buffer, a.byteOffset, a.length >> 2));
    return v;
}
if (CrustType.OCEAN !== 0 || CrustType.CONTINENT !== 1 || CrustType.CRATON !== 2 || CrustType.ARC !== 3) throw new Error('crust-ledger.js counts CrustType by its bits');

/** The planet's continental crust VOLUME now, in cell-km (Σ over continent and craton cells of measure.js crustThicknessKm):
 * the area ledger sees a belt thicken, a weld absorb its overlap or erosion thin a shield as nothing (lane crust, stage 0:
 * config.crustLedgerVolume, a diagnostic for tools/trace-crust.mjs — slow, every cell's column each stage). */
export function crustVolume(world) {
    const H = heightsOf(world.config), fills = !!world.config.rockBook, cellKm2 = world.mesh.cellAreaKm2;
    let v = 0;
    for (const p of world.plates) {
        if (!p.alive) continue;
        const { mask, type, rootKm, upliftKm, baseKm, basinFillKm, seaFillKm, shelfKm3 } = p.crust;
        for (let c = 0; c < mask.length; c++) {
            if (!mask[c]) continue;
            const t = type[c];
            if (t === CrustType.CONTINENT || t === CrustType.CRATON) v += crustThicknessKm(H, t, rootKm[c], upliftKm[c], baseKm[c])
                + (fills ? basinFillKm[c] + seaFillKm[c] + shelfKm3[c] / cellKm2 : 0);   // (rockBook: the rock laid on it is the continent's)
        }
    }
    return v;
}

/** The rock the planet holds now, in parts (cell-km; lane rockbook, a diagnostic with crustLedgerVolume): continental crust
 * (its kind's as formed plus its root), the relief it carries above that (measure.js crustThicknessKm's uplift and swell
 * term, as crust), the rivers' fill on it (basin, enclosed-sea and shelf rock), island-arc crust (collision.js arcCrustKm),
 * the sediment on OCEAN crust (the rise, enclosed-sea fill), and the rock worn off and not yet carried (crust.wornKm). */
export function rockParts(world) {
    const R = rockMeasure(world), parts = { crust: 0, relief: 0, fill: 0, arc: 0, oceanSed: 0, transit: 0 };
    for (const p of world.plates) {
        if (!p.alive) continue;
        const k = p.crust, { mask } = k;
        for (let c = 0; c < mask.length; c++) if (mask[c]) addCellRock(parts, R, k, c);
    }
    return parts;
}

/** What rockParts and cellRockKm measure a cell with: the column model, the cell's area, the time (an arc's age). */
function rockMeasure(world) {
    const config = world.config;
    return { C: columnModel(heightsOf(config)), cellKm2: world.mesh.cellAreaKm2, time: world.time, config };
}

/** Add raster cell `c` of crust `k`'s rock to `parts` (cell-km, by part — rockParts' measure, one cell). Every kind of cell
 * holds whatever sediment lies on it (basin, enclosed-sea, shelf and rise rock: the rivers set it down on arcs and ocean too),
 * and an arc its root and relief as well as its own crust (heights.js wears them into crust.wornKm like a continent's). */
function addCellRock(parts, R, k, c) {
    const t = k.type[c], C = R.C, sed = k.basinFillKm[c] + k.seaFillKm[c] + (k.shelfKm3[c] + k.riseKm3[c]) / R.cellKm2;
    parts.transit += k.wornKm[c];               // (worn off, not yet carried by the rivers: rockBook)
    if (t === CrustType.OCEAN) { parts.oceanSed += sed; return; }
    parts.fill += sed;
    const relief = (Math.max(0, k.upliftKm[c]) + k.baseKm[c]) / C.slope[t];
    if (t === CrustType.ARC) { parts.arc += arcCrustKm(k, c, R.time, R.config) + k.rootKm[c] + relief; return; }
    parts.crust += C.crust[t] + k.rootKm[c];
    parts.relief += relief;
}

/**
 * The rock at raster cell `c` of `crust`, km³, every part together (lane rockbook: rockParts' measure, one cell). A stage
 * that takes a cell off the map, or changes what kind of crust it is, books the change in this — the cell's rock before,
 * less after — so the book and the record are one measure: see rock-book.js.
 */
export function cellRockKm3(world, crust, c) {
    if (!crust.mask[c]) return 0;
    const R = rockMeasure(world), one = { crust: 0, relief: 0, fill: 0, arc: 0, oceanSed: 0, transit: 0 };
    addCellRock(one, R, crust, c);
    return (one.crust + one.relief + one.fill + one.arc + one.oceanSed + one.transit) * R.cellKm2;
}

/** Σ cellRockKm3 over a plate's raster (km³: a weld's books — before and after its merge). */
export function plateRockKm3(world, plate) {
    if (!plate.alive) return 0;
    const R = rockMeasure(world), parts = { crust: 0, relief: 0, fill: 0, arc: 0, oceanSed: 0, transit: 0 }, k = plate.crust, { mask } = k;
    for (let c = 0; c < mask.length; c++) if (mask[c]) addCellRock(parts, R, k, c);
    return (parts.crust + parts.relief + parts.fill + parts.arc + parts.oceanSed + parts.transit) * R.cellKm2;
}

/** Σ rock of the island-arc cells the history never grew (arcKm 0: a scene's hand-laid arc, measured by its age — collision.js
 * arcCrustKm), km³. Their measure thickens with time while nothing touches them: simulate.js books the change over the
 * kinematics stage as arcAgeingKm3 — a term of the measure, not a process, so only while the volume ledger runs. */
export function handLaidArcKm3(world) {
    const R = rockMeasure(world);
    let v = 0;
    for (const p of world.plates) {
        if (!p.alive) continue;
        const k = p.crust, { mask, type, arcKm } = k;
        for (let c = 0; c < mask.length; c++) if (mask[c] && type[c] === CrustType.ARC && !(arcKm[c] > 0)) v += arcCrustKm(k, c, R.time, R.config);
    }
    return v * R.cellKm2;
}

/**
 * A ledger for one world, or null when it is off. ledger.open() before a stage, ledger.book(stage) after it.
 */
export function crustLedger(world) {
    if (!world.config.crustLedger) return null;
    const vol = !!world.config.crustLedgerVolume, tally = vol ? w => ({ ...crustTally(w), vol: crustVolume(w), parts: rockParts(w), budget: { ...w.budget } }) : crustTally;
    world.ledger ??= { start: tally(world), stages: {} };
    let before = null;
    return {
        open() { before = tally(world); },
        book(stage) {
            const now = tally(world), entry = world.ledger.stages[stage] ??= { land: 0, arc: 0 };
            entry.land += now.land - before.land; entry.arc += now.arc - before.arc;
            if (vol) {
                entry.vol = (entry.vol ?? 0) + now.vol - before.vol;
                // (rockbook: each part's change, and each budget counter's — the books a stage wrote while it moved the rock)
                entry.parts ??= {}; entry.budget ??= {};
                for (const key in now.parts) entry.parts[key] = (entry.parts[key] ?? 0) + now.parts[key] - before.parts[key];
                for (const key in now.budget) { const d = now.budget[key] - (before.budget[key] ?? 0); if (d) entry.budget[key] = (entry.budget[key] ?? 0) + d; }
            }
            before = now;
        },
    };
}
