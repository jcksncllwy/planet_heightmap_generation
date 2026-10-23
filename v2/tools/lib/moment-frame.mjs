// A moment's frame — the history as the Evolution page builds it (scene 'cycle', ending none), to the moment — cached in
// v2/out/frames/ (shared by render-moment.mjs and coast-shape.mjs). The cache is keyed by seed, continental share, sim
// cells and time only: delete it after a change to the history.

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { buildSimMesh } from '../../js/core/sim-mesh.js';
import { runHistory } from '../../js/app/history-runner.js';
import { TERRAIN_SCENES } from '../../js/tectonics/scenarios/terrain-scenes.js';
import { FRAME_FIELDS } from '../../js/terrain/terrain-pool.js';

export const MESH_SEED = 12345;                       // (the page's: every planet's sim mesh is the same; the seed shapes the world)

export async function momentFrame(root, { seed, cont, sim, time }) {
    const frameDir = path.join(root, 'v2', 'out', 'frames');
    const frameFile = path.join(frameDir, `frame-${seed}-${cont}-${sim}-${time}.bin`);
    if (fs.existsSync(frameFile)) return v8.deserialize(fs.readFileSync(frameFile)).frame;
    let frame;
    const scene = TERRAIN_SCENES.find(s => s.id === 'cycle');
    // (the history is causal — Keep going runs on to the same history — so running to just past the moment gives it)
    await runHistory({ list: 'terrain', scene, ending: 'none', start: { continentalFraction: cont / 100 }, lengthMyr: Math.ceil((time + 10) / 10) * 10, keep: false },
        buildSimMesh(sim, MESH_SEED), seed, 10, () => {}, f => {
            if (Math.abs(f.time - time) < 1e-6) { frame = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]])); frame.plates = f.plates.map(p => p && { quat: p.quat }); }
        });
    if (!frame) throw new Error(`no frame at ${time} Myr (moments come every 10 Myr)`);
    fs.mkdirSync(frameDir, { recursive: true });
    fs.writeFileSync(frameFile, v8.serialize({ frame }));
    return frame;
}
