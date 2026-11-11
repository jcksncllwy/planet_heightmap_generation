// Headless checks for the volcanic record (tectonics/volcanism.js; lane volcano). Records only: reading a frame changes
// nothing in it. The rift melt law behaves as its sources say. A moment's eruptions are seeded, and an Earth-like budget
// gives back Earth's rates by VEI. Then what a history's record says, against Earth's ranges (report lines).
// Usage: node v2/tools/check-volcano.mjs

import { createHash } from 'node:crypto';
import { check, report, section, finish, labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { volcStep, riftMeltKm, recentEruptions, momentVolc, EARTH_VEI_PER_YR, EARTH_WEIGHT, RIDGE_MELT_KM, ARC_GROSS } from '../js/tectonics/volcanism.js';
import { preparePlan } from '../js/terrain/synthesize.js';
import { calderaAt } from '../js/terrain/volcanoes.js';
import { FRAME_FIELDS } from '../js/terrain/terrain-pool.js';

const SEED = 12345, SIM = 20000, UNTIL = 400;
const mesh = labMesh(SIM), H = terrainConfig({});
const scene = TERRAIN_SCENES.find(s => s.id === 'cycle');
const print = f => {
    const h = createHash('md5');
    for (const [k, v] of Object.entries(f)) if (ArrayBuffer.isView(v)) { h.update(k); h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); }
    h.update(JSON.stringify([f.time, f.budget, f.hotspots, f.events.length]));
    return h.digest('hex');
};

section('the rift melt law (McKenzie & Bickle 1988; White & McKenzie 1989)');
check('no stretch, no melt', riftMeltKm(1, 0) === 0 && riftMeltKm(1, 200) === 0);
check('normal mantle barely melts below β ≈ 2 (magma-poor rifts: Iberia)', riftMeltKm(1.8, 0) === 0 && riftMeltKm(2.5, 0) > 0, `β 1.8: ${riftMeltKm(1.8, 0).toFixed(2)} km, β 2.5: ${riftMeltKm(2.5, 0).toFixed(2)} km`);
check('hot mantle melts at small β (Afar, volcanic margins)', riftMeltKm(2, 150) > 1 && riftMeltKm(1.5, 150) > 0, `β 1.5: ${riftMeltKm(1.5, 150).toFixed(2)} km, β 2: ${riftMeltKm(2, 150).toFixed(2)} km at +150 K`);
check('a ridge on normal mantle makes oceanic crust', Math.abs(riftMeltKm(1e6, 0) - RIDGE_MELT_KM) < 0.05, `${riftMeltKm(1e6, 0).toFixed(2)} km`);
check('Iceland-hot mantle makes Iceland-thick crust (20–25 km)', riftMeltKm(1e6, 175) > 18 && riftMeltKm(1e6, 175) < 27, `${riftMeltKm(1e6, 175).toFixed(1)} km`);
let mono = true;
for (const dK of [0, 50, 100, 200]) for (let b = 1.1; b < 10; b *= 1.2) if (riftMeltKm(b * 1.2, dK) < riftMeltKm(b, dK) || riftMeltKm(b, dK + 50) < riftMeltKm(b, dK)) mono = false;
check('more stretch or hotter mantle never melts less', mono);

section('a moment\'s eruptions (Papale 2018; Newhall et al. 2018; Rougier et al. 2018)');
// (an Earth-like budget: arc fronts erupting Earth's explosive weight, some of them thick-crust silicic centres)
const earthLike = { time: 1000, sites: [] };
for (let i = 0; i < 400; i++) earthLike.sites.push({ w: i, kind: i % 4 ? 'arc' : 'andean', km3Myr: EARTH_WEIGHT * 1e6 * 6 / 400, veiMax: i % 10 === 0 ? 8 : 7, silicic: true });
const kyr = 200, ev = recentEruptions(earthLike, 7, kyr);
const count = v => ev.filter(e => e.vei === v).length;
for (const v of [4, 5, 6, 7]) {
    const want = EARTH_VEI_PER_YR[v] * kyr * 1e3;
    check(`VEI ${v}: an Earth-like budget gives Earth's rate (within 4σ)`, Math.abs(count(v) - want) < 4 * Math.sqrt(want) + 1, `${count(v)} in ${kyr} kyr, Earth ${want.toFixed(0)}`);
}
check('the same moment draws the same eruptions', JSON.stringify(recentEruptions(earthLike, 7, 50)) === JSON.stringify(recentEruptions(earthLike, 7, 50)));
const basaltic = { time: 1000, sites: earthLike.sites.map(s => ({ ...s, veiMax: 5, silicic: false })) };
check('no silicic centres, no VEI ≥ 6', recentEruptions(basaltic, 7, kyr).every(e => e.vei <= 5));

