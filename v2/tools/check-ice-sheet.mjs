#!/usr/bin/env node
// The ice sheet's flow (gpu/ice-sheet.js, lane iceage B2 (i), 2026-11-25) against what it must do, on the GPU (Dawn in Node):
//   · Halfar's dome (Halfar 1981; Bueler et al. 2005 test B): a dome of ice on a flat bed with no mass balance spreads under
//     its own weight in a known way, H(r,t) = H₀ (t₀/t)^{1/9} [1 − ((t₀/t)^{1/18} r/R₀)^{4/3}]^{3/7} for n = 3, with
//     t₀ = (7/4)³ R₀⁴ / (18 Γ H₀⁷). EISMINT's dome (R₀ 750 km, H₀ 3 600 m, A 10⁻¹⁶: t₀ 422 a) stepped from t₀ for 20 kyr on two
//     meshes, against the exact answer: the scheme (its hexagon's faces on the jittered mesh, its explicit steps) is what this
//     measures, and its error must fall as the mesh is refined (Bueler et al.'s convergence test). Its volume is kept.
//   · Sliding: where the bed is thawed (Robin's column against the pressure-melting point, ice-sheet.js robinBed), the bed's
//     speed B₀ ρ g H |∇s| (EISMINT II exp. H), the thawed cells the reference's; a frozen bed doesn't slide, a thawed dome
//     falls faster, and the books close.
//   · The sea's front: a sheet grown on an island under a positive balance, with snow on the sea around it: floating ice only
//     at the front, the open sea's ice calved, and the books close (the volume = what fell − what calved: nothing made at its
//     steep margin, the flux limited to what a cell holds, lane iceemu E1a).
//   · The degree-day balance (gpu/ice-balance.js) against its CPU reference (pddBalance, check-iceage-earth's), on a made-up
//     climate and a random bed and ice: the same balance to float32's rounding.
//   node v2/tools/check-ice-sheet.mjs        (needs a GPU: Dawn in Node, through check-kit)
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { check, report, section, finish } from './lib/check-kit.mjs';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { finishDevice } from '../js/gpu/finish-gpu.js';
import { iceSheetGPU, glenGamma, ICE, robinBed } from '../js/gpu/ice-sheet.js';
import { iceBalanceGPU, pddBalance, PDD } from '../js/gpu/ice-balance.js';
import { readBack } from '../js/gpu/gpu-device.js';
import { bilinear } from '../js/finish/finish.js';

setDelaunator(Delaunator);
const t0 = performance.now(), R = 6.371e6;
const device = await finishDevice();
const unit = (latDeg, lonDeg) => { const a = latDeg * Math.PI / 180, o = lonDeg * Math.PI / 180; return [Math.cos(a) * Math.cos(o), Math.cos(a) * Math.sin(o), Math.sin(a)]; };
const arcM = (x, c, p) => R * Math.acos(Math.max(-1, Math.min(1, x[3 * c] * p[0] + x[3 * c + 1] * p[1] + x[3 * c + 2] * p[2])));

