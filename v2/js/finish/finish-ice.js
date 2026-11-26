// F3 — the last ice age. Its ice sheets grown by the ice's own flow under the climate of a glacial epoch (glacialSheets,
// below: the planet's orbit and the air's CO2 at the glacial maximum, the sea lowered by the ice's volume; gpu/ice-sheet.js,
// gpu/ice-balance.js — lane iceage B2, 2026-11-25; until then a prescribed cooling and drying, a snowline rule and a plastic
// sheet's thickness). Where ice gathered and flowed it cut troughs — U-shaped valleys along its paths, below the sea where
// it reached the sea (fjords) — scoured hollows into the bed under the sheets (lake districts on the shields), left
// moraines at its farthest reach and outwash beyond; then it melted, and the land it pressed down is still sunk,
// rebounding (Hudson Bay, the Baltic).

import { spreadKm } from '../core/min-heap.js';
import { FastNoise } from '../core/fast-noise.js';
import { outburstFloods } from './finish-floods.js';
import { mapOnto, meanOnto, carry } from '../core/mesh-maps.js';
import { stiffnessKm4, solvePlateCPU } from '../gpu/flexure.js';
import { satSlope, PSYCHRO } from '../climate/rain.js';
import { terrainMesh } from '../terrain/terrain-mesh.js';
import { worldOcean } from '../terrain/world-ocean.js';
import { planetClimateAsync } from '../climate/climate.js';
import { CORE_DEFAULTS, seaLevelGrid } from '../climate/core.js';
import { systemOf, EARTH_CYCLE } from '../climate/planet-system.js';
import { climateSolverKit } from '../gpu/climate-solver.js';
import { cellClimateGPU } from '../gpu/climate-cells.js';
import { iceSheetGPU, ICE } from '../gpu/ice-sheet.js';
import { iceBalanceGPU } from '../gpu/ice-balance.js';
import { readBack } from '../gpu/gpu-device.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const R = 6371, LAPSE = 6.5, ICE_SHEET_KM2 = 5e4;

/** Priestley–Taylor's potential evaporation in air at `cold` °C over that at `warm` (Δ/(Δ + γ), the sunlight the same —
 * rain.js; the summer's temperatures, when the year's evaporation mostly happens). */
/** The summer temperature (°C) at the equilibrium line for a year's precipitation P (mm) — Ohmura et al. 1992. */
const elaTemp = P => (-296 + Math.sqrt(Math.max(0, 296 * 296 - 36 * (645 - P)))) / 18;

const ptCooled = (cold, warm) => { const a = satSlope(cold), b = satSlope(warm); return (a / (a + PSYCHRO)) / (b / (b + PSYCHRO)); };


// ── The ice age's ice sheets, from its climate (lane iceage B2 (iv), 2026-11-25) ──
// The moment's ground under a glacial planet-and-star system: the same planet and star, at an epoch of the orbit's cycle
// (Berger 1978; Earth's when the system has none of its own — "a world that could produce Earth") and of the air's CO2
// (planet-system.js: Bereiter et al. 2015), its sheets grown by the ice's own flow (gpu/ice-sheet.js) under the mass balance
// the climate gives at the ice's surface (gpu/ice-balance.js), coupled asynchronously as paleo ice-sheet models are
// (CLIMBER–SICOPOLIS, Ganopolski et al. 2010; Abe-Ouchi et al. 2013): a climate on the ground and its sheets as they stand,
// then the sheets run F.iceRoundKyr under it, the balance recomputed from their surface every F.iceBalanceEveryYr, round by
// round. The climate sees the sheets (core.js sheetFrac: their albedo; their surface the ground's height) and the sea they
// lowered (the ice's volume above flotation, ρ_i/ρ_sea of it spread over the moment's sea: the sea's level, and the shelves it
// bares the climate's land); the bed sinks under the ice by Airy's share (ρ_i/ρ_m: the equilibrium of the elastic-lithosphere
// relaxing-asthenosphere model, Le Meur & Huybrechts 1996 — the rounds are its few-kyr relaxation and longer).
// The rounds: first an inception at a cold-summer epoch (F.iceInceptionKyr: Earth's 116 ka — low obliquity, the northern
// summer at aphelion), so the climate takes the glacial branch of its two steady states (ice where summers once failed to
// melt the snow keeps itself: Calov & Ganopolski 2005), then rounds at the glacial maximum's epoch (F.iceMaxKyr: 21 ka) until steady (F.iceSteadyFrac), within the glacial's time.
// Limits: an equilibrium, not the cycle's history (the sheets as they stand at the end, with no record of their growth or of
// where the ice slid); the ice's own limits (gpu/ice-sheet.js: no sliding, no shelves, no calving law) and the balance's
// (gpu/ice-balance.js: degree days); the climate on the ice mesh (F.iceMeshCells, ~61 km at 160K: the paleo models' own resolution);
// no ocean circulation change beyond the climate's own (no AMOC shift); the sea's level one number (no sea-level fingerprint).
/**
 * @param {Object} ctx  { device, mesh, z (km: the moment's ground, not changed), climateOptions (the finish's), onRound? }
 * @returns {Promise<{ ice: Uint8Array, H: Float32Array, smb: Float32Array, uDef: Float32Array, uSlide: Float32Array,
 *   warmSl: Float32Array, rain: Float32Array, seaKm: number, rounds: Object[], ms: number }>}  on `mesh`: where the ice stood,
 *   its thickness (km) over the moment's ground, its mass balance (m of ice a year), its surface's speed by deformation and its
 *   bed's by sliding (m/a, the ice mesh's cell's), the glacial climate's warmest month at the glacial sea's level (°C) and its year's
 *   precipitation (mm, the climate's grid); the glacial sea's level (km against the moment's)
 */
