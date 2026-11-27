// The glacial cycle's climate as a response table (lane iceemu E2, 2026-11-27): what stands in for a climate solve at every
// kyr of a 120 kyr transient, so the grown ice can follow the cycle (finish-ice.js cycledIce) at the cost of ~10 solves.
//
// The method (reduced physics; the emulators of paleo ice-sheet models: Pollard 2010's and Berends et al. 2018's matrix
// method, Abe-Ouchi et al. 2013's lookup): the climate's monthly sea-level temperature, per grid cell and month, locally
// linear in the orbit's insolation predictors — e sin ϖ and e cos ϖ (the precession's index and its quadrature, ϖ the
// perihelion's longitude from the moving equinox) and the obliquity ε (Berger 1978: the insolation is linear in these to a
// few W/m² over the Quaternary's range) — and the CO2's forcing (a column kept for a carbon cycle: generated worlds hold it at
// the planet's own, ruled 2026-11-27, so it is not fitted today). The table is fitted to solves at epochs spread evenly over the
// last 120 kyr, on the bare bed, no grown ice; the precipitation is their mean (its orbital response was not predictable).
// The ice's own effect on the climate (its albedo, its height over the sea it lowered, the shelves it bared) is not linear in
// anything, so it comes from solves with the ice as it stands (anchors, every F.iceResolveKyr): between anchors the climate
// is the table at the epoch plus the last anchor's ice effect (the anchor less the table at its own epoch), weighted by the
// ice's volume against the anchor's (the matrix method's interpolation, one global weight). The ice's surface lapses in the
// balance kernel (gpu/ice-balance.js), so its height is the kernel's, every iceBalanceEveryYr.
// No correction against Earth (no delta or anomaly method against CRU or ICE-6G): the table is the world's own climate's, and
// its seam is the climate's code — a climate change re-fits it (the finish cache keys the finish by the code's hash).
// Limits: one global ice weight (no local matrix weights); the ice effect frozen between anchors apart from that weight; the
// orbit's response linear (check-ice-emulator holds it to ≥ 90 % of the held-out land temperature's variance); no carbon cycle.

import { orbitAt, greenhouseOf } from '../climate/planet-system.js';

/** The table's predictors at an epoch: [1, e sin ϖ, e cos ϖ, ε − 23.3°] (ϖ the perihelion's longitude, Berger 1978), and the
 *  CO2's forcing (W/m², planet-system.js greenhouseOf) when the system carries a CO2 record (the Earth replay's). */
export function orbitPredictors(system, epochKyr) {
    const o = orbitAt({ ...system, epochKyr }), w = (o.perihelionSunLonDeg - 180) * Math.PI / 180;
    const x = [1, o.eccentricity * Math.sin(w), o.eccentricity * Math.cos(w), o.obliquityDeg - 23.3];
    if (system.atmosphere?.co2) x.push(greenhouseOf({ ...system, epochKyr }));
    return x;
}

/**
 * The epochs of [toKyr, fromKyr] (each whole kyr) for the table's solves: 'even' in time (the default), or picked greedily in
 * the scaled predictors — 'maximin' (each the farthest from those picked) or 'dopt' (maximising det(XᵀX)); both run to the
 * high-eccentricity epochs (90–120 ka) and left the table extrapolating (check-ice-emulator). Deterministic.
 */
