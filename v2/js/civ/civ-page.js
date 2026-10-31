// The civ layer on the Evolution page (plans/CIV_PLAN.md): a finished moment's people, worked out in the finishing worker
// (finish/finish-worker.js), which holds the moment — on a mesh of at most PAGE_CELLS (~56 km cells: a world's people at a
// glance, a run in a few seconds), each of its cells read from the finer cell at its centre (the rivers are points: they
// map onto any mesh). What goes back to the page is small: two bytes per cell and frame — the density, 8 steps a decade;
// the way of life and the crop it lives on — and, for a picture of a given width, each pixel's cell.

import { buildSimMesh } from '../core/sim-mesh.js';
import { STAT_KEYS } from '../climate/cell-stats.js';
import { civSubstrate, cellLife, FOODS, STAPLES, STAPLE_WORDS, WAY_WORDS, PARENT_WORDS, MOD_WORDS } from './substrate.js';
import { FOOD } from './food-config.js';
import { cropsFromMonths } from './crops.js';
import { createCivSim, byteDensity, Life } from './sim.js';
import { climateVariability, spreadOf } from './climate-var.js';
import { diseaseLoss } from './disease.js';
import { TownFlag } from './polity.js';
import { CIV } from './civ-config.js';
import { travelGraph, travelDays } from './routes.js';

export const PAGE_CELLS = 160000;
/** A generation: the step the people's timeline goes on by, past now. */
export const STEP_YEARS = CIV.stepYears;
const MESH_SEED = 12345;

/** A frame's two bytes per cell. The density byte: 0 nobody, else 1–63, 8 steps a decade from 1e-4 persons/km². The way
 *  byte: the way of life (WAYS) in the low three bits, the crop it lives on (FOODS index + 1; 0 none) above them. */
export const WAYS = ['foragers', 'settled foragers', 'herders', 'farmers', 'irrigation farmers'];
const WAY_OF_LIFE = { [Life.FORAGER]: 0, [Life.SEDENTARY]: 1, [Life.CULTIVATING]: 1, [Life.HERDER]: 2, [Life.FARMER]: 3, [Life.IRRIGATOR]: 4 };
export const densityCode = d => (d > 1e-4 ? Math.min(63, 1 + Math.round(8 * (Math.log10(d) + 4))) : 0);
export const wayCode = (life, crop) => (WAY_OF_LIFE[life] ?? 0) | ((crop + 1) << 3);
/** A food byte (substrate.js food, persons/km²): 0 none; 1–251 from 0.01 to 1000, 50 steps a decade. */
export const foodByte = d => (d >= 0.01 ? Math.min(255, 1 + Math.round(50 * (Math.log10(d) + 2))) : 0);
export const byteFood = b => (b ? Math.pow(10, (b - 1) / 50 - 2) : 0);
export { FOODS, STAPLES, STAPLE_WORDS, WAY_WORDS, PARENT_WORDS, MOD_WORDS };
/** A frame's two bytes as density (persons/km²), way of life (WAYS index) and crop (a FOODS key, or null); null for nobody. */
export function peopleOf(b, wb) { return b ? { d: Math.pow(10, (b - 1) / 8 - 4), way: wb & 7, crop: FOODS[(wb >> 3) - 1] ?? null } : null; }

export { TownFlag };

let coarse = null;
/** The civ layer's world from finishPlanet's output (finish.js): the moment's fields on a mesh of at most PAGE_CELLS — taken
 *  when the moment is finished (the worker lets the finer fields go), its people worked out later, on request. */
