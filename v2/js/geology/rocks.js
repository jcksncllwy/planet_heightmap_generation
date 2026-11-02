// Rocks: what each place of a finished moment is made of, before its rivers cut it. Ported and trimmed from World Orogen
// (raguilar011095, GPL v3; plans/V2_GEOLOGY_PLAN.md G2; Madeline James's major rock types map is its idea source). Each land
// cell of the history keeps a rock column (tectonics/step/geology.js) — sediment cover over the basement, the basement worn
// to some depth — and the setting it was last in. Here, per cell of the finish's surface:
//   · the BASEMENT, from that setting and that depth: a live arc's volcanics, bared to its granite batholiths once its
//     lid is worn off, then gneiss; a collision belt's folded rocks — slate and schist, then gneiss, with granite plutons;
//     a shield's granite-gneiss domes between greenstone keels (each craton its own share and style); an old mobile
//     belt's gneiss; a closed sea's ophiolite; a hotspot island's basalt;
//   · the COVER over it as beds, cut by the surface: where the ground lies below the land around it older beds crop out;
//     across a fold belt its folds bare older beds in stripes along the belt; each bed's kind by the cover's make-up.
// What this skips (limits): the surface's own structure cues (terrain/synthesize.js surfaceRange upstream: Valley-and-Ridge
// bands on the drawn ridges, far-field folds), so contacts follow the record, not the drawn ridges; the young sediment over
// both (river plains, dunes, loess, moraines: they do not exist yet when this runs, before the carve — L3's layer); the
// finished surface (rock is read on the uncarved one). Rock patterns inside a sim cell (blobs, keels, beds, facies) are noise
// (tier 3): only the record they are read from is history.

import { CrustType, CrustFlag, OrogenyType, VolcanicType } from '../tectonics/model/crust.js';
import { GeoFlag, decodeCoverKm, decodeExhumKm, decodeUnroofKm, decodeFacies } from '../tectonics/model/geology.js';
import { warpField, warpPoint } from '../terrain/terrain-mesh.js';
import { locate } from '../core/mesh-locate.js';
import { FastNoise } from '../core/fast-noise.js';
import { LatLonGrid } from '../finish/finish-grid.js';
import { GEOLOGY } from './geology-config.js';

const R = 6371, DEG = 180 / Math.PI;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The kinds of rock (0 = sea), in the order of geology-config.js `lithology`. Families: GLiM's (Hartmann & Moosdorf 2012). */
export const Rock = Object.freeze({ NONE: 0, ALLUVIUM: 1, SANDSTONE: 2, SHALE: 3, LIMESTONE: 4, SALT: 5, BASALT: 6, VOLCANIC: 7, GRANITE: 8,
    SLATE: 9, GNEISS: 10, SHIELD: 11, GREENSTONE: 12, OPHIOLITE: 13 });
export const ROCK_COUNT = 14;
export const ROCK_FAMILY = [null, 'loose', 'sedimentary', 'sedimentary', 'sedimentary', 'sedimentary', 'volcanic', 'volcanic', 'plutonic', 'metamorphic', 'metamorphic', 'metamorphic', 'metamorphic', 'plutonic'];

/** A frame's record, whose fields a frame from before the record does not have: those read as zeros. */
function recordOf(frame, n) {
    const zero = frame.coverKm ? null : new Uint8Array(n);
    return { geoFlags: frame.geoFlags ?? zero, coverKm: frame.coverKm ?? zero, facies: frame.facies ?? new Uint16Array(n), exhumKm: frame.exhumKm ?? zero, unroofKm: frame.unroofKm ?? new Int8Array(n) };
}

// the basement's kinds, per sim cell (scores 0…1), then shaped per point by patterns
export const B_VOLC = 0, B_BASALT = 1, B_GRANITE = 2, B_SLATE = 3, B_GNEISS = 4, B_SHIELD = 5, B_OPHIO = 6, NB = 7;
const ARC_BELTS = new Set([OrogenyType.ANDEAN, OrogenyType.ARC]);
const COLLISION_BELTS = new Set([OrogenyType.URAL, OrogenyType.HIMALAYAN, OrogenyType.TRANSPRESSION]);

/**
 * The history's record per sim cell, read off a frame into what the rocks need: the cover (km, its kinds), the
 * basement's kinds (scores), a craton's character, a suture's slivers. Small (sim-mesh sized).
 */
