// The Evolution page's climate (step D): the new climate (v2/js/climate/) for the moment shown, on request only — a
// "Calculate Climate" button, never automatic, never per frame (developer: "it takes way too long") — computed in a
// worker (climate-worker.js), kept per moment while the history is open, and drawn as layers: Köppen (per terrain
// cell), Temperature and Rain (Year / January / July), Wind (its speed and arrows) and Currents (the sea's warm and cold
// water and its surface currents) — and Generate's other Inspect layers (js/climate-layers.js: their colours and
// legends): Pressure (with the winds and the ITCZ), Upwelling, Ice, Temperature Range, Rain Shadow, Aridity, Growing
// Season, Rain Seasonality — each shaded by the relief, as the Plates tab is.

import { KOPPEN_CLASSES } from '../climate/koppen.js';
import { BIOME_WORDS } from '../finish/finish-cover.js';
import { rampColor, VIEW_RAMPS, SEA_UNDER_LAND, drawLegendBar } from '../climate-lab/palettes.js';
import { cubicLonLat, layerIsoline, isolineCoverage, ISOLINES, blurRaster, highsAndLows } from './climate-isolines.js';
import { carriedOf } from './climate-carried.js';
import { statValue } from '../climate/cell-stats.js';
import { FastNoise } from '../core/fast-noise.js';
import { styledSatellite, SAT_SHADE } from './sat-style.js';
import { QUANTITY_COLORS, ICE_SHEET_RGB, SNOW_RGB, climateLegendHTML, classLabel, KOPPEN_GROUPS, koppenGroupOf, windText, currentText, carriedText, rainYearText } from '../../../js/climate-layers.js';

/** The land's measures beyond Köppen (cell-stats.js), per cell or per pixel of a finished moment's picture. */
// (the page's layer id → cell-stats.js's key: the Temperature Range layer is 'tempRange', its measure 'tRange'; both taken)
const STAT_KEY = { tempRange: 'tRange', tRange: 'tRange', aridity: 'aridity', growing: 'growing', rainSeason: 'rainSeason' };
const STAT_LAYERS = new Set(Object.keys(STAT_KEY));
export const CLIMATE_LAYERS = new Set(['satellite', 'koppen', 'temperature', 'rain', 'wind', 'currents',
    'pressure', 'upwelling', 'ice', 'tempRange', 'rainShadow', 'aridity', 'growing', 'rainSeason']);
export const SEASONAL_LAYERS = new Set(['satellite', 'temperature', 'rain', 'wind', 'currents', 'pressure', 'upwelling', 'ice']);
/** The layers drawn with moving particles (climate-flow.js FlowLayer), and which flow: the winds or the currents. */
export const FLOW_LAYERS = { wind: 'wind', currents: 'currents' };
/** The layers with lines over their colours (the overlay: isolines, H and L, the ITCZ, upwelling, the ice edge, coasts). */
export const LINE_LAYERS = new Set(['temperature', 'rain', 'pressure', 'wind', 'currents']);
/** The land's questions: their sea flat and dark (SEA_UNDER_LAND), so the coast is the strongest edge and a dry coast
 *  shows dry (report §2.3); their land under a soft relief. */
const LAND_LAYERS = new Set(['rain', 'aridity', 'tempRange', 'growing', 'rainSeason', 'rainShadow']);

// ── the view's options, set in the legend card (the isolines and the like) and Köppen's opened group ──
/** On/off per line kind: `iso` (isotherms, isohyets), `pIso` (the Pressure layer's isobars, on at first: they are its
 *  picture), `isobars` (over the wind), `itcz`, `upw` (upwelling), `ice` (sea ice); `group`: the
 *  Köppen group opened (0–4) or −1 (the five groups). Changed only from the legend card; `onChange` repaints. */
export const climateOptions = { iso: false, pIso: true, isobars: false, itcz: false, upw: false, ice: true, group: -1, onChange: null };
const optionChanged = () => climateOptions.onChange?.();
/** Layers only a finished moment has (its land's cover — plans/V2_SATELLITE_PLAN.md): greyed on the live timeline. */
export const FINISHED_ONLY_LAYERS = new Set(['satellite']);
export const SEASON_WORDS = { year: 'the year', jan: 'January', jul: 'July' };

// ── the worker ──
export class ClimateService {
    constructor() { this.worker = null; this.jobs = new Map(); this.sent = new Set(); this.nextId = 1; }

    /** The climate of a frame's terrain (heights in km, the sea at 0) on a terrain mesh: a promise of the page's data.
     *  `options`: the page's Greenhouse / Precipitation (greenhouseWm2, precipScale). `type` 'water': only its water, at
     *  the worker's coarser grid (climate-worker.js — the cut-off seas' balance). `land`: 1 where the world ocean does not
     *  reach (the frame's, terrain-player.js); without it the climate takes land as heights above 0. */
    compute(tMesh, heightKm, options = {}, type = 'climate', land = null) {
        this.worker ??= this.start();
        const key = tMesh.numCells;
        if (!this.sent.has(key)) { this.worker.postMessage({ type: 'mesh', key, xyz: tMesh.xyz, delaunatorUrl: import.meta.resolve('delaunator') }); this.sent.add(key); }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.jobs.set(id, { resolve, reject });
            this.worker.postMessage({ type, id, key, heightKm: Float32Array.from(heightKm), land: land ? Uint8Array.from(land) : null, options });
        });
    }

    start() {
        const w = new Worker(new URL('./climate-worker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => {
            const job = this.jobs.get(data.id);
            if (!job) return;
            this.jobs.delete(data.id);
            if (data.type === 'climate') job.resolve(data.data); else job.reject(new Error(data.message));
        };
        // a worker that dies (out of memory) answers nothing more: fail its jobs, and let the next request start a new
        // one (with the meshes sent again)
        w.onerror = e => {
            e.preventDefault?.();
            for (const job of this.jobs.values()) job.reject(new Error(e.message || 'the climate worker stopped'));
            this.jobs.clear();
            if (this.worker === w) { w.terminate(); this.worker = null; this.sent.clear(); }
        };
        return w;
    }
}

// ── where each terrain cell sits on the 1° grid (bilinear), once per terrain mesh ──
const placements = new WeakMap();
function placementOf(tMesh) {
    if (placements.has(tMesh)) return placements.get(tMesh);
    const n = tMesh.numCells, xyz = tMesh.xyz, R = 180 / Math.PI;
    const i0 = new Uint16Array(n), j0 = new Uint8Array(n), fx = new Float32Array(n), fy = new Float32Array(n), cosLat = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
        const lat = Math.asin(Math.max(-1, Math.min(1, z))) * R, lon = Math.atan2(y, x) * R;
        const gx = lon + 180 - 0.5, gy = Math.min(178.999, Math.max(0, 90 - lat - 0.5));
        const ix = Math.floor(gx);
        i0[c] = (ix + 360) % 360; fx[c] = gx - ix;
        j0[c] = Math.floor(gy); fy[c] = gy - Math.floor(gy);
        cosLat[c] = Math.cos(lat / R);
    }
    const p = { i0, j0, fx, fy, cosLat };
    placements.set(tMesh, p);
    return p;
}
/** A 360 × 180 field at terrain cell c (bilinear; longitude wraps). */
function at(field, p, c) {
    const i0 = p.i0[c], i1 = i0 === 359 ? 0 : i0 + 1, r0 = p.j0[c] * 360, r1 = r0 + 360, tx = p.fx[c], ty = p.fy[c];
    return (field[r0 + i0] * (1 - tx) + field[r0 + i1] * tx) * (1 - ty) + (field[r1 + i0] * (1 - tx) + field[r1 + i1] * tx) * ty;
}

