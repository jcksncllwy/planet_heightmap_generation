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
import { lakeBalance } from '../js/finish/finish-basins.js';
import { worldOcean } from '../js/terrain/world-ocean.js';
import { Water } from '../js/finish/finish-hydro.js';

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

section('the world ocean is the largest body of water');
{
    // two bodies on a chain: the larger is the ocean, the smaller is cut off
    const N = 10, mesh = chain(N);
    const z = Float32Array.from([-1, -1, 0.5, -2, -2, -2, -2, 0.2, 1, -0.1]), W = worldOcean(mesh, z);
    check('the largest body below sea level is the world ocean; the others are cut off', W.ocean.join('') === '0001111000' && W.cut.join('') === '1100000001',
        `ocean ${W.ocean.join('')} · cut off ${W.cut.join('')}`);
}

section('cut-off seas through the history (finished at 160K cells)');
const simMesh = buildSimMesh(SIM, MESH_SEED), scene = TERRAIN_SCENES.find(s => s.id === 'cycle'), rows = [];
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

finish('Basins');
process.exit();
