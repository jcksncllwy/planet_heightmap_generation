// Colour ramps for the climate lab. A ramp is a list of [value, [r, g, b]] stops (0–255), linearly interpolated.

export const RAMPS = {
    temperature: { unit: '°C', stops: [
        [-40, [42, 11, 94]], [-25, [49, 54, 149]], [-10, [69, 117, 180]], [0, [224, 243, 248]],
        [10, [254, 224, 144]], [20, [253, 174, 97]], [30, [215, 48, 39]], [40, [103, 0, 31]]] },
    rain: { unit: 'mm/month', log: true, stops: [
        [0, [246, 236, 212]], [10, [228, 214, 150]], [30, [180, 210, 110]], [60, [92, 176, 96]],
        [120, [33, 128, 120]], [250, [30, 90, 170]], [500, [20, 30, 110]]] },
    pressure: { unit: 'hPa', stops: [
        [990, [33, 102, 172]], [1002, [146, 197, 222]], [1012, [247, 247, 247]], [1022, [244, 165, 130]], [1034, [178, 24, 43]]] },
    oceanAnom: { unit: '°C vs latitude average', stops: [
        [-6, [33, 102, 172]], [-2, [146, 197, 222]], [0, [247, 247, 247]], [2, [244, 165, 130]], [6, [178, 24, 43]]] },
    oceanWarmthV1: { unit: 'V1 warmth (−1 cold … +1 warm)', stops: [
        [-1, [33, 102, 172]], [-0.35, [146, 197, 222]], [0, [247, 247, 247]], [0.35, [244, 165, 130]], [1, [178, 24, 43]]] },
    swing: { unit: '°C, warmest minus coldest month', stops: [
        [0, [240, 244, 250]], [5, [198, 219, 239]], [10, [120, 190, 200]], [20, [240, 200, 90]], [30, [230, 120, 50]], [45, [150, 30, 40]], [60, [70, 0, 30]]] },
    swingDiff: { unit: '°C (model − observed swing)', stops: [
        [-20, [5, 48, 97]], [-8, [67, 147, 195]], [-2, [209, 229, 240]], [0, [247, 247, 247]], [2, [253, 219, 199]], [8, [214, 96, 77]], [20, [103, 0, 31]]] },
    seaIce: { unit: 'ice fraction', stops: [[0, [16, 40, 80]], [0.15, [40, 80, 130]], [0.5, [150, 180, 210]], [1, [250, 252, 255]]] },
    tempDiff: { unit: '°C (V1 − observed)', stops: [
        [-12, [5, 48, 97]], [-6, [67, 147, 195]], [-2, [209, 229, 240]], [0, [247, 247, 247]], [2, [253, 219, 199]], [6, [214, 96, 77]], [12, [103, 0, 31]]] },
    rainRatio: { unit: 'V1 ÷ observed', log2: true, stops: [
        [-3, [140, 81, 10]], [-1.5, [216, 179, 101]], [-0.5, [246, 232, 195]], [0, [245, 245, 245]], [0.5, [199, 234, 229]], [1.5, [90, 180, 172]], [3, [1, 102, 94]]] },
    pressureDiff: { unit: 'hPa (V1 − observed)', stops: [
        [-15, [33, 102, 172]], [-5, [146, 197, 222]], [0, [247, 247, 247]], [5, [244, 165, 130]], [15, [178, 24, 43]]] },
};

export const NO_DATA_SEA = [22, 34, 52];     // sea where a field is land-only
export const NO_DATA_LAND = [58, 58, 62];    // land where a field is sea-only

/** Colour of value v on a ramp → [r, g, b]. Ramps flagged `log` interpolate on log(1 + v). */
export function rampColor(ramp, v) {
    const s = ramp.stops;
    const tx = ramp.log ? (x) => Math.log1p(Math.max(0, x)) : (x) => x;
    const x = tx(v);
    if (x <= tx(s[0][0])) return s[0][1];
    for (let k = 1; k < s.length; k++) {
        const x1 = tx(s[k][0]);
        if (x <= x1) {
            const x0 = tx(s[k - 1][0]), f = (x - x0) / (x1 - x0);
            const a = s[k - 1][1], b = s[k][1];
            return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
        }
    }
    return s[s.length - 1][1];
}

