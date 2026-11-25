// F5 — the coast: the waves and the sand they move, over the last interglacials' high seas. The wind raises waves over
// the open sea (more the stronger and the longer it blows over open water, toward a fully developed sea; swell carried
// on far from the storms, fading; none under the sea ice), and every coast takes the waves that reach it — from the
// open directions only: a headland takes them from all round, a bay from its mouth, an inner sea from its short fetch.
// The waves cut the coast back (soft rock and low coasts fastest — a cliff's fall of rock must be cleared before it
// retreats again) and drive the sand along the shore (as waves meet it slantwise: most at 45°), from the cliffs and the
// rivers' mouths to where the drift slows — the bays' heads, the lee of headlands — building beaches, barriers and spits
// out to sea level. Headlands wear back and bays fill: the coast straightens where it is open, stays ragged where it is
// sheltered (developer: "I'd prefer doing actual physical coastal erosion sims").
// The drift is the one-line model of the shore on the GPU (gpu/shore-gpu.js, lane coastwave 2026-11-25): the waves' longshore
// flux from each direction at each shore cell, its change along the shore laid or taken — sand conserved, only loose sand moved.
// Its reach is set by depth: in 30,000 years at Earth's drift rates (~10⁶ m³/yr) a shore ~15 m deep moves ~70 km, one ~120 m
// deep (most of this world's: the synthesized margins fall away at the coast) ~25 km — so the waves straighten the coast at the
// mesh's finest scales, and the 50–500 km shape is the margin's (its sediment wedge: not modelled here).
//
// Physical units throughout: wave power in kW per m of wave crest (deep water: Pierson–Moskowitz, P ≈ 1e-4·U⁵ for a
// fully developed sea, reached over a fetch ≈ 2.25·U² km — JONSWAP's gF/U² ≈ 2.2·10⁴); cliff retreat in m/yr ∝ wave
// power × the rock's erodibility / (cliff height + toe) (Sunamura's wave-force over rock-strength, as a rate); longshore
// sand drift in km³/yr ∝ wave power · cos^1.2 α · sin α (CERC; Ashton & Murray 2006 for the deep-water angle α); time in
// years. Distances in km: the same coast at every detail, only drawn finer.

import { PARAMS } from '../climate/config.js';
import { coastRaysGPU, gridCell } from '../gpu/coast-rays.js';
import { shoreDriftGPU } from '../gpu/shore-gpu.js';

// E[max(0, m + ξ)⁵], ξ ~ N(0, 1): a direction's share of the fifth power of a wind of mean m and unit spread (the storms)
const POW5 = (() => {
    const t = new Float64Array(701);
    for (let i = 0; i <= 700; i++) {
        const m = -6 + i * 0.02;
        let sum = 0;
        for (let x = -8; x <= 8; x += 0.01) { const u = m + x; if (u > 0) sum += u ** 5 * Math.exp(-x * x / 2); }
        t[i] = sum * 0.01 / Math.sqrt(2 * Math.PI);
    }
    return t;
})();
const pow5 = (mu, sig) => {
    if (!(sig > 0.01)) return Math.max(0, mu) ** 5;
    const x = (mu / sig + 6) / 0.02;
    if (x >= 700) return mu ** 5 + 10 * mu ** 3 * sig * sig + 15 * mu * sig ** 4;   // (far above the spread: the moments)
    if (x <= 0) return 0;
    const i = Math.floor(x), f = x - i;
    return sig ** 5 * (POW5[i] * (1 - f) + POW5[i + 1] * f);
};

