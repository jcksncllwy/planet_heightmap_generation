// Submarine fans: how a river's rock reaches a trench (crust-sink branch). A trench's terrigenous fill is not only the
// land behind its own coast: whole drainage basins feed it, and turbidity currents carry their rock a long way across
// the ocean floor and then along the trench's own axis. The Ganges and Brahmaputra build the Bengal–Nicobar fan ~3000 km
// out to the Sumatra–Andaman trench (Curray et al. 2003); the Orinoco and the Amazon feed the Barbados prism; the Indus
// feeds the Makran; the Chile trench is filled from its glacial south far north along an axial channel (Völker et al.
// 2013). That supply is why thick-fill trenches build prisms and fore-arc islands, and why sediment subduction is about
// a third of the continents' losses at trenches (Scholl & von Huene 2009).
//
// Here: every river mouth (step/rivers.js world.riverMouths — each basin's rock, km³/Myr) sends its rock down the
// ocean floor to the nearest overriding trench it can reach across the sea within trenchFanReachKm — over ocean only:
// land in between stops it — and the trench spreads what lands on it along its axis, e-folding over
// trenchAxialTransportKm. A trench's supply per km is what it receives over its length; its fill stands at supply ÷
// convergence (step/margin-isles.js trenchSediment). A mouth with no trench in reach keeps its rock on its own margin
// (shelf, rise and abyssal plain: no crust is lost or made). Built once a step, on first use, for the stages after.

import { CrustType, CrustFlag } from '../model/crust.js';
import { BoundaryKind } from '../model/world.js';
import { hopsFrom } from '../../core/mesh-bfs.js';
import { seaDepthKm, SEDIMENT_LOAD_FACTOR } from '../measure.js';
import { brimKm3 } from './floor-rock.js';

/**
 * The trenches' supply this step: per world cell of an overriding trench, km³/Myr per km of trench (`supply`); and per
 * river mouth that reaches a trench, the trench cells its rock is spread over, with their weights (`deliveries`).
 * @returns {{supply: Float32Array, deliveries: {mouth: object, cells: number[], weights: Float64Array}[]}}
 */
