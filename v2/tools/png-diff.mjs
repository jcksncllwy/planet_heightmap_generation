// Changed pixels between two renders of one moment (volcano's volc-diff, kept for the locality gate): sum|Δrgb| > 30, and the hottest 32-px tiles.
//   node v2/tools/png-diff.mjs a.png b.png [tiles]
import fs from 'node:fs'; import { PNG } from 'pngjs';
const [a, b] = process.argv.slice(2, 4).map(p => PNG.sync.read(fs.readFileSync(p)));
const W = a.width, H = a.height, B = 32, bins = new Map(); let n = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = 4 * (y * W + x); const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]); if (d > 30) { n++; const k = `${(x / B) | 0},${(y / B) | 0}`; bins.set(k, (bins.get(k) ?? 0) + 1); } }
console.log('changed px (sum|d|>30):', n);
const top = [...bins].sort((p, q) => q[1] - p[1]).slice(0, +(process.argv[4] ?? 25));
console.log(top.map(([k, c]) => { const [bx, by] = k.split(',').map(Number); const lon = ((bx + .5) * B / W * 360 - 180).toFixed(1), lat = (90 - (by + .5) * B / H * 180).toFixed(1); return `${lat},${lon}:${c}`; }).join('  '));
