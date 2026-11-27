// Headless acceptance checks for Phase 7c (the crust budget: erosive margins, underthrusting, arc recycling).
// Hard checks: an erosive coast retreats, never faster than its configured rate; accretionary stretches build islands;
// with every margin accretionary nothing is eaten; India welds to Asia, its land slides under and Asia's crust thickens
// for it; a collision makes no land; small arcs go down with their slab; each sink switched off consumes nothing; all
// three sinks work in a whole history; land never runs away; no gaps. (The 1000 Myr time is reported, with the step count, not held.)
// Reported against Earth: the erosive share of active coast and its retreat rate, the plateau's thickening, docked arc
// sizes, and the net growth of continental crust (from the crust ledger) and how much land changes after assembly.
// Usage: node v2/tools/check-phase7c.mjs

import { check, checkWeldAcross, pairFate, report, section, finish, labMesh, isLand, countWhere, nearestFrame, relativeCmYr } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { BUDGET_SCENES } from '../js/tectonics/scenarios/budget-scenes.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { frameTallies, Margin } from '../js/tectonics/measure.js';
import { CrustFlag, CrustType } from '../js/tectonics/model/crust.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { arcFloats } from '../js/tectonics/step/polarity.js';
import { indiaAsiaPair } from './lib/india-pair.mjs';
import { TERRAIN } from '../js/terrain/terrain-config.js';

const SEED = 12345, SNAPSHOT_MYR = 2;
const mesh = labMesh(), { numCells, cellAreaKm2 } = mesh;
const Mkm2 = cells => cells * cellAreaKm2 / 1e6;

async function run(id, overrides = {}, untilMyr = null) {
    const scene = BUDGET_SCENES.find(s => s.id === id), world = scene.build(mesh, SEED);
    Object.assign(world.config, overrides);
    const started = performance.now();
    const { frames, steps } = await simulate(world, { untilMyr: untilMyr ?? scene.maxMyr, drive: w => scene.drive(w), snapshotEveryMyr: SNAPSHOT_MYR });
    return { world, frames, steps, last: frames.at(-1), seconds: (performance.now() - started) / 1000, events: world.events, budget: world.budget };
}
const land = f => countWhere(numCells, w => isLand(f, w));

