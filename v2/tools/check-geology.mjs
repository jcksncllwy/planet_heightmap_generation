// Headless checks for the geological record (tectonics/step/geology.js; ported from World Orogen's check-geology.mjs,
// raguilar011095, GPL v3, G1 only, and rewritten for a cover fed by the rivers' books).
// Records only: a history is the same with the record or without. The cover answers to the rivers' mass: no more laid than
// their books say they left. Then what the record says, against what the crust around it says.
// Usage: node v2/tools/check-geology.mjs

import { createHash } from 'node:crypto';
import { check, report, section, finish, labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { packFrame, packedBytes } from '../js/tectonics/frame-pack.js';
import { CrustType, OrogenyType } from '../js/tectonics/model/crust.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { momentFrame, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { finishPlanet } from '../js/finish/finish.js';
import { ROCK_COUNT, ROCK_FAMILY } from '../js/geology/rocks.js';
import { GEO_FRAME_FIELDS, GeoFlag, decodeCoverKm, decodeExhumKm, decodeArcMyr, decodeFacies } from '../js/tectonics/model/geology.js';

const SEEDS = [12345, 777], SIM = 20000, UNTIL = 400;
const mesh = labMesh(SIM), n = mesh.numCells, scene = TERRAIN_SCENES.find(s => s.id === 'cycle');
const cellArea = 4 * Math.PI * 6371 * 6371 / n;
const median = a => { const s = Float64Array.from(a).sort(); return s.length ? s[s.length >> 1] : NaN; };
const fieldBytes = f => (f.bits?.byteLength ?? 0) + (f.values?.byteLength ?? 0) + (f.steps?.byteLength ?? 0) + (f.far?.byteLength ?? 0);

/** The Evolution page's history, record kept or not: each frame's fingerprint of everything but the record, the record's
 *  share of the packed frames, and the first and last frames. */
function run(seed, records) {
    const world = scene.build(mesh, seed);
    world.config.heights = terrainConfig({});
    world.config.geology = { ...world.config.geology, records };
    const prints = [];
    let bytes = 0, geoBytes = 0, first = null, last = null;
    const t0 = process.cpuUsage();
    simulate(world, { untilMyr: UNTIL, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
        const h = createHash('md5');
        for (const [k, v] of Object.entries(f)) if (ArrayBuffer.isView(v) && !GEO_FRAME_FIELDS.includes(k)) { h.update(k); h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); }
        h.update(JSON.stringify([f.budget, f.events.map(e => [e.time, e.kind])]));
        prints.push(h.digest('hex'));
        const copy = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, ArrayBuffer.isView(v) ? v.slice() : v]));
        const { packed } = packFrame(f);
        bytes += packedBytes(packed);
        for (const k of GEO_FRAME_FIELDS) geoBytes += fieldBytes(packed.fields[k]);
        first ??= copy; last = copy;
    } });
    const cpu = process.cpuUsage(t0);
    return { prints, first, last, ms: (cpu.user + cpu.system) / 1000, geoShare: geoBytes / bytes, geoGrowth: geoBytes / (bytes - geoBytes) };
}

