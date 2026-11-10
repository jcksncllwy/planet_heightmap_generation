// When a continent rifts (WBP Part Va). Probabilistic, from the world's seeded rng: a continent
// that is big enough and has been stable for riftTenureMyr rifts with a chance per Myr that grows
// with the TENSION it is under (the share of its trench pull that cancels itself, Phase 4) and with
// its size, and with the HEAT of the mantle under it (Phase 13: a continent that has sat long on the same mantle has
// insulated it — step/hotspots.js — and rifts readily; one that has drifted onto cool mantle hardly rifts at all, so a
// supercontinent's breakup comes in a burst and then quiets — step/supercontinent.js); a mantle plume head
// (step/hotspots.js) may force one where it rises. The rift itself — where it runs, how it splits the plate — is ops/rift.js.
// The pace of breakups is kept per piece of continent (riftMinGapMyr … riftDueMyr, config.js: none too soon after its own
// last rift or weld, the chance growing as its quiet spell runs long). Nothing paces the world as a whole and nothing forces
// a rift: the upstream rules for those (riftMaxGapMyr, riftGlobalGapMyr, ee0a67b) were retired 2026-11-09 — rifts are local
// (Earth has several under way at once), and without them the supercontinent cycle survives on every seed (riftaudit §2.2).

import { useRockBook } from '../rock-book.js';
import { CrustFlag, CrustType, OrogenyType } from '../model/crust.js';
import { columnModel } from '../measure.js';
import { heightsOf } from './heights.js';
import { tangentToward } from '../../core/sphere-geom.js';
import { findRift, riftContext, splitPlate, chooseJunction } from '../ops/rift.js';
import { EventKind } from '../model/world.js';
import { isContinental } from './hotspots.js';
import { riftStressContext, stressJunctions } from '../field/rift-stress.js';

const JUNCTION_TRIES = 12;     // junctions tried per rift chance: the best crossing among them is taken (many admit none)

/**
 * A generator (simulate.js): each rift's search over its junctions is handed out as a request — { plate, junctions, pull,
 * needCratonsBothSides, ctx, config } — and answered with the junctions' findRift results, in order (searchJunctions here,
 * or helper workers side by side: app/helper-pool.js). The same answers either way, so the same history.
 * @param {number} dt
 * @returns {number} plates split this step
 */
