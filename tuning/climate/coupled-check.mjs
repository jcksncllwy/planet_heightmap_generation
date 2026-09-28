/**
 * Phase 6 — the coupled climate: every stage new, on Earth, scored on Köppen with every stage's own score as a
 * guardrail; plus the named features, the test planets, drift across terrain resolutions and timing.
 *
 *   node tuning/climate/coupled-check.mjs              score the current settings
 *   node tuning/climate/coupled-check.mjs --tune       the final Köppen-level tune (a few coupling knobs, priors, no
 *                                                      continent worse, stage guardrails), then score
 *   node tuning/climate/coupled-check.mjs --quick      Earth at 160K only (no drift, no test planets)
 *   node tuning/climate/coupled-check.mjs --set KEY=value,…
 *
 * Köppen is scored per terrain cell against Beck's 0.1° map, per continent (each weighted equally). Guardrails, on
 * the 1° grid: land temperature per continent (Beck), rain per continent (Beck) and ocean basin (GPCP), sea
 * temperature (OISST). Earth is a check, not the target: the tune may move a setting only within its literature range.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEarthGrayscale } from './lib/earth-context.mjs';
import { buildEarthMesh } from './lib/earth-mesh.mjs';
import { loadReferences, truthAt01, seasonMean, JJA, DJF } from './lib/ref.mjs';
import { compareClasses, groupStats, gridWeights, REGIMES } from './lib/compare.mjs';
import { continentOf, TUNED_CONTINENTS } from './lib/continents.mjs';
import { basinOf, TUNED_BASINS } from './lib/regions.mjs';
import { elevToHeightKm } from '../../js/color-map.js';
import { buildSphere } from '../../js/sphere-mesh.js';
import { makeRng } from '../../js/rng.js';
import { computeClimate, cellLatLon, aggregateSurface } from '../../v2/js/climate/core.js';
import { energyBalanceTemperature } from '../../v2/js/climate/temperature.js';
import { derivedCirculation } from '../../v2/js/climate/circulation.js';
import { windDrivenOcean } from '../../v2/js/climate/ocean.js';
import { columnWaterRain } from '../../v2/js/climate/rain.js';
import { PARAMS, PARAMS_DEFAULTS, PARAM_PRIORS, setParams, resetParams } from '../../v2/js/climate/config.js';
import { TEST_PLANETS, buildTestPlanet } from '../../v2/js/climate/test-planets.js';
import { KOPPEN_CLASSES } from '../../v2/js/climate/koppen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'results', 'climate');
const LAB_DIR = path.join(__dirname, 'data', 'lab');
const TUNE = process.argv.includes('--tune'), QUICK = process.argv.includes('--quick');
const CORE = process.env.CORE ? JSON.parse(process.env.CORE) : {};          // core options to try, e.g. CORE='{"couplingsWithOcean":2}'
const argSet = process.argv.indexOf('--set');
const OVERRIDES = argSet > 0 ? Object.fromEntries(process.argv[argSet + 1].split(',').map(kv => { const [k, v] = kv.split('='); return [k, +v]; })) : {};
setParams(OVERRIDES);
const f1 = (x) => (x === x ? x.toFixed(1) : '—'), f2 = (x) => (x === x ? x.toFixed(2) : '—'), pc = (x) => (x === x ? `${(100 * x).toFixed(1)} %` : '—');

const { grid, fields: obs, koppen01, land: obsLand } = loadReferences();
const G = grid.size, W = gridWeights(grid);
const { gray, width, height } = loadEarthGrayscale();
const MONTHS12 = Array.from({ length: 12 }, (_, m) => m);
const cellLat = (c) => grid.lat[Math.floor(c / grid.w)], cellLon = (c) => grid.lon[c % grid.w];
const stages = () => ({ temperature: energyBalanceTemperature(), circulation: derivedCirculation(), ocean: windDrivenOcean(), rain: columnWaterRain() });

function earthAt(N) {
    const e = buildEarthMesh(gray, width, height, { N });
    const n = e.mesh.numRegions, elevKm = new Float32Array(n);
    for (let r = 0; r < n; r++) elevKm[r] = elevToHeightKm(e.r_elevation[r]);
    const lat = new Float32Array(n), lon = new Float32Array(n);
    cellLatLon(e.r_xyz, 'y-up', lat, lon);
    const truth = new Uint8Array(n), cont = new Array(n);
    for (let r = 0; r < n; r++) { truth[r] = truthAt01(koppen01, lat[r], lon[r]); cont[r] = continentOf(lat[r], lon[r]); }
    return { xyz: e.r_xyz, elevKm, lat, lon, truth, cont, n };
}
const E160 = earthAt(160000);
const landC = new Uint8Array(E160.n); for (let r = 0; r < E160.n; r++) landC[r] = E160.elevKm[r] > 0 ? 1 : 0;
const surface = aggregateSurface(grid, E160.lat, E160.lon, E160.elevKm, landC);

// ── Masks on the 1° grid ──
const landMask = Object.fromEntries(TUNED_CONTINENTS.map(k => [k, new Uint8Array(G)]));
const seaMask = Object.fromEntries(TUNED_BASINS.map(k => [k, new Uint8Array(G)]));
const sstMask = new Uint8Array(G);
for (let c = 0; c < G; c++) {
    if (obsLand[c] && surface.landFrac[c] >= 0.5) { const k = continentOf(cellLat(c), cellLon(c)); if (landMask[k]) landMask[k][c] = 1; }
    if (surface.landFrac[c] < 0.2 && obs.precipAll[c] === obs.precipAll[c]) { const b = basinOf(cellLat(c), cellLon(c)); if (seaMask[b]) seaMask[b][c] = 1; }
    if (surface.landFrac[c] < 0.2) { let ok = true; for (let m = 0; m < 12; m++) { const s = obs.sst[m * G + c]; if (!(s === s) || obs.seaIce[m * G + c] > 0.15) ok = false; } sstMask[c] = ok ? 1 : 0; }
}
function rmse(model, ref, mask) {
    let se = 0, sw = 0;
    for (let c = 0; c < G; c++) { if (!mask[c]) continue; for (let m = 0; m < 12; m++) { const d = model[m * G + c] - ref[m * G + c]; if (d === d) { se += W[c] * d * d; sw += W[c]; } } }
    return Math.sqrt(se / sw);
}
function logErr(model, ref, mask) {
    let se = 0, sw = 0;
    for (let c = 0; c < G; c++) { if (!mask[c]) continue; for (let m = 0; m < 12; m++) { const o = ref[m * G + c], s = model[m * G + c]; if (o === o && s === s) { se += W[c] * Math.log((s + 10) / (o + 10)) ** 2; sw += W[c]; } } }
    return Math.sqrt(se / sw);
}
const mean = (o) => { const v = Object.values(o); return v.reduce((a, b) => a + b, 0) / v.length; };

/** The whole climate on an Earth mesh → Köppen per continent and the stage guardrails. */
function evaluate(E = E160, opts = {}) {
    const t0 = performance.now();
    const res = computeClimate({ xyz: E.xyz, elevKm: E.elevKm, axes: 'y-up' }, { stages: stages(), ...CORE, ...opts });
    const ms = performance.now() - t0;
    const cmp = compareClasses(E.truth, res.cell.koppen);
    const perCont = {};
    for (const k of TUNED_CONTINENTS) {
        const mask = new Uint8Array(E.n); for (let r = 0; r < E.n; r++) mask[r] = E.cont[r] === k ? 1 : 0;
        perCont[k] = compareClasses(E.truth, res.cell.koppen, null, mask).exact;
    }
    const regimes = Object.fromEntries(Object.entries(REGIMES).map(([k, codes]) => [k, groupStats(cmp, codes)]));
    const T = res.stages.temperature, P = res.months.P;
    const guard = {
        temperature: Object.fromEntries(TUNED_CONTINENTS.map(k => [k, rmse(T.monthly, obs.t2m, landMask[k])])),
        rainLand: Object.fromEntries(TUNED_CONTINENTS.map(k => [k, logErr(P, obs.precip, landMask[k])])),
        rainSea: Object.fromEntries(TUNED_BASINS.map(k => [k, logErr(P, obs.precipAll, seaMask[k])])),
        sst: rmse(T.monthlySL, obs.sst, sstMask),
    };
    return { res, ms, exact: cmp.exact, major: cmp.major, macroF1: cmp.macroF1, perCont, meanCont: mean(perCont), regimes, guard, cmp };
}
const guardSummary = (g) => ({ temperature: mean(g.temperature), rain: (mean(g.rainLand) + mean(g.rainSea)) / 2, sst: g.sst });

