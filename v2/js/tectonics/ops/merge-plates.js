// Suturing two colliding plates into one — and redrawing their outlines as we do it, the way WBP
// redraws continents by hand at a collision. This is the one moment the engine deforms crust; at
// every other time rasters are rigid.
//
// Everything is done in the UPPER plate's frame, into which the lower plate is resampled once:
//   1. The overlap zone is the indenter: the lower plate's nose, pushed into the upper plate. Its
//      local depth (the thickness of the overlap lens) is the indentation there.
//   2. The upper plate's crust in and behind the overlap is DISPLACED: back, away from the indenter,
//      and — toward the ends of the front — sideways out of its way (escape tectonics: Indochina
//      squeezed out ahead of India). Displacement tapers with distance behind the front.
//      Applied as an inverse warp (every destination cell fetches its source), so the result has no
//      holes; where crust is compressed some source cells simply go unclaimed — that crust went into
//      thickness, which the orogeny records carry.
//   3. Cratons are rigid blocks: each moves by one displacement (the field at its centre) and is
//      stamped back cell-for-cell, never warped.
//   4. The indenter's crust fills the overlap; the rest of the lower plate is copied in.
//   5. Sea caught between the two plates closes where it is narrow, and small enclosed seas close too
//      (the plates deform together as they weld); large inland seas survive.
//   6. The closed seam becomes a SUTURE belt; a plateau belt is painted over the deformed zone and a
//      foreland belt on the indenter's side.
// Land area lost = the overlap cells, the two plates' share of the shortening; reported in the event.

import { CrustRaster, CrustType, CrustFlag } from '../model/crust.js';
import { PLANET_RADIUS_KM } from '../../core/sim-mesh.js';
import { spreadBelt, beltWidthKm, OrogenyType, BeltSide } from '../step/orogeny.js';
import { tangentToward } from '../../core/sphere-geom.js';
import { hopsFrom } from '../../core/mesh-bfs.js';
import { centroidOfCells } from '../../core/sphere-geom.js';

/**
 * @param {import('../model/plate.js').Plate} upper   survives, with the merged crust
 * @param {import('../model/plate.js').Plate} lower   dies
 * @param {number[]} overlapWorldCells                world cells where both plates have land
 * @param {import('../step/collision.js').Collision} collision   the record that triggered this
 * @returns {{landLostCells: number, maxIndentKm: number, meanIndentKm: number, overlapCells: number}}
 */
