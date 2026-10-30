// Headless acceptance checks for Phase 7c (the crust budget: erosive margins, underthrusting, arc recycling).
// Hard checks: an erosive coast retreats, never faster than its configured rate; accretionary stretches build islands;
// with every margin accretionary nothing is eaten; India welds to Asia, its land slides under and Asia's crust thickens
// for it; a collision makes no land; small arcs go down with their slab; each sink switched off consumes nothing; all
// three sinks work in a whole history; land never runs away; no gaps. (The 1000 Myr time is reported, with the step count, not held.)
// Reported against Earth: the erosive share of active coast and its retreat rate, the plateau's thickening, docked arc
// sizes, and the net growth of continental crust (from the crust ledger) and how much land changes after assembly.
// Usage: node v2/tools/check-phase7c.mjs

import { check, report, section, finish, labMesh, isLand, countWhere, nearestFrame } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { BUDGET_SCENES } from '../js/tectonics/scenarios/budget-scenes.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { frameTallies, Margin } from '../js/tectonics/measure.js';
import { CrustFlag } from '../js/tectonics/model/crust.js';
import { EventKind } from '../js/tectonics/model/world.js';

const SEED = 12345, SNAPSHOT_MYR = 2;
const mesh = labMesh(), { numCells, cellAreaKm2 } = mesh;
const Mkm2 = cells => cells * cellAreaKm2 / 1e6;

function run(id, overrides = {}, untilMyr = null) {
    const scene = BUDGET_SCENES.find(s => s.id === id), world = scene.build(mesh, SEED);
    Object.assign(world.config, overrides);
    const started = performance.now();
    const { frames, steps } = simulate(world, { untilMyr: untilMyr ?? scene.maxMyr, drive: w => scene.drive(w), snapshotEveryMyr: SNAPSHOT_MYR });
    return { world, frames, steps, last: frames.at(-1), seconds: (performance.now() - started) / 1000, events: world.events, budget: world.budget };
}
const land = f => countWhere(numCells, w => isLand(f, w));

section('erosive and accretionary margins');
{
    const r = run('erosion'), off = run('erosion', { marginErosionKmPerMyr: 0 });
    let erosive = 0, accretionary = 0;
    for (const f of r.frames) for (let w = 0; w < numCells; w++) if ((f.margin[w] & Margin.TYPE) === Margin.ACTIVE) { if (f.margin[w] & Margin.EROSIVE) erosive++; else accretionary++; }
    const share = erosive / Math.max(1, erosive + accretionary);
    // (a stretch is erosive where its convergence is fast or its trench is starved of sediment — Clift & Vannucchi 2004)
    // (one margin, driven fast in the north and slowly in the south — the scene's setting: erosive and accretionary stretches
    // by design; Earth's share is reported over a whole history below)
    report('share of active coast that is erosive, this scene', 100 * share, { unit: ' %', digits: 0, source: 'one margin driven to have both kinds: no Earth figure (Earth’s share in the whole history below)', detail: `of active-coast cell-frames (erosive above ${r.world.config.erosiveConvergenceCmYr} cm/yr or under ${r.world.config.accretionSedimentKm} km of trench sediment)` });
    // how fast it retreats: the land eaten, per km of erosive TRENCH, per Myr — the length the retreat is set along
    // (world.budget.erosiveTrenchKmMyr, km × Myr; was per km of erosive coast read off the frames, which counted coasts by
    // the flag of whatever trench cell lay offshore) — cut short once a coast lies marginErosionMaxGapKm from its trench,
    // so at most the configured rate
    const erodedKm2 = r.budget.erodedCells * cellAreaKm2, retreat = erodedKm2 / Math.max(1, r.budget.erosiveTrenchKmMyr ?? 0);
    const erosiveKm = (r.budget.erosiveTrenchKmMyr ?? 0) / r.last.time, cap = r.world.config.marginErosionKmPerMyr;
    check('an erosive coast retreats: its land turns to fore-arc sea, never faster than its configured rate', erodedKm2 > 0 && retreat <= 1.25 * cap,
        `${Mkm2(r.budget.erodedCells).toFixed(2)} Mkm² of coast eaten in ${r.last.time} Myr along ~${erosiveKm.toFixed(0)} km of erosive trench on average: ${retreat.toFixed(2)} km/Myr (configured ${cap})`);
    report('retreat of an erosive coast', retreat, { earth: [1, 6], unit: ' km/Myr', digits: 2, source: 'Clift & Vannucchi 2004: ~1–3, > 6 destabilises the arc' });
    // (a fore-arc island keeps its flag after it has grown into the mainland)
    const isles = countWhere(numCells, w => r.last.owner[w] >= 0 && (r.last.flags[w] & CrustFlag.MARGIN_ISLE));
    check('the accretionary stretches still build islands', isles > 0, `${isles} cells of fore-arc island, standing or grown into the coast`);
    check('with erosion off, nothing is eaten and more land is left', off.budget.erodedCells === 0 && land(off.last) > land(r.last),
        `erosion off: ${land(off.last)} land cells at the end; on: ${land(r.last)}`);
    check('no gaps', r.frames.every(f => frameTallies(f).gaps === 0), 'every frame');
}

