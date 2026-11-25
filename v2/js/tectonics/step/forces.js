// Plate driving forces, gathered from the resolved world view. "Subduction is active; ridges and
// rifts are passive" (WBP): forces come from the STATE of a boundary — the persistent trench flag,
// what crust is on each side, how old it is, how much slab the trench has — never from how fast the
// plates happen to be moving, so a world at rest can start itself.
//
// Per boundary cell of plate A, facing plate B along normal n (pointing at B):
//   slab pull      A's ocean goes down B's trench       +n × slabPull    × age factor × slab maturity  (on A)
//   slab suction   A carries the trench, B goes down    +n × slabSuction × age factor × slab maturity  (on A)
//   rift push      a fresh rift: A's rifted margin (or its young ocean) faces B's across a rift younger than
//                  riftPushMyr                            −n × riftPush × (1 − age/riftPushMyr)             (on A)
//                  — the uplifted shoulders of a new rift drive its sides apart along the whole line. It acts in ONE
//                  direction per plate, straight away from its partner (fixed at the split), not along the local
//                  normal: along a winding rift the local normals point every way and would only spin the halves
// And one force that is not at a boundary:
//   mantle flow    per 10⁴ km² of continental crust: the mantle's flow drags on continents' deep roots — out from the
//                  upwelling under the last supercontinent, toward the downwelling where the next will gather
//                  (Phase 13, step/supercontinent.js) — and, while the pieces of a supercontinent disperse, away from
//                  the other continents near it (steered: they keep apart until it is time to gather). A bias, not a
//                  driver; it is left out of a plate's tension (the tug of war between its boundaries, which decides
//                  whether it rifts).
//   ridge push     on every ocean cell: the cooling lithosphere's gravitational potential energy falls as it ages away from
//                  its ridge, a body force down the slope toward older floor (ridgePushGpe below) — the ridge's push is the
//                  ocean's own, not a force at the ridge
//   swell push     on continental cells (config.swellPush): the lithosphere over the mantle's swell pushes away from its high
//                  centre — the swell's gravitational potential energy (swellPush below). Left out of a plate's tension too.
// A trench that has only just formed has no slab hanging from it yet, so it pulls weakly and
// strengthens as crust goes down (slabMatureKm). Forces are per 100 km of boundary, measured along the
// cell edges actually shared with the other plate — not per boundary cell — so totals do not depend on
// the mesh resolution or on how jagged an outline is.
//
// Two things here are couplings rather than forces — they depend on velocity, so they are only
// tallied here and enter the balance in torque-balance.js:
//   slab resistance   the mantle resists a slab sinking through it, in proportion to the convergence rate
//   collision lock    where land overlaps land, a friction bounded by the buoyancy of the belt the collision has built

import { CrustType, CrustFlag } from '../model/crust.js';
import { BoundaryKind } from '../model/world.js';
import { contactAt } from './contact.js';
import { areYoungRiftPartners } from './collision.js';
import { ringsOf } from '../../core/mesh-rings.js';
import { tangentToward } from '../../core/sphere-geom.js';
import { mantleFlowAt, dispersalField, repelAt } from './supercontinent.js';
import { heightsOf } from './heights.js';
import { smoothHeat } from '../../terrain/sea-level.js';
import { isContinental } from './hotspots.js';
import { gdh1BasementKm } from '../measure.js';

/** Force names, in the order of PlateLoad.byKind / forceByKind. Display code keys colours by these names. */
export const FORCE_KINDS = ['slab pull', 'slab suction', 'ridge push', 'rift push', 'mantle flow', 'swell push'];
const PULL = 0, SUCTION = 1, RIDGE = 2, RIFT = 3, FLOW = 4, SWELL = 5;

/**
 * @typedef {Object} PlateLoad
 * @property {number[]} torque            net driving torque (world frame)
 * @property {number[][]} byKind          torque per force kind
 * @property {number[][]} forceByKind     vector sum of the forces per kind (for display arrows)
 * @property {number} torqueMagnitudeSum  Σ |r × F| over the boundary forces — compare with |Σ r × F| to see how much cancels
 * @property {number[]} flowTorque        the mantle flow's share of `torque` (not a boundary force: left out of the tension)
 * @property {number[]} ridgeTorque       ridge push's share of `torque` (a body force on the ocean, which presses a plate and does not
 *                                         pull it: left out of the tension and of torqueMagnitudeSum, as the swell's push is)
 * @property {number[]} cells             boundary cells contributing, per kind
 * @property {{w:number, r:number[], n:number[], other:number, length:number}[]} slabs     where this plate's ocean goes down a trench
 * @property {{w:number, c:number, r:number[], n:number[], other:number, dh:number}[]} contacts  land-on-land overlap cells (n: the front's
 *                                                                             normal there, toward the other plate; dh: the belt's thickening, km)
 * @property {{r:number[], other:number, c:number}[]} hinges   where a young rift's halves are still pinned together (stiffness c)
 */

/** @returns {Map<number, PlateLoad>} loads for every living, non-background plate */
export function gatherLoads(world) {
    const { mesh, owner, ownerCell, plates, landClaims, collider, boundaryKind, time, config } = world;
    const { xyz, numCells, edgeKm } = mesh;
    const edgeLength = edgeKm / Math.sqrt(3) / 100;       // one shared cell edge, in units of 100 km (hexagonal cells)
    const loads = new Map(), loadOf = [];
    for (const p of plates) if (p.alive && !p.isBackground && p.crust.count > 0) { const l = newLoad(); loads.set(p.id, l); loadOf[p.id] = l; }
    const n = [0, 0, 0, 0];
    const ageFactor = formedAt => Math.sqrt(Math.min(1, Math.max(0, time - formedAt) / config.slabPullAgeRefMyr));
    const maturity = (crust, cell) => Math.min(1, crust.slabKm[cell] / config.slabMatureKm);
    const flowing = world.cycle?.up && (config.mantleOutflow > 0 || config.mantleInflow > 0 || config.dispersalRepulsion > 0), flow = [0, 0, 0];
    const apart = flowing ? dispersalField(world) : null;
    const flowArea = mesh.cellAreaKm2 / 1e4;
    // (each world cell's share of the driving torque, and whose cell it was: step/plate-stress.js reads the stress a plate
    // carries inside it from these)
    if (world.cellTorque?.length !== 3 * numCells) { world.cellTorque = new Float64Array(3 * numCells); world.loadOwner = new Int32Array(numCells); world.loadCell = new Int32Array(numCells); }
    const cellTorque = world.cellTorque.fill(0);
    world.loadOwner.set(owner); world.loadCell.set(ownerCell);

    for (let w = 0; w < numCells; w++) {
        const a = owner[w];
        if (a < 0) continue;
        const r0 = xyz[3 * w], r1 = xyz[3 * w + 1], r2 = xyz[3 * w + 2];
        if (flowing) {                                      // the mantle's flow drags on a continent's root
            const load = loadOf[a], t = plates[a].crust.type[ownerCell[w]];
            if (load && (t === CrustType.CONTINENT || t === CrustType.CRATON)) {
                mantleFlowAt(world, r0, r1, r2, flow);
                if (apart) repelAt(apart, a, r0, r1, r2, flow);
                const fx = flow[0] * flowArea, fy = flow[1] * flowArea, fz = flow[2] * flowArea;
                const tx = r1 * fz - r2 * fy, ty = r2 * fx - r0 * fz, tz = r0 * fy - r1 * fx;
                load.torque[0] += tx; load.torque[1] += ty; load.torque[2] += tz;
                load.flowTorque[0] += tx; load.flowTorque[1] += ty; load.flowTorque[2] += tz;
                cellTorque[3 * w] += tx; cellTorque[3 * w + 1] += ty; cellTorque[3 * w + 2] += tz;
                const k = load.byKind[FLOW]; k[0] += tx; k[1] += ty; k[2] += tz;
                const v = load.forceByKind[FLOW]; v[0] += fx; v[1] += fy; v[2] += fz;
                load.cells[FLOW]++;
            }
        }
        if (landClaims[w] > 1 && collider[w] >= 0) {        // land on land: tie the two plates together here
            const r = [r0, r1, r2], other = plates[collider[w]], otherCell = other.cellAt(mesh.index, r0, r1, r2);
            // (not along a fresh rift itself, where the two margins jitter against each other — elsewhere the halves of a rift
            // lock like any colliding plates: a third plate may drive them back together)
            if (areYoungRiftPartners(plates[a], other, time, config) && (plates[a].crust.flags[ownerCell[w]] & CrustFlag.RIFT_MARGIN) && (other.crust.flags[otherCell] & CrustFlag.RIFT_MARGIN)) continue;
            if (plates[a].crust.type[ownerCell[w]] === CrustType.ARC || other.crust.type[otherCell] === CrustType.ARC) continue;   // arc crust is scraped off, it does not lock plates (step/collision.js)
            const nAB = frontNormal(world, w, a, collider[w], r);
            // (c: each side's own raster cell here, so plate-stress.js puts each half of the lock on the plate it acts on)
            // (dh: the thickening the front pushes against, which caps the lock — torque-balance.js lockContacts — the same on
            // both sides: frontThickening)
            const dh = frontThickening(world, w, a, collider[w], plates[a].crust, ownerCell[w], other.crust, otherCell);
            loadOf[a]?.contacts.push({ w, c: ownerCell[w], r, n: nAB, other: collider[w], dh });
            loadOf[collider[w]]?.contacts.push({ w, c: otherCell, r, n: [-nAB[0], -nAB[1], -nAB[2]], other: a, dh });
            continue;
        }
        const load = loadOf[a];
        if (!load) continue;
        const across = contactAt(world, w, n);
        if (across < 0) continue;
        const A = plates[a].crust, cellA = ownerCell[w], B = plates[owner[across]].crust, cellB = ownerCell[across];
        const oceanA = A.type[cellA] === CrustType.OCEAN, oceanB = B.type[cellB] === CrustType.OCEAN;
        const trenchA = (A.flags[cellA] & CrustFlag.TRENCH) !== 0, trenchB = (B.flags[cellB] & CrustFlag.TRENCH) !== 0;
        const length = edgeLength * n[3];

        // A contact pressed together with no slab yet (BoundaryKind.CONVERGING, step/boundaries.js) resists its closing as a
        // slab sinking does; the two plates share it (half each), since neither has yet gone down
        if (boundaryKind[w] === BoundaryKind.CONVERGING) load.slabs.push({ w, c: ownerCell[w], r: [r0, r1, r2], n: [n[0], n[1], n[2]], other: owner[across], length: length / 2 });
        let kind = -1, size = 0, rAge;
        if (trenchB && oceanA && !trenchA) {
            kind = PULL; size = config.slabPull * ageFactor(A.formedAt[cellA]) * maturity(B, cellB);
            load.slabs.push({ w, c: ownerCell[w], r: [r0, r1, r2], n: [n[0], n[1], n[2]], other: owner[across], length });
        } else if (trenchA && oceanB && !trenchB) { kind = SUCTION; size = config.slabSuction * ageFactor(B.formedAt[cellB]) * maturity(A, cellA); }
        else if ((rAge = riftAge(plates[a], A, cellA, plates[owner[across]], B, cellB, time)) < config.riftPushMyr) { kind = RIFT; size = -config.riftPush * (1 - rAge / config.riftPushMyr); }
        if (kind < 0 || size === 0) continue;

        let dir = n;
        // a rift pushes a plate in ONE direction, straight away from its partner (riftPushDir, fixed at the split) — not along
        // the local normal. `size` is negative for the pushes (away from n); along riftPushDir the push is + that direction.
        if (kind === RIFT && plates[a].riftPushDir) { dir = plates[a].toWorld(plates[a].riftPushDir[0], plates[a].riftPushDir[1], plates[a].riftPushDir[2], [0, 0, 0]); size = Math.abs(size); }
        const f = size * length, fx = dir[0] * f, fy = dir[1] * f, fz = dir[2] * f;
        const tx = r1 * fz - r2 * fy, ty = r2 * fx - r0 * fz, tz = r0 * fy - r1 * fx;      // r × F
        load.torque[0] += tx; load.torque[1] += ty; load.torque[2] += tz;
        cellTorque[3 * w] += tx; cellTorque[3 * w + 1] += ty; cellTorque[3 * w + 2] += tz;
        const k = load.byKind[kind]; k[0] += tx; k[1] += ty; k[2] += tz;
        const v = load.forceByKind[kind]; v[0] += fx; v[1] += fy; v[2] += fz;
        load.torqueMagnitudeSum += Math.hypot(tx, ty, tz);
        load.cells[kind]++;
    }
    for (const p of plates) if (loadOf[p.id]) riftHinge(world, p, loadOf[p.id]);
    ridgePushGpe(world, loadOf, cellTorque);
    if (config.collisionSlabPull) hangingSlabPull(world, loadOf, cellTorque);
    if (config.swellPush) swellPush(world, loadOf, cellTorque);
    return loads;
}

