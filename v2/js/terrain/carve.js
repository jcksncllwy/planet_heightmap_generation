// Phase 8b-1: rivers carve the tectonic surface. The stream power law with n = 1,
//     ∂z/∂t = u − k A^m |∇z|,
// solved ANALYTICALLY in time along the river network (Tzathas, Gailleton, Steer & Cordonnier, "Physically-based
// analytical erosion for fast terrain generation", Eurographics 2024): erosion is a wave travelling up each river at
// a(s) = k A(s)^m, so after a time t the height at x is the starting surface at the point D downstream of x that the
// wave needed t to come from, plus the uplift gathered on the way (their eqns 6–9):
//     T(D, x) = ∫_D^x ds / a = t,     z(x, t) = z0(D) + ∫_D^x u / a ds,
// or, where the wave reached x from beyond the coast within t (the steady state), z = z(coast) + ∫_0^x u / a ds.
// One pass per river tree instead of thousands of time steps. Adapted to a planet:
//   · the network: a priority flood from the sea (every land cell drains out; depressions are crossed at their
//     spill point, so small pits are breached), then each cell's receiver its steepest way down — over the surface
//     plus a faint micro-relief of the crust's own (the hummocks every real surface has, below this mesh; developer:
//     small rivers should hold their courses from frame to frame and shift only as the land changes — the paper's
//     random receivers were drawn afresh wherever the crust moved under the mesh);
//   · the rivers of the history (8b-2, tectonics/step/rivers.js): the routing runs over the surface less what the
//     history's rivers cut, so rivers follow the old courses — through ranges they cut as those rose — and a river bed
//     is at least as deep as the history cut it: gorges and canyons where big rivers held their ways;
//   · drainage area in km², weighted by rainfall (a river from wet mountains keeps cutting across a desert);
//   · every river carves its bed; a cell drops by the share of it its valley takes — valleys widen with the square root
//     of discharge (hydraulic geometry) — so great rivers cut whole cells and streams barely mark theirs, smoothly;
//     valley sides are held to a critical gradient;
//   · the starting surface is the tectonic surface less the uplift the time t would add (z0 = z − u t), so ground the
//     wave has not reached keeps the tectonic height; the result never rises above the tectonic surface;
//   · network and heights depend on each other: solved coarse to fine (the paper's multigrid idea) over meshes a
//     factor 4 apart — the sim mesh, then the terrain meshes up to the one shown — each level routing over the finer
//     surface plus the carving found on the coarser one, so big rivers are settled where the whole continent is seen.
// Heights in km, distances in km, time in Myr.

import { MinHeap } from '../core/min-heap.js';
import { locate } from '../core/mesh-locate.js';

const R = 6371;

/** Per mesh: the distance (km) along each adjacency entry, and the area of a cell (km²; the meshes are near-uniform). */
const infos = new WeakMap();
function infoOf(mesh) {
    let I = infos.get(mesh);
    if (I) return I;
    const { xyz, adjOffset, adjList, numCells } = mesh, dist = new Float32Array(adjList.length);
    for (let c = 0; c < numCells; c++) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
        const n = adjList[k], dx = xyz[3 * n] - xyz[3 * c], dy = xyz[3 * n + 1] - xyz[3 * c + 1], dz = xyz[3 * n + 2] - xyz[3 * c + 2];
        dist[k] = 2 * R * Math.asin(Math.min(1, 0.5 * Math.hypot(dx, dy, dz)));
    }
    I = { dist, area: 4 * Math.PI * R * R / numCells };
    infos.set(mesh, I);
    return I;
}

