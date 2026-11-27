// The famine's years on the GPU (lane civgpu2; plans/CIV_PLAN.md §9.2): sim.js liveYears' year loop, one invocation per
// settled or herding cell, all of a step's cells at once. Each cell's years read only its own store, people and herd and
// tables shared by everyone (the step's modes, its regions' storms, its rivers' floods), so the cells are independent and
// the order they run in doesn't matter: the CPU's one pass over the cells gave the same numbers as this does in parallel.
//
// What stays on the CPU (sim.js): everything a cell's years need that is made once and kept: each cell's long-run means
// (64 draws, at its first settled step), its herd's mean stock, the regions' storms and the rivers' floods for the step
// (hashes of the year: normal() in float64, then rounded to float32 here). The kernel gets those and lives the step's
// years in float32: the year's rain, harvest, flood, herd and wild food, the store and the famine.
//
// Not bit-identical to the CPU (float64 there): exp and pow differ in their last bits, and the store's thresholds (st < 0:
// a famine; st > cap) and the flood's (q < 1, q > floodHigh) can then fall the other way. Jackson's ruling (2026-11-26):
// judged by distributions — the per-cell differences (sim.js `yearsCheck`, civ-years-check.mjs) and the runs' summaries
// (civ-ensemble.mjs), not fingerprints. A GPU repeats its own result bit for bit (no atomics, no reductions here); two
// GPUs (Metal, D3D12) can differ in the last bits of exp, so a run's cache keys the engine (civ-page.js).

import { storage, gpuWait } from '../gpu/gpu-device.js';

/** A record per cell, `REC` 32-bit words: its home cell (static tables' index), its river source's slot in the step's
 *  floods (−1: none), then float32s — what it stores at most, what it lives on (rain-fed, watered, herds, the wild:
 *  persons/km²), its long-run means, the water foods' steady share, the rain ramp's normal value and the log rain past
 *  which the ramp is full, the grazing's ceiling and its normal year, its herd's mean, and its people, store and herd now. */
export const REC = 20;
export const R = { home: 0, slot: 1, cap: 2, kR: 3, kI: 4, kH: 5, Kw: 6, mR: 7, mI: 8, mW: 9, steady: 10, rampN: 11, lnFull: 12, tl: 13, n0: 14, herdMean: 15, d: 16, st: 17, hs: 18 };

const WG = 64;
const WGSL = /* wgsl */`
struct U {
    count: u32, years: u32, p0: u32, p1: u32,
    rainMin: f32, rainFull: f32, floodHigh: f32, floodDamage: f32,
    dieOff: f32, recovery: f32, famineDeath: f32, famineMax: f32,
    nppMax: f32, kWild: f32, p2: f32, p3: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> rec: array<u32>;
@group(0) @binding(2) var<storage, read> cell: array<vec4f>;      // each home cell: annual rain, the storms' CV, its region (bits), 0
@group(0) @binding(3) var<storage, read> rainLn: array<vec4f>;    // each home cell: ln rain under the four modes' swings (climate-var.js)
@group(0) @binding(4) var<storage, read> modes: array<vec2f>;     // the step's years: the modes (aH, aL)
@group(0) @binding(5) var<storage, read> noise: array<f32>;       // the step's storms: region × year
@group(0) @binding(6) var<storage, read> flood: array<f32>;       // the step's floods (q against the usual): source slot × year
@group(0) @binding(7) var<storage, read_write> outA: array<vec4f>; // each record: its store, people, famine dead (persons/km²), herd

fn modeLn(t: vec4f, aH: f32, aL: f32) -> f32 {
    return select(-aH * t.y, aH * t.x, aH >= 0.0) + select(-aL * t.w, aL * t.z, aL >= 0.0);
}
fn ramp(a: f32, b: f32, x: f32) -> f32 { let v = clamp((x - a) / (b - a), 0.0, 1.0); return v * v * (3.0 - 2.0 * v); }
fn nppP(p: f32) -> f32 { return u.nppMax * (1.0 - exp(-0.000664 * p)); }
fn herdYear(stock: f32, g: f32) -> f32 { let s = stock - u.dieOff * max(0.0, stock - g); return s + u.recovery * s * (1.0 - s); }
fn F(o: u32) -> f32 { return bitcast<f32>(rec[o]); }

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
    let i = g.x;
    if (i >= u.count) { return; }
    let o = i * ${REC}u;
    let h = rec[o + ${R.home}u]; let slot = bitcast<i32>(rec[o + ${R.slot}u]);
    let cap = F(o + ${R.cap}u); let kR = F(o + ${R.kR}u); let kI = F(o + ${R.kI}u); let kH = F(o + ${R.kH}u); let Kw = F(o + ${R.Kw}u);
    let mR = F(o + ${R.mR}u); let mI = F(o + ${R.mI}u); let mW = F(o + ${R.mW}u); let steady = F(o + ${R.steady}u);
    let rampN = F(o + ${R.rampN}u); let lnFull = F(o + ${R.lnFull}u); let tl = F(o + ${R.tl}u); let n0 = F(o + ${R.n0}u);
    let herdMean = F(o + ${R.herdMean}u);
    let c4 = cell[h]; let P = c4.x; let cv = c4.y; let r = bitcast<u32>(c4.z); let ln4 = rainLn[h];
    var dd = F(o + ${R.d}u); var st = F(o + ${R.st}u); var hs = F(o + ${R.hs}u); var dead = 0.0;
    let grazed = kH > 0.0 || Kw > 0.0;
    for (var j = 0u; j < u.years; j++) {
        let a = modes[j];
        let lnx = modeLn(ln4, a.x, a.y) + cv * noise[r * u.years + j];
        let Py = P * exp(lnx);
        var graze = 0.0;
        if (grazed) { graze = min(tl, nppP(Py)); }
        var food = 0.0;
        if (kR > 0.0) { var y = 1.0; if (lnx < lnFull) { y = ramp(u.rainMin, u.rainFull, Py) / rampN; } food += kR * y / mR; }
        if (slot >= 0) {
            let q = flood[u32(slot) * u.years + j];
            var y = 1.0;
            if (q < 1.0) { y = q; } else if (q > u.floodHigh) { y = max(0.0, 1.0 - u.floodDamage * (q - u.floodHigh)); }
            food += kI * y / mI;
        } else { food += kI; }
        if (kH > 0.0) { hs = herdYear(hs, graze / max(1e-9, n0)); food += kH * hs / herdMean; }
        if (Kw > 0.0) { food += Kw * (steady + (1.0 - steady) * exp(2.302585093 * u.kWild * (graze - n0))) / mW; }
        st += food / max(1e-12, dd) - 1.0;
        if (st > cap) { st = cap; }
        if (st < 0.0) {
            let loss = min(u.famineMax, u.famineDeath * -st);
            dead += dd * loss; dd *= 1.0 - loss; st = 0.0;
        }
    }
    outA[i] = vec4f(st, dd, dead, hs);
}`;

