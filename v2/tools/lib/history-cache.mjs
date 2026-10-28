// The history cache: one store on this machine, shared by every checkout, agent, check suite and the Evolution page
// (through the dev server, tuning/dev-server.mjs), of the histories already built — so the same history is built once.
//
// Where:  $GEO_SIM_HISTORY_CACHE_DIR, else ~/.cache/geo-sim/histories/ — outside any checkout. GEO_SIM_HISTORY_CACHE=0
//         turns it off (every history is built, nothing is kept). GEO_SIM_HISTORY_CACHE_GB caps it (default 4 GB): past
//         the cap the entries used longest ago go first.
// Key:    app/history-key.js — the history code's hash (below), the start world walked whole, the drive, the event rules.
//         Two checkouts whose history code is the same share their entries; terrain and finish code are not in it (they
//         read frames, they never change them).
// Entry:  <key>/ holds one file per frame (t<milli-Myr>.frame), meta.json (what it is: seed, scene, settings, who wrote
//         it, the steps a run took to a time) and, while a process is building it, build.lock. A history is causal and an
//         ending never steers it (tectonics/ending.js), so its length and ending are not in the key: an entry holds the
//         frames of the one history at whatever times have been recorded — a 600 Myr run's frames are the first half of
//         a 1200 Myr run's. Only frames on the step grid (config.stepGridMyr) are kept: the world there is the same
//         however long the run (simulate.js), so a frame at the end of a run off the grid is not.
// Frame:  'GSHC' · u32 version · u32 bytes · u32 0 · SHA-256 of the bytes · the bytes deflated, where the bytes are the
//         packed frame (tectonics/frame-pack.js) in app/frame-wire.js's format. Every read checks the length and the
//         digest: a file cut short or damaged is deleted and its history built again, never trusted.
// Writes: to a temporary file, then renamed into place — atomic, so readers and other writers never see half a file; two
//         processes building the same history write the same bytes. A process building a history holds build.lock (its
//         pid), and another that wants the same frames waits for them to appear rather than building them too.
// Not kept: the world itself — a history asked for further than its entry reaches is built again from its start (a
//         world holds closures and ~100 plates of rasters; resuming one from disk is not cheap to make exact).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { simulate } from '../../js/tectonics/simulate.js';
import { packFrame, unpack } from '../../js/tectonics/frame-pack.js';
import { frameBytes, readFrameBytes } from '../../js/app/frame-wire.js';
import { historyKey } from '../../js/app/history-key.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');
export const CACHE_DIR = process.env.GEO_SIM_HISTORY_CACHE_DIR || path.join(os.homedir(), '.cache', 'geo-sim', 'histories');
export const LATEST_FILE = path.join(CACHE_DIR, 'latest.json');
export const ENABLED = process.env.GEO_SIM_HISTORY_CACHE !== '0';
export const CAP_BYTES = Number(process.env.GEO_SIM_HISTORY_CACHE_GB || 4) * 1e9;
export const PAGE_EVERY_MYR = 10;             // the Evolution page's frame cadence (evolution-main.js SNAPSHOT_MYR): what a build records
const LEVEL = 1;                              // deflate level: 1 is ~as small as 6 on these frames and several times faster (measured)
const MAGIC = 'GSHC', VERSION = 1, HEAD = 48;
const HEX32 = /^[0-9a-f]{32}$/;

// ── the history code's hash ──
// The files the history's entry points import, followed through every import, re-export, dynamic import and worker URL
// (new URL('./x.js', import.meta.url)): the page's history worker and runner, and every scene list the tools build from.
// A package (Delaunator) counts as its name and version. app/history-code.js is left out: the dev server writes this
// very hash into it.
export const HISTORY_ENTRIES = ['v2/js/app/history-worker.js', 'v2/js/app/history-runner.js', 'v2/js/tectonics/scenarios'];
const SELF = 'v2/js/app/history-code.js';
const IMPORTS = [/(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?['"]([^'"\n]+)['"]/g, /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g, /\bnew URL\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url\s*\)/g];
const fileMemo = new Map();                  // abs path → {mtimeMs, size, sha, deps}

function scan(abs) {
    const st = fs.statSync(abs), memo = fileMemo.get(abs);
    if (memo && memo.mtimeMs === st.mtimeMs && memo.size === st.size) return memo;
    const text = fs.readFileSync(abs), src = text.toString('utf8'), deps = new Set();
    for (const re of IMPORTS) for (const m of src.matchAll(re)) deps.add(m[1]);
    const out = { mtimeMs: st.mtimeMs, size: st.size, sha: crypto.createHash('sha256').update(text).digest('hex'), deps: [...deps] };
    fileMemo.set(abs, out);
    return out;
}

