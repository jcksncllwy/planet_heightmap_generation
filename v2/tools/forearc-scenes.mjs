// The forearc ramp on the terrain scenes with a real subduction margin (andes, japan): how many sea-side terrain cells the
// wedge lifts, by its width W (coast to trench through the cell), and how high its shallowest cells stand. Lane coasts2 bounded
// the wedge to its own margin (synthesize.js, terrain-config forearcTaperDeg); this checks the real forearcs keep their ramp.
// Needs the sea side's debug buffers (lanes-2026-10-29/coasts debug hook, never committed); without them it says so.
//
//   node v2/tools/forearc-scenes.mjs [--scenes andes,japan] [--cells 640000]
import { labMesh } from './lib/check-kit.mjs';
import { simulateCached } from './lib/history-cache.mjs';
import { TERRAIN_SCENES, sceneTerrainConfig } from '../js/tectonics/scenarios/terrain-scenes.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { synthesizeTerrain } from '../js/terrain/synthesize.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = 12345, mesh = labMesh(), cells = Number(arg('--cells', 640000));
for (const id of arg('--scenes', 'andes,japan').split(',')) {
    const scene = TERRAIN_SCENES.find(s => s.id === id), world = scene.build(mesh, SEED);
    const { frames } = simulateCached(world, { untilMyr: scene.maxMyr, drive: w => scene.drive(w), snapshotEveryMyr: scene.maxMyr > 200 ? 50 : 10 }, { drive: scene.drive });
    const tm = terrainMesh(cells), n = tm.numCells;
    const DB = globalThis.__coastDbg = { rs: new Float32Array(n).fill(NaN), floor: new Float32Array(n).fill(NaN), c: new Int32Array(3 * n), w: new Float32Array(3 * n), slope: new Float32Array(n), top: new Float32Array(n), coast: new Float32Array(n), act: new Float32Array(n), lift: new Float32Array(n), tk: new Float32Array(n).fill(NaN), rk: new Float32Array(n).fill(NaN) };
    const T = synthesizeTerrain(frames.at(-1), mesh, tm, { seed: SEED, cfg: sceneTerrainConfig(scene) });
    if (!DB.floor.some(v => v === v)) { console.log(`${id}: no debug buffers (apply the coasts debug hook)`); continue; }
    const bins = [[0, 150], [150, 250], [250, 400], [400, 1e9]].map(([a, b]) => ({ a, b, n: 0, km: 0 }));
    let ramp = 0;
    for (let t = 0; t < n; t++) {
        if (!(DB.lift[t] > 0.3)) continue;
        ramp++; const W = DB.tk[t] - DB.coast[t], B = bins.find(x => W >= x.a && W < x.b); if (B) { B.n++; B.km += DB.lift[t]; }
    }
    // (the margin's own width: W at the line, where the wedge begins — coast within 30 km, a trench in reach)
    const atLine = []; for (let t = 0; t < n; t++) if (DB.coast[t] > -30 && DB.tk[t] < 2000) atLine.push(DB.tk[t] - DB.coast[t]);
    atLine.sort((a, b) => a - b); const q = p => atLine.length ? Math.round(atLine[Math.floor(p * (atLine.length - 1))]) : NaN;
    console.log(`${id}: W at the line (coast ≤ 30 km off, trench in reach) p10 ${q(0.1)} · p50 ${q(0.5)} · p90 ${q(0.9)} km over ${atLine.length} cells`);
    console.log(`${id} at ${frames.at(-1).time} Myr, sea ${(T.rec.seaKm ?? 0).toFixed(2)} km: forearc ramp lifting > 0.3 km ${ramp} cells; by W ` + bins.map(B => `${B.a}–${B.b < 1e9 ? B.b : '∞'} km ${B.n} (mean ${(B.km / Math.max(1, B.n)).toFixed(2)})`).join(' · '));
}
