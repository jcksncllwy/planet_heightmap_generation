// The finish cache: one store on this machine, shared by every checkout, agent, tool and the Evolution page (through the
// dev server, tuning/dev-server.mjs), of the moments already finished ("Add detail") — so any session can load exactly
// the finished moment the user is looking at (node v2/tools/finish-latest.mjs), and a moment is finished once.
// The history cache's twin (history-cache.mjs): the same integrity rules, its own folder and cap.
//
// Where:  $GEO_SIM_FINISH_CACHE_DIR, else ~/.cache/geo-sim/finishes/ — outside any checkout. GEO_SIM_FINISH_CACHE=0 turns
//         it off. GEO_SIM_FINISH_CACHE_GB caps it (default 8 GB): past the cap the entries used longest ago go first.
// Key:    app/finish-key.js — the moment's history key and time, the finish code's hash (below), the detail, the picture's
//         width, the climate's settings, the People layer's world or not, and the engine (the page or Node, its maths,
//         the GPU's erosion or the CPU's). The page's finishes and Node's are filed apart; a Node tool may still READ the
//         page's (loadFinish(key), finish-latest.mjs): that is how a session sees what the user sees.
// Entry:  <key>/ holds page.bin (what the page shows: the picture, rivers, climate, the People layer's world, stats —
//         finish-result.js page), cells.bin (the per-cell fields on the finish's mesh: z, ocean, lake, lakeLevel,
//         glaciated), meta.json (the spec it is keyed by, who made it and when, its state: 'uploading' until whole,
//         then 'complete') and, while a Node process builds it, build.lock.
// Files:  'GSFC' · u32 version · u32 bytes · u32 0 · SHA-256 of the bytes · the bytes deflated, the bytes being the tree
//         in app/finish-wire.js's format. Every read checks the length and the digest: a file cut short or damaged is
//         deleted, never trusted (and the moment finished again by whoever wants it).
// Writes: to a temporary file, then renamed into place — atomic. A Node process finishing a moment holds build.lock (its
//         pid); another that wants the same moment waits for it rather than finishing it too.
// Weight: 56 MB an entry at 2.5M cells and the page's 4096-px picture (measured 2026-11-04); ~220 MB at 10M, 8192 px (estimated).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { historyCodeHash, sealedBytes, readSealed, atomicWrite, readLatest, REPO_ROOT } from './history-cache.mjs';
import { finishKey, finishSpec } from '../../js/app/finish-key.js';
import { mathFingerprint } from '../../js/app/history-key.js';
import { treeBytes, readTree } from '../../js/app/finish-wire.js';

export const CACHE_DIR = process.env.GEO_SIM_FINISH_CACHE_DIR || path.join(os.homedir(), '.cache', 'geo-sim', 'finishes');
export const ENABLED = process.env.GEO_SIM_FINISH_CACHE !== '0';
export const CAP_BYTES = Number(process.env.GEO_SIM_FINISH_CACHE_GB || 8) * 1e9;
export const PARTS = ['page', 'cells'];
const MAGIC = 'GSFC', HEX32 = /^[0-9a-f]{32}$/, LEVEL = 1;
const inflate = promisify(zlib.inflate), VERSION = 1;         // (history-cache.mjs sealedBytes' version)

// ── the finish code's hash: the finish worker and everything it imports (finish.js, the terrain pool, the climate, the
// GPU's erosion, the civ layer's world…), followed as history-cache.mjs follows the history's ──
export const FINISH_ENTRIES = ['v2/js/finish/finish-worker.js'];
export const finishCodeHash = (root = REPO_ROOT) => historyCodeHash(root, FINISH_ENTRIES);
let codeMemo = null;
/** This checkout's finish code hash, once per process. */
export const codeHash = () => (codeMemo ??= finishCodeHash(REPO_ROOT).hash);

/** The spec and key of a finish Node runs here (history: the moment's history-cache key). Null key: not cacheable. */
export function nodeKey({ history, timeMyr, cells, width, climate = {}, civ = false, erosion = 'cpu' }) {
    const spec = finishSpec({ history, timeMyr, code: codeHash(), cells, width, climate, civ, host: 'node', math: mathFingerprint(), erosion });
    return { spec, key: ENABLED ? finishKey(spec) : null };
}

// ── the store ──
const entryDir = key => path.join(CACHE_DIR, key);
export const partPath = (key, part) => path.join(entryDir(key), `${part}.bin`);
const checkPart = part => { if (!PARTS.includes(part)) throw new Error(`finish-cache: no part ${part}`); };

