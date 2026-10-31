// The food model (crops.js's harvests and soil, substrate.js placeFood's foods, stapleOf) on Earth's own months
// (WorldClim 2.1 at 10′), at the places it should hold and should not: the breadbaskets' long rain-fed seasons, the
// Nile's and Mesopotamia's that only water brought makes, the short ones of the cold; black earth on the steppes and
// prairies, leached ground in the wet tropics, podzol in the taiga; each place's staple, its farmland's class and the
// people it could feed. The places and what should hold there are upstream's (raguilar011095/planet_heightmap_generation,
// tuning/farming/earth-farming.mjs — © Robert Aguilar, GPL v3), its staples in our foods; each place the mean of its land
// within a degree.
//
//   node tuning/civ/food-check.mjs [--json FILE]   (exits 1 if a place is off)
//
// Needs tuning/civ/fetch-earth.sh's WorldClim files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromArrayBuffer } from 'geotiff';
import { cropClimate } from '../../v2/js/civ/crops.js';
import { placeFood, stapleOf, wayOf, landForager, miamiNpp, stormCV, OPEN, Staple, STAPLE_WORDS, WAY_WORDS, Way } from '../../v2/js/civ/substrate.js';
import { classifyCell, KOPPEN_CLASSES } from '../../v2/js/climate/koppen.js';
import { CIV } from '../../v2/js/civ/civ-config.js';
import { FOOD } from '../../v2/js/civ/food-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), RAW = path.join(HERE, 'data', 'raw');
const { winterCereal: WHEAT, summerCereal: MAIZE, roots: ROOTS, flooded: RICE, herds: HERDS, none: NONE } = Staple;

