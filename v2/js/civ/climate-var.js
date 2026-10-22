// The civ layer's good and bad years (plans/CIV_PLAN.md; sources: plans/CIV_SOURCES.md §Climate variability): how much a
// place's rain and its rivers' floods vary from year to year, and in which patterns — from the planet's own climate model
// (climate/), not noise laid on the yields.
//
//   modes     the climate is run again under the two forcings that move the most rain from year to year on Earth: one
//             hemisphere warmer than the other (the rain belt follows the warmer — the Sahel's droughts; Folland et al.
//             1986), and the land warmer against the sea (the monsoons stronger). Each cell's rain under each, against the
//             control run, is its response; a year is a draw of how far each mode swings (the timing is weather's, the
//             only part drawn at random: a climate model without weather cannot say *when*, only where and how much)
//   storms    a dry place's rain falls in few storms, so its total varies more: a Poisson count of storms of eventMm
//             each (CV = 1/√(P/eventMm)) — Conrad 1941's curve of variability against mean rain. Storms are shared over a
//             region (regionDeg)
//   rivers    each mode's runoff (Fu 1981's Budyko curve: the land's own evaporation demand takes its share first, so
//             runoff swings more than rain) routed down the land (a priority flood, the steepest way down): a river's
//             flood answers its whole catchment's rain — the Nile Ethiopia's, the Euphrates Anatolia's — and its storms
//             average out over a big catchment
//
// Scale-invariant: regions and modes are in degrees and W/m², not cells.

import { CIV } from './civ-config.js';
import { planetClimate } from '../climate/climate.js';
import { statValue } from '../climate/cell-stats.js';
import { MinHeap } from '../core/min-heap.js';

const DEG = 180 / Math.PI;
/** The modes, as [hemi, land] forcings of one standard deviation's sign: + and − of each. */
const MODES = [['hemi', 1], ['hemi', -1], ['land', 1], ['land', -1]];

/** The ensemble's runs, as climate options: the control, then each mode's swing (+ and −) — rain per terrain cell is
 *  ensembleRain's. Split out so a page can run them in parallel (civ/climate-run-worker.js). */
export const ensembleForcings = (C = CIV) => [null, ...MODES.map(([k, s]) => ({ [k]: s * C.modeWm2 }))];
/** One run's rain (mm/yr per cell) on a world's mesh. */
export function ensembleRain({ xyz, z, land }, forcing, C = CIV) {
    return planetClimate({ xyz, elevKm: z, axes: 'z-up', land }, { gridStepDeg: C.varGridDeg, forcing }).cell.pAnnual;
}
export const landOf = ocean => { const l = new Uint8Array(ocean.length); for (let c = 0; c < l.length; c++) l[c] = ocean[c] ? 0 : 1; return l; };

/** Fu's runoff (mm/yr) from rain P and potential evaporation PET (mm/yr), shape w. */
export const fuRunoff = (P, PET, w) => (P > 0 && PET > 0 ? P * ((1 + Math.pow(PET / P, w)) ** (1 / w) - PET / P) : Math.max(0, P));

/**
 * Each cell's year-to-year variability.
 * @param w the world (mesh, z, ocean, lake, pAnnual, stats); @param sub civSubstrate(w)
 * @param runs the ensemble's rain, if already run (ensembleForcings' order), else run here
 * @returns { rainLn: Float32Array(4n) — ln(rain under mode k / control) per cell, k as MODES; riverLn: the same for the
 *   discharge through each cell; rainCV, riverCV: the storms' share (CV) of each; region: each cell's storm region; ms }
 */