/**
 * Carve one mesh level.
 * @param {Object} mesh
 * @param {Object} f       per-cell fields on this mesh: z (tectonic surface, km), u (rock uplift, km/Myr), k (the
 *                         wave speed at 1 km² of drainage, km/Myr), rain (drainage weight), micro (km: the crust's
 *                         micro-relief, for the routing only), inc (km: how deep the history's rivers cut here), slope
 *                         (hillslope gradient, km per km)
 * @param {Float32Array} route   the surface the rivers are routed over (the current estimate, micro-relief included)
 * @param {Object} cfg     { timeMyr, m, valleyKm, activeHold }
 * @returns {{z: Float32Array, recv: Int32Array, area: Float32Array}}  carved heights, receivers (−1: the sea), drainage (km²)
 */
export function carveLevel(mesh, f, route, cfg) {
    const { adjOffset, adjList, numCells: n } = mesh, { dist, area: cellArea } = infoOf(mesh);
    const land = c => f.z[c] > 0;
    // ── the priority flood: from the sea inward, lowest spill first ──
    const fill = new Float32Array(n), rank = new Int32Array(n).fill(-1), parent = new Int32Array(n).fill(-1), order = new Int32Array(n);
    const heap = new MinHeap(1 << 16);
    let count = 0;
    for (let c = 0; c < n; c++) {
        if (land(c)) continue;
        rank[c] = -2;                                                     // (the sea: a boundary, never ranked)
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (land(adjList[k]) && parent[adjList[k]] === -1) {
            const nb = adjList[k];
            parent[nb] = c; fill[nb] = Math.max(0, route[nb]); heap.push(fill[nb], nb);
        }
    }
    while (heap.size) {
        const c = heap.pop();
        if (rank[c] !== -1) continue;
        rank[c] = count; order[count++] = c;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (rank[nb] !== -1 || !land(nb)) continue;
            const level = Math.max(fill[c], route[nb]);
            if (parent[nb] === -1 || level < fill[nb]) { parent[nb] = c; fill[nb] = level; heap.push(level, nb); }
        }
    }
    // ── receivers: the steepest way down to a neighbour already reached (or the sea); on a flat, the flood's way ──
    const recv = new Int32Array(n).fill(-1), recvKm = new Float32Array(n);
    for (let i = 0; i < count; i++) {
        const c = order[i];
        let pick = -1, km = 0, steepest = 0;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k], fn = rank[nb] === -2 ? 0 : fill[nb];
            if (!(rank[nb] === -2 || (rank[nb] >= 0 && rank[nb] < i)) || fn >= fill[c]) continue;
            const s = (fill[c] - fn) / dist[k];
            if (s > steepest) { steepest = s; pick = nb; km = dist[k]; }
        }
        if (pick < 0) {
            pick = parent[c];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (adjList[k] === pick) { km = dist[k]; break; }
        }
        recv[c] = rank[pick] === -2 ? -1 - pick : pick;                  // (−1 − s: drains into sea cell s)
        recvKm[c] = km;
    }
    // ── drainage area (km², rain-weighted), leaves to the sea ──
    const area = new Float32Array(n);
    for (let i = count - 1; i >= 0; i--) {
        const c = order[i];
        area[c] += cellArea * f.rain[c];
        if (recv[c] >= 0) area[recv[c]] += area[c];
    }
    // ── the river beds: the analytical solution, from the sea up each river: travel time T and uplift gathered S from
    // the coast — for every river, the river through a cell draining that cell's area (every cell comes after its
    // receiver in the flood's order, so its downstream path is known; D is found by a binary search over that path's
    // travel times, kept on a stack by a depth-first walk) ──
    const t = cfg.timeMyr, m = cfg.m, bed = new Float32Array(n), z = new Float32Array(n);
    for (let c = 0; c < n; c++) { bed[c] = f.z[c]; z[c] = f.z[c]; }
    const donorsAt = new Int32Array(n + 1), donors = new Int32Array(count);
    for (let i = 0; i < count; i++) { const r = recv[order[i]]; if (r >= 0) donorsAt[r + 1]++; }
    for (let c = 0; c < n; c++) donorsAt[c + 1] += donorsAt[c];
    const fillAt = donorsAt.slice(0, n);
    for (let i = 0; i < count; i++) { const c = order[i], r = recv[c]; if (r >= 0) donors[fillAt[r]++] = c; }
    const pathCell = new Int32Array(count + 1), pathT = new Float64Array(count + 1), pathS = new Float64Array(count + 1), pathZ0 = new Float64Array(count + 1);
    const walk = new Int32Array(count), walkDepth = new Int32Array(count);
    for (let i = 0; i < count; i++) {
        const root = order[i];
        if (recv[root] >= 0) continue;                                    // (roots: rivers that reach the sea)
        let top = 0;
        walk[top] = root; walkDepth[top++] = 1;
        pathT[0] = 0; pathS[0] = 0; pathZ0[0] = 0;                        // (depth 0: the coast, at sea level)
        while (top > 0) {
            const c = walk[--top], d = walkDepth[top];
            // the path so far is depth 0 … d−1; c is at depth d
            const a = f.k[c] * Math.max(area[c], 1e-6) ** m, dx = recvKm[c];
            pathCell[d] = c; pathT[d] = pathT[d - 1] + dx / a; pathS[d] = pathS[d - 1] + dx * f.u[c] / a; pathZ0[d] = Math.max(0, f.z[c] - f.u[c] * t);   // (never below the sea: its base level)
            const target = pathT[d] - t;
            let h;
            if (target <= 0) h = pathS[d];                                // the steady state: graded from the coast
            else {
                let lo = 0, hi = d;                                        // pathT[lo] ≤ target < pathT[hi]
                while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pathT[mid] <= target) lo = mid; else hi = mid; }
                const fr = (target - pathT[lo]) / (pathT[hi] - pathT[lo]);
                h = pathZ0[lo] + fr * (pathZ0[hi] - pathZ0[lo]) + pathS[d] - (pathS[lo] + fr * (pathS[hi] - pathS[lo]));
            }
            if (h < bed[c]) bed[c] = h;
            for (let k = donorsAt[c]; k < donorsAt[c + 1]; k++) { walk[top] = donors[k]; walkDepth[top++] = d + 1; }
        }
    }
    // ── the history's rivers: a bed is at least as deep as they cut it (a canyon where a river held its way) ──
    for (let i = 0; i < count; i++) { const c = order[i], old = f.z[c] - f.inc[c]; if (old < bed[c]) bed[c] = Math.max(0, old); }
    // ── an active belt rises as fast as its rivers cut: its beds stand higher — by activeHold at full activity (f.hold):
    // the range is shaped, not trenched (developer, 8b round 3) ──
    for (let i = 0; i < count; i++) { const c = order[i]; bed[c] = f.z[c] - (1 - cfg.activeHold * f.hold[c]) * (f.z[c] - bed[c]); }
    // ── rivers run downhill: where the wave left a bed below the reach it drains into (it carried a dip of the surface
    // upstream), the bed stands at that reach's height — never above the tectonic surface: a pit in the tectonic
    // surface itself stays, a basin a lake would fill ──
    for (let i = 0; i < count; i++) {
        const c = order[i], r = recv[c];
        if (r >= 0 && bed[c] < bed[r]) bed[c] = Math.min(f.z[c], bed[r]);
    }
    // ── how much of a cell its valley takes: a valley widens with the square root of its river's discharge (hydraulic
    // geometry, Leopold & Maddock 1953) — valleyKm wide at 10⁴ km². A great river's valley fills its cell and the cell
    // drops to the bed; a stream's is a sliver of it and the cell hardly drops. No threshold: every river counts, in
    // proportion; and a coarse cell, holding more than a valley, drops less — its mean, as at any resolution ──
    const perCell = cfg.valleyKm / Math.sqrt(cellArea);
    for (let i = 0; i < count; i++) {
        const c = order[i], share = Math.min(1, perCell * Math.sqrt(area[c] / 1e4));
        z[c] = f.z[c] - share * Math.max(0, f.z[c] - bed[c]);
    }
    // ── valley sides: no ground stands more than its critical gradient (f.slope) above the ground its water runs to
    // — a limit, like the paper's thermal erosion: the sides of a deep valley reach into the cells beside it ──
    for (let i = 0; i < count; i++) {
        const c = order[i], r = recv[c], lim = (r >= 0 ? z[r] : 0) + f.slope[c] * recvKm[c];
        if (lim < z[c]) z[c] = lim;
    }
    // (land stays land: a river cut to its base level stands just above the sea)
    for (let c = 0; c < n; c++) if (f.z[c] > 0 && z[c] < LAND_FLOOR) z[c] = Math.min(f.z[c], LAND_FLOOR);
    return { z, recv, area, order: order.subarray(0, count) };
}
const LAND_FLOOR = 0.002;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The stair's levels above the foot of a pile (km): steps of `step` ± 40 %, from a fixed hash — every mesh alike. */
function stairLevels(step) {
    const levels = [0];
    for (let k = 0; levels[k] < 10; k++) {
        let h = Math.imul(k + 1, 0x9e3779b1); h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
        levels.push(levels[k] + step * (0.6 + 0.8 * ((h >>> 0) / 4294967296)));
    }
    return levels;
}

