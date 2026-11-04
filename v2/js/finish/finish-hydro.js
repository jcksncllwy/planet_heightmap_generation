// The finish's waters, what the water pass (finish-fsm.js, Fill-Spill-Merge) shares with the rest of the finish:
//   · the water kinds of a cell and of the picture (Water), and a river's regime (Regime);
//   · the world ocean's near misses: an inland sea behind a strait narrower than the cells, opened (openStraits), and the
//     remnants of the sea in a basin, marked (fillSeaBasins: a body below sea level cut off from the ocean, whose water the
//     water pass judges by its balance as any other hollow's);
//   · one water, one kind (oneWater), and each river's year (riverYears), both run by the water pass.
// Until 2026-11-03 this file held the hydrology itself: a priority flood with rules that rewrote the ground so its rivers could
// cross it (graded fills, gorges, pockets cut, a breach for the ice's lakes, late rounds of fills; 2.6–3.2 % of the land's cells
// at 2.5M). With the time-stepped erosion doing that work, Fill-Spill-Merge replaced it (lane fsm-wire; the study: lane fsm).
// In m³/s, km, mm.

import { MinHeap } from '../core/min-heap.js';

const SEC_PER_YEAR = 3.156e7, R = 6371;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Lake kinds (per cell, and per pixel of the finished picture). */
export const Water = Object.freeze({ NONE: 0, FRESH: 1, SALT: 2, PAN: 3 });

/**
 * Inland seas the open ocean all but reaches: a body below sea level behind a low, short barrier — a strait narrower than
 * the mesh's cells, low land the carve keeps at its floor — is opened into the ocean, the barrier cut to F.straitDepthKm
 * below sea level along the way its water would spill (a priority flood from the sea). By a smooth weight on the
 * barrier's height (its sill, m) and its length over dry land (km): the same at every detail. A body left closed is the
 * hydrology's: a remnant of the sea in a basin (hydrology: `sea` hollows).
 * @returns {{opened: number, cut: number}} bodies opened, cells cut
 */
export function openStraits(mesh, z, ocean, F) {
    const { adjOffset, adjList, numCells: n, xyz } = mesh;
    const { fill, parent, rank } = spillFlood(mesh, z, ocean);
    // each body below sea level the ocean does not reach: its way out from the cell the flood reached first
    const seen = new Uint8Array(n);
    let opened = 0, cut = 0;
    for (let s = 0; s < n; s++) {
        if (seen[s] || ocean[s] || !(z[s] < 0)) continue;
        const cells = [s];
        seen[s] = 1;
        let first = s;
        for (let i = 0; i < cells.length; i++) {
            const c = cells[i];
            if (rank[c] >= 0 && (rank[first] < 0 || rank[c] < rank[first])) first = c;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!seen[nb] && !ocean[nb] && z[nb] < 0) { seen[nb] = 1; cells.push(nb); } }
        }
        if (rank[first] < 0) continue;
        let barrierKm = 0, sillKm = 0;
        const path = [];
        for (let c = first, guard = 0; c >= 0 && rank[c] !== -2 && guard < 1e6; guard++) {
            path.push(c);
            const p = parent[c];
            if (z[c] >= 0 && p >= 0) barrierKm += R * Math.hypot(xyz[3 * p] - xyz[3 * c], xyz[3 * p + 1] - xyz[3 * c + 1], xyz[3 * p + 2] - xyz[3 * c + 2]);
            if (z[c] > sillKm) sillKm = z[c];
            c = p;
        }
        const open = (1 - smooth(F.straitSillM[0], F.straitSillM[1], 1000 * sillKm)) * (1 - smooth(F.straitKm[0], F.straitKm[1], barrierKm));
        if (open < 0.5) continue;
        for (const c of path) if (z[c] > -F.straitDepthKm) { z[c] = -F.straitDepthKm; cut++; }
        opened++;
    }
    return { opened, cut };
}

/** The way water would spill to the sea from every cell (a priority flood from the ocean, water below sea level standing
 *  at it): each cell's spill level (km, ≥ 0), the cell it was reached from, and its order (-2: the ocean). */
function spillFlood(mesh, z, ocean) {
    const { adjOffset, adjList, numCells: n } = mesh;
    const fill = new Float32Array(n), parent = new Int32Array(n).fill(-1), rank = new Int32Array(n).fill(-1), heap = new MinHeap(1 << 16);
    let count = 0;
    for (let c = 0; c < n; c++) {
        if (!ocean[c]) continue;
        rank[c] = -2;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!ocean[nb] && parent[nb] === -1) { parent[nb] = c; fill[nb] = Math.max(0, z[nb]); heap.push(fill[nb], nb); } }
    }
    while (heap.size) {
        const c = heap.pop();
        if (rank[c] !== -1) continue;
        rank[c] = count++;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (rank[nb] !== -1 || ocean[nb]) continue;
            const level = Math.max(fill[c], Math.max(0, z[nb]));
            if (parent[nb] === -1 || level < fill[nb]) { parent[nb] = c; fill[nb] = level; heap.push(level, nb); }
        }
    }
    return { fill, parent, rank };
}