// ── The final Köppen-level tune: a few coupling knobs, within their literature ranges ──
const TUNED = (process.env.TUNE_KEYS ?? 'RAIN_COLUMN_LOCAL,RAIN_STABILITY,RAIN_STORM_RH,RAIN_WIND_DIV_MOIST,RAIN_SOIL_MM,TEMP_INVERSION_C').split(',');
const PRIOR_WEIGHT = 0.02, WORSEN = 0.02, GUARD = { temperature: 0.15, rain: 0.04, sst: 0.15 };
let tuneLog = null;
if (TUNE) {
    let best = { ...PARAMS_DEFAULTS, ...OVERRIDES };
    const prior = (p) => { let s = 0; for (const k of TUNED) { const pr = PARAM_PRIORS[k]; if (pr) s += ((p[k] - pr.value) / (pr.max - pr.min)) ** 2; } return PRIOR_WEIGHT * s; };
    const ev = (p) => { setParams(p); const e = evaluate(); return { e, total: -e.meanCont - 0.5 * e.exact + prior(p) }; };
    let bestE = ev(best);
    const start = { ...bestE.e.perCont }, g0 = guardSummary(bestE.e.guard);
    const okGuard = (e) => { const g = guardSummary(e.guard); return g.temperature <= g0.temperature + GUARD.temperature && g.rain <= g0.rain + GUARD.rain && g.sst <= g0.sst + GUARD.sst; };
    console.log(`Köppen-level tune of ${TUNED.join(', ')} (continents equal; none > ${100 * WORSEN} pts worse; stage guardrails).`);
    console.log(`  start: Köppen ${pc(bestE.e.exact)}, continents ${pc(bestE.e.meanCont)}`);
    let step = 0.25;
    for (let round = 0; round < 4; round++) {
        let improved = false;
        for (const k of TUNED) {
            const pr = PARAM_PRIORS[k]; if (!pr) continue;
            for (const dir of [1, -1]) {
                const trial = { ...best, [k]: Math.max(pr.min, Math.min(pr.max, best[k] + dir * step * (pr.max - pr.min))) };
                if (trial[k] === best[k]) continue;
                const t = ev(trial);
                if (t.total < bestE.total - 1e-4 && TUNED_CONTINENTS.every(c => t.e.perCont[c] >= start[c] - WORSEN) && okGuard(t.e)) { best = trial; bestE = t; improved = true; break; }
            }
        }
        console.log(`  round ${round + 1} (step ${(100 * step).toFixed(1)} %): Köppen ${pc(bestE.e.exact)}, continents ${pc(bestE.e.meanCont)}`);
        if (!improved) step /= 2;
    }
    tuneLog = { params: Object.fromEntries(TUNED.map(k => [k, best[k]])), exact: bestE.e.exact, meanCont: bestE.e.meanCont };
    setParams(best);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'coupled-tuned.json'), JSON.stringify(tuneLog, null, 2));
    console.log('  tuned:', Object.entries(tuneLog.params).map(([k, v]) => `${k}=${+(+v).toPrecision(3)}`).join(', '));
}

