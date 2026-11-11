// Liquid water on land that never thaws (lane polar, 2026-11-05): for each seed@moment, the finish run at --cells, and
// where its runoff, lakes and rivers stand on ground whose warmest month is below freezing at its own height (the
// climate's monthly temperature at sea level, less the lapse rate over the cell's height: finish.js warmSl). One JSON line
// per run: the frozen land's area, its runoff (km³/yr) against all land's, its lakes (area, volume, bodies, by kind) and
// its rivers (cells over 10 and 100 m³/s); and the high latitudes' (> 70°) fresh lakes near sea level — the "drowned
// fringe" of crust-report item 4 — split frozen against thawed ground.
//   node v2/tools/polar-study.mjs --runs 831576@430,831576@340 [--cont 30] [--sim 40000] [--cells 640000] [--set k=v,…]
// Run it through sim-slots (sim-slots run -n 4 --gb 8 --who polar -- node …).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';
import { CORE_DEFAULTS } from '../js/climate/core.js';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CONT = Number(arg('--cont', DEFAULT_CONT)), SIM = Number(arg('--sim', 40000)), CELLS = Number(arg('--cells', 640000));
const F = { ...FINISH };
for (const kv of (arg('--set', '') || '').split(/,(?=[A-Za-z])/).filter(Boolean)) { const [k, v] = kv.split('='); F[k] = Number.isFinite(Number(v)) ? Number(v) : JSON.parse(v); }
const simMesh = buildSimMesh(SIM, MESH_SEED), gamma = CORE_DEFAULTS.lapseRateCPerKm;
const r1 = x => Math.round(10 * x) / 10;
for (const run of arg('--runs', '831576@430').split(',')) {
    const [seed, time] = run.split('@').map(Number), t0 = performance.now();
    const frame = await momentFrame(ROOT, { seed, cont: CONT, sim: SIM, time });
    const pool = await TerrainPool.create(simMesh);
    const fin = await finishPlanet({ frame, simMesh, seed, cells: CELLS, pool, closePool: true, debug: true, F, onStage: () => {} });
    const { mesh, z, ocean, lake, lakeLevel, glaciated } = fin, L = fin.layers, n = mesh.numCells, { adjOffset, adjList } = mesh;
    const km2 = 4 * Math.PI * 6371 ** 2 / n;
    const frozen = c => L.warmSl[c] - gamma * Math.max(0, z[c], lake[c] && lakeLevel[c] === lakeLevel[c] ? lakeLevel[c] : 0) <= 0;
    const A = { land: 0, frozen: 0, frozenIce: 0, runoffAll: 0, runoffFrozen: 0, lakeAll: 0, lakeFrozen: 0, volFrozenKm3: 0, q10: 0, q100: 0, q10all: 0 };
    const fringe = { warm: [0, 0, 0, 0], depthM: 0, km2: 0, liq: 0, src: {} }, kinds = {}, hi = { frozenKm2: 0, thawedKm2: 0, frozenNearSea: 0, thawedNearSea: 0 };
    for (let c = 0; c < n; c++) {
        if (ocean[c] && !lake[c]) continue;
        const fz = frozen(c);
        A.land += km2;
        if (fz) { A.frozen += km2; if (glaciated?.[c]) A.frozenIce += km2; }
        const R = (L.runoff[c] || 0) * km2 * 1e-6;
        A.runoffAll += R; if (fz) A.runoffFrozen += R;
        const q = L.q?.[c] || 0;
        if (q > 10) { A.q10all++; if (fz) { A.q10++; if (q > 100) A.q100++; } }
        if (!lake[c] || lake[c] === 3) continue;
        A.lakeAll += km2;
        if (fz) {
            A.lakeFrozen += km2;
            const k = ['none', 'fresh', 'salt', 'pan'][lake[c]] + '/' + (L.lakeSrc?.[c] ?? '?');
            kinds[k] = (kinds[k] || 0) + km2;
            if (lakeLevel[c] === lakeLevel[c]) A.volFrozenKm3 += Math.max(0, lakeLevel[c] - z[c]) * km2;
        }
        if (Math.abs(L.lat[c]) > 70 && lake[c] === 1) {
            const near = lakeLevel[c] < 0.15;
            if (fz) { hi.frozenKm2 += km2; if (near) hi.frozenNearSea += km2; } else { hi.thawedKm2 += km2; if (near) hi.thawedNearSea += km2; }
            if (near && !fz) {      // (the fringe's ground: its warmest month at the water's height, its water's depth, its liquid share)
                const w = L.warmSl[c] - gamma * Math.max(0, lakeLevel[c]), b = w < 2 ? 0 : w < 5 ? 1 : w < 10 ? 2 : 3;
                fringe.warm[b] += km2; fringe.depthM += 1000 * Math.max(0, lakeLevel[c] - z[c]) * km2; fringe.km2 += km2;
                if (L.liquid) fringe.liq += (L.rain[c] > 0 ? L.liquid[c] / L.rain[c] : 1) * km2;
                if (L.lakeSrc) fringe.src[L.lakeSrc[c]] = (fringe.src[L.lakeSrc[c]] || 0) + km2;
            }
        }
    }
    // frozen-ground lake bodies (connected same-level water), and how many lie wholly on frozen ground
    const seen = new Uint8Array(n);
    let bodies = 0, whole = 0;
    for (let c = 0; c < n; c++) {
        if (seen[c] || !lake[c] || lake[c] === 3 || !frozen(c)) continue;
        bodies++; let all = true; const st = [c]; seen[c] = 1;
        while (st.length) { const x = st.pop(); if (!frozen(x)) all = false; for (let k = adjOffset[x]; k < adjOffset[x + 1]; k++) { const y = adjList[k]; if (!seen[y] && lake[y] === lake[x] && Math.abs(lakeLevel[y] - lakeLevel[x]) < 1e-6) { seen[y] = 1; st.push(y); } } }
        if (all) whole++;
    }
    const pct = (a, b) => b > 0 ? r1(100 * a / b) : null;
    console.log(JSON.stringify({ run, cells: CELLS, s: Math.round((performance.now() - t0) / 1000),
        landMkm2: r1(A.land / 1e6), frozenPct: pct(A.frozen, A.land), frozenIcePct: pct(A.frozenIce, A.frozen),
        runoffKm3: Math.round(A.runoffAll), runoffFrozenKm3: Math.round(A.runoffFrozen), runoffFrozenPct: pct(A.runoffFrozen, A.runoffAll),
        lakeKkm2: r1(A.lakeAll / 1e3), lakeFrozenKkm2: r1(A.lakeFrozen / 1e3), lakeFrozenPct: pct(A.lakeFrozen, A.lakeAll), lakeFrozenVolKm3: Math.round(A.volFrozenKm3),
        frozenBodies: bodies, frozenBodiesWhole: whole, frozenKindsKkm2: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, r1(v / 1e3)])),
        riverCells: { q10all: A.q10all, q10frozen: A.q10, q100frozen: A.q100 },
        hiLat70: Object.fromEntries(Object.entries(hi).map(([k, v]) => [k + 'Kkm2', r1(v / 1e3)])),
        fringe: { km2K: r1(fringe.km2 / 1e3), warmBinsPct_lt2_2to5_5to10_gt10: fringe.warm.map(v => pct(v, fringe.km2)), meanDepthM: fringe.km2 ? Math.round(fringe.depthM / fringe.km2) : null, liquidShare: fringe.km2 && L.liquid ? +(fringe.liq / fringe.km2).toFixed(3) : null, srcKkm2: Object.fromEntries(Object.entries(fringe.src).map(([k, v]) => [k, r1(v / 1e3)])) },
        snowStore: fin.stats.snowStore ?? null,
        runoffShare: fin.stats.runoffShare, runoffShareWithIce: fin.stats.runoffShareWithIce ?? null, lakes: (({ freshLakes, saltLakes, pans, lakeShare, endorheicShare }) => ({ freshLakes, saltLakes, pans, lakeShare, endorheicShare }))(fin.stats.water) }));
}