/**
 * @param {Object} ctx  { mesh, z (km, changed in place), lat, lon (degrees), soft (0–1: the rock's softness, records.js
 *                        iceSoft), climGrid {w, h}, u, v (12 × the climate grid: the winds, m/s, east and north), ice
 *                        (12 × grid: sea-ice cover 0–1, or null), eady, anchors (the rain stage's storm growth per row,
 *                        1/day, at its anchor months — the storms' winds), mouths (Map: sea cell → the river's load, km³ over the
 *                        carve's time), carveYears, worldOcean (z → Promise of terrain/world-ocean.js worldOcean's answer:
 *                        the flood on the GPU, worldOceanGPU), device (the GPU the waves are traced on: gpu/coast-rays.js),
 *                        cellKm2, pool (a terrain pool to work out the seas' winds on, or null: the same seas) }
 * @returns {{wave: Float32Array (kW/m at the coast's cells), change: Float32Array (km), stats: Object}}
 */
export async function coastWork(ctx, F) {
    const { mesh, z, soft, climGrid, cellKm2 } = ctx, n = mesh.numCells, { adjOffset, adjList, edgeKm } = mesh;
    const wave = new Float32Array(n), change = new Float32Array(n);
    const stats = { years: F.coastYears, erodedKm3: 0, mudKm3: 0, sandKm3: 0, riverKm3: 0, looseKm3: 0, booksKm3: 0, bandCells: 0, landLostKm2: 0, landGainedKm2: 0, meanWaveKw: 0 };
    if (!(F.coastYears > 0) || !ctx.u) return { wave, change, stats };
    const D = F.waveDirs, start = z.slice();
    // ── the seasons' winds and ice, on the climate grid (DJF, MAM, JJA, SON) ──
    const G = climGrid.w * climGrid.h, ice = ctx.ice && ctx.ice.length === 12 * G ? ctx.ice : null;
    const su = [], sv = [], si = [];
    for (let s = 0; s < 4; s++) {
        const a = new Float32Array(G), b = new Float32Array(G), c = new Float32Array(G);
        for (const m of [(3 * s + 11) % 12, 3 * s, 3 * s + 1]) for (let g = 0; g < G; g++) { a[g] += ctx.u[m * G + g] / 3; b[g] += ctx.v[m * G + g] / 3; if (ice) c[g] += ice[m * G + g] / 3; }
        su.push(a); sv.push(b); si.push(c);
    }
    // (the storms' winds about the month's mean — the gustiness and the Eady rate × the storms' size, as the rain stage
    // reckons them: rain.js — per season and row; spread evenly over the directions, σ per component)
    const L = PARAMS.RAIN_EDDY_LENGTH_KM * 1000, gust = PARAMS.OCEAN_GUST_MS, ss = [];
    for (let s = 0; s < 4; s++) {
        const months = [(3 * s + 11) % 12, 3 * s, 3 * s + 1], rows = new Float32Array(climGrid.h);
        const ks = (ctx.anchors ?? []).map((a, k) => [Math.floor(a) % 12, k]).filter(([m]) => months.includes(m)).map(([, k]) => k);
        if (!ks.length && ctx.anchors?.length) {                       // (no anchor month in the season: the nearest)
            let best = 0, bd = 99;
            ctx.anchors.forEach((a, k) => { const d = Math.min(Math.abs(a - 3 * s), 12 - Math.abs(a - 3 * s)); if (d < bd) { bd = d; best = k; } });
            ks.push(best);
        }
        for (let j = 0; j < climGrid.h; j++) {
            let e = 0;
            for (const k of ks) { const ey = ctx.eady[k]; e += ey[Math.min(ey.length - 1, Math.floor(j * ey.length / climGrid.h))] / ks.length; }
            rows[j] = F.waveStormShare * Math.hypot(gust, (ctx.eady ? e : 0) / 86400 * L) / Math.SQRT2;
        }
        ss.push(rows);
    }
    // (the sea's waves: grown toward a fully developed sea by the wind along the way, carried on as swell, fading; none
    // under the ice. P: what arrives over a step of km toward the coast, travelling toward direction d)
    // (each grid cell's seas toward each direction, by season: the fifth power of the wind along it, storms and all)
    // (with the terrain pool's workers where the finish has one: runs of the work dealt round-robin, every (K)th to this
    // thread and the rest to the workers — asked first, so they work while this thread does its own; every grid cell's
    // seas are their own, so they are the same however dealt)
    const pool = ctx.pool ?? null, hands = pool ? pool.size : 0;
    const deal = (count, k) => { const runs = shares(count, k + 1); return [runs.filter((_, i) => i % (k + 1) === k), runs.filter((_, i) => i % (k + 1) !== k)]; };
    const seas = { D, w: climGrid.w, h: climGrid.h, su: new Float32Array(4 * G), sv: new Float32Array(4 * G), ss: new Float32Array(4 * climGrid.h) };
    for (let s = 0; s < 4; s++) { seas.su.set(su[s], s * G); seas.sv.set(sv[s], s * G); seas.ss.set(ss[s], s * climGrid.h); }
    const gen5 = new Float32Array(4 * G * D), genU = new Float32Array(4 * G * D);
    {
        const [mine, theirs] = deal(G, hands), asked = hands ? pool.wavesSeas(seas, theirs) : null;
        for (const [from, to] of mine) seaRange(seas, from, to, gen5, genU);
        if (asked) for (const { from, to, gen5: a, genU: b } of await asked) for (let s = 0; s < 4; s++) {
            gen5.set(a.subarray(s * (to - from) * D, (s + 1) * (to - from) * D), (s * G + from) * D);
            genU.set(b.subarray(s * (to - from) * D, (s + 1) * (to - from) * D), (s * G + from) * D);
        }
    }
    // (the grid's land: a cell most of whose mesh cells stand above the sea — the far field stops there)
    const landG = new Float32Array(G), cntG = new Float32Array(G), landMask = new Uint8Array(G), step = 180 / climGrid.h;
    for (let c = 0; c < n; c++) { const g = gridCell(climGrid, step, ctx.lat[c], ctx.lon[c]); cntG[g]++; if (z[c] >= 0) landG[g]++; }
    for (let g = 0; g < G; g++) landMask[g] = cntG[g] > 0 && landG[g] > 0.5 * cntG[g] ? 1 : 0;
    const siAll = new Float32Array(4 * G);
    for (let s = 0; s < 4; s++) siAll.set(si[s], s * G);
    const T = { D, w: climGrid.w, h: climGrid.h, gen5, genU, si: siAll, landMask, far: null, swellDecayKm: F.swellDecayKm, waveSatK: F.waveSatK, waveFetchK: F.waveFetchK,
        farStep: F.waveFarStepKm, farSteps: Math.round(F.waveFarKm / F.waveFarStepKm), nearStep: 1.5 * edgeKm, nearSteps: Math.floor(F.waveNearKm / (1.5 * edgeKm)) };
    // ── the waves' rays on the GPU (gpu/coast-rays.js): the far field on the climate grid, traced at once — the waves arriving
    // at each sea grid cell from each direction, by season — and, each step, the waves near the coast on the mesh ──
    const rays = await coastRaysGPU(ctx.device, T, mesh, ctx.lat, ctx.lon);
    /** The waves arriving at each of `cells` from each direction (kW/m), the seasons' mean, into out[i·D … i·D + D). */
    const wavesAt = async (cells, out) => { out.set(await rays.near(z, cells)); };
    try {
        // ── the coast worked over coastYears, in coastSteps: the waves at the coast, the cliffs cut, the sand moved ──
        const steps = F.coastSteps, dt = F.coastYears / steps;
        // (the loose sand on the shore — part of each cell's height, km³: the shoreface's prism to start with, then what the cliffs
        // shed and the rivers bring; the drift moves only this)
        const loose = new Float32Array(n), riverRate = new Map();
        for (const [mouth, load] of ctx.mouths ?? []) riverRate.set(mouth, F.coastRiverSand * load / ctx.carveYears);
        const isCoastLand = new Uint8Array(n), isShore = new Uint8Array(n), avail = new Float64Array(n), open = new Uint8Array(n);
        let first = true, z0Sum = 0;
        for (let c = 0; c < n; c++) z0Sum += z[c];
        for (let it = 0; it < steps; it++) {
            // (the open sea: the world ocean, if it is at least coastSeaKm2 — not a hollow below sea level the ice dug inland, dry
            // until the rivers fill it (finish-hydro.js), whose shores no swell reaches. The world ocean is one body, so this is
            // the old flood of its bodies at least that big, to the cell)
            const W = await ctx.worldOcean(z), ocean = W.oceanCells >= F.coastSeaKm2 / cellKm2 ? W.ocean : new Uint8Array(n);
            isCoastLand.fill(0); isShore.fill(0);
            const coast = [];
            for (let c = 0; c < n; c++) {
                const land = z[c] >= 0;
                if (!land && !ocean[c]) continue;
                for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                    const nb = adjList[k];
                    if (land && ocean[nb]) { isCoastLand[c] = 1; break; }
                    if (!land && z[nb] >= 0) { isShore[c] = 1; break; }
                }
                if (isCoastLand[c] || isShore[c]) coast.push(c);
            }
            const Pd = new Float32Array(coast.length * D), at = new Int32Array(n).fill(-1);
            coast.forEach((c, i) => { at[c] = i; });
            await wavesAt(Int32Array.from(coast), Pd);
            // (the shoreface's sand at the start, on the shore cells no deeper than the closure depth: below it the waves don't move it)
            if (first) { for (const c of coast) if (isShore[c] && z[c] >= -F.closureKm) loose[c] = F.coastSandKm * cellKm2; first = false; }
            avail.fill(0);
            // (the cliffs: cut back toward a wave-cut platform; their rock's sand to the shore below)
            let waveSum = 0, waveN = 0;
            for (const c of coast) {
                if (!isCoastLand[c]) continue;
                let P = 0;
                for (let d = 0; d < D; d++) P += Pd[at[c] * D + d];
                wave[c] = P; waveSum += P; waveN++;
                if (loose[c] > 0) continue;                                 // (a beach the drift built is the drift's, not a cliff)
                const erod = F.cliffHardRatio ** (1 - (soft ? soft[c] : 0.5)), hM = Math.max(0, z[c]) * 1000;
                const retreatM = F.cliffK * P * erod / (hM + F.cliffToeM);
                const share = Math.min(F.coastMaxShare, retreatM * 1e-3 * dt / edgeKm), cut = share * (z[c] - F.platformKm);
                if (!(cut > 0)) continue;
                z[c] -= cut;
                const vol = cut * cellKm2;
                stats.erodedKm3 += vol;
                let shores = 0;
                for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (isShore[adjList[k]]) shores++;
                if (!shores) { stats.mudKm3 += vol; continue; }              // (no shore below it to take the sand: all offshore)
                for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (isShore[adjList[k]]) avail[adjList[k]] += F.cliffSandShare * vol / shores;
                stats.mudKm3 += (1 - F.cliffSandShare) * vol;
            }
            stats.meanWaveKw = waveN ? waveSum / waveN : 0;
            // (the rivers' sand, at their mouths — or the shore nearest them, once a delta or a barrier has built out)
            for (const [mouth, rate] of riverRate) {
                let s = mouth;
                if (!isShore[s]) { s = -1; for (let k = adjOffset[mouth]; k < adjOffset[mouth + 1]; k++) if (isShore[adjList[k]]) { s = adjList[k]; break; } }
                if (s >= 0) { avail[s] += rate * dt; stats.riverKm3 += rate * dt; }
            }
            // (the cliffs' and rivers' sand laid on its shore cell, then carried along the shore by the waves — gpu/shore-gpu.js, the
            // one-line model's cellular form — in substeps, the waves held at this step's)
            for (const c of coast) if (avail[c] > 0) { loose[c] += avail[c]; z[c] += avail[c] / cellKm2; stats.sandKm3 += avail[c]; }
            for (let c = 0; c < n; c++) open[c] = ocean[c] || isCoastLand[c] ? 1 : 0;
            const r = await shoreDriftGPU(ctx.device, { mesh, z, loose, open, coast, at, Pd, D, dt: dt / F.shoreSubsteps, substeps: F.shoreSubsteps,
                K: F.longshoreK, crestKm: F.beachCrestKm, cellKm2, smooth: F.shoreSmooth });
            stats.bandCells = Math.max(stats.bandCells, r.bandCells);
        }
        // (the books: the ground's volume changed only by the cliffs' mud carried offshore — the sand stayed on the shore)
        let zSum = 0;
        for (let c = 0; c < n; c++) zSum += z[c];
        stats.booksKm3 = (zSum - z0Sum) * cellKm2 + stats.mudKm3;
        for (let c = 0; c < n; c++) stats.looseKm3 += loose[c];
    } finally { rays.destroy(); }
    for (let c = 0; c < n; c++) {
        change[c] = z[c] - start[c];
        if (start[c] >= 0 && z[c] < 0) stats.landLostKm2 += cellKm2;
        if (start[c] < 0 && z[c] >= 0) stats.landGainedKm2 += cellKm2;
    }
    for (const k of ['erodedKm3', 'mudKm3', 'sandKm3', 'riverKm3', 'looseKm3', 'booksKm3', 'landLostKm2', 'landGainedKm2', 'meanWaveKw']) stats[k] = Math.round(stats[k] * 10) / 10;
    return { wave, change, stats };
}

