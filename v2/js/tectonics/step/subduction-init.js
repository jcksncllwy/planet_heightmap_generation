// Subduction initiation (WBP Part Va, Phase 6b). An ocean does not stay open for ever: a passive
// margin — the trenchless edge a rift left behind — grows a thicker, colder, denser slab of ocean
// beside it as the crust there ages, and sooner or later it founders and a NEW trench is born along
// it. That is what ends a Wilson cycle: the ocean that opened at a rift begins to close again.
//
// Where: a run of cells along one plate's outer ocean edge, against another plate, with
//   · no trench of its own already (that edge is doing the job),
//   · the two plates not pulling apart there (a spreading edge does not founder).
// When: a chance per Myr per margin, from the world's seeded stream, set by what pushes the margin down against what
// holds it up (founderUrge): the weight of the cooling ocean beside it — its lithosphere thickens as √age, and with it
// its excess weight over the mantle — and the squeeze across it, against the margin's strength. Ocean under no squeeze
// founders past subductionInitAgeMyr; a margin pressed hard founders younger (induced initiation: the Puysegur and Hjort
// trenches, the Mussau trench). Longer margins go first. The strength is a weak zone's, ~2–3 × 10¹² N/m (founderStrength,
// config.js): the plates' own stresses (step/plate-stress.js) are of that order, so it is the force balance — a plate
// pressed against a collision, or pushed from behind — that founds most trenches (Stern 2004; Crameri et al. 2020: most
// are induced), and the floor's age alone only the oldest.
// Three kinds of margin: between two plates (a passive edge, a transform: the squeeze is their closing), inside a plate
// along its coast (founderWithinPlates: the squeeze is the plate's stress across the coast), and across a plate's open
// ocean (founderAcross: a large plate failing under its own compression).
// Which side goes down: the OLDER, denser side; against a continent the ocean always does. The
// trench is armed on the overriding side, and from then on the ordinary rules (polarity.js,
// boundaries.js) run it like any other trench.
// A margin does not fail along its whole length at once (branch founders, 2026-10-28: a 24,000 km trench was born in one
// step, and 35 Mkm² of ocean became a plate). A new trench NUCLEATES on founderNucleusKm of it — its weakest, most pressed
// stretch — and PROPAGATES along strike from there, founderPropagationCmYr at full urge, while the margin ahead keeps
// failing: its floor's weight and the squeeze across it, with the pull of the slab already hanging beside the trench's end
// (Stern & Gerya 2018: ~10 cm/yr along the Bitlis–Zagros belt; Zhou et al. 2020). A trench that ends against a passive
// margin runs into it the same way — it INVADES it (the Lesser Antilles and Scotia arcs into the Atlantic, Gibraltar's:
// Duarte et al. 2013). Where the ocean that goes down must first become a plate of its own (inside a plate, or against the
// passive pre-history ocean), only the strip behind the nucleus breaks away — a microplate bounded by the trench, a
// transform at each end, and the plate's far edge — and it widens as its trench lengthens, taking the strip behind each
// new stretch: the ocean peels off progressively, as the plate's motion would (a STEP fault at each end of the trench:
// Govers & Wortel 2005), never in one piece.

import { CrustType, CrustFlag } from '../model/crust.js';
import { birthOceanPlate, oceanPlateName } from '../ops/birth-ocean-plate.js';
import { transferCells, componentsOf } from '../ops/tidy-plates.js';
import { oceanLine } from './ocean-plates.js';
import { EventKind, BoundaryKind } from '../model/world.js';
import { piecesOf } from '../../core/mesh-bfs.js';
import { exteriorSea } from '../ops/rift-partition.js';
import { netTorques, stressAcross, cutAlong } from './plate-stress.js';

/**
 * How eagerly a margin founders: q = √(age ÷ subductionInitAgeMyr) + squeeze ÷ founderStrength — the ocean's sinking weight
 * (√age, half-space cooling), in units of the weight that alone overcomes the margin, plus the compression across it (per
 * 100 km) in units of the margin's strength. Founders at all once q > 1; the urge is q² − 1 (so, unsqueezed, age ÷ threshold
 * − 1), capped; ocean younger than oceanNeutralAgeMyr never founders (Cloos 1993: it is still buoyant).
 * The weight is what the sinking floor has over what it would go down beside: against a continent or a ridge, all of it;
 * against older or younger floor, only the step in their depths, √age_old − √age_young (pass weightMyr = that step squared:
 * a weak zone through uniform floor has no weight to tip it, Stern 2004; Nikolaeva et al. 2010). @returns {number} 0 when it holds
 */
export function founderUrge(ageMyr, squeeze, config, weightMyr = ageMyr) {
    if (!(ageMyr >= config.oceanNeutralAgeMyr)) return 0;       // (younger, it is too warm and light to sink, however squeezed)
    const q = Math.sqrt(Math.max(0, weightMyr) / config.subductionInitAgeMyr) + Math.max(0, squeeze) / config.founderStrength;
    return q > 1 ? Math.min(config.subductionInitAgeCap, q * q - 1) : 0;
}

/**
 * @param {number} dt Myr
 * @returns {number} margins that began subducting this step
 */
