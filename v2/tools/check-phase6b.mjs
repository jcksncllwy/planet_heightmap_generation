// Headless acceptance checks for Phase 6b (subduction initiation at old passive margins).
// Hard checks: a wholly passive scene founders a trench along an old margin — pushed down by the founder law (founderUrge:
// the ocean's age and the squeeze across it), never on ocean younger than oceanNeutralAgeMyr — the passive ocean going
// down, the basin closing, the continents colliding, no plate ballooning, continental crust kept; the ablations (rule off;
// too young unsqueezed) and the founder law's induced branch (squeezed hard, 40–120 Myr ocean founders; under
// oceanNeutralAgeMyr it never does); determinism; plates carved out of the passive ocean; the segment vote; no gaps.
// Reported against Earth over the start world's history (per seed): initiation events per 100 Myr, induced and
// spontaneous; the sea floor's age (mean, share older than 180 and 250 Myr); the plate count.
// Usage: node v2/tools/check-phase6b.mjs

import { check, report, section, finish, labMesh, landCount, mean } from './lib/check-kit.mjs';
import { stageOf } from './lib/cycle-stage.mjs';
import { RIFT_SCENES } from '../js/tectonics/scenarios/rift-scenes.js';
import { simulateCached } from './lib/history-cache.mjs';
import { updatePlateMotion } from '../js/tectonics/step/torque-balance.js';
import { frameTallies } from '../js/tectonics/measure.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { PLANET_RADIUS_KM } from '../js/core/sim-mesh.js';
import { BoundaryKind, EventKind } from '../js/tectonics/model/world.js';
import { founderUrge } from '../js/tectonics/step/subduction-init.js';

const SEED = 12345, SNAPSHOT_MYR = 4, MORE_SEEDS = [1, 2];      // (the start world's history is run on a few seeds)
const mesh = labMesh(), { numCells, xyz } = mesh;
// continental crust only: island arcs legitimately ADD land as they grow and accrete, so they are counted apart
const coreCount = f => { let n = 0; for (let w = 0; w < numCells; w++) if (f.owner[w] >= 0 && (f.type[w] === CrustType.CONTINENT || f.type[w] === CrustType.CRATON)) n++; return n; };
const trenchCells = f => { let n = 0; for (let w = 0; w < numCells; w++) if (f.boundary[w] === BoundaryKind.OVERRIDING) n++; return n; };
const movers = f => f.plates.filter(p => p.alive && !p.isBackground);

function run(id, overrides = {}, untilMyr = null, seed = SEED) {
    const scene = RIFT_SCENES.find(s => s.id === id), world = scene.build(mesh, seed);
    Object.assign(world.config, overrides);
    const { frames, steps } = simulateCached(world, { untilMyr: untilMyr ?? scene.maxMyr, drive: updatePlateMotion, snapshotEveryMyr: SNAPSHOT_MYR });     // (the history cache: tools/lib/history-cache.mjs)
    // (events: the last frame's — the world is not run when the history comes from the cache)
    return { scene, world, frames, steps, events: frames.at(-1).events, at: t => frames.find(f => Math.abs(f.time - t) < 1e-6) };
}

// How far apart the two continents' land is, and how big each plate is: a margin that founders must make
// the basin between them CLOSE, and the plates must not balloon (they tile the planet, so their cell
// counts stay put — a plate that grows in every direction is the sign of a scene with no real neighbour).
const landCentroid = (f, id) => {
    let x = 0, y = 0, z = 0, n = 0;
    for (let w = 0; w < numCells; w++) if (f.owner[w] === id && f.type[w] !== CrustType.OCEAN) { x += xyz[3 * w]; y += xyz[3 * w + 1]; z += xyz[3 * w + 2]; n++; }
    return n ? [x / n, y / n, z / n] : null;
};
const separationKm = (f, ids) => {
    const a = landCentroid(f, ids[0]), b = landCentroid(f, ids[1]);
    if (!a || !b) return null;                                   // they have welded into one plate
    const la = Math.hypot(...a), lb = Math.hypot(...b);
    return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)))) * PLANET_RADIUS_KM;
};
const plateCells = (f, id) => { let n = 0; for (let w = 0; w < numCells; w++) if (f.owner[w] === id) n++; return n; };

