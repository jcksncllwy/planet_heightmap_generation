// The civ layer's towns (plans/CIV_PLAN.md §5.5, Phase 4; sources: plans/CIV_SOURCES.md): from a moment of the people
// (sim.js — each cell's density and way of life), where towns stand and how big they can grow. A town is fed by its own
// fields (feedKm around it, fieldShare of them farmed, at the yield its district's density shows: rain-fed, or irrigated as
// far as its canals have come) and by the surplus of districts it can reach (importKm of land, a river's or a coast's km
// costing far less) — and peopled by the share of its reach who leave the countryside for it (nucleation). The biggest
// claim first: a primate city takes its rivals' surplus. Polities over the towns: polity.js.
//
// Scale-invariant: every reach is in km.

import { CIV } from './civ-config.js';
import { Life } from './sim.js';
import { edgeLengths, costReach } from './travel.js';

const DEG = 180 / Math.PI;

/** The travel network the towns, their supply and their polities share: each edge's cost in land km, a bounded reach. */
export function townNetwork(w, sub, C = CIV) {
    const { mesh, ocean, lake } = w, len = edgeLengths(mesh);
    const land = c => !ocean[c] && !lake[c];
    const navigable = c => sub.river.q[c] >= C.navigableM3s, coastal = c => sub.coastal[c] === 1;
    const cost = (a, b, k) => len[k] * (navigable(a) && navigable(b) ? C.riverCostShare : coastal(a) && coastal(b) ? C.coastCostShare : 1);
    return { land, cost, reach: costReach(mesh, cost, land) };
}

/** The tier of a settlement of `pop` people (CIV.tiers: 0 village … 3 city). */
export const tierOf = (pop, C = CIV) => C.tiers.reduce((k, v, i) => (pop >= v ? i : k), 0);

/**
 * The towns at one moment, biggest first.
 * @param density  persons/km² per cell (Float32Array)
 * @param life     each cell's way of life (sim.js Life)
 * @param net      townNetwork(w, sub) (made once per world)
 * @returns [{cell, lat, lon, pop, tier, irrigated (its own district), canalFed (most of its food grown on irrigated land)}]
 */
export function towns(w, sub, density, life, net, C = CIV) {
    const { mesh } = w, n = mesh.numCells, A = sub.cellKm2, { land, reach } = net;
    const irrigated = c => life[c] === Life.IRRIGATOR;
    // ── each farmed district: its people, the surplus it can spare, the people who would move to a town ──
    const P = new Float64Array(n), surplus = new Float64Array(n), movers = new Float64Array(n), local = new Float64Array(n);
    const cands = [];
    const fieldsKm2 = Math.min(A, Math.PI * C.feedKm * C.feedKm) * C.fieldShare;
    for (let c = 0; c < n; c++) {
        if (!land(c) || life[c] < Life.FARMER || !(density[c] > 0)) continue;
        const irr = irrigated(c) ? 1 : 0, share = irr ? sub.irrigShare[c] : 0;
        P[c] = density[c] * A;
        // (its fields' yield as its farmers' density shows it — the canals grow over centuries (sim.js), and a district's
        // density with them — at most what its land yields fully worked: irrigated where the canals reach)
        const farmed = share * C.alluviumShare + (1 - share) * C.cultivatedShare;
        const full = share * sub.farmWet[c] + (1 - share) * sub.farmDry[c], perKm2 = Math.min(full, density[c] / farmed);
        local[c] = fieldsKm2 * perKm2;
        // (how far its irrigation has come: its yield over the most it can be; the countryside empties into the towns as
        // the canals — and the conflict over them — grow)
        const intensity = irr && full > sub.farmDry[c] ? Math.min(1, Math.max(0, (perKm2 - sub.farmDry[c]) / (full - sub.farmDry[c]))) : 0;
        surplus[c] = (C.surplusShare[0] + (C.surplusShare[1] - C.surplusShare[0]) * intensity) * P[c];
        movers[c] = (C.nucleation[0] + (C.nucleation[1] - C.nucleation[0]) * intensity * intensity) * P[c];
        cands.push(c);
    }
    // ── the towns, the biggest claim first ──
    cands.sort((a, b) => local[b] + surplus[b] - (local[a] + surplus[a]));
    const out = [];
    for (const c of cands) {
        if (movers[c] <= 0) continue;
        const r = reach(c, C.importKm);
        // food: its own fields, and the surplus brought in (less the further it comes); people: those who can move there
        let food = local[c], people = 0;
        const takes = [];
        for (const [j, t] of r) {
            if (!(P[j] > 0)) continue;
            const f = 1 - t / C.importKm;
            if (j !== c) { food += surplus[j] * f; takes.push([j, f]); }
            people += movers[j] * f;
        }
        const pop = Math.min(food, people);
        if (pop < C.townMin) continue;
        // (what it takes is no longer there for the next: in proportion, from each district it reached)
        const shareFood = food > local[c] ? Math.max(0, pop - local[c]) / (food - local[c]) : 0, sharePeople = pop / people;
        // (and how much of what it eats was grown on irrigated land: its own fields, or grain brought from canals — a town
        // beside an irrigated plain, or a port it ships to, lives on the canals though its own district is rain-fed)
        let fromCanals = irrigated(c) ? Math.min(local[c], pop) : 0;
        for (const [j, f] of takes) { if (irrigated(j)) fromCanals += surplus[j] * f * shareFood; surplus[j] -= surplus[j] * f * shareFood; }
        for (const [j, t] of r) movers[j] -= movers[j] * (1 - t / C.importKm) * sharePeople;
        const x = mesh.xyz[3 * c], y = mesh.xyz[3 * c + 1], z = mesh.xyz[3 * c + 2];
        out.push({ cell: c, lat: +(Math.asin(z) * DEG).toFixed(2), lon: +(Math.atan2(y, x) * DEG).toFixed(2), pop: Math.round(pop),
            tier: tierOf(pop, C), irrigated: irrigated(c), canalFed: fromCanals > pop / 2 });
    }
    return out.sort((a, b) => b.pop - a.pop);
}
