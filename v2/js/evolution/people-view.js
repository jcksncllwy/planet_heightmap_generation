// The Evolution page's People layer (plans/CIV_PLAN.md): a detailed moment's people, from the first humans 70 000 years
// ago to now — worked out in a worker (civ/civ-worker.js) from the world its finish sent, once per detailed moment, on
// request (the layer chosen) — and drawn per pixel of the finished picture at the year chosen on the layer's own
// timeline: foragers in cool colours, farmers in warm ones, herders in earth tones, by density; the domestication centres
// ringed.

import { peopleOf, WAYS, TownFlag, FOODS, byteFood } from '../civ/civ-page.js';

const ECONOMY = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('economy') : null;   // (read at load, before the page rewrites its URL)

export class PeopleService {
    constructor() { this.worker = null; this.jobs = new Map(); this.next = 1; }

    /** The people of a finish's civ world (finish-worker.js 'done' civ), for a picture `width` wide: a promise of
     *  civ-page.js peopleOfWorld's result. */
    run(world, width, onProgress = null) {
        const w = this.worker ??= this.start(), id = this.next++;
        return new Promise((resolve, reject) => {
            this.jobs.set(id, { resolve, reject, onProgress });
            w.postMessage({ type: 'people', id, world, width });
        });
    }

    /** Go on with a run (`run`: its result's id) to `toBP`, a frame every `every` years: a promise of civ-page.js
     *  morePeople's frames, to add to the run's (addPeople). */
    more(run, toBP, every) {
        const w = this.worker ??= this.start(), id = this.next++;
        return new Promise((resolve, reject) => {
            this.jobs.set(id, { resolve, reject });
            w.postMessage({ type: 'more', id, run, toBP, every });
        });
    }

    start() {
        // (the page's ?economy= — 'resources' for the economy, plans/CIV_PLAN.md §9.3 — goes on to the worker)
        const url = new URL('../civ/civ-worker.js', import.meta.url);
        if (ECONOMY) url.searchParams.set('economy', ECONOMY);
        const w = new Worker(url, { type: 'module' });
        w.onmessage = ({ data }) => {
            const j = this.jobs.get(data.id);
            if (!j) return;
            if (data.type === 'progress') { j.onProgress?.(data.share); return; }
            this.jobs.delete(data.id);
            if (data.type === 'people' || data.type === 'more') j.resolve(data); else j.reject(new Error(data.message));
        };
        w.onerror = e => {
            e.preventDefault?.();
            for (const j of this.jobs.values()) j.reject(new Error(e.message || 'the people worker stopped'));
            this.jobs.clear();
            if (this.worker === w) { w.terminate(); this.worker = null; }
        };
        return w;
    }
}

// ── colours: foragers cool (violet → teal → green), farmers warm (dark red → orange → pale yellow), herders earth (dark
// brown → sand), by density ──
const rampOf = stops => t => {
    t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
    return stops[i].map((v, k) => v + (stops[i + 1][k] - v) * f);
};
const COOL = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [190, 225, 60]];
const WARM = [[90, 10, 20], [180, 40, 30], [240, 120, 30], [255, 220, 120]];
const EARTH = [[55, 35, 20], [120, 80, 45], [185, 140, 85], [235, 210, 160]];
const cool = rampOf(COOL), warm = rampOf(WARM), earth = rampOf(EARTH);
/** Density's place on the ramps: 0.001 … 100 persons/km². */
const LO = -3, HI = 2;
const tOf = d => (Math.log10(d) - LO) / (HI - LO);
// (a table by way of life and density byte: (way << 6) | density)
const BYTE_RGB = new Uint8Array(3 * WAYS.length * 64);
for (let way = 0; way < WAYS.length; way++) for (let b = 1; b < 64; b++) {
    const p = peopleOf(b, way), t = tOf(p.d), c = way >= 3 ? warm(t) : way === 2 ? earth(t) : cool(t * 0.9 + (way === 1 ? 0.1 : 0)), i = 3 * ((way << 6) | b);
    BYTE_RGB[i] = c[0]; BYTE_RGB[i + 1] = c[1]; BYTE_RGB[i + 2] = c[2];
}
const SEA = [14, 20, 44];

