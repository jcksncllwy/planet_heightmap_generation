// The water on a finished planet's land: its lakes against Earth's, and the land below its spill (lane basins, 2026-10-29):
// for tools/trace-basins.mjs and tools/check-basins.mjs.
import { Water } from '../../js/finish/finish-hydro.js';
import { MinHeap } from '../../js/core/min-heap.js';
import { CrustType } from '../../js/tectonics/model/crust.js';
import { seaFilledUp } from '../../js/tectonics/measure.js';

const R = 6371, deg = 180 / Math.PI;
const latLon = (xyz, c) => `${(Math.asin(Math.max(-1, Math.min(1, xyz[3 * c + 2]))) * deg).toFixed(1)}°, ${(Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * deg).toFixed(1)}°`;

/**
 * A finished planet's water on its land (finish/finish.js finishPlanet's result, at its terrain mesh): the land's area and
 * mean height; its lakes (fresh and salt, each body: area, deepest water, level, where — and whether it lies on a cut-off
 * sea's floor, by the history frame under it, or on land; and how much of it lies over `histDepth`, the history's hollows
 * per sim cell, if given); its playas; and the land below its spill — a priority flood from the ocean over the finished
 * ground, a lake's floor not its water. Lengths km, areas km², volumes km³.
 */
export function landWater(fin, simMesh, frame, histDepth = null) {
    const { mesh, z, ocean, lake } = fin, { adjOffset, adjList, numCells: n, xyz } = mesh, cellKm2 = 4 * Math.PI * R * R / n;
    let landKm2 = 0, wetKm2 = 0, panKm2 = 0, zKm3 = 0, zKm2 = 0;
    for (let c = 0; c < n; c++) if (!ocean[c]) { landKm2 += cellKm2; if (Number.isFinite(z[c])) { zKm3 += z[c] * cellKm2; zKm2 += cellKm2; } if (lake[c] === Water.FRESH || lake[c] === Water.SALT) wetKm2 += cellKm2; else if (lake[c] === Water.PAN) panKm2 += cellKm2; }
    // lakes, each body: area, deepest water, where, and the history's hollow under it
    const comp = new Int32Array(n).fill(-1), lakes = [];
    for (let c0 = 0; c0 < n; c0++) {
        if (comp[c0] >= 0 || !(lake[c0] === Water.FRESH || lake[c0] === Water.SALT)) continue;
        const q = [c0]; comp[c0] = lakes.length;
        for (let i = 0; i < q.length; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const nb = adjList[k]; if (comp[nb] < 0 && lake[nb] === lake[c0]) { comp[nb] = lakes.length; q.push(nb); } }
        let deep = c0;
        for (const c of q) if (fin.lakeLevel[c] - z[c] > fin.lakeLevel[deep] - z[deep]) deep = c;
        const s = simMesh.index.nearest(xyz[3 * deep], xyz[3 * deep + 1], xyz[3 * deep + 2]);
        // (and the crust under it: a body a quarter of which lies on open sea floor — a back-arc basin closed by its arc, a
        // sea cut off — is a remnant of the sea, not a lake on the land)
        let under = 0, onSea = 0;
        for (const c of q) {
            const w = simMesh.index.nearest(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]);
            if (histDepth?.[w] > 0.01) under++;
            if (frame.owner[w] < 0 || (frame.type[w] === CrustType.OCEAN && !seaFilledUp(frame.time - frame.formedAt[w], frame.seaFillKm[w]))) onSea++;
        }
        lakes.push({ sea: onSea >= 0.25 * q.length, overKm2: under * cellKm2, km2: q.length * cellKm2, kind: lake[c0] === Water.SALT ? 'salt' : 'fresh', depthKm: fin.lakeLevel[deep] - z[deep], levelKm: fin.lakeLevel[deep], at: latLon(xyz, deep), histDepthKm: histDepth?.[s] ?? NaN, histShare: under / q.length,
            crust: frame.owner[s] < 0 ? 'none' : `type ${frame.type[s]}, ${Math.round(frame.time - frame.formedAt[s])} Myr, oro ${frame.oroType[s]} ${frame.oroType[s] ? Math.round(frame.time - frame.oroLast[s]) + ' Myr ago' : ''}, up ${frame.upliftKm[s].toFixed(2)} base ${frame.baseKm[s].toFixed(2)} sea fill ${frame.seaFillKm[s].toFixed(2)} km` });
    }
    lakes.sort((a, b) => b.km2 - a.km2);
    // the land below its spill: a priority flood from the ocean over the finished ground (a lake's floor, not its water)
    const spill = new Float32Array(n).fill(Infinity), heap = new MinHeap(1 << 16);
    for (let c = 0; c < n; c++) if (ocean[c]) { spill[c] = -Infinity; for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!ocean[nb]) heap.push(z[nb], nb); } }
    while (heap.size) {
        const c = heap.pop(), lev = heap.lastKey;
        if (spill[c] !== Infinity) continue;
        spill[c] = lev;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!ocean[nb] && spill[nb] === Infinity) heap.push(Math.max(lev, z[nb]), nb); }
    }
    let belowKm2 = 0, volKm3 = 0;
    for (let c = 0; c < n; c++) if (!ocean[c] && spill[c] - z[c] > 1e-3) { belowKm2 += cellKm2; volKm3 += (spill[c] - z[c]) * cellKm2; }
    const onLand = lakes.filter(L => !L.sea);
    return { landKm2, wetKm2, panKm2, lakes, onLand, onLandKm2: onLand.reduce((a, L) => a + L.km2, 0), belowKm2, volKm3, meanKm: zKm3 / zKm2, zBadKm2: landKm2 - zKm2, stats: fin.stats.water };
}

