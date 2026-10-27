// Every check suite, a few at a time, then two summaries: the hard checks (which fail a run) suite by suite, and the
// Earth-likeness report — every report() line of every suite, against Earth's range, the ones outside it flagged ⚑.
// Usage: node v2/tools/run-checks.mjs [suite …] [--jobs 4]      (suite: invariants, phase6, scale, …; default all)
// On a machine shared through sim-slots (a CPU/memory semaphore on PATH; machine-local, not in this repo) each suite waits
// for its own slots — TERRAIN_SLOTS and 3 GB for the suites that build terrain; 1 slot and 2 GB for the rest, which run on one core (measured
// 1.0–1.3 cores and ~1.4 GB each, 2026-10-23) — and is told its share as
// SIM_THREADS, which sizes its pools; not when run-checks itself was given SIM_THREADS (it already holds its slots).
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), jobsAt = args.indexOf('--jobs');
const jobs = jobsAt >= 0 ? Number(args.splice(jobsAt, 2)[1]) : 4;
const all = readdirSync(here).filter(f => /^check-.*\.mjs$/.test(f)).map(f => f.slice(6, -4));
const suites = args.length ? args : all;
const slots = !process.env.SIM_THREADS && spawnSync('sh', ['-c', 'command -v sim-slots'], { encoding: 'utf8' }).stdout.trim();
const TERRAIN_SLOTS = 4, terrainSuites = new Set(['phase8a', 'phase8b', 'lab', 'basins']);
const reportFile = join(tmpdir(), `orogen-reports-${process.pid}.jsonl`);
writeFileSync(reportFile, '');

const results = [];
async function runOne(name) {
    const t0 = performance.now();
    const out = await new Promise(resolve => {
        let text = '';
        const cmd = [process.execPath, join(here, `check-${name}.mjs`)];
        const [exe, ...argv] = slots ? [slots, 'run', '-n', String(terrainSuites.has(name) ? TERRAIN_SLOTS : 1), '--gb', terrainSuites.has(name) ? '3' : '2', '--who', `checks:${name}`, '--', ...cmd] : cmd;
        const child = spawn(exe, argv, { env: { ...process.env, REPORT_JSON: reportFile } });
        child.stdout.on('data', d => { text += d; });
        child.stderr.on('data', d => { text += d; });
        child.on('close', code => resolve({ text, code }));
    });
    const last = out.text.trim().split('\n').at(-1);
    const fails = out.text.split('\n').filter(l => l.startsWith('FAIL'));
    results.push({ name, code: out.code, last, fails, s: (performance.now() - t0) / 1000 });
    console.log(`${out.code === 0 ? 'ok  ' : 'FAIL'}  ${name.padEnd(11)} ${((performance.now() - t0) / 1000).toFixed(0).padStart(4)} s  ${last}`);
}
const queue = [...suites];
await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await runOne(queue.shift()); }));

const failed = results.filter(r => r.code !== 0);
console.log(`\n── hard checks ──\n${failed.length ? failed.map(r => `${r.name}:\n${r.fails.map(l => `  ${l}`).join('\n') || `  ${r.last}`}`).join('\n') : 'all suites pass'}`);
const reports = existsSync(reportFile) ? readFileSync(reportFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
rmSync(reportFile, { force: true });
console.log(`\n── Earth-likeness (${reports.length} reported, ${reports.filter(r => !r.inside).length} outside Earth's range) ──`);
const fmt = (v, r) => (Number.isFinite(v) ? Number(v.toPrecision(3)) : v) + (r.unit ?? '');
for (const r of reports) {
    const earth = r.earth ? `Earth ${fmt(r.earth[0], r)}–${fmt(r.earth[1], r)}` : 'no Earth figure';
    console.log(`${r.inside ? '  ' : '⚑ '}${r.suite.replace(/^check-|\.mjs$/g, '').padEnd(11)} ${r.name}: ${r.values.map(v => fmt(v, r)).join(' · ')}  (${earth}${r.source ? `; ${r.source}` : ''})`);
}
process.exitCode = failed.length ? 1 : 0;
