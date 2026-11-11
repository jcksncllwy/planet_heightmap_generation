// Level fills on a finished ground (lane hollowfix, after volcano4's zs-plateaus): connected dry land (not sea, not lake) whose
// neighbours differ by < TOL m, at least MIN km², above LOW m — a lowland coastal plain is level by nature, a level slab high up
// is a hollow filled to its spill point — and its "cliff-edge" cells: a level cell with a land neighbour more than DROP m lower.
//   node v2/tools/level-fills.mjs <dump dir> [--tol 3] [--min 3000] [--low 300] [--drop 150] [--top 8] [--json out.json] [--classify]
// --classify: each patch by what it is, and the water's own surfaces by kind. A patch touching a lake or a salt pan is that water's
// plain (its delta, its shore: level by nature); else, below its spill level on the finished ground (the sea's priority flood),
// a closed basin's dry floor (a playa's kin); else at its spill level: a hollow filled to its rim, the defect.
// <dump dir>: render-moment --dump's; the last stage with a lake mask is read (NN-after_water).
import fs from 'node:fs';
import path from 'node:path';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';

setDelaunator(Delaunator);
const argv = process.argv.slice(2), dir = argv[0], arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const TOL = +arg('--tol', 3), MIN = +arg('--min', 3000), LOW = +arg('--low', 300), DROP = +arg('--drop', 150), TOP = +arg('--top', 8);
const R = 6371, D = 180 / Math.PI;
const last = fs.readdirSync(dir).filter(f => f.endsWith('.lake.u8')).sort().pop().replace('.lake.u8', '');
const rd = (ext, T) => { const b = fs.readFileSync(path.join(dir, last + ext)); return new T(b.buffer, b.byteOffset, b.length / T.BYTES_PER_ELEMENT); };
const z = rd('.z.f32', Float32Array), sea = rd('.sea.u8', Uint8Array), lake = rd('.lake.u8', Uint8Array), n = z.length;
// (the mesh is asked for by its round count; it has a cell or so more)
const { adjOffset, adjList } = terrainMesh(+arg('--cells', Math.round(n / 1000) * 1000)), ll = new Float32Array(fs.readFileSync(path.join(dir, `ll-${n}.f32`)).buffer.slice(0));
const CLASSIFY = argv.includes('--classify'), spill = CLASSIFY ? seaFlood() : null;
const a = 4 * Math.PI * R * R / n, dry = c => !sea[c] && !lake[c] && z[c] * 1000 > LOW, seen = new Uint8Array(n), out = [];
for (let s = 0; s < n; s++) {
    if (seen[s] || !dry(s)) continue;
    const q = [s];
    seen[s] = 1;
    for (let i = 0; i < q.length; i++) {
        const c = q[i];
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (!seen[y] && dry(y) && Math.abs(z[y] - z[c]) * 1000 < TOL) { seen[y] = 1; q.push(y); } }
    }
    if (q.length * a < MIN) continue;
    let cliff = 0, lo = 1e9, hi = -1e9, x = 0, y = 0, w = 0;
    for (const c of q) {
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const nb = adjList[j]; if (!sea[nb] && (z[c] - z[nb]) * 1000 > DROP) { cliff++; break; } }
        lo = Math.min(lo, z[c]); hi = Math.max(hi, z[c]);
        const la = ll[2 * c] / D, lo2 = ll[2 * c + 1] / D;
        x += Math.cos(la) * Math.cos(lo2); y += Math.cos(la) * Math.sin(lo2); w += Math.sin(la);
    }
    const r = Math.hypot(x, y, w);
    let kind = 'slab';
    if (CLASSIFY) {
        let wet = 0, below = 0;
        for (const c of q) {
            for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const k = lake[adjList[j]]; if (k) wet = Math.max(wet, k === 3 ? 1 : 2); }
            if ((spill[c] - z[c]) * 1000 > TOL) below++;
        }
        kind = wet === 2 ? 'lake' : wet === 1 ? 'pan' : below > q.length / 2 ? 'closed' : 'slab';
    }
    out.push({ kind, cliff, km2: Math.round(q.length * a), loM: Math.round(lo * 1000), hiM: Math.round(hi * 1000), lat: +(Math.asin(w / r) * D).toFixed(1), lon: +(Math.atan2(y, x) * D).toFixed(1) });
}
const cl = out.reduce((s, p) => s + p.cliff, 0), km2 = out.reduce((s, p) => s + p.km2, 0);
const res = { dir, stage: last, patches: out.length, km2, cliffCells: cl, cliffKm: Math.round(cl * Math.sqrt(a)), biggest: [...out].sort((p, q) => q.km2 - p.km2).slice(0, TOP), worstCliff: [...out].sort((p, q) => q.cliff - p.cliff).slice(0, TOP) };
console.log(`${path.basename(dir)}: ${res.patches} level patches ≥ ${MIN} km² above ${LOW} m (tol ${TOL} m), ${(km2 / 1e6).toFixed(2)} Mkm²; cliff-edge cells (a land neighbour > ${DROP} m lower) ${cl}, ~${res.cliffKm} km`);
const line = p => `  cliff ${String(p.cliff).padStart(4)}  ${p.km2.toLocaleString().padStart(9)} km² at ${p.lat},${p.lon}  ${p.loM}–${p.hiM} m`;
console.log(' biggest:'); res.biggest.forEach(p => console.log(line(p)));
console.log(' most cliff:'); res.worstCliff.forEach(p => console.log(line(p)));
if (CLASSIFY) {
    const by = {}, water = [0, 0, 0, 0];
    for (const p of out) { by[p.kind] ??= { patches: 0, km2: 0, cliff: 0 }; by[p.kind].patches++; by[p.kind].km2 += p.km2; by[p.kind].cliff += p.cliff; }
    for (let c = 0; c < n; c++) if (lake[c]) water[lake[c]] += a;
    res.byKind = by; res.waterKm2 = { fresh: Math.round(water[1]), salt: Math.round(water[2]), pan: Math.round(water[3]) };
    console.log(' by kind: ' + Object.entries(by).map(([k, v]) => `${k} ${v.patches}/${(v.km2 / 1e6).toFixed(2)} Mkm²/${v.cliff}`).join(' · ') +
        ` | water: fresh ${(water[1] / 1e6).toFixed(2)} · salt ${(water[2] / 1e6).toFixed(2)} · pan ${(water[3] / 1e6).toFixed(2)} Mkm²`);
}
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(res, null, 1));

