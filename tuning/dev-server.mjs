/**
 * Minimal static dev server that mimics the production host's clean URLs
 * (so `/import` resolves to `import.html`, matching orogen.studio).
 *
 * It also feeds the machine's history cache (v2/tools/lib/history-cache.mjs): it serves v2/js/app/history-code.js with
 * the hash of the history code it is serving written in (so the Evolution page's worker, which imports it, saves its
 * history under the code it actually loaded), and takes the history the page uploads as it builds it:
 *   GET  /api/history/code                 {code, files}: the hash of the history code as served now
 *   POST /api/history/begin?key=…          {key, spec}: a history starts (its entry's meta.json)
 *   POST /api/history/frame?key=…          a frame's bytes (v2/js/app/frame-wire.js), compressed and kept
 *   POST /api/history/done?key=…           {time, steps, stopped}: a run (or a run-on) ended
 *   POST /api/history/view                 what the user is looking at → the cache's latest.json (with `finish`: the
 *                                          finished moment on screen, a finish-cache key — its spec noted there too)
 * and the finish cache (v2/tools/lib/finish-cache.mjs) the same way: it serves v2/js/app/finish-code.js with the hash of
 * the finish code, and the finish worker looks up and keeps the moments it finishes (v2/js/finish/finish-worker.js):
 *   GET  /api/finish/code                  {code, files}: the hash of the finish code as served now
 *   GET  /api/finish/page?key=…            a whole entry's page part (app/finish-wire.js bytes), checked; 404: not there
 *   POST /api/finish/begin?key=…           {spec, …}: a finished moment is coming (meta.json, state 'uploading')
 *   POST /api/finish/part?key=…&part=page|cells&raw=N   a part, deflated (zlib) by the worker: checked and kept
 *   POST /api/finish/done?key=…            the entry is whole (state 'complete')
 *   POST /api/finish/has                   {keys: […]} → {has: […]}: those whole in the cache (the timeline's marks of the
 *                                          moments kept in detail: evolution-main.js knownDetail)
 * Only from this machine (loopback). JavaScript is served with Cache-Control: no-cache, so a new worker never runs a
 * module the browser kept from before an edit.
 *
 * Usage:  node tuning/dev-server.mjs [port]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyCodeHash, putFrameAsync, writeMeta, readMeta, writeLatest, gcSometimes, CACHE_DIR } from '../v2/tools/lib/history-cache.mjs';
import * as FC from '../v2/tools/lib/finish-cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.argv[2] || 8000);

const MIME = {
    '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain',
    '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
};

function resolveFile(urlPath) {
    let p = decodeURIComponent(new URL(urlPath, 'http://x').pathname);
    if (p === '/' || p === '') p = '/index.html';
    const candidates = [p];
    if (!path.extname(p)) { candidates.push(p + '.html', path.join(p, 'index.html')); }
    for (const c of candidates) {
        const fp = path.join(ROOT, c);
        if (fp.startsWith(ROOT) && fs.existsSync(fp) && fs.statSync(fp).isFile()) return fp;
    }
    return null;
}

const HISTORY_CODE_FILE = '/v2/js/app/history-code.js', FINISH_CODE_FILE = '/v2/js/app/finish-code.js', KEY = /^[0-9a-f]{32}$/, MAX_BODY = 512e6, MAX_FINISH_BODY = 2e9;
const loopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const body = (req, max = MAX_BODY) => new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > max) { reject(new Error('too large')); req.destroy(); } else parts.push(d); });
    req.on('end', () => resolve(Buffer.concat(parts))); req.on('error', reject);
});
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

async function historyApi(req, res, url) {
    if (!loopback(req)) return json(res, 403, { error: 'only from this machine' });
    const what = url.pathname.slice('/api/history/'.length), key = url.searchParams.get('key');
    if (what === 'code' && req.method === 'GET') { const h = historyCodeHash(ROOT); return json(res, 200, { code: h.hash, files: h.files.length, cache: CACHE_DIR }); }
    if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
    const data = await body(req);
    if (what === 'view') {
        const view = JSON.parse(data.toString('utf8'));
        if (!KEY.test(view.key ?? '')) return json(res, 400, { error: 'key' });
        if (view.finish != null && !KEY.test(view.finish)) return json(res, 400, { error: 'finish' });
        writeLatest({ ...view, at: new Date().toISOString(), server: { port: PORT, root: ROOT }, meta: readMeta(view.key)?.spec ?? null,
            finishSpec: view.finish ? FC.readMeta(view.finish)?.spec ?? null : null });
        return json(res, 200, { ok: true });
    }
    if (!KEY.test(key ?? '')) return json(res, 400, { error: 'key' });
    if (what === 'begin') { const { spec } = JSON.parse(data.toString('utf8')); writeMeta(key, { code: spec?.code, spec, builtBy: 'evolution page', builtAt: new Date().toISOString() }); return json(res, 200, { ok: true }); }
    if (what === 'frame') { const r = await putFrameAsync(key, new Uint8Array(data.buffer, data.byteOffset, data.byteLength)); return json(res, 200, { ok: true, time: r.time, bytes: r.bytes }); }
    if (what === 'done') {
        const d = JSON.parse(data.toString('utf8'));
        writeMeta(key, { steps: { [Math.round(d.time * 1000)]: d.steps }, ...(d.stopped ? { stoppedAt: d.time } : {}), builtToMyr: Math.max(d.time, readMeta(key)?.builtToMyr ?? 0) });
        gcSometimes();
        return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'unknown' });
}

async function finishApi(req, res, url) {
    if (!loopback(req)) return json(res, 403, { error: 'only from this machine' });
    const what = url.pathname.slice('/api/finish/'.length), key = url.searchParams.get('key');
    if (what === 'code' && req.method === 'GET') { const h = FC.finishCodeHash(ROOT); return json(res, 200, { code: h.hash, files: h.files.length, cache: FC.CACHE_DIR }); }
    if (!FC.ENABLED) return json(res, 404, { error: 'the finish cache is off' });
    // (many keys at once — a history's every moment at the page's settings: only looked at, not marked used)
    if (what === 'has' && req.method === 'POST') {
        const keys = JSON.parse((await body(req, 4e6)).toString('utf8')).keys;
        if (!Array.isArray(keys) || keys.length > 1e5 || !keys.every(k => KEY.test(k))) return json(res, 400, { error: 'keys' });
        return json(res, 200, { has: keys.filter(k => FC.isComplete(k)) });
    }
    if (!KEY.test(key ?? '')) return json(res, 400, { error: 'key' });
    if (what === 'page' && req.method === 'GET') {
        const raw = FC.isComplete(key) ? await FC.readPartBytesAsync(key, 'page') : null;
        if (!raw) return json(res, 404, { error: 'not there' });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': raw.length, 'Cache-Control': 'no-store' });
        return res.end(raw);
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
    const data = await body(req, MAX_FINISH_BODY);
    if (what === 'begin') {
        const info = JSON.parse(data.toString('utf8'));
        FC.writeMeta(key, { ...info, state: 'uploading', at: new Date().toISOString(), builtBy: 'evolution page' });
        return json(res, 200, { ok: true });
    }
    if (what === 'part') {
        const r = await FC.putPartDeflated(key, url.searchParams.get('part'), data, Number(url.searchParams.get('raw')));
        return json(res, 200, { ok: true, ...r });
    }
    if (what === 'done') {
        if (!FC.PARTS.every(p => fs.existsSync(FC.partPath(key, p)))) return json(res, 400, { error: 'a part is missing' });
        FC.writeMeta(key, { state: 'complete', completedAt: new Date().toISOString() });
        FC.gcSometimes();
        return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'unknown' });
}

/** A code-hash module, served with the hash of the code as it is now (null: served as committed, nothing saved). */
function serveCode(res, name, what, hashOf) {
    let code = null;
    try { code = hashOf(); } catch { /* (served as committed: null, nothing saved) */ }
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
    res.end(`// Written by tuning/dev-server.mjs: the hash of the ${what} code it served at ${new Date().toISOString()}.\nexport const ${name} = ${JSON.stringify(code)};\n`);
}

