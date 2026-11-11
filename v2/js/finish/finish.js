// The Finish step (plans/V2_FINISH_PLAN.md): one moment of a history sculpted with care, on request — the surface
// domain-warped (F1), the climate calculated on it, the rivers carving it for
// longer with the climate's runoff, dry basins left closed, sediment laid down (F2), erosion and
// deposition through time (finish-erode.js), an Earth-like last ice age (F3), the wind's work (F4), and erosion's polish. Runs in finish-worker.js (or Node): the terrain pool builds the surface in
// slices, everything else runs here, on a mesh of any size — 10M cells included, which only this worker holds.

import { MinHeap } from '../core/min-heap.js';
import { FINISH, COVER } from './finish-config.js';
import { LatLonGrid } from './finish-grid.js';
import { rockBeforeCarve, rockCfg, rockColumn } from './finish-lithology.js';
import { closedBasins, joinOpenSeas } from './finish-basins.js';
import { depositSediment } from './finish-sediment.js';
import { lastIceAge } from './finish-ice.js';
import { windWork } from './finish-wind.js';
import { coastWork } from './finish-coast.js';
import { openStraits, fillSeaBasins, Water } from './finish-hydro.js';
import { fillSpillMerge } from './finish-fsm.js';
import { ERODE, erodeLandscape, erodeLadder, ladderOverWindow, flexOnto, hollowCensus, playas, bayheadFill } from './finish-erode.js';
import { erodeGPU, gpuCanRun } from '../gpu/erode-gpu.js';
import { sharedDevice } from '../gpu/gpu-device.js';
import { landCover, coverRgb, newCover, biasTowardClimate, coverRain, coverRainScale, newVariety, placeVariety, placeGround, fineMottle, terrainLook } from './finish-cover.js';
import { KOPPEN_ID } from '../climate/koppen.js';
import { terrainMesh, terrainEdgeKm } from '../terrain/terrain-mesh.js';
import { terrainConfig } from '../terrain/terrain-config.js';
import { carveLadder, carveSettings } from '../terrain/synthesize.js';
import { floodSea } from '../terrain/carve.js';
import { carveTerrain, forgetMesh } from '../terrain/carve.js';
import { forgetEdgeKm } from '../core/min-heap.js';
import { planetClimate } from '../climate/climate.js';
import { CORE_DEFAULTS, cellClimate } from '../climate/core.js';
import { interpolationMatrix } from '../climate/seasons.js';
import { fuEvaporation, snowYear, waterMonths, monthPET, SOIL_MM } from '../climate/water.js';
import { pageClimate } from '../evolution/climate-fields.js';
import { cellStatsCollector, STAT_KEYS } from '../climate/cell-stats.js';
import { FastNoise } from '../core/fast-noise.js';
import { worldOcean } from '../terrain/world-ocean.js';
import { locate } from '../core/mesh-locate.js';
import { GEOLOGY } from '../geology/geology-config.js';

const R = 6371;
// The coast's waves are traced on at most this many of the pool's workers besides this thread (finish-coast.js): each
// holds a copy of the waves' grids and of the mesh, ~100 MB at 640K cells; three more hands than one cut the waves to a
// third (640K, 2026-10-28)
const COAST_WORKERS = 3;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The finish's erosion at F.erosionStrength (finish-config.js erosionLevels, linear between the levels): the stream power's
 *  m, and its k as a multiple of the terrain's (a river draining F.erosionPivotKm2 cuts as fast as before), and the crests'
 *  hardness. */
export function erosionAt(F, cfg) {
    const L = F.erosionLevels, s = Math.min(L.carveM.length - 1, Math.max(0, F.erosionStrength ?? 0)), i = Math.min(L.carveM.length - 2, Math.floor(s)), f = s - i;
    const at = a => a[i] + (a[i + 1] - a[i]) * f, m = at(L.carveM);
    return { m, kMul: F.erosionPivotKm2 ** (cfg.carveM - m), crestHardness: at(L.crestHardness) };
}

/** What runs erosion: the GPU's solver where this page (or Node, with v2/tools/gpu-harness/use-dawn.mjs) has a device, else the CPU's.
 *  Both take the same arguments; `on` says which ran. Below EP.gpuFloodCells closed basins flood on the CPU. */
async function erosionSolver(EP) {
    const gpu = EP.gpu && gpuCanRun(EP) ? globalThis.navigator?.gpu : null, opened = gpu ? await sharedDevice(gpu) : null;
    if (!opened) return { solve: erodeLandscape, on: 'cpu' };
    return { solve: (o, P) => erodeGPU(gpu, o, P, { device: opened, gpuClosed: o.mesh.numCells >= EP.gpuFloodCells }), on: opened.info?.description || opened.info?.architecture || 'gpu' };
}

/** What erosionSolver will run on here, without opening a device: 'gpu', 'cpu', or 'off' (no erosion in F) — the finish
 *  cache's engine (app/finish-key.js), worked out before a finish to look one up. A device that then fails to open runs
 *  the CPU's: the finish is filed under what really ran (its stats.erodeOn). */
export async function erosionEngine(F = FINISH) {
    const EP = F.erode ? { ...ERODE, ...F.erode } : null;
    if (!EP) return 'off';
    const gpu = EP.gpu && gpuCanRun(EP) ? globalThis.navigator?.gpu : null;
    if (!gpu) return 'cpu';
    try { return (await gpu.requestAdapter({ powerPreference: 'high-performance' })) ? 'gpu' : 'cpu'; } catch { return 'cpu'; }
}

/** The stages, in order, with their rough share of the time (for the progress bar). */
export const STAGES = (raw => { const all = raw.reduce((v, [, s]) => v + s, 0); return raw.map(([k, s]) => [k, s / all]); })(
    [['mesh', 0.12], ['surface', 0.18], ['climate', 0.1], ['rivers', 0.2], ['sediment', 0.06], ['erosion', 0.14], ['ice age', 0.08], ['wind', 0.05], ['coast', 0.04], ['sea', 0.02], ['polish', 0.06], ['water', 0.05], ['final climate', 0.03], ['picture', 0.09]]);

/**
 * @param {{frame: Object, simMesh: Object, seed: number, cells: number, pool: import('../terrain/terrain-pool.js').TerrainPool,
 *          onStage?: (name: string) => void, F?: Object, cfg?: Object}} o
 * @returns {Promise<{mesh: Object, z: Float32Array, ocean: Uint8Array, ms: Object, stats: Object}>}
 */
export async function finishPlanet(o) {
    // (a pool the finish was handed to close is closed whatever happens: it stays open past the surface, for the coast)
    try { return await finishStages(o); } finally { if (o.closePool && !o.pool.closed) o.pool.terminate(); }
}

