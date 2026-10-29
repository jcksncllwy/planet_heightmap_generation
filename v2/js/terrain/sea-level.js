// The mantle's swell and the sea level it sets (2026-10-27). A continent is a lid: the mantle under it warms
// (tectonics/step/hotspots.js mantleHeat — Anderson 1982; Gurnis 1988; Lenardic et al. 2005; Coltice et al. 2007), and
// warm mantle is light — it lifts the surface over it (dynamic topography: the African superswell is Pangaea's legacy,
// southern and eastern Africa standing ~500 m above the other shields, Nyblade & Robinson 1994). A supercontinent that
// sits on its own heat for 100–200 Myr rises as a whole; the pieces that drift off it onto mantle the ocean has cooled
// sink back.
//
// The swell is absolute — against the mantle, under the sea floor as under the land — and the sea answers it. The
// ocean's water is a fixed volume: where the floor rises the water is pushed up, where it sinks the water drains in, and
// over the ocean's area that is one level. So against the sea a cell stands by how much warmer its mantle is than the
// ocean's on average, and with a supercontinent standing on all of the warm mantle and the ocean's floor over cooled
// mantle, the sea falls against the land: Pangaea's era was a first-order lowstand, with a dry, high interior; the
// dispersal brought the Cretaceous highstand, when shallow seas covered ~30 % of today's land (Worsley et al. 1984; Haq &
// Al-Qahtani 2005). The age of the sea floor sets the other half of the sea's level: a young ocean, its ridges long and
// hot, stands shallower and holds less water — the sea rises (Hays & Pitman 1973; Müller et al. 2008). That half is
// computed but counts only when asked (terrain-config.js seaLevelFloorAge): the history's floor is older than Earth's.
//
// The swell is the mantle's, fixed under the world: a continent drifting across it tilts and sinks or rises as it goes
// (Australia, flooded on its northern side as it drifted north onto the Indonesian downwelling: DiCaprio et al. 2009).
//
// All of it is read from the frame (the history's mantleHeat, crust ages and sea fill): the history is unchanged.
// Heights are calibrated against today's sea — a dispersed world's — so each part is measured from what a dispersed
// world shows on average (terrain-config.js mantleSwellLandRef, mantleSwellSeaRef, seaDepthRefKm): today's land stands
// where it does with today's mantle under it, and today's sea is at 0.

import { CrustType } from '../tectonics/model/crust.js';
import { filledSeaDepthKm, seaDepthKm, SEDIMENT_LOAD_FACTOR } from '../tectonics/measure.js';
import { MinHeap } from '../core/min-heap.js';

let scratch = null;
const buffers = n => (scratch?.n === n ? scratch : (scratch = { n, a: new Float32Array(n), b: new Float32Array(n) }));

/**
 * The mantle's heat (0 cooled … 1 fully insulated) as the surface feels it: the frame's per-cell heat smoothed to a
 * Gaussian of cfg.mantleSwellSmoothKm (the dynamic topography of a load at depth is spread over about its depth: Hager &
 * Richards 1989). The history reads it too (tectonics/step/rivers.js: the land and the sea it fills stand where the
 * terrain's do), so it is smoothed on a coarse graph of the mesh, the same work at every mesh (smoothHeat).
 * @returns {Float32Array} (a scratch buffer: copy it to keep it)
 */
export function mantleWarmth(frame, simMesh, cfg) {
    const n = simMesh.numCells, S = buffers(n);
    for (let w = 0; w < n; w++) S.a[w] = frame.mantleHeat[w] / 255;
    return smoothHeat(S.a, simMesh, cfg.mantleSwellSmoothKm);
}

