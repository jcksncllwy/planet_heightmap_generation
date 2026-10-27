// Headless acceptance checks for Phase 11 (natural collisions — plans/V2_ROADMAP_PHASES_9_13.md): a contact is a pivot,
// and two continents weld only once the ocean between them has closed (or stopped closing), so a collision closes the
// ocean between them like a zipper instead of sealing it inside one plate. A sea sealed inside one plate makes no
// continental crust: old and big enough, its floor founders as an ocean plate of its own under a trench along the shore
// (step/subduction-init.js founderWithinPlates); young and unsqueezed, it stays open. Over whole histories (three seeds)
// belt records stay consistent and island arcs still stand; the seas caught between continents and the continents'
// shapes (thinness, elongation — measured on continental crust) are reported against Earth's.
// Usage: node v2/tools/check-phase11.mjs

import { check, report, section, finish, labMesh, LAB_MESH_SEED } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { COLLISION_SCENES } from '../js/tectonics/scenarios/collision-scenes.js';
import { BUDGET_SCENES } from '../js/tectonics/scenarios/budget-scenes.js';
import { buildStartWorld } from '../js/tectonics/init/start-world.js';
import { onlyMechanisms, TECTONICS } from '../js/tectonics/config.js';
import { updatePlateMotion } from '../js/tectonics/step/torque-balance.js';
import { TectonicWorld, EventKind } from '../js/tectonics/model/world.js';
import { CrustType, CrustFlag } from '../js/tectonics/model/crust.js';
import { sceneCanvas, addContinent, fillBackground } from '../js/tectonics/scenarios/scene-kit.js';
import { spreadKm } from '../js/core/min-heap.js';
import { SimplexNoise } from '../../js/simplex-noise.js';
import { seaFilledUp } from '../js/tectonics/measure.js';
import { stageOf, byStage, stageText } from './lib/cycle-stage.mjs';

const mesh = labMesh(), n = mesh.numCells, cellKm2 = mesh.cellAreaKm2;
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

// ── the zipper: first contact at an angle; the lower plate turns about it; the weld waits for the seam ──
section('two continents meeting at an angle');
const zipper = overrides => {
    const world = COLLISION_SCENES.find(s => s.id === 'zipper').build(mesh, LAB_MESH_SEED);
    Object.assign(world.config, onlyMechanisms(), overrides);
    const { frames } = simulate(world, { untilMyr: 100, drive: updatePlateMotion, snapshotEveryMyr: 2 });
    const turn = f => { const a = f.plates[0].quat, b = f.plates[1].quat; return 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180 / Math.PI; };
    const at = t => frames.reduce((b, f) => Math.abs(f.time - t) < Math.abs(b.time - t) ? f : b);
    const contact = world.events.find(e => e.kind === EventKind.COLLISION)?.time, weld = world.events.find(e => e.kind === EventKind.SUTURE);
    if (contact === undefined || !weld) return { contact, weld };
    return { contact, weld, turned: turn(at(weld.time - 2)) - turn(at(contact)), gapMkm2: weld.data.gapKm2 / 1e6, widestKm: weld.data.gapWidestKm, limitKm: world.config.sutureGapWidthKm + mesh.edgeKm };
};
{
    const now = zipper({});
    // (Phase 12: a long Borea, so the turn can close the whole margin; the weld waits until the sea between is narrow at
    // its widest — before, a wedge of it at one end passed as "narrow on average". How far it turns and how long it takes
    // are the scene's: reported)
    check('after first contact the two weld only once the sea between them is closed along the whole margin',
        now.weld && now.weld.time > now.contact && now.widestKm <= now.limitKm,
        now.weld ? `first contact at ${now.contact.toFixed(0)} Myr, weld at ${now.weld.time.toFixed(0)} Myr; the sea left between them ${now.widestKm?.toFixed(0)} km across at its widest (limit ${now.limitKm.toFixed(0)} km; ${now.gapMkm2.toFixed(2)} Mkm² along the whole margin); welded as ${now.weld.data.why}` : 'no weld');
    report('the lower continent turns about the contact before the weld', now.weld ? now.turned : NaN, { unit: '°', digits: 1, source: 'no Earth figure: collisions are diachronous (the Tethys zipper)',
        detail: now.weld ? `over ${(now.weld.time - now.contact).toFixed(0)} Myr` : 'no weld' });
}

