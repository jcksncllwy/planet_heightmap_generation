// Every continental weld of a seeded history (lane belts, Phase A): how long after contact, how much shortening, how
// deep the overlap, and what welded it (stalled / stacked), under config overrides — the history-scale view of the
// collision seam the India scene probes (tools/belts-probe.mjs).
// Usage: node v2/tools/belts-history.mjs [--seeds 12345] [--myr 600] [--set '{…}' | --kv a=1,b=true] [--label x]
// (--kv: the overrides without quotes, for Chroma's ssh hop; `biggest`: the five welds with the most convergence after contact)

import { labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { BUDGET_SCENES } from '../js/tectonics/scenarios/budget-scenes.js';
import { buildStartWorld } from '../js/tectonics/init/start-world.js';
import { EventKind } from '../js/tectonics/model/world.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const seeds = arg('--seeds', '12345').split(',').map(Number), untilMyr = +arg('--myr', 600);
const kv = Object.fromEntries((arg('--kv', '') || '').split(',').filter(Boolean).map(p => { const [k, v] = p.split('='); return [k, JSON.parse(v)]; }));
const set = { ...JSON.parse(arg('--set', '{}')), ...kv }, label = arg('--label', 'base');
const mesh = labMesh();

for (const seed of seeds) {
    const { world } = buildStartWorld(mesh, seed);
    Object.assign(world.config, set);
    const t0 = Date.now();
    simulate(world, { untilMyr, drive: BUDGET_SCENES.find(s => s.id === 'history').drive, snapshotEveryMyr: 50 });
    const welds = world.events.filter(e => e.kind === EventKind.SUTURE && e.data?.frontKm >= world.config.sutureMinContactKm);
    const km = welds.map(e => e.data.shorteningKm).sort((a, b) => a - b), q = p => Math.round(km[Math.floor(p * (km.length - 1))] ?? 0);
    console.log(JSON.stringify({ label, seed, secs: Math.round((Date.now() - t0) / 1000), welds: welds.length,
        stacked: welds.filter(e => e.data.why === 'stacked').length,
        shorteningKm: { p50: q(0.5), p90: q(0.9), max: q(1) },
        biggest: [...welds].sort((a, b) => b.data.shorteningKm - a.data.shorteningKm).slice(0, 5).map(e => ({ km: Math.round(e.data.shorteningKm), afterMyr: Math.round(e.data.afterMyr),
            frontKm: Math.round(e.data.frontKm), why: e.data.why, at: Math.round(e.time) })),
        afterMyr: { p50: Math.round(welds.map(e => e.data.afterMyr).sort((a, b) => a - b)[Math.floor(welds.length / 2)] ?? 0) },
        budget: { beltReliefKm3: world.budget?.beltReliefKm3, beltRootKm3: world.budget?.beltRootKm3 } }));
}
