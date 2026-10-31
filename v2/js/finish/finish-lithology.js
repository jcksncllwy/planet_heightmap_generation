// The lithology at the finish (lane litho L2; trimmed from World Orogen's finish-lithology.js, raguilar011095, GPL v3): what
// the surface is made of before its rivers cut it — the rocks the history's record puts there (geology/rocks.js) — as fields
// other stages can read: per cell the rock, how bedded it is, how coarse a sediment it breaks down to, and k_rock, its
// erodibility, normalized so the land's mean is 1 — so the carve's calibrated k stays the mean, flux totals hold, and only
// where the cutting falls moves. Hard rock standing proud and soft rock worn down then come from the carve's own feedback.
//
// What this skips (limits): upstream's painted relief (differentialRelief) and cover stairs are not ported: tier 3, and the
// time-stepped erosion should build them (L3). One layer: k_rock is the rock at the uncarved surface, not of the layer a
// river cuts into, so a canyon through cover keeps the cover's k all the way down (L3 reads the column). The spread is
// compressed (~4.5×; Earth's is far wider: Jackson's ruling 3, tested in L3).

import { classifyRocks } from '../geology/rocks.js';
import { rockHard } from '../geology/lithology.js';
import { GEOLOGY } from '../geology/geology-config.js';

/**
 * @param {Object} o  { mesh, z (km, the uncarved surface), frame, simMesh, seed, cfg (the terrain's), lat, lon (°), rain (mm), temp (°C), lip (0…1) }
 * @returns {{rock: Uint8Array, kRock: Float32Array, hard: Float32Array, bedded: Uint8Array, coarse: Uint8Array, shares: Float64Array}}
 *          bedded 0…255; coarse 1 sand and gravel, 0 mud or solution; kRock 1 on the sea
 */
export function lithologyOf(o, G = GEOLOGY) {
    const { mesh, z, rain, temp } = o, n = mesh.numCells, L = G.lithology, ocean = new Uint8Array(n);
    for (let c = 0; c < n; c++) if (!(z[c] > 0)) ocean[c] = 1;
    const { rock, shares } = classifyRocks({ ...o, ocean }, G);
    const hard = new Float32Array(n), bedded = new Uint8Array(n), coarse = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
        const k = rock[c];
        if (!k) continue;
        hard[c] = rockHard(k, temp[c] === temp[c] ? temp[c] : 10, rain[c] === rain[c] ? rain[c] : 600, G);
        bedded[c] = Math.round(255 * L.bedded[k]); coarse[c] = L.coarse[k];
    }
    // (a cell's hardness with its neighbours': a contact a cell or so wide, not a step between two cells)
    const { adjOffset, adjList } = mesh, was = hard.slice(), kRock = new Float32Array(n);
    let sum = 0, land = 0;
    for (let c = 0; c < n; c++) {
        if (!rock[c]) continue;
        let s = was[c], k = 1;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const d = adjList[j]; if (rock[d]) { s += 0.5 * was[d]; k += 0.5; } }
        hard[c] = s / k;
        kRock[c] = Math.exp(L.erodeGain * (0.5 - hard[c])); sum += kRock[c]; land++;
    }
    const mean = land ? sum / land : 1;
    for (let c = 0; c < n; c++) kRock[c] = rock[c] ? kRock[c] / mean : 1;
    return { rock, kRock, hard, bedded, coarse, shares };
}

/**
 * The rock before the carve: read it, and hand the carve and the ice what it says, for the rules G.useRock replaces. The
 * surface drew carveIn.k without those rules (finish.js rockCfg), so k × k_rock is the rock's alone; soft is the rock's on
 * land, and the shelves keep the terrain's (no rock read there). Returns the fields other stages read.
 */
export function rockBeforeCarve(o, carveIn, G = GEOLOGY) {
    const { rock, kRock, hard, bedded, coarse, shares } = lithologyOf({ ...o, lip: carveIn.lip }, G), { k, soft } = carveIn, use = G.useRock;
    if (use.craton || use.lip || use.crest) for (let c = 0; c < k.length; c++) if (rock[c]) k[c] *= kRock[c];
    if (use.iceSoft) for (let c = 0; c < soft.length; c++) if (rock[c]) soft[c] = 1 - hard[c];
    return { rock, kRock, bedded, coarse, shares };
}

/** The surface's settings without the hand rules the rock replaces (the terrain's k and its stripes, as they are otherwise). */
export function rockCfg(cfg, G = GEOLOGY) {
    const use = G.useRock, out = { ...cfg };
    if (use.craton) out.carveCratonHardness = 0;
    if (use.lip) out.lipHardness = 0;
    if (use.crest) out.carveCrestHardness = 0;
    return out;
}
