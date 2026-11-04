// Headless checks of the finish cache (tools/lib/finish-cache.mjs, app/finish-key.js, app/finish-wire.js, the dev
// server's /api/finish/*): software contracts, not physics — every line is hard. A finished moment read back is the
// moment finished, to the bit; the key changes with every setting that changes a finish and with nothing else; a damaged
// file is found, deleted and finished again; one process finishes a moment while the others wait; the page's upload path
// (deflated, through the dev server) keeps exactly what it sent. In caches of its own (a temporary folder), so it never
// touches the machine's.
// Usage: node v2/tools/check-finish-cache.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-sim-finish-check-'));
process.env.GEO_SIM_FINISH_CACHE_DIR = path.join(TMP, 'finishes');
process.env.GEO_SIM_HISTORY_CACHE_DIR = path.join(TMP, 'histories');
delete process.env.GEO_SIM_FINISH_CACHE; delete process.env.GEO_SIM_HISTORY_CACHE;

const here = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(here, '..', '..');
const { check, section, finish } = await import('./lib/check-kit.mjs');
const FC = await import('./lib/finish-cache.mjs');
const HC = await import('./lib/history-cache.mjs');
const { finishKey, finishSpec } = await import('../js/app/finish-key.js');
const { treeBytes, treeChunks, readTree } = await import('../js/app/finish-wire.js');

/** The first difference between two trees (typed arrays byte for byte, numbers by Object.is), or null. */
function differ(a, b, at = 'tree') {
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
    if (ka.join() !== kb.join()) return `${at}: keys differ (${ka} | ${kb})`;
    for (const k of ka) { const d = differ(a[k], b[k], `${at}.${k}`); if (d) return d; }
    return null;
}

