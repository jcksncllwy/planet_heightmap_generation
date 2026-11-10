// The finish's erosion (lane erosion, 2026-10-30; the default since 2026-11-01, Jackson: F.erode in finish-config.js, false turns
// it off): the land's erosion and deposition run through time on the finish's mesh, instead of the hollows being judged one by
// one afterwards. The carve (terrain/carve.js) is one analytic pass
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
// its water and all its load. Hillslopes, on the GPU only: Tzathas et al. 2024's k_h·A^−0.6 term in the
// stream power and threshold diffusion (ERODE hillD, diffD); the geomorphic diffusivity, ~0.01 m²/yr (Fernandes & Dietrich
// 1997, recalled), reaches √(2Dt) ~ 140 m in a Myr, far under any cell here.
// Erosion is the carve's own: its k, its m, its rain-weighted drainage, on the whole cell (a cell's mean lowering, at every
// detail); an active belt keeps its rivers high by the history's uplift (o.uplift), not by a hold on its rate.
// Heights km, distances km, time Myr.

import { MinHeap } from '../core/min-heap.js';
import { locate } from '../core/mesh-locate.js';

const R = 6371, EPS = 1e-5, FLAT_KEY = 1e-11;

// The design erosion-report.md settled on ("Final design", Answer), run on three seeds at 2.5M. It is a chosen compromise, not
// a converged result: the span has no plateau (0.5 Myr at the coarsest level; the solver sees only k·t).
export const ERODE = {
    at: 'both',                 // 'early': after the sediment, before the ice age; 'late': on the finished ground, just before the water; 'both'
    ladder: [                   // coarse to fine (erodeLadder), each { cells (absent: the shown mesh), timeMyr, steps }; null: one run…
        { cells: 160000, timeMyr: 0.5, steps: 10 },
        { cells: 640000, timeMyr: 0.2, steps: 4 },
        { timeMyr: 0.1, steps: 2 },
    ],
    timeMyr: 1,                 // …of this long…
    steps: 20,                  // …in this many steps
    G: 1,                       // Yuan et al. 2019's deposition coefficient (they use 0–~2; 1: a steady river's slope doubled), for the bed material…
    GFine: 0.5,                 // …and for the mud. G goes with settling speed (Davy & Lague 2009), so mud's is less than sand's. 0.5 with
                                // the ~100× k_rock (geology-config.js erodeGain 7.1) gives Earth's ~10 km³/yr to the sea: see README
    column: true,               // k reads the rock column (finish-lithology.js rockColumn), and the load is split into bed material and mud
    closedEvery: 5,             // closed basins re-judged every this many steps (their water settles in thousands of years)
    routeEvery: 1,              // a new network every this many steps
    iceShare: 0.015,            // 'late' only: under the last ice age's ice the rivers have had 15 kyr of each Myr
    kScale: 1,                  // a multiple of the carve's k (only k × time matters to the solver)
    rebound: 0.82,              // the isostatic share of what is taken off or laid on: ρc/ρm (2.7/3.3 ≈ 0.82, Airy), 0 none…
    reboundKm: 350,             // …spread by the lithosphere over this (σ, as finish-config reboundKm), on the coarsest level
    bury: true,                 // a level's fill buries the finer relief under it, not rides on it
    delta: true,                // a lake's load is laid from where the rivers come in, out to the lake's level, not flat from its floor up
    lastClean: false,           // the last step lays nothing on the channels: no levee left behind to dam a level plain
    playaYears: 1,              // a salt body shallower on average than this many years of its net evaporation is a playa (0: off)
    polishMyr: 0.3,             // at 'both': after the wind and the coast, this long more…
    polishSteps: 6,             // …in this many steps…
    polishG: 1,                 // …with this deposition
    showKm2: 1600,              // the census's least lake (two cells at 640K: finish-config lakeMinKm2's reach)
    gpu: true,                  // on the GPU where there is one (gpu/erode-gpu.js; a browser's navigator.gpu, or Dawn under the tools: finish.js)…
    gpuFloodCells: 500000,      // …and closed basins' flood with it from this many cells: below them, it costs more than it saves (gpu-report.md)
    hillD: 0,                   // GPU only: the hillslopes' and landslides' diffusivity, km²/Myr, as a stream-power term k_h·A^−0.6 (k_h = D/1.4: erode-gpu.js)
    diffD: 0,                   // GPU only: nonlinear threshold diffusion's D, km²/Myr (Roering et al. 1999; 0.01 is a soil's), 0: none…
    diffSc: 1.25,               // …its critical slope…
    diffSweeps: 20,             // …and the Jacobi sweeps of its implicit step
    spanWindow: true,           // the ladder's coarsest rung stretched to the moment's window (frame tectSpanMyr), at its own dt…
    spanMaxMyr: 20,             // …up to this long (a history's first frame counts its window from the start: a cost cap)
    spanSplit: 'even',          // …every rung stretched alike ('even'), or all of it on the coarsest ('coarse': leaves the 160K rung's ~100 km
                                // interfluves as isolated mounds on the plains — fluvial5 A/B, 2026-11-10)
    tectUplift: true,           // the history's tectonic rise (frame tectRateKm) lifts the ground as it erodes, rebounding at every level
    flatRule: true,             // a flat drains by Barnes et al. 2014's two gradients; false: by the flood's pop order, an arbitrary tie
};