section('a continent slides under another (underthrusting)');
{
    const r = run('india'), off = run('india', { underthrustShare: 0 });
    const sutureOf = x => x.events.find(e => e.kind === EventKind.SUTURE);
    const suture = sutureOf(r);
    check('India reaches Asia and they weld', !!suture, suture ? suture.text.slice(0, 120) : 'no suture');
    check('as they converge, India’s land in the overlap slides under Asia', r.budget.underthrustCells >= 5, `${r.budget.underthrustCells} cells (${Mkm2(r.budget.underthrustCells).toFixed(2)} Mkm²) consumed`);
    const maxThick = f => { let m = 0; for (let w = 0; w < numCells; w++) if (isLand(f, w)) m = Math.max(m, f.thickKm[w]); return m; };
    check('Asia’s crust above it thickens — a plateau to come', maxThick(r.last) > maxThick(off.last), `thickest crust ${maxThick(r.last).toFixed(1)} km above normal (without underthrusting: ${maxThick(off.last).toFixed(1)})`);
    report('thickest crust above normal over the underthrust land', maxThick(r.last), { earth: [25, 40], unit: ' km', digits: 1, source: 'Tibet ~60–80 km, about twice normal (Owens & Zandt 1997)' });
    if (suture) {
        const before = nearestFrame(r.frames, suture.time - 10), after = nearestFrame(r.frames, suture.time + 4);
        check('the collision makes no land', land(after) <= land(before) + 0.01 * land(before), `${land(before)} land cells 10 Myr before the weld, ${land(after)} just after`);
    }
    check('with underthrusting off, nothing is consumed', off.budget.underthrustCells === 0, `${off.budget.underthrustCells} cells`);
}

section('small arcs go down, big arcs accrete');
{
    const r = run('arcs'), off = run('arcs', { arcAccreteThickKm: 0 });
    const recycled = r.events.filter(e => e.kind === EventKind.ARC_RECYCLED);
    check('small arc pieces reaching a continent go down with their slab', r.budget.recycledCells > 0, `${Mkm2(r.budget.recycledCells).toFixed(2)} Mkm² of arc recycled; ${recycled.length} pieces worth naming`);
    const docked = r.events.filter(e => e.kind === EventKind.DOCK && e.data.arc);
    // (an arc docks whole once its crust is thick enough to resist subduction, arcAccreteThickKm — Cloos 1993; thinner, it goes
    // down with its slab)
    report('smallest arc that docks whole', docked.length ? Math.min(...docked.map(e => e.data.areaMkm2 * 1e6)) : NaN, { unit: ' km²', digits: 0, source: 'on Earth set by thickness, not area (Cloos 1993)',
        detail: `${docked.length} arc dockings: ${docked.map(e => `${(e.data.areaMkm2 * 1000).toFixed(0)}k km²`).join(', ') || 'none'}; an arc docks whole from ${r.world.config.arcAccreteThickKm} km thick` });
    check('with recycling off, every scrap accretes', off.budget.recycledCells === 0 && !off.events.some(e => e.kind === EventKind.ARC_RECYCLED), `recycling off: ${off.budget.recycledCells} cells recycled`);
}

