// The rivers of the history (Phase 8b-2; developer: "the important part is to indicate a history of rivers in the
// terrain"). Every riverEveryMyr the land is eroded and drained on the sim mesh. The erosion is the finish's own stream
// power and deposition, on the GPU (step/surface-erosion.js, lane graded): it lowers the crust's records — a river that keeps
// pace with rising ground holds its course through it (an antecedent river: the Indus and the Brahmaputra through the
// Himalaya) — and lays its sediment in the hollows and slack reaches. Then a priority flood from the sea over the eroded
// land: each cell drains its steepest way down, drainage in km² weighted by the rain of the latitude at the time.
// The history reads each basin's sediment (crust-sink branch): the rock the erosion took off its land, and the sediment it
// took up or laid on the way, leave at the basin's mouth —
// world.riverMouths, each mouth a coast cell of its plate with its basin's sediment (km³/Myr; how much of it was
// continental crust) and area; step/trench-fans.js carries it out to sea, to the trenches it reaches — or, where the mouth
// is on an enclosed sea, step/sea-fill.js lays it on that sea's floor (crust.seaFillKm, a record too). world.riverKm2
// keeps the drainage last computed, per world cell.

import { CrustType } from '../model/crust.js';
import { MinHeap } from '../../core/min-heap.js';
import { heightsOf } from './heights.js';
import { fillEnclosedSeas, buildShelves } from './sea-fill.js';
import { arcCrustKm } from './collision.js';
import { LAND_SEDIMENT_LOAD_FACTOR } from '../measure.js';
import { erosionRequest, applyErosion, landHeightKm } from './surface-erosion.js';
import { landMask } from '../../terrain/land-mask.js';
import { rainAtLatitude } from '../../terrain/terrain-config.js';

const R = 6371;

/** Erode the land and drain it, every riverEveryMyr: a generator, it yields the erosion's GPU job ({kind: 'erode'}, simulate.js).
 *  @returns {number} 0 (it never changes crust) */