/** A finish-view.js paintFinished colouring: the people of frame f, per pixel of a texture `width` wide. */
export function peopleColor(P, f, width, lut) {
    const L = lut.rgb, k = P.pixW / width, W = P.pixW, o0 = f * P.cells, frames = P.frames, ways = P.ways, pix = P.pix;
    return (out, o, x, y, wet, kk, k3, v, lake) => {
        if (wet || lake === 1 || lake === 2) {
            const s = 0.55 + 0.45 * kk;
            out[o] = SEA[0] * s; out[o + 1] = SEA[1] * s; out[o + 2] = SEA[2] * s; out[o + 3] = 255;
            return;
        }
        const i = o0 + pix[Math.floor(y * k) * W + Math.floor(x * k)], b = frames[i];
        if (!b) {
            // (nobody: the land in grey, by its own colour's lightness, shaded)
            const g = (0.2 + 0.25 * (L[k3] + L[k3 + 1] + L[k3 + 2]) / 765) * 255 * kk;
            out[o] = g; out[o + 1] = g; out[o + 2] = g * 0.95; out[o + 3] = 255;
            return;
        }
        const s = 0.7 + 0.3 * kk, j = 3 * (((ways[i] & 7) << 6) | b);
        out[o] = Math.min(255, BYTE_RGB[j] * s); out[o + 1] = Math.min(255, BYTE_RGB[j + 1] * s); out[o + 2] = Math.min(255, BYTE_RGB[j + 2] * s); out[o + 3] = 255;
    };
}

// ── the Land view (the economy's: plans/CIV_PLAN.md §9.3): how much of each place is in fields, and in pasture ──
const FIELD_RGB = [250, 205, 60], PASTURE_RGB = [150, 175, 90];
/** A land byte's share (sim.js packs each 0, or 1–15 on a log scale: 15 all of it, 10 a tenth, 5 a hundredth). */
const landShare = q => (q ? Math.pow(10, (q - 15) / 5) : 0);
/** A finish-view.js paintFinished colouring: frame f's land in fields (gold) and pasture (green), the brighter the more
 *  of it, over the land's grey — on the log scale it is packed on, from a thousandth of the land to all of it. */
export function landColor(P, f, width, lut) {
    const L = lut.rgb, k = P.pixW / width, W = P.pixW, o0 = f * P.cells, land = P.land, pix = P.pix;
    return (out, o, x, y, wet, kk, k3, v, lake) => {
        if (wet || lake === 1 || lake === 2) {
            const s = 0.55 + 0.45 * kk;
            out[o] = SEA[0] * s; out[o + 1] = SEA[1] * s; out[o + 2] = SEA[2] * s; out[o + 3] = 255;
            return;
        }
        const b = land[o0 + pix[Math.floor(y * k) * W + Math.floor(x * k)]];
        const t = q => (q ? 0.15 + 0.85 * q / 15 : 0), tf = t(b & 15), tp = t(b >> 4);
        const g = (0.2 + 0.25 * (L[k3] + L[k3 + 1] + L[k3 + 2]) / 765) * 255;
        for (let j = 0; j < 3; j++) { const pv = g + (PASTURE_RGB[j] - g) * tp; out[o + j] = Math.min(255, (pv + (FIELD_RGB[j] - pv) * tf) * kk); }
        out[o + 3] = 255;
    };
}
/** The Land view's legend. */
export function landLegendHTML(P, f) {
    const ramp = rgb => `linear-gradient(90deg, rgb(70,70,68), ${`rgb(${rgb.join(',')})`})`;
    return `<div><b>Land in use</b> · ${yearsWords(P.bp[f])}</div>
<div class="evo-people-ramp"><span>Fields</span><i style="background:${ramp(FIELD_RGB)}"></i></div>
<div class="evo-people-ramp"><span>Pasture</span><i style="background:${ramp(PASTURE_RGB)}"></i></div>
<div class="evo-legend-note">a thousandth of the land → all of it (log scale) · a herding people's pasture is all the open country it ranges</div>`;
}
/** The readout's line for the Land view. */
export function landLines(P, f, u, v) {
    const b = P.land[f * P.cells + cellAt(P, u, v)], pc = x => (x >= 0.1 ? `${Math.round(100 * x)} %` : x >= 0.01 ? `${(100 * x).toFixed(1)} %` : `${(100 * x).toFixed(2)} %`);
    if (!b) return ['<span class="hi-label">Land</span> no fields or pasture'];
    return [`<span class="hi-label">Land</span> fields ~${pc(landShare(b & 15))} · pasture ~${pc(landShare(b >> 4))} <span style="opacity:.6">of the land</span>`];
}