// ── colour ramps, tabulated (the climate lab's: v2/js/climate-lab/palettes.js) ──
function table(ramp, lo, hi, n, toX = v => v, fromX = x => x) {
    const lut = new Uint8Array(3 * n), a = toX(lo), b = toX(hi);
    for (let i = 0; i < n; i++) { const c = rampColor(ramp, fromX(a + (b - a) * i / (n - 1))); lut[3 * i] = c[0]; lut[3 * i + 1] = c[1]; lut[3 * i + 2] = c[2]; }
    return { lut, n, a, b, toX };
}
let tables = null;
/** A colour function's table (climate-layers.js QUANTITY_COLORS: [r, g, b] in 0–1). */
function fnTable(fn, lo, hi, n, toX = v => v, fromX = x => x) {
    const lut = new Uint8Array(3 * n), a = toX(lo), b = toX(hi);
    for (let i = 0; i < n; i++) { const c = fn(fromX(a + (b - a) * i / (n - 1))); lut[3 * i] = 255 * c[0]; lut[3 * i + 1] = 255 * c[1]; lut[3 * i + 2] = 255 * c[2]; }
    return { lut, n, a, b, toX };
}
function lutOf(name) {
    const Q = QUANTITY_COLORS, V = VIEW_RAMPS;
    tables ??= {
        temperature: table(V.temperature, -45, 45, 721),
        // (rain in mm A YEAR, everywhere in the view: the fields' mm a month × 12)
        rain: table(V.rain, 0, 9000, 512, v => Math.log1p(Math.max(0, v)), x => Math.expm1(x)),
        pressure: table(V.pressure, 985, 1040, 551),
        sst: table(V.sstAnom, -6, 6, 241),
        wind: table(V.wind, 0, 15, 151),
        upwelling: fnTable(Q.upwelling, 0, 2, 201),
        seaIce: fnTable(Q.seaIce, 0, 1, 101),
        tRange: fnTable(Q.tRange, 0, 55, 221),
        rainShadow: fnTable(Q.rainShadow, 2 ** -1.5, 2 ** 1.5, 301, Math.log2, x => 2 ** x),
        aridity: fnTable(Q.aridity, 1e-3, 10, 801, Math.log10, x => 10 ** x),
        growing: fnTable(Q.growing, 0, 12, 121),
        rainSeason: fnTable(Q.rainSeason, 0, 1.6, 161),
    };
    return tables[name];
}
function put(out, c, T, v, k) {
    const x = T.toX(v), i = 3 * Math.max(0, Math.min(T.n - 1, Math.round((x - T.a) / (T.b - T.a) * (T.n - 1))));
    out[3 * c] = Math.min(255, T.lut[i] * k); out[3 * c + 1] = Math.min(255, T.lut[i + 1] * k); out[3 * c + 2] = Math.min(255, T.lut[i + 2] * k);
}
// The relief under a land field: soft (0.86–1.06 of the colour), so a ramp's colour still reads as its value on a dark
// slope — never the 0.45–1 multiply, which made a shaded 25 °C read as 5 °C (report §2.3). Air and sea fields get none.
const softOf = s => 0.86 + 0.2 * s;
const shadeOf = (terrain, c) => softOf(terrain.shade[c]);
// (the climate's land: the frame's — all the world ocean does not reach, a dry sunk basin too (terrain-player.js) — else
// the heights above 0)
const landOf = terrain => { const L = terrain.land, h = terrain.heightKm; return L ? c => L[c] === 1 : c => h[c] > 0; };

const KOPPEN_RGB = KOPPEN_CLASSES.map(k => k.color.map(v => Math.round(255 * v)));
const GROUP_RGB = KOPPEN_GROUPS.map(g => g.color.map(v => Math.round(255 * v)));
const DIMMED = rgb => rgb.map(v => 0.3 * v + 0.7 * 40);
/** A Köppen class's colour in the view: its group's (the five groups), or with a group opened, its own in that group and
 *  its group's dimmed in the others. */
function koppenRgb(id) {
    const g = koppenGroupOf(id), open = climateOptions.group;
    if (g < 0) return KOPPEN_RGB[0];
    if (open < 0) return GROUP_RGB[g];
    return g === open ? KOPPEN_RGB[id] : DIMMED(GROUP_RGB[g]);
}
const ICE_RGB = [232, 238, 244];
// (Köppen's sea too: a land question, its sea flat and dark — the sea ice over it)
const SEA_FLAT = SEA_UNDER_LAND, ICE_SHEET = ICE_SHEET_RGB.map(v => 255 * v), SNOW = SNOW_RGB.map(v => 255 * v);
const windSpeed = (C, season, g) => Math.hypot(g(C.u[season]), g(C.v[season]));
/** The land under the wind: a touch lighter (10 % toward white), no relief — the wind does not live on the ground. */
const WIND_LAND_LIFT = 0.1;
function liftCell(out, o, k) { for (let ch = 0; ch < 3; ch++) out[o + ch] += (255 - out[o + ch]) * k; }

/** The moment's temperature at terrain cell c (°C): land from its own cell (its height and all), the sea at sea level. */
function temperatureAt(C, season, p, c, landCell) {
    if (!landCell) return at((C.Tsea ?? C.T)[season], p, c);
    const t = C.cell.tAnnual[c];
    return season === 'year' ? t : t + at(C.T[season], p, c) - at(C.T.year, p, c);
}
/** Rain at terrain cell c (mm/month; the view shows it × 12, in mm a year — the season's rate for January or July). */
function rainAt(C, season, p, c, landCell) {
    if (!landCell) return at(C.P[season], p, c);
    const monthly = C.cell.pAnnual[c] / 12;
    if (season === 'year') return monthly;
    const y = at(C.P.year, p, c);
    return y > 0.01 ? monthly * at(C.P[season], p, c) / y : monthly;
}

/**
 * The value a layer paints at terrain cell c, in the legend's units (NaN: none — the sea under a land question): the one
 * function the paint, the lines and the read-out's pin share, so they cannot disagree.
 */
export function cellValue(layer, season, C, p, c, land, stat = null) {
    switch (layer) {
        case 'temperature': return temperatureAt(C, season, p, c, land);
        case 'rain': return land ? 12 * rainAt(C, season, p, c, land) : NaN;
        case 'pressure': return at(C.slp[season], p, c);
        case 'wind': return windSpeed(C, season, f => at(f, p, c));
        case 'currents': return land ? NaN : at(C.sstAnom[season], p, c);
        case 'upwelling': return land ? NaN : at(C.upwelling[season], p, c);
        case 'rainShadow': return land ? at(C.orographic, p, c) : NaN;
    }
    if (STAT_LAYERS.has(layer)) return land && stat ? stat(STAT_KEY[layer], c) : NaN;
    return NaN;
}

/**
 * Colour the terrain cells for a climate layer. `terrain`: {heightKm, shade, land?} of the frame; `relief(out)`: the
 * terrain's own colours (the palette chosen), for the land under the sea's layers.
 */
