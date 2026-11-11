// The place's panel: a click (or a tap) on the planet opens everything the page knows of that place, at the moment shown —
// far more than the hover readout's few lines, in sections: Place, Climate (with its climograph), Water, Ground, People,
// and Life (a placeholder: the ecology lane fills it — lanes ecodesign §8).
//
// It reads only what the page already holds (no new physics):
//   the moment's frame (the sim cell under the place: its crust, plate and history — tectonics/snapshot.js),
//   the live terrain (its heights, the seas cut off from the ocean and their levels — terrain-player.js),
//   a preview climate where the page has worked one out (climate-view.js ClimateService: its terrain cells' Köppen,
//   year and measures, and the 1° grid's fields),
//   and, on a detailed moment (Add detail), the finish's picture (heights, sea, lakes), rivers, its own climate picture
//   (Köppen, year, measures, ground cover) and the People layer's world where it was worked out.
// A section that needs a detailed moment says "add detail to see …".
//
// placeFacts(state, lat, lon) gathers the facts of a place into one plain object, and the panel draws them; the ecology
// section (to come) reads the same object — what ecodesign §1 lists per cell, as far as the page has it.
//
// Where it sits: on the right, in the town card's slot (one card there at a time), never following the pointer; on a
// phone, a sheet above the timeline. It keeps the PLACE (its latitude and longitude), not a cell: when the moment changes
// it shows what is there then — the plates move under a place, and following one place through time is the point —
// rather than closing. A click elsewhere on the planet moves it there; a click off the planet, Esc or × closes it.
// Clicks on the page's controls leave it open (the timeline is how its moment changes).

import { locate } from '../core/mesh-locate.js';
import { KOPPEN_CLASSES, classifyCell } from '../climate/koppen.js';
import { STAT_KEYS, statValue } from '../climate/cell-stats.js';
import { PARAMS } from '../climate/config.js';
import { BIOME_WORDS } from '../finish/finish-cover.js';
import { CrustType, CrustFlag, OrogenyType, VolcanicType } from '../tectonics/model/crust.js';
import { decodeCoverKm, decodeExhumKm, decodeFacies } from '../tectonics/model/geology.js';
import { crustThicknessKm, columnModel, Margin } from '../tectonics/measure.js';
import { terrainConfig } from '../terrain/terrain-config.js';
import { classLabel } from '../../../js/climate-layers.js';
import { finishedAt, riverAt, riverYearWords, REGIME_STYLE } from './finish-view.js';
import { landPixel } from './climate-view.js';
import { CRUST_WORDS, settingOf } from './looks.js';

const MONTHS = 'JFMAMJJASOND';
const R_KM = 6371;
const REFRESH_MS = 150;                 // (while the moment plays, the panel is drawn again at most this often)
const COAST_SEARCH_KM = 1500;           // (farther from a coast than this: "more than 1,500 km")
const ACTIVE_MYR = 15;                  // (looks.js's: a belt built on within this long is active; a snapshot is 10 Myr)
const BELT_KIND = {
    [OrogenyType.ANDEAN]: 'Andean range (an ocean going down under a continent)', [OrogenyType.LARAMIDE]: 'Flat-slab range (a shallow slab far inland)',
    [OrogenyType.URAL]: 'Collision belt (two landmasses met)', [OrogenyType.HIMALAYAN]: 'Great collision belt (a thick plateau)',
    [OrogenyType.ARC]: 'Volcanic arc', [OrogenyType.RIFT]: 'Rift shoulder (the crust pulled apart)', [OrogenyType.TRANSPRESSION]: 'Transform ridge (plates sliding and squeezing)',
};
const MARGIN_WORDS = { [Margin.PASSIVE]: 'a passive coast (no trench offshore: wide shelf)', [Margin.ACTIVE]: 'an active coast (a trench offshore: narrow shelf)', [Margin.TRANSFORM]: 'a transform coast (the plate slides past its neighbour)', [Margin.COLLISION]: 'a collision coast' };
const WATER_WORDS = ['', 'a fresh lake', 'a salt lake (a closed basin)', 'a salt pan (a closed basin)'];

// ── the facts of a place ──

