#!/usr/bin/env node
// Report-only check (lane iceage, 2026-11-25): the ice age's code on Earth's own ground, against where Earth's ice was. A BUG
// check, not a target to fit (Earth is N of 1): Earth's ground (ETOPO5 on the 160K terrain mesh, make-earth-surface.mjs)
// goes through the finish's own climate (GPU, as finish.js climateOn: the warmest month at sea level, the year's rain) and
// finish-ice.js glacialSheets and lastIceAge, and its ice is laid against ICE-6G_C's at 21 ka (Peltier, Argus & Drummond 2015; the artifact
// make-earth-ice.mjs). Where the code puts ice Earth never had — or misses the ice Earth had — the mechanism is what to fix:
// what the climate or the ice gets wrong under Earth's own conditions, not a constant to move toward Earth's numbers.
// It also asks the climate of TODAY, with no ice age, two questions whose answers on Earth are known:
//   · a positive-degree-day mass balance from the climate's own months (Reeh 1991; Braithwaite 1995; a reduced model here:
//     σ 5 K of daily scatter about each month, snow below 1 °C, melt 3 mm w.e. per degree-day of snow and 8 of ice, 60 % of
//     the snow's melt refreezing): is the snow kept where Earth keeps it (its ice sheets, and ~0.7 Mkm² of glaciers)?
//   · the climate's own ice sheets (temperature.js: ground snowy most of the year, TEMP_ICE_FORM): where are they?
// Earth's ground here carries today's sheets' surfaces (ETOPO5), so Antarctica and Greenland stand on their own ice: what
// matters elsewhere is unaffected. Prints REPORT lines and always exits 0 unless the inputs are missing.
//
//   node v2/tools/check-iceage-earth.mjs        (needs a GPU: Dawn in Node, through check-kit)
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { check, report, section, finish } from './lib/check-kit.mjs';
import { earthSurfaceKm, earthIce, EARTH_ICE_MESH } from './lib/earth-surface.mjs';
import { MESH_SEED } from './lib/moment-frame.mjs';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { worldOcean } from '../js/terrain/world-ocean.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { planetClimateAsync } from '../js/climate/climate.js';
import { CORE_DEFAULTS } from '../js/climate/core.js';
import { climateSolverKit } from '../js/gpu/climate-solver.js';
import { cellClimateGPU } from '../js/gpu/climate-cells.js';
import { finishDevice } from '../js/gpu/finish-gpu.js';
import { FINISH } from '../js/finish/finish-config.js';
import { LatLonGrid } from '../js/finish/finish-grid.js';
import { lastIceAge, glacialSheets } from '../js/finish/finish-ice.js';
import { measureIceGrid } from './lib/ice-grid-measure.mjs';
import { bilinear } from '../js/finish/finish.js';
import { EARTH_SYSTEM, EARTH_CYCLE, orbitAt, starCalendar, solarConstantOf, albedoRatios, co2At, greenhouseOf } from '../js/climate/planet-system.js';
import { declination } from '../js/climate/insolation.js';

setDelaunator(Delaunator);
// (ICE_MESH_CELLS=40000: the ice grown on another ice mesh — lane iceage's ice-grid study; the measure's lines printed either way)
const F = process.env.ICE_MESH_CELLS ? { ...FINISH, iceMeshCells: Number(process.env.ICE_MESH_CELLS) } : FINISH, t0 = performance.now();

