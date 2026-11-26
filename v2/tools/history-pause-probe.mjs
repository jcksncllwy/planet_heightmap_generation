// A history paused and resumed (the Evolution page's Pause, app/history-hold.js) against the same history unpaused, through
// the page's own runner and worker (app/history-runner.js → history-worker.js, run in this thread: lib/same-thread-worker.mjs,
// so the pause's messages arrive between the history's steps as on the page). It runs the page's history (scene 'cycle')
// for --until Myr, then runs it on twice (Extend history) to --until + 40 and + 60, and writes each frame's value hash
// (lib/frame-hash.mjs) and each run's end (time, steps, stopped) — check-history-pause.mjs compares two of these.
//   node v2/tools/history-pause-probe.mjs --seed 12345 --sim 10000 --until 200 --out f.jsonl [--pause]
// --pause: paused at the frames after 30, 40 (twice in a row), 120 and 180 Myr of the first run (held 0–250 ms each; at
// 120 Myr held while another history runs in this thread — stricter than the page, where Add detail has its own worker),
// at the first piece's start and in its middle, and that piece ended where it was held (Stop extending while paused).
process.env.GEO_SIM_HISTORY_CACHE = '0';
import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import './gpu-harness/history-dawn.mjs';
import { installSameThreadWorker } from './lib/same-thread-worker.mjs';
import { frameHash } from './lib/frame-hash.mjs';
import { pageWorld, DEFAULT_CONT, MESH_SEED, PAGE_SCENE } from './lib/moment-frame.mjs';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { simulate } from '../js/tectonics/simulate.js';
import { runHistory } from '../js/app/history-runner.js';
import { HistoryHold } from '../js/app/history-hold.js';

setDelaunator(Delaunator);
installSameThreadWorker();
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const seed = Number(arg('--seed', 12345)), sim = Number(arg('--sim', 10000)), until = Number(arg('--until', 200)), out = arg('--out'), pausing = argv.includes('--pause');
const EVERY = 10;                                               // (the page's SNAPSHOT_MYR)
const scene = TERRAIN_SCENES.find(s => s.id === PAGE_SCENE), mesh = buildSimMesh(sim, MESH_SEED);
const lines = [], log = o => lines.push(JSON.stringify(o));
const hold = pausing ? new HistoryHold() : null, holds = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
// (what to do once it is held: how long, and whether another history runs meanwhile)
let onHeld = null;
hold?.on(h => { if (h.paused && onHeld) { const f = onHeld; onHeld = null; holds.push(h.heldAt); f(h); } });
const pauseThen = (then) => { onHeld = then; hold.pause(); };
const PAUSE_AFTER = new Map([[30, 0], [40, 1], [50, 250], [120, 'busy'], [180, 30]]);   // (frame time → hold ms; 50: the second of two in a row)
const onFrame = f => {
    log({ time: f.time, hash: frameHash(f) });
    const what = pausing ? PAUSE_AFTER.get(Math.round(f.time)) : undefined;
    if (what === undefined) return;
    pauseThen(async h => {
        if (what === 'busy') {     // (another history in this thread while this one is held: its steps' scratch, the rock book)
            const other = pageWorld({ seed: seed + 1, sim: 4000 });
            await simulate(other.world, { untilMyr: 30, drive: w => other.scene.drive(w), snapshotEveryMyr: EVERY, keepFrames: false });
        } else await sleep(what);
        h.resume();
    });
};
const t0 = Date.now();
const run = await runHistory({ list: 'terrain', scene, start: { continentalFraction: DEFAULT_CONT / 100 }, lengthMyr: until, keep: true, hold }, mesh, seed, EVERY, () => {}, onFrame);
log({ end: 'first', time: run.time, steps: run.steps, stopped: run.stopped, frames: run.frames.length });
// Extend history: two pieces; paused, the first is held at its start, again in its middle, and ended there
if (pausing) { hold.pause(); await sleep(50); }                  // (asked between the runs: holds at the piece's start)
if (pausing) onHeld = h => { onHeld = null; setTimeout(() => { pauseAt = until + 20; h.resume(); }, 20); };
let pauseAt = null;
const piece1 = run.more(until + 40);
const watch = pausing ? (async () => { while (pauseAt === null || (run.frames.at(-1)?.time ?? 0) < pauseAt - 1e-6) await sleep(5); pauseThen(h => h.end()); })() : null;
const r1 = await piece1;
log({ end: 'piece1', time: r1.time, steps: r1.steps });
const r2 = await run.more(until + 60);
log({ end: 'piece2', time: r2.time, steps: r2.steps });
run.close();
await watch?.catch(() => {});
log({ summary: true, seed, sim, until, holds, s: (Date.now() - t0) / 1000 });
fs.writeFileSync(out, lines.join('\n') + '\n');
process.exit(0);
