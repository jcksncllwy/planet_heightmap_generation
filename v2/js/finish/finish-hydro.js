// R1 — rivers and lakes of a finished moment, by the climate (plans/V2_FINISH_PLAN.md). On the finished surface:
//   · the flow network: a priority flood from the sea — every land cell drains to the sea or into a hollow;
//   · lakes by water balance: a hollow fills if its inflow outweighs what evaporates from it full — a fresh lake spilling
//     on down the river below; else it shrinks to where the two balance — a salt lake (terminal); where next to nothing
//     flows in, a dry salt pan. Tiny or very shallow hollows are passed through (a lake smaller than the map can show);
//   · discharge (m³/s): the runoff (rain less evaporation) of everything upstream, less what a river loses in dry country
//     — seepage and evaporation along its bed, ∝ its width (∝ √discharge) and the aridity: big rivers from wet mountains
//     cross deserts, small ones die out;
//   · each river's year: its twelve monthly flows — each month's runoff (the climate's rain, snow kept until it melts,
//     part of it seeping to groundwater that feeds the river all year) routed down the same network, big lakes evening
//     out what they pass on — and its regime: permanent and steady, permanent with a flood season (the Nile's), seasonal
//     (dry some months), dry most of the year; and whether it is fed from afar (permanent across dry country);
//   · the rivers as polylines: every reach carrying at least F.riverMinM3s, from its source or confluence to the next
//     confluence, the sea, a lake or its end — each point with its discharge and seasonality.
// In m³/s, km, mm: the same rivers at every terrain detail, more of their bends on the finer.

import { MinHeap } from '../core/min-heap.js';
import { hollowLakes } from './finish-basins.js';

const SEC_PER_YEAR = 3.156e7, R = 6371;
// (a flood's key on a flat: its level plus this × the cells across the flat from where the flood came onto it — the
// mesh's cells near enough one size — 1 mm per 10⁵ cells, an order only: no level differs by it)
const FLAT_KEY = 1e-11;
/** The distance (km) between two neighbouring cells (the chord: the same to well under a metre at a cell's size). */
const edgeKmOf = (xyz, a, b) => R * Math.hypot(xyz[3 * a] - xyz[3 * b], xyz[3 * a + 1] - xyz[3 * b + 1], xyz[3 * a + 2] - xyz[3 * b + 2]);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Lake kinds (per cell, and per pixel of the finished picture). */
export const Water = Object.freeze({ NONE: 0, FRESH: 1, SALT: 2, PAN: 3 });

/**
 * Inland seas the open ocean all but reaches: a body below sea level behind a low, short barrier — a strait narrower than
 * the mesh's cells, low land the carve keeps at its floor — is opened into the ocean, the barrier cut to F.straitDepthKm
 * below sea level along the way its water would spill (a priority flood from the sea). By a smooth weight on the
 * barrier's height (its sill, m) and its length over dry land (km): the same at every detail. A body left closed is the
 * hydrology's: a remnant of the sea in a basin (hydrology: `sea` hollows).
 * @returns {{opened: number, cut: number}} bodies opened, cells cut
 */
export function openStraits(mesh, z, ocean, F) {
    const { adjOffset, adjList, numCells: n, xyz } = mesh;
    const { fill, parent, rank } = spillFlood(mesh, z, ocean);
    // each body below sea level the ocean does not reach: its way out from the cell the flood reached first
    const seen = new Uint8Array(n);
    let opened = 0, cut = 0;
    for (let s = 0; s < n; s++) {
        if (seen[s] || ocean[s] || !(z[s] < 0)) continue;
        const cells = [s];
        seen[s] = 1;
        let first = s;
        for (let i = 0; i < cells.length; i++) {
            const c = cells[i];
            if (rank[c] >= 0 && (rank[first] < 0 || rank[c] < rank[first])) first = c;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!seen[nb] && !ocean[nb] && z[nb] < 0) { seen[nb] = 1; cells.push(nb); } }
        }
        if (rank[first] < 0) continue;
        let barrierKm = 0, sillKm = 0;
        const path = [];
        for (let c = first, guard = 0; c >= 0 && rank[c] !== -2 && guard < 1e6; guard++) {
            path.push(c);
            const p = parent[c];
            if (z[c] >= 0 && p >= 0) barrierKm += R * Math.hypot(xyz[3 * p] - xyz[3 * c], xyz[3 * p + 1] - xyz[3 * c + 1], xyz[3 * p + 2] - xyz[3 * c + 2]);
            if (z[c] > sillKm) sillKm = z[c];
            c = p;
        }
        const open = (1 - smooth(F.straitSillM[0], F.straitSillM[1], 1000 * sillKm)) * (1 - smooth(F.straitKm[0], F.straitKm[1], barrierKm));
        if (open < 0.5) continue;
        for (const c of path) if (z[c] > -F.straitDepthKm) { z[c] = -F.straitDepthKm; cut++; }
        opened++;
    }
    return { opened, cut };
}

/** The way water would spill to the sea from every cell (a priority flood from the ocean, water below sea level standing
 *  at it): each cell's spill level (km, ≥ 0), the cell it was reached from, and its order (-2: the ocean). */
function spillFlood(mesh, z, ocean) {
    const { adjOffset, adjList, numCells: n } = mesh;
    const fill = new Float32Array(n), parent = new Int32Array(n).fill(-1), rank = new Int32Array(n).fill(-1), heap = new MinHeap(1 << 16);
    let count = 0;
    for (let c = 0; c < n; c++) {
        if (!ocean[c]) continue;
        rank[c] = -2;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!ocean[nb] && parent[nb] === -1) { parent[nb] = c; fill[nb] = Math.max(0, z[nb]); heap.push(fill[nb], nb); } }
    }
    while (heap.size) {
        const c = heap.pop();
        if (rank[c] !== -1) continue;
        rank[c] = count++;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (rank[nb] !== -1 || ocean[nb]) continue;
            const level = Math.max(fill[c], Math.max(0, z[nb]));
            if (parent[nb] === -1 || level < fill[nb]) { parent[nb] = c; fill[nb] = level; heap.push(level, nb); }
        }
    }
    return { fill, parent, rank };
}

/**
 * A remnant of the sea in a basin — a body below sea level cut off from the world ocean: its cells, below its rim. Its
 * water is the hydrology's — its level its water balance's (sea hollows: a lake to its rim that spills, a salt sea below
 * sea level, a playa on its floor). Its floor is as the history left it: the rivers that ran into it filled it with
 * their rock as long as it was cut off (tectonics/step/sea-fill.js — the Precaspian's ~20 km, the Black Sea's 14–19 km).
 * (Until 2026-10-27 it was filled here as well, toward at most seaFillKm below its rim, whatever its age or its rivers.)
 * @returns {Uint8Array} 1 on the basins' cells (below their rim)
 */
export function fillSeaBasins(mesh, z, ocean, F) {
    const { adjOffset, adjList, numCells: n } = mesh, EPS = 1e-4, cellKm2 = 4 * Math.PI * R * R / n;
    const { fill } = spillFlood(mesh, z, ocean), basin = new Uint8Array(n), seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
        if (seen[s] || basin[s] || ocean[s] || !(z[s] < 0)) continue;
        // (the body below sea level: big and deep enough to be a remnant of the sea — a smooth weight in km² and km)
        const below = [s];
        seen[s] = 1;
        let deepest = z[s];
        for (let i = 0; i < below.length; i++) for (let k = adjOffset[below[i]]; k < adjOffset[below[i] + 1]; k++) {
            const nb = adjList[k];
            if (!seen[nb] && !ocean[nb] && z[nb] < 0) { seen[nb] = 1; below.push(nb); if (z[nb] < deepest) deepest = z[nb]; }
        }
        const sea = smooth(F.seaBasinKm2[0], F.seaBasinKm2[1], below.length * cellKm2) * smooth(F.seaBasinDeepKm[0], F.seaBasinDeepKm[1], -deepest);
        if (sea < 0.5) continue;
        const L = fill[s], cells = [s];
        basin[s] = 1;
        for (let i = 0; i < cells.length; i++) for (let k = adjOffset[cells[i]]; k < adjOffset[cells[i] + 1]; k++) {
            const nb = adjList[k];
            if (!basin[nb] && !ocean[nb] && fill[nb] > z[nb] + EPS && Math.abs(fill[nb] - L) < 1e-6) { basin[nb] = 1; cells.push(nb); }
        }
    }
    return basin;
}

/**
 * @param {{mesh, z: Float32Array, ocean: Uint8Array, runoff: Float32Array (mm/yr), pet: Float32Array (mm/yr),
 *          rain: Float32Array (mm/yr), wetMonths: Float32Array (0–12), ice: Uint8Array|null (1: an ice cap now), glaciated: Uint8Array|null (1: under the ice age's ice), basin: Float32Array|null (km the ice dug its basins), lat, lon}} ctx
 * @returns {{lake: Uint8Array (Water per cell), lakeLevel: Float32Array (km; NaN if none), q: Float32Array (m³/s),
 *            rivers: {start: Int32Array, lat: Float32Array, lon: Float32Array, q: Float32Array, season: Float32Array},
 *            stats: Object}}
 */
