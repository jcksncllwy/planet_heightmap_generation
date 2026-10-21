// The civ layer's towns (plans/CIV_PLAN.md §5.5, Phase 4): from a moment of the people (sim.js — each cell's density and
// way of life), where towns stand, how big they can grow and how they gather into polities.
//
//   size   a town is fed by its own fields (feedKm around it, fieldShare of them farmed, at its district's yields: rain-fed
//          or irrigated) and by the surplus of districts it can reach (importKm of land, a river's or a coast's km costing
//          far less) — and peopled by the share of its reach who leave the countryside for it (nucleation). The biggest
//          claim first: a primate city takes its rivals' surplus.
//   tiers  village · large village · town · city (CIV.tiers); a town within polityKm of a bigger one is its subordinate,
//          and a polity holding all three tiers above the village is a state (Wright & Johnson 1975).
//
// The same travel costs will carry trade (later phases). Scale-invariant: every reach is in km.

import { CIV } from './civ-config.js';
import { Life } from './sim.js';
import { MinHeap } from '../core/min-heap.js';
import { edgeLengths } from './travel.js';

const DEG = 180 / Math.PI;

/**
 * Towns and polities at one moment.
 * @param w    the world (sim.js's): mesh, ocean, lake
 * @param sub  civSubstrate(w)
 * @param density  persons/km² per cell (Float32Array)
 * @param life     each cell's way of life (sim.js Life)
 * @returns {{ towns: [{cell, lat, lon, pop, tier, irrigated, polity}], polities: [{capital, pop, towns, people, tiers, state}], urban }}
 */
export function settle(w, sub, density, life, C = CIV) {
    const { mesh, ocean, lake } = w, n = mesh.numCells, { adjOffset, adjList } = mesh, A = sub.cellKm2;
    const len = settle.len?.mesh === mesh ? settle.len.e : (settle.len = { mesh, e: edgeLengths(mesh) }).e;
    const land = c => !ocean[c] && !lake[c];
    const farming = c => life[c] >= Life.FARMER && density[c] > 0;
    const irrigated = c => life[c] === Life.IRRIGATOR;
    // ── the travel cost of each edge, in land km ──
    const coastal = c => sub.coastal[c] === 1;
    const navigable = c => sub.river.q[c] >= C.navigableM3s;
    const cost = (a, b, k) => len[k] * (navigable(a) && navigable(b) ? C.riverCostShare : coastal(a) && coastal(b) ? C.coastCostShare : 1);
    /** The cells within `budget` land km of c over land (farmed or not), with their costs: [[cell, cost]]. */
    const dist = new Float32Array(n).fill(Infinity), heap = new MinHeap(256);
    const reach = (c0, budget) => {
        const out = [];
        dist[c0] = 0; heap.push(0, c0);
        while (heap.size) {
            const a = heap.pop(), t = heap.lastKey;
            if (t > dist[a]) continue;
            out.push([a, t]);
            for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
                const b = adjList[k];
                if (!land(b)) continue;
                const tb = t + cost(a, b, k);
                if (tb <= budget && tb < dist[b]) { dist[b] = tb; heap.push(tb, b); }
            }
        }
        for (const [c] of out) dist[c] = Infinity;
        return out;
    };

    // ── each farmed district: its people, the surplus it can spare, the people who would move to a town ──
    const P = new Float64Array(n), surplus = new Float64Array(n), movers = new Float64Array(n), local = new Float64Array(n);
    const cands = [];
    const fieldsKm2 = Math.min(A, Math.PI * C.feedKm * C.feedKm) * C.fieldShare;
    for (let c = 0; c < n; c++) {
        if (!land(c) || !farming(c)) continue;
        const irr = irrigated(c) ? 1 : 0, share = irr ? sub.irrigShare[c] : 0;
        P[c] = density[c] * A;
        // (its fields' yield as its farmers' density shows it — the canals grow over centuries (sim.js), and a district's
        // density grows with them — at most what its land yields fully worked: irrigated where the canals reach)
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
    const towns = [], townOf = new Int32Array(n).fill(-1);
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
        for (const [j, f] of takes) surplus[j] -= surplus[j] * f * shareFood;
        for (const [j, t] of r) movers[j] -= movers[j] * (1 - t / C.importKm) * sharePeople;
        townOf[c] = towns.length;
        const x = mesh.xyz[3 * c], y = mesh.xyz[3 * c + 1], z = mesh.xyz[3 * c + 2];
        towns.push({ cell: c, lat: +(Math.asin(z) * DEG).toFixed(2), lon: +(Math.atan2(y, x) * DEG).toFixed(2), pop: Math.round(pop),
            tier: C.tiers.reduce((k, v, i) => (pop >= v ? i : k), 0), irrigated: irrigated(c), polity: -1, over: -1 });
    }
    // ── polities: each town under the nearest bigger town within polityKm; the top of each chain its capital ──
    towns.sort((a, b) => b.pop - a.pop);
    towns.forEach((t, i) => { townOf[t.cell] = i; });
    for (let i = 0; i < towns.length; i++) {
        for (const [j] of reach(towns[i].cell, C.polityKm)) {
            const o = townOf[j];
            if (o >= 0 && o < i) { towns[i].over = o; break; }
        }
    }
    const polities = [];
    for (let i = 0; i < towns.length; i++) {
        let top = i;
        while (towns[top].over >= 0) top = towns[top].over;
        if (top === i) { towns[i].polity = polities.length; polities.push({ capital: i, pop: towns[i].pop, towns: 0, people: 0, tiers: new Set() }); }
        else towns[i].polity = towns[top].polity;
        const p = polities[towns[i].polity];
        p.towns++; p.people += towns[i].pop; p.tiers.add(towns[i].tier);
    }
    for (const p of polities) { p.state = [1, 2, 3].every(k => p.tiers.has(k)); p.tiers = [...p.tiers].sort(); }
    let urban = 0;
    for (const t of towns) urban += t.pop;
    for (const t of towns) delete t.over;
    return { towns, polities, urban };
}