async function finishStages({ frame, simMesh, seed, cells, pool, closePool = false, onStage = () => {}, F = FINISH, cfg = terrainConfig(), debug = false, climateOptions = {}, civ = false, observe = null }) {
    const ms = {}, stats = {};
    // (a study's census of the land's hollows after a stage: F.erode.trace. `observe(name, mesh, z, sea, lake?)`: a tool's look at
    // the ground after each stage — render-moment --dump — read only, never kept)
    const census = (name, sea) => { observe?.(name, mesh, z, sea); if (F.erode?.trace) (stats.census ??= {})[name] = hollowCensus(mesh, z, sea, null, F.lakeMinKm2, 1e-3 * F.lakeMinDepthM); };
    let mesh, z;
    let t0 = performance.now();
    const lap = name => { const t = performance.now(); ms[name] = (ms[name] ?? 0) + t - t0; t0 = t; };
    onStage('mesh');
    // (the carving's inputs at the finish's erosion strength: its stream power's k, its crests' hardness)
    const E = erosionAt(F, cfg), surfCfg = rockCfg({ ...cfg, carveK: cfg.carveK * E.kMul, carveCrestHardness: E.crestHardness });
    // (the surface's plan, begun on the pool's first worker while the mesh is built and warped here: it needs only the
    // mesh's cell size)
    const planned = pool.plan(frame, { cfg: surfCfg, seed, edgeKm: terrainEdgeKm(cells) });
    mesh = terrainMesh(cells);
    const n = mesh.numCells, cellKm2 = 4 * Math.PI * R * R / n;
    lap('mesh');

    // ── F1: the surface, domain-warped (its positions displaced before anything is read there) ──
    onStage('surface');
    // (memory: at 10M cells every array is 40 MB or more — each let go as soon as it is done with, the warped positions
    // and the sampler with the surface, the carving's inputs and caches with the carve)
    let warped = { numCells: n, xyz: warpPositions(mesh, seed, F), edgeKm: mesh.edgeKm };
    let surf = await pool.synthesize(frame, warped, { cfg: surfCfg, seed, records: false, carveInputs: true, planned });
    // (its workers' memory back before the heavy stages: a few fresh workers, idle until the coast's waves, gone after them)
    if (closePool) await pool.restart(Math.min(pool.size, COAST_WORKERS)); else pool.forget?.(warped);
    let carveIn = surf.carveIn;
    z = surf.heightKm;
    const fade = lam => smooth(cfg.minWavesPerCell, cfg.fullWavesPerCell, lam / mesh.edgeKm);
    surf = null; warped = null;
    lap('surface');

    // ── the climate, on this surface ──
    onStage('climate');
    // (climateOptions: the page's Greenhouse and Precipitation — greenhouseWm2, precipScale)
    // (its land: all the world ocean does not reach — ground below sea level cut off from it, a sunk basin or a Caspian
    // drained, is land to the air, at its own height, the lapse rate warming it as air sinking into it is compressed;
    // the Dead Sea's shore at −430 m and the Danakil's are among the hottest places on Earth. Until 2026-11-10 the
    // climate took land as z > 0: such a pit was sea to every stage, and its ground read the sea level's temperature.
    // The climate runs before the lakes exist, so a cut-off lake is read as its dry floor — PITHEAT, README)
    // (the world ocean — the sea joined to the largest body of water — its straits narrower than the mesh's cells opened
    // first: a sea cut off from it is a closed basin, its level its water balance's — finish-basins.js; taken here, before
    // the carve's micro-relief (which leaves z as it is), for the ice: what reaches it calves, what reaches a sunk basin
    // melts into it)
    let ocean0 = oceanMask(mesh, z), climateLand = new Uint8Array(n);
    for (let c = 0; c < n; c++) climateLand[c] = ocean0[c] ? 0 : 1;
    const gamma = CORE_DEFAULTS.lapseRateCPerKm;
    // (civ: the civ layer's own fields gathered too — v2/js/civ/civ-finish.js, loaded only then; the People switch)
    const CF = civ ? await import('../civ/civ-finish.js') : null;
    // (the climate on a surface — its land all the world ocean `ocean0` does not reach — and all the finish reads of it: run here
    // on the surface, and again after the erosion when a pit it read as land ends as sea: the finished sea's climate, below)
    const climateOn = (z, climateLand, ocean0) => {
        let res = planetClimate({ xyz: mesh.xyz, elevKm: z, axes: 'z-up', land: climateLand }, climateOptions);
        const { koppen, tAnnual: tAnn, pAnnual: pAnn, lat, lon } = res.cell, G = res.grid.size;
        for (let c = 0; c < n; c++) if (pAnn[c] > F.rainMaxMm) pAnn[c] = F.rainMaxMm;     // (the climate's rare wet hotspots)
        // (the warmest month at sea level, and the winds, on the climate's grid)
        const warmG = new Float32Array(G).fill(-Infinity);
        for (let g = 0; g < G; g++) {
            const href = res.surface.meanLandKm[g] === res.surface.meanLandKm[g] ? res.surface.meanLandKm[g] : 0;
            for (let m = 0; m < 12; m++) { const t = res.months.T[m * G + g] + gamma * href; if (t > warmG[g]) warmG[g] = t; }
        }
        const circ = res.stages.circulation, year = (a, m = -1) => { const o = new Float32Array(G); for (let g = 0; g < G; g++) { if (m >= 0) o[g] = a[m * G + g]; else { let s = 0; for (let k = 0; k < 12; k++) s += a[k * G + g]; o[g] = s / 12; } } return o; };
        const waveIn = { u: circ.u, v: circ.v, ice: res.stages.temperature?.seaIce ?? null, eady: res.stages.rain?.eady ?? null, anchors: res.anchorMonths };      // (the coast's waves)
        const wind = { year: [year(circ.u), year(circ.v)], jan: [year(circ.u, 0), year(circ.v, 0)], jul: [year(circ.u, 6), year(circ.v, 6)] };
        const travelFlow = CF?.travelFlow(res.grid, circ, res.stages.ocean);
        const climGrid = { w: res.grid.w, h: res.grid.h }, warmSl = new Float32Array(n);
        for (let c = 0; c < n; c++) warmSl[c] = bilinear(climGrid, warmG, lat[c], lon[c]);
        // (the land's potential evaporation, month by month (mm): the climate's own — Priestley–Taylor's, from the sunlight
        // the ground keeps and the air's temperature (rain.js) — the rate its land evaporated at, so the rivers carry the water
        // the atmosphere lost to them; its anchors made months as the months themselves are)
        const petM = potentialMonths(res, G, F);
        // (the months each place's rain passes a share of its evaporation, or it freezes — the rivers' seasons)
        const wetG = new Float32Array(G), wetMonths = new Float32Array(n);
        for (let g = 0; g < G; g++) {
            let k = 0;
            for (let m = 0; m < 12; m++) { const T = res.months.T[m * G + g], P = res.months.P[m * G + g], E = Math.max(5, petM[m * G + g]); if (T < 0 || P > F.wetShare * E) k++; }
            wetG[g] = k;
        }
        for (let c = 0; c < n; c++) wetMonths[c] = bilinear(climGrid, wetG, lat[c], lon[c]);
        // (the climate classifies only its land — all the world ocean does not reach, a sunk basin's floor too; the sea takes
        // the grid's year: its rain, and its temperature at the water's surface)
        const pG = new Float32Array(G), tG = new Float32Array(G);
        for (let g = 0; g < G; g++) {
            const href = res.surface.meanLandKm[g] === res.surface.meanLandKm[g] ? res.surface.meanLandKm[g] : 0;
            let p = 0, t = 0;
            for (let m = 0; m < 12; m++) { p += res.months.P[m * G + g]; t += res.months.T[m * G + g] / 12; }
            pG[g] = p; tG[g] = t + gamma * href;
        }
        for (let c = 0; c < n; c++) if (!(pAnn[c] === pAnn[c])) { pAnn[c] = bilinear(climGrid, pG, lat[c], lon[c]); tAnn[c] = bilinear(climGrid, tG, lat[c], lon[c]) - gamma * Math.max(0, z[c]); }
        // (the thaw gate — lane polar, 2026-11-05: the year's water that runs as liquid. Snow falls in each month below freezing
        // at the place's own height (the climate's month at sea level, less the lapse over the cell's height, as the ice age
        // and the warmest month take it) and stays until a month above freezing melts it, F.snowMeltMmPerC per °C; rain falls
        // in the months above. Snow the thawed months cannot melt is kept, year on year — the snowfield and the ice sheet's
        // accumulation, not runoff: where no month thaws none of the year's water runs (the program's ruling; risk row 6 and
        // 12 of the model review), and neither its rivers nor its lakes are fed by it. The rest, the liquid, is what Budyko
        // shares between the rivers and the air. A hollow on ground that never thaws fills with its snow, as ice, and spills:
        // no lake (finish-fsm.js). The water a hollow's open water gains from the sky stays the whole year's (snow on a lake
        // is kept on it, as the rain is), so the erosion's closed basins see the frozen hollow full, as before. Kept as stats.snowStore for the water ledger
        // (lane #5) and for the ice's mass (U9). What it skips: the year is the climate's mean month by month — a month a
        // little below freezing on the mean has thawing days (positive degree-days from the monthly spread, Braithwaite 1985),
        // and a store that melts away years later; the snow's sublimation and wind drift; no store carried between years)
        const liquid = thawedWater(res.months, res.surface.meanLandKm, climGrid, G, z, pAnn, lat, lon, gamma, F, n, climateLand);
        stats.snowStore = liquid.stats;
        // (each place's runoff shared over the months — rain, snow kept until it melts, less a share of each month's
        // evaporation; a share, where it is humid, through the ground, which drains back slowly — and each month's dryness)
        const monthly = runoffMonths(res.months, petM, G, F);
        // (the year's potential evaporation on the grid, for each cell's; and the climate's own land water, for the stats: its
        // land's rain less its land's evaporation, as a share of the rain — what the rivers should carry back to the sea)
        const petG = new Float32Array(G), elandG = new Float32Array(G), RS = res.stages.rain, KA = res.anchorMonths.length;
        let gP = 0, gE = 0;
        for (let g = 0; g < G; g++) {
            let e = 0, pp = 0;
            for (let m = 0; m < 12; m++) { petG[g] += Math.max(0, petM[m * G + g]); pp += Math.max(0, res.months.P[m * G + g]); }
            if (!RS?.Eland) continue;
            for (let k = 0; k < KA; k++) e += RS.Eland[k * G + g];
            elandG[g] = 12 * e / KA;
            const lf = res.surface.landFrac[g], wgt = lf > 0 ? lf * Math.cos(res.grid.lat[Math.floor(g / res.grid.w)] * Math.PI / 180) : 0;
            if (wgt > 0) { gP += wgt * pp; gE += wgt * 12 * e / KA; }
        }
        stats.climateRunoffShare = gP > 0 ? +((gP - gE) / gP).toFixed(3) : null;
        // (debug: the grid's water for the ledger's studies — tools/water-study.mjs)
        const waterGrid = debug ? { grid: res.grid, surface: res.surface, months: res.months, petM, Eland: RS?.Eland ?? null, frontal: RS?.frontal ?? null, rainP: RS?.P ?? null, anchors: KA, share: monthly.share } : null;
        // (kept for the finished moment's own climate, at the end: the page's grid fields, and the grid's climate to finish
        // each cell again on the finished surface)
        const pageC = pageClimate(res, { cells: false }), gridClimate = { grid: res.grid, surface: res.surface, months: res.months, cell: { lat, lon } };
        const runoff = new Float32Array(n), pet = new Float32Array(n);
        let sumR = 0, sumP = 0, sumK = 0, sumE = 0, sumEc = 0, landN = 0;
        for (let c = 0; c < n; c++) {
            if (!(pAnn[c] === pAnn[c])) continue;
            const P = Math.max(0, liquid.rain[c]), E0 = Math.max(F.petMinMm, bilinear(climGrid, petG, lat[c], lon[c]));
            pet[c] = E0;
            runoff[c] = P - fuEvaporation(P, E0, F.budykoW);
            if (z[c] > 0) {
                sumR += runoff[c]; sumP += Math.max(0, pAnn[c]); sumK += liquid.store[c]; landN++;
                sumE += P - runoff[c];
                if (RS?.Eland) sumEc += bilinear(climGrid, elandG, lat[c], lon[c]);
            }
        }
        // (the kept snow's way out: down to where it melts, or to the sea — iceDischarge; its meltwater runs as the margin's)
        // (the water a cell's own ground keeps from the sky — its rain less its own runoff: its land's evaporation and its kept
        // snow. A hollow's water gathers every cell's runoff, its own cells' too, so what open water loses over a cell is its
        // evaporation beyond what the land there already lost, E_open − E_land — not E_open less all the rain, which counted
        // the cell's rain twice, once in its runoff (model review U1; 0.9–2.9 % of the land's runoff, all of it on lakes:
        // tools/water-study.mjs). finish-basins.js closedBasins, finish-fsm.js and the erosion's closed basins read it as
        // their lakes' sky water)
        const skyKept = new Float32Array(n);
        for (let c = 0; c < n; c++) skyKept[c] = pAnn[c] === pAnn[c] ? Math.max(0, pAnn[c]) - runoff[c] : NaN;
        // (the sky's own runoff, before iceDischarge adds today's sheets' melt to it: the last ice age's lakes read this.
        // Today's sheets aren't the ice age's — its sheets stood elsewhere and larger — so their melt isn't the ice age's
        // water; reading it fed the ice-dammed lakes at the margins with a meltwater the ice age never had: floods' seed
        // 626225@300 ice-dammed lakes 2.49 → 1.67 Mkm², 12345@300's largest 520 → 35 thousand km³ without it. The ice age's
        // own sheets' melt budget is the model review's U9)
        const skyRunoff = runoff.slice();
        const D = iceDischarge(mesh, z, ocean0, liquid.store, runoff, cellKm2);
        // (the water ledger's books over the land, km³/yr — climate/water.js: rain = evaporation + runoff + kept snow, per
        // cell by construction; and against the climate's own land evaporation (rain.js Eland, the water its air got back
        // from this land): closure = (rain − the climate's evaporation − runoff − kept) ÷ rain)
        const k3 = x => Math.round(x * cellKm2 * 1e-6);
        stats.waterLedger = { rainKm3: k3(sumP), evapKm3: k3(sumE), runoffKm3: k3(sumR), keptKm3: k3(sumK), climateEvapKm3: RS?.Eland ? k3(sumEc) : null,
            closure: RS?.Eland && sumP > 0 ? +((sumP - sumEc - sumR - sumK) / sumP).toFixed(3) : null };
        sumR += D.meltMmKm2 / cellKm2; sumK = D.calvedMmKm2 / cellKm2 + D.heldMmKm2 / cellKm2;
        Object.assign(stats.snowStore, { meltKm3: Math.round(D.meltMmKm2 * 1e-6), calvedKm3: Math.round(D.calvedMmKm2 * 1e-6), heldKm3: Math.round(D.heldMmKm2 * 1e-6) });
        stats.runoffShare = sumP > 0 ? +(sumR / sumP).toFixed(3) : null;
        // (and with the ice that reaches the sea counted too: calved, and held in frozen pits — the rivers' share is the land's
        // liquid; Earth's ~0.35–0.40 counts Antarctica's ~2 000 km³ a year of ice discharge, Rignot et al. 2013)
        stats.runoffShareWithIce = sumP > 0 ? +((sumR + sumK) / sumP).toFixed(3) : null;
        return { koppen, tAnn, pAnn, lat, lon, G, climGrid, warmSl, waveIn, wind, travelFlow, petM, wetMonths, liquid, monthly, waterGrid, pageC, gridClimate,
            runoff, pet, skyKept, skyRunoff, sumR, sumP, landN };
    };
    let { koppen, tAnn, pAnn, lat, lon, G, climGrid, warmSl, waveIn, wind, travelFlow, petM, wetMonths, liquid, monthly, waterGrid, pageC, gridClimate,
        runoff, pet, skyKept, skyRunoff, sumR, sumP, landN } = climateOn(z, climateLand, ocean0);
    lap('climate');

    // ── the rivers: runoff (rain less evaporation) weights the drainage; dry basins stay closed; carved for longer ──
    onStage('rivers');
    // (F.erodeGain: k_rock's spread for a sensitivity run; the config's otherwise)
    const Geo = F.erodeGain ? { ...GEOLOGY, lithology: { ...GEOLOGY.lithology, erodeGain: F.erodeGain } } : GEOLOGY, rockIn = { mesh, z, frame, simMesh, seed, cfg, lat, lon, rain: pAnn, temp: tAnn };
    const litho = rockBeforeCarve(rockIn, carveIn, Geo);      // (finish-lithology.js)
    lap('lithology');
    // (the old carve's water, against the climate's land: carveIn.rain, its mean over the land)
    let oldW = 0;
    for (let c = 0; c < n; c++) if (pAnn[c] === pAnn[c] && z[c] > 0) oldW += carveIn.rain[c];
    const meanR = landN ? sumR / landN : 1, meanP = landN ? sumP / landN : 1, meanW = landN ? oldW / landN : 1;
    for (let c = 0; c < n; c++) if (z[c] > 0 && pAnn[c] === pAnn[c])
        carveIn.rain[c] = meanW * Math.min(F.wetMax, Math.max(F.runoffFloor, (1 - F.rainShare) * runoff[c] / meanR + F.rainShare * Math.max(0, liquid.rain[c]) / meanP) ** F.wetPower);
    const straits0 = openStraits(mesh, z, ocean0, F);
    if (straits0.opened) ocean0 = oceanMask(mesh, z);
    observe?.('surface', mesh, z, ocean0);
    const B = closedBasins(mesh, z, runoff, pet, skyKept, cellKm2, F, ocean0);
    stats.closedBasins = B.basins;
    stats.cutOffSeas = B.seas;
    const before = z.slice();
    // (the rivers' base level: the glacial cycle's time-weighted mean sea, the finish's own figure — terrain-config carveSeaDropKm)
    const settings = carveSettings({ ...cfg, carveM: E.m, carveTimeMyr: F.carveTimeMyr, carveRounds: F.carveRounds, carveSeaDropKm: F.carveSeaDropKm });
    // (the carve's sea: the world ocean — a cut-off sea's dry floor below sea level is land its rivers cross, down to its
    // water's level, their base level there)
    census('before carve', ocean0);
    const C = carveTerrain(carveLadder(simMesh, mesh, terrainMesh), { ...carveIn, z, sink: B.sink, base: B.base, ocean: ocean0 }, settings);
    const low = settings.lowstandKm, worldOcean = ocean0;               // (the world ocean before the carve: the bayhead fill's open sea)
    ocean0 = C.sea;                                                   // (today's sea over the carved ground: bayhead deltas lie in the rias it drowned)
    stats.lowstand = { baseKm: low, ...C.flood };   // (the lowstand's valleys today's sea drowned, km²; the hollows below it it did not reach)
    // (where flood basalt still caps the ground after the carving — its pile not cut through — for the satellite view)
    const basalt = new Uint8Array(n);
    for (let c = 0; c < n; c++) if (carveIn.lip[c] > 0) basalt[c] = Math.round(255 * carveIn.lip[c] * smooth(0, 0.05, C.z[c] - carveIn.lipBase[c]));
    // (and how young the mountains are: the belt's activity, 1 while the history still raises it — the satellite view's tone)
    const young = new Uint8Array(n);
    for (let c = 0; c < n; c++) young[c] = Math.round(255 * Math.max(0, Math.min(1, carveIn.hold[c])));
    const soft = carveIn.soft;                                        // (how soft the rock is to the ice: the ice age's)
    // (a cut-off sea the erosion breaches refloods then: at each closed-basin judge, one whose rim the rivers have cut below
    // the sea's surface joins the ocean, in place — closedBasins' open, joinOpenSeas — so its rivers end at the sea from that
    // moment, not at its dry floor kilometres down for the rest of the window, and its floor stops filling. Lane reflood,
    // 2026-11-11 (inlandsea/report.md: 243751@730's trapped ocean, graded dry for the whole window and flooded only after it,
    // drowned 4.2 Mkm² of the history's land). stats.reflood: each, by the judge's mesh and count)
    const judges = new Map();
    stats.reflood = [];
    const reflooded = (lm, sea, B, at = 'early') => {
        const k = `${at} ${lm.numCells}`, judge = judges.get(k) ?? 0;
        judges.set(k, judge + 1);
        if (B.open.length && joinOpenSeas(B, sea)) for (const S of B.seas) if (S.open) stats.reflood.push({ at, cells: lm.numCells, judge,
            km2: Math.round(S.km2), floorKm: +S.floorKm.toFixed(3), sillKm: +S.sillKm.toFixed(3) });
        return B;
    };
    // (time-stepped erosion, on unless F.erode is false: finish-erode.js)
    const EP = F.erode ? { ...ERODE, ...F.erode } : null, eroder = EP ? await erosionSolver(EP) : null, erodeIn = EP ? { water: carveIn.rain, k: carveIn.k, m: E.m,
        uplift: EP.tectUplift ? carveIn.lift : null } : null;      // (the history's tectonic rise, km/Myr: ERODE tectUplift)
    carveIn = null;
    forgetMesh(mesh); forgetEdgeKm(mesh);                             // (the carve's caches for this mesh: ~0.5 GB at 10M)
    lap('rivers');

    // ── F2: sediment ──
    onStage('sediment');
    const Sed = depositSediment(mesh, before, C, B.sink, cellKm2, F, ocean0);
    stats.deltas = Sed.deltas;
    lap('sediment');
    z = C.z;
    census('after carve, sediment, creep', ocean0);
    if (EP?.column) {
        // (the rock under the carved ground; before: the surface the first read saw)
        const col = rockColumn({ ...rockIn, z: before, carved: C.z }, litho, Geo), k = erodeIn.k;
        for (let i = 0; i < n; i++) k[i] *= col.here[i];
        erodeIn.column = col;
        lap('lithology');
    }
    if (EP?.at === 'early' || EP?.at === 'both') {
        // (the lowstand's ocean: the sea where it was still deeper than the lowstand; the shelf between is land the erosion grades to it)
        const lowOcean = new Uint8Array(n);
        for (let c = 0; c < n; c++) lowOcean[c] = ocean0[c] && C.z[c] <= low ? 1 : 0;
        onStage('erosion');
        stats.erodeOn = eroder.on;
        const ER = EP.ladder ? await erodeLadder({ ...erodeIn, mesh, z: C.z, ocean: lowOcean, seaKm: low, runoff, pet, rain: skyKept, closedOf: (lm, g, f, sea, flood, seaKm) => reflooded(lm, sea, closedBasins(lm, g, f.runoff, f.pet, f.rain, 4 * Math.PI * R * R / lm.numCells, F, sea, flood, seaKm)), observe }, ladderOverWindow(EP, frame.tectSpanMyr), terrainMesh, eroder.solve)
            : await eroder.solve({ ...erodeIn, mesh, z: C.z, ocean: lowOcean, seaKm: low, closed: (g, flood) => reflooded(mesh, lowOcean, closedBasins(mesh, g, runoff, pet, skyKept, cellKm2, F, lowOcean, flood, low)) }, EP);
        const { outflow, ...erodeStats } = ER;
        stats.erode = erodeStats;
        lap('erosion');
        // (one flood at today's sea over what the erosion left: the lowstand's valleys it reaches are the rias; then the rivers
        // fill them from their heads through the transgression and the highstand — finish-erode.js bayheadFill — and the sea
        // is flooded once more over what they left open)
        {
            let f1 = floodSea(mesh, C.z, ocean0);
            const beforeFill = f1.drowned;
            if (F.bayheadFillKyr > 0 && outflow) {
                const t0 = performance.now(), drowned = new Uint8Array(n);
                for (let c = 0; c < n; c++) drowned[c] = f1.sea[c] && !worldOcean[c] ? 1 : 0;
                const bay = bayheadFill(mesh, C.z, drowned, f1.sea, outflow, F.bayheadFillKyr / 1000, cellKm2);
                f1 = floodSea(mesh, C.z, worldOcean);
                let filled = 0, cutOff = 0, open = 0;
                for (let c = 0; c < n; c++) if (drowned[c]) { if (f1.sea[c]) open++; else if (C.z[c] < 0) cutOff++; else filled++; }
                stats.lowstand.bayhead = { ...bay, ms: Math.round(performance.now() - t0), filledKm2: Math.round(filled * cellKm2), openKm2: Math.round(open * cellKm2), cutOffKm2: Math.round(cutOff * cellKm2) };
            }
            // (what the flood added beyond the carve's: broad plain, or valleys? a cell with every neighbour in the sea is plain
            // interior; the BFS ring it was reached in is its distance inland, in cells)
            const { adjOffset, adjList } = mesh, ring = new Int32Array(n).fill(1e9), hist = [0, 0, 0, 0, 0, 0], queue = [];
            for (let c = 0; c < n; c++) if (ocean0[c] && f1.sea[c]) { ring[c] = 0; queue.push(c); }
            let interior = 0, drowned = 0;
            for (let i = 0; i < queue.length; i++) {
                const c = queue[i];
                for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                    const q = adjList[k];
                    if (!f1.sea[q] || ring[q] <= ring[c] + 1) continue;
                    ring[q] = ring[c] + 1; queue.push(q);
                }
                if (ring[c] === 0) continue;
                let all = true;
                for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (!f1.sea[adjList[k]]) { all = false; break; }
                drowned++; if (all) interior++; hist[Math.min(5, ring[c] - 1)]++;
            }
            stats.lowstand.afterErode = { drownedKm2: Math.round(drowned * cellKm2), beforeFillKm2: Math.round(beforeFill * cellKm2), interiorKm2: Math.round(interior * cellKm2), ringKm2: hist.map(h => Math.round(h * cellKm2)) };
            ocean0 = f1.sea;
        }
        census('after erosion', ocean0);
    }

    // ── the finished sea's climate: the climate again, on the eroded surface and its sea, when ground it read as land below
    // sea level — a cut-off sea's dry floor, a sunk basin — ends under the world ocean (a breach in the erosion, or the flood
    // after it). The climate above read such a pit as land at its own height, the lapse rate warming it ~6.5 K a km
    // (PITHEAT); the sea that fills it has the sea's air and the sea's rain. Every stage from here reads this climate: the
    // ice age, the wind, the waves, the water, the finished moment's own. The erosion has run on the first: its rivers' water
    // was the dry pit's while it was dry. Lane reflood, 2026-11-11 (inlandsea/report.md: 243751@730's sea, read as a dry
    // pit 5 km deep, kept 54 °C air and 20 mm of rain a year). What it skips: the climate is not re-run for a pit that stays
    // dry or for a coast the erosion moved elsewhere, so the ground the erosion lowered or raised keeps the first surface's
    // climate there (stats.climateRerun) ──
    {
        let pits = 0;
        for (let c = 0; c < n; c++) if (climateLand[c] && before[c] < 0 && ocean0[c]) pits++;
        if (pits) {
            onStage('climate');
            const was = { T: pageC.T.year, sea: pageC.sea }, t1 = performance.now();
            climateLand = new Uint8Array(n);
            for (let c = 0; c < n; c++) climateLand[c] = ocean0[c] ? 0 : 1;
            ({ koppen, tAnn, pAnn, lat, lon, G, climGrid, warmSl, waveIn, wind, travelFlow, petM, wetMonths, liquid, monthly, waterGrid, pageC, gridClimate,
                runoff, pet, skyKept, skyRunoff, sumR, sumP, landN } = climateOn(C.z, climateLand, ocean0));
            stats.climateRerun = { pitsKm2: Math.round(pits * cellKm2), ms: Math.round(performance.now() - t1), ...climateShift(was, pageC) };
            lap('climate');
        }
    }

    // ── F3: the last ice age ──
    onStage('ice age');
    const grid = new LatLonGrid(0.25);
    const I = lastIceAge({ mesh, z: C.z, lat, lon, warmSl, rain: pAnn, grid, cellKm2, seed, soft, runoff: skyRunoff, pet, land: climateLand }, F);
    forgetEdgeKm(mesh);
    stats.iceKm2 = I.iceKm2; stats.iceSheets = I.sheets;
    let basinKm2 = 0, basinMaxKm = 0;
    for (let c = 0; c < n; c++) { if (I.basin[c] > 0.05) basinKm2 += cellKm2; if (I.basin[c] > basinMaxKm) basinMaxKm = I.basin[c]; }
    stats.iceBasins = { km2: Math.round(basinKm2), maxKm: Math.round(basinMaxKm * 1000) / 1000 };
    stats.floods = { lakes: I.floods.lakes, lakeKm2: Math.round(I.floods.lakeKm2), volumeKm3: Math.round(I.floods.volumeKm3), largestKm3: Math.round(I.floods.largestKm3), biggest: I.floods.biggest ?? [] };
    stats.floods.guard = { unheld: I.floods.unheld ?? 0, lats: I.floods.lats ?? [] };            // (finish-floods.js: for check-floods)
    census('after ice age', ocean0);
    lap('ice age');

    // ── F4: the wind ──
    onStage('wind');
    const W = windWork({ mesh, z: C.z, lat, lon, koppen, grid, wind, climGrid, outwash: I.margin, scoured: I.floods.flood, seed, fade, debug }, F);
    stats.ergKm2 = W.ergKm2; stats.loessKm2 = W.loessKm2;
    census('after wind', ocean0);
    lap('wind');

    // ── F5: the coast — the waves cut it back and drift its sand along it ──
    onStage('coast');
    const Co = await coastWork({ mesh, z: C.z, lat, lon, soft, climGrid, ...waveIn, mouths: Sed.mouths, carveYears: F.carveTimeMyr * 1e6, oceanMask: zz => oceanMask(mesh, zz), cellKm2,
        pool: pool.closed || pool.broken ? null : pool }, F);
    if (closePool) pool.terminate();
    stats.coast = Co.stats;
    census('after coast', ocean0);
    lap('coast');

    // ── the sea: water below sea level joined to the world ocean (fjords, sunk basins); a sea cut off from it is the
    // hydrology's, its level its water balance's ──
    onStage('sea');
    let ocean = oceanMask(mesh, C.z);
    // (an inland sea the ocean all but reaches — behind a low, short barrier — is opened into it; one left closed is a
    // remnant of the sea in a basin, for the hydrology: finish-hydro.js)
    const straits = openStraits(mesh, C.z, ocean, F);
    stats.straits = { opened: straits.opened + straits0.opened, cut: straits.cut + straits0.cut };
    if (straits.opened) ocean = oceanMask(mesh, C.z);
    const seaBasin = fillSeaBasins(mesh, C.z, ocean, F);
    forgetMesh(mesh); forgetEdgeKm(mesh);                             // (the carve's and the distances' caches for this mesh)
    lap('sea');
    if (EP?.at === 'late' || EP?.at === 'both') {
        onStage('polish');
        const slow = new Float32Array(n).fill(1);
        for (let c = 0; c < n; c++) if (I.ice[c]) slow[c] = EP.iceShare;
        stats.erodeOn = eroder.on;
        const late = await eroder.solve({ ...erodeIn, mesh, z: C.z, ocean, slow, flex: erodeIn.uplift && EP.rebound ? flexOnto(mesh, EP, terrainMesh) : null, closed: (g, flood) => reflooded(mesh, ocean, closedBasins(mesh, g, runoff, pet, skyKept, cellKm2, F, ocean, flood), 'late') }, EP.at === 'both' ? { ...EP, timeMyr: EP.polishMyr, steps: EP.polishSteps, G: EP.polishG, rebound: erodeIn.uplift ? EP.rebound : 0, lastClean: EP.lastClean } : EP);
        delete late.outflow;                                          // (per cell: bayheadFill's, after the early run only — not stats)
        if (stats.erode) stats.erodeLate = late; else stats.erode = late;
        lap('erosion');
        census('after late erosion', ocean);
    }

    // ── R1: rivers and lakes, by the climate ──
    onStage('water');
    census('before water', ocean);
    const ice = new Uint8Array(n);
    for (let c = 0; c < n; c++) if (koppen[c] === KOPPEN_ID.EF) ice[c] = 1;
    const bi = new Int32Array(4), bw = new Float64Array(4), at = (f, c) => f[bi[0]] * bw[0] + f[bi[1]] * bw[1] + f[bi[2]] * bw[2] + f[bi[3]] * bw[3];
    const months = { at: (c, m0, M, share, arid) => { corners(climGrid, lat[c], lon[c], bi, bw); for (let j = 0; j < M; j++) { share[j] = at(monthly.share[m0 + j], c); arid[j] = at(monthly.arid[m0 + j], c); } } };
    // (Fill-Spill-Merge on the erosion's ground: finish-fsm.js. Without the erosion, a study switch, it gives ~2.5× Earth's lakes)
    const Hy = fillSpillMerge({ mesh, z: C.z, ocean, runoff, pet, rain: pAnn, skyKept, frozen: liquid.frozen, wetMonths, ice, glaciated: I.ice, basin: I.basin, seaBasin, lat, lon, months, debug }, F);
    Object.assign(stats, { water: Hy.stats });
    if (EP?.playaYears > 0) stats.playaKm2 = playas(mesh, Hy.lake, Hy.lakeLevel, C.z, pet, pAnn, F, EP.playaYears, Water.SALT, Water.PAN);
    // (the sea again, after the rivers' gorges)
    ocean = oceanMask(mesh, C.z);
    observe?.('after water', mesh, C.z, ocean, Hy.lake);
    lap('water');

    // ── the finished moment's climate, at its detail: the grid's climate as calculated above, each cell's own (its
    // height, its relief, and sunk basins the sea does not reach as land) on the finished surface ──
    // And the land's cover from each cell's twelve months (finish-cover.js; plans/V2_SATELLITE_PLAN.md): its colour as from
    // space for the year, January and July (sRGB, 3 bytes each), and its biome (bits 0–4) with snow in January (bit 5) and
    // in July (bit 6), for the readout.
    onStage('final climate');
    const land = new Uint8Array(n);
    for (let c = 0; c < n; c++) land[c] = ocean[c] ? 0 : 1;
    const sat = [new Uint8Array(3 * n), new Uint8Array(3 * n), new Uint8Array(3 * n)], cover = new Uint8Array(n), cv = newCover();
    // (and the riverside's colour: the cover again, well watered — where it is dry enough to differ; else the cover's own)
    const ripSat = [new Uint8Array(3 * n), new Uint8Array(3 * n), new Uint8Array(3 * n)], cvWet = newCover(), PW = new Float64Array(12);
    // (the rain the cover reads: a little smoother, warped and roughened — from the climate stage's rain, its regional
    // pattern being all that is read)
    const rainTarget = coverRain(pAnn, lat, lon, c => land[c] === 1, new LatLonGrid(0.5), seed), P12c = new Float64Array(12);
    // (and its variety: tints between a few natural colours, by noise — its own stream)
    const varyNoise = new FastNoise(((seed | 0) * 0x51f3 + 0x3a9) >>> 0), vy = newVariety(), xyz = mesh.xyz;
    // (and its temperatures at its own full height — the climate takes only part of a place's height above its
    // surroundings: tree and snow lines follow all of it — its surroundings' height as the climate has it, the 1° grid's
    // mean land height)
    const relief = COVER.fullLapse ? (1 - CORE_DEFAULTS.terrainRelief) * gamma : 0, hLand = gridClimate.surface.meanLandKm, T12c = new Float64Array(12);
    // (and its measures beyond Köppen — cell-stats.js, one byte each — from the climate's own twelve months)
    const cellStats = cellStatsCollector(n, c => lat[c] * Math.PI / 180, { bytes: true });
    const civCells = CF?.civCollector(n, c => lat[c] * Math.PI / 180);
    const cellsClimate = cellClimate(gridClimate, mesh.xyz, C.z, land, {}, (c, T12, P12) => {
        cellStats.add(c, T12, P12);
        civCells?.add(c, T12, P12);
        let T = T12;
        if (relief) {
            corners(climGrid, lat[c], lon[c], bi, bw);
            let s = 0, k = 0;
            for (let j = 0; j < 4; j++) { const v = hLand[bi[j]]; if (v === v) { s += bw[j] * Math.max(0, v); k += bw[j]; } }
            const dT = k > 0 ? relief * (Math.max(0, C.z[c]) - s / k) : 0;
            for (let m = 0; m < 12; m++) T12c[m] = T12[m] - dT;
            T = T12c;
        }
        landCover(T, coverRainScale(P12, rainTarget[c], P12c), cv, F, COVER, lat[c]);
        placeVariety(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], varyNoise, vy);
        // (the floods' scoured ground: bare rock, dark as the flood basalt's — finish-floods.js)
        placeGround(vy, W.erg[c], W.loess[c] / F.loessKm, Math.max(basalt[c], F.floodRock * I.floods.flood[c]) / 255);
        for (let v = 0; v < 3; v++) coverRgb(cv, v, sat[v], 3 * c, undefined, vy);
        if (cv.wetness < COVER.ripWetness) {
            const k = COVER.ripWetness / Math.max(0.02, cv.wetness);
            for (let m = 0; m < 12; m++) PW[m] = P12c[m] * k;
            landCover(T, PW, cvWet, F, COVER, lat[c]);
            for (let v = 0; v < 3; v++) coverRgb(cvWet, v, ripSat[v], 3 * c, undefined, vy);
        } else for (let v = 0; v < 3; v++) { const S = sat[v], D = ripSat[v], o = 3 * c; D[o] = S[o]; D[o + 1] = S[o + 1]; D[o + 2] = S[o + 2]; }
        cover[c] = cv.biome | (cv.snow[1] >= 0.5 ? 32 : 0) | (cv.snow[2] >= 0.5 ? 64 : 0);
    });
    // (and toward each climate's own colours, regionally — on a coarser grid: the correction is smooth, ~100 km)
    biasTowardClimate(sat, cellsClimate.koppen, lat, lon, c => land[c] === 1 && cellsClimate.koppen[c] > 0, new LatLonGrid(0.5), seed);
    lap('final climate');
    const flow = new Float32Array(n);
    for (let c = 0; c < n; c++) flow[c] = Math.log10(Math.max(1, Hy.area[c]));
    delete litho.column;
    return { mesh, z: C.z, ocean, litho, lake: Hy.lake, lakeLevel: Hy.lakeLevel, rivers: Hy.rivers, ms, stats, glaciated: I.ice,
        climate: { page: pageC, cell: { koppen: cellsClimate.koppen, tAnnual: cellsClimate.tAnnual, pAnnual: cellsClimate.pAnnual, sat, cover, stats: cellStats.stats, mottleSeed: ((seed | 0) * 0x2f71 + 0x6d) >>> 0,
            flow, young, rivers: Hy.rivers, ripSat } },
        civ: civ ? { ice: I.ice, loess: W.loess, erg: W.erg, ...civCells.fields, flow: travelFlow } : null,              // (for the civ layer: v2/js/civ/civ-page.js)
        layers: debug ? { wave: Co.wave, coast: Co.change, ice: I.ice, flood: I.floods.flood, soft, basin: I.basin, sink: B.sink, erg: W.erg, loess: W.loess, basalt, koppen, before, rain: pAnn, lat, lon, q: Hy.q, recv: Hy.recv, terminal: Hy.terminal, lakeSrc: Hy.lakeSrc, hollow: Hy.hollow, hollowInfo: Hy.hollowInfo, tectonic: B.tectonic, warmSl, runoff, pet, liquid: liquid.rain, snowStore: liquid.store, frozen: liquid.frozen, thaw: liquid.thaw, tAnn, waterGrid } : null };
}

