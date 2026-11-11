// A finished moment's picture painted on the GPU (WGSL compute): finish-view.js paintFinished's work — its rasterAt
// (the picture averaged down to the texture's pixels, or enlarged by the clamped Catmull–Rom; the sea and the lakes by
// their majority), the hillshade, the palette, the lakes' flat water and the glint's sea mask — done per pixel on the
// GPU instead of the page's thread (~0.3–1 s a step at 2.5M cells and a 4096-px texture, 2026-11-11). The picture goes
// to a WebGPU canvas the page draws onto its own texture canvas (drawImage: a copy on the GPU, no readback), so the
// rivers, the grid and the towns are drawn over it as before; paintFinished on the CPU stays the fallback (no WebGPU,
// &gpu=0, a climate or People layer — their colourings, colorAt, are the CPU's) and the exports' painter (export.js).
//
// The same picture as the CPU's, to the byte where it can be (check-finish-paint.mjs holds it so):
// - Averaged down (the texture no wider than the picture): a pixel's height is its block's integer sum s; its height in
//   km — a Float32Array's f32 of s / n / 1000 — and its palette entry — Math.round over that f32, in f64 — are tables
//   over every s, made in JS (heightTable): the GPU never rounds either itself. Exact.
// - Enlarged (the 160K and 640K pictures on a wider texture): the Catmull–Rom sum in f32 where the CPU's is in f64; a
//   whole-metre sum reads the same table (exact), but another within ~1 mm of a palette entry's edge (10 m steps) can
//   take the next entry: its colour then differs by that step's (a level or two). The sea and the lakes are exact (their weights are dyadic: exact in f32).
// - The hillshade in f32 (the CPU's in f64): a channel whose light lands within ~1e-5 of a half level rounds the
//   other way — a difference of 1 on a few pixels in 10⁴ (up to 4: smooth ground repeats one light over many pixels). Unshaded palettes (Heightmap) are exact.
// - The lakes' colours and the glint: exact.

import { openDevice, storage, readBack } from './gpu-device.js';

const WG = 16;

