// F3 — the last ice age, Earth-like. The moment's climate cooled (more toward the poles) and dried, the sea ~120 m lower;
// ice where snow outlasts the summer (Ohmura's summer temperature at the equilibrium line, from the precipitation),
// flowing out past its snowline — a glacier's tongue, an ice sheet's lobes; its thickness a plastic ice sheet's
// (√ of the distance to its margin), its surface over the bed smoothed. Where ice gathered and flowed it cut troughs
// — U-shaped valleys along its paths, below the sea where it reached the sea (fjords) — scoured hollows into the bed
// under the sheets (lake districts on the shields), left moraines at its farthest reach and outwash beyond; then it
// melted, and the land it pressed down is still sunk, rebounding (Hudson Bay, the Baltic).

import { spreadKm } from '../core/min-heap.js';
import { FastNoise } from '../core/fast-noise.js';
import { outburstFloods } from './finish-floods.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const R = 6371, LAPSE = 6.5;

/** The summer temperature (°C) at the equilibrium line for a year's precipitation P (mm) — Ohmura et al. 1992. */
const elaTemp = P => (-296 + Math.sqrt(Math.max(0, 296 * 296 - 36 * (645 - P)))) / 18;

/**
 * @param {Object} ctx  { mesh, z (km, changed in place), lat, lon (degrees), warmSl (warmest month at sea level, °C),
 *                        rain (mm/year; NaN at sea), grid (LatLonGrid), cellKm2, seed }
 * @returns {{ice: Uint8Array, margin: Uint8Array, iceKm2: number, sheets: number, basin: Float32Array, floods: Object}}
 *          basin: how deep (km) the ice dug each cell's basin; floods: finish-floods.js
 */
