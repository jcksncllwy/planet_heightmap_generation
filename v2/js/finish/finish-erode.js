// A study, behind a flag (F.erode; lane erosion, 2026-10-30): the land's erosion and deposition run through time on the
// finish's mesh, instead of the hollows being judged one by one afterwards. The carve (terrain/carve.js) is one analytic pass
// over a fixed network: it never deposits, and it crosses every hollow at its spill point, so rims are not cut down and
// floors not filled. Here, each step:
//   · the network: a priority flood from the sea and the closed basins' floors, over the ground as it stands;
//   · the stream power with n = 1, solved implicitly down that network from the outlets (Braun & Willett 2013): O(n) a step,
//     stable at any step. The water a lake holds is the receiver's level: below it nothing erodes, and an outlet cutting
//     its sill down lowers the lake behind it within the same step (the new surface e);
//   · the load, from the headwaters down: each reach drops G·Qs/A of what it carries (Yuan et al. 2019's form of the ξ-q
//     model of Davy & Lague 2009: a transport length that grows with the water, G dimensionless). What it drops goes into
//     the next step's implicit solve, as their scheme has it: h = (h₀ + D dt + F h_r) / (1 + F), so a big river (F ≫ 1) carries
//     its deposit straight on and only a slack reach aggrades. (Laid on the ground after the solve instead, it dammed big
//     rivers: mapped hollows stalled at 4.4 Mkm² against 1.1 with no deposition at all, 640K.) A lake keeps what reaches
//     it until it is full (Yuan et al. 2019 route depressions the same way), and what it cannot hold goes on over its outlet;
//   · what a lake kept is laid from its floor up. So a hollow ends one of two ways: filled, or drained by its outlet.
// A closed basin (finish-basins.js closedBasins: the rim against the water balance, re-judged every closedEvery steps) keeps
// its water and all its load. Hillslopes are left to creepByClimate: the geomorphic diffusivity, ~0.01 m²/yr (Fernandes &
// Dietrich 1997, recalled), reaches √(2Dt) ~ 140 m in a Myr, far under any cell here.
// Erosion is the carve's own: its k, its m, its rain-weighted drainage, its active belts' hold, and its share of a cell
// that a valley takes (a coarse cell, holding more than a valley, drops less), so no new erodibility and the same at every detail.
// Heights km, distances km, time Myr.

import { MinHeap } from '../core/min-heap.js';
import { locate } from '../core/mesh-locate.js';

const R = 6371, EPS = 1e-5, FLAT_KEY = 1e-11, LAND_FLOOR = 0.002;

export const ERODE = {
    at: 'early',                // 'early': after the hillslopes, before the ice age; 'late': on the finished ground, just before the water; 'both'
    timeMyr: 1,                 // how long it runs
    steps: 20,                  // in this many steps
    G: 1,                       // Yuan et al. 2019's deposition coefficient (they use 0–~2; 1: a steady river's slope doubled)
    closedEvery: 5,             // closed basins re-judged every this many steps (their water settles in thousands of years)
    routeEvery: 1,              // a new network every this many steps
    iceShare: 0.015,            // 'late' only: under the last ice age's ice the rivers have had 15 kyr of each Myr
    kScale: 1,                  // a multiple of the carve's k (only k × time matters to the solver)
    rebound: 0,                 // the isostatic share of what is taken off or laid on: ρc/ρm (2.7/3.3 ≈ 0.82, Airy), 0 none…
    reboundKm: 350,             // …spread by the lithosphere over this (σ, as finish-config reboundKm), on the coarsest level
    bury: false,                // a level's fill buries the finer relief under it, not rides on it
    delta: false,               // a lake's load is laid from where the rivers come in, out to the lake's level, not flat from its floor up
    lastClean: false,           // the last step lays nothing on the channels: no levee left behind to dam a level plain
    playaYears: 0,              // a salt body shallower on average than this many years of its net evaporation is a playa (0: off)
    polishMyr: 0.1,             // at 'both': after the wind and the coast, this long more…
    polishSteps: 3,             // …in this many steps…
    polishG: 1,                 // …with this deposition
    showKm2: 1600,              // the census's least lake (two cells at 640K: finish-config lakeMinKm2's reach)
    keepRules: [],              // of those rules, the ones left on: 'pit', 'load', 'breach', 'size', 'origin'
    flatRule: true,             // a flat drains by Barnes et al. 2014's two gradients; false: by the flood's pop order, an arbitrary tie
    rulesOff: true,             // the hydrology left with fill-and-spill and the water balance, and the ice's own rules (below)
};

