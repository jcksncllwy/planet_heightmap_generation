// Plate integrity. Subduction, docking and arc collapse can leave a plate in disconnected pieces:
// an ocean sliver cut off by a trench, a stretch of arc beyond the continent it docked against, a
// scrap of land adrift. Left alone those pieces keep the old plate's motion and drift about looking
// like swiss cheese. Every step, each plate keeps only its main piece (the one with the most land; by area when
// there is no land); every other piece
//   · ocean only, a plate's worth (oceanPlateMinAreaKm2)  → becomes a plate of its own, moving on as it was (it used to go
//                                                            to the passive ocean and come back as a plate when that retired)
//   · ocean only, going down at its own trench            → is consumed: a sliver of the slab cut off there has gone down
//                                                            (given to the overriding plate, it hung a young apron off its
//                                                            trench and steepened the 'laramide' slab early at 40K only)
//   · ocean only, touching another plate                  → joins the plate it touches most, its floor's age kept (branch
//                                                            founders, 2026-10-29: handed to the passive ocean, which never
//                                                            moves, it only aged — no trench could reach it — and was
//                                                            stamped pre-history old; a scrap of floor cut off from its
//                                                            plate is captured by its neighbour, as the Farallon plate's
//                                                            last pieces were by the Pacific: Stock & Lee 1994)
//   · ocean only, touching no plate                       → is given to the passive ocean, to be subducted in time
//   · with land, near another plate (fragmentJoinKm)      → joins that plate (a terrane docking, in effect)
//   · with land, far from every other plate               → stays as it is: land is never deleted
// Scraps of land (under terraneMinAreaKm2) join quietly, without an event. A plate that has just received a piece is
// not itself tidied again in the same pass (the piece is not joined to it until the next resolve).

import { CrustType, CrustFlag } from '../model/crust.js';
import { EventKind, BoundaryKind } from '../model/world.js';
import { hopsFrom } from '../../core/mesh-bfs.js';
import { oceanPlateName } from './birth-ocean-plate.js';      // (a cycle of imports: used only once both have loaded)

