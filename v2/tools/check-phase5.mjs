// Headless acceptance checks for Phase 5a (collision events: orogeny belts, shortening, suturing with redraw).
// Hard checks: the event order, the weld and the redraw's bookkeeping (shortening booked = the landmasses' real closing,
// land and cratons kept, one body), the overlap staying a seam, a jammed seam slowing before it welds, the belts and
// thickening being made at all (under the gravitational ceiling), the Andean belt growing with time and with the upper
// plate's trench-ward advance, the ablation. Reported against Earth: indentation (seeds and scenes), belt widths, peak
// thickening, the Andean belt's width; and, pending the belt-strength model rewrite, how far belts reach into a craton.
// Usage: node v2/tools/check-phase5.mjs

import { check, report, section, finish, mean, labMesh, isLand, cellsWhere, nearestKm } from './lib/check-kit.mjs';
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
const mesh = labMesh(), { xyz, numCells } = mesh;

function run(id, untilMyr, overrides = {}, events = true, seed = SEED) {
    const world = FORCE_SCENES.find(s => s.id === id).build(mesh, seed);
    Object.assign(world.config, NO_WINGS, overrides);           // collisions alone: wings and arcs are Phase 5b
    // what each collision record had booked at each snapshot (its shortening so far, and its closing rate across the seam)
    const booked = [];
    const { frames, steps } = simulate(world, { untilMyr, drive: updatePlateMotion, snapshotEveryMyr: SNAPSHOT_MYR, events,
        stopAt: w => { booked.push([w.time, new Map([...w.collisions.values()].map(c => [`${c.upper}:${c.lower}`, { km: c.shorteningKm, closing: c.closingCmYr }]))]); return false; } });
    const at = t => frames.find(f => Math.abs(f.time - t) < 1e-6);
    const bookedAt = (t, rec) => booked.find(([bt]) => Math.abs(bt - t) < 1e-6)?.[1].get(`${rec.upper}:${rec.lower}`);
    return { world, frames, steps, at, bookedAt, events: world.events, sutures: world.events.filter(e => e.kind === EventKind.SUTURE), collision: frames.map(f => frameTallies(f).collision) };
}