/**
 * How far the finished sea's climate moved from the first, on the 1° grid (stats.climateRerun): the year's sea-level temperature,
 * by the distance (in grid cells, the 8 neighbours a ring) from the cells whose sea changed (`changed`), so a study can judge
 * whether re-running only near the change would do. Lane reflood, 2026-11-11.
 */
function climateShift(was, C) {
    const G = C.sea.length, w = 360, h = G / w, ring = new Int16Array(G).fill(-1);
    const bands = [[0, 0], [1, 2], [3, 5], [6, 10], [11, 30], [31, 32767]], out = bands.map(() => ({ n: 0, max: 0, sum: 0 }));
    let front = [];
    for (let g = 0; g < G; g++) if (C.sea[g] !== was.sea[g]) { ring[g] = 0; front.push(g); }
    for (let r = 1; front.length; r++) {
        const next = [];
        for (const g of front) {
            const j = Math.floor(g / w), i = g % w;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                const jj = j + dj;
                if (jj < 0 || jj >= h) continue;
                const q = jj * w + (i + di + w) % w;
                if (ring[q] < 0) { ring[q] = r; next.push(q); }
            }
        }
        front = next;
    }
    for (let g = 0; g < G; g++) {
        const d = Math.abs(C.T.year[g] - was.T[g]), r = ring[g] < 0 ? 32767 : ring[g], b = bands.findIndex(([lo, hi]) => r >= lo && r <= hi);
        out[b].n++; out[b].sum += d; if (d > out[b].max) out[b].max = d;
    }
    return { changed: out[0].n, dTbyRing: Object.fromEntries(bands.map(([lo, hi], k) => [`${lo}-${hi}`, { cells: out[k].n, meanC: +(out[k].sum / Math.max(1, out[k].n)).toFixed(3), maxC: +out[k].max.toFixed(2) }])) };
}