/** @returns {number} pieces dealt with */
export function tidyPlates(world) {
    const { mesh, plates, owner, config } = world, { adjOffset, adjList, xyz, index, cellAreaKm2 } = mesh;
    const background = plates.find(p => p.isBackground);
    const nearHops = Math.max(1, Math.round(config.fragmentJoinKm / mesh.edgeKm)), received = new Set();
    let handled = 0;
    for (const plate of plates) {
        if (!plate.alive || plate.isBackground || plate.crust.count === 0 || received.has(plate)) continue;
        const pieces = componentsOf(plate.crust, mesh);
        if (pieces.length < 2) continue;
        // (the main piece: the most land — but only land enough to be a terrane counts: an ocean plate broken in two keeps
        // its larger half, not the speck that holds two cells of arc, which left its whole body to join a neighbour as a
        // "scrap"; branch founders, 2026-10-29)
        const terrane = Math.ceil(config.terraneMinAreaKm2 / cellAreaKm2), rank = p => (p.land >= terrane ? p.land : 0);
        pieces.sort((a, b) => rank(b) - rank(a) || b.cells.length - a.cells.length || b.land - a.land);
        for (const piece of pieces.slice(1)) {
            handled++;
            if (piece.land === 0) {
                if (piece.cells.length * cellAreaKm2 >= config.oceanPlateMinAreaKm2) {
                    const fresh = world.addPlate(oceanPlateName(world));
                    fresh.setQuat(plate.quat.slice()); fresh.omega = plate.omega.slice(); fresh.isOceanBorn = true;
                    if (!transferCells(world, plate, fresh, piece.cells)) { fresh.alive = false; continue; }
                    fresh.born = world.time; received.add(fresh);
                    world.log(EventKind.PLATE_BORN, `${fresh.name} is born: ${(piece.cells.length * cellAreaKm2 / 1e6).toFixed(1)} Mkm² of ${plate.name}’s ocean, cut off from the rest of it, moves on as a plate of its own`,
                        { plate: fresh.id, areaMkm2: piece.cells.length * cellAreaKm2 / 1e6, cutOff: true });
                    continue;
                }
                const host = touching(world, plate, piece.cells);
                if (host === GOING_DOWN) {
                    // (a sliver of a plate going down, cut off at its trench: it has gone down — consumed, as at a trench)
                    for (const c of piece.cells) plate.crust.remove(c);
                    plate.markReshaped(); plate.refreshExtent(xyz);
                    world.budget.consumed += piece.cells.length;
                    world.budget.scrapsDownCells = (world.budget.scrapsDownCells ?? 0) + piece.cells.length;
                } else if (host) {
                    // (floor that lands on the host's own crust has gone beneath it: consumed, as at a trench)
                    const moved = transferCells(world, plate, host, piece.cells);
                    world.budget.consumed += piece.cells.length - moved;
                    received.add(host);
                    world.budget.scrapsJoinedCells = (world.budget.scrapsJoinedCells ?? 0) + piece.cells.length;
                }
                else { giveToBackground(world, plate, background, piece.cells); world.budget.scrapsToBackgroundCells = (world.budget.scrapsToBackgroundCells ?? 0) + piece.cells.length; }
                continue;
            }
            // which plate is it nearest to? (other plates' crust within a few world cells of it, nearer counting more)
            const contact = new Map(), P = [0, 0, 0], seen = new Set();
            let ring = [];
            for (const c of piece.cells) { plate.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], P); const w = index.nearest(P[0], P[1], P[2]); if (!seen.has(w)) { seen.add(w); ring.push(w); } }
            for (let hop = 1; hop <= nearHops; hop++) {
                const next = [];
                for (const w of ring) for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
                    const nb = adjList[k];
                    if (seen.has(nb)) continue;
                    seen.add(nb); next.push(nb);
                    const o = owner[nb];
                    if (o >= 0 && o !== plate.id && plates[o].alive && !plates[o].isBackground) contact.set(o, (contact.get(o) ?? 0) + 1 / hop);
                }
                ring = next;
            }
            const host = [...contact.entries()].sort((a, b) => b[1] - a[1])[0], scrap = piece.land * cellAreaKm2 < config.terraneMinAreaKm2;
            if (host) {
                const to = plates[host[0]], moved = transferCells(world, plate, to, piece.cells);
                received.add(to);
                if (!scrap) world.log(EventKind.FRAGMENT, `a piece of ${plate.name} (${(piece.land * cellAreaKm2 / 1e6).toFixed(2)} Mkm² of land) cut off from the rest joins ${to.name}: ${moved} cells`, { from: plate.id, to: to.id, areaMkm2: piece.land * cellAreaKm2 / 1e6, cells: moved });
            }                                              // (land with nothing near it stays put: land is never deleted)
        }
        if (plate.crust.count === 0) { plate.alive = false; plate.omega = [0, 0, 0]; plate.dynamics = null; }
    }
    return handled;
}

/**
 * The live plate (not the passive ocean) that a piece of `plate` borders along the most world cells — the one its
 * cells lie against, so the piece joins it as one piece — or null if it borders none.
 */
const GOING_DOWN = Symbol('going down');
function touching(world, plate, cells) {
    const { mesh, plates, owner, boundaryKind } = world, { adjOffset, adjList, xyz, index } = mesh, P = [0, 0, 0], contact = new Map();
    for (const c of cells) {
        plate.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], P);
        const w = index.nearest(P[0], P[1], P[2]);
        if (owner[w] === plate.id && boundaryKind[w] === BoundaryKind.SUBDUCTING) return GOING_DOWN;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
            const o = owner[adjList[k]];
            if (o >= 0 && o !== plate.id && plates[o].alive && !plates[o].isBackground) contact.set(o, (contact.get(o) ?? 0) + 1);
        }
    }
    let host = -1, most = 0;
    for (const [o, n] of contact) if (n > most || (n === most && o < host)) { most = n; host = o; }
    return host >= 0 ? plates[host] : null;
}

/**
 * Pinholes: a world cell nobody owns, surrounded by one plate's crust (a rewritten raster — suture, rift,
 * collapse — does not land on every world cell). The plate gets a copy of a neighbouring cell there.
 * @returns cells filled
 */