/** The hydrology's lake rules off, by its constants alone (lane erosion: finish-hydro.js itself unchanged). Artifact pits: none
 *  deep enough to count. Fill time: no load. Outlets: the erosion cut them, except the ice's young lakes' (their own
 *  glacialBreachQ). Big-for-its-river: lakeKeepKm2 as good as 0, with the ice's two shares scaled so its lakes keep theirs. */
export function rulesOff(F, keep = []) {
    const tiny = 1e-9, on = rule => keep.includes(rule), out = { ...F };
    if (!on('pit')) { out.pitDepthKm = 0; out.pitBreachKm = 0; }
    if (!on('load')) out.lakeLoadShare = 0;
    if (!on('breach')) out.breachQ = [1e12, 1e13];
    if (!on('size')) { out.lakeKeepKm2 = tiny * F.lakeKeepKm2; out.glacialKeepShare = F.glacialKeepShare / tiny; out.basinKeepShare = F.basinKeepShare / tiny; }
    return out;
}

/**
 * @param {Object} o
 * @param {Object} o.mesh
 * @param {Float32Array} o.z        the ground (km), changed in place
 * @param {Uint8Array} o.ocean      the world ocean
 * @param {Float32Array} o.water    each cell's drainage weight (the carve's rain)
 * @param {Float32Array} o.k        the wave's speed at 1 km² drained (km/Myr)
 * @param {Float32Array} o.hold     how active the belt here is (0–1)
 * @param {(z: Float32Array) => Object} o.closed   closedBasins on this ground
 * @param {Float32Array|null} [o.slow]   a multiple of the rate, per cell (the ice's young ground)
 * @param {number} o.m              the carve's m
 * @param {number} o.activeHold
 * @param {number} o.valleyKm       a valley's width at 10⁴ km²
 * @param {Object} P                ERODE's settings
 */
