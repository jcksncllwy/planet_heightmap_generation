// The fixed climate grid: a regular lat-lon grid, identical at every terrain resolution and on every device.
// Cell (i, j): longitude −180 + (i + 0.5)·step (west → east), latitude 90 − (j + 0.5)·step (north → south),
// so a field is stored row-major from the north-west corner, like an equirectangular image.
// DOM-free: shared by the new climate core, the climate lab and the Node tuning scripts.

export const DEG = Math.PI / 180;

export class LatLonGrid {
    /** @param {number} stepDeg  cell size in degrees (1 → 360 × 180 cells) */
    constructor(stepDeg = 1) {
        this.step = stepDeg;
        this.w = Math.round(360 / stepDeg);
        this.h = Math.round(180 / stepDeg);
        this.size = this.w * this.h;
        this.lat = new Float64Array(this.h);             // degrees, row centres
        this.lon = new Float64Array(this.w);             // degrees, column centres
        for (let j = 0; j < this.h; j++) this.lat[j] = 90 - (j + 0.5) * stepDeg;
        for (let i = 0; i < this.w; i++) this.lon[i] = -180 + (i + 0.5) * stepDeg;
        // Relative cell area ∝ cos(lat); normalised so the whole sphere sums to 1.
        this.rowArea = new Float64Array(this.h);
        let total = 0;
        for (let j = 0; j < this.h; j++) { this.rowArea[j] = Math.cos(this.lat[j] * DEG); total += this.rowArea[j] * this.w; }
        for (let j = 0; j < this.h; j++) this.rowArea[j] /= total;
    }

    /** Fractional column/row of a lat/lon (degrees), for sampling. */
    colOf(lonDeg) { return ((lonDeg + 180) / this.step) - 0.5; }
    rowOf(latDeg) { return ((90 - latDeg) / this.step) - 0.5; }

    /** Cell index containing lat/lon (degrees). */
    cellAt(latDeg, lonDeg) {
        let i = Math.floor((lonDeg + 180) / this.step);
        let j = Math.floor((90 - latDeg) / this.step);
        i = ((i % this.w) + this.w) % this.w;
        j = Math.max(0, Math.min(this.h - 1, j));
        return j * this.w + i;
    }

    /**
     * Bilinear sample of a field (one layer of `size` values) at lat/lon (degrees). Longitude wraps; latitude clamps
     * at the pole rows. NaN cells are skipped (weights renormalised); all four NaN → NaN.
     */
    sample(field, latDeg, lonDeg, offset = 0) {
        const x = this.colOf(lonDeg), y = Math.max(0, Math.min(this.h - 1, this.rowOf(latDeg)));
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = x - x0, fy = y - y0;
        const i0 = ((x0 % this.w) + this.w) % this.w, i1 = i0 + 1 === this.w ? 0 : i0 + 1;
        const j0 = y0, j1 = y0 + 1 < this.h ? y0 + 1 : y0;
        const w = this.w;
        const v00 = field[offset + j0 * w + i0], v10 = field[offset + j0 * w + i1];
        const v01 = field[offset + j1 * w + i0], v11 = field[offset + j1 * w + i1];
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        if (v00 === v00 && v10 === v10 && v01 === v01 && v11 === v11) {       // common case: no gaps
            return v00 * w00 + v10 * w10 + v01 * w01 + v11 * w11;
        }
        let sum = 0, wsum = 0;
        if (v00 === v00 && w00 > 0) { sum += v00 * w00; wsum += w00; }
        if (v10 === v10 && w10 > 0) { sum += v10 * w10; wsum += w10; }
        if (v01 === v01 && w01 > 0) { sum += v01 * w01; wsum += w01; }
        if (v11 === v11 && w11 > 0) { sum += v11 * w11; wsum += w11; }
        return wsum > 0 ? sum / wsum : NaN;
    }

    /** Area-weighted mean of a field over cells where mask[c] is truthy and the value is finite. */
    areaMean(field, mask = null, offset = 0) {
        let s = 0, a = 0;
        for (let j = 0; j < this.h; j++) {
            const wa = this.rowArea[j];
            for (let i = 0; i < this.w; i++) {
                const c = j * this.w + i;
                if (mask && !mask[c]) continue;
                const v = field[offset + c];
                if (v === v) { s += v * wa; a += wa; }
            }
        }
        return a > 0 ? s / a : NaN;
    }
}

/**
 * Block average of a fine-grid field onto a coarser grid of the same family (ratio × ratio cells, area-weighted;
 * NaN skipped, all-NaN → 0). ratio 1 copies.
 */
