// Accreted arcs become continent (after Phase 13). Island arcs are how continents grow: welded onto a continent —
// docked, scraped on, collapsed onto its coast — an arc's crust is thickened, intruded and reworked into continental
// crust (the North American Cordillera, the Central Asian Orogenic Belt, most of Japan). Here arc crust that touches its
// plate's continental crust, and is at least arcContinentAgeMyr old, turns continental one ring at a time — its front
// advancing arcContinentKmPerMyr. Without it the continental crust only ever lost ground (collisions underthrust it,
// erosive margins eat it: 148 → 110 Mkm² over 1200 Myr) while the arcs that should have made it up stayed arcs
// (developer: "the overall landmass … seems like we are decreasing over time").

import { CrustType, CrustFlag } from '../model/crust.js';
import { arcToContinentRootKm } from './heights.js';
import { bookRock } from '../rock-book.js';
import { cellRockKm3 } from './crust-ledger.js';

/** @returns {number} plates whose crust changed (cell types only) */
export function matureArcs(world, dt) {
    const { mesh, plates, config, time } = world, { numCells, adjOffset, adjList, edgeKm } = mesh;
    const rate = config.arcContinentKmPerMyr;
    if (!(rate > 0) || dt <= 0) return 0;
    const spacing = edgeKm * Math.sqrt(3) / 2;
    let changed = 0;
    for (const plate of plates) {
        if (!plate.alive || plate.isBackground || plate.crust.count === 0) continue;
        // (a ring is due every cell spacing's worth of the front's advance)
        plate.arcMatureKm = (plate.arcMatureKm ?? 0) + rate * dt;
        if (plate.arcMatureKm < spacing) continue;
        plate.arcMatureKm -= spacing;
        const { mask, type, formedAt, flags } = plate.crust, ring = [];
        for (let c = 0; c < numCells; c++) {
            if (!mask[c] || type[c] !== CrustType.ARC || (flags[c] & CrustFlag.MARGIN_ISLE) || time - formedAt[c] < config.arcContinentAgeMyr) continue;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (mask[nb] && (type[nb] === CrustType.CONTINENT || type[nb] === CrustType.CRATON)) { ring.push(c); break; }
            }
        }
        if (!ring.length) continue;
        // (its terrane, its age, its belts and its volcanoes stay; its crust — the arc's own, and its share of what belts
        // thickened it by — is continental crust now, reworked to at least an ordinary continent's thickness: the step's
        // premise, welded arcs thickened and intruded into continental crust (branch unified: the column stands on it))
        // (the rock book, arcMaturedKm3: the cell's rock as continent less as arc — the reworking's floor at an ordinary
        // continent's crust, ARC_ROOT_SHARE of a belt's root on it, and the relief and fill it carried that the arc's
        // measure, its crust alone, did not count: rock-book.js)
        let matured = 0;
        // (config.crustPaidRelief, lane crustmass S1: a relabel, rock for rock — the root is then set so the continent's column
        // holds exactly the arc's rock: an immature arc makes thin continent that stands low, F2 → 0)
        const paid = !!config.crustPaidRelief;
        for (const c of ring) {
            const before = cellRockKm3(world, plate.crust, c);
            plate.crust.rootKm[c] = arcToContinentRootKm(plate.crust, c, time, config); type[c] = CrustType.CONTINENT;
            if (paid) plate.crust.rootKm[c] += (before - cellRockKm3(world, plate.crust, c)) / mesh.cellAreaKm2;
            matured += cellRockKm3(world, plate.crust, c) - before;
        }
        bookRock('arcMaturedKm3', matured);
        world.budget.arcMaturedCells = (world.budget.arcMaturedCells ?? 0) + ring.length;
        plate.dirty = true;
        changed++;
    }
    return changed;
}