export function paintClimate(layer, season, C, terrain, tMesh, out, relief) {
    const p = placementOf(tMesh), n = tMesh.numCells, isLand = landOf(terrain);
    const stat = (key, c) => (C.cell.stats?.[key] ? statValue(C.cell.stats[key], key, c) : NaN);
    if (layer === 'koppen') {
        for (let c = 0; c < n; c++) {
            const land = isLand(c), k = land ? shadeOf(terrain, c) : 1;
            let rgb = land ? koppenRgb(C.cell.koppen[c]) : SEA_FLAT;
            if (!land) { const ice = Math.min(1, Math.max(0, at(C.ice, p, c))); if (ice > 0.02) rgb = rgb.map((v, ch) => v + (ICE_RGB[ch] - v) * ice); }
            out[3 * c] = Math.min(255, rgb[0] * k); out[3 * c + 1] = Math.min(255, rgb[1] * k); out[3 * c + 2] = Math.min(255, rgb[2] * k);
        }
    } else if (layer === 'temperature' || layer === 'pressure') {
        // (temperature: the land's soft relief, the sea flat; pressure: an air field, no relief)
        const T = lutOf(layer);
        for (let c = 0; c < n; c++) { const land = isLand(c); put(out, c, T, cellValue(layer, season, C, p, c, land), land && layer === 'temperature' ? shadeOf(terrain, c) : 1); }
    } else if (layer === 'wind') {
        const T = lutOf('wind');
        for (let c = 0; c < n; c++) { put(out, c, T, cellValue('wind', season, C, p, c, false), 1); if (isLand(c)) liftCell(out, 3 * c, WIND_LAND_LIFT); }
    } else if (layer === 'upwelling') {
        // the sea: where cold water rises; the land: its own colours, greyed and dimmed
        relief(out);
        const T = lutOf('upwelling');
        for (let c = 0; c < n; c++) { if (!isLand(c)) put(out, c, T, at(C.upwelling[season], p, c), 1); else greyCell(out, c, 0.55, 0.75); }
    } else if (layer === 'ice') {
        // the sea's ice in its season; on land, the ice sheets over the land's own colours
        relief(out);
        const T = lutOf('seaIce');
        for (let c = 0; c < n; c++) {
            if (!isLand(c)) { put(out, c, T, at(C.seaIce[season], p, c), 1); continue; }
            greyCell(out, c, 0.4, 0.85);
            const f = Math.max(0, Math.min(1, at(C.iceSheet, p, c))), k = shadeOf(terrain, c), sn = C.snow ? Math.max(0, Math.min(1, at(C.snow[season], p, c))) : 0;
            if (sn > 0) for (let ch = 0; ch < 3; ch++) out[3 * c + ch] += (Math.min(255, SNOW[ch] * k) - out[3 * c + ch]) * sn;
            if (f > 0) for (let ch = 0; ch < 3; ch++) out[3 * c + ch] += (Math.min(255, ICE_SHEET[ch] * k) - out[3 * c + ch]) * f;
        }
    } else if (LAND_LAYERS.has(layer)) {
        // the land's own questions; the sea flat and dark
        const T = lutOf(STAT_KEY[layer] ?? layer);
        for (let c = 0; c < n; c++) {
            if (!isLand(c)) { out[3 * c] = SEA_FLAT[0]; out[3 * c + 1] = SEA_FLAT[1]; out[3 * c + 2] = SEA_FLAT[2]; continue; }
            const v = cellValue(layer, season, C, p, c, true, stat), k = shadeOf(terrain, c);
            if (v === v) put(out, c, T, v, k);
            else { out[3 * c] = out[3 * c + 1] = out[3 * c + 2] = 105 * k; }
        }
    } else if (layer === 'currents') {
        // the sea: its warmth against its latitude's (the currents move over it); the land: its own colours, greyed and dimmed
        relief(out);
        const T = lutOf('sst');
        for (let c = 0; c < n; c++) {
            if (!isLand(c)) { put(out, c, T, at(C.sstAnom[season], p, c), 1); continue; }
            greyCell(out, c, 0.55, 0.75);
        }
    }
}

/** A climate layer on a moment with no climate: the terrain, greyed and dimmed. */
export function paintUnavailable(out, n) { for (let c = 0; c < n; c++) greyCell(out, c, 0.8, 0.55); }
function greyCell(out, c, grey, dim) {
    const r = out[3 * c], g = out[3 * c + 1], b = out[3 * c + 2], l = 0.3 * r + 0.59 * g + 0.11 * b;
    out[3 * c] = (r + (l - r) * grey) * dim; out[3 * c + 1] = (g + (l - g) * grey) * dim; out[3 * c + 2] = (b + (l - b) * grey) * dim;
}

// ── the flow: what the particles follow (climate-flow.js FlowLayer.setField) ──
const carriedCache = new WeakMap();
/** What the sea's currents carry in a season (°C against the latitude they reach; climate-flow.js carriedOf), per climate. */
function carriedFor(C, season) {
    let m = carriedCache.get(C);
    if (!m) carriedCache.set(C, m = {});
    return (m[season] ??= carriedOf(C.currentU[season], C.currentV[season], (C.Tsea ?? C.T)[season], C.sea));
}
/** The flow a layer draws in a season, as FlowLayer.setField's argument — or null (no flow on that layer). The wind: white
 *  particles over its quiet speed; the currents: tinted warm or cold by the water they carry (±1.5 °C saturates), over
 *  the sea only. */
export function flowFieldOf(layer, season, C) {
    if (layer === 'wind') return { u: C.u[season], v: C.v[season], widthPx: 1.5, opacity: 0.85 };
    if (layer === 'currents') {
        const tint = Float32Array.from(carriedFor(C, season), x => Math.max(-1, Math.min(1, x / 1.5)));
        return { u: C.currentU[season], v: C.currentV[season], mask: C.sea, tint, widthPx: 1.6, opacity: 0.95 };
    }
    return null;
}

// ── the lines over the colours: drawn per pixel of a raster as wide as the map texture, then laid over it ──
/**
 * Where the lines are drawn, for one picture: `W` × W/2 pixels, `land` (1 per land pixel) and `values(layer, season)`
 * (the value the layer paints per pixel: NaN where it paints none). Live moments: from the terrain cells through the
 * map's table (map-raster.js SmoothMapRaster: each pixel's three cells and weights); finished: from the climate picture.
 */
export function liveLineSource(C, terrain, tMesh, table) {
    const p = placementOf(tMesh), isLand = landOf(terrain), n = tMesh.numCells, W = table.width, H = table.height;
    const cellLand = new Uint8Array(n);
    for (let c = 0; c < n; c++) cellLand[c] = isLand(c) ? 1 : 0;
    const land = new Uint8Array(W * H);
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) land[i] = cellLand[table.cellAt(x, y)];
    const stat = (key, c) => (C.cell.stats?.[key] ? statValue(C.cell.stats[key], key, c) : NaN);
    const values = (layer, season) => {
        const cv = new Float32Array(n);
        for (let c = 0; c < n; c++) cv[c] = cellValue(layer, season, C, p, c, cellLand[c] === 1, stat);
        const out = new Float32Array(W * H), pc = table.pixelCells, pw = table.pixelWeights;
        for (let i = 0; i < W * H; i++) {
            const w1 = pw[2 * i], w2 = pw[2 * i + 1], ws = [255 - w1 - w2, w1, w2];
            let s = 0, k = 0;
            for (let j = 0; j < 3; j++) { const v = cv[pc[3 * i + j]]; if (v === v) { s += ws[j] * v; k += ws[j]; } }
            out[i] = k >= 128 ? s / k : NaN;
        }
        return out;
    };
    return { W, H, land, values };
}
export function finishedLineSource(C, W = 2048) {
    const R = C.raster, H = W >> 1, g = gridSampler(W), land = new Uint8Array(W * H), s = R.w / W;
    for (let y = 0, i = 0; y < H; y++) {
        const cy = Math.min(R.h - 1, Math.floor((y + 0.5) * s));
        for (let x = 0; x < W; x++, i++) land[i] = R.koppen[cy * R.w + Math.min(R.w - 1, Math.floor((x + 0.5) * s))] ? 1 : 0;
    }
    const values = (layer, season) => {
        const out = new Float32Array(W * H);
        for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) out[i] = pixelValue(layer, season, C, g, land[i] ? landPixel(R, W, x, y) : -1, x, y);
        return out;
    };
    return { W, H, land, values };
}
/** A 1° field on a W × W/2 raster, bicubic (Catmull-Rom: smooth at every zoom, no 1° kinks, nothing below 1° invented). */
function gridRaster(f, W) {
    const H = W >> 1, out = new Float32Array(W * H);
    for (let y = 0, i = 0; y < H; y++) { const lat = 90 - (y + 0.5) / H * 180; for (let x = 0; x < W; x++, i++) out[i] = cubicLonLat(f, (x + 0.5) / W * 360 - 180, lat); }
    return out;
}

