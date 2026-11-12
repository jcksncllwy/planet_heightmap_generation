// Landform classes of a finished world against Earth's (lane reliefcheck, 2026-11-12; Jackson: "our worlds look far more
// hilly than Earth"). One operator for both, on the same terrain mesh, so the comparison is the ground's, not the method's:
//
//   relief roughness RR (‰) = (highest − lowest land cell in a window) / the window's half-width — Meybeck, Green &
//   Vörösmarty 2001 (Mountain Research and Development 21(1):34–45), who take max − min of GTOPO30 (1 km) in a 30′ cell over
//   half the cell's length (~27.8 km). Our window: the land cells within 31 km (a 30′ cell's area as a disc) at 2.5M; at
//   160K a cell is itself ~a 30′ cell (3190 km²), so its window is the cell and its neighbours, half-width one cell spacing.
//   Mean elevation: the window's land mean. Classes: Meybeck's Table 2 (RR 7 bands × mean elevation 8 bands → 15 classes →
//   9 types, their Figure 2), land not under ice (Meybeck: "currently nonglaciated land", 133 Mkm²).
//   Because our window sees cell means, not 1 km pixels, RR here reads lower than Meybeck's for the same ground; Earth
//   measured by this same tool on the same mesh is the yardstick, Meybeck's own shares only the sanity check.
//
//   node v2/tools/relief-classes.mjs --earth [--cells 2500000] [--etopo <ETOPO5.DAT>] [--json out.json]
//   node v2/tools/relief-classes.mjs --seed 831576 --time 430 [--cont 41] [--sim 40000] [--cells 2500000] [--tset k=v,…] [--json out.json]
//   node v2/tools/relief-classes.mjs --key <finish-cache key> [--json out.json]     (a finished world as the page made it)
//
// A finish run reports every finish stage's surface (render-moment --dump's stages: the synthesized surface, the carve,
// the erosion, …) on the final land, so a stage's share of the roughness shows. Every surface is also binned (area mean)
// onto the 160K mesh as Earth is, for the zoomed-out view. GEO_SIM_DAWN=1: the finish erodes on the GPU, as the page does.
// Heavy at 2.5M: sim-slots run -n 6 --gb 16.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), has = k => argv.includes(k), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
if (process.env.GEO_SIM_DAWN === '1' && !has('--earth') && !has('--key')) await import('./gpu-harness/use-dawn.mjs');
const R = 6371, COARSE = 160000;

// ── Meybeck et al. 2001, Table 2: roughness bands (‰) × mean elevation bands (m) → class 1–15; Figure 2's 9 types ──
const RR_EDGES = [5, 10, 20, 40, 80, 160], RR_NAMES = ['<5', '5-10', '10-20', '20-40', '40-80', '80-160', '>160'];
const EL_EDGES = [200, 500, 1000, 2000, 3000, 4000, 5000];
const CLASS = [   // rows: RR band; columns: elevation 0–200, –500, –1000, –2000, –3000, –4000, –5000, >5000
    [1, 2, 3, 3, 10, 10, 10, 10],          // (<5‰ above 2 km: 0.01 Mkm², pooled with very high plateaus as the paper pools flat ground)
    [4, 6, 7, 8, 9, 9, 10, 10],
    [4, 6, 7, 8, 9, 9, 10, 10],
    [5, 11, 12, 13, 9, 9, 10, 10],
    [5, 11, 12, 13, 14, 14, 15, 15],
    [5, 11, 12, 13, 14, 14, 15, 15],
    [5, 11, 12, 13, 14, 14, 15, 15],       // (>160‰ at 0–1000 m: 0.09 Mkm² unlabelled in the paper; read as their neighbours')
];
const TYPES = [['plains', [1]], ['mid-altitude plains', [2]], ['high-altitude plains', [3]], ['lowlands & platforms', [4, 6]],
    ['low & mid plateaus', [7, 8]], ['high & very high plateaus', [9, 10]], ['rugged lowlands & hills', [5, 11]],
    ['low & mid mountains', [12, 13]], ['high & very high mountains', [14, 15]]];
