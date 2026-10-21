// The Evolution page's People layer (plans/CIV_PLAN.md): a detailed moment's people, from the first humans 70 000 years
// ago to now — worked out in a worker (civ/civ-worker.js) from the world its finish sent, once per detailed moment, on
// request (the layer chosen) — and drawn per pixel of the finished picture at the year chosen on the layer's own
// timeline: foragers in cool colours, farmers in warm ones, by density; the domestication centres ringed.

import { peopleOf, WAYS, TownFlag } from '../civ/civ-page.js';

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

    start() {
        const w = new Worker(new URL('../civ/civ-worker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => {
            const j = this.jobs.get(data.id);
            if (!j) return;
            if (data.type === 'progress') { j.onProgress?.(data.share); return; }
            this.jobs.delete(data.id);
            if (data.type === 'people') j.resolve(data); else j.reject(new Error(data.message));
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

// ── colours: foragers cool (violet → teal → green), farmers warm (dark red → orange → pale yellow), by density ──
const rampOf = stops => t => {
    t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
    return stops[i].map((v, k) => v + (stops[i + 1][k] - v) * f);
};
const COOL = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [190, 225, 60]];
const WARM = [[90, 10, 20], [180, 40, 30], [240, 120, 30], [255, 220, 120]];
const cool = rampOf(COOL), warm = rampOf(WARM);
/** Density's place on the ramps: 0.001 … 100 persons/km². */
const LO = -3, HI = 2;
const tOf = d => (Math.log10(d) - LO) / (HI - LO);
// (a table per frame byte: 256 colours)
const BYTE_RGB = new Uint8Array(3 * 256);
for (let b = 1; b < 256; b++) {
    const p = peopleOf(b), c = p.way >= 2 ? warm(tOf(p.d)) : cool(tOf(p.d) * 0.9 + (p.way === 1 ? 0.1 : 0));
    BYTE_RGB[3 * b] = c[0]; BYTE_RGB[3 * b + 1] = c[1]; BYTE_RGB[3 * b + 2] = c[2];
}
const SEA = [14, 20, 44];

/** A finish-view.js paintFinished colouring: the people of frame f, per pixel of a texture `width` wide. */
export function peopleColor(P, f, width, lut) {
    const L = lut.rgb, k = P.pixW / width, W = P.pixW, o0 = f * P.cells, frames = P.frames, pix = P.pix;
    return (out, o, x, y, wet, kk, k3, v, lake) => {
        if (wet || lake === 1 || lake === 2) {
            const s = 0.55 + 0.45 * kk;
            out[o] = SEA[0] * s; out[o + 1] = SEA[1] * s; out[o + 2] = SEA[2] * s; out[o + 3] = 255;
            return;
        }
        const b = frames[o0 + pix[Math.floor(y * k) * W + Math.floor(x * k)]];
        if (!b) {
            // (nobody: the land in grey, by its own colour's lightness, shaded)
            const g = (0.2 + 0.25 * (L[k3] + L[k3 + 1] + L[k3 + 2]) / 765) * 255 * kk;
            out[o] = g; out[o + 1] = g; out[o + 2] = g * 0.95; out[o + 3] = 255;
            return;
        }
        const s = 0.7 + 0.3 * kk;
        out[o] = Math.min(255, BYTE_RGB[3 * b] * s); out[o + 1] = Math.min(255, BYTE_RGB[3 * b + 1] * s); out[o + 2] = Math.min(255, BYTE_RGB[3 * b + 2] * s); out[o + 3] = 255;
    };
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

/** The towns of frame f (2500+ people), as dots by size on a texture's context (scaled to 2048 × 1024): a state's towns
 *  gold, its capital ringed. */
export function drawTowns(ctx, P, f) {
    const T = P.towns[f];
    if (!T) return;
    ctx.save();
    ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    for (let i = T.length - 4; i >= 0; i -= 4) {          // (the smallest first: the big drawn over them)
        const x = (T[i + 1] + 180) / 360 * 2048, y = (90 - T[i]) / 180 * 1024, r = Math.max(1.2, Math.sqrt(T[i + 2] / 2500) * 1.2), fl = T[i + 3];
        ctx.fillStyle = fl & TownFlag.STATE ? 'rgb(255,215,90)' : 'rgb(245,245,240)';
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        if (fl & TownFlag.CAPITAL) { ctx.strokeStyle = 'rgb(255,215,90)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 2 * Math.PI); ctx.stroke(); ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 0.8; }
    }
    ctx.restore();
}

/** The town nearest a point of the map (u, v as peopleLine), within px pixels of a 2048-wide map: [lat, lon, people, flags] or null. */
function townNear(P, f, u, v, px = 5) {
    const T = P.towns[f];
    if (!T) return null;
    let best = -1, bd = px * px;
    for (let i = 0; i < T.length; i += 4) {
        let dx = Math.abs((T[i + 1] + 180) / 360 * 2048 - u * 2048); if (dx > 1024) dx = 2048 - dx;
        const dy = (90 - T[i]) / 180 * 1024 - v * 1024, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = i; }
    }
    return best < 0 ? null : T.subarray(best, best + 4);
}

export const yearsWords = bp => (bp <= 0 ? 'Now' : `${Math.round(bp).toLocaleString()} years ago`);
const millions = v => (v >= 1e7 ? `${(v / 1e6).toFixed(0)} M` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} M` : `${Math.round(v / 1e3).toLocaleString()} K`);
const PKG_WORDS = { winterCereal: 'winter-rain cereals', summerCereal: 'summer-rain cereals', tuber: 'roots and tubers' };
const gradient = ramp => `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(t => `rgb(${ramp(t).map(Math.round).join(',')})`).join(', ')})`;

/** The legend: the year, how many, the two ramps and the centres so far. */
export function peopleLegendHTML(P, f) {
    const bp = P.bp[f], founded = P.centres.filter(c => c.bp >= bp), T = P.towns[f];
    let towns = 0, states = 0, biggest = 0;
    if (T) for (let i = 0; i < T.length; i += 4) { towns++; if (T[i + 3] & TownFlag.CAPITAL) states++; biggest = Math.max(biggest, T[i + 2]); }
    return `<div><b>People</b> · ${yearsWords(bp)} · ${millions(P.people[f])}${P.farmers[f] > 0 ? ` (${millions(P.farmers[f])} farmers)` : ''}</div>
<div class="evo-people-ramp"><span>Foragers</span><i style="background:${gradient(cool)}"></i></div>
<div class="evo-people-ramp"><span>Farmers</span><i style="background:${gradient(warm)}"></i></div>
${towns ? `<div class="evo-legend-note">● ${towns.toLocaleString()} towns of 2,500+ (the biggest ${Math.round(biggest).toLocaleString()})${states ? ` · <span style="color:rgb(255,215,90)">◎ ${states} state${states > 1 ? 's' : ''}</span>` : ''}</div>` : ''}
<div class="evo-legend-note">0.001 → 100 people per km² · ◯ a domestication centre${founded.length ? ` (${founded.length} so far; the first ${yearsWords(founded[0].bp).toLowerCase()}, ${PKG_WORDS[founded[0].pkg] ?? founded[0].pkg})` : ''}</div>`;
}

/** The readout's line for a point of the map (u, v as finish-view.js riverAt): who lives there at frame f. */
export function peopleLine(P, f, u, v) {
    const W = P.pixW, H = W >> 1, c = P.pix[Math.min(H - 1, Math.floor(v * H)) * W + Math.min(W - 1, Math.floor(u * W))];
    const p = peopleOf(P.frames[f * P.cells + c]);
    if (!p) return '<span class="hi-label">People</span> nobody yet';
    const d = p.d >= 10 ? p.d.toFixed(0) : p.d >= 1 ? p.d.toFixed(1) : p.d >= 0.01 ? p.d.toFixed(2) : p.d.toFixed(3);
    const t = townNear(P, f, u, v), town = !t ? '' : `<br><span class="hi-label">Town</span> ${(t[2] / 1000).toFixed(t[2] >= 1e4 ? 0 : 1)}k people${t[3] & TownFlag.IRRIGATED ? ', irrigation-fed' : ''}${t[3] & TownFlag.CAPITAL ? ' · a state’s capital' : t[3] & TownFlag.STATE ? ' · in a state' : ''}`;
    return `<span class="hi-label">People</span> ${WAYS[p.way]} · ${d} per km²${town}`;
}