/**
 * A remnant of the sea in a basin — a body below sea level cut off from the world ocean: its cells, below its rim. Its
 * water is the hydrology's — its level its water balance's (sea hollows: a lake to its rim that spills, a salt sea below
 * sea level, a playa on its floor). Its floor is as the history left it: the rivers that ran into it filled it with
 * their rock as long as it was cut off (tectonics/step/sea-fill.js — the Precaspian's ~20 km, the Black Sea's 14–19 km).
 * (Until 2026-10-27 it was filled here as well, toward at most seaFillKm below its rim, whatever its age or its rivers.)
 * @returns {Uint8Array} 1 on the basins' cells (below their rim)
 */
export function fillSeaBasins(mesh, z, ocean, F) {
    const { adjOffset, adjList, numCells: n } = mesh, EPS = 1e-4, cellKm2 = 4 * Math.PI * R * R / n;
    const { fill } = spillFlood(mesh, z, ocean), basin = new Uint8Array(n), seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
        if (seen[s] || basin[s] || ocean[s] || !(z[s] < 0)) continue;
        // (the body below sea level: big and deep enough to be a remnant of the sea — a smooth weight in km² and km)
        const below = [s];
        seen[s] = 1;
        let deepest = z[s];
        for (let i = 0; i < below.length; i++) for (let k = adjOffset[below[i]]; k < adjOffset[below[i] + 1]; k++) {
            const nb = adjList[k];
            if (!seen[nb] && !ocean[nb] && z[nb] < 0) { seen[nb] = 1; below.push(nb); if (z[nb] < deepest) deepest = z[nb]; }
        }
        const sea = smooth(F.seaBasinKm2[0], F.seaBasinKm2[1], below.length * cellKm2) * smooth(F.seaBasinDeepKm[0], F.seaBasinDeepKm[1], -deepest);
        if (sea < 0.5) continue;
        const L = fill[s], cells = [s];
        basin[s] = 1;
        for (let i = 0; i < cells.length; i++) for (let k = adjOffset[cells[i]]; k < adjOffset[cells[i] + 1]; k++) {
            const nb = adjList[k];
            if (!basin[nb] && !ocean[nb] && fill[nb] > z[nb] + EPS && Math.abs(fill[nb] - L) < 1e-6) { basin[nb] = 1; cells.push(nb); }
        }
    }
    return basin;
}

/**
 * One surface, one kind (Jackson, 2026-11-01: one inland sea drawn salt with fresh along its edges). hollowLakes judges each
 * sub-basin on its own water, so a bay behind a low sill that fills and spills is fresh beside the salt lake it spills into, and
 * which bays exist turns on how finely the mesh draws their divides: it is an artefact of the tree, not of the water. Waters
 * across a sill narrower than F.lakeJoinKm whose levels differ by less than F.lakeSwingKm are one water here: all of them take
 * the kind of most of its area. Their levels stay. A reduced rule, with its limits: it needs both thresholds, it decides by area,
 * and it changes only what is drawn and counted, not where the rivers end. What it stands in for is a salt balance per
 * connected water, which the hydrology does not have; that, or Fill-Spill-Merge's level sets, should replace it.
 * @returns {number} the cells whose kind changed
 */
export function oneWater(mesh, kind, level, ocean, F) {
    const { adjOffset, adjList, numCells: n, edgeKm } = mesh, gap = Math.round(F.lakeJoinKm / edgeKm), wet = k => k === Water.FRESH || k === Water.SALT;
    const body = new Int32Array(n).fill(-1), dist = new Int16Array(n), levels = [], uf = [];
    let front = [];
    for (let s = 0; s < n; s++) {
        if (body[s] >= 0 || !wet(kind[s])) continue;
        const me = levels.length, q = [s];
        levels.push(level[s]); uf.push(me);
        body[s] = me;
        for (let i = 0; i < q.length; i++) {
            const c = q[i];
            front.push(c);
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (body[y] < 0 && kind[y] === kind[s] && Math.abs(level[y] - level[s]) < 1e-3) { body[y] = me; q.push(y); } }
        }
    }
    const find = i => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
    // (out from every shore at once: a dry cell belongs to the water nearest it, and two waters' fronts meet at their sill)
    while (front.length) {
        const next = [];
        for (const c of front) for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
            const y = adjList[j];
            if (ocean[y]) continue;
            if (body[y] < 0) { if (dist[c] < gap) { body[y] = body[c]; dist[y] = dist[c] + 1; next.push(y); } }
            else if (body[y] !== body[c] && dist[c] + dist[y] <= gap && Math.abs(levels[body[y]] - levels[body[c]]) <= F.lakeSwingKm) uf[find(body[y])] = find(body[c]);
        }
        front = next;
    }
    const fresh = new Float64Array(levels.length), salt = new Float64Array(levels.length);
    for (let c = 0; c < n; c++) if (wet(kind[c])) (kind[c] === Water.SALT ? salt : fresh)[find(body[c])]++;
    let changed = 0;
    for (let c = 0; c < n; c++) {
        if (!wet(kind[c])) continue;
        const r = find(body[c]), k = salt[r] > fresh[r] ? Water.SALT : Water.FRESH;
        if (kind[c] !== k) { kind[c] = k; changed++; }
    }
    return changed;
}

