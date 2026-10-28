// Headless acceptance checks for Phase 9 (steady detail: the terrain read on each plate's own crust, so a drifting
// continent keeps its coasts, shapes, ridges and rivers from frame to frame — changing only where the history changes).
// The developer's measure is a clear gain and an overall feel of stability, not perfection: the checks hold the gain
// against the world grid (anchorRecords: false) and set floors near what it reached.
// Every check is hard and numerical — the frame's completeness, resampling invariance, the detail's coherence in time and
// its renewal clock (detailRenewMyr itself is a matter of taste) — so nothing here is reported against Earth.
// The resampling and drift checks read a whole history, and a history is chaotic (a ~4 % nudge of an unrelated parameter
// sends it down another path): they are judged over the histories of three seeds — the median against the floor, and the
// gain over the world grid on every seed (lib/check-kit.mjs, the checks lane 2026-10-28).
// Usage: node v2/tools/check-phase9.mjs

import { check, report, section, finish, labMesh, medianOf } from './lib/check-kit.mjs';
import { simulateCached } from './lib/history-cache.mjs';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { synthesizeTerrain } from '../js/terrain/synthesize.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { buildAnchor } from '../js/terrain/anchor.js';
import { locate } from '../js/core/mesh-locate.js';
import { quatFromAxisAngle, quatMul, quatToMat3 } from '../js/core/rotation.js';

// (the seeds: phase 10 and 13 read these same whole-planet histories, so the history cache builds each once)
const SEEDS = [12345, 777, 4242];
const mesh = labMesh(), n = mesh.numCells;
const corr = (xs, ys) => { const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length; let a = 0, b = 0, c = 0; for (let i = 0; i < xs.length; i++) { a += (xs[i] - mx) * (ys[i] - my); b += (xs[i] - mx) ** 2; c += (ys[i] - my) ** 2; } return a / Math.sqrt(b * c); };
const scene = TERRAIN_SCENES.find(s => s.id === 'history');
const history = (seed, until) => { const world = scene.build(mesh, seed); return simulateCached(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 10 }, { drive: scene.drive }).frames; };     // (the history cache: tools/lib/history-cache.mjs)
const tm = terrainMesh(640000);
const f2 = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : String(v)), pct = v => f2(100 * v, 1);
const bySeed = (rows, fn) => rows.map(r => `${r.seed}: ${fn(r)}`).join(' · ');

// ── the frame carries every plate's crust ──
section('each plate\'s crust in the frame');
const frames300 = new Map(SEEDS.map(seed => [seed, history(seed, 300)]));
const at = (seed, t) => frames300.get(seed).find(f => Math.abs(f.time - t) < 1e-6);
{
    // (bookkeeping: it must hold in every history)
    const rows = SEEDS.map(seed => {
        const f = at(seed, 150);
        let masked = 0; const carried = f.crustCells.length, beltsOk = f.crustBelt.length === 6 * carried && f.crustReach.length === 2 * carried;
        for (const p of f.plates) if (p?.alive) masked += p.cells;
        const A = buildAnchor(f, mesh), shown = new Set();
        for (let w = 0; w < n; w++) if (A.owner[w] >= 0) shown.add(A.owner[w] * n + A.cell[w]);
        let hiddenLand = 0;
        for (let i = 0; i < carried; i++) if (!shown.has(f.crustCells[i]) && f.crustType[i] !== CrustType.OCEAN) hiddenLand++;
        return { seed, ok: carried >= 0.95 * masked && beltsOk && hiddenLand > 0, carried, masked, hiddenLand };
    });
    check('a frame carries every plate\'s crust cells and their belts — including those no world cell shows', rows.every(r => r.ok),
        bySeed(rows, r => `${r.carried} crust cells carried (the plates hold ${r.masked}); ${r.hiddenLand} of them land that no world cell shows`) + ' (150 Myr)');
}

