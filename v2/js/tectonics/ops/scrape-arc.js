// Scraping an island arc onto a continent (developer, Phase 6b): an arc is thin, buoyant crust on an
// ocean plate. Where it is overridden by another plate's land it is not a continent meeting a
// continent — it is shaved off its own plate and plastered onto the one it hits, a cell at a time, as
// the arc arrives. The ocean BEHIND it keeps going down, so the two continents go on closing until
// their cores meet: that is when a collision record and a suture belong (step/collision.js).
//
// This is deliberately lean, and unlike ops/accrete-terrane.js it runs every step while an arc is
// arriving: it moves crust and flags the seam, and does NOT close seas or spread belts (repeating
// either every step would manufacture land). The belt comes later, from the collision of the cores.

import { CrustType, CrustFlag } from '../model/crust.js';
import { bookRock } from '../rock-book.js';
import { cellRockKm3 } from '../step/crust-ledger.js';
import { buriedFloorKm } from '../step/floor-rock.js';
import { freeCellBeside } from './tidy-plates.js';
import { keepConsumed } from './thicken.js';

/**
 * Move `cells` (raster cells of `donor`, arc crust) onto `host`.
 * A cell that lands on the host's own land goes onto the free cell beside it, stacked against the margin, as a moved piece
 * does (ops/tidy-plates.js transferCells, ops/accrete-terrane.js). With no free cell it is consumed by the collision, as
 * collision.js consumes crust: its rock goes into the host's land from that contact outward, less collisionLostShare
 * (ops/thicken.js keepConsumed). An arc that docks thickens or widens the margin (Taiwan, Kohistan, the Banda arc); it
 * doesn't vanish. (It was "absorbed: the same ground", and its rock deleted: 0.37 km³/yr, 89 % of the moves' book losses,
 * lane contarea (2).) `since`: the arrival's start, for keepConsumed's belt.
 * @returns {{moved: number, absorbed: number}}   (absorbed: cells consumed into the host's land)
 */
export function scrapeArc(world, host, donor, cells, since = world.time) {
    const { mesh } = world, { xyz, index, cellAreaKm2 } = mesh;
    const H = host.crust, D = donor.crust;
    const P = [0, 0, 0];
    const isHostLand = q => H.mask[q] && H.type[q] !== CrustType.OCEAN;
    let moved = 0, absorbed = 0, consumedKm = 0;
    const contact = [];
    for (const c of cells) {
        if (!D.mask[c]) continue;
        donor.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], P);
        let q = host.cellAt(index, P[0], P[1], P[2]);
        if (isHostLand(q)) {                                               // the host's land is already here
            const at = q;
            q = freeCellBeside(host, mesh, at, P, isHostLand);
            if (q < 0) {                                                   // no room: consumed into the host's land
                const rock = cellRockKm3(world, D, c);
                bookRock('dockConsumedKm3', -rock);                   // (all its rock off the map: keepConsumed books back what is kept)
                consumedKm += rock / cellAreaKm2; contact.push(at); absorbed++;
                D.remove(c);
                continue;
            }
        }
        const before = cellRockKm3(world, D, c) + cellRockKm3(world, H, q);   // (the rock book: what the scrape loses, rock-book.js movedLostKm3)
        const buried = buriedFloorKm(H, q, cellAreaKm2);                  // (the host's floor under it: into its column)
        H.copyFrom(q, D, c);
        H.rootKm[q] += buried;
        H.flags[q] = (H.flags[q] & ~CrustFlag.TRENCH) | CrustFlag.SUTURE;   // scraped on: a weak seam, and the trench is re-established outboard by the polarity rule
        moved++;
        bookRock('movedLostKm3', cellRockKm3(world, H, q) - before);
        D.remove(c);
    }
    if (consumedKm > 0) keepConsumed(world, host, [...new Set(contact)], consumedKm, since, 'dock');
    donor.markReshaped(); host.markReshaped();
    if (D.count === 0) { donor.alive = false; donor.omega = [0, 0, 0]; donor.dynamics = null; }
    host.refreshExtent(xyz); donor.refreshExtent(xyz);
    return { moved, absorbed };
}
