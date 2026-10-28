// Headless acceptance checks for Phase 5a (collision events: orogeny belts, shortening, suturing with redraw).
// Hard checks: the event order, the weld and the redraw's bookkeeping (shortening booked = the landmasses' real closing,
// land and cratons kept, one body), the overlap staying a seam, the pair converging on after contact and slowing over
// tens of Myr, the km² it converged taken up as overlap and absorbed at the weld, a jammed seam slowing before it welds, the belts and
// thickening being made at all (under the gravitational ceiling), the Andean belt growing with time and with the upper
// plate's trench-ward advance, the ablation. Reported against Earth: India's shortening after contact, indentation (seeds and scenes), belt widths, peak
// thickening, the Andean belt's width; and, pending the belt-strength model rewrite, how far belts reach into a craton.
// Usage: node v2/tools/check-phase5.mjs

import { check, checkAcross, report, section, finish, mean, labMesh, isLand, cellsWhere, nearestKm } from './lib/check-kit.mjs';
import { PLANET_RADIUS_KM } from '../js/core/sim-mesh.js';
import { CM_PER_YR_TO_RAD_PER_MYR } from '../js/tectonics/config.js';
import { floodFrom } from '../js/core/mesh-bfs.js';
import { FORCE_SCENES } from '../js/tectonics/scenarios/force-scenes.js';
import { simulate } from '../js/tectonics/simulate.js';
import { updatePlateMotion } from '../js/tectonics/step/torque-balance.js';
import { frameTallies } from '../js/tectonics/measure.js';
import { CrustType, CrustFlag, OrogenyType } from '../js/tectonics/model/crust.js';
import { NO_WINGS } from '../js/app/phases/phase5-collisions.js';
import { EventKind } from '../js/tectonics/model/world.js';

const SEED = 12345, SNAPSHOT_MYR = 2, MORE_SEEDS = [1, 2];       // (the Earth reports also look at a few other seeds)
// (India meets Asia at ~50 Myr and keeps converging until the seam stalls, ~55 Myr later: the scene runs on past that)
const INDIA_MYR = 130;
const mesh = labMesh(), { xyz, numCells } = mesh;

function run(id, untilMyr, overrides = {}, events = true, seed = SEED) {
    const world = FORCE_SCENES.find(s => s.id === id).build(mesh, seed);
    Object.assign(world.config, NO_WINGS, overrides);           // collisions alone: wings and arcs are Phase 5b
    // what each collision record had booked at each snapshot (its shortening so far, and its closing rate across the seam)
    const booked = [];
    const { frames, steps } = simulate(world, { untilMyr, drive: updatePlateMotion, snapshotEveryMyr: SNAPSHOT_MYR, events,
        stopAt: w => { booked.push([w.time, new Map([...w.collisions.values()].map(c => [`${c.upper}:${c.lower}`, { km: c.shorteningKm, closing: c.closingCmYr, frontKm: c.frontKm }]))]); return false; } });
    const at = t => frames.find(f => Math.abs(f.time - t) < 1e-6);
    const bookedAt = (t, rec) => booked.find(([bt]) => Math.abs(bt - t) < 1e-6)?.[1].get(`${rec.upper}:${rec.lower}`);
    return { world, frames, steps, at, bookedAt, events: world.events, sutures: world.events.filter(e => e.kind === EventKind.SUTURE), collision: frames.map(f => frameTallies(f).collision) };
}