/**
 * The years' kernel for one run (one world): its static tables uploaded once, buffers for up to `n` records.
 * @param ctx  civ-gpu.js civGPU()
 * @param w    the world (pAnnual), V climateVariability(w, sub) (rainCV, region, rainLn, regions), C the run's constants
 * @returns { rec: Uint32Array (and recF, its Float32Array view) to fill, `REC` words a record;
 *   run(count, modes (Float32 2·years), noise (Float32 regions·years), flood (Float32 slots·years)) → Promise<Float32Array 4·count> }
 */
export async function yearsGPU(ctx, w, V, C) {
    const { device } = ctx, n = w.mesh.numCells, Y = C.stepYears;
    const pipe = await ctx.kernel('civ-years', WGSL);
    const cell = new Float32Array(4 * n), cellU = new Uint32Array(cell.buffer);
    for (let c = 0; c < n; c++) { cell[4 * c] = w.pAnnual[c]; cell[4 * c + 1] = V.rainCV[c]; cellU[4 * c + 2] = V.region[c]; }
    const U = new ArrayBuffer(64), Uu = new Uint32Array(U), Uf = new Float32Array(U);
    Uu[1] = Y;
    Uf.set([C.rainfedMinMm, C.rainfedFullMm, C.floodHigh, C.floodDamage, C.herdDieOff, C.herdRecovery, C.famineDeath, C.famineMaxYear, C.nppMax, C.foragerSlope * 0.45], 4);
    const uni = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const recB = storage(device, 4 * REC * n), cellB = storage(device, cell), lnB = storage(device, Float32Array.from(V.rainLn));
    const modesB = storage(device, 8 * Y), noiseB = storage(device, 4 * Math.max(1, V.regions) * Y);
    let floodB = storage(device, 4 * 64 * Y), floodCap = 64;
    const outB = storage(device, 16 * n), stage = device.createBuffer({ size: 16 * n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const rec = new Uint32Array(REC * n), recF = new Float32Array(rec.buffer);
    let group = null;
    const bindAll = () => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [uni, recB, cellB, lnB, modesB, noiseB, floodB, outB].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    group = bindAll();
    const run = async (count, modes, noise, flood) => {
        if (!count) return new Float32Array(0);
        const slots = flood.length / Y;
        if (slots > floodCap) { floodB.destroy(); floodCap = 2 * slots; floodB = storage(device, 4 * floodCap * Y); group = bindAll(); }
        Uu[0] = count;
        const q = device.queue;
        q.writeBuffer(uni, 0, U);
        q.writeBuffer(recB, 0, rec.buffer, 0, 4 * REC * count);
        q.writeBuffer(modesB, 0, modes.buffer, modes.byteOffset, modes.byteLength);
        q.writeBuffer(noiseB, 0, noise.buffer, noise.byteOffset, noise.byteLength);
        if (flood.length) q.writeBuffer(floodB, 0, flood.buffer, flood.byteOffset, flood.byteLength);
        const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
        pass.setPipeline(pipe); pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(Math.ceil(count / WG));
        pass.end();
        enc.copyBufferToBuffer(outB, 0, stage, 0, 16 * count);
        q.submit([enc.finish()]);
        await gpuWait(device, stage.mapAsync(GPUMapMode.READ, 0, 16 * count), 'the famine\'s years');
        const out = new Float32Array(stage.getMappedRange(0, 16 * count).slice(0));
        stage.unmap();
        return out;
    };
    const destroy = () => { for (const b of [uni, recB, cellB, lnB, modesB, noiseB, floodB, outB, stage]) b.destroy(); };
    return { rec, recF, run, destroy };
}
