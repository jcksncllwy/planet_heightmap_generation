// What a finished moment hands on, in one shape for the page and for Node (so the finish cache — tools/lib/finish-cache.mjs
// — keeps one thing, whoever made it): from finishPlanet's output,
//   page:  what the finish worker sends the page ('done'): its picture (finishRaster at `width`: heights, sea, lakes, and
//          the land's climate), its rivers, its own climate (the grid's fields, climate-fields.js), the People layer's
//          world (with civ), its stats and stage times;
//   cells: the finish's per-cell fields on its own mesh (terrain-mesh.js terrainMesh(cells): the same mesh built again
//          from the detail alone): z (km), ocean, lake (finish-hydro.js Water kinds), lakeLevel (km), glaciated — what a
//          tool measures the finished ground by.

import { finishRaster } from './finish.js';
import { climateTransfers } from '../evolution/climate-fields.js';

/**
 * @param {Object} out    finishPlanet's output
 * @param {{width: number, civ?: boolean, onProgress?: (share: number) => void}} o
 * @returns {Promise<{page: Object, cells: Object}>}
 */
export async function finishResult(out, { width, civ: wantCiv = false, onProgress = null }) {
    const t0 = performance.now();
    let civ = null;
    if (wantCiv) try { const w = (await import('../civ/civ-page.js')).civWorldFromFinish(out); civ = { ...w, mesh: { numCells: w.mesh.numCells, xyz: w.mesh.xyz, adjOffset: w.mesh.adjOffset, adjList: w.mesh.adjList } }; }
    catch (err) { console.warn('[finish] no world for the civ layer:', err); }
    const raster = finishRaster(out.mesh, out.z, out.ocean, width, onProgress, out.lake, out.lakeLevel, out.climate.cell);
    out.ms.picture = performance.now() - t0;
    // (the finished moment's climate: the grid's fields, and its own picture of the land's climate)
    const climate = { ...out.climate.page, raster: raster.climate };
    delete raster.climate;
    const page = { raster, rivers: out.rivers, climate, civ, stats: out.stats, ms: out.ms };
    const cells = { numCells: out.mesh.numCells, z: out.z, ocean: out.ocean, lake: out.lake ?? null, lakeLevel: out.lakeLevel ?? null, glaciated: out.glaciated ?? null };
    return { page, cells };
}

/** The buffers of a page result to transfer to the page (they are the worker's no more). */
export function pageTransfers(page) {
    const { raster, rivers: rv, climate } = page;
    return [...new Set([raster.heightM.buffer, raster.ocean.buffer, raster.water.buffer, rv.start.buffer, rv.lat.buffer, rv.lon.buffer, rv.q.buffer, rv.season.buffer,
        ...(rv.regime ? [rv.regime.buffer, rv.floodFrom.buffer, rv.floodTo.buffer, rv.farFed.buffer] : []), ...climateTransfers(climate)])];
}
