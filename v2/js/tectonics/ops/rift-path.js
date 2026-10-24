// Finding a rift (WBP Part Va): from a junction, the cheapest arms to the coast — round cratons (cratonStrength: through
// one only where every way round costs more), along old sutures —
// and, of the cuts they make, the one the plate's own stress is likeliest to break; one arm fails. See ops/rift.js.

import { CrustType, CrustFlag } from '../model/crust.js';
import { PLANET_RADIUS_KM } from '../../core/sim-mesh.js';
import { tangentToward, normalize, cross, dot, cellDistanceKm } from '../../core/sphere-geom.js';
import { sidesOf, exteriorSea, maskedCells } from './rift-partition.js';
import { FastNoise } from '../../core/fast-noise.js';
import { edgeKmOf } from '../../core/min-heap.js';
import { netTorques, stressAcross, cutAlong } from '../step/plate-stress.js';

/**
 * The grain of the crust a rift follows (developer: rifts "on way too straight lines … should curve a bit and be jagged";
 * straight cuts left rectangular continents). A continent is not uniform: old fabric, fault zones and weak terranes
 * make some ground cheaper to break than other ground (the Atlantic opened along the Appalachian–Caledonian grain, and its
 * margins bend and step). Here a smooth field fixed in the plate's own frame — so a continent's pieces keep the grain it
 * had, and later rifts on the same crust follow the same fabric — scales the cost of breaking each cell: a broad swing
 * (riftCurveKm) that bends a rift, and a finer one (riftJagKm) that makes it jagged. × 1 ± the amplitudes.
 */
export function grainOf(world) {
    const { config } = world;
    if (!(config.riftCurveAmp > 0 || config.riftJagAmp > 0)) return () => 1;
    const noise = world.riftGrain ??= new FastNoise((world.seed ^ 0x6a41) >>> 0);
    const f1 = PLANET_RADIUS_KM / config.riftCurveKm, f2 = PLANET_RADIUS_KM / config.riftJagKm, { xyz } = world.mesh;
    // (a raster cell's grain is fixed — the plate's frame, the world's seed — so it is worked out once per history)
    const known = world.riftGrainOf ??= new Float64Array(world.mesh.numCells).fill(NaN);
    return c => {
        let g = known[c];
        if (g === g) return g;
        const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
        g = known[c] = Math.max(0.2, 1 + config.riftCurveAmp * noise.noise3D(x * f1, y * f1, z * f1) + config.riftJagAmp * noise.noise3D(x * f2 + 31.7, y * f2 + 17.3, z * f2 + 5.1));
        return g;
    };
}

/**
 * What a rift search reads of a plate, the same for every junction tried (rifting.js tryRift): its cells in order, the sea
 * its outer coast faces, the grain, and what it needs to weigh the stress across a cut — each cell's net torque
 * (step/plate-stress.js; null before the first torque balance) and the plate's rotation matrix.
 */
export function riftContext(world, plate) {
    const { mesh } = world, crust = plate.crust, exterior = exteriorSea(mesh, crust);
    return { cells: maskedCells(crust), exterior, grain: grainOf(world), rho: netTorques(world, plate), mat: Array.from(plate.mat) };
}

/**
 * Find a rift across `plate`'s landmass through raster cell `junction`.
 * @param {number[]|null} pullAxis   (unused: the stress across each cut decides where the plate breaks)
 * @param {Object} [ctx]   riftContext(world, plate), when several junctions of the same crust are tried
 * @returns {{path: number[], failedArm: number[], arms: number[][], across: number[], value: number, stress: number, share: number}|null}   path = coast
 *          to coast through the junction; stress across it (per 100 km, + tension); share of the land on its smaller side
 */
