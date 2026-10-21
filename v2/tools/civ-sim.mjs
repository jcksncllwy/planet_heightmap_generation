// The civ layer's people (plans/CIV_PLAN.md, Phases 1–3) run headlessly on a finished moment — or on real Earth
// (--earth: tuning/civ/lib/earth-world.mjs), where the run is scored against the archaeological record: when people
// reached each region, where and when farming began, when it reached each region.
//
//   node --max-old-space-size=16000 v2/tools/civ-sim.mjs --seed 12345 --time 300 [--cells 640000] [--origin lat,lon] [--end 0]
//   node --max-old-space-size=16000 v2/tools/civ-sim.mjs --earth [--origin 5,36]
//
// Output (v2/out/civ/sim-<name>/): timeline.png (density at eight moments — foragers in cool colours, farmers in warm, the
// domestication centres ringed), summary.json (centres, totals, the Earth scores).

import fs from 'node:fs';
import path from 'node:path';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { civSubstrate, PACKAGES } from '../js/civ/substrate.js';
import { runCivSim, byteDensity, Life } from '../js/civ/sim.js';
import { settle } from '../js/civ/settle.js';
import { CIV } from '../js/civ/civ-config.js';
import { OUT, MESH_SEED, worldOf, writePng, pixelCells, ramp, warmRamp, drawText } from './lib/civ-world.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const EARTH = process.argv.includes('--earth');
const CONT = Number(arg('--cont', 30)), SIM = Number(arg('--sim', 40000)), TIME = Number(arg('--time', 300)), CELLS = Number(arg('--cells', 640000));
const SEED = Number(arg('--seed', 12345)), END = Number(arg('--end', 0));
const ORIGIN = arg('--origin', EARTH ? '5,36' : null)?.split(',').map(Number) ?? null;
const t0 = performance.now(), secs = () => `${((performance.now() - t0) / 1000).toFixed(1)} s`;
const D = Math.PI / 180;

const w = EARTH ? await (await import('../../tuning/civ/lib/earth-world.mjs')).earthWorld(CELLS)
    : await worldOf(SEED, buildSimMesh(SIM, MESH_SEED), { cont: CONT, sim: SIM, time: TIME, cells: CELLS });
const cellAt = (lat, lon) => w.mesh.index.nearest(Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D));
const latOf = c => Math.asin(w.mesh.xyz[3 * c + 2]) / D, lonOf = c => Math.atan2(w.mesh.xyz[3 * c + 1], w.mesh.xyz[3 * c]) / D;
const sub = civSubstrate(w);
console.log(`world ${EARTH ? 'Earth' : SEED} at ${w.mesh.numCells.toLocaleString()} cells; substrate (${secs()})`);
const res = runCivSim(w, sub, { origins: ORIGIN ? [cellAt(...ORIGIN)] : null, endBP: END });
console.log(`ran ${CIV.originBP.toLocaleString()} BP → ${END} BP in ${res.totals.length} steps (${secs()}); origin ${res.origins.map(c => `${latOf(c).toFixed(1)},${lonOf(c).toFixed(1)}`)}`);
const at = bp => res.totals.reduce((a, b) => (Math.abs(b.bp - bp) < Math.abs(a.bp - bp) ? b : a));
for (const bp of [50000, 20000, 12000, 10000, 8000, 6000, 4000, 0]) { const x = at(bp); console.log(`  ${String(bp).padStart(6)} BP: ${(x.people / 1e6).toFixed(2)} M people, ${(x.farmers / 1e6).toFixed(2)} M farmers`); }
console.log(`domestication centres (${res.centres.length}; first 25):`);
for (const c of res.centres.slice(0, 25)) console.log(`  ${String(Math.round(c.bp)).padStart(6)} BP  ${c.pkg.padEnd(13)} at ${c.lat},${c.lon} (${c.cells} cells)`);

// ── on Earth: the record ──
const summary = { origins: res.origins.map(c => [+latOf(c).toFixed(2), +lonOf(c).toFixed(2)]), centres: res.centres, totals: res.totals.filter((x, i) => i % 20 === 0) };
// ── towns and polities (settle.js), at a few moments ──
const townsAt = f => { const dens = new Float32Array(f.density.length); for (let c = 0; c < dens.length; c++) dens[c] = byteDensity(f.density[c]); return settle(w, sub, dens, f.life); };
const frameNear = bp => res.frames.reduce((a, b) => (Math.abs(b.bp - bp) < Math.abs(a.bp - bp) ? b : a));
const settled = [];
for (const bp of [8000, 7000, 6000, 5000, 4000]) {
    const f = frameNear(bp), S = townsAt(f), states = S.polities.filter(p => p.state);
    const rainMax = S.towns.find(t => !t.irrigated)?.pop ?? 0;
    console.log(`towns ${bp} BP: ${S.towns.length.toLocaleString()} (${(S.urban / 1e6).toFixed(2)} M in them), ${states.length} states; the biggest rain-fed ${rainMax.toLocaleString()}`);
    console.log('   ' + S.towns.slice(0, 8).map(t => `${(t.pop / 1000).toFixed(1)}k${t.irrigated ? '*' : ''} ${t.lat},${t.lon}`).join(' · '));
    settled.push({ bp: f.bp, S });
}
summary.towns = settled.map(({ bp, S }) => ({ bp, count: S.towns.length, urban: S.urban, states: S.polities.filter(p => p.state).length, top: S.towns.slice(0, 20) }));

