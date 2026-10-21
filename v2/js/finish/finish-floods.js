// F3b — the ice age's outburst floods. Where an ice sheet stood across the way a river drained, the river backed up behind
// it into a lake (Lake Missoula behind the Purcell lobe, Agassiz against the Laurentide's front, the North Sea dammed
// between the British and Scandinavian ice). Such a lake either overtops its lowest divide or floats its dam and drains
// beneath it — in days, at discharges no river reaches — and the flood cuts a swath down its way to the sea: broad tracts
// of braided channels scoured into the ground with the land left between them standing as streamlined islands (the
// Channeled Scablands), spillways notched through divides (the Minnesota's River Warren valley, the Strait of Dover), and
// where the flood ran under the ice, tunnel valleys. The lake's floor is left a flat plain of its silts (the Red River
// valley, Agassiz's bed).
//
// Found on the ice age's surface, before the ice melts: two priority floods from the ice age's sea, one over the ground
// with the ice standing on it as a wall (its surface's height), one over the bare ground. Water the first holds and the
// second does not is held by the ice: an ice-dammed lake. Each big enough floods twice — down the way the ice-walled
// ground spills (its spillway), and down the way the bare ground drains (its dam failing) — each swath as wide and as
// deep as the lake's volume (Clague & Mathews: a flood's peak grows as the lake's volume to ~⅔), fading with distance.

import { MinHeap } from '../core/min-heap.js';
import { FastNoise } from '../core/fast-noise.js';

const R = 6371;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @param {Object} ctx  { mesh, z (km, changed in place), ice (Uint8Array: under the ice age's ice), S (the ice's surface,
 *                        km; where ice), cellKm2, seed }
 * @returns {{flood: Uint8Array, lakes: number, lakeKm2: number, volumeKm3: number, largestKm3: number}}
 *          flood: how hard each cell was scoured (0–255)
 */
