// Multigrid solver on the lat-lon climate grid for the steady (complex) problem
//
//     σ·T − D·∇²T + γ·(u·∇)T = f
//
// σ complex per cell (a damping plus i·n·ω·C for the n-th harmonic of the year), D a diffusivity on the unit sphere
// (W m⁻² K⁻¹), γ·u an advection by the winds (upwind, so the system stays diagonally dominant). Finite volumes on the
// grid; no flux through the poles. Relaxation is zonal-line Gauss–Seidel — each latitude row solved exactly as a
// periodic tridiagonal system — which removes the stiffness of the rows that crowd together near the poles; the
// multigrid V-cycle removes the slow large-scale error. DOM-free.

const R_PLANET = 6.371e6;       // m — converts winds to angular speeds

class Level {
    constructor(w, h) {
        this.w = w; this.h = h; this.n = w * h;
        const dlam = 2 * Math.PI / w, dphi = Math.PI / h;
        this.dlam = dlam; this.dphi = dphi;
        this.cos = new Float64Array(h);
        this.kxRow = new Float64Array(h); this.knRow = new Float64Array(h); this.ksRow = new Float64Array(h);
        this.rowWeight = new Float64Array(h);
        for (let j = 0; j < h; j++) {
            const phi = Math.PI / 2 - (j + 0.5) * dphi;
            this.cos[j] = Math.cos(phi);
            this.rowWeight[j] = this.cos[j];
        }
        const n = this.n;
        this.sr = new Float64Array(n); this.si = new Float64Array(n);          // σ
        this.gu = new Float64Array(n); this.gv = new Float64Array(n);          // γ·u, γ·v
        this.ay = new Float64Array(n);                                         // meridional upwind coefficient (signed)
        this.sub = new Float64Array(n); this.sup = new Float64Array(n);        // row system: T_{i−1}, T_{i+1} coefficients
        this.bdr = new Float64Array(n); this.bdi = new Float64Array(n);        // row system diagonal
        this.Tr = new Float64Array(n); this.Ti = new Float64Array(n);          // solution (coarse levels: correction)
        this.fr = new Float64Array(n); this.fi = new Float64Array(n);          // right-hand side
        this.rr = new Float64Array(n); this.ri = new Float64Array(n);          // residual
        // factorisation of each row's periodic tridiagonal system
        this.cpr = new Float64Array(n); this.cpi = new Float64Array(n);        // c_i / m_i
        this.mir = new Float64Array(n); this.mii = new Float64Array(n);        // 1 / m_i
        this.zr = new Float64Array(n); this.zi = new Float64Array(n);          // Sherman–Morrison vector
        this.rowK = new Float64Array(h * 4);                                   // β/γ (re, im), 1/den (re, im)
        this.br = new Float64Array(w); this.bi = new Float64Array(w);          // scratch: right-hand side of a row
        this.dpr = new Float64Array(w); this.dpi = new Float64Array(w);
        this.xr = new Float64Array(w); this.xi = new Float64Array(w);
    }
    setDiffusion(Dx, Dy) {
        for (let j = 0; j < this.h; j++) {
            const phi = Math.PI / 2 - (j + 0.5) * this.dphi;
            const cosN = j === 0 ? 0 : Math.cos(phi + this.dphi / 2), cosS = j === this.h - 1 ? 0 : Math.cos(phi - this.dphi / 2);
            this.kxRow[j] = Dx / (this.cos[j] * this.cos[j] * this.dlam * this.dlam);
            this.knRow[j] = Dy * cosN / (this.cos[j] * this.dphi * this.dphi);
            this.ksRow[j] = Dy * cosS / (this.cos[j] * this.dphi * this.dphi);
        }
    }
}

export class HelmholtzSolver {
    /**
     * @param {{w:number, h:number}} grid  the climate grid (coarsened while the row count stays even and ≥ 20)
     * @param {number} D   diffusivity on the unit sphere, W m⁻² K⁻¹ (north–south)
     * @param {number} [Dx] east–west diffusivity (default: D, isotropic)
     */
    constructor(grid, D, Dx = D) {
        this.levels = [new Level(grid.w, grid.h)];
        let w = grid.w, h = grid.h;
        while (h % 2 === 0 && h / 2 >= 20 && w % 2 === 0) { w /= 2; h /= 2; this.levels.push(new Level(w, h)); }
        for (const L of this.levels) L.setDiffusion(Dx, D);
    }

