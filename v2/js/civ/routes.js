// The travel graph (plans/CIV_PLAN.md §10.1; sources: plans/CIV_SOURCES.md): every edge of the mesh a cost in days for a
// loaded traveller, for each month and each craft. Directional — down a river or down the wind is not up it. On land, a
// day's walk scaled by the slope (Tobler); on a navigable river, boats down with the current and towed up it; on lakes
// and the sea, a boat's speed through the water — paddled, or under sail by the wind's angle to its course (tacking
// where it must) — plus the current along its course. The winds and currents are the planet's own, by month (the finish's
// climate: `w.flow`); without them, calm.
//
// Nothing reads it yet but the page's travel-time view (T0); the fronts, voyages, towns and trade will (T1–T4).

import { CIV } from './civ-config.js';
import { edgeLengths, toblerFactor } from './travel.js';
import { MinHeap } from '../core/min-heap.js';

const DEG = 180 / Math.PI;

/** The crafts, in order of their coming (Craft.FOOT: no boats — lakes and the sea closed). */
export const Craft = Object.freeze({ FOOT: 0, PADDLE: 1, SAIL: 2 });
export const CRAFT_NAMES = ['on foot', 'paddled boats', 'sail'];

/** A field on the climate's lat–lon grid (w × h, rows from the north), bilinear at (lat, lon) degrees. */
function sampleGrid(w, h, field, o, lat, lon) {
    const step = 180 / h, x = (lon + 180) / step - 0.5, y = Math.max(0, Math.min(h - 1, (90 - lat) / step - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i0 = ((x0 % w) + w) % w, i1 = i0 + 1 === w ? 0 : i0 + 1, j1 = y0 + 1 < h ? y0 + 1 : y0;
    return (1 - fx) * (1 - fy) * field[o + y0 * w + i0] + fx * (1 - fy) * field[o + y0 * w + i1] + (1 - fx) * fy * field[o + j1 * w + i0] + fx * fy * field[o + j1 * w + i1];
}

/** A course's speed through the water under sail, as a share of the full speed: toward a heading at angle `a` (radians)
 *  from dead astern — best on a reach, none closer than sailNoGo to the wind; toward a heading in the no-go, the best of
 *  the courses' speeds made good (tacking). */
function sailShare(a, C) {
    const lim = Math.PI - C.sailNoGo * Math.PI / 180, polar = b => (b > lim ? 0 : C.sailRun + (1 - C.sailRun) * Math.sin(b));
    a = Math.abs(((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);   // (0 … π)
    if (a <= lim) return polar(a);
    let best = 0;
    for (let k = 0; k <= 16; k++) { const b = lim * k / 16, s = polar(b) * Math.cos(a - b); if (s > best) best = s; }
    return best;
}
/** sailShare averaged over the wind from every side (a wind that keeps no direction). */
function sailShareAnyWind(C) {
    let s = 0;
    for (let k = 0; k < 64; k++) s += sailShare((k + 0.5) / 64 * Math.PI, C);
    return s / 64;
}

/**
 * A boat's speed under sail, km/h, toward a heading: the wind `W` (m/s) blowing at angle `a` (radians) from the heading
 * (0: from dead astern). Through the water at sailSpeed × W, up to sailMaxKmh, along any course at least sailNoGo off the
 * wind; toward the heading itself, the best of those courses' speeds made good (tacking, when the heading is into the wind).
 */
export function sailKmh(W, a, C = CIV) {
    return W >= C.sailMinWind ? Math.min(C.sailMaxKmh, C.sailSpeed * W * 3.6) * sailShare(a, C) : 0;
}

/**
 * Under sail over a month, km/h toward a heading, from the month's mean wind (u, v m/s — a mean of the wind's vector, as
 * a climate gives it: the days' winds, from every side, partly cancel in it). The wind met on a day is stronger: its
 * speed √(mean² + sailWindSd²). And it keeps the mean's direction only for its steady share (mean ÷ speed); the rest of
 * the time it blows from anywhere.
 */
function sailMonthKmh(u, v, hE, hN, anyWind, C) {
    const M = Math.hypot(u, v), W = Math.hypot(M, C.sailWindSd), steady = M / W;
    if (!(W >= C.sailMinWind)) return 0;
    // (the mean wind's angle from dead astern: its direction of travel against the heading)
    const a = M > 0 ? Math.acos(Math.max(-1, Math.min(1, (u * hE + v * hN) / M))) : 0;
    return Math.min(C.sailMaxKmh, C.sailSpeed * W * 3.6) * (steady * sailShare(a, C) + (1 - steady) * anyWind);
}

/**
 * The graph: days[(m · E) + k] for adjacency k (mesh.adjList's order: from cell c to adjList[k]) in month m (0 = January),
 * for a craft. A closed edge is Infinity.
 * @param w  the civ world (mesh, z, ocean, lake, ice; flow: {w, h, windU, windV, curU, curV} — m/s, 12 months on the climate grid)
 * @param sub civSubstrate(w) (its rivers)
 */
export function travelGraph(w, sub, craft = Craft.SAIL, C = CIV) {
    const { mesh, z, ocean, lake } = w, n = mesh.numCells, { adjOffset, adjList, xyz } = mesh, E = adjList.length, len = edgeLengths(mesh);
    const days = new Float32Array(12 * E), F = w.flow ?? null, q = sub.river.q;
    const water = c => ocean[c] || lake[c], anyWind = sailShareAnyWind(C);
    const lat = new Float32Array(n), lon = new Float32Array(n);
    for (let c = 0; c < n; c++) { lat[c] = Math.asin(xyz[3 * c + 2]) * DEG; lon[c] = Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * DEG; }
    for (let c = 0; c < n; c++) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
        const b = adjList[k], km = len[k];
        // (the edge's heading, east and north, at its midpoint)
        const la = (lat[c] + lat[b]) / 2 / DEG, dE = ((((lon[b] - lon[c]) + 540) % 360) - 180) / DEG * Math.cos(la), dN = (lat[b] - lat[c]) / DEG, hl = Math.hypot(dE, dN) || 1;
        const hE = dE / hl, hN = dN / hl;
        for (let m = 0; m < 12; m++) {
            let d = Infinity;
            if (!water(c) && !water(b)) {
                // on land: a day's walk, by the slope; the ice sheets closed
                if (!(w.ice && (w.ice[c] || w.ice[b]))) d = km / (C.walkKmDay * toblerFactor((Math.max(0, z[b]) - Math.max(0, z[c])) / km));
                // a navigable river: boats down it with the current, towed up it
                if (craft !== Craft.FOOT && q[c] >= C.navigableM3s && q[b] >= C.navigableM3s) d = Math.min(d, km / (z[b] <= z[c] ? C.riverDownKmDay : C.riverUpKmDay));
            } else if (craft !== Craft.FOOT) {
                // on the water (or onto it, or ashore): the boat through the water, and the current along its course
                const o = F ? m * F.w * F.h : 0, gla = (lat[c] + lat[b]) / 2, glo = lon[c] + (((lon[b] - lon[c]) + 540) % 360 - 180) / 2;
                let uw = 0, vw = 0, uc = 0, vc = 0;
                if (F) { uw = sampleGrid(F.w, F.h, F.windU, o, gla, glo); vw = sampleGrid(F.w, F.h, F.windV, o, gla, glo); if (ocean[c] && ocean[b]) { uc = sampleGrid(F.w, F.h, F.curU, o, gla, glo); vc = sampleGrid(F.w, F.h, F.curV, o, gla, glo); } }
                // (km a day through the water: paddled by day; or under sail — day and night at sea, by day along a
                // coast or a lake — or paddled, whichever is the more)
                const sea = ocean[c] && ocean[b], cur = 3.6 * (uc * hE + vc * hN);
                let kmDay = (C.paddleKmh + cur) * C.boatHours;
                if (craft === Craft.SAIL) kmDay = Math.max(kmDay, (sailMonthKmh(uw, vw, hE, hN, anyWind, C) + cur) * (sea ? 24 : C.boatHours));
                d = kmDay > 0.5 * C.boatHours ? km / kmDay : Infinity;
            }
            days[m * E + k] = d;
        }
    }
    return { days, E, craft };
}

/** Days from `source` to every cell in month m, over a travelGraph (the month one sets out in, all the way). */
export function travelDays(mesh, graph, source, m) {
    const { adjOffset, adjList, numCells: n } = mesh, out = new Float32Array(n).fill(Infinity), heap = new MinHeap(4096), o = m * graph.E;
    out[source] = 0; heap.push(0, source);
    while (heap.size) {
        const a = heap.pop(), t = heap.lastKey;
        if (t > out[a]) continue;
        for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
            const b = adjList[k], v = Math.fround(t + graph.days[o + k]);   // (as `out` keeps it: or the heap's key outruns it)
            if (v < out[b]) { out[b] = v; heap.push(v, b); }
        }
    }
    return out;
}
