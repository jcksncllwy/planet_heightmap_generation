// The GPU erosion against the CPU's, through whole finishes on this machine. The other suites run the CPU path (no GPU, no dependency:
// see "WebGPU" in v2/README.md); this is what ties it to what a browser runs. Dawn stands in for Chrome: gpu-browser.mjs compares the two.
// Needs `npm ci` in v2/tools/gpu-harness; without it the suite says so and reports ⚑ rather than passing silently.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, report, section, finish } from './lib/check-kit.mjs';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEEDS = [831576, 626225, 12345], TIME = 310, SIM = 40000, CELLS = 640000;
let gpu = null;
try { ({ gpu } = await import('./gpu-harness/dawn.mjs')); } catch (e) { console.log(`no Dawn: ${e.code ?? e.message}`); }
if (gpu) Object.defineProperty(globalThis.navigator, 'gpu', { value: gpu, configurable: true });

section(`erosion on the GPU against the CPU: whole finishes at ${CELLS / 1000}K, ${SEEDS.length} seeds at ${TIME} Myr`);
const simMesh = buildSimMesh(SIM, MESH_SEED);
const finishOn = async (frame, seed, on) => {
    const pool = await TerrainPool.create(simMesh);
    // (parity with the GPU-only hillslope terms at 0: ruling 1, fluvial handoff-2 — the CPU path has no new processes)
    const t0 = performance.now(), fin = await finishPlanet({ frame, simMesh, seed, cells: CELLS, pool, closePool: true, F: { ...FINISH, erode: { gpu: on, hillD: 0, diffD: 0 } } });
    return { z: fin.z, ocean: fin.ocean, lake: fin.lake, on: fin.stats.erodeOn, share: 100 * fin.stats.water.lakeShare, erodeS: fin.ms.erosion / 1000, totalS: (performance.now() - t0) / 1000 };
};
const quantiles = (v, q) => { const s = Float64Array.from(v).sort(); return q.map(p => s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
if (!gpu) report('GPU erosion not checked: run npm ci in v2/tools/gpu-harness', NaN, { earth: [0, 0], unit: '' });
else {
    const rows = [];
    for (const seed of SEEDS) {
        const frame = await momentFrame(ROOT, { seed, cont: 30, sim: SIM, time: TIME });
        const C = await finishOn(frame, seed, false), G = await finishOn(frame, seed, true);
        // (land only: the sea's floor is not eroded, and its cells, most of the planet, would hold every low quantile at 0)
        const dz = [];
        let bad = 0, moved = 0, lakeDiffer = 0;
        for (let c = 0; c < C.z.length; c++) {
            if (!(G.z[c] === G.z[c])) bad++;
            if (C.lake[c] !== G.lake[c]) lakeDiffer++;
            if (C.ocean[c] && G.ocean[c]) continue;
            const d = Math.abs(C.z[c] - G.z[c]);
            dz.push(d); if (d > 0) moved++;
        }
        const [p50, p99, p9999, max] = quantiles(dz, [0.5, 0.99, 0.9999, 1]);
        rows.push({ seed, cpu: C.share, gpu: G.share, p50, p99, p9999, max, cpuS: C.erodeS, gpuS: G.erodeS, moved: 100 * moved / dz.length, lakeDiffer });
        check(`seed ${seed}: the finish's erosion ran on the GPU`, G.on !== 'cpu' && C.on === 'cpu', `${G.on}, against ${C.on}`);
        check(`seed ${seed}: no NaN in the GPU's heights`, bad === 0, `${bad} cells`);
        console.log(`    seed ${seed}: lake share ${C.share.toFixed(4)} → ${G.share.toFixed(4)} %, ${lakeDiffer} cells' lake differ; land |dz| m, ${(100 * moved / dz.length).toFixed(1)} % of cells moved: p50 ${(1000 * p50).toFixed(4)}, p99 ${(1000 * p99).toFixed(2)}, p99.99 ${(1000 * p9999).toFixed(0)}, max ${(1000 * max).toFixed(0)}; erosion ${C.erodeS.toFixed(1)} → ${G.erodeS.toFixed(1)} s`);
        if (seed === SEEDS[0]) {
            const R = await finishOn(frame, seed, true);
            let differ = 0;
            for (let c = 0; c < G.z.length; c++) if (R.z[c] !== G.z[c]) differ++;
            check('one machine repeats itself: a second GPU finish, bit for bit', differ === 0, `${differ} cells differ`);
        }
    }
    const each = k => rows.map(r => r[k]);
    // (guards against a broken path, not targets: they sit well outside the gaps measured at 640K and 2.5M, gpu-wire's report)
    check('lake share within half a point of the CPU\'s, every seed', rows.every(r => Math.abs(r.gpu - r.cpu) < 0.5), rows.map(r => (r.gpu - r.cpu).toFixed(2)).join(' · '));
    check('|dz| p99 under 50 m, every seed', rows.every(r => r.p99 < 0.05), rows.map(r => (1000 * r.p99).toFixed(1)).join(' · '));
    report('lake share, GPU minus CPU (points)', rows.map(r => r.gpu - r.cpu), { digits: 3, source: 'the CPU\'s own spread under tie-breaks is ±0.07–0.13, gpu-report.md' });
    report('land cells moved at all by the path, %', each('moved'), { digits: 1 });
    report('land |dz| p50, m', each('p50').map(v => 1000 * v), { digits: 4 });
    report('land |dz| p99, m', each('p99').map(v => 1000 * v), { digits: 2 });
    report('land |dz| p99.99, m', each('p9999').map(v => 1000 * v), { digits: 0 });
    report('land |dz| max, m', each('max').map(v => 1000 * v), { digits: 0 });
    report('erosion stage on the CPU, s (load-dependent)', each('cpuS'), { digits: 1 });
    report('erosion stage on the GPU, s (load-dependent)', each('gpuS'), { digits: 1 });
}
finish('GPU erosion');
process.exit();
