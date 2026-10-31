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
//   rainfed     rain-fed yield, kg/ha of grain-equivalent: the best rotation's harvests a year (crops.js) on the soil
//   irrig       irrigation's worth here, 0–1: reachable from a big river across gentle alluvium, and needed
//   irrigShare  the share of the cell that can be irrigated (its river's floodplain, or all of it on a broad plain)
//   farmers     the density farming can feed, persons/km² of farmland (rain-fed on the cell, irrigated on its irrigable share)
//   farmDry, farmWet   the same, rain-fed alone and irrigated alone
//   river       per cell on a river: its discharge (m³/s), regime and whether it is far-fed
//   food        per resource (FOODS; plans/CIV_PLAN.md §9.2), the people it feeds at full skill, persons/km²: the wild
//               ones of the land's own country (they sum to `forager`), the crops and herds of the land suited to them
//   canalFood   per cereal class (winterCereal, summerCereal), the people it feeds watered by canals, persons/km² of the
//               irrigable share (irrigShare): its warmth alone, at the irrigated yield, by how much irrigation is worth here
//   open        how open the country is, 0–1 (grassland, steppe, tundra; not closed forest): game and grazing
//   wildHerd    how well wild herd animals (sheep, goats, cattle's ancestors) live here, 0–1: open uplands and steppe
//   fish        the sea's fish within a day's paddle, persons/km² of the coast's land (in forager and food.aquatic)
//   soil        the soil's fertility, 0–1 (food-config.js: middling ground 0.7): soilBed off the river silt, soilSilt on
//               it, soil the cell's mean; soilKind its parent (Parent) | what the climate made of it (SoilMod) << 4
//   harvests, harvestsW   the best rotation's harvests a year by rain and watered (crops.js); rotCls its classes
//               (HARVEST_CLASSES index + 1: by rain in the low four bits, watered in the high)
//   farmV       the best rotation's food in good harvests a year, by rain or watered (the Farmland view's classes)
//
// And per place (the land views; tuning/civ/food-check.mjs): wayOf — the way of life that would feed the most a km² by
// the economy's own land shares — and stapleOf, the food that way lives on most (cellLife for a cell).
//
// Limits (what it skips): the soil's parent rock (middling ground but for silt, loess and sand: the geology survey's, a
// TODO); flooded paddy by warmth alone only on deltas and marshes (a big river's floodplain grows it by rain); fallow by
// the soil, not by people's numbers (Boserup's intensification is not modelled); the sea's fish from the present sea
// in the glacial climate too (no lowered shelf), on Earth from the coast's air; the way of life's herders need the rain's
// CV, which the land views read as the run does and the Earth check from the storms alone.
//
// Crops by harvests a year and the soil, and the sea's fish by its shelf: after upstream's Food tab
// (raguilar011095/planet_heightmap_generation, plans/V2_FARMING_PLAN.md C2, C6b — © Robert Aguilar, GPL v3).

import { CIV } from './civ-config.js';
import { spreadKm } from '../core/min-heap.js';
import { statValue } from '../climate/cell-stats.js';
import { KOPPEN_CLASSES } from '../climate/koppen.js';
import { Regime } from '../finish/finish-hydro.js';
import { cropClimate, cropsAt, HARVEST_CLASSES } from './crops.js';
import { FOOD } from './food-config.js';
import { LatLonGrid } from '../finish/finish-grid.js';
import { locate } from '../core/mesh-locate.js';

const R = 6371;
const K = Object.fromEntries(KOPPEN_CLASSES.map((k, i) => [k.code, i]));
const rise = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** 1 inside [w1, w2], easing to 0 over [w0, w1] and [w2, w3]. */
const window4 = (w, x) => rise(w[0], w[1], x) * (1 - rise(w[2], w[3], x));
const S = (r, x) => rise(r[0], r[1], x);

/** What the soil formed from (the Soil view's words: PARENT_WORDS), in a soil kind's low four bits… */
export const Parent = Object.freeze({ NONE: 0, SILT: 1, LOESS: 2, SAND: 3, ROCK: 4 });
export const PARENT_WORDS = ['', 'river silt', 'loess', 'dune sand', 'mixed ground'];
/** …and what the climate made of it, in the high four bits. */
export const SoilMod = Object.freeze({ NONE: 0, BLACK: 1, LEACHED: 2, PODZOL: 3 });
export const MOD_WORDS = ['', 'black earth', 'leached red earth', 'acid podzol'];

/** A crop's yield on a soil of fertility `soil` (0…1) against middling ground's (food-config soilRef), for a crop asking
 *  `a` of the soil (upstream's farmPlace: its food × (1 − a + a × fertility)). */
export const soilFactor = (a, soil, F = FOOD) => (1 - a + a * soil) / (1 - a + a * F.soilRef);
/** The share of a crop's own round its field is cropped on a soil of fertility `soil` (0…1), where `warm` months a year
 *  are warm enough to grow — poor ground rested longer, longest where no winter slows its exhaustion (1 on middling ground
 *  and better: the crop's own fallow, civ-config cropFood, is for it). */
