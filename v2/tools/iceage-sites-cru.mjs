#!/usr/bin/env node
// The sites' climate (tools/iceage-inception.mjs's REPORT_JSON sites) beside CRU CL 2.0's observed 1961–90 climate (New et al.
// 2002; tuning/climate/fetch-cru.sh), lane iceage B2, 2026-11-25. CPU only, seconds. A measurement, nothing fitted:
//   (a) the inception's plateaus — the summer (JJA) and the degree-day balance at the cells' own heights (median, 90th
//       percentile: where the degree days are taken) against the climate grid's mean height (its 2° cell's): does the grid's
//       smoothing of the ground take part? And today's JJA against CRU's at the same height: is the climate already too warm?
//   (b) High Asia's ranges — the balance with the climate's months, with CRU's, and with each one's temperature beside the
//       other's precipitation, at the cells' height: too cold, or too wet?
//   node v2/tools/iceage-sites-cru.mjs <inception log>
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITES, SITE_KM, gcKm } from './lib/iceage-sites.mjs';
import { pddBalance } from '../js/gpu/ice-balance.js';
import { CORE_DEFAULTS } from '../js/climate/core.js';

const log = process.argv[2];
if (!log) { console.error('usage: iceage-sites-cru.mjs <iceage-inception log>'); process.exit(1); }
const line = fs.readFileSync(log, 'utf8').split('\n').find(l => l.startsWith('REPORT_JSON {"sites"'));
if (!line) { console.error('no sites REPORT_JSON in the log'); process.exit(1); }
const M = JSON.parse(line.slice('REPORT_JSON '.length)).sites, gamma = CORE_DEFAULTS.lapseRateCPerKm;

// CRU: the points within SITE_KM of each site — their months at sea level (by γ, as the climate's own), precipitation, elevation
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tuning', 'climate', 'data', 'cru');
const rows = f => zlib.gunzipSync(fs.readFileSync(path.join(DIR, f))).toString().split('\n').filter(Boolean).map(l => l.trim().split(/\s+/).map(Number));
const key = r => `${r[0].toFixed(3)},${r[1].toFixed(3)}`;
let tmp, pre, elv;
try { tmp = rows('grid_10min_tmp.dat.gz'); pre = new Map(rows('grid_10min_pre.dat.gz').map(r => [key(r), r])); elv = new Map(rows('grid_10min_elv.dat.gz').map(r => [key(r), r[2]])); }
catch { console.error('CRU CL 2.0 missing: tuning/climate/fetch-cru.sh'); process.exit(1); }
const cru = SITES.map(st => {
    const Tsl12 = new Array(12).fill(0), P12 = new Array(12).fill(0), zs = []; let k = 0;
    for (const r of tmp) {
        if (gcKm(st.lat, st.lon, r[0], r[1]) > SITE_KM) continue;
        const z = elv.get(key(r)), p = pre.get(key(r)); if (z === undefined || !p) continue;
        for (let m = 0; m < 12; m++) { Tsl12[m] += r[2 + m] + gamma * Math.max(0, z); P12[m] += p[2 + m]; }
        zs.push(Math.max(0, z)); k++;
    }
    for (let m = 0; m < 12; m++) { Tsl12[m] /= k || 1; P12[m] /= k || 1; }
    zs.sort((a, b) => a - b);
    return { name: st.name, points: k, zMed: zs[zs.length >> 1] ?? NaN, Tsl12, P12 };
});

const at = (Tsl12, h) => Tsl12.map(t => t - gamma * h), jja = T => (T[5] + T[6] + T[7]) / 3, sum = a => a.reduce((s, v) => s + v, 0);
const bal = (T, P) => pddBalance(T, P) / 1000, f1 = v => (v >= 0 ? ' ' : '') + v.toFixed(1), f2 = v => (v >= 0 ? '+' : '') + v.toFixed(2);
const site = (run, name) => M[run]?.find(s => s.name === name && s.cells);
const out = { a: [], b: [] };