export function lastIceAge(ctx, F) {
    const { mesh, z, lat, warmSl, grid, cellKm2 } = ctx, n = mesh.numCells, { adjOffset, adjList, edgeKm, xyz } = mesh;
    // rain where the climate gave none (the sea, bare at the ice age on the shelves): the land's, blurred
    const rainG = grid.blur(grid.average(lat, ctx.lon, ctx.rain, c => ctx.rain[c] === ctx.rain[c]), 150);
    // ── the ice age's summer and snow, and where snow outlasts summer ──
    const tS = new Float32Array(n), snow = new Float32Array(n), acc = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
        const a = Math.abs(lat[c]) / 90, cold = F.iceColdEqC + (F.iceColdPoleC - F.iceColdEqC) * a ** 1.5;
        const P = (ctx.rain[c] === ctx.rain[c] ? ctx.rain[c] : grid.at(rainG, lat[c], ctx.lon[c])) * (1 - F.iceDrier * a);
        tS[c] = warmSl[c] - cold - LAPSE * Math.max(0, z[c]);
        snow[c] = P;
        if (z[c] > -F.iceSeaDropKm && P > 80 && tS[c] < elaTemp(P)) acc[c] = 1;
    }
    // ── snowfields, and how far past its snowline each one's ice flows (by its size) ──
    const comp = new Int32Array(n).fill(-1), sizes = [];
    for (let s = 0; s < n; s++) {
        if (!acc[s] || comp[s] >= 0) continue;
        const id = sizes.length, q = [s]; comp[s] = id;
        for (let i = 0; i < q.length; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const nb = adjList[k]; if (acc[nb] && comp[nb] < 0) { comp[nb] = id; q.push(nb); } }
        sizes.push(q.length * cellKm2);
    }
    const reach = Float32Array.from(sizes, a => F.iceMarginC[0] + (F.iceMarginC[1] - F.iceMarginC[0]) * smooth(Math.log(F.iceSheetKm2[0]), Math.log(F.iceSheetKm2[1]), Math.log(a)));
    // ice spreads from its snowfields while the summer is not too warm for it (grounded on the shelf, not the deep sea)
    const ice = new Uint8Array(n), allow = new Float32Array(n).fill(-Infinity), q = [];
    for (let c = 0; c < n; c++) if (acc[c]) { ice[c] = 1; allow[c] = reach[comp[c]]; q.push(c); }
    for (let i = 0; i < q.length; i++) {
        const c = q[i];
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (ice[nb] || z[nb] < -F.iceGroundedKm || tS[nb] > elaTemp(snow[nb]) + allow[c]) continue;
            ice[nb] = 1; allow[nb] = allow[c]; q.push(nb);
        }
    }
    let iceCells = 0;
    for (let c = 0; c < n; c++) iceCells += ice[c];
    if (!iceCells) return { ice, margin: new Uint8Array(n), iceKm2: 0, sheets: 0, basin: new Float32Array(n), floods: outburstFloods({ mesh, z, ice, S: null, cellKm2, seed: ctx.seed }, F) };
    // ── thickness from the distance to the margin; the surface over the bed smoothed ──
    const toEdge = new Float32Array(n).fill(Infinity);
    for (let c = 0; c < n; c++) if (ice[c]) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (!ice[adjList[k]]) { toEdge[c] = 0.5 * edgeKm; break; }
    spreadKm(mesh, toEdge, { canEnter: (a, b) => ice[b] === 1 });
    const bedG = grid.blur(grid.average(lat, ctx.lon, z, c => ice[c] === 1), 60), H = new Float32Array(n), S = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        if (!ice[c]) continue;
        H[c] = Math.min(F.iceMaxKm, Math.sqrt(F.iceNyeKm * toEdge[c]));
        const bed = grid.at(bedG, lat[c], ctx.lon[c]);
        S[c] = Math.max(z[c] + 0.05, (bed === bed ? Math.max(bed, -F.iceSeaDropKm) : z[c]) + H[c]);
    }
    // ── the ice's flow, steered by the bed (the land's valleys) with a little of its surface's pull; its flux, the
    // snowfield area upstream ──
    const route = new Float32Array(n), iceList = [];
    for (let c = 0; c < n; c++) if (ice[c]) { route[c] = z[c] + F.iceSteer * (S[c] - z[c]); iceList.push(c); }
    iceList.sort((a, b) => route[b] - route[a]);
    const down = new Int32Array(n).fill(-1), flux = new Float32Array(n);
    for (const c of iceList) {
        flux[c] += acc[c] ? cellKm2 : 0.15 * cellKm2;
        let best = -1, low = route[c];
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (ice[nb] && route[nb] < low) { low = route[nb]; best = nb; } }
        down[c] = best;
        if (best >= 0) flux[best] += flux[c];
    }
    // ── troughs: along the ice's paths, deeper and wider with its flux, U-shaped across (a coarse cell holding more
    // than a trough drops by the share of it the trough takes) ──
    const cut = new Float32Array(n), [f1, f2] = F.troughFluxKm2, lf1 = Math.log(f1), lf2 = Math.log(f2);
    for (const c of iceList) {
        if (flux[c] < f1) continue;
        // (sliding fast near the margin, frozen to the bed deep inside a sheet)
        const s = smooth(lf1, lf2, Math.log(flux[c])), wet = smooth(0.1, 0.6, S[c] - z[c]) * smooth(F.iceCutsWithinKm[0], F.iceCutsWithinKm[1], toEdge[c]);
        if (!(wet > 0)) continue;
        // (deeper in soft rock, shallower in hard: finish.js soft — terrain/records.js iceSoft)
        const rock = ctx.soft ? 1 + F.troughSoftGain * (ctx.soft[c] - 0.5) : 1;
        const depth = F.troughKm * (0.25 + 0.75 * s) * wet * rock, half = F.troughWidthKm[0] + (F.troughWidthKm[1] - F.troughWidthKm[0]) * s;
        const own = depth * Math.min(1, 2 * half / edgeKm);
        if (own > cut[c]) cut[c] = own;
        if (half > 0.5 * edgeKm) {                                   // (a trough wider than a cell reaches its neighbours)
            const x = xyz[3 * c], y = xyz[3 * c + 1], w = xyz[3 * c + 2];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k], r = R * Math.hypot(xyz[3 * nb] - x, xyz[3 * nb + 1] - y, xyz[3 * nb + 2] - w), u = r / half;
                if (u >= 1) continue;
                const d = depth * (1 - u ** 4);                        // (flat floor, steep walls)
                if (d > cut[nb]) cut[nb] = d;
            }
        }
    }
    // ── basins: where a lobe of the ice slid out over soft rock, it dug the rock out broadly, far below the land around —
    // the Great Lakes in the platform's shales at the shield's edge, the Baltic, the shield-edge lakes from Winnipeg to Great
    // Bear. By the ice's flux and how near its margin it slid, blurred to a basin's breadth, then deepest where the rock is
    // softest — the hard rims stand (the Niagara Escarpment between Huron and Georgian Bay) ──
    const soft = ctx.soft, basin = new Float32Array(n);
    if (soft && F.basinKm > 0) {
        const lobe = grid.blur(lobeFeed(grid, lat, ctx.lon, ice, acc, route), F.basinSmoothKm), lb1 = Math.log(F.basinFeedKm[0]), lb2 = Math.log(F.basinFeedKm[1]);
        // (on the lowlands the lobes spread over — the region's ground, not a valley floor in a range: the mountains' ice
        // carves troughs, above)
        const low = grid.blur(grid.average(lat, ctx.lon, z, c => z[c] > 0), F.basinLowBlurKm);
        for (const c of iceList) {
            const L = grid.at(lobe, lat[c], ctx.lon[c]);
            if (!(L > 0)) continue;
            basin[c] = F.basinKm * smooth(lb1, lb2, Math.log(L)) * smooth(F.basinWithinKm[0], F.basinWithinKm[1], toEdge[c]) * smooth(F.basinLipKm[0], F.basinLipKm[1], toEdge[c]) * smooth(F.basinLowKm[0], F.basinLowKm[1], grid.at(low, lat[c], ctx.lon[c])) * (F.basinRim + (1 - F.basinRim) * soft[c] ** F.basinSoftPower);
        }
        // (an overdeepening is deep against its outlet, not against the land around: the ice dug below the lowest point of
        // the basin's rim, whichever way the land slopes — or the basins of a sheet's margin, on land falling toward its
        // snout, would only steepen the slope and hold no water. Each basin — the cells dug at least basinCoreKm, joined —
        // is cut its own depth and at least that below its rim's lowest ground, at most basinMaxCutKm)
        // (a basin open to the sea is a sound — the Baltic, Hudson Bay — dug as deep as it is; inland, a sill of ground the
        // ice did not dig, basinSillKm from the coast, holds its lakes: the St Lawrence below Ontario)
        const coast = [], seaHop = new Int32Array(n).fill(-1), sillHops = Math.round(F.basinSillKm / Math.sqrt(cellKm2));
        for (let c = 0; c < n; c++) if (z[c] < 0) { seaHop[c] = 0; coast.push(c); }
        for (let i = 0; i < coast.length; i++) { const c = coast[i]; if (seaHop[c] >= sillHops) continue;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (seaHop[nb] < 0) { seaHop[nb] = seaHop[c] + 1; coast.push(nb); } } }
        const sill = c => seaHop[c] >= 0;
        for (const c of iceList) if (sill(c) && z[c] >= 0) basin[c] = Math.min(basin[c], F.basinCoreKm * 0.5);
        // (a basin is a lobe's: one too big for a lobe — a whole low island under the ice, dug from coast to coast — is split
        // where it was dug deepest, its core raised until each part is at most basinMaxKm2; the cells left out are the ridges
        // between its lakes, dug only their own depth)
        const member = new Int32Array(n).fill(-1);
        let stamp = 0;
        const split = (list, core) => {
            const inList = ++stamp;
            for (const c of list) member[c] = inList;
            for (const s of list) {
                if (member[s] !== inList || !(basin[s] >= core)) continue;
                const part = ++stamp, cells = [s];
                member[s] = part;
                let deepest = basin[s];
                for (let i = 0; i < cells.length; i++) for (let k = adjOffset[cells[i]]; k < adjOffset[cells[i] + 1]; k++) {
                    const nb = adjList[k];
                    if (member[nb] === inList && basin[nb] >= core) { member[nb] = part; cells.push(nb); if (basin[nb] > deepest) deepest = basin[nb]; }
                }
                if (cells.length * cellKm2 > F.basinMaxKm2 && core * F.basinSplitStep < deepest) { split(cells, core * F.basinSplitStep); continue; }
                let rim = Infinity;
                for (const c of cells) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (member[nb] !== part && z[nb] < rim) rim = z[nb]; }
                for (const c of cells) basin[c] = Math.min(F.basinMaxCutKm, Math.max(basin[c], z[c] - rim + basin[c]));
            }
        };
        split(iceList.filter(c => !sill(c) && basin[c] >= F.basinCoreKm), F.basinCoreKm);
        for (const c of iceList) cut[c] += basin[c];
    }
    // ── scour under the sheets: hollows in the bed where the ice was thick (where the mesh can show them) ──
    const noise = new FastNoise((ctx.seed | 0) * 97 + 31), sf = R / F.scourScaleKm, show = smooth(2, 3.2, F.scourScaleKm / edgeKm);
    // ── then the ice melts: troughs and hollows cut, moraines and outwash at its farthest reach, the land still sunk ──
    const load = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        if (!ice[c]) continue;
        let d = cut[c];
        if (show > 0) {
            const v = noise.fbm(xyz[3 * c] * sf, xyz[3 * c + 1] * sf, xyz[3 * c + 2] * sf, 2, 0.5) * 1.6 - 0.15;
            if (v > 0) d += F.scourKm * show * smooth(0.4, 1.4, H[c]) * Math.min(1, v / 0.6);
        }
        z[c] -= d;
        load[c] = 0.3 * H[c];                                         // (ρ_ice / ρ_mantle × thickness)
    }
    // moraines on the first land past the ice, outwash plains a little beyond
    const margin = new Uint8Array(n), past = new Float32Array(n).fill(Infinity);
    for (let c = 0; c < n; c++) {
        if (ice[c] || !(z[c] > 0)) continue;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (ice[adjList[k]]) { margin[c] = 1; past[c] = 0; break; }
    }
    spreadKm(mesh, past, { canEnter: (a, b) => !ice[b] && z[b] > 0, maxKm: 60 });
    for (let c = 0; c < n; c++) {
        if (!(past[c] < 60)) continue;
        const ridge = F.moraineKm * Math.exp(-((past[c] / Math.max(6, edgeKm)) ** 2)), plain = 0.4 * F.moraineKm * (1 - past[c] / 60);
        z[c] += Math.max(ridge, plain);
    }
    // the rebound still to come: the ice's weight, spread by the lithosphere
    const loadG = grid.blur(grid.average(lat, ctx.lon, load), F.reboundKm);
    for (let c = 0; c < n; c++) { const L = grid.at(loadG, lat[c], ctx.lon[c]); if (L > 0) z[c] -= F.reboundLeft * L; }
    // the lakes the ice dammed, and their floods (finish-floods.js): on the ground as the ice left it, the ice still standing
    const floods = outburstFloods({ mesh, z, ice, S, cellKm2, seed: ctx.seed }, F);
    let sheets = 0;
    for (const a of sizes) if (a >= F.iceSheetKm2[1] * 0.3) sheets++;
    return { ice, margin, iceKm2: iceCells * cellKm2, sheets, basin, floods };
}

