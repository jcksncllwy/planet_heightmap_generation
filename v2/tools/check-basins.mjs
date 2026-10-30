// Headless checks for seas cut off from the world ocean (finish/finish-basins.js, finish-hydro.js; terrain/world-ocean.js):
// a body below sea level that does not join the world ocean — the largest body of water — has its surface set by its water
// balance, not by sea level. Hard: the balance's physics against Earth's closed seas, from their own inflow, rain and
// temperature through the finish's evaporation — the Caspian's area, the Dead Sea's before its river was drawn off, the
// Messinian Mediterranean's drawdown in a few thousand years — and the world ocean is the largest body. Reported against
// Earth's history, three seeds (the page's world: the supercontinent cycle, 30 % continent, 40 000 sim cells; 626225 is the
// "swiss cheese" of the user's screenshot), each finished at 160K cells at 300, 600 and 950 Myr: how many cut-off seas fill
// to their rim and spill against those drawn down, the area below sea level they hold, and how far below sea level their
// water and their dry floors lie.
// Usage: node v2/tools/check-basins.mjs

import { check, report, section, finish } from './lib/check-kit.mjs';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { simulateCached } from './lib/history-cache.mjs';
import { pageWorld } from './lib/moment-frame.mjs';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { FRAME_FIELDS, TerrainPool } from '../js/terrain/terrain-pool.js';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';
import { lakeBalance, hollowLakes } from '../js/finish/finish-basins.js';
import { worldOcean } from '../js/terrain/world-ocean.js';
import { Water } from '../js/finish/finish-hydro.js';
import { landWater } from './lib/land-water.mjs';
import { trapEfficiency } from '../js/tectonics/step/rivers.js';

const SEEDS = [626225, 777, 12345], MOMENTS = [300, 600, 950], SIM = 40000, MESH_SEED = 12345, CELLS = 160000;
const F = FINISH, pet = tC => Math.max(F.petMinMm, F.petBaseMm + F.petPerC * tC);      // (finish.js: the land's potential evaporation, mm/yr)
const openWater = (tC, rainMm) => Math.max(0, F.lakeEvapShare * pet(tC) - rainMm);       // (what a lake loses net of the rain on it)

/** A mesh that is a chain of N cells, each the neighbour of the next. */
function chain(N) {
    const adjOffset = new Int32Array(N + 1), adjList = [];
    for (let i = 0; i < N; i++) { if (i > 0) adjList.push(i - 1); if (i < N - 1) adjList.push(i + 1); adjOffset[i + 1] = adjList.length; }
    return { adjOffset, adjList: Int32Array.from(adjList), numCells: N };
}