/**
 * Flood basalt is stepped wherever it is cut into (developer, 8b round 6 — "trap" is a stair; terrain/lips.js): flow on
 * flow, hard and soft in turn, so a slope through the pile is flat treads and cliffs. The height above the ground under
 * the pile goes through an irregular stair — each step's foot a flat tread, its last lipRiser a cliff steepening to a
 * sharp rim (a talus foot, a caprock edge) — by how far below the unbroken top the ground now is: the intact plateau
 * top stays as it is; canyon walls, the escarpment and the flanks of mesas become stairs. A stair never rises above the
 * slope it replaces, and never turns water back: where a tread left a cell below the cell it drains into, the cell
 * stands at that cell's height again (never above where it was).
 */
function terraceBasalt(f, C, cfg) {
    const { z } = C, step = cfg.lipStepKm, riser = cfg.lipRiser, levels = stairLevels(step), before = z.slice();
    for (let c = 0; c < z.length; c++) {
        if (!(f.lip[c] > 0) || !(f.z[c] > 0)) continue;
        const rel = z[c] - f.lipBase[c];
        if (rel <= 0) continue;
        const w = f.lip[c] * smooth(0.25 * step, step, f.lipTop[c] - rel);
        if (w <= 0) continue;
        let k = 0;
        while (k < levels.length - 2 && levels[k + 1] <= rel) k++;
        const lo = levels[k], s = levels[k + 1] - lo, t = Math.max(0, ((rel - lo) / s - (1 - riser)) / riser);
        z[c] = f.lipBase[c] + rel + w * (lo + s * t ** 1.5 - rel);
    }
    for (let i = 0; i < C.order.length; i++) { const c = C.order[i], r = C.recv[c]; if (r >= 0 && z[c] < z[r] && z[c] < before[c]) z[c] = Math.min(before[c], z[r]); }
}

