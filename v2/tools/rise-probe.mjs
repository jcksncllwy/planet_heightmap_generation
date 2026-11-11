// Scratch probe (lane riserock): the live world's rise books every 50 Myr — laid, spilled past the reach (riseOverKm3),
// and cells standing above the floor's full room (rock ÷ SEDIMENT_LOAD_FACTOR > the floor's depth).
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { simulate } from '../js/tectonics/simulate.js';
import { pageWorld, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { CrustType } from '../js/tectonics/model/crust.js';
import { seaDepthKm, SEDIMENT_LOAD_FACTOR } from '../js/tectonics/measure.js';
setDelaunator(Delaunator);
const [seed = 831576, until = 450] = process.argv.slice(2).map(Number);
const { scene, world } = pageWorld({ seed, cont: DEFAULT_CONT, sim: 40000 }), A = world.mesh.cellAreaKm2;
simulate(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 50, keepFrames: false, onFrame: () => {
    let over = 0, overVol = 0, mx = 0;
    for (const p of world.plates) if (p.alive) { const k = p.crust; for (let c = 0; c < k.mask.length; c++) if (k.mask[c] && k.type[c] === CrustType.OCEAN) {
        const r = k.riseKm3[c] / A, cap = SEDIMENT_LOAD_FACTOR * seaDepthKm(world.time - k.formedAt[c]);
        if (r > cap) { over++; overVol += (r - cap) * A; } mx = Math.max(mx, r);
    } }
    const B = world.budget, g = x => ((x ?? 0) / 1e6).toFixed(1);
    console.log(`t ${Math.round(world.time)}: laid ${g(B.riseKm3)}e6 spilled-even ${g(world.riseOverKm3)}e6 down ${g(B.riseDownKm3)} kept ${g(B.riseKeptKm3)}; above-sea cells ${over} (${g(overVol)}e6 km³ over), max ${mx.toFixed(1)} km`);
} });
