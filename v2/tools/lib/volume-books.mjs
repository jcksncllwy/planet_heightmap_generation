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