/**
 * Ridge push: the ocean lithosphere's own gravitational potential energy. A column of ocean lithosphere cools and thickens
 * as it ages, and with it subsides; its potential energy per area falls below the ridge's by
 *   F(t) = g ρm α ∫ (Tm − T(z, t)) z dz + ½ g (ρm − ρw) w(t)²
 * — the first moment of its cooling's density excess, plus the water that fills the depth it has sunk by, w(t) (Parsons &
 * Richter 1980; Turcotte & Schubert's eq. for the half-space, g ρm α ΔT κ t [1 + 2 ρm α ΔT ⁄ π(ρm − ρw)], is this for an
 * unbounded plate: ~3.3 × 10¹² N/m at 80 Myr with their numbers). The model's floor is GDH1 (Stein & Stein 1992:
 * measure.js gdh1BasementKm), a plate a = 95 km thick, and for it ∫ = ΔT a² m(t), m(t) = 1⁄6 − (2⁄π²) Σ (−1)ⁿ⁺¹ e^(−n² t⁄τ) ⁄ n²
 * (the plate's cooling series), with ρm α ΔT = 2 (ρm − ρw) w∞ ⁄ a by its own isostasy, so
 *   F(t) = g (ρm − ρw) [2 w∞ a m(t) + ½ w(t)²]
 * w(t), w∞ and τ = a² ⁄ π²κ (36 Myr) are read off GDH1's own depths, so the push is the floor's the model draws: 1.4 × 10¹² N/m
 * at 40 Myr, 2.0 at 80, 2.3 on old floor (0.23 / 0.33 / 0.38 force units). It is lower than a half-space's (Turcotte &
 * Schubert's ~3.3 at 80 Myr) and Hopper & Buck 1993's 3–5 × 10¹² (recalled) because GDH1's plate is thin: its old floor
 * stops cooling, and stops pushing, at ~100 Myr. (Was, until lane gpelock 2026-11-24: ridgePush 0.25, a constant force at
 * each young-on-young ocean contact.)
 * A body force on every ocean cell, f = −∇U, U = −F(age): down the slope toward older floor, reckoned per 100 km of shared
 * cell edge as swellPush below (the divergence theorem: each edge carries the mean of U on its two sides). Over one plate's
 * ocean the forces sum to −∮ U n round its edge: nothing where the ocean meets its ridge (U ≈ 0 at age 0), F(t) outward
 * wherever the ocean is old when it ends — at a trench (the push into it), at its own continent's coast (the Indian Ocean's
 * lithosphere driving India: Copley, Avouac & Royer 2010) — so a plate of one age everywhere has no net push, and a plate
 * with a ridge on one side is pushed away from it by F of its oldest floor. Limits: the ocean alone — a continent's own GPE
 * against the ocean beside it (Coblentz et al. 1994) is not drawn, nor the swell under the floor (sea-level.js; the swell's
 * push is swellPush's, on the plate's inside); edges to another plate's crust carry nothing across.
 */
const GDH1_PLATE_KM = 95;
let RIDGE_GPE = null;
/** F(age) ⁄ forceUnitNPerM by whole Myr of age, 0–RIDGE_GPE_MAX_MYR (older: the last), for the given densities (heightsOf). */
function ridgeGpeTable(H, forceUnit) {
    const dRho = H.riftMantleRho - H.seaRho;
    if (RIDGE_GPE?.dRho === dRho && RIDGE_GPE.forceUnit === forceUnit) return RIDGE_GPE.F;
    const w = t => (gdh1BasementKm(t) - gdh1BasementKm(0)) * 1000, wInf = w(1e6), a = GDH1_PLATE_KM * 1000;
    const tau = -20 / Math.log((wInf - w(40)) / (wInf - w(20)));        // (GDH1's old branch decays as e^(−t⁄τ))
    const F = new Float64Array(RIDGE_GPE_MAX_MYR + 1);
    for (let t = 0; t <= RIDGE_GPE_MAX_MYR; t++) {
        let sum = 0;
        for (let n = 1; n <= 60; n++) sum += (n % 2 ? 1 : -1) * Math.exp(-n * n * t / tau) / (n * n);
        const m = Math.max(0, 1 / 6 - 2 / (Math.PI * Math.PI) * sum);
        F[t] = 9.81 * dRho * (2 * wInf * a * m + 0.5 * w(t) * w(t)) / forceUnit;
    }
    RIDGE_GPE = { dRho, forceUnit, F };
    return F;
}
const RIDGE_GPE_MAX_MYR = 400;

