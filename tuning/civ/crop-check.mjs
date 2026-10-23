// The crops' climate (v2/js/civ/crops.js) on Earth's own months (WorldClim 2.1 at 10′), against GAEZ v4's low-input
// rain-fed attainable yields (Fischer et al. 2021; 1981–2010, CRU TS 3.2): per crop class, the correlation over land
// (Pearson, and Spearman's by ranks), and maps side by side (ours left, GAEZ right, each crop class a row).
//
//   node --max-old-space-size=8000 tuning/civ/crop-check.mjs
//
// Needs tuning/civ/fetch-earth.sh's WorldClim and GAEZ files. → v2/out/civ/crop-check.png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromArrayBuffer } from 'geotiff';
import { cropClimate } from '../../v2/js/civ/crops.js';
import { writePng, drawText } from '../../v2/tools/lib/civ-world.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), RAW = path.join(HERE, 'data', 'raw'), OUT = path.join(HERE, '..', '..', 'v2', 'out', 'civ');
async function readTif(file) {
    const buf = fs.readFileSync(file), tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const img = await tiff.getImage(), [data] = await img.readRasters();
    return { w: img.getWidth(), h: img.getHeight(), data };
}

// our classes and GAEZ's crops for each (the best of them, each scaled by its own 95th percentile over land)
const GROUPS = [
    ['winterCereal', ['whe', 'brl']],
    ['summerCereal', ['pml', 'srg', 'fml', 'mze']],
    ['roots', ['yam', 'csv', 'spo', 'wpo']],
    ['tree', ['ban', 'coc']],
    ['paddy', ['rcw']],
];

const wc = f => readTif(path.join(RAW, 'wc', f));
const T = [], P = [];
for (let k = 1; k <= 12; k++) { T.push((await wc(`wc2.1_10m_tavg_${String(k).padStart(2, '0')}.tif`)).data); P.push((await wc(`wc2.1_10m_prec_${String(k).padStart(2, '0')}.tif`)).data); }
const W = 2160, H = 1080, D = Math.PI / 180;
const ours = Object.fromEntries(GROUPS.map(([g]) => [g, new Float32Array(W * H).fill(NaN)]));
const T12 = new Float64Array(12), P12 = new Float64Array(12), s = {};
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (!(T[0][k] > -1e4)) continue;
    for (let q = 0; q < 12; q++) { T12[q] = T[q][k]; P12[q] = P[q][k]; }
    cropClimate(T12, P12, (90 - (j + 0.5) / 6) * D, s);
    for (const [g] of GROUPS) ours[g][k] = s[g];
}

const pct = (a, p) => { const v = Array.from(a).filter(x => x > 0).sort((x, y) => x - y); return v.length ? v[Math.floor(p * (v.length - 1))] : 1; };
const gaez = {};
for (const [g, codes] of GROUPS) {
    const best = new Float32Array(W * H).fill(NaN);
    for (const code of codes) {
        const t = await readTif(path.join(RAW, 'gaez', `ylLr_${code}.tif`));
        const sx = t.w / W, sy = t.h / H, v = new Float32Array(W * H).fill(NaN);
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
            let sum = 0, n = 0;
            for (let b = 0; b < sy; b++) for (let a = 0; a < sx; a++) { const x = t.data[(j * sy + b) * t.w + i * sx + a]; if (x >= 0) { sum += x; n++; } }
            if (n) v[j * W + i] = sum / n;
        }
        const top = pct(v, 0.95);
        for (let k = 0; k < W * H; k++) if (v[k] === v[k]) best[k] = Math.max(best[k] === best[k] ? best[k] : 0, Math.min(1, v[k] / top));
    }
    gaez[g] = best;
}

const rank = a => { const idx = a.map((x, i) => i).sort((x, y) => a[x] - a[y]), r = new Float64Array(a.length); for (let i = 0; i < idx.length; ) { let j = i; while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++; for (let q = i; q <= j; q++) r[idx[q]] = (i + j) / 2; i = j + 1; } return r; };
const pearson = (x, y) => { const n = x.length; let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; } return sxy / Math.sqrt(sxx * syy); };
console.log('crop class      Pearson  Spearman  (land cells, area-weighted sample)  ours>0.3 & GAEZ<0.1  ours<0.1 & GAEZ>0.3');
const report = {};
for (const [g] of GROUPS) {
    const x = [], y = [];
    let over = 0, under = 0, n = 0;
    for (let j = 0; j < H; j++) {
        const keep = Math.cos((90 - (j + 0.5) / 6) * D);        // (a sample in proportion to area)
        for (let i = 0; i < W; i++) {
            const k = j * W + i, a = ours[g][k], b = gaez[g][k];
            if (!(a === a) || !(b === b) || ((i * 7919 + j * 104729) % 1000) / 1000 > keep) continue;
            x.push(a); y.push(b); n++;
            if (a > 0.3 && b < 0.1) over++;
            if (a < 0.1 && b > 0.3) under++;
        }
    }
    const r = pearson(x, y), rho = pearson(rank(x), rank(y));
    report[g] = { pearson: +r.toFixed(3), spearman: +rho.toFixed(3), over: +(over / n).toFixed(3), under: +(under / n).toFixed(3) };
    console.log(`${g.padEnd(14)}  ${r.toFixed(2).padStart(6)}  ${rho.toFixed(2).padStart(8)}   ${''.padEnd(35)}${(100 * over / n).toFixed(1).padStart(5)} %${(100 * under / n).toFixed(1).padStart(20)} %`);
}

// the maps: half size, ours | GAEZ, a row per class
const w = W / 2, h = H / 2, img = new Uint8ClampedArray(2 * w * GROUPS.length * h * 4);
const colour = v => (v === v ? [Math.round(40 + 200 * v), Math.round(60 + 170 * v * v), Math.round(40 + 40 * (1 - v))] : [20, 28, 48]);
GROUPS.forEach(([g], row) => {
    for (const [col, src] of [[0, ours[g]], [1, gaez[g]]]) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const v = src[(2 * j) * W + 2 * i], c = colour(v), o = 4 * ((row * h + j) * 2 * w + col * w + i);
        img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255;
    }
});
const sheet = { w: 2 * w, h: GROUPS.length * h };
GROUPS.forEach(([g], row) => { drawText(img, sheet.w, sheet.h, 8, row * h + 8, `${g} ours`, { scale: 2 }); drawText(img, sheet.w, sheet.h, w + 8, row * h + 8, 'GAEZ', { scale: 2 }); });
fs.mkdirSync(OUT, { recursive: true });
writePng(path.join(OUT, 'crop-check.png'), sheet.w, sheet.h, img);
fs.writeFileSync(path.join(OUT, 'crop-check.json'), JSON.stringify(report, null, 1));
console.log('→ v2/out/civ/crop-check.{png,json}');
