// Runs one scene's whole history off the page's thread and streams its frames back as they are recorded, packed (the
// page stays responsive, can show how far it has got, and holds a long history in a third of the memory). Same code, same inputs: the same history as on the page.

import { simulate } from '../tectonics/simulate.js';
import { TERRAIN_SCENES } from '../tectonics/scenarios/terrain-scenes.js';
import { meshFromArrays } from '../core/sim-mesh.js';
import { terrainConfig } from '../terrain/terrain-config.js';
import { packFrame } from '../tectonics/frame-pack.js';
import { historyEnding } from '../tectonics/ending.js';

const SCENE_LISTS = { terrain: TERRAIN_SCENES };

self.onmessage = ({ data: { list, sceneId, seed, mesh, snapshotEveryMyr, heights = {}, ending = 'none' } }) => {
    try {
        const scene = SCENE_LISTS[list].find(s => s.id === sceneId), simMesh = meshFromArrays(mesh);
        const world = scene.build(simMesh, seed);
        world.config.heights = terrainConfig(heights);                 // (the heights evolve with these; the history itself ignores them)
        const { untilMyr, stopAt } = historyEnding(scene.maxMyr, ending, world.config);      // (a chosen ending: it may run on)
        const { steps, stopped } = simulate(world, {
            untilMyr, stopAt, drive: w => scene.drive(w), snapshotEveryMyr,
            // (packed: a whole history's frames are mostly zeros — tectonics/frame-pack.js)
            onFrame: frame => { const { packed, transfer } = packFrame(frame); self.postMessage({ type: 'frame', frame: packed }, transfer); },
        });
        self.postMessage({ type: 'done', steps, stopped, untilMyr });
    } catch (err) {
        self.postMessage({ type: 'error', message: err.stack ?? String(err) });
    }
};