function ridgePushGpe(world, loadOf, cellTorque) {
    const { mesh, owner, ownerCell, plates, landClaims, config, time } = world, { xyz, numCells, adjOffset, adjList, edgeKm } = mesh;
    const table = ridgeGpeTable(heightsOf(config), config.forceUnitNPerM), T = edgeTangents(mesh), scale = edgeKm / Math.sqrt(3) / 100 / 2;
    const Fw = RIDGE_SCRATCH.length === numCells ? RIDGE_SCRATCH : (RIDGE_SCRATCH = new Float64Array(numCells));
    for (let w = 0; w < numCells; w++) {
        const a = owner[w];
        Fw[w] = NaN;
        if (a < 0 || !loadOf[a] || landClaims[w] > 1) continue;
        const crust = plates[a].crust, c = ownerCell[w];
        if (crust.type[c] !== CrustType.OCEAN) continue;
        const age = Math.max(0, time - crust.formedAt[c]), i = Math.floor(age);
        Fw[w] = i >= RIDGE_GPE_MAX_MYR ? table[RIDGE_GPE_MAX_MYR] : table[i] + (table[i + 1] - table[i]) * (age - i);
    }
    for (let w = 0; w < numCells; w++) {
        const f0 = Fw[w];
        if (!(f0 === f0)) continue;                                  // (not a plate's own ocean)
        const a = owner[w];
        let fx = 0, fy = 0, fz = 0;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
            const nb = adjList[k], f1 = Fw[nb];
            if (owner[nb] !== a || !(f1 === f1)) continue;           // (the ocean's edge: carries nothing across)
            const push = (f1 - f0) * scale;                          // −(U_nb − U_w) ⁄ 2 × edge, U = −F
            fx += push * T[3 * k]; fy += push * T[3 * k + 1]; fz += push * T[3 * k + 2];
        }
        if (fx === 0 && fy === 0 && fz === 0) continue;
        const r0 = xyz[3 * w], r1 = xyz[3 * w + 1], r2 = xyz[3 * w + 2], load = loadOf[a];
        const tx = r1 * fz - r2 * fy, ty = r2 * fx - r0 * fz, tz = r0 * fy - r1 * fx;
        load.torque[0] += tx; load.torque[1] += ty; load.torque[2] += tz;
        cellTorque[3 * w] += tx; cellTorque[3 * w + 1] += ty; cellTorque[3 * w + 2] += tz;
        const kb = load.byKind[RIDGE]; kb[0] += tx; kb[1] += ty; kb[2] += tz;
        const v = load.forceByKind[RIDGE]; v[0] += fx; v[1] += fy; v[2] += fz;
        // (not in torqueMagnitudeSum: a body force spread cell by cell has no boundary magnitude to sum, and the sum of its
        // cells' magnitudes is the mesh's, not the force's — a 250 km apron's 0.9 / 1.5 / 2.1 at 16K / 40K / 90K cells against
        // a net 0.5 / 0.7 / 1.1. Lane gpelock 2026-11-25)
        load.ridgeTorque[0] += tx; load.ridgeTorque[1] += ty; load.ridgeTorque[2] += tz;
        load.cells[RIDGE]++;
    }
}
let RIDGE_SCRATCH = new Float64Array(0);

/**
 * (config.swellPush) The swell's push. Warm mantle under a lid lifts the ground over it (terrain/sea-level.js: the swell,
 * mantleSwellKm × the mantle's heat smoothed over mantleSwellSmoothKm — the model's own, whose height is not changed here).
 * The lid lifted by h on buoyant mantle beneath it carries ρ̄ g h more overburden at every level of its thickness L than the
 * lid beside it, so its potential energy per area is U = ρ̄ g L h higher (h ≪ L; the lithosphere's GPE, Coblentz, Richardson &
 * Sandiford 1994, Tectonics 13: elevated continental lithosphere stands in extension; Molnar & Lyon-Caen 1988, GSA Spec. Pap.
 * 218: a high range spreads under its own weight). That is a body force on the plate, f = −∇U, away from the swell's high
 * centre. L and ρ̄ are the column model's (riftLithKm; its crust at riftCrustRho and its lid at the mantle's mean density over
 * its geotherm, ρm (1 − α T⁄2)): ≈ 3.9 × 10¹² N/m per km of swell, 0.64 force units. It agrees with mantleSwellKm itself: a
 * supercontinent warms the mantle under it by up to ~100 K (Coltice et al. 2007, Geology 35), and α ΔT over the ~300 km of
 * upper mantle it lies in is ~1 km. Discretely, as the boundary forces are reckoned (per 100 km of shared cell edge): each
 * edge of a cell carries the mean of U on its two sides, so a cell is pushed by −Σ (U_nb − U_w) ⁄ 2 × edge along the tangent
 * toward each neighbour (the divergence theorem; Σ n ℓ = 0 round a cell, so U's level does not matter, only its slope —
 * mantleSwellLandRef, the datum, plays no part). On every cell of the plate, continent or ocean: the lid over the swell's
 * flank carries its GPE whatever its crust. And as a load internal to the plate: its net torque on the plate is taken back
 * out, shared evenly over its cells, so it stresses the plate (it pulls a supercontinent's interior apart, from nothing at its
 * edge to the swell's full contrast inside) and does not drive it. Body forces inside a plate sum to the boundary term
 * (−∮ U n round the plate's edge, by the divergence theorem); a swell under one plate passes nothing across it. Kept as a net,
 * the push drove the lab's scenes (riftswell report §7, scenediag.mjs): on continental cells only (the ocean on the same
 * flank left out), every continent that moved slid off the swell it started on (the mantle's heat stays in the mantle's
 * frame) and was pushed on along its way, a feedback — Asia 1 → 5 cm/yr against ~2 without it, the founder scene's passive
 * plates (nothing else acting) 0 → 6 cm/yr, collisions unwelded (phases 5, 5b, 6b, 7c, 10); on every cell, the swell's
 * smoothed flank reached across Asia's trench and held India back. Limit: the swell's push ACROSS a plate's edge is
 * dropped. A swell straddling a ridge or reaching a neighbour's ocean would push that neighbour away (the African superswell's
 * flanks); in the model it reaches across trenches, where the slab cools the mantle and no swell should stand (subcontinental
 * heat comes from the absence of subduction beneath: Lowman & Gable 1999, GRL 26), so it is left out, not modelled.
 * Other limits: one lid thickness (L) everywhere — a craton's 200–350 km root would carry more; the swell's own flow (the
 * drag of the upwelling) is mantle flow's (supercontinent.js), not added here; h² terms dropped.
 */
