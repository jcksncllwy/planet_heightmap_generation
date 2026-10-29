// F2 — closed basins. A hollow in the land fills with water until it spills — unless its inflow cannot make up what the
// lake would lose to evaporation: then it stays closed, its lake shrinking to the level where the two balance (the
// Great Basin, the Caspian, the Dead Sea, a salt pan). Without the water drawn, that lake is a flat floor — a playa —
// and the rivers of its catchment end there (carve.js: sink, base), instead of being led out over its rim. Closure is
// the rim against the water balance, at any height — the Altiplano's at 3.7 km as the Caspian's below sea level — and
// a hollow's sub-basins each stand at their own (hollowLakes): a full lake spills into the one below, and what a full
// hollow spills runs on down to the next (until 2026-10-28 a hollow's inflow was its own catchment's alone, and its one
// lake was drawn as all the ground below the level its balance reached — a saddle's, often).
//
// A sea cut off from the world ocean is such a hollow too (terrain/world-ocean.js): its floor below sea level, its rim —
// the sill it would spill over — at or above it. Its surface is set by the same balance, not by sea level: the runoff of
// its catchment and the rain on it against what evaporates off its water, over the area its water covers at that level.
// The Caspian: the Volga's ~250 km³ a year and the other rivers' ~50 against ~1 m a year of evaporation net of the rain
// on it hold it at ~370 000 km², its surface at −28 m (Rodionov 1994; Arpe & Leroy 2007). The Dead Sea: the Jordan's
// ~1.3 km³ a year against ~1.5 m held it at ~1000 km², −390 m, before the river was drawn off (Salameh & El-Naser 1999).
// The Mediterranean cut off from the Atlantic in the Messinian lost ~0.5–1 m a year net of its rivers and rain: drawn
// down 1.5–3 km in a few thousand years (Hsü et al. 1973; Blanc 2002; Ryan 2009). Water balance settles in thousands of
// years — at once on the timeline's timescale — so it is solved for its equilibrium, not run through time. A cut-off sea
// whose water can rise to its sill spills, and its outlet joins it to the sea below (finish-hydro.js); one that cannot
// keeps a lake at its own level — a salt lake below sea level — or, where next to nothing flows in, a playa on its floor.

import { MinHeap } from '../core/min-heap.js';

/**
 * Where a closed lake stands: grown from its basin's lowest point as water rises in it — a priority flood over the
 * basin's cells by the level at which each goes under (a pocket behind a ridge only once the water tops the ridge) —
 * until what evaporates off the cells under water outweighs what flows in. The lake's area at each level is the basin's
 * own hypsometry: the level where inflow and evaporation balance is the equilibrium the water settles to in thousands of
 * years.
 * @param {Object} mesh
 * @param {number} seed                 the basin's lowest cell
 * @param {(c: number) => boolean} inBasin
 * @param {Float32Array} z
 * @param {(c: number) => number} evap  what evaporates off cell c as open water, net of the rain on it (the inflow's units)
 * @param {number} inflow
 * @returns {{level: number, wet: number[], full: boolean}} level (km): the water's surface; wet: the cells under it, in
 *   the order they went under (at least the lowest); full: the whole basin went under — it rises to its rim and spills
 */
export function lakeBalance(mesh, seed, inBasin, z, evap, inflow) {
    const { adjOffset, adjList } = mesh, heap = BALANCE_HEAP, wet = [];
    if (stamps.length !== mesh.numCells) { stamps = new Int32Array(mesh.numCells); stamp = 0; }
    const mark = ++stamp;
    stamps[seed] = mark;
    heap.size = 0;
    heap.push(z[seed], seed);
    let sum = 0, level = z[seed];
    while (heap.size) {
        const key = heap.peekKey(), c = heap.pop(), e = evap(c);
        if (wet.length && sum + e > inflow) return { level, wet, full: false };
        sum += e; wet.push(c); level = Math.max(level, key);
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (stamps[nb] !== mark && inBasin(nb)) { stamps[nb] = mark; heap.push(Math.max(level, z[nb]), nb); } }
    }
    return { level, wet, full: true };
}
const BALANCE_HEAP = new MinHeap(1 << 12);
let stamps = new Int32Array(0), stamp = 0;          // (cells seen by the flood: stamped, one array per mesh size)

