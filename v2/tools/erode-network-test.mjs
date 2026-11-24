// The GPU erosion's network on a mesh built to break it (lane deepnet, 2026-11-24): erode-gpu.js's depth order against a CPU walk
// of the same receivers, cell for cell, on a patch past WebGPU's dispatch cap and with a river deeper than the first jumps reach.
//   · the cap: a dispatch holds at most 65,535 workgroups a dimension, 8,388,480 cells at 128 a group. Every pass ran 1-D, so
//     outlets()'s passes over the whole mesh failed validation above that — dropped, the network kept the last one's outlets and
//     depths, and a 10M Add detail threw "erosion network: 5770 levels" (Jackson's 243751@430) or ran on stale outlets without a
//     sign. Here n = 9.0M: the outlets must be the sea's, exactly.
//   · the depth: list ranking by pointer jumping, 12 jumps (4096 hops) first, then as many as the list needs. A maze of channels
//     drains one serpentine river ~15,000 cells long: the GPU's level of every cell must be its hop count to the sea, exactly
//     (a cell at the same level as its receiver would be swept with it, its water missing).
//   node v2/tools/erode-network-test.mjs [--size 3000] [--channels 5]
import { gpu } from './gpu-harness/dawn.mjs';
import { erodeGPU } from '../js/gpu/erode-gpu.js';
import { openDevice } from '../js/gpu/gpu-device.js';
import { historyErodeSettings } from '../js/tectonics/step/erode-settings.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--size', 3000)), CH = Number(arg('--channels', 5)), n = N * N, NONE = 0x7FFFFFFF;
let fails = 0;
const ok = (what, pass, detail = '') => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!pass) fails++; };