export function simRocks(frame, simMesh, seed, G = GEOLOGY) {
    const n = simMesh.numCells, time = frame.time, fac = {}, R_ = recordOf(frame, n);
    const S = { cover: new Float32Array(n), carb: new Float32Array(n), salt: new Float32Array(n), marine: new Float32Array(n), organic: new Float32Array(n),
        base: new Float32Array(NB * n), green: new Float32Array(n), style: new Float32Array(n), axis: new Float32Array(3 * n), suture: new Float32Array(n),
        felsic: new Float32Array(n), fold: new Float32Array(n), dKm: new Float32Array(n), land: new Uint8Array(n) };
    const lerp = (r, t) => r[0] + (r[1] - r[0]) * t;
    for (let w = 0; w < n; w++) {
        if (frame.owner[w] < 0) continue;
        const type = frame.type[w], flags = frame.flags[w], geo = R_.geoFlags[w], filled = frame.seaFillKm?.[w] > 0;
        if (type === CrustType.OCEAN && !filled) continue;
        S.land[w] = 1;
        S.cover[w] = decodeCoverKm(R_.coverKm[w]);
        decodeFacies(R_.facies[w], fac);
        S.carb[w] = fac.carb; S.salt[w] = fac.salt; S.organic[w] = fac.organic;
        S.marine[w] = filled ? 1 : 0;
        const ex = decodeExhumKm(R_.exhumKm[w]), un = decodeUnroofKm(R_.unroofKm[w]), b = NB * w;
        // (a filled sea: its sediment over an ocean floor)
        if (type === CrustType.OCEAN) { S.base[b + B_BASALT] = 1; continue; }
        const slate = smooth(G.gradeKm.slate[0], G.gradeKm.slate[1], ex), gneiss = smooth(G.gradeKm.gneiss[0], G.gradeKm.gneiss[1], ex);
        // (the grade: folded sediment and volcanics worn into slate and schist, then gneiss)
        const bared = slate;
        const meta = (share, granite) => {
            S.base[b + B_GRANITE] += share * granite * bared;
            S.base[b + B_SLATE] += share * (1 - granite * bared) * slate * (1 - gneiss);
            S.base[b + B_GNEISS] += share * (1 - granite * bared) * gneiss;
            S.base[b + B_VOLC] += share * (1 - slate) * 0.15;           // (an unworn belt's own volcanics, folded in)
            S.base[b + B_SLATE] += share * (1 - slate) * 0.85;          // (…and its folded sediment, under any cover left: slate-like)
        };
        const belt = frame.oroType[w], age = belt ? time - frame.oroLast[w] : Infinity;
        S.fold[w] = belt ? 1 : geo & GeoFlag.FORELAND ? 0.3 : 0;      // (its beds folded: a belt’s, a foreland’s gently)
        S.dKm[w] = belt ? (frame.beltU[w] / 255) * frame.beltReach[w] : 0;          // (how far from the belt's front: its folds run along it)
        const live = belt ? 1 - smooth(G.arcActiveMyr[0], G.arcActiveMyr[1], age) : 0;
        const u = frame.beltU[w] / 255;
        // a hotspot's island on land: basalt
        if (frame.volcType[w] === VolcanicType.TRACK && frame.volcKm[w] > 0) { S.base[b + B_BASALT] = 1; continue; }
        if (type === CrustType.CRATON && !belt) {
            // a shield: its own character (seeded per craton): greenstone's share, domes or belts, the belts' trend
            const h = hash01(seed, frame.terrane[w]), h2 = hash01(seed ^ 0x51ed, frame.terrane[w]), h3 = hash01(seed ^ 0x7a11, frame.terrane[w]);
            S.base[b + B_SHIELD] = 1;
            // (a shield worn shallower keeps more of its greenstone; one worn deep is granulite gneiss)
            S.green[w] = lerp(G.greenstoneShare, h) * (1.3 - 0.6 * smooth(12, 28, ex));
            S.style[w] = h2 < G.beltStyleShare ? 1 : 0;
            const th = 2 * Math.PI * h3, ph = Math.acos(2 * hash01(seed ^ 0x3c3c, frame.terrane[w]) - 1);
            S.axis[3 * w] = Math.sin(ph) * Math.cos(th); S.axis[3 * w + 1] = Math.sin(ph) * Math.sin(th); S.axis[3 * w + 2] = Math.cos(ph);
            continue;
        }
        // ophiolite: a closed sea's floor thrust up; slivers along old sutures
        if (geo & GeoFlag.OPHIOLITE) { S.base[b + B_OPHIO] = G.ophioliteFlag; meta(1 - G.ophioliteFlag, 0); continue; }
        if (flags & CrustFlag.SUTURE) S.suture[w] = G.sutureOphiolite;
        if (ARC_BELTS.has(belt) || belt === OrogenyType.LARAMIDE || type === CrustType.ARC || ((geo & GeoFlag.WAS_ARC) && !belt)) {
            // an arc, live or old: its volcanic lid (andesite; basalt on an island arc's thin crust; rhyolite and tuff on
            // thick crust), bared to its granite batholiths, then to gneiss. Across an Andean
            // belt the volcanoes stand on its arc only (arcFront); a flat slab's belt has none — its arc gap bares the
            // basement in uplifts (the Laramide's ranges). An accreted arc no longer live is worn like any
            const island = type === CrustType.ARC;
            const onArc = belt === OrogenyType.ANDEAN ? smooth(0, G.arcFront[0], u) * (1 - smooth(G.arcFront[1] - 0.1, G.arcFront[1] + 0.1, u)) : 1;
            const lid = belt === OrogenyType.LARAMIDE ? 0 : (1 - smooth(G.volcanicLidKm[0], G.volcanicLidKm[1], live > 0.5 ? 0 : Math.max(0, un))) * Math.max(onArc * Math.max(live, 0.4), island ? 1 : 0);
            S.felsic[w] = island ? 0 : smooth(G.felsicThickKm[0], G.felsicThickKm[1], frame.thickKm[w]);
            // (an island arc's thin crust: basalt among its andesite)
            if (island && lid > 0) { S.base[b + B_BASALT] += lid * 0.35; S.base[b + B_VOLC] += lid * 0.65; } else S.base[b + B_VOLC] += lid;
            const roots = 1 - lid;
            S.base[b + B_GRANITE] += roots * G.arcGranite * (1 - smooth(G.gradeKm.gneiss[0], G.gradeKm.gneiss[1], ex));
            meta(roots * (1 - G.arcGranite), 0);
            if (belt !== OrogenyType.ANDEAN && belt !== OrogenyType.ARC) S.base[b + B_GRANITE] += roots * 0.3;
            continue;
        }
        if (COLLISION_BELTS.has(belt) || belt === OrogenyType.RIFT) {
            // a collision belt: folded rocks worn to slate and schist, then gneiss, with granite plutons where it is worn
            // past its sediments (S-type, crustal melts: tin's granites); a rift's shoulders: the basement raised, with
            // basalt where it is young
            meta(1, belt === OrogenyType.RIFT ? G.beltGranite : G.collisionGranite);
            if (belt === OrogenyType.RIFT) S.base[b + B_BASALT] += 0.35 * live;
            continue;
        }
        // older continental crust with no belt of its own: the start world's mobile belts about the cratons (gneiss and
        // schist with granite) — or crust a newer history made
        meta(1, G.beltGranite);
    }
    return S;
}