export function coarsenField(fine, coarse, ratio, src) {
    if (ratio === 1) return Float64Array.from(src, v => (v === v ? v : 0));
    const out = new Float64Array(coarse.size);
    for (let J = 0; J < coarse.h; J++) for (let I = 0; I < coarse.w; I++) {
        let s = 0, ws = 0;
        for (let dj = 0; dj < ratio; dj++) {
            const j = J * ratio + dj, wt = fine.rowArea[j];
            for (let di = 0; di < ratio; di++) { const v = src[j * fine.w + I * ratio + di]; if (v === v) { s += v * wt; ws += wt; } }
        }
        out[J * coarse.w + I] = ws > 0 ? s / ws : 0;
    }
    return out;
}

/** Bilinear interpolation of a coarse-grid field onto the fine grid, written at out[offset …]. ratio 1 copies. */
export function refineField(coarse, fine, ratio, src, out, offset = 0) {
    if (ratio === 1) { for (let c = 0; c < fine.size; c++) out[offset + c] = src[c]; return; }
    const map = refineMap(coarse, fine);
    for (let c = 0, k = 0; c < fine.size; c++, k += 4) {
        out[offset + c] = map.w[k] * src[map.i[k]] + map.w[k + 1] * src[map.i[k + 1]] + map.w[k + 2] * src[map.i[k + 2]] + map.w[k + 3] * src[map.i[k + 3]];
    }
}

/** The four coarse cells and weights behind every fine cell (built once per grid pair). */
const refineMaps = new Map();
function refineMap(g, core) {
    const key = `${g.step}|${core.step}`;
    let m = refineMaps.get(key);
    if (m) return m;
    m = { i: new Int32Array(4 * core.size), w: new Float64Array(4 * core.size) };
    for (let j = 0; j < core.h; j++) for (let ii = 0; ii < core.w; ii++) {
        const c = j * core.w + ii, k = 4 * c;
        const x = g.colOf(core.lon[ii]), y = Math.max(0, Math.min(g.h - 1, g.rowOf(core.lat[j])));
        const x0 = Math.floor(x), y0 = Math.min(g.h - 1, Math.floor(y)), fx = x - x0, fy = y - y0;
        const i0 = ((x0 % g.w) + g.w) % g.w, i1 = (i0 + 1) % g.w, j1 = Math.min(g.h - 1, y0 + 1);
        m.i[k] = y0 * g.w + i0; m.w[k] = (1 - fx) * (1 - fy);
        m.i[k + 1] = y0 * g.w + i1; m.w[k + 1] = fx * (1 - fy);
        m.i[k + 2] = j1 * g.w + i0; m.w[k + 2] = (1 - fx) * fy;
        m.i[k + 3] = j1 * g.w + i1; m.w[k + 3] = fx * fy;
    }
    refineMaps.set(key, m);
    return m;
}

/**
 * Regrid a field given on any regular source lat/lon grid (1-D coordinate arrays in degrees, either orientation,
 * longitudes 0…360 or −180…180) onto `grid` by bilinear interpolation. `src` holds `layers` stacked layers of
 * srcLat.length × srcLon.length values. Returns Float32Array(layers × grid.size), NaN where no source data.
 */
export function regridBilinear(src, srcLat, srcLon, layers, grid) {
    const nLat = srcLat.length, nLon = srcLon.length;
    const lat0 = srcLat[0], dLat = (srcLat[nLat - 1] - srcLat[0]) / (nLat - 1);
    const lon0 = srcLon[0], dLon = (srcLon[nLon - 1] - srcLon[0]) / (nLon - 1);
    const lonsWrap = Math.abs(dLon * nLon - 360) < 1e-6;
    const out = new Float32Array(layers * grid.size);
    for (let j = 0; j < grid.h; j++) {
        let y = (grid.lat[j] - lat0) / dLat;
        y = Math.max(0, Math.min(nLat - 1, y));
        const y0 = Math.min(nLat - 2, Math.floor(y)), fy = y - y0;
        for (let i = 0; i < grid.w; i++) {
            let x = (grid.lon[i] - lon0) / dLon;
            if (lonsWrap) x = ((x % nLon) + nLon) % nLon;
            else x = Math.max(0, Math.min(nLon - 1, x));
            const x0 = Math.floor(x), fx = x - x0;
            const x1 = lonsWrap ? (x0 + 1) % nLon : Math.min(nLon - 1, x0 + 1);
            const corners = [
                [y0 * nLon + x0, (1 - fx) * (1 - fy)], [y0 * nLon + x1, fx * (1 - fy)],
                [(y0 + 1) * nLon + x0, (1 - fx) * fy], [(y0 + 1) * nLon + x1, fx * fy],
            ];
            for (let k = 0; k < layers; k++) {
                const base = k * nLat * nLon;
                let s = 0, ws = 0;
                for (const [idx, wt] of corners) {
                    const v = src[base + idx];
                    if (wt > 0 && v === v) { s += v * wt; ws += wt; }
                }
                out[k * grid.size + j * grid.w + i] = ws > 1e-9 ? s / ws : NaN;
            }
        }
    }
    return out;
}
