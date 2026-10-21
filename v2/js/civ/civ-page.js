// The civ layer on the Evolution page (plans/CIV_PLAN.md): a finished moment's people, worked out in the finishing worker
// (finish/finish-worker.js), which holds the moment — on a mesh of at most PAGE_CELLS (~56 km cells: a world's people at a
// glance, a run in a few seconds), each of its cells read from the finer cell at its centre (the rivers are points: they
// map onto any mesh). What goes back to the page is small: one byte per cell and frame — the density, 8 steps a decade,
// and the way of life — and, for a picture of a given width, each pixel's cell.

import { buildSimMesh } from '../core/sim-mesh.js';
import { STAT_KEYS } from '../climate/cell-stats.js';
import { civSubstrate } from './substrate.js';
import { runCivSim, byteDensity, Life } from './sim.js';
import { CIV } from './civ-config.js';

export const PAGE_CELLS = 160000;
const MESH_SEED = 12345;

/** A frame's byte: 0 nobody; else the way of life (WAYS) in the top two bits, the density in the low six. */
export const WAYS = ['foragers', 'settled foragers', 'farmers', 'irrigation farmers'];
const wayOf = life => (life >= Life.IRRIGATOR ? 3 : life >= Life.FARMER ? 2 : life >= Life.SEDENTARY ? 1 : 0);
export const peopleByte = (d, life) => (d > 1e-4 ? (wayOf(life) << 6) | Math.min(63, 1 + Math.round(8 * (Math.log10(d) + 4))) : 0);
/** A frame byte's density (persons/km²) and way of life (WAYS index), or null for nobody. */
export function peopleOf(b) { return b ? { d: Math.pow(10, ((b & 63) - 1) / 8 - 4), way: b >> 6 } : null; }

let coarse = null;
/** The civ layer's world from finishPlanet's output (finish.js): the moment's fields on a mesh of at most PAGE_CELLS — taken
 *  when the moment is finished (the worker lets the finer fields go), its people worked out later, on request. */
export function civWorldFromFinish(out) {
    const cc = out.climate.cell, L = out.civ ?? {}, R = out.rivers;
    // (the rivers copied: the page is sent the moment's own)
    const rivers = { lat: R.lat.slice(), lon: R.lon.slice(), q: R.q.slice(), regime: R.regime?.slice() ?? null, farFed: R.farFed?.slice() ?? null };
    const fine = { mesh: out.mesh, z: out.z, ocean: out.ocean, lake: out.lake, koppen: cc.koppen, tAnnual: cc.tAnnual, pAnnual: cc.pAnnual,
        stats: cc.stats, rivers, loess: L.loess ?? null, erg: L.erg ?? null, ice: L.ice ?? null };
    if (out.mesh.numCells <= PAGE_CELLS) return fine;
    const mesh = coarse ??= buildSimMesh(PAGE_CELLS, MESH_SEED), n = mesh.numCells, xyz = mesh.xyz, src = new Int32Array(n);
    for (let c = 0; c < n; c++) src[c] = out.mesh.index.nearest(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]);
    const take = a => { if (!a) return null; const b = new a.constructor(n); for (let c = 0; c < n; c++) b[c] = a[src[c]]; return b; };
    return { mesh, z: take(fine.z), ocean: take(fine.ocean), lake: take(fine.lake), koppen: take(fine.koppen), tAnnual: take(fine.tAnnual), pAnnual: take(fine.pAnnual),
        stats: Object.fromEntries(STAT_KEYS.map(k => [k, take(fine.stats[k])])), rivers: fine.rivers, loess: take(fine.loess), erg: take(fine.erg), ice: take(fine.ice) };
}

/**
 * Run the people on a finished moment's world (civWorldFromFinish). `width`: the picture the page paints (width × width/2), for each pixel's cell.
 * @returns {{cells, frames: Uint8Array (frame-major, cells each), bp: Float32Array, people: Float64Array, farmers: Float64Array,
 *   centres, origin: [lat, lon], pix: Int32Array, pixW, ms}}
 */
export function peopleOfWorld(w, width, onProgress = () => {}) {
    const t0 = performance.now();
    const sub = civSubstrate(w), n = w.mesh.numCells;
    const count = Math.floor(CIV.originBP / CIV.frameYears) + 1, frames = new Uint8Array(count * n);
    const bp = new Float32Array(count), people = new Float64Array(count), farmers = new Float64Array(count);
    let f = 0;
    const res = runCivSim(w, sub, { onFrame: fr => {
        if (f >= count) return;
        const o = f * n;
        for (let c = 0; c < n; c++) if (fr.density[c]) frames[o + c] = peopleByte(byteDensity(fr.density[c]), fr.life[c]);
        bp[f] = fr.bp; people[f] = fr.people; farmers[f] = fr.farmers; f++;
        onProgress(f / count);
    } });
    const W = width, H = W >> 1, pix = new Int32Array(W * H);
    for (let y = 0; y < H; y++) {
        const la = (0.5 - (y + 0.5) / H) * Math.PI, cl = Math.cos(la), sl = Math.sin(la);
        for (let x = 0; x < W; x++) { const lo = ((x + 0.5) / W - 0.5) * 2 * Math.PI; pix[y * W + x] = w.mesh.index.nearest(cl * Math.cos(lo), cl * Math.sin(lo), sl); }
    }
    const o = res.origins[0], D = 180 / Math.PI, xyz = w.mesh.xyz;
    return { cells: n, frames: f < count ? frames.slice(0, f * n) : frames, bp: bp.slice(0, f), people: people.slice(0, f), farmers: farmers.slice(0, f),
        centres: res.centres, origin: [Math.asin(xyz[3 * o + 2]) * D, Math.atan2(xyz[3 * o + 1], xyz[3 * o]) * D], pix, pixW: W, ms: performance.now() - t0 };
}