/** The mesh's positions displaced by a smooth noise field (km-sized waves, three octaves): a domain warp of everything read there. */
function warpPositions(mesh, seed, F) {
    const { xyz, numCells: n } = mesh, out = new Float32Array(3 * n), noise = new FastNoise((seed | 0) * 53 + 11), f = R / F.warpScaleKm, a = F.warpKm / R;
    for (let c = 0; c < n; c++) {
        const x = xyz[3 * c], y = xyz[3 * c + 1], w = xyz[3 * c + 2];
        const dx = noise.fbm(x * f + 1.3, y * f + 7.1, w * f + 4.2, 3, 0.5), dy = noise.fbm(x * f + 9.4, y * f + 2.6, w * f + 6.8, 3, 0.5), dz = noise.fbm(x * f + 5.7, y * f + 8.3, w * f + 0.9, 3, 0.5);
        let px = x + 1.6 * a * dx, py = y + 1.6 * a * dy, pz = w + 1.6 * a * dz;
        const l = Math.hypot(px, py, pz); px /= l; py /= l; pz /= l;
        out[3 * c] = px; out[3 * c + 1] = py; out[3 * c + 2] = pz;
    }
    return out;
}

/** Per month (12 fields each, on the climate grid): the share of a year's runoff that comes in that month, and how dry the
 *  month is (0 where rain meets its potential evaporation, or the ground is frozen; 1 without rain). The water ledger's
 *  months (climate/water.js) at the grid's land height: its snow, the year's Budyko evaporation run through the soil, and
 *  the spill's share through the ground draining back slowly. A place that runs no water of its own (no month thaws, or
 *  its rain all evaporates) times what reaches it from above — the ice's meltwater, a river passing — by its months'
 *  melt (°C above freezing), or, where none thaws, in its warmest month: the summer's. */