// Meybeck's own areas (Mkm², Table 2) by type and by RR band, for the sanity line
const MEYBECK = {
    types: [18.74, 11.12, 3.37, 15.0 + 18.97, 11.02 + 4.44, 0.65 + 0.68, 4.17 + 11.52, 13.99 + 13.53, 3.97 + 1.81],   // (mountains 33.3 Mkm² as the paper says)
    rr: [33.24, 25.85, 23.78, 22.43, 19.46, 7.65, 0.57], hyps: [37.91, 79.52, 106.79, 125.87], total: 133.01,
};
const band = (v, edges) => { let k = 0; while (k < edges.length && v >= edges[k]) k++; return k; };

/** RR (‰) and window mean (m) for every land cell of the mesh; land: Uint8 (1 = land not under ice) */
function roughness(mesh, zM, land) {
    const n = mesh.numCells, x = mesh.xyz, { adjOffset: off, adjList: adj } = mesh;
    const fine = mesh.edgeKm < 31, halfKm = fine ? 31 : mesh.edgeKm, cosMax = Math.cos(halfKm / R);
    const rr = new Float32Array(n).fill(NaN), mean = new Float32Array(n).fill(NaN), mark = new Int32Array(n).fill(-1), q = [];
    for (let c = 0; c < n; c++) {
        if (!land[c]) continue;
        let lo = zM[c], hi = zM[c], s = zM[c], k = 1;
        q.length = 0; q.push(c); mark[c] = c;
        for (let h = 0; h < q.length; h++) {
            const a = q[h];
            for (let j = off[a]; j < off[a + 1]; j++) {
                const b = adj[j];
                if (mark[b] === c) continue;
                mark[b] = c;
                const ring1 = a === c;
                if (fine ? x[3 * b] * x[3 * c] + x[3 * b + 1] * x[3 * c + 1] + x[3 * b + 2] * x[3 * c + 2] < cosMax : !ring1) continue;
                if (fine) q.push(b);
                if (!land[b]) continue;
                const v = zM[b];
                if (v < lo) lo = v; if (v > hi) hi = v; s += v; k++;
            }
        }
        rr[c] = 1000 * (hi - lo) / (halfKm * 1000); mean[c] = s / k;
    }
    return { rr, mean, halfKm };
}

/** the table: shares of land (not ice) per type, RR band, hypsometry, and RR quantiles per elevation band */
function measure(mesh, zM, land) {
    const { rr, mean, halfKm } = roughness(mesh, zM, land), n = mesh.numCells;
    const types = new Float64Array(TYPES.length), rrB = new Float64Array(7), hyps = new Float64Array(4), cls = new Float64Array(16);
    const byEl = [[], [], [], []], hist = [0, 1, 2, 3].map(() => new Float64Array(7));   // (hist: RR band × elevation band, for the counterfactuals: one's hypsometry × the other's roughness at each height)           // RR of land at 0–200, 200–500, 500–1000, >1000 m mean elevation
    let N = 0;
    for (let c = 0; c < n; c++) {
        if (!land[c]) continue;
        N++;
        const r = rr[c], e = Math.max(0, mean[c]), cl = CLASS[band(r, RR_EDGES)][band(e, EL_EDGES)];
        cls[cl]++; rrB[band(r, RR_EDGES)]++;
        [200, 500, 1000, 2000].forEach((t, i) => { if (zM[c] < t) hyps[i]++; });
        byEl[band(e, [200, 500, 1000])].push(r);
        hist[band(e, [200, 500, 1000])][band(r, RR_EDGES)]++;
    }
    TYPES.forEach(([, cs], i) => { for (const k of cs) types[i] += cls[k]; });
    const pct = a => [...a].map(v => +(100 * v / N).toFixed(1)), q = (a, p) => a.length ? +a.sort((u, v) => u - v)[Math.floor(p * (a.length - 1))].toFixed(1) : null;
    return {
        cells: mesh.numCells, halfKm: +halfKm.toFixed(1), landMkm2: +(N * 4 * Math.PI * R * R / n / 1e6).toFixed(1),
        types: Object.fromEntries(TYPES.map(([t], i) => [t, pct(types)[i]])),
        rr: Object.fromEntries(RR_NAMES.map((b, i) => [b, pct(rrB)[i]])),
        below: Object.fromEntries([200, 500, 1000, 2000].map((t, i) => [`<${t}m`, pct(hyps)[i]])),
        heightM: (() => { const h = []; for (let c = 0; c < n; c++) if (land[c]) h.push(zM[c]); h.sort((a, b) => a - b); return { mean: Math.round(h.reduce((a, b) => a + b, 0) / h.length), p25: Math.round(h[h.length >> 2]), p50: Math.round(h[h.length >> 1]), p75: Math.round(h[(3 * h.length) >> 2]) }; })(),
        rrHistByElevation: Object.fromEntries(['0-200', '200-500', '500-1000', '>1000'].map((b, i) => [b, pct(hist[i])])),
        rrByElevation: Object.fromEntries(['0-200', '200-500', '500-1000', '>1000'].map((b, i) => [b, { share: +(100 * byEl[i].length / N).toFixed(1), p25: q(byEl[i], 0.25), p50: q(byEl[i], 0.5), p75: q(byEl[i], 0.75) }])),
    };
}

