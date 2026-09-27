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

// The warp's noise, read from a table: its three components precomputed over a cube map around the sphere (WARP_N
// cells a face edge; about 40–80 km apart) and read back bilinearly — a smooth warp like the noise it samples, within
// ~0.3 km of it (1.8 km at worst; the warp itself moves points by up to 70 km), for a fifth of the cost: every point of
// every frame is warped as it is read on its plate's raster. Continuous across the faces (their edges share samples).
const WARP_N = 256, WARP_AXES = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
const warpTables = new Map();
/** The warp table for a seed and warp frequency (built once, ~0.2 s; 4.8 MB). */
export function warpField(seed, cfg) {
    const key = `${seed}|${cfg.warpScale}`;
    let W = warpTables.get(key);
    if (W) return W;
    const noise = warpNoise(seed), f = cfg.warpScale, N = WARP_N, S = N + 1, T = new Float32Array(6 * S * S * 3), p = [0, 0, 0];
    for (let face = 0; face < 6; face++) {
        const [a, b, c] = WARP_AXES[face >> 1];
        for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
            p[a] = face & 1 ? -1 : 1; p[b] = -1 + 2 * i / N; p[c] = -1 + 2 * j / N;
            const l = Math.hypot(p[0], p[1], p[2]), x = p[0] / l, y = p[1] / l, z = p[2] / l, o = 3 * ((face * S + j) * S + i);
            T[o] = noise.fbm(x * f + 11.3, y * f + 3.1, z * f + 7.7, 4, 0.5);
            T[o + 1] = noise.fbm(x * f + 2.9, y * f + 17.2, z * f + 5.5, 4, 0.5);
            T[o + 2] = noise.fbm(x * f + 23.4, y * f + 8.8, z * f + 13.6, 4, 0.5);
        }
    }
    W = { N, S, T };
    warpTables.set(key, W);
    if (warpTables.size > 4) warpTables.delete(warpTables.keys().next().value);
    return W;
}

/**
 * A point (unit vector) displaced by the sampling warp (warpField's table), into `out` (unit): read at the point itself,
 * so a warp read in a plate's frame rides with the plate.
 */
export function warpPoint(W, cfg, x, y, z, out) {
    const amp = cfg.warpKm / 6371, ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let face, m, pb, pc;                                   // (the face the point is on, and its two coordinates there)
    if (ax >= ay && ax >= az) { face = x > 0 ? 0 : 1; m = ax; pb = y; pc = z; }
    else if (ay >= az) { face = y > 0 ? 2 : 3; m = ay; pb = z; pc = x; }
    else { face = z > 0 ? 4 : 5; m = az; pb = x; pc = y; }
    const { N, S, T } = W, fu = (pb / m + 1) * 0.5 * N, fv = (pc / m + 1) * 0.5 * N;
    const i = Math.min(N - 1, Math.floor(fu)), j = Math.min(N - 1, Math.floor(fv)), tu = fu - i, tv = fv - j;
    const o00 = 3 * ((face * S + j) * S + i), o10 = o00 + 3, o01 = o00 + 3 * S, o11 = o01 + 3;
    const w00 = (1 - tu) * (1 - tv), w10 = tu * (1 - tv), w01 = (1 - tu) * tv, w11 = tu * tv;
    let dx = w00 * T[o00] + w10 * T[o10] + w01 * T[o01] + w11 * T[o11];
    let dy = w00 * T[o00 + 1] + w10 * T[o10 + 1] + w01 * T[o01 + 1] + w11 * T[o11 + 1];
    let dz = w00 * T[o00 + 2] + w10 * T[o10 + 2] + w01 * T[o01 + 2] + w11 * T[o11 + 2];
    const radial = dx * x + dy * y + dz * z;
    dx = x + (dx - radial * x) * amp; dy = y + (dy - radial * y) * amp; dz = z + (dz - radial * z) * amp;
    const l = Math.hypot(dx, dy, dz);
    out[0] = dx / l; out[1] = dy / l; out[2] = dz / l;
    return out;
}

/** sampleOnto for the positions from…to−1 of `xyz`, into cells / weights (indexed alike): any split gives the same result. */
export function sampleRange(simMesh, xyz, cfg, seed, from, to, cells, weights) {
    const W = warpField(seed, cfg), q = [0, 0, 0];
    const c3 = [0, 0, 0], w3 = [0, 0, 0];
    for (let t = from; t < to; t++) {
        warpPoint(W, cfg, xyz[3 * t], xyz[3 * t + 1], xyz[3 * t + 2], q);
        locate(simMesh, q[0], q[1], q[2], c3, w3);
        cells[3 * t] = c3[0]; cells[3 * t + 1] = c3[1]; cells[3 * t + 2] = c3[2];
        weights[3 * t] = w3[0]; weights[3 * t + 1] = w3[1]; weights[3 * t + 2] = w3[2];
    }
}
