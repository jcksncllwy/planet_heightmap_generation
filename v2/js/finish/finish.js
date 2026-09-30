// The Finish step (plans/V2_FINISH_PLAN.md): one moment of a history sculpted with care, on request — the surface
// domain-warped and roughened where it is high and steep (F1), the climate calculated on it, the rivers carving it for
// longer with the climate's runoff, dry basins left closed, sediment laid down, hillslopes by climate (F2), an Earth-like
// last ice age (F3), and the wind's work (F4). Runs in finish-worker.js (or Node): the terrain pool builds the surface in
// slices, everything else runs here, on a mesh of any size — 10M cells included, which only this worker holds.

import { FINISH } from './finish-config.js';
import { LatLonGrid } from './finish-grid.js';
import { closedBasins } from './finish-basins.js';
import { depositSediment, creepByClimate, dissect } from './finish-sediment.js';
import { lastIceAge } from './finish-ice.js';
import { windWork } from './finish-wind.js';
import { terrainMesh } from '../terrain/terrain-mesh.js';
import { terrainConfig } from '../terrain/terrain-config.js';
import { carveLadder, carveSettings } from '../terrain/synthesize.js';
import { carveTerrain, forgetMesh } from '../terrain/carve.js';
import { forgetEdgeKm } from '../core/min-heap.js';
import { planetClimate } from '../climate/climate.js';
import { CORE_DEFAULTS } from '../climate/core.js';
import { FastNoise } from '../core/fast-noise.js';
import { locate } from '../core/mesh-locate.js';

const R = 6371;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The stages, in order, with their rough share of the time (for the progress bar). */
export const STAGES = [['mesh', 0.12], ['surface', 0.2], ['climate', 0.1], ['rivers', 0.22], ['sediment', 0.06], ['hillslopes', 0.05], ['ice age', 0.08], ['wind', 0.05], ['sea', 0.02], ['picture', 0.1]];

/**
 * @param {{frame: Object, simMesh: Object, seed: number, cells: number, pool: import('../terrain/terrain-pool.js').TerrainPool,
 *          onStage?: (name: string) => void, F?: Object, cfg?: Object}} o
 * @returns {Promise<{mesh: Object, z: Float32Array, ocean: Uint8Array, ms: Object, stats: Object}>}
 */
