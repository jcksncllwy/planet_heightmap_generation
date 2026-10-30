// The "gather": how the world view is rebuilt from plate-frame rasters. For every world cell, each
// plate is asked "do you have crust here?" by rotating the cell's position into the plate's frame
// and looking up the nearest raster cell. Gathering (rather than scattering each plate's cells
// into the world) is what guarantees a plate's interior can never show holes.
//
// Plates are visited in id order, so a claim handler sees lower ids first. Both users of this loop —
// step/reconstruct.js (read-only) and step/resolve.js (settles conflicts) — are written so that the
// outcome does not depend on that order.

import { ringsOf, RING_COUNT } from '../../core/mesh-rings.js';

/**
 * Calls `onClaim(worldCell, plate, rasterCell)` for every (world cell, plate) pair where the plate has
 * crust under that world cell. Plates whose bounding cap cannot reach a cell are skipped cheaply.
 */
export function forEachClaim(world, onClaim) {
    const { mesh, plates } = world, { xyz, numCells, index } = mesh;
    for (const plate of plates) {
        if (!plate.alive || plate.crust.count === 0) continue;
        const mask = plate.crust.mask, [cx, cy, cz, capCos] = plate.capInWorld(mesh);
        if (isIdentity(plate.mat)) {                    // not rotated (the passive background): world cell w IS raster cell w
            for (let w = 0; w < numCells; w++) {
                if (xyz[3 * w] * cx + xyz[3 * w + 1] * cy + xyz[3 * w + 2] * cz < capCos) continue;
                if (mask[w]) onClaim(w, plate, w);
            }
            continue;
        }
        // Two exact shortcuts (what is claimed never changes):
        // · the world cell → raster cell map depends on the rotation alone, and nearly every step gathers twice with the
        //   same rotations (before and after the events), so each plate keeps its map until it turns: map[w] = the raster
        //   cell, −1 = not looked up yet, ≤ −2 = skipped (below), holding the index's first guess as −2 − guess;
        // · a lookup is skipped where the crust is nowhere near: the true nearest raster cell is always within 2 hops of
        //   the index's first guess, so if that guess is not crust and lies over RING_COUNT rings from the crust's edge,
        //   the answer cannot be crust — re-tested against the crust of the moment whenever the map is reused.
        const map = claimMap(plate, numCells), m = plate.mat;
        let near = null;
        // (the mesh's cells are numbered down the sphere — a Fibonacci spiral — so blocks of them lie in bands of latitude:
        // a block wholly outside the cap's band of latitude is passed over; every other cell is tested as before, in order)
        const blocks = latitudeBlocks(mesh), { zLo, zHi } = capBand(cx, cy, cz, capCos);
        for (let b = 0, w = 0; b < blocks.count; b++) {
            const end = Math.min(numCells, w + BLOCK);
            if (blocks.zMax[b] < zLo || blocks.zMin[b] > zHi) { w = end; continue; }
            for (; w < end; w++) {
                const x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2];
                if (x * cx + y * cy + z * cz < capCos) continue;
                let cell = map[w];
                if (cell < 0) {
                    const px = m[0] * x + m[3] * y + m[6] * z, py = m[1] * x + m[4] * y + m[7] * z, pz = m[2] * x + m[5] * y + m[8] * z;
                    const guess = cell === -1 ? index.start(px, py, pz) : -2 - cell;
                    near ??= nearEdge(plate, mesh);
                    if (!mask[guess] && !near.count[guess]) { map[w] = -2 - guess; continue; }
                    cell = map[w] = index.walk(guess, px, py, pz);
                }
                if (mask[cell]) onClaim(w, plate, cell);
            }
        }
    }
}

// Blocks of BLOCK consecutive cells, each with the least and greatest z of its cells (per mesh, once).
const BLOCK = 128, blocksOf = new WeakMap();
function latitudeBlocks(mesh) {
    let B = blocksOf.get(mesh);
    if (B) return B;
    const { xyz, numCells } = mesh, count = Math.ceil(numCells / BLOCK);
    B = { count, zMin: new Float64Array(count).fill(Infinity), zMax: new Float64Array(count).fill(-Infinity) };
    for (let w = 0; w < numCells; w++) { const b = (w / BLOCK) | 0, z = xyz[3 * w + 2]; if (z < B.zMin[b]) B.zMin[b] = z; if (z > B.zMax[b]) B.zMax[b] = z; }
    blocksOf.set(mesh, B);
    return B;
}
/** The band of z a cap (unit centre, cosine of its radius) covers, widened by a margin far beyond rounding (1e-4 ≈ 0.6 km). */
function capBand(cx, cy, cz, capCos) {
    if (capCos <= -1) return { zLo: -Infinity, zHi: Infinity };
    const theta = Math.acos(Math.max(-1, Math.min(1, cz))), r = Math.acos(capCos);
    return { zLo: Math.cos(Math.min(Math.PI, theta + r)) - 1e-4, zHi: Math.cos(Math.max(0, theta - r)) + 1e-4 };
}

/** The plate's world cell → raster cell map for its current rotation (see forEachClaim), reset when it has turned. */
function claimMap(plate, numCells) {
    let c = plate._claimMap;
    const m = plate.mat;
    if (!c || c.map.length !== numCells) c = plate._claimMap = { map: new Int32Array(numCells).fill(-1), mat: new Float64Array(9).fill(NaN) };
    for (let i = 0; i < 9; i++) if (c.mat[i] !== m[i]) { c.map.fill(-1); c.mat.set(m); break; }
    return c.map;
}