// ── Halfar's dome ──
section('Halfar\'s dome (Bueler et al. 2005 test B)');
const R0 = 750e3, H0 = 3600, T0 = (7 / 4) ** 3 * R0 ** 4 / (18 * glenGamma() * H0 ** 7), RUN = 20000, centre = unit(40, 10);
const halfar = (r, t) => { const q = (T0 / t) ** (1 / 18) * r / R0; return q >= 1 ? 0 : H0 * (T0 / t) ** (1 / 9) * (1 - q ** (4 / 3)) ** (3 / 7); };
const dome = {};
const MESHES = [40000, 160000, 640000], meshes = {};
for (const N of MESHES) {
    const mesh = meshes[N] = terrainMesh(N), n = mesh.numCells, x = mesh.xyz, r = new Float64Array(n), H = new Float32Array(n);
    for (let c = 0; c < n; c++) { r[c] = arcM(x, c, centre); H[c] = halfar(r[c], T0); }
    const tw = performance.now();
    const ice = await iceSheetGPU(device, { mesh, bed: new Float32Array(n), H, smb: new Float32Array(n), sea: -1e4 });
    const { steps } = await ice.run(RUN);
    const h = await ice.readH(), b = await ice.books(), ms = performance.now() - tw;
    const t = T0 + RUN;
    let c0 = 0; for (let c = 1; c < n; c++) if (r[c] < r[c0]) c0 = c;
    let err = 0, cnt = 0, worst = 0, rIce = 0, iceM2 = 0;
    const { area: cellM2 } = (await import('../js/gpu/ice-sheet.js')).iceGeometry(mesh);
    for (let c = 0; c < n; c++) {
        const e = halfar(r[c], t);
        if (e > 0 || h[c] > 0) { err += Math.abs(h[c] - e); cnt++; worst = Math.max(worst, Math.abs(h[c] - e)); }
        if (h[c] > 1) { rIce = Math.max(rIce, r[c]); iceM2 += cellM2[c]; }
    }
    const dCentre = (h[c0] - halfar(r[c0], t)) / halfar(r[c0], t), rTrue = R0 * (t / T0) ** (1 / 18), edge = mesh.edgeKm * 1000;
    // (the margin two ways: the farthest ice cell's centre — a partly covered cell counts whole, so up to a cell out — and the
    // radius of a disc of the ice's area, the cells' own area)
    const rEq = R * Math.acos(1 - iceM2 / (2 * Math.PI * R * R));
    dome[N] = { dCentre, mean: err / cnt, worst, rIce, rEq, rTrue, edge, b, steps, ms };
    report(`${N / 1000}K (${mesh.edgeKm.toFixed(0)} km): the dome's centre after 20 kyr against Halfar's`, 100 * dCentre, { unit: ' %', digits: 2, detail: `${h[c0].toFixed(0)} m vs ${halfar(r[c0], t).toFixed(0)} m; mean |error| ${(err / cnt).toFixed(1)} m, worst ${worst.toFixed(0)} m; margin ${(rIce / 1e3).toFixed(0)} km (its area's disc ${(rEq / 1e3).toFixed(0)} km) vs ${(rTrue / 1e3).toFixed(0)} km; ${steps} steps, ${(ms / 1000).toFixed(1)} s` });
    ice.destroy();
}
{
    const a = dome[40000], m = dome[160000], z = dome[640000];
    const order = (p, q) => Math.log(p / q) / Math.log(2);     // (each mesh halves the cell)
    // (convergence where it is asymptotic: the 40K mesh's dome is ~8 cells in radius, its margin a cell — its error is the grid's,
    // reported; 160K → 640K must fall, and the finest must beat the coarsest)
    check('the dome converges: its mean error falls 160K → 640K, and 640K beats 40K, its margin closing in', z.mean < m.mean && z.mean < a.mean && Math.abs(z.rEq - z.rTrue) < Math.abs(a.rEq - a.rTrue),
        `centre ${(100 * a.dCentre).toFixed(2)} → ${(100 * m.dCentre).toFixed(2)} → ${(100 * z.dCentre).toFixed(2)} %, mean |error| ${a.mean.toFixed(1)} → ${m.mean.toFixed(1)} → ${z.mean.toFixed(1)} m (order ${order(a.mean, m.mean).toFixed(2)}, ${order(m.mean, z.mean).toFixed(2)}); margin's disc ${[a, m, z].map(d => ((d.rEq - d.rTrue) / 1e3).toFixed(0)).join(' → ')} km`);
    for (const N of [160000, 640000]) { const d = dome[N];
        check(`${N / 1000}K: the dome's centre within 2 % of Halfar's and its margin within two cells`, Math.abs(d.dCentre) < 0.02 && Math.abs(d.rIce - d.rTrue) < 2 * d.edge, `${(100 * d.dCentre).toFixed(2)} %; ${((d.rIce - d.rTrue) / 1e3).toFixed(0)} km (cell ${(d.edge / 1e3).toFixed(0)} km)`); }
    for (const N of MESHES) {
        const { b } = dome[N];
        check(`${N / 1000}K: the dome's volume kept (no balance, nothing calved, nothing made: the flux limited to what a cell holds)`, Math.abs(b.volume - b.start) < 1e-4 * b.start && b.made < 1e-6 * b.start && b.calved === 0, `${(b.start / 1e15).toFixed(4)} → ${(b.volume / 1e15).toFixed(4)} M km³, made ${(100 * b.made / b.start).toFixed(4)} %`);
    }
}