    /**
     * Set the operator. sr, si: σ per cell. u, v: winds (m/s, east / north) per cell, or null. gamma: the heat
     * capacity the wind carries along (J m⁻² K⁻¹).
     */
    setOperator(sr, si, u, v, gamma) {
        const L0 = this.levels[0];
        L0.sr.set(sr); L0.si.set(si);
        if (u && gamma) for (let c = 0; c < L0.n; c++) { L0.gu[c] = gamma * u[c]; L0.gv[c] = gamma * v[c]; }
        else { L0.gu.fill(0); L0.gv.fill(0); }
        for (let l = 1; l < this.levels.length; l++) {
            const F = this.levels[l - 1], C = this.levels[l];
            restrict(F, C, F.sr, C.sr); restrict(F, C, F.si, C.si);
            restrict(F, C, F.gu, C.gu); restrict(F, C, F.gv, C.gv);
        }
        for (const L of this.levels) { buildRows(L); factorRows(L); }
    }

    /**
     * Solve in place: Tr/Ti hold the initial guess and receive the solution. Stops when the residual falls below
     * tol × |f| or after maxCycles V-cycles. Returns { cycles, rel }.
     */
    solve(fr, fi, Tr, Ti, { maxCycles = 12, tol = 1e-5 } = {}) {
        const L0 = this.levels[0];
        L0.fr.set(fr); L0.fi.set(fi); L0.Tr.set(Tr); L0.Ti.set(Ti);
        let fnorm = 0;
        for (let c = 0; c < L0.n; c++) fnorm += fr[c] * fr[c] + fi[c] * fi[c];
        fnorm = Math.sqrt(fnorm) || 1;
        let cycles = 0, rel = Math.sqrt(residual(L0)) / fnorm;
        while (cycles < maxCycles && rel >= tol) {
            this.vcycle(0);
            cycles++;
            rel = Math.sqrt(residual(L0)) / fnorm;
        }
        Tr.set(L0.Tr); Ti.set(L0.Ti);
        return { cycles, rel };
    }

    /** out = A·T (for tests). */
    apply(Tr, Ti, outR, outI) {
        const L0 = this.levels[0];
        L0.Tr.set(Tr); L0.Ti.set(Ti); L0.fr.fill(0); L0.fi.fill(0);
        residual(L0);
        for (let c = 0; c < L0.n; c++) { outR[c] = -L0.rr[c]; outI[c] = -L0.ri[c]; }
    }

    vcycle(l) {
        const L = this.levels[l];
        if (l === this.levels.length - 1) {
            for (let s = 0; s < 48; s++) relax(L, s & 1);
            return;
        }
        relax(L, 0); relax(L, 1);
        residual(L);
        const C = this.levels[l + 1];
        restrict(L, C, L.rr, C.fr); restrict(L, C, L.ri, C.fi);
        C.Tr.fill(0); C.Ti.fill(0);
        this.vcycle(l + 1);
        prolongAdd(C, L);
        relax(L, 1); relax(L, 0);
    }
}

// Row system at cell (j, i):
//   bd·T_i + sub·T_{i−1} + sup·T_{i+1} = f + kn·T_north + ks·T_south + (meridional upwind)·T_upwind
function buildRows(L) {
    const { w, h } = L;
    for (let j = 0; j < h; j++) {
        const kx = L.kxRow[j], kn = L.knRow[j], ks = L.ksRow[j];
        const sx = 1 / (R_PLANET * L.cos[j] * L.dlam), sy = 1 / (R_PLANET * L.dphi);
        for (let i = 0; i < w; i++) {
            const c = j * w + i;
            const ax = L.gu[c] * sx;
            let ay = L.gv[c] * sy;
            if ((j === 0 && ay < 0) || (j === h - 1 && ay > 0)) ay = 0;       // no upwind cell beyond the pole
            L.ay[c] = ay;
            L.sub[c] = -kx - (ax > 0 ? ax : 0);
            L.sup[c] = -kx - (ax < 0 ? -ax : 0);
            L.bdr[c] = L.sr[c] + 2 * kx + kn + ks + Math.abs(ax) + Math.abs(ay);
            L.bdi[c] = L.si[c];
        }
    }
}

