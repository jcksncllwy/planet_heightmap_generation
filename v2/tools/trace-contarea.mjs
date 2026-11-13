// The continental crust's AREA over a page history, and who moves it (lane contarea, 2026-11-12: phase 1, measure only).
// sealevel's open problem (iii): the history's ocean crust covers 59–66 % of the planet against Earth's 57.4 %, so the sea
// holds more water at the same depth. This follows one page history (the Evolution page's: scene 'cycle', the page's sim
// mesh, the default Crust) with the crust ledger on (step/crust-ledger.js) and, per 10 Myr frame:
//   - the surface's shares (the resolved view, owner ≥ 0): continent, craton, arc, ocean, unowned;
//   - the continental crust's volume and mean thickness (crust-ledger.js crustVolume over the rasters);
//   - every live raster's continental and arc cells summed (the ledger's tally: hidden crust under a neighbour counts too,
//     so raster − surface is the land stacked under other land);
//   - each ledger stage's change in continental and arc cells since the last frame (the books: which process made or lost
//     the land), and world.budget's counters' change (underthrust, recycled, eroded cells …).
// GEO_SIM_PATH=k runs the perturbed path (lib/paths.mjs); the series itself shows whether the nudge reached the history.
//   node v2/tools/trace-contarea.mjs --seed 716130 [--myr 1100] [--sim 40000] [--set key=value …] [--out file.json]
// Prints one line `CONTAREA_JSON {…}` (the whole series).
import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { simulate } from '../js/tectonics/simulate.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { crustTally, crustVolume } from '../js/tectonics/step/crust-ledger.js';
import { pageWorld, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { onPath, PATH_K } from './lib/paths.mjs';

setDelaunator(Delaunator);
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const seed = +arg('seed', 716130), MYR = +arg('myr', 1100), SIM = +arg('sim', 40000), cont = +arg('cont', DEFAULT_CONT);
const OUT = arg('out', null);
const sets = argv.flatMap((a, i) => a === '--set' ? [argv[i + 1]] : []);

const { scene, world } = pageWorld({ seed, cont, sim: SIM });
onPath(world);
world.config.crustLedger = true;
for (const s of sets) {
    const [k, v] = s.split('=');
    if (!(k in world.config)) throw new Error(`unknown config key ${k}`);
    world.config[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v;
}
const n = world.mesh.numCells;
const pct = c => +(100 * c / n).toFixed(3);

let lastStages = {}, lastBudget = {};
const frames = [];
const t0 = performance.now();
simulate(world, {
    untilMyr: MYR, snapshotEveryMyr: 10, keepFrames: false,
    drive: w => scene.drive(w),
    onFrame: f => {
        const s = { cont: 0, craton: 0, arc: 0, ocean: 0, none: 0 };
        for (let w = 0; w < n; w++) {
            if (f.owner[w] < 0) { s.none++; continue; }
            const t = f.type[w];
            if (t === CrustType.CONTINENT) s.cont++; else if (t === CrustType.CRATON) s.craton++;
            else if (t === CrustType.ARC) s.arc++; else s.ocean++;
        }
        // (the volume: crust-ledger.js crustVolume, Σ crustThicknessKm over every raster's continent — does the area lost go
        // to thickness, or off the continental books?)
        const vol = crustVolume(world), tally = crustTally(world), stages = world.ledger?.stages ?? {}, d = {};
        for (const [k, e] of Object.entries(stages)) {
            const p = lastStages[k] ?? { land: 0, arc: 0 }, dl = e.land - p.land, da = e.arc - p.arc;
            if (dl || da) d[k] = [dl, da];
        }
        lastStages = Object.fromEntries(Object.entries(stages).map(([k, e]) => [k, { land: e.land, arc: e.arc }]));
        const db = {};
        for (const [k, v] of Object.entries(world.budget ?? {})) { if (typeof v !== 'number') continue; const dv = v - (lastBudget[k] ?? 0); if (dv) db[k] = +dv.toPrecision(6); }
        lastBudget = Object.fromEntries(Object.entries(world.budget ?? {}).filter(([, v]) => typeof v === 'number'));
        frames.push({
            t: Math.round(f.time), land: pct(s.cont + s.craton), craton: pct(s.craton), arc: pct(s.arc), ocean: pct(s.ocean), none: pct(s.none),
            rasterLand: pct(tally.land), volKm3: +(vol * world.mesh.cellAreaKm2).toPrecision(5), meanKm: +(vol / Math.max(1, tally.land)).toFixed(2), rasterArc: pct(tally.arc), plates: world.plates.filter(p => p.alive).length, stages: d, budget: db,
        });
        const fr = frames.at(-1);
        process.stderr.write(`t ${fr.t}  land ${fr.land}  arc ${fr.arc}  ocean ${fr.ocean}  raster ${fr.rasterLand}  ${fr.meanKm} km  (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`);
    },
});
const out = { seed, cont, sim: SIM, path: PATH_K, sets, n, seconds: +((performance.now() - t0) / 1000).toFixed(1), frames };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out));
// (the whole series on stdout: a sim-slots job run on chroma brings back its output, not its files)
console.log(`CONTAREA_JSON ${JSON.stringify(out)}`);
