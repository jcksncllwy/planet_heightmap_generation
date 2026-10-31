// Headless checks for the civ layer's food model (plans/CIV_PLAN.md §11: crops.js's harvests and soil, substrate.js's
// foods, fish, staples and ways of life), after upstream's v2/tools/check-farming.mjs (raguilar011095/
// planet_heightmap_generation — © Robert Aguilar, GPL v3). One moment of the page's history, finished at two details and
// read as the civ page reads it (civ-page.js civWorldFromFinish):
//   · the same at both details — physical units throughout, so the land's soil, harvests, foods, fish, staples and ways
//     of life come out alike (land-weighted, against a tolerance);
//   · each mechanism where its physics puts it — water brought feeds more where the rain feeds less; river silt richer than
//     leached ground beside it; the sea's fish only on coasts, richer on cold ones; no paddy without a warm month; herders
//     only where they may roam;
//   · its cost on the page: the crops from the months and the substrate, per land cell (reported: wall-clock).
// Usage: node v2/tools/check-civ-food.mjs [--cells 40000,160000 --seed 13 --cont 30 --time 500]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, report, section, finish } from './lib/check-kit.mjs';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { civWorldFromFinish } from '../js/civ/civ-page.js';
import { civSubstrate, cellLife, stormCV, Staple, STAPLES, WAYS, Way, Parent, SoilMod } from '../js/civ/substrate.js';
import { cropsFromMonths, HARVEST_CLASSES } from '../js/civ/crops.js';
import { unpackT } from '../js/civ/months.js';
import { FOOD } from '../js/civ/food-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DETAILS = arg('--cells', '40000,160000').split(',').map(Number), SEED = Number(arg('--seed', 13)), CONT = Number(arg('--cont', 30)), TIME = Number(arg('--time', 500));

const frame = await momentFrame(ROOT, { seed: SEED, cont: CONT, sim: 40000, time: TIME });
const simMesh = buildSimMesh(40000, MESH_SEED), pool = await TerrainPool.create(simMesh);

/** One detail: the civ world, its substrate, each land cell's life, and the timings. */
async function at(cells) {
    const out = await finishPlanet({ frame, simMesh, seed: SEED, cells, pool, climateOptions: {}, civ: true });
    let t = performance.now();
    const w = civWorldFromFinish(out, { months: true });
    const n = w.mesh.numCells, xyz = w.mesh.xyz;
    // (the crops again, timed alone: civWorldFromFinish's own)
    t = performance.now();
    cropsFromMonths(w.months, n, c => Math.asin(xyz[3 * c + 2]));
    const tCrops = performance.now() - t;
    t = performance.now();
    const sub = civSubstrate(w);
    const tSub = performance.now() - t;
    const land = c => !w.ocean[c] && !w.lake[c] && w.tAnnual[c] === w.tAnnual[c];
    const way = new Uint8Array(n), staple = new Uint8Array(n);
    let nLand = 0;
    for (let c = 0; c < n; c++) if (land(c)) { nLand++; [way[c], staple[c]] = cellLife(sub, c, stormCV(w.pAnnual[c])); }
    return { cells, w, sub, n, land, way, staple, nLand, tCrops, tSub };
}
const D = [];
for (const cells of DETAILS) D.push(await at(cells));
pool.terminate();

/** The land-weighted mean of a field (all land cells: each the same area on its mesh). */
const meanOf = (d, f, where = () => true) => { let s = 0, k = 0; for (let c = 0; c < d.n; c++) if (d.land(c) && where(c)) { s += f(c); k++; } return k ? s / k : NaN; };
const shareOf = (d, where) => meanOf(d, c => (where(c) ? 1 : 0));
const [A, B] = D;
const near = (a, b, rel, abs = 0) => Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));