const C3 = [0, 0, 0], W3 = [0, 0, 0];
/** The terrain cell that weighs most at (lat, lon) (°): the mesh triangle's corner a pixel there blends most (evolution-main.js cellUnder). */
function terrainCell(mesh, lat, lon) {
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    locate(mesh, Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la), C3, W3);
    return C3[W3[0] >= W3[1] && W3[0] >= W3[2] ? 0 : W3[1] >= W3[2] ? 1 : 2];
}
/** The sim cell that weighs most in terrain cell t (its crust, plate and history): the readout's choice. */
export function simCellOf(T, t) {
    const { cells, weights } = T.sampler;
    let w = cells[3 * t];
    if (weights[3 * t + 1] > weights[3 * t] && weights[3 * t + 1] >= weights[3 * t + 2]) w = cells[3 * t + 1];
    else if (weights[3 * t + 2] > weights[3 * t] && weights[3 * t + 2] > weights[3 * t + 1]) w = cells[3 * t + 2];
    return w;
}
/** The 1° grid's four corners and weights at (lat, lon) — as the climate reads a cell (climate/core.js finishCells). */
function gridCorners(grid, lat, lon) {
    const w = grid.w, h = grid.h, step = 180 / h;
    const x = (lon + 180) / step - 0.5, y = Math.max(0, Math.min(h - 1, (90 - lat) / step - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i0 = ((x0 % w) + w) % w, i1 = i0 + 1 === w ? 0 : i0 + 1, j1 = y0 + 1 < h ? y0 + 1 : y0;
    return { c: [y0 * w + i0, y0 * w + i1, j1 * w + i0, j1 * w + i1], k: [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy] };
}
const gridValue = (field, g) => g.k[0] * field[g.c[0]] + g.k[1] * field[g.c[1]] + g.k[2] * field[g.c[2]] + g.k[3] * field[g.c[3]];

/**
 * A place's twelve months (°C, mm), from the climate's twelve months on its 1° grid (climate-fields.js months). On land,
 * shifted and scaled to the place's own year (tAnnual, pAnnual): the climate makes a cell's months from the same four grid
 * cells, then lowers them all by one lapse (its height) and scales them all by one factor (its relief's rain, the
 * texture), so for ONE cell the shifted and scaled months are that cell's (finishCells). A detailed moment's raster is
 * not one cell: its year (tAnnual, pAnnual) blends the pixel's three cells, its Köppen class is the weightiest one's —
 * so at a class border or on steep relief the months can read as a neighbouring class (smoke 2026-11-10: 182 of 193
 * land clicks agree; the 11 others mostly next-door classes). The panel names the map's class, as the map and hover do.
 * At sea: the grid's own months at sea level. null where the climate has no months (a climate from before they were kept).
 */
export function placeMonths(C, lat, lon, tAnnual = NaN, pAnnual = NaN) {
    const M = C?.months;
    if (!M) return null;
    const G = C.grid.w * C.grid.h, g = gridCorners(C.grid, lat, lon), T12 = new Float64Array(12), P12 = new Float64Array(12);
    let ts = 0, ps = 0;
    for (let m = 0; m < 12; m++) {
        let t = 0, kt = 0, p = 0;
        for (let j = 0; j < 4; j++) {
            const i = m * G + g.c[j], v = M.T[i];
            if (v !== -32768) { t += g.k[j] * v / 100; kt += g.k[j]; }
            p += g.k[j] * M.P[i] / 10;
        }
        T12[m] = kt > 0 ? t / kt : NaN; P12[m] = p; ts += T12[m]; ps += p;
    }
    if (tAnnual === tAnnual) for (let m = 0; m < 12; m++) T12[m] += tAnnual - ts / 12;
    if (pAnnual === pAnnual) for (let m = 0; m < 12; m++) P12[m] = ps > 0 ? P12[m] * pAnnual / ps : pAnnual / 12;
    return { T12, P12 };
}

const snowAt = t => { const x = (PARAMS.TEMP_ICE_WARM_C - t) / (PARAMS.TEMP_ICE_WARM_C - PARAMS.TEMP_ICE_COLD_C); return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); };
function greatCircleKm(la1, lo1, la2, lo2) {
    const r = Math.PI / 180, a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The nearest pixel of the finished picture on the other side of the coast (land ↔ world ocean), in km — or Infinity
 *  past COAST_SEARCH_KM. Ring by ring outward in rows; each row's reach in columns grows by 1 / cos(latitude) (a ring is
 *  as wide in km as it is tall), so each ring looks only at the columns the last did not; once one is found, only the
 *  rings a nearer one could still be in. */
function coastKmFinished(r, lat, lon) {
    const w = r.w, h = r.h, x0 = Math.min(w - 1, Math.floor((lon + 180) / 360 * w)), y0 = Math.min(h - 1, Math.floor((90 - lat) / 180 * h));
    const sea = r.ocean[y0 * w + x0], kmPx = 180 / h * 111.2, maxRing = Math.ceil(COAST_SEARCH_KM / kmPx);
    const reach = (y, ring) => (ring <= 0 ? -1 : Math.min(w >> 1, Math.ceil(ring / Math.max(0.02, Math.cos((90 - (y + 0.5) / h * 180) * Math.PI / 180)))));
    let best = Infinity, stopAt = maxRing;
    const look = (x, y) => {
        x = ((x % w) + w) % w;
        if (r.ocean[y * w + x] === sea) return;
        const d = greatCircleKm(lat, lon, 90 - (y + 0.5) / h * 180, (x + 0.5) / w * 360 - 180);
        if (d < best) { best = d; stopAt = Math.min(maxRing, Math.ceil(best / kmPx) + 1); }
    };
    for (let ring = 1; ring <= stopAt; ring++) {
        for (let y = Math.max(0, y0 - ring); y <= Math.min(h - 1, y0 + ring); y++) {
            const rx = reach(y, ring), edge = Math.abs(y - y0) === ring;
            if (edge) { for (let dx = -rx; dx <= rx; dx++) look(x0 + dx, y); continue; }
            const from = reach(y, ring - 1) + 1;           // (the columns this ring adds on this row, each side)
            for (let dx = from; dx <= rx; dx++) { look(x0 + dx, y); if (dx) look(x0 - dx, y); }
        }
    }
    return best <= COAST_SEARCH_KM ? best : Infinity;
}
/** The same on the live terrain: outward over the mesh's neighbours to the nearest cell across sea level (km), or
 *  Infinity (or null without the mesh's neighbours). */
function coastKmTerrain(mesh, T, t, seaLevelKm) {
    if (!mesh.adjOffset || !mesh.adjList) return null;
    const xyz = mesh.xyz, h = T.paintKm ?? T.heightKm, below = h[t] < seaLevelKm, seen = new Set([t]), lim = COAST_SEARCH_KM / R_KM;
    let front = [t], best = Infinity;
    const ang = c => Math.acos(Math.max(-1, Math.min(1, xyz[3 * t] * xyz[3 * c] + xyz[3 * t + 1] * xyz[3 * c + 1] + xyz[3 * t + 2] * xyz[3 * c + 2])));
    while (front.length && seen.size < 400000) {
        const next = [];
        for (const c of front) for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) {
            const n = mesh.adjList[k];
            if (seen.has(n)) continue;
            seen.add(n);
            const a = ang(n);
            if (a > lim) continue;
            if ((h[n] < seaLevelKm) !== below) { if (a < best) best = a; } else if (a < best) next.push(n);
        }
        front = next;
    }
    return best === Infinity ? Infinity : best * R_KM;
}