// ── sliding where the bed is thawed ──
section('sliding (Weertman, EISMINT II exp. H) where the bed is thawed (Robin 1955)');
{
    const mesh = meshes[160000], n = mesh.numCells, x = mesh.xyz, r = new Float64Array(n), H = new Float32Array(n);
    for (let c = 0; c < n; c++) { r[c] = arcM(x, c, centre); H[c] = halfar(r[c], T0); }
    // (a surface's year-mean and balance at random, the bed thawed or not by Robin's column: the GPU's against the reference's)
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const Ts = new Float32Array(n), smb = new Float32Array(n);
    for (let c = 0; c < n; c++) { Ts[c] = -40 + 45 * rnd(); smb[c] = -0.5 + 1.2 * rnd(); }
    const ice = await iceSheetGPU(device, { mesh, bed: new Float32Array(n), H, smb, sea: -1e4 });
    ice.setTsurf(Ts);
    const sp0 = await ice.speeds();
    let wrong = 0, thawedN = 0, iced = 0, worstU = 0;
    // (the bed's speed against B₀ ρ g H |∇s|: the cell's gradient from its faces on the CPU, (2/k) Σ (Δs/d) ê)
    const { edge } = await import('../js/gpu/ice-sheet.js').then(m => m.iceGeometry(mesh));
    for (let c = 0; c < n; c++) {
        if (!(H[c] > 0)) continue;
        iced++;
        const g = [0, 0, 0]; let k0 = mesh.adjOffset[c], k1 = mesh.adjOffset[c + 1], m = 0;
        for (let k = k0; k < k1; k++) { const b = mesh.adjList[k]; const ds = (H[b] - H[c]) / edge[4 * k + 3]; for (let j = 0; j < 3; j++) g[j] += ds * edge[4 * k + j]; m++; }
        const slope = 2 / m * Math.hypot(...g), u = ICE.slideB * ICE.rhoIce * ICE.g * H[c] * slope;
        // (a thawed cell on a flat surface — the dome's top — doesn't slide: no stress drives it)
        const want = robinBed(Ts[c], smb[c], H[c]).thawed, got = sp0[2 * c + 1] > 0;
        if (want !== got && slope > 1e-7) wrong++;
        if (want) thawedN++;
        if (want && got) worstU = Math.max(worstU, Math.abs(sp0[2 * c + 1] - u) / (u + 1));
    }
    check('the bed thaws where Robin\'s column reaches the pressure-melting point: the GPU\'s cells are the reference\'s', wrong === 0, `${thawedN} of ${iced} ice cells thawed; ${wrong} differ`);
    check('the bed\'s speed is B₀ ρ g H |∇s| where thawed (to float32)', worstU < 1e-4, `worst relative ${worstU.toExponential(2)}`);
    ice.destroy();
    // (a dome on a thawed bed against the same on a frozen one: the thawed spreads faster; the books close)
    const runDome = async ts => {
        const s = await iceSheetGPU(device, { mesh, bed: new Float32Array(n), H, smb: new Float32Array(n), sea: -1e4 });
        if (ts !== null) s.setTsurf(new Float32Array(n).fill(ts));
        const tw = performance.now(), { steps } = await s.run(5000), h = await s.readH(), b = await s.books(), sp = await s.speeds();
        let c0 = 0; for (let c = 1; c < n; c++) if (r[c] < r[c0]) c0 = c;
        let umax = 0; for (let c = 0; c < n; c++) umax = Math.max(umax, sp[2 * c + 1]);
        s.destroy();
        return { centre: h[c0], b, steps, umax, ms: performance.now() - tw };
    };
    const frozen = await runDome(null), thawed = await runDome(-5);
    report('a thawed dome\'s centre after 5 kyr against a frozen one\'s', thawed.centre - frozen.centre, { unit: ' m', digits: 0, detail: `${thawed.centre.toFixed(0)} vs ${frozen.centre.toFixed(0)} m; fastest sliding ${thawed.umax.toFixed(0)} m/a (frozen ${frozen.umax.toFixed(0)}); ${thawed.steps} vs ${frozen.steps} steps, ${(thawed.ms / 1000).toFixed(1)} s` });
    check('a frozen bed doesn\'t slide; a thawed one does, and its dome falls faster', frozen.umax === 0 && thawed.umax > 0 && thawed.centre < frozen.centre, `${frozen.umax} / ${thawed.umax.toFixed(0)} m/a`);
    const bk = thawed.b;
    check('the books close with sliding (no balance, nothing calved, nothing made)', Math.abs(bk.volume - bk.start) < 1e-4 * bk.start && bk.made < 1e-6 * bk.start && bk.calved === 0, `${(bk.start / 1e15).toFixed(4)} → ${(bk.volume / 1e15).toFixed(4)} M km³, made ${(100 * bk.made / bk.start).toFixed(4)} %`);
}