// ── the planet and its star (planet-system.js): its orbit at three epochs against PMIP's (Otto-Bliesner et al. 2017 for
// 6 ka, Kageyama et al. 2017 for 21 ka: e, ε, ϖ from Berger 1978), the circular orbit as e = 0, Earth's perihelion ──
section('the planet and its star');
{
    const cyc = k => orbitAt({ ...EARTH_SYSTEM, orbit: { ...EARTH_SYSTEM.orbit, cycle: EARTH_CYCLE }, epochKyr: k });
    const near = (o, e, ob, w) => Math.abs(o.eccentricity - e) < 2e-4 && Math.abs(o.obliquityDeg - ob) < 0.01 && Math.abs(((o.perihelionSunLonDeg - 180 - w + 540) % 360) - 180) < 0.2;
    const o0 = cyc(0), o6 = cyc(6), o21 = cyc(21), fmt = o => `e ${o.eccentricity.toFixed(5)}, ${o.obliquityDeg.toFixed(3)}°, ϖ ${(o.perihelionSunLonDeg - 180).toFixed(2)}°`;
    check('Berger 1978 at 1950, 6 ka and 21 ka: PMIP\'s orbits', near(o0, 0.016724, 23.446, 102.04) && near(o6, 0.018682, 24.105, 0.87) && near(o21, 0.018994, 22.949, 114.42), `${fmt(o0)} · ${fmt(o6)} · ${fmt(o21)}`);
    const circ = starCalendar({ orbit: { eccentricity: 0 } });
    let d = 0; for (let t = 0; t < 12; t += 0.13) d = Math.max(d, Math.abs(circ.at(t).declination - declination(t, 23.44)), Math.abs(circ.at(t).irradiance - 1361));
    check('e = 0: the circular orbit exactly', d < 1e-9, `max difference ${d.toExponential(1)}`);
    const cal = starCalendar(); let best = 0, tb = 0; for (let t = 0; t < 12; t += 0.01) { const q = cal.at(t).irradiance; if (q > best) { best = q; tb = t; } }
    check('Earth: nearest the Sun in early January, 3.4 % above the mean', tb > 0 && tb < 0.3 && Math.abs(best / solarConstantOf() - (1 + 0.0167) ** 2 / (1 - 0.0167 ** 2) ** 2) < 1e-6, `t ${tb.toFixed(2)} months, ${best.toFixed(1)} W/m²`);
    const lgm = co2At({ epochKyr: 21 }), f0 = greenhouseOf(), f21 = greenhouseOf({ epochKyr: 21 });
    check('the air\'s CO2 (Bereiter et al. 2015): the LGM\'s ~190 ppm, no forcing at the present', Math.abs(lgm - 190) < 8 && f0 === 0 && f21 < -1.8 && f21 > -2.4, `pre-industrial ${co2At().toFixed(1)} ppm; 21 ka ${lgm.toFixed(1)} ppm, ${f21.toFixed(2)} W/m²`);
    const r = albedoRatios(), m = albedoRatios({ star: { teffK: 3400 } });
    check('the Sun leaves the snow\'s and the ice\'s albedo as they are; an M dwarf darkens them', r.snow === 1 && r.ice === 1 && m.snow < 0.7 && m.ice < 0.35, `M3.5: snow × ${m.snow.toFixed(2)}, ice × ${m.ice.toFixed(2)} (Shields et al. 2013)`);
}
const mesh = terrainMesh(EARTH_ICE_MESH), n = mesh.numCells, x = mesh.xyz, cellKm2 = 4 * Math.PI * 6371 ** 2 / n;
const S = earthSurfaceKm(mesh, { terrain: true }), I6 = earthIce(mesh);
section('inputs');
check('Earth\'s ground and ICE-6G_C\'s ice on the 160K terrain mesh', !S.error && !I6.error, S.error ?? I6.error ?? '');
if (S.error || I6.error) process.exit(finish('iceage-earth'));
const z = S.z, lat = new Float32Array(n), lon = new Float32Array(n);
for (let c = 0; c < n; c++) { lat[c] = Math.asin(x[3 * c + 2]) * 180 / Math.PI; lon[c] = Math.atan2(x[3 * c + 1], x[3 * c]) * 180 / Math.PI; }
const ocean = worldOcean(mesh, z, 0).ocean, land = Uint8Array.from(ocean, o => o ? 0 : 1);

// ── the climate, as the finish runs it (finish.js climateOn) ──
const device = await finishDevice(), solver = await climateSolverKit(device);
let res;
try { res = await planetClimateAsync({ xyz: x, elevKm: z, axes: 'z-up', land }, { cells: false, solver }); } finally { solver.release(); }
res.cell = await cellClimateGPU(device, res, x, z, land, {});
const G = res.grid.size, cg = { w: res.grid.w, h: res.grid.h }, gamma = CORE_DEFAULTS.lapseRateCPerKm;
const href = g => res.surface.meanLandKm[g] === res.surface.meanLandKm[g] ? res.surface.meanLandKm[g] : 0;
const warmG = new Float32Array(G).fill(-Infinity), Tsl = new Float32Array(12 * G);
for (let g = 0; g < G; g++) for (let m = 0; m < 12; m++) { const t = Tsl[m * G + g] = res.months.T[m * G + g] + gamma * href(g); if (t > warmG[g]) warmG[g] = t; }
const warmSl = new Float32Array(n), rain = Float32Array.from(res.cell.pAnnual, p => Math.min(p, F.rainMaxMm));
for (let c = 0; c < n; c++) warmSl[c] = bilinear(cg, warmG, lat[c], lon[c]);