/**
 * The lakes of one hollow, each at its own water balance, solved inside out — fill, spill, merge (Barnes, Callaghan &
 * Wickert 2021, Earth Surf. Dynam. 9: 105; the hierarchy of a hollow's hollows: Barnes et al. 2020, ibid. 8: 431). A
 * hollow is rarely one bowl: sub-basins sit behind sills below its rim, as Kara-Bogaz-Gol beside the Caspian, Bonneville's
 * and Lahontan's basins in the Great Basin, Poopó below Titicaca. As the water rises the sub-basins fill one by one:
 * each holds the water that reaches it — the rain on its own catchment, and what spills into it — until its lake's
 * evaporation outweighs it, or its lake reaches the sill and spills on, its surplus running down into the sub-basin
 * beyond, which balances at its own, lower level (Kara-Bogaz-Gol, fed by the Caspian's overflow, stands ~4 m below it;
 * Poopó ~100 m below Titicaca: the Desaguadero). Two sub-basins both filled to their sill are one lake, rising on. The
 * hollow's tree: its cells taken from the lowest up, each pit a sub-basin, two sub-basins meeting at a sill joined there
 * (union–find); then, from the whole hollow down, each sub-basin full or not by the water reaching it — the hollow full
 * only if every part of it is, so a hollow's whole water balance decides whether it spills at its rim, and the tree only
 * where its water stands. A sub-basin smaller than `minCells` is no lake of its own: what the mesh can hardly show,
 * filled by what its rivers bring (the hollows' own rule: finish-config.js basinMinKm2) — its water passes on.
 * @param {Object} mesh
 * @param {ArrayLike<number>} cells   the hollow: connected cells, all below its spill level
 * @param {Float32Array} z
 * @param {(c: number) => number} arrive  the water reaching cell c: its own runoff and whatever runs in there from outside
 * @param {(c: number) => number} evap    what evaporates off cell c as open water, net of the rain on it (arrive's units)
 * @param {number} minCells
 * @param {number} spillKm               the hollow's spill level (km)
 * @returns {{full: boolean, outflow: number, inflow: number, lakes: {level: number, cells: number[], full: boolean,
 *   outflow: number, into: number}[], fate: (c: number) => number}}  full: the whole hollow fills and spills at its rim
 *   (outflow); lakes: each body of water — full (spilling into the cell `into` of the sub-basin beside it; the hollow's
 *   own lake when the hollow is full, into −1) or terminal; fate(c): the lake the water reaching hollow cell c ends in
 *   (its index in lakes; −1: out over the rim)
 */