section('the balance against Earth’s closed seas');
// A basin as a chain of cells, lowest first (its hypsometry does not matter: the area at balance does) — of 10 km² each,
// fine enough for the Dead Sea's few hundred, room enough (500 000 km²) for the Caspian
{
    const N = 50000, mesh = chain(N), z = Float32Array.from({ length: N }, (_, i) => -1 + i / N), A = 10;
    const balance = (km3, tC, rainMm) => lakeBalance(mesh, 0, () => true, z, () => openWater(tC, rainMm) * A * 1e-6, km3).wet.length * A;
    // the Caspian: the Volga's ~250 km³/yr and the other rivers' ~50 (Rodionov 1994), its air ~11–12 °C a year, ~200 mm of
    // rain on it: it stands at ~371 000 km²
    const caspian = balance(300, 11.5, 200);
    check('the Caspian: 300 km³/yr in, at its temperature and rain, balances within ×1.5 of its 371 000 km²', caspian > 371000 / 1.5 && caspian < 371000 * 1.5,
        `${Math.round(caspian).toLocaleString()} km² (open water loses ${Math.round(openWater(11.5, 200))} mm/yr net; Earth ~1000 mm)`);
    // the Dead Sea before 1960: the Jordan's ~1.3 km³/yr (Salameh & El-Naser 1999), ~24 °C, ~70 mm: ~1000 km²
    const dead = balance(1.3, 24, 70);
    check('the Dead Sea before its river was drawn off: 1.3 km³/yr balances within ×1.6 of its ~1000 km²', dead > 1000 / 1.6 && dead < 1000 * 1.6,
        `${Math.round(dead).toLocaleString()} km² (open water loses ${Math.round(openWater(24, 70))} mm/yr net; Earth 1.5–2 m)`);
    // the Messinian Mediterranean: ~2.5 Mkm² at ~19 °C, ~500 mm of rain, its rivers (and the Paratethys) ~400 km³/yr. Cut off,
    // its equilibrium is a small share of its area, and it gets there — 1.5 km down — in a few thousand years (Hsü et al.
    // 1973; Blanc 2002; Ryan 2009: drawn down in 10³–10⁴ years)
    const med = balance(400, 19, 500), loss = 2.5e6 * openWater(19, 500) * 1e-6 - 400, years = 2.5e6 * 0.7 * 1.5 / loss;
    check('the Messinian Mediterranean: cut off, it balances at under a third of its 2.5 Mkm², drawn down 1.5 km in 10³–10⁴ years',
        med < 2.5e6 / 3 && years > 1e3 && years < 1e4, `balance ${Math.round(med / 1e3)}K km²; net loss full ${Math.round(loss)} km³/yr → 1.5 km (×0.7 for its narrowing) in ${Math.round(years).toLocaleString()} years`);
}

section('a hollow’s sub-basins, inside out');
// A hollow of two sub-basins behind a sill (finish-basins.js hollowLakes): the Caspian full to its sill spills its surplus
// into Kara-Bogaz-Gol beside it, which has no river of its own and stands at its own, lower level — its area its
// overflow over what it loses; and a basin with no water reaching it is a playa, whatever is beside it
{
    const N = 2000, mesh = chain(N), A = 10, z = new Float32Array(N);
    // (cells 0–1499: the big basin, its floor −1 km; cell 1500: the sill at −0.05 km; 1501–1999: the small one, floor −0.3 km)
    for (let i = 0; i < N; i++) z[i] = i < 1500 ? -1 + 0.9 * Math.abs(i - 750) / 750 : i === 1500 ? -0.05 : -0.3 + 0.2 * Math.abs(i - 1750) / 250;
    const cells = Array.from({ length: N }, (_, i) => i), e = 1e-3 * A;          // (1 m a year off each 10 km² cell: km³)
    const solve = km3 => hollowLakes(mesh, cells, z, c => (c === 750 ? km3 : 0), () => e, 1, 0);
    const S = solve(1500 * e + 3), big = S.lakes.find(L => L.cells.includes(750)), small = S.lakes.find(L => L.cells.includes(1750));
    check('a full sub-basin spills into the one beside it, which balances at its own lower level on the overflow alone',
        !S.full && big?.full && Math.abs(big.level + 0.05) < 1e-6 && small && !small.full && small.level < -0.05 && Math.abs(small.cells.length * e - 3) <= e && S.fate(750) === S.lakes.indexOf(small),
        `upper lake ${big?.full ? 'full' : 'not full'} at ${Math.round(1000 * (big?.level ?? NaN))} m spilling ${big?.outflow?.toFixed(2)} km³/yr; the lower at ${Math.round(1000 * (small?.level ?? NaN))} m, ${small?.cells.length * A} km² (3 km³ over 1 m: 3000 km²)`);
    const D = solve(100.5 * e), dry = D.lakes.find(L => L.cells.includes(1750));
    check('…and short of its sill the upper lake keeps its water: the lower is a playa', !D.full && dry && dry.cells.length === 1 && D.lakes.find(L => L.cells.includes(750))?.cells.length === 100,
        `the lower ${dry?.cells.length} cell(s) wet; the upper ${D.lakes.find(L => L.cells.includes(750))?.cells.length} cells (water for 100.5)`);
}