// (the India checks that read the weld, in order: a seed whose collision never welds counts for each as the scene not forming)
const INDIA_CHECKS = [
    'after the suture there is one plate, and it stays one',
    'overlap stays a seam while the collision lasts, then closes',
    'the recorded shortening matches how far the two landmasses really closed',
    'after the cores meet the two keep converging, slowing over tens of Myr — not locked at contact',
    '…and what they converge is taken up: the area swept across the front matches the overlap the weld absorbs (km²)',
    'the redraw absorbs the overlap, plus some crust squeezed into thickness',
    'cratons survive the redraw as rigid blocks',
    'the merged continent is one connected body (island arcs excepted)',
    'a suture belt runs along the closed seam',
    'a craton thickens far less than the belt beside it',
    'crust is thickened in the belts, under the gravitational ceiling',
    'thickening spreads across the belt as a plateau, not a spike at the front',
    'no gaps in any frame',
];
section('India meets Asia');
// (the scene on three seeds — its coasts drawn from each seed's noise — and every check judged over them: lib/check-kit.mjs
// checkAcross. A seed on which India never reaches Asia, or reaches it and never welds, is a scene that did not form — the
// checks that read the collision or the weld count it and do not judge it; it fails them only on most of the seeds)
const SEEDS = [SEED, ...MORE_SEEDS], indents = [], judged = new Map(), reported = new Map();      // judged: check name → per-seed samples
const judge = (seed, name, formed, ok = false, text = '') => (judged.get(name) ?? judged.set(name, []).get(name)).push({ label: seed, formed, ok: formed && ok, text });
const keep = (name, v) => (reported.get(name) ?? reported.set(name, []).get(name)).push(v);
const india = run('india', INDIA_MYR), cfg = india.world.config;      // (seed 12345: the ablation and the other sections' config)
for (const seed of SEEDS) {
    const r = seed === SEED ? india : run('india', INDIA_MYR, {}, true, seed);
    const contact = r.events.find(e => e.kind === EventKind.COLLISION), suture = r.sutures[0];
    judge(seed, 'collision and suture events are logged in order', !!contact, suture && suture.time > contact.time, `${r.events.length} events${suture ? `, suture at ${suture.time.toFixed(0)} Myr` : contact ? ', no suture' : ', no collision'}`);
    const J = (name, ok, text) => judge(seed, name, !!suture, ok, text);
    if (!suture) {          // (the scene did not form on this seed: the checks below count it)
        for (const name of INDIA_CHECKS) judge(seed, name, false);
        continue;
    }
    indents.push(suture.data.maxIndentKm);
    const last = r.frames.at(-1), before = r.frames.filter(f => f.time < suture.time).at(-1), after = r.frames.find(f => f.time >= suture.time);
    const alive = last.plates.filter(p => p.alive && !p.isBackground);
    J(INDIA_CHECKS[0], alive.length === 1 && r.frames.filter(f => f.time >= suture.time).every(f => frameTallies(f).collision === 0),
        `${alive.map(p => p.name).join(', ')}; overlap cells from the suture on: max ${Math.max(...r.frames.filter(f => f.time >= suture.time).map(f => frameTallies(f).collision))}`);
    // (the overlap is the raster's seam between two plates' land: its width — area over the front's length — is a few cells
    // at any mesh resolution, so it is measured in cell widths)
    const rec = [...r.world.collisions.values()][0], front = rec.frontMaxKm ?? rec.frontKm, seamKm = Math.max(...r.collision) * mesh.cellAreaKm2 / front;
    J(INDIA_CHECKS[1], seamKm < 6 * mesh.edgeKm && r.collision.at(-1) === 0,
        `overlap peaked at ${Math.max(...r.collision)} cells: a seam ${seamKm.toFixed(0)} km wide along the ${front.toFixed(0)} km front (cell ${mesh.edgeKm.toFixed(0)} km)`);

    // the recorded shortening is what the two landmasses really did (their land centroids; plate centres include ocean being
    // consumed) — both over the same frames: what the record booked between them, against how far the land closed
    const landCentroid = (f, id) => {
        let x = 0, y = 0, z = 0;
        for (let w = 0; w < numCells; w++) if ((f.owner[w] === id && f.type[w] !== CrustType.OCEAN) || (f.overlap[w] === 2 && f.collider[w] === id)) { x += xyz[3 * w]; y += xyz[3 * w + 1]; z += xyz[3 * w + 2]; }
        const l = Math.hypot(x, y, z) || 1;
        return [x / l, y / l, z / l];
    };
    const landGap = f => { const a = landCentroid(f, rec.upper), b = landCentroid(f, rec.lower); return Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * PLANET_RADIUS_KM; };
    const atContact = r.at(Math.ceil(contact.time / SNAPSHOT_MYR) * SNAPSHOT_MYR), approached = landGap(atContact) - landGap(before);
    const bookedKm = (r.bookedAt(before.time, rec)?.km ?? NaN) - (r.bookedAt(atContact.time, rec)?.km ?? 0);
    J(INDIA_CHECKS[2], Math.abs(approached - bookedKm) < 0.3 * bookedKm + mesh.edgeKm,
        `land centroids closed ${approached.toFixed(0)} km between ${atContact.time} and ${before.time} Myr; the record booked ${bookedKm.toFixed(0)} km of shortening over those frames (${rec.shorteningKm.toFixed(0)} km by the weld)`);

    // after the cores meet, the two keep converging — slowing as the collision's resistance grows, not locked at contact
    // (India–Asia: 2400–3200 km since ~50 Ma, still ~4 cm/yr; Molnar & Stock 2009, van Hinsbergen et al. 2012) — and every
    // km² they converge is taken up: with the event rules alone (no underthrusting yet, Phase 7c) as overlap, which the
    // weld then absorbs into the belt. The budget, in km²: the convergence swept across the front (shortening × front,
    // step by step) against the overlap the weld found
    const series = r.frames.filter(f => f.time >= atContact.time && f.time < suture.time).map(f => [f.time, r.bookedAt(f.time, rec)]).filter(([, b]) => b);
    let sweptKm2 = 0;
    for (let i = 1; i < series.length; i++) sweptKm2 += (series[i][1].km - series[i - 1][1].km) * (series[i][1].frontKm + series[i - 1][1].frontKm) / 2;
    const overlapKm2 = frameTallies(before).collision * mesh.cellAreaKm2, closingSeries = series.map(([, b]) => b.closing);
    const peakClosing = Math.max(...closingSeries), converging = series.filter(([, b]) => b.closing > cfg.sutureStallCmYr).map(([t]) => t);
    const convergingMyr = converging.length ? converging.at(-1) - atContact.time : 0;
    J(INDIA_CHECKS[3], convergingMyr >= 20 && closingSeries.at(-1) < 0.25 * peakClosing,
        `closing across the seam ${peakClosing.toFixed(2)} cm/yr at its peak after contact, above the stall rate (${cfg.sutureStallCmYr} cm/yr) for ${convergingMyr.toFixed(0)} Myr, ${closingSeries.at(-1).toFixed(2)} cm/yr before the weld at ${suture.time.toFixed(0)} Myr`);
    J(INDIA_CHECKS[4], Math.abs(sweptKm2 - overlapKm2) < 0.35 * sweptKm2,
        `${(sweptKm2 / 1e6).toFixed(2)} Mkm² swept (shortening × front, ${atContact.time}–${before.time} Myr) against ${(overlapKm2 / 1e6).toFixed(2)} Mkm² of overlap before the weld`);
    keep('shortening', rec.shorteningKm);
    keep('shortening detail', `${seed}: ${(suture.time - contact.time).toFixed(0)} Myr after contact, India peaking at ${Math.max(...r.frames.map(f => f.plates.find(p => p.name === 'India')?.speedCmYr ?? 0)).toFixed(1)} cm/yr`);

    // the redraw. Land as seen on the map (the overlap counted once) barely changes: the overlap is absorbed and crust
    // squeezed sideways bulges the coast. What the event reports is the two plates' land summed, minus the merged land.
    const landBefore = cellsWhere(numCells, w => isLand(before, w)).length, landAfter = cellsWhere(numCells, w => isLand(after, w)).length;
    const overlapAtSuture = frameTallies(before).collision, absorbed = suture.data.landLostCells;
    // (the push ahead of the indenter compresses crust beyond the overlap too — that area goes into thickness)
    J(INDIA_CHECKS[5], Math.abs(landAfter - landBefore) < 0.04 * landBefore && absorbed >= overlapAtSuture - 12 && absorbed <= 2 * overlapAtSuture + 12,
        `map land ${landBefore} → ${landAfter} cells; event reports ${absorbed} cells absorbed, the overlap was ${overlapAtSuture}`);
    const cratonCells = f => cellsWhere(numCells, w => f.owner[w] >= 0 && f.type[w] === CrustType.CRATON).length;
    // (compared with the moment of contact: while the plates overlap, craton cells under the other plate are hidden from the map)
    J(INDIA_CHECKS[6], Math.abs(cratonCells(after) - cratonCells(atContact)) <= 0.05 * cratonCells(atContact),      // (the world view samples a rotated raster: counts wobble ±2 % frame to frame)
        `${cratonCells(atContact)} craton cells at contact, ${cratonCells(after)} after the suture`);
    // the merged land is one body with no holes that are not sea — on the merged plate's own raster, the crust itself (the
    // world view samples a moving plate's raster, and where it skips the cell that joins a narrow neck of coast to the
    // rest, the neck's tip shows as a one-cell island that comes and goes: Phase 11, at 56, 60, 68 and 100 Myr)
    const merged = r.world.plates.find(p => p.alive && !p.isBackground), K = merged.crust;
    const landMask = Uint8Array.from({ length: numCells }, (_, c) => (K.mask[c] && K.type[c] !== CrustType.OCEAN && K.type[c] !== CrustType.ARC ? 1 : 0));
    const seedCell = landMask.findIndex(v => v), body = floodFrom(mesh, seedCell, c => landMask[c] === 1);
    let stray = 0;
    for (let c = 0; c < numCells; c++) if (landMask[c] && !body[c]) stray++;
    J(INDIA_CHECKS[7], stray === 0, `${stray} non-arc land cells of ${merged.name}'s crust not connected to the main body`);

    // belts
    const seam = cellsWhere(numCells, w => isLand(last, w) && (last.flags[w] & CrustFlag.SUTURE));
    J(INDIA_CHECKS[8], seam.length * mesh.edgeKm >= front, `${seam.length} suture cells (${(seam.length * mesh.edgeKm).toFixed(0)} km of cell widths) along a ${front.toFixed(0)} km front`);
    const upperTerranes = new Set(cellsWhere(numCells, w => before.owner[w] === rec.upper && isLand(before, w)).map(w => before.terrane[w]));
    const himalayan = cellsWhere(numCells, w => isLand(last, w) && last.oroType[w] === OrogenyType.HIMALAYAN);
    const upperSide = himalayan.filter(w => upperTerranes.has(last.terrane[w])), lowerSide = himalayan.filter(w => !upperTerranes.has(last.terrane[w]));
    const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
    keep('upper', [Math.max(...upperSide.map(w => nearestKm(mesh, w, seam))), upperSide.length, median(upperSide.map(w => nearestKm(mesh, w, seam)))]);
    keep('lower', [Math.max(...lowerSide.map(w => nearestKm(mesh, w, seam))), lowerSide.length, median(lowerSide.map(w => nearestKm(mesh, w, seam)))]);
    // how far the belts reach into a craton, and how much less the shield thickens than the belt beside it: deformation per
    // unit stress scales with strength (a craton cratonStrength × as hard to deform; cratons do deform — the Laramide uplifts)
    const notCraton = cellsWhere(numCells, w => last.owner[w] >= 0 && last.type[w] !== CrustType.CRATON);
    const rimCells = cellsWhere(numCells, w => last.owner[w] >= 0 && last.type[w] === CrustType.CRATON && last.oroType[w] !== 0);
    const deepest = rimCells.length ? Math.max(...rimCells.map(w => nearestKm(mesh, w, notCraton))) : 0, thickRim = rimCells.filter(w => last.thickKm[w] > 0).length;
    const beltCells = cellsWhere(numCells, w => isLand(last, w) && last.type[w] !== CrustType.CRATON && last.oroType[w] !== 0);
    const shieldThick = mean(rimCells.map(w => last.thickKm[w])), beltThick = mean(beltCells.map(w => last.thickKm[w]));
    keep('deepest', [deepest, rimCells.length, thickRim]);
    // (a belt that never reached a shield on this seed: nothing to compare — the scene did not form for this check)
    judge(seed, INDIA_CHECKS[9], rimCells.length > 0, shieldThick <= beltThick / 2, `mean thickening ${shieldThick.toFixed(2)} km on the craton's belt cells, ${beltThick.toFixed(2)} km on the rest of the belt`);
    let maxThick = 0, thickCells = 0;
    for (let w = 0; w < numCells; w++) if (isLand(last, w) && last.thickKm[w] > 0) { thickCells++; maxThick = Math.max(maxThick, last.thickKm[w]); }
    // (gravitational potential energy caps thickening near twice normal crust: about 40–45 km of excess at most)
    J(INDIA_CHECKS[10], maxThick > 0 && maxThick < 45, `${thickCells} thickened cells, up to ${maxThick.toFixed(1)} km`);
    keep('thick', maxThick);
    let plateau = 0, inBelt = 0;
    for (let w = 0; w < numCells; w++) if (isLand(last, w) && last.oroType[w] === OrogenyType.HIMALAYAN) { inBelt++; if (last.thickKm[w] >= 0.4 * maxThick) plateau++; }
    J(INDIA_CHECKS[11], plateau / inBelt > 0.3, `${(100 * plateau / inBelt).toFixed(0)} % of collision-belt cells are at least 40 % as thick as the thickest`);
    J(INDIA_CHECKS[12], r.frames.every(f => frameTallies(f).gaps === 0), 'checked every frame');
}
for (const [name, samples] of judged) checkAcross(name, samples, name === INDIA_CHECKS[0] ? { scene: 'India meets Asia and welds' } : {});
{
    const formed = SEEDS.filter((_, i) => judged.get(INDIA_CHECKS[0])[i].formed), per = k => reported.get(k) ?? [];
    report('India: shortening across the seam after contact', per('shortening'), { earth: [2400, 3200], unit: ' km', digits: 0, source: 'India into Asia since ~50 Ma (van Hinsbergen et al. 2012; Molnar & Stock 2009)',
        detail: `until the seam stalled and welded — ${per('shortening detail').join(' · ')} (the real one ~15–18)` });
    // (pending the model's rewrite — belt width from the two sides' relative strength and the shortening, not from which
    // plate is upper: the widths are reported. Today they come from the config's belt caps, so a check would only read
    // back a hand rule; physics puts the deformation in the weaker plate, England & Houseman)
    report('collision belt width on the upper plate (the plateau)', per('upper').map(x => x[0]), { earth: [800, 1200], unit: ' km', source: 'Tibet ≈ 1000 km wide', digits: 0,
        detail: `pending model rewrite (belt width from strength); seeds ${formed.join(', ')}: ${per('upper').map(x => `${x[1]} cells, median ${x[2].toFixed(0)} km from the seam`).join(' · ')}` });
    report('collision belt width on the lower plate (the foreland)', per('lower').map(x => x[0]), { earth: [100, 350], unit: ' km', source: 'fold-thrust belts', digits: 0,
        detail: `pending model rewrite (belt width from strength); seeds ${formed.join(', ')}: ${per('lower').map(x => `${x[1]} cells, median ${x[2].toFixed(0)} km from the seam`).join(' · ')}` });
    report('deepest reach of a collision belt into a craton', per('deepest').map(x => x[0]), { unit: ' km', digits: 0, source: 'thin-skinned belts over shield edges: the sub-Andean zone 50–100 km',
        detail: `${per('deepest').map(x => `${x[1]} craton cells carry a record, ${x[2]} of them thickened`).join(' · ')} (cratonStrength ${cfg.cratonStrength})` });
    report('peak crustal thickening', per('thick'), { earth: [30, 40], unit: ' km', source: 'Tibet ≈ +35 km, Molnar & Lyon-Caen 1988', digits: 1 });

    const off = run('india', INDIA_MYR, {}, false);
    check('with the event rules off, the Phase 4 behaviour is unchanged (overlap persists, no suture)', off.sutures.length === 0 && off.collision.at(-1) > 0, `overlap at ${INDIA_MYR} Myr: ${off.collision.at(-1)} cells, ${off.events.length} events`);
}

