#!/usr/bin/env node
// Climate review (Q3): the high latitudes of Evolution worlds. Report-only. For each seed@moment: the finish (for its
// carved surface and its glaciated cells), the climate again on that surface (the finish keeps only the cells' summary),
// then at ≥ 60° per hemisphere: land ice share and height, the warmest month at the ground's own height on bare land
// (all, and lowland under 200 m), sea-ice extent at its max and min, and the global mean temperature.
// --alt k=v,…  also re-runs the climate on the same surface with those climate PARAMS (e.g. the ice-sheet rules) to see
// which branch the high latitudes take; the finish itself is not re-run.
//   node v2/tools/climate-review-polar.mjs --runs 831576@310,626225@300 [--cells 160000] [--alt TEMP_ICE_KEEP=[0.6,0.8]]
// Run through sim-slots (sim-slots run -n 4 --gb 8 --who climrev -- node …). One JSON line per run (and per alt).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { CORE_DEFAULTS } from '../js/climate/core.js';
import { planetClimate } from '../js/climate/climate.js';
import { setParams, resetParams } from '../js/climate/config.js';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CONT = Number(arg('--cont', 30)), SIM = Number(arg('--sim', 40000)), CELLS = Number(arg('--cells', 160000));
const parseSet = (s) => Object.fromEntries((s || '').split(/,(?=[A-Za-z])/).filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, JSON.parse(v)]; }));
const ALT = parseSet(arg('--alt', ''));
const simMesh = buildSimMesh(SIM, MESH_SEED), gamma = CORE_DEFAULTS.lapseRateCPerKm;
const r1 = x => Math.round(10 * x) / 10, R2 = 4 * Math.PI * 6371 ** 2;