for (const seed of SEEDS) {
    section(`records only, seed ${seed}`);
    const off = run(seed, false), on = run(seed, true), { first, last } = on;
    check('every frame of the history is the same, record or not (the tectonics never read it)', on.prints.length === off.prints.length && on.prints.every((p, i) => p === off.prints[i]),
        `${on.prints.length} frames, ${on.prints.filter((p, i) => p !== off.prints[i]).length} differ`);
    check('…and the record is kept only when asked for', GEO_FRAME_FIELDS.some(k => last[k].some(v => v !== 0)) && GEO_FRAME_FIELDS.every(k => !off.last[k].some(v => v !== 0)) && off.last.geoBook === null, 'records on: written · off: all zero');
    check('a packed frame grows by at most a sixth', on.geoGrowth <= 1 / 6, `+${(100 * on.geoGrowth).toFixed(1)} %`);
    report('the record\'s time, history at 20K', 100 * (on.ms / off.ms - 1), { unit: ' %', digits: 1, detail: `CPU ${(off.ms / 1000).toFixed(1)} s without, ${(on.ms / 1000).toFixed(1)} s with, framing and hashing included` });

    section(`the cover against the rivers' books, seed ${seed}`);
    const book = last.geoBook, sink = (last.budget.basinFillKm3 ?? 0) + (last.budget.seaFillKm3 ?? 0);
    let stock = 0, fill = 0, short = 0;
    for (let w = 0; w < n; w++) if (last.owner[w] >= 0) {
        const km = decodeCoverKm(last.coverKm[w]), f = last.basinFillKm[w] + last.seaFillKm[w];
        stock += km * cellArea; fill += f * cellArea;
        // (packed to a byte, and the rivers may have laid more since the record last looked)
        if (km + 0.3 < Math.min(f, 25) - 1.5) short++;
    }
    check('the cover holds the fill the heights stand on', short === 0, `${short} cells short`);
    check('no more cover laid than the rivers left: laid ≤ basin + sea fill', book.laidKm3 <= sink * (1 + 1e-6), `${(book.laidKm3 / 1e6).toFixed(2)} of ${(sink / 1e6).toFixed(2)} Mkm³`);
    check('something was laid (the books feed the cover)', book.laidKm3 > 0, `${(book.laidKm3 / 1e6).toFixed(2)} Mkm³`);
    report('laid against the books', sink ? book.laidKm3 / sink : 0, { detail: 'see the README: the gap measured' });
    report('cover now, Mkm³', stock / 1e6, { detail: `seeded ${(book.seededKm3 / 1e6).toFixed(1)}, laid ${(book.laidKm3 / 1e6).toFixed(1)}, fill standing ${(fill / 1e6).toFixed(1)}, fill worn ${(book.wornFillKm3 / 1e6).toFixed(1)}` });

    section(`what the record says, seed ${seed}`);
    const land = w => last.owner[w] >= 0 && (last.type[w] === CrustType.CONTINENT || last.type[w] === CrustType.CRATON);
    const landCells = []; for (let w = 0; w < n; w++) if (land(w)) landCells.push(w);
    const flagged = bit => landCells.filter(w => last.geoFlags[w] & bit).length;
    const live = w => last.oroType[w] !== OrogenyType.NONE && last.time - last.oroLast[w] <= 10;
    const belts = landCells.filter(w => last.oroType[w] !== OrogenyType.NONE && !live(w) && last.oroType[w] !== OrogenyType.RIFT);
    const coverLow = first.owner.reduce((s, o, w) => s + (o >= 0 && first.type[w] !== CrustType.OCEAN && decodeCoverKm(first.coverKm[w]) > 0.2 ? 1 : 0), 0);
    check('the start world has its past: its old crust worn, part of it under cover', coverLow > 0 && Math.max(...first.exhumKm) > 0, `${coverLow} cells under cover`);
    const arcCells = landCells.filter(w => last.arcMyr[w] > 0), arcShare = arcCells.length / landCells.length;
    report('land that has stood in a live subduction belt', 100 * arcShare, { unit: ' %', digits: 1, detail: `median ${median(arcCells.map(w => decodeArcMyr(last.arcMyr[w])))} Myr` });
    report('quiet belts worn, median km', median(belts.map(w => decodeExhumKm(last.exhumKm[w]))), { earth: [4, 30], source: 'Barrovian grades bared in old orogens (upstream research §3): slate 4–8 km, gneiss 16–24 km', detail: `${belts.length} cells` });
    report('flagged land, WAS_ARC / FORELAND / BELT_FRONT / RIFT_BASIN / OPHIOLITE / SLAB_CHANGE', flagged(GeoFlag.WAS_ARC), { digits: 0, detail: `${flagged(GeoFlag.WAS_ARC)} / ${flagged(GeoFlag.FORELAND)} / ${flagged(GeoFlag.BELT_FRONT)} / ${flagged(GeoFlag.RIFT_BASIN)} / ${flagged(GeoFlag.OPHIOLITE)} / ${flagged(GeoFlag.SLAB_CHANGE)} of ${landCells.length}` });
    // (one moment's share is what the width and the belts' length set; the flags are kept for good, so they only grow: a rate)
    report('land just before a live belt at one moment, %', 100 * book.frontShare / book.frontTicks, { unit: ' %', digits: 1, earth: [2, 6], source: 'derived, recalled inputs: foredeeps 100–300 km wide (DeCelles & Giles 1996) × ~30,000 km of active belts over ~150 Mkm² of land', detail: 'by distance alone; the mean over the history' });
    report('land entering a belt\'s front, % of land per 100 Myr', 100 * flagged(GeoFlag.BELT_FRONT) / landCells.length / (UNTIL / 100), { digits: 1, detail: 'an upper bound as land is reflagged, so no Earth range: land that has been before a belt, not land that sank' });
    report('land sunk into a foreland basin, % of land per 100 Myr', 100 * flagged(GeoFlag.FORELAND) / landCells.length / (UNTIL / 100), { digits: 1, detail: 'the heights\' own basins, which the rock reads' });
    const fac = { carb: 0, salt: 0, coal: 0, organic: 0 }, tot = { carb: 0, salt: 0, coal: 0, organic: 0 };
    let cov = 0;
    for (const w of landCells) { if (!last.coverKm[w]) continue; cov++; decodeFacies(last.facies[w], fac); for (const k in tot) tot[k] += fac[k]; }
    report('land under cover', 100 * cov / landCells.length, { unit: ' %', digits: 1, detail: `make-up: carbonate ${(tot.carb / cov).toFixed(2)}, salt ${(tot.salt / cov).toFixed(2)}, coal ${(tot.coal / cov).toFixed(2)}, organic ${(tot.organic / cov).toFixed(2)}` });
}

