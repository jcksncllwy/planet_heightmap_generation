// The People layer's land views (plans/CIV_PLAN.md §11: Farmland, Soil, Staple food, Way of life) and its People view, as
// the page paints them (evolution/people-view.js), for one moment of the page's history: finished at the page's detail,
// read as the civ page reads it (civ-page.js civWorldFromFinish), the people run to now (startPeople: the page's own path,
// without the climate ensemble's runs). Flat colours, no hillshade. → v2/out/civ/<out>-{farmland,soil,staple,way,people}.png
//
//   node --max-old-space-size=16000 v2/tools/civ-land-views.mjs [--seed 799224 --cont 30 --time 290 --cells 2500000
//        --width 2048 --out land-views]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { civWorldFromFinish, startPeople } from '../js/civ/civ-page.js';
import { groundColor, groundLegendHTML, peopleColor, GROUND_SHOWS } from '../js/evolution/people-view.js';
import { writePng, drawText } from './lib/civ-world.mjs';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), OUT = path.join(ROOT, 'v2', 'out', 'civ');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('--seed', 799224)), CONT = Number(arg('--cont', 30)), TIME = Number(arg('--time', 290)), CELLS = Number(arg('--cells', 2500000));
const WIDTH = Number(arg('--width', 2048)), NAME = arg('--out', 'land-views');

const t0 = performance.now();
const frame = await momentFrame(ROOT, { seed: SEED, cont: CONT, sim: 40000, time: TIME });
const simMesh = buildSimMesh(40000, MESH_SEED), pool = await TerrainPool.create(simMesh);
const out = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, climateOptions: {}, civ: true });
const tFinish = performance.now() - t0;
const w = civWorldFromFinish(out);
let t = performance.now();
const { result: P } = startPeople(w, WIDTH);
const tPeople = performance.now() - t;
console.log(`finished ${CELLS} cells in ${(tFinish / 1000).toFixed(1)} s; the people (${P.cells} cells, to now) in ${(tPeople / 1000).toFixed(1)} s`);

// (each pixel's water from its cell: the picture's own shoreline is the finish's, the views' cells the civ world's)
const H = WIDTH >> 1, lut = { rgb: new Uint8Array([128, 128, 128]) };
const wetAt = new Uint8Array(WIDTH * H);
for (let i = 0; i < WIDTH * H; i++) { const c = P.pix[i]; wetAt[i] = w.ocean[c] ? 1 : w.lake[c] ? 2 : 0; }
fs.mkdirSync(OUT, { recursive: true });
const shows = [...Object.keys(GROUND_SHOWS), 'people'];
for (const key of shows) {
    const color = key === 'people' ? peopleColor(P, P.bp.length - 1, WIDTH, lut) : groundColor(P, key, WIDTH, lut), img = new Uint8ClampedArray(4 * WIDTH * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < WIDTH; x++) {
        const i = y * WIDTH + x, wet = wetAt[i];
        color(img, 4 * i, x, y, wet === 1, 1, 0, 0, wet === 2 ? 1 : 0);
    }
    const title = key === 'people' ? 'People now' : groundLegendHTML(key).match(/<b>(.*?)<\/b>/)[1];
    drawText(img, WIDTH, H, 8, 8, `${title} - seed ${SEED} ${TIME} Myr ${CELLS} cells`.toUpperCase());
    const file = path.join(OUT, `${NAME}-${key}.png`);
    writePng(file, WIDTH, H, img);
    console.log('→', path.relative(ROOT, file));
}
// (the share of the land in each class of each view, for the record)
const n = P.cells, G = P.ground, count = (f, k) => { let a = 0, b = 0; for (let c = 0; c < n; c++) if (!w.ocean[c] && !w.lake[c]) { b++; if (f(c) === k) a++; } return a / b; };
const pc = x => `${(100 * x).toFixed(1)} %`;
console.log('farmland barren…excellent:', [0, 1, 2, 3, 4].map(k => pc(count(c => G.farm[c] & 7, k))).join(' · '));
console.log('staple none, wheat, summer, roots, tree, paddy, herds, wild:', [0, 1, 2, 3, 4, 5, 6, 7].map(k => pc(count(c => G.staple[c] & 15, k))).join(' · '));
console.log('way none, farming, herding, gathering:', [0, 1, 2, 3].map(k => pc(count(c => G.staple[c] >> 4, k))).join(' · '));