export async function glacialSheets({ device, mesh, z, climateOptions = {}, onRound = null, probe = null }, F) {
    const t0 = performance.now(), nF = mesh.numCells;
    const im = nF <= 1.2 * F.iceMeshCells ? mesh : terrainMesh(F.iceMeshCells), n = im.numCells, M = im === mesh ? null : mapOnto(im, mesh);
    const bed0 = M ? meanOnto(M, z, n) : Float32Array.from(z), x = im.xyz;
    const lat = new Float32Array(n), lon = new Float32Array(n);
    for (let c = 0; c < n; c++) { lat[c] = Math.asin(x[3 * c + 2]) * 180 / Math.PI; lon[c] = Math.atan2(x[3 * c + 1], x[3 * c]) * 180 / Math.PI; }
    const flt = ICE.rhoIce / ICE.rhoSea, sink = ICE.rhoIce / ICE.rhoMantle, gamma = CORE_DEFAULTS.lapseRateCPerKm;
    const bedM = Float32Array.from(bed0, v => 1000 * v), bed = bedM.slice();
    const sheet = await iceSheetGPU(device, { mesh: im, bed, smb: null, sea: 0 }), area = sheet.area;
    // (the moment's sea, whose area the ice's water leaves)
    let seaArea = 0;
    { const o = worldOcean(im, bed0, 0).ocean; for (let c = 0; c < n; c++) if (o[c]) seaArea += area[c]; }
    const sys0 = systemOf(climateOptions.system), cycle = sys0.orbit.cycle ?? EARTH_CYCLE;
    // (the plan: a round at the inception, then rounds at the maximum until the ice is steady — or the glacial's time is spent)
    const budgetKyr = F.iceBudgetKyr ?? F.iceInceptionKyr - F.iceMaxKyr;      // (iceBudgetKyr: a study's longer run, unset in the finish)
    let H = new Float32Array(n), sea = 0, climate = null, spentKyr = 0, lastVol = 0, steady = false;
    const rounds = [], elevKm = new Float32Array(n), iceMask = new Uint8Array(n), land = new Uint8Array(n);
    while (spentKyr < budgetKyr && !steady) {
        const r = { epochKyr: rounds.length ? F.iceMaxKyr : F.iceInceptionKyr, kyr: Math.min(F.iceRoundKyr, budgetKyr - spentKyr) };
        spentKyr += r.kyr;
        const tr = performance.now();
        // (the ground the climate sees: the ice's surface where it stands grounded, the bed elsewhere, against the glacial sea;
        // its land all the world ocean at that sea does not reach)
        for (let c = 0; c < n; c++) {
            const g = bed[c] >= sea || H[c] * flt > sea - bed[c];
            elevKm[c] = ((g ? bed[c] + H[c] : bed[c]) - sea) / 1000; iceMask[c] = g && H[c] > 0 ? 1 : 0;
        }
        const o = worldOcean(im, elevKm, 0).ocean;
        for (let c = 0; c < n; c++) land[c] = o[c] ? 0 : 1;
        const system = { ...sys0, orbit: { ...sys0.orbit, cycle }, epochKyr: r.epochKyr }, opts = { ...climateOptions, system };
        const solver = await climateSolverKit(device);
        let res;
        try { res = await planetClimateAsync({ xyz: x, elevKm, axes: 'z-up', land, ice: iceMask }, { ...opts, cells: false, solver }); }
        finally { solver.release(); }
        const cell = await cellClimateGPU(device, res, x, elevKm, land, opts);
        const pAnn = Float32Array.from(cell.pAnnual, p => (p === p ? Math.min(p, F.rainMaxMm) : NaN));
        const { Tsl, P } = seaLevelGrid(res.grid, res.surface, res.months, gamma);
        climate = { grid: res.grid, Tsl, P };
        // (the sheets under it: the bed sunk by the ice as it stood, the sea as it stood)
        sheet.setBed(bed); sheet.setSea(sea);
        const bal = await iceBalanceGPU(device, { sheet, grid: res.grid, Tsl, P, lat, lon, pAnn, gamma, datum: sea });
        // (a study's look at the balance on the ground as the round starts: probe({ round, epochKyr, force (bed, balance m/a,
        // surface's year-mean °C, -), H, lat, lon, sea }) — check-iceage-earth's inception diagnosis)
        if (probe) {
            const e = device.createCommandEncoder(); bal.encode(e); device.queue.submit([e.finish()]);
            probe({ round: rounds.length, epochKyr: r.epochKyr, force: await readBack(device, sheet.force), H, lat, lon, sea, pAnn });
        }
        const run = await sheet.run(1000 * r.kyr, { each: e => bal.encode(e), everyYears: F.iceBalanceEveryYr });
        bal.destroy();
        H = await sheet.readH();
        // (the sea lowered by the ice above flotation; the bed sunk by the grounded ice's weight)
        let above = 0, km2 = 0, vol = 0;
        for (let c = 0; c < n; c++) {
            if (!(H[c] > 0)) { bed[c] = bedM[c]; continue; }
            const g = bed[c] >= sea || H[c] * flt > sea - bed[c];
            if (g) above += area[c] * (H[c] - Math.max(0, sea - bed[c]) / flt);
            km2 += area[c] / 1e6; vol += area[c] * H[c] / 1e9;
            bed[c] = bedM[c] - (g ? sink * H[c] : 0);
        }
        sea = -above * flt / seaArea;
        // (steady: a round at the maximum that changed the ice's volume by less than iceSteadyFrac)
        const change = lastVol > 0 ? Math.abs(vol - lastVol) / lastVol : Infinity;
        steady = rounds.length > 0 && change < F.iceSteadyFrac; lastVol = vol;
        const rec = { epochKyr: r.epochKyr, kyr: r.kyr, steps: run.steps, iceMkm2: km2 / 1e6, iceMkm3: vol / 1e6, seaM: sea, change, steady, ms: Math.round(performance.now() - tr) };
        rounds.push(rec); onRound?.(rec);
    }
    // (the last balance, from the ice as it ends)
    const lastBal = await iceBalanceGPU(device, { sheet, grid: climate.grid, Tsl: climate.Tsl, P: climate.P, lat, lon, gamma, datum: sea });
    { const e = device.createCommandEncoder(); lastBal.encode(e); device.queue.submit([e.finish()]); }
    const force = await readBack(device, sheet.force), speed = await sheet.speeds();
    lastBal.destroy(); sheet.destroy();
    // ── down to the finish's mesh: the ice where its cell of the ice mesh holds ice, its surface the ice mesh's (smooth at its
    // scale, as a sheet's is), its thickness that surface over the moment's ground sunk as the ice mesh's bed sank — the valleys
    // under it filled, the peaks through it nunataks ──
    const S = new Float32Array(n), down = new Float32Array(n), smbI = new Float32Array(n), afloat = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
        const g = bed[c] >= sea || H[c] * flt > sea - bed[c];
        S[c] = g ? bed[c] + H[c] : sea + H[c] * (1 - flt); down[c] = bedM[c] - bed[c]; smbI[c] = force[4 * c + 1]; afloat[c] = g ? 0 : 1;
    }
    const iceF = new Uint8Array(nF), HF = new Float32Array(nF), smbF = new Float32Array(nF), warmSl = new Float32Array(nF), rainF = new Float32Array(nF);
    // (the ice's speeds, m/a, from its cell of the ice mesh: the surface's by deformation, the bed's by sliding — what a
    // trough's erosion reads)
    const uDefF = new Float32Array(nF), uSlideF = new Float32Array(nF);
    const Sf = new Float32Array(nF), Df = new Float32Array(nF);
    if (M) { carry(M, S, Sf); carry(M, down, Df); carry(M, smbI, smbF); } else { Sf.set(S); Df.set(down); smbF.set(smbI); }
    for (let c = 0; c < nF; c++) {
        const k = M ? M.nearest[c] : c;
        if (!(H[k] > 0)) continue;
        uDefF[c] = speed[2 * k]; uSlideF[c] = speed[2 * k + 1];
        // (a floating front's ice is its own thickness, the water under it not the ice's)
        if (afloat[k]) { iceF[c] = 1; HF[c] = H[k] / 1000; continue; }
        const h = Sf[c] - (1000 * z[c] - Df[c]);
        if (h > 0) { iceF[c] = 1; HF[c] = h / 1000; }
    }
    // (the glacial climate's warmest month at the glacial sea's level, and its year's precipitation, on the grid)
    {
        const { grid, Tsl, P } = climate, G = grid.size, warmG = new Float32Array(G).fill(-Infinity), yearG = new Float32Array(G), cg = { w: grid.w, h: grid.h };
        for (let g = 0; g < G; g++) for (let m = 0; m < 12; m++) { warmG[g] = Math.max(warmG[g], Tsl[m * G + g]); yearG[g] += Math.max(0, P[m * G + g]); }
        const xf = mesh.xyz;
        for (let c = 0; c < nF; c++) {
            const la = Math.asin(xf[3 * c + 2]) * 180 / Math.PI, lo = Math.atan2(xf[3 * c + 1], xf[3 * c]) * 180 / Math.PI;
            warmSl[c] = bilinearG(cg, warmG, la, lo); rainF[c] = bilinearG(cg, yearG, la, lo);
        }
    }
    return { ice: iceF, H: HF, smb: smbF, uDef: uDefF, uSlide: uSlideF, warmSl, rain: rainF, seaKm: sea / 1000, rounds, ms: Math.round(performance.now() - t0) };
}
// (finish.js bilinear's, here so the ice needs nothing of finish.js: a 1° grid's field at a point)
function bilinearG(g, field, lat, lon) {
    const { w, h } = g, step = 180 / h;
    const x = (lon + 180) / step - 0.5, y = Math.max(0, Math.min(h - 1, (90 - lat) / step - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i0 = ((x0 % w) + w) % w, i1 = i0 + 1 === w ? 0 : i0 + 1, j1 = y0 + 1 < h ? y0 + 1 : y0;
    return (1 - fx) * (1 - fy) * field[y0 * w + i0] + fx * (1 - fy) * field[y0 * w + i1] + (1 - fx) * fy * field[j1 * w + i0] + fx * fy * field[j1 * w + i1];
}

/**
 * @param {Object} ctx  { mesh, z (km, changed in place), lat, lon (degrees), warmSl (the moment's warmest month at sea level,
 *                        °C), rain (mm/year; NaN at sea), grid (LatLonGrid), cellKm2, seed, soft, runoff, pet (mm/year; the
 *                        moment's — for the dammed lakes' water balance; without them every dammed lake fills), land
 *                        (optional: the climate's — 1 where the world ocean does not reach), sheet (glacialSheets' answer:
 *                        the ice, its thickness and balance, the glacial climate) }
 * @returns {{ice: Uint8Array, margin: Uint8Array, iceKm2: number, sheets: number, basin: Float32Array, floods: Object}}
 *          basin: how deep (km) the ice dug each cell's basin; floods: finish-floods.js
 */
export function lastIceAge(ctx, F) {
    const { mesh, z, lat, grid, cellKm2 } = ctx, n = mesh.numCells, { adjOffset, adjList, edgeKm, xyz } = mesh;
    // (the ice: grown — ctx.sheet, glacialSheets' answer, when F.iceGrown — or the prescribed ice age's: finish-config.js)
    const head = ctx.sheet ? grownIce(ctx, F) : prescribedIce(ctx, F), { ice, acc, water, sizes, seaKm, sheetKm2 } = head;
    let iceCells = 0;
    for (let c = 0; c < n; c++) iceCells += ice[c];
    if (!iceCells) return { ice, margin: new Uint8Array(n), iceKm2: 0, sheets: 0, basin: new Float32Array(n), floods: outburstFloods({ mesh, z, ice, S: null, cellKm2, seed: ctx.seed, water, seaKm }, F) };
    // ── the distance to the margin; the ice's thickness and surface ──
    const toEdge = new Float32Array(n).fill(Infinity);
    for (let c = 0; c < n; c++) if (ice[c]) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (!ice[adjList[k]]) { toEdge[c] = 0.5 * edgeKm; break; }
    spreadKm(mesh, toEdge, { canEnter: (a, b) => ice[b] === 1 });
    const { H, S } = head.surface(toEdge);
    // ── the ice's flow, steered by the bed (the land's valleys) with a little of its surface's pull; its flux, the
    // snowfield area upstream ──
    const route = new Float32Array(n), iceList = [];
    for (let c = 0; c < n; c++) if (ice[c]) { route[c] = z[c] + F.iceSteer * (S[c] - z[c]); iceList.push(c); }
    iceList.sort((a, b) => route[b] - route[a]);
    const down = new Int32Array(n).fill(-1), flux = new Float32Array(n);
    for (const c of iceList) {
        flux[c] += acc[c] ? cellKm2 : 0.15 * cellKm2;
        let best = -1, low = route[c];
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (ice[nb] && route[nb] < low) { low = route[nb]; best = nb; } }
        down[c] = best;
        if (best >= 0) flux[best] += flux[c];
    }
    // ── troughs: along the ice's paths, deeper and wider with its flux, U-shaped across (a coarse cell holding more
    // than a trough drops by the share of it the trough takes) ──
    const cut = new Float32Array(n), [f1, f2] = F.troughFluxKm2, lf1 = Math.log(f1), lf2 = Math.log(f2);
    for (const c of iceList) {
        if (flux[c] < f1) continue;
        // (sliding fast near the margin, frozen to the bed deep inside a sheet)
        const s = smooth(lf1, lf2, Math.log(flux[c])), wet = smooth(0.1, 0.6, S[c] - z[c]) * smooth(F.iceCutsWithinKm[0], F.iceCutsWithinKm[1], toEdge[c]);
        if (!(wet > 0)) continue;
        // (deeper in soft rock, shallower in hard: finish.js soft — terrain/records.js iceSoft)
        const rock = ctx.soft ? 1 + F.troughSoftGain * (ctx.soft[c] - 0.5) : 1;
        const depth = F.troughKm * (0.25 + 0.75 * s) * wet * rock, half = F.troughWidthKm[0] + (F.troughWidthKm[1] - F.troughWidthKm[0]) * s;
        const own = depth * Math.min(1, 2 * half / edgeKm);
        if (own > cut[c]) cut[c] = own;
        if (half > 0.5 * edgeKm) {                                   // (a trough wider than a cell reaches its neighbours)
            const x = xyz[3 * c], y = xyz[3 * c + 1], w = xyz[3 * c + 2];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k], r = R * Math.hypot(xyz[3 * nb] - x, xyz[3 * nb + 1] - y, xyz[3 * nb + 2] - w), u = r / half;
                if (u >= 1) continue;
                const d = depth * (1 - u ** 4);                        // (flat floor, steep walls)
                if (d > cut[nb]) cut[nb] = d;
            }
        }
    }
    // ── basins: where a lobe of the ice slid out over soft rock, it dug the rock out broadly, far below the land around —
    // the Great Lakes in the platform's shales at the shield's edge, the Baltic, the shield-edge lakes from Winnipeg to Great
    // Bear. By the ice's flux and how near its margin it slid, blurred to a basin's breadth, then deepest where the rock is
    // softest — the hard rims stand (the Niagara Escarpment between Huron and Georgian Bay) ──
    const soft = ctx.soft, basin = new Float32Array(n);
    if (soft && F.basinKm > 0) {
        const lobe = grid.blur(lobeFeed(grid, lat, ctx.lon, ice, acc, route), F.basinSmoothKm), lb1 = Math.log(F.basinFeedKm[0]), lb2 = Math.log(F.basinFeedKm[1]);
        // (on the lowlands the lobes spread over — the region's ground, not a valley floor in a range: the mountains' ice
        // carves troughs, above)
        const low = grid.blur(grid.average(lat, ctx.lon, z, c => z[c] > 0), F.basinLowBlurKm);
        // (no land within the blur — ice grounded on a shelf far out from any coast, the Barents Sea's — reads no average,
        // NaN: there the region's ground is the sea's floor, as low as lowland gets. A NaN let through poisons the cell's
        // height, and the outburst floods' priority floods with it: a NaN key breaks their heap's order, and lakes are
        // found held by no ice at all, half a world away)
        const lowAt = c => { const v = grid.at(low, lat[c], ctx.lon[c]); return v === v ? v : 0; };
        for (const c of iceList) {
            const L = grid.at(lobe, lat[c], ctx.lon[c]);
            if (!(L > 0)) continue;
            basin[c] = F.basinKm * smooth(lb1, lb2, Math.log(L)) * smooth(F.basinWithinKm[0], F.basinWithinKm[1], toEdge[c]) * smooth(F.basinLipKm[0], F.basinLipKm[1], toEdge[c]) * smooth(F.basinLowKm[0], F.basinLowKm[1], lowAt(c)) * (F.basinRim + (1 - F.basinRim) * soft[c] ** F.basinSoftPower);
        }
        // (an overdeepening is deep against its outlet, not against the land around: the ice dug below the lowest point of
        // the basin's rim, whichever way the land slopes — or the basins of a sheet's margin, on land falling toward its
        // snout, would only steepen the slope and hold no water. Each basin — the cells dug at least basinCoreKm, joined —
        // is cut its own depth and at least that below its rim's lowest ground, at most basinMaxCutKm)
        // (a basin open to the sea is a sound — the Baltic, Hudson Bay — dug as deep as it is; inland, a sill of ground the
        // ice did not dig, basinSillKm from the coast, holds its lakes: the St Lawrence below Ontario)
        const coast = [], seaHop = new Int32Array(n).fill(-1), sillHops = Math.round(F.basinSillKm / Math.sqrt(cellKm2));
        for (let c = 0; c < n; c++) if (z[c] < 0) { seaHop[c] = 0; coast.push(c); }
        for (let i = 0; i < coast.length; i++) { const c = coast[i]; if (seaHop[c] >= sillHops) continue;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (seaHop[nb] < 0) { seaHop[nb] = seaHop[c] + 1; coast.push(nb); } } }
        const sill = c => seaHop[c] >= 0;
        for (const c of iceList) if (sill(c) && z[c] >= 0) basin[c] = Math.min(basin[c], F.basinCoreKm * 0.5);
        // (a basin is a lobe's: one too big for a lobe — a whole low island under the ice, dug from coast to coast — is split
        // where it was dug deepest, its core raised until each part is at most basinMaxKm2; the cells left out are the ridges
        // between its lakes, dug only their own depth)
        const member = new Int32Array(n).fill(-1);
        let stamp = 0;
        const split = (list, core) => {
            const inList = ++stamp;
            for (const c of list) member[c] = inList;
            for (const s of list) {
                if (member[s] !== inList || !(basin[s] >= core)) continue;
                const part = ++stamp, cells = [s];
                member[s] = part;
                let deepest = basin[s];
                for (let i = 0; i < cells.length; i++) for (let k = adjOffset[cells[i]]; k < adjOffset[cells[i] + 1]; k++) {
                    const nb = adjList[k];
                    if (member[nb] === inList && basin[nb] >= core) { member[nb] = part; cells.push(nb); if (basin[nb] > deepest) deepest = basin[nb]; }
                }
                if (cells.length * cellKm2 > F.basinMaxKm2 && core * F.basinSplitStep < deepest) { split(cells, core * F.basinSplitStep); continue; }
                let rim = Infinity;
                for (const c of cells) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (member[nb] !== part && z[nb] < rim) rim = z[nb]; }
                for (const c of cells) basin[c] = Math.min(F.basinMaxCutKm, Math.max(basin[c], z[c] - rim + basin[c]));
            }
        };
        split(iceList.filter(c => !sill(c) && basin[c] >= F.basinCoreKm), F.basinCoreKm);
        for (const c of iceList) cut[c] += basin[c];
    }
    // ── scour under the sheets: hollows in the bed where the ice was thick (where the mesh can show them) ──
    const noise = new FastNoise((ctx.seed | 0) * 97 + 31), sf = R / F.scourScaleKm, show = smooth(2, 3.2, F.scourScaleKm / edgeKm);
    // ── then the ice melts: troughs and hollows cut, moraines and outwash at its farthest reach, the land still sunk ──
    const load = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        if (!ice[c]) continue;
        let d = cut[c];
        if (show > 0) {
            const v = noise.fbm(xyz[3 * c] * sf, xyz[3 * c + 1] * sf, xyz[3 * c + 2] * sf, 2, 0.5) * 1.6 - 0.15;
            if (v > 0) d += F.scourKm * show * smooth(0.4, 1.4, H[c]) * Math.min(1, v / 0.6);
        }
        z[c] -= d;
        load[c] = 0.3 * H[c];                                         // (ρ_ice / ρ_mantle × thickness)
    }
    // moraines on the first land past the ice, outwash plains a little beyond
    const margin = new Uint8Array(n), past = new Float32Array(n).fill(Infinity);
    for (let c = 0; c < n; c++) {
        if (ice[c] || !(z[c] > 0)) continue;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (ice[adjList[k]]) { margin[c] = 1; past[c] = 0; break; }
    }
    spreadKm(mesh, past, { canEnter: (a, b) => !ice[b] && z[b] > 0, maxKm: 60 });
    for (let c = 0; c < n; c++) {
        if (!(past[c] < 60)) continue;
        const ridge = F.moraineKm * Math.exp(-((past[c] / Math.max(6, edgeKm)) ** 2)), plain = 0.4 * F.moraineKm * (1 - past[c] / 60);
        z[c] += Math.max(ridge, plain);
    }
    // the rebound still to come: the ice's weight on the plate (gpu/flexure.js, on the history's mesh, Te from the column —
    // ctx.teSim): an ice sheet many flexural lengths wide sinks it almost as Airy would, a valley glacier narrower than one
    // hardly at all, and the rim beyond a sheet's edge bulges a little (Walcott 1970; Watts 2001 §6.3). Its trough holds
    // the ice whose weight is the load: the plate floats on the mantle alone
    {
        const sim = ctx.simMesh, M = mapOnto(sim, mesh), ns = sim.numCells;
        const B = Float64Array.from(ctx.teSim, t => stiffnessKm4(t)), s = new Float64Array(ns).fill(1);
        const { w, residual } = solvePlateCPU(sim, B, s, meanOnto(M, load, ns), { tol: 1e-3 });
        // (only the bend the solve resolved: it stops at a relative residual `residual` (≤ tol), so a deflection under that
        // share of the deepest is the iteration's error, not the plate's — far from any ice a sign-random fraction of a
        // millimetre. Lane coastsmooth P3, 2026-11-24: applied, it drowned 2,632 coast cells at |lat| < 40° on 243751@430 640K,
        // every one a delta plain standing at exactly 0 — the reason those now stand at mean high water, bayheadFill)
        let deepest = 0;
        for (let c = 0; c < ns; c++) deepest = Math.max(deepest, Math.abs(w[c]));
        const resolved = residual * deepest;
        const sink = new Float32Array(n); carry(M, w, sink);
        for (let c = 0; c < n; c++) if (Math.abs(sink[c]) > resolved) z[c] -= F.reboundLeft * sink[c];
    }
    // the lakes the ice dammed, and their floods (finish-floods.js): on the ground as the ice left it, the ice still standing
    const floods = outburstFloods({ mesh, z, ice, S, cellKm2, seed: ctx.seed, water, seaKm }, F);
    let sheets = 0;
    for (const a of sizes) if (a >= sheetKm2) sheets++;
    return { ice, margin, iceKm2: iceCells * cellKm2, sheets, basin, floods };
}