export function outburstFloods(ctx, F) {
    const { mesh, z, ice, S, cellKm2 } = ctx, n = mesh.numCells, { adjOffset, adjList, xyz, edgeKm } = mesh;
    const flood = new Uint8Array(n), none = { flood, lakes: 0, lakeKm2: 0, volumeKm3: 0, largestKm3: 0 };
    if (!(F.floodCutKm > 0) || !ice.includes(1)) return none;
    const sea = iceAgeSea(mesh, z, ice, cellKm2, F);
    // ── the two floods from the sea: the ice as a wall, and the bare ground ──
    const walled = new Float32Array(n);
    for (let c = 0; c < n; c++) walled[c] = ice[c] ? Math.max(z[c], S[c]) : z[c];
    const dam = spill(mesh, walled, sea, -F.iceSeaDropKm), bare = spill(mesh, z, sea, -F.iceSeaDropKm);
    // ── the lakes the ice holds: water above where the bare ground would hold it, in connected bodies ──
    const EPS = 0.001, held = c => !ice[c] && !sea[c] && dam.fill[c] > Math.max(z[c], bare.fill[c]) + EPS;
    const lakeOf = new Int32Array(n).fill(-1), lakes = [];
    for (let s = 0; s < n; s++) {
        if (lakeOf[s] >= 0 || !held(s)) continue;
        const id = lakes.length, cells = [s];
        lakeOf[s] = id;
        let vol = 0, deepest = s, outlet = s;
        for (let i = 0; i < cells.length; i++) {
            const c = cells[i];
            vol += (dam.fill[c] - Math.max(z[c], bare.fill[c])) * cellKm2;
            if (z[c] < z[deepest]) deepest = c;
            if (bare.fill[c] < bare.fill[outlet]) outlet = c;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (lakeOf[nb] < 0 && held(nb)) { lakeOf[nb] = id; cells.push(nb); } }
        }
        lakes.push({ cells, vol, deepest, outlet, km2: cells.length * cellKm2 });
    }
    const big = lakes.filter(L => L.km2 >= F.floodLakeMinKm2 && L.vol >= F.floodVolumeKm3[0]).sort((a, b) => b.vol - a.vol);
    if (!big.length) return none;
    // ── the drained lakes' floors: a plain of their silts, the deeper water the more ──
    for (const L of big) for (const c of L.cells) z[c] += Math.min(F.lakeSiltMaxKm, F.lakeSiltShare * (dam.fill[c] - z[c]));
    // ── each flood's way: the spillway (down the walled ground from the lake's deepest point, out over its sill) and the
    // dam's failure (down the bare ground from where it drains, under the ice) — from where it leaves the lake to the sea ──
    const lv0 = Math.log(F.floodVolumeKm3[0]), lv1 = Math.log(F.floodVolumeKm3[1]), paths = [];
    for (const L of big) {
        const s = smooth(lv0, lv1, Math.log(L.vol)), id = lakeOf[L.deepest];
        paths.push(wayOut(L.deepest, dam.parent, s * F.floodSpillShare, false), wayOut(L.outlet, bare.parent, s, true));
        function wayOut(from, parent, strength, underIce) {
            const cells = [], km = [];
            let c = from, d = 0, prev = -1;
            for (let guard = 0; c >= 0 && !sea[c] && guard < n; guard++, prev = c, c = parent[c]) {
                if (lakeOf[c] === id) continue;
                if (prev >= 0 && cells.length) d += R * Math.hypot(xyz[3 * c] - xyz[3 * prev], xyz[3 * c + 1] - xyz[3 * prev + 1], xyz[3 * c + 2] - xyz[3 * prev + 2]);
                if (ice[c] && !underIce) continue;          // (the spillway's water along the ice's surface cuts nothing)
                cells.push(c); km.push(d);
            }
            return { cells, km, strength };
        }
    }
    // ── the swaths: every cell near a way takes the way's cut at its nearest point (by its distance over that point's
    // half-width) — a broad scoured tract, braided into channels by a noise's zero lines, a main channel down the middle ──
    // (down each way the swath's floor never climbs: from the sea up, a cut that would sink the floor below the floor
    // downstream of it is cut short — a flood that fades as it goes would otherwise leave its upper channel a closed hollow;
    // it is cut less, never more: no divide is breached that the flood did not cross)
    const pts = [];
    for (const p of paths) {
        const depth = new Float32Array(p.cells.length), strength = new Float32Array(p.cells.length);
        let floor = -Infinity;
        for (let i = p.cells.length - 1; i >= 0; i--) {
            const c = p.cells[i], s = p.strength * Math.exp(-p.km[i] / F.floodReachKm) * (ice[c] ? F.floodUnderIce : 1);
            const want = s > 0.01 ? F.floodCutKm * (0.3 + 0.7 * s) : 0;
            floor = Math.max(floor, Math.max(z[c] - want, Math.min(z[c], F.floodFloorKm)));
            depth[i] = Math.max(0, z[c] - floor); strength[i] = s;
        }
        for (let i = 0; i < p.cells.length; i++) {
            const s = strength[i];
            if (s > 0.01 && depth[i] > 0) pts.push({ c: p.cells[i], depth: depth[i], half: F.floodWidthKm[0] + (F.floodWidthKm[1] - F.floodWidthKm[0]) * s, s });
        }
    }
    const dist = new Float32Array(n).fill(Infinity), label = new Int32Array(n).fill(-1), heap = new MinHeap(1 << 12), reached = [];
    for (let i = 0; i < pts.length; i++) { const c = pts[i].c; if (label[c] < 0 || pts[i].half > pts[label[c]].half) { label[c] = i; dist[c] = 0; } }
    for (let c = 0; c < n; c++) if (dist[c] === 0) { heap.push(0, c); reached.push(c); }
    while (heap.size) {
        const c = heap.pop(), u = heap.lastKey, p = pts[label[c]];
        if (u > dist[c] / p.half + 1e-9) continue;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (sea[nb]) continue;
            const d = dist[c] + R * Math.hypot(xyz[3 * nb] - xyz[3 * c], xyz[3 * nb + 1] - xyz[3 * c + 1], xyz[3 * nb + 2] - xyz[3 * c + 2]);
            if (d >= p.half || (label[nb] >= 0 && d / p.half >= dist[nb] / pts[label[nb]].half)) continue;
            if (label[nb] < 0) reached.push(nb);
            dist[nb] = d; label[nb] = label[c];
            heap.push(d / p.half, nb);
        }
    }
    const noise = new FastNoise(((ctx.seed | 0) * 131 + 57) >>> 0), f = R / F.floodThreadKm, show = smooth(2, 3.5, F.floodThreadKm / edgeKm);
    const cut = new Float32Array(n);
    for (const c of reached) {
        const p = pts[label[c]], u = dist[c] / p.half;
        const v = noise.fbm(xyz[3 * c] * f, xyz[3 * c + 1] * f, xyz[3 * c + 2] * f, 2, 0.5);
        const thread = show * (1 - Math.min(1, Math.abs(v) / F.floodThreadWidth)) ** 0.5 + (1 - show) * 0.35;
        const channel = Math.max(smooth(0.3, 0, u), thread);
        cut[c] = p.depth * (1 - u ** 4) * (F.floodTractShare + (1 - F.floodTractShare) * channel);
        flood[c] = Math.max(flood[c], Math.round(255 * Math.min(1, p.s * (1 - u * u))));
    }
    // (never below floodFloorKm: on a lowland near the sea a flood spreads and lays its gravel down — cut below the sea, its
    // channels would hold long lakes, kept full to the brim by the rivers that came to them)
    const keep = c => Math.min(z[c], F.floodFloorKm);
    for (const c of reached) z[c] = Math.max(z[c] - cut[c], keep(c));
    // ── near the lake, its channel's floor never climbs (the sill it spilled over, notched through) — by at most floodNotchKm
    // below the swath; no further (a whole valley levelled down its way turns rivers round and steals their basins' water) ──
    for (const p of paths) {
        let floor = Infinity;
        for (let i = 0; i < p.cells.length && p.km[i] <= F.floodNotchReachKm; i++) {
            const c = p.cells[i];
            if (z[c] > floor) z[c] = Math.max(floor, z[c] - F.floodNotchKm, keep(c));
            floor = Math.min(floor, z[c]);
        }
    }
    let lakeKm2 = 0, volumeKm3 = 0;
    for (const L of big) { lakeKm2 += L.km2; volumeKm3 += L.vol; }
    // (the biggest, with where they stood and how far their floods ran: for the stats)
    const at = c => [Math.asin(Math.max(-1, Math.min(1, xyz[3 * c + 2]))) * 180 / Math.PI, Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * 180 / Math.PI].map(v => Math.round(v * 10) / 10);
    const biggest = big.slice(0, 6).map((L, i) => ({ km2: Math.round(L.km2), km3: Math.round(L.vol), at: at(L.deepest), spillKm: Math.round(paths[2 * i].km.at(-1) ?? 0), breachKm: Math.round(paths[2 * i + 1].km.at(-1) ?? 0) }));
    return { flood, lakes: big.length, lakeKm2, volumeKm3, largestKm3: big[0].vol, biggest };
}