/** The lines a layer draws now (the legend card's toggles), as a key: the overlay is redrawn only when it changes. */
export function linesKey(layer) {
    const o = climateOptions;
    return layer === 'wind' ? `w${+o.isobars}${+o.itcz}` : layer === 'currents' ? `c${+o.upw}${+o.ice}` : layer === 'pressure' ? `p${+o.pIso}${+o.itcz}` : LINE_LAYERS.has(layer) ? `i${+o.iso}` : '';
}

const linesCache = new WeakMap();
/**
 * A layer's lines into ctx (a texture `width` wide): isotherms / isohyets / isobars with the toggle (H and L with the
 * isobars), the ITCZ on demand, the coast under the wind, upwelling hatched and the sea ice's 15 % edge on the currents.
 * `src`: liveLineSource / finishedLineSource. The pixels are cached per climate, layer, season and toggles.
 */
export function drawClimateLines(ctx, width, layer, season, C, src) {
    if (!LINE_LAYERS.has(layer) || !src) return;
    const o = climateOptions, key = `${layer}|${season}|${linesKey(layer)}|${src.W}`;
    let cache = linesCache.get(src);
    if (!cache) linesCache.set(src, cache = new Map());
    let canvas = cache.get(key);
    if (!canvas) {
        const { W, H, land } = src, img = new ImageData(W, H), D = img.data;
        const mark = (i, r, g, b, a) => { if (a > D[4 * i + 3] / 255) { D[4 * i] = r; D[4 * i + 1] = g; D[4 * i + 2] = b; D[4 * i + 3] = 255 * a; } };
        const iso = (v, l, dark) => {
            for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
                const k = layerIsoline(l, v[i], v[y * W + (x + 1) % W], v[Math.min(H - 1, y + 1) * W + x], 0.7);
                if (k > 0) dark ? mark(i, 14, 16, 24, 0.6 * k) : mark(i, 236, 239, 246, 0.6 * k);
            }
        };
        if ((layer === 'temperature' || layer === 'rain') && o.iso) {
            // (the land's fields carry the relief's detail: smoothed ~30 km first, so a line reads as the climate's, not a
            // contour of every hill)
            const v = blurRaster(src.values(layer, season), W, H, Math.max(1, 30 / (40075 / W)));
            iso(v, layer, true);
        }
        const slp = (layer === 'pressure' && o.pIso) || (layer === 'wind' && o.isobars) ? gridRaster(C.slp[season], W) : null;
        if (slp) iso(slp, 'pressure', layer === 'pressure');
        if (layer === 'wind') {
            // (the coast: the wind's colour does not show where land is, so a thin light line does)
            for (let y = 0, i = 0; y < H - 1; y++) for (let x = 0; x < W; x++, i++) if (land[i] !== land[y * W + (x + 1) % W] || land[i] !== land[i + W]) mark(i, 220, 225, 235, 0.45);
        }
        if (layer === 'currents' && (o.upw || o.ice)) {
            const up = o.upw ? gridRaster(C.upwelling[season], W) : null, ice = o.ice ? gridRaster(C.seaIce[season], W) : null, hatch = Math.max(5, Math.round(W / 400));
            for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
                if (land[i]) continue;
                // upwelling: cold water rising ≥ 0.5 m/day, hatched teal (diagonal, so it never reads as a current's line)
                if (up && (x + y) % hatch < 2) { const on = Math.max(0, Math.min(1, (up[i] - 0.3) / 0.4)); if (on > 0) mark(i, 60, 235, 200, 0.85 * on); }
                // the sea ice: ≥ 15 % cover (the NSIDC extent's convention) white, its edge a line
                if (ice) {
                    const c = ice[i], k = Math.max(0, Math.min(1, (c - 0.15) / 0.5)) * 0.75;
                    if (k > 0) mark(i, 232, 238, 244, k);
                    const e = isolineCoverage(c - 0.15, ice[y * W + (x + 1) % W] - 0.15, ice[Math.min(H - 1, y + 1) * W + x] - 0.15, 10, 0.8) * (Math.abs(c - 0.15) < 0.2 ? 1 : 0);
                    if (e > 0) mark(i, 255, 255, 255, 0.9 * e);
                }
            }
        }
        canvas = new OffscreenCanvas(W, H);
        const g = canvas.getContext('2d');
        g.putImageData(img, 0, 0);
        if (slp) highsLows(g, W, C.slp[season], layer === 'pressure');
        if ((layer === 'pressure' || layer === 'wind') && o.itcz) itczLine(g, W, season, C);
        cache.set(key, canvas);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, 0, 0, width, width >> 1);
    ctx.restore();
}
/** H and L at the pressure's highs and lows (climate-isolines.js highsAndLows), with their hPa. */
function highsLows(g, W, slp, onPressure) {
    const H = W >> 1, big = Math.round(W / 110), small = Math.round(W / 190);
    g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = Math.max(1.5, W / 1000);
    g.strokeStyle = onPressure ? 'rgba(255,255,255,0.85)' : 'rgba(10,10,20,0.85)';
    for (const f of highsAndLows(slp)) {
        const x = (f.lon + 180) / 360 * W, y = (90 - f.lat) / 180 * H;
        g.fillStyle = f.hi ? (onPressure ? '#8a1020' : 'rgba(255,190,150,0.95)') : (onPressure ? '#16457a' : 'rgba(160,200,255,0.95)');
        g.font = `bold ${big}px system-ui, sans-serif`; g.strokeText(f.hi ? 'H' : 'L', x, y); g.fillText(f.hi ? 'H' : 'L', x, y);
        g.font = `${small}px system-ui, sans-serif`; g.strokeText(Math.round(f.hPa), x, y + big); g.fillText(Math.round(f.hPa), x, y + big);
    }
    g.restore();
}
/** The ITCZ: its latitude per 1° of longitude in the season shown — dashed green on a dark casing, readable on any colour. */
function itczLine(g, W, season, C) {
    const L = C.itcz?.[season];
    if (!L) return;
    const H = W >> 1, n = L.length;
    g.save(); g.lineJoin = 'round'; g.setLineDash([W / 160, W / 260]);
    for (const [col, w] of [['rgba(10,10,20,0.7)', W / 450], ['rgba(110,240,140,0.95)', W / 900]]) {
        g.strokeStyle = col; g.lineWidth = w; g.beginPath();
        for (let i = 0; i <= n; i++) { const x = (i + 0.5) / n * W, y = (90 - L[i % n]) / 180 * H; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke();
    }
    g.restore();
}

// ── the legend: the quantity, its units and the season as its title; the ramp with ticks and a pin at the value under
// the cursor; a key for each kind of line drawn; the toggles for the lines (in the legend card, by the thing they change) ──
const LEGEND = {
    temperature: { title: 'Temperature', ramp: 'temperature', unit: '°C · the air near the ground; the sea at its surface' },
    rain: { title: 'Rain', ramp: 'rain', unit: 'mm a year (a month shown at its rate) · the land’s; the sea dark' },
    pressure: { title: 'Sea-level pressure', ramp: 'pressure', unit: 'hPa' },
    wind: { title: 'Wind near the surface', ramp: 'wind', unit: 'colour: its speed, m/s' },
    currents: { title: 'Ocean currents, the top 200 m', ramp: 'sstAnom', unit: 'colour: the sea surface against its latitude’s average, °C' },
};
const TOGGLES = {
    temperature: [['iso', 'Isotherms']], rain: [['iso', 'Isohyets']], pressure: [['pIso', 'Isobars'], ['itcz', 'ITCZ']],
    wind: [['isobars', 'Isobars'], ['itcz', 'ITCZ']], currents: [['upw', 'Upwelling'], ['ice', 'Sea ice']],
};
const key = (bg, text, cls = '') => `<span><i class="${cls}" style="background:${bg}"></i>${text}</span>`;
function legendKeys(layer) {
    const o = climateOptions, k = [];
    if (layer === 'wind') {
        k.push(key('#fff', 'moving lines: the wind (brighter, faster)'));
        if (o.isobars) k.push(key('#e8ebf4', 'isobars every 4 hPa · H / L'));
    }
    if (layer === 'currents') {
        k.push(key('#ff9e40', 'warm current'), key('#59d1ff', 'cold current'), key('#eef', 'neither'));
        if (o.upw) k.push(key('repeating-linear-gradient(135deg,#3cebc8 0 2px,transparent 2px 5px)', 'upwelling ≥ 0.5 m/day'));
        if (o.ice) k.push(key('#e8eef4', 'sea ice ≥ 15 %'));
    }
    if ((layer === 'pressure' ? o.pIso : o.iso) && ISOLINES[layer]) k.push(key('#0e1018', ISOLINES[layer].key));
    if (o.itcz && (layer === 'pressure' || layer === 'wind')) k.push(key('repeating-linear-gradient(90deg,#6ef08c 0 5px,transparent 5px 8px)', 'the ITCZ (where the trades meet)'));
    return k.join('');
}
const legendState = new WeakMap();
/** The legend of a climate layer. A finished moment's Köppen classes are counted on its climate picture (C.raster). */
export function drawLegend(el, layer, season, C, terrain) {
    if (layer === 'satellite') { el.innerHTML = `<div class="evo-legend-note">As from space, cloud-free — ${SEASON_WORDS[season]}: each climate's colours climbing with the land to rock and snow, rivers greening dry country, snow and ice from the climate</div>`; return; }
    legendState.set(el, { layer, season, C, terrain });
    if (layer === 'koppen') { koppenLegend(el, C, terrain); return; }
    const L = LEGEND[layer];
    // (Generate's Inspect layers: their legends)
    if (!L) { el.innerHTML = climateLegendHTML(layer, season); return; }
    const toggles = (TOGGLES[layer] ?? []).map(([k, label]) => `<label><input type="checkbox" data-k="${k}" ${climateOptions[k] ? 'checked' : ''}> ${label}</label>`).join(' ');
    el.innerHTML = `<div class="evo-legend-title">${L.title} · ${SEASON_WORDS[season]}</div><canvas class="evo-legend-bar" width="492" height="92"></canvas>`
        + `<div class="evo-legend-note">${L.unit}</div><div class="evo-legend-keys">${legendKeys(layer)}</div>`
        + (toggles ? `<div class="evo-legend-toggles">${toggles}</div>` : '');
    drawLegendBar(el.querySelector('canvas'), VIEW_RAMPS[L.ramp]);
    for (const box of el.querySelectorAll('input[data-k]')) box.onchange = () => {
        climateOptions[box.dataset.k] = box.checked;
        el.querySelector('.evo-legend-keys').innerHTML = legendKeys(layer);
        optionChanged();
    };
}
/** The legend's pin at the value under the cursor (null: none — off the layer's field). */
export function setLegendPin(el, value) {
    const st = legendState.get(el), canvas = el.querySelector('canvas.evo-legend-bar');
    if (!st || !canvas || !LEGEND[st.layer]) return;
    drawLegendBar(canvas, VIEW_RAMPS[LEGEND[st.layer].ramp], value);
}
/** Köppen: the five groups first (30 standard colours aren't separable for anyone, five are), each with its share of the
 *  land; a group opened shows its zones in their own colours (the map with them), the others dimmed. */
function koppenLegend(el, C, terrain) {
    const count = new Float64Array(KOPPEN_CLASSES.length);
    let land = 0;
    if (C.raster) {
        const R = C.raster;
        for (let y = 0; y < R.h; y++) {
            const a = Math.cos(((y + 0.5) / R.h - 0.5) * Math.PI);
            for (let x = 0, i = y * R.w; x < R.w; x++, i++) if (R.koppen[i]) { count[R.koppen[i]] += a; land += a; }
        }
    } else {
        const k = C.cell.koppen, isLand = landOf(terrain);
        for (let c = 0; c < k.length; c++) if (isLand(c)) { count[k[c]]++; land++; }
    }
    const groups = new Float64Array(5);
    count.forEach((v, i) => { const g = koppenGroupOf(i); if (g >= 0) groups[g] += v; });
    const open = climateOptions.group, pct = v => `${Math.round(100 * v / Math.max(1e-9, land))}%`;
    const chips = KOPPEN_GROUPS.map((G, g) => {
        const [r, gg, b] = GROUP_RGB[g];
        return `<button type="button" data-g="${g}" aria-pressed="${open === g}" title="${G.name}: click for its zones"><i style="background:rgb(${r},${gg},${b})"></i>${G.letter} ${G.name}<em>${pct(groups[g])}</em></button>`;
    }).join('');
    const zones = open >= 0 ? [...count.keys()].filter(i => koppenGroupOf(i) === open && count[i] / land >= 0.002).sort((a, b) => count[b] - count[a]) : [];
    el.innerHTML = `<div class="evo-legend-title">Köppen climate · ${open >= 0 ? `${KOPPEN_GROUPS[open].name} zones` : 'the five groups'}</div><div class="evo-koppen-groups">${chips}</div>`
        + (zones.length ? `<div class="evo-koppen">${zones.map(i => { const K = KOPPEN_CLASSES[i], [r, g, b] = KOPPEN_RGB[i]; return `<span title="${K.name}"><i style="background:rgb(${r},${g},${b})"></i>${K.code} <em>${pct(count[i])}</em></span>`; }).join('')}</div>` : '')
        + `<div class="evo-legend-note">${open >= 0 ? 'click the group again for all five' : 'click a group for its zones'}</div>`;
    for (const b of el.querySelectorAll('button[data-g]')) b.onclick = () => {
        climateOptions.group = climateOptions.group === +b.dataset.g ? -1 : +b.dataset.g;
        koppenLegend(el, C, terrain);
        optionChanged();
    };
}

// ── a finished moment's climate (its own, at its detail — climate-fields.js, with a picture of the land's climate:
// raster {w, h, koppen, tAnnual (°C × 100, the sea −32768), pAnnual (mm)}) — drawn per pixel of the finished picture ──
/** The 1° grid's cell and weight per column (i0, fx) and per row (j0, fy) of a texture W wide (gridSampler's, and the
 *  GPU's Satellite paint's: the same f32 weights). */
export function gridTables(W) {
    const H = W >> 1, i0 = new Uint16Array(W), fx = new Float32Array(W), j0 = new Uint8Array(H), fy = new Float32Array(H);
    for (let x = 0; x < W; x++) { const g = (x + 0.5) / W * 360 - 0.5, i = Math.floor(g); i0[x] = (i + 360) % 360; fx[x] = g - i; }
    for (let y = 0; y < H; y++) { const g = Math.min(178.999, Math.max(0, (y + 0.5) / H * 180 - 0.5)); j0[y] = Math.floor(g); fy[y] = g - j0[y]; }
    return { i0, fx, j0, fy };
}
/** Where a texture W wide samples the 1° grid (bilinear; longitude wraps): per column and per row. */
function gridSampler(W) {
    const { i0, fx, j0, fy } = gridTables(W);
    return (field, x, y) => {
        const a = i0[x], b = a === 359 ? 0 : a + 1, r0 = j0[y] * 360, r1 = r0 + 360, tx = fx[x], ty = fy[y];
        return (field[r0 + a] * (1 - tx) + field[r0 + b] * tx) * (1 - ty) + (field[r1 + a] * (1 - tx) + field[r1 + b] * tx) * ty;
    };
}
/** The climate picture's pixel for texture pixel (x, y) of a texture W wide — on land, the nearest land pixel (a coast
 *  the two pictures draw a pixel apart) — or −1. */
export function landPixel(R, W, x, y) {
    const s = R.w / W, cx = Math.min(R.w - 1, Math.floor((x + 0.5) * s)), cy = Math.min(R.h - 1, Math.floor((y + 0.5) * s)), i = cy * R.w + cx;
    if (R.koppen[i]) return i;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = cy + dy;
        if (yy < 0 || yy >= R.h) continue;
        const j = yy * R.w + (cx + dx + R.w) % R.w;
        if (R.koppen[j]) return j;
    }
    return -1;
}
/** Enlarged — a texture wider than the climate picture: the land colour (3 per pixel in S) blended from the four nearest
 *  land pixels by their bilinear weights, into out — false where none of them is land. */
