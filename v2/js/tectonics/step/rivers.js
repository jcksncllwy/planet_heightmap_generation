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
import { arcCrustKm } from './collision.js';
import { arcSurfaceKm, columnModel, ARC_ROOT_SHARE, seaFilledUp, LAND_SEDIMENT_LOAD_FACTOR } from '../measure.js';
import { landAndSea } from '../../terrain/sea-level.js';
import { rainAtLatitude, erosionAtLatitude } from '../../terrain/terrain-config.js';

const R = 6371;

/** Drain the land and let the rivers cut, every riverEveryMyr. @returns {number} 0 (it never changes crust) */
export function evolveRivers(world, dt) {
    const H = heightsOf(world.config), C = columnModel(H);
    world.riverClock = (world.riverClock ?? 0) + dt;
    if (world.riverClock < H.riverEveryMyr - 1e-9) return 0;
    const span = world.riverClock;
    world.riverClock = 0;
    const { mesh, plates, owner, ownerCell, time } = world, { adjOffset, adjList, xyz, numCells: n } = mesh;
    const { dist } = meshInfo(mesh), cellArea = 4 * Math.PI * R * R / n;
    const s = scratchFor(n);
    const { land, base, lift, height, fill, rank, order, recv, recvKm, area, cutNow, hold, sed, sedCont, basin, seaOf, view, hol, holKm, holCells } = s;
    world.riverKm2 ??= new Float32Array(n);
    // ── the land and the sea as the terrain stands them (branch unified-swell): continental crust and island arcs, seas
    // filled up — and a filled sea the mantle's swell holds up above the sea — on the world's own view of the crust and its
    // mantle (terrain/sea-level.js landAndSea; records.js deriveRecords reads a frame the same way: the mantle's heat as a
    // frame keeps it, 0–255) ──
    view.time = time; view.owner = owner;
    for (let w = 0; w < n; w++) {
        const o = owner[w];
        view.mantleHeat[w] = Math.round(255 * world.mantleHeat[w]);
        land[w] = 0;
        if (o < 0) { view.type[w] = CrustType.OCEAN; view.formedAt[w] = -1; view.seaFillKm[w] = 0; continue; }
        const crust = plates[o].crust, c = ownerCell[w], type = crust.type[c];
        view.type[w] = type; view.formedAt[w] = crust.formedAt[c]; view.seaFillKm[w] = crust.seaFillKm[c];
        if (type !== CrustType.OCEAN || (crust.seaFillKm[c] > 0 && seaFilledUp(time - crust.formedAt[c], crust.seaFillKm[c]))) land[w] = 1;
    }
    const sl = landAndSea(view, mesh, H, land, s.swellKm), swellKm = sl.swellKm, seaKm = sl.seaKm;
    const landRef = H.mantleSwellKm * H.mantleSwellLandRef, seaRef = H.mantleSwellKm * H.mantleSwellSeaRef;
    // ── the land's height against the sea: its evolved height (as records.js draws the platform: the column of its crust,
    // the uplift; the mantle's swell under it, against its side's reference; the sea's level) less what rivers have cut;
    // `base` is what it stands on without the relief belts gave it ──
    for (let w = 0; w < n; w++) {
        if (!land[w]) continue;
        const crust = plates[owner[w]].crust, c = ownerCell[w], type = crust.type[c];
        // a sea filled (or lifted dry): the plain its rivers grade, from the sea's level or the datum shoreline the terrain
        // draws above it (records.js) — sediment laid down there, not rock worn: no relief to cut, no rock of its own
        if (type === CrustType.OCEAN) { base[w] = Math.max(0, seaKm) - seaKm; lift[w] = 0; cutNow[w] = 0; hold[w] = 0; height[w] = base[w]; continue; }
        // (the column as formed — a continent's and a craton's by their crust, tectonics/measure.js; an arc's its own
        // crest — is the base; the relief is the rest, above it: the crust thickened, the belts' uplift, the swells, the
        // basalt. A crust eroded thinner than formed stands lower than its base: no relief there)
        let b, full;
        if (type === CrustType.ARC) {
            b = (crust.flags[c] & CrustFlag.MARGIN_ISLE) ? H.foreArcIsleKm
                : arcSurfaceKm(arcCrustKm(crust, c, time, world.config), crust.arcKm[c] > 0 ? time - crust.arcAt[c] : 0);     // (as the terrain stands it: records.js)
            full = b + C.slope[1] * ARC_ROOT_SHARE * Math.max(0, crust.rootKm[c]);
        } else { b = C.ref[type]; full = b + C.slope[type] * crust.rootKm[c]; }
        full += crust.upliftKm[c] + crust.baseKm[c] + (crust.volcType[c] === VolcanicType.LIP ? Math.max(0, H.lipLandKm * Math.min(H.lipMaxKm, crust.volcKm[c]) - crust.volcWornKm[c]) : 0);
        b = Math.min(b, full);
        const l = Math.max(0, full - b);
        // (the swell is the mantle's, broad: it tilts the land and its rivers with it, not the relief they cut into)
        b += swellKm[w] - (type === CrustType.ARC ? seaRef : landRef) - seaKm;
        base[w] = b; lift[w] = l; cutNow[w] = Math.min(crust.riverIncKm[c], l + H.riverPlainKm);
        // (a belt still rising keeps pace with its rivers: they cut less there — shaping it, not trenching it)
        hold[w] = 1 - H.riverActiveHold * (crust.oroType[c] ? Math.exp(-Math.max(0, time - crust.oroLast[c]) / H.carveActiveMyr) : 0);
        // (and the sediment its rivers have laid in it, if it lies in a hollow: below)
        height[w] = b + l - cutNow[w] + crust.basinFillKm[c] / LAND_SEDIMENT_LOAD_FACTOR;
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
    // ── the land's hollows: land below its spill (the flood's level over it), each a sub-basin of cells at one spill level
    // joined side to side, its outlet the cell the flood reached first — so all of a hollow is drained before its outlet ──
    const traps = H.basinRunoffShare > 0;
    if (traps) hollows(s, count, plates, owner, ownerCell, adjOffset, adjList, dist);
    const { holStart, holSed, holCont, holRain } = s;
    // ── drainage (km², rain-weighted), leaves to the sea ──
    area.fill(0); sed.fill(0); sedCont.fill(0); basin.fill(0);
    const denude = world.config.trenchDenudationKmPerMyr ?? 0, mouths = [];
    const { rain, erode } = latitudeRates(mesh, H);
    for (let i = count - 1; i >= 0; i--) {
        const c = order[i];
        area[c] += cellArea * rain[c] / H.rainRefMm;
        // (the basin's rock, km³/Myr: every cell of it wearing down at its latitude's rate; the continent's share kept
        // apart — an arc's or an island's rock was never continental crust)
        const crust = plates[owner[c]].crust, t = crust.type[ownerCell[c]], rock = denude > 0 && t !== CrustType.OCEAN ? cellArea * denude * erode[c] : 0;
        sed[c] += rock; basin[c] += cellArea;
        if (t === CrustType.CONTINENT || t === CrustType.CRATON) sedCont[c] += rock;
        // (a hollow is one lake, its outlet the cell it spills from: the load its rivers bring out of it any other way —
        // where its flat floor's receivers happen to leave it — is the lake's, and leaves by the outlet; there it keeps
        // what it traps, up to its room)
        const h = traps ? hol[c] : -1;
        let pass = true;
        if (h >= 0 && (recv[c] < 0 || hol[recv[c]] !== h)) {
            const s0 = holStart[h];
            if (holCells[s0] !== c) { holSed[h] += sed[c]; holCont[h] += sedCont[c]; holRain[h] += area[c]; pass = false; }
            else {
                sed[c] += holSed[h]; sedCont[c] += holCont[h];
                const load = sed[c] * span, kept = load > 0 ? trapLoad(world, s, h, load, area[c] + holRain[h], H, cellArea) : 0;
                if (kept > 0) { const f = 1 - kept / load; sed[c] *= f; sedCont[c] *= f; world.budget.basinFillKm3 = (world.budget.basinFillKm3 ?? 0) + kept; }
            }
        }
        if (recv[c] >= 0) { area[recv[c]] += area[c]; basin[recv[c]] += basin[c]; if (pass) { sed[recv[c]] += sed[c]; sedCont[recv[c]] += sedCont[c]; } }
        else if (pass && sed[c] > 0) mouths.push({ plate: owner[c], cell: ownerCell[c], km3: sed[c], contKm3: sedCont[c], basinKm2: basin[c], sea: seaOf[c] });
    }
    world.riverMouths = mouths;
    fillEnclosedSeas(world, mouths, span, land, sl);   // (a mouth on an enclosed sea fills it, to the sea's level; the rest go down their fans)
    for (let w = 0; w < n; w++) world.riverKm2[w] = land[w] ? area[w] : 0;
    // ── the cut: E = k A^m S over the span, downstream first; never below the reach below, and only toward the river's
    // share of the relief; and never below the water it runs into — a lake is its base level: a river reaching one lays
    // its load there, it does not trench its floor (with hollows trapping, terrain-config basinRunoffShare) ──
    for (let i = 0; i < count; i++) {
        const c = order[i], r = recv[c], below = r >= 0 ? (traps ? Math.max(height[r], fill[r]) : height[r]) : 0;
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

// ── Hollows trap their rivers' load (lane basins, 2026-10-29; Jackson: "go straight to the best, physically correct
// model") ── On Earth a continental hollow fills with what its rivers bring as it subsides: the Congo basin's ~9 km
// (Kadima et al. 2011), the Tarim's and the Precaspian's, Lake Eyre's and Chad's sediment plains; one stays a lake only
// while it sinks or is dammed faster than it is filled (Baikal, Tanganyika: rifts; the Caspian: a sea floor cut off).
// Until now the history routed its rivers across every hollow at its spill level and all their load left at the mouth.
// Now a hollow keeps its load: a closed one all of it — its lake, brimful, would lose more to the air than flows in (lakeEvaporationMm); a through-flowing one as a reservoir
// does, by Brune's (1953) curve on how long its water stays — the volume below its spill over the river's discharge,
// τ years, trapping 1 − 0.05/√τ (Brune's median curve as Vörösmarty et al. 2003, Global Planet. Change 39: 169, fit
// it): a great hollow (τ ≫ 1 year) all, a shallow pond on a great river little. What it keeps is laid from the bottom
// up, burying the rivers' cuts first, toward its spill level and the plain its rivers grade up from its outlet (plainGrade:
// a filled hollow is an alluvial plain sloping to its outlet, not a dead-level floor), each cell's share a crust record
// (crust.basinFillKm) that moves with its plate, loads it (Airy: LAND_SEDIMENT_LOAD_FACTOR, ~4 km of sediment for 1 km of
// hollow) and wears as its land does (step/heights.js). Its rock is the continents' own, moved: no crust is made, so the
// crust ledger does not change, and what it keeps no longer reaches the sea, the trenches' fans or an enclosed sea.

/** Label each hollow (s.hol: its index, −1 for none) — the cells below one spill level, joined side to side — its cells
 *  together from its outlet (the first the flood reached, s.holCells[s.holStart[h]]) out, and each cell's distance from
 *  that outlet across the hollow (s.holKm). */
function hollows(s, count, plates, owner, ownerCell, adjOffset, adjList, dist) {
    const { order, fill, height, hol, holKm, land, holCells } = s;
    // (below its spill and above the sea's: land open to the sea below 0 is a drowned shelf, the sea's; and crust that
    // can take a fill — a filled sea's plain is drawn graded from its own shore: records.js)
    const deep = c => land[c] && fill[c] > 1e-6 && fill[c] - height[c] >= 1e-4 && plates[owner[c]].crust.type[ownerCell[c]] !== CrustType.OCEAN;
    for (let i = 0; i < count; i++) hol[order[i]] = -1;
    let k = 0, at = 0;
    for (let i = 0; i < count; i++) {
        const o = order[i];
        if (hol[o] !== -1 || !deep(o)) continue;
        if (k + 2 > s.holStart.length) grow(s, 2 * s.holStart.length);
        s.holStart[k] = at; hol[o] = k; holKm[o] = 0; holCells[at++] = o;
        for (let q = s.holStart[k]; q < at; q++) {
            const c = holCells[q];
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
                const nb = adjList[j];
                if (hol[nb] === -1 && fill[nb] === fill[c] && deep(nb)) { hol[nb] = k; holKm[nb] = holKm[c] + dist[j]; holCells[at++] = nb; }
            }
        }
        k++;
    }
    s.holCount = k; s.holStart[k] = at;
    s.holSed.fill(0, 0, k); s.holCont.fill(0, 0, k); s.holRain.fill(0, 0, k);
}
function grow(s, m) {
    for (const key of ['holStart', 'holSed', 'holCont', 'holRain']) { const a = new s[key].constructor(m); a.set(s[key]); s[key] = a; }
}

/**
 * Hollow `h`, whose outlet passes `km3` of load this drainage from rivers draining `rainKm2` (rain-weighted, at
 * rainRefMm): keep what it traps (Brune; all if it is closed), laid from the bottom up toward its spill and the grade up
 * from its outlet; raise its cells' heights and records. @returns {number} km³ kept
 */
function trapLoad(world, s, h, km3, rainKm2, H, cellArea) {
    const { fill, height, cutNow, holKm, holCells, holStart } = s, { plates, owner, ownerCell } = world;
    const F = LAND_SEDIMENT_LOAD_FACTOR, g = H.plainGrade, a = holStart[h], b = holStart[h + 1], spill = fill[holCells[a]];
    // its water's volume below the spill, and the river's discharge: rain over the catchment (area is rain-weighted km²,
    // at rainRefMm) times the share that runs off — km³ a year
    let water = 0, lo = Infinity;
    for (let i = a; i < b; i++) { const c = holCells[i]; water += (spill - height[c]) * cellArea; lo = Math.min(lo, height[c] - g * holKm[c]); }
    // (closed — its lake at the brim would lose more to the air than flows in — it keeps it all: Brune's τ is endless)
    const q = rainKm2 * H.rainRefMm * 1e-6 * H.basinRunoffShare, dry = q <= (b - a) * cellArea * H.lakeEvaporationMm * 1e-6;
    const tau = dry ? Infinity : water / q;
    const trap = trapEfficiency(tau);
    // (the sediment raising a cell r km: its cut first, as deep as the cut — a valley filled — then fill that loads the crust)
    const vol = (c, r) => (r <= 0 ? 0 : (Math.min(r, cutNow[c]) + F * Math.max(0, r - cutNow[c])) * cellArea);
    const laid = L => { let v = 0; for (let i = a; i < b; i++) { const c = holCells[i]; v += vol(c, L + g * holKm[c] - height[c]); } return v; };
    const room = laid(spill), want = Math.min(room, trap * km3);
    if (!(want > 0)) return 0;
    // the level L (≤ the spill) the load fills it to, the grade up from the outlet above it
    let L = spill;
    if (want < room) {
        let l0 = lo, l1 = spill;
        for (let it = 0; it < 40; it++) { const m = 0.5 * (l0 + l1); if (laid(m) < want) l0 = m; else l1 = m; }
        L = l1;
    }
    let kept = 0;
    for (let i = a; i < b; i++) {
        const c = holCells[i], r = L + g * holKm[c] - height[c];
        if (r <= 0) continue;
        const crust = plates[owner[c]].crust, cc = ownerCell[c], u = Math.min(r, cutNow[c]);
        crust.riverIncKm[cc] = Math.max(0, crust.riverIncKm[cc] - u); cutNow[c] -= u;
        crust.basinFillKm[cc] += F * (r - u);
        kept += vol(c, r);
        height[c] += r;
    }
    return kept;
}

/** The share of its inflow's load a hollow keeps whose water stays `tau` years (its volume below the spill over its
 *  inflow; Infinity for a closed one): Brune's (1953) median curve as Vörösmarty et al. 2003 fit it. */
export function trapEfficiency(tau) { return tau === Infinity ? 1 : Math.max(0, 1 - 0.05 / Math.sqrt(Math.max(1e-12, tau))); }

/** The last drainage's working fields (per world cell: land, height against the sea less the cuts, the priority flood's
 *  spill level `fill`, the mantle's swell) — for tools that measure the land's hollows (tools/trace-basins.mjs). */
export function lastDrainage() { return scratch; }

let scratch = null;
function scratchFor(n) {
    if (scratch?.n === n) return scratch;
    scratch = { n, land: new Uint8Array(n), base: new Float32Array(n), lift: new Float32Array(n), cutNow: new Float32Array(n), hold: new Float32Array(n), height: new Float32Array(n), fill: new Float32Array(n), rank: new Int32Array(n),
        order: new Int32Array(n), recv: new Int32Array(n), recvKm: new Float32Array(n), area: new Float32Array(n), sed: new Float64Array(n), sedCont: new Float64Array(n), basin: new Float64Array(n), seaOf: new Int32Array(n), heap: new MinHeap(1 << 14),
        swellKm: new Float32Array(n), hol: new Int32Array(n), holKm: new Float32Array(n), holCells: new Int32Array(n), holStart: new Int32Array(1024), holSed: new Float64Array(1024), holCont: new Float64Array(1024), holRain: new Float64Array(1024), holCount: 0, view: { time: 0, owner: null, mantleHeat: new Uint8Array(n), type: new Uint8Array(n), formedAt: new Float32Array(n), seaFillKm: new Float32Array(n) } };
    return scratch;
}
