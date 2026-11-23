// The history's climate (lane gpuclimate P4; Jackson's ruling 2026-11-23): every CLIMATE_EVERY_MYR on the step grid the
// whole climate (climate/climate.js planetClimate, its solves on the GPU: gpu/climate-solver.js) on the world as it stands —
// the land the terrain's mask draws (terrain/land-mask.js), each cell's ground against the sea — held until the next sample.
// It replaced the zonal tables the history's readers took rain and ice by latitude from (terrain-config.js rainByLatitude
// and glacialErosion, as the history read them): the surface erosion's drainage weight and carving rate
// (surface-erosion.js), the rivers' discharge (rivers.js), the islands' and flood basalts' wear (heights.js).
//
// The sample is taken on a 2° grid: 1.3–1.9 s a sample against 3.2–4.7 s at the finish's 1°, its year's temperature
// within ~0.4–0.5 °C and its rain within ~20–30 % of 1°'s per cell (tools/history-climate-study.mjs --variants; lane
// gpuclimate report P3) — the rain shadows and continents' interiors a zonal table cannot carry are 55–110 %. Held
// between samples: the climate answers the ground of 20 Myr ago, not each step's (the history's own time scale for
// the drainage it moves). What it skips: the finish's sub-grid detail (each cell's relief, the rain's texture) — the
// grid's year at the cell's place.
//
// A generator step (simulate.js): it yields { kind: 'climate', input, options }, and simulate answers with the climate.
import { landMask } from '../../terrain/land-mask.js';
import { surfaceKm } from '../ocean/inventory.js';
import { heightsOf } from './heights.js';
import { viewOf, newView } from './rivers.js';
import { CORE_DEFAULTS } from '../../climate/core.js';
import { heldWater } from '../../terrain/basin-estimate.js';
import { FINISH } from '../../finish/finish-config.js';

export const CLIMATE_EVERY_MYR = 20;
export const CLIMATE_GRID_DEG = 2;

// (per world, not per mesh: the view and the mask keep fields between calls — rivers.js scratchFor — and every scene on
// the lab mesh shares one mesh, so a scratch per mesh carried one history's crust into the next's climate: histdet)
const scratch = new WeakMap();

/** Take the climate if a sample is due (the history's start, then each CLIMATE_EVERY_MYR on the step grid). */
export function* sampleClimate(world) {
    const due = !world.climate || Math.floor(world.time / CLIMATE_EVERY_MYR + 1e-9) > Math.floor(world.climate.atMyr / CLIMATE_EVERY_MYR + 1e-9);
    if (!due) return;
    const H = heightsOf(world.config), mesh = world.mesh, n = mesh.numCells;
    let s = scratch.get(world);
    if (!s) scratch.set(world, s = { view: newView(n), mask: {} });
    viewOf(world, s.view, H, true);
    const m = landMask(s.view, mesh, H, s.mask, world.climate ? heldWaterOf(world, H) : null), sl = m.sl;
    const ground = s.mask.groundKm?.length === n ? s.mask.groundKm : surfaceKm(s.view, mesh, H, undefined, sl.swellKm, sl.seaRefKm);
    const elevKm = new Float32Array(n), land = Uint8Array.from(m.land);
    for (let c = 0; c < n; c++) elevKm[c] = ground[c] - sl.seaKm;
    const res = yield { kind: 'climate', input: { xyz: mesh.xyz, elevKm, axes: 'z-up', land }, options: { gridStepDeg: CLIMATE_GRID_DEG, cells: false } };
    world.climate = climateHeld(world.time, res, elevKm);
}

/** What the history keeps of a climate: the grid's year — rain (mm), temperature at sea level (°C) — and its ice sheets. */
function climateHeld(atMyr, res, elevKm) {
    const { grid, months, surface } = res, G = grid.size, rain = new Float32Array(G), tSea = new Float32Array(G), ice = new Float32Array(G);
    const lapse = CORE_DEFAULTS.lapseRateCPerKm;
    for (let g = 0; g < G; g++) {
        let p = 0, t = 0;
        for (let m = 0; m < 12; m++) { p += months.P[m * G + g]; t += months.T[m * G + g] / 12; }
        const ref = surface.meanLandKm[g] === surface.meanLandKm[g] ? surface.meanLandKm[g] : 0;
        rain[g] = Math.max(0, p); tSea[g] = t + lapse * ref;
    }
    const per = res.stages?.temperature?.state?.perennial;
    if (per?.length === G) ice.set(per);
    return { atMyr, w: grid.w, h: grid.h, step: grid.step, rain, tSea, ice, elevKm, fields: new Map() };
}

/** Bilinear on the held grid (cell centres; wrapping in longitude, clamped at the poles), at latitude/longitude in degrees. */
export function heldAt(cl, field, latDeg, lonDeg) {
    const { w, h, step } = cl, f = cl[field];
    const y = Math.min(h - 1, Math.max(0, (90 - latDeg) / step - 0.5)), x = ((lonDeg + 180) / step - 0.5 + w) % w;
    const j0 = Math.floor(y), j1 = Math.min(h - 1, j0 + 1), fy = y - j0, i0 = Math.floor(x) % w, i1 = (i0 + 1) % w, fx = x - Math.floor(x);
    return (1 - fy) * ((1 - fx) * f[j0 * w + i0] + fx * f[j0 * w + i1]) + fy * ((1 - fx) * f[j1 * w + i0] + fx * f[j1 * w + i1]);
}