export function cornerEpochs(system, { fromKyr = 120, toKyr = 0, k = 4, method = 'even' } = {}) {
    const all = [];
    for (let t = fromKyr; t >= toKyr; t--) all.push({ t, x: orbitPredictors(system, t) });
    // (the predictors scaled to unit spread, so ε's degrees and e's hundredths count alike)
    const mu = [1, 2, 3].map(j => all.reduce((a, r) => a + r.x[j], 0) / all.length);
    const sd = [1, 2, 3].map((j, i) => Math.sqrt(all.reduce((a, r) => a + (r.x[j] - mu[i]) ** 2, 0) / all.length) || 1);
    const sx = x => [1, x[1] / sd[0], x[2] / sd[1], x[3] / sd[2]];
    if (method === 'even') {
        // (evenly in time along the cycle's path, its ends included: the table is read along the path, so the path's states
        // weigh as the run spends its time in them — the extremes of e, at 90–120 ka, are not where most of the run is)
        return Array.from({ length: k }, (_, i) => Math.round(fromKyr - i * (fromKyr - toKyr) / (k - 1)));
    }
    if (method === 'maximin') {
        // (space-filling: the epoch farthest from the cycle's mean, then each next the farthest from those picked — the
        // cycle's states covered evenly, so the linear fit is an interpolation of them, not an extrapolation from its extremes)
        const d2 = (a, b) => { const p = sx(a.x), q = sx(b.x); return (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 + (p[3] - q[3]) ** 2; };
        const centre = { x: [1, ...mu] }, pick = [all.reduce((b, r) => (d2(r, centre) > d2(b, centre) ? r : b))];
        while (pick.length < k) pick.push(all.reduce((b, r) => { const m = Math.min(...pick.map(p => d2(p, r))), mb = Math.min(...pick.map(p => d2(p, b))); return m > mb ? r : b; }));
        return pick.map(p => p.t);
    }
    const pick = [all[0]];
    const det = rows => { const P = 4, A = Array.from({ length: P }, (_, a) => Array.from({ length: P }, (_, b) => rows.reduce((s, r) => s + r[a] * r[b], 0) + (a === b ? 1e-6 : 0)));
        let d = 1; for (let i = 0; i < P; i++) { let p = i; for (let j = i + 1; j < P; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j; [A[i], A[p]] = [A[p], A[i]]; if (p !== i) d = -d; d *= A[i][i]; if (!A[i][i]) return 0; for (let j = i + 1; j < P; j++) { const f = A[j][i] / A[i][i]; for (let c = i; c < P; c++) A[j][c] -= f * A[i][c]; } } return d; };
    while (pick.length < k) {
        let best = null, bd = -Infinity;
        for (const r of all) { if (pick.includes(r)) continue; const d = det([...pick, r].map(p => sx(p.x))); if (d > bd) { bd = d; best = r; } }
        pick.push(best);
    }
    return pick.map(p => p.t);
}

/**
 * The table fitted to solves: `samples` [{ x (predictors), Tsl, P (12 G each) }]: per cell and month the least-squares plane
 * in the predictors (the default, h Infinity), or locally linear (LOESS, Cleveland & Devlin 1988: a Gaussian kernel of the
 * scaled distance, bandwidth h; null: the samples' median spacing). Either is linear in the samples, so a prediction is
 * Σ λ_s(x) y_s with λ from a 4 × 4 solve — S × N work. (On Earth, 7 solves 20 kyr apart: the plane carried 84 % of the held
 * land T signal, LOESS 73 %; the orbit's response bends with the snow's and the sea ice's edges, 0.3–0.6 K between the
 * solves — the anchors take it out, check-ice-emulator.) Precipitation's orbital response was not predictable on Earth
 * (held-out skill ~0 %): it is the samples' mean, so `P` carries only the anchors' ice effect.
 * Returns { at(x) → { Tsl, P } }.
 */
export function fitTable(samples, { h = Infinity } = {}) {
    const S = samples.length, N = samples[0].Tsl.length, K = samples[0].x.length, D = [...Array(K - 1).keys()].map(j => j + 1);
    if (S < K) throw new Error(`ice emulator: ${S} solves can't fit ${K} coefficients`);
    const mu = D.map(j => samples.reduce((a, r) => a + r.x[j], 0) / S);
    const sd = D.map((j, i) => Math.sqrt(samples.reduce((a, r) => a + (r.x[j] - mu[i]) ** 2, 0) / S) || 1);
    const sx = x => [1, ...D.map((j, i) => (x[j] - mu[i]) / sd[i])];
    const Z = samples.map(r => sx(r.x)), d2 = (p, q) => p.reduce((t, v, j) => t + (j ? (v - q[j]) ** 2 : 0), 0);
    const nn = Z.map((p, i) => Math.sqrt(Math.min(...Z.filter((_, j) => j !== i).map(q => d2(p, q))))).sort((a, b) => a - b);
    const band = h === null ? nn[nn.length >> 1] : h;
    const Pmean = new Float32Array(N); for (const r of samples) for (let i = 0; i < N; i++) Pmean[i] += r.P[i] / S;
    // (λ_s(x): the weighted least squares' prediction weights, a small ridge keeping it defined where few samples weigh)
    const lambda = x => {
        const z = sx(x), w = Z.map(q => (Number.isFinite(band) ? Math.exp(-d2(z, q) / (2 * band * band)) : 1));
        const A = Array.from({ length: K }, (_, a) => Array.from({ length: K }, (_, b) => Z.reduce((t, q, s) => t + w[s] * q[a] * q[b], 0) + (a === b && a > 0 ? 1e-6 : 0)));
        const v = invert(A).map(row => row.reduce((t, c, b) => t + c * z[b], 0));
        return Z.map((q, s) => w[s] * q.reduce((t, qa, a) => t + qa * v[a], 0));
    };
    const at = x => { const l = lambda(x), Tsl = new Float32Array(N), P = Float32Array.from(Pmean);
        for (let s = 0; s < S; s++) { const ls = l[s], y = samples[s].Tsl; for (let i = 0; i < N; i++) Tsl[i] += ls * y[i]; }
        return { Tsl, P }; };
    return { at, size: N, bandwidth: band };
}

/**
 * The climate at predictors `x` with the ice as it stands: the table's, plus the last anchor's ice effect (the anchor's solve
 * less the table at the anchor's own predictors) weighted by the ice's volume against the anchor's (Berends et al. 2018's
 * matrix interpolation, one global weight, at most F.iceWeightMax). Precipitation stays ≥ 0.
 */
export function emulate(table, x, anchor, volume, wMax = 1.5) {
    const { Tsl, P } = table.at(x);
    if (!anchor) return { Tsl, P };
    const w = anchor.volume > 0 ? Math.max(0, Math.min(wMax, volume / anchor.volume)) : 1;
    for (let i = 0; i < Tsl.length; i++) { Tsl[i] += w * anchor.dT[i]; P[i] = Math.max(0, P[i] + w * anchor.dP[i]); }
    return { Tsl, P };
}

/** An anchor from a solve with the ice as it stands: its ice effect against the table at its own predictors. */
export function anchorOf(table, x, solve, volume) {
    const t = table.at(x), dT = new Float32Array(t.Tsl.length), dP = new Float32Array(t.P.length);
    for (let i = 0; i < dT.length; i++) { dT[i] = solve.Tsl[i] - t.Tsl[i]; dP[i] = solve.P[i] - t.P[i]; }
    return { dT, dP, volume };
}

function invert(A) {
    const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let i = 0; i < n; i++) {
        let p = i; for (let j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
        [M[i], M[p]] = [M[p], M[i]];
        const d = M[i][i]; if (!d) throw new Error('ice emulator: the corners don\'t span the orbit');
        for (let c = 0; c < 2 * n; c++) M[i][c] /= d;
        for (let j = 0; j < n; j++) if (j !== i) { const f = M[j][i]; for (let c = 0; c < 2 * n; c++) M[j][c] -= f * M[i][c]; }
    }
    return M.map(r => r.slice(n));
}
