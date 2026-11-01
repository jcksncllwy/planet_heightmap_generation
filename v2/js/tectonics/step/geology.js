// The geological record of the history. Ported from World Orogen (raguilar011095, GPL v3; its plans/V2_GEOLOGY_PLAN.md, G1).
// Madeline James's rock and ore maps begin from maps drawn by hand — the orogenies, active, worn and long gone, and the
// past seas — and from them the rock types. Evolution keeps the record as it happens instead, per piece of crust, riding
// with it on its plate:
//   · a ROCK COLUMN — sediment cover over the volcanics over the basement. Cover is what this fork's own books laid there
//     (lane litho, Jackson's ruling): the sediment the history's rivers left in the land's hollows (crust.basinFillKm,
//     step/rivers.js) and on enclosed sea floors (crust.seaFillKm, step/sea-fill.js), its make-up by the latitude it lay at
//     then; erosion (step/heights.js, every step, recordWear) strips the cover first, then the basement — how deep the
//     basement is worn is how deep the rock now at the surface once lay (its metamorphic grade);
//   · time in a live subduction belt (arcs and Andean margins), and the settings the other records do not keep (GeoFlag:
//     born in an arc, a foreland basin, before a live belt, a young rift basin, a closed sea's floor, a slab that changed).
// Records only: the history never reads them (no random stream either), so a history is the same with them or without
// (config.geology.records; check-geology.mjs runs both and compares).
//
// What this skips (limits of a reduced model, tier 2 unless marked):
//   · No shelf deposition. A river reaching the open ocean sends its load down its fan to a trench or loses it; no cell
//     receives it, so passive margins carry no wedge and shelves stay bare until the history has a deposition process.
//     Upstream's rates by setting (shelf, inland sea, rift, foreland) and its sea stand and flooding are not ported: they
//     prescribe cover without mass. So no epeiric cover either, and forelands hold only what their hollows trapped.
//   · The start world's past (seedGeology) is a painted initial state (tier 3): a world with no prior history has nothing
//     else to start from. It is booked apart (world.geoBook.seededKm3), never against the rivers' mass. Exit: a pre-history
//     spin-up, if one ever exists.
//   · Facies by latitude alone: a zonal palaeoclimate (tier 3), not the climate model. Exit: L4's climate halves.
//   · Carbonate is only the rivers' dissolved load, laid in warm enclosed seas. There is no carbonate production on
//     platforms, so limestone is under-counted against Earth.
//   · riftAt and OPHIOLITE are read off the crust's flags at the clock's tick, not stamped by the event (ops/rift.js and
//     ops/merge-plates.js stay as they are): each is late by up to everyMyr, and a second rift over an already flagged cell
//     keeps the first date.
//   · A foreland by two causes, kept apart. FORELAND: land the heights sank under a load (reduced physics; the rock reads
//     it). BELT_FRONT: land within forelandFlagKm of a live belt's outer edge, by distance alone (tier 3: nothing says it
//     sank, a third of it holds no fill; no rock reads it). Each is kept for good, so BELT_FRONT sums every front that ever
//     swept the land: its share of the land at one moment is ~2 %, by 400 Myr 42-44 %. Within ~1 cell of the sim mesh, its
//     width is the mesh's as much as forelandFlagKm's (more of it at 40K than at 20K). Exit: the flexure as the history's own.
//   · A sealed cell copies its neighbour's record (merge-plates.js copyFrom), cover and wear included.
//   · The record wears uniformly: rock type does not change the wear yet (lane L6).

import { CrustType, CrustFlag, OrogenyType, VolcanicType } from '../model/crust.js';
import { GeoFlag } from '../model/geology.js';
import { EventKind } from '../model/world.js';
import { spreadKm } from '../../core/min-heap.js';
import { FastNoise } from '../../core/fast-noise.js';
import { heightsOf } from './heights.js';

const R = 6371, DEG = 180 / Math.PI;
const FORELAND_BELTS = new Set([OrogenyType.ANDEAN, OrogenyType.LARAMIDE, OrogenyType.URAL, OrogenyType.HIMALAYAN]);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── the zonal palaeoclimate: what a basin or a sea at this latitude (degrees, absolute) lays down ──
const warmShare = (lat, G) => 1 - smooth(G.warmLat[0], G.warmLat[1], lat);
const aridShare = (lat, G) => smooth(G.aridLat[0], G.aridLat[1], lat) * (1 - smooth(G.aridLat[2], G.aridLat[3], lat));
const wetShare = (lat, G) => Math.max(1 - smooth(G.wetLat[0], G.wetLat[1], lat), smooth(G.wetLat[2], G.wetLat[3], lat) * (1 - smooth(G.wetLat[4], G.wetLat[5], lat)));
// (coal where the basin lay in a wet belt — or, by Madeline James's rule, anywhere within ~45° of the equator: GEOLOGY.guideRules.coalByWetBelts)
const coalBelt = (lat, G) => (G.coalByWetBelts === false ? 1 - smooth(40, 50, lat) : wetShare(lat, G));