/** The ice age's sea: open water below its level (ice-free) in bodies that reach the deep ocean and are big enough. */
function iceAgeSea(mesh, z, ice, cellKm2, F) {
    const { adjOffset, adjList, numCells: n } = mesh, sea = new Uint8Array(n), seen = new Uint8Array(n), wet = c => !ice[c] && z[c] < -F.iceSeaDropKm;
    for (let s = 0; s < n; s++) {
        if (seen[s] || !wet(s)) continue;
        const cells = [s];
        seen[s] = 1;
        let deep = z[s] < -F.seaDeepKm;
        for (let i = 0; i < cells.length; i++) for (let k = adjOffset[cells[i]]; k < adjOffset[cells[i] + 1]; k++) {
            const nb = adjList[k];
            if (!seen[nb] && wet(nb)) { seen[nb] = 1; cells.push(nb); if (z[nb] < -F.seaDeepKm) deep = true; }
        }
        if (deep && cells.length * cellKm2 >= F.seaSeedKm2) for (const c of cells) sea[c] = 1;
    }
    return sea;
}

/** A priority flood from the sea (its water at `level`) over the ground g: each cell's spill level, and the cell it was
 *  reached from — the way its water goes to the sea. */
function spill(mesh, g, sea, level) {
    const { adjOffset, adjList, numCells: n } = mesh, fill = new Float32Array(n), parent = new Int32Array(n).fill(-1), done = new Uint8Array(n), heap = new MinHeap(1 << 16);
    for (let c = 0; c < n; c++) {
        if (!sea[c]) continue;
        done[c] = 1; fill[c] = level;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!sea[nb] && parent[nb] < 0) { parent[nb] = c; fill[nb] = Math.max(level, g[nb]); heap.push(fill[nb], nb); } }
    }
    while (heap.size) {
        const c = heap.pop();
        if (done[c]) continue;
        done[c] = 1;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (done[nb]) continue;
            const L = Math.max(fill[c], g[nb]);
            if (parent[nb] < 0 || L < fill[nb]) { parent[nb] = c; fill[nb] = L; heap.push(L, nb); }
        }
    }
    // (ground the sea never reaches — none on a planet with an ocean — holds no water)
    for (let c = 0; c < n; c++) if (!done[c]) fill[c] = g[c];
    return { fill, parent };
}
