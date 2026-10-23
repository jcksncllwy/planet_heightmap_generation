// The civ layer on the Evolution page (plans/CIV_PLAN.md): a finished moment's people, worked out in the finishing worker
// (finish/finish-worker.js), which holds the moment — on a mesh of at most PAGE_CELLS (~56 km cells: a world's people at a
// glance, a run in a few seconds), each of its cells read from the finer cell at its centre (the rivers are points: they
// map onto any mesh). What goes back to the page is small: one byte per cell and frame — the density, 8 steps a decade,
// and the way of life — and, for a picture of a given width, each pixel's cell.

import { buildSimMesh } from '../core/sim-mesh.js';
import { STAT_KEYS } from '../climate/cell-stats.js';
import { civSubstrate } from './substrate.js';
import { createCivSim, byteDensity, Life } from './sim.js';
import { climateVariability, spreadOf } from './climate-var.js';
import { diseaseLoss } from './disease.js';
import { PACKAGES } from './substrate.js';
import { TownFlag } from './polity.js';
import { CIV } from './civ-config.js';

export const PAGE_CELLS = 160000;
/** A generation: the step the people's timeline goes on by, past now. */
export const STEP_YEARS = CIV.stepYears;
const MESH_SEED = 12345;

/** A frame's byte: 0 nobody; else the way of life (WAYS) in the top two bits, the density in the low six. */
export const WAYS = ['foragers', 'settled foragers', 'farmers', 'irrigation farmers'];
const wayOf = life => (life >= Life.IRRIGATOR ? 3 : life >= Life.FARMER ? 2 : life >= Life.SEDENTARY ? 1 : 0);
export const peopleByte = (d, life) => (d > 1e-4 ? (wayOf(life) << 6) | Math.min(63, 1 + Math.round(8 * (Math.log10(d) + 4))) : 0);
/** A frame byte's density (persons/km²) and way of life (WAYS index), or null for nobody. */
export function peopleOf(b) { return b ? { d: Math.pow(10, ((b & 63) - 1) / 8 - 4), way: b >> 6 } : null; }

export { TownFlag };

let coarse = null;
/** The civ layer's world from finishPlanet's output (finish.js): the moment's fields on a mesh of at most PAGE_CELLS — taken
 *  when the moment is finished (the worker lets the finer fields go), its people worked out later, on request. */
export function civWorldFromFinish(out) {
    const cc = out.climate.cell, L = out.civ ?? {}, R = out.rivers;
    // (the rivers copied: the page is sent the moment's own)
    const rivers = { lat: R.lat.slice(), lon: R.lon.slice(), q: R.q.slice(), regime: R.regime?.slice() ?? null, farFed: R.farFed?.slice() ?? null };
    const fine = { mesh: out.mesh, z: out.z, ocean: out.ocean, lake: out.lake, koppen: cc.koppen, tAnnual: cc.tAnnual, pAnnual: cc.pAnnual,
        stats: cc.stats, rivers, loess: L.loess ?? null, erg: L.erg ?? null, ice: L.ice ?? null, vector: L.vector ?? null };
    if (out.mesh.numCells <= PAGE_CELLS) return fine;
    const mesh = coarse ??= buildSimMesh(PAGE_CELLS, MESH_SEED), n = mesh.numCells, xyz = mesh.xyz, src = new Int32Array(n);
    for (let c = 0; c < n; c++) src[c] = out.mesh.index.nearest(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]);
    const take = a => { if (!a) return null; const b = new a.constructor(n); for (let c = 0; c < n; c++) b[c] = a[src[c]]; return b; };
    return { mesh, z: take(fine.z), ocean: take(fine.ocean), lake: take(fine.lake), koppen: take(fine.koppen), tAnnual: take(fine.tAnnual), pAnnual: take(fine.pAnnual),
        stats: Object.fromEntries(STAT_KEYS.map(k => [k, take(fine.stats[k])])), rivers: fine.rivers, loess: take(fine.loess), erg: take(fine.erg), ice: take(fine.ice),
        vector: fine.vector ? { rain: take(fine.vector.rain), warm: take(fine.vector.warm) } : null };
}

/**
 * Run the people on a finished moment's world (civWorldFromFinish), to now. `width`: the picture the page paints (width ×
 * width/2), for each pixel's cell. The run stays alive in `state`, to go on with (morePeople).
 * @returns {{state, result: {cells, frames: Uint8Array (frame-major, cells each), bp: Float32Array, people: Float64Array,
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
    const o = state.sim.result().origins[0], D = 180 / Math.PI, xyz = w.mesh.xyz;
    return { state, result: { cells: n, ...first, packages: PACKAGES.map(p => p.id), origin: [Math.asin(xyz[3 * o + 2]) * D, Math.atan2(xyz[3 * o + 1], xyz[3 * o]) * D],
        pix, pixW: W, ms: performance.now() - t0 } };
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

/** The frames a step of the run adds, packed: one byte per cell and frame, each frame's year, people, towns, polities. */
function collect(state, run, onFrame = () => {}) {
    const { n } = state, list = [];
    state.onFrame = fr => {
        const b = new Uint8Array(n);
        for (let c = 0; c < n; c++) if (fr.density[c]) b[c] = peopleByte(byteDensity(fr.density[c]), fr.life[c]);
        list.push({ b, bp: fr.bp, people: fr.people, farmers: fr.farmers, towns: fr.towns, polities: fr.polityTable });
        onFrame(list.length);
    };
    run();
    state.onFrame = null;
    const frames = new Uint8Array(list.length * n);
    list.forEach((x, i) => frames.set(x.b, i * n));
    const res = state.sim.result();
    return { frames, bp: Float32Array.from(list, x => x.bp), people: Float64Array.from(list, x => x.people), farmers: Float64Array.from(list, x => x.farmers),
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
