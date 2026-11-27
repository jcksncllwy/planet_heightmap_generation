// The Evolution page's memory: one budget for the page and every worker it starts, and the room an Add detail needs,
// made before it starts rather than after it runs out (pagemem, 2026-11-26: Jackson's 2.5M pass at 1200 Myr ran to ~99 %
// and began again from 0 with the page at 5.3 GB).
//
// What the browser allows (measured, headless Chrome 158 on a 32 GB Mac): every worker of a page runs in the page's one
// renderer process, and the process's ArrayBuffers are capped at ~15.5 GB in all — past it every allocation, the page's
// and every worker's, throws "Array buffer allocation failed", the error Add detail's retry catches. The engines' own
// heaps are small (51 MB on the page): nearly all of the page's memory is ArrayBuffers. Tabs of the same site may share
// the process, and a cap on address space fragments, so the budget stays well under it.
//
// What an Add detail costs, above the page at rest (measured on seed 243751, 40K/160K, by measureUserAgentSpecificMemory
// on a cross-origin-isolated page, A1): its peak in the finishing worker and the page together, and what it leaves held
// after — the finishing worker, kept at 2.5M and finer with the mesh it built (FinishService keep), and the detailed
// moment itself (finishBytes: ~200 MB at 640K and 2.5M, ~300 MB at 10M).
import { SMALL_DEVICE } from '../core/device.js';
import { packedBytes } from '../tectonics/frame-pack.js';

/** The page's budget, bytes: half the device's memory (navigator.deviceMemory, GB; Chrome reports up to 32), and on a
 *  desktop no more than 9 GB — well under the process's ~15.5 GB of ArrayBuffers; 1.5 GB on a small device. */
// (?membudget=GB: another budget, to see the page make room on a large machine)
const ASKED = Number(globalThis.location ? new URLSearchParams(globalThis.location.search).get('membudget') : NaN);
export const BUDGET_BYTES = ASKED > 0 ? ASKED * 1e9 : SMALL_DEVICE ? 1.5e9 : Math.min(9e9, 0.5 * (globalThis.navigator?.deviceMemory ?? 8) * 2 ** 30);

// [cells, peak above rest, the finishing worker held after (its mesh, kept at 2.5M and finer)] — A1, 2026-11-26: 640K peak
// +0.51 GB; 2.5M +2.5 GB (7.81 at its rivers over 5.27 at rest without the 10M worker), worker 0.70 GB after; 10M +5.3 GB
// (10.25 at its sea stage over 4.97), worker 2.15 GB after. 160K is scaled from 640K by its cells (not measured).
const PASSES = [[160e3, 0.13e9, 0], [640e3, 0.51e9, 0], [2.5e6, 2.5e9, 0.70e9], [10e6, 5.3e9, 2.15e9]];
// (a margin on the measured peaks: one world, measured once — another world's rivers and erosion may need more)
const MARGIN = 1.2;
const at = (cells, k) => {
    const i = PASSES.findIndex(p => p[0] >= cells);
    if (i === 0) return PASSES[0][k] * cells / PASSES[0][0];
    if (i < 0) return PASSES.at(-1)[k] * cells / PASSES.at(-1)[0];
    const [a, b] = [PASSES[i - 1], PASSES[i]], f = Math.log(cells / a[0]) / Math.log(b[0] / a[0]);
    return a[k] + f * (b[k] - a[k]);
};
/** The memory an Add detail at `cells` needs above the page at rest while it runs (with the margin). */
export const passPeakBytes = cells => MARGIN * at(cells, 1);
/** What the finishing worker holds after a finish at `cells` when it is kept (finish-view.js FinishService keep). */
export const keptWorkerBytes = cells => (cells >= 2.5e6 ? at(cells, 2) : 0);

