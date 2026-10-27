// Headless acceptance checks for Phase 3 (the generated start world).
// Usage: node v2/tools/check-phase3.mjs      — runs every guarantee across many seeds and settings.
// Hard checks: the generator honours its own parameters (craton count, spacing, land fraction, craton share, apron, rim
// trench — contracts, whatever the value; several values are taste, marked below), seeds are distinct and repeatable,
// and the nudge's crust rules (offshore trench of old crust, a wake behind, little new crust at a convergent edge).
// Reported: the shape of the start world — craton and terrane sizes, craton share, span, rim smoothness, rim trench
// coverage, suture share — against Earth's figures where there are any. The start is an initial condition: none of
// these is a law.

import { check, report, section, finish, labMesh } from './lib/check-kit.mjs';
import { TECTONICS } from '../js/tectonics/config.js';
import { buildStartWorld } from '../js/tectonics/init/start-world.js';
import { measureStartWorld } from '../js/tectonics/init/measure-start.js';
import { buildNudgeScene, NUDGE_MAX_MYR } from '../js/tectonics/scenarios/start-world-nudge.js';
import { simulate } from '../js/tectonics/simulate.js';
import { frameTallies } from '../js/tectonics/measure.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { BoundaryKind } from '../js/tectonics/model/world.js';

const range = (list, f) => `${Math.min(...list.map(f)).toFixed(f.digits ?? 0)}–${Math.max(...list.map(f)).toFixed(f.digits ?? 0)}`;

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12345, 777777];
const mesh = labMesh();      // one mesh for all worlds, as in the lab: the seed only drives the layout

section('defaults, many seeds');
const t0 = performance.now();
const runs = SEEDS.map(seed => { const { world, start } = buildStartWorld(mesh, seed); return { seed, world, start, m: measureStartWorld(world, start) }; });
console.log(`${runs.length} start worlds generated + measured in ${(performance.now() - t0).toFixed(0)} ms; attempts per seed: ${runs.map(r => r.start.attempts).join(' ')}`);
const all = (test) => runs.filter(r => !test(r)).map(r => r.seed);
const everySeed = (name, test, detail) => { const bad = all(test); check(name, bad.length === 0, detail + (bad.length ? ` — FAILING SEEDS: ${bad.join(', ')}` : '')); };
const perSeed = f => runs.map(f);
const C = TECTONICS;

everySeed('craton count', r => r.m.cratons.length === C.cratonCount && r.m.cratons.every(k => k.areaKm2 > 0), `${C.cratonCount} cratons in every world`);
// (the spacing values are taste — "room for a rift", no geophysical basis found; some real cratons do reach a passive margin,
// e.g. the West African and São Francisco cratons, so 0 km from the sea would be a legal setting too)
everySeed('space between cratons', r => r.m.minGapKm >= C.cratonMinGapKm, `smallest gap per world ${range(runs, r => r.m.minGapKm)} km (required ≥ ${C.cratonMinGapKm})`);
everySeed('space between cratons and the sea', r => r.m.minCoastKm >= C.cratonMinCoastKm, `smallest distance per world ${range(runs, r => r.m.minCoastKm)} km (required ≥ ${C.cratonMinCoastKm})`);
// (the generator's size ladder runs 1 → cratonSizeRatio, each core jittered ±10 % and lobed, the ladder shortened only if the
// largest would pass cratonMaxDiameterKm: the ratio it gives is within a factor 1.5 of the one asked)
everySeed('variety of craton size: the generator honours cratonSizeRatio and cratonMaxDiameterKm', r => r.m.cratonSizeRatio >= C.cratonSizeRatio / 1.5 && r.m.cratonSizeRatio <= C.cratonSizeRatio * 1.5 && r.m.cratons.every(k => k.diameterKm <= C.cratonMaxDiameterKm + mesh.edgeKm),
    `largest ÷ smallest diameter ${range(runs, Object.assign(r => r.m.cratonSizeRatio, { digits: 1 }))}× (asked ${C.cratonSizeRatio}×); widest ${range(runs, r => Math.max(...r.m.cratons.map(k => k.diameterKm)))} km (cap ${C.cratonMaxDiameterKm})`);
