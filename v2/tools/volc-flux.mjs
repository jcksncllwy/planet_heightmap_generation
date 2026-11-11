// The volcanic record of a cached history (tectonics/volcanism.js; lane volcano): every frame's magma and erupted km³/Myr
// by setting, its gas, its flood basalts' pulses and sills, its live centres — against Earth's ranges (report lines, not
// gates) — and what a moment's eruptions would be. Records only: it reads the frames and changes nothing.
//
//   node v2/tools/volc-flux.mjs [--key <history key> | --latest] [--every 10] [--json out.json] [--moment <Myr>] [--kyr 100]
//
// Default key: Jackson's open history on 2026-11-10 (831576, cont 41, 40K). `--moment` draws that frame's eruptions over
// the last --kyr thousand years (recentEruptions) and prints the largest.

import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import * as HC from './lib/history-cache.mjs';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { volcStep, recentEruptions, EARTH_VEI_PER_YR } from '../js/tectonics/volcanism.js';
setDelaunator(Delaunator);

const A = process.argv.slice(2), arg = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
let KEY = arg('--key', '6404e4be0d9d3571ce2217db22110f8f');
if (A.includes('--latest')) KEY = JSON.parse(fs.readFileSync(HC.LATEST_FILE, 'utf8')).key;
const EVERY = +arg('--every', 10), MOMENT = arg('--moment'), KYR = +arg('--kyr', 100);
const meta = HC.readMeta(KEY);
if (!meta) { console.error(`no history ${KEY} in the cache`); process.exit(1); }
const mesh = buildSimMesh(meta.spec.sim, meta.spec.meshSeed ?? 12345), H = terrainConfig(meta.spec.heights ?? {}), seed = meta.spec.seed ?? 0;
const times = HC.entryTimes(KEY).filter(t => t % EVERY === 0 && t <= (meta.builtToMyr ?? Infinity));

const rows = [];
let prev = null, ms = 0;
for (const t of times) {
    const f = HC.getFrame(KEY, t);
    if (!f) continue;
    if (prev) {
        const t0 = performance.now();
        const v = volcStep(prev, f, mesh, H, { seed });
        ms += performance.now() - t0;
        rows.push(v);
    }
    prev = f;
}
const fmt = (x, d = 2) => (x / 1e6).toFixed(d);      // km³/Myr → km³/yr
const S = ['ridge', 'arc', 'plume', 'rift', 'lip'];
console.log(`volc-flux: ${KEY} (seed ${seed}, ${mesh.numCells} cells), ${rows.length} frames; volcStep ${(ms / rows.length).toFixed(1)} ms a frame, ${(ms / 1000).toFixed(2)} s in all`);
console.log(`\n   t | magma km³/yr: ${S.map(s => s.padStart(6)).join(' ')} | erupted | CO₂ Mt/yr air (ocean) | SO₂ | rift sites silicic | LIPs`);
for (const v of rows) {
    if (v.time % 50 !== 0 && !v.lips.length) continue;
    const air = v.gas.co2.arc + v.gas.co2.plume + v.gas.co2.rift + v.gas.co2.lip + v.gas.co2.thermo, so2 = S.reduce((a, s) => a + (s === 'ridge' ? 0 : v.gas.so2[s]), 0);
    const er = S.reduce((a, s) => a + v.erupted[s], 0), rs = v.sites.filter(s => s.kind === 'rift').length, sil = v.sites.filter(s => s.silicic).length;
    console.log(`${String(v.time).padStart(4)} | ${' '.repeat(14)}${S.map(s => fmt(v.magma[s]).padStart(6)).join(' ')} | ${fmt(er).padStart(6)} | ${air.toFixed(0).padStart(6)} (${v.gas.co2.ridge.toFixed(0)}) | ${so2.toFixed(1).padStart(5)} | ${String(rs).padStart(5)} ${String(sil).padStart(5)} | ${v.lips.map(l => `${l.name} ${l.areaMkm2.toFixed(1)}Mkm² ${(l.earthKm3 / 1e6).toFixed(2)}Mkm³ ${l.durMyr.toFixed(2)}Myr peak ${l.peakKm3yr.toFixed(0)}km³/yr sills ${l.sillMkm2.toFixed(2)}Mkm² thermo ${l.thermoGtCO2.toFixed(0)}Gt${l.haloTag ? ' HALO' : ''}`).join('; ')}`);
}

