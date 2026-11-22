// The CPU's float64 coast tracer and open-sea flood, as finish-coast.js had them before the GPU (b9e3d4f) — the references
// tools/coast-rays-test.mjs holds gpu/coast-rays.js and gpu/labels.js to. Not used by the app.
const R = 6371, D2R = Math.PI / 180;

/** The climate grid's cell at (lat, lon), degrees. */
export function gridCell(grid, step, la, lo) {
    const i = Math.min(grid.w - 1, Math.max(0, Math.floor((lo + 180) / step))), j = Math.min(grid.h - 1, Math.max(0, Math.floor((90 - la) / step)));
    return j * grid.w + i;
}

/** The open sea: the bodies of the sea at least `minCells` big (the ocean and the seas joined to it) — not a hollow below
 *  sea level the ice dug inland, dry until the rivers fill it (finish-hydro.js), whose shores no swell reaches. */
export function openSea(mesh, ocean, minCells) {
    const { adjOffset, adjList, numCells: n } = mesh, out = new Uint8Array(n), seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
        if (!ocean[s] || seen[s]) continue;
        const cells = [s];
        seen[s] = 1;
        for (let i = 0; i < cells.length; i++) for (let k = adjOffset[cells[i]]; k < adjOffset[cells[i] + 1]; k++) { const nb = adjList[k]; if (ocean[nb] && !seen[nb]) { seen[nb] = 1; cells.push(nb); } }
        if (cells.length >= minCells) for (const c of cells) out[c] = 1;
    }
    return out;
}

/**
 * The waves' tracer, built from plain arrays (a worker of the terrain pool builds the same one from a copy of them —
 * terrain-worker.js): T = { D, w, h (the climate grid), gen5, genU (4 seasons × grid × D: the fifth power of the wind
 * toward each direction, and its fifth root), si (4 × grid: the sea ice), landMask (grid: its land), far (4 × grid × D,
 * once traced: the far field), swellDecayKm, waveSatK, waveFetchK, farStep, farSteps, nearStep, nearSteps }; the mesh
 * (xyz, adjOffset, adjList) and each cell's lat, lon (degrees).
 *   farRange(from, to, out, base, span): the far field of grid cells [from, to) into out (4 × grid × D, at their own
 *     places — or 4 × span × D from grid cell base on);
 *   near(z, cells, from, to, out): the waves at cells[from … to), each direction, into out[i·D …] (i the index in cells).
 */