/** The high-latitude numbers from a climate result on the finish's surface. */
export function polarStats(res, { z, ocean, lake }, glaciated) {
    const n = z.length, km2 = R2 / n, G = res.grid.size, T = res.stages.temperature;
    const { lat } = res.cell, M = res.months.T;
    // warmest month at each cell's own height: the grid's sea-level warmest month (finish.js warmSl), less the lapse
    const warmG = new Float32Array(G).fill(-Infinity);
    for (let g = 0; g < G; g++) {
        const href = res.surface.meanLandKm[g] === res.surface.meanLandKm[g] ? Math.max(0, res.surface.meanLandKm[g]) : 0;
        for (let m = 0; m < 12; m++) { const t = M[m * G + g] + gamma * href; if (t > warmG[g]) warmG[g] = t; }
    }
    const gw = res.grid.w, gh = res.grid.h, gLat = (g) => res.grid.lat[Math.floor(g / gw)];
    const cellG = (c) => { const j = Math.max(0, Math.min(gh - 1, Math.round((90 - lat[c]) / (180 / gh) - 0.5))), i = ((Math.floor((res.cell.lon[c] + 180) / (360 / gw)) % gw) + gw) % gw; return j * gw + i; };
    const hemi = { N: null, S: null };
    for (const h of ['N', 'S']) {
        const s = { landK: 0, iceK: 0, iceMeanKm: 0, bareMeanKm: 0, bare: [0, 0, 0, 0], bareLow: [0, 0, 0, 0], bareLow75: [0, 0, 0, 0], bareLow75K: 0, warmBareLowMax: -Infinity };
        for (let c = 0; c < n; c++) {
            const la = h === 'N' ? lat[c] : -lat[c];
            if (la < 60 || (ocean[c] && !lake[c])) continue;
            s.landK += km2;
            if (glaciated?.[c]) { s.iceK += km2; s.iceMeanKm += km2 * Math.max(0, z[c]); continue; }
            s.bareMeanKm += km2 * Math.max(0, z[c]);
            const w = warmG[cellG(c)] - gamma * Math.max(0, z[c]), b = w < 0 ? 0 : w < 5 ? 1 : w < 10 ? 2 : 3;
            s.bare[b] += km2;
            if (z[c] < 0.2) { s.bareLow[b] += km2; if (la >= 75) { s.bareLow75[b] += km2; s.bareLow75K += km2; if (w > s.warmBareLowMax) s.warmBareLowMax = w; } }
        }
        const bareK = s.landK - s.iceK, lowK = s.bareLow.reduce((a, b) => a + b, 0);
        hemi[h] = { landMkm2: r1(s.landK / 1e6), iceSharePct: s.landK ? r1(100 * s.iceK / s.landK) : null,
            iceMeanKm: s.iceK ? +(s.iceMeanKm / s.iceK).toFixed(2) : null, bareMeanKm: bareK ? +(s.bareMeanKm / bareK).toFixed(2) : null,
            bareWarmPct_lt0_0to5_5to10_gt10: s.bare.map(v => bareK ? r1(100 * v / bareK) : null),
            bareLowWarmPct: s.bareLow.map(v => lowK ? r1(100 * v / lowK) : null),
            bareLow75Mkm2: r1(s.bareLow75K / 1e6), bareLow75WarmPct: s.bareLow75.map(v => s.bareLow75K ? r1(100 * v / s.bareLow75K) : null),
            bareLow75WarmMaxC: s.bareLow75K ? r1(s.warmBareLowMax) : null };
    }
    // the grid: global means, land ice by the climate's own sheet share, sea ice extent
    let wS = 0, tSurf = 0, tSL = 0, iceGridK = { N: 0, S: 0 };
    const rowA = (g) => Math.cos(gLat(g) * Math.PI / 180);
    let aSum = 0; for (let g = 0; g < G; g++) aSum += rowA(g);
    const gkm2 = (g) => rowA(g) / aSum * R2;
    for (let g = 0; g < G; g++) {
        let a = 0, b = 0, ok = true;
        for (let m = 0; m < 12; m++) { a += M[m * G + g]; b += T.monthlySL[m * G + g]; if (!(M[m * G + g] === M[m * G + g])) ok = false; }
        if (!ok) continue;
        wS += rowA(g); tSurf += rowA(g) * a / 12; tSL += rowA(g) * b / 12;
        const fr = (T.iceFrac?.[g] || 0) * (res.surface.landFrac[g] || 0);
        if (fr > 0) iceGridK[gLat(g) > 0 ? 'N' : 'S'] += fr * gkm2(g);
    }
    const si = T.seaIce, ext = { N: [], S: [] };
    for (let m = 0; m < 12; m++) { let a = 0, b = 0; for (let g = 0; g < G; g++) if (si[m * G + g] > 0.15) { if (gLat(g) > 0) a += gkm2(g); else b += gkm2(g); } ext.N.push(a / 1e6); ext.S.push(b / 1e6); }
    return { globalT: r1(tSurf / wS), globalTsl: r1(tSL / wS), landIceGridMkm2: { N: r1(iceGridK.N / 1e6), S: r1(iceGridK.S / 1e6) },
        seaIceMkm2: { Nmax: r1(Math.max(...ext.N)), Nmin: r1(Math.min(...ext.N)), Smax: r1(Math.max(...ext.S)), Smin: r1(Math.min(...ext.S)) }, hemi };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    for (const run of arg('--runs', '831576@310').split(',')) {
        const [seed, time] = run.split('@').map(Number), t0 = performance.now();
        const frame = await momentFrame(ROOT, { seed, cont: CONT, sim: SIM, time });
        const pool = await TerrainPool.create(simMesh);
        const fin = await finishPlanet({ frame, simMesh, seed, cells: CELLS, pool, closePool: true, onStage: () => {} });
        const input = { xyz: fin.mesh.xyz, elevKm: fin.z, axes: 'z-up' };
        const base = polarStats(planetClimate(input), fin, fin.glaciated);
        console.log(JSON.stringify({ run, cells: CELLS, s: Math.round((performance.now() - t0) / 1000), alt: null, ...base }));
        if (Object.keys(ALT).length) {
            setParams(ALT);
            // (no finish here: the glaciated cells are the climate's own sheets, by its grid ice share ≥ 0.5)
            const r = planetClimate(input), ice = new Uint8Array(fin.z.length), G = r.grid;
            for (let c = 0; c < ice.length; c++) {
                const j = Math.max(0, Math.min(G.h - 1, Math.round((90 - r.cell.lat[c]) / (180 / G.h) - 0.5))), i = ((Math.floor((r.cell.lon[c] + 180) / (360 / G.w)) % G.w) + G.w) % G.w;
                ice[c] = (r.stages.temperature.iceFrac?.[j * G.w + i] || 0) >= 0.5 ? 1 : 0;
            }
            console.log(JSON.stringify({ run, alt: ALT, ...polarStats(r, fin, ice) }));
            resetParams();
        }
    }
}
