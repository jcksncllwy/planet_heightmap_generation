// The crust ledger (config.crustLedger, off by default: the checks turn it on). Continental crust is made and lost only by
// named processes — arcs maturing into continent, fore-arc islands, erosive margins, underthrusting, a weld squeezing a
// strait shut — and every other stage of a step must leave it as it found it. With the ledger on, each stage of each step
// books the change it made to the planet's continental crust (continent and craton) and to its island-arc crust, in cells,
// to its own name: world.ledger[stage] = { land, arc }. The books balance by construction (their sum is the change since
// the ledger opened); what they say is WHICH stage made or lost the crust — check-invariants.mjs holds each stage to what
// its process may do.

import { CrustType } from '../model/crust.js';
import { crustThicknessKm } from '../measure.js';
import { heightsOf } from './heights.js';

/** The only stages whose process may make or lose continental crust — the checks (check-invariants.mjs, check-phase6.mjs) hold
 *  every other stage to 0. (riftStage, lane pstress: a young rift's halves part through continent stretched thin, not new
 *  ocean, for their first riftBreakupKm — step/rifting.js evolveRiftStages spreads the zone's crust over more area, so the
 *  area ledger sees land made, the volume being the margins' thinning. subductionErosion, lane crust: a closing overriding
 *  trench eats its fore-arc continent until it founders — step/subduction-erosion.js. heights, lane crust: only with
 *  config.collapseMakesArea, a collapsing range's root spreading over its plate's own sea floor — step/heights.js.
 *  hiddenRemnants, lane crust: a plate subducted to its last arc or continent cells, hidden under its neighbours, accretes
 *  to the plate over it, and land landing on the host's own land is absorbed — step/ocean-plates.js accreteHiddenRemnants.) */
export const LAND_STAGES = ['collisions', 'marginIsles', 'sedimentSubduction', 'subductionErosion', 'arcMaturation', 'tidy', 'riftStage', 'heights', 'hiddenRemnants'];

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

/**
 * A ledger for one world, or null when it is off. ledger.open() before a stage, ledger.book(stage) after it.
 */
export function crustLedger(world) {
    if (!world.config.crustLedger) return null;
    const vol = !!world.config.crustLedgerVolume, tally = vol ? w => ({ ...crustTally(w), vol: crustVolume(w) }) : crustTally;
    world.ledger ??= { start: tally(world), stages: {} };
    let before = null;
    return {
        open() { before = tally(world); },
        book(stage) {
            const now = tally(world), entry = world.ledger.stages[stage] ??= { land: 0, arc: 0 };
            entry.land += now.land - before.land; entry.arc += now.arc - before.arc;
            if (vol) entry.vol = (entry.vol ?? 0) + now.vol - before.vol;
            before = now;
        },
    };
}
