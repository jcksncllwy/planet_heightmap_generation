// The whole finish with GPU erosion, for an acceptance run and with no edit to the app: `node --import` this before any tool that
// calls finishPlanet (erode-study.mjs), and erodeLandscape's body is replaced by erode-gpu.js, with the calls made awaitable.
// Not the wiring a lane would ship (that is a flag in finish.js), only a way to measure the outcome of it.
import { registerHooks } from 'node:module';
import { gpu } from './dawn.mjs';
import { openDevice } from '../../js/gpu/gpu-device.js';
import { erodeGPU } from '../../js/gpu/erode-gpu.js';

const opened = await openDevice(gpu);
console.log('GPUSWAP', JSON.stringify(opened.info.description));
globalThis.__gpuErode = async (o, P) => {
    const R = await erodeGPU(gpu, o, P, { device: opened });
    const perYr = v => +(v / Math.max(1e-9, P.timeMyr) * 1e-6).toFixed(2);
    return { curve: [], survivors: null, ms: R.ms, budget: { seaKm3PerYr: perYr(R.toSeaKm3), closedKm3PerYr: perYr(R.closedKm3) } };
};
const EDITS = [
    ['finish/finish-erode.js', 'export function erodeLandscape(o, P) {', 'export function erodeLandscape(o, P) { if (globalThis.__gpuErode) return globalThis.__gpuErode(o, P);'],
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
