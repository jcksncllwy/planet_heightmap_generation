// The civ layer's Phase 0 (plans/CIV_PLAN.md): a finished moment's substrate — what it offers people — and its ranked
// cradles, the places an Ur could arise. Builds the moment as render-moment.mjs does (the frame cached in v2/out/frames/,
// the finished moment in v2/out/civ/cache/), then writes maps of each layer and the cradles to v2/out/civ/<name>/.
//
//   node --max-old-space-size=16000 v2/tools/civ-cradles.mjs --seed 12345 --cont 30 --time 300 [--sim 40000] [--cells 640000] [--width 2048] [--top 8]
//   node v2/tools/civ-cradles.mjs --seeds 1,2,3,…  [same options]     # several worlds: a cradle census, no maps
//
// Output: cradles.json (the ranking, with what each score is made of) and PNGs — overview (the cradles outlined and
// numbered on the terrain), forager, wild (R winter-rain cereals · G summer-rain cereals · B tubers), farmers, irrigation,
// resources.

import fs from 'node:fs';
import path from 'node:path';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { finishRaster } from '../js/finish/finish.js';
import { paintFinished } from '../js/evolution/finish-view.js';
import { heightLutOf } from '../js/evolution/looks.js';
import { civSubstrate } from '../js/civ/substrate.js';
import { civResources, Res } from '../js/civ/resources.js';
import { findCradles } from '../js/civ/cradles.js';
import { ROOT, OUT, MESH_SEED, worldOf, writePng, pixelCells, ramp, drawText } from './lib/civ-world.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CONT = Number(arg('--cont', 30)), SIM = Number(arg('--sim', 40000)), TIME = Number(arg('--time', 300));
const CELLS = Number(arg('--cells', 640000)), W = Number(arg('--width', 2048)), TOP = Number(arg('--top', 8));
const SEEDS = arg('--seeds', null)?.split(',').map(Number) ?? [Number(arg('--seed', 12345))];
const t0 = performance.now(), secs = () => `${((performance.now() - t0) / 1000).toFixed(0)} s`;
const RES_RGB = [[Res.TIN, [230, 230, 240]], [Res.COPPER_OPHIOLITE, [0, 200, 160]], [Res.COPPER_PORPHYRY, [255, 120, 30]], [Res.COPPER_NATIVE, [200, 90, 40]],
    [Res.OBSIDIAN, [20, 20, 20]], [Res.BITUMEN, [120, 60, 150]], [Res.GOLD, [255, 215, 0]], [Res.SALT, [255, 255, 255]]];