// ── the ice age on Earth (finish-ice.js: its sheets grown under the inception's and the maximum's climate, glacialSheets, on
// Earth's bed — ETOPO5 less today's ice, ICE-6G_C's at 0 ka, so today's sheets grow anew from their beds as the sim's do;
// the plate under the ice a uniform 50 km thick: its bend moves the ground the ice leaves, not where the ice is) ──
const bedE = Float32Array.from(z, (v, c) => v - (I6.thickNowKm ? I6.thickNowKm[c] : 0)), tg = performance.now();
const GS = await glacialSheets({ device, mesh, z: bedE, climateOptions: {} }, F);
const simMesh = buildSimMesh(40000, MESH_SEED), zi = bedE.slice();
const LIA = lastIceAge({ mesh, z: zi, lat, lon, warmSl, rain, grid: new LatLonGrid(0.25), cellKm2, seed: 1, soft: null, land, simMesh, teSim: new Float32Array(simMesh.numCells).fill(50), sheet: GS }, F).ice;
const iceAgeS = (performance.now() - tg) / 1000;
measureIceGrid({ mesh, z: bedE, sheet: GS, iceMeshCells: F.iceMeshCells, label: 'Earth' });
// (ICE-6G_C's 21 ka ice measured the same way — no speeds: its area, pieces and margin the reference)
measureIceGrid({ mesh, z: bedE, sheet: { ...GS, ice: I6.lgm, uSlide: new Float32Array(n), ms: 0, rounds: [] }, iceMeshCells: F.iceMeshCells, label: 'Earth ICE-6G_C 21 ka' });

// ── today's climate: a positive-degree-day mass balance, and the climate's own ice sheets ──
const SIG = 5, erf = v => { const t = 1 / (1 + 0.3275911 * Math.abs(v)), y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-v * v); return v >= 0 ? y : -y; };
const Phi = v => 0.5 * (1 + erf(v / Math.SQRT2)), pdd = T => 30.4 * (SIG / Math.sqrt(2 * Math.PI) * Math.exp(-T * T / (2 * SIG * SIG)) + T * Phi(T / SIG));
const kept = new Uint8Array(n), sheet = new Uint8Array(n), layer = new Float32Array(G), iceF = res.stages.temperature.iceFrac;
const monthAt = (A, m, c) => { layer.set(A.subarray(m * G, (m + 1) * G)); return bilinear(cg, layer, lat[c], lon[c]); };
for (let c = 0; c < n; c++) {
    if (!land[c]) continue;
    const Tm = [], Pm = []; let P = 0;
    for (let m = 0; m < 12; m++) { Tm.push(monthAt(Tsl, m, c) - gamma * Math.max(0, z[c])); const p = Math.max(0, monthAt(res.months.P, m, c)); Pm.push(p); P += p; }
    let snow = 0, D = 0;
    for (let m = 0; m < 12; m++) { snow += (P > 0 ? Pm[m] * rain[c] / P : 0) * Phi((1 - Tm[m]) / SIG); D += pdd(Tm[m]); }
    const snowMelt = Math.min(snow, 3 * D);
    kept[c] = snow - 0.4 * snowMelt - 8 * (D - snowMelt / 3) > 0 ? 1 : 0;
    sheet[c] = iceF?.length === G && bilinear(cg, iceF, lat[c], lon[c]) >= 0.5 ? 1 : 0;
}

const REGIONS = [
    ['Laurentide and Cordillera (North America 38–85° N, not Greenland or Alaska)', (a, o) => a > 38 && a < 85 && o > -142 && o < -50 && !(a > 59 && o > -74)],
    ['the Laurentide\'s south (North America 38–50° N)', (a, o) => a > 38 && a < 50 && o > -142 && o < -50],
    ['NW Eurasia (Fennoscandia, Britain, Barents–Kara: 45–85° N, 12° W–70° E)', (a, o) => a > 45 && a < 85 && o > -12 && o < 70],
    ['Siberia and NE Asia (45–85° N, 70–180° E)', (a, o) => a > 45 && a < 85 && o >= 70],
    ['Alaska and Beringia (55–75° N, 142–180° W)', (a, o) => a > 55 && a < 75 && o <= -142],
    ['High Asia (25–45° N, 65–105° E)', (a, o) => a > 25 && a <= 45 && o > 65 && o < 105],
    ['Greenland', (a, o) => a > 59 && a < 84 && o > -74 && o < -10],
    ['Antarctica', a => a < -60],
    ['Patagonia (35–56° S, 60–80° W)', (a, o) => a > -56 && a < -35 && o > -80 && o < -60],
];
// (where Earth had little or no ice, its range; elsewhere ICE-6G_C's figure is in the detail, not a range to fit)
const EARTH_RANGE = {
    'Siberia and NE Asia (45–85° N, 70–180° E)': [[0, 1], 'the LGM\'s Eurasian ice ended at the Kara Sea; ice caps on Taymyr, Putorana and the eastern ranges (Svendsen et al. 2004; Hughes et al. 2016 DATED-1)'],
    'High Asia (25–45° N, 65–105° E)': [[0, 0.35], 'no Tibetan ice sheet; the plateau\'s LGM glaciers ~0.35 Mkm² (Shi 2002; Owen & Dortch 2014)'],
};
const Mkm2 = (mask, f) => { let s = 0; for (let c = 0; c < n; c++) if (mask[c] && f(lat[c], lon[c])) s++; return s * cellKm2 / 1e6; };
const both = (a, b, f) => { let s = 0; for (let c = 0; c < n; c++) if (a[c] && b[c] && f(lat[c], lon[c])) s++; return s * cellKm2 / 1e6; };