// ── Smoothing over hundreds of km, at a cost that does not grow with the mesh (2026-10-29, branch unified-swell) ──
// On the mesh itself a Gaussian of σ takes 7/3 (σ / edge)² passes of neighbour averaging (each pass a variance of ~3/7
// of an edge² along each axis: 6 of 7 points one edge away) — passes × cells grows as the cells², 29 ms at 40K and
// 0.53 s at 160K, too much to run on the history's river clock. A field this smooth needs no fine mesh: the cells are
// gathered onto clusters about COARSE_KM apart (the cells nearest a uniform Fibonacci lattice of seeds, each other cell
// joined to its nearest seed through the mesh), smoothed on the clusters' own graph, and carried back. Gathered and
// carried back by Wendland's C2 kernel, (1 − r/ρ)⁴ (1 + 4r/ρ), over the cluster centres within ρ = CARRY_RHO spacings of a
// cell (Wendland 1995; normalised per cell: Shepard's partition of unity) — all of them in its cluster's two rings, so the
// weights go to 0 smoothly and no step of the clusters' size shows (a plain average over each cluster and the nearest
// centres' values carried back stepped by ~0.2 km of swell across a continent's edge). The variance each part adds along
// an axis, in s² (s: the clusters' spacing): the kernel 5/72 ρ² each way, each pass 3/7 — the passes make up the rest of
// σ². A mesh with under 3 cells a cluster smooths on itself (it would not gain).
const COARSE_KM = 250, CARRY_RHO = 2.4, CARRY_RINGS = 3;     // (ρ 2.4: within ~10 m rms of the exact Gaussian at 40K and 160K, as the mesh's own passes are)
const coarseGraphs = new WeakMap();

/** The field `src` (per cell) smoothed to a Gaussian of σ = sigmaKm. @returns {Float32Array} (a scratch buffer) */
export function smoothHeat(src, simMesh, sigmaKm) {
    const n = simMesh.numCells, S = buffers(n), G = coarseGraph(simMesh);
    if (!G) return smoothOnMesh(src, simMesh, sigmaKm);
    const { m, cOffset, cList, gathered, carryOffset, carryCell, carryWeight } = G;
    let a = G.a, b = G.b;
    // (gathered by the carry's own weights, the other way: each cluster a smooth average of the cells near it)
    a.fill(0);
    for (let w = 0; w < n; w++) { const v = src[w]; for (let j = carryOffset[w]; j < carryOffset[w + 1]; j++) a[carryCell[j]] += carryWeight[j] * v; }
    for (let k = 0; k < m; k++) a[k] /= gathered[k];
    const s2 = G.spacingKm * G.spacingKm, passes = Math.max(0, Math.round((sigmaKm * sigmaKm - 2 * (5 / 72) * CARRY_RHO * CARRY_RHO * s2) / ((3 / 7) * s2)));
    for (let pass = 0; pass < passes; pass++) {
        for (let k = 0; k < m; k++) {
            let s = a[k];
            const j0 = cOffset[k], j1 = cOffset[k + 1];
            for (let j = j0; j < j1; j++) s += a[cList[j]];
            b[k] = s / (1 + j1 - j0);
        }
        [a, b] = [b, a];
    }
    G.a = a; G.b = b;
    const out = src === S.a ? S.b : S.a;
    for (let w = 0; w < n; w++) {
        let s = 0;
        for (let j = carryOffset[w]; j < carryOffset[w + 1]; j++) s += carryWeight[j] * a[carryCell[j]];
        out[w] = s;
    }
    return out;
}

/** The fine mesh's own smoothing (a mesh too coarse for clusters to gain): 7/3 (σ / edge)² passes. */
function smoothOnMesh(src, simMesh, sigmaKm) {
    const n = simMesh.numCells, { adjOffset, adjList } = simMesh, S = buffers(n);
    if (src !== S.a) S.a.set(src);
    let a = S.a, b = S.b;
    const passes = Math.round((7 / 3) * (sigmaKm / simMesh.edgeKm) ** 2);
    for (let pass = 0; pass < passes; pass++) {
        for (let w = 0; w < n; w++) {
            let s = a[w];
            const j0 = adjOffset[w], j1 = adjOffset[w + 1];
            for (let j = j0; j < j1; j++) s += a[adjList[j]];
            b[w] = s / (1 + j1 - j0);
        }
        [a, b] = [b, a];
    }
    return a;
}