// ── the Food view (plans/CIV_PLAN.md §9.2): what the land offers, per resource — persons/km² it feeds at full skill ──
export const FOOD_WORDS = { largeGame: 'large game', smallGame: 'small game and fowl', aquatic: 'fish and shellfish', wildSeeds: 'wild grass seeds',
    wildRoots: 'wild roots', nuts: 'nuts and fruit', winterCereal: 'winter cereals', summerCereal: 'summer cereals', roots: 'roots and tubers',
    tree: 'tree crops', flooded: 'flooded fields', herds: 'herds' };
const WILD = FOODS.slice(0, 6), CROPS = ['winterCereal', 'summerCereal', 'roots', 'tree', 'flooded'];
const FOOD_HUE = { largeGame: [200, 120, 60], smallGame: [150, 110, 70], aquatic: [70, 150, 230], wildSeeds: [220, 200, 90], wildRoots: [190, 120, 160],
    nuts: [110, 170, 70], winterCereal: [240, 210, 80], summerCereal: [240, 140, 50], roots: [200, 90, 170], tree: [70, 200, 110], flooded: [80, 200, 220], herds: [210, 170, 130] };
/** The Food view's choices: one resource, all the wild ones together, or the best crop. */
export const FOOD_SHOWS = ['wild', 'crops', ...FOODS];
const FOOD_RANGE = { wild: [0.01, 3], herds: [0.1, 10] };          // (persons/km²: the wild per km² of country, crops per km² of fields)
const rangeOf = key => FOOD_RANGE[key] ?? (WILD.includes(key) ? FOOD_RANGE.wild : [1, 300]);
const foodAt = (P, key, c) => byteFood(P.food[FOODS.indexOf(key) * P.cells + c]);
/** A place's food for a choice: [persons/km², the resource whose colour it takes]. */
function foodOfCell(P, key, c) {
    if (key === 'wild') { let s = 0; for (const f of WILD) s += foodAt(P, f, c); return [s, null]; }
    if (key === 'crops') { let best = 0, bk = null; for (const f of CROPS) { const v = foodAt(P, f, c); if (v > best) { best = v; bk = f; } } return [best, bk]; }
    return [foodAt(P, key, c), key];
}
const foodT = (key, d) => { const [a, b] = rangeOf(key); return d > 0 ? Math.max(0, Math.min(1, Math.log(d / a) / Math.log(b / a))) : -1; };

/** A finish-view.js paintFinished colouring: the food of a choice (FOOD_SHOWS), per pixel of a texture `width` wide. */
export function foodColor(P, key, width, lut) {
    const L = lut.rgb, k = P.pixW / width, W = P.pixW, pix = P.pix;
    return (out, o, x, y, wet, kk, k3, v, lake) => {
        if (wet || lake === 1 || lake === 2) {
            const s = 0.55 + 0.45 * kk;
            out[o] = SEA[0] * s; out[o + 1] = SEA[1] * s; out[o + 2] = SEA[2] * s; out[o + 3] = 255;
            return;
        }
        const [d, f] = foodOfCell(P, key, pix[Math.floor(y * k) * W + Math.floor(x * k)]), t = foodT(key, d);
        if (t < 0) {
            const g = (0.2 + 0.25 * (L[k3] + L[k3 + 1] + L[k3 + 2]) / 765) * 255 * kk;
            out[o] = g; out[o + 1] = g; out[o + 2] = g * 0.95; out[o + 3] = 255;
            return;
        }
        const s = 0.7 + 0.3 * kk;
        if (!f) { const c = cool(t); out[o] = c[0] * s; out[o + 1] = c[1] * s; out[o + 2] = c[2] * s; out[o + 3] = 255; return; }
        const h = FOOD_HUE[f], lo = 0.18 + 0.82 * t;
        out[o] = Math.min(255, h[0] * lo * s); out[o + 1] = Math.min(255, h[1] * lo * s); out[o + 2] = Math.min(255, h[2] * lo * s); out[o + 3] = 255;
    };
}