function landBlend(R, S, W, x, y, out) {
    const s = R.w / W, u = (x + 0.5) * s - 0.5, v = (y + 0.5) * s - 0.5, x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    let ws = 0;
    out[0] = out[1] = out[2] = 0;
    for (let j = 0; j < 2; j++) {
        const yy = Math.min(R.h - 1, Math.max(0, y0 + j));
        for (let i = 0; i < 2; i++) {
            const p = yy * R.w + ((x0 + i) % R.w + R.w) % R.w;
            if (!R.koppen[p]) continue;
            const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
            out[0] += w * S[3 * p]; out[1] += w * S[3 * p + 1]; out[2] += w * S[3 * p + 2]; ws += w;
        }
    }
    if (!(ws > 0)) return false;
    out[0] /= ws; out[1] /= ws; out[2] /= ws;
    return true;
}
/** The live layers' soft relief (softOf) from the finished picture's light kk (0.35…1). */
const shadeK = kk => softOf((kk - 0.35) / 0.65);

/**
 * The value a layer paints at pixel (x, y) of a texture W wide on a finished moment (the legend's units; NaN: none), from
 * its climate picture pixel i (−1: the sea) and the grid sampler g: shared by the paint, the lines and the read-out.
 */
function pixelValue(layer, season, C, g, i, x, y) {
    const R = C.raster;
    switch (layer) {
        case 'temperature':
            if (i < 0) return g((C.Tsea ?? C.T)[season], x, y);
            return R.tAnnual[i] / 100 + (season === 'year' ? 0 : g(C.T[season], x, y) - g(C.T.year, x, y));
        case 'rain': {
            if (i < 0) return NaN;
            const yr = season === 'year' ? 0 : g(C.P.year, x, y);
            return season === 'year' || !(yr > 0.01) ? R.pAnnual[i] : R.pAnnual[i] * g(C.P[season], x, y) / yr;
        }
        case 'pressure': return g(C.slp[season], x, y);
        case 'wind': return windSpeed(C, season, f => g(f, x, y));
        case 'currents': return i < 0 ? g(C.sstAnom[season], x, y) : NaN;
        case 'upwelling': return i < 0 ? g(C.upwelling[season], x, y) : NaN;
        case 'rainShadow': return i >= 0 ? g(C.orographic, x, y) : NaN;
    }
    if (STAT_LAYERS.has(layer)) { const st = R.stats?.[STAT_KEY[layer]]; return i >= 0 && st ? statValue(st, STAT_KEY[layer], i) : NaN; }
    return NaN;
}

