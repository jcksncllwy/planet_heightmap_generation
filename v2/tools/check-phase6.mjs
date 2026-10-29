// Headless acceptance checks for Phase 6a (rifting).
// Hard checks: a scheduled plume splitting a continent (land kept, two plates, uplifted shoulders, a failed arm and
// rifted margins recorded, a ridge opening, each half under its own trench), the ablation; over the start world's
// history on several seeds: the halves named by their cratons, every craton either whole or booked as split by a rift,
// continental crust made and lost only by the stages whose process may, collisions bounded with their convergence
// decaying, determinism, no gaps, the step count. Reported against Earth (one value per seed): how much of the rift length
// runs through cratons and along old sutures, the supercontinent's tenure before its first rift, the first rift's piece
// sizes, split cratons, net island-arc growth, the plate count; and, pending the rewrite, the failed arm's shoulders.
// Usage: node v2/tools/check-phase6.mjs

import { check, report, section, finish, labMesh, isLand, landCount, countWhere } from './lib/check-kit.mjs';
import { RIFT_SCENES } from '../js/tectonics/scenarios/rift-scenes.js';
import { simulate } from '../js/tectonics/simulate.js';
import { updatePlateMotion } from '../js/tectonics/step/torque-balance.js';
import { frameTallies } from '../js/tectonics/measure.js';
import { CrustType, CrustFlag, OrogenyType } from '../js/tectonics/model/crust.js';
import { BoundaryKind, EventKind } from '../js/tectonics/model/world.js';

const SEED = 12345, SNAPSHOT_MYR = 2, MORE_SEEDS = [1, 2];      // (the start world's history is run on a few seeds)
const LAND_STAGES = ['collisions', 'marginIsles', 'sedimentSubduction', 'arcMaturation', 'tidy'];   // the only stages whose process may make or lose land
const mesh = labMesh(), { numCells } = mesh;
const flagged = (f, flag) => countWhere(numCells, w => f.owner[w] >= 0 && (f.flags[w] & flag));
// the plates carrying continent (a plate of ocean that broke away at an old margin — step/subduction-init.js — is not a half)
const continental = f => f.plates.filter(p => p.alive && !p.isBackground && p.landCells > 0);

function run(id, overrides = {}, untilMyr = null, prepare = null, seed = SEED) {
    const scene = RIFT_SCENES.find(s => s.id === id), world = scene.build(mesh, seed);
    Object.assign(world.config, overrides);
    prepare?.(world);
    // each collision record's deepest stacking (its overlap's area over its front) while in contact, sampled at each snapshot
    const stacked = new Map();
    const { frames, steps } = simulate(world, { untilMyr: untilMyr ?? scene.maxMyr, drive: updatePlateMotion, snapshotEveryMyr: SNAPSHOT_MYR,
        stopAt: w => { for (const rec of w.collisions.values()) if (!rec.sutured && rec.lastActive === w.time) stacked.set(rec, Math.max(stacked.get(rec) ?? 0, rec.cells * mesh.cellAreaKm2 / Math.max(rec.frontKm, mesh.edgeKm))); return false; } });
    return { scene, world, frames, steps, stacked, events: world.events, at: t => frames.find(f => Math.abs(f.time - t) < 1e-6) };
}