// Periodic tridiagonal by Sherman–Morrison (Numerical Recipes "cyclic"): γ = −b_0, bb_0 = b_0 − γ,
// bb_{n−1} = b_{n−1} − α·β/γ, with β = sub_0 (top-right corner) and α = sup_{n−1} (bottom-left corner).
function factorRows(L) {
    const { w, h } = L;
    for (let j = 0; j < h; j++) {
        const o = j * w;
        const gr = -L.bdr[o], gi = -L.bdi[o];
        const beta = L.sub[o], alpha = L.sup[o + w - 1];
        const gm = gr * gr + gi * gi;
        const abgr = alpha * beta * gr / gm, abgi = -alpha * beta * gi / gm;          // α·β/γ
        let cpPr = 0, cpPi = 0;
        for (let i = 0; i < w; i++) {
            const c = o + i;
            let br = L.bdr[c], bi = L.bdi[c];
            if (i === 0) { br -= gr; bi -= gi; }
            if (i === w - 1) { br -= abgr; bi -= abgi; }
            const a = i === 0 ? 0 : L.sub[c];
            const mr = br - a * cpPr, mi = bi - a * cpPi;
            const md = mr * mr + mi * mi;
            const imr = mr / md, imi = -mi / md;
            L.mir[c] = imr; L.mii[c] = imi;
            const cc = i === w - 1 ? 0 : L.sup[c];
            cpPr = cc * imr; cpPi = cc * imi;
            L.cpr[c] = cpPr; L.cpi[c] = cpPi;
        }
        // z = solve(u), u = [γ, 0, …, 0, α]
        L.br.fill(0); L.bi.fill(0);
        L.br[0] = gr; L.bi[0] = gi; L.br[w - 1] = alpha;
        substitute(L, o);
        L.zr.set(L.xr, o); L.zi.set(L.xi, o);
        const bgr = beta * gr / gm, bgi = -beta * gi / gm;                              // β/γ
        const zr0 = L.xr[0], zi0 = L.xi[0], zrN = L.xr[w - 1], ziN = L.xi[w - 1];
        const dr = 1 + zr0 + (bgr * zrN - bgi * ziN), di = zi0 + (bgr * ziN + bgi * zrN);
        const dd = dr * dr + di * di;
        const k = j * 4;
        L.rowK[k] = bgr; L.rowK[k + 1] = bgi; L.rowK[k + 2] = dr / dd; L.rowK[k + 3] = -di / dd;
    }
}

/** Forward / back substitution of row starting at offset o, right-hand side L.br/L.bi → L.xr/L.xi. */
function substitute(L, o) {
    const w = L.w, dpr = L.dpr, dpi = L.dpi;
    let pr = 0, pi = 0;
    for (let i = 0; i < w; i++) {
        const c = o + i;
        const a = i === 0 ? 0 : L.sub[c];
        const tr = L.br[i] - a * pr, ti = L.bi[i] - a * pi;
        pr = tr * L.mir[c] - ti * L.mii[c];
        pi = tr * L.mii[c] + ti * L.mir[c];
        dpr[i] = pr; dpi[i] = pi;
    }
    let xr = dpr[w - 1], xi = dpi[w - 1];
    L.xr[w - 1] = xr; L.xi[w - 1] = xi;
    for (let i = w - 2; i >= 0; i--) {
        const c = o + i;
        const nr = dpr[i] - (L.cpr[c] * xr - L.cpi[c] * xi);
        const ni = dpi[i] - (L.cpr[c] * xi + L.cpi[c] * xr);
        L.xr[i] = nr; L.xi[i] = ni; xr = nr; xi = ni;
    }
}

/** One zonal-line Gauss–Seidel sweep (dir 0: north → south, 1: south → north). */
function relax(L, dir) {
    const { w, h, Tr, Ti, fr, fi } = L;
    for (let jj = 0; jj < h; jj++) {
        const j = dir ? h - 1 - jj : jj, o = j * w;
        const kn = L.knRow[j], ks = L.ksRow[j];
        for (let i = 0; i < w; i++) {
            const c = o + i;
            let rr = fr[c], ri = fi[c];
            if (j > 0) { rr += kn * Tr[c - w]; ri += kn * Ti[c - w]; }
            if (j < h - 1) { rr += ks * Tr[c + w]; ri += ks * Ti[c + w]; }
            const ay = L.ay[c];
            if (ay > 0) { rr += ay * Tr[c + w]; ri += ay * Ti[c + w]; }            // northward wind: upwind is south
            else if (ay < 0) { rr -= ay * Tr[c - w]; ri -= ay * Ti[c - w]; }
            L.br[i] = rr; L.bi[i] = ri;
        }
        substitute(L, o);
        const k = j * 4, bgr = L.rowK[k], bgi = L.rowK[k + 1], idr = L.rowK[k + 2], idi = L.rowK[k + 3];
        const x0r = L.xr[0], x0i = L.xi[0], xNr = L.xr[w - 1], xNi = L.xi[w - 1];
        const nr = x0r + (bgr * xNr - bgi * xNi), ni = x0i + (bgr * xNi + bgi * xNr);
        const fr2 = nr * idr - ni * idi, fi2 = nr * idi + ni * idr;                    // fact
        for (let i = 0; i < w; i++) {
            const c = o + i;
            Tr[c] = L.xr[i] - (fr2 * L.zr[c] - fi2 * L.zi[c]);
            Ti[c] = L.xi[i] - (fr2 * L.zi[c] + fi2 * L.zr[c]);
        }
    }
}