// ── a sea sealed inside one plate: no crust is made; old and big it founders, young it stays open ──
section('a sea sealed inside one plate');
{
    // a round sea, 700 km in radius, in the middle of a continent; its floor formed `ageMyr` before the run. The sea is made
    // big enough to be a plate of its own: oceanPlateMinAreaKm2 set below its area (the scene's, at any mesh resolution)
    const sealed = (ageMyr, untilMyr) => {
        const world = new TectonicWorld(mesh, LAB_MESH_SEED), canvas = sceneCanvas(mesh, world.config);
        const solo = world.addPlate('Solo');
        addContinent(canvas, new SimplexNoise(LAB_MESH_SEED), { plate: solo, centre: [10, 20], radiusKm: 2600, cratonKm: 0 });
        fillBackground(canvas, world, world.config);
        const c = [Math.cos(10 * Math.PI / 180) * Math.cos(20 * Math.PI / 180), Math.cos(10 * Math.PI / 180) * Math.sin(20 * Math.PI / 180), Math.sin(10 * Math.PI / 180)];
        let seaCells = 0;
        for (let i = 0; i < n; i++) if (solo.crust.mask[i] && Math.acos(Math.min(1, mesh.xyz[3 * i] * c[0] + mesh.xyz[3 * i + 1] * c[1] + mesh.xyz[3 * i + 2] * c[2])) * 6371 < 700) { solo.crust.type[i] = CrustType.OCEAN; solo.crust.formedAt[i] = -ageMyr; seaCells++; }
        solo.refreshExtent(mesh.xyz);
        const seaKm2 = seaCells * cellKm2;
        Object.assign(world.config, onlyMechanisms('marginFounder'), { crustLedger: true, oceanPlateMinAreaKm2: 0.6 * seaKm2 });
        const { frames } = simulate(world, { untilMyr, drive: updatePlateMotion, snapshotEveryMyr: 5 });
        const founders = world.events.filter(e => (e.kind === EventKind.SUBDUCTION_INIT && e.data?.upper === solo.id) || (e.kind === EventKind.PLATE_BORN && e.time > 0));
        const born = founders.find(e => e.kind === EventKind.PLATE_BORN), init = founders.find(e => e.kind === EventKind.SUBDUCTION_INIT);
        // (the plate's own raster: its continental crust and its ocean, frame by frame)
        const land = frames.map(f => f.plates[solo.id]?.landCells ?? 0), sea = frames.map(f => { const p = f.plates[solo.id]; return p ? (p.cells - p.landCells) * cellKm2 : 0; });
        let landRose = 0;
        for (let i = 1; i < frames.length; i++) if (sea[i - 1] > 0 && land[i] > land[i - 1]) landRose = Math.max(landRose, land[i] - land[i - 1]);
        // (stages whose process may change the land: collisions, marginIsles, arcMaturation, tidy — none of them a sealed sea's)
        const MAY = new Set(['collisions', 'marginIsles', 'arcMaturation', 'tidy']);
        const gained = world.ledger ? Object.entries(world.ledger.stages).filter(([st, b]) => !MAY.has(st) && b.land > 0).map(([st, b]) => `${st} +${b.land}`) : ['no ledger kept'];
        // after the founder: the new plate's floor, and the trench on the rim plate's shore (its ocean beside its land)
        const after = born && frames.find(f => f.time >= born.time);
        let trench = 0, freshKm2 = 0;
        if (after) {
            const isLandOf = w => after.owner[w] === solo.id && (after.type[w] === CrustType.CONTINENT || after.type[w] === CrustType.CRATON);
            for (let w = 0; w < n; w++) {
                if (after.owner[w] !== solo.id || after.type[w] !== CrustType.OCEAN || !(after.flags[w] & CrustFlag.TRENCH)) continue;
                for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1]; k++) if (isLandOf(mesh.adjList[k])) { trench++; break; }
            }
            freshKm2 = (after.plates[born.data.plate]?.cells ?? 0) * cellKm2;
        }
        return { seaKm2, frames, land, sea, landRose, gained, founders, born, init, trench, freshKm2, minKm2: world.config.oceanPlateMinAreaKm2 };
    };
    const old = sealed(300, 120), young = sealed(10, 120);
    const ok = r => r.landRose === 0 && r.gained.length === 0;
    check('a sealed sea makes no continental crust: its plate’s land never grows while the sea is there, and no stage books land it may not',
        ok(old) && ok(young), [['old', old], ['young', young]].map(([k, r]) => `${k}: land ${r.land[0]} → ${r.land.at(-1)} cells (largest rise ${r.landRose}); ${r.gained.length ? r.gained.join(', ') : 'no stage gained'}`).join(' · '));
    check('an old sealed sea big enough to be a plate founders: its floor breaks away as an ocean plate, under a trench along the shore',
        old.born && old.init && old.freshKm2 >= 0.5 * old.seaKm2 && old.trench * mesh.edgeKm >= 0.5 * old.init.data.lengthKm,
        old.born ? `${(old.seaKm2 / 1e6).toFixed(2)} Mkm² sea, 300 Myr old (plates from ${(old.minKm2 / 1e6).toFixed(2)} Mkm²): founders at ${old.born.time.toFixed(0)} Myr; the new plate holds ${(old.freshKm2 / 1e6).toFixed(2)} Mkm²; ${old.trench} cells (${(old.trench * mesh.edgeKm).toFixed(0)} km) of trench along the shore (the founder's run ${old.init.data.lengthKm.toFixed(0)} km)`
            : `no founder in 120 Myr; the sea ${old.sea.map(a => (a / 1e6).toFixed(2)).join(' ')} Mkm²`);
    check('a young sealed sea, unsqueezed, stays open: no founder over 120 Myr',
        young.founders.length === 0 && young.sea.at(-1) >= 0.9 * young.sea[0],
        `${(young.sea[0] / 1e6).toFixed(2)} → ${(young.sea.at(-1) / 1e6).toFixed(2)} Mkm², its floor 10 Myr old at the start (young below ${TECTONICS.oceanNeutralAgeMyr} Myr, founders unsqueezed from ${TECTONICS.subductionInitAgeMyr} Myr); ${young.founders.length} founder events`);
}

