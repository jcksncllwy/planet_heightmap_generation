// Cratons in the terrain (Phase 10): a shield's edge as a line, not the sim cells' staircase; the ranges pressed against
// it fading across its rim; a foreland bent into it under their weight; and each shield a character of its own.
//
// What real cratons do (plans/V2_ROADMAP_PHASES_9_13.md, Phase 10 B, with sources): they are rigid — deformation piles up
// against them and goes around them — and a thrust front follows a craton's margin at the scale of its promontories
// and embayments, never finer (Thomas 1977, 2006). A stiff craton bends under a range's weight into a wide, shallow
// foreland: a foredeep 100–300 km wide filled to a lowland, with a trunk river along the range, then a forebulge tens to
// a few hundred metres high (DeCelles & Giles 1996; Watts 1992). Where a plateau's edge meets the block the front is abrupt
// (the Longmen Shan against the Sichuan Basin). Shield interiors are calm but not blank: basins and swells 1,000–2,000
// km apart, saucer-shaped sag basins, a faint grain of granite domes between greenstone keels.
//
// Measured per plate on its own raster (as the coast is, records.js plateCoasts), so it rides with the crust.

import { CrustType } from '../tectonics/model/crust.js';
import { spreadKm } from '../core/min-heap.js';
import { rasterToWorld, cellRng } from './anchor.js';
import { FLEX, elasticThicknessKm, stiffnessKm4, solvePlateCPU } from '../gpu/flexure.js';

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
    const teW = elasticThicknessKm(frame, simMesh), B = new Float64Array(n), s = new Float64Array(n), qm = new Float64Array(n), sea = new Uint8Array(n);
    const sS = (FLEX.mantleRho - FLEX.sedimentRho) / FLEX.mantleRho, sW = (FLEX.mantleRho - FLEX.waterRho) / FLEX.mantleRho;
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
        // it stands at that its own root does not float, km of rock) on the plate as a thin elastic plate over the mantle
        // (gpu/flexure.js: D∇⁴w + Δρg w = q on this raster, Te per cell from the column — elasticThicknessKm: a shield's 70,
        // its belts' weaker plate). The trough fills to its base level with sediment, and the fill is load: under it the
        // plate floats on ρm − ρs, not ρm (a wide load sinks it ρc/(ρm − ρs) × its height); a forebulge stands in air, and
        // the sea floor's trough holds water — so the fill is where the plate bends down, solved again until that settles.
        // The thrusts riding up onto the shield's rim load it where they stand, and a range far from the shield loads it
        // little (Turcotte & Schubert 2002 §3.15–3.17; Beaumont 1981; DeCelles & Giles 1996). On the craton only: the rest
        // of the plate's basins are the belts' own profiles.
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
            // (Te, the sea and the load on the plate's raster: a cell's world cell where the world shows the plate there; hidden
            // crust — thrust under another plate — a shield's or a continent's own Te; else the world cell over it)
            for (let r = 0; r < n; r++) {
                let w = rasterToWorld(A, simMesh, o, r);
                if (w < 0 && cls[r] < 0) {
                    const x = xyz[3 * r], y = xyz[3 * r + 1], z = xyz[3 * r + 2];
                    w = simMesh.index.nearest(m[b] * x + m[b + 1] * y + m[b + 2] * z, m[b + 3] * x + m[b + 4] * y + m[b + 5] * z, m[b + 6] * x + m[b + 7] * y + m[b + 8] * z);
                }
                const te = w >= 0 ? teW[w] : cls[r] === 1 ? FLEX.cratonTeKm : FLEX.continentTeKm;
                B[r] = stiffnessKm4(te); sea[r] = cls[r] < 0 && w >= 0 && frame.type[w] === CrustType.OCEAN ? 1 : 0;
                qm[r] = FLEX.rockRho / FLEX.mantleRho * load[r];
                s[r] = sea[r] ? sW : sS;
            }
            // (the fill where the plate bends down, air where it bends up: solved again from the last answer until no cell changes)
            let wq = null;
            for (let pass = 0; pass < 8; pass++) {
                wq = solvePlateCPU(simMesh, B, s, qm, { tol: 1e-3, w0: wq }).w;      // (1e-3: within ~6 m of 1e-6 on 831576, at a third of its cost)
                let changed = 0;
                for (let r = 0; r < n; r++) if (!sea[r]) { const want = wq[r] > 0 ? sS : 1; if (want !== s[r]) { s[r] = want; changed++; } }
                if (!changed) break;
            }
            for (let r = 0; r < n; r++) if (cls[r] === 1) sink[r] = wq[r];
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