section(`the same at two details (${A.cells} and ${B.cells} cells finished; ${A.n} and ${B.n} read)`);
for (const [name, f, rel, abs, where] of [
    ['soil fertility', d => c => d.sub.soil[c], 0.05, 0],
    ['harvests a year by rain', d => c => d.sub.harvests[c], 0.08, 0.02],
    ['harvests a year watered', d => c => d.sub.harvestsW[c], 0.08, 0.02],
    ['farmland (good harvests\' food)', d => c => d.sub.farmV[c], 0.1, 0.02],
    ['farmers a km² by rain', d => c => d.sub.farmDry[c], 0.1, 1],
    ['herds a km²', d => c => d.sub.food.herds[c], 0.1, 0.02],
    ['foragers a km² (away from wetland: main\'s deltas, below)', d => c => d.sub.forager[c], 0.1, 0.005, d => c => !(d.sub.wetland[c] > 0)],
    ['the land\'s own forage (npp)', d => c => d.sub.npp[c], 0.05, 0],
]) {
    const a = meanOf(A, f(A), where?.(A)), b = meanOf(B, f(B), where?.(B));
    check(`${name}: the land's mean alike`, near(a, b, rel, abs), `${a.toFixed(3)} vs ${b.toFixed(3)}`);
}
// (main's wetland, not this lane's: a delta's every cell is all marsh, so a coarse mesh's deltas are wider — foragers
// a km² follow it; reported)
report('wetland share of the land, coarser ÷ finer (main\'s deltas)', meanOf(A, c => A.sub.wetland[c]) / meanOf(B, c => B.sub.wetland[c]), { digits: 2 });
report('foragers a km², all the land, coarser ÷ finer', meanOf(A, c => A.sub.forager[c]) / meanOf(B, c => B.sub.forager[c]), { digits: 2 });
// (the sea's fish: the people they feed, all told — a coarse mesh's coast is shorter and its cells wider than the
// day's paddle, so the total is what should hold; and per km of coast, reported)
const fishPeople = d => { let p = 0; for (let c = 0; c < d.n; c++) if (d.land(c)) p += d.sub.fish[c] * d.sub.cellKm2; return p; };
const coastKm = d => { let k = 0; for (let c = 0; c < d.n; c++) if (d.land(c) && d.sub.coastal[c]) k += d.sub.edgeKm; return k; };
{
    const a = fishPeople(A), b = fishPeople(B);
    check('the sea\'s fish: the people they feed alike', near(a, b, 0.3), `${(a / 1e6).toFixed(2)} M vs ${(b / 1e6).toFixed(2)} M`);
    report('the sea\'s fish a km of coast, coarser ÷ finer', (a / coastKm(A)) / (b / coastKm(B)), { digits: 2 });
    const shelf = d => { let k = 0; for (let c = 0; c < d.n; c++) if (d.w.ocean[c] && d.w.z[c] > -FOOD.shelfKm) k++; return k * d.sub.cellKm2 / 1e6; };
    report('the shelf, M km², coarser ÷ finer', shelf(A) / shelf(B), { digits: 2 });
}
for (let k = 0; k < STAPLES.length; k++) {
    const a = shareOf(A, c => A.staple[c] === k), b = shareOf(B, c => B.staple[c] === k);
    if (a > 0.005 || b > 0.005) check(`staple ${STAPLES[k]}: its share of the land alike`, near(a, b, 0.2, 0.02), `${(100 * a).toFixed(1)} % vs ${(100 * b).toFixed(1)} %`);
}
for (let k = 0; k < WAYS.length; k++) {
    const a = shareOf(A, c => A.way[c] === k), b = shareOf(B, c => B.way[c] === k);
    check(`way ${WAYS[k]}: its share of the land alike`, near(a, b, 0.2, 0.02), `${(100 * a).toFixed(1)} % vs ${(100 * b).toFixed(1)} %`);
}

