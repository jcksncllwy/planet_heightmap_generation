// The Evolution page's climate worker (step D): the new climate (v2/js/climate/) for one moment of the history, off the
// page's thread — on request only (developer: "we dont need climate on every moment. It takes way too long"). It is
// computed on a fixed 1° grid, so it takes about the same time at every terrain detail (~1 s on a desktop).
//
// Messages in:  {type: 'mesh', key, xyz}                 a terrain mesh's unit-sphere positions (z north), once per mesh
//               {type: 'climate', id, key, heightKm}      a frame's terrain heights (km, the sea at 0) on that mesh
// Message out:  {type: 'climate', id, data} | {type: 'error', id, message} — only what the page draws, handed over:
//   per terrain cell  koppen (Köppen id, v2/js/climate/koppen.js), tAnnual (°C), pAnnual (mm/year) — land only;
//   on the 1° grid (360 × 180, rows north → south, columns west → east from −179.5°), each for the year and for
//   January and July: T (°C at sea level), P (mm/month), slp (hPa), u and v (wind, m/s); annual: currentU, currentV
//   (surface currents, m/s), sea (1 = sea), sstAnom (sea temperature minus its latitude's sea average, °C), ice (sea-ice
//   fraction, the year's mean).

import { planetClimate } from '../climate/climate.js';
import { CORE_DEFAULTS } from '../climate/core.js';

const meshes = new Map();

self.onmessage = ({ data }) => {
    if (data.type === 'mesh') { meshes.set(data.key, data.xyz); return; }
    if (data.type !== 'climate') return;
    const { id, key, heightKm } = data;
    try {
        const t0 = performance.now();
        const res = planetClimate({ xyz: meshes.get(key), elevKm: heightKm, axes: 'z-up' });
        const out = reduce(res);
        out.ms = performance.now() - t0;
        self.postMessage({ type: 'climate', id, data: out }, transferables(out));
    } catch (err) {
        self.postMessage({ type: 'error', id, message: err?.stack ?? String(err) });
    }
};

/** Year (the mean of the twelve months), January (month 0) and July (month 6) of a 12 × G field. */
function seasons(all, G) {
    const year = new Float32Array(G);
    for (let m = 0; m < 12; m++) for (let c = 0; c < G; c++) year[c] += all[m * G + c] / 12;
    return { year, jan: all.slice(0, G), jul: all.slice(6 * G, 7 * G) };
}

function reduce(res) {
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
    // the sea's warm and cold currents: its temperature against the average of the sea at its latitude
    const sstAnom = new Float32Array(G);
    for (let j = 0; j < h; j++) {
        let s = 0, k = 0;
        for (let i = 0; i < w; i++) { const c = j * w + i; if (sea[c] && T.year[c] === T.year[c]) { s += T.year[c]; k++; } }
        const mean = k ? s / k : 0;
        for (let i = 0; i < w; i++) { const c = j * w + i; sstAnom[c] = sea[c] ? T.year[c] - mean : 0; }
    }
    const ice = seasons(stages.temperature.seaIce, G).year;
    return {
        grid: { w, h },
        cell: { koppen: cell.koppen, tAnnual: cell.tAnnual, pAnnual: cell.pAnnual },
        T, P, slp, u, v,
        currentU: Float32Array.from(ocean.u), currentV: Float32Array.from(ocean.v), sea, sstAnom, ice,
    };
}

function transferables(out) {
    const list = [out.cell.koppen.buffer, out.cell.tAnnual.buffer, out.cell.pAnnual.buffer, out.currentU.buffer, out.currentV.buffer, out.sea.buffer, out.sstAnom.buffer, out.ice.buffer];
    for (const f of [out.T, out.P, out.slp, out.u, out.v]) list.push(f.year.buffer, f.jan.buffer, f.jul.buffer);
    return [...new Set(list)];
}