function runoffMonths(months, petM, G, F) {
    const out = Array.from({ length: 12 }, () => new Float32Array(G)), arid = Array.from({ length: 12 }, () => new Float32Array(G));
    const T12 = new Float64Array(12), P12 = new Float64Array(12), E12 = new Float64Array(12), liq = new Float64Array(12), R12 = new Float64Array(12), Ev = new Float64Array(12);
    const o = { soilMm: SOIL_MM, baseShare: 0, baseMonths: F.baseflowMonths };
    for (let g = 0; g < G; g++) {
        let Pyr = 0, Eyr = 0;
        for (let m = 0; m < 12; m++) {
            T12[m] = months.T[m * G + g]; P12[m] = Math.max(0, months.P[m * G + g]); E12[m] = Math.max(0, petM[m * G + g]);
            Pyr += P12[m]; Eyr += Math.max(5, E12[m]);
        }
        o.baseShare = F.baseflowShare * smooth(0.2, 1, Pyr / Eyr);
        snowYear(T12, P12, liq, F.snowMeltMmPerC);
        let L = 0, Ep = 0;
        for (let m = 0; m < 12; m++) { L += liq[m]; Ep += E12[m]; }
        waterMonths(liq, E12, fuEvaporation(L, Math.max(F.petMinMm, Ep), F.budykoW), o, R12, Ev);
        let sf = 0, warm = 0, top = 0;
        for (let m = 0; m < 12; m++) { sf += R12[m]; warm += Math.max(0, T12[m]); if (T12[m] > T12[top]) top = m; }
        for (let m = 0; m < 12; m++) {
            out[m][g] = sf > 0 ? R12[m] / sf : warm > 0 ? Math.max(0, T12[m]) / warm : m === top ? 1 : 0;
            const E = Math.max(5, E12[m]);
            arid[m][g] = T12[m] < 0 ? 0 : smooth(0, 1, (E - P12[m]) / E);
        }
    }
    return { share: out, arid };
}