/**
 * The hash of the code that makes a history, in the checkout at `root`, and the files it covers.
 * @returns {{hash: string, files: string[]}}  hash: 16 hex digits
 */
export function historyCodeHash(root = REPO_ROOT) {
    const files = new Map(), queue = [];
    for (const e of HISTORY_ENTRIES) {
        const abs = path.join(root, e);
        if (fs.statSync(abs).isDirectory()) { for (const f of fs.readdirSync(abs).sort()) if (f.endsWith('.js')) queue.push(path.join(abs, f)); }
        else queue.push(abs);
    }
    while (queue.length) {
        const abs = queue.pop(), rel = path.relative(root, abs).split(path.sep).join('/');
        if (files.has(rel) || rel === SELF) continue;
        let s;
        try { s = scan(abs); } catch { continue; }                         // (an import named in a comment that is no file)
        files.set(rel, s.sha);
        for (const d of s.deps) {
            if (d.startsWith('node:')) continue;
            if (d.startsWith('.') || d.startsWith('/')) { queue.push(path.resolve(path.dirname(abs), d)); continue; }
            const pkg = d.startsWith('@') ? d.split('/').slice(0, 2).join('/') : d.split('/')[0];
            if (files.has(`package:${pkg}`)) continue;
            let version = '?';
            try { version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version; } catch { /* (not installed: its name alone) */ }
            files.set(`package:${pkg}`, version);
        }
    }
    const sorted = [...files.keys()].sort(), h = crypto.createHash('sha256');
    for (const f of sorted) h.update(`${f}\0${files.get(f)}\n`);
    return { hash: h.digest('hex').slice(0, 16), files: sorted };
}
let codeMemo = null;
/** This checkout's history code hash, worked out once per process (a tool's code does not change while it runs). */
export const codeHash = () => (codeMemo ??= historyCodeHash(REPO_ROOT).hash);

/** The cache key of the history this fresh world would run (null: not cacheable). */
export const keyOf = (world, drive, events = true) => (ENABLED ? historyKey(codeHash(), world, drive, events) : null);

// ── the store ──
const entryDir = key => path.join(CACHE_DIR, key);
const milli = t => Math.round(t * 1000);
export const framePath = (key, t) => path.join(entryDir(key), `t${String(milli(t)).padStart(10, '0')}.frame`);
const FRAME_NAME = /^t(\d{10})\.frame$/;

function atomicWrite(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try { fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, file); }
    catch (err) { try { fs.unlinkSync(tmp); } catch { /* (gone) */ } throw err; }
}

/** A frame file's bytes from the wire bytes of a packed frame (compressed: `deflated` when already done, by the server). */
function frameFileBytes(raw, deflated = zlib.deflateSync(raw, { level: LEVEL })) {
    const head = Buffer.alloc(HEAD);
    head.write(MAGIC, 0, 'latin1'); head.writeUInt32LE(VERSION, 4); head.writeUInt32LE(raw.byteLength, 8);
    crypto.createHash('sha256').update(raw).digest().copy(head, 16);
    return Buffer.concat([head, deflated]);
}

/** The wire bytes in a frame file, or null when it is not whole (and then it is deleted). */
function readFrameFile(file) {
    let buf;
    try { buf = fs.readFileSync(file); } catch { return null; }
    try {
        if (buf.length < HEAD || buf.toString('latin1', 0, 4) !== MAGIC || buf.readUInt32LE(4) !== VERSION) throw new Error('bad header');
        const raw = zlib.inflateSync(buf.subarray(HEAD));
        if (raw.length !== buf.readUInt32LE(8)) throw new Error('wrong length');
        if (!crypto.createHash('sha256').update(raw).digest().equals(buf.subarray(16, 48))) throw new Error('digest mismatch');
        return raw;
    } catch (err) {
        logEvent({ event: 'corrupt', file, error: err.message });
        try { fs.unlinkSync(file); } catch { /* (another reader got there first) */ }
        return null;
    }
}

/** Keep one frame (a frame as captured, or its packed form, or its wire bytes). Never overwrites a whole frame already there. */
export function putFrame(key, frameOrBytes) {
    const raw = frameOrBytes instanceof Uint8Array ? frameOrBytes : frameBytes(frameOrBytes.fields ? frameOrBytes : packFrame(frameOrBytes).packed);
    const time = frameOrBytes instanceof Uint8Array ? readFrameBytes(raw).meta.time : (frameOrBytes.meta?.time ?? frameOrBytes.time);
    const file = framePath(key, time);
    if (fs.existsSync(file)) return { file, bytes: 0 };
    const bytes = frameFileBytes(raw);
    atomicWrite(file, bytes);
    return { file, bytes: bytes.length, raw: raw.byteLength };
}

