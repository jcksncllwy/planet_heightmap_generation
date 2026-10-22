// How a fresh rift opens along its length: for the first continental rifts of a history, the separation of the two halves at
// stations along the rift (0 its open end … 1 its far end), at a few ages after the split.
// Usage: node v2/tools/trace-scissor.mjs [simCells=40000] [seed …] [--len 600] [--set key=value,…]
import { labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';

const args = process.argv.slice(2), flag = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const len = Number(flag('--len') ?? 600), set = flag('--set');
const overrides = set ? Object.fromEntries(set.split(',').map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; })) : {};
const nums = args.map(Number), cells = nums[0] || 40000, seeds = nums.length > 1 ? nums.slice(1) : [12345];
const mesh = labMesh(cells), scene = TERRAIN_SCENES.find(s => s.id === 'cycle');
const AGES = [2, 5, 10, 15, 20, 30, 45], STATIONS = [0, 0.25, 0.5, 0.75, 1];
const R = 6371;

for (const seed of seeds) {
    const world = scene.build(mesh, seed, { continentalFraction: 0.3 });
    Object.assign(world.config, overrides);
    const seen = new Set(), watch = [];
    const drive = w => {
        scene.drive(w);
        for (const p of w.plates) {
            if (!p.alive || !p.riftHinge || seen.has(p.riftHinge)) continue;
            const q = w.plates[p.riftPartner];
            if (!q?.alive || q.riftHinge !== p.riftHinge) continue;
            seen.add(p.riftHinge);
            if (watch.length < 6) watch.push({ a: p, b: q, hinge: p.riftHinge, t0: w.time, rows: [] });
        }
        for (const W of watch) {
            const age = w.time - W.t0, due = AGES.find(x => x <= age && !W.rows.some(r => r.age === x));
            if (due === undefined) continue;
            const { from: a, to: b } = W.hinge, th = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
            const gaps = STATIONS.map(f => {
                const wa = Math.sin((1 - f) * th) / Math.sin(th), wb = Math.sin(f * th) / Math.sin(th);
                const p = [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]];
                const pa = W.a.toWorld(p[0], p[1], p[2], [0, 0, 0]), pb = W.b.toWorld(p[0], p[1], p[2], [0, 0, 0]);
                return Math.round(R * Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]));
            });
            W.rows.push({ age: due, gaps, alive: W.a.alive && W.b.alive });
        }
    };
    simulate(world, { untilMyr: len, drive, snapshotEveryMyr: 50 });
    console.log(`seed ${seed}`);
    for (const W of watch) {
        console.log(`  rift at ${W.t0.toFixed(0)} Myr, ${Math.round(R * Math.acos(W.hinge.from[0] * W.hinge.to[0] + W.hinge.from[1] * W.hinge.to[1] + W.hinge.from[2] * W.hinge.to[2]))} km long — separation (km) at stations ${STATIONS.join(' ')}`);
        for (const r of W.rows) console.log(`    +${String(r.age).padStart(2)} Myr  ${r.gaps.map(g => String(g).padStart(5)).join(' ')}`);
    }
}
