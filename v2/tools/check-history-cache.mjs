// Headless checks of the history cache (tools/lib/history-cache.mjs): software contracts, not physics — every line is
// hard. A frame read back is the frame built, to the bit; the key changes with the history's code and its settings, and
// with nothing else; writers running at once never spoil an entry, and one process builds a history while the others
// wait for it; a damaged file is found, deleted and built again. In a cache of its own (a temporary folder), so it never
// touches the machine's.
// Usage: node v2/tools/check-history-cache.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-sim-cache-check-'));
process.env.GEO_SIM_HISTORY_CACHE_DIR = path.join(TMP, 'histories');
process.env.GEO_SIM_HISTORY_LOG = path.join(TMP, 'log.jsonl');
delete process.env.GEO_SIM_HISTORY_CACHE;

const here = path.dirname(fileURLToPath(import.meta.url));
const { check, report, section, finish, labMesh } = await import('./lib/check-kit.mjs');
const HC = await import('./lib/history-cache.mjs');
const { TERRAIN_SCENES } = await import('../js/tectonics/scenarios/terrain-scenes.js');
const { simulate } = await import('../js/tectonics/simulate.js');
const { packFrame } = await import('../js/tectonics/frame-pack.js');
const { frameBytes, readFrameBytes } = await import('../js/app/frame-wire.js');
const { terrainConfig } = await import('../js/terrain/terrain-config.js');

