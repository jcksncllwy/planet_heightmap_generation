// The shape of a river network, against Earth's: measured on any receiver tree on a sphere mesh — the carve's
// (terrain/carve.js: recv −1 − s into sea cell s) or the finish's rivers (finish-hydro.js hydrology: recv the next cell,
// a sea cell where the river ends). Everything in km and km² (drainage areas here are the land's own, not weighted by
// rain), so a network measured at 640K and at 10M cells is measured alike; the junction angle and the sinuosity are
// read at the mesh's own scale (a few cells), as a map traced at that resolution would show them.
//   · Hack's law: the main stream's length L ∝ A^h over drainage areas A (Hack 1957; h 0.5–0.6);
//   · Horton's bifurcation ratio R_B: streams of each Strahler order, N_ω ∝ R_B^−ω (Horton 1945; Strahler 1957; 3–5) —
//     note Kirchner 1993: almost any random branching tree gives 3–5 too, so it catches a broken network, not a good one;
//   · junction angles: the angle between the two branches above a confluence (Seybold, Rothman & Kirchner 2017: ~45° in
//     arid climates to ~72° in humid ones);
//   · sinuosity at the mesh's scale: a river's length along its cells over the straight distance, reach by reach;
//   · the gradient of rivers across the plains (the alluvial plain's own slope, ~1e-5–1e-4 on Earth).

const R = 6371;
const chordKm = (xyz, a, b) => R * Math.hypot(xyz[3 * a] - xyz[3 * b], xyz[3 * a + 1] - xyz[3 * b + 1], xyz[3 * a + 2] - xyz[3 * b + 2]);
const quantile = (a, p) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/**
 * @param {{mesh: Object, recv: Int32Array, land: (c: number) => boolean, z: Float32Array, lake?: Uint8Array|null,
 *          arid?: (c: number) => boolean}} net
 *   recv: each cell's receiver (any cell; a negative value or a cell not on `land` ends the river there); `lake`: cells
 *   under a lake (no channel there, its water passing on); `arid`: a climate split for the junction angles
 * @param {{channelKm2?: number, hackKm2?: [number, number], junctionCells?: number, reachKm?: number, plainKm?: number,
 *          bigKm2?: number}} o
 *   channelKm2: what counts as a channel (Strahler's streams, junctions, reaches); hackKm2: the areas Hack's law is fit
 *   over; junctionCells: how many cells up each branch the junction angle is read over; reachKm: the reach the
 *   sinuosity and the plain's gradient are read over; plainKm: the height below which ground is plain
 */