if (EARTH) {
    // (each place: the earliest within 75 km — a river or a coast is often a cell away from the point named)
    const near = (lat, lon, A) => {
        const c0 = cellAt(lat, lon), xyz = w.mesh.xyz, cosR = Math.cos(75 / 6371);
        let best = NaN;
        for (let c = 0; c < A.length; c++) {
            if (!(A[c] === A[c])) continue;
            if (xyz[3 * c] * xyz[3 * c0] + xyz[3 * c + 1] * xyz[3 * c0 + 1] + xyz[3 * c + 2] * xyz[3 * c0 + 2] < cosR) continue;
            if (!(best >= A[c])) best = A[c];
        }
        return best;
    };
    // first modern humans (ka BP; ranges of current estimates)
    const ARRIVE = [['Levant (Skhul / Manot)', 32.5, 35.3, [55, 50]], ['South Asia', 22, 78, [70, 50]], ['Sahul (Madjedbebe)', -12.5, 132.9, [65, 47]],
        ['Europe (Bacho Kiro)', 43, 25.4, [47, 43]], ['China (Fuyan)', 25.5, 111, [80, 40]], ['Japan', 35, 137, [38, 35]], ['Siberia (Yana)', 70.7, 135.4, [32, 28]],
        ['Beringia / Alaska', 65, -150, [20, 14]], ['Monte Verde (Chile)', -41.5, -73, [18.5, 14.5]], ['Tasmania', -42, 147, [41, 35]],
        ['Fiji (Lapita)', -17.8, 178, [3.1, 2.8]], ['Madagascar', -19, 47, [2.5, 1]], ['New Zealand', -41, 174, [0.8, 0.7]]];
    // domestication centres (ka BP of the first domesticates; Larson et al. 2014, Fuller 2011)
    const DOM = [['Fertile Crescent', 36, 39, [11.5, 10]], ['Yangtze (rice)', 30, 113, [9, 7]], ['Yellow River (millet)', 35.5, 111, [10, 8]],
        ['New Guinea highlands', -5.8, 144.3, [10, 7]], ['Mesoamerica', 18, -98, [10, 8]], ['Andes', -13, -72, [8, 6]], ['Eastern N. America', 37, -87, [5, 4]],
        ['Sahel', 16, 0, [5, 4]], ['Ethiopia', 9, 39, [7, 4]], ['India (Ganges)', 25, 82, [8, 5]]];
    // farming arrives (ka BP)
    const FARM = [['Greece', 39.5, 22, [9, 8.5]], ['Britain', 52, -1, [6.1, 5.9]], ['Egypt', 27, 31, [7.5, 7]], ['Mehrgarh', 29.4, 67.6, [9, 8.5]],
        ['Southern Mesopotamia', 31, 46, [8.5, 7.5]], ['Iberia', 40, -4, [7.5, 7.3]], ['Scandinavia (south)', 56, 13, [6, 5.8]]];
    const fmt = v => (v === v ? `${(v / 1000).toFixed(1)} ka` : 'never');
    const score = (name, rows, A) => {
        console.log(name);
        let ok = 0;
        const out = rows.map(([label, lat, lon, [hi, lo]]) => {
            const v = near(lat, lon, A) / 1000, pass = v === v && v <= hi + 2 && v >= lo - 2;
            if (pass) ok++;
            console.log(`  ${pass ? '✓' : '✗'} ${label.padEnd(24)} ${fmt(near(lat, lon, A)).padStart(9)}   (record ${hi}–${lo} ka)`);
            return { label, simKa: v === v ? +v.toFixed(2) : null, recordKa: [hi, lo], pass };
        });
        console.log(`  ${ok}/${rows.length} within ±2 ka`);
        return out;
    };
    summary.arrival = score('people arrive:', ARRIVE, res.arrivalBP);
    // centres: the earliest centre within 600 km of each known one
    const km = (a, b, c, d) => 2 * 6371 * Math.asin(Math.sqrt(Math.sin((c - a) * D / 2) ** 2 + Math.cos(a * D) * Math.cos(c * D) * Math.sin((d - b) * D / 2) ** 2));
    console.log('domestication centres:');
    let okC = 0;
    summary.domestication = DOM.map(([label, lat, lon, [hi, lo]]) => {
        const c = res.centres.filter(x => km(lat, lon, x.lat, x.lon) < 600).sort((a, b) => b.bp - a.bp)[0];
        const v = c ? c.bp / 1000 : NaN, pass = v === v && v <= hi + 2 && v >= lo - 2;
        if (pass) okC++;
        console.log(`  ${pass ? '✓' : '✗'} ${label.padEnd(24)} ${c ? `${v.toFixed(1)} ka ${c.pkg}` : 'none'}   (record ${hi}–${lo} ka)`);
        return { label, simKa: c ? +v.toFixed(2) : null, pkg: c?.pkg ?? null, recordKa: [hi, lo], pass };
    });
    const spurious = res.centres.filter(x => !DOM.some(([, lat, lon]) => km(lat, lon, x.lat, x.lon) < 600)).length;
    console.log(`  ${okC}/${DOM.length} within ±2 ka; ${spurious} of ${res.centres.length} centres far from any known one`);
    summary.farming = score('farming arrives:', FARM, res.farmBP);
    // the first cities: the biggest town within 300 km of each, at each moment (record: the first ≥ 10 000 people, ka BP)
    const CITIES = [['Uruk (Sumer)', 31.3, 45.6, 5.5], ['Memphis (Egypt)', 29.85, 31.25, 5.0], ['Mohenjo-daro (Indus)', 27.3, 68.1, 4.5], ['Erlitou (Yellow R.)', 34.7, 112.7, 3.8]];
    console.log('the biggest town near each early city (k people; * irrigated; a state where marked §):');
    summary.cities = CITIES.map(([label, lat, lon, ka]) => {
        const row = settled.map(({ bp, S }) => {
            const t = S.towns.find(t => km(lat, lon, t.lat, t.lon) < 300);
            return t ? { bp, pop: t.pop, irrigated: t.irrigated, state: S.polities[t.polity].state } : { bp, pop: 0 };
        });
        console.log(`  ${label.padEnd(22)} ${row.map(r => `${(r.bp / 1000).toFixed(0)} ka ${(r.pop / 1000).toFixed(1)}k${r.irrigated ? '*' : ''}${r.state ? '§' : ''}`.padEnd(14)).join(' ')}  (record: a city ~${ka} ka)`);
        return { label, row, recordKa: ka };
    });
}

