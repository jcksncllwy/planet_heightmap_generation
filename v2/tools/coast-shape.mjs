// The coastline's shape at a moment, measured: its divider dimension D and its length ratio L(50 km) / L(500 km), per
// kind of margin, against Earth's (tools/lib/coast-fractal.mjs) — on the tectonic surface (Phase 8a, before rivers carve
// it), and with --finish on the finished planet (the Evolution page's "Add detail": rivers, ice, waves).
//
//   node v2/tools/coast-shape.mjs --seed 626225 --cont 30 --time 950 [--sim 40000] [--cells 1000000] [--finish]
//        [--bands] [--set key=value,…]
//
// --bands measures the surface again with each source of the coast's shape taken away or changed in turn
// (terrain-config.js): the rugged coasts' noise and fine detail, the arcs' straits, the lookup warps, the shelf's
// variation, and the width the margin's line is smoothed over (margin-line.js). On a shared machine run it through sim-slots (-n 4 for the surface).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { TERRAIN } from '../js/terrain/terrain-config.js';
import { deriveRecords } from '../js/terrain/records.js';
import { finishPlanet } from '../js/finish/finish.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { coastLoops, coastFractal, kindOf, COAST_KINDS, EARTH_D } from './lib/coast-fractal.mjs';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('--seed', 626225)), CONT = Number(arg('--cont', 30)), SIM = Number(arg('--sim', 40000)), TIME = Number(arg('--time', 950));
const CELLS = Number(arg('--cells', 1000000));
const parseSet = s => Object.fromEntries((s || '').split(/,(?=[A-Za-z])/).filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, Number.isFinite(Number(v)) ? Number(v) : JSON.parse(v)]; }));
const SET = parseSet(arg('--set', ''));
const t0 = performance.now(), secs = () => `${((performance.now() - t0) / 1000).toFixed(0)} s`;

const frame = await momentFrame(ROOT, { seed: SEED, cont: CONT, sim: SIM, time: TIME });
const simMesh = buildSimMesh(SIM, MESH_SEED), cfg0 = { ...TERRAIN, ...SET };
const rec = deriveRecords(frame, simMesh, cfg0, SEED);
console.log(`frame ${TIME} Myr of seed ${SEED} (${secs()})`);

const show = (label, F) => {
    const row = name => { const f = F[name]; return f ? `${name} ${f.D.toFixed(3)}${Number.isFinite(f.ratio) ? ` (×${f.ratio.toFixed(2)})` : ''} ${Math.round(f.km / 1000)}k km` : null; };
    console.log(`${label.padEnd(16)} ${['all', ...COAST_KINDS].map(row).filter(Boolean).join(' · ')}`);
};

const pool = await TerrainPool.create(simMesh);
if (process.argv.includes('--finish')) {
    const fin = await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true, onStage: () => {} });
    const loops = coastLoops(fin.mesh, c => fin.ocean[c] === 1, fin.z);
    show('finished', coastFractal(loops, kindOf(simMesh, rec, fin.glaciated ?? null), { kinds: COAST_KINDS }));
} else {
    const tm = terrainMesh(CELLS);
    const variants = [['surface', {}]];
    if (process.argv.includes('--bands')) {
        const noNoise = { coastNoiseKm: 0, coastDetailKm: 0 };
        variants.push(['−coastNoise', { coastNoiseKm: 0 }], ['−detail', { coastDetailKm: 0 }], ['−arcStraits', { arcStraitKm: 0 }],
            ['−all noise', noNoise], ['−noise −warps', { ...noNoise, warpKm: 0, cellWarp: 0 }], ['−shelfNoise', { shelfNoise: 0 }],
            ['−shelfAlong', { shelfAlongKm: 0 }], ['line ½ cell', { coastLineCells: 0.5 }], ['line 1½ cells', { coastLineCells: 1.5 }]);
    }
    for (const [label, ov] of variants) {
        const cfg = { ...cfg0, ...ov };
        const T = await pool.synthesize(frame, tm, { cfg, seed: SEED, records: false });
        const loops = coastLoops(tm, c => T.heightKm[c] < 0, T.heightKm);
        show(label, coastFractal(loops, kindOf(simMesh, rec), { kinds: COAST_KINDS }));
    }
    pool.terminate();
}
console.log(`Earth: ${Object.entries(EARTH_D).map(([k, e]) => `${k} ${e.earth.join('–')}`).join(' · ')} (${secs()})`);