/** Draw a horizontal colour bar for a ramp into a canvas, with tick labels. */
export function drawRampBar(canvas, ramp) {
    const g = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height, barH = Math.round(h * 0.45);
    g.clearRect(0, 0, w, h);
    const s = ramp.stops, lo = s[0][0], hi = s[s.length - 1][0];
    const tx = ramp.log ? (x) => Math.log1p(Math.max(0, x)) : (x) => x;
    const xOf = (v) => ((tx(v) - tx(lo)) / (tx(hi) - tx(lo))) * (w - 1);
    for (let px = 0; px < w; px++) {
        // invert xOf for the pixel
        const f = px / (w - 1), tv = tx(lo) + f * (tx(hi) - tx(lo));
        const v = ramp.log ? Math.expm1(tv) : tv;
        const [r, gg, b] = rampColor(ramp, v);
        g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
        g.fillRect(px, 0, 1, barH);
    }
    g.fillStyle = '#8b93a7';
    g.font = `${Math.round(h * 0.38)}px system-ui, sans-serif`;
    g.textBaseline = 'bottom';
    for (const [v] of s) {
        const label = ramp.log2 ? (v === 0 ? '1×' : v > 0 ? `${2 ** v}×` : `1/${2 ** -v}`) : String(v);
        const x = xOf(v);
        g.textAlign = x < 10 ? 'left' : x > w - 10 ? 'right' : 'center';
        g.fillText(label, x, h);
    }
}

// ── the Evolution page's Climate view (climate-view.js): its own ramps, the lab's above left as they are ──
// Borrowed conventions (lane climviewA; ~/.cache/geo-sim/lanes-2026-10-29/climview/report.md §2.3): ColorBrewer's
// colour-blind-safe schemes (Brewer, colorbrewer2.org), viridis (van der Walt & Smith 2015), and Crameri, Shephard & Heron
// 2020 (Nature Communications 11:5444): no rainbow, no red against green, lightness monotonic for a magnitude. A view ramp
// carries its legend: `ticks` (values labelled under the bar), `lo`/`hi` (the bar's span) and `fmt` (a tick's label).
const viridisStops = [[0, [68, 1, 84]], [0.25, [59, 82, 139]], [0.5, [33, 145, 140]], [0.75, [94, 201, 98]], [1, [253, 231, 37]]];
export const VIEW_RAMPS = {
    // RdYlBu (ColorBrewer, 11 classes) diverging at freezing, the quantity's own midpoint; the warm side gets six steps
    // between 0 and 35 °C, where most land lives (the lab's ramp had three)
    temperature: { unit: '°C', lo: -40, hi: 40, ticks: [-40, -30, -20, -10, 0, 10, 20, 30, 40], stops: [
        [-45, [38, 30, 110]], [-30, [49, 54, 149]], [-20, [69, 117, 180]], [-10, [116, 173, 209]], [-3, [171, 217, 233]], [0, [224, 243, 248]],
        [5, [255, 255, 191]], [10, [254, 224, 144]], [15, [253, 174, 97]], [21, [244, 109, 67]], [27, [215, 48, 39]], [34, [165, 0, 38]], [45, [90, 0, 30]]] },
    // YlGnBu (ColorBrewer, 9 classes) on log(1 + mm a year), the stops at the isohyets' octaves (250 mm: the desert's edge)
    rain: { unit: 'mm a year', log: true, lo: 0, hi: 8000, ticks: [0, 125, 250, 500, 1000, 2000, 4000, 8000], stops: [
        [0, [255, 255, 217]], [125, [237, 248, 177]], [250, [199, 233, 180]], [500, [127, 205, 187]], [1000, [65, 182, 196]],
        [1500, [29, 145, 192]], [2000, [34, 94, 168]], [4000, [37, 52, 148]], [8000, [8, 29, 88]]],
        fmt: v => v >= 1000 ? `${v / 1000}k` : String(v) },
    // viridis taken halfway toward the night sky: quiet, so the wind's moving lines carry the flow and the colour only
    // says how fast
    wind: { unit: 'm/s', lo: 0, hi: 15, ticks: [0, 3, 6, 9, 12, 15],
        stops: viridisStops.map(([t, c]) => [15 * t, c.map((v, i) => 0.5 * v + 0.5 * [10, 12, 24][i])]) },
    // RdBu (ColorBrewer), the sea against its latitude's average; dimmed (× 0.62) so the currents' warm and cold lines
    // stand on it
    sstAnom: { unit: '°C against its latitude', lo: -6, hi: 6, ticks: [-6, -4, -2, 0, 2, 4, 6], fmt: v => (v > 0 ? '+' : '') + v,
        stops: [[-6, [33, 102, 172]], [-2, [146, 197, 222]], [0, [247, 247, 247]], [2, [244, 165, 130]], [6, [178, 24, 43]]].map(([v, c]) => [v, c.map(x => 0.62 * x + 6)]) },
    // RdBu, lows blue and highs red about the standard atmosphere's 1013 hPa
    pressure: { unit: 'hPa', lo: 985, hi: 1040, ticks: [988, 996, 1004, 1012, 1020, 1028, 1036], stops: [
        [985, [33, 102, 172]], [1002, [146, 197, 222]], [1013, [247, 247, 247]], [1024, [244, 165, 130]], [1040, [178, 24, 43]]] },
};
// The sea under a land question (Rain, Aridity, the land measures): dark, flat and neutral, so the coast is the strongest
// edge on the map and a dry coast shows as dry (report §2.3)
export const SEA_UNDER_LAND = [26, 29, 36];