section('a plume splits a continent');
{
    const r = run('plume'), rift = r.events.find(e => e.kind === EventKind.RIFT);
    check('the plume forces a rift at 20 Myr', !!rift && Math.abs(rift.time - 20) < 1e-6 && rift.data.cause === 'plume', rift ? rift.text : 'no rift');
    if (rift) {
        const before = r.at(18), after = r.at(22), last = r.frames.at(-1);
        check('land is conserved through the split', Math.abs(landCount(after) - landCount(before)) < 0.01 * landCount(before), `${landCount(before)} → ${landCount(after)} land cells (the world view jitters by a few cells as plates move)`);
        check('two plates where there was one', continental(before).length === 1 && continental(after).length === 2, `${continental(before).length} → ${continental(after).length} continental plates`);
        // stretching makes relief too: the flanks the rift left standing carry a RIFT orogeny record, so the
        // terrain stage need not work out later where a rift once ran (East African Rift, the Ghats)
        let shoulder = 0, shoulderWork = 0;
        for (let w = 0; w < numCells; w++) if (after.owner[w] >= 0 && after.oroType[w] === OrogenyType.RIFT) { shoulder++; shoulderWork += after.oroWork[w]; }
        check('the rift leaves uplifted shoulders on both sides', shoulder > 60 && shoulderWork > 0, `${shoulder} cells carry a rift-shoulder record, mean work ${(shoulderWork / Math.max(1, shoulder)).toFixed(0)} km`);
        // the arm that failed: an aulacogen sags and fills with sediment, but a rift that was active before it failed had
        // flanks (the Rio Grande rift) — riftFailedShoulderShare of a rift's shoulders on the land beside the arm, decaying
        // with the rest of the rift's relief once extension has stopped (riftReliefTauMyr)
        const arm = new Uint8Array(numCells);
        for (let w = 0; w < numCells; w++) if (after.owner[w] >= 0 && (after.flags[w] & CrustFlag.FAILED_RIFT)) arm[w] = 1;
        let flank = 0, flankWithShoulder = 0;
        for (let w = 0; w < numCells; w++) {
            if (arm[w] || after.owner[w] < 0 || after.type[w] === CrustType.OCEAN) continue;
            let beside = false;
            for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1] && !beside; k++) if (arm[mesh.adjList[k]]) beside = true;
            if (!beside) continue;
            flank++; if (after.oroType[w] === OrogenyType.RIFT) flankWithShoulder++;
        }
        check('a failed arm keeps shoulders on the land beside it', flankWithShoulder > 0, `${flankWithShoulder} of ${flank} land cells beside the failed arm carry a rift-shoulder record`);
        report('land beside a failed arm carrying a rift-shoulder record', flank ? 100 * flankWithShoulder / flank : [], { unit: ' %', digits: 0, detail: `${flankWithShoulder} of ${flank} cells; riftFailedShoulderShare ${r.world?.config?.riftFailedShoulderShare ?? '—'}` });
        check('a failed arm and two rifted margins are recorded', flagged(after, CrustFlag.FAILED_RIFT) >= 3 && flagged(after, CrustFlag.RIFT_MARGIN) > 40, `${flagged(after, CrustFlag.FAILED_RIFT)} failed-arm cells, ${flagged(after, CrustFlag.RIFT_MARGIN)} rift-margin cells`);
        const f80 = r.at(80), ridge = countWhere(numCells, w => f80.boundary[w] === BoundaryKind.RIDGE);
        const fresh = countWhere(numCells, w => f80.owner[w] >= 0 && !f80.plates[f80.owner[w]].isBackground && f80.type[w] === CrustType.OCEAN && f80.formedAt[w] > 20);
        check('a ridge opens between the halves and they drift apart', ridge > 20 && fresh > 100 && !r.events.some(e => e.kind === EventKind.SUTURE), `${ridge} ridge cells and ${fresh} cells of new ocean on the plates at 80 Myr; sutures: ${r.events.filter(e => e.kind === EventKind.SUTURE).length}`);
        // (the two halves as the rift left them, followed by id: a half that rifts again later keeps its id on its larger piece
        // — later rifts are the history's, not this one's (the plume scene runs on to 160 Myr with rifting on))
        const halves = continental(after).map(p => last.plates[p.id]), speeds = halves.map(p => (p?.alive ? p.speedCmYr : NaN));
        check('each half moves under its own trench', speeds.length === 2 && speeds.every(v => v > 0.5),
            `${halves.map((p, i) => `${p?.name ?? '—'} ${Number.isFinite(speeds[i]) ? speeds[i].toFixed(2) : 'gone'}`).join(' / ')} cm/yr at ${last.time} Myr (all continental plates then: ${continental(last).map(p => `${p.name} ${p.speedCmYr.toFixed(2)}`).join(' / ')})`);
        check('no gaps', r.frames.every(f => frameTallies(f).gaps === 0), 'every frame');
    }
    const scheduledOnly = run('plume', { plumeRatePerMyr: 0, riftRatePerMyr: 0 }, 60);
    const noPlume = run('plume', { plumeRatePerMyr: 0, riftRatePerMyr: 0 }, 60, world => { world.plumes.length = 0; });
    check('no plume and no chance → no rift; a scheduled plume alone → one', scheduledOnly.events.filter(e => e.kind === EventKind.RIFT).length === 1 && noPlume.events.filter(e => e.kind === EventKind.RIFT).length === 0 && continental(noPlume.frames.at(-1)).length === 1,
        `scheduled plume alone: ${scheduledOnly.events.filter(e => e.kind === EventKind.RIFT).length} rift; no plume: ${noPlume.events.filter(e => e.kind === EventKind.RIFT).length}, ending as ${continental(noPlume.frames.at(-1)).map(p => p.name).join(' + ')}`);
}