export const croppedShare = (soil, warm, F = FOOD) => 1 - (1 - F.fallowMin) * (1 - S(F.fallowSoil, soil)) * (F.fallowCool + (1 - F.fallowCool) * S(F.fallowWarm, warm));
/** A crop's food in harvests of one good harvest on middling ground: its harvests a year `h` — past the first, only as
 *  many as the soil can feed (river silt two or three a year, leached ground one) — × soilFactor × croppedShare (`warm`:
 *  the months warm enough to grow; null — a flood's silt, renewed — cropped as its crop allows). */
export function foodHarvests(h, a, soil, warm = null, F = FOOD) {
    if (!(h > 0)) return 0;
    return (Math.min(1, h) + S(F.multiSoil, soil) * Math.max(0, h - 1)) * soilFactor(a, soil, F) * (warm === null ? 1 : croppedShare(soil, warm, F));
}

/** A field on the climate's grid (w × h, rows from 90° N, columns from 180° W) at a place, bilinearly. */
function gridAt(w, h, field, lat, lon) {
    const step = 180 / h, x = (lon + 180) / step - 0.5, y = Math.max(0, Math.min(h - 1, (90 - lat) / step - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i0 = ((x0 % w) + w) % w, i1 = i0 + 1 === w ? 0 : i0 + 1, j1 = y0 + 1 < h ? y0 + 1 : y0;
    return (1 - fx) * (1 - fy) * field[y0 * w + i0] + fx * (1 - fy) * field[y0 * w + i1] + (1 - fx) * fy * field[j1 * w + i0] + fx * fy * field[j1 * w + i1];
}

/**
 * The sea's fish (upstream's living.js gatherGround and gatherAt, on the mesh): each land cell's share of a rich shelf
 * within a day's paddle — the shelf (sea shallower than F.shelfKm) within F.reachKm, × its richness: a warm clear
 * shelf's F.warmShelf, up to 1 as its water is cold or upwelling, less under sea ice — and the people that feeds, by
 * the land's summer (its months warm enough to grow: `warmMo(c)`). Persons/km² of the cell's land.
 * The sea's year (temperature, ice, upwelling) is the climate's (w.sea: civ-page.js seaOf). Earth has none of it here:
 * its sea is read from its coast's air at sea level (the land cells by the sea, their year's mean raised by the lapse
 * rate, spread over ~300 km — Peru's and Namibia's coasts are cold because their water is) and its ice as the share of
 * the year that air stays below freezing seawater (a sine through the year from its mean and range), with no upwelling
 * but what the cold carries.
 */
export function seaFish(w, coastal, warmMo, F = FOOD) {
    const { mesh, z, ocean, tAnnual, stats } = w, n = mesh.numCells, xyz = mesh.xyz, D = 180 / Math.PI, W = w.sea;
    const lat = new Float32Array(n), lon = new Float32Array(n);
    for (let c = 0; c < n; c++) { lat[c] = Math.asin(xyz[3 * c + 2]) * D; lon[c] = Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * D; }
    const g = new LatLonGrid(F.gridDeg);
    let seaT, seaIce, seaUp;
    if (W) {
        seaT = c => gridAt(W.w, W.h, W.T, lat[c], lon[c]);
        seaIce = c => (W.ice ? gridAt(W.w, W.h, W.ice, lat[c], lon[c]) : 0);
        seaUp = c => gridAt(W.w, W.h, W.upwell, lat[c], lon[c]);
    } else {
        const tSL = new Float32Array(n), ice = new Float32Array(n), lapse = 6.5;
        for (let c = 0; c < n; c++) {
            if (!coastal[c] || !(tAnnual[c] === tAnnual[c])) continue;
            tSL[c] = tAnnual[c] + lapse * Math.max(0, z[c]);
            const A = Math.max(0.1, (statValue(stats.tRange, 'tRange', c) || 0) / 2), x = (-1.8 - tSL[c]) / A;
            ice[c] = x >= 1 ? 1 : x <= -1 ? 0 : 1 - Math.acos(x) / Math.PI;
        }
        const near = c => coastal[c] === 1 && tAnnual[c] === tAnnual[c];
        const Tg = g.blur(g.average(lat, lon, tSL, near), 300), Ig = g.blur(g.average(lat, lon, ice, near), 300);
        seaT = c => g.at(Tg, lat[c], lon[c]); seaIce = c => g.at(Ig, lat[c], lon[c]); seaUp = () => 0;
    }
    // (each sea cell's richness; the shelf itself is found below, on the grid, from the depth between cells)
    const rich = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        if (!ocean[c]) continue;
        const T = seaT(c), I = seaIce(c), up = seaUp(c);
        rich[c] = (F.warmShelf + (1 - F.warmShelf) * Math.max(T === T ? S(F.coldSea, T) : 0, up === up ? S(F.upwell, up) : 0)) * (1 - F.seaIceLoss * (I === I ? Math.min(1, Math.max(0, I)) : 0));
    }
    // (each grid cell the mesh cell it lies in, and its depth linear between the cells around it: shelf where that is
    // sea shallower than shelfKm, with the sea cells' richness there — so a narrow shelf by a coast is found at any
    // detail, where a coarse cell's mean depth would hide it. Spread over a day's paddle; each land cell then the mean
    // over its own grid cells: a coarse cell's coast is a strip of it, not its centre. Cells smaller than a grid cell
    // read the field at their centre.)
    const cellOf = new Int32Array(g.size), cosOf = new Float32Array(g.h), field = new Float32Array(g.size), R = Math.PI / 180;
    const tri = new Int32Array(3), wt3 = new Float64Array(3);
    for (let j = 0; j < g.h; j++) {
        const la = (90 - (j + 0.5) * g.step) * R, cl = Math.cos(la), sl = Math.sin(la);
        cosOf[j] = cl;
        for (let i = 0; i < g.w; i++) {
            const lo = (-180 + (i + 0.5) * g.step) * R, k = j * g.w + i;
            locate(mesh, cl * Math.cos(lo), cl * Math.sin(lo), sl, tri, wt3);
            cellOf[k] = tri[0];
            let d = 0, r = 0, rw = 0;
            for (let q = 0; q < 3; q++) { const c = tri[q]; d += wt3[q] * z[c]; if (ocean[c]) { r += wt3[q] * rich[c]; rw += wt3[q]; } }
            field[k] = d < 0 && d > -F.shelfKm && rw > 0 ? r / rw : 0;
        }
    }
    const sea = g.blur(field, F.reachKm), sum = new Float64Array(n), wt = new Float64Array(n), out = new Float32Array(n);
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
        const k = j * g.w + i, c = cellOf[k];
        if (!ocean[c] && sea[k] === sea[k]) { sum[c] += cosOf[j] * S(F.fishRich, sea[k]); wt[c] += cosOf[j]; }
    }
    for (let c = 0; c < n; c++) {
        if (ocean[c]) continue;
        const v = wt[c] > 0 ? sum[c] / wt[c] : S(F.fishRich, g.at(sea, lat[c], lon[c]));
        if (v > 0) out[c] = F.fishPeople * v * S(F.fishSummer, warmMo(c));
    }
    return out;
}

