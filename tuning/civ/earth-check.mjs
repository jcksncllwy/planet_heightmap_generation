// The Earth test of the civ layer's cradles (plans/CIV_PLAN.md §6): the cradle finder run on real Earth (lib/earth-world.mjs)
// must find the irrigated alluvia where the first cities rose — and rank them high. Prints each known cradle's rank and
// writes the ranking and a map to tuning/civ/results/.
//
//   node --max-old-space-size=16000 tuning/civ/earth-check.mjs [--n 640000] [--top 15]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { earthWorld } from './lib/earth-world.mjs';
import { civSubstrate } from '../../v2/js/civ/substrate.js';
import { civResources } from '../../v2/js/civ/resources.js';
import { findCradles } from '../../v2/js/civ/cradles.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--n', 640000)), TOP = Number(arg('--top', 15));
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const t0 = performance.now(), secs = () => `${((performance.now() - t0) / 1000).toFixed(0)} s`;

/** Where pristine civilisation arose on irrigated alluvium (the first cities, or the first monumental centres), with dates. */
export const KNOWN = [
    { name: 'Sumer (lower Mesopotamia)', lat: 31.3, lon: 46.0, since: '≈ 4000 BCE (Uruk)', primary: true },
    { name: 'Egypt (the Nile)', lat: 26.5, lon: 31.8, since: '≈ 3500 BCE (Naqada)', primary: true },
    { name: 'Indus (Harappa, Mohenjo-daro)', lat: 27.3, lon: 68.1, since: '≈ 2600 BCE', primary: true },
    { name: 'Norte Chico / Peru coast (Caral)', lat: -10.9, lon: -77.5, since: '≈ 3000 BCE', primary: false },
    { name: 'Oxus (BMAC, Gonur)', lat: 38.2, lon: 62.0, since: '≈ 2250 BCE', primary: false },
    { name: 'Susiana (Susa)', lat: 32.2, lon: 48.3, since: '≈ 4000 BCE', primary: false },
];

const km = (a, b, c, d) => { const D = Math.PI / 180, x = Math.sin((c - a) * D / 2) ** 2 + Math.cos(a * D) * Math.cos(c * D) * Math.sin((d - b) * D / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(x)); };

const w = await earthWorld(N);
console.log(`Earth at ${w.mesh.numCells.toLocaleString()} cells, ${w.rivers.q.length.toLocaleString()} river points, ${w.deposits.length.toLocaleString()} deposits (${secs()})`);
const sub = civSubstrate(w);
const res = civResources({ fine: w.mesh, z: w.z, ocean: w.ocean, lake: w.lake, koppen: w.koppen, pAnnual: w.pAnnual, erg: null, sub, deposits: w.deposits });
const cradles = findCradles(w, sub, res);
console.log(`${cradles.length} cradles (${secs()})`);

// each known cradle: the best-ranked cradle with a cell within 150 km of it
const D = Math.PI / 180, xyz = w.mesh.xyz;
const latOf = c => Math.asin(xyz[3 * c + 2]) / D, lonOf = c => Math.atan2(xyz[3 * c + 1], xyz[3 * c]) / D;
const found = KNOWN.map(k => {
    const r = cradles.find(r => r.cells.some(c => km(k.lat, k.lon, latOf(c), lonOf(c)) < 150));
    return { ...k, rank: r?.rank ?? null, score: r?.score ?? null };
});
for (const f of found) console.log(`  ${f.name.padEnd(36)} ${f.rank ? `#${f.rank} (${f.score})` : 'not found'}`);
console.log('top:');
for (const r of cradles.slice(0, TOP)) {
    const k = KNOWN.find(k => r.cells.some(c => km(k.lat, k.lon, latOf(c), lonOf(c)) < 150));
    console.log(`  #${r.rank} ${r.score} at ${r.lat},${r.lon} ${k ? `= ${k.name}` : ''}: ${r.km2.toLocaleString()} km², circ ${r.circumscription}, river ${r.river.maxM3s} m³/s (far-fed ${r.river.farFedShare}), cereals ${JSON.stringify(r.cerealKm)}, ${JSON.stringify(r.koppen)}`);
}
const primaryRanks = found.filter(f => f.primary).map(f => f.rank ?? 99);
console.log(`score: the three primary cradles at ranks ${primaryRanks.join(', ')} — ${primaryRanks.every(r => r <= 10) ? 'PASS (all in the top 10)' : 'FAIL (want all in the top 10)'}`);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `earth-cradles-${Math.round(N / 1000)}k.json`), JSON.stringify({ found, cradles: cradles.map(({ cells, ...r }) => r) }, null, 1));
// a map: the land by its farmers' density, the sea dark, the cradles outlined (top ones red)
const W = 2048, H = 1024, img = new Uint8ClampedArray(W * H * 4), rank = new Int32Array(sub.n), pix = new Int32Array(W * H);
for (const r of cradles) for (const c of r.cells) rank[c] = r.rank;
for (let py = 0; py < H; py++) {
    const la = (0.5 - (py + 0.5) / H) * Math.PI, cl = Math.cos(la), sl = Math.sin(la);
    for (let px = 0; px < W; px++) { const lo = ((px + 0.5) / W - 0.5) * 2 * Math.PI; pix[py * W + px] = w.mesh.index.nearest(cl * Math.cos(lo), cl * Math.sin(lo), sl); }
}
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const p = py * W + px, c = pix[p], i = 4 * p;
    let col;
    if (w.ocean[c]) col = [22, 34, 58];
    else { const f = Math.min(1, Math.log10(1 + sub.farmers[c]) / 2.5); col = [70 + 120 * f, 70 + 150 * f, 60 + 40 * f]; }
    const r = rank[c];
    if (r && py > 0 && py < H - 1) {
        const edge = rank[pix[p - W]] !== r || rank[pix[p + W]] !== r || rank[pix[py * W + (px + 1) % W]] !== r || rank[pix[py * W + (px + W - 1) % W]] !== r;
        const tint = r <= TOP ? [255, 40, 40] : [255, 170, 0], a = edge ? 1 : 0.4;
        col = col.map((v, k) => v * (1 - a) + tint[k] * a);
    }
    img[i] = col[0]; img[i + 1] = col[1]; img[i + 2] = col[2]; img[i + 3] = 255;
}
const png = new PNG({ width: W, height: H }); png.data = Buffer.from(img.buffer);
fs.writeFileSync(path.join(OUT, `earth-cradles-${Math.round(N / 1000)}k.png`), PNG.sync.write(png));
console.log(`→ ${path.relative(process.cwd(), OUT)}/earth-cradles-${Math.round(N / 1000)}k.{json,png} (${secs()})`);
