// The Life section at today's grade (ecology/now.js lifeFacts, ecology/life-panel.js; lanes ecodesign L0), on synthetic places:
// no history, no finish, no Earth references — a sweep of made-up climates, heights, coasts and seas through the same calls the
// panel makes. It holds the contract, not Earth's numbers (those are v2/tools/ecology-earth.mjs's, a report run on the observed
// climate): every key the core emits is in the analogue lane's frozen vocabulary (ecology/analogues/keys.js); the numbers are
// finite; the pyramid narrows upward (plants' growth > herbivores > predators, plankton > fish); the measured relations keep
// their shape (more growth feeds more herbivores, the predators' share falls as prey thickens — Hatton et al. 2015's
// exponent < 1; Ryther's provinces rank upwelling > coastal > open ocean in fish); the panel draws every place without a
// "NaN" or "undefined".
// Usage: node v2/tools/check-ecology.mjs

import { check, report, section, finish } from './lib/check-kit.mjs';
import { lifeFacts, seaWeb, herbivoreKgKm2, predatorKgKm2, upwellingMd, EMITS, KEYS, LIFE } from '../js/ecology/now.js';
import { lifeSectionHTML, HABITAT_WORDS } from '../js/ecology/life-panel.js';
import { classifyCell } from '../js/climate/koppen.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { BoundaryKind } from '../js/tectonics/model/world.js';

section('the vocabulary');
for (const [list, keys] of [['land', KEYS.LAND_HABITATS], ['azonal', KEYS.AZONAL_HABITATS], ['sea', KEYS.SEA_HABITATS], ['fresh', KEYS.FRESH_HABITATS]]) {
    const stray = EMITS[list].filter(k => !keys.includes(k));
    check(`every ${list} key the core may emit is in the frozen list`, stray.length === 0, stray.join(', '));
}
const unworded = [...EMITS.land, ...EMITS.sea.filter(k => !['deep-sea', 'vent', 'seep'].includes(k)), ...EMITS.fresh].filter(k => !HABITAT_WORDS[k]);
check('every emitted habitat has the panel\'s words', unworded.length === 0, unworded.join(', '));

// ── synthetic places ──
// twelve months from an annual mean, a seasonal swing and a rain total with its own season (rain peaks in the warm half when
// `summerRain`, in the cold half otherwise: the Mediterranean case)
function months(tMean, swing, rain, summerRain = true) {
    const T12 = [], P12 = [];
    for (let m = 0; m < 12; m++) {
        const c = Math.cos(2 * Math.PI * (m - 6.5) / 12);                      // (+1 in July: a northern year)
        T12.push(tMean + swing / 2 * c);
        P12.push(Math.max(0, rain / 12 * (1 + 0.8 * (summerRain ? c : -c))));
    }
    return { T12, P12 };
}
function landPlace({ tMean, swing, rain, summerRain = true, heightM = 200, lat = 30, coastKm = 500, river = null, kind = 'land' }) {
    const { T12, P12 } = months(tMean, swing, rain, summerRain);
    const tA = T12.reduce((a, x) => a + x, 0) / 12, pA = P12.reduce((a, x) => a + x, 0);
    return { lat, lon: 0, simCell: 0, timeMyr: 1000, kind, heightM, coastKm, river, ground: null,
        climate: { source: 'detail', land: kind === 'land', koppen: classifyCell(T12, P12), tAnnual: tA, pAnnual: pA, T12, P12 } };
}
function seaPlace({ sst, swing = 4, depthM, ice = 0, upwelling = 0, coastKm = 1000 }) {
    const { T12, P12 } = months(sst, swing, 800);
    return { lat: 20, lon: 0, simCell: 0, timeMyr: 1000, kind: 'ocean', heightM: -depthM, coastKm, river: null, ground: null,
        climate: { source: 'detail', land: false, T12, P12, tAnnual: sst, pAnnual: 800, sea: { tYear: sst, tJan: sst - swing / 2, tJul: sst + swing / 2, ice, upwelling } } };
}
const frame = (boundary = 0, type = CrustType.OCEAN) => ({ boundary: [boundary], margin: [0], type: [type] });

const places = [];
for (const tMean of [-20, -8, 0, 6, 12, 18, 24, 27])
    for (const swing of [2, 12, 30])
        for (const rain of [20, 150, 400, 800, 1500, 3000])
            for (const summerRain of [true, false])
                for (const heightM of [100, 3500]) places.push({ F: landPlace({ tMean, swing, rain, summerRain, heightM }), frame: frame(0, CrustType.CONTINENT) });
places.push({ F: landPlace({ tMean: 25, swing: 4, rain: 1200, river: { q: 3000, regime: 0, km: 2 } }), frame: frame(0, CrustType.CONTINENT) });
places.push({ F: landPlace({ tMean: 14, swing: 14, rain: 600, kind: 'lake' }), frame: frame(0, CrustType.CONTINENT) });
for (const sst of [-1, 6, 14, 22, 28])
    for (const depthM of [30, 150, 800, 4000])
        for (const [ice, upwelling, coastKm] of [[0, 0, 1000], [0, 1, 100], [0.3, 0, 600], [0.8, 0, 600]])
            for (const boundary of [0, BoundaryKind.RIDGE, BoundaryKind.SUBDUCTING])
                places.push({ F: seaPlace({ sst, depthM, ice, upwelling, coastKm }), frame: frame(boundary) });

