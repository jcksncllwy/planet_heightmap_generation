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
        if (m.enclosed || !plate?.alive || !plate.crust.mask[m.cell] || plate.crust.type[m.cell] === CrustType.OCEAN) continue;
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