/**
 * The clusters of a mesh (built once per mesh): each cell's cluster (of), the clusters' graph (cOffset, cList: two
 * clusters touch where a mesh edge joins them), their cell counts, and each cell's carry-back weights. null where the
 * mesh has under 3 cells a cluster.
 */
function coarseGraph(mesh) {
    if (coarseGraphs.has(mesh)) return coarseGraphs.get(mesh);
    const n = mesh.numCells, { xyz, adjOffset, adjList } = mesh, R = 6371;
    const want = Math.round(4 * Math.PI * R * R / (Math.sqrt(3) / 2 * COARSE_KM * COARSE_KM));
    if (n < 3 * want) { coarseGraphs.set(mesh, null); return null; }
    // the seeds: the cells nearest a Fibonacci lattice's points (uniform over the sphere), each once
    const of = new Int32Array(n).fill(-1), seeds = [], golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < want; i++) {
        const z = 1 - (2 * i + 1) / want, r = Math.sqrt(1 - z * z), phi = i * golden;
        const c = mesh.index.nearest(r * Math.cos(phi), r * Math.sin(phi), z);
        if (of[c] < 0) { of[c] = seeds.length; seeds.push(c); }
    }
    // every cell to its nearest seed through the mesh (by the straight-line distance to it: compact clusters)
    const m = seeds.length, best = new Float64Array(n).fill(Infinity), heap = new MinHeap(n);
    for (let k = 0; k < m; k++) { best[seeds[k]] = 0; heap.push(0, seeds[k]); }
    const d2 = (w, s) => { const dx = xyz[3 * w] - xyz[3 * s], dy = xyz[3 * w + 1] - xyz[3 * s + 1], dz = xyz[3 * w + 2] - xyz[3 * s + 2]; return dx * dx + dy * dy + dz * dz; };
    while (heap.size) {
        const w = heap.pop(), k = of[w], s = seeds[k];
        if (heap.lastKey > best[w]) continue;
        for (let j = adjOffset[w]; j < adjOffset[w + 1]; j++) {
            const nb = adjList[j], d = d2(nb, s);
            if (d < best[nb]) { best[nb] = d; of[nb] = k; heap.push(d, nb); }
        }
    }
    // the clusters' sizes, centres and graph
    const size = new Float64Array(m), cx = new Float64Array(3 * m), links = Array.from({ length: m }, () => new Set());
    for (let w = 0; w < n; w++) {
        const k = of[w];
        size[k]++; cx[3 * k] += xyz[3 * w]; cx[3 * k + 1] += xyz[3 * w + 1]; cx[3 * k + 2] += xyz[3 * w + 2];
        for (let j = adjOffset[w]; j < adjOffset[w + 1]; j++) { const q = of[adjList[j]]; if (q !== k) links[k].add(q); }
    }
    for (let k = 0; k < m; k++) { const l = Math.hypot(cx[3 * k], cx[3 * k + 1], cx[3 * k + 2]) || 1; for (let i = 0; i < 3; i++) cx[3 * k + i] /= l; }
    const cOffset = new Int32Array(m + 1);
    for (let k = 0; k < m; k++) cOffset[k + 1] = cOffset[k] + links[k].size;
    const cList = new Int32Array(cOffset[m]);
    for (let k = 0; k < m; k++) cList.set([...links[k]].sort((x, y) => x - y), cOffset[k]);
    const spacingKm = Math.sqrt(4 * Math.PI / (Math.sqrt(3) / 2 * m)) * R;
    // the carry back: each cell, from the centres within CARRY_RHO spacings of it, all in its cluster's two rings
    const rho = CARRY_RHO * spacingKm / R, rho2 = rho * rho, carryOffset = new Int32Array(n + 1), cells = [], weights = [];
    const rings = Array.from({ length: m }, (_, k) => {
        let set = new Set([k]), edge = [k];
        for (let r = 0; r < CARRY_RINGS; r++) {
            const next = [];
            for (const p of edge) for (let i = cOffset[p]; i < cOffset[p + 1]; i++) { const q = cList[i]; if (!set.has(q)) { set.add(q); next.push(q); } }
            edge = next;
        }
        return Int32Array.from([...set].sort((x, y) => x - y));
    });
    for (let w = 0; w < n; w++) {
        let total = 0;
        const j0 = cells.length;
        for (const q of rings[of[w]]) {
            const dx = xyz[3 * w] - cx[3 * q], dy = xyz[3 * w + 1] - cx[3 * q + 1], dz = xyz[3 * w + 2] - cx[3 * q + 2], d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= rho2) continue;
            const t = Math.sqrt(d2) / rho, wt = (1 - t) ** 4 * (1 + 4 * t);
            cells.push(q); weights.push(wt); total += wt;
        }
        for (let i = j0; i < cells.length; i++) weights[i] /= total;
        carryOffset[w + 1] = cells.length;
    }
    const carryCell = Int32Array.from(cells), carryWeight = Float32Array.from(weights), gathered = new Float64Array(m);
    for (let j = 0; j < carryCell.length; j++) gathered[carryCell[j]] += carryWeight[j];
    const G = { m, cOffset, cList, gathered, spacingKm, carryOffset, carryCell, carryWeight, a: new Float32Array(m), b: new Float32Array(m) };
    coarseGraphs.set(mesh, G);
    return G;
}

