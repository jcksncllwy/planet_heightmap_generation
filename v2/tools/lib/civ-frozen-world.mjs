// A finish's civ fields kept in one file (civgpu-profile.mjs writes them), lived on at either mesh: taken down to the page's
// PAGE_CELLS as civWorldFromFinish does, or at the finish's own cells (civWorldFromFinish's `small` branch, which the
// page's PAGE_CELLS keeps from a finish this big). Frozen: a file read back is the same world whatever code moved since,
// so fingerprints before and after a change compare (civ-fingerprint.mjs --world).

import fs from 'node:fs';
import v8 from 'node:v8';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../../js/sphere-mesh.js';
import { meshFromArrays } from '../../js/core/sim-mesh.js';
import { cropsFromMonths } from '../../js/civ/crops.js';
import { civWorldFromFinish, seaOf } from '../../js/civ/civ-page.js';

setDelaunator(Delaunator);                            // (the page's 160K mesh is built to take a finish down to it)

/** The kept finish (mesh as arrays). */
export function readFrozen(file) { const fin = v8.deserialize(fs.readFileSync(file)); fin.mesh = meshFromArrays(fin.mesh); return fin; }

/** The civ world from a kept finish: at `cells` (taken down) when the finish has more, else at its own. */
export function civWorldAt(fin, cells = null) {
    if (cells && fin.mesh.numCells > 1.01 * cells) return civWorldFromFinish(fin);           // (the page's reduction, to PAGE_CELLS)
    const cc = fin.climate.cell, L = fin.civ ?? {}, R = fin.rivers, n = fin.mesh.numCells, xyz = fin.mesh.xyz;
    const rivers = { lat: R.lat.slice(), lon: R.lon.slice(), q: R.q.slice(), regime: R.regime?.slice() ?? null, farFed: R.farFed?.slice() ?? null };
    return { mesh: fin.mesh, z: fin.z, ocean: fin.ocean, lake: fin.lake, koppen: cc.koppen, tAnnual: cc.tAnnual, pAnnual: cc.pAnnual,
        stats: cc.stats, rivers, loess: L.loess ?? null, erg: L.erg ?? null, ice: L.ice ?? null, vector: L.vector ?? null, flow: L.flow ?? null, sea: seaOf(fin.climate.page),
        crops: L.months ? cropsFromMonths(L.months, n, c => Math.asin(xyz[3 * c + 2])) : null };
}

export const worldOfFile = (file, cells = null) => civWorldAt(readFrozen(file), cells);
