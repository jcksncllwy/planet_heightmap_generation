// The rivers of the history (Phase 8b-2; developer: "the important part is to indicate a history of rivers in the
// terrain" — "'grand canyon' type rivers that cut deep into the rock"). Every riverEveryMyr the land is drained on the
// sim mesh: a priority flood from the sea over the land's evolved height LESS what rivers have already cut there, each
// cell draining its steepest way down, drainage in km² weighted by the rain of the latitude at the time. Each river
// then cuts down by the stream power law, E = k A^m S, never below the reach it drains into, toward a depth that is a
// share of the land's relief growing smoothly with the river, A / (A + riverHalfKm2) — a stream notches its valley,
// a great river cuts most of the way through the range it crosses (the relief is what belts raised above the land's
// base — belts, the start world's swells, flood basalts; the rest of the wearing-down is the evolving heights' own), less where the belt is still rising (it keeps pace
// with its rivers: they shape it rather than trench it) — plus, even on flat land, a valley of its own up to
// riverPlainKm deep (a great river's floodplain below its bluffs): so rivers keep their ways on the plains too.
// The cut is a record of the crust (crust.riverIncKm), carried with its plate and worn away like the rest of its relief
// (step/heights.js). Because the rivers are routed over the land less its cuts, a cut course stays the lowest way and
// its river keeps it: when land rises under a river that keeps up — its slope steepens, so it cuts faster — the record
// deepens into a gorge through the rising ground (an antecedent river: the Indus and the Brahmaputra through the
// Himalaya, the Colorado through its plateau); a river too small to keep up is turned aside. The terrain draws the
// record (terrain/carve.js: rivers follow the old courses, their beds at least as deep as the history cut them).
// Records, but for one thing the history reads (crust-sink branch): each basin's sediment. Its land wears down at
// config.trenchDenudationKmPerMyr × its latitude's erosion (rain, or ice), and the rock leaves at the basin's mouth —
// world.riverMouths, each mouth a coast cell of its plate with its basin's sediment (km³/Myr; how much of it was
// continental crust) and area; step/trench-fans.js carries it out to sea, to the trenches it reaches — or, where the mouth
// is on an enclosed sea, step/sea-fill.js lays it on that sea's floor (crust.seaFillKm, a record too). world.riverKm2
// keeps the drainage last computed, per world cell.

import { CrustType, CrustFlag, VolcanicType } from '../model/crust.js';
import { MinHeap } from '../../core/min-heap.js';
import { heightsOf } from './heights.js';
import { fillEnclosedSeas } from './sea-fill.js';
import { rainAtLatitude, erosionAtLatitude } from '../../terrain/terrain-config.js';

const R = 6371;