// ── pass 1: the picture at the texture's width — each pixel's height (km, f32) and its flags: the sea (bit 0), the
// lake's kind (bits 1–2) and the palette entry before its clamping (bits 16–31, + 32768) ──
const FIELDS = /* wgsl */ `
struct P { W: u32, H: u32, rw: u32, rh: u32, K: u32, enlarge: u32, lakes: u32, sMin: i32, minM: f32, stepM: f32, pad0: u32, pad1: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> hw: array<u32>;      // the picture's heights (m), int16 pairs
@group(0) @binding(2) var<storage, read> ow: array<u32>;      // its sea (1), bytes
@group(0) @binding(3) var<storage, read> ww: array<u32>;      // its lakes' kinds, bytes (none: zeros)
@group(0) @binding(4) var<storage, read> tab: array<u32>;     // averaged down: per s − sMin, the f32 bits of the height (km) and the entry
@group(0) @binding(5) var<storage, read> gi: array<i32>;      // enlarged: the four columns of each x (4W), then the four rows' offsets of each y (4H)
@group(0) @binding(6) var<storage, read> gf: array<f32>;      // enlarged: their weights (4W, 4H), then fx (W) and fy (H)
@group(0) @binding(7) var<storage, read_write> outH: array<f32>;
@group(0) @binding(8) var<storage, read_write> outF: array<u32>;

fn hAt(i: u32) -> i32 { return bitcast<i32>(((hw[i >> 1u] >> ((i & 1u) * 16u)) & 0xFFFFu) << 16u) >> 16u; }
fn oAt(i: u32) -> u32 { return (ow[i >> 2u] >> ((i & 3u) * 8u)) & 0xFFu; }
fn wAt(i: u32) -> u32 { return (ww[i >> 2u] >> ((i & 3u) * 8u)) & 0xFFu; }

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
    let x = g.x; let y = g.y;
    if (x >= p.W || y >= p.H) { return; }
    let o = y * p.W + x;
    if (p.enlarge == 0u) {
        let K = p.K;
        var s = 0; var m = 0u; var wk = 0u; var wn = 0u;
        for (var dy = 0u; dy < K; dy++) {
            for (var dx = 0u; dx < K; dx++) {
                let i = (y * K + dy) * p.rw + x * K + dx;
                s += hAt(i); m += oAt(i);
                if (p.lakes == 1u) { let w = wAt(i); if (w != 0u) { wk = w; wn++; } }
            }
        }
        let cnt = K * K; let t = u32(s - p.sMin);
        outH[o] = bitcast<f32>(tab[2u * t]);
        var f = select(0u, 1u, 2u * m >= cnt) | (u32(bitcast<i32>(tab[2u * t + 1u]) + 32768) << 16u);
        if (p.lakes == 1u && 2u * wn >= cnt) { f |= wk << 1u; }
        outF[o] = f;
        return;
    }
    let rx = 4u * x; let ry = 4u * p.W + 4u * y;
    var s = 0.0;
    for (var j = 0u; j < 4u; j++) {
        let row = gi[ry + j];
        s += gf[ry + j] * (gf[rx] * f32(hAt(u32(row + gi[rx]))) + gf[rx + 1u] * f32(hAt(u32(row + gi[rx + 1u])))
            + gf[rx + 2u] * f32(hAt(u32(row + gi[rx + 2u]))) + gf[rx + 3u] * f32(hAt(u32(row + gi[rx + 3u]))));
    }
    // (held within the four nearest: no ringing at a cliff or a coast)
    let a = u32(gi[ry + 1u] + gi[rx + 1u]); let b = u32(gi[ry + 1u] + gi[rx + 2u]);
    let c = u32(gi[ry + 2u] + gi[rx + 1u]); let d = u32(gi[ry + 2u] + gi[rx + 2u]);
    let va = f32(hAt(a)); let vb = f32(hAt(b)); let vc = f32(hAt(c)); let vd = f32(hAt(d));
    s = min(max(max(va, vb), max(vc, vd)), max(min(min(va, vb), min(vc, vd)), s));
    let fx = gf[4u * p.W + 4u * p.H + x]; let fy = gf[5u * p.W + 4u * p.H + y];
    let wa = (1.0 - fx) * (1.0 - fy); let wb = fx * (1.0 - fy); let wc = (1.0 - fx) * fy; let wd = fx * fy;
    // (a whole metre — a flat or clamped place, often — read from the table over whole metres, as the averaged-down
    // picture's: the CPU's f32 of s / 1000 and its palette entry exactly; else in f32, Math.round being half up)
    var v = s / 1000.0;
    var jj = i32(floor((v * 1000.0 - p.minM) / p.stepM + 0.5));
    if (s == round(s) && abs(s) <= 32767.0) {
        let t = u32(i32(s) - p.sMin);
        v = bitcast<f32>(tab[2u * t]); jj = bitcast<i32>(tab[2u * t + 1u]);
    }
    outH[o] = v;
    var f = select(0u, 1u, wa * f32(oAt(a)) + wb * f32(oAt(b)) + wc * f32(oAt(c)) + wd * f32(oAt(d)) >= 0.5) | (u32(jj + 32768) << 16u);
    if (p.lakes == 1u) {
        var k = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
        k[wAt(a)] += wa; k[wAt(b)] += wb; k[wAt(c)] += wc; k[wAt(d)] += wd;
        var best = 0u;
        for (var q = 1u; q < 4u; q++) { if (k[q] > k[best]) { best = q; } }
        f |= best << 1u;
    }
    outF[o] = f;
}`;