// ── Earth at 160K ──
const main = evaluate();
const noClouds = evaluate(E160, { cloudsFromRain: false });              // the Phase 6 coupling: clouds from the rain
const g = guardSummary(main.guard), gn = guardSummary(noClouds.guard);
console.log(`\nCoupled climate on Earth, 160K (${main.res.timing.map(t => `${t.stage} ${t.ms.toFixed(0)}`).join(' · ')} ms; total ${main.ms.toFixed(0)} ms)`);
console.log(`  Köppen vs Beck: ${pc(main.exact)} of land (major group ${pc(main.major)}; continents equal ${pc(main.meanCont)}) — without clouds from the rain ${pc(noClouds.exact)} (${pc(noClouds.meanCont)}); V1 38 %`);
console.log('  per continent: ' + TUNED_CONTINENTS.map(k => `${k} ${pc(main.perCont[k])}`).join(', '));
console.log('  regimes (recall, area new ÷ real): ' + Object.entries(main.regimes).map(([k, r]) => `${k.split(' ')[0]} ${pc(r.recall)} ×${f2(r.areaRatio)}`).join(', '));
console.log(`  guardrails: land temperature ${f2(g.temperature)} °C (${f2(gn.temperature)} without clouds), rain ${f2(g.rain)} (${f2(gn.rain)}), sea temperature ${f2(g.sst)} °C (${f2(gn.sst)})`);
const big = Object.entries(main.cmp.perClass).filter(([, p]) => p.truthArea > 0.02).sort((a, b) => b[1].truthArea - a[1].truthArea);
console.log('  largest classes (real share → new share, recall): ' + big.map(([k, p]) => `${k} ${(100 * p.truthArea).toFixed(0)}→${(100 * p.simArea).toFixed(0)} % (${(100 * p.recall).toFixed(0)})`).join(', '));
{
    // the confusions that cost the most land, by continent
    const conf = new Map();
    const { koppen } = main.res.cell;
    for (let r = 0; r < E160.n; r++) {
        const t = E160.truth[r], s = koppen[r]; if (!t || t === s) continue;
        const key = `${E160.cont[r]}: ${KOPPEN_CLASSES[t].code} → ${s ? KOPPEN_CLASSES[s].code : 'sea'}`;
        conf.set(key, (conf.get(key) ?? 0) + 1);
    }
    let land = 0; for (let r = 0; r < E160.n; r++) if (E160.truth[r]) land++;
    console.log('  costliest confusions (% of land): ' + [...conf].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => `${k} ${(100 * v / land).toFixed(1)}`).join(' · '));
}

