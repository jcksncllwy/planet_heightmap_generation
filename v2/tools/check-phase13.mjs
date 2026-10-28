// Headless acceptance checks for Phase 13 (the supercontinent cycle — plans/V2_ROADMAP_PHASES_9_13.md). Three seeds, the
// lab's 1200 Myr scene ("The supercontinent cycle", every rule on, the crust ledger on). Hard: the start world is a
// supercontinent and the cycle gathers a new one within the run; the continental crust does not run away (×0.5–2); no
// plate freezes the planet (one over 90 % of it for over 50 Myr) and there are always at least two; the switch, and the
// endings (reached, in their stage, the same history up to them). Reported against Earth, per seed: the rift pace, how far
// the pieces disperse and when they gather again, the new supercontinent's tenure, cohesion, shape and seas, rifts on weak
// zones, untouched land, open-ocean arcs, lowland after carving, the crust's change by source (world.ledger, world.budget)
// and the land share's, the largest plate's share and the number of plates.
// Usage: node v2/tools/check-phase13.mjs

import { check, report, section, finish, labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { simulateCached } from './lib/history-cache.mjs';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { CrustType, CrustFlag, VolcanicType, OrogenyType } from '../js/tectonics/model/crust.js';
import { MECHANISMS, TECTONICS } from '../js/tectonics/config.js';
import { ENDINGS, inStage, historyEnding, framesEnding } from '../js/tectonics/ending.js';
import { spreadKm } from '../js/core/min-heap.js';
import { hopDistance } from '../js/core/mesh-bfs.js';
import { synthesizeTerrain, hypsometry } from '../js/terrain/synthesize.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { stageOf, EARTH_LAND, EARTH_LAND_RATIO, EARTH_SUBMERGED, byStage, stageText } from './lib/cycle-stage.mjs';
import { shelfStats, EARTH_SHELF_KM, EARTH_BREAK_KM } from './lib/shelf-stats.mjs';
import { columnKm, crustThicknessKm, columnModel } from '../js/tectonics/measure.js';
import { TERRAIN } from '../js/terrain/terrain-config.js';

const SEEDS = [12345, 777, 4242];
const CLUMP_MYR = TECTONICS.riftMinGapMyr + 30;     // (the window over which the most a landmass held while the pieces dispersed is read)
const FREEZE = 0.9, FREEZE_MYR = 50;                // (a plate holding over 90 % of the planet for over 50 Myr: the lid has stopped)
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const mesh = labMesh(), n = mesh.numCells, cellKm2 = mesh.cellAreaKm2;
const scene = TERRAIN_SCENES.find(s => s.id === 'cycle');

/** Connected groups of the cells in a set. */
function comps(inSet) {
    const id = new Int32Array(n).fill(-1), out = [];
    for (let w = 0; w < n; w++) {
        if (!inSet(w) || id[w] >= 0) continue;
        const q = [w]; id[w] = out.length;
        for (let i = 0; i < q.length; i++) for (let k = mesh.adjOffset[q[i]]; k < mesh.adjOffset[q[i] + 1]; k++) { const nb = mesh.adjList[k]; if (inSet(nb) && id[nb] < 0) { id[nb] = out.length; q.push(nb); } }
        out.push(q);
    }
    return out;
}

/**
 * The largest landmass of a frame kept as {cont, ocean} bitmaps: its thinness (its deepest point from the coast ÷ the
 * radius of a disc of its area — a disc 1, a ring or a snake ≪ 1) and the largest sea it closes in (ocean floor km²:
 * seas are the groups of non-continental cells other than the world ocean; one it borders counts).
 */
function shapeOf({ cont, ocean }) {
    const land = comps(w => cont[w] === 1).sort((a, b) => b.length - a.length)[0] ?? [];
    const inLand = new Uint8Array(n); for (const w of land) inLand[w] = 1;
    const inland = new Float32Array(n); for (let w = 0; w < n; w++) inland[w] = cont[w] ? Infinity : 0;
    spreadKm(mesh, inland, {});
    let deep = 0; for (const w of land) deep = Math.max(deep, inland[w]);
    const A = land.length * cellKm2, seas = comps(w => cont[w] === 0).sort((a, b) => b.length - a.length).slice(1);
    let seaKm2 = 0;
    for (const c of seas) {
        let borders = false;
        for (const w of c) { for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1] && !borders; k++) if (inLand[mesh.adjList[k]]) borders = true; if (borders) break; }
        if (borders) seaKm2 = Math.max(seaKm2, c.reduce((s, w) => s + (ocean[w] ? cellKm2 : 0), 0));
    }
    let total = 0; for (let w = 0; w < n; w++) total += cont[w];
    return { thin: deep / Math.sqrt(A / Math.PI), seaKm2, areaMkm2: A / 1e6, joined: land.length / Math.max(1, total) };
}

/** Continental crust no belt (current or overprinted), rift margin, failed rift or flood basalt has touched. */
function untouched(f) {
    const cont = w => f.owner[w] >= 0 && (f.type[w] === CrustType.CONTINENT || f.type[w] === CrustType.CRATON);
    const still = w => cont(w) && !f.oroType[w] && !f.prevType[w] && !(f.flags[w] & (CrustFlag.RIFT_MARGIN | CrustFlag.FAILED_RIFT)) && f.volcType[w] !== VolcanicType.LIP;
    let total = 0, calm = 0;
    for (let w = 0; w < n; w++) if (cont(w)) { total++; if (still(w)) calm++; }
    const biggest = Math.max(0, ...comps(still).map(c => c.length));
    return { share: calm / Math.max(1, total), patchMkm2: biggest * cellKm2 / 1e6 };
}

/**
 * Island arcs: the arc crust over 1500 km from any continent, and the largest open-ocean arc landmass — one lying on
 * average over 1000 km from any continent (arc crust accreted along a continent's margin is not an island arc at sea) (Mkm²).
 */
function arcsOf(f) {
    const arc = w => f.owner[w] >= 0 && f.type[w] === CrustType.ARC;
    const d = hopDistance(mesh, w => f.owner[w] >= 0 && (f.type[w] === CrustType.CONTINENT || f.type[w] === CrustType.CRATON)), km = w => d[w] < 0 ? 1e4 : d[w] * mesh.edgeKm;
    let far = 0, all = 0; for (let w = 0; w < n; w++) if (arc(w)) { all++; if (km(w) > 1500) far++; }
    const open = comps(arc).filter(c => c.reduce((s, w) => s + km(w), 0) / c.length > 1000);
    return { largest: Math.max(0, ...open.map(c => c.length)) * cellKm2 / 1e6, far: far * cellKm2 / 1e6, all: all * cellKm2 / 1e6 };
}

const tm = terrainMesh(160000);
const ARC_LIVE_MYR = 10;             // (an arc its slab fed within this long counts as live: the frames are 10 Myr apart)