// [name, lat, lon], and what should hold there (rain, warm: the months by rain and warm enough to grow)
export const PLACES = {
    breadbasket: { test: v => v.rain >= 4, words: 'a long rain-fed season (≥ 4 months)', at: [['Ukraine', 49, 32], ['Iowa', 42, -93.5], ['Paris Basin', 48.5, 2.5],
        ['Pampas', -34.5, -61], ['Bengal', 24, 89], ['Java', -7.3, 110.5], ['Po Valley', 45, 10], ['Yangtze plain', 30.5, 115]] },
    watered: { test: v => v.rain <= 1.5 && v.warm >= 9, words: 'barren by rain, ≥ 9 months watered (the irrigated river valleys)', at: [['Nile, Egypt', 26.5, 31.5], ['Mesopotamia', 32.5, 44.5],
        ['Indus, Sindh', 26, 68.5], ['Imperial Valley', 32.8, -115.5], ['Arizona (Hohokam)', 33.5, -112]] },
    cold: { test: v => v.warm <= 2.5, words: 'too cold for crops (≤ 2.5 warm months)', at: [['North Siberia', 70, 100], ['Greenland coast', 64, -51], ['Tibet', 33, 88], ['Nunavut', 65, -95]] },
    highland: { test: v => v.rain >= 3, words: 'highlands farmed (≥ 3 months by rain)', at: [['Cusco, Andes', -13.5, -72], ['Ethiopian highlands', 9, 38.7], ['Mexico valley', 19.5, -99]] },
    black: { test: v => v.black >= 0.5, words: 'black earth (≥ 0.5)', at: [['Ukraine', 49, 32], ['Kansas', 38.5, -98.5], ['Pampas', -34.5, -61], ['Kazakh steppe', 52, 70], ['Manchuria', 46, 126]] },
    notBlack: { test: v => v.black <= 0.2, words: 'no black earth (≤ 0.2)', at: [['Amazon', -3, -60], ['Sahara', 24, 10], ['Finland', 64, 26], ['Sahel savanna', 12, 0]] },
    leached: { test: v => v.leach >= 0.6, words: 'leached (≥ 0.6)', at: [['Amazon', -3, -60], ['Congo', 0, 22], ['Borneo', 1, 114], ['Guinea coast', 6, -9]] },
    notLeached: { test: v => v.leach <= 0.2, words: 'not leached (≤ 0.2)', at: [['Ukraine', 49, 32], ['Sahara', 24, 10], ['Paris Basin', 48.5, 2.5], ['Punjab', 31, 74]] },
    podzol: { test: v => v.podzol >= 0.5, words: 'podzol (≥ 0.5)', at: [['Finland', 64, 26], ['Siberian taiga', 60, 100], ['Quebec', 50, -72], ['Arkhangelsk', 63, 42]] },
};
// each place's staple on its ground — river silt watered ('w'), river silt by rain ('r'), volcanic ('v'), sandy ('s': the
// Sahel's, the wheatbelt's), else middling — and any other staple as fair an answer there (both grow well; which one
// people grew was culture's)
export const STAPLE_PLACES = {
    [RICE]: [['Bengal', 24, 89, 'r'], ['Yangtze plain', 30.5, 115, 'r'], ['Java', -7.3, 110.5, 'v'], ['Mekong delta', 10.5, 105.5, 'r'], ['Guangdong', 23, 113, 'r'], ['Kyushu', 33, 131, 'v']],
    [WHEAT]: [['Paris Basin', 48.5, 2.5], ['Ukraine', 49, 32], ['Anatolia', 39, 33], ['England', 52, -1], ['Nile, Egypt', 26.5, 31.5, 'w'], ['Mesopotamia', 32.5, 44.5, 'w'],
        ['Indus, Sindh', 26, 68.5, 'w', [MAIZE]], ['Punjab', 31, 74, 'w', [MAIZE]]],
    [MAIZE]: [['Iowa', 42, -93.5], ['Mexico valley', 19.5, -99, 'v', [WHEAT, ROOTS]], ['Sahel (millet)', 13, 2], ['Highveld', -26.5, 28], ['Deccan (sorghum)', 17, 76]],
    [ROOTS]: [['Congo', 0, 22], ['Amazon', -3, -60], ['Titicaca (potatoes)', -16, -69.5, '', [HERDS, WHEAT]], ['New Guinea highlands', -6, 145]],
    [HERDS]: [['Mongolia', 47, 103], ['Kazakh steppe', 48, 68], ['Patagonia', -45, -69], ['Tibet', 33, 88], ['Horn of Africa', 8, 46], ['North Siberia (reindeer)', 70, 100]],
    [NONE]: [['Sahara', 24, 10], ['Rub al Khali', 21, 50], ['Taklamakan', 39, 83]],
};
// each place's farmland class on its ground: excellent where two or three harvests a year come off renewed ground (the
// great river plains and deltas, volcanic Java); good where one solid one does (the breadbaskets); fair to poor on the
// dry and seasonal margins
const BARREN = 0, POOR = 1, FAIR = 2, GOOD = 3, EXCELLENT = 4;
export const CLASS_WORDS = ['barren', 'poor', 'fair', 'good', 'excellent'];
export const FARMLAND_PLACES = [
    ['Nile, Egypt', 26.5, 31.5, 'w', [EXCELLENT]], ['Mesopotamia', 32.5, 44.5, 'w', [EXCELLENT]], ['Bengal', 24, 89, 'r', [EXCELLENT]], ['Yangtze plain', 30.5, 115, 'r', [EXCELLENT]],
    ['Java', -7.3, 110.5, 'v', [EXCELLENT]], ['Mekong delta', 10.5, 105.5, 'r', [EXCELLENT]], ['Guangdong (watered)', 23, 113, 'w', [EXCELLENT]],
    ['Paris Basin', 48.5, 2.5, '', [GOOD]], ['Iowa', 42, -93.5, '', [GOOD]], ['Ukraine', 49, 32, '', [GOOD]], ['England', 52, -1, '', [GOOD]], ['Po Valley', 45, 10, 'r', [GOOD, EXCELLENT]],
    ['Sicily', 37.5, 14, '', [GOOD]], ['Andalusia', 37.5, -5, '', [GOOD]], ['Tuscany', 43.5, 11, '', [GOOD]], ['Galilee (half the Jordan’s desert)', 32.8, 35.5, '', [POOR, FAIR, GOOD]], ['Morocco Atlantic', 33, -7, '', [FAIR, GOOD]],
    ['Perth wheatbelt', -31.5, 117, 's', [POOR, FAIR]], ['Aleppo (dry margin)', 36.2, 37, '', [POOR, FAIR]], ['Sahel (Niger)', 13, 2, 's', [POOR, FAIR]],
    ['Sahara', 24, 10, '', [BARREN]], ['North Siberia', 70, 100, '', [BARREN, POOR]],
];
// how many people a km² of its land the place could feed, pre-industrial, on its ground (upstream's ranges: Roman
// Egypt's valley ~150–200; Bengal, Jiangnan and Java before modern fertiliser 150–300; France ~1700's good farmland
// ~50–60; shifting cultivation's rainforests ~1–15, Ruthenberg's R ~10–25 %; the Sahel's and the steppe's thinner)
export const PEOPLE_PLACES = [
    ['Nile, Egypt', 26.5, 31.5, 'w', [100, 400]], ['Bengal', 24, 89, 'r', [60, 400]], ['Yangtze plain', 30.5, 115, 'r', [80, 400]], ['Java', -7.3, 110.5, 'v', [80, 400]],
    ['Paris Basin', 48.5, 2.5, '', [25, 90]], ['England', 52, -1, '', [20, 90]], ['Ukraine', 49, 32, '', [20, 90]], ['Iowa', 42, -93.5, '', [20, 90]],
    ['Amazon', -3, -60, '', [1, 15]], ['Congo', 0, 22, '', [1, 15]], ['Borneo', 1, 114, '', [1, 15]], ['Guinea coast', 6, -9, '', [1, 20]],
    ['New Guinea highlands', -6, 145, '', [5, 100]], ['Sahel (Niger)', 13, 2, 's', [1, 25]], ['Mongolia', 47, 103, '', [0.3, 5]],
];
// (each ground: civSubstrate's — silt: the share on river silt; held: holding water, a delta's or a marsh's (flooded
// fields by their warmth); irrig, irrigShare: canal-watered; rock, renew: the parent rock — upstream's volcanic 0.9 renewing 0.8, sand 0.4)
const GROUND = {
    '': {}, w: { silt: 1, irrig: 1, irrigShare: 1 }, r: { silt: 1, held: 1 },
    v: { rock: 0.9, renew: 0.8 }, s: { rock: 0.4 },
};
// (people a km² of the land from a farmed staple's food a km² of field: about half a farming country's land in fields,
// the rest meadow, pasture, wood and waste — England's ploughland in 1086 ~35 %, France's arable c. 1700 ~50 %, recalled.
// Upstream's ranges count the land; civ-config cropFood counts the field)
const FIELD_OF_LAND = 0.5;
const groundOf = k => ({ silt: 0, held: 0, irrig: 0, irrigShare: 0, loess: 0, sand: 0, ...GROUND[k ?? ''] });
const FOOD_KEYS = ['winterCereal', 'summerCereal', 'roots', 'tree', 'flooded', 'canalWinterCereal', 'canalSummerCereal', 'farmV', 'soil'];