/** Follow a finished river from point i down to where it ends (reach after reach, through the confluences: finish-fsm.js
 *  starts a reach at each head and ends it on its receiver's point) — its end point and the km along the way. */
function downstream(fin, i) {
    const R = fin.rivers, starts = R.start, n = R.lat.length;
    if (!fin.riverHeads) {
        fin.riverHeads = new Map();
        for (let r = 0; r < starts.length; r++) fin.riverHeads.set(`${R.lat[starts[r]]},${R.lon[starts[r]]}`, r);
    }
    const reachOf = j => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= j) lo = m; else hi = m - 1; } return lo; };
    let r = reachOf(i), j = i, km = 0;
    for (let guard = 0; guard < 100000; guard++) {
        const end = (r + 1 < starts.length ? starts[r + 1] : n) - 1;
        for (; j < end; j++) km += greatCircleKm(R.lat[j], R.lon[j], R.lat[j + 1], R.lon[j + 1]);
        const next = fin.riverHeads.get(`${R.lat[end]},${R.lon[end]}`);
        if (next === undefined || next === r) return { end, km };
        r = next; j = starts[r];
    }
    return { end: j, km };
}

/**
 * Everything the page knows of a place at the moment shown — one plain object (null fields where the page has nothing).
 * state: the page's — { b (the history: frames, finishes, heights), frame, T (its live terrain), mesh (the terrain mesh),
 * fin (the finished moment shown, or null), climate (the preview climate on the terrain cells, or null), people
 * (fin.people where the People layer is worked out and shown), PV (people-view.js, once loaded), peopleFrame, seaLevelKm }.
 */