/** Each cell's spill level: the lowest height a path from the sea must climb to reach it (priority flood, the sea's cells as seeds) */
function seaFlood() {
    const lvl = new Float32Array(n).fill(Infinity), heap = new Int32Array(n), key = new Float32Array(n), done = new Uint8Array(n);
    let size = 0;
    const push = c => { let i = size++; while (i > 0) { const p = (i - 1) >> 1; if (key[heap[p]] <= lvl[c]) break; heap[i] = heap[p]; i = p; } heap[i] = c; key[c] = lvl[c]; };
    const pop = () => { const top = heap[0], last = heap[--size]; let i = 0; for (;;) { let l = 2 * i + 1; if (l >= size) break; if (l + 1 < size && key[heap[l + 1]] < key[heap[l]]) l++; if (key[heap[l]] >= key[last]) break; heap[i] = heap[l]; i = l; } heap[i] = last; return top; };
    for (let c = 0; c < n; c++) if (sea[c]) { lvl[c] = z[c]; push(c); }
    while (size) {
        const c = pop();
        if (done[c]) continue;
        done[c] = 1;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const y = adjList[j]; if (done[y]) continue; const v = Math.max(z[y], lvl[c]); if (v < lvl[y]) { lvl[y] = v; push(y); } }
    }
    return lvl;
}