export function* riftContinents(world, dt) {
    const { plates, config, time, mesh } = world;
    let splits = 0;
    // The pace of breakups (developer, 2026-10-01): each PIECE of continent keeps its own clock — from when it was born of a
    // rift or welded together (plate.born; a terrane docking does not reset it) — none within riftMinGapMyr of it (a plume
    // head arriving then waits), the chance coming back over riftSpacingMyr and growing past riftDueMyr, and at
    // (nothing forces a rift, and the world is not held to one a step: retired 2026-11-09)
    const paced = config.riftRatePerMyr > 0 && config.riftMinGapMyr > 0;
    const age = plate => time - plate.born, areaOf = plate => plate.stats.continentalCells * mesh.cellAreaKm2;
    const tooYoung = plate => paced && age(plate) < config.riftMinGapMyr - 1e-9;
    const cycle = world.cycle;
    // (while the pieces gather, those of the landmass they gather into — over the downwelling — are pressed together: rarer
    // rifts there; pressed into one and welded, their clocks start again)
    const gatherInto = cycle?.gather > 0 ? new Set(cycle.largestPlates ?? []) : null;
    // (Phase 13, steered: a supercontinent just counted holds for superTenureMyr — its plates do not rift, a plume's head
    // included: a plume under it still erupts its flood basalt — step/supercontinent.js)
    const superHeld = cycle?.phase === 'assembled' && cycle.formedAt > 0 && time - cycle.formedAt < config.superTenureMyr ? new Set(cycle.largestPlates ?? []) : null;
    const held = plate => superHeld?.has(plate.id);
    // plume heads that arrived under a continent (step/hotspots.js decided which may split it): the rift starts under the
    // plume — or, if that is a craton, from the ordinary ground nearest it. One that finds the piece too young or held, waits for it — up to plumeRiftWaitMyr after the head arrived (the Deccan traps came a few Myr
    // before the Seychelles rifted off India) — where the head arrived on the continent (its junctions, taken then in the
    // plate's own frame: the plate has moved on over the plume since); one that finds no cut gives up
    const waiting = [];
    for (const pr of world.pendingPlumeRifts) {
        const plate = plates[pr.plate];
        if (!plate?.alive) continue;
        if (pr.since === undefined) { pr.since = time; pr.junctions = pr.cell >= 0 ? [pr.cell] : plumeJunctions(world, plate, pr.xyz); }
        if (held(plate) || tooYoung(plate)) { if (paced && time - pr.since < config.plumeRiftWaitMyr - 1e-9) waiting.push(pr); continue; }
        // (one that waited finds the piece changed — often a coast near where the head arrived: the looser rules of shape, if the
        // usual ones admit no cut)
        if ((yield* tryRift(world, plate, pr.junctions, pr.cause, false)) || (time > pr.since && (yield* withLooseShape(config, function* () { return yield* tryRift(world, plate, pr.junctions, pr.cause, false); })))) splits++;
    }
    world.pendingPlumeRifts = waiting;
    const heat = config.riftHeatGain > 0 ? heatUnderContinents(world) : null;
    // spontaneous rifting under tension
    // (Phase 13, steered — step/supercontinent.js: while a supercontinent's pieces disperse, the plates of a landmass that has
    // gathered much of the continental crust again too soon come apart readily)
    for (const plate of plates.slice()) {
        if (!plate.alive || plate.isBackground || !plate.dynamics || held(plate) || tooYoung(plate)) continue;
        const areaKm2 = areaOf(plate), tooSoon = !!cycle?.clump?.includes(plate.id);
        const h = heat?.get(plate.id) ?? 0;
        // (unpaced — a scene with riftMinGapMyr 0 — the old tenure: a piece of a rift still over hot mantle may rift again soon)
        const tenure = paced ? 0 : tooSoon ? config.riftTenureHotMyr : heat && plate.bornOfRift ? config.riftTenureMyr + (config.riftTenureHotMyr - config.riftTenureMyr) * h : config.riftTenureMyr;
        if (areaKm2 < config.riftMinContinentKm2 || age(plate) < tenure) continue;
        let heatFactor = heat ? config.riftHeatFloor + config.riftHeatGain * h ** config.riftHeatPower : 1;   // warm mantle below: rifts readily; cool: hardly
        if (tooSoon) heatFactor = Math.max(heatFactor, 1) * config.dispersalRiftBoost;
        // (while the pieces gather over the downwelling they are pressed together: rifts are rarer there; elsewhere as ever)
        if (heat && gatherInto?.has(plate.id)) heatFactor *= 1 - (1 - config.gatherRiftFactor) * cycle.gather;
        // (a continent over hot mantle is stretched by the swell beneath it whatever its boundaries do: its tension is at least
        // riftHeatTension × heat — without it, a supercontinent with no boundaries left pulling at it could never rift)
        const tension = heat ? Math.max(plate.dynamics.tension, config.riftHeatTension * h) : plate.dynamics.tension;
        const pace = paced ? paceOf(age(plate), config) : 1;
        const chance = pace * config.riftRatePerMyr * dt * tension * heatFactor * Math.min(config.riftSizeCap, areaKm2 / config.riftMinContinentKm2 - 1);   // a supercontinent rifts readily, a continent barely big enough hardly ever
        if (world.rng() >= chance) continue;
        const junctions = junctionsFor(world, plate, JUNCTION_TRIES);
        if (yield* tryRift(world, plate, junctions, { text: `tension ${tension.toFixed(2)}${heat ? `, mantle heat ${h.toFixed(2)}` : ''}`, kind: 'tension', hotspot: -1 })) splits++;
    }
    return splits;
}

/**
 * Where to try a rift from: by the stress (config.riftByStress: the cells it pulls hardest against their strength,
 * field/rift-stress.js — the rng is still drawn as many times, so the dice that follow are the same dice), or a weak interior
 * cell drawn at random (ops/rift.js chooseJunction).
 */
