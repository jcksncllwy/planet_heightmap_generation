// The terrain mesh — finer than the 40K-cell sim mesh, at any resolution — and the sampler that carries the sim's
// records onto it. Heights are built here, not on the sim mesh: a mountain range is only 3–10 sim cells across, so
// its ridges and valleys all live below the sim's resolution.

import { buildSimMesh, meshFromArrays } from '../core/sim-mesh.js';
import { locate } from '../core/mesh-locate.js';
import { FastNoise as SimplexNoise } from '../core/fast-noise.js';     // (bit-identical to V1's SimplexNoise, faster)

/** The terrain mesh is the same for every planet (like the sim mesh); the seed only shapes the world on it. */
export const TERRAIN_MESH_SEED = 20260924;
const meshes = new Map();

/** A terrain mesh of about `numCells` cells (same shape as a SimMesh), built once per size. */
export function terrainMesh(numCells) {
    if (!meshes.has(numCells)) meshes.set(numCells, buildSimMesh(numCells, TERRAIN_MESH_SEED));
    return meshes.get(numCells);
}

/**
 * terrainMesh, built in a worker where the page has workers (terrain/mesh-worker.js) — the page stays responsive, and
 * the build can run alongside the history — else right here. The same mesh either way.
 * @returns {Promise<Object>}
 */
export function terrainMeshAsync(numCells) {
    if (meshes.has(numCells)) return Promise.resolve(meshes.get(numCells));
    if (typeof Worker === 'undefined' || typeof import.meta.resolve !== 'function') return Promise.resolve(terrainMesh(numCells));
    const pending = building.get(numCells) ?? new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./mesh-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
            worker.terminate(); building.delete(numCells);
            if (data.error) { reject(new Error(`mesh worker: ${data.error}`)); return; }
            const mesh = meshFromArrays(data);
            meshes.set(numCells, mesh);
            resolve(mesh);
        };
        worker.onerror = e => { worker.terminate(); building.delete(numCells); reject(new Error(`mesh worker: ${e.message}`)); };
        worker.postMessage({ numCells, seed: TERRAIN_MESH_SEED, delaunatorUrl: import.meta.resolve('delaunator') });
    });
    building.set(numCells, pending);
    return pending;
}
const building = new Map();

/**
 * For every terrain cell: the three sim cells around it and their weights — a piecewise-linear carry of any sim
 * field. The lookup position is first displaced by smooth noise (up to cfg.warpKm), so the straight edges of the sim
 * triangles never show: coasts and belt edges come out organic.
 * @returns {{cells: Int32Array, weights: Float32Array}}   3 per terrain cell
 */
export function sampleOnto(simMesh, tMesh, cfg, seed) {
    const n = tMesh.numCells, cells = new Int32Array(3 * n), weights = new Float32Array(3 * n);
    sampleRange(simMesh, tMesh.xyz, cfg, seed, 0, n, cells, weights);
    return { cells, weights };
}

/** The noise that warps where a point samples the sim mesh (so the mesh's straight triangle edges never show). */
export const warpNoise = seed => new SimplexNoise(seed * 7 + 101);

/**
 * A point (unit vector) displaced by the sampling warp, into `out` (unit): read at the point itself, so a warp read in a
 * plate's frame rides with the plate.
 */
export function warpPoint(noise, cfg, x, y, z, out) {
    const f = cfg.warpScale, amp = cfg.warpKm / 6371;
    let dx = noise.fbm(x * f + 11.3, y * f + 3.1, z * f + 7.7, 4, 0.5), dy = noise.fbm(x * f + 2.9, y * f + 17.2, z * f + 5.5, 4, 0.5), dz = noise.fbm(x * f + 23.4, y * f + 8.8, z * f + 13.6, 4, 0.5);
    const radial = dx * x + dy * y + dz * z;
    dx = x + (dx - radial * x) * amp; dy = y + (dy - radial * y) * amp; dz = z + (dz - radial * z) * amp;
    const l = Math.hypot(dx, dy, dz);
    out[0] = dx / l; out[1] = dy / l; out[2] = dz / l;
    return out;
}

/** sampleOnto for the positions from…to−1 of `xyz`, into cells / weights (indexed alike): any split gives the same result. */
export function sampleRange(simMesh, xyz, cfg, seed, from, to, cells, weights) {
    const noise = warpNoise(seed), q = [0, 0, 0];
    const c3 = [0, 0, 0], w3 = [0, 0, 0];
    for (let t = from; t < to; t++) {
        warpPoint(noise, cfg, xyz[3 * t], xyz[3 * t + 1], xyz[3 * t + 2], q);
        locate(simMesh, q[0], q[1], q[2], c3, w3);
        cells[3 * t] = c3[0]; cells[3 * t + 1] = c3[1]; cells[3 * t + 2] = c3[2];
        weights[3 * t] = w3[0]; weights[3 * t + 1] = w3[1]; weights[3 * t + 2] = w3[2];
    }
}
