// finish-erode.js's route(), for experiments: the CPU's fill and receivers, handed to the GPU's sweeps. A copy for the bias hunt only.
import { MinHeap } from '../../js/core/min-heap.js';

const FLAT_KEY = 1e-11;
export function cpuRoute(mesh, ocean, z, sink, base, basins) {
    const { adjOffset, adjList, numCells: n } = mesh, fill = new Float32Array(n), rank = new Int32Array(n).fill(-1), parent = new Int32Array(n).fill(-1), order = new Int32Array(n), recv = new Int32Array(n), flat = new Float32Array(n), heap = new MinHeap(1 << 16);
    for (let c = 0; c < n; c++) if (ocean[c] || sink[c]) rank[c] = -2;
    for (let c = 0; c < n; c++) { if (ocean[c]) continue; for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) if (ocean[adjList[j]]) { if (rank[c] !== -2) { const v = Math.max(0, z[c]); if (parent[c] === -1 || v < fill[c]) { parent[c] = adjList[j]; fill[c] = v; flat[c] = 0; heap.push(v, c); } } break; } }
    for (const B of basins) for (const c of B.cells) for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
        const nb = adjList[j];
        if (rank[nb] === -2) continue;
        const v = Math.max(base[c], z[nb]);
        if (parent[nb] === -1 || v < fill[nb]) { parent[nb] = c; fill[nb] = v; flat[nb] = 0; heap.push(v, nb); }
    }
    let count = 0;
    while (heap.size) {
        const c = heap.pop();
        if (rank[c] !== -1) continue;
        rank[c] = count; order[count++] = c;
        const fc = fill[c];
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
            const nb = adjList[j];
            if (rank[nb] !== -1) continue;
            const level = fc > z[nb] ? fc : z[nb];
            if (parent[nb] === -1 || level < fill[nb]) { parent[nb] = c; fill[nb] = level; flat[nb] = level === fc ? flat[c] + 1 : 0; heap.push(level + FLAT_KEY * flat[nb], nb); }
        }
    }
    const surfaceOut = c => (ocean[c] ? Math.min(0, z[c]) : base[c]);
    for (let i = 0; i < count; i++) {
        const c = order[i], fc = fill[c];
        let pick = -1, drop = 0;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
            const nb = adjList[j], rn = rank[nb];
            if (!(rn === -2 || (rn >= 0 && rn < i))) continue;
            const s = fc - (rn === -2 ? surfaceOut(nb) : fill[nb]);
            if (s > drop) { drop = s; pick = nb; }
        }
        if (pick < 0) pick = parent[c];
        recv[c] = pick;
    }
    return { fill, recv: new Uint32Array(recv.buffer) };
}