function run(seed, overrides = {}, { terrain = true } = {}) {
    const world = scene.build(mesh, seed);
    Object.assign(world.config, { crustLedger: true }, overrides);
    const kept = [], arcs = [], largestShares = [];
    const lowlandStages = [];
    let calm = null, lowland = null, lowlandRaw = null, land0 = null, land1200 = null, cont0 = 0, cont500 = 0, cont1000 = 0, cont1200 = 0, frozenFor = 0, frozenMost = 0;
    const arcLand = { live: { n: 0, up: 0 }, dead: { n: 0, up: 0 } };
    const plateCounts = [], bigPlates = [], floorAges = [], sealedOld = [], sea = [], staged = [];
    const heights = [], decay = new Map();       // (branch unified: the land's heights and crust, and old belts as they wear)
    const started = performance.now();
    simulate(world, { untilMyr: scene.maxMyr, drive: w => scene.drive(w), snapshotEveryMyr: 10, onFrame: f => {
        const cont = new Uint8Array(n), ocean = new Uint8Array(n);
        for (let w = 0; w < n; w++) { if (f.owner[w] < 0) continue; const t = f.type[w]; if (t === CrustType.CONTINENT || t === CrustType.CRATON) cont[w] = 1; else if (t === CrustType.OCEAN) ocean[w] = 1; }
        const sizes = comps(w => cont[w] === 1).map(c => c.length), total = sizes.reduce((x, y) => x + y, 0);
        // (the share as the cycle counts it — necks under cycleNeckKm do not join — and, for the switched-off run, which
        // counts nothing, joined by any land)
        kept.push({ time: f.time, share: f.cycle ? f.cycle.share : total ? Math.max(...sizes) / total : 0, phase: f.cycle?.phase, cont, ocean });
        if (f.time % 200 === 0 && f.time > 0) arcs.push(arcsOf(f));
        // (the plates as the world view holds them: the largest one's share, how long one has held over 90 % running, and how
        // many hold ≥ 1 % of the planet — once the start world's supercontinent, one plate with its ocean by design, has broken up)
        if (f.time >= 100) {
            const per = new Map();
            for (let w = 0; w < n; w++) { const o = f.owner[w]; if (o >= 0 && !f.plates[o]?.isBackground) per.set(o, (per.get(o) ?? 0) + 1); }
            const largest = Math.max(0, ...per.values()) / n;
            largestShares.push(largest);
            frozenFor = largest > FREEZE ? frozenFor + 10 : 0;
            frozenMost = Math.max(frozenMost, frozenFor);
            plateCounts.push([...per.values()].filter(c => c >= 0.01 * n).length);
            // (the large plates — over 10^7.5 km², the kink in Earth's plate-size distribution — and the sea floor's mean age)
            bigPlates.push([...per.values()].filter(c => c * cellKm2 >= 10 ** 7.5).length);
            let ages = 0, nOcean = 0;
            for (let w = 0; w < n; w++) if (f.owner[w] >= 0 && f.type[w] === CrustType.OCEAN) { ages += f.time - f.formedAt[w]; nOcean++; }
            floorAges.push(ages / Math.max(1, nOcean));
            // (the same figures by the cycle's stage, for those that change through it: lib/cycle-stage.mjs)
            staged.push({ stage: stageOf(f), largest, floorAge: ages / Math.max(1, nOcean), big: bigPlates.at(-1), plates: plateCounts.at(-1) });
            // (sealed seas — sea cut off from the world ocean, the largest body of it — and how much of their floor is older
            // than Earth's oldest floor still in place)
            const seas = comps(w => ocean[w] === 1 || f.owner[w] < 0).sort((a, b) => b.length - a.length);
            let old = 0;
            for (const c of seas.slice(1)) for (const w of c) if (ocean[w] && f.time - f.formedAt[w] > 340) old++;
            sealedOld.push(old * cellKm2 / 1e6);
        }
        // (branch unified) the crust's thickness (tectonics/measure.js crustThicknessKm) over the continents and the
        // cratons; and the belts as they wear: each continental belt cell's height as the history stands it (its column, its
        // uplift and swells, above an ordinary continent's column as formed), by how long its belt has been quiet — pooled
        // over the frames from 100 Myr (the start's ranges are pre-history)
        {
            const all = [], cra = [];
            for (let w = 0; w < n; w++) {
                if (!cont[w]) continue;
                const k = crustThicknessKm(TERRAIN, f.type[w], f.rootKm[w], f.upliftKm[w], f.baseKm[w]);
                all.push(k); if (f.type[w] === CrustType.CRATON) cra.push(k);
                if (f.time >= 100 && f.oroType[w] && f.oroType[w] !== OrogenyType.ARC && f.oroType[w] !== OrogenyType.RIFT) {
                    const q = Math.floor((f.time - f.oroLast[w]) / 25), h = columnKm(TERRAIN, f.type[w], f.rootKm[w]) + Math.max(0, f.upliftKm[w]) + f.baseKm[w] - columnModel(TERRAIN).ref[CrustType.CONTINENT];
                    const b = decay.get(q) ?? decay.set(q, { s: 0, n: 0 }).get(q); b.s += h; b.n++;
                }
            }
            all.sort((a, b) => a - b);
            heights.push({ time: f.time, stage: stageOf(f), crust: all.reduce((x, y) => x + y, 0) / Math.max(1, all.length), crustCraton: cra.reduce((x, y) => x + y, 0) / Math.max(1, cra.length), crustTop: all[Math.floor(0.999 * (all.length - 1))] ?? NaN });
        }
        if (f.time === 0) cont0 = cont.reduce((s, v) => s + v, 0);
        if (Math.abs(f.time - scene.maxMyr) < 1e-6) cont1200 = cont.reduce((s, v) => s + v, 0);
        if (Math.abs(f.time - 500) < 1e-6) cont500 = cont.reduce((s, v) => s + v, 0);
        if (Math.abs(f.time - 1000) < 1e-6) cont1000 = cont.reduce((s, v) => s + v, 0);
        // (the land and the sea by the stage of the cycle, every 20 Myr: the land share, the sea's level against today's datum,
        // and how high the land stands over 500 km from any coast — terrain/sea-level.js)
        if (terrain && (f.time % 20 === 0 || Math.abs(f.time - scene.maxMyr) < 1e-6)) {
            const T = synthesizeTerrain(f, mesh, tm, { seed }), share = hypsometry(T.heightKm).landShare, inner = [];
            if (f.time === 0) land0 = share; else if (Math.abs(f.time - scene.maxMyr) < 1e-6) land1200 = share;
            for (let t = 0; t < tm.numCells; t++) { const c = T.sampler.cells[3 * t]; if (T.rec.land[c] && T.rec.coastKm[c] > 500) inner.push(T.heightKm[t]); }
            // (the margins: the crust under the sea, the shelves' width by kind, the break's depth — lib/shelf-stats.mjs)
            const M = shelfStats(tm, T.heightKm, T, mesh, f);
            // (branch unified: the land's mean height and the shields' median above the sea; the continental crust's mean
            // height, under the sea or above it — its freeboard)
            {
                let sl = 0, nl = 0, sc = 0, nc = 0; const shield = [];
                for (let t = 0; t < tm.numCells; t++) {
                    const c = T.sampler.cells[3 * t], h = T.heightKm[t];
                    if (h > 0) { sl += h; nl++; }
                    if (cont[c]) { sc += h; nc++; if (f.type[c] === CrustType.CRATON && h > 0) shield.push(h); }
                }
                const H = heights.at(-1); H.land = sl / Math.max(1, nl); H.freeboard = sc / Math.max(1, nc); H.craton = median(shield);
            }
            sea.push({ time: f.time, stage: stageOf(f), land: share, seaKm: T.rec.seaKm, floorKm: T.rec.sea.ridgeSeaKm, interior: median(inner),
                submerged: M.submerged, breakKm: M.breakKm, ...Object.fromEntries(Object.keys(EARTH_SHELF_KM).map(k => [`shelf ${k}`, M.shelfKm[k]])) });
            // (island arcs above the sea, every 200 Myr: those whose slab fed them within ARC_LIVE_MYR, and the silent ones)
            if (f.time % 200 === 0 && f.time > 0) for (let t = 0; t < tm.numCells; t++) {
                const c = T.sampler.cells[3 * t];
                if (f.owner[c] < 0 || f.type[c] !== CrustType.ARC || (f.flags[c] & CrustFlag.MARGIN_ISLE)) continue;
                const k = f.time - f.arcAt[c] <= ARC_LIVE_MYR ? arcLand.live : arcLand.dead;
                k.n++; if (T.heightKm[t] > 0) k.up++;
            }
        }
        if (Math.abs(f.time - 600) < 1e-6) calm = untouched(f);
        // (lowland after the rivers carve it, comparable with Earth's hypsometry; the tectonic surface's alongside)
        if (terrain && (Math.abs(f.time - 600) < 1e-6 || Math.abs(f.time - scene.maxMyr) < 1e-6)) {
            const T = synthesizeTerrain(f, mesh, tm, { seed, carve: true });
            lowland = (lowland ?? 0) + hypsometry(T.heightKm).below400 / 2; lowlandStages.push(stageOf(f) ?? 'untracked'); lowlandRaw = (lowlandRaw ?? 0) + hypsometry(T.tectonicKm).below400 / 2;
        }
    } });
    const ev = world.events, per100 = k => 100 * ev.filter(e => e.kind === k && e.time >= 100).length / (scene.maxMyr - 100);
    const supers = ev.filter(e => e.kind === EventKind.SUPERCONTINENT).map(e => e.time), broken = ev.filter(e => e.kind === EventKind.DISPERSED).map(e => e.time);
    const rifts = ev.filter(e => e.kind === EventKind.RIFT);
    // the pace: the world's gaps between rifts, and how the start's breakup gets going — rifts within 100 Myr of the first
    const times = rifts.map(e => e.time), gaps = times.slice(1).map((t, i) => t - times[i]), early = times.filter(t => t <= (times[0] ?? 0) + 100).length;
    // dispersal: the lowest share between the first rift and the next supercontinent; and the most any landmass held
    // for CLUMP_MYR running while the pieces were dispersing
    const reassembled = supers.find(t => t > 0), lowest = Math.min(...kept.filter(k => k.time >= (rifts[0]?.time ?? 0) && k.time <= (reassembled ?? scene.maxMyr)).map(k => k.share));
    const disp = kept.filter(k => k.phase === 'dispersing');
    // (CLUMP_MYR: the per-piece wait, riftMinGapMyr, and 30 Myr more — the piece a breakup leaves holding most of the crust
    // cannot rift again sooner)
    let clump = 0;
    const span = Math.round(CLUMP_MYR / 10);
    for (let i = 0; i + span < disp.length; i++) if (disp[i + span].time - disp[i].time <= CLUMP_MYR + 1e-6) clump = Math.max(clump, Math.min(...disp.slice(i, i + span + 1).map(d => d.share)));
    // the reassembled supercontinent at its fullest, before it breaks up again
    const againAt = broken.find(t => reassembled !== undefined && t > reassembled);
    const held = reassembled === undefined ? [] : kept.filter(k => k.time >= reassembled - 30 && k.time <= (againAt ?? scene.maxMyr));
    const fullest = held.reduce((b, k) => (!b || k.share > b.share ? k : b), null);
    const weak = rifts.reduce((s, e) => s + (e.data.weakKm ?? 0), 0) / Math.max(1, rifts.reduce((s, e) => s + e.data.lengthKm, 0));
    return { seed, secs: (performance.now() - started) / 1000, supers, broken, rifts: rifts.length, gapMin: Math.min(Infinity, ...gaps), gapMedian: median(gaps), early, lowest, clump, reassembled, againAt,
        fullest: fullest && { time: fullest.time, share: fullest.share, ...shapeOf(fullest) }, weak, calm, lowland, lowlandRaw, lowlandStages, land0, land1200, contRatio: cont1200 / Math.max(1, cont0), cont0, cont500, cont1000,
        ledger: world.ledger, budget: world.budget,
        arcBiggest: Math.max(0, ...arcs.map(a => a.largest)), arcFar: Math.max(0, ...arcs.map(a => a.far)), arcAll: arcs.reduce((x, a) => x + a.all, 0) / Math.max(1, arcs.length),
        arcLiveLand: arcLand.live.up / Math.max(1, arcLand.live.n), arcDeadLand: arcLand.dead.up / Math.max(1, arcLand.dead.n), arcDeadShare: arcLand.dead.n / Math.max(1, arcLand.live.n + arcLand.dead.n),
        largestPlate: Math.max(0, ...largestShares), largestMedian: median(largestShares), frozenMost,
        staged: k => byStage(staged.map(x => ({ stage: x.stage, value: x[k] }))),
        bigMean: bigPlates.reduce((x, y) => x + y, 0) / Math.max(1, bigPlates.length), floorAge: median(floorAges), sealedOld: sealedOld.reduce((x, y) => x + y, 0) / Math.max(1, sealedOld.length),
        heights, decay, inits: per100(EventKind.SUBDUCTION_INIT), backArcs: per100(EventKind.BACKARC_OPEN), sea,
        platesMean: plateCounts.reduce((x, y) => x + y, 0) / Math.max(1, plateCounts.length), platesMin: Math.min(...plateCounts),
        shares: kept.filter(k => k.time % 100 === 0).map(k => Math.round(100 * k.share)) };
}