export function trenchFans(world) {
    if (world.fans?.step === world.step) return world.fans;
    const { mesh, plates, owner, ownerCell, boundaryKind, config } = world, { xyz, index, adjOffset, adjList, edgeKm, numCells: n } = mesh;
    const supply = new Float32Array(n), deliveries = [];
    world.fans = { step: world.step, supply, deliveries };
    const mouths = world.riverMouths;
    if (!mouths?.length) return world.fans;
    // the overriding trenches, as the world view shows them: a plate's ocean TRENCH crust on an OVERRIDING boundary
    const isTrench = new Uint8Array(n), trench = [], P = [0, 0, 0];
    for (let w = 0; w < n; w++) {
        const o = owner[w];
        if (o < 0 || boundaryKind[w] !== BoundaryKind.OVERRIDING) continue;
        const crust = plates[o].crust, c = ownerCell[w];
        if (crust.type[c] === CrustType.OCEAN && (crust.flags[c] & CrustFlag.TRENCH)) { isTrench[w] = 1; trench.push(w); }
    }
    if (!trench.length) return world.fans;
    // the fans: from every trench out over the ocean floor, to trenchFanReachKm (the nearest trench wins)
    const isSea = w => owner[w] < 0 || plates[owner[w]].crust.type[ownerCell[w]] === CrustType.OCEAN;
    const fan = hopsFrom(mesh, trench, isSea, Math.max(1, Math.round(config.trenchFanReachKm / edgeKm)));
    // each mouth's rock lands on its nearest trench — through the sea beside its mouth
    const landed = new Map();          // trench cell → the mouths landing there
    for (const m of mouths) {
        const plate = plates[m.plate];
        // (a mouth on a filled sea's plain — ocean crust under it, land to the rivers since branch unified-swell — sends its
        // rock on as a coast's does)
        if (m.enclosed || !plate?.alive || !plate.crust.mask[m.cell] || (plate.crust.type[m.cell] === CrustType.OCEAN && !(plate.crust.seaFillKm[m.cell] > 0))) continue;
        plate.toWorld(xyz[3 * m.cell], xyz[3 * m.cell + 1], xyz[3 * m.cell + 2], P);
        const w = index.nearest(P[0], P[1], P[2]);
        let best = -1, bestD = Infinity;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) { const nb = adjList[k]; if (fan.dist[nb] >= 0 && fan.dist[nb] < bestD) { bestD = fan.dist[nb]; best = fan.source[nb]; } }
        if (best < 0) continue;
        if (!landed.has(best)) landed.set(best, []);
        landed.get(best).push(m);
    }
    // …and spreads along the trench's axis, e-folding over trenchAxialTransportKm (out to three of them)
    const L = config.trenchAxialTransportKm, seen = new Int32Array(n), maxHops = Math.max(1, Math.round(3 * L / edgeKm));
    for (const [t0, list] of landed) {
        const cells = [t0], hops = [0];
        seen[t0] = t0 + 1;
        for (let i = 0; i < cells.length; i++) {
            if (hops[i] >= maxHops) continue;
            for (let k = adjOffset[cells[i]]; k < adjOffset[cells[i] + 1]; k++) {
                const nb = adjList[k];
                if (isTrench[nb] && seen[nb] !== t0 + 1) { seen[nb] = t0 + 1; cells.push(nb); hops.push(hops[i] + 1); }
            }
        }
        const weights = Float64Array.from(hops, h => Math.exp(-h * edgeKm / L));
        const sum = weights.reduce((a, b) => a + b, 0);
        for (let i = 0; i < weights.length; i++) weights[i] /= sum;
        let km3 = 0;
        for (const m of list) { km3 += m.km3; deliveries.push({ mouth: m, cells, weights }); }
        for (let i = 0; i < cells.length; i++) supply[cells[i]] += km3 * weights[i] / edgeKm;
    }
    return world.fans;
}

/**
 * Book where each open river mouth's rock went this span of `dt` Myr. A mouth whose rock reaches a trench feeds its fan
 * (world.budget.fanKm3; there sediment subduction and the prism share it — the books only: nothing is moved); one with no
 * trench in reach lays it past its shelf, on the slope, rise and abyssal plain of its own margin (world.budget.riseKm3:
 * rock on ocean crust, not continental crust — Cogley 1984 takes the continent to the foot of the slope), and that rock is
 * laid as a record on the ocean floor it lands on (layRise): it rides its plate until the floor is subducted
 * (step/resolve.js books its fate) — the Atlantic's rises are the trenches' fill of a future ocean's closing. Called after
 * the stages that read the fans, so it never builds them earlier than they were. Mouths on an enclosed sea are
 * step/sea-fill.js's.
 */
export function bookFans(world, dt) {
    const mouths = world.riverMouths;
    if (!mouths?.length || !(dt > 0)) return;
    const { deliveries } = trenchFans(world), fed = new Set(deliveries.map(d => d.mouth)), B = world.budget;
    let fan = 0, rise = 0, lost = 0, over = 0;
    for (const m of mouths) {
        if (m.enclosed || !(m.km3 > 0)) continue;
        if (fed.has(m)) { fan += m.km3 * dt; continue; }
        const left = layRise(world, m, m.km3 * dt);
        if (left < 0) { rise += m.km3 * dt; lost += m.km3 * dt; } else { rise += m.km3 * dt - left; over += left; }
    }
    B.fanKm3 = (B.fanKm3 ?? 0) + fan;
    B.riseKm3 = (B.riseKm3 ?? 0) + rise;
    B.seaOverflowKm3 = (B.seaOverflowKm3 ?? 0) + over;   // (a sea floor filled to its brim all the way round: step/sea-fill.js's fate)
    B.riseUnlaidKm3 = (B.riseUnlaidKm3 ?? 0) + lost;   // (a mouth whose plate or crust is gone, or with no open ocean floor beside it)
}

