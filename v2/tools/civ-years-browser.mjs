// The famine's years kernel (civ/years-gpu.js) in Chrome's WebGPU, in a module worker as the page runs it (civ-worker.js
// opens its own device), against Dawn's in Node on the same fixed records (lib/civ-years-fixture.js): bit for bit on one
// machine, as gpu-browser.mjs does for erosion. Chrome by Playwright, headless.
//   node v2/tools/civ-years-browser.mjs [--chrome PATH] [--headed]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './gpu-harness/browser.mjs';
import { gpu } from './gpu-harness/dawn.mjs';
import { civGPU } from '../js/civ/civ-gpu.js';
import { runFixture } from './lib/civ-years-fixture.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' };
const server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const dawn = await runFixture(await civGPU(gpu));
const browser = await chromium.launch({ channel: arg('--chrome') ? undefined : 'chrome', executablePath: arg('--chrome'), headless: !process.argv.includes('--headed'), args: ['--enable-unsafe-webgpu', ...(process.platform === 'win32' ? ['--enable-features=D3D12'] : [])] });
let code = 1;
try {
    const page = await browser.newPage();
    await page.goto(`${base}/v2/tools/gpu-page.html`);
    const got = await page.evaluate(url => new Promise(res => { const w = new Worker(url, { type: 'module' }); w.onmessage = ({ data }) => res(data.error ? data : { out: Array.from(data.out), info: data.info }); w.onerror = e => res({ error: e.message }); w.postMessage(0); }), `${base}/v2/tools/lib/civ-years-worker.js`);
    if (got.error) throw new Error(`Chrome's worker: ${got.error}`);
    const chrome = Float32Array.from(got.out);
    let diff = 0, maxRel = 0;
    for (let i = 0; i < dawn.length; i++) if (!Object.is(dawn[i], chrome[i])) { diff++; maxRel = Math.max(maxRel, Math.abs(dawn[i] - chrome[i]) / Math.max(1e-30, Math.abs(dawn[i]))); }
    const famines = Array.from({ length: dawn.length / 4 }, (_, j) => dawn[4 * j + 2] > 0).filter(Boolean).length;
    console.log(`civ years: Chrome's worker (${got.info}) vs Dawn, ${dawn.length / 4} records (${famines} with a famine): ${diff ? `${diff} values differ, max rel ${maxRel.toExponential(2)}` : 'bit for bit'}`);
    code = diff ? 2 : 0;
} finally { await browser.close(); server.close(); }
process.exit(code);
