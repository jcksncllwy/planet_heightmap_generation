// lane crustlevel (2026-11-10, measuring): the continental crust's share over a page history, where its area goes (by
// ledger stage) and how much of it stands drowned below the poured sea, with the sea's level against the datum.
// One page world (moment-frame.mjs pageWorld: the lab's cycle scene at the page's cont), the crust ledger on (books only:
// path-neutral), and per frame (every --every Myr) the history's own surface through terrain/land-mask.js (the pour).
// Usage: node v2/tools/crustlevel-measure.mjs --seed 777 [--cont 29] [--every 10] [--until 1200] [--set key=value …] [--out f.jsonl]
//        [--vol] [--sheet]
// --sheet (lane crustmass S0, implies --vol): the balance sheet. Every reservoir of rock every 100 Myr (rockParts: continental
// crust, the relief it carries, the fill on it, island-arc crust, sediment on ocean crust, rock in transit; with the
// continents' volume and area), each ledger stage's change in rock against the flows it booked and its residual (the rock
// book, lib/volume-books.mjs rockClosure), and the subducting trench's length measured directly from the boundaries every
// step against its record (world.budget.trenchKmMyr, step/margin-isles.js): every per-km flux is rate × that length.
import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { simulate } from '../js/tectonics/simulate.js';
import { pageWorld, MESH_SEED } from './lib/moment-frame.mjs';
import { FRAME_FIELDS } from '../js/terrain/terrain-pool.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { landMask } from '../js/terrain/land-mask.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { BoundaryKind } from '../js/tectonics/model/world.js';
import { rockParts, crustVolume, crustTally } from '../js/tectonics/step/crust-ledger.js';
import { prismHeldKm3 } from '../js/tectonics/step/prism-accretion.js';
import { rockClosure } from './lib/volume-books.mjs';
import { columnModel, crustThicknessKm } from '../js/tectonics/measure.js';
import { heightsOf } from '../js/tectonics/step/heights.js';
setDelaunator(Delaunator);
const argv = process.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEED = +arg('--seed'), CONT = +arg('--cont', 29), EVERY = +arg('--every', 10), OUT = arg('--out', null), SIM = +arg('--sim', 40000), UNTIL = +arg('--until', 1200);
const sets = argv.flatMap((a, i) => a === '--set' ? [argv[i + 1]] : []);
const sim = buildSimMesh(SIM, MESH_SEED), n = sim.numCells, cfg = terrainConfig({});
const { scene, world } = pageWorld({ seed: SEED, cont: CONT, sim: SIM });
world.config.crustLedger = true;
const SHEET = argv.includes('--sheet');
if (argv.includes('--vol') || SHEET) world.config.crustLedgerVolume = true;   // (slow: every cell's column each stage)
for (const s of sets) {
    const [k, v] = s.split('=');
    if (!(k in world.config)) throw new Error(`unknown config key ${k}`);
    world.config[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v;
}
const rows = [], ledger = [], reservoirs = [];
const trench = trenchGauge();
const t0 = performance.now();
simulate(world, {
    untilMyr: UNTIL, snapshotEveryMyr: 10, keepFrames: false,
    drive: w => {
        scene.drive(w);
        const t = Math.round(w.time);
        if (SHEET) {
            trench.sample(w);
            if (t % 100 === 0 && !reservoirs.some(x => x.t === t)) reservoirs.push({ t, ...reservoirsNow(w) });
        }
        if (t % 100 === 0 && !ledger.some(x => x.t === t))
            ledger.push({ t, stages: Object.fromEntries(Object.entries(w.ledger?.stages ?? {}).map(([k, e]) => [k, +(e.land / n).toFixed(5)])),
                underthrust: +((w.budget?.underthrustCells ?? 0) / n).toFixed(5) });
    },
    onFrame: f => {
        if (Math.round(f.time) % EVERY) return;
        const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]]));
        fr.plates = f.plates.map(p => p && { quat: p.quat }); fr.time = f.time;
        rows.push(measure(fr));
    },
});
const secs = (performance.now() - t0) / 1000;
if (SHEET && !reservoirs.some(x => x.t === Math.round(world.time))) reservoirs.push({ t: Math.round(world.time), ...reservoirsNow(world) });

