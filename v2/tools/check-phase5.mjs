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
import { phase5Mechanisms } from '../js/app/phases/phase5-collisions.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { cratonStrengthRatio } from '../js/tectonics/field/stress-step.js';

const SEED = 12345, SNAPSHOT_MYR = 2, MORE_SEEDS = [1, 2];       // (the Earth reports also look at a few other seeds)
// (India meets Asia at ~50 Myr and keeps converging until the seam stalls, ~55 Myr later: the scene runs on past that)
const INDIA_MYR = 130;
const mesh = labMesh(), { xyz, numCells } = mesh;

async function run(id, untilMyr, overrides = {}, events = true, seed = SEED) {
    const world = FORCE_SCENES.find(s => s.id === id).build(mesh, seed);
    Object.assign(world.config, phase5Mechanisms(id), overrides);    // collisions alone (wings and arcs are Phase 5b); India's continent goes under
    // what each collision record had booked at each snapshot (its shortening so far, and its closing rate across the seam)
    const booked = [];
    const { frames, steps } = await simulate(world, { untilMyr, drive: updatePlateMotion, snapshotEveryMyr: SNAPSHOT_MYR, events,
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
    'after the cores meet the two keep converging, slowing over tens of Myr, and weld only once the seam has stalled',
    '…and what they converge is taken up: the area swept across the front matches the overlap the weld absorbs and the land gone under (km²)',
    'the redraw absorbs the overlap, plus some crust squeezed into thickness',
    'cratons survive the redraw as rigid blocks',
    'the merged continent is one connected body (island arcs excepted)',
    'a suture belt runs along the closed seam',
    'a craton beside the belt stays thin: its interior thickens far less than the belt',
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
const india = await run('india', INDIA_MYR), cfg = india.world.config;      // (seed 12345: the ablation and the other sections' config)
for (const seed of SEEDS) {
    const r = seed === SEED ? india : await run('india', INDIA_MYR, {}, true, seed);
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
    // km² they converge is taken up: as India's land going under Asia (underthrusting, phase5Mechanisms) and as overlap, which
    // the weld then absorbs into the belt. The budget, in km²: the convergence swept across the front against the overlap the
    // weld found and the land gone under. Swept is the closing across the overlap (v·n at each of its cells, n toward the
    // upper plate's land, averaged) × the front, the front no longer than India's land is wide across the convergence: a rigid
    // body sweeps its projected width, and its flanks slide past. (Was the record's shortening × its frontKm, step by step:
    // the record's front is every overlap cell touching either plate's land, round the nose and down the flanks, 3,600–4,200 km
    // against India's 1,000–1,300 km, and its rate the closing at the overlap's centroid, so it counted 3.9–6.7 Mkm² against
    // 1.4–2.1 taken up; measured this way 2.0–2.1 swept against the same 1.4–2.1. Lane gpelock P2, p2/swept-pre.txt)
    const series = r.frames.filter(f => f.time >= atContact.time && f.time < suture.time).map(f => [f.time, r.bookedAt(f.time, rec)]).filter(([, b]) => b);
    const sweepRate = f => {                                    // km²/Myr: the mean closing over the overlap × the front as wide as India
        const U = f.plates.find(p => p.id === rec.upper), L = f.plates.find(p => p.id === rec.lower), landL = [], ov = [];
        for (let w = 0; w < numCells; w++) {
            if (f.overlap[w] === 2) ov.push(w);
            if (f.type[w] === CrustType.OCEAN && f.overlap[w] !== 2) continue;
            if (f.owner[w] === rec.lower || (f.overlap[w] === 2 && f.collider[w] === rec.lower)) landL.push(w);
        }
        if (!U || !L || !ov.length || !landL.length) return 0;
        const cU = landCentroid(f, rec.upper), cL = landCentroid(f, rec.lower);
        let ax = [cL[1] * cU[2] - cL[2] * cU[1], cL[2] * cU[0] - cL[0] * cU[2], cL[0] * cU[1] - cL[1] * cU[0]];
        const al = Math.hypot(...ax) || 1; ax = ax.map(v => v / al);
        let lo = Infinity, hi = -Infinity;
        for (const w of landL) { const sx = xyz[3 * w] * ax[0] + xyz[3 * w + 1] * ax[1] + xyz[3 * w + 2] * ax[2]; lo = Math.min(lo, sx); hi = Math.max(hi, sx); }
        const widthKm = (Math.asin(Math.min(1, hi)) - Math.asin(Math.max(-1, lo))) * PLANET_RADIUS_KM;
        const o = [0, 1, 2].map(i => L.omega[i] - U.omega[i]);
        let vn = 0;
        for (const w of ov) {
            const x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2], d = cU[0] * x + cU[1] * y + cU[2] * z;
            const n = [cU[0] - x * d, cU[1] - y * d, cU[2] - z * d], nl = Math.hypot(...n) || 1;
            vn += ((o[1] * z - o[2] * y) * n[0] + (o[2] * x - o[0] * z) * n[1] + (o[0] * y - o[1] * x) * n[2]) / nl;
        }
        return Math.max(0, vn / ov.length * PLANET_RADIUS_KM) * Math.min(r.bookedAt(f.time, rec).frontKm, widthKm);
    };
    let sweptKm2 = 0;
    for (let i = 1; i < series.length; i++) sweptKm2 += (series[i][0] - series[i - 1][0]) * (sweepRate(r.at(series[i][0])) + sweepRate(r.at(series[i - 1][0]))) / 2;
    // (…the overlap the weld absorbs, plus the land that went under Asia on the way: rec.underthrustCells, collision.js underthrust)
    const underKm2 = (rec.underthrustCells ?? 0) * mesh.cellAreaKm2, overlapKm2 = frameTallies(before).collision * mesh.cellAreaKm2 + underKm2, closingSeries = series.map(([, b]) => b.closing);
    const peakClosing = Math.max(...closingSeries), converging = series.filter(([, b]) => b.closing > cfg.sutureStallCmYr).map(([t]) => t);
    const convergingMyr = converging.length ? converging.at(-1) - atContact.time : 0;
    // (…and welded only once the seam has stalled: with India's continent going under (phase5Mechanisms) nothing stacks,
    // and on every seed the seam stalls before the weld, as all 43 of the planet's welds on 3 seeds did. The stack weld,
    // collision.js, is a guard, not the end of a collision. Lane gpelock 2026-11-25)
    const lastClosing = closingSeries.at(-1);
    J(INDIA_CHECKS[3], suture.data.why === 'stalled' && convergingMyr >= 20 && lastClosing < 0.25 * peakClosing,
        `closing across the seam ${peakClosing.toFixed(2)} cm/yr at its peak after contact, above the stall rate (${cfg.sutureStallCmYr} cm/yr) for ${convergingMyr.toFixed(0)} Myr, ${lastClosing.toFixed(2)} cm/yr before the weld at ${suture.time.toFixed(0)} Myr (${suture.data.why})`);
    J(INDIA_CHECKS[4], Math.abs(sweptKm2 - overlapKm2) < 0.35 * sweptKm2,
        `${(sweptKm2 / 1e6).toFixed(2)} Mkm² swept (closing over the overlap × the front as wide as India, ${atContact.time}–${before.time} Myr) against ${(overlapKm2 / 1e6).toFixed(2)} Mkm² taken up: overlap before the weld and ${(underKm2 / 1e6).toFixed(2)} Mkm² gone under`);
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
    // unit stress scales with strength (a craton as many times as hard to deform as its column is strong, stress-step.js cratonStrengthRatio; cratons do deform — the Laramide uplifts)
    const notCraton = cellsWhere(numCells, w => last.owner[w] >= 0 && last.type[w] !== CrustType.CRATON);
    const rimCells = cellsWhere(numCells, w => last.owner[w] >= 0 && last.type[w] === CrustType.CRATON && last.oroType[w] !== 0);
    const deepest = rimCells.length ? Math.max(...rimCells.map(w => nearestKm(mesh, w, notCraton))) : 0, thickRim = rimCells.filter(w => last.thickKm[w] > 0).length;
    const beltCells = cellsWhere(numCells, w => isLand(last, w) && last.type[w] !== CrustType.CRATON && last.oroType[w] !== 0);
    const shieldThick = mean(rimCells.map(w => last.thickKm[w])), beltThick = mean(beltCells.map(w => last.thickKm[w]));
    keep('deepest', [deepest, rimCells.length, thickRim]);
    // (a belt that never reached a shield on this seed: nothing to compare — the scene did not form for this check)
    // the block beside the belt (lane peaktail): a rim the belt reached is the belt's own — it takes its strength's share of the
    // shortening and the channel flows into it (ops/thicken.js, step/crust-flow.js), as the Longmen Shan is built on the edge of
    // the Sichuan block (Clark & Royden 2000) — so the craton is judged where the belt did not reach: its interior 1–3 cells
    // (~110–340 km at the lab mesh) from the collision belt, the Sichuan Basin's distance from the Longmen Shan front. Its
    // crust now against its kind's as formed (rootKm) against the belt's continent, ≤ half: the Sichuan and Tarim blocks'
    // crust ~40–45 km against Tibet's 65–70 (recalled, unconfirmed: receiver-function and refraction compilations) —
    // about 0–8 km of thickening against 25–35
    const BAND = 3, hop = new Int8Array(numCells).fill(-1), beltFront = [];
    for (let w = 0; w < numCells; w++) if (last.owner[w] >= 0 && last.oroType[w] === OrogenyType.HIMALAYAN) { hop[w] = 0; beltFront.push(w); }
    for (let h = 1, ring = beltFront; h <= BAND && ring.length; h++) {
        const next = [];
        for (const w of ring) for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1]; k++) { const q = mesh.adjList[k]; if (hop[q] < 0) { hop[q] = h; next.push(q); } }
        ring = next;
    }
    const inner = cellsWhere(numCells, w => hop[w] >= 1 && last.owner[w] >= 0 && last.type[w] === CrustType.CRATON && last.oroType[w] !== OrogenyType.HIMALAYAN);
    const beltLand = beltCells.filter(w => last.oroType[w] === OrogenyType.HIMALAYAN);
    const innerRoot = mean(inner.map(w => last.rootKm[w])), beltRoot = mean(beltLand.map(w => last.rootKm[w])), rimRoot = mean(rimCells.map(w => last.rootKm[w]));
    // (a belt with no craton beside it on this seed: nothing to compare — the scene did not form for this check)
    judge(seed, INDIA_CHECKS[9], inner.length > 0 && beltLand.length > 0, innerRoot <= beltRoot / 2,
        `crust thickened ${innerRoot.toFixed(2)} km (mean, against its kind's as formed) over ${inner.length} craton cells 1–${BAND} cells beyond the belt, ${beltRoot.toFixed(2)} km over the belt's ${beltLand.length} continent cells (the reached rim's ${rimCells.length}: ${rimRoot.toFixed(2)} km; its thickening record ${shieldThick.toFixed(2)} against the belt's ${beltThick.toFixed(2)})`);
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
        detail: `${per('deepest').map(x => `${x[1]} craton cells carry a record, ${x[2]} of them thickened`).join(' · ')} (craton strength ×${cratonStrengthRatio(cfg).toFixed(2)})` });
    report('peak crustal thickening', per('thick'), { earth: [30, 40], unit: ' km', source: 'Tibet ≈ +35 km, Molnar & Lyon-Caen 1988', digits: 1 });

    const off = await run('india', INDIA_MYR, {}, false);
    // (the Phase 4 behaviour: no events, and the overlap nothing takes up. It need not persist to the end: pressed on past
    // the GPE-bounded lock with nothing to break its slabs off, India crosses Asia and out the other side by ~120 Myr — was
    // 'overlap persists', under the lock that grew with the overlap. A weaker claim, accepted until slab break-off lands
    // (queued as lane slabbreak; sessrumnir's ruling, lane gpelock 2026-11-25): then 'overlap persists' should return)
    const offPeak = Math.max(...off.collision);
    check('with the event rules off, the Phase 4 behaviour is unchanged (no events, no suture; the overlap is not taken up)', off.sutures.length === 0 && off.events.length === 0 && offPeak > 0,
        `${off.events.length} events; overlap peaks at ${offPeak} cells (${off.collision.findIndex(c => c === offPeak) * SNAPSHOT_MYR} Myr), ${off.collision.at(-1)} cells at ${INDIA_MYR} Myr`);
}

