// The pre-history ocean's ages (lane startsea A2, sessrumnir's ruling 2026-11-25). A start world's ocean floor is older
// than its history, but not of one age. Until 2026-11-25 every cell was made at −initialOceanAgeMyr (150), and its
// readers took it as 100 Myr old (the pour, the drawn floor, flexure) or at a reference depth (the reckoned sea). That
// left a ridgeless ocean all 5.27 km deep: the start's sea stood 0.84 km below datum on every seed alike, and the
// supercontinent stood ~1.8 km above it.
//
// Here the floor is dated by the process that made it: a ridge network RELICT at the start. At t0 the world reorganizes
// into its scene's plates; before that the ocean was a tessellation of oceanic plates, spreading apart at their ridges.
// Each cell's age is its distance from the nearest of those ridges at the spreading half-rate. These ridges are not the
// history's boundaries: they stop spreading at t0, so nothing new forms there and no ridge's own push acts (step/forces.js
// reads a ridge as the floor born in the history: formedAt ≥ 0). Their floor still slopes away from them, as any ocean's
// does, and the forces read that slope's gravitational potential energy as every ocean's (forces.js ridgePushGpe): a ridge
// that stopped spreading keeps pushing until its floor cools flat, as Earth's extinct ridges do. The history's
// own ridges are the ones its rifts and divergent boundaries open later. (A1, queued behind the forces work: the start's
// ocean as real plates whose ridges keep spreading.)
//
// The layout, stated as process, not fitted:
//   · the plates: prehistoryPlateKm2 each, on average (Earth's seven largest plates average ~59 Mkm²: Bird 2003, G³ 4(3),
//     1027; Panthalassa had several, Izanagi/Farallon/Phoenix: Seton et al. 2012), nucleated at random over the ocean
//     (the world's seed), grown by distance across the sphere — a Voronoi tessellation;
//   · the ridges: where two of those plates meet over ocean;
//   · the age: the distance from the nearest ridge ÷ the half-rate (prehistoryHalfRateCmYr: ~2.8 cm/yr, the global
//     length-weighted mean half-rate since 83 Ma, Müller group's rotation model, GSA 2013 Paper 229454).
// The area–age spectrum that results is a CHECK against Earth's (Parsons 1982: area falling roughly linearly with age to
// ~180 Myr), not a target: nothing here is adjusted to match it (tools: startsea a5/a6 probes).
//
// Limits (a reduced model): the ridges are the plates' Voronoi edges, not their spreading geometry (no transforms, no
// asymmetric spreading, no ridge jumps); floor is never subducted before t0, so no age is cut short by a trench except as
// the tessellation's own extent; one half-rate for every ridge. The floor beyond a plate's far edge is as old as its
// distance makes it: the age has no cap.

import { MinHeap } from '../../core/min-heap.js';
import { makeRng } from '../../../../js/rng.js';
import { CrustType } from '../model/crust.js';
import { CM_PER_YR_TO_KM_PER_MYR } from '../config.js';

/** A pre-history cell's formedAt until the start dates it (datePrehistory). Never read as an age: an undated cell left
 *  at the start throws. */
export const PREHISTORY = -Infinity;

const R = 6371;

/**
 * Date every cell a scene made at PREHISTORY: ocean (and the odd arc a scene lays on it) gets −(its age by the relict
 * ridge network). Run once, at the history's start (simulate.js), on the world's cells as the plates show them at t0.
 * @returns {{plates: number, ridgeCells: number, meanAgeMyr: number, maxAgeMyr: number}|null}  null: nothing to date
 */