/**
 * Lay `km3` of a mouth's rock on the ocean floor off its coast (crust.riseKm3), where turbidity currents and slumps take
 * it: down the slope to the rise and on to the abyssal plain, filling the room under a graded surface nearest first
 * (fill and spill). A margin's sediment does not pile up at its mouth: it builds out to a profile it cannot stand above —
 * the slope's ~3°, then the rise at ~1:250, then the abyssal plain levelled to ~1:1000 (config.riseProfile) — and what
 * finds no room there runs on, beyond (Heezen, Tharp & Ewing 1959; Emery 1980; the Amazon and Mississippi fans out to
 * 700–1000 km and more). Each cell holds what fills its water down to that surface, Airy-loaded (measure.js
 * SEDIMENT_LOAD_FACTOR, compacted fill 2.5 g/cm³): a 5.7 km deep floor under a 2.8 km deep surface takes ~8 km of rock.
 * The floor sinks with its age (measure.js seaDepthKm), so an old margin's rise has room for more. The walk runs out from
 * the mouth across the ocean floor (over a drowned shelf or a cape near the mouth, within riseProfile.coastKm) to the
 * turbidites' reach, trenchFanReachKm; rock the whole reach has no room for (an over-supplied margin, which would prograde
 * its shelf) fills what it reached up toward the sea's surface, each cell a like share of its room; a reach filled to that
 * brim spills on past it over the ocean floor, nearest first, each cell to its brim (rock stands above no sea); and a sea
 * whose every reachable floor is at its brim (one closed by land, its rivers' plain) sends the rest on as an enclosed sea's
 * overflow (step/sea-fill.js, world.budget.seaOverflowKm3). None is lost unbooked and no cell is capped; floor merged
 * under another plate's spills the same way (step/floor-rock.js).
 * Limits (reduced physics): the profile is measured as the crow flies from the mouth, not along the channels; a cell is
 * one column (no wedge inside it); the abyssal plain does not seek the deepest floor first; compaction is the load
 * factor's one compacted density, not a porosity–depth law; the floor's depth is its age's (no swell). The terrain's rise
 * is still the analytic one in terrain/margins.js. @returns {number} the km³ it sent on as overflow, or −1 when
 * it found no floor to land on
 */