/** a surface on `from` binned onto `to` by area mean (as Earth's), the land mask by majority */
function binOnto(from, zM, land, to) {
    const n = to.numCells, s = new Float64Array(n), k = new Float64Array(n), l = new Float64Array(n), x = from.xyz;
    for (let c = 0; c < from.numCells; c++) {
        const t = to.index.nearest(x[3 * c], x[3 * c + 1], x[3 * c + 2]);
        s[t] += zM[c]; k[t]++; l[t] += land[c];
    }
    const z = new Float32Array(n), L = new Uint8Array(n);
    for (let t = 0; t < n; t++) { z[t] = k[t] ? s[t] / k[t] : NaN; L[t] = k[t] && l[t] / k[t] >= 0.5 ? 1 : 0; }
    for (let t = 0; t < n; t++) if (z[t] !== z[t]) z[t] = nbMean(to, z, t);
    return { z, land: L };
}
function nbMean(mesh, z, c) { let s = 0, k = 0; for (let j = mesh.adjOffset[c]; j < mesh.adjOffset[c + 1]; j++) { const v = z[mesh.adjList[j]]; if (v === v) { s += v; k++; } } return k ? s / k : 0; }

/** ETOPO5 (5′; NOAA NGDC 1988 — the ice surface on the ice sheets) binned onto the mesh by area mean, every pixel */
function earthOnto(mesh, file) {
    const buf = fs.readFileSync(file), n = mesh.numCells, sum = new Float64Array(n), wt = new Float64Array(n), D = Math.PI / 180;
    for (let r = 0; r < 2160; r++) {
        const la = (90 - (r + 0.5) / 12) * D, cl = Math.cos(la), sl = Math.sin(la);
        for (let q = 0; q < 4320; q++) {
            const lo = ((q + 0.5) / 12) * D, c = mesh.index.nearest(cl * Math.cos(lo), cl * Math.sin(lo), sl);
            sum[c] += cl * buf.readInt16BE(2 * (r * 4320 + q)); wt[c] += cl;
        }
    }
    const z = new Float32Array(n);
    for (let c = 0; c < n; c++) z[c] = wt[c] > 0 ? sum[c] / wt[c] : NaN;
    for (let c = 0; c < n; c++) if (z[c] !== z[c]) z[c] = nbMean(mesh, z, c);
    // land: above sea level, not Antarctica nor Greenland's ice sheet (Iceland and Ellesmere kept; Meybeck's nonglaciated land)
    const land = new Uint8Array(n), x = mesh.xyz;
    for (let c = 0; c < n; c++) {
        const lat = Math.asin(x[3 * c + 2]) / D, lon = Math.atan2(x[3 * c + 1], x[3 * c]) / D;
        const greenland = lat > 59.5 && lon > -74 && lon < -10 && !(lat < 67 && lon > -25.5) && !(lon < -60 && lat < 76);
        land[c] = z[c] > 0 && lat > -60 && !greenland ? 1 : 0;
    }
    return { z, land };
}

