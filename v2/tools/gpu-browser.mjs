// The cross-check: the same kernels on the same fixture in Dawn and in the installed Chrome (headless, by Playwright), compared
// bit for bit on this machine, with their timings. Users run Chrome's WebGPU, not Dawn's Node binding.
//   node v2/tools/gpu-browser.mjs --dir FIXTURE [--runs 0,1,2,3] [--reps 2] [--chrome PATH] [--headed]
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './gpu-harness/browser.mjs';
import { gpu } from './gpu-harness/dawn.mjs';
import { erodeGPU } from '../js/gpu/erode-gpu.js';
import { openDevice } from '../js/gpu/gpu-device.js';
import { loadRun } from './gpu-fixture.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }, has = k => process.argv.includes(k);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), DIR = path.resolve(arg('--dir')), RUNS = arg('--runs', '0,1,2,3').split(',').map(Number), REPS = Number(arg('--reps', 2));
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }, results = new Map();
const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url.startsWith('/result/')) { const parts = []; req.on('data', d => parts.push(d)); req.on('end', () => { results.set(Number(url.slice(8)), Buffer.concat(parts)); res.end('ok'); }); return; }
    const file = url.startsWith('/fixture/') ? path.join(DIR, url.slice(9)) : path.join(ROOT, url);
    if (url === '/favicon.ico' || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: arg('--chrome') ? undefined : 'chrome', executablePath: arg('--chrome'), headless: !has('--headed'), args: ['--enable-unsafe-webgpu', ...(process.platform === 'win32' ? ['--enable-features=D3D12'] : [])] });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('page:', m.text()); });
page.on('pageerror', e => console.log('page error:', e.message));
await page.goto(`${base}/v2/tools/gpu-page.html`);
await page.waitForFunction('window.ready === true', null, { timeout: 60000 });
console.log('machine', os.hostname(), 'load', os.loadavg()[0].toFixed(1), 'chrome', JSON.stringify(await page.evaluate('adapterInfo()')));
const opened = await openDevice(gpu);
console.log('dawn', JSON.stringify(opened.info.description));
for (const id of RUNS) {
    const b = await page.evaluate(([i, r]) => window.runFixture(i, r), [id, REPS]);
    const { o, P } = loadRun(DIR, id), start = o.z.slice();
    let d = null;
    for (let r = 0; r < REPS; r++) { o.z.set(start); const t = performance.now(), R = await erodeGPU(gpu, o, P, { device: opened }), total = performance.now() - t; if (!d || total < d.total) d = { total, ms: R.ms }; }
    const zb = results.get(id), z = new Float32Array(zb.buffer.slice(zb.byteOffset, zb.byteOffset + zb.length));
    let differ = 0, top = 0;
    for (let c = 0; c < z.length; c++) if (z[c] !== o.z[c]) { differ++; const v = Math.abs(z[c] - o.z[c]); if (v > top) top = v; }
    console.log(JSON.stringify({ run: id, n: o.mesh.numCells, chromeS: +(b.total / 1000).toFixed(2), dawnS: +(d.total / 1000).toFixed(2), chrome: b.ms, dawn: d.ms, cellsDiffering: differ, maxKm: top }));
}
await browser.close(); server.close();
process.exit(0);