export function hydrology(ctx, F) {
    const { mesh, z, ocean, runoff, pet, rain, wetMonths } = ctx, n = mesh.numCells, { adjOffset, adjList, xyz } = mesh;
    const cellKm2 = 4 * Math.PI * R * R / n, EPS = 1e-4;
    // (heights that are not a number, counted: one NaN in a priority flood's heap breaks its order for every cell after it
    // — the rivers routed up sills thousands of cells away. A bug upstream, not smoothed over here: check-phase8b.mjs
    // fails on any (the ice age's basin blur left 13 on its world until floods' 02c8940)
    let nanHeights = 0;
    for (let c = 0; c < n; c++) if (Number.isNaN(z[c])) nanHeights++;
    // ── the priority flood from the sea: each land cell's spill level (fill), its order, the way it was reached ──
    const fill = new Float32Array(n), rank = new Int32Array(n).fill(-1), parent = new Int32Array(n).fill(-1), order = new Int32Array(n);
    const heap = new MinHeap(1 << 16);
    let count = 0;
    for (let c = 0; c < n; c++) {
        if (!ocean[c]) continue;
        rank[c] = -2;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!ocean[nb] && parent[nb] === -1) { parent[nb] = c; fill[nb] = Math.max(0, z[nb]); heap.push(fill[nb], nb); } }
    }
    // (on a flat — a hollow filled to its spill level — the cells come off nearest the way in first: the flood's way across
    // it, which its rivers take, is the short way toward its outlet, not the heap's ties — a maze — lane rivers, 2026-10-29;
    // Barnes, Lehman & Mulla 2014. Only the order: the levels are as they were)
    const flatSteps = new Float32Array(n);     // (cells, not km)
    while (heap.size) {
        const c = heap.pop();
        if (rank[c] !== -1) continue;
        rank[c] = count; order[count++] = c;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (rank[nb] !== -1 || ocean[nb]) continue;
            const level = Math.max(fill[c], z[nb]);
            if (parent[nb] === -1 || level < fill[nb]) {
                parent[nb] = c; fill[nb] = level;
                flatSteps[nb] = level === fill[c] ? flatSteps[c] + 1 : 0;
                heap.push(level + FLAT_KEY * flatSteps[nb], nb);
            }
        }
    }
    // ── receivers: the steepest way down the filled surface to a cell reached before (or the sea); on a flat, the flood's way ──
    const recv = new Int32Array(n).fill(-1), stepKm = new Float32Array(n);
    for (let i = 0; i < count; i++) {
        const c = order[i];
        let pick = -1, steepest = 0;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (!(rank[nb] === -2 || (rank[nb] >= 0 && rank[nb] < i))) continue;
            const fn = rank[nb] === -2 ? Math.min(0, z[nb]) : fill[nb], s = fill[c] - fn;
            if (s > steepest) { steepest = s; pick = nb; }
        }
        if (pick < 0) pick = parent[c];
        recv[c] = pick;
        const dx = xyz[3 * pick] - xyz[3 * c], dy = xyz[3 * pick + 1] - xyz[3 * c + 1], dz = xyz[3 * pick + 2] - xyz[3 * c + 2];
        stepKm[c] = R * Math.hypot(dx, dy, dz);
    }
    // (inside a hollow: a priority flood over its cells from its outlet, on the ground as it is — `ground`, its water at
    // its level: where each cell's water would stand (innerFill). Scratch arrays, stamped)
    const innerFill = new Float32Array(n), innerStamp = new Int32Array(n), innerHeap = new MinHeap(1 << 12);
    let innerId = 0;
    const innerFrom = new Int32Array(n), innerOrder = [];             // (each cell's way toward the outlet; the flood's order)
    const innerFlood = (id, outlet, ground) => {
        innerId++;
        innerOrder.length = 0; innerOrder.push(outlet); innerFrom[outlet] = -1;
        innerFill[outlet] = ground(outlet); innerStamp[outlet] = innerId; innerHeap.push(innerFill[outlet], outlet);
        while (innerHeap.size) {
            const x = innerHeap.pop();
            for (let k = adjOffset[x]; k < adjOffset[x + 1]; k++) {
                const nb = adjList[k];
                if (hollow[nb] !== id || innerStamp[nb] === innerId) continue;
                innerStamp[nb] = innerId; innerFill[nb] = Math.max(innerFill[x], ground(nb)); innerHeap.push(innerFill[nb], nb); innerFrom[nb] = x; innerOrder.push(nb);
            }
        }
    };
    const groundZ = x => z[x];
    // (a gorge's way through its hollow, from cell x to the outlet: its river's own course — down its receivers, the way the
    // flood found across the hollow, every bend of it — unless a shortcut is enough less work. The work: the rock cut down to
    // `level` and a little for the length (gorgeLengthKm); along the river's own course only riverDirectness of it — so a
    // bend is cut through only where the course round it is over 1 / riverDirectness times the shortcut's work (0.5: a
    // detour twice as long). Developer: rivers "that go back and forth", but "some windyness is good" — 0 keeps every
    // course as it was, 1 takes the way of least work. Dijkstra over the hollow's cells)
    const pathCost = new Float64Array(n), pathFrom = new Int32Array(n), pathStamp = new Int32Array(n), pathDone = new Int32Array(n), onCourse = new Int32Array(n);
    const pathHeap = new MinHeap(1 << 12), pathCells = [], keepCourse = Math.min(1, Math.max(0, F.riverDirectness ?? 0.1));
    let pathId = 0;
    // (exitAt: a cell the gorge may end at instead — from there its water already runs out without rising above `level`)
    const gorgeWay = (x, own, out, level, ground, exitAt = null) => {
        pathId++;
        for (let y = x, g = 0; y >= 0 && hollow[y] === own && g < 1e6; y = recv[y], g++) { onCourse[y] = pathId; if (y === out) break; }
        pathCost[x] = 0; pathFrom[x] = -1; pathStamp[x] = pathId; pathHeap.push(0, x);
        let end = -1;
        while (pathHeap.size) {
            const a = pathHeap.pop();
            if (pathDone[a] === pathId) continue;
            pathDone[a] = pathId;
            if (a === out || (exitAt && exitAt(a, level))) { end = a; break; }
            for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
                const nb = adjList[k];
                if (hollow[nb] !== own || pathDone[nb] === pathId) continue;
                const c = pathCost[a] + edgeKmOf(xyz, a, nb) * (F.gorgeLengthKm + Math.max(0, ground(nb) - level)) * (onCourse[nb] === pathId && onCourse[a] === pathId ? keepCourse : 1);
                if (pathStamp[nb] !== pathId || c < pathCost[nb]) { pathStamp[nb] = pathId; pathCost[nb] = c; pathFrom[nb] = a; pathHeap.push(c, nb); }
            }
        }
        pathHeap.size = 0;
        pathCells.length = 0;
        if (end < 0) return pathCells;
        for (let y = end; y >= 0; y = pathFrom[y]) pathCells.push(y);
        return pathCells.reverse();                                 // (x … out, or the cell it could end at)
    };
    // (a gorge: from cell x the way its water would find out — through its hollow by gorgeWay to the hollow's outlet, then
    // down the receivers — the ground cut down to `level` until it is lower: rivers carve through, the land is never raised)
    let cutCells = 0, cutMaxKm = 0, cutKm3 = 0;
    // (and where each gorge ran, at what level: a lake further down that a gorge cut through below its rim drains by it)
    const cutAt = new Float32Array(n).fill(Infinity);
    // (dry: a gorge planned, not cut — its length measured: breachKmOf)
    let dry = false, dryKm = 0;
    const lower = (y, level) => {
        if (!(z[y] > level)) return z[y];
        if (dry) return level;
        const d = z[y] - level; cutCells++; cutKm3 += d * cellKm2; if (d > cutMaxKm) cutMaxKm = d; z[y] = level; if (level < cutAt[y]) cutAt[y] = level;
        return level;
    };
    // (a gorge falls along its way, from `level` where it starts to the ground it comes out on, evenly by distance — not
    // level at its floor: a level gorge is a flat the rivers cross by the flood's ties, a maze (lane rivers, 2026-10-29;
    // flat routing toward the outlet, Barnes, Lehman & Mulla 2014). Never below that ground, never raising a cell, and each
    // cell no higher than the one before it)
    const gorgePath = [];
    const gradeGorge = (path, level, endZ) => {
        if (!path.length) return;
        let total = 0;
        for (let i = 0; i < path.length; i++) total += stepKm[path[i]];
        if (dry) dryKm = total;
        // (and never level: it falls at least gorgeMinGrade over its length — where the ground it comes out on is no lower
        // than its start, its head stands that much higher, the water behind it that much deeper: lane rivers2, 2026-10-29)
        const head = Math.max(level, endZ + (F.gorgeMinGrade ?? 0) * total), fall = head - endZ;
        let along = 0, prev = Infinity;
        for (let i = 0; i < path.length; i++) {
            const y = path[i], at = fall > 0 && total > 0 ? head - fall * along / total : head;
            prev = lower(y, Math.max(endZ, Math.min(at, prev)));
            along += stepKm[y];
        }
    };
    const cut = (x, level, ground = groundZ, exitAt = null) => {
        // (below sea level only to open a small trapped sea into the ocean nearby — its cut through dry land at most
        // seaCutKm long; further, the sea would wind inland down the gorge: then the gorge stops at sea level)
        if (level < 0) {
            let km = 0, open = false;
            for (let y = x, guard = 0; y >= 0 && guard < 100000; guard++) {
                if (z[y] > 0) km += stepKm[y];
                const r = recv[y];
                if (r < 0 || rank[r] < 0) { open = true; break; }
                if (z[r] < level || km > F.seaCutKm) break;
                y = r;
            }
            if (!(open && km <= F.seaCutKm)) level = Math.max(level, F.seaCutFloorKm);
        }
        // (the gorge's cells, in order, and the ground it comes out on: where its water runs on lower without it)
        const own = hollow[x], path = gorgePath;
        path.length = 0;
        let endZ = level;
        if (own >= 0 && x !== hollows[own].outlet && keepCourse > 0) {
            const out = hollows[own].outlet, way = gorgeWay(x, own, out, level, ground, exitAt);
            if (way.length) { for (const y of way) path.push(y); x = way[way.length - 1]; }
            if (x !== out) { gradeGorge(path, level, Math.min(level, ground(x))); return level; }      // (it ended where its water runs out anyway)
            path.pop();
        }
        for (let guard = 0; x >= 0 && rank[x] >= 0 && guard < 100000; guard++) {
            path.push(x);
            const r = recv[x];
            if (r < 0 || rank[r] < 0) { endZ = Math.min(level, 0); break; }
            if (z[r] < level && !(own >= 0 && hollow[r] === own)) { endZ = z[r]; break; }
            x = r;
        }
        gradeGorge(path, level, endZ);
        return level;
    };
    // (the gorge cut() would cut, measured: its length, km — 0 if it cuts nothing)
    const breachKmOf = (x, level, ground = groundZ, exitAt = null) => { dry = true; dryKm = 0; cut(x, level, ground, exitAt); dry = false; return dryKm; };
    // (an artifact pit — the coarse-to-fine surface's, which real ground lacks — is breached: no deeper than pitDepthKm,
    // and its channel out no longer than pitBreachKm. Lindsay 2016's hybrid; any other hollow fills and spills)
    const isPit = (depthKm, x, level, ground = groundZ, exitAt = null) => depthKm <= F.pitDepthKm && breachKmOf(x, level, ground, exitAt) <= F.pitBreachKm;
    // (how far an outlet cuts its sill down: to `want`, but never below the ground its river reaches within breachReachKm
    // downstream — a sill is lowered by a knickpoint working back from where the outflow meets lower ground, and that ground
    // is the floor of the cut (until then a breach could cut thousands of km of gorge to reach it). `next`: the way down)
    const breachLevel = (x, want, next) => {
        let low = Infinity, km = 0;
        for (let y = next(x), prev = x, g = 0; y >= 0 && km <= F.breachReachKm && g < 100000; prev = y, y = next(y), g++) {
            km += edgeKmOf(xyz, prev, y);
            if (rank[y] === -2) { low = Math.min(low, 0); break; }
            low = Math.min(low, z[y] + F.gorgeMinGrade * km);
        }
        return Math.max(want, low);
    };
    // (a hollow its river's load fills — lane rivers3, 2026-10-30: Barnes, Lehman & Mulla 2014's two gradients, as
    // elevation. A fill is built from where its load comes in: the ground above its level round it, which drains onto it —
    // fans and deltas building out from every side — and it is graded down to where it spills. So its surface falls away
    // from the higher ground round it and toward its outlet, each at fillGrade (a delta plain's topset), never dead level:
    // its rivers run from its edges in to a trunk along its middle and down that to the outlet, gathering as they go.
    // Until then it rose from the outlet alone — a cone, its rivers straight spokes to that one point (dead-straight runs
    // 4 → 14 % on phase 8b's world, lane rivers2). Then sagged by fillSag of its thickness over the floor it buries (a muddy
    // fill compacts: that floor's relief draped on it), and each cell above the one it drains to by gorgeMinGrade at least
    // — a priority flood from its outlet over the graded surface — so the sag leaves no hollow and the fill no level ground.
    // Never lowers a cell)
    const fillHeap = new MinHeap(1 << 12), fillD = new Float64Array(n), fillH = new Float64Array(n), fillTop = new Float64Array(n), fillStamp = new Int32Array(n), fillIn = new Int32Array(n);
    let fillId = 0, filledCells = 0;
    // (km from `seeds` across the fill's cells, into `dist`)
    const fillDist = (seeds, dist) => {
        fillId++;
        for (const x of seeds) { dist[x] = 0; fillStamp[x] = fillId; fillHeap.push(0, x); }
        while (fillHeap.size) {
            const a = fillHeap.pop(), da = dist[a];
            if (fillStamp[a] === -fillId) continue;
            fillStamp[a] = -fillId;
            for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
                const b = adjList[k];
                if (fillIn[b] !== fillMark || fillStamp[b] === -fillId) continue;
                const db = da + edgeKmOf(xyz, a, b);
                if (fillStamp[b] !== fillId || db < dist[b]) { fillStamp[b] = fillId; dist[b] = db; fillHeap.push(db, b); }
            }
        }
    };
    let fillMark = 0;
    const fillGraded = (cells, from, level) => {
        const mark = ++fillMark;
        for (const x of cells) fillIn[x] = mark;
        // (where its load comes in: its cells beside ground above its level that drains onto it — not the sea, not ground
        // at or below its level: a gorge beside it, a lake's bed, is where it drains out)
        const edge = [], rim = [];
        for (const x of cells) {
            let high = Infinity;
            for (let k = adjOffset[x]; k < adjOffset[x + 1]; k++) { const b = adjList[k]; if (fillIn[b] !== mark && rank[b] !== -2 && z[b] > level && z[b] < high) high = z[b]; }
            if (high < Infinity) { edge.push(x); rim.push(high); }
        }
        fillDist(from, fillD);
        let farH = 0;
        if (edge.length) fillDist(edge, fillH);
        for (const x of cells) { if (!edge.length || fillStamp[x] !== -fillId) fillH[x] = 0; if (fillH[x] > farH) farH = fillH[x]; }
        // (its graded surface, sagged; no higher than the ground round it that drains in, so the rivers coming onto it
        // still run down — lane rivers2: held also to ground at or below its level, it was planed dead level)
        for (const x of cells) {
            const plane = level + F.fillGrade * (fillD[x] + farH - fillH[x]);
            fillTop[x] = z[x] < plane ? plane - (F.fillSag ?? 0) * (plane - z[x]) : plane;
        }
        for (let i = 0; i < edge.length; i++) if (fillTop[edge[i]] > rim[i] - 1e-6) fillTop[edge[i]] = Math.max(level, rim[i] - 1e-6);
        // (and every cell drains: a priority flood from the outlet over that surface, each cell at least gorgeMinGrade above
        // the one it was reached from)
        fillId++;
        for (const x of from) { const t = Math.max(level, fillTop[x]); fillD[x] = t; fillStamp[x] = fillId; fillHeap.push(t, x); }
        while (fillHeap.size) {
            const a = fillHeap.pop(), ta = fillD[a];
            if (fillStamp[a] === -fillId) continue;
            fillStamp[a] = -fillId;
            if (z[a] < ta) { z[a] = ta; filledCells++; }
            for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
                const b = adjList[k];
                if (fillIn[b] !== mark || fillStamp[b] === -fillId) continue;
                const tb = Math.max(fillTop[b], ta + F.gorgeMinGrade * edgeKmOf(xyz, a, b));
                if (fillStamp[b] !== fillId || tb < fillD[b]) { fillStamp[b] = fillId; fillD[b] = tb; fillHeap.push(tb, b); }
            }
        }
    };
    // ── hollows: connected cells under their spill level, one spill level each (one lake, if it were full) ──
    const hollow = new Int32Array(n).fill(-1), hollows = [], laterCuts = [];
    for (let i = 0; i < count; i++) {
        const s = order[i];
        if (hollow[s] >= 0 || !(fill[s] > z[s] + EPS)) continue;
        const id = hollows.length, cells = [s], L = fill[s];
        hollow[s] = id;
        let deepest = z[s], deepCell = s;
        for (let q = 0; q < cells.length; q++) for (let k = adjOffset[cells[q]]; k < adjOffset[cells[q] + 1]; k++) {
            const nb = adjList[k];
            if (hollow[nb] < 0 && rank[nb] >= 0 && fill[nb] > z[nb] + EPS && Math.abs(fill[nb] - L) < 1e-6) { hollow[nb] = id; cells.push(nb); if (z[nb] < deepest) { deepest = z[nb]; deepCell = nb; } }
        }
        // (the outlet: the hollow's cell the flood reached first — the spill point's side)
        let outlet = cells[0];
        for (const c of cells) if (rank[c] < rank[outlet]) outlet = c;
        // (a lake needs a hollow the map can show, with a origin: scoured by the ice age (lake districts), or a hollow of the
        // tectonic surface itself (rifts, forelands, closed basins). The finishing's own hollows — a fan or loess damming a
        // valley, a dissected floor — the rivers cut through: a channel from the hollow's floor out through its rim
        // (developer: rivers "shouldn't 'elevate' a ton of the land, it should just carve through" — they were filled))
        let glacial = 0, tect = 0, dug = 0;
        for (const c of cells) { if (ctx.glaciated?.[c]) glacial++; if (ctx.tectonic?.[c]) tect++; if (ctx.basin?.[c] > F.basinLakeKm) dug++; }
        // (a basin the ice dug in soft rock — the Great Lakes — is a lake district's whole hollow, its rim often past the
        // ice's edge: a lake wherever a share of it was dug)
        const scoured = dug >= F.basinLakeShare * cells.length;
        // (a hollow whose floor lies below sea level is a remnant of the sea — old, whatever else: it holds water as its
        // water balance allows, and is never cut through to its floor, which no gorge could drain)
        const sea = !!ctx.seaBasin && cells.some(c => ctx.seaBasin[c]);
        const origin = sea || scoured || glacial >= 0.5 * cells.length || tect >= F.lakeTectonicShare * cells.length || !ctx.tectonic;
        const lake = origin && cells.length * cellKm2 >= F.lakeMinKm2 && cells.length >= 2 && (L - deepest) * 1000 >= F.lakeMinDepthM;
        if (!origin && ctx.fillHollows) laterCuts.push(id);
        // (old: a hollow of the tectonic surface, glaciated or not; the ice age's own hollows are young)
        hollows.push({ cells, level: L, outlet, deepCell, floor: deepest, lake, inflow: 0, seasonW: 0, area: 0, glacial: scoured || glacial >= 0.5 * cells.length, scoured, old: sea || (!!ctx.tectonic && tect >= F.lakeTectonicShare * cells.length), sea });
    }
    // ── discharge, upstream first (each cell comes after the cell it drains into in the flood's order): each cell's own
    // runoff; a lake gathers its cells' and passes on only what it does not evaporate, at its outlet; a river loses water
    // along its bed in dry country ──
    // (with the water, the area each place drains — km², whatever the rain: the satellite view's flow texture)
    const area = new Float32Array(n);
    const q = new Float32Array(n), qw = new Float32Array(n), lakeKind = new Uint8Array(n), lakeLevel = new Float32Array(n).fill(NaN), seen = new Int32Array(n);
    const own = c => Math.max(0, runoff[c]) * cellKm2 * 1e3 / SEC_PER_YEAR;         // (mm × km² → m³/s)
    // (a hollow that drains whole — a land hollow left without water, the lowland round a trapped sea that spills — has no
    // closed basin left in it (developer: no closed basins, no holes): every pocket in it, a sub-basin behind its own sill
    // that the gorge from the hollow's floor does not reach, gets its own gorge out from its lowest point, down the way its
    // water would spill; until none is left — a pocket within a pocket next. Its water counts at its level. Scratch
    // arrays, stamped)
    const pocketSeen = new Int32Array(n);
    const ground = x => (lakeKind[x] === Water.FRESH || lakeKind[x] === Water.SALT ? Math.max(z[x], lakeLevel[x]) : z[x]);
    const drainsAt = (y, level) => innerStamp[y] === innerId && innerFill[y] <= level;
    const keepPocket = (cells, L, balance) => {
        const spill = [];
        // (where it spills: its cells beside ground the water leaves by — no higher than its level, and no pocket's)
        for (const x of cells) for (let k = adjOffset[x]; k < adjOffset[x + 1]; k++) { const nb = adjList[k]; if (innerStamp[nb] === innerId && innerFill[nb] <= L + 1e-9 && !(innerFill[nb] > ground(nb) + EPS)) { spill.push(x); break; } }
        if (!spill.length) spill.push(cells[0]);
        if (!balance) { fillGraded(cells, spill, L); keptPockets.fill++; return; }
        // (its water: each cell's own and what the hollow round it sends there — down the inner flood's tree, the way water
        // runs across the hollow — not only the cell's own)
        const S = hollowLakes(mesh, cells, z, x => q[x] + pocketIn[x], lakeLoss, minCells, L);
        for (const W of S.lakes) {
            const shows = W.cells.length >= 2 && W.cells.length * cellKm2 >= F.lakeMinKm2;
            if (shows && W.full) {
                // (full, it spills, and its outflow cuts its sill down — as a basin's does, below — never to its floor, and
                // no lower than the ground its outflow reaches within breachKmOf's reach)
                let floor = Infinity, at = spill[0];
                for (const x of W.cells) if (z[x] < floor) floor = z[x];
                const B = F.breachKm * smooth(Math.log(F.breachQ[0]), Math.log(F.breachQ[1]), Math.log(Math.max(1e-9, W.outflow)));
                let lev = W.level;
                if (B > 0) {
                    lev = breachLevel(at, Math.max(floor + F.pitDepthKm, W.level - B), y => innerFrom[y] >= 0 ? innerFrom[y] : -1);
                    if (lev < W.level && breachKmOf(at, lev, ground, drainsAt) <= F.breachReachKm) cut(at, lev, ground, drainsAt); else lev = W.level;
                }
                for (const x of W.cells) if (z[x] < lev) { lakeKind[x] = Water.FRESH; lakeLevel[x] = lev + 1e-5; }
                keptPockets.fresh++;
            }
            else if (shows) { for (const x of W.cells) { lakeKind[x] = Water.SALT; lakeLevel[x] = W.level + 1e-5; } keptPockets.salt++; }
            else if (W.full) { const mine = new Set(W.cells), at = spill.filter(x => mine.has(x)); fillGraded(W.cells, at.length ? at : [W.cells[0]], W.level); keptPockets.fill++; }
            else { for (const x of W.cells) { if (z[x] < W.level) z[x] = W.level; lakeKind[x] = Water.PAN; lakeLevel[x] = W.level + 1e-3; } keptPockets.pan++; }
        }
    };
    const keptPockets = { fresh: 0, salt: 0, pan: 0, fill: 0 }, pocketAcc = new Float64Array(n), pocketIn = new Float64Array(n);
    const cutPockets = (h, id, outlet, balance = true) => {
        for (let round = 0; round < 8; round++) {
            innerFlood(id, outlet, ground);
            // (what each cell gathers down the inner flood's tree; into a pocket's cell, from the cells outside it)
            if (balance) {
                for (const x of innerOrder) { pocketAcc[x] = q[x]; pocketIn[x] = 0; }
                for (let i = innerOrder.length - 1; i > 0; i--) {
                    const x = innerOrder[i], p = innerFrom[x];
                    if (p < 0) continue;
                    pocketAcc[p] += pocketAcc[x];
                    if (!(innerFill[x] > ground(x) + EPS)) pocketIn[p] += pocketAcc[x];
                }
            }
            let any = false;
            for (const s of h.cells) {
                if (innerStamp[s] !== innerId || pocketSeen[s] === innerId || !(innerFill[s] > ground(s) + EPS)) continue;
                // (the pocket: connected cells under the same spill level; cut from its lowest)
                const L = innerFill[s], cells = [s];
                pocketSeen[s] = innerId;
                let low = s;
                for (let i = 0; i < cells.length; i++) for (let k = adjOffset[cells[i]]; k < adjOffset[cells[i] + 1]; k++) {
                    const nb = adjList[k];
                    if (hollow[nb] === id && innerStamp[nb] === innerId && pocketSeen[nb] !== innerId && innerFill[nb] > ground(nb) + EPS && Math.abs(innerFill[nb] - L) < 1e-6) {
                        pocketSeen[nb] = innerId; cells.push(nb); if (z[nb] < z[low]) low = nb;
                    }
                }
                // (an artifact pit: breached by a short channel that falls. Any other pocket fills and spills — Jackson,
                // 2026-10-29: its water by its own balance, once the discharge is known; before that, or where the map would
                // not show its lake, its river's load fills it, graded down to where it spills. Until then every pocket was cut
                // from its floor, level until lower ground: trenches a km deep and thousands of km long)
                if (isPit(L - z[low], low, z[low], ground, drainsAt)) { cut(low, z[low], ground, drainsAt); any = true; continue; }
                keepPocket(cells, L, balance);
                any = true;
            }
            if (!any) break;
        }
    };
    // (a hollow drained by its gorges: its rivers run down the ground as it now is, not the flood's way across the level its
    // water stood at — the steepest way down to a cell reached before, in a priority flood over its cells from its outlet,
    // on a flat the flood's way (lane rivers, 2026-10-29: until then the flood's ties across the full hollow's level, which
    // on the finish's many small hollows drew the plains' rivers as mazes). Its cells take the places in the flood's order
    // its cells had, in the new order — every one of them came off the flood at the hollow's level, before any cell
    // around it, so the cells that drain into it still come after)
    const rr = { order: [], slots: [], heap: new MinHeap(256), fill: new Float32Array(n), stamp: new Int32Array(n), from: new Int32Array(n), id: 0 }, rflat = new Float32Array(n);
    const reroute = h => {
        const { order: lo, slots, heap: hp, fill: lf, stamp, from } = rr, out = h.outlet, mine = hollow[out];
        rr.id++; lo.length = 0; slots.length = 0;
        stamp[out] = rr.id; lf[out] = z[out]; from[out] = -1; rflat[out] = 0; hp.push(z[out], out);
        while (hp.size) {
            const c = hp.pop();
            if (stamp[c] === -rr.id) continue;
            stamp[c] = -rr.id; lo.push(c);
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (hollow[nb] !== mine || stamp[nb] === -rr.id) continue;
                const level = Math.max(lf[c], z[nb]);
                if (stamp[nb] !== rr.id || level < lf[nb]) { stamp[nb] = rr.id; lf[nb] = level; from[nb] = c; rflat[nb] = level === lf[c] ? rflat[c] + 1 : 0; hp.push(level + FLAT_KEY * rflat[nb], nb); }
            }
        }
        if (lo.length !== h.cells.length) return;                     // (a hollow the flood did not reach whole: left as it was)
        for (const c of lo) slots.push(rank[c]);
        slots.sort((a, b) => a - b);
        for (let i = 0; i < lo.length; i++) { order[slots[i]] = lo[i]; rank[lo[i]] = slots[i]; }
        for (let i = 1; i < lo.length; i++) {
            const c = lo[i];
            let pick = -1, steepest = 0;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (hollow[nb] !== mine || stamp[nb] !== -rr.id || rank[nb] >= rank[c]) continue;
                const s = (lf[c] - lf[nb]) / edgeKmOf(xyz, c, nb);
                if (s > steepest) { steepest = s; pick = nb; }
            }
            if (pick < 0) pick = from[c];
            recv[c] = pick; stepKm[c] = edgeKmOf(xyz, c, pick);
        }
    };
    // (the finishing's hollows cut through once every hollow is found — a cell cut below the flood's surface mid-search
    // read as a hollow of its own: spurious lakes the size of plains — each drained whole, its pockets too)
    // (Jackson, 2026-10-29: a pit breached, any other kept — these are the finishing's own hollows, a fan or loess
    // damming a valley; until then cut through. One kept is left as it is here: water fills it and spills, and the pass
    // over what is left of the hollows, below, makes it a lake where the map shows one, else fills it with the river's
    // load. Filled here whatever its size, a hollow hundreds of m deep became a plain graded from its outlet alone: a cone,
    // its rivers straight spokes to that point, 29 % of the low channels dead straight on phase 8b's world against main's
    // 4 % — lane rivers2)
    // (and one that a gorge cut since it was found has opened — ground beside it, outside it, now lower than its level,
    // which no hollow fresh off the flood has — drains by that lower way out, as a lake a gorge crossed below its rim does
    // (below: drained): cut through to it. Kept, its outlet stale, its river was sent over the old rim — 2 km up)
    const opened = h => {
        for (const c of h.cells) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const y = adjList[k];
            if (hollow[y] !== hollow[c] && (rank[y] === -2 ? Math.min(0, z[y]) : z[y]) < h.level - EPS) return true;
        }
        return false;
    };
    for (const id of laterCuts) {
        const h = hollows[id];
        if (!opened(h) && !isPit(h.level - h.floor, h.deepCell, h.floor)) { reroute(h); continue; }
        cut(h.deepCell, h.floor); cutPockets(h, id, h.outlet, false);
        reroute(h);
    }
    const lakeDeficit = c => Math.max(0, F.lakeEvapShare * pet[c] - Math.max(0, rain[c]));     // (mm/yr off open water)
    const lakeLoss = c => lakeDeficit(c) * cellKm2 * 1e3 / SEC_PER_YEAR;                         // (m³/s off a cell of open water)
    // (a sub-basin smaller than a closed hollow's least — finish-config.js basinMinKm2 — is no lake of its own: hollowLakes)
    const minCells = F.basinMinKm2 / cellKm2;
    // (and with the water, the rain and the potential evaporation each place's catchment gathers (mm · km²): a closed
    // basin's aridity, its catchment's — a lake in a desert fed from wet mountains is the Aral's)
    const aP = new Float32Array(n), aE = new Float32Array(n);
    let toSea = 0, toBasins = 0, lost = 0, total = 0, endoKm2 = 0;
    const closed = [];
    for (let i = count - 1; i >= 0; i--) {
        const c = order[i], h = hollow[c] >= 0 ? hollows[hollow[c]] : null;
        const r0 = own(c);
        total += r0;
        q[c] += r0; qw[c] += r0 * (wetMonths[c] ?? 12); area[c] += cellKm2; aP[c] += Math.max(0, rain[c]) * cellKm2; aE[c] += pet[c] * cellKm2;
        if (h && h.lake) {
            h.inflow += q[c]; h.seasonW += qw[c]; h.area += area[c]; h.aP = (h.aP ?? 0) + aP[c]; h.aE = (h.aE ?? 0) + aE[c];
            if (c !== h.outlet) continue;
            // what evaporates from the lake full
            let full = 0;
            for (const x of h.cells) full += lakeDeficit(x) * cellKm2 * 1e3 / SEC_PER_YEAR;
            // A river that fills its lake runs on to the sea (developer: "every river needs to end at ocean not lake"): the lake
            // stays only where it is big for its river — at least lakeKeepKm2 × √(inflow / 1000 m³/s), the ice age's lake
            // districts half that — and passes on all that flows in. Else it is cut through to its floor and the river runs on
            // in its gorge: a big river's pond ("a lot of the time large rivers are ending up in tiny lakes"). A basin its
            // rivers cannot fill is closed (below): they end there
            const areaKm2 = h.cells.length * cellKm2, young = h.glacial && !h.old;
            // (a gorge cut from a basin upstream already runs through it below its rim: its water has a lower way out and
            // drains by it — no lake strung along the gorge)
            let crossed = Infinity;
            if (!h.sea) for (const x of h.cells) if (cutAt[x] < crossed) crossed = cutAt[x];
            const drained = crossed < h.level - 0.01;
            const keepKm2 = F.lakeKeepKm2 * Math.sqrt(Math.max(1, h.inflow) / 1000) * (h.scoured ? F.basinKeepShare : young ? F.glacialKeepShare : 1);
            let outflow = h.inflow, level = h.level, kind = Water.FRESH, from = c;
            // A remnant of the sea (developer, 2026-10-15: inland seas "COMPLETELY dried out … leaving holes in the ground")
            // is its hole — the basin's cells below sea level — and its water stays in it (developer: the lakes over trapped
            // seas were "just too enormous": filled to the basin's sill they drowned the whole lowland round the hole)
            let hole = null;
            if (h.sea) { hole = h.cells.filter(x => z[x] < 0); h.holeN = hole.length; }
            // Its lakes, each at its own balance (finish-basins.js hollowLakes: the water that reaches each sub-basin — the
            // runoff of its catchment, what a full lake upstream spills into it — against what its lake would lose, inside
            // out): a hollow is closed, at any height, where its whole water balance cannot fill it to its rim (until
            // 2026-10-28 only a hollow below sea level could be; a dry one above it was cut through to its floor, so no
            // Great Basin, Altiplano, Chad or Aral formed)
            const S = drained ? null : hollowLakes(mesh, h.cells, z, x => q[x], lakeLoss, minCells, h.level);
            if (S && !S.full) {
                // closed: its rivers end there. A terminal lake the map can show is a salt lake at its level; a smaller one a
                // playa — a flat where what little flows in dries (levelled below: salt and silt); a lake full to its sill
                // spills on into the sub-basin below (Kara-Bogaz-Gol below the Caspian, Poopó below Titicaca), its overflow a
                // river across the dry ground between (below: the rivers inside a basin)
                outflow = 0; toBasins += h.inflow; endoKm2 += h.area;
                h.closed = true; h.spills = []; h.pans = []; h.drawn = [];
                let salt = false;
                for (const W of S.lakes) {
                    const shows = W.cells.length >= 2 && W.cells.length * cellKm2 >= F.lakeMinKm2;
                    if (W.full && W.into >= 0) h.spills.push({ cell: W.into, q: W.outflow });
                    if (!shows && W.full) continue;
                    if (!shows) { h.pans.push(W); h.drawn.push({ kind: Water.PAN, cells: W.cells }); continue; }
                    const k = W.full ? Water.FRESH : Water.SALT;
                    if (k === Water.SALT) salt = true;
                    for (const x of W.cells) { lakeKind[x] = k; lakeLevel[x] = W.level + 1e-5; }
                    h.drawn.push({ kind: k, cells: W.cells });
                }
                const end = S.fate(h.deepCell);
                h.pan = !salt; h.kind = salt ? Water.SALT : Water.PAN; h.levelNow = end >= 0 ? S.lakes[end].level : h.floor;
                h.outflow = 0; h.fullEvap = full; h.outletIn = h.inflow;
                let lakeKm2 = 0;
                for (const d of h.drawn) if (d.kind !== Water.PAN) lakeKm2 += d.cells.length * cellKm2;
                closed.push({ catchKm2: h.area, lakeKm2, panKm2: h.pans.reduce((a, W) => a + W.cells.length * cellKm2, 0), aridity: h.aE > 0 ? h.aP / h.aE : 0, lakes: S.lakes.length });
                continue;                                             // (its outlet keeps what reached it: a dry cell its river crosses)
            }
            if (h.sea) {
                // full, it rises to its rim and spills: its outflow has cut its way down to it (a gorge just above sea
                // level), and the lowland round it drains as land does (below)
                level = cut(h.deepCell, F.seaCutFloorKm); from = h.deepCell;
            } else if (drained || areaKm2 < keepKm2) {
                // (drained by a gorge through it — a flood's, a river's from upstream — its pockets drain by it as well:
                // not pits along the gorge)
                // (lane rivers2, 2026-10-29 — Jackson: breach only a pit. A basin a gorge from upstream crosses below its rim
                // drains to the gorge's level, its deeps keeping their water; one small for its river is filled by the
                // river's load, graded down to its outlet. Until then both were cut through to their floor)
                                if (isPit(h.level - h.floor, h.deepCell, h.floor)) { cut(h.deepCell, h.floor); level = h.floor; if (drained) cutPockets(h, hollow[c], h.outlet); }
                else if (drained) level = Math.max(crossed, h.floor + F.pitDepthKm);
                else { fillGraded(h.cells, [c], h.level); level = h.level; }
            } else if (F.breachKm > 0) {
                // an old basin that overflows has cut its outlet down (developer: the erosion should "break these basins
                // up"): a gorge through its rim, deeper the more spills over; the lake drains to what lies below the gorge —
                // often nothing. (The carving could not: a gorge is far narrower than a cell, so the rim cell hardly drops.)
                // The ice age's own hollows are young: cut only a share as deep (a big river breaks through its lakes; a
                // small one keeps its lake district)
                const Q = young ? F.glacialBreachQ : F.breachQ;
                const B = (young ? F.glacialBreachShare : 1) * F.breachKm * smooth(Math.log(Q[0]), Math.log(Q[1]), Math.log(Math.max(1e-9, h.inflow - full)));
                if (B > 0) {
                    let floor = Infinity;
                    for (const x of h.cells) if (z[x] < floor) floor = z[x];
                    level = cut(c, breachLevel(c, Math.max(floor + F.pitDepthKm, h.level - B), y => recv[y]));     // (never to its floor: its deeps keep water — Jackson, 2026-10-29)
                }
            }
            // the water: what is connected to the outlet below the level. Pockets below it but cut off from it (a breached
            // basin's hollows) are dry ground the rivers cross
            const id = hollow[c], water = [], seeds = [];
            // (a trapped sea full to its brim: the whole of its hole, each part of it behind a low sill too)
            if (h.sea && kind === Water.FRESH) for (const x of hole) if (z[x] < level) seeds.push(x);
            if (kind !== Water.PAN) {
                if (z[from] < level) seeds.push(from);
                else for (let k = adjOffset[from]; k < adjOffset[from + 1]; k++) { const nb = adjList[k]; if (hollow[nb] === id && z[nb] < level) seeds.push(nb); }
            }
            for (const x of seeds) if (seen[x] !== id + 1) { seen[x] = id + 1; water.push(x); }
            for (let i = 0; i < water.length; i++) for (let k = adjOffset[water[i]]; k < adjOffset[water[i] + 1]; k++) {
                const nb = adjList[k];
                if (seen[nb] !== id + 1 && hollow[nb] === id && z[nb] < level) { seen[nb] = id + 1; water.push(nb); }
            }
            // (a lake the map can show: at least lakeMinKm2 and two cells — not a blob on a river)
            if (water.length < 2 || water.length * cellKm2 < F.lakeMinKm2) water.length = 0;
            // (a river's pond — what water a partly cut basin keeps, small for its river — cut through too: the size that
            // counts is the water left, not the basin's)
            // (a remnant of the sea keeps its water whatever its size: no gorge could drain it)
                        if (!h.sea && water.length && water.length * cellKm2 < keepKm2) {
                // (a pit breached; a pond its river fills with its load, graded down to the outlet — lane rivers2)
                if (isPit(level - h.floor, h.deepCell, h.floor)) { cut(h.deepCell, h.floor); level = h.floor; }
                else fillGraded(water, [from], level);
                water.length = 0;
            }
            for (const x of water) { lakeKind[x] = kind; lakeLevel[x] = level; }
            if (h.sea ? kind === Water.FRESH : !water.length) cutPockets(h, id, c);
            h.kind = water.length ? kind : h.pan ? Water.PAN : Water.NONE; h.levelNow = level; h.outflow = outflow; h.fullEvap = full; h.outletIn = h.inflow;
            q[c] = outflow; qw[c] = h.seasonW; area[c] = h.area; aP[c] = h.aP; aE[c] = h.aE;
            if (!(outflow > 0)) continue;
        }
        // down the bed to the next cell, losing water where it is dry (width ∝ √Q, loss ∝ width × length × aridity)
        let out = q[c];
        const arid = pet[c] > 0 ? smooth(0, 1, (pet[c] - Math.max(0, rain[c])) / pet[c]) : 0;
        if (arid > 0 && out > 0) {
            const widthM = F.riverWidthPerSqrtQ * Math.sqrt(out), loss = F.bedLossMPerYear * arid * widthM * stepKm[c] * 1000 / SEC_PER_YEAR;
            const kept = Math.max(0, out - loss);
            lost += out - kept;
            qw[c] *= out > 0 ? kept / out : 0; out = kept;
        }
        q[c] = out;
        const r = recv[c];
        if (r >= 0 && rank[r] >= 0) { q[r] += out; qw[r] += qw[c]; area[r] += area[c]; aP[r] += aP[c]; aE[r] += aE[c]; }
        else toSea += out;
    }
    // (a closed basin keeps its floor as deep as it is: a salt lake's dry shore — below sea level the Dead Sea's, the
    // Caspian's — and a playa's basin, its floor a flat where what little flows in dries: the cells its inflow could keep
    // wet, levelled to the level they would stand at (salt and silt) — Death Valley's at −86 m, the Qattara's at −133 m,
    // the Messinian Mediterranean's 1.5–3 km down. Elsewhere — a sea full to its rim and spilling, the pockets a breach
    // left, a gorge — what is left below sea level is filled to just above it: developer, "huge holes in the ground")
    for (const h of hollows) if (h.closed) for (const W of h.pans) {
        for (const c of W.cells) { if (z[c] < W.level) z[c] = W.level; lakeKind[c] = Water.PAN; lakeLevel[c] = W.level + 1e-3; }
    }
    for (let c = 0; c < n; c++) {
        if (rank[c] < 0 || lakeKind[c]) continue;
        const h = hollow[c] >= 0 ? hollows[hollow[c]] : null;
        if (z[c] < 0 && !(h && h.closed)) z[c] = F.seaCutFloorKm;
    }
    // ── the rivers inside a lake's basin: its cells gathered their water straight into the lake (its balance); where the
    // water does not cover the basin — a lake shrunk to its balance, a basin breached and drained — the rivers still
    // cross the dry ground: down to the shore (a priority flood from the water over the basin's dry cells), or, with
    // no water left, down to the gorge the basin drains by (from its outlet) ──
    const lr = new Int32Array(n).fill(-1), lp = new Int32Array(n).fill(-1), lfill = new Float32Array(n), lflat = new Float32Array(n), lorder = [];
    const endsHere = new Uint8Array(n);                               // (a closed basin's dry hollow where a river's water ends)
    for (const h of hollows) {
        if (!h.lake) continue;
        const cells = h.cells, dry = c => hollow[c] === hollow[h.outlet] && !lakeKind[c] && (h.closed || c !== h.outlet);
        const seeds = cells.filter(c => lakeKind[c]);
        if (!seeds.length) seeds.push(h.outlet);
        const hp = new MinHeap(256);
        lorder.length = 0;
        for (const s of seeds) {
            lr[s] = -2;
            const w = lakeKind[s] ? lakeLevel[s] : z[s];
            for (let k = adjOffset[s]; k < adjOffset[s + 1]; k++) { const nb = adjList[k]; if (dry(nb) && lp[nb] === -1) { lp[nb] = s; lfill[nb] = Math.max(w, z[nb]); lflat[nb] = 0; hp.push(lfill[nb], nb); } }
        }
        while (hp.size) {
            const c = hp.pop();
            if (lr[c] !== -1) continue;
            lr[c] = lorder.length; lorder.push(c);
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (lr[nb] !== -1 || !dry(nb)) continue;
                const level = Math.max(lfill[c], z[nb]);
                if (lp[nb] === -1 || level < lfill[nb]) { lp[nb] = c; lfill[nb] = level; lflat[nb] = level === lfill[c] ? lflat[c] + 1 : 0; hp.push(level + FLAT_KEY * lflat[nb], nb); }
            }
        }
        // (each dry cell drains the steepest way down to a cell reached before — or the water, or the outlet; on a flat, the
        // flood's way — and carries what it gathered: its own runoff and what came in from outside the basin, kept in q)
        for (let i = 0; i < lorder.length; i++) {
            const c = lorder[i];
            let pick = -1, steepest = 0;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (!(lr[nb] === -2 || (lr[nb] >= 0 && lr[nb] < i))) continue;
                const s = lfill[c] - (lr[nb] === -2 ? (lakeKind[nb] ? lakeLevel[nb] : z[nb]) : lfill[nb]);
                if (s > steepest) { steepest = s; pick = nb; }
            }
            recv[c] = pick >= 0 ? pick : lp[c];
        }
        // (a closed basin's dry floor — Jackson, 2026-10-29: a river entering a dry closed basin ends there, at its playa or
        // sink, never crossing it at the level water would stand: each dry cell drains the steepest way down its own ground
        // to a lower cell or the water; one with none is where the river's water ends — it soaks in and evaporates, and
        // what reached it is not passed on. Until then the floor was crossed by the flood's way at its spill level, the
        // drawn rivers climbing out of its hollows. Upstream first: by height)
        if (h.closed) {
            lorder.sort((a, b) => z[a] - z[b]);
            for (let i = 0; i < lorder.length; i++) {
                const c = lorder[i];
                let pick = -1, steepest = 0;
                for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                    const nb = adjList[k];
                    if (!(lr[nb] === -2 || lr[nb] >= 0)) continue;
                    const s = (z[c] - (lr[nb] === -2 && lakeKind[nb] ? lakeLevel[nb] : z[nb])) / edgeKmOf(xyz, c, nb);
                    if (s > steepest) { steepest = s; pick = nb; }
                }
                if (pick < 0) endsHere[c] = 1;
                else recv[c] = pick;
            }
        }
        // (a lake full to its sill in a closed basin spills into the sub-basin below: its overflow a river from where it
        // lands, down the dry ground to the water — kept steady by the lake)
        if (h.spills) for (const sp of h.spills) if (lr[sp.cell] >= 0) { q[sp.cell] += sp.q; qw[sp.cell] += 12 * sp.q; }
        for (let i = lorder.length - 1; i >= 0; i--) {
            const c = lorder[i], r = recv[c];
            if (lr[r] >= 0 && !endsHere[c]) { q[r] += q[c]; qw[r] += qw[c]; area[r] += area[c]; }
        }
        for (const c of lorder) lr[c] = -1;
        for (const s of seeds) lr[s] = -1;
        for (const c of cells) lp[c] = -1;
    }

    // ── the final routing, once every breach, cut and fill is made (lane rivers3, 2026-10-30): the ways down, the order
    // and the discharge, all again, on the finished ground — its lakes at their surface. Until then they were the first
    // flood's, patched hollow by hollow as each was cut or filled: a hollow's river was sent out over its old rim where a
    // gorge cut since had opened a lower way (drawn climbing a sill), and the water was gathered in the first flood's
    // order, which a later exit broke (lane rivers2's open problem). The decisions above (which hollow is a lake, salt or
    // a pan, which is cut) were made on that first routing's water, and stand. A priority flood from the sea and from
    // every place where water ends — a salt lake, a closed basin's playa or dry sink: it neither spills nor drains on; at
    // its bed, so whatever reaches it ends there — over the finished surface ──
    const surfaceOf = c => (lakeKind[c] === Water.FRESH || lakeKind[c] === Water.SALT ? Math.max(z[c], lakeLevel[c]) : z[c]);
    // (where water ends: a salt lake; a closed basin's playa and its dry sinks. A closed basin is reached from outside it
    // only over its rim — its level, as the first flood had it full: a pit beside a big river, closed by its own few
    // cells' water, is not a sink for the river, which would fill it and run on. Leaving one costs that climb)
    const sink = new Uint8Array(n), closedAt = c => (hollow[c] >= 0 && hollows[hollow[c]].closed ? hollow[c] : -1);
    for (let c = 0; c < n; c++) if (rank[c] >= 0 && (lakeKind[c] === Water.SALT || (closedAt(c) >= 0 && (endsHere[c] || lakeKind[c] === Water.PAN)))) sink[c] = 1;
    const rimOf = c => (closedAt(c) >= 0 ? hollows[hollow[c]].level : lakeKind[c] === Water.SALT ? surfaceOf(c) : -Infinity);
    const outOf = (c, nb) => closedAt(c) !== closedAt(nb) || (lakeKind[c] === Water.SALT && lakeKind[nb] !== Water.SALT);
    const fl = fill, from = parent;
    const finalFlood = () => {
        heap.size = 0;
        let k0 = 0;
        for (let c = 0; c < n; c++) {
            if (rank[c] === -2) continue;
            rank[c] = -1; from[c] = -1;
            if (sink[c]) { fl[c] = z[c]; flatSteps[c] = 0; heap.push(fl[c], c); }
        }
        for (let c = 0; c < n; c++) {
            if (rank[c] !== -2) continue;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (rank[nb] === -2 || sink[nb]) continue;
                const v = Math.max(0, surfaceOf(nb));
                if (from[nb] === -1 || v < fl[nb]) { from[nb] = c; fl[nb] = v; flatSteps[nb] = 0; heap.push(v, nb); }
            }
        }
        while (heap.size) {
            const c = heap.pop();
            if (rank[c] !== -1) continue;
            rank[c] = k0; order[k0++] = c;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (rank[nb] !== -1 || sink[nb]) continue;
                let level = Math.max(fl[c], surfaceOf(nb));
                if (level < rimOf(c) && outOf(c, nb)) level = rimOf(c);
                if (from[nb] === -1 || level < fl[nb]) {
                    from[nb] = c; fl[nb] = level;
                    flatSteps[nb] = level === fl[c] ? flatSteps[c] + 1 : 0;
                    heap.push(level + FLAT_KEY * flatSteps[nb], nb);
                }
            }
        }
        return k0;
    };
    count = finalFlood();
    // ── what is left of the hollows (lane rivers2, 2026-10-29 — Jackson: a hollow fills and spills; a river never crosses
    // one at the level water would stand, drawn climbing out of it): on the finished ground, every dry hollow still left
    // is a fresh lake at its rim where the map shows one and its water fills it (what reached it on the first routing,
    // against what its open water would lose), else filled by its river's load, graded from its edges to where it spills
    // (fillGraded). Here, on the final surface, not before it: chosen on the first routing's surface, the ones a later
    // gorge or fill left — a fill across a gorge, a pocket a cut opened — were missed, and crossed at their spill level ──
    // (again until none is left, at most four rounds: a fill rises inland from its outlet, and where it rises past the
    // sill of a hollow that spilled onto it, that hollow is left below its new outlet and fills in turn — aggradation
    // raising its tributaries' base level. On phase 8b's world 2711 hollows, then 85, 18, 5)
    {
        const seenH = new Uint8Array(n), inH = new Uint8Array(n);
        let ponds = 0, pondFills = 0;
        keptPockets.lateRounds = [];
        for (let round = 0; round < 4; round++) {
        let made = 0;
        seenH.fill(0);
        for (let i0 = 0; i0 < count; i0++) {
            const s0 = order[i0];
            if (seenH[s0] || sink[s0] || lakeKind[s0] || !(fl[s0] > z[s0] + EPS)) continue;
            const L = fl[s0], cells = [s0];
            seenH[s0] = 1;
            let floor = z[s0], qin = 0, loss = 0;
            for (let i = 0; i < cells.length; i++) for (let k = adjOffset[cells[i]]; k < adjOffset[cells[i] + 1]; k++) {
                const nb = adjList[k];
                if (!seenH[nb] && rank[nb] >= 0 && !sink[nb] && !lakeKind[nb] && fl[nb] > z[nb] + EPS && Math.abs(fl[nb] - L) < 1e-6) { seenH[nb] = 1; cells.push(nb); if (z[nb] < floor) floor = z[nb]; }
            }
            for (const x of cells) { inH[x] = 1; if (q[x] > qin) qin = q[x]; loss += lakeLoss(x); }
            // (where it spills: its cells the flood came onto it by)
            const spill = [];
            for (const x of cells) if (!(from[x] >= 0 && inH[from[x]])) spill.push(x);
            if (cells.length >= 2 && cells.length * cellKm2 >= F.lakeMinKm2 && (L - floor) * 1000 >= F.lakeMinDepthM && qin >= loss) {
                for (const x of cells) { lakeKind[x] = Water.FRESH; lakeLevel[x] = L + 1e-5; }
                ponds++;
            } else { fillGraded(cells, spill.length ? spill : [cells[0]], L); pondFills++; }
            for (const x of cells) inH[x] = 0;
            made++;
        }
        keptPockets.lateRounds.push(made);
        if (!made) break;
        count = finalFlood();
        }
        keptPockets.lateLakes = ponds; keptPockets.lateFills = pondFills;
    }
    // (each cell's way: the steepest fall per km down the flood's surface to a cell reached before it, or the sea; on a
    // flat — a lake's surface — the flood's way, toward its way out (Barnes, Lehman & Mulla 2014). A sink's: none)
    let unresolved = 0;
    for (let i = 0; i < count; i++) {
        const c = order[i];
        if (sink[c]) { recv[c] = -1; stepKm[c] = 0; continue; }
        let pick = -1, steepest = 0;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (!(rank[nb] === -2 || (rank[nb] >= 0 && rank[nb] < i))) continue;
            const at = rank[nb] === -2 ? Math.min(0, z[nb]) : outOf(nb, c) ? Math.max(fl[nb], rimOf(nb)) : fl[nb];
            const s = (fl[c] - at) / edgeKmOf(xyz, c, nb);
            if (s > steepest) { steepest = s; pick = nb; }
        }
        if (pick < 0) pick = from[c];
        recv[c] = pick; stepKm[c] = edgeKmOf(xyz, c, pick);
        if (!lakeKind[c] && fl[c] > z[c] + EPS) unresolved++;       // (a dry cell still under the flood's surface: none should be)
    }
    keptPockets.unresolved = unresolved;
    // (each fresh lake: its cells, one level — what its open water loses a year, m³/s, taken from what it passes on)
    const body = new Int32Array(n).fill(-1), bodyLoss = [];
    for (let s = 0; s < n; s++) {
        if (lakeKind[s] !== Water.FRESH || body[s] >= 0 || rank[s] < 0) continue;
        const id = bodyLoss.length, st = [s];
        body[s] = id;
        let loss = 0;
        while (st.length) {
            const x = st.pop();
            loss += lakeLoss(x);
            for (let k = adjOffset[x]; k < adjOffset[x + 1]; k++) { const y = adjList[k]; if (body[y] < 0 && lakeKind[y] === Water.FRESH && Math.abs(lakeLevel[y] - lakeLevel[s]) < 1e-6) { body[y] = id; st.push(y); } }
        }
        bodyLoss.push(loss);
    }
    // (the discharge, upstream first: every cell comes after the cell it drains into. Where a lake drains out — a lake
    // cell whose way leaves it — it passes on what reached it less its loss; its year's months evened out: riverYears)
    const lakeIn = new Float32Array(n).fill(-1), lakeOut = new Float32Array(n);
    q.fill(0); qw.fill(0); area.fill(0);
    toSea = 0; lost = 0;
    let toSinks = 0, closedEvap = 0;
    for (let i = count - 1; i >= 0; i--) {
        const c = order[i], r0 = own(c);
        q[c] += r0; qw[c] += r0 * (wetMonths[c] ?? 12); area[c] += cellKm2;
        if (sink[c]) { toSinks += q[c]; continue; }
        const r = recv[c], b = body[c];
        if (b >= 0) {
            if (r >= 0 && body[r] === b) { q[r] += q[c]; qw[r] += qw[c]; area[r] += area[c]; continue; }
            // (where it drains out)
            const take = Math.min(q[c], bodyLoss[b]);
            bodyLoss[b] -= take;
            if (hollow[c] >= 0 && hollows[hollow[c]].closed) closedEvap += take;
            lakeIn[c] = q[c]; lakeOut[c] = q[c] - take;
            qw[c] *= q[c] > 0 ? lakeOut[c] / q[c] : 0; q[c] = lakeOut[c];
        } else {
            let out = q[c];
            const arid = pet[c] > 0 ? smooth(0, 1, (pet[c] - Math.max(0, rain[c])) / pet[c]) : 0;
            if (arid > 0 && out > 0) {
                const widthM = F.riverWidthPerSqrtQ * Math.sqrt(out), loss = F.bedLossMPerYear * arid * widthM * stepKm[c] * 1000 / SEC_PER_YEAR;
                const kept = Math.max(0, out - loss);
                lost += out - kept;
                qw[c] *= kept / out; out = kept;
            }
            q[c] = out;
        }
        if (r >= 0 && rank[r] >= 0) { q[r] += q[c]; qw[r] += qw[c]; area[r] += area[c]; }
        else toSea += q[c];
    }
    // (water into closed basins: what ends in them, and what their spilling lakes lose on the way)
    toBasins = toSinks + closedEvap;
    for (let c = 0; c < n; c++) if (sink[c]) endsHere[c] = 1;

    // ── the rivers: reaches carrying at least riverMinM3s, not on lakes, not on ice caps ──
    const on = c => rank[c] >= 0 && q[c] >= F.riverMinM3s && !lakeKind[c] && !(ctx.ice && ctx.ice[c]);
    const upCount = new Uint8Array(n);
    for (let i = 0; i < count; i++) { const c = order[i]; if (on(c) && recv[c] >= 0 && !endsHere[c] && on(recv[c])) upCount[recv[c]] = Math.min(255, upCount[recv[c]] + 1); }
    const lat = ctx.lat, lon = ctx.lon, L = { start: [], lat: [], lon: [], q: [], season: [], cell: [] };
    // (a point: where, its discharge, and the cell whose year it has — a mouth's point, the river's last cell's)
    const pushPoint = (c, qq, ss, from = c) => {
        if (lat) { L.lat.push(lat[c]); L.lon.push(lon[c]); }
        else { L.lat.push(Math.asin(Math.max(-1, Math.min(1, xyz[3 * c + 2]))) * 180 / Math.PI); L.lon.push(Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * 180 / Math.PI); }
        L.q.push(qq); L.season.push(ss); L.cell.push(from);
    };
    let reaches = 0, biggest = 0;
    for (let i = count - 1; i >= 0; i--) {
        const s = order[i];
        if (!on(s) || upCount[s] === 1) continue;             // (a head: a source, or a confluence — rivers start there)
        L.start.push(L.lat.length);
        let c = s;
        for (let guard = 0; guard < 1e6; guard++) {
            pushPoint(c, q[c], q[c] > 0 ? qw[c] / q[c] : 0);
            if (q[c] > biggest) biggest = q[c];
            const r = recv[c];
            if (r < 0 || endsHere[c]) break;                   // (where its water ends, in a closed basin's dry hollow)
            // (the mouth: into the sea, a lake, or another river's confluence — its point ends this reach)
            if (rank[r] === -2 || lakeKind[r] || !on(r) || upCount[r] !== 1) { if (rank[r] === -2 || lakeKind[r] || on(r)) pushPoint(r, q[c], q[c] > 0 ? qw[c] / q[c] : 0, c); break; }
            c = r;
        }
        reaches++;
    }
    // ── each river's year (ctx.months: the monthly shares of each place's runoff, on the climate's grid) ──
    const regimes = ctx.months ? riverYears(ctx, F, { n, count, order, recv, rank, lakeKind, stepKm, own, sink, body, lakeIn, lakeOut, cells: Int32Array.from(L.cell) }) : null;
    let lakes = 0, salt = 0, pans = 0, lakeKm2 = 0;
    const byOrigin = { glacialFresh: 0, tectonicFresh: 0, salt: 0, pan: 0 }, sizes = [];
    // (each body of water: a closed basin's each lake, salt, full or playa; another hollow's one)
    for (const h of hollows) for (const d of h.drawn ?? (h.kind ? [{ kind: h.kind, cells: h.cells.filter(c => lakeKind[c]) }] : [])) {
        if (d.kind === Water.FRESH) lakes++; else if (d.kind === Water.SALT) salt++; else pans++;
        const a = d.cells.length * cellKm2;
        byOrigin[d.kind === Water.FRESH ? (h.glacial ? 'glacialFresh' : 'tectonicFresh') : d.kind === Water.SALT ? 'salt' : 'pan'] += a;
        sizes.push(a);
    }
    sizes.sort((a, b) => b - a);
    for (let c = 0; c < n; c++) if (lakeKind[c]) lakeKm2 += cellKm2;
    // (each sea cut off from the ocean: its basin (km²), its floor and its rim (km), its water's kind, level (km) and area
    // (km²), and what flows in (km³ a year) — the closed basins' report: check-phase13.mjs)
    const seas = hollows.filter(h => h.sea).map(h => {
        let wet = 0;
        for (const c of h.cells) if (lakeKind[c]) wet++;
        return { km2: Math.round(h.cells.length * cellKm2), belowKm2: Math.round((h.holeN ?? 0) * cellKm2), floorKm: +h.floor.toFixed(3), sillKm: +h.level.toFixed(3), kind: h.kind, levelKm: +(h.levelNow ?? h.level).toFixed(3),
            waterKm2: Math.round(wet * cellKm2), inflowKm3: +(h.inflow * SEC_PER_YEAR / 1e9).toFixed(1), spills: h.outflow > 0 };
    });
    const landKm2 = count * cellKm2;
    for (let c = 0; c < n; c++) if (endsHere[c]) recv[c] = -1;      // (the rivers that end in a closed basin's dry hollow end there)
    return {
        lake: lakeKind, lakeLevel, q, area, ...(ctx.debug ? { recv } : {}),       // (the network itself: for checks only)
        rivers: { start: Int32Array.from(L.start), lat: Float32Array.from(L.lat), lon: Float32Array.from(L.lon), q: Float32Array.from(L.q), season: Float32Array.from(L.season),
            ...(regimes ?? {}) },
        terminal: ctx.debug ? hollows.filter(h => h.kind && h.kind !== Water.FRESH).sort((a, b) => b.inflow - a.inflow).slice(0, 12).map(h => {
            let P = 0, E = 0, la = 0, lo = 0; for (const c of h.cells) { P += rain[c]; E += pet[c]; la += (ctx.lat?.[c] ?? 0); lo += (ctx.lon?.[c] ?? 0); }
            const k = h.cells.length; return { inflow: +h.inflow.toFixed(0), fullEvap: +h.fullEvap.toFixed(0), grown: h.grown, grownE: +(h.grownE ?? 0).toFixed(0), cells: k, km2: Math.round(k * cellKm2), depthM: Math.round((h.level - Math.min(...h.cells.map(c => z[c]))) * 1000), rain: Math.round(P / k), pet: Math.round(E / k), at: `${(lo / k).toFixed(0)},${(la / k).toFixed(0)}`, kind: h.kind };
        }) : null,
        stats: { runoffMm: total * SEC_PER_YEAR / 1e3 / Math.max(1, landKm2), toSeaShare: toSea / Math.max(1e-9, total), toBasinsShare: toBasins / Math.max(1e-9, total),
            lostShare: lost / Math.max(1e-9, total), byOriginShare: Object.fromEntries(Object.entries(byOrigin).map(([k, v]) => [k, +(100 * v / Math.max(1, count * cellKm2)).toFixed(2)])),
            biggestLakesKm2: sizes.slice(0, 6).map(Math.round), nanHeights, cutCells, cutMaxKm: +cutMaxKm.toFixed(3), cutMeanM: Math.round(1000 * cutKm3 / Math.max(1, cutCells) / cellKm2), keptPockets, filledCells, reaches, points: L.lat.length, biggestM3s: biggest, freshLakes: lakes, saltLakes: salt, pans, lakeShare: lakeKm2 / Math.max(1, landKm2), seas,
            // (the land whose water ends in a closed basin — endorheic — and each closed basin: its catchment (km²), its
            // lakes' water and its playas (km²), its catchment's aridity (rain ÷ potential evaporation))
            endorheicShare: endoKm2 / Math.max(1, landKm2),
            closed: closed.sort((a, b) => b.catchKm2 - a.catchKm2).map(b => ({ catchKm2: Math.round(b.catchKm2), lakeKm2: Math.round(b.lakeKm2), panKm2: Math.round(b.panKm2), aridity: +b.aridity.toFixed(3), lakes: b.lakes })) },
    };
}

