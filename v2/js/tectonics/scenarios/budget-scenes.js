// Phase 7c test scenes: the crust budget. Continents gain area from arcs and fore-arc islands; they lose it where a
// margin is erosive, where a collision drives one continent under another, and where a small arc goes down with its
// slab instead of accreting. Each scene isolates one of those; the last runs the whole budget over a long history.
// (They reuse older scenes, whose build() switches later mechanisms off: mechanismsOn switches the ones wanted back on.)

import { onlyMechanisms, mechanismsOn, CM_PER_YR_TO_RAD_PER_MYR } from '../config.js';
import { latLonToXyz } from '../step/kinematics.js';
import { updatePlateMotion } from '../step/torque-balance.js';
import { buildStartWorld, buildStartWorldAsync } from '../init/start-world.js';
import { MARGIN_SCENES } from './margin-scenes.js';
import { FORCE_SCENES } from './force-scenes.js';
import { EVENT_SCENES } from './event-scenes.js';

const scene = (list, id) => list.find(s => s.id === id);
const EROSION_POLE = [-40, -20], EROSION_COAST_CMYR = 6;     // (the erosion scene: Driftia's pole, lat/lon °, and its west coast's speed at the equator)

export const BUDGET_SCENES = [
    {
        id: 'erosion', label: 'Erosive and accretionary margins', maxMyr: 150, view: [0, -20],
        about: '“Driftia” is driven west into the trench along its western coast — fast in the north (~8 cm/yr), slower in the south (~3 cm/yr): it turns about a pole far to the south. A margin is EROSIVE where the convergence is fast (over ~6 cm/yr) or the trench is starved of sediment (under ~1 km): the trench scrapes the fore-arc away and the coast retreats (Margins layer: purple), as the Andes have lost ~250 km of coast since the Jurassic. Elsewhere it is ACCRETIONARY: the sediment the trench scrapes off builds a prism, which rises as islands off the coast that grow into it (Crust type layer) (Clift & Vannucchi 2004). The trench’s fill is what the land behind the coast sheds over what the convergence carries away: the slow south keeps its trench filled, as Cascadia does.',
        build(simMesh, seed) {
            const world = scene(MARGIN_SCENES, 'margins').build(simMesh, seed);
            Object.assign(world.config, onlyMechanisms('marginIsles', 'marginErosion'), mechanismsOn('marginIsles', 'marginErosion'));
            return world;
        },
        // (a scene setting, not physics: left to its slab, Driftia converged at only ~1–2.5 cm/yr, and a margin that slow, fed
        // by a whole continent, is filled and accretes all along — crust-sink branch. Driven about a pole EROSION_POLE, its
        // west coast converges at EROSION_COAST_CMYR on the equator, more to the north, less to the south: both kinds)
        drive(world) {
            updatePlateMotion(world);
            const d = world.plates.find(p => p.name === 'Driftia'), [lat, lon] = EROSION_POLE, pole = latLonToXyz(lat, lon);
            const w = EROSION_COAST_CMYR * CM_PER_YR_TO_RAD_PER_MYR / Math.sin((0 - lat) * Math.PI / 180);   // (speed at the equator ∝ sin of its distance from the pole)
            if (d) d.omega = [pole[0] * w, pole[1] * w, pole[2] * w];
        },
    },
    {
        id: 'india', label: 'A continent slides under another', maxMyr: 130, view: [5, 72],
        about: '“India” reaches “Asia”. Continental crust is too buoyant to subduct as a slab, but the leading edge of the lower continent slides UNDER the upper one: as the two converge, India’s land in the overlap is consumed and Asia’s crust above it thickens (Thickness layer) — the area becomes a plateau, as Tibet swallowed ~2000 km of Greater India. The continents weld when the collision is spent.',
        build(simMesh, seed) {
            const world = scene(FORCE_SCENES, 'india').build(simMesh, seed);
            Object.assign(world.config, onlyMechanisms('underthrust'), mechanismsOn('underthrust'));
            return world;
        },
        drive: updatePlateMotion,
    },
    {
        id: 'arcs', label: 'Small arcs go down, big arcs accrete', maxMyr: 220, view: [0, 0],
        about: 'Two continents close on each other, each with island arcs on its facing margin (the Phase 5b scene). Where an arc arrives at a continent, its young parts — crust still thinner than arcAccreteThickKm — are too light to hold up their lithosphere and go down with the slab (event log: “arc recycled”); its old, thick parts accrete. So continents grow from mature arcs — a Japan, a Kohistan — not from every young chain of islets.',
        build(simMesh, seed) {
            const world = scene(EVENT_SCENES, 'arc-collision').build(simMesh, seed);
            Object.assign(world.config, onlyMechanisms('wings', 'arcs', 'arcRecycling'), mechanismsOn('wings', 'arcs', 'arcRecycling'));
            return world;
        },
        drive: updatePlateMotion,
    },
    {
        id: 'history', label: 'The crust budget over 600 Myr', maxMyr: 600, view: null,
        about: 'The generated supercontinent with every rule on, over 600 Myr (it takes a while to build). Continental area grows — arcs and fore-arc islands add crust — but not without bound: erosive margins, underthrusting at collisions and recycled arcs take some away again (chart: land share of the planet).',
        // (overrides: start-world tunables — the Evolution page's starting continent size is continentalFraction)
        build(simMesh, seed, overrides = {}) { return buildStartWorld(simMesh, seed, overrides).world; },
        // (the same, its start world's layout attempts evaluated side by side: app/helper-pool.js)
        async buildAsync(simMesh, seed, overrides = {}, helpers) { return (await buildStartWorldAsync(simMesh, seed, overrides, helpers)).world; },
        drive: updatePlateMotion,
    },
];