const cratonSizes = 'Earth\'s ~35 large cratons run from Slave ~500 km to Superior >3000 km, plus smaller slivers (Bleeker 2003, Lithos 71); holds through the cycle: cratons outlast it';
report('craton diameter, smallest in each world', perSeed(r => Math.min(...r.m.cratons.map(k => k.diameterKm))), { earth: [500, 3000], unit: ' km', digits: 0, source: cratonSizes });
report('craton diameter, largest in each world', perSeed(r => Math.max(...r.m.cratons.map(k => k.diameterKm))), { earth: [500, 3000], unit: ' km', digits: 0, source: cratonSizes });
report('variety of terrane size: largest ÷ smallest terrane area', perSeed(r => r.m.terraneSizeRatio), { unit: '×', digits: 1 });
// (the 29 % default is Earth's LAND above sea level; continental crust with its margins covers ~41 % (Cogley 1984) — a
// contract here, whatever the value)
everySeed('continental fraction', r => Math.abs(r.m.continentalFraction - C.continentalFraction) < 0.015, `${range(runs, Object.assign(r => r.m.continentalFraction * 100, { digits: 1 }))} % of the surface (target ${(C.continentalFraction * 100).toFixed(0)} %)`);
everySeed('craton share', r => r.m.cratonShare < C.cratonShare + 0.04 && r.m.cratonShare > C.cratonShare * C.cratonMinAreaScale * 0.8,
    `${range(runs, r => r.m.cratonShare * 100)} % of continental crust (asked ${(C.cratonShare * 100).toFixed(0)} %; craton size factor used: ${range(runs, Object.assign(r => r.start.cratonAreaScale, { digits: 2 }))})`);
report('craton share of the continental crust', perSeed(r => r.m.cratonShare * 100), { unit: ' %', digits: 0,
    source: 'no sourced Earth figure: Archean crust is roughly 7–10 % of continental area, far more with Proterozoic shields (unverified); the 24 % default is unsourced' });
// (a clean single supercontinent is the generator's only mode — it fills enclosed seas and sinks stray land, init/landmass.js
// — so this is its contract, not Earth-likeness: Pangea had the Tethys embayment and intracontinental basins)
everySeed('the generator\'s one landmass: no stray land, no enclosed seas', r => r.m.strayLandCells === 0 && r.m.enclosedSeaCells === 0, 'no stray land cells, no enclosed sea cells');
report('span of the supercontinent: its longest axis', perSeed(r => r.m.longestAxisDeg), { unit: '°', digits: 0, source: 'Pangea reached roughly pole to pole, close to 180°; physics sets no cap' });
everySeed('ocean apron', r => r.m.minApronKm >= C.apronKm - mesh.edgeKm, `narrowest apron per world ${range(runs, r => r.m.minApronKm)} km (target ${C.apronKm}, cell size ${mesh.edgeKm.toFixed(0)})`);
report('trench line against the coast: rim ÷ coast length', perSeed(r => r.m.rimCells / r.m.coastCells), { digits: 2, source: 'trenches are long smooth arcs at the 1000s-of-km scale; no quantitative law found' });
everySeed('rim trench', r => r.m.trenchOffRim === 0 && Math.abs(r.m.trenchCoverage - C.rimTrenchCoverage) < 0.08, `on ${range(runs, r => r.m.trenchCoverage * 100)} % of the rim (target ${C.rimTrenchCoverage * 100} %), never off the rim`);
report('rim trench coverage (an initial-condition choice)', perSeed(r => r.m.trenchCoverage * 100), { unit: ' %', digits: 0, source: 'Pangea was ringed by circum-Panthalassa subduction (Collins 2003, Geology); the 85 % is a guess' });
report('suture belts: share of the land', perSeed(r => r.m.sutureShare * 100), { unit: ' %', digits: 0 });
{
    const centres = runs.map(r => r.start.centre);
    let closest = Infinity;
    for (let i = 0; i < centres.length; i++) for (let j = i + 1; j < centres.length; j++)
        closest = Math.min(closest, Math.acos(centres[i][0] * centres[j][0] + centres[i][1] * centres[j][1] + centres[i][2] * centres[j][2]) * 180 / Math.PI);
    check('seeds give different worlds', closest > 1, `closest pair of supercontinent centres is ${closest.toFixed(0)}° apart`);
    // …and the same seed gives the same world, cell for cell
    const again = buildStartWorld(mesh, SEEDS[0]).world, first = runs[0].world;
    const differ = again.plates.length !== first.plates.length ? Infinity : again.plates.reduce((n, p, i) => n + p.crust.mask.reduce((m, v, c) => m + (v !== first.plates[i].crust.mask[c] || p.crust.type[c] !== first.plates[i].crust.type[c] || p.crust.terrane[c] !== first.plates[i].crust.terrane[c] ? 1 : 0), 0), 0);
    check('the same seed gives the same world', differ === 0, `seed ${SEEDS[0]} built twice: ${differ} cells differ in plate, crust type or terrane`);
}