/**
 * How much snowfield feeds each km of the ice's width (km² per km), on the grid: the ice routed there — not on the mesh,
 * whose flow lines split the ice into as many strands as it has cells across, so their fluxes would change with the
 * detail — down its routing surface (the bed, a little of the ice's own; `route`), each grid cell fed by its area, in full
 * where snow outlasts the summer and 0.15 of it where the ice only flows. NaN off the ice.
 */
function lobeFeed(grid, lat, lon, ice, acc, route) {
    const { w, h, step, size } = grid, isIce = c => ice[c] === 1;
    const R = grid.average(lat, lon, route, isIce), snow = grid.average(lat, lon, Float32Array.from(acc), isIce);
    const kmStep = 6371 * Math.PI / 180 * step, order = [], flux = new Float64Array(size), out = new Float32Array(size).fill(NaN);
    for (let g = 0; g < size; g++) {
        if (!(R[g] === R[g])) continue;
        const cos = Math.max(0.02, Math.cos((90 - (Math.floor(g / w) + 0.5) * step) * Math.PI / 180));
        flux[g] = kmStep * kmStep * cos * (snow[g] + 0.15 * (1 - snow[g]));
        order.push(g);
    }
    order.sort((a, b) => R[b] - R[a]);
    for (const g of order) {
        const j = Math.floor(g / w), i = g - j * w, cos = Math.max(0.02, Math.cos((90 - (j + 0.5) * step) * Math.PI / 180));
        out[g] = flux[g] / (kmStep * Math.sqrt(cos));
        let best = -1, low = R[g];
        for (let dj = -1; dj <= 1; dj++) {
            const jj = j + dj;
            if (jj < 0 || jj >= h) continue;
            for (let di = -1; di <= 1; di++) {
                if (!dj && !di) continue;
                const q = jj * w + (i + di + w) % w;
                if (R[q] < low) { low = R[q]; best = q; }
            }
        }
        if (best >= 0) flux[best] += flux[g];
    }
    return out;
}