/** Drain the land and let the rivers cut, every riverEveryMyr. @returns {number} 0 (it never changes crust) */
export function evolveRivers(world, dt) {
    const H = heightsOf(world.config);
    world.riverClock = (world.riverClock ?? 0) + dt;
    if (world.riverClock < H.riverEveryMyr - 1e-9) return 0;
    const span = world.riverClock;
    world.riverClock = 0;
    const { mesh, plates, owner, ownerCell, time } = world, { adjOffset, adjList, xyz, numCells: n } = mesh;
    const { dist } = meshInfo(mesh), cellArea = 4 * Math.PI * R * R / n;
    const s = scratchFor(n);
    const { land, base, lift, height, fill, rank, order, recv, recvKm, area, cutNow, hold, sed, sedCont, basin, seaOf } = s;
    world.riverKm2 ??= new Float32Array(n);
    // ── the land: its evolved height (as records.js draws the platform: crust kind, the root's isostatic lift, the
    // uplift) less what rivers have cut; `base` is what it stands on without the relief belts gave it ──
    for (let w = 0; w < n; w++) {
        const o = owner[w];
        land[w] = 0;
        if (o < 0) continue;
        const crust = plates[o].crust, c = ownerCell[w], type = crust.type[c];
        if (type === CrustType.OCEAN) continue;
        land[w] = 1;
        let b;
        if (type === CrustType.CRATON) b = H.cratonKm;
        else if (type === CrustType.ARC) b = (crust.flags[c] & CrustFlag.MARGIN_ISLE) ? H.foreArcIsleKm
            : H.arcYoungKm + (H.arcMatureKm - H.arcYoungKm) * Math.min(1, Math.max(0, (time - crust.formedAt[c]) / H.arcMatureMyr)) ** 0.7;
        else b = H.continentKm;
        const l = Math.max(0, H.isoMaxKm * (1 - Math.exp(-crust.rootKm[c] * (type === CrustType.ARC ? 0.25 : 1) / H.isoScaleKm)) + crust.upliftKm[c] + crust.baseKm[c]
            + (crust.volcType[c] === VolcanicType.LIP ? Math.max(0, H.lipLandKm * Math.min(H.lipMaxKm, crust.volcKm[c]) - crust.volcWornKm[c]) : 0));
        base[w] = b; lift[w] = l; cutNow[w] = Math.min(crust.riverIncKm[c], l + H.riverPlainKm);
        // (a belt still rising keeps pace with its rivers: they cut less there — shaping it, not trenching it)
        hold[w] = 1 - H.riverActiveHold * (crust.oroType[c] ? Math.exp(-Math.max(0, time - crust.oroLast[c]) / H.carveActiveMyr) : 0);
        height[w] = b + l - cutNow[w];
    }
    // ── the priority flood from the sea, lowest spill first; each cell's receiver its steepest way down ──
    const heap = s.heap;
    heap.size = 0;
    rank.fill(-1);
    let count = 0;
    for (let w = 0; w < n; w++) {
        if (land[w]) continue;
        rank[w] = -2;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) { const nb = adjList[k]; if (land[nb]) heap.push(Math.max(0, height[nb]), nb); }
    }
    for (let w = 0; w < n; w++) fill[w] = Infinity;
    while (heap.size) {
        const c = heap.pop(), level = heap.lastKey;
        if (rank[c] !== -1) continue;
        rank[c] = count; order[count++] = c; fill[c] = level;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (rank[nb] === -1 && land[nb]) heap.push(Math.max(level, height[nb]), nb);
        }
    }
    for (let i = 0; i < count; i++) {
        const c = order[i];
        let pick = -1, km = 0, steepest = -1;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (!(rank[nb] === -2 || (rank[nb] >= 0 && rank[nb] < i))) continue;
            const s2 = ((rank[nb] === -2 ? fill[c] : fill[c] - fill[nb]) + 1e-9) / dist[k];
            if (s2 > steepest) { steepest = s2; pick = nb; km = dist[k]; }
        }
        recv[c] = rank[pick] === -2 ? -1 : pick;
        seaOf[c] = pick;
        recvKm[c] = km;
    }
    // ── drainage (km², rain-weighted), leaves to the sea ──
    area.fill(0); sed.fill(0); sedCont.fill(0); basin.fill(0);
    const denude = world.config.trenchDenudationKmPerMyr ?? 0, mouths = [];
    // (the rock follows the climate the heights wear down by — unless a check comparing erosion laws on the heights alone
    // pins the climate the rivers' rock follows, world.config.sedimentHeights, to keep the tectonics the same)
    const { rain } = latitudeRates(mesh, H), { erode } = latitudeRates(mesh, world.config.sedimentHeights ?? H);
    for (let i = count - 1; i >= 0; i--) {
        const c = order[i];
        area[c] += cellArea * rain[c] / H.rainRefMm;
        // (the basin's rock, km³/Myr: every cell of it wearing down at its latitude's rate; the continent's share kept
        // apart — an arc's or an island's rock was never continental crust)
        const rock = denude > 0 ? cellArea * denude * erode[c] : 0, crust = plates[owner[c]].crust, t = crust.type[ownerCell[c]];
        sed[c] += rock; basin[c] += cellArea;
        if (t === CrustType.CONTINENT || t === CrustType.CRATON) sedCont[c] += rock;
        if (recv[c] >= 0) { area[recv[c]] += area[c]; sed[recv[c]] += sed[c]; sedCont[recv[c]] += sedCont[c]; basin[recv[c]] += basin[c]; }
        else if (sed[c] > 0) mouths.push({ plate: owner[c], cell: ownerCell[c], km3: sed[c], contKm3: sedCont[c], basinKm2: basin[c], sea: seaOf[c] });
    }
    world.riverMouths = mouths;
    fillEnclosedSeas(world, mouths, span, land);       // (a mouth on an enclosed sea fills it; the rest go down their fans)
    for (let w = 0; w < n; w++) world.riverKm2[w] = land[w] ? area[w] : 0;
    // ── the cut: E = k A^m S over the span, downstream first; never below the reach below, and only toward the river's
    // share of the relief ──
    for (let i = 0; i < count; i++) {
        const c = order[i], r = recv[c], below = r >= 0 ? height[r] : 0;
        const drop = height[c] - below, want = hold[c] * (lift[c] + H.riverPlainKm) * area[c] / (area[c] + H.riverHalfKm2) - cutNow[c];
        if (drop <= 0 || want <= 0) continue;
        const cut = Math.min(drop, want, H.riverCutK * area[c] ** H.carveM * (drop / Math.max(1, recvKm[c])) * span);
        if (cut <= 0) continue;
        height[c] -= cut;                                     // (the cells above now drain to the cut reach)
        const crust = plates[owner[c]].crust, cc = ownerCell[c];
        crust.riverIncKm[cc] += cut;
    }
    return 0;
}