section('the cycle, three seeds over 1200 Myr');
const rows = SEEDS.map(seed => run(seed));
const txt = f => rows.map(r => `${r.seed}: ${f(r)}`).join(' · ');
for (const r of rows) console.log(`    seed ${r.seed} (${r.secs.toFixed(0)} s): supercontinents at ${r.supers.map(t => t.toFixed(0)).join(', ')} Myr; broken up at ${r.broken.map(t => t.toFixed(0)).join(', ')}; ${r.rifts} rifts; largest landmass every 100 Myr ${r.shares.join(' ')} %`);

check('the start world is a supercontinent', rows.every(r => r.supers[0] === 0), txt(r => `first at ${r.supers[0]?.toFixed(0)} Myr`));
// the breakup's pace (Pangea: the Central Atlantic, East–West Gondwana, India and the South Atlantic within ~50–70 Myr)
report('rifts within 100 Myr of the first', rows.map(r => r.early), { earth: [3, 5], digits: 0, source: 'Pangea’s breakup: four within ~50–70 Myr' });
report('gap between the world’s rifts: median', rows.map(r => r.gapMedian), { unit: ' Myr', digits: 0, source: 'no Earth figure over a whole cycle',
    detail: txt(r => `${r.rifts} rifts, shortest gap ${r.gapMin.toFixed(0)} Myr`) });
