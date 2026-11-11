// How far the history's own sea falls within the rivers' carving time (coastflood, 2026-11-09): the carve's base level is
// the lower of the ice age's lowstand (terrain-config iceSeaDropKm, 0.12 km) and the lowest the history's sea stood
// against the moment's within carveTimeMyr before it (synthesize.js carveSettings seaWindowKm). This measures the second
// over whole histories, at the page's 2 Myr frames (the level between frames linear), so the first is known to dominate
// or not. Earth's tectonic eustasy runs at ≲ 10–20 m/Myr (Haq & Al-Qahtani 2005; Müller et al. 2008: ~250 m over ~100 Myr).
// Usage: node v2/tools/sea-window.mjs [--seeds 831576,12345,777] [--until 600] [--sim 40000] [--cont 30] [--every 2]
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { simulateCached } from './lib/history-cache.mjs';
import { pageWorld, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { FRAME_FIELDS } from '../js/terrain/terrain-pool.js';
import { terrainConfig, TERRAIN } from '../js/terrain/terrain-config.js';
import { landMask } from '../js/terrain/land-mask.js';

setDelaunator(Delaunator);
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seeds = flag('--seeds', '831576,12345,777').split(',').map(Number), until = Number(flag('--until', 600));
const sim = Number(flag('--sim', 40000)), cont = Number(flag('--cont', DEFAULT_CONT)), every = Number(flag('--every', 2));
const windowMyr = TERRAIN.carveTimeMyr, H = terrainConfig();
for (const seed of seeds) {
    const { scene, world } = pageWorld({ seed, cont, sim }), simMesh = buildSimMesh(sim, MESH_SEED), mask = {}, rows = [];
    simulateCached(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: every, keepFrames: false, onFrame: f => {
        const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]]));
        rows.push({ t: f.time, seaKm: landMask(fr, simMesh, H, mask).sl.seaKm });
    } }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim, meshSeed: MESH_SEED, by: 'sea-window' } });
    // (the window's lowest against the moment's: the level at t − window, linear between frames — a fall only)
    const falls = [];
    for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1], b = rows[i], fr = Math.min(1, windowMyr / (b.t - a.t));
        falls.push({ t: b.t, m: 1000 * Math.min(0, fr * (a.seaKm - b.seaKm)) });
    }
    const sorted = falls.map(x => x.m).sort((x, y) => x - y), q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const worst = falls.reduce((w, x) => (x.m < w.m ? x : w), { m: 0, t: 0 });
    console.log(`seed ${seed}: ${rows.length} frames every ${every} Myr, window ${windowMyr} Myr · history's fall within it: median ${q(0.5).toFixed(1)} m, 1 % ${q(0.01).toFixed(1)} m, worst ${worst.m.toFixed(1)} m at ${worst.t.toFixed(0)} Myr · ice age −${1000 * TERRAIN.iceSeaDropKm} m`);
}
