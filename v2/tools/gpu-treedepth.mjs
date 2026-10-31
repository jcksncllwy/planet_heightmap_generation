// How deep the CPU's river trees run, per step: how many levels a level-by-level GPU sweep would dispatch, and how the cells spread over them.
import { loadRun } from './gpu-fixture.mjs';
import { erodeLandscape } from '../js/finish/finish-erode.js';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const { o, P } = loadRun(arg('--dir'), Number(arg('--run', 3)));
globalThis.__erodeStep = S => {
    const { count, order, recv, rank } = S, d = new Int32Array(o.mesh.numCells);
    let D = 0, minima = 0; const hist = new Map();
    for (let i = 0; i < count; i++) { const c = order[i], r = recv[c]; const v = rank[r] >= 0 ? d[r] + 1 : 1; d[c] = v; if (v > D) D = v; hist.set(v, (hist.get(v) ?? 0) + 1); }
    const small = [...hist.values()].filter(v => v < 64).length, sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`step ${S.s}: land ${count}, depth ${D}, levels under 64 cells ${small}, biggest level ${sorted[0]}, lakes ${S.lakes}, ms ${JSON.stringify(S.t)}`);
};
const r = erodeLandscape(o, P);
console.log(JSON.stringify(r.ms), JSON.stringify(r.budget));
