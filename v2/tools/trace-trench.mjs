// Where the world's trenches come from and why they last: a history of the 'cycle' scene run headless, every stretch of
// overriding boundary sorted by how its trench cell was established (founder, propagation, wing, rollback, or simply fed by
// a closing contact), how fast it closes, what it faces and what stands behind it; with trench age and pair lifetimes.
// Diagnostics only: nothing here touches the history (armTrench is watched from outside, flags read between steps).
// Usage: node v2/tools/trace-trench.mjs [--seed 12345] [--len 1200] [--cells 40000] [--from 300] [--every 20] [--set k=v,…] [--json out.json]
import fs from 'node:fs';
import { labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { BoundaryKind } from '../js/tectonics/model/world.js';
import { CrustType, CrustFlag, CrustRaster, OrogenyType } from '../js/tectonics/model/crust.js';
import { TECTONICS } from '../js/tectonics/config.js';
import { hopDistance } from '../js/core/mesh-bfs.js';
import { stageOf } from './lib/cycle-stage.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seed = Number(opt('--seed', 12345)), len = Number(opt('--len', 1200)), cells = Number(opt('--cells', 40000));
const from = Number(opt('--from', 300)), every = Number(opt('--every', 20)), jsonOut = opt('--json', null), set = opt('--set', null);
const overrides = set ? Object.fromEntries(set.split(',').map(kv => { const [k, v] = kv.split('='); return [k, v === 'true' ? true : v === 'false' ? false : Number(v)]; })) : {};
const KM_TRUE = 1 / 1.15;        // (a trench of N cells is N × edgeKm ÷ 1.15 long: the cell chain's zigzag, gs-belt's measure)

const mesh = labMesh(cells), scene = TERRAIN_SCENES.find(s => s.id === 'cycle');
const { numCells, adjOffset, adjList, edgeKm, cellAreaKm2 } = mesh;

// Each plate raster's trench cells: how each came to be flagged (cause) and when
const CAUSES = ['start', 'founder', 'founderInside', 'founderAcross', 'propagate', 'wing', 'rollback', 'feed', 'inherited', 'other'];
const trace = new WeakMap();
const traceOf = crust => { let t = trace.get(crust); if (!t) { t = { cause: new Uint8Array(numCells), born: new Float32Array(numCells), was: new Uint8Array(numCells) }; trace.set(crust, t); } return t; };
let clock = 0;
const bornKm = new Float64Array(CAUSES.length), bornLog = [];
const label = stack => {
    if (/growWings|growWing/.test(stack)) return 'wing';
    if (/propagateAlong|propagateAcross/.test(stack)) return 'propagate';
    if (/armMargin/.test(stack)) return 'founder';
    if (/founderAcross|armAcross/.test(stack)) return 'founderAcross';
    if (/subduction-init\.js:5\d\d|subduction-init\.js:49\d/.test(stack)) return /subduction-init\.js:(595)/.test(stack) ? 'founderInside' : 'propagate';
    if (/resolve\.js/.test(stack)) return 'rollback';
    if (/start-world|scene-kit|scenarios/.test(stack)) return 'start';
    return 'other';
};
const origArm = CrustRaster.prototype.armTrench;
Error.stackTraceLimit = 8;
CrustRaster.prototype.armTrench = function (cell, slabKm) {
    if (!(this.flags[cell] & CrustFlag.TRENCH)) {
        const c = label(new Error().stack), t = traceOf(this), i = CAUSES.indexOf(c);
        t.cause[cell] = i + 1; t.born[cell] = clock; bornKm[i] += edgeKm * KM_TRUE;
    }
    return origArm.call(this, cell, slabKm);
};

const world = scene.build(mesh, seed);
Object.assign(world.config, overrides);

/** Between steps: any flagged cell not seen before was flagged without armTrench: fed at a closing contact, or came with its crust. */
const lastCause = new Uint8Array(numCells), lastBorn = new Float32Array(numCells), X = [0, 0, 0];
function sweep(w) {
    clock = w.time;
    const { xyz, index } = mesh;
    for (const P of w.plates) {
        if (!P.alive) continue;
        const { mask, flags, slabKm } = P.crust, t = traceOf(P.crust);
        for (let c = 0; c < numCells; c++) {
            if (!mask[c] || !(flags[c] & CrustFlag.TRENCH)) { if (t.cause[c]) { t.cause[c] = 0; t.was[c] = 1; } continue; }
            if (t.cause[c]) continue;
            if (slabKm[c] < 40 || t.was[c]) { const i = CAUSES.indexOf('feed'); t.cause[c] = i + 1; t.born[c] = w.time; bornKm[i] += edgeKm * KM_TRUE; continue; }   // (feedTrench starts a slab at one step's km)
            // a cell that came with its crust from another plate: it keeps the label held where it stands
            P.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], X);
            const at = index.nearest(X[0], X[1], X[2]);
            let got = lastCause[at] ? at : -1;
            for (let k = adjOffset[at]; got < 0 && k < adjOffset[at + 1]; k++) if (lastCause[adjList[k]]) got = adjList[k];
            if (got >= 0) { t.cause[c] = lastCause[got]; t.born[c] = lastBorn[got]; }
            else { const i = CAUSES.indexOf(slabKm[c] < 400 ? 'feed' : 'inherited'); t.cause[c] = i + 1; t.born[c] = w.time; bornKm[i] += edgeKm * KM_TRUE; }
        }
    }
    lastCause.fill(0);
    for (let g = 0; g < numCells; g++) {
        const o = w.owner[g]; if (o < 0) continue;
        const t = traceOf(w.plates[o].crust), c = w.ownerCell[g];
        if (t.cause[c]) { lastCause[g] = t.cause[c]; lastBorn[g] = t.born[c]; }
    }
}

