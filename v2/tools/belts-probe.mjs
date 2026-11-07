// The India collision, step by step (lane belts, Phase A): when the cores meet, how fast the seam closes after, what
// India's speed does, what welds the pair (stalled / stacked) and how much shortening it took by then — under config
// overrides, for same-frame A/Bs of the speed caps, the collision's resistance and the weld rules.
// Usage: node v2/tools/belts-probe.mjs [--seeds 12345,1,2] [--myr 200] [--set '{"maxSpeedContinental":20}'] [--label x] [--series]
// Prints one JSON line per seed (and, with --series, the per-step series).

import { labMesh } from './lib/check-kit.mjs';
import { FORCE_SCENES } from '../js/tectonics/scenarios/force-scenes.js';
import { simulate } from '../js/tectonics/simulate.js';
import { updatePlateMotion } from '../js/tectonics/step/torque-balance.js';
import { NO_WINGS } from '../js/app/phases/phase5-collisions.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { CM_PER_YR_TO_RAD_PER_MYR } from '../js/tectonics/config.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const seeds = arg('--seeds', '12345,1,2').split(',').map(Number), untilMyr = +arg('--myr', 200);
const set = JSON.parse(arg('--set', '{}')), label = arg('--label', 'base'), series = process.argv.includes('--series');
const mesh = labMesh();

for (const seed of seeds) {
    const world = FORCE_SCENES.find(s => s.id === 'india').build(mesh, seed);
    Object.assign(world.config, NO_WINGS, set);
    const india = world.plates.find(p => p.name === 'India'), asia = world.plates.find(p => p.name === 'Asia');
    const rows = [];
    const speed = p => p?.alive === false ? null : Math.hypot(...(p.omega ?? [0, 0, 0])) / CM_PER_YR_TO_RAD_PER_MYR;
    simulate(world, { untilMyr, drive: updatePlateMotion, snapshotEveryMyr: 1, events: true, stopAt: w => {
        const rec = [...w.collisions.values()].find(c => [c.upper, c.lower].includes(india.id) && [c.upper, c.lower].includes(asia.id));
        rows.push({ t: w.time, vI: speed(india), vA: speed(asia), closing: rec?.closingCmYr ?? null, km: rec?.shorteningKm ?? null,
            front: rec?.frontKm ?? null, stalled: rec?.stalledMyr ?? null, started: rec?.startedAt ?? null, sutured: !!rec?.sutured });
        return false;
    } });
    const weld = world.events.find(e => e.kind === EventKind.SUTURE && [e.data?.upper, e.data?.lower].includes(india.id));
    const first = rows.find(r => r.km != null), contact = first?.started ?? null;
    const pre = rows.filter(r => contact != null && r.t <= contact && r.t > contact - 10).map(r => r.vI);
    const after = dt => rows.find(r => contact != null && r.t >= contact + dt && r.closing != null);
    const out = { label, seed, contact, weldAt: weld ? +(contact + weld.data.afterMyr).toFixed(1) : null, why: weld?.data?.why ?? null,
        shorteningKm: weld ? Math.round(weld.data.shorteningKm) : Math.round(rows.filter(r => r.km != null).at(-1)?.km ?? 0),
        frontKm: weld ? Math.round(weld.data.frontKm) : null,
        vIndiaPeak: +Math.max(...rows.map(r => r.vI ?? 0)).toFixed(2), vIndiaPreContact: pre.length ? +(pre.reduce((a, b) => a + b, 0) / pre.length).toFixed(2) : null,
        closingAt: Object.fromEntries([0, 5, 10, 20, 30, 40, 50].map(dt => [dt, after(dt) ? +after(dt).closing.toFixed(2) : null])) };
    console.log(JSON.stringify(out));
    if (series) for (const r of rows.filter((r, i) => i % 2 === 0)) console.log(JSON.stringify({ seed, ...r }));
}
