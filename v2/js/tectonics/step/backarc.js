// Slab rollback and back-arc basins (Phase 7b). An OLD slab is cold and dense: it sinks steeply and its
// hinge falls back, away from the overriding plate. If that plate is not pushing forward to keep up, it
// is stretched behind its trench until it tears along a line parallel to it: the strip on the trench
// side — the arc and its fore-arc, or on a continental margin a strip of the coast — rifts away after the
// retreating trench, and a spreading ridge opens a sea behind it. An arc peeled off an ocean plate: the
// Mariana Trough. A strip peeled off a continent: the Sea of Japan, the Tyrrhenian (developer: both).
//
// Where: a long run of one overriding plate's trench where the slab going down is older than
// rollbackMinAgeMyr, and the trench retreats faster than the overriding plate follows it: the retreat
// grows with the slab's age (up to rollbackMaxCmYr at rollbackFullAgeMyr), while the plate's own advance
// on the trench is its motion in the mantle frame.
// When: by chance (world.rngBackArc), per Myr, more readily on a long trench; a continental margin more
// rarely than an arc at sea. The strip is everything of the plate within backArcWidthKm of that trench,
// so its inner edge — the new rift — runs parallel to the trench (no ragged tails); where that edge runs through a
// craton it opens cratonStrength times less readily along that share of it; a continental strip must hold backArcMinLandKm2 of land in one piece — a coherent
// arc of islands, not a sliver (developer).
//
// The split itself is the 6a one in spirit: two plates, rifted margins between them, a push that drives
// the strip toward its trench and the rest away (step/forces.js), and the Phase 2 rules open the sea.

import { CrustType, CrustFlag } from '../model/crust.js';
import { BoundaryKind, EventKind } from '../model/world.js';
import { CM_PER_YR_TO_RAD_PER_MYR } from '../config.js';
import { PLANET_RADIUS_KM } from '../../core/sim-mesh.js';
import { contactAt } from './contact.js';
import { transferCells, bridgePieces } from '../ops/tidy-plates.js';
import { largestPieceOf } from '../../core/mesh-bfs.js';

/** @returns {number} back-arc basins opened or closed this step (either changes the world view) */
export function openBackArcs(world, dt) {
    const { mesh, plates, owner, ownerCell, boundaryKind, config, time } = world;
    const rejoined = rejoinFinishedStrips(world);
    if (config.backArcRatePerMyr <= 0) { world.rollbackBirths = null; return rejoined; }
    const { numCells, xyz, edgeKm } = mesh;

    // 1. trench cells where the slab rolls back, grouped by overriding and subducting plate
    const byPair = new Map(), normal = [0, 0, 0, 0];
    for (let w = 0; w < numCells; w++) {
        if (boundaryKind[w] !== BoundaryKind.OVERRIDING) continue;
        const A = plates[owner[w]];
        if (!A?.alive || A.isBackground || A.reshaped) continue;                   // (a plate already reshaped this step waits: its world view is stale)
        const otherW = contactAt(world, w, normal);
        if (otherW < 0) continue;
        const B = plates[owner[otherW]], cellB = ownerCell[otherW];
        if (!B?.alive || B.reshaped || B.isBackground || B.crust.type[cellB] !== CrustType.OCEAN) continue;   // (the passive ocean is no slab: it never rolls back)
        const slabAge = time - B.crust.formedAt[cellB];
        if (slabAge < config.rollbackMinAgeMyr) continue;                            // a young slab does not roll back
        const x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2], om = A.omega;
        const advance = ((om[1] * z - om[2] * y) * normal[0] + (om[2] * x - om[0] * z) * normal[1] + (om[0] * y - om[1] * x) * normal[2]) / CM_PER_YR_TO_RAD_PER_MYR;
        if (advance >= rollbackCmYr(slabAge, config)) continue;                     // the plate keeps up with its trench
        const key = `${A.id}:${B.id}`;
        const e = byPair.get(key) ?? byPair.set(key, { A, B, cells: [], dir: [0, 0, 0], ages: 0 }).get(key);
        e.cells.push(w);
        e.ages += time - B.crust.formedAt[cellB];
        e.dir[0] += normal[0]; e.dir[1] += normal[1]; e.dir[2] += normal[2];
    }

    let opened = pullArcsAfterTrenches(world);
    for (const { A, cells, dir, ages } of byPair.values()) {
        if (!A.alive || A.reshaped || time - A.lastBackArcAt < config.backArcTenureMyr) continue;   // (a plate that just took part in one waits)
        const segment = largestPieceOf(mesh, cells), lengthKm = segment.length * edgeKm;
        if (lengthKm < config.backArcMinLengthKm) continue;
        if (world.rngBackArc() >= config.backArcRatePerMyr * dt * lengthKm / config.backArcMinLengthKm) continue;
        const strip = stripBehind(world, A, segment);
        if (!strip) continue;
        if (strip.continental && world.rngBackArc() >= config.backArcContinentalShare) continue;
        // (a break line through a craton is cratonStrength times as hard to open, along that share of it)
        if (strip.cratonShare > 0 && world.rngBackArc() >= 1 / (1 + (config.cratonStrength - 1) * strip.cratonShare)) continue;
        const fresh = splitStrip(world, A, strip, dir, rollbackCmYr(ages / cells.length, config));
        opened++;
        const splitCratons = cratonsSplitBy(A, fresh, numCells);
        world.log(EventKind.BACKARC_OPEN, `${A.name}’s trench rolls back from under it (a cold slab, ${(ages / cells.length).toFixed(0)} Myr old): ${strip.continental ? 'a strip of its coast' : 'its island arc'} — ${(lengthKm).toFixed(0)} km of it — rifts away after the trench as ${fresh.name}, and a back-arc sea opens behind`,
            { parent: A.id, strip: fresh.id, continental: strip.continental, slabAgeMyr: ages / cells.length, lengthKm, splitCratons });
    }
    return opened + rejoined;
}

