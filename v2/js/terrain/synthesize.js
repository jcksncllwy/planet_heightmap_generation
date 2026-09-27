// Terrain synthesis, stage 1 (Phase 8a): the TECTONIC SURFACE — the planet as its tectonic history built it,
// before rivers carve it (8b). WBP Part VIIc draws ranges "higher and broader than the target, since erosion
// removes material"; this is that drawing, done from the records:
//   · the sea floor from crust age (ridges, abyssal plains, fracture-zone steps), abyssal hills along the isochrons,
//     trenches with their outer rise, oceanic plateaus;
//   · continents on an isostatic platform (thickened crust floats high, and sinks back as a quiet belt's root
//     erodes), with shelves, slopes and coastal plains by kind of margin;
//   · mountain belts laid out across their width by kind and side (profiles.js), with parallel ridges along their
//     strike (stripes.js), and volcanoes (volcanoes.js).
// In km above sea level, on a terrain mesh of any resolution (terrain-mesh.js). The fine detail belongs to the crust:
// noise is read in the frame of the plate under each point, and ridges and volcanoes are keyed to crust cells
// (anchor.js), so a range keeps its detail as its plate moves.

import { TERRAIN } from './terrain-config.js';
import { deriveRecords, kindType, kindSide } from './records.js';
import { beltProfile, crestProfile, stripeZone, beltEdge } from './profiles.js';
import { buildStripeKernels, stripeAt, crossAt, carriedField, carriedStripeAt } from './stripes.js';
import { lipPieces, dykeAt } from './lips.js';
import { buildVolcanoes, coneAt, volcanoNoise } from './volcanoes.js';
import { cratonCharacter } from './cratons.js';
import { sampleOnto, warpField, warpPoint } from './terrain-mesh.js';
import { buildAnchor, plateFramePoint, plateToWorld, rasterToWorld } from './anchor.js';
import { locate } from '../core/mesh-locate.js';
import { rainAtLatitude } from './terrain-config.js';
import { carveTerrain } from './carve.js';
import { terrainMesh } from './terrain-mesh.js';
import { FastNoise as SimplexNoise } from '../core/fast-noise.js';     // (bit-identical to V1's SimplexNoise, faster)

const R = 6371;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @param {import('../tectonics/snapshot.js').Frame} frame
 * @param {Object} simMesh      the mesh the frame lives on
 * @param {Object} tMesh        the terrain mesh (terrain-mesh.js)
 * @param {{cfg?: Object, seed?: number, sampler?: Object, parts?: boolean, carve?: boolean}} [opts]
 *        sampler: reuse sampleOnto()'s result for this (sim, terrain, seed); parts: also return the components;
 *        carve: let rivers carve it (Phase 8b) — heightKm is then the carved surface, tectonicKm the one before,
 *        drainage the drainage area (km², rain-weighted), receivers where each cell drains (−1 − s: into sea cell s)
 * @returns {{heightKm: Float32Array, parts: Object|null, rec: Object, ms: Object}}
 */
export function synthesizeTerrain(frame, simMesh, tMesh, opts = {}) {
    const cfg = opts.cfg ?? TERRAIN, seed = opts.seed ?? 0;
    const ms = {}, clock = () => performance.now();
    let t0 = clock();
    const plan = preparePlan(frame, simMesh, cfg, seed, tMesh.edgeKm);
    ms.records = clock() - t0; t0 = clock();
    const S = opts.sampler ?? sampleOnto(simMesh, tMesh, cfg, seed);
    ms.sample = clock() - t0; t0 = clock();
    const n = tMesh.numCells, heightKm = new Float32Array(n);
    const parts = opts.parts ? surfaceParts(n) : null;
    const carveIn = opts.carve ? carveInputs(n) : null;
    surfaceRange(plan, cfg, seed, tMesh.edgeKm, tMesh.xyz, S.cells, S.weights, 0, n, heightKm, parts, carveIn);
    ms.surface = clock() - t0;
    const out = { heightKm, parts, rec: plan.rec, sampler: S, ms, kernels: plan.Ks[0].count + plan.Ks[1].count, volcanoes: plan.V.count };
    if (!opts.carve) return out;
    t0 = clock();
    const C = carveTerrain(carveLadder(simMesh, tMesh, terrainMesh), { ...carveIn, z: heightKm }, carveSettings(cfg));
    ms.carve = clock() - t0;
    return { ...out, heightKm: C.z, tectonicKm: heightKm, drainage: C.area, receivers: C.recv };
}

/** Per-terrain-cell arrays of the surface's components (platform — flood basalt included —, belt relief, ridges, cones, the flood basalt alone). */
export function surfaceParts(n) {
    return { platform: new Float32Array(n), relief: new Float32Array(n), stripes: new Float32Array(n), cones: new Float32Array(n), lip: new Float32Array(n), dcoast: new Float32Array(n), dshelf: new Float32Array(n), dplain: new Float32Array(n), dcoastRaw: new Float32Array(n) };
}

/** Per-terrain-cell arrays the surface pass fills for the carving (u, k, rain, micro, slope, inc; carve.js). */
export function carveInputs(n) {
    return { u: new Float32Array(n), k: new Float32Array(n), rain: new Float32Array(n), micro: new Float32Array(n), slope: new Float32Array(n), inc: new Float32Array(n), hold: new Float32Array(n),
        lip: new Float32Array(n), lipBase: new Float32Array(n), lipTop: new Float32Array(n) };
}