function junctionsFor(world, plate, count) {
    const drawn = Array.from({ length: count }, () => chooseJunction(world, plate, world.rng));
    if (!world.config.riftByStress) return drawn;
    const st = riftStressContext(world, plate), picked = st ? stressJunctions(world, plate, st, count) : [];
    return picked.length ? picked : drawn;
}

/** The pace of a piece's breakup at this age (since it was born of a rift or welded together; × its rift chance): 0 at
 *  riftMinGapMyr, back to 1 by riftSpacingMyr (smoothly), and growing once riftDueMyr has passed. */
function paceOf(age, config) {
    let x = (age - config.riftMinGapMyr) / Math.max(1e-9, config.riftSpacingMyr - config.riftMinGapMyr);
    x = x <= 0 ? 0 : x >= 1 ? 1 : x;
    const late = Math.max(0, age - config.riftDueMyr) / config.riftDueRampMyr;
    return x * x * (3 - 2 * x) * (1 + late * late);
}

/** A plume's looser rules of shape (its rift waited and the piece changed), when no cut passes the usual ones. */
const LOOSE_SHAPE = { riftTortuosityMax: 2, riftMinChordKm: 1000 };
/** Run the generator gen with the rules of a rift's shape loosened (LOOSE_SHAPE), then put them back. */
function* withLooseShape(config, gen) {
    const saved = {};
    for (const [k, v] of Object.entries(LOOSE_SHAPE)) { saved[k] = config[k]; config[k] = v; }
    try { return yield* gen(); } finally { Object.assign(config, saved); }
}

/** A rift request answered right here: each junction's findRift, in order (null for none). */
export function searchJunctions(world, { plate, junctions, pull, needCratonsBothSides, ctx }) {
    return junctions.map(j => (j < 0 ? null : findRift(world, plate, j, pull, needCratonsBothSides, ctx)));
}

/** Per plate: the mean mantle heat under its continental crust (0 = cool, 1 = fully insulated). */
function heatUnderContinents(world) {
    const { owner, mantleHeat, plates } = world, sum = new Float64Array(plates.length), count = new Float64Array(plates.length);
    for (let w = 0; w < owner.length; w++) if (isContinental(world, w)) { sum[owner[w]] += mantleHeat[w]; count[owner[w]]++; }
    return { get: id => count[id] ? sum[id] / count[id] : 0 };
}

/**
 * The rift through the best of the given junctions (a rift's shape is set by where it starts more than by where
 * its arms end, so the compact-piece preference is settled here, between junctions), then the split.
 * @param {{text: string, kind: 'plume' | 'tension', hotspot: number}} cause   what started it (for the event)
 */
