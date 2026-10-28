// Engine invariants that hold in EVERY history, whatever the phase: checked step by step through whole start-world
// histories on more than one seed, and the crust ledger — which stage of a step made or lost continental crust — over
// one history of the supercontinent cycle. Not tied to a phase — run it after any engine change. Every line is a hard
// check (bookkeeping, tiling, identity, the weld rule's own consistency) except the ledger's net change per source,
// which is reported.
// Usage: node v2/tools/check-invariants.mjs

import { check, report, section, finish, labMesh } from './lib/check-kit.mjs';
import { MARGIN_SCENES } from '../js/tectonics/scenarios/margin-scenes.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { simulate } from '../js/tectonics/simulate.js';
import { CrustRaster, CrustType, CELL_FIELDS } from '../js/tectonics/model/crust.js';
import { TECTONICS, MECHANISMS } from '../js/tectonics/config.js';

const SEEDS = [12345, 777, 592250];     // (592250: the developer saw two rift halves driven back through each other there)
const HISTORY_MYR = 600;                 // longer than a phase scene: long histories are the point (1000–2000 Myr planned)
const MAX_LAND_DROP_PER_STEP = 0.01;     // land is never deleted: a step may lose at most this share of it (belts absorb a little; a
                                         // bookkeeping bound, not "no loss ever": erosive margins and underthrusting do recycle
                                         // crust, ~2.5–3 km³/yr on Earth — the ledger below reports what the engine's recycle)
const MAX_TERRANE_IDS_PER_MYR = 3.3;     // id churn, scaled to the history's length (was 2000 ids over 600 Myr)
const CRATONS_SURVIVE_MYR = 600;         // cratons outlast this on Earth (~35 from ≥2.5 Ga, Bleeker 2003); a longer history may lose
                                         // one (the North China Craton was partly destroyed), so beyond it their survival is reported
const BIG_OVERLAP_KM2 = 1e5;       // two plates' land may overlap this much only while the two still converge (a stalled seam welds)
const mesh = labMesh();
const LEDGER_CELLS = 20000, LEDGER_MYR = 300, LEDGER_SEED = 12345;
const LAND_STAGES = ['collisions', 'marginIsles', 'sedimentSubduction', 'arcMaturation', 'tidy'];   // the only stages whose process may make or lose land

section('the crust raster and the config');
{
    const r = new CrustRaster(4);
    const arrays = Object.keys(r).filter(k => ArrayBuffer.isView(r[k]) && k !== 'mask');
    const missing = arrays.filter(k => !CELL_FIELDS.includes(k));
    check('every per-cell array of a CrustRaster is in CELL_FIELDS (so create / copyFrom / snapshot handle it)', missing.length === 0,
        missing.length ? `missing: ${missing.join(', ')}` : `${arrays.length} arrays, all listed`);
    const history = MARGIN_SCENES.find(s => s.id === 'history'), w = history.build(mesh, SEEDS[0]);
    check('each world gets its own copy of the config, nested groups included', w.config !== TECTONICS && w.config.belts !== TECTONICS.belts && w.config.belts.andean !== TECTONICS.belts.andean,
        'world.config and world.config.belts are copies');
    const unknown = Object.values(MECHANISMS).flatMap(Object.keys).filter(k => !(k in TECTONICS));
    check('every mechanism off-switch names a real config key', unknown.length === 0, unknown.length ? `unknown: ${unknown.join(', ')}` : `${Object.keys(MECHANISMS).length} mechanisms`);
}

