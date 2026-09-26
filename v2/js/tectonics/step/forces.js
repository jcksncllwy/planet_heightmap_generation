// Plate driving forces, gathered from the resolved world view. "Subduction is active; ridges and
// rifts are passive" (WBP): forces come from the STATE of a boundary — the persistent trench flag,
// what crust is on each side, how old it is, how much slab the trench has — never from how fast the
// plates happen to be moving, so a world at rest can start itself.
//
// Per boundary cell of plate A, facing plate B along normal n (pointing at B):
//   slab pull      A's ocean goes down B's trench       +n × slabPull    × age factor × slab maturity  (on A)
//   slab suction   A carries the trench, B goes down    +n × slabSuction × age factor × slab maturity  (on A)
//   ridge push     young ocean of A meets young ocean   −n × ridgePush                                  (on A)
//   rift push      a fresh rift: A's rifted margin (or its young ocean) faces B's across a rift younger than
//                  riftPushMyr                            −n × riftPush × (1 − age/riftPushMyr)             (on A)
//                  — the uplifted shoulders of a new rift drive its sides apart along the whole line. It acts in ONE
//                  direction per plate, straight away from its partner (fixed at the split), not along the local
//                  normal: along a winding rift the local normals point every way and would only spin the halves
// A trench that has only just formed has no slab hanging from it yet, so it pulls weakly and
// strengthens as crust goes down (slabMatureKm). Forces are per 100 km of boundary, measured along the
// cell edges actually shared with the other plate — not per boundary cell — so totals do not depend on
// the mesh resolution or on how jagged an outline is.
//
// Two things here are couplings rather than forces — they depend on velocity, so they are only
// tallied here and enter the balance in torque-balance.js:
//   slab resistance   the mantle resists a slab sinking through it, in proportion to the convergence rate
//   collision lock    where land overlaps land, the two plates are viscously tied together

import { CrustType, CrustFlag } from '../model/crust.js';
import { contactAt } from './contact.js';
import { areYoungRiftPartners } from './collision.js';

/** Force names, in the order of PlateLoad.byKind / forceByKind. Display code keys colours by these names. */
export const FORCE_KINDS = ['slab pull', 'slab suction', 'ridge push', 'rift push'];
const PULL = 0, SUCTION = 1, RIDGE = 2, RIFT = 3;

/**
 * @typedef {Object} PlateLoad
 * @property {number[]} torque            net driving torque (world frame)
 * @property {number[][]} byKind          torque per force kind
 * @property {number[][]} forceByKind     vector sum of the forces per kind (for display arrows)
 * @property {number} torqueMagnitudeSum  Σ |r × F| — compare with |Σ r × F| to see how much cancels
 * @property {number[]} cells             boundary cells contributing, per kind
 * @property {{r:number[], n:number[], other:number, length:number}[]} slabs     where this plate's ocean goes down a trench
 * @property {{r:number[], other:number, weight:number}[]} contacts              land-on-land overlap cells (weight > 1 where a craton is involved)
 */