// ── turned under the world grid: the same planet, the world grid half a cell over ──
section('the planet turned half a cell under the world grid');
{
    // as the history re-samples a moving plate: each world cell of the turned planet shows the crust cell under it on its
    // plate's raster, with the values the original frame shows for that crust cell (or, hidden, at its nearest world cell)
    const q = quatFromAxisAngle(0.6, 0.8, 0, 0.6 * Math.PI / 180), Rm = quatToMat3(q, new Float64Array(9));
    const rotT = (x, y, z) => [Rm[0] * x + Rm[3] * y + Rm[6] * z, Rm[1] * x + Rm[4] * y + Rm[7] * z, Rm[2] * x + Rm[5] * y + Rm[8] * z];
    const turned = (seed, F) => {
        const AF = buildAnchor(F, mesh), inv = new Map();
        for (let w = 0; w < n; w++) if (AF.owner[w] >= 0) { const key = AF.owner[w] * n + AF.cell[w]; if (!inv.has(key)) inv.set(key, w); }
        const G = { plates: F.plates.map(p => p && { ...p, quat: quatMul(q, p.quat) }) }, src = new Int32Array(n), ownerG = new Int16Array(n);
        for (let w = 0; w < n; w++) {
            const [x, y, z] = rotT(mesh.xyz[3 * w], mesh.xyz[3 * w + 1], mesh.xyz[3 * w + 2]), from = mesh.index.nearest(x, y, z), o = F.owner[from];
            ownerG[w] = o;
            if (o < 0) { src[w] = from; continue; }
            const M = quatToMat3(G.plates[o].quat, new Float64Array(9)), X = mesh.xyz[3 * w], Y = mesh.xyz[3 * w + 1], Z = mesh.xyz[3 * w + 2];
            const r = mesh.index.nearest(M[0] * X + M[3] * Y + M[6] * Z, M[1] * X + M[4] * Y + M[7] * Z, M[2] * X + M[5] * Y + M[8] * Z);
            let s = inv.get(o * n + r);
            if (s === undefined) { const m = AF.mats, b = 9 * o, rx = mesh.xyz[3 * r], ry = mesh.xyz[3 * r + 1], rz = mesh.xyz[3 * r + 2]; s = mesh.index.nearest(m[b] * rx + m[b + 1] * ry + m[b + 2] * rz, m[b + 3] * rx + m[b + 4] * ry + m[b + 5] * rz, m[b + 6] * rx + m[b + 7] * ry + m[b + 8] * rz); }
            src[w] = s;
        }
        for (const [k, v] of Object.entries(F)) {
            if (k === 'plates') continue;
            if (ArrayBuffer.isView(v) && v.length === n) { const a = new v.constructor(n); for (let w = 0; w < n; w++) a[w] = v[src[w]]; G[k] = a; } else G[k] = v;
        }
        G.owner = ownerG;
        // (at 640K: on a coarser mesh the resolution fade leaves only the broadest belts' ridges — a handful of features, and a
        // correlation that swings by ±0.2 from one draw of their phases and noise to the next)
        const c3 = [0, 0, 0], w3 = [0, 0, 0];
        const measure = anchor => {
            const cfg = terrainConfig({ anchorRecords: anchor });
            const TA = synthesizeTerrain(F, mesh, tm, { seed, cfg, parts: true }), TB = synthesizeTerrain(G, mesh, tm, { seed, cfg, parts: true });
            let coastN = 0, coastSame = 0; const hx = [], hy = [], sx = [], sy = [];
            for (let t = 0; t < tm.numCells; t++) {
                const [x, y, z] = rotT(tm.xyz[3 * t], tm.xyz[3 * t + 1], tm.xyz[3 * t + 2]);
                locate(tm, x, y, z, c3, w3);
                const at3 = F2 => w3[0] * F2[c3[0]] + w3[1] * F2[c3[1]] + w3[2] * F2[c3[2]], hB = TB.heightKm[t], hA = at3(TA.heightKm), c = TB.sampler.cells[3 * t];
                if (G.owner[c] >= 0 && Math.abs(TB.rec.coastKm[c]) <= 300) { coastN++; if ((hB > 0) === (hA > 0)) coastSame++; }
                if (hB <= 0) continue;
                hx.push(hB); hy.push(hA);
                if (TB.parts.stripes[t] !== 0 || at3(TA.parts.stripes) !== 0) { sx.push(TB.parts.stripes[t]); sy.push(at3(TA.parts.stripes)); }
            }
            return { coast: coastSame / coastN, heights: corr(hx, hy), ridges: corr(sx, sy) };
        };
        return { seed, grid: measure(false), crust: measure(true) };
    };
    const rows = SEEDS.map(seed => turned(seed, at(seed, 150)));
    // (before Phase 9, measured once with that code: 92.4 %, 0.65 and 0.44–0.47 over two seeds.) Judged over the seeds: the
    // median read on the crust against the floor, and the crust read better than the world grid's on every seed. (The
    // margins over the grid read once asked — 2 points, 0.1, 0.03 — were floors near the gain on one history when the grid
    // read was worse; the grid read has since gained from the same crust records (coasts from the crust's own coast
    // distance), so the gain is held to its sign on every seed, a sign test over the seeds, not to a margin from one history)
    const med = k => medianOf(rows.map(r => r.crust[k])), gains = k => rows.map(r => r.crust[k] - r.grid[k]);
    const line = (k, fmt) => bySeed(rows, r => `${fmt(r.crust[k])} (grid ${fmt(r.grid[k])})`);
    check('turned half a cell, a coastline stays where its crust is', med('coast') >= 0.965 && gains('coast').every(g => g > 0),
        `land and sea agree at the same crust on ${pct(med('coast'))} % of cells within 300 km of a coast (median of ${rows.length} histories at 150 Myr; before Phase 9: 92.4 %) — ${line('coast', pct)} %`);
    check('…and so does the land\'s shape', med('heights') >= 0.85 && gains('heights').every(g => g > 0),
        `land heights correlate ${f2(med('heights'))} with the same crust before the turn (median; before Phase 9: 0.65) — ${line('heights', f2)}`);
    // (the ridge kernels sit on the crust in both reads — that was their fix — so against the grid they differ only in the
    // records their height is read from)
    check('…and so do the ridges', med('ridges') >= 0.55 && gains('ridges').every(g => g > 0),
        `the ridges correlate ${f2(med('ridges'))} (median; before Phase 9, kernels per world cell: 0.44–0.47) — ${line('ridges', f2)}`);
    for (const [k, unit, scale] of [['coast', ' points', 100], ['heights', '', 1], ['ridges', '', 1]])
        report(`half-cell turn: the crust read's gain over the world grid's, ${k}`, gains(k).map(g => scale * g), { unit, digits: 3, detail: `seeds ${SEEDS.join(', ')}` });
}