report('the pieces disperse: the largest landmass at its lowest', rows.map(r => 100 * r.lowest), { earth: [35, 55], unit: ' %', digits: 0, source: 'Eurasia ~37 % of land today (Afro-Eurasia split at Sinai); Laurasia about half in the Cretaceous' });
report(`the most one landmass held for ${CLUMP_MYR} Myr while the pieces dispersed`, rows.map(r => 100 * r.clump), { unit: ' %', digits: 0, source: 'no Earth figure' });
// (no period is drawn: the pieces gather once the mantle the last supercontinent warmed has cooled, cycleGatherHeat — what is
// held is that the cycle gathers one at all; when, is reported)
check('the pieces gather again into a new supercontinent within the run (≥ 70 % of the crust, held 30 Myr)', rows.every(r => r.reassembled !== undefined), txt(r => r.reassembled !== undefined ? `at ${r.reassembled.toFixed(0)} Myr` : 'never'));
report('reassembly: a new supercontinent after the start', rows.map(r => r.reassembled ?? NaN), { earth: [400, 800], unit: ' Myr', digits: 0, source: '~600 ± 100 Myr cycle, Li et al. 2019 (Nuna → Rodinia → Pangea)', detail: 'emergent: gathering waits on the mantle cooling, not a clock' });
report('…its tenure before it breaks up', rows.map(r => r.againAt !== undefined ? r.againAt - r.reassembled : NaN), { earth: [100, 200], unit: ' Myr', digits: 0, source: 'stage-matched: Pangea held ~120–150 Myr (recalled); Rodinia ~150 — assembled by ~900 Ma, broken up from ~750 Ma (Li et al. 2008; abstract checked)',
    detail: txt(r => r.againAt !== undefined ? `broken up at ${r.againAt.toFixed(0)} Myr` : 'not by 1200 Myr') });
report('rift length along old sutures, failed rifts and rifted margins', rows.map(r => 100 * r.weak), { unit: ' %', digits: 0, source: 'no Earth figure: inheritance is common, not universal (Buiter & Torsvik 2014)' });
report('the new supercontinent at its fullest: share of the crust, necks under 800 km not counted', rows.map(r => r.fullest ? 100 * r.fullest.share : NaN), { earth: [85, 95], unit: ' %', digits: 0, source: 'Pangea, the China blocks and Cimmerian terranes outside',
    detail: txt(r => r.fullest ? `at ${r.fullest.time} Myr` : '—') });
report('…joined by any land', rows.map(r => r.fullest ? 100 * r.fullest.joined : NaN), { earth: [85, 95], unit: ' %', digits: 0, source: 'Pangea', detail: txt(r => r.fullest ? `${r.fullest.areaMkm2.toFixed(0)} Mkm²` : '—') });
report('…its thinness', rows.map(r => r.fullest?.thin ?? NaN), { source: 'no Earth figure: Pangea a C round the Tethys' });
report('…the largest sea it closes in', rows.map(r => r.fullest ? r.fullest.seaKm2 / 1e6 : NaN), { unit: ' Mkm²', digits: 1, source: 'no Earth figure: introversion closes interior oceans (Murphy & Nance)' });
report('untouched land at 600 Myr', rows.map(r => r.calm ? 100 * r.calm.share : NaN), { unit: ' %', digits: 0, source: 'no Earth figure: large shields survive 600 Myr' });
report('…its largest patch', rows.map(r => r.calm?.patchMkm2 ?? NaN), { unit: ' Mkm²', digits: 1, source: 'the Canadian Shield ~8 Mkm²' });

section('island arcs and lowlands');
report('arc crust over 1500 km from any continent (most, every 200 Myr)', rows.map(r => r.arcFar), { earth: [2.5, 4], unit: ' Mkm²', digits: 1, source: '~17,000 km of intra-oceanic trench × 150–250 km, Leat & Larter 2003 — today only: no history of it found' });
// (branch arcs, 2026-10-28) all the island-arc crust: Earth's ~17,000 km of intra-oceanic arc (Leat & Larter 2003) × the
// 150–250 km an arc massif spans ≈ 2.5–4.3 Mkm², with the remnant arcs left behind back-arc basins (the Kyushu–Palau,
// West Mariana, Lau–Colville, Aves and Third ridges, ~8,000 km × 100–150 km ≈ 1 Mkm²) and the arcs along continental
// margins not yet part of their continent (Japan, the Philippines, the Aleutians' Alaskan end, ~1–2 Mkm²): ~3–8 Mkm² —
// today's; the length of the world's trenches changes over the cycle less than their place (no history found)
report('island-arc crust, all of it (mean of the frames every 200 Myr)', rows.map(r => r.arcAll), { earth: [3, 8], unit: ' Mkm²', digits: 1, source: '~17,000 km of intra-oceanic arc × 150–250 km (Leat & Larter 2003), remnant arcs ~1 Mkm², margin arcs ~1–2 Mkm² — today only' });
report('…of it, arcs silent for over 10 Myr', rows.map(r => 100 * r.arcDeadShare), { unit: ' %', digits: 0, source: 'no Earth figure: remnant arcs ~1 of ~3–8 Mkm²' });
report('live island arcs above the sea', rows.map(r => 100 * r.arcLiveLand), { unit: ' %', digits: 0, source: 'no Earth figure: the Marianas and the Aleutians a few %, Japan most of it' });
report('silent island arcs above the sea', rows.map(r => 100 * r.arcDeadLand), { earth: [0, 10], unit: ' %', digits: 0, source: 'remnant arcs drown: the Kyushu–Palau Ridge 2–3 km down after ~25 Myr (Ishizuka et al. 2011); the West Mariana, Lau and Colville ridges nearly all under water' });
report('the largest open-ocean arc landmass', rows.map(r => r.arcBiggest), { earth: [0, 1], unit: ' Mkm²', digits: 1, source: 'Izu–Bonin–Mariana ~0.6 Mkm² — today only: no history of it found' });
report('land below 400 m after carving (mean of 600 and 1200 Myr)', rows.map(r => r.lowland === null ? NaN : 100 * r.lowland), { earth: [45, 55], unit: ' %', digits: 0, source: '~54 % below 500 m, ETOPO hypsometry — today only: an icehouse lowstand with the continents dispersed; no history of hypsometry found (sea level ~+170 m in the Late Cretaceous, Müller et al. 2008, would drown much of it)',
    detail: txt(r => `${(100 * r.lowlandRaw).toFixed(0)} % before carving; the frames in the ${r.lowlandStages.join(' and ')} stages`) });

