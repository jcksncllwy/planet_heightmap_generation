// Old ocean floor and the trenches that should consume it, over a page history (lane oldfloor, 2026-11-22: phase 1, measure
// only). Diagnostics: nothing here touches the history. Written against stable APIs only (pageWorld, simulate, the frame's
// owner/type/boundary/formedAt/flags, world.convergence), so the same file runs on any commit from the trench merge on — the
// tool for bisecting a change in trench length over measured frames.
//
// Per 10 Myr frame:
//   - TRENCH LENGTH, two measures side by side, each as km of plate boundary (a cell row's length, edgeKm·√3/2 = edgeKm ÷ 1.15):
//       overriding: every OVERRIDING cell (trace-trench.mjs, the trench lane's "total");
//       front:      an OVERRIDING cell with a SUBDUCTING neighbour of another plate (trace-contarea.mjs) — the definition used
//                   from here on: a stretch of boundary where a slab is going down under an upper plate.
//     The front split by the upper plate's crust where it meets the slab (ocean / arc / continent incl. craton) and by what goes
//     down (ocean / not ocean); flagged (CrustFlag.TRENCH) km; CONVERGING km (forced contact: closing with no slab).
//   - CONSUMPTION: at each front cell, the closing rate × the cell row → km²/yr of floor going down, binned by the incoming
//     floor's age; the same at CONVERGING contacts (crust lost with no slab).
//   - THE FLOOR'S AGE: ocean-crust area, mean age, share older than 180 Myr, the age histogram, production (floor younger than
//     10 Myr ÷ 10 Myr).
//   - WHERE OLD FLOOR (>180 Myr) SITS (and, apart: how much is on the passive background plate, how much is dated before the
//     history began — the start's ocean, or a scrap restamped so by tidy-plates.js giveToBackground), each cell in the first
//     class that holds:
//       closedSea:  in a body of ocean crust cut off from the world ocean (connected ocean cells across plates, not the largest);
//       toTrench:   its plate has a front (it is on a plate that subducts somewhere) and the cell lies within 1500 km (same
//                   plate) of that plate's SUBDUCTING edge;
//       stalled:    its nearest plate edge (same plate) is CONVERGING, or SUBDUCTING but closing < 1 cm/yr;
//       passive:    within 600 km of its own plate's continent (a trenchless margin);
//       interior:   the rest; split further by whether its plate subducts anywhere (onSubductingPlate) or not.
//     And per class: the share of old floor whose plate has no front at all (a plate that is not going down anywhere).
//   node v2/tools/trace-oldfloor.mjs --seed 716130 [--myr 1100] [--cont 41] [--sim 40000] [--every 10] [--set k=v …] [--out f.json]
// Prints `OLDFLOOR_JSON {…}` (the whole series) on stdout, a line per frame on stderr.
import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { simulate } from '../js/tectonics/simulate.js';
import { CrustType, CrustFlag } from '../js/tectonics/model/crust.js';
import { BoundaryKind } from '../js/tectonics/model/world.js';
const { founderUrge } = await import('../js/tectonics/step/subduction-init.js').catch(() => ({}));

setDelaunator(Delaunator);
// (the history runs on the GPU from gpucells on: Dawn as navigator.gpu, before the history cache's key wants its fingerprint;
// older commits have neither, and the import fails quietly)
if (!globalThis.navigator?.gpu) await import('./gpu-harness/use-dawn.mjs').catch(() => null);
const MF = await import('./lib/moment-frame.mjs');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const seed = +arg('seed', 716130), MYR = +arg('myr', 1100), SIM = +arg('sim', 40000), EVERY = +arg('every', 10);
const cont = +arg('cont', MF.DEFAULT_CONT ?? 41), OUT = arg('out', null);
const sets = argv.flatMap((a, i) => a === '--set' ? [argv[i + 1]] : []);