/**
 * A climate layer's colouring per pixel of a finished picture, for finish-view.js paintFinished (a texture W wide):
 * the land from the moment's own climate picture, the sea and the seasons from its grid — the land's layers under the
 * finished relief, softly, as the live layers under theirs. `lut`: the terrain's palette (the land under the sea's layers).
 */
export function finishedClimateColor(layer, season, C, W, lut, fin = null) {
    if (layer === 'satellite') return satelliteColor(season, C, W, fin);
    const R = C.raster, g = gridSampler(W), T = lutOf({ currents: 'sst', ice: 'seaIce' }[layer] ?? STAT_KEY[layer] ?? layer);
    const px = [0, 0, 0];
    const putPx = (out, o, k, v) => {
        const x = T.toX(v), i = 3 * Math.max(0, Math.min(T.n - 1, Math.round((x - T.a) / (T.b - T.a) * (T.n - 1))));
        out[o] = Math.min(255, T.lut[i] * k); out[o + 1] = Math.min(255, T.lut[i + 1] * k); out[o + 2] = Math.min(255, T.lut[i + 2] * k); out[o + 3] = 255;
    };
    const rgbPx = (out, o, k, rgb) => { out[o] = Math.min(255, rgb[0] * k); out[o + 1] = Math.min(255, rgb[1] * k); out[o + 2] = Math.min(255, rgb[2] * k); out[o + 3] = 255; };
    return (out, o, x, y, wet, kk, k3) => {
        const i = wet ? -1 : landPixel(R, W, x, y), land = i >= 0;
        if (layer === 'koppen') {
            let rgb = land ? koppenRgb(R.koppen[i]) : SEA_FLAT;
            if (!land) { const ice = Math.min(1, Math.max(0, g(C.ice, x, y))); if (ice > 0.02) { for (let ch = 0; ch < 3; ch++) px[ch] = rgb[ch] + (ICE_RGB[ch] - rgb[ch]) * ice; rgb = px; } }
            rgbPx(out, o, land ? shadeK(kk) : 1, rgb);
        } else if (layer === 'temperature') putPx(out, o, land ? shadeK(kk) : 1, pixelValue(layer, season, C, g, i, x, y));
        else if (layer === 'pressure') putPx(out, o, 1, pixelValue(layer, season, C, g, i, x, y));
        else if (layer === 'wind') { putPx(out, o, 1, pixelValue(layer, season, C, g, i, x, y)); if (!wet) liftCell(out, o, WIND_LAND_LIFT); }
        else if (layer === 'currents' || layer === 'upwelling') {
            if (wet) { putPx(out, o, 1, g((layer === 'currents' ? C.sstAnom : C.upwelling)[season], x, y)); return; }
            greyLand(out, o, kk, k3, 0.55, 0.75);
        } else if (layer === 'ice') {
            if (wet) { putPx(out, o, 1, g(C.seaIce[season], x, y)); return; }
            greyLand(out, o, kk, k3, 0.4, 0.85);
            const f = Math.max(0, Math.min(1, g(C.iceSheet, x, y))), k = shadeK(kk), sn = C.snow ? Math.max(0, Math.min(1, g(C.snow[season], x, y))) : 0;
            if (sn > 0) for (let ch = 0; ch < 3; ch++) out[o + ch] += (Math.min(255, SNOW[ch] * k) - out[o + ch]) * sn;
            if (f > 0) for (let ch = 0; ch < 3; ch++) out[o + ch] += (Math.min(255, ICE_SHEET[ch] * k) - out[o + ch]) * f;
        } else {
            // (the land's own questions; the sea flat and dark)
            if (!land) { rgbPx(out, o, 1, SEA_FLAT); return; }
            const v = pixelValue(layer, season, C, g, i, x, y);
            if (v === v) putPx(out, o, shadeK(kk), v); else rgbPx(out, o, shadeK(kk), [105, 105, 105]);
        }
    };
    /** The land under a sea's layer: its own colours, greyed and dimmed. */
    function greyLand(out, o, kk, k3, grey, dim) {
        const L = lut.rgb, r = L[k3] * kk, gg = L[k3 + 1] * kk, b = L[k3 + 2] * kk, l = 0.3 * r + 0.59 * gg + 0.11 * b;
        out[o] = (r + (l - r) * grey) * dim; out[o + 1] = (gg + (l - gg) * grey) * dim; out[o + 2] = (b + (l - b) * grey) * dim; out[o + 3] = 255;
    }
}