for (const seed of SEEDS) {
    section(`a whole history, seed ${seed}`);
    const scene = MARGIN_SCENES.find(s => s.id === 'history'), world = scene.build(mesh, seed);
    const landOf = w => { let n = 0; for (const p of w.plates) if (p.alive) { const { mask, type } = p.crust; for (let c = 0; c < mask.length; c++) if (mask[c] && type[c] !== CrustType.OCEAN) n++; } return n; };
    const cratonIds = Object.keys(world.terraneLetters ?? {}).map(Number);
    let firstTerrane = 0;          // (the start world's own terranes: ids up to here are not churn)
    for (const p of world.plates) { const { mask, terrane } = p.crust; for (let c = 0; c < mask.length; c++) if (mask[c] && terrane[c] > firstTerrane) firstTerrane = terrane[c]; }
    let prevLand = landOf(world), worstDrop = 0, worstAt = 0, worstAbsorbed = 0, seenEvents = world.events.length, deadWithCrust = [], maxTerrane = 0, lostCratonAt = null;
    const overlapSince = new Map();          // plate pair → since when its land has overlapped by more than BIG_OVERLAP_KM2
    let biggestOverlap = { cells: 0 }, longestOverlap = { myr: 0 }, longestStall = { myr: 0 };
    const waitedAt = new Map();              // plate pair → when its stalled seam last waited for the sea between to close
    simulate(world, {
        untilMyr: HISTORY_MYR, snapshotEveryMyr: 50,
        drive: w => {
            scene.drive(w);
            // after the previous step's events and view rebuild:
            // (less the land the step's welds booked as absorbed into their belts — the overlap the redraw folds into
            // thickness, SUTURE data.landLostCells (ops/merge-plates.js): booked crust, not land that vanished)
            let absorbed = 0;
            for (; seenEvents < w.events.length; seenEvents++) { const e = w.events[seenEvents]; if (e.kind === 'suture') absorbed += Math.max(0, e.data?.landLostCells ?? 0); }
            const land = landOf(w), drop = (prevLand - land - absorbed) / prevLand;
            if (drop > worstDrop) { worstDrop = drop; worstAt = w.time; worstAbsorbed = absorbed; }
            prevLand = land;
            for (const p of w.plates) if (!p.alive && p.crust.count > 0 && !deadWithCrust.includes(p.name)) deadWithCrust.push(`${p.name} (${p.crust.count} cells at ${w.time.toFixed(0)} Myr)`);
            maxTerrane = Math.max(maxTerrane, w.lastTerraneId);
            // land-on-land overlap per pair of plates: never beyond the weld's own threshold, never big for long
            const pairs = new Map(), edges = new Map(), keyAt = new Map();
            for (let x = 0; x < mesh.numCells; x++) if (w.landClaims[x] > 1 && w.collider[x] >= 0) { const a = w.owner[x], b = w.collider[x], k = a < b ? `${a}:${b}` : `${b}:${a}`; pairs.set(k, (pairs.get(k) ?? 0) + 1); keyAt.set(x, k); }
            // (each overlap's outline: its cell edges against ground outside it — for an overlap with no collision record)
            for (const [x, k] of keyAt) for (let j = mesh.adjOffset[x]; j < mesh.adjOffset[x + 1]; j++) if (keyAt.get(mesh.adjList[j]) !== k) edges.set(k, (edges.get(k) ?? 0) + 1);
            for (const [k, n] of pairs) {
                // (how deep the one lies on the other: the overlap over its collision's front — Phase 11, re-baselined: an
                // area alone would call a long front's single contact row stacked)
                // (an overlap with no collision record — arc crust being scraped, a fresh rift's halves, a contact whose record
                // opens next step — is measured by its own shape: a band's mean depth is its area over half its outline; its area
                // over a minimal front made one step's 0.71 Mkm² along a 4,000 km contact 890 km deep, Phase 11)
                const rec = w.collisions.get(k), outlineKm = (edges.get(k) ?? 0) * mesh.edgeKm / Math.sqrt(3);
                const front = rec ? Math.max(rec.frontMaxKm ?? rec.frontKm, mesh.edgeKm) : Math.max(outlineKm / 2, mesh.edgeKm), depth = n * mesh.cellAreaKm2 / front;
                // (a plate rifted off this very step, from a pair in collision, carries part of the overlap before its own record opens)
                if (!rec && k.split(':').some(i => w.plates[+i].born >= w.time - w.lastDt - 1e-9)) continue;
                if (depth > (biggestOverlap.depth ?? 0)) biggestOverlap = { cells: n, depth, at: w.time, pair: k };
                if (n * mesh.cellAreaKm2 >= BIG_OVERLAP_KM2) {
                    if (!overlapSince.has(k)) overlapSince.set(k, w.time);
                    // (how long its seam has been stalled — a collision waiting, besides, for a sea it would seal to close is
                    // still converging across that sea: Phase 11's wait, not a stall)
                    const waits = rec && rec.trapKm2 > 0 && rec.trapClosingCmYr > w.config.sutureStallCmYr;
                    // (nor is a pair parting: its overlap is coming undone)
                    if (waits || (rec && rec.closingCmYr < -w.config.sutureStallCmYr)) waitedAt.set(k, w.time);
                    const stall = rec ? Math.min(rec.stalledMyr, w.time - (waitedAt.get(k) ?? -Infinity)) : 0;
                    // (a seam overlap shallower than sutureStallMinKm — the two touching along a long front — need not weld)
                    if (rec && !rec.sutured && !waits && depth >= w.config.sutureStallMinKm && stall > longestStall.myr) longestStall = { myr: stall, pair: k, at: w.time };
                }
            }
            for (const [k, since] of overlapSince) {
                if (!pairs.has(k) || pairs.get(k) * mesh.cellAreaKm2 < BIG_OVERLAP_KM2) { overlapSince.delete(k); continue; }
                if (w.time - since > longestOverlap.myr) longestOverlap = { myr: w.time - since, pair: k, since };
            }
            if (lostCratonAt === null) {
                const present = new Set();
                for (const p of w.plates) if (p.alive) { const { mask, type, terrane } = p.crust; for (let c = 0; c < mask.length; c++) if (mask[c] && type[c] === CrustType.CRATON) present.add(terrane[c]); }
                const lost = cratonIds.filter(id => !present.has(id));
                if (lost.length) lostCratonAt = `${lost.map(id => world.terraneLetters[id]).join(', ')} at ${w.time.toFixed(0)} Myr`;
            }
        },
    });
    check('land never vanishes: no step loses more than a sliver of it beyond what its welds absorb', worstDrop <= MAX_LAND_DROP_PER_STEP,
        `worst step: ${(100 * worstDrop).toFixed(2)} % of the land at ${worstAt.toFixed(1)} Myr, beyond ${worstAbsorbed} cells its welds booked as absorbed (limit ${100 * MAX_LAND_DROP_PER_STEP} %); ${landOf(world)} land cells at the end`);
    check('a plate that is gone holds no crust (nothing was welded onto a dead plate)', deadWithCrust.length === 0, deadWithCrust.join('; ') || `${world.plates.filter(p => !p.alive).length} plates gone, all empty`);
    const idsPerMyr = (maxTerrane - firstTerrane) / HISTORY_MYR;
    check('terrane ids stay few: crust keeps its id whichever plate carries it', idsPerMyr <= MAX_TERRANE_IDS_PER_MYR,
        `${maxTerrane - firstTerrane} ids handed out over ${HISTORY_MYR} Myr (${firstTerrane} at the start): ${idsPerMyr.toFixed(2)} a Myr (limit ${MAX_TERRANE_IDS_PER_MYR})`);
    check('no two plates stack land on land deeper than the weld threshold', (biggestOverlap.depth ?? 0) <= 1.5 * world.config.sutureStackKm,
        `deepest overlap ${(biggestOverlap.depth ?? 0).toFixed(0)} km over its front (${((biggestOverlap.cells ?? 0) * mesh.cellAreaKm2 / 1e6).toFixed(2)} Mkm², ${biggestOverlap.pair ?? '—'} at ${biggestOverlap.at?.toFixed(0) ?? '—'} Myr; weld at ${world.config.sutureStackKm} km)`);
    // (a collision lasts as long as its plates converge — India–Asia has for ~50 Myr — so how long an overlap lasts is
    // reported; what must hold is that a stalled one welds — unless a sea the weld would seal is still closing — within the
    // weld rule's own wait: stalled sutureStallGiveUpMyr, measured at most sutureCheckMyr apart, a step's slack)
    check('…and a big overlap lasts only while the two still converge: a stalled seam welds', longestStall.myr <= world.config.sutureStallGiveUpMyr + world.config.sutureCheckMyr + 2,
        `longest stall under an overlap over ${BIG_OVERLAP_KM2 / 1e3}k km²: ${longestStall.myr.toFixed(0)} Myr${longestStall.pair ? ` (${longestStall.pair} at ${longestStall.at.toFixed(0)} Myr)` : ''}; limit ${world.config.sutureStallGiveUpMyr + world.config.sutureCheckMyr + 2} Myr`);
    report('the longest a big overlap lasted', longestOverlap.myr, { unit: ' Myr', digits: 0, source: 'no Earth figure: India–Asia, in contact since ~50 Ma, still converges (Molnar & Stock 2009)',
        detail: `over ${BIG_OVERLAP_KM2 / 1e3}k km²${longestOverlap.pair ? `: ${longestOverlap.pair} from ${longestOverlap.since.toFixed(0)} Myr` : ''}` });
    if (HISTORY_MYR <= CRATONS_SURVIVE_MYR) check('every craton survives the whole history, with its letter', cratonIds.length > 0 && lostCratonAt === null, lostCratonAt ?? `${cratonIds.length} cratons, all present at ${world.time.toFixed(0)} Myr`);
    else report('cratons lost over the history', lostCratonAt ? lostCratonAt.split(' at ')[0].split(', ').length : 0, { earth: [0, 1], digits: 0, source: 'Archean cratons are durable, ~35 survive from ≥2.5 Ga; partial decratonization is rare (Bleeker 2003, Lithos 71; North China Craton)', detail: lostCratonAt ?? `${cratonIds.length} cratons, all present` });
}