export function placeFacts(state, lat, lon) {
    const { b, frame: f, T, mesh, fin } = state;
    if (!f || !T || !mesh) return null;
    const u = (lon + 180) / 360, v = (90 - lat) / 180, t = terrainCell(mesh, lat, lon), w = simCellOf(T, t);
    const F = { lat, lon, u, v, timeMyr: f.time, detailed: !!fin, terrainCell: t, simCell: w };

    // ── place ──
    const at = fin ? finishedAt(fin, u, v) : null, hKm = T.heightKm[t] - state.seaLevelKm;
    F.heightM = at ? at.heightM : hKm * 1000;
    const water = T.water;
    if (at) F.kind = at.ocean ? 'ocean' : at.water ? ['', 'lake', 'saltLake', 'saltPan'][at.water] : 'land';
    else if (water?.given?.[t] === 1) F.kind = 'sillSea';
    else if (water?.given?.[t] === 2) F.kind = 'sillBasin';
    else if (water?.cut?.[t] === 1 && (hKm < 0 || water.paintKm)) F.kind = hKm < 0 ? 'cutSea' : 'lake';
    else if (water?.dry?.[t]) F.kind = 'dryBasin';
    else F.kind = hKm < 0 ? 'ocean' : 'land';
    // (a sea or lake cut off from the ocean, on the live terrain: its level, by its water balance)
    if (!at && (F.kind === 'cutSea' || F.kind === 'lake' || F.kind === 'sillSea') && T.paintKm) { F.levelM = (T.paintKm[t] - state.seaLevelKm) * 1000; F.depthM = F.levelM - F.heightM; }
    F.wet = F.kind !== 'land' && F.kind !== 'dryBasin' && F.kind !== 'sillBasin';
    F.coastKm = fin ? coastKmFinished(fin.raster, lat, lon) : coastKmTerrain(mesh, T, t, state.seaLevelKm);

    // ── climate ──
    const C = fin?.climate ?? state.climate;
    F.climate = null;
    if (C) {
        const K = { source: fin?.climate ? 'detail' : 'preview' };
        let land = false, stat = () => NaN;
        if (fin?.climate) {
            const R = fin.climate.raster, i = at.ocean ? -1 : landPixel(R, R.w, Math.min(R.w - 1, Math.floor(u * R.w)), Math.min(R.h - 1, Math.floor(v * R.h)));
            if (i >= 0) {
                land = true; K.koppen = R.koppen[i]; K.tAnnual = R.tAnnual[i] / 100; K.pAnnual = R.pAnnual[i];
                stat = key => (R.stats?.[key] ? statValue(R.stats[key], key, i) : NaN);
                if (R.cover) { const cv = R.cover[i]; K.biome = cv & 31; K.snowJan = !!(cv & 32); K.snowJul = !!(cv & 64); }
            }
        } else if (C.cell && hKm >= 0 && C.cell.koppen[t]) {
            land = true; K.koppen = C.cell.koppen[t]; K.tAnnual = C.cell.tAnnual[t]; K.pAnnual = C.cell.pAnnual[t];
            stat = key => (C.cell.stats?.[key] ? statValue(C.cell.stats[key], key, t) : NaN);
        }
        K.land = land;
        for (const key of STAT_KEYS) K[key] = stat(key);
        const mo = placeMonths(C, lat, lon, land ? K.tAnnual : NaN, land ? K.pAnnual : NaN);
        if (mo) {
            K.T12 = Array.from(mo.T12, x => +x.toFixed(2)); K.P12 = Array.from(mo.P12, x => +x.toFixed(1));
            K.snowMonths = land ? mo.T12.reduce((n, x) => n + (snowAt(x) >= 0.5 ? 1 : 0), 0) : null;
            // (the class from these months — the map's for one cell; a check for smokes, shown nowhere)
            K.koppenFromMonths = land ? classifyCell(mo.T12, mo.P12) : null;
            if (!land) { let s = 0; for (const x of mo.T12) s += x; K.tAnnual = s / 12; K.pAnnual = mo.P12.reduce((a, x) => a + x, 0); }
        }
        // (the sea's own fields, on the 1° grid: its temperature, ice and upwelling)
        if (!land && C.grid) {
            const g = gridCorners(C.grid, lat, lon), Ts = C.Tsea ?? C.T;
            K.sea = { tYear: gridValue(Ts.year, g), tJan: gridValue(Ts.jan, g), tJul: gridValue(Ts.jul, g), ice: C.seaIce ? Math.max(0, Math.min(1, gridValue(C.seaIce.year, g))) : null,
                upwelling: C.upwelling ? Math.max(0, gridValue(C.upwelling.year, g)) : null };
        }
        F.climate = K;
    }

    // ── water: the river here, and where it goes ──
    F.river = null;
    if (fin?.rivers && !at.ocean) {
        const rv = riverAt(fin, 0, u, v, 3);
        if (rv) {
            const R = fin.rivers, { end, km } = downstream(fin, rv.i), e = finishedAt(fin, (R.lon[end] + 180) / 360, (90 - R.lat[end]) / 180);
            F.river = { q: R.q[rv.i], regime: rv.regime, year: riverYearWords(rv), farFed: !!rv.farFed, km: greatCircleKm(lat, lon, R.lat[rv.i], R.lon[rv.i]),
                mouth: { kind: e.ocean ? 'ocean' : e.water ? ['', 'lake', 'saltLake', 'saltPan'][e.water] : 'dry', km, q: R.q[end], lat: R.lat[end], lon: R.lon[end] } };
        }
    }

    // ── ground: the rock and its history (the frame's sim cell), the soil (the People layer's world) ──
    const plate = f.owner[w], type = f.type[w], H = b ? (b.terrainCfg ??= terrainConfig(b.heights)) : null;
    F.ground = plate < 0 ? null : {
        plate, crust: type, crustWords: CRUST_WORDS[type] ?? 'Crust', ageMyr: Math.max(0, f.time - f.formedAt[w]), terrane: f.terrane?.[w] ?? null,
        thicknessKm: !H ? null : type === CrustType.OCEAN ? columnModel(H).crust[CrustType.OCEAN] : crustThicknessKm(H, type, f.rootKm?.[w] ?? 0, f.upliftKm?.[w] ?? 0, f.baseKm?.[w] ?? 0),
        setting: settingOf(f, w),
        belt: f.oroType?.[w] ? { kind: f.oroType[w], words: BELT_KIND[f.oroType[w]] ?? 'Mountain belt', startMyr: f.oroStart?.[w] || null, lastMyr: f.oroLast[w], active: f.time - f.oroLast[w] <= ACTIVE_MYR } : null,
        rift: (f.riftThin?.[w] ?? 0) > 0.02 ? { thinned: f.riftThin[w], atMyr: f.riftThinAt?.[w] || null } : null,
        volcanic: f.volcType?.[w] === VolcanicType.LIP || (f.flags?.[w] & CrustFlag.LIP) ? { kind: 'lip', atMyr: f.volcAt?.[w] || null, km: f.volcKm?.[w] ?? null }
            : f.volcType?.[w] === VolcanicType.TRACK ? { kind: 'track', atMyr: f.volcAt?.[w] || null } : null,
        marks: [f.flags?.[w] & CrustFlag.SUTURE && 'an old suture (a weld of two landmasses)', f.flags?.[w] & CrustFlag.FAILED_RIFT && 'a failed rift (an aulacogen)',
            f.flags?.[w] & CrustFlag.RIFT_MARGIN && 'the edge of a rift that opened an ocean', f.flags?.[w] & CrustFlag.TRENCH && 'a trench edge'].filter(Boolean),
        margin: f.margin?.[w] ? MARGIN_WORDS[f.margin[w] & Margin.TYPE] ?? null : null,
        coverKm: f.coverKm ? decodeCoverKm(f.coverKm[w]) : null, exhumKm: f.exhumKm ? decodeExhumKm(f.exhumKm[w]) : null,
        facies: f.facies?.[w] ? { ...decodeFacies(f.facies[w]) } : null,
    };
    const P = state.people, G = P?.ground;
    if (F.ground && G && state.PV && !at?.ocean) F.ground.soilLines = state.PV.groundLines(P, u, v);

    // ── people ──
    F.people = P && state.PV && !at?.ocean ? { lines: [...state.PV.peopleLines(P, state.peopleFrame(P), u, v), ...(P.food ? state.PV.foodLines(P, u, v) : [])] } : null;
    return F;
}