const CELLS = 10000, SEED = 4242, UNTIL = 60;
const mesh = labMesh(CELLS), scene = TERRAIN_SCENES.find(s => s.id === 'cycle');
const fresh = (overrides = {}) => { const w = scene.build(mesh, SEED); Object.assign(w.config, overrides); return w; };
const run = (w, every = 10, until = UNTIL) => ({ untilMyr: until, drive: x => scene.drive(x), snapshotEveryMyr: every });
const log = () => (fs.existsSync(process.env.GEO_SIM_HISTORY_LOG) ? fs.readFileSync(process.env.GEO_SIM_HISTORY_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/** The first difference between two frames (every field byte for byte, every number by Object.is), or null. */
function differ(a, b, at = 'frame') {
    if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
        if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor || a.length !== b.length) return `${at}: type or length`;
        const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${at}: byte ${i}`;
        return null;
    }
    if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b) ? null : `${at}: ${a} ≠ ${b}`;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : `${at}: ${a} ≠ ${b}`;
    if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array or not`;
    const ka = Object.keys(a).filter(k => a[k] !== undefined).sort(), kb = Object.keys(b).filter(k => b[k] !== undefined).sort();
    if (ka.join() !== kb.join()) return `${at}: keys differ`;
    for (const k of ka) { const d = differ(a[k], b[k], `${at}.${k}`); if (d) return d; }
    return null;
}
const firstDiff = (A, B) => (A.length !== B.length ? `${A.length} frames against ${B.length}` : A.map((f, i) => differ(f, B[i], `t=${f.time}`)).find(Boolean) ?? null);

section('a cached frame is the frame built, to the bit');
const truth = simulate(fresh(), run(null)).frames, truth50 = truth.filter((f, i) => i === 0 || f.time % 50 === 0 || i === truth.length - 1);
{
    const t0 = performance.now(), built = HC.simulateCached(fresh(), run(null), { drive: scene.drive }), buildMs = performance.now() - t0;
    const t1 = performance.now(), again = HC.simulateCached(fresh(), run(null), { drive: scene.drive }), readMs = performance.now() - t1;
    check('the first run builds the history and keeps it; its frames are simulate()\'s', !built.cached && built.key && firstDiff(built.frames, truth) === null && HC.entryTimes(built.key).length === truth.length,
        `${built.frames.length} frames; ${HC.entryTimes(built.key ?? '').length} kept; ${firstDiff(built.frames, truth) ?? 'identical'}`);
    check('the second is read from the cache: every frame equal to a fresh build, every field byte for byte, every number bit for bit', again.cached && firstDiff(again.frames, truth) === null,
        `${again.cached ? 'cached' : 'built again'}; ${firstDiff(again.frames, truth) ?? 'identical'} (built in ${(buildMs / 1000).toFixed(1)} s, read in ${(readMs / 1000).toFixed(2)} s)`);
    const coarse = HC.simulateCached(fresh(), run(null, 50), { drive: scene.drive });
    check('a caller recording every 50 Myr is served from the frames kept every 10 — the frames simulate() would give it', coarse.cached && firstDiff(coarse.frames, truth50) === null,
        `${coarse.frames.map(f => f.time).join(', ')} Myr; ${firstDiff(coarse.frames, truth50) ?? 'identical'}`);
    const shorter = HC.simulateCached(fresh(), run(null, 10, 30), { drive: scene.drive });
    check('a shorter history is the first part of a longer one: served from the same entry', shorter.cached && shorter.key === built.key && firstDiff(shorter.frames, truth.slice(0, 4)) === null, `${shorter.frames.length} frames to 30 Myr`);
    const seen = [];
    HC.simulateCached(fresh(), { ...run(null), keepFrames: false, onFrame: f => seen.push(f) }, { drive: scene.drive });
    check('…and onFrame sees each frame in order, as simulate() would call it', firstDiff(seen, truth) === null, `${seen.length} frames`);
    // the wire format alone, on the values JSON loses
    const odd = { ...truth.at(-1), time: truth.at(-1).time, weird: [NaN, -0, Infinity, -Infinity, undefined, 1e-310], tagged: new Float64Array([NaN, -0]), map: new Map([[1, 'a']]) };
    const back = HC.unpackFrame(readFrameBytes(frameBytes(packFrame(odd).packed)));
    check('the frame format keeps NaN, −0, ±∞, subnormals, typed arrays and maps in a frame\'s meta', differ(back, odd) === null && back.map.get(1) === 'a', differ(back, odd) ?? 'identical');
    report('frame size kept (deflated), 10K cells', HC.listEntries().find(e => e.key === built.key).bytes / HC.entryTimes(built.key).length / 1e6, { unit: ' MB', digits: 3, source: 'no Earth figure: ~0.4 MB a frame at 40K' });
}

section('the key: the history\'s code and its settings, and nothing else');
{
    const k = w => HC.keyOf(w, scene.drive);
    const base = k(fresh());
    check('the same settings spelled two ways (a scene\'s default, and the same value set) share a key', k(scene.build(mesh, SEED, { continentalFraction: fresh().config.continentalFraction })) === base, base);
    check('the 600 Myr whole planet and the 1200 Myr cycle — one start world — share a key', HC.keyOf(TERRAIN_SCENES.find(s => s.id === 'history').build(mesh, SEED), scene.drive) === base);
    const changed = {
        'another seed': HC.keyOf(scene.build(mesh, SEED + 1), scene.drive),
        'a start-world setting (continentalFraction 0.35)': k(scene.build(mesh, SEED, { continentalFraction: 0.35 })),
        'a config override (riftMinGapMyr +1)': k(fresh({ riftMinGapMyr: fresh().config.riftMinGapMyr + 1 })),
        'a nested config override (belts)': k((() => { const w = fresh(); const g = Object.keys(w.config).find(x => w.config[x] && typeof w.config[x] === 'object' && !Array.isArray(w.config[x])); w.config[g] = { ...w.config[g], __probe: 1 }; return w; })()),
        'the crust ledger on': k(fresh({ crustLedger: true })),
        'the heights\' constants (a lab slider)': k(fresh({ heights: terrainConfig({ rainErosionExponent: 0 }) })),
        'another mesh': HC.keyOf(scene.build(labMesh(CELLS, 777), SEED), scene.drive),
        'another drive': HC.keyOf(fresh(), w => scene.drive(w)),
        'the event rules off': HC.keyOf(fresh(), scene.drive, false),
    };
    const same = Object.entries(changed).filter(([, v]) => v === base || v === null).map(([n]) => n);
    check('the key changes with the seed, the start world, any config override (the crust ledger, the heights\' sliders), the mesh, the drive and the event rules', same.length === 0, same.length ? `unchanged by: ${same.join(', ')}` : `${Object.keys(changed).length} changes, ${new Set(Object.values(changed)).size} distinct keys`);
    const ran = fresh(); simulate(ran, run(null, 10, 10));
    check('a world that has already run is never keyed (its random streams are past the seed\'s)', k(ran) === null);

    // the code: a copy of the checkout's code, changed one file at a time
    const copy = path.join(TMP, 'code');
    for (const d of ['js', 'v2/js']) fs.cpSync(path.join(HC.REPO_ROOT, d), path.join(copy, d), { recursive: true });
    fs.symlinkSync(path.join(HC.REPO_ROOT, 'node_modules'), path.join(copy, 'node_modules'));
    const here0 = HC.historyCodeHash(HC.REPO_ROOT), copy0 = HC.historyCodeHash(copy);
    check('the code hash depends on the files, not on where the checkout is (worktrees share entries)', here0.hash === copy0.hash, `${here0.hash}: ${here0.files.length} files from the history's entry points (${HC.HISTORY_ENTRIES.join(', ')})`);
    const touch = (rel, text = '\n// (changed)\n') => { fs.appendFileSync(path.join(copy, rel), text); return HC.historyCodeHash(copy).hash; };
    const after = {};
    after.step = touch('v2/js/tectonics/step/rifting.js');
    after.config = touch('v2/js/tectonics/config.js');
    after.worker = touch('v2/js/app/helper-worker.js');           // (reached only through new URL(…) in helper-pool.js)
    after.root = touch('js/rng.js');                                 // (outside v2/, imported by the world model)
    const steady = after.root;
    after.terrain = touch('v2/js/terrain/synthesize.js');
    after.finish = touch('v2/js/finish/finish.js');
    after.self = touch('v2/js/app/history-code.js');
    check('a change to a history source file changes the code hash — a step, the config, a worker reached through new URL(), a shared root file', new Set([copy0.hash, after.step, after.config, after.worker, after.root]).size === 5,
        `${copy0.hash} → ${after.step} → ${after.config} → ${after.worker} → ${after.root}`);
    check('…and terrain synthesis, the finish and app/history-code.js (the hash\'s own output) are not in it', after.terrain === steady && after.finish === steady && after.self === steady,
        `terrain ${after.terrain === steady ? 'out' : 'IN'}, finish ${after.finish === steady ? 'out' : 'IN'}, history-code.js ${after.self === steady ? 'out' : 'IN'}`);
    check('the files are found from the import graph: the steps, the scenes, the start world, the model, config, and the helpers', ['v2/js/tectonics/simulate.js', 'v2/js/tectonics/config.js', 'v2/js/tectonics/step/rifting.js', 'v2/js/tectonics/init/start-world.js', 'v2/js/app/helper-worker.js', 'v2/js/terrain/terrain-config.js', 'js/rng.js'].every(f => here0.files.includes(f)) && !here0.files.some(f => f.startsWith('v2/js/finish/') || f === 'v2/js/terrain/synthesize.js'),
        `${here0.files.filter(f => f.startsWith('package:')).join(', ') || 'no packages'}`);
}

section('writers at once, and one build for many');
{
    const script = path.join(TMP, 'child.mjs');
    fs.writeFileSync(script, `
        const HC = await import(${JSON.stringify(pathToFileURL(path.join(here, 'lib/history-cache.mjs')).href)});
        const { labMesh } = await import(${JSON.stringify(pathToFileURL(path.join(here, 'lib/check-kit.mjs')).href)});
        const { TERRAIN_SCENES } = await import(${JSON.stringify(pathToFileURL(path.join(here, '../js/tectonics/scenarios/terrain-scenes.js')).href)});
        const [mode, cells, seed, until] = process.argv.slice(2).map((v, i) => i ? Number(v) : v);
        const scene = TERRAIN_SCENES.find(s => s.id === 'cycle'), world = scene.build(labMesh(cells), seed);
        if (mode === 'build') {
            const r = HC.simulateCached(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 10 }, { drive: scene.drive });
            console.log(JSON.stringify({ cached: r.cached, n: r.frames.length, owner: r.frames.map(f => Array.from(f.owner.subarray(0, 64))) }));
        } else {                                           // hammer: write and read the same frames over and over
            const key = HC.keyOf(world, scene.drive), frames = HC.simulateCached(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 10 }, { drive: scene.drive }).frames;
            const fs = await import('node:fs');
            let bad = 0, reads = 0;
            for (let i = 0; i < 40; i++) for (const f of frames) {
                if (i % 2 === 0) fs.rmSync(HC.framePath(key, f.time), { force: true });
                HC.putFrame(key, f);
                const back = HC.getPacked(key, f.time); reads++;
                if (back && back.meta.time !== f.time) bad++;
            }
            console.log(JSON.stringify({ bad, reads }));
        }
    `);
    const child = (...args) => new Promise(res => { let out = ''; const c = spawn(process.execPath, [script, ...args.map(String)], { env: process.env }); c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; }); c.on('close', code => res({ code, out })); });
    // three processes ask for the same history at once (a fresh one: seed 99)
    fs.writeFileSync(process.env.GEO_SIM_HISTORY_LOG, '');
    const three = await Promise.all([child('build', CELLS, 99, 40), child('build', CELLS, 99, 40), child('build', CELLS, 99, 40)]);
    const parsed = three.map(r => { try { return JSON.parse(r.out.trim().split('\n').at(-1)); } catch { return null; } });
    const events = log(), builds = events.filter(e => e.event === 'build' && e.untilMyr === 40).length, waits = events.filter(e => e.event === 'wait-hit' || e.event === 'hit').length;
    check('three processes asking for one history at once: one builds it, the others wait for its frames — and all three get the same frames',
        parsed.every(Boolean) && builds === 1 && waits === 2 && parsed.every(p => JSON.stringify(p.owner) === JSON.stringify(parsed[0].owner)),
        parsed.every(Boolean) ? `${builds} build, ${waits} served from the cache (${parsed.map(p => (p.cached ? 'cached' : 'built')).join(', ')})` : three.map(r => r.out.slice(-300)).join(' | '));
    // four processes writing, deleting and reading the same frames over and over, as fast as they can
    const four = await Promise.all([0, 1, 2, 3].map(() => child('hammer', CELLS, 99, 40)));
    const res = four.map(r => { try { return JSON.parse(r.out.trim().split('\n').at(-1)); } catch { return null; } });
    const w = scene.build(mesh, 99), key = HC.keyOf(w, scene.drive), whole = HC.entryTimes(key).map(t => HC.getFrame(key, t)).filter(Boolean);
    const ref = simulate(scene.build(mesh, 99), { untilMyr: 40, drive: x => scene.drive(x), snapshotEveryMyr: 10 }).frames;
    const leftovers = fs.readdirSync(path.join(HC.CACHE_DIR, key)).filter(f => f.includes('.tmp-'));
    check('four writers at once, each deleting and rewriting every frame 40 times while reading it back: never half a frame read, and the entry whole and right after',
        res.every(r => r && r.bad === 0) && firstDiff(whole, ref) === null && leftovers.length === 0 && log().filter(e => e.event === 'corrupt').length === 0,
        `${res.map(r => r ? `${r.reads} reads, ${r.bad} wrong` : 'crashed').join(' · ')}; ${whole.length} frames ${firstDiff(whole, ref) ?? 'identical to a fresh build'}; ${leftovers.length} temporary files left; ${log().filter(e => e.event === 'corrupt').length} damaged files found`);
}

