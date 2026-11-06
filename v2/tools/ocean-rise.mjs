// The rivers' rise rock on the open floor (lane sliders, ruling (b)'s lead): crust.riseKm3 (step/trench-fans.js layRise,
// booked in the rock book as riseKm3) is laid on the ocean cells off each mouth but no surface draws it (not a frame
// field: records.js and inventory.js surfaceKm ignore it). Read live from the world every 100 Myr: the rise standing on
// the open floor (ocean crust, not filled), its volume and the shallowing it would make spread where it lies, per cell
// rise / cell area / SEDIMENT_LOAD_FACTOR (measure.js: sediment loads the floor, so it shallows by less than its
// thickness). Earth: marine sediment 3.01e8 km³, mean 0.72 km (Straume et al. 2019, GlobSed).
// Usage: node v2/tools/ocean-rise.mjs [--seeds 626225,777,12345] [--until 1200] [--sim 40000] [--cont 29]
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { simulateCached } from './lib/history-cache.mjs';
import { pageWorld } from './lib/moment-frame.mjs';
import { CrustType } from '../js/tectonics/model/crust.js';
import { SEDIMENT_LOAD_FACTOR } from '../js/tectonics/measure.js';

setDelaunator(Delaunator);
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seeds = flag('--seeds', '626225,777,12345').split(',').map(Number), until = Number(flag('--until', 1200));
const sim = Number(flag('--sim', 40000)), cont = Number(flag('--cont', 29));
for (const seed of seeds) {
    const { scene, world } = pageWorld({ seed, cont, sim }), n = world.mesh.numCells, A = 4 * Math.PI * 6371 * 6371 / n, rows = [];
    simulateCached(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 100, keepFrames: false, onFrame: () => {
        let N = 0, vol = 0, sh = 0, all = 0;
        for (let w = 0; w < n; w++) {
            const o = world.owner[w]; if (o < 0) continue;
            const cr = world.plates[o].crust, c = world.ownerCell[w], r = cr.riseKm3[c];
            all += r;
            if (cr.type[c] !== CrustType.OCEAN || cr.seaFillKm[c] > 0) continue;
            N++; vol += r; sh += r / A / SEDIMENT_LOAD_FACTOR;
        }
        rows.push(`t ${Math.round(world.time)}: rise standing ${(all / 1e6).toFixed(1)}e6 km³ (open floor ${(vol / 1e6).toFixed(1)}e6) → mean shallowing ${(1000 * sh / Math.max(1, N)).toFixed(0)} m over the open floor`);
    } }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim, by: 'ocean-rise' } });
    console.log(`seed ${seed}\n  ${rows.join('\n  ')}`);
}