// The page at rest, without what the ledger counts on its own (measured, A1 and S1, seed 243751 at 1200 Myr): the page
// itself ~0.66 GB (its textures, the terrain's meshes and caches, ~0.4 GB of which is not yet named), the history's
// worker with its world kept for Keep going ~0.27 GB (after tectonics/ops/free-dead-plates.js), the terrain's pool of
// workers ~0.33 GB (rested for a pass when room is short: TerrainPlayer rest()). (The page's 0.66 held the terrain player's
// caches at 1200 Myr, ~0.14 GB, counted on their own since: playerBytes.)
export const PAGE_REST_BYTES = 0.52e9, HISTORY_WORKER_BYTES = 0.27e9, TERRAIN_POOL_BYTES = 0.33e9;
// What grows with the history besides its frames, and was counted as the fixed parts above until a 1,000-frame Keep going
// went past them (pagemem2 S4a, seed 243751 to 9,960 Myr: the renderer at 8 GB when the ledger said 3.9): the history's
// worker, whose kept world grows by the plates the history has made — every one stays in world.plates, a dead one's few
// arrays too (tectonics/ops/free-dead-plates.js) — measured per frame of the history held; and the terrain player's
// caches, the frames' heights and poured seas, counted as they are (each within its budget: terrain-player.js).
// (the worker's per frame: a dead plate keeps ~50 KB at 40K cells — 165 MB over 3,342 plates at 9,960 Myr — and seed 243751
// makes ~3.3 plates a frame; before 1f54822 two of the steps' caches kept 320 KB more of every plate ever made)
export const HISTORY_WORKER_FRAME_BYTES = 0.2e6;

/**
 * What the page holds now, by part, bytes: {frames, detail, worker, rest, total}. `frames`: the history's packed frames
 * (frameBytes; `frameCount` of them); `detail`: the moments kept in detail (finishBytes each); `worker`: the finishing worker
 * kept with its mesh; `playerBytes`: the terrain player's caches (TerrainPlayer cacheBytes), in `rest` with the parts above.
 */
export function heldBytes({ framesBytes = 0, frameCount = 0, playerBytes = 0, detailBytes = 0, keptWorkerCells = 0, poolResting = false }) {
    const rest = PAGE_REST_BYTES + HISTORY_WORKER_BYTES + HISTORY_WORKER_FRAME_BYTES * frameCount + playerBytes + (poolResting ? 0 : TERRAIN_POOL_BYTES);
    const worker = keptWorkerBytes(keptWorkerCells);
    return { frames: framesBytes, detail: detailBytes, worker, rest, total: framesBytes + detailBytes + worker + rest };
}

/** Bytes as the card says them: "740 MB", "2.1 GB". */
export const bytesWords = n => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n < 0.5e6 ? (n > 0 ? 'under 1 MB' : 'none') : `${Math.round(n / 1e6)} MB`);

/**
 * The plan for making room for an Add detail at `cells`: what to let go, cheapest to bring back first, until the pass
 * fits the budget — the finishing worker's mesh at another detail (built again only if that detail is used again), the
 * terrain's pool (rested for the pass: its previews built again after, in a second or two), then the moments kept in
 * detail that the finish cache holds (brought back from it when stepped onto), the one viewed longest ago first. Moments
 * the cache does not hold are never let go here. `kept`: [{frame, bytes, onDisk, seen}] (never the moment on screen nor
 * the one being detailed: the caller leaves them out). @returns {{fits, need, free, worker, pool, detail: frames[]}}
 */
export function roomPlan({ cells, held, keptWorkerCells, kept, budget = BUDGET_BYTES }) {
    // (the pass's peak holds its mesh already: after it, the kept worker's mesh and the new moment — whichever is more)
    const need = Math.max(passPeakBytes(cells), keptWorkerBytes(cells) + (cells >= 5e6 ? 0.3e9 : 0.2e9));
    let free = budget - held.total;
    const plan = { need, free, worker: false, pool: false, detail: [] };
    if (free < need && keptWorkerCells && keptWorkerCells !== cells) { plan.worker = true; free += keptWorkerBytes(keptWorkerCells); }
    if (free < need && !SMALL_DEVICE) { plan.pool = true; free += TERRAIN_POOL_BYTES; }    // (a small device rests it anyway)
    for (const k of [...kept].filter(k => k.onDisk).sort((x, y) => x.seen - y.seen)) {
        if (free >= need) break;
        plan.detail.push(k.frame); free += k.bytes;
    }
    plan.free = free; plan.fits = free >= need;
    return plan;
}

/** How much the moments kept in detail may hold between passes: what the budget leaves over the page at rest and the
 *  room the next Add detail at `cells` will need (at least 1 GB on a desktop: four at 2.5M, as before). */
export function detailRoomBytes({ held, cells }) {
    if (SMALL_DEVICE) return Infinity;                                 // (a small device keeps one, by count)
    const other = held.total - held.detail;
    return Math.max(1e9, BUDGET_BYTES - other - Math.max(passPeakBytes(cells), keptWorkerBytes(cells)));
}