export async function finishPlanet({ frame, simMesh, seed, cells, pool, closePool = false, onStage = () => {}, F = FINISH, cfg = terrainConfig(), debug = false }) {
    const ms = {}, stats = {};
    let t0 = performance.now();
    const lap = name => { const t = performance.now(); ms[name] = t - t0; t0 = t; };
    onStage('mesh');
    const mesh = terrainMesh(cells), n = mesh.numCells, cellKm2 = 4 * Math.PI * R * R / n;
    lap('mesh');

    // ── F1: the surface, domain-warped (its positions displaced before anything is read there), roughened where high ──
    onStage('surface');
    const warped = { numCells: n, xyz: warpPositions(mesh, seed, F), edgeKm: mesh.edgeKm };
    const surf = await pool.synthesize(frame, warped, { cfg, seed, records: false, carveInputs: true });
    if (closePool) pool.terminate();                                  // (its workers' memory back before the heavy stages)
    let carveIn = surf.carveIn;
    const z = surf.heightKm, fade = lam => smooth(cfg.minWavesPerCell, cfg.fullWavesPerCell, lam / mesh.edgeKm);
    roughen(mesh, z, seed, F, fade);
    lap('surface');

    // ── the climate, on this surface ──
    onStage('climate');
    let res = planetClimate({ xyz: mesh.xyz, elevKm: z, axes: 'z-up' });
    const { koppen, tAnnual: tAnn, pAnnual: pAnn, lat, lon } = res.cell, G = res.grid.size;
    for (let c = 0; c < n; c++) if (pAnn[c] > F.rainMaxMm) pAnn[c] = F.rainMaxMm;     // (the climate's rare wet hotspots)
    // (the warmest month at sea level, and the winds, on the climate's grid)
    const gamma = CORE_DEFAULTS.lapseRateCPerKm, warmG = new Float32Array(G).fill(-Infinity);
    for (let g = 0; g < G; g++) {
        const href = res.surface.meanLandKm[g] === res.surface.meanLandKm[g] ? Math.max(0, res.surface.meanLandKm[g]) : 0;
        for (let m = 0; m < 12; m++) { const t = res.months.T[m * G + g] + gamma * href; if (t > warmG[g]) warmG[g] = t; }
    }
    const circ = res.stages.circulation, year = (a, m = -1) => { const o = new Float32Array(G); for (let g = 0; g < G; g++) { if (m >= 0) o[g] = a[m * G + g]; else { let s = 0; for (let k = 0; k < 12; k++) s += a[k * G + g]; o[g] = s / 12; } } return o; };
    const wind = { year: [year(circ.u), year(circ.v)], jan: [year(circ.u, 0), year(circ.v, 0)], jul: [year(circ.u, 6), year(circ.v, 6)] };
    const climGrid = { w: res.grid.w, h: res.grid.h }, warmSl = new Float32Array(n);
    for (let c = 0; c < n; c++) warmSl[c] = bilinear(climGrid, warmG, lat[c], lon[c]);
    res = null;                                                       // (the rest of the climate's arrays go)
    lap('climate');

    // ── the rivers: runoff (rain less evaporation) weights the drainage; dry basins stay closed; carved for longer ──
    onStage('rivers');
    const runoff = new Float32Array(n), pet = new Float32Array(n);
    let oldW = 0, sumR = 0, sumP = 0, landN = 0;
    for (let c = 0; c < n; c++) {
        if (!(z[c] > 0) || !(pAnn[c] === pAnn[c])) continue;
        const P = Math.max(0, pAnn[c]), E0 = Math.max(F.petMinMm, F.petBaseMm + F.petPerC * tAnn[c]);
        pet[c] = E0;
        runoff[c] = P > 0 ? Math.max(0, P - P * (1 + E0 / P - (1 + (E0 / P) ** F.budykoW) ** (1 / F.budykoW))) : 0;
        oldW += carveIn.rain[c]; sumR += runoff[c]; sumP += P; landN++;
    }
    const meanR = landN ? sumR / landN : 1, meanP = landN ? sumP / landN : 1, meanW = landN ? oldW / landN : 1;
    for (let c = 0; c < n; c++) if (z[c] > 0 && pAnn[c] === pAnn[c])
        carveIn.rain[c] = meanW * Math.min(F.wetMax, Math.max(F.runoffFloor, (1 - F.rainShare) * runoff[c] / meanR + F.rainShare * Math.max(0, pAnn[c]) / meanP) ** F.wetPower);
    meander(mesh, carveIn.micro, seed, F, fade);
    const B = closedBasins(mesh, z, runoff, pet, pAnn, cellKm2, F);
    stats.closedBasins = B.basins;
    const before = z.slice();
    const settings = carveSettings({ ...cfg, carveTimeMyr: F.carveTimeMyr, carveRounds: F.carveRounds });
    const C = carveTerrain(carveLadder(simMesh, mesh, terrainMesh), { ...carveIn, z, sink: B.sink, base: B.base }, settings);
    carveIn = null;
    dissect(mesh, C.z, C, cellKm2, F);
    lap('rivers');

    // ── F2: sediment, then hillslopes by climate ──
    onStage('sediment');
    stats.deltas = depositSediment(mesh, before, C, B.sink, cellKm2, F).deltas;
    lap('sediment');
    onStage('hillslopes');
    creepByClimate(mesh, C.z, pAnn, tAnn, F);
    lap('hillslopes');

    // ── F3: the last ice age ──
    onStage('ice age');
    const grid = new LatLonGrid(0.25);
    const I = lastIceAge({ mesh, z: C.z, lat, lon, warmSl, rain: pAnn, grid, cellKm2, seed }, F);
    stats.iceKm2 = I.iceKm2; stats.iceSheets = I.sheets;
    lap('ice age');

    // ── F4: the wind ──
    onStage('wind');
    const W = windWork({ mesh, z: C.z, lat, lon, koppen, grid, wind, climGrid, outwash: I.margin, seed, fade, debug }, F);
    stats.ergKm2 = W.ergKm2; stats.loessKm2 = W.loessKm2;
    lap('wind');

    // ── the sea: water below sea level that the open ocean reaches (fjords, sunk basins); hollows it cannot reach stay land ──
    onStage('sea');
    const ocean = oceanMask(mesh, C.z);
    forgetMesh(mesh); forgetEdgeKm(mesh);                             // (the carve's and the distances' caches for this mesh)
    lap('sea');
    return { mesh, z: C.z, ocean, ms, stats, layers: debug ? { ice: I.ice, sink: B.sink, erg: W.erg, loess: W.loess, koppen, before, rain: pAnn, lat, lon } : null };
}

/** The mesh's positions displaced by a smooth noise field (km-sized waves, three octaves): a domain warp of everything read there. */
function warpPositions(mesh, seed, F) {
    const { xyz, numCells: n } = mesh, out = new Float64Array(3 * n), noise = new FastNoise((seed | 0) * 53 + 11), f = R / F.warpScaleKm, a = F.warpKm / R;
    for (let c = 0; c < n; c++) {
        const x = xyz[3 * c], y = xyz[3 * c + 1], w = xyz[3 * c + 2];
        const dx = noise.fbm(x * f + 1.3, y * f + 7.1, w * f + 4.2, 3, 0.5), dy = noise.fbm(x * f + 9.4, y * f + 2.6, w * f + 6.8, 3, 0.5), dz = noise.fbm(x * f + 5.7, y * f + 8.3, w * f + 0.9, 3, 0.5);
        let px = x + 1.6 * a * dx, py = y + 1.6 * a * dy, pz = w + 1.6 * a * dz;
        const l = Math.hypot(px, py, pz); px /= l; py /= l; pz /= l;
        out[3 * c] = px; out[3 * c + 1] = py; out[3 * c + 2] = pz;
    }
    return out;
}

