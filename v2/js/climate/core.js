// The new climate — one generator-neutral entry point. DOM-free; runs in a worker or in Node.
//
//   computeClimate(input, options) → { grid, surface, anchors, months, cell, timing }
//
// The climate is computed on a fixed lat-lon grid (grid.js), the same at every terrain resolution and on every
// device, at K points in the year ("anchors"). Twelve months are rebuilt from the anchors (seasons.js). Only local
// work with a fixed physical footprint touches the terrain cells: sampling the grid fields, correcting temperature
// for each cell's own height (lapse rate), and classifying Köppen per cell (koppen.js) — so the result does not
// depend on the terrain resolution.
//
// The fields at the K points come from `options.stages` — { winds, temperature, circulation, rain }, each a function
// of the context and the stages before it (temperature.js is the energy-balance stage, circulation.js derives
// pressure and winds from it; inputs.js has observations and placeholders for stages not built yet) — or from a
// single `options.anchorSource` (the Phase 1 oracle run: observedAnchors() below feeds real data, measuring the best
// the rest of the pipeline can do).

import { LatLonGrid } from './grid.js';
import { interpolationMatrix, PRECIP_TRANSFORMS } from './seasons.js';
import { classifyCell } from './koppen.js';

/** Default settings. Units in the names. */
export const CORE_DEFAULTS = Object.freeze({
    gridStepDeg: 1,
    anchors: 6,                 // points in the year (Phase 0: 6 keeps ≥ 92 % of every seasonal regime; 4 does not)
    anchorPhase: 0,             // month of anchor 0 (0 = the month after the northern winter solstice; Earth: January)
    precipTransform: 'sqrt',    // how rain is interpolated between anchors (Phase 0 season test: best with points)
    lapseRateCPerKm: 6.5,       // standard environmental lapse rate
    tempOffsetC: 0,
    precipScale: 1,
    couplings: 2,               // rounds of temperature ↔ winds when the winds are derived …
    couplingsWithOcean: 3,      // … and with the ocean too (its heat needs one more round to reach the temperature)
});

/**
 * @param {object} input
 * @param {Float32Array|Float64Array} input.xyz     cell positions on the unit sphere (3 per cell)
 * @param {Float32Array} input.elevKm               surface height in km (sea floor negative)
 * @param {'y-up'|'z-up'} input.axes                V1: y is north, lon = atan2(x, z). Evolution: z is north, lon = atan2(y, x)
 * @param {Uint8Array} [input.land]                 1 = land; default elevKm > 0
 * @param {object} options                          CORE_DEFAULTS + anchorSource(ctx) → { T, P } (K·G each; °C at the grid's
 *                                                  reference height, mm/month; NaN = no data there)
 */
export function computeClimate(input, options = {}) {
    const o = { ...CORE_DEFAULTS, ...options };
    const timing = [];
    let t0 = performance.now();
    const lap = (stage) => { const t = performance.now(); timing.push({ stage, ms: t - t0 }); t0 = t; };

    const n = input.elevKm.length;
    const grid = new LatLonGrid(o.gridStepDeg), G = grid.size;
    const land = input.land ?? (() => { const l = new Uint8Array(n); for (let r = 0; r < n; r++) l[r] = input.elevKm[r] > 0 ? 1 : 0; return l; })();

    // 1. Where each terrain cell is
    const lat = new Float32Array(n), lon = new Float32Array(n);
    cellLatLon(input.xyz, input.axes, lat, lon);
    lap('cell positions');

    // 2. The surface as the grid sees it
    const surface = aggregateSurface(grid, lat, lon, input.elevKm, land);
    lap('surface → grid');

    // 3. The climate at K points in the year — from the stages (winds → temperature → rain; each reads only earlier
    //    ones), or from a single anchor source (Phase 1's oracle run)
    const K = o.anchors;
    const anchorMonths = Array.from({ length: K }, (_, k) => o.anchorPhase + k * 12 / K);
    const sctx = { grid, surface, anchorMonths, options: o };
    let anchors, stages = null;
    if (o.stages) {
        let winds = o.stages.winds ? o.stages.winds(sctx) : null;
        lap('winds');
        let temperature, circulation = null, ocean = null;
        if (o.stages.circulation) {
            // Temperature, winds and ocean need each other (winds carry heat and drive the currents; pressure comes
            // from temperature; the currents move heat): a few rounds settle them. The first temperature has the
            // given winds (or none) and no ocean heat; later ones the derived winds and the ocean's heat.
            const rounds = o.stages.ocean ? o.couplingsWithOcean : o.couplings;
            for (let it = 0; it < rounds; it++) {
                temperature = o.stages.temperature(sctx, winds, temperature?.state, ocean?.qflux ?? null);
                circulation = o.stages.circulation(sctx, temperature);
                winds = circulation;
                if (o.stages.ocean) ocean = o.stages.ocean(sctx, circulation, temperature);
            }
            lap(o.stages.ocean ? 'temperature ↔ winds ↔ ocean' : 'temperature ↔ winds');
        } else {
            temperature = o.stages.temperature(sctx, winds);
            lap('temperature');
        }
        const rain = o.stages.rain(sctx, winds, temperature);
        lap('rain');
        anchors = { T: Float32Array.from(temperature.T), P: rain.P };
        stages = { winds, temperature, circulation, ocean, rain };
    } else {
        anchors = o.anchorSource(sctx);
        lap('anchors');
    }
    if (o.tempOffsetC) for (let i = 0; i < anchors.T.length; i++) anchors.T[i] += o.tempOffsetC;

    // 4. Twelve months on the grid (temperature at the grid's reference height)
    const months = synthesizeGrid(grid, anchors, K, o);
    lap('12 months (grid)');

    // 5. Per terrain cell: sample, correct for height, classify
    const cell = finishCells(grid, surface, months, lat, lon, input.elevKm, land, o);
    lap('terrain cells + Köppen');

    return { grid, surface, anchorMonths, anchors, months, cell, stages, timing };
}