/**
 * A plate backing away from its own trench (2026-10-28, branch arcs). Where the overriding plate moves off its trench
 * faster than the slab can roll back, it is not the trench that comes away from the plate — the slab, hanging deep in
 * the mantle, holds the trench — but the plate that is stretched behind it, and it breaks where it is weakest: along
 * the arc, its lithosphere thinned and heated by the magma (Karig 1971; Taylor & Karner 1983; Hyndman et al. 2005). The
 * arc's trench-side half and its fore-arc go with the trench, the sea opens behind them, and the far half is left
 * standing as a remnant arc (the Mariana Trough and the West Mariana Ridge; the Lau Basin and the Lau Ridge). The history
 * used to grow new sea floor at the trench itself (resolve.js), leaving the whole arc behind on the plate and building a
 * new one in front of it; resolve.js now reports those births (world.rollbackBirths), and here every trench run of them
 * backArcMinLengthKm long splits off its strip, as a slab's rollback does (stripBehind, splitStrip) — no chance about
 * it: the plate is already pulling away. The strip follows its trench at the faster of the slab's rollback and the
 * plate's retreat from it, so its trench keeps its slab. Where a strip cannot split (a plate that split lately, a strip
 * the guards refuse) the growth at the trench stands, as before. @returns {number} strips split off
 */
function pullArcsAfterTrenches(world) {
    const births = world.rollbackBirths;
    world.rollbackBirths = null;
    if (!births?.length) return 0;
    const { mesh, plates, owner, ownerCell, config, time } = world, { xyz, edgeKm } = mesh, normal = [0, 0, 0, 0];
    const byPair = new Map(), seen = new Set();
    for (let i = 0; i < births.length; i += 2) {
        const A = plates[births[i]], w = births[i + 1];
        if (seen.has(w) || owner[w] !== A.id || !A.alive || A.isBackground || A.reshaped || !(A.crust.flags[ownerCell[w]] & CrustFlag.TRENCH)) continue;
        seen.add(w);
        const otherW = contactAt(world, w, normal);
        if (otherW < 0) continue;
        const B = plates[owner[otherW]], cellB = ownerCell[otherW];
        if (!B?.alive || B.reshaped || B.isBackground || B.crust.type[cellB] !== CrustType.OCEAN) continue;     // (the passive ocean is no slab)
        const x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2], ox = A.omega[0] - B.omega[0], oy = A.omega[1] - B.omega[1], oz = A.omega[2] - B.omega[2];
        const opening = -((oy * z - oz * y) * normal[0] + (oz * x - ox * z) * normal[1] + (ox * y - oy * x) * normal[2]) / CM_PER_YR_TO_RAD_PER_MYR;
        if (!(opening > 0)) continue;
        const key = `${A.id}:${B.id}`;
        const e = byPair.get(key) ?? byPair.set(key, { A, cells: [], dir: [0, 0, 0], ages: 0, opening: 0 }).get(key);
        e.cells.push(w); e.ages += time - B.crust.formedAt[cellB]; e.opening += opening;
        e.dir[0] += normal[0]; e.dir[1] += normal[1]; e.dir[2] += normal[2];
    }
    let opened = 0;
    for (const { A, cells, dir, ages, opening } of byPair.values()) {
        if (!A.alive || A.reshaped || time - A.lastBackArcAt < config.backArcTenureMyr) continue;
        // (the run of trench pulled at this step, with the overriding trench beside it: the whole stretch the slab holds)
        const run = trenchRunOf(world, A, cells), segment = largestPieceOf(mesh, run), lengthKm = segment.length * edgeKm;
        if (lengthKm < config.backArcMinLengthKm) continue;
        const strip = stripBehind(world, A, segment);
        if (!strip) continue;
        if (strip.cratonShare > 0 && world.rngBackArc() >= 1 / (1 + (config.cratonStrength - 1) * strip.cratonShare)) continue;
        const slabAge = ages / cells.length, rate = Math.max(rollbackCmYr(slabAge, config), opening / cells.length);
        const fresh = splitStrip(world, A, strip, dir, rate);
        opened++;
        world.log(EventKind.BACKARC_OPEN, `${A.name} pulls away from its own trench (${(opening / cells.length).toFixed(1)} cm/yr; the slab, ${slabAge.toFixed(0)} Myr old, holds it): ${strip.continental ? 'a strip of its coast' : 'its island arc'} — ${lengthKm.toFixed(0)} km of it — stays with the trench as ${fresh.name}, and a back-arc sea opens behind`,
            { parent: A.id, strip: fresh.id, continental: strip.continental, slabAgeMyr: slabAge, lengthKm, pulled: true, rateCmYr: rate, splitCratons: cratonsSplitBy(A, fresh, mesh.numCells) });
    }
    return opened;
}

