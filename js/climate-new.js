// The new climate (v2/js/climate/) for Generate and Import — plans/V1_NEW_CLIMATE_PLAN.md. DOM-free: runs in the
// planet worker. One call: the planet's mesh positions and elevations, and the Temperature / Precipitation sliders, in;
// what the pages draw out:
//
//   koppen   per region (Uint8, the same 31 classes as js/koppen.js) — the Climate tab, Satellite, exports
//   cells    per land region (Float32; NaN at sea): t (°C) and p (mm/month) for the year, January and July; tRange
//            (warmest − coldest month, °C), aridity (P / PET, UNEP), growing (months above 10 °C), rainSeason (Walsh's
//            seasonality index) — each from the region's own twelve months, at its own height
//   grid     the 1° climate (360 × 180, rows north → south, columns from −179.5°), for the sea and the vectors: T (°C at
//            sea level), P, slp (hPa), u / v (wind, m/s), currentU / currentV (m/s), sstAnom (°C), seaIce (0–1) — each
//            {year, jan, jul}; upwelling {year, jan, jul} (m/day); orographic (the mountains' share of the rain);
//            iceSheet (0–1); sea (1 = sea); itcz {jan, jul, year} (latitude per 1° of longitude)
//
// The grid is sampled per region by the pages (js/climate-layers.js) only for the layer shown, so the worker hands over
// a few MB of grid instead of a dozen arrays per region.

import { planetClimate } from '../v2/js/climate/climate.js';
import { pageClimate } from '../v2/js/evolution/climate-fields.js';
import { PARAMS } from '../v2/js/climate/config.js';
import { elevToHeightKm } from './color-map.js';

const DEG = Math.PI / 180;

/** Year (the months' mean), January and July of a 12 × G field. */
function seasonsOf(all, G) {
    const year = new Float32Array(G);
    for (let m = 0; m < 12; m++) for (let c = 0; c < G; c++) year[c] += all[m * G + c] / 12;
    return { year, jan: all.slice(0, G), jul: all.slice(6 * G, 7 * G) };
}

/** Hours of daylight at a latitude (radians) on the middle of month m (Thornthwaite's day-length correction). */
function dayHours(latRad, m) {
    const doy = 15 + 30.44 * m, decl = 23.44 * DEG * Math.sin(2 * Math.PI * (doy - 81) / 365);
    const x = -Math.tan(latRad) * Math.tan(decl);
    return x <= -1 ? 24 : x >= 1 ? 0 : 24 * Math.acos(x) / Math.PI;
}

/**
 * Run the new climate on a V1 planet.
 * @param {Float32Array} r_xyz       unit-sphere positions, Y-up (as V1's meshes)
 * @param {Float32Array} r_elevation V1's elevation (≤ 0 sea)
 * @param {{temperatureOffset?: number, precipitationOffset?: number}} sliders  °C; −1…1 (±50 % rain)
 */