// ── 1 ─────────────────────────────────────────────────────────────────────────
export function cellLatLon(xyz, axes, lat, lon) {
    const n = lat.length, R = 180 / Math.PI;
    if (axes === 'z-up') {
        for (let r = 0; r < n; r++) {
            const x = xyz[3 * r], y = xyz[3 * r + 1], z = xyz[3 * r + 2];
            lat[r] = Math.asin(Math.max(-1, Math.min(1, z))) * R;
            lon[r] = Math.atan2(y, x) * R;
        }
    } else if (axes === 'y-up') {
        for (let r = 0; r < n; r++) {
            const x = xyz[3 * r], y = xyz[3 * r + 1], z = xyz[3 * r + 2];
            lat[r] = Math.asin(Math.max(-1, Math.min(1, y))) * R;
            lon[r] = Math.atan2(x, z) * R;
        }
    } else throw new Error(`computeClimate: unknown axes '${axes}' (expected 'y-up' or 'z-up')`);
}

// ── 2 ─────────────────────────────────────────────────────────────────────────
/**
 * Per grid cell: land fraction, mean land height (km), mean height of everything (km). Grid cells too small to hold
 * a terrain cell (near the poles, or at a coarse terrain resolution) take the values of the nearest grid cell in
 * their latitude row that does — a short distance, since such cells are tiny.
 */
export function aggregateSurface(grid, lat, lon, elevKm, land) {
    const G = grid.size, n = lat.length;
    const cnt = new Float64Array(G), landCnt = new Float64Array(G), sumAll = new Float64Array(G), sumLand = new Float64Array(G);
    for (let r = 0; r < n; r++) {
        const c = grid.cellAt(lat[r], lon[r]);
        cnt[c]++; sumAll[c] += elevKm[r];
        if (land[r]) { landCnt[c]++; sumLand[c] += elevKm[r]; }
    }
    const from = rowFill(grid, cnt);
    const landFrac = new Float32Array(G), meanLandKm = new Float32Array(G), meanKm = new Float32Array(G);
    for (let c = 0; c < G; c++) {
        const s = from[c];
        landFrac[c] = cnt[s] ? landCnt[s] / cnt[s] : 0;
        meanKm[c] = cnt[s] ? sumAll[s] / cnt[s] : 0;
        meanLandKm[c] = landCnt[s] ? sumLand[s] / landCnt[s] : NaN;
    }
    return { landFrac, meanLandKm, meanKm };
}

/** For each grid cell, itself if count[c] > 0, else the nearest cell in the same row with count > 0. */
function rowFill(grid, count) {
    const from = new Int32Array(grid.size);
    for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) {
        const c = j * grid.w + i;
        from[c] = c;
        if (count[c]) continue;
        for (let d = 1; d < grid.w; d++) {
            const a = j * grid.w + (i + d) % grid.w, b = j * grid.w + (i - d + grid.w) % grid.w;
            if (count[a]) { from[c] = a; break; }
            if (count[b]) { from[c] = b; break; }
        }
    }
    return from;
}

// ── 4 ─────────────────────────────────────────────────────────────────────────
function synthesizeGrid(grid, anchors, K, o) {
    const G = grid.size;
    const M = interpolationMatrix(K, o.anchorPhase, 0);
    const tf = PRECIP_TRANSFORMS[o.precipTransform];
    const T = new Float32Array(12 * G).fill(NaN), P = new Float32Array(12 * G).fill(NaN);
    const pt = new Float64Array(K);
    for (let c = 0; c < G; c++) {
        let ok = true;
        for (let k = 0; k < K && ok; k++) ok = anchors.T[k * G + c] === anchors.T[k * G + c] && anchors.P[k * G + c] === anchors.P[k * G + c];
        if (!ok) continue;
        for (let k = 0; k < K; k++) pt[k] = tf.fwd(anchors.P[k * G + c] * o.precipScale, 5);
        for (let m = 0; m < 12; m++) {
            let t = 0, p = 0;
            for (let k = 0; k < K; k++) { const w = M[m * K + k]; t += w * anchors.T[k * G + c]; p += w * pt[k]; }
            T[m * G + c] = t; P[m * G + c] = tf.inv(p, 5);
        }
    }
    return { T, P };
}