/** Lay `km` of sediment on crust cell c, of the make-up given (shares; the rest sand and mud), at sim time `time`. */
export function deposit(crust, c, km, carb, salt, coal, organic, time, G) {
    if (!(km > 0)) return;
    // (the make-up kept is the top's: a new layer counts as much as its thickness against faciesMixKm)
    const w = km / (km + G.faciesMixKm);
    crust.coverCarb[c] += (carb - crust.coverCarb[c]) * w;
    crust.coverSalt[c] += (salt - crust.coverSalt[c]) * w;
    crust.coverCoal[c] += (coal - crust.coverCoal[c]) * w;
    crust.coverOrganic[c] += (organic - crust.coverOrganic[c]) * w;
    const cover = crust.coverKm[c] + km;
    crust.coverKm[c] = cover;
    if (cover > crust.coverMaxKm[c]) { crust.coverMaxKm[c] = cover; crust.coverMaxAt[c] = time; }
    crust.unroofKm[c] -= km;                          // (what lies beneath is buried that much deeper)
}

/**
 * The wear of one step at land cell c (step/heights.js, every step): `wornKm` of rock taken off the top — the cover
 * above the rivers' standing fill first, then the basement (not while a flood basalt's lavas still cover it: they wear on their own clock, volcWornKm).
 * Land sunk `basinKm` below its plain under a range's load is a foreland basin; what fills it is the rivers' (evolveGeology).
 */
export function recordWear(crust, c, wornKm, basinKm, time, dt, G) {
    if (wornKm > 0) {
        // (the rivers' fill the heights still stand on wears by its own book — heights.js, then evolveGeology — so it stays)
        const fromCover = Math.min(Math.max(0, crust.coverKm[c] - crust.coverFedKm[c]), wornKm), rest = wornKm - fromCover;
        crust.coverKm[c] -= fromCover;
        if (rest > 0 && !(crust.volcType[c] === VolcanicType.LIP && crust.volcKm[c] > crust.volcWornKm[c])) crust.exhumKm[c] += rest;
        crust.unroofKm[c] += wornKm;
    }
    if (basinKm > G.forelandDepthKm) crust.geoFlags[c] |= GeoFlag.FORELAND;
    // (a belt still active: its deposits form at their depths below today's surface — the unroofing counts from now)
    if (crust.oroType[c] !== OrogenyType.NONE && time - crust.oroLast[c] <= dt + 1e-9) crust.unroofKm[c] = 0;
}

/**
 * A belt thickened land cell c by `thickenedKm` (step/heights.js buildHeights): its sediment thickens with the crust —
 * sheets of it thrust over one another, a fold-and-thrust belt (the Zagros, the Appalachians' Valley and Ridge) — and
 * buries what lies beneath that much deeper.
 */
export function thickenCover(crust, c, thickenedKm, time, G) {
    const cover = crust.coverKm[c];
    if (!(cover > 0)) return;
    const add = cover * thickenedKm / G.crustKm;
    crust.coverKm[c] = cover + add;
    if (cover + add > crust.coverMaxKm[c]) { crust.coverMaxKm[c] = cover + add; crust.coverMaxAt[c] = time; }
    crust.unroofKm[c] -= add;
}

/**
 * The start world's past (once, when the history starts, just after heights.js seedBaseRelief): its ancient crust already
 * worn deep — a shield more than the mobile belts about it, each craton by its own amount — and over half of it under
 * platform sediment laid in old sags: its lowlands, between the swells (the make-up by the latitude it starts at). From a
 * noise field and a hash of its own: no random stream is touched. A painted initial state: see the header.
 */
