// Earth's winds and currents, by month, for the civ layer's travel graph (plans/CIV_PLAN.md §10.1; v2/js/civ/routes.js),
// on the climate's 1° grid (360 × 180, rows from the north, columns from 180° W) as a finish gives a planet's (w.flow):
//   winds: NCEP/NCAR Reanalysis 1 (Kalnay et al. 1996), near-surface (σ 0.995), monthly long-term means 1991–2020, 2.5°
//   currents: NCEP GODAS (Behringer & Xue 2004), the top level (5 m), each month's mean over 2018–2020, ⅓–1°
// Both public domain, from NOAA PSL's THREDDS server (OPeNDAP subsets: no account, no netCDF reader needed).
//
//   node tuning/civ/fetch-flow.mjs        → tuning/civ/data/earth-flow.bin (earth-world.mjs earthFlow reads it)

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data');
const OUT = path.join(DIR, 'earth-flow.bin');
const DODS = 'https://psl.noaa.gov/thredds/dodsC/Datasets';
const YEARS = [2018, 2019, 2020];
const RAW = path.join(DIR, 'raw', 'flow');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = 360, H = 180, G = W * H;

/** An OPeNDAP ASCII response: the named array's values in order, and the named 1-D maps. */
async function dods(url, name, maps = []) {
    const file = path.join(RAW, url.replace(/^.*Datasets\//, '').replace(/[^\w.]+/g, '_') + '.txt');
    let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    for (let tries = 0; !text; tries++) {
        try {
            await sleep(1500);                                                      // (gently: the server limits the rate)
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
            const t = await res.text();
            if (!t.includes(`${name}.${name}[`)) throw new Error('no data in the reply');
            fs.mkdirSync(RAW, { recursive: true }); fs.writeFileSync(file, t); text = t;
        } catch (err) {
            if (tries >= 5) throw err;
            console.warn(`  retrying (${err.message})`);
            await sleep(/429/.test(err.message) ? 60000 : 10000);
        }
    }
    const out = { data: [], maps: {} };
    for (const b of text.split('\n\n')) {
        const lines = b.trim().split('\n'), h = lines.findIndex(l => l.startsWith(`${name}.`));
        if (h < 0) continue;
        if (lines[h].startsWith(`${name}.${name}[`)) for (const line of lines.slice(h + 1)) { const p = line.split(','); for (let i = 1; i < p.length; i++) out.data.push(Number(p[i])); }
        for (const m of maps) if (lines[h].startsWith(`${name}.${m}[`)) out.maps[m] = lines[h + 1].split(',').map(Number);
    }
    return out;
}

/** Bilinear onto the 1° grid from a lat–lon grid (lats any order, lons from 0° E, wrapping), missing → 0. */
function regrid(src, lats, lons) {
    const out = new Float32Array(12 * G), nla = lats.length, nlo = lons.length, dlo = lons[1] - lons[0];
    for (let j = 0; j < H; j++) {
        const la = 90 - (j + 0.5);
        // (the source rows either side)
        let r0 = -1;
        for (let r = 0; r < nla - 1; r++) { const a = lats[r], b = lats[r + 1]; if ((la - a) * (la - b) <= 0) { r0 = r; break; } }
        if (r0 < 0) continue;                                                       // (outside the source's latitudes: 0)
        const fy = (la - lats[r0]) / (lats[r0 + 1] - lats[r0]);
        for (let i = 0; i < W; i++) {
            const lo = ((-180 + i + 0.5) + 360) % 360, x = (lo - lons[0]) / dlo, q0 = ((Math.floor(x) % nlo) + nlo) % nlo, q1 = (q0 + 1) % nlo, fx = x - Math.floor(x);
            for (let m = 0; m < 12; m++) {
                const o = m * nla * nlo, v = (r, q) => { const x = src[o + r * nlo + q]; return x === x && Math.abs(x) < 100 ? x : NaN; };
                const p = [[v(r0, q0), (1 - fx) * (1 - fy)], [v(r0, q1), fx * (1 - fy)], [v(r0 + 1, q0), (1 - fx) * fy], [v(r0 + 1, q1), fx * fy]];
                let s = 0, ws = 0;
                for (const [x, wt] of p) if (x === x) { s += x * wt; ws += wt; }
                out[m * G + j * W + i] = ws > 0.25 ? s / ws : 0;
            }
        }
    }
    return out;
}

const wind = {};
for (const v of ['uwnd', 'vwnd']) {
    console.log(`NCEP R1 ${v}…`);
    const r = await dods(`${DODS}/ncep.reanalysis/Monthlies/surface/${v}.sig995.mon.ltm.1991-2020.nc.ascii?${v}`, v, ['lat', 'lon']);
    wind[v] = regrid(r.data, r.maps.lat, r.maps.lon);
}
const cur = {};
for (const v of ['ucur', 'vcur']) {
    let sum = null, cnt = null, lats, lons;
    for (const y of YEARS) for (let m = 0; m < 12; m++) {
        console.log(`GODAS ${v} ${y}-${m + 1}…`);
        const r = await dods(`${DODS}/godas/${v}.${y}.nc.ascii?${v}%5B${m}:${m}%5D%5B0:0%5D%5B0:417%5D%5B0:359%5D`, v, ['lat', 'lon']);
        lats = r.maps.lat; lons = r.maps.lon;
        const N = r.data.length;
        sum ??= new Float64Array(12 * N); cnt ??= new Uint8Array(12 * N);
        r.data.forEach((x, i) => { if (Math.abs(x) < 100) { sum[m * N + i] += x; cnt[m * N + i]++; } });
    }
    cur[v] = regrid(Float64Array.from(sum, (s, i) => (cnt[i] ? s / cnt[i] : NaN)), lats, lons);
}
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(OUT, v8.serialize({ w: W, h: H, windU: wind.uwnd, windV: wind.vwnd, curU: cur.ucur, curV: cur.vcur,
    source: 'NCEP/NCAR R1 σ0.995 winds 1991–2020; GODAS 5 m currents 2018–2020' }));
const mag = (U, V) => { let s = 0; for (let i = 0; i < U.length; i++) s += Math.hypot(U[i], V[i]); return s / U.length; };
console.log(`→ ${OUT}: mean wind ${mag(wind.uwnd, wind.vwnd).toFixed(2)} m/s, mean current ${mag(cur.ucur, cur.vcur).toFixed(3)} m/s`);