export function fillPinholes(world) {
    const { mesh, owner, ownerCell, plates } = world, { numCells, adjOffset, adjList, xyz, index } = mesh;
    let filled = 0;
    for (let w = 0; w < numCells; w++) {
        if (owner[w] >= 0) continue;
        let plate = -1, from = -1, others = false, count = 0, background = -1;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
            const nb = adjList[k], o = owner[nb];
            if (o < 0) continue;
            if (plates[o].isBackground) background = o;
            if (plate < 0) { plate = o; from = ownerCell[nb]; }
            if (o !== plate) others = true;
            count++;
        }
        if (plate < 0 || count < 3) continue;
        if (others) {                                   // between plates: the passive ocean takes it if it is there at all
            if (background < 0) continue;
            plate = background; from = -1;
        }
        const p = plates[plate], q = p.cellAt(index, xyz[3 * w], xyz[3 * w + 1], xyz[3 * w + 2]);
        if (p.crust.mask[q]) continue;
        if (from < 0) p.crust.create(q, CrustType.OCEAN, -world.config.initialOceanAgeMyr); else p.crust.copyFrom(q, p.crust, from);
        p.markReshaped();
        filled++;
    }
    return filled;
}

/**
 * Join a plate's pieces to its largest one where they lie within `maxKm` of it across empty raster cells: every
 * empty cell lying between the two (on a path no longer than that) gets a copy of the nearest crust beside it —
 * ocean, on the sea side of the seam. For pieces that belong together but were resampled onto one lattice with
 * a seam of missed cells between them.
 * @returns {number} cells filled
 */
export function bridgePieces(plate, mesh, maxKm) {
    const pieces = componentsOf(plate.crust, mesh);
    if (pieces.length < 2) return 0;
    pieces.sort((a, b) => b.cells.length - a.cells.length);
    const { adjOffset, adjList, numCells, edgeKm } = mesh, crust = plate.crust, maxHops = Math.max(2, Math.round(maxKm / edgeKm));
    const overEmpty = cells => hopsFrom(mesh, cells, c => !crust.mask[c], maxHops).dist;       // hops over EMPTY cells from these cells
    const main = overEmpty(pieces[0].cells);
    let filled = 0;
    for (const piece of pieces.slice(1)) {
        const d = overEmpty(piece.cells), between = [];
        for (let c = 0; c < numCells; c++) if (!crust.mask[c] && d[c] > 0 && main[c] > 0 && d[c] + main[c] <= maxHops + 1) between.push(c);
        between.sort((a, b) => Math.min(d[a], main[a]) - Math.min(d[b], main[b]));     // fill from both shores inward
        for (const c of between) {
            let from = -1;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (crust.mask[nb] && (from < 0 || crust.type[nb] === CrustType.OCEAN)) from = nb; }
            if (from < 0) continue;
            if (crust.type[from] === CrustType.OCEAN) crust.copyFrom(c, crust, from);
            else crust.create(c, CrustType.OCEAN, crust.formedAt[from]);          // (beside land only: new sea floor, as old as that coast)
            filled++;
        }
    }
    if (filled) plate.markReshaped();
    return filled;
}

let piecesSeen = null, piecesQueue = null;       // (componentsOf's working arrays, kept between calls)
/** The plate's pieces of crust — joined cell to cell — each its cells (an Int32Array, breadth-first from its first cell) and its count of land cells. */
export function componentsOf(crust, mesh) {
    const { numCells, adjOffset, adjList } = mesh, { mask, type } = crust;
    if (!piecesSeen || piecesSeen.length !== numCells) { piecesSeen = new Uint8Array(numCells); piecesQueue = new Int32Array(numCells); }
    const seen = piecesSeen.fill(0), queue = piecesQueue, pieces = [];
    // (each piece is a run of one shared queue, filled breadth-first; copied out once it is complete)
    let n = 0;
    for (let s = 0; s < numCells; s++) {
        if (!mask[s] || seen[s]) continue;
        const from = n;
        queue[n++] = s; seen[s] = 1;
        let land = 0;
        for (let i = from; i < n; i++) {
            const c = queue[i];
            if (type[c] !== CrustType.OCEAN) land++;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (mask[nb] && !seen[nb]) { seen[nb] = 1; queue[n++] = nb; } }
        }
        pieces.push({ cells: queue.slice(from, n), land });
    }
    return pieces;
}

