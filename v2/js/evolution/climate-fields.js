// What the Evolution page draws of a moment's climate (v2/js/climate/), reduced from the climate's result — shared by the
// climate worker (the live terrain's climate) and the finishing worker (a finished moment's, at its own detail):
//   per terrain cell  koppen (Köppen id, v2/js/climate/koppen.js), tAnnual (°C), pAnnual (mm/year) — land only;
//   on the 1° grid (360 × 180, rows north → south, columns west → east from −179.5°), each for the year and for
//   January and July: T (°C at sea level), P (mm/month), slp (hPa), u and v (wind, m/s), currentU and currentV (surface
//   currents, m/s — seasonal in the tropics, ocean.js), sstAnom (sea temperature minus its latitude's sea average, °C),
//   seaIce (sea-ice fraction), upwelling (m/day); and sea (1 = sea), ice (the year's sea ice), orographic (the year's
//   rain with the mountains over it without them), iceSheet (0–1: the ice sheets' domes), itcz (per 1° of longitude,
//   the ITCZ's latitude — year, January, July).

import { CORE_DEFAULTS } from '../climate/core.js';
import { PARAMS } from '../climate/config.js';

// What the pages draw is smoothed for the eye (the physics, Köppen and each land cell's own values are not): the climate
// is solved on a 3° grid and refined linearly, so a field's contours are polygons with 3° sides — wedges near the poles,
// where the grid's cells close in — and the sea's own quantities are zero on the grid's land cells, so every coast's sea
// shaded toward them (a rim of open water along icy coasts). Each field is carried a few cells across the coast from its
// own side, then blurred by a distance on the ground (so over more of a row's cells near the poles).
const BLUR_DEG = 1.5;           // σ of the blur, degrees of arc on the ground
const FILL_RINGS = 4;           // grid cells a field is carried across the coast

/** Which cells a fill sets, ring by ring, and from which neighbours — worked out once per mask (`valid` 1: the field's
 *  own side of the coast): {cells, from (offsets into nb), nb}. */
function fillPlan(valid, w, h, rings = FILL_RINGS) {
    let have = Uint8Array.from(valid, v => (v ? 1 : 0));
    const cells = [], from = [0], nb = [];
    for (let it = 0; it < rings; it++) {
        const next = have.slice();
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            const c = j * w + i;
            if (have[c]) continue;
            const W = j * w + (i === 0 ? w - 1 : i - 1), E = j * w + (i === w - 1 ? 0 : i + 1), k0 = nb.length;
            if (have[W]) nb.push(W);
            if (have[E]) nb.push(E);
            if (j > 0 && have[c - w]) nb.push(c - w);
            if (j < h - 1 && have[c + w]) nb.push(c + w);
            if (nb.length > k0) { cells.push(c); from.push(nb.length); next[c] = 1; }
        }
        have = next;
    }
    return { cells: Int32Array.from(cells), from: Int32Array.from(from), nb: Int32Array.from(nb) };
}
/** A field carried across the coast by a fill plan: each cell the plan sets takes its neighbours' mean, in order. */
function fillAcross(f, plan) {
    const { cells, from, nb } = plan;
    for (let q = 0; q < cells.length; q++) {
        let s = 0;
        for (let k = from[q]; k < from[q + 1]; k++) s += f[nb[k]];
        f[cells[q]] = s / (from[q + 1] - from[q]);
    }
    return f;
}

// (working rows, reused: a pass reads a line into `line`, padded r on each side, and writes the running mean back)
let line = new Float64Array(0);
/** One box pass of half-width r over n values of f from `start`, `stride` apart — the line wrapping (a row) or held at
 *  its ends (a column). */
function boxPass(f, n, stride, start, r, wrap) {
    if (r <= 0) return;
    if (wrap && 2 * r + 1 >= n) {
        let s = 0;
        for (let t = 0, o = start; t < n; t++, o += stride) s += f[o];
        s /= n;
        for (let t = 0, o = start; t < n; t++, o += stride) f[o] = s;
        return;
    }
    const len = n + 2 * r;
    if (line.length < len) line = new Float64Array(len);
    for (let t = -r; t < n + r; t++) {
        const q = wrap ? (t < 0 ? t + n : t >= n ? t - n : t) : (t < 0 ? 0 : t >= n ? n - 1 : t);
        line[t + r] = f[start + q * stride];
    }
    const k = 1 / (2 * r + 1);
    let s = 0;
    for (let t = 0; t < 2 * r + 1; t++) s += line[t];
    for (let t = 0, o = start; t < n; t++, o += stride) {
        f[o] = s * k;
        if (t + 1 < n) s += line[t + 2 * r + 1] - line[t];
    }
}
/** A w × h lat-lon field (rows north → south) blurred by about `sigmaDeg` of arc in every direction: three box passes
 *  (half-width r: σ² = r(r + 1)) along each row — wider where a row's cells are narrower — then along each column. A
 *  field with gaps (NaN) is left as it is. */