// Every reservoir of rock now (Gkm³; lane crustmass §1: R1–R4 continental crust as formed plus its root, R2's relief,
// S1/S2/S4 the fill on land, R5 island-arc crust, S3/S4 sediment on ocean crust, S6 rock in transit), with the continents'
// volume as the ledger measures it (crustVolume: crust + relief + fill on continental cells) and the areas (Mkm²).
function reservoirsNow(w) {
    const a = sim.cellAreaKm2, P = rockParts(w), g = v => +(v * a / 1e9).toFixed(4), T = crustTally(w);
    return { crust: g(P.crust), relief: g(P.relief), fill: g(P.fill), arc: g(P.arc), oceanSed: g(P.oceanSed), transit: g(P.transit),
        prism: g(prismHeldKm3(w) / a), contVol: g(crustVolume(w)), contMkm2: +(T.land * a / 1e6).toFixed(3), arcMkm2: +(T.arc * a / 1e6).toFixed(3), ...highGround(w) };
}

// High ground (lane crustmass S3: what the lower crust's flow is for — plateaus stop rising at ~4–5 km and widen; Tibet ~5 km,
// the Altiplano ~4 km): continental area whose column stands above 3, 4 and 5 km (Mkm²; the isostatic column with its relief
// and swells, the mantle's swell aside), the highest such column (km), and the crust's 99th-percentile thickness (km).
function highGround(w) {
    const H = heightsOf(w.config), C = columnModel(H), a = sim.cellAreaKm2, th = [];
    let h3 = 0, h4 = 0, h5 = 0, top = 0;
    for (let c = 0; c < n; c++) {
        const p = w.plates[w.owner[c]]; if (!p) continue;
        const k = w.ownerCell[c], cr = p.crust, t = cr.type[k];
        if (t !== CrustType.CONTINENT && t !== CrustType.CRATON) continue;
        const s = C.ref[t] + C.slope[t] * cr.rootKm[k] + Math.max(0, cr.upliftKm[k]) + cr.baseKm[k];
        if (s > 3) h3++; if (s > 4) h4++; if (s > 5) h5++; if (s > top) top = s;
        th.push(crustThicknessKm(H, t, cr.rootKm[k], cr.upliftKm[k], cr.baseKm[k]));
    }
    th.sort((x, y) => x - y);
    const M = v => +(v * a / 1e6).toFixed(3);
    return { hi3Mkm2: M(h3), hi4Mkm2: M(h4), hi5Mkm2: M(h5), topKm: +top.toFixed(2), crustP99Km: +(th[Math.floor(0.99 * (th.length - 1))] ?? 0).toFixed(1) };
}

// The subducting trench's length, measured from the boundaries themselves (lane crustmass S0; glitnir's note: volcano-run
// read ~10,500 km from budget.trenchKmMyr against Earth's ~44,000–55,000 km of convergent margin — volcano/report.md).
// Per step (time-weighted over the step that follows the drive): every neighbouring pair of world cells across a plate
// boundary where one is SUBDUCTING and the other OVERRIDING, by what the upper plate is there (continent or craton:
// Andean; arc or ocean: intra-oceanic), and the pairs where both sides converge with no slab yet (CONVERGING) or collide.
// A pair's length is calibrated on the mesh itself: the pairs straddling the equator, which is 2πR long, so the measure
// is in km on any mesh size (scale invariance), not in cell hops.
function trenchGauge() {
    const { adjOffset, adjList, xyz, numCells: N } = sim;
    let eq = 0;
    for (let c = 0; c < N; c++) if (xyz[3 * c + 2] > 0) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (xyz[3 * adjList[k] + 2] <= 0) eq++;
    const kmPerPair = 2 * Math.PI * 6371 / eq, acc = { andean: 0, oceanic: 0, converging: 0, collision: 0, myr: 0 };
    let last = null;
    return {
        kmPerPair,
        sample(w) {
            const t = w.time, dt = last === null ? 0 : t - last;
            last = t;
            if (!(dt > 0)) { this.pending = null; }
            if (this.pending) { for (const k in this.pending) acc[k] += this.pending[k] * dt; acc.myr += dt; }
            const { owner, ownerCell, plates, boundaryKind: K } = w, s = { andean: 0, oceanic: 0, converging: 0, collision: 0 };
            for (let c = 0; c < N; c++) {
                const kc = K[c];
                if (kc !== BoundaryKind.SUBDUCTING && kc !== BoundaryKind.CONVERGING && kc !== BoundaryKind.COLLISION) continue;
                for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                    const nb = adjList[k];
                    if (owner[nb] === owner[c] || owner[nb] < 0) continue;
                    const kn = K[nb];
                    if (kc === BoundaryKind.SUBDUCTING && kn === BoundaryKind.OVERRIDING) {
                        const ty = plates[owner[nb]].crust.type[ownerCell[nb]];
                        if (ty === CrustType.CONTINENT || ty === CrustType.CRATON) s.andean++; else s.oceanic++;
                    } else if (kc === BoundaryKind.CONVERGING && kn === BoundaryKind.CONVERGING && c < nb) s.converging++;
                    else if (kc === BoundaryKind.COLLISION && kn === BoundaryKind.COLLISION && c < nb) s.collision++;
                }
            }
            for (const k in s) s[k] *= kmPerPair;
            this.pending = s;
        },
        // (mean km over the run; the record is world.budget.trenchKmMyr ÷ the run's Myr)
        result(w, myr) {
            const m = Math.max(1e-9, acc.myr), r = k => Math.round(acc[k] / m);
            const record = Math.round((w.budget?.trenchKmMyr ?? 0) / myr), direct = r('andean') + r('oceanic');
            return { kmPerPair: +kmPerPair.toFixed(1), andeanKm: r('andean'), oceanicKm: r('oceanic'), subductingKm: direct,
                convergingKm: r('converging'), collisionKm: r('collision'), recordKm: record, recordOverDirect: +(record / Math.max(1, direct)).toFixed(3),
                marginRecordKm: Math.round((w.budget?.marginTrenchKmMyr ?? 0) / myr) };
        },
    };
}

