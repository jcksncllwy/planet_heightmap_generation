// The maps between two meshes of the sphere (moved from finish/finish-erode.js for the flexure's multigrid, lane flexure
// 2026-11-22): for each cell of a finer mesh, the coarser mesh's triangle around it — its 3 cells, their barycentric weights,
// the nearest — made once a pair and kept while both meshes are.

import { locate } from './mesh-locate.js';

// (the maps between two meshes, kept while both are: the terrain meshes are fixed, so a finish's ladder, its polish and the next
// finish ask for the same few, and each costs a point location a fine cell — ~1 s at 2.5M (gpuerode's profile))
const maps = new WeakMap();
/** For each cell of `fine`: the 3 cells of `coarse` around it, their weights, and the nearest of them. Read-only: shared. */
export function mapOnto(coarse, fine) {
    if (!maps.has(coarse)) maps.set(coarse, new WeakMap());
    const of = maps.get(coarse);
    if (!of.has(fine)) of.set(fine, locateAll(coarse, fine));
    return of.get(fine);
}
function locateAll(coarse, fine) {
    const n = fine.numCells, cells = new Int32Array(3 * n), weights = new Float32Array(3 * n), nearest = new Int32Array(n), c3 = [0, 0, 0], w3 = [0, 0, 0], { xyz } = fine;
    for (let i = 0; i < n; i++) {
        locate(coarse, xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2], c3, w3);
        let best = 0;
        for (let j = 0; j < 3; j++) { cells[3 * i + j] = c3[j]; weights[3 * i + j] = w3[j]; if (w3[j] > w3[best]) best = j; }
        nearest[i] = c3[best];
    }
    return { cells, weights, nearest };
}
/** A fine field's mean over each coarse cell (a coarse cell no fine cell fell in, rare at a factor 4, takes `empty`; NaN skipped). */
export function meanOnto(M, fine, coarseN, empty = 0) {
    const sum = new Float64Array(coarseN), cnt = new Uint32Array(coarseN), o = new Float32Array(coarseN), near = M.nearest;
    for (let i = 0; i < fine.length; i++) { const v = fine[i]; if (v === v) { sum[near[i]] += v; cnt[near[i]]++; } }
    for (let c = 0; c < coarseN; c++) o[c] = cnt[c] ? sum[c] / cnt[c] : empty;
    return o;
}
export function carry(M, values, out) {
    const { cells, weights } = M, n = out.length;
    for (let i = 0; i < n; i++) out[i] += weights[3 * i] * values[cells[3 * i]] + weights[3 * i + 1] * values[cells[3 * i + 1]] + weights[3 * i + 2] * values[cells[3 * i + 2]];
}