function sphereBlur(f, w, h, sigmaDeg = BLUR_DEG) {
    for (let c = 0; c < w * h; c++) if (f[c] !== f[c]) return f;
    const step = 180 / h;
    const half = (sigCells) => Math.max(0, Math.round((-1 + Math.sqrt(1 + 4 * sigCells * sigCells)) / 2));
    for (let j = 0; j < h; j++) {
        const cl = Math.cos((90 - (j + 0.5) * step) * Math.PI / 180), r = half(sigmaDeg / (step * Math.max(1e-3, cl)));
        for (let p = 0; p < 3; p++) boxPass(f, w, 1, j * w, r, true);
    }
    const rc = half(sigmaDeg / step);
    for (let p = 0; p < 3; p++) columnPass(f, w, h, rc);
    return f;
}
// (a copy of the field and the columns' running sums, reused)
let colSrc = new Float64Array(0), colSum = new Float64Array(0);
/** One box pass of half-width r down every column at once (row by row, as the field lies in memory), held at the ends. */
function columnPass(f, w, h, r) {
    if (r <= 0) return;
    if (colSrc.length < w * h) colSrc = new Float64Array(w * h);
    if (colSum.length < w) colSum = new Float64Array(w);
    for (let c = 0; c < w * h; c++) colSrc[c] = f[c];
    colSum.fill(0, 0, w);
    for (let t = -r; t <= r; t++) { const o = (t < 0 ? 0 : t >= h ? h - 1 : t) * w; for (let i = 0; i < w; i++) colSum[i] += colSrc[o + i]; }
    const k = 1 / (2 * r + 1);
    for (let j = 0; j < h; j++) {
        const o = j * w;
        for (let i = 0; i < w; i++) f[o + i] = colSum[i] * k;
        const add = Math.min(h - 1, j + r + 1) * w, sub = Math.max(0, j - r) * w;
        for (let i = 0; i < w; i++) colSum[i] += colSrc[add + i] - colSrc[sub + i];
    }
}
/** A field's seasons, each carried across the coast by a fill plan (or not) and blurred. */
function smoothSeasons(S, w, h, plan = null) {
    for (const k of ['year', 'jan', 'jul']) { if (plan) fillAcross(S[k], plan); sphereBlur(S[k], w, h); }
    return S;
}

/** Year (the mean of the twelve months), January (month 0) and July (month 6) of a 12 × G field. */
function seasons(all, G) {
    const year = new Float32Array(G);
    for (let m = 0; m < 12; m++) for (let c = 0; c < G; c++) year[c] += all[m * G + c] / 12;
    return { year, jan: all.slice(0, G), jul: all.slice(6 * G, 7 * G) };
}

