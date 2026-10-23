// The coastline's shape as a fractal: its divider (Richardson) dimension D and its length at a short and a long ruler,
// per kind of margin — the measure behind the coast-shape reports (check-phase8a.mjs, coast-shape.mjs, render-moment.mjs).
//
// Richardson (1961) walked dividers of ruler ε along coasts and frontiers: the length L(ε) = N(ε)·ε grows as the ruler
// shrinks, as ε^(1 − D). Mandelbrot (1967, "How long is the coast of Britain?", Science 156: 636–638) read D from those
// plots: the coast of South Africa ~1.02 (as smooth as a coast gets), the Australian coast ~1.13, the west coast of
// Britain ~1.25 (Richardson's measurements; Germany's land frontier 1.15). The Norwegian coast, fjords and skerries, is
// ~1.52 (Feder 1988, Fractals, ch. 2 — widely quoted; recalled, not checked against the book). A smooth
// coast's L(50 km) / L(500 km) = 10^(D − 1): ~1.05 for South Africa, ~1.8 for western Britain, ~3.3 for Norway.
//
// The coast is the zero contour of the surface (marching triangles over the mesh's Delaunay triangles, the crossing on
// each land–sea edge interpolated from the heights), as closed loops of points; each point is given the kind of margin
// of the sim cell nearest it, and each loop is cut into stretches of one kind (a stretch shorter than minRunKm joins the
// one before). D of a stretch is the slope of log L(ε) over log ε for the rulers that fit it (up to a third of its
// length, at least three of them), a kind's D the length-weighted mean of its stretches'.

const R = 6371;

/** The rulers (km): 50 … 500, √2 apart (a mesh of 1M cells is ~20 km across a cell: 50 km spans 2–3 of them). */
export const RULERS_KM = [50, 71, 100, 141, 200, 283, 400, 500];

/**
 * The coast's closed loops on `mesh` (adjacency in circular order around each cell, as sphere-mesh.js builds it).
 * @param {(c: number) => boolean} isSea
 * @param {Float32Array|null} z   heights (km; sea below 0): where its sign agrees with isSea, the crossing on an edge is
 *                                interpolated (else halfway)
 * @returns {{pts: Float64Array, cells: Int32Array}[]}  per loop: unit vectors (3 per point) and the land cell beside each
 */
export function coastLoops(mesh, isSea, z = null) {
    const { numCells: n, adjOffset, adjList, xyz } = mesh;
    const sea = new Uint8Array(n);
    for (let c = 0; c < n; c++) sea[c] = isSea(c) ? 1 : 0;
    // every land–sea edge gets an id; the triangles across the coast link its edges two by two
    const edgeId = new Map(), ea = [], eb = [], link = [];
    const idOf = (a, b) => {
        const key = a < b ? a * n + b : b * n + a;
        let id = edgeId.get(key);
        if (id === undefined) { id = ea.length; edgeId.set(key, id); ea.push(a); eb.push(b); link.push(-1, -1); }
        return id;
    };
    const join = (i, j) => { if (link[2 * i] < 0) link[2 * i] = j; else link[2 * i + 1] = j; if (link[2 * j] < 0) link[2 * j] = i; else link[2 * j + 1] = i; };
    for (let r = 0; r < n; r++) {
        const o = adjOffset[r], deg = adjOffset[r + 1] - o;
        for (let i = 0; i < deg; i++) {
            const a = adjList[o + i], b = adjList[o + (i + 1) % deg];
            if (a < r || b < r) continue;                                   // (each triangle once: from its smallest corner)
            const s = sea[r] + sea[a] + sea[b];
            if (s === 0 || s === 3) continue;
            // the odd corner out, and the two edges from it
            const odd = sea[r] !== sea[a] && sea[r] !== sea[b] ? r : sea[a] !== sea[r] && sea[a] !== sea[b] ? a : b;
            const [p, q] = odd === r ? [a, b] : odd === a ? [r, b] : [r, a];
            join(idOf(odd, p), idOf(odd, q));
        }
    }
    const m = ea.length, seen = new Uint8Array(m), loops = [];
    const point = (id, out, k) => {
        const a = ea[id], b = eb[id];
        let t = 0.5;
        if (z) { const za = z[a], zb = z[b]; if ((za < 0) === !!sea[a] && (zb < 0) === !!sea[b] && za !== zb) t = Math.min(0.95, Math.max(0.05, za / (za - zb))); }
        let x = xyz[3 * a] + t * (xyz[3 * b] - xyz[3 * a]), y = xyz[3 * a + 1] + t * (xyz[3 * b + 1] - xyz[3 * a + 1]), w = xyz[3 * a + 2] + t * (xyz[3 * b + 2] - xyz[3 * a + 2]);
        const l = Math.hypot(x, y, w); out[3 * k] = x / l; out[3 * k + 1] = y / l; out[3 * k + 2] = w / l;
        return sea[a] ? b : a;
    };
    for (let s = 0; s < m; s++) {
        if (seen[s]) continue;
        const ids = [];
        for (let prev = -1, cur = s; cur >= 0 && !seen[cur];) {
            seen[cur] = 1; ids.push(cur);
            const next = link[2 * cur] === prev ? link[2 * cur + 1] : link[2 * cur];
            prev = cur; cur = next;
        }
        const pts = new Float64Array(3 * ids.length), cells = new Int32Array(ids.length);
        for (let k = 0; k < ids.length; k++) cells[k] = point(ids[k], pts, k);
        loops.push({ pts, cells });
    }
    return loops;
}