// ── pass 2: each pixel coloured by the palette, shaded by the relief (the live terrain's light), a lake flat water ──
const COLOUR = /* wgsl */ `
struct P { W: u32, H: u32, zero: i32, top: i32, shaded: u32, lakes: u32, ex: f32, exSea: f32, den2: f32, bgra: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read> fl: array<u32>;
@group(0) @binding(3) var<storage, read> lut: array<f32>;      // the palette, rgb
@group(0) @binding(4) var<storage, read> rowDen: array<f32>;   // per row: 2 × the pixel's km × cos(latitude)
@group(0) @binding(5) var<storage, read> lake: array<u32>;     // the lakes' colours, RGBA packed, by kind
@group(0) @binding(6) var<storage, read_write> outC: array<u32>;

// (a Uint8ClampedArray's store: clamped, then rounded half to even — WGSL's round)
fn byte(v: f32) -> u32 { return u32(round(clamp(v, 0.0, 255.0))); }
// (the bytes in the canvas's order: RGBA, or BGRA where that is the device's preferred canvas format)
fn pack(r: u32, g: u32, b: u32) -> u32 { return select(r | (b << 16u), b | (r << 16u), p.bgra == 1u) | (g << 8u) | (255u << 24u); }

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
    let x = g.x; let y = g.y;
    if (x >= p.W || y >= p.H) { return; }
    let i = y * p.W + x; let f = fl[i]; let wet = (f & 1u) == 1u; let wat = (f >> 1u) & 3u;
    if (p.lakes == 1u && wat != 0u && !wet) { outC[i] = lake[wat]; return; }
    var kk = 1.0;
    if (p.shaded == 1u) {
        let up = max(i32(y) - 1, 0); let dn = min(i32(y) + 1, i32(p.H) - 1);
        let ex = select(p.ex, p.exSea, wet);
        let ge = (h[y * p.W + (x + 1u) % p.W] - h[y * p.W + (x + p.W - 1u) % p.W]) / rowDen[y];
        let gn = (h[u32(up) * p.W + x] - h[u32(dn) * p.W + x]) / p.den2;
        let px = -ex * ge; let py = -ex * gn; let len = sqrt(px * px + py * py + 1.0);
        let Lu = 0.70710678118654752;
        kk = 0.35 + 0.65 * max(0.0, (px * -0.5 + py * 0.5 + Lu) / len) / Lu;
    }
    let j = i32(f >> 16u) - 32768;
    let k3 = 3 * select(clamp(j, p.zero, p.top), clamp(j, 0, p.zero - 1), wet);
    outC[i] = pack(byte(min(255.0, lut[k3] * kk)), byte(min(255.0, lut[k3 + 1] * kk)), byte(min(255.0, lut[k3 + 2] * kk)));
}`;

// ── pass 3: the glint's mask at its own width: the sea and the lakes (not the pans) 255 ──
const GLINT = /* wgsl */ `
struct P { W: u32, H: u32, SW: u32, SH: u32, f: f32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> fl: array<u32>;
@group(0) @binding(2) var<storage, read_write> outS: array<u32>;
@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
    if (g.x >= p.SW || g.y >= p.SH) { return; }
    let i = min(p.H - 1u, u32(floor((f32(g.y) + 0.5) * p.f))) * p.W + min(p.W - 1u, u32(floor((f32(g.x) + 0.5) * p.f)));
    let f = fl[i]; let wat = (f >> 1u) & 3u;
    let v = select(0u, 255u, (f & 1u) == 1u || wat == 1u || wat == 2u);
    outS[g.y * p.SW + g.x] = v | (v << 8u) | (v << 16u) | (255u << 24u);
}`;

/** A Uint8ClampedArray's byte for a value (what the CPU's painter stores). */
const clampByte = (() => { const b = new Uint8ClampedArray(1); return v => ((b[0] = v), b[0]); })();

/**
 * Averaged down by blocks of n pixels: per block sum s (sMin…), the CPU's height — Math.fround(s / n / 1000) — and its
 * palette entry over that f32, Math.round((v × 1000 − minM) / stepM): [f32 bits, entry] pairs.
 */
export function heightTable(n, minM, stepM) {
    const sMin = -32768 * n, N = 65536 * n, t = new Uint32Array(2 * N), f = new Float32Array(1), u = new Uint32Array(f.buffer);
    for (let k = 0; k < N; k++) {
        const s = sMin + k;
        f[0] = s / n / 1000;
        t[2 * k] = u[0]; t[2 * k + 1] = Math.round((f[0] * 1000 - minM) / stepM) | 0;
    }
    return { sMin, t };
}

export class FinishPainter {
    /** A painter on its own device, or null where WebGPU is not to be had. `gpu`: navigator.gpu or Dawn's. */
    static async open(gpu) {
        if (!gpu) return null;
        try {
            const { device } = await openDevice(gpu);
            const p = new FinishPainter(device);
            await p.ready;
            return p;
        } catch (e) { console.warn(`[finish-paint] no WebGPU painter: ${e.message}`); return null; }
    }