/**
 * The swell under each cell, and the sea's level (km, against today's datum).
 *   · swellKm[w]: mantleSwellKm × the smoothed heat — a smooth field of the mantle, fixed under the world. What a point
 *     stands at is read from it there (synthesize.js: interpolated at the point itself, not through the land's corners, so
 *     the swell has no cell-scale steps), less the reference for its side (liftRefKm): continental crust against the heat
 *     a dispersed world's continents stand on (its platform is today's), the sea floor — and an island arc on it — against
 *     the dispersed world's sea floor (the depth–age law and the arcs' heights are today's);
 *   · seaKm: how far the sea stands above today's datum — its water a fixed volume over the ocean's area: the swell's
 *     mean over the sea floor (mantleSwellKm × (the ocean's mean heat − its reference)) and the floor's mean depth's
 *     shortfall from the reference (younger floor: higher sea). Floor the history has not dated yet (the start's
 *     placeholder ocean, tectonics/config.js initialOceanAgeMyr: "uniformly old, soon overwritten") counts at the
 *     reference depth — its ages are unknown, not 150 Myr each. The floor's part counts only with cfg.seaLevelFloorAge
 *     (terrain-config.js: off — the history's floor is too old, and its age swings too far, for its volume to be Earth's);
 *     it is reported either way (ridgeSeaKm).
 * The ocean here is the sea floor that holds water: ocean crust not filled to sea level, and any cell no plate covers.
 * The frame may be any view with its fields per world cell (owner, type, formedAt, seaFillKm, mantleHeat 0–255, time):
 * the history's rivers pass the world's (landAndSea).
 * @param {(w: number) => boolean} isLand  the land as the records see it (continental crust, filled seas)
 * @param {Float32Array} [swellKm]  a buffer to write the swell to
 * @returns {{swellKm: Float32Array, seaKm: number, swellSeaKm: number, ridgeSeaKm: number, heatLand: number, heatSea: number, depthKm: number}}
 */
export function seaLevel(frame, simMesh, cfg, isLand, swellKm = null) {
    const n = simMesh.numCells, H = mantleWarmth(frame, simMesh, cfg);
    swellKm ??= new Float32Array(n);
    for (let w = 0; w < n; w++) swellKm[w] = cfg.mantleSwellKm * H[w];
    return reckonSea(frame, simMesh, cfg, isLand, H, swellKm);
}