section('erosive and accretionary margins');
{
    const r = await run('erosion'), off = await run('erosion', { marginErosionKmPerMyr: 0 });
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
    const r = await run('india'), off = await run('india', { underthrustShare: 0 });
    // (the India–Asia pair: India's neighbours collide too, with Asia and with India — lib/india-pair.mjs, ruling (A), lane
    // gpelock 2026-11-25 — so the weld, the contact, the rates, the land and the thickening here are the pair's)
    const pairOf = x => indiaAsiaPair(x.frames[0], x.events, mesh, x.world), P = pairOf(r), suture = P.suture;
    // (reaching Asia is the collision; the weld is judged only where the pair has stopped — a pair welds only once stalled, and
    // India–Asia, ~50 Myr after contact, still converges (Molnar & Stock 2009): unwelded and still converging at the scene's end
    // is reported, not failed. A pair lost without a weld — India docked onto a third plate, main 46cc919 — is a failure.
    // Lane stackweld, sessrumnir's ruling 2026-11-27)
    check('India reaches Asia', !!P.contact, P.contact ? `${P.contact.text.slice(0, 80)} at ${P.contact.time.toFixed(0)} Myr` : 'no collision');
    {
        const fate = pairFate(r.world, { suture, rec: P.rec });
        checkWeldAcross('…and they weld once they stop', [{ label: SEED, stopped: fate.stopped || fate.lost, ok: !!suture, text: suture ? suture.text.slice(0, 120) : fate.state, state: fate.state }]);
    }
    // India slows on contact: the belt's resistance is a friction bounded by the thickened column's GPE per metre of front
    // (torque-balance.js lockContacts; Copley, Avouac & Royer 2010: Tibet's thickening, ~5–6 × 10¹² N/m, slowed India
    // from ~15 to ~4 cm/yr over 50–35 Ma). Judged here, with every event on — the belt thickens and India's land goes under
    // — not on Phase 4's forces-only scenes, where nothing thickens and the plate's flank slabs keep pulling past the bound
    // (retired there, lane gpelock 2026-11-25). The India–Asia closing rate (their relative motion at India's centre): its
    // peak in the 10 Myr before contact, against its mean 15–25 Myr after
    {
        const contact = P.contact?.time;
        const rate = f => { const a = f.plates.find(p => P.indiaIds.has(p.id) && p.alive), b = f.plates.find(p => P.asiaIds.has(p.id) && p.alive); return a && b && a !== b ? relativeCmYr(a, b) : NaN; };
        const over = (t0, t1) => r.frames.filter(f => f.time >= t0 && f.time <= t1 && (!suture || f.time < suture.time)).map(rate).filter(Number.isFinite);
        const before = contact != null ? Math.max(...over(contact - 10, contact)) : NaN, afterRates = contact != null ? over(contact + 15, contact + 25) : [];
        const after = afterRates.length ? afterRates.reduce((s, v) => s + v, 0) / afterRates.length : NaN;
        check('India slows on contact, still converging: 15–25 Myr on, under 0.65× its approach and above the stall rate', after < 0.65 * before && after > r.world.config.sutureStallCmYr,
            `contact at ${contact?.toFixed(0)} Myr: ${before.toFixed(1)} cm/yr approaching (peak, 10 Myr before) → ${after.toFixed(1)} cm/yr (mean, 15–25 Myr after; the stall rate ${r.world.config.sutureStallCmYr})`);
        // (part of India's drop was the end of an acceleration — a plume head, van Hinsbergen et al. 2011 — which the scene does not have)
        report('India: closing 15–25 Myr after contact ÷ approach before', after / before, { earth: [0.25, 0.35], source: 'India–Asia ~15 → ~4 cm/yr over 50–35 Ma (Copley, Avouac & Royer 2010)', digits: 2 });
    }
    const under = P.rec?.underthrustCells ?? 0;
    check('as they converge, India’s land in the overlap slides under Asia', under >= 5, `${under} cells (${Mkm2(under).toFixed(2)} Mkm²) consumed`);
    const maxThick = (f, Q = P) => { const ours = Q.beltScope(f); let m = 0; for (let w = 0; w < numCells; w++) if (isLand(f, w) && ours(w)) m = Math.max(m, f.thickKm[w]); return m; };
    // (by the thickened crust's volume, not its thickest cell: under collisionVolume every consumed column is laid ring by
    // ring up to the ceiling, underthrustMaxThickKm, with or without underthrusting — the weld's overlap fills it too — so the
    // thickest cell stands at the ceiling in both runs (40.0 vs 40.0 km) and the maximum says nothing; what India's
    // underthrust land adds is crust, so it shows as volume. Lane crust)
    const thickVol = (f, Q = P) => { const ours = Q.beltScope(f); let v = 0; for (let w = 0; w < numCells; w++) if (isLand(f, w) && ours(w)) v += Math.max(0, f.thickKm[w]) * cellAreaKm2; return v / 1e6; };
    // (judged with the history's rivers off: their sediment budget adds 26–50 Mkm³ of thickened land to this measure, 3–5×
    // what India's underthrust land adds (+8.9 Mkm³ with the rivers off), and its sign with and without underthrusting follows
    // the erosion's path, not the process: the erosion's m 0.25 → 0.45 flipped it, 3 of 3 paths. With the rivers off the two
    // runs differ only by underthrusting. The delta with erosion on is reported below. Erosionfix M3, sessrumnir's ruling)
    const dry = { heights: { ...TERRAIN, riverEveryMyr: 1e9 } };
    const rd = await run('india', dry), offd = await run('india', { ...dry, underthrustShare: 0 });
    check('Asia’s crust above it thickens — a plateau to come', thickVol(rd.last, pairOf(rd)) > thickVol(offd.last, pairOf(offd)), `thickened crust ${thickVol(rd.last, pairOf(rd)).toFixed(1)} Mkm³ above normal (without underthrusting: ${thickVol(offd.last, pairOf(offd)).toFixed(1)}), the history's rivers off; thickest ${maxThick(rd.last, pairOf(rd)).toFixed(1)} km (${maxThick(offd.last, pairOf(offd)).toFixed(1)})`);
    report('…with the rivers on: thickened crust with underthrusting less without (erosion\'s sediment included)', thickVol(r.last) - thickVol(off.last, pairOf(off)), { unit: ' Mkm³', digits: 1,
        detail: `${thickVol(r.last).toFixed(1)} against ${thickVol(off.last, pairOf(off)).toFixed(1)} Mkm³; the rivers' sediment adds to both, and which gains more follows the erosion's path` });
    report('thickest crust above normal over the underthrust land', maxThick(r.last), { earth: [25, 40], unit: ' km', digits: 1, source: 'Tibet ~60–80 km, about twice normal (Owens & Zandt 1997)' });
    if (suture) {
        const before = nearestFrame(r.frames, suture.time - 10), after = nearestFrame(r.frames, suture.time + 4);
        const pairLand = f => countWhere(numCells, w => isLand(f, w) && P.ours(f, w));       // (the pair's: not a neighbour's)
        check('the collision makes no land', pairLand(after) <= pairLand(before) + 0.01 * pairLand(before), `${pairLand(before)} land cells 10 Myr before the weld, ${pairLand(after)} just after`);
    }
    check('with underthrusting off, nothing is consumed', off.budget.underthrustCells === 0, `${off.budget.underthrustCells} cells`);
}