/** River regimes (per river point): 0 permanent and steady, 1 permanent with a flood season, 2 seasonal (dry some months),
 *  3 dry most of the year. */
export const Regime = Object.freeze({ STEADY: 0, FLOOD: 1, SEASONAL: 2, EPHEMERAL: 3 });

/**
 * Each river point's year: the twelve monthly flows, four months at a time (at 10M cells four arrays of flows is 160 MB):
 * each cell's runoff shared out over the months (ctx.months.at: the shares, and each month's dryness), routed as the year's was — lakes gather their
 * cells' water and pass on at their outlet the year's outflow, shaped by their inflow's months and evened out
 * (F.lakeRegulation); a basin's dry ground routed as before; river beds losing water by each month's dryness (a dry
 * season's low flow can vanish into the bed: the river runs dry). Then per point: its regime, its flood months
 * (around the peak, the months within 60 % of it), and whether it is fed from afar (permanent where the land is dry).
 */
function riverYears(ctx, F, G) {
    const { n, count, order, recv, rank, stepKm, own, sink, body, lakeIn, lakeOut, cells } = G, { pet, rain } = ctx, monthsAt = ctx.months.at;
    const P = cells.length, qm = new Float32Array(12 * P), M = 4, acc = Array.from({ length: M }, () => new Float32Array(n)), sh = new Float32Array(M), ar = new Float32Array(M);
    const lam = F.lakeRegulation;
    for (let m0 = 0; m0 < 12; m0 += M) {
        for (const a of acc) a.fill(0);
        // (down the year's network, upstream first — hydrology's final routing)
        for (let i = count - 1; i >= 0; i--) {
            const c = order[i], r0 = 12 * own(c);
            monthsAt(c, m0, M, sh, ar);
            for (let j = 0; j < M; j++) acc[j][c] += r0 * sh[j];
            if (sink[c]) continue;                                    // (where the water ends: a salt lake, a pan, a dry sink)
            const r = recv[c], pass = r >= 0 && rank[r] >= 0, b = body[c];
            if (b >= 0) {
                if (pass && body[r] === b) { for (let j = 0; j < M; j++) acc[j][r] += acc[j][c]; continue; }
                // (a lake passes on its year's outflow, shaped by its inflow's months — evened out by its storage)
                const qin = lakeIn[c], qout = lakeOut[c];
                for (let j = 0; j < M; j++) acc[j][c] = qout > 0 && qin > 0 ? qout * ((1 - lam) * acc[j][c] / qin + lam) : 0;
            } else {
                // (the bed loses water by the month's own dryness: most in the dry season, none while frozen)
                for (let j = 0; j < M; j++) {
                    const out = acc[j][c];
                    if (ar[j] > 0 && out > 0) acc[j][c] = Math.max(0, out - F.bedLossMPerYear * ar[j] * F.riverWidthPerSqrtQ * Math.sqrt(out) * stepKm[c] * 1000 / SEC_PER_YEAR);
                }
            }
            if (pass) for (let j = 0; j < M; j++) acc[j][r] += acc[j][c];
        }
        for (let p = 0; p < P; p++) for (let j = 0; j < M; j++) qm[12 * p + m0 + j] = acc[j][cells[p]];
    }
    // ── regimes ──
    const regime = new Uint8Array(P), floodFrom = new Uint8Array(P), floodTo = new Uint8Array(P), farFed = new Uint8Array(P), months = qm;
    for (let p = 0; p < P; p++) {
        let sum = 0, max = 0, peak = 0;
        for (let m = 0; m < 12; m++) { const v = qm[12 * p + m]; sum += v; if (v > max) { max = v; peak = m; } }
        const mean = sum / 12;
        let dry = 0;
        for (let m = 0; m < 12; m++) if (qm[12 * p + m] < Math.max(F.dryM3s, F.dryShare * mean)) dry++;
        regime[p] = dry >= F.ephemeralMonths ? Regime.EPHEMERAL : dry >= 1 ? Regime.SEASONAL : max >= F.floodRatio * mean ? Regime.FLOOD : Regime.STEADY;
        let a = peak, b = peak;
        while (a !== (peak + 1) % 12 && qm[12 * p + (a + 11) % 12] >= 0.6 * max && (a + 11) % 12 !== peak) a = (a + 11) % 12;
        while (qm[12 * p + (b + 1) % 12] >= 0.6 * max && (b + 1) % 12 !== a) b = (b + 1) % 12;
        floodFrom[p] = a; floodTo[p] = b;
        const c = cells[p];
        farFed[p] = regime[p] <= Regime.FLOOD && pet[c] > 0 && Math.max(0, rain[c]) < F.farFedAridity * pet[c] ? 1 : 0;
    }
    return ctx.debug ? { regime, floodFrom, floodTo, farFed, months } : { regime, floodFrom, floodTo, farFed };     // (the months: for checks only)
}