section('India meets Asia');
const india = run('india', 100), cfg = india.world.config, indents = [];      // (how far each weld's indenter pushed into the upper plate)
india: {
    const contact = india.events.find(e => e.kind === EventKind.COLLISION), suture = india.sutures[0];
    check('collision and suture events are logged in order', contact && suture && suture.time > contact.time,
        india.events.map(e => `${e.time.toFixed(0)} Myr ${e.kind}: ${e.text}`).join(' | '));
    if (!suture) break india;                                   // (the check above has failed; the other sections still run)
    const last = india.frames.at(-1), before = india.frames.filter(f => f.time < suture.time).at(-1), after = india.frames.find(f => f.time >= suture.time);
    const alive = last.plates.filter(p => p.alive && !p.isBackground);
    check('after the suture there is one plate, and it stays one', alive.length === 1 && india.frames.filter(f => f.time >= suture.time).every(f => frameTallies(f).collision === 0),
        `${alive.map(p => p.name).join(', ')}; overlap cells from the suture on: max ${Math.max(...india.frames.filter(f => f.time >= suture.time).map(f => frameTallies(f).collision))}`);
    // (the overlap is the raster's seam between two plates' land: its width — area over the front's length — is a few cells
    // at any mesh resolution, so it is measured in cell widths)
    const rec = [...india.world.collisions.values()][0], front = rec.frontMaxKm ?? rec.frontKm, seamKm = Math.max(...india.collision) * mesh.cellAreaKm2 / front;
    check('overlap stays a seam while the collision lasts, then closes', seamKm < 6 * mesh.edgeKm && india.collision.at(-1) === 0,
        `overlap peaked at ${Math.max(...india.collision)} cells: a seam ${seamKm.toFixed(0)} km wide along the ${front.toFixed(0)} km front (cell ${mesh.edgeKm.toFixed(0)} km)`);

    // the recorded shortening is what the two landmasses really did (their land centroids; plate centres include ocean being
    // consumed) — both over the same frames: what the record booked between them, against how far the land closed
    const landCentroid = (f, id) => {
        let x = 0, y = 0, z = 0;
        for (let w = 0; w < numCells; w++) if ((f.owner[w] === id && f.type[w] !== CrustType.OCEAN) || (f.overlap[w] === 2 && f.collider[w] === id)) { x += xyz[3 * w]; y += xyz[3 * w + 1]; z += xyz[3 * w + 2]; }
        const l = Math.hypot(x, y, z) || 1;
        return [x / l, y / l, z / l];
    };
    const landGap = f => { const a = landCentroid(f, rec.upper), b = landCentroid(f, rec.lower); return Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * PLANET_RADIUS_KM; };
    const atContact = india.at(Math.ceil(contact.time / SNAPSHOT_MYR) * SNAPSHOT_MYR), approached = landGap(atContact) - landGap(before);
    const bookedKm = (india.bookedAt(before.time, rec)?.km ?? NaN) - (india.bookedAt(atContact.time, rec)?.km ?? 0);
    check('the recorded shortening matches how far the two landmasses really closed', Math.abs(approached - bookedKm) < 0.3 * bookedKm + mesh.edgeKm,
        `land centroids closed ${approached.toFixed(0)} km between ${atContact.time} and ${before.time} Myr; the record booked ${bookedKm.toFixed(0)} km of shortening over those frames (${rec.shorteningKm.toFixed(0)} km by the weld)`);

    // the redraw. Land as seen on the map (the overlap counted once) barely changes: the overlap is absorbed and crust
    // squeezed sideways bulges the coast. What the event reports is the two plates' land summed, minus the merged land.
    const landBefore = cellsWhere(numCells, w => isLand(before, w)).length, landAfter = cellsWhere(numCells, w => isLand(after, w)).length;
    const overlapAtSuture = frameTallies(before).collision, reported = suture.data.landLostCells;
    // (the push ahead of the indenter compresses crust beyond the overlap too — that area goes into thickness)
    check('the redraw absorbs the overlap, plus some crust squeezed into thickness', Math.abs(landAfter - landBefore) < 0.04 * landBefore && reported >= overlapAtSuture - 12 && reported <= 2 * overlapAtSuture + 12,
        `map land ${landBefore} → ${landAfter} cells; event reports ${reported} cells absorbed, the overlap was ${overlapAtSuture}`);
    const cratonCells = f => cellsWhere(numCells, w => f.owner[w] >= 0 && f.type[w] === CrustType.CRATON).length;
    // (compared with the moment of contact: while the plates overlap, craton cells under the other plate are hidden from the map)
    check('cratons survive the redraw as rigid blocks', Math.abs(cratonCells(after) - cratonCells(atContact)) <= 0.05 * cratonCells(atContact),      // (the world view samples a rotated raster: counts wobble ±2 % frame to frame)
        `${cratonCells(atContact)} craton cells at contact, ${cratonCells(after)} after the suture`);
    // how far the indenter pushed into the upper plate: across seeds, and in the Wilson cycle's collision below
    indents.push(suture.data.maxIndentKm, ...MORE_SEEDS.map(seed => run('india', 100, {}, true, seed).sutures[0]?.data.maxIndentKm));
    // the merged land is one body with no holes that are not sea — on the merged plate's own raster, the crust itself (the
    // world view samples a moving plate's raster, and where it skips the cell that joins a narrow neck of coast to the
    // rest, the neck's tip shows as a one-cell island that comes and goes: Phase 11, at 56, 60, 68 and 100 Myr)
    const merged = india.world.plates.find(p => p.alive && !p.isBackground), K = merged.crust;
    const landMask = Uint8Array.from({ length: numCells }, (_, c) => (K.mask[c] && K.type[c] !== CrustType.OCEAN && K.type[c] !== CrustType.ARC ? 1 : 0));
    const seedCell = landMask.findIndex(v => v), body = floodFrom(mesh, seedCell, c => landMask[c] === 1);
    let stray = 0;
    for (let c = 0; c < numCells; c++) if (landMask[c] && !body[c]) stray++;
    check('the merged continent is one connected body (island arcs excepted)', stray === 0, `${stray} non-arc land cells of ${merged.name}'s crust not connected to the main body`);

    // belts
    const seam = cellsWhere(numCells, w => isLand(last, w) && (last.flags[w] & CrustFlag.SUTURE));
    check('a suture belt runs along the closed seam', seam.length * mesh.edgeKm >= front, `${seam.length} suture cells (${(seam.length * mesh.edgeKm).toFixed(0)} km of cell widths) along a ${front.toFixed(0)} km front`);
    const upperTerranes = new Set(cellsWhere(numCells, w => before.owner[w] === rec.upper && isLand(before, w)).map(w => before.terrane[w]));
    const himalayan = cellsWhere(numCells, w => isLand(last, w) && last.oroType[w] === OrogenyType.HIMALAYAN);
    const upperSide = himalayan.filter(w => upperTerranes.has(last.terrane[w])), lowerSide = himalayan.filter(w => !upperTerranes.has(last.terrane[w]));
    const reachUpper = Math.max(...upperSide.map(w => nearestKm(mesh, w, seam))), reachLower = Math.max(...lowerSide.map(w => nearestKm(mesh, w, seam)));
    const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
    const midUpper = median(upperSide.map(w => nearestKm(mesh, w, seam))), midLower = median(lowerSide.map(w => nearestKm(mesh, w, seam)));
    // (pending the model's rewrite — belt width from the two sides' relative strength and the shortening, not from which
    // plate is upper: the widths are reported. Today they come from the config's belt caps, so a check would only read
    // back a hand rule; physics puts the deformation in the weaker plate, England & Houseman)
    report('collision belt width on the upper plate (the plateau)', reachUpper, { earth: [800, 1200], unit: ' km', source: 'Tibet ≈ 1000 km wide', digits: 0,
        detail: `pending model rewrite (belt width from strength); ${upperSide.length} cells, median ${midUpper.toFixed(0)} km from the seam` });
    report('collision belt width on the lower plate (the foreland)', reachLower, { earth: [100, 350], unit: ' km', source: 'fold-thrust belts', digits: 0,
        detail: `pending model rewrite (belt width from strength); ${lowerSide.length} cells, median ${midLower.toFixed(0)} km from the seam` });
    // how far the belts reach into a craton, and how much less the shield thickens than the belt beside it: deformation per
    // unit stress scales with strength (a craton cratonStrength × as hard to deform; cratons do deform — the Laramide uplifts)
    const notCraton = cellsWhere(numCells, w => last.owner[w] >= 0 && last.type[w] !== CrustType.CRATON);
    const rimCells = cellsWhere(numCells, w => last.owner[w] >= 0 && last.type[w] === CrustType.CRATON && last.oroType[w] !== 0);
    const deepest = rimCells.length ? Math.max(...rimCells.map(w => nearestKm(mesh, w, notCraton))) : 0, thickRim = rimCells.filter(w => last.thickKm[w] > 0).length;
    const beltCells = cellsWhere(numCells, w => isLand(last, w) && last.type[w] !== CrustType.CRATON && last.oroType[w] !== 0);
    const shieldThick = mean(rimCells.map(w => last.thickKm[w])), beltThick = mean(beltCells.map(w => last.thickKm[w]));
    report('deepest reach of a collision belt into a craton', deepest, { unit: ' km', digits: 0, source: 'thin-skinned belts over shield edges: the sub-Andean zone 50–100 km',
        detail: `${rimCells.length} craton cells carry a record, ${thickRim} of them thickened (cratonStrength ${cfg.cratonStrength})` });
    if (rimCells.length) check('a craton thickens far less than the belt beside it', shieldThick <= beltThick / 2,
        `mean thickening ${shieldThick.toFixed(2)} km on the craton's belt cells, ${beltThick.toFixed(2)} km on the rest of the belt`);
    let maxThick = 0, thickCells = 0;
    for (let w = 0; w < numCells; w++) if (isLand(last, w) && last.thickKm[w] > 0) { thickCells++; maxThick = Math.max(maxThick, last.thickKm[w]); }
    // (gravitational potential energy caps thickening near twice normal crust: about 40–45 km of excess at most)
    check('crust is thickened in the belts, under the gravitational ceiling', maxThick > 0 && maxThick < 45, `${thickCells} thickened cells, up to ${maxThick.toFixed(1)} km`);
    report('peak crustal thickening', maxThick, { earth: [30, 40], unit: ' km', source: 'Tibet ≈ +35 km, Molnar & Lyon-Caen 1988', digits: 1 });
    let plateau = 0, inBelt = 0;
    for (let w = 0; w < numCells; w++) if (isLand(last, w) && last.oroType[w] === OrogenyType.HIMALAYAN) { inBelt++; if (last.thickKm[w] >= 0.4 * maxThick) plateau++; }
    check('thickening spreads across the belt as a plateau, not a spike at the front', plateau / inBelt > 0.3, `${(100 * plateau / inBelt).toFixed(0)} % of collision-belt cells are at least 40 % as thick as the thickest`);
    check('no gaps in any frame', india.frames.every(f => frameTallies(f).gaps === 0), 'checked every frame');

    const off = run('india', 100, {}, false);
    check('with the event rules off, the Phase 4 behaviour is unchanged (overlap persists, no suture)', off.sutures.length === 0 && off.collision.at(-1) > 0, `overlap at 100 Myr: ${off.collision.at(-1)} cells, ${off.events.length} events`);
}