/**
 * A view ramp's legend bar into a canvas: the ramp across [lo, hi] (on its log scale where it has one), ticks with values
 * under it, and a pin (a white triangle and line) at `pin` — the value under the cursor — when it is a number.
 */
export function drawLegendBar(canvas, ramp, pin = null) {
    const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    const pad = Math.round(w / 55), top = Math.round(h * 0.25), bh = Math.round(h * 0.38), font = Math.round(h * 0.24);
    const tx = ramp.log ? x => Math.log1p(Math.max(0, x)) : x => x, a = tx(ramp.lo), b = tx(ramp.hi);
    const xOf = v => pad + (tx(Math.max(ramp.lo, Math.min(ramp.hi, v))) - a) / (b - a) * (w - 2 * pad);
    c.clearRect(0, 0, w, h);
    for (let x = pad; x < w - pad; x++) {
        const t = a + (x - pad) / (w - 2 * pad) * (b - a), [r, g, bb] = rampColor(ramp, ramp.log ? Math.expm1(t) : t);
        c.fillStyle = `rgb(${r | 0},${g | 0},${bb | 0})`; c.fillRect(x, top, 1, bh);
    }
    c.fillStyle = '#aeb6cb'; c.font = `${font}px system-ui, sans-serif`; c.textBaseline = 'top';
    const fmt = ramp.fmt ?? String;
    for (const v of ramp.ticks) {
        const x = xOf(v);
        c.fillRect(Math.round(x) - 1, top + bh, 2, Math.round(h * 0.06));
        c.textAlign = x < pad + font ? 'left' : x > w - pad - font ? 'right' : 'center';
        c.fillText(fmt(v), x, top + bh + Math.round(h * 0.08));
    }
    if (typeof pin === 'number' && pin === pin) {
        const x = xOf(pin), s = Math.round(top * 0.45);
        c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = Math.max(1, h / 45);
        c.beginPath(); c.moveTo(x - s, 1); c.lineTo(x + s, 1); c.lineTo(x, top - 2); c.closePath(); c.fill(); c.stroke();
        c.fillRect(x - 1, top, 2, bh);
    }
}