section('land and sea through the cycle');
{
    // Earth's land share depends on the stage (tools/lib/cycle-stage.mjs): a lowstand while a supercontinent stands on its
    // own warm mantle, the Cretaceous highstand after it breaks up, today between. Means over each history's frames from
    // 100 Myr (the start's placeholder ocean floor gone) in each stage, every 20 Myr
    const meanOf = (r, stage, k) => { const a = r.sea.filter(x => x.time >= 100 && x.stage === stage).map(x => x[k]); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; };
    const count = (r, stage) => r.sea.filter(x => x.time >= 100 && x.stage === stage).length;
    for (const stage of ['supercontinent', 'early dispersal', 'late dispersal'])
        report(`land share: ${stage}`, rows.map(r => 100 * meanOf(r, stage, 'land')), { ...EARTH_LAND[stage], unit: ' %', digits: 1, detail: txt(r => `${count(r, stage)} frames, sea ${(1000 * meanOf(r, stage, 'seaKm')).toFixed(0)} m`) });
    for (const stage of ['supercontinent', 'early dispersal'])
        report(`land share: ${stage} ÷ late dispersal`, rows.map(r => meanOf(r, stage, 'land') / meanOf(r, 'late dispersal', 'land')), { ...EARTH_LAND_RATIO[stage], digits: 2 });
    for (const stage of ['supercontinent', 'early dispersal', 'late dispersal'])
        report(`continental crust under the sea: ${stage}`, rows.map(r => 100 * meanOf(r, stage, 'submerged')), { ...EARTH_SUBMERGED[stage], unit: ' %', digits: 1, detail: txt(r => `${count(r, stage)} frames; the sim's crust is ~its land (tectonics continentalFraction), so the slopes' and shelves' share is small`) });
    // (shelves and the break hold through the cycle: means over all frames from 100 Myr, NaN frames skipped)
    const meanAll = (r, k) => { const a = r.sea.filter(x => x.time >= 100 && Number.isFinite(x[k])).map(x => x[k]); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; };
    for (const kind of Object.keys(EARTH_SHELF_KM))
        report(`shelf width: ${kind} coasts`, rows.map(r => meanAll(r, `shelf ${kind}`)), { ...EARTH_SHELF_KM[kind], unit: ' km', digits: 0, detail: txt(r => `by stage: ${['supercontinent', 'early dispersal', 'late dispersal'].map(st => `${st} ${Math.round(meanOf(r, st, `shelf ${kind}`))}`).join(', ')}`) });
    report('shelf break depth off passive coasts', rows.map(r => 1000 * meanAll(r, 'breakKm')), { earth: EARTH_BREAK_KM.earth.map(v => 1000 * v), source: EARTH_BREAK_KM.source, unit: ' m', digits: 0 });
    // the first-order swing: the sea's level smoothed over 60 Myr (three frames; Earth's first-order cycle is over 100 Myr
    // long — the shorter cycles are glacial and tectonic noise), its highest less its lowest from 100 Myr
    const swing = (r, k) => { const s = r.sea.filter(x => x.time >= 100).map(x => x[k]), m = s.slice(1, -1).map((v, i) => (s[i] + v + s[i + 2]) / 3); return m.length ? Math.max(...m) - Math.min(...m) : NaN; };
    report('sea level: first-order swing over the cycle', rows.map(r => swing(r, 'seaKm')), { earth: [0.2, 0.3], unit: ' km', digits: 2, source: 'Pangaea’s lowstand to the Cretaceous highstand, ~200–300 m (Haq & Al-Qahtani 2005; Müller et al. 2008)',
        detail: txt(r => `by stage ${['supercontinent', 'early dispersal', 'late dispersal'].map(st => `${Math.round(1000 * meanOf(r, st, 'seaKm'))}`).join(' / ')} m`) });
    // (the sea floor's age, computed but not counted — terrain-config.js seaLevelFloorAge: the history's floor is older than Earth's)
    report('…the swing the sea floor’s age would add (not counted)', rows.map(r => swing(r, 'floorKm')), { unit: ' km', digits: 2, source: 'Earth’s ridge volume alone ~250 m since the Cretaceous (Müller et al. 2008)',
        detail: txt(r => `by stage ${['supercontinent', 'early dispersal', 'late dispersal'].map(st => `${Math.round(1000 * meanOf(r, st, 'floorKm'))}`).join(' / ')} m`) });
    // the supercontinent's interior against the dispersed continents' (median height over 500 km from any coast)
    report('interior height: supercontinent less late dispersal', rows.map(r => meanOf(r, 'supercontinent', 'interior') - meanOf(r, 'late dispersal', 'interior')), { earth: [0.2, 1], unit: ' km', digits: 2,
        source: 'a supercontinent on its own warm mantle rises a few hundred m to ~1 km (Gurnis 1988); the African superswell, Pangaea’s legacy, ~0.5 km (Nyblade & Robinson 1994)',
        detail: txt(r => `${meanOf(r, 'supercontinent', 'interior').toFixed(2)} vs ${meanOf(r, 'late dispersal', 'interior').toFixed(2)} km`) });
}

