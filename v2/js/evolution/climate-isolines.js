// The Climate view's lines (lane climviewA; ~/.cache/geo-sim/lanes-2026-10-29/climview/report.md §2.3): isotherms, isohyets
// and isobars over the colour, and the H and L at the pressure's highs and lows — the conventions of the synoptic chart and
// of Climate Reanalyzer's / NOAA PSL's contoured monthly maps, borrowed.
//
// Honest at 1° (report §1.3): the circulation's fields are sampled with Catmull-Rom (bicubic) interpolation, so a line runs
// smooth through the 1° cells instead of kinking at each one as bilinear does at zoom — smoother, never sharper: no
// detail is added that the field does not have. A land field painted per pixel (temperature at its own height) is
// box-blurred to ~30 km first, so its lines follow the climate, not the relief's pixel noise.
//
// A line is drawn as coverage, the CPU form of the GPU's `fract(v / step)` with `fwidth` antialiasing: a pixel is on the
// line by its distance to the nearest level, measured in pixels through the field's change to its neighbours.

/** Catmull-Rom weights for the four samples around a fraction t ∈ [0, 1). */
function crWeights(t, out) {
    const t2 = t * t, t3 = t2 * t;
    out[0] = 0.5 * (-t3 + 2 * t2 - t);
    out[1] = 0.5 * (3 * t3 - 5 * t2 + 2);
    out[2] = 0.5 * (-3 * t3 + 4 * t2 + t);
    out[3] = 0.5 * (t3 - t2);
}
const WX = new Float64Array(4), WY = new Float64Array(4);
/**
 * A w × h lat–lon field (row 0 at the north, cell centres at half steps) at fractional cell coordinates x, y (x = 0 at
 * the first cell's centre). Longitude wraps; latitude clamps at the poles.
 */
export function cubicAt(f, w, h, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    crWeights(x - x0, WX); crWeights(y - y0, WY);
    let s = 0;
    for (let j = 0; j < 4; j++) {
        const row = Math.max(0, Math.min(h - 1, y0 - 1 + j)) * w;
        let r = 0;
        for (let i = 0; i < 4; i++) r += WX[i] * f[row + ((x0 - 1 + i) % w + w) % w];
        s += WY[j] * r;
    }
    return s;
}
/** A 1° (or any w × h) global field at longitude / latitude in degrees, bicubic. */
export function cubicLonLat(f, lonDeg, latDeg, w = 360, h = 180) {
    return cubicAt(f, w, h, (lonDeg + 180) / 360 * w - 0.5, (90 - latDeg) / 180 * h - 0.5);
}

/**
 * Coverage (0–1) of a line at level multiples of `step` for a pixel whose value is v and whose right and lower neighbours'
 * are vx, vy; `halfPx` is the line's half width in pixels.
 */
export function isolineCoverage(v, vx, vy, step, halfPx) {
    if (!(v === v && vx === vx && vy === vy)) return 0;
    const d = Math.abs(v / step - Math.round(v / step)) * step, grad = Math.max(1e-9, Math.hypot(vx - v, vy - v));
    return Math.max(0, Math.min(1, 1 - (d / grad - halfPx + 0.5)));
}

/**
 * The lines each layer draws (report §2.3): `of` maps the value onto a scale where the levels are multiples of `step`;
 * `bold` (on that scale) is the level drawn heavier; `key` is the legend's line. Isotherms every 10 °C with freezing bold;
 * isohyets by octave from 125 mm a year (125, 250, 500 … 4,000: 250 mm is the desert's edge, bold); isobars every 4 hPa.
 */
export const ISOLINES = {
    temperature: { of: v => v, step: 10, bold: 0, key: 'isotherms every 10 °C, 0 °C bold' },
    rain: { of: v => Math.log2(Math.max(1, v) / 125), step: 1, bold: 1, key: 'isohyets at 125, 250, 500, 1,000, 2,000, 4,000 mm a year; 250 mm (the desert’s edge) bold' },
    pressure: { of: v => v, step: 4, bold: null, key: 'isobars every 4 hPa · H and L at the highs and lows' },
};
/** A pixel's line coverage for a layer's isolines, from its value and its right and lower neighbours' (raw units). */
export function layerIsoline(layer, v, vx, vy, halfPx = 0.7) {
    const L = ISOLINES[layer];
    if (!L) return 0;
    const a = L.of(v), ax = L.of(vx), ay = L.of(vy);
    let k = isolineCoverage(a, ax, ay, L.step, halfPx);
    if (L.bold != null) k = Math.max(k, isolineCoverage(a - L.bold, ax - L.bold, ay - L.bold, 1e6, 1.6 * halfPx));
    return k;
}