section('the world ocean is the largest body of water');
{
    // two bodies on a chain: the larger is the ocean, the smaller is cut off
    const N = 10, mesh = chain(N);
    const z = Float32Array.from([-1, -1, 0.5, -2, -2, -2, -2, 0.2, 1, -0.1]), W = worldOcean(mesh, z);
    check('the largest body below sea level is the world ocean; the others are cut off', W.ocean.join('') === '0001111000' && W.cut.join('') === '1100000001',
        `ocean ${W.ocean.join('')} · cut off ${W.cut.join('')}`);
}

section('cut-off seas through the history (finished at 160K cells)');
const simMesh = buildSimMesh(SIM, MESH_SEED), scene = TERRAIN_SCENES.find(s => s.id === 'cycle'), rows = [], closedRows = [], landRows = [];
for (const seed of SEEDS) {
    const frames = new Map();
    // (the page's history for these settings, through the history cache — tools/lib/history-cache.mjs: the page's own, if it built it)
    const { world } = pageWorld({ seed, cont: 30, sim: SIM });
    simulateCached(world, { untilMyr: Math.max(...MOMENTS) + 10, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
        if (MOMENTS.some(t => Math.abs(f.time - t) < 1e-6)) { const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]])); fr.plates = f.plates.map(p => p && { quat: p.quat }); frames.set(Math.round(f.time), fr); }
    } }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont: 30, sim: SIM, by: 'check-basins' } });
    const per = [];
    for (const t of MOMENTS) {
        const pool = await TerrainPool.create(simMesh);
        const fin = await finishPlanet({ frame: frames.get(t), simMesh, seed, cells: CELLS, pool, closePool: true });
        // (the seas the finish counts as remnants of the sea: finish-config.js seaBasinKm2)
        const seas = (fin.stats.water.seas ?? []).filter(s => s.belowKm2 >= F.seaBasinKm2[0]);
        const down = seas.filter(s => !s.spills), wetDown = down.filter(s => s.kind === Water.SALT), dry = down.filter(s => s.kind !== Water.SALT);
        closedRows.push({ seed, t, endo: fin.stats.water.endorheicShare ?? NaN, closed: fin.stats.water.closed ?? [] });
        // (the land's water and hollows, and the sediment the history's hollows hold — crust records, km of it per sim cell)
        const fr = frames.get(t), simKm2 = 4 * Math.PI * 6371 ** 2 / simMesh.numCells;
        let fillKm3 = 0; for (let w = 0; w < simMesh.numCells; w++) if (fr.owner[w] >= 0) fillKm3 += (fr.basinFillKm?.[w] ?? 0) * simKm2;
        landRows.push({ seed, t, W: landWater(fin, simMesh, fr), fillKm3 });
        per.push({ t, n: seas.length, full: seas.length - down.length, belowKm2: seas.reduce((a, s) => a + s.belowKm2, 0), waterKm2: seas.reduce((a, s) => a + s.waterKm2, 0),
            surfaces: wetDown.map(s => s.levelKm), floors: dry.map(s => s.levelKm), ms: Object.values(fin.ms).reduce((a, b) => a + b, 0) });
        console.log(`    seed ${seed} at ${t} Myr: ${seas.length} cut-off seas, ${seas.length - down.length} full and spilling; below sea level ${(per.at(-1).belowKm2 / 1e6).toFixed(2)} Mkm², water ${(per.at(-1).waterKm2 / 1e6).toFixed(2)} Mkm²; salt lakes at ${wetDown.map(s => Math.round(1000 * s.levelKm)).join(', ') || '—'} m; playas at ${dry.map(s => Math.round(1000 * s.levelKm)).join(', ') || '—'} m (${(per.at(-1).ms / 1000).toFixed(0)} s)`);
    }
    const all = k => per.flatMap(p => p[k]), sum = k => per.reduce((a, p) => a + p[k], 0);
    const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
    rows.push({ seed, n: sum('n'), full: sum('full'), below: sum('belowKm2') / per.length / 1e6, water: sum('waterKm2') / per.length / 1e6,
        surfaceMedian: median(all('surfaces').filter(v => v < 0)), surfaceLow: Math.min(...all('surfaces')), floorLow: Math.min(...all('floors')) });
}
const txt = f => rows.map(r => `${r.seed}: ${f(r)}`).join(' · ');
// (a hollow whose floor is below sea level, cut off from the ocean, is a cryptodepression: most of Earth's large ones
// today hold lakes that spill — the floors of Baikal, Tanganyika, Malawi, Superior, Michigan, Ontario, Ladoga, Onega and
// Great Slave Lake are below sea level — and the Caspian alone of those over 5000 km² is closed. In arid times more are:
// the Messinian Mediterranean and the Paratethys, the Zechstein and Pangea's interior basins)
report('cut-off seas full to their rim and spilling, of all (300, 600, 950 Myr)', rows.map(r => r.n ? 100 * r.full / r.n : NaN), { earth: [30, 92], unit: ' %', digits: 0,
    source: 'today ~11 of 12 cryptodepressions over 5000 km² spill, the Caspian alone closed (Herdendorf 1982); fewer in arid ages — the Messinian (Hsü et al. 1973), the Zechstein (Peryt et al. 2010) — and the Black Sea and the Caspian in the last glacial (Yanko-Hombach 2007)',
    detail: txt(r => `${r.full} of ${r.n}`) });