export function hollowLakes(mesh, cells, z, arrive, evap, minCells, spillKm) {
    const { adjOffset, adjList } = mesh, m = cells.length, T = treeScratch(mesh.numCells, m);
    const { loc, locStamp, rankL, uf, leafOf, ownNext } = T, mark = ++T.stamp;
    for (let i = 0; i < m; i++) { loc[cells[i]] = i; locStamp[cells[i]] = mark; }
    const sorted = T.sorted.subarray(0, m);
    for (let i = 0; i < m; i++) sorted[i] = i;
    sorted.sort((a, b) => z[cells[a]] - z[cells[b]] || a - b);
    for (let p = 0; p < m; p++) rankL[sorted[p]] = p;
    // ── the tree, from the lowest cell up: nodes are sub-basins (a pit's; two joined at a sill) ──
    let N = 0;
    const { kidA, kidB, up, sill, E, Q, size, ownHead, ownTail, landIn, landCell, rootNode } = T;
    const newNode = (a, b, s) => {
        const k = N++;
        kidA[k] = a; kidB[k] = b; up[k] = -1; sill[k] = s; ownHead[k] = ownTail[k] = -1; Q[k] = 0; landIn[k] = -1; landCell[k] = -1;
        E[k] = a >= 0 ? E[a] + E[b] : 0; size[k] = a >= 0 ? size[a] + size[b] : 0;
        if (a >= 0) { up[a] = k; up[b] = k; }
        return k;
    };
    const find = i => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
    const roots = T.roots, lows = T.lows;
    for (let p = 0; p < m; p++) {
        const i = sorted[p], c = cells[i];
        let nr = 0, lowJ = -1;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (locStamp[nb] !== mark) continue;
            const j = loc[nb];
            if (rankL[j] >= p) continue;
            if (lowJ < 0 || rankL[j] < rankL[lowJ]) lowJ = j;
            const r = find(j);
            let q = 0;
            while (q < nr && roots[q] !== r) q++;
            if (q === nr) { roots[nr] = r; lows[nr++] = j; } else if (rankL[j] < rankL[lows[q]]) lows[q] = j;
        }
        let node;
        if (!nr) { node = newNode(-1, -1, z[c]); uf[i] = i; rootNode[i] = node; leafOf[i] = node; }
        else {
            // (its water runs down to the lowest cell beside it, and so to that one's pit)
            leafOf[i] = leafOf[lowJ];
            let r = roots[0], low = lows[0];
            node = rootNode[r];
            for (let q = 1; q < nr; q++) {
                // (two sub-basins meet at this cell, their sill: what spills from one lands in the other beside it)
                const b = rootNode[roots[q]], M = newNode(node, b, z[c]);
                landIn[node] = leafOf[low]; landCell[node] = cells[low];
                landIn[b] = leafOf[lows[q]]; landCell[b] = cells[lows[q]];
                uf[roots[q]] = r;
                if (rankL[lows[q]] < rankL[low]) low = lows[q];
                node = M;
            }
            uf[i] = r; rootNode[r] = node;
        }
        // (the cell is the sub-basin's own, above its sill: in order, lowest first)
        ownNext[i] = -1;
        if (ownTail[node] < 0) ownHead[node] = i; else ownNext[ownTail[node]] = i;
        ownTail[node] = i;
        E[node] += evap(c); size[node]++;
        Q[leafOf[i]] += arrive(c);
    }
    for (let k = 0; k < N; k++) if (up[k] >= 0) Q[up[k]] += Q[k];          // (children before parents: made first)
    const root = N - 1, small = k => k !== root && size[k] < minCells, full = k => small(k) || Q[k] >= E[k];
    const lakes = [], { lakeOf, fwd } = T;
    for (let k = 0; k < N; k++) { lakeOf[k] = -1; fwd[k] = -1; }
    const region = (k, out) => {
        const st = T.stack;
        let top = 0;
        st[top++] = k;
        while (top) {
            const x = st[--top];
            for (let i = ownHead[x]; i >= 0; i = ownNext[i]) out.push(cells[i]);
            if (kidA[x] >= 0) { st[top++] = kidA[x]; st[top++] = kidB[x]; }
        }
        return out;
    };
    // (a lake that stands below its sub-basin's sill: what is already under water (base, evaporating e0), then the
    // sub-basin's own cells lowest first, until what evaporates passes the water; its level between the last cell under
    // water and the next, by the water left over)
    const standing = (k, base, e0, flat, s) => {
        const W = Q[k];
        let sum = e0, level = s;
        const wet = base;
        for (const c of flat) { const e = evap(c); if (sum + e > W) return { level: s, cells: wet }; sum += e; wet.push(c); }
        for (let i = ownHead[k]; i >= 0; i = ownNext[i]) {
            const c = cells[i], e = evap(c);
            if (wet.length && sum + e > W) { if (e > 0) level += Math.max(0, Math.min(1, (W - sum) / e)) * (z[c] - level); break; }
            sum += e; wet.push(c); level = Math.max(level, z[c]);
        }
        return { level, cells: wet };
    };
    const addLake = (k, L) => { lakeOf[k] = lakes.length; lakes.push(L); };
    if (full(root)) addLake(root, { level: spillKm, cells: region(root, []), full: true, outflow: Q[root] - E[root], into: -1 });
    else {
        const st = [root];
        while (st.length) {
            const k = st.pop(), a = kidA[k], b = kidB[k];
            if (a < 0) { const S = standing(k, [], 0, [], -Infinity); addLake(k, { level: S.level, cells: S.cells, full: false, outflow: 0, into: -1 }); continue; }
            let fa = full(a), fb = full(b);
            if (fa !== fb) {
                // (one fills and spills into the other: its surplus reaches the other's sub-basins by where it lands)
                const f = fa ? a : b, o = fa ? b : a, S = small(f) ? Q[f] : Q[f] - E[f];
                for (let x = landIn[o]; x >= 0; x = up[x]) { Q[x] += S; if (x === o) break; }
                if (full(o)) fa = fb = true;
                else {
                    if (small(f)) fwd[f] = landIn[o];
                    else addLake(f, { level: sill[k], cells: region(f, []), full: true, outflow: S, into: landCell[o] });
                    st.push(o);
                    continue;
                }
            }
            if (fa && fb) {
                // (both full to the sill: one lake, rising above it as far as its water keeps it — a sub-basin too
                // small to be a lake of its own lies flat at the sill, filled, its cells next under the water)
                const base = [], flat = [];
                let e0 = 0;
                for (const x of [a, b]) if (small(x)) region(x, flat); else { region(x, base); e0 += E[x]; }
                const S = standing(k, base, e0, flat, sill[k]);
                addLake(k, { level: S.level, cells: S.cells, full: false, outflow: 0, into: -1 });
            } else { st.push(a); st.push(b); }
        }
    }
    // ── where the water reaching each cell ends: the lake over its sub-basin, and on down the spills from lake to lake ──
    const ans = T.ans;
    for (let k = N - 1; k >= 0; k--) ans[k] = lakeOf[k] >= 0 ? lakeOf[k] : fwd[k] >= 0 ? -2 - fwd[k] : up[k] >= 0 ? ans[up[k]] : -1;
    const ends = new Int32Array(lakes.length).fill(-3);
    const endOfLeaf = leaf => {
        let x = ans[leaf], guard = 0;
        while (x <= -2 && guard++ < N) x = ans[-2 - x];                       // (a filled sub-basin's water, passed on)
        if (x < 0) return -1;
        if (ends[x] !== -3) return ends[x];
        const L = lakes[x];
        ends[x] = -1;                                                          // (guard against a loop: none should form)
        const e = L.full && L.into >= 0 ? endOfLeaf(leafOf[loc[L.into]]) : L.full ? -1 : x;
        return (ends[x] = e);
    };
    return { full: lakeOf[root] >= 0 && lakes[lakeOf[root]].full, outflow: lakeOf[root] >= 0 && lakes[lakeOf[root]].full ? lakes[lakeOf[root]].outflow : 0, inflow: T.Q[root] ?? 0, lakes,
        fate: c => locStamp[c] === mark ? endOfLeaf(leafOf[loc[c]]) : -1 };
}

