// The real thing, end to end: the Evolution page in the installed Chrome, a history built, a moment chosen and Add detail pressed,
// with what the finish's worker reports (stage times, the device erosion ran on) and the browser's memory, its processes' peak.
//   node v2/tools/gpu-detail.mjs [--seed 831576] [--cont 30] [--sim 40000] [--time 310] [--cells 2500000] [--headed] [--chrome PATH] [--no-memory] [--no-gpu: Chrome started with WebGPU off, for the CPU path]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './gpu-harness/browser.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }, has = k => process.argv.includes(k);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEED = arg('--seed', '831576'), CONT = arg('--cont', '30'), SIM = arg('--sim', '40000'), TIME = arg('--time', '310'), CELLS = arg('--cells', '2500000'), PORT = Number(arg('--port', 8000 + (process.pid % 900)));
const server = spawn(process.execPath, [path.join(ROOT, 'tuning/dev-server.mjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-detail-'));
const context = await chromium.launchPersistentContext(profile, { channel: arg('--chrome') ? undefined : 'chrome', executablePath: arg('--chrome'), headless: !has('--headed'), viewport: { width: 1400, height: 900 },
    args: has('--no-gpu') ? ['--disable-features=WebGPU', '--disable-unsafe-webgpu'] : ['--enable-unsafe-webgpu', ...(process.platform === 'win32' ? ['--enable-features=D3D12'] : [])] });
const page = context.pages()[0] ?? await context.newPage();
let history, finish = null, failed = null;
const seen = new Promise(r => { history = r; });
page.on('console', async m => {
    const text = m.text();
    if (text.startsWith('[evolution] history:')) { console.log(text); history(); }
    if (text.startsWith('[evolution] finish of')) { const args = await Promise.all(m.args().map(a => a.jsonValue().catch(() => null))); finish = { line: args[0], ms: args[1] }; }
    if (m.type() === 'error' || /WebGPU/.test(text)) console.log(`page ${m.type()}:`, text.slice(0, 400));
});
page.on('pageerror', e => { failed = e.message; console.log('page error:', e.message); });
page.on('crash', () => { failed = 'page crashed'; console.log('page crashed'); });

// (the browser's processes: this profile's, and their children; top's MEM is the physical footprint, GPU memory of a Mac's included, as ps's RSS is not)
const peak = { total: 0, at: '', byKind: {} };
let stage = 'history';
const sample = () => {
    if (process.platform !== 'darwin') return;
    const rows = execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n').map(l => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return { pid: +m[1], ppid: +m[2], cmd: m[3] }; });
    const main = rows.find(r => r.cmd.includes(profile) && !r.cmd.includes('--type='));
    if (!main) return;
    const ours = new Map([[main.pid, 'browser']]);
    for (let grew = true; grew;) { grew = false; for (const r of rows) if (!ours.has(r.pid) && ours.has(r.ppid)) { ours.set(r.pid, r.cmd.match(/--utility-sub-type=([\w.]+)/)?.[1] ?? r.cmd.match(/--type=([\w-]+)/)?.[1] ?? 'other'); grew = true; } }
    const mem = execFileSync('top', ['-l', '1', '-stats', 'pid,mem'], { encoding: 'utf8', maxBuffer: 1 << 26 }), units = { B: 1, K: 2 ** 10, M: 2 ** 20, G: 2 ** 30 };
    let total = 0;
    const kind = {};
    for (const l of mem.split('\n')) { const m = l.trim().match(/^(\d+)\s+([\d.]+)([BKMG])\+?-?$/); if (m && ours.has(+m[1])) { const v = m[2] * units[m[3]], k = ours.get(+m[1]); total += v; kind[k] = (kind[k] ?? 0) + v; } }
    if (total > peak.total) { peak.total = total; peak.at = stage; }
    for (const [k, v] of Object.entries(kind)) if (v > (peak.byKind[k] ?? 0)) peak.byKind[k] = v;
};
const sampler = has('--no-memory') ? null : setInterval(() => { try { sample(); } catch { /* a process gone between ps and top */ } }, 4000);

await page.goto(`http://127.0.0.1:${PORT}/evolution.html?seed=${SEED}&cont=${CONT}&sim=${SIM}&terrain=160000&save=0`);
console.log('machine', os.hostname(), 'load', os.loadavg()[0].toFixed(1), JSON.stringify(await page.evaluate(() => ({ gpu: !!navigator.gpu, ua: navigator.userAgent }))));
const t0 = performance.now();
await Promise.race([seen, new Promise((_, no) => setTimeout(() => no(new Error('no history in 15 min')), 9e5))]);
console.log(`history ${((performance.now() - t0) / 1000).toFixed(0)} s`);
await page.evaluate(([t, cells]) => {
    const s = document.getElementById('timeSlider'), c = document.getElementById('finishCells');
    const play = document.getElementById('playBtn');
    if (play.textContent.includes('\u23F8')) play.click();                        // (the page plays on once a history is built)
    s.value = t; s.dispatchEvent(new Event('input', { bubbles: true }));
    c.value = cells; c.dispatchEvent(new Event('change', { bubbles: true }));
}, [TIME, CELLS]);
// (the moment painted, not only the slider moved: the button finishes what is painted)
await page.waitForFunction(t => { const b = document.getElementById('cardAction'); return b && !b.disabled && /Add detail/.test(b.textContent) && document.getElementById('cardTitle').textContent.startsWith(`${t} Myr`); }, TIME, { timeout: 120000 });
await page.waitForTimeout(1500);
stage = 'finish';
const t1 = performance.now();
await page.evaluate(() => document.getElementById('cardAction').click());
const deadline = Number(arg('--timeout', 1800)) * 1000;
while (!finish && !failed && performance.now() - t1 < deadline) {
    await page.waitForTimeout(1000);
    const note = await page.evaluate(() => document.getElementById('cardText')?.textContent ?? '').catch(() => '');
    if (/Could not add detail|Not enough memory/.test(note)) failed = note;
    }
if (sampler) { clearInterval(sampler); try { sample(); } catch { /* as above */ } }
console.log(finish ? finish.line : `FAILED: ${failed ?? 'timed out'}`);
if (finish) console.log(JSON.stringify(finish.ms));
if (has('--shot')) await page.screenshot({ path: arg('--shot') });
console.log(`seconds from the press ${((performance.now() - t1) / 1000).toFixed(1)}`);
if (peak.total) console.log(`memory peak ${(peak.total / 2 ** 30).toFixed(2)} GB, during ${peak.at}; each kind's own peak ${JSON.stringify(Object.fromEntries(Object.entries(peak.byKind).map(([k, v]) => [k, +(v / 2 ** 30).toFixed(2)])))}`);
await context.close(); server.kill(); fs.rmSync(profile, { recursive: true, force: true });
process.exit(finish ? 0 : 1);