export function civWorldFromFinish(out, { months = false } = {}) {
    const cc = out.climate.cell, L = out.civ ?? {}, R = out.rivers;
    // (the rivers copied: the page is sent the moment's own)
    const rivers = { lat: R.lat.slice(), lon: R.lon.slice(), q: R.q.slice(), regime: R.regime?.slice() ?? null, farFed: R.farFed?.slice() ?? null };
    const fine = { mesh: out.mesh, z: out.z, ocean: out.ocean, lake: out.lake, koppen: cc.koppen, tAnnual: cc.tAnnual, pAnnual: cc.pAnnual,
        stats: cc.stats, rivers, loess: L.loess ?? null, erg: L.erg ?? null, ice: L.ice ?? null, vector: L.vector ?? null, flow: L.flow ?? null, sea: seaOf(out.climate.page) };
    const small = out.mesh.numCells <= PAGE_CELLS, mesh = small ? out.mesh : (coarse ??= buildSimMesh(PAGE_CELLS, MESH_SEED)), n = mesh.numCells, xyz = mesh.xyz;
    const src = small ? null : new Int32Array(n);
    if (src) for (let c = 0; c < n; c++) src[c] = out.mesh.index.nearest(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]);
    // (the crops' harvests from the cells' months, on the cells read: crops.js)
    const crops = L.months ? cropsFromMonths(L.months, n, c => Math.asin(xyz[3 * c + 2]), src) : null;
    // (and the months themselves, for a tool to keep — `months`: crops.js's code is not the world's)
    const keep = months && L.months ? (src ? { T: takeMonths(L.months.T, src), P: takeMonths(L.months.P, src) } : L.months) : undefined;
    if (small) return { ...fine, crops, ...(keep ? { months: keep } : {}) };
    const take = a => { if (!a) return null; const b = new a.constructor(n); for (let c = 0; c < n; c++) b[c] = a[src[c]]; return b; };
    return { mesh, z: take(fine.z), ocean: take(fine.ocean), lake: take(fine.lake), koppen: take(fine.koppen), tAnnual: take(fine.tAnnual), pAnnual: take(fine.pAnnual),
        stats: Object.fromEntries(STAT_KEYS.map(k => [k, take(fine.stats[k])])), rivers: fine.rivers, loess: take(fine.loess), erg: take(fine.erg), ice: take(fine.ice),
        vector: fine.vector ? { rain: take(fine.vector.rain), warm: take(fine.vector.warm) } : null, crops, flow: fine.flow, sea: fine.sea, ...(keep ? { months: keep } : {}) };
}
/** Twelve values a cell, each cell's from its cell `src[c]`. */
function takeMonths(a, src) {
    const b = new a.constructor(12 * src.length);
    for (let c = 0; c < src.length; c++) b.set(a.subarray(12 * src[c], 12 * src[c] + 12), 12 * c);
    return b;
}

/** The climate's sea as the civ layer reads it (substrate.js seaFish): its year's temperature (°C), ice (0…1) and
 *  upwelling (m/day) on the climate's grid (finish.js climate.page, climate-fields.js pageClimate) — copied, or null. */
export function seaOf(page) {
    if (!page?.Tsea?.year || !page.upwelling?.year) return null;
    return { w: page.grid.w, h: page.grid.h, T: Float32Array.from(page.Tsea.year), ice: page.seaIce?.year ? Float32Array.from(page.seaIce.year) : null, upwell: Float32Array.from(page.upwelling.year) };
}

/**
 * Run the people on a finished moment's world (civWorldFromFinish), to now. `width`: the picture the page paints (width ×
 * width/2), for each pixel's cell. The run stays alive in `state`, to go on with (morePeople).
 * @returns {{state, result: {cells, frames: Uint8Array (frame-major, cells each: densityCode), ways: Uint8Array (the same:
 *   wayCode), bp: Float32Array, people: Float64Array,
 *   farmers: Float64Array, towns: [Float32Array [lat, lon, people, TownFlag, polity] × each town of 2500+, or null] per frame,
 *   polities, centres, place, origin: [lat, lon], pix: Int32Array, pixW, ms}}}
 */