section('an old passive margin founders');
{
    const r = run('founder'), started = r.events.filter(e => e.kind === EventKind.SUBDUCTION_INIT);
    const cfg = r.world.config, first = started[0];
    const ids = ['Westland', 'Eastland'].map(name => r.frames[0].plates.find(p => p.name === name).id);
    check('the scene begins wholly passive: no trench anywhere', trenchCells(r.frames[0]) === 0 && movers(r.frames[0]).every(p => p.speedCmYr < 0.05),
        `${trenchCells(r.frames[0])} trench cells and ${movers(r.frames[0]).map(p => p.speedCmYr.toFixed(2)).join('/')} cm/yr at the start`);
    check('a trench founders along an old margin', started.length >= 1,
        first ? `${started.length} margin(s) founder; first at ${first.time.toFixed(0)} Myr — ${first.text}` : `none founders in ${r.frames.at(-1).time} Myr`);
    if (first) {
        // what founders it is the founder law: the ocean's weight (√age) and the squeeze across the margin against its strength.
        // (An in-plate founder books the plate's stress across the coast; between two plates the event carries no squeeze —
        // here the scene starts at rest, so the urge is the age's alone, a lower bound.) And no ocean younger than
        // oceanNeutralAgeMyr founders, however it is squeezed: too warm and light
        const urgeAt = e => founderUrge(e.data.ageMyr, e.data.stress !== undefined ? -e.data.stress : 0, cfg, e.data.weightMyr);
        const { lengthKm, ageMyr } = first.data;
        check('…pushed down by the founder law, on ocean old enough to sink', urgeAt(first) > 0 && started.every(e => e.data.ageMyr >= cfg.oceanNeutralAgeMyr),
            `the first: ${lengthKm.toFixed(0)} km of ${ageMyr.toFixed(0)} Myr ocean, urge ${urgeAt(first).toFixed(2)}; youngest founder ${Math.min(...started.map(e => e.data.ageMyr)).toFixed(0)} Myr (none may be under ${cfg.oceanNeutralAgeMyr})`);
        // the passive ocean never becomes the overriding side of a trench: in no frame does it hold trench crust
        const bgId = r.frames[0].plates.find(p => p.isBackground).id;
        const bgTrench = Math.max(...r.frames.map(f => { let n = 0; for (let w = 0; w < numCells; w++) if (f.owner[w] === bgId && f.trench[w]) n++; return n; }));
        check('the passive pre-history ocean goes DOWN — it never overrides', bgTrench === 0,
            `at most ${bgTrench} trench cells on the passive ocean in any frame; founding trenches: ${started.map(e => `${r.frames.at(-1).plates[e.data.lower].name} beneath ${r.frames.at(-1).plates[e.data.upper].name}`).join(' | ')}`);
    }
    // the point of the whole phase: the basin that was open begins to CLOSE, and the continents meet
    const startSep = separationKm(r.frames[0], ids), closest = Math.min(...r.frames.map(f => separationKm(f, ids)).filter(v => v !== null));
    check('the basin between the continents closes', closest < startSep - 800, `land-to-land ${startSep.toFixed(0)} km at the start → ${closest.toFixed(0)} km at its narrowest`);
    const suture = r.events.find(e => e.kind === EventKind.SUTURE);
    check('and the two continents finally collide', !!suture, suture ? suture.text.slice(0, 110) : 'no suture within the run');
    // the plates tile the planet: neither may balloon (the symptom of a plate with no real neighbour)
    const apart = r.frames.filter(f => separationKm(f, ids) !== null);        // only while they are still two plates (the survivor of a suture holds everything)
    // (as a rate: how long they stay two plates is the collision's outcome — a pair welds once its seam stalls — so a total
    // over that window would grade the collision's length, not the plates. 30 % per 100 Myr: the bound this check always set,
    // over the ~100 Myr the two once stayed apart)
    const apartMyr = Math.max(...apart.map(f => f.time)) || 1;
    const grew = ids.map(id => Math.max(...apart.map(f => plateCells(f, id))) / plateCells(r.frames[0], id));
    const perCentury = grew.map(g => 100 * (g - 1) * 100 / apartMyr);
    check('neither plate balloons: they only trade crust across their shared margin', perCentury.every(g => g < 30),
        `largest plate-area growth: ${grew.map(g => (100 * (g - 1)).toFixed(0) + ' %').join(' / ')} over the ${apartMyr} Myr they stay two plates — ${perCentury.map(g => g.toFixed(0) + ' %').join(' / ')} per 100 Myr`);
    check('no gaps; continental crust is neither created nor destroyed', r.frames.every(f => frameTallies(f).gaps === 0) && Math.abs(coreCount(r.frames.at(-1)) - coreCount(r.frames[0])) < 0.1 * coreCount(r.frames[0]),
        `continent+craton ${coreCount(r.frames[0])} \u2192 ${coreCount(r.frames.at(-1))} cells (with island arcs: ${landCount(r.frames[0])} \u2192 ${landCount(r.frames.at(-1))}); no gaps in any frame`);
}

