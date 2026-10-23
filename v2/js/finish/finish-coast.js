// F5 — the coast: the waves and the sand they move, over the last interglacials' high seas. The wind raises waves over
// the open sea (more the stronger and the longer it blows over open water, toward a fully developed sea; swell carried
// on far from the storms, fading; none under the sea ice), and every coast takes the waves that reach it — from the
// open directions only: a headland takes them from all round, a bay from its mouth, an inner sea from its short fetch.
// The waves cut the coast back (soft rock and low coasts fastest — a cliff's fall of rock must be cleared before it
// retreats again) and drive the sand along the shore (as waves meet it slantwise: most at 45°), from the cliffs and the
// rivers' mouths to where the drift slows — the bays' heads, the lee of headlands — building beaches, barriers and spits
// out to sea level. Headlands wear back and bays fill: the coast straightens where it is open, stays ragged where it is
// sheltered (developer: "I'd prefer doing actual physical coastal erosion sims").
//
// Physical units throughout: wave power in kW per m of wave crest (deep water: Pierson–Moskowitz, P ≈ 1e-4·U⁵ for a
// fully developed sea, reached over a fetch ≈ 2.25·U² km — JONSWAP's gF/U² ≈ 2.2·10⁴); cliff retreat in m/yr ∝ wave
// power × the rock's erodibility / (cliff height + toe) (Sunamura's wave-force over rock-strength, as a rate); longshore
// sand drift in km³/yr ∝ wave power · cos^1.2 α · sin α (CERC; Ashton & Murray 2006 for the deep-water angle α); time in
// years. Distances in km: the same coast at every detail, only drawn finer.

import { PARAMS } from '../climate/config.js';

const R = 6371, D2R = Math.PI / 180;

// E[max(0, m + ξ)⁵], ξ ~ N(0, 1): a direction's share of the fifth power of a wind of mean m and unit spread (the storms)
const POW5 = (() => {
    const t = new Float64Array(701);
    for (let i = 0; i <= 700; i++) {
        const m = -6 + i * 0.02;
        let sum = 0;
        for (let x = -8; x <= 8; x += 0.01) { const u = m + x; if (u > 0) sum += u ** 5 * Math.exp(-x * x / 2); }
        t[i] = sum * 0.01 / Math.sqrt(2 * Math.PI);
    }
    return t;
})();
const pow5 = (mu, sig) => {
    if (!(sig > 0.01)) return Math.max(0, mu) ** 5;
    const x = (mu / sig + 6) / 0.02;
    if (x >= 700) return mu ** 5 + 10 * mu ** 3 * sig * sig + 15 * mu * sig ** 4;   // (far above the spread: the moments)
    if (x <= 0) return 0;
    const i = Math.floor(x), f = x - i;
    return sig ** 5 * (POW5[i] * (1 - f) + POW5[i + 1] * f);
};

/**
 * @param {Object} ctx  { mesh, z (km, changed in place), lat, lon (degrees), soft (0–1: the rock's softness, records.js
 *                        iceSoft), climGrid {w, h}, u, v (12 × the climate grid: the winds, m/s, east and north), ice
 *                        (12 × grid: sea-ice cover 0–1, or null), eady, anchors (the rain stage's storm growth per row,
 *                        1/day, at its anchor months — the storms' winds), mouths (Map: sea cell → the river's load, km³ over the
 *                        carve's time), carveYears, oceanMask (z → Uint8Array), cellKm2 }
 * @returns {{wave: Float32Array (kW/m at the coast's cells), change: Float32Array (km), stats: Object}}
 */