/** Great-circle length (km) of points from…to (inclusive) of `pts`; with `closed`, back to the first. */
export function polyLengthKm(pts, from = 0, to = pts.length / 3 - 1, closed = false) {
    let L = 0;
    const seg = (i, j) => 2 * R * Math.asin(Math.min(1, 0.5 * Math.hypot(pts[3 * i] - pts[3 * j], pts[3 * i + 1] - pts[3 * j + 1], pts[3 * i + 2] - pts[3 * j + 2])));
    for (let i = from; i < to; i++) L += seg(i, i + 1);
    if (closed) L += seg(to, from);
    return L;
}

/**
 * Richardson's divider walk: the length (km) of the polyline `pts` (unit vectors, open) measured with a ruler of
 * `epsKm`: N whole steps, each to the first point along the line a ruler's chord away from the last, plus the rest.
 */
export function dividerKm(pts, epsKm) {
    const k = pts.length / 3, chord = 2 * Math.sin(epsKm / (2 * R)), c2 = chord * chord;
    if (k < 2) return 0;
    let cx = pts[0], cy = pts[1], cz = pts[2], i = 1, steps = 0;
    while (i < k) {
        // the first vertex a chord or more from the current point
        let j = i;
        while (j < k && (pts[3 * j] - cx) ** 2 + (pts[3 * j + 1] - cy) ** 2 + (pts[3 * j + 2] - cz) ** 2 < c2) j++;
        if (j >= k) break;
        // the crossing on the segment (j − 1 → j): |A + s(B − A) − C|² = chord², the root in (0, 1]
        const ax = pts[3 * (j - 1)], ay = pts[3 * (j - 1) + 1], az = pts[3 * (j - 1) + 2];
        const dx = pts[3 * j] - ax, dy = pts[3 * j + 1] - ay, dz = pts[3 * j + 2] - az, fx = ax - cx, fy = ay - cy, fz = az - cz;
        const A = dx * dx + dy * dy + dz * dz, B = 2 * (fx * dx + fy * dy + fz * dz), C = fx * fx + fy * fy + fz * fz - c2;
        const disc = Math.max(0, B * B - 4 * A * C), s = A > 0 ? Math.min(1, Math.max(0, (-B + Math.sqrt(disc)) / (2 * A))) : 1;
        cx = ax + s * dx; cy = ay + s * dy; cz = az + s * dz;
        steps++;
        i = s >= 1 ? j + 1 : j;
    }
    const ex = pts[3 * (k - 1)], ey = pts[3 * (k - 1) + 1], ez = pts[3 * (k - 1) + 2];
    return steps * epsKm + 2 * R * Math.asin(Math.min(1, 0.5 * Math.hypot(ex - cx, ey - cy, ez - cz)));
}