/** The sea's level over the heat H (smoothed) and its swell: seaLevel, once the swell is known. */
function reckonSea(frame, simMesh, cfg, isLand, H, swellKm) {
    const n = simMesh.numCells, A = cfg.mantleSwellKm, time = frame.time ?? 0;
    let sea = 0, heatSea = 0, depth = 0, land = 0, heatLand = 0;
    for (let w = 0; w < n; w++) {
        if (isLand(w)) { heatLand += H[w]; land++; continue; }
        sea++; heatSea += H[w];
        const o = frame.owner[w];
        depth += o < 0 || frame.type[w] !== CrustType.OCEAN || frame.formedAt[w] < 0 ? cfg.seaDepthRefKm
            : filledSeaDepthKm(time - frame.formedAt[w], frame.seaFillKm?.[w] ?? 0);
    }
    heatSea /= Math.max(1, sea); depth /= Math.max(1, sea); heatLand /= Math.max(1, land);
    const swellSeaKm = A * (heatSea - cfg.mantleSwellSeaRef), ridgeSeaKm = cfg.seaDepthRefKm - depth;
    return { swellKm, seaKm: swellSeaKm + (cfg.seaLevelFloorAge > 0 ? ridgeSeaKm : 0), swellSeaKm, ridgeSeaKm, heatLand, heatSea, depthKm: depth };
}

/**
 * The swell's reference (km) for ground with this share of island arc: continental crust stands against the heat under a
 * dispersed world's continents, an island arc — it keeps no heat in (tectonics/step/hotspots.js isContinental), and its
 * heights are today's arcs' out over the ocean's mantle — against the sea floor's, as the sea floor itself does.
 */
export function liftRefKm(cfg, arcShare) {
    const a = Math.min(1, Math.max(0, arcShare));
    return cfg.mantleSwellKm * ((1 - a) * cfg.mantleSwellLandRef + a * cfg.mantleSwellSeaRef);
}

/**
 * A sea floor its sediment fills that the mantle's swell holds up at or above the sea: dry land (records.js deriveRecords;
 * the history's rivers, landAndSea) — the floor of seaDepthKm(age), shallowed by its fill (Airy: SEDIMENT_LOAD_FACTOR),
 * raised or lowered by the swell against the sea floor's reference, against the sea's level.
 */
export function liftedDry(frame, w, sl, cfg) {
    return frame.owner[w] >= 0 && frame.type[w] === CrustType.OCEAN && frame.seaFillKm?.[w] > 0 && frame.formedAt[w] >= 0
        && sl.swellKm[w] - cfg.mantleSwellKm * cfg.mantleSwellSeaRef - (seaDepthKm(frame.time - frame.formedAt[w]) - frame.seaFillKm[w] / SEDIMENT_LOAD_FACTOR) >= sl.seaKm;
}

/**
 * The land and the sea's level as the terrain's records stand them (records.js deriveRecords; branch unified-swell, so
 * the history's rivers and the sea they fill see the land the terrain draws — tectonics/step/rivers.js): `land` comes set
 * for crust that is land whatever the sea (continental crust, island arcs, seas filled up: 1); a filled sea the swell
 * lifts dry joins it (2), and the sea's level is reckoned again with it as land.
 * @param {Uint8Array} land  (in and out)
 * @param {Float32Array} [swellKm]  a buffer for the swell
 */
export function landAndSea(frame, simMesh, cfg, land, swellKm = null) {
    const n = simMesh.numCells, H = mantleWarmth(frame, simMesh, cfg), isLand = w => land[w] !== 0;
    swellKm ??= new Float32Array(n);
    for (let w = 0; w < n; w++) swellKm[w] = cfg.mantleSwellKm * H[w];
    let sl = reckonSea(frame, simMesh, cfg, isLand, H, swellKm), raised = 0;
    for (let w = 0; w < n; w++) if (!land[w] && liftedDry(frame, w, sl, cfg)) { land[w] = 2; raised++; }
    if (raised) sl = reckonSea(frame, simMesh, cfg, isLand, H, swellKm);
    return sl;
}

/** A frame's sea level as its records carry it, small enough to post from a worker (null without records). */
export function seaOf(rec) {
    return rec && rec.sea ? { seaKm: rec.seaKm, ...rec.sea } : null;
}
