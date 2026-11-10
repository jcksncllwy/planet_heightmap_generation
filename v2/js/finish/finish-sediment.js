// F2 — sediment. What the rivers cut is carried down their network and laid where they slow: fans where they leave the
// mountains, floodplains in the lowlands, deltas where they meet the sea (the rest of the fine load is lost to the deep
// sea). Hillslopes are the erosion's (finish-erode.js, erode-gpu.js: the hillslope term and threshold diffusion).

import { MinHeap } from '../core/min-heap.js';


/**
 * The rivers' load laid down until the plains it builds carry it (2026-10-29, lane rivers). A reach carries
 * capacityK · drainage · slope; where more comes in than it can carry it drops the rest, its bed rises and its slope with
 * it, until the slope carries the load: the transport-limited river's graded slope S = Qs / (capacityK · A) — steep on a
 * fan below the mountains, where the load is heavy and the water little, gentle down a great river's plain, which gathers
 * the plain's water but little of its rock. The load comes in gradeRounds shares; after each, the water finds its way
 * again over what was laid down (a priority flood): a river that has built its bed above the ground beside it leaves it
 * for the lower ground — avulsion — and fills that in turn, so the whole plain is built up to the slope, not one ridge
 * along the first channel, and the hollows a plain had (a fan's dammed valley, a dissected floor) fill with sediment
 * rather than being cut through. Ground already steeper than its load needs is left as it is (bedrock). What reaches the
 * sea builds deltas; a closed basin's floor fills.
 * Until 2026-10-29: one pass down the carve's network, each reach dropping what it could not carry (at most 0.25 km at
 * once) at its own height, spread over fanSpreadKm — so a plain kept the slope (or the flats, and the hollows) it had.
 * @param {Object} mesh
 * @param {Float32Array} before   the surface before the rivers cut it (km)
 * @param {{z: Float32Array, recv: Int32Array, area: Float32Array, order: Int32Array}} C   the carve's result (z changed in place)
 * @param {Uint8Array|null} sink  closed basins' floors (their rivers' loads end there)
 * @param {Uint8Array|null} ocean  the world ocean (finish.js oceanMask): elsewhere is land the plains build on — a sea cut
 *                                 off from it dry below sea level too; without it, the ground above sea level
 */