section('self-driven Wilson cycle');
{
    // (East keeps closing on Far at ~0.5 cm/yr for ~100 Myr, pressed by its own trench, before the seam stalls. On three
    // seeds, as India: a seed whose East never welds onto Far is a scene that did not form for the checks after the weld)
    const W = new Map(), J = (seed, name, formed, ok, text) => (W.get(name) ?? W.set(name, []).get(name)).push({ label: seed, formed, ok: formed && ok, text });
    const STALL = 'a seam jammed by buoyant continent stalls — its convergence falls away — and then welds', AFTER = ['East and Far become one plate; West stays separate', 'West carries only its Andean belt', 'no gaps, overlap closed'];
    for (const seed of SEEDS) {
        const r = run('wilson', 200, {}, true, seed), suture = r.sutures[0];
        // buoyant continent does not go down, so once the two jam the seam its convergence falls away (Cloos 1993) — and then
        // the seam welds — once it has stalled: nothing else ends a collision.
        const contact = suture && r.events.find(e => e.kind === EventKind.COLLISION && e.data.upper === suture.data.upper && e.data.lower === suture.data.lower);
        const closing = contact ? r.frames.filter(f => f.time >= contact.time && f.time < suture.time).map(f => r.bookedAt(f.time, suture.data)?.closing).filter(Number.isFinite) : [];
        J(seed, STALL, true, closing.length > 2 && Math.min(...closing) < 0.5 * closing[0],
            closing.length ? `closing across the seam ${closing[0].toFixed(2)} cm/yr at contact (${contact.time.toFixed(0)} Myr), down to ${Math.min(...closing).toFixed(2)} cm/yr; welded at ${suture.time.toFixed(0)} Myr` : suture ? suture.text : 'no suture');
        if (!suture) { for (const name of AFTER) J(seed, name, false); continue; }
        indents.push(suture.data.maxIndentKm);
        const last = r.frames.at(-1), alive = last.plates.filter(p => p.alive && !p.isBackground);
        J(seed, AFTER[0], true, alive.length === 2 && alive.some(p => p.name.includes('East') && p.name.includes('Far')), alive.map(p => p.name).join(', '));
        const west = last.plates.find(p => p.name === 'West');
        const westBelt = cellsWhere(numCells, w => last.owner[w] === west.id && isLand(last, w) && last.oroType[w] && last.oroType[w] !== OrogenyType.ANDEAN && last.oroType[w] !== OrogenyType.TRANSPRESSION).length;   // (a transpression ridge where its trench turns oblique is no collision)
        J(seed, AFTER[1], true, westBelt === 0, `${westBelt} West cells with a collision record`);
        J(seed, AFTER[2], true, r.frames.every(f => frameTallies(f).gaps === 0) && r.collision.at(-1) === 0, `overlap at the end: ${r.collision.at(-1)}`);
    }
    for (const [name, samples] of W) checkAcross(name, samples, name === AFTER[0] ? { scene: 'the Wilson cycle\'s weld' } : {});
    report('indentation of the upper plate at the weld', indents, { earth: [600, 1100], unit: ' km', source: 'India into Asia: 600–750 km in and north of Tibet, ≈1050 km in the Pamir, van Hinsbergen et al. 2011', digits: 0,
        detail: `India scene, then the Wilson cycle, each on the seeds it welded of ${SEEDS.join(', ')}` });
}