const mean = g => rows.reduce((a, v) => a + g(v), 0) / rows.length;
const m = Object.fromEntries(S.map(s => [s, mean(v => v.magma[s])]));
const total = S.reduce((a, s) => a + m[s], 0);
const flag = (x, lo, hi) => x < lo || x > hi ? ' ⚑' : '';
const line = (label, x, lo, hi, src) => console.log(`  ${label.padEnd(44)} ${x.toFixed(2).padStart(8)}   Earth ${lo}–${hi}${flag(x, lo, hi)}   (${src})`);
console.log('\nEarth (history means; report lines, never gates):');
line('ridge magma, km³/yr', m.ridge / 1e6, 18, 24, 'Crisp 1984; White et al. 1992');
line('arc magma (the arc book, net), km³/yr', m.arc / 1e6, 1.1, 8, 'Reymer & Schubert 1984 net … Crisp 1984 gross');
line('plume-tail magma, km³/yr', m.plume / 1e6, 1, 3, 'Crisp 1984 ~5 % of the total');
line('total magma (180-Myr mean on Earth), km³/yr', total / 1e6, 26, 34, 'Crisp 1984');
line('ridge share of the total', m.ridge / total, 0.7, 0.8, 'Crisp 1984 ~75 %');
line('arc CO₂ to air, Mt/yr (book × yield)', mean(v => v.gas.co2.arc), 45, 57, 'Fischer et al. 2019, 51 ± 6 (gross arc flux)');
line('plume CO₂ to air, Mt/yr', mean(v => v.gas.co2.plume), 11, 33, 'Wong et al. 2019, 6 ± 3 Mt C');
line('ridge CO₂ to the ocean, Mt/yr', mean(v => v.gas.co2.ridge), 37, 110, 'Wong et al. 2019, 10–30 Mt C');
const riftFrames = rows.filter(v => v.magma.rift > 0);
const riftSites = rows.flatMap(v => v.sites.filter(s => s.kind === 'rift'));
console.log(`  rifts: melt in ${riftFrames.length} of ${rows.length} frames; mean while active ${riftFrames.length ? fmt(riftFrames.reduce((a, v) => a + v.magma.rift, 0) / riftFrames.length) : '—'} km³/yr; ` +
    `${riftSites.length} centre-frames, β median ${median(riftSites.map(s => s.beta)).toFixed(2)}, ΔT median ${median(riftSites.map(s => s.dK)).toFixed(0)} K, ` +
    `${riftSites.filter(s => s.veiMax >= 6).length} peralkaline-capable, ${riftSites.filter(s => s.carbonatite).length} carbonatite`);
const stretched = rows.reduce((a, v) => a + v.sites.filter(s => s.kind === 'rift').length, 0);
const lips = rows.flatMap(v => v.lips);
console.log(`  LIPs: ${lips.length} in ${rows.at(-1).time - rows[0].time + rows[0].dt} Myr (Earth's big ones ~1 per 20–30 Myr, Ernst 2014); Earth-scaled volume ${median(lips.map(l => l.earthKm3 / 1e6)).toFixed(2)} Mkm³ median ` +
    `(Earth 0.1–4, Bryan & Ernst 2008); thermogenic ${median(lips.map(l => l.thermoGtCO2)).toFixed(0)} Gt CO₂ median, max ${Math.max(0, ...lips.map(l => l.thermoGtCO2)).toFixed(0)} (Siberia ~0.8–4 × 10⁵ Gt CO₂)`);
const sil = rows.map(v => v.sites.filter(s => s.silicic).length);
console.log(`  silicic centres a frame: median ${median(sil)}, range ${Math.min(...sil)}–${Math.max(...sil)}; VEI-8-capable a frame: median ${median(rows.map(v => v.sites.filter(s => s.veiMax >= 8).length))}`);
void stretched;

if (MOMENT != null) {
    const v = rows.find(r => r.time === +MOMENT) ?? rows.at(-1);
    const ev = recentEruptions(v, seed, KYR);
    const by = {};
    for (const e of ev) by[e.vei] = (by[e.vei] ?? 0) + 1;
    console.log(`\nEruptions at ${v.time} Myr over the last ${KYR} kyr (VEI ≥ 4): ${Object.entries(by).map(([k, c]) => `VEI ${k}: ${c} (Earth ${(EARTH_VEI_PER_YR[k] * KYR * 1e3).toFixed(0)})`).join(', ')}`);
    for (const e of [...ev].sort((a, b) => b.vei - a.vei || a.ageYr - b.ageYr).slice(0, 6)) console.log(`  VEI ${e.vei} ${e.kind} at cell ${e.w}, ${(e.ageYr / 1e3).toFixed(1)} ka, ${e.km3.toFixed(1)} km³, SO₂ ${e.so2Tg.toFixed(0)} Tg`);
}
const out = arg('--json');
if (out) fs.writeFileSync(out, JSON.stringify(rows.map(v => ({ ...v, sites: v.sites.length })), null, 0));

function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }
