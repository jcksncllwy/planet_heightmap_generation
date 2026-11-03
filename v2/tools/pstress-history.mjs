// The force-scale and rift-stage lane's history measure (pstress): the page's history for a seed, with config overrides, and
// what it does — plate speeds, plate count, trenches born, rifts and their causes, ocean splits — every 10 Myr, as one JSON
// line per seed. With --probe, also the force balance's linearity: at each probe time the rotations every plate would take are
// solved twice from the same state, once as configured and once with every force and resistance × --scale (drag through
// mobility ÷ scale); a balance linear in them gives the same rotations, to rounding.
//   sim-slots run -n 1 --gb 3 --who pstress -- node v2/tools/pstress-history.mjs --seeds 831576,12345,626225 --len 600 [--set ridgePush=0.25] [--tag x] [--probe 100,300,500]
import fs from 'node:fs';
import path from 'node:path';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { pageWorld } from './lib/moment-frame.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { updatePlateMotion } from '../js/tectonics/step/torque-balance.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { CrustType, OrogenyType } from '../js/tectonics/model/crust.js';
import { riftStressContext } from '../js/tectonics/field/rift-stress.js';

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const seeds = arg('--seeds', '831576').split(',').map(Number), len = Number(arg('--len', 600)), tag = arg('--tag', 'base');
const set = arg('--set', ''), overrides = set ? Object.fromEntries(set.split(',').map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; })) : {};
const probe = arg('--probe', '') ? arg('--probe', '').split(',').map(Number) : [], scale = Number(arg('--scale', 0.2));
const out = arg('--out', path.join(process.env.HOME, '.cache/geo-sim/lanes-2026-10-29/pstress/history.jsonl'));
const sim = Number(arg('--sim', 40000)), cont = Number(arg('--cont', 30));
// (every constant in the history's force unit: the forces, the resistances, and the strengths and floors stresses are held
// against. mobility divides the drag, so it goes the other way; riftHingeLock is already ÷ mobility)
export const FORCE_KEYS = ['slabPull', 'slabSuction', 'ridgePush', 'riftPush', 'mantleOutflow', 'mantleInflow', 'dispersalRepulsion',
    'slabResistance', 'collisionResistance', 'founderStrength', 'riftStressFloor'];
const CM_YR = 6371 / 10;
const SWEEP = [2e12, 3e12, 5e12, 1e13, 2e13];       // declared continental strengths, N/m
setDelaunator(Delaunator);

for (const seed of seeds) {
    const t0 = performance.now(), { scene, world } = pageWorld({ seed, cont, sim });
    for (const k of Object.keys(overrides)) if (!(k in world.config)) throw new Error(`unknown config key ${k}`);
    Object.assign(world.config, overrides);
    const { mesh } = world, { xyz, numCells, cellAreaKm2 } = mesh, series = [], probes = [];
    const onFrame = f => {
        if (f.time === 0 || Math.abs(f.time / 10 - Math.round(f.time / 10)) > 1e-9) return;
        let s2 = 0, a = 0, l2 = 0, la = 0;
        for (let w = 0; w < numCells; w++) {
            const o = world.owner[w], P = o >= 0 ? world.plates[o] : null;
            if (!P || P.isBackground) continue;
            const W = P.omega, x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2];
            const v2 = (W[1] * z - W[2] * y) ** 2 + (W[2] * x - W[0] * z) ** 2 + (W[0] * y - W[1] * x) ** 2;
            s2 += v2; a++;
            if (P.crust.type[world.ownerCell[w]] !== CrustType.OCEAN) { l2 += v2; la++; }
        }
        // the continents' deformation as phase 13 counts it (a belt or a rift worked within 240 Myr; RIFT = extension), and land
        let cont = 0, def = 0, ext = 0;
        for (let w = 0; w < numCells; w++) {
            const o = world.owner[w]; if (o < 0) continue;
            const cr = world.plates[o].crust, c = world.ownerCell[w];
            if (cr.type[c] === CrustType.OCEAN || cr.type[c] === CrustType.ARC) continue;
            cont++;
            if (cr.oroType[c] && f.time - cr.oroLast[c] < 240) { def++; if (cr.oroType[c] === OrogenyType.RIFT) ext++; }
        }
        // (with the stress field on: the share of the continents that would break, undamaged, at each declared strength — the
        // plate force paradox's finding: which strength makes how much break; tension, and compression at plateYieldCompression ×)
        let sweep = null;
        if (world.plateStress && Math.abs(world.plateStress.at - f.time) < 1e-6) {
            const S = world.plateStress, ten = SWEEP.map(() => 0), com = SWEEP.map(() => 0);
            let nl = 0;
            for (let w = 0; w < numCells; w++) {
                const o = world.owner[w], k = S.simTo[w];
                if (o < 0 || S.own[k] !== o || !S.active[k] || !(S.s1[k] === S.s1[k])) continue;
                const t = world.plates[o].crust.type[world.ownerCell[w]];
                if (t !== CrustType.CONTINENT && t !== CrustType.CRATON) continue;
                nl++;
                const m = t === CrustType.CRATON ? world.config.cratonStrength : 1;
                SWEEP.forEach((x, i) => { if (S.s1[k] > x * m) ten[i]++; else if (-S.s2[k] > world.config.plateYieldCompression * x * m) com[i]++; });
            }
            sweep = { ten: ten.map(v => +(v / Math.max(1, nl)).toFixed(4)), com: com.map(v => +(v / Math.max(1, nl)).toFixed(4)) };
        }
        series.push({ t: Math.round(f.time), cont: +(cont / numCells).toFixed(4), def: +(def / Math.max(1, cont)).toFixed(4), ext: +(ext / Math.max(1, cont)).toFixed(4), sweep, rms: +(Math.sqrt(s2 / a) * CM_YR).toFixed(3), land: +(Math.sqrt(l2 / Math.max(1, la)) * CM_YR).toFixed(3),
            plates: world.plates.filter(p => p.alive && !p.isBackground).length });
        if (probe.includes(Math.round(f.time))) probes.push({ t: Math.round(f.time), ...linearity(world) });
    };
    // each rift's line against its plate's stress at the time: the percentile, among the plate's land, of the line's mean
    // tension (s1) and of its tension over strength (0.5 = chance; the stress-field study found 0.50 on today's rule)
    const riftLines = [];
    world.onRiftPath = (W, plate, path) => {
        const st = riftStressContext(W, plate);
        if (!st) return;
        const land = [], ratio = [];
        for (let c = 0; c < st.s1.length; c++) if (plate.crust.mask[c] && plate.crust.type[c] !== CrustType.OCEAN && st.s1[c] === st.s1[c]) { land.push(st.s1[c]); ratio.push(st.s1[c] / st.strength[c]); }
        const on = path.filter(c => st.s1[c] === st.s1[c]);
        if (!on.length || !land.length) return;
        const m = on.reduce((a, c) => a + st.s1[c], 0) / on.length, mr = on.reduce((a, c) => a + st.s1[c] / st.strength[c], 0) / on.length;
        riftLines.push({ t: Math.round(W.time), pct: +(land.filter(v => v < m).length / land.length).toFixed(3), pctRatio: +(ratio.filter(v => v < mr).length / ratio.length).toFixed(3), s1: +m.toExponential(2) });
    };
    const run = simulate(world, { untilMyr: len, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame });
    const ev = world.events, count = k => ev.filter(e => e.kind === k).length;
    const rifts = ev.filter(e => e.kind === EventKind.RIFT);
    const row = { tag, seed, len, sim, set: overrides, s: +((performance.now() - t0) / 1000).toFixed(1), steps: run.steps,
        founders: count(EventKind.SUBDUCTION_INIT), rifts: rifts.length, riftCauses: tally(rifts.map(e => e.data.cause)),
        riftTimes: rifts.map(e => Math.round(e.time)), oceanSplits: count(EventKind.OCEAN_SPLIT), sutures: count(EventKind.SUTURE),
        stress: stressSummary(world.stressLog), sweep: sweepMean(series.filter(x => x.t >= 100 && x.sweep)), riftLines, stages: world.riftStages?.length ?? null,
        ext300: mean(series.filter(x => x.t >= 300).map(x => x.ext)), def300: mean(series.filter(x => x.t >= 300).map(x => x.def)), contMean: mean(series.map(x => x.cont)),
        rmsMean: mean(series.map(x => x.rms)), landMean: mean(series.map(x => x.land)), platesMean: mean(series.map(x => x.plates)), probes, series };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.appendFileSync(out, JSON.stringify(row) + '\n');
    console.log(JSON.stringify({ ...row, series: undefined, riftTimes: undefined }));
}