function layRise(world, m, km3) {
    const { mesh, plates, owner, ownerCell, config } = world, { xyz, index, adjOffset, adjList, numCells: n } = mesh;
    const A = mesh.cellAreaKm2, R = config.riseProfile, reach = config.trenchFanReachKm, now = world.time;
    // (where the mouth is now, if its crust is still there: the rivers drain on a clock of their own, and their mouths' plates
    // can merge or break before the books close; else the sea cell beside it when they drained)
    const plate = plates[m.plate], P = riseScratch.P;
    let w0 = -1;
    if (plate?.alive && plate.crust.mask[m.cell]) { plate.toWorld(xyz[3 * m.cell], xyz[3 * m.cell + 1], xyz[3 * m.cell + 2], P); w0 = index.nearest(P[0], P[1], P[2]); }
    else if (m.sea >= 0) { P[0] = xyz[3 * m.sea]; P[1] = xyz[3 * m.sea + 1]; P[2] = xyz[3 * m.sea + 2]; }
    else return -1;
    const pr = Math.hypot(P[0], P[1], P[2]);
    const kmFrom = w => 6371 * Math.acos(Math.max(-1, Math.min(1, (xyz[3 * w] * P[0] + xyz[3 * w + 1] * P[1] + xyz[3 * w + 2] * P[2]) / (pr * Math.hypot(xyz[3 * w], xyz[3 * w + 1], xyz[3 * w + 2])))));
    const floor = w => owner[w] >= 0 && plates[owner[w]].crust.type[ownerCell[w]] === CrustType.OCEAN;
    if (riseScratch.seen?.length !== n) { riseScratch.seen = new Int32Array(n); riseScratch.tick = 0; }
    const seen = riseScratch.seen, tick = ++riseScratch.tick, ring = riseScratch.ring, cells = riseScratch.cells;
    ring.length = 0; cells.length = 0;
    const start = [w0, m.sea];
    if (w0 >= 0) for (let k = adjOffset[w0]; k < adjOffset[w0 + 1]; k++) start.push(adjList[k]);
    for (const w of start) if (w >= 0 && seen[w] !== tick) { seen[w] = tick; ring.push(w); }
    let left = km3;
    for (let i = 0; i < ring.length && left > 0; i++) {
        const w = ring[i], d = kmFrom(w), sea = floor(w);
        if (sea) {
            cells.push(w);
            const k = plates[owner[w]].crust, c = ownerCell[w];
            const room = SEDIMENT_LOAD_FACTOR * (seaDepthKm(now - k.formedAt[c]) - graded(R, d - R.shelfKm)) * A - (k.riseKm3[c] + k.seaFillKm[c] * A);
            if (room > 0) { const v = Math.min(room, left); k.riseKm3[c] += v; left -= v; }
        }
        if (d >= reach || (!sea && d >= R.coastKm)) continue;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) { const nb = adjList[k]; if (seen[nb] !== tick) { seen[nb] = tick; ring.push(nb); } }
    }
    if (!cells.length) return -1;
    if (left > 0) {
        // (the reach is at grade: the margin builds up toward the sea's surface — each cell takes a like share of the room
        // left between it and the surface…)
        world.riseOverKm3 = (world.riseOverKm3 ?? 0) + left;
        let roomAll = 0;
        const brim = cells.map(w => { const k = plates[owner[w]].crust, c = ownerCell[w]; const r = Math.max(0, brimKm3(world, k, c) - (k.riseKm3[c] + k.seaFillKm[c] * A)); roomAll += r; return r; });
        const f = roomAll > 0 ? Math.min(1, left / roomAll) : 0;
        for (let i = 0; i < cells.length; i++) plates[owner[cells[i]]].crust.riseKm3[ownerCell[cells[i]]] += f * brim[i];
        left -= f * roomAll;
    }
    if (left > 0) {
        // (…and a reach filled to its brim spills on past it, over the ocean floor only, each cell filled to its brim nearest
        // first: rock stands above no sea)
        const tick2 = ++riseScratch.tick, on = riseScratch.on;
        on.length = 0;
        for (const w of cells) { seen[w] = tick2; on.push(w); }
        for (let i = 0; i < on.length && left > 0; i++) {
            const w = on[i];
            if (i >= cells.length) {
                const k = plates[owner[w]].crust, c = ownerCell[w], room = brimKm3(world, k, c) - (k.riseKm3[c] + k.seaFillKm[c] * A);
                if (room > 0) { const v = Math.min(room, left); k.riseKm3[c] += v; left -= v; }
            }
            for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) { const nb = adjList[k]; if (seen[nb] !== tick2 && floor(nb)) { seen[nb] = tick2; on.push(nb); } }
        }
        // (…and a sea whose every reachable floor is filled to the brim — a sea closed by land that its rivers have made a
        // plain — sends the rest on as an enclosed sea's overflow does, step/sea-fill.js: world.budget.seaOverflowKm3)
    }
    return Math.max(0, left);
}
/** The depth (km) of the surface a margin's sediment grades to, `x` km seaward of its shelf break: the slope, the rise,
 * the abyssal plain (config.riseProfile), each the gentler continuation of the last. */
function graded(R, x) {
    x = Math.max(0, x);
    const xFoot = (R.footKm - R.breakKm) / R.slope;
    if (x <= xFoot) return R.breakKm + R.slope * x;
    const xToe = xFoot + (R.toeKm - R.footKm) / R.rise;
    return x <= xToe ? R.footKm + R.rise * (x - xFoot) : R.toeKm + R.plain * (x - xToe);
}
const riseScratch = { P: [0, 0, 0], seen: null, tick: 0, ring: [], cells: [], on: [] };