export function seedGeology(world) {
    const G = world.config.geology;
    if (!G?.records) return;
    const { xyz, numCells: n } = world.mesh, noise = new FastNoise((world.seed ^ 0x6e01) >>> 0), F = R / G.platformNoiseKm;
    const ancientAt = -world.config.initialLandAgeMyr / 4, cellArea = 4 * Math.PI * R * R / n;
    // (the start world's swells, seeded just before — heights.js seedBaseRelief — the platform's sediment lies in the lowlands, its uplands bare)
    const H = heightsOf(world.config), baseRef = H.baseReliefKm > 0 ? H.baseReliefKm : 0;
    const book = world.geoBook ??= newBook();
    for (const plate of world.plates) {
        if (!plate.alive) continue;
        const k = plate.crust, m = plate.mat;
        for (let c = 0; c < k.mask.length; c++) {
            if (!k.mask[c] || (k.type[c] !== CrustType.CONTINENT && k.type[c] !== CrustType.CRATON)) continue;
            const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
            const wx = m[0] * x + m[1] * y + m[2] * z, wy = m[3] * x + m[4] * y + m[5] * z, wz = m[6] * x + m[7] * y + m[8] * z;
            const craton = k.type[c] === CrustType.CRATON, range = craton ? G.cratonExhumKm : G.beltExhumKm;
            const h = hash01(world.seed, k.terrane[c]), wobble = 1 + 0.25 * noise.noise3D(wx * F * 3 + 5.1, wy * F * 3 + 1.7, wz * F * 3 + 9.3);
            k.exhumKm[c] = (range[0] + (range[1] - range[0]) * h) * wobble;
            const v = 1.6 * noise.fbm(wx * F + 3.7, wy * F + 0.4, wz * F + 6.2, 3, 0.5);
            const low = baseRef > 0 ? 1 - Math.min(1, k.baseKm[c] / (baseRef * (craton ? H.baseReliefCraton : 1))) : NaN;
            const sag = smooth(-0.1, 0.5, low === low ? v + G.platformLowGain * (low - G.platformLowMid) : v);
            if (sag > 0) {
                const lat = Math.abs(Math.asin(Math.max(-1, Math.min(1, wz)))) * DEG;
                deposit(k, c, G.platformCoverKm * sag, 0.7 * warmShare(lat, G), 0.15 * aridShare(lat, G), 0.03 * wetShare(lat, G), 0.03, ancientAt, G);
                k.coverMaxKm[c] = 1.5 * k.coverKm[c];     // (buried deeper once, under cover since worn away)
                book.seededKm3 += k.coverKm[c] * cellArea;
            }
            k.unroofKm[c] = k.exhumKm[c];                 // (its old belts' deposits were bared by all of it)
        }
    }
}

/** The record's own account of its cover (km³), kept on the world and carried by the frames. */
const newBook = () => ({ seededKm3: 0, laidKm3: 0, wornFillKm3: 0, frontShare: 0, frontTicks: 0 });