/** lastIceAge's ice, grown (F.iceGrown: ctx.sheet, glacialSheets' answer): the ice, its snowfields (its balance positive), the
 *  ice age's water, its pieces' sizes (a sheet ≥ ICE_SHEET_KM2), the glacial sea; its surface the ice's on the moment's ground. */
function grownIce(ctx, F) {
    const { mesh, z, lat, grid, cellKm2, sheet } = ctx, n = mesh.numCells, { adjOffset, adjList } = mesh;
    // ── the ice the climate grew (glacialSheets), its snowfields (where its balance is positive), and the glacial summer ──
    const ice = sheet.ice, H = sheet.H, acc = new Uint8Array(n), tS = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        if (ice[c] && sheet.smb[c] > 0) acc[c] = 1;
        tS[c] = sheet.warmSl[c] - LAPSE * (ice[c] ? Math.max(0, z[c] + H[c] - sheet.seaKm) : ctx.land?.[c] ? z[c] - sheet.seaKm : Math.max(0, z[c] - sheet.seaKm));
    }
    // (and the ice age's water, for the lakes the ice dams — finish-floods.js: the moment's runoff and rain scaled by the glacial
    // climate's precipitation over the moment's, the runoff only where the glacial summer thaws, the open water's evaporation
    // cooled with the air — Priestley–Taylor's Δ/(Δ + γ) at the glacial summer over the moment's, the sunlight the same)
    const water = ctx.runoff && ctx.pet ? { runoff: new Float32Array(n), rain: new Float32Array(n), pet: new Float32Array(n) } : null;
    if (water) {
        // (the moment's rain where the climate gave none — the sea, bare at the ice age on the shelves — the land's, blurred)
        const rainG = grid.blur(grid.average(lat, ctx.lon, ctx.rain, c => ctx.rain[c] === ctx.rain[c]), 150);
        for (let c = 0; c < n; c++) {
            const now = ctx.rain[c] === ctx.rain[c] ? ctx.rain[c] : grid.at(rainG, lat[c], ctx.lon[c]);
            const dry = now > 0 ? sheet.rain[c] / now : 1, warm = ctx.warmSl[c] - LAPSE * Math.max(0, z[c]);
            // (water runs off only where the summer thaws: snow on ground whose summer stays below freezing — under the ice
            // or on the cold dry ground between its lobes — stays snow and ice, or sublimes; a sheet's meltwater comes from
            // its ablation zone, the Laurentide's southern margin that fed Agassiz)
            water.runoff[c] = ctx.runoff[c] === ctx.runoff[c] && tS[c] > 0 ? ctx.runoff[c] * dry : 0;
            water.rain[c] = now > 0 ? now * dry : sheet.rain[c];
            // (the shelves the sea leaves bare had no land climate at the moment: NaN — finish-floods.js gives them their
            // lake's own)
            water.pet[c] = ctx.pet[c] > 0 ? Math.max(F.petMinMm, ctx.pet[c] * ptCooled(tS[c], Math.max(tS[c], warm))) : NaN;
        }
    }
    // ── the ice sheets: the ice's pieces at least an ice sheet's size (50 000 km²: the size that tells a sheet from an ice
    // cap, Benn & Evans 2010 §1.3) ──
    const comp = new Int32Array(n).fill(-1), sizes = [];
    for (let s = 0; s < n; s++) {
        if (!ice[s] || comp[s] >= 0) continue;
        const id = sizes.length, q = [s]; comp[s] = id;
        for (let i = 0; i < q.length; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const nb = adjList[k]; if (ice[nb] && comp[nb] < 0) { comp[nb] = id; q.push(nb); } }
        sizes.push(q.length * cellKm2);
    }
    const surface = () => { const S = new Float32Array(n); for (let c = 0; c < n; c++) if (ice[c]) S[c] = z[c] + H[c]; return { H, S }; };
    return { ice, acc, water, sizes, seaKm: sheet.seaKm, sheetKm2: ICE_SHEET_KM2, surface };
}