export function initiateSubduction(world, dt) {
    const { mesh, owner, ownerCell, plates, convergence, config, time } = world;
    const { numCells, adjOffset, adjList, edgeKm } = mesh;
    if (config.subductionInitRatePerMyr <= 0) return 0;

    // 1. every contact cell that could found a trench, grouped by the pair of plates it lies between. The world view was
    // built before this step's other events: a plate they reshaped is skipped (its view is stale — see Plate.reshaped),
    // and every cell is re-checked against its raster (the passive ocean is reshaped by every wing, but never remapped)
    const stale = (P, cell) => (P.reshaped && !P.isBackground) || !P.crust.mask[cell];
    const byPair = new Map(), age = new Float64Array(numCells);
    for (let w = 0; w < numCells; w++) {
        const a = owner[w];
        if (a < 0 || plates[a].isBackground) continue;
        const A = plates[a], cellA = ownerCell[w];
        if (stale(A, cellA) || A.crust.type[cellA] !== CrustType.OCEAN || (A.crust.flags[cellA] & CrustFlag.TRENCH)) continue;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
            const nb = adjList[k], b = owner[nb];
            if (b < 0 || b === a) continue;
            const B = plates[b], cellB = ownerCell[nb];
            if (stale(B, cellB) || (B.crust.flags[cellB] & CrustFlag.TRENCH)) continue;          // that edge already subducts
            if (convergence[w] < -config.subductionInitMaxOpeningCmYr) continue;   // pulling apart here: a ridge, not a founder
            const key = a < b ? `${a}:${b}` : `${b}:${a}`;
            (byPair.get(key) ?? byPair.set(key, []).get(key)).push(w);
            age[w] = time - Math.min(A.crust.formedAt[cellA], B.crust.formedAt[cellB]);
            break;                                                          // one entry per world cell
        }
    }

    let started = 0;
    const tr = world.founderTrace?.between;                              // (diagnostics, tools/trace-founders.mjs: off unless asked)
    // 2. each unbroken stretch of such contact is a margin of its own, with its own age and squeeze: a trench is born along
    // one line, so a pair of plates whose contact is cut into pieces (by a stretch of trench, or of ridge) has several short
    // margins, not one long one. A stretch that a trench of the pair already ends against does not wait for a founder of
    // its own: the trench runs on along it while the margin ahead keeps failing (propagateAlong)
    const founded = new Set();
    let grown = 0;
    for (const [key, cells] of byPair) for (const segment of piecesOf(mesh, cells)) {
        const [idA, idB] = key.split(':').map(Number), A = plates[idA], B = plates[idB];
        if (!A?.alive || !B?.alive || founded.has(key)) break;                   // (one a pair a step: the first changed the pair)
        if (config.founderPropagate) {                                        // (−1: no trench of the pair ends against it)
            const layers = propagateAlong(world, A, B, segment, age, dt);
            if (layers > 0) { founded.add(key); grown += layers; }
            if (layers >= 0) continue;
        }
        let ages = 0, closing = 0;
        for (const w of segment) { ages += age[w]; closing += Math.max(0, convergence[w]); }
        const lengthKm = segment.length * edgeKm, ageMyr = ages / segment.length;
        // (between two plates the squeeze is their closing: a margin pressed together at founderSqueezeCmYr is pressed as
        // hard as it is strong)
        const urge = founderUrge(ageMyr, config.founderStrength * closing / segment.length / config.founderSqueezeCmYr, config);
        if (tr) { tr.pieces = (tr.pieces ?? 0) + 1; const why = lengthKm < config.subductionInitMinLengthKm ? 'short' : ageMyr < config.oceanNeutralAgeMyr ? 'young' : !(urge > 0) ? 'weak' : 'urged'; tr[why] = (tr[why] ?? 0) + 1;
            if (why !== 'short') (tr.samples ??= []).push([ageMyr, closing / segment.length, lengthKm, urge]); }
        if (lengthKm < config.subductionInitMinLengthKm || !(urge > 0)) continue;
        // chance rises with the urge, and with the margin's length
        let chance = config.subductionInitRatePerMyr * dt * urge * (lengthKm / config.subductionInitRateLengthKm);
        // (Phase 13, steered: while a supercontinent's pieces disperse, the young oceans that opened between them rarely
        // founder — closing them is how the pieces gather again, and that waits for the cycle's gathering: step/supercontinent.js)
        const cycle = world.cycle;
        if (cycle?.phase === 'dispersing' && ageMyr <= world.time - cycle.breakupAt + 1e-9) chance *= config.disperseFounderFactor;
        if (tr) tr.expected = (tr.expected ?? 0) + chance;
        if (world.rngSubduction() >= chance) continue;
        // It fails first along its weakest, most pressed stretch — where its floor is heaviest and the plates close fastest
        // (each cell's founder q, founderUrge) — founderNucleusKm of it; the rest follows as the trench propagates
        const qOf = w => Math.sqrt(Math.max(0, age[w]) / config.subductionInitAgeMyr) + Math.max(0, convergence[w]) / config.founderSqueezeCmYr;
        const nucleus = nucleusOf(mesh, segment, qOf, config.founderNucleusKm);
        // The passive ocean is no partner — it never moves, never pushes back and never accepts crust, so a
        // trench against it would tow its owner outward for ever. A real plate is carved out of it first
        // (ops/birth-ocean-plate.js); if there is too little old ocean there to be worth one, no trench founds. (All of it
        // within reach, not a strip: the passive ocean is a modelling device, and this is its first appearance as the
        // plate it stands for, as when it retires — ocean-plates.js. A strip of it, its sides against ocean that never
        // moves, swelled into the gap behind it: Phase 6b, "a newborn plate is a normal plate")
        let a2 = A, b2 = B;
        if (A.isBackground || B.isBackground) {
            const background = A.isBackground ? A : B;
            const born = birthOceanPlate(world, background, nucleus.cells, config.oceanPlateReachKm, oceanPlateName(world));
            if (!born) { if (tr) tr.unborn = (tr.unborn ?? 0) + 1; continue; }
            if (A.isBackground) a2 = born; else b2 = born;
        }
        const { upper, lower } = chooseFoundering(world, a2, b2, nucleus.cells);
        armMargin(world, upper, lower, nucleus.cells);
        founded.add(key);
        started++;
        world.log(EventKind.SUBDUCTION_INIT, `a new trench founders along ${nucleus.km.toFixed(0)} km of the ${lengthKm.toFixed(0)} km of ${lower.name}’s passive margin, beneath ${upper.name}: ocean ${ageMyr.toFixed(0)} Myr old begins to go down`,
            { upper: upper.id, lower: lower.id, lengthKm: nucleus.km, marginKm: lengthKm, ageMyr });
    }
    return started + grown;
}

// Scratch for nucleusOf and the walks along a margin (stamped, so nothing is cleared between calls)
let walkIn = null, walkSeen = null, walkStampIn = 0, walkStampSeen = 0;
function walkScratch(numCells) {
    if (!walkIn || walkIn.length !== numCells) { walkIn = new Uint32Array(numCells); walkSeen = new Uint32Array(numCells); walkStampIn = walkStampSeen = 0; }
}

/**
 * The cells of `cells` (one joined stretch of margin) within `layers` steps of `from` along it, layer by layer.
 * @returns {number[][]} the layers, from 0 (`from` itself) out
 */
function layersAlong(mesh, cells, from, layers) {
    const { numCells, adjOffset, adjList } = mesh;
    walkScratch(numCells);
    const inSet = ++walkStampIn, seen = ++walkStampSeen;
    for (const c of cells) walkIn[c] = inSet;
    const out = [];
    let ring = [];
    for (const c of from) if (walkIn[c] === inSet && walkSeen[c] !== seen) { walkSeen[c] = seen; ring.push(c); }
    for (let l = 0; l <= layers && ring.length; l++) {
        out.push(ring);
        if (l === layers) break;
        const next = [];
        for (const c of ring) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (walkIn[nb] !== inSet || walkSeen[nb] === seen) continue;
            walkSeen[nb] = seen; next.push(nb);
        }
        ring = next;
    }
    return out;
}

/**
 * Where along a margin a new trench nucleates: the stretch of it about founderNucleusKm long (the cells within that
 * half-length of a centre, along the margin) whose cells have the greatest founder score in all — its weakest, most pressed
 * stretch. Scale-invariant: the half-length is in km. @returns {{cells:number[], km:number}} km: its length along the margin
 */
function nucleusOf(mesh, cells, score, km) {
    const reach = Math.max(0, Math.round((km / mesh.edgeKm - 1) / 2));
    let best = cells[0], most = -Infinity;
    for (const c of cells) {
        let s = 0;
        if (reach === 0) s = score(c);
        else for (const ring of layersAlong(mesh, cells, [c], reach)) for (const x of ring) s += score(x);
        if (s > most) { most = s; best = c; }
    }
    const out = layersAlong(mesh, cells, [best], reach).flat();
    return { cells: out, km: Math.min(2 * reach + 1, out.length) * mesh.edgeKm };
}