/**
 * @param {Object} o
 * @param {Object} o.mesh
 * @param {Float32Array} o.z        the ground (km), changed in place
 * @param {Uint8Array} o.ocean      the world ocean
 * @param {Float32Array} o.water    each cell's drainage weight (the carve's rain)
 * @param {Float32Array} o.k        the wave's speed at 1 km² drained (km/Myr)
 * @param {(z: Float32Array, flood?: Object) => Object} o.closed   closedBasins on this ground (flood: the GPU path's, finish-basins.js)
 * @param {Float32Array|null} [o.slow]   a multiple of the rate, per cell (the ice's young ground)
 * @param {Object|null} [o.column]       the rock column on this mesh (loose, zBed, fine: rockColumn)
 * @param {Float32Array|null} [o.uplift] the history's surface uplift here, km/Myr, signed (its frame's tectRateKm: the rise its
 *                                       tectonic terms gave the ground, isostasy included, erosion not): added to the ground each step
 * @param {{mesh: Object, map: Object}|null} [o.flex] a finer ladder level's: its rebound blurs on this coarser mesh (rebounder)
 * @param {number} o.m              the carve's m
 * @param {Object} P                ERODE's settings
 */
export function erodeLandscape(o, P) {
    const { mesh, z, ocean, water, k, slow = null, m, column = null, uplift = null } = o;
    const { adjOffset, adjList, numCells: n, xyz } = mesh, a = 4 * Math.PI * R * R / n;
    const dt = P.timeMyr / P.steps;
    // (the sea's surface, as a float32: the heights and the GPU's are, and −0.12 is not one — read as a double, a flat at the sea
    // would stand a hair above it, and the two paths part)
    const seaKm = Math.fround(o.seaKm ?? 0);
    const fill = new Float32Array(n), rank = new Int32Array(n), parent = new Int32Array(n), order = new Int32Array(n), recv = new Int32Array(n), step = new Float32Array(n), flat = new Float32Array(n);
    // (the last step's load each cell passes on, km³/Myr, and to which cell: the rivers' supply for bayheadFill)
    const outQ = new Float32Array(n), outR = new Int32Array(n).fill(-1);
    const A = new Float32Array(n), e = new Float32Array(n), dropped = new Float32Array(n), gross = new Float32Array(n), Qs = new Float32Array(n), Qf = column ? new Float32Array(n) : null, cap = new Float32Array(n), lid = new Int32Array(n), zNew = new Float32Array(n), heap = new MinHeap(1 << 16);
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
            const v = Math.max(seaKm, z[c]);     // (the sea's surface: the lowstand's during early erosion, as surfaceOut)
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
    // (rivers end at the sea's surface, not its floor: graded to the seabed, coasts were cut below sea level, ~500 false lakes a seed)
    const surfaceOut = c => (ocean[c] ? seaKm : base[c]);
    const wetSteps = P.trace ? new Uint16Array(n) : null;
    // (a delta: what came in by each mouth fills the water nearest that mouth up to `surface`, so a filling lake shrinks and
    // stays deep beyond the front. Laid flat from the floor, it would keep all its area until the last metre: a wide sheet)
    const inlet = P.delta ? new Float64Array(n) : null, layDeltas = P.delta ? deltaLayer(mesh, z, inlet) : null;
    const settle = P.rebound > 0 ? rebounder(mesh, z, ocean, P, column, seaKm, uplift, o.flex ?? null) : null;
    let reboundKm3 = 0;
    const curve = [], t = { route: 0, closed: 0, solve: 0, load: 0, lay: 0 };
    for (let s = 0; s < P.steps; s++) {
        let t0 = performance.now();
        const lap = name => { const t1 = performance.now(); t[name] += t1 - t0; t0 = t1; };
        if (settle && s > 0 && s % P.closedEvery === 0) reboundKm3 += settle(s * dt);
        if (s % P.closedEvery === 0) { closed(); lap('closed'); route(); lap('route'); } else if (s % P.routeEvery === 0) { route(); lap('route'); }
        // ── the water, headwaters first ──
        A.fill(0);
        for (let i = count - 1; i >= 0; i--) { const c = order[i], r = recv[c]; A[c] += a * water[c]; if (rank[r] >= 0) A[r] += A[c]; }
        // ── the stream power, from the outlets up: each cell against its receiver's new surface. A cell under its lake
        // does not erode, and stands under the new surface of what it drains to ──
        let lakes = 0, lakeCells = 0;
        for (let i = 0; i < count; i++) {
            const c = order[i], r = recv[c], out = rank[r] < 0, under = out ? surfaceOut(r) : e[r], old = z[c] + dropped[c] + (uplift ? Math.fround(uplift[c] * dt) : 0);
            gross[c] = 0;
            if (fill[c] > z[c] + EPS) {
                e[c] = old > under ? old : under; zNew[c] = old; lakeCells++;
                lid[c] = !out && lid[r] >= 0 && fill[r] === fill[c] ? lid[r] : lakes++;
                continue;
            }
            lid[c] = -1;
            const Ac = A[c] > 1e-6 ? A[c] : 1e-6;
            // (the layer it cuts: its own sediment, or the rock)
            const layer = column && old > column.zBed[c] + 1e-4 ? column.loose[c] : 1;
            const F = P.kScale * k[c] * layer * (slow ? slow[c] : 1) * Ac ** m * dt / step[c];
            // (stream power cuts only down a slope: a reach whose receiver now stands above it keeps its ground. No floor
            // above the base level: the flood afterwards says what is land)
            const h = old > under ? (old + F * under) / (1 + F) : old;
            zNew[c] = h; e[c] = h; gross[c] = old > h ? old - h : 0;     // (= F (h − under): the rate, implicit)
        }
        lap('solve');
        // ── the load, from the headwaters down ──
        Qs.fill(0); cap.fill(0); Qf?.fill(0);
        inlet?.fill(0);
        const trap = new Float64Array(lakes), last = s === P.steps - 1;
        let eroded = 0, toSea = 0, kept = 0, inClosed = 0;
        for (let i = count - 1; i >= 0; i--) {
            const c = order[i], r = recv[c], cut = gross[c] * a, out = rank[r] < 0;
            dropped[c] = 0;
            let q = Qs[c] + cut, mud = column ? Qf[c] + cut * column.fine[c] : 0;
            eroded += cut;
            if (lid[c] >= 0) {
                const room = cap[c] + Math.max(0, e[c] - z[c]) * a;
                if (!out && lid[r] === lid[c]) { Qs[r] += q; cap[r] += room; if (column) Qf[r] += mud; if (last) { outQ[c] = q / dt; outR[c] = r; } continue; }
                const hold = q < room ? q : room;
                trap[lid[c]] = hold; if (q > 0) mud *= 1 - hold / q; q -= hold; kept += hold;
            } else {
                const per = a / (A[c] > a * 1e-3 ? A[c] : a * 1e-3), clean = s === P.steps - 1 && P.lastClean;
                const dMud = clean || !column ? 0 : mud * Math.min(1, P.GFine * per), d = clean ? 0 : (q - mud) * Math.min(1, P.G * per) + dMud;
                dropped[c] = d / a; q -= d; mud -= dMud; kept += d;
            }
            if (Qf && !out) Qf[r] += mud;
            if (!out) { Qs[r] += q; if (inlet && lid[r] >= 0 && lid[r] !== lid[c]) inlet[r] += q; }
            else if (sinkAt[r] >= 0) { basins[sinkAt[r]].load += q; inClosed += q; if (inlet) inlet[r] += q; }
            else toSea += q;
            if (last) { outQ[c] = q / dt; outR[c] = r; }
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
    if (settle && P.steps > 0) reboundKm3 += settle(P.timeMyr);
    let seaKm3 = 0, closedKm3 = 0, grossKm3 = 0;
    for (const p of curve) { seaKm3 += p.seaKm3; closedKm3 += p.closedKm3; grossKm3 += p.erodedKm3; }
    const perYr = v => +(v / Math.max(1e-9, P.timeMyr) * 1e-6).toFixed(2);
    const budget = { seaKm3PerYr: perYr(seaKm3), closedKm3PerYr: perYr(closedKm3), grossKm3PerYr: perYr(grossKm3), reboundKm3PerYr: perYr(reboundKm3) };
    return { curve, survivors, budget, ms: Object.fromEntries(Object.entries(t).map(([key, v]) => [key, Math.round(v)])), outflow: { q: outQ, recv: outR } };
}

/**
 * A delta: what came in by each mouth fills the water nearest that mouth up to `surface`, so a filling lake shrinks and stays deep
 * beyond the front. Laid flat from the floor, it would keep all its area until the last metre: a wide sheet. `inlet`: each cell's
 * load come in. CPU and GPU paths both lay with this, and so does bayheadFill.
 * @returns {(cells: ArrayLike<number>, vol: number, surface: (c: number) => number, inside: (c: number) => boolean) => number}
 *   lays in place; returns what found no room (km³ ÷ a cell's area)
 */
export function deltaLayer(mesh, z, inlet) {
    const { adjOffset, adjList, numCells: n } = mesh, been = new Int32Array(n).fill(-1);
    let walk = 0;
    return (cells, vol, surface, inside) => {
        const mouths = [];
        let all = 0;
        for (const c of cells) if (inlet[c] > 0) { mouths.push(c); all += inlet[c]; }
        if (!all) { layUp(z, cells, vol, Infinity); return 0; }
        mouths.sort((x, y) => inlet[y] - inlet[x]);
        let spilt = 0;
        for (const c0 of mouths) {
            let left = vol * inlet[c0] / all;
            const q = [c0], id = walk++;
            been[c0] = id;
            for (let i = 0; i < q.length && left > 0; i++) {
                const c = q[i], room = surface(c) - z[c];
                if (room > 0) { const put = room < left ? room : left; z[c] += put; left -= put; }
                for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (been[y] !== id && inside(y)) { been[y] = id; q.push(y); } }
            }
            spilt += left;
        }
        return spilt;
    };
}

/**
 * The bayhead fill (lane coastflood, 2026-11-10): today's sea drowned the valleys the rivers cut at the glacial cycle's lower
 * sea, and the rivers have filled them from their heads since. Through the last transgression and the highstand a drowned
 * incised valley takes its river's load at its head: a bayhead delta builds out from it (sand, then the mud of the central
 * basin), so a valley with a big load fills to a delta plain and one with little stays an open, funnel-shaped ria, its mouth
 * the last to fill (Dalrymple, Zaitlin & Boyd 1992 J. Sediment. Petrol. 62, 1130; Boyd, Dalrymple & Zaitlin 1992 Sediment. Geol.
 * 80, 139; Anthony 2014 in Coastal Environments and Global Change). A process, not a mask: each mouth's volume is its river's load
 * (the erosion's last step: what each land cell passes to a drowned one, km³/Myr) over `fillMyr`, laid with the lakes' own
 * deltaLayer — nearest the mouth first, up to today's sea, so the delta plain stands at it.
 * Reduced (what it skips): the load is the lowstand's, not the Holocene's own; all of it (sand and mud) stays in the valley that
 * takes it — none is carried out to the shelf by the tide, so a funnel's mouth is, if anything, filled too much; no wave or tide
 * shaping (the marine lane's); a mouth's load fills its own nearest water whoever's valley that is, and what a valley cannot hold
 * is not carried on to the open shelf but only counted (spiltKm3).
 * @param {Object} mesh
 * @param {Float32Array} z          the ground (km), raised in place
 * @param {Uint8Array} drowned      the cells today's sea took from the land (the lowstand's valleys)
 * @param {Uint8Array} sea          today's sea (a land cell is one not in it)
 * @param {{q: Float32Array, recv: Int32Array}} outflow   the erosion's last step (erodeLandscape / erodeGPU / erodeLadder)
 * @param {number} fillMyr          how long the rivers have filled them
 * @param {number} a                a cell's area (km²)
 */
export function bayheadFill(mesh, z, drowned, sea, outflow, fillMyr, a) {
    const n = mesh.numCells, inlet = new Float64Array(n), cells = [];
    let mouths = 0, supply = 0, room = 0;
    for (let c = 0; c < n; c++) {
        if (drowned[c]) { cells.push(c); if (z[c] < 0) room -= z[c] * a; continue; }
        const r = outflow.recv[c], q = outflow.q[c];
        if (sea[c] || r < 0 || !drowned[r] || !(q > 0)) continue;
        if (!inlet[r]) mouths++;
        inlet[r] += q; supply += q * fillMyr;
    }
    if (!mouths) return { mouths: 0, supplyKm3: 0, roomKm3: Math.round(room), laidKm3: 0, spiltKm3: 0 };
    const spilt = deltaLayer(mesh, z, inlet)(cells, supply / a, () => 0, c => drowned[c] === 1) * a;
    return { mouths, supplyKm3: Math.round(supply), roomKm3: Math.round(room), laidKm3: Math.round(supply - spilt), spiltKm3: Math.round(spilt) };
}

/**
 * The lithosphere's answer to what has moved since it last settled: the change blurred over its flexural reach, its share taken
 * back. Land only; the sea's floor stays, so what the blur carries offshore is lost to the land, as flexure's is. Anchored on `z`
 * as it stands now. CPU and GPU paths both settle with this.
 * `seaKm`: the sea's surface it keeps land above (the lowstand's during early erosion).
 * @returns {() => number} settles `z` in place, returning the km³ the land moved by
 */
export function rebounder(mesh, z, ocean, P, column = null, seaKm = 0, uplift = null, flex = null) {
    const { numCells: n } = mesh, a = 4 * Math.PI * R * R / n, anchor = z.slice();
    let since = 0;
    // `at`: the run's time now (Myr). The uplift is the surface's own rise, its isostasy already in it: only what was taken off or
    // laid on since the last settling is a load
    return (at = 0) => {
        const d = new Float32Array(n), next = new Float32Array(n), lifted = at - since;
        since = at;
        let km3 = 0;
        for (let c = 0; c < n; c++) if (!ocean[c]) d[c] = z[c] - anchor[c] - (uplift ? uplift[c] * lifted : 0);
        if (flex) {
            // (on a fine level, the load blurred on the ladder's coarsest mesh and carried back: σ is ~6 of its cells, and
            // the blur's passes go as 1/edge², ~2 500 at 2.5M)
            const dc = meanOnto(flex.map, d, flex.mesh.numCells);
            flexBlur(flex.mesh, dc, P.reboundKm);
            d.fill(0);
            carry(flex.map, dc, d);
        } else flexBlur(mesh, d, P.reboundKm, next);
        for (let c = 0; c < n; c++) {
            if (ocean[c]) continue;
            const was = z[c];
            z[c] -= P.rebound * d[c];
            km3 += (z[c] - was) * a;
            if (column) column.zBed[c] += z[c] - was;     // (the rock moves with the ground)
            anchor[c] = z[c];
        }
        return km3;
    };
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

/** A fine mesh's rebound blurred on the ladder's coarsest mesh (rebounder's `flex`): null when the mesh is no finer than it. */
export function flexOnto(mesh, P, meshOf) {
    const cells = P.ladder?.[0]?.cells;
    if (!cells || cells >= 0.9 * mesh.numCells) return null;
    const cm = meshOf(cells);
    return { mesh: cm, map: mapOnto(cm, mesh) };
}

/** `d` blurred in place over the lithosphere's flexural reach (σ = reachKm) by neighbour-mean passes. */
function flexBlur(mesh, d, reachKm, next = new Float32Array(mesh.numCells)) {
    const { adjOffset, adjList, numCells: n } = mesh, need = 2 * reachKm * reachKm / (mesh.edgeKm * mesh.edgeKm), passes = Math.ceil(need / 0.5), w = need / passes;
    for (let p = 0; p < passes; p++) {
        for (let c = 0; c < n; c++) {
            let v = 0, m = 0;
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { v += d[adjList[j]]; m++; }
            next[c] = d[c] + w * (v / m - d[c]);
        }
        d.set(next);
    }
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
 * The ladder over the moment's window (ERODE spanWindow): its coarsest rung runs the window less the finer rungs' spans, at
 * the rung's own dt — the history's uplift (tectRateKm) is the rise over that window, so with it the rivers have the time the
 * ground rose in. A frame without a window (one cached before it was kept), or a window no longer than the ladder: as it is.
 */
export function ladderOverWindow(P, windowMyr) {
    if (!P.spanWindow || !P.ladder || !(windowMyr > 0)) return P;
    if (P.spanSplit === 'even') {                       // (every rung stretched alike, each at its own dt)
        const total = P.ladder.reduce((t, L) => t + L.timeMyr, 0), f = Math.min(windowMyr, P.spanMaxMyr ?? Infinity) / total;
        return f <= 1 ? P : { ...P, ladder: P.ladder.map(L => ({ ...L, timeMyr: L.timeMyr * f, steps: Math.ceil(L.steps * f - 1e-9) })) };
    }
    const [first, ...rest] = P.ladder, finer = rest.reduce((t, L) => t + L.timeMyr, 0), T = Math.min(windowMyr, P.spanMaxMyr ?? Infinity) - finer;
    if (T <= first.timeMyr) return P;
    const dt = first.timeMyr / first.steps;
    return { ...P, ladder: [{ ...first, timeMyr: T, steps: Math.ceil(T / dt - 1e-9) }, ...rest] };
}

/** The ladder for a mesh of N cells: levels at or finer than it are one, the coarsest of them, run on the mesh itself. */
function ladderFor(ladder, N) {
    const here = ladder.findIndex(L => !L.cells || L.cells >= 0.9 * N);
    return [...ladder.slice(0, here), { ...ladder[here], cells: 0 }];
}

/**
 * Coarse to fine: the long span on a coarse mesh, where the big hollows and the great rivers are settled at little cost, then a
 * few short steps at each finer level, from that level's own surface plus all the change found below it. Short wavelengths
 * come to terms fast: the stream power's wave crosses a small catchment in a fraction of the span, so few steps should drain or
 * fill the fine hollows. P.ladder: [{ cells (absent: this mesh), timeMyr, steps }, …], coarsest first. Fields as
 * erodeLandscape's, plus runoff, pet, rain for closedOf(mesh, z, fields, ocean, flood). `solve`: what runs a level, this file's solver
 * or the GPU's (gpu/erode-gpu.js), which takes the same arguments and answers later.
 */
export async function erodeLadder(o, P, meshOf, solve = erodeLandscape) {
    const { mesh, z, ocean, closedOf } = o, sea = o.seaKm ?? 0, N = mesh.numCells, levels = ladderFor(P.ladder, N), out = [];
    const coarse = new Map();
    // (a finer level's rebound blurs on the coarsest level's mesh: the map between them, made once)
    let base = null;
    const flexOf = lm => {
        if (!o.uplift || !P.rebound) return null;
        if (!base) { base = { mesh: lm, maps: new Map() }; return null; }
        if (lm === base.mesh) return null;
        if (!base.maps.has(lm.numCells)) base.maps.set(lm.numCells, lm === mesh ? coarse.get(base.mesh.numCells)?.down ?? mapOnto(base.mesh, lm) : mapOnto(base.mesh, lm));
        return { mesh: base.mesh, map: base.maps.get(lm.numCells) };
    };
    let prev = null, delta = null, prevZ = null, outflow = null;         // (the level below, the change it found, its surface; the finest's load out)
    for (const L of levels) {
        const fine = !L.cells || L.cells >= 0.9 * N, lm = fine ? mesh : meshOf(L.cells), t0 = performance.now();
        let M = coarse.get(lm.numCells), f;
        if (fine) f = { z, ocean, water: o.water, k: o.k, runoff: o.runoff, pet: o.pet, rain: o.rain, column: o.column, uplift: o.uplift ?? null };
        else {
            if (!M) coarse.set(lm.numCells, M = { down: mapOnto(lm, mesh) });
            const m = lm.numCells, wet = meanOnto(M.down, ocean, m, 1), oc = new Uint8Array(m);
            for (let c = 0; c < m; c++) oc[c] = wet[c] > 0.5 ? 1 : 0;
            f = { z: meanOnto(M.down, z, m), ocean: oc, water: meanOnto(M.down, o.water, m, 1), k: meanOnto(M.down, o.k, m, 5), runoff: meanOnto(M.down, o.runoff, m), pet: meanOnto(M.down, o.pet, m, 1000), rain: meanOnto(M.down, o.rain, m),
                column: o.column && { loose: meanOnto(M.down, o.column.loose, m, 1), zBed: meanOnto(M.down, o.column.zBed, m), fine: meanOnto(M.down, o.column.fine, m, 0.9) },
                uplift: o.uplift ? meanOnto(M.down, o.uplift, m) : null };
        }
        const start = f.z.slice();
        if (delta) {
            // (the last level's map up is the one already made to bring its fields down to the level below)
            const U = (fine && coarse.get(prev.numCells)?.down) || mapOnto(prev, lm), before = fine ? z.slice() : f.z.slice();
            if (P.bury) {
                // (what the level below eroded comes off this surface; what it laid down buries it: the finer relief under a
                // fill is under it, not carried up on top of it)
                const cut = delta.map(v => Math.min(0, v)), laid = new Float32Array(lm.numCells), top = new Float32Array(lm.numCells), mask = delta.map(v => (v > 0 ? 1 : 0)), m3 = new Float32Array(lm.numCells);
                carry(U, cut, f.z); carry(U, delta.map(v => Math.max(0, v)), laid); carry(U, prevZ, top); carry(U, mask, m3);
                for (let c = 0; c < lm.numCells; c++) if (laid[c] > 0) { const buried = top[c]; f.z[c] = Math.max(f.z[c], m3[c] * buried + (1 - m3[c]) * (f.z[c] + laid[c])); }
            } else carry(U, delta, f.z);
            // (the sea stays where it was: the solve moves land only)
            for (let c = 0; c < lm.numCells; c++) if (f.ocean[c]) f.z[c] = before[c];
        }
        const t1 = performance.now();
        const r = await solve({ ...o, mesh: lm, z: f.z, ocean: f.ocean, water: f.water, k: f.k, column: f.column, uplift: f.uplift, flex: flexOf(lm), closed: (g, flood) => closedOf(lm, g, f, f.ocean, flood, sea) }, { ...P, timeMyr: L.timeMyr, steps: L.steps, rebound: L === levels[0] || f.uplift ? P.rebound : 0 });
        if (fine) outflow = r.outflow ?? null;
        out.push({ cells: lm.numCells, timeMyr: L.timeMyr, steps: L.steps, seconds: +((performance.now() - t0) / 1000).toFixed(2), mapSeconds: +((t1 - t0) / 1000).toFixed(2), ms: r.ms, last: r.curve[r.curve.length - 1], budget: r.budget });
        delta = new Float32Array(lm.numCells);
        for (let c = 0; c < lm.numCells; c++) delta[c] = f.z[c] - start[c];
        prev = lm; prevZ = f.z;
    }
    return { curve: [], ms: {}, levels: out, outflow };
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
export function layUp(z, cells, vol, top) {
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