// land not under ice, by position: not Antarctica nor Greenland's ice sheet (Iceland and Ellesmere kept)
const iceFree = (lat, lon) => lat > -60 && !(lat > 59.5 && lon > -74 && lon < -10 && !(lat < 67 && lon > -25.5) && !(lon < -60 && lat < 76));

/** ETOPO1 (1′, ice surface, grid-registered, int16 LE, stored north-up: row 0 = 90°N — checked on Everest, 8271 m;
 *  Amante & Eakins 2009) binned onto the mesh by area mean, every pixel (the last column repeats −180°, skipped) —
 *  the check that ETOPO5's 5′ smoothing does not flatten the yardstick */
const E1W = 21601, E1H = 10801;
function etopo1Rows(file, each) {
    const fd = fs.openSync(file, 'r'), ROWS = 300, buf = Buffer.alloc(2 * E1W * ROWS);
    for (let r0 = 0; r0 < E1H; r0 += ROWS) {
        const k = Math.min(ROWS, E1H - r0);
        fs.readSync(fd, buf, 0, 2 * E1W * k, 2 * E1W * r0);
        for (let i = 0; i < k; i++) each(r0 + i, buf, 2 * E1W * i);
    }
    fs.closeSync(fd);
}
function earthOnto1(mesh, file) {
    const n = mesh.numCells, sum = new Float64Array(n), wt = new Float64Array(n), D = Math.PI / 180;
    const cosL = Float64Array.from({ length: E1W - 1 }, (_, q) => Math.cos((q / 60 - 180) * D)), sinL = cosL.map((_, q) => Math.sin((q / 60 - 180) * D));
    etopo1Rows(file, (r, buf, o) => {
        const la = (90 - r / 60) * D, cl = Math.cos(la), sl = Math.sin(la), w = Math.max(cl, 1e-4);
        for (let q = 0; q < E1W - 1; q++) {
            const c = mesh.index.nearest(cl * cosL[q], cl * sinL[q], sl);
            sum[c] += w * buf.readInt16LE(o + 2 * q); wt[c] += w;
        }
    });
    const z = new Float32Array(n);
    for (let c = 0; c < n; c++) z[c] = wt[c] > 0 ? sum[c] / wt[c] : NaN;
    for (let c = 0; c < n; c++) if (z[c] !== z[c]) z[c] = nbMean(mesh, z, c);
    const land = new Uint8Array(n), x = mesh.xyz;
    for (let c = 0; c < n; c++) land[c] = z[c] > 0 && iceFree(Math.asin(x[3 * c + 2]) / D, Math.atan2(x[3 * c + 1], x[3 * c]) / D) ? 1 : 0;
    return { z, land };
}

/** Meybeck's own operator on ETOPO1 (his GTOPO30 was 30″; 1′ is the nearest global grid we hold): in each 30′ box, RR =
 *  (highest − lowest land pixel) / 27.8 km (half the box's length at the equator, as the paper), the mean elevation that of
 *  its land pixels; a box is land with ≥ half its pixels above sea level, weighted by its area × its land share. This
 *  reproduces the paper's Table 1 shares or it does not — the validation of the class table itself, apart from any mesh. */
