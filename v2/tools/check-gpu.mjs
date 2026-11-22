// The GPU's finish on this machine: deterministic tests, no comparison of chaotic results (lane histprof, 2026-11-21).
//   · each GPU kernel against a float64 CPU reference of its own arithmetic, with stated tolerances (fluvial-kernels-test.mjs:
//     the affine solve, the drainage sum, the diffusion; flexure-test.mjs: the plate against its analytic solutions, the GPU's solve and rebound
//     against float64; climate-cells-test.mjs: the climate per cell — step 5, Köppen, the stats' bytes, the thaw gate and the
//     runoff; climate-solver-test.mjs: the climate's Helmholtz solves (gpu/climate-solver.js), the whole climate against
//     its float64 reference; coast-rays-test.mjs: the coast's waves, far and near, and the world ocean's flood by connected labels, equal to
//     the CPU's to the cell), each run twice and repeating itself bit for bit; and the GPU's waits failing loudly (gpu-wait-test.mjs);
//   · the whole GPU finish end to end: it ran on the GPU, no NaN, and a second finish on this machine bit for bit.
// What it no longer does: compare a GPU finish with a CPU finish cell by cell. The two take different paths through float32
// and the paths' tie-breaks compound over the finish's window, so their |dz| measures chaos, not error: a 1e-7 km nudge to
// the rebound alone gives a p99 of 278 m (gpuerode M3), against the old bound of 50 m.
// The other suites run the history on Dawn and the finish on the CPU unless GEO_SIM_DAWN=1; this ties the finish to what a
// browser runs. Dawn stands in for Chrome: gpu-browser.mjs compares the two.
// Needs `npm ci` in v2/tools/gpu-harness; without it the suite says so and reports ⚑ rather than passing silently.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check, report, section, finish } from './lib/check-kit.mjs';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), TOOLS = path.join(ROOT, 'v2', 'tools');
const SEEDS = [831576, 626225, 12345], TIME = 310, SIM = 40000, CELLS = 640000;
let gpu = null;
try { ({ gpu } = await import('./gpu-harness/dawn.mjs')); } catch (e) { console.log(`no Dawn: ${e.code ?? e.message}`); }
if (gpu) Object.defineProperty(globalThis.navigator, 'gpu', { value: gpu, configurable: true });

if (!gpu) report('GPU not checked: run npm ci in v2/tools/gpu-harness', NaN, { earth: [0, 0], unit: '' });
else {
    section('each GPU kernel against its float64 CPU reference (tolerances in each test\'s header), twice, bit for bit');
    // (each in a process of its own, as run by hand: its own device, its own exit code; every ok/FAIL line it prints is shown)
    for (const [file, args, what] of [
        ['fluvial-kernels-test.mjs', [], 'the fluvial kernels (affine solve, drainage, diffusion)'],
        ['flexure-test.mjs', ['--cells', '160000', '--analytic', '640000', '--reps', '2'], 'the plate (analytic loads, the GPU solve, the rebound)'],
        ['climate-cells-test.mjs', ['--cells', '160000', '--reps', '2'], 'the climate per cell (step 5, Köppen, the stats, the thaw gate and the runoff)'],
        ['coast-rays-test.mjs', ['--cells', '160000', '--reps', '2'], 'the coast\'s waves (far and near field) and the world ocean\'s flood (labels: equal to the CPU\'s)'],
        ['climate-solver-test.mjs', ['--world', 'test', '--reps', '2'], 'the climate\'s solves (the whole climate, float32 against float64 converged: months, sea ice, ice sheets, Köppen)'],
        ['gpu-wait-test.mjs', [], 'the GPU\'s waits fail loudly (a hang, a lost device)'],
    ]) {
        const r = spawnSync(process.execPath, [path.join(TOOLS, file), ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
        const lines = `${r.stdout}${r.stderr}`.split('\n').filter(l => /^(ok  |FAIL)/.test(l));
        for (const l of lines) console.log('    ' + l);
        check(`${what}: ${file}`, r.status === 0 && lines.length > 0, r.status === 0 ? `${lines.length} cases` : `exit ${r.status}${r.error ? ` (${r.error.message})` : ''}, ${lines.filter(l => l.startsWith('FAIL')).length} failed`);
    }

    section(`the GPU finish end to end on this machine: ${CELLS / 1000}K, ${SEEDS.length} seeds at ${TIME} Myr`);
    const simMesh = buildSimMesh(SIM, MESH_SEED);
    const finishOn = async (frame, seed, on) => {
        const pool = await TerrainPool.create(simMesh);
        // (the finish as the page runs it, erosion settings and all)
        const t0 = performance.now(), fin = await finishPlanet({ frame, simMesh, seed, cells: CELLS, pool, closePool: true, F: { ...FINISH, erode: { ...FINISH.erode, gpu: on } } });
        return { z: fin.z, ocean: fin.ocean, lake: fin.lake, on: fin.stats.erodeOn, share: 100 * fin.stats.water.lakeShare, erodeS: fin.ms.erosion / 1000, totalS: (performance.now() - t0) / 1000 };
    };
    const rows = [];
    for (const seed of SEEDS) {
        const frame = await momentFrame(ROOT, { seed, cont: DEFAULT_CONT, sim: SIM, time: TIME });
        const G = await finishOn(frame, seed, true);
        let bad = 0;
        for (let c = 0; c < G.z.length; c++) if (!(G.z[c] === G.z[c])) bad++;
        rows.push(G);
        check(`seed ${seed}: the finish's erosion ran on the GPU`, G.on !== 'cpu', G.on);
        check(`seed ${seed}: no NaN in the GPU's heights`, bad === 0, `${bad} cells`);
        if (seed === SEEDS[0]) {
            const R = await finishOn(frame, seed, true);
            let differ = 0, lakes = 0;
            for (let c = 0; c < G.z.length; c++) { if (R.z[c] !== G.z[c]) differ++; if (R.lake[c] !== G.lake[c]) lakes++; }
            check('one machine repeats itself: a second GPU finish, bit for bit', differ === 0 && lakes === 0, `${differ} cells' height, ${lakes} cells' lake differ`);
        }
    }
    report('lake share, %', rows.map(r => r.share), { digits: 3 });
    report('erosion stage on the GPU, s (load-dependent)', rows.map(r => r.erodeS), { digits: 1 });
}
finish('GPU erosion');
process.exit();