/** The page's climate from planetClimate's result (`cells`: false — the grid's fields only). */
export function pageClimate(res, { cells = true } = {}) {
    const { grid, months, surface, stages, cell } = res, G = grid.size, w = grid.w, h = grid.h;
    // (temperature at sea level, as the climate itself reduces it: the grid's is at its land's mean height)
    const gamma = CORE_DEFAULTS.lapseRateCPerKm, Tsl = new Float32Array(12 * G);
    for (let c = 0; c < G; c++) {
        const href = surface.meanLandKm[c] === surface.meanLandKm[c] ? Math.max(0, surface.meanLandKm[c]) : 0;
        for (let m = 0; m < 12; m++) Tsl[m * G + c] = months.T[m * G + c] + gamma * href;
    }
    const circ = stages.circulation, ocean = stages.ocean;
    const sea = new Uint8Array(G), land = new Uint8Array(G);
    for (let c = 0; c < G; c++) { sea[c] = ocean.seaMask[c] > 0.5 ? 1 : 0; land[c] = 1 - sea[c]; }
    const fromSea = fillPlan(sea, w, h), fromLand = fillPlan(land, w, h);
    // (temperature and rain on both sides of a coast, as the climate has them; the winds and pressure too)
    const Traw = seasons(Tsl, G), P = smoothSeasons(seasons(months.P, G), w, h);
    const slp = smoothSeasons(seasons(circ.slp, G), w, h), u = smoothSeasons(seasons(circ.u, G), w, h), v = smoothSeasons(seasons(circ.v, G), w, h);
    // the sea's warm and cold currents: its temperature against the average of the sea at its latitude, each season
    const anomOf = (Tf) => {
        const a = new Float32Array(G);
        for (let j = 0; j < h; j++) {
            let s = 0, k = 0;
            for (let i = 0; i < w; i++) { const c = j * w + i; if (sea[c] && Tf[c] === Tf[c]) { s += Tf[c]; k++; } }
            const mean = k ? s / k : 0;
            for (let i = 0; i < w; i++) { const c = j * w + i; a[c] = sea[c] ? Tf[c] - mean : 0; }
        }
        return a;
    };
    // (from the sea's own temperatures — before the blur reaches across the coast)
    const sstAnom = smoothSeasons({ year: anomOf(Traw.year), jan: anomOf(Traw.jan), jul: anomOf(Traw.jul) }, w, h, fromSea);
    const T = smoothSeasons(Traw, w, h);
    // (the sea's own: carried from the sea across the coast — the arrows are drawn over the sea only, by `sea`; the year's
    // currents in every season where the ocean has none: an older climate, or seasons turned off)
    const currentU = smoothSeasons(ocean.monthly ? seasons(ocean.monthly.u, G) : { year: Float32Array.from(ocean.u), jan: Float32Array.from(ocean.u), jul: Float32Array.from(ocean.u) }, w, h, fromSea);
    const currentV = smoothSeasons(ocean.monthly ? seasons(ocean.monthly.v, G) : { year: Float32Array.from(ocean.v), jan: Float32Array.from(ocean.v), jul: Float32Array.from(ocean.v) }, w, h, fromSea);
    const seaIce = smoothSeasons(seasons(stages.temperature.seaIceOpen ?? stages.temperature.seaIce, G), w, h, fromSea), ice = seaIce.year;
    const upwelling = smoothSeasons(ocean.monthly?.upwelling ? seasons(ocean.monthly.upwelling, G)
        : { year: Float32Array.from(ocean.upwelling), jan: Float32Array.from(ocean.upwelling), jul: Float32Array.from(ocean.upwelling) }, w, h, fromSea);
    // (the land's own: carried from the land across the coast)
    const orographic = sphereBlur(fillAcross(Float32Array.from(stages.rain.orographic ?? new Float32Array(G).fill(1)), fromLand), w, h);
    const iceSheet = new Float32Array(G), domeKm = PARAMS.TEMP_ICE_DOME_KM || 1, dome = stages.temperature.domeKm;
    if (dome) for (let c = 0; c < G; c++) iceSheet[c] = Math.max(0, Math.min(1, dome[c] / domeKm));
    sphereBlur(fillAcross(iceSheet, fromLand), w, h);
    const itcz = seasons(circ.itczLat, w);
    return {
        grid: { w, h },
        ...(cells ? { cell: { koppen: cell.koppen, tAnnual: cell.tAnnual, pAnnual: cell.pAnnual } } : {}),
        T, P, slp, u, v,
        currentU, currentV, sea, sstAnom, ice, seaIce,
        upwelling, orographic, iceSheet, itcz,
    };
}

/** The buffers of the page's climate to hand over (its cells' and its raster's too, where it has them). */
export function climateTransfers(out) {
    const list = [out.sea.buffer, out.ice.buffer, out.orographic.buffer, out.iceSheet.buffer];
    if (out.cell) list.push(out.cell.koppen.buffer, out.cell.tAnnual.buffer, out.cell.pAnnual.buffer);
    if (out.cell?.stats) for (const a of Object.values(out.cell.stats)) list.push(a.buffer);
    if (out.raster?.stats) for (const a of Object.values(out.raster.stats)) list.push(a.buffer);
    if (out.raster) list.push(out.raster.koppen.buffer, out.raster.tAnnual.buffer, out.raster.pAnnual.buffer);
    if (out.raster?.sat) list.push(out.raster.sat.year.buffer, out.raster.sat.jan.buffer, out.raster.sat.jul.buffer, out.raster.cover.buffer);
    for (const f of [out.T, out.P, out.slp, out.u, out.v, out.seaIce, out.currentU, out.currentV, out.sstAnom, out.upwelling, out.itcz]) list.push(f.year.buffer, f.jan.buffer, f.jul.buffer);
    return [...new Set(list)];
}
