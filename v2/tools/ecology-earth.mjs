#!/usr/bin/env node
// The Life section's numbers on Earth (ecodesign L0; js/ecology/now.js), report-only: does today's-grade ecology, given
// Earth's conditions, give Earth's productivity, herbivores, predators and seas?
//   A. Earth's OBSERVED climate (Beck et al. 2023 1° months, the climate lab's references) → each land cell's habitat, NPP,
//      herbivores and predators: NPP by habitat and the land's total against the literature; Africa's savannas against
//      Fløjgaard et al.'s parks and Hatton et al.'s pyramid; named places → their habitat.
//   B. The MODEL's climate on Earth's ground (computeClimate on assets/earth.png, as the climate checks run it) → the sea:
//      Peru, Benguela, Canary and California read as upwelling seas, the gyres as oligotrophic, and the share of the ocean
//      that upwells (Ryther 1969: ~0.1 %).
// Needs the climate references (node tuning/climate/fetch-references.mjs && node tuning/climate/regrid-references.mjs).
//   node v2/tools/ecology-earth.mjs [--n 40000] [--json out.json]

import fs from 'node:fs';
import { report, check, section, finish } from './lib/check-kit.mjs';
import { loadReferences } from '../../tuning/climate/lib/ref.mjs';
import { loadEarthGrayscale } from '../../tuning/climate/lib/earth-context.mjs';
import { buildEarthMesh } from '../../tuning/climate/lib/earth-mesh.mjs';
import { elevToHeightKm } from '../../js/color-map.js';
import { computeClimate } from '../js/climate/core.js';
import { energyBalanceTemperature } from '../js/climate/temperature.js';
import { derivedCirculation } from '../js/climate/circulation.js';
import { windDrivenOcean } from '../js/climate/ocean.js';
import { columnWaterRain } from '../js/climate/rain.js';
import { classifyCell } from '../js/climate/koppen.js';
import { pageClimate } from '../js/evolution/climate-fields.js';
import { lifeFacts, LIFE, upwellingMd } from '../js/ecology/now.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('--n', 40000), JSON_OUT = arg('--json', null), R_KM = 6371;
const out = {};

// ── the model's climate on Earth (B), whose 1° surface also gives A its heights ──
const t0 = performance.now();
const { gray, width, height } = loadEarthGrayscale();
const e = buildEarthMesh(gray, width, height, { N });
const elevKm = new Float32Array(e.mesh.numRegions);
for (let r = 0; r < elevKm.length; r++) elevKm[r] = elevToHeightKm(e.r_elevation[r]);
const res = computeClimate({ xyz: e.r_xyz, elevKm, axes: 'y-up' },
    { stages: { temperature: energyBalanceTemperature(), circulation: derivedCirculation(), ocean: windDrivenOcean(), rain: columnWaterRain() } });