/**
 * Each grid cell's seas toward each direction, by season — the fifth power of the wind along it, storms and all — for
 * grid cells [from, to), into gen5 and genU (its fifth root; 4 seasons × grid × D, at their own places — or, given base
 * and span, 4 seasons × span × D from grid cell base on). seas: { D, w, h,
 * su, sv (4 × grid: the seasons' winds, east and north), ss (4 × rows: the storms' spread) }.
 */
export function seaRange(seas, from, to, gen5, genU, base = 0, span = seas.w * seas.h) {
    const { D, w, h, su, sv, ss } = seas, G = w * h, SIN = new Float64Array(D), COS = new Float64Array(D);
    for (let d = 0; d < D; d++) { const b = d * 2 * Math.PI / D; SIN[d] = Math.sin(b); COS[d] = Math.cos(b); }
    for (let s = 0; s < 4; s++) for (let g = from; g < to; g++) {
        const sig = ss[s * h + Math.floor(g / w)], u = su[s * G + g], v = sv[s * G + g];
        for (let d = 0; d < D; d++) {
            const U5 = pow5(u * SIN[d] + v * COS[d], sig), o = (s * span + g - base) * D + d;
            gen5[o] = U5; genU[o] = U5 ** 0.2;
        }
    }
}

/** [0, n) cut into 4·k runs, to deal round-robin among k hands (the grid's rows and the coast differ along their length). */
function shares(n, k) {
    const count = 4 * k, out = [];
    for (let i = 0; i < count; i++) out.push([Math.floor(i * n / count), Math.floor((i + 1) * n / count)]);
    return out;
}