export function climateVariability(w, sub, C = CIV, runs = null) {
    const t0 = performance.now();
    const { mesh, z, ocean, lake } = w, n = mesh.numCells, xyz = mesh.xyz, { adjOffset, adjList } = mesh;
    const land = landOf(ocean);
    // ── the control and the four swings ──
    runs ??= ensembleForcings(C).map(f => ensembleRain({ xyz, z, land }, f, C));
    const P0 = runs[0], rainLn = new Float32Array(4 * n);
    MODES.forEach((_, m) => {
        const Pm = runs[m + 1];
        for (let c = 0; c < n; c++) if (land[c]) rainLn[4 * c + m] = Math.log(Math.max(1, Pm[c]) / Math.max(1, P0[c]));
    });
    // ── storms: the world's own rain (its finish's, or WorldClim's), in storms of eventMm ──
    const P = w.pAnnual, rainCV = new Float32Array(n), region = new Int32Array(n);
    const cols = Math.round(360 / C.regionDeg);
    for (let c = 0; c < n; c++) {
        const lat = Math.asin(xyz[3 * c + 2]) * DEG, lon = Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * DEG;
        region[c] = Math.min(cols / 2 - 1, Math.floor((lat + 90) / C.regionDeg)) * cols + Math.min(cols - 1, Math.floor((lon + 180) / C.regionDeg));
        if (land[c] && P[c] > 0) rainCV[c] = 1 / Math.sqrt(Math.max(1, P[c] / C.eventMm));
    }
    // ── rivers: each mode's runoff, routed ──
    const { order, recv } = drainage(mesh, z, ocean);
    const cellKm2 = sub.cellKm2, regionCells = Math.max(1, (C.regionDeg * 111) ** 2 / cellKm2);
    const acc = Array.from({ length: 5 }, () => new Float64Array(n)), vAcc = new Float64Array(n);
    for (let c = 0; c < n; c++) {
        if (!land[c] || !(P[c] > 0)) continue;
        const ar = statValue(w.stats.aridity, 'aridity', c), pet = ar > 0 ? P[c] / ar : P[c];
        const R0 = fuRunoff(P[c], pet, C.fuW);
        acc[0][c] = R0 * cellKm2;
        for (let m = 0; m < 4; m++) acc[m + 1][c] = fuRunoff(P[c] * Math.exp(rainLn[4 * c + m]), pet, C.fuW) * cellKm2;
        // (the storms' share of the runoff: the rain's, × the runoff's elasticity to rain; correlated within a region)
        const el = R0 > 0 ? (fuRunoff(P[c] * 1.01, pet, C.fuW) / R0 - 1) / 0.01 : 0;
        vAcc[c] = (acc[0][c] * el * rainCV[c]) ** 2 * regionCells;
    }
    for (let i = order.length - 1; i >= 0; i--) {
        const c = order[i], r = recv[c];
        if (r < 0 || ocean[r]) continue;
        for (let m = 0; m < 5; m++) acc[m][r] += acc[m][c];
        vAcc[r] += vAcc[c];
    }
    const riverLn = new Float32Array(4 * n), riverCV = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        const q = acc[0][c];
        if (!(q > 0)) continue;
        for (let m = 0; m < 4; m++) riverLn[4 * c + m] = Math.log(Math.max(1e-6, acc[m + 1][c]) / q);
        riverCV[c] = Math.min(2, Math.sqrt(vAcc[c]) / q);
    }
    // (the world's own rivers — the finish's, or HydroRIVERS — need not run in the cells this coarser routing finds: each
    // of their cells takes the strongest routed flow within riverSnapKm)
    const hops = Math.max(1, Math.round(C.riverSnapKm / sub.edgeKm)), snapLn = riverLn.slice(), snapCV = riverCV.slice();
    for (let c = 0; c < n; c++) {
        if (!(sub.river.q[c] > 0)) continue;
        let best = c, ring = [c];
        const seen = new Set(ring);
        for (let h = 0; h < hops; h++) {
            const next = [];
            for (const a of ring) for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
                const b = adjList[k];
                if (seen.has(b) || ocean[b]) continue;
                seen.add(b); next.push(b);
                if (acc[0][b] > acc[0][best]) best = b;
            }
            ring = next;
        }
        for (let m = 0; m < 4; m++) snapLn[4 * c + m] = riverLn[4 * best + m];
        snapCV[c] = riverCV[best];
    }
    riverLn.set(snapLn); riverCV.set(snapCV);
    return { rainLn, riverLn, rainCV, riverCV, region, regions: cols * cols / 2, q0: acc[0], ms: performance.now() - t0 };
}

