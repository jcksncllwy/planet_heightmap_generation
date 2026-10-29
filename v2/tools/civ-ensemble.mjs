// The civ layer over many generated worlds at once (plans/CIV_PLAN.md §9.7, stage A): each world built as the page
// builds it (finish at the page's 160K cells, civWorldFromFinish — the disease climate included), cached, then lived
// through runCivSim; per world a few numbers (where people arose, which landmasses they reached, farming, towns, states),
// and a summary over all of them — so a change is judged on the spread of worlds, not one.
//
//   sim-slots run -n 4 --gb 6 -- node --max-old-space-size=8000 v2/tools/civ-ensemble.mjs [--seeds 1-20] [--jobs N: default SIM_THREADS, else 4] [--label base] [--set key=value,…]
//   node v2/tools/civ-ensemble.mjs --compare base other
//
// --set overrides CIV's values for the run (JSON values: --set onsetPowerLate=2,voyageDays=[[0,2.5],[5000,9]]).
// Output: v2/out/civ/ensemble/<label>/<seed>.json and summary.json.

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OUT, MESH_SEED, frameOf, worldCode } from './lib/civ-world.mjs';
import { buildSimMesh, meshFromArrays } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { finishPlanet } from '../js/finish/finish.js';
import { civWorldFromFinish } from '../js/civ/civ-page.js';
import { civSubstrate, PACKAGES } from '../js/civ/substrate.js';
import { runCivSim, farms } from '../js/civ/sim.js';
import { CIV } from '../js/civ/civ-config.js';
import { CROP_KEYS } from '../js/civ/crops.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SELF = fileURLToPath(import.meta.url), DIR = path.join(OUT, 'ensemble'), CACHE = path.join(OUT, 'cache');
const SIM = 40000, CELLS = 160000;
// the worlds: seeds, each at its own share of continent and moment (so the set spans young and old, wet and dry worlds)
const worldOfSeed = seed => ({ seed, cont: [25, 30, 35, 40][seed % 4], time: [200, 300, 400, 500, 600][seed % 5] });
const seedsOf = s => s.split(',').flatMap(r => { const [a, b] = r.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const overridesOf = s => (s ? Object.fromEntries(s.split(/,(?=[A-Za-z_]+=)/).map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), JSON.parse(kv.slice(i + 1))]; })) : {});

/** The world as the page has it (civWorldFromFinish), cached. */
async function pageWorld({ seed, cont, time }) {
    const file = path.join(CACHE, `page-${seed}-${cont}-${SIM}-${time}-${CELLS / 1000}k-${worldCode()}.bin`);
    if (fs.existsSync(file)) { const w = v8.deserialize(fs.readFileSync(file)); if (CROP_KEYS.every(k => w.crops?.[k]) && w.flow) { w.mesh = meshFromArrays(w.mesh); return w; } }   // (an older cache, without the crops' climate or the winds: built again)
    const simMesh = buildSimMesh(SIM, MESH_SEED), frame = await frameOf(seed, { cont, sim: SIM, time });
    const fin = await finishPlanet({ frame, simMesh, seed, cells: CELLS, pool: await TerrainPool.create(simMesh), closePool: true });
    const w = civWorldFromFinish(fin);
    const { mesh } = w;
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, v8.serialize({ ...w, mesh: { numCells: mesh.numCells, xyz: mesh.xyz, adjOffset: mesh.adjOffset, adjList: mesh.adjList } }));
    return w;
}