export function erodeLandscape(o, P) {
    const { mesh, z, ocean, water, k, hold, slow = null, m, activeHold, valleyKm } = o;
    const { adjOffset, adjList, numCells: n, xyz } = mesh, a = 4 * Math.PI * R * R / n, perCell = valleyKm / Math.sqrt(a);
    const dt = P.timeMyr / P.steps;
    const fill = new Float32Array(n), rank = new Int32Array(n), parent = new Int32Array(n), order = new Int32Array(n), recv = new Int32Array(n), step = new Float32Array(n), flat = new Float32Array(n);
    const A = new Float32Array(n), e = new Float32Array(n), dropped = new Float32Array(n), gross = new Float32Array(n), Qs = new Float32Array(n), cap = new Float32Array(n), lid = new Int32Array(n), zNew = new Float32Array(n), heap = new MinHeap(1 << 16);
    // (the sea's edge, once: the cells beside the outlets, and the outlet each is beside)
    const coast = [], coastFrom = [];
    for (let c = 0; c < n; c++) {
        if (ocean[c]) continue;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) if (ocean[adjList[j]]) { coast.push(c); coastFrom.push(adjList[j]); break; }
    }
    let sink = null, base = null, sinkAt = null, basins = [], count = 0;
    const closed = () => {
        const B = o.closed(z);
        sink = B.sink; base = B.base; basins = [];
        sinkAt = sinkAt ?? new Int32Array(n);
        sinkAt.fill(-1);
        for (const L of B.lakes) if (sink[L.cells[0]]) { for (const c of L.cells) sinkAt[c] = basins.length; basins.push({ cells: L.cells, level: L.level, load: 0 }); }
    };
    const route = () => {
        rank.fill(-1); parent.fill(-1);
        for (let c = 0; c < n; c++) if (ocean[c] || sink[c]) rank[c] = -2;
        for (let i = 0; i < coast.length; i++) {
            const c = coast[i];
            if (rank[c] === -2) continue;
            const v = Math.max(0, z[c]);
            if (parent[c] === -1 || v < fill[c]) { parent[c] = coastFrom[i]; fill[c] = v; flat[c] = 0; heap.push(v, c); }
        }
        for (const B of basins) for (const c of B.cells) for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
            const nb = adjList[j];
            if (rank[nb] === -2) continue;
            const v = Math.max(base[c], z[nb]);
            if (parent[nb] === -1 || v < fill[nb]) { parent[nb] = c; fill[nb] = v; flat[nb] = 0; heap.push(v, nb); }
        }
        count = 0;
        while (heap.size) {
            const c = heap.pop();
            if (rank[c] !== -1) continue;
            rank[c] = count; order[count++] = c;
            const fc = fill[c];
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
                const nb = adjList[j];
                if (rank[nb] !== -1) continue;
                const level = fc > z[nb] ? fc : z[nb];
                if (parent[nb] === -1 || level < fill[nb]) { parent[nb] = c; fill[nb] = level; flat[nb] = level === fc ? flat[c] + 1 : 0; heap.push(level + FLAT_KEY * flat[nb], nb); }
            }
        }
        // (the steepest way down the filled surface to a cell reached before; on a flat, the flood's way)
        for (let i = 0; i < count; i++) {
            const c = order[i], fc = fill[c];
            let pick = -1, drop = 0;
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
                const nb = adjList[j], rn = rank[nb];
                if (!(rn === -2 || (rn >= 0 && rn < i))) continue;
                const s = fc - (rn === -2 ? surfaceOut(nb) : fill[nb]);
                if (s > drop) { drop = s; pick = nb; }
            }
            if (pick < 0 && P.flatRule) {
                // (no way down: a cell beside an outlet takes it, any other waits for its flat's two gradients)
                for (let j = adjOffset[c]; j < adjOffset[c + 1] && pick < 0; j++) if (rank[adjList[j]] === -2) pick = adjList[j];
                if (pick < 0) { recv[c] = -1; flats.push(c); continue; }
            }
            if (pick < 0) pick = parent[c];
            recv[c] = pick;
            step[c] = R * Math.hypot(xyz[3 * pick] - xyz[3 * c], xyz[3 * pick + 1] - xyz[3 * c + 1], xyz[3 * pick + 2] - xyz[3 * c + 2]);
        }
        if (flats.length) drainFlats();
    };
    // (A flat has no gradient, so its water's path is a choice, and the flood's pop order is an arbitrary one. Garbrecht & Martz 1997:
    // drainage runs away from higher ground and towards lower; Barnes, Lehman & Mulla 2014 superimpose the two, the second twice over so
    // that every flat cell has a neighbour further along: 2·(hops from the lower edge) − (hops from the higher edge), the flat's maximum
    // of the second being a constant only differences see. A flat with no higher edge has only the first. Each cell drains to the
    // neighbour lowest on that surface, the first in adjacency order on a tie. Lakes' cells are flats too: this is their way to the outlet.
    // Same rule, same ties as gpu/erode-gpu.js, so the two paths choose alike. The receivers no longer follow the flood, so order is rebuilt.)
    const flats = [], low = new Int32Array(n), high = new Int32Array(n), kids = new Int32Array(n), way = new Int32Array(n), mark = new Uint8Array(n), isFlat = c => mark[c] === 1;
    const wave = (seed, on) => { for (let q = seed, d = 1; q.length; d++) { const next = []; for (const c of q) { for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (isFlat(y) && on[y] === 0 && fill[y] === fill[c]) { on[y] = d + 1; next.push(y); } } } q = next; } };
    const drainFlats = () => {
        const toLow = [], toHigh = [];
        for (const c of flats) mark[c] = 1;
        for (const c of flats) {
            low[c] = 0; high[c] = 0;
            let exit = false, wall = false;
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (rank[y] < 0) continue; if (fill[y] === fill[c] && !isFlat(y)) exit = true; if (fill[y] > fill[c]) wall = true; }
            if (exit) { low[c] = 1; toLow.push(c); }
            if (wall) { high[c] = 1; toHigh.push(c); }
        }
        wave(toLow, low); wave(toHigh, high);
        for (const c of flats) {
            let pick = -1, best = Infinity;
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
                const y = adjList[j];
                if (rank[y] < 0 || fill[y] !== fill[c]) continue;
                if (!isFlat(y)) { pick = y; break; }
                const v = 2 * low[y] - high[y];
                if (low[y] > 0 && v < best) { best = v; pick = y; }
            }
            way[c] = pick < 0 ? parent[c] : pick;
        }
        for (const c of flats) { const pick = way[c]; recv[c] = pick; step[c] = R * Math.hypot(xyz[3 * pick] - xyz[3 * c], xyz[3 * pick + 1] - xyz[3 * c + 1], xyz[3 * pick + 2] - xyz[3 * c + 2]); mark[c] = 0; }
        // (receivers before donors)
        kids.fill(0);
        for (let i = 0; i < count; i++) { const r = recv[order[i]]; if (rank[r] >= 0) kids[r]++; }
        const stack = [];
        for (let i = 0; i < count; i++) if (!kids[order[i]]) stack.push(order[i]);
        for (let at = count; stack.length;) { const c = stack.pop(), r = recv[c]; order[--at] = c; if (rank[r] >= 0 && --kids[r] === 0) stack.push(r); }
        flats.length = 0;
    };
    const surfaceOut = c => (ocean[c] ? Math.min(0, z[c]) : base[c]);
    const wetSteps = P.trace ? new Uint16Array(n) : null;
    // (a delta: what came in by each mouth fills the water nearest that mouth up to `surface`, so a filling lake shrinks and
    // stays deep beyond the front. Laid flat from the floor, it would keep all its area until the last metre: a wide sheet)
    const inlet = P.delta ? new Float64Array(n) : null, been = P.delta ? new Int32Array(n).fill(-1) : null;
    let walk = 0;
    const layDeltas = (cells, vol, surface, inside) => {
        const mouths = [];
        let all = 0;
        for (const c of cells) if (inlet[c] > 0) { mouths.push(c); all += inlet[c]; }
        if (!all) return layUp(z, cells, vol, Infinity);
        mouths.sort((x, y) => inlet[y] - inlet[x]);
        for (const c0 of mouths) {
            let left = vol * inlet[c0] / all;
            const q = [c0], id = walk++;
            been[c0] = id;
            for (let i = 0; i < q.length && left > 0; i++) {
                const c = q[i], room = surface(c) - z[c];
                if (room > 0) { const put = room < left ? room : left; z[c] += put; left -= put; }
                for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (been[y] !== id && inside(y)) { been[y] = id; q.push(y); } }
            }
        }
    };
    // (the lithosphere's answer to what has moved since it last settled: the change blurred over its flexural reach, its share
    // taken back. Land only; the sea's floor stays, so what the blur carries offshore is lost to the land, as flexure's is)
    const anchor = P.rebound > 0 ? z.slice() : null;
    let reboundKm3 = 0;
    const settle = () => {
        const d = new Float32Array(n), next = new Float32Array(n);
        for (let c = 0; c < n; c++) if (!ocean[c]) d[c] = z[c] - anchor[c];
        const need = 2 * P.reboundKm * P.reboundKm / (mesh.edgeKm * mesh.edgeKm), passes = Math.ceil(need / 0.5), w = need / passes;
        for (let p = 0; p < passes; p++) {
            for (let c = 0; c < n; c++) {
                let v = 0, m = 0;
                for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { v += d[adjList[j]]; m++; }
                next[c] = d[c] + w * (v / m - d[c]);
            }
            d.set(next);
        }
        for (let c = 0; c < n; c++) {
            if (ocean[c]) continue;
            const was = z[c];
            z[c] -= P.rebound * d[c];
            if (was > 0 && z[c] < LAND_FLOOR) z[c] = Math.min(was, LAND_FLOOR);
            reboundKm3 += (z[c] - was) * a;
            anchor[c] = z[c];
        }
    };
    const curve = [], t = { route: 0, closed: 0, solve: 0, load: 0, lay: 0 };
    for (let s = 0; s < P.steps; s++) {
        let t0 = performance.now();
        const lap = name => { const t1 = performance.now(); t[name] += t1 - t0; t0 = t1; };
        if (P.rebound > 0 && s > 0 && s % P.closedEvery === 0) settle();
        if (s % P.closedEvery === 0) { closed(); lap('closed'); route(); lap('route'); } else if (s % P.routeEvery === 0) { route(); lap('route'); }
        // ── the water, headwaters first ──
        A.fill(0);
        for (let i = count - 1; i >= 0; i--) { const c = order[i], r = recv[c]; A[c] += a * water[c]; if (rank[r] >= 0) A[r] += A[c]; }
        // ── the stream power, from the outlets up: each cell against its receiver's new surface. A cell under its lake
        // does not erode, and stands under the new surface of what it drains to ──
        let lakes = 0, lakeCells = 0;
        for (let i = 0; i < count; i++) {
            const c = order[i], r = recv[c], out = rank[r] < 0, under = out ? surfaceOut(r) : e[r], old = z[c] + dropped[c];
            gross[c] = 0;
            if (fill[c] > z[c] + EPS) {
                e[c] = old > under ? old : under; zNew[c] = old; lakeCells++;
                lid[c] = !out && lid[r] >= 0 && fill[r] === fill[c] ? lid[r] : lakes++;
                continue;
            }
            lid[c] = -1;
            const Ac = A[c] > 1e-6 ? A[c] : 1e-6, share = Math.min(1, perCell * Math.sqrt(Ac / 1e4));
            const F = share * P.kScale * k[c] * (1 - activeHold * hold[c]) * (slow ? slow[c] : 1) * Ac ** m * dt / step[c];
            let h = (old + F * under) / (1 + F);
            if (h < LAND_FLOOR + under) h = Math.min(old, LAND_FLOOR + under);
            zNew[c] = h; e[c] = h; gross[c] = old > h ? old - h : 0;     // (= F (h − under): the rate, implicit)
        }
        lap('solve');
        // ── the load, from the headwaters down ──
        Qs.fill(0); cap.fill(0);
        inlet?.fill(0);
        const trap = new Float64Array(lakes);
        let eroded = 0, toSea = 0, kept = 0, inClosed = 0;
        for (let i = count - 1; i >= 0; i--) {
            const c = order[i], r = recv[c], cut = gross[c] * a, out = rank[r] < 0;
            dropped[c] = 0;
            let q = Qs[c] + cut;
            eroded += cut;
            if (lid[c] >= 0) {
                const room = cap[c] + Math.max(0, e[c] - z[c]) * a;
                if (!out && lid[r] === lid[c]) { Qs[r] += q; cap[r] += room; continue; }
                const hold = q < room ? q : room;
                trap[lid[c]] = hold; q -= hold; kept += hold;
            } else {
                const d = s === P.steps - 1 && P.lastClean ? 0 : q * Math.min(1, P.G * a / (A[c] > a * 1e-3 ? A[c] : a * 1e-3));
                dropped[c] = d / a; q -= d; kept += d;
            }
            if (!out) { Qs[r] += q; if (inlet && lid[r] >= 0 && lid[r] !== lid[c]) inlet[r] += q; }
            else if (sinkAt[r] >= 0) { basins[sinkAt[r]].load += q; inClosed += q; if (inlet) inlet[r] += q; }
            else toSea += q;
        }
        lap('load');
        for (let i = 0; i < count; i++) { const c = order[i]; z[c] = zNew[c]; }
        // ── what a lake kept, laid from its floor up: its cells gathered by lake, each lake's sorted by height ──
        const at = new Int32Array(lakes + 1);
        for (let i = 0; i < count; i++) { const L = lid[order[i]]; if (L >= 0 && trap[L] > 0) at[L + 1]++; }
        for (let L = 0; L < lakes; L++) at[L + 1] += at[L];
        const cells = new Int32Array(at[lakes]), put = at.slice(0, lakes);
        for (let i = 0; i < count; i++) { const c = order[i], L = lid[c]; if (L >= 0 && trap[L] > 0) cells[put[L]++] = c; }
        for (let L = 0; L < lakes; L++) if (trap[L] > 0) {
            if (P.delta) layDeltas(cells.subarray(at[L], at[L + 1]), trap[L] / a, c => e[c], c => lid[c] === L);
            else layUp(z, cells.subarray(at[L], at[L + 1]), trap[L] / a, Infinity);
        }
        basins.forEach((B, b) => {
            if (!(B.load > 0)) return;
            if (P.delta) layDeltas(B.cells, B.load / a, () => B.level, c => sinkAt[c] === b);
            else layUp(z, B.cells, B.load / a, B.level);
            B.load = 0;
        });
        lap('lay');
        // (the census: this step's hollows by size — the map's lakes start at showKm2 — and those a reach's own deposit made)
        const size = new Int32Array(lakes);
        for (let i = 0; i < count; i++) { const L = lid[order[i]]; if (L >= 0) size[L]++; }
        if (wetSteps) for (let i = 0; i < count; i++) { const c = order[i]; wetSteps[c] = lid[c] >= 0 ? wetSteps[c] + 1 : 0; }
        let shown = 0, shownKm2 = 0, one = 0;
        for (let L = 0; L < lakes; L++) { if (size[L] * a >= P.showKm2) { shown++; shownKm2 += size[L] * a; } if (size[L] === 1) one++; }
        curve.push({ shown, shownMkm2: +(shownKm2 / 1e6).toFixed(3), one, t: +((s + 1) * dt).toFixed(3), lakeMkm2: +(lakeCells * a / 1e6).toFixed(3), lakes, erodedKm3: Math.round(eroded), keptKm3: Math.round(kept), seaKm3: Math.round(toSea), closedKm3: Math.round(inClosed) });
    }
    // (the trace: the hollows left at the end — how long each has stood, and what runs through it)
    let survivors = null;
    if (P.trace) {
        const seen = new Uint8Array(n), list = [];
        for (let i = 0; i < count; i++) {
            const s0 = order[i];
            if (seen[s0] || lid[s0] < 0) continue;
            const q = [s0];
            seen[s0] = 1;
            let lo = s0, age = 0, volKm3 = 0, top = 0;
            for (let j = 0; j < q.length; j++) {
                const x = q[j];
                if (z[x] < z[lo]) lo = x;
                age += wetSteps[x]; volKm3 += Math.max(0, e[x] - z[x]) * a; if (A[x] > top) top = A[x];
                for (let g = adjOffset[x]; g < adjOffset[x + 1]; g++) { const y = adjList[g]; if (!seen[y] && rank[y] >= 0 && lid[y] === lid[s0]) { seen[y] = 1; q.push(y); } }
            }
            list.push({ km2: q.length * a, depthM: Math.round(1000 * (e[s0] - z[lo])), levelM: Math.round(1000 * e[s0]), meanAgeMyr: +(age / q.length * dt).toFixed(2), volKm3: Math.round(volKm3), inflowKm2: Math.round(top), lat: +(Math.asin(xyz[3 * lo + 2]) * 180 / Math.PI).toFixed(1), lon: +(Math.atan2(xyz[3 * lo + 1], xyz[3 * lo]) * 180 / Math.PI).toFixed(1) });
        }
        const shown = list.filter(h => h.km2 >= P.showKm2).sort((x, y) => y.km2 - x.km2), all = shown.reduce((v, h) => v + h.km2, 0) || 1, share = f => +(shown.filter(f).reduce((v, h) => v + h.km2, 0) / all).toFixed(2);
        survivors = { top: shown.slice(0, 14), byAge: { under20pct: share(h => h.meanAgeMyr < 0.2 * P.timeMyr), over80pct: share(h => h.meanAgeMyr >= 0.8 * P.timeMyr) }, shallow30m: share(h => h.depthM < 30), smallInflow: share(h => h.inflowKm2 < 3 * h.km2) };
    }
    for (let c = 0; c < n; c++) if (dropped[c] > 0) z[c] += dropped[c];       // (the last step's)
    if (P.rebound > 0 && P.steps > 0) settle();
    let seaKm3 = 0, closedKm3 = 0, grossKm3 = 0;
    for (const p of curve) { seaKm3 += p.seaKm3; closedKm3 += p.closedKm3; grossKm3 += p.erodedKm3; }
    const perYr = v => +(v / Math.max(1e-9, P.timeMyr) * 1e-6).toFixed(2);
    const budget = { seaKm3PerYr: perYr(seaKm3), closedKm3PerYr: perYr(closedKm3), grossKm3PerYr: perYr(grossKm3), reboundKm3PerYr: perYr(reboundKm3) };
    return { curve, survivors, budget, ms: Object.fromEntries(Object.entries(t).map(([key, v]) => [key, Math.round(v)])) };
}