section('heights from the crust (branch unified)');
{
    // One physical height (tectonics/measure.js columnModel): each continental cell stands by isostasy on its crust and
    // lithosphere, and erosion takes the whole height down, thinning the crust (tectonics/step/heights.js). What comes out:
    const H = (r, k, from = 300) => r.heights.filter(x => x.time >= from && Number.isFinite(x[k]));
    const meanH = (r, k, stage, from) => { const a = H(r, k, from).filter(x => !stage || x.stage === stage).map(x => x[k]); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; };
    report('land: mean height above the sea, late dispersal', rows.map(r => meanH(r, 'land', 'late dispersal', 100)), { earth: [0.75, 0.95], unit: ' km', digits: 2,
        source: 'Earth\'s land ~840 m on average (ETOPO hypsometry; Cogley 1984 — recalled) — today only: the late-dispersal frames',
        detail: txt(r => `by stage ${['supercontinent', 'early dispersal', 'late dispersal'].map(st => meanH(r, 'land', st, 100).toFixed(2)).join(' / ')} km`) });
    report('cratons: median height above the sea', rows.map(r => meanH(r, 'craton', null, 300)), { earth: [0.4, 0.6], unit: ' km', digits: 2,
        source: 'shields stand ~400–600 m (their freeboard: a thick crust on a cold, depleted root — Jordan 1978; Kaban et al. 2003) — holds through the cycle; frames from 300 Myr' });
    report('continental crust: mean thickness', rows.map(r => meanH(r, 'crust', null, 300)), { earth: [38, 42], unit: ' km', digits: 1,
        source: '41.1 km weighted over the continents, extended crust 30.5, orogens 46.3 (Christensen & Mooney 1995, JGR 100); ~39 with the shelves — holds through the cycle; frames from 300 Myr' });
    report('cratons: mean crustal thickness', rows.map(r => meanH(r, 'crustCraton', null, 300)), { earth: [40, 45], unit: ' km', digits: 1,
        source: 'shields and platforms ~40–43 km, about the continents\' mean (Christensen & Mooney 1995) — frames from 300 Myr' });
    report('the thickest crust (99.9th percentile, most over the frames)', rows.map(r => Math.max(...H(r, 'crustTop', 100).map(x => x.crustTop))), { earth: [60, 75], unit: ' km', digits: 0,
        source: 'Tibet ~70 km, about twice normal (Owens & Zandt 1997); the Altiplano ~70 km' });
    // old belts wear down: the e-folding of their height above an ordinary continent's column as formed, fitted (log-linear,
    // weighted by cells) over 25–300 Myr after their belt fell quiet
    const efold = r => {
        let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (const [q, b] of r.decay) { const t = 25 * (q + 0.5), m = b.s / b.n; if (q < 1 || t > 300 || !(m > 0.02) || b.n < 20) continue; const y = Math.log(m); sw += b.n; sx += b.n * t; sy += b.n * y; sxx += b.n * t * t; sxy += b.n * t * y; }
        const slope = (sw * sxy - sx * sy) / (sw * sxx - sx * sx);
        return slope < 0 ? -1 / slope : NaN;
    };
    report('old orogens: their height e-folds over', rows.map(efold), { earth: [100, 200], unit: ' Myr', digits: 0,
        source: 'post-orogenic decay with isostatic rebound, ~100–200 Myr (Baldwin et al. 2003, JGR 108: the Appalachians and the Urals still stand ~1–2 km after 250+ Myr) — a fate, through the cycle',
        detail: txt(r => [1, 4, 8, 12].map(q => r.decay.get(q)).map((b, i) => b ? `${[1, 4, 8, 12][i] * 25} Myr ${(b.s / b.n).toFixed(2)}` : '').filter(Boolean).join(', ') + ' km') });
    // freeboard: the continental crust's mean height (under the sea or above it) late in the run against earlier — Earth's
    // continents have kept their freeboard within ~±200 m since the late Archean (Flament et al. 2008, EPSL 275: thermal
    // models with hypsometry; the "constant freeboard" of Wise 1974)
    report('freeboard: the continents\' mean height, 900–1200 Myr less 300–600 Myr', rows.map(r => { const a = H(r, 'freeboard', 300).filter(x => x.time <= 600), b = H(r, 'freeboard', 900); const m = v => v.reduce((x, y) => x + y.freeboard, 0) / Math.max(1, v.length); return m(b) - m(a); }),
        { earth: [-0.2, 0.2], unit: ' km', digits: 2, source: 'continental freeboard constant within ~±200 m since the late Archean (Flament et al. 2008, EPSL 275; Wise 1974)',
            detail: txt(r => `${H(r, 'freeboard', 300).filter((x, i) => i % 15 === 0).map(x => `${x.time}: ${x.freeboard.toFixed(2)}`).join(', ')} km`) });
}

section('the crust over the history');
// (the ledger's per-step books are held in check-invariants.mjs; here the history's totals. Earth's continental crust has
// been near steady over the last Gyr: growth at arcs about balancing loss at margins — Dhuime et al. 2012; Scholl & von
// Huene 2009. A runaway either way is a broken budget, not a different planet)
check('the continental crust does not run away: at 1200 Myr ×0.5–2 of the start', rows.every(r => r.contRatio >= 0.5 && r.contRatio <= 2), txt(r => `×${r.contRatio.toFixed(2)}`));
report('continental crust at 1200 Myr ÷ the start', rows.map(r => r.contRatio), { earth: [0.9, 1.1], source: 'near steady over 1.2 Gyr, Dhuime et al. 2012; Scholl & von Huene 2009' });
report('land above sea level: change over 1200 Myr', rows.map(r => 100 * (r.land1200 - r.land0)), { unit: ' pts', digits: 1, source: 'no Earth figure', detail: txt(r => `${(100 * r.land0).toFixed(1)} → ${(100 * r.land1200).toFixed(1)} %`) });
{
    const Mkm2 = cells => cells * cellKm2 / 1e6;
    const stages = [...new Set(rows.flatMap(r => Object.keys(r.ledger?.stages ?? {})))].filter(st => rows.some(r => r.ledger?.stages[st]?.land || r.ledger?.stages[st]?.arc));
    for (const st of stages) report(`ledger, ${st}: net continental crust`, rows.map(r => Mkm2(r.ledger?.stages[st]?.land ?? 0)), { unit: ' Mkm²', digits: 2, source: 'no Earth figure per stage',
        detail: txt(r => `arc ${Mkm2(r.ledger?.stages[st]?.arc ?? 0).toFixed(2)} Mkm²`) });
    for (const [key, what] of [['arcMaturedCells', 'arcs matured into continent'], ['sealedCells', 'sea filled at welds and docks'], ['sealPaidCells', 'continental coast given back for it'], ['arcPaidCells', 'coast given back for arc filled in'], ['isleRaisedCells', 'fore-arc islands raised'], ['erodedCells', 'lost to erosive margins'], ['sedimentCells', 'lost as sediment down the trenches'], ['underthrustCells', 'lost underthrusting'], ['recycledCells', 'arc crust recycled']])
        report(`budget: ${what}`, rows.map(r => Mkm2(r.budget[key] ?? 0)), { unit: ' Mkm²', digits: 2, source: 'no Earth figure in area' });
}