export function mergePlates(world, upper, lower, overlapWorldCells, collision) {
    const { mesh, config, time } = world, { xyz, numCells, index, adjOffset, adjList, edgeKm } = mesh;
    const U = upper.crust, L = lower.crust;
    const landBefore = upper.stats.continentalCells + lower.stats.continentalCells;
    const hue = (lower.stats.cells > upper.stats.cells ? lower : upper).hue;     // (the welded plate is drawn in the larger one's colour)

    // ── the lower plate seen from the upper plate's frame ──
    const fromL = new Int32Array(numCells).fill(-1), p = [0, 0, 0];
    for (let q = 0; q < numCells; q++) {
        upper.toWorld(xyz[3 * q], xyz[3 * q + 1], xyz[3 * q + 2], p);
        const c = lower.cellAt(index, p[0], p[1], p[2]);
        if (L.mask[c]) fromL[q] = c;
    }
    const uLand = q => U.mask[q] && U.type[q] !== CrustType.OCEAN;
    const lLand = q => fromL[q] >= 0 && L.type[fromL[q]] !== CrustType.OCEAN;
    const inO = new Uint8Array(numCells);
    let oCount = 0;
    for (let q = 0; q < numCells; q++) if (uLand(q) && lLand(q)) { inO[q] = 1; oCount++; }
    if (oCount === 0) for (const w of overlapWorldCells) { const q = upper.cellAt(index, xyz[3 * w], xyz[3 * w + 1], xyz[3 * w + 2]); if (!inO[q]) { inO[q] = 1; oCount++; } }

    // ── the indenter's shape: depth of the overlap lens, and where along the front each cell sits ──
    const rearSide = [], noseSide = [];        // overlap cells touching the upper body / the lower body
    for (let q = 0; q < numCells; q++) {
        if (!inO[q]) continue;
        for (let k = adjOffset[q]; k < adjOffset[q + 1]; k++) {
            const nb = adjList[k];
            if (inO[nb]) continue;
            if (uLand(nb)) { rearSide.push(q); break; }
        }
        for (let k = adjOffset[q]; k < adjOffset[q + 1]; k++) {
            const nb = adjList[k];
            if (inO[nb]) continue;
            if (lLand(nb)) { noseSide.push(q); break; }
        }
    }
    const within = q => inO[q] === 1;
    const dRear = hopsFrom(mesh, rearSide, within), dNose = hopsFrom(mesh, noseSide, within);
    const oCells = [];
    for (let q = 0; q < numCells; q++) if (inO[q]) oCells.push(q);
    const centre = centroidOfCells(xyz, oCells);
    const endA = farthest(xyz, oCells, centre), endB = farthest(xyz, oCells, xyz.subarray(3 * endA, 3 * endA + 3));
    const dA = hopsFrom(mesh, [endA], within), dB = hopsFrom(mesh, [endB], within);
    const depthKm = new Float32Array(numCells), along = new Float32Array(numCells), nHat = new Float32Array(3 * numCells);
    let maxIndent = 0, sumIndent = 0;
    for (const q of oCells) {
        depthKm[q] = ((dRear.dist[q] < 0 ? 0 : dRear.dist[q]) + (dNose.dist[q] < 0 ? 0 : dNose.dist[q]) + 1) * edgeKm * Math.sqrt(3) / 2;
        maxIndent = Math.max(maxIndent, depthKm[q]); sumIndent += depthKm[q];
        const a = dA.dist[q] < 0 ? 0 : dA.dist[q], b = dB.dist[q] < 0 ? 0 : dB.dist[q];
        along[q] = (b - a) / (a + b + 1e-9);                                    // +1 at end A, −1 at end B, 0 mid-front
        // the push direction: from the nose side toward the rear (the upper body)
        const from = dNose.source[q] >= 0 ? dNose.source[q] : q, to = dRear.source[q] >= 0 ? dRear.source[q] : q;
        const n = from === to ? tangentToward(pos(xyz, q), lowerCentreIn(upper, lower), upper.capCenter) : tangentToward(pos(xyz, q), pos(xyz, from), pos(xyz, to));
        nHat[3 * q] = n[0]; nHat[3 * q + 1] = n[1]; nHat[3 * q + 2] = n[2];
    }

    // ── the displacement field over the upper plate: decays behind the front ──
    const reach = hopsFrom(mesh, oCells, () => true, Math.ceil(config.indentFalloffKm / edgeKm) + 1);
    const disp = new Float32Array(3 * numCells);                                 // km, tangent, per upper-frame cell
    const posA = pos(xyz, endA), posB = pos(xyz, endB);
    for (let q = 0; q < numCells; q++) {
        const near = reach.source[q];
        if (near < 0) continue;
        const distKm = reach.dist[q] * edgeKm * Math.sqrt(3) / 2, g = distKm >= config.indentFalloffKm ? 0 : (1 - distKm / config.indentFalloffKm) ** 1.5;
        const m = config.indentGain * depthKm[near] * g;
        if (m <= 0) continue;
        const k = config.escapeShare * Math.abs(along[near]), here = pos(xyz, q);
        const e = tangentToward(here, here, along[near] > 0 ? posA : posB);       // sideways, toward the nearer end of the front
        const n = [nHat[3 * near], nHat[3 * near + 1], nHat[3 * near + 2]];
        for (let i = 0; i < 3; i++) disp[3 * q + i] = m * ((1 - k) * n[i] + k * e[i]);
    }

    // ── build the merged raster ──
    const out = new CrustRaster(numCells), origin = new Int8Array(numCells);      // origin: 1 = upper, 2 = lower
    const moved = [0, 0, 0];
    for (let q = 0; q < numCells; q++) {
        let s = q;
        const dx = disp[3 * q], dy = disp[3 * q + 1], dz = disp[3 * q + 2];
        // (the redraw deforms the two plates within their own outline: crust pushed back from the front and out at its ends
        // goes into thickness and into the ground the two already cover — it does not spill past the upper plate's edge into
        // a third plate, which holds it back. Spilled, a weld shoved a band of land 1–2 cells deep along ~13,000 km of a
        // neighbour's coast in one step: 2.1 Mkm² of land on land, the invariants' "stacked 965 km deep", seed 592250)
        if (!U.mask[q] && fromL[q] < 0) continue;
        if (dx * dx + dy * dy + dz * dz > 0) {
            const r = 1 / PLANET_RADIUS_KM;
            moved[0] = xyz[3 * q] - dx * r; moved[1] = xyz[3 * q + 1] - dy * r; moved[2] = xyz[3 * q + 2] - dz * r;
            const l = Math.hypot(moved[0], moved[1], moved[2]);
            s = index.nearest(moved[0] / l, moved[1] / l, moved[2] / l);            // inverse warp: fetch the source
            // (land squeezed back from the front stays land: shortening thickens a continent, it does not draw the sea in
            // behind its coast. Fetched as it was, the sideways pull at the front's ends brought the coast's own ocean into
            // the land behind it — ~1.6 Mkm² of new inland sea per 1000 Myr history, sealed at once, seed 777)
            if (U.mask[q] && U.type[q] !== CrustType.OCEAN && U.mask[s] && U.type[s] === CrustType.OCEAN) s = q;
        }
        if (!U.mask[s]) continue;
        out.copyFrom(q, U, s);
        origin[q] = 1;
        if (U.type[s] === CrustType.CRATON) out.type[q] = CrustType.CONTINENT;             // cratons are stamped back rigidly below
    }
    stampCratonsRigidly(out, U, disp, mesh);

    for (let q = 0; q < numCells; q++) {
        const c = fromL[q];
        if (c < 0) continue;
        const land = L.type[c] !== CrustType.OCEAN;
        if (!land && out.mask[q]) continue;                                       // the upper plate's crust wins over the lower's ocean
        if (out.mask[q] && out.type[q] === CrustType.CRATON) continue;            // …and its cratons over anything: a craton never breaks
        out.copyFrom(q, L, c);
        origin[q] = 2;
    }

    // ── holes the warp left inside the merged crust (a destination whose source fell outside both plates): each takes a
    // neighbour's crust — land where most of its neighbours are land. Left empty, the next step would grow new ocean in
    // them: slivers of sea along the seam (Phase 11) ──
    for (let pass = 0; pass < 2; pass++) {
        const fills = [];
        for (let q = 0; q < numCells; q++) {
            if (out.mask[q]) continue;
            let crust = 0, land = 0, landFrom = -1, seaFrom = -1;
            for (let k = adjOffset[q]; k < adjOffset[q + 1]; k++) {
                const nb = adjList[k];
                if (!out.mask[nb]) continue;
                crust++;
                if (out.type[nb] !== CrustType.OCEAN) { land++; if (landFrom < 0) landFrom = nb; } else if (seaFrom < 0) seaFrom = nb;
            }
            if (crust < 4) continue;                                                // (the plate's own edge, not a hole)
            fills.push([q, 2 * land >= crust ? landFrom : seaFrom]);
        }
        for (const [q, from] of fills) { out.copyFrom(q, out, from); if (out.type[q] === CrustType.CRATON) out.type[q] = CrustType.CONTINENT; origin[q] = origin[from]; }
        if (!fills.length) break;
    }

    // ── sea caught between the two plates closes: narrow straits, and small enclosed seas ──
    const { sealed, landSealed, paid: sealPaid, arcSealed, arcPaid } = closeSeasBetween(out, origin, mesh, upper, config, time);

    // ── the seam becomes a suture belt ──
    const seam = [];
    for (let q = 0; q < numCells; q++) {
        if (!out.mask[q] || out.type[q] === CrustType.OCEAN) continue;
        for (let k = adjOffset[q]; k < adjOffset[q + 1]; k++) { const nb = adjList[k]; if (out.mask[nb] && out.type[nb] !== CrustType.OCEAN && origin[nb] !== origin[q]) { seam.push(q); break; } }
    }
    const sutureReach = hopsFrom(mesh, seam, q => out.mask[q] && out.type[q] !== CrustType.OCEAN, Math.max(1, Math.round(config.sutureHalfWidthKm / edgeKm)));
    for (let q = 0; q < numCells; q++) if (sutureReach.dist[q] >= 0 && out.type[q] !== CrustType.CRATON) out.flags[q] |= CrustFlag.SUTURE;

    // ── records over the redrawn zone: plateau belt behind the seam, foreland belt ahead of it ──
    const merged = { crust: out }, meanIndent = sumIndent / Math.max(1, oCount);
    const rearSeam = seam.filter(q => origin[q] === 1), noseSeam = seam.filter(q => origin[q] === 2);
    const total = collision.shorteningKm + meanIndent, rate = collision.meanRateCmYr;
    spreadBelt(merged, mesh, rearSeam, { type: OrogenyType.HIMALAYAN, widthKm: beltWidthKm('himalayan', total, rate, config), workKm: meanIndent, time, side: BeltSide.UPPER, keepShear: true }, config, q => origin[q] === 1);
    spreadBelt(merged, mesh, noseSeam, { type: OrogenyType.HIMALAYAN, widthKm: beltWidthKm('foreland', total, rate, config), workKm: meanIndent, time, side: BeltSide.LOWER, keepShear: true }, config, q => origin[q] === 2);

    // ── hand over ──
    upper.crust = out;
    upper.wings.clear();                  // (wing tips are keyed by raster cell, and the warp moved every cell: they start afresh)
    upper.markReshaped();
    upper.refreshExtent(xyz);
    upper.name = world.nameByCratons(upper, `${upper.name}+${lower.name}`);
    upper.born = time;                    // a continent just assembled is NEW: its tenure (riftTenureMyr) starts again here,
    upper.bornOfRift = false;
                                          // or it would come apart the moment it welded (developer)
    lower.alive = false;
    upper.hue = hue;
    lower.crust = new CrustRaster(numCells);
    lower.omega = [0, 0, 0];
    lower.dynamics = null;
    lower.refreshExtent(xyz);
    return { landLostCells: landBefore - (upper.stats.continentalCells - sealed + sealPaid + arcPaid), maxIndentKm: maxIndent, meanIndentKm: meanIndent, overlapCells: oCount, sealedCells: sealed, sealedLandCells: landSealed, sealPaidCells: sealPaid, sealedArcCells: arcSealed, arcPaidCells: arcPaid };
}