section('slider ranges');
{   // sliders that compete: the continental fraction is honoured and craton size gives way
    const settings = [
        { cratonMinGapKm: 900 }, { cratonMinCoastKm: 900 }, { cratonMinGapKm: 900, cratonMinCoastKm: 900 }, { continentalFraction: 0.2 },
        { continentalFraction: 0.2, cratonMinGapKm: 800, cratonMinCoastKm: 700 }, { continentalFraction: 0.24, cratonCount: 12, cratonMinGapKm: 700 }, { cratonShare: 0.4, cratonMinGapKm: 800 },
    ];
    const rows = [], bad = [];
    for (const o of settings) for (const seed of [3, 8, 11]) {
        let built;
        try { built = buildStartWorld(mesh, seed, o); } catch (err) { bad.push(`${JSON.stringify(o)} seed ${seed}: ${err.message}`); continue; }
        const { world, start } = built, cfg = world.config, m = measureStartWorld(world, start);
        const off = m.continentalFraction - cfg.continentalFraction;
        rows.push({ off, scale: start.cratonAreaScale });
        if (Math.abs(off) > 0.01 || m.minGapKm < cfg.cratonMinGapKm || m.minCoastKm < cfg.cratonMinCoastKm) bad.push(`${JSON.stringify(o)} seed ${seed}: land ${(m.continentalFraction * 100).toFixed(1)} % vs ${cfg.continentalFraction * 100} %, gap ${m.minGapKm.toFixed(0)}, coast ${m.minCoastKm.toFixed(0)}, size factor ${start.cratonAreaScale.toFixed(2)}`);
    }
    const worst = Math.max(...rows.map(r => Math.abs(r.off))) * 100, shrunk = rows.filter(r => r.scale < 1).length;
    check('competing sliders: land fraction holds, cratons give way', bad.length === 0,
        bad.length ? bad.join(' | ') : `${rows.length} demanding worlds: land within ${worst.toFixed(2)} points of the request in every one, spacing minimums all met; cratons had to shrink in ${shrunk} of them (smallest size factor ${Math.min(...rows.map(r => r.scale)).toFixed(2)})`);
}