/** @returns {Map<number, PlateLoad>} loads for every living, non-background plate */
export function gatherLoads(world) {
    const { mesh, owner, ownerCell, plates, landClaims, collider, time, config } = world;
    const { xyz, numCells, edgeKm } = mesh;
    const edgeLength = edgeKm / Math.sqrt(3) / 100;       // one shared cell edge, in units of 100 km (hexagonal cells)
    const loads = new Map();
    for (const p of plates) if (p.alive && !p.isBackground && p.crust.count > 0) loads.set(p.id, newLoad());
    const n = [0, 0, 0, 0];
    const ageFactor = formedAt => Math.sqrt(Math.min(1, Math.max(0, time - formedAt) / config.slabPullAgeRefMyr));
    const maturity = (crust, cell) => Math.min(1, crust.slabKm[cell] / config.slabMatureKm);
    const isYoung = (crust, cell) => crust.formedAt[cell] >= 0 && time - crust.formedAt[cell] < config.ridgeMaxAgeMyr;

    for (let w = 0; w < numCells; w++) {
        const a = owner[w];
        if (a < 0) continue;
        const r = [xyz[3 * w], xyz[3 * w + 1], xyz[3 * w + 2]];
        if (landClaims[w] > 1 && collider[w] >= 0) {        // land on land: tie the two plates together here
            const other = plates[collider[w]], otherCell = other.cellAt(mesh.index, r[0], r[1], r[2]);
            // (not along a fresh rift itself, where the two margins jitter against each other — elsewhere the halves of a rift
            // lock like any colliding plates: a third plate may drive them back together)
            if (areYoungRiftPartners(plates[a], other, time, config) && (plates[a].crust.flags[ownerCell[w]] & CrustFlag.RIFT_MARGIN) && (other.crust.flags[otherCell] & CrustFlag.RIFT_MARGIN)) continue;
            if (plates[a].crust.type[ownerCell[w]] === CrustType.ARC || other.crust.type[otherCell] === CrustType.ARC) continue;   // arc crust is scraped off, it does not lock plates (step/collision.js)
            const craton = plates[a].crust.type[ownerCell[w]] === CrustType.CRATON || other.crust.type[otherCell] === CrustType.CRATON;
            const weight = craton ? config.cratonLockFactor : 1;         // cratons never underthrust: the lock hardens
            loads.get(a)?.contacts.push({ r, other: collider[w], weight });
            loads.get(collider[w])?.contacts.push({ r, other: a, weight });
            continue;
        }
        const load = loads.get(a);
        if (!load) continue;
        const across = contactAt(world, w, n);
        if (across < 0) continue;
        const A = plates[a].crust, cellA = ownerCell[w], B = plates[owner[across]].crust, cellB = ownerCell[across];
        const oceanA = A.type[cellA] === CrustType.OCEAN, oceanB = B.type[cellB] === CrustType.OCEAN;
        const trenchA = (A.flags[cellA] & CrustFlag.TRENCH) !== 0, trenchB = (B.flags[cellB] & CrustFlag.TRENCH) !== 0;
        const length = edgeLength * n[3];

        let kind = -1, size = 0, rAge;
        if (trenchB && oceanA && !trenchA) {
            kind = PULL; size = config.slabPull * ageFactor(A.formedAt[cellA]) * maturity(B, cellB);
            load.slabs.push({ r, n: [n[0], n[1], n[2]], other: owner[across], length });
        } else if (trenchA && oceanB && !trenchB) { kind = SUCTION; size = config.slabSuction * ageFactor(B.formedAt[cellB]) * maturity(A, cellA); }
        else if ((rAge = riftAge(plates[a], A, cellA, plates[owner[across]], B, cellB, time)) < config.riftPushMyr) { kind = RIFT; size = -config.riftPush * (1 - rAge / config.riftPushMyr); }
        else if (oceanA && oceanB && isYoung(A, cellA) && isYoung(B, cellB)) { kind = RIDGE; size = -config.ridgePush; }
        if (kind < 0 || size === 0) continue;

        let dir = n;
        // a rift pushes a plate in ONE direction, straight away from its partner (riftPushDir, fixed at the split) — not along
        // the local normal. `size` is negative for the pushes (away from n); along riftPushDir the push is + that direction.
        if (kind === RIFT && plates[a].riftPushDir) { dir = plates[a].toWorld(plates[a].riftPushDir[0], plates[a].riftPushDir[1], plates[a].riftPushDir[2], [0, 0, 0]); size = Math.abs(size); }
        const f = size * length, fx = dir[0] * f, fy = dir[1] * f, fz = dir[2] * f;
        const tx = r[1] * fz - r[2] * fy, ty = r[2] * fx - r[0] * fz, tz = r[0] * fy - r[1] * fx;      // r × F
        load.torque[0] += tx; load.torque[1] += ty; load.torque[2] += tz;
        const k = load.byKind[kind]; k[0] += tx; k[1] += ty; k[2] += tz;
        const v = load.forceByKind[kind]; v[0] += fx; v[1] += fy; v[2] += fz;
        load.torqueMagnitudeSum += Math.hypot(tx, ty, tz);
        load.cells[kind]++;
    }
    return loads;
}

/**
 * How long ago the rift between these two cells opened, or Infinity if this is not a rift contact: both cells are
 * rifted margins (age = since the younger plate was born), or both are ocean born since the younger plate was.
 */
function riftAge(plateA, A, cellA, plateB, B, cellB, time) {
    const born = Math.max(plateA.born, plateB.born);
    if (plateA.riftPartner !== plateB.id || plateB.riftPartner !== plateA.id) return Infinity;     // real rift partners only
    const marginA = (A.flags[cellA] & CrustFlag.RIFT_MARGIN) !== 0, marginB = (B.flags[cellB] & CrustFlag.RIFT_MARGIN) !== 0;
    const youngA = A.type[cellA] === CrustType.OCEAN && A.formedAt[cellA] >= born, youngB = B.type[cellB] === CrustType.OCEAN && B.formedAt[cellB] >= born;
    return (marginA || youngA) && (marginB || youngB) ? time - born : Infinity;
}

function newLoad() {
    const zero = () => [0, 0, 0];
    return { torque: zero(), byKind: FORCE_KINDS.map(zero), forceByKind: FORCE_KINDS.map(zero), torqueMagnitudeSum: 0, cells: FORCE_KINDS.map(() => 0), slabs: [], contacts: [] };
}
