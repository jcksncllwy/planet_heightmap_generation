// The in-plate stress field (field/plate-stress-field.js) on the page's history: at each time, the solve's cost and
// convergence, and the stress against the stress study's numbers (2η ε̇_II p50/p90/p99, N/m) and the principal stresses
// over land. Usage: node v2/tools/pstress-field.mjs --seed 831576 --times 2,100,200,300,400,500,600 [--cells 10000] [--sim 40000]
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { pageWorld, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { solvePlateStress } from '../js/tectonics/field/plate-stress-field.js';
import { CrustType } from '../js/tectonics/model/crust.js';

setDelaunator(Delaunator);
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const seed = Number(arg('--seed', 831576)), times = arg('--times', '100,200,300,400,500').split(',').map(Number), sim = Number(arg('--sim', 40000));
const { scene, world } = pageWorld({ seed, cont: DEFAULT_CONT, sim });
if (arg('--cells')) world.config.plateStressCells = Number(arg('--cells'));
if (arg('--set')) for (const kv of arg('--set').split(',')) { const [k, v] = kv.split('='); world.config[k] = Number(v); }
const q = (a, p) => a.length ? +a[Math.floor(p * (a.length - 1))].toExponential(2) : NaN;
simulate(world, { untilMyr: Math.max(...times), drive: w => scene.drive(w), snapshotEveryMyr: 2, keepFrames: false, onFrame: f => {
    if (!times.includes(Math.round(f.time)) || Math.abs(f.time - Math.round(f.time)) > 1e-9) return;
    for (const v of (arg('--variants', '') || '-').split(';')) {
    if (v !== '-') for (const kv of v.split(',')) { const [k, x] = kv.split('='); world.config[k] = Number(x); }
    world.plateStress = null;
    const t0 = performance.now(), st = solvePlateStress(world), ms = performance.now() - t0;
    const S = world.plateStress, land1 = [], land2 = [], all1 = [];
    for (let w = 0; w < world.mesh.numCells; w++) {
        const k = S.simTo[w], o = world.owner[w];
        if (o < 0 || S.own[k] !== o || !S.active[k] || !(S.s1[k] === S.s1[k])) continue;
        all1.push(S.s1[k]);
        if (world.plates[o].crust.type[world.ownerCell[w]] !== CrustType.OCEAN) { land1.push(S.s1[k]); land2.push(S.s2[k]); }
    }
    for (const a of [land1, land2, all1]) a.sort((x, y) => x - y);
    console.log(JSON.stringify({ v, seed, t: Math.round(f.time), ms: Math.round(ms), it: st.iterations, rel: +st.rel.toExponential(1), imbalance: +st.imbalance.toFixed(3), dropped: +st.dropped.toFixed(3),
        tII: st.tII.map(v => +v.toExponential(2)), s1all: [q(all1, 0.5), q(all1, 0.9), q(all1, 0.99)], s1land: [q(land1, 0.1), q(land1, 0.5), q(land1, 0.9), q(land1, 0.99)], s2land: [q(land2, 0.01), q(land2, 0.1), q(land2, 0.5)] }));
    }
} });