// ── the timeline picture: eight moments ──
const name = EARTH ? 'sim-earth' : `sim-${SEED}-${TIME}-${Math.round(CELLS / 1000)}k`, dir = path.join(OUT, name);
fs.mkdirSync(dir, { recursive: true });
const pick = [60000, 45000, 30000, 15000, 10000, 8000, 6000, END].map(bp => res.frames.reduce((a, b) => (Math.abs(b.bp - bp) < Math.abs(a.bp - bp) ? b : a)));
const TW = 1024, TH = 512, sheet = new Uint8ClampedArray(2 * TW * 4 * TH * 4), pix = pixelCells(w.mesh, TW), SW = 2 * TW;
const centreCells = res.centres.map(c => ({ ...c, x: (c.lon + 180) / 360 * TW, y: (90 - c.lat) / 180 * TH }));
pick.forEach((f, i) => {
    const ox = (i % 2) * TW, oy = Math.floor(i / 2) * TH, img = new Uint8ClampedArray(TW * TH * 4);
    for (let p = 0; p < TW * TH; p++) {
        const c = pix[p], q = f.density[c], o = 4 * p;
        let col;
        if (q) {
            const t = (Math.log10(byteDensity(q)) + 3) / 5;             // 0.001 … 100 per km²
            col = f.life[c] >= Life.FARMER ? warmRamp(t) : ramp(t * 0.85);
        } else col = w.ocean[c] ? [18, 26, 44] : [62, 62, 58];
        img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; img[o + 3] = 255;
    }
    for (const c of centreCells) if (c.bp >= f.bp) for (let a = 0; a < 360; a += 12) {
        const x = Math.round(c.x + 5 * Math.cos(a * D)), y = Math.round(c.y + 5 * Math.sin(a * D)), o = 4 * (y * TW + ((x % TW) + TW) % TW);
        if (y >= 0 && y < TH) { img[o] = 255; img[o + 1] = 255; img[o + 2] = 255; }
    }
    drawText(img, TW, TH, 70, 16, f.bp > 0 ? `${Math.round(f.bp / 100) / 10}ka BP` : `${-f.bp} a`, { scale: 3 });
    for (let y = 0; y < TH; y++) sheet.set(img.subarray(4 * y * TW, 4 * (y + 1) * TW), 4 * ((oy + y) * SW + ox));
});
writePng(path.join(dir, 'timeline.png'), SW, 4 * TH, sheet);
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(`→ v2/out/civ/${name}/{timeline.png,summary.json} (${secs()})`);