export function startPeople(w, width, onProgress = () => {}, runs = null) {
    const t0 = performance.now();
    const sub = civSubstrate(w), n = w.mesh.numCells, vary = climateVariability(w, sub, CIV, runs);
    const state = { w, sub, n, onFrame: null, still: null };
    state.sim = createCivSim(w, sub, { vary, onFrame: fr => state.onFrame?.(fr) });
    const count = Math.floor(CIV.originBP / CIV.frameYears) + 1;
    const first = collect(state, () => state.sim.advance(0), k => onProgress(k / count));
    const W = width, H = W >> 1, pix = new Int32Array(W * H);
    for (let y = 0; y < H; y++) {
        const la = (0.5 - (y + 0.5) / H) * Math.PI, cl = Math.cos(la), sl = Math.sin(la);
        for (let x = 0; x < W; x++) { const lo = ((x + 0.5) / W - 0.5) * 2 * Math.PI; pix[y * W + x] = w.mesh.index.nearest(cl * Math.cos(lo), cl * Math.sin(lo), sl); }
    }
    const res = state.sim.result(), o = res.origins[0], D = 180 / Math.PI, xyz = w.mesh.xyz;
    // (what the land offers, per resource: plans/CIV_PLAN.md §9.2 — for the map's Food view)
    const food = new Uint8Array(FOODS.length * n);
    FOODS.forEach((f, i) => { const a = state.sub.food[f]; for (let c = 0; c < n; c++) food[i * n + c] = foodByte(a[c]); });
    return { state, result: { cells: n, ...first, packages: res.packages, origin: [Math.asin(xyz[3 * o + 2]) * D, Math.atan2(xyz[3 * o + 1], xyz[3 * o]) * D],
        pix, pixW: W, food, ground: landViews(w, state.sub, vary), ms: performance.now() - t0 } };
}

/** What the land offers before anyone lives there (the People layer's land views: people-view.js GROUND_SHOWS; the result's `ground`), a byte a
 *  cell each: farm — the farmland's class (0 barren … 4 excellent: food-config farmClasses on substrate.js farmV) | its
 *  best rotation's harvests a year by rain, 0–15 in fifths, << 3 (byte >> 3 / 5); soil — its fertility, 0–255; soilKind —
 *  substrate.js's (Parent | SoilMod << 4); staple — STAPLES index | the way of life (substrate.js WAYS) << 4 (cellLife,
 *  with the rain's year-to-year CV as sim.js reads it: the storms' and the climate's modes). */
function landViews(w, sub, V) {
    const n = sub.n, farm = new Uint8Array(n), soil = new Uint8Array(n), staple = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
        if (w.ocean[c] || w.lake[c] || !(w.tAnnual[c] === w.tAnnual[c])) continue;
        let cls = 0;
        for (const t of FOOD.farmClasses) if (sub.farmV[c] >= t) cls++;
        farm[c] = cls | (Math.min(15, Math.round(5 * sub.harvests[c])) << 3);
        soil[c] = Math.round(255 * Math.min(1, sub.soil[c]));
        let cv = 0;
        if (V) { let v = V.rainCV[c] ** 2; for (let m = 0; m < 4; m++) v += V.rainLn[4 * c + m] ** 2 / 2; cv = Math.sqrt(v); }
        const [way, st] = cellLife(sub, c, cv);
        staple[c] = st | (way << 4);
    }
    return { farm, soil, soilKind: Uint8Array.from(sub.soilKind), staple };
}

/** Days to travel from (lat, lon) to every cell of a run (startPeople's state) in month m (0 = January), by a craft
 *  (routes.js Craft): {days (per cell), from: [lat, lon] of the cell set out from}. The craft's graph kept on the state. */
export function travelFrom(state, craft, m, lat, lon) {
    const { w } = state, D = Math.PI / 180, graphs = state.graphs ??= [];
    graphs[craft] ??= travelGraph(w, state.sub, craft);
    const src = w.mesh.index.nearest(Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)), x = w.mesh.xyz;
    return { days: travelDays(w.mesh, graphs[craft], src, m), from: [Math.asin(x[3 * src + 2]) / D, Math.atan2(x[3 * src + 1], x[3 * src]) / D] };
}