/** The cratons a strip's rift went through: on both plates now, as a rift's are, and booked in the event's log (rifting.js). */
function cratonsSplitBy(A, strip, numCells) {
    const cratonsOf = P => { const ids = new Set(); for (let c = 0; c < numCells; c++) if (P.crust.mask[c] && P.crust.type[c] === CrustType.CRATON) ids.add(P.crust.terrane[c]); return ids; };
    const onStrip = cratonsOf(strip);
    return onStrip.size ? [...cratonsOf(A)].filter(id => onStrip.has(id)) : [];
}

/** The world cells of A's live trench joined to `cells`: those cells, and A's trench-flagged edge cells overriding beside them. */
function trenchRunOf(world, A, cells) {
    const { mesh, owner, ownerCell, boundaryKind } = world, { adjOffset, adjList } = mesh, inRun = new Set(cells), queue = [...cells];
    for (let i = 0; i < queue.length; i++) for (let k = adjOffset[queue[i]]; k < adjOffset[queue[i] + 1]; k++) {
        const nb = adjList[k];
        if (inRun.has(nb) || owner[nb] !== A.id || boundaryKind[nb] !== BoundaryKind.OVERRIDING || !(A.crust.flags[ownerCell[nb]] & CrustFlag.TRENCH)) continue;
        inRun.add(nb); queue.push(nb);
    }
    return queue;
}

/**
 * When a back-arc basin stops spreading (backArcActiveMyr after it opened), the arc and the sea behind it move with the
 * overriding plate again — the Sea of Japan and Japan travel with Eurasia today — so the strip rejoins its parent, the
 * young basin and all. Plates stay few, and no small light plate is left to be flung about by the force balance.
 */
function rejoinFinishedStrips(world) {
    const { plates, config, time, mesh } = world;
    let n = 0;
    for (const strip of plates) {
        if (!strip.alive || strip.backArcOf < 0 || time - strip.born < config.backArcActiveMyr) continue;
        const parent = plates[strip.backArcOf];
        strip.backArcOf = -1;
        if (!parent?.alive) {                                                        // its parent is gone: it stays a plate of its own
            world.log(EventKind.BACKARC_CLOSE, `the back-arc sea behind ${strip.name} stops spreading; the plate it left is gone, so it carries on as a plate of its own`, { strip: strip.id, parent: -1, rejoined: false });
            continue;
        }
        const cells = [];
        for (let c = 0; c < mesh.numCells; c++) if (strip.crust.mask[c]) cells.push(c);
        const name = strip.name;
        transferCells(world, strip, parent, cells, 4);
        // the two rasters met along the back-arc ridge, but resampled onto the parent's lattice they can leave a seam of
        // empty cells between them: close it, or the parent is in two pieces and the strip is taken for a fragment
        bridgePieces(parent, mesh, config.backArcSeamKm);
        strip.alive = false; strip.omega = [0, 0, 0]; strip.dynamics = null;
        if (parent.riftPartner === strip.id) parent.riftPartner = -1;
        world.log(EventKind.BACKARC_CLOSE, `the back-arc sea behind ${name} stops spreading: the arc and the young sea behind it move with ${parent.name} again`, { strip: strip.id, parent: parent.id, rejoined: true });
        n++;
    }
    return n;
}

