// The famine's years, GPU against CPU (lane civgpu2; Jackson's ruling 2026-11-26: judged by distributions): the civ layer's
// standing check that civ/years-gpu.js lives the years as sim.js's float64 reference does, as the finish keeps its CPU
// versions as checks. On one world, two runs:
//   · the GPU's, with each step's years also lived on the CPU from the same start (sim.js yearsCheck): the kernel's own
//     error, per cell and step — the store's |Δ|, the people's relative |Δ|, famines on one side only, the dead;
//   · the CPU's, the whole run: where the two runs end up at 0 BP — each cell's people (the frames' density bytes), way of
//     life and famine deaths, the totals over time, the towns and polities. Float32 against float64 at the famine's
//     thresholds compounds through the economy, so this measures how far the run drifts, not the kernel's error.
//
//   node --max-old-space-size=8000 v2/tools/civ-years-check.mjs --world <kept finish .bin> [--civ 160000] [--end bp]
//   … --key <finish key>       a cached page finish's civ world (as civ-fingerprint.mjs)
//   … --engines gpu|cpu|gpu,cpu (default both), --emit (each run's 0 BP cells, as one CELLS line: for another machine)
//   node v2/tools/civ-years-check.mjs --compare a.log b.log   two machines' CELLS lines, per engine (e.g. Metal vs D3D12)
// Needs Dawn for the GPU (v2/tools/gpu-harness); the world's file is read only.

import fs from 'node:fs';
import path from 'node:path';
import { meshFromArrays } from '../js/core/sim-mesh.js';
import { civSubstrate } from '../js/civ/substrate.js';
import { runCivSim, byteDensity, LIFE_NAMES } from '../js/civ/sim.js';
import { climateVariability } from '../js/civ/climate-var.js';
import { CIV } from '../js/civ/civ-config.js';
import { civEngine, yearsCheckLine } from './lib/civ-engine.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const q = (xs, p) => { if (!xs.length) return 0; const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const quants = xs => Object.fromEntries([0.5, 0.9, 0.99, 1].map(p => [`p${p * 100}`, +q(xs, p).toPrecision(3)]));

/** Two runs' 0 BP cells: { density: bytes, life, famine (per cell, summed share), land }, compared. */
function cellDiff(a, b, land) {
    let peopled = 0, same = 0, d1 = 0, d5 = 0, more = 0, lifeSame = 0, onlyA = 0, onlyB = 0;
    const famine = [], rel = [];
    for (let c = 0; c < a.density.length; c++) {
        if (!land[c]) continue;
        const x = a.density[c], y = b.density[c];
        if (!x && !y) continue;
        peopled++;
        if (x && !y) onlyA++; else if (y && !x) onlyB++;
        const dq = Math.abs(x - y); if (!dq) same++; else if (dq <= 1) d1++; else if (dq <= 5) d5++; else more++;
        if (x && y) rel.push(Math.abs(byteDensity(x) - byteDensity(y)) / byteDensity(x));
        if (a.life[c] === b.life[c]) lifeSame++;
        if (a.famine[c] > 0 || b.famine[c] > 0) famine.push(Math.abs(a.famine[c] - b.famine[c]));
    }
    return { peopledCells: peopled, densityByte: { same: +(same / peopled).toFixed(4), off1: +(d1 / peopled).toFixed(4), off2to5: +(d5 / peopled).toFixed(4), more: +(more / peopled).toFixed(4) },
        peopledOnOneSide: { first: onlyA, second: onlyB }, densityRel: quants(rel), lifeSame: +(lifeSame / peopled).toFixed(4), famineShareAbs: quants(famine) };
}
/** A run's summary at 0 BP (mesh-probe.mjs's): people by way of life, the famine's dead, towns, polities, centres. */
function summary(r, w, sub) {
    const last = r.frames.at(-1), A = sub.cellKm2, byLife = {};
    for (let c = 0; c < w.mesh.numCells; c++) if (!w.ocean[c] && !w.lake[c] && last.density[c]) { const l = LIFE_NAMES[last.life[c]]; byLife[l] = (byLife[l] ?? 0) + byteDensity(last.density[c]) * A; }
    const M = x => +(x / 1e6).toFixed(2);
    let townPop = 0; const T = last.towns; if (T) for (let k = 0; k < T.length; k += 5) townPop += T[k + 2];
    return { bp: last.bp, peopleM: M(last.people), farmersM: M(last.farmers), byLifeM: Object.fromEntries(Object.entries(byLife).map(([k, v]) => [k, M(v)])),
        famineDeadM: M(r.totals.reduce((s, x) => s + x.famineDead, 0)), towns: T ? T.length / 5 : 0, townPopM: M(townPop), polities: last.polities, centres: r.centres.length,
        firstFarmBP: Math.max(...Array.from(r.farmBP).filter(x => x === x), -Infinity) };
}
const cellsOf = (r, w) => ({ density: r.frames.at(-1).density, life: r.frames.at(-1).life, famine: r.famine ?? new Float32Array(w.mesh.numCells) });
const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const unb64 = (s, T) => { const b = Buffer.from(s, 'base64'); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

if (process.argv.includes('--compare')) {
    const i = process.argv.indexOf('--compare'), files = process.argv.slice(i + 1, i + 3);
    const read = f => Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('CELLS ')).map(l => JSON.parse(l.slice(6))).map(x => [x.engine, x]));
    const [A, B] = files.map(read);
    for (const e of Object.keys(A)) if (B[e]) {
        const un = x => ({ density: unb64(x.density, Uint8Array), life: unb64(x.life, Uint8Array), famine: unb64(x.famine, Float32Array) });
        console.log(`${e}: ${path.basename(files[0])} (${A[e].label}) vs ${path.basename(files[1])} (${B[e].label})`);
        console.log('  cells', JSON.stringify(cellDiff(un(A[e]), un(B[e]), unb64(A[e].land, Uint8Array))));
        console.log('  ', JSON.stringify(A[e].summary)); console.log('  ', JSON.stringify(B[e].summary));
    }
    process.exit(0);
}

