// How people move over a finished moment (plans/CIV_PLAN.md §4.6): fronts that spread at so many km a year — the cheapest
// path in time, edge by edge, each edge's speed given by the caller (inland, along a coast or a big river, across water).
// Fisher–KPP's front speed v = 2√(rD) is what a population's wave of advance does over even ground; the edges scale it by
// the slope (Tobler's hiking function, relative to the flat) and by the land's capacity. The same graph will carry trade's
// costs in days (later phases).

import { MinHeap } from '../core/min-heap.js';
import { spreadKm } from '../core/min-heap.js';

const R = 6371;

/** Each adjacency's length, km (parallel to mesh.adjList). */
export function edgeLengths(mesh) {
    const { adjOffset, adjList, xyz, numCells: n } = mesh, e = new Float32Array(adjList.length);
    for (let c = 0; c < n; c++) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
        const nb = adjList[k], d = xyz[3 * c] * xyz[3 * nb] + xyz[3 * c + 1] * xyz[3 * nb + 1] + xyz[3 * c + 2] * xyz[3 * nb + 2];
        e[k] = Math.acos(Math.min(1, d)) * R;
    }
    return e;
}

/** Tobler's walking speed on slope S (rise over run), relative to the flat: 1 on level ground, ~0.5 at 20 %. */
export function toblerFactor(S) { return Math.exp(-3.5 * Math.abs(S + 0.05)) / Math.exp(-3.5 * 0.05); }

/**
 * Arrival times of fronts (years), the cheapest path in time: `arrival` pre-filled with the sources' start times and
 * Infinity elsewhere; `speed(a, b, k, t)` the km/yr from cell a to b along adjacency k when leaving a at time t (0: no way).
 * `opensAt(b, t)` (optional): the earliest time ≥ t that b can be entered — a front waits at a barrier (an ice sheet, the
 * cold) until it opens. Only improves `arrival` (so it can be run again from new sources). Stops past `untilT`.
 * `from` (optional, Int32Array): each cell's source — the cell the front reached it from, written as `arrival` improves
 * (sources keep theirs): who its people came from, so they can carry what they know and grow.
 * `sea` (optional): crossings on a travel graph (routes.js) — each water leg's days from the shore it left, for each month
 * it could have set out in; a leg goes on while its best month's days are within what the era allows, and waits for more
 * where they are not (seaGate).
 */
export function frontArrival(mesh, len, arrival, speed, sources = null, untilT = Infinity, opensAt = null, from = null, sea = null) {
    const { adjOffset, adjList } = mesh, heap = new MinHeap(4096), cand = new Float32Array(12), id = sea ? ++sea.id : 0;
    if (sources) for (const c of sources) heap.push(arrival[c], c);
    else for (let c = 0; c < arrival.length; c++) if (arrival[c] < Infinity) heap.push(arrival[c], c);
    while (heap.size) {
        const a = heap.pop(), t = heap.lastKey;
        if (t > arrival[a] || t > untilT) continue;
        const wa = sea ? sea.water(a) : false;
        if (wa && sea.stamp[a] !== id) continue;                                  // (out at sea from an earlier run: its leg is gone)
        for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
            const b = adjList[k], wb = sea ? sea.water(b) : false;
            let t0 = opensAt ? opensAt(b, t) : t;
            if (!(t0 < Infinity)) continue;
            if (wa || wb) {
                // (the leg's days by the month set out in, on to b; the best month's against the era's reach)
                const { days, E, legs } = sea;
                let best = Infinity;
                for (let m = 0; m < 12; m++) {
                    const x = (wa ? Math.min(legs[12 * a + m], sea.shore[12 * a + m]) : 0) + days[m * E + k];
                    cand[m] = x; if (x < best) best = x;
                }
                t0 = Math.max(t0, sea.opens(best, t0));
                if (!(t0 < Infinity)) continue;
            }
            const v = speed(a, b, k, t0);
            if (!(v > 0)) continue;
            const tb = t0 + len[k] / v;
            if (tb < arrival[b]) {
                arrival[b] = tb; if (from) from[b] = a; heap.push(tb, b);
                if (wb) { sea.legs.set(cand, 12 * b); sea.stamp[b] = id; }
            }
        }
    }
    return arrival;
}

/**
 * Cost-distance over land: `cost(a, b, k)` the cost of adjacency k from a to b (e.g. km, less along a river), `canEnter(b)`.
 * Returns reach(c0, budget) → [[cell, cost]] in order of cost (c0 first, at 0) — a bounded Dijkstra reusing its arrays.
 */
export function costReach(mesh, cost, canEnter) {
    const { adjOffset, adjList } = mesh, dist = new Float32Array(mesh.numCells).fill(Infinity), heap = new MinHeap(256);
    return (c0, budget) => {
        const out = [];
        dist[c0] = 0; heap.push(0, c0);
        while (heap.size) {
            const a = heap.pop(), t = heap.lastKey;
            if (t > dist[a]) continue;
            out.push([a, t]);
            for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
                const b = adjList[k];
                if (!canEnter(b)) continue;
                const tb = t + cost(a, b, k);
                if (tb <= budget && tb < dist[b]) { dist[b] = tb; heap.push(tb, b); }
            }
        }
        for (const [c] of out) dist[c] = Infinity;
        return out;
    };
}

/** Distance (km) from each water cell to the nearest land, through water (land 0): how far out a crossing goes. */
export function offshoreKm(mesh, isWater) {
    const d = new Float64Array(mesh.numCells).fill(Infinity);
    for (let c = 0; c < mesh.numCells; c++) if (!isWater(c)) d[c] = 0;
    spreadKm(mesh, d, { canEnter: (a, b) => isWater(b) });
    return d;
}

/**
 * A front's crossings on a travel graph (routes.js travelGraph): `water(c)`; `opens(days, t)`, the earliest time ≥ t a
 * crossing of so many days can be made (Infinity: never). For frontArrival's `sea`; one per graph, shared by its fronts
 * (a leg's days are kept only while the run that made it lasts). A leg counts the days away from land: by any shore —
 * land the front cannot settle too (under ice: its coasts' ice-free pockets) — it is at most the days in from there.
 * `mesh` for the shores.
 */
export function seaGate(graph, water, opens, mesh) {
    const n = mesh.numCells, { adjOffset, adjList } = mesh, { days, E } = graph, shore = new Float32Array(12 * n).fill(Infinity);
    for (let c = 0; c < n; c++) if (!water(c)) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
        const b = adjList[k];
        if (water(b)) for (let m = 0; m < 12; m++) if (days[m * E + k] < shore[12 * b + m]) shore[12 * b + m] = days[m * E + k];
    }
    return { days, E, water, opens, shore, legs: new Float32Array(12 * n), stamp: new Int32Array(n), id: 0 };
}

/** A piecewise-linear schedule [[x, y], …] (x descending, as years BP are) read at x. */
export function schedule(table, x) {
    if (x >= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) if (x >= table[i][0]) {
        const [x0, y0] = table[i - 1], [x1, y1] = table[i];
        return y1 + (y0 - y1) * (x - x1) / (x0 - x1);
    }
    return table[table.length - 1][1];
}