export function networkShape(net, o = {}) {
    const { mesh, recv, land, z, lake = null } = net, { xyz, adjOffset, adjList, numCells: n } = mesh;
    const cellKm2 = 4 * Math.PI * R * R / n, edgeKm = Math.sqrt(cellKm2 * 2 / Math.sqrt(3));
    const channelKm2 = o.channelKm2 ?? 1e4, [hackLo, hackHi] = o.hackKm2 ?? [1e4, 1e6], jCells = o.junctionCells ?? 4;
    const reachKm = Math.max(o.reachKm ?? 200, 6 * edgeKm), plainKm = o.plainKm ?? 0.3;
    // ── the tree: each land cell's next cell down (−1: it ends here), donors counted, then upstream first (Kahn) ──
    const next = new Int32Array(n).fill(-1), indeg = new Int32Array(n), on = new Uint8Array(n), stepKm = new Float32Array(n);
    for (let c = 0; c < n; c++) if (land(c)) on[c] = 1;
    for (let c = 0; c < n; c++) {
        if (!on[c]) continue;
        const r = recv[c];
        stepKm[c] = r >= 0 ? chordKm(xyz, c, r) : 0;
        if (r >= 0 && on[r] && r !== c) { next[c] = r; indeg[r]++; }
    }
    const order = new Int32Array(n), deg = indeg.slice();
    let head = 0, tail = 0;
    for (let c = 0; c < n; c++) if (on[c] && deg[c] === 0) order[tail++] = c;
    while (head < tail) { const c = order[head++], r = next[c]; if (r >= 0 && --deg[r] === 0) order[tail++] = r; }
    const count = tail;                                              // (cells on a loop, if any, are never reached)
    // ── drainage area (km², the land's own) and the main stream's length above each cell (to its farthest source) ──
    const A = new Float64Array(n), L = new Float64Array(n);
    for (let i = 0; i < count; i++) { const c = order[i]; A[c] += cellKm2; const r = next[c]; if (r >= 0) { A[r] += A[c]; if (L[c] + stepKm[c] > L[r]) L[r] = L[c] + stepKm[c]; } }
    // ── Hack's law: medians of log L in bins of log A, a line through them (each bin one vote, not each cell) ──
    const bins = new Map();
    for (let i = 0; i < count; i++) {
        const c = order[i];
        if (A[c] < hackLo || A[c] > hackHi || !(L[c] > 0)) continue;
        const b = Math.floor(4 * Math.log10(A[c]));
        if (!bins.has(b)) bins.set(b, []);
        bins.get(b).push(Math.log10(L[c]));
    }
    const pts = [...bins].filter(([, v]) => v.length >= 5).map(([b, v]) => [(b + 0.5) / 4, quantile(v, 0.5)]);
    const hack = { h: fit(pts).slope, bins: pts.length };
    // ── Strahler's orders of the channels, and the streams of each order (a stream ends where its order changes) ──
    const chan = c => A[c] >= channelKm2 && !(lake && lake[c]);
    const ord = new Uint8Array(n), mx = new Uint8Array(n), cnt = new Uint8Array(n), streams = [];
    for (let i = 0; i < count; i++) {
        const c = order[i];
        if (!chan(c)) continue;
        const w = mx[c] === 0 ? 1 : cnt[c] >= 2 ? mx[c] + 1 : mx[c];
        ord[c] = w;
        const r = next[c];
        if (r >= 0 && chan(r)) { if (w > mx[r]) { mx[r] = w; cnt[r] = 1; } else if (w === mx[r]) cnt[r] = Math.min(255, cnt[r] + 1); }
    }
    for (let i = 0; i < count; i++) {
        const c = order[i];
        if (!ord[c]) continue;
        const r = next[c];
        if (r < 0 || !chan(r) || ord[r] !== ord[c]) streams[ord[c]] = (streams[ord[c]] ?? 0) + 1;
    }
    const N = Array.from({ length: streams.length }, (_, w) => streams[w] ?? 0).slice(1), top = N.length;
    // (the highest order left out — its streams are the few trunks whatever the network — and orders with under 5 streams)
    const hp = N.slice(0, Math.max(0, top - 1)).map((v, i) => [i + 1, Math.log10(v)]).filter(([, lv]) => lv >= Math.log10(5));
    const horton = { rb: hp.length >= 2 ? 10 ** -fit(hp).slope : NaN, counts: N };
    // ── junction angles: at each confluence of two channels, the angle between the two branches, each read up its own
    // main stem (the bigger donor at each step) over jCells cells, on the tangent plane at the confluence ──
    const donAt = new Int32Array(n + 1);
    for (let c = 0; c < n; c++) if (next[c] >= 0) donAt[next[c] + 1]++;
    for (let c = 0; c < n; c++) donAt[c + 1] += donAt[c];
    const donors = new Int32Array(donAt[n]), fillAt = donAt.slice(0, n);
    for (let c = 0; c < n; c++) if (next[c] >= 0) donors[fillAt[next[c]]++] = c;
    const up = c => { let best = -1; for (let k = donAt[c]; k < donAt[c + 1]; k++) if (best < 0 || A[donors[k]] > A[best]) best = donors[k]; return best; };
    const angles = [], aridAngles = [], humidAngles = [], v = [0, 0, 0], u = [0, 0, 0];
    for (let c = 0; c < n; c++) {
        if (!chan(c)) continue;
        let a = -1, b = -1;
        for (let k = donAt[c]; k < donAt[c + 1]; k++) { const d = donors[k]; if (!chan(d)) continue; if (a < 0 || A[d] > A[a]) { b = a; a = d; } else if (b < 0 || A[d] > A[b]) b = d; }
        if (b < 0) continue;
        const pa = climb(a, jCells, up), pb = climb(b, jCells, up);
        tangent(xyz, c, pa, v); tangent(xyz, c, pb, u);
        const dot = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / Math.max(1e-12, Math.hypot(...v) * Math.hypot(...u));
        const deg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
        angles.push(deg);
        if (net.arid) (net.arid(c) ? aridAngles : humidAngles).push(deg);
    }
    const junction = { medianDeg: quantile(angles, 0.5), n: angles.length, aridDeg: quantile(aridAngles, 0.5), aridN: aridAngles.length, humidDeg: quantile(humidAngles, 0.5), humidN: humidAngles.length };
    // ── sinuosity and the plain's gradient, reach by reach down each channel (a reach of reachKm along it, from every
    // channel cell): along ÷ straight; and across the plains (ground under plainKm), the fall over the reach ÷ its length ──
    const sinAll = [], sinPlain = [], grade = [];
    for (let c = 0; c < n; c++) {
        if (!chan(c)) continue;
        let x = c, along = 0, steps = 0, plain = z[c] < plainKm;
        while (along < reachKm && next[x] >= 0 && steps < 10000) { along += stepKm[x]; x = next[x]; steps++; if (!(z[x] < plainKm)) plain = false; }
        if (along < reachKm || steps < 3) continue;
        const s = along / Math.max(1e-9, arcKm(xyz, c, x));
        sinAll.push(s);
        if (plain) { sinPlain.push(s); grade.push(Math.max(0, z[c] - z[x]) / along); }
    }
    const sinuosity = { median: quantile(sinAll, 0.5), p90: quantile(sinAll, 0.9), n: sinAll.length, plainMedian: quantile(sinPlain, 0.5), plainP90: quantile(sinPlain, 0.9), plainN: sinPlain.length, reachKm };
    const plainGrade = { median: quantile(grade, 0.5), p10: quantile(grade, 0.1), p90: quantile(grade, 0.9), n: grade.length, flat: grade.filter(g => g < 1e-6).length / Math.max(1, grade.length) };
    // ── the "broom" (lane rivers2, 2026-10-29): channels drawn dead straight and unbranched across low ground, converging
    // on one junction — the way rivers cross a surface with no relief of its own, where any rule that breaks the ties
    // draws straight lines. Read at any height (a basin's floor at 400 m is as level as a coastal plain), on low-gradient
    // ground: the reach's own fall under lowGrade. Two measures:
    //   · reaches dead flat: of the reachKm reaches on low ground, the share that falls under 1e-6 — no alluvial river
    //     does over 200 km (the flattest great rivers fall ~1e-5: the lower Amazon, ~2e-5);
    //   · dead-straight unbranched runs: the channel length on low ground in links (source or confluence to the next
    //     confluence) of at least linkKm (200 km) whose sinuosity is under straightMax. Straight reaches are rare on Earth even
    //     over ten channel widths (Leopold & Wolman 1957); a link hundreds of km long that neither bends nor gathers a
    //     tributary is the broom's bristle. At the mesh's scale a path down an even slope steps cell to cell and reads
    //     ~1.03–1.08, so straightMax is 1.05 ──
    const lowGrade = o.lowGrade ?? 2e-4, linkKm = Math.max(o.linkKm ?? 200, 6 * edgeKm), straightMax = o.straightMax ?? 1.05;
    let lowReaches = 0, flatReaches = 0, riseReaches = 0;
    for (let c = 0; c < n; c++) {
        if (!chan(c)) continue;
        let x = c, along = 0, steps = 0, wet = false;
        while (along < reachKm && next[x] >= 0 && steps < 10000) { along += stepKm[x]; x = next[x]; steps++; if (lake && lake[x]) wet = true; }
        // (a reach through a lake is not counted: the water's surface is level on Earth too, and drawn as water)
        if (along < reachKm || steps < 3 || wet) continue;
        const g = (z[c] - z[x]) / along;
        // (a reach that rises — routed across a dry hollow at its spill level — is the routing's, not a level plain's)
        if (g < lowGrade) { lowReaches++; if (g < -1e-6) riseReaches++; else if (g < 1e-6) flatReaches++; }
    }
    const chanDonors = new Uint8Array(n);
    for (let c = 0; c < n; c++) if (chan(c) && next[c] >= 0 && chan(next[c]) && chanDonors[next[c]] < 255) chanDonors[next[c]]++;
    let lowKm = 0, straightKm = 0, links = 0;
    for (let c = 0; c < n; c++) {
        if (!chan(c) || chanDonors[c] === 1) continue;               // (a link starts at a source or a confluence)
        let x = c, along = 0, steps = 0;
        while (next[x] >= 0 && chan(next[x]) && steps < 100000) { along += stepKm[x]; x = next[x]; steps++; if (chanDonors[x] >= 2) break; }
        if (along < linkKm || steps < 4 || (z[c] - z[x]) / along > lowGrade) continue;
        links++; lowKm += along;
        if (along / Math.max(1e-9, arcKm(xyz, c, x)) < straightMax) straightKm += along;
    }
    const broom = { flatShare: flatReaches / Math.max(1, lowReaches), riseShare: riseReaches / Math.max(1, lowReaches), lowReaches, straightShare: straightKm / Math.max(1e-9, lowKm), links, linkKm };
    return { hack, horton, junction, sinuosity, plainGrade, broom, edgeKm, cells: count };
}

