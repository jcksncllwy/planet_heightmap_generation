// The climate per terrain cell, on the GPU (lane gpucells, 2026-11-22; gpuscan's ranked #4). Two kernels, one thread a cell,
// each a cell's twelve months in registers:
//   · cellClimateGPU — climate/core.js finishCells' work (step 5: the grid's months at each land cell's own height, its
//     relief's rain and the texture's noise; the year's temperature and rain and its Köppen class, koppen.js classifyCell)
//     and the four measures beyond Köppen (climate/cell-stats.js, one byte each), with the twelve months themselves kept
//     for the land's cover (finish-cover.js, still the CPU's: finish.js shows them to it cell by cell).
//   · waterCellsGPU — the thaw gate and the year's runoff (finish.js's: the snow kept and the liquid water by month,
//     climate/water.js snowYear; Budyko–Fu's share of it to the air, water.js fuEvaporation): each cell's rain, kept snow,
//     thawed months, potential evaporation and runoff.
// What stays on the CPU: the grid (360 × 180, filled and reduced to sea level once, core.js seaLevelGrid), every sum over
// the cells (the water ledger's books, in float64 and in cell order, as before) and the land's cover.
//
// float32 where the CPU's arithmetic is float64 (on float32 inputs: the grid, the heights, lat and lon, all Float32Array):
// a cell's month lands within ~1e-5 °C and ~1e-6 of its rain of the CPU's (tools/climate-cells-test.mjs holds the stated
// tolerances against the float64 reference). Two places a hair can tip a choice: a Köppen threshold (a class differs where
// the CPU's own margin to its boundary is that hair — the test explains each by its margin), and a month within a hair of
// 0 °C (snow or rain, thawed or not: the kept snow can step there). The stats' bytes round within a hair of a half level
// the other way (±1). Repeatable to the bit on one machine (no atomics, no reductions); across GPUs the vendor's f32
// transcendental and fused multiply-adds differ, so the finish's cache keys by app/history-key.js gpuFingerprint, which
// runs both kernels.

import { pipeline, storage, readBack, bind } from './gpu-device.js';
import { dispatch, INDEX_WGSL, WG } from './fields.js';
import { noiseWGSL, noiseTable, NOISE_TABLE } from './noise-wgsl.js';
import { CORE_DEFAULTS, seaLevelGrid, cellTexture } from '../climate/core.js';
import { KOPPEN_ID } from '../climate/koppen.js';
import { LatLonGrid } from '../climate/grid.js';

const DEG = Math.PI / 180;
const K = KOPPEN_ID;
// (C or D, then s/w/f, then a/b/c/d: classifyCell's last line as a table; C never takes d)
const CD = ['C', 'D'].flatMap(g => ['s', 'w', 'f'].flatMap(l2 => ['a', 'b', 'c', 'd'].map(l3 => K[g + l2 + l3] ?? 0)));

// (a cell's four grid corners from cornerOf's packing: the column i0 and row j0 of its upper-left; the next column wraps,
// the next row stops at the last)
const CORNERS = /* wgsl */`
fn corners(k: u32) -> vec4u {
    let i0 = k & 0xFFFFu; let j0 = k >> 16u;
    let i1 = select(i0 + 1u, 0u, i0 + 1u == p.w); let j1 = select(j0, j0 + 1u, j0 + 1u < p.h);
    return vec4u(j0 * p.w + i0, j0 * p.w + i1, j1 * p.w + i0, j1 * p.w + i1);
}`;

/**
 * A cell's place on the climate's grid (w × h, `step` ° a cell: finishCells' grid.step, finish.js's 180 / h — the same number), as finishCells, finish.js corners and bilinear take it —
 * in float64 here, so the GPU's weights are float32's rounding of the CPU's own (in f32, x up to 360 is ~3e-5 off: a
 * hundredth of a degree of the grid's gradient): into `u` at `o` the packed corner (column | row << 16), at o+1 and o+2 fx and fy's f32 bits.
 */
