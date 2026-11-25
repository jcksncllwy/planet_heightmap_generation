#!/usr/bin/env node
// The ice sheet's flow (gpu/ice-sheet.js, lane iceage B2 (i), 2026-11-25) against what it must do, on the GPU (Dawn in Node):
//   · Halfar's dome (Halfar 1981; Bueler et al. 2005 test B): a dome of ice on a flat bed with no mass balance spreads under
//     its own weight in a known way, H(r,t) = H₀ (t₀/t)^{1/9} [1 − ((t₀/t)^{1/18} r/R₀)^{4/3}]^{3/7} for n = 3, with
//     t₀ = (7/4)³ R₀⁴ / (18 Γ H₀⁷). EISMINT's dome (R₀ 750 km, H₀ 3 600 m, A 10⁻¹⁶: t₀ 422 a) stepped from t₀ for 20 kyr on two
//     meshes, against the exact answer: the scheme (its hexagon's faces on the jittered mesh, its explicit steps) is what this
//     measures, and its error must fall as the mesh is refined (Bueler et al.'s convergence test). Its volume is kept.
//   · The sea's front: a sheet grown on an island under a positive balance, with snow on the sea around it: floating ice only
//     at the front, the open sea's ice calved, and the books close (the volume = what fell + what the scheme made − what
//     calved).
//   · The degree-day balance (gpu/ice-balance.js) against its CPU reference (pddBalance, check-iceage-earth's), on a made-up
//     climate and a random bed and ice: the same balance to float32's rounding.
//   node v2/tools/check-ice-sheet.mjs        (needs a GPU: Dawn in Node, through check-kit)
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { check, report, section, finish } from './lib/check-kit.mjs';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { finishDevice } from '../js/gpu/finish-gpu.js';
import { iceSheetGPU, glenGamma, ICE } from '../js/gpu/ice-sheet.js';
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
for (const N of [40000, 160000]) {
    const mesh = terrainMesh(N), n = mesh.numCells, x = mesh.xyz, r = new Float64Array(n), H = new Float32Array(n);
    for (let c = 0; c < n; c++) { r[c] = arcM(x, c, centre); H[c] = halfar(r[c], T0); }
    const tw = performance.now();
    const ice = await iceSheetGPU(device, { mesh, bed: new Float32Array(n), H, smb: new Float32Array(n), sea: -1e4 });
    const { steps } = await ice.run(RUN);
    const h = await ice.readH(), b = await ice.books(), ms = performance.now() - tw;
    const t = T0 + RUN;
    let c0 = 0; for (let c = 1; c < n; c++) if (r[c] < r[c0]) c0 = c;
    let err = 0, cnt = 0, worst = 0, rIce = 0;
    for (let c = 0; c < n; c++) {
        const e = halfar(r[c], t);
        if (e > 0 || h[c] > 0) { err += Math.abs(h[c] - e); cnt++; worst = Math.max(worst, Math.abs(h[c] - e)); }
        if (h[c] > 1) rIce = Math.max(rIce, r[c]);
    }
    const dCentre = (h[c0] - halfar(r[c0], t)) / halfar(r[c0], t), rTrue = R0 * (t / T0) ** (1 / 18), edge = mesh.edgeKm * 1000;
    dome[N] = { dCentre, mean: err / cnt, worst, rIce, rTrue, edge, b, steps, ms };
    report(`${N / 1000}K (${mesh.edgeKm.toFixed(0)} km): the dome's centre after 20 kyr against Halfar's`, 100 * dCentre, { unit: ' %', digits: 2, detail: `${h[c0].toFixed(0)} m vs ${halfar(r[c0], t).toFixed(0)} m; mean |error| ${(err / cnt).toFixed(1)} m, worst ${worst.toFixed(0)} m; margin ${(rIce / 1e3).toFixed(0)} km vs ${(rTrue / 1e3).toFixed(0)} km; ${steps} steps, ${(ms / 1000).toFixed(1)} s` });
    ice.destroy();
}
{
    const a = dome[40000], z = dome[160000];
    check('the dome converges: its error falls as the mesh is refined (40K → 160K)', Math.abs(z.dCentre) < Math.abs(a.dCentre) && z.mean < a.mean, `centre ${(100 * a.dCentre).toFixed(2)} → ${(100 * z.dCentre).toFixed(2)} %, mean |error| ${a.mean.toFixed(1)} → ${z.mean.toFixed(1)} m`);
    check('160K: the dome\'s centre within 2 % of Halfar\'s and its margin within two cells', Math.abs(z.dCentre) < 0.02 && Math.abs(z.rIce - z.rTrue) < 2 * z.edge, `${(100 * z.dCentre).toFixed(2)} %; ${((z.rIce - z.rTrue) / 1e3).toFixed(0)} km (cell ${(z.edge / 1e3).toFixed(0)} km)`);
    for (const N of [40000, 160000]) {
        const { b } = dome[N];
        check(`${N / 1000}K: the dome's volume kept (no balance, nothing calved; the scheme's overshoot under 0.1 %)`, Math.abs(b.volume - b.start - b.made) < 1e-4 * b.start && b.made < 1e-3 * b.start && b.calved === 0, `${(b.start / 1e15).toFixed(4)} → ${(b.volume / 1e15).toFixed(4)} M km³, made ${(100 * b.made / b.start).toFixed(4)} %`);
    }
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
    report('the sheet grounded across the sea\'s floor (cells)', marine, { digits: 0, detail: 'no calving law at the front: it advances as its flux fills the water (ice-sheet.js limits)' });
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
        const ref = pddBalance(T, P.map(p => p * k)) / PDD.rhoIce, d = Math.abs(got[2 * c + 1] - ref) / (Math.abs(ref) + 0.1);
        if (d > worst) { worst = d; at = c; }
        lo = Math.min(lo, ref); hi = Math.max(hi, ref);
    }
    check('the GPU\'s balance is the reference\'s, to float32 (relative to |b| + 0.1 m/a)', worst < 1e-4, `worst ${worst.toExponential(2)} at cell ${at}; balances ${lo.toFixed(2)} to ${hi.toFixed(2)} m/a of ice`);
    bal.destroy(); ice.destroy();
}
console.log(`(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(finish('ice-sheet'));
