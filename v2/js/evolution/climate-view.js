// The Evolution page's climate (step D): the new climate (v2/js/climate/) for the moment shown, on request only — a
// "Calculate Climate" button, never automatic, never per frame (developer: "it takes way too long") — computed in a
// worker (climate-worker.js), kept per moment while the history is open, and drawn as layers: Köppen (per terrain
// cell), Temperature and Rain (Year / January / July), Wind & Pressure (sea-level pressure and wind arrows) and
// Currents (the sea's warm and cold water and its surface currents) — each shaded by the relief, as the Plates tab is.

import { KOPPEN_CLASSES } from '../climate/koppen.js';
import { RAMPS, rampColor, drawRampBar } from '../climate-lab/palettes.js';

export const CLIMATE_LAYERS = new Set(['koppen', 'temperature', 'rain', 'wind', 'currents']);
export const SEASONAL_LAYERS = new Set(['temperature', 'rain', 'wind']);
export const SEASON_WORDS = { year: 'the year', jan: 'January', jul: 'July' };

// ── the worker ──
export class ClimateService {
    constructor() { this.worker = null; this.jobs = new Map(); this.sent = new Set(); this.nextId = 1; }

    /** The climate of a frame's terrain (heights in km, the sea at 0) on a terrain mesh: a promise of the page's data. */
    compute(tMesh, heightKm) {
        this.worker ??= this.start();
        const key = tMesh.numCells;
        if (!this.sent.has(key)) { this.worker.postMessage({ type: 'mesh', key, xyz: tMesh.xyz }); this.sent.add(key); }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.jobs.set(id, { resolve, reject });
            this.worker.postMessage({ type: 'climate', id, key, heightKm: Float32Array.from(heightKm) });
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
        w.onerror = e => { for (const job of this.jobs.values()) job.reject(new Error(e.message || 'climate worker failed')); this.jobs.clear(); };
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
function lutOf(name) {
    tables ??= {
        temperature: table(RAMPS.temperature, -45, 45, 721),
        rain: table(RAMPS.rain, 0, 600, 512, v => Math.log1p(Math.max(0, v)), x => Math.expm1(x)),
        pressure: table(RAMPS.pressure, 985, 1040, 551),
        sst: table(RAMPS.oceanAnom, -7, 7, 281),
    };
    return tables[name];
}
function put(out, c, T, v, k) {
    const x = T.toX(v), i = 3 * Math.max(0, Math.min(T.n - 1, Math.round((x - T.a) / (T.b - T.a) * (T.n - 1))));
    out[3 * c] = Math.min(255, T.lut[i] * k); out[3 * c + 1] = Math.min(255, T.lut[i + 1] * k); out[3 * c + 2] = Math.min(255, T.lut[i + 2] * k);
}
const shadeOf = (terrain, c) => 0.45 + 0.55 * terrain.shade[c];

const KOPPEN_RGB = KOPPEN_CLASSES.map(k => k.color.map(v => Math.round(255 * v)));
const ICE_RGB = [232, 238, 244];

/** The moment's temperature at terrain cell c (°C): land from its own cell (its height and all), the sea at sea level. */
function temperatureAt(C, season, p, c, landCell) {
    if (!landCell) return at(C.T[season], p, c);
    const t = C.cell.tAnnual[c];
    return season === 'year' ? t : t + at(C.T[season], p, c) - at(C.T.year, p, c);
}
/** Rain at terrain cell c (mm/month). */
function rainAt(C, season, p, c, landCell) {
    if (!landCell) return at(C.P[season], p, c);
    const monthly = C.cell.pAnnual[c] / 12;
    if (season === 'year') return monthly;
    const y = at(C.P.year, p, c);
    return y > 0.01 ? monthly * at(C.P[season], p, c) / y : monthly;
}

/**
 * Colour the terrain cells for a climate layer. `terrain`: {heightKm, shade} of the frame; `relief(out)`: the terrain's
 * own colours (the palette chosen), for the land under the currents.
 */
export function paintClimate(layer, season, C, terrain, tMesh, out, relief) {
    const p = placementOf(tMesh), n = tMesh.numCells, h = terrain.heightKm;
    if (layer === 'koppen') {
        for (let c = 0; c < n; c++) {
            const k = shadeOf(terrain, c);
            let rgb = KOPPEN_RGB[h[c] > 0 ? C.cell.koppen[c] : 0];
            if (h[c] <= 0) { const ice = Math.min(1, Math.max(0, at(C.ice, p, c))); if (ice > 0.02) rgb = rgb.map((v, ch) => v + (ICE_RGB[ch] - v) * ice); }
            out[3 * c] = Math.min(255, rgb[0] * k); out[3 * c + 1] = Math.min(255, rgb[1] * k); out[3 * c + 2] = Math.min(255, rgb[2] * k);
        }
    } else if (layer === 'temperature') {
        const T = lutOf('temperature');
        for (let c = 0; c < n; c++) put(out, c, T, temperatureAt(C, season, p, c, h[c] > 0), shadeOf(terrain, c));
    } else if (layer === 'rain') {
        const T = lutOf('rain');
        for (let c = 0; c < n; c++) put(out, c, T, rainAt(C, season, p, c, h[c] > 0), shadeOf(terrain, c));
    } else if (layer === 'wind') {
        const T = lutOf('pressure');
        for (let c = 0; c < n; c++) put(out, c, T, at(C.slp[season], p, c), shadeOf(terrain, c));
    } else if (layer === 'currents') {
        // the sea: warm and cold water; the land: its own colours, greyed and dimmed
        relief(out);
        const T = lutOf('sst');
        for (let c = 0; c < n; c++) {
            if (h[c] <= 0) { put(out, c, T, at(C.sstAnom, p, c), shadeOf(terrain, c)); continue; }
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

// ── arrows: the winds or the currents, drawn on the equirectangular texture ──
/**
 * @param {CanvasRenderingContext2D} ctx  the texture's context, already scaled to the lighter texture's size
 * @param {number} width  that size (the texture is width × width/2)
 */
export function drawArrows(ctx, width, layer, season, C) {
    const H = width / 2, px = width / 360;              // pixels per degree
    const U = layer === 'wind' ? C.u[season] : C.currentU, V = layer === 'wind' ? C.v[season] : C.currentV;
    const only = layer === 'currents' ? C.sea : null;
    // (arrow length: the field's strong speeds — its 95th percentile — make a full-length arrow)
    const speeds = [];
    for (let c = 0; c < U.length; c += 7) if (!only || only[c]) speeds.push(Math.hypot(U[c], V[c]));
    speeds.sort((a, b) => a - b);
    const strong = speeds[Math.floor(0.95 * (speeds.length - 1))] || 1;
    const step = layer === 'wind' ? 7.5 : 6, full = step * px * 0.9;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = layer === 'wind' ? 'rgba(255,255,255,0.8)' : 'rgba(235,245,255,0.85)';
    ctx.lineWidth = Math.max(1, width / 1600);
    ctx.beginPath();
    for (let lat = 90 - step / 2; lat > -90; lat -= step) {
        const cl = Math.cos(lat * Math.PI / 180), lonStep = step / Math.max(0.2, cl);     // (about as dense near the poles)
        for (let lon = -180 + lonStep / 2; lon < 180; lon += lonStep) {
            const i = Math.min(359, Math.floor(lon + 180)), j = Math.min(179, Math.floor(90 - lat)), c = j * 360 + i;
            if (only && !only[c]) continue;
            const u = U[c], v = V[c], s = Math.hypot(u, v);
            if (!(s > strong * 0.04)) continue;
            const len = full * Math.min(1, s / strong);
            // (east–west stretched by 1/cos(latitude) on the texture, so the arrow comes out true on the globe)
            const dx = u / s * len / Math.max(0.2, cl), dy = -v / s * len;
            const x0 = (lon + 180) * px - dx / 2, y0 = (90 - lat) / 180 * H - dy / 2, x1 = x0 + dx, y1 = y0 + dy;
            ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
            const a = Math.atan2(dy, dx), hl = Math.min(len * 0.4, 5 * width / 2048);
            ctx.moveTo(x1, y1); ctx.lineTo(x1 - hl * Math.cos(a - 0.45), y1 - hl * Math.sin(a - 0.45));
            ctx.moveTo(x1, y1); ctx.lineTo(x1 - hl * Math.cos(a + 0.45), y1 - hl * Math.sin(a + 0.45));
        }
    }
    ctx.stroke();
    ctx.restore();
}

// ── the legend ──
export function drawLegend(el, layer, season, C, terrain) {
    const ramp = { temperature: RAMPS.temperature, rain: RAMPS.rain, wind: RAMPS.pressure, currents: RAMPS.oceanAnom }[layer];
    if (layer === 'koppen') {
        // the classes on this planet's land, the largest first
        const count = new Float64Array(KOPPEN_CLASSES.length);
        const k = C.cell.koppen, h = terrain.heightKm;
        let land = 0;
        for (let c = 0; c < k.length; c++) if (h[c] > 0) { count[k[c]]++; land++; }
        const rows = [...count.keys()].filter(i => i > 0 && count[i] / land >= 0.005).sort((a, b) => count[b] - count[a]);
        el.innerHTML = `<div class="evo-koppen">${rows.map(i => {
            const K = KOPPEN_CLASSES[i], [r, g, b] = KOPPEN_RGB[i];
            return `<span title="${K.name}"><i style="background:rgb(${r},${g},${b})"></i>${K.code} <em>${Math.round(100 * count[i] / land)}%</em></span>`;
        }).join('')}</div>`;
        return;
    }
    const note = { temperature: `°C, ${SEASON_WORDS[season]}`, rain: `mm per month, ${SEASON_WORDS[season]}`, wind: `sea-level pressure, hPa, ${SEASON_WORDS[season]} · arrows: the wind`,
        currents: 'the sea against its latitude’s average, °C · arrows: surface currents' }[layer];
    el.innerHTML = `<canvas width="560" height="44"></canvas><div class="evo-legend-note">${note}</div>`;
    drawRampBar(el.querySelector('canvas'), ramp);
}

// ── the hover readout's climate lines, for terrain cell t ──
export function readoutLines(C, terrain, tMesh, t) {
    const p = placementOf(tMesh), lines = [];
    if (terrain.heightKm[t] > 0) {
        const K = KOPPEN_CLASSES[C.cell.koppen[t]], [r, g, b] = KOPPEN_RGB[C.cell.koppen[t]];
        lines.push(`<span class="hi-label">Clima</span> <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgb(${r},${g},${b});vertical-align:middle;margin-right:4px"></span>${K.code} — ${K.name}`);
        lines.push(`<span class="hi-label">Temp</span> ${C.cell.tAnnual[t].toFixed(1)} °C a year`);
        lines.push(`<span class="hi-label">Rain</span> ${Math.round(C.cell.pAnnual[t]).toLocaleString()} mm a year`);
    } else {
        lines.push(`<span class="hi-label">Sea</span> ${at(C.T.year, p, t).toFixed(1)} °C a year${at(C.ice, p, t) > 0.5 ? ' · sea ice' : ''}`);
    }
    return lines;
}
