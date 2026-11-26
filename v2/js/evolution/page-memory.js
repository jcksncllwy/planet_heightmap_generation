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
// workers ~0.33 GB (rested for a pass when room is short: TerrainPlayer rest()).
export const PAGE_REST_BYTES = 0.66e9, HISTORY_WORKER_BYTES = 0.27e9, TERRAIN_POOL_BYTES = 0.33e9;

/**
 * What the page holds now, by part, bytes: {frames, detail, worker, rest, total}. `frames`: the history's packed frames
 * (frameBytes); `detail`: the moments kept in detail (finishBytes each); `worker`: the finishing worker kept with its mesh.
 */
export function heldBytes({ framesBytes = 0, detailBytes = 0, keptWorkerCells = 0, poolResting = false }) {
    const rest = PAGE_REST_BYTES + HISTORY_WORKER_BYTES + (poolResting ? 0 : TERRAIN_POOL_BYTES);
    const worker = keptWorkerBytes(keptWorkerCells);
    return { frames: framesBytes, detail: detailBytes, worker, rest, total: framesBytes + detailBytes + worker + rest };
}

/** Bytes as the card says them: "740 MB", "2.1 GB". */
export const bytesWords = n => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

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
