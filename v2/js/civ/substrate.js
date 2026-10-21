// The civ layer's substrate (plans/CIV_PLAN.md §4): what a finished moment offers people, per cell, before anyone lives
// there — computed once per world. Read from the finish's own fields (finish.js finishPlanet): heights, sea and lakes,
// the climate (Köppen, annual temperature and rain, the four cell-stats measures), the rivers with their regimes, and
// the wind's loess. Everything by km and physical units (civ-config.js), so the same at every detail.
//
//   npp         net primary productivity, g dry matter /m²/yr (the Miami model)
//   et          Binford's effective temperature, °C (from the warmest and coldest months)
//   forager     the density foragers reach, persons/km² (with wild cereal stands' harvests)
//   forageGlacial  the same in the glacial climate (colder, drier: civ-config glacialDT, glacialPScale; no cereal stands)
//   wetland     deltas (1) and big rivers' marshes (a share of the cell): the richest foraging, the first villages
//   wild        per crop package (PACKAGES), how well its wild ancestors grow here, 0–1
//   rainfed     rain-fed cereal yield, kg/ha
//   irrig       irrigation's worth here, 0–1: reachable from a big river across gentle alluvium, and needed
//   irrigShare  the share of the cell that can be irrigated (its river's floodplain, or all of it on a broad plain)
//   farmers     the density farming can feed, persons/km² of farmland (rain-fed on the cell, irrigated on its irrigable share)
//   farmDry, farmWet   the same, rain-fed alone and irrigated alone
//   river       per cell on a river: its discharge (m³/s), regime and whether it is far-fed

import { CIV } from './civ-config.js';
import { spreadKm } from '../core/min-heap.js';
import { statValue } from '../climate/cell-stats.js';
import { KOPPEN_CLASSES } from '../climate/koppen.js';
import { Regime } from '../finish/finish-hydro.js';

const R = 6371;
const K = Object.fromEntries(KOPPEN_CLASSES.map((k, i) => [k.code, i]));
const rise = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** 1 inside [w1, w2], easing to 0 over [w0, w1] and [w2, w3]. */
const window4 = (w, x) => rise(w[0], w[1], x) * (1 - rise(w[2], w[3], x));

/**
 * The crop packages, each with its climate envelope: how suitable each Köppen class is for its wild ancestors (Blumler's
 * Mediterranean grasses; the monsoon's millets and rice; the tropics' roots and tubers). The envelope is what keeps a
 * package inside its own kind of country, so spreading along a latitude is easier than across it (Diamond's axes) by itself.
 */
// `abundance`: how thick the wild stands grow at their best. Large-seeded annual grasses are at home under winter rain and a
// long summer drought (Blumler 1992: of the 56 largest-seeded grasses, 32 are Mediterranean); summer-rain savannas are
// held by perennials, their wild cereals thinner — one reason the Levant came first and the tropics' cereals late.
export const PACKAGES = [
    { id: 'winterCereal', name: 'winter-rain cereals (wheat, barley, lentils)', rainMm: CIV.cerealRainMm, tempC: CIV.cerealTempC, cereal: true, abundance: 1,
        koppen: { Csa: 1, Csb: 0.85, Dsa: 0.6, Dsb: 0.5, BSk: 0.45, BSh: 0.3, Cfa: 0.25, Dfa: 0.25, Cfb: 0.2, Dfb: 0.15 } },
    { id: 'summerCereal', name: 'summer-rain cereals (millets, rice)', rainMm: [350, 500, 1800, 2800], tempC: [8, 13, 26, 29], cereal: true, abundance: 0.8,
        koppen: { Cwa: 1, Dwa: 0.8, Cwb: 0.6, Dwb: 0.55, Aw: 0.3, Cfa: 0.4, BSh: 0.35, BSk: 0.2 } },
    { id: 'tuber', name: 'roots and tubers (taro, yams, potatoes)', rainMm: [900, 1400, 6000, 9000], tempC: [8, 14, 28, 31], abundance: 0.75,
        koppen: { Af: 0.7, Am: 0.8, Cwb: 0.9, Cfb: 0.4, Aw: 0.4 }, highlandBonus: true },
];

/**
 * @param {object} w the finished moment, read: { mesh, z (km), ocean, lake, koppen, tAnnual, pAnnual, stats (cell-stats),
 *   rivers (finish-hydro's points, with regime and farFed), loess (km, optional) }
 */
