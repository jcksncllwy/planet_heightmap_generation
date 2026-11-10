// Headless check that the world's water is conserved, frame by frame, in the history and in the terrain view (the cutoff
// lane, 2026-11-09). The books: V, the inventory (terrain-config waterInventory × Earth's ocean, 1.332e9 km³), = the world
// ocean + the seas cut off from it (+ lakes: a timeline frame stands none above sea level; ice: neither the history nor
// the view books a volume of it, so none is counted). A cut-off sea's water is the ocean's: what it loses by evaporation
// goes to the world ocean through the atmosphere, and the ocean rises by it; what stands in it, the ocean is short of.
//  · the history (tectonics/ocean/inventory.js pourOcean, from terrain/land-mask.js): every frame, all of V in the
//    ocean-connected ground, every hollow behind a sill held empty — so V is conserved across frames by construction,
//    checked here to 1e-5 (the pour's levels and ground are single-precision: worst 6.3e-6 over three seeds' whole
//    histories, 2026-11-09; a sea leaking out of the books is 1e-3 and up);
//  · the view (terrain/basin-estimate.js estimateCutOff): water stood in a cut-off sea is debited from the world ocean,
//    which falls by it (oceanFallKm) — the ocean at its lowered level + the water held = the ocean at the frame’s level,
//    to 0.001 % (the fall solved by Newton's method to a millionth of the held water);
//  · the view against the history: the view's world ocean at the frame's level against V. The two do not draw the same
//    ground — the view's synthesized shelves and slopes (terrain/synthesize.js) against the history's column per sim cell
//    — so they differ by a surface model, not by water: measured −2.6 … +2.9 % over three seeds' whole histories at 160K
//    cells (2026-11-09); a bound of 4 % at the 40K cells checked here, where it is wider (reported).
// Three seeds (the page's world: the supercontinent cycle, 30 % continent, 40 000 sim cells), every 20 Myr to 1200 Myr
// (~12 min on the gate's VM; every frame with --every 10, ~23 min: the bounds above were set on every frame), the terrain
// at 40K cells.
// Usage: node v2/tools/check-waterbooks.mjs [--every 20] [--cells 40000] [--seeds 626225,777,12345]

import { check, report, section, finish } from './lib/check-kit.mjs';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { simulateCached } from './lib/history-cache.mjs';
import { pageWorld } from './lib/moment-frame.mjs';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { FRAME_FIELDS } from '../js/terrain/terrain-pool.js';
import { terrainMesh, sampleOnto } from '../js/terrain/terrain-mesh.js';
import { terrainConfig, TERRAIN } from '../js/terrain/terrain-config.js';
import { synthesizeTerrain } from '../js/terrain/synthesize.js';
import { worldOcean } from '../js/terrain/world-ocean.js';
import { estimateCutOff } from '../js/terrain/basin-estimate.js';
import { landMask, pouredSeaOnto } from '../js/terrain/land-mask.js';
import { EARTH_OCEAN_KM3 } from '../js/tectonics/ocean/inventory.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const SEEDS = process.argv.includes('--seeds') ? process.argv[process.argv.indexOf('--seeds') + 1].split(',').map(Number) : [626225, 777, 12345], CONT = 30, SIM = 40000, MESH_SEED = 12345, UNTIL = 1200, EVERY = arg('--every', 20), CELLS = arg('--cells', 40000);
const HISTORY_TOL = 1e-5, DEBIT_TOL = 1e-5, SURFACE_TOL = 0.04;
const sim = buildSimMesh(SIM, MESH_SEED), tm = terrainMesh(CELLS), cfg = terrainConfig({}), V = cfg.waterInventory * EARTH_OCEAN_KM3;
const A = 4 * Math.PI * 6371 * 6371, simKm2 = A / sim.numCells, cellKm2 = A / tm.numCells, M = 1e6;
const scene = TERRAIN_SCENES.find(s => s.id === 'cycle');