export function* evolveRivers(world, dt) {
    const H = heightsOf(world.config);
    world.riverClock = (world.riverClock ?? 0) + dt;
    if (world.riverClock < H.riverEveryMyr - 1e-9) return 0;
    const span = world.riverClock;
    world.riverClock = 0;
    const { mesh, plates, owner, ownerCell, time } = world, { adjOffset, adjList, xyz, numCells: n } = mesh;
    const { dist } = meshInfo(mesh), cellArea = 4 * Math.PI * R * R / n;
    const s = scratchFor(n);
    const { land, height, fill, rank, order, recv, recvKm, area, moved, sed, sedCont, basin, seaOf, hol, holKm, holCells } = s;
    world.riverKm2 ??= new Float32Array(n);
    // ── the land and the sea as the terrain stands them: the one mask (terrain/land-mask.js), on the world's own view of
    // the crust and its mantle as a frame carries them (tectonics/snapshot.js) — continental crust and island arcs whose
    // column stands above the sea, or below it with no way to it (a closed hollow); seas filled up, small enclosed ones,
    // and a filled sea the mantle's swell holds up above the sea. (Until 2026-11-06 the rivers took every continent and
    // arc as land however low — sea-level.js landAndSea — and ran 11–36 % of their water over what the terrain draws as
    // sea, on a sea level 11–22 m off its own: tools/datum-study.mjs) ──
    viewOf(world, s.view, H);
    const sl = landMask(s.view, mesh, H, s.mask).sl, swellKm = sl.swellKm, seaKm = sl.seaKm;
    // (the level and the swell kept for the history's seas between river steps — step/sea-age.js seaMaskNow — and the level
    // logged: one entry a river step)
    world.riverSea = { time, seaKm, seaRefKm: sl.seaRefKm, swellKm: Float32Array.from(swellKm) };
    (world.seaLog ??= []).push({ t: time, kind: 'level', seaKm });
    const landRef = H.mantleSwellKm * H.mantleSwellLandRef, seaRef = sl.seaRefKm;     // (an arc's swell against the young floor's mantle, as the sea floor's: sea-level.js liftRefKm)
    // ── the land's height against the sea (surface-erosion.js landHeightKm) ──
    const stand = () => { for (let w = 0; w < n; w++) if (land[w]) height[w] = landHeightKm(world, w, H, swellKm, seaKm, landRef, seaRef); };
    stand();
    // ── the land erodes, on the GPU (surface-erosion.js: the finish's stream power and deposition, over the span), and stands
    // again on its records: the crust thinned and rebounded, the sediment laid in its hollows ──
    const req = erosionRequest(world, land, height, span, H);
    yield { kind: 'erode', o: req.o, P: req.P };
    const done = applyErosion(world, req, land, s.moved, H);
    for (const key of ['eroded', 'laid', 'fillTaken', 'unplaced']) world.budget[`erode${key[0].toUpperCase()}${key.slice(1)}Km3`] = (world.budget[`erode${key[0].toUpperCase()}${key.slice(1)}Km3`] ?? 0) + done[key];
    stand();
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
    const mouths = [];
    let supplied = 0, suppliedCont = 0;
    const { rain } = latitudeRates(mesh, H);
    let clamped = 0;
    for (let i = count - 1; i >= 0; i--) {
        const c = order[i];
        area[c] += cellArea * rain[c] / H.rainRefMm;
        // (the basin's rock, km³/Myr: the bedrock the erosion took off it this step (crust.wornKm, surface-erosion.js), the
        // continent's share kept apart — an arc's or an island's rock was never continental crust; and the sediment it took up
        // (+: a hollow's fill re-eroded) or laid (−) on its way, `moved`, which rides with the load it came from)
        const crust = plates[owner[c]].crust, cc0 = ownerCell[c], t = crust.type[cc0];
        const rock = t !== CrustType.OCEAN ? cellArea * crust.wornKm[cc0] / span : 0, cont = t === CrustType.CONTINENT || t === CrustType.CRATON;
        crust.wornKm[cc0] = 0;
        sed[c] += rock; basin[c] += cellArea; supplied += rock;
        if (cont) { sedCont[c] += rock; suppliedCont += rock; }
        if (moved[c]) {
            const v = cellArea * moved[c] / span, f = sed[c] > 0 ? sedCont[c] / sed[c] : 0;
            sed[c] += v; sedCont[c] += v > 0 ? (cont ? v : 0) : v * f;
            if (sed[c] < 0) { clamped -= sed[c]; sed[c] = 0; sedCont[c] = 0; }
            if (sedCont[c] < 0) sedCont[c] = 0;
        }
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
        else if (pass && sed[c] > 0) mouths.push({ plate: owner[c], cell: ownerCell[c], world: c, km3: sed[c], contKm3: sedCont[c], basinKm2: basin[c], sea: seaOf[c] });
    }
    world.riverMouths = mouths;
    // (the hollows' sediment, net: what the erosion laid less what it took up — the rock book's basinFillKm3, beside trapLoad's)
    let net = 0;
    for (let i = 0; i < count; i++) net -= moved[order[i]];
    world.budget.basinFillKm3 = (world.budget.basinFillKm3 ?? 0) + net * cellArea;
    if (clamped > 0) world.budget.erodeClampedKm3 = (world.budget.erodeClampedKm3 ?? 0) + clamped * span;
    world.budget.riverSupplyKm3 = (world.budget.riverSupplyKm3 ?? 0) + supplied * span;
    world.budget.riverContSupplyKm3 = (world.budget.riverContSupplyKm3 ?? 0) + suppliedCont * span;
    fillEnclosedSeas(world, mouths, span, land, sl);   // (a mouth on an enclosed sea fills it, to the sea's level: budget.seaOverflowKm3 the rest)
    buildShelves(world, mouths, span, land);           // (…less what their own passive margin has room for)
    for (let w = 0; w < n; w++) world.riverKm2[w] = land[w] ? area[w] : 0;
    return 0;
}

