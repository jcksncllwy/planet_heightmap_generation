// Per-cycle and per-solve cost of the GPU climate solver (gpu/climate-solver.js) on a 1° and a 3° grid: solves of fixed
// cycle counts (tol 0), so cost = overhead + cycles × per-cycle.   node v2/tools/climate-solver-bench.mjs (under Dawn)
import { gpu } from './gpu-harness/dawn.mjs';
import { openDevice } from '../js/gpu/gpu-device.js';
import { climateSolverKit } from '../js/gpu/climate-solver.js';
import { LatLonGrid } from '../js/climate/grid.js';
const { device } = await openDevice(gpu);
const kit = await climateSolverKit(device);
for (const step of [1, 3]) {
    const g = new LatLonGrid(step), G = g.size, s = kit(g, 0.2, 0.2);
    const sr = new Float64Array(G).fill(2), si = new Float64Array(G).fill(0.5), u = new Float64Array(G), v = new Float64Array(G);
    for (let c = 0; c < G; c++) { u[c] = 10 * Math.sin(c * 0.001); v[c] = 3 * Math.cos(c * 0.0007); }
    let t = performance.now();
    for (let k = 0; k < 10; k++) s.setOperator(sr, si, u, v, 1e7);
    const opMs = (performance.now() - t) / 10;
    const f = new Float64Array(G).map((_, c) => 100 * Math.sin(c)), fi = new Float64Array(G), T = new Float64Array(G), Ti = new Float64Array(G);
    const time = async (cyc, reps = 8) => { await s.solve(f, fi, T, Ti, { maxCycles: cyc, tol: 0 }); const t0 = performance.now(); for (let k = 0; k < reps; k++) await s.solve(f, fi, T, Ti, { maxCycles: cyc, tol: 0 }); return (performance.now() - t0) / reps; };
    // (convergedSettings raises maxCycles to 60: tol 0 always runs to the cap — so time the cap, and one cycle by a hack)
    const t60 = await time(60, 3);
    console.log(`${g.w}x${g.h} (${s.levels.length} levels): setOperator ${opMs.toFixed(2)} ms; a 60-cycle solve ${t60.toFixed(1)} ms → ${(t60 / 60).toFixed(3)} ms a cycle incl. overhead`);
}
kit.release();
// ── each kernel alone: N dispatches in one pass ──
{
    const kit2 = await climateSolverKit(device), g = new LatLonGrid(1), G = g.size, s = kit2(g, 0.2, 0.2);
    s.setOperator(new Float64Array(G).fill(2), new Float64Array(G).fill(0.5), null, null, 0);
    device.queue.writeBuffer(s.flags, 0, new Uint32Array(4));
    const P = s.pipes, B = s.bg.levels, Ls = s.levels, N = 200;
    const bench = async (label, pipe, group, count) => {
        const go = async () => { const enc = device.createCommandEncoder(), pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, group); for (let k = 0; k < N; k++) pass.dispatchWorkgroups(count); pass.end(); device.queue.submit([enc.finish()]); await device.queue.onSubmittedWorkDone(); };
        await go(); const t0 = performance.now(); await go(); console.log(`  ${label.padEnd(26)} ${((performance.now() - t0) * 1000 / N).toFixed(1)} µs a dispatch (${count} workgroups)`);
    };
    for (let l = 0; l < Ls.length - 1; l++) {
        await bench(`smooth L${l} ${Ls[l].w}x${Ls[l].h}`, P.smooth, B[l].smooth[0], Math.floor((Ls[l].h + 1) / 2));
        await bench(`resid L${l}`, P.resid, B[l].resid, Math.ceil(Ls[l].n / 256));
        await bench(`restrict L${l}`, P.restrict, B[l].restrict, Math.ceil(Ls[l + 1].n / 256));
        await bench(`prolong L${l}`, P.prolong, B[l].prolong, Math.ceil(Ls[l].n / 256));
    }
    await bench(`coarsest ${Ls.at(-1).w}x${Ls.at(-1).h}`, P.coarsest, B.at(-1).coarsest, 1);
    await bench('resid0', P.resid0, s.bg.resid0, Ls[0].h);
    await bench('norm', P.norm, s.bg.norm, 1);
    await bench('update', P.update, s.bg.update, Math.ceil(Ls[0].n / 256));
    kit2.release();
}
process.exit(0);