section('it is a rule, not an accident');
{
    const off = run('founder', { subductionInitRatePerMyr: 0 });
    check('with the rule off, nothing founders and the basin stays open', off.events.filter(e => e.kind === EventKind.SUBDUCTION_INIT).length === 0 && off.events.every(e => e.kind !== EventKind.SUTURE) && movers(off.frames.at(-1)).every(p => p.speedCmYr < 0.5),
        `0 margins founder, no collision; ${movers(off.frames.at(-1)).map(p => p.speedCmYr.toFixed(2)).join('/')} cm/yr after ${off.frames.at(-1).time} Myr`);
    // spontaneous: unsqueezed (this scene starts at rest), ocean short of the age threshold never founders
    const young = run('founder', { subductionInitAgeMyr: 10000 });
    check('unsqueezed, crust too young to founder never does', young.events.filter(e => e.kind === EventKind.SUBDUCTION_INIT).length === 0,
        `age threshold 10000 Myr: ${young.events.filter(e => e.kind === EventKind.SUBDUCTION_INIT).length} margins founder`);
    // induced (Stern 2004; it dominates on Earth, Crameri et al. 2020): the founder law itself. Squeezed hard — twice the
    // margin's strength — ocean of 40–120 Myr founders, though alone it would not; under oceanNeutralAgeMyr it never does,
    // squeezed however hard (founderUrge > 0 is what lets a margin found, step/subduction-init.js)
    const cfg = off.world.config, hard = 2 * cfg.founderStrength, crush = 20 * cfg.founderStrength;
    const induced = [40, 80, 120].map(age => ({ age, squeezed: founderUrge(age, hard, cfg), alone: founderUrge(age, 0, cfg) }));
    check('squeezed hard, a margin of 40–120 Myr ocean founders, though alone it would not', induced.every(x => x.squeezed > 0 && x.alone === 0),
        induced.map(x => `${x.age} Myr: urge ${x.squeezed.toFixed(2)} squeezed, ${x.alone.toFixed(2)} alone`).join(' · '));
    const tooYoung = [5, 15, cfg.oceanNeutralAgeMyr - 1].map(age => ({ age, urge: founderUrge(age, crush, cfg) }));
    check(`under ${cfg.oceanNeutralAgeMyr} Myr, ocean never founders, however hard it is squeezed`, tooYoung.every(x => x.urge === 0),
        tooYoung.map(x => `${x.age} Myr at ${crush / cfg.founderStrength}× the margin's strength: urge ${x.urge.toFixed(2)}`).join(' · '));
    const a = run('founder'), b = run('founder');
    check('the same seed replays the same history', a.events.length === b.events.length && a.events.every((e, i) => e.text === b.events[i].text) && a.frames.at(-1).owner.every((o, w) => o === b.frames.at(-1).owner[w]), `${a.events.length} events and the final world, identical`);
}

