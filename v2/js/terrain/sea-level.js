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
// hot, stands shallower and holds less water — the sea rises (Hays & Pitman 1973; Müller et al. 2008).
//
// All of it is read from the frame (the history's mantleHeat, crust ages and sea fill): the history is unchanged.
// Heights are calibrated against today's sea — a dispersed world's — so each part is measured from what a dispersed
// world shows on average (terrain-config.js mantleSwellLandRef, mantleSwellSeaRef, seaDepthRefKm): today's land stands
// where it does with today's mantle under it, and today's sea is at 0.

import { CrustType } from '../tectonics/model/crust.js';
import { filledSeaDepthKm } from '../tectonics/measure.js';

let scratch = null;
const buffers = n => (scratch?.n === n ? scratch : (scratch = { n, a: new Float32Array(n), b: new Float32Array(n) }));

/**
 * The mantle's heat (0 cooled … 1 fully insulated) as the surface feels it: the frame's per-cell heat smoothed to a
 * Gaussian of cfg.mantleSwellSmoothKm (the dynamic topography of a load at depth is spread over about its depth: Hager &
 * Richards 1989). Each pass averages a cell with its neighbours, a variance of ~3/7 of an edge² along each axis
 * (6 of 7 points one edge away), so σ km takes 7/3 (σ / edge)² passes — the same σ at every mesh.
 * @returns {Float32Array} (a scratch buffer: copy it to keep it)
 */
export function mantleWarmth(frame, simMesh, cfg) {
    const n = simMesh.numCells, { adjOffset, adjList } = simMesh, S = buffers(n);
    let a = S.a, b = S.b;
    for (let w = 0; w < n; w++) a[w] = frame.mantleHeat[w] / 255;
    const passes = Math.round((7 / 3) * (cfg.mantleSwellSmoothKm / simMesh.edgeKm) ** 2);
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
 * The swell under each cell against the sea, and the sea's level (km, against today's datum).
 *   · liftKm[w]: mantleSwellKm × (heat − the reference for its side): continental crust against the heat a dispersed
 *     world's continents stand on (its platform is today's), the sea floor — and an island arc on it — against the
 *     dispersed world's sea floor (the depth–age law and the arcs' heights are today's);
 *   · seaKm: how far the sea stands above today's datum — its water a fixed volume over the ocean's area: the swell's
 *     mean over the sea floor (mantleSwellKm × (the ocean's mean heat − its reference)) and the floor's mean depth's
 *     shortfall from the reference (younger floor: higher sea). Floor the history has not dated yet (the start's
 *     placeholder ocean, tectonics/config.js initialOceanAgeMyr: "uniformly old, soon overwritten") counts at the
 *     reference depth — its ages are unknown, not 150 Myr each.
 * The ocean here is the sea floor that holds water: ocean crust not filled to sea level, and any cell no plate covers.
 * @param {(w: number) => boolean} isLand  the land as the records see it (continental crust, filled seas)
 * @returns {{liftKm: Float32Array, seaKm: number, swellSeaKm: number, ridgeSeaKm: number, heatLand: number, heatSea: number, depthKm: number}}
 */
export function seaLevel(frame, simMesh, cfg, isLand) {
    const n = simMesh.numCells, H = mantleWarmth(frame, simMesh, cfg), A = cfg.mantleSwellKm, time = frame.time ?? 0;
    const liftKm = new Float32Array(n);
    let sea = 0, heatSea = 0, depth = 0, land = 0, heatLand = 0;
    for (let w = 0; w < n; w++) {
        // (an island arc keeps no heat in — tectonics/step/hotspots.js isContinental — and its heights are today's arcs'
        // out over the ocean's mantle: it stands against the sea floor's reference)
        if (isLand(w)) { liftKm[w] = A * (H[w] - (frame.type[w] === CrustType.ARC ? cfg.mantleSwellSeaRef : cfg.mantleSwellLandRef)); heatLand += H[w]; land++; continue; }
        liftKm[w] = A * (H[w] - cfg.mantleSwellSeaRef);
        sea++; heatSea += H[w];
        const o = frame.owner[w];
        depth += o < 0 || frame.type[w] !== CrustType.OCEAN || frame.formedAt[w] < 0 ? cfg.seaDepthRefKm
            : filledSeaDepthKm(time - frame.formedAt[w], frame.seaFillKm?.[w] ?? 0);
    }
    heatSea /= Math.max(1, sea); depth /= Math.max(1, sea); heatLand /= Math.max(1, land);
    const swellSeaKm = A * (heatSea - cfg.mantleSwellSeaRef), ridgeSeaKm = cfg.seaDepthRefKm - depth;
    return { liftKm, seaKm: swellSeaKm + ridgeSeaKm, swellSeaKm, ridgeSeaKm, heatLand, heatSea, depthKm: depth };
}

/** A frame's sea level as its records carry it, small enough to post from a worker (null without records). */
export function seaOf(rec) {
    return rec && rec.sea ? { seaKm: rec.seaKm, ...rec.sea } : null;
}