async function run(seed, maps) {
    const simMesh = buildSimMesh(SIM, MESH_SEED);
    const w = await worldOf(seed, simMesh, { cont: CONT, sim: SIM, time: TIME, cells: CELLS });
    console.log(`seed ${seed}: world at ${w.mesh.numCells.toLocaleString()} cells (${secs()})`);
    const sub = civSubstrate(w);
    const res = civResources({ frame: w.frame, simMesh, fine: w.mesh, z: w.z, ocean: w.ocean, lake: w.lake, koppen: w.koppen, pAnnual: w.pAnnual, erg: w.erg, sub, seed });
    const cradles = findCradles(w, sub, res);
    console.log(`  substrate + resources + cradles (${secs()}): ${cradles.length} cradles`);
    let landKm2 = 0, people = 0, farmersKm2 = 0;
    for (let c = 0; c < sub.n; c++) if (!w.ocean[c] && !w.lake[c]) { landKm2 += sub.cellKm2; people += sub.forager[c] * sub.cellKm2; }
    const resCount = {};
    for (let c = 0; c < sub.n; c++) for (const [k, v] of Object.entries(Res)) if (res[c] & v) resCount[k] = (resCount[k] ?? 0) + 1;
    const summary = { seed, time: TIME, cells: sub.n, landMkm2: +(landKm2 / 1e6).toFixed(1), foragersMillions: +(people / 1e6).toFixed(2),
        resourceShareOfLand: Object.fromEntries(Object.entries(resCount).map(([k, v]) => [k.toLowerCase(), +(v * sub.cellKm2 / landKm2).toFixed(4)])),
        cradles: cradles.map(({ cells, ...r }) => r) };
    for (const r of summary.cradles.slice(0, TOP)) console.log(`  #${r.rank} ${r.score} at ${r.lat},${r.lon}: ${r.km2.toLocaleString()} km², ${r.capacity.toLocaleString()} people, circ ${r.circumscription}, river ${r.river.maxM3s} m³/s (flood ${r.river.floodShare}, far-fed ${r.river.farFedShare}), cereals ${JSON.stringify(r.cerealKm)}, ${JSON.stringify(r.koppen)}`);
    const dir = path.join(OUT, `civ-${seed}-${TIME}-${Math.round(CELLS / 1000)}k`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cradles.json'), JSON.stringify(summary, null, 1));
    if (maps) paintMaps(w, sub, res, cradles, dir);
    return summary;
}

function paintMaps(w, sub, res, cradles, dir) {
    const H = W >> 1, n = sub.n, pix = pixelCells(w.mesh, W);
    const raster = finishRaster(w.mesh, w.z, w.ocean, W, null, w.lake, w.lakeLevel, null);
    const base = { data: new Uint8ClampedArray(W * H * 4) };
    paintFinished(raster, { width: W, image: base }, heightLutOf('relief'), { lakes: true, exaggeration: 20 });
    // a layer over the terrain greyed: colour(c) → [r, g, b, alpha] or null
    const layer = (name, colour) => {
        const img = new Uint8ClampedArray(base.data);
        for (let p = 0; p < W * H; p++) {
            const i = 4 * p, g = 0.3 * img[i] + 0.59 * img[i + 1] + 0.11 * img[i + 2];
            for (let k = 0; k < 3; k++) img[i + k] = 0.35 * img[i + k] + 0.65 * g;
            const col = colour(pix[p]);
            if (col) for (let k = 0; k < 3; k++) img[i + k] = img[i + k] * (1 - col[3]) + col[k] * col[3];
        }
        writePng(path.join(dir, `${name}.png`), W, H, img);
        return img;
    };
    const land = c => !w.ocean[c] && !w.lake[c];
    layer('forager', c => land(c) ? [...ramp(Math.log10(Math.max(1e-3, sub.forager[c]) / 1e-3) / 3.5), 0.85] : null);
    layer('wild', c => { const a = sub.wild.winterCereal[c], b = sub.wild.summerCereal[c], t = sub.wild.tuber[c], m = Math.max(a, b, t); return land(c) && m > 0.05 ? [255 * a / m, 255 * b / m, 255 * t / m, Math.min(1, m) * 0.9] : null; });
    layer('farmers', c => land(c) && sub.farmers[c] > 0 ? [...ramp(Math.log10(sub.farmers[c]) / Math.log10(300)), 0.85] : null);
    layer('irrigation', c => sub.irrig[c] > 0 ? [...ramp(sub.irrig[c]), 0.9] : null);
    layer('resources', c => { for (const [bit, rgb] of RES_RGB) if (res[c] & bit) return [...rgb, 0.9]; return null; });
    // the overview: the cradles outlined on the terrain, the top ones numbered
    const rank = new Int32Array(n);
    for (const r of cradles) for (const c of r.cells) rank[c] = r.rank;
    const img = new Uint8ClampedArray(base.data);
    for (let py = 1; py < H - 1; py++) for (let px = 0; px < W; px++) {
        const p = py * W + px, r = rank[pix[p]];
        if (!r) continue;
        const edge = rank[pix[p - W]] !== r || rank[pix[p + W]] !== r || rank[pix[py * W + (px + 1) % W]] !== r || rank[pix[py * W + (px + W - 1) % W]] !== r;
        const col = r <= TOP ? [255, 40, 40] : [255, 170, 0], a = edge ? 1 : 0.35, i = 4 * p;
        for (let k = 0; k < 3; k++) img[i + k] = img[i + k] * (1 - a) + col[k] * a;
    }
    for (const r of cradles.slice(0, TOP)) drawText(img, W, H, (r.lon + 180) / 360 * W, (90 - r.lat) / 180 * H, r.rank);
    writePng(path.join(dir, 'overview.png'), W, H, img);
    console.log(`  maps → ${path.relative(ROOT, dir)}/ (${secs()})`);
}

const census = [];
for (const seed of SEEDS) census.push(await run(seed, SEEDS.length === 1));
if (SEEDS.length > 1) {
    fs.writeFileSync(path.join(OUT, `census-${TIME}-${Math.round(CELLS / 1000)}k.json`), JSON.stringify(census.map(s => ({ seed: s.seed, cradles: s.cradles.length, top: s.cradles.slice(0, 3) })), null, 1));
    console.log(`census: ${census.map(s => `${s.seed}: ${s.cradles.length} (best ${s.cradles[0]?.score ?? '–'})`).join(' · ')}`);
}