/** One world's run, as numbers. */
async function one(spec, label, C) {
    const t0 = performance.now(), w = await pageWorld(spec), tWorld = performance.now() - t0;
    const sub = civSubstrate(w, C), n = w.mesh.numCells, A = sub.cellKm2, { adjOffset, adjList } = w.mesh;
    const r = runCivSim(w, sub, { C });
    // landmasses (today's coast) of ≥ 1M km², and whom they hold when
    const land = c => !w.ocean[c] && !w.lake[c], comp = new Int32Array(n).fill(-1), sizes = [];
    for (let s = 0; s < n; s++) if (land(s) && comp[s] < 0) {
        const st = [s], id = sizes.length; comp[s] = id; let k = 0;
        while (st.length) { const a = st.pop(); k++; for (let e = adjOffset[a]; e < adjOffset[a + 1]; e++) { const b = adjList[e]; if (land(b) && comp[b] < 0) { comp[b] = id; st.push(b); } } }
        sizes.push(k);
    }
    const big = sizes.map((k, i) => [k, i]).filter(([k]) => k * A >= 1e6).sort((a, b) => b[0] - a[0]);
    const peopledBy = new Map(big.map(([, i]) => [i, null])), farmedBy = new Map(big.map(([, i]) => [i, null]));
    let landKm2 = 0; for (let c = 0; c < n; c++) if (land(c)) landKm2 += A;
    const share = (f, test) => { let k = 0; for (let c = 0; c < n; c++) if (land(c) && test(f.life[c])) k++; return k * A / landKm2; };
    const at = bp => r.frames.reduce((a, b) => (Math.abs(b.bp - bp) < Math.abs(a.bp - bp) ? b : a));
    let firstTownBP = null, firstCityBP = null, firstStateBP = null, maxStates = 0;
    for (const f of r.frames) {
        for (const [, i] of big) {
            if (peopledBy.get(i) !== null && farmedBy.get(i) !== null) continue;
            for (let c = 0; c < n; c++) if (comp[c] === i) {
                if (peopledBy.get(i) === null && f.life[c]) peopledBy.set(i, f.bp);
                if (farmedBy.get(i) === null && farms(f.life[c])) { farmedBy.set(i, f.bp); break; }
            }
        }
        const T = f.towns;
        if (T && T.length) { firstTownBP ??= f.bp; for (let k = 0; k < T.length; k += 5) if (T[k + 2] >= 15000) { firstCityBP ??= f.bp; break; } }
        const st = f.polities?.states ?? 0;
        if (st > 0) firstStateBP ??= f.bp;
        maxStates = Math.max(maxStates, st);
    }
    const origin = r.origins[0], originMass = comp[origin] >= 0 ? sizes[comp[origin]] * A : null;
    const last = at(0), f5 = at(5000);
    const biggestTown = f => { const T = f.towns; let m = 0; if (T) for (let k = 0; k < T.length; k += 5) m = Math.max(m, T[k + 2]); return Math.round(m); };
    const out = {
        ...spec, label, secs: { world: Math.round(tWorld / 1000), total: Math.round((performance.now() - t0) / 1000) },
        landMkm2: +(landKm2 / 1e6).toFixed(1),
        landmasses: big.map(([k, i]) => ({ Mkm2: +(k * A / 1e6).toFixed(1), origin: i === comp[origin], peopledBP: peopledBy.get(i), farmedBP: farmedBy.get(i) })),
        originMkm2: originMass && +(originMass / 1e6).toFixed(1),
        peopledShare: { '20ka': +share(at(20000), x => x > 0).toFixed(2), '10ka': +share(at(10000), x => x > 0).toFixed(2), '0': +share(last, x => x > 0).toFixed(2) },
        farmedShare: { '5ka': +share(f5, farms).toFixed(2), '0': +share(last, farms).toFixed(2) },
        centres: r.centres.length, firstCentreBP: r.centres[0]?.bp ?? null, packages: [...new Set(r.centres.map(c => c.pkg))],
        voyagingBP: Math.max(...r.voyagingBP.map(x => x ?? -Infinity)) > -Infinity ? Math.max(...r.voyagingBP.filter(x => x !== null)) : null,
        peopleM: { '10ka': +(at(10000).people / 1e6).toFixed(1), '6ka': +(at(6000).people / 1e6).toFixed(1), '0': +(last.people / 1e6).toFixed(1) },
        farmersM0: +(last.farmers / 1e6).toFixed(1),
        firstTownBP, firstCityBP, firstStateBP, maxStates, biggestTown: { '5ka': biggestTown(f5), '0': biggestTown(last) },
    };
    fs.mkdirSync(path.join(DIR, label), { recursive: true });
    fs.writeFileSync(path.join(DIR, label, `${spec.seed}.json`), JSON.stringify(out, null, 1));
    return out;
}