/**
 * The lagoons a stage's fill closed off (lane coastwave: the late polish's deltas, laid to today's sea; the water stage's ponds):
 * a bay of the open sea whose mouth was filled to the sea's level keeps a tidal inlet through the fill, held open by the tide that fills and empties it — the inlet's throat
 * section A = 1.576·10⁻⁴ · P^0.95 m² for a tidal prism P m³ (Jarrett 1976, all US inlets; O'Brien 1931's law), P the lagoon's
 * area × the tidal range. On the mesh the throat is a channel of cells through the stage's own fill (cells it raised from
 * below the sea to at or above it), each cut to the mean depth that carries the throat across a
 * cell's width; what the cut takes is swept into the lagoon (its flood-tide delta), so nothing is made or lost. A lagoon too
 * small to take it is filled to the sea's level by it (back-barrier infill: a marsh, land). A lagoon whose
 * only way out is through ground the stage didn't raise (rock, an older fill) is left closed: the hydrology's.
 * What it skips: the tide itself (one range everywhere, tidalRangeM), the inlet's migration and closure by the drift, and
 * lagoons a cell or smaller (the mesh's own coast).
 * @param {Object} o { mesh, z (km, changed in place), zBefore (the ground before the stage), wasOcean (the open sea before it: the
 *                     world ocean of zBefore), ocean (the open sea now), cellKm2, edgeKm }
 * @returns {{pockets, cells, km2, opened, openedKm2, infilled, infilledKm2, cutKm3, closed, closedKm2}}
 */