/** Go on with a run (startPeople's state) to `toBP` (negative: years after now), a frame every `every` years: the new frames,
 *  and the place, centres as they now stand. */
export function morePeople(state, toBP, every = STEP_YEARS) {
    return collect(state, () => state.sim.advance(toBP, every));
}

/** startPeople's run to now, as one result (for the tools). */
export function peopleOfWorld(w, width, onProgress = () => {}, runs = null) {
    return startPeople(w, width, onProgress, runs).result;
}

/** The frames a step of the run adds, packed: three bytes per cell and frame (density, way of life with crop, land in use), each frame's year, people, towns, polities. */
function collect(state, run, onFrame = () => {}) {
    const { n } = state, list = [];
    state.onFrame = fr => {
        const b = new Uint8Array(n), wb = new Uint8Array(n);
        for (let c = 0; c < n; c++) if ((b[c] = densityCode(byteDensity(fr.density[c])))) wb[c] = wayCode(fr.life[c], fr.crop[c]);
        list.push({ b, wb, land: fr.land, bp: fr.bp, people: fr.people, farmers: fr.farmers, towns: fr.towns, polities: fr.polityTable });
        onFrame(list.length);
    };
    run();
    state.onFrame = null;
    const frames = new Uint8Array(list.length * n), ways = new Uint8Array(list.length * n);
    list.forEach((x, i) => { frames.set(x.b, i * n); ways.set(x.wb, i * n); });
    // (the land in use, a byte a cell and frame as sim.js packs it)
    const land = new Uint8Array(list.length * n);
    list.forEach((x, i) => land.set(x.land, i * n));
    const res = state.sim.result();
    return { frames, ways, land, bp: Float32Array.from(list, x => x.bp), people: Float64Array.from(list, x => x.people), farmers: Float64Array.from(list, x => x.farmers),
        towns: list.map(x => x.towns), polities: list.map(x => x.polities), centres: res.centres, place: placeStats(state, res, state.sim.bp) };
}

/** What the readout and a town's card say about a place, per cell: when people and farming came (years ago; NaN never),
 *  the farming package, its fever (share of settled people lost, 0–255), its famine deaths (share of its people a
 *  century, over its farming years), how much its rain and its river's flood vary from year to year (CV, %). */
function placeStats(state, res, nowBP) {
    const { w, sub, n } = state, V = res.vary, famine = new Float32Array(n);
    // (what the run does not change, once: fever, the rain's and the flood's spread, where canals could water)
    state.still ??= (() => {
        const fever = new Uint8Array(n), rainCV = new Uint8Array(n), floodCV = new Uint8Array(n);
        for (let c = 0; c < n; c++) {
            if (w.ocean[c]) continue;
            if (res.parasites) fever[c] = Math.round(255 * diseaseLoss(w, c, res.parasites, sub.wetland[c] > 0 ? 1 : 0, false, true));
            if (V) {
                rainCV[c] = Math.min(255, Math.round(100 * spreadOf(V.rainLn, V.rainCV[c], c, 64)));
                const s = sub.irrigSrc[c];
                if (s >= 0) floodCV[c] = Math.min(255, Math.round(100 * spreadOf(V.riverLn, V.riverCV[s], s, 64)));
            }
        }
        return { fever, rainCV, floodCV, irrigable: Uint8Array.from(sub.irrig, v => (v > 0 ? 1 : 0)) };
    })();
    for (let c = 0; c < n; c++) {
        const years = res.farmBP[c] - nowBP;
        if (res.famine && years > 0) famine[c] = res.famine[c] / Math.max(1, years / 100);
    }
    return { arrivalBP: res.arrivalBP, farmBP: res.farmBP, pkg: Int8Array.from(res.farmPkg), famine, ...state.still };
}
