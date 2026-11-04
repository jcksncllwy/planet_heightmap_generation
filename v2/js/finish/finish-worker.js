// The Finish step's worker (plans/V2_FINISH_PLAN.md): finishes one moment (finish.js) and sends back its picture of
// heights. It keeps the mesh it built (a 10M-cell mesh takes ~15 s to build — only this worker ever holds it) until a
// finish at another detail (one fine mesh at a time: they are big); its
// terrain pool (the surface, in slices) lives only for the surface and is let go before the heavy stages.
//
// Message in:  {type: 'finish', id, frame (the terrain fields of a frame, terrain-pool.js FRAME_FIELDS, and the plates'
//              rotations), simMesh {numCells, xyz, adjOffset, adjList}, seed, cells, width, delaunatorUrl, poolSize?}
// Messages out: {type: 'stage', id, stage} · {type: 'progress', id, share} (the picture) · {type: 'done', id, raster:
//              {w, h, heightM, ocean, water}, rivers (finish-hydro.js), climate (the moment's own, at its detail: the
//              grid's fields, climate-fields.js, and raster {w, h, koppen, tAnnual (°C × 100), pAnnual (mm), stats} — the land's
//              climate, at most 4096 px wide), stats, ms} · {type: 'error', id, message}
// civ (in, optional): the People switch. With it on, 'done' also carries civ: the moment's world for the civ layer
// (v2/js/civ/civ-page.js; small, on its own coarser mesh); off, none of the civ layer is loaded or run.
//
// The finish cache (tools/lib/finish-cache.mjs, through the dev server: only when it served this worker — app/finish-code.js
// holds the hash of the code it loaded): with cache {history (the moment's history-cache key)} in the message, the
// finished moment is looked up first (app/finish-key.js) and, when there, sent back as it was kept — 'done' with cached:
// true, no finishing — else finished and then kept: 'done' carries cacheKey and saving: true, and the upload (compressed
// here, off the page's thread) ends with {type: 'saved', id, ok}. cachedOnly: a miss is not finished ({type: 'error',
// miss: true}).

import { finishPlanet, erosionEngine } from './finish.js';
import { finishResult, pageTransfers } from './finish-result.js';
import { TerrainPool } from '../terrain/terrain-pool.js';
import { keepOnlyTerrainMesh } from '../terrain/terrain-mesh.js';
import { meshFromArrays } from '../core/sim-mesh.js';
import { setDelaunator } from '../../../js/sphere-mesh.js';
import { FINISH_CODE } from '../app/finish-code.js';
import { finishKey, finishSpec, erosionOf } from '../app/finish-key.js';
import { mathFingerprint } from '../app/history-key.js';
import { treeChunks, readTree } from '../app/finish-wire.js';

let sim = null, simCells = 0, delaunatorSet = false;

self.onmessage = async ({ data }) => {
    if (data.type !== 'finish') return;
    const { id, frame, seed, cells, width, poolSize = null, climateOptions = {}, civ: wantCiv = false, cache = null, cachedOnly = false } = data;
    try {
        // (the finish cache: this moment at these settings, on this engine, already finished — by this page before a
        // reload, or another tab)
        const want = cache?.history && FINISH_CODE ? { history: cache.history, timeMyr: frame.time, code: FINISH_CODE, cells, width, climate: climateOptions, civ: wantCiv, host: 'page', math: mathFingerprint(), erosion: await erosionEngine() } : null;
        const wantKey = want && finishKey(want);
        if (wantKey) {
            const page = await cachedPage(wantKey);
            if (page) { self.postMessage({ type: 'done', id, ...page, cached: true, cacheKey: wantKey }, pageTransfers(page)); return; }
        }
        if (cachedOnly) { self.postMessage({ type: 'error', id, miss: true, message: 'not in the finish cache' }); return; }
        if (!delaunatorSet) { setDelaunator((await import(data.delaunatorUrl)).default); delaunatorSet = true; }
        if (!sim || simCells !== data.simMesh.numCells) { sim = meshFromArrays(data.simMesh); simCells = data.simMesh.numCells; }
        keepOnlyTerrainMesh(cells);                                   // (another detail's mesh goes: one fine mesh at a time)
        const pool = await TerrainPool.create(sim, poolSize);
        const out = await finishPlanet({ frame, simMesh: sim, seed, cells, pool, closePool: true, climateOptions, civ: wantCiv, onStage: stage => self.postMessage({ type: 'stage', id, stage }) });
        self.postMessage({ type: 'stage', id, stage: 'picture' });
        const { page, cells: perCell } = await finishResult(out, { width, civ: wantCiv, onProgress: share => self.postMessage({ type: 'progress', id, share }) });
        // (filed under what really ran: a GPU that would not open ran the CPU's erosion)
        const spec = want && finishSpec({ ...want, erosion: erosionOf(page.stats.erodeOn) }), key = spec && finishKey(spec);
        // (the bytes to keep, copied before the page is handed its arrays)
        const blobs = key ? { page: new Blob(treeChunks(page).chunks), cells: new Blob(treeChunks(perCell).chunks) } : null;
        self.postMessage({ type: 'done', id, ...page, cacheKey: key, saving: !!key }, pageTransfers(page));
        if (key) self.postMessage({ type: 'saved', id, key, ok: await save(key, spec, blobs, { seed, stats: page.stats, ms: page.ms }) });
    } catch (err) {
        self.postMessage({ type: 'error', id, message: err?.stack ?? String(err) });
    }
};

/** A finished moment's page part from the cache, or null (not there, or no dev server). */
async function cachedPage(key) {
    try {
        const r = await fetch(`/api/finish/page?key=${key}`);
        if (!r.ok) return null;
        return readTree(new Uint8Array(await r.arrayBuffer()));
    } catch { return null; }
}

/** Keep a finished moment: its page part and its cells, compressed here, then its meta (the entry is whole once 'done'). */
async function save(key, spec, blobs, info) {
    const post = (what, body, extra = '') => fetch(`/api/finish/${what}?key=${key}${extra}`, { method: 'POST', body }).then(r => r.ok);
    const deflate = blob => new Response(blob.stream().pipeThrough(new CompressionStream('deflate'))).blob();
    try {
        if (!(await post('begin', JSON.stringify({ spec, ...info, engine: self.navigator?.userAgent ?? null })))) return false;
        for (const part of ['page', 'cells']) if (!(await post('part', await deflate(blobs[part]), `&part=${part}&raw=${blobs[part].size}`))) return false;
        return await post('done', '{}');
    } catch { return false; }
}
