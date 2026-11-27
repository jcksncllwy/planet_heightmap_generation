// Which engine a civ tool lives the famine's years on (lane civgpu2): the GPU by default, as the page does — Dawn in Node
// (gpu-harness/dawn.mjs, the same `gpu` object the history's and the finish's erosion share) — or the CPU's float64
// reference with --cpu (or GEO_SIM_CIV_CPU=1). --check: on the GPU, each step's years on the CPU too (sim.js yearsCheck).

import { civGPU, civEngineOf } from '../../js/civ/civ-gpu.js';

/** { engine: 'gpu' | 'cpu', gpu: the civ GPU context or null, yearsCheck, label } — spread opts into runCivSim's. */
export async function civEngine(argv = process.argv) {
    const engine = civEngineOf(argv), yearsCheck = argv.includes('--check');
    if (engine === 'cpu') return { engine, gpu: null, yearsCheck: false, label: 'cpu' };
    let dawn;
    try { dawn = (await import('../gpu-harness/dawn.mjs')).gpu; }
    catch (e) { throw new Error(`the civ run's years need a GPU: no Dawn here (${e.code ?? e.message}); link v2/tools/gpu-harness/node_modules (agent-brief) or pass --cpu for the CPU reference`); }
    const gpu = await civGPU(globalThis.navigator?.gpu ?? globalThis.geoSimHistoryGPU ?? dawn);
    return { engine, gpu, yearsCheck, label: `gpu ${gpu.info?.vendor ?? ''} ${gpu.info?.architecture ?? ''}`.trim() };
}

/** A yearsCheck summary, one line: the per-cell differences' quantiles, the famines on one side only, the dead. */
export function yearsCheckLine(S) {
    if (!S) return '';
    const q = (h, p) => { const tot = h.reduce((a, b) => a + b, 0); let acc = 0; for (let i = 0; i < h.length; i++) { acc += h[i]; if (acc >= p * tot) return S.bins[i]; } return S.bins[h.length - 1]; };
    const qs = h => [0.5, 0.9, 0.99, 0.999].map(p => q(h, p).toExponential(0)).join('/');
    return `years CPU vs GPU over ${S.steps} steps, ${S.cells} cell-steps: store |Δ| p50/p90/p99/p99.9 ≤ ${qs(S.hist.store)} (max ${S.maxStore.toExponential(2)}); `
        + `people |Δ|/d ≤ ${qs(S.hist.people)} (max ${S.maxPeople.toExponential(2)}); famine on both ${S.famineBoth}, CPU only ${S.famineOnlyCPU}, GPU only ${S.famineOnlyGPU}; `
        + `dead CPU ${Math.round(S.deadCPU)} GPU ${Math.round(S.deadGPU)} (${(100 * (S.deadGPU - S.deadCPU) / Math.max(1, S.deadCPU)).toFixed(3)} %); worst step ${JSON.stringify(S.worstStep)}`;
}