// (the hollow tree's scratch: per cell of the mesh its index in the hollow, per cell of the hollow and per node the
// tree's arrays — grown as needed, kept between hollows)
let TREE = null;
function treeScratch(n, m) {
    if (!TREE || TREE.n !== n) TREE = { n, loc: new Int32Array(n), locStamp: new Int32Array(n), stamp: 0, m: 0 };
    if (TREE.m < m) {
        const M = Math.max(m, 2 * TREE.m, 1024), K = 2 * M;
        Object.assign(TREE, { m: M, sorted: new Uint32Array(M), rankL: new Int32Array(M), uf: new Int32Array(M), leafOf: new Int32Array(M), ownNext: new Int32Array(M), rootNode: new Int32Array(M),
            kidA: new Int32Array(K), kidB: new Int32Array(K), up: new Int32Array(K), sill: new Float64Array(K), E: new Float64Array(K), Q: new Float64Array(K), size: new Int32Array(K),
            ownHead: new Int32Array(K), ownTail: new Int32Array(K), landIn: new Int32Array(K), landCell: new Int32Array(K), lakeOf: new Int32Array(K), fwd: new Int32Array(K), ans: new Int32Array(K),
            stack: new Int32Array(K), roots: new Int32Array(64), lows: new Int32Array(64) });
    }
    return TREE;
}