section('the crust budget against Earth’s (crust-sink)');
{
    // The continental crust's books in Earth's units. Scholl & von Huene (2009): arcs add ~2.7 km³/yr (AU) — 1.5 at
    // intra-oceanic arcs, 1.0 at continental ones, 0.2 at collisions — and ~3.2 AU is lost: ~60 km³/Myr per km along the
    // ~42,000 km of ocean-margin subduction zones (≈ 2.5 AU; ~60 % subduction erosion, ~40 % sediment subduction) and
    // ~0.7 AU where continents collide. Per km of ocean-margin trench: additions ≈ 2.5 AU ÷ 42,000 km ≈ 60 km³/Myr, losses
    // ≈ 3.2 AU ÷ 42,000 km ≈ 77; Clift & Vannucchi (2004) put what arcs must make to hold the crust steady at > 90. The
    // engine books area; volume is area × continentCrustKm (40 km), per km of OVERRIDING trench over the run
    // (world.budget.trenchKmMyr). Its additions are arcs maturing on a continent, sea sealed at welds (net of the coast that
    // pays for it) and fore-arc islands (the prism risen: the sediment scraped off); its losses
    // erosive margins, sediment down the trenches, underthrusting at collisions, and fragments tidied away (the ledger).
    const Mkm2 = cells => cells * cellKm2 / 1e6, th = TECTONICS.continentCrustKm, perKm = (r, cells) => cells * cellKm2 * th / Math.max(1, r.budget.trenchKmMyr ?? 0);
    const st = (r, k) => r.ledger?.stages[k]?.land ?? 0;
    const sealedNet = r => (r.budget.sealedLandCells ?? r.budget.sealedCells ?? 0) - (r.budget.sealPaidCells ?? 0);
    const added = r => (r.budget.arcMaturedCells ?? 0) + sealedNet(r) + Math.max(0, st(r, 'marginIsles') + (r.budget.erodedCells ?? 0));
    const lost = r => (r.budget.erodedCells ?? 0) + (r.budget.sedimentCells ?? 0) + (r.budget.underthrustCells ?? 0) - Math.min(0, st(r, 'tidy'));
    report('continental crust change over 500 Myr: 0 → 500 Myr', rows.map(r => 100 * (r.cont500 / Math.max(1, r.cont0) - 1)), { earth: [-10, 10], unit: ' %', digits: 1,
        source: 'additions ≈ losses, net Phanerozoic growth "effectively nil" (Scholl & von Huene 2009); 60–80 % of today’s crust by 3 Ga (Dhuime et al. 2012)' });
    report('…500 → 1000 Myr', rows.map(r => 100 * (r.cont1000 / Math.max(1, r.cont500) - 1)), { earth: [-10, 10], unit: ' %', digits: 1, source: 'as above' });
    report('erosive share of continental-margin trench (length × time)', rows.map(r => 100 * (r.budget.erosiveTrenchKmMyr ?? 0) / Math.max(1, r.budget.marginTrenchKmMyr ?? 0)), { earth: [50, 60], unit: ' %', digits: 0,
        source: '"57 % of the global active margins seem to be of the erosive type" (Clift & Vannucchi 2004, Rev. Geophys. 42; checked) — today\'s margins: convergence > 6 cm/yr or < 1 km of trench sediment',
        detail: txt(r => `${(100 * (r.budget.marginTrenchKmMyr ?? 0) / Math.max(1, r.budget.trenchKmMyr ?? 0)).toFixed(0)} % of ${((r.budget.trenchKmMyr ?? 0) / scene.maxMyr / 1000).toFixed(1)}k km of overriding trench on a continental margin`) });
    report('crust added per km of trench', rows.map(r => perKm(r, added(r))), { earth: [30, 65], unit: ' km³/Myr/km', digits: 0,
        source: 'arc additions ~1.1 AU (Reymer & Schubert 1984) to ~2.7 AU (Scholl & von Huene 2009) over ~42,000 km of trench',
        detail: txt(r => `arcs matured ${perKm(r, r.budget.arcMaturedCells ?? 0).toFixed(0)}, seams sealed net ${perKm(r, sealedNet(r)).toFixed(0)} (filled ${perKm(r, r.budget.sealedLandCells ?? 0).toFixed(0)}, paid ${perKm(r, r.budget.sealPaidCells ?? 0).toFixed(0)}), fore-arc islands ${perKm(r, Math.max(0, st(r, 'marginIsles') + (r.budget.erodedCells ?? 0))).toFixed(0)}`) });
    report('crust lost per km of trench', rows.map(r => perKm(r, lost(r))), { earth: [60, 95], unit: ' km³/Myr/km', digits: 0,
        source: '~77: 2.5 AU at ocean margins + 0.7 AU at collisions over ~42,000 km (Scholl & von Huene 2009); > 90 (Clift & Vannucchi 2004)',
        detail: txt(r => `eroded ${perKm(r, r.budget.erodedCells ?? 0).toFixed(0)}, sediment ${perKm(r, r.budget.sedimentCells ?? 0).toFixed(0)}, underthrust ${perKm(r, r.budget.underthrustCells ?? 0).toFixed(0)}, tidied ${perKm(r, -Math.min(0, st(r, 'tidy'))).toFixed(0)}`) });
    // (sediment subduction two ways: all the rivers' rock that goes down the channels — Earth's figure, which counts arcs'
    // rock as continental crust — and, booked as the continents' loss above, the share that was the continents' own)
    report('sediment subducted per km of trench, all the rivers\' rock', rows.map(r => (r.budget.sedimentAllKm3 ?? 0) / Math.max(1, r.budget.trenchKmMyr ?? 0)), { earth: [15, 35], unit: ' km³/Myr/km', digits: 0,
        source: '~40 % of ~60 at ocean margins (Scholl & von Huene 2009), arc crust counted as continental' });
    report('…of it, the continents\' own rock (lost above)', rows.map(r => perKm(r, r.budget.sedimentCells ?? 0)), { unit: ' km³/Myr/km', digits: 0,
        source: 'no Earth figure: the engine keeps arc crust apart from continent', detail: txt(r => `the trenches' flux ${((r.budget.sedimentKm3 ?? 0) / Math.max(1, r.budget.trenchKmMyr ?? 0)).toFixed(0)} (what found no coast around its mouth is not booked)`) });
    report('sediment scraped off into the prisms per km of trench', rows.map(r => (r.budget.wedgeKm3 ?? 0) / Math.max(1, r.budget.trenchKmMyr ?? 0)), { unit: ' km³/Myr/km', digits: 1,
        source: 'no Earth figure in this form: accretionary prisms hold the part of the trench fill the subduction channel cannot take (Clift & Vannucchi 2004)',
        detail: txt(r => `islands raised ${Mkm2(r.budget.isleRaisedCells ?? 0).toFixed(1)} Mkm²`) });
    report('…of it, subduction erosion per km of trench', rows.map(r => perKm(r, r.budget.erodedCells ?? 0)), { earth: [25, 45], unit: ' km³/Myr/km', digits: 0,
        source: '~60 % of ~60 at ocean margins (Scholl & von Huene 2009) — intra-oceanic fore-arcs (Tonga, Mariana) included, which the engine does not erode' });
}

section('living plates (plans/V2_REALISM_PASS_PLAN.md, phase 2)');
// (the recordings, 2026-10-18: with no boundary to found a trench on, a plate that held its continents and its whole ocean
// never broke up again — one plate held 79–100 % of the planet at some point in 5 of 6 histories, and a world froze as a
// single plate for 200 Myr; old margins inside a plate now founder too: step/subduction-init.js founderWithinPlates)
check(`no plate freezes the planet: none holds over ${100 * FREEZE} % of it for over ${FREEZE_MYR} Myr (from 100 Myr on)`,
    rows.every(r => r.frozenMost <= FREEZE_MYR), txt(r => `longest over ${100 * FREEZE} %: ${r.frozenMost} Myr`));
report('the largest plate’s share of the planet: most from 100 Myr', rows.map(r => 100 * r.largestPlate), { earth: [15, 30], unit: ' %', digits: 0, source: 'the Pacific ~20 % today — a snapshot: the Izanagi plate was the largest until ~100 Ma (Morra et al. 2013, EPSL 373; checked), and no share through time is found, so today\'s range stands',
    detail: txt(r => `median ${(100 * r.largestMedian).toFixed(0)} %; most by stage ${stageText(r.staged('largest'), v => `${(100 * Math.max(...v)).toFixed(0)} %`)}`) });