export function findRift(world, plate, junction, pullAxis, needCratonsBothSides = true, ctx = null) {
    const { mesh, config } = world, { xyz, adjOffset, adjList, edgeKm } = mesh, crust = plate.crust;
    const land = c => crust.mask[c] && crust.type[c] !== CrustType.OCEAN;
    if (!land(junction) || crust.type[junction] === CrustType.CRATON) return null;
    ctx ??= riftContext(world, plate);

    // cheapest paths from the junction across the land: weak lines cost riftWeaknessCost, a craton cratonStrength
    const weak = CrustFlag.SUTURE | CrustFlag.FAILED_RIFT | CrustFlag.RIFT_MARGIN;
    const grain = ctx.grain;
    const strength = c => crust.type[c] === CrustType.CRATON ? config.cratonStrength : 1;
    const { cost, from } = cheapestPaths(mesh, crust, junction, c => ((crust.flags[c] & weak) ? config.riftWeaknessCost : 1) * strength(c) * grain(c));
    // coastal land cells reached — on the OUTER coast (an inland sea is not a way out), with the direction they lie in
    const { exterior } = ctx;
    const J = pos(xyz, junction), coast = [];
    for (const c of ctx.cells) {
        if (!land(c) || cost[c] === Infinity) continue;
        let isCoast = false;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (exterior[adjList[k]]) { isCoast = true; break; }
        if (!isCoast || cellDistanceKm(xyz, junction, c) < config.riftMinArmKm) continue;
        coast.push({ c, dir: tangentToward(J, J, pos(xyz, c)), score: cost[c] });
    }
    if (coast.length < 2) return null;
    coast.sort((a, b) => a.score - b.score);
    const apart = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2]))) * 180 / Math.PI;
    // the rift = the pair of arms, leaving the junction in (nearly) opposite directions, with the lowest cost PER
    // KILOMETRE of the chord between their ends — so a rift crosses the landmass along its cheap lines rather than
    // cutting a short wedge off the nearest coast or looping round one craton
    const trace = end => { const out = []; for (let c = end; c >= 0; c = from[c]) out.push(c); return out.reverse(); };   // junction → coast
    const top = coast.slice(0, Math.max(8, Math.round(config.riftArmEndCoastKm / mesh.edgeKm)));
    for (const e of top) e.lengthKm = trace(e.c).length * edgeKm;
    const pairs = [];
    for (const a of top) for (const b of top) {
        if (a === b || apart(a, b) < RIFT_ARMS_APART_DEG) continue;
        const chord = cellDistanceKm(xyz, a.c, b.c);
        if (chord < config.riftMinChordKm || a.lengthKm + b.lengthKm > config.riftTortuosityMax * chord) continue;   // a rift zig-zags, it does not meander
        pairs.push({ a, b, perKm: (a.score + b.score) / chord });
    }
    pairs.sort((p, q) => p.perKm - q.perKm);
    // Among the cheap pairs (within riftCostSlack of the cheapest), take the one the plate is likeliest to break along: the
    // greatest stress across it for the strength of the ground it crosses (its cost per km). The stress is the plate's own
    // (step/plate-stress.js): the pull the rest of the plate must hold the far side back with, per 100 km of the cut — so a
    // narrow neck, carrying a big piece's pull on a short line, breaks before a broad body, and a thin strip along a coast,
    // with little pulling on it, stays on (no rule against ribbons: they are rarely pulled off). Where nothing pulls the
    // plate apart (a plume's rift, an overdue one), the stress floor riftStressFloor leaves the cheapest ground to break.
    // Only DISTINCT cuts count: the cheapest pairs are mostly the same two coast spots a cell apart, so a pair whose ends
    // both lie near an evaluated pair's ends is passed over. Pairs must have no overhangs (the path always advances along
    // its own line, or a promontory of one half would stick into the other and the halves would jam as they part).
    let chosen = null, chosenPath = null, bestValue = Infinity, chosenStress = 0, chosenShare = 0;
    const tried = [];
    for (const pair of pairs) {
        if (tried.length >= PAIRS_TRIED || (tried.length && pair.perKm > config.riftCostSlack * pairs[0].perKm)) break;
        const near = (p, q) => cellDistanceKm(xyz, p.c, q.c) < DISTINCT_CUT_KM;
        if (tried.some(t => (near(t.a, pair.a) && near(t.b, pair.b)) || (near(t.a, pair.b) && near(t.b, pair.a)))) continue;
        tried.push(pair);
        const path = [...trace(pair.a.c).slice(1).reverse(), junction, ...trace(pair.b.c).slice(1)];
        if (!isMonotone(mesh, path, config)) continue;
        const sides = sidesOf(mesh, crust, path, ctx.cells);
        if (!(sides.share > 0) || (needCratonsBothSides && !sides.cratonsBothSides)) continue;   // a rift divides cratons: each side keeps at least one (a plume may shear a craton-less piece off)
        const sigma = ctx.rho ? stressOnCut(mesh, ctx, sides.side, path) : 0;
        const value = pair.perKm / (Math.max(0, sigma) + config.riftStressFloor);
        if (value < bestValue) { bestValue = value; chosen = pair; chosenPath = path; chosenStress = sigma; chosenShare = sides.share; }
    }
    if (!chosen) return null;
    const arm1 = chosen.a, arm2 = chosen.b;
    const a1 = trace(arm1.c), a2 = trace(arm2.c);
    // The arms that FAIL are traced on a second, plain tree — one that gives old sutures no discount — so an
    // aulacogen strikes out across ordinary ground and leaves a NEW weak line behind it, instead of merely
    // re-tracing a line that was weak already (developer). Each one dies after riftFailedArmKm.
    const plain = cheapestPaths(mesh, crust, junction, c => strength(c) * grain(c));
    const plainTrace = end => { const out = []; for (let c = end; c >= 0; c = plain.from[c]) out.push(c); return out.reverse(); };
    const failedArm = [], taken = [arm1, arm2];
    const plainCoast = coast.filter(e => plain.cost[e.c] < Infinity).sort((p, q) => plain.cost[p.c] - plain.cost[q.c]);
    for (const e of plainCoast) {
        if (taken.length >= 2 + config.riftFailedArms) break;
        if (taken.some(t => apart(t, e) < ARM_SEPARATION_DEG)) continue;
        taken.push(e);
        const path = plainTrace(e.c);
        let km = 0;
        for (let i = 1; i < path.length && km < config.riftFailedArmKm; i++) { failedArm.push(path[i]); km += cellDistanceKm(xyz, path[i - 1], path[i]); }
    }
    const a3 = taken.length > 2 ? plainTrace(taken[2].c) : [];
    const ends = [chosenPath[0], chosenPath.at(-1)];
    // across = normal to the rift's great circle; value = cost per km × the elongation penalty, comparable between junctions
    return { path: chosenPath, failedArm, arms: [a1, a2, a3], across: normalize(cross(pos(xyz, ends[0]), pos(xyz, ends[1]))), value: bestValue, stress: chosenStress, share: chosenShare };
}