section('the nudge: smooth offshore trench, one clean wake');
const LEADING_COS = Math.cos(50 * Math.PI / 180);      // "leading" = within ±50° of the heading, seen from the plate's centre
/** cos of the angle between the heading and the direction from the plate's centre to position index `i` of `xyz`. */
function headingCos(xyz, i, centre, heading) {
    const p = [xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]], k = p[0] * centre[0] + p[1] * centre[1] + p[2] * centre[2];
    const t = [p[0] - k * centre[0], p[1] - k * centre[1], p[2] - k * centre[2]], length = Math.hypot(t[0], t[1], t[2]) || 1;
    return (t[0] * heading[0] + t[1] * heading[1] + t[2] * heading[2]) / length;
}
function nudge(seed, overrides) {
    const scene = buildNudgeScene(mesh, seed, overrides), continent = scene.world.plates[scene.start.continentId];
    const landBefore = Uint8Array.from(continent.crust.mask, (m, c) => (m && continent.crust.type[c] !== CrustType.OCEAN ? 1 : 0));
    const { frames } = simulate(scene.world, { untilMyr: NUDGE_MAX_MYR, drive: scene.drive, snapshotEveryMyr: 10, events: false });
    let landChanged = 0, ahead = 0, behind = 0;
    const { xyz, numCells } = mesh, h = scene.heading, mid = scene.start.centre;
    for (let c = 0; c < numCells; c++) {
        const isLand = continent.crust.mask[c] && continent.crust.type[c] !== CrustType.OCEAN ? 1 : 0;
        if (isLand !== landBefore[c]) landChanged++;
        if (!continent.crust.mask[c] || continent.crust.formedAt[c] < 0) continue;
        // New crust, in the plate's own frame (= its starting position). "Ahead" is the leading rim proper; the
        // flanks slide past the old ocean and do shed slivers — that is a transform margin, not a wake.
        const along = headingCos(xyz, c, mid, h);
        if (along > LEADING_COS) ahead++; else if (along < 0) behind++;
    }
    const last = frames.at(-1);
    let trenchOnLand = 0, trenchOnApron = 0;
    for (let w = 0; w < numCells; w++) if (last.boundary[w] === BoundaryKind.OVERRIDING) { if (last.type[w] === CrustType.OCEAN) trenchOnApron++; else trenchOnLand++; }
    // new crust sitting ON a trench, summed over every recorded frame — the artifact to rule out
    // (world cells judged against the starting centre: the plate moves < 11° in the run)
    let newCrustAtTrench = 0, trenchCellFrames = 0, leadingNew = 0, leadingTrench = 0;
    for (const fr of frames) for (let w = 0; w < numCells; w++) {
        if (fr.boundary[w] !== BoundaryKind.OVERRIDING) continue;
        const isNew = fr.type[w] === CrustType.OCEAN && fr.formedAt[w] >= 0, leading = headingCos(xyz, w, mid, h) > LEADING_COS;
        trenchCellFrames++; if (isNew) newCrustAtTrench++;
        if (leading) { leadingTrench++; if (isNew) leadingNew++; }
    }
    return { frames, landChanged, ahead, behind, trenchOnLand, trenchOnApron, newCrustAtTrench, trenchCellFrames, leadingNew, leadingTrench, gaps: Math.max(...frames.map(f => frameTallies(f).gaps)) };
}
const MIN_TRENCH_KM = 4000;      // a leading rim's worth of trench: the trench must be there before "offshore" means anything
for (const seed of [2, 12345]) {
    const withApron = nudge(seed, {});
    check(`nudge, seed ${seed}: crust rules hold`, withApron.gaps === 0 && withApron.landChanged === 0, `${withApron.gaps} gap cells, ${withApron.landChanged} land cells changed`);
    const trenchKm = cells => cells * mesh.edgeKm * Math.sqrt(3) / 2;     // (a line of cells: one per row spacing)
    check(`nudge, seed ${seed}: the trench is offshore`, trenchKm(withApron.trenchOnApron) >= MIN_TRENCH_KM && withApron.trenchOnLand <= 0.05 * withApron.trenchOnApron,
        `overriding edge at ${NUDGE_MAX_MYR} Myr: ${trenchKm(withApron.trenchOnApron).toFixed(0)} km on apron ocean, ${trenchKm(withApron.trenchOnLand).toFixed(0)} km on land (at least ${MIN_TRENCH_KM} km of trench)`);
    check(`nudge, seed ${seed}: the leading trench is made of old crust`, withApron.leadingTrench > 100 && withApron.leadingNew <= 0.06 * withApron.leadingTrench,   // a hook in an irregular coast is locally a trailing edge and sheds a little wake
        `leading-rim trench cells made of newly formed crust: ${withApron.leadingNew} of ${withApron.leadingTrench} cell-frames`);
    // (an artifact bound: no new crust forms at a convergent edge, but a raster rim sheds a little wake where it is concave)
    check(`nudge, seed ${seed}: little new crust at a convergent edge (a raster artifact, bounded)`, withApron.newCrustAtTrench <= 0.12 * withApron.trenchCellFrames,
        `new-crust trench cells over the whole rim (flanks included): ${withApron.newCrustAtTrench} of ${withApron.trenchCellFrames} cell-frames (${(100 * withApron.newCrustAtTrench / withApron.trenchCellFrames).toFixed(1)} %; limit 12 %)`);
    check(`nudge, seed ${seed}: new crust trails the plate`, withApron.behind > 200 && withApron.ahead <= 0.05 * withApron.behind,
        `new-ocean cells in the trailing wake: ${withApron.behind}; within ±50° of the heading: ${withApron.ahead} (flank slivers where the rim slides past old ocean)`);
}

finish('Phase 3');