/**
 * A terminal body that loses in a year more than the water it stands in is no lake: its year's inflow is what its evaporation
 * takes, so with seasons it dries (Lake Eyre, about 1.5 m when it fills, mostly dry). Its cells become a pan.
 * @returns {number} km² turned to pan
 */
export function playas(mesh, lake, level, z, pet, rain, F, years, SALT, PAN) {
    const { adjOffset, adjList, numCells: n } = mesh, seen = new Uint8Array(n), a = 4 * Math.PI * R * R / n;
    let km2 = 0;
    for (let s = 0; s < n; s++) {
        if (seen[s] || lake[s] !== SALT) continue;
        const q = [s];
        seen[s] = 1;
        let depth = 0, lose = 0;
        for (let i = 0; i < q.length; i++) {
            const c = q[i];
            depth += Math.max(0, level[c] - z[c]);
            lose += Math.max(0, F.lakeEvapShare * pet[c] - Math.max(0, rain[c]));
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (!seen[y] && lake[y] === SALT) { seen[y] = 1; q.push(y); } }
        }
        if (depth * 1000 / q.length >= years * lose * 1e-3 / q.length) continue;
        for (const c of q) lake[c] = PAN;
        km2 += q.length * a;
    }
    return km2;
}

/** For each cell of `fine`: the 3 cells of `coarse` around it, their weights, and the nearest of them. */
function mapOnto(coarse, fine) {
    const n = fine.numCells, cells = new Int32Array(3 * n), weights = new Float32Array(3 * n), nearest = new Int32Array(n), c3 = [0, 0, 0], w3 = [0, 0, 0], { xyz } = fine;
    for (let i = 0; i < n; i++) {
        locate(coarse, xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2], c3, w3);
        let best = 0;
        for (let j = 0; j < 3; j++) { cells[3 * i + j] = c3[j]; weights[3 * i + j] = w3[j]; if (w3[j] > w3[best]) best = j; }
        nearest[i] = c3[best];
    }
    return { cells, weights, nearest };
}
/** A fine field's mean over each coarse cell (a coarse cell no fine cell fell in, rare at a factor 4, takes `empty`; NaN skipped). */
function meanOnto(M, fine, coarseN, empty = 0) {
    const sum = new Float64Array(coarseN), cnt = new Uint32Array(coarseN), o = new Float32Array(coarseN), near = M.nearest;
    for (let i = 0; i < fine.length; i++) { const v = fine[i]; if (v === v) { sum[near[i]] += v; cnt[near[i]]++; } }
    for (let c = 0; c < coarseN; c++) o[c] = cnt[c] ? sum[c] / cnt[c] : empty;
    return o;
}
function carry(M, values, out) {
    const { cells, weights } = M, n = out.length;
    for (let i = 0; i < n; i++) out[i] += weights[3 * i] * values[cells[3 * i]] + weights[3 * i + 1] * values[cells[3 * i + 1]] + weights[3 * i + 2] * values[cells[3 * i + 2]];
}

