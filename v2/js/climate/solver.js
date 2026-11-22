// Multigrid solver on the lat-lon climate grid for the steady (complex) problem
//
//     σ·T − D·∇²T + γ·(u·∇)T = f
//
// σ complex per cell (a damping plus i·n·ω·C for the n-th harmonic of the year), D a diffusivity on the unit sphere
// (W m⁻² K⁻¹), γ·u an advection by the winds (upwind, so the system stays diagonally dominant). Finite volumes on the
// grid; no flux through the poles. With `conservative`, the transport is in flux form instead, γ·∇·(u T) (upwind
// face fluxes): what leaves one cell enters its neighbour, so a tracer such as water is neither made nor lost where
// the winds converge or diverge. Relaxation is zonal-line Gauss–Seidel — each latitude row solved exactly as a
// periodic tridiagonal system — which removes the stiffness of the rows that crowd together near the poles; the
// multigrid V-cycle removes the slow large-scale error. DOM-free.

const R_PLANET = 6.371e6;       // m — converts winds to angular speeds
const MIN_COARSE_ROWS = 12;     // coarsen while the next level keeps at least this many rows (a 3° grid: 60 → 30 → 15)
// The deep hierarchy (lane gpuclimate, the GPU's): halve, else third, down to a handful of rows — a 1° grid 180 → 90 → 45 →
// 15 → 5 rows, a 3° one 60 → 30 → 15 → 5 — so the coarsest level's 48 sweeps solve it all but exactly. The halving alone stops
// at 45 rows, where those sweeps leave the slow north–south modes half solved (a zebra smoother needed 296 V-cycles for the
// 1° solves of a climate there, 245 with the deep levels; the lexicographic 145 and 125)
const DEEP_MIN_ROWS = 5;
// What a solve "to convergence" asks (the GPU's, and the float64 reference it is tested against): the residual to 1e-5 of
// the forcing, with the cycles it takes. The callers' looser tolerances and cycle caps (1e-3 … 1e-4, 4–30 cycles) were the
// CPU's time budget, and they move the climate: the lexicographic solver at the callers' settings against the same solver
// to 1e-6 differed by up to 10 °C in a month at the snow and ice edges (2,780 of 777,600 cell-months by > 0.5 °C, mean
// 0.018 °C, on climate-prof's world). Converged, the smoothers agree: zebra to 1e-5 against lexicographic to 1e-6,
// max 0.04 °C, mean 5e-5 °C, no cell-month by 0.5 °C (to 1e-4: 60 cell-months by > 0.5 °C, so 1e-5 it is)
export const CONVERGED_TOL = 1e-5, CONVERGED_CYCLES = 60;
/** The factor the next coarser level takes (2, else 3 in the deep hierarchy; rows and columns both divisible), or 0: the coarsest. */
function coarsening(w, h, deep) {
    for (const r of deep ? [2, 3] : [2]) if (h % r === 0 && w % r === 0 && h / r >= (deep ? DEEP_MIN_ROWS : MIN_COARSE_ROWS)) return r;
    return 0;
}

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
        this.an = new Float64Array(n); this.as = new Float64Array(n);          // advective coefficients on T north / south (≥ 0)
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
    /** Diffusivities that vary with latitude (one value per row; interfaces take the mean of their two rows). */
    setRowDiffusion(DxRow, DyRow) {
        for (let j = 0; j < this.h; j++) {
            const phi = Math.PI / 2 - (j + 0.5) * this.dphi;
            const cosN = j === 0 ? 0 : Math.cos(phi + this.dphi / 2), cosS = j === this.h - 1 ? 0 : Math.cos(phi - this.dphi / 2);
            const dN = j === 0 ? 0 : 0.5 * (DyRow[j] + DyRow[j - 1]), dS = j === this.h - 1 ? 0 : 0.5 * (DyRow[j] + DyRow[j + 1]);
            this.kxRow[j] = DxRow[j] / (this.cos[j] * this.cos[j] * this.dlam * this.dlam);
            this.knRow[j] = dN * cosN / (this.cos[j] * this.dphi * this.dphi);
            this.ksRow[j] = dS * cosS / (this.cos[j] * this.dphi * this.dphi);
        }
    }
}

