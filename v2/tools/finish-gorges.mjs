// Gorges on the FINISHED surface (lane graded, sessrumnir's ruling B2, 2026-11-12): where great rivers cross active belts, how
// deep the ground around them stands above them within ~20 km. A gorge is sub-cell at the history's ~120 km cells (check-phase8b
// holds the history only to its belt's great rivers standing below their neighbours); its depth is the finish's, at a resolution
// where 20 km is a few cells (2.5M: ~14 km spacing; at 160K, ~56 km, the reach holds the cell's neighbours at most — read it
// as an upper-scale proxy there). Earth: the Himalaya's transverse rivers run 2–5 km below the ridges beside them (the Arun,
// the Sutlej, the Yarlung Tsangpo; Lavé & Avouac 2001, JGR 106; Burbank et al. 1996). The target: the median ≥ 1 km.
// A measurement, not a check suite: a 2.5M finish takes ~16 GB, so it reads one the finish cache already holds.
// Usage: node v2/tools/finish-gorges.mjs (--key <finish key> | --latest) [--reach-km 20] [--quiet-myr 10] [--min-km2 100000]
// Prints one JSON line: { cells, belt, rivers, medianKm, p10Km, p90Km, maxKm, reachKm, spacingKm }.
// Limits: drainage is steepest descent on the finished ground (the finish's lakes are filled, so it routes); "active" is the
// history frame's belt records (oroType not arc, last active within quiet-myr), looked up at the nearest history cell.

import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { loadFinish, loadLatestFinish } from './lib/finish-cache.mjs';
import { getFrame } from './lib/history-cache.mjs';
import { MESH_SEED } from './lib/moment-frame.mjs';
import { OrogenyType } from '../js/tectonics/model/crust.js';

setDelaunator(Delaunator);
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const REACH_KM = Number(arg('--reach-km', 20)), QUIET_MYR = Number(arg('--quiet-myr', 10)), MIN_KM2 = Number(arg('--min-km2', 1e5));
const R = 6371;

const fin = process.argv.includes('--latest') ? await loadLatestFinish({ mesh: true }) : await loadFinish(arg('--key', ''), { mesh: true });
if (!fin) { console.error('no whole finish under that key (finish cache)'); process.exit(2); }
const { spec } = fin, frame = getFrame(spec.history, spec.timeMyr);
if (!frame) { console.error(`its history frame is not in this machine's history cache (${spec.history} @ ${spec.timeMyr} Myr)`); process.exit(2); }
const mesh = fin.mesh, { z, ocean } = fin.cells, n = mesh.numCells, { xyz, adjOffset, adjList } = mesh;
// (the sim mesh's own count: buildSimMesh(n) makes n + 1 or n + 2 cells, so try the page's round counts first)
const simMesh = [40000, 20000, 80000, frame.owner.length - 1, frame.owner.length].map(k => buildSimMesh(k, MESH_SEED)).find(m => m.numCells === frame.owner.length) ?? buildSimMesh(frame.owner.length, MESH_SEED);
if (simMesh.numCells !== frame.owner.length) { console.error(`sim mesh ${simMesh.numCells} cells, the frame ${frame.owner.length}`); process.exit(2); }

// drainage: each land cell's flow to its lowest lower neighbour, accumulated from the top down
const cellKm2 = 4 * Math.PI * R * R / n, land = c => !ocean[c] && z[c] > 0;
const area = new Float64Array(n), order = Array.from({ length: n }, (_, c) => c).filter(land).sort((a, b) => z[b] - z[a]);
for (const c of order) {
    area[c] += cellKm2;
    let to = -1, low = z[c];
    for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (z[nb] < low) { low = z[nb]; to = nb; } }
    if (to >= 0) area[to] += area[c];
}

// the active belts, from the history frame at the nearest history cell
const activeAt = c => {
    const w = simMesh.index.nearest(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]), t = frame.oroType[w];
    return frame.owner[w] >= 0 && t !== OrogenyType.NONE && t !== OrogenyType.ARC && frame.time - frame.oroLast[w] <= QUIET_MYR;
};

// relief: the highest ground within REACH_KM (great circle) of a river cell, less the river's own
const cosReach = Math.cos(REACH_KM / R), mark = new Int32Array(n).fill(-1);
function relief(c) {
    const x = xyz[3 * c], y = xyz[3 * c + 1], w = xyz[3 * c + 2], stack = [c];
    let top = z[c];
    mark[c] = c;
    while (stack.length) {
        const a = stack.pop();
        if (z[a] > top) top = z[a];
        for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
            const b = adjList[k];
            if (mark[b] === c || x * xyz[3 * b] + y * xyz[3 * b + 1] + w * xyz[3 * b + 2] < cosReach) continue;
            mark[b] = c; stack.push(b);
        }
    }
    return top - z[c];
}

let belt = 0;
const deep = [];
for (const c of order) {
    if (!activeAt(c)) continue;
    belt++;
    if (area[c] >= MIN_KM2) deep.push(relief(c));
}
deep.sort((a, b) => a - b);
const q = p => deep.length ? +deep[Math.min(deep.length - 1, Math.floor(p * deep.length))].toFixed(3) : null;
console.log(JSON.stringify({ key: fin.key, cells: n, timeMyr: spec.timeMyr, belt, rivers: deep.length, medianKm: q(0.5), p10Km: q(0.1), p90Km: q(0.9),
    maxKm: deep.length ? +deep.at(-1).toFixed(3) : null, reachKm: REACH_KM, spacingKm: +Math.sqrt(cellKm2).toFixed(1), pass: q(0.5) !== null && q(0.5) >= 1 }));