// per mesh and climate: each world cell's rain (mm) — fixed, as the cells are (computed once, not every drainage)
const rates = new WeakMap();
function latitudeRates(mesh, H) {
    const key = JSON.stringify([H.rainByLatitude]);
    let byKey = rates.get(mesh);
    if (!byKey) rates.set(mesh, byKey = new Map());
    let r = byKey.get(key);
    if (r) return r;
    const n = mesh.numCells, rain = new Float64Array(n);
    for (let c = 0; c < n; c++) rain[c] = rainAtLatitude(Math.asin(Math.max(-1, Math.min(1, mesh.xyz[3 * c + 2]))) * 180 / Math.PI, H);
    r = { rain };
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
    // (below its spill and above the sea's: land open to the sea below 0 is a drowned shelf, the sea's. A filled sea's
    // plain closed in by the land risen around it is a hollow like any other)
    const deep = c => land[c] && fill[c] > 1e-6 && fill[c] - height[c] >= 1e-4;
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
    const { fill, height, holKm, holCells, holStart } = s, { plates, owner, ownerCell } = world;
    const F = LAND_SEDIMENT_LOAD_FACTOR, g = H.plainGrade, a = holStart[h], b = holStart[h + 1], spill = fill[holCells[a]];
    // its water's volume below the spill, and the river's discharge: rain over the catchment (area is rain-weighted km²,
    // at rainRefMm) times the share that runs off — km³ a year
    let water = 0, lo = Infinity;
    for (let i = a; i < b; i++) { const c = holCells[i]; water += (spill - height[c]) * cellArea; lo = Math.min(lo, height[c] - g * holKm[c]); }
    // (closed — its lake at the brim would lose more to the air than flows in — it keeps it all: Brune's τ is endless)
    const q = rainKm2 * H.rainRefMm * 1e-6 * H.basinRunoffShare, dry = q <= (b - a) * cellArea * H.lakeEvaporationMm * 1e-6;
    const tau = dry ? Infinity : water / q;
    const trap = trapEfficiency(tau);
    // (the sediment raising a cell r km: fill that loads the crust)
    const vol = (c, r) => (r <= 0 ? 0 : F * r * cellArea);
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
        kept += vol(c, r);
        plates[owner[c]].crust.basinFillKm[ownerCell[c]] += F * r;
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
/** The world's own view of the crust and its mantle, as a frame carries them (tectonics/snapshot.js), on `view`: what the
 *  one mask (terrain/land-mask.js) reads. @returns {Object} view */
function viewOf(world, view, H) {
    const { plates, owner, ownerCell, time } = world, n = world.mesh.numCells;
    view.time = time; view.owner = owner;
    const pouring = H.waterInventory > 0;          // (the water inventory's ground needs the flood basalt, the rivers' cut and their rise too: inventory.js surfaceKm)
    if (pouring && !view.volcType) Object.assign(view, { volcType: new Uint8Array(n), volcKm: new Float32Array(n), volcWornKm: new Float32Array(n), riseKm3: new Float32Array(n) });
    for (let w = 0; w < n; w++) {
        const o = owner[w];
        view.mantleHeat[w] = Math.round(255 * world.mantleHeat[w]);
        if (o < 0) { view.type[w] = CrustType.OCEAN; view.formedAt[w] = -1; view.seaFillKm[w] = 0; continue; }       // (no plate: never land)
        const crust = plates[o].crust, c = ownerCell[w], type = crust.type[c];
        view.type[w] = type; view.formedAt[w] = crust.formedAt[c]; view.seaFillKm[w] = crust.seaFillKm[c];
        view.flags[w] = crust.flags[c]; view.rootKm[w] = crust.rootKm[c]; view.baseKm[w] = crust.baseKm[c]; view.upliftKm[w] = crust.upliftKm[c]; view.basinFillKm[w] = crust.basinFillKm[c];
        if (type === CrustType.ARC) { view.arcKm[w] = arcCrustKm(crust, c, time, world.config); view.arcAt[w] = crust.arcKm[c] > 0 ? crust.arcAt[c] : time; }
        if (pouring) { view.volcType[w] = crust.volcType[c]; view.volcKm[w] = crust.volcKm[c]; view.volcWornKm[w] = crust.volcWornKm[c]; view.riseKm3[w] = crust.riseKm3[c]; }
    }
    return view;
}

/**
 * The land and the sea now, between river steps: the one mask on the crust as it stands, against the sea's level and the
 * swell the last river step found (world.riverSea) — neither reckoned nor poured again (the level moves with the mantle and
 * the water's room, slowly; the coast with the plates, every step). @returns {Uint8Array|null} land 1 / sea 0, on a
 * scratch of its own (the rivers' mask stays theirs: lastDrainage), overwritten by the next call; null before the
 * history's first river step
 */
export function seaMaskNow(world) {
    if (!world.riverSea) return null;
    const H = heightsOf(world.config), n = world.mesh.numCells, s = scratchFor(n);
    s.nowMask ??= { land: new Uint8Array(n), seaColKm: new Float32Array(n), dryHollow: new Uint8Array(n) };
    return landMask(viewOf(world, s.view, H), world.mesh, H, s.nowMask, null, world.riverSea).land;
}

function scratchFor(n) {
    if (scratch?.n === n) return scratch;
    scratch = { n, land: new Uint8Array(n), moved: new Float32Array(n), height: new Float32Array(n), fill: new Float32Array(n), rank: new Int32Array(n),
        order: new Int32Array(n), recv: new Int32Array(n), recvKm: new Float32Array(n), area: new Float32Array(n), sed: new Float64Array(n), sedCont: new Float64Array(n), basin: new Float64Array(n), seaOf: new Int32Array(n), heap: new MinHeap(1 << 14),
        swellKm: new Float32Array(n), seaColKm: new Float32Array(n), dryHollow: new Uint8Array(n), hol: new Int32Array(n), holKm: new Float32Array(n), holCells: new Int32Array(n), holStart: new Int32Array(1024), holSed: new Float64Array(1024), holCont: new Float64Array(1024), holRain: new Float64Array(1024), holCount: 0, view: { time: 0, owner: null, mantleHeat: new Uint8Array(n), type: new Uint8Array(n), formedAt: new Float32Array(n), seaFillKm: new Float32Array(n), flags: new Uint8Array(n), rootKm: new Float32Array(n), baseKm: new Float32Array(n), upliftKm: new Float32Array(n), basinFillKm: new Float32Array(n), arcKm: new Float32Array(n), arcAt: new Float32Array(n) } };
    scratch.mask = { land: scratch.land, swellKm: scratch.swellKm, seaColKm: scratch.seaColKm, dryHollow: scratch.dryHollow };
    return scratch;
}