/**
 * A strip leaving P can cut off pieces of P's ocean from the rest of it (between two strips, or behind one). Cut off, an
 * ocean-only piece would be handed to the passive ocean (ops/tidy-plates.js), where it never moves and only ages — the
 * floor older than any on Earth. It is the strip's own ocean, on the strip's side of the trench, and goes with it.
 * @returns {number[]} take, with P's ocean pieces it strands
 */
function withStranded(world, P, take) {
    const { mask } = P.crust;
    for (const c of take) mask[c] = 0;                                     // (as if gone: what is left of P, in pieces)
    const pieces = componentsOf(P.crust, world.mesh);
    for (const c of take) mask[c] = 1;
    if (pieces.length < 2) return take;
    pieces.sort((a, b) => b.land - a.land || b.cells.length - a.cells.length);
    const out = take.slice();
    for (const piece of pieces.slice(1)) if (piece.land === 0) for (const c of piece.cells) out.push(c);
    return out;
}

/**
 * Cells (stochastic, unbiased) a trench end advances along a margin in `dt`: founderPropagationCmYr at full urge, in
 * proportion below it; a cell of edgeKm at a time, the fraction drawn from `rng` (so the mean rate holds at any mesh).
 */
function stepsAhead(config, edgeKm, urge, dt, rng) {
    const x = config.founderPropagationCmYr * 10 * Math.min(1, urge) * dt / edgeKm, n = Math.floor(x);
    return n + (rng() < x - n ? 1 : 0);
}

/**
 * A trench of the pair (A, B) that ends against this stretch of their contact runs on along it — along strike, at a rate
 * set by how hard the margin ahead is pushed down against its strength (founderUrge): the floor's weight, the plates'
 * closing, and the pull of the slab already hanging beside it (founderSlabLoad × its maturity: Zhou et al. 2020 — a
 * passive margin next to a sinking slab gives way when it is weak and its floor old enough). Where the urge fails the
 * trench stops there (Puysegur has hardly lengthened in 11 Myr: Stern & Gerya 2018). Against the passive ocean the
 * trench's wings do this (step/wings.js). @returns {number} cells advanced; −1 if no trench of the pair ends against it
 */
function propagateAlong(world, A, B, segment, age, dt) {
    const { mesh, owner, ownerCell, plates, convergence, boundaryKind, config } = world, { adjOffset, adjList, edgeKm } = mesh;
    // the pair's trench cells beside the stretch: a cell of one of them, flagged, overriding the other there
    const anchors = [], votes = new Map();
    let mature = 0;
    for (const w of segment) for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
        const nb = adjList[k], o = owner[nb];
        if ((o !== A.id && o !== B.id) || boundaryKind[nb] !== BoundaryKind.OVERRIDING) continue;
        const U = plates[o], c = ownerCell[nb];
        if (!(U.crust.flags[c] & CrustFlag.TRENCH)) continue;
        const other = o === A.id ? B.id : A.id;
        let faces = false;
        for (let j = adjOffset[nb]; j < adjOffset[nb + 1] && !faces; j++) faces = owner[adjList[j]] === other;
        if (!faces) continue;
        votes.set(o, (votes.get(o) ?? 0) + 1);
        anchors.push(w);
        mature = Math.max(mature, Math.min(1, U.crust.slabKm[c] / config.slabMatureKm));
        break;
    }
    if (!anchors.length) return -1;
    const upperId = [...votes].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0], U = plates[upperId], L = upperId === A.id ? B : A;
    if (L.isBackground) return -1;
    if (U.reshaped || L.reshaped) return 0;
    // the margin just ahead of the trench's end
    let ages = 0, closing = 0;
    for (const w of anchors) { ages += age[w]; closing += Math.max(0, convergence[w]); }
    const squeeze = config.founderStrength * (closing / anchors.length / config.founderSqueezeCmYr + config.founderSlabLoad * mature);
    const urge = founderUrge(ages / anchors.length, squeeze, config);
    if (!(urge > 0)) return 0;
    const ends = piecesOf(mesh, anchors).length;
    world.budget.propagatingTipMyr = (world.budget.propagatingTipMyr ?? 0) + ends * dt;
    const n = stepsAhead(config, edgeKm, urge, dt, world.rngSubduction);
    if (!n) return 0;
    const cells = layersAlong(mesh, segment, anchors, n - 1).flat();
    armMargin(world, U, L, cells);
    world.budget.propagatedKm = (world.budget.propagatedKm ?? 0) + ends * n * edgeKm;
    return n;
}

// Cell-sized scratch for founderWithinPlates, reused from plate to plate (each cleared where it is taken up: a history
// asks every few Myr of every plate, and fresh arrays each time only fed the garbage collector)
let fwScratch = null;
function founderScratch(numCells) {
    if (!fwScratch || fwScratch.coast.length !== numCells) fwScratch = { coast: new Uint8Array(numCells), inOld: new Uint8Array(numCells), runOf: new Int32Array(numCells), label: new Int32Array(numCells), inS: new Uint8Array(numCells), seaOf: new Uint8Array(numCells), gone: new Uint8Array(numCells), seen: new Uint32Array(numCells), stamp: 0, queue: new Int32Array(numCells) };
    return fwScratch;
}

let sealQueue = new Int32Array(0);
/**
 * Is the plate's sea at `start` sealed — no way through sea out of it (as rift-partition.js exteriorSea, but only the one
 * sea, and stopping as soon as it reaches the plate's edge)? `memo` (per plate: 0 not yet known, 1 open, 2 sealed) keeps
 * what each walk learns for the plate's other runs.
 */
function sealedSea(mesh, crust, start, memo) {
    if (memo[start]) return memo[start] === 2;
    const { numCells, adjOffset, adjList } = mesh, { mask, type } = crust;
    if (crust.count >= numCells) return !exteriorSea(mesh, crust)[start];   // (a plate over the whole globe: its outer sea is its largest)
    if (sealQueue.length < numCells) sealQueue = new Int32Array(numCells);
    const q = sealQueue;
    let n = 0, open = false;
    q[n++] = start; memo[start] = 3;                                      // (3: on this walk)
    for (let i = 0; i < n && !open; i++) {
        const c = q[i];
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (!mask[nb]) { open = true; break; }
            if (memo[nb] || type[nb] !== CrustType.OCEAN) { if (memo[nb] === 1) { open = true; break; } continue; }
            memo[nb] = 3; q[n++] = nb;
        }
    }
    const v = open ? 1 : 2;                                               // (all it reached is joined: one sea)
    for (let i = 0; i < n; i++) memo[q[i]] = v;
    return !open;
}