function meybeckBoxes(file) {
    const NB = 720, MB = 360, mx = new Float32Array(NB * MB).fill(-1e9), mn = new Float32Array(NB * MB).fill(1e9);
    const s = new Float64Array(NB * MB), k = new Float64Array(NB * MB), all = new Float64Array(NB * MB);
    etopo1Rows(file, (r, buf, o) => {
        const br = Math.min(MB - 1, Math.floor(r / 30));
        for (let q = 0; q < E1W - 1; q++) {
            const b = br * NB + Math.floor(q / 30), v = buf.readInt16LE(o + 2 * q);
            all[b]++;
            if (v <= 0) continue;
            if (v > mx[b]) mx[b] = v; if (v < mn[b]) mn[b] = v; s[b] += v; k[b]++;
        }
    });
    const types = new Float64Array(TYPES.length), rrB = new Float64Array(7), hyps = new Float64Array(4), cls = new Float64Array(16);
    let N = 0;
    for (let br = 0; br < MB; br++) for (let bq = 0; bq < NB; bq++) {
        const b = br * NB + bq, lat = 90 - (br + 0.5) / 2, lon = (bq + 0.5) / 2 - 180;
        if (k[b] < 0.5 * all[b] || !iceFree(lat, lon)) continue;
        const w = Math.cos(lat * Math.PI / 180) * k[b] / all[b], r = (mx[b] - mn[b]) / 27.8, e = s[b] / k[b];
        N += w; cls[CLASS[band(r, RR_EDGES)][band(e, EL_EDGES)]] += w; rrB[band(r, RR_EDGES)] += w;
        [200, 500, 1000, 2000].forEach((t, i) => { if (e < t) hyps[i] += w; });
    }
    TYPES.forEach(([, cs], i) => { for (const c of cs) types[i] += cls[c]; });
    const pct = a => [...a].map(v => +(100 * v / N).toFixed(1));
    return { boxes: '30′ ETOPO1', landMkm2: +(N * (6371 * Math.PI / 360) ** 2 / 1e6).toFixed(1),
        types: Object.fromEntries(TYPES.map(([t], i) => [t, pct(types)[i]])), rr: Object.fromEntries(RR_NAMES.map((b, i) => [b, pct(rrB)[i]])),
        below: Object.fromEntries([200, 500, 1000, 2000].map((t, i) => [`<${t}m`, pct(hyps)[i]])) };
}

const out = { tool:'v2/tools/relief-classes.mjs', scheme: 'Meybeck, Green & Vörösmarty 2001, MRD 21(1):34–45, Table 2', meybeck: {
    types: Object.fromEntries(TYPES.map(([t], i) => [t, +(100 * MEYBECK.types[i] / MEYBECK.total).toFixed(1)])),
    rr: Object.fromEntries(RR_NAMES.map((b, i) => [b, +(100 * MEYBECK.rr[i] / MEYBECK.total).toFixed(1)])),
    below: Object.fromEntries([200, 500, 1000, 2000].map((t, i) => [`<${t}m`, +(100 * MEYBECK.hyps[i] / MEYBECK.total).toFixed(1)])),
}, surfaces: {} };
const put = (name, mesh, zM, land) => {
    const row = { native: measure(mesh, zM, land) };
    if (mesh.numCells > COARSE * 1.5) { const cm = terrainMesh(COARSE), b = binOnto(mesh, zM, land, cm); row.binned160k = measure(cm, b.z, b.land); }
    out.surfaces[name] = row;
    const f = m => `${m.cells}: ${Object.entries(m.types).map(([k, v]) => `${k} ${v}`).join(' · ')} | RR ${Object.values(m.rr).join('/')} | below ${Object.values(m.below).join('/')}`;
    console.log(`${name}\n  ${f(row.native)}${row.binned160k ? `\n  ${f(row.binned160k)}` : ''}`);
};