/** The rivers' fine routing relief (added to the carve's micro-relief, which shapes the routing only): octaves from
 *  F.meanderFromKm down to what the mesh can show — channels wander instead of running straight down smooth slopes. */
function meander(mesh, micro, seed, F, fade) {
    const { xyz, numCells: n } = mesh, noise = new FastNoise((seed | 0) * 37 + 29), oct = [];
    for (let lam = F.meanderFromKm, a = 1; lam > 1 && oct.length < 5; lam /= 2, a *= 0.6) { const s = a * fade(lam); if (s > 0.02) oct.push([R / lam, s]); }
    if (!oct.length) return;
    for (let c = 0; c < n; c++) {
        let v = 0;
        for (let o = 0; o < oct.length; o++) { const [f, s] = oct[o]; v += s * noise.noise3D(xyz[3 * c] * f + 7.7 * o, xyz[3 * c + 1] * f + 2.2, xyz[3 * c + 2] * f + 4.4 * o); }
        micro[c] += F.meanderKm * v;
    }
}

/** Fine relief on high ground (craggier the higher), octaves from F.craggyFromKm down to what the mesh can show. */
function roughen(mesh, z, seed, F, fade) {
    const { xyz, numCells: n } = mesh, noise = new FastNoise((seed | 0) * 71 + 3), oct = [];
    for (let lam = F.craggyFromKm, a = 1; lam > 1 && oct.length < 5; lam /= 2, a *= 0.55) { const s = a * fade(lam); if (s > 0.02) oct.push([R / lam, s]); }
    if (!oct.length) return;
    for (let c = 0; c < n; c++) {
        if (!(z[c] > 0.3)) continue;
        let v = 0;
        for (let o = 0; o < oct.length; o++) { const [f, s] = oct[o]; v += s * noise.noise3D(xyz[3 * c] * f + 3.3 * o, xyz[3 * c + 1] * f + 1.7, xyz[3 * c + 2] * f + 5.9 * o); }
        z[c] += F.craggyKm * smooth(0.3, 3, z[c]) * v;
    }
}

function bilinear(g, field, lat, lon) {
    const { w, h } = g, step = 180 / h;
    const x = (lon + 180) / step - 0.5, y = Math.max(0, Math.min(h - 1, (90 - lat) / step - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i0 = ((x0 % w) + w) % w, i1 = i0 + 1 === w ? 0 : i0 + 1, j1 = y0 + 1 < h ? y0 + 1 : y0;
    return (1 - fx) * (1 - fy) * field[y0 * w + i0] + fx * (1 - fy) * field[y0 * w + i1] + (1 - fx) * fy * field[j1 * w + i0] + fx * fy * field[j1 * w + i1];
}

/** 1 where the open ocean reaches (from the deep sea, through ground below sea level). */
export function oceanMask(mesh, z) {
    const { adjOffset, adjList, numCells: n } = mesh, ocean = new Uint8Array(n), q = [];
    for (let c = 0; c < n; c++) if (z[c] < -1) { ocean[c] = 1; q.push(c); }
    for (let i = 0; i < q.length; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const nb = adjList[k]; if (!ocean[nb] && z[nb] < 0) { ocean[nb] = 1; q.push(nb); } }
    return ocean;
}

/**
 * The finished planet as an equirectangular picture of heights: w × w/2 pixels (rows north → south, columns from −180°
 * east), 16-bit metres, and the ocean (1) — for the page to paint and shade, and to export. Heights blended over the
 * mesh triangle under each pixel; `onRow` reports progress.
 */
export function finishRaster(mesh, z, ocean, w, onRow = null) {
    const h = w >> 1, heightM = new Int16Array(w * h), sea = new Uint8Array(w * h), c3 = [0, 0, 0], w3 = [0, 0, 0];
    for (let py = 0; py < h; py++) {
        const lat = (0.5 - (py + 0.5) / h) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
        for (let px = 0; px < w; px++) {
            const lon = ((px + 0.5) / w - 0.5) * 2 * Math.PI;
            locate(mesh, cl * Math.cos(lon), cl * Math.sin(lon), sl, c3, w3);
            const i = py * w + px, v = w3[0] * z[c3[0]] + w3[1] * z[c3[1]] + w3[2] * z[c3[2]];
            heightM[i] = Math.max(-32000, Math.min(32000, Math.round(v * 1000)));
            sea[i] = ocean[w3[0] >= w3[1] && w3[0] >= w3[2] ? c3[0] : w3[1] >= w3[2] ? c3[1] : c3[2]];
        }
        if (onRow && (py & 63) === 0) onRow(py / h);
    }
    return { w, h, heightM, ocean: sea };
}
