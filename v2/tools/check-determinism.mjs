// Is the history deterministic? (determinism lane, 2026-11-09.) Every "flag-off is path-neutral" merge rests on the same
// settings giving the same history, so this builds one short history in two separate processes (the page's: scene 'cycle',
// cache off — determinism-probe.mjs) and compares every field of every frame by VALUE (lib/frame-hash.mjs). A failure names
// the first time and the fields where the two runs part: look there for an order that depends on timing (results taken in
// arrival order, a sort with ties under an unstable comparator, state shared through the disk or a module between runs).
// A history must not depend on what ran before it in its thread: the third check builds the lab's 'rift' scene alone, and
// again after 10 Myr of the 'history' scene in one process (scene-determinism-probe.mjs). Until histdet (2026-11-23) the
// rivers' and the climate sample's scratch were shared by every world on one mesh, and the mask's groundKm — written only
// where the water inventory is poured — was read back by the next, unpoured world: a single-mechanism scene (waterInventory
// 0) took the last poured history's ground for its own (its climate parted at its first frame). The history cache skips
// the scenes it holds, so which ran first, and so the history a suite saw, hung on which entries other suites had built.
// The last check pins why frame FILES are not compared: V8 serializes one value two ways.
// Usage: node v2/tools/check-determinism.mjs   (~10 s)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';
import { check, section, finish } from './lib/check-kit.mjs';
import { frameHash } from './lib/frame-hash.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), probe = path.join(here, 'determinism-probe.mjs'), sceneProbe = path.join(here, 'scene-determinism-probe.mjs');
const SEED = 12345, CELLS = 10000, MYR = 300;   // (long enough for the first rifts, plumes and collisions; coarse to be cheap)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'det-'));
const runOnce = (i, args = ['--seed', SEED, '--sim', CELLS, '--until', MYR], script = probe) => new Promise((resolve, reject) => {
    const out = path.join(dir, `run${i}.jsonl`);
    const child = spawn(process.execPath, [script, ...args, '--out', out].map(String), { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, GEO_SIM_HISTORY_CACHE: '0' } });
    child.on('exit', code => code === 0 ? resolve(fs.readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l))) : reject(new Error(`probe run ${i} exited ${code}`)));
});

section(`the same history twice, in two processes (seed ${SEED}, ${CELLS} cells, ${MYR} Myr)`);
const AFTER = ['--before', 'history', '--before-myr', 10];   // (a poured history's first river step and climate sample)
const [a, b, r0, r1] = await Promise.all([runOnce(0), runOnce(1),
    runOnce(2, ['--scene', 'rift'], sceneProbe), runOnce(3, ['--scene', 'rift', ...AFTER], sceneProbe)]);
fs.rmSync(dir, { recursive: true, force: true });
/** Two runs' frames compared: { same, detail } — the frame count, the finals, and where they first part (time, fields). */
function compare(a, b) {
    const fa = a.filter(r => r.fields), fb = b.filter(r => r.fields), i = fa.findIndex((r, k) => r.all !== fb[k]?.all);
    const parted = i < 0 ? '' : `first parted at ${fa[i].time} Myr in ${Object.keys(fa[i].fields).filter(k => fa[i].fields[k] !== fb[i]?.fields[k]).join(', ')}`;
    return { same: i < 0 && fa.length === fb.length && fa.length > 0, detail: `${fa.length} frames; final ${a.at(-1).final} vs ${b.at(-1).final}${parted ? `; ${parted}` : ''}` };
}
const twice = compare(a, b), after = compare(r0, r1);
check('the two runs\' frames are identical, field by field', twice.same, twice.detail);
section('a history does not depend on what ran before it in its thread (the lab\'s rift scene, alone and after 10 Myr of \'history\')');
check('the rift scene\'s frames are identical, field by field', after.same, after.detail);

section('frames are compared by value, not by their files\' bytes');
// one value, two representations: a field that once held a double is written as a double ('N'), else as an int32 ('I')
const asInt = { x: 3 }, asDouble = { x: 0.5 }; asDouble.x = 3;
const bytesDiffer = !v8.serialize(asInt).equals(v8.serialize(asDouble));
check('the same value hashes alike however V8 holds it', frameHash(asInt) === frameHash(asDouble),
    `v8.serialize bytes ${bytesDiffer ? 'differ' : 'agree'} for { x: 3 } held as int and as double — why shasum of a frame file is no proof of a history`);
finish('Determinism');