if (has('--etopo1')) {
    // node v2/tools/relief-classes.mjs --etopo1 <etopo1_ice_g_i2.bin> [--cells 2500000] [--json out.json]
    const file = arg('--etopo1'), cells = Number(arg('--cells', 2500000));
    out.what = { earth: 'ETOPO1 ice', file, cells };
    out.meybeckOperator = meybeckBoxes(file);
    console.log(`meybeck 30′ boxes: ${JSON.stringify(out.meybeckOperator)}`);
    const mesh = terrainMesh(cells), e = earthOnto1(mesh, file);
    put('earth (ETOPO1)', mesh, e.z, e.land);
    if (cells !== COARSE) { const cm = terrainMesh(COARSE), e2 = earthOnto1(cm, file); out.surfaces['earth (ETOPO1)'].direct160k = measure(cm, e2.z, e2.land); console.log(`direct 160K: ${JSON.stringify(out.surfaces['earth (ETOPO1)'].direct160k.rr)}`); }
} else if (has('--earth')) {
    const file = arg('--etopo', [path.join(ROOT, 'tuning/civ/data/raw/etopo/ETOPO5.DAT'), path.join(os.homedir(), '.cache/geo-sim/worktree-archive/sliders/tuning/civ/data/raw/etopo/ETOPO5.DAT')].find(f => fs.existsSync(f)));
    const cells = Number(arg('--cells', 2500000)), mesh = terrainMesh(cells), e = earthOnto(mesh, file);
    out.what = { earth: 'ETOPO5', file, cells };
    put('earth', mesh, e.z, e.land);
    // and Earth binned straight onto 160K from the pixels (not via the 2.5M cells)
    if (cells !== COARSE) { const cm = terrainMesh(COARSE), e2 = earthOnto(cm, file); out.surfaces.earth.direct160k = measure(cm, e2.z, e2.land); }
} else if (has('--key')) {
    const { loadFinish } = await import('./lib/finish-cache.mjs');
    const fin = await loadFinish(arg('--key'), { mesh: true });
    const n = fin.mesh.numCells, zM = new Float32Array(n), land = new Uint8Array(n);
    for (let c = 0; c < n; c++) { zM[c] = 1000 * fin.cells.z[c]; land[c] = !fin.cells.ocean[c] && !fin.cells.glaciated?.[c] ? 1 : 0; }
    out.what = { key: arg('--key'), seed: fin.meta?.seed, spec: fin.spec };
    put('final (page)', fin.mesh, zM, land);
} else {
    const { buildSimMesh } = await import('../js/core/sim-mesh.js');
    const { TerrainPool } = await import('../js/terrain/terrain-pool.js');
    const { momentFrame, MESH_SEED, DEFAULT_CONT } = await import('./lib/moment-frame.mjs');
    const { finishPlanet } = await import('../js/finish/finish.js');
    const { terrainConfig } = await import('../js/terrain/terrain-config.js');
    const SEED = Number(arg('--seed', 831576)), TIME = Number(arg('--time', 430)), CONT = Number(arg('--cont', DEFAULT_CONT)), SIM = Number(arg('--sim', 40000)), CELLS = Number(arg('--cells', 2500000));
    const TSET = Object.fromEntries((arg('--tset', '') || '').split(/,(?=[A-Za-z])/).filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, Number.isFinite(Number(v)) ? Number(v) : JSON.parse(v)]; }));
    const frame = await momentFrame(ROOT, { seed: SEED, cont: CONT, sim: SIM, time: TIME });
    const simMesh = buildSimMesh(SIM, MESH_SEED), pool = await TerrainPool.create(simMesh), stages = [];
    const t0 = performance.now();
    // (--fset '{"erode":{"spanWindow":false}}': the finish's settings for a diagnosis — an object merged one level deep into FINISH)
    const { FINISH } = await import('../js/finish/finish-config.js'), FSET = JSON.parse(arg('--fset', '{}'));
    const F = { ...FINISH }; for (const [k, v] of Object.entries(FSET)) F[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(typeof FINISH[k] === 'object' ? FINISH[k] : {}), ...v } : v;
    const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, cfg: terrainConfig(TSET), F,
        observe: (name, m, z) => { if (!name.startsWith('rung ')) stages.push([name, Float32Array.from(z, v => 1000 * v)]); } });
    out.what = { seed: SEED, time: TIME, cont: CONT, sim: SIM, cells: CELLS, tset: TSET, fset: FSET, tectSpanMyr: frame.tectSpanMyr, erodeOn: fin.stats.erodeOn ?? 'off', finishS: Math.round((performance.now() - t0) / 1000) };
    const n = fin.mesh.numCells, land = new Uint8Array(n);
    for (let c = 0; c < n; c++) land[c] = !fin.ocean[c] && !fin.glaciated?.[c] ? 1 : 0;
    // (every stage on the FINAL land, so a stage's change is the ground's, not the coast's)
    stages.push(['final', Float32Array.from(fin.z, v => 1000 * v)]);
    for (const [name, zM] of stages) put(name, fin.mesh, zM, land);
}
const json = arg('--json', null);
if (json) fs.writeFileSync(json, JSON.stringify(out, null, 1));
process.exit(0);