/** For each cell of `fine`: the 3 cells of `coarse` around it and their weights (barycentric), and its nearest. Cached. */
const maps = new WeakMap();
function mapBetween(coarse, fine) {
    let byCoarse = maps.get(fine);
    if (!byCoarse) maps.set(fine, byCoarse = new WeakMap());
    let M = byCoarse.get(coarse);
    if (M) return M;
    const n = fine.numCells, cells = new Int32Array(3 * n), weights = new Float32Array(3 * n), nearest = new Int32Array(n), c3 = [0, 0, 0], w3 = [0, 0, 0];
    for (let i = 0; i < n; i++) {
        locate(coarse, fine.xyz[3 * i], fine.xyz[3 * i + 1], fine.xyz[3 * i + 2], c3, w3);
        let best = 0;
        for (let j = 0; j < 3; j++) { cells[3 * i + j] = c3[j]; weights[3 * i + j] = w3[j]; if (w3[j] > w3[best]) best = j; }
        nearest[i] = c3[best];
    }
    M = { cells, weights, nearest };
    byCoarse.set(coarse, M);
    return M;
}

const FIELDS = ['z', 'u', 'k', 'rain', 'micro', 'slope', 'inc', 'hold', 'lip', 'lipBase', 'lipTop'];
/** Fine fields averaged onto a coarse mesh (each fine cell counts for its nearest coarse cell). */
function downsample(coarse, fine, f) {
    const M = mapBetween(coarse, fine), n = coarse.numCells, sums = Object.fromEntries(FIELDS.map(key => [key, new Float64Array(n)]));
    const count = new Uint32Array(n);
    for (let i = 0; i < fine.numCells; i++) {
        const c = M.nearest[i];
        count[c]++;
        for (const key of FIELDS) sums[key][c] += f[key][i];
    }
    const out = {};
    for (const key of FIELDS) out[key] = Float32Array.from(sums[key], (s, c) => (count[c] ? s / count[c] : 0));
    // (a coarse cell no fine cell fell in — rare at a factor 4 — takes the values of the fine cell nearest it)
    for (let c = 0; c < n; c++) if (!count[c]) {
        const i = fine.index.nearest(coarse.xyz[3 * c], coarse.xyz[3 * c + 1], coarse.xyz[3 * c + 2]);
        for (const key of FIELDS) out[key][c] = f[key][i];
    }
    return out;
}