// ── drawing ──

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const n0 = x => Math.round(x).toLocaleString();
const km = x => (x === Infinity ? `more than ${n0(COAST_SEARCH_KM)} km` : x < 10 ? `${x.toFixed(1)} km` : `${n0(x)} km`);
const myr = x => `${n0(x)} Myr`;
const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
const needDetail = what => `<p class="evo-cell-need">Add detail to see ${what}.</p>`;
const swatch = rgb => `<i class="evo-cell-swatch" style="background:rgb(${rgb.map(c => Math.round(255 * c)).join(',')})"></i>`;
const KIND_WORDS = { ocean: 'The world ocean', lake: 'A lake', saltLake: 'A salt lake', saltPan: 'A salt pan', land: 'Land', cutSea: 'A sea cut off from the ocean',
    sillSea: 'A sea filling over a sill', sillBasin: 'A basin below sea level, filling over a sill', dryBasin: 'A dry basin below sea level' };

/** A climograph: rain as bars (mm, the right scale), temperature as a line (°C, the left), January first. */
function climograph(T12, P12, south) {
    const W = 296, Hh = 116, L = 30, Rr = 34, top = 8, bot = 18, iw = W - L - Rr, ih = Hh - top - bot, bw = iw / 12;
    let tMin = Math.min(0, ...T12), tMax = Math.max(10, ...T12);
    tMin = Math.floor(tMin / 10) * 10; tMax = Math.ceil(tMax / 10) * 10;
    const pMax = Math.max(50, Math.ceil(Math.max(...P12) / 50) * 50);
    const ty = x => top + ih * (1 - (x - tMin) / (tMax - tMin)), py = x => top + ih * (1 - x / pMax);
    let s = `<svg class="evo-cell-chart" viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="Monthly temperature and rain">`;
    // (the grid: the temperature's tens, and 0 °C marked)
    for (let x = tMin; x <= tMax; x += 10) s += `<line x1="${L}" x2="${W - Rr}" y1="${ty(x)}" y2="${ty(x)}" stroke="${x === 0 ? 'rgba(160,200,255,0.45)' : 'rgba(255,255,255,0.08)'}"/><text x="${L - 4}" y="${ty(x) + 3}" text-anchor="end">${x}°</text>`;
    s += `<text x="${W - Rr + 4}" y="${top + 3}">${pMax}</text><text x="${W - Rr + 4}" y="${top + ih + 3}">0 mm</text>`;
    for (let m = 0; m < 12; m++) {
        const y = py(P12[m]);
        s += `<rect x="${(L + m * bw + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${(top + ih - y).toFixed(1)}" fill="rgba(70,150,255,0.65)"><title>${'JanFebMarAprMayJunJulAugSepOctNovDec'.slice(3 * m, 3 * m + 3)}: ${n0(P12[m])} mm, ${T12[m].toFixed(1)} °C</title></rect>`;
        s += `<text x="${(L + (m + 0.5) * bw).toFixed(1)}" y="${Hh - 5}" text-anchor="middle">${MONTHS[m]}</text>`;
    }
    s += `<polyline fill="none" stroke="#ff8a5c" stroke-width="2" points="${T12.map((x, m) => `${(L + (m + 0.5) * bw).toFixed(1)},${ty(x).toFixed(1)}`).join(' ')}"/>`;
    for (let m = 0; m < 12; m++) s += `<circle cx="${(L + (m + 0.5) * bw).toFixed(1)}" cy="${ty(T12[m]).toFixed(1)}" r="2" fill="#ff8a5c"/>`;
    return s + `</svg><div class="evo-cell-chart-key"><span class="t">— temperature</span><span class="p">▮ rain</span>${south ? '<span>(southern summer: Dec–Feb)</span>' : ''}</div>`;
}