/**
 * The meshes the carving climbs, coarse to fine, a factor 4 apart: the sim mesh, then the terrain meshes below the one
 * carved (made by `meshOf(numCells)`), then that one.
 */
export function carveLadder(simMesh, tMesh, meshOf) {
    return [simMesh, ...[160000, 640000].filter(c => c < tMesh.numCells * 0.9).map(meshOf), tMesh];
}

/** The carving's settings (the same on every mesh: carve.js scales the valleys to each mesh's cells). */
export function carveSettings(cfg) {
    return { timeMyr: cfg.carveTimeMyr, m: cfg.carveM, rounds: cfg.carveRounds, valleyKm: cfg.carveValleyKm, activeHold: cfg.carveActiveHold, lipStepKm: cfg.lipStepKm, lipRiser: cfg.lipRiser };
}

/**
 * Everything per frame that the surface pass reads — the records, each belt layer's ridge kernels (with their
 * resolution fade for a terrain mesh of `edgeKm` spacing) and the volcanoes. Small (sim-mesh sized): on the pool, one
 * worker builds it from the frame and hands it to the others (planToData).
 */
export function preparePlan(frame, simMesh, cfg, seed, edgeKm) {
    const A = buildAnchor(frame, simMesh), rec = deriveRecords(frame, simMesh, cfg, seed, A);
    const timeMyr = frame.time ?? 0, Ks = rec.belts.map((layer, i) => buildStripeKernels(layer, simMesh, cfg, seed + 7919 * i, A, timeMyr));
    // each kernel's resolution fade (main and fine set) depends only on its wavelength and this mesh: computed once
    for (const K of Ks) {
        K.fade1 = Float64Array.from(K.wave, lam => smooth(cfg.minWavesPerCell, cfg.fullWavesPerCell, lam / edgeKm));
        K.fade2 = Float64Array.from(K.wave, lam => (cfg.stripeFineShare > 0 ? smooth(cfg.minWavesPerCell, cfg.fullWavesPerCell, lam / cfg.stripeFineRatio / edgeKm) : 0));
    }
    return { rec, Ks, A, V: buildVolcanoes(frame, rec, simMesh, cfg, seed, A, edgeKm), L: lipPieces(frame, simMesh, A), mesh: simMesh, timeMyr };
}

/**
 * A plan as plain data — no mesh, no noise objects — to send to another worker (terrain-pool.js: one worker builds each
 * frame's plan, the others receive it); planFromData(data, simMesh, seed) there gives back the same plan, bit for bit.
 */
export function planToData(plan) {
    const { mesh, carry, V: { noise, ...V }, ...rest } = plan;
    return { ...rest, V };
}
export function planFromData(data, simMesh, seed) {
    return { ...data, V: { ...data.V, noise: volcanoNoise(seed) }, mesh: simMesh };
}

/**
 * The tectonic surface for terrain cells from…to−1: positions from `xyz`, sim-mesh corners and weights from sCells /
 * sWeights (sampleOnto), heights into heightKm (and the components into `parts`, the carving's inputs into `carve`,
 * if given) — all indexed alike. Every cell depends only on its own position and the plan, so any split of the cells
 * gives the same heights.
 */