section('the ice age on Earth\'s ground and climate (finish-ice.js) against ICE-6G_C at 21 ka');
{
    for (const r of GS.rounds) console.log(`  round at ${r.epochKyr} ka, ${r.kyr} kyr (${r.steps} steps, ${(r.ms / 1000).toFixed(1)} s): ice ${r.iceMkm2.toFixed(1)} Mkm², ${r.iceMkm3.toFixed(1)} M km³, sea ${r.seaM.toFixed(0)} m`);
    // (today's ice as the sea's: its volume, ρ_i/ρ_sea of it over today's sea — the LGM's drop is against today's sea, which
    // already lacks it)
    let today = 0, seaKm2 = 0; const o = worldOcean(mesh, bedE, 0).ocean;
    for (let c = 0; c < n; c++) { today += (I6.thickNowKm ? I6.thickNowKm[c] : 0) * cellKm2; if (o[c]) seaKm2 += cellKm2; }
    const todayM = -1000 * today * (910 / 1028) / seaKm2, drop = 1000 * GS.seaKm - todayM;
    report('the glacial maximum\'s sea, against today\'s', drop, { earth: [-135, -115], unit: ' m', digits: 0, source: 'LGM eustatic sea level −120 to −134 m (Clark et al. 2009; Lambeck et al. 2014)', detail: `the ice's own drop ${(1000 * GS.seaKm).toFixed(0)} m from an ice-free Earth; today's ice ${todayM.toFixed(0)} m of it (${(today / 1e6).toFixed(1)} M km³); ${GS.rounds.length} rounds in ${iceAgeS.toFixed(1)} s` });
}
for (const [name, f] of REGIONS) {
    const sim = Mkm2(LIA, f), lgm = Mkm2(I6.lgm, f), hit = both(LIA, I6.lgm, f), [earth, source] = EARTH_RANGE[name] ?? [null, ''];
    report(`${name}: the ice age's ice`, sim, { earth, unit: ' Mkm²', source, detail: `ICE-6G_C 21 ka ${lgm.toFixed(2)} Mkm²; of it covered ${lgm > 0 ? (100 * hit / lgm).toFixed(0) : '–'} %; of the ice age's, outside ICE-6G_C's ${sim > 0 ? (100 * (sim - hit) / sim).toFixed(0) : '–'} %` });
}
{
    const all = () => true, sim = Mkm2(LIA, all), lgm = Mkm2(I6.lgm, all), hit = both(LIA, I6.lgm, all);
    report('all: the ice age\'s ice', sim, { unit: ' Mkm²', detail: `ICE-6G_C 21 ka ${lgm.toFixed(1)} Mkm² (Peltier et al. 2015); covered ${(100 * hit / lgm).toFixed(0)} %, outside it ${(100 * (sim - hit) / sim).toFixed(0)} %` });
}

section('today\'s climate: where its snow outlasts the year, and its own ice sheets');
{
    const free = Uint8Array.from(I6.now, v => v ? 0 : 1), all = () => true;
    const RGI = [0, 0.75], RGI_SRC = 'glaciers and ice caps outside the two sheets, those on their margins included: ~0.71 Mkm² (RGI Consortium 2017)';
    report('a degree-day mass balance: snow kept where today has no ice sheet', both(kept, free, all), { earth: RGI, unit: ' Mkm²', source: RGI_SRC, detail: `of today's sheets (ICE-6G_C 0 ka ${Mkm2(I6.now, all).toFixed(1)} Mkm²) it keeps snow on ${(100 * both(kept, I6.now, all) / Mkm2(I6.now, all)).toFixed(0)} %` });
    report('the climate\'s own ice sheets (temperature.js) where today has none', both(sheet, free, all), { earth: RGI, unit: ' Mkm²', source: RGI_SRC, detail: `Siberia and NE Asia ${both(sheet, free, REGIONS[3][1]).toFixed(2)}, High Asia ${both(sheet, free, REGIONS[5][1]).toFixed(2)} Mkm²; on today's sheets ${(100 * both(sheet, I6.now, all) / Mkm2(I6.now, all)).toFixed(0)} %` });
}
console.log(`(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(finish('iceage-earth'));