/** The Food view's legend. */
export function foodLegendHTML(key) {
    const [a, b] = rangeOf(key), per = WILD.includes(key) || key === 'wild' || key === 'herds' ? 'per km² of country' : 'per km² of fields';
    const ramp = f => `linear-gradient(90deg, ${[0, 0.5, 1].map(t => `rgb(${FOOD_HUE[f].map(v => Math.round(v * (0.18 + 0.82 * t))).join(',')})`).join(', ')})`;
    const rows = key === 'crops' ? CROPS.map(f => `<div class="evo-people-ramp evo-food-ramp"><span>${FOOD_WORDS[f]}</span><i style="background:${ramp(f)}"></i></div>`).join('')
        : `<div class="evo-people-ramp evo-food-ramp"><span>${key === 'wild' ? 'all wild food' : FOOD_WORDS[key]}</span><i style="background:${key === 'wild' ? gradient(cool) : ramp(key)}"></i></div>`;
    return `<div><b>Food</b> · ${key === 'crops' ? 'the best crop' : key === 'wild' ? 'the wild' : FOOD_WORDS[key]} · what the land could feed at full skill</div>${rows}
<div class="evo-legend-note">${a} → ${b} people ${per}${key === 'crops' || CROPS.includes(key) ? ' (once the crop is domesticated and known)' : ''}</div>`;
}

/** The readout's line for the Food view: the place's richest resources. */
export function foodLines(P, u, v) {
    const c = cellAt(P, u, v), fmt = d => (d >= 10 ? d.toFixed(0) : d >= 1 ? d.toFixed(1) : d.toFixed(2));
    const top = list => list.map(f => [f, foodAt(P, f, c)]).filter(([, d]) => d > 0).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([f, d]) => `${FOOD_WORDS[f]} ${fmt(d)}`).join(' · ');
    const wild = top(WILD), crops = top(CROPS), herds = foodAt(P, 'herds', c), lines = [];
    if (wild) lines.push(`<span class="hi-label">Wild</span> ${wild} <span style="opacity:.6">per km²</span>`);
    if (crops) lines.push(`<span class="hi-label">Fields</span> ${crops} <span style="opacity:.6">per km² farmed</span>`);
    if (herds > 0) lines.push(`<span class="hi-label">Herds</span> ${fmt(herds)} <span style="opacity:.6">per km²</span>`);
    return lines;
}

