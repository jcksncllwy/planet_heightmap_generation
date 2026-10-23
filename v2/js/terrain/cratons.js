// Cratons in the terrain (Phase 10): a shield's edge as a line, not the sim cells' staircase; the ranges pressed against
// it fading across its rim; a foreland bent into it under their weight; and each shield a character of its own.
//
// What real cratons do (plans/V2_ROADMAP_PHASES_9_13.md, Phase 10 B, with sources): they are rigid — deformation piles up
// against them and goes around them — and a thrust front follows a craton's margin at the scale of its promontories
// and embayments, never finer (Thomas 1977, 2006). A stiff craton bends under a range's weight into a wide, shallow
// foreland: a foredeep 100–300 km wide filled to a lowland, with a trunk river along the range, then a forebulge only
// tens of metres high (DeCelles & Giles 1996; Watts 1992). Where a plateau's edge meets the block the front is abrupt
// (the Longmen Shan against the Sichuan Basin). Shield interiors are calm but not blank: basins and swells 1,000–2,000
// km apart, saucer-shaped sag basins, a faint grain of granite domes between greenstone keels.
//
// Measured per plate on its own raster (as the coast is, records.js plateCoasts), so it rides with the crust.

import { CrustType } from '../tectonics/model/crust.js';
import { spreadKm } from '../core/min-heap.js';
import { rasterToWorld, cellRng } from './anchor.js';

const R = 6371, FAR = 2000;

/**
 * Per plate that holds craton: the signed distance to the craton's edge (km, + inside the craton — any craton: two
 * welded shields read as one), how far the shield is bent down under the ranges on its plate (km: a foredeep, + down;
 * a forebulge, − — the flexure of a stiff plate under every load on it), and the depth of the craton patch each cell belongs to (its deepest point from
 * the edge: a scrap of a few cells is shallow). As rasters for the plates that moved (the terrain reads them there), and
 * per world cell for the rest.
 * @param {Float32Array} loadW      per world cell: the load a belt here puts on its own plate (km of uncompensated height; records.js)
 * @param {Float32Array} loadFull   …and on a plate thrust under it (its whole height)
 * @param {Float32Array} loadOver   …the same, for an upper plate's collision belt only: what rides over a lower plate's
 *                                  lithosphere beyond its crust
 */