/**
 * The plate's world cell → raster cell map (see forEachClaim) if it is for the plate's rotation of the moment, else null.
 * Between a gather and the next turn of the plates (a resolve's growth and gap owners) it answers plate.cellAt for a world
 * cell's position: rasterCellUnder.
 */
export function currentClaimMap(plate) {
    const c = plate._claimMap, m = plate.mat;
    if (!c) return null;
    for (let i = 0; i < 9; i++) if (c.mat[i] !== m[i]) return null;
    return c.map;
}

/**
 * plate.cellAt(index, world cell w's position), from `map` = currentClaimMap(plate): the gather's answer where it looked
 * w up, else the same walk from the same first guess (kept, for the next gather and asker) — the same rotated position,
 * so the same cell, ties included.
 */
export function rasterCellUnder(map, plate, mesh, w) {
    let cell = map[w];
    if (cell >= 0) return cell;
    const { xyz, index } = mesh, m = plate.mat, x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2];
    const px = m[0] * x + m[3] * y + m[6] * z, py = m[1] * x + m[4] * y + m[7] * z, pz = m[2] * x + m[5] * y + m[8] * z;
    return (map[w] = index.walk(cell === -1 ? index.start(px, py, pz) : -2 - cell, px, py, pz));
}

/**
 * Which raster cells of `plate` lie within RING_COUNT rings of the edge of its crust — a crust cell with a non-crust
 * neighbour: `count[cell] > 0`, the number of edge cells within those rings of it. With the crust itself, that covers
 * every cell the nearest-cell search can end on from a first guess that is not counted.
 * `within1` and `within2` count the same within 1 and 2 rings. For a cell that is not crust, the nearest crust lies
 * exactly as many rings away as the nearest edge cell (the first crust cell on a shortest path to crust is an edge
 * cell): so the three counts say how far away the nearest crust is — 1, 2, 3 rings, or further (step/resolve.js
 * nearestCrustInto starts its search there and skips a search that would find nothing).
 * Kept up to date rather than rebuilt (the mask in the raster's own frame: the plate's turning does not touch it): each
 * call finds the cells whose mask changed since the last — a few hundred of a raster's cells, from step to step — and
 * recounts the edge cells only around them. The same cells as counting afresh.
 */
export function nearEdge(plate, mesh) {
    const { numCells, adjOffset, adjList } = mesh, mask = plate.crust.mask, { start, cells, stride } = ringsOf(mesh);
    let near = plate._nearEdge;
    if (!near || near.seen.length !== numCells) near = plate._nearEdge = { seen: new Uint8Array(numCells), edge: new Uint8Array(numCells), count: new Uint8Array(numCells),
        within1: new Uint8Array(numCells), within2: new Uint8Array(numCells), touched: new Uint32Array(numCells), stamp: 0, list: [], raster: null, version: -1 };
    const { seen, edge, count, within1, within2, touched, list } = near;
    // (nothing to do while it is the same raster and no cell of its mask has changed since: model/crust.js `version`)
    if (near.raster === plate.crust && near.version === plate.crust.version) return near;
    near.raster = plate.crust; near.version = plate.crust.version;
    // (the cells whose mask changed: compared four at a time — nearly every word is the same)
    list.length = 0;
    const words = numCells >> 2, aligned = !(mask.byteOffset & 3);
    let from = 0;
    if (aligned) {
        const a = view32(seen), b = view32(mask);
        for (let i = 0; i < words; i++) if (a[i] !== b[i]) for (let c = 4 * i; c < 4 * i + 4; c++) if (seen[c] !== mask[c]) list.push(c);
        from = 4 * words;
    }
    for (let c = from; c < numCells; c++) if (seen[c] !== mask[c]) list.push(c);
    if (!list.length) return near;
    for (const c of list) seen[c] = mask[c];
    // (a cell is an edge cell by its own mask and its neighbours': only the changed cells and their neighbours can have
    // become one or stopped being one — each recounted once)
    if (++near.stamp === 0xFFFFFFFF) { touched.fill(0); near.stamp = 1; }
    const stamp = near.stamp;
    const recount = c => {
        if (touched[c] === stamp) return;
        touched[c] = stamp;
        let isEdge = 0;
        if (mask[c]) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (!mask[adjList[k]]) { isEdge = 1; break; }
        if (isEdge === edge[c]) return;
        edge[c] = isEdge;
        const d = isEdge ? 1 : -1, b = c * stride, e1 = start[b + 2], e2 = start[b + 3];
        let i = start[b];
        for (; i < e1; i++) { const x = cells[i]; within1[x] += d; within2[x] += d; count[x] += d; }
        for (; i < e2; i++) { const x = cells[i]; within2[x] += d; count[x] += d; }
        for (const e = start[b + RING_COUNT + 1]; i < e; i++) count[cells[i]] += d;
    };
    for (const c of list) {
        recount(c);
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) recount(adjList[k]);
    }
    return near;
}
const views = new WeakMap();
function view32(a) { let v = views.get(a); if (!v) views.set(a, v = new Uint32Array(a.buffer, a.byteOffset, a.length >> 2)); return v; }

const isIdentity = m => m[0] === 1 && m[4] === 1 && m[8] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0 && m[5] === 0 && m[6] === 0 && m[7] === 0;

/** Reset the per-step world view before a gather. */
export function clearWorldView(world) {
    world.owner.fill(-1);
    world.claimCount.fill(0);
    world.landClaims.fill(0);
    world.collider.fill(-1);
    world.consumedAt.fill(0);
    world.provisional.fill(0);
}
