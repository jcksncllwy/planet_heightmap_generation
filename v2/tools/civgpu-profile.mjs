// Lane civgpu, phase 1 (a probe, no product code): a People run as the Evolution page runs it (civ-worker.js →
// civ-page.js startPeople), timed stage by stage, with each frame's wall time and the peak memory, and optionally the
// CPU profile of the run's years split by function — to see what a GPU could take over.
//
//   node --max-old-space-size=16000 v2/tools/civgpu-profile.mjs --key <finish key> [--prof] [--out f.json]
//        the page's own civ world (160K), from a cached page finish (tools/lib/finish-cache.mjs)
//   node --max-old-space-size=16000 v2/tools/civgpu-profile.mjs --seed 243751 --time 430 --civ 160000|640000 [--prof] [--out f.json]
//        one finish at 640K cells (civ on; cached in v2/out/civ/cache), lived on at 160K (taken down as civWorldFromFinish
//        does for the page) or at 640K (the finish's own cells, as civWorldFromFinish keeps a finish no bigger than
//        PAGE_CELLS) — the same world at both meshes
//
// Stages: the climate ensemble's five runs (serial here; the page runs them in five workers at once), the substrate, the
// variability, the sim's setup, advance(0), advance(--more, default −2000: the future), the land views' and the
// picture's lookups, a travel query (its graph, then a second month). Times are wall ms; run on a quiet machine.

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { Session } from 'node:inspector';
import { buildSimMesh, meshFromArrays } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { finishPlanet } from '../js/finish/finish.js';
import { cropsFromMonths } from '../js/civ/crops.js';
import { civWorldFromFinish, seaOf, morePeople, travelFrom, startPeople } from '../js/civ/civ-page.js';
import { civSubstrate } from '../js/civ/substrate.js';
import { ensembleForcings, ensembleRain, landOf, climateVariability } from '../js/civ/climate-var.js';
import { createCivSim } from '../js/civ/sim.js';
import { CIV } from '../js/civ/civ-config.js';
import { loadFinish } from './lib/finish-cache.mjs';
import { OUT, MESH_SEED, frameOf, worldCode } from './lib/civ-world.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const KEY = arg('--key', null), SEED = Number(arg('--seed', 243751)), TIME = Number(arg('--time', 430)), CONT = Number(arg('--cont', 41));
const CIVS = arg('--civ', '160000').split(',').map(Number), CIVN = CIVS[0], FINN = Number(arg('--finish', 640000)), MORE = Number(arg('--more', -2000));
const PROF = process.argv.includes('--prof'), OUTF = arg('--out', null), SIM = 40000;
const T = {}, now = () => performance.now(), mb = () => Math.round(process.memoryUsage().rss / 1e6);
const peakMB = () => Math.round(process.resourceUsage().maxRSS / 1024);
const heapMB = () => Math.round(process.memoryUsage().heapUsed / 1e6);
const time = (k, f) => { const t0 = now(); const r = f(); T[k] = Math.round(now() - t0); return r; };
const atime = async (k, f) => { const t0 = now(); const r = await f(); T[k] = Math.round(now() - t0); return r; };
const asMesh = m => ({ numCells: m.numCells, xyz: m.xyz, adjOffset: m.adjOffset, adjList: m.adjList });

/** The climate page's parts seaOf reads, alone (the rest is big). */
const pageSea = p => (p ? { grid: p.grid, Tsea: { year: p.Tsea?.year }, upwelling: { year: p.upwelling?.year }, seaIce: { year: p.seaIce?.year } } : null);

/** The finish at FINN cells with its civ fields, cached; then the civ world at CIVN cells. */
async function world() {
    if (KEY) {
        const fin = await loadFinish(KEY);
        if (!fin?.civ) throw new Error(`no cached page finish with civ: ${KEY}`);
        return { w: { ...fin.civ, mesh: meshFromArrays(fin.civ.mesh) }, about: { key: KEY, seed: fin.meta.seed, timeMyr: fin.spec.timeMyr, finishCells: fin.spec.cells, host: fin.spec.host } };
    }
    const file = path.join(OUT, 'cache', `civgpu-${SEED}-${CONT}-${SIM}-${TIME}-${FINN / 1000}k-${worldCode()}.bin`);
    let fin;
    if (fs.existsSync(file)) { fin = v8.deserialize(fs.readFileSync(file)); fin.mesh = meshFromArrays(fin.mesh); }
    else {
        const simMesh = buildSimMesh(SIM, MESH_SEED), frame = await frameOf(SEED, { cont: CONT, sim: SIM, time: TIME });
        const f = await atime('finish', async () => finishPlanet({ frame, simMesh, seed: SEED, cells: FINN, pool: await TerrainPool.create(simMesh), closePool: true, civ: true }));
        // (what civWorldFromFinish reads, kept)
        fin = { mesh: f.mesh, z: f.z, ocean: f.ocean, lake: f.lake, climate: { cell: f.climate.cell, page: pageSea(f.climate.page) }, civ: f.civ, rivers: f.rivers };
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, v8.serialize({ ...fin, mesh: asMesh(fin.mesh) }));
    }
    const about = { seed: SEED, cont: CONT, timeMyr: TIME, finishCells: fin.mesh.numCells };
    if (fin.mesh.numCells > 1.01 * CIVN) return { w: civWorldFromFinish(fin), about };           // (the page's reduction, to PAGE_CELLS)
    // (the finish's own cells: civWorldFromFinish's `small` branch, which the page's PAGE_CELLS keeps from a finish this big)
    const cc = fin.climate.cell, L = fin.civ ?? {}, R = fin.rivers, n = fin.mesh.numCells, xyz = fin.mesh.xyz;
    const rivers = { lat: R.lat.slice(), lon: R.lon.slice(), q: R.q.slice(), regime: R.regime?.slice() ?? null, farFed: R.farFed?.slice() ?? null };
    return { about, w: { mesh: fin.mesh, z: fin.z, ocean: fin.ocean, lake: fin.lake, koppen: cc.koppen, tAnnual: cc.tAnnual, pAnnual: cc.pAnnual,
        stats: cc.stats, rivers, loess: L.loess ?? null, erg: L.erg ?? null, ice: L.ice ?? null, vector: L.vector ?? null, flow: L.flow ?? null, sea: seaOf(fin.climate.page),
        crops: L.months ? cropsFromMonths(L.months, n, c => Math.asin(xyz[3 * c + 2])) : null } };
}