/**
 * Old passive margins founder INSIDE a plate too (developer, 2026-10-18: the recordings — with no boundary between two
 * plates to found a trench on, a plate holding its continents and its whole ocean never broke up again, and an
 * assembled supercontinent's world froze as one plate for up to 200 Myr, its ocean ageing past 300 Myr). The rule is the
 * one above — a long run of ocean against a continent's coast, its chance per Myr from founderUrge and the length — on one
 * plate's own raster: when it founders, the strip of ocean behind its nucleus (founderNucleusKm of the coast) breaks away
 * as a plate of its own (the ocean nearer that stretch than any other coast of the plate, within oceanPlateReachKm) and the
 * coast's apron there stays as the trench, on the continent's side; the trench then propagates along the coast, and the
 * strip widens behind it (below: PROPAGATION). The squeeze here is the plate's own stress across its coast (step/plate-stress.js): the ocean that
 * would break away pressed against the continent — by a ridge behind it, or by the rest of the plate dragging the other way
 * — founders younger; held in tension, it waits for its weight. The continent is never split: a supercontinent stays one
 * landmass, ringed by trenches as Pangaea was.
 * A sea sealed inside the plate — ringed by its own land, left by a weld or a docking — founders by the same rule: its
 * floor breaks away as a plate of its own, under a trench along that shore. It does not close by itself: a plate that is
 * rigid all round a hole cannot make the hole smaller, so the sea's floor is consumed beneath one shore while new floor
 * opens at a ridge behind (the Black Sea and the South Caspian basins have stayed open for 100 Myr and more). It closes
 * once its rim breaks and the pieces converge across it, as any ocean between plates does. No crust is made or lost.
 * On the slow clock.
 * @param {number} dt Myr since it last ran  @returns {number} margins that began subducting
 */