/** Per mesh edge k (adjList[k] of cell w): the unit tangent at w toward that neighbour — fixed by the mesh, so worked out once. */
const TANGENTS = new WeakMap();
function edgeTangents(mesh) {
    let T = TANGENTS.get(mesh);
    if (T) return T;
    const { xyz, numCells, adjOffset, adjList } = mesh;
    T = new Float64Array(3 * adjList.length);
    for (let w = 0; w < numCells; w++) {
        const r0 = xyz[3 * w], r1 = xyz[3 * w + 1], r2 = xyz[3 * w + 2];
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
            const nb = adjList[k];
            let tx = xyz[3 * nb] - r0, ty = xyz[3 * nb + 1] - r1, tz = xyz[3 * nb + 2] - r2;
            const along = tx * r0 + ty * r1 + tz * r2;
            tx -= along * r0; ty -= along * r1; tz -= along * r2;
            const l = Math.hypot(tx, ty, tz);
            if (l > 0) { T[3 * k] = tx / l; T[3 * k + 1] = ty / l; T[3 * k + 2] = tz / l; }
        }
    }
    TANGENTS.set(mesh, T);
    return T;
}

function swellPush(world, loadOf, cellTorque) {
    const { mesh, owner, config } = world, { xyz, numCells, adjOffset, adjList, edgeKm } = mesh, H = heightsOf(config);
    const lidRho = H.riftMantleRho * (1 - H.riftExpansion * H.riftMantleC / 2);
    const rhoBar = (H.riftCrustKm * H.riftCrustRho + (H.riftLithKm - H.riftCrustKm) * lidRho) / H.riftLithKm;
    // force units per unit of heat, per 100 km of edge: U per km of swell (N/m) × mantleSwellKm ÷ forceUnitNPerM
    const perHeat = rhoBar * 9.81 * H.riftLithKm * 1e3 * 1e3 * H.mantleSwellKm / config.forceUnitNPerM;
    const S = smoothHeat(world.mantleHeat, mesh, H.mantleSwellSmoothKm), edge = edgeKm / Math.sqrt(3) / 100;
    const T = edgeTangents(mesh), scale = perHeat * edge / 2;
    // each cell's push, and each plate's sum of them (its net, taken back out below: the load is internal to the plate)
    const tau = new Float64Array(3 * numCells), net = new Map();
    for (let w = 0; w < numCells; w++) {
        const a = owner[w];
        if (a < 0 || !loadOf[a]) continue;
        const r0 = xyz[3 * w], r1 = xyz[3 * w + 1], r2 = xyz[3 * w + 2];
        swellForce(w, S, scale, T, adjOffset, adjList, PUSH);
        const fx = PUSH[0], fy = PUSH[1], fz = PUSH[2];
        const tx = r1 * fz - r2 * fy, ty = r2 * fx - r0 * fz, tz = r0 * fy - r1 * fx;
        tau[3 * w] = tx; tau[3 * w + 1] = ty; tau[3 * w + 2] = tz;
        const m = net.get(a) ?? net.set(a, [0, 0, 0, 0]).get(a);
        m[0] += tx; m[1] += ty; m[2] += tz; m[3]++;
    }
    for (let w = 0; w < numCells; w++) {
        const a = owner[w], m = a >= 0 ? net.get(a) : null;
        if (!m) continue;
        cellTorque[3 * w] += tau[3 * w] - m[0] / m[3]; cellTorque[3 * w + 1] += tau[3 * w + 1] - m[1] / m[3]; cellTorque[3 * w + 2] += tau[3 * w + 2] - m[2] / m[3];
        loadOf[a].cells[SWELL]++;
    }
}
// (a cell's swell push summed over its edges, into out: its own function, so that swellPush's loop over the cells is not
// V8 OSR code for this inner loop, dropped back to the interpreter at each of its ~40K exits a step — lane histprof)
const PUSH = new Float64Array(3);
function swellForce(w, S, scale, T, adjOffset, adjList, out) {
    const s = S[w];
    let fx = 0, fy = 0, fz = 0;
    for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
        const push = -(S[adjList[k]] - s) * scale;
        fx += push * T[3 * k]; fy += push * T[3 * k + 1]; fz += push * T[3 * k + 2];
    }
    out[0] = fx; out[1] = fy; out[2] = fz;
}