export function surfaceRange(plan, cfg, seed, edgeKm, xyz, sCells, sWeights, from, to, heightKm, parts = null, carve = null) {
    const { rec, Ks, V, A, L, mesh: simMesh } = plan, { cell } = A, p = [0, 0, 0], d = [0, 0, 0], cross = [0, 0];
    const warpN = warpField(seed, cfg), local = [0, 0, 0], warped = [0, 0, 0], r3 = [0, 0, 0], rw3 = [0, 0, 0], q3 = [0, 0, 0], qw3 = [0, 0, 0];
    const anchorOn = cfg.anchorRecords !== false;
    // the point located on plate o's raster (the point in o's frame, warped there): raster cells into cells, weights into weights
    const onRaster = (o, px, py, pz, cells, weights) => {
        const m = A.mats, b = 9 * o;
        local[0] = m[b] * px + m[b + 3] * py + m[b + 6] * pz; local[1] = m[b + 1] * px + m[b + 4] * py + m[b + 7] * pz; local[2] = m[b + 2] * px + m[b + 5] * py + m[b + 8] * pz;
        warpPoint(warpN, cfg, local[0], local[1], local[2], warped);
        locate(simMesh, warped[0], warped[1], warped[2], cells, weights);
    };
    const noise = new SimplexNoise(seed * 31 + 9);
    // Fine detail renews (detailRenewMyr): time runs in epochs of that length, and over each a renewing field fades from
    // one noise to the next — cos/sin weights, the two independent, so its spread never dips — steady from frame to
    // frame, new after an epoch or two. At time 0 (and with no renewal), exactly the field it replaced.
    const renewT = cfg.detailRenewMyr > 0 ? (plan.timeMyr ?? 0) / cfg.detailRenewMyr : 0, epoch = Math.floor(renewT);
    const fadeA = Math.cos((renewT - epoch) * Math.PI / 2), fadeB = Math.sin((renewT - epoch) * Math.PI / 2), offA = 57.31 * epoch, offB = 57.31 * (epoch + 1);
    const renewed = (fx, fy, fz, octaves) => {
        const a = noise.fbm(fx + offA, fy + offA, fz + offA, octaves, 0.5);
        return fadeB > 0 ? fadeA * a + fadeB * noise.fbm(fx + offB, fy + offB, fz + offB, octaves, 0.5) : a;
    };
    const fade = lam => smooth(cfg.minWavesPerCell, cfg.fullWavesPerCell, lam / edgeKm);
    const cratF = R / 600, shapeF = R / cfg.cratonShapeKm, grainF = R / cfg.cratonGrainScaleKm, grainShow = fade(cfg.cratonGrainScaleKm);
    const coastF = R / 700, platF = R / 2000, strikeF = R / 900, segF = R / cfg.stripeSegmentKm, meanderF = R / cfg.stripeMeanderAlongKm, meander = cfg.stripeMeanderKm / R;
    const blendF = R / cfg.blendNoiseKm, crestF = R / 150, slopeF = R / 300, microF = R / cfg.carveMicroScaleKm, mesaF = R / cfg.lipMesaKm;
    // a corner's share, scaled by a noise field of its own (decorrelated per crust cell, continuous across triangles)
    const noisy = (c, w) => { const r = cell[c]; return w * Math.exp(cfg.blendNoise * noise.fbm(x0 * blendF + (r % 101) * 1.37, y0 * blendF + (r % 89) * 2.11, z0 * blendF + (r % 83) * 0.73, 3, 0.5) * 1.6); };
    let x0 = 0, y0 = 0, z0 = 0;
    const { cratons: CR, terrane } = rec;
    const { coastKm, land, arc: arcCrust, craton, quietMyr, kind: beltKind, riverIncKm, platformKm, upliftKm, lipKm, lipWornKm, lipSrc, lipEdgeKm, lipOutKm, depthKm, shelfKm, plainKm, slopeKm, ageMyr, fabricKm, trenchKm, riseKm, trenchDepthKm, armKm } = rec;
    const kinds = [0, 0, 0], wts = [0, 0, 0], nts = [0, 0, 0];
    // carried ridges (cfg.stripeCarry, stripes.js): each belt layer's sums at the corners of the rasters, kept on the plan
    // (a worker's chunks share them); a point's corners on the raster of the plate under it
    const carry = cfg.stripeCarry ? (plan.carry ??= new Map()) : null, cr3 = [0, 0, 0], cw3 = [0, 0, 0];
    let carryO = -1;

    for (let t = from; t < to; t++) {
        let c0 = sCells[3 * t], c1 = sCells[3 * t + 1], c2 = sCells[3 * t + 2];
        let w0 = sWeights[3 * t], w1 = sWeights[3 * t + 1], w2 = sWeights[3 * t + 2];
        const px = xyz[3 * t], py = xyz[3 * t + 1], pz = xyz[3 * t + 2];
        // (the world cell nearest the point itself: what can reach it — ridge kernels, volcanoes — is listed by it, near-lists.js;
        // a sampling corner can lie two cells off once the lookup is warped and anchored)
        const cn = simMesh.index.nearest(px, py, pz);
        // ── the records are read over the plate's own raster, which rides with the crust (Phase 9, developer: steady
        // detail): the point, in the frame of the plate under it, warped there and located on the raster — its corners
        // are that plate's crust cells, shown this frame by the world cells nearest them. Interpolated over the fixed world
        // grid instead, a moving plate's coasts, belt edges and plains re-formed at the scale of its cells every frame.
        // (Where the point's corners belong to more than one plate, or a corner's crust is hidden, the world grid still.) ──
        const o = A.owner[c0];
        // the plate whose land is here — the coast is read on its raster, the sea beyond it included (a coastline belongs
        // to its continent) — or, with no land at the corners, the plate here
        let oc = o, best = -1;
        for (let j = 0; j < 3; j++) { const c = j === 0 ? c0 : j === 1 ? c1 : c2, wj = j === 0 ? w0 : j === 1 ? w1 : w2; if (land[c] && A.owner[c] >= 0 && wj > best) { best = wj; oc = A.owner[c]; } }
        let anchored = false, carried = false;
        if (anchorOn && o >= 0 && A.moved[o] && A.owner[c1] === o && A.owner[c2] === o) {
            onRaster(o, px, py, pz, r3, rw3);
            const a0 = rasterToWorld(A, simMesh, o, r3[0]), a1 = rasterToWorld(A, simMesh, o, r3[1]), a2 = rasterToWorld(A, simMesh, o, r3[2]);
            if (a0 >= 0 && a1 >= 0 && a2 >= 0) { c0 = a0; c1 = a1; c2 = a2; w0 = rw3[0]; w1 = rw3[1]; w2 = rw3[2]; anchored = true; }
        }
        let coastR = null, shelfR = 0, plainR = 0;
        if (anchorOn && oc >= 0 && A.moved[oc]) {
            const S = rec.coastRaster.get(oc);
            if (S) {
                if (!(anchored && oc === o)) { onRaster(oc, px, py, pz, q3, qw3); } else { q3[0] = r3[0]; q3[1] = r3[1]; q3[2] = r3[2]; qw3[0] = rw3[0]; qw3[1] = rw3[1]; qw3[2] = rw3[2]; }
                const s0 = S.coast[q3[0]], s1 = S.coast[q3[1]], s2 = S.coast[q3[2]];
                if (s0 === s0 && s1 === s1 && s2 === s2) {
                    coastR = qw3[0] * s0 + qw3[1] * s1 + qw3[2] * s2;
                    shelfR = qw3[0] * S.shelf[q3[0]] + qw3[1] * S.shelf[q3[1]] + qw3[2] * S.shelf[q3[2]];
                    plainR = qw3[0] * S.plain[q3[0]] + qw3[1] * S.plain[q3[1]] + qw3[2] * S.plain[q3[2]];
                }
            }
        }
        // (x, y, z): where the point lies in the frame of the crust under it — every noise below is read there
        plateFramePoint(A, c0, c1, c2, w0, w1, w2, px, py, pz, p);
        const x = p[0], y = p[1], z = p[2];
        x0 = x; y0 = y; z0 = z;
        // (the coast distance: on the raster of the plate whose land is here, where it can be — records.js plateCoasts)
        let coast = coastR ?? w0 * coastKm[c0] + w1 * coastKm[c1] + w2 * coastKm[c2];
        if (parts) parts.dcoastRaw[t] = coast;
        if (Math.abs(coast) < 600) coast += cfg.coastNoiseKm * renewed(x * coastF + 3.3, y * coastF + 1.1, z * coastF + 7.9, 4) * 1.5;
        let h, platform = 0, relief = 0, stripes = 0, lipTop = 0, lipKeep = 0, ramp = 0, shieldS = 0, rimFade = 1;

        if (coast >= 0) {
            // ── land side: the platform over the land corners (interfingering), dropping to the shelf toward the coast ──
            const e0 = noisy(c0, w0), e1 = noisy(c1, w1), e2 = noisy(c2, w2);          // (each corner's noisy share, computed once)
            const n0 = land[c0] ? e0 : 0, n1 = land[c1] ? e1 : 0, n2 = land[c2] ? e2 : 0, lw = n0 + n1 + n2;
            platform = lw > 0 ? (n0 * platformKm[c0] + n1 * platformKm[c1] + n2 * platformKm[c2]) / lw : cfg.continentKm;
            platform += cfg.platformNoiseKm * noise.fbm(x * platF + 5.1, y * platF + 9.2, z * platF + 2.4, 4, 0.5) * 1.5;
            // ── a flood basalt (lips.js): the pile as it has worn — its cap gone first where the mesa noise is low and
            // from the province's edge in: an intact plateau when young, then an escarpment with mesas before it, then
            // buttes and remnants ──
            lipTop = lw > 0 ? (n0 * lipKm[c0] + n1 * lipKm[c1] + n2 * lipKm[c2]) / lw : 0;
            if (lipTop > 0.002) {
                const worn = (n0 * lipWornKm[c0] + n1 * lipWornKm[c1] + n2 * lipWornKm[c2]) / lw, edge = (n0 * lipEdgeKm[c0] + n1 * lipEdgeKm[c1] + n2 * lipEdgeKm[c2]) / lw;
                const src = lipSrc[n0 * lipKm[c0] >= n1 * lipKm[c1] && n0 * lipKm[c0] >= n2 * lipKm[c2] ? c0 : n1 * lipKm[c1] >= n2 * lipKm[c2] ? c1 : c2], s = (src * 7.31) % 97;
                // the mesa noise, spread about evenly over 0…1; how far the stripping has gone here — the share of the
                // pile worn through, sooner near the edge; the cap stays where the noise stands above it, in tiers (worn
                // right through, the top tier still stands on the highest third of the noise: remnants last)
                const mesa = Math.max(0, Math.min(1, (1.6 * noise.fbm(x * mesaF + 0.37 * s, y * mesaF + 1.3 + 0.61 * s, z * mesaF + 2.9, 3, 0.5) + 0.65) / 1.3));
                const p = worn / Math.max(0.15, lipTop) * (1 + cfg.lipEdgeWear * Math.exp(-edge / cfg.lipEdgeKm)), level = 0.7 * p - cfg.lipTierBand;
                let keep = 0;
                for (let j = 0; j < cfg.lipTiers; j++) keep += smooth(level - j * cfg.lipTierStep - cfg.lipTierBand, level - j * cfg.lipTierStep + cfg.lipTierBand, mesa);
                lipKeep = lipTop * (1 - cfg.lipWearFloor * Math.min(1, p)) * keep / cfg.lipTiers;
                platform += lipKeep;
            }
            // ── a craton (terrain/cratons.js): its edge a line — the signed distance to it, on the plate's own raster where
            // the point was read there, moved in and out by noise — not the sim cells' staircase; a range pressed against it
            // fading across its rim; a foreland bent into it by the range's weight; its character and grain ──
            // (on the raster where all three corners carry the plate's crust there — a corner it does not cover is NaN,
            // and the point then reads the world cells, as the coast does)
            const CRr = anchored ? CR.rasters.get(o) : null, dr = CRr?.depth;
            const CRo = dr && dr[r3[0]] === dr[r3[0]] && dr[r3[1]] === dr[r3[1]] && dr[r3[2]] === dr[r3[2]] ? CRr : null;
            const cDepth = CRo ? rw3[0] * CRo.depth[r3[0]] + rw3[1] * CRo.depth[r3[1]] + rw3[2] * CRo.depth[r3[2]]
                : anchored && !CRr ? -2000 : w0 * CR.depthW[c0] + w1 * CR.depthW[c1] + w2 * CR.depthW[c2];
            // (the corners' own share of craton; and whether the craton can matter here at all: more than 200 km outside
            // its edge, with no craton corner, the edge noise (|fbm| < 1: ≤ 105 km) cannot bring the line within the blend —
            // every term below is exactly 0)
            const cells = lw > 0 ? (n0 * craton[c0] + n1 * craton[c1] + n2 * craton[c2]) / lw : 0;
            if (cDepth > -200 || cells > 0) {
                const cLoad = CRo ? rw3[0] * CRo.load[r3[0]] + rw3[1] * CRo.load[r3[1]] + rw3[2] * CRo.load[r3[2]] : w0 * CR.loadW[c0] + w1 * CR.loadW[c1] + w2 * CR.loadW[c2];
                const cPatch = CRo ? Math.max(CRo.patch[r3[0]], CRo.patch[r3[1]], CRo.patch[r3[2]]) : Math.max(CR.patchW[c0], CR.patchW[c1], CR.patchW[c2]);
                const crN = cDepth + cfg.cratonEdgeNoiseKm * noise.fbm(x * cratF + 9.1, y * cratF + 3.7, z * cratF + 5.3, 3, 0.5) * 1.5;
                const whole = smooth(0.5 * cfg.cratonScrapKm, 1.5 * cfg.cratonScrapKm, cPatch);      // (a scrap reads as its surroundings)
                const before = platform;
                shieldS = smooth(-cfg.cratonBlendKm, cfg.cratonBlendKm, crN) * whole;
                // the shield's platform over the line: the corners' own share of it replaced by the line's
                platform += (cfg.cratonKm - cfg.continentKm) * (shieldS - cells);
                rimFade = 1 - whole * smooth(cfg.cratonRimInKm, cfg.cratonRimOutKm, crN);
                // the foreland: deepest just in front of the rim's thrusts, rising to a low forebulge (a stiff plate's flexure)
                if (cLoad > 0.002) {
                    const xf = (crN - cfg.forelandFromKm) / cfg.forelandAlphaKm;
                    const f = xf <= 0 ? smooth(-cfg.cratonBlendKm, cfg.forelandFromKm, crN) : Math.exp(-xf) * Math.cos(xf);
                    platform -= whole * cLoad * (f > 0 ? f : cfg.forebulgeGain * f);
                }
                // the shield's character (per craton: a sag basin, a swell, a flat shield) and its grain of domes and keels
                if (shieldS > 0.01) {
                    let cT = c0, cW = -1;
                    for (let j = 0; j < 3; j++) { const c = j === 0 ? c0 : j === 1 ? c1 : c2, wj = j === 0 ? w0 : j === 1 ? w1 : w2; if (craton[c] && wj > cW) { cW = wj; cT = c; } }
                    const ch = cratonCharacter(CR, seed, terrane[cT]), k = cfg.cratonCharacter * shieldS;
                    const rho = Math.min(1, Math.max(0, crN / Math.max(1, cPatch)));
                    if (ch.kind !== 0) {
                        const form = smooth(0.1, 0.8, rho + 0.3 * 1.6 * noise.fbm(x * shapeF + ch.salt, y * shapeF + 2.3 * ch.salt, z * shapeF + 5.5, 3, 0.5));
                        platform += k * ch.amp * (ch.kind > 0 ? cfg.cratonSwellKm : -cfg.cratonSagKm) * form;
                    } else platform += k * ch.amp * cfg.cratonFlatKm * 1.6 * noise.fbm(x * shapeF + ch.salt, y * shapeF + 4.1, z * shapeF + 2.3 * ch.salt, 3, 0.5);
                    if (grainShow > 0) platform += k * cfg.cratonGrainKm * grainShow * smooth(0, 150, crN) * (0.7 - 2 * Math.abs(noise.noise3D(x * grainF + 3.3, y * grainF + 8.8, z * grainF + 1.1)));
                }
                if (platform < 0.04 && before >= 0.04) platform = 0.04;            // (a sag or a foredeep is lowland, not sea)
            }
            // (the shelf and the coastal plain: with the coast, on its plate's raster where it was read there)
            const shelf = coastR !== null ? shelfR : w0 * shelfKm[c0] + w1 * shelfKm[c1] + w2 * shelfKm[c2];
            const plain = coastR !== null ? plainR : w0 * plainKm[c0] + w1 * plainKm[c1] + w2 * plainKm[c2];
            ramp = coast < shelf ? 0 : smooth(0, 1, (coast - shelf) / Math.max(1, plain));
            if (parts) { parts.dcoast[t] = coast; parts.dshelf[t] = shelf; parts.dplain[t] = plain; }
            h = coast < shelf ? cfg.shelfEdgeKm * (1 - coast / shelf) : platform * ramp;
            // the radiating dykes: coming out from under the lava across its edge (a signed distance — negative inside the
            // province — over the land corners), and within it only where erosion has bared them; never drowning land
            // (a low of the grain stops just above the sea)
            if (L.count && ramp > 0 && lw > 0) {
                const out = (n0 * (lipOutKm[c0] - lipEdgeKm[c0]) + n1 * (lipOutKm[c1] - lipEdgeKm[c1]) + n2 * (lipOutKm[c2] - lipEdgeKm[c2])) / lw;
                const show = ramp * smooth(-cfg.dykeInKm, cfg.dykeOutKm, out) * (lipTop > 0.002 ? 1 - lipKeep / lipTop : 1);
                if (show > 0) { const dk = show * dykeAt(L, A.owner[c0], x, y, z, noise, fade, cfg); if (dk) h = Math.max(h + dk, Math.min(h, 0.02)); }
            }

            // ── mountain belts, in two layers: the current belt, and the one it overprinted at overprintShare. In each,
            // every belt kind among the corners counts by its (noisy) share of the weight; the position across the belt
            // is carried smoothly, so crests stay in their place ──
            wts[0] = w0; wts[1] = w1; wts[2] = w2;
            const nsum = e0 + e1 + e2;
            nts[0] = e0 / nsum; nts[1] = e1 / nsum; nts[2] = e2 / nsum;
            const jitter = cfg.edgeJitter * noise.fbm(x * blendF + 6.2, y * blendF + 1.9, z * blendF + 4.4, 3, 0.5) * 1.6;
            const atEdge = smooth(0, 40, coast);        // (relief tapers to nothing at the edge of the continental crust: no step at the slope)
            let warped = false, wx = 0, wy = 0, wz = 0, texture = 0;
            for (let li = 0; li < 2; li++) {
            const { kind, dKm, reach, reliefKm } = rec.belts[li], share = li === 0 ? 1 : cfg.overprintShare;
            kinds[0] = kind[c0]; kinds[1] = kind[c1]; kinds[2] = kind[c2];
            if (!kinds[0] && !kinds[1] && !kinds[2]) continue;
            let layerRelief = 0, stripeAmp = 0, noiseAmp = 0, noiseAcross = 0;
            for (let a = 0; a < 3; a++) {
                const k = kinds[a];
                if (!k || (a > 0 && kinds[0] === k) || (a > 1 && kinds[1] === k)) continue;
                let m = 0, ws = 0, d = 0, W = 0, A = 0;
                for (let b = a; b < 3; b++) {
                    if (kinds[b] !== k) continue;
                    const c = b === 0 ? c0 : b === 1 ? c1 : c2, wb = wts[b];
                    m += nts[b]; ws += wb; d += wb * dKm[c]; W += wb * reach[c]; A += nts[b] * reliefKm[c];
                }
                if (m <= 0 || ws <= 0) continue;
                d /= ws; W /= ws; A /= m;
                // the crests (the broad part of the belt is in the evolved uplift, carried by the platform above)
                const type = kindType(k), side = kindSide(k);
                layerRelief += m * A * crestProfile(type, side, d, W, jitter);
                // the parallel ridges: a share of this belt's whole relief, plus a little on its low ground
                const raised = Math.max(0, A * beltProfile(type, side, d, W, jitter)), intensity = A / cfg.reliefKm[type];
                stripeAmp += m * stripeZone(type, side, d, W, jitter) * (cfg.stripeShare * raised + cfg.stripeBaseKm * intensity);
                // the ridge noise, over the whole belt: its highs and lows drawn out along the strike
                const amp = m * beltEdge(d, W, jitter) * (cfg.ridgeNoiseShare * raised + cfg.ridgeNoiseBaseKm * intensity);
                noiseAmp += amp; noiseAcross += amp * cfg.ridgeNoiseAcross * cfg.stripeKm[type];
            }
            relief += share * layerRelief;
            stripeAmp *= share * atEdge;
            const acrossKm = noiseAmp > 0 ? noiseAcross / noiseAmp : 0;
            noiseAmp *= share * atEdge;
            if (stripeAmp > 0.005 || noiseAmp > 0.002) {
                if (!warped) {                          // (the meander warp and the ridges' texture: shared by both layers)
                    warped = true;
                    // (a displacement in the crust's frame, turned into the world: the kernels live in the world)
                    d[0] = meander * noise.fbm(x * meanderF + 1.5, y * meanderF + 4.5, z * meanderF + 9.5, 2, 0.5);
                    d[1] = meander * noise.fbm(x * meanderF + 7.5, y * meanderF + 0.5, z * meanderF + 3.5, 2, 0.5);
                    d[2] = meander * noise.fbm(x * meanderF + 4.1, y * meanderF + 6.1, z * meanderF + 0.9, 2, 0.5);
                    plateToWorld(A, A.owner[c0], d);
                    wx = px + d[0]; wy = py + d[1]; wz = pz + d[2];
                    // segments that fade in and out along the strike, crests that rise and fall along their length
                    const seg = smooth(-0.35, 0.3, renewed(x * segF + 2.7, y * segF + 5.7, z * segF + 8.7, 2));
                    texture = (0.2 + 0.8 * seg) * (0.55 + 0.45 * renewed(x * crestF + 3.9, y * crestF + 7.3, z * crestF + 1.2, 2) * 1.8);
                }
                if (stripeAmp > 0.005 && carry) {
                    if (!carried) {                     // (the point on the raster of the plate under it, unwarped)
                        carried = true;
                        carryO = A.owner[cn];
                        if (carryO >= 0 && A.moved[carryO]) {
                            const m = A.mats, b = 9 * carryO;
                            locate(simMesh, m[b] * px + m[b + 3] * py + m[b + 6] * pz, m[b + 1] * px + m[b + 4] * py + m[b + 7] * pz, m[b + 2] * px + m[b + 5] * py + m[b + 8] * pz, cr3, cw3);
                        } else { carryO = -1; locate(simMesh, px, py, pz, cr3, cw3); }
                    }
                    const key = 4096 * li + carryO + 1;
                    let C = carry.get(key);
                    if (!C) carry.set(key, C = carriedField(Ks[li], simMesh, A, carryO, cfg.stripeFineShare, cfg.stripeFineRatio));
                    stripes += stripeAmp * texture * carriedStripeAt(C, cr3, cw3, wx, wy, wz);
                } else if (stripeAmp > 0.005) stripes += stripeAmp * texture * stripeAt(Ks[li], cn, px, py, pz, wx, wy, wz, cfg.stripeFineShare, cfg.stripeFineRatio);
                // the ridge noise, read at the distance across the belt as the kernels carry it (smooth, bending with the front)
                if (noiseAmp > 0.002) {
                    crossAt(Ks[li], cn, wx, wy, wz, cross);
                    if (cross[1] > 0) {
                        let v = ridgeNoise(noise, cfg, fade, x, y, z, cross[0], acrossKm, 7 + 5 * li + offA);
                        if (fadeB > 0) v = fadeA * v + fadeB * ridgeNoise(noise, cfg, fade, x, y, z, cross[0], acrossKm, 7 + 5 * li + offB);
                        stripes += noiseAmp * v;
                    }
                }
            }
            }
            // (a range pressed against a craton fades across its rim, along the line — not the cells' staircase)
            if (rimFade < 1) { relief *= rimFade; stripes *= rimFade; }
            // the evolved uplift (over the land corners, interfingering like the platform) — on top of the shelf and plain, so
            // a range or escarpment near the coast still rises from the sea
            const uplift = (lw > 0 ? (n0 * upliftKm[c0] + n1 * upliftKm[c1] + n2 * upliftKm[c2]) / lw : 0) * rimFade;
            const along = relief !== 0 || uplift !== 0 ? atEdge * (1 + cfg.alongStrikeVar * noise.fbm(x * strikeF + 8.8, y * strikeF + 2.2, z * strikeF + 6.6, 3, 0.5) * 1.5) : 0;
            const crests = relief * along, lifted = h + uplift * along + stripes;     // (the ground without the crests)
            relief = uplift * along + crests;
            h = lifted + crests;
            // a valley between crests (a fore-arc valley, a strike valley) floors near sea level on a continent: it does not
            // hole the land with little seas (a basin of the evolved uplift itself may still sink below it). Not on an arc:
            // an ocean arc IS drowned between its islands
            if (crests < 0 && coast >= shelf && h < 0.02 && lifted > 0.02 && w0 * arcCrust[c0] + w1 * arcCrust[c1] + w2 * arcCrust[c2] < 0.5) h = 0.02;
            // a failed rift arm: a sagged corridor, low but still land (unless it reaches the sea as an embayment)
            const arm = w0 * armKm[c0] + w1 * armKm[c1] + w2 * armKm[c2];
            if (arm < 3 * cfg.failedArmHalfKm) h = Math.max(Math.min(h, 0.03), h - cfg.failedArmKm * Math.exp(-((arm / cfg.failedArmHalfKm) ** 2)));
        } else {
            // ── sea side: the slope from the shelf break down to the floor the ocean corners give ──
            const ow = (land[c0] ? 0 : w0) + (land[c1] ? 0 : w1) + (land[c2] ? 0 : w2);
            const oc = (c, w) => (land[c] ? 0 : w);
            const floor = ow > 0 ? (oc(c0, w0) * depthKm[c0] + oc(c1, w1) * depthKm[c1] + oc(c2, w2) * depthKm[c2]) / ow : 3;
            const slope = w0 * slopeKm[c0] + w1 * slopeKm[c1] + w2 * slopeKm[c2];
            h = cfg.shelfEdgeKm + (-floor - cfg.shelfEdgeKm) * smooth(0, slope, -coast);
            // abyssal hills along the isochrons, faded where the mesh cannot show them
            if (ow > 0) {
                const age = (oc(c0, w0) * ageMyr[c0] + oc(c1, w1) * ageMyr[c1] + oc(c2, w2) * ageMyr[c2]) / ow;
                const lam = (oc(c0, w0) * fabricKm[c0] + oc(c1, w1) * fabricKm[c1] + oc(c2, w2) * fabricKm[c2]) / ow, f = fade(lam);
                if (f > 0) h += f * smooth(0, 150, -coast) * (cfg.fabricOldKm + (cfg.fabricKm - cfg.fabricOldKm) * Math.exp(-age / cfg.fabricTauMyr))
                    * Math.sin(2 * Math.PI * age / cfg.fabricPeriodMyr + 2 * noise.noise3D(x * 20, y * 20, z * 20));
            }
            // the trench, and the outer rise on the plate going down
            const tk = w0 * trenchKm[c0] + w1 * trenchKm[c1] + w2 * trenchKm[c2];
            if (tk < 450) h -= (w0 * trenchDepthKm[c0] + w1 * trenchDepthKm[c1] + w2 * trenchDepthKm[c2]) * Math.exp(-((tk / cfg.trenchHalfKm) ** 2)) * smooth(0, 40, -coast);
            const rk = w0 * riseKm[c0] + w1 * riseKm[c1] + w2 * riseKm[c2];
            if (rk < 450) h += cfg.riseKm * Math.exp(-(((rk - cfg.riseAtKm) / 70) ** 2));
            platform = h;
        }
        const cone = coneAt(V, cn, px, py, pz, h);
        heightKm[t] = h + cone;
        if (carve) {
            // the carving's inputs here: rock uplift (active belts rise, by their relief, fading once quiet), how easily
            // it erodes (shields and ridge crests are hard), the rain its drainage brings, the hillslope gradient, and the
            // crust's own micro-relief (read in the plate's frame: it rides with the crust) that steers small rivers
            const i = t - from;
            let quiet = 0, shield = 0;
            for (let j = 0; j < 3; j++) { const c = j === 0 ? c0 : j === 1 ? c1 : c2, w = j === 0 ? w0 : j === 1 ? w1 : w2; quiet += w * (beltKind[c] ? quietMyr[c] : 1e4); shield += w * craton[c]; }
            if (coast >= 0) shield = shieldS;              // (the shield's share by its edge line: terrain/cratons.js)
            const belt = coast >= 0 ? Math.max(0, relief) : 0;
            const active = Math.exp(-quiet / cfg.carveActiveMyr);
            carve.u[i] = cfg.carveBgUplift + cfg.carveUpliftPerKm * belt * active;
            carve.hold[i] = coast >= 0 ? active : 0;          // (how active the belt here is: its rivers cut less)
            carve.k[i] = cfg.carveK * (1 - cfg.carveCratonHardness * shield) * (1 - cfg.carveCrestHardness * Math.min(1, Math.max(0, stripes / 0.3)));
            carve.rain[i] = rainAtLatitude(Math.asin(Math.max(-1, Math.min(1, pz))) * 180 / Math.PI, cfg) / cfg.rainRefMm;
            carve.slope[i] = cfg.carveHillSlope * (1 + cfg.carveHillRelief * belt) * (1 + cfg.carveHillNoise * noise.fbm(x * slopeF + 4.4, y * slopeF + 8.2, z * slopeF + 1.6, 2, 0.5) * 1.6);
            // flood basalt: a hard cap — cliffed canyon walls, slower rivers; and the stair it is cut into (carve.js)
            const basalt = coast >= 0 ? smooth(0, 0.05, lipTop * ramp) : 0;
            carve.lip[i] = basalt; carve.lipTop[i] = lipTop * ramp; carve.lipBase[i] = heightKm[t] - lipKeep * ramp;
            if (basalt > 0) { carve.slope[i] *= 1 + cfg.lipCliff * basalt; carve.k[i] *= 1 - cfg.lipHardness * basalt; }
            carve.micro[i] = cfg.carveMicroKm * noise.fbm(x * microF + 7.3, y * microF + 2.9, z * microF + 5.1, 3, 0.5) * 1.6;
            // how deep the history's rivers cut here (8b-2), over the land corners
            const l0 = land[c0] ? w0 : 0, l1 = land[c1] ? w1 : 0, l2 = land[c2] ? w2 : 0, lw2 = l0 + l1 + l2;
            carve.inc[i] = coast >= 0 && lw2 > 0 ? (l0 * riverIncKm[c0] + l1 * riverIncKm[c1] + l2 * riverIncKm[c2]) / lw2 : 0;
        }
        if (parts) { parts.platform[t] = coast >= 0 ? platform : h; parts.relief[t] = relief; parts.stripes[t] = stripes; parts.cones[t] = cone; parts.lip[t] = lipKeep * ramp; }
    }
}