/**
 * The thaw gate (lane polar, 2026-11-05): each cell's year of rain (mm, pAnn) split into the water that runs as liquid and
 * the snow kept. The climate's twelve months on its grid (T at the grid's land height, raised to sea level by the lapse
 * rate, then lowered to the cell's own height; P its share of the year by month): snow in the months below 0 °C, rain in
 * the others; the snow melts in the thawed months, F.snowMeltMmPerC per °C above freezing, up to all of it. Over a year in
 * its round (snow that falls is snow that melts, where it can): liquid = rain + min(snow, the thawed months' melt); the
 * rest is the store — a snowfield's and an ice sheet's accumulation. No month thaws: no liquid at all. Where every
 * winter's snow melts (most of the land), liquid is all the year's rain, and nothing changes. `land` (the climate's: 1
 * where the world ocean does not reach) takes a cell's own height below sea level too — a sunk basin's floor, warmer by
 * the lapse rate; the sea its surface. Without it, as before 2026-11-10: heights below 0 read as 0.
 * @returns {{rain: Float32Array, store: Float32Array, frozen: Uint8Array, thaw: Uint8Array, stats}}  liquid water and kept snow (mm/year
 *          per cell; NaN where pAnn is); frozen: 1 where no month thaws; thaw: the months at or above 0 °C; stats: the land's kept snow (km³ of water a year), its area and the never-thawing land's (km²)
 */
