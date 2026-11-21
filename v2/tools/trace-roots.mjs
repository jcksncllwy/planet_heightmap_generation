#!/usr/bin/env node
// Collision roots over a history (lane contarea, the crust-flow gap: graded/attribution.md "crust-flow gap"): per frame, the
// deepest continental root (rootKm on continent and craton cells, km below/above the reference crust), how many cells carry a
// root past Earth's thickest crust (Tibet: 70–80 km of crust, a root of ~35–45 km over the 35 km reference; Owens & Zandt
// 1997), the continental cell count, and orogenic collapse's area and volume made since the last frame (budget.collapseCells,
// collapseMadeKm3). A records-only tool: the history's path is the page's (or the scene's).
//   node v2/tools/trace-roots.mjs --scene founder [--seed 12345] [--myr 300]
//   node v2/tools/trace-roots.mjs --seed 831576 [--myr 1000]          (a page world)
// Prints one `ROOTS t … maxroot … >45 … cont … collapse …` line a frame and `ROOTS_JSON {…}` at the end.
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { simulate } from '../js/tectonics/simulate.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { updatePlateMotion } from '../js/tectonics/step/torque-balance.js';
import { RIFT_SCENES } from '../js/tectonics/scenarios/rift-scenes.js';
import { labMesh } from './lib/check-kit.mjs';
import { pageWorld, DEFAULT_CONT } from './lib/moment-frame.mjs';

setDelaunator(Delaunator);
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const sceneId = arg('scene', null), seed = +arg('seed', sceneId ? 12345 : 831576);
const scene = sceneId ? RIFT_SCENES.find(s => s.id === sceneId) : null;
const page = scene ? null : pageWorld({ seed, cont: +arg('cont', DEFAULT_CONT), sim: +arg('sim', 40000) });
const world = scene ? scene.build(labMesh(), seed) : page.world, drive = scene ? updatePlateMotion : w => page.scene.drive(w);
const MYR = +arg('myr', scene ? scene.maxMyr : 1000), every = +arg('every', scene ? 4 : 10);
const HI = 45;
const frames = [];
let last = { cells: 0, km3: 0 };
const t0 = Date.now();
await simulate(world, {
    untilMyr: MYR, snapshotEveryMyr: every, keepFrames: false, drive,
    onFrame: () => {
        let max = 0, hi = 0, cont = 0, worst = null;
        // what walls in a deep root (cells past HI): its neighbours by kind — sea, island arc, craton, off the raster, and
        // continent standing higher or lower — and whether its own belt is still active (orogenyQuietMyr) or on the coast
        const walls = { sea: 0, arc: 0, craton: 0, edge: 0, contLower: 0, contHigher: 0, active: 0, quiet: 0 };
        const { adjOffset, adjList } = world.mesh;
        for (const p of world.plates) {
            if (!p.alive) continue;
            const { mask, type, rootKm, oroLast, oroType } = p.crust;
            for (let c = 0; c < mask.length; c++) {
                if (!mask[c] || (type[c] !== CrustType.CONTINENT && type[c] !== CrustType.CRATON)) continue;
                cont++;
                if (rootKm[c] > max) { max = rootKm[c]; worst = { plate: p.id, cell: c, type: type[c], oro: oroType[c], quietMyr: +(world.time - oroLast[c]).toFixed(1), nb: [] }; }
                if (rootKm[c] <= HI) continue;
                hi++;
                if (world.time - oroLast[c] >= world.config.orogenyQuietMyr) walls.quiet++; else walls.active++;
                for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                    const nb = adjList[k];
                    if (!mask[nb]) walls.edge++;
                    else if (type[nb] === CrustType.OCEAN) walls.sea++;
                    else if (type[nb] === CrustType.ARC) walls.arc++;
                    else if (type[nb] === CrustType.CRATON) walls.craton++;
                    else if (rootKm[nb] < rootKm[c]) walls.contLower++; else walls.contHigher++;
                }
            }
        }
        if (worst) { const { mask, type, rootKm } = world.plates[worst.plate].crust; for (let k = adjOffset[worst.cell]; k < adjOffset[worst.cell + 1]; k++) { const nb = adjList[k]; worst.nb.push(mask[nb] ? `${type[nb]}:${rootKm[nb].toFixed(0)}` : 'x'); } }
        const B = world.budget, cells = (B.collapseCells ?? 0) - last.cells, km3 = (B.collapseMadeKm3 ?? 0) - last.km3;
        last = { cells: B.collapseCells ?? 0, km3: B.collapseMadeKm3 ?? 0 };
        const fr = { t: +world.time.toFixed(1), maxRootKm: +max.toFixed(1), over45: hi, cont, collapseCells: cells, collapseMkm3: +(km3 / 1e6).toFixed(3), walls, worst };
        frames.push(fr);
        console.log(`ROOTS t ${fr.t} maxroot ${fr.maxRootKm} >${HI} ${hi} cont ${cont} collapse ${cells} cells ${fr.collapseMkm3} Mkm³ | walls ${JSON.stringify(walls)} worst ${worst ? `t${worst.type} oro${worst.oro} q${worst.quietMyr} [${worst.nb.join(' ')}]` : '-'}  (${((Date.now() - t0) / 1e3).toFixed(0)} s)`);
    },
});
const worst = frames.reduce((a, f) => (f.maxRootKm > a.maxRootKm ? f : a), frames[0]);
console.log(`ROOTS_JSON ${JSON.stringify({ scene: sceneId, seed, myr: MYR, worst, maxCollapseMkm3: Math.max(...frames.map(f => f.collapseMkm3)), frames })}`);