export function runNewClimate(r_xyz, r_elevation, { temperatureOffset = 0, precipitationOffset = 0 } = {}) {
    const t0 = performance.now();
    const n = r_elevation.length;
    const elevKm = new Float32Array(n), land = new Uint8Array(n);
    for (let r = 0; r < n; r++) { elevKm[r] = elevToHeightKm(r_elevation[r]); land[r] = r_elevation[r] > 0 ? 1 : 0; }

    // per land region, from its twelve months
    const nan = () => new Float32Array(n).fill(NaN);
    const cells = { t: { year: nan(), jan: nan(), jul: nan() }, p: { year: nan(), jan: nan(), jul: nan() },
        tRange: nan(), aridity: nan(), growing: nan(), rainSeason: nan() };
    const onCell = (r, T12, P12) => {
        let tMin = Infinity, tMax = -Infinity, pSum = 0, grow = 0, I = 0;
        for (let m = 0; m < 12; m++) {
            const t = T12[m];
            if (t < tMin) tMin = t; if (t > tMax) tMax = t;
            pSum += P12[m];
            if (t > 10) grow++;
            if (t > 0) I += Math.pow(t / 5, 1.514);
        }
        cells.t.year[r] = (T12.reduce((a, b) => a + b, 0)) / 12; cells.t.jan[r] = T12[0]; cells.t.jul[r] = T12[6];
        cells.p.year[r] = pSum / 12; cells.p.jan[r] = P12[0]; cells.p.jul[r] = P12[6];
        cells.tRange[r] = tMax - tMin;
        cells.growing[r] = grow;
        // Walsh & Lawler's seasonality index: Σ|month − year/12| / year (0 even … ≥ 1.2 almost all in a month or two)
        let si = 0;
        if (pSum > 0) { for (let m = 0; m < 12; m++) si += Math.abs(P12[m] - pSum / 12); si /= pSum; }
        cells.rainSeason[r] = si;
        // aridity index: P / PET, PET by Thornthwaite with the day-length correction
        const lat = Math.asin(Math.max(-1, Math.min(1, r_xyz[3 * r + 1])));
        const a = 6.75e-7 * I * I * I - 7.71e-5 * I * I + 1.792e-2 * I + 0.49239;
        let pet = 0;
        for (let m = 0; m < 12; m++) {
            const t = T12[m];
            if (t <= 0) continue;
            const raw = t >= 26.5 ? -415.85 + 32.24 * t - 0.43 * t * t : I > 0 ? 16 * Math.pow(10 * t / I, a) : 0;
            pet += raw * (dayHours(lat, m) / 12) * (30.44 / 30);
        }
        cells.aridity[r] = pet > 0 ? pSum / pet : (pSum > 0 ? 9.99 : 0);
    };

    const res = planetClimate({ xyz: r_xyz, elevKm, land, axes: 'y-up' },
        { tempOffsetC: temperatureOffset, precipScale: Math.max(0, 1 + 0.5 * precipitationOffset), onCell });
    const tClimate = performance.now() - t0;

    // the grid, as Evolution's views have it, plus what Generate and Import show besides
    const pc = pageClimate(res, { cells: false });
    const G = res.grid.size, w = res.grid.w, ocean = res.stages.ocean, temp = res.stages.temperature;
    const upwelling = ocean.monthly?.upwelling ? seasonsOf(ocean.monthly.upwelling, G)
        : { year: Float32Array.from(ocean.upwelling), jan: Float32Array.from(ocean.upwelling), jul: Float32Array.from(ocean.upwelling) };
    const iceSheet = new Float32Array(G);
    const domeKm = PARAMS.TEMP_ICE_DOME_KM || 1;
    if (temp.domeKm) for (let c = 0; c < G; c++) iceSheet[c] = Math.max(0, Math.min(1, temp.domeKm[c] / domeKm));
    const itczAll = res.stages.circulation.itczLat, itcz = { year: new Float32Array(w), jan: itczAll.slice(0, w), jul: itczAll.slice(6 * w, 7 * w) };
    for (let m = 0; m < 12; m++) for (let i = 0; i < w; i++) itcz.year[i] += itczAll[m * w + i] / 12;
    const grid = {
        w, h: res.grid.h, step: res.grid.step,
        T: pc.T, P: pc.P, slp: pc.slp, u: pc.u, v: pc.v, currentU: pc.currentU, currentV: pc.currentV, sstAnom: pc.sstAnom, seaIce: pc.seaIce,
        upwelling, orographic: Float32Array.from(res.stages.rain.orographic ?? new Float32Array(G).fill(1)), iceSheet, sea: pc.sea, itcz,
    };
    return { koppen: res.cell.koppen, cells, grid, timing: { climate: tClimate, total: performance.now() - t0, stages: res.timing } };
}

/** The buffers of runNewClimate's result, for postMessage's transfer list. */
export function newClimateTransfers(C) {
    const list = [C.koppen.buffer, C.cells.tRange.buffer, C.cells.aridity.buffer, C.cells.growing.buffer, C.cells.rainSeason.buffer,
        C.grid.orographic.buffer, C.grid.iceSheet.buffer, C.grid.sea.buffer];
    for (const f of [C.cells.t, C.cells.p, C.grid.T, C.grid.P, C.grid.slp, C.grid.u, C.grid.v, C.grid.currentU, C.grid.currentV, C.grid.sstAnom, C.grid.seaIce, C.grid.upwelling, C.grid.itcz])
        list.push(f.year.buffer, f.jan.buffer, f.jul.buffer);
    return [...new Set(list)];
}
