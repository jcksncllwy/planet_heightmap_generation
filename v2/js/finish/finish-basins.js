// F2 — closed basins. A hollow in the land fills with water until it spills — unless its inflow cannot make up what the
// lake would lose to evaporation: then it stays closed, its lake shrinking to the level where the two balance (the
// Great Basin, the Caspian, the Dead Sea, a salt pan). Without the water drawn, that lake is a flat floor — a playa —
// and the rivers of its catchment end there (carve.js: sink, base), instead of being led out over its rim.
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
 * @param {Object} mesh
 * @param {Float32Array} z        heights (km); raised in place where a closed basin's floor is levelled (a playa)
 * @param {Float32Array} runoff   runoff per cell (mm/year)
 * @param {Float32Array} pet      potential evaporation (mm/year)
 * @param {Float32Array} rain     rain (mm/year)
 * @param {number} cellKm2
 * @param {Uint8Array} ocean      the world ocean (finish.js oceanMask): the flood starts there, and only there
 * @returns {{sink: Uint8Array, base: Float32Array, basins: number, levelled: number, tectonic: Uint8Array, seas: Object[]}}
 *   seas: each sea cut off from the ocean (a basin with ground below sea level, at least basinMinKm2): its area (km²),
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
    // ── each cell's water goes to the first hollow on its way to the sea (the flood's way back: every cell after the
    // cell it was reached from): a lake's inflow is its catchment's runoff (km² · mm / year) ──
    const first = new Int32Array(n).fill(-1);
    for (let i = 0; i < count; i++) {
        const c = order[i], p = parent[c];
        first[c] = lake[c] >= 0 ? lake[c] : p >= 0 && done[p] === 1 ? first[p] : -1;
        if (first[c] >= 0) lakes[first[c]].inflow += runoff[c] * cellKm2;
    }
    // ── closed where the full lake would lose more than it gets: its lake where the two balance. What open water loses:
    // its potential evaporation (F.lakeEvapShare of the land's), less the rain on it (km² · mm / year) ──
    const evap = c => Math.max(0, F.lakeEvapShare * pet[c] - Math.max(0, rain[c])) * cellKm2;
    const sink = new Uint8Array(n), base = new Float32Array(n), seas = [];
    let basins = 0, levelled = 0;
    for (const L of lakes) {
        const area = L.cells.length * cellKm2;
        if (area < F.basinMinKm2) continue;
        let low = L.cells[0];
        for (const c of L.cells) if (z[c] < z[low]) low = c;
        const floor = z[low], cutOff = floor < 0, id = lake[low];
        const { level, wet: under, full } = lakeBalance(mesh, low, c => lake[c] === id, z, evap, L.inflow);
        const lakeShows = under.length >= 2 && under.length * cellKm2 >= F.lakeMinKm2;
        if (cutOff) seas.push({ id, low, km2: area, floorKm: floor, sillKm: L.level, inflowKm3: L.inflow * 1e-6, full, levelKm: full ? L.level : level, waterKm2: under.length * cellKm2, wet: full || lakeShows });
        if (full) continue;                                           // (it fills and spills: an open basin — the rivers lead it out)
        // the lake that balances, its rivers ending at its shore. A sea cut off from the ocean that keeps a lake the map
        // can show stays as deep as it is under its water; a playa, or a land basin's lake, is a flat floor at the level
        const keepDeep = cutOff && lakeShows;
        for (const c of under) { if (!keepDeep && z[c] < level) { z[c] = level; levelled++; } sink[c] = 1; base[c] = level; }
        basins++;
    }
    return { sink, base, basins, levelled, tectonic, seas, lakes };
}