// ── the finish: rocks and k_rock on a finished moment, at two details (LITHO_CELLS: the gate's 640K against 2.5M) ──
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DETAILS = (process.env.LITHO_CELLS ?? '160000,640000').split(',').map(Number), MOMENTS = [[12345, 300], [777, 300], [777, 950]], FSIM = 40000;
const simMesh = buildSimMesh(FSIM, MESH_SEED), FAMILIES = ['loose', 'sedimentary', 'volcanic', 'plutonic', 'metamorphic'];
for (const [seed, time] of MOMENTS) {
    section(`the finish's rock, seed ${seed} at ${time} Myr`);
    const frame = await momentFrame(ROOT, { seed, cont: DEFAULT_CONT, sim: FSIM, time }), shares = [];
    for (const cells of DETAILS) {
        const pool = await TerrainPool.create(simMesh);
        const fin = await finishPlanet({ frame, simMesh, seed, cells, pool, closePool: true }), { rock, kRock, coarse, shares: sh } = fin.litho;
        let sum = 0, land = 0, lo = Infinity, hi = 0, grainy = 0;
        for (let c = 0; c < rock.length; c++) if (rock[c]) { sum += kRock[c]; land++; lo = Math.min(lo, kRock[c]); hi = Math.max(hi, kRock[c]); grainy += coarse[c]; }
        check(`k_rock's mean over the land is 1 and every value a number (${cells})`, Math.abs(sum / land - 1) < 1e-3 && lo > 0 && hi < Infinity, `mean ${(sum / land).toFixed(4)}, ${lo.toFixed(2)}…${hi.toFixed(2)}, spread ${(hi / lo).toFixed(1)}×`);
        const fam = Object.fromEntries(FAMILIES.map(f => [f, 0]));
        for (let k = 1; k < ROCK_COUNT; k++) fam[ROCK_FAMILY[k]] += sh[k];
        shares.push(fam);
        const total = Object.values(fin.ms).reduce((a, b) => a + b, 0);
        report(`the rock stage's share of the finish (${cells})`, 100 * fin.ms.lithology / total, { unit: ' %', digits: 1, detail: `${(fin.ms.lithology / 1000).toFixed(1)} s of ${(total / 1000).toFixed(1)} s` });
        report(`land's sedimentary rock and loose sediment (${cells})`, fam.sedimentary + fam.loose, { earth: [0.5, 0.75], source: 'GLiM today 70 % (Hartmann & Moosdorf 2012); the low end is an estimate for a low stand of a cycle, unsourced. Young sediment does not exist yet here', detail: FAMILIES.map(f => `${f} ${(100 * fam[f]).toFixed(0)}`).join(' · ') });
        report(`land breaking down coarse (${cells})`, grainy / land, { detail: 'sand and gravel; the rest mud or solution' });
    }
    if (shares.length > 1) report('family shares, largest shift between the details', Math.max(...FAMILIES.map(f => Math.abs(shares[0][f] - shares.at(-1)[f]))), { earth: [0, 0.05], source: 'scale invariance: the same world at two details' });
}

finish('geology');