export function coastWork(ctx, F) {
    const { mesh, z, soft, climGrid, cellKm2 } = ctx, n = mesh.numCells, { adjOffset, adjList, edgeKm, xyz } = mesh;
    const wave = new Float32Array(n), change = new Float32Array(n);
    const stats = { years: F.coastYears, erodedKm3: 0, sandKm3: 0, riverKm3: 0, landLostKm2: 0, landGainedKm2: 0, lostKm3: 0, meanWaveKw: 0 };
    if (!(F.coastYears > 0) || !ctx.u) return { wave, change, stats };
    const D = F.waveDirs, start = z.slice();
    // ── the seasons' winds and ice, on the climate grid (DJF, MAM, JJA, SON) ──
    const G = climGrid.w * climGrid.h, ice = ctx.ice && ctx.ice.length === 12 * G ? ctx.ice : null;
    const su = [], sv = [], si = [];
    for (let s = 0; s < 4; s++) {
        const a = new Float32Array(G), b = new Float32Array(G), c = new Float32Array(G);
        for (const m of [(3 * s + 11) % 12, 3 * s, 3 * s + 1]) for (let g = 0; g < G; g++) { a[g] += ctx.u[m * G + g] / 3; b[g] += ctx.v[m * G + g] / 3; if (ice) c[g] += ice[m * G + g] / 3; }
        su.push(a); sv.push(b); si.push(c);
    }
    // (the storms' winds about the month's mean — the gustiness and the Eady rate × the storms' size, as the rain stage
    // reckons them: rain.js — per season and row; spread evenly over the directions, σ per component)
    const L = PARAMS.RAIN_EDDY_LENGTH_KM * 1000, gust = PARAMS.OCEAN_GUST_MS, ss = [];
    for (let s = 0; s < 4; s++) {
        const months = [(3 * s + 11) % 12, 3 * s, 3 * s + 1], rows = new Float32Array(climGrid.h);
        const ks = (ctx.anchors ?? []).map((a, k) => [Math.floor(a) % 12, k]).filter(([m]) => months.includes(m)).map(([, k]) => k);
        if (!ks.length && ctx.anchors?.length) {                       // (no anchor month in the season: the nearest)
            let best = 0, bd = 99;
            ctx.anchors.forEach((a, k) => { const d = Math.min(Math.abs(a - 3 * s), 12 - Math.abs(a - 3 * s)); if (d < bd) { bd = d; best = k; } });
            ks.push(best);
        }
        for (let j = 0; j < climGrid.h; j++) {
            let e = 0;
            for (const k of ks) { const ey = ctx.eady[k]; e += ey[Math.min(ey.length - 1, Math.floor(j * ey.length / climGrid.h))] / ks.length; }
            rows[j] = F.waveStormShare * Math.hypot(gust, (ctx.eady ? e : 0) / 86400 * L) / Math.SQRT2;
        }
        ss.push(rows);
    }
    const step = 180 / climGrid.h, gridOf = (la, lo) => {
        const i = Math.min(climGrid.w - 1, Math.max(0, Math.floor((lo + 180) / step))), j = Math.min(climGrid.h - 1, Math.max(0, Math.floor((90 - la) / step)));
        return j * climGrid.w + i;
    };
    // (the sea's waves: grown toward a fully developed sea by the wind along the way, carried on as swell, fading; none
    // under the ice. P: what arrives over a step of km toward the coast, travelling toward direction d)
    // (each grid cell's seas toward each direction, by season: the fifth power of the wind along it, storms and all)
    const gen5 = new Float32Array(4 * G * D), genU = new Float32Array(4 * G * D);
    for (let s = 0; s < 4; s++) for (let g = 0; g < G; g++) {
        const sig = ss[s][Math.floor(g / climGrid.w)];
        for (let d = 0; d < D; d++) {
            const b = d * 2 * Math.PI / D, U5 = pow5(su[s][g] * Math.sin(b) + sv[s][g] * Math.cos(b), sig), o = (s * G + g) * D + d;
            gen5[o] = U5; genU[o] = U5 ** 0.2;
        }
    }
    const dirOf = (te, tn) => { let d = Math.round(Math.atan2(te, tn) / (2 * Math.PI / D)); return ((d % D) + D) % D; };
    const grow = (P, g, s, d, km) => {
        const open = 1 - si[s][g], o = (s * G + g) * D + d, U = genU[o];
        P *= Math.exp(-km / F.swellDecayKm) * open;
        const sat = F.waveSatK * gen5[o] * open;
        if (P < sat && U > 0.5) P += (sat - P) * (1 - Math.exp(-km / (F.waveFetchK * U * U)));
        return P;
    };
    // a direction of travel (bearing from north, clockwise) at a point: the tangent vector
    const bearings = Float64Array.from({ length: D }, (_, d) => d * 2 * Math.PI / D);
    const frame = (x, y, w) => {                                        // east, north at a unit vector
        const h = Math.hypot(x, y) || 1e-12;
        return [-y / h, x / h, 0, -w * x / h, -w * y / h, h];
    };
    // ── far field: on the climate grid, the waves arriving at each sea cell from each direction, by season ──
    const landG = new Float32Array(G), cntG = new Float32Array(G);
    for (let c = 0; c < n; c++) { const g = gridOf(ctx.lat[c], ctx.lon[c]); cntG[g]++; if (z[c] >= 0) landG[g]++; }
    const isLandG = g => cntG[g] > 0 && landG[g] > 0.5 * cntG[g];
    const far = new Float32Array(4 * G * D), farStep = F.waveFarStepKm, farSteps = Math.round(F.waveFarKm / farStep), dl = farStep / R;
    const pathG = new Int32Array(farSteps + 1), pathD = new Uint8Array(farSteps + 1);
    for (let g = 0; g < G; g++) {
        if (isLandG(g)) continue;
        const j = Math.floor(g / climGrid.w), i = g - j * climGrid.w, la = (90 - (j + 0.5) * step) * D2R, lo = (-180 + (i + 0.5) * step) * D2R;
        const px0 = Math.cos(la) * Math.cos(lo), py0 = Math.cos(la) * Math.sin(lo), pz0 = Math.sin(la);
        for (let d = 0; d < D; d++) {
            // march up-wave (against the travel), from the cell out to the open sea or the first land
            const [ex, ey, ez, nx, ny, nz] = frame(px0, py0, pz0), b = bearings[d] + Math.PI;
            let px = px0, py = py0, pz = pz0, dx = Math.cos(b) * nx + Math.sin(b) * ex, dy = Math.cos(b) * ny + Math.sin(b) * ey, dz = Math.cos(b) * nz + Math.sin(b) * ez;
            let k = 0;
            pathG[0] = g; pathD[0] = d;
            for (let s = 1; s <= farSteps; s++) {
                const c1 = Math.cos(dl), s1 = Math.sin(dl);
                const qx = c1 * px + s1 * dx, qy = c1 * py + s1 * dy, qz = c1 * pz + s1 * dz;
                dx = -s1 * px + c1 * dx; dy = -s1 * py + c1 * dy; dz = -s1 * pz + c1 * dz; px = qx; py = qy; pz = qz;
                const gg = gridOf(Math.asin(Math.max(-1, Math.min(1, pz))) / D2R, Math.atan2(py, px) / D2R);
                if (isLandG(gg)) break;
                const f = frame(px, py, pz);
                pathG[s] = gg; pathD[s] = dirOf(-(dx * f[0] + dy * f[1] + dz * f[2]), -(dx * f[3] + dy * f[4] + dz * f[5])); k = s;
            }
            for (let s = 0; s < 4; s++) {
                let P = 0;
                for (let q = k; q >= 0; q--) P = grow(P, pathG[q], s, pathD[q], farStep);
                far[(s * G + g) * D + d] = P;
            }
        }
    }
    // (the far field at a point, from the sea's cells around it only)
    const farAt = (la, lo, s, d) => {
        const x = (lo + 180) / step - 0.5, y = Math.max(0, Math.min(climGrid.h - 1, (90 - la) / step - 0.5)), x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        let sum = 0, wsum = 0;
        for (const [ii, jj, w] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]]) {
            const g = Math.min(climGrid.h - 1, jj) * climGrid.w + ((ii % climGrid.w) + climGrid.w) % climGrid.w;
            if (isLandG(g) || !(w > 0)) continue;
            sum += w * far[(s * G + g) * D + d]; wsum += w;
        }
        return wsum > 0 ? sum / wsum : 0;
    };
    // ── near field, on the mesh: from each coast cell, up-wave to the first land or out to waveNearKm, then the far field ──
    const nearStep = 1.5 * edgeKm, nearSteps = Math.floor(F.waveNearKm / nearStep), dn = nearStep / R;
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
    /** The waves arriving at cell c from each direction (kW/m), the seasons' mean, into out[o … o + D). */
    const waves = (c, out, o) => {
        const px0 = xyz[3 * c], py0 = xyz[3 * c + 1], pz0 = xyz[3 * c + 2], [ex, ey, ez, nx, ny, nz] = frame(px0, py0, pz0);
        for (let d = 0; d < D; d++) {
            const b = bearings[d] + Math.PI;
            let px = px0, py = py0, pz = pz0, dx = Math.cos(b) * nx + Math.sin(b) * ex, dy = Math.cos(b) * ny + Math.sin(b) * ey, dz = Math.cos(b) * nz + Math.sin(b) * ez;
            let cell = c, k = 0, blocked = false;
            nG[0] = gridOf(ctx.lat[c], ctx.lon[c]); nD[0] = d;
            for (let s = 1; s <= nearSteps; s++) {
                const c1 = Math.cos(dn), s1 = Math.sin(dn);
                const qx = c1 * px + s1 * dx, qy = c1 * py + s1 * dy, qz = c1 * pz + s1 * dz;
                dx = -s1 * px + c1 * dx; dy = -s1 * py + c1 * dy; dz = -s1 * pz + c1 * dz; px = qx; py = qy; pz = qz;
                cell = walk(cell, px, py, pz);
                if (z[cell] >= 0) { blocked = true; break; }
                const f = frame(px, py, pz);
                nG[s] = gridOf(ctx.lat[cell], ctx.lon[cell]); nD[s] = dirOf(-(dx * f[0] + dy * f[1] + dz * f[2]), -(dx * f[3] + dy * f[4] + dz * f[5])); k = s;
            }
            // (a ray that met land at once — the land's side of the coast — brings nothing)
            if (blocked && k === 0) { out[o + d] = 0; continue; }
            const la = Math.asin(Math.max(-1, Math.min(1, pz))) / D2R, lo = Math.atan2(py, px) / D2R;
            let sum = 0;
            for (let s = 0; s < 4; s++) {
                let P = blocked ? 0 : farAt(la, lo, s, d);
                for (let q = k; q >= 1; q--) P = grow(P, nG[q], s, nD[q], nearStep);
                sum += P;
            }
            out[o + d] = sum / 4;
        }
    };
    // ── the coast worked over coastYears, in coastSteps: the waves at the coast, the cliffs cut, the sand moved ──
    const steps = F.coastSteps, dt = F.coastYears / steps;
    const sandH = new Float32Array(n);                                  // (km of loose sand on the sea's shore cells)
    const riverRate = new Map();
    for (const [mouth, load] of ctx.mouths ?? []) riverRate.set(mouth, F.coastRiverSand * load / ctx.carveYears);
    const isCoastLand = new Uint8Array(n), isShore = new Uint8Array(n), down = new Int32Array(n), inDeg = new Int32Array(n);
    const avail = new Float64Array(n), carry = new Float64Array(n);
    let firstSand = true;
    for (let it = 0; it < steps; it++) {
        const ocean = openSea(mesh, ctx.oceanMask(z), F.coastSeaKm2 / cellKm2);
        isCoastLand.fill(0); isShore.fill(0);
        const coast = [];
        for (let c = 0; c < n; c++) {
            const land = z[c] >= 0;
            if (!land && !ocean[c]) continue;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (land && ocean[nb]) { isCoastLand[c] = 1; break; }
                if (!land && z[nb] >= 0) { isShore[c] = 1; break; }
            }
            if (isCoastLand[c] || isShore[c]) coast.push(c);
        }
        const Pd = new Float32Array(coast.length * D), at = new Int32Array(n).fill(-1);
        coast.forEach((c, i) => { at[c] = i; waves(c, Pd, i * D); });
        if (firstSand) { for (const c of coast) if (isShore[c]) sandH[c] = F.coastSandKm; firstSand = false; }
        avail.fill(0);
        // (the cliffs: cut back toward a wave-cut platform; their rock's sand to the shore below)
        let waveSum = 0, waveN = 0;
        for (const c of coast) {
            if (!isCoastLand[c]) continue;
            let P = 0;
            for (let d = 0; d < D; d++) P += Pd[at[c] * D + d];
            wave[c] = P; waveSum += P; waveN++;
            if (sandH[c] > 0) continue;                                 // (a beach the drift built is the drift's, not a cliff)
            const erod = F.cliffHardRatio ** (1 - (soft ? soft[c] : 0.5)), hM = Math.max(0, z[c]) * 1000;
            const retreatM = F.cliffK * P * erod / (hM + F.cliffToeM);
            const share = Math.min(F.coastMaxShare, retreatM * 1e-3 * dt / edgeKm), cut = share * (z[c] - F.platformKm);
            if (!(cut > 0)) continue;
            z[c] -= cut;
            const vol = cut * cellKm2;
            stats.erodedKm3 += vol;
            let shores = 0;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (isShore[adjList[k]]) shores++;
            if (shores) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (isShore[adjList[k]]) avail[adjList[k]] += F.cliffSandShare * vol / shores;
        }
        stats.meanWaveKw = waveN ? waveSum / waveN : 0;
        // (the rivers' sand, at their mouths — or the shore nearest them, once a delta or a barrier has built out)
        for (const [mouth, rate] of riverRate) {
            let s = mouth;
            if (!isShore[s]) { s = -1; for (let k = adjOffset[mouth]; k < adjOffset[mouth + 1]; k++) if (isShore[adjList[k]]) { s = adjList[k]; break; } }
            if (s >= 0) { avail[s] += rate * dt; stats.riverKm3 += rate * dt; }
        }
        // (the drift along the shore: the waves' slant at each shore cell, toward its neighbour along the shore that way)
        const shoreList = coast.filter(c => isShore[c]), cap = new Float64Array(shoreList.length);
        inDeg.fill(0);
        shoreList.forEach((s, i) => {
            const px = xyz[3 * s], py = xyz[3 * s + 1], pz = xyz[3 * s + 2];
            let ax = 0, ay = 0, az = 0;
            for (let k = adjOffset[s]; k < adjOffset[s + 1]; k++) {
                const nb = adjList[k];
                if (z[nb] < 0) continue;
                const qx = xyz[3 * nb] - px, qy = xyz[3 * nb + 1] - py, qz = xyz[3 * nb + 2] - pz, h = Math.hypot(qx, qy, qz) || 1;
                ax += qx / h; ay += qy / h; az += qz / h;
            }
            const al = Math.hypot(ax, ay, az);
            down[s] = -1;
            if (!(al > 1e-6)) return;
            ax /= al; ay /= al; az /= al;                                // landward normal
            const tx = py * az - pz * ay, ty = pz * ax - px * az, tz = px * ay - py * ax;   // along the shore
            const [ex, ey, ez, nx, ny, nz] = frame(px, py, pz);
            let q = 0;
            for (let d = 0; d < D; d++) {
                const P = Pd[at[s] * D + d];
                if (!(P > 0)) continue;
                const b = bearings[d], ux = Math.cos(b) * nx + Math.sin(b) * ex, uy = Math.cos(b) * ny + Math.sin(b) * ey, uz = Math.cos(b) * nz + Math.sin(b) * ez;
                const cosA = ux * ax + uy * ay + uz * az, sinA = ux * tx + uy * ty + uz * tz;
                if (cosA > 0) q += P * cosA ** 1.2 * sinA;
            }
            const Q = F.longshoreK * q, sign = Math.sign(Q);
            cap[i] = Math.abs(Q) * dt;
            let best = F.driftAlign;
            for (let k = adjOffset[s]; k < adjOffset[s + 1]; k++) {
                const nb = adjList[k];
                if (!isShore[nb]) continue;
                const qx = xyz[3 * nb] - px, qy = xyz[3 * nb + 1] - py, qz = xyz[3 * nb + 2] - pz, h = Math.hypot(qx, qy, qz) || 1;
                const a = sign * (qx * tx + qy * ty + qz * tz) / h;
                if (a > best) { best = a; down[s] = nb; }
            }
            if (down[s] >= 0) inDeg[down[s]]++;
        });
        // (updrift first: each shore cell passes on what the drift can carry of the sand it has and is given; the rest it
        // keeps — where the drift slows or turns, the sand gathers. Cells caught in a loop end it, keeping what they get)
        const idx = new Int32Array(n).fill(-1);
        shoreList.forEach((s, i) => { idx[s] = i; });
        const queue = shoreList.filter(s => inDeg[s] === 0), done = new Uint8Array(shoreList.length);
        const pass = s => {
            const i = idx[s], have = avail[s] + carry[s] + sandH[s] * cellKm2, out = down[s] >= 0 && !done[idx[down[s]]] ? Math.min(cap[i], have) : 0;
            done[i] = 1;
            const keep = have - out;
            if (out > 0) avail[down[s]] += out;
            // the sand kept is laid on the shore, up to the beach's crest; what the crest cannot take waits for the next step.
            // Below the shoreface's closure depth the waves cannot hold it: it is lost down the slope (a steep coast's)
            const rock = z[s] - sandH[s];
            if (rock < -F.closureKm) { stats.lostKm3 += keep - sandH[s] * cellKm2; carry[s] = 0; if (down[s] >= 0 && --inDeg[down[s]] === 0) queue.push(down[s]); return; }
            const room = Math.max(0, (F.beachCrestKm - rock) * cellKm2), laid = Math.min(keep, room);
            stats.sandKm3 += Math.max(0, laid / cellKm2 - sandH[s]) * cellKm2;
            sandH[s] = laid / cellKm2; z[s] = rock + sandH[s];
            carry[s] = keep - laid;
            if (down[s] >= 0 && --inDeg[down[s]] === 0) queue.push(down[s]);
        };
        for (let q = 0; q < queue.length; q++) pass(queue[q]);
        for (const s of shoreList) if (!done[idx[s]]) pass(s);
    }
    for (let c = 0; c < n; c++) {
        change[c] = z[c] - start[c];
        if (start[c] >= 0 && z[c] < 0) stats.landLostKm2 += cellKm2;
        if (start[c] < 0 && z[c] >= 0) stats.landGainedKm2 += cellKm2;
    }
    for (const k of ['erodedKm3', 'sandKm3', 'riverKm3', 'lostKm3', 'landLostKm2', 'landGainedKm2', 'meanWaveKw']) stats[k] = Math.round(stats[k] * 10) / 10;
    return { wave, change, stats };
}

/** The open sea: the bodies of the sea at least `minCells` big (the ocean and the seas joined to it) — not a hollow below
 *  sea level the ice dug inland, dry until the rivers fill it (finish-hydro.js), whose shores no swell reaches. */
function openSea(mesh, ocean, minCells) {
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