// Bands of continental crust's surface against the poured sea (km): Earth's drowned margin, 41 − 29 ≈ 12 points of the
// surface, stands at about −0.1 to −2 km (ocean-report §3); its shelf (0 to −0.2 km) is 6–9 % of the planet (Harris et
// al. 2014 ≈ 6.3 %).
function measure(f) {
    const out = {}, m = landMask(f, sim, cfg, out), P = out.pour, z = out.groundKm, L = m.sl.seaKm, t = f.time;
    let cont = 0, arc = 0, land = 0, landLow = 0, cDry = 0, cShelf = 0, cMargin = 0, cDeep = 0, shelfAll = 0, ageSum = 0, ageN = 0, contThin = 0;
    for (let w = 0; w < n; w++) {
        const o = f.owner[w], ty = f.type[w], d = z[w] - L, sea = P.sea[w];
        if (!sea && d > 0) { land++; if (d < 0.4) landLow++; }
        if (sea && d > -0.2) shelfAll++;
        if (o >= 0 && ty === CrustType.ARC) arc++;
        if (o >= 0 && (ty === CrustType.CONTINENT || ty === CrustType.CRATON)) {
            cont++;
            if (!sea) cDry++; else if (d > -0.1) cShelf++; else if (d > -2) cMargin++; else cDeep++;
            if ((f.riftThin?.[w] ?? 0) > 0) contThin++;
        }
        if ((o < 0 || ty === CrustType.OCEAN) && o >= 0 && f.formedAt[w] >= 0) { ageSum += Math.max(0, t - f.formedAt[w]); ageN++; }
    }
    const p = v => +(100 * v / n).toFixed(2);
    return { t: Math.round(t), L: +(1000 * L).toFixed(1), cont: p(cont), arc: p(arc), land: p(land), landLow400: +(100 * landLow / Math.max(1, land)).toFixed(1),
        contDry: p(cDry), contShelf: p(cShelf), contMargin: p(cMargin), contDeep: p(cDeep), shelfAll: p(shelfAll), contThinned: p(contThin),
        floorAge: +(ageSum / Math.max(1, ageN)).toFixed(1) };
}
// The balance sheet at the end: each stage's area (Mkm²) and volume (Gkm³; with --vol) of continental crust, and every
// numeric book in world.budget (the rock book's km³ and the collisions' cells), as they stand.
function endBooks() {
    const a = sim.cellAreaKm2, st = {};
    const sheet = SHEET ? { reservoirs, closure: rockClosure(world.ledger?.stages ?? {}, a), trench: trench.result(world, UNTIL) } : {};
    for (const [k, e] of Object.entries(world.ledger?.stages ?? {})) st[k] = { landMkm2: +(e.land * a / 1e6).toFixed(3), arcMkm2: +(e.arc * a / 1e6).toFixed(3), ...(e.vol !== undefined ? { volGkm3: +(e.vol * a / 1e9).toFixed(4) } : {}) };
    const budget = Object.fromEntries(Object.entries(world.budget ?? {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, +v.toPrecision(6)]));
    return { books: st, budget, cellKm2: a, ...sheet };
}
const fmt = r => `${String(r.t).padStart(5)} L ${String(r.L).padStart(7)} cont ${r.cont} arc ${r.arc} land ${r.land} low<400 ${r.landLow400}% | cont dry ${r.contDry} shelf ${r.contShelf} margin ${r.contMargin} deep ${r.contDeep} | shelfAll ${r.shelfAll} thinned ${r.contThinned} age ${r.floorAge}`;
for (const r of rows) console.log(fmt(r));
for (const l of ledger) console.log('LEDGER', l.t, JSON.stringify(l.stages), 'underthrust', l.underthrust);
const jsonl = [...rows.map(r => JSON.stringify({ seed: SEED, cont: CONT, sets, ...r })), JSON.stringify({ seed: SEED, cont: CONT, sets, ledger, secs, breakups: world.riftBreakupLog ?? [], ...endBooks() })];
if (OUT) fs.writeFileSync(OUT, jsonl.join('\n') + '\n');
for (const l of jsonl) console.log('CL_JSON ' + l);   // (a remote run's stdout is what comes back: grep '^CL_JSON ' | cut -c9-)
const bk = world.riftBreakupLog ?? [], med = (a) => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN; };
console.log(`BREAKUPS ${bk.length}: line h0 p50 ${med(bk.map(b => b[0]))} km, at breakup ${med(bk.map(b => b[1]))} km, opening p50 ${med(bk.map(b => b[2]))} km`);
if (SHEET) printSheet(endBooks());
function printSheet(e) {
    const f = (v, d = 3) => (v >= 0 ? ' ' : '') + v.toFixed(d);
    console.log('SHEET reservoirs (Gkm³; areas Mkm²):   t   crust  relief    fill     arc oceanSed transit   prism | contVol contMkm2 arcMkm2');
    for (const r of e.reservoirs) console.log(`SHEET res ${String(r.t).padStart(5)} ${[r.crust, r.relief, r.fill, r.arc, r.oceanSed, r.transit, r.prism ?? 0].map(v => f(v).padStart(7)).join(' ')} | ${f(r.contVol).padStart(7)} ${f(r.contMkm2, 2).padStart(8)} ${f(r.arcMkm2, 2).padStart(7)} | hi3/4/5 ${r.hi3Mkm2?.toFixed(2)}/${r.hi4Mkm2?.toFixed(2)}/${r.hi5Mkm2?.toFixed(2)} top ${r.topKm} p99 ${r.crustP99Km}`);
    console.log('SHEET stage (Gkm³ over the run): Δrock booked residual (gross, residual/gross) Δcont | flows');
    for (const [k, u] of Object.entries(e.closure)) {
        const cont = Object.entries(e.books).filter(([s]) => (s === k) || (k === 'rivers+fans' && (s === 'rivers' || s === 'fans'))).reduce((a, [, b]) => a + (b.volGkm3 ?? 0), 0);
        console.log(`SHEET stage ${k.padEnd(16)} ${f(u.delta)} ${f(u.booked)} ${f(u.residual)} (${u.gross.toFixed(3)}, ${(100 * u.residual / Math.max(1e-9, u.gross)).toFixed(2)} %) ${f(cont)} | ${Object.entries(u.flows).map(([fk, v]) => `${fk} ${f(v)}`).join(', ')}`);
    }
    const t = e.trench;
    console.log(`SHEET trench km (mean): subducting ${t.subductingKm} (Andean ${t.andeanKm}, intra-oceanic ${t.oceanicKm}), converging ${t.convergingKm}, collision ${t.collisionKm} | record ${t.recordKm} (×${t.recordOverDirect} of direct; continental-margin record ${t.marginRecordKm}) | pair ${t.kmPerPair} km | Earth ~44,000–55,000`);
}
const c0 = rows.find(r => r.t === 0)?.cont, cEnd = rows.at(-1)?.cont;
console.log(`SUMMARY seed ${SEED} cont ${CONT} ${sets.join(' ')}: crust ${c0} → ${cEnd} % (×${(cEnd / c0).toFixed(3)}), ${secs.toFixed(0)} s`);