const { scene, world } = MF.pageWorld({ seed, cont, sim: SIM });
for (const s of sets) {
    const [k, v] = s.split('=');
    if (!(k in world.config)) throw new Error(`unknown config key ${k}`);
    world.config[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v;
}
const { numCells: n, adjOffset, adjList, edgeKm, cellAreaKm2 } = world.mesh;
const rowKm = edgeKm * Math.sqrt(3) / 2;
const B = BoundaryKind, CONV = B.CONVERGING ?? -1;
const isLand = t => t === CrustType.CONTINENT || t === CrustType.CRATON;
const AGE_BINS = [10, 30, 60, 100, 140, 180, 250, Infinity];
const ageBin = a => { let i = 0; while (a >= AGE_BINS[i]) i++; return i; };
const r1 = x => Math.round(x), r3 = x => +x.toFixed(3);

/** Multi-source BFS through cells of the same owner; returns hop distance (−1 unreached) and the source each cell reached. */
function bfsSamePlate(f, isSource) {
    const d = new Int32Array(n).fill(-1), src = new Int32Array(n).fill(-1), q = new Int32Array(n);
    let h = 0, t = 0;
    for (let w = 0; w < n; w++) if (f.owner[w] >= 0 && isSource(w)) { d[w] = 0; src[w] = w; q[t++] = w; }
    while (h < t) {
        const w = q[h++];
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
            const u = adjList[k];
            if (d[u] >= 0 || f.owner[u] !== f.owner[w]) continue;
            d[u] = d[w] + 1; src[u] = src[w]; q[t++] = u;
        }
    }
    return { d, src };
}

