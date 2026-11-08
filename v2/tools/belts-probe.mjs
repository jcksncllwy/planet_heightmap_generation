// The India collision, step by step (lane belts, Phase A): when the cores meet, how fast the seam closes after, what
// India's speed does, what welds the pair (stalled / stacked) and how much shortening it took by then — under config
// overrides, for same-frame A/Bs of the speed caps, the collision's resistance and the weld rules.
// Usage: node v2/tools/belts-probe.mjs [--seeds 12345,1,2] [--myr 200] [--set '{"maxSpeedContinental":20}' | --kv maxSpeedContinental=20] [--label x] [--series] [--full]
// --full: the collision in the whole model's mechanisms (underthrusting on: Phase 7c), not Phase 5's event rules alone (NO_WINGS)
// — lane belts' acceptance (hofud, 2026-11-07): under NO_WINGS nothing consumes the overlap, and the stack weld (sutureStackKm)
// caps the shortening at its geometry whatever the collision's resistance.
// Prints one JSON line per seed (and, with --series, the per-step series; with --forces, each 4 Myr from 10 before contact
// to 60 after, India's and Asia's balance term by term, as forces across the front at its centre in 10¹⁸ N — + presses India
// into Asia or carries Asia away from India, − the reverse; torque-balance.js balanceTerms — and both plates' speeds across
// (vIn, vAn) and along (vIt, vAt) the front there, cm/yr).

import { labMesh } from './lib/check-kit.mjs';
import { FORCE_SCENES } from '../js/tectonics/scenarios/force-scenes.js';
import { simulate } from '../js/tectonics/simulate.js';
import { updatePlateMotion, balanceTerms } from '../js/tectonics/step/torque-balance.js';
import { NO_WINGS } from '../js/app/phases/phase5-collisions.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { CM_PER_YR_TO_RAD_PER_MYR } from '../js/tectonics/config.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const seeds = arg('--seeds', '12345,1,2').split(',').map(Number), untilMyr = +arg('--myr', 200);
// (--kv a=1,b=true: the same overrides without quotes, which a Windows ssh hop strips — sim-slots' Chroma runs)
const kv = Object.fromEntries((arg('--kv', '') || '').split(',').filter(Boolean).map(p => { const [k, v] = p.split('='); return [k, JSON.parse(v)]; }));
const set = { ...JSON.parse(arg('--set', '{}')), ...kv }, label = arg('--label', 'base'), series = process.argv.includes('--series'), full = process.argv.includes('--full'), forces = process.argv.includes('--forces');
const mesh = labMesh();

for (const seed of seeds) {
    const world = FORCE_SCENES.find(s => s.id === 'india').build(mesh, seed);
    Object.assign(world.config, full ? {} : NO_WINGS, set);
    const india = world.plates.find(p => p.name === 'India'), asia = world.plates.find(p => p.name === 'Asia');
    const rows = [], forceRows = [];
    const EN = world.config.forceUnitNPerM * 1e5 / 1e18;                   // a torque in force units × 100 km, at radius 1 → 10¹⁸ N
    // (the front's centre and normal from India's contacts; each term of each plate's balance as a force across the front, toward
    // Asia — + presses India in or carries Asia away — and the two plates' speeds across and along the front there)
    const front = () => { const cs = world.loads?.get(india.id)?.contacts.filter(c => c.other === asia.id); if (!cs?.length) return null;
        const m = v => { const l = Math.hypot(...v); return v.map(x => x / l); }, r = m([0, 1, 2].map(i => cs.reduce((s, c) => s + c.r[i], 0)));
        let n = [0, 1, 2].map(i => cs.reduce((s, c) => s + c.n[i], 0)); const rn = n[0] * r[0] + n[1] * r[1] + n[2] * r[2]; n = m(n.map((x, i) => x - rn * r[i]));
        return { a: [r[1] * n[2] - r[2] * n[1], r[2] * n[0] - r[0] * n[2], r[0] * n[1] - r[1] * n[0]], r, n }; };
    const across = (p, f) => { const b = balanceTerms(world, p); if (!b) return null;
        return Object.fromEntries(Object.entries(b).map(([k, t]) => [k, +((t[0] * f.a[0] + t[1] * f.a[1] + t[2] * f.a[2]) * EN).toFixed(2)]).filter(([, v]) => v !== 0)); };
    const speed = p => p?.alive === false ? null : Math.hypot(...(p.omega ?? [0, 0, 0])) / CM_PER_YR_TO_RAD_PER_MYR;
    const cmyr = (w, x) => +((w[0] * x[0] + w[1] * x[1] + w[2] * x[2]) / CM_PER_YR_TO_RAD_PER_MYR).toFixed(2);
    simulate(world, { untilMyr, drive: updatePlateMotion, snapshotEveryMyr: 1, events: true, stopAt: w => {
        const rec = [...w.collisions.values()].find(c => [c.upper, c.lower].includes(india.id) && [c.upper, c.lower].includes(asia.id));
        rows.push({ t: w.time, vI: speed(india), vA: speed(asia), closing: rec?.closingCmYr ?? null, km: rec?.shorteningKm ?? null,
            front: rec?.frontKm ?? null, stalled: rec?.stalledMyr ?? null, started: rec?.startedAt ?? null, sutured: !!rec?.sutured });
        const f = forces && w.time % 4 < 0.5 ? front() : null;
        if (f) { const t = [f.r[1] * f.a[2] - f.r[2] * f.a[1], f.r[2] * f.a[0] - f.r[0] * f.a[2], f.r[0] * f.a[1] - f.r[1] * f.a[0]];   // r × a: along the front
            forceRows.push({ t: +w.time.toFixed(1), closing: rows.at(-1).closing && +rows.at(-1).closing.toFixed(2), vIn: cmyr(india.omega, f.a), vAn: cmyr(asia.omega, f.a),
                vIt: cmyr(india.omega, t), vAt: cmyr(asia.omega, t), India: across(india, f), Asia: across(asia, f),
                Mkm2: [india, asia].map(p => [p.stats.cells, p.stats.keelCells].map(c => +(c * mesh.cellAreaKm2 / 1e6).toFixed(1))) }); }
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
    if (forces) for (const r of forceRows.filter(r => contact != null && r.t >= contact - 10 && r.t <= contact + 60)) console.log(JSON.stringify({ seed, ...r }));
    if (series) for (const r of rows.filter((r, i) => i % 2 === 0)) console.log(JSON.stringify({ seed, ...r }));
}