/** The domestication centres founded by year bp, ringed on a texture's context (scaled by the caller to 2048 × 1024). */
export function drawCentres(ctx, P, bp) {
    ctx.save();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    for (const c of P.centres) {
        if (c.bp < bp) continue;
        const x = (c.lon + 180) / 360 * 2048, y = (90 - c.lat) / 180 * 1024;
        ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.restore();
}

/** A town's dot on a 2048-wide texture: by the log of its people (2500 → 0.7 px, 15 000 → 2, 50 000 → 2.9): towns are
 *  tens of km apart and a pixel is ~20 km, so dots by area would run together. */
const dotR = pop => 0.7 + 0.5 * Math.log2(Math.max(1, pop / 2500));

/** The towns of frame f (2500+ people), as dots by size on a texture's context (scaled to 2048 × 1024): a state's towns
 *  gold, its capital ringed; `selected` ({polity, lat, lon}, or null): that polity's towns ringed in cyan, the town itself
 *  in white. */
export function drawTowns(ctx, P, f, selected = null) {
    const T = P.towns[f];
    if (!T) return;
    const xy = i => [(T[i + 1] + 180) / 360 * 2048, (90 - T[i]) / 180 * 1024];
    ctx.save();
    ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    for (let i = T.length - 5; i >= 0; i -= 5) {          // (the smallest first: the big drawn over them)
        const [x, y] = xy(i), r = dotR(T[i + 2]), fl = T[i + 3];
        ctx.fillStyle = fl & TownFlag.STATE ? 'rgb(255,215,90)' : 'rgb(245,245,240)';
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        if (fl & TownFlag.CAPITAL) { ctx.strokeStyle = 'rgb(255,215,90)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(x, y, r + 1.6, 0, 2 * Math.PI); ctx.stroke(); ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 0.6; }
    }
    const sel = selected ? townAt(P, f, selected.lat, selected.lon, 40) : -1;
    if (sel >= 0) {
        ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgb(90,230,255)';
        for (let i = 0; i < T.length; i += 5) if (T[i + 4] === T[sel + 4] && i !== sel) { const [x, y] = xy(i); ctx.beginPath(); ctx.arc(x, y, dotR(T[i + 2]) + 1.4, 0, 2 * Math.PI); ctx.stroke(); }
        const [x, y] = xy(sel);
        ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, dotR(T[sel + 2]) + 2.4, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.restore();
}

const DEG = Math.PI / 180;
const kmBetween = (la1, lo1, la2, lo2) => 2 * 6371 * Math.asin(Math.sqrt(Math.sin((la2 - la1) * DEG / 2) ** 2 + Math.cos(la1 * DEG) * Math.cos(la2 * DEG) * Math.sin((lo2 - lo1) * DEG / 2) ** 2));
/** The place (u west → east, v north → south) as [lat, lon]. */
export const latLonOf = (u, v) => [90 - v * 180, u * 360 - 180];

/** The town of frame f nearest a place (lat, lon), within km: its index in P.towns[f] (a multiple of 5), or −1. */
export function townAt(P, f, lat, lon, km) {
    const T = P.towns[f];
    if (!T) return -1;
    let best = -1, bd = km;
    for (let i = 0; i < T.length; i += 5) { const d = kmBetween(lat, lon, T[i], T[i + 1]); if (d < bd) { bd = d; best = i; } }
    return best;
}
/** The town under a pointer at (u, v) on frame f — within `px` of its dot on a 2048-wide map, or a little more on a
 *  small one — its index, or −1. */
export function townUnder(P, f, u, v, px = 4) {
    const T = P.towns[f];
    if (!T) return -1;
    let best = -1, bd = Infinity;
    for (let i = 0; i < T.length; i += 5) {
        let dx = Math.abs((T[i + 1] + 180) / 360 * 2048 - u * 2048); if (dx > 1024) dx = 2048 - dx;
        const dy = (90 - T[i]) / 180 * 1024 - v * 1024, d = Math.hypot(dx, dy) - dotR(T[i + 2]);
        if (d < px && d < bd) { bd = d; best = i; }
    }
    return best;
}
/** A polity's row in frame f's table (polity.js packedPolities): {towns, people, capLat, capLon, capPop, state}, or null. */
function polityOf(P, f, id) {
    const Q = P.polities?.[f];
    if (!Q) return null;
    for (let i = 0; i < Q.length; i += 7) if (Q[i] === id) return { towns: Q[i + 1], people: Q[i + 2], capLat: Q[i + 3], capLon: Q[i + 4], capPop: Q[i + 5], state: Q[i + 6] > 0 };
    return null;
}

export const yearsWords = bp => { const w = agoWords(bp); return w[0].toUpperCase() + w.slice(1); };

/** Add a run's further frames (PeopleService.more) to its people: the frames' bytes into buffers that grow by doubling
 *  (so a long run on stays cheap), the rest replaced or appended. */
export function addPeople(P, more) {
    const k = P.bp.length, m = more.bp.length, need = (k + m) * P.cells;
    const grow = a => { if (need <= a.length) return a; const b = new Uint8Array(Math.max(need, 2 * a.length)); b.set(a.subarray(0, k * P.cells)); return b; };
    P.frames = grow(P.frames); P.ways = grow(P.ways);
    P.frames.set(more.frames, k * P.cells); P.ways.set(more.ways, k * P.cells);
    if (P.land && more.land) { P.land = grow(P.land); P.land.set(more.land, k * P.cells); }
    const join = (a, b) => { const c = new a.constructor(a.length + b.length); c.set(a); c.set(b, a.length); return c; };
    P.bp = join(P.bp, more.bp); P.people = join(P.people, more.people); P.farmers = join(P.farmers, more.farmers);
    P.towns.push(...more.towns); P.polities.push(...more.polities);
    P.centres = more.centres; P.place = more.place;
}
const millions = v => (v >= 1e7 ? `${(v / 1e6).toFixed(0)} M` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} M` : `${Math.round(v / 1e3).toLocaleString()} K`);
const PKG_WORDS = { winterCereal: 'winter-rain cereals', summerCereal: 'summer-rain cereals', tuber: 'roots and tubers', roots: 'roots and tubers', tree: 'tree crops', flooded: 'flooded fields', herds: 'herds' };
const gradient = ramp => `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(t => `rgb(${ramp(t).map(Math.round).join(',')})`).join(', ')})`;

/** The legend: the year, how many, the ramps (herders' where there are any) and the centres so far. */
export function peopleLegendHTML(P, f) {
    const bp = P.bp[f], founded = P.centres.filter(c => c.bp >= bp), T = P.towns[f];
    let herders = false;
    for (let i = f * P.cells, e = i + P.cells; i < e && !herders; i++) herders = P.frames[i] > 0 && (P.ways[i] & 7) === 2;
    let towns = 0, states = 0, biggest = 0;
    if (T) for (let i = 0; i < T.length; i += 5) { towns++; if (T[i + 3] & TownFlag.CAPITAL) states++; biggest = Math.max(biggest, T[i + 2]); }
    return `<div><b>People</b> · ${yearsWords(bp)} · ${millions(P.people[f])}${P.farmers[f] > 0 ? ` (${millions(P.farmers[f])} farmers)` : ''}</div>
<div class="evo-people-ramp"><span>Foragers</span><i style="background:${gradient(cool)}"></i></div>
<div class="evo-people-ramp"><span>Farmers</span><i style="background:${gradient(warm)}"></i></div>
${herders ? `<div class="evo-people-ramp"><span>Herders</span><i style="background:${gradient(earth)}"></i></div>` : ''}
${towns ? `<div class="evo-legend-note">● ${towns.toLocaleString()} towns of 2,500+ (the biggest ${Math.round(biggest).toLocaleString()})${states ? ` · <span style="color:rgb(255,215,90)">◎ ${states} state${states > 1 ? 's' : ''}</span>` : ''}</div>` : ''}
<div class="evo-legend-note">0.001 → 100 people per km² · ◯ a domestication centre${founded.length ? ` (${founded.length} so far; the first ${yearsWords(founded[0].bp).toLowerCase()}, ${PKG_WORDS[founded[0].pkg] ?? founded[0].pkg})` : ''}</div>`;
}

const TIER_WORDS = ['Village', 'Small town', 'Town', 'City'];
const tierOfPop = pop => (pop >= 15000 ? 3 : pop >= 2500 ? 2 : pop >= 500 ? 1 : 0);
const k = v => (v >= 1e4 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
const agoWords = bp => (bp > 0 ? `${Math.round(bp).toLocaleString()} years ago` : bp < 0 ? `${Math.round(-bp).toLocaleString()} years after now` : 'now');
/** The cell under a place (u, v). */
const cellAt = (P, u, v) => { const W = P.pixW, H = W >> 1; return P.pix[Math.min(H - 1, Math.floor(v * H)) * W + Math.min(W - 1, Math.floor(u * W))]; };
const pct = v => `${Math.round(v)} %`;

/** What a place's land does to its people, for the readout and a town's card: [the year's spread of its rain (and its
 *  river's flood, where it can be irrigated), its famines, its fever] as words, each or null. */
function hazards(P, c) {
    const Q = P.place;
    if (!Q) return [];
    const out = [];
    out.push(`rain ±${pct(Q.rainCV[c])} a year` + (Q.irrigable[c] && Q.floodCV[c] ? `, its river's flood ±${pct(Q.floodCV[c])}` : ''));
    if (Q.famine[c] > 0.0005) out.push(`famine kills ~${(Q.famine[c]).toFixed(Q.famine[c] >= 0.1 ? 1 : 2)} % a year`);
    if (Q.fever[c] > 5) out.push(`fever costs ~${pct(100 * Q.fever[c] / 255)} of its settled people`);
    return out;
}