// ── the wire ──
section('the wire format (app/finish-wire.js)');
{
    const odd = new Float64Array([NaN, -0, Infinity, -Infinity, 5e-324, 1.5]);
    const sub = new Float32Array(new ArrayBuffer(64), 4, 7).fill(2.5);         // (a view at an odd offset of a larger buffer)
    const tree = { raster: { w: 3, h: 1, heightM: new Int16Array([-5, 0, 8848]), ocean: new Uint8Array([1, 0, 0]) }, odd, sub, n: [NaN, -0, Infinity, 1],
        all: { a: new Int8Array([-1]), b: new Uint8ClampedArray([255]), c: new Uint16Array([65535]), d: new Int32Array([-7]), e: new Uint32Array([4e9]), f: new Float32Array([0.1]) }, s: 'Köppen ✓', none: null, gone: undefined };
    const bytes = treeBytes(tree), back = readTree(bytes);
    check('a tree of typed arrays (every type, a view at an odd offset), NaN, −0, ±∞ and text reads back identical', differ(back, tree) === null, differ(back, tree) ?? `${bytes.length} bytes`);
    const { chunks, bytes: n } = treeChunks(tree);
    check('…its chunks (what a Blob is made of) add up to the same bytes', chunks.reduce((s, c) => s + c.byteLength, 0) === n && n === bytes.length);
    check('…and every array read back is a view on the one buffer, aligned, not a copy', back.raster.heightM.buffer === back.odd.buffer && back.odd.byteOffset % 8 === 0);
    let refused = 0;
    for (const bad of [bytes.slice(0, bytes.length - 3), bytes.slice(0, bytes.length - 40), new Uint8Array([...bytes, 0, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array(16)]) try { readTree(bad); } catch { refused++; }
    check('bytes cut short (even by padding), with bytes over, or not a finished moment at all, are refused', refused === 4);
}

// ── the key ──
section('the key (app/finish-key.js)');
{
    const base = { history: 'a'.repeat(32), timeMyr: 430, code: 'c0de', cells: 2500000, width: 4096, climate: { greenhouseWm2: 0, precipScale: 1 }, civ: true, host: 'page', math: '84ea2e1368bd', erosion: 'gpu' };
    const k0 = finishKey(base);
    const changes = { history: 'b'.repeat(32), timeMyr: 440, code: 'c0df', cells: 10000000, width: 8192, climate: { greenhouseWm2: 2, precipScale: 1 }, climate2: { greenhouseWm2: 0, precipScale: 1.5 }, civ: false, host: 'node', math: '1624d1d0e84a', erosion: 'cpu' };
    const same = Object.entries(changes).filter(([k, v]) => finishKey({ ...base, [k.replace(/2$/, '')]: v }) === k0).map(([k]) => k);
    check('the key changes with the history, the moment, the finish code, the detail, the width, Greenhouse, Precipitation, People, the host, the maths and the erosion\'s engine', same.length === 0, same.length ? `unchanged by: ${same}` : k0);
    check('…and not with how the climate is spelt (no options and the sliders at rest share a key)', finishKey({ ...base, climate: {} }) === k0 && finishKey({ ...base, climate: undefined }) === k0);
    check('…nor with a spec read back from meta.json (it keys as it was keyed)', finishKey(JSON.parse(JSON.stringify(finishSpec(base)))) === k0);
    check('no history key or no code hash: nothing to file it under', finishKey({ ...base, history: null }) === null && finishKey({ ...base, code: null }) === null);
    check('a key is 32 hex digits, the same form as a history\'s', /^[0-9a-f]{32}$/.test(k0));
}

// ── the finish code's hash ──
section('the finish code hash');
{
    const h = FC.finishCodeHash(ROOT);
    check('it follows the finish worker\'s imports: the finish, the terrain pool and its worker, the climate, the GPU\'s erosion, the civ layer\'s world',
        ['v2/js/finish/finish.js', 'v2/js/finish/finish-fsm.js', 'v2/js/terrain/terrain-pool.js', 'v2/js/climate/climate.js', 'v2/js/gpu/erode-gpu.js', 'v2/js/civ/civ-page.js', 'v2/js/finish/finish-result.js'].every(f => h.files.includes(f)),
        `${h.files.length} files, ${h.hash}`);
    // (a copy of the checkout's v2/js and js, one file edited at a time)
    const copy = path.join(TMP, 'copy');
    for (const d of ['v2/js', 'js']) fs.cpSync(path.join(ROOT, d), path.join(copy, d), { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(copy, 'node_modules'));
    const h0 = FC.finishCodeHash(copy).hash;
    const edit = (f, fn) => { const p = path.join(copy, f), old = fs.readFileSync(p, 'utf8'); fs.writeFileSync(p, old + '\n// edited\n'); const hh = FC.finishCodeHash(copy).hash; fs.writeFileSync(p, old); fn?.(); return hh; };
    const after = { fsm: edit('v2/js/finish/finish-fsm.js'), climate: edit('v2/js/climate/climate.js'), history: edit('v2/js/tectonics/step/rifting.js') };
    check('the hash depends on the files, not on where the checkout is (worktrees share entries)', h0 === h.hash);
    check('an edit to the finish or the climate changes it; one to the history alone does not (the history key holds that)', after.fsm !== h0 && after.climate !== h0 && after.history === h0, JSON.stringify(after));
}

// ── the store ──
section('the store');
{
    const key = 'f'.repeat(32), page = { raster: { w: 4, h: 2, heightM: new Int16Array(8).map((_, i) => i * 100 - 300), ocean: new Uint8Array(8).fill(1) }, stats: { erodeOn: 'cpu' } }, cells = { numCells: 3, z: new Float32Array([0.1, -2, 3]) };
    FC.putPart(key, 'page', page); FC.putPart(key, 'cells', cells);
    check('an entry is not whole until its meta says so (an upload under way is never read)', !FC.isComplete(key) && (await FC.loadFinish(key)) === null);
    FC.writeMeta(key, { spec: { cells: 3 }, state: 'complete' });
    const fin = await FC.loadFinish(key);
    check('a whole entry reads back as it was kept: its page part and its cells', fin && differ(fin.raster, page.raster) === null && differ(fin.cells, cells) === null);
    const file = FC.partPath(key, 'page'), buf = fs.readFileSync(file);
    buf[buf.length - 5] ^= 0xff; fs.writeFileSync(file, buf);
    check('a part with a byte flipped is refused and deleted — and the entry is no longer whole', (await FC.loadFinish(key)) === null && !fs.existsSync(file) && !FC.isComplete(key));
    FC.putPart(key, 'page', page);
    fs.writeFileSync(FC.partPath(key, 'cells'), fs.readFileSync(FC.partPath(key, 'cells')).subarray(0, 60));
    check('a part cut short is refused and deleted', FC.readPart(key, 'cells') === null && !fs.existsSync(FC.partPath(key, 'cells')));
    FC.putPart(key, 'cells', cells);
    const raw = await FC.readPartBytesAsync(key, 'page');
    check('the dev server\'s read (async) gives the very bytes kept, checked', raw && differ(readTree(raw), page) === null);
    const f2 = FC.partPath(key, 'page'), b2 = fs.readFileSync(f2); b2[60] ^= 1; fs.writeFileSync(f2, b2);
    check('…and refuses and deletes a damaged one too', (await FC.readPartBytesAsync(key, 'page')) === null && !fs.existsSync(f2));
}

// ── through the cache: a real finish ──
section('a finish through the cache');
const { momentFrame, historyKeyOf, MESH_SEED } = await import('./lib/moment-frame.mjs');
const { buildSimMesh } = await import('../js/core/sim-mesh.js');
const { TerrainPool } = await import('../js/terrain/terrain-pool.js');
const { finishPlanet } = await import('../js/finish/finish.js');
const { finishResult } = await import('../js/finish/finish-result.js');
const { setDelaunator } = await import('../../js/sphere-mesh.js');
setDelaunator((await import('delaunator')).default);
const SEED = 4242, SIM = 10000, TIME = 60, CELLS = 40000, WIDTH = 512;
const frame = await momentFrame(ROOT, { seed: SEED, cont: 30, sim: SIM, time: TIME }), simMesh = buildSimMesh(SIM, MESH_SEED);
let builds = 0;
const finishNow = async (poolSize = null) => {
    builds++;
    const pool = await TerrainPool.create(simMesh, poolSize);
    return finishResult(await finishPlanet({ frame, simMesh, seed: SEED, cells: CELLS, pool, closePool: true }), { width: WIDTH });
};
{
    const { spec, key } = FC.nodeKey({ history: historyKeyOf(frame), timeMyr: TIME, cells: CELLS, width: WIDTH });
    const first = await FC.finishCached(spec, key, finishNow);
    const again = await FC.finishCached(spec, key, finishNow);
    check('the first finish runs and is kept; the second is read — every array byte for byte, every number bit for bit', !first.cached && again.cached && builds === 1
        && differ(again.page.raster, first.page.raster) === null && differ(again.page.rivers, first.page.rivers) === null && differ(again.page.climate, first.page.climate) === null && differ(again.cells, first.cells) === null && differ(again.page.stats, first.page.stats) === null,
        `${(FC.listEntries()[0].bytes / 1e6).toFixed(1)} MB at ${CELLS.toLocaleString()} cells, ${WIDTH} px`);
    const other = FC.nodeKey({ history: historyKeyOf(frame), timeMyr: TIME, cells: CELLS, width: WIDTH, climate: { greenhouseWm2: 4 } });
    check('another setting is another entry: a miss', other.key !== key && !FC.isComplete(other.key));
    fs.writeFileSync(FC.partPath(key, 'page'), Buffer.alloc(10));
    const rebuilt = await FC.finishCached(spec, key, finishNow);
    check('a damaged entry is finished again in its place, and the same picture comes back', !rebuilt.cached && builds === 2 && differ(rebuilt.page.raster, first.page.raster) === null && FC.isComplete(key));
    // (the key leaves the finish's pool size out: check that a pool of one finishes to the same bytes)
    const one = await finishNow(1);
    check('a pool of one worker finishes the same moment to the same bytes (the pool size is rightly not in the key)', differ(one.page.raster, first.page.raster) === null && differ(one.cells, first.cells) === null, differ(one.page.raster, first.page.raster) ?? differ(one.cells, first.cells) ?? 'identical');
    const loaded = await FC.loadFinish(key, { mesh: true });
    check('loadFinish builds the finish\'s mesh again from its detail: one cell per z', loaded.mesh.numCells === loaded.cells.z.length && loaded.cells.numCells === loaded.mesh.numCells, `${loaded.mesh.numCells.toLocaleString()} cells for a detail of ${CELLS.toLocaleString()}`);
}

// ── several processes at once ──
section('several processes');
{
    const script = path.join(TMP, 'racer.mjs');
    fs.writeFileSync(script, `import * as FC from ${JSON.stringify(path.join(here, 'lib', 'finish-cache.mjs'))};
const key = process.argv[2], spec = { cells: 3 };
const r = await FC.finishCached(spec, key, async () => { await new Promise(r => setTimeout(r, 1500)); return { page: { raster: { w: 1, h: 1, heightM: new Int16Array([${process.pid % 1000}]) }, stats: { pid: process.pid } }, cells: { z: new Float32Array([1]) } }; });
console.log(JSON.stringify({ cached: r.cached, pid: r.page.stats.pid }));`);
    const run = k => new Promise(res => { let out = ''; const c = spawn(process.execPath, [script, k], { env: process.env }); c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; }); c.on('close', code => res({ code, out })); });
    const k = 'e'.repeat(32), rs = await Promise.all([run(k), run(k), run(k)]);
    const parsed = rs.map(r => { try { return JSON.parse(r.out.trim().split('\n').at(-1)); } catch { return null; } });
    check('three processes asking for one finish at once: one finishes it, the others wait and read the same one', parsed.every(Boolean) && parsed.filter(p => !p.cached).length === 1 && new Set(parsed.map(p => p.pid)).size === 1,
        rs.map(r => r.out.trim()).join(' | '));
}

// ── the page's path: the dev server ──
section('the dev server (the page\'s path)');
{
    const port = 18000 + (process.pid % 1000);
    const server = spawn(process.execPath, [path.join(ROOT, 'tuning', 'dev-server.mjs'), String(port)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise(res => { server.stdout.on('data', res); setTimeout(res, 3000); });
    const at = p => `http://127.0.0.1:${port}${p}`;
    try {
        const code = await (await fetch(at('/api/finish/code'))).json(), served = await (await fetch(at('/v2/js/app/finish-code.js'))).text();
        check('it serves the finish code\'s hash, and finish-code.js with that hash written in', code.code === FC.finishCodeHash(ROOT).hash && served.includes(`"${code.code}"`), code.code);
        const key = 'd'.repeat(32), page = { raster: { w: 2, h: 1, heightM: new Int16Array([1, -1]) }, stats: { erodeOn: 'Apple M1' } }, cells = { numCells: 1, z: new Float32Array([0.5]) };
        const spec = finishSpec({ history: 'a'.repeat(32), timeMyr: 1, code: code.code, cells: 1, width: 2, host: 'page', math: 'x', erosion: 'gpu' });
        const post = (what, body, extra = '') => fetch(at(`/api/finish/${what}?key=${key}${extra}`), { method: 'POST', body });
        await post('begin', JSON.stringify({ spec }));
        check('an entry under upload is not served', (await fetch(at(`/api/finish/page?key=${key}`))).status === 404);
        const up = {};
        for (const [part, tree] of [['page', page], ['cells', cells]]) { const raw = treeBytes(tree); up[part] = (await post('part', zlib.deflateSync(raw), `&part=${part}&raw=${raw.length}`)).ok; }
        const bad = treeBytes(page), wrong = await post('part', zlib.deflateSync(bad), `&part=page&raw=${bad.length + 1}`);
        check('a part whose length is not what the page counted is refused', !wrong.ok);
        await post('done', '{}');
        const got = await fetch(at(`/api/finish/page?key=${key}`)), tree = got.ok ? readTree(new Uint8Array(await got.arrayBuffer())) : null;
        check('a part uploaded deflated is kept whole: served back, the very tree the page sent', up.page && up.cells && tree && differ(tree, page) === null);
        const fin = await FC.loadFinish(key);
        check('…and a Node tool reads the page\'s entry: its cells and its spec as the page keyed it', fin && differ(fin.cells, cells) === null && finishKey(fin.spec) === finishKey(spec) && fin.meta.builtBy === 'evolution page');
        await fetch(at('/api/history/view'), { method: 'POST', body: JSON.stringify({ key: 'a'.repeat(32), timeMyr: 1, finish: key }) });
        const latest = await FC.loadLatestFinish();
        check('the view the page posts names the finish on screen in latest.json, with its spec, and loadLatestFinish loads it', latest?.key === key && latest.latest.finishSpec?.host === 'page' && differ(latest.raster, page.raster) === null);
        check('a malformed key is refused', (await fetch(at('/api/finish/page?key=nothex'))).status === 400);
    } finally { server.kill(); }
}

// ── eviction ──
section('eviction');
{
    const entries = FC.listEntries(), total = entries.reduce((s, e) => s + e.bytes, 0), oldest = entries.at(-1);
    const r = FC.gc({ capBytes: total - 1 });
    check('over the cap, the entry used longest ago goes first, and only as many as must', r.removed.length === 1 && r.removed[0] === oldest.key, `${entries.length} entries, ${(total / 1e6).toFixed(1)} MB → removed ${r.removed.length}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
finish('Finish cache');
