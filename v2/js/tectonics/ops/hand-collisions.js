// A piece of one plate that joins another brings its collisions with it. When tidy hands a cut-off piece of `from` to
// `to` and that piece's land lies on a third plate's land, it is the same collision, with the convergence it has absorbed
// and the front it has reached. Left behind, the record stayed with `from` and `to`'s contact with the third plate
// started afresh: seed 12345 at 499.7 Myr, a piece of plate 132 joined plate 0 and brought 26 cells of overlap with
// plate 196 against a 525 km front recorded for the old pair (collision lane, case a). This is the weld's own rule
// (step/collision.js inheritCollisions) for part of a plate: the record is copied, not moved, because `from` lives on
// and may still touch the third plate elsewhere (a record nobody touches is forgotten after collisionForgetMyr).

import { CrustType } from '../model/crust.js';

const pairKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;

/**
 * The plates other than `from` and `to` whose land a piece's land cells lie on, at their world positions. Candidates
 * come from the last resolve's owner / collider (an event stage may have moved cells since), then are checked against
 * each plate's current raster.
 * @returns {Set<number>} plate ids
 */
export function landContacts(world, from, to, cells) {
    const { mesh, owner, collider, plates } = world, { xyz, index } = mesh, P = [0, 0, 0], found = new Set();
    for (const c of cells) {
        if (from.crust.type[c] === CrustType.OCEAN) continue;
        from.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], P);
        const w = index.nearest(P[0], P[1], P[2]);
        for (const id of [owner[w], collider[w]]) {
            if (id < 0 || id === from.id || id === to.id || found.has(id)) continue;
            const X = plates[id];
            if (!X.alive || X.isBackground) continue;
            const q = X.cellAt(index, P[0], P[1], P[2]);
            if (X.crust.mask[q] && X.crust.type[q] !== CrustType.OCEAN) found.add(id);
        }
    }
    return found;
}

/**
 * Hand `from`'s collision with each plate in `others` to `to`: copied under `to`'s side, or folded into `to`'s own
 * record with that plate (one front: the older start, the longer reach, the more convergence absorbed and contact had).
 * @returns {number} records handed over
 */
export function handCollisions(world, from, to, others) {
    const { collisions } = world;
    let handed = 0;
    for (const other of others) {
        const rec = collisions.get(pairKey(from.id, other));
        if (!rec || rec.sutured) continue;
        const k = pairKey(to.id, other), mine = collisions.get(k);
        handed++;
        if (!mine) {
            const copy = { ...rec };
            if (copy.upper === from.id) copy.upper = to.id; else copy.lower = to.id;
            collisions.set(k, copy);
            continue;
        }
        if (mine.sutured) continue;
        mine.startedAt = Math.min(mine.startedAt, rec.startedAt);
        mine.shorteningKm = Math.max(mine.shorteningKm, rec.shorteningKm);
        mine.contactMyr = Math.max(mine.contactMyr, rec.contactMyr);
        mine.frontMaxKm = Math.max(mine.frontMaxKm ?? 0, rec.frontMaxKm ?? 0, rec.frontKm);
        mine.lastActive = Math.max(mine.lastActive, rec.lastActive);
    }
    return handed;
}
