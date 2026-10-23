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
        const { mask, type } = p.crust;
        for (let c = 0; c < mask.length; c++) {
            if (!mask[c]) continue;
            const t = type[c];
            if (t === CrustType.CONTINENT || t === CrustType.CRATON) land++; else if (t === CrustType.ARC) arc++;
        }
    }
    return { land, arc };
}

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
