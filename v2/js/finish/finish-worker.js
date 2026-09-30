// The Finish step's worker (plans/V2_FINISH_PLAN.md): finishes one moment (finish.js) and sends back its picture of
// heights. It keeps the meshes it built (a 10M-cell mesh takes ~15 s to build — only this worker ever holds it); its
// terrain pool (the surface, in slices) lives only for the surface and is let go before the heavy stages.
//
// Message in:  {type: 'finish', id, frame (the terrain fields of a frame, terrain-pool.js FRAME_FIELDS, and the plates'
//              rotations), simMesh {numCells, xyz, adjOffset, adjList}, seed, cells, width, delaunatorUrl, poolSize?}
// Messages out: {type: 'stage', id, stage} · {type: 'progress', id, share} (the picture) · {type: 'done', id, raster:
//              {w, h, heightM, ocean}, stats, ms} · {type: 'error', id, message}

import { finishPlanet, finishRaster } from './finish.js';
import { TerrainPool } from '../terrain/terrain-pool.js';
import { meshFromArrays } from '../core/sim-mesh.js';
import { setDelaunator } from '../../../js/sphere-mesh.js';

let sim = null, simCells = 0, delaunatorSet = false;

self.onmessage = async ({ data }) => {
    if (data.type !== 'finish') return;
    const { id, frame, seed, cells, width, poolSize = null } = data;
    try {
        if (!delaunatorSet) { setDelaunator((await import(data.delaunatorUrl)).default); delaunatorSet = true; }
        if (!sim || simCells !== data.simMesh.numCells) { sim = meshFromArrays(data.simMesh); simCells = data.simMesh.numCells; }
        const pool = await TerrainPool.create(sim, poolSize);
        const out = await finishPlanet({ frame, simMesh: sim, seed, cells, pool, closePool: true, onStage: stage => self.postMessage({ type: 'stage', id, stage }) });
        self.postMessage({ type: 'stage', id, stage: 'picture' });
        const t0 = performance.now();
        const raster = finishRaster(out.mesh, out.z, out.ocean, width, share => self.postMessage({ type: 'progress', id, share }));
        out.ms.picture = performance.now() - t0;
        self.postMessage({ type: 'done', id, raster, stats: out.stats, ms: out.ms }, [raster.heightM.buffer, raster.ocean.buffer]);
    } catch (err) {
        self.postMessage({ type: 'error', id, message: err?.stack ?? String(err) });
    }
};