section('self-driven Wilson cycle');
{
    // (East keeps closing on Far at ~0.5 cm/yr for ~100 Myr, pressed by its own trench, before the seam stalls. On three
    // seeds, as India: a seed whose East never welds onto Far is a scene that did not form for the checks after the weld)
    const W = new Map(), J = (seed, name, formed, ok, text) => (W.get(name) ?? W.set(name, []).get(name)).push({ label: seed, formed, ok: formed && ok, text });
    const STALL = 'a seam jammed by buoyant continent stalls — its convergence falls away — and then welds', AFTER = ['East and Far become one plate; West stays separate', 'West carries only its Andean belt', 'no gaps, overlap closed'];
    for (const seed of SEEDS) {
        const r = await run('wilson', 200, {}, true, seed), suture = r.sutures[0];
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
        const westBelt = cellsWhere(numCells, w => last.owner[w] === west.id && isLand(last, w) && last.oroType[w] && last.oroType[w] !== OrogenyType.ANDEAN && last.oroType[w] !== OrogenyType.ARC && last.oroType[w] !== OrogenyType.TRANSPRESSION && last.oroType[w] !== OrogenyType.RIFT).length;   // (RIFT: stretched, not a collision — the plate-stress field's diffuse extension, lane rifton)   // (a transpression ridge where its trench turns oblique is no collision)   // (ARC: its own margin's arc crust (margin isles off the Andean coast, a subduction belt): lane graded, whose history erosion feeds the trench enough to raise them)
        J(seed, AFTER[1], true, westBelt === 0, `${westBelt} West cells with a collision record`);
        J(seed, AFTER[2], true, r.frames.every(f => frameTallies(f).gaps === 0) && r.collision.at(-1) === 0, `overlap at the end: ${r.collision.at(-1)}`);
    }
    for (const [name, samples] of W) checkAcross(name, samples, name === AFTER[0] ? { scene: 'the Wilson cycle\'s weld' } : {});
    report('indentation of the upper plate at the weld', indents, { earth: [600, 1100], unit: ' km', source: 'India into Asia: 600–750 km in and north of Tibet, ≈1050 km in the Pamir, van Hinsbergen et al. 2011', digits: 0,
        detail: `India scene, then the Wilson cycle, each on the seeds it welded of ${SEEDS.join(', ')}` });
}

