// Pause (the Evolution page's, histpause 2026-11-26: app/history-hold.js): a history paused and resumed — several times,
// twice in a row, while another history runs in its thread, at the start and in the middle of a run on (Extend history),
// and a run on ended where it was held — is the history run unpaused: every frame the same by value (lib/frame-hash.mjs),
// the same steps, the same end. Both runs go through the page's own runner and worker (history-pause-probe.mjs). The
// history-cache key is worked out from the start world before the first step (history-worker.js), so a pause cannot move
// it; the cache entry is the frames on the step grid and the end (time, steps, stopped), compared here.
// The first section holds HistoryHold's own rules (no history: instant).
// Usage: node v2/tools/check-history-pause.mjs   (~30 s; needs a GPU — Dawn — as every history)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, section, finish } from './lib/check-kit.mjs';
import { HistoryHold, runHeld } from '../js/app/history-hold.js';

const here = path.dirname(fileURLToPath(import.meta.url)), probe = path.join(here, 'history-pause-probe.mjs');
const SEED = 12345, CELLS = 10000, MYR = 200;

section('the hold\'s rules (a stand-in history: one frame every 10 Myr, stopAt asked after each)');
{   // (simulate's contract as runHeld uses it: stopAt after each snapshot; resume runs on from world.time)
    const fake = async (world, { untilMyr, stopAt, resume, onFrame }) => {
        const frames = [];
        if (!resume) frames.push(world.time);
        while (world.time < untilMyr - 1e-9) {
            await new Promise(r => setTimeout(r, 1)); world.time += 10; world.step++; frames.push(world.time); onFrame?.(world.time);
            if (stopAt?.(world)) return { frames, steps: world.step, stopped: true };
        }
        return { frames, steps: world.step, stopped: false };
    };
    const plain = await fake({ time: 0, step: 0 }, { untilMyr: 100 });
    const h = new HistoryHold(), seen = [];
    h.on(x => seen.push(x.paused ? `held@${x.heldAt}` : x.wanted ? 'asked' : 'going'));
    const w = { time: 0, step: 0 };
    const p = runHeld(fake, w, { untilMyr: 100, onFrame: t => { if (t === 30) h.pause(); } }, h);
    await new Promise(r => setTimeout(r, 30)); h.resume();
    const r = await p;
    check('paused and resumed: the same frames, steps and end as unpaused', JSON.stringify(r.frames) === JSON.stringify(plain.frames) && r.steps === plain.steps && !r.stopped,
        `${r.frames.join(' ')} · ${seen.join(' → ')}`);
    // (here the ask comes with the frame, before stopAt is asked; on the page it comes a message later: the next frame)
    check('…held at a frame (never inside a step)', seen.includes('held@30'), seen.join(' → '));
    const h2 = new HistoryHold(), w2 = { time: 0, step: 0 };
    const r2 = await runHeld(fake, w2, { untilMyr: 100, onFrame: t => { if (t === 30) { h2.pause(); h2.resume(); } } }, h2);
    check('a pause called off before it takes hold holds nothing', r2.frames.length === plain.frames.length && h2.heldMs === 0 && !h2.paused);
    const h3 = new HistoryHold(), w3 = { time: 100, step: 10 };
    const p3 = runHeld(fake, w3, { untilMyr: 200, resume: true, onFrame: t => { if (t === 130) h3.pause(); } }, h3);
    await new Promise(r => setTimeout(r, 40)); const at = h3.heldAt; h3.end();
    const r3 = await p3, r3b = await runHeld(fake, w3, { untilMyr: 200, resume: true }, h3);
    check('a run on ended where it was held stops at that frame; the next run on goes on from it (no step lost or run twice)', r3.ended && at === 130 && w3.time === 200 && JSON.stringify([...r3.frames, ...r3b.frames]) === JSON.stringify([110, 120, 130, 140, 150, 160, 170, 180, 190, 200]),
        `held at ${at}; ${r3.frames.join(' ')} | ${r3b.frames.join(' ')}`);
    const h4 = new HistoryHold(), w4 = { time: 100, step: 10 };
    h4.pause();
    const r4 = await runHeld(fake, w4, { untilMyr: 200, resume: true }, (setTimeout(() => h4.end(), 20), h4));
    check('a pause asked between two runs on holds the next at its start (Extend history\'s pieces)', r4.ended && r4.frames.length === 0 && w4.time === 100);
    const h5 = new HistoryHold(), w5 = { time: 0, step: 0 };
    h5.pause(); h5.end();                      // (an end asked while pausing — Stop extending while Pausing…)
    const r5 = await runHeld(fake, w5, { untilMyr: 100 }, h5);
    const h6 = new HistoryHold(), w6 = { time: 100, step: 10 };
    h6.pause(); h6.end();
    const r6 = await runHeld(fake, w6, { untilMyr: 200, onFrame: () => {}, resume: true }, h6);
    check('an end asked while pausing ends a run on where the pause takes hold; a first run is never ended (it has a length)', r6.ended && w6.time === 100 && !r5.ended && w5.time === 100 && !h5.wanted && !h6.wanted,
        `run on ended at ${w6.time}; first run went to ${w5.time}`);
}