export function depositSediment(mesh, before, C, sink, cellKm2, F, ocean = null) {
    const { z, recv, area, order } = C, n = mesh.numCells, { adjOffset, adjList, xyz } = mesh;
    const land = ocean ? c => !ocean[c] : c => z[c] > 0;
    const outlet = c => !land(c) || !!(sink && sink[c]);
    // each cell's own load (the bedload share of what was cut from it, km³) and its own water (its share of the carve's
    // drainage — rain-weighted km², the area capacityK is reckoned in)
    const own = new Float32Array(n), water = new Float32Array(n);
    for (let i = 0; i < order.length; i++) { const c = order[i]; own[c] = F.sedimentShare * Math.max(0, before[c] - z[c]) * cellKm2; water[c] += area[c]; if (recv[c] >= 0) water[recv[c]] -= area[c]; }
    for (let i = 0; i < order.length; i++) { const c = order[i]; if (!(water[c] > 0)) water[c] = 1e-3 * cellKm2; }
    const rounds = Math.max(1, F.gradeRounds ?? 3), K = F.capacityK, share = 1 / rounds;
    // (the first round runs down the carve's own network — its order, every cell after its receiver; only the later rounds
    // find the way again, a priority flood each)
    const R = carveRouting(C, n, outlet, xyz, adjOffset, adjList), load = new Float64Array(n), flux = new Float64Array(n), A = new Float32Array(n), target = new Float32Array(n);
    const toSink = new Float64Array(sink ? n : 0), mouths = new Map();
    // (the first round's flux: everything cut upstream, none of it laid down yet)
    for (let i = R.count - 1; i >= 0; i--) { const c = R.order[i], r = R.recv[c]; flux[c] += own[c]; if (r >= 0 && !outlet(r)) flux[r] += flux[c]; }
    for (let round = 0; round < rounds; round++) {
        if (round > 0) routing(mesh, z, outlet, R.flood ? R : Object.assign(R, { flood: true, fill: new Float32Array(n), rank: new Int32Array(n), parent: new Int32Array(n), heap: new MinHeap(1 << 16) }));
        const { order: ord, recv: rc, stepKm, count } = R;
        A.fill(0);
        for (let i = count - 1; i >= 0; i--) { const c = ord[i], r = rc[c]; A[c] += water[c]; if (r >= 0 && !outlet(r)) A[r] += A[c]; }
        // the graded surface, from the outlets up: each cell at least its slope for its load above the cell it drains to
        for (let i = 0; i < count; i++) {
            const c = ord[i], r = rc[c], below = outlet(r) ? (land(r) ? z[r] : 0) : target[r];
            target[c] = Math.max(z[c], below + flux[c] / (K * Math.max(A[c], cellKm2)) * stepKm[c]);
        }
        // this round's share of the load, down the network: each cell takes what it needs to reach the graded surface
        load.fill(0);
        for (let i = count - 1; i >= 0; i--) {
            const c = ord[i], r = rc[c];
            load[c] += share * own[c];
            flux[c] = load[c] / share;                                   // (the flux the next round grades for)
            const need = (target[c] - z[c]) * cellKm2;
            if (need > 0 && load[c] > 0) { const d = Math.min(need, load[c]); z[c] += d / cellKm2; load[c] -= d; }
            if (!outlet(r)) load[r] += load[c];
            else if (land(r)) toSink[r] += load[c];
            else mouths.set(r, (mouths.get(r) ?? 0) + load[c]);
        }
    }
    // ── a closed basin's floor: what reaches it laid level from its lowest ground, never above its rim ──
    let spilledKm3 = 0;
    if (sink) {
        for (let c = 0; c < n; c++) toSink[c] /= cellKm2;
        spilledKm3 = fillHollows(mesh, z, toSink, sink, land) * cellKm2;
    }
    // ── deltas: a river's share of its load built out over the shelf from its mouth, nearest first, to a low plain ──
    let deltas = 0;
    const seen = new Int32Array(n).fill(-1);
    for (const [mouth, v] of mouths) {
        let vol = v * F.deltaShare;
        if (vol < cellKm2 * 0.02) continue;
        const queue = [mouth]; seen[mouth] = mouth;
        let built = 0;
        for (let q = 0; q < queue.length && vol > 0 && q < 20000; q++) {
            const c = queue[q];
            if (z[c] <= 0) {
                if (z[c] < -F.deltaMaxDepthKm) continue;
                const cost = (F.deltaTopKm - z[c]) * cellKm2;
                if (cost > vol) { z[c] += vol / cellKm2; vol = 0; break; }   // (the last of it: a shallow bar)
                z[c] = F.deltaTopKm; vol -= cost; built++;
            }
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (seen[nb] !== mouth && z[nb] <= 0) { seen[nb] = mouth; queue.push(nb); } }
        }
        if (built) deltas++;
    }
    return { deltas, mouths, spilledKm3 };
}

/**
 * A closed hollow's fill (km on each cell, spread as its fans lay it) laid on its floor, bounded by its rim: sediment in a
 * basin with no outlet builds its floor up — the Basin and Range's valleys and the Tarim hold kilometres of it — but never
 * above the lowest ground round it, its spill point: filled to there it is no longer closed, and what more its rivers bring
 * goes on over the sill. Each hollow (connected sink cells): a fan standing above the rim is cut to it, what that removes
 * is laid as a level fill over the hollow's lowest ground, and what the whole hollow has no room for spills.
 * Until 2026-11-04 (lane visual5) the fill was laid where the spread left it, with no bound: a big closed catchment's
 * load — sedimentShare of all it cut, laid over σ fanSpreadKm, one or two cells at 2.5M — stood up to 29 km high, single
 * spikes on flat plains, and which spots spiked moved with the erodibility's spread.
 * @returns {number} what spilled (km, summed over cells: × cellKm2 for km³)
 */
