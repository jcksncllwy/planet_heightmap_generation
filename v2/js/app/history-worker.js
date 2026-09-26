// Runs one scene's whole history off the page's thread and streams its frames back as they are recorded (the page
// stays responsive, and can show how far it has got). Same code, same inputs: the same history as on the page.

import { simulate } from '../tectonics/simulate.js';
import { TERRAIN_SCENES } from '../tectonics/scenarios/terrain-scenes.js';
import { meshFromArrays } from '../core/sim-mesh.js';
import { terrainConfig } from '../terrain/terrain-config.js';

const SCENE_LISTS = { terrain: TERRAIN_SCENES };

self.onmessage = ({ data: { list, sceneId, seed, mesh, snapshotEveryMyr, heights = {} } }) => {
    try {
        const scene = SCENE_LISTS[list].find(s => s.id === sceneId), simMesh = meshFromArrays(mesh);
        const world = scene.build(simMesh, seed);
        world.config.heights = terrainConfig(heights);                 // (the heights evolve with these; the history itself ignores them)
        const { steps } = simulate(world, {
            untilMyr: scene.maxMyr, drive: w => scene.drive(w), snapshotEveryMyr,
            onFrame: frame => self.postMessage({ type: 'frame', frame }, Object.values(frame).filter(v => ArrayBuffer.isView(v)).map(v => v.buffer)),
        });
        self.postMessage({ type: 'done', steps });
    } catch (err) {
        self.postMessage({ type: 'error', message: err.stack ?? String(err) });
    }
};