export function founderWithinPlates(world, dt) {
    const { mesh, plates, config, time } = world, { numCells, adjOffset, adjList, edgeKm, cellAreaKm2 } = mesh;
    if (!(config.marginFounderRatePerMyr > 0)) return 0;
    const minCells = config.oceanPlateMinAreaKm2 / cellAreaKm2, reachHops = Math.max(1, Math.round(config.oceanPlateReachKm / edgeKm));
    let started = 0, grown = 0;
    const tr = world.founderTrace?.inside;                               // (diagnostics, tools/trace-founders.mjs: off unless asked)
    const tally = why => { if (tr) tr[why] = (tr[why] ?? 0) + 1; };
    for (const P of [...plates]) {                                          // (a copy: plates are added as it goes)
        // (a plate with little ocean may still hold a sealed sea, which founders whatever its size: below)
        if (!P.alive || P.isBackground || P.crust.count === 0 || P.stats.cells === P.stats.continentalCells) continue;
        if (config.founderPropagate) { const g = propagateAcross(world, P, dt); if (g) { grown += g; continue; } }    // (a failure across it running on)
        if (!(P.stats.continentalCells > 0)) { if (P.stats.cells >= minCells) started += founderAcross(world, P, dt, tr, tally); continue; }   // (no coast: only across)
        const { mask, type, flags, formedAt } = P.crust;
        const land = c => mask[c] && (type[c] === CrustType.CONTINENT || type[c] === CrustType.CRATON);
        // the plate's own coast — its ocean beside its continental crust — and the old part of it (no trench there yet)
        const sc = founderScratch(numCells), { coast, inOld, runOf } = sc, old = [];
        coast.fill(0); inOld.fill(0); runOf.fill(-1);
        for (let c = 0; c < numCells; c++) {
            if (!mask[c] || type[c] !== CrustType.OCEAN) continue;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                if (!land(adjList[k])) continue;
                coast[c] = 1;
                if (!(flags[c] & CrustFlag.TRENCH) && time - formedAt[c] >= config.oceanNeutralAgeMyr) old.push(c);     // (younger, it floats)
                break;
            }
        }
        // the runs of old coast, each joined along the coast
        const runs = [];
        for (const c of old) inOld[c] = 1;
        for (const s of old) {
            if (runOf[s] >= 0) continue;
            const run = [s]; runOf[s] = runs.length;
            for (let i = 0; i < run.length; i++) for (let k = adjOffset[run[i]]; k < adjOffset[run[i] + 1]; k++) { const nb = adjList[k]; if (inOld[nb] && runOf[nb] < 0) { runOf[nb] = runs.length; run.push(nb); } }
            runs.push(run);
        }
        // the ocean nearer each coast cell than any other coast cell of the plate, out to the reach, through the plate's ocean
        // only: one spread from the whole coast at once, each cell taking the coast cell that reaches it first — made when
        // first asked for. A stretch of coast's share of the ocean (stripOf) is what breaks away when it founders: bounded
        // by the trench along that stretch and, at each end of it, by the line to the neighbouring coast's share — a
        // transform, roughly square to the coast, as the strip moves off toward its trench
        let src = null, behind = null;                                         // behind: coast cell → [ocean cell, hops, …]
        const spread = () => {
            src = sc.label.fill(-1); behind = new Map();
            let ring = [];
            for (let c = 0; c < numCells; c++) if (coast[c]) { src[c] = c; ring.push(c); }
            for (let hop = 1; hop <= reachHops && ring.length; hop++) {
                const next = [];
                for (const c of ring) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                    const nb = adjList[k];
                    if (src[nb] >= 0 || !mask[nb] || type[nb] !== CrustType.OCEAN) continue;
                    src[nb] = src[c]; next.push(nb);
                    (behind.get(src[c]) ?? behind.set(src[c], []).get(src[c])).push(nb, hop);
                }
                ring = next;
            }
        };
        const stripOf = coastCells => {
            if (!src) spread();
            const cells = [];
            let depth = 0;
            for (const c of coastCells) {
                const b = behind.get(c);
                if (b) for (let i = 0; i < b.length; i += 2) if (mask[b[i]]) { cells.push(b[i]); depth = Math.max(depth, b[i + 1]); }
            }
            return { cells, depth };
        };
        // the squeeze: the plate's stress across a stretch of its coast, on the ocean behind it (compression is negative)
        let rho;
        const stressOn = (run, take) => {
            rho ??= netTorques(world, P);
            if (!rho) return 0;
            const region = take.concat(run), inS = sc.inS;
            for (const c of region) inS[c] = 1;
            const sigma = stressAcross(rho, region, cutAlong(mesh, run, inS, land), mesh.xyz, edgeKm, P.mat);
            for (const c of region) inS[c] = 0;
            return sigma;
        };
        // (a strip that leaves takes the wing tips in it along: step/wings.js)
        const moveWings = (take, to) => {
            for (const c of take) sc.inS[c] = 1;
            for (const [tip, dir] of P.wings) if (sc.inS[tip] && !coast[tip]) { to.wings.set(tip, dir); P.wings.delete(tip); }
            for (const c of take) sc.inS[c] = 0;
        };
        const newPlate = () => {
            const fresh = world.addPlate(oceanPlateName(world));
            fresh.setQuat(P.quat.slice());
            fresh.omega = P.omega.slice();                                   // it starts as it was; the torque balance takes it from there
            fresh.isOceanBorn = true;
            return fresh;
        };
        const slabHops = Math.max(1, Math.ceil(config.subductionInitSlabKm / edgeKm));
        // PROPAGATION. A trench that ends against a run of the plate's old passive coast runs on along it while the margin
        // ahead keeps failing — the plate's own trench along this coast (the plate across it going down), or another
        // plate's that the coast's ocean is going down beneath (it INVADES the margin: the Lesser Antilles and the Scotia
        // arc into the Atlantic, Gibraltar's: Duarte et al. 2013; Zhou et al. 2020). The urge ahead is founderUrge's —
        // the floor's weight, the plate's stress across the coast — with the pull of the slab already hanging beside it
        // (founderSlabLoad × its maturity); the end advances founderPropagationCmYr at full urge, in proportion below it,
        // and stops where it fails. The ocean behind each stretch it reaches breaks away to the plate going down: the
        // microplate the trench nucleated grows along strike as its trench lengthens (an invading trench's first stretch
        // is a microplate of its own). Earth counts none of this as a new subduction zone (Crameri et al. 2020, Box 1).
        let propagated = false;
        if (config.founderPropagate && !P.reshaped && runs.length) {
            const { owner, ownerCell, boundaryKind } = world, { xyz, index } = mesh, X = [0, 0, 0];
            const worldOf = c => { P.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], X); return index.nearest(X[0], X[1], X[2]); };
            for (const run of runs) {
                const anchors = [], invaded = [], lowers = new Map(), sinking = new Set();
                let mature = 0;
                for (const c of run) {
                    const w = worldOf(c);
                    // (a stretch already going down beneath someone is no passive margin ahead of a trench)
                    if (owner[w] === P.id && boundaryKind[w] === BoundaryKind.SUBDUCTING) {
                        sinking.add(c);
                        for (let j = adjOffset[w]; j < adjOffset[w + 1]; j++) {
                            const nb = adjList[j], o = owner[nb];
                            if (o < 0 || o === P.id || boundaryKind[nb] !== BoundaryKind.OVERRIDING) continue;
                            const Q = plates[o], q = ownerCell[nb];
                            if (!Q.alive || Q.reshaped || !(Q.crust.flags[q] & CrustFlag.TRENCH)) continue;
                            invaded.push(c); mature = Math.max(mature, Math.min(1, Q.crust.slabKm[q] / config.slabMatureKm));
                            break;
                        }
                        continue;
                    }
                    // beside the plate's own live trench along this coast: which plate goes down beneath it there
                    let hit = false;
                    for (let k = adjOffset[c]; k < adjOffset[c + 1] && !hit; k++) {
                        const t = adjList[k];
                        if (!mask[t] || !coast[t] || type[t] !== CrustType.OCEAN || !(flags[t] & CrustFlag.TRENCH)) continue;
                        const wt = worldOf(t);
                        if (owner[wt] !== P.id || boundaryKind[wt] !== BoundaryKind.OVERRIDING) continue;     // (a live trench: its slab pulls)
                        for (let j = adjOffset[wt]; j < adjOffset[wt + 1]; j++) {
                            const nb = adjList[j], o = owner[nb];
                            if (o < 0 || o === P.id) continue;
                            const L = plates[o];
                            if (!L.alive || L.isBackground || L.reshaped || L.crust.type[ownerCell[nb]] !== CrustType.OCEAN) continue;
                            lowers.set(o, (lowers.get(o) ?? 0) + 1); hit = true;
                        }
                        if (hit) mature = Math.max(mature, Math.min(1, P.crust.slabKm[t] / config.slabMatureKm));
                    }
                    if (hit) anchors.push(c);
                }
                // the junctions: where a stretch going down beneath another plate's trench meets coast that is not
                const junctions = invaded.filter(c => { for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (inOld[nb] && runOf[nb] === runOf[c] && !sinking.has(nb)) return true; } return false; });
                const from = anchors.length ? anchors : junctions;
                if (!from.length) continue;
                let ages = 0;
                for (const c of from) ages += time - formedAt[c];
                const ageMyr = ages / from.length, sigma = stressOn(run, stripOf(run).cells);
                const urge = founderUrge(ageMyr, -sigma + config.founderStrength * config.founderSlabLoad * mature, config);
                if (!(urge > 0)) continue;
                const ends = piecesOf(mesh, from).length;
                world.budget.propagatingTipMyr = (world.budget.propagatingTipMyr ?? 0) + ends * dt;
                const n = stepsAhead(config, edgeKm, urge, dt, world.rngMarginFounder);
                if (!n) continue;
                const fromSet = new Set(from), walk = run.filter(c => fromSet.has(c) || !sinking.has(c));
                const ahead = layersAlong(mesh, walk, from, n - 1).flat(), strip = stripOf(ahead).cells;
                if (!strip.length) continue;
                const take = withStranded(world, P, strip);
                if (!anchors.length && !Number.isFinite(config.oceanPlateMinAreaKm2)) continue;   // (a scene's: no plate may be born)
                let L = null;
                if (anchors.length) L = plates[[...lowers].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0]];
                else { L = newPlate(); L.born = time; }
                moveWings(take, L);
                if (!transferCells(world, P, L, take)) { if (!anchors.length) L.alive = false; continue; }
                for (const c of ahead) P.crust.armTrench(c, config.subductionInitSlabKm);
                P.dirty = true; propagated = true; grown += n;
                world.budget.propagatedKm = (world.budget.propagatedKm ?? 0) + ends * n * edgeKm;
                if (!anchors.length) world.log(EventKind.PLATE_BORN, `${L.name} is born: a trench invades ${P.name}’s passive margin, and ${(take.length * cellAreaKm2 / 1e6).toFixed(1)} Mkm² of its ocean breaks away to go down beneath it`,
                    { plate: L.id, areaMkm2: take.length * cellAreaKm2 / 1e6, invasion: true, upper: P.id });
            }
        }
        // (the plate's raster has changed under its runs: its own founders wait for the next draw)
        if (propagated) continue;
        // A SEALED sea — the plate's ocean that no way through sea leads out of (rift-partition.js exteriorSea) — founders
        // whatever the length of its shore: the shortest-trench rule is for a margin facing open ocean, where a short
        // stretch is a corner of a long coast. A sealed
        // sea's floor is all there is, cut off from any ridge: it only ages, and old enough — or squeezed — it goes down
        // beneath a shore, its chance per km of that shore as on any margin (the South Caspian floor under the Apsheron
        // sill: Jackson et al. 2002; the Japan Sea's eastern margin: Tamaki & Honza 1985; the Ionian beneath the Calabrian
        // and Hellenic arcs: Faccenna et al. 2014). A young sealed sea (a back-arc basin just closed off) is too light to.
        let seaOf = null, gone = null;
        const isSealed = run => (seaOf ??= sc.seaOf.fill(0), sealedSea(mesh, P.crust, run[0], seaOf));   // (a run lies in one sea)
        const nextTo = (cells, c) => { for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (sc.gone[adjList[k]]) return true; return false; };
        // the floor of the sealed sea a run is the shore of: the plate's ocean joined to it, the run itself left on the plate.
        // Empty if it reaches less than a starting slab's length (subductionInitSlabKm) out from the shore: a floor narrower
        // than the slab a new trench needs has no slab to sink — nothing goes down, and the sea stays as it is
        const seaFloor = run => {
            const mark = ++sc.stamp, out = [], q = sc.queue;
            let n = 0, ring = 0, end = 0;
            for (const c of run) sc.seen[c] = mark;
            for (const c of run) q[n++] = c;
            end = n;
            for (let i = 0; i < n; i++) {
                if (i === end) { ring++; end = n; }
                for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) {
                    const nb = adjList[k];
                    if (sc.seen[nb] === mark || !mask[nb] || type[nb] !== CrustType.OCEAN) continue;
                    sc.seen[nb] = mark; q[n++] = nb; out.push(nb);
                }
            }
            return ring >= slabHops ? out : [];
        };
        const before = started;
        for (const run of runs) {
            const lengthKm = run.length * edgeKm;
            let sealed = null;                                                   // (asked only where it matters)
            if (lengthKm < config.subductionInitMinLengthKm && !(sealed = isSealed(run))) { tally('short'); continue; }
            let ages = 0;
            for (const c of run) ages += time - formedAt[c];
            const ageMyr = ages / run.length;
            // A sealed sea's floor goes down WHOLE beneath the shore that fails: it is one slab, cut off from any ridge, with
            // nothing to hold part of it up (the South Caspian's floor under the Apsheron sill). Taking only the ocean nearest
            // this stretch of its shore left the rest of the sea to the plate: a sliver went down, was captured back, and
            // the arc its trench raised ringed the sea into smaller seas (README: sealed seas by cause).
            // An open margin fails first along its weakest, most pressed stretch — the plate's stress across its coast is
            // one figure for the whole run, so where its floor is heaviest — founderNucleusKm of it; only the strip of ocean
            // behind that stretch breaks away, and it must reach out at least a starting slab's length (subductionInitSlabKm)
            let take, nucleus = null;
            if (sealed ??= isSealed(run)) {
                if (gone && run.some(c => nextTo(gone, c))) { tally('sealedGone'); continue; }   // (its sea went down this draw)
                take = seaFloor(run);
                if (!take.length) { tally('sealedEmpty'); continue; }
            } else {
                if (!Number.isFinite(config.oceanPlateMinAreaKm2)) { tally('noBirths'); continue; }   // (a scene's: no plate may be born)
                nucleus = nucleusOf(mesh, run, c => Math.sqrt(Math.max(0, time - formedAt[c])), config.founderNucleusKm);
                const strip = stripOf(nucleus.cells);
                if (strip.depth < slabHops) { tally('narrow'); continue; }
                take = withStranded(world, P, strip.cells);
            }
            const sigma = stressOn(run, sealed ? take : stripOf(run).cells);
            const urge = founderUrge(ageMyr, -sigma, config);
            let chance = config.marginFounderRatePerMyr * dt * urge * (lengthKm / config.subductionInitRateLengthKm);
            const cycle = world.cycle;
            if (cycle?.phase === 'dispersing' && ageMyr <= time - cycle.breakupAt + 1e-9) chance *= config.disperseFounderFactor;
            if (tr) { tally((sealed ? 'sealed' : '') + (urge > 0 ? 'urged' : 'weak')); tr.expected = (tr.expected ?? 0) + (urge > 0 ? chance : 0); (tr.samples ??= []).push([ageMyr, sigma, lengthKm, urge]); }
            if (!(urge > 0) || world.rngMarginFounder() >= chance) continue;
            const fresh = newPlate();
            moveWings(take, fresh);
            if (!transferCells(world, P, fresh, take)) { fresh.alive = false; continue; }
            if (sealed) { gone ??= []; for (const c of take) { sc.gone[c] = 1; gone.push(c); } }
            fresh.born = time;
            const armed = sealed ? run : nucleus.cells, armedKm = sealed ? lengthKm : nucleus.km;
            for (const c of armed) P.crust.armTrench(c, config.subductionInitSlabKm);
            P.dirty = true;
            started++;
            world.log(EventKind.PLATE_BORN, `${fresh.name} is born: ${(take.length * cellAreaKm2 / 1e6).toFixed(1)} Mkm² of ${P.name}’s old ocean breaks away`, { plate: fresh.id, areaMkm2: take.length * cellAreaKm2 / 1e6 });
            world.log(EventKind.SUBDUCTION_INIT, `a new trench founders along ${armedKm.toFixed(0)} km of ${P.name}’s ${sealed ? 'shore of a sealed sea' : `${lengthKm.toFixed(0)} km passive margin`}: ${fresh.name}, ocean ${ageMyr.toFixed(0)} Myr old, begins to go down beneath it`,
                { upper: P.id, lower: fresh.id, lengthKm: armedKm, marginKm: lengthKm, ageMyr, stress: sigma, ...(sealed ? { sealed: true } : {}) });
            // (the plate's other runs are drawn too, in the same draw: their strips are other cells of the plate, untouched —
            // drawn every marginFounderEveryMyr, stopping at one would found fewer than drawing every step; which seas are
            // sealed is asked afresh, the plate's edge having moved)
            seaOf = null;
        }
        if (gone) for (const c of gone) sc.gone[c] = 0;
        if (started === before) started += founderAcross(world, P, dt, tr, tally);
    }
    return started + grown;
}

