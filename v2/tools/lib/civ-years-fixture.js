// A fixed set of famine-years records for civ/years-gpu.js (lane civgpu2): made from hashes, so Node and a browser's worker
// build the same one. civ-years-browser.mjs runs it in Chrome's worker and in Dawn and compares the two bit for bit.
import { yearsGPU, REC, R } from '../../js/civ/years-gpu.js';
import { CIV } from '../../js/civ/civ-config.js';

const h01 = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296; };

/** The kernel's output on the fixture: Float32Array 4·count (store, people, dead, herd per record). */
export async function runFixture(ctx, n = 20000) {
    const C = CIV, Y = C.stepYears, regions = 64, slots = 50;
    const w = { mesh: { numCells: n }, pAnnual: Float32Array.from({ length: n }, (_, c) => 100 + 1500 * h01(c, 1)) };
    const V = { rainCV: Float32Array.from({ length: n }, (_, c) => 0.1 + 0.4 * h01(c, 2)), region: Int32Array.from({ length: n }, (_, c) => Math.floor(regions * h01(c, 3))),
        rainLn: Float32Array.from({ length: 4 * n }, (_, i) => 0.3 * (h01(i, 4) - 0.5)), regions };
    const k = await yearsGPU(ctx, w, V, C), { rec, recF } = k;
    for (let j = 0; j < n; j++) {
        const o = REC * j, f = x => h01(j, x);
        rec[o + R.home] = j; rec[o + R.slot] = f(5) < 0.3 ? Math.floor(slots * f(6)) : -1;
        recF[o + R.cap] = f(7) < 0.5 ? 1 : 0.5; recF[o + R.kR] = f(8) < 0.6 ? 20 * f(9) : 0; recF[o + R.kI] = rec[o + R.slot] !== 0xffffffff ? 30 * f(10) : 0;
        recF[o + R.kH] = f(11) < 0.3 ? 5 * f(12) : 0; recF[o + R.Kw] = f(13) < 0.5 ? 0.5 * f(14) : 0;
        recF[o + R.mR] = 0.8 + 0.3 * f(15); recF[o + R.mI] = 0.8 + 0.3 * f(16); recF[o + R.mW] = 0.9 + 0.2 * f(17); recF[o + R.steady] = f(18) < 0.3 ? 0.5 : 0;
        recF[o + R.rampN] = 0.2 + 0.8 * f(19); recF[o + R.lnFull] = Math.log(450 / w.pAnnual[j]); recF[o + R.tl] = 1500 + 1000 * f(20); recF[o + R.n0] = 500 + 1000 * f(21);
        recF[o + R.herdMean] = 0.6 + 0.4 * f(22); recF[o + R.d] = 0.5 + 30 * f(23); recF[o + R.st] = 0.5 * f(24); recF[o + R.hs] = 0.5 + 0.5 * f(25);
    }
    const modes = Float32Array.from({ length: 2 * Y }, (_, i) => 2 * (h01(i, 30) - 0.5)), noise = Float32Array.from({ length: regions * Y }, (_, i) => 2 * (h01(i, 31) - 0.5));
    const flood = Float32Array.from({ length: slots * Y }, (_, i) => 2 * h01(i, 32));
    const out = await k.run(n, modes, noise, flood);
    k.destroy();
    return out;
}