/**
 * Coarse to fine: the long span on a coarse mesh, where the big hollows and the great rivers are settled at little cost, then a
 * few short steps at each finer level, from that level's own surface plus all the change found below it. Short wavelengths
 * come to terms fast: the stream power's wave crosses a small catchment in a fraction of the span, so few steps should drain or
 * fill the fine hollows. P.ladder: [{ cells (absent: this mesh), timeMyr, steps }, …], coarsest first. Fields as
 * erodeLandscape's, plus runoff, pet, rain for closedOf(mesh, z, fields, ocean).
 */
export function erodeLadder(o, P, meshOf) {
    const { mesh, z, ocean, closedOf } = o, N = mesh.numCells, levels = P.ladder, out = [];
    const coarse = new Map();
    let prev = null, delta = null, prevZ = null;                         // (the level below, the change it found, its surface)
    for (const L of levels) {
        const fine = !L.cells || L.cells >= 0.9 * N, lm = fine ? mesh : meshOf(L.cells), t0 = performance.now();
        let M = coarse.get(lm.numCells), f;
        if (fine) f = { z, ocean, water: o.water, k: o.k, hold: o.hold, runoff: o.runoff, pet: o.pet, rain: o.rain };
        else {
            if (!M) coarse.set(lm.numCells, M = { down: mapOnto(lm, mesh) });
            const m = lm.numCells, sea = meanOnto(M.down, ocean, m, 1), oc = new Uint8Array(m);
            for (let c = 0; c < m; c++) oc[c] = sea[c] > 0.5 ? 1 : 0;
            f = { z: meanOnto(M.down, z, m), ocean: oc, water: meanOnto(M.down, o.water, m, 1), k: meanOnto(M.down, o.k, m, 5), hold: meanOnto(M.down, o.hold, m), runoff: meanOnto(M.down, o.runoff, m), pet: meanOnto(M.down, o.pet, m, 1000), rain: meanOnto(M.down, o.rain, m) };
        }
        const start = f.z.slice();
        if (delta) {
            const U = mapOnto(prev, lm), before = fine ? z.slice() : f.z.slice();
            if (P.bury) {
                // (what the level below eroded comes off this surface; what it laid down buries it: the finer relief under a
                // fill is under it, not carried up on top of it)
                const cut = delta.map(v => Math.min(0, v)), laid = new Float32Array(lm.numCells), top = new Float32Array(lm.numCells), mask = delta.map(v => (v > 0 ? 1 : 0)), m3 = new Float32Array(lm.numCells);
                carry(U, cut, f.z); carry(U, delta.map(v => Math.max(0, v)), laid); carry(U, prevZ, top); carry(U, mask, m3);
                for (let c = 0; c < lm.numCells; c++) if (laid[c] > 0) { const buried = top[c]; f.z[c] = Math.max(f.z[c], m3[c] * buried + (1 - m3[c]) * (f.z[c] + laid[c])); }
            } else carry(U, delta, f.z);
            // (land stays land, the sea stays where it was)
            for (let c = 0; c < lm.numCells; c++) { if (f.ocean[c]) f.z[c] = before[c]; else if (before[c] > 0 && f.z[c] < LAND_FLOOR) f.z[c] = Math.min(before[c], LAND_FLOOR); }
        }
        const r = erodeLandscape({ ...o, mesh: lm, z: f.z, ocean: f.ocean, water: f.water, k: f.k, hold: f.hold, closed: g => closedOf(lm, g, f, f.ocean) }, { ...P, timeMyr: L.timeMyr, steps: L.steps, rebound: L === levels[0] ? P.rebound : 0 });
        out.push({ cells: lm.numCells, timeMyr: L.timeMyr, steps: L.steps, seconds: +((performance.now() - t0) / 1000).toFixed(2), ms: r.ms, last: r.curve[r.curve.length - 1], budget: r.budget });
        delta = new Float32Array(lm.numCells);
        for (let c = 0; c < lm.numCells; c++) delta[c] = f.z[c] - start[c];
        prev = lm; prevZ = f.z;
    }
    return { curve: [], ms: {}, levels: out };
}