/** The same, compressing off the main thread (the dev server: a page's upload never holds up what it serves). */
export async function putFrameAsync(key, raw) {
    const { meta } = readFrameBytes(raw), file = framePath(key, meta.time);
    if (fs.existsSync(file)) return { file, time: meta.time, bytes: 0 };
    const deflated = await new Promise((res, rej) => zlib.deflate(raw, { level: LEVEL }, (e, out) => (e ? rej(e) : res(out))));
    const bytes = frameFileBytes(raw, deflated);
    atomicWrite(file, bytes);
    return { file, time: meta.time, bytes: bytes.length };
}

/** A frame's packed form ({meta, fields}) from the cache, or null. */
export function getPacked(key, t) {
    const raw = readFrameFile(framePath(key, t));
    if (!raw) return null;
    try { return readFrameBytes(raw); } catch (err) { logEvent({ event: 'corrupt', file: framePath(key, t), error: err.message }); try { fs.unlinkSync(framePath(key, t)); } catch { /* */ } return null; }
}

/** A packed frame, whole again: every field unpacked — the frame as captureFrame made it. */
export function unpackFrame({ meta, fields }) {
    const f = { ...meta };
    for (const [k, v] of Object.entries(fields)) f[k] = unpack(v);
    return f;
}

/** A frame from the cache (as captured), or null. */
export function getFrame(key, t) { const p = getPacked(key, t); touch(key); return p && unpackFrame(p); }

/** The times (Myr, to the milli-Myr) an entry holds frames for, in order. */
export function entryTimes(key) {
    let names;
    try { names = fs.readdirSync(entryDir(key)); } catch { return []; }
    return names.map(n => FRAME_NAME.exec(n)).filter(Boolean).map(m => Number(m[1]) / 1000).sort((a, b) => a - b);
}

export function readMeta(key) { try { return JSON.parse(fs.readFileSync(path.join(entryDir(key), 'meta.json'), 'utf8')); } catch { return null; } }
/** Merge into an entry's meta.json (its `steps` too: the steps a run took to each time). */
export function writeMeta(key, patch) {
    const old = readMeta(key) ?? { key, created: new Date().toISOString() };
    const merged = { ...old, ...patch, steps: { ...old.steps, ...patch.steps } };
    atomicWrite(path.join(entryDir(key), 'meta.json'), JSON.stringify(merged, null, 1));
    return merged;
}

const touched = new Set();
/** Mark an entry used (its folder's time: what least-recently-used eviction goes by) — once a process. */
export function touch(key) {
    if (touched.has(key)) return;
    touched.add(key);
    const now = new Date();
    try { fs.utimesSync(entryDir(key), now, now); } catch { /* (not there) */ }
}

// ── the build lock: one process builds a history, the others wait for its frames ──
const lockFile = key => path.join(entryDir(key), 'build.lock');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** Who holds an entry's build lock ({pid, host, untilMyr, everyMyr, at}), or null — a dead holder's lock is cleared. */
export function lockHolder(key) {
    let held;
    try { held = JSON.parse(fs.readFileSync(lockFile(key), 'utf8')); } catch { return null; }
    const stale = (held.host === os.hostname() && !alive(held.pid)) || Date.now() - Date.parse(held.at) > 6 * 3600e3;
    if (stale) { try { fs.unlinkSync(lockFile(key)); } catch { /* */ } return null; }
    return held;
}
function takeLock(key, untilMyr, everyMyr) {
    fs.mkdirSync(entryDir(key), { recursive: true });
    for (let tries = 0; tries < 3; tries++) {
        try {
            const fd = fs.openSync(lockFile(key), 'wx');
            fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), untilMyr, everyMyr, at: new Date().toISOString() }));
            fs.closeSync(fd);
            return true;
        } catch (err) { if (err.code !== 'EEXIST') throw err; if (lockHolder(key)) return false; }
    }
    return false;
}
const dropLock = key => { try { const h = JSON.parse(fs.readFileSync(lockFile(key), 'utf8')); if (h.pid === process.pid) fs.unlinkSync(lockFile(key)); } catch { /* */ } };
const sleepMs = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ── the writer thread (history-writer.mjs): frames are packed, compressed and written beside the build, not in its way ──
let writer = null;
function writerThread() {
    if (!writer) {
        const counter = new SharedArrayBuffer(4), w = new Worker(new URL('./history-writer.mjs', import.meta.url), { workerData: { counter } });
        w.unref();
        writer = { w, done: new Int32Array(counter), sent: 0 };
    }
    return writer;
}
/** Hand a frame to the writer (a copy goes: the caller keeps its frame). */
function writeLater(key, frame) { const W = writerThread(); W.sent++; W.w.postMessage({ key, frame }); }
/** Wait — synchronously — until the writer has every frame handed to it on disk. */
function writesDone() {
    if (!writer) return;
    for (let d; (d = Atomics.load(writer.done, 0)) < writer.sent;) Atomics.wait(writer.done, 0, d, 1000);
}