// ── whole histories: seas between continents, rings and snakes ──
section('whole histories (600 Myr, three seeds)');
{
    const comps = inSet => { const id = new Int32Array(n).fill(-1), out = []; for (let w = 0; w < n; w++) { if (!inSet(w) || id[w] >= 0) continue; const q = [w]; id[w] = out.length; for (let i = 0; i < q.length; i++) for (let k = mesh.adjOffset[q[i]]; k < mesh.adjOffset[q[i] + 1]; k++) { const nb = mesh.adjList[k]; if (inSet(nb) && id[nb] < 0) { id[nb] = out.length; q.push(nb); } } out.push(q); } return out; };
    const d = new Float32Array(n);
    const lengthKm = cells => { const inC = new Uint8Array(n); for (const w of cells) inC[w] = 1; const far = s => { d.fill(Infinity); d[s] = 0; spreadKm(mesh, d, { canEnter: (a, q) => inC[q] === 1 }); let b = s; for (const w of cells) if (d[w] > d[b]) b = w; return [b, d[b]]; }; const [a] = far(cells[0]); return far(a)[1]; };
    // (continental crust only: an island arc is a chain of islands on a ridge — a sea behind one is open water)
    const measure = f => {
        const cont = w => f.owner[w] >= 0 && (f.type[w] === CrustType.CONTINENT || f.type[w] === CrustType.CRATON);
        // (a sea's area is its ocean floor: island-arc crust closed inside a continent is not open water — Phase 11, seed
        // 12345 from 530 Myr: ~2 Mkm² of arc terranes held in one plate, no ocean in them)
        const oceanKm2 = c => c.reduce((s, w) => s + (f.type[w] === CrustType.OCEAN ? cellKm2 : 0), 0);
        const seaComps = comps(w => !cont(w)).sort((a, b) => b.length - a.length).slice(1).map(c => ({ c, km2: oceanKm2(c) })).filter(x => x.km2 >= 5e4);
        const seas = seaComps.map(x => x.km2).sort((a, b) => b - a);
        // (how much of the enclosed seas' floor the rivers have filled to sea level — one of a sea's ends: step/sea-fill.js)
        let filled = 0; for (const x of seaComps) for (const w of x.c) if (f.type[w] === CrustType.OCEAN && seaFilledUp(f.time - f.formedAt[w], f.seaFillKm[w])) filled += cellKm2;
        const inland = new Float32Array(n); for (let w = 0; w < n; w++) inland[w] = cont(w) ? Infinity : 0;
        spreadKm(mesh, inland, {});
        // (a ring: thin land wrapped round a sea it encloses — a supercontinent's open embayments make it thin too, and
        // that is its shape, not a ring: Phase 11, 143–160 Mkm² assemblies at 0.28–0.35 bordering no enclosed sea)
        const bigSea = new Uint8Array(n); for (const x of seaComps) if (x.km2 >= 2e6) for (const w of x.c) bigSea[w] = 1;
        const big = comps(cont).filter(c => c.length * cellKm2 >= 5e6).map(c => {
            const A = c.length * cellKm2; let deep = 0, rings = false;
            for (const w of c) { deep = Math.max(deep, inland[w]); if (!rings) for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1]; k++) if (bigSea[mesh.adjList[k]]) { rings = true; break; } }
            return { thin: deep / Math.sqrt(A / Math.PI), len: lengthKm(c) / (2 * Math.sqrt(A / Math.PI)), rings };
        });
        const arcs = comps(w => f.owner[w] >= 0 && f.type[w] === CrustType.ARC).length;
        return { stage: stageOf(f), seaFilled: filled, seasBig: seas.filter(a => a >= 5e5).length, seaMax: seas[0] ?? 0, seaAll: seas.reduce((s, a) => s + a, 0), thinMin: Math.min(...big.map(b => b.thin), 9),
            ringMin: Math.min(...big.filter(b => b.rings).map(b => b.thin), 9), thinMed: median(big.map(b => b.thin)), lenMax: Math.max(...big.map(b => b.len), 0), arcs };
    };
    // belt positions within one belt: a belt cell whose distance across its belt (u × reach) is more than 1.3 cell
    // spacings from its neighbours' in the same event (kind, side, start) — its stamp left behind by the rest (item 6).
    // Not counted: a craton's rim and old weak seams (their path costs are by design), and two belts of one kind meeting
    // (a real edge between them: the terrain blends it, records.js beltLayer)
    const WEAK = CrustFlag.SUTURE | CrustFlag.FAILED_RIFT | CrustFlag.RIFT_MARGIN, jump = 1.3 * mesh.edgeKm;
    const staleShare = world => {
        let belt = 0, stale = 0;
        for (const p of world.plates) {
            if (!p.alive) continue;
            const k = p.crust;
            for (let c = 0; c < n; c++) {
                if (!k.mask[c] || k.type[c] === CrustType.OCEAN || !k.oroType[c] || !(k.beltReach[c] > 0)) continue;
                belt++;
                if (k.type[c] === CrustType.CRATON || (k.flags[c] & WEAK)) continue;
                const vals = [];
                for (let j = mesh.adjOffset[c]; j < mesh.adjOffset[c + 1]; j++) {
                    const q = mesh.adjList[j];
                    if (k.mask[q] && k.type[q] !== CrustType.OCEAN && k.type[q] !== CrustType.CRATON && !(k.flags[q] & WEAK) && k.oroType[q] === k.oroType[c] && k.oroStart[q] === k.oroStart[c] && k.beltSide[q] === k.beltSide[c] && k.beltReach[q] > 0) vals.push(k.beltU[q] * k.beltReach[q]);
                }
                if (vals.length >= 2) { vals.sort((a, b) => a - b); const mid = vals.length % 2 ? vals[vals.length >> 1] : 0.5 * (vals[(vals.length >> 1) - 1] + vals[vals.length >> 1]); if (Math.abs(k.beltU[c] * k.beltReach[c] - mid) > jump) stale++; }
            }
        }
        return stale / Math.max(1, belt);
    };
    const rows = [];
    for (const seed of [12345, 777, 4242]) {
        const { world } = buildStartWorld(mesh, seed), frames = [];
        let staleMax = 0;
        simulate(world, { untilMyr: 600, drive: BUDGET_SCENES.find(s => s.id === 'history').drive, snapshotEveryMyr: 50, onFrame: f => {
            if (f.time > 0) frames.push(f);
            if (f.time > 0 && f.time % 100 === 0) staleMax = Math.max(staleMax, staleShare(world));
        } });
        const m = frames.map(measure);
        // (the stage-dependent figures twice: over every frame, and over the frames in the stage Earth is in today — late
        // dispersal (lib/cycle-stage.mjs) — which is the only stage today's figures speak for)
        const dispersed = m.filter(x => x.stage === 'late dispersal'), most = (xs, k) => xs.length ? Math.max(...xs.map(x => x[k])) : NaN;
        // the seas' ends, from the event log: a sealed sea's floor going down whole under a trench along its shore
        // (step/subduction-init.js founderWithinPlates, SUBDUCTION_INIT data.sealed), and the age of that floor; seas a
        // weld sealed (SUTURE data.sealKm2), for how seas begin
        const sunk = world.events.filter(e => e.kind === EventKind.SUBDUCTION_INIT && e.data.sealed), welded = world.events.filter(e => e.kind === EventKind.SUTURE && e.data.sealKm2 > 0);
        rows.push({ seed, staleMax, stages: byStage(m.map(x => ({ stage: x.stage, value: 1 }))), seasBig: Math.max(...m.map(x => x.seasBig)), seaMax: Math.max(...m.map(x => x.seaMax)), seaAll: Math.max(...m.map(x => x.seaAll)), thinMin: Math.min(...m.map(x => x.thinMin)), ringMin: Math.min(...m.map(x => x.ringMin)), thinMed: median(m.map(x => x.thinMed)), lenMax: Math.max(...m.map(x => x.lenMax)), arcs: Math.max(...m.map(x => x.arcs)),
            dispersedFrames: dispersed.length, seasBigD: most(dispersed, 'seasBig'), seaMaxD: most(dispersed, 'seaMax'), lenMaxD: most(dispersed, 'lenMax'), thinMedD: dispersed.length ? median(dispersed.map(x => x.thinMed)) : NaN,
            sunkPer100: 100 * sunk.length / 600, sunkAge: median(sunk.map(e => e.data.ageMyr)), weldedPer100: 100 * welded.length / 600,
            filledShare: m.reduce((s, x) => s + x.seaFilled, 0) / Math.max(1, m.reduce((s, x) => s + x.seaAll, 0)) });
    }
    const txt = key => rows.map(r => `${r.seed}: ${key(r)}`).join(' · ');
    // (Earth today at this mesh: the Mediterranean ~2.5, the Gulf of Mexico ~1.5, the Black Sea ~0.44 Mkm², the South
    // Caspian; while a supercontinent gathers, interior oceans close inside it — Murphy & Nance. Worst of every 50 Myr.
    // A count at one moment is a snapshot of the cycle: it is compared only over the frames in late dispersal
    // (over 150 Myr after a breakup began), as Earth is today; the seas' ends — how they go — are reported after it, from the event log)
    const stagesTxt = txt(r => stageText(r.stages));
    report('seas caught between continents over 0.5 Mkm² (most at a time, in late dispersal)', rows.map(r => r.seasBigD), { earth: [2, 4], digits: 0, source: 'today (late dispersal): Mediterranean, Gulf of Mexico, Black Sea, South Caspian — a snapshot, no count through time found',
        detail: `over every frame ${txt(r => r.seasBig)}; frames by stage ${stagesTxt}` });
    report('…the largest of them', rows.map(r => r.seaMaxD / 1e6), { earth: [0.4, 2.5], unit: ' Mkm²', digits: 1, source: 'today (late dispersal): the Mediterranean ~2.5 Mkm²', detail: txt(r => `over every frame ${(r.seaMax / 1e6).toFixed(1)}, all ${(r.seaAll / 1e6).toFixed(1)} Mkm² at most`) });
    // how enclosed seas end. Sunk: a sealed sea's floor goes down whole under a trench along its shore — on Earth the
    // Ionian's ~220–230 Myr floor under Calabria (Speranza et al. 2012), while the Herodotus Basin's ~340 Myr floor is
    // still in place (Granot 2016). Filled: the rivers fill it to sea level (the Precaspian; the Black Sea's ≤ 14 km and
    // the Gulf of Mexico's ≤ ~13 km of fill). Dried: not modelled (the Messinian Mediterranean, 5.96–5.33 Ma: Krijgsman
    // et al. 1999). How long a sea lasts is not tracked: a sea carries no identity from frame to frame
    report('enclosed seas sunk: sealed-sea floors gone down whole, per 100 Myr', rows.map(r => r.sunkPer100), { digits: 1, source: 'no Earth figure: the Ionian\'s floor is going down beneath Calabria today (Faccenna et al. 2014)',
        detail: txt(r => `${r.weldedPer100.toFixed(1)} seas sealed by welds per 100 Myr`) });
    report('…the age of their floor when it went down (median)', rows.map(r => r.sunkAge), { unit: ' Myr', digits: 0, source: 'no Earth range: the Ionian\'s floor ~220–230 Myr old as it goes down (Speranza et al. 2012, JGR 117; recalled from the abstract), the Herodotus Basin\'s ~340 Myr and still in place (Granot 2016, Nat. Geosci. 9; checked)' });
    report('enclosed seas filled: share of their floor filled to sea level (over the frames)', rows.map(r => 100 * r.filledShare), { unit: ' %', digits: 0, source: 'no Earth figure: the Precaspian is filled; the Black Sea (≤ 14 km of fill, Nikishin et al. 2015) and the Gulf of Mexico (≤ ~13 km) are not' });
    // (shapes of continents over 5 Mkm², to the continental crust's edge — shelves included: thinness is the deepest point
    // from the coast ÷ the radius of a disc of its area, elongation its length ÷ that disc's diameter)
    report('thinnest continent wrapped round a sea it encloses', rows.map(r => r.ringMin < 9 ? r.ringMin : NaN), { source: 'no Earth figure: ribbon continents (Cimmeria) and Pangea’s C existed',
        detail: txt(r => `thinnest of all ${r.thinMin.toFixed(2)}`) });
    // (shapes are a stage's: Pangaea was one C round the Tethys — compared over the frames in late dispersal, as Earth is today)
    report('longest continent ÷ its disc (in late dispersal)', rows.map(r => r.lenMaxD), { earth: [1.9, 2.1], unit: '×', digits: 1, source: 'today (late dispersal): the Americas ~2.1×, Afro-Eurasia ~1.9× (estimate)',
        detail: txt(r => `over every frame ${r.lenMax.toFixed(1)}×`) });
    report('continents’ median thinness (in late dispersal)', rows.map(r => r.thinMedD), { earth: [0.55, 0.65], source: 'today (late dispersal): poles of inaccessibility, Garcia-Castellanos & Lombardo 2007',
        detail: txt(r => `over every frame ${r.thinMed.toFixed(2)}`) });
    check('belt positions agree within each belt: at most 1 % of belt cells left off by their own belt (every 100 Myr)', rows.every(r => r.staleMax <= 0.01),
        `${txt(r => `worst ${(100 * r.staleMax).toFixed(2)} %`)} (a craton's rim, old weak seams and two belts of one kind meeting are not stale: by design, or a real edge)`);
    check('island arcs still stand along the trenches (counted, not capped)', rows.every(r => r.arcs > 0), txt(r => `up to ${r.arcs} arc pieces`));
}

finish('Phase 11');