/**
 * A plate's open ocean founders ACROSS the plate (large-plate failure: Stern 2004; Crameri et al. 2020 — the Indo-Australian
 * plate's diffuse convergence today; the Mussau trench). The line is the one a big ocean plate would split along under
 * tension (step/ocean-plates.js oceanLine: through its open ocean, along its coast or across its motion); the stress across
 * it (step/plate-stress.js) is what the rest of the plate puts on the far side, and a plate is under more of it the bigger
 * it is — the drag under it, and the pushes and pulls at its edges, must be carried through it. Pressed together across the
 * line harder than a weak zone holds (founderUrge, with the floor's weight along it), it fails as a thrust: the far side
 * breaks away as a plate of its own, the OLDER floor of the two sides goes down beneath the younger (Stern & Bloomer
 * 1992; Hall et al. 2003), and a trench is armed along the line on the side that stays up. Held in tension, the line
 * waits for the split (a new ridge). No crust is made or lost. @returns {number} 1 if it founded
 */
function founderAcross(world, P, dt, tr, tally) {
    const { mesh, config, time } = world, { numCells, adjOffset, adjList, edgeKm, cellAreaKm2, xyz } = mesh;
    const minCells = config.oceanPlateMinAreaKm2 / cellAreaKm2, ocean = P.stats.cells - P.stats.continentalCells;
    if (!config.founderAcross || ocean < 2 * minCells) return 0;
    if (P.acrossFronts?.length) return 0;                                    // (it is failing across already: that line runs on, propagateAcross)
    const line = oceanLine(world, P, world.rngMarginFounder);
    if (!line || line.best.length < minCells || ocean - line.best.length < minCells) { tally('acrossNone'); return 0; }
    const { mask, type, flags, formedAt } = P.crust, { best } = line;
    const inS = new Uint8Array(numCells);
    for (const c of best) inS[c] = 1;
    const rest = c => mask[c] === 1 && !inS[c];
    // the line itself: the far side's cells against the rest of the plate, and the rest's against them
    const farEdge = [], nearEdge = [], onNear = new Uint8Array(numCells);
    for (const c of best) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
        const nb = adjList[k];
        if (!rest(nb)) continue;
        if (farEdge.at(-1) !== c) farEdge.push(c);
        if (!onNear[nb]) { onNear[nb] = 1; nearEdge.push(nb); }
    }
    const lengthKm = farEdge.length * edgeKm;
    if (lengthKm < config.subductionInitMinLengthKm) { tally('acrossShort'); return 0; }
    // which side goes down: against land, the ocean; ocean against ocean, the older; a stretch already a trench is no weak zone
    const sideAge = cells => { let a = 0, n = 0, land = 0, trench = 0; for (const c of cells) { if (type[c] !== CrustType.OCEAN) { land++; continue; } if (flags[c] & CrustFlag.TRENCH) trench++; a += time - formedAt[c]; n++; } return { age: n ? a / n : 0, land: land / cells.length, trench: trench / cells.length }; };
    const far = sideAge(farEdge), near = sideAge(nearEdge);
    if (far.trench + near.trench > 0.5) { tally('acrossTrench'); return 0; }
    const farSinks = near.land > far.land || (near.land === far.land && far.age >= near.age);
    const ageMyr = farSinks ? far.age : near.age, upAge = farSinks ? near.age : far.age, upLand = farSinks ? near.land : far.land;
    const rho = netTorques(world, P);
    if (!rho) return 0;                                                      // (a plate born since the last balance: its stress is not known yet)
    const sigma = stressAcross(rho, best, cutAlong(mesh, farEdge, inS, rest), xyz, edgeKm, P.mat);
    // (the weight that tips it: the step in depth across the line — against land, the floor's whole weight)
    const step = Math.max(0, Math.sqrt(ageMyr) - Math.sqrt(upAge)), weightMyr = upLand > 0.5 ? ageMyr : step * step;
    const urge = founderUrge(ageMyr, -sigma, config, weightMyr);
    let chance = config.marginFounderRatePerMyr * dt * urge * (lengthKm / config.subductionInitRateLengthKm);
    const cycle = world.cycle;
    if (cycle?.phase === 'dispersing' && ageMyr <= time - cycle.breakupAt + 1e-9) chance *= config.disperseFounderFactor;
    if (tr) { tally(urge > 0 ? 'acrossUrged' : 'acrossWeak'); tr.expected = (tr.expected ?? 0) + (urge > 0 ? chance : 0); (tr.acrossSamples ??= []).push([ageMyr, sigma, lengthKm, urge]); }
    if (!(urge > 0) || world.rngMarginFounder() >= chance) return 0;
    // It fails first along the weakest, most pressed stretch of the line — founderNucleusKm of it, where the floor on its far
    // side is heaviest — and only the strip of the far side behind that stretch breaks away (nearer it than any other cell
    // of the line); the line fails on from the stretch's ends as the trench propagates, the strip widening with it
    // (propagateAcross). It must reach out at least a starting slab's length.
    const nucleus = config.founderPropagate ? nucleusOf(mesh, farEdge, c => Math.sqrt(Math.max(0, time - formedAt[c])), config.founderNucleusKm) : { cells: farEdge, km: lengthKm };
    const strip = stripBehind(mesh, inS, farEdge, nucleus.cells);
    if (strip.depth < Math.max(1, Math.ceil(config.subductionInitSlabKm / edgeKm)) - 1) { tally('acrossNarrow'); return 0; }
    const take = withStranded(world, P, strip.take);
    for (const c of best) inS[c] = 0;
    for (const c of take) inS[c] = 1;
    const fresh = world.addPlate(oceanPlateName(world));
    fresh.setQuat(P.quat.slice());
    fresh.omega = P.omega.slice();                                           // it starts as it was; the torque balance takes it from there
    fresh.isOceanBorn = true;
    for (const [tip, d] of P.wings) if (inS[tip]) { fresh.wings.set(tip, d); P.wings.delete(tip); }   // (wing tips go with their half)
    if (!transferCells(world, P, fresh, take)) { fresh.alive = false; return 0; }
    fresh.born = time;
    // the trench, on the side that stays up (fresh shares P's frame: its raster cells are P's)
    const upper = farSinks ? P : fresh, lower = farSinks ? fresh : P;
    armAcross(world, P, upper, farSinks, nucleus.cells, inS);
    upper.dirty = true;
    if (config.founderPropagate) (P.acrossFronts ??= []).push({ fresh: fresh.id, farSinks, far: Int32Array.from(best), edge: Int32Array.from(farEdge), done: new Set(nucleus.cells) });
    world.log(EventKind.PLATE_BORN, `${fresh.name} is born: ${(take.length * cellAreaKm2 / 1e6).toFixed(1)} Mkm² of ${P.name}’s ocean breaks away across it`, { plate: fresh.id, areaMkm2: take.length * cellAreaKm2 / 1e6 });
    world.log(EventKind.SUBDUCTION_INIT, `${P.name} fails across its ocean${sigma < 0 ? ' under compression' : ''}: a new trench founders along ${nucleus.km.toFixed(0)} km of a ${lengthKm.toFixed(0)} km line, ${lower.name}’s floor ${ageMyr.toFixed(0)} Myr old going down beneath ${upper.name}`,
        { upper: upper.id, lower: lower.id, lengthKm: nucleus.km, marginKm: lengthKm, ageMyr, weightMyr, stress: sigma, across: true });
    return 1;
}