section(`a history paused and resumed is the history unpaused (the page's runner and worker; seed ${SEED}, ${CELLS} cells, ${MYR} Myr + 2 runs on)`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-'));
const runProbe = (name, extra) => new Promise((resolve, reject) => {
    const out = path.join(dir, `${name}.jsonl`);
    const child = spawn(process.execPath, [probe, '--seed', SEED, '--sim', CELLS, '--until', MYR, '--out', out, ...extra].map(String), { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, GEO_SIM_HISTORY_CACHE: '0' } });
    child.on('exit', code => code === 0 ? resolve(fs.readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l))) : reject(new Error(`probe ${name} exited ${code}`)));
});
const plain = await runProbe('plain', []), paused = await runProbe('paused', ['--pause']);
fs.rmSync(dir, { recursive: true, force: true });
const framesOf = r => r.filter(l => l.hash), endOf = (r, k) => r.find(l => l.end === k), sum = r => r.find(l => l.summary);
const [fa, fb] = [framesOf(plain), framesOf(paused)];
const part = fa.findIndex((f, i) => !fb[i] || f.time !== fb[i].time || f.hash !== fb[i].hash);
check('every frame the same, by value, in the same order', fa.length === fb.length && part < 0,
    `${fa.length} frames vs ${fb.length}` + (part >= 0 ? `; first parting at ${fa[part].time} Myr` : `; last ${fa.at(-1)?.time} Myr ${fa.at(-1)?.hash}`));
const [e1, e2, g1, g2] = [endOf(plain, 'first'), endOf(paused, 'first'), endOf(plain, 'piece2'), endOf(paused, 'piece2')];
check('the same end: the first run and the last run on (time, steps, stopped)', e1.time === e2.time && e1.steps === e2.steps && e1.stopped === e2.stopped && g1.time === g2.time && g1.steps === g2.steps,
    `first ${e2.time} Myr ${e2.steps} steps · last ${g2.time} Myr ${g2.steps} steps`);
const holds = sum(paused).holds, p1 = endOf(paused, 'piece1');
check('…through the holds asked: in the first run, at a run on\'s start, and in its middle (ended there)', holds.filter(t => t < MYR).length >= 4 && holds.includes(MYR) && p1.time < MYR + 40 && p1.time > MYR,
    `held at ${holds.join(', ')} Myr; the first run on ended at ${p1.time} (unpaused: ${endOf(plain, 'piece1').time})`);
console.log(`  (unpaused ${sum(plain).s.toFixed(1)} s, paused ${sum(paused).s.toFixed(1)} s)`);
finish('history pause');