section('the sweep');
const finite = x => typeof x !== 'number' || Number.isFinite(x);
const seen = { land: new Set(), sea: new Set(), floor: new Set(), fresh: new Set() };
let nulls = 0, badKey = [], nonFinite = [], notPyramid = [], badShare = [], badHtml = [];
for (const { F, frame: fr } of places) {
    const L = lifeFacts(F, null, fr);
    if (!L) { nulls++; continue; }
    const tag = `${L.realm}:${L.habitat}@${F.climate.tAnnual.toFixed(0)}°C/${Math.round(F.climate.pAnnual)}mm/${F.heightM}m`;
    if (L.realm === 'sea') {
        seen.sea.add(L.habitat); if (L.floor) seen.floor.add(L.floor);
        if (!EMITS.sea.includes(L.habitat) || (L.floor && !EMITS.sea.includes(L.floor))) badKey.push(tag);
        const w = L.web;
        if (![w.nppC, w.fishC, w.fishWetTkm2, w.steps, w.eff].every(Number.isFinite)) nonFinite.push(tag);
        if (!(w.fishWetTkm2 * 1000 < w.nppC * 1000 / LIFE.carbonPerDm)) notPyramid.push(tag);    // (fish's wet weight under the plankton's dry growth)
    } else {
        (L.realm === 'fresh' ? seen.fresh : seen.land).add(L.habitat);
        if (L.realm === 'fresh') seen.fresh.add(L.freshHabitat);
        if (!EMITS.land.includes(L.habitat) || L.azonal.some(a => !EMITS.azonal.includes(a)) || (L.freshHabitat && !EMITS.fresh.includes(L.freshHabitat))) badKey.push(tag);
        if (![L.npp, L.herbivores, L.predators, L.grazeShare, L.crust, L.fungi.am, L.fungi.ecm, L.fungi.eric].every(Number.isFinite)) nonFinite.push(tag);
        if (L.npp > 0 && !(L.npp * 1000 > L.herbivores && (L.herbivores === 0 ? L.predators === 0 : L.herbivores > L.predators))) notPyramid.push(tag);
        const fs = L.fungi.am + L.fungi.ecm + L.fungi.eric;
        if (L.crust < 0 || L.crust > 1 || (fs > 0 && Math.abs(fs - 1) > 1e-6) || L.grazeShare < 0 || L.grazeShare > 1) badShare.push(tag);
    }
    if (!Object.values(L.match ?? {}).every(v => finite(v))) nonFinite.push(`${tag} (match)`);
    const html = lifeSectionHTML(L, true);
    if (/NaN|undefined|Infinity/.test(html) || !html.includes('today\'s grade')) badHtml.push(tag);
}
check('every synthetic place has life facts', nulls === 0, `${nulls} of ${places.length} null`);
check('every key a place gets is in the frozen vocabulary', badKey.length === 0, badKey.slice(0, 5).join('; '));
check('every number is finite (and the matcher\'s input)', nonFinite.length === 0, nonFinite.slice(0, 5).join('; '));
check('the pyramid narrows upward (plants > herbivores > predators; plankton > fish)', notPyramid.length === 0, notPyramid.slice(0, 5).join('; '));
check('shares stay shares (mycorrhizae sum to 1, crust and grazing in 0–1)', badShare.length === 0, badShare.slice(0, 5).join('; '));
check('the panel draws every place without NaN or undefined, and says the grade', badHtml.length === 0, badHtml.slice(0, 5).join('; '));
check('the sweep reaches a spread of habitats (≥ 10 land, ≥ 6 sea, all three floors)', seen.land.size >= 10 && seen.sea.size >= 6 && seen.floor.size === 3,
    `land ${[...seen.land].join(' ')} | sea ${[...seen.sea].join(' ')} | floor ${[...seen.floor].join(' ')}`);
check('a lake is fresh water with its land around it', seen.fresh.has('lake'));
check('the panel asks for detail on a preview moment', /Add detail/.test(lifeSectionHTML(null, false)));

section('the measured relations keep their shape');
const npps = [100, 300, 600, 1000, 2000, 3000], herbs = npps.map(n => herbivoreKgKm2(n));
check('more growth feeds more large herbivores (Fløjgaard et al. 2022: exponent 1.26 > 0)', herbs.every((h, i) => i === 0 || h > herbs[i - 1]), herbs.map(h => h.toFixed(0)).join(' < '));
const ratios = [100, 1000, 10000].map(b => predatorKgKm2(b) / b);
check('the predators\' share falls as prey thickens (Hatton et al. 2015: exponent 0.73 < 1)', ratios[0] > ratios[1] && ratios[1] > ratios[2], ratios.map(r => `${(100 * r).toFixed(2)} %`).join(' > '));
report('predators per prey at 2,500 kg/km² of herbivores', 100 * predatorKgKm2(2500) / 2500, { earth: [0.6, 1.4], unit: '%', source: 'Hatton et al. 2015 Fig. 1, African savanna parks' });
const fish = ['open-gyre', 'shelf', 'upwelling-shelf'].map(h => seaWeb(h).fishC);
check('Ryther\'s provinces rank upwelling > coastal > open ocean in fish', fish[2] > fish[1] && fish[1] > fish[0], fish.map(x => x.toExponential(1)).join(' < '));
report('the upwelling threshold (m/day over the climate\'s coastal zone)', upwellingMd(), { unit: 'm/day', source: 'derived: a Bakun index of 50 m³/s per 100 m of coast (recalled) ÷ OCEAN_COAST_KM' });

finish('Ecology');