section(`the crust ledger: ${LEDGER_MYR} Myr of the supercontinent cycle, ${LEDGER_CELLS / 1000}K cells`);
{
    // Continental crust (continent + craton) is made and lost only by named processes: collisions (underthrust −, weld
    // seams and docking +), margin isles (fore-arc islands +, erosive margins −), sediment subduction (the land the
    // trench's sediment came from −), arc maturation (arc → continent) and tidy (fragments). Every other stage of every
    // step must leave it exactly as it found it.
    const ledgerMesh = labMesh(LEDGER_CELLS), scene = TERRAIN_SCENES.find(s => s.id === 'cycle');
    const world = scene.build(ledgerMesh, LEDGER_SEED, { continentalFraction: 0.3 });
    world.config.crustLedger = true;
    const landNow = w => { let n = 0; for (const p of w.plates) if (p.alive) { const { mask, type } = p.crust; for (let c = 0; c < mask.length; c++) if (mask[c] && (type[c] === CrustType.CONTINENT || type[c] === CrustType.CRATON)) n++; } return n; };
    const landAtStart = landNow(world);
    // (the ledger sums each stage over the whole history; the drive, called once a step after the event stages, also
    // catches a forbidden stage that made land in one step and lost it in another)
    const seen = {}, offending = new Map();
    simulate(world, {
        untilMyr: LEDGER_MYR, snapshotEveryMyr: 50, keepFrames: false,
        drive: w => {
            scene.drive(w);
            for (const [stage, e] of Object.entries(w.ledger?.stages ?? {})) {
                const d = e.land - (seen[stage] ?? 0);
                seen[stage] = e.land;
                if (d !== 0 && !LAND_STAGES.includes(stage) && !offending.has(stage)) offending.set(stage, `${stage} ${d > 0 ? '+' : ''}${d} cells by ${w.time.toFixed(1)} Myr`);
            }
        },
    });
    const { stages, start } = world.ledger, landAtEnd = landNow(world);
    for (const [stage, e] of Object.entries(stages)) if (e.land !== 0 && !LAND_STAGES.includes(stage) && !offending.has(stage)) offending.set(stage, `${stage} ${e.land > 0 ? '+' : ''}${e.land} cells`);
    check('the crust ledger: no stage but collisions, margin isles, sediment subduction, arc maturation and tidy makes or loses continental crust', offending.size === 0,
        offending.size ? [...offending.values()].join('; ') : `${Object.keys(stages).length - LAND_STAGES.length} other stages booked exactly 0 cells of land in every step`);
    const booked = Object.values(stages).reduce((n, e) => n + e.land, 0);
    check('…and its books balance: the stages add up to the change in continental crust', booked === landAtEnd - landAtStart && start.land === landAtStart,
        `stages book ${booked > 0 ? '+' : ''}${booked} cells; the plates' rasters held ${landAtStart} → ${landAtEnd} (${landAtEnd - landAtStart > 0 ? '+' : ''}${landAtEnd - landAtStart}); the ledger opened on ${start.land}`);
    const matured = stages.arcMaturation?.land ?? 0;
    check('…and arc maturation gains exactly the arc cells it turned continental', matured === (world.budget.arcMaturedCells ?? 0),
        `arcMaturation booked ${matured} cells of land; world.budget.arcMaturedCells ${world.budget.arcMaturedCells ?? 0}`);
    const sunk = stages.sedimentSubduction ?? { land: 0, arc: 0 };
    check('…and sediment subduction only loses continental crust, exactly the cells it booked, and touches no arc', sunk.land === -(world.budget.sedimentCells ?? 0) && sunk.arc === 0 && (world.budget.sedimentCells ?? 0) > 0,
        `sedimentSubduction booked ${sunk.land} cells of land, ${sunk.arc} of arc; world.budget.sedimentCells ${world.budget.sedimentCells ?? 0}`);
    const B = world.budget;
    check('…and a weld or a dock makes no crust: every cell of sea it fills is paid for with a cell of its coast', (B.sealPaidCells ?? 0) === (B.sealedLandCells ?? 0) && (B.arcPaidCells ?? 0) === (B.sealedArcCells ?? 0),
        `${B.sealedLandCells ?? 0} cells of sea filled with continent at welds and docks, ${B.sealPaidCells ?? 0} of continental coast given back; ${B.sealedArcCells ?? 0} filled with arc, ${B.arcPaidCells ?? 0} of coast given back for them`);
    const per100 = cells => cells * ledgerMesh.cellAreaKm2 / 1e6 / (LEDGER_MYR / 100);
    for (const stage of LAND_STAGES) report(`net continental crust from ${stage}`, per100(stages[stage]?.land ?? 0), { unit: ' Mkm²/100 Myr', digits: 1 });
    report('net continental crust, all sources', per100(booked), { unit: ' Mkm²/100 Myr', digits: 1, source: 'Earth: near zero today — arc additions ≈ losses to subduction erosion and sediment subduction, ~3 km³/yr each (Scholl & von Huene 2009; Dhuime et al. 2012)',
        detail: `of which underthrust −${per100(world.budget.underthrustCells ?? 0).toFixed(1)}, eroded −${per100(world.budget.erodedCells ?? 0).toFixed(1)}, sediment subducted −${per100(world.budget.sedimentCells ?? 0).toFixed(1)}, sea sealed at welds +${per100(world.budget.sealedLandCells ?? 0).toFixed(1)} and paid −${per100(world.budget.sealPaidCells ?? 0).toFixed(1)}, arcs matured +${per100(world.budget.arcMaturedCells ?? 0).toFixed(1)}` });
}

finish('Invariants');
