// CPU against GPU erosion on a captured fixture, on this machine. Runs finish-erode.js as it stands (seen through probe-hook) and
// erode-gpu.js from the same start, then compares each step's fill, receivers, drainage and heights.
//   node --import ./v2/tools/gpu-harness/probe-hook.mjs v2/tools/gpu-erode.mjs --dir FIXTURE --run 3 [--steps N] [--repeat] [--no-cpu]
import { gpu } from './gpu-harness/dawn.mjs';
import { erodeGPU } from '../js/gpu/erode-gpu.js';
import { openDevice } from '../js/gpu/gpu-device.js';
import { erodeLandscape } from '../js/finish/finish-erode.js';
import { loadRun } from './gpu-fixture.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }, has = k => process.argv.includes(k);
const DIR = arg('--dir'), RUN = Number(arg('--run', 3)), { o, P, meta } = loadRun(DIR, RUN), n = o.mesh.numCells;
if (arg('--steps')) { const s = Number(arg('--steps')); P.timeMyr *= s / P.steps; P.steps = s; }
const quant2 = (a, q) => { const v = Float64Array.from(a).sort(); return q.map(p => v[Math.min(v.length - 1, Math.floor(p * v.length))]); };
const start = o.z.slice(), cpu = [];
if (!has('--no-cpu')) {
    globalThis.__erodeStep = has("--light") ? null : S => { cpu.push({ fill: S.fill.slice(), recv: S.recv.slice(), A: S.A.slice(), z: S.z.slice(), zNew: S.zNew.slice(), rank: S.rank.slice(), lid: S.lid.slice(), order: S.order.subarray(0, S.count).slice(), count: S.count, dropped: S.dropped.slice(), trap: S.trap.slice(), inlet: S.inlet?.slice(), e: S.e_.slice() }); };
    const t0 = performance.now(), r = erodeLandscape(o, P);
    globalThis.__erodeStep = null;
    console.log('CPU', ((performance.now() - t0) / 1000).toFixed(2), 's', JSON.stringify(r.ms), JSON.stringify(r.budget));
    var cpuEnd = o.z.slice();
    o.z.set(start);
}
// (the noise floor: the same CPU code with each cell's neighbours listed in reverse. Only arbitrary choices can change: which of
// equal flood parents a flat takes, and the order lakes fill. Whatever differs here is not physics, so it bounds what a GPU tie-break may)
if (has('--floor')) {
    const { adjOffset, adjList } = o.mesh, flip = new (adjList.constructor)(adjList.length);
    for (let c = 0; c < n; c++) { const lo = adjOffset[c], hi = adjOffset[c + 1]; for (let j = lo; j < hi; j++) flip[j] = adjList[hi - 1 - (j - lo)]; }
    const r0 = o.mesh.adjList; o.mesh.adjList = flip;
    erodeLandscape(o, P);
    const d = []; for (let c = 0; c < n; c++) if (!o.ocean[c]) d.push(Math.abs(o.z[c] - cpuEnd[c]));
    console.log('FLOOR CPU vs CPU reversed |dz| km p50,p99,p99.99,max', quant2(d, [.5, .99, .9999, 1]).map(v => v.toExponential(2)).join(' '));
    o.mesh.adjList = r0; o.z.set(start);
}
const quant = (a, q) => { const v = Float64Array.from(a).sort(); return q.map(p => v[Math.min(v.length - 1, Math.floor(p * v.length))]); };
const { device } = await openDevice(gpu), steps = [];
const onStep = async ({ s, route, read, z }) => {
    const row = { s, ...route };
    if (cpu[s]) {
        const C = cpu[s], fill = await read('fill'), recv = await read('recv', Uint32Array), cells = await read('cells'), { order, count, rank } = C;
        const lakeC = c => C.fill[c] > 0 && C.lid[c] >= 0, df = [], dA = [], dz = [];
        let recvSame = 0, recvLand = 0, recvDiff = 0, nanz = 0, strictMiss = 0;
        for (let i = 0; i < count; i++) {
            const c = order[i], lake = C.lid[c] >= 0;
            df.push(Math.abs(fill[c] - C.fill[c]));
            if (!lake) { recvLand++; if ((recv[c] & 0x7FFFFFFF) === C.recv[c]) recvSame++; else { recvDiff++; const { adjOffset, adjList } = o.mesh; for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (rank[y] >= 0 && C.fill[y] < C.fill[c]) { strictMiss++; break; } } } dA.push(Math.abs(cells[8 * c] - C.A[c]) / Math.max(C.A[c], 1)); }
            if (!(z[c] === z[c])) nanz++;
            dz.push(Math.abs(z[c] - C.z[c]));
        }
        row.fill = quant(df, [.5, .99, .9999, 1]).map(v => +v.toExponential(2));
        row.recvLandSame = +(100 * recvSame / recvLand).toFixed(4); row.recvDiff = recvDiff; row.recvDiffWithDescent = strictMiss;
        row.A = quant(dA, [.5, .99, .9999, 1]).map(v => +v.toExponential(2));
        row.dz = quant(dz, [.5, .99, .9999, 1]).map(v => +v.toExponential(2));
        row.nan = nanz;
        if (has('--diag')) {
            const drop = await read('dropped'), trap = await read('trap'), cf = cells, D = { zNew: [], drop: [], e: [], inlet: [] };
            let tc = 0, tg = 0, big = [];
            const lidCpuTrap = new Map();
            for (let i = 0; i < count; i++) { const c = order[i]; D.zNew.push(Math.abs(cf[8 * c + 3] - C.zNew[c])); D.drop.push(Math.abs(drop[c] - C.dropped[c])); if (C.lid[c] >= 0) { D.e.push(Math.abs(cf[8 * c + 1] - C.e[c])); if (C.inlet) D.inlet.push(Math.abs(cf[8 * c + 7] - C.inlet[c])); } tg += trap[c]; }
            for (const v of C.trap) tc += v;
            row.diag = { zNew: quant(D.zNew, [.99, 1]), drop: quant(D.drop, [.99, 1]), e: quant(D.e, [.99, .9999, 1]), inlet: quant(D.inlet, [.99, 1]), trapCpu: tc, trapGpu: tg, lakesCpu: C.trap.length };
        }
    }
    steps.push(row);
    console.log(JSON.stringify(row));
};
const t0 = performance.now(), r = await erodeGPU(gpu, o, P, { onStep: cpu.length || has('--detail') ? onStep : null, device: { device } }), sec = (performance.now() - t0) / 1000;
console.log('GPU', sec.toFixed(2), 's', JSON.stringify(r.ms), 'sea', (r.toSeaKm3 / Math.max(1e-9, P.timeMyr) * 1e-6).toFixed(2), 'closed', (r.closedKm3 / Math.max(1e-9, P.timeMyr) * 1e-6).toFixed(2));
if (!cpu.length) console.log(JSON.stringify(r.route.slice(0, 3)));
const land = []; if (cpu.length) { for (let c = 0; c < n; c++) if (!o.ocean[c]) land.push(Math.abs(o.z[c] - cpuEnd[c])); console.log('END |dz| km p50,p99,p99.99,max', quant(land, [.5, .99, .9999, 1]).map(v => v.toExponential(2)).join(' ')); }
if (has('--repeat')) {
    const first = o.z.slice();
    o.z.set(start);
    await erodeGPU(gpu, o, P, { device: { device } });
    let diff = 0; for (let c = 0; c < n; c++) if (first[c] !== o.z[c]) diff++;
    console.log('REPEAT cells differing bit-for-bit:', diff);
}
process.exit(0);