// ── the fine detail renews slowly (detailRenewMyr): the same frame, its renewal clock run on ──
section('fine detail renews slowly');
{
    // (a frame read at a later time would change its records too — ages, quiet spells — so the frame stays and the
    // renewal's clock, time ÷ detailRenewMyr, is run on by shortening the period: t / P' = (t + Δt) / P. The coast's bays
    // and headlands, the coast distance's noise, are read 100–300 km inland, where it is always on the land side — on the
    // rugged coasts that have any: records.js rugged)
    // (at 640K, as above: independent draws of the ridges then correlate within ±0.05. One history: the clock is the
    // terrain's own, the same on any frame)
    const SEED = SEEDS[0], F = at(SEED, 150), P = terrainConfig().detailRenewMyr, t0 = F.time;
    const later = dt => synthesizeTerrain(F, mesh, tm, { seed: SEED, parts: true, cfg: terrainConfig({ detailRenewMyr: P * t0 / (t0 + dt) }) });
    const T0 = later(0), T10 = later(10), TP = later(P);
    const ridges = T => { const xs = [], ys = []; for (let t = 0; t < tm.numCells; t++) if (T0.parts.stripes[t] !== 0 || T.parts.stripes[t] !== 0) { xs.push(T0.parts.stripes[t]); ys.push(T.parts.stripes[t]); } return corr(xs, ys); };
    const bays = T => { const xs = [], ys = []; for (let t = 0; t < tm.numCells; t++) if (T0.parts.dcoastRaw[t] >= 100 && T0.parts.dcoastRaw[t] <= 300 && T0.parts.dcoast[t] > 0 && T.parts.dcoast[t] > 0 && (T0.parts.dcoast[t] !== T0.parts.dcoastRaw[t] || T.parts.dcoast[t] !== T.parts.dcoastRaw[t])) { xs.push(T0.parts.dcoast[t] - T0.parts.dcoastRaw[t]); ys.push(T.parts.dcoast[t] - T.parts.dcoastRaw[t]); } return corr(xs, ys); };
    const r10 = ridges(T10), rP = ridges(TP), b10 = bays(T10), bP = bays(TP);
    check('from one frame to the next (10 Myr) the fine detail holds…', P > 0 && r10 >= 0.9 && b10 >= 0.98,
        `renewing over ${P} Myr: the ridges correlate ${r10.toFixed(2)} with themselves 10 Myr before, the bays and headlands ${b10.toFixed(3)}`);
    check(`…and over ${P} Myr it is renewed`, Math.abs(rP) <= 0.15 && Math.abs(bP) <= 0.15,
        `${P} Myr on, the ridges correlate ${rP.toFixed(2)}, the bays and headlands ${bP.toFixed(2)}`);
}