export function waveTracer(T, mesh, lat, lon) {
    const { D, w: gw, h: gh, gen5, genU, si, landMask } = T, G = gw * gh, step = 180 / gh;
    const { xyz, adjOffset, adjList } = mesh ?? {};
    const gridOf = (la, lo) => gridCell(T, step, la, lo);
    const dirOf = (te, tn) => { let d = Math.round(Math.atan2(te, tn) / (2 * Math.PI / D)); return ((d % D) + D) % D; };
    // (what arrives over a step of km — farStep or nearStep: its swell's fading once — toward the coast, travelling toward d)
    const fadeFar = Math.exp(-T.farStep / T.swellDecayKm), fadeNear = Math.exp(-T.nearStep / T.swellDecayKm);
    const grow = (P, g, s, d, km, fade) => {
        const open = 1 - si[s * G + g], o = (s * G + g) * D + d, U = genU[o];
        P *= fade * open;
        const sat = T.waveSatK * gen5[o] * open;
        if (P < sat && U > 0.5) P += (sat - P) * (1 - Math.exp(-km / (T.waveFetchK * U * U)));
        return P;
    };
    // (up-wave — against the travel — along bearing d: its east and north parts, once)
    const COS_UP = new Float64Array(D), SIN_UP = new Float64Array(D);
    for (let d = 0; d < D; d++) { const b = d * 2 * Math.PI / D + Math.PI; COS_UP[d] = Math.cos(b); SIN_UP[d] = Math.sin(b); }
    // (a step along a great circle: its angle's cosine and sine, once)
    const dl = T.farStep / R, cFar = Math.cos(dl), sFar = Math.sin(dl), dn = T.nearStep / R, cNear = Math.cos(dn), sNear = Math.sin(dn);
    const farSteps = T.farSteps, nearSteps = T.nearSteps, farStep = T.farStep, nearStep = T.nearStep;
    const pathG = new Int32Array(farSteps + 1), pathD = new Uint8Array(farSteps + 1);
    function farRange(from, to, out, base = 0, span = G) {
        for (let g = from; g < to; g++) {
            if (landMask[g]) continue;
            const j = Math.floor(g / gw), i = g - j * gw, la = (90 - (j + 0.5) * step) * D2R, lo = (-180 + (i + 0.5) * step) * D2R;
            const px0 = Math.cos(la) * Math.cos(lo), py0 = Math.cos(la) * Math.sin(lo), pz0 = Math.sin(la);
            // (east and north at the cell)
            const h0 = Math.hypot(px0, py0) || 1e-12, ex = -py0 / h0, ey = px0 / h0, ez = 0, nx = -pz0 * px0 / h0, ny = -pz0 * py0 / h0, nz = h0;
            for (let d = 0; d < D; d++) {
                // march up-wave (against the travel), from the cell out to the open sea or the first land
                const cb = COS_UP[d], sb = SIN_UP[d];
                let px = px0, py = py0, pz = pz0, dx = cb * nx + sb * ex, dy = cb * ny + sb * ey, dz = cb * nz + sb * ez;
                let k = 0;
                pathG[0] = g; pathD[0] = d;
                for (let s = 1; s <= farSteps; s++) {
                    const qx = cFar * px + sFar * dx, qy = cFar * py + sFar * dy, qz = cFar * pz + sFar * dz;
                    dx = -sFar * px + cFar * dx; dy = -sFar * py + cFar * dy; dz = -sFar * pz + cFar * dz; px = qx; py = qy; pz = qz;
                    const gg = gridOf(Math.asin(Math.max(-1, Math.min(1, pz))) / D2R, Math.atan2(py, px) / D2R);
                    if (landMask[gg]) break;
                    const h = Math.hypot(px, py) || 1e-12;
                    pathG[s] = gg; pathD[s] = dirOf(-(dx * (-py / h) + dy * (px / h) + dz * 0), -(dx * (-pz * px / h) + dy * (-pz * py / h) + dz * h)); k = s;
                }
                for (let s = 0; s < 4; s++) {
                    let P = 0;
                    for (let q = k; q >= 0; q--) P = grow(P, pathG[q], s, pathD[q], farStep, fadeFar);
                    out[(s * span + g - base) * D + d] = P;
                }
            }
        }
    }
    // (the far field at a point, from the sea's cells around it only: the four grid points around it and their weights)
    const cg = new Int32Array(4), cw = new Float64Array(4);
    const corners = (la, lo) => {
        const x = (lo + 180) / step - 0.5, y = Math.max(0, Math.min(gh - 1, (90 - la) / step - 0.5)), x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        cg[0] = Math.min(gh - 1, y0) * gw + ((x0 % gw) + gw) % gw; cw[0] = (1 - fx) * (1 - fy);
        cg[1] = Math.min(gh - 1, y0) * gw + (((x0 + 1) % gw) + gw) % gw; cw[1] = fx * (1 - fy);
        cg[2] = Math.min(gh - 1, y0 + 1) * gw + ((x0 % gw) + gw) % gw; cw[2] = (1 - fx) * fy;
        cg[3] = Math.min(gh - 1, y0 + 1) * gw + (((x0 + 1) % gw) + gw) % gw; cw[3] = fx * fy;
    };
    const farAt = (s, d) => {
        const far = T.far;
        let sum = 0, wsum = 0;
        for (let q = 0; q < 4; q++) {
            const g = cg[q], wq = cw[q];
            if (landMask[g] || !(wq > 0)) continue;
            sum += wq * far[(s * G + g) * D + d]; wsum += wq;
        }
        return wsum > 0 ? sum / wsum : 0;
    };
    // ── near field, on the mesh: from each coast cell, up-wave to the first land or out to waveNearKm, then the far field ──
    const walk = (c, px, py, pz) => {
        let best = xyz[3 * c] * px + xyz[3 * c + 1] * py + xyz[3 * c + 2] * pz;
        for (;;) {
            let next = -1;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k], d = xyz[3 * nb] * px + xyz[3 * nb + 1] * py + xyz[3 * nb + 2] * pz;
                if (d > best) { best = d; next = nb; }
            }
            if (next < 0) return c;
            c = next;
        }
    };
    const nG = new Int32Array(nearSteps + 1), nD = new Uint8Array(nearSteps + 1);
    function near(z, cells, from, to, out) {
        for (let i = from; i < to; i++) {
            const c = cells[i], o = i * D;
            const px0 = xyz[3 * c], py0 = xyz[3 * c + 1], pz0 = xyz[3 * c + 2];
            const h0 = Math.hypot(px0, py0) || 1e-12, ex = -py0 / h0, ey = px0 / h0, ez = 0, nx = -pz0 * px0 / h0, ny = -pz0 * py0 / h0, nz = h0;
            const g0 = gridOf(lat[c], lon[c]);
            for (let d = 0; d < D; d++) {
                const cb = COS_UP[d], sb = SIN_UP[d];
                let px = px0, py = py0, pz = pz0, dx = cb * nx + sb * ex, dy = cb * ny + sb * ey, dz = cb * nz + sb * ez;
                let cell = c, k = 0, blocked = false;
                nG[0] = g0; nD[0] = d;
                for (let s = 1; s <= nearSteps; s++) {
                    const qx = cNear * px + sNear * dx, qy = cNear * py + sNear * dy, qz = cNear * pz + sNear * dz;
                    dx = -sNear * px + cNear * dx; dy = -sNear * py + cNear * dy; dz = -sNear * pz + cNear * dz; px = qx; py = qy; pz = qz;
                    cell = walk(cell, px, py, pz);
                    if (z[cell] >= 0) { blocked = true; break; }
                    const h = Math.hypot(px, py) || 1e-12;
                    nG[s] = gridOf(lat[cell], lon[cell]); nD[s] = dirOf(-(dx * (-py / h) + dy * (px / h) + dz * 0), -(dx * (-pz * px / h) + dy * (-pz * py / h) + dz * h)); k = s;
                }
                // (a ray that met land at once — the land's side of the coast — brings nothing)
                if (blocked && k === 0) { out[o + d] = 0; continue; }
                if (!blocked) corners(Math.asin(Math.max(-1, Math.min(1, pz))) / D2R, Math.atan2(py, px) / D2R);
                let sum = 0;
                for (let s = 0; s < 4; s++) {
                    let P = blocked ? 0 : farAt(s, d);
                    for (let q = k; q >= 1; q--) P = grow(P, nG[q], s, nD[q], nearStep, fadeNear);
                    sum += P;
                }
                out[o + d] = sum / 4;
            }
        }
    }
    return { farRange, near };
}
