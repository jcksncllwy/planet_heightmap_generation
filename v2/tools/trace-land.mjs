// The land above the sea at chosen moments of a page history (lane contarea; marine-run's flag on 831576 at 430 Myr): each
// moment's frame drawn by the terrain (terrain/synthesize.js on a 160k-cell terrain mesh, no finish erosion), its area above
// the sea (Mkm²) and the median height of that land (m); and the history's continental crust there (% of the planet).
// A cheap proxy for the 2.5M finish's land: the same frame, coarser, unfinished, ice not taken out.
// Prints one line `LAND_JSON {…}`.
//   node v2/tools/trace-land.mjs --seed 831576 [--at 300,430,600]

import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { simulate } from '../js/tectonics/simulate.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { synthesizeTerrain } from '../js/terrain/synthesize.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { pageWorld, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { onPath, PATH_K } from './lib/paths.mjs';

setDelaunator(Delaunator);
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const seed = +arg('seed', 831576), cont = +arg('cont', DEFAULT_CONT), AT = arg('at', '300,430,600').split(',').map(Number);
const { scene, world } = pageWorld({ seed, cont, sim: 40000 });
onPath(world);
const tm = terrainMesh(160000), EARTH_KM2 = 510.07e6, out = [];
const t0 = performance.now();
await simulate(world, {
    untilMyr: Math.max(...AT), snapshotEveryMyr: 10, keepFrames: false,
    drive: w => scene.drive(w),
    onFrame: f => {
        if (!AT.some(t => Math.abs(t - f.time) < 1e-6)) return;
        let cont = 0, n = 0;
        for (let w = 0; w < f.owner.length; w++) { if (f.owner[w] < 0) continue; n++; if (f.type[w] === CrustType.CONTINENT || f.type[w] === CrustType.CRATON) cont++; }
        const T = synthesizeTerrain(f, world.mesh, tm, { seed }), up = [];
        for (let t = 0; t < tm.numCells; t++) if (T.heightKm[t] > 0) up.push(T.heightKm[t]);
        up.sort((a, b) => a - b);
        out.push({ t: Math.round(f.time), landMkm2: +(EARTH_KM2 * up.length / tm.numCells / 1e6).toFixed(1), p50m: up.length ? Math.round(1000 * up[up.length >> 1]) : 0, contPct: +(100 * cont / world.mesh.numCells).toFixed(1) });
        process.stderr.write(`t ${out.at(-1).t}  land ${out.at(-1).landMkm2} Mkm²  p50 ${out.at(-1).p50m} m  crust ${out.at(-1).contPct} %  (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`);
    },
});
console.log(`LAND_JSON ${JSON.stringify({ seed, cont, path: PATH_K, at: out })}`);
