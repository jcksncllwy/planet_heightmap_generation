// The civ run's fingerprint on cached ensemble worlds (civ-ensemble.mjs builds them): a hash of every frame's density, way
// of life and package, towns and polities, the totals and the per-cell dates — to show that a refactor leaves a model's
// runs byte-identical (plans/CIV_PLAN.md §9.7, C0). It also warns of a constant CIV names twice.
//
//   node --max-old-space-size=8000 v2/tools/civ-fingerprint.mjs [--seeds 1,6,13] [--set key=value,…]

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import crypto from 'node:crypto';
import { OUT, worldCode } from './lib/civ-world.mjs';
import { meshFromArrays } from '../js/core/sim-mesh.js';
import { civSubstrate } from '../js/civ/substrate.js';
import { runCivSim } from '../js/civ/sim.js';
import { CIV } from '../js/civ/civ-config.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const set = arg('--set', ''), C = { ...CIV, ...(set ? Object.fromEntries(set.split(/,(?=[A-Za-z_]+=)/).map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), JSON.parse(kv.slice(i + 1))]; })) : {}) };
// (a constant named twice in CIV is silently the second: say so — a new one once took the towns' fieldShare)
const cfg = fs.readFileSync(new URL('../js/civ/civ-config.js', import.meta.url), 'utf8').split('export const CIV_PRIORS')[0];
const names = [...cfg.matchAll(/^    ([A-Za-z]\w*):/gm)].map(m => m[1]), twice = names.filter((k, i) => names.indexOf(k) !== i);
if (twice.length) console.log(`CIV names these twice (the second wins): ${[...new Set(twice)].join(', ')}`);
const cache = path.join(OUT, 'cache'), files = fs.readdirSync(cache);
for (const seed of arg('--seeds', '1,6,13').split(',')) {
    const f = files.find(x => x.startsWith(`page-${seed}-`) && x.endsWith(`160k-${worldCode()}.bin`));
    if (!f) { console.log(seed, 'no cached world: run civ-ensemble.mjs first'); continue; }
    const w = v8.deserialize(fs.readFileSync(path.join(cache, f)));
    w.mesh = meshFromArrays(w.mesh);
    const t0 = Date.now(), r = runCivSim(w, civSubstrate(w, C), { C });
    const h = crypto.createHash('sha1'), add = a => h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    for (const fr of r.frames) {
        add(fr.density); add(fr.life); add(fr.farmPkg);
        h.update(JSON.stringify([fr.bp, fr.people, fr.farmers, fr.polities]));
        if (fr.towns) add(fr.towns);
        if (fr.polityTable) h.update(JSON.stringify(fr.polityTable, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
    }
    add(r.arrivalBP); add(r.farmBP); add(r.onsetBP);
    h.update(JSON.stringify([r.centres, r.totals, r.voyagingBP]));
    console.log(seed, h.digest('hex').slice(0, 16), `${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