const C = pageClimate(res, { cells: false }), G = res.grid, S = res.surface;
console.log(`model climate on Earth (${N / 1000}K): ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const latOf = j => 90 - (j + 0.5) * 180 / G.h, lonOf = i => -180 + (i + 0.5) * 360 / G.w;
const cellKm2 = j => (2 * Math.PI * R_KM * R_KM / G.w) * (Math.sin((latOf(j) + 0.5) * Math.PI / 180) - Math.sin((latOf(j) - 0.5) * Math.PI / 180));
function gcKm(la1, lo1, la2, lo2) {
    const r = Math.PI / 180, a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** km from grid cell (i, j) to the nearest cell on the other side of `isLand` (up to 1500 km; Infinity past it). */
function coastKm(isLand, i, j) {
    const me = isLand(i, j), la = latOf(j), lo = lonOf(i);
    let best = Infinity;
    for (let dj = -14; dj <= 14; dj++) {
        const y = j + dj;
        if (y < 0 || y >= G.h) continue;
        const rx = Math.min(G.w >> 1, Math.ceil(14 / Math.max(0.05, Math.cos(latOf(y) * Math.PI / 180))));
        for (let di = -rx; di <= rx; di++) {
            const x = (((i + di) % G.w) + G.w) % G.w;
            if (isLand(x, y) === me) continue;
            const d = gcKm(la, lo, latOf(y), lonOf(x));
            if (d < best) best = d;
        }
    }
    return best <= 1500 ? best : Infinity;
}

// ── A: Earth's observed climate ──
section('A. Earth\'s observed climate → the land\'s life (Beck et al. 2023 months)');
const ref = loadReferences(), RG = ref.grid, RS = RG.size;
if (RG.w !== G.w || RG.h !== G.h) throw new Error('reference grid differs from the climate grid');
const obsLand = (i, j) => ref.land[j * RG.w + i] === 1;
// (the observed sea for nearSea: its SST months, the anomaly against its latitude's mean; the model's upwelling)
const sst = ref.fields.sst, seaMask = new Uint8Array(RS), Ts = { year: new Float32Array(RS), jan: new Float32Array(RS), jul: new Float32Array(RS) }, anom = new Float32Array(RS);
for (let c = 0; c < RS; c++) {
    if (sst[c] !== sst[c] || ref.land[c]) continue;
    seaMask[c] = 1;
    let s = 0; for (let m = 0; m < 12; m++) s += sst[m * RS + c];
    Ts.year[c] = s / 12; Ts.jan[c] = sst[c]; Ts.jul[c] = sst[6 * RS + c];
}
for (let j = 0; j < RG.h; j++) {
    let s = 0, k = 0;
    for (let i = 0; i < RG.w; i++) if (seaMask[j * RG.w + i]) { s += Ts.year[j * RG.w + i]; k++; }
    for (let i = 0; i < RG.w; i++) anom[j * RG.w + i] = k ? Ts.year[j * RG.w + i] - s / k : 0;
}
const Cobs = { grid: { w: RG.w, h: RG.h }, sea: seaMask, Tsea: Ts, sstAnom: { year: anom }, upwelling: C.upwelling };

const byHab = new Map(), lifeAt = new Map();
let nppPgC = 0, landKm2 = 0;
for (let j = 0; j < RG.h; j++) for (let i = 0; i < RG.w; i++) {
    const c = j * RG.w + i;
    if (!ref.land[c]) continue;
    const T12 = new Float64Array(12), P12 = new Float64Array(12);
    let tA = 0, pA = 0;
    for (let m = 0; m < 12; m++) { T12[m] = ref.fields.t2m[m * RS + c]; P12[m] = ref.fields.precip[m * RS + c]; tA += T12[m] / 12; pA += P12[m]; }
    const lat = latOf(j), lon = lonOf(i), koppen = classifyCell(T12, P12);
    const F = { kind: 'land', lat, lon, heightM: 1000 * Math.max(0, S.meanLandKm?.[c] ?? 0), coastKm: coastKm(obsLand, i, j), simCell: -1, timeMyr: 0,
        climate: { source: 'observed', land: true, koppen, tAnnual: tA, pAnnual: pA, T12, P12 } };
    const L = lifeFacts(F, Cobs, null);
    if (!L) continue;
    const a = cellKm2(j);
    lifeAt.set(c, L);
    landKm2 += a; nppPgC += L.npp * LIFE.carbonPerDm * a * 1e6 / 1e15;
    const h = byHab.get(L.habitat) ?? { km2: 0, npp: 0, herb: 0, pred: 0, list: [] };
    h.km2 += a; h.npp += a * L.npp; h.herb += a * L.herbivores; h.pred += a * L.predators; h.list.push(L.npp);
    byHab.set(L.habitat, h);
}
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
report('the land\'s NPP (Miami on the observed months)', nppPgC, { earth: [50, 65], unit: 'Pg C/yr', digits: 1, source: 'Field et al. 1998 (Science 281: 237): 56.4 Pg C/yr; satellite MODIS ~53–60 (Zhao & Running 2010)' });
// (NPP by habitat, g dry matter /m²/yr: Whittaker & Likens 1975's ranges by ecosystem — recalled, the table not re-read)
const NPP_RANGE = {
    'tropical-rainforest': [1000, 3500], 'tropical-dry-forest': [1000, 2500], 'tropical-savanna': [200, 2000], 'temperate-broadleaf': [600, 2500],
    'temperate-conifer': [600, 2500], 'temperate-rainforest': [600, 2500], boreal: [400, 2000], 'temperate-grassland': [200, 1500], mediterranean: [250, 1200],
    'xeric-shrubland': [10, 250], desert: [0, 250], 'fog-desert': [0, 250], tundra: [10, 400], alpine: [10, 400], 'polar-desert': [0, 10],
};
out.habitats = {};
for (const [k, h] of [...byHab].sort((a, b) => b[1].km2 - a[1].km2)) {
    const mean = h.npp / h.km2, med = median(h.list);
    out.habitats[k] = { Mkm2: h.km2 / 1e6, nppMean: mean, nppMedian: med, herbMean: h.herb / h.km2, predMean: h.pred / h.km2 };
    report(`${k} (${(h.km2 / 1e6).toFixed(1)} Mkm²): NPP median`, med, { earth: NPP_RANGE[k], unit: 'g DM/m²/yr', digits: 0,
        source: NPP_RANGE[k] ? 'Whittaker & Likens 1975 normal range (recalled)' : 'no range', detail: `herbivores ${Math.round(h.herb / h.km2)} kg/km² · predators ${Math.round(h.pred / h.km2)} kg/km²` });
}
// Africa's savannas and grasslands against the parks
const af = [];
for (const [c, L] of lifeAt) {
    const j = Math.floor(c / RG.w), i = c % RG.w, lat = latOf(j), lon = lonOf(i);
    if (lat > -35 && lat < 15 && lon > -18 && lon < 52 && (L.habitat === 'tropical-savanna' || L.habitat === 'temperate-grassland' || L.habitat === 'xeric-shrubland')) af.push(L);
}
const afHerb = median(af.map(L => L.herbivores)), afPred = median(af.map(L => L.predators));
report('Africa\'s savannas, grasslands and scrub: large-herbivore biomass, median', afHerb, { earth: [700, 13400], unit: 'kg/km²', digits: 0,
    source: 'Fløjgaard et al. 2022 Table 1: African ecosystems now, mean 7,074 ± 6,371 (n = 69); range = mean ± 1 sd' });
report('… their large predators, median', afPred, { earth: [10, 200], unit: 'kg/km²', digits: 0, source: 'Hatton et al. 2015 Fig. 1: African parks\' predators span ~10–200 kg/km² (read off the figure)' });
report('… predator ÷ prey', 100 * afPred / afHerb, { earth: [0.5, 3], unit: '%', digits: 2, source: 'Hatton et al. 2015: 0.094·B^0.73 ÷ B over B 1,000–20,000 kg/km² → 1.4–0.6 %' });
check('the pyramid narrows upward everywhere (predators < herbivores; both ≥ 0)', [...lifeAt.values()].every(L => L.predators >= 0 && L.herbivores >= 0 && (L.herbivores === 0 || L.predators < L.herbivores)));
check('every habitat named is one of the frozen keys', [...byHab.keys()].every(k => k && typeof k === 'string'));

const PLACES = [
    ['Amazon (Manaus)', -3.1, -60.0, ['tropical-rainforest']], ['Congo basin', 0.5, 23.0, ['tropical-rainforest', 'tropical-dry-forest']],
    ['Serengeti', -2.5, 34.8, ['tropical-savanna']], ['Sahara (Tibesti foreland)', 23.0, 12.0, ['desert']],
    ['Namib coast (Walvis Bay)', -22.9, 14.6, ['fog-desert']], ['Atacama coast (Antofagasta)', -23.6, -70.3, ['fog-desert']],
    ['Siberian taiga', 62.0, 100.0, ['boreal']], ['Germany', 51.0, 10.0, ['temperate-broadleaf']], ['Iowa', 42.0, -93.5, ['temperate-grassland', 'temperate-broadleaf']],
    ['Kazakh steppe', 50.0, 70.0, ['temperate-grassland']], ['Olympic peninsula', 47.8, -123.9, ['temperate-rainforest', 'temperate-conifer']],
    ['California coast', 34.3, -118.6, ['mediterranean']], ['Tibetan plateau', 33.0, 88.0, ['alpine', 'montane-grassland', 'polar-desert']],
    ['Taymyr', 73.0, 100.0, ['tundra']], ['Sundarbans', 22.5, 89.5, ['mangrove', 'tropical-dry-forest', 'tropical-rainforest']],
];
const at = (lat, lon) => { const j = Math.min(RG.h - 1, Math.floor((90 - lat) * RG.h / 180)), i = Math.min(RG.w - 1, Math.floor((lon + 180) * RG.w / 360)); return lifeAt.get(j * RG.w + i); };
let hits = 0;
out.places = {};
for (const [name, lat, lon, want] of PLACES) {
    const L = at(lat, lon), ok = L && want.includes(L.habitat);
    hits += ok ? 1 : 0;
    out.places[name] = L ? { habitat: L.habitat, npp: L.npp, herb: L.herbivores, pred: L.predators, azonal: L.azonal } : null;
    console.log(`  ${ok ? '✓' : '✗'} ${name}: ${L ? `${L.habitat} · NPP ${Math.round(L.npp)} · herbivores ${Math.round(L.herbivores)} kg/km² · predators ${Math.round(L.predators)}` : 'no land cell'}  (want ${want.join(' | ')})`);
}
report('named places read as their habitat', hits, { earth: [PLACES.length - 2, PLACES.length], unit: `of ${PLACES.length}`, digits: 0, source: 'WWF biomes (Olson et al. 2001) at each place' });

// ── B: the sea, on the model's climate ──
section('B. The model\'s climate on Earth → the sea\'s provinces (Ryther 1969)');
const modelLand = (i, j) => (S.landFrac?.[j * G.w + i] ?? 0) >= 0.5;
const seaAt = (lat, lon) => {
    const j = Math.min(G.h - 1, Math.floor((90 - lat) * G.h / 180)), i = Math.min(G.w - 1, Math.floor((lon + 180) * G.w / 360)), c = j * G.w + i;
    if (C.sea[c] !== 1) return null;
    const v = f => f.year[c];
    const F = { kind: 'ocean', lat, lon, heightM: 1000 * Math.min(0, S.meanKm?.[c] ?? -4), coastKm: coastKm(modelLand, i, j), simCell: -1,
        climate: { source: 'model', land: false, sea: { tYear: v(C.Tsea), tJan: C.Tsea.jan[c], tJul: C.Tsea.jul[c], ice: C.seaIce ? Math.max(0, Math.min(1, C.seaIce.year[c])) : 0, upwelling: Math.max(0, C.upwelling.year[c]) } } };
    return lifeFacts(F, C, null);
};
// (the upwelling seas sit within ~100–300 km of their coasts: the nearest sea cell with the strongest upwelling in a 3° box)
const coastalSea = (lat, lon) => {
    let best = null;
    for (let dy = -1.5; dy <= 1.5; dy += 1) for (let dx = -1.5; dx <= 1.5; dx += 1) {
        const L = seaAt(lat + dy, lon + dx);
        if (L && (!best || L.sea.upwelling > best.sea.upwelling)) best = L;
    }
    return best;
};
out.seas = {};
const SEAS = [['Peru (Humboldt)', -12, -78.5, 'upwelling'], ['Benguela', -24, 13.5, 'upwelling'], ['Canary', 24, -16.5, 'upwelling'], ['California', 37, -123.5, 'upwelling'],
    ['N Pacific gyre', 25, -150, 'oceanic'], ['S Pacific gyre', -25, -120, 'oceanic'], ['N Atlantic (spring bloom)', 50, -25, 'coastal']];
let seaHits = 0;
for (const [name, lat, lon, want] of SEAS) {
    const L = want === 'upwelling' ? coastalSea(lat, lon) : seaAt(lat, lon), ok = L?.web?.province === want;
    seaHits += ok ? 1 : 0;
    out.seas[name] = L ? { habitat: L.habitat, province: L.web.province, upwelling: L.sea.upwelling, sst: L.sea.tYear, fishC: L.web.fishC } : null;
    console.log(`  ${ok ? '✓' : '✗'} ${name}: ${L ? `${L.habitat} (${L.web.province}) · upwelling ${L.sea.upwelling.toFixed(2)} m/day · SST ${L.sea.tYear.toFixed(1)} °C · fish ${L.web.fishC.toPrecision(2)} g C/m²/yr` : 'no sea cell'}  (want ${want})`);
}
report('the eastern-boundary upwelling seas and the gyres read as Ryther\'s provinces', seaHits, { earth: [SEAS.length - 1, SEAS.length], unit: `of ${SEAS.length}`, digits: 0, source: 'Ryther 1969: Peru, Benguela, Canary, California upwelling; the subtropical gyres oceanic' });
let upKm2 = 0, seaKm2 = 0;
for (let j = 0; j < G.h; j++) for (let i = 0; i < G.w; i++) {
    const c = j * G.w + i;
    if (C.sea[c] !== 1) continue;
    const a = cellKm2(j);
    seaKm2 += a;
    if (C.upwelling.year[c] >= upwellingMd() && coastKm(modelLand, i, j) <= 300) upKm2 += a;
}
report('upwelling seas (≥ the transport threshold, within the 300 km coastal zone) as a share of the ocean', 100 * upKm2 / seaKm2, { earth: [0.05, 1], unit: '%', digits: 2, source: 'Ryther 1969: upwelling regions ~0.1 % of the ocean (~0.36 Mkm²)' });
const fishPt = (prov) => LIFE.sea[prov][0] * LIFE.sea[prov][2] ** LIFE.sea[prov][1];
report('fish yield, upwelling ÷ open ocean (Ryther\'s ladder)', fishPt('upwelling') / fishPt('oceanic'), { unit: '×', digits: 0, detail: 'Ryther: the upwelling ~0.1 % of the sea makes about half the fish' });

if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
finish('Ecology on Earth (today\'s grade)');