/** The rotations solved as configured and with every force-unit constant × scale, from the same state. */
function linearity(world) {
    const { plates, config } = world, saved = plates.map(p => p.omega.slice()), keep = { loads: world.loads, dyn: plates.map(p => p.dynamics) };
    const solve = cfg => { plates.forEach((p, i) => { p.omega = saved[i].slice(); }); const old = world.config; world.config = cfg; try { updatePlateMotion(world); } finally { world.config = old; } return plates.map(p => p.omega.slice()); };
    const scaled = { ...config, mobility: config.mobility / scale };
    for (const k of FORCE_KEYS) scaled[k] = config[k] * scale;
    const B = solve(scaled), A = solve(config);
    plates.forEach((p, i) => { p.omega = saved[i]; p.dynamics = keep.dyn[i]; });
    world.loads = keep.loads;
    let worst = 0, n = 0;
    for (let i = 0; i < plates.length; i++) {
        if (!plates[i].alive || plates[i].isBackground) continue;
        const a = Math.hypot(...A[i]), d = Math.hypot(A[i][0] - B[i][0], A[i][1] - B[i][1], A[i][2] - B[i][2]);
        if (a > 1e-12) { worst = Math.max(worst, d / a); n++; }
    }
    return { plates: n, worstRel: +worst.toExponential(2) };
}

/** The stress step's log (field/stress-step.js), summed: solves, cost, convergence, the shares breaking. */
function stressSummary(log) {
    if (!log?.length) return null;
    const m = k => mean(log.map(x => x[k])), from = log.filter(x => x.time >= 100);
    return { solves: log.length, ms: Math.round(log.reduce((a, x) => a + x.ms, 0)), it: m('iterations'), maxIt: Math.max(...log.map(x => x.iterations)), worstRel: Math.max(...log.map(x => x.rel)),
        imbalance: m('imbalance'), dropped: m('dropped'), tension: mean(from.map(x => x.tension)), compression: mean(from.map(x => x.compression)),
        landTension: mean(from.map(x => x.landTension)), landCompression: mean(from.map(x => x.landCompression)), damage: mean(from.map(x => x.damage)),
        tII: [0, 1, 2].map(i => +mean(from.map(x => x.tII[i])).toExponential(2)) };
}
function sweepMean(rows) {
    if (!rows.length) return null;
    return Object.fromEntries(SWEEP.map((x, i) => [x.toExponential(0), { ten: mean(rows.map(r => r.sweep.ten[i])), com: mean(rows.map(r => r.sweep.com[i])) }]));
}
function tally(xs) { const o = {}; for (const x of xs) o[x] = (o[x] ?? 0) + 1; return o; }
function mean(xs) { return xs.length ? +(xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(4) : NaN; }