/** The CPU profile of `f`: per function, self and inclusive ms (a function counted once a sample, however deep it recurs). */
function profiled(f) {
    if (!PROF) return [f(), null];
    const s = new Session();
    s.connect();
    const post = (m, p = {}) => { let out, err; s.post(m, p, (e, r) => { err = e; out = r; }); if (err) throw err; return out; };
    post('Profiler.enable'); post('Profiler.setSamplingInterval', { interval: 500 }); post('Profiler.start');
    const r = f();
    const { profile } = post('Profiler.stop');
    s.disconnect();
    const byId = new Map(profile.nodes.map(x => [x.id, x])), parent = new Map(), self = new Map();
    for (const x of profile.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
    for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + profile.timeDeltas[i] / 1000);
    const keyOf = x => `${x.callFrame.functionName || '(anon)'} ${path.basename(x.callFrame.url || '')}:${x.callFrame.lineNumber + 1}`;
    const S = new Map(), I = new Map();
    for (const [id, ms] of self) {
        const k = keyOf(byId.get(id));
        S.set(k, (S.get(k) ?? 0) + ms);
        const seen = new Set();
        for (let a = id; a !== undefined; a = parent.get(a)) { const ka = keyOf(byId.get(a)); if (!seen.has(ka)) { seen.add(ka); I.set(ka, (I.get(ka) ?? 0) + ms); } }
    }
    const top = (M, k) => [...M].sort((a, b) => b[1] - a[1]).slice(0, k).map(([fn, ms]) => [fn, Math.round(ms)]);
    return [r, { self: top(S, 45), inclusive: top(I, 60) }];
}

// (several sizes: the finish built once here, then each size in a fresh process of its own, one after another — no JIT or
// heap carried from one into the next)
if (CIVS.length > 1) {
    const { spawnSync } = await import('node:child_process');
    await world();
    for (const N of CIVS) {
        const args = process.argv.slice(2).map((a, i, A) => (A[i - 1] === '--civ' ? String(N) : A[i - 1] === '--out' ? a.replace(/\.json$/, `-${N / 1000}k.json`) : a));
        const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], ...args], { stdio: 'inherit' });
        if (r.status !== 0) process.exit(r.status ?? 1);
    }
    process.exit(0);
}
const t0 = now();
const { w, about } = await atime('world', world);
const n = w.mesh.numCells;
console.log(`world ${JSON.stringify(about)} → civ ${n.toLocaleString()} cells (${Math.round((now() - t0) / 1000)} s); rss ${mb()} MB`);
const mem = { afterWorld: mb() };

const land = { xyz: w.mesh.xyz, z: w.z, land: landOf(w.ocean) };
const runs = ensembleForcings().map((f, i) => time(`ensemble${i}`, () => ensembleRain(land, f)));
mem.afterEnsemble = mb();
const sub = time('substrate', () => civSubstrate(w));
const vary = time('variability', () => climateVariability(w, sub, CIV, runs));
mem.afterSubstrate = mb();
const frames = [];
let tf = 0;
const sim = time('simSetup', () => createCivSim(w, sub, { vary, onFrame: fr => {
    const t = now();
    frames.push({ bp: fr.bp, ms: Math.round(t - tf), people: fr.people, farmers: fr.farmers, polities: fr.polities ?? null, heapMB: heapMB() });
    tf = t;
} }));
mem.afterSetup = mb();
tf = now();
const [, prof] = profiled(() => time('advance0', () => sim.advance(0)));
mem.afterAdvance0 = mb(); mem.heapAfterAdvance0 = heapMB();
time('advanceMore', () => sim.advance(MORE));
console.log(`advance(0) ${T.advance0} ms over ${frames.length} frames; advance(${MORE}) ${T.advanceMore} ms; rss ${mb()} MB, peak ${peakMB()} MB`);
// (the page's own call, whole, for what it adds around the stages above: the picture's cells, the land views, the frames' packing)
if (!PROF) {
    const sp = time('startPeopleWhole', () => startPeople(w, 2048, () => {}, runs));
    time('morePeopleWhole', () => morePeople(sp.state, MORE));
    time('travelGraphAndQuery', () => travelFrom(sp.state, 1, 0, 30, 30));
    time('travelQuery', () => travelFrom(sp.state, 1, 6, 10, 40));
}
mem.peakRssMB = peakMB();
const res = { about, civCells: n, node: process.version, arch: process.arch, T, mem, frames, prof };
console.log(JSON.stringify(T));
console.log(JSON.stringify(mem));
if (prof) for (const [fn, ms] of prof.inclusive.slice(0, 30)) console.log(`  ${String(ms).padStart(7)} ms  ${fn}`);
if (OUTF) { fs.mkdirSync(path.dirname(path.resolve(OUTF)), { recursive: true }); fs.writeFileSync(OUTF, JSON.stringify(res, null, 1)); }