// per mesh and climate: each world cell's rain (mm) and how fast its latitude erodes — fixed, as the cells are
// (computed once, not every drainage: the same numbers)
const rates = new WeakMap();
function latitudeRates(mesh, H) {
    const key = JSON.stringify([H.rainByLatitude, H.rainRefMm, H.rainErosionExponent, H.wetErosionShare, H.glacialErosion]);
    let byKey = rates.get(mesh);
    if (!byKey) rates.set(mesh, byKey = new Map());
    let r = byKey.get(key);
    if (r) return r;
    const n = mesh.numCells, rain = new Float64Array(n), erode = new Float64Array(n);
    for (let c = 0; c < n; c++) {
        const lat = Math.asin(Math.max(-1, Math.min(1, mesh.xyz[3 * c + 2]))) * 180 / Math.PI;
        rain[c] = rainAtLatitude(lat, H); erode[c] = erosionAtLatitude(lat, H);
    }
    r = { rain, erode };
    byKey.set(key, r);
    return r;
}

// per mesh: the distance (km) along each adjacency entry
const infos = new WeakMap();
function meshInfo(mesh) {
    let I = infos.get(mesh);
    if (I) return I;
    const { xyz, adjOffset, adjList, numCells } = mesh, dist = new Float32Array(adjList.length);
    for (let c = 0; c < numCells; c++) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
        const nb = adjList[k];
        dist[k] = 2 * R * Math.asin(Math.min(1, 0.5 * Math.hypot(xyz[3 * nb] - xyz[3 * c], xyz[3 * nb + 1] - xyz[3 * c + 1], xyz[3 * nb + 2] - xyz[3 * c + 2])));
    }
    I = { dist };
    infos.set(mesh, I);
    return I;
}

let scratch = null;
function scratchFor(n) {
    if (scratch?.n === n) return scratch;
    scratch = { n, land: new Uint8Array(n), base: new Float32Array(n), lift: new Float32Array(n), cutNow: new Float32Array(n), hold: new Float32Array(n), height: new Float32Array(n), fill: new Float32Array(n), rank: new Int32Array(n),
        order: new Int32Array(n), recv: new Int32Array(n), recvKm: new Float32Array(n), area: new Float32Array(n), sed: new Float64Array(n), sedCont: new Float64Array(n), basin: new Float64Array(n), seaOf: new Int32Array(n), heap: new MinHeap(1 << 14) };
    return scratch;
}