function cornerOf(w, h, step, lat, lon, u, f, o) {
    const x = (lon + 180) / step - 0.5, y = Math.max(0, Math.min(h - 1, (90 - lat) / step - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    u[o] = (((x0 % w) + w) % w) | (y0 << 16); f[o + 1] = x - x0; f[o + 2] = y - y0;
}

const CELLS = /* wgsl */`
struct Params {
    w: u32, h: u32, L: u32, flags: u32,
    step: f32, gamma: f32, terrainRelief: f32, rainRelief: f32,
    rainPerKm: f32, texT: f32, texP: f32, texScale: f32,
    tanDecl: array<vec4f, 3>,
}
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> cellIn: array<u32>;            // a land cell's corner (cornerOf), fx, fy, lat (°), height (km), x, y, z (f32 bits)
@group(0) @binding(2) var<storage, read> gridIn: array<f32>;            // Tsl (12·G), P (12·G), hLand (G): core.js seaLevelGrid
@group(0) @binding(3) var<storage, read> tables: array<u32>;            // the texture's noises: temperature's, rain's
@group(0) @binding(4) var<storage, read_write> outMonths: array<f32>;   // a land cell's T12 then P12
@group(0) @binding(5) var<storage, read_write> outYear: array<f32>;     // its tAnnual, pAnnual
@group(0) @binding(6) var<storage, read_write> outCls: array<u32>;      // its Köppen class, its four stats' bytes
${INDEX_WGSL}
${CORNERS}
${noiseWGSL('tables')}
const CD = array<u32, 24>(${CD.join('u, ')}u);
const BIG = 3.4e38;

// (koppen.js classifyCell, step for step)
fn classify(T: array<f32, 12>, P: array<f32, 12>) -> u32 {
    var MAT = 0.0; var MAP = 0.0; var Thot = -BIG; var Tcold = BIG; var Tmon10 = 0u; var Pdry = BIG;
    for (var m = 0u; m < 12u; m++) {
        let t = T[m]; let q = max(0.0, P[m]);
        MAT += t; MAP += q;
        if (t > Thot) { Thot = t; }
        if (t < Tcold) { Tcold = t; }
        if (t > 10.0) { Tmon10++; }
        if (q < Pdry) { Pdry = q; }
    }
    MAT /= 12.0;
    var tA = 0.0; var tB = 0.0;
    for (var k = 0u; k < 6u; k++) { tA += T[3u + k]; }
    for (var k = 0u; k < 6u; k++) { tB += T[(9u + k) % 12u]; }
    let aSummer = tA >= tB;
    var Ps = 0.0; var Psdry = BIG; var Pswet = 0.0; var Pwdry = BIG; var Pwwet = 0.0;
    for (var k = 0u; k < 6u; k++) { let q = max(0.0, P[select((9u + k) % 12u, 3u + k, aSummer)]); Ps += q; if (q < Psdry) { Psdry = q; } if (q > Pswet) { Pswet = q; } }
    for (var k = 0u; k < 6u; k++) { let q = max(0.0, P[select(3u + k, (9u + k) % 12u, aSummer)]); if (q < Pwdry) { Pwdry = q; } if (q > Pwwet) { Pwwet = q; } }
    let Pw = MAP - Ps;
    let Pth = select(select(2.0 * MAT + 14.0, 2.0 * MAT + 28.0, Ps > 0.7 * MAP), 2.0 * MAT, Pw > 0.7 * MAP);
    if (MAP < 10.0 * Pth) {
        let hot = MAT >= 18.0;
        if (MAP < 5.0 * Pth) { return select(${K.BWk}u, ${K.BWh}u, hot); }
        return select(${K.BSk}u, ${K.BSh}u, hot);
    }
    if (Tcold >= 18.0) {
        if (Pdry >= 60.0) { return ${K.Af}u; }
        return select(${K.Aw}u, ${K.Am}u, Pdry >= 100.0 - MAP / 25.0);
    }
    if (Thot <= 10.0) { return select(${K.EF}u, ${K.ET}u, Thot > 0.0); }
    let C = Tcold > 0.0;
    var s = Psdry < 40.0 && Psdry < Pwwet / 3.0;
    var w = Pwdry < Pswet / 10.0;
    if (s && w) { s = Ps <= Pw; w = !s; }
    let L2 = select(select(2u, 1u, w), 0u, s);
    let L3 = select(select(select(2u, 3u, !C && Tcold < -38.0), 1u, Tmon10 >= 4u), 0u, Thot >= 22.0);
    return CD[select(12u, 0u, C) + 4u * L2 + L3];
}

// (cell-stats.js monthlyStats with thornthwaite, and Q's bytes; Math.round is floor(x + 0.5): WGSL's round() rounds halves to even)
fn enc(v: f32) -> u32 { return u32(clamp(floor(v + 0.5) + 1.0, 1.0, 255.0)); }
fn stats(T: array<f32, 12>, P: array<f32, 12>, latDeg: f32) -> u32 {
    var tMin = BIG; var tMax = -BIG; var pSum = 0.0; var grow = 0.0; var I = 0.0;
    for (var m = 0u; m < 12u; m++) {
        let t = T[m];
        if (t < tMin) { tMin = t; }
        if (t > tMax) { tMax = t; }
        pSum += P[m];
        if (t > 10.0) { grow += 1.0; }
        if (t > 0.0) { I += pow(t / 5.0, 1.514); }
    }
    var si = 0.0;
    if (pSum > 0.0) { for (var m = 0u; m < 12u; m++) { si += abs(P[m] - pSum / 12.0); } si /= pSum; }
    let a = 6.75e-7 * I * I * I - 7.71e-5 * I * I + 1.792e-2 * I + 0.49239;
    // (the pole's own tan is ±∞, and f32's π/2 lies past it: a hair inside keeps its sign, and its days 24 h or none)
    let tl = tan(clamp(latDeg, -89.9999, 89.9999) * ${DEG});
    var pet = 0.0;
    for (var m = 0u; m < 12u; m++) {
        let t = T[m];
        if (t <= 0.0) { continue; }
        var raw = 0.0;
        if (t >= 26.5) { raw = -415.85 + 32.24 * t - 0.43 * t * t; } else if (I > 0.0) { raw = 16.0 * pow(10.0 * t / I, a); }
        let x = -tl * p.tanDecl[m / 4u][m % 4u];
        let day = select(select(24.0 * acos(x) / ${Math.PI}, 0.0, x >= 1.0), 24.0, x <= -1.0);
        pet += raw * (day / 12.0) * (30.44 / 30.0);
    }
    let aridity = select(select(0.0, 9.99, pSum > 0.0), pSum / pet, pet > 0.0);
    return enc(4.0 * (tMax - tMin)) | (enc(54.0 * (log2(max(1e-3, aridity)) * ${Math.LOG10E / Math.LOG2E} + 3.0)) << 8u)
        | (enc(20.0 * grow) << 16u) | (enc(100.0 * si) << 24u);
}

@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let r = flatIndex(id, nwg);
    if (r >= p.L) { return; }
    let o8 = 8u * r; let fx = bitcast<f32>(cellIn[o8 + 1u]); let fy = bitcast<f32>(cellIn[o8 + 2u]);
    let lat = bitcast<f32>(cellIn[o8 + 3u]); let elev = bitcast<f32>(cellIn[o8 + 4u]);
    let G = p.w * p.h; let c4 = corners(cellIn[o8]); let c00 = c4.x; let c10 = c4.y; let c01 = c4.z; let c11 = c4.w;
    let w00 = (1.0 - fx) * (1.0 - fy); let w10 = fx * (1.0 - fy); let w01 = (1.0 - fx) * fy; let w11 = fx * fy;
    let H = 24u * G;
    let hAround = w00 * gridIn[H + c00] + w10 * gridIn[H + c10] + w01 * gridIn[H + c01] + w11 * gridIn[H + c11];
    let relief = elev - hAround; let hc = hAround + p.terrainRelief * relief; let hr = hAround + p.rainRelief * relief;
    var pf = 1.0; var dt = 0.0;
    if ((p.flags & 1u) != 0u) { pf = clamp(exp(p.rainPerKm * (hr - hAround)), 0.4, 2.5); }
    if ((p.flags & 6u) != 0u) {
        let X = bitcast<f32>(cellIn[o8 + 5u]) * p.texScale; let Y = bitcast<f32>(cellIn[o8 + 6u]) * p.texScale; let Z = bitcast<f32>(cellIn[o8 + 7u]) * p.texScale;
        if ((p.flags & 2u) != 0u) { dt = p.texT * fbm3(X, Y, Z, 0u); }
        if ((p.flags & 4u) != 0u) { pf *= exp(p.texP * fbm3(X + 31.7, Y - 12.3, Z + 5.1, ${NOISE_TABLE}u)); }
    }
    var T: array<f32, 12>; var P: array<f32, 12>; var ts = 0.0; var ps = 0.0;
    for (var m = 0u; m < 12u; m++) {
        let o = m * G; let q = 12u * G + o;
        let t = w00 * gridIn[o + c00] + w10 * gridIn[o + c10] + w01 * gridIn[o + c01] + w11 * gridIn[o + c11] - p.gamma * hc + dt;
        let rain = pf * (w00 * gridIn[q + c00] + w10 * gridIn[q + c10] + w01 * gridIn[q + c01] + w11 * gridIn[q + c11]);
        T[m] = t; P[m] = rain; ts += t; ps += rain;
        outMonths[24u * r + m] = t; outMonths[24u * r + 12u + m] = rain;
    }
    outYear[2u * r] = ts / 12.0; outYear[2u * r + 1u] = ps;
    outCls[2u * r] = classify(T, P);
    outCls[2u * r + 1u] = select(0u, stats(T, P, lat), (p.flags & 8u) != 0u);
}`;

const WATER = /* wgsl */`
struct Params { w: u32, h: u32, n: u32, pad: u32, step: f32, gamma: f32, melt: f32, petMin: f32, budykoW: f32, pad1: f32, pad2: f32, pad3: f32 }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> cellIn: array<u32>;            // a cell's corner (cornerOf), fx, fy, height (km), kind (0 sea, 1 land, 2 no rain), year's rain (mm) (f32 bits)
@group(0) @binding(2) var<storage, read> gridIn: array<f32>;            // Tsl (12·G: at sea level by the grid's own land height), P (12·G), PET's year (G)
@group(0) @binding(3) var<storage, read_write> outF: array<f32>;        // a cell's liquid water, kept snow, potential evaporation, runoff (mm)
@group(0) @binding(4) var<storage, read_write> outU: array<u32>;        // its thawed months | 256 where none thaws
${INDEX_WGSL}
${CORNERS}
// (water.js fuEvaporation; past Ep = L, as L·(1 + f − f·(1 + f^−ω)^(1/ω)): f^ω overflows f32 where L is a trace of Ep)
fn fu(L: f32, Ep: f32, w: f32) -> f32 {
    if (!(L > 0.0) || !(Ep > 0.0)) { return 0.0; }
    let f = Ep / L;
    var e = 0.0;
    if (f <= 1.0) { e = L * (1.0 + f - pow(1.0 + pow(f, w), 1.0 / w)); } else { e = L * (1.0 + f - f * pow(1.0 + pow(f, -w), 1.0 / w)); }
    return min(L, max(0.0, e));
}
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg);
    if (c >= p.n) { return; }
    let o6 = 6u * c; let kind = cellIn[o6 + 4u];
    if (kind > 1u) { outF[4u * c] = 0.0; outF[4u * c + 1u] = 0.0; outF[4u * c + 2u] = 0.0; outF[4u * c + 3u] = 0.0; outU[c] = 0u; return; }
    let fx = bitcast<f32>(cellIn[o6 + 1u]); let fy = bitcast<f32>(cellIn[o6 + 2u]); let z = bitcast<f32>(cellIn[o6 + 3u]); let year = bitcast<f32>(cellIn[o6 + 5u]);
    let G = p.w * p.h; let b = corners(cellIn[o6]); let b0 = b.x; let b1 = b.y; let b2 = b.z; let b3 = b.w;
    let w0 = (1.0 - fx) * (1.0 - fy); let w1 = fx * (1.0 - fy); let w2 = (1.0 - fx) * fy; let w3 = fx * fy;
    let lift = p.gamma * select(0.0, z, kind == 1u);
    var T: array<f32, 12>; var P: array<f32, 12>; var tot = 0.0; var melt = 0.0; var thaw = 0u;
    for (var m = 0u; m < 12u; m++) {
        let o = m * G; let q = 12u * G + o;
        T[m] = gridIn[o + b0] * w0 + gridIn[o + b1] * w1 + gridIn[o + b2] * w2 + gridIn[o + b3] * w3 - lift;
        P[m] = max(0.0, gridIn[q + b0] * w0 + gridIn[q + b1] * w1 + gridIn[q + b2] * w2 + gridIn[q + b3] * w3);
        tot += P[m];
        if (T[m] >= 0.0) { melt += T[m]; thaw++; }
    }
    let pp = max(0.0, year); let k = select(0.0, pp / tot, tot > 0.0);
    for (var m = 0u; m < 12u; m++) { P[m] = select(pp / 12.0, P[m] * k, tot > 0.0); }
    // (water.js snowYear: three years from bare ground, the third's gain kept — the pack's end less its start, as the CPU
    // takes it: where the pack melts out each summer the third year repeats the second's sums from nothing, so the two are
    // equal to the bit and nothing is kept, exactly (a running gain, +snow −melt, leaves ±ε there, and finish.js's
    // iceDischarge takes every store > 0 for a glacier's source). A pack years deep that never melts out loses digits to
    // the subtraction: within the test's tolerance, relative to the cell's year)
    var snow = 0.0; var start = 0.0;
    for (var cyc = 0u; cyc < 3u; cyc++) {
        if (cyc == 2u) { start = snow; }
        for (var m = 0u; m < 12u; m++) {
            if (T[m] < 0.0) { snow += P[m]; continue; }
            snow -= min(snow, p.melt * T[m]);
        }
    }
    let gain = snow - start;
    let store = select(min(pp, max(0.0, gain)), pp, !(melt > 0.0)); let rain = pp - store;
    let A = 24u * G;
    let pet = max(p.petMin, w0 * gridIn[A + b0] + w1 * gridIn[A + b1] + w2 * gridIn[A + b2] + w3 * gridIn[A + b3]);
    let liquid = max(0.0, rain);
    outF[4u * c] = rain; outF[4u * c + 1u] = store; outF[4u * c + 2u] = pet; outF[4u * c + 3u] = liquid - fu(liquid, pet, p.budykoW);
    outU[c] = thaw | select(256u, 0u, melt > 0.0);
}`;

const pipes = new WeakMap();
function pipesOf(device) {
    if (!pipes.has(device)) pipes.set(device, Promise.all([pipeline(device, CELLS), pipeline(device, WATER)]).then(([cells, water]) => ({ cells, water })));
    return pipes.get(device);
}
function uniform(device, bytes) {
    const b = device.createBuffer({ label: 'climate-cells params', size: bytes.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, bytes);
    return b;
}
async function run(device, pipe, buffers, count) {
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bind(device, pipe, buffers)); dispatch(pass, count); pass.end();
    device.queue.submit([enc.finish()]);
}

/**
 * Step 5 on the GPU, for heights on the climate's terrain cells — the grid's climate kept (`res`: computeClimate's result,
 * or {grid, surface, months, cell: {lat, lon}} kept from it): climate/core.js finishCells' answer (koppen, tAnnual and
 * pAnnual, NaN and class 0 where `land` is 0), to float32's rounding. `want.months`: the land cells' twelve months too
 * (`cells`, their indices; `months`, 24 floats a cell: T12 then P12 — the onCell finishCells shows); `want.stats`: the four
 * measures beyond Köppen, as cell-stats.js cellStatsCollector({bytes: true}) keeps them.
 * @returns {Promise<{koppen: Uint8Array, tAnnual: Float32Array, pAnnual: Float32Array, lat, lon, cells?: Uint32Array, months?: Float32Array, stats?: Object}>}
 */
export async function cellClimateGPU(device, res, xyz, elevKm, land, options = {}, want = {}) {
    const o = { ...CORE_DEFAULTS, ...options }, { grid } = res, { lat, lon } = res.cell, n = lat.length, G = grid.size;
    let L = 0;
    for (let c = 0; c < n; c++) if (land[c]) L++;
    const cells = new Uint32Array(L), cellIn = new Uint32Array(8 * Math.max(1, L)), cf = new Float32Array(cellIn.buffer);
    for (let c = 0, r = 0; c < n; c++) {
        if (!land[c]) continue;
        const o = 8 * r;
        cells[r++] = c; cornerOf(grid.w, grid.h, grid.step, lat[c], lon[c], cellIn, cf, o);
        cf[o + 3] = lat[c]; cf[o + 4] = elevKm[c]; cf[o + 5] = xyz[3 * c]; cf[o + 6] = xyz[3 * c + 1]; cf[o + 7] = xyz[3 * c + 2];
    }
    const { Tsl, P, hLand } = seaLevelGrid(grid, res.surface, res.months, o.lapseRateCPerKm);
    const gridIn = new Float32Array(25 * G);
    gridIn.set(Tsl, 0); gridIn.set(P, 12 * G); gridIn.set(hLand, 24 * G);
    const { noiseT, noiseP, tex, texScale } = cellTexture(o), tables = new Uint32Array(2 * NOISE_TABLE);
    if (noiseT) noiseTable(noiseT, tables, 0);
    if (noiseP) noiseTable(noiseP, tables, NOISE_TABLE);
    const params = new ArrayBuffer(96), u = new Uint32Array(params), f = new Float32Array(params);
    u[0] = grid.w; u[1] = grid.h; u[2] = L;
    u[3] = (o.rainPerKm ? 1 : 0) | (noiseT ? 2 : 0) | (noiseP ? 4 : 0) | (want.stats ? 8 : 0);
    f.set([grid.step, o.lapseRateCPerKm, o.terrainRelief, o.rainRelief, o.rainPerKm || 0, tex?.tempC || 0, tex?.rain || 0, texScale], 4);
    // (cell-stats.js dayHours' declination at each month's middle — the same in every cell, so its tangent here, in float64)
    for (let m = 0; m < 12; m++) f[12 + m] = Math.tan(23.44 * DEG * Math.sin(2 * Math.PI * (15 + 30.44 * m - 81) / 365));

    const { cells: pipe } = await pipesOf(device);
    const bufs = [uniform(device, params), storage(device, cellIn), storage(device, gridIn), storage(device, tables),
        storage(device, 4 * 24 * Math.max(1, L)), storage(device, 4 * 2 * Math.max(1, L)), storage(device, 4 * 2 * Math.max(1, L))];
    await run(device, pipe, bufs, L);
    const [months, year, cls] = await Promise.all([want.months ? readBack(device, bufs[4]) : null, readBack(device, bufs[5]), readBack(device, bufs[6], Uint32Array)]);
    for (const b of bufs) b.destroy();

    const koppen = new Uint8Array(n), tAnnual = new Float32Array(n).fill(NaN), pAnnual = new Float32Array(n).fill(NaN);
    const st = want.stats ? { tRange: new Uint8Array(n), aridity: new Uint8Array(n), growing: new Uint8Array(n), rainSeason: new Uint8Array(n) } : null;
    for (let r = 0; r < L; r++) {
        const c = cells[r];
        tAnnual[c] = year[2 * r]; pAnnual[c] = year[2 * r + 1]; koppen[c] = cls[2 * r];
        if (st) { const b = cls[2 * r + 1]; st.tRange[c] = b & 255; st.aridity[c] = (b >>> 8) & 255; st.growing[c] = (b >>> 16) & 255; st.rainSeason[c] = b >>> 24; }
    }
    return { koppen, tAnnual, pAnnual, lat, lon, ...(want.months ? { cells, months: months.subarray(0, 24 * L) } : {}), ...(st ? { stats: st } : {}) };
}

/**
 * The thaw gate and the year's runoff on the GPU (finish.js, lane polar's and lane water's): each cell's year of rain
 * `pAnn` (mm; NaN: none, skipped) as the climate's twelve months share it (the grid's T at the grid's land height `hLand`,
 * raised to sea level and lowered to the cell's own — its height where `land` is 1, the sea's surface else; P by month),
 * snow in the months below freezing kept until the thawed months melt it (`meltPerC` mm a month per °C); the kept snow is
 * the store, the rest the liquid water; of that, Budyko–Fu's share (ω `budykoW`) goes to the air under the potential
 * evaporation `petG` (mm a year on the grid, at least `petMin`), the rest runs off.
 * @returns {Promise<{rain: Float32Array, store: Float32Array, frozen: Uint8Array, thaw: Uint8Array, pet: Float32Array, runoff: Float32Array, stats}>}
 *          (rain and store NaN, pet and runoff 0, where pAnn is NaN; frozen 1 where no month thaws; stats as thawedWater's: the
 *          land's kept snow, km³ of water a year, its area and the never-thawing land's, km²)
 */
export async function waterCellsGPU(device, { grid, months, hLand, petG, lat, lon, z, land, pAnn, gamma, meltPerC, petMin, budykoW }) {
    const n = lat.length, { w, h } = grid, G = w * h;
    const gridIn = new Float32Array(25 * G);
    for (let g = 0; g < G; g++) {
        const href = hLand[g] === hLand[g] ? hLand[g] : 0;
        for (let m = 0; m < 12; m++) {
            const t = months.T[m * G + g], q = months.P[m * G + g];
            if (!(t === t) || !(q === q)) throw new Error('waterCellsGPU: the climate\'s grid has a gap (NaN month): the thaw gate reads every grid cell');
            gridIn[m * G + g] = t + gamma * href; gridIn[12 * G + m * G + g] = q;
        }
    }
    gridIn.set(petG, 24 * G);
    const cellIn = new Uint32Array(6 * n), cf = new Float32Array(cellIn.buffer);
    for (let c = 0; c < n; c++) {
        const P = pAnn[c], o = 6 * c;
        cornerOf(w, h, 180 / h, lat[c], lon[c], cellIn, cf, o);
        cf[o + 3] = z[c]; cellIn[o + 4] = P === P ? (land[c] ? 1 : 0) : 2; cf[o + 5] = P === P ? P : 0;
    }
    const params = new ArrayBuffer(48), u = new Uint32Array(params), f = new Float32Array(params);
    u[0] = w; u[1] = h; u[2] = n;
    f.set([180 / h, gamma, meltPerC, petMin, budykoW], 4);
    const { water: pipe } = await pipesOf(device);
    const bufs = [uniform(device, params), storage(device, cellIn), storage(device, gridIn), storage(device, 16 * n), storage(device, 4 * n)];
    await run(device, pipe, bufs, n);
    const [F, U] = await Promise.all([readBack(device, bufs[3]), readBack(device, bufs[4], Uint32Array)]);
    for (const b of bufs) b.destroy();
    const rain = new Float32Array(n), store = new Float32Array(n), pet = new Float32Array(n), runoff = new Float32Array(n), frozen = new Uint8Array(n), thaw = new Uint8Array(n);
    // (and the land's kept snow, its area and the never-thawing land's, in float64 and in cell order: finish.js stats.snowStore)
    const cellKm2 = 4 * Math.PI * 6371 * 6371 / n;
    let keptKm3 = 0, keptKm2 = 0, frozenKm2 = 0;
    for (let c = 0; c < n; c++) {
        if (cellIn[6 * c + 4] > 1) { rain[c] = store[c] = NaN; continue; }
        rain[c] = F[4 * c]; store[c] = F[4 * c + 1]; pet[c] = F[4 * c + 2]; runoff[c] = F[4 * c + 3];
        thaw[c] = U[c] & 255; frozen[c] = U[c] >> 8;
        if (z[c] > 0) { if (store[c] > 0) { keptKm3 += store[c] * cellKm2 * 1e-6; keptKm2 += cellKm2; } if (frozen[c]) frozenKm2 += cellKm2; }
    }
    return { rain, store, frozen, thaw, pet, runoff, stats: { keptKm3: Math.round(keptKm3), keptKm2: Math.round(keptKm2), frozenKm2: Math.round(frozenKm2) } };
}

/**
 * Both kernels on a small fixed climate — a 30° grid, 256 cells, every input made of integers (no transcendental function:
 * Math's own answers are mathFingerprint's) — for app/history-key.js gpuFingerprint: f32 exp, pow, tan, acos, log2 and
 * the noise are the vendor's, so a GPU that answers them differently files its finishes apart.
 * @returns {Promise<ArrayBufferView[]>}  what they answered, to hash
 */
export async function climateCellsProbe(device) {
    const grid = new LatLonGrid(30), G = grid.size, N = 256;
    const months = { T: new Float32Array(12 * G), P: new Float32Array(12 * G) }, meanLandKm = new Float32Array(G), petG = new Float32Array(G);
    for (let g = 0; g < G; g++) {
        meanLandKm[g] = ((g * 5) % 7) * 0.3; petG[g] = (g * 13) % 900 + 100;
        for (let m = 0; m < 12; m++) { months.T[m * G + g] = ((g * 7 + m * 13) % 50) - 20; months.P[m * G + g] = (g * 11 + m * 17) % 200; }
    }
    const lat = new Float32Array(N), lon = new Float32Array(N), z = new Float32Array(N), pAnn = new Float32Array(N), xyz = new Float32Array(3 * N), land = new Uint8Array(N).fill(1);
    for (let i = 0; i < N; i++) {
        lat[i] = ((i * 37) % 1790) / 10 - 89.5; lon[i] = ((i * 53) % 3600) / 10 - 180; z[i] = ((i * 29) % 60) / 10 - 0.5; pAnn[i] = (i * 31) % 3000;
        const a = 2 * ((i * 7) % 16 + 0.5) / 16 - 1, b = 2 * ((i * 3) % 16 + 0.5) / 16 - 1, r = Math.sqrt(1 + a * a + b * b);
        xyz[3 * i] = a / r; xyz[3 * i + 1] = b / r; xyz[3 * i + 2] = 1 / r;
    }
    const res = { grid, surface: { meanLandKm }, months, cell: { lat, lon } };
    const c = await cellClimateGPU(device, res, xyz, z, land, {}, { months: true, stats: true });
    const w = await waterCellsGPU(device, { grid: { w: grid.w, h: grid.h }, months, hLand: meanLandKm, petG, lat, lon, z, land, pAnn, gamma: 6.5, meltPerC: 120, petMin: 50, budykoW: 2.6 });
    return [c.months, c.koppen, c.tAnnual, ...Object.values(c.stats), w.rain, w.store, w.pet, w.runoff, w.thaw];
}
