// Is a history run-to-run deterministic? Builds the page's history (moment-frame.mjs pageWorld: scene 'cycle') for a seed
// with the history cache off, and hashes every field of every frame — so two runs (or --repeat runs in one process)
// show the first time and the first field where they part.
//   node v2/tools/determinism-probe.mjs --seed 12345 [--sim 10000] [--until 200] [--every 10] [--repeat 1] [--out f.jsonl]
// One JSON line per frame: { run, time, all, fields: { name: hash } }; then a summary line { run, final } (final: the
// hash of all the frames). Compare two runs' files with --diff a.jsonl b.jsonl (first time and fields that part).
process.env.GEO_SIM_HISTORY_CACHE = '0';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fieldHashes } from './lib/frame-hash.mjs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { simulate } from '../js/tectonics/simulate.js';
import { pageWorld } from './lib/moment-frame.mjs';

setDelaunator(Delaunator);
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if (argv[0] === '--diff') {
    const read = f => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.fields);
    const [a, b] = [read(argv[1]), read(argv[2])];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i].all === b[i].all) continue;
        const diff = Object.keys({ ...a[i].fields, ...b[i].fields }).filter(k => a[i].fields[k] !== b[i].fields[k]);
        console.log(JSON.stringify({ firstTime: a[i].time, fields: diff }));
        process.exit(1);
    }
    console.log(JSON.stringify({ identical: true, frames: Math.min(a.length, b.length) }));
    process.exit(0);
}

const seed = Number(arg('--seed', 12345)), sim = Number(arg('--sim', 10000)), cont = Number(arg('--cont', 30));
const until = Number(arg('--until', 200)), every = Number(arg('--every', 10)), repeat = Number(arg('--repeat', 1));
const out = arg('--out', null), lines = [];
const emit = o => { const s = JSON.stringify(o); lines.push(s); if (!out) console.log(s); };
for (let run = 0; run < repeat; run++) {
    const { scene, world } = pageWorld({ seed, cont, sim });
    const all = crypto.createHash('sha1'), t0 = Date.now();
    simulate(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: every, keepFrames: false, onFrame: f => {
        const fields = fieldHashes(f), fh = crypto.createHash('sha1').update(JSON.stringify(fields)).digest('hex').slice(0, 12);
        all.update(fh);
        emit({ run, time: f.time, all: fh, fields });
    } });
    emit({ run, seed, sim, until, final: all.digest('hex').slice(0, 12), steps: world.step, s: (Date.now() - t0) / 1000 });
}
if (out) fs.writeFileSync(out, lines.join('\n') + '\n');