const RATE_BINS = [0.5, 1, 2, 4, 8, Infinity], AGE_BINS = [10, 20, 30, 60, 100, Infinity], AREA_BINS = [0.5, 2, 8, 30, Infinity], TRENCH_AGE = [5, 10, 20, 50, 100, Infinity];
const bin = (bins, v) => { let i = 0; while (v >= bins[i]) i++; return i; };
const SEG_BINS = [300, 800, 2000, 5000, Infinity];
const rows = [], pairs = new Map();
function sample(f) {
    const { owner, ownerCell, plates, convergence } = world;
    const nearLand = hopDistance(mesh, w => f.owner[w] >= 0 && (f.type[w] === CrustType.CONTINENT || f.type[w] === CrustType.CRATON), Math.ceil(600 / edgeKm), () => true);
    const row = { time: f.time, stage: stageOf(f), km: 0, fed: 0, flagged: 0, cause: {}, rate: Array(RATE_BINS.length).fill(0), incomingAge: Array(AGE_BINS.length).fill(0), lowerArea: Array(AREA_BINS.length).fill(0), upperArea: Array(AREA_BINS.length).fill(0), trenchAge: Array(TRENCH_AGE.length).fill(0), byClass: {}, slabUnder600: 0, oo: 0, nearLand: 0, upperLand: 0, kinds: {}, seg: Array(SEG_BINS.length).fill(0), segFlag: Array(SEG_BINS.length).fill(0), nSeg: 0, consumption: 0, lowerType: {} };
    const plateCells = new Map();
    for (let w = 0; w < numCells; w++) if (f.owner[w] >= 0) plateCells.set(f.owner[w], (plateCells.get(f.owner[w]) ?? 0) + 1);
    const areaOf = id => (plateCells.get(id) ?? 0) * cellAreaKm2 / 1e6;
    const unit = edgeKm * KM_TRUE;
    for (let w = 0; w < numCells; w++) {
        if (f.boundary[w] !== BoundaryKind.OVERRIDING) continue;
        const U = plates[f.owner[w]], c = ownerCell[w], t = traceOf(U.crust), rate = Math.max(0, convergence[w]);
        // the plate it overrides: the neighbour most closing, and the floor coming in
        let lower = -1, age = NaN, lowerLand = false;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
            const nb = adjList[k];
            if (f.owner[nb] < 0 || f.owner[nb] === f.owner[w]) continue;
            if (lower < 0 || f.boundary[nb] === BoundaryKind.SUBDUCTING) { lower = f.owner[nb]; age = f.time - f.formedAt[nb]; lowerLand = f.type[nb] !== CrustType.OCEAN; }
        }
        const flag = (f.flags[w] & CrustFlag.TRENCH) !== 0, cause = flag && t.cause[c] ? CAUSES[t.cause[c] - 1] : flag ? 'unlabelled' : 'noflag';
        const near = nearLand[w] >= 0, upperLand = f.type[w] !== CrustType.OCEAN, slab = U.crust.slabKm[c] ?? 0;
        row.km += unit; if (flag) row.flagged += unit; else row.noflagLand = (row.noflagLand ?? 0) + (upperLand ? unit : 0);
        if (upperLand) row.upperLand += unit;
        row.consumption += unit * rate * 1e-5 * 1e6 / 1e6;            // km × cm/yr → km²/yr
        { const lt = lowerLand ? 'land' : 'ocean'; row.lowerType[lt] = (row.lowerType[lt] ?? 0) + unit; }
        row.cause[cause] = (row.cause[cause] ?? 0) + unit;
        row.rate[bin(RATE_BINS, rate)] += unit;
        if (Number.isFinite(age)) row.incomingAge[bin(AGE_BINS, age)] += unit;
        if (lower >= 0) row.lowerArea[bin(AREA_BINS, areaOf(lower))] += unit;
        row.upperArea[bin(AREA_BINS, areaOf(f.owner[w]))] += unit;
        if (flag) row.trenchAge[bin(TRENCH_AGE, f.time - t.born[c])] += unit;
        if (near) row.nearLand += unit; else row.oo += unit;
        if (slab < 600) row.slabUnder600 += unit;
        const hasKeel = U.stats.continentalCells > 0, cls = `${hasKeel ? 'upperHasLand' : 'upperOcean'}|${U.isOceanBorn ? 'oceanBorn' : 'old'}`;
        row.byClass[cls] = (row.byClass[cls] ?? 0) + unit;
        if (lower >= 0) { const key = `${f.owner[w]}>${lower}`, p = pairs.get(key) ?? pairs.set(key, { first: f.time, last: f.time, most: 0, kmMyr: 0 }).get(key); p.last = f.time; p.kmSample = unit + (p.at === f.time ? p.kmSample : 0); p.at = f.time; p.most = Math.max(p.most, p.kmSample); p.kmMyr += unit * every; }
    }
    // trench flags left at a plate edge that is not overriding: their slabs still pull (forces read the flag, not the motion)
    row.deadFlag = 0;
    for (let w = 0; w < numCells; w++) {
        if (f.owner[w] < 0 || !(f.flags[w] & CrustFlag.TRENCH) || f.type[w] !== CrustType.OCEAN || f.boundary[w] === BoundaryKind.OVERRIDING || f.boundary[w] === BoundaryKind.NONE) continue;
        row.deadFlag += unit;
    }
    for (let w = 0; w < numCells; w++) if (f.owner[w] >= 0) { const kn = f.boundary[w]; row.kinds[kn] = (row.kinds[kn] ?? 0) + unit; }
    // unbroken stretches of one upper plate's overriding boundary
    const seen = new Uint8Array(numCells);
    for (let s = 0; s < numCells; s++) {
        if (seen[s] || f.boundary[s] !== BoundaryKind.OVERRIDING) continue;
        const q = [s]; seen[s] = 1;
        let fl = 0;
        for (let i = 0; i < q.length; i++) { if (f.flags[q[i]] & CrustFlag.TRENCH) fl++; for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const nb = adjList[k]; if (!seen[nb] && f.boundary[nb] === BoundaryKind.OVERRIDING && f.owner[nb] === f.owner[s]) { seen[nb] = 1; q.push(nb); } } }
        const b = bin(SEG_BINS, q.length * unit);
        row.seg[b] += q.length * unit; row.segFlag[b] += fl * unit; row.nSeg++;
    }
    // the continents' footprint: worked within 240 Myr (phase 13's measure), by shortening, and thickened ≥ 10 % (strain proxy)
    let cont = 0, def = 0, comp = 0, thick = 0;
    for (let w = 0; w < numCells; w++) {
        if (f.owner[w] < 0 || (f.type[w] !== CrustType.CONTINENT && f.type[w] !== CrustType.CRATON)) continue;
        cont++;
        if (f.oroType[w] && f.time - f.oroLast[w] < 240) { def++; if (f.oroType[w] !== OrogenyType.RIFT) { comp++; if (f.thickKm[w] >= 0.1 * TECTONICS.continentCrustKm) thick++; } }
    }
    row.deformed = def / Math.max(1, cont); row.compressed = comp / Math.max(1, cont); row.strained = thick / Math.max(1, cont);
    // forced contacts: closing with no slab established (each counted once, on the side that would go down)
    row.forced = { km: 0, area: 0, rate: Array(RATE_BINS.length).fill(0), age: Array(AGE_BINS.length).fill(0), oo: 0, ol: 0, seg: Array(SEG_BINS.length).fill(0) };
    const CONV = BoundaryKind.CONVERGING ?? -1;
    if (CONV >= 0) {
        const seenF = new Uint8Array(numCells);
        for (let w = 0; w < numCells; w++) {
            if (f.boundary[w] !== CONV) continue;
            if (!seenF[w]) { const q = [w]; seenF[w] = 1; for (let i = 0; i < q.length; i++) for (let j = adjOffset[q[i]]; j < adjOffset[q[i] + 1]; j++) { const nb = adjList[j]; if (!seenF[nb] && f.boundary[nb] === CONV && f.owner[nb] === f.owner[w]) { seenF[nb] = 1; q.push(nb); } } row.forced.seg[bin(SEG_BINS, q.length * unit)] += q.length * unit / 2; }
            const rate = Math.max(0, convergence[w]), h = unit / 2;
            let other = -1; for (let j = adjOffset[w]; j < adjOffset[w + 1] && other < 0; j++) if (f.owner[adjList[j]] >= 0 && f.owner[adjList[j]] !== f.owner[w]) other = adjList[j];
            row.forced.km += h; row.forced.area += h * rate * 1e-5; row.forced.rate[bin(RATE_BINS, rate)] += h;
            if (f.type[w] === CrustType.OCEAN) row.forced.age[bin(AGE_BINS, f.time - f.formedAt[w])] += h;
            if (other >= 0 && f.type[w] === CrustType.OCEAN && f.type[other] === CrustType.OCEAN) row.forced.oo += h; else row.forced.ol += h;
        }
    }
    // what kind of belt worked the crust, within 240 and 50 Myr (shares of continental crust)
    row.oro = {}; row.oro50 = {};
    for (let w = 0; w < numCells; w++) {
        if (f.owner[w] < 0 || (f.type[w] !== CrustType.CONTINENT && f.type[w] !== CrustType.CRATON) || !f.oroType[w]) continue;
        const n = Object.keys(OrogenyType).find(x => OrogenyType[x] === f.oroType[w]) ?? f.oroType[w];
        if (f.time - f.oroLast[w] < 240) row.oro[n] = (row.oro[n] ?? 0) + 100 / cont;
        if (f.time - f.oroLast[w] < 50) row.oro50[n] = (row.oro50[n] ?? 0) + 100 / cont;
    }
    // the coasts: active against passive, on the frame's margin record, and consumed-at-rates
    const counts = {};
    for (let w = 0; w < numCells; w++) if (f.margin[w]) counts[f.margin[w]] = (counts[f.margin[w]] ?? 0) + 1;
    row.margins = counts;
    rows.push(row);
}