section('in a whole history');
const histories = [SEED, ...MORE_SEEDS].map(seed => ({ seed, ...run('breakup', {}, null, seed) }));
{
    const cfg = histories[0].world.config, perSeed = fn => histories.map(h => `${h.seed}: ${fn(h)}`).join(' · ');
    // initiation events — between plates, and at a margin inside one — per 100 Myr; induced where the ocean's age alone would
    // not have founded it (the squeeze did), spontaneous where it would. Earth: more than a dozen in the last 100 Myr, mostly
    // induced and next to existing trenches (Crameri et al. 2020)
    const counts = histories.map(h => {
        const started = h.events.filter(e => e.kind === EventKind.SUBDUCTION_INIT), per100 = n => n * 100 / h.frames.at(-1).time;
        const induced = started.filter(e => founderUrge(e.data.ageMyr, 0, cfg, e.data.weightMyr) === 0).length;     // (across a plate: the depth step's weight)
        return { all: per100(started.length), induced: per100(induced), spontaneous: per100(started.length - induced), times: started.map(e => e.time.toFixed(0)).join(', ') };
    });
    report('subduction initiations per 100 Myr', counts.map(c => c.all), { earth: [12, 40], unit: ' /100 Myr', source: 'a rate: 13 initiations since ~105 Ma, mostly induced (Crameri et al. 2020, Nat. Commun. 11; checked) — the database is a floor, and the window is the dispersal stage; the ceiling: "nearly half of all active subduction zones initiated during the Cenozoic" (Gurnis, Hall & Lavier 2004, G³ 5): ~half of ~55,000 km of trench (Stern 2002) in 66 Myr, ≳1000 km each once grown (Puysegur ~150 to Izu–Bonin–Mariana ~2500 km: Stern & Gerya 2018) — ≲40 per 100 Myr. A trench running along strike is no new one (Crameri et al. 2020, Box 1)', digits: 1,
        detail: `induced · spontaneous: ${counts.map(c => `${c.induced.toFixed(1)} · ${c.spontaneous.toFixed(1)}`).join(' | ')}` });
    // WBP: the sea floor is young — it is recycled. Without subduction initiation the oldest ocean just sits there.
    const ages = histories.map(h => {
        const last = h.frames.at(-1), a = [];
        for (let w = 0; w < numCells; w++) if (last.owner[w] >= 0 && last.type[w] === CrustType.OCEAN) a.push(last.time - last.formedAt[w]);
        return { mean: mean(a), over180: 100 * a.filter(v => v > 180).length / a.length, over250: 100 * a.filter(v => v > 250).length / a.length };
    });
    report('mean sea-floor age', ages.map(a => a.mean), { earth: [60, 65], unit: ' Myr', source: 'stage-matched — today, ~200 Myr after Pangaea\'s breakup, as at the end of this 300 Myr breakup history: ~62 (Müller et al. 2008), 64.2 (Seton et al. 2020); over the last 200 Myr it ranged ~35–65, lowest in the Early Cretaceous (Williams et al. 2021, Geosci. Front. 12; van der Meer et al. 2017)', digits: 0,
        detail: `at the end of each 300 Myr history, in the cycle\'s ${histories.map(h => stageOf(h.frames.at(-1)) ?? 'no').join(' · ')} stage` });
    report('sea floor older than 180 Myr', ages.map(a => a.over180), { earth: [0, 1], unit: ' %', source: 'in situ maximum ≈ 180 Ma, Müller et al. 2008; holds through the cycle: in the reconstructions since Pangaea no in-situ floor much older than ~200 Myr survives, relics aside (Karlsen et al. 2020)', digits: 1 });
    report('sea floor older than 250 Myr', ages.map(a => a.over250), { earth: [0, 1], unit: ' %', source: 'rare relics to ≈ 340 Myr, Granot 2016 (Nat. Geosci. 9; abstract checked); holds through the cycle', digits: 1 });
    check('no gaps in any frame', histories.every(h => h.frames.every(f => frameTallies(f).gaps === 0)), 'every frame, every seed');
    report('plates at the end', histories.map(h => movers(h.frames.at(-1)).length), { earth: [10, 52], source: 'through time: 10 at 200 Ma rising to 31 today in the Seton 2012 reconstruction, 18–31 through the Cenozoic (Morra et al. 2013, EPSL 373; checked) — reconstructions miss small plates; 52 resolved today, 14 large (Bird 2003, PB2002)', digits: 0,
        detail: `at most ${perSeed(h => Math.max(...h.frames.map(f => movers(f).length)))} at once (the engine holds ${cfg.reserved.maxPlates})` });
}