/**
 * Where the two plates' land comes close, the sea between them is squeezed shut: a strait narrower than
 * 2 × sealStraitKm, and any enclosed sea smaller than inlandSeaMaxKm2. Filled cells become continental
 * crust of the nearer plate, marked origin 3 so the seam runs round them — and every cell filled in is paid for with a
 * cell of coast of its kind from the land beside it (the lower plate's leading edge first).
 * @returns {{sealed: number, landSealed: number, paid: number, arcSealed: number, arcPaid: number}} cells closed; of them continent,
 *   and the continent's coast cells given back for them; of them arc, and the coast cells (arc, else continent) given back for those
 */
export function closeSeasBetween(out, origin, mesh, upper, config, time) {
    const { numCells, adjOffset, adjList, edgeKm, xyz, index } = mesh;
    const isLand = q => out.mask[q] && out.type[q] !== CrustType.OCEAN, isSea = q => !isLand(q);
    const land1 = [], land2 = [];
    for (let q = 0; q < numCells; q++) if (isLand(q)) (origin[q] === 1 ? land1 : land2).push(q);
    const reachHops = Math.max(1, Math.round(config.sealStraitKm / edgeKm));
    const from1 = hopsFrom(mesh, land1, isSea, reachHops), from2 = hopsFrom(mesh, land2, isSea, reachHops);
    const fill = new Uint8Array(numCells);
    for (let q = 0; q < numCells; q++) if (isSea(q) && from1.dist[q] > 0 && from2.dist[q] > 0) fill[q] = 1;

    // enclosed seas: sea not reachable from the open ocean (start from the far side of the planet)
    const far = index.nearest(-upper.capCenter[0], -upper.capCenter[1], -upper.capCenter[2]);
    const open = new Uint8Array(numCells), stack = [far];
    if (isSea(far) && !fill[far]) open[far] = 1; else stack.length = 0;
    while (stack.length) {
        const q = stack.pop();
        for (let k = adjOffset[q]; k < adjOffset[q + 1]; k++) { const nb = adjList[k]; if (!open[nb] && isSea(nb) && !fill[nb]) { open[nb] = 1; stack.push(nb); } }
    }
    const seen = new Uint8Array(numCells), maxCells = config.inlandSeaMaxKm2 / mesh.cellAreaKm2;
    for (let q = 0; q < numCells; q++) {
        if (seen[q] || !isSea(q) || fill[q] || open[q]) continue;
        const component = [q]; seen[q] = 1;
        for (let i = 0; i < component.length; i++) for (let k = adjOffset[component[i]]; k < adjOffset[component[i] + 1]; k++) {
            const nb = adjList[k];
            if (!seen[nb] && isSea(nb) && !fill[nb] && !open[nb]) { seen[nb] = 1; component.push(nb); }
        }
        if (component.length <= maxCells) for (const c of component) fill[c] = 1;
    }

    // fill from the nearest land of either plate
    const toFill = [];
    for (let q = 0; q < numCells; q++) if (fill[q]) toFill.push(q);
    if (!toFill.length) return 0;
    const nearestLand = hopsFrom(mesh, [...land1, ...land2], q => fill[q] === 1);
    for (const q of toFill) {
        const s = nearestLand.source[q] >= 0 ? nearestLand.source[q] : land1[0];
        out.copyFrom(q, out, s);
        if (out.type[q] === CrustType.CRATON) out.type[q] = CrustType.CONTINENT;      // fill takes the kind of land it joins (arc stays arc)
        out.formedAt[q] = time;
        out.flags[q] = CrustFlag.SUTURE;
        out.slabKm[q] = 0;
        origin[q] = 3;
    }
    // ── …and the margins pay for it (crust-sink branch). The sea closed because the two coasts converged on it, not
    // because crust was made there: a seam a cell or two wide is the raster's, the real coasts meeting. So every cell
    // filled in is taken from the crust of its kind beside it — continent for continent, island arc for arc (continent if
    // no arc coast is left) — the lower plate's (or the terrane's) leading edge first, the underthrust front, nearest the
    // seam first; then the upper plate's — as coast given back to the sea. A weld or a dock makes no crust. (Was: ~17 Mkm²
    // over a 1200 Myr history filled from nothing, most of it arc that later matured into continent.) ──
    const owedOf = [0, 0, 0, 0];
    for (const q of toFill) owedOf[out.type[q]]++;
    const owed = owedOf[CrustType.CONTINENT];
    let paid = 0, arcPaid = 0;
    if (owedOf[CrustType.CONTINENT] + owedOf[CrustType.ARC]) {
        const near = hopsFrom(mesh, toFill, q => out.mask[q] && out.type[q] !== CrustType.OCEAN);
        const coastOf = { [CrustType.CONTINENT]: [], [CrustType.ARC]: [] };
        for (let q = 0; q < numCells; q++) {
            if (!out.mask[q] || origin[q] === 3 || near.dist[q] < 0 || !coastOf[out.type[q]]) continue;
            let sea = -1;
            for (let k = adjOffset[q]; k < adjOffset[q + 1]; k++) { const nb = adjList[k]; if (out.mask[nb] && out.type[nb] === CrustType.OCEAN) { sea = nb; break; } }
            if (sea >= 0) coastOf[out.type[q]].push([q, sea]);
        }
        for (const list of Object.values(coastOf)) list.sort(([p], [q]) => (origin[p] === 2 ? 0 : 1) - (origin[q] === 2 ? 0 : 1) || near.dist[p] - near.dist[q] || p - q);
        const give = (list, n) => {
            let given = 0;
            for (const [q, sea] of list) {
                if (given >= n) break;
                if (out.type[q] === CrustType.OCEAN) continue;
                out.create(q, CrustType.OCEAN, out.formedAt[sea]);
                out.flags[q] = CrustFlag.APRON;
                origin[q] = 0;
                given++;
            }
            return given;
        };
        paid = give(coastOf[CrustType.CONTINENT], owed);
        arcPaid = give(coastOf[CrustType.ARC], owedOf[CrustType.ARC]);
        arcPaid += give(coastOf[CrustType.CONTINENT], owedOf[CrustType.ARC] - arcPaid);
    }
    return { sealed: toFill.length, landSealed: owed, paid, arcSealed: owedOf[CrustType.ARC], arcPaid };
}