report('area below sea level in cut-off seas: mean of the moments', rows.map(r => r.below), { earth: [0.3, 3.5], unit: ' Mkm²', digits: 2,
    source: 'the Caspian depression ~0.6 today; the Zechstein ~0.6 in Pangea (Peryt et al. 2010); the Messinian Mediterranean 2.5 and the Paratethys (Hsü et al. 1973; Krijgsman et al. 1999)',
    detail: txt(r => `water on them ${r.water.toFixed(2)} Mkm²`) });
report('a drawn-down sea’s water surface: median', rows.map(r => r.surfaceMedian), { earth: [-1.5, -0.028], unit: ' km', digits: 3,
    source: 'the Caspian −28 m, Lake Assal −155 m, the Dead Sea −430 m (−390 m in 1930); the Messinian Mediterranean −1.5 to −3 km (Hsü et al. 1973; Ryan 2009)' });
report('…the lowest', rows.map(r => r.surfaceLow), { earth: [-3, -0.028], unit: ' km', digits: 3, source: 'the Dead Sea −430 m today; the Messinian Mediterranean drawn down 1.5–3 km (Hsü et al. 1973; Blanc 2002; Ryan 2009)' });
report('a dried sea’s floor (a playa below sea level): the lowest', rows.map(r => r.floorLow), { earth: [-3, -0.086], unit: ' km', digits: 3,
    source: 'Death Valley −86 m, Karagiye −132 m, the Qattara −133 m; the Messinian Mediterranean’s floors dry 2–3 km down (Hsü et al. 1973)' });