/**
 * (config.collisionSlabPull) The slab still hanging under a collision front keeps pulling the lower plate in, net of the
 * buoyancy of its continental crust that has gone down after it, until the slab breaks off. Without it the model drops the
 * pull the moment land reaches the trench (a boundary cell of land on land is a contact, not a trench).
 *   net pull per metre = slabPull × s × (1 − F_b ⁄ (F_slab × s)),  s = age factor × slab maturity,  F_b = (ρa − ρc) g h_c L
 * F_slab: an old, full slab's gross negative buoyancy, collisionSlabGrossNPerM (England & Wortel 1980; the force unit is the
 * ~20 % of it the plate feels: config forceUnitNPerM), scaled like the trench's own pull by the slab's age and length at
 * contact (s: the same √(age ⁄ slabPullAgeRefMyr) and slabKm ⁄ slabMatureKm as a trench's pull — remembered on the record
 * the first step the slab is seen, from the lower plate's ocean and the upper plate's trench within three rings of the front).
 * F_b: the buoyancy of the continental crust (thickness h_c, density ρc: the column model's, as torque-balance.js
 * collisionGpeNPerM) carried down after it — the crust the collision has underthrust (step/collision.js underthrustCells)
 * over its front, L of it, but only the part still shallower than the eclogite transition: below collisionEclogiteKm the
 * crust's mafic lower half turns to eclogite, denser than the mantle, and its buoyancy is gone (Austrheim 1991; Hacker et
 * al. 2003; Hetényi et al. 2007 find India's lower crust eclogitised under southern Tibet — but late, where it reaches its
 * deepest, the reaction held back by its kinetics: so the cap at the equilibrium depth leaves the most net pull it can). Down a slab dipping at
 * collisionSlabDipDeg that is L ≤ z_ecl ⁄ sin dip, so a slab that outweighs that much crust keeps a net pull (Capitanio et
 * al. 2010: Greater India's attached slab drove its convergence on long after contact) — without the cap the crust of any
 * collision cancelled any slab after ~175 km of it had gone down, within a few Myr of contact (lane slab).
 * Break-off is the slab's own: once land stalls it, the slab hangs in the mantle and is warmed through from both faces;
 * when the core that carries its weight (colder than slabCoreTempShare of the mantle's temperature) is gone it necks and
 * breaks (Davies & von Blanckenburg 1995: whether and where a slab breaks is set by its temperature; Duretz, Gerya & May 2011). The core of a plate of age A is z = 2√(κA) erf⁻¹(θ) thick
 * (the half-space cooling profile); conduction from both faces warms its middle past θ in z² ⁄ (π² κ) ln(4(1 − θ⁄2) ⁄ π(1 − θ))
 * (the slab's first mode, its mean start at θ⁄2) — so t_b = A × 4 erf⁻¹(θ)² ⁄ π² × ln(…): κ cancels, an old slab holds on
 * longer than a young one, as van Hunen & Allen (2011) find (old slabs 20–25 Myr after contact, young ~10; not fitted
 * here: the warming alone gives ~0.115 A, README "The hanging slab"). Acts on the lower plate only, across the front toward the upper, split evenly over the pair's
 * contact cells by their share of the front (as torque-balance.js gpeLock). Limits: one slab per collision, its age and
 * length read once, at the first step seen; break-off from first contact, not from when the slab stalled; the necking's
 * own runaway (its strain rate) is not drawn, only the warming that allows it; the detached slab's flow (step/slab-conveyor
 * on the drive branch) is not added.
 */
function hangingSlabPull(world, loadOf, cellTorque) {
    const { config, collisions, time, mesh } = world, H = heightsOf(config);
    const rc = H.riftCrustRho, ra = H.riftMantleRho * (1 - H.riftExpansion * H.riftMantleC), hc = H.riftCrustKm * 1000;
    const buoyantMaxM = config.collisionEclogiteKm * 1000 / Math.sin(config.collisionSlabDipDeg * Math.PI / 180);
    const perAge = breakoffPerAgeMyr(config.slabCoreTempShare);
    for (const rec of collisions?.values() ?? []) {
        const load = loadOf[rec.lower], after = time - rec.startedAt;
        if (!load || rec.sutured || !(after >= 0) || !(rec.frontKm > 0)) continue;
        const cs = load.contacts.filter(c => c.other === rec.upper);
        if (!cs.length) continue;
        if (rec.slabAgeMyr === undefined) slabAtContact(world, rec, cs);
        if (after >= perAge * rec.slabAgeMyr) continue;                                     // broken off
        const s = Math.sqrt(Math.min(1, rec.slabAgeMyr / config.slabPullAgeRefMyr)) * Math.min(1, rec.slabKm / config.slabMatureKm);
        const enteredM = Math.min(buoyantMaxM, (rec.underthrustCells ?? 0) * mesh.cellAreaKm2 / rec.frontKm * 1000);
        const net = s - (ra - rc) * 9.81 * hc * enteredM / config.collisionSlabGrossNPerM;
        if (!(net > 0)) continue;
        const f = config.slabPull * net * Math.max(rec.frontKm, mesh.edgeKm) / 100 / cs.length;
        for (const { w, r, n } of cs) {
            const fx = n[0] * f, fy = n[1] * f, fz = n[2] * f, tx = r[1] * fz - r[2] * fy, ty = r[2] * fx - r[0] * fz, tz = r[0] * fy - r[1] * fx;
            load.torque[0] += tx; load.torque[1] += ty; load.torque[2] += tz;
            cellTorque[3 * w] += tx; cellTorque[3 * w + 1] += ty; cellTorque[3 * w + 2] += tz;
            const k = load.byKind[PULL]; k[0] += tx; k[1] += ty; k[2] += tz;
            const v = load.forceByKind[PULL]; v[0] += fx; v[1] += fy; v[2] += fz;
            load.torqueMagnitudeSum += Math.hypot(tx, ty, tz);
            load.cells[PULL]++;
        }
    }
}

