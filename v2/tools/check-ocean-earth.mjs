// The water inventory under Earth's conditions (lane sliders; Jackson via gulltoppr, 2026-11-06: "the model must produce
// Earth values GIVEN Earth's conditions"). Earth's own surface — ETOPO5 (NOAA NGDC 1988, 5′ grid, ice surface on the ice
// sheets), binned onto the sim mesh by area — with 1.0× Earth's water (tectonics/ocean/inventory.js EARTH_OCEAN_KM3,
// 1.332e9 km³, Charette & Smith 2010) poured onto it from its lowest cell: the sea must stand where Earth's does (0 m),
// over Earth's land share (29.2 %: ETOPO-class hypsometry; Cogley 1984 29.2 %), at two mesh sizes.
//
// What this proves, and what it does not: the solve (one priority flood and a running sum) and the volume are right
// together on a real hypsometry, and the mesh's binning does not bias the level (scale). It is not a test of the history:
// the volume was itself measured on Earth's relief (ETOPO1), so Earth's water on Earth's ground can only miss through the
// solve, the binning, or the grid (ETOPO5 against ETOPO1). The seeds' level, land and flooding are outcomes, reported
// beside Earth's ranges by tools/ocean-drift.mjs and the history suites.
//
// Tolerances, derived: a volume error of 1 % (ETOPO5 against ETOPO1's 1.335e9, the 5′ grid's smoothing of trenches and
// shelves) moves the level by 0.01 × 1.332e9 / 3.61e8 km² ≈ 37 m; the level is held to ±60 m. Land to ±1.5 points:
// Earth's hypsometry has ~2.5 % of the surface between 0 and −200 m (the shelves), so 60 m of level is ~0.75 point, and
// the binning of coasts on a 40K mesh (~110 km cells) another few tenths.
// Data: tuning/civ/fetch-earth.sh (gitignored tuning/civ/data/raw/etopo/ETOPO5.DAT). Missing data fails the run.
// Usage: node v2/tools/check-ocean-earth.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { check, report, section, finish, labMesh } from './lib/check-kit.mjs';
import { pourOcean, volumeAt, EARTH_OCEAN_KM3 } from '../js/tectonics/ocean/inventory.js';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ETOPO = path.join(ROOT, 'tuning/civ/data/raw/etopo/ETOPO5.DAT');
const EARTH_LAND = 0.292, LEVEL_TOL_KM = 0.06, LAND_TOL = 0.015;

/** ETOPO5 (4320 × 2160 big-endian int16 m, rows from 90° N, columns from 0° E) averaged over each mesh cell by area. */
function earthSurfaceKm(mesh, buf) {
    const n = mesh.numCells, sum = new Float64Array(n), wt = new Float64Array(n), D = Math.PI / 180;
    for (let r = 0; r < 2160; r += 2) {
        const la = (90 - (r + 0.5) / 12) * D, cl = Math.cos(la), sl = Math.sin(la);
        for (let q = 0; q < 4320; q += 2) {
            const lo = ((q + 0.5) / 12) * D, c = mesh.index.nearest(cl * Math.cos(lo), cl * Math.sin(lo), sl);
            sum[c] += cl * buf.readInt16BE(2 * (r * 4320 + q)); wt[c] += cl;
        }
    }
    const z = new Float32Array(n);
    for (let c = 0; c < n; c++) z[c] = wt[c] > 0 ? sum[c] / wt[c] / 1000 : NaN;
    // (a cell no pixel fell in, at 160K near the poles' sparse sampling: its neighbours' mean)
    for (let c = 0; c < n; c++) if (z[c] !== z[c]) { let s = 0, k = 0; for (let j = mesh.adjOffset[c]; j < mesh.adjOffset[c + 1]; j++) { const v = z[mesh.adjList[j]]; if (v === v) { s += v; k++; } } z[c] = k ? s / k : 0; }
    return z;
}

section('Earth\'s water on Earth\'s ground (ETOPO5)');
if (!fs.existsSync(ETOPO)) {
    check('ETOPO5 present (run tuning/civ/fetch-earth.sh)', false, ETOPO);
} else {
    const buf = fs.readFileSync(ETOPO), levels = [];
    for (const cells of [40000, 160000]) {
        const mesh = labMesh(cells), z = earthSurfaceKm(mesh, buf), t0 = performance.now();
        const P = pourOcean(mesh, z, EARTH_OCEAN_KM3), ms = performance.now() - t0, n = mesh.numCells;
        const land = 1 - P.seaCells / n, v0 = volumeAt(mesh, z, P.spill, 0);
        levels.push(P.levelKm);
        check(`${cells / 1000}K: the sea stands at Earth's (0 ± ${LEVEL_TOL_KM * 1000} m)`, Math.abs(P.levelKm) <= LEVEL_TOL_KM, `${(P.levelKm * 1000).toFixed(0)} m`);
        check(`${cells / 1000}K: land share Earth's (${(100 * EARTH_LAND).toFixed(1)} ± ${(100 * LAND_TOL).toFixed(1)} %)`, Math.abs(land - EARTH_LAND) <= LAND_TOL, `${(100 * land).toFixed(1)} %`);
        report(`${cells / 1000}K: the ocean ETOPO5 holds below 0 m on this mesh`, v0 / 1e9, { earth: [1.31, 1.36], unit: 'e9 km³', source: 'Charette & Smith 2010: 1.332e9 (ETOPO1)', digits: 3 });
        report(`${cells / 1000}K: ground below the sea with no way to it`, 100 * P.below / n, { unit: '%', digits: 2, detail: 'the Caspian, the Dead Sea, Qattara, Turpan: closed hollows, land to the solve' });
        report(`${cells / 1000}K: the solve's cost`, ms, { unit: 'ms', digits: 0 });
    }
    check('the level holds across mesh sizes (40K against 160K, within 30 m)', Math.abs(levels[0] - levels[1]) <= 0.03, levels.map(l => `${(l * 1000).toFixed(0)} m`).join(' · '));
}
finish('Ocean under Earth\'s conditions');
