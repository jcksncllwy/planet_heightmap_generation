// Retro-arc shortening, paid in area (lane beltthick; config.andeanShorteningShare, 0 = off; Jackson's ruling 4 as amended
// 2026-11-11: Andean thickening is arc magmatism PLUS the upper plate's own crust shortened). An Andean margin's crust thickens
// mostly because the plate behind it is squeezed against the trench, not because magma is added: the Central Andes' 65–70 km
// crust is mostly shortened crust (Isacks 1988, JGR 93; Allmendinger et al. 1997, Annu. Rev. Earth Planet. Sci. 25), shortening
// accounting for up to ~70–80 % of the crust's cross-section (Kley & Monaldi 1998, Geology 26 — a maximum, the rest magmatic
// addition, lower-crustal flow along the orogen and pre-Neogene shortening; Hindle et al. 2005).
//
// The rate: what moves the upper plate toward its trench faster than the trench itself retreats, Vd + Vt = Vup (Heuret &
// Lallemand 2005, PEPI 149): an upper plate driven trenchward over a slab anchored in the mantle shortens; one moving away
// extends (the back-arc basins, step/backarc.js). Oncken et al. 2006 (The Andes, Springer) find the Central Andes' shortening
// rate follows that velocity difference and not the convergence rate. This rigid-plate model has no trench motion of its own
// (the trench rides the plate's edge), so the split is one share, Vd = andeanShorteningShare × Vup, Vup the upper plate's
// velocity toward the trench in the world frame (the mantle's: the torque balance's drag is against it). The share is derived
// in config.js.
//
// The geometry (a reduced model, its limits): in a rigid raster the shortened width can only come off the plate's edge, so
// each closing overriding front's due area is taken from the continent nearest it (the fore-arc, as subduction erosion takes
// it), which turns to the trench's apron: the coast steps toward the interior by the shortening, as the Andean margin did
// against the craton behind it. The crust it held is laid as root over the margin's own Andean/Laramide belt within the
// belt's reach of where it was taken, in the belt's plateau profile (1 − u²: ops/thicken.js layProfile, as keepConsumed lays a
// collision's), each cell to the thickest root (underthrustMaxThickKm), the rest ring by ring from the front. All of it is
// kept: this is the plate's own crust folded, not crust sent down (delamination and subduction erosion are not this stage's).
// Not modelled: where along the belt the shortening concentrates (thin-skinned foreland belts vs the thick-skinned core), the
// Bolivian orocline's along-strike flow (Hindle et al. 2005), any time lag between the plate's push and the belt's response.
// Cratons never shorten (too strong: Lenardic & Moresi 1999); island arcs keep their own crust model (step/arcs.js).

import { CrustType, CrustFlag, OrogenyType } from '../model/crust.js';
import { BoundaryKind } from '../model/world.js';
import { PLANET_RADIUS_KM } from '../../core/sim-mesh.js';
import { tangentToward } from '../../core/sphere-geom.js';
import { surfaceVelocity } from './kinematics.js';
import { columnModel } from '../measure.js';
import { heightsOf } from './heights.js';
import { crustOf, layProfile, layThickening, landDistanceKm } from '../ops/thicken.js';
import { cellRockKm3 } from './crust-ledger.js';
import { bookRock } from '../rock-book.js';

