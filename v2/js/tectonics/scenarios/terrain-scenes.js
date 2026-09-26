// Phase 8 test scenes: the earlier phases' scenes, each chosen for the landform it builds, with every mechanism
// their own scene left on. Terrain is synthesized from their frames (terrain/synthesize.js); these only pick the
// history and where to look.

import { MARGIN_SCENES } from './margin-scenes.js';
import { BUDGET_SCENES } from './budget-scenes.js';
import { HOTSPOT_SCENES } from './hotspot-scenes.js';
import { RIFT_SCENES } from './rift-scenes.js';
import { updatePlateMotion } from '../step/torque-balance.js';
import { CrustFlag } from '../model/crust.js';
import { xyzToLatLon } from '../step/kinematics.js';

/** A scene's `focus`: where to look in a frame — here, the centre of the land cells carrying a flag. */
function flagged(flag) {
    return (frame, simMesh) => {
        let x = 0, y = 0, z = 0;
        for (let w = 0; w < simMesh.numCells; w++) if (frame.owner[w] >= 0 && frame.type[w] !== 0 && (frame.flags[w] & flag)) { x += simMesh.xyz[3 * w]; y += simMesh.xyz[3 * w + 1]; z += simMesh.xyz[3 * w + 2]; }
        const l = Math.hypot(x, y, z);
        if (!l) return null;
        const ll = xyzToLatLon(x / l, y / l, z / l);
        return [ll.lat, ll.lon];
    };
}

// (the rift scenes carry no drive of their own — their lab phase supplies the force model — so it is given here)
const from = (list, id, overrides = {}) => ({ drive: updatePlateMotion, ...list.find(s => s.id === id), ...overrides });

export const TERRAIN_SCENES = [
    from(MARGIN_SCENES, 'margins', { id: 'andes', label: 'An Andean margin', about: 'A continent overrides an ocean plate along its leading coast: a coastal range, a valley behind it, the main volcanic range, fold-and-thrust ridges inland — all parallel to the coast. Offshore, the trench and its outer rise; the trailing coast behind has a wide shelf.' }),
    from(MARGIN_SCENES, 'laramide', { id: 'laramide', label: 'A Laramide belt', about: 'A continent drives over a young slab, which goes in flat: deformation reaches far inland — a high interior with blocky basement ranges and a front range bracketing it, and no volcanoes (the magmatic gap).' }),
    from(BUDGET_SCENES, 'india', { id: 'india', label: 'A continental collision', about: '“India” reaches “Asia” and slides under it. On Asia’s side (the upper plate): a range along the suture, the plateau of thickened crust, a back range and a fall line. On India’s side: the highest range just off the suture, fold hills, then the foreland basin. Ridges run parallel to the suture.' }),
    from(MARGIN_SCENES, 'mariana', { id: 'mariana', label: 'An ocean island arc', about: 'An arc on an ocean plate, rifting off behind: a chain of volcanic islands on a submarine ridge, the trench in front, a young back-arc basin behind.' }),
    from(MARGIN_SCENES, 'japan', { id: 'japan', label: 'A strip of coast rifts off', about: 'A strip of an active continental margin rifts off as a back-arc basin opens behind it: a Japan — a mountainous arc of continental crust with volcanoes, a sea behind it.' }),
    from(HOTSPOT_SCENES, 'hawaii', { id: 'hawaii', label: 'A hotspot track', about: 'A plate slides over a fixed plume: volcanic islands near the plume, older ones worn down and drowned downstream as the floor under them ages and sinks (seamounts, guyots).' }),
    // (40 Myr, not the rifting phase's 160: 20 Myr after the split the young ocean and both shoulders are in view —
    // the trenches on the outer coasts pull the halves apart fast; the camera goes to the rifted margins, wherever they are)
    from(RIFT_SCENES, 'plume', { id: 'rift', label: 'A continent splits', maxMyr: 40, focus: flagged(CrustFlag.RIFT_MARGIN), about: 'A plume splits a continent: the new coasts are lifted into shoulders — a great escarpment facing the young ocean, sloping gently inland — and the arm that failed is a low corridor.' }),
    from(BUDGET_SCENES, 'history', { id: 'history', label: 'A whole planet (600 Myr)', about: 'The start world run for 600 Myr with every rule on (building takes about a minute). Young belts stand high and sharp, old ones low but still grained; cratons flat and low; wide shelves on passive margins, narrow ones on active margins; mid-ocean ridges and trenches in the sea.' }),
];