section('heavy arcs go down, buoyant arcs accrete');
{
    const r = await run('arcs'), off = await run('arcs', { arcRecycling: false });
    const recycled = r.events.filter(e => e.kind === EventKind.ARC_RECYCLED);
    // (two continents close with island arcs on their facing margins, each fed by the trench in front of it until the ocean
    // between is gone: a live arc's column floats (measure.js arcBuoyancyKm), so none goes down — Izu–Bonin–Mariana and Tonga
    // are young and stay up; Cloos 1993. The arcs left behind in the back-arc go quiet and turn heavy, but they meet no trench
    // here: where they do, over a whole history, see 'the budget over 1000 Myr'. Was: small pieces go down, by a 17 km
    // threshold that sent live 11–12 km arcs down whole — lane contarea)
    const live = [], heavy = [];
    for (const p of r.world.plates) if (p.alive && p.crust) for (let c = 0; c < p.crust.type.length; c++)
        if (p.crust.mask[c] && p.crust.type[c] === CrustType.ARC && p.crust.arcKm[c] > 0) (arcFloats(p.crust, c, r.world) ? live : heavy).push(c);
    // (judged: no arc its trench fed within the slab's fade time, founderSlabMyr, goes down on its own column —
    // world.budget.recycledFedCells, booked in collision.js sinkArc; a fed cell dragged down in a heavy chain's front is booked apart. Until lane startsea (2026-11-27) every recycled arc cell failed it; A2's relict ocean is
    // younger than the 150 Myr it replaced, its slab pulls less (slabPullAgeRefMyr), Westland slows from ~4 to ~1 cm/yr, and
    // the arcs it starves go quiet, turn heavy and sink — the section's own physics, so those are reported, not judged)
    const fed = r.budget.recycledFedCells ?? 0, dragged = r.budget.recycledDraggedFedCells ?? 0, starved = r.budget.recycledCells - fed - dragged;
    const speedsAt = t => { const f = nearestFrame(r.frames, t); return f.plates.filter(p => p.alive && !p.isBackground && p.speedCmYr > 0).map(p => `${p.name} ${p.speedCmYr.toFixed(1)}`).join(', '); };
    check('arcs fed by their slab float: none goes down at the closing margin', fed === 0 && live.length > 0,
        `${Mkm2(fed).toFixed(2)} Mkm² of arc fed within ${r.world.config.founderSlabMyr} Myr recycled (${recycled.length} pieces worth naming in all); at ${r.last.time} Myr ${Mkm2(live.length).toFixed(2)} Mkm² of arc floats, ${Mkm2(heavy.length).toFixed(2)} Mkm² gone quiet and heavy behind it`);
    report('starved arcs gone down (quiet past the slab\'s fade time, turned heavy)', Mkm2(starved), { unit: ' Mkm²', digits: 2, source: 'no Earth figure: the scene\'s',
        detail: `and ${Mkm2(dragged).toFixed(2)} Mkm² of fed arc dragged down in a heavy chain's front (collision.js: the chain is judged by its mean column); plate speeds (cm/yr) at 60 Myr: ${speedsAt(60)}; at 120 Myr: ${speedsAt(120)}; at ${r.last.time} Myr: ${speedsAt(r.last.time)}` });
    // …and the judge still catches what it was written for (a rule sending live arcs down: lane contarea's 17 km threshold): an
    // ocean crust planted heavier than the mantle (oceanCrustRho 3400 kg/m³) makes a young arc's column sink while its trench feeds it
    const planted = await run('arcs', { heights: { ...TERRAIN, oceanCrustRho: 3400 } }, 80);
    check('…a fed arc planted heavy does go down, and is caught', (planted.budget.recycledFedCells ?? 0) > 0,
        `oceanCrustRho 3400: ${Mkm2(planted.budget.recycledFedCells ?? 0).toFixed(2)} Mkm² of fed arc recycled in 80 Myr (${Mkm2(planted.budget.recycledCells).toFixed(2)} in all)`);
    const docked = r.events.filter(e => e.kind === EventKind.DOCK && e.data.arc);
    // (an arc docks whole once its column floats — its crust against its mantle lid's cold, measure.js arcBuoyancyKm, Cloos 1993;
    // heavier, it goes down with its slab, its light crust scraped onto the upper plate)
    report('smallest arc that docks whole', docked.length ? Math.min(...docked.map(e => e.data.areaMkm2 * 1e6)) : NaN, { unit: ' km²', digits: 0, source: 'on Earth set by thickness, not area (Cloos 1993)',
        detail: `${docked.length} arc dockings: ${docked.map(e => `${(e.data.areaMkm2 * 1000).toFixed(0)}k km²`).join(', ') || 'none'}; an arc docks whole once its column floats; scraped onto upper plates ${((r.budget.arcScrapedKm3 ?? 0) / -1e6).toFixed(2)} Mkm³` });
    check('with recycling off, every scrap accretes', off.budget.recycledCells === 0 && !off.events.some(e => e.kind === EventKind.ARC_RECYCLED), `recycling off: ${off.budget.recycledCells} cells recycled`);
}