/**
 * The crop packages, each with its climate envelope (and `food`: its crop among FOODS): how suitable each Köppen class is for its wild ancestors (Blumler's
 * Mediterranean grasses; the monsoon's millets and rice; the tropics' roots and tubers). The envelope is what keeps a
 * package inside its own kind of country, so spreading along a latitude is easier than across it (Diamond's axes) by itself.
 */
// `abundance`: how thick the wild stands grow at their best. Large-seeded annual grasses are at home under winter rain and a
// long summer drought (Blumler 1992: of the 56 largest-seeded grasses, 32 are Mediterranean); summer-rain savannas are
// held by perennials, their wild cereals thinner — one reason the Levant came first and the tropics' cereals late.
export const PACKAGES = [
    { id: 'winterCereal', food: 'winterCereal', name: 'winter-rain cereals (wheat, barley, lentils)', rainMm: CIV.cerealRainMm, tempC: CIV.cerealTempC, cereal: true, abundance: 1,
        koppen: { Csa: 1, Csb: 0.85, Dsa: 0.6, Dsb: 0.5, BSk: 0.45, BSh: 0.3, Cfa: 0.25, Dfa: 0.25, Cfb: 0.2, Dfb: 0.15 } },
    { id: 'summerCereal', food: 'summerCereal', name: 'summer-rain cereals (millets, rice)', rainMm: [350, 500, 1800, 2800], tempC: [8, 13, 26, 29], cereal: true, abundance: 0.8,
        koppen: { Cwa: 1, Dwa: 0.8, Cwb: 0.6, Dwb: 0.55, Aw: 0.3, Cfa: 0.4, BSh: 0.35, BSk: 0.2 } },
    { id: 'tuber', food: 'roots', name: 'roots and tubers (taro, yams, potatoes)', rainMm: [900, 1400, 6000, 9000], tempC: [8, 14, 28, 31], abundance: 0.75,
        koppen: { Af: 0.7, Am: 0.8, Cwb: 0.9, Cfb: 0.4, Aw: 0.4 }, highlandBonus: true },
];

/** The resources (plans/CIV_PLAN.md §9.2), wild, crops and herds. */
export const FOODS = ['largeGame', 'smallGame', 'aquatic', 'wildSeeds', 'wildRoots', 'nuts', 'winterCereal', 'summerCereal', 'roots', 'tree', 'flooded', 'herds'];
export const WILD_FOODS = FOODS.slice(0, 6);