export function plateCratons(simMesh, A, frame, loadW, loadFull, loadOver, cfg) {
    const { xyz, numCells: n, adjOffset, adjList } = simMesh;
    const depthW = new Float32Array(n).fill(-FAR), loadOut = new Float32Array(n), patchW = new Float32Array(n), rasters = new Map();
    const byPlate = new Map();
    for (let w = 0; w < n; w++) { const o = A.owner[w]; if (o >= 0) (byPlate.get(o) ?? byPlate.set(o, []).get(o)).push(w); }
    const runs = new Map();
    if (frame.crustCells) for (let i = 0; i < frame.crustCells.length; i++) { const o = Math.floor(frame.crustCells[i] / n); const r = runs.get(o); if (r) r.end = i + 1; else runs.set(o, { start: i, end: i + 1 }); }
    const cls = new Int8Array(n), d = new Float32Array(n), load = new Float32Array(n), next = new Float32Array(n), sink = new Float32Array(n), near = new Float32Array(n);
    const alpha = flexuralLengthKm(cfg.shieldElasticKm), cellKm2 = 4 * Math.PI * R * R / n, mark = new Uint32Array(n), ring = [];
    let stamp = 0;
    const half = (a, b) => 0.5 * R * Math.acos(Math.min(1, xyz[3 * a] * xyz[3 * b] + xyz[3 * a + 1] * xyz[3 * b + 1] + xyz[3 * a + 2] * xyz[3 * b + 2]));
    for (const o of [...byPlate.keys()].sort((a, b) => a - b)) {
        const cells = byPlate.get(o), run = runs.get(o);
        // which raster cells are craton: the plate's own crust where the frame carries it (its hidden cells too), else
        // the world view
        cls.fill(-1);
        let any = false;
        if (run) for (let i = run.start; i < run.end; i++) { const r = frame.crustCells[i] - o * n, c = frame.crustType[i] === CrustType.CRATON ? 1 : 0; cls[r] = c; any ||= c === 1; }
        else for (const w of cells) { const c = frame.type[w] === CrustType.CRATON ? 1 : 0; cls[A.cell[w]] = c; any ||= c === 1; }
        if (!any) continue;
        // the edge: half the distance between a craton cell and a neighbour that is not
        d.fill(Infinity);
        for (let r = 0; r < n; r++) {
            if (cls[r] < 0) continue;
            for (let k = adjOffset[r]; k < adjOffset[r + 1]; k++) {
                const q = adjList[k];
                if (cls[q] < 0 || cls[q] === cls[r]) continue;
                const h = half(r, q);
                if (h < d[r]) d[r] = h;
            }
        }
        spreadKm(simMesh, d, { canEnter: (a, q) => cls[q] >= 0 && cls[q] === cls[a], maxKm: FAR });
        // the foreland: the shield bent down under the ranges on its plate — every belt cell's load (records.js: the height
        // it stands at that its own root does not float, km) spread through the plate as a thin elastic plate over the
        // mantle bends, summed (flexure is linear). A point load bends such a plate as −kei(r/ℓ), Kelvin's function, ℓ =
        // (D/Δρg)^¼ = α/√2: down under the load, through zero at r ≈ 3.9ℓ, then a forebulge ~1 % as high — normalised over
        // the plane (∫ −kei(r/ℓ) dA = 2πℓ²), so a load spread far and wide sinks the plate by foredeepPerKm × its height, as
        // Airy would. Loads ride on the plate's own raster: the thrusts riding up onto the shield's rim load it where they
        // stand, and a range far from the shield loads it little (Brotchie & Silvester 1969; Turcotte & Schubert 2002
        // §3.15–3.17; Beaumont 1981). On the craton only: the rest of the plate's basins are the belts' own profiles.
        load.fill(0);
        let loaded = false;
        // (a cell of the plate's crust that another plate's crust overlies — the lower plate of a collision, thrust under the
        // upper's front — carries that crust's whole weight: the plate under it bends, not the root above)
        const m = A.mats, b = 9 * o;
        for (let r = 0; r < n; r++) {
            if (cls[r] < 0) continue;
            const w = rasterToWorld(A, simMesh, o, r);
            let q = 0;
            if (w >= 0) q = loadW[w];
            else {
                const x = xyz[3 * r], y = xyz[3 * r + 1], z = xyz[3 * r + 2];
                const v = simMesh.index.nearest(m[b] * x + m[b + 1] * y + m[b + 2] * z, m[b + 3] * x + m[b + 4] * y + m[b + 5] * z, m[b + 6] * x + m[b + 7] * y + m[b + 8] * z);
                if (v >= 0 && A.owner[v] !== o) q = loadFull[v];
            }
            if (q > 0) { load[r] = q; loaded = true; }
        }
        // (and the lithosphere goes on under the upper plate's front beyond the crust the world shows of it — India's under
        // southern Tibet: an upper side's belt within underthrustKm of the plate weighs on it with its whole height, as
        // loads beyond the plate's own cells, on the raster cell under them)
        if (cfg.underthrustKm > 0) {
            near.fill(Infinity);
            for (const w of cells) near[w] = 0;
            spreadKm(simMesh, near, { maxKm: cfg.underthrustKm });
            for (let v = 0; v < n; v++) {
                if (!(near[v] > 0 && near[v] <= cfg.underthrustKm) || !(loadOver[v] > 0) || A.owner[v] === o) continue;
                const x = xyz[3 * v], y = xyz[3 * v + 1], z = xyz[3 * v + 2];
                const r = simMesh.index.nearest(m[b] * x + m[b + 3] * y + m[b + 6] * z, m[b + 1] * x + m[b + 4] * y + m[b + 7] * z, m[b + 2] * x + m[b + 5] * y + m[b + 8] * z);
                if (cls[r] >= 0) continue;                  // (over the plate's own crust: counted above, as hidden crust)
                load[r] += loadOver[v]; loaded = true;
            }
        }
        sink.fill(0);
        if (loaded) {
            const ell = alpha / Math.SQRT2, reachKm = KEI_MAX * ell, norm = cfg.foredeepPerKm * cellKm2 / (2 * Math.PI * ell * ell);
            for (let s = 0; s < n; s++) {
                if (!(load[s] > 0)) continue;
                // (the cells within reach of the load, ring by ring; the bend by the straight distance)
                const q0 = norm * load[s], sx = xyz[3 * s], sy = xyz[3 * s + 1], sz = xyz[3 * s + 2];
                stamp++; ring.length = 0; ring.push(s); mark[s] = stamp;
                for (let i = 0; i < ring.length; i++) {
                    const r = ring[i];
                    if (cls[r] === 1) sink[r] += q0 * bend(R * Math.acos(Math.min(1, sx * xyz[3 * r] + sy * xyz[3 * r + 1] + sz * xyz[3 * r + 2])) / ell);
                    for (let k = adjOffset[r]; k < adjOffset[r + 1]; k++) {
                        const q = adjList[k];
                        if (mark[q] === stamp) continue;
                        mark[q] = stamp;
                        if (R * Math.acos(Math.min(1, sx * xyz[3 * q] + sy * xyz[3 * q + 1] + sz * xyz[3 * q + 2])) <= reachKm) ring.push(q);
                    }
                }
            }
            // (a foredeep fills with sediment to a plain: no deeper than foredeepMaxKm below the shield)
            for (let r = 0; r < n; r++) if (sink[r] > cfg.foredeepMaxKm) sink[r] = cfg.foredeepMaxKm;
            // (just outside the shield, the bend of the nearest craton cell: the terrain blends across the edge line)
            for (let r = 0; r < n; r++) {
                if (cls[r] !== 0) continue;
                let s = 0, m = 0;
                for (let k = adjOffset[r]; k < adjOffset[r + 1]; k++) { const q = adjList[k]; if (cls[q] === 1) { s += sink[q]; m++; } }
                if (m) next[r] = s / m; else next[r] = 0;
            }
            for (let r = 0; r < n; r++) if (cls[r] === 0) sink[r] = next[r];
        }
        // craton patches (connected craton cells): each one's depth — its deepest point from the edge
        const patchDepth = new Float32Array(n), seen = new Uint8Array(n), queue = [];
        for (let r0 = 0; r0 < n; r0++) {
            if (cls[r0] !== 1 || seen[r0]) continue;
            queue.length = 0; queue.push(r0); seen[r0] = 1;
            let deepest = 0;
            for (let i = 0; i < queue.length; i++) {
                const r = queue[i];
                if (d[r] < Infinity && d[r] > deepest) deepest = d[r];
                for (let k = adjOffset[r]; k < adjOffset[r + 1]; k++) { const q = adjList[k]; if (cls[q] === 1 && !seen[q]) { seen[q] = 1; queue.push(q); } }
            }
            for (const r of queue) patchDepth[r] = deepest;
        }
        const depth = new Float32Array(n).fill(NaN), loadR = new Float32Array(n), patchR = new Float32Array(n);
        for (let r = 0; r < n; r++) {
            if (cls[r] < 0) continue;
            const dd = Math.min(FAR, d[r]);
            depth[r] = cls[r] ? dd : -dd; loadR[r] = sink[r]; patchR[r] = patchDepth[r];
        }
        rasters.set(o, { depth, load: loadR, patch: patchR });
        for (const w of cells) { const r = A.cell[w]; if (depth[r] === depth[r]) { depthW[w] = depth[r]; loadOut[w] = loadR[r]; patchW[w] = patchR[r]; } }
    }
    return { depthW, loadW: loadOut, patchW, rasters, characters: new Map() };
}

