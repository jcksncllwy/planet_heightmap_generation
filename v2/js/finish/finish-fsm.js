// The finish's water, by Fill-Spill-Merge (lane fsm-wire, 2026-11-03; the study: lane fsm, 2026-11-01): the rivers and lakes of a
// finished moment on the ground the time-stepped erosion left (finish-erode.js), which has already cut what its rivers would cut
// and filled what their load would fill. Barnes, Callaghan & Wickert 2021 (Earth Surf. Dynam. 9: 105) route runoff to the pits
// of a depression hierarchy (Barnes, Callaghan & Wickert 2020, ibid. 8: 431), spill what a depression cannot hold into its
// neighbour, merge two full ones, and draw the water's surface. Here, over a whole planet:
//   · the hierarchy: a priority flood from the world ocean finds each hollow, and hollowLakes (finish-basins.js) builds that
//     hollow's tree. The spills between hollows go by the flood's order, highest hollow first: the paper's oceanlinks;
//   · the water by flux, not volume. The paper has no evaporation: a depth of rain is shared out once, and at equilibrium every
//     hollow with any surplus would fill. A depression is judged here by its inflow against its lake's evaporation at each
//     level (open water at lakeEvapShare of the land's potential evaporation, less the rain on it), hollowLakes' balance. This
//     is the file's departure from the paper;
//   · nothing is cut and nothing levelled: no size, origin or age decides whether water stands, only its balance. The map's
//     thresholds (lakeMinKm2, two cells, lakeMinDepthM) decide what is drawn. Water under them is still water: a pond full to
//     its sill is filled to that sill (pondFill), the river's load having filled what the map cannot show, and the rivers
//     cross it at that level; a terminal one is a playa, its floor levelled to where its water dries (Water.PAN);
//   · the rivers: a second priority flood over land and water, from the sea and from every place water ends (a salt lake, a
//     playa), each cell down the steepest fall per km to a cell reached before; a flat (a lake's surface, a filled pond) by
//     Barnes, Lehman & Mulla 2014's two gradients, the rule the erosion's routing uses (finish-erode.js flatRule);
//   · discharge (m³/s) down that network: each cell's runoff, a lake passing on what reached it less its open water's loss, a
//     river losing water along its bed in dry country (width ∝ √Q, ∝ aridity); each river's year (finish-hydro.js riverYears).
// Limits: it has no time and no load, so it says where water stands on this ground, never whether the ground should hold it.
// That is the erosion's: without it (F.erode false, a study switch) this pass gives about 2.5× Earth's lake share (lane fsm).
// Whether a lake is young and filling (the old hydrology's fill-time rule) is not judged, nor whether the ice age's are. Heights km.

import { MinHeap } from '../core/min-heap.js';
import { hollowLakes } from './finish-basins.js';
import { Water, oneWater, riverYears } from './finish-hydro.js';

const R = 6371, SEC_PER_YEAR = 3.156e7, EPS = 1e-4;
// (a flood's key on a flat: its level plus this × the cells across the flat from where the flood came onto it: an order only)
const FLAT_KEY = 1e-11;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @param {{mesh, z: Float32Array, ocean: Uint8Array, runoff: Float32Array (mm/yr), pet: Float32Array (mm/yr), rain: Float32Array (mm/yr),
 *          wetMonths: Float32Array (0–12), ice: Uint8Array|null, glaciated: Uint8Array|null, basin: Float32Array|null, seaBasin: Uint8Array|null,
 *          lat, lon, months, debug}} ctx  as finish-hydro.js hydrology's. z is changed only where the map's thresholds hide water (above)
 * @returns as hydrology's: {lake, lakeLevel, q, area, rivers, stats, terminal, and for checks recv, lakeSrc, hollow, hollowInfo, fsm}
 */
