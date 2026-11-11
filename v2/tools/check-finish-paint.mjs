// A detailed moment's picture painted on the GPU (gpu/finish-paint.js) against the CPU's (evolution/finish-view.js
// paintFinished), through Dawn: the same bytes, or within the tolerance finish-paint.js's header gives reasons for.
// Synthetic pictures (fractal heights, a sea, lakes of every kind, land below sea level the sea does not reach) at the
// two shapes the page meets: one averaged down (as 2.5M cells' 4096-px picture on the 2048- and 4096-px textures) and one
// enlarged (as 160K's 1024 px). Needs `npm ci` in v2/tools/gpu-harness; without it the suite says so (⚑) and checks nothing.
import { check, report, section, finish } from './lib/check-kit.mjs';
import { paintFinished, lakeColor } from '../js/evolution/finish-view.js';
import { heightLutOf } from '../js/evolution/looks.js';

let gpu = null;
try { ({ gpu } = await import('./gpu-harness/dawn.mjs')); } catch (e) { console.log(`no Dawn: ${e.code ?? e.message}`); }
const { FinishPainter } = await import('../js/gpu/finish-paint.js');

/** A picture w × w/2: value-noise heights (m, −7…+5 km), the sea below 0 save one closed hollow, lakes in patches. */
function picture(w, seed) {
    const h = w >> 1, n = w * h, heightM = new Int16Array(n), ocean = new Uint8Array(n), water = new Uint8Array(n);
    const hash = (x, y, o) => { let v = (x * 374761393 + y * 668265263 + o * 2147483647 + seed * 1442695041) | 0; v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
    const noise = (x, y, o) => {
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const a = hash(x0, y0, o), b = hash(x0 + 1, y0, o), c = hash(x0, y0 + 1, o), d = hash(x0 + 1, y0 + 1, o);
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = 0, amp = 1, f = 8 / w;
        for (let o = 0; o < 7; o++) { v += amp * (noise(x * f, y * f, o) - 0.5); amp *= 0.5; f *= 2; }
        const i = y * w + x, m = Math.round(9000 * v - 600);
        heightM[i] = Math.max(-7000, Math.min(5000, m));
        // (a hollow below sea level that the sea does not reach: a box of land, its floor under 0)
        const hollow = x > w * 0.6 && x < w * 0.65 && y > h * 0.3 && y < h * 0.35;
        if (hollow) heightM[i] = -40 - (x % 7);
        ocean[i] = heightM[i] < 0 && !hollow ? 1 : 0;
        if (!ocean[i] && noise(x * 40 / w, y * 40 / w, 9) > 0.78) water[i] = 1 + Math.floor(noise(x * 9 / w, y * 9 / w, 10) * 3);
    }
    return { w, h, heightM, ocean, water };
}

if (!gpu) report('the GPU paint not checked: run npm ci in v2/tools/gpu-harness', NaN, { earth: [0, 0], unit: '' });
else {
    const P = await FinishPainter.open(gpu);
    check('a WebGPU painter opens on Dawn', !!P);
    const cases = [['averaged down (2.5M cells: a 4096-px picture)', picture(4096, 1)], ['enlarged (160K cells: a 1024-px picture)', picture(1024, 2)]];
    for (const [what, r] of cases) {
        section(`the GPU's paint against the CPU's: ${what}`);
        for (const pal of ['relief', 'heightmap']) for (const W of [2048, 4096]) {
            const lut = heightLutOf(pal), o = { exaggeration: 20, lakes: true, seaWidth: 2048 };
            const img = { data: new Uint8ClampedArray(4 * W * (W >> 1)) }, sea = new Uint8ClampedArray(4 * 2048 * 1024);
            paintFinished(r, { width: W, image: img }, lut, { ...o, seaImage: sea });
            const g = await P.paintToArrays(r, W, lut, { ...o, lakeColor });
            let px = 0, max = 0;
            for (let i = 0; i < img.data.length; i += 4) {
                let m = 0;
                for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(img.data[i + c] - g.rgba[i + c]));
                if (m) { px++; max = Math.max(max, m); }
            }
            let glint = 0;
            for (let i = 0; i < sea.length; i++) if (sea[i] !== g.glint[i]) glint++;
            const share = 100 * px / (W * (W >> 1)), exact = pal === 'heightmap' && r.w >= W, label = `${pal} on ${W} px`;
            console.log(`  ${label}: ${px} pixels differ (${share.toFixed(4)} %), by ${max} at most; the glint's mask ${glint ? `${glint} bytes differ` : 'the same'}`);
            check(`${label}: the glint's mask the same`, glint === 0);
            // (finish-paint.js's header: averaged down and unshaded, exact; else the f32 light and the enlarged f32 sum
            // move a level or two on a few pixels in 10⁴ — 0.040 % at most measured on four real moments, a 160K one on 4096 px, 2026-11-11)
            if (exact) check(`${label}: byte for byte the CPU's`, px === 0);
            else check(`${label}: within 2 levels, on under 0.05 % of the pixels (${share.toFixed(4)} %, ${max})`, max <= 2 && share < 0.05);
        }
    }
    // (on the page the picture goes to a canvas in the device's preferred format — BGRA on most: red and blue swapped)
    section('the bytes in BGRA order (a canvas in the bgra8unorm format)');
    const r = picture(1024, 2), lut = heightLutOf('relief'), o = { exaggeration: 20, lakes: true, lakeColor };
    const a = await P.paintToArrays(r, 2048, lut, o), b = await P.paintToArrays(r, 2048, lut, { ...o, bgra: true });
    let off = 0;
    for (let i = 0; i < a.rgba.length; i += 4) if (a.rgba[i] !== b.rgba[i + 2] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i] || b.rgba[i + 3] !== 255) off++;
    check(`BGRA: the RGBA picture with red and blue swapped (${off} pixels otherwise)`, off === 0);
}
finish('Finish paint (GPU)');
