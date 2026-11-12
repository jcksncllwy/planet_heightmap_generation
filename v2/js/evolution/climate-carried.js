// What the drawn winds and currents need without a renderer: a flow's strong speed and what a current carries (warm or
// cold). Kept apart from climate-flow.js (which draws with three.js, a browser import) so climate-view.js — read by the
// Node tools too (check-finish-paint) — needs no 'three'.

const DEG = Math.PI / 180;

/** The speed a flow's arrows and particles treat as strong: its 95th percentile (over `mask` where given). */
export function strongSpeed(U, V, mask = null) {
    const s = [];
    for (let c = 0; c < U.length; c += 3) if (!mask || mask[c]) s.push(Math.hypot(U[c], V[c]));
    s.sort((a, b) => a - b);
    return s[Math.floor(0.95 * (s.length - 1))] || 1;
}

/**
 * What a current's water carries: the latitude-average sea temperature where it comes from, minus here (°C) — the
 * climate's own warm-or-cold measure (climate/ocean.js `carried`, CARRY_TRACE_KM 1500 km traced back along the current,
 * faded where it barely moves), worked out again here from the drawn currents and sea temperature, so a moment kept
 * from before the page carried it can still be drawn. Positive: a warm current; negative: a cold one.
 */
export function carriedOf(U, V, Tsea, sea, traceKm = 1500, calmMs = 0.005) {
    const w = 360, h = 180, G = w * h, rowMean = new Float64Array(h);
    for (let j = 0; j < h; j++) {
        let s = 0, k = 0;
        for (let i = 0; i < w; i++) { const c = j * w + i; if (sea[c] && Tsea[c] === Tsea[c]) { s += Tsea[c]; k++; } }
        rowMean[j] = k ? s / k : NaN;
    }
    // (rows without sea take their nearest sea row's mean)
    for (let j = 0; j < h; j++) if (rowMean[j] !== rowMean[j]) { for (let d = 1; d < h; d++) { const a = rowMean[j - d], b = rowMean[j + d]; if (a === a) { rowMean[j] = a; break; } if (b === b) { rowMean[j] = b; break; } } }
    const tz = y => { const yy = Math.max(0, Math.min(h - 1, y - 0.5)), j0 = Math.floor(yy), f = yy - j0; return rowMean[j0] * (1 - f) + rowMean[Math.min(h - 1, j0 + 1)] * f; };
    const out = new Float32Array(G), steps = Math.max(1, Math.round(traceKm / 111.2));
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            const c = j * w + i;
            if (!sea[c]) continue;
            const sp0 = Math.hypot(U[c], V[c]);
            if (!(sp0 > 0)) continue;
            let y = j + 0.5, x = i + 0.5;
            for (let k = 0; k < steps; k++) {
                const cc = Math.floor(y) * w + ((Math.floor(x) % w) + w) % w, sp = Math.hypot(U[cc], V[cc]);
                if (!(sp > 0)) break;
                const cl = Math.max(0.1, Math.cos((90 - y) * DEG));
                const ny = y + V[cc] / sp, nx = x - U[cc] / sp / cl;              // (one cell upstream; rows run south)
                if (ny < 0 || ny >= h || !sea[Math.floor(ny) * w + ((Math.floor(nx) % w) + w) % w]) break;
                y = ny; x = nx;
            }
            // (ocean.js fades by the transport's speed, Ψ-derived over OCEAN_CURRENT_DEPTH_M: the drawn surface speed is
            // that already, so calm = 0.005 m/s)
            out[c] = (tz(y) - tz(j + 0.5)) * Math.tanh(sp0 / calmMs);
        }
    }
    return out;
}