/**
 * The cells of a side (marked in `inSide`) nearer the line cells `mine` than any other cell of the line `edge`, through
 * the side's own cells — `mine` among them — and how far out they reach (hops). @returns {{take:number[], depth:number}}
 */
function stripBehind(mesh, inSide, edge, mine) {
    const { numCells, adjOffset, adjList } = mesh;
    walkScratch(numCells);
    const mark = ++walkStampSeen, own = ++walkStampIn, take = [];
    let ring = [], depth = 0;
    for (const c of mine) { walkIn[c] = own; }
    for (const c of edge) if (inSide[c] && walkSeen[c] !== mark) { walkSeen[c] = mark; ring.push(c); if (walkIn[c] === own) take.push(c); }
    for (let hop = 1; ring.length; hop++) {
        const next = [];
        for (const c of ring) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (!inSide[nb] || walkSeen[nb] === mark) continue;
            walkSeen[nb] = mark; next.push(nb);
            if (walkIn[c] === own) { walkIn[nb] = own; take.push(nb); depth = hop; }
        }
        ring = next;
    }
    return { take, depth };
}

/** Arm the trench of a failure across P along the far-side line cells `cells`: on P's near side if the far side sinks, else on them. */
function armAcross(world, P, upper, farSinks, cells, onFar) {
    const { mesh, config } = world, { xyz, index, adjOffset, adjList } = mesh, X = [0, 0, 0];
    for (const c of cells) {
        if (farSinks) {
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!onFar[nb] && P.crust.mask[nb] && P.crust.type[nb] === CrustType.OCEAN) P.crust.armTrench(nb, config.subductionInitSlabKm); }
        } else {
            P.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], X);
            const q = upper.cellAt(index, X[0], X[1], X[2]);
            if (upper.crust.mask[q] && upper.crust.type[q] === CrustType.OCEAN) upper.crust.armTrench(q, config.subductionInitSlabKm);
        }
    }
}

/**
 * A failure across a plate (founderAcross) runs on along its line from the ends of the stretch that failed, as a trench
 * along a margin does (founderWithinPlates, PROPAGATION): founderUrge on the line just ahead — the depth step's weight, the
 * stress across the line, the pull of the slab beside — and the far side's strip behind each new stretch breaks away to
 * the plate that broke off. A front ends once its line is all gone, or its plate is. @returns {number} line cells advanced
 */