export function tidalInlets({ mesh, z, zBefore, wasOcean, ocean, cellKm2, edgeKm }, F) {
    const { adjOffset, adjList, numCells: n } = mesh, comp = new Int32Array(n).fill(-1), out = { pockets: 0, cells: 0, km2: 0, opened: 0, openedKm2: 0, infilled: 0, infilledKm2: 0, cutKm3: 0, closed: 0, closedKm2: 0 };
    const sealed = c => z[c] < 0 && wasOcean[c] && !ocean[c], laid = c => zBefore[c] < 0 && z[c] >= 0;
    const from = new Int32Array(n).fill(-1);
    for (let s = 0; s < n; s++) {
        if (!sealed(s) || comp[s] >= 0) continue;
        // (the pocket: the sealed sea joined to s)
        const id = out.pockets++, cells = [s];
        comp[s] = id;
        for (let i = 0; i < cells.length; i++) for (let k = adjOffset[cells[i]]; k < adjOffset[cells[i] + 1]; k++) { const y = adjList[k]; if (comp[y] < 0 && sealed(y)) { comp[y] = id; cells.push(y); } }
        out.cells += cells.length;
        const areaKm2 = cells.length * cellKm2;
        // (the shortest way out through the stage's fill, breadth first from the pocket's edge, cells in index order)
        const seen = [], q = [];
        for (const c of cells) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const y = adjList[k]; if (from[y] < 0 && laid(y)) { from[y] = c; seen.push(y); q.push(y); } }
        let end = -1;
        for (let i = 0; i < q.length && end < 0; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) {
            const y = adjList[k];
            if (ocean[y]) { end = q[i]; break; }
            if (from[y] < 0 && comp[y] !== id && laid(y)) { from[y] = q[i]; seen.push(y); q.push(y); }
        }
        const path = [];
        for (let c = end; c >= 0 && comp[c] !== id; c = from[c]) path.push(c);
        for (const c of seen) from[c] = -1;
        if (end < 0) { out.closed++; out.closedKm2 += areaKm2; continue; }
        // (the throat's mean depth over a cell's width; the cut swept into the lagoon in proportion to its depth. If the lagoon can
        // take the whole cut it stays open behind its inlet; if not, the tide's sand fills it to the sea's level first — infilled,
        // a marsh behind the barrier, the throat cut only as far as the lagoon took)
        const prism = areaKm2 * 1e6 * F.tidalRangeM, throatM2 = 1.576e-4 * prism ** 0.95, dKm = throatM2 / (edgeKm * 1e3) / 1e3;
        let want = 0, deep = 0;
        for (const c of path) want += Math.max(0, z[c] + dKm) * cellKm2;
        for (const c of cells) deep += -z[c] * cellKm2;
        if (!(want > 0)) { out.closed++; out.closedKm2 += areaKm2; continue; }
        const cut = Math.min(want, deep), f = cut / want;
        for (const c of path) z[c] -= f * Math.max(0, z[c] + dKm);
        for (const c of cells) z[c] += cut * (-z[c] * cellKm2 / deep) / cellKm2;
        if (cut < deep) { out.opened++; out.openedKm2 += areaKm2; } else { out.infilled++; out.infilledKm2 += areaKm2; for (const c of cells) z[c] = Math.max(z[c], 0); }
        out.cutKm3 += cut;
    }
    out.km2 = Math.round(out.cells * cellKm2); out.openedKm2 = Math.round(out.openedKm2); out.infilledKm2 = Math.round(out.infilledKm2); out.closedKm2 = Math.round(out.closedKm2); out.cutKm3 = +out.cutKm3.toFixed(2);
    return out;
}