/**
 * While a back-arc basin is opening (backArcActiveMyr), the strip that rifted off does not move by the force balance —
 * small and light, it would be flung about — but with the retreating hinge of the slab: its parent's motion plus the
 * slab's rollback, straight toward its trench. So a back-arc sea opens at the rollback rate, a few cm/yr (the Mariana
 * Trough ~4, the Sea of Japan ~5). Called after every drive, whatever drives the other plates. Afterwards the strip is
 * an ordinary plate.
 */
export function steerBackArcStrips(world) {
    const { plates, config, time } = world;
    for (const strip of plates) {
        if (!strip.alive || strip.backArcOf < 0 || !strip.backArcPushDir || time - strip.born >= config.backArcActiveMyr) continue;
        const parent = plates[strip.backArcOf];
        if (!parent?.alive) continue;
        const c = strip.toWorld(strip.capCenter[0], strip.capCenter[1], strip.capCenter[2], [0, 0, 0]);
        const d = strip.toWorld(strip.backArcPushDir[0], strip.backArcPushDir[1], strip.backArcPushDir[2], [0, 0, 0]);
        // the pole that carries the strip's centre toward its trench: c × d (d made tangent at c first)
        const k = d[0] * c[0] + d[1] * c[1] + d[2] * c[2], t = [d[0] - k * c[0], d[1] - k * c[1], d[2] - k * c[2]];
        const pole = [c[1] * t[2] - c[2] * t[1], c[2] * t[0] - c[0] * t[2], c[0] * t[1] - c[1] * t[0]], l = Math.hypot(...pole) || 1;
        const rate = strip.rollbackCmYr * CM_PER_YR_TO_RAD_PER_MYR / l;
        strip.omega = [parent.omega[0] + pole[0] * rate, parent.omega[1] + pole[1] * rate, parent.omega[2] + pole[2] * rate];
    }
}

/** How fast a slab of this age rolls back — its trench retreating from the overriding plate — in cm/yr. */
export function rollbackCmYr(slabAgeMyr, config) {
    const t = (slabAgeMyr - config.rollbackMinAgeMyr) / (config.rollbackFullAgeMyr - config.rollbackMinAgeMyr);
    return t <= 0 ? 0 : config.rollbackMaxCmYr * Math.min(1, t);
}

/**
 * Everything of plate A within backArcWidthKm of the trench segment (world cells), on A's own lattice — or null if
 * the guards refuse it: a continental strip too small or in pieces, a strip that is most of the
 * plate, or a remainder that would fall apart. @returns {{cells: number[], continental: boolean}|null}
 */
function stripBehind(world, A, segment) {
    const { mesh, config } = world, { numCells, cellAreaKm2 } = mesh, crust = A.crust;
    // a trench fronting a continent takes a wider strip — enough to carry some of the coast; an arc at sea a narrower one
    let inStrip = bandBehind(world, A, segment, config.backArcContinentalWidthKm);
    let hasLand = false;
    for (let c = 0; c < numCells && !hasLand; c++) if (inStrip[c] && crust.type[c] === CrustType.CONTINENT) hasLand = true;
    if (!hasLand) inStrip = bandBehind(world, A, segment, config.backArcWidthKm);
    return judgeStrip(world, A, inStrip);
}

/** Cells of A within widthKm of the trench segment: each takes the nearest trench cell it can be reached from. */
function bandBehind(world, A, segment, widthKm) {
    const { mesh, ownerCell } = world, { numCells, xyz, adjOffset, adjList } = mesh, crust = A.crust;
    const near = Math.cos(widthKm / PLANET_RADIUS_KM);
    const source = new Int32Array(numCells).fill(-1), best = new Float64Array(numCells).fill(-2), inStrip = new Uint8Array(numCells);
    let ring = [];
    for (const w of segment) { const c = ownerCell[w]; if (crust.mask[c] && source[c] < 0) { source[c] = c; best[c] = 1; inStrip[c] = 1; ring.push(c); } }
    while (ring.length) {
        const next = [];
        for (const c of ring) {
            const s = source[c], sx = xyz[3 * s], sy = xyz[3 * s + 1], sz = xyz[3 * s + 2];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (!crust.mask[nb]) continue;
                const d = xyz[3 * nb] * sx + xyz[3 * nb + 1] * sy + xyz[3 * nb + 2] * sz;
                if (d < near || d <= best[nb]) continue;
                best[nb] = d; source[nb] = s; inStrip[nb] = 1; next.push(nb);
            }
        }
        ring = next;
    }
    return inStrip;
}

