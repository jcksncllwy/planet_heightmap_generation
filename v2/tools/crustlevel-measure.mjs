// lane crustlevel (2026-11-10, measuring): the continental crust's share over a page history, where its area goes (by
// ledger stage) and how much of it stands drowned below the poured sea, with the sea's level against the datum.
// One page world (moment-frame.mjs pageWorld: the lab's cycle scene at the page's cont), the crust ledger on (books only:
// path-neutral), and per frame (every --every Myr) the history's own surface through terrain/land-mask.js (the pour).
// Usage: node v2/tools/crustlevel-measure.mjs --seed 777 [--cont 29] [--every 10] [--until 1200] [--set key=value …] [--out f.jsonl]
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
setDelaunator(Delaunator);
const argv = process.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEED = +arg('--seed'), CONT = +arg('--cont', 29), EVERY = +arg('--every', 10), OUT = arg('--out', null), SIM = +arg('--sim', 40000), UNTIL = +arg('--until', 1200);
const sets = argv.flatMap((a, i) => a === '--set' ? [argv[i + 1]] : []);
const sim = buildSimMesh(SIM, MESH_SEED), n = sim.numCells, cfg = terrainConfig({});
const { scene, world } = pageWorld({ seed: SEED, cont: CONT, sim: SIM });
world.config.crustLedger = true;
for (const s of sets) {
    const [k, v] = s.split('=');
    if (!(k in world.config)) throw new Error(`unknown config key ${k}`);
    world.config[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v;
}
const rows = [], ledger = [];
const t0 = performance.now();
simulate(world, {
    untilMyr: UNTIL, snapshotEveryMyr: 10, keepFrames: false,
    drive: w => {
        scene.drive(w);
        const t = Math.round(w.time);
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
const fmt = r => `${String(r.t).padStart(5)} L ${String(r.L).padStart(7)} cont ${r.cont} arc ${r.arc} land ${r.land} low<400 ${r.landLow400}% | cont dry ${r.contDry} shelf ${r.contShelf} margin ${r.contMargin} deep ${r.contDeep} | shelfAll ${r.shelfAll} thinned ${r.contThinned} age ${r.floorAge}`;
for (const r of rows) console.log(fmt(r));
for (const l of ledger) console.log('LEDGER', l.t, JSON.stringify(l.stages), 'underthrust', l.underthrust);
if (OUT) fs.writeFileSync(OUT, [...rows.map(r => JSON.stringify({ seed: SEED, cont: CONT, sets, ...r })), JSON.stringify({ seed: SEED, cont: CONT, sets, ledger, secs })].join('\n') + '\n');
const c0 = rows.find(r => r.t === 0)?.cont, cEnd = rows.at(-1)?.cont;
console.log(`SUMMARY seed ${SEED} cont ${CONT} ${sets.join(' ')}: crust ${c0} → ${cEnd} % (×${(cEnd / c0).toFixed(3)}), ${secs.toFixed(0)} s`);