    constructor(device) {
        this.device = device; this.lost = false;
        device.lost?.then(() => { this.lost = true; });
        const make = code => device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
        this.ready = Promise.all([make(FIELDS), make(COLOUR), make(GLINT)]).then(([a, b, c]) => { this.fields = a; this.colour = b; this.glintPipe = c; });
        this.rasters = [];            // the pictures' buffers, the two used last
        this.tables = new Map();      // heightTable's, per block size
        this.luts = new WeakMap();    // the palettes' buffers
        this.sized = null;            // the per-width buffers and canvases
    }

    /** Whether this painter does the picture asked for: a palette's (no colorAt — a climate or People layer is the CPU's). */
    can(o = {}) { return !this.lost && !o.colorAt; }

    rasterBuffers(r) {
        let e = this.rasters.find(e => e.r === r);
        if (e) { this.rasters.splice(this.rasters.indexOf(e), 1); this.rasters.unshift(e); return e; }
        const d = this.device, n = r.w * r.h;
        const pad = a => (a.byteLength % 4 ? (() => { const c = new Uint8Array(Math.ceil(a.byteLength / 4) * 4); c.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); return c; })() : a);
        e = { r, h: storage(d, pad(r.heightM)), o: storage(d, pad(r.ocean)), w: r.water ? storage(d, pad(r.water)) : storage(d, new Uint32Array(Math.ceil(n / 4))) };
        this.rasters.unshift(e);
        while (this.rasters.length > 2) { const old = this.rasters.pop(); old.h.destroy(); old.o.destroy(); old.w.destroy(); }
        return e;
    }

    tableOf(n, lut) {
        const key = `${n}|${lut.minM}|${lut.stepM}`;
        if (!this.tables.has(key)) { const { sMin, t } = heightTable(n, lut.minM, lut.stepM); this.tables.set(key, { sMin, buf: storage(this.device, t) }); }
        return this.tables.get(key);
    }

    lutOf(lut) {
        if (!this.luts.has(lut)) this.luts.set(lut, storage(this.device, lut.rgb instanceof Float32Array ? lut.rgb : new Float32Array(lut.rgb)));
        return this.luts.get(lut);
    }

    /** The buffers for a texture W wide (and a glint SW wide): made again when either changes. */
    sizedFor(W, SW) {
        const s = this.sized;
        if (s && s.W === W && s.SW === SW) return s;
        if (s) for (const b of [s.h, s.f, s.c, s.g, s.rowDen]) b.destroy();
        const d = this.device, H = W >> 1, n = W * H, SH = SW >> 1;
        const pxKm = 2 * Math.PI * 6371 / W, rowDen = new Float32Array(H);
        for (let y = 0; y < H; y++) rowDen[y] = 2 * pxKm * Math.max(0.05, Math.cos(((y + 0.5) / H - 0.5) * Math.PI));
        return (this.sized = { W, SW, h: storage(d, 4 * n), f: storage(d, 4 * n), c: storage(d, 4 * n), g: storage(d, 4 * Math.max(1, SW * SH)), rowDen: storage(d, rowDen), pxKm, enlarged: new Map() });
    }

    /** The enlarged picture's columns, rows and weights for a picture rw wide on a texture W wide (as rasterAt's). */
    enlargeOf(s, r) {
        const key = `${r.w}x${r.h}`;
        if (s.enlarged.has(key)) return s.enlarged.get(key);
        const W = s.W, H = W >> 1, k = r.w / W;
        const gi = new Int32Array(4 * W + 4 * H), gf = new Float32Array(5 * W + 5 * H);
        const weights = (t, o) => { const t2 = t * t, t3 = t2 * t; gf[o] = 0.5 * (-t3 + 2 * t2 - t); gf[o + 1] = 0.5 * (3 * t3 - 5 * t2 + 2); gf[o + 2] = 0.5 * (-3 * t3 + 4 * t2 + t); gf[o + 3] = 0.5 * (t3 - t2); };
        // (rasterAt keeps fx, fy in Float32Arrays and works out the weights from those f32s)
        const f = new Float32Array(1);
        for (let x = 0; x < W; x++) {
            const u = (x + 0.5) * k - 0.5, x0 = Math.floor(u);
            f[0] = u - x0; gf[4 * W + 4 * H + x] = f[0]; weights(f[0], 4 * x);
            for (let d = 0; d < 4; d++) gi[4 * x + d] = ((x0 - 1 + d) % r.w + r.w) % r.w;
        }
        for (let y = 0; y < H; y++) {
            const v = (y + 0.5) * k - 0.5, y0 = Math.floor(v);
            f[0] = v - y0; gf[5 * W + 4 * H + y] = f[0]; weights(f[0], 4 * W + 4 * y);
            for (let d = 0; d < 4; d++) gi[4 * W + 4 * y + d] = Math.min(r.h - 1, Math.max(0, y0 - 1 + d)) * r.w;
        }
        const e = { gi: storage(this.device, gi), gf: storage(this.device, gf) };
        for (const old of s.enlarged.values()) { old.gi.destroy(); old.gf.destroy(); }
        s.enlarged.clear(); s.enlarged.set(key, e);
        return e;
    }

    /**
     * Paint a finished picture (finish-view.js paintFinished's arguments: r, a texture W wide, the palette, and
     * {exaggeration, lakes, seaWidth}) into the painter's buffers, on the GPU: `glint` makes the sea mask too.
     * Returns the sized buffers (s.c the picture, RGBA; s.g the mask).
     */
    encode(r, W, lut, { exaggeration = 20, lakes = false, seaWidth = 0, lakeColor = null, bgra = false } = {}) {
        const d = this.device, H = W >> 1, s = this.sizedFor(W, seaWidth || 2), rb = this.rasterBuffers(r), k = r.w / W;
        const enlarge = k < 1, K = enlarge ? 1 : Math.round(k), wantLakes = lakes && !!r.water && !!lakeColor;
        const tbl = this.tableOf(enlarge ? 1 : K * K, lut), en = enlarge ? this.enlargeOf(s, r) : null;
        const u32 = (...v) => new Uint32Array(v), U = (data) => { const b = d.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); d.queue.writeBuffer(b, 0, data); return b; };
        const p1 = new ArrayBuffer(48), v1 = new DataView(p1);
        [W, H, r.w, r.h, K, enlarge ? 1 : 0, wantLakes ? 1 : 0].forEach((v, i) => v1.setUint32(4 * i, v, true));
        v1.setInt32(28, tbl.sMin, true); v1.setFloat32(32, lut.minM, true); v1.setFloat32(36, lut.stepM, true);
        const p2 = new ArrayBuffer(48), v2 = new DataView(p2);
        v2.setUint32(0, W, true); v2.setUint32(4, H, true); v2.setInt32(8, lut.zero, true); v2.setInt32(12, lut.n - 1, true);
        v2.setUint32(16, lut.shaded ? 1 : 0, true); v2.setUint32(20, wantLakes ? 1 : 0, true);
        v2.setFloat32(24, exaggeration, true); v2.setFloat32(28, exaggeration * 0.35, true); v2.setFloat32(32, 2 * s.pxKm, true); v2.setUint32(36, bgra ? 1 : 0, true);
        const lake = new Uint32Array(4);
        if (wantLakes) for (let kind = 1; kind < 4; kind++) { const c = lakeColor(lut, kind); const [R, G, B] = [0, 1, 2].map(j => clampByte(c[j])); lake[kind] = ((bgra ? B | (R << 16) : R | (B << 16)) | (G << 8) | (255 << 24)) >>> 0; }
        const placeholder = this.placeholder ??= storage(d, new Uint32Array(4));
        const u1 = U(p1), u2 = U(p2), lakeBuf = storage(d, lake), uniforms = [u1, u2, lakeBuf];
        const group = (pipe, bufs) => d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })) });
        const enc = d.createCommandEncoder(), pass = enc.beginComputePass();
        const gx = Math.ceil(W / WG), gy = Math.ceil(H / WG);
        pass.setPipeline(this.fields);
        pass.setBindGroup(0, group(this.fields, [u1, rb.h, rb.o, rb.w, tbl.buf, en ? en.gi : placeholder, en ? en.gf : placeholder, s.h, s.f]));
        pass.dispatchWorkgroups(gx, gy);
        pass.setPipeline(this.colour);
        pass.setBindGroup(0, group(this.colour, [u2, s.h, s.f, this.lutOf(lut), s.rowDen, lakeBuf, s.c]));
        pass.dispatchWorkgroups(gx, gy);
        if (seaWidth) {
            const p3 = new ArrayBuffer(32), v3 = new DataView(p3);
            v3.setUint32(0, W, true); v3.setUint32(4, H, true); v3.setUint32(8, seaWidth, true); v3.setUint32(12, seaWidth >> 1, true); v3.setFloat32(16, W / seaWidth, true);
            const u3 = U(p3); uniforms.push(u3);
            pass.setPipeline(this.glintPipe);
            pass.setBindGroup(0, group(this.glintPipe, [u3, s.f, s.g]));
            pass.dispatchWorkgroups(Math.ceil(seaWidth / WG), Math.ceil((seaWidth >> 1) / WG));
        }
        pass.end();
        return { s, enc, uniforms, H };
    }

    /** For checks: paint, and read the picture and the glint's mask back (Uint8Arrays, RGBA). */
    async paintToArrays(r, W, lut, o = {}) {
        const { s, enc, uniforms } = this.encode(r, W, lut, o);
        this.device.queue.submit([enc.finish()]);
        const rgba = new Uint8Array((await readBack(this.device, s.c, Uint8Array, 4 * W * (W >> 1))).buffer);
        const glint = o.seaWidth ? new Uint8Array((await readBack(this.device, s.g, Uint8Array, 4 * o.seaWidth * (o.seaWidth >> 1))).buffer) : null;
        for (const u of uniforms) u.destroy();
        return { rgba, glint };
    }

    /** A WebGPU canvas W wide, for the picture to be drawn from (configured for copies into it). */
    canvasOf(key, W) {
        this.canvases ??= new Map();
        let c = this.canvases.get(key);
        if (!c || c.canvas.width !== W) {
            const canvas = document.createElement('canvas');
            canvas.width = W; canvas.height = W >> 1;
            const ctx = canvas.getContext('webgpu');
            // (the device's preferred format — BGRA on most — so the browser composites it with no extra copy)
            const format = navigator.gpu.getPreferredCanvasFormat() === 'bgra8unorm' ? 'bgra8unorm' : 'rgba8unorm';
            ctx.configure({ device: this.device, format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT, alphaMode: 'opaque' });
            this.canvases.set(key, c = { canvas, ctx, bgra: format === 'bgra8unorm' });
        }
        return c;
    }

    /**
     * On the page: paint a finished picture onto texture t ({canvas, ctx, width}) — and, with seaCanvas, the glint's mask
     * onto it (seaWidth wide) — on the GPU, then drawn onto the canvases (synchronously, as the CPU's putImageData).
     */
    paint(r, t, lut, { seaCanvas = null, seaWidth = 0, exaggeration = 20, lakes = false, lakeColor = null } = {}) {
        const W = t.width, glint = !!seaCanvas, pc = this.canvasOf('picture', W);
        const { s, enc, uniforms, H } = this.encode(r, W, lut, { exaggeration, lakes, lakeColor, seaWidth: glint ? seaWidth : 0, bgra: pc.bgra });
        enc.copyBufferToTexture({ buffer: s.c, bytesPerRow: 4 * W }, { texture: pc.ctx.getCurrentTexture() }, [W, H]);
        let sc = null;
        if (glint) {
            sc = this.canvasOf('sea', seaWidth);
            enc.copyBufferToTexture({ buffer: s.g, bytesPerRow: 4 * seaWidth }, { texture: sc.ctx.getCurrentTexture() }, [seaWidth, seaWidth >> 1]);
        }
        this.device.queue.submit([enc.finish()]);
        for (const u of uniforms) u.destroy();
        t.ctx.drawImage(pc.canvas, 0, 0);
        if (sc) seaCanvas.getContext('2d').drawImage(sc.canvas, 0, 0);
    }
}