/** The strip as a list, if the guards allow it (see stripBehind). */
function judgeStrip(world, A, inStrip) {
    const { mesh, config } = world, { numCells, cellAreaKm2 } = mesh, crust = A.crust;
    const cells = [];
    let land = 0, arc = 0;
    for (let c = 0; c < numCells; c++) {
        if (!inStrip[c]) continue;
        cells.push(c);
        if (crust.type[c] === CrustType.CONTINENT) land++;
        else if (crust.type[c] === CrustType.ARC) arc++;
    }
    if (cells.length * 2 > crust.count) return null;                                // not a strip: most of the plate
    const continental = land > arc;
    if (continental) {
        if (land * cellAreaKm2 < config.backArcMinLandKm2) return null;            // too little to be more than a sliver
        const landCells = cells.filter(c => crust.type[c] === CrustType.CONTINENT || crust.type[c] === CrustType.ARC);
        if (!landCells.length || largestPieceOf(mesh, landCells).length < landCells.length) return null;                       // one coherent strip of land, not scraps
    }
    // what is left of the plate must hold together
    const rest = [];
    for (let c = 0; c < numCells; c++) if (crust.mask[c] && !inStrip[c]) rest.push(c);
    if (largestPieceOf(mesh, rest).length < 0.9 * rest.length) return null;
    // the line it breaks along: its cells against the rest of the plate — the share of it through a craton
    let line = 0, through = 0;
    for (const c of cells) for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) {
        const nb = mesh.adjList[k];
        if (!crust.mask[nb] || inStrip[nb]) continue;
        line++; if (crust.type[c] === CrustType.CRATON || crust.type[nb] === CrustType.CRATON) through++;
        break;
    }
    return { cells, continental, cratonShare: line ? through / line : 0 };
}

/** Move the strip to a new plate; rifted margins between the two; the strip pushed toward its trench, the rest away. */
function splitStrip(world, A, strip, dirWorld, rollbackRateCmYr) {
    const { mesh, time } = world, { adjOffset, adjList, xyz } = mesh, crust = A.crust;
    const fresh = world.addPlate(stripName(world, A, strip.continental));
    fresh.setQuat(A.quat.slice());
    fresh.omega = A.omega.slice();
    for (const c of strip.cells) { fresh.crust.copyFrom(c, crust, c); crust.remove(c); }
    for (const c of strip.cells) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
        const nb = adjList[k];
        if (!crust.mask[nb]) continue;
        fresh.crust.flags[c] |= CrustFlag.RIFT_MARGIN;
        crust.flags[nb] |= CrustFlag.RIFT_MARGIN;
    }
    // the strip follows its trench along this direction while the sea opens (steerBackArcStrips)
    const l = Math.hypot(dirWorld[0], dirWorld[1], dirWorld[2]) || 1, d = A.toPlateFrame(dirWorld[0] / l, dirWorld[1] / l, dirWorld[2] / l, [0, 0, 0]);
    fresh.backArcPushDir = d;
    // …and the two are rift partners — exempt from colliding while young, pushed apart (step/forces.js) — unless the parent
    // is still being pushed away from a partner of its own from a recent rift: that partnership is not overwritten
    const partner = world.plates[A.riftPartner];
    const stillRifting = partner?.alive && partner.riftPartner === A.id && time - Math.max(A.born, partner.born) < world.config.riftPushMyr;
    if (!stillRifting) {
        fresh.riftPushDir = d; A.riftPushDir = d.map(v => -v);
        fresh.riftPartner = A.id; A.riftPartner = fresh.id;
    }
    fresh.backArcOf = A.id;                                                          // it rolls back after its trench (steerBackArcStrips)
    fresh.rollbackCmYr = rollbackRateCmYr;
    fresh.born = time;                   // (the push’s age runs from the younger of the two, so the parent keeps its own birth
                                         // date — a continent that sheds an arc is not thereby barred from rifting)
    fresh.lastBackArcAt = time; A.lastBackArcAt = time;
    fresh.markReshaped(); A.markReshaped();
    fresh.refreshExtent(xyz); A.refreshExtent(xyz);
    return fresh;
}

function stripName(world, A, continental) {
    const base = `${A.name.replace(/ (Arc|Isles)( \d+)?$/, '')} ${continental ? 'Isles' : 'Arc'}`, taken = new Set(world.plates.filter(p => p.alive).map(p => p.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** The longest run of the given world cells joined to one another. */