/**
 * Simplex noise drawn out along a belt's strike (developer, 8b round 5): read at the distance across the belt, s (km,
 * stripes.js crossAt — fast), and at the point in the crust's frame (slow), so a feature is ridgeNoiseStretch times longer
 * along the belt than across it and bends with the front. Its features are `across` km across (ridgeNoiseAcross × the
 * belt kind's ridge wavelength), then halves and quarters of that, each faded where the mesh cannot show it; about −1…+1.
 * Both coordinates belong to the crust: the noise rides with the range. `salt` gives each belt layer a noise of its own.
 */
function ridgeNoise(noise, cfg, fade, x, y, z, d, across, salt) {
    const alongF = R / (across * cfg.ridgeNoiseStretch);
    let v = 0, amp = 1, norm = 0;
    for (let o = 0, f = 1; o < cfg.ridgeNoiseOctaves; o++, f *= 2) {
        norm += amp;
        const show = fade(1.5 * across / f);                 // (a simplex feature's wavelength ≈ 1.5 of its units)
        if (show > 0) {
            const u = d / across * f, a = alongF * f;
            // (d moves the point fast along a fixed direction in noise space, the position slowly in every direction)
            v += amp * show * noise.noise3D(x * a + 0.6 * u + salt + 3.1 * o, y * a + 0.64 * u + 1.7 * salt, z * a + 0.48 * u + 0.3 * salt);
        }
        amp *= 0.5;
    }
    return 1.4 * v / norm;
}

