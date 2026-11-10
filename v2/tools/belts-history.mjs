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
import { onPath } from './lib/paths.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const seeds = arg('--seeds', '12345').split(',').map(Number), untilMyr = +arg('--myr', 600);
const kv = Object.fromEntries((arg('--kv', '') || '').split(',').filter(Boolean).map(p => { const [k, v] = p.split('='); return [k, JSON.parse(v)]; }));
const set = { ...JSON.parse(arg('--set', '{}')), ...kv }, label = arg('--label', 'base');
const mesh = labMesh();

for (const seed of seeds) {
    const { world } = buildStartWorld(mesh, seed);
    onPath(world);                                                      // (GEO_SIM_PATH=k: a no-physics nudge onto another path, lib/paths.mjs)
    Object.assign(world.config, set);
    const t0 = Date.now();
    // (each collision's convergence 50 Myr after contact — India's ~2,000–2,500 km in its first ~50 Myr, Molnar & Stock 2009 —
    // read at stepGridMyr snapshots, which do not change the history. A record is followed by an id it keeps from step to step,
    // not by its plates: a weld hands a collision on to the merged plate (inheritCollisions renames it, keeping its start and
    // km), and a piece handed to another plate takes a copy (ops/hand-collisions.js) — keyed by plates and start, either
    // would first appear long after contact with all its km in it, as weld-trace.mjs found on 4242: "2933 of 2939 km in 50
    // Myr" was 1479. A weld whose record first appears after contact is `handed`, its km50 not counted.)
    const idOf = new Map(), first = new Map(), at50 = new Map(); let ids = 0;
    simulate(world, { untilMyr, drive: BUDGET_SCENES.find(s => s.id === 'history').drive, snapshotEveryMyr: world.config.stepGridMyr, keepFrames: false, stopAt: w => {
        const seen = new Set();
        for (const c of w.collisions?.values() ?? []) {
            if (c.traceId == null || seen.has(c.traceId)) c.traceId = ++ids;
            seen.add(c.traceId);
            idOf.set(`${c.upper}-${c.lower}-${c.startedAt}`, c.traceId);
            if (!first.has(c.traceId)) first.set(c.traceId, w.time - c.startedAt);
            if (!at50.has(c.traceId) && w.time - c.startedAt >= 50) at50.set(c.traceId, c.shorteningKm);
        }
        return false; } });
    const km50Of = e => { const id = idOf.get(`${e.data.upper}-${e.data.lower}-${e.time - e.data.afterMyr}`), handed = !((first.get(id) ?? Infinity) <= 2 * world.config.stepGridMyr);
        return handed ? { handed } : { km50: Math.round(at50.get(id) ?? e.data.shorteningKm) }; };
    const welds = world.events.filter(e => e.kind === EventKind.SUTURE && e.data?.frontKm >= world.config.sutureMinContactKm);
    const km = welds.map(e => e.data.shorteningKm).sort((a, b) => a - b), q = p => Math.round(km[Math.floor(p * (km.length - 1))] ?? 0);
    console.log(JSON.stringify({ label, seed, secs: Math.round((Date.now() - t0) / 1000), welds: welds.length,
        stacked: welds.filter(e => e.data.why === 'stacked').length,
        shorteningKm: { p50: q(0.5), p90: q(0.9), max: q(1) },
        biggest: [...welds].sort((a, b) => b.data.shorteningKm - a.data.shorteningKm).slice(0, 5).map(e => ({ km: Math.round(e.data.shorteningKm), afterMyr: Math.round(e.data.afterMyr),
            frontKm: Math.round(e.data.frontKm), why: e.data.why, at: Math.round(e.time), ...km50Of(e) })),
        afterMyr: { p50: Math.round(welds.map(e => e.data.afterMyr).sort((a, b) => a - b)[Math.floor(welds.length / 2)] ?? 0) },
        budget: { beltReliefKm3: world.budget?.beltReliefKm3, beltRootKm3: world.budget?.beltRootKm3 } }));
}