/** r = f − A·T into L.rr/L.ri; returns |r|² (area-weighted). */
function residual(L) {
    const { w, h, Tr, Ti, fr, fi } = L;
    let s = 0;
    for (let j = 0; j < h; j++) {
        const kn = L.knRow[j], ks = L.ksRow[j], rw = L.rowWeight[j];
        for (let i = 0; i < w; i++) {
            const c = j * w + i, cw = j * w + (i === 0 ? w - 1 : i - 1), ce = j * w + (i === w - 1 ? 0 : i + 1);
            let ar = L.bdr[c] * Tr[c] - L.bdi[c] * Ti[c] + L.sub[c] * Tr[cw] + L.sup[c] * Tr[ce];
            let ai = L.bdr[c] * Ti[c] + L.bdi[c] * Tr[c] + L.sub[c] * Ti[cw] + L.sup[c] * Ti[ce];
            if (j > 0) { ar -= kn * Tr[c - w]; ai -= kn * Ti[c - w]; }
            if (j < h - 1) { ar -= ks * Tr[c + w]; ai -= ks * Ti[c + w]; }
            const ay = L.ay[c];
            if (ay > 0) { ar -= ay * Tr[c + w]; ai -= ay * Ti[c + w]; }
            else if (ay < 0) { ar += ay * Tr[c - w]; ai += ay * Ti[c - w]; }
            const r1 = fr[c] - ar, r2 = fi[c] - ai;
            L.rr[c] = r1; L.ri[c] = r2;
            s += rw * (r1 * r1 + r2 * r2);
        }
    }
    return s;
}

/** Area-weighted average of 2 × 2 fine cells → coarse cell. */
function restrict(F, C, src, dst) {
    const wf = F.w, wc = C.w;
    for (let J = 0; J < C.h; J++) {
        const j0 = 2 * J, j1 = j0 + 1, a0 = F.rowWeight[j0], a1 = F.rowWeight[j1], s = 2 * (a0 + a1);
        for (let I = 0; I < wc; I++) {
            const i0 = 2 * I;
            dst[J * wc + I] = (a0 * (src[j0 * wf + i0] + src[j0 * wf + i0 + 1]) + a1 * (src[j1 * wf + i0] + src[j1 * wf + i0 + 1])) / s;
        }
    }
}

/** Bilinear interpolation of the coarse correction onto the fine cells (cell-centred), added to the fine solution. */
function prolongAdd(C, F) {
    const wc = C.w, hc = C.h, wf = F.w;
    for (let j = 0; j < F.h; j++) {
        let Y = j / 2 - 0.25, J0 = Math.floor(Y), fy = Y - J0;
        if (J0 < 0) { J0 = 0; fy = 0; }
        if (J0 >= hc - 1) { J0 = hc - 1; fy = 0; }
        const J1 = Math.min(hc - 1, J0 + 1);
        for (let i = 0; i < wf; i++) {
            const X = i / 2 - 0.25, I0f = Math.floor(X), fx = X - I0f;
            const I0 = ((I0f % wc) + wc) % wc, I1 = I0 + 1 === wc ? 0 : I0 + 1;
            const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
            const a = J0 * wc + I0, b = J0 * wc + I1, c = J1 * wc + I0, d = J1 * wc + I1, f = j * wf + i;
            F.Tr[f] += w00 * C.Tr[a] + w10 * C.Tr[b] + w01 * C.Tr[c] + w11 * C.Tr[d];
            F.Ti[f] += w00 * C.Ti[a] + w10 * C.Ti[b] + w01 * C.Ti[c] + w11 * C.Ti[d];
        }
    }
}
