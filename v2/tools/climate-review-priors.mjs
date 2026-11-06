// Climate review (climrev, 2026-11-06): where each tuned climate setting ended up against its own literature prior.
// Read-only: it imports v2/js/climate/config.js and prints, for every PARAM_PRIORS entry, the default, the prior,
// the range, how far the tuning moved it (in units of the half-range on its side) and whether it sits on a bound —
// "ended at the edge of its range" is the tuner telling us the structure, not the constant, is what's wrong.
// Settings with no prior are listed too: they were never given a literature value.
// Usage: node v2/tools/climate-review-priors.mjs [--md]

import { PARAMS_DEFAULTS, PARAM_PRIORS } from '../js/climate/config.js';

const md = process.argv.includes('--md');
const rows = [];
for (const [k, v] of Object.entries(PARAMS_DEFAULTS)) {
    const p = PARAM_PRIORS[k];
    if (!p) { rows.push({ k, v, prior: null }); continue; }
    if (typeof v !== 'number') { rows.push({ k, v, prior: p.value, note: 'non-scalar' }); continue; }
    const side = v >= p.value ? p.max - p.value : p.value - p.min;
    const pull = side > 0 ? (v - p.value) / side : 0;                     // −1 … +1: fraction of the way to the bound
    const atBound = Math.abs(v - p.min) <= 1e-9 * Math.max(1, Math.abs(p.min)) || Math.abs(v - p.max) <= 1e-9 * Math.max(1, Math.abs(p.max));
    rows.push({ k, v, prior: p.value, min: p.min, max: p.max, pull, atBound, src: p.source });
}

const tuned = rows.filter(r => r.prior !== null && r.pull !== undefined && Math.abs(r.pull) > 1e-9);
const untouched = rows.filter(r => r.prior !== null && r.pull !== undefined && Math.abs(r.pull) <= 1e-9);
const noPrior = rows.filter(r => r.prior === null);
const fmt = (x) => typeof x === 'number' ? (Math.abs(x) < 1e-2 && x !== 0 ? x.toExponential(2) : +x.toPrecision(4)) : String(x);

if (md) {
    console.log('| Setting | Default | Prior | Range | Pull | Bound? | Prior source (abridged) |\n|---|---:|---:|---|---:|:-:|---|');
    for (const r of tuned.sort((a, b) => Math.abs(b.pull) - Math.abs(a.pull)))
        console.log(`| ${r.k} | ${fmt(r.v)} | ${fmt(r.prior)} | ${fmt(r.min)}–${fmt(r.max)} | ${(r.pull * 100).toFixed(0)} % | ${r.atBound ? '**edge**' : ''} | ${r.src.slice(0, 90)} |`);
} else {
    console.log(`settings ${rows.length}: with prior ${rows.length - noPrior.length} (moved by tuning ${tuned.length}, at prior ${untouched.length}), no prior ${noPrior.length}`);
    console.log(`at a range edge: ${tuned.filter(r => r.atBound).map(r => r.k).join(', ') || 'none'}`);
    console.log(`moved ≥ 75 % of the way to a bound: ${tuned.filter(r => Math.abs(r.pull) >= 0.75).map(r => `${r.k} (${(r.pull * 100).toFixed(0)} %)`).join(', ')}`);
    console.log('\nmoved:');
    for (const r of tuned.sort((a, b) => Math.abs(b.pull) - Math.abs(a.pull)))
        console.log(`  ${r.k.padEnd(24)} ${String(fmt(r.v)).padStart(9)}  prior ${String(fmt(r.prior)).padStart(8)}  [${fmt(r.min)}, ${fmt(r.max)}]  pull ${(r.pull * 100).toFixed(0).padStart(4)} %${r.atBound ? '  EDGE' : ''}`);
    console.log('\nno prior (never given a literature value):');
    console.log('  ' + noPrior.map(r => `${r.k}=${fmt(Array.isArray(r.v) ? JSON.stringify(r.v) : r.v)}`).join(', '));
}