section(`a history's record (cycle, seed ${SEED}, ${SIM} cells, 0–${UNTIL} Myr)`);
const world = scene.build(mesh, SEED, { continentalFraction: 0.3 });
world.config.heights = H;
const rows = [];
let prev = null, pure = true, ms = 0;
simulate(world, { untilMyr: UNTIL, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
    const copy = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, ArrayBuffer.isView(v) ? v.slice() : v && typeof v === 'object' ? structuredClone(v) : v]));
    if (prev) {
        const before = print(copy), t0 = performance.now();
        rows.push(volcStep(prev, copy, mesh, H, { seed: SEED }));
        ms += performance.now() - t0;
        if (print(copy) !== before) pure = false;
    }
    prev = copy;
} });
check('reading a frame changes nothing in it (records only)', pure, `${rows.length} frames`);
check('arc magma is the arc book × ARC_GROSS (the melt behind the crust)', rows.every(v => Math.abs(v.magma.arc - v.magma.arcNet * ARC_GROSS) <= 1e-9 * (1 + v.magma.arc)));
const mean = g => rows.reduce((a, v) => a + g(v), 0) / rows.length;
const m = k => mean(v => v.magma[k]) / 1e6;
report('ridge magma', m('ridge'), { earth: [18, 24], unit: 'km³/yr', source: 'Crisp 1984; White et al. 1992 (7 km of melt × spreading)' });
report('arc crust (the history\'s arc book: net growth)', m('arcNet'), { earth: [1.1, 1.65], unit: 'km³/yr', source: 'Reymer & Schubert 1984' });
report('arc magma (the book × ARC_GROSS: the melt)', m('arc'), { earth: [2.5, 8], unit: 'km³/yr', source: 'Crisp 1984 (~20 % of 26–34); Jagoutz & Kelemen 2015 (⅔ founders)' });
report('plume-tail magma', m('plume'), { earth: [1, 3], unit: 'km³/yr', source: 'Crisp 1984 (~5 % of 26–34)' });
const lips = rows.flatMap(v => v.lips);
report('flood basalts per 100 Myr', lips.length / (UNTIL / 100), { earth: [3, 6], source: 'Ernst 2014; Bryan & Ernst 2008 (big LIPs ~1 per 20–30 Myr)' });
report('rift frames with melt', rows.filter(v => v.magma.rift > 0).length / rows.length, { source: 'share; Earth: rifts on hot mantle erupt (Kenya ~10 km³/km/Myr, Guth 2016), on cold mantle not (Iberia)' });
report('volcStep cost a frame', ms / rows.length, { unit: 'ms', source: 'records pass, off the history\'s path' });

section(`drawn at a finished moment (rift volcanoes and calderas; ${UNTIL} Myr)`);
{
    const edgeKm = 15, t0 = performance.now(), V = preparePlan(prev, mesh, H, SEED, edgeKm).V, planMs = performance.now() - t0;
    const V0 = preparePlan(prev, mesh, { ...H, riftConeShare: 0 }, SEED, edgeKm).V, C = V.calderas, mv = momentVolc(prev, mesh, H, SEED);
    const silicic = new Set(mv.sites.filter(s => s.veiMax >= C.minVei).map(s => s.w)), melting = mv.sites.filter(s => s.kind === 'rift').length;
    // (a caldera's home is the world cell of a centre whose VEI cap reaches the classes drawn)
    const homeOf = k => { let best = -1, bc = -2; for (let w = 0; w < mesh.numCells; w++) { const c = mesh.xyz[3 * w] * C.pos[3 * k] + mesh.xyz[3 * w + 1] * C.pos[3 * k + 1] + mesh.xyz[3 * w + 2] * C.pos[3 * k + 2]; if (c > bc) { bc = c; best = w; } } return best; };
    let atSilicic = 0, shaped = 0;
    for (let k = 0; k < C.count; k++) {
        const w = homeOf(k);
        let near = silicic.has(w);
        for (let j = mesh.adjOffset[w]; !near && j < mesh.adjOffset[w + 1]; j++) near = silicic.has(mesh.adjList[j]);     // (its 30-km jitter)
        if (near) atSilicic++;
        const [x, y, z] = [C.pos[3 * k], C.pos[3 * k + 1], C.pos[3 * k + 2]], e = [C.axis[3 * k], C.axis[3 * k + 1], C.axis[3 * k + 2]];
        const out = C.radius[k] * Math.sqrt(C.aspect[k]) * 1.1 / 6371, p = [x + e[0] * out, y + e[1] * out, z + e[2] * out], l = Math.hypot(...p);
        const inn = C.radius[k] * Math.sqrt(C.aspect[k]) * 0.6 / 6371, f = [x + e[0] * inn, y + e[1] * inn, z + e[2] * inn], fl = Math.hypot(...f);   // (the floor beside a dome)
        if (calderaAt(V, w, f[0] / fl, f[1] / fl, f[2] / fl) < 0 && calderaAt(V, w, p[0] / l, p[1] / l, p[2] / l) >= 0) shaped++;
    }
    check('calderas only at silicic centres', atSilicic === C.count, `${atSilicic} of ${C.count} (VEI ≥ ${C.minVei} drawn at a ${edgeKm}-km mesh)`);
    check('a caldera\'s floor below its surroundings, its rim not', shaped >= 0.9 * C.count, `${shaped} of ${C.count}`);
    // (the workers plan from a slim frame, terrain-pool.js FRAME_FIELDS: it must carry everything the drawing reads)
    const slim = Object.fromEntries(FRAME_FIELDS.map(k => [k, prev[k]]));
    slim.plates = prev.plates.map(p => p && { quat: p.quat });
    let Vs = null, err = '';
    try { Vs = preparePlan(slim, mesh, H, SEED, edgeKm).V; } catch (e) { err = e.message; }
    check('the workers\' slim frame draws the same volcanoes and calderas', Vs && Vs.count === V.count && Vs.calderas.count === C.count,
        Vs ? `${Vs.count} vs ${V.count} volcanoes, ${Vs.calderas.count} vs ${C.count} calderas` : err);
    check('no melting rift, no rift volcano', melting > 0 || V.count === V0.count, `${melting} melting rift cells, ${V.count - V0.count} rift volcanoes`);
    report('calderas drawn at the moment', C.count, { source: `VEI ≥ ${C.minVei} in the last 2 Myr; Earth ~480 Quaternary calderas of all sizes (Geyer & Martí 2008)` });
    report('rift volcanoes drawn at the moment', V.count - V0.count, { source: `${melting} melting rift cells` });
    report('plan time with rift volcanoes and calderas', planMs, { unit: 'ms', source: 'preparePlan at the moment (the finish\'s plan)' });
}
finish('volcano');