// ── what the tools call ──
const LOG = process.env.GEO_SIM_HISTORY_LOG;
const suite = path.basename(process.argv[1] ?? 'node');
export function logEvent(e) { if (LOG) try { fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, suite, ...e }) + '\n'); } catch { /* */ } }
/** What this process's histories came to: built, read from the cache, waited for another process's build. */
export const stats = { built: 0, hits: 0, waited: 0, bypassed: 0, builtMs: 0, readMs: 0 };

/** The times simulate() records frames at for this cadence and length: the start, every `every` Myr, the end. */
function schedule(every, untilMyr) {
    const out = [0];
    for (let t = every; t < untilMyr - 1e-9; t += every) out.push(t);
    if (untilMyr > 1e-9) out.push(untilMyr);
    return out;
}

/**
 * simulate(), through the cache: the same frames, read from the cache when it holds them all, else built — and then kept.
 * Use it where only the frames are wanted (the result's frames, or onFrame): on a hit the world is NOT run (it stays at
 * its start) and stepLog is empty; `steps` (the steps taken to untilMyr) is known when a tool built the entry (it notes
 * them at every frame) or a run ended there; on a hit the events and budget are the last frame's (frame.events, .budget). A run that cannot be keyed —
 * resumed, with a stopAt, or with the cache off — is simply simulate().
 * @param {Object} world   a fresh world (time 0), its config as the run will have it
 * @param {Object} opts    simulate's options
 * @param {{drive?: Function, spec?: Object}} [o]   drive: the drive's identity when opts.drive wraps it (w => scene.drive(w):
 *                         pass scene.drive); spec: what to note in the entry's meta.json (seed, scene, settings)
 * @returns {{frames: Object[], steps: number|null, stepLog: Object[], stopped: boolean, cached: boolean, key: string|null}}
 */
