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
    const T = seasons(Tsl, G), P = seasons(months.P, G);
    const circ = stages.circulation, ocean = stages.ocean;
    const slp = seasons(circ.slp, G), u = seasons(circ.u, G), v = seasons(circ.v, G);
    const sea = new Uint8Array(G);
    for (let c = 0; c < G; c++) sea[c] = ocean.seaMask[c] > 0.5 ? 1 : 0;
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
    const sstAnom = { year: anomOf(T.year), jan: anomOf(T.jan), jul: anomOf(T.jul) };
    // (the year's currents in every season where the ocean has none: an older climate, or seasons turned off)
    const currentU = ocean.monthly ? seasons(ocean.monthly.u, G) : { year: Float32Array.from(ocean.u), jan: Float32Array.from(ocean.u), jul: Float32Array.from(ocean.u) };
    const currentV = ocean.monthly ? seasons(ocean.monthly.v, G) : { year: Float32Array.from(ocean.v), jan: Float32Array.from(ocean.v), jul: Float32Array.from(ocean.v) };
    const seaIce = seasons(stages.temperature.seaIce, G), ice = seaIce.year;
    const upwelling = ocean.monthly?.upwelling ? seasons(ocean.monthly.upwelling, G)
        : { year: Float32Array.from(ocean.upwelling), jan: Float32Array.from(ocean.upwelling), jul: Float32Array.from(ocean.upwelling) };
    const orographic = Float32Array.from(stages.rain.orographic ?? new Float32Array(G).fill(1));
    const iceSheet = new Float32Array(G), domeKm = PARAMS.TEMP_ICE_DOME_KM || 1, dome = stages.temperature.domeKm;
    if (dome) for (let c = 0; c < G; c++) iceSheet[c] = Math.max(0, Math.min(1, dome[c] / domeKm));
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