/** River regimes (per river point): 0 permanent and steady, 1 permanent with a flood season, 2 seasonal (dry some months),
 *  3 dry most of the year. */
export const Regime = Object.freeze({ STEADY: 0, FLOOD: 1, SEASONAL: 2, EPHEMERAL: 3 });

/**
 * Each river point's year: the twelve monthly flows, four months at a time (at 10M cells four arrays of flows is 160 MB):
 * each cell's runoff shared out over the months (ctx.months.at: the shares, and each month's dryness), routed as the year's was — lakes gather their
 * cells' water and pass on at their outlet the year's outflow, shaped by their inflow's months and evened out
 * (F.lakeRegulation); a basin's dry ground routed as before; river beds losing water by each month's dryness (a dry
 * season's low flow can vanish into the bed: the river runs dry). Then per point: its regime, its flood months
 * (around the peak, the months within 60 % of it), and whether it is fed from afar (permanent where the land is dry).
 */
export function riverYears(ctx, F, G) {
    const { n, count, order, recv, rank, stepKm, own, sink, body, lakeIn, lakeOut, cells } = G, { pet, rain } = ctx, monthsAt = ctx.months.at;
    const P = cells.length, qm = new Float32Array(12 * P), M = 4, acc = Array.from({ length: M }, () => new Float32Array(n)), sh = new Float32Array(M), ar = new Float32Array(M);
    const lam = F.lakeRegulation;
    for (let m0 = 0; m0 < 12; m0 += M) {
        for (const a of acc) a.fill(0);
        // (down the year's network, upstream first — hydrology's final routing)
        for (let i = count - 1; i >= 0; i--) {
            const c = order[i], r0 = 12 * own(c);
            monthsAt(c, m0, M, sh, ar);
            for (let j = 0; j < M; j++) acc[j][c] += r0 * sh[j];
            if (sink[c]) continue;                                    // (where the water ends: a salt lake, a pan, a dry sink)
            const r = recv[c], pass = r >= 0 && rank[r] >= 0, b = body[c];
            if (b >= 0) {
                if (pass && body[r] === b) { for (let j = 0; j < M; j++) acc[j][r] += acc[j][c]; continue; }
                // (a lake passes on its year's outflow, shaped by its inflow's months — evened out by its storage)
                const qin = lakeIn[c], qout = lakeOut[c];
                for (let j = 0; j < M; j++) acc[j][c] = qout > 0 && qin > 0 ? qout * ((1 - lam) * acc[j][c] / qin + lam) : 0;
            } else {
                // (the bed loses water by the month's own dryness: most in the dry season, none while frozen)
                for (let j = 0; j < M; j++) {
                    const out = acc[j][c];
                    if (ar[j] > 0 && out > 0) acc[j][c] = Math.max(0, out - F.bedLossMPerYear * ar[j] * F.riverWidthPerSqrtQ * Math.sqrt(out) * stepKm[c] * 1000 / SEC_PER_YEAR);
                }
            }
            if (pass) for (let j = 0; j < M; j++) acc[j][r] += acc[j][c];
        }
        for (let p = 0; p < P; p++) for (let j = 0; j < M; j++) qm[12 * p + m0 + j] = acc[j][cells[p]];
    }
    // ── regimes ──
    const regime = new Uint8Array(P), floodFrom = new Uint8Array(P), floodTo = new Uint8Array(P), farFed = new Uint8Array(P), months = qm;
    for (let p = 0; p < P; p++) {
        let sum = 0, max = 0, peak = 0;
        for (let m = 0; m < 12; m++) { const v = qm[12 * p + m]; sum += v; if (v > max) { max = v; peak = m; } }
        const mean = sum / 12;
        let dry = 0;
        for (let m = 0; m < 12; m++) if (qm[12 * p + m] < Math.max(F.dryM3s, F.dryShare * mean)) dry++;
        regime[p] = dry >= F.ephemeralMonths ? Regime.EPHEMERAL : dry >= 1 ? Regime.SEASONAL : max >= F.floodRatio * mean ? Regime.FLOOD : Regime.STEADY;
        let a = peak, b = peak;
        while (a !== (peak + 1) % 12 && qm[12 * p + (a + 11) % 12] >= 0.6 * max && (a + 11) % 12 !== peak) a = (a + 11) % 12;
        while (qm[12 * p + (b + 1) % 12] >= 0.6 * max && (b + 1) % 12 !== a) b = (b + 1) % 12;
        floodFrom[p] = a; floodTo[p] = b;
        const c = cells[p];
        farFed[p] = regime[p] <= Regime.FLOOD && pet[c] > 0 && Math.max(0, rain[c]) < F.farFedAridity * pet[c] ? 1 : 0;
    }
    return ctx.debug ? { regime, floodFrom, floodTo, farFed, months } : { regime, floodFrom, floodTo, farFed };     // (the months: for checks only)
}