// ── the sea's front ──
section('the sea\'s front');
{
    const mesh = terrainMesh(40000), n = mesh.numCells, x = mesh.xyz, isl = unit(-20, 60), bed = new Float32Array(n), smb = new Float32Array(n);
    for (let c = 0; c < n; c++) { const r = arcM(x, c, isl); bed[c] = r < 1000e3 ? 500 : -300; smb[c] = r < 800e3 ? 0.5 : r < 1000e3 ? -1 : 0.2; }
    const ice = await iceSheetGPU(device, { mesh, bed, smb, sea: 0 });
    await ice.run(20000);
    const h = await ice.readH(), b = await ice.books(), flt = ICE.rhoIce / ICE.rhoSea;
    const grounded = c => bed[c] >= 0 || h[c] * flt > -bed[c];
    let stray = 0, front = 0, marine = 0;
    for (let c = 0; c < n; c++) {
        if (bed[c] < 0 && h[c] > 0 && grounded(c)) marine++;
        if (h[c] > 0 && !grounded(c)) {
            let touched = false;
            for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) { const o = mesh.adjList[k]; touched ||= grounded(o) && h[o] > 0; }
            touched ? front++ : stray++;
        }
    }
    const fell = b.balance;
    check('floating ice only at the front (the open sea\'s snow calves)', stray === 0 && b.calved > 0, `${front} front cells, ${stray} stray; calved ${(b.calved / 1e12).toFixed(1)} k km³ of ${(fell / 1e12).toFixed(1)} k km³ the balance laid`);
    check('the books close: the volume = what the balance laid + what the scheme made − what calved', Math.abs(b.volume - (b.balance + b.made - b.calved)) < 1e-4 * Math.max(b.volume, 1), `${(b.volume / 1e12).toFixed(2)} vs ${((b.balance + b.made - b.calved) / 1e12).toFixed(2)} k km³; made ${(b.made / 1e12).toFixed(3)}`);
    // (E1a: the island's cliff into the sea is the steep margin an explicit step overshoots; before the limiter its clip made
    // ice from nothing, 0.8–5.7× the accumulation on the grown sheets, E0)
    check('nothing made at the steep margin: the scheme\'s overshoot under 0.1 % of what the balance laid', b.made < 1e-3 * Math.max(b.balance, 1), `made ${(b.made / 1e12).toFixed(5)} of ${(b.balance / 1e12).toFixed(1)} k km³`);
    report('the sheet grounded across the sea\'s floor (cells)', marine, { digits: 0, detail: 'no calving law at the front: it advances as its flux fills the water (ice-sheet.js limits)' });
    ice.destroy();
}
// ── a rough bed: the steep margin E0's leak lived on ──
section('a rough bed: nothing made where ice sits on a step higher than itself');
{
    // (EISMINT's dome, thawed (a −5 °C surface: it slides), on a bed as rough as the mesh allows — each cell's bed drawn at
    // random over 4 km, so a margin cell's surface can stand a bed step above its neighbour's, where an explicit step asks it
    // for H + Δbed: the overshoot that made the grown sheets' ice (E0). Before E1a's limiter this run's clip made ice equal
    // to 59 % of all the snow that fell on it, at the same 838 steps.)
    const mesh = meshes[160000], n = mesh.numCells, x = mesh.xyz, cap = unit(62, -45), bed = new Float32Array(n), smb = new Float32Array(n), H = new Float32Array(n);
    let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let c = 0; c < n; c++) { const r = arcM(x, c, cap), q = r / R0; bed[c] = r < 1500e3 ? 4000 * rnd() : -2000; smb[c] = r < 1000e3 ? 0.3 : r < 1500e3 ? -1 : 0; H[c] = q < 1 ? H0 * (1 - q ** (4 / 3)) ** (3 / 7) : 0; }
    const ice = await iceSheetGPU(device, { mesh, bed, H, smb, sea: 0 });
    ice.setTsurf(new Float32Array(n).fill(-5));
    const tw = performance.now(), { steps } = await ice.run(2000), b = await ice.books(), h = await ice.readH();
    let neg = 0; for (let c = 0; c < n; c++) if (!(h[c] >= 0)) neg++;
    check('a rough bed: nothing made (under 0.1 % of what the balance laid), no cell below zero, the books closed', b.made < 1e-3 * b.balance && neg === 0 && Math.abs(b.volume - (b.start + b.balance + b.made - b.calved)) < 1e-4 * b.volume,
        `made ${(b.made / 1e12).toFixed(4)} k km³ (${(100 * b.made / b.balance).toFixed(4)} % of the ${(b.balance / 1e12).toFixed(0)} laid; main before E1a 59 %); volume ${(b.start / 1e12).toFixed(0)} → ${(b.volume / 1e12).toFixed(0)} k km³; ${neg} cells below zero; ${steps} steps, ${((performance.now() - tw) / 1000).toFixed(1)} s`);
    ice.destroy();
}
// ── the semi-implicit step (E1b): the same answers as the explicit one at ~40× its step ──
section('the semi-implicit step (Hindmarsh & Payne 1996) against the explicit one');
{
    const SEMI = { ...ICE, scheme: 'semi', semiDtYr: 20, semiIters: 64 };
    for (const N of [160000, 640000]) {
        const mesh = meshes[N], n = mesh.numCells, x = mesh.xyz, r = new Float64Array(n), H = new Float32Array(n);
        for (let c = 0; c < n; c++) { r[c] = arcM(x, c, centre); H[c] = halfar(r[c], T0); }
        const ice = await iceSheetGPU(device, { mesh, bed: new Float32Array(n), H, smb: new Float32Array(n), sea: -1e4, P: SEMI });
        const tw = performance.now(), { steps } = await ice.run(RUN), h = await ice.readH(), b = await ice.books(), ms = performance.now() - tw;
        let c0 = 0; for (let c = 1; c < n; c++) if (r[c] < r[c0]) c0 = c;
        const t = T0 + RUN, dC = (h[c0] - halfar(r[c0], t)) / halfar(r[c0], t), ex = dome[N];
        let err = 0, cnt = 0; for (let c = 0; c < n; c++) { const e = halfar(r[c], t); if (e > 0 || h[c] > 0) { err += Math.abs(h[c] - e); cnt++; } }
        check(`${N / 1000}K: Halfar's dome at a 20 a step as good as the explicit step's (centre within 0.2 points, mean error within 10 %), its volume kept`,
            Math.abs(Math.abs(dC) - Math.abs(ex.dCentre)) < 0.002 && err / cnt < 1.1 * ex.mean && Math.abs(b.volume - b.start) < 1e-4 * b.start && b.made < 1e-6 * b.start,
            `centre ${(100 * dC).toFixed(2)} % (explicit ${(100 * ex.dCentre).toFixed(2)}), mean |error| ${(err / cnt).toFixed(1)} m (${ex.mean.toFixed(1)}); ${steps} steps against ${ex.steps}, ${(ms / 1000).toFixed(1)} s against ${(ex.ms / 1000).toFixed(1)}; CG ≤ ${b.iterations} iterations, residual ≤ ${b.residual.toExponential(1)}`);
        ice.destroy();
    }
    // (the rough bed at a 50 a step, the explicit limit's ~20×: nothing made, no cell below zero, the books closed)
    const mesh = meshes[160000], n = mesh.numCells, x = mesh.xyz, cap = unit(62, -45), bed = new Float32Array(n), smb = new Float32Array(n), H = new Float32Array(n);
    let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let c = 0; c < n; c++) { const r = arcM(x, c, cap), q = r / R0; bed[c] = r < 1500e3 ? 4000 * rnd() : -2000; smb[c] = r < 1000e3 ? 0.3 : r < 1500e3 ? -1 : 0; H[c] = q < 1 ? H0 * (1 - q ** (4 / 3)) ** (3 / 7) : 0; }
    const ice = await iceSheetGPU(device, { mesh, bed, H, smb, sea: 0, P: { ...SEMI, semiDtYr: 50 } });
    ice.setTsurf(new Float32Array(n).fill(-5));
    const { steps } = await ice.run(2000), b = await ice.books(), h = await ice.readH();
    let neg = 0; for (let c = 0; c < n; c++) if (!(h[c] >= 0)) neg++;
    check('the rough bed at a 50 a step: nothing made, no cell below zero, the books closed', b.made < 1e-3 * b.balance && neg === 0 && Math.abs(b.volume - (b.start + b.balance + b.made - b.calved)) < 1e-4 * b.volume,
        `made ${(100 * b.made / b.balance).toExponential(1)} % of the laid; volume ${(b.start / 1e12).toFixed(0)} → ${(b.volume / 1e12).toFixed(0)} k km³; ${steps} steps (${b.retries} batches run again at half the step); CG ≤ ${b.iterations}`);
    ice.destroy();
}
// ── the degree-day balance against its reference ──
section('the degree-day balance (Reeh 1991) against its CPU reference');
{
    const mesh = terrainMesh(40000), n = mesh.numCells, x = mesh.xyz, w = 360, h = 180, G = w * h, gamma = 6.5;
    const Tsl = new Float32Array(12 * G), Pm = new Float32Array(12 * G);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const a = (90 - (j + 0.5)) * Math.PI / 180, g = j * w + i;
        for (let m = 0; m < 12; m++) { Tsl[m * G + g] = 28 - 45 * Math.sin(a) ** 2 + 15 * Math.sin(a) * Math.cos(2 * Math.PI * (m - 6.5) / 12) + 3 * Math.sin(i / 17); Pm[m * G + g] = 20 + 60 * Math.cos(a) ** 2 + 10 * Math.cos(2 * Math.PI * m / 12 + i / 30); }
    }
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
    const lat = new Float32Array(n), lon = new Float32Array(n), bed = new Float32Array(n), H = new Float32Array(n), pAnn = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        lat[c] = Math.asin(x[3 * c + 2]) * 180 / Math.PI; lon[c] = Math.atan2(x[3 * c + 1], x[3 * c]) * 180 / Math.PI;
        bed[c] = -500 + 3500 * rnd(); H[c] = rnd() < 0.5 ? 0 : 2500 * rnd(); pAnn[c] = rnd() < 0.5 ? NaN : 2000 * rnd();
    }
    const sea = -50, ice = await iceSheetGPU(device, { mesh, bed, H, smb: null, sea });
    const bal = await iceBalanceGPU(device, { sheet: ice, grid: { w, h }, Tsl, P: Pm, lat, lon, pAnn, gamma, datum: sea });
    { const e = device.createCommandEncoder(); bal.encode(e); device.queue.submit([e.finish()]); }
    const got = await readBack(device, ice.force), flt = ICE.rhoIce / ICE.rhoSea, layer = new Float32Array(G);
    let worst = 0, at = -1, lo = Infinity, hi = -Infinity;
    for (let c = 0; c < n; c++) {
        const s = Math.max(bed[c] + H[c], sea + H[c] * (1 - flt)), T = [], P = [];
        for (let m = 0; m < 12; m++) {
            layer.set(Tsl.subarray(m * G, (m + 1) * G)); T.push(bilinear({ w, h }, layer, lat[c], lon[c]) - gamma * Math.max(0, s - sea) / 1000);
            layer.set(Pm.subarray(m * G, (m + 1) * G)); P.push(Math.max(0, bilinear({ w, h }, layer, lat[c], lon[c])));
        }
        const sum = P.reduce((a, b) => a + b, 0), k = pAnn[c] === pAnn[c] ? (sum > 0 ? pAnn[c] / sum : 0) : 1;
        const ref = pddBalance(T, P.map(p => p * k)) / PDD.rhoIce, d = Math.abs(got[4 * c + 1] - ref) / (Math.abs(ref) + 0.1);
        if (d > worst) { worst = d; at = c; }
        lo = Math.min(lo, ref); hi = Math.max(hi, ref);
    }
    check('the GPU\'s balance is the reference\'s, to float32 (relative to |b| + 0.1 m/a)', worst < 1e-4, `worst ${worst.toExponential(2)} at cell ${at}; balances ${lo.toFixed(2)} to ${hi.toFixed(2)} m/a of ice`);
    bal.destroy(); ice.destroy();
}
console.log(`(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(finish('ice-sheet'));