/**
 * @param {Object} mesh
 * @param {Float32Array} z        heights (km)
 * @param {Float32Array} runoff   runoff per cell (mm/year)
 * @param {Float32Array} pet      potential evaporation (mm/year)
 * @param {Float32Array} rain     rain (mm/year)
 * @param {number} cellKm2
 * @param {Uint8Array} ocean      the world ocean (finish.js oceanMask): the flood starts there, and only there
 * @returns {{sink: Uint8Array, base: Float32Array, water: Float32Array, basins: number, levelled: number, tectonic: Uint8Array, seas: Object[]}}
 *   sink: 1 on every cell of a closed hollow (its rivers end there); base: the level a river ending there is graded to
 *   (the ground, or a lake's level); water: each lake's level on the cells under it (NaN elsewhere) — a closed hollow's
 *   lakes, terminal and full; tectonic: the tectonic surface's hollows, closed hollows included; seas: each sea cut off from the ocean (a basin with ground below sea level, at least basinMinKm2): its area (km²),
 *   floor and sill (km), its water's level (km) and area (km²), inflow and what it would evaporate full (km³/yr), and
 *   whether it spills (full) or keeps a lake (wet) or a playa
 */
export function closedBasins(mesh, z, runoff, pet, rain, cellKm2, F, ocean) {
    const { adjOffset, adjList, numCells: n } = mesh;
    // ── the priority flood from the world ocean: each other cell's spill level, and the way it was reached (toward the
    // ocean) — a sea cut off from it is crossed as any hollow is, its spill level its sill ──
    const fill = new Float32Array(n), parent = new Int32Array(n).fill(-1), order = new Int32Array(n), done = new Uint8Array(n), heap = new MinHeap(1 << 16);
    let count = 0;
    for (let c = 0; c < n; c++) {
        if (!ocean[c]) continue;
        done[c] = 2;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!ocean[nb] && parent[nb] < 0) { parent[nb] = c; fill[nb] = Math.max(0, z[nb]); heap.push(fill[nb], nb); } }
    }
    while (heap.size) {
        const c = heap.pop();
        if (done[c]) continue;
        done[c] = 1; order[count++] = c;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (done[nb] || ocean[nb]) continue;
            const level = Math.max(fill[c], z[nb]);
            if (parent[nb] < 0 || level < fill[nb]) { parent[nb] = c; fill[nb] = level; heap.push(level, nb); }
        }
    }
    // (the tectonic surface's own hollows — rifts, forelands, closed basins — where lakes may stand; the finishing's
    // later hollows are breached or filled: finish-hydro.js)
    const tectonic = new Uint8Array(n);
    for (let i = 0; i < count; i++) { const c = order[i]; if (fill[c] > z[c] + F.tectonicHollowKm) tectonic[c] = 1; }
    // ── the hollows: cells under their spill level, in patches of one level (one lake each, if it were full) ──
    const EPS = 1e-4, lake = new Int32Array(n).fill(-1), lakes = [];
    for (let i = 0; i < count; i++) {
        const s = order[i];
        if (lake[s] >= 0 || !(fill[s] > z[s] + EPS)) continue;
        const id = lakes.length, cells = [s], L = fill[s];
        lake[s] = id;
        for (let q = 0; q < cells.length; q++) for (let k = adjOffset[cells[q]]; k < adjOffset[cells[q] + 1]; k++) {
            const nb = adjList[k];
            if (lake[nb] < 0 && done[nb] === 1 && fill[nb] > z[nb] + EPS && Math.abs(fill[nb] - L) < 1e-6) { lake[nb] = id; cells.push(nb); }
        }
        lakes.push({ cells, level: L, inflow: 0 });
    }
    // ── the water, upstream first (each cell after the cell it was reached from, in the flood's order): each cell's
    // runoff runs down the flood's way back toward the sea, gathering; a hollow holds what reaches its cells, and passes
    // on at its outlet (the cell of it reached first) only what its lakes do not evaporate — so a full lake's overflow
    // feeds the hollow below it (km² · mm / year). What open water loses: its potential evaporation (F.lakeEvapShare of
    // the land's), less the rain on it ──
    const evap = c => Math.max(0, F.lakeEvapShare * pet[c] - Math.max(0, rain[c])) * cellKm2;
    const q = new Float64Array(n), sink = new Uint8Array(n), base = new Float32Array(n), water = new Float32Array(n).fill(NaN), seas = [];
    const minCells = F.basinMinKm2 / cellKm2;
    let basins = 0, levelled = 0;
    for (let i = count - 1; i >= 0; i--) {
        const c = order[i], id = lake[c];
        q[c] += Math.max(0, runoff[c]) * cellKm2;
        const L = id >= 0 ? lakes[id] : null;
        if (L && L.cells.length >= minCells) {
            if (c !== L.cells[0]) continue;                           // (the hollow gathers; its outlet passes on)
            const res = closeHollow(L, id);
            q[c] = res;
            if (!(res > 0)) continue;
        }
        const p = parent[c];
        if (p >= 0 && done[p] === 1) q[p] += q[c];
    }
    // (one hollow: its lakes by the tree — hollowLakes — closed where its whole water balance cannot fill it to its rim)
    function closeHollow(L, id) {
        let low = L.cells[0];
        for (const c of L.cells) if (z[c] < z[low]) low = c;
        const floor = z[low], cutOff = floor < 0, area = L.cells.length * cellKm2;
        const S = hollowLakes(mesh, L.cells, z, c => q[c], evap, minCells, L.level);
        L.inflow = S.inflow;
        const shows = W => W.cells.length >= 2 && W.cells.length * cellKm2 >= F.lakeMinKm2;
        // (the cut-off sea's own lake, for the timeline's estimate to agree with: the one over its lowest point if the map
        // shows it, else its largest — water stands in the sea if any of its sub-basins keeps a lake the map can show; which
        // sub-basin holds it turns on the resolution of its divides, whether water stands in it on its whole balance)
        let main = S.lakes.find(W => W.cells.includes(low)) ?? null, wetKm2 = 0;
        for (const W of S.lakes) { wetKm2 += W.cells.length * cellKm2; if (!(main && shows(main)) && (!main || W.cells.length > main.cells.length)) main = W; }
        if (cutOff) seas.push({ id, low, km2: area, floorKm: floor, sillKm: L.level, inflowKm3: S.inflow * 1e-6, full: S.full, levelKm: S.full ? L.level : main ? main.level : floor,
            waterKm2: S.full ? area : wetKm2, wet: S.full || (!!main && shows(main)) });
        if (S.full) return S.outflow;                                 // (it fills and spills: an open basin — the rivers lead it out)
        // Closed: the whole hollow is its rivers' end — what reaches it stays in it — and its floor is not cut: what the
        // rivers bring there is laid down, not carried away. A river entering it is graded to the ground where it enters
        // (base), never cut below it, and one reaching a lake to the lake's level: rivers ending in a closed basin aggrade
        // toward its lake (the Basin and Range's valleys hold kilometres of their rivers' fill: Saltus & Jachens 1995). Until
        // 2026-10-28 they were graded to the floor of the one lake drawn, and the carve took dry plains round it 300 m below
        // sea level. Each lake's water where its balance holds it, over its floor as it is (lane rivers2, 2026-10-29: until
        // then a terminal lake's floor was levelled at its level, z = the lake's, exactly at its balance — the hydrology's
        // own balance on the finished surface, a hair different, then often found it full, breached it, and left the dead
        // level floor dry: rivers crossed it in straight lines converging on its outlet; the hydrology draws the water)
        for (const c of L.cells) { sink[c] = 1; base[c] = z[c]; tectonic[c] = 1; }
        for (const W of S.lakes) for (const c of W.cells) { base[c] = W.level; water[c] = W.level; }
        basins++;
        return 0;
    }
    return { sink, base, water, basins, levelled, tectonic, seas, lakes };
}