function placeHTML(F) {
    let s = '<dl>';
    s += row(F.heightM >= 0 ? 'Height' : 'Depth', `${n0(Math.abs(F.heightM))} m${F.heightM < 0 && !F.wet ? ' below sea level' : ''}`);
    s += row('Here', KIND_WORDS[F.kind] ?? F.kind);
    if (F.levelM != null) s += row('Water', `its level ${F.levelM >= 0 ? '' : '−'}${n0(Math.abs(F.levelM))} m (by its water balance) · ${n0(Math.max(0, F.depthM))} m deep here`);
    if (F.coastKm != null) s += row(F.kind === 'ocean' ? 'To land' : 'To the sea', km(F.coastKm));
    return s + '</dl>';
}

function climateHTML(F) {
    const K = F.climate;
    if (!K) return `<p class="evo-cell-need">No climate for this moment yet: open the Climate tab (or add detail) to work it out.</p>`;
    let s = '';
    if (K.T12) s += climograph(K.T12, K.P12, F.lat < 0);
    s += '<dl>';
    if (K.land) {
        const Kc = KOPPEN_CLASSES[K.koppen];
        s += row('Köppen', `${swatch(Kc.color)}<b>${Kc.code}</b> — ${esc(Kc.name)}`);
        if (K.biome != null) s += row('Biome', `${BIOME_WORDS[K.biome] || '—'}${K.snowJan || K.snowJul ? ` · snow-covered in ${K.snowJan && K.snowJul ? 'January and July' : K.snowJan ? 'January' : 'July'}` : ''}`);
        s += row('Year', `${K.tAnnual.toFixed(1)} °C · ${n0(K.pAnnual)} mm of rain`);
        if (K.aridity === K.aridity) s += row('Aridity', `${classLabel('aridity', K.aridity)} (rain ÷ evaporative demand ${K.aridity.toFixed(2)})`);
        if (K.growing === K.growing) s += row('Growing', `${Math.round(K.growing)} month${Math.round(K.growing) === 1 ? '' : 's'} above 10 °C`);
        if (K.snowMonths != null) s += row('Snow', K.snowMonths ? `${K.snowMonths} month${K.snowMonths === 1 ? '' : 's'} at or below −5 °C (mostly snow-covered)` : 'no month cold enough for lasting snow');
        if (K.tRange === K.tRange || K.rainSeason === K.rainSeason) s += row('Seasons', [K.tRange === K.tRange && `${K.tRange.toFixed(0)} °C warmest − coldest month`, K.rainSeason === K.rainSeason && `rain ${classLabel('rainSeason', K.rainSeason).toLowerCase()} (${K.rainSeason.toFixed(2)})`].filter(Boolean).join(' · '));
    } else {
        if (K.sea) s += row('Sea', `${K.sea.tYear.toFixed(1)} °C a year (Jan ${K.sea.tJan.toFixed(1)}, Jul ${K.sea.tJul.toFixed(1)})`);
        if (K.sea?.ice > 0.05) s += row('Sea ice', `${n0(100 * K.sea.ice)} % of the year's`);
        if (K.sea?.upwelling > 0.05) s += row('Upwelling', `${K.sea.upwelling.toFixed(2)} m/day (cold, rich water from below)`);
        if (K.T12) s += row('Air', `${K.tAnnual.toFixed(1)} °C · ${n0(K.pAnnual)} mm of rain a year (the 1° grid's, at sea level)`);
    }
    s += '</dl>';
    if (!K.T12) s += `<p class="evo-cell-need">The monthly chart needs this moment's climate worked out again (it was kept before the months were).</p>`;
    if (K.source === 'preview') s += needDetail('the ground cover (biome)');
    return s;
}