export function fillSpillMerge(ctx, F) {
    const { mesh, z, ocean, runoff, pet, rain, wetMonths } = ctx, { adjOffset, adjList, numCells: n, xyz } = mesh, cellKm2 = 4 * Math.PI * R * R / n;
    const lap = (() => { let t0 = performance.now(); const ms = {}; const f = name => { const t = performance.now(); ms[name] = Math.round(t - t0); t0 = t; }; f.ms = ms; return f; })();
    const edgeKm = (a, b) => R * Math.hypot(xyz[3 * a] - xyz[3 * b], xyz[3 * a + 1] - xyz[3 * b + 1], xyz[3 * a + 2] - xyz[3 * b + 2]);
    let nanHeights = 0;
    for (let c = 0; c < n; c++) if (Number.isNaN(z[c])) nanHeights++;           // (a bug upstream, counted: check-phase8b.mjs fails on any)
    const own = c => Math.max(0, runoff[c]) * cellKm2 * 1e3 / SEC_PER_YEAR;     // (mm × km² → m³/s)
    // (what open water loses over a cell, beyond what its land already lost: the cell's own runoff is in the water that
    // reaches the hollow, so the sky water its open water nets against is the rain its ground keeps — rain less its own
    // runoff, ctx.skyKept (finish.js) — not all the rain, which counted it twice; without it, the rain)
    const kept = ctx.skyKept ?? rain;
    const lakeLoss = c => Math.max(0, F.lakeEvapShare * pet[c] - Math.max(0, kept[c])) * cellKm2 * 1e3 / SEC_PER_YEAR;
    const aridity = c => (pet[c] > 0 ? smooth(0, 1, (pet[c] - Math.max(0, rain[c])) / pet[c]) : 0);
    const bedKept = (c, out, stepKm) => {
        const arid = aridity(c);
        if (!(arid > 0) || !(out > 0)) return out;
        return Math.max(0, out - F.bedLossMPerYear * arid * F.riverWidthPerSqrtQ * Math.sqrt(out) * stepKm * 1000 / SEC_PER_YEAR);
    };
    const heap = new MinHeap(1 << 16);

    // ── the flood from the sea: each land cell's spill level, its order ──
    const fill = new Float32Array(n), rank = new Int32Array(n).fill(-1), from = new Int32Array(n).fill(-1), order = new Int32Array(n);
    let count = 0;
    for (let c = 0; c < n; c++) {
        if (!ocean[c]) continue;
        rank[c] = -2;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!ocean[nb] && from[nb] === -1) { from[nb] = c; fill[nb] = Math.max(0, z[nb]); heap.push(fill[nb], nb); } }
    }
    while (heap.size) {
        const c = heap.pop();
        if (rank[c] !== -1) continue;
        rank[c] = count; order[count++] = c;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (rank[nb] !== -1 || ocean[nb]) continue;
            const level = Math.max(fill[c], z[nb]);
            if (from[nb] === -1 || level < fill[nb]) { from[nb] = c; fill[nb] = level; heap.push(level, nb); }
        }
    }
    // (the way each cell's water leaves it on the filled surface, for the spills between hollows: the steepest fall to a cell the
    // flood reached before, else the way it came)
    const recv = new Int32Array(n).fill(-1), stepKm = new Float32Array(n);
    const steepest = (c, i, at, rk) => {
        let pick = -1, best = 0;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k], rn = rk[nb];
            if (!(rn === -2 || (rn >= 0 && rn < i))) continue;
            const d = at[c] - (rn === -2 ? Math.min(0, z[nb]) : at[nb]);
            if (!(d > 0)) continue;
            const s = d / edgeKm(c, nb);
            if (s > best) { best = s; pick = nb; }
        }
        return pick;
    };
    for (let i = 0; i < count; i++) { const c = order[i], p = steepest(c, i, fill, rank); recv[c] = p >= 0 ? p : from[c]; }
    lap('flood');

    // ── the hollows: connected cells under one spill level ──
    const hollow = new Int32Array(n).fill(-1), hollows = [];
    for (let i = 0; i < count; i++) {
        const s = order[i];
        if (hollow[s] >= 0 || !(fill[s] > z[s] + EPS)) continue;
        const id = hollows.length, cells = [s], L = fill[s];
        hollow[s] = id;
        let floor = z[s], deepCell = s;
        for (let j = 0; j < cells.length; j++) for (let k = adjOffset[cells[j]]; k < adjOffset[cells[j] + 1]; k++) {
            const nb = adjList[k];
            if (hollow[nb] < 0 && rank[nb] >= 0 && fill[nb] > z[nb] + EPS && Math.abs(fill[nb] - L) < 1e-6) { hollow[nb] = id; cells.push(nb); if (z[nb] < floor) { floor = z[nb]; deepCell = nb; } }
        }
        let outlet = cells[0], glacial = 0, dug = 0, sea = false;
        for (const c of cells) {
            if (rank[c] < rank[outlet]) outlet = c;
            if (ctx.glaciated?.[c]) glacial++;
            if (ctx.basin?.[c] > F.basinLakeKm) dug++;
            if (ctx.seaBasin?.[c]) sea = true;
        }
        let frozen = 0;
        if (ctx.frozen) for (const c of cells) frozen += ctx.frozen[c];
        const scoured = dug >= F.basinLakeShare * cells.length;
        hollows.push({ cells, level: L, outlet, floor, deepCell, sea, scoured, glacial: scoured || glacial >= 0.5 * cells.length, iced: frozen >= 0.5 * cells.length, inflow: 0, area: 0, aP: 0, aE: 0, drawn: [] });
    }
    lap('hollows');

    // ── fill, spill, merge: from the highest ground down, each hollow's lakes by the water that reaches them ──
    // (the ice age's lakes stand as any other, where their water fills them: a glaciated land's lake districts, Finland's and the
    // Shield's. Until FSM one had to be big for its river, lakeKeepKm2 × √(inflow / 1000 m³/s), or it was filled: at 2.5M 155–1 020
    // lakes a world, 9 000–51 000 km³ of fill, most of the ground the water pass raised; the share without it 0.78–2.87 %, in or
    // near Earth's)
    const shows = (W, floor) => W.cells.length >= 2 && W.cells.length * cellKm2 >= F.lakeMinKm2 && (W.level - floor) * 1000 >= F.lakeMinDepthM;
    const q = new Float32Array(n), area = new Float32Array(n), aP = new Float32Array(n), aE = new Float32Array(n);
    const lake = new Uint8Array(n), lakeLevel = new Float32Array(n).fill(NaN), sink = new Uint8Array(n), lakeSrc = ctx.debug ? new Uint8Array(n) : null;
    const census = { bodies: 0, fresh: 0, salt: 0, pits: 0, pitsFilled: 0, ponds: 0, pondCells: 0, pondKm3: 0, closedHollows: 0 };
    let filledCells = 0;
    const closed = [];
    const fillTo = (W, why) => {                                     // (a body of water under the map's thresholds, full: filled to its sill)
        for (const x of W.cells) if (z[x] < W.level) { census.pondKm3 += (W.level - z[x]) * cellKm2; z[x] = W.level; filledCells++; }
        census.ponds++; census.pondCells += W.cells.length;
        if (why === 'pit') census.pitsFilled++;
    };
    for (let i = count - 1; i >= 0; i--) {
        const c = order[i], id = hollow[c];
        q[c] += own(c); area[c] += cellKm2; aP[c] += Math.max(0, rain[c]) * cellKm2; aE[c] += pet[c] * cellKm2;
        if (id >= 0) {
            const h = hollows[id];
            h.inflow += q[c]; h.area += area[c]; h.aP += aP[c]; h.aE += aE[c];
            if (c !== h.outlet) continue;
            // (a whole hollow smaller than the map shows is filled by its rivers' load and spills: a pit of a cell or so fills in
            // thousands of years even in a desert, a 3 m pit of 200 km² on 0.5 Mt a year of load. Judged as a sink, the 2 900–4 800 of
            // them a world took the water of the hollows below them: a humid plain's lakes (rain 1 160 mm) closed and drawn as playas,
            // white, in the gallery, and the land draining to a sink 0.33–0.52 against Earth's ~0.2. A sub-basin that small inside a
            // bigger closed hollow is the bigger hollow's: there its water ends, as in a playa's floor)
            // (and one shallower than the map shows, its rim under lakeMinDepthM above its floor: judged by its water, the plains' dishes
            // a few metres deep closed as salt lakes so shallow that they dried to playas, white and branching on a green plain in the
            // gallery, 2026-11-03. A dish that shallow fills with its rivers' load as a pit does)
            // (a hollow on ground where no month thaws — most of its cells: ctx.frozen, finish.js thawedWater — holds no water: its
            // snow stays, year on year, and fills it as firn and ice to its rim, and what reaches it passes on (as ice, or as the
            // water of the thawed ground above it under the ice). Not a lake and not a sink: an ice sheet's hollows are its bed's,
            // and Earth's endorheic land (~20 %) leaves Antarctica's ice out. Its floor is left as it is: the ice is not drawn
            // here (lane polar, 2026-11-05; until then its rain, snow and all, ran off and filled it as a fresh lake, 0–157 000
            // km² a world, and with the thaw gate alone closed it as a salt lake or playa)
            if (h.iced) {
                h.kind = Water.NONE; h.levelNow = h.level; census.iced = (census.iced || 0) + 1;
                q[c] = h.inflow; area[c] = h.area; aP[c] = h.aP; aE[c] = h.aE;
            } else if (h.cells.length < 2 || h.cells.length * cellKm2 < F.lakeMinKm2 || (h.level - h.floor) * 1000 < F.lakeMinDepthM) {
                fillTo({ cells: h.cells, level: h.level }, 'pit');
                h.kind = Water.NONE; h.levelNow = h.level;
                q[c] = h.inflow; area[c] = h.area; aP[c] = h.aP; aE[c] = h.aE;
            } else {
                const S = hollowLakes(mesh, h.cells, z, x => q[x], lakeLoss, 0, h.level);
                h.closed = !S.full; h.outflow = S.full ? S.outflow : 0;
                let lakeKm2 = 0, panKm2 = 0, salt = false;
                for (const W of S.lakes) {
                    let floor = Infinity;
                    for (const x of W.cells) if (z[x] < floor) floor = z[x];
                    census.bodies++;
                    if (W.full) {
                        if (!shows(W, floor)) { fillTo(W, 'small'); continue; }
                        for (const x of W.cells) { lake[x] = Water.FRESH; lakeLevel[x] = W.level + 1e-5; if (lakeSrc) lakeSrc[x] = 8; }
                        census.fresh++; lakeKm2 += W.cells.length * cellKm2;
                        h.drawn.push({ kind: Water.FRESH, cells: W.cells });
                    } else {
                        // (where water ends: a salt lake the map shows. A smaller one is a playa, its floor levelled to where its water dries,
                        // and the rivers end there; it is drawn as dry ground, like a pond: the map's thresholds decide what is drawn. Drawn as
                        // playas, the closed pits of the dry lands were 2 900–4 800 white one-cell dots a world, 0.4–0.7 % of the land; Jackson,
                        // 2026-11-03: "white one-cell salt pans on plateaus". A playa the map shows comes from a salt lake: finish-erode.js playas)
                        const drawn = W.cells.length >= 2 && W.cells.length * cellKm2 >= F.lakeMinKm2;
                        for (const x of W.cells) {
                            sink[x] = 1;
                            if (drawn) { lake[x] = Water.SALT; lakeLevel[x] = W.level + 1e-5; if (lakeSrc) lakeSrc[x] = 9; }
                            else if (z[x] < W.level) { z[x] = W.level; filledCells++; }
                        }
                        if (drawn) { census.salt++; salt = true; lakeKm2 += W.cells.length * cellKm2; h.drawn.push({ kind: Water.SALT, cells: W.cells }); } else census.pits++;
                    }
                }
                if (h.closed) {
                    census.closedHollows++;
                    const end = S.fate(h.deepCell);
                    h.kind = salt ? Water.SALT : Water.PAN;      // (a closed basin with no salt lake the map shows: a playa's, drawn or not) h.levelNow = end >= 0 ? S.lakes[end].level : h.floor;
                    closed.push({ catchKm2: h.area, lakeKm2, panKm2, aridity: h.aE > 0 ? h.aP / h.aE : 0, lakes: S.lakes.length });
                    q[c] = 0;
                    continue;
                }
                h.kind = h.drawn.length ? Water.FRESH : Water.NONE; h.levelNow = h.level;
                q[c] = S.outflow; area[c] = h.area; aP[c] = h.aP; aE[c] = h.aE;
            }
        }
        const out = bedKept(c, q[c], edgeKm(c, recv[c])), r = recv[c];
        q[c] = out;
        if (rank[r] >= 0) { q[r] += out; area[r] += area[c]; aP[r] += aP[c]; aE[r] += aE[c]; }
    }
    lap('water');

    // ── the rivers: a flood over land and water, from the sea and from where water ends ──
    const surf = new Float32Array(n), fl = fill, rk = rank, flat = new Float32Array(n);
    for (let c = 0; c < n; c++) surf[c] = lake[c] === Water.FRESH || lake[c] === Water.SALT ? Math.max(z[c], lakeLevel[c]) : z[c];
    for (let c = 0; c < n; c++) {
        if (rk[c] === -2) continue;
        rk[c] = -1; from[c] = -1;
        if (sink[c]) { fl[c] = surf[c]; flat[c] = 0; heap.push(fl[c], c); from[c] = c; }
    }
    for (let c = 0; c < n; c++) {
        if (rk[c] !== -2) continue;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (rk[nb] === -2 || sink[nb]) continue;
            const v = Math.max(0, surf[nb]);
            if (from[nb] === -1 || v < fl[nb]) { from[nb] = c; fl[nb] = v; flat[nb] = 0; heap.push(v, nb); }
        }
    }
    count = 0;
    while (heap.size) {
        const c = heap.pop();
        if (rk[c] !== -1) continue;
        rk[c] = count; order[count++] = c;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (rk[nb] !== -1 || sink[nb]) continue;
            const level = Math.max(fl[c], surf[nb]);
            if (from[nb] === -1 || level < fl[nb]) { from[nb] = c; fl[nb] = level; flat[nb] = level === fl[c] ? flat[c] + 1 : 0; heap.push(level + FLAT_KEY * flat[nb], nb); }
        }
    }
    let unresolved = 0;
    const flats = [];
    for (let i = 0; i < count; i++) {
        const c = order[i];
        if (sink[c]) { recv[c] = -1; continue; }
        if (fl[c] > surf[c] + EPS) unresolved++;                    // (a cell under the flood's surface with no water on it: none should be)
        let p = steepest(c, i, fl, rk);
        // (no way down: a cell beside the sea takes it, any other waits for its flat's two gradients)
        if (p < 0) for (let k = adjOffset[c]; k < adjOffset[c + 1] && p < 0; k++) if (rk[adjList[k]] === -2) p = adjList[k];
        if (p < 0) { recv[c] = -1; flats.push(c); continue; }
        recv[c] = p;
    }
    const flatCells = flats.length;
    if (flats.length) drainFlats(mesh, flats, fl, rk, from, recv, sink);
    // (receivers before donors again: the flats' ways no longer follow the flood)
    {
        const kids = new Int32Array(n), stack = [];
        for (let i = 0; i < count; i++) { const r = recv[order[i]]; if (r >= 0 && rk[r] >= 0) kids[r]++; }
        for (let i = 0; i < count; i++) if (!kids[order[i]]) stack.push(order[i]);
        let at = count;
        while (stack.length) { const c = stack.pop(), r = recv[c]; order[--at] = c; if (r >= 0 && rk[r] >= 0 && --kids[r] === 0) stack.push(r); }
        if (at !== 0) throw new Error(`fillSpillMerge: ${at} cells on a loop of receivers`);       // (none should be: the flats' ways fall toward their lower edge)
        for (let i = 0; i < count; i++) rk[order[i]] = i;
    }
    for (let i = 0; i < count; i++) { const c = order[i], r = recv[c]; stepKm[c] = r >= 0 ? edgeKm(c, r) : 0; }
    lap('route');

    // ── discharge, upstream first: a lake passes on at its way out what reached it less what its open water loses ──
    const body = new Int32Array(n).fill(-1), bodyLoss = [];
    for (let s = 0; s < n; s++) {
        if (lake[s] !== Water.FRESH || body[s] >= 0) continue;
        const id = bodyLoss.length, st = [s];
        body[s] = id;
        let loss = 0;
        while (st.length) {
            const x = st.pop();
            loss += lakeLoss(x);
            for (let k = adjOffset[x]; k < adjOffset[x + 1]; k++) { const y = adjList[k]; if (body[y] < 0 && lake[y] === Water.FRESH && Math.abs(lakeLevel[y] - lakeLevel[s]) < 1e-6) { body[y] = id; st.push(y); } }
        }
        bodyLoss.push(loss);
    }
    const qw = new Float32Array(n), lakeIn = new Float32Array(n).fill(-1), lakeOut = new Float32Array(n);
    q.fill(0); area.fill(0);
    let toSea = 0, toSinks = 0, closedEvap = 0, total = 0, lost = 0;
    for (let i = count - 1; i >= 0; i--) {
        const c = order[i], r0 = own(c);
        total += r0;
        q[c] += r0; qw[c] += r0 * (wetMonths?.[c] ?? 12); area[c] += cellKm2;
        if (sink[c]) { toSinks += q[c]; continue; }
        const r = recv[c], b = body[c];
        if (b >= 0) {
            if (rk[r] >= 0 && body[r] === b) { q[r] += q[c]; qw[r] += qw[c]; area[r] += area[c]; continue; }
            const take = Math.min(q[c], bodyLoss[b]);
            bodyLoss[b] -= take;
            if (hollow[c] >= 0 && hollows[hollow[c]].closed) closedEvap += take;
            lakeIn[c] = q[c]; lakeOut[c] = q[c] - take;
            qw[c] *= q[c] > 0 ? lakeOut[c] / q[c] : 0; q[c] = lakeOut[c];
        } else {
            const was = q[c], kept = bedKept(c, was, stepKm[c]);
            lost += was - kept; qw[c] *= was > 0 ? kept / was : 0; q[c] = kept;
        }
        if (rk[r] >= 0) { q[r] += q[c]; qw[r] += qw[c]; area[r] += area[c]; } else toSea += q[c];
    }
    lap('discharge');
    // (for the census: where each cell's water ends, the sea or a sink, by the aridity of the place, P/PET: < 0.05, 0.2, 0.5, more)
    const ends = new Uint8Array(n), byArid = { land: [0, 0, 0, 0], endo: [0, 0, 0, 0] };
    for (let i = 0; i < count; i++) {
        const c = order[i], r = recv[c];
        ends[c] = sink[c] ? 1 : r >= 0 && rk[r] >= 0 ? ends[r] : 0;
        const ai = pet[c] > 0 ? Math.max(0, rain[c]) / pet[c] : 9, k = ai < 0.05 ? 0 : ai < 0.2 ? 1 : ai < 0.5 ? 2 : 3;
        byArid.land[k]++; if (ends[c]) byArid.endo[k]++;
    }
    census.endoRouted = +(byArid.endo.reduce((a, b) => a + b, 0) / Math.max(1, count)).toFixed(3);
    census.aridLand = byArid.land.map(v => +(v / Math.max(1, count)).toFixed(3));
    census.endoInArid = byArid.endo.map((v, k) => +(v / Math.max(1, byArid.land[k])).toFixed(3));

    // ── the rivers as polylines: reaches carrying at least riverMinM3s, not on lakes, not on ice caps ──
    const on = c => rk[c] >= 0 && q[c] >= F.riverMinM3s && !lake[c] && !(ctx.ice && ctx.ice[c]);
    const ups = new Uint8Array(n), L = { start: [], lat: [], lon: [], q: [], season: [], cell: [] };
    for (let i = 0; i < count; i++) { const c = order[i], r = recv[c]; if (on(c) && r >= 0 && on(r)) ups[r] = Math.min(255, ups[r] + 1); }
    const push = (c, v, s, at = c) => {
        if (ctx.lat) { L.lat.push(ctx.lat[c]); L.lon.push(ctx.lon[c]); }
        else { L.lat.push(Math.asin(Math.max(-1, Math.min(1, xyz[3 * c + 2]))) * 180 / Math.PI); L.lon.push(Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * 180 / Math.PI); }
        L.q.push(v); L.season.push(s); L.cell.push(at);
    };
    let reaches = 0, biggest = 0;
    for (let i = count - 1; i >= 0; i--) {
        const s = order[i];
        if (!on(s) || ups[s] === 1) continue;                     // (a head: a source or a confluence)
        L.start.push(L.lat.length);
        for (let c = s, g = 0; g < 1e6; g++) {
            const season = q[c] > 0 ? qw[c] / q[c] : 0;
            push(c, q[c], season);
            if (q[c] > biggest) biggest = q[c];
            const r = recv[c];
            if (r < 0) break;
            // (the mouth: into the sea, a lake, a playa or another river's confluence; its point ends this reach)
            if (rk[r] === -2 || lake[r] || !on(r) || ups[r] !== 1) { if (rk[r] === -2 || lake[r] || on(r)) push(r, q[c], season, c); break; }
            c = r;
        }
        reaches++;
    }
    const regimes = ctx.months ? riverYears(ctx, F, { n, count, order, recv, rank: rk, lakeKind: lake, stepKm, own, sink, body, lakeIn, lakeOut, cells: Int32Array.from(L.cell) }) : null;
    const joined = oneWater(mesh, lake, lakeLevel, ocean, F);
    lap('rivers');

    // ── what it found ──
    let lakeCells = 0;
    const byOrigin = { glacialFresh: 0, tectonicFresh: 0, salt: 0, pan: 0 }, sizes = [];
    for (const h of hollows) for (const d of h.drawn) {
        const kind = d.kind === Water.PAN ? d.kind : lake[d.cells[0]] || d.kind;              // (oneWater may have changed it)
        const a = d.cells.length * cellKm2;
        byOrigin[kind === Water.FRESH ? (h.glacial ? 'glacialFresh' : 'tectonicFresh') : kind === Water.SALT ? 'salt' : 'pan'] += a;
        sizes.push(a);
    }
    sizes.sort((a, b) => b - a);
    let fresh = 0, salt = 0, pans = 0;
    for (const h of hollows) for (const d of h.drawn) { const k = d.kind === Water.PAN ? d.kind : lake[d.cells[0]] || d.kind; if (k === Water.FRESH) fresh++; else if (k === Water.SALT) salt++; else pans++; }
    for (let c = 0; c < n; c++) if (lake[c]) lakeCells++;
    // (each sea cut off from the ocean: its basin, its floor and rim (km), its water's kind, level and area, what flows in (km³ a year))
    const seas = hollows.filter(h => h.sea).map(h => {
        let wet = 0, below = 0;
        for (const c of h.cells) { if (lake[c]) wet++; if (z[c] < 0) below++; }
        return { km2: Math.round(h.cells.length * cellKm2), belowKm2: Math.round(below * cellKm2), floorKm: +h.floor.toFixed(3), sillKm: +h.level.toFixed(3), kind: h.kind, levelKm: +(h.levelNow ?? h.level).toFixed(3),
            waterKm2: Math.round(wet * cellKm2), inflowKm3: +(h.inflow * SEC_PER_YEAR / 1e9).toFixed(1), spills: !h.closed };
    });
    const landKm2 = count * cellKm2;
    return {
        lake, lakeLevel, q, area,
        ...(ctx.debug ? { recv, lakeSrc, hollow, hollowInfo: hollows.map(h => ({ km2: h.cells.length * cellKm2, level: h.level, floor: h.floor, lake: h.drawn.length > 0, sea: h.sea, glacial: h.glacial, closed: !!h.closed, levelNow: h.levelNow, inflow: h.inflow })) } : {}),
        rivers: { start: Int32Array.from(L.start), lat: Float32Array.from(L.lat), lon: Float32Array.from(L.lon), q: Float32Array.from(L.q), season: Float32Array.from(L.season), ...(regimes ?? {}) },
        terminal: ctx.debug ? hollows.filter(h => h.closed).sort((a, b) => b.inflow - a.inflow).slice(0, 12).map(h => {
            let P = 0, E = 0, la = 0, lo = 0, full = 0;
            for (const c of h.cells) { P += rain[c]; E += pet[c]; la += ctx.lat?.[c] ?? 0; lo += ctx.lon?.[c] ?? 0; full += lakeLoss(c); }
            const k = h.cells.length;
            return { inflow: +h.inflow.toFixed(0), fullEvap: +full.toFixed(0), cells: k, km2: Math.round(k * cellKm2), depthM: Math.round((h.level - h.floor) * 1000), rain: Math.round(P / k), pet: Math.round(E / k), at: `${(lo / k).toFixed(0)},${(la / k).toFixed(0)}`, kind: h.kind };
        }) : null,
        stats: { runoffMm: total * SEC_PER_YEAR / 1e3 / Math.max(1, landKm2), toSeaShare: toSea / Math.max(1e-9, total), toBasinsShare: (toSinks + closedEvap) / Math.max(1e-9, total), lostShare: lost / Math.max(1e-9, total),
            byOriginShare: Object.fromEntries(Object.entries(byOrigin).map(([k, v]) => [k, +(100 * v / Math.max(1, landKm2)).toFixed(2)])), biggestLakesKm2: sizes.slice(0, 6).map(Math.round), joinedWaters: joined, nanHeights,
            cutCells: 0, cutMaxKm: 0, cutMeanM: 0, keptPockets: { unresolved }, filledCells, reaches, points: L.lat.length, biggestM3s: biggest, freshLakes: fresh, saltLakes: salt, pans,
            lakeShare: lakeCells * cellKm2 / Math.max(1, landKm2), seas,
            // (the land whose water ends in a closed basin, and each closed basin: its catchment, its lakes' water and its playas (km²),
            // its catchment's aridity, rain ÷ potential evaporation)
            // (by the rivers: the land whose water ends in a sink, of any size; the closed hollows' catchments were 0.17–0.23 against this
            // 0.33–0.52 at 2.5M, the difference the pits' catchments nested in a bigger closed hollow's, counted once there)
            endorheicShare: census.endoRouted,
            closed: closed.sort((a, b) => b.catchKm2 - a.catchKm2).map(b => ({ catchKm2: Math.round(b.catchKm2), lakeKm2: Math.round(b.lakeKm2), panKm2: Math.round(b.panKm2), aridity: +b.aridity.toFixed(3), lakes: b.lakes })),
            // (the pass's own census: its stages' ms, the bodies it found and what the map's thresholds hid)
            fsm: { ms: lap.ms, hollows: hollows.length, ...census, pondKm3: Math.round(census.pondKm3), flatCells } },
    };
}

