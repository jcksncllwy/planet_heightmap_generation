// The lithology at the finish (lane litho L2; trimmed from World Orogen's finish-lithology.js, raguilar011095, GPL v3): what
// the surface is made of before its rivers cut it — the rocks the history's record puts there (geology/rocks.js) — as fields
// other stages can read: per cell the rock, how bedded it is, how coarse a sediment it breaks down to, and k_rock, its
// erodibility, normalized so the land's mean is 1 — so the carve's calibrated k stays the mean, flux totals hold, and only
// where the cutting falls moves. Hard rock standing proud and soft rock worn down then come from the carve's own feedback.
//
// What this skips (limits): upstream's painted relief (differentialRelief) and cover stairs are not ported: tier 3, and the
// time-stepped erosion should build them (L3). One layer: k_rock is the rock at the uncarved surface, not of the layer a
// river cuts into, so a canyon through cover keeps the cover's k all the way down (L3 reads the column). The spread is
// compressed (~4.5×; Earth's is far wider: Jackson's ruling 3, tested in L3). rockColumn reads the column again for the
// time-stepped erosion, after the carve: the rock at the carved surface and a loose layer, not the whole column.

import { classifyRocks, Rock } from '../geology/rocks.js';
import { rockHard } from '../geology/lithology.js';
import { worldOcean } from '../terrain/world-ocean.js';
import { GEOLOGY } from '../geology/geology-config.js';

/**
 * @param {Object} o  { mesh, z (km, the uncarved surface), ocean (optional: the world ocean on z; worldOcean), frame, simMesh, seed, cfg (the terrain's), lat, lon (°), rain (mm), temp (°C), lip (0…1) }
 * @returns {{rock: Uint8Array, kRock: Float32Array, hard: Float32Array, bedded: Uint8Array, coarse: Uint8Array, shares: Float64Array}}
 *          bedded 0…255; coarse 1 sand and gravel, 0 mud or solution; kRock 1 on the sea
 */
export function lithologyOf(o, G = GEOLOGY) {
    // (the sea is the world ocean — water below sea level joined to the largest body of it, as the finish's own sea is:
    // finish.js oceanMask, terrain/land-mask.js. Until 2026-11-06 it was every cell at or below 0, so the floor of a
    // closed hollow below the sea — the Dead Sea's, Qattara's — read as sea floor and had no rock)
    const { mesh, z, rain, temp, meanK = 0 } = o, n = mesh.numCells, L = G.lithology, ocean = o.ocean ?? worldOcean(mesh, z, 0).ocean;
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
    const mean = meanK || (land ? sum / land : 1);
    for (let c = 0; c < n; c++) kRock[c] = rock[c] ? kRock[c] / mean : 1;
    return { rock, kRock, hard, bedded, coarse, shares, meanK: mean };
}

/**
 * The rock before the carve: read it, and hand the carve and the ice what it says, for the rules G.useRock replaces. The
 * surface drew carveIn.k without those rules (finish.js rockCfg), so k × k_rock is the rock's alone; soft is the rock's on
 * land, and the shelves keep the terrain's (no rock read there). Returns the fields other stages read.
 */
export function rockBeforeCarve(o, carveIn, G = GEOLOGY) {
    const reuse = {}, ocean = o.ocean ?? worldOcean(o.mesh, o.z, 0).ocean, { rock, kRock, hard, bedded, coarse, shares, meanK } = lithologyOf({ ...o, ocean, lip: carveIn.lip, reuse }, G), { k, soft } = carveIn, use = G.useRock;
    if (use.craton || use.lip || use.crest) for (let c = 0; c < k.length; c++) if (rock[c]) k[c] *= kRock[c];
    if (use.iceSoft) {
        // (the rock says where it is soft; the land's mean stays the terrain's, as k_rock's stays 1: the ice's and the cliffs'
        // rates were calibrated on it, and cliffHardRatio's 1e-3 makes them steep in it)
        let was = 0, now = 0, land = 0;
        for (let c = 0; c < soft.length; c++) if (rock[c]) { was += soft[c]; now += 1 - hard[c]; land++; }
        const shift = land ? (was - now) / land : 0;
        for (let c = 0; c < soft.length; c++) if (rock[c]) soft[c] = Math.min(1, Math.max(0, 1 - hard[c] + shift));
    }
    return { rock, kRock, bedded, coarse, shares, column: { reuse, meanK, ocean, lip: carveIn.lip, soft: use.craton || use.lip || use.crest } };
}

/**
 * The column the time-stepped erosion cuts, on the ground the carve left: the rock at that surface, and the finish's own
 * sediment on it. The first read used the uncarved surface, so a canyon through cover still had the cover's k; this one takes the depth the
 * carve cut off. Ground above the uncarved surface is the finish's own sediment, loose. Same normalization as the first read, so
 * a river that has cut into hard rock is slower in fact, not renormalized away.
 * Limits: one read, so a river that cuts through a bed during the erosion keeps that bed's k. A second read a bed lower moved
 * nothing past noise at either spread (2.5M, three seeds at 4.5×, 100×; one at 3000×), so it was dropped: the span cuts little
 * rock (0.8 Myr). The ice's and the wind's cuts are not counted as depth.
 * @param {Object} o  as lithologyOf, with z the uncarved surface, carved the ground now
 * @param {Object} litho  rockBeforeCarve's result
 * @returns {{here: Float32Array, loose: Float32Array, zBed: Float32Array, fine: Float32Array}}
 *   here: k's multiple for the rock at the carved surface; loose: for the sediment, against here;
 *   zBed: the top of the rock (km); fine: the share of what is cut here that goes as mud or in solution
 */
export function rockColumn(o, litho, G = GEOLOGY) {
    const { z, carved } = o, n = z.length, { reuse, meanK, ocean, lip } = litho.column, L = G.lithology, cut = new Float32Array(n), zBed = new Float32Array(n);
    for (let c = 0; c < n; c++) { cut[c] = Math.max(0, z[c] - carved[c]); zBed[c] = Math.min(z[c], carved[c]); }
    // (the sea as the first read found it: the carve moves the coast little, and a second flood of 2.5M cells is 0.1 s)
    const top = lithologyOf({ ...o, ocean, lip, reuse, meanK, belowKm: cut }, G), first = litho.kRock;
    const here = new Float32Array(n), loose = new Float32Array(n), fine = new Float32Array(n), soft = Math.exp(L.erodeGain * (0.5 - L.hard[Rock.ALLUVIUM])) / meanK;
    for (let c = 0; c < n; c++) {
        const k = top.kRock[c];
        here[c] = litho.column.soft ? k / first[c] : 1; loose[c] = top.rock[c] ? soft / k : 1;
        fine[c] = 1 - (top.coarse[c] ? L.bedShareCoarse : L.bedShareFine);
    }
    return { here, loose, zBed, fine };
}

/** The surface's settings without the hand rules the rock replaces (the terrain's k and its stripes, as they are otherwise). */
export function rockCfg(cfg, G = GEOLOGY) {
    const use = G.useRock, out = { ...cfg };
    if (use.craton) out.carveCratonHardness = 0;
    if (use.lip) out.lipHardness = 0;
    if (use.crest) out.carveCrestHardness = 0;
    return out;
}