/** @returns {number} continental cells shortened away this step (the area the belts behind them thicken by) */
export function shortenMargins(world, dt) {
    const { mesh, plates, owner, ownerCell, boundaryKind, convergence, config, time } = world;
    const share = config.andeanShorteningShare;
    if (!(share > 0) || dt <= 0) return 0;
    const { adjOffset, adjList, xyz, edgeKm, cellAreaKm2 } = mesh;
    const hops = Math.max(1, Math.round(config.subductionErosionReachKm / edgeKm)), v = [0, 0, 0];
    const due = new Map();                                    // plate id → { cells: owed, at: Map(raster cell → its share) }
    for (let w = 0; w < owner.length; w++) {
        if (boundaryKind[w] !== BoundaryKind.OVERRIDING || !(convergence[w] > 0)) continue;
        const id = owner[w];
        if (id < 0) continue;
        // the trench's side: a neighbour across the boundary (the plate going down)
        let across = -1;
        for (let k = adjOffset[w]; k < adjOffset[w + 1] && across < 0; k++) { const nb = adjList[k]; if (owner[nb] >= 0 && owner[nb] !== id) across = nb; }
        if (across < 0) continue;
        const p = [xyz[3 * w], xyz[3 * w + 1], xyz[3 * w + 2]], q = [xyz[3 * across], xyz[3 * across + 1], xyz[3 * across + 2]];
        surfaceVelocity(plates[id].omega, p[0], p[1], p[2], v);
        const t = tangentToward(p, p, q), vup = PLANET_RADIUS_KM * (v[0] * t[0] + v[1] * t[1] + v[2] * t[2]);   // km/Myr toward the trench
        if (!(vup > 0)) continue;
        // the nearest ring of ordinary continent within the fore-arc's reach (as subduction erosion finds it)
        const crust = plates[id].crust, { mask, type } = crust;
        let ring = [ownerCell[w]], seen = new Set(ring), hit = [];
        for (let h = 0; h <= hops && ring.length; h++) {
            for (const c of ring) if (type[c] === CrustType.CONTINENT) hit.push(c);
            if (hit.length || h === hops) break;
            const next = [];
            for (const c of ring) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (mask[nb] && !seen.has(nb)) { seen.add(nb); next.push(nb); } }
            ring = next;
        }
        if (!hit.length) continue;
        let d = due.get(id);
        if (!d) due.set(id, d = { cells: 0, at: new Map() });
        d.cells += share * vup * dt * edgeKm / cellAreaKm2;                     // (Vd × dt × a cell's width of front, in cells)
        for (const c of hit) d.at.set(c, (d.at.get(c) ?? 0) + 1 / hit.length);
    }
    const C = columnModel(heightsOf(config)), B = config.belts, reach = Math.max(B.andean.maxKm, B.laramide.maxKm) * config.beltSpeedFactorMax;
    let shortened = 0;
    for (const plate of plates) {
        if (!plate.alive) continue;
        const d = due.get(plate.id);
        // (a fraction of a cell carries to the next step while the margin keeps closing; a margin that stops forgets it)
        if (!d) { plate.shortenDue = 0; continue; }
        const owed = (plate.shortenDue ?? 0) + d.cells, crust = plate.crust, { mask, type, rootKm, formedAt } = crust;
        // the most-pressed front cells first (their share of the fronts; ties by index: deterministic)
        const order = [...d.at.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(e => e[0]);
        const take = Math.min(order.length, Math.floor(owed));
        plate.shortenDue = Math.min(owed - take, 1);
        if (!take) continue;
        let volKm = 0, rock = 0, taken = 0;
        const seeds = [];
        for (let i = 0; i < take; i++) {
            const c = order[i];
            if (!mask[c] || type[c] !== CrustType.CONTINENT) continue;
            volKm += crustOf(crust, c, C);
            rock -= cellRockKm3(world, crust, c);
            // (its place goes to the trench's apron, dated as the sea beside it)
            let at = time;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (mask[nb] && type[nb] === CrustType.OCEAN && formedAt[nb] >= 0) at = Math.min(at, formedAt[nb]);
                else if (mask[nb] && type[nb] !== CrustType.OCEAN) seeds.push(nb);
            }
            crust.create(c, CrustType.OCEAN, at);
            crust.flags[c] = CrustFlag.APRON;
            rock += cellRockKm3(world, crust, c);
            shortened++; taken++;
        }
        if (!(volKm > 0)) continue;
        // laid over this margin's Andean/Laramide belt within its reach of where the crust was taken (1 − u²), the rest from the front
        const live = seeds.filter(c => mask[c] && type[c] !== CrustType.OCEAN), near = landDistanceKm(mesh, plate, live, reach), belt = [], weights = [];
        for (let c = 0; c < mask.length; c++) {
            if (!mask[c] || type[c] !== CrustType.CONTINENT || !(near[c] <= crust.beltReach[c])) continue;
            if (crust.oroType[c] !== OrogenyType.ANDEAN && crust.oroType[c] !== OrogenyType.LARAMIDE) continue;
            belt.push(c); weights.push(1 - Math.min(1, crust.beltU[c]) ** 2);
        }
        const rest = layProfile(plate, belt, weights, volKm, config.underthrustMaxThickKm);
        const left = layThickening(plate, mesh, live, rest, config.underthrustMaxThickKm);
        bookRock('shortenedKm3', rock);                                         // (the rock taken off the edge, < 0)
        bookRock('shortenKeptKm3', (volKm - left) * cellAreaKm2);               // (laid back as root; what found no room is lost)
        world.budget.andeanShortenedCells = (world.budget.andeanShortenedCells ?? 0) + taken;
        world.budget.andeanShortenKeptKm3 = (world.budget.andeanShortenKeptKm3 ?? 0) + (volKm - left) * cellAreaKm2;
        world.budget.andeanShortenUnplacedKm3 = (world.budget.andeanShortenUnplacedKm3 ?? 0) + left * cellAreaKm2;
        plate.markReshaped();
        plate.dirty = true;
    }
    return shortened;
}