section('the start world breaks up');
{
    // the start world's history on several seeds: the invariants are held on every one, the Earth statistics reported per seed
    const runs = [SEED, ...MORE_SEEDS].map(seed => ({ seed, ...run('breakup', { crustLedger: true }, null, null, seed) }));
    const r = runs[0], cfg = r.world.config, rifts = rr => rr.events.filter(e => e.kind === EventKind.RIFT);
    const perSeed = fn => runs.map(rr => `${rr.seed}: ${fn(rr)}`).join(' · ');
    const firstOf = rr => {
        const first = rifts(rr)[0];
        if (!first) return null;
        const pieces = continental(rr.at(Math.ceil(first.time / SNAPSHOT_MYR) * SNAPSHOT_MYR)), total = pieces.reduce((s, p) => s + p.landCells, 0);
        return { first, pieces, bigger: Math.max(...pieces.map(p => p.landCells)) / total };
    };
    const firsts = runs.map(firstOf);
    check('the old supercontinent rifts', firsts.every(Boolean), perSeed(rr => rifts(rr).length ? `${rifts(rr).length} rifts, the first at ${rifts(rr)[0].time.toFixed(0)} Myr` : 'no rift'));
    // (Pangaea stood ~80–120 Myr between its assembly and its break-up; the rift's ageMyr is the piece's, since its last rift or weld)
    report('the supercontinent’s tenure before its first rift', firsts.map(x => x?.first.data.ageMyr), { earth: [75, 120], unit: ' Myr', source: 'stage-matched: Pangaea ~80–120 (recalled); Rodinia ~75 — assembled by ~900 Ma, rifting from ~825 Ma (Li et al. 2008, Precambrian Res. 160; abstract checked)', digits: 0,
        detail: `first rift at ${firsts.map(x => x ? `${x.first.time.toFixed(0)} Myr` : '—').join(' · ')} (seeds ${runs.map(rr => rr.seed).join(', ')})` });
    // the pieces' sizes are emergent (the cut is the weakest line under the stress): Laurasia and Gondwana were comparable, but
    // rifts also calve slivers (Madagascar, the Seychelles, Jan Mayen) — no Earth range
    report('the first rift’s larger piece, as a share of the land', firsts.map(x => x && 100 * x.bigger), { unit: ' %', digits: 0,
        detail: firsts.map(x => x ? x.pieces.map(p => `${p.name} (${p.landCells})`).join(' + ') : '—').join(' · ') });
    // (each half is named by the craton letters it holds: rifting.js namesAfterSplit, when both hold cratons)
    check('the first rift’s pieces are named by their cratons', firsts.every(x => x && x.pieces.length === 2 && x.pieces.every(p => /^[A-Z]+$/.test(p.name))),
        firsts.map(x => x ? x.pieces.map(p => p.name).join(' and ') : 'no rift').join(' · '));
    // how much of the rift length crosses cratons (finitely strong — cratonStrength — so rarely, but the Congo–São Francisco
    // craton was split by the South Atlantic) and how much follows old weak lines (sutures, failed arms, rifted margins)
    const shareOf = (rr, key) => { const rs = rifts(rr), km = rs.reduce((s, e) => s + e.data.lengthKm, 0); return km ? 100 * rs.reduce((s, e) => s + (e.data[key] ?? 0), 0) / km : null; };
    report('rift length through cratons', runs.map(rr => shareOf(rr, 'cratonKm')), { earth: [1, 10], unit: ' %', source: 'small but non-zero: the Congo–São Francisco and North Atlantic cratons', digits: 1 });
    report('rift length along old sutures, failed arms and rifted margins', runs.map(rr => shareOf(rr, 'weakKm')), { earth: [50, 100], unit: ' %', source: 'most rifted margins lie on former sutures: Buiter & Torsvik 2014; Peron-Pinvidic et al. 2021', digits: 0 });
    // a craton is whole on one plate, or a rift has gone through it and booked it as split (RIFT data.splitCratons) — in every frame
    const divided = runs.map(rr => {
        let unbooked = 0, firstSeen = null;
        for (const f of rr.frames) {
            // (a rift, or the rift behind a back-arc strip — step/backarc.js, which may cut a craton cratonStrength times less readily)
            const booked = new Set(rr.events.filter(e => (e.kind === EventKind.RIFT || e.kind === EventKind.BACKARC_OPEN) && e.time <= f.time + 1e-9).flatMap(e => e.data.splitCratons ?? []));
            const holder = new Map(), split = new Set();
            for (let w = 0; w < numCells; w++) { if (f.owner[w] < 0 || f.type[w] !== CrustType.CRATON) continue; const prev = holder.get(f.terrane[w]); if (prev !== undefined && prev !== f.owner[w]) split.add(f.terrane[w]); holder.set(f.terrane[w], f.owner[w]); }
            for (const id of split) if (!booked.has(id)) { unbooked++; firstSeen ??= `terrane ${id} at ${f.time} Myr`; }
        }
        return { unbooked, firstSeen, split: new Set(rifts(rr).flatMap(e => e.data.splitCratons ?? [])).size };
    });
    check('every craton is whole on one plate, or booked as split by the rift that went through it', divided.every(d => d.unbooked === 0),
        perSeed((rr, i = runs.indexOf(rr)) => divided[i].unbooked ? `${divided[i].unbooked} craton-frames on two plates unbooked, first ${divided[i].firstSeen}` : 'all booked'));
    report('cratons split by a rift', divided.map(d => d.split), { digits: 0, detail: 'over each 300 Myr history (the Congo–São Francisco craton was)' });
    // continental crust is made and lost only by the stages whose process may (the crust ledger, step/crust-ledger.js); island
    // arcs grow — reported against Earth, where arc addition and recycling roughly balance (Clift et al. 2009)
    const offending = rr => Object.entries(rr.world.ledger.stages).filter(([stage, e]) => e.land !== 0 && !LAND_STAGES.includes(stage));
    check('continental crust is made and lost only by collisions, margin isles, sediment subduction, arc maturation and tidying', runs.every(rr => offending(rr).length === 0),
        perSeed(rr => offending(rr).length ? offending(rr).map(([k, e]) => `${k} ${e.land > 0 ? '+' : ''}${e.land}`).join(', ')
            : `${rr.world.ledger.start.land} → ${rr.world.ledger.start.land + Object.values(rr.world.ledger.stages).reduce((s, e) => s + e.land, 0)} continent cells (${LAND_STAGES.map(k => `${k} ${rr.world.ledger.stages[k]?.land ?? 0}`).join(', ')})`));
    const arcGrowth = rr => { const L = rr.world.ledger, myr = rr.frames.at(-1).time; return 100 * Object.values(L.stages).reduce((s, e) => s + e.arc, 0) / L.start.land * 100 / myr; };
    report('net island-arc growth, as a share of the continent', runs.map(arcGrowth), { earth: [-1, 1], unit: ' %/100 Myr', source: 'addition ≈ recycling, Clift et al. 2009', digits: 1 });
    const replay = run('breakup', { crustLedger: true });
    check('the same seed replays the same history', replay.events.length === r.events.length && replay.events.every((e, i) => e.text === r.events[i].text) && replay.frames.at(-1).owner.every((o, w) => o === r.frames.at(-1).owner[w]), `${r.events.length} events and the final world, identical`);
    // Land cannot subduct far (Cloos 1993), so a collision stays bounded — the overlap stays a seam a few cells deep (its
    // area over its front) — and the convergence across a lasting contact falls away. (India has pressed on Asia for ~50 Myr
    // without welding: a pair welds once its seam stalls, so when is the forces' outcome and is not tested.) How far each weld's
    // indenter pushed is reported against Earth.
    const bounded = runs.map(rr => {
        const deepest = Math.max(0, ...rr.stacked.values()), sutures = rr.events.filter(e => e.kind === EventKind.SUTURE);
        // (a collision is judged by its fate: one the history welded ran its course, and its closing at the weld is its end; one
        // still open when the run stops is cut off mid-course — its rate "at the end" is the run's end, not the collision's — and
        // is listed, not judged. On Earth convergence across a lasting contact decays: India–Asia from ~18 to ~4 cm/yr)
        const lasting = [...rr.world.collisions.values()].filter(rec => rec.contactMyr >= 20), welded = lasting.filter(rec => rec.sutured);
        const speeding = welded.filter(rec => !(rec.closingCmYr < rec.meanRateCmYr)), open = lasting.filter(rec => !rec.sutured && !(rec.closingCmYr < rec.meanRateCmYr));
        return { deepest, sutures, lasting, welded, speeding, open };
    });
    check('collisions stay bounded: the overlap stays a seam', bounded.every(b => b.deepest < 6 * mesh.edgeKm),
        perSeed((rr, i = runs.indexOf(rr)) => `at most ${bounded[i].deepest.toFixed(0)} km deep`) + ` (cell ${mesh.edgeKm.toFixed(0)} km)`);
    report('indentation of the upper plate at each weld', bounded.flatMap(b => b.sutures.map(e => e.data.maxIndentKm)), { earth: [600, 1100], unit: ' km', source: 'India into Asia, van Hinsbergen et al. 2011', digits: 0,
        detail: perSeed((rr, i = runs.indexOf(rr)) => `${bounded[i].sutures.length} welds`) });
    const contact = (rr, rec) => `${rr.world.plates[rec.lower].name} into ${rr.world.plates[rec.upper].name} ${rec.closingCmYr.toFixed(2)} vs mean ${rec.meanRateCmYr.toFixed(2)} cm/yr`;
    check('convergence across a lasting continent–continent contact falls away', bounded.every(b => b.speeding.length === 0),
        perSeed((rr, i = runs.indexOf(rr)) => `${bounded[i].welded.length} of ${bounded[i].lasting.length} contacts lasting 20 Myr or more welded${bounded[i].speeding.length ? `; closing at the weld at or above their mean: ${bounded[i].speeding.map(rec => contact(rr, rec)).join(' | ')}` : ', each closing slower at the weld than on average'}${bounded[i].open.length ? ` (still open at the end, not judged, closing at or above their mean: ${bounded[i].open.map(rec => contact(rr, rec)).join(' | ')})` : ''}`));
    check('no gaps in any frame', runs.every(rr => rr.frames.every(f => frameTallies(f).gaps === 0)), 'every frame, every seed');
    check('it runs fast', runs.every(rr => rr.steps < 600), perSeed(rr => `${rr.steps} steps`));
    report('plates at the end', runs.map(rr => rr.frames.at(-1).plates.filter(p => p.alive && !p.isBackground).length), { earth: [10, 52], source: 'through time: 10 at 200 Ma rising to 31 today in the Seton 2012 reconstruction, 18–31 through the Cenozoic (Morra et al. 2013, EPSL 373; checked) — reconstructions miss small plates; 52 resolved today, 14 large (Bird 2003, PB2002)', digits: 0,
        detail: `at most ${perSeed(rr => Math.max(...rr.frames.map(f => f.plates.filter(p => p.alive && !p.isBackground).length)))} at once` });
}

finish('Phase 6a');
