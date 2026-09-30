// The Evolution page's side of the Finish step (plans/V2_FINISH_PLAN.md): the worker that finishes a moment
// (finish/finish-worker.js) — kept between finishes, so a mesh it built is built once — and the painting of a finished
// moment, its picture of heights, onto the page's textures: coloured by the palette and shaded as the live terrain is.

export class FinishService {
    constructor() { this.worker = null; this.jobs = new Map(); this.next = 1; }

    /** Finish a moment. @returns {Promise<{raster: {w, h, heightM, ocean}, stats, ms}>} (rejects with an AbortError if cancelled) */
    finish(msg, { onStage = null, onProgress = null } = {}) {
        const w = this.start(), id = this.next++;
        return new Promise((resolve, reject) => {
            this.jobs.set(id, { resolve, reject, onStage, onProgress });
            w.postMessage({ type: 'finish', id, ...msg, delaunatorUrl: import.meta.resolve('delaunator') });
        });
    }

    /** Stop a finish under way (the worker goes, and with it the meshes it held). */
    cancel() {
        if (!this.worker) return;
        this.worker.terminate(); this.worker = null;
        for (const j of this.jobs.values()) j.reject(new DOMException('The finish was cancelled', 'AbortError'));
        this.jobs.clear();
    }

    start() {
        if (this.worker) return this.worker;
        const w = this.worker = new Worker(new URL('../finish/finish-worker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => {
            const j = this.jobs.get(data.id);
            if (!j) return;
            if (data.type === 'stage') j.onStage?.(data.stage);
            else if (data.type === 'progress') j.onProgress?.(data.share);
            else if (data.type === 'done') { this.jobs.delete(data.id); j.resolve(data); }
            else { this.jobs.delete(data.id); j.reject(new Error(data.message)); }
        };
        w.onerror = e => {
            for (const j of this.jobs.values()) j.reject(new Error(e.message || 'the finishing worker stopped (out of memory?)'));
            this.jobs.clear(); w.terminate(); if (this.worker === w) this.worker = null;
        };
        return w;
    }
}

/**
 * Paint a finished picture onto a texture ({width, image}: width × width/2): its heights averaged down (or taken) to
 * the texture's pixels, coloured by `lut` (looks.js heightLutOf — land by its height, the sea by its depth; a hollow
 * below sea level the ocean does not reach is land) and, for a shaded palette, hillshaded from the same light as the
 * live terrain (terrain-shade.js). `seaImage` (optional, RGBA of any width × width/2): 255 on the sea, for the glint.
 */
export function paintFinished(r, t, lut, { seaImage = null, seaWidth = 0, exaggeration = 20 } = {}) {
    const W = t.width, H = W >> 1, h = new Float32Array(W * H), sea = new Uint8Array(W * H), k = r.w / W;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0, m = 0, cnt = 0;
        if (k >= 1) {
            const K = Math.round(k);
            for (let dy = 0; dy < K; dy++) for (let dx = 0; dx < K; dx++) { const i = (y * K + dy) * r.w + x * K + dx; s += r.heightM[i]; m += r.ocean[i]; cnt++; }
        } else { const i = Math.min(r.h - 1, Math.floor(y * k)) * r.w + Math.min(r.w - 1, Math.floor(x * k)); s = r.heightM[i]; m = r.ocean[i]; cnt = 1; }
        h[y * W + x] = s / cnt / 1000; sea[y * W + x] = 2 * m >= cnt ? 1 : 0;
    }
    const out = t.image.data, L = lut.rgb, { minM, stepM, zero } = lut, top = lut.n - 1;
    const pxKm = 2 * Math.PI * 6371 / W, Le = -0.5, Ln = 0.5, Lu = Math.SQRT1_2;
    for (let y = 0; y < H; y++) {
        const cl = Math.max(0.05, Math.cos(((y + 0.5) / H - 0.5) * Math.PI)), up = Math.max(0, y - 1) * W, dn = Math.min(H - 1, y + 1) * W;
        for (let x = 0; x < W; x++) {
            const i = y * W + x, v = h[i], wet = sea[i];
            let kk = 1;
            if (lut.shaded) {
                const ex = wet ? exaggeration * 0.35 : exaggeration;
                const ge = (h[y * W + (x + 1) % W] - h[y * W + (x - 1 + W) % W]) / (2 * pxKm * cl), gn = (h[up + x] - h[dn + x]) / (2 * pxKm);
                const px = -ex * ge, py = -ex * gn, len = Math.sqrt(px * px + py * py + 1);
                kk = 0.35 + 0.65 * Math.max(0, (px * Le + py * Ln + Lu) / len) / Lu;
            }
            const j = Math.round((v * 1000 - minM) / stepM), k3 = 3 * (wet ? Math.max(0, Math.min(zero - 1, j)) : Math.min(top, Math.max(zero, j)));
            const o = 4 * i;
            out[o] = Math.min(255, L[k3] * kk); out[o + 1] = Math.min(255, L[k3 + 1] * kk); out[o + 2] = Math.min(255, L[k3 + 2] * kk); out[o + 3] = 255;
        }
    }
    if (seaImage) {
        const SW = seaWidth, SH = SW >> 1, f = W / SW;
        for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
            const v = sea[Math.min(H - 1, Math.floor((y + 0.5) * f)) * W + Math.min(W - 1, Math.floor((x + 0.5) * f))] ? 255 : 0, o = 4 * (y * SW + x);
            seaImage[o] = seaImage[o + 1] = seaImage[o + 2] = v; seaImage[o + 3] = 255;
        }
    }
}