export function* tryRift(world, plate, junctions, cause, needCratonsBothSides = true) {
    const { mesh } = world, pull = pullAxisOf(plate, mesh), ctx = riftContext(world, plate);     // (what every junction's search reads of the crust)
    // (the junctions' searches, handed out — each junction's own, the answers in the junctions' order)
    const results = yield { plate, junctions, pull, needCratonsBothSides, ctx, config: world.config };
    useRockBook(world.budget);                  // (the rock book: another history may have stepped while this one waited)
    let rift = null;
    for (const found of results) if (found && (!rift || found.value < rift.value)) rift = found;
    if (!rift) return false;
    const weak = CrustFlag.SUTURE | CrustFlag.FAILED_RIFT | CrustFlag.RIFT_MARGIN, weakKm = rift.path.filter(c => plate.crust.flags[c] & weak).length * mesh.edgeKm;   // (before the split flags the new margins)
    world.onRiftPath?.(world, plate, rift.path);          // (a measuring tool's look at the line, before the split: tools/pstress-history.mjs)
    const before = plate.name, ageMyr = world.time - plate.born, fresh = splitPlate(world, plate, rift.path, rift.failedArm, (a, b) => namesAfterSplit(world, a, b, before), rift.across);
    const km = rift.path.length * mesh.edgeKm;
    // (a craton the rift went through is now on both plates: its terrane id is kept on both halves, recorded here)
    const cratonsOf = P => { const ids = new Set(); for (let c = 0; c < mesh.numCells; c++) if (P.crust.mask[c] && P.crust.type[c] === CrustType.CRATON) ids.add(P.crust.terrane[c]); return ids; };
    const onFresh = cratonsOf(fresh), splitCratons = [...cratonsOf(plate)].filter(id => onFresh.has(id));
    const cratonKm = rift.path.filter(c => plate.crust.mask[c] ? plate.crust.type[c] === CrustType.CRATON : fresh.crust.type[c] === CrustType.CRATON).length * mesh.edgeKm;
    if (world.config.riftStage) openRiftStage(world, plate, fresh, rift.path);
    world.log(EventKind.RIFT, `${before} rifts (${cause.text}): ${plate.name} and ${fresh.name} part along ${km.toFixed(0)} km of rift${rift.failedArm.length ? `, a failed arm of ${(rift.failedArm.length * mesh.edgeKm).toFixed(0)} km left behind` : ''}`,
        { plate: plate.id, fresh: fresh.id, cause: cause.kind, hotspot: cause.hotspot, lengthKm: km, weakKm, failedArmKm: rift.failedArm.length * mesh.edgeKm, ageMyr, stress: rift.stress, share: rift.share, cratonKm, splitCratons });
    return true;
}

/** Raster cells of `plate` a plume at world position xyz could start a rift from: land, not craton, within plumeJunctionKm — the nearest first. */
const PLUME_TRY_KM = 220;     // the rift of a plume head starts within this of the plume (about 12 cells at 40K)

function plumeJunctions(world, plate, xyz) {
    const { mesh, config } = world, { adjOffset, adjList, index } = mesh, crust = plate.crust;
    const c0 = plate.cellAt(index, xyz[0], xyz[1], xyz[2]), maxHops = Math.max(1, Math.round(config.plumeJunctionKm / mesh.edgeKm));
    const ok = c => crust.mask[c] && crust.type[c] !== CrustType.OCEAN && crust.type[c] !== CrustType.CRATON;
    // every candidate within PLUME_TRY_KM of the plume (or out to plumeJunctionKm while none is found), nearest first;
    // then JUNCTION_TRIES of them spread from the nearest to the farthest — so on any mesh the tries cover the same
    // disc under the plume head, not just the few cells next to it
    const all = ok(c0) ? [c0] : [], seen = new Set([c0]), tryHops = Math.max(1, Math.round(PLUME_TRY_KM / mesh.edgeKm));
    let ring = [c0];
    for (let hop = 0; hop < maxHops && ring.length && (hop < tryHops || all.length === 0); hop++) {
        const next = [];
        for (const c of ring) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!seen.has(nb) && crust.mask[nb]) { seen.add(nb); next.push(nb); if (ok(nb)) all.push(nb); } }
        ring = next;
    }
    if (all.length <= JUNCTION_TRIES) return all;
    return Array.from({ length: JUNCTION_TRIES }, (_, i) => all[Math.round(i * (all.length - 1) / (JUNCTION_TRIES - 1))]);
}

/**
 * The plate-frame axis along which this plate is being pulled apart: the principal axis of where its
 * trench cells lie around its centre (a ringed plate's NET pull is ~0, so the sum of forces would say
 * nothing; the tug of war shows in the trenches sitting on opposite sides).
 */
export function pullAxisOf(plate, mesh) {
    const { xyz } = mesh, { mask, flags } = plate.crust, c = plate.capCenter, M = new Float64Array(9);
    let n = 0;
    for (let i = 0; i < mask.length; i++) {
        if (!mask[i] || !(flags[i] & CrustFlag.TRENCH)) continue;
        const u = tangentToward(c, c, [xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]]);
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[3 * a + b] += u[a] * u[b];
        n++;
    }
    if (n * mesh.edgeKm < 485) return null;                   // (less than ~500 km of trench pulls no way in particular)
    let v = [c[1], -c[0], 0];                             // power iteration for the principal axis
    for (let it = 0; it < 30; it++) {
        const w = [0, 1, 2].map(a => M[3 * a] * v[0] + M[3 * a + 1] * v[1] + M[3 * a + 2] * v[2]), l = Math.hypot(...w);
        if (l < 1e-12) return null;
        v = w.map(x => x / l);
    }
    return v;
}