section('the budget over 1000 Myr');
{
    const r = await run('history', { crustLedger: true }, 1000), at = t => land(nearestFrame(r.frames, t));
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
    // (a heavy arc — gone quiet, its lid cooled, polarity.js arcFloats — goes down a trench, and the light share of the crust
    // it grew, (ρm − ρarc)/(ρm − ρcc) ≈ 0.70 by the model's densities (measure.js arcScrapedShare), is scraped onto the upper
    // plate's prism; lane contarea)
    check('arcs gone heavy go down a trench, their light crust scraped onto the upper plate', b.recycledCells > 0 && (b.arcScrapedKm3 ?? 0) < 0,
        `${Mkm2(b.recycledCells).toFixed(2)} Mkm² of arc down; ${((b.arcScrapedKm3 ?? 0) / -1e6).toFixed(2)} Mkm³ scraped onto upper plates, ${((b.arcRecycledKm3 ?? 0) / -1e6).toFixed(2)} Mkm³ into the mantle (with the 7 km of ocean crust under each arc)`);
    check('no gaps', r.frames.every(f => frameTallies(f).gaps === 0), 'every frame');
    // (audit 2026-10-30: was a hard check, 1000 Myr under two minutes. A wall clock on a shared machine, set 09-25, and it timed a
    // run no user makes: the ledger on, at the single-mechanism scenes' fine pace. Saved runs of that range 176–498 s with the load.
    // 40K cells, seed 12345: 191 s as it was run, 157 s with the ledger off, 116 s at the whole-planet pace the lab and Evolution
    // use. Speed belongs to timing runs on a quiet machine (SIM_REMOTE=0), not a pass/fail on any machine. Reported: the wall
    // time of the run users make, and the step count, which is deterministic and tracks the work done)
    const user = TERRAIN_SCENES.find(x => x.id === 'history'), uw = user.build(mesh, SEED), started = performance.now();
    const { steps: userSteps } = await simulate(uw, { untilMyr: 1000, drive: w => user.drive(w), snapshotEveryMyr: 50, keepFrames: false });
    report('1000 Myr wall time, whole-planet pace, ledger off', (performance.now() - started) / 1000, { unit: ' s', digits: 0, source: 'no Earth figure: the time a user\'s history takes on this machine under whatever else is running; the step count below is the deterministic measure',
        detail: `${userSteps} steps; the run above (ledger on, fine pace) took ${r.seconds.toFixed(0)} s in ${r.steps} steps` });
    report('1000 Myr steps, whole-planet pace', userSteps, { digits: 0, source: 'no Earth figure: a deterministic count of the work a whole history takes (983 on 12345 at 40K cells, 2026-10-30)' });
}

finish('Phase 7c');
