#!/usr/bin/env node
// Report-only check (climate review Q3, 2026-11-06): are a world's high latitudes physically consistent with its own ice
// sheets and its own warmth? NOT wired into the gate: it prints PASS/WARN per item and always exits 0. It does not ask
// that a world look like Earth (seeds need not), only that one world's polar land, ice and summers hang together.
//
//   1. transition: in a hemisphere with both ice sheets and bare land at ≥ 60°, some bare land should be tundra-warm
//      (warmest month 0–10 °C at its own height). An ice margin implies a cold ablation fringe; a world whose polar land
//      is either sheet or > 10 °C summers is a switch, not a climate. WARN below 5 % of the bare land.
//   2. margin: bare land next to an ice sheet (mesh neighbours) should have a cool summer. Greenland's ice-free margin
//      runs 5–11 °C in July. WARN if the median margin warmest month is above 12 °C.
//   3. polar summer vs the world's warmth: the warmest month on bare lowland (< 200 m) at ≥ 75° against the global mean
//      annual temperature. Paleo envelope: today ≈ 2–8 °C at a 14 °C world (−6…−12 K); mid-Pliocene Ellesmere 10–14 °C
//      at ≈ +3 K (Csank et al. 2011; Brigham-Grette et al. 2013), −4…−7 K; early Eocene Ellesmere 19–20 °C (Eberle
//      et al. 2010) in a world ≈ 10 K warmer than today, ≈ −4 K. WARN if the 90th percentile is above global mean + 0 K.
//
//   node v2/tools/check-climate-polar.mjs --runs 831576@310,626225@300 [--cells 160000]
// Run through sim-slots. Uses climate-review-polar.mjs's loading (the finish, then the climate on its surface).
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

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CONT = Number(arg('--cont', 30)), SIM = Number(arg('--sim', 40000)), CELLS = Number(arg('--cells', 160000));
const gamma = CORE_DEFAULTS.lapseRateCPerKm;
const TRANSITION_MIN = 0.05, MARGIN_MAX_C = 12, POLAR_SUMMER_OVER_MEAN_K = 0;

const quantile = (a, q) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

/** The three consistency items for one finished world and its climate. */
export function polarConsistency(fin, res) {
    const { z, ocean, lake, glaciated, mesh } = fin, n = z.length, G = res.grid.size, M = res.months.T, gw = res.grid.w, gh = res.grid.h;
    const { lat, lon } = res.cell;
    const warmG = new Float32Array(G).fill(-Infinity);
    for (let g = 0; g < G; g++) {
        const href = res.surface.meanLandKm[g] === res.surface.meanLandKm[g] ? Math.max(0, res.surface.meanLandKm[g]) : 0;
        for (let m = 0; m < 12; m++) { const t = M[m * G + g] + gamma * href; if (t > warmG[g]) warmG[g] = t; }
    }
    const gOf = (c) => Math.max(0, Math.min(gh - 1, Math.round((90 - lat[c]) / (180 / gh) - 0.5))) * gw + ((Math.floor((lon[c] + 180) / (360 / gw)) % gw) + gw) % gw;
    const warmAt = (c) => warmG[gOf(c)] - gamma * Math.max(0, z[c]);
    const isLand = (c) => !(ocean[c] && !lake[c]);
    // global mean annual temperature (grid, area-weighted)
    let tw = 0, ts = 0;
    for (let g = 0; g < G; g++) { const a = Math.cos(res.grid.lat[Math.floor(g / gw)] * Math.PI / 180); let s = 0; for (let m = 0; m < 12; m++) s += M[m * G + g]; if (s === s) { tw += a; ts += a * s / 12; } }
    const globalT = ts / tw;
    const out = { globalT: +globalT.toFixed(1), hemi: {} };
    for (const h of ['N', 'S']) {
        let ice = 0, bare = 0, tundra = 0; const margin = [], polar = [];
        for (let c = 0; c < n; c++) {
            const la = h === 'N' ? lat[c] : -lat[c];
            if (la < 60 || !isLand(c)) continue;
            if (glaciated?.[c]) { ice++; continue; }
            bare++;
            const w = warmAt(c);
            if (w >= 0 && w <= 10) tundra++;
            if (la >= 75 && z[c] < 0.2) polar.push(w);
            for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) if (glaciated?.[mesh.adjList[k]]) { margin.push(w); break; }
        }
        const r = { iceCells: ice, bareCells: bare };
        if (ice && bare) {
            const share = tundra / bare;
            r.transition = { tundraShare: +share.toFixed(3), verdict: share >= TRANSITION_MIN ? 'PASS' : 'WARN' };
        } else r.transition = { verdict: 'n/a' };
        if (margin.length) { const med = quantile(margin, 0.5); r.margin = { cells: margin.length, medianWarmestC: +med.toFixed(1), verdict: med <= MARGIN_MAX_C ? 'PASS' : 'WARN' }; }
        else r.margin = { verdict: 'n/a' };
        if (polar.length) { const p90 = quantile(polar, 0.9); r.polarSummer = { cells: polar.length, p90WarmestC: +p90.toFixed(1), overGlobalK: +(p90 - globalT).toFixed(1), verdict: p90 - globalT <= POLAR_SUMMER_OVER_MEAN_K ? 'PASS' : 'WARN' }; }
        else r.polarSummer = { verdict: 'n/a' };
        out.hemi[h] = r;
    }
    return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const simMesh = buildSimMesh(SIM, MESH_SEED);
    let warns = 0;
    for (const run of arg('--runs', '831576@310').split(',')) {
        const [seed, time] = run.split('@').map(Number);
        const frame = await momentFrame(ROOT, { seed, cont: CONT, sim: SIM, time });
        const pool = await TerrainPool.create(simMesh);
        const fin = await finishPlanet({ frame, simMesh, seed, cells: CELLS, pool, closePool: true, onStage: () => {} });
        const r = polarConsistency(fin, planetClimate({ xyz: fin.mesh.xyz, elevKm: fin.z, axes: 'z-up' }));
        for (const h of ['N', 'S']) for (const k of ['transition', 'margin', 'polarSummer']) if (r.hemi[h][k].verdict === 'WARN') warns++;
        console.log(JSON.stringify({ run, ...r }));
    }
    console.log(`check-climate-polar (report-only): ${warns} WARN`);
}