/** The solver a stage's context asks for (ctx.solver: the GPU's in the finish, gpu/climate-solver.js), else this one. */
export const solverOf = (ctx) => ctx.solver ?? ((grid, D, Dx, opts) => new HelmholtzSolver(grid, D, Dx, opts));

export const COARSEST_SWEEPS = 48;
/** A solve's tolerance and cycle cap when it is to converge (CONVERGED_TOL): the tighter tolerance, cycles enough to reach it. */
export const convergedSettings = (tol, maxCycles, to = CONVERGED_TOL) => ({ tol: Math.min(tol, to), maxCycles: Math.max(maxCycles, CONVERGED_CYCLES) });

export class HelmholtzSolver {
    /**
     * @param {{w:number, h:number}} grid  the climate grid (coarsened while the row count stays even and ≥ MIN_COARSE_ROWS)
     * @param {number} D   diffusivity on the unit sphere, W m⁻² K⁻¹ (north–south)
     * @param {number} [Dx] east–west diffusivity (default: D, isotropic)
     * @param {{conservative?: boolean, deep?: boolean, zebra?: boolean, converged?: boolean}} [opts] conservative: transport
     *   in flux form (see above); deep: the deep hierarchy; zebra: the zebra smoother (relax, below); converged: every solve
     *   to CONVERGED_TOL (or to this, a number: the reference test's control). All three are the GPU solver's (gpu/climate-solver.js), here for its float64 reference; the page's
     *   climate keeps the lexicographic smoother, the halving hierarchy and the callers' tolerances.
     */
    constructor(grid, D, Dx = D, { conservative = false, deep = false, zebra = false, converged = false } = {}) {
        this.levels = [new Level(grid.w, grid.h)];
        this.zebra = zebra; this.converged = converged;
        let w = grid.w, h = grid.h;
        for (;;) {
            const r = coarsening(w, h, deep);
            if (!r) break;
            w /= r; h /= r;
            const C = new Level(w, h); C.r = r; this.levels.push(C);
        }
        for (const L of this.levels) { L.setDiffusion(Dx, D); L.conservative = conservative; L.zebra = zebra; }
    }

    /**
     * Diffusivities per latitude row of the grid (unit sphere; east–west, north–south), replacing the constructor's.
     * Coarser levels take the mean of their two rows. Takes effect at the next setOperator.
     */
    setRowDiffusion(DxRow, DyRow) {
        let dx = Float64Array.from(DxRow), dy = Float64Array.from(DyRow);
        for (let l = 0; l < this.levels.length; l++) {
            const L = this.levels[l];
            if (l > 0) {
                const nx = new Float64Array(L.h), ny = new Float64Array(L.h);
                const r = L.r;
                for (let j = 0; j < L.h; j++) {
                    let sx = 0, sy = 0;
                    for (let q = 0; q < r; q++) { sx += dx[r * j + q]; sy += dy[r * j + q]; }
                    nx[j] = sx / r; ny[j] = sy / r;
                }
                dx = nx; dy = ny;
            }
            L.setRowDiffusion(dx, dy);
        }
    }

    /**
     * Set the operator. sr, si: σ per cell. u, v: winds (m/s, east / north) per cell, or null. gamma: the heat
     * capacity the wind carries along (J m⁻² K⁻¹).
     */
    setOperator(sr, si, u, v, gamma, faces = null) {
        const L0 = this.levels[0];
        L0.sr.set(sr); L0.si.set(si);
        if (u && gamma) for (let c = 0; c < L0.n; c++) { L0.gu[c] = gamma * u[c]; L0.gv[c] = gamma * v[c]; }
        else { L0.gu.fill(0); L0.gv.fill(0); }
        for (let l = 1; l < this.levels.length; l++) {
            const F = this.levels[l - 1], C = this.levels[l];
            restrict(F, C, F.sr, C.sr); restrict(F, C, F.si, C.si);
            restrict(F, C, F.gu, C.gu); restrict(F, C, F.gv, C.gv);
        }
        this.setFaces(faces);
        for (const L of this.levels) { buildRows(L); factorRows(L); }
        if (this.zebra) coarsestInverse(this.levels[this.levels.length - 1]);
    }

