// The margin's line (records.js): where a continent's crust ends, as a smooth curve rather than the sim raster's cells.
//
// The history knows a continent's edge only cell by cell (~120 km at 40K): a rift's path steps from cell to cell, and a
// coast-distance field measured from the cells (half an edge from each land–sea pair) has the raster's staircase in its
// zero line. Earth's rifted margins are not staircases: a continent breaks along rift segments tens to hundreds of km long,
// nearly straight, offset at transform faults (Atlantic margins: Péron-Pinvidic et al. 2013, Mar. Pet. Geol. 43: 21–47),
// and the crust thins across the margin over its necking zone, 50–200 km wide — so the shoreline, where the thinned
// crust's isostatic surface meets sea level, is a contour of a profile that is smooth along the margin. So the edge is
// taken as the 0.5 contour of the land/sea raster smoothed over σ (a Gaussian: a straight edge seen through it is
// Φ(x / σ), whose contour is that edge; a staircase's steps, a cell long, are gone — their amplitude falls as
// exp(−2π²σ²/λ²)). σ is in sim cells — the raster's own uncertainty of where the edge lies, so a finer sim draws more of
// its rifts' bends — and smaller where the coast is rugged (island arcs, young collision coasts: records.js rugged — the two smoothings blended by it), whose
// small pieces must not be smoothed away. A cell changes from land to sea, or back, only on the coast, never as the last
// of its own kind around it (no island or lake erased) and never where it would part a land or a sea in two.
// The coast distance is then measured to that contour exactly — to its segments, carried outward cell by cell with the
// nearest segment (not summed edge by edge: those distances' contours, the shelf's edge and the coastal plain's, were
// polygons of the mesh) — out to maxKm, beyond which the distance it had is kept.

import { MinHeap } from '../core/min-heap.js';

const R = 6371;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Each cell's neighbours within 2.5σ and their Gaussian weights (σ km), as lists — built once per mesh and σ (the sim
 *  mesh is the same for every planet: a gather is then a short weighted sum). */
const kernels = new WeakMap();
function kernelOf(mesh, sigma) {
    let byMesh = kernels.get(mesh);
    if (!byMesh) kernels.set(mesh, byMesh = new Map());
    const key = sigma.toFixed(3);
    let K = byMesh.get(key);
    if (K) return K;
    const { numCells: n, adjOffset, adjList, xyz, edgeKm } = mesh, reach = 2.5 * sigma, hops = Math.ceil(reach / edgeKm) + 1;
    const lim = (2 * Math.sin(reach / (2 * R))) ** 2, inv = R * R / (2 * sigma * sigma), mark = new Int32Array(n).fill(-1), ring = [];
    const off = new Int32Array(n + 1), idx = [], w = [];
    for (let c = 0; c < n; c++) {
        const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
        ring.length = 0; ring.push(c); mark[c] = c;
        for (let h = 0, start = 0; h <= hops; h++) {
            const end = ring.length;
            for (let i = start; i < end; i++) {
                const q = ring[i], dx = xyz[3 * q] - x, dy = xyz[3 * q + 1] - y, dz = xyz[3 * q + 2] - z, c2 = dx * dx + dy * dy + dz * dz;
                if (c2 > lim) continue;
                idx.push(q); w.push(Math.exp(-c2 * inv));
                if (h < hops) for (let k = adjOffset[q]; k < adjOffset[q + 1]; k++) { const nb = adjList[k]; if (mark[nb] !== c) { mark[nb] = c; ring.push(nb); } }
            }
            start = end;
        }
        off[c + 1] = idx.length;
    }
    K = { off, idx: Int32Array.from(idx), w: Float32Array.from(w) };
    byMesh.set(key, K);
    return K;
}

/**
 * Gaussian averages (σ km) of `fields` around each cell where `use(c)`, over the cells within 2.5σ that have a finite
 * value (each field's own). Into `outs` (cells not used keep what they have; outs may be the fields themselves only if
 * they are not read again — pass copies otherwise).
 */