/**
 * Per world cell, from the held climate (once a sample and settings): `rain` (mm a year), `water` (rain ÷ rainRefMm: the
 * drainage's weight) and `erosion` — the erosion clocks' multiplier, as terrain-config.js erosionAtLatitude reckons it from
 * the rain ((rain ÷ rainRefMm)^rainErosionExponent, softer where wetter) or from the ice, whichever is larger. The ice:
 * glacial erosion where the climate keeps an ice sheet (its perennial share), at a rate by the ice's warmth — the
 * glacialErosion table carried from latitude to today's zonal temperature there (tempByLatitude: 52° ≈ 3.6 °C → 0.95,
 * 58° ≈ −0.6 °C → 1.07, 64° ≈ −5.2 °C → 0.45, 70° ≈ −10 °C → 0.15, 90° ≈ −25 °C → 0.05), at the cell's own annual temperature (the grid's at sea
 * level less the lapse over its height): temperate ice sliding on meltwater erodes, cold ice frozen to its bed hardly.
 */
export function climateRates(world, H) {
    const cl = world.climate;
    let r = cl.fields.get(H);
    if (r) return r;
    const { xyz, numCells: n } = world.mesh, rain = new Float64Array(n), water = new Float32Array(n), erosion = new Float32Array(n), tSea = new Float32Array(n);
    const lapse = CORE_DEFAULTS.lapseRateCPerKm, iceByT = glacialByTemperature(H);
    for (let c = 0; c < n; c++) {
        const z = Math.max(-1, Math.min(1, xyz[3 * c + 2])), lat = Math.asin(z) * 180 / Math.PI, lon = Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * 180 / Math.PI;
        const ts = heldAt(cl, 'tSea', lat, lon), p = heldAt(cl, 'rain', lat, lon), t = ts - lapse * Math.max(0, cl.elevKm[c]);
        rain[c] = p; water[c] = p / H.rainRefMm; tSea[c] = ts;
        erosion[c] = erosionOf(p, heldAt(cl, 'ice', lat, lon), t, H, iceByT);
    }
    cl.fields.set(H, r = { rain, water, erosion, tSea });
    return r;
}

/** The erosion clocks' multiplier at a place in the held climate (heights.js: the crust where it stands now, at sea level). */
export function erosionHeldAt(cl, latDeg, lonDeg, H) {
    return erosionOf(heldAt(cl, 'rain', latDeg, lonDeg), heldAt(cl, 'ice', latDeg, lonDeg), heldAt(cl, 'tSea', latDeg, lonDeg), H, glacialByTemperature(H));
}

function erosionOf(rainMm, ice, tC, H, iceByT) {
    if (H.rainErosionExponent <= 0) return 1;
    const wet = rainMm / H.rainRefMm, r = wet ** (H.rainErosionExponent * (wet > 1 ? H.wetErosionShare : 1));
    return Math.max(r, ice > 0 ? ice * interp(iceByT, tC) : 0);
}

/** glacialErosion's [|lat|, rate] knots as [°C, rate], by tempByLatitude (warmest first), once per settings. */
const glacialCache = new WeakMap();
function glacialByTemperature(H) {
    let t = glacialCache.get(H);
    if (!t) glacialCache.set(H, t = H.glacialErosion.map(([lat, v]) => [interp(H.tempByLatitude, lat), v]).sort((a, b) => a[0] - b[0]));
    return t;
}
function interp(knots, x) {
    if (x <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) if (x <= knots[i][0]) { const [x0, y0] = knots[i - 1], [x1, y1] = knots[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    return knots[knots.length - 1][1];
}

/** The held climate's water balance for a pinned sill's judge (terrain/land-mask.js pinnedHumid): heights above that sill's
 *  sea and its world ocean → {rain, pet, runoff} per world cell (basin-estimate.js heldWater). */
export function heldWaterOf(world, H) {
    const r = climateRates(world, H);
    return (zz, ocean) => heldWater(world.mesh, zz, r.rain, r.tSea, H, FINISH, ocean);
}

/** heldWaterOf for a frame (terrain/land-mask.js, terrain/records.js: the view's land and pour from a history's frame): the
 *  climate the frame's history held, on the sim mesh — or null for a frame without one (the zonal balance). */
const frameRates = new WeakMap();
export function frameWaterOf(frame, simMesh, cfg) {
    const cl = frame?.climate;
    if (!cl) return null;
    let r = frameRates.get(cl);
    if (!r || r.mesh !== simMesh) {
        const n = simMesh.numCells, xyz = simMesh.xyz, rain = new Float32Array(n), tSea = new Float32Array(n);
        for (let c = 0; c < n; c++) {
            const lat = Math.asin(Math.max(-1, Math.min(1, xyz[3 * c + 2]))) * 180 / Math.PI, lon = Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * 180 / Math.PI;
            rain[c] = heldAt(cl, 'rain', lat, lon); tSea[c] = heldAt(cl, 'tSea', lat, lon);
        }
        frameRates.set(cl, r = { mesh: simMesh, rain, tSea });
    }
    return (zz, ocean) => heldWater(simMesh, zz, r.rain, r.tSea, cfg, FINISH, ocean);
}