section('a damaged file is found and built again, never trusted');
{
    const w = fresh(), key = HC.keyOf(w, scene.drive), times = HC.entryTimes(key);
    const file = t => HC.framePath(key, t);
    const cut = file(times[2]), flip = file(times[4]), empty = file(times[5]);
    fs.truncateSync(cut, Math.floor(fs.statSync(cut).size / 2));
    const b = fs.readFileSync(flip); b[b.length - 100] ^= 0x40; fs.writeFileSync(flip, b);
    fs.writeFileSync(empty, '');
    fs.writeFileSync(process.env.GEO_SIM_HISTORY_LOG, '');
    const reads = [HC.getFrame(key, times[2]), HC.getFrame(key, times[4]), HC.getFrame(key, times[5])];
    check('a frame cut short, one with a byte flipped and an empty one are each refused, logged and deleted', reads.every(r => r === null) && ![cut, flip, empty].some(f => fs.existsSync(f)) && log().filter(e => e.event === 'corrupt').length === 3,
        `${reads.filter(r => r === null).length} of 3 refused; ${log().filter(e => e.event === 'corrupt').map(e => e.error).join(' · ')}`);
    fs.truncateSync(file(times[1]), 60);                         // (and one more, damaged where only a read will find it)
    const again = HC.simulateCached(fresh(), run(null), { drive: scene.drive });
    check('…and the history is built again in their place: its frames those of a fresh build', !again.cached && firstDiff(again.frames, truth) === null && HC.entryTimes(key).length === truth.length,
        `${again.cached ? 'served from the damaged cache!' : 'built again'}; ${firstDiff(again.frames, truth) ?? 'identical'}; ${HC.entryTimes(key).length} frames kept`);
}

section('eviction');
{
    const before = HC.listEntries(), total = before.reduce((s, e) => s + e.bytes, 0), oldest = before.at(-1);
    const r = HC.gc({ capBytes: total - 1 });
    check('over the cap, the entry used longest ago goes first, and only as many as must', r.removed.length === 1 && r.removed[0] === oldest.key && r.after < total, `${before.length} entries, ${(total / 1e6).toFixed(1)} MB → removed ${r.removed.length}, ${(r.after / 1e6).toFixed(1)} MB`);
}

fs.rmSync(TMP, { recursive: true, force: true });
finish('History cache');