http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const fail = err => { if (!res.headersSent) json(res, 400, { error: String(err.message) }); };
    if (u.pathname.startsWith('/api/history/')) { historyApi(req, res, u).catch(fail); return; }
    if (u.pathname.startsWith('/api/finish/')) { finishApi(req, res, u).catch(fail); return; }
    if (u.pathname === HISTORY_CODE_FILE) return serveCode(res, 'HISTORY_CODE', 'history', () => historyCodeHash(ROOT).hash);
    if (u.pathname === FINISH_CODE_FILE) return serveCode(res, 'FINISH_CODE', 'finish', () => FC.finishCodeHash(ROOT).hash);
    // a directory asked for without its trailing slash (/v2) → redirect to /v2/, as the production host does,
    // so the page's relative links resolve inside the directory
    const url = new URL(req.url, 'http://x'), dir = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!url.pathname.endsWith('/') && dir.startsWith(ROOT) && fs.existsSync(dir) && fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'index.html'))) {
        res.writeHead(301, { Location: url.pathname + '/' + url.search }); res.end(); return;
    }
    const fp = resolveFile(req.url);
    if (!fp) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 Not Found'); return; }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...(ext === '.js' || ext === '.mjs' ? { 'Cache-Control': 'no-cache' } : {}) });
    fs.createReadStream(fp).pipe(res);
}).listen(PORT, () => console.log(`World Orogen dev server → http://localhost:${PORT}  (clean URLs, /import works)`));
