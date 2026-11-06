// The rock-volume books of one history (coast9, 2026-11-05): how much continental and arc crust each stage of a step made or
// lost (the crust ledger, step/crust-ledger.js — cells, and with crustLedgerVolume the volume), how much rock the heights wore
// off the crust, and where the rivers' load was set down (world.budget: basin and enclosed-sea fill, shelves, the trench's
// wedge, sediment subducted). Read generically: every stage the ledger names is listed, so a stage another lane adds (the crust
// lane's leak fix) shows up here without a change. Only reads: no model code is touched, nothing is turned on but the
// ledger's own switches.
import { labMesh } from './check-kit.mjs';
import { simulate } from '../../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../../js/tectonics/scenarios/terrain-scenes.js';

const GKM3 = 1e9;

/**
 * Run `myr` Myr of the supercontinent-cycle scene on `cells` sim cells with the area and volume ledgers on.
 * @returns {{cellKm2: number, myr: number, stages: Object<string, {land: number, arc: number, vol: number}>, start: {land: number, arc: number, vol: number},
 *   budget: Object<string, number>, seconds: number}}  areas in cells, volumes in cell-km (× cellKm2 → km³)
 */
export function volumeBooks({ seed = 12345, myr = 1200, cells = 20000 } = {}) {
    const mesh = labMesh(cells), scene = TERRAIN_SCENES.find(s => s.id === 'cycle'), world = scene.build(mesh, seed);
    world.config.crustLedger = true; world.config.crustLedgerVolume = true;
    const t0 = performance.now();
    simulate(world, { untilMyr: myr, snapshotEveryMyr: 100, keepFrames: false, drive: w => scene.drive(w) });
    const stages = Object.fromEntries(Object.entries(world.ledger.stages).map(([k, e]) => [k, { land: e.land, arc: e.arc, vol: e.vol ?? 0 }]));
    return { cellKm2: mesh.cellAreaKm2, myr, stages, start: world.ledger.start, budget: { ...world.budget }, seconds: (performance.now() - t0) / 1000 };
}

/** Volumes in Gkm³ per `per` Myr from a run (stage volumes × cell area; budget counters already km³). */
export function closure(r, per = 1200) {
    const s = per / r.myr, g = v => v * s / GKM3, B = r.budget;
    const stageGkm3 = Object.fromEntries(Object.entries(r.stages).map(([k, e]) => [k, g(e.vol * r.cellKm2)]));
    const worn = -(stageGkm3.heights ?? 0);               // the heights stage's net: rock worn off the crust (less the collapse that spreads a root)
    const supplied = g(B.riverSupplyKm3 ?? 0);
    // (crustfu 7f430df adds the books that close the rivers' supply: riverSupplyKm3 = basin + sea + overflow + shelf + fan + rise.
    // Read when present (the fan holds what the trench wedge and the subducted sediment were of it), absent they are the old
    // five and the rest shows as unbooked — so this runs on a tree without them and closes on one with)
    const closed = 'fanKm3' in B;
    const sinks = closed
        ? { 'basin fill (hollows)': g(B.basinFillKm3 ?? 0), 'enclosed-sea fill': g(B.seaFillKm3 ?? 0), 'enclosed-sea overflow': g(B.seaOverflowKm3 ?? 0), 'shelves': g(B.shelfKm3 ?? 0),
            'trench fans': g(B.fanKm3 ?? 0), 'continental rise': g(B.riseKm3 ?? 0) }
        : { 'basin fill (hollows)': g(B.basinFillKm3 ?? 0), 'enclosed-sea fill': g(B.seaFillKm3 ?? 0), 'shelves': g(B.shelfKm3 ?? 0),
            'trench wedge (prisms)': g(B.wedgeKm3 ?? 0), 'terrigenous sediment subducted': g(B.sedimentKm3 ?? 0) };
    const placed = Object.values(sinks).reduce((a, v) => a + v, 0);
    return { stageGkm3, worn, supplied, sinks, placed, unbooked: worn - placed, suppliedUnbooked: supplied - placed,
        cells: Object.fromEntries(Object.entries(r.stages).map(([k, e]) => [k, { land: e.land * s, arc: e.arc * s }])), per };
}

