// The ice's surface mass balance on the GPU (lane iceage B2 (ii), 2026-11-25): positive degree days from the climate's own
// months, at the ice's own surface — what the sheet (gpu/ice-sheet.js) gains as snow and loses as melt, recomputed from its
// thickness as it grows, so the sheet's height feeds back on its balance inside a run (the height–mass-balance feedback).
//
// The model (Reeh 1991; Braithwaite 1995; Calov & Greve 2005 for the degree days' closed form): each month's temperature at
// sea level (the climate's grid, core.js seaLevelGrid) and its share of the year's precipitation, at the cell by the grid's
// bilinear (finish.js bilinear's); lowered to the ice's surface by the climate's lapse rate; the days of a month scattered
// about its mean by σ (PDD.sigmaK: 5 K, Reeh's), so its positive degree days are 30.4 [σ/√(2π) e^{−T²/2σ²} + T Φ(T/σ)] and the
// share of its precipitation that is snow Φ((T_snow − T)/σ). Melt eats the year's snow first at PDD.ddfSnow mm w.e. per
// degree-day, of which PDD.refreeze stays (refrozen in the firn), then the ice at PDD.ddfIce. The balance: snow − the snow's
// melt not refrozen − the ice's melt, mm w.e. a year, as m of ice (ρ_w/ρ_i).
// It is check-iceage-earth's own reference (its CPU degree-day balance, pddBalance here), the same numbers; the kernel is held
// to it by check-ice-sheet.
//
// Limits (a reduced model): the climate's months are taken as they are while the sheet runs — the grid's own feedback on the
// ice (its albedo, its height in the circulation) waits for the next climate round (B2 (iii)/(iv)); no energy balance (the
// degree-day factors stand in for the sun's share of the melt, which differs with latitude and season: van den Broeke et
// al. 2010); no change of the snowfall with the surface's temperature within a round (the elevation desert: Huybrechts 2002's
// ~7 %/K, the climate's grid has it at its own heights only); rain on the ice runs off.
//
// Determinism: one thread a cell, no reductions; erf is Abramowitz & Stegun 7.1.26 (|ε| < 1.5·10⁻⁷), the same polynomial as
// the CPU's, and exp the GPU's own.

import { pipeline } from './gpu-device.js';
import { INDEX_WGSL, dispatch } from './fields.js';

/** The degree-day model's constants (Reeh 1991; Braithwaite 1995). */
export const PDD = Object.freeze({
    sigmaK: 5,            // the days' scatter about a month's mean, K (Reeh 1991)
    snowBelowC: 1,        // precipitation falls as snow below this, °C (Reeh 1991; Ohmura et al. 1999's ~1–2 °C)
    ddfSnow: 3,           // mm w.e. per positive degree-day, snow (Braithwaite 1995: 3–5; Reeh 1991: 3)
    ddfIce: 8,            // mm w.e. per positive degree-day, ice (Braithwaite 1995: 7–8; Reeh 1991: 8)
    refreeze: 0.6,        // of the snow's melt refrozen in the firn (Reeh 1991)
    rhoIce: 910,
});

const erf = v => { const t = 1 / (1 + 0.3275911 * Math.abs(v)), y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-v * v); return v >= 0 ? y : -y; };
const Phi = v => 0.5 * (1 + erf(v / Math.SQRT2));
/** The degree days of a month whose mean is `T` °C (Calov & Greve 2005's closed form, 30.4 days). */
export const monthPdd = (T, P = PDD) => 30.4 * (P.sigmaK / Math.sqrt(2 * Math.PI) * Math.exp(-T * T / (2 * P.sigmaK ** 2)) + T * Phi(T / P.sigmaK));
/** The year's balance, mm w.e., from twelve monthly means `Tm` (°C, at the surface) and twelve precipitations `Pm` (mm): the reference. */
export function pddBalance(Tm, Pm, P = PDD) {
    let snow = 0, D = 0;
    for (let m = 0; m < 12; m++) { snow += Pm[m] * Phi((P.snowBelowC - Tm[m]) / P.sigmaK); D += monthPdd(Tm[m], P); }
    const snowMelt = Math.min(snow, P.ddfSnow * D);
    return snow - (1 - P.refreeze) * snowMelt - P.ddfIce * (D - snowMelt / P.ddfSnow);
}

