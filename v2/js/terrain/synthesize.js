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
import { beltProfile, crestProfile, stripeZone } from './profiles.js';
import { buildStripeKernels, stripeAt } from './stripes.js';
import { buildVolcanoes, coneAt } from './volcanoes.js';
import { sampleOnto } from './terrain-mesh.js';
import { buildAnchor, plateFramePoint, plateToWorld } from './anchor.js';
import { FastNoise as SimplexNoise } from '../core/fast-noise.js';     // (bit-identical to V1's SimplexNoise, faster)

const R = 6371;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @param {import('../tectonics/snapshot.js').Frame} frame
 * @param {Object} simMesh      the mesh the frame lives on
 * @param {Object} tMesh        the terrain mesh (terrain-mesh.js)
 * @param {{cfg?: Object, seed?: number, sampler?: Object, parts?: boolean}} [opts]
 *        sampler: reuse sampleOnto()'s result for this (sim, terrain, seed); parts: also return the components
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
    const parts = opts.parts ? { platform: new Float32Array(n), relief: new Float32Array(n), stripes: new Float32Array(n), cones: new Float32Array(n) } : null;
    surfaceRange(plan, cfg, seed, tMesh.edgeKm, tMesh.xyz, S.cells, S.weights, 0, n, heightKm, parts);
    ms.surface = clock() - t0;
    return { heightKm, parts, rec: plan.rec, sampler: S, ms, kernels: plan.Ks[0].count + plan.Ks[1].count, volcanoes: plan.V.count };
}

/**
 * Everything per frame that the surface pass reads — the records, each belt layer's ridge kernels (with their
 * resolution fade for a terrain mesh of `edgeKm` spacing) and the volcanoes. Small (sim-mesh sized): a worker builds its
 * own from the frame.
 */
export function preparePlan(frame, simMesh, cfg, seed, edgeKm) {
    const rec = deriveRecords(frame, simMesh, cfg, seed), A = buildAnchor(frame, simMesh);
    const Ks = rec.belts.map((layer, i) => buildStripeKernels(layer, simMesh, cfg, seed + 7919 * i, A));
    // each kernel's resolution fade (main and fine set) depends only on its wavelength and this mesh: computed once
    for (const K of Ks) {
        K.fade1 = Float64Array.from(K.wave, lam => smooth(cfg.minWavesPerCell, cfg.fullWavesPerCell, lam / edgeKm));
        K.fade2 = Float64Array.from(K.wave, lam => (cfg.stripeFineShare > 0 ? smooth(cfg.minWavesPerCell, cfg.fullWavesPerCell, lam / cfg.stripeFineRatio / edgeKm) : 0));
    }
    return { rec, Ks, A, V: buildVolcanoes(frame, rec, simMesh, cfg, seed, A, edgeKm) };
}

/**
 * The tectonic surface for terrain cells from…to−1: positions from `xyz`, sim-mesh corners and weights from sCells /
 * sWeights (sampleOnto), heights into heightKm (and the components into `parts`, if given) — all indexed alike. Every
 * cell depends only on its own position and the plan, so any split of the cells gives the same heights.
 */