// how open each Köppen class's country is — grassland, savanna, steppe, tundra 1; closed forest ~0 (by the biomes' tree
// cover: Hansen et al. 2013's map, read by eye per class)
export const OPEN = { Af: 0.05, Am: 0.15, Aw: 0.7, BWh: 0.6, BWk: 0.6, BSh: 0.9, BSk: 1, Cfa: 0.3, Cfb: 0.3, Cfc: 0.3, Csa: 0.5, Csb: 0.4, Csc: 0.3,
    Cwa: 0.5, Cwb: 0.5, Cwc: 0.4, Dfa: 0.5, Dfb: 0.3, Dfc: 0.15, Dfd: 0.15, Dsa: 0.6, Dsb: 0.5, Dsc: 0.3, Dsd: 0.3, Dwa: 0.5, Dwb: 0.4,
    Dwc: 0.2, Dwd: 0.2, ET: 0.8, EF: 0 };
// the seasonal tropics and the monsoon's uplands: wild yams and other roots stored through a dry season
const ROOTY = { Aw: 1, Am: 0.8, Cwa: 0.7, Cwb: 0.7, Af: 0.5, BSh: 0.4, Csa: 0.3, Csb: 0.3 };

/** The crops' foods (FOODS), persons/km² of field. */
const CROP_FOODS = ['winterCereal', 'summerCereal', 'roots', 'tree', 'flooded'];
const perKm2Of = (f, C) => f.yieldKg * 100 * (1 - f.fallow) * (1 - 1 / f.seedRatio) / C.grainPerPersonKg;
const perKm2 = (yieldKg, seedRatio, C) => yieldKg * 100 * (1 - C.fallow) * (1 - 1 / seedRatio) / C.grainPerPersonKg;

/**
 * One place's soil and crops (civSubstrate's, per cell; tuning/civ/food-check.mjs's on Earth's places): from its crops'
 * climate `s` (crops.js cropClimate) and its ground `g` — { silt: the share on river silt, held: the share holding a
 * river's or a marsh's water (flooded fields by their warmth alone), irrig: irrigation's worth 0–1, irrigShare: the share
 * irrigable, loess, sand: the shares on them }. Fills `out`: soilBed, soilSilt, soil, soilKind; each crop's food
 * (CROP_FOODS, persons/km² of field) and canalWinterCereal, canalSummerCereal (watered by canals: civSubstrate's
 * canalFood); rainfed (kg/ha), farmDry, farmWet, farmers (persons/km² of farmland); farmV (the best rotation's food in
 * good harvests a year: the Farmland view's classes); harvests, harvestsW, rotCls.
 */
export function placeFood(s, g, out = {}, C = CIV, F = FOOD) {
    // the soil (food-config.js; upstream's farming.js farmCells): what it formed from — river silt on the cell's
    // floodplain or delta share, loess and dune sand where the finish's wind laid them, middling ground elsewhere (the
    // parent rock: TODO) — and what the climate made of it (crops.js climateSoil): black earth, leaching (spared where
    // floods renew the silt), podzol
    const silt = g.silt, loessS = g.loess, sandS = g.sand;
    const parentBed = loessS * F.parent.loess + sandS * F.parent.sand + (1 - loessS - sandS) * (g.rock ?? F.parent.rock), black = s.black, podzol = s.podzol;
    const climateF = (1 + F.blackBonus * black) * (1 - F.podzolLoss * podzol);
    out.soilBed = Math.min(1, parentBed * (1 - F.leachLoss * s.leach * (1 - (g.renew ?? 0))) * climateF);
    out.soilSilt = Math.min(1, F.parent.silt * (1 - F.leachLoss * s.leach * (1 - F.leachRenew)) * climateF);
    out.soil = silt * out.soilSilt + (1 - silt) * out.soilBed;
    out.soilKind = (silt >= 0.5 ? Parent.SILT : loessS >= 0.5 ? Parent.LOESS : sandS >= 0.5 ? Parent.SAND : Parent.ROCK)
        | ((s.leach * (1 - (silt >= 0.5 ? F.leachRenew : 0)) >= 0.45 ? SoilMod.LEACHED : black >= 0.5 ? SoilMod.BLACK : podzol >= 0.5 ? SoilMod.PODZOL : 0) << 4);
    const bed = out.soilBed, fine = out.soilSilt;

    // the crops (crops.js: harvests a year, by rain; the yields of civ-config cropFood for one harvest on middling
    // ground): each class's own harvests — past the first, as many as the soil can feed — × what it asks of the soil,
    // on the silt share and the rest; flooded fields by the rain, or by a river or a marsh wherever the land holds water
    // (its warmth alone)
    const wm = s.warmMo, yieldOf = (h, a) => silt * foodHarvests(h, a, fine, null, F) + (1 - silt) * foodHarvests(h, a, bed, wm, F);
    const A = F.crops;
    out.winterCereal = yieldOf(s.winterCereal, A.winterCereal.soil) * perKm2Of(C.cropFood.winterCereal, C);
    out.summerCereal = yieldOf(s.summerCereal, A.summerCereal.soil) * perKm2Of(C.cropFood.summerCereal, C);
    out.roots = yieldOf(s.roots, A.roots.soil) * perKm2Of(C.cropFood.roots, C);
    out.tree = s.tree * (silt * soilFactor(F.treeSoil, fine, F) + (1 - silt) * soilFactor(F.treeSoil, bed, F) * croppedShare(bed, wm, F)) * perKm2Of(C.cropFood.tree, C);
    const held = g.held;
    out.flooded = Math.max(yieldOf(s.paddy, A.paddy.soil), foodHarvests(s.paddyF, A.paddy.soil, fine, null, F) * held) * perKm2Of(C.cropFood.flooded, C);
    out.canalWinterCereal = out.winterCereal; out.canalSummerCereal = out.summerCereal;
    if (g.irrig > 0) {
        const k = perKm2(C.irrigatedYield, C.seedRatioIrrigated, C) * Math.min(1, 2 * g.irrig);
        out.canalWinterCereal = Math.max(out.winterCereal, foodHarvests(s.winterCerealW, A.winterCereal.soil, fine, null, F) * k);
        out.canalSummerCereal = Math.max(out.summerCereal, foodHarvests(s.summerCerealW, A.summerCereal.soil, fine, null, F) * k);
    }

    // a km² of farmland by rain and watered (settle.js, polity.js, cradles.js): the best rotation — a crop and a second
    // in the months it leaves — at rain-fed and at irrigated yields
    const rotA = s.rotCls >= 0 ? A[HARVEST_CLASSES[s.rotCls]].soil : 0.65, rotWA = s.rotWCls >= 0 ? A[HARVEST_CLASSES[s.rotWCls]].soil : 0.65;
    out.rainfed = C.rainfedYield * yieldOf(s.rot, rotA);
    const dry = perKm2(out.rainfed, C.seedRatioRainfed, C), wet = g.irrig > 0 ? Math.max(dry, perKm2(C.irrigatedYield, C.seedRatioIrrigated, C) * Math.min(1, 2 * g.irrig) * foodHarvests(s.rotW, rotWA, fine, null, F)) : dry;
    out.farmers = g.irrigShare * wet + (1 - g.irrigShare) * dry;
    out.farmDry = dry; out.farmWet = wet;
    out.harvests = s.rot; out.harvestsW = s.rotW; out.rotCls = (s.rotCls + 1) | ((s.rotWCls + 1) << 4);
    // (the best rotation's food in good harvests a year, by rain, and watered on the share canals reach: the farmland's
    // class — the cell's mean, so a coarse cell with a river is not all canal land)
    const rainV = yieldOf(s.rot, rotA), wetV = g.irrig > 0 ? Math.min(1, 2 * g.irrig) * foodHarvests(s.rotW, rotWA, fine, null, F) * C.irrigatedYield / C.rainfedYield : 0;
    out.farmV = rainV + g.irrigShare * Math.max(0, wetV - rainV);
    return out;
}

