// A detailed moment's picture painted on the GPU (gpu/finish-paint.js) against the CPU's (evolution/finish-view.js
// paintFinished), through Dawn: the same bytes, or within the tolerance finish-paint.js's header gives reasons for.
// Synthetic pictures (fractal heights, a sea, lakes of every kind, land below sea level the sea does not reach) at the
// two shapes the page meets: one averaged down (as 2.5M cells' 4096-px picture on the 2048- and 4096-px textures) and one
// enlarged (as 160K's 1024 px). Needs `npm ci` in v2/tools/gpu-harness; without it the suite says so (⚑) and checks nothing.
import { check, report, section, finish } from './lib/check-kit.mjs';
import { paintFinished, lakeColor } from '../js/evolution/finish-view.js';
import { heightLutOf } from '../js/evolution/looks.js';
import { finishedClimateColor, satelliteSource } from '../js/evolution/climate-view.js';

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

    // (the Satellite layer — climate-view.js satelliteColor — on a synthetic climate: its land colours, a sea warm in the
    // tropics, ice from the poles to the mid-latitudes (every fraction, so the noise's ragged edge is met), lakes open and
    // frozen; its climate picture averaged down and enlarged)
    for (const [what, r, rw] of [['a 4096-px climate picture (2.5M cells)', picture(4096, 1), 4096], ['a 1024-px climate picture (160K cells), enlarged', picture(1024, 2), 1024]]) {
        section(`the Satellite layer, the GPU's against the CPU's: ${what}`);
        const C = climateOf(r, rw), lut = heightLutOf('relief');
        for (const season of ['year', 'jan']) for (const W of [2048, 4096]) {
            const o = { exaggeration: 25, lakes: true, seaWidth: 2048 };
            const img = { data: new Uint8ClampedArray(4 * W * (W >> 1)) };
            paintFinished(r, { width: W, image: img }, lut, { ...o, colorAt: finishedClimateColor('satellite', season, C, W, lut) });
            const g = await P.paintToArrays(r, W, lut, { ...o, lakeColor, satellite: satelliteSource(season, C) });
            let px = 0, max = 0;
            for (let i = 0; i < img.data.length; i += 4) {
                let m = 0;
                for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(img.data[i + c] - g.rgba[i + c]));
                if (m) { px++; max = Math.max(max, m); }
            }
            const share = 100 * px / (W * (W >> 1)), label = `${season} on ${W} px`;
            console.log(`  ${label}: ${px} pixels differ (${share.toFixed(4)} %), by ${max} at most`);
            // (finish-paint.js's header: the light, the sea's ramp, the grids and the ice's noise in f32 move a level on a
            // few pixels in 10⁴ — 0.032 % at most, by 2 at most, on four real moments in three seasons, 2026-11-11; here
            // ~0.05 %, nearly all on the ice's ragged edge, which this climate draws over 30° of latitude a hemisphere)
            check(`${label}: within 2 levels, on under 0.1 % of the pixels (${share.toFixed(4)} %, ${max})`, max <= 2 && share < 0.1);
        }
    }
}

/** A climate for picture r, its climate picture rw wide (rw × rw/2, from r's own pixels): land Köppen classes and year
 *  temperatures by latitude, the realistic picture's colours by height, and the 1° grids — the air's and the sea's
 *  temperature (warm at the equator, cold at the poles; a January and a July), the sea ice (1 at the poles, 0 by 50°). */
function climateOf(r, rw) {
    const rh = rw >> 1, n = rw * rh, f = r.w / rw, koppen = new Uint8Array(n), tAnnual = new Int16Array(n), sat = {};
    for (const s of ['year', 'jan', 'jul']) sat[s] = new Uint8Array(3 * n);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
        const i = y * rw + x, j = y * f * r.w + x * f, lat = 90 - 180 * (y + 0.5) / rh, m = r.heightM[j];
        if (r.ocean[j]) { tAnnual[i] = -32768; continue; }
        koppen[i] = 1 + (x * 7 + y * 3) % 29;
        tAnnual[i] = Math.round(100 * (28 - 0.55 * Math.abs(lat) - 6.5 * Math.max(0, m) / 1000));
        for (const [s, k] of [['year', 0], ['jan', 9], ['jul', 17]]) sat[s].set([60 + (m >> 5) % 140 + k, 90 + (x % 50), 50 + (y % 70)], 3 * i);
    }
    const grid = (fn) => { const g = new Float32Array(64800); for (let j = 0; j < 180; j++) for (let i = 0; i < 360; i++) g[j * 360 + i] = fn(89.5 - j, i - 179.5); return g; };
    const T = { year: grid((la, lo) => 28 - 0.6 * Math.abs(la) + 2 * Math.sin(lo / 20)), jan: grid(la => 28 - 0.6 * Math.abs(la) - 0.3 * la), jul: grid(la => 28 - 0.6 * Math.abs(la) + 0.3 * la) };
    const ice = la => Math.max(0, Math.min(1, (Math.abs(la) - 50) / 30));
    const seaIce = { year: grid(ice), jan: grid(la => ice(la + 8)), jul: grid(la => ice(la - 8)) };
    return { T, Tsea: T, seaIce, ice: seaIce.year, raster: { w: rw, h: rh, koppen, tAnnual, sat } };
}
finish('Finish paint (GPU)');
