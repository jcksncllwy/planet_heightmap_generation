// The CPU erosion with each cell's neighbours listed in reverse: same mesh, other arbitrary choices. With probe-hook.mjs; for a
// finish's noise floor. Only the erosion sees the reversal.
const flips = new WeakMap();
export function flipped(mesh) {
    if (flips.has(mesh)) return flips.get(mesh);
    const { adjOffset, adjList, numCells: n } = mesh, flip = adjList.slice();
    for (let c = 0; c < n; c++) { const lo = adjOffset[c], hi = adjOffset[c + 1]; for (let j = lo; j < hi; j++) flip[j] = adjList[hi - 1 - (j - lo)]; }
    const out = Object.assign(Object.create(Object.getPrototypeOf(mesh)), mesh, { adjList: flip });
    flips.set(mesh, out);
    return out;
}
if (!process.env.GPU_FLIP) globalThis.__erodeEnter = o => ({ ...o, mesh: flipped(o.mesh) });
