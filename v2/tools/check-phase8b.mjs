// Headless acceptance checks for Phase 8b (rivers carve the tectonic surface: terrain/carve.js).
// Hard checks: the routing (every land cell drains, downhill, as a tree), the carving's invariants (it only lowers land,
// leaves the sea floor and coast alone, starts from 8a's surface exactly, lowers the median), what rivers do where (graded
// lowlands, gorges into plateaus and rising belts, swells steering them), small rivers riding with the crust against the
// same terrain read on the fixed world grid, and resolution, worker and speed properties. Reported against Earth: the
// network's exponent, how much is carved, the hypsometry after carving, range heights, river persistence, basalt benches.
// Usage: node v2/tools/check-phase8b.mjs

import { check, report, section, finish, labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { OrogenyType, BeltSide } from '../js/tectonics/model/crust.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { synthesizeTerrain, hypsometry } from '../js/terrain/synthesize.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { TERRAIN } from '../js/terrain/terrain-config.js';
import { kindType, kindSide } from '../js/terrain/records.js';
import { buildAnchor } from '../js/terrain/anchor.js';
import { locate } from '../js/core/mesh-locate.js';
import { quatToMat3 } from '../js/core/rotation.js';

const SEED = 12345;
const mesh = labMesh();
const median = a => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
const quantile = (a, p) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

function run(id) {
    const scene = TERRAIN_SCENES.find(s => s.id === id), world = scene.build(mesh, SEED);
    const { frames } = simulate(world, { untilMyr: scene.maxMyr, drive: w => scene.drive(w), snapshotEveryMyr: scene.maxMyr > 200 ? 50 : 10 });
    return { world, frame: frames.at(-1), frames };
}
function carved(frame, cells = 640000) {
    const tm = terrainMesh(cells), started = performance.now();
    const T = synthesizeTerrain(frame, mesh, tm, { seed: SEED, parts: true, carve: true });
    return { ...T, tm, seconds: (performance.now() - started) / 1000 };
}

const history = run('history'), T = carved(history.frame);
const n = T.tm.numCells, land = t => T.tectonicKm[t] > 0, channelKm2 = 5000;          // (what the checks call a river)

// ── the river network ──
section('the river network');
{
    // every land cell reaches the sea by its receivers, without a loop
    let stranded = 0, longest = 0;
    for (let t = 0; t < n; t++) {
        if (!land(t)) continue;
        let c = t, steps = 0;
        while (c >= 0 && steps <= n) { c = T.receivers[c]; steps++; }
        if (c >= 0) stranded++;
        longest = Math.max(longest, steps);
    }
    check('every land cell drains to the sea', stranded === 0, `${stranded} land cells without a way out; the longest river ${longest} cells`);
    // rivers run downhill: along the rivers whose valley fills their cell (there the cell stands at the river bed), no
    // carved cell stands below the next one down (a pit of the tectonic surface itself — a basin a lake would fill — aside)
    const fullKm2 = 1e4 * (Math.sqrt(4 * Math.PI * 6371 ** 2 / n) / TERRAIN.carveValleyKm) ** 2;
    let channels = 0, uphill = 0, basins = 0;
    for (let t = 0; t < n; t++) {
        if (!land(t) || T.drainage[t] < fullKm2) continue;
        channels++;
        const r = T.receivers[t];
        if (r < 0 || T.heightKm[t] >= T.heightKm[r] - 1e-4) continue;
        if (T.heightKm[t] >= T.tectonicKm[t] - 1e-6) basins++; else uphill++;
    }
    check('rivers run downhill (basins aside)', channels > 1000 && uphill === 0, `${channels} cells of rivers draining over ${fullKm2.toFixed(0)} km²; ${uphill} carved below the cell they drain into; ${basins} (${(100 * basins / channels).toFixed(1)} %) in basins of the tectonic surface`);
    // dendritic: drainage areas follow a power law, P(A ≥ a) ∝ a^−β with β ≈ 0.43 on Earth (Rodríguez-Iturbe & Rinaldo)
    const areas = [];
    for (let t = 0; t < n; t++) if (land(t)) areas.push(T.drainage[t]);
    const share = a => areas.filter(v => v >= a).length / areas.length, lo = channelKm2, hi = 100 * channelKm2;
    const beta = -Math.log(share(hi) / share(lo)) / Math.log(hi / lo);
    // (a wide band: β ≈ 0.43 holds for fluvial networks almost everywhere — outside 0.3–0.65 the network is broken)
    check('the network branches like a tree: drainage areas follow a power law', beta >= 0.3 && beta <= 0.65, `P(A ≥ a) ∝ a^−${beta.toFixed(2)} between ${lo.toFixed(0)} and ${hi.toFixed(0)} km²`);
    report('drainage-area exponent β', beta, { earth: [0.40, 0.46], source: 'holds through the cycle: ~0.45 for river networks (Rodríguez-Iturbe et al. 1992, abstract checked); 0.43 ± 0.03 (Rigon et al. 1996, recalled, unconfirmed)' });
}

// ── what the carving does to the land ──
section('carving');
{
    let raised = 0, seaChanged = 0, cut = 0, landCells = 0;
    for (let t = 0; t < n; t++) {
        if (T.heightKm[t] > T.tectonicKm[t] + 1e-6) raised++;
        if (!land(t)) { if (T.heightKm[t] !== T.tectonicKm[t]) seaChanged++; continue; }
        landCells++;
        if (T.tectonicKm[t] - T.heightKm[t] > 0.1) cut++;
    }
    check('rivers only ever lower the ground; the sea floor is untouched', raised === 0 && seaChanged === 0, `${raised} cells raised, ${seaChanged} sea cells changed`);
    const plain = synthesizeTerrain(history.frame, mesh, T.tm, { seed: SEED });
    check('the surface the rivers carve is exactly 8a’s tectonic surface', plain.heightKm.every((v, i) => Object.is(v, T.tectonicKm[i])), '640K cells, built with and without the carving');
    report('land cut more than 100 m by the rivers', 100 * cut / landCells, { unit: ' %', digits: 1, source: 'no Earth figure' });
    const before = hypsometry(T.tectonicKm), after = hypsometry(T.heightKm);
    check('the carving lowers the land’s median and raises none of it into the uplands', after.landKm[2] < before.landKm[2] && after.below400 >= before.below400,
        `median ${before.landKm[2].toFixed(2)} → ${after.landKm[2].toFixed(2)} km; below 400 m ${(100 * before.below400).toFixed(0)} % → ${(100 * after.below400).toFixed(0)} % of land`);
    report('land below 400 m after carving', 100 * after.below400, { earth: [45, 55], unit: ' %', digits: 0, source: '~54 % below 500 m, ETOPO hypsometry — today only: an icehouse lowstand with the continents dispersed; no history of hypsometry found (sea level ~+170 m in the Late Cretaceous, Müller et al. 2008, would drown much of it)',
        detail: `${(100 * before.below400).toFixed(0)} % before carving` });
    check('land stays land: the coastline is not moved', Math.abs(after.landShare - before.landShare) < 0.002, `${(100 * before.landShare).toFixed(2)} % → ${(100 * after.landShare).toFixed(2)} % of the planet`);
    // big rivers are graded to lowlands
    const big = []; for (let t = 0; t < n; t++) if (land(t) && T.drainage[t] >= 1e5) big.push(T.heightKm[t]);
    check('big rivers run through lowlands', big.length > 200 && median(big) < 0.4, `median height ${median(big).toFixed(2)} km along ${big.length} cells draining over 100,000 km²`);
    // active ranges keep their peaks: they are still rising, and the rivers are steep there
    const active = [];
    for (let t = 0; t < n; t++) { const c = T.sampler.cells[3 * t]; if (land(t) && T.rec.kind[c] && kindType(T.rec.kind[c]) !== OrogenyType.ARC && T.rec.quietMyr[c] < 10) active.push(T.heightKm[t]); }
    // (pooled over three frames: one frame alone can be a quiet one — the Phase 11 history's 600 Myr holds only 289
    // cells of active belt)
    const pooled = active.slice();
    for (const F of history.frames.filter(g => g.time === 400 || g.time === 500)) {
        const TT = carved(F), m = TT.heightKm.length;
        for (let t = 0; t < m; t++) { const c = TT.sampler.cells[3 * t]; if (TT.tectonicKm[t] > 0 && TT.rec.kind[c] && kindType(TT.rec.kind[c]) !== OrogenyType.ARC && TT.rec.quietMyr[c] < 10) pooled.push(TT.heightKm[t]); }
    }
    // (a 2 km floor: the carving has not cut active ranges down — how high they stand is the history's)
    check('active ranges keep their peaks (95th percentile ≥ 2 km)', quantile(pooled, 0.95) >= 2, `95th percentile ${quantile(pooled, 0.95).toFixed(2)} km over ${pooled.length} cells of active belts at 400, 500 and 600 Myr (${active.length} at 600)`);
    report('active ranges after carving: 95th percentile height', quantile(pooled, 0.95), { earth: [4, 5], unit: ' km', source: 'Tibet and the Altiplano 4–5 km, Alpine peaks ~4.8 km; holds through the cycle wherever a range is active: plateau height is capped by the crust\'s strength (Molnar & Lyon-Caen 1988)' });
    check('carving at 640K cells within 2 s', T.ms.carve / 1000 < 2, `${(T.ms.carve / 1000).toFixed(2)} s (the surface took ${((T.ms.records + T.ms.sample + T.ms.surface) / 1000).toFixed(2)} s)`);
}

// ── plateaus are eaten from their edges ──
section('a collision plateau');
{
    const { frame } = run('india'), I = carved(frame);
    // the plateau on the upper plate (u 0.3–0.7 across the belt): most of it keeps most of its height, while gorges cut deep
    const kept = [], cut = [];
    for (let t = 0; t < I.tm.numCells; t++) {
        const c = I.sampler.cells[3 * t], k = I.rec.kind[c];
        if (!k || kindType(k) !== OrogenyType.HIMALAYAN || kindSide(k) !== BeltSide.UPPER || I.tectonicKm[t] <= 0) continue;
        const u = I.rec.dKm[c] / Math.max(1, I.rec.reach[c]);
        if (u >= 0.3 && u < 0.7) { kept.push(I.heightKm[t] / I.tectonicKm[t]); cut.push(I.tectonicKm[t] - I.heightKm[t]); }
    }
    // (cell means: a cell drops by the share of it its valley takes, so a gorge's cells average shallower than its floor)
    check('the plateau keeps most of its height while gorges cut deep into it', median(kept) >= 0.7 && quantile(cut, 0.9) >= 0.5,
        `over ${kept.length} cells: median ${(100 * median(kept)).toFixed(0)} % of its tectonic height kept; the deepest tenth cut ${quantile(cut, 0.9).toFixed(2)} km or more`);
}

// ── 8b-2: the rivers of the history ──
section('rivers through the history');
{
    const scene = TERRAIN_SCENES.find(s => s.id === 'history'), world = scene.build(mesh, SEED);
    const { frames } = simulate(world, { untilMyr: 150, drive: w => scene.drive(w), snapshotEveryMyr: 10 });
    // big rivers keep their courses: as crust identities (plate, raster cell), still a big river — or beside one — 10 Myr on
    const riverSet = fr => { const A = buildAnchor(fr, mesh), s = new Set(); for (let w = 0; w < mesh.numCells; w++) if (fr.riverKm2[w] >= 5e4) s.add(fr.owner[w] * 1e6 + A.cell[w]); return s; };
    let kept = 0, total = 0;
    for (let i = 5; i < frames.length; i++) {
        const a = riverSet(frames[i - 1]), b = riverSet(frames[i]);
        for (const key of b) { total++; const o = Math.floor(key / 1e6), c = key % 1e6; let hit = a.has(key); for (let k = mesh.adjOffset[c]; !hit && k < mesh.adjOffset[c + 1]; k++) hit = a.has(o * 1e6 + mesh.adjList[k]); if (hit) kept++; }
    }
    // the first continents' swells (8b round 5) steer the rivers: early on, big rivers run in the lowlands between them
    {
        const f = frames.find(fr => fr.time >= 50), cellKm2 = 4 * Math.PI * 6371 ** 2 / mesh.numCells, big = [], divide = [];
        for (let w = 0; w < mesh.numCells; w++) { if (f.owner[w] < 0 || f.type[w] === 0) continue; if (f.riverKm2[w] >= 1e5) big.push(f.baseKm[w]); else if (f.riverKm2[w] < 3 * cellKm2) divide.push(f.baseKm[w]); }
        check('the first continents’ swells steer the history’s rivers into the lowlands between them', big.length >= 100 && mean(big) <= 0.6 * mean(divide),
            `at ${f.time} Myr: the swells stand ${mean(big).toFixed(2)} km on average under big rivers (≥ 100,000 km²), ${mean(divide).toFixed(2)} km at the divides`);
    }
    // (a floor against flicker only: large drainages persist for tens of Myr on Earth, though they reorganise — the Amazon reversed)
    check('the history’s big rivers do not flicker from frame to frame (≥ 30 % keep their courses over 10 Myr)', total > 1000 && kept / total >= 0.3, `${kept} of ${total} big-river crust cells (≥ 50,000 km²)`);
    report('big-river crust cells still carrying one 10 Myr later', 100 * kept / total, { unit: ' %', digits: 0, source: 'no Earth figure: large drainages persist for tens of Myr' });
    // small rivers in the terrain hold their courses too (they ride with the crust's micro-relief): log drainage at the
    // same crust, 10 Myr apart, on the continent that moved most — against the same terrain with its records read on the
    // fixed world grid (anchorRecords off), where the detail stays put as the crust moves under it
    const A = frames.at(-2), B = frames.at(-1), tm = terrainMesh(640000);
    let p = -1, turned = 0;
    for (let i = 0; i < B.plates.length; i++) { const a = A.plates[i], b = B.plates[i]; if (!a?.alive || !b?.alive || b.landCells < 200) continue; const ang = 2 * Math.acos(Math.min(1, Math.abs(a.quat[0] * b.quat[0] + a.quat[1] * b.quat[1] + a.quat[2] * b.quat[2] + a.quat[3] * b.quat[3]))); if (ang > turned) { turned = ang; p = i; } }
    const MA = quatToMat3(A.plates[p].quat, new Float64Array(9)), MB = quatToMat3(B.plates[p].quat, new Float64Array(9));
    const holds = cfg => {
        // (both frames on today's sea: the sea's own level moves with the mantle and the sea floor's age — terrain/sea-level.js
        // — and drowns or bares low ground with it; that is the sea's change, not the rivers')
        const TA = synthesizeTerrain(A, mesh, tm, { seed: SEED, carve: true, cfg, seaKm: 0 }), TB = synthesizeTerrain(B, mesh, tm, { seed: SEED, carve: true, cfg, seaKm: 0 }), xs = [], ys = [], c3 = [0, 0, 0], w3 = [0, 0, 0];
        for (let q = 0; q < tm.numCells; q++) {
            if (B.owner[TB.sampler.cells[3 * q]] !== p || TB.tectonicKm[q] <= 0 || TB.drainage[q] < 300 || TB.drainage[q] >= 5e4) continue;
            const x = tm.xyz[3 * q], y = tm.xyz[3 * q + 1], z = tm.xyz[3 * q + 2];
            const lx = MB[0] * x + MB[3] * y + MB[6] * z, ly = MB[1] * x + MB[4] * y + MB[7] * z, lz = MB[2] * x + MB[5] * y + MB[8] * z;
            locate(tm, MA[0] * lx + MA[1] * ly + MA[2] * lz, MA[3] * lx + MA[4] * ly + MA[5] * lz, MA[6] * lx + MA[7] * ly + MA[8] * lz, c3, w3);
            const before = w3[0] * TA.drainage[c3[0]] + w3[1] * TA.drainage[c3[1]] + w3[2] * TA.drainage[c3[2]];
            if (TA.tectonicKm[c3[0]] <= 0 || !(before > 0)) continue;            // (a point that was at sea then drained nothing)
            xs.push(Math.log10(TB.drainage[q])); ys.push(Math.log10(before));
        }
        const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
        return { corr: sxy / Math.sqrt(sxx * syy), cells: xs.length };
    };
    const rides = holds(TERRAIN), fixed = holds({ ...TERRAIN, anchorRecords: false });
    check('small rivers hold their courses better riding with the crust than on the fixed world grid', rides.cells > 5000 && rides.corr > fixed.corr,
        `plate ${p} turned ${(turned * 180 / Math.PI).toFixed(1)}° in 10 Myr: small catchments' drainage correlates ${rides.corr.toFixed(2)} with the same crust 10 Myr before over ${rides.cells} cells; ${fixed.corr.toFixed(2)} over ${fixed.cells} with the records on the world grid`);
}
{
    // gorges: in the India collision, the history's rivers cut through the rising belt, and the terrain shows it
    const { frame } = run('india');
    const inBelt = [], plain = [];
    for (let w = 0; w < mesh.numCells; w++) { if (frame.owner[w] < 0 || frame.type[w] === 0) continue; (frame.oroType[w] === OrogenyType.HIMALAYAN ? inBelt : frame.oroType[w] ? [] : plain).push(frame.riverIncKm[w]); }
    check('the history’s rivers cut gorges through the rising belt, not the plains', quantile(inBelt, 0.9) >= 0.5 && quantile(plain, 0.9) < 0.2,
        `how deep they cut (90th percentile): ${quantile(inBelt, 0.9).toFixed(2)} km in the collision belt, ${quantile(plain, 0.9).toFixed(2)} km on the plains; deepest ${Math.max(...inBelt).toFixed(2)} km`);
    const tm = terrainMesh(640000), H = synthesizeTerrain(frame, mesh, tm, { seed: SEED, carve: true });
    const N = synthesizeTerrain({ ...frame, riverIncKm: new Float32Array(frame.riverIncKm.length) }, mesh, tm, { seed: SEED, carve: true });
    let deeper = 0, most = 0;
    for (let q = 0; q < tm.numCells; q++) { const d = N.heightKm[q] - H.heightKm[q]; if (d > 0.1) deeper++; most = Math.max(most, d); }
    check('the terrain draws them: canyons where the history’s rivers held their ways', deeper >= 300 && most >= 1,
        `${deeper} terrain cells cut more than 100 m deeper than without the history’s rivers; the deepest by ${most.toFixed(2)} km`);
}

// ── flood basalt is cut into a stair (8b round 6) ──
section('flood basalt');
{
    const scene = TERRAIN_SCENES.find(s => s.id === 'traps'), world = scene.build(mesh, SEED);
    const { frames } = simulate(world, { untilMyr: 112, drive: w => scene.drive(w), snapshotEveryMyr: 10 }), f = frames.at(-1), tm = terrainMesh(640000);
    const A = synthesizeTerrain(f, mesh, tm, { seed: SEED, carve: true, parts: true }), B = synthesizeTerrain(f, mesh, tm, { seed: SEED, carve: true, cfg: { ...TERRAIN, lipStepKm: 0 } });
    // where the stair acted (in the basalt, where it is cut into): cells nearly level (within 20 m) with a neighbour —
    // the treads — measured above the ground under the pile (which has its own swells and grain); with and without the
    // stair. And never above the slope it replaced.
    let cells = 0, flatA = 0, flatB = 0, higher = 0;
    const under = Float32Array.from(A.tectonicKm, (v, t) => v - A.parts.lip[t]);
    const nearlyLevel = (Z, t) => { for (let k = tm.adjOffset[t]; k < tm.adjOffset[t + 1]; k++) { const n = tm.adjList[k]; if (Math.abs(Z[n] - under[n] - Z[t] + under[t]) < 0.02) return 1; } return 0; };
    for (let t = 0; t < tm.numCells; t++) {
        if (!(A.parts.lip[t] > 0) || A.tectonicKm[t] <= 0) continue;
        if (A.heightKm[t] > B.heightKm[t] + 1e-6) higher++;
        if (Math.abs(A.heightKm[t] - B.heightKm[t]) < 0.005) continue;
        cells++; flatA += nearlyLevel(A.heightKm, t); flatB += nearlyLevel(B.heightKm, t);
    }
    // (at 30 km cells a steep wall puts each step in a cell of its own: a quarter more treads, not twice as many. Since
    // 2026-09-29 the stair is only a hint — lipStairShare, developer: "the mesa effect is way too strong … should erode down
    // more smoothly" — so the bench ratio is reported, and only "never raised" is held)
    check('the stair cut into flood basalt never raises it', cells > 0 && higher === 0, `${higher} of the ${cells} terrain cells of basalt the stair shaped raised by it`);
    report('flood basalt benches: nearly level cells with the stair ÷ without', flatA / Math.max(1, flatB), { source: 'no Earth figure: stepped trap topography',
        detail: `100 Myr on: ${(100 * flatA / cells).toFixed(0)} % nearly level (within 20 m) with a neighbour, ${(100 * flatB / cells).toFixed(0)} % without it` });
}

// ── the same planet at every resolution ──
section('the same planet at every resolution');
{
    const perSim = X => { const sum = new Float64Array(mesh.numCells), cnt = new Uint32Array(mesh.numCells); for (let t = 0; t < X.tm.numCells; t++) { const c = mesh.index.nearest(X.tm.xyz[3 * t], X.tm.xyz[3 * t + 1], X.tm.xyz[3 * t + 2]); sum[c] += X.heightKm[t]; cnt[c]++; } return Array.from(sum, (s, c) => (cnt[c] ? s / cnt[c] : NaN)); };
    const a = perSim(T);
    for (const cells of [160000, 2500000]) {
        const X = carved(history.frame, cells), b = perSim(X), pairs = a.map((v, c) => [v, b[c]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
        const ma = mean(pairs.map(p => p[0])), mb = mean(pairs.map(p => p[1]));
        let sab = 0, saa = 0, sbb = 0, diff = 0;
        for (const [x, y] of pairs) { sab += (x - ma) * (y - mb); saa += (x - ma) ** 2; sbb += (y - mb) ** 2; diff += Math.abs(x - y); }
        const hx = hypsometry(X.heightKm), h6 = hypsometry(T.heightKm), name = cells === 160000 ? '160K' : '2.5M';
        check(`${name} vs 640K: the same carved heights, sim cell by sim cell`, sab / Math.sqrt(saa * sbb) >= 0.97 && diff / pairs.length <= 0.15, `correlation ${(sab / Math.sqrt(saa * sbb)).toFixed(3)}, mean difference ${(diff / pairs.length).toFixed(3)} km`);
        check(`${name} vs 640K: the same hypsometry`, Math.abs(hx.below400 - h6.below400) <= 0.06 && Math.abs(hx.landKm[2] / h6.landKm[2] - 1) <= 0.15,
            `below 400 m ${(100 * hx.below400).toFixed(0)} vs ${(100 * h6.below400).toFixed(0)} %; median ${hx.landKm[2].toFixed(2)} vs ${h6.landKm[2].toFixed(2)} km`);
    }
    // the lab carves on its worker pool: the very same terrain, bit for bit
    const pool = await TerrainPool.create(mesh, 4), surf = await pool.synthesize(history.frame, T.tm, { cfg: TERRAIN, seed: SEED, carveInputs: true, records: false }), C = await pool.carve(T.tm, surf, TERRAIN);
    pool.terminate();
    const same = (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]));
    check('carving on the worker pool gives exactly the terrain carved in place', same(C.z, T.heightKm) && same(C.area, T.drainage), '640K cells: carved heights and drainage identical');
}

finish('Phase 8b');