function propagateAcross(world, P, dt) {
    const fronts = P.acrossFronts;
    if (!fronts?.length || P.reshaped) return 0;
    const { mesh, plates, config, time } = world, { numCells, adjOffset, adjList, edgeKm, xyz, index } = mesh, { mask, type, formedAt } = P.crust, X = [0, 0, 0];
    let grown = 0;
    for (let i = fronts.length - 1; i >= 0; i--) {
        const f = fronts[i], L = plates[f.fresh];
        if (!L?.alive) { fronts.splice(i, 1); continue; }
        if (L.reshaped) continue;
        const inFar = new Uint8Array(numCells);
        for (const c of f.far) if (mask[c] && type[c] === CrustType.OCEAN) inFar[c] = 1;
        const edge = Array.from(f.edge).filter(c => inFar[c] && !f.done.has(c));
        const tips = edge.filter(c => { for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (f.done.has(adjList[k])) return true; return false; });
        if (!tips.length) { fronts.splice(i, 1); continue; }
        // the line just ahead: its two sides' floor (the step in depth across it is the weight), and the slab beside
        let far = 0, near = 0, nNear = 0, land = 0, mature = 0;
        for (const c of tips) {
            far += time - formedAt[c];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!mask[nb] || inFar[nb]) continue; if (type[nb] !== CrustType.OCEAN) land++; else { near += time - formedAt[nb]; nNear++; } }
        }
        for (const c of f.done) {
            let slab = 0;
            if (f.farSinks) { for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (mask[nb]) slab = Math.max(slab, P.crust.slabKm[nb]); } }
            else { P.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], X); const q = L.cellAt(index, X[0], X[1], X[2]); if (L.crust.mask[q]) slab = L.crust.slabKm[q]; }
            mature = Math.max(mature, Math.min(1, slab / config.slabMatureKm));
        }
        const farAge = far / tips.length, nearAge = nNear ? near / nNear : farAge;
        const sinkAge = f.farSinks ? farAge : nearAge, upAge = f.farSinks ? nearAge : farAge;
        const step = Math.max(0, Math.sqrt(sinkAge) - Math.sqrt(upAge)), weightMyr = land > 0 ? sinkAge : step * step;
        const rho = netTorques(world, P);
        const rest = c => mask[c] === 1 && !inFar[c];
        const region = f.far.filter(c => inFar[c]);
        const sigma = rho ? stressAcross(rho, region, cutAlong(mesh, edge, inFar, rest), xyz, edgeKm, P.mat) : 0;
        const urge = founderUrge(sinkAge, -sigma + config.founderStrength * config.founderSlabLoad * mature, config, weightMyr);
        if (!(urge > 0)) continue;
        const ends = piecesOf(mesh, tips).length;
        world.budget.propagatingTipMyr = (world.budget.propagatingTipMyr ?? 0) + ends * dt;
        const n = stepsAhead(config, edgeKm, urge, dt, world.rngMarginFounder);
        if (!n) continue;
        const ahead = layersAlong(mesh, edge, tips, n - 1).flat(), strip = stripBehind(mesh, inFar, edge, ahead).take;
        if (!strip.length) continue;
        const take = withStranded(world, P, strip);
        const onFar = inFar;                                                  // (still marks the far side, the take among it, for the arming)
        for (const [tip, d] of P.wings) if (take.includes(tip)) { L.wings.set(tip, d); P.wings.delete(tip); }
        // (on the upper side: P's near side if the far side sinks — before the move; else the moved cells, on L — after)
        if (f.farSinks) armAcross(world, P, P, true, ahead, onFar);
        const at = f.farSinks ? null : ahead.map(c => P.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], [0, 0, 0]));
        if (!transferCells(world, P, L, take)) continue;
        if (at) for (const p of at) { const q = L.cellAt(index, p[0], p[1], p[2]); if (L.crust.mask[q] && L.crust.type[q] === CrustType.OCEAN) L.crust.armTrench(q, config.subductionInitSlabKm); }
        for (const c of ahead) f.done.add(c);
        P.dirty = L.dirty = true;
        grown += n;
        world.budget.propagatedKm = (world.budget.propagatedKm ?? 0) + ends * n * edgeKm;
    }
    return grown;
}

/** The longest run of cells joined to one another (a trench is one line, not scattered specks). */

/** Which side founders: against land, the ocean; ocean against ocean, the older (colder, denser) side. */
function chooseFoundering(world, A, B, segment) {
    const { mesh, owner, ownerCell } = world, { xyz, index } = mesh;
    let ageA = 0, ageB = 0, landA = 0, landB = 0, n = 0;
    for (const w of segment) {
        const cellA = A.cellAt(index, xyz[3 * w], xyz[3 * w + 1], xyz[3 * w + 2]);
        const cellB = B.cellAt(index, xyz[3 * w], xyz[3 * w + 1], xyz[3 * w + 2]);
        if (A.crust.mask[cellA]) { ageA += A.crust.formedAt[cellA]; if (A.crust.type[cellA] !== CrustType.OCEAN) landA++; }
        if (B.crust.mask[cellB]) { ageB += B.crust.formedAt[cellB]; if (B.crust.type[cellB] !== CrustType.OCEAN) landB++; }
        n++;
    }
    if (landA !== landB) return landA > landB ? { upper: A, lower: B } : { upper: B, lower: A };
    return ageA <= ageB ? { upper: A, lower: B } : { upper: B, lower: A };     // the older crust (formed earlier) sinks
}

/** Arm a trench on the upper plate's cells along the segment, and give it a starting slab. */
function armMargin(world, upper, lower, segment) {
    const { mesh, config } = world, { xyz, index } = mesh;
    for (const w of segment) {
        const q = upper.cellAt(index, xyz[3 * w], xyz[3 * w + 1], xyz[3 * w + 2]);
        if (!upper.crust.mask[q]) continue;
        upper.crust.armTrench(q, config.subductionInitSlabKm);
        // its neighbours along the line too, so the new trench is continuous on the upper plate's own lattice
        for (let k = mesh.adjOffset[q]; k < mesh.adjOffset[q + 1]; k++) {
            const nb = mesh.adjList[k];
            if (upper.crust.mask[nb] && upper.crust.type[nb] === CrustType.OCEAN && isOnSegment(world, lower, nb, upper)) upper.crust.armTrench(nb, config.subductionInitSlabKm);
        }
    }
    upper.dirty = true;
}

/**
 * Is `cell` of `upper` at the contact with `lower` (its world position sits within a cell of lower's crust)? Read from
 * lower's raster, not the world view: lower may have been carved out of the passive ocean this very step.
 */
function isOnSegment(world, lower, cell, upper) {
    const { xyz, index, adjOffset, adjList } = world.mesh, P = [0, 0, 0];
    upper.toWorld(xyz[3 * cell], xyz[3 * cell + 1], xyz[3 * cell + 2], P);
    const q = lower.cellAt(index, P[0], P[1], P[2]);
    if (lower.crust.mask[q]) return true;
    for (let k = adjOffset[q]; k < adjOffset[q + 1]; k++) if (lower.crust.mask[adjList[k]]) return true;
    return false;
}
