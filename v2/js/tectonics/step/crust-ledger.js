// The crust ledger (config.crustLedger, off by default: the checks turn it on). Continental crust is made and lost only by
// named processes — arcs maturing into continent, fore-arc islands, erosive margins, underthrusting, a weld squeezing a
// strait shut — and every other stage of a step must leave it as it found it. With the ledger on, each stage of each step
// books the change it made to the planet's continental crust (continent and craton) and to its island-arc crust, in cells,
// to its own name: world.ledger[stage] = { land, arc }. The books balance by construction (their sum is the change since
// the ledger opened); what they say is WHICH stage made or lost the crust — check-invariants.mjs holds each stage to what
// its process may do.

import { CrustType } from '../model/crust.js';

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

/**
 * A ledger for one world, or null when it is off. ledger.open() before a stage, ledger.book(stage) after it.
 */
export function crustLedger(world) {
    if (!world.config.crustLedger) return null;
    world.ledger ??= { start: crustTally(world), stages: {} };
    let before = null;
    return {
        open() { before = crustTally(world); },
        book(stage) {
            const now = crustTally(world), entry = world.ledger.stages[stage] ??= { land: 0, arc: 0 };
            entry.land += now.land - before.land; entry.arc += now.arc - before.arc;
            before = now;
        },
    };
}
