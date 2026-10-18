// Runs one scene's whole history off the page's thread and streams its frames back as they are recorded, packed (the
// page stays responsive, can show how far it has got, and holds a long history in a third of the memory). Same code, same inputs: the same history as on the page.
// It keeps its world afterwards: {type: 'more', untilMyr} runs the history on from where it stopped (simulate's resume —
// the same history as one long run) and streams those frames too, then answers {type: 'more-done'} (Evolution's "Keep going").

import { simulate } from '../tectonics/simulate.js';
import { TERRAIN_SCENES } from '../tectonics/scenarios/terrain-scenes.js';
import { meshFromArrays } from '../core/sim-mesh.js';
import { terrainConfig } from '../terrain/terrain-config.js';
import { packFrame } from '../tectonics/frame-pack.js';
import { historyEnding } from '../tectonics/ending.js';

const SCENE_LISTS = { terrain: TERRAIN_SCENES };

let kept = null;                  // { world, scene, snapshotEveryMyr }: the history run, to run on from
let packMs = 0;
// (packed: a whole history's frames are mostly zeros — tectonics/frame-pack.js)
const send = frame => { const t = performance.now(), { packed, transfer } = packFrame(frame); packMs += performance.now() - t; self.postMessage({ type: 'frame', frame: packed }, transfer); };

self.onmessage = ({ data }) => {
    try {
        if (data.type === 'more') {
            const { world, scene, snapshotEveryMyr } = kept, started = performance.now();
            const { steps } = simulate(world, { untilMyr: data.untilMyr, resume: true, drive: w => scene.drive(w), snapshotEveryMyr, onFrame: send, keepFrames: false });
            self.postMessage({ type: 'more-done', steps, time: world.time, ms: performance.now() - started });
            return;
        }
        const { list, sceneId, seed, mesh, snapshotEveryMyr, heights = {}, ending = 'none', start = {}, lengthMyr = null } = data;
        const scene = SCENE_LISTS[list].find(s => s.id === sceneId), simMesh = meshFromArrays(mesh);
        const world = scene.build(simMesh, seed, start);                 // (start: start-world tunables, for scenes that take them)
        world.config.heights = terrainConfig(heights);                 // (the heights evolve with these; the history itself ignores them)
        const { untilMyr, stopAt } = historyEnding(lengthMyr ?? scene.maxMyr, ending, world.config);      // (a chosen ending: it may run on)
        packMs = 0;
        const started = performance.now();
        const { steps, stopped } = simulate(world, { untilMyr, stopAt, drive: w => scene.drive(w), snapshotEveryMyr, onFrame: send, keepFrames: false });
        kept = { world, scene, snapshotEveryMyr };
        self.postMessage({ type: 'done', steps, stopped, untilMyr, time: world.time, ms: performance.now() - started, packMs });
    } catch (err) {
        self.postMessage({ type: 'error', message: err.stack ?? String(err) });
    }
};