/** lastIceAge's ice, prescribed (F.iceGrown off — main's until lane iceage B2, kept as it was): the moment's climate cooled
 *  (more toward the poles) and dried, the sea F.iceSeaDropKm lower; ice where snow outlasts the summer (Ohmura's summer
 *  temperature at the equilibrium line, from the precipitation), flowing out past its snowline — a glacier's tongue, an ice
 *  sheet's lobes; its thickness a plastic ice sheet's (√ of the distance to its margin), its surface over the bed smoothed. */
function prescribedIce(ctx, F) {
    const { mesh, z, lat, warmSl, grid, cellKm2 } = ctx, n = mesh.numCells, { adjOffset, adjList } = mesh;
    // rain where the climate gave none (the sea, bare at the ice age on the shelves): the land's, blurred
    const rainG = grid.blur(grid.average(lat, ctx.lon, ctx.rain, c => ctx.rain[c] === ctx.rain[c]), 150);
    // ── the ice age's summer and snow, and where snow outlasts summer ──
    const tS = new Float32Array(n), snow = new Float32Array(n), acc = new Uint8Array(n);
    // (and the ice age's water, for the lakes the ice dams — finish-floods.js: the runoff and rain dried as the snow is, the
    // runoff only where the summer thaws, the open water's evaporation cooled with the air — Priestley–Taylor's Δ/(Δ + γ) at
    // the colder summer over today's, the sunlight the same)
    const water = ctx.runoff && ctx.pet ? { runoff: new Float32Array(n), rain: new Float32Array(n), pet: new Float32Array(n) } : null;
    for (let c = 0; c < n; c++) {
        const a = Math.abs(lat[c]) / 90, cold = F.iceColdEqC + (F.iceColdPoleC - F.iceColdEqC) * a ** 1.5;
        const P = (ctx.rain[c] === ctx.rain[c] ? ctx.rain[c] : grid.at(rainG, lat[c], ctx.lon[c])) * (1 - F.iceDrier * a);
        tS[c] = warmSl[c] - cold - LAPSE * (ctx.land?.[c] ? z[c] : Math.max(0, z[c]));
        snow[c] = P;
        if (water) {
            const dry = 1 - F.iceDrier * a;
            // (water runs off only where the summer thaws: snow on ground whose summer stays below freezing — under the ice
            // or on the cold dry ground between its lobes — stays snow and ice, or sublimes; a sheet's meltwater comes from
            // its ablation zone, the Laurentide's southern margin that fed Agassiz)
            water.runoff[c] = ctx.runoff[c] === ctx.runoff[c] && tS[c] > 0 ? ctx.runoff[c] * dry : 0;
            water.rain[c] = P === P ? P : 0;
            // (the shelves the sea leaves bare had no land climate at the moment: NaN — finish-floods.js gives them their
            // lake's own)
            water.pet[c] = ctx.pet[c] > 0 ? Math.max(F.petMinMm, ctx.pet[c] * ptCooled(tS[c], tS[c] + cold)) : NaN;
        }
        if (z[c] > -F.iceSeaDropKm && P > 80 && tS[c] < elaTemp(P)) acc[c] = 1;
    }
    // ── snowfields, and how far past its snowline each one's ice flows (by its size) ──
    const comp = new Int32Array(n).fill(-1), sizes = [];
    for (let s = 0; s < n; s++) {
        if (!acc[s] || comp[s] >= 0) continue;
        const id = sizes.length, q = [s]; comp[s] = id;
        for (let i = 0; i < q.length; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const nb = adjList[k]; if (acc[nb] && comp[nb] < 0) { comp[nb] = id; q.push(nb); } }
        sizes.push(q.length * cellKm2);
    }
    const reach = Float32Array.from(sizes, a => F.iceMarginC[0] + (F.iceMarginC[1] - F.iceMarginC[0]) * smooth(Math.log(F.iceSheetKm2[0]), Math.log(F.iceSheetKm2[1]), Math.log(a)));
    // ice spreads from its snowfields while the summer is not too warm for it (grounded on the shelf, not the deep sea)
    const ice = new Uint8Array(n), allow = new Float32Array(n).fill(-Infinity), q = [];
    for (let c = 0; c < n; c++) if (acc[c]) { ice[c] = 1; allow[c] = reach[comp[c]]; q.push(c); }
    for (let i = 0; i < q.length; i++) {
        const c = q[i];
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (ice[nb] || z[nb] < -F.iceGroundedKm || tS[nb] > elaTemp(snow[nb]) + allow[c]) continue;
            ice[nb] = 1; allow[nb] = allow[c]; q.push(nb);
        }
    }
    const surface = toEdge => {
        const bedG = grid.blur(grid.average(lat, ctx.lon, z, c => ice[c] === 1), 60), H = new Float32Array(n), S = new Float32Array(n);
        for (let c = 0; c < n; c++) {
            if (!ice[c]) continue;
            H[c] = Math.min(F.iceMaxKm, Math.sqrt(F.iceNyeKm * toEdge[c]));
            const bed = grid.at(bedG, lat[c], ctx.lon[c]);
            S[c] = Math.max(z[c] + 0.05, (bed === bed ? Math.max(bed, -F.iceSeaDropKm) : z[c]) + H[c]);
        }
        return { H, S };
    };
    return { ice, acc, water, sizes, seaKm: -F.iceSeaDropKm, sheetKm2: F.iceSheetKm2[1] * 0.3, surface };
}

