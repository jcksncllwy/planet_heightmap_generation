// Shared by the civ layer's tools (civ-cradles.mjs, civ-sim.mjs): a finished moment as the civ layer reads it (built as
// render-moment.mjs builds it — the frame from the history cache, the finished moment in v2/out/civ/cache/ under the
// code's hash), and the little painting the tools need (equirect pixel → cell, ramps, PNG, numbers).

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { PNG } from 'pngjs';
import { setDelaunator } from '../../../js/sphere-mesh.js';
import { buildSimMesh, meshFromArrays } from '../../js/core/sim-mesh.js';
import { TerrainPool } from '../../js/terrain/terrain-pool.js';
import { finishPlanet } from '../../js/finish/finish.js';
import { momentFrame } from './moment-frame.mjs';
import { historyCodeHash, HISTORY_ENTRIES } from './history-cache.mjs';

setDelaunator(Delaunator);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const OUT = path.join(ROOT, 'v2', 'out', 'civ');
export const MESH_SEED = 12345;                       // (the page's: every planet's sim mesh is the same; the seed shapes the world)

/** The moment's frame, as the page builds it (scene 'cycle'), through the history cache (moment-frame.mjs). */
export const frameOf = (seed, { cont, sim, time }) => momentFrame(ROOT, { seed, cont, sim, time });

let codeMemo = null;
/** The hash of the code a cached world is built by: the history's and the finish's. In each cache file's name, so a
 *  change to either builds the worlds again. (The civ layer's reading of a finished moment, civ-page.js, is left out:
 *  it imports the whole sim. A cache missing a field it now keeps is built again by its reader's own check.) */
export const worldCode = () => (codeMemo ??= historyCodeHash(ROOT, [...HISTORY_ENTRIES, 'v2/js/finish/finish.js']).hash);

/** The finished moment, reduced to what the civ layer reads, cached. Options: { cont, sim, time, cells }. */
export async function worldOf(seed, simMesh, opts) {
    const { cont, sim, time, cells } = opts;
    const dir = path.join(OUT, 'cache'), file = path.join(dir, `world3-${seed}-${cont}-${sim}-${time}-${Math.round(cells / 1000)}k-${worldCode()}.bin`);
    if (fs.existsSync(file)) { const w = v8.deserialize(fs.readFileSync(file)); w.mesh = meshFromArrays(w.mesh); return w; }
    const frame = await frameOf(seed, opts);
    const pool = await TerrainPool.create(simMesh);
    const fin = await finishPlanet({ frame, simMesh, seed, cells, pool, closePool: true, debug: true, onStage: () => {}, civ: true });
    const cc = fin.climate.cell, m = fin.mesh;
    const w = { seed, time, frame, mesh: { numCells: m.numCells, xyz: m.xyz, adjOffset: m.adjOffset, adjList: m.adjList },
        z: fin.z, ocean: fin.ocean, lake: fin.lake, lakeLevel: fin.lakeLevel, koppen: cc.koppen, tAnnual: cc.tAnnual, pAnnual: cc.pAnnual,
        stats: cc.stats, cover: cc.cover, rivers: fin.rivers, loess: fin.layers?.loess ?? null, erg: fin.layers?.erg ?? null, ice: fin.layers?.ice ?? null,
        vector: fin.civ?.vector ?? null, crops: fin.civ?.crops ?? null };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, v8.serialize(w));
    w.mesh = meshFromArrays(w.mesh);
    return w;
}

export const writePng = (file, w, h, rgba) => { const p = new PNG({ width: w, height: h }); p.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength); fs.writeFileSync(file, PNG.sync.write(p)); };

/** Each pixel's cell, for an equirect picture W × W/2. */
export function pixelCells(mesh, W) {
    const H = W >> 1, pix = new Int32Array(W * H);
    for (let py = 0; py < H; py++) {
        const la = (0.5 - (py + 0.5) / H) * Math.PI, cl = Math.cos(la), sl = Math.sin(la);
        for (let px = 0; px < W; px++) { const lo = ((px + 0.5) / W - 0.5) * 2 * Math.PI; pix[py * W + px] = mesh.index.nearest(cl * Math.cos(lo), cl * Math.sin(lo), sl); }
    }
    return pix;
}

const rampOf = stops => t => { t = Math.max(0, Math.min(1, t)) * (stops.length - 1); const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i; return stops[i].map((v, k) => v + (stops[i + 1][k] - v) * f); };
/** A perceptual ramp (dark violet → teal → yellow), for one 0–1 value. */
export const ramp = rampOf([[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]);
/** A warm ramp (dark red → orange → pale yellow): farmers. */
export const warmRamp = rampOf([[90, 10, 20], [180, 40, 30], [240, 120, 30], [255, 220, 120]]);

// a 3×5 pixel font for numbers (and a few letters), scaled up, white on a dark box
const GLYPHS = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111',
    6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111', k: '100101110101101', a: '010101111101101', B: '110101110101110',
    P: '110101110100100', ' ': '000000000000000', ',': '000000000010100', '.': '000000000000010', '-': '000000111000000' };
export function drawText(img, W, H, x, y, text, { scale = Math.max(2, Math.round(W / 700)), box = true } = {}) {
    const s = String(text), sc = scale, cw = 4 * sc, w = s.length * cw + sc, h = 7 * sc;
    x = Math.round(x); y = Math.round(y);
    if (box) for (let dy = -(h >> 1); dy < h - (h >> 1); dy++) for (let dx = -(w >> 1); dx < w - (w >> 1); dx++) {
        const px = (x + dx + W) % W, py = y + dy; if (py < 0 || py >= H) continue;
        const i = 4 * (py * W + px); img[i] = 20; img[i + 1] = 20; img[i + 2] = 20;
    }
    [...s].forEach((d, j) => { const g = GLYPHS[d] ?? GLYPHS[' ']; for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[3 * r + q] === '1') for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) {
        const px = (x - (w >> 1) + sc + j * cw + q * sc + b + W) % W, py = y - (h >> 1) + sc + r * sc + a; if (py < 0 || py >= H) continue;
        const i = 4 * (py * W + px); img[i] = 255; img[i + 1] = 255; img[i + 2] = 255;
    } });
}