/**
 * The slab a collision's front hangs from, read once: its age — the mean age of the lower plate's ocean within three rings
 * of the front, what went down last — and its length — the longest slab (crust.slabKm) of the upper plate's trench there.
 * No ocean left in reach (the record seen late): slabPullAgeRefMyr, a full-strength slab; no trench: slabMatureKm.
 */
function slabAtContact(world, rec, cs) {
    const { mesh, owner, ownerCell, plates, time, config } = world, { start, cells, stride } = ringsOf(mesh);
    const L = plates[rec.lower].crust, U = plates[rec.upper].crust;
    let ageSum = 0, ages = 0, slab = 0;
    for (const { w } of cs) for (let i = start[w * stride]; i < start[w * stride + stride - 1]; i++) {
        const q = cells[i], o = owner[q], c = ownerCell[q];
        if (o === rec.lower && L.type[c] === CrustType.OCEAN) { ageSum += Math.max(0, time - L.formedAt[c]); ages++; }
        else if (o === rec.upper && (U.flags[c] & CrustFlag.TRENCH)) slab = Math.max(slab, U.slabKm[c]);
    }
    rec.slabAgeMyr = ages ? ageSum / ages : config.slabPullAgeRefMyr;
    rec.slabKm = slab > 0 ? slab : config.slabMatureKm;
}

/**
 * Break-off time per Myr of slab age (hangingSlabPull): 4 erf⁻¹(θ)² ⁄ π² × ln(4(1 − θ⁄2) ⁄ π(1 − θ)). erf by its Taylor
 * series and erf⁻¹ by bisection — sums and products only, the same last digit in every JavaScript engine.
 */
function breakoffPerAgeMyr(theta) {
    const erf = x => { let term = x, sum = x; for (let n = 1; n < 60; n++) { term *= -x * x / n; sum += term / (2 * n + 1); } return sum * 2 / Math.sqrt(Math.PI); };
    let lo = 0, hi = 3;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (erf(mid) < theta) lo = mid; else hi = mid; }
    const z = (lo + hi) / 2;
    return 4 * z * z / (Math.PI * Math.PI) * Math.log(4 * (1 - theta / 2) / (Math.PI * (1 - theta)));
}

/**
 * A rift that unzips (config.riftScissorShare): its halves are pinned together at a point that slides from riftHingeFrom
 * to riftHingeTo along the rift's chord over riftHingeMyr — the pole just beyond the propagating tip. The rift push then
 * turns them about it: a wedge of ocean opens from one coast, and widens toward the other as the pin moves out.
 */
function riftHinge(world, plate, load) {
    const { plates, time, config, mesh } = world, hinge = plate.riftHinge, other = plates[plate.riftPartner];
    if (!hinge || !other?.alive || other.riftPartner !== plate.id || other.riftHinge !== hinge) return;
    const age = (time - Math.max(plate.born, other.born)) / config.riftHingeMyr;
    if (!(age >= 0 && age < 1)) return;
    const f = config.riftHingeFrom + (config.riftHingeTo - config.riftHingeFrom) * age;
    const { from: a, to: b } = hinge, cos = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])), th = Math.acos(cos);
    if (th < 1e-6) return;
    const wa = Math.sin((1 - f) * th) / Math.sin(th), wb = Math.sin(f * th) / Math.sin(th);      // along the great circle, past b when f > 1
    const p = [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]], l = Math.hypot(p[0], p[1], p[2]);
    const r = plate.toWorld(p[0] / l, p[1] / l, p[2] / l, [0, 0, 0]);
    const land = Math.min(plate.stats.continentalCells, other.stats.continentalCells) * mesh.cellAreaKm2 / 1e4;
    const loose = Math.min(1, (1 - age) / config.riftHingeFade);
    load.hinges.push({ r, other: other.id, c: config.riftHingeLock * land / config.mobility * loose, cell: hingeCell(plate, mesh, r) });
}

/**
 * The plate's raster cell that carries the hinge's pin (step/plate-stress.js): the one under it, or, the pin lying just
 * beyond the rift's tip and so often off the plate, its nearest own cell among that cell's neighbours; −1 if neither.
 */
function hingeCell(plate, mesh, r) {
    const q = plate.cellAt(mesh.index, r[0], r[1], r[2]), { mask } = plate.crust, { xyz, adjOffset, adjList } = mesh;
    if (mask[q]) return q;
    let best = -1, bestD = -Infinity;
    const P = [0, 0, 0];
    for (let k = adjOffset[q]; k < adjOffset[q + 1]; k++) {
        const nb = adjList[k]; if (!mask[nb]) continue;
        plate.toWorld(xyz[3 * nb], xyz[3 * nb + 1], xyz[3 * nb + 2], P);
        const d = P[0] * r[0] + P[1] * r[1] + P[2] * r[2];
        if (d > bestD) { bestD = d; best = nb; }
    }
    return best;
}

/**
 * The collision front's normal at overlap cell w, pointing from plate a's side toward plate b's: from a's own land
 * within three rings of it to b's own land (the overlap itself excluded) — or, with neither in reach, from a's centre
 * toward b's.
 */