/** The way down: a priority flood from the sea (each land cell's spill level), then each cell's steepest way down the
 *  filled surface to a cell flooded before it. order: land cells from the sea up; recv: each one's receiver. */
function drainage(mesh, z, ocean) {
    const n = mesh.numCells, { adjOffset, adjList } = mesh, fill = new Float32Array(n), rank = new Int32Array(n).fill(-1);
    const order = [], heap = new MinHeap(1 << 16), recv = new Int32Array(n).fill(-1);
    for (let c = 0; c < n; c++) if (ocean[c]) { rank[c] = -2; fill[c] = Math.min(0, z[c]); }
    for (let c = 0; c < n; c++) {
        if (!ocean[c]) continue;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const b = adjList[k]; if (!ocean[b] && rank[b] === -1) { rank[b] = -3; fill[b] = Math.max(0, z[b]); heap.push(fill[b], b); } }
    }
    while (heap.size) {
        const c = heap.pop();
        if (rank[c] >= 0) continue;
        rank[c] = order.length; order.push(c);
        let best = -1, drop = -Infinity;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const b = adjList[k];
            if (rank[b] === -2 || (rank[b] >= 0 && rank[b] < rank[c])) { const s = fill[c] - fill[b]; if (s > drop) { drop = s; best = b; } }
            else if (rank[b] === -1 || rank[b] === -3) {
                const lv = Math.max(fill[c], z[b]);
                if (rank[b] === -1 || lv < fill[b]) { rank[b] = -3; fill[b] = lv; heap.push(lv, b); }
            }
        }
        recv[c] = best;
    }
    return { order, recv };
}

/** A year's swing of the two modes: a red-noise series (lag-1 correlation modeRho), one standard normal each, the same
 *  each run. yearOf: years from the start; returns [hemi, land]. */
export function modeSeries(years, C = CIV) {
    const a = new Float32Array(2 * years), s = Math.sqrt(1 - C.modeRho * C.modeRho);
    let h = 0, l = 0;
    for (let y = 0; y < years; y++) {
        h = C.modeRho * h + s * normal(y, 1); l = C.modeRho * l + s * normal(y, 2);
        a[2 * y] = h; a[2 * y + 1] = l;
    }
    return a;
}

/** A standard normal from a hash of two integers (Box–Muller): the same each run. */
export function normal(a, b) {
    const u = hash01(a, b), v = hash01(b + 0x51ed27, a ^ 0x2545f491);
    return Math.sqrt(-2 * Math.log(Math.max(1e-12, u))) * Math.cos(2 * Math.PI * v);
}
function hash01(a, b) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

/** A place's year-to-year spread (CV) of rain (lnTable rainLn, cv rainCV[c]) or of its river's flow (riverLn, riverCV),
 *  by sampling the modes and the storms: the same each run. */
export function spreadOf(lnTable, cv, c, draws = 256) {
    let s = 0, s2 = 0;
    for (let k = 0; k < draws; k++) {
        const x = Math.exp(modeLn(lnTable, c, normal(k, 201), normal(k, 202)) + cv * normal(k, 203));
        s += x; s2 += x * x;
    }
    const m = s / draws;
    return Math.sqrt(Math.max(0, s2 / draws - m * m)) / m;
}

/** ln of a cell's rain (or flow: lnTable riverLn) against its mean in a year whose modes swing (aH, aL): each mode's
 *  response, + or − as it swings (the response is not symmetric: a rain belt's edge loses more than it gains). */
export function modeLn(lnTable, c, aH, aL) {
    const o = 4 * c;
    return (aH >= 0 ? aH * lnTable[o] : -aH * lnTable[o + 1]) + (aL >= 0 ? aL * lnTable[o + 2] : -aL * lnTable[o + 3]);
}