/** Least-squares slope of y over x. */
const slopeOf = (xs, ys) => {
    const n = xs.length, mx = xs.reduce((a, v) => a + v, 0) / n, my = ys.reduce((a, v) => a + v, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    return sxy / sxx;
};

/**
 * The coast's fractal measures by kind.
 * @param {{pts: Float64Array, cells: Int32Array}[]} loops   coastLoops()
 * @param {(cell: number, x: number, y: number, z: number) => number} kindAt   a point's kind (an integer ≥ 0; < 0: not counted)
 * @param {{kinds: string[], minRunKm?: number, rulers?: number[], shortKm?: number, longKm?: number}} o
 * @returns {Object<string, {D: number, ratio: number, km: number, runs: number, ratioKm: number}>}  per kind name, and 'all':
 *          D (length-weighted over stretches), ratio = L(shortKm) / L(longKm) summed over the stretches 3 × longKm or longer,
 *          km of coast of the kind, stretches measured, and the km that the ratio is measured over
 */
export function coastFractal(loops, kindAt, { kinds, minRunKm = 300, rulers = RULERS_KM, shortKm = 50, longKm = 500 }) {
    const acc = {};
    const bin = name => (acc[name] ??= { wD: 0, w: 0, km: 0, runs: 0, short: 0, long: 0, ratioKm: 0 });
    const measure = (name, pts, km) => {
        const b = bin(name);
        b.km += km;
        const fit = rulers.filter(e => e <= km / 3);
        if (fit.length >= 3) {
            const L = fit.map(e => dividerKm(pts, e));
            if (L.every(v => v > 0)) { const D = 1 - slopeOf(fit.map(Math.log), L.map(Math.log)); b.wD += D * km; b.w += km; b.runs++; }
        }
        if (km >= 3 * longKm) { b.short += dividerKm(pts, shortKm); b.long += dividerKm(pts, longKm); b.ratioKm += km; }
    };
    for (const { pts, cells } of loops) {
        const k = cells.length;
        if (k < 4) continue;
        const total = polyLengthKm(pts, 0, k - 1, true);
        // the whole loop (closed: its first point again at the end), for 'all'
        const closedPts = new Float64Array(3 * (k + 1));
        closedPts.set(pts); closedPts.set(pts.subarray(0, 3), 3 * k);
        if (total >= 3 * rulers[0]) measure('all', closedPts, total);
        // each point's kind; stretches of one kind, from a change of kind (a loop of one kind: the whole loop)
        const kind = new Int16Array(k);
        for (let i = 0; i < k; i++) kind[i] = kindAt(cells[i], pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
        let start = 0;
        while (start < k && kind[start] === kind[(start + k - 1) % k]) start++;
        if (start === k) { if (kind[0] >= 0 && total >= 3 * rulers[0]) measure(kinds[kind[0]], closedPts, total); continue; }
        // runs in loop order from `start`; a run shorter than minRunKm takes the kind of the run before it
        const runs = [];
        for (let i = 0; i < k;) {
            const a = (start + i) % k, kd = kind[a];
            let j = i;
            while (j < k && kind[(start + j) % k] === kd) j++;
            runs.push({ from: i, to: j, kd });                               // (indices from `start`, to exclusive)
            i = j;
        }
        const ordered = new Float64Array(3 * (k + 1));
        for (let i = 0; i <= k; i++) ordered.set(pts.subarray(3 * ((start + i) % k), 3 * ((start + i) % k) + 3), 3 * i);
        for (const r of runs) r.km = polyLengthKm(ordered, r.from, r.to);
        const merged = [];
        for (const r of runs) {
            const last = merged.at(-1);
            if (last && (r.km < minRunKm || r.kd === last.kd)) { last.to = r.to; last.km += r.km; }
            else merged.push({ ...r });
        }
        for (const r of merged) {
            if (r.kd < 0) continue;
            const sub = ordered.subarray(3 * r.from, 3 * (r.to + 1));          // (to its next stretch's first point)
            measure(kinds[r.kd], sub, polyLengthKm(sub));
        }
    }
    const out = {};
    for (const [name, b] of Object.entries(acc)) out[name] = { D: b.w > 0 ? b.wD / b.w : NaN, ratio: b.long > 0 ? b.short / b.long : NaN, km: b.km, runs: b.runs, ratioKm: b.ratioKm };
    return out;
}

/** Earth's coasts, for the reports: D over ~20–500 km rulers, by kind of margin, and where the figure comes from. */
export const EARTH_D = {
    'passive mature': { earth: [1.0, 1.1], source: 'South Africa 1.02 (Richardson 1961, in Mandelbrot 1967); Australia 1.13 is a mix of margins' },
    'passive young': { earth: [1.0, 1.15], source: 'recalled: Red Sea and Gulf of Aden coasts, straight rift segments with transform steps' },
    active: { earth: [1.02, 1.15], source: 'recalled: the Andean coast of Peru and N Chile, straight along its coastal range' },
    collision: { earth: [1.1, 1.3], source: 'recalled: Mediterranean and Arabian Sea collision coasts; Germany\'s land frontier 1.15 (Mandelbrot 1967)' },
    arc: { earth: [1.15, 1.35], source: 'recalled: Japan, the Philippines, the Lesser Antilles — island chains' },
    glacial: { earth: [1.25, 1.55], source: 'west coast of Britain 1.25 (Richardson 1961, in Mandelbrot 1967); Norway ~1.52 (Feder 1988, recalled)' },
    all: { earth: [1.05, 1.3], source: 'world coastlines 1.1–1.3 by the divider method (recalled: e.g. Jiang & Plotnick 1998 for the US coasts)' },
};
/** The kinds' names, in the order kindOf() numbers them. */
export const COAST_KINDS = ['passive mature', 'passive young', 'active', 'collision', 'arc', 'glacial'];

/**
 * A kindAt() for coastFractal from the terrain records (records.js: coastKind, maturity on the sim mesh) — the sim cell
 * nearest the point — and, if given, where the last ice age's ice reached the coast (glaciated, per cell of the mesh the
 * loops were traced on: those coasts count as glacial whatever their margin).
 */
export function kindOf(simMesh, rec, glaciated = null, matureAt = 0.6) {
    return (cell, x, y, z) => {
        if (glaciated && glaciated[cell]) return 5;
        const w = simMesh.index.nearest(x, y, z), k = rec.coastKind[w];
        if (k === 0) return rec.maturity[w] >= matureAt ? 0 : 1;          // CoastKind.PASSIVE
        if (k === 1 || k === 2) return 2;                                  // ACTIVE, TRANSFORM
        if (k === 3) return 3;                                             // COLLISION
        return 4;                                                          // ARC
    };
}
