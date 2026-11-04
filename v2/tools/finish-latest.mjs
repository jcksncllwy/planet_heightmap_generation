// The finished moment the user is looking at in the Evolution page, from the finish cache — the page's very finish (its
// GPU erosion, Chromium's maths), not one Node makes again. Use it instead of finishing a moment yourself to see what the
// user means: it loads in seconds, and it is what is on their screen.
//
//   node v2/tools/finish-latest.mjs [--key <finish-cache key>] [--png [file]] [--palette relief] [--json] [--list]
//
// Prints what it is (seed, moment, detail, engine, settings) and its measures; --png paints it as the page paints it
// (finish-view.js paintFinished: the palette, hillshade, lakes; for its rivers drawn too, render-moment.mjs --latest --rivers)
// to v2/out/moments/; --json:
// the spec and stats as JSON. --key: another entry than the one on screen (node v2/tools/finish-latest.mjs --list).
//
// From code (any tool, any checkout — the store is the machine's):
//   import { loadLatestFinish, loadFinish } from './lib/finish-cache.mjs';
//   const fin = await loadLatestFinish({ mesh: true });   // null: nothing finished on screen
//   fin.raster   {w, h, heightM (m, Int16), ocean, water (lake kinds)}   — the page's picture
//   fin.cells    {numCells, z (km), ocean, lake, lakeLevel (km), glaciated} — per cell of fin.mesh (with mesh: true)
//   fin.rivers   {start, lat, lon, q (m³/s), season, regime, …}          — finish-hydro.js
//   fin.climate  the moment's own climate (climate-fields.js; .raster: Köppen, °C, mm, the Satellite view's colours)
//   fin.stats, fin.ms, fin.spec (its key's settings), fin.meta, fin.latest (latest.json: the page's link, seed, moment)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLatestFinish, loadFinish, listEntries, CACHE_DIR } from './lib/finish-cache.mjs';
import { readLatest } from './lib/history-cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2), has = k => argv.includes(k), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

if (has('--list')) {
    const latest = readLatest();
    for (const e of listEntries()) {
        const s = e.meta?.spec;
        console.log(`${e.key}${latest?.finish === e.key ? ' ← on screen' : ''}  ${(e.bytes / 1e6).toFixed(0)} MB  ${e.meta?.state ?? '?'}  ${s ? `${s.timeMyr} Myr · ${s.cells.toLocaleString()} cells · ${s.width} px · ${s.host} · erosion ${s.erosion} · history ${s.history.slice(0, 8)}` : ''}  used ${new Date(e.usedAt).toISOString()}`);
    }
    console.log(`(${CACHE_DIR})`);
    process.exit(0);
}

const t0 = performance.now();
const key = arg('--key', null);
const fin = key ? await loadFinish(key, { waitMs: 60e3 }) : await loadLatestFinish();
if (!fin) {
    const latest = readLatest();
    console.error(key ? `no whole entry ${key} in the finish cache (${CACHE_DIR})`
        : !latest ? 'nothing viewed yet: the history cache has no latest.json (the Evolution page, served by tuning/dev-server.mjs, writes it)'
        : !latest.finish ? `the page shows ${latest.timeMyr} Myr of seed ${latest.seed} without detail (latest.json names no finish) — Add detail there, or render it yourself: node v2/tools/render-moment.mjs --latest`
        : `latest.json names finish ${latest.finish}, but the finish cache has no whole entry for it (still uploading, or evicted)`);
    process.exit(1);
}
const s = fin.spec, L = fin.latest, secs = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`finish ${fin.key} (loaded in ${secs} s)${L ? ` — on screen ${L.at}: ${L.url ?? ''}` : ''}`);
console.log(`  moment ${s.timeMyr} Myr of history ${s.history}${L ? ` (seed ${L.seed}, cont ${L.cont}, sim ${L.sim})` : ''}`);
console.log(`  ${s.cells.toLocaleString()} cells, picture ${fin.raster.w}×${fin.raster.h}; greenhouse ${s.greenhouseWm2} W/m², rain ×${s.precipScale}; people ${s.civ ? 'on' : 'off'}`);
console.log(`  made by ${fin.meta.builtBy ?? '?'} (${s.host}, maths ${s.math}, erosion ${s.erosion}${fin.stats.erodeOn ? `: ${fin.stats.erodeOn}` : ''}) at ${fin.meta.created}; finish code ${s.code}`);
const n = fin.cells.numCells, R = 6371, cellKm2 = 4 * Math.PI * R * R / n, kinds = [0, 0, 0, 0];
let land = 0;
for (let c = 0; c < n; c++) { if (!fin.cells.ocean[c]) land++; if (fin.cells.lake?.[c]) kinds[fin.cells.lake[c]]++; }
console.log(`  land ${(land / n * 100).toFixed(1)} %; fresh lakes ${Math.round(kinds[1] * cellKm2).toLocaleString()} km², salt lakes ${Math.round(kinds[2] * cellKm2).toLocaleString()} km², salt pans ${Math.round(kinds[3] * cellKm2).toLocaleString()} km²; river points ${fin.rivers.q.length.toLocaleString()}`);
if (fin.ms) console.log(`  the finish took ${(Object.values(fin.ms).reduce((a, b) => a + b, 0) / 1000).toFixed(0)} s: ${Object.entries(fin.ms).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(' · ')}`);
if (has('--json')) console.log(JSON.stringify({ key: fin.key, spec: s, latest: L ?? null, stats: fin.stats }, null, 1));

if (has('--png')) {
    const { PNG } = await import('pngjs');
    const { paintFinished } = await import('../js/evolution/finish-view.js');
    const { heightLutOf } = await import('../js/evolution/looks.js');
    const r = fin.raster, W = r.w, H = r.h, image = { data: new Uint8ClampedArray(W * H * 4) };
    paintFinished(r, { width: W, image }, heightLutOf(arg('--palette', 'relief')), { lakes: true, exaggeration: 20 });
    const file = arg('--png', null) ?? path.join(ROOT, 'v2', 'out', 'moments', `latest-${fin.key.slice(0, 8)}-${s.timeMyr}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const p = new PNG({ width: W, height: H }); p.data = Buffer.from(image.data.buffer); fs.writeFileSync(file, PNG.sync.write(p));
    console.log(`picture → ${path.relative(process.cwd(), file)}`);
}