export function datePrehistory(world) {
    const { mesh, plates, config } = world, n = mesh.numCells, { xyz, adjOffset, adjList } = mesh;
    // the world cells whose crust is undated, and where each one sits in its plate's raster
    const undated = new Uint8Array(n);
    let count = 0;
    for (let w = 0; w < n; w++) {
        const o = world.owner[w];
        if (o >= 0 && plates[o].crust.formedAt[world.ownerCell[w]] === PREHISTORY) { undated[w] = 1; count++; }
    }
    // (hidden cells too — a plate's raster cell no world cell shows at t0: dated at the world cell it lies over)
    let hidden = 0;
    for (const p of plates) if (p.alive) for (let c = 0; c < p.crust.mask.length; c++) if (p.crust.mask[c] && p.crust.formedAt[c] === PREHISTORY) hidden++;
    if (!count && !hidden) return null;
    const ocean = new Uint8Array(n);
    for (let w = 0; w < n; w++) if (undated[w] && plates[world.owner[w]].crust.type[world.ownerCell[w]] === CrustType.OCEAN) ocean[w] = 1;
    const oceanCells = [];
    for (let w = 0; w < n; w++) if (ocean[w]) oceanCells.push(w);
    const cellKm2 = 4 * Math.PI * R * R / n;
    const k = Math.max(1, Math.round(oceanCells.length * cellKm2 / config.prehistoryPlateKm2));
    // the plates' nuclei, at random over the pre-history ocean (each cell once)
    const rng = makeRng((world.seed ^ 0x5ea0f1) >>> 0), seeds = [], taken = new Set();
    while (seeds.length < Math.min(k, oceanCells.length)) {
        const w = oceanCells[Math.floor(rng() * oceanCells.length)];
        if (!taken.has(w)) { taken.add(w); seeds.push(w); }
    }
    // the tessellation: every cell to its nearest nucleus across the sphere (a Dijkstra on the mesh's chords)
    const region = grow(mesh, seeds, () => true).from;
    // the ridges: pre-history ocean meeting ocean of another plate; with one plate, its nucleus stands for its ridge
    // (the ridge runs along the boundary between two plates' cells, half an edge from each: a ridge cell's floor is that
    // far from it, so every pre-history age is above 0 — formedAt < 0, never read as the history's own floor)
    const ridges = [], ridgeKm = [];
    for (const w of oceanCells) {
        for (let j = adjOffset[w]; j < adjOffset[w + 1]; j++) { const q = adjList[j]; if (ocean[q] && region[q] !== region[w]) { ridges.push(w); ridgeKm.push(R * chord(xyz, w, q) / 2); break; } }
    }
    const { dist } = ridges.length ? grow(mesh, ridges, () => true, ridgeKm) : grow(mesh, seeds, () => true, seeds.map(() => mesh.edgeKm / 2));
    const kmPerMyr = config.prehistoryHalfRateCmYr * CM_PER_YR_TO_KM_PER_MYR, age = w => dist[w] / kmPerMyr;
    let sum = 0, max = 0;
    for (const w of oceanCells) { const a = age(w); sum += a; if (a > max) max = a; }
    // write the ages: each plate's undated raster cells, at the world cell they lie over (the identity at t0, but a scene
    // may have rotated a plate)
    for (const p of plates) {
        if (!p.alive) continue;
        const { mask, formedAt } = p.crust, m = p.mat;
        for (let c = 0; c < mask.length; c++) {
            if (!mask[c] || formedAt[c] !== PREHISTORY) continue;
            const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
            const w = mesh.index.nearest(m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z);
            formedAt[c] = -age(w);
        }
    }
    return { plates: seeds.length, ridgeCells: ridges.length, meanAgeMyr: oceanCells.length ? sum / oceanCells.length : 0, maxAgeMyr: max };
}

/** Multi-source Dijkstra over the mesh (chord lengths, km): each cell's distance to the nearest source and which source. */
function grow(mesh, sources, canEnter, startKm = null) {
    const n = mesh.numCells, { xyz, adjOffset, adjList } = mesh;
    const dist = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), heap = new MinHeap(n);
    sources.forEach((s, i) => { const d = startKm ? startKm[i] : 0; if (d < dist[s]) { dist[s] = d; from[s] = i; heap.push(d, s); } });
    while (heap.size) {
        const w = heap.pop();
        if (heap.lastKey > dist[w]) continue;
        for (let j = adjOffset[w]; j < adjOffset[w + 1]; j++) {
            const q = adjList[j];
            if (!canEnter(q)) continue;
            const d = dist[w] + R * chord(xyz, w, q);
            if (d < dist[q]) { dist[q] = d; from[q] = from[w]; heap.push(d, q); }
        }
    }
    return { dist, from };
}
const chord = (xyz, a, b) => Math.hypot(xyz[3 * a] - xyz[3 * b], xyz[3 * a + 1] - xyz[3 * b + 1], xyz[3 * a + 2] - xyz[3 * b + 2]);