/** Names for the two halves: by the craton letters each side holds when the world knows them, else "X·1 / X·2" (numbers not in use). */
function namesAfterSplit(world, a, b, before) {
    const na = world.nameByCratons(a, null), nb = world.nameByCratons(b, null);
    if (na && nb && na !== nb) return [na, nb];
    const base = before.replace(/(·\d+)+$/, ''), taken = new Set(world.plates.filter(p => p.alive).map(p => p.name)), names = [];
    for (let n = 1; names.length < 2; n++) if (!taken.has(`${base}·${n}`)) names.push(`${base}·${n}`);
    return names;
}

// ── The continental rift stage (lane pstress, stage 2; config.riftStage) ──
// A continent does not part along a clean cut into new ocean at once: it stretches first. Over the first riftBreakupKm of
// opening the halves pull apart through continental crust thinned ever more toward the axis (a necking zone, then crust
// < 10 km thick against ~30 km as formed: the hyperextended domain of a magma-poor margin — Sutra et al. 2013, G³), and only
// then does the mantle break through and a spreading axis make ocean floor. Here: the crust the halves make between them in
// that time (resolve.js fills the gap as it does any parting) is that stretched continent, not ocean — thinned from 1 − 0.2
// to 1 − 0.7 of its crust as the opening runs from 0 to riftBreakupKm — and carries an extension record (OrogenyType.RIFT,
// with no work: it sinks, it is not a shoulder). Thinned crust stands low (Airy: measure.js columnKm), so a young rift's floor
// sags below the sea; whether the sea gets in is the terrain's: a floor joined below sea level to the open ocean is sea (the
// Red Sea, the Gulf of California), one closed off by its ends' land holds lakes (East Africa) — finish/finish-hydro.js gives a
// closed hollow below sea level the ordinary lake treatment, at its rim.
// Reduced model, and its limits: the opening's speed is the torque balance's, as a spreading ridge's (the rift's own slowness,
// mm/yr for tens of Myr, is not modelled: a rift reaches breakup in a few Myr at a few cm/yr); the thinning profile is a ramp
// in time, not a stretching factor worked out from strain; no magma (volcanic margins are as magma-poor ones).

const STAGE_SPAN = [0.2, 0.7];      // the share of its crust a stretched cell has lost: at the start of the opening, at breakup

/** A rift just split plate and fresh along path: open its stage. The zone it may stretch over: within riftBreakupKm of the line. */
function openRiftStage(world, plate, fresh, path) {
    const { mesh, config } = world, { adjOffset, adjList, numCells, edgeKm } = mesh;
    const hops = Math.ceil(config.riftBreakupKm / edgeKm) + 1, seen = new Uint8Array(numCells), zone = [], hop = [];
    let ring = [...new Set(path)];
    for (const c of ring) { seen[c] = 1; zone.push(c); hop.push(0); }
    for (let h = 0; h < hops; h++) {
        const next = [];
        for (const c of ring) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!seen[nb]) { seen[nb] = 1; zone.push(nb); hop.push(h + 1); next.push(nb); } }
        ring = next;
    }
    (world.riftStages ??= []).push({ a: plate.id, b: fresh.id, born: world.time, lengthKm: path.length * edgeKm, zone: Int32Array.from(zone), hop: Uint8Array.from(hop), hops, stretchedKm2: 0 });
}

/**
 * The rift stage of every young rift: the crust its halves made between them since the last step, stretched continent until
 * the opening reaches riftBreakupKm (then it has broken up, and the stage ends). @returns {number} cells made continental
 */