const KERNEL = (w, h) => /* wgsl */`
struct U { step: f32, gamma: f32, sea: f32, flt: f32, datum: f32, sigma: f32, snowBelow: f32, ddfSnow: f32, ddfIce: f32, keep: f32, weToIce: f32, pad: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> cellIn: array<vec4u>;      // the grid's corner (x0 | y0 << 16), fx, fy, the year's precipitation mm (f32 bits; < 0: the grid's)
@group(0) @binding(2) var<storage, read> grid: array<f32>;          // T at sea level by month (12 G), then P by month (12 G), mm
@group(0) @binding(3) var<storage, read_write> force: array<vec4f>; // (bed m; written: the balance m/a of ice, the surface's year-mean °C)
@group(0) @binding(4) var<storage, read> H: array<f32>;
${INDEX_WGSL}
const W = ${w}u; const G = ${w * h}u;
fn erf_(v: f32) -> f32 {
    let t = 1.0 / (1.0 + 0.3275911 * abs(v));
    let y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-v * v);
    return select(-y, y, v >= 0.0);
}
fn Phi(v: f32) -> f32 { return 0.5 * (1.0 + erf_(v * 0.70710678)); }
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nwg: vec3u) {
    let c = flatIndex(id, nwg); if (c >= arrayLength(&H)) { return; }
    let q = cellIn[c]; let x0 = q.x & 65535u; let y0 = q.x >> 16u; let fx = bitcast<f32>(q.y); let fy = bitcast<f32>(q.z); let pAnn = bitcast<f32>(q.w);
    let x1 = select(x0 + 1u, 0u, x0 + 1u == W); let y1 = select(y0, y0 + 1u, y0 + 1u < ${h}u);
    let i00 = y0 * W + x0; let i10 = y0 * W + x1; let i01 = y1 * W + x0; let i11 = y1 * W + x1;
    let w00 = (1.0 - fx) * (1.0 - fy); let w10 = fx * (1.0 - fy); let w01 = (1.0 - fx) * fy; let w11 = fx * fy;
    // (the ice's surface: on its bed, or the freeboard where it floats; the climate's lapse from its own datum)
    let b = force[c].x; let h = H[c];
    let s = max(b + h, u.sea + h * (1.0 - u.flt));
    let drop = u.gamma * max(0.0, s - u.datum) * 0.001;
    var Tm: array<f32, 12>; var Pm: array<f32, 12>; var Psum = 0.0;
    for (var m = 0u; m < 12u; m++) {
        let o = m * G; let p = 12u * G + m * G;
        Tm[m] = w00 * grid[o + i00] + w10 * grid[o + i10] + w01 * grid[o + i01] + w11 * grid[o + i11] - drop;
        Pm[m] = max(0.0, w00 * grid[p + i00] + w10 * grid[p + i10] + w01 * grid[p + i01] + w11 * grid[p + i11]);
        Psum += Pm[m];
    }
    let scale = select(1.0, select(0.0, pAnn / Psum, Psum > 0.0), pAnn >= 0.0);
    var snow = 0.0; var D = 0.0; var Tsum = 0.0; let sg = u.sigma;
    for (var m = 0u; m < 12u; m++) {
        let T = Tm[m]; Tsum += T;
        snow += Pm[m] * scale * Phi((u.snowBelow - T) / sg);
        D += 30.4 * (sg * 0.39894228 * exp(-T * T / (2.0 * sg * sg)) + T * Phi(T / sg));
    }
    let snowMelt = min(snow, u.ddfSnow * D);
    let mb = snow - (1.0 - u.keep) * snowMelt - u.ddfIce * (D - snowMelt / u.ddfSnow);
    force[c].y = mb * u.weToIce;
    force[c].z = Tsum / 12.0;
}`;

const compiled = new Map();

/**
 * The degree-day balance for an ice sheet (gpu/ice-sheet.js iceSheetGPU's `sheet`), on its mesh: `grid` the climate's grid
 * ({w, h}); `Tsl` and `P` its months at sea level (core.js seaLevelGrid: 12 G each, °C and mm); `lat`, `lon` each cell's (°);
 * `pAnn` each cell's year of precipitation, mm (its relief's, the finish's; NaN or null: the grid's own months); `gamma` the
 * climate's lapse rate, °C/km; `datum` the level the climate's sea-level months stand at, m.
 * @returns {Promise<{ encode(e: GPUCommandEncoder): void, destroy(): void }>} encode: the balance from the ice as it stands,
 *   into the sheet's `force` — pass it as the sheet's run({ each }).
 */
export async function iceBalanceGPU(device, { sheet, grid, Tsl, P: Pmo, lat, lon, pAnn = null, gamma, datum = 0, K = PDD }) {
    const n = lat.length, { w, h } = grid, G = w * h, step = 180 / h, key = `${w}x${h}`;
    if (!compiled.has(key)) compiled.set(key, pipeline(device, KERNEL(w, h)));
    const pipe = await compiled.get(key);
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const cellIn = new Uint32Array(4 * n), cf = new Float32Array(cellIn.buffer);
    for (let c = 0; c < n; c++) {
        const x = (lon[c] + 180) / step - 0.5, y = Math.max(0, Math.min(h - 1, (90 - lat[c]) / step - 0.5)), x0 = Math.floor(x), y0 = Math.floor(y);
        cellIn[4 * c] = (((x0 % w) + w) % w) | (y0 << 16); cf[4 * c + 1] = x - x0; cf[4 * c + 2] = y - y0;
        cf[4 * c + 3] = pAnn && pAnn[c] === pAnn[c] ? pAnn[c] : -1;
    }
    const gridIn = new Float32Array(24 * G);
    gridIn.set(Tsl.subarray(0, 12 * G), 0); gridIn.set(Pmo.subarray(0, 12 * G), 12 * G);
    const cellB = device.createBuffer({ label: 'ice balance cells', size: cellIn.byteLength, usage }), gridB = device.createBuffer({ label: 'ice balance grid', size: gridIn.byteLength, usage });
    device.queue.writeBuffer(cellB, 0, cellIn); device.queue.writeBuffer(gridB, 0, gridIn);
    const uB = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const writeU = () => device.queue.writeBuffer(uB, 0, Float32Array.of(step, gamma, sheet.sea, sheet.P.rhoIce / sheet.P.rhoSea, datum, K.sigmaK, K.snowBelowC, K.ddfSnow, K.ddfIce, K.refreeze, 1 / K.rhoIce, 0));
    // (the sheet's thickness flips between two buffers each step: a bind group for each, the one current at encode time)
    const groups = new Map();
    const groupFor = Hbuf => {
        if (!groups.has(Hbuf)) groups.set(Hbuf, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [uB, cellB, gridB, sheet.force, Hbuf].map((buffer, binding) => ({ binding, resource: { buffer } })) }));
        return groups.get(Hbuf);
    };
    return {
        encode(e) { writeU(); const p = e.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, groupFor(sheet.H)); dispatch(p, n); p.end(); },
        destroy() { cellB.destroy(); gridB.destroy(); uB.destroy(); },
    };
}