// ── real frames: a drifting continent 10 Myr on ──
section('a drifting continent 10 Myr on');
{
    // The terrain's change on the continent that turned most in 10 Myr, the history's own change left out:
    //   · only crust the plate held in both frames (a cell of its raster carried in both: the frame's crustCells), of the
    //     same type in both, and no island arc whose crust changed between them (an arc grows while its slab feeds it and
    //     subsides once silent, tectonics/measure.js arcSurfaceKm — the history's change, as a weld's or a rift's is);
    //   · where the plate's own coast records put the point on the same side of the coast in both frames (Phase 11 closes
    //     remnant seas from their shores and welds redraw coasts);
    //   · the terrain read with the mantle's swell taken out (mantleSwellKm 0, in both frames): the swell is the mantle's,
    //     fixed under the world (terrain/sea-level.js), so a continent drifting across it rises or sinks — and tilts, and
    //     its rivers with it — for real: Australia flooded on its northern side as it drifted onto the Indonesian
    //     downwelling (DiCaprio et al. 2009). That is the history's change, not the terrain's. Both frames on B's sea.
    const noSwell = terrainConfig({ mantleSwellKm: 0 });
    const ownTypes = (F, p) => { const ty = new Int8Array(n).fill(-1); for (let i = 0; i < F.crustCells.length; i++) { const k = F.crustCells[i]; if (k >= p * n && k < (p + 1) * n) ty[k - p * n] = F.crustType[i]; } return ty; };
    const drift = (seed, A, B) => {
        const TB = synthesizeTerrain(B, mesh, tm, { seed, carve: true, cfg: noSwell }), TA = synthesizeTerrain(A, mesh, tm, { seed, carve: true, cfg: noSwell, seaKm: TB.rec.seaKm });
        // (the continent: the one that turned most of those big enough to judge — over 5000 terrain cells near its coasts,
        // before anything is left out. A history whose plates are all smaller did not form the scene)
        const coastOf = new Int32Array(B.plates.length);
        for (let t = 0; t < tm.numCells; t++) { const c = TB.sampler.cells[3 * t]; if (B.owner[c] >= 0 && Math.abs(TB.rec.coastKm[c]) <= 300) coastOf[B.owner[c]]++; }
        let p = -1, turned = 0;
        for (let i = 0; i < B.plates.length; i++) { const a = A.plates[i], b = B.plates[i]; if (!a?.alive || !b?.alive || b.landCells < 200 || coastOf[i] <= 5000) continue; const ang = 2 * Math.acos(Math.min(1, Math.abs(a.quat[0] * b.quat[0] + a.quat[1] * b.quat[1] + a.quat[2] * b.quat[2] + a.quat[3] * b.quat[3]))); if (ang > turned) { turned = ang; p = i; } }
        if (p < 0) return { seed, p, coastAll: 0, turned: 0 };
        const MA = quatToMat3(A.plates[p].quat, new Float64Array(9)), MB = quatToMat3(B.plates[p].quat, new Float64Array(9)), c3 = [0, 0, 0], w3 = [0, 0, 0];
        const tyA = ownTypes(A, p), tyB = ownTypes(B, p);
        let coastAll = 0, coastN = 0, coastSame = 0, moved = 0, notHeld = 0, retyped = 0, arcGrew = 0, seen = 0; const hx = [], hy = [], s3 = [0, 0, 0], sw3 = [0, 0, 0];
        const changed = new Uint8Array(tm.numCells), riverAt = [];      // (the history's change, per terrain cell; the rivers to judge, with whether one ran there before)
        for (let t = 0; t < tm.numCells; t++) {
            const c = TB.sampler.cells[3 * t];
            if (B.owner[c] !== p) { changed[t] = 1; continue; }          // (another plate's ground moves as that plate does)
            seen++;
            if (Math.abs(TB.rec.coastKm[c]) <= 300) coastAll++;          // (the continent's coast, before anything is left out: its size)
            const x = tm.xyz[3 * t], y = tm.xyz[3 * t + 1], z = tm.xyz[3 * t + 2], lx = MB[0] * x + MB[3] * y + MB[6] * z, ly = MB[1] * x + MB[4] * y + MB[7] * z, lz = MB[2] * x + MB[5] * y + MB[8] * z;
            const ax = MA[0] * lx + MA[1] * ly + MA[2] * lz, ay = MA[3] * lx + MA[4] * ly + MA[5] * lz, az = MA[6] * lx + MA[7] * ly + MA[8] * lz;
            // (the crust itself: its raster cell, held in both frames, of one type, and no arc that grew or subsided)
            const r = mesh.index.nearest(lx, ly, lz), a = mesh.index.nearest(ax, ay, az);
            if (tyA[r] < 0 || tyB[r] < 0) { notHeld++; changed[t] = 1; continue; }
            if (tyA[r] !== tyB[r]) { retyped++; changed[t] = 1; continue; }
            if ((tyB[r] === CrustType.ARC || A.arcKm[a] > 0 || B.arcKm[c] > 0) && Math.abs(A.arcKm[a] - B.arcKm[c]) > 1e-3) { arcGrew++; changed[t] = 1; continue; }
            locate(tm, ax, ay, az, c3, w3);
            const at3 = F2 => w3[0] * F2[c3[0]] + w3[1] * F2[c3[1]] + w3[2] * F2[c3[2]], hA = at3(TA.tectonicKm), hB = TB.tectonicKm[t];
            if (Math.abs(TB.rec.coastKm[c]) <= 300) {
                locate(mesh, lx, ly, lz, s3, sw3);
                const on = R => R ? sw3[0] * R.coast[s3[0]] + sw3[1] * R.coast[s3[1]] + sw3[2] * R.coast[s3[2]] : NaN;
                const cA = on(TA.rec.coastRaster.get(p)), cB = on(TB.rec.coastRaster.get(p));
                if (cA === cA && cB === cB && (cA > 0) !== (cB > 0)) { moved++; changed[t] = 1; continue; }
                coastN++; if ((hB > 0) === (hA > 0)) coastSame++;
            }
            if (hB > 0) { hx.push(hB); hy.push(hA); }
            if (TB.drainage[t] >= 1e4 && hB > 0) {
                let hit = false;
                for (let j = 0; j < 3 && !hit; j++) { const q = c3[j]; if (TA.drainage[q] >= 5e3) hit = true; for (let k = tm.adjOffset[q]; !hit && k < tm.adjOffset[q + 1]; k++) if (TA.drainage[tm.adjList[k]] >= 5e3) hit = true; }
                riverAt.push(t, hit ? 1 : 0);
            }
        }
        // (a river is the history's change too where its basin is: where any ground upstream of it changed crust, moved its
        // coast or lies on another plate — a basin rerouted by what the history did upstream. Downstream in order of drainage,
        // which grows along every river)
        const order = Uint32Array.from({ length: tm.numCells }, (_, t) => t).sort((u, v) => TB.drainage[u] - TB.drainage[v]);
        for (const u of order) { const d = TB.receivers[u]; if (d >= 0 && changed[u]) changed[d] = 1; }
        let rivers = 0, kept = 0, riversChanged = 0;
        for (let i = 0; i < riverAt.length; i += 2) { if (changed[riverAt[i]]) { riversChanged++; continue; } rivers++; kept += riverAt[i + 1]; }
        return { seed, p, turned: turned * 180 / Math.PI, coastAll, coastN, coast: coastSame / coastN, heights: corr(hx, hy), rivers: kept / rivers, riverN: rivers, riversChanged: riversChanged / Math.max(1, rivers + riversChanged), notHeld: notHeld / seen, retyped: retyped / seen, arcGrew: arcGrew / seen, moved: moved / seen };
    };
    const unformed = [];
    for (const t of [150, 300]) {
        // (a history with no continent big enough to judge did not form the scene: counted, not judged; the check fails if
        // that is most of them)
        const all = SEEDS.map(seed => drift(seed, at(seed, t - 10), at(seed, t))), rows = all.filter(r => r.coastAll > 5000);
        const med = k => medianOf(rows.map(r => r[k]));
        unformed.push(all.length - rows.length);
        check(`${t - 10}→${t} Myr: the continent that moved most keeps its coasts, its shape and its rivers`, rows.length > all.length / 2 && med('coast') >= 0.95 && med('heights') >= 0.5 && med('rivers') >= 0.9,
            `medians of the ${rows.length} of ${all.length} histories whose continent has over 5000 cells near its coasts${rows.length < all.length ? ` (no continent big enough on ${all.filter(r => !rows.includes(r)).map(r => r.seed).join(', ')})` : ''}: land and sea agree at the same crust on ${pct(med('coast'))} % of cells near its coasts (before Phase 9: 92–95 %), land heights correlate ${f2(med('heights'))} (0.45–0.49 before), ${(100 * med('rivers')).toFixed(1)} % of its rivers over 10,000 km² run within a cell of one 10 Myr before — `
            + bySeed(rows, r => `plate ${r.p} turned ${r.turned.toFixed(1)}° (${r.coastAll} cells near its coasts, ${r.coastN} judged): ${pct(r.coast)} %, ${f2(r.heights)}, ${(100 * r.rivers).toFixed(1)} % of ${r.riverN} river cells (left out as the history's change: ${pct(r.riversChanged)} % of its river cells, whose basins it changed; of its cells, ${pct(r.notHeld)} % crust it did not hold in both frames, ${pct(r.retyped)} % crust that changed type, ${pct(r.arcGrew)} % arc that grew or subsided, ${pct(r.moved)} % a moved coast)`));
    }
    report('a drifting continent: histories with no continent big enough to judge (140→150 · 290→300 Myr)', unformed, { digits: 0, source: 'the scene not forming is the history\'s chance, not a physics failure: counted, never failed (unless on most seeds)', detail: `of ${SEEDS.length} each` });
}

finish('Phase 9');