// ── the Satellite layer (plans/V2_SATELLITE_PLAN.md): the land's own colours from space (the finish's, per view: the
// year, January, July — finish-cover.js), the sea by its depth (Blue Marble's: near black in the deep, lighter over the
// shelves, turquoise over warm shallows), sea ice in its season, lakes as water and salt pans white ──
// (the shallowest water no brighter than a broad shelf's: the finished coasts' shelves are narrow, and a bright last
// step drew every coast a cyan outline)
const SEA_DEPTH = [[-6, [4, 10, 34]], [-4, [6, 15, 46]], [-2, [9, 26, 66]], [-0.6, [14, 40, 88]], [-0.15, [22, 62, 112]], [0, [30, 80, 128]]];
const SHALLOW_WARM = [40, 118, 138], SEA_ICE = [214, 223, 230];
const SAT_LAKE = [[0, 0, 0], [20, 38, 64], [52, 96, 100], [222, 218, 205]], LAKE_ICE = [208, 216, 224];
function seaDepthRgb(km, out) {
    const d = SEA_DEPTH;
    let i = 0;
    while (i < d.length - 2 && km > d[i + 1][0]) i++;
    const t = Math.max(0, Math.min(1, (km - d[i][0]) / (d[i + 1][0] - d[i][0])));
    for (let ch = 0; ch < 3; ch++) out[ch] = d[i][1][ch] + (d[i + 1][1][ch] - d[i][1][ch]) * t;
    return out;
}
// The sea ice as from space: a sharp, ragged edge, not the 1° grid's fraction smoothed into a fog — the fraction against
// a threshold moved by fractal noise (the pack's edge over ~SEA_ICE_EDGE_KM; loose floes, ~SEA_ICE_FLOE_KM, where the
// cover is partial), the edge itself about a pixel wide.
const SEA_ICE_EDGE_KM = 160, SEA_ICE_FLOE_KM = 30, SEA_ICE_NOISE = 0.42, iceNoise = new FastNoise(7919);
function seaIceAt(c, x, y, W) {
    if (!(c > 0.04)) return 0;
    if (c > 0.96) return 1;
    const H = W >> 1, lat = (0.5 - (y + 0.5) / H) * Math.PI, lon = ((x + 0.5) / W - 0.5) * 2 * Math.PI, cl = Math.cos(lat);
    const px = cl * Math.cos(lon), py = cl * Math.sin(lon), pz = Math.sin(lat), fE = 6371 / SEA_ICE_EDGE_KM, fF = 6371 / SEA_ICE_FLOE_KM;
    const n = 0.7 * iceNoise.fbm(fE * px, fE * py, fE * pz, 3, 0.5) + 0.3 * iceNoise.noise3D(fF * px + 5.1, fF * py - 2.7, fF * pz + 8.3);
    const t = c + SEA_ICE_NOISE * n, e = Math.max(0, Math.min(1, (t - 0.47) / 0.06));
    return e * e * (3 - 2 * e);
}
/** The Satellite layer's constants, for its GPU painter (gpu/finish-paint.js) to colour with the same numbers. */
export const SAT_SEA = { SEA_DEPTH, SHALLOW_WARM, SEA_ICE, SAT_LAKE, LAKE_ICE, SEA_ICE_EDGE_KM, SEA_ICE_FLOE_KM, SEA_ICE_NOISE, iceNoise };
/**
 * What the Satellite layer colours a finished moment's picture from, in a season: the climate picture R, its land colours
 * S (3 bytes per pixel of R), the relief shading's strength, and the 1° grids — the sea's temperature, its ice, the air's
 * temperature in the season and the year's (the lakes' ice); with the layer's constants and the grid's tables, for the
 * GPU's colouring (finish-paint.js), which cannot import this module's page-side dependencies. The CPU's colouring too.
 */
export function satelliteSource(season, C, fin = null) {
    const R = C.raster;
    // (the land: the climates' colours by height with the realistic picture's texture — sat-style.js — where the finished
    // heights are at hand; else the realistic picture itself)
    const styled = !!fin?.raster?.heightM;
    const S = styled ? styledSatellite(R, season, fin.raster.heightM, fin.raster.w, fin.rivers) : R.sat[season];
    return { R, S, season, shadeAmp: styled ? SAT_SHADE : 1, tsea: (C.Tsea ?? C.T)[season], ice: C.seaIce?.[season] ?? C.ice, T: C.T[season], Tyear: C.T.year, consts: SAT_SEA, gridTables };
}
// (the Satellite's sea keeps the full 0.45–1 relief light, as finish-paint.js's shader does: it is a picture, not a
// field read by colour, so the climate layers' soft relief (shadeK) is not its)
const SAT_SEA_SHADE = kk => 0.45 + 0.55 * (kk - 0.35) / 0.65;
function satelliteColor(season, C, W, fin = null) {
    const { R, S, shadeAmp, tsea, ice, T, Tyear } = satelliteSource(season, C, fin), g = gridSampler(W), rgb = [0, 0, 0];
    const enlarged = R.w < W, blend = [0, 0, 0];
    return (out, o, x, y, wet, kk, k3, v, lake) => {
        // (the land's relief shading deeper than the other layers': the mountains stand out, as on a satellite image)
        const k = wet ? SAT_SEA_SHADE(kk) : 1 + shadeAmp * (0.37 + 0.68 * (kk - 0.35) / 0.65 - 1);      // (0.28–1.08: "the hillshading is too strong")
        if (wet) {
            // (the sea: a gentler light on its floor's relief; shallow warm water turquoise; its ice in its season)
            seaDepthRgb(v, rgb);
            const warmShallow = 0.7 * Math.max(0, Math.min(1, (g(tsea, x, y) - 20) / 6)) * Math.max(0, Math.min(1, (v + 0.12) / 0.1));
            const fi = seaIceAt(g(ice, x, y), x, y, W);
            const ks = 0.8 + 0.2 * k;
            for (let ch = 0; ch < 3; ch++) {
                let c = rgb[ch] + (SHALLOW_WARM[ch] - rgb[ch]) * warmShallow;
                c += (SEA_ICE[ch] - c) * fi;
                out[o + ch] = Math.min(255, c * ks);
            }
            out[o + 3] = 255;
            return;
        }
        const i = landPixel(R, W, x, y);
        if (lake) {
            // (a lake: open water, or frozen in a cold month — in the year's view, where it is frozen most of the year)
            const L = SAT_LAKE[lake];
            let t = i >= 0 ? R.tAnnual[i] / 100 : 0, f = 0;
            if (i >= 0 && lake !== 3) {
                if (season !== 'year') t += g(T, x, y) - g(Tyear, x, y);
                f = season === 'year' ? Math.max(0, Math.min(1, (-2 - t) / 8)) : Math.max(0, Math.min(1, (-1 - t) / 5));
            }
            for (let ch = 0; ch < 3; ch++) out[o + ch] = L[ch] + (LAKE_ICE[ch] - L[ch]) * f;
            out[o + 3] = 255;
            return;
        }
        if (i < 0) { out[o] = out[o + 1] = out[o + 2] = 90; out[o + 3] = 255; return; }
        // (enlarged: blended from the nearest land pixels, not blocks of one colour)
        if (enlarged && landBlend(R, S, W, x, y, blend)) { out[o] = Math.min(255, blend[0] * k); out[o + 1] = Math.min(255, blend[1] * k); out[o + 2] = Math.min(255, blend[2] * k); out[o + 3] = 255; return; }
        out[o] = Math.min(255, S[3 * i] * k); out[o + 1] = Math.min(255, S[3 * i + 1] * k); out[o + 2] = Math.min(255, S[3 * i + 2] * k); out[o + 3] = 255;
    };
}