/** Each craton of the (pre-warp) raster moves as one block by the field at its cells' mean, and is written back cell-for-cell. */
function stampCratonsRigidly(out, U, disp, mesh) {
    const { xyz, index, numCells } = mesh, r = 1 / PLANET_RADIUS_KM;
    const blocks = new Map();
    for (let c = 0; c < numCells; c++) {
        if (!U.mask[c] || U.type[c] !== CrustType.CRATON) continue;
        const b = blocks.get(U.terrane[c]) ?? blocks.set(U.terrane[c], { cells: [], d: [0, 0, 0] }).get(U.terrane[c]);
        b.cells.push(c);
        for (let i = 0; i < 3; i++) b.d[i] += disp[3 * c + i];
    }
    for (const b of blocks.values()) {
        const d = b.d.map(v => v / b.cells.length * r);
        for (const c of b.cells) {
            const x = xyz[3 * c] + d[0], y = xyz[3 * c + 1] + d[1], z = xyz[3 * c + 2] + d[2], l = Math.hypot(x, y, z);
            out.copyFrom(index.nearest(x / l, y / l, z / l), U, c);
        }
    }
}

/** Breadth-first hop distance from `sources` through cells where `canEnter`, remembering which source each cell came from. */

const pos = (xyz, c) => [xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]];
function farthest(xyz, cells, from) {
    let best = cells[0], bestDot = 2;
    for (const c of cells) { const d = xyz[3 * c] * from[0] + xyz[3 * c + 1] * from[1] + xyz[3 * c + 2] * from[2]; if (d < bestDot) { bestDot = d; best = c; } }
    return best;
}
/** The lower plate's centre expressed in the upper plate's frame. */
function lowerCentreIn(upper, lower) {
    const w = lower.toWorld(lower.capCenter[0], lower.capCenter[1], lower.capCenter[2], [0, 0, 0]);
    return upper.toPlateFrame(w[0], w[1], w[2], [0, 0, 0]);
}