section('self-driven Wilson cycle');
{
    const r = run('wilson', 160), suture = r.sutures[0];
    // buoyant continent does not go down, so once the two jam the seam its convergence falls away (Cloos 1993) — and then
    // the seam welds. (Which of the weld's rules fired — shortening, stall, time — is the model's closure, not tested.)
    const contact = suture && r.events.find(e => e.kind === EventKind.COLLISION && e.data.upper === suture.data.upper && e.data.lower === suture.data.lower);
    const closing = contact ? r.frames.filter(f => f.time >= contact.time && f.time < suture.time).map(f => r.bookedAt(f.time, suture.data)?.closing).filter(Number.isFinite) : [];
    check('a seam jammed by buoyant continent stalls — its convergence falls away — and then welds', closing.length > 2 && Math.min(...closing) < 0.5 * closing[0],
        closing.length ? `closing across the seam ${closing[0].toFixed(2)} cm/yr at contact (${contact.time.toFixed(0)} Myr), down to ${Math.min(...closing).toFixed(2)} cm/yr; welded at ${suture.time.toFixed(0)} Myr` : suture ? suture.text : 'no suture');
    if (suture) {
        indents.push(suture.data.maxIndentKm);
        const last = r.frames.at(-1), alive = last.plates.filter(p => p.alive && !p.isBackground);
        check('East and Far become one plate; West stays separate', alive.length === 2 && alive.some(p => p.name.includes('East') && p.name.includes('Far')), alive.map(p => p.name).join(', '));
        const west = last.plates.find(p => p.name === 'West');
        const westBelt = cellsWhere(numCells, w => last.owner[w] === west.id && isLand(last, w) && last.oroType[w] && last.oroType[w] !== OrogenyType.ANDEAN && last.oroType[w] !== OrogenyType.TRANSPRESSION).length;   // (a transpression ridge where its trench turns oblique is no collision)
        check('West carries only its Andean belt', westBelt === 0, `${westBelt} West cells with a collision record`);
        check('no gaps, overlap closed', r.frames.every(f => frameTallies(f).gaps === 0) && r.collision.at(-1) === 0, `overlap at the end: ${r.collision.at(-1)}`);
    }
    report('indentation of the upper plate at the weld', indents, { earth: [600, 1100], unit: ' km', source: 'India into Asia: 600–750 km in and north of Tibet, ≈1050 km in the Pamir, van Hinsbergen et al. 2011', digits: 0,
        detail: `India scene, seeds ${[SEED, ...MORE_SEEDS].join(', ')}; then the Wilson cycle` });
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