section('each mechanism where its physics puts it (the finer detail)');
{
    const { sub, n, land, w } = B;
    // water brought: never less than by rain, and more where the rain is short
    let less = 0, dryMore = 0, dry = 0, worst = 0;
    for (let c = 0; c < n; c++) {
        if (!land(c)) continue;
        // (each rotation by its food: crops.js picks the best by its class's weight)
        const wt = k => (k > 0 ? FOOD.crops[HARVEST_CLASSES[k - 1]].weight : 0);
        // (each stored a byte on a √ scale: ~0.02 a step near one harvest — crops.js encHarvests)
        const gap = sub.harvests[c] * wt(sub.rotCls[c] & 15) - sub.harvestsW[c] * wt(sub.rotCls[c] >> 4);
        if (gap > 0.03) less++;
        worst = Math.max(worst, gap);
        if (sub.harvests[c] < 0.2 && sub.irrig[c] > 0) { dry++; if (sub.farmWet[c] > sub.farmDry[c]) dryMore++; }
    }
    check('the best rotation watered feeds ≥ by rain, every cell (to the bytes\' step)', less === 0, `${less} cells less; the most ${worst.toFixed(3)}`);
    check('a dry cell watered by canals feeds more than by rain', dry === 0 || dryMore / dry > 0.95, `${dryMore}/${dry}`);
    // the soil: river silt richer than the bed beside it where leached; black earth richer than the same parent plain
    let silt = 0, siltRich = 0;
    for (let c = 0; c < n; c++) if (land(c) && (sub.soilKind[c] & 15) === Parent.SILT && sub.soilKind[c] >> 4 === SoilMod.LEACHED) { silt++; if (sub.soilSilt[c] > sub.soilBed[c]) siltRich++; }
    check('leached ground: river silt richer than the bed (floods renew it)', silt === 0 || siltRich === silt, `${siltRich}/${silt}`);
    const black = meanOf(B, c => sub.soilBed[c], c => sub.soilKind[c] >> 4 === SoilMod.BLACK), leached = meanOf(B, c => sub.soilBed[c], c => sub.soilKind[c] >> 4 === SoilMod.LEACHED);
    check('black earth richer than leached red earth', !(black === black && leached === leached) || black > leached, `${black.toFixed(2)} vs ${leached.toFixed(2)}`);
    // the sea's fish: only on coasts
    let inland = 0;
    for (let c = 0; c < n; c++) if (land(c) && sub.fish[c] > 0.01 && !sub.coastal[c]) {
        let byCoast = false;
        for (let k = w.mesh.adjOffset[c]; k < w.mesh.adjOffset[c + 1] && !byCoast; k++) byCoast = !!sub.coastal[w.mesh.adjList[k]] || !!w.ocean[w.mesh.adjList[k]];
        if (!byCoast) inland++;
    }
    report('the sea\'s fish more than a cell inland (cells: the paddle\'s reach over a mesh cell)', inland, { digits: 0 });
    // no paddy where no month is warm enough to flower
    let cold = 0;
    if (w.months) for (let c = 0; c < n; c++) {
        if (!land(c) || !(sub.food.flooded[c] > 0)) continue;
        let tmax = -Infinity;
        for (let m = 0; m < 12; m++) tmax = Math.max(tmax, unpackT(w.months.T[12 * c + m]));
        if (tmax < FOOD.crops.paddy.kinds[0].flower[0] - 0.5) cold++;
    }
    check('no paddy where no month is warm enough for rice to flower', cold === 0, `${cold} cells`);
    // herders only where they may roam: the rain fickle, or no crop
    let herdBad = 0;
    for (let c = 0; c < n; c++) if (land(c) && B.way[c] === Way.herding && stormCV(w.pAnnual[c]) < 0.33) {
        let best = 0;
        for (const f of ['winterCereal', 'summerCereal', 'roots', 'tree', 'flooded']) best = Math.max(best, sub.food[f][c]);
        if (best >= FOOD.stapleMin) herdBad++;
    }
    check('herders only where they may roam', herdBad === 0, `${herdBad} cells`);
    check('paddy only staple where it grows', (() => { for (let c = 0; c < n; c++) if (land(c) && B.staple[c] === Staple.flooded && !(sub.food.flooded[c] > 0)) return false; return true; })());
}

section('cost on the page (wall-clock: the machine\'s load counts)');
for (const d of D) {
    report(`${d.n} cells: the crops from the months, µs a land cell`, 1000 * d.tCrops / d.nLand, { digits: 1 });
    report(`${d.n} cells: the substrate, ms`, d.tSub, { digits: 0 });
}
finish('civ food');