/**
 * The stress across a cut (step/plate-stress.js): on the side that would part (side 2), from its cells beside the path.
 * @returns {number} per 100 km of the cut — + tension (the far side pulls away), − compression
 */
function stressOnCut(mesh, ctx, side, path) {
    const onPath = new Uint8Array(mesh.numCells), far = [];
    for (const c of path) onPath[c] = 1;
    for (const c of ctx.cells) if (side[c] === 2) far.push(c);
    const inFar = side.map(s => (s === 2 ? 1 : 0));
    return stressAcross(ctx.rho, far, cutAlong(mesh, far, inFar, nb => onPath[nb]), mesh.xyz, mesh.edgeKm, ctx.mat);
}

/** Cheapest path from `junction` to every land cell, at `costOf` per cell. */
function cheapestPaths(mesh, crust, junction, costOf) {
    const { adjOffset, adjList, numCells, edgeKm } = mesh, edge = edgeKmOf(mesh);       // (edge[k]: cellDistanceKm along adjacency entry k)
    const cost = new Float64Array(numCells).fill(Infinity), from = new Int32Array(numCells).fill(-1);
    const land = c => crust.mask[c] && crust.type[c] !== CrustType.OCEAN;
    const heap = new MinHeap();
    cost[junction] = 0; heap.push(junction, 0);
    while (heap.size) {
        const c = heap.pop();
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (!land(nb)) continue;
            const next = cost[c] + costOf(nb) * edge[k] / edgeKm;
            if (next < cost[nb]) { cost[nb] = next; from[nb] = c; heap.push(nb, next); }
        }
    }
    return { cost, from };
}

/** Does the path always advance along the great circle from its first cell to its last (backsteps under a cell allowed)? */
function isMonotone(mesh, path, config) {
    const { xyz, edgeRad } = mesh, a = pos(xyz, path[0]), b = pos(xyz, path.at(-1)), m = normalize(cross(a, b));
    let last = -Infinity;
    for (const c of path) {
        const p = pos(xyz, c), k = dot(p, m), q = normalize([p[0] - k * m[0], p[1] - k * m[1], p[2] - k * m[2]]);   // onto the rift's plane
        const phi = Math.atan2(dot(cross(a, q), m), dot(a, q));                                                        // angle along the circle from a
        if (phi < last - Math.max(config.riftOverhangKm / PLANET_RADIUS_KM, edgeRad)) return false;
        last = Math.max(last, phi);
    }
    return true;
}

const RIFT_ARMS_APART_DEG = 135;   // the two rift arms leave it at least this far apart: the rift crosses the landmass
const ARM_SEPARATION_DEG = 60;     // the failed arm leaves the junction at least this far from both rift arms
const PAIRS_TRIED = 12;            // how many DISTINCT cuts (arm pairs) are tried for shape and share
const DISTINCT_CUT_KM = 500;       // two cuts whose ends both lie within this of each other are the same cut

class MinHeap {
    constructor() { this.keys = []; this.vals = []; }
    get size() { return this.keys.length; }
    push(key, val) {
        const k = this.keys, v = this.vals;
        k.push(key); v.push(val);
        for (let i = k.length - 1; i > 0;) { const p = (i - 1) >> 1; if (v[p] <= v[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
    }
    pop() {
        const k = this.keys, v = this.vals, top = k[0], lastK = k.pop(), lastV = v.pop();
        if (k.length) {
            k[0] = lastK; v[0] = lastV;
            for (let i = 0;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < k.length && v[l] < v[m]) m = l;
                if (r < k.length && v[r] < v[m]) m = r;
                if (m === i) break;
                [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m;
            }
        }
        return top;
    }
}

const pos = (xyz, c) => [xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]];