const t0 = performance.now();
simulate(world, { untilMyr: len, drive: w => { sweep(w); scene.drive(w); }, snapshotEveryMyr: 10, keepFrames: false, onFrame: f => { if (f.time >= from && f.time % every === 0) { sweep(world); sample(f); } } });

const avg = (rs, get) => rs.length ? rs.reduce((s, r) => s + get(r), 0) / rs.length : NaN;
const k = x => (x / 1000).toFixed(1).padStart(6);
function table(rs, title) {
    console.log(`\n== ${title} (${rs.length} frames) ==`);
    console.log('total k km', k(avg(rs, r => r.km)), ' flagged', k(avg(rs, r => r.flagged)), ' within 600 km of land', k(avg(rs, r => r.nearLand)), ' open ocean', k(avg(rs, r => r.oo)), ' slab<600km', k(avg(rs, r => r.slabUnder600)));
    const keys = new Set(rs.flatMap(r => Object.keys(r.cause))), line = (name, ks, bins) => console.log(name.padEnd(14), ks.map((b, i) => `${b}:${k(avg(rs, r => bins(r)[i]))}`).join('  '));
    console.log('by cause      ', [...keys].sort((a, b) => avg(rs, r => r.cause[b] ?? 0) - avg(rs, r => r.cause[a] ?? 0)).map(c => `${c}:${k(avg(rs, r => r.cause[c] ?? 0))}`).join('  '));
    const cl = new Set(rs.flatMap(r => Object.keys(r.byClass)));
    console.log('by upper      ', [...cl].map(c => `${c}:${k(avg(rs, r => r.byClass[c] ?? 0))}`).join('  '));
    const m = rs.map(r => { let a = 0, p = 0; for (const [key, v] of Object.entries(r.margins)) { if ((key & 7) === 2) a += v; else if ((key & 7) === 1) p += v; } return a / Math.max(1, a + p); });
    console.log('active coast %', (100 * m.reduce((x, y) => x + y, 0) / m.length).toFixed(0), ' deformed240 %', (100 * avg(rs, r => r.deformed)).toFixed(0), ' compressed %', (100 * avg(rs, r => r.compressed)).toFixed(0), ' thickened≥10 % of crust %', (100 * avg(rs, r => r.strained)).toFixed(0));
    const fr = rs[0].forced;
    if (fr) { const a = (key, i) => avg(rs, r => r.forced[key][i]); console.log('forced km', k(avg(rs, r => r.forced.km)), ' area km²/yr', avg(rs, r => r.forced.area).toFixed(2), ' ocean-ocean', k(avg(rs, r => r.forced.oo)), ' with land', k(avg(rs, r => r.forced.ol)), ' rate', RATE_BINS.map((b, i) => `${b}:${k(a('rate', i))}`).join(' '), ' age', AGE_BINS.map((b, i) => `${b}:${k(a('age', i))}`).join(' '), ' stretch', SEG_BINS.map((b, i) => `${b}:${k(a('seg', i))}`).join(' ')); }
    const names = o => [...new Set(rs.flatMap(r => Object.keys(r[o])))].map(n => `${n}:${avg(rs, r => r[o][n] ?? 0).toFixed(0)}`).join(' ');
    console.log('belt kinds %, 240 Myr', names('oro'), ' | 50 Myr', names('oro50'));
    console.log('flagged, not overriding', k(avg(rs, r => r.deadFlag)), ' margins', JSON.stringify(Object.fromEntries(Object.keys(rs[0].margins).map(m => [m, Math.round(avg(rs, r => r.margins[m] ?? 0))]))));
    console.log('upper cell land', k(avg(rs, r => r.upperLand)), ' lower land', k(avg(rs, r => r.lowerType.land ?? 0)), ' noflag on land', k(avg(rs, r => r.noflagLand ?? 0)), ' L×v km²/yr', avg(rs, r => r.consumption).toFixed(2), ' stretches', avg(rs, r => r.nSeg).toFixed(0));
    console.log('boundary kinds', [...new Set(rs.flatMap(r => Object.keys(r.kinds)))].sort().map(c => `${Object.keys(BoundaryKind).find(n => BoundaryKind[n] === Number(c))}:${k(avg(rs, r => r.kinds[c] ?? 0))}`).join('  '));
    line('stretch km', SEG_BINS.map(String), r => r.seg);
    line('…flagged', SEG_BINS.map(String), r => r.segFlag);
    line('closing cm/yr', RATE_BINS.map(String), r => r.rate);
    line('incoming age', AGE_BINS.map(String), r => r.incomingAge);
    line('lower Mkm²', AREA_BINS.map(String), r => r.lowerArea);
    line('upper Mkm²', AREA_BINS.map(String), r => r.upperArea);
    line('trench age', TRENCH_AGE.map(String), r => r.trenchAge);
}
console.log(`seed ${seed} len ${len} cells ${numCells} edge ${edgeKm.toFixed(0)} km ${JSON.stringify(overrides)}  wall ${((performance.now() - t0) / 1000).toFixed(0)} s`);
table(rows, 'all frames');
for (const stage of [...new Set(rows.map(r => r.stage))]) table(rows.filter(r => r.stage === stage), stage);
const span = len - from;
console.log(`\nflagged per Myr over the whole history (k km/Myr ÷ turnover): ${CAUSES.map((c, i) => `${c} ${(bornKm[i] / len).toFixed(0)}`).join('  ')} km/Myr`);
const ps = [...pairs.values()], lives = ps.map(p => p.last - p.first + every), total = ps.reduce((s, p) => s + p.kmMyr, 0);
const q = (a, x) => { const s = [...a].sort((u, v) => u - v); return s[Math.floor(x * (s.length - 1))]; };
const wtd = lim => 100 * ps.filter(p => p.last - p.first + every >= lim).reduce((s, p) => s + p.kmMyr, 0) / total;
console.log(`pairs (upper>lower) ${ps.length}; lifetime Myr p50 ${q(lives, 0.5)} p90 ${q(lives, 0.9)} max ${Math.max(...lives)}; km·Myr in pairs lasting ≥20/50/100/200 Myr: ${[20, 50, 100, 200].map(l => wtd(l).toFixed(0)).join(' / ')} %  (window ${span} Myr)`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ seed, len, overrides, rows, bornKm: Object.fromEntries(CAUSES.map((c, i) => [c, bornKm[i]])) }));