/** Share of the planet above `seaLevelKm`, and land heights at the given quantiles (km). */
export function hypsometry(heightKm, seaLevelKm = 0, quantiles = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
    let n = 0, below400 = 0;
    for (let i = 0; i < heightKm.length; i++) if (heightKm[i] > seaLevelKm) n++;
    const landH = new Float64Array(n);
    for (let i = 0, j = 0; i < heightKm.length; i++) if (heightKm[i] > seaLevelKm) { const v = heightKm[i] - seaLevelKm; landH[j++] = v; if (v < 0.4) below400++; }
    // each quantile is one order statistic of the land heights: selected in place, lowest rank first (each selection
    // leaves everything below its rank to its left), rather than sorting all the land — the same values, in linear time
    const rank = p => Math.min(n - 1, Math.floor(p * n)), byRank = quantiles.map((p, i) => i).sort((a, b) => rank(quantiles[a]) - rank(quantiles[b]));
    const q = new Array(quantiles.length).fill(0);
    for (let s = 0, lo = 0; n && s < byRank.length; s++) { const k = rank(quantiles[byRank[s]]); selectKth(landH, lo, n - 1, k); q[byRank[s]] = landH[k]; lo = k; }
    return { landShare: n / heightKm.length, quantiles, landKm: q, below400: n ? below400 / n : 0 };
}

/** Reorder a[lo..hi] so that a[k] holds the value it would hold sorted, none greater before it, none smaller after (Wirth's selection, median-of-three pivot). */
function selectKth(a, lo, hi, k) {
    while (lo < hi) {
        const l = a[lo], m = a[(lo + hi) >> 1], h = a[hi];
        const x = l < m ? (m < h ? m : l < h ? h : l) : (l < h ? l : m < h ? h : m);
        let i = lo, j = hi;
        do {
            while (a[i] < x) i++;
            while (x < a[j]) j--;
            if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
        } while (i <= j);
        if (j < k) lo = i;
        if (k < i) hi = j;
    }
}