export function evolveRiftStages(world) {
    const { plates, config, time, mesh } = world;
    if (!world.riftStages?.length) return 0;
    const C = columnModel(heightsOf(config)), crustKm = C.crust[CrustType.CONTINENT], cellKm2 = mesh.cellAreaKm2;
    let made = 0;
    world.riftStages = world.riftStages.filter(st => {
        const A = plates[st.a], B = plates[st.b];
        if (!A?.alive || !B?.alive || A.riftPartner !== B.id || B.riftPartner !== A.id) return false;
        if (config.riftStageVolume) { made += stretchConserving(world, st, A, B, C, time, config, cellKm2); return st.stretchedKm2 / st.lengthKm < config.riftBreakupKm; }
        const f = Math.min(1, st.stretchedKm2 / st.lengthKm / config.riftBreakupKm), lost = STAGE_SPAN[0] + (STAGE_SPAN[1] - STAGE_SPAN[0]) * f;
        for (const P of [A, B]) {
            const cr = P.crust;
            for (const c of st.zone) {
                if (!cr.mask[c] || cr.type[c] !== CrustType.OCEAN || cr.formedAt[c] < st.born) continue;
                cr.type[c] = CrustType.CONTINENT;
                cr.rootKm[c] = -crustKm * lost;
                cr.riftThin[c] = lost; cr.riftThinAt[c] = time;     // (the stretch record: its crust, a continent's less `lost`)
                cr.flags[c] |= CrustFlag.RIFT_MARGIN;
                cr.recordOrogeny(c, OrogenyType.RIFT, 0, time, config.orogenyQuietMyr);
                st.stretchedKm2 += cellKm2; made++;
                P.dirty = true;                         // (a type changed in place: counts, not shape)
            }
        }
        return st.stretchedKm2 / st.lengthKm < config.riftBreakupKm;
    });
    return made;
}