section('the books, every frame (history and view)');
const held = [], falls = [], gaps = [];
for (const seed of SEEDS) {
    const frames = [], { world } = pageWorld({ seed, cont: CONT, sim: SIM });
    simulateCached(world, { untilMyr: UNTIL, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
        if (Math.round(f.time) % EVERY) return;
        const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]]));
        fr.plates = f.plates.map(p => p && { quat: p.quat }); fr.time = f.time; frames.push(fr);
    } }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont: CONT, sim: SIM, by: 'check-waterbooks' } });
    const sampler = sampleOnto(sim, tm, cfg, seed);
    let worstHistory = 0, worstDebit = 0, worstGap = 0, at = { h: 0, d: 0, g: 0 }, maxHeld = 0, maxAt = 0;
    for (const f of frames) {
        const t = Math.round(f.time);
        // the history: V poured into the ocean-connected ground, the hollows behind sills empty
        const out = {}, m = landMask(f, sim, cfg, out), P = out.pour, z = out.groundKm, L = m.sl.seaKm;
        let poured = 0;
        for (let w = 0; w < sim.numCells; w++) if (P.sea[w] && z[w] < L) poured += (L - z[w]) * simKm2;
        const eh = Math.abs(poured - V) / V;
        if (eh > worstHistory) { worstHistory = eh; at.h = t; }
        // the view: the ocean at its lowered level + what the cut-off seas hold = the ocean at the frame's level
        const T = synthesizeTerrain(f, sim, tm, { cfg, seed, sampler, carve: true }), h = T.heightKm, wo = worldOcean(tm, h, 0, pouredSeaOnto(f, sim, cfg, sampler));
        let ocean0 = 0;
        for (let c = 0; c < tm.numCells; c++) if (wo.ocean[c]) ocean0 -= h[c] * cellKm2;
        const W = estimateCutOff(tm, h, wo, TERRAIN, 0), d = W.oceanFallKm;
        let oceanD = 0;
        for (let c = 0; c < tm.numCells; c++) if (wo.ocean[c] && h[c] < -d) oceanD += (-d - h[c]) * cellKm2;
        // (the view's water against V: its world ocean, and the history's water it stands in seas the history part-fills)
        const ed = Math.abs(oceanD + W.heldKm3 - ocean0) / ocean0, eg = (ocean0 + W.givenKm3 - V) / V;
        if (ed > worstDebit) { worstDebit = ed; at.d = t; }
        if (Math.abs(eg) > Math.abs(worstGap)) { worstGap = eg; at.g = t; }
        if (W.heldKm3 > maxHeld) { maxHeld = W.heldKm3; maxAt = t; }
        held.push(W.heldKm3 / M); falls.push(1000 * d); gaps.push(100 * eg);
    }
    check(`seed ${seed}: the history pours all its water every frame (world ocean = V, hollows behind sills empty), to ${HISTORY_TOL}`, worstHistory <= HISTORY_TOL,
        `${frames.length} frames; worst ${worstHistory.toExponential(1)} at ${at.h} Myr`);
    check(`seed ${seed}: the view debits the world ocean for what its cut-off seas hold (lowered ocean + held = ocean), to ${100 * DEBIT_TOL} %`, worstDebit <= DEBIT_TOL,
        `worst ${(100 * worstDebit).toFixed(4)} % at ${at.d} Myr; most held ${(maxHeld / M).toFixed(2)} Mkm³ at ${maxAt} Myr`);
    check(`seed ${seed}: the view's world ocean against the history's V, within the surface models' ${100 * SURFACE_TOL} %`, Math.abs(worstGap) <= SURFACE_TOL,
        `worst ${(100 * worstGap).toFixed(2)} % at ${at.g} Myr (the view's ground, not its water: see the header)`);
}
// the history's water, where the view's ground closes a seaway the history keeps (831576, the page's 41 % continent, at
// 290 Myr: Jackson's report, 2026-11-10 — the history pins its level at a +128 m sill and pours ~100 Mkm³ over it into a
// basin of 36 Mkm²; the view's ground, its sill tens of metres higher, cut it off and dried it on the zonal climate, its
// world ocean −6.4 % of V). With the history's poured sea (world-ocean.js, basin-estimate.js standPoured) the view stands
// that water; without it (the mutation: no history) this fails.
section('the history\'s water, where the view closes a seaway it keeps (831576, 41 % continent, 290 Myr)');
{
    const seed = 831576, cont = 41, t = 290, heights = { waterInventory: 1 }, cfg41 = terrainConfig(heights), { world } = pageWorld({ seed, cont, sim: SIM, heights });
    let fr = null;
    simulateCached(world, { untilMyr: t, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
        if (Math.round(f.time) !== t) return;
        fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]])); fr.plates = f.plates.map(p => p && { quat: p.quat }); fr.time = f.time;
    } }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim: SIM, by: 'check-waterbooks' } });
    const tm160 = terrainMesh(160000), a160 = A / tm160.numCells, sampler = sampleOnto(sim, tm160, cfg41, seed);
    const h = synthesizeTerrain(fr, sim, tm160, { cfg: cfg41, seed, sampler, carve: true }).heightKm, V41 = cfg41.waterInventory * EARTH_OCEAN_KM3;
    const gapOf = history => {
        const wo = worldOcean(tm160, h, 0, history), W = estimateCutOff(tm160, h, wo, TERRAIN, 0);
        let o = 0;
        for (let c = 0; c < tm160.numCells; c++) if (wo.ocean[c]) o -= h[c] * a160;
        return { gap: (o + W.givenKm3 - V41) / V41, given: W.givenKm3 };
    };
    const off = gapOf(null), on = gapOf(pouredSeaOnto(fr, sim, cfg41, sampler));
    check(`the view's water within ${100 * SURFACE_TOL} % of V with the history's poured sea`, Math.abs(on.gap) <= SURFACE_TOL,
        `${(100 * on.gap).toFixed(2)} % (${(on.given / M).toFixed(1)} Mkm³ stood where the history pours it); the ground alone: ${(100 * off.gap).toFixed(2)} %`);
}

const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
report('water held in cut-off seas, per frame (median · 95th pct · max)', [q(held, 0.5), q(held, 0.95), Math.max(...held)], { unit: ' Mkm³', source: 'the view’s zonal balance; Earth today: the Caspian 0.078 Mkm³' });
report('the world ocean’s fall for it (median · 95th pct · max)', [q(falls, 0.5), q(falls, 0.95), Math.max(...falls)], { unit: ' m', digits: 1 });
report('the view’s world ocean against V (min · median · max)', [Math.min(...gaps), q(gaps, 0.5), Math.max(...gaps)], { unit: ' %' });
finish('waterbooks');