const MOUTH_WORDS = { ocean: 'the world ocean', lake: 'a lake', saltLake: 'a salt lake — a closed basin', saltPan: 'a salt pan — a closed basin', dry: 'nowhere: it dries out on land (a closed basin)' };
function waterHTML(F) {
    if (!F.detailed) return needDetail('the rivers, their seasons and the basin a place drains to');
    if (F.kind === 'ocean') return '<p class="evo-cell-quiet">The world ocean.</p>';
    let s = '<dl>';
    const r = F.river;
    if (r) {
        s += row('River', `${swatch(rgbOf(REGIME_STYLE[r.regime].rgb))}${n0(r.q)} m³/s${r.km > 15 ? ` · ${n0(r.km)} km away` : ''}`);
        s += row('Its year', esc(r.year));
        s += row('Drains to', `${MOUTH_WORDS[r.mouth.kind]}${r.mouth.km > 1 ? `, ${n0(r.mouth.km)} km downstream` : ''}${r.mouth.kind !== 'dry' ? ` (${n0(r.mouth.q)} m³/s there)` : ''}`);
    } else s += row('River', 'none within ~60 km carrying 1 m³/s or more');
    if (F.kind !== 'land') s += row('Lake', `${KIND_WORDS[F.kind]} (its level is the finish's; not kept on the page)`);
    return s + '</dl>';
}
const rgbOf = css => (css.match(/\d+/g) ?? [55, 120, 200]).slice(0, 3).map(x => Number(x) / 255);

function groundHTML(F) {
    const G = F.ground;
    if (!G) return '<p class="evo-cell-quiet">No plate here.</p>';
    let s = '<dl>';
    s += row('Crust', `<b>${G.crustWords}</b>${G.thicknessKm != null ? ` · ~${n0(G.thicknessKm)} km thick` : ''} · ${myr(G.ageMyr)} old`);
    s += row('Plate', `${G.plate}${G.terrane ? ` · terrane ${G.terrane}` : ''}`);
    if (G.belt) s += row('Mountains', `${G.belt.words}${G.belt.startMyr ? ` · began ${myr(F.timeMyr - G.belt.startMyr)} ago` : ''} · ${G.belt.active ? '<b>active now</b>' : `last active ${myr(F.timeMyr - G.belt.lastMyr)} ago`}`);
    if (G.rift) s += row('Rifting', `the crust thinned by ${n0(100 * G.rift.thinned)} %${G.rift.atMyr ? `, last ${myr(Math.max(0, F.timeMyr - G.rift.atMyr))} ago` : ''}`);
    if (G.volcanic) s += row('Volcanic', `${G.volcanic.kind === 'lip' ? 'a flood basalt (a large igneous province)' : 'a hotspot track'}${G.volcanic.atMyr ? `, ${myr(Math.max(0, F.timeMyr - G.volcanic.atMyr))} ago` : ''}`);
    if (!G.belt && !G.rift && !G.volcanic && G.setting) s += row('Setting', esc(G.setting));
    if (G.marks.length) s += row('Marks', G.marks.join(' · '));
    if (G.margin) s += row('Coast', G.margin);
    const cover = [G.coverKm > 0.05 && `${G.coverKm.toFixed(1)} km of sediment over the basement`, G.exhumKm > 0.05 && `${G.exhumKm.toFixed(1)} km of rock worn off the top`].filter(Boolean);
    if (cover.length) s += row('Rock', cover.join(' · '));
    if (G.facies) {
        const fs = [['carb', 'limestone'], ['salt', 'salt'], ['coal', 'coal'], ['organic', 'organic shale']].filter(([k]) => G.facies[k] > 0.05).map(([k, w]) => `${w} ${n0(100 * G.facies[k])} %`);
        if (fs.length) s += row('In it', fs.join(' · '));
    }
    s += '</dl>';
    if (G.soilLines?.length) s += `<div class="evo-cell-lines">${G.soilLines.join('<br>')}</div>`;
    else if (F.kind !== 'ocean') s += `<p class="evo-cell-need">${F.detailed ? 'The soil: turn on Civilisation and show the People layer (or Settlements) to work it out.' : 'Add detail (with Civilisation on) to see the soil.'}</p>`;
    return s;
}

