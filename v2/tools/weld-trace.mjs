// Every continental collision of a seeded history, step by step (lane weld): the closing rate after contact, the stall
// clock, the seam's sea and what a weld would seal — and, each step of the tail, which of the weld's conditions
// (step/collision.js) is the one still unmet. Why a pair that stopped closing ~50 Myr after contact sits unwelded.
// Usage: node v2/tools/weld-trace.mjs [--seeds 12345] [--myr 600] [--kv a=1,b=true] [--label x] [--top 5] [--series]
// Prints one JSON line per seed: the top welds by shortening (km at 50 Myr, total, contact → end of convergence → weld,
// and the Myr each condition blocked the weld after convergence ended); --series adds each top weld's per-step rows.
// (End of convergence: the step after which the pair closes less than 5 % of its final shortening — Earth's "convergence
// ended" for the Urals and the Alleghanides is when the shortening stops, read the same way off the structural record.)

import { labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { BUDGET_SCENES } from '../js/tectonics/scenarios/budget-scenes.js';
import { buildStartWorld } from '../js/tectonics/init/start-world.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { onPath } from './lib/paths.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const seeds = arg('--seeds', '12345').split(',').map(Number), untilMyr = +arg('--myr', 600), top = +arg('--top', 5);
const kv = Object.fromEntries((arg('--kv', '') || '').split(',').filter(Boolean).map(p => { const [k, v] = p.split('='); return [k, JSON.parse(v)]; }));
const label = arg('--label', 'base'), wantSeries = process.argv.includes('--series');
const mesh = labMesh();

for (const seed of seeds) {
    const { world } = buildStartWorld(mesh, seed);
    onPath(world);
    Object.assign(world.config, kv);
    const C = world.config, { cellAreaKm2, edgeKm } = mesh;
    // (rows keyed by the record itself: a weld hands a collision on to the merged plate — inheritCollisions renames its upper or
    // lower — so a key of plate ids and start would begin a new series mid-collision with all its km already in it)
    // (and the records are copied from step to step, so each carries a trace id, which the copies keep)
    const series = new Map();                                     // collision record's trace id → rows
    let traceIds = 0;
    const t0 = Date.now();
    simulate(world, { untilMyr, drive: BUDGET_SCENES.find(s => s.id === 'history').drive, snapshotEveryMyr: C.stepGridMyr, keepFrames: false, stopAt: w => {
        for (const r of w.collisions?.values() ?? []) {
            r.traceId ??= ++traceIds;
            const k = r.traceId;
            const rows = series.get(k) ?? series.set(k, []).get(k);
            if (rows.length && rows[rows.length - 1].sutured) continue;
            const depthKm = r.cells * cellAreaKm2 / Math.max(r.frontKm, edgeKm);
            const ready = r.stalledMyr >= C.sutureStallMyr, deep = Math.max(r.shorteningKm, depthKm) >= C.sutureStallMinKm;
            const front = (r.frontMaxKm ?? 0) >= C.sutureMinContactKm;
            const narrow = (r.gapWidestKm ?? Infinity) <= C.sutureGapWidthKm, giveUp = r.stalledMyr >= C.sutureStallGiveUpMyr;
            const gapStall = w.time - (r.gapShrankAt ?? w.time) >= C.sutureGapStallMyr;
            const sealing = r.trapKm2 > 0 && r.trapClosingCmYr > C.sutureStallCmYr;
            // the first unmet condition, in the order collision.js asks them
            const block = r.sutured ? 'welded' : r.lastActive !== w.time ? 'no-contact' : !front ? 'front' : !ready ? (r.closingCmYr >= C.sutureStallCmYr ? 'creep' : 'stall-clock')
                : !deep ? 'minKm' : !(narrow || giveUp || gapStall) ? 'gap' : sealing ? 'sealing' : 'other';
            rows.push({ t: w.time, up: r.upper, lo: r.lower, t0: r.startedAt, after: w.time - r.startedAt, cm: +r.closingCmYr.toFixed(2), km: Math.round(r.shorteningKm), stall: r.stalledMyr, depth: Math.round(depthKm),
                front: Math.round(r.frontKm), gapW: r.gapWidestKm == null ? null : Math.round(r.gapWidestKm), gapAgo: r.gapShrankAt == null ? null : w.time - r.gapShrankAt,
                trap: r.trapKm2 == null ? null : Math.round(r.trapKm2), trapCm: r.trapClosingCmYr == null ? null : +r.trapClosingCmYr.toFixed(2), block, sutured: r.sutured });
        }
        return false; } });
    const welds = world.events.filter(e => e.kind === EventKind.SUTURE && e.data?.frontKm >= C.sutureMinContactKm);
    const summarize = e => {
        // (its record: the one with this pair and start — the weld may fall between snapshots, and the merge drop the record)
        const rows = [...series.values()].find(rs => { const z = rs.at(-1); return z.up === e.data.upper && z.lo === e.data.lower && Math.abs(z.t0 - (e.time - e.data.afterMyr)) < 1e-3; }) ?? [];
        const total = e.data.shorteningKm, at50 = rows.find(r => r.after >= 50)?.km ?? total;
        const endRow = rows.find(r => r.km >= 0.95 * total), endAfter = endRow?.after ?? e.data.afterMyr;
        // (and the last step it still closed at the stall rate or faster: after this, the stall clock never reset)
        const lastCreep = rows.findLast(r => !r.sutured && r.cm >= C.sutureStallCmYr)?.after ?? null;
        const blocks = {};
        for (const r of rows) if (r.after > endAfter && r.block !== 'welded') blocks[r.block] = (blocks[r.block] ?? 0) + C.stepGridMyr;
        // the creep in the tail: the closing rate's spread after convergence ended
        const tail = rows.filter(r => r.after > endAfter && r.block !== 'no-contact').map(r => r.cm).sort((a, b) => a - b);
        const q = p => tail.length ? tail[Math.floor(p * (tail.length - 1))] : null;
        const resets = rows.filter((r, i) => i && r.after > endAfter && r.stall === 0 && rows[i - 1].stall > 0).length;
        return { at: Math.round(e.time), km: Math.round(total), km50: at50, endMyr: endAfter, lastCreepMyr: lastCreep, weldMyr: Math.round(e.data.afterMyr), why: e.data.why, frontKm: Math.round(e.data.frontKm),
            tailCm: { p10: q(0.1), p50: q(0.5), p90: q(0.9) }, stallResets: resets, blocks, ...(wantSeries ? { rows } : {}) };
    };
    const biggest = [...welds].sort((a, b) => b.data.shorteningKm - a.data.shorteningKm).slice(0, top).map(summarize);
    // (pairs still colliding at the end: how long since contact, how far, and what holds them)
    const open = [...world.collisions.values()].filter(r => !r.sutured && (r.frontMaxKm ?? 0) >= C.sutureMinContactKm)
        .map(r => { const rows = series.get(r.traceId) ?? []; return { since: Math.round(world.time - r.startedAt), km: Math.round(r.shorteningKm), cm: +r.closingCmYr.toFixed(2), block: rows.at(-1)?.block }; });
    console.log(JSON.stringify({ label, seed, secs: Math.round((Date.now() - t0) / 1000), welds: welds.length, totalKmMax: biggest[0]?.km ?? 0, biggest, open }));
}