/** The hover readout's climate lines on a finished moment, at (u, v) of the map (0…1); `sea`: the picture is sea there.
 *  On the Satellite layer, the ground first: its biome, and its snow in the season shown. */
export function finishedClimateLines(C, u, v, sea, layer = null, season = 'year') {
    const R = C.raster, lines = [], W = R.w, x = Math.min(W - 1, Math.floor(u * W)), y = Math.min(R.h - 1, Math.floor(v * R.h));
    const i = sea ? -1 : landPixel(R, W, x, y), g = gridSampler(W);
    if (i >= 0 && layer === 'satellite' && R.cover) {
        const cv = R.cover[i], snow = (cv & 31) !== 1 && (season === 'jan' ? cv & 32 : season === 'jul' ? cv & 64 : 0);
        lines.push(`<span class="hi-label">Ground</span> ${BIOME_WORDS[cv & 31] || 'Land'}${snow ? ' · under snow' : ''}`);
    }
    if (i >= 0) {
        lines.push(koppenLine(R.koppen[i], layer));
        if (layer !== 'temperature' || season !== 'year') lines.push(`<span class="hi-label">Temp</span> ${(R.tAnnual[i] / 100).toFixed(1)} °C · the year`);
        if (layer !== 'rain' || season !== 'year') lines.push(`<span class="hi-label">Rain</span> ${R.pAnnual[i].toLocaleString()} mm a year · the year`);
    } else lines.push(`<span class="hi-label">Sea</span> ${g((C.Tsea ?? C.T).year, x, y).toFixed(1)} °C · the year${g(C.ice, x, y) > 0.5 ? ' · sea ice' : ''}`);
    const [line, pin] = layerLine(layer, season, C, f => g(f, x, y), i >= 0, pixelValue(layer, season, C, g, i, x, y));
    if (line) lines.unshift(line);
    lines.pin = pin;
    return lines;
}

/**
 * The hover readout's line for the layer shown, in the season shown, and the legend's pin: [html | null, pin]. `g(f)`: a
 * 1° field there; `value`: what the layer paints there (cellValue / pixelValue — the pin is that, so the two agree).
 */
function layerLine(layer, season, C, g, land, value, stat) {
    const fmt = (v, d = 0) => (v === v ? v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
    const sn = SEASONAL_LAYERS.has(layer) ? ` · ${SEASON_WORDS[season]}` : '';
    const L = (label, text) => `<span class="hi-label">${label}</span> ${text}`;
    switch (layer) {
        case 'temperature': return [L('Temp', `${fmt(value, 1)} °C${sn}`), value];
        case 'rain': return land ? [L('Rain', `${season === 'year' ? rainYearText(value / 12) : `${fmt(value)} mm a year at ${SEASON_WORDS[season]}’s rate`}`), value] : [null, NaN];
        case 'pressure': return [L('Pressure', `${fmt(value)} hPa${sn}`), value];
        case 'wind': return [L('Wind', `${windText(g(C.u[season]), g(C.v[season]))}${sn}`) + '<br>' + L('Pressure', `${fmt(g(C.slp[season]))} hPa`), value];
        case 'currents': {
            if (land) return [null, NaN];
            const lines = [L('Current', `${currentText(g(C.currentU[season]), g(C.currentV[season]))}${sn}`), L('Carries', carriedText(g(carriedFor(C, season))))];
            lines.push(L('Sea', `${value >= 0 ? '+' : ''}${fmt(value, 1)} °C against its latitude · ${fmt(g((C.Tsea ?? C.T)[season]), 1)} °C`));
            if (climateOptions.upw) lines.push(L('Upwelling', `${fmt(Math.max(0, g(C.upwelling[season])), 2)} m/day`));
            if (climateOptions.ice) lines.push(L('Sea ice', `${fmt(100 * Math.max(0, Math.min(1, g(C.seaIce[season]))))} %`));
            return [lines.join('<br>'), value];
        }
        case 'upwelling': return land ? [null, NaN] : [L('Upwelling', `${fmt(Math.max(0, value), 2)} m/day${sn}`), value];
        case 'ice': return [land ? (g(C.iceSheet) > 0.05 ? L('Ice', 'an ice sheet') : C.snow && g(C.snow[season]) > 0.05 ? L('Snow', `${fmt(100 * Math.min(1, g(C.snow[season])))} %${sn}`) : null) : L('Sea ice', `${fmt(100 * Math.max(0, Math.min(1, g(C.seaIce[season]))))} %${sn}`), NaN];
        case 'rainShadow': {
            if (!land) return [null, NaN];
            const r = value;
            return [L('Mountains', r >= 1 ? `${fmt(100 * (r - 1))} % more rain` : `${fmt(100 * (1 - r))} % less rain`), r];
        }
        case 'tempRange': return land ? [L('Range', `${fmt(value, 1)} °C warmest − coldest month`), value] : [null, NaN];
        case 'aridity': return land && value === value ? [L('Aridity', `${classLabel('aridity', value)} (${fmt(value, 2)})`), value] : [null, NaN];
        case 'growing': return land && value === value ? [L('Growing', `${fmt(value)} month${Math.round(value) === 1 ? '' : 's'} above 10 °C`), value] : [null, NaN];
        case 'rainSeason': return land && value === value ? [L('Rain', `${classLabel('rainSeason', value)} (${fmt(value, 2)})`), value] : [null, NaN];
    }
    return [null, NaN];
}
/** The Köppen line: on the Köppen layer with the five groups shown, the group first (as the map draws it). */
function koppenLine(id, layer) {
    const K = KOPPEN_CLASSES[id], [r, g, b] = KOPPEN_RGB[id], gi = koppenGroupOf(id);
    const group = layer === 'koppen' && gi >= 0 ? `${KOPPEN_GROUPS[gi].name} · ` : '';
    return `<span class="hi-label">Clima</span> <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgb(${r},${g},${b});vertical-align:middle;margin-right:4px"></span>${group}${K.code} — ${K.name}`;
}

// ── the hover readout's climate lines, for terrain cell t; `lines.pin`: the legend's pin there ──
export function readoutLines(C, terrain, tMesh, t, layer = null, season = 'year') {
    const p = placementOf(tMesh), lines = [], land = landOf(terrain)(t);
    const stat = (key, c) => (C.cell.stats?.[key] ? statValue(C.cell.stats[key], key, c) : NaN);
    const [line, pin] = layerLine(layer, season, C, f => at(f, p, t), land, cellValue(layer, season, C, p, t, land, stat));
    if (line) lines.push(line);
    if (land) {
        lines.push(koppenLine(C.cell.koppen[t], layer));
        if (layer !== 'temperature' || season !== 'year') lines.push(`<span class="hi-label">Temp</span> ${C.cell.tAnnual[t].toFixed(1)} °C · the year`);
        if (layer !== 'rain' || season !== 'year') lines.push(`<span class="hi-label">Rain</span> ${rainYearText(C.cell.pAnnual[t] / 12)} · the year`);
    } else {
        lines.push(`<span class="hi-label">Sea</span> ${at((C.Tsea ?? C.T).year, p, t).toFixed(1)} °C · the year${at(C.ice, p, t) > 0.5 ? ' · sea ice' : ''}`);
    }
    lines.pin = pin;
    return lines;
}
