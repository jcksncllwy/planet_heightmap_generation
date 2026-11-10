// The Evolution page's climate worker (step D): the new climate (v2/js/climate/) for one moment of the history, off the
// page's thread — on request only (developer: "we dont need climate on every moment. It takes way too long"). It is
// computed on a fixed 1° grid, so it takes about the same time at every terrain detail (~1 s on a desktop).
//
// Messages in:  {type: 'mesh', key, xyz}                 a terrain mesh's unit-sphere positions (z north), once per mesh
//               {type: 'climate', id, key, heightKm, options}  a frame's terrain heights (km, the sea at 0) on that mesh;
//                                                         options: the page's Greenhouse / Precipitation (greenhouseWm2, precipScale)
//               {type: 'water', id, key, heightKm, options}    the same frame's climate at WATER_GRID_DEG, for its water only
// Message out:  {type: 'climate', id, data} | {type: 'error', id, message} — only what the page draws, handed over
//   (climate-fields.js; data.cell.stats: the land cells' tRange, aridity, growing, rainSeason — cell-stats.js bytes;
//   data.water: each cell's year of rain, potential evaporation and runoff — terrain/climate-water.js — for the cut-off
//   seas' balance, basin-estimate.js); for 'water', data is that water alone ({rain, pet, runoff, gridDeg, ms}).

import { planetClimate } from '../climate/climate.js';
import { pageClimate, climateTransfers } from './climate-fields.js';
import { cellStatsCollector } from '../climate/cell-stats.js';
import { climateWater, climateWaterTransfers } from '../terrain/climate-water.js';

// The grid a frame's climate is computed on for its cut-off seas alone (the real-climate balance, 2026-11-10): 2°, the
// coarsest the climate runs well on — 1.5–1.8 s in a Chrome worker against 3.3–4.2 s at 1° (handoff-2, the cutoff lane).
// A sea it balances is ≥ 1 Mkm² (basin-estimate.js CLIMATE_MIN_KM2), ≥ 25 of its 2° cells at the equator: a 2° grid
// resolves its rain and its catchment's.
const WATER_GRID_DEG = 2;

const meshes = new Map();

self.onmessage = ({ data }) => {
    if (data.type === 'mesh') { meshes.set(data.key, data.xyz); return; }
    if (data.type !== 'climate' && data.type !== 'water') return;
    const { id, key, heightKm, options = {} } = data;
    try {
        const t0 = performance.now();
        if (data.type === 'water') {
            const res = planetClimate({ xyz: meshes.get(key), elevKm: heightKm, axes: 'z-up' }, { ...options, gridStepDeg: WATER_GRID_DEG });
            const water = climateWater(res, heightKm);
            water.ms = performance.now() - t0;
            self.postMessage({ type: 'climate', id, data: water }, climateWaterTransfers(water));
            return;
        }
        // (and each land cell's measures beyond Köppen, from its twelve months — cell-stats.js — one byte each)
        const xyz = meshes.get(key), stats = cellStatsCollector(heightKm.length, c => Math.asin(Math.max(-1, Math.min(1, xyz[3 * c + 2]))), { bytes: true });
        const res = planetClimate({ xyz, elevKm: heightKm, axes: 'z-up' }, { ...options, onCell: stats.add });
        const out = pageClimate(res);
        out.cell.stats = stats.stats;
        out.water = climateWater(res, heightKm);
        out.ms = performance.now() - t0;
        self.postMessage({ type: 'climate', id, data: out }, [...climateTransfers(out), ...climateWaterTransfers(out.water)]);
    } catch (err) {
        self.postMessage({ type: 'error', id, message: err?.stack ?? String(err) });
    }
};