/** The readout's lines for a point of the map (u, v as finish-view.js riverAt) at frame f: who lives there, since when, what
 *  the land does to them, and the town near. */
export function peopleLines(P, f, u, v) {
    const c = cellAt(P, u, v), p = peopleOf(P.frames[f * P.cells + c], P.ways[f * P.cells + c]), Q = P.place, lines = [];
    if (!p) lines.push('<span class="hi-label">People</span> nobody yet');
    else {
        const d = p.d >= 10 ? p.d.toFixed(0) : p.d >= 1 ? p.d.toFixed(1) : p.d >= 0.01 ? p.d.toFixed(2) : p.d.toFixed(3);
        lines.push(`<span class="hi-label">People</span> ${WAYS[p.way]}${p.crop ? ` of ${FOOD_WORDS[p.crop]}` : ''} · ${d} per km²`);
    }
    if (Q) {
        const bp = P.bp[f], came = Q.arrivalBP[c], farmed = Q.farmBP[c], since = [];
        if (came >= bp) since.push(`people ${agoWords(came)}`);
        if (farmed >= bp) since.push(`farming ${agoWords(farmed)}${Q.pkg[c] >= 0 ? ` (${PKG_WORDS[P.packages[Q.pkg[c]]] ?? P.packages[Q.pkg[c]]})` : ''}`);
        if (since.length) lines.push(`<span class="hi-label">Since</span> ${since.join(' · ')}`);
        const hz = hazards(P, c);
        if (hz.length) lines.push(`<span class="hi-label">Land</span> ${hz.join(' · ')}`);
    }
    // (the town under the pointer, as a click would take it; else the nearest within 30 km)
    const [lat, lon] = latLonOf(u, v), under = townUnder(P, f, u, v, 5), i = under >= 0 ? under : townAt(P, f, lat, lon, 30), T = P.towns[f];
    if (i >= 0) lines.push(`<span class="hi-label">Town</span> ${k(T[i + 2])} people${T[i + 3] & (TownFlag.IRRIGATED | TownFlag.CANAL_FED) ? ', irrigation-fed' : ''}${T[i + 3] & TownFlag.CAPITAL ? ' · a state\u2019s capital' : T[i + 3] & TownFlag.STATE ? ' · in a state' : ''} <span style="opacity:.6">(click it)</span>`);
    return lines;
}