/** The hollows of a surface, for the study: a priority flood from the sea; bodies under one spill level, the map's size and
 *  lakeMinDepthM deep; their area (km²) and count. `closed` (1: a closed basin's cell) counted apart. */
export function hollowCensus(mesh, z, ocean, closed, minKm2, minKm) {
    const { adjOffset, adjList, numCells: n } = mesh, a = 4 * Math.PI * R * R / n, fill = new Float32Array(n).fill(Infinity), heap = new MinHeap(1 << 16);
    for (let c = 0; c < n; c++) if (ocean[c]) for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const nb = adjList[j]; if (!ocean[nb]) heap.push(Math.max(0, z[nb]), nb); }
    while (heap.size) {
        const c = heap.pop(), v = heap.lastKey;
        if (fill[c] !== Infinity) continue;
        fill[c] = v;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const nb = adjList[j]; if (!ocean[nb] && fill[nb] === Infinity) heap.push(Math.max(v, z[nb]), nb); }
    }
    const seen = new Uint8Array(n), out = { km2: 0, bodies: 0, closedKm2: 0, under1kKm3: 0 };
    for (let s = 0; s < n; s++) {
        if (ocean[s] || seen[s] || !(fill[s] > z[s] + 1e-4)) continue;
        const q = [s];
        seen[s] = 1;
        let floor = z[s], shut = 0, vol = 0;
        for (let i = 0; i < q.length; i++) {
            const c = q[i];
            if (z[c] < floor) floor = z[c];
            if (closed?.[c]) shut++;
            vol += (fill[c] - z[c]) * a;
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const nb = adjList[j]; if (!seen[nb] && !ocean[nb] && fill[nb] > z[nb] + 1e-4 && fill[nb] === fill[s]) { seen[nb] = 1; q.push(nb); } }
        }
        if (q.length * a < minKm2 || fill[s] - floor < minKm) continue;
        if (shut >= 0.5 * q.length) out.closedKm2 += q.length * a;
        else { out.km2 += q.length * a; out.bodies++; if (vol < 1000) out.under1kKm3 += q.length * a; }
    }
    return { openMkm2: +(out.km2 / 1e6).toFixed(3), openBodies: out.bodies, closedMkm2: +(out.closedKm2 / 1e6).toFixed(3), openUnder1kKm3Mkm2: +(out.under1kKm3 / 1e6).toFixed(3) };
}

/** `vol` (km³ ÷ a cell's area: km) laid over `cells` from the lowest up, to a level no higher than `top`. */
function layUp(z, cells, vol, top) {
    const h = Float32Array.from(cells, c => z[c]).sort();
    let level = h[0], left = vol, i = 1;
    for (; i < h.length; i++) {
        const need = i * (h[i] - level);
        if (need >= left) break;
        left -= need; level = h[i];
    }
    level += left / i;
    if (level > top) level = top;
    const m = cells.length;
    for (let j = 0; j < m; j++) if (z[cells[j]] < level) z[cells[j]] = level;
}
