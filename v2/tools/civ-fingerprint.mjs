// The civ run's fingerprint on cached ensemble worlds (civ-ensemble.mjs builds them): a hash of every frame's density, way
// of life and package, towns and polities, the totals and the per-cell dates — to show that a refactor leaves a model's
// runs byte-identical (plans/CIV_PLAN.md §9.7, C0). It also warns of a constant CIV names twice.
//
//   node --max-old-space-size=8000 v2/tools/civ-fingerprint.mjs [--seeds 1,6,13] [--set key=value,…] [--end bp]
//   … --world <file.bin> [--civ cells]   a world kept by civgpu-profile.mjs (a finish with its civ fields), lived on at
//                                        `cells` (taken down as the page takes it) or at its own (default)
//   … --travel                           the page's travel queries after the run (paddle and sail, two months), hashed in
//   … --key <finish key>                 a cached page finish's own civ world (tools/lib/finish-cache.mjs), its winds included
//   … --cpu                              the famine's years on the CPU (the float64 reference); default the GPU, as the page
//   … --check                            (GPU) each step's years on the CPU too: their per-cell differences, printed
// (--world and --key are frozen inputs: they don't follow the world code's hash, so a fingerprint taken before a change
// compares with one after it however the history or finish code moved)

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import crypto from 'node:crypto';
import { OUT, worldCode } from './lib/civ-world.mjs';
import { meshFromArrays } from '../js/core/sim-mesh.js';
import { civSubstrate } from '../js/civ/substrate.js';
import { runCivSim } from '../js/civ/sim.js';
import { climateVariability } from '../js/civ/climate-var.js';
import { travelGraph, travelDays, Craft } from '../js/civ/routes.js';
import { CIV } from '../js/civ/civ-config.js';
import { civEngine, yearsCheckLine } from './lib/civ-engine.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const set = arg('--set', ''), C = { ...CIV, ...(set ? Object.fromEntries(set.split(/,(?=[A-Za-z_]+=)/).map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), JSON.parse(kv.slice(i + 1))]; })) : {}) };
// (a constant named twice in CIV is silently the second: say so — a new one once took the towns' fieldShare)
const cfg = fs.readFileSync(new URL('../js/civ/civ-config.js', import.meta.url), 'utf8').split('export const CIV_PRIORS')[0];
const names = [...cfg.matchAll(/^    ([A-Za-z]\w*):/gm)].map(m => m[1]), twice = names.filter((k, i) => names.indexOf(k) !== i);
if (twice.length) console.log(`CIV names these twice (the second wins): ${[...new Set(twice)].join(', ')}`);
const END = Number(arg('--end', 0)), TRAVEL = process.argv.includes('--travel');
/** The worlds asked for: [label, world]. */
async function* worlds() {
    if (arg('--world', null)) { const { worldOfFile } = await import('./lib/civ-frozen-world.mjs'); const f = arg('--world'); yield [`${path.basename(f)}@${arg('--civ', 'own')}`, worldOfFile(f, Number(arg('--civ', 0)) || null)]; return; }
    if (arg('--key', null)) {
        const { loadFinish } = await import('./lib/finish-cache.mjs'), fin = await loadFinish(arg('--key'), { cells: false });
        if (!fin?.civ) { console.log(arg('--key'), 'no cached page finish with civ'); return; }
        yield [arg('--key').slice(0, 8), { ...fin.civ, mesh: meshFromArrays(fin.civ.mesh) }];
        return;
    }
    const cache = path.join(OUT, 'cache'), files = fs.readdirSync(cache);
    for (const seed of arg('--seeds', '1,6,13').split(',')) {
        const f = files.find(x => x.startsWith(`page-${seed}-`) && x.endsWith(`160k-${worldCode()}.bin`));
        if (!f) { console.log(seed, 'no cached world: run civ-ensemble.mjs first'); continue; }
        const w = v8.deserialize(fs.readFileSync(path.join(cache, f)));
        w.mesh = meshFromArrays(w.mesh);
        yield [seed, w];
    }
}
const E = await civEngine();
for await (const [seed, w] of worlds()) {
    // (timed by stage: the substrate, the climate ensemble's variability, the run — with --travel, the travel queries a
    // page makes after it, their days hashed in too)
    const ms = {}, tick = (k, f) => { const t = performance.now(), x = f(); ms[k] = Math.round(performance.now() - t); return x; };
    const t0 = Date.now(), sub = tick('substrate', () => civSubstrate(w, C)), vary = tick('variability', () => climateVariability(w, sub, C));
    let t1 = performance.now();
    const r = await runCivSim(w, sub, { C, endBP: END, vary, gpu: E.gpu, yearsCheck: E.yearsCheck });
    ms.run = Math.round(performance.now() - t1);
    const h = crypto.createHash('sha1'), add = a => h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    for (const fr of r.frames) {
        add(fr.density); add(fr.life); add(fr.farmPkg);
        h.update(JSON.stringify([fr.bp, fr.people, fr.farmers, fr.polities]));
        if (fr.towns) add(fr.towns);
        if (fr.polityTable) h.update(JSON.stringify(fr.polityTable, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
    }
    add(r.arrivalBP); add(r.farmBP); add(r.onsetBP);
    h.update(JSON.stringify([r.centres, r.totals, r.voyagingBP]));
    if (TRAVEL) for (const craft of [Craft.PADDLE, Craft.SAIL]) for (const m of [0, 6]) add(tick(`travel${craft}m${m}`, () => travelDays(w.mesh, travelGraph(w, sub, craft, C), r.origins[0], m)));
    console.log(seed, h.digest('hex').slice(0, 16), `${((Date.now() - t0) / 1000).toFixed(0)} s`, JSON.stringify(ms), E.label);
    if (r.yearsCheck) console.log(' ', yearsCheckLine(r.yearsCheck));
}