section('closed basins on land (finished at 160K cells, the same moments)');
// A basin is closed where its rivers cannot fill it to its rim, at any height (finish-hydro.js, finish-basins.js
// hollowLakes): its catchment's runoff against what its lakes lose. Earth today: about a fifth of the land drains to
// none of the oceans — dry, and in the lee of ranges; a supercontinent's dry interior more (Pangea's: not measured).
{
    const bySeed = SEEDS.map(seed => closedRows.filter(r => r.seed === seed));
    report('land draining to closed basins: mean of the moments', bySeed.map(R => 100 * R.reduce((a, r) => a + r.endo, 0) / Math.max(1, R.length)), { earth: [15, 35], unit: ' %', digits: 1,
        source: '~20 % of the continents today (Wang et al. 2018, Nat. Geosci. 11: 926); more in a supercontinent’s dry interior (no figure found)',
        detail: SEEDS.map((seed, i) => `${seed}: ${bySeed[i].map(r => `${r.t} Myr ${(100 * r.endo).toFixed(1)}`).join(', ')}`).join(' · ') });
    // (a closed lake's size against its catchment: what the catchment's runoff can hold against the lake's evaporation —
    // its aridity in one number, Bracht-Flyr et al. 2013; over 10 000 km² of catchment, the map's)
    const median = a => { const v = [...a].sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN; };
    const withLake = bySeed.map(R => R.flatMap(r => r.closed.filter(b => b.catchKm2 >= 1e4 && b.lakeKm2 > 0)));
    report('a closed lake’s area ÷ its catchment’s: median', withLake.map(B => 100 * median(B.map(b => b.lakeKm2 / b.catchKm2))), { earth: [1, 12], unit: ' %', digits: 1,
        source: 'the Caspian 0.37 of 3.5 Mkm² (11 %), the Aral before 1960 68 000 of 1.5 Mkm² (4 %), Balkhash 16 000 of 0.4 Mkm² (4 %), the Great Salt Lake ~4 400 of 55 000 km² (8 %), Chad ≤ 25 000 of 2.4 Mkm² (≤ 1 %); the ratio follows aridity (Bracht-Flyr et al. 2013, J. Hydrol.)',
        detail: withLake.map((B, i) => `${SEEDS[i]}: ${B.length} lakes`).join(' · ') });
    // (playa or lake by the catchment's aridity, rain ÷ potential evaporation: UNEP's classes — hyper-arid and arid under
    // 0.2, semi-arid 0.2–0.5 (Middleton & Thomas 1997))
    const playaShare = (lo, hi) => bySeed.map(R => { const B = R.flatMap(r => r.closed.filter(b => b.catchKm2 >= 1e4 && b.aridity >= lo && b.aridity < hi)); return B.length ? 100 * B.filter(b => !(b.lakeKm2 > 0)).length / B.length : NaN; });
    report('closed basins ending in a playa: arid catchments (P/PET under 0.2)', playaShare(0, 0.2), { unit: ' %', digits: 0,
        source: 'no count found: the hyper-arid and arid basins end in playas and salt flats — Lake Eyre, the Chotts, Lop Nur, the Great Basin’s — save those fed from wet mountains (the Aral, Balkhash)' });
    report('…semi-arid and wetter (P/PET 0.2 and over)', playaShare(0.2, Infinity), { unit: ' %', digits: 0,
        source: 'no count found: semi-arid closed basins mostly hold lakes — the Caspian, Urmia, Van, Turkana, Great Salt Lake' });
}