function peopleHTML(F, state) {
    if (F.kind === 'ocean') return '<p class="evo-cell-quiet">No one lives on the open ocean.</p>';
    if (F.people?.lines.length) return `<div class="evo-cell-lines">${F.people.lines.join('<br>')}</div>`;
    if (!F.detailed) return needDetail('the people (with Civilisation on)');
    return `<p class="evo-cell-need">${state.civ ? 'Show the People layer or Settlements to work the people out.' : 'Turn on Civilisation to see the people.'}</p>`;
}

/** The Life section: kept for the ecology lane (lanes ecodesign §8 — a headline, the food web as a pyramid of roles, and
 *  why). It will read placeFacts' object; until then, a placeholder. */
export function lifeHTML(F) {
    return `<p class="evo-cell-life">Coming: plants, animals, the food web${F.detailed ? '' : ' — add detail to see what will live here'}.</p>`;
}

const SECTIONS = [['place', 'Place', placeHTML], ['climate', 'Climate', climateHTML], ['water', 'Water', waterHTML], ['ground', 'Ground', groundHTML], ['people', 'People', peopleHTML], ['life', 'Life', lifeHTML]];
export function panelHTML(F, state) {
    const la = `${Math.abs(F.lat).toFixed(1)}°${F.lat >= 0 ? 'N' : 'S'}`, lo = `${Math.abs(F.lon).toFixed(1)}°${F.lon >= 0 ? 'E' : 'W'}`;
    let s = `<div class="evo-cell-head"><b>${la}, ${lo}</b><span>${n0(F.timeMyr)} Myr · ${F.detailed ? 'detailed' : 'preview'}</span></div>`;
    for (const [id, title, html] of SECTIONS) {
        if (id === 'people' && !state.civ && !F.people) continue;          // (Civilisation off: no People section at all)
        s += `<section class="evo-cell-sec" data-sec="${id}"><h4>${title}</h4>${html(F, state)}</section>`;
    }
    return s;
}

// ── the panel ──

export class CellPanel {
    /** state(): the page's state for placeFacts, plus civ (Civilisation on) and key (an array of what, changed, redraws it: compared item by item). */
    constructor(state) {
        this.state = state;
        this.place = null; this.key = null; this.lastDraw = 0; this.ms = NaN; this.facts = null; this.looping = false;
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = new URL('../../cell-panel.css', import.meta.url).href;
        document.head.append(link);
        const el = this.el = document.createElement('aside');
        el.id = 'cellPanel'; el.className = 'evo-cell-panel'; el.hidden = true; el.setAttribute('aria-label', 'This place');
        el.innerHTML = '<button class="evo-cell-close" aria-label="Close">&times;</button><div class="evo-cell-body"></div>';
        el.querySelector('.evo-cell-close').addEventListener('click', () => this.close());
        document.body.append(el);
        this.body = el.querySelector('.evo-cell-body');
        addEventListener('keydown', e => { if (e.key === 'Escape' && this.place) this.close(); });
        this.tick = this.tick.bind(this);
    }
    get open() { return !!this.place; }
    /** Open at a place [u, v] on the texture (or close, with null: a click off the planet, or one that opened a town's card). */
    pick(uv) {
        if (!uv) { this.close(); return; }
        this.place = { lat: 90 - uv[1] * 180, lon: uv[0] * 360 - 180 };
        this.key = null; this.draw(true);
        if (!this.looping) { this.looping = true; requestAnimationFrame(this.tick); }
    }
    close() { this.place = null; this.el.hidden = true; this.facts = null; }
    draw(force = false) {
        const s = this.state(), key = s.key;
        if (!force && this.key && key.length === this.key.length && key.every((k, i) => k === this.key[i])) return;
        const t0 = performance.now();
        const F = this.facts = placeFacts(s, this.place.lat, this.place.lon);
        this.body.innerHTML = F ? panelHTML(F, s) : '<p class="evo-cell-quiet">Nothing drawn here yet.</p>';
        this.key = key; this.ms = performance.now() - t0; this.lastDraw = performance.now();
        this.el.dataset.ms = this.ms.toFixed(1);                 // (how long it took: for a smoke to read)
        this.el.hidden = false;
    }
    /** While open: drawn again when the moment (or what it shows) changes — at most every REFRESH_MS. */
    tick(now) {
        if (!this.place) { this.looping = false; return; }
        if (now - this.lastDraw >= REFRESH_MS) try { this.draw(); } catch (err) { console.error('[cell panel]', err); this.lastDraw = now; }
        requestAnimationFrame(this.tick);
    }
}