section('a plate is carved out of the passive ocean');
{
    // the founder scene with birth switched back ON: its continents face the passive ocean all round, so a
    // margin there must carve a plate out of it before any trench can found
    const r = run('founder', { oceanPlateMinAreaKm2: 8e6 }), born = r.events.filter(e => e.kind === EventKind.PLATE_BORN);
    check('a trench against the passive ocean first makes a plate of it', born.length >= 1 && r.events.some(e => e.kind === EventKind.SUBDUCTION_INIT && born.some(b => b.data.plate === e.data.upper || b.data.plate === e.data.lower)),
        born.length ? born.map(e => `${e.time.toFixed(0)} Myr: ${e.text}`).join(' | ').slice(0, 190) : 'no plate born in 300 Myr');
    if (born.length) {
        const last = r.frames.at(-1), ids = born.map(e => e.data.plate);
        const alive = ids.map(id => last.plates[id]).filter(p => p?.alive);
        check('the newborn plates are real: they move under their own slabs', alive.length >= 1 && alive.every(p => p.speedCmYr > 0.2),
            alive.length ? alive.map(p => `${p.name} ${p.speedCmYr.toFixed(2)} cm/yr`).join(', ') : 'none of them survive to the end');
        // the point of birth: a plate facing the passive ocean balloons, one facing a real plate does not
        const oceanCells = (fr, id) => { let n = 0; for (let w = 0; w < numCells; w++) if (fr.owner[w] === id) n++; return n; };
        const first = ids[0], atBirth = r.frames.find(fr => fr.time >= born[0].time);
        const biggest = Math.max(...r.frames.filter(fr => fr.time >= born[0].time).map(fr => oceanCells(fr, first)));      // (over its whole life: it may be swallowed later)
        check('a newborn plate is a normal plate, not a runaway', oceanCells(atBirth, first) > 0 && biggest < 2.5 * oceanCells(atBirth, first),
            `${last.plates[first].name}: ${oceanCells(atBirth, first)} cells at birth, at most ${biggest} later (${oceanCells(last, first)} at ${last.time} Myr)`);
    }
}

section('one polarity per stretch of boundary');
{
    // Ocean against ocean the polarity used to be settled cell by cell, so where trench flags were patchy
    // the "older sinks" rule and the trench rule interleaved and the front came out ragged (the Phase 5b
    // limitation). The vote in step/boundaries.js settles a whole segment at once. Measured as the share of
    // neighbouring ocean boundary cells of ONE plate that are playing opposite roles — run with the vote
    // on and off, so the check tests the mechanism rather than a number that drifts with the history.
    // averaged over the closing frames, not read off one: a single frame's share swings with whatever the
    // plates happen to be doing at that instant
    const ragged = r => {
        const { adjOffset, adjList } = mesh;
        let flips = 0, pairs = 0;
        for (const fr of r.frames.slice(-8)) {
            for (let w = 0; w < numCells; w++) {
                if (fr.owner[w] < 0 || fr.type[w] !== CrustType.OCEAN) continue;
                const mine = fr.boundary[w];
                if (mine !== BoundaryKind.OVERRIDING && mine !== BoundaryKind.SUBDUCTING) continue;
                for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
                    const nb = adjList[k];
                    if (fr.owner[nb] !== fr.owner[w] || fr.type[nb] !== CrustType.OCEAN) continue;
                    const theirs = fr.boundary[nb];
                    if (theirs !== BoundaryKind.OVERRIDING && theirs !== BoundaryKind.SUBDUCTING) continue;
                    pairs++; if (theirs !== mine) flips++;
                }
            }
        }
        return { flips, pairs, share: pairs ? flips / pairs : 0 };
    };
    const on = ragged(histories[0]), off = ragged(run('breakup', { segmentPolarity: false }));
    check('the segment vote makes ocean-on-ocean fronts less ragged', on.pairs > 1000 && off.pairs > 1000 && on.share < 0.8 * off.share && on.share < 0.06,
        `role flips between neighbouring ocean boundary cells of one plate: ${(100 * on.share).toFixed(1)} % with the vote (${on.flips}/${on.pairs}), ${(100 * off.share).toFixed(1)} % without (${off.flips}/${off.pairs})`);
}

finish('Phase 6b');