/** A coarse field carried onto the fine mesh (barycentric). */
function upsample(coarse, fine, values) {
    const M = mapBetween(coarse, fine), out = new Float32Array(fine.numCells);
    for (let i = 0; i < fine.numCells; i++) out[i] = M.weights[3 * i] * values[M.cells[3 * i]] + M.weights[3 * i + 1] * values[M.cells[3 * i + 1]] + M.weights[3 * i + 2] * values[M.cells[3 * i + 2]];
    return out;
}

/**
 * Carve the finest mesh's surface, coarse to fine. `meshes`: coarsest first, the finest last (a factor ~4 apart);
 * `fields`: per-cell z, u, k, rain, micro, slope, inc on the finest. cfg: { timeMyr, m, rounds: [coarsest, …, finest] }.
 * @returns {{z: Float32Array, recv: Int32Array, area: Float32Array}} on the finest mesh
 */
export function carveTerrain(meshes, fields, cfg) {
    const L = meshes.length, F = new Array(L);
    F[L - 1] = fields;
    for (let l = L - 2; l >= 0; l--) F[l] = downsample(meshes[l], meshes[l + 1], F[l + 1]);
    let result = null, delta = null;
    for (let l = 0; l < L; l++) {
        const mesh = meshes[l], f = F[l];
        // route over this level's surface plus the carving the coarser level found, and the crust's micro-relief
        let route = Float32Array.from(f.z, (v, i) => v + f.micro[i] - f.inc[i]);
        if (delta) { const up = upsample(meshes[l - 1], mesh, delta); for (let i = 0; i < route.length; i++) route[i] += up[i]; }
        const rounds = cfg.rounds[Math.min(l, cfg.rounds.length - 1)];
        for (let r = 0; r < rounds; r++) {
            result = carveLevel(mesh, f, route, cfg);
            // (the next round routes over an average of the old estimate and the new heights: no oscillation)
            if (r < rounds - 1) route = Float32Array.from(route, (v, i) => 0.5 * v + 0.5 * (result.z[i] + f.micro[i] - f.inc[i]));
        }
        delta = Float32Array.from(result.z, (v, i) => v - f.z[i]);
    }
    if (cfg.lipStepKm > 0) terraceBasalt(F[L - 1], result, cfg);     // (on the mesh shown only)
    return result;
}