let label, w;
if (arg('--world', null)) { const { worldOfFile } = await import('./lib/civ-frozen-world.mjs'); label = `${path.basename(arg('--world'))}@${arg('--civ', 'own')}`; w = worldOfFile(arg('--world'), Number(arg('--civ', 0)) || null); }
else if (arg('--key', null)) {
    const { loadFinish } = await import('./lib/finish-cache.mjs'), fin = await loadFinish(arg('--key'), { cells: false });
    if (!fin?.civ) throw new Error(`${arg('--key')}: no cached page finish with civ`);
    label = arg('--key').slice(0, 8); w = { ...fin.civ, mesh: meshFromArrays(fin.civ.mesh) };
} else throw new Error('--world <file> or --key <finish key>');
const engines = arg('--engines', 'gpu,cpu').split(','), END = Number(arg('--end', 0)), C = CIV;
const sub = civSubstrate(w, C), vary = climateVariability(w, sub, C), land = Uint8Array.from({ length: w.mesh.numCells }, (_, c) => (!w.ocean[c] && !w.lake[c] ? 1 : 0));
const runs = {};
for (const engine of engines) {
    const E = await civEngine(engine === 'cpu' ? ['--cpu'] : ['--check']), t0 = performance.now();
    const r = await runCivSim(w, sub, { C, endBP: END, vary, gpu: E.gpu, yearsCheck: E.yearsCheck });
    const secs = (performance.now() - t0) / 1000, S = summary(r, w, sub);
    runs[engine] = { r, S };
    console.log(`${label} ${engine} (${E.label}): ${secs.toFixed(0)} s${E.yearsCheck ? ' (the CPU years too)' : ''}`, JSON.stringify(S));
    if (r.yearsCheck) console.log('  ', yearsCheckLine(r.yearsCheck));
    if (process.argv.includes('--emit')) { const x = cellsOf(r, w); console.log('CELLS ' + JSON.stringify({ engine, label: `${label} ${E.label}`, summary: S, land: b64(land), density: b64(x.density), life: b64(x.life), famine: b64(x.famine) })); }
}
if (runs.gpu && runs.cpu) {
    console.log(`${label} 0 BP, GPU run vs CPU run, cell by cell:`, JSON.stringify(cellDiff(cellsOf(runs.gpu.r, w), cellsOf(runs.cpu.r, w), land)));
    // (the totals over time: people and the famine's dead, each step)
    const tg = runs.gpu.r.totals, tc = runs.cpu.r.totals, people = [], dead = [];
    for (let k = 0; k < Math.min(tg.length, tc.length); k++) { if (tc[k].people > 0) people.push(Math.abs(tg[k].people - tc[k].people) / tc[k].people); if (tc[k].famineDead > 1000) dead.push(Math.abs(tg[k].famineDead - tc[k].famineDead) / tc[k].famineDead); }
    console.log(`${label} totals per step, |GPU − CPU| / CPU: people ${JSON.stringify(quants(people))}, famine dead (steps > 1000 dead) ${JSON.stringify(quants(dead))}`);
}
process.exit(0);