/** Foragers a km² on the land alone from its NPP (g/m²/yr): Tallavaara et al.'s regression (civ-config foragerSlope). */
export const landForager = (npp, C = CIV) => Math.pow(10, C.foragerSlope * 0.45 * npp + C.foragerIcept);
/** The Miami model's NPP, g dry matter/m²/yr (Lieth 1975), from the year's mean °C and rain (mm). */
export const miamiNpp = (T, P, C = CIV) => Math.min(C.nppMax / (1 + Math.exp(1.315 - 0.119 * T)), C.nppMax * (1 - Math.exp(-0.000664 * P)));

/** How a place's people would live (the Way of life view): each code its place in WAYS, never changed. */
export const WAYS = ['none', 'farming', 'herding', 'gathering'];
export const WAY_WORDS = ['Uninhabited', 'Farming', 'Herding', 'Gathering'];
export const Way = Object.freeze(Object.fromEntries(WAYS.map((k, i) => [k, i])));
/**
 * The way of life that would feed the most people a km² of the country, at full skill with every crop and herd at hand —
 * by the economy's own land shares (sim.js economyOf): farming its fields (civ-config fieldLand of the country, or
 * alluviumShare of the irrigable share, canal-watered) and its herds on the fallow (herdNear); herding the open country's
 * herds and a little grown (mobileCrops) — only where they may roam, as sim.js lets them: where the rain's year-to-year
 * CV reaches mobileCV or no crop feeds FOOD.stapleMin a km² of its field; gathering the wild (forager: the land's, fresh
 * water's and the sea's). The
 * potential, not where farming came: no history, no first-comer's hold (upstream's 10× gatherers' switch, not taken).
 * `p`: { field: the best crop's food a km² of field; canal: the best canal-watered (0 none); irrigShare; herds: a km² of
 * the country; open; forager; cv: the rain's year-to-year CV }. → [way, its people a km², the runner-up, its people a km²]
 */
export function wayOf(p, C = CIV, F = FOOD) {
    const roam = p.cv >= C.mobileCV || Math.max(p.field, p.canal) < F.stapleMin, sh = p.irrigShare, fields = sh > 0 && p.canal > 0 ? (1 - sh) * C.fieldLand * p.field + sh * C.alluviumShare * p.canal : C.fieldLand * p.field;
    const herdNear = p.open > 0 ? Math.min(1, C.herdNear / p.open) : 0;
    const v = [0, p.field > 0 || p.canal > 0 ? fields + p.herds * herdNear : 0, roam ? p.herds + C.mobileCrops * C.fieldLand * p.field : 0, p.forager];
    let a = 0, b = 0;
    for (let k = 1; k < 4; k++) if (v[k] > v[a]) { b = a; a = k; } else if (v[k] > v[b]) b = k;
    return [a, v[a], b, v[b]];
}