/**
 * A flat's ways out (Garbrecht & Martz 1997; Barnes, Lehman & Mulla 2014): drainage runs away from higher ground and towards lower,
 * the two superimposed, the second twice over so that every flat cell has a neighbour further along: 2·(hops from the lower edge)
 * − (hops from the higher edge). A flat with no higher edge has only the first. Each cell drains to the neighbour lowest on that
 * surface, the first in adjacency order on a tie. The same rule as the erosion's routing (finish-erode.js drainFlats, flatRule), so
 * the erosion's rivers and the drawn ones choose alike. `flats`: the cells with no way down; their recv set here.
 */
function drainFlats(mesh, flats, level, rank, from, recv, sink) {
    const { adjOffset, adjList, numCells: n } = mesh, low = new Int32Array(n), high = new Int32Array(n), mark = new Uint8Array(n);
    for (const c of flats) mark[c] = 1;
    const wave = (seed, on) => {
        for (let q = seed, d = 1; q.length; d++) {
            const next = [];
            for (const c of q) for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (mark[y] && on[y] === 0 && level[y] === level[c]) { on[y] = d + 1; next.push(y); } }
            q = next;
        }
    };
    const toLow = [], toHigh = [];
    for (const c of flats) {
        let exit = false, wall = false;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
            const y = adjList[j];
            if (rank[y] < 0) continue;
            if (level[y] === level[c] && !mark[y]) exit = true;
            if (level[y] > level[c] && !sink[y]) wall = true;
        }
        if (exit) { low[c] = 1; toLow.push(c); }
        if (wall) { high[c] = 1; toHigh.push(c); }
    }
    wave(toLow, low); wave(toHigh, high);
    for (const c of flats) {
        let pick = -1, best = Infinity;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
            const y = adjList[j];
            if (rank[y] < 0 || level[y] !== level[c]) continue;
            if (!mark[y]) { pick = y; break; }
            const v = 2 * low[y] - high[y];
            if (low[y] > 0 && v < best) { best = v; pick = y; }
        }
        recv[c] = pick < 0 ? from[c] : pick;
    }
}