export function surfaceRange(plan, cfg, seed, edgeKm, xyz, sCells, sWeights, from, to, heightKm, parts = null) {
    const { rec, Ks, V, A } = plan, { cell } = A, p = [0, 0, 0], d = [0, 0, 0];
    const noise = new SimplexNoise(seed * 31 + 9);
    const fade = lam => smooth(cfg.minWavesPerCell, cfg.fullWavesPerCell, lam / edgeKm);
    const coastF = R / 700, platF = R / 2000, strikeF = R / 900, segF = R / cfg.stripeSegmentKm, meanderF = R / cfg.stripeMeanderAlongKm, meander = cfg.stripeMeanderKm / R;
    const blendF = R / cfg.blendNoiseKm, crestF = R / 150;
    // a corner's share, scaled by a noise field of its own (decorrelated per crust cell, continuous across triangles)
    const noisy = (c, w) => { const r = cell[c]; return w * Math.exp(cfg.blendNoise * noise.fbm(x0 * blendF + (r % 101) * 1.37, y0 * blendF + (r % 89) * 2.11, z0 * blendF + (r % 83) * 0.73, 3, 0.5) * 1.6); };
    let x0 = 0, y0 = 0, z0 = 0;
    const { coastKm, land, arc: arcCrust, platformKm, upliftKm, depthKm, shelfKm, plainKm, slopeKm, ageMyr, fabricKm, trenchKm, riseKm, trenchDepthKm, armKm } = rec;
    const kinds = [0, 0, 0], wts = [0, 0, 0], nts = [0, 0, 0];

    for (let t = from; t < to; t++) {
        const c0 = sCells[3 * t], c1 = sCells[3 * t + 1], c2 = sCells[3 * t + 2];
        const w0 = sWeights[3 * t], w1 = sWeights[3 * t + 1], w2 = sWeights[3 * t + 2];
        const px = xyz[3 * t], py = xyz[3 * t + 1], pz = xyz[3 * t + 2];
        // (x, y, z): where the point lies in the frame of the crust under it — every noise below is read there
        plateFramePoint(A, c0, c1, c2, w0, w1, w2, px, py, pz, p);
        const x = p[0], y = p[1], z = p[2];
        x0 = x; y0 = y; z0 = z;
        let coast = w0 * coastKm[c0] + w1 * coastKm[c1] + w2 * coastKm[c2];
        if (Math.abs(coast) < 600) coast += cfg.coastNoiseKm * noise.fbm(x * coastF + 3.3, y * coastF + 1.1, z * coastF + 7.9, 4, 0.5) * 1.5;
        let h, platform = 0, relief = 0, stripes = 0;

        if (coast >= 0) {
            // ── land side: the platform over the land corners (interfingering), dropping to the shelf toward the coast ──
            const e0 = noisy(c0, w0), e1 = noisy(c1, w1), e2 = noisy(c2, w2);          // (each corner's noisy share, computed once)
            const n0 = land[c0] ? e0 : 0, n1 = land[c1] ? e1 : 0, n2 = land[c2] ? e2 : 0, lw = n0 + n1 + n2;
            platform = lw > 0 ? (n0 * platformKm[c0] + n1 * platformKm[c1] + n2 * platformKm[c2]) / lw : cfg.continentKm;
            platform += cfg.platformNoiseKm * noise.fbm(x * platF + 5.1, y * platF + 9.2, z * platF + 2.4, 4, 0.5) * 1.5;
            const shelf = w0 * shelfKm[c0] + w1 * shelfKm[c1] + w2 * shelfKm[c2], plain = w0 * plainKm[c0] + w1 * plainKm[c1] + w2 * plainKm[c2];
            h = coast < shelf ? cfg.shelfEdgeKm * (1 - coast / shelf) : platform * smooth(0, 1, (coast - shelf) / Math.max(1, plain));

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
            let layerRelief = 0, stripeAmp = 0;
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
                stripeAmp += m * stripeZone(type, side, d, W, jitter) * (cfg.stripeShare * Math.max(0, A * beltProfile(type, side, d, W, jitter)) + cfg.stripeBaseKm * A / cfg.reliefKm[type]);
            }
            relief += share * layerRelief;
            stripeAmp *= share * atEdge;
            if (stripeAmp > 0.005) {
                if (!warped) {                          // (the meander warp and the ridges' texture: shared by both layers)
                    warped = true;
                    // (a displacement in the crust's frame, turned into the world: the kernels live in the world)
                    d[0] = meander * noise.fbm(x * meanderF + 1.5, y * meanderF + 4.5, z * meanderF + 9.5, 2, 0.5);
                    d[1] = meander * noise.fbm(x * meanderF + 7.5, y * meanderF + 0.5, z * meanderF + 3.5, 2, 0.5);
                    d[2] = meander * noise.fbm(x * meanderF + 4.1, y * meanderF + 6.1, z * meanderF + 0.9, 2, 0.5);
                    plateToWorld(A, A.owner[c0], d);
                    wx = px + d[0]; wy = py + d[1]; wz = pz + d[2];
                    // segments that fade in and out along the strike, crests that rise and fall along their length
                    const seg = smooth(-0.35, 0.3, noise.fbm(x * segF + 2.7, y * segF + 5.7, z * segF + 8.7, 2, 0.5));
                    texture = (0.2 + 0.8 * seg) * (0.55 + 0.45 * noise.fbm(x * crestF + 3.9, y * crestF + 7.3, z * crestF + 1.2, 2, 0.5) * 1.8);
                }
                stripes += stripeAmp * texture * stripeAt(Ks[li], c0, px, py, pz, wx, wy, wz, cfg.stripeFineShare, cfg.stripeFineRatio);
            }
            }
            // the evolved uplift (over the land corners, interfingering like the platform) — on top of the shelf and plain, so
            // a range or escarpment near the coast still rises from the sea
            const uplift = lw > 0 ? (n0 * upliftKm[c0] + n1 * upliftKm[c1] + n2 * upliftKm[c2]) / lw : 0;
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
        const cone = coneAt(V, c0, px, py, pz, h);
        heightKm[t] = h + cone;
        if (parts) { parts.platform[t] = coast >= 0 ? platform : h; parts.relief[t] = relief; parts.stripes[t] = stripes; parts.cones[t] = cone; }
    }
}

/** Share of the planet above `seaLevelKm`, and land heights at the given quantiles (km). */
export function hypsometry(heightKm, seaLevelKm = 0, quantiles = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
    const landH = [];
    for (let i = 0; i < heightKm.length; i++) if (heightKm[i] > seaLevelKm) landH.push(heightKm[i] - seaLevelKm);
    landH.sort((a, b) => a - b);
    const q = quantiles.map(p => landH.length ? landH[Math.min(landH.length - 1, Math.floor(p * landH.length))] : 0);
    let below400 = 0;
    for (const v of landH) if (v < 0.4) below400++;
    return { landShare: landH.length / heightKm.length, quantiles, landKm: q, below400: landH.length ? below400 / landH.length : 0 };
}