console.log(`── (a) the inception's plateaus: JJA (°C) and the balance (m w.e./a) by height — the cells' median and 90th percentile (the degree days'), the climate grid's mean; 116 ka is the rounds' form (B0), today is A0 (no dome) and A (the climate's own snow, its dome) ──`);
for (const st of SITES.filter(s => s.group === 'inception')) {
    const b = site('B0', st.name), a0 = site('A0', st.name), a = site('A', st.name), c = cru.find(x => x.name === st.name);
    if (!b || !a0) continue;
    const r = { site: st.name, cells: b.cells, zMed: b.zMed, zP90: b.zP90, href: b.hrefMed, cruZ: c.zMed, cruPoints: c.points };
    for (const [lab, h] of [['zMed', b.zMed], ['zP90', b.zP90], ['href', b.hrefMed]]) {
        r[`jja116_${lab}`] = jja(at(b.Tsl12, h)); r[`bal116_${lab}`] = bal(at(b.Tsl12, h), b.P12);
        r[`jja0_${lab}`] = jja(at(a0.Tsl12, h)); r[`jja0dome_${lab}`] = a ? jja(at(a.Tsl12, h)) : NaN; r[`jjaCru_${lab}`] = jja(at(c.Tsl12, h));
    }
    r.pAnnModel = sum(b.P12); r.pAnnCru = sum(c.P12);
    out.a.push(r);
    console.log(`\n${st.name}: ${b.cells} cells, heights median ${(1000 * b.zMed).toFixed(0)} m, p90 ${(1000 * b.zP90).toFixed(0)} m, the climate grid's mean ${(1000 * b.hrefMed).toFixed(0)} m; CRU ${c.points} points, median ${(1000 * c.zMed).toFixed(0)} m`);
    for (const [lab, h] of [['the cells\' median', b.zMed], ['the cells\' p90', b.zP90], ['the grid\'s mean', b.hrefMed]])
        console.log(`  at ${lab.padEnd(17)} ${(1000 * h).toFixed(0).padStart(5)} m: 116 ka JJA ${f1(jja(at(b.Tsl12, h)))} balance ${f2(bal(at(b.Tsl12, h), b.P12))} · today JJA ${f1(jja(at(a0.Tsl12, h)))} (own snow and dome ${a ? f1(jja(at(a.Tsl12, h))) : '–'}) · CRU ${f1(jja(at(c.Tsl12, h)))} → today − CRU ${f1(jja(at(a0.Tsl12, h)) - jja(at(c.Tsl12, h)))} K`);
    console.log(`  precipitation a year: the climate ${sum(a0.P12).toFixed(0)} mm (116 ka ${sum(b.P12).toFixed(0)}), CRU ${sum(c.P12).toFixed(0)} mm; balance at the cells' median today with CRU's own months ${f2(bal(at(c.Tsl12, b.zMed), c.P12))}`);
}

console.log(`\n── (b) High Asia: the balance (m w.e./a) at the cells' median and p90 heights at 21 ka (the rounds' form, C0) and today (A0) — the climate's months, CRU's, and swapped ──`);
for (const st of SITES.filter(s => s.group === 'high asia')) {
    const g = site('C0', st.name), a0 = site('A0', st.name), c = cru.find(x => x.name === st.name);
    if (!g || !a0) continue;
    const r = { site: st.name, zMed: g.zMed, zP90: g.zP90, href: g.hrefMed, cruZ: c.zMed };
    console.log(`\n${st.name}: ${g.cells} cells, median ${(1000 * g.zMed).toFixed(0)} m, p90 ${(1000 * g.zP90).toFixed(0)} m, grid mean ${(1000 * g.hrefMed).toFixed(0)} m; CRU ${c.points} points, median ${(1000 * c.zMed).toFixed(0)} m`);
    for (const [lab, h] of [['median', g.zMed], ['p90', g.zP90]]) {
        const Tm = at(a0.Tsl12, h), Tc = at(c.Tsl12, h), T21 = at(g.Tsl12, h);
        const v = { jjaModel: jja(Tm), jjaCru: jja(Tc), jja21: jja(T21), bal21: bal(T21, g.P12), balModel: bal(Tm, a0.P12), balCru: bal(Tc, c.P12), balTmodelPcru: bal(Tm, c.P12), balTcruPmodel: bal(Tc, a0.P12), pModel: sum(a0.P12), pCru: sum(c.P12) };
        r[lab] = v;
        console.log(`  at the ${lab.padEnd(6)} ${(1000 * h).toFixed(0).padStart(5)} m: JJA today ${f1(v.jjaModel)} vs CRU ${f1(v.jjaCru)} (${f1(v.jjaModel - v.jjaCru)} K); precipitation ${v.pModel.toFixed(0)} vs CRU ${v.pCru.toFixed(0)} mm (×${(v.pModel / v.pCru).toFixed(2)})`);
        console.log(`    balance today: the climate's ${f2(v.balModel)} · CRU's ${f2(v.balCru)} · the climate's T with CRU's P ${f2(v.balTmodelPcru)} · CRU's T with the climate's P ${f2(v.balTcruPmodel)} · at 21 ka ${f2(v.bal21)}`);
    }
    out.b.push(r);
}
console.log(`\nREPORT_JSON ${JSON.stringify({ sitesCru: out })}`);