/** How long a town has stood near here: back through the frames while a town of 2500+ stood within 40 km — the years ago it
 *  first did. */
function standingSince(P, f, lat, lon) {
    let first = P.bp[f];
    for (let g = f - 1; g >= 0 && P.towns[g]; g--) { if (townAt(P, g, lat, lon, 40) < 0) break; first = P.bp[g]; }
    return first;
}

/** A town's card: its people, what feeds it, its polity, how long it has stood, what its land does to it. */
export function townCardHTML(P, f, i) {
    const T = P.towns[f], lat = T[i], lon = T[i + 1], pop = T[i + 2], fl = T[i + 3], id = T[i + 4], bp = P.bp[f];
    const c = cellAt(P, (lon + 180) / 360, (90 - lat) / 180), Q = P.place, pl = peopleOf(P.frames[f * P.cells + c], P.ways[f * P.cells + c]), pol = polityOf(P, f, id);
    const rows = [];
    rows.push(['Fed by', fl & TownFlag.IRRIGATED ? 'irrigated fields along its river, and the surplus brought to it'
        : fl & TownFlag.CANAL_FED ? 'grain brought from irrigated land nearby, or along its river or coast; its own fields are rain-fed'
        : 'rain-fed fields, and the surplus brought to it']);
    if (pl) rows.push(['Around it', `${WAYS[pl.way]}${pl.crop ? ` of ${FOOD_WORDS[pl.crop]}` : ''}, ${pl.d >= 10 ? pl.d.toFixed(0) : pl.d.toFixed(1)} per km²` + (Q && Q.farmBP[c] >= bp ? `; farming here since ${agoWords(Q.farmBP[c])}` : '')]);
    if (pol) {
        const isCap = Math.abs(pol.capLat - lat) < 0.01 && Math.abs(pol.capLon - lon) < 0.01, kind = pol.state ? 'a state' : pol.towns > 1 ? 'a chiefdom' : null;
        let words;
        if (!kind) words = 'its own: no other town answers to it, and it answers to none';
        else if (isCap) words = `the capital of ${kind}: ${pol.towns} towns, ${k(pol.people)} people in them`;
        else words = `one of ${pol.towns} towns of ${kind} ruled from a ${TIER_WORDS[tierOfPop(pol.capPop)].toLowerCase()} of ${k(pol.capPop)}, ${Math.round(kmBetween(lat, lon, pol.capLat, pol.capLon))} km away`;
        rows.push(['Polity', words + (pol.state ? ' <span style="opacity:.65">(three tiers of towns above its villages: Wright & Johnson\u2019s state)</span>' : kind ? ' <span style="opacity:.65">(fewer than three tiers: not yet a state)</span>' : '')]);
    }
    rows.push(['Stood here', `a town since ${agoWords(standingSince(P, f, lat, lon))}`]);
    const hz = hazards(P, c);
    if (hz.length) rows.push(['Its land', hz.join('; ')]);
    return `<div class="evo-town-head"><b>${TIER_WORDS[tierOfPop(pop)]} of ${Math.round(pop).toLocaleString()}</b>${fl & TownFlag.CAPITAL ? ' <span class="evo-town-badge">capital</span>' : fl & TownFlag.STATE ? ' <span class="evo-town-badge">in a state</span>' : ''}</div>
<div class="evo-town-sub">${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'} · ${yearsWords(bp)}</div>
<dl>${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>`;
}