    /**
     * The share of each face's exchange — carried and mixed — that crosses it: faces.e[c] for the face between cell c
     * and its east neighbour, faces.n[c] for the face with its north neighbour (e.g. the part of the air column above
     * a mountain barrier). In flux form it scales each face's flux; in the advective form the diffusion across the
     * face and the upwind coupling through it. Coarser levels average the fine faces. null: everything crosses.
     */
    setFaces(faces) {
        for (let l = 0; l < this.levels.length; l++) {
            const L = this.levels[l];
            if (!faces) { L.faces = null; continue; }
            if (!L.faceBuf) L.faceBuf = { e: new Float64Array(L.n), n: new Float64Array(L.n) };
            const T = L.faceBuf;
            if (l === 0) { T.e.set(faces.e); T.n.set(faces.n); }
            else {
                const F = this.levels[l - 1].faceBuf, wf = this.levels[l - 1].w, r = L.r;
                for (let J = 0; J < L.h; J++) for (let I = 0; I < L.w; I++) {
                    // (the coarse cell's east face: the fine faces down its east edge; its north face: those along its top)
                    const c = J * L.w + I, e0 = r * J * wf + r * I + r - 1, n0 = r * J * wf + r * I;
                    let se = 0, sn = 0;
                    for (let q = 0; q < r; q++) { se += F.e[e0 + q * wf]; sn += F.n[n0 + q]; }
                    T.e[c] = se / r;
                    T.n[c] = sn / r;
                }
            }
            L.faces = T;
        }
    }

