// Earth drawn by our own renderer: ETOPO5 sampled onto the terrain mesh at --cells (2.5M, the gallery's), then through the
// very code render-moment.mjs paints a finished moment with — finishRaster (the mesh to the equirectangular heights) and
// paintFinished (palette 'relief', hillshade at exaggeration 20, the sea shaded by its depth) — so Earth's real geometry
// shows what OUR palette and our shading do to it: a draw artifact shows on Earth too, a geometry artifact does not.
//
//   node --max-old-space-size=16000 v2/tools/render-earth.mjs [--cells 2500000] [--width 4096] [--palette relief] [--out earth-2500k]
//        [--etopo <ETOPO5.DAT>] [--crops-out <dir>: the seven 900×500 Earth crops, framed as gallery-crop.sh frames them]
//   sim-slots run -n 6 --gb 16 --who earthrender -- node --max-old-space-size=16000 v2/tools/render-earth.mjs
//
// Render only: the input height is the picture's height — no finish, no erosion, no climate. What Earth lacks, the renderer's
// own neutral defaults stand in for: no lakes (lake = null: ETOPO5 has no lake surfaces, so the Great Lakes, the Caspian and
// the Dead Sea draw as land at their level, or as the dry hollows they are in the height), no rivers, no ice (Antarctica and
// Greenland are ETOPO5's ice-surface heights), no lithology, no Köppen/cover (the climate-free 'relief' palette).
// The ocean is worldOcean(z, 0): the connected sea below 0 m, the finish's own rule (oceanMask).
// Data: ETOPO5 (NOAA NGDC 1988), 5 arc-min, 2160 × 4320 big-endian int16 metres, rows from 90°N, columns from 0°E east —
// about 9 km, finer than the 2.5M mesh's ~14 km cell, so a finer ETOPO would add nothing the mesh could hold. Read only.
// Output: v2/out/moments/<out>.png (4096 × 2048, lon 0 at the centre like render-moment's).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { PNG } from 'pngjs';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { worldOcean } from '../js/terrain/world-ocean.js';
import { finishRaster } from '../js/finish/finish.js';
import { paintFinished } from '../js/evolution/finish-view.js';
import { heightLutOf } from '../js/evolution/looks.js';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CELLS = Number(arg('--cells', 2500000)), W = Number(arg('--width', 4096)), PALETTE = arg('--palette', 'relief');
const ETOPO = arg('--etopo', path.join(os.homedir(), 'Projects/planet_heightmap_generation-civ/tuning/civ/data/raw/etopo/ETOPO5.DAT'));
const NAME = arg('--out', `earth-${Math.round(CELLS / 1000)}k`), t0 = performance.now(), secs = () => `${((performance.now() - t0) / 1000).toFixed(0)} s`;

const NR = 2160, NC = 4320, buf = fs.readFileSync(ETOPO);
if (buf.length !== NR * NC * 2) throw new Error(`${ETOPO}: ${buf.length} bytes, not ETOPO5's ${NR * NC * 2}`);
const E = new Int16Array(NR * NC);
for (let i = 0; i < E.length; i++) E[i] = buf.readInt16BE(2 * i);
// (bilinear in the grid; longitude wraps, the rows stop at the poles)
const sample = (latDeg, lonDeg) => {
    const fy = Math.min(NR - 1, Math.max(0, (90 - latDeg) * 12)), fx = (((lonDeg % 360) + 360) % 360) * 12;
    const y0 = Math.min(NR - 2, Math.floor(fy)), x0 = Math.floor(fx) % NC, x1 = (x0 + 1) % NC, ty = fy - y0, tx = fx - Math.floor(fx);
    return (E[y0 * NC + x0] * (1 - tx) + E[y0 * NC + x1] * tx) * (1 - ty) + (E[(y0 + 1) * NC + x0] * (1 - tx) + E[(y0 + 1) * NC + x1] * tx) * ty;
};

const mesh = terrainMesh(CELLS), n = mesh.numCells, xyz = mesh.xyz, z = new Float32Array(n);
console.log(`mesh ${n.toLocaleString()} cells, ~${Math.sqrt(4 * Math.PI * 6371 * 6371 / n).toFixed(1)} km (${secs()})`);
for (let c = 0; c < n; c++) z[c] = sample(Math.asin(Math.max(-1, Math.min(1, xyz[3 * c + 2]))) * 180 / Math.PI, Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * 180 / Math.PI) / 1000;
const ocean = worldOcean(mesh, z, 0).ocean;
console.log(`sampled ETOPO5 onto the mesh (${secs()})`);
const raster = finishRaster(mesh, z, ocean, W, null, null, null, null);
const H = W >> 1, image = { data: new Uint8ClampedArray(W * H * 4) };
paintFinished(raster, { width: W, image }, heightLutOf(PALETTE), { lakes: true, exaggeration: 20 });
const outDir = path.join(ROOT, 'v2', 'out', 'moments');
fs.mkdirSync(outDir, { recursive: true });
const p = new PNG({ width: W, height: H }); p.data = Buffer.from(image.data.buffer); fs.writeFileSync(path.join(outDir, `${NAME}.png`), PNG.sync.write(p));
console.log(`picture → ${path.relative(ROOT, outDir)}/${NAME}.png (${secs()})`);

// ── the Earth crops: 900 × 500 at full resolution, framed as gallery-crop.sh frames them (lon 0 at the centre, the crop
// centred on the place and clamped to the picture), one PNG per place in --crops-out ──
const CROPS = { 'north-sea': [56, 3], 'sunda-shelf': [3, 108], 'ria-galicia': [43, -8], 'fjord-norway': [62, 6], 'mid-atlantic-ridge': [30, -42],
    'gulf-coast': [29.5, -91], 'canadian-shield': [56, -98] };
const cropsOut = arg('--crops-out', null);
if (cropsOut) {
    fs.mkdirSync(cropsOut, { recursive: true });
    for (const [name, [lat, lon]] of Object.entries(CROPS)) {
        const x0 = Math.max(0, Math.min(W - 900, Math.trunc((lon + 180) / 360 * W - 450))), y0 = Math.max(0, Math.min(H - 500, Math.trunc((90 - lat) / 180 * H - 250)));
        const crop = new Uint8ClampedArray(900 * 500 * 4);
        for (let y = 0; y < 500; y++) crop.set(image.data.subarray(4 * ((y0 + y) * W + x0), 4 * ((y0 + y) * W + x0 + 900)), 4 * y * 900);
        const q = new PNG({ width: 900, height: 500 }); q.data = Buffer.from(crop.buffer); fs.writeFileSync(path.join(cropsOut, `${name}.png`), PNG.sync.write(q));
        console.log(`crop ${name} (${lat}°, ${lon}°) → ${path.join(cropsOut, name)}.png`);
    }
}
