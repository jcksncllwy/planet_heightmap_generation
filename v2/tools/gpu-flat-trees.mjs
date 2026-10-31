// What shape do flats' flow trees take? On a fixture's first network: the dry flat cells (no strict way down, not under a lake), and how the
// flood's tree over them compares with parallel rules, by size of the subtree each flat cell gathers within the flat.
import { loadRun } from './gpu-fixture.mjs';
import { cpuRoute } from './gpu-harness/cpu-route.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const { o } = loadRun(arg('--dir'), Number(arg('--run', 3))), { adjOffset, adjList, numCells: n } = o.mesh, { z, ocean } = o;
const B = o.closed(z), sink = B.sink, base = B.base, basins = B.lakes.filter(L => sink[L.cells[0]]);
const { fill, recv } = cpuRoute(o.mesh, ocean, z, sink, base, basins);
const out = c => ocean[c] || sink[c], surf = c => ocean[c] ? Math.min(0, z[c]) : base[c];
const flat = new Uint8Array(n), dist = new Int32Array(n).fill(-1), wave = [];
let cells = 0, lakeFlat = 0;
for (let c = 0; c < n; c++) {
    if (out(c)) continue;
    let strict = false;
    for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (fill[c] - (out(y) ? surf(y) : fill[y]) > 0) strict = true; }
    if (strict) { dist[c] = 0; continue; }
    if (fill[c] > z[c] + 1e-5) { lakeFlat++; continue; }
    flat[c] = 1; cells++;
}
// (hops to the way out, over cells of the same fill)
const q = []; for (let c = 0; c < n; c++) if (dist[c] === 0) q.push(c);
const lk = new Uint8Array(n); for (let c = 0; c < n; c++) if (!out(c) && !flat[c] && dist[c] < 0) lk[c] = 1;
for (let i = 0; i < q.length; i++) { const c = q[i]; for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (!out(y) && dist[y] < 0 && fill[y] === fill[c]) { dist[y] = dist[c] + 1; q.push(y); } } }
const shape = (name, parentOf) => {
    const size = new Float64Array(n), order = q.filter(c => flat[c] || lk[c]).reverse();
    const inflat = order.filter(c => flat[c]);
    for (const c of order) if (flat[c]) { size[c] += 1; const p = parentOf(c); if (flat[p]) size[p] += size[c]; }
    const v = inflat.map(c => size[c]).sort((a, b) => a - b), kids = new Int32Array(n); for (const c of inflat) { const p = parentOf(c); if (flat[p]) kids[p]++; }
    const leaves = inflat.filter(c => !kids[c]).length, roots = inflat.filter(c => !flat[parentOf(c)]);
    const rootSizes = roots.map(c => size[c]).sort((a, b) => b - a), wt = v.reduce((s, x) => s + x * x, 0) / v.reduce((s, x) => s + x, 0);
    console.log(name.padEnd(12), JSON.stringify({ cells: v.length, leafShare: +(leaves / v.length).toFixed(3), kids3plus: +(inflat.filter(c => kids[c] >= 3).length / v.length).toFixed(3), p90: v[Math.floor(.9 * v.length)], p99: v[Math.floor(.99 * v.length)], max: v[v.length - 1], areaWeightedSize: +wt.toFixed(1), outlets: roots.length, top3: rootSizes.slice(0, 3) }));
};
console.log('flat dry cells', cells, 'flat lake cells', lakeFlat, 'max hops', q.reduce((m, c) => Math.max(m, dist[c]), 0));
shape('flood(CPU)', c => recv[c]);
const parents = rule => { const p = new Int32Array(n); for (const c of q) { if (!flat[c] && !lk[c]) continue; p[c] = rule(c); } return c => p[c]; };
const elig = c => { const a = []; for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (!out(y) && fill[y] === fill[c] && dist[y] === dist[c] - 1) a.push(y); } return a; };
const H = y => Math.imul(y, 2654435761) >>> 0;
shape('adj-first', parents(c => elig(c)[0] ?? recv[c]));
shape('hash-claim', parents(c => { const a = elig(c); return a.length ? a.reduce((b, y) => H(y) < H(b) ? y : b) : recv[c]; }));
// (lineage: a cell inherits its parent's priority, so an early line keeps claiming, as the flood's early pops do)
const pr = new Float64Array(n), linP = new Int32Array(n);
for (const c of q) { if (dist[c] === 0) { pr[c] = H(c); continue; } const a = elig(c); let b = a[0]; for (const y of a) if (pr[y] < pr[b] || (pr[y] === pr[b] && H(y) < H(b))) b = y; linP[c] = b ?? recv[c]; pr[c] = b === undefined ? H(c) : pr[b]; }
shape('lineage', c => linP[c]);
