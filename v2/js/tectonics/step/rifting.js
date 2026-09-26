// When a continent rifts (WBP Part Va). Probabilistic, from the world's seeded rng: a continent
// that is big enough and has been stable for riftTenureMyr rifts with a chance per Myr that grows
// with the TENSION it is under (the share of its trench pull that cancels itself, Phase 4) and with
// its size; a mantle plume head (step/hotspots.js) may force one where it rises. The rift itself —
// where it runs, how it splits the plate — is ops/rift.js.

import { CrustFlag, CrustType } from '../model/crust.js';
import { tangentToward } from '../../core/sphere-geom.js';
import { findRift, splitPlate, chooseJunction } from '../ops/rift.js';
import { EventKind } from '../model/world.js';

const JUNCTION_TRIES = 12;     // junctions tried per rift chance: the best crossing among them is taken (many admit none)

/**
 * @param {number} dt
 * @returns {number} plates split this step
 */
export function riftContinents(world, dt) {
    const { plates, config, time, mesh } = world;
    let splits = 0;
    // plume heads that arrived under a continent this step (step/hotspots.js decided which may split it): the rift
    // starts under the plume — or, if that is a craton, from the ordinary ground nearest it
    for (const pr of world.pendingPlumeRifts) {
        const plate = plates[pr.plate];
        if (!plate?.alive) continue;
        const junctions = pr.cell >= 0 ? [pr.cell] : plumeJunctions(world, plate, pr.xyz);
        if (tryRift(world, plate, junctions, pr.cause, false)) splits++;
    }
    world.pendingPlumeRifts.length = 0;
    // spontaneous rifting under tension
    for (const plate of plates.slice()) {
        if (!plate.alive || plate.isBackground || !plate.dynamics) continue;
        const areaKm2 = plate.stats.continentalCells * mesh.cellAreaKm2;
        if (areaKm2 < config.riftMinContinentKm2 || time - plate.born < config.riftTenureMyr) continue;
        const chance = config.riftRatePerMyr * dt * plate.dynamics.tension * Math.min(config.riftSizeCap, areaKm2 / config.riftMinContinentKm2 - 1);   // a supercontinent rifts readily, a continent barely big enough hardly ever
        if (world.rng() >= chance) continue;
        const junctions = Array.from({ length: JUNCTION_TRIES }, () => chooseJunction(world, plate, world.rng));
        if (tryRift(world, plate, junctions, { text: `tension ${plate.dynamics.tension.toFixed(2)}`, kind: 'tension', hotspot: -1 })) splits++;
    }
    return splits;
}

/**
 * The rift through the best of the given junctions (a rift's shape is set by where it starts more than by where
 * its arms end, so the compact-piece preference is settled here, between junctions), then the split.
 * @param {{text: string, kind: 'plume' | 'tension', hotspot: number}} cause   what started it (for the event)
 */
export function tryRift(world, plate, junctions, cause, needCratonsBothSides = true) {
    const { mesh } = world, pull = pullAxisOf(plate, mesh);
    let rift = null;
    for (const junction of junctions) {
        if (junction < 0) continue;
        const found = findRift(world, plate, junction, pull, needCratonsBothSides);
        if (found && (!rift || found.value < rift.value)) rift = found;
    }
    if (!rift) return false;
    const before = plate.name, fresh = splitPlate(world, plate, rift.path, rift.failedArm, (a, b) => namesAfterSplit(world, a, b, before), rift.across);
    const km = rift.path.length * mesh.edgeKm;
    world.log(EventKind.RIFT, `${before} rifts (${cause.text}): ${plate.name} and ${fresh.name} part along ${km.toFixed(0)} km of rift${rift.failedArm.length ? `, a failed arm of ${(rift.failedArm.length * mesh.edgeKm).toFixed(0)} km left behind` : ''}`,
        { plate: plate.id, fresh: fresh.id, cause: cause.kind, hotspot: cause.hotspot, lengthKm: km, failedArmKm: rift.failedArm.length * mesh.edgeKm });
    return true;
}

/** Raster cells of `plate` a plume at world position xyz could start a rift from: land, not craton, within plumeJunctionKm — the nearest first. */
const PLUME_TRY_KM = 220;     // the rift of a plume head starts within this of the plume (about 12 cells at 40K)

function plumeJunctions(world, plate, xyz) {
    const { mesh, config } = world, { adjOffset, adjList, index } = mesh, crust = plate.crust;
    const c0 = plate.cellAt(index, xyz[0], xyz[1], xyz[2]), maxHops = Math.max(1, Math.round(config.plumeJunctionKm / mesh.edgeKm));
    const ok = c => crust.mask[c] && crust.type[c] !== CrustType.OCEAN && crust.type[c] !== CrustType.CRATON;
    // every candidate within PLUME_TRY_KM of the plume (or out to plumeJunctionKm while none is found), nearest first;
    // then JUNCTION_TRIES of them spread from the nearest to the farthest — so on any mesh the tries cover the same
    // disc under the plume head, not just the few cells next to it
    const all = ok(c0) ? [c0] : [], seen = new Set([c0]), tryHops = Math.max(1, Math.round(PLUME_TRY_KM / mesh.edgeKm));
    let ring = [c0];
    for (let hop = 0; hop < maxHops && ring.length && (hop < tryHops || all.length === 0); hop++) {
        const next = [];
        for (const c of ring) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!seen.has(nb) && crust.mask[nb]) { seen.add(nb); next.push(nb); if (ok(nb)) all.push(nb); } }
        ring = next;
    }
    if (all.length <= JUNCTION_TRIES) return all;
    return Array.from({ length: JUNCTION_TRIES }, (_, i) => all[Math.round(i * (all.length - 1) / (JUNCTION_TRIES - 1))]);
}

/**
 * The plate-frame axis along which this plate is being pulled apart: the principal axis of where its
 * trench cells lie around its centre (a ringed plate's NET pull is ~0, so the sum of forces would say
 * nothing; the tug of war shows in the trenches sitting on opposite sides).
 */
export function pullAxisOf(plate, mesh) {
    const { xyz } = mesh, { mask, flags } = plate.crust, c = plate.capCenter, M = new Float64Array(9);
    let n = 0;
    for (let i = 0; i < mask.length; i++) {
        if (!mask[i] || !(flags[i] & CrustFlag.TRENCH)) continue;
        const u = tangentToward(c, c, [xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]]);
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[3 * a + b] += u[a] * u[b];
        n++;
    }
    if (n * mesh.edgeKm < 485) return null;                   // (less than ~500 km of trench pulls no way in particular)
    let v = [c[1], -c[0], 0];                             // power iteration for the principal axis
    for (let it = 0; it < 30; it++) {
        const w = [0, 1, 2].map(a => M[3 * a] * v[0] + M[3 * a + 1] * v[1] + M[3 * a + 2] * v[2]), l = Math.hypot(...w);
        if (l < 1e-12) return null;
        v = w.map(x => x / l);
    }
    return v;
}

/** Names for the two halves: by the craton letters each side holds when the world knows them, else "X·1 / X·2" (numbers not in use). */
function namesAfterSplit(world, a, b, before) {
    const na = world.nameByCratons(a, null), nb = world.nameByCratons(b, null);
    if (na && nb && na !== nb) return [na, nb];
    const base = before.replace(/(·\d+)+$/, ''), taken = new Set(world.plates.filter(p => p.alive).map(p => p.name)), names = [];
    for (let n = 1; names.length < 2; n++) if (!taken.has(`${base}·${n}`)) names.push(`${base}·${n}`);
    return names;
}