// ── 5 ─────────────────────────────────────────────────────────────────────────
/**
 * Terrain-cell finishing. Temperature is reduced to sea level on the grid (T + Γ·h_ref), interpolated, then lifted to
 * the cell's own height (− Γ·h): mountains colder than their grid cell, valleys warmer. Rain is interpolated as is
 * (upslope rain comes with the rain stage). Grid cells without data (e.g. land-only observations over the sea) are
 * filled from the nearest grid cell that has data. Only land cells are classified; the sea gets class 0.
 */
function finishCells(grid, surface, months, lat, lon, elevKm, land, o) {
    const G = grid.size, n = lat.length, w = grid.w, h = grid.h, gamma = o.lapseRateCPerKm;
    // sea-level-reduced temperature and rain, with gaps filled
    const valid = new Uint8Array(G);
    for (let c = 0; c < G; c++) valid[c] = months.T[c] === months.T[c] ? 1 : 0;
    const redirect = nearestValid(grid, valid);
    const Tsl = new Float32Array(12 * G), P = new Float32Array(12 * G);
    for (let c = 0; c < G; c++) {
        const s = redirect[c];
        if (s < 0) continue;
        const href = surface.meanLandKm[s] === surface.meanLandKm[s] ? Math.max(0, surface.meanLandKm[s]) : 0;
        for (let m = 0; m < 12; m++) { Tsl[m * G + c] = months.T[m * G + s] + gamma * href; P[m * G + c] = months.P[m * G + s]; }
    }

    const koppen = new Uint8Array(n);
    const tAnnual = new Float32Array(n).fill(NaN), pAnnual = new Float32Array(n).fill(NaN);
    const T12 = new Float64Array(12), P12 = new Float64Array(12);
    const step = grid.step;
    for (let r = 0; r < n; r++) {
        if (!land[r]) continue;
        const x = (lon[r] + 180) / step - 0.5, y = Math.max(0, Math.min(h - 1, (90 - lat[r]) / step - 0.5));
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        const i0 = ((x0 % w) + w) % w, i1 = i0 + 1 === w ? 0 : i0 + 1;
        const j1 = y0 + 1 < h ? y0 + 1 : y0;
        const c00 = y0 * w + i0, c10 = y0 * w + i1, c01 = j1 * w + i0, c11 = j1 * w + i1;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const hc = Math.max(0, elevKm[r]);
        let ts = 0, ps = 0;
        for (let m = 0, off = 0; m < 12; m++, off += G) {
            const t = w00 * Tsl[off + c00] + w10 * Tsl[off + c10] + w01 * Tsl[off + c01] + w11 * Tsl[off + c11] - gamma * hc;
            const p = w00 * P[off + c00] + w10 * P[off + c10] + w01 * P[off + c01] + w11 * P[off + c11];
            T12[m] = t; P12[m] = p; ts += t; ps += p;
        }
        if (!(ts === ts)) continue;                       // no data anywhere near (cannot happen with global fields)
        tAnnual[r] = ts / 12; pAnnual[r] = ps;
        koppen[r] = classifyCell(T12, P12);
    }
    return { koppen, tAnnual, pAnnual, lat, lon };
}

/** Breadth-first fill over the grid (longitude wraps): each cell → the nearest cell with valid[c] (−1 if none). */
function nearestValid(grid, valid) {
    const G = grid.size, w = grid.w, h = grid.h;
    const out = new Int32Array(G).fill(-1), queue = new Int32Array(G);
    let head = 0, tail = 0;
    for (let c = 0; c < G; c++) if (valid[c]) { out[c] = c; queue[tail++] = c; }
    while (head < tail) {
        const c = queue[head++], i = c % w, j = (c - i) / w;
        const nb = [j * w + (i + 1) % w, j * w + (i - 1 + w) % w, j > 0 ? c - w : -1, j < h - 1 ? c + w : -1];
        for (const d of nb) if (d >= 0 && out[d] < 0) { out[d] = out[c]; queue[tail++] = d; }
    }
    return out;
}

// ── Anchor sources ────────────────────────────────────────────────────────────
/**
 * Real Earth as the anchor source: monthly fields on the same grid (12 layers each, °C and mm/month, NaN = none),
 * read at the anchor months (fractional months interpolated linearly). The oracle run.
 */
export function observedAnchors(monthlyT, monthlyP) {
    return ({ grid, anchorMonths }) => {
        const G = grid.size, K = anchorMonths.length;
        const T = new Float32Array(K * G), P = new Float32Array(K * G);
        anchorMonths.forEach((mf, k) => {
            const m0 = Math.floor(mf), f = mf - m0, a = ((m0 % 12) + 12) % 12, b = (a + 1) % 12;
            for (let c = 0; c < G; c++) {
                T[k * G + c] = (1 - f) * monthlyT[a * G + c] + (f ? f * monthlyT[b * G + c] : 0);
                P[k * G + c] = (1 - f) * monthlyP[a * G + c] + (f ? f * monthlyP[b * G + c] : 0);
            }
        });
        return { T, P };
    };
}