/** A one-line summary of networkShape's result. */
export function describe(S) {
    const g = v => (Number.isFinite(v) ? v.toExponential(1) : '—');
    return `Hack h ${S.hack.h.toFixed(2)} · Horton R_B ${S.horton.rb.toFixed(2)} (${S.horton.counts.join('/')}) · junctions ${S.junction.medianDeg.toFixed(0)}° (n ${S.junction.n}; arid ${S.junction.aridDeg?.toFixed?.(0)}° humid ${S.junction.humidDeg?.toFixed?.(0)}°) · sinuosity ${S.sinuosity.median.toFixed(2)} (p90 ${S.sinuosity.p90.toFixed(2)}; plains ${S.sinuosity.plainMedian.toFixed(2)}, p90 ${S.sinuosity.plainP90.toFixed(2)}, n ${S.sinuosity.plainN}) over ${S.sinuosity.reachKm.toFixed(0)} km · plain gradient ${g(S.plainGrade.median)} (flat ${(100 * S.plainGrade.flat).toFixed(0)} %, p10 ${g(S.plainGrade.p10)}, p90 ${g(S.plainGrade.p90)}, n ${S.plainGrade.n})` +
        ` · low ground: reaches dead flat ${(100 * S.broom.flatShare).toFixed(0)} % (rising ${(100 * S.broom.riseShare).toFixed(0)} %, n ${S.broom.lowReaches}), dead-straight unbranched runs ${(100 * S.broom.straightShare).toFixed(0)} % (${S.broom.links} links ≥ ${S.broom.linkKm.toFixed(0)} km)`;
}

function climb(c, cells, up) { let x = c; for (let i = 1; i < cells; i++) { const u = up(x); if (u < 0) break; x = u; } return x; }
/** The direction from cell a toward cell b on the tangent plane at a. */
function tangent(xyz, a, b, out) {
    const ax = xyz[3 * a], ay = xyz[3 * a + 1], az = xyz[3 * a + 2], dx = xyz[3 * b] - ax, dy = xyz[3 * b + 1] - ay, dz = xyz[3 * b + 2] - az, d = dx * ax + dy * ay + dz * az;
    out[0] = dx - d * ax; out[1] = dy - d * ay; out[2] = dz - d * az;
}
function arcKm(xyz, a, b) { return 2 * R * Math.asin(Math.min(1, 0.5 * chordKm(xyz, a, b) / R)); }
function fit(pts) {
    if (pts.length < 2) return { slope: NaN };
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const k = pts.length;
    return { slope: (k * sxy - sx * sy) / (k * sxx - sx * sx) };
}