const ka = x => (x === null || x === undefined ? '—' : (x / 1000).toFixed(1));
const median = a => { const s = a.filter(x => x !== null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
/** The summary over a label's worlds. */
function summarise(rows) {
    const N = rows.length, frac = f => `${rows.filter(f).length}/${N}`;
    return {
        worlds: N,
        withFarming: frac(r => r.firstCentreBP !== null), withTowns15k: frac(r => r.firstCityBP !== null), withStates: frac(r => r.maxStates > 0),
        allBigLandmassesPeopled: frac(r => r.landmasses.every(m => m.peopledBP !== null)),
        medianFirstCentreKa: ka(median(rows.map(r => r.firstCentreBP))), medianFirstCityKa: ka(median(rows.map(r => r.firstCityBP))),
        medianFirstStateKa: ka(median(rows.map(r => r.firstStateBP))), medianCentres: median(rows.map(r => r.centres)),
        medianPeopleM0: median(rows.map(r => r.peopleM['0'])), medianFarmedShare0: median(rows.map(r => r.farmedShare['0'])),
    };
}
function table(rows) {
    console.log('seed cont  Myr | land  origin  masses(peopled ka/farmed ka)                 | centres first | farmed 5ka/0 | people 6ka/0 M | town city state(max) ka | voyage ka');
    for (const r of rows.sort((a, b) => a.seed - b.seed)) {
        const masses = r.landmasses.slice(0, 5).map(m => `${m.Mkm2}${m.origin ? '*' : ''}(${ka(m.peopledBP)}/${ka(m.farmedBP)})`).join(' ');
        console.log(`${String(r.seed).padStart(4)} ${String(r.cont).padStart(4)} ${String(r.time).padStart(4)} | ${String(r.landMkm2).padStart(5)} ${String(r.originMkm2).padStart(5)}  ${masses.padEnd(46)} | ${String(r.centres).padStart(3)} ${ka(r.firstCentreBP).padStart(5)} | ${r.farmedShare['5ka'].toFixed(2)}/${r.farmedShare['0'].toFixed(2)}    | ${String(r.peopleM['6ka']).padStart(5)}/${String(r.peopleM['0']).padStart(5)}   | ${ka(r.firstTownBP).padStart(4)} ${ka(r.firstCityBP).padStart(4)} ${ka(r.firstStateBP).padStart(4)}(${r.maxStates})     | ${ka(r.voyagingBP)}`);
    }
}
const load = label => fs.readdirSync(path.join(DIR, label)).filter(f => /^\d+\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(DIR, label, f), 'utf8')));

if (process.argv.includes('--one')) {
    const seed = Number(arg('--one')), label = arg('--label', 'base'), C = { ...CIV, ...overridesOf(arg('--set', '')) };
    await one(worldOfSeed(seed), label, C);
    process.exit(0);
} else if (process.argv.includes('--compare')) {
    const i = process.argv.indexOf('--compare'), a = process.argv[i + 1], b = process.argv[i + 2];
    const A = summarise(load(a)), B = summarise(load(b));
    console.log(`${'metric'.padEnd(26)} ${a.padStart(12)} ${b.padStart(12)}`);
    for (const k of Object.keys(A)) console.log(`${k.padEnd(26)} ${String(A[k]).padStart(12)} ${String(B[k]).padStart(12)}`);
} else {
    const seeds = seedsOf(arg('--seeds', '1-20')), jobs = Number(arg('--jobs', process.env.SIM_THREADS || 4)), label = arg('--label', 'base'), set = arg('--set', '');
    fs.mkdirSync(path.join(DIR, label), { recursive: true });
    if (set) fs.writeFileSync(path.join(DIR, label, 'overrides.json'), JSON.stringify(overridesOf(set)));
    const queue = [...seeds], t0 = performance.now();
    const worker = async () => {
        while (queue.length) {
            const seed = queue.shift();
            await new Promise(res => {
                const args = ['--max-old-space-size=6000', SELF, '--one', String(seed), '--label', label, ...(set ? ['--set', set] : [])];
                const p = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
                let err = ''; p.stderr.on('data', d => { err += d; });
                p.on('close', code => { console.log(`  seed ${seed} ${code === 0 ? 'done' : 'FAILED: ' + err.trim().split('\n').slice(-3).join(' / ')} (${((performance.now() - t0) / 1000).toFixed(0)} s)`); res(); });
            });
        }
    };
    await Promise.all(Array.from({ length: jobs }, worker));
    const rows = load(label).filter(r => seeds.includes(r.seed));
    table(rows);
    const S = summarise(rows);
    fs.writeFileSync(path.join(DIR, label, 'summary.json'), JSON.stringify(S, null, 1));
    console.log(S);
}