async function readTif(file) {
    const buf = fs.readFileSync(file), tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const img = await tiff.getImage(), [data] = await img.readRasters();
    return data;
}

/** Every place's climate and foods (the mean over its land within a degree), or null without the data. */
export async function earthFood() {
    const wc = f => path.join(RAW, 'wc', f);
    if (!fs.existsSync(wc('wc2.1_10m_tavg_01.tif'))) return null;
    const T = [], P = [];
    for (let k = 1; k <= 12; k++) { const m = String(k).padStart(2, '0'); T.push(await readTif(wc(`wc2.1_10m_tavg_${m}.tif`))); P.push(await readTif(wc(`wc2.1_10m_prec_${m}.tif`))); }
    const W = 2160, H = 1080, D = Math.PI / 180, T12 = new Float64Array(12), P12 = new Float64Array(12), s = {}, pf = {};
    const C = CIV, EF = KOPPEN_CLASSES.findIndex(k => k.code === 'EF');
    /** The mean over the land within a degree of a place, its ground `gk`. */
    const at = (la, lo, gk) => {
        const g = groundOf(gk), v = { rain: 0, warm: 0, black: 0, leach: 0, podzol: 0, herds: 0, open: 0, forager: 0, P: 0 };
        for (const k of FOOD_KEYS) v[k] = 0;
        let n = 0;
        const j0 = Math.round((90 - la) * 6), i0 = Math.round((lo + 180) * 6);
        for (let j = j0 - 6; j <= j0 + 6; j++) for (let di = -6; di <= 6; di++) {
            if (j < 0 || j >= H) continue;
            const i = ((i0 + di) % W + W) % W, k = j * W + i;
            if (!(T[0][k] > -1e4)) continue;
            let Ty = 0, Py = 0;
            for (let q = 0; q < 12; q++) { T12[q] = T[q][k]; P12[q] = P[q][k]; Ty += T12[q] / 12; Py += P12[q]; }
            cropClimate(T12, P12, (90 - (j + 0.5) / 6) * D, s);
            placeFood(s, g, pf, C, FOOD);
            // (the herds on a km² of pasture: the Miami model's grass, a sustainable off-take — none on ice; foragers on
            // the land alone: the sea's and fresh water's are not read here)
            const kop = classifyCell(T12, P12), code = KOPPEN_CLASSES[kop]?.code ?? '', npp = kop === EF ? 0 : miamiNpp(Ty, Py, C);
            v.open += OPEN[code] ?? 0; v.P += Py;
            v.forager += Math.min(C.foragerMax, landForager(npp, C) * (code === 'Af' ? C.foragerRainforest : 1));
            v.rain += s.rainMo; v.warm += s.warmMo; v.black += s.black; v.leach += s.leach; v.podzol += s.podzol;
            v.herds += npp * C.grazeUse / C.tluIntakeT / C.tluPerPerson;
            for (const key of FOOD_KEYS) v[key] += pf[key];
            n++;
        }
        if (!n) return null;
        for (const key in v) v[key] /= n;
        // (the cereals canal-watered where the ground is)
        const crop = f => (g.irrig > 0 && f === 'winterCereal' ? v.canalWinterCereal : g.irrig > 0 && f === 'summerCereal' ? v.canalSummerCereal : v[f]);
        // (its way of life by the economy's land shares, then what that way eats most)
        let field = 0;
        for (const f of ['winterCereal', 'summerCereal', 'roots', 'tree', 'flooded']) field = Math.max(field, crop(f));
        const [way, wayPeople] = wayOf({ field, canal: g.irrig > 0 ? field : 0, irrigShare: g.irrigShare, herds: v.herds * v.open, open: v.open, forager: v.forager, cv: stormCV(v.P, C) }, C, FOOD);
        const [staple, food, second, food2] = stapleOf(crop, v.herds, way);
        const cls = FOOD.farmClasses.reduce((a, t) => a + (v.farmV >= t ? 1 : 0), 0);
        return { ...v, way, wayPeople, staple, food, second, food2, cls };
    };
    return {
        places: Object.fromEntries(Object.entries(PLACES).map(([k, { at: list }]) => [k, list.map(([n, la, lo]) => [n, at(la, lo)])])),
        staple: Object.fromEntries(Object.entries(STAPLE_PLACES).map(([k, list]) => [k, list.map(([n, la, lo, g, alt]) => [n, at(la, lo, g), alt ?? []])])),
        farmland: FARMLAND_PLACES.map(([n, la, lo, g, ok]) => [n, at(la, lo, g), ok]),
        people: PEOPLE_PLACES.map(([n, la, lo, g, range]) => [n, at(la, lo, g), range]),
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const res = await earthFood();
    if (!res) { console.log('No WorldClim months: run tuning/civ/fetch-earth.sh first'); process.exit(0); }
    const score = {};
    let bad = 0, all = 0;
    const tally = (part, ok) => { all++; if (!ok) bad++; score[part] ??= [0, 0]; score[part][1]++; if (ok) score[part][0]++; };
    const f1 = x => x.toFixed(1), f2 = x => x.toFixed(2);
    for (const [k, list] of Object.entries(res.places)) {
        console.log(`── ${PLACES[k].words} ──`);
        for (const [n, v] of list) {
            const ok = !!v && PLACES[k].test(v);
            tally('season and soil', ok);
            console.log(`  ${ok ? 'ok  ' : 'OFF '} ${n.padEnd(26)} ${v ? `rain ${f1(v.rain)} · warm ${f1(v.warm)} mo · black ${f2(v.black)} · leach ${f2(v.leach)} · podzol ${f2(v.podzol)}` : 'no land'}`);
        }
    }
    for (const [k, list] of Object.entries(res.staple)) {
        console.log(`── staple: ${STAPLE_WORDS[k]} ──`);
        for (const [n, v, alt] of list) {
            const ok = !!v && (v.staple === +k || alt.includes(v.staple));
            tally('staple', ok);
            console.log(`  ${ok ? 'ok  ' : 'OFF '} ${n.padEnd(26)} ${v ? `${STAPLE_WORDS[v.staple]} (${f1(v.food)} a km² of its land) · then ${STAPLE_WORDS[v.second]} (${f1(v.food2)}) · ${WAY_WORDS[v.way]} · soil ${f2(v.soil)}` : 'no land'}`);
        }
    }
    console.log('── farmland ──');
    for (const [n, v, ok0] of res.farmland) {
        const ok = !!v && ok0.includes(v.cls);
        tally('farmland', ok);
        console.log(`  ${ok ? 'ok  ' : 'OFF '} ${n.padEnd(36)} ${v ? `${CLASS_WORDS[v.cls]} (${f2(v.farmV)} harvests' food; want ${ok0.map(c => CLASS_WORDS[c]).join('/')})` : 'no land'}`);
    }
    console.log('── people a km² (its staple on its land) ──');
    for (const [n, v, [lo, hi]] of res.people) {
        const p = !v ? 0 : v.staple === Staple.herds ? v.herds * v.open : v.food * FIELD_OF_LAND, ok = !!v && p >= lo && p <= hi;
        tally('people', ok);
        console.log(`  ${ok ? 'ok  ' : 'OFF '} ${n.padEnd(26)} ${f1(p).padStart(6)}  (want ${lo}–${hi}; ${v ? STAPLE_WORDS[v.staple] : ''})`);
    }
    console.log(`\n${all - bad}/${all} places hold: ${Object.entries(score).map(([k, [a, b]]) => `${k} ${a}/${b}`).join(' · ')}`);
    const j = process.argv.indexOf('--json');
    if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify({ score, hold: all - bad, all }, null, 1));
    process.exit(bad ? 1 : 0);
}