let drift = null, planets = {};
if (!QUICK) {
    // ── Drift across terrain resolutions: the same climate grid, so the class shares must agree ──
    drift = {};
    const share = (k) => { const s = new Float64Array(64); let n = 0; for (let r = 0; r < k.length; r++) if (k[r]) { s[k[r]]++; n++; } return s.map(x => x / n); };
    const s160 = share(main.res.cell.koppen);
    for (const N of [640000, 2500000]) {
        const E = earthAt(N), e = evaluate(E);
        const s = share(e.res.cell.koppen); let tv = 0; for (let i = 0; i < 64; i++) tv += Math.abs(s[i] - s160[i]) / 2;
        drift[N] = { exact: e.exact, classShareTV: tv, ms: e.ms };
        console.log(`  ${N.toLocaleString()} cells: Köppen ${pc(e.exact)}; class shares differ from 160K by ${(100 * tv).toFixed(2)} %; ${e.ms.toFixed(0)} ms`);
    }
    // ── Test planets: the whole climate, Köppen shares by regime ──
    for (const kind of Object.keys(TEST_PLANETS)) {
        const p = buildTestPlanet(kind, 40000, buildSphere, makeRng(7));
        const t0 = performance.now();
        const res = computeClimate({ xyz: p.xyz, elevKm: p.elevKm, axes: p.axes }, { stages: stages() });
        const counts = {}; let n = 0;
        for (let r = 0; r < res.cell.koppen.length; r++) { const k = res.cell.koppen[r]; if (!k) continue; n++; const code = KOPPEN_CLASSES[k].code; counts[code] = (counts[code] ?? 0) + 1; }
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, v / n]);
        planets[kind] = { ms: performance.now() - t0, classes: Object.fromEntries(top) };
        console.log(`  ${TEST_PLANETS[kind].label}: ${top.map(([k, v]) => `${k} ${(100 * v).toFixed(0)} %`).join(', ')} (${planets[kind].ms.toFixed(0)} ms)`);
    }
}

const gate = {
    beatsV1: main.exact > 0.38,
    guardrails: g.temperature <= 4.6 && g.sst <= 3.5,
    noDrift: drift ? Object.values(drift).every(d => d.classShareTV < 0.02) : null,
};
console.log(`\nGate: Köppen beats V1 ${gate.beatsV1 ? '✓' : '✗'} · stage guardrails ${gate.guardrails ? '✓' : '✗'}${drift ? ` · no drift ${gate.noDrift ? '✓' : '✗'}` : ''}`);

const results = {
    tuned: tuneLog, params: { ...PARAMS },
    earth: { ms: main.ms, timing: main.res.timing, exact: main.exact, major: main.major, macroF1: main.macroF1, perCont: main.perCont, meanCont: main.meanCont,
        regimes: Object.fromEntries(Object.entries(main.regimes).map(([k, r]) => [k, { recall: r.recall, areaRatio: r.areaRatio }])), guard: main.guard,
        withoutClouds: { exact: noClouds.exact, meanCont: noClouds.meanCont, guard: noClouds.guard } },
    drift, planets, gate,
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'coupled-check.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(LAB_DIR, 'coupled-check.json'), JSON.stringify(results));
console.log(`Wrote ${path.relative(process.cwd(), path.join(OUT_DIR, 'coupled-check.json'))}`);
resetParams();
