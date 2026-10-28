// A moment's frame — the history as the Evolution page builds it (scene 'cycle', ending none, the page's sim mesh and its
// worker's evolving heights), to the moment — through the history cache (history-cache.mjs; shared by render-moment.mjs,
// coast-shape.mjs, history.mjs and the page itself): read from it when the history has been built to the moment by
// anyone — the page in the browser included — else built and kept. The cache is keyed by the history code's hash, so a
// change to the history is never answered with frames the old code built.

import { buildSimMesh } from '../../js/core/sim-mesh.js';
import { TERRAIN_SCENES } from '../../js/tectonics/scenarios/terrain-scenes.js';
import { FRAME_FIELDS } from '../../js/terrain/terrain-pool.js';
import { terrainConfig } from '../../js/terrain/terrain-config.js';
import { keyOf, getFrame, simulateCached } from './history-cache.mjs';

export const MESH_SEED = 12345;                       // (the page's: every planet's sim mesh is the same; the seed shapes the world)
export const PAGE_SCENE = 'cycle';

/** The start world the page's worker runs for these settings (app/history-worker.js), and its cache key. */
export function pageWorld({ seed, cont, sim }) {
    const scene = TERRAIN_SCENES.find(s => s.id === PAGE_SCENE), world = scene.build(buildSimMesh(sim, MESH_SEED), seed, { continentalFraction: cont / 100 });
    world.config.heights = terrainConfig({});        // (as the worker sets them: the page has no overrides)
    return { scene, world, key: keyOf(world, scene.drive) };
}

/**
 * The frame at `time` Myr (a multiple of 10: the page's moments) of the page's history for these settings — the fields
 * the terrain reads (FRAME_FIELDS) and each plate's rotation. `{ full: true }`: the whole frame; `{ key }`: read that
 * entry's frame first (the page's history, as the user saw it).
 */
export async function momentFrame(root, { seed, cont, sim, time, full = false, key: theirs = null }) {
    // (key: an entry to read first — the page's own, from latest.json: built by the browser's engine, whose maths differ
    // from Node's in the last bit, so Node's key for the same settings is another entry: history-key.js)
    const pick = f => { if (full) return f; const out = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]])); out.plates = f.plates.map(p => p && { quat: p.quat }); return out; };
    const fromPage = theirs && getFrame(theirs, time);
    if (fromPage) return pick(fromPage);
    const { scene, world, key } = pageWorld({ seed, cont, sim });
    const cached = key && getFrame(key, time);
    if (cached) return pick(cached);
    if (Math.abs(time / 10 - Math.round(time / 10)) > 1e-9) throw new Error(`no frame at ${time} Myr (moments come every 10 Myr)`);
    let frame;
    simulateCached(world, { untilMyr: time, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => { if (Math.abs(f.time - time) < 1e-6) frame = f; } },
        { drive: scene.drive, spec: { scene: PAGE_SCENE, seed, cont, sim, meshSeed: MESH_SEED, heights: {}, by: 'momentFrame' } });
    if (!frame) throw new Error(`no frame at ${time} Myr (moments come every 10 Myr)`);
    return pick(frame);
}
