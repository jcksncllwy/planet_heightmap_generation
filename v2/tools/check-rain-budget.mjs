#!/usr/bin/env node
// The rain is moved below the rain grid, not made (lane rainland; sessrumnir's ruling 2026-11-24). The column-water budget
// (climate/rain.js) solves on the rain grid — 3° under the finish's 1° climate, 4° under the history's 2° — and conserves
// water there (rain = evaporation + convergence, each point in the year). The orographic pass then shapes the rain on the
// climate grid's children of each rain cell: windward wetter, the lee drier, islands wetter than the sea. It must keep the
// cell's budget: the children's area-weighted mean equals the cell's rain, every cell, every point in the year. Before the
// fix the pass normalised over 600 km boxes cell by cell, which made water (831576@100: a 4° cell's children ×1.56 its budget).
//
// On Earth's own surface (tuning/climate's Earth mesh), on the GPU (Dawn), at the history's 2° and the finish's 1°.
// Tolerance: 1e-5 of the cell's rain + 1e-3 mm/month (the result is float32; the sums float64).
//
//   node v2/tools/check-rain-budget.mjs
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { loadEarthGrayscale } from '../../tuning/climate/lib/earth-context.mjs';
import { buildEarthMesh } from '../../tuning/climate/lib/earth-mesh.mjs';
import { elevToHeightKm } from '../../js/color-map.js';
import { openDevice } from '../js/gpu/gpu-device.js';
import { climateSolverKit } from '../js/gpu/climate-solver.js';
import { planetClimateAsync } from '../js/climate/climate.js';
import { check, report, section, finish } from './lib/check-kit.mjs';

setDelaunator(Delaunator);
const { gpu } = await import('./gpu-harness/dawn.mjs');          // (a GPU is required: no Dawn, no run)
const { device } = await openDevice(gpu);
const kit = await climateSolverKit(device);
const SEC = 30.44 * 86400, REL = 1e-5, ABS = 1e-3;
const { gray, width, height } = loadEarthGrayscale();
const e = buildEarthMesh(gray, width, height, { N: 40000 }), n = e.mesh.numRegions;
const elevKm = new Float32Array(n), land = new Uint8Array(n);
for (let r = 0; r < n; r++) { elevKm[r] = elevToHeightKm(e.r_elevation[r]); land[r] = elevKm[r] > 0 ? 1 : 0; }

section('the orographic pass keeps each rain cell\'s budget');
globalThis.RAIN_DEBUG = true;
for (const deg of [2, 1]) {
    const res = await planetClimateAsync({ xyz: e.r_xyz, elevKm, axes: 'y-up', land }, { gridStepDeg: deg, cells: false, solver: kit });
    kit.release();
    const core = res.grid, { g, results, Porog, ratio } = res.stages.rain.debug, K = results.length, G = core.size;
    let worst = 0, worstAt = '', cells = 0, peak = 0;
    for (let k = 0; k < K; k++) {
        const sum = new Float64Array(g.size), area = new Float64Array(g.size), top = new Float64Array(g.size);
        for (let j = 0; j < core.h; j++) {
            const a = Math.cos(core.lat[j] * Math.PI / 180);
            for (let i = 0; i < core.w; i++) {
                const pc = Math.floor(j / ratio) * g.w + Math.floor(i / ratio), v = Porog[k * G + j * core.w + i];
                sum[pc] += a * v; area[pc] += a; if (v > top[pc]) top[pc] = v;
            }
        }
        for (let pc = 0; pc < g.size; pc++) {
            const budget = Math.max(0, results[k].P[pc]) * SEC, mean = sum[pc] / area[pc], err = Math.abs(mean - budget) / (REL * budget + ABS);
            cells++;
            if (err > worst) { worst = err; worstAt = `anchor ${k}, cell ${pc}: children ${mean.toFixed(3)} vs budget ${budget.toFixed(3)} mm/month`; }
            if (budget > 10) peak = Math.max(peak, top[pc] / budget);
        }
    }
    check(`${deg}° (rain grid ${g.step}°): every rain cell's children average to its budget, every point in the year`, worst <= 1,
        `${cells} cell-anchors; worst ${worst.toFixed(3)} of the tolerance${worstAt ? ` (${worstAt})` : ''}`);
    report(`${deg}°: the wettest child against its rain cell's budget (largest, cells over 10 mm/month)`, peak, { digits: 2, detail: 'windward concentration; not judged' });
}
kit.release?.();
finish('rain budget');
process.exit(process.exitCode ?? 0);