section('Andean margin');
{
    const r = await run('one-sided', 80), last = r.frames.at(-1), solo = last.plates.find(p => p.name === 'Solo');
    const coast = cellsWhere(numCells, w => last.owner[w] === solo.id && last.type[w] === CrustType.OCEAN && mesh.adjList.subarray(mesh.adjOffset[w], mesh.adjOffset[w + 1]).some(nb => isLand(last, nb)));
    const belt = cellsWhere(numCells, w => isLand(last, w) && last.oroType[w] === OrogenyType.ANDEAN);
    const reach = Math.max(...belt.map(w => nearestKm(mesh, w, coast)));
    const reachAt = (frame, cells) => Math.max(...cells.map(w => nearestKm(mesh, w, cellsWhere(numCells, v => frame.owner[v] === solo.id && frame.type[v] === CrustType.OCEAN && mesh.adjList.subarray(mesh.adjOffset[v], mesh.adjOffset[v + 1]).some(nb => isLand(frame, nb))))));
    // (audit 2026-10-30: was one seed, 1.12 × the cells (unsourced; 1.10 on 12345 and 1.17–1.27 on five others, ±10 cells of
    // frame-to-frame jitter) and the single farthest cell. The belt's width is its 90th-percentile distance inland from the
    // coast: over six seeds 218→246, 214→260, 223→248, 212→261, 242→266, 202→238 km at 40→80 Myr. It must grow; by how much is
    // reported, not asked)
    const coastOf = (frame, plate) => cellsWhere(numCells, v => frame.owner[v] === plate.id && frame.type[v] === CrustType.OCEAN && mesh.adjList.subarray(mesh.adjOffset[v], mesh.adjOffset[v + 1]).some(nb => isLand(frame, nb)));
    const widthP90 = (frame, plate) => {
        const coastCells = coastOf(frame, plate), d = cellsWhere(numCells, w => isLand(frame, w) && frame.oroType[w] === OrogenyType.ANDEAN).map(w => nearestKm(mesh, w, coastCells)).sort((a, b) => a - b);
        return { p90: d.length ? d[Math.min(d.length - 1, Math.floor(0.9 * d.length))] : NaN, cells: d.length };
    };
    const widening = (await Promise.all([SEED, ...MORE_SEEDS, 3].map(async seed => {
        const q = seed === SEED ? r : await run('one-sided', 80, {}, true, seed), a = q.at(40), b = q.at(80), plate = f => f.plates.find(x => x.name === 'Solo');
        const w40 = widthP90(a, plate(a)), w80 = widthP90(b, plate(b));
        return { label: seed, formed: w40.cells > 0 && w80.cells > 0, ok: w80.p90 > w40.p90, w40, w80, text: `${w40.cells} belt cells reaching ${w40.p90.toFixed(0)} km (90th percentile) at 40 Myr → ${w80.cells} cells, ${w80.p90.toFixed(0)} km at 80 Myr` };
    })));
    checkAcross('the belt widens the longer subduction goes on', widening);
    report('Andean belt width growth: 90th-percentile inland distance, 40 → 80 Myr', widening.filter(x => x.formed).map(x => x.w80.p90 - x.w40.p90), { unit: ' km', digits: 0, source: 'no Earth figure for the rate: the Andes widen as the slab is consumed (Oncken 2006), a process rate not measured here', detail: `seeds ${widening.map(x => x.label).join(', ')}` });
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
    const halfDrag = { dragContinent: cfg.dragContinent / 2, dragCraton: cfg.dragCraton / 2 };
    const fast = await run('one-sided', 80, halfDrag), fastLast = fast.frames.at(-1), fastSolo = fastLast.plates.find(p => p.name === 'Solo');
    const fastBelt = cellsWhere(numCells, w => isLand(fastLast, w) && fastLast.oroType[w] === OrogenyType.ANDEAN), fastReach = reachAt(fastLast, fastBelt);
    const advance = advanceCmYr(last, solo, belt), fastAdvance = advanceCmYr(fastLast, fastSolo, fastBelt);
    // (checkfix2 2026-11-03: was the single farthest belt cell on one seed, 421 vs 414 km, 7 km under the ~110 km cell: the
    // ordering of two cells' distances, not a belt. The belt's reach is its 90th-percentile distance inland, as the widening
    // check above reads it, over six seeds: with half the drag it is further on all six, by 50–120 km (p90 264→322, 260→313,
    // 248→310, 261→348, 250→323, 233→351), with 27–46 more cells; the farthest cell alone reverses on 12345 only (421→414; the
    // other five rise by 36–157 km): it is the noisy summary. The history has no spread to perturb here — a no-physics nudge
    // of trenchDenudation leaves the scene bit-identical — so the seed-to-seed spread is the band)
    const forced = (await Promise.all([SEED, ...MORE_SEEDS, 3].map(async seed => {
        const q = seed === SEED ? { base: last, soloB: solo, baseBelt: belt, fastFrame: fastLast, soloF: fastSolo, fastCells: fastBelt }
            : await (async () => { const b = (await run('one-sided', 80, {}, true, seed)).frames.at(-1), f = (await run('one-sided', 80, halfDrag, true, seed)).frames.at(-1), pl = fr => fr.plates.find(x => x.name === 'Solo');
                return { base: b, soloB: pl(b), baseBelt: cellsWhere(numCells, w => isLand(b, w) && b.oroType[w] === OrogenyType.ANDEAN), fastFrame: f, soloF: pl(f), fastCells: cellsWhere(numCells, w => isLand(f, w) && f.oroType[w] === OrogenyType.ANDEAN) }; })();
        const wb = widthP90(q.base, q.soloB), wf = widthP90(q.fastFrame, q.soloF), advB = advanceCmYr(q.base, q.soloB, q.baseBelt), advF = advanceCmYr(q.fastFrame, q.soloF, q.fastCells);
        return { label: seed, formed: wb.cells > 0 && wf.cells > 0, ok: advF > advB && wf.cells > wb.cells && wf.p90 > wb.p90,
            text: `${advB.toFixed(1)} → ${advF.toFixed(1)} cm/yr: ${wb.cells} → ${wf.cells} cells, 90th percentile ${wb.p90.toFixed(0)} → ${wf.p90.toFixed(0)} km` };
    })));
    checkAcross('…and further the faster the upper plate advances on its trench', forced, { detail: 'Solo with half the drag against as built; reach = 90th-percentile distance inland' });
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
