// Headless checks that the lab UI's phase modules load and behave: every phase module builds, honours the shell's contract
// and draws; every slider the lab offers keeps the generator's promises. These are software contracts, not physics: the
// phase suites (check-phase*.mjs) test only the physics, and everything about the lab lives here.
// Usage: node v2/tools/check-lab.mjs

import { check, section, finish, labMesh, checkLabPhaseLoads, LAB_MESH_SEED } from './lib/check-kit.mjs';
import { buildStartWorld } from '../js/tectonics/init/start-world.js';
import { measureStartWorld } from '../js/tectonics/init/measure-start.js';
import { createPhase } from '../js/app/phases/phase3-start-world.js';
import { FORCE_SCENES } from '../js/tectonics/scenarios/force-scenes.js';
import { EVENT_SCENES } from '../js/tectonics/scenarios/event-scenes.js';
import { RIFT_SCENES } from '../js/tectonics/scenarios/rift-scenes.js';
import { HOTSPOT_SCENES } from '../js/tectonics/scenarios/hotspot-scenes.js';
import { MARGIN_SCENES } from '../js/tectonics/scenarios/margin-scenes.js';
import { BUDGET_SCENES } from '../js/tectonics/scenarios/budget-scenes.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';

const mesh = labMesh();

section('lab');
await checkLabPhaseLoads('../../js/app/phases/phase1-rigid-drift.js', mesh, LAB_MESH_SEED);
await checkLabPhaseLoads('../../js/app/phases/phase2-wilson-cycle.js', mesh, LAB_MESH_SEED);
await checkLabPhaseLoads('../../js/app/phases/phase3-start-world.js', mesh, LAB_MESH_SEED, [{}, { cratonCount: 12, coastReliefKm: 0 }]);
await checkLabPhaseLoads('../../js/app/phases/phase4-forces.js', mesh, LAB_MESH_SEED, FORCE_SCENES.map(s => ({ scene: s.id })));
await checkLabPhaseLoads('../../js/app/phases/phase5-collisions.js', mesh, LAB_MESH_SEED, [{ scene: 'india' }, { scene: 'wilson' }, { scene: 'one-sided' }]);
await checkLabPhaseLoads('../../js/app/phases/phase5b-arcs.js', mesh, LAB_MESH_SEED, EVENT_SCENES.map(s => ({ scene: s.id })));
await checkLabPhaseLoads('../../js/app/phases/phase6-rifting.js', mesh, LAB_MESH_SEED, RIFT_SCENES.map(s => ({ scene: s.id })));   // (phases 6a and 6b both loaded it; once is enough)
await checkLabPhaseLoads('../../js/app/phases/phase7-hotspots.js', mesh, LAB_MESH_SEED, HOTSPOT_SCENES.map(s => ({ scene: s.id })));
await checkLabPhaseLoads('../../js/app/phases/phase7b-margins.js', mesh, LAB_MESH_SEED, MARGIN_SCENES.map(s => ({ scene: s.id })));
await checkLabPhaseLoads('../../js/app/phases/phase7c-budget.js', mesh, LAB_MESH_SEED, BUDGET_SCENES.filter(s => s.id !== 'history').map(s => ({ scene: s.id })));
// every scene the lab offers builds and draws (the whole-planet one is covered in check-phase8a: it takes a minute)
check('every terrain scene can be built and driven', TERRAIN_SCENES.every(s => typeof s.build === 'function' && typeof s.drive === 'function' && s.maxMyr > 0), TERRAIN_SCENES.map(s => s.id).join(', '));
await checkLabPhaseLoads('../../js/app/phases/phase8a-terrain.js', mesh, LAB_MESH_SEED, TERRAIN_SCENES.filter(s => s.id !== 'history' && s.id !== 'cycle').map(s => ({ scene: s.id, cells: 160000 })));
await checkLabPhaseLoads('../../js/app/phases/phase8b-rivers.js', mesh, LAB_MESH_SEED, TERRAIN_SCENES.filter(s => s.id !== 'history' && s.id !== 'cycle').map(s => ({ scene: s.id, cells: 160000 })));

section('slider ranges');
{   // The spacing promises hold at both ends of every slider the lab offers (read from the lab module, so the two cannot drift apart).
    const sliders = createPhase(mesh, LAB_MESH_SEED).params.filter(p => !p.options);
    const settings = sliders.flatMap(p => [{ [p.id]: p.min }, { [p.id]: p.max }]);
    for (const end of ['min', 'max']) settings.push(Object.fromEntries(sliders.filter(p => /^cratonMin/.test(p.id)).map(p => [p.id, p[end]])));
    const bad = [];
    let worstGap = Infinity, worstCoast = Infinity;
    for (const o of settings) for (const seed of [3, 8]) {
        try {
            const { world, start } = buildStartWorld(mesh, seed, o), cfg = world.config, m = measureStartWorld(world, start);
            worstGap = Math.min(worstGap, m.minGapKm - cfg.cratonMinGapKm); worstCoast = Math.min(worstCoast, m.minCoastKm - cfg.cratonMinCoastKm);
            if (m.minGapKm < cfg.cratonMinGapKm || m.minCoastKm < cfg.cratonMinCoastKm || m.strayLandCells || m.enclosedSeaCells || m.cratons.length !== cfg.cratonCount) bad.push(JSON.stringify(o) + ' seed ' + seed);
        } catch (e) { bad.push(JSON.stringify(o) + ' seed ' + seed + ': ' + e.message); }
    }
    check('guarantees hold across the slider ranges', bad.length === 0,
        bad.length ? bad.join(' | ') : `${settings.length} settings × 2 seeds: tightest margin over the required gap +${worstGap.toFixed(0)} km, over the required coast distance +${worstCoast.toFixed(0)} km`);
}

finish('Lab');