section('the budget over 1000 Myr');
{
    const r = run('history', { crustLedger: true }, 1000), at = t => land(nearestFrame(r.frames, t));
    const start = at(0), t300 = at(300), end = at(1000);
    // net growth of continental crust (continent and craton, on the plates' own rasters), from the crust ledger: what
    // each stage made or lost. Earth: near steady state since ~3 Ga — 60–80 % of today's crust by then (Dhuime et al.
    // 2012), so at most ~7–13 % of today's per Gyr since; additions roughly balance losses (Scholl & von Huene 2007)
    const L = r.world.ledger, net = Object.values(L.stages).reduce((s, e) => s + e.land, 0);
    const booked = Object.entries(L.stages).filter(([, e]) => e.land).map(([k, e]) => `${k} ${e.land > 0 ? '+' : ''}${e.land}`).join(', ');
    report('net growth of continental crust', 100 * net / L.start.land / (r.last.time / 1000), { earth: [0, 13], unit: ' %/Gyr', digits: 1, source: 'Dhuime et al. 2012: 60–80 % of today’s crust by 3 Ga',
        detail: `${L.start.land} → ${L.start.land + net} cells in ${r.last.time} Myr; by stage: ${booked}` });
    report('land after the first assembly: 1000 Myr ÷ 300 Myr', end / t300, { earth: [0.85, 1.15], digits: 2, unit: '×', source: 'freeboard roughly constant (Wise 1974)',
        detail: `land ${(100 * start / numCells).toFixed(1)} % of the planet at the start, ${(100 * t300 / numCells).toFixed(1)} % at 300 Myr, ${(100 * end / numCells).toFixed(1)} % at 1000 Myr` });
    check('land never runs away: under 60 % of the planet', r.frames.every(f => land(f) < 0.6 * numCells), `the most: ${(100 * Math.max(...r.frames.map(land)) / numCells).toFixed(1)} % of the planet`);
    const b = r.budget;
    report('share of continental-margin trench that is erosive (length × time)', 100 * (b.erosiveTrenchKmMyr ?? 0) / Math.max(1, b.marginTrenchKmMyr ?? 0), { earth: [50, 60], unit: ' %', digits: 0,
        source: '~57 % of margins (Clift & Vannucchi 2004, Rev. Geophys. 42: "57 % of the global active margins seem to be of the erosive type"; checked) — today\'s margins', detail: `erosive above ${r.world.config.erosiveConvergenceCmYr} cm/yr or under ${r.world.config.accretionSedimentKm} km of trench sediment` });
    check('all three sinks are at work in a whole history', b.erodedCells > 0 && b.underthrustCells > 0 && b.recycledCells > 0,
        `eroded ${Mkm2(b.erodedCells).toFixed(1)}, underthrust ${Mkm2(b.underthrustCells).toFixed(1)}, arcs recycled ${Mkm2(b.recycledCells).toFixed(1)} Mkm²`);
    check('no gaps', r.frames.every(f => frameTallies(f).gaps === 0), 'every frame');
    // (audit 2026-10-30: was a hard check, 1000 Myr under two minutes. A wall clock on a shared machine, set 09-25, and it timed a
    // run no user makes: the ledger on, at the single-mechanism scenes' fine pace. Saved runs of that range 176–498 s with the load.
    // 40K cells, seed 12345: 191 s as it was run, 157 s with the ledger off, 116 s at the whole-planet pace the lab and Evolution
    // use. Speed belongs to timing runs on a quiet machine (SIM_REMOTE=0), not a pass/fail on any machine. Reported: the wall
    // time of the run users make, and the step count, which is deterministic and tracks the work done)
    const user = TERRAIN_SCENES.find(x => x.id === 'history'), uw = user.build(mesh, SEED), started = performance.now();
    const { steps: userSteps } = simulate(uw, { untilMyr: 1000, drive: w => user.drive(w), snapshotEveryMyr: 50, keepFrames: false });
    report('1000 Myr wall time, whole-planet pace, ledger off', (performance.now() - started) / 1000, { unit: ' s', digits: 0, source: 'no Earth figure: the time a user\'s history takes on this machine under whatever else is running; the step count below is the deterministic measure',
        detail: `${userSteps} steps; the run above (ledger on, fine pace) took ${r.seconds.toFixed(0)} s in ${r.steps} steps` });
    report('1000 Myr steps, whole-planet pace', userSteps, { digits: 0, source: 'no Earth figure: a deterministic count of the work a whole history takes (983 on 12345 at 40K cells, 2026-10-30)' });
}

finish('Phase 7c');