    /**
     * Solve in place: Tr/Ti hold the initial guess and receive the solution. Stops when the residual falls below
     * tol × |f| or after maxCycles V-cycles. Returns { cycles, rel }.
     */
    solve(fr, fi, Tr, Ti, { maxCycles = 12, tol = 1e-5 } = {}) {
        if (this.converged) ({ tol, maxCycles } = convergedSettings(tol, maxCycles, this.converged === true ? CONVERGED_TOL : this.converged));
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
            if (L.inv) { solveCoarsest(L); return; }
            for (let s = 0; s < COARSEST_SWEEPS; s++) relax(L, s & 1);
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
//   bd·T_i + sub·T_{i−1} + sup·T_{i+1} = f + (kn + an)·T_north + (ks + as)·T_south
function buildRows(L) {
    if (L.conservative) { buildRowsFlux(L); return; }
    if (L.faces) { buildRowsFaces(L); return; }
    L.foldNS = false;
    const { w, h } = L;
    for (let j = 0; j < h; j++) {
        const kx = L.kxRow[j], kn = L.knRow[j], ks = L.ksRow[j];
        const sx = 1 / (R_PLANET * L.cos[j] * L.dlam), sy = 1 / (R_PLANET * L.dphi);
        for (let i = 0; i < w; i++) {
            const c = j * w + i;
            const ax = L.gu[c] * sx;
            let ay = L.gv[c] * sy;
            if ((j === 0 && ay < 0) || (j === h - 1 && ay > 0)) ay = 0;       // no upwind cell beyond the pole
            L.an[c] = ay < 0 ? -ay : 0;                                       // southward wind: upwind is north
            L.as[c] = ay > 0 ? ay : 0;
            L.sub[c] = -kx - (ax > 0 ? ax : 0);
            L.sup[c] = -kx - (ax < 0 ? -ax : 0);
            L.bdr[c] = L.sr[c] + 2 * kx + kn + ks + Math.abs(ax) + Math.abs(ay);
            L.bdi[c] = L.si[c];
        }
    }
}

// Advective form with faces: each face's diffusion and the upwind coupling through it scaled by its open share; north /
// south diffusion folded into an, as (per face).
function buildRowsFaces(L) {
    const { w, h } = L, T = L.faces;
    L.foldNS = true;
    for (let j = 0; j < h; j++) {
        const kx = L.kxRow[j], kn = L.knRow[j], ks = L.ksRow[j];
        const sx = 1 / (R_PLANET * L.cos[j] * L.dlam), sy = 1 / (R_PLANET * L.dphi);
        for (let i = 0; i < w; i++) {
            const c = j * w + i, cw = j * w + (i === 0 ? w - 1 : i - 1);
            const fe = T.e[c], fw = T.e[cw], fn = j > 0 ? T.n[c] : 0, fs = j < h - 1 ? T.n[c + w] : 0;
            const ax = L.gu[c] * sx;
            let ay = L.gv[c] * sy;
            if ((j === 0 && ay < 0) || (j === h - 1 && ay > 0)) ay = 0;
            const axw = ax > 0 ? ax * fw : 0, axe = ax < 0 ? -ax * fe : 0, ayn = ay < 0 ? -ay * fn : 0, ays = ay > 0 ? ay * fs : 0;
            L.an[c] = kn * fn + ayn;
            L.as[c] = ks * fs + ays;
            L.sub[c] = -kx * fw - axw;
            L.sup[c] = -kx * fe - axe;
            L.bdr[c] = L.sr[c] + kx * (fe + fw) + kn * fn + ks * fs + axw + axe + ayn + ays;
            L.bdi[c] = L.si[c];
        }
    }
}

// Flux form: face winds are the means of the two cells; each face's flux carries the upwind cell's value. Outflow
// goes on the diagonal, inflow on the neighbour's coefficient; nothing crosses the poles.
function buildRowsFlux(L) {
    const { w, h } = L;
    L.foldNS = true;                                       // north / south diffusion folded into an, as (per face)
    const T = L.faces;
    for (let j = 0; j < h; j++) {
        const kx = L.kxRow[j], kn = L.knRow[j], ks = L.ksRow[j];
        const phi = Math.PI / 2 - (j + 0.5) * L.dphi;
        const cosN = j === 0 ? 0 : Math.cos(phi + L.dphi / 2), cosS = j === h - 1 ? 0 : Math.cos(phi - L.dphi / 2);
        const sx = 1 / (R_PLANET * L.cos[j] * L.dlam);
        const syN = cosN / (R_PLANET * L.cos[j] * L.dphi), syS = cosS / (R_PLANET * L.cos[j] * L.dphi);
        for (let i = 0; i < w; i++) {
            const c = j * w + i, ce = j * w + (i === w - 1 ? 0 : i + 1), cw = j * w + (i === 0 ? w - 1 : i - 1);
            // the share of each face that is open (1 without faces)
            const fe = T ? T.e[c] : 1, fw = T ? T.e[cw] : 1, fn = T && j > 0 ? T.n[c] : 1, fs = T && j < h - 1 ? T.n[c + w] : 1;
            const ue = 0.5 * (L.gu[c] + L.gu[ce]) * sx * fe, uw = 0.5 * (L.gu[c] + L.gu[cw]) * sx * fw;
            const vn = j > 0 ? 0.5 * (L.gv[c] + L.gv[c - w]) * syN * fn : 0, vs = j < h - 1 ? 0.5 * (L.gv[c] + L.gv[c + w]) * syS * fs : 0;
            const kxe = kx * fe, kxw = kx * fw, knf = kn * fn, ksf = ks * fs;
            let diag = 0;
            if (ue > 0) diag += ue;
            if (uw < 0) diag -= uw;
            if (vn > 0) diag += vn;
            if (vs < 0) diag -= vs;
            L.an[c] = knf + (vn < 0 ? -vn : 0);
            L.as[c] = ksf + (vs > 0 ? vs : 0);
            L.sub[c] = -kxw - (uw > 0 ? uw : 0);
            L.sup[c] = -kxe - (ue < 0 ? -ue : 0);
            L.bdr[c] = L.sr[c] + kxe + kxw + knf + ksf + diag;
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
    const w = L.w, dpr = L.dpr, dpi = L.dpi, sub = L.sub, br = L.br, bi = L.bi, mir = L.mir, mii = L.mii, cpr = L.cpr, cpi = L.cpi, Xr = L.xr, Xi = L.xi;
    let pr = 0, pi = 0;
    for (let i = 0; i < w; i++) {
        const c = o + i;
        const a = i === 0 ? 0 : sub[c];
        const tr = br[i] - a * pr, ti = bi[i] - a * pi;
        pr = tr * mir[c] - ti * mii[c];
        pi = tr * mii[c] + ti * mir[c];
        dpr[i] = pr; dpi[i] = pi;
    }
    let xr = dpr[w - 1], xi = dpi[w - 1];
    Xr[w - 1] = xr; Xi[w - 1] = xi;
    for (let i = w - 2; i >= 0; i--) {
        const c = o + i;
        const nr = dpr[i] - (cpr[c] * xr - cpi[c] * xi);
        const ni = dpi[i] - (cpr[c] * xi + cpi[c] * xr);
        Xr[i] = nr; Xi[i] = ni; xr = nr; xi = ni;
    }
}

/**
 * One zonal-line Gauss–Seidel sweep: each latitude row solved exactly with its neighbours' latest values — lexicographic
 * (dir 0: north → south, 1: south → north), or zebra (red–black by rows: every other row, then the rows between them;
 * dir 0: the even rows first). A zebra colour's rows read only the other colour's, so they are independent: the GPU solves
 * them all at once (gpu/climate-solver.js). Lexicographic converges in fewer cycles on the CPU (the north–south winds'
 * upwind coupling follows the sweep), zebra parallelises; converged, they agree (CONVERGED_TOL).
 */
function relax(L, dir) {
    const { h } = L;
    if (L.zebra) { for (let j = dir; j < h; j += 2) relaxRow(L, j); for (let j = 1 - dir; j < h; j += 2) relaxRow(L, j); return; }
    for (let jj = 0; jj < h; jj++) relaxRow(L, dir ? h - 1 - jj : jj);
}

/** Row j solved exactly (a periodic tridiagonal system) with its neighbours' current values. */
function relaxRow(L, j) {
    const { w, h, Tr, Ti, fr, fi } = L;
    // (the arrays held in locals: the same arithmetic, in the same order)
    const As = L.as, An = L.an, br = L.br, bi = L.bi, xr = L.xr, xi = L.xi, zr = L.zr, zi = L.zi, rowK = L.rowK;
    const o = j * w;
    const kn = L.foldNS ? 0 : L.knRow[j], ks = L.foldNS ? 0 : L.ksRow[j];
    for (let i = 0; i < w; i++) {
        const c = o + i;
        let rr = fr[c], ri = fi[c];
        if (j > 0) { rr += kn * Tr[c - w]; ri += kn * Ti[c - w]; }
        if (j < h - 1) { rr += ks * Tr[c + w]; ri += ks * Ti[c + w]; }
        const as = As[c], an = An[c];
        if (as > 0) { rr += as * Tr[c + w]; ri += as * Ti[c + w]; }
        if (an > 0) { rr += an * Tr[c - w]; ri += an * Ti[c - w]; }
        br[i] = rr; bi[i] = ri;
    }
    substitute(L, o);
    const k = j * 4, bgr = rowK[k], bgi = rowK[k + 1], idr = rowK[k + 2], idi = rowK[k + 3];
    const x0r = xr[0], x0i = xi[0], xNr = xr[w - 1], xNi = xi[w - 1];
    const nr = x0r + (bgr * xNr - bgi * xNi), ni = x0i + (bgr * xNi + bgi * xNr);
    const fr2 = nr * idr - ni * idi, fi2 = nr * idi + ni * idr;                    // fact
    for (let i = 0; i < w; i++) {
        const c = o + i;
        Tr[c] = xr[i] - (fr2 * zr[c] - fi2 * zi[c]);
        Ti[c] = xi[i] - (fr2 * zi[c] + fi2 * zr[c]);
    }
}

// The coarsest level solved exactly (with the zebra smoother — the GPU's algorithm): its operator's inverse, worked out
// once an operator in float64 (Gauss–Jordan, partial pivoting; ≤ 64 cells: the deep hierarchy's 10 × 5), applied as a
// matrix. One thread a cell on the GPU, where the 48 sweeps were one thread a row, serially: a third of each cycle.
export const DIRECT_MAXN = 64;
function coarsestInverse(L) {
    const { w, h, n } = L;
    if (n > DIRECT_MAXN || w < 3) { L.inv = null; return; }
    const M = new Float64Array(2 * n * n), inv = new Float64Array(2 * n * n);
    const put = (r, c, re, im) => { M[2 * (r * n + c)] += re; M[2 * (r * n + c) + 1] += im; };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const c = j * w + i, kn = L.foldNS ? 0 : L.knRow[j], ks = L.foldNS ? 0 : L.ksRow[j];
        put(c, c, L.bdr[c], L.bdi[c]);
        put(c, j * w + (i + w - 1) % w, L.sub[c], 0);
        put(c, j * w + (i + 1) % w, L.sup[c], 0);
        if (j > 0) put(c, c - w, -(kn + L.an[c]), 0);
        if (j < h - 1) put(c, c + w, -(ks + L.as[c]), 0);
    }
    for (let r = 0; r < n; r++) inv[2 * (r * n + r)] = 1;
    for (let k = 0; k < n; k++) {
        let p = k, best = -1;
        for (let r = k; r < n; r++) { const m = Math.hypot(M[2 * (r * n + k)], M[2 * (r * n + k) + 1]); if (m > best) { best = m; p = r; } }
        if (p !== k) for (const A of [M, inv]) for (let c = 0; c < 2 * n; c++) { const t = A[2 * k * n + c]; A[2 * k * n + c] = A[2 * p * n + c]; A[2 * p * n + c] = t; }
        const pr = M[2 * (k * n + k)], pi = M[2 * (k * n + k) + 1], pd = pr * pr + pi * pi, qr = pr / pd, qi = -pi / pd;
        for (const A of [M, inv]) for (let c = 0; c < n; c++) {
            const o = 2 * (k * n + c), ar = A[o], ai = A[o + 1];
            A[o] = ar * qr - ai * qi; A[o + 1] = ar * qi + ai * qr;
        }
        for (let r = 0; r < n; r++) {
            if (r === k) continue;
            const fr = M[2 * (r * n + k)], fi = M[2 * (r * n + k) + 1];
            if (fr === 0 && fi === 0) continue;
            for (const A of [M, inv]) for (let c = 0; c < n; c++) {
                const o = 2 * (r * n + c), q = 2 * (k * n + c);
                A[o] -= fr * A[q] - fi * A[q + 1]; A[o + 1] -= fr * A[q + 1] + fi * A[q];
            }
        }
    }
    L.inv = inv;
}
function solveCoarsest(L) {
    const { n, inv, fr, fi, Tr, Ti } = L;
    for (let r = 0; r < n; r++) {
        let sr = 0, si = 0;
        for (let c = 0; c < n; c++) { const o = 2 * (r * n + c), ar = inv[o], ai = inv[o + 1]; sr += ar * fr[c] - ai * fi[c]; si += ar * fi[c] + ai * fr[c]; }
        Tr[r] = sr; Ti[r] = si;
    }
}

/** r = f − A·T into L.rr/L.ri; returns |r|² (area-weighted). */
function residual(L) {
    const { w, h, Tr, Ti, fr, fi } = L;
    const bdr = L.bdr, bdi = L.bdi, sub = L.sub, sup = L.sup, As = L.as, An = L.an, Rr = L.rr, Ri = L.ri;
    let s = 0;
    for (let j = 0; j < h; j++) {
        const kn = L.foldNS ? 0 : L.knRow[j], ks = L.foldNS ? 0 : L.ksRow[j], rw = L.rowWeight[j];
        for (let i = 0; i < w; i++) {
            const c = j * w + i, cw = j * w + (i === 0 ? w - 1 : i - 1), ce = j * w + (i === w - 1 ? 0 : i + 1);
            let ar = bdr[c] * Tr[c] - bdi[c] * Ti[c] + sub[c] * Tr[cw] + sup[c] * Tr[ce];
            let ai = bdr[c] * Ti[c] + bdi[c] * Tr[c] + sub[c] * Ti[cw] + sup[c] * Ti[ce];
            if (j > 0) { ar -= kn * Tr[c - w]; ai -= kn * Ti[c - w]; }
            if (j < h - 1) { ar -= ks * Tr[c + w]; ai -= ks * Ti[c + w]; }
            const as = As[c], an = An[c];
            if (as > 0) { ar -= as * Tr[c + w]; ai -= as * Ti[c + w]; }
            if (an > 0) { ar -= an * Tr[c - w]; ai -= an * Ti[c - w]; }
            const r1 = fr[c] - ar, r2 = fi[c] - ai;
            Rr[c] = r1; Ri[c] = r2;
            s += rw * (r1 * r1 + r2 * r2);
        }
    }
    return s;
}

/** Area-weighted average of 2 × 2 fine cells → coarse cell. */
function restrict(F, C, src, dst) {
    const wf = F.w, wc = C.w, r = C.r;
    for (let J = 0; J < C.h; J++) {
        let aw = 0;
        for (let q = 0; q < r; q++) aw += F.rowWeight[r * J + q];
        const s = r * aw;
        for (let I = 0; I < wc; I++) {
            let acc = 0;
            for (let q = 0; q < r; q++) {
                const o = (r * J + q) * wf + r * I;
                let row = 0;
                for (let p = 0; p < r; p++) row += src[o + p];
                acc += F.rowWeight[r * J + q] * row;
            }
            dst[J * wc + I] = acc / s;
        }
    }
}

/** Bilinear interpolation of the coarse correction onto the fine cells (cell-centred), added to the fine solution. */
function prolongAdd(C, F) {
    const wc = C.w, hc = C.h, wf = F.w, FTr = F.Tr, FTi = F.Ti, CTr = C.Tr, CTi = C.Ti, r = C.r;
    // (each fine column's two coarse columns and its weight, the same for every row: worked out once per level pair)
    const key = `${wc}|${wf}`;     // (a level pair: w fixes r)
    let cols = prolongCols.get(key);
    if (!cols) {
        cols = { I0: new Int32Array(wf), I1: new Int32Array(wf), fx: new Float64Array(wf) };
        for (let i = 0; i < wf; i++) {
            const X = (i + 0.5) / r - 0.5, I0f = Math.floor(X), fx = X - I0f;
            const I0 = ((I0f % wc) + wc) % wc, I1 = I0 + 1 === wc ? 0 : I0 + 1;
            cols.I0[i] = I0; cols.I1[i] = I1; cols.fx[i] = fx;
        }
        prolongCols.set(key, cols);
    }
    const CI0 = cols.I0, CI1 = cols.I1, CFX = cols.fx;
    for (let j = 0; j < F.h; j++) {
        let Y = (j + 0.5) / r - 0.5, J0 = Math.floor(Y), fy = Y - J0;
        if (J0 < 0) { J0 = 0; fy = 0; }
        if (J0 >= hc - 1) { J0 = hc - 1; fy = 0; }
        const J1 = Math.min(hc - 1, J0 + 1);
        for (let i = 0; i < wf; i++) {
            const I0 = CI0[i], I1 = CI1[i], fx = CFX[i];
            const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
            const a = J0 * wc + I0, b = J0 * wc + I1, c = J1 * wc + I0, d = J1 * wc + I1, f = j * wf + i;
            FTr[f] += w00 * CTr[a] + w10 * CTr[b] + w01 * CTr[c] + w11 * CTr[d];
            FTi[f] += w00 * CTi[a] + w10 * CTi[b] + w01 * CTi[c] + w11 * CTi[d];
        }
    }
}
const prolongCols = new Map();
