// The continental margins at a moment, measured on a surface: how much of the continental crust lies under the sea, how
// wide the shelves are by kind of margin, and how deep their break lies — the reports behind the shoreline work
// (2026-10-28: the shoreline is where the surface crosses sea level, terrain/records.js marginProfile).
//
// · submerged: the share of the terrain cells on continental crust (continent or craton, by the sim cell the terrain cell
//   reads first) that lie below the sea. Earth: continental crust covers ~41 % of the surface, land ~29 % (Cogley 1984,
//   Rev. Geophys. 22) — ~30 % of the crust under the sea, its shelves alone (~7.5 % of the surface, to the shelf break)
//   ~20 %; more at a highstand (Cretaceous: ~30 % of today's land flooded besides).
// · shelf width by kind: the area of sea no deeper than shelfDepthKm below the frame's sea, joined to the coast, per km of
//   coast of the kind (coast-fractal.mjs: the zero contour's length, kinds by kindOf) — a shelf's mean width from the
//   shoreline to its break.
// · the shelf break's depth: where the sea floor off a passive coast first steepens past breakGradient (km per km) going
//   out from the shore — the median over the shelf's edge cells (a sea cell under breakMaxKm deep, steeper than that,
//   with a shoreward neighbour gentler than it).

import { CrustType } from '../../js/tectonics/model/crust.js';
import { coastLoops, coastFractal, kindOf, COAST_KINDS } from './coast-fractal.mjs';

/** Earth's shelves by kind of margin (km, shoreline to break), and the break's depth (km) — both hold through the cycle:
 *  a margin's shape is its own history's, whatever the stage (only the sea's level over it moves). */
export const EARTH_SHELF_KM = {
    'passive mature': { earth: [50, 400], source: 'Atlantic-type margins: ~50–400 km, Siberian and NW Australian shelves the widest (Shepard 1963; Harris et al. 2014, Mar. Geol. 352)' },
    'passive young': { earth: [5, 60], source: 'Red Sea and Gulf of Aden: narrow shelves on young thinned crust (recalled)' },
    active: { earth: [0, 30], source: 'Andean and Pacific-rim active margins: under ~30 km (Shepard 1963; Harris et al. 2014)' },
};
export const EARTH_BREAK_KM = { earth: [0.12, 0.2], source: 'mean ~130 m, 120–200 m on most margins (Shepard 1963; Kennett 1982) — glacial lowstands set it' };

const R = 6371;

/**
 * @param {Object} tm   the terrain mesh the surface is on
 * @param {Float32Array} z   heights (km against the frame's sea)
 * @param {Object} T   the synthesis (its sampler and records)
 * @param {Object} simMesh, frame
 * @returns {{submerged: number, landShare: number, shelfKm: Object<string, number>, coastKm: Object<string, number>, breakKm: number}}
 */
export function shelfStats(tm, z, T, simMesh, frame, { shelfDepthKm = 0.2, breakGradient = 0.009, breakMaxKm = 0.8 } = {}) {
    const n = tm.numCells, { adjOffset, adjList, xyz } = tm, cells = T.sampler.cells, rec = T.rec;
    let cont = 0, under = 0, land = 0;
    for (let t = 0; t < n; t++) {
        if (z[t] >= 0) land++;
        const c = cells[3 * t];
        if (frame.owner[c] >= 0 && (frame.type[c] === CrustType.CONTINENT || frame.type[c] === CrustType.CRATON)) { cont++; if (z[t] < 0) under++; }
    }
    // the shelf: sea no deeper than shelfDepthKm, joined to the coast through such sea; its kind the nearest sim cell's
    const kindAt = kindOf(simMesh, rec), cellKm2 = 4 * Math.PI * R * R / n, area = {}, shelf = new Uint8Array(n), queue = [];
    for (let t = 0; t < n; t++) {
        if (!(z[t] < 0 && z[t] >= -shelfDepthKm)) continue;
        for (let k = adjOffset[t]; k < adjOffset[t + 1]; k++) if (z[adjList[k]] >= 0) { shelf[t] = 1; queue.push(t); break; }
    }
    for (let i = 0; i < queue.length; i++) for (let k = adjOffset[queue[i]]; k < adjOffset[queue[i] + 1]; k++) {
        const q = adjList[k];
        if (!shelf[q] && z[q] < 0 && z[q] >= -shelfDepthKm) { shelf[q] = 1; queue.push(q); }
    }
    for (const t of queue) { const name = COAST_KINDS[kindAt(t, xyz[3 * t], xyz[3 * t + 1], xyz[3 * t + 2])]; area[name] = (area[name] ?? 0) + cellKm2; }
    const F = coastFractal(coastLoops(tm, t => z[t] < 0, z), kindAt, { kinds: COAST_KINDS });
    const shelfKm = {}, coastKm = {};
    for (const name of COAST_KINDS) { coastKm[name] = F[name]?.km ?? 0; shelfKm[name] = coastKm[name] > 0 ? (area[name] ?? 0) / coastKm[name] : NaN; }
    // the break: off passive coasts, a sea cell steeper than breakGradient whose shoreward neighbour (the shallowest) is gentler
    const grad = new Float32Array(n).fill(NaN);
    const gradAt = t => {
        if (grad[t] === grad[t]) return grad[t];
        let g = 0;
        for (let k = adjOffset[t]; k < adjOffset[t + 1]; k++) {
            const q = adjList[k], d = R * Math.acos(Math.min(1, xyz[3 * t] * xyz[3 * q] + xyz[3 * t + 1] * xyz[3 * q + 1] + xyz[3 * t + 2] * xyz[3 * q + 2]));
            if (d > 0) g = Math.max(g, Math.abs(z[q] - z[t]) / d);
        }
        return (grad[t] = g);
    };
    const depths = [];
    for (let t = 0; t < n; t++) {
        if (!(z[t] < 0 && z[t] > -breakMaxKm)) continue;
        const kd = kindAt(t, xyz[3 * t], xyz[3 * t + 1], xyz[3 * t + 2]);
        if (kd > 1) continue;                                                  // (passive coasts, young and mature)
        if (gradAt(t) < breakGradient) continue;
        let up = -1, upZ = -Infinity;
        for (let k = adjOffset[t]; k < adjOffset[t + 1]; k++) { const q = adjList[k]; if (z[q] < 0 && z[q] > upZ) { upZ = z[q]; up = q; } }
        if (up >= 0 && upZ > z[t] && gradAt(up) < breakGradient) depths.push(-z[t]);
    }
    depths.sort((a, b) => a - b);
    return { submerged: cont ? under / cont : NaN, landShare: land / n, shelfKm, coastKm, breakKm: depths.length ? depths[depths.length >> 1] : NaN, breakCells: depths.length };
}