export function thawedWater(months, hLand, climGrid, G, z, pAnn, lat, lon, gamma, F, n, land = null) {
    const Tsl = new Float32Array(12 * G);
    for (let g = 0; g < G; g++) {
        const href = hLand[g] === hLand[g] ? hLand[g] : 0;
        for (let m = 0; m < 12; m++) Tsl[m * G + g] = months.T[m * G + g] + gamma * href;
    }
    const rain = new Float32Array(n), store = new Float32Array(n), frozen = new Uint8Array(n), thaw = new Uint8Array(n), bi = new Int32Array(4), bw = new Float64Array(4), cellKm2 = 4 * Math.PI * R * R / n;
    const T12 = new Float64Array(12), P12 = new Float64Array(12), liq = new Float64Array(12);
    let keptKm3 = 0, keptKm2 = 0, frozenKm2 = 0;
    for (let c = 0; c < n; c++) {
        const P = pAnn[c];
        if (!(P === P)) { rain[c] = store[c] = NaN; continue; }
        corners(climGrid, lat[c], lon[c], bi, bw);
        const h = gamma * (land ? (land[c] ? z[c] : 0) : Math.max(0, z[c]));
        let all = 0, melt = 0;
        for (let m = 0, o = 0; m < 12; m++, o += G) {
            T12[m] = Tsl[o + bi[0]] * bw[0] + Tsl[o + bi[1]] * bw[1] + Tsl[o + bi[2]] * bw[2] + Tsl[o + bi[3]] * bw[3] - h;
            P12[m] = Math.max(0, months.P[o + bi[0]] * bw[0] + months.P[o + bi[1]] * bw[1] + months.P[o + bi[2]] * bw[2] + months.P[o + bi[3]] * bw[3]);
            all += P12[m];
            if (T12[m] >= 0) { melt += T12[m]; thaw[c]++; }
        }
        const p = Math.max(0, P), k = all > 0 ? p / all : 0;
        for (let m = 0; m < 12; m++) P12[m] = all > 0 ? P12[m] * k : p / 12;
        store[c] = Math.min(p, snowYear(T12, P12, liq, F.snowMeltMmPerC)); rain[c] = p - store[c];
        if (!(melt > 0)) frozen[c] = 1;
        if (z[c] > 0) { if (store[c] > 0) { keptKm3 += store[c] * cellKm2 * 1e-6; keptKm2 += cellKm2; } if (frozen[c]) frozenKm2 += cellKm2; }
    }
    return { rain, store, frozen, thaw, stats: { keptKm3: Math.round(keptKm3), keptKm2: Math.round(keptKm2), frozenKm2: Math.round(frozenKm2) } };
}

/**
 * The kept snow's way out (lane polar, 2026-11-05): a steady-state ice sheet — its accumulation leaves it as fast as it
 * falls, by melt where the ice flows down to ground warm enough (the ablation zone) or by calving where it reaches the sea
 * (the mass balance of a sheet in its round: Cuffey & Paterson 2010, The Physics of Glaciers, ch. 4). Each cell's kept
 * snow (thawedWater's store, mm/year) goes down the land's steepest fall, gathering, from cell to kept cell, until it
 * reaches a cell whose own snow all melts — there it melts, and runs off from that cell, added to its runoff — or the sea
 * (the world ocean: calved, booked, no river; a sea cut off from it is land's, and takes the meltwater). A pit in the bed fills and spills over its lowest rim; what
 * a big frozen basin keeps (a flood of more than PIT_CELLS cells finds no way out) is held: booked too.
 * A shortcut, for the ice's own mass budget (model review U9) to replace: no ice dynamics (the ice takes the bed's fall,
 * not its surface's, and its divides are the bed's); the margin's melt is not limited by its warmth (all of it melts at
 * the first such cell, one cell wide); no time (the sheet neither grows nor shrinks).
 * @returns {{meltMmKm2: number, calvedMmKm2: number, heldMmKm2: number}}  the year's ice melted, calved and held (mm·km²; ×1e-6: km³)
 */
function iceDischarge(mesh, z, ocean, store, runoff, cellKm2) {
    const { adjOffset, adjList, numCells: n } = mesh;
    let k = 0;
    for (let c = 0; c < n; c++) if (store[c] > 0 && !ocean[c]) k++;
    const kept = new Int32Array(k), flux = new Float64Array(n);
    k = 0;
    for (let c = 0; c < n; c++) if (store[c] > 0 && !ocean[c]) { kept[k++] = c; flux[c] = store[c] * cellKm2; }
    kept.sort((a, b) => z[b] - z[a]);
    let melt = 0, calved = 0, held = 0;
    const pits = [], pitFlux = [];
    for (let i = 0; i < k; i++) {
        const c = kept[i], f = flux[c];
        let low = -1;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (z[y] < z[c] && (low < 0 || z[y] < z[low])) low = y; }
        if (low < 0) { pits.push(c); pitFlux.push(f); }
        else if (ocean[low]) calved += f;
        else if (store[low] > 0) flux[low] += f;
        else { runoff[low] += f / cellKm2; melt += f; }
    }
    // (a pit in the bed: the ice fills it and goes on over its lowest rim — a small flood from the pit, lowest cell first,
    // until a cell below the level reached: from there down the steepest fall to where it melts or the sea, or into another
    // pit, filled the same way. What a flood of more than PIT_CELLS cells has not let out stays held)
    const seen = new Int32Array(n).fill(-1), heap = new MinHeap(1 << 10), PIT_CELLS = 4096;
    for (let p = 0; p < pits.length; p++) {
        const f = pitFlux[p];
        let at = pits[p], end = -1, budget = PIT_CELLS;
        while (end < 0 && budget > 0) {
            heap.size = 0; heap.push(z[at], at); seen[at] = p;
            let level = -Infinity, out = -1;
            while (heap.size && budget-- > 0) {
                const x = heap.pop();
                if (z[x] < level) { out = x; break; }
                if (z[x] > level) level = z[x];
                for (let j = adjOffset[x]; j < adjOffset[x + 1]; j++) { const y = adjList[j]; if (seen[y] !== p) { seen[y] = p; heap.push(z[y], y); } }
            }
            if (out < 0) break;
            let x = out;                                                // (down from the rim's far side)
            for (;;) {
                if (ocean[x]) { end = -2; break; }
                if (!(store[x] > 0)) { end = x; break; }
                let low = -1;
                for (let j = adjOffset[x]; j < adjOffset[x + 1]; j++) { const y = adjList[j]; if (z[y] < z[x] && (low < 0 || z[y] < z[low])) low = y; }
                if (low < 0) break;
                x = low; seen[x] = p;
            }
            if (end === -1) { if (x === at) break; at = x; }            // (another pit: fill it too)
        }
        if (end === -2) calved += f;
        else if (end >= 0) { runoff[end] += f / cellKm2; melt += f; }
        else held += f;
    }
    return { meltMmKm2: melt, calvedMmKm2: calved, heldMmKm2: held };
}

/**
 * The land's potential evaporation for each month on the climate's grid (mm, 12 × G): the rain stage's Priestley–Taylor
 * rate at its anchors (rain.js PET), made months as the months' temperature is (seasons.js; linear, at least 0). What it
 * skips: it is the grid's, at the grid's land height (a cell above or below it keeps its grid's — the cold of height
 * lowers Δ/(Δ + γ), but its sunnier, thinner air raises the radiation); no wind or dryness of the air (Penman's
 * aerodynamic term: a desert's air evaporates more than its sunlight alone allows, ~1.3–1.5 × Priestley–Taylor in arid
 * lands, Shuttleworth 1993). Without the rain stage's PET (an anchor source with no physics) the same law from the
 * month's sunlight and temperature (climate/water.js monthPET).
 */
export function potentialMonths(res, G, F) {
    const PET = res.stages?.rain?.PET, out = new Float32Array(12 * G);
    if (!PET) {
        const w = res.grid.w, h = res.grid.h;
        for (let g = 0; g < G; g++) { const la = 90 - (Math.floor(g / w) + 0.5) * 180 / h; for (let m = 0; m < 12; m++) out[m * G + g] = monthPET(la, m, res.months.T[m * G + g]); }
        return out;
    }
    const K = res.anchorMonths.length, M = interpolationMatrix(K, res.anchorMonths[0], 0);
    for (let g = 0; g < G; g++) for (let m = 0; m < 12; m++) {
        let e = 0;
        for (let k = 0; k < K; k++) e += M[m * K + k] * PET[k * G + g];
        out[m * G + g] = Math.max(0, e);
    }
    return out;
}