check('the lid stays mobile: never fewer than 2 plates holding ≥ 1 % of the planet', rows.every(r => r.platesMin >= 2), txt(r => `at least ${r.platesMin}`));
// (stage-matched: today's count is a dispersed world's — Earth had 10 plates in all at 200 Ma, 31 today in the Seton 2012
// reconstruction, Morra et al. 2013 — so the frames in late dispersal, as Earth today, are the ones compared)
report('plates holding ≥ 1 % of the planet: mean in late dispersal', rows.map(r => { const d = r.staged('plates')['late dispersal']; return d.length ? d.reduce((x, y) => x + y, 0) / d.length : NaN; }), { earth: [12, 14], digits: 1,
    source: 'today (late dispersal): Bird 2003 (the mesh resolves fewer small plates); through time 10 plates in all at 200 Ma → 31 today (Morra et al. 2013)',
    detail: txt(r => `over every frame from 100 Myr ${r.platesMean.toFixed(1)}; by stage ${stageText(r.staged('plates'), v => `${(v.reduce((x, y) => x + y, 0) / v.length).toFixed(1)} (${v.length} frames)`)}`) });
report('plates over 10^7.5 km² (31.6 Mkm²): mean from 100 Myr', rows.map(r => r.bigMean), { earth: [6, 8], digits: 1, source: '7 today (Pacific, Eurasia, N America, Africa, Antarctica, Australia, S America: Bird 2003); holds through the cycle: the size kink at 10^7.5 km² with ~8 plates above it at every step back to 200 Ma (Morra et al. 2013; checked)' });
// (the pace of the plates' renewal over a whole cycle, from 100 Myr: new trenches — between plates, at a margin inside one, or
// across a plate's open ocean (step/subduction-init.js) — the sea floor's age, and back-arc seas opening)
report('subduction initiations per 100 Myr, from 100 Myr', rows.map(r => r.inits), { earth: [12, 30], digits: 1, source: 'a rate: 13 initiations since ~105 Ma, mostly induced (Crameri et al. 2020, Nat. Commun. 11; checked) — the database is a floor, and the window is the dispersal stage' });
report('mean sea-floor age: median over the frames from 100 Myr', rows.map(r => r.floorAge), { earth: [35, 65], unit: ' Myr', digits: 0,
    source: 'Earth over the last 200 Myr: ~35–40 in the Early Cretaceous to ~62–64 today (Müller et al. 2008; Seton et al. 2020: 64.2; the swings, −15 then +25 Myr, Williams et al. 2021, Geosci. Front. 12; van der Meer et al. 2017 < 40 in the Cretaceous)',
    detail: txt(r => `by stage ${stageText(r.staged('floorAge'), v => `${median(v).toFixed(0)} Myr`)} (Earth in late dispersal, today: ~62–64)`) });
report('sealed seas’ floor older than 340 Myr: mean over the frames from 100 Myr', rows.map(r => r.sealedOld), { unit: ' Mkm²', digits: 2,
    source: 'no Earth figure: the oldest ocean floor still in place, the Herodotus Basin’s under the eastern Mediterranean, is ~340 Myr (Granot 2016)' });
report('back-arc seas opened per 100 Myr, from 100 Myr', rows.map(r => r.backArcs), { earth: [20, 40], digits: 1, source: 'a rate: ~15–25 opened in the Cenozoic (Lau, Mariana, Okinawa, Tyrrhenian, Scotia, Japan, Shikoku…; count recalled, unconfirmed)' });

section('the switches');
{
    // with the heat and the mantle flow switched off, the pieces are left to their trenches: the Phase 12 engine
    const off = run(12345, { ...MECHANISMS.mantleHeatRifts, ...MECHANISMS.mantleFlow }, { terrain: false });
    check('switched off (mantleHeatRifts, mantleFlow), seed 12345 runs as before them: no cycle tracked, no mantle flow',
        off.supers.length === 0, `${off.supers.length} supercontinent events; largest landmass every 100 Myr ${off.shares.join(' ')} %`);
}

section('choose your ending');
{
    // one history run on as far as a history may (1200 + endingExtraMyr): where each ending would stop it
    const seed = 12345, world = scene.build(mesh, seed), light = [];
    // (through the history cache, tools/lib/history-cache.mjs: the run with the ending below is built afresh, and must agree)
    simulateCached(world, { untilMyr: scene.maxMyr + TECTONICS.endingExtraMyr, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false,
        onFrame: f => light.push({ time: f.time, cycle: f.cycle, events: f.events, owner: f.owner }) }, { drive: scene.drive });
    const ends = ENDINGS.filter(e => e.id !== 'none').map(e => ({ ...e, frames: framesEnding(light, scene.maxMyr, e.id, TECTONICS) }));
    // (the cycle's pace is the mantle's, so a stage need not come round within endingExtraMyr: an ending not reached is
    // reported, and the history then ends where it got to — ending.js. What is held: at least one is reached, and every
    // one reached is really in its stage)
    const reached = ends.filter(e => e.frames);
    check('an ending is reached after 1200 Myr, within endingExtraMyr (seed 12345)', reached.length >= 1,
        ends.map(e => `${e.id} at ${e.frames ? e.frames.at(-1).time.toFixed(0) + ' Myr' : 'never'}`).join(' · '));
    report('endings reached within endingExtraMyr (seed 12345)', reached.length, { digits: 0, source: `of ${ends.length}; no Earth figure`,
        detail: ends.map(e => `${e.id} at ${e.frames ? e.frames.at(-1).time.toFixed(0) + ' Myr' : 'never (the cycle had not come round)'}`).join(' · ') });
    check('…and the last frame of each reached is in that stage (the cycle as the lab shows it)', reached.every(e => inStage(e.frames.at(-1), e.id, TECTONICS)),
        reached.map(e => `${e.id}: largest landmass ${(100 * e.frames.at(-1).cycle.share).toFixed(0)} %, ${e.frames.at(-1).cycle.state}`).join(' · '));
    // a history run with an ending stops there — and is the same history up to it
    const pick = ends.filter(e => e.frames).sort((a, b) => a.frames.at(-1).time - b.frames.at(-1).time)[0];
    if (pick) {
        const w2 = scene.build(mesh, seed), { untilMyr, stopAt } = historyEnding(scene.maxMyr, pick.id, w2.config);
        const r = simulate(w2, { untilMyr, stopAt, drive: w => scene.drive(w), snapshotEveryMyr: 10 });
        const same = r.frames.length === pick.frames.length && r.frames.every((f, i) => f.time === pick.frames[i].time && f.owner.every((o, w) => o === pick.frames[i].owner[w]));
        check(`run with the ending "${pick.id}", the history stops there, and is the same history up to it`, r.stopped && same,
            `stopped at ${r.frames.at(-1).time.toFixed(0)} Myr (expected ${pick.frames.at(-1).time.toFixed(0)}); ${same ? 'every frame the same' : 'frames differ'}`);
    }
}

finish('Phase 13');