// ── The rift stage that conserves the crust (lane crust, stage 1a; config.riftStageVolume) ──
// Stretching makes no rock. The stage above gives each cell of the opening a crust of its own (1 − lost of a continent's),
// made from nothing, and leaves the halves' crust as it was: over a 1200 Myr cycle it adds 0.7–0.9 Gkm³ (~15 % of the
// planet's continental crust) and no margin is ever thinned (crust-report.md §1). Here the opening's crust is the zone's
// own, spread wider: pure shear across the zone, strongest at the line and fading to nothing at the zone's edge — the
// necking and hyperextended domains of a rifted margin, where crust ~30–35 km thick thins to < 10 km toward the axis
// over 100–300 km (Sutra et al. 2013, G³; Iberia–Newfoundland). Each step, with the opening's new cells N and the zone's
// continent D (both halves, the stage's earlier cells included; cratons excepted, too strong to neck — Lenardic & Moresi
// 1999), each cell of D keeps 1 − k·w of its crust (w = 1 at the line, falling linearly to 0 past the zone's last ring)
// and each new cell gets the line's crust as thinned, H₁(1 − k) (H₁ the mean crust of D's cells nearest the line): k is
// the one number that leaves Σ crust unchanged — k = |N|·H₁ ÷ (Σ_D h·w + |N|·H₁). The area the opening adds is the same
// as the stage above (riftBreakupKm of it, sourced); its volume now comes out of the margins, which thin and sink (Airy:
// measure.js columnKm), so a young rift's margins stand below the sea where the stage above left cliffs.
// Reduced model, and its limits: the thinning is a profile, not a strain worked out from forces; only the root (crust)
// thins — the relief and the swells a cell carries are left as they were (heights.js wears them); a cell's crust is never
// thinned below THIN_FLOOR_KM. Arcs and cratons in the zone are left whole.
const THIN_FLOOR_KM = 3;            // (no crust thinner than this: the hyperextended domain's thinnest, ~3 km, Sutra et al. 2013)
function stretchConserving(world, st, A, B, C, time, config, cellKm2) {
    const crustKm = C.crust[CrustType.CONTINENT], fresh = [], old = [];
    let sumHW = 0, sumH1 = 0, n1 = 0;
    const w = i => 1 - st.hop[i] / (st.hops + 1);
    for (const P of [A, B]) {
        const cr = P.crust;
        for (let i = 0; i < st.zone.length; i++) {
            const c = st.zone[i];
            if (!cr.mask[c]) continue;
            if (cr.type[c] === CrustType.OCEAN) { if (cr.formedAt[c] >= st.born) fresh.push(P, c, i); continue; }
            if (cr.type[c] !== CrustType.CONTINENT) continue;
            const h = Math.max(0, C.crust[CrustType.CONTINENT] + cr.rootKm[c]);
            old.push(P, c, i, h);
            sumHW += h * w(i);
            if (w(i) >= 0.6) { sumH1 += h; n1++; }
        }
    }
    const nNew = fresh.length / 3;
    if (!nNew) return 0;
    if (!old.length) {                                           // (no continent left in the zone to stretch: the opening is ocean)
        st.stretchedKm2 = st.lengthKm * config.riftBreakupKm;
        return 0;
    }
    let sumH = 0; for (let j = 3; j < old.length; j += 4) sumH += old[j];
    const H1 = n1 ? sumH1 / n1 : sumH / (old.length / 4);
    const k = nNew * H1 / (sumHW + nNew * H1);
    // (the floor: a cell already near it gives less, so the books still balance — what it cannot give is not made)
    const h2 = new Float64Array(old.length / 4);
    let given = 0;
    for (let j = 0; j < old.length; j += 4) {
        const h = old[j + 3], i = old[j + 2], kept = Math.max(Math.min(h, THIN_FLOOR_KM), h * (1 - k * w(i)));
        h2[j / 4] = kept; given += h - kept;
    }
    // The new cells hold no crust thinner than the floor either. While what the zone gives spreads over them at the floor or
    // more, all of them take it. Once it cannot (the line's crust thinned to the hyperextended domain's thinnest — the end of
    // necking), only as many as it fills at the floor take crust — those farthest out from the line, against the margin —
    // and the rest stay the ocean floor they are: the zone has no more to stretch, and the rift breaks up into a spreading
    // ridge, as with no continent left in the zone (above). If it fills none, nothing is taken from the margins.
    const fill = Math.min(nNew, Math.floor(given / THIN_FLOOR_KM + 1e-9));
    if (fill < nNew) {
        world.budget.riftFloorShortCells = (world.budget.riftFloorShortCells ?? 0) + nNew - fill;
        st.stretchedKm2 = Math.max(st.stretchedKm2 + fill * cellKm2, st.lengthKm * config.riftBreakupKm);
    } else st.stretchedKm2 += nNew * cellKm2;
    if (!fill) return 0;
    for (let j = 0; j < old.length; j += 4) {
        const P = old[j], c = old[j + 1], h = old[j + 3], kept = h2[j / 4];
        P.crust.rootKm[c] = kept - crustKm;
        // (the stretch record: 1 − 1/β compounds — a cell that kept kept/h of its crust this step was stretched by h/kept more)
        if (kept < h) { P.crust.riftThin[c] = 1 - (1 - P.crust.riftThin[c]) * kept / h; P.crust.riftThinAt[c] = time; }
        P.dirty = true;
    }
    const each = given / fill, take = [];
    for (let j = 0; j < fresh.length; j += 3) take.push(j);
    if (fill < nNew) take.sort((x, y) => st.hop[fresh[y + 2]] - st.hop[fresh[x + 2]] || fresh[x + 1] - fresh[y + 1]);   // (farthest from the line first; ties by cell, for one history)
    for (let t = 0; t < fill; t++) {
        const j = take[t], P = fresh[j], c = fresh[j + 1], cr = P.crust;
        cr.type[c] = CrustType.CONTINENT;
        cr.rootKm[c] = each - crustKm;
        // (the stretch record of crust the opening made: a continent's crust, as formed, thinned to `each` — β = crustKm ÷ each)
        cr.riftThin[c] = Math.max(0, 1 - each / crustKm); cr.riftThinAt[c] = time;
        cr.flags[c] |= CrustFlag.RIFT_MARGIN;
        cr.recordOrogeny(c, OrogenyType.RIFT, 0, time, config.orogenyQuietMyr);
        P.dirty = true;
    }
    return fill;
}