/** The four grid points around (lat, lon) and their bilinear weights (as bilinear). */
export function corners(g, lat, lon, bi, bw) {
    const { w, h } = g, step = 180 / h;
    const x = (lon + 180) / step - 0.5, y = Math.max(0, Math.min(h - 1, (90 - lat) / step - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i0 = ((x0 % w) + w) % w, i1 = i0 + 1 === w ? 0 : i0 + 1, j1 = y0 + 1 < h ? y0 + 1 : y0;
    bi[0] = y0 * w + i0; bi[1] = y0 * w + i1; bi[2] = j1 * w + i0; bi[3] = j1 * w + i1;
    bw[0] = (1 - fx) * (1 - fy); bw[1] = fx * (1 - fy); bw[2] = (1 - fx) * fy; bw[3] = fx * fy;
}

export function bilinear(g, field, lat, lon) {
    const { w, h } = g, step = 180 / h;
    const x = (lon + 180) / step - 0.5, y = Math.max(0, Math.min(h - 1, (90 - lat) / step - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i0 = ((x0 % w) + w) % w, i1 = i0 + 1 === w ? 0 : i0 + 1, j1 = y0 + 1 < h ? y0 + 1 : y0;
    return (1 - fx) * (1 - fy) * field[y0 * w + i0] + fx * (1 - fy) * field[y0 * w + i1] + (1 - fx) * fy * field[j1 * w + i0] + fx * fy * field[j1 * w + i1];
}

/** 1 on the world ocean: water below sea level joined to the largest body of it (terrain/world-ocean.js). A body below sea
 *  level cut off from it — a pit on a continent, a Caspian, a Mediterranean closed off — is not the sea: its level is its
 *  water balance's (finish-basins.js, finish-hydro.js). (Until 2026-10-27 any body over 250 000 km² holding water over
 *  1 km deep counted as sea: every enclosed ocean remnant in a supercontinent stood full at sea level.) */
export function oceanMask(mesh, z) { return worldOcean(mesh, z, 0).ocean; }

/**
 * The finished planet as an equirectangular picture of heights: w × w/2 pixels (rows north → south, columns from −180°
 * east), 16-bit metres, and the ocean (1) — for the page to paint and shade, and to export. Heights blended over the
 * mesh triangle under each pixel; `onRow` reports progress.
 */
export function finishRaster(mesh, z, ocean, w, onRow = null, lake = null, lakeLevel = null, climate = null) {
    const h = w >> 1, heightM = new Int16Array(w * h), sea = new Uint8Array(w * h), water = new Uint8Array(w * h), c3 = [0, 0, 0], w3 = [0, 0, 0];
    // (the climate's picture: at most as wide as the page's sharpest texture — every f-th pixel of the heights' — the
    // land's Köppen class (its weightiest land cell's), °C × 100 and mm a year (its land cells' weighted mean); the sea
    // −32768 °C, 0 mm. With the land's cover: its colours from space (the year, January, July: its land cells' weighted
    // mean) and its biome and snow (the weightiest's))
    const cw = climate ? Math.min(w, CLIMATE_WIDTH_MAX) : 0, ch = cw >> 1, f = cw ? w / cw : 0;
    const kop = cw ? new Uint8Array(cw * ch) : null, tA = cw ? new Int16Array(cw * ch).fill(-32768) : null, pA = cw ? new Uint16Array(cw * ch) : null;
    const sat = cw && climate.sat ? climate.sat.map(() => new Uint8Array(3 * cw * ch)) : null, cov = sat ? new Uint8Array(cw * ch) : null, s3 = [0, 0, 0];
    const mottle = sat ? new FastNoise(climate.mottleSeed ?? 0) : null, flowPx = sat && climate.flow ? new Float32Array(cw * ch) : null;
    const youngPx = sat && climate.young ? new Uint8Array(cw * ch) : null;
    const ripPx = sat && climate.ripSat ? climate.ripSat.map(() => new Uint8Array(3 * cw * ch)) : null;
    // (and the land's measures beyond Köppen, cell-stats.js bytes — the weightiest land cell's)
    const statPx = cw && climate.stats ? Object.fromEntries(STAT_KEYS.map(k => [k, new Uint8Array(cw * ch)])) : null;
    // (each column's longitude's cosine and sine, once)
    const cosLon = new Float64Array(w), sinLon = new Float64Array(w);
    for (let px = 0; px < w; px++) { const lon = ((px + 0.5) / w - 0.5) * 2 * Math.PI; cosLon[px] = Math.cos(lon); sinLon[px] = Math.sin(lon); }
    for (let py = 0; py < h; py++) {
        const lat = (0.5 - (py + 0.5) / h) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
        for (let px = 0; px < w; px++) {
            locate(mesh, cl * cosLon[px], cl * sinLon[px], sl, c3, w3);
            const i = py * w + px, v = w3[0] * z[c3[0]] + w3[1] * z[c3[1]] + w3[2] * z[c3[2]];
            heightM[i] = Math.max(-32000, Math.min(32000, Math.round(v * 1000)));
            const near = w3[0] >= w3[1] && w3[0] >= w3[2] ? c3[0] : w3[1] >= w3[2] ? c3[1] : c3[2];
            sea[i] = ocean[near];
            // (a lake: under its level, where one of the pixel's cells is lake — its shore as crisp as the heights)
            if (lake) for (let j = 0; j < 3; j++) { const c = c3[j]; if (lake[c] && w3[j] > 0.2 && v < lakeLevel[c]) { water[i] = lake[c]; break; } }
            if (cw && !sea[i] && px % f === 0 && py % f === 0) {
                let ws = 0, t = 0, p = 0, best = -1, bw = 0;
                for (let j = 0; j < 3; j++) {
                    const c = c3[j];
                    if (ocean[c] || !(climate.tAnnual[c] === climate.tAnnual[c])) continue;
                    ws += w3[j]; t += w3[j] * climate.tAnnual[c]; p += w3[j] * climate.pAnnual[c];
                    if (w3[j] > bw) { bw = w3[j]; best = c; }
                }
                if (best >= 0) {
                    const k = (py / f) * cw + px / f;
                    kop[k] = climate.koppen[best]; tA[k] = Math.round(100 * t / ws); pA[k] = Math.min(65535, Math.round(p / ws));
                    if (statPx) for (const key of STAT_KEYS) statPx[key][k] = climate.stats[key][best];
                    if (sat) {
                        // (a fine mottling of the brightness, per pixel — the same in every view)
                        const mf = fineMottle(cl * cosLon[px], cl * sinLon[px], sl, mottle);
                        for (let v = 0; v < 3; v++) {
                            const S = climate.sat[v];
                            s3[0] = s3[1] = s3[2] = 0;
                            for (let j = 0; j < 3; j++) {
                                const c = c3[j];
                                if (ocean[c] || !(climate.tAnnual[c] === climate.tAnnual[c])) continue;
                                s3[0] += w3[j] * S[3 * c]; s3[1] += w3[j] * S[3 * c + 1]; s3[2] += w3[j] * S[3 * c + 2];
                            }
                            const o = 3 * k, D = sat[v];
                            D[o] = Math.min(255, Math.round(mf * s3[0] / ws)); D[o + 1] = Math.min(255, Math.round(mf * s3[1] / ws)); D[o + 2] = Math.min(255, Math.round(mf * s3[2] / ws));
                        }
                        cov[k] = climate.cover[best];
                        if (ripPx) for (let v = 0; v < 3; v++) {
                            const S = climate.ripSat[v];
                            s3[0] = s3[1] = s3[2] = 0;
                            for (let j = 0; j < 3; j++) { const c = c3[j]; if (ocean[c] || !(climate.tAnnual[c] === climate.tAnnual[c])) continue; s3[0] += w3[j] * S[3 * c]; s3[1] += w3[j] * S[3 * c + 1]; s3[2] += w3[j] * S[3 * c + 2]; }
                            const o = 3 * k, D = ripPx[v];
                            D[o] = Math.round(mf * s3[0] / ws); D[o + 1] = Math.round(mf * s3[1] / ws); D[o + 2] = Math.min(255, Math.round(mf * s3[2] / ws));
                        }
                        // (the flow: the land cells' log-area, the most of the three — so a valley's line stays a line)
                        if (flowPx) { let fl = 0; for (let j = 0; j < 3; j++) { const c = c3[j]; if (!ocean[c] && w3[j] > 0.15) fl = Math.max(fl, climate.flow[c]); } flowPx[k] = fl; }
                        if (youngPx) { let yg = 0; for (let j = 0; j < 3; j++) { const c = c3[j]; if (!ocean[c]) yg += w3[j] * climate.young[c]; } youngPx[k] = Math.round(yg / ws); }
                    }
                }
            }
        }
        if (onRow && (py & 63) === 0) onRow(py / h);
    }
    // (the terrain on the satellite picture: rock where steep, slopes and valleys in dry country — from the heights)
    if (sat) terrainLook({ w: cw, h: ch, sat: { year: sat[0], jan: sat[1], jul: sat[2] }, cover: cov, tAnnual: tA, pAnnual: pA, koppen: kop, flow: flowPx, young: youngPx, noise: mottle, rivers: climate.rivers, water: lake ? water : null, ripSat: ripPx ? { year: ripPx[0], jan: ripPx[1], jul: ripPx[2] } : null }, heightM, w);
    return { w, h, heightM, ocean: sea, water, climate: cw ? { w: cw, h: ch, koppen: kop, tAnnual: tA, pAnnual: pA, ...(statPx ? { stats: statPx } : {}), ...(sat ? { sat: { year: sat[0], jan: sat[1], jul: sat[2] }, cover: cov } : {}) } : null };
}

/** The widest climate picture a finish makes: the page's sharpest texture (finer would not be seen). */
const CLIMATE_WIDTH_MAX = 4096;