// (the patch: an N×N grid, 8 neighbours, on a cube face's gnomonic patch (as history-key.js's fingerprint); its rim is the sea)
const xyz = new Float32Array(3 * n), adjOffset = new Uint32Array(n + 1);
let deg = 0;
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = j * N + i, x = 2 * (i + 0.5) / N - 1, y = 2 * (j + 0.5) / N - 1, r = Math.sqrt(1 + x * x + y * y);
    xyz[3 * c] = x / r; xyz[3 * c + 1] = y / r; xyz[3 * c + 2] = 1 / r;
    adjOffset[c] = deg; deg += (Math.min(i + 1, N - 1) - Math.max(i - 1, 0) + 1) * (Math.min(j + 1, N - 1) - Math.max(j - 1, 0) + 1) - 1;
}
adjOffset[n] = deg;
const adjList = new Uint32Array(deg);
for (let j = 0, at = 0; j < N; j++) for (let i = 0; i < N; i++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if ((di || dj) && i + di >= 0 && i + di < N && j + dj >= 0 && j + dj < N) adjList[at++] = (j + dj) * N + i + di;
}
// (the ground: a pyramid to the rim, km, with hash noise; and in rows 1…2·CH+1 a maze — ridges on the odd rows, high, each open at
// one end in turn, channels on the even rows — whose one river runs the channels end to end, falling to the sea at (0, 2))
const z = new Float32Array(n), ocean = new Uint8Array(n), water = new Float32Array(n).fill(1), k = new Float32Array(n).fill(20);
for (let c = 0; c < n; c++) {
    const i = c % N, j = (c - i) / N;
    if (i === 0 || j === 0 || i === N - 1 || j === N - 1) { ocean[c] = 1; z[c] = -0.05; continue; }
    let h = Math.imul(c ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    z[c] = Math.fround(0.2 + 3 * Math.min(i, j, N - 1 - i, N - 1 - j) / N + 0.01 * (h >>> 8) / (1 << 24));
}
// (rows 1 and `top` are walls, channels at rows 2, 4 … 2·CH over columns lo … hi, walled at columns 1 and N-2 from the rim's sea but
// for the mouth, (1, 2). Channel r's cells lie at r·run + (their place along it), the river's way counted from the mouth)
const top = 2 * CH + 1, lo = 2, hi = N - 3, run = hi - lo + 1;
const along = (r, i) => r * run + (r % 2 ? hi - i : i - lo);
for (let j = 1; j <= top; j++) for (let i = 1; i <= N - 2; i++) {
    const c = j * N + i;
    if (i < lo || i > hi) z[c] = j === 2 && i === 1 ? 0.25 : 5;
    else if (j % 2 === 0) z[c] = Math.fround(0.3 + 1e-4 * along(j / 2 - 1, i));
    else {
        // (the ridge between channels q and q+1 opens where q's way ends and q+1's begins: at hi after an even q, at lo after an odd)
        const q = (j - 3) / 2, gapAt = q % 2 ? lo : hi;
        z[c] = j > 1 && j < top && i === gapAt ? Math.fround(0.3 + 1e-4 * (along(q, gapAt) + 0.5)) : 5;
    }
}
const mesh = { numCells: n, xyz, adjOffset, adjList, edgeKm: 6371 * 2 / N };
const none = { lakes: [], sink: new Uint8Array(n), base: new Float32Array(n) };
const opened = await openDevice(gpu);
console.log(`patch ${N}×${N} = ${(n / 1e6).toFixed(2)}M cells (the dispatch cap: ${65535 * 128} cells), ${CH} channels of ${run} cells`);

let seen = null;
const t0 = performance.now();
let threw = null;
try {
    await erodeGPU(gpu, { mesh, z: z.slice(), ocean: ocean.slice(), water, k, m: 0.25, seaKm: 0, closed: () => none, column: null, uplift: null },
        { ...historyErodeSettings(1), marine: false, steps: 1 }, { device: opened, onStep: async S => {
            if (S.s) return;
            seen = { levels: S.levels, route: S.route, recv: await S.read('recv', Uint32Array), depth: await S.read('depthA', Uint32Array), outlet: await S.read('outlet', Uint32Array) };
        } });
} catch (e) { threw = e; }
const secs = ((performance.now() - t0) / 1000).toFixed(1);
ok(`the network builds at ${(n / 1e6).toFixed(1)}M cells with a river ${CH} channels long`, !threw && !!seen, threw ? threw.message : `${secs} s`);
if (seen) {
    const { recv, depth, outlet } = seen;
    let wrongOut = 0;
    for (let c = 0; c < n; c++) if ((outlet[c] !== 0) !== (ocean[c] === 1)) wrongOut++;
    ok('every outlet is the sea\'s and every sea cell an outlet (outlets() ran over the whole mesh)', wrongOut === 0, `${wrongOut} cells wrong`);
    // (the CPU's depth: hops to an outlet along recv (an unresolved cell, recv NONE, is a level of its own), memoized)
    const tru = new Int32Array(n).fill(-1), path = [];
    let cycle = 0, deepest = 0, wrong = 0, donorLevel = 0;
    for (let c0 = 0; c0 < n; c0++) {
        if (ocean[c0] || tru[c0] >= 0) continue;
        path.length = 0;
        let c = c0, d = 0;
        for (;;) {
            if (outlet[c]) { d = 0; break; }
            if (tru[c] >= 0) { d = tru[c]; break; }
            if (path.length > n) { cycle++; d = -1e9; break; }
            path.push(c);
            if (recv[c] === NONE) { d = 0; break; }
            c = recv[c] & NONE;
        }
        for (let i = path.length - 1; i >= 0; i--) tru[path[i]] = ++d;
    }
    for (let c = 0; c < n; c++) {
        if (ocean[c]) continue;
        if (tru[c] > deepest) deepest = tru[c];
        if (depth[c] !== tru[c]) wrong++;
        const r = recv[c] === NONE ? -1 : recv[c] & NONE;
        if (r >= 0 && !outlet[r] && depth[c] <= depth[r]) donorLevel++;
    }
    ok(`the river is deeper than the first jumps reach (4096)`, deepest > 4096, `deepest ${deepest} levels, the network's ${seen.levels}`);
    ok('every cell\'s level is its hop count to the sea, exactly', wrong === 0 && cycle === 0 && seen.levels === deepest, `${wrong} of ${n - ocean.reduce((s, v) => s + v, 0)} cells wrong, ${cycle} cycles`);
    ok('every donor sits above its receiver', donorLevel === 0, `${donorLevel} donors at or below their receiver's level`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
