// The export of a finished moment (plans/V2_FULL_PLANET_PLAN.md step C; the developer's decisions, 2026-10-01: finished
// moments only; a 16-bit heightmap with the sea floor on a fixed −11…+9 km scale — the same shade the same height on every
// planet — and a land heightmap 0…+9 km, the sea black; rivers drawn on the colour maps as on screen). Each map is the
// finished picture (finish.js finishRaster) at its own width or a half or quarter of it, averaged down — never enlarged.

import { paintFinished, riverPaths, drawRivers } from './finish-view.js';
import { encodeGrayPng, canvasOf, canvasPng } from '../view/png.js';

export const EXPORT_TYPES = [
    { id: 'color', label: 'Colour Map (as shown)', bits: 8 },
    { id: 'heightmap', label: 'Heightmap with Sea Floor (16-bit)', bits: 16 },
    { id: 'landheightmap', label: 'Land Heightmap (16-bit)', bits: 16 },
    { id: 'landmask', label: 'Land Mask', bits: 8 },
];
/** The heightmap's scale: black −11 km (below the deepest trench), white +9 km (above the highest peak), linear. */
export const HEIGHT_RANGE_M = [-11000, 9000];
/** The land heightmap's: the sea black (0), land from 0 m (1) to +9 km (65535), linear. */
export const LAND_TOP_M = 9000;

/** The widths a finished picture exports at: its own, a half and a quarter (at least 1024 px). */
export function exportWidths(r) {
    const out = [];
    for (let w = r.w; w >= 1024 && out.length < 3; w >>= 1) out.push(w);
    return out.length ? out : [r.w];
}

/** A file's name: the planet's seed, the moment and the map — `orogen-evolution-12345-760Myr-heightmap.png`. */
export function exportFileName(seed, timeMyr, type) {
    return `orogen-evolution-${seed}-${Math.round(timeMyr)}Myr-${type}.png`;
}

/**
 * The picture's heights at width W (a whole fraction of its own): each pixel the mean of its block — of all of it
 * (`land` false), or of its land only — and whether the block is mostly sea.
 */
function heightsAt(r, W, land = false) {
    const H = W >> 1, K = Math.max(1, Math.round(r.w / W)), m = new Float32Array(W * H), sea = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0, n = 0, wet = 0;
        for (let dy = 0; dy < K; dy++) for (let dx = 0; dx < K; dx++) {
            const i = (y * K + dy) * r.w + x * K + dx;
            if (r.ocean[i]) wet++;
            if (!land || !r.ocean[i]) { s += r.heightM[i]; n++; }
        }
        const p = y * W + x;
        sea[p] = 2 * wet > K * K ? 1 : 0;
        m[p] = n ? s / n : 0;
    }
    return { m, sea, H };
}

/** The 16-bit heightmap, the sea floor included: −11 km black … +9 km white. */
export function heightmap16(r, W) {
    const { m } = heightsAt(r, W), [lo, hi] = HEIGHT_RANGE_M, out = new Uint16Array(m.length);
    for (let i = 0; i < m.length; i++) out[i] = Math.round(65535 * Math.min(1, Math.max(0, (m[i] - lo) / (hi - lo))));
    return out;
}

/** The 16-bit land heightmap: the sea black, land 0…+9 km as 1…65535 (a lake's bed below sea level as 0 m). */
export function landHeightmap16(r, W) {
    const { m, sea } = heightsAt(r, W, true), out = new Uint16Array(m.length);
    for (let i = 0; i < m.length; i++) out[i] = sea[i] ? 0 : 1 + Math.round(65534 * Math.min(1, Math.max(0, m[i] / LAND_TOP_M)));
    return out;
}

/** The land mask: land white (lakes are land), the sea black. */
export function landMask8(r, W) {
    const { sea } = heightsAt(r, W), out = new Uint8Array(sea.length);
    for (let i = 0; i < sea.length; i++) out[i] = sea[i] ? 0 : 255;
    return out;
}

/**
 * The colour map as the Terrain view shows it: the palette's colours hillshaded, the lakes and the rivers (with Rivers &
 * Lakes), no grid. `look`: { lut, exaggeration, water, riverQ, byRegime }.
 */
export async function colorMap(fin, W, look) {
    const H = W >> 1, image = new ImageData(W, H);
    paintFinished(fin.raster, { width: W, image }, look.lut, { exaggeration: look.exaggeration, lakes: look.water });
    const canvas = canvasOf(W, H), ctx = canvas.getContext('2d');
    ctx.putImageData(image, 0, 0);
    if (look.water && fin.rivers) {
        // (the rivers' lines are drawn for a 2048-wide picture: as thick, relative to the map, at any width)
        const k = W / 2048;
        ctx.save(); ctx.scale(k, k); drawRivers(ctx, riverPaths(fin, look.riverQ), look.byRegime); ctx.restore();
    }
    return canvasPng(canvas);
}

/**
 * One map of a finished moment as a PNG. `onProgress(share, label)`.
 * @returns {Promise<Blob>}
 */
export async function exportMap(type, fin, W, look, onProgress = () => {}) {
    const r = fin.raster, H = W >> 1;
    onProgress(0.05, 'Drawing…');
    await new Promise(res => setTimeout(res, 0));                   // (the progress shows before the work)
    if (type === 'color') {
        const blob = colorMap(fin, W, look);
        onProgress(0.6, 'Encoding PNG…');
        return blob;
    }
    const data = type === 'heightmap' ? heightmap16(r, W) : type === 'landheightmap' ? landHeightmap16(r, W) : type === 'landmask' ? landMask8(r, W) : null;
    if (!data) throw new Error(`no such map: ${type}`);
    onProgress(0.5, 'Encoding PNG…');
    await new Promise(res => setTimeout(res, 0));
    return encodeGrayPng(W, H, data, type === 'landmask' ? 8 : 16);
}
