// The whole finish with GPU erosion, for an acceptance run and with no edit to the app: `node --import` this before any tool that
// calls finishPlanet (erode-study.mjs), and erodeLandscape's body is replaced by erode-gpu.js, with the calls made awaitable.
// Not the wiring a lane would ship (that is a flag in finish.js), only a way to measure the outcome of it.
import { registerHooks } from 'node:module';
import { isMainThread } from 'node:worker_threads';
import { gpu } from './dawn.mjs';
import { openDevice } from '../../js/gpu/gpu-device.js';
import { erodeGPU } from '../../js/gpu/erode-gpu.js';
import { cpuRoute } from './cpu-route.mjs';

// (--import reaches worker threads too; they don't run erosion, and each would open its own device)
// (--import reaches worker threads too; they don't run erosion, and each would open its own device)
const opened = isMainThread ? await openDevice(gpu) : null;
if (opened) console.log('GPUSWAP', JSON.stringify(opened.info.description));
// GPU_LEVELS: a bitmask of which erosion runs of the finish go to the GPU, in call order (default all). ROTATE: each cell's neighbours
// rotated by a hash of this seed, for that run's erosion on either path: replicates that differ only in arbitrary choices.
const LEVELS = Number(process.env.GPU_LEVELS ?? 255), ROTATE = Number(process.env.ROTATE ?? 0);
const rotations = new Map(), rotated = mesh => {
    if (!ROTATE) return mesh;
    if (rotations.has(mesh)) return rotations.get(mesh);
    const { adjOffset, adjList, numCells: n } = mesh, rot = adjList.slice();
    for (let c = 0; c < n; c++) { const lo = adjOffset[c], d = adjOffset[c + 1] - lo, s = Math.imul(c + 1, 2654435761 + 2 * ROTATE) >>> 13; for (let j = 0; j < d; j++) rot[lo + j] = adjList[lo + (j + s) % d]; }
    const out = Object.assign(Object.create(Object.getPrototypeOf(mesh)), mesh, { adjList: rot });
    rotations.set(mesh, out);
    return out;
};
let call = 0;
const onGPU = async (o, P) => {
    const R = await erodeGPU(gpu, o, P, { device: opened, routeOverride: process.env.GPU_ROUTE ? ({ z, sink, base, basins, gpuRecv }) => {
        const O = cpuRoute(o.mesh, o.ocean, z, sink, base, basins), M = process.env.GPU_ROUTE;
        if (M === 'cpu') return O;
        // (the CPU's fill throughout; the GPU's receivers kept on one class of flat cell)
        for (let c = 0; c < O.recv.length; c++) { const lake = O.fill[c] > z[c] + 1e-5; if (M === 'gpuLake' ? lake : !lake) O.recv[c] = gpuRecv[c] === 0x7FFFFFFF ? O.recv[c] : gpuRecv[c] & 0x7FFFFFFF; }
        return O;
    } : null });
    const perYr = v => +(v / Math.max(1e-9, P.timeMyr) * 1e-6).toFixed(2);
    return { curve: [], survivors: null, ms: R.ms, budget: { seaKm3PerYr: perYr(R.toSeaKm3), closedKm3PerYr: perYr(R.closedKm3) } };
};
// (returns a promise for the GPU; for the CPU, the fields to run with)
globalThis.__erodeSwap = (o, P) => { const use = (LEVELS >> call++) & 1, q = { ...o, mesh: rotated(o.mesh) }; return use ? onGPU(q, P) : q; };
const EDITS = [
    ['finish/finish-erode.js', 'export function erodeLandscape(o, P) {', 'export function erodeLandscape(o, P) { if (globalThis.__erodeSwap) { const g = globalThis.__erodeSwap(o, P); if (g.then) return g; o = g; }'],
    ['finish/finish-erode.js', 'export function erodeLadder(o, P, meshOf) {', 'export async function erodeLadder(o, P, meshOf) {'],
    ['finish/finish-erode.js', 'const r = erodeLandscape({ ...o,', 'const r = await erodeLandscape({ ...o,'],
    ['finish/finish.js', 'stats.erode = EP.ladder ? erodeLadder(', 'stats.erode = EP.ladder ? await erodeLadder('],
    ['finish/finish.js', ': erodeLandscape({ ...erodeIn, mesh, z: C.z, ocean: ocean0,', ': await erodeLandscape({ ...erodeIn, mesh, z: C.z, ocean: ocean0,'],
    ['finish/finish.js', 'const late = erodeLandscape(', 'const late = await erodeLandscape('],
];
registerHooks({
    load(url, context, next) {
        const out = next(url, context), edits = EDITS.filter(([file]) => url.endsWith(file));
        if (!edits.length) return out;
        let source = String(out.source);
        for (const [, find, put] of edits) {
            if (!source.includes(find)) throw new Error(`swap-hook: "${find}" not found in ${url}`);
            source = source.replace(find, () => put);
        }
        return { ...out, source };
    },
});