/** A place's staple (the Staple food view; tuning/civ/food-check.mjs): what its people, living their likeliest way
 *  (wayOf), would eat most — farmers their best crop on a km² of its field (the canal's, on irrigable ground, for the
 *  cereals), herders their herds, gatherers the wild — or nothing where no crop feeds FOOD.stapleMin a km² of its field
 *  and no herd FOOD.herdMin a km² of its pasture. Each code its place in STAPLES, never changed. */
export const STAPLES = ['none', 'winterCereal', 'summerCereal', 'roots', 'tree', 'flooded', 'herds', 'wild'];
export const STAPLE_WORDS = ['Nothing grows', 'Wheat and barley', 'Maize, millet, sorghum', 'Roots and tubers', 'Tree crops', 'Paddy rice', 'Herds', 'Wild food'];
export const Staple = Object.freeze(Object.fromEntries(STAPLES.map((k, i) => [k, i])));
/** `crop(f)`: a crop's food a km² of field (CROP_FOODS); `pasture`: the herds' a km² of their pasture; `way`: wayOf's.
 *  → [staple, its food a km² of its land, the runner-up crop, its food] */
export function stapleOf(crop, pasture, way, F = FOOD) {
    let a = Staple.none, va = 0, b = Staple.none, vb = 0;
    for (const f of CROP_FOODS) {
        const v = crop(f);
        if (v > va) { b = a; vb = va; a = Staple[f]; va = v; } else if (v > vb) { b = Staple[f]; vb = v; }
    }
    if (way === Way.herding || (va < F.stapleMin && way !== Way.gathering)) return pasture >= F.herdMin ? [Staple.herds, pasture, a, va] : [Staple.none, 0, a, va];
    if (way === Way.gathering) return [Staple.wild, 0, a, va];
    return [a, va, b, vb];
}
/** The rain's year-to-year CV from its storms alone (climate-var.js: Conrad 1941's curve, without the climate's modes). */
export const stormCV = (P, C = CIV) => (P > 0 ? 1 / Math.sqrt(Math.max(1, P / C.eventMm)) : 1);
/** A cell's way of life and staple (wayOf, stapleOf) from civSubstrate's `sub`, the rain's CV `cv`: [way, staple]. */
export function cellLife(sub, c, cv, C = CIV, F = FOOD) {
    const sh = sub.irrigShare[c], wet = sub.irrig[c] > 0 && sh > 0;
    const crop = f => (wet && (f === 'winterCereal' || f === 'summerCereal') ? Math.max(sub.food[f][c], sub.canalFood[f][c]) : sub.food[f][c]);
    let field = 0, canal = 0;
    for (const f of CROP_FOODS) field = Math.max(field, sub.food[f][c]);
    if (wet) canal = Math.max(sub.canalFood.winterCereal[c], sub.canalFood.summerCereal[c], sub.food.flooded[c]);
    const [way] = wayOf({ field, canal, irrigShare: sh, herds: sub.food.herds[c], open: sub.open[c], forager: sub.forager[c], cv }, C, F);
    const pasture = sub.open[c] > 0 ? sub.food.herds[c] / sub.open[c] : 0;
    return [way, stapleOf(crop, pasture, way, F)[0]];
}

/**
 * @param {object} w the finished moment, read: { mesh, z (km), ocean, lake, koppen, tAnnual, pAnnual, stats (cell-stats),
 *   rivers (finish-hydro's points, with regime and farFed), loess (km, optional) }
 */