// ── what a history's frames really hold (pagemem2, 2026-11-27) ──
// A frame on the page is a PackedFrame: its packed fields (prototype getters, so a walk of the frame's own properties
// never saw them) and its meta — plain JS objects: the plates' entries, the events, the hotspots, the budget's books, the
// climate's grids. The ledger counted only the typed arrays among its own properties, ~0.2 MB a frame at 4,000 Myr when it
// held 5–7 (pagemem). Now: the packed fields' bytes, every typed array by its buffer, and every JS object by a reckoning
// of V8's (Chrome's pointer-compressed heap: a 12-byte header and 4 bytes a field; an array 16 + 4 an element; a string
// 12 + its length; a number not a small integer 12 more) — each object and buffer once over the whole history, so what
// frames share (app/history-share.js: the events, a dead plate's entry, a climate sample) is counted once.
const OBJ = 12, FIELD = 4, ARR = 16, STR = 12, NUM = 12;
function jsBytes(x, seen, depth = 0) {
    if (x === null || x === undefined || typeof x === 'boolean' || typeof x === 'function') return 0;
    if (typeof x === 'number') return Number.isInteger(x) && Math.abs(x) < 2 ** 30 ? 0 : NUM;
    if (typeof x === 'string') return STR + x.length;
    if (typeof x !== 'object' || seen.objs.has(x)) return 0;
    seen.objs.add(x);
    if (ArrayBuffer.isView(x)) { if (seen.bufs.has(x.buffer)) return OBJ; seen.bufs.add(x.buffer); return OBJ + x.buffer.byteLength; }
    if (depth > 8) return OBJ;
    let s;
    if (Array.isArray(x)) { s = ARR + FIELD * x.length; for (const v of x) s += jsBytes(v, seen, depth + 1); return s; }
    s = OBJ;
    for (const k in x) s += FIELD + jsBytes(x[k], seen, depth + 1);
    return s;
}
/** A place to note what has been counted: one per history (each object and buffer once over all its frames). */
export const frameLedger = () => ({ objs: new WeakSet(), bufs: new WeakSet() });
/**
 * The bytes `frame` adds to the history: its packed fields, and what of its meta no frame before it brought (frames are
 * counted in order, with one `seen` for the history). Its `events` are read as the ones it brought (`_eventsNew`,
 * app/history-share.js), not the whole list a read of frame.events makes.
 */
export function frameBytes(frame, seen) {
    let b = frame._packed ? packedBytes({ fields: frame._packed }) : 0;
    for (const k of Object.keys(frame)) {
        if (k === 'events' && frame._eventsNew) continue;
        const v = frame[k];
        b += FIELD + (ArrayBuffer.isView(v) ? (seen.bufs.has(v.buffer) ? 0 : (seen.bufs.add(v.buffer), v.buffer.byteLength)) : jsBytes(v, seen));
    }
    if (frame._eventsNew) b += jsBytes(frame._eventsNew, seen);
    return b;
}

// The renderer's footprint, beside what this ledger counts (what the engines measure: measureUserAgentSpecificMemory):
// native memory it cannot name, 1.45× or +1.96 GB at 1,000 frames (pagemem2 S6: 6.33 GB peak with 4.37 counted) and 1.59×
// or +1.7 GB at 577 (S7: 4.56 with 2.87) — reckoned as the larger of 1.6× and +2.0 GB. Keep going stops while the footprint
// this expects stays within FOOTPRINT_BYTES: 6.5 GB at most, so with the samples' ±0.5 GB swings a long history's renderer
// stays under 8 GB on any device (?membudget=GB sets it too); a small device's budget leaves it the 0.2 GB floor.
export const NATIVE_RATIO = 1.6, NATIVE_GAP_BYTES = 2.0e9;
export const FOOTPRINT_BYTES = ASKED > 0 ? ASKED * 1e9 : Math.min(6.5e9, BUDGET_BYTES);
/** The renderer's footprint expected when the ledger counts `bytes`. */
export const footprintOf = bytes => Math.max(bytes * NATIVE_RATIO, bytes + NATIVE_GAP_BYTES);

/** How much the history's frames may hold before Keep going stops — at least 0.2 GB, and the least of: the budget less
 *  the rest of the page (the moments kept in detail included) and the room the next Add detail at `cells` needs; and what
 *  keeps the footprint expected (footprintOf) within FOOTPRINT_BYTES. */
export function framesRoomBytes({ held, cells }) {
    const other = held.total - held.frames;
    const counted = BUDGET_BYTES - other - Math.max(passPeakBytes(cells), keptWorkerBytes(cells));
    const footprint = Math.min(FOOTPRINT_BYTES / NATIVE_RATIO, FOOTPRINT_BYTES - NATIVE_GAP_BYTES) - other;
    return Math.max(0.2e9, Math.min(counted, footprint));
}