export function simulateCached(world, opts, { drive = opts.drive, spec = null } = {}) {
    const events = opts.events !== false, key = opts.stopAt || opts.resume ? null : keyOf(world, drive, events);
    if (!key) { stats.bypassed++; return { ...simulate(world, opts), cached: false, key: null }; }
    const every = opts.snapshotEveryMyr ?? world.config.snapshotEveryMyr, grid = world.config.stepGridMyr, untilMyr = opts.untilMyr;
    const onGrid = t => Math.abs(t / grid - Math.round(t / grid)) < 1e-6;
    const want = schedule(every, untilMyr), wantSet = new Set(want.map(milli)), keepFrames = opts.keepFrames !== false;
    const have = () => { const got = new Set(entryTimes(key).map(milli)); return want.every(t => got.has(milli(t))); };
    const t0 = performance.now();
    const fromCache = how => {
        const frames = [];
        for (const t of want) {
            const f = getFrame(key, t);
            if (!f) return null;                                          // (deleted under us, or damaged: build it)
            if (keepFrames) frames.push(f);
            opts.onFrame?.(f);
        }
        const ms = performance.now() - t0;
        stats[how]++; stats.readMs += ms;
        logEvent({ event: how === 'hits' ? 'hit' : 'wait-hit', key, untilMyr, every, ms: Math.round(ms) });
        return { frames, steps: readMeta(key)?.steps?.[milli(untilMyr)] ?? null, stepLog: [], stopped: false, cached: true, key };
    };
    if (want.every(onGrid) && have()) { const r = fromCache('hits'); if (r) return r; }
    // record at the page's cadence where the caller's is a multiple of it (more frames kept for the next caller, the same
    // frames handed back: recording more often never changes a history), else at the caller's
    const rec = every % PAGE_EVERY_MYR === 0 && PAGE_EVERY_MYR % grid === 0 ? PAGE_EVERY_MYR : every;
    for (;;) {
        if (takeLock(key, untilMyr, rec)) break;
        // another process is building it: wait for the frames if its run will record them, else build alongside
        const h = lockHolder(key);
        if (!h) continue;
        if (!(h.untilMyr >= untilMyr - 1e-9 && want.every(t => Math.abs(t / h.everyMyr - Math.round(t / h.everyMyr)) < 1e-6 || Math.abs(t - h.untilMyr) < 1e-6) && want.every(onGrid))) break;
        logEvent({ event: 'wait', key, holder: h.pid, untilMyr });
        while (lockHolder(key) && !have()) sleepMs(1000);
        if (have()) { const r = fromCache('waited'); if (r) return r; }
    }
    try {
        const frames = [], present = new Set(entryTimes(key).map(milli)), stepsAt = {};
        let kept = 0;
        const r = simulate(world, { ...opts, snapshotEveryMyr: rec, keepFrames: false, onFrame: f => {
            if (onGrid(f.time)) { stepsAt[milli(f.time)] = world.step; if (!present.has(milli(f.time))) { writeLater(key, f); kept++; } }
            if (!wantSet.has(milli(f.time))) return;
            if (keepFrames) frames.push(f);
            opts.onFrame?.(f);
        } });
        writesDone();
        const ms = performance.now() - t0;
        stats.built++; stats.builtMs += ms;
        writeMeta(key, { code: codeHash(), spec: spec ?? { seed: world.seed, cells: world.mesh.numCells }, steps: { ...stepsAt, [milli(world.time)]: r.steps }, builtBy: suite, builtAt: new Date().toISOString() });
        logEvent({ event: 'build', key, untilMyr, every, rec, kept, ms: Math.round(ms) });
        return { frames, steps: r.steps, stepLog: r.stepLog, stopped: r.stopped, cached: false, key };
    } finally {
        writesDone();
        dropLock(key);
        gcSometimes();
    }
}

// ── eviction ──
/** Every entry: key, bytes, frames, last used, meta. */
export function listEntries() {
    let names;
    try { names = fs.readdirSync(CACHE_DIR); } catch { return []; }
    const out = [];
    for (const name of names) {
        if (!HEX32.test(name)) continue;
        const dir = path.join(CACHE_DIR, name);
        let bytes = 0, frames = 0, st;
        try { st = fs.statSync(dir); for (const f of fs.readdirSync(dir)) { const s = fs.statSync(path.join(dir, f)); bytes += s.size; if (FRAME_NAME.test(f)) frames++; } } catch { continue; }
        out.push({ key: name, dir, bytes, frames, usedAt: st.mtimeMs, meta: readMeta(name) });
    }
    return out.sort((a, b) => b.usedAt - a.usedAt);
}

/**
 * Bring the cache under its cap: the entries used longest ago go first (never one a live process is building), and
 * temporary files a crashed writer left (over an hour old). @returns {{before: number, after: number, removed: string[]}}
 */
export function gc({ capBytes = CAP_BYTES } = {}) {
    const entries = listEntries(), removed = [];
    let total = entries.reduce((s, e) => s + e.bytes, 0);
    const before = total;
    for (const e of entries) for (const f of fs.readdirSync(e.dir)) if (f.includes('.tmp-')) {
        const p = path.join(e.dir, f);
        try { if (Date.now() - fs.statSync(p).mtimeMs > 3600e3) fs.unlinkSync(p); } catch { /* */ }
    }
    for (const e of [...entries].reverse()) {
        if (total <= capBytes) break;
        if (lockHolder(e.key)) continue;
        fs.rmSync(e.dir, { recursive: true, force: true });
        total -= e.bytes; removed.push(e.key);
    }
    if (removed.length) logEvent({ event: 'gc', removed: removed.length, before, after: total });
    return { before, after: total, removed };
}
/** gc, at most once a minute on this machine (after a build). */
export function gcSometimes() {
    const mark = path.join(CACHE_DIR, '.gc');
    try { if (Date.now() - fs.statSync(mark).mtimeMs < 60e3) return; } catch { /* (never yet) */ }
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(mark, ''); gc(); } catch (err) { logEvent({ event: 'gc-failed', error: err.message }); }
}

// ── what the user is looking at (the Evolution page writes it, through the dev server) ──
export function readLatest() { try { return JSON.parse(fs.readFileSync(LATEST_FILE, 'utf8')); } catch { return null; } }
export function writeLatest(view) { atomicWrite(LATEST_FILE, JSON.stringify(view, null, 1)); }