/** One pass of a majority filter: a land cell whose neighbours mostly agree on another kind (4 of its ~6) takes it. */
function despeckle(mesh, rock, ocean, counts) {
    const { adjOffset, adjList, numCells: n } = mesh, was = rock.slice(), tally = new Uint8Array(ROCK_COUNT);
    for (let c = 0; c < n; c++) {
        if (ocean[c]) continue;
        let best = -1, bn = 0, all = 0;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const r = was[adjList[k]]; if (!r) continue; all++; if (++tally[r] > bn) { bn = tally[r]; best = r; } }
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) tally[was[adjList[k]]] = 0;
        if (best > 0 && best !== was[c] && bn >= Math.max(3, Math.ceil(0.6 * all))) { counts[was[c]]--; counts[best]++; rock[c] = best; }
    }
}

/** 0…1 from a seed and an id (a craton keeps its own character). */
export function hash01(seed, id) {
    let h = (seed ^ Math.imul(id + 0x9e37, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** Each of `fields` (per sim cell), read at each surface cell's record cell `map[c]`, averaged per grid cell: all in one pass. */
function averageMapped(grid, lat, lon, map, fields, use) {
    const k = new Float64Array(grid.size), sums = fields.map(() => new Float64Array(grid.size)), F = fields.length;
    for (let c = 0; c < lat.length; c++) {
        if (!use(c)) continue;
        const g = grid.index(lat[c], lon[c]), m = map[c];
        k[g]++;
        for (let f = 0; f < F; f++) sums[f][g] += fields[f][m];
    }
    return sums.map(s => { const out = new Float32Array(grid.size); for (let g = 0; g < grid.size; g++) out[g] = k[g] ? s[g] / k[g] : NaN; return out; });
}

/** The sim cell whose record each land cell of the surface shows, through the terrain's large warp: the heaviest land corner. */
function readRecord(mesh, simMesh, land, ocean, seed, cfg) {
    const n = mesh.numCells, { xyz } = mesh, rec = new Int32Array(n), W = warpField(seed, cfg), q = [0, 0, 0], c3 = [0, 0, 0], w3 = [0, 0, 0];
    for (let c = 0; c < n; c++) {
        if (ocean[c]) continue;
        warpPoint(W, cfg, xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], q);
        locate(simMesh, q[0], q[1], q[2], c3, w3);
        let best = c3[0], bw = -1;
        for (let j = 0; j < 3; j++) { const k = w3[j] + (land[c3[j]] ? 1 : 0); if (k > bw) { bw = k; best = c3[j]; } }
        rec[c] = best;
    }
    return rec;
}

/**
 * Each land cell of the surface: its kind of rock (Rock).
 * @param {Object} o  { mesh (the finish's), z (km), ocean, frame, simMesh, seed, cfg (the terrain's), lat, lon (°), lip (0…1: a flood basalt's cap),
 *                     belowKm (per cell: read the column this far under the surface), reuse ({}: filled by the first read, for the next) }
 * @returns {{rock: Uint8Array, shares: Float64Array}} shares: each kind's share of the land (by cell)
 */
export function classifyRocks({ mesh, z, ocean, frame, simMesh, seed, cfg, lat, lon, lip = null, belowKm = null, reuse = {} }, G = GEOLOGY) {
    const n = mesh.numCells, { xyz } = mesh, rock = new Uint8Array(n), shares = new Float64Array(ROCK_COUNT);
    // (reuse: the record as this mesh reads it, kept for reading the same column again deeper down)
    const S = reuse.S ??= simRocks(frame, simMesh, seed, G), rec = reuse.rec ??= readRecord(mesh, simMesh, S.land, ocean, seed, cfg);
    const nz = new FastNoise(((seed | 0) * 0x2c1b + 0x4d) >>> 0), patchF = R / G.patchKm, domeF = R / G.domeKm, beltF = 2 * Math.PI * R / G.beltSpacingKm;
    const score = new Float64Array(ROCK_COUNT);
    // ── the record, smooth: each cell's record cell's, averaged over a sim cell or so ──
    const isRecLand = c => !ocean[c] && S.land[rec[c]] === 1, isLand = c => !ocean[c];
    const recordKm = G.recordBlurCells * simMesh.edgeKm, coarse = new LatLonGrid(0.5);
    const NAMES = ['cover', 'carb', 'salt', 'organic', 'marine', 'fold', 'dKm', 'suture'], nSim = simMesh.numCells;
    const baseK = Array.from({ length: NB }, (_, k) => { const a = new Float32Array(nSim); for (let w = 0; w < nSim; w++) a[w] = S.base[NB * w + k]; return a; });
    const means = reuse.means ??= averageMapped(coarse, lat, lon, rec, [...NAMES.map(k => S[k]), ...baseK], isRecLand).map(f => coarse.blur(f, recordKm));
    const F = Object.fromEntries(NAMES.map((k, i) => [k, means[i]])), FB = means.slice(NAMES.length);
    // ── a place's relief (its height over the land around it, ~reliefKm), and its region's height: high ground sheds its cover ──
    const ref = reuse.ref ??= coarse.blur(coarse.average(lat, lon, z, isLand), G.reliefKm), hReg = reuse.hReg ??= coarse.blur(coarse.average(lat, lon, z, isLand), 50);
    // ── the beds, counted up from the basement: each its thickness (seeded) ──
    const bedTop = [];
    for (let i = 0, b = 0; b < 40; i++) { b += G.bedKm * (0.6 + 0.8 * hash01(seed ^ 0x6b3d, i)); bedTop.push(b); }
    const bedOf = s => { let i = 0; while (i < bedTop.length - 1 && bedTop[i] <= s) i++; return i; };
    // (noise in km, its octaves down to what this mesh can show)
    const octaves = (fromKm, n0) => { const out = []; for (let o = 0, lam = fromKm, a = 1; o < n0; o++, lam /= 2, a *= 0.55) { const f = smooth(1.5, 3, lam / mesh.edgeKm); if (f > 0.01) out.push([R / lam, a * f]); } return out; };
    const contactO = octaves(150, 2), bedO = octaves(120, 2), facF = R / G.facieKm, wanderF = R / 400, warpO = octaves(G.contactWarpKm[1], 3), warpA = G.contactWarpKm[0] / R;
    const foldWaves = [[G.foldKm * 2.6, 0.6], [G.foldKm, smooth(1.5, 3, G.foldKm / mesh.edgeKm)]].filter(([, a]) => a > 0.01);
    const fbm = (O, x, y, zz, off) => { let s = 0; for (let o = 0; o < O.length; o++) { const [f, a] = O[o]; s += a * nz.noise3D(x * f + off + 1.3 * o, y * f + 2 * off + 2.9 * o, zz * f + 3 * off + 0.7 * o); } return s; };
    let land = 0;
    for (let c = 0; c < n; c++) {
        if (ocean[c]) continue;
        land++;
        const w = rec[c];
        // (land the record has as sea — a delta built out, a strait filled — is young sediment)
        if (!S.land[w]) { rock[c] = Rock.ALLUVIUM; shares[Rock.ALLUVIUM]++; continue; }
        const x = xyz[3 * c], y = xyz[3 * c + 1], zz = xyz[3 * c + 2];
        // (the record read a little displaced — a fractal warp: its contacts wander and fold at every scale this mesh draws)
        let wx = x + warpA * fbm(warpO, x, y, zz, 31.7), wy = y + warpA * fbm(warpO, x, y, zz, 43.1), wz = zz + warpA * fbm(warpO, x, y, zz, 57.9);
        const wl = Math.hypot(wx, wy, wz); wx /= wl; wy /= wl; wz /= wl;
        const la = Math.asin(Math.max(-1, Math.min(1, wz))) * DEG, lo = Math.atan2(wy, wx) * DEG;
        // ── where the surface meets the rock column: s km above the basement. The cover's top less what high ground shed;
        // down into older beds in a low place (steeply in a fold belt, its beds on edge); the contact wandering ──
        const at = f => coarse.at(f, la, lo);
        const T = at(F.cover), fold = at(F.fold), r = z[c] - coarse.at(ref, lat[c], lon[c]);
        const top = T - G.highStripPerKm * Math.max(0, coarse.at(hReg, lat[c], lon[c]) - G.highStripFromKm);
        // (a fold belt: synclines keep the top beds, anticlines bare older ones; −1 in an anticline … +1 in a syncline)
        let syn = 0;
        if (fold > 0.02 && foldWaves.length) {
            const d = at(F.dKm) / Math.max(0.05, fold), wander = 2 * nz.noise3D(x * wanderF + 4.2, y * wanderF + 8.8, zz * wanderF + 0.6) + 0.5 * fbm(contactO, x, y, zz, 17.3);
            let sum = 0, amp = 0;
            for (const [lam, a] of foldWaves) { sum += a * Math.cos(2 * Math.PI * d / lam + wander); amp += a; }
            syn = fold * sum / amp;
        }
        const s = top - G.foldDepthKm * (fold - syn) * 0.5 + G.reliefGain * (1 - 0.7 * fold) * Math.min(0, r) + (T > 0 ? G.bedJitterKm * smooth(0, 0.5, T) * fbm(contactO, x, y, zz, 3.1) : 0) - (belowKm ? belowKm[c] : 0);
        score.fill(0);
        if (s > G.coverShowKm) {
            // the bed here, and its kind: by the cover's make-up, each bed its own pattern across country
            const i = bedOf(s + 0.5 * G.bedJitterKm * fbm(bedO, x, y, zz, 7.7));
            const carb = at(F.carb), salt = G.saltShare * at(F.salt), organic = at(F.organic), marine = at(F.marine);
            const clastic = Math.max(0, 1 - carb - salt), shaleShare = Math.min(0.9, G.shaleLand + (G.shaleMarine - G.shaleLand) * marine + 0.6 * organic);
            const sand = clastic * (1 - shaleShare) + (i === 0 ? G.basalSand : 0), shale = clastic * shaleShare, sum = carb + salt + sand + shale || 1;
            const u = smooth(-0.5, 0.5, nz.noise3D(x * facF + 7.3 * i, y * facF + 1.9 * i + 3, zz * facF + 4.1 * i) + 0.35 * nz.noise3D(x * facF * 3.1 + 2.2 * i, y * facF * 3.1 + 5.5, zz * facF * 3.1 + 1.1 * i)) * sum;
            score[u < carb ? Rock.LIMESTONE : u < carb + salt ? Rock.SALT : u < carb + salt + shale ? Rock.SHALE : Rock.SANDSTONE] = 1;
        } else {
            // ── the basement, by the record cell's setting: granite plutons as blobs; a shield's greenstone keels between
            // domes (or in belts); ophiolite slivers along a suture ──
            const bz = k => Math.max(0, at(FB[k])), hi = Math.max(-1, Math.min(1, r / 0.4));
            const volc = bz(B_VOLC), arc = volc > 0.1, nA = fbm(contactO, x, y, zz, 11.1), nB = fbm(contactO, x, y, zz, 23.7);
            const pl = nz.noise3D(x * patchF * 0.8 + 5.5, y * patchF * 0.8 + 2.2, zz * patchF * 0.8 + 8.8) + 0.25 * nB + 0.1 * (arc ? -hi : hi);
            const granite = bz(B_GRANITE), blob = smooth(-0.15, 0.25, pl + (granite - 0.4)), others = bz(B_SLATE) + bz(B_GNEISS) + volc;
            score[Rock.GRANITE] = granite > 0.02 ? blob * Math.max(granite, 0.5 * (granite + others)) : 0;
            const rest = 1 - (granite > 0.02 ? blob : 0) * 0.85;
            score[Rock.SLATE] = bz(B_SLATE) * rest * Math.exp(0.6 * nA + 0.1 * hi + 0.8 * syn); score[Rock.GNEISS] = bz(B_GNEISS) * rest * Math.exp(-0.6 * nA - 0.1 * hi - 0.8 * syn);
            score[Rock.VOLCANIC] = volc * rest * Math.exp(0.6 * nB + 0.2 * hi); score[Rock.BASALT] = bz(B_BASALT) * Math.exp(0.4 * nA);
            score[Rock.OPHIOLITE] = bz(B_OPHIO) * Math.exp(0.4 * nB);
            const suture = at(F.suture);
            if (suture > 0.01) {
                const ridge = 1 - Math.abs(nz.noise3D(x * patchF * 0.6 + 1.4, y * patchF * 0.6 + 6.6, zz * patchF * 0.6 + 3.3) + 0.3 * nA);
                score[Rock.OPHIOLITE] += suture * 2 * smooth(0.82, 0.95, ridge);
            }
            const shield = bz(B_SHIELD);
            if (shield > 0.02 && S.base[NB * w + B_SHIELD] > 0) {
                const ax = S.axis[3 * w], ay = S.axis[3 * w + 1], az = S.axis[3 * w + 2], gs = S.green[w];
                let keel;
                if (S.style[w] > 0.5) {
                    // the Superior's long belts: stripes along the craton's trend, wandering
                    const al = (x * ax + y * ay + zz * az) / (Math.hypot(ax, ay, az) || 1);
                    keel = 0.5 + 0.5 * Math.cos(beltF * al + 2.5 * nz.noise3D(x * domeF * 0.5 + 2.7, y * domeF * 0.5, zz * domeF * 0.5 + 6.1));
                } else {
                    // the Pilbara's domes: greenstone in the troughs between rounded highs
                    keel = 1 - Math.abs(nz.noise3D(x * domeF, y * domeF + 4.4, zz * domeF + 8.2) + 0.5 * nz.noise3D(x * domeF * 2.1 + 1.1, y * domeF * 2.1, zz * domeF * 2.1 + 3.7));
                }
                // (the keels' width set so greenstone holds about its share)
                const g = smooth(1 - gs - 0.06, 1 - gs + 0.06, keel - 0.04 * hi + 0.1 * nA);
                score[Rock.GREENSTONE] = shield * g; score[Rock.SHIELD] = shield * (1 - g);
            }
        }
        // (flood basalt where a large igneous province still caps the ground)
        if (lip) score[Rock.BASALT] = Math.max(score[Rock.BASALT], 1.1 * smooth(G.lavaShow[0], G.lavaShow[1], lip[c]));
        let best = Rock.SLATE, bv = -1;
        for (let k = 1; k < ROCK_COUNT; k++) if (score[k] > bv) { bv = score[k]; best = k; }
        rock[c] = best; shares[best]++;
    }
    // (a cell alone among others of one kind takes theirs — a speck on a map is noise, at any detail)
    for (let pass = 0; pass < G.despeckle; pass++) despeckle(mesh, rock, ocean, shares);
    if (land) for (let k = 0; k < ROCK_COUNT; k++) shares[k] /= land;
    return { rock, shares };
}
