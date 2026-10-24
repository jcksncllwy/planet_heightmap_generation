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

import { CrustType, CrustFlag } from '../model/crust.js';
import { birthOceanPlate, oceanPlateName } from '../ops/birth-ocean-plate.js';
import { transferCells } from '../ops/tidy-plates.js';
import { oceanLine } from './ocean-plates.js';
import { EventKind } from '../model/world.js';
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
    // margins, not one long one
    const founded = new Set();
    for (const [key, cells] of byPair) for (const segment of piecesOf(mesh, cells)) {
        const [idA, idB] = key.split(':').map(Number), A = plates[idA], B = plates[idB];
        if (!A?.alive || !B?.alive || founded.has(key)) break;                   // (one a pair a step: the first changed the pair)
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
        // The passive ocean is no partner — it never moves, never pushes back and never accepts crust, so a
        // trench against it would tow its owner outward for ever. A real plate is carved out of it first
        // (ops/birth-ocean-plate.js); if there is too little old ocean there to be worth one, no trench founds.
        let a2 = A, b2 = B;
        if (A.isBackground || B.isBackground) {
            const background = A.isBackground ? A : B, born = birthOceanPlate(world, background, segment, config.oceanPlateReachKm, oceanPlateName(world));
            if (!born) { if (tr) tr.unborn = (tr.unborn ?? 0) + 1; continue; }
            if (A.isBackground) a2 = born; else b2 = born;
        }
        const { upper, lower } = chooseFoundering(world, a2, b2, segment);
        armMargin(world, upper, lower, segment);
        founded.add(key);
        started++;
        world.log(EventKind.SUBDUCTION_INIT, `a new trench founders along ${(segment.length * edgeKm).toFixed(0)} km of ${lower.name}’s passive margin, beneath ${upper.name}: ocean ${ageMyr.toFixed(0)} Myr old begins to go down`,
            { upper: upper.id, lower: lower.id, lengthKm: segment.length * edgeKm, ageMyr });
    }
    return started;
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
 * plate's own raster: when it founders, the ocean on that side breaks away as a plate of its own (the ocean nearer this
 * coast than any other coast of the plate, within oceanPlateReachKm) and the coast's apron stays as the trench, on the
 * continent's side. The squeeze here is the plate's own stress across its coast (step/plate-stress.js): the ocean that
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
    let started = 0;
    const tr = world.founderTrace?.inside;                               // (diagnostics, tools/trace-founders.mjs: off unless asked)
    const tally = why => { if (tr) tr[why] = (tr[why] ?? 0) + 1; };
    for (const P of [...plates]) {                                          // (a copy: plates are added as it goes)
        // (a plate with little ocean may still hold a sealed sea, which founders whatever its size: below)
        if (!P.alive || P.isBackground || P.crust.count === 0 || P.stats.cells === P.stats.continentalCells) continue;
        if (!(P.stats.continentalCells > 0)) { if (P.stats.cells >= minCells) started += founderAcross(world, P, dt, tr, tally); continue; }   // (no coast: only across)
        const { mask, type, flags, formedAt } = P.crust;
        const land = c => mask[c] && (type[c] === CrustType.CONTINENT || type[c] === CrustType.CRATON);
        // the plate's own coast — its ocean beside its continental crust — and the old part of it (no trench there yet)
        const coast = new Uint8Array(numCells), old = [];
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
        const inOld = new Uint8Array(numCells), runOf = new Int32Array(numCells).fill(-1), runs = [];
        for (const c of old) inOld[c] = 1;
        for (const s of old) {
            if (runOf[s] >= 0) continue;
            const run = [s]; runOf[s] = runs.length;
            for (let i = 0; i < run.length; i++) for (let k = adjOffset[run[i]]; k < adjOffset[run[i] + 1]; k++) { const nb = adjList[k]; if (inOld[nb] && runOf[nb] < 0) { runOf[nb] = runs.length; run.push(nb); } }
            runs.push(run);
        }
        // the ocean nearer each run than any other coast of the plate, out to the reach, through the plate's ocean only: one
        // spread from the whole coast at once, each cell taking the label of the coast cell that reaches it first (as a
        // spread from one run against the rest of the coast gives, run by run) — made when the first long run asks for it
        let label = null, takes = null;
        const spread = () => {
            label = new Int32Array(numCells); takes = runs.map(() => []);
            let ring = [];
            for (let c = 0; c < numCells; c++) if (coast[c]) { label[c] = runOf[c] >= 0 ? runOf[c] + 2 : 1; ring.push(c); }   // (1: coast in no run)
            for (let hop = 0; hop < reachHops && ring.length; hop++) {
                const next = [];
                for (const c of ring) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                    const nb = adjList[k];
                    if (label[nb] || !mask[nb] || type[nb] !== CrustType.OCEAN) continue;
                    label[nb] = label[c]; next.push(nb);
                    if (label[nb] >= 2) takes[label[nb] - 2].push(nb);
                }
                ring = next;
            }
        };
        // A SEALED sea — the plate's ocean that no way through sea leads out of (rift-partition.js exteriorSea) — founders
        // whatever its size and the length of its shore: the shortest-trench and smallest-plate rules are for a margin
        // facing open ocean, where a short stretch is a corner of a long coast and a small piece is a sliver. A sealed
        // sea's floor is all there is, cut off from any ridge: it only ages, and old enough — or squeezed — it goes down
        // beneath a shore, its chance per km of that shore as on any margin (the South Caspian floor under the Apsheron
        // sill: Jackson et al. 2002; the Japan Sea's eastern margin: Tamaki & Honza 1985; the Ionian beneath the Calabrian
        // and Hellenic arcs: Faccenna et al. 2014). A young sealed sea (a back-arc basin just closed off) is too light to.
        let seaOf = null;
        const isSealed = run => (seaOf ??= new Uint8Array(numCells), sealedSea(mesh, P.crust, run[0], seaOf));   // (a run lies in one sea)
        const before = started;
        for (const run of runs) {
            const lengthKm = run.length * edgeKm;
            let sealed = null;                                                   // (asked only where it matters)
            if (lengthKm < config.subductionInitMinLengthKm && !(sealed = isSealed(run))) { tally('short'); continue; }
            let ages = 0;
            for (const c of run) ages += time - formedAt[c];
            const ageMyr = ages / run.length;
            if (!label) spread();
            const mine = runOf[run[0]] + 2, take = takes[mine - 2];
            if (take.length < minCells && !(sealed ??= isSealed(run))) { tally('small'); continue; }
            if (!take.length) { tally('sealedEmpty'); continue; }
            // the squeeze: the plate's stress across this coast, on the ocean that would break away (compression is negative)
            const region = take.concat(run), inS = new Uint8Array(numCells), rho = netTorques(world, P);
            for (const c of region) inS[c] = 1;
            const sigma = rho ? stressAcross(rho, region, cutAlong(mesh, run, inS, land), mesh.xyz, edgeKm, P.mat) : 0;
            const urge = founderUrge(ageMyr, -sigma, config);
            let chance = config.marginFounderRatePerMyr * dt * urge * (lengthKm / config.subductionInitRateLengthKm);
            const cycle = world.cycle;
            if (cycle?.phase === 'dispersing' && ageMyr <= time - cycle.breakupAt + 1e-9) chance *= config.disperseFounderFactor;
            if (tr) { tally((sealed ? 'sealed' : '') + (urge > 0 ? 'urged' : 'weak')); tr.expected = (tr.expected ?? 0) + (urge > 0 ? chance : 0); (tr.samples ??= []).push([ageMyr, sigma, lengthKm, urge]); }
            if (!(urge > 0) || world.rngMarginFounder() >= chance) continue;
            sealed ??= isSealed(run);                                            // (for the record; before the floor leaves)
            const fresh = world.addPlate(oceanPlateName(world));
            fresh.setQuat(P.quat.slice());
            fresh.omega = P.omega.slice();                                   // it starts as it was; the torque balance takes it from there
            fresh.isOceanBorn = true;
            for (const [tip, dir] of P.wings) if (label[tip] === mine && !coast[tip]) { fresh.wings.set(tip, dir); P.wings.delete(tip); }   // (wing tips go with their half)
            if (!transferCells(world, P, fresh, take)) { fresh.alive = false; continue; }
            fresh.born = time;
            for (const c of run) P.crust.armTrench(c, config.subductionInitSlabKm);
            P.dirty = true;
            started++;
            world.log(EventKind.PLATE_BORN, `${fresh.name} is born: ${(take.length * cellAreaKm2 / 1e6).toFixed(1)} Mkm² of ${P.name}’s old ocean breaks away`, { plate: fresh.id, areaMkm2: take.length * cellAreaKm2 / 1e6 });
            world.log(EventKind.SUBDUCTION_INIT, `a new trench founders along ${lengthKm.toFixed(0)} km of ${P.name}’s ${sealed ? 'shore of a sealed sea' : 'passive margin'}: ${fresh.name}, ocean ${ageMyr.toFixed(0)} Myr old, begins to go down beneath it`,
                { upper: P.id, lower: fresh.id, lengthKm, ageMyr, stress: sigma, ...(sealed ? { sealed: true } : {}) });
            // (the plate's other runs are drawn too, in the same draw: their takes are other cells of the plate, untouched —
            // drawn every marginFounderEveryMyr, stopping at one would found fewer than drawing every step; which seas are
            // sealed is asked afresh, the plate's edge having moved)
            seaOf = null;
        }
        if (started === before) started += founderAcross(world, P, dt, tr, tally);
    }
    return started;
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
    const fresh = world.addPlate(oceanPlateName(world));
    fresh.setQuat(P.quat.slice());
    fresh.omega = P.omega.slice();                                           // it starts as it was; the torque balance takes it from there
    fresh.isOceanBorn = true;
    for (const [tip, d] of P.wings) if (inS[tip]) { fresh.wings.set(tip, d); P.wings.delete(tip); }   // (wing tips go with their half)
    if (!transferCells(world, P, fresh, best)) { fresh.alive = false; return 0; }
    fresh.born = time;
    // the trench, on the side that stays up (fresh shares P's frame: its raster cells are P's)
    const upper = farSinks ? P : fresh, lower = farSinks ? fresh : P;
    for (const c of farSinks ? nearEdge : farEdge) if (upper.crust.mask[c] && upper.crust.type[c] === CrustType.OCEAN) upper.crust.armTrench(c, config.subductionInitSlabKm);
    upper.dirty = true;
    world.log(EventKind.PLATE_BORN, `${fresh.name} is born: ${(best.length * cellAreaKm2 / 1e6).toFixed(1)} Mkm² of ${P.name}’s ocean breaks away across it`, { plate: fresh.id, areaMkm2: best.length * cellAreaKm2 / 1e6 });
    world.log(EventKind.SUBDUCTION_INIT, `${P.name} fails across its ocean${sigma < 0 ? ' under compression' : ''}: a new trench founders along ${lengthKm.toFixed(0)} km, ${lower.name}’s floor ${ageMyr.toFixed(0)} Myr old going down beneath ${upper.name}`,
        { upper: upper.id, lower: lower.id, lengthKm, ageMyr, weightMyr, stress: sigma, across: true });
    return 1;
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