section('the land’s hollows fill with their rivers’ load (lane basins; the same finishes)');
// A hollow on the land fills with what its rivers bring (tectonics/step/rivers.js): a closed one keeps all its load, one
// a river flows through keeps it by how long its water stays — Brune's (1953) curve, as Vörösmarty et al. 2003 fit it,
// 1 − 0.05/√τ, τ the hollow's volume over its inflow (years). Hard: the curve against measured reservoirs. Reported: the
// land's lakes against Earth's, its largest, the land below its spill, and the land's mean height (the fill raises it)
{
    // measured reservoirs, τ their capacity over their river's yearly flow: Lake Nasser 162 km³ on the Nile's ~84 km³/yr
    // (τ ≈ 1.9 yr) keeps ~98 % of the Nile's load (Vörösmarty et al. 2003); the Three Gorges 39 km³ on the Yangtze's
    // ~450 km³/yr (τ ≈ 0.09 yr) kept ~75 % its first decade (Yang et al. 2014, Earth-Sci. Rev. 138: 469)
    const nasser = trapEfficiency(162 / 84), gorges = trapEfficiency(39 / 450);
    check('trap efficiency against measured reservoirs: Lake Nasser (τ 1.9 yr) over 95 %, the Three Gorges (τ 0.09 yr) 65–92 %',
        nasser > 0.95 && gorges > 0.65 && gorges < 0.92, `Nasser ${(100 * nasser).toFixed(0)} % (Earth ~98), Three Gorges ${(100 * gorges).toFixed(0)} % (Earth ~75)`);
    const bySeed = SEEDS.map(seed => landRows.filter(r => r.seed === seed)), meanOf = (R, f) => R.reduce((a, r) => a + f(r), 0) / Math.max(1, R.length);
    const detail = f => SEEDS.map((seed, i) => `${seed}: ${bySeed[i].map(r => `${r.t} ${f(r)}`).join(', ')}`).join(' · ');
    report('lakes on the land, of its area: mean of the moments', bySeed.map(R => meanOf(R, r => 100 * r.W.onLandKm2 / r.W.landKm2)), { earth: [1.8, 3.7], unit: ' %', digits: 1,
        source: '1.8 % in lakes over 10 ha (HydroLAKES: Messager et al. 2016, Nat. Commun. 7: 13603) to 3.7 % with the smallest (Verpoorter et al. 2014, GRL 41: 6396) — a glaciated land’s, today; the Caspian, a cut-off sea, not counted',
        detail: detail(r => `${(100 * r.W.onLandKm2 / r.W.landKm2).toFixed(1)}`) });
    report('the largest lake on the land, through the moments', bySeed.map(R => Math.max(...R.map(r => r.W.onLand[0]?.km2 ?? 0)) / 1e6), { earth: [0.07, 0.45], unit: ' Mkm²', digits: 2,
        source: 'Superior 0.082 Mkm² today; Mega-Chad 0.36 in the Holocene (Drake & Bristow 2006, The Holocene 16: 901) and Agassiz ~0.44 at its largest (Teller & Leverington 2004, GSA Bull. 116: 729)',
        detail: detail(r => `${((r.W.onLand[0]?.km2 ?? 0) / 1e6).toFixed(2)} Mkm² ${Math.round(1000 * (r.W.onLand[0]?.depthKm ?? 0))} m deep`) });
    report('the deepest lake on the land, through the moments', bySeed.map(R => Math.max(...R.flatMap(r => r.W.onLand.map(L => L.depthKm)), 0)), { earth: [0.4, 1.7], unit: ' km', digits: 2,
        source: 'Baikal 1.64 km, Tanganyika 1.47 (rifts: they sink faster than they fill); Superior 0.41 (Herdendorf 1982, J. Great Lakes Res. 8: 379)' });
    report('land below its spill (the finished ground, a lake’s floor not its water): mean of the moments', bySeed.map(R => meanOf(R, r => 100 * r.W.belowKm2 / r.W.landKm2)), { unit: ' %', digits: 1,
        source: 'no global figure found: closed depressions are the lakes’ floors and the dry basins’ — the Caspian’s, the Tarim’s, Eyre’s, Chad’s',
        detail: detail(r => `${(100 * r.W.belowKm2 / r.W.landKm2).toFixed(1)}`) });
    report('land: mean height above the sea (the finish)', bySeed.map(R => meanOf(R, r => r.W.meanKm)), { earth: [0.75, 0.95], unit: ' km', digits: 2,
        source: 'Earth’s land 797 m on average (ETOPO-era, 2012), 840 m in Kossinna’s 1921 hypsometry (the compilation in arXiv 1810.08658) — today’s land, glaciated',
        detail: detail(r => `${Math.round(1000 * r.W.meanKm)} m`) });
    report('sediment the history’s hollows hold (crust records): mean of the moments', bySeed.map(R => meanOf(R, r => r.fillKm3 / 1e6)), { unit: ' Mkm³', digits: 1,
        source: 'Earth’s continental basins hold ~10⁸ km³ of sediment and sedimentary rock (the continents’ ~1.8 km mean cover over ~150 Mkm²: Ronov 1980; the Congo’s alone ~9 km thick, Kadima et al. 2011)',
        detail: detail(r => `${(r.fillKm3 / 1e6).toFixed(1)}`) });
}

finish('Basins');
process.exit();