export function readMeta(key) { try { return JSON.parse(fs.readFileSync(path.join(entryDir(key), 'meta.json'), 'utf8')); } catch { return null; } }
export function writeMeta(key, patch) {
    const merged = { ...(readMeta(key) ?? { key, created: new Date().toISOString() }), ...patch };
    atomicWrite(path.join(entryDir(key), 'meta.json'), JSON.stringify(merged, null, 1));
    return merged;
}

/** Keep a part (a tree, or its wire bytes). */
export function putPart(key, part, treeOrBytes) {
    checkPart(part);
    const raw = treeOrBytes instanceof Uint8Array ? treeOrBytes : treeBytes(treeOrBytes);
    const bytes = sealedBytes(raw, zlib.deflateSync(raw, { level: LEVEL }), MAGIC);
    atomicWrite(partPath(key, part), bytes);
    return { raw: raw.byteLength, bytes: bytes.length };
}

/** Keep a part that arrives deflated (the page compresses before it uploads): inflated here to check it is whole and to
 *  seal it, its deflated bytes kept as they came. `rawBytes`: its length before, as the sender counted it. */
export async function putPartDeflated(key, part, deflated, rawBytes) {
    checkPart(part);
    const raw = await inflate(deflated);
    if (raw.length !== rawBytes) throw new Error(`finish-cache: ${part} arrived as ${raw.length} bytes, sent as ${rawBytes}`);
    readTree(raw);                                                  // (a tree it can read, or nothing kept)
    const bytes = sealedBytes(raw, deflated, MAGIC);
    atomicWrite(partPath(key, part), bytes);
    return { raw: raw.length, bytes: bytes.length };
}

/** A part's wire bytes, checked — or null (not there; damaged: then deleted). Async: the dev server's read. */
export async function readPartBytesAsync(key, part) {
    checkPart(part);
    const file = partPath(key, part);
    let buf;
    try { buf = await fs.promises.readFile(file); } catch { return null; }
    // (inflated off the main thread, then checked as readSealed checks: the header, the length, the digest)
    let raw = null;
    if (buf.length >= 48 && buf.toString('latin1', 0, 4) === MAGIC && buf.readUInt32LE(4) === VERSION) try { raw = await inflate(buf.subarray(48)); } catch { /* */ }
    if (!raw || raw.length !== buf.readUInt32LE(8) || !crypto.createHash('sha256').update(raw).digest().equals(buf.subarray(16, 48))) {
        try { fs.unlinkSync(file); } catch { /* */ }
        return null;
    }
    touch(key);
    return raw;
}

/** A part's tree, checked — or null. */
export function readPart(key, part) {
    checkPart(part);
    const raw = readSealed(partPath(key, part), MAGIC);
    if (!raw) return null;
    touch(key);
    try { return readTree(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)); }
    catch { try { fs.unlinkSync(partPath(key, part)); } catch { /* */ } return null; }
}

/** Whether an entry is whole (both parts there, its meta 'complete'). */
export function isComplete(key) {
    const m = readMeta(key);
    return m?.state === 'complete' && PARTS.every(p => fs.existsSync(partPath(key, p)));
}

/** Mark an entry used (its folder's time: what eviction goes by). */
export function touch(key) { const now = new Date(); try { fs.utimesSync(entryDir(key), now, now); } catch { /* */ } }

// ── the build lock (Node's finishes; the page's arrive whole, after it finished) ──
const lockFile = key => path.join(entryDir(key), 'build.lock');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function lockHolder(key) {
    let held;
    try { held = JSON.parse(fs.readFileSync(lockFile(key), 'utf8')); } catch { return null; }
    if ((held.host === os.hostname() && !alive(held.pid)) || Date.now() - Date.parse(held.at) > 2 * 3600e3) { try { fs.unlinkSync(lockFile(key)); } catch { /* */ } return null; }
    return held;
}
function takeLock(key) {
    fs.mkdirSync(entryDir(key), { recursive: true });
    for (let tries = 0; tries < 3; tries++) {
        try { const fd = fs.openSync(lockFile(key), 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() })); fs.closeSync(fd); return true; }
        catch (err) { if (err.code !== 'EEXIST') throw err; if (lockHolder(key)) return false; }
    }
    return false;
}
const dropLock = key => { try { if (JSON.parse(fs.readFileSync(lockFile(key), 'utf8')).pid === process.pid) fs.unlinkSync(lockFile(key)); } catch { /* */ } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Wait for an entry another process (a Node build, or the page's upload) is making — up to `ms`. @returns whether it is whole */
export async function waitComplete(key, ms = 15 * 60e3) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
        if (isComplete(key)) return true;
        const m = readMeta(key);
        // (no build under way and no upload under way — or one that stopped long ago: nothing to wait for)
        if (!lockHolder(key) && !(m?.state === 'uploading' && Date.now() - Date.parse(m.at ?? m.created) < 10 * 60e3)) return isComplete(key);
    }
    return isComplete(key);
}