/**
 * A craton's character, keyed by its terrane (its own stream): a sag basin (a low interior plain, the Congo, Hudson
 * Bay), a swell (a high shield, the Kalahari) or a flat shield; how strong (× 0.7–1.3); and where its shape's noise
 * starts. Cached on the craton records.
 */
export function cratonCharacter(C, seed, terrane) {
    let ch = C.characters.get(terrane);
    if (!ch) {
        const rng = cellRng(seed, terrane, 41), r = rng();
        ch = { kind: r < 0.38 ? -1 : r < 0.76 ? 1 : 0, amp: 0.7 + 0.6 * rng(), salt: 13.7 * rng() };
        C.characters.set(terrane, ch);
    }
    return ch;
}

/** The flexural length α (km) of a lithosphere `elasticKm` thick elastically, under a load whose deflection fills with sediment. */
export function flexuralLengthKm(elasticKm) {
    const E = 70e9, nu = 0.25, dRho = 900, g = 9.81, te = elasticKm * 1000;
    return (4 * E * te ** 3 / (12 * (1 - nu * nu)) / (dRho * g)) ** 0.25 / 1000;
}

/** Kelvin's function kei(x), by its power series (exact to ~1e-6 over 0 < x ≤ KEI_MAX; Abramowitz & Stegun 9.9.12). */
function kei(x) {
    const y = x * x / 4;
    let ber = 0, bei = 0, s = 0, f2k = 1, psi = 1 - 0.5772156649015329;        // (2k)!; ψ(2k + 2)
    for (let k = 0; k < 30; k++) {
        const f2k1 = f2k * (2 * k + 1), sign = k % 2 ? -1 : 1, b = sign * y ** (2 * k + 1) / (f2k1 * f2k1);
        ber += sign * y ** (2 * k) / (f2k * f2k); bei += b; s += b * psi;
        f2k = f2k1 * (2 * k + 2); psi += 1 / (2 * k + 2) + 1 / (2 * k + 3);
    }
    return -Math.log(x / 2) * bei - Math.PI / 4 * ber + s;
}
/** The bend of a thin elastic plate under a point load, −kei(x) (x: the distance over ℓ), tabulated to x = KEI_MAX. */
const KEI_MAX = 6, KEI_STEPS = 1200, KEI_TABLE = Float64Array.from({ length: KEI_STEPS + 1 }, (_, i) => -kei(Math.max(1e-6, i * KEI_MAX / KEI_STEPS)));
const bend = x => { if (!(x < KEI_MAX)) return 0; const f = x * KEI_STEPS / KEI_MAX, i = Math.floor(f), t = f - i; return KEI_TABLE[i] + t * (KEI_TABLE[i + 1] - KEI_TABLE[i]); };