function sample(f) {
    const conv = world.convergence;
    const fr = { t: Math.round(f.time), trench: { overriding: 0, front: 0, flagged: 0, converging: 0, byUpper: { ocean: 0, arc: 0, cont: 0 }, lowerNotOcean: 0, oo: 0 },
        consumed: { front: Array(AGE_BINS.length).fill(0), converging: Array(AGE_BINS.length).fill(0) },
        floor: {}, old: { closedSea: 0, toTrench: 0, stalled: 0, passive: 0, interior: 0, interiorNoFront: 0, noFront: 0, background: 0, preHistory: 0 }, convRate: [0, 0, 0, 0, 0], convQ: { oo: [0, 0, 0], ol: [0, 0, 0] }, convWhy: { young: 0, land: 0, slab0: 0, slab50: 0, slab100: 0, closing0: 0 } };
    // trench length
    const plateFront = new Map();
    for (let w = 0; w < n; w++) {
        const b = f.boundary[w];
        if (b === CONV) {
            fr.trench.converging += rowKm;
            const rate = Math.max(0, conv[w]);
            fr.convRate[rate < 1 ? 0 : rate < 2 ? 1 : rate < 4 ? 2 : rate < 8 ? 3 : 4] += rowKm / 2;   // (contact km by closing rate, cm/yr: <1, 1–2, 2–4, 4–8, ≥8)
            // the founder law's verdict on this contact now (subduction-init.js establishes: the older ocean goes down; its weight is
            // the step in √age against ocean, all of it against land; the squeeze from the closing rate, no slab load): km with
            // q held below 0.75 / 0.75–1 / founding, ocean on ocean (oo) or ocean against land or arc (ol)
            if (founderUrge && f.type[w] === CrustType.OCEAN) {
                let u = -1; for (let k = adjOffset[w]; k < adjOffset[w + 1] && u < 0; k++) if (f.owner[adjList[k]] >= 0 && f.owner[adjList[k]] !== f.owner[w]) u = adjList[k];
                if (u >= 0) {
                    const c = world.config, ageW = f.time - f.formedAt[w], oo = f.type[u] === CrustType.OCEAN, ageU = f.time - f.formedAt[u];
                    if (!oo || ageW >= ageU) {           // (this side is the one that would go down)
                        const step = oo ? Math.max(0, Math.sqrt(Math.max(0, ageW)) - Math.sqrt(Math.max(0, ageU))) : 0, weight = oo ? step * step : ageW;
                        const q = ageW < c.oceanNeutralAgeMyr ? 0 : Math.sqrt(weight / c.subductionInitAgeMyr) + rate / c.founderSqueezeCmYr;
                        fr.convQ[oo ? 'oo' : 'ol'][q < 0.75 ? 0 : q < 1 ? 1 : 2] += rowKm;
                    }
                }
            }
            // why it is not yet a trench: the floor on both sides younger than oceanNeutralAgeMyr; no ocean on this side; else the
            // contact tally on this cell's raster (slabKm: 0 / under 50 / 50 km on) and contacts not closing now
            {
                let u = -1; for (let k = adjOffset[w]; k < adjOffset[w + 1] && u < 0; k++) if (f.owner[adjList[k]] >= 0 && f.owner[adjList[k]] !== f.owner[w]) u = adjList[k];
                const h = rowKm / 2, P = world.plates[f.owner[w]], sk = P?.crust.slabKm?.[world.ownerCell[w]] ?? 0;
                const oldest = Math.max(f.type[w] === CrustType.OCEAN ? f.time - f.formedAt[w] : -1, u >= 0 && f.type[u] === CrustType.OCEAN ? f.time - f.formedAt[u] : -1);
                if (oldest < 0) fr.convWhy.land += h;
                else if (oldest < world.config.oceanNeutralAgeMyr) fr.convWhy.young += h;
                else if (!(conv[w] > 0)) fr.convWhy.closing0 += h;
                else fr.convWhy[sk <= 0 ? 'slab0' : sk < 50 ? 'slab50' : 'slab100'] += h;
            }
            if (f.type[w] === CrustType.OCEAN) fr.consumed.converging[ageBin(f.time - f.formedAt[w])] += rowKm * rate * 1e-5 / 2;   // (both sides carry the flag: half each)
        }
        if (b !== B.OVERRIDING) continue;
        fr.trench.overriding += rowKm;
        let lo = -1;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) { const u = adjList[k]; if (f.owner[u] >= 0 && f.owner[u] !== f.owner[w] && f.boundary[u] === B.SUBDUCTING) { lo = u; break; } }
        if (lo < 0) continue;
        fr.trench.front += rowKm;
        if (f.flags[w] & CrustFlag.TRENCH) fr.trench.flagged += rowKm;
        const up = f.type[w];
        fr.trench.byUpper[up === CrustType.OCEAN ? 'ocean' : up === CrustType.ARC ? 'arc' : 'cont'] += rowKm;
        if (f.type[lo] !== CrustType.OCEAN) fr.trench.lowerNotOcean += rowKm;
        else if (up === CrustType.OCEAN) fr.trench.oo += rowKm;
        if (f.type[lo] === CrustType.OCEAN) fr.consumed.front[ageBin(f.time - f.formedAt[lo])] += rowKm * Math.max(0, conv[w]) * 1e-5;
        plateFront.set(f.owner[lo], (plateFront.get(f.owner[lo]) ?? 0) + rowKm);
    }
    // the floor's age
    let area = 0, ageSum = 0, old = 0, young = 0;
    const hist = Array(AGE_BINS.length).fill(0);
    for (let w = 0; w < n; w++) {
        if (f.owner[w] < 0 || f.type[w] !== CrustType.OCEAN) continue;
        const a = f.time - f.formedAt[w];
        area++; ageSum += a; hist[ageBin(a)]++;
        if (a > 180) old++;
        if (a < 10) young++;
    }
    fr.floor = { areaMkm2: r1(area * cellAreaKm2 / 1e6), meanAge: +(ageSum / Math.max(1, area)).toFixed(1), over180: r3(old / Math.max(1, area)),
        hist: hist.map(c => r3(c / Math.max(1, area))), productionKm2Yr: r3(young * cellAreaKm2 / 10e6) };
    // where the old floor sits
    if (old) {
        // ocean bodies across plates: the world ocean is the largest
        const comp = new Int32Array(n).fill(-1), sizes = [];
        for (let s = 0; s < n; s++) {
            if (comp[s] >= 0 || f.owner[s] < 0 || f.type[s] !== CrustType.OCEAN) continue;
            const id = sizes.length, q = [s]; comp[s] = id;
            for (let i = 0; i < q.length; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const u = adjList[k]; if (comp[u] < 0 && f.owner[u] >= 0 && f.type[u] === CrustType.OCEAN) { comp[u] = id; q.push(u); } }
            sizes.push(q.length);
        }
        const world0 = sizes.indexOf(Math.max(...sizes));
        const toSub = bfsSamePlate(f, w => f.boundary[w] === B.SUBDUCTING);
        const toEdge = bfsSamePlate(f, w => f.boundary[w] !== B.NONE);
        const toLand = bfsSamePlate(f, w => isLand(f.type[w]));
        const hop = km => Math.ceil(km / edgeKm);
        for (let w = 0; w < n; w++) {
            if (f.owner[w] < 0 || f.type[w] !== CrustType.OCEAN || f.time - f.formedAt[w] <= 180) continue;
            const hasFront = plateFront.has(f.owner[w]);
            if (world.plates[f.owner[w]]?.isBackground) fr.old.background++;
            if (f.formedAt[w] < 0) fr.old.preHistory++;         // (dated before the history began: the start's ocean, or a scrap restamped so)
            if (!hasFront) fr.old.noFront++;
            const e = toEdge.src[w], eb = e >= 0 ? f.boundary[e] : -1;
            if (comp[w] !== world0) fr.old.closedSea++;
            else if (hasFront && toSub.d[w] >= 0 && toSub.d[w] <= hop(1500)) fr.old.toTrench++;
            else if (eb === CONV || (eb === B.SUBDUCTING && conv[e] < 1)) fr.old.stalled++;
            else if (toLand.d[w] >= 0 && toLand.d[w] <= hop(600)) fr.old.passive++;
            else { fr.old.interior++; if (!hasFront) fr.old.interiorNoFront++; }
        }
        for (const k of Object.keys(fr.old)) fr.old[k] = r3(fr.old[k] / old);
    }
    for (const k of ['overriding', 'front', 'flagged', 'converging', 'lowerNotOcean', 'oo']) fr.trench[k] = r1(fr.trench[k]);
    for (const k of Object.keys(fr.trench.byUpper)) fr.trench.byUpper[k] = r1(fr.trench.byUpper[k]);
    fr.convRate = fr.convRate.map(r1); fr.convQ.oo = fr.convQ.oo.map(r1); for (const k in fr.convWhy) fr.convWhy[k] = r1(fr.convWhy[k]); fr.convQ.ol = fr.convQ.ol.map(r1); fr.consumed.front = fr.consumed.front.map(r3); fr.consumed.converging = fr.consumed.converging.map(r3);
    fr.plates = world.plates.filter(p => p.alive).length;
    return fr;
}

const frames = [], t0 = performance.now();
await simulate(world, {
    untilMyr: MYR, snapshotEveryMyr: 10, keepFrames: false,
    drive: w => scene.drive(w),
    onFrame: f => {
        if (Math.round(f.time) % EVERY) return;
        const fr = sample(f); frames.push(fr);
        process.stderr.write(`t ${fr.t}  front ${fr.trench.front}  overriding ${fr.trench.overriding}  conv ${fr.trench.converging}  mean age ${fr.floor.meanAge}  >180 ${fr.floor.over180}  (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`);
    },
});
const out = { seed, cont, sim: SIM, sets, n, edgeKm, ageBins: AGE_BINS, seconds: +((performance.now() - t0) / 1000).toFixed(1), frames };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`OLDFLOOR_JSON ${JSON.stringify(out)}`);