/**
 * A finish, through the cache: read when the entry is whole, else built (`build()` → finish-result.js {page, cells})
 * and kept — one Node process building it, the others waiting for it.
 * @returns {Promise<{page, cells, cached: boolean, key: string|null}>}
 */
export async function finishCached(spec, key, build, info = {}) {
    if (!key) { const r = await build(); return { ...r, cached: false, key: null }; }
    for (;;) {
        if (isComplete(key)) { const page = readPart(key, 'page'), cells = readPart(key, 'cells'); if (page && cells) return { page, cells, cached: true, key }; }
        if (takeLock(key)) break;
        await waitComplete(key);
        if (!isComplete(key) && !lockHolder(key)) continue;          // (its builder died: take it over)
    }
    try {
        const r = await build();
        writeMeta(key, { spec, state: 'uploading', at: new Date().toISOString(), builtBy: path.basename(process.argv[1] ?? 'node'), engine: `node ${process.version}`, ...info });
        const sizes = { page: putPart(key, 'page', r.page), cells: putPart(key, 'cells', r.cells) };
        writeMeta(key, { state: 'complete', sizes, stats: r.page.stats, ms: r.page.ms });
        return { ...r, cached: false, key };
    } finally { dropLock(key); gcSometimes(); }
}

/**
 * A finished moment from the cache, whole: its spec and meta, the page part (raster, rivers, climate, civ, stats, ms) and
 * the cells part; with mesh, the finish's mesh too (terrain-mesh.js: built again from the detail — seconds at 2.5M, ~15 s
 * at 10M). Null when the entry is not there or not whole.
 */
export async function loadFinish(key, { cells = true, mesh = false, waitMs = 0 } = {}) {
    if (!HEX32.test(key ?? '')) return null;
    if (waitMs && !isComplete(key)) await waitComplete(key, waitMs);
    if (!isComplete(key)) return null;
    const meta = readMeta(key), page = readPart(key, 'page'), cellPart = cells ? readPart(key, 'cells') : null;
    if (!page || (cells && !cellPart)) return null;
    const out = { key, meta, spec: meta.spec, ...page, cells: cellPart };
    if (mesh) {
        const { setDelaunator } = await import('../../../js/sphere-mesh.js'), { terrainMesh } = await import('../../js/terrain/terrain-mesh.js');
        setDelaunator((await import('delaunator')).default);
        out.mesh = terrainMesh(meta.spec.cells);
    }
    return out;
}

/** The finished moment the user is looking at (the history cache's latest.json, as the page last told it: its finish
 *  key) — loaded whole (see loadFinish), waiting for an upload still under way. Null when nothing finished is on screen. */
export async function loadLatestFinish(o = {}) {
    const latest = readLatest();
    if (!latest?.finish) return null;
    const fin = await loadFinish(latest.finish, { waitMs: 5 * 60e3, ...o });
    return fin && { ...fin, latest };
}

// ── eviction ──
export function listEntries() {
    let names;
    try { names = fs.readdirSync(CACHE_DIR); } catch { return []; }
    const out = [];
    for (const name of names) {
        if (!HEX32.test(name)) continue;
        const dir = path.join(CACHE_DIR, name);
        let bytes = 0, st;
        try { st = fs.statSync(dir); for (const f of fs.readdirSync(dir)) bytes += fs.statSync(path.join(dir, f)).size; } catch { continue; }
        out.push({ key: name, dir, bytes, usedAt: st.mtimeMs, meta: readMeta(name) });
    }
    return out.sort((a, b) => b.usedAt - a.usedAt);
}

/** Bring the cache under its cap: entries used longest ago go first (never one being built or uploaded), and temporary
 *  files a crashed writer left (over an hour old). */
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
        if (lockHolder(e.key) || (e.meta?.state === 'uploading' && Date.now() - Date.parse(e.meta.at ?? e.meta.created) < 3600e3)) continue;
        fs.rmSync(e.dir, { recursive: true, force: true });
        total -= e.bytes; removed.push(e.key);
    }
    return { before, after: total, removed };
}
export function gcSometimes() {
    const mark = path.join(CACHE_DIR, '.gc');
    try { if (Date.now() - fs.statSync(mark).mtimeMs < 60e3) return; } catch { /* */ }
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(mark, ''); gc(); } catch { /* */ }
}