/** 0…1 from the seed and a terrane id (a craton keeps its own character). */
function hash01(seed, id) {
    let h = (seed ^ Math.imul(id + 0x9e37, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/**
 * Every config.geology.everyMyr: what the rivers laid since last time joins the cover, at the latitude it lies at now;
 * the arcs' time and the settings that leave no other record.
 * @returns {number} 0 (it never changes crust)
 */
export function evolveGeology(world, dt) {
    const G = world.config.geology;
    if (!G?.records) return 0;
    world.geoClock = (world.geoClock ?? 0) + dt;
    if (world.geoClock < G.everyMyr - 1e-9) return 0;
    const span = world.geoClock;
    world.geoClock = 0;
    const { mesh, plates, owner, ownerCell, time } = world, { xyz, numCells: n } = mesh;
    const book = world.geoBook ??= newBook(), cellArea = 4 * Math.PI * R * R / n;

    // ── the belts' fronts: the plains in front of the active belts (beyond a collision's thrust front, behind an Andean arc),
    // out to forelandKm — from each belt's outer edge outward, never back into the belt ──
    const s = scratchFor(n), { fore, keel, inBelt } = s;
    for (let w = 0; w < n; w++) {
        fore[w] = Infinity; inBelt[w] = 0; keel[w] = 0;
        const o = owner[w];
        if (o < 0) continue;
        const crust = plates[o].crust, c = ownerCell[w], type = crust.type[c];
        if (type !== CrustType.CONTINENT && type !== CrustType.CRATON) continue;
        keel[w] = 1;
        if (!FORELAND_BELTS.has(crust.oroType[c]) || time - crust.oroLast[c] > span + 1e-9) continue;
        if (crust.beltU[c] >= G.forelandEdgeU) fore[w] = 0; else inBelt[w] = 1;
    }
    spreadKm(mesh, fore, { canEnter: (c, nb) => keel[nb] === 1 && !inBelt[nb], maxKm: G.forelandKm });
    // (past the edge only: the belt's own cells have their belt on record, and its folds)
    let front = 0, landNow = 0;
    for (let w = 0; w < n; w++) {
        landNow += keel[w];
        if (fore[w] > 0 && fore[w] < G.forelandFlagKm) { plates[owner[w]].crust.geoFlags[ownerCell[w]] |= GeoFlag.BELT_FRONT; front++; }
    }
    if (landNow) { book.frontShare = (book.frontShare ?? 0) + front / landNow; book.frontTicks = (book.frontTicks ?? 0) + 1; }

    // ── the slabs that flattened or steepened since last time: their arcs' moment of change ──
    const changed = new Set();
    for (let i = world.geoEventsSeen ?? 0; i < world.events.length; i++) {
        const e = world.events[i];
        if ((e.kind === EventKind.SLAB_FLAT || e.kind === EventKind.SLAB_STEEP) && e.data) changed.add(e.data.plate);
    }
    world.geoEventsSeen = world.events.length;

    // ── each plate's crust, where it is now ──
    const riftFlags = CrustFlag.FAILED_RIFT | CrustFlag.RIFT_MARGIN;
    for (const plate of plates) {
        if (!plate.alive || plate.crust.count === 0) continue;
        const k = plate.crust, m = plate.mat, slab = changed.has(plate.id), { mask, type, flags, seaFillKm, basinFillKm, coverFedKm } = k;
        for (let c = 0; c < mask.length; c++) {
            if (!mask[c]) continue;
            const t = type[c];
            if (t !== CrustType.OCEAN) {
                // (a live subduction belt — an island arc, an Andean margin, a flat slab's inland belt)
                const o = k.oroType[c];
                if ((o === OrogenyType.ANDEAN || o === OrogenyType.LARAMIDE || o === OrogenyType.ARC) && time - k.oroLast[c] <= span + 1e-9) {
                    k.arcMyr[c] += span;
                    if (slab) k.geoFlags[c] |= GeoFlag.SLAB_CHANGE;
                }
                if (t === CrustType.ARC) k.geoFlags[c] |= GeoFlag.WAS_ARC;
                else {
                    // (the rift's date, from its flags: see the header; and a sea closed just now — land formed this tick
                    // on a suture is the floor a weld filled in, or an arc's collapse closed)
                    if ((flags[c] & riftFlags) && k.riftAt[c] === 0) k.riftAt[c] = time;
                    if ((flags[c] & riftFlags) && time - k.riftAt[c] < G.riftBasinMyr) k.geoFlags[c] |= GeoFlag.RIFT_BASIN;
                    if ((flags[c] & CrustFlag.SUTURE) && time - k.formedAt[c] <= span + 1e-9) k.geoFlags[c] |= GeoFlag.OPHIOLITE;
                }
            }
            // what the rivers' books hold here now against what the cover has already taken: the fill grew, the cover grows
            // with it, at this latitude; it wore (heights.js wears a hollow's fill with its land), the cover loses that too
            const fill = seaFillKm[c] + basinFillKm[c], d = fill - coverFedKm[c];
            if (d === 0) continue;
            coverFedKm[c] = fill;
            if (d < 0) {
                const off = Math.min(k.coverKm[c], -d);
                k.coverKm[c] -= off; k.unroofKm[c] += off;
                book.wornFillKm3 += off * cellArea;
                continue;
            }
            const wz = m[6] * xyz[3 * c] + m[7] * xyz[3 * c + 1] + m[8] * xyz[3 * c + 2];
            const lat = Math.abs(Math.asin(Math.max(-1, Math.min(1, wz)))) * DEG, arid = aridShare(lat, G);
            if (t === CrustType.OCEAN) {
                // an enclosed sea: restricted, so salt where it lies in the arid belt and black mud where it is warm, and
                // the rivers' dissolved load as carbonate
                const warm = warmShare(lat, G), carb = G.dissolvedShare * (warm + G.coolCarbonate * (1 - warm));
                deposit(k, c, d, carb, G.saltShare * arid, 0, G.organicShare * warm, time, G);
            } else {
                // a hollow of the land: salt in the arid belt, coal where it is wet, a young rift's lake its black mud
                const young = (k.geoFlags[c] & GeoFlag.RIFT_BASIN) !== 0;
                deposit(k, c, d, 0, G.saltShare * arid, G.coalShare * coalBelt(lat, G), young ? G.organicShare * (1 - arid) : 0, time, G);
            }
            book.laidKm3 += d * cellArea;
        }
    }
    return 0;
}

let scratch = null;
function scratchFor(n) {
    if (scratch?.n === n) return scratch;
    scratch = { n, fore: new Float32Array(n), keel: new Uint8Array(n), inBelt: new Uint8Array(n) };
    return scratch;
}