export function gaussianAt(mesh, fields, sigma, use, outs) {
    const { off, idx, w } = kernelOf(mesh, sigma), n = mesh.numCells, F = fields.length;
    for (let c = 0; c < n; c++) {
        if (!use(c)) continue;
        for (let f = 0; f < F; f++) {
            const field = fields[f];
            let sw = 0, sv = 0;
            for (let k = off[c]; k < off[c + 1]; k++) { const v = field[idx[k]]; if (v === v) { sw += w[k]; sv += w[k] * v; } }
            if (sw > 0) outs[f][c] = sv / sw;
        }
    }
}

/**
 * The coast distance `d` (signed km, + land; NaN: off the raster) redrawn to the margin's smooth line, in place.
 * @param {number} sigmaSmooth, sigmaRugged   the smoothing σ (km) of a smooth coast and of a rugged one…
 * @param {Float32Array} rugged                …blended by how rugged each cell's coast is (0…1)
 * @param {number} maxKm   the distance is measured to the line out to this (beyond the widest shelf and coastal plain:
 *                         nothing further reads it closely); the old one kept beyond
 */
export function marginLine(mesh, d, sigmaSmooth, sigmaRugged, rugged, maxKm = 800) {
    const { numCells: n, adjOffset, adjList, xyz, edgeKm } = mesh;
    // ── the land/sea raster seen through the Gaussian, near the coast (a smooth coast's σ, a rugged one's, blended by how
    // rugged it is) ──
    const band = 2.5 * Math.max(sigmaSmooth, sigmaRugged) + edgeKm, land = new Float32Array(n), phi = new Float32Array(n), phiR = new Float32Array(n);
    for (let c = 0; c < n; c++) { land[c] = d[c] === d[c] ? (d[c] >= 0 ? 1 : 0) : NaN; phi[c] = phiR[c] = land[c]; }
    const near = c => d[c] === d[c] && Math.abs(d[c]) < band;
    gaussianAt(mesh, [land], sigmaSmooth, near, [phi]);
    gaussianAt(mesh, [land], sigmaRugged, c => near(c) && rugged[c] > 0, [phiR]);
    for (let c = 0; c < n; c++) if (rugged[c] > 0 && near(c)) phi[c] += rugged[c] * (phiR[c] - phi[c]);
    // ── each cell's side: the smoothed raster's, where the cell may turn ──
    const sign = new Int8Array(n);                                       // 1 land, 0 sea, −1 off the raster
    for (let c = 0; c < n; c++) sign[c] = d[c] === d[c] ? (d[c] >= 0 ? 1 : 0) : -1;
    const g = new Float32Array(n);                                       // φ − ½ (its sign the cell's side)
    for (let c = 0; c < n; c++) {
        if (sign[c] < 0) { g[c] = NaN; continue; }
        g[c] = phi[c] - 0.5;
        const want = g[c] >= 0 ? 1 : 0;
        if (want === sign[c]) continue;
        let toward = 0, own = 0;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const s = sign[adjList[k]]; if (s === want) toward++; else if (s === sign[c]) own++; }
        if (toward > 0 && own > 0 && !splits(mesh, sign, c)) sign[c] = want;
        else g[c] = sign[c] ? 1e-3 : -1e-3;
    }
    // ── the line: φ = ½ across each sim triangle (marching triangles), as segments ──
    const seg = [], dist = new Float64Array(n).fill(Infinity), nearSeg = new Int32Array(n).fill(-1);
    const P = [0, 0, 0, 0, 0, 0];
    const kmTo = (c, s) => {
        const ax = seg[s], ay = seg[s + 1], az = seg[s + 2], bx = seg[s + 3] - ax, by = seg[s + 4] - ay, bz = seg[s + 5] - az;
        const px = xyz[3 * c] - ax, py = xyz[3 * c + 1] - ay, pz = xyz[3 * c + 2] - az, bb = bx * bx + by * by + bz * bz;
        const t = bb > 0 ? Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) / bb)) : 0;
        const qx = px - t * bx, qy = py - t * by, qz = pz - t * bz;
        return qx * qx + qy * qy + qz * qz;                              // (the chord², which orders as the distance does)
    };
    const cross = (a, b, o) => {
        const t = g[a] / (g[a] - g[b]);
        P[o] = xyz[3 * a] + t * (xyz[3 * b] - xyz[3 * a]); P[o + 1] = xyz[3 * a + 1] + t * (xyz[3 * b + 1] - xyz[3 * a + 1]); P[o + 2] = xyz[3 * a + 2] + t * (xyz[3 * b + 2] - xyz[3 * a + 2]);
    };
    const offer = (c, s) => { const ch = kmTo(c, s); if (ch < dist[c]) { dist[c] = ch; nearSeg[c] = s; } };
    for (let r = 0; r < n; r++) {
        if (!(g[r] === g[r]) || Math.abs(d[r]) > band + edgeKm) continue;
        const o = adjOffset[r], deg = adjOffset[r + 1] - o;
        for (let i = 0; i < deg; i++) {
            const a = adjList[o + i], b = adjList[o + (i + 1) % deg];
            if (a < r || b < r || !(g[a] === g[a]) || !(g[b] === g[b])) continue;
            const sr = g[r] >= 0, sa = g[a] >= 0, sb = g[b] >= 0;
            if (sr === sa && sa === sb) continue;
            // (the corner on its own side, and the line across its two edges)
            const odd = sr !== sa && sr !== sb ? r : sa !== sr && sa !== sb ? a : b;
            const p = odd === r ? a : r, q = odd === b ? a : b;
            cross(odd, p, 0); cross(odd, q, 3);
            const s = seg.length;
            seg.push(P[0], P[1], P[2], P[3], P[4], P[5]);
            offer(r, s); offer(a, s); offer(b, s);
        }
    }
    if (!seg.length) return d;
    // ── carried outward: each cell the distance to its neighbours' nearest segment, if nearer ──
    const heap = new MinHeap(4096), lim = (2 * Math.sin(maxKm / (2 * R))) ** 2;
    for (let c = 0; c < n; c++) if (dist[c] < Infinity) heap.push(dist[c], c);
    while (heap.size) {
        const c = heap.pop();
        if (heap.lastKey > dist[c]) continue;
        const s = nearSeg[c];
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (sign[nb] < 0) continue;
            const ch = kmTo(nb, s);
            if (ch >= dist[nb] || ch > lim) continue;
            dist[nb] = ch; nearSeg[nb] = s;
            heap.push(ch, nb);
        }
    }
    // ── the new distance near the line, the old one far beyond it ──
    for (let c = 0; c < n; c++) {
        if (sign[c] < 0) continue;
        const sgn = sign[c] ? 1 : -1, old = Math.abs(d[c]);
        if (!(dist[c] < Infinity)) { d[c] = sgn * Math.max(old, 1e-3); continue; }
        const km = 2 * R * Math.asin(Math.min(1, 0.5 * Math.sqrt(dist[c]))), t = smooth(0.7 * maxKm, maxKm, km);
        d[c] = sgn * Math.max(1e-3, km * (1 - t) + old * t);
    }
    return d;
}

/** Would turning cell c over part what it is now (sign: 1 land, 0 sea) in two — its neighbours of its own kind not all
 *  joined among themselves? (two seas then meet only through c: a strait; two lands, an isthmus) */
function splits(mesh, sign, c) {
    const { adjOffset, adjList } = mesh, own = sign[c], same = [];
    for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (sign[nb] === own) same.push(nb); }
    if (same.length < 2) return false;
    const seen = [same[0]], left = same.slice(1);
    for (let i = 0; i < seen.length; i++) {
        for (let j = left.length - 1; j >= 0; j--) {
            let joined = false;
            for (let k = adjOffset[seen[i]]; k < adjOffset[seen[i] + 1]; k++) if (adjList[k] === left[j]) { joined = true; break; }
            if (joined) { seen.push(left[j]); left.splice(j, 1); }
        }
    }
    return left.length > 0;
}