section('Andean margin');
{
    const r = run('one-sided', 80), last = r.frames.at(-1), solo = last.plates.find(p => p.name === 'Solo');
    const coast = cellsWhere(numCells, w => last.owner[w] === solo.id && last.type[w] === CrustType.OCEAN && mesh.adjList.subarray(mesh.adjOffset[w], mesh.adjOffset[w + 1]).some(nb => isLand(last, nb)));
    const belt = cellsWhere(numCells, w => isLand(last, w) && last.oroType[w] === OrogenyType.ANDEAN);
    const reach = Math.max(...belt.map(w => nearestKm(mesh, w, coast)));
    const reachAt = (frame, cells) => Math.max(...cells.map(w => nearestKm(mesh, w, cellsWhere(numCells, v => frame.owner[v] === solo.id && frame.type[v] === CrustType.OCEAN && mesh.adjList.subarray(mesh.adjOffset[v], mesh.adjOffset[v + 1]).some(nb => isLand(frame, nb))))));
    const at40 = r.at(40), belt40 = cellsWhere(numCells, w => isLand(at40, w) && at40.oroType[w] === OrogenyType.ANDEAN), reach40 = reachAt(at40, belt40);
    check('the belt widens the longer subduction goes on', belt.length > 1.12 * belt40.length && reach > reach40, `${belt40.length} cells reaching ${reach40.toFixed(0)} km at 40 Myr → ${belt.length} cells reaching ${reach.toFixed(0)} km at 80 Myr`);
    // the upper plate driving at its trench is what shortens it (Heuret & Lallemand 2005; Oncken 2006 — the convergence rate
    // alone correlates poorly): Solo's velocity at its belt, toward the trench (away from its centre). Less drag, a faster
    // advance: the belt must grow with it (no factor asked)
    const advanceCmYr = (frame, plate, cells) => {
        let p = [0, 0, 0];
        for (const w of cells) for (let i = 0; i < 3; i++) p[i] += xyz[3 * w + i];
        const pl = Math.hypot(...p); p = p.map(x => x / pl);
        const c = plate.centre, cp = c[0] * p[0] + c[1] * p[1] + c[2] * p[2], out = [0, 1, 2].map(i => p[i] * cp - c[i]), ol = Math.hypot(...out) || 1;
        const o = plate.omega, v = [o[1] * p[2] - o[2] * p[1], o[2] * p[0] - o[0] * p[2], o[0] * p[1] - o[1] * p[0]];
        return (v[0] * out[0] + v[1] * out[1] + v[2] * out[2]) / ol / CM_PER_YR_TO_RAD_PER_MYR;
    };
    const fast = run('one-sided', 80, { dragContinent: cfg.dragContinent / 2, dragCraton: cfg.dragCraton / 2 }), fastLast = fast.frames.at(-1), fastSolo = fastLast.plates.find(p => p.name === 'Solo');
    const fastBelt = cellsWhere(numCells, w => isLand(fastLast, w) && fastLast.oroType[w] === OrogenyType.ANDEAN), fastReach = reachAt(fastLast, fastBelt);
    const advance = advanceCmYr(last, solo, belt), fastAdvance = advanceCmYr(fastLast, fastSolo, fastBelt);
    check('…and further the faster the upper plate advances on its trench', fastAdvance > advance && fastBelt.length > belt.length && fastReach >= reach,
        `Solo advancing on its trench at ${advance.toFixed(1)} cm/yr: ${belt.length} cells reaching ${reach.toFixed(0)} km; at ${fastAdvance.toFixed(1)} cm/yr (half the drag): ${fastBelt.length} cells reaching ${fastReach.toFixed(0)} km`);
    // the trailing coast (within ±40° of due east of the centre) must carry nothing; a slight rotation may let the rim
    // override old ocean near the tips of the trench, which is a real (small) trench and is allowed
    const centre = solo.centre, east = [-centre[1], centre[0], 0], north = [-centre[2] * centre[0], -centre[2] * centre[1], centre[0] ** 2 + centre[1] ** 2];
    const azimuth = w => Math.atan2(xyz[3 * w] * north[0] + xyz[3 * w + 1] * north[1] + xyz[3 * w + 2] * north[2], xyz[3 * w] * east[0] + xyz[3 * w + 1] * east[1]) * 180 / Math.PI;
    const eastOfCentre = belt.filter(w => Math.abs(azimuth(w)) < 40).length;
    report('Andean belt width', [reach, fastReach], { earth: [200, 700], unit: ' km', source: 'the Andes', digits: 0, detail: `inland reach from the coast at 80 Myr: Solo as built, then with half the drag (${belt.length} and ${fastBelt.length} cells)` });
    check('…and none on the trailing (passive) coast', eastOfCentre === 0, `${eastOfCentre} belt cells within ±40° of due east of the centre`);
    check('no collision records, no suture, no gaps', r.sutures.length === 0 && r.frames.every(f => frameTallies(f).gaps === 0) && cellsWhere(numCells, w => last.oroType[w] === OrogenyType.HIMALAYAN).length === 0, `${r.events.length} events`);
}

finish('Phase 5a');