/**
 * How much snowfield feeds each km of the ice's width (km² per km), on the grid: the ice routed there — not on the mesh,
 * whose flow lines split the ice into as many strands as it has cells across, so their fluxes would change with the
 * detail — down its routing surface (the bed, a little of the ice's own; `route`), each grid cell fed by its area, in full
 * where snow outlasts the summer and 0.15 of it where the ice only flows. NaN off the ice.
 */
function lobeFeed(grid, lat, lon, ice, acc, route) {
    const { w, h, step, size } = grid, isIce = c => ice[c] === 1;
    const R = grid.average(lat, lon, route, isIce), snow = grid.average(lat, lon, Float32Array.from(acc), isIce);
    const kmStep = 6371 * Math.PI / 180 * step, order = [], flux = new Float64Array(size), out = new Float32Array(size).fill(NaN);
    for (let g = 0; g < size; g++) {
        if (!(R[g] === R[g])) continue;
        const cos = Math.max(0.02, Math.cos((90 - (Math.floor(g / w) + 0.5) * step) * Math.PI / 180));
        flux[g] = kmStep * kmStep * cos * (snow[g] + 0.15 * (1 - snow[g]));
        order.push(g);
    }
    order.sort((a, b) => R[b] - R[a]);
    for (const g of order) {
        const j = Math.floor(g / w), i = g - j * w, cos = Math.max(0.02, Math.cos((90 - (j + 0.5) * step) * Math.PI / 180));
        out[g] = flux[g] / (kmStep * Math.sqrt(cos));
        let best = -1, low = R[g];
        for (let dj = -1; dj <= 1; dj++) {
            const jj = j + dj;
            if (jj < 0 || jj >= h) continue;
            for (let di = -1; di <= 1; di++) {
                if (!dj && !di) continue;
                const q = jj * w + (i + di + w) % w;
                if (R[q] < low) { low = R[q]; best = q; }
            }
        }
        if (best >= 0) flux[best] += flux[g];
    }
    return out;
}