export function civSubstrate(w, C = CIV) {
    const { mesh, z, ocean, lake, koppen, tAnnual, pAnnual, stats } = w, n = mesh.numCells, xyz = mesh.xyz;
    const cellKm2 = 4 * Math.PI * R * R / n, edgeKm = Math.sqrt(cellKm2 * 2 / Math.sqrt(3));
    const land = c => !ocean[c] && !lake[c];
    const stat = (k, c) => statValue(stats[k], k, c);

    // ── the rivers, onto cells: each cell the biggest river point in it ──
    const riverQ = new Float32Array(n), riverRegime = new Uint8Array(n).fill(255), riverFar = new Uint8Array(n);
    if (w.rivers) {
        const Rv = w.rivers, index = mesh.index, D = Math.PI / 180;
        for (let p = 0; p < Rv.q.length; p++) {
            const la = Rv.lat[p] * D, lo = Rv.lon[p] * D, c = index.nearest(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
            if (Rv.q[p] <= riverQ[c]) continue;
            riverQ[c] = Rv.q[p];
            riverRegime[c] = Rv.regime ? Rv.regime[p] : 255;
            riverFar[c] = Rv.farFed ? Rv.farFed[p] : 0;
        }
    }

    // ── relief within reliefRadiusKm: the range of heights over a few rings (dilations, by km) ──
    const hops = Math.max(1, Math.round(C.reliefRadiusKm / edgeKm));
    let hi = Float32Array.from(z), lo = Float32Array.from(z);
    for (let h = 0; h < hops; h++) {
        const h2 = Float32Array.from(hi), l2 = Float32Array.from(lo);
        for (let c = 0; c < n; c++) for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) {
            const nb = mesh.adjList[k]; if (hi[nb] > h2[c]) h2[c] = hi[nb]; if (lo[nb] < l2[c]) l2[c] = lo[nb];
        }
        hi = h2; lo = l2;
    }
    const relief = new Float32Array(n);
    for (let c = 0; c < n; c++) relief[c] = Math.max(0, hi[c]) - Math.max(0, lo[c]);

    // ── irrigation: across gentle ground from a big river, at most irrigHeadM above it ──
    const reach = new Float64Array(n).fill(Infinity), src = new Int32Array(n).fill(-1);
    for (let c = 0; c < n; c++) if (riverQ[c] >= C.irrigRiverM3s && land(c)) { reach[c] = 0; src[c] = c; }
    const maxDz = C.irrigSlope * edgeKm;                   // km of height per step, at most
    spreadKm(mesh, reach, {
        maxKm: C.irrigReachKm,
        canEnter: (a, b) => land(b) && z[b] <= C.plainMaxKm && (z[b] - z[src[a]]) * 1000 <= C.irrigHeadM && Math.abs(z[b] - z[a]) <= maxDz,
        onReach: (a, b) => { src[b] = src[a]; },
    });

    // ── wetlands: deltas at big rivers' mouths (over low ground, inland by √discharge), and big rivers' marshes where their
    // valleys are flat ──
    const wetland = new Float32Array(n), dDelta = new Float64Array(n).fill(Infinity), mouthQ = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        if (!land(c) || riverQ[c] < C.deltaMinM3s) continue;
        for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) if (ocean[mesh.adjList[k]]) { dDelta[c] = 0; mouthQ[c] = riverQ[c]; break; }
    }
    spreadKm(mesh, dDelta, {
        maxKm: C.deltaKmPerRootM3s * Math.sqrt(30000),
        canEnter: (a, b) => land(b) && z[b] <= C.deltaMaxKm && dDelta[a] + edgeKm <= C.deltaKmPerRootM3s * Math.sqrt(mouthQ[a]),
        onReach: (a, b) => { mouthQ[b] = mouthQ[a]; },
    });
    for (let c = 0; c < n; c++) {
        if (dDelta[c] < Infinity) wetland[c] = 1;
        else if (land(c) && riverQ[c] >= C.marshMinM3s && relief[c] < C.marshReliefKm) wetland[c] = C.marshShare;
    }

    const npp = new Float32Array(n), et = new Float32Array(n), forager = new Float32Array(n), forageGlacial = new Float32Array(n), rainfed = new Float32Array(n);
    const irrig = new Float32Array(n), irrigShare = new Float32Array(n), farmers = new Float32Array(n), farmDry = new Float32Array(n), farmWet = new Float32Array(n), coastal = new Uint8Array(n), lakeside = new Uint8Array(n);
    const wild = Object.fromEntries(PACKAGES.map(p => [p.id, new Float32Array(n)]));
    const perKm2 = (yieldKg, seedRatio) => yieldKg * 100 * (1 - C.fallow) * (1 - 1 / seedRatio) / C.grainPerPersonKg;
    for (let c = 0; c < n; c++) {
        if (!land(c)) continue;
        for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) { const nb = mesh.adjList[k]; if (ocean[nb]) coastal[c] = 1; else if (lake[nb]) lakeside[c] = 1; }
        const T = tAnnual[c], P = pAnnual[c], kop = koppen[c], code = KOPPEN_CLASSES[kop]?.code ?? '';
        if (!(T === T) || !(P === P)) continue;
        // the Miami model (Lieth 1975)
        npp[c] = Math.min(C.nppMax / (1 + Math.exp(1.315 - 0.119 * T)), C.nppMax * (1 - Math.exp(-0.000664 * P)));
        if (code === 'EF') npp[c] = 0;
        const range = stat('tRange', c) || 0, Wm = T + range / 2, Cm = T - range / 2;
        et[c] = Wm - Cm + 8 > 0 ? (18 * Wm - 10 * Cm) / (Wm - Cm + 8) : 8;

        // foragers: the NPP regression, less under closed rainforest, more by water (and in the glacial climate, again)
        const nppAt = (t, p) => (code === 'EF' ? 0 : Math.min(C.nppMax / (1 + Math.exp(1.315 - 0.119 * t)), C.nppMax * (1 - Math.exp(-0.000664 * p))));
        let d = Math.pow(10, C.foragerSlope * 0.45 * npp[c] + C.foragerIcept), dG = Math.pow(10, C.foragerSlope * 0.45 * nppAt(T + C.glacialDT, P * C.glacialPScale) + C.foragerIcept);
        if (code === 'Af') { d *= C.foragerRainforest; dG *= C.foragerRainforest; }
        // (the water's bonuses on a strip aquaticStripKm wide, the rest of the cell without: the same at every detail)
        let aqua = 1;
        if (coastal[c]) aqua *= C.aquaticCoast;
        if (lakeside[c]) aqua *= C.aquaticLake;
        if (riverQ[c] >= C.aquaticRiverM3s) aqua *= 1 + (C.aquaticRiverMax - 1) * rise(0, 3, Math.log10(riverQ[c] / C.aquaticRiverM3s));
        aqua = 1 + (Math.min(C.aquaticMax, aqua) - 1) * Math.min(1, C.aquaticStripKm / edgeKm);
        if (wetland[c]) aqua *= 1 + (C.wetlandAquatic - 1) * wetland[c];
        forageGlacial[c] = Math.min(C.foragerMax, dG * Math.min(C.aquaticMax, aqua));
        forager[c] = Math.min(C.foragerMax, d * Math.min(C.aquaticMax, aqua));

        // the wild ancestors of each package
        const hilly = 0.6 + 0.4 * rise(C.reliefKm[0], C.reliefKm[1], relief[c]);
        for (const p of PACKAGES) {
            const base = p.abundance * (p.koppen[code] ?? 0);
            if (!base) continue;
            let s = base * window4(p.rainMm, P) * window4(p.tempC, T) * hilly;
            if (p.cereal) s *= rise(C.cerealSeasonality[0], C.cerealSeasonality[1], stat('rainSeason', c) || 0);
            if (p.highlandBonus && (code === 'Af' || code === 'Am')) s *= 0.5 + 0.5 * rise(0.6, 1.6, z[c]);   // New Guinea's, the Andes' highlands
            wild[p.id][c] = s;
        }

        forager[c] = Math.min(C.foragerMax, forager[c] * (1 + C.wildCerealForage * Math.max(wild.winterCereal[c], wild.summerCereal[c])));

        // rain-fed cereals
        const grow = stat('growing', c) || 0;
        let y = C.rainfedYield * rise(C.rainfedMinMm, C.rainfedFullMm, P) * rise(C.rainfedGrowMonths[0], C.rainfedGrowMonths[1], grow);
        if (code === 'Af' || code === 'Am') y *= C.tropicalLeach;
        if (w.loess && w.loess[c] > 0) y *= 1 + C.loessBonus * Math.min(1, w.loess[c] / 0.01);
        if (code === 'ET' || code === 'EF') y = 0;
        rainfed[c] = y;

        // irrigation: reachable — the whole cell on a broad plain, its river's floodplain share of it otherwise — and needed
        // (dry, warm), better on a flood-season or far-fed river
        if (reach[c] > 0 && reach[c] < Infinity) irrigShare[c] = 1;
        else if (reach[c] === 0) irrigShare[c] = Math.min(1, Math.min(C.floodplainMaxKm, C.floodplainCoef * Math.sqrt(riverQ[c])) * edgeKm / cellKm2);
        if (irrigShare[c] > 0 && grow >= C.irrigGrowMonths[0]) {
            const arid = stat('aridity', c), need = 1 - rise(C.irrigNeedAridity[0], C.irrigNeedAridity[1], arid === arid ? arid : 1);
            const s = src[c], bonus = 1 + (riverRegime[s] === Regime.FLOOD ? C.floodBonus : 0) + (riverFar[s] ? C.farFedBonus : 0);
            irrig[c] = Math.min(1, need * rise(C.irrigGrowMonths[0], C.irrigGrowMonths[1], grow) * bonus / (1 + C.floodBonus + C.farFedBonus) * (1 - 0.5 * reach[c] / C.irrigReachKm));
            if (irrig[c] < 0.02) irrig[c] = 0;
        }
        const dry = perKm2(rainfed[c], C.seedRatioRainfed), wet = irrig[c] > 0 ? Math.max(dry, perKm2(C.irrigatedYield, C.seedRatioIrrigated) * Math.min(1, 2 * irrig[c])) : dry;
        farmers[c] = irrigShare[c] * wet + (1 - irrigShare[c]) * dry;
        farmDry[c] = dry; farmWet[c] = wet;
    }
    return { n, cellKm2, edgeKm, npp, et, forager, forageGlacial, wetland, wild, rainfed, irrig, irrigShare, farmDry, farmWet, irrigSrc: src, irrigKm: reach, farmers, relief, coastal, lakeside,
        river: { q: riverQ, regime: riverRegime, farFed: riverFar } };
}