function frontNormal(world, w, a, b, r) {
    const { mesh, owner, ownerCell, plates, landClaims } = world, { xyz } = mesh, { start, cells, stride } = ringsOf(mesh);
    let vx = 0, vy = 0, vz = 0;
    for (let i = start[w * stride + 1]; i < start[w * stride + stride - 1]; i++) {
        const q = cells[i], o = owner[q];
        if (o !== a && o !== b) continue;
        if (landClaims[q] > 1 || plates[o].crust.type[ownerCell[q]] === CrustType.OCEAN) continue;
        const s = o === b ? 1 : -1;
        vx += s * xyz[3 * q]; vy += s * xyz[3 * q + 1]; vz += s * xyz[3 * q + 2];
    }
    const d = vx * r[0] + vy * r[1] + vz * r[2];
    vx -= d * r[0]; vy -= d * r[1]; vz -= d * r[2];
    const l = Math.hypot(vx, vy, vz);
    if (l > 1e-9) return [vx / l, vy / l, vz / l];
    const A = plates[a], B = plates[b];
    return tangentToward(r, A.toWorld(A.capCenter[0], A.capCenter[1], A.capCenter[2], [0, 0, 0]), B.toWorld(B.capCenter[0], B.capCenter[1], B.capCenter[2], [0, 0, 0]));
}

/**
 * How long ago the rift between these two cells opened, or Infinity if this is not a rift contact: both cells are
 * rifted margins (age = since the younger plate was born), or both are ocean born since the younger plate was.
 */
function riftAge(plateA, A, cellA, plateB, B, cellB, time) {
    const born = Math.max(plateA.born, plateB.born);
    if (plateA.riftPartner !== plateB.id || plateB.riftPartner !== plateA.id) return Infinity;     // real rift partners only
    // (a new ridge in an ocean plate: its old floor along the line is the margin — step/ocean-plates.js)
    const split = plateA.oceanSplitWith === plateB.id && plateB.oceanSplitWith === plateA.id;
    const marginA = split || (A.flags[cellA] & CrustFlag.RIFT_MARGIN) !== 0, marginB = split || (B.flags[cellB] & CrustFlag.RIFT_MARGIN) !== 0;
    const youngA = A.type[cellA] === CrustType.OCEAN && A.formedAt[cellA] >= born, youngB = B.type[cellB] === CrustType.OCEAN && B.formedAt[cellB] >= born;
    return (marginA || youngA) && (marginB || youngB) ? time - born : Infinity;
}

function newLoad() {
    const zero = () => [0, 0, 0];
    return { torque: zero(), flowTorque: zero(), ridgeTorque: zero(), byKind: FORCE_KINDS.map(zero), forceByKind: FORCE_KINDS.map(zero), torqueMagnitudeSum: 0, cells: FORCE_KINDS.map(() => 0), slabs: [], contacts: [], hinges: [] };
}

/**
 * The thickening the lock at overlap cell w resists with, km above ordinary crust (riftCrustKm): the column as it stands —
 * crust.rootKm, each crust's thickness less its kind's as formed (thickened, spread by crust-flow, worn) — at its thickest
 * within two rings of w: the plateau the collision has built (keepConsumed, 1 − u², just behind the overlap) and, in the
 * overlap itself, the two crusts stacked one on the other (Argand 1924's doubled crust under Tibet; Zhao et al. 2010 image
 * India's crust beneath it). The overlap is crust the model keeps stacked — up to overlapCapKm deep, and a craton's whole,
 * which never goes under (step/collision.js underthrust); and all of it in a world without the event rules — so its column
 * is a real one, and its buoyancy holds the pair: without it a craton overridden by its neighbour (the India scene, once
 * India's crust beyond its shield has gone under) was crossed at 2–3 cm/yr for 100 Myr, nothing built and nothing resisting.
 * Not thickKm, the record of what orogenies laid, which is never reset: read, it stacked an Andean margin's laid 39 km on
 * the lower plate's crust, and the cap stood 2.0× the belt's in the India scene (lane gpelock). Its weight, as the
 * plateau's, is reckoned per metre of front, as an Airy-compensated column (torque-balance.js collisionGpeNPerM).
 * At most underthrustMaxThickKm, the thickest the model lets a column stand before it spreads under its own weight (ops/
 * thicken.js): the stack in the overlap is kept as two rasters, not laid as a column, so no spreading reaches it, and read
 * whole — an upper plate's 20 km of root on the lower's crust, Δh 55 — it held India at 1.8× Tibet's force, stalled 1257 km
 * in (lane gpelock). Limits: the lower plate's edge is drawn at its kind's full thickness, not thinned as a passive margin's
 * is; a column thinned below its kind's counts as its kind's.
 */
function frontThickening(world, w, a, b, crustA, cellA, crustB, cellB) {
    const { mesh: { adjOffset, adjList }, owner, ownerCell, plates, config } = world, H = heightsOf(config);
    const kindKm = (crust, c) => crust.type[c] === CrustType.CRATON ? H.cratonCrustKm : H.riftCrustKm;
    let best = kindKm(crustA, cellA) + Math.max(0, crustA.rootKm[cellA]) + kindKm(crustB, cellB) + Math.max(0, crustB.rootKm[cellB]) - H.riftCrustKm;
    const look = c => { const p = owner[c]; if (p === a || p === b) best = Math.max(best, plates[p].crust.rootKm[ownerCell[c]]); };
    look(w);
    for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
        const nb = adjList[k];
        look(nb);
        for (let j = adjOffset[nb]; j < adjOffset[nb + 1]; j++) look(adjList[j]);
    }
    return Math.min(best, config.underthrustMaxThickKm);
}