export function civSubstrate(w, C = CIV, F = FOOD) {
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
    const mouthOf = new Int32Array(n).fill(-1);
    for (let c = 0; c < n; c++) if (dDelta[c] === 0) mouthOf[c] = c;
    spreadKm(mesh, dDelta, {
        maxKm: C.deltaKmPerRootM3s * Math.sqrt(30000),
        canEnter: (a, b) => land(b) && z[b] <= C.deltaMaxKm && dDelta[a] + edgeKm <= C.deltaKmPerRootM3s * Math.sqrt(mouthQ[a]),
        onReach: (a, b) => { mouthQ[b] = mouthQ[a]; mouthOf[b] = mouthOf[a]; },
    });
    // (each delta's area by km — deltaAreaPerL2 × its reach inland² — over the cells it reached: a coarse mesh's mouth
    // cell is wider than its delta, a fine mesh's cells share it)
    const deltaCells = new Float64Array(n);
    for (let c = 0; c < n; c++) if (mouthOf[c] >= 0) deltaCells[mouthOf[c]]++;
    for (let c = 0; c < n; c++) {
        if (mouthOf[c] >= 0) { const m = mouthOf[c], L = C.deltaKmPerRootM3s * Math.sqrt(Math.min(30000, mouthQ[m])); wetland[c] = Math.min(1, C.deltaAreaPerL2 * L * L / (deltaCells[m] * cellKm2)); }
        else if (land(c) && riverQ[c] >= C.marshMinM3s && relief[c] < C.marshReliefKm) wetland[c] = Math.min(1, C.marshKm * edgeKm / cellKm2);
    }

    const npp = new Float32Array(n), et = new Float32Array(n), forager = new Float32Array(n), forageGlacial = new Float32Array(n), rainfed = new Float32Array(n);
    const irrig = new Float32Array(n), irrigShare = new Float32Array(n), farmers = new Float32Array(n), farmDry = new Float32Array(n), farmWet = new Float32Array(n), coastal = new Uint8Array(n), lakeside = new Uint8Array(n);
    const wild = Object.fromEntries(PACKAGES.map(p => [p.id, new Float32Array(n)]));
    const food = Object.fromEntries(FOODS.map(f => [f, new Float32Array(n)])), canalFood = { winterCereal: new Float32Array(n), summerCereal: new Float32Array(n) }, open = new Float32Array(n), wildHerd = new Float32Array(n);
    const cropSuit = {}, T12 = new Float64Array(12), P12 = new Float64Array(12), cropAt = c => {
        if (w.crops) return cropsAt(w.crops, c, cropSuit);
        // (no months kept: the year's mean and its range, a sine through the year — rain by the season's index)
        const T = tAnnual[c], P = pAnnual[c], r = stat('tRange', c) || 0, si = stat('rainSeason', c) || 0, south = xyz[3 * c + 2] < 0;
        for (let m = 0; m < 12; m++) { const ph = Math.cos(2 * Math.PI * (m - (south ? 0.5 : 6.5)) / 12); T12[m] = T + r / 2 * ph; P12[m] = Math.max(0, P / 12 * (1 + Math.min(1, si) * 1.5 * ph)); }
        return cropClimate(T12, P12, Math.asin(xyz[3 * c + 2]), cropSuit);
    };
    // (the soil, per cell — on the bedrock, on the silt, the cell's mean — and its kind: Parent | SoilMod << 4; the best
    // rotation's harvests a year by rain and watered, and its classes: crops.js rotCls)
    const soil = new Float32Array(n), soilBed = new Float32Array(n), soilSilt = new Float32Array(n), soilKind = new Uint8Array(n);
    const harvests = new Float32Array(n), harvestsW = new Float32Array(n), rotCls = new Uint8Array(n), farmV = new Float32Array(n), ground = {}, pf = {};
    for (let c = 0; c < n; c++) {
        if (!land(c)) continue;
        for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) { const nb = mesh.adjList[k]; if (ocean[nb]) coastal[c] = 1; else if (lake[nb]) lakeside[c] = 1; }
    }
    // (the sea's fish on the coasts' land, persons/km²)
    const fish = seaFish(w, coastal, c => cropAt(c).warmMo, F);
    for (let c = 0; c < n; c++) {
        if (!land(c)) continue;
        const T = tAnnual[c], P = pAnnual[c], kop = koppen[c], code = KOPPEN_CLASSES[kop]?.code ?? '';
        if (!(T === T) || !(P === P)) continue;
        // the Miami model (Lieth 1975)
        npp[c] = miamiNpp(T, P, C);
        if (code === 'EF') npp[c] = 0;
        const range = stat('tRange', c) || 0, Wm = T + range / 2, Cm = T - range / 2;
        et[c] = Wm - Cm + 8 > 0 ? (18 * Wm - 10 * Cm) / (Wm - Cm + 8) : 8;

        // foragers: the NPP regression, less under closed rainforest, more by water (and in the glacial climate, again)
        const nppAt = (t, p) => (code === 'EF' ? 0 : miamiNpp(t, p, C));
        let d = landForager(npp[c], C), dG = landForager(nppAt(T + C.glacialDT, P * C.glacialPScale), C);
        if (code === 'Af') { d *= C.foragerRainforest; dG *= C.foragerRainforest; }
        // (fresh water's bonuses on a strip aquaticStripKm wide, the rest of the cell without: the same at every detail;
        // and the sea's fish, added: a rich shelf feeds its coast's foragers whatever the land behind it grows)
        let aqua = 1;
        if (lakeside[c]) aqua *= C.aquaticLake;
        if (riverQ[c] >= C.aquaticRiverM3s) aqua *= 1 + (C.aquaticRiverMax - 1) * rise(0, 3, Math.log10(riverQ[c] / C.aquaticRiverM3s));
        aqua = 1 + (Math.min(C.aquaticMax, aqua) - 1) * Math.min(1, C.aquaticStripKm / edgeKm);
        if (wetland[c]) aqua *= 1 + (C.wetlandAquatic - 1) * wetland[c];
        forageGlacial[c] = Math.min(C.foragerMax, dG * Math.min(C.aquaticMax, aqua) + fish[c]);
        forager[c] = Math.min(C.foragerMax, d * Math.min(C.aquaticMax, aqua) + fish[c]);
        const fromLand = d, fromWater = d * (Math.min(C.aquaticMax, aqua) - 1) + fish[c], beforeSeeds = forager[c];

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

        // ── the resources (§9.2). The wild: foragers' density, split — the water's share (its bonus), the wild cereal
        // stands' (theirs), and the land's by Binford's (2001) pattern, plants more as the effective temperature rises
        // (hunting dominant below ET ~12, gathering above ~15), animals large in open country, small in forest; plants
        // roots in the seasonal tropics, nuts and fruit in forest ──
        open[c] = OPEN[code] ?? 0;
        const scale = beforeSeeds / Math.max(1e-9, fromLand + fromWater), plants = C.wildPlantShare[0] + (C.wildPlantShare[1] - C.wildPlantShare[0]) * rise(10, 18, et[c]);
        const landFood = fromLand * scale, rootW = ROOTY[code] ?? 0.1, nutW = 0.2 + (1 - open[c]);
        food.aquatic[c] = fromWater * scale;
        food.wildSeeds[c] = forager[c] - beforeSeeds;
        food.largeGame[c] = landFood * (1 - plants) * open[c];
        food.smallGame[c] = landFood * (1 - plants) * (1 - open[c]);
        food.wildRoots[c] = landFood * plants * rootW / (rootW + nutW);
        food.nuts[c] = landFood * plants * nutW / (rootW + nutW);
        // wild herd animals: open country, best in uplands (wild sheep and goats) — none in ice or closed forest
        wildHerd[c] = code === 'EF' ? 0 : open[c] * (0.5 + 0.5 * rise(C.reliefKm[0], C.reliefKm[1], relief[c]));

        // irrigation: reachable — the whole cell on a broad plain, its river's floodplain share of it otherwise — and needed
        // (dry, warm), better on a flood-season or far-fed river
        const grow = stat('growing', c) || 0;
        if (reach[c] > 0 && reach[c] < Infinity) irrigShare[c] = 1;
        else if (reach[c] === 0) irrigShare[c] = Math.min(1, Math.min(C.floodplainMaxKm, C.floodplainCoef * Math.sqrt(riverQ[c])) * edgeKm / cellKm2);
        if (irrigShare[c] > 0 && grow >= C.irrigGrowMonths[0]) {
            const arid = stat('aridity', c), need = 1 - rise(C.irrigNeedAridity[0], C.irrigNeedAridity[1], arid === arid ? arid : 1);
            const s = src[c], bonus = 1 + (riverRegime[s] === Regime.FLOOD ? C.floodBonus : 0) + (riverFar[s] ? C.farFedBonus : 0);
            irrig[c] = Math.min(1, need * rise(C.irrigGrowMonths[0], C.irrigGrowMonths[1], grow) * bonus / (1 + C.floodBonus + C.farFedBonus) * (1 - 0.5 * reach[c] / C.irrigReachKm));
            if (irrig[c] < 0.02) irrig[c] = 0;
        }
        if (code === 'EF') continue;

        // the soil and the crops (placeFood); the herds by the grass (grazing NPP: the open country's share, a sustainable
        // off-take, TLU per person)
        const g = ground;
        g.silt = Math.max(wetland[c], irrigShare[c]); g.held = wetland[c]; g.irrig = irrig[c]; g.irrigShare = irrigShare[c];
        g.loess = w.loess ? Math.min(1, Math.max(0, w.loess[c]) / 0.01) : 0; g.sand = w.erg ? Math.min(1 - g.loess, Math.max(0, w.erg[c])) : 0;
        placeFood(cropAt(c), g, pf, C, F);
        soilBed[c] = pf.soilBed; soilSilt[c] = pf.soilSilt; soil[c] = pf.soil; soilKind[c] = pf.soilKind;
        for (const f of CROP_FOODS) food[f][c] = pf[f];
        if (irrig[c] > 0) { canalFood.winterCereal[c] = pf.canalWinterCereal; canalFood.summerCereal[c] = pf.canalSummerCereal; }
        rainfed[c] = pf.rainfed; farmers[c] = pf.farmers; farmDry[c] = pf.farmDry; farmWet[c] = pf.farmWet; farmV[c] = pf.farmV;
        harvests[c] = pf.harvests; harvestsW[c] = pf.harvestsW; rotCls[c] = pf.rotCls;
        food.herds[c] = npp[c] * open[c] * C.grazeUse / C.tluIntakeT / C.tluPerPerson;
    }
    return { n, cellKm2, edgeKm, npp, et, forager, forageGlacial, wetland, wild, rainfed, irrig, irrigShare, farmDry, farmWet, irrigSrc: src, irrigKm: reach, farmers, relief, coastal, lakeside, food, canalFood, open, wildHerd,
        fish, soil, soilBed, soilSilt, soilKind, harvests, harvestsW, rotCls, farmV,
        river: { q: riverQ, regime: riverRegime, farFed: riverFar } };
}