/**
 * Move raster cells of `from` onto `to` (resampled once into `to`'s frame); `to` keeps its own land where
 * the two overlap — moved land there goes onto the nearest free cell beside it (stacked, as an arc collapse
 * does), or failing that is absorbed: it is the same ground, already land on the host, and left behind it would
 * sit under the host's land for ever as a piece that can never join. Trench flags on moved land are dropped
 * (the polarity rule re-establishes them). `reachHops` > 1 looks further for a free cell, through the host's land, before
 * absorbing — for a move that only resamples ground that does not overlap the host's (a back-arc strip rejoining its
 * parent: two of its cells can fall on one of the parent's, and that is the lattice, not a collision).
 * @returns {number} cells written onto `to`
 */
export function transferCells(world, from, to, cells, reachHops = 1) {
    const { mesh } = world, { xyz, index, adjOffset, adjList } = mesh, F = from.crust, T = to.crust;
    const P = [0, 0, 0];
    let moved = 0;
    const isHostLand = q => T.mask[q] && T.type[q] !== CrustType.OCEAN;
    for (const c of cells) {
        from.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], P);
        let q = to.cellAt(index, P[0], P[1], P[2]);
        const land = F.type[c] !== CrustType.OCEAN;
        if (land && isHostLand(q)) {                                                    // the host's own land is here
            const at = q;
            q = freeCellBeside(to, mesh, at, P, isHostLand);
            if (q < 0 && reachHops > 1) q = freeCellWithin(to, mesh, at, reachHops, isHostLand);
        }
        if (q >= 0 && (land || !T.mask[q])) {
            T.copyFrom(q, F, c);
            if (land) T.flags[q] &= ~CrustFlag.TRENCH;
            moved++;
        }
        F.remove(c);
    }
    from.markReshaped(); to.markReshaped();
    from.refreshExtent(xyz); to.refreshExtent(xyz);
    return moved;
}

/**
 * Moved land that would land on a taken cell `q` of `to` goes onto the free neighbour of q nearest its world
 * position `P` (stacked beside it, as an arc collapse does), or −1 when every neighbour is taken.
 * @param {(q: number) => boolean} taken
 */
export function freeCellBeside(to, mesh, q, P, taken) {
    const { xyz, adjOffset, adjList } = mesh, L = to.toPlateFrame(P[0], P[1], P[2], [0, 0, 0]);
    let best = -1, bestD = Infinity;
    for (let k = adjOffset[q]; k < adjOffset[q + 1]; k++) {
        const nb = adjList[k];
        if (taken(nb)) continue;
        const d = (xyz[3 * nb] - L[0]) ** 2 + (xyz[3 * nb + 1] - L[1]) ** 2 + (xyz[3 * nb + 2] - L[2]) ** 2;
        if (d < bestD) { bestD = d; best = nb; }
    }
    return best;
}

/** The free cell of `to` nearest `q` in hops through taken cells, at most `hops` away, or −1. */
function freeCellWithin(to, mesh, q, hops, taken) {
    const { adjOffset, adjList } = mesh, seen = new Set([q]);
    let ring = [q];
    for (let h = 0; h < hops && ring.length; h++) {
        const next = [];
        for (const c of ring) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (seen.has(nb)) continue;
            seen.add(nb);
            if (!taken(nb)) return nb;
            next.push(nb);
        }
        ring = next;
    }
    return -1;
}

/** Hand raster cells of `plate` back to the passive ocean (as old ocean at their world positions), pinholes filled. */
export function giveToBackground(world, plate, background, cells) {
    const { xyz, index, adjOffset, adjList } = world.mesh, { owner } = world, P = [0, 0, 0];
    for (const c of cells) {
        if (background) {
            plate.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], P);
            const w = index.nearest(P[0], P[1], P[2]), age = Math.min(plate.crust.formedAt[c], -1);
            if (!background.crust.mask[w]) background.crust.create(w, CrustType.OCEAN, age);
            // a rotated raster does not land on every world cell: fill the pinholes beside it that nobody owns
            for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) { const nb = adjList[k]; if (owner[nb] === plate.id && !background.crust.mask[nb] && !plate.crust.mask[plate.cellAt(index, xyz[3 * nb], xyz[3 * nb + 1], xyz[3 * nb + 2])]) background.crust.create(nb, CrustType.OCEAN, age); }
        }
        plate.crust.remove(c);
    }
    plate.markReshaped();
    if (background) background.markReshaped();
    plate.refreshExtent(xyz);
}