function fillHollows(mesh, z, fill, sink, land) {
    const { adjOffset, adjList, numCells: n } = mesh, seen = new Uint8Array(n), cells = [];
    let spilled = 0;
    for (let c0 = 0; c0 < n; c0++) {
        if (!sink[c0] || seen[c0] || !land(c0)) continue;
        // the hollow, and its rim: the lowest ground beside it that is not in it
        cells.length = 0; cells.push(c0); seen[c0] = 1;
        let rim = Infinity, total = 0;
        for (let q = 0; q < cells.length; q++) {
            const c = cells[q];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (sink[nb] && land(nb)) { if (!seen[nb]) { seen[nb] = 1; cells.push(nb); } } else if (z[nb] < rim) rim = z[nb];
            }
        }
        for (const c of cells) total += fill[c];
        if (!(total > 0)) continue;
        if (!(rim < Infinity)) rim = Math.max(...cells.map(c => z[c]));
        // the fans as laid, cut to the rim; what is cut goes to the floor
        let excess = 0;
        for (const c of cells) {
            const d = Math.max(0, fill[c]), room = Math.max(0, rim - z[c]);
            if (d > room) { excess += d - room; z[c] += room; } else z[c] += d;
        }
        if (!(excess > 0)) continue;
        // the floor filled level from its lowest ground up to what the excess fills (bisection on the level), the rim at most
        let room = 0, lo = Infinity;
        for (const c of cells) { room += Math.max(0, rim - z[c]); if (z[c] < lo) lo = z[c]; }
        if (excess >= room) { for (const c of cells) if (z[c] < rim) z[c] = rim; spilled += excess - room; continue; }
        let hi = rim;
        for (let it = 0; it < 40; it++) {
            const L = 0.5 * (lo + hi);
            let v = 0;
            for (const c of cells) if (z[c] < L) v += L - z[c];
            if (v > excess) hi = L; else lo = L;
        }
        for (const c of cells) if (z[c] < lo) z[c] = lo;
    }
    return spilled;
}

/** The carve's network as a routing (see routing): its order and receivers (a sea cell s for its −1 − s). */
function carveRouting(C, n, outlet, xyz, adjOffset, adjList) {
    const order = new Int32Array(n), recv = new Int32Array(n).fill(-1), stepKm = new Float32Array(n);
    let count = 0;
    for (let i = 0; i < C.order.length; i++) {
        const c = C.order[i], r = C.recv[c], to = r >= 0 ? r : -1 - r;
        if (outlet(c)) continue;
        order[count++] = c; recv[c] = to; stepKm[c] = edge(xyz, c, to);
    }
    return { order, recv, stepKm, count, flood: false };
}

/**
 * The way water runs over the surface: a priority flood from the outlets (the sea, closed basins' floors), each cell's
 * receiver its steepest way down to a cell reached before it, or on a flat the way the flood came (so every cell drains
 * out). Into `R` when given (its arrays reused). order: outlets' neighbours first; stepKm: the step to the receiver.
 */
function routing(mesh, z, outlet, R = null) {
    const { adjOffset, adjList, xyz, numCells: n } = mesh;
    if (!R) R = { order: new Int32Array(n), recv: new Int32Array(n), stepKm: new Float32Array(n), fill: new Float32Array(n), rank: new Int32Array(n), parent: new Int32Array(n), heap: new MinHeap(1 << 16), count: 0 };
    const { order, recv, stepKm, fill, rank, parent, heap } = R;
    rank.fill(-1); parent.fill(-1); recv.fill(-1);
    let count = 0;
    for (let c = 0; c < n; c++) {
        if (!outlet(c)) continue;
        rank[c] = -2;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!outlet(nb) && parent[nb] === -1) { parent[nb] = c; fill[nb] = z[nb]; heap.push(fill[nb], nb); } }
    }
    while (heap.size) {
        const c = heap.pop();
        if (rank[c] !== -1) continue;
        rank[c] = count; order[count++] = c;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (rank[nb] !== -1) continue;
            const level = Math.max(fill[c], z[nb]);
            if (parent[nb] === -1 || level < fill[nb]) { parent[nb] = c; fill[nb] = level; heap.push(level, nb); }
        }
    }
    for (let i = 0; i < count; i++) {
        const c = order[i];
        let pick = -1, steepest = 0;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (!(rank[nb] === -2 || (rank[nb] >= 0 && rank[nb] < i))) continue;
            const s = fill[c] - (rank[nb] === -2 ? z[nb] : fill[nb]);        // (the mesh's cells near enough one size: the drop alone)
            if (s > steepest) { steepest = s; pick = nb; }
        }
        if (pick < 0) pick = parent[c];
        recv[c] = pick; stepKm[c] = edge(xyz, c, pick);
    }
    R.count = count;
    return R;
}
const edge = (xyz, a, b) => 6371 * Math.hypot(xyz[3 * a] - xyz[3 * b], xyz[3 * a + 1] - xyz[3 * b + 1], xyz[3 * a + 2] - xyz[3 * b + 2]);