/**
 * A box blur of a W × H raster (longitude wrapping, latitude clamped), `radiusPx` each way, done twice (≈ a Gaussian):
 * the ~30 km smoothing under a land field's lines. NaN pixels (the sea, under a land field) neither count nor take a
 * value.
 */
export function blurRaster(src, W, H, radiusPx) {
    const r = Math.max(1, Math.round(radiusPx));
    let a = Float32Array.from(src), b = new Float32Array(W * H);
    const sum = new Float64Array(Math.max(W, H) + 2 * r + 1), cnt = new Float64Array(sum.length);
    const pass = (from, to, horizontal) => {
        const n = horizontal ? W : H, lines = horizontal ? H : W;
        for (let l = 0; l < lines; l++) {
            const at = k => horizontal ? l * W + ((k % W) + W) % W : Math.max(0, Math.min(H - 1, k)) * W + l;
            sum[0] = 0; cnt[0] = 0;
            for (let k = -r; k < n + r; k++) { const v = from[at(k)], ok = v === v; sum[k + r + 1] = sum[k + r] + (ok ? v : 0); cnt[k + r + 1] = cnt[k + r] + (ok ? 1 : 0); }
            for (let k = 0; k < n; k++) {
                const i = at(k);
                if (!(from[i] === from[i])) { to[i] = NaN; continue; }
                const c = cnt[k + 2 * r + 1] - cnt[k];
                to[i] = (sum[k + 2 * r + 1] - sum[k]) / c;
            }
        }
    };
    for (let it = 0; it < 2; it++) { pass(a, b, true); pass(b, a, false); }
    return a;
}

/**
 * The pressure's highs and lows on a w × h field: cells highest (lowest) within a disc of `R` cells (13° ≈ 1,450 km, about
 * a synoptic high's half width) and at least `minHpa` off that disc's mean — so a flat ridge gets no letter. Latitudes
 * within 15° of the poles are skipped (the disc wraps badly there). → [{ lon, lat, hi, hPa }].
 */
export function highsAndLows(slp, w = 360, h = 180, R = 13, minHpa = 3) {
    const found = [], DEG = Math.PI / 180, step = 180 / h;
    for (let j = Math.round(15 / step); j < h - Math.round(15 / step); j++) {
        const cl = Math.max(0.2, Math.cos((90 - (j + 0.5) * step) * DEG));
        for (let i = 0; i < w; i++) {
            const p = slp[j * w + i];
            let hi = true, lo = true, sum = 0, k = 0;
            for (let dj = -R; dj <= R && (hi || lo); dj++) {
                const jj = j + dj; if (jj < 0 || jj >= h) continue;
                const di = Math.round(Math.sqrt(Math.max(0, R * R - dj * dj)) / cl);
                for (let d = -di; d <= di; d++) { const q = slp[jj * w + ((i + d) % w + w) % w]; if (q > p) hi = false; if (q < p) lo = false; sum += q; k++; }
            }
            if ((hi || lo) && Math.abs(p - sum / k) >= minHpa) found.push({ lon: (i + 0.5) * 360 / w - 180, lat: 90 - (j + 0.5) * step, hi, hPa: p });
        }
    }
    // (a flat top ties several cells: one letter per high or low, the first found within R cells of each other)
    const kept = [], near = (a, b) => {
        const dLon = Math.abs(((a.lon - b.lon) % 360 + 540) % 360 - 180) * Math.cos(0.5 * (a.lat + b.lat) * DEG);
        return Math.hypot(dLon, a.lat - b.lat) < R * step;
    };
    for (const f of found) if (!kept.some(k => k.hi === f.hi && near(k, f))) kept.push(f);
    return kept;
}