// ── the rock book (lane rockbook) ──────────────────────────────────────────────────────────────────────────────────────
// Each ledger stage's change in the rock it holds (step/crust-ledger.js rockParts, every part summed: crust, relief, fill,
// arc, sediment on the ocean floor, rock worn off and in transit) must equal the flows it booked to world.budget (km³,
// rock-book.js): STAGE_FLOWS names, per stage, each counter it may write and the sign it enters with (+1: the counter
// counts rock made; −1: rock it took away). A stage not named here may book nothing and must leave the rock as it was.
// rivers and fans are one unit: the rivers set the rock that reaches a mouth down there over the next slow steps, as a rate
// (step/trench-fans.js), so the rock between them — a slow step's worth — is the unit's only residual.
export const STAGE_FLOWS = {
    kinematics: { arcAgeingKm3: +1 },
    resolve: { riseDownKm3: -1, riseKeptKm3: -1, seaFillDownKm3: -1, seaFillKeptKm3: -1, arcRecycledKm3: +1 },
    boundaries: { beltReliefKm3: +1, beltRootKm3: +1 },
    collisions: { beltReliefKm3: +1, beltRootKm3: +1, collisionConsumedKm3: +1, collisionKeptKm3: +1, arcRecycledKm3: +1 },
    rifts: { beltReliefKm3: +1, beltRootKm3: +1 },
    arcs: { arcAddedKm3: +1 },
    arcMaturation: { arcMaturedKm3: +1 },
    'rivers+fans': { seaOverflowKm3: -1, fanKm3: -1 },
    marginIsles: { marginErodedKm3: +1, isleRaisedKm3: +1, isleMergedKm3: +1 },
    arcCollapse: { arcCollapseKm3: +1, beltReliefKm3: +1, beltRootKm3: +1 },
    heights: { fillWornKm3: +1 },
};
// (the ops several stages share — a piece moved to another plate, cells handed back to the passive ocean, ops/tidy-plates.js;
// the rivers' rock on sea floor going down a trench, step/floor-rock.js — book what they lose wherever they run)
const ANY_STAGE = { movedLostKm3: +1, givenBackLostKm3: +1, riseDownKm3: -1, riseKeptKm3: -1, seaFillDownKm3: -1, seaFillKeptKm3: -1 };
const UNITS = { rivers: 'rivers+fans', fans: 'rivers+fans' };

/**
 * Each stage's rock closure (Gkm³ over the run): its change in rock, the flows it booked (STAGE_FLOWS), and the residual —
 * rock the stage made or lost with no book. `stages` is world.ledger.stages from a run with crustLedgerVolume.
 * @returns {Object<string, {delta: number, booked: number, residual: number, gross: number, flows: Object<string, number>}>}
 */
export function rockClosure(stages, cellKm2) {
    const out = {};
    for (const [stage, e] of Object.entries(stages)) {
        if (!e.parts) continue;
        const unit = UNITS[stage] ?? stage, u = out[unit] ??= { delta: 0, booked: 0, residual: 0, gross: 0, flows: {} }, map = { ...ANY_STAGE, ...STAGE_FLOWS[unit] };
        for (const v of Object.values(e.parts)) { u.delta += v * cellKm2 / GKM3; u.gross += Math.abs(v) * cellKm2 / GKM3; }
        for (const [key, sign] of Object.entries(map)) { const v = sign * (e.budget?.[key] ?? 0) / GKM3; if (v) { u.booked += v; u.flows[key] = (u.flows[key] ?? 0) + v; } }
    }
    for (const u of Object.values(out)) u.residual = u.delta - u.booked;
    return out;
}
