// Level fills on a finished ground (lane hollowfix, after volcano4's zs-plateaus): connected dry land (not sea, not lake) whose
// neighbours differ by < TOL m, at least MIN km², above LOW m — a lowland coastal plain is level by nature, a level slab high up
// is a hollow filled to its spill point — and its "cliff-edge" cells: a level cell with a land neighbour more than DROP m lower.
//   node v2/tools/level-fills.mjs <dump dir> [--tol 3] [--min 3000] [--low 300] [--drop 150] [--top 8] [--json out.json]
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
    out.push({ cliff, km2: Math.round(q.length * a), loM: Math.round(lo * 1000), hiM: Math.round(hi * 1000), lat: +(Math.asin(w / r) * D).toFixed(1), lon: +(Math.atan2(y, x) * D).toFixed(1) });
}
const cl = out.reduce((s, p) => s + p.cliff, 0), km2 = out.reduce((s, p) => s + p.km2, 0);
const res = { dir, stage: last, patches: out.length, km2, cliffCells: cl, cliffKm: Math.round(cl * Math.sqrt(a)), biggest: [...out].sort((p, q) => q.km2 - p.km2).slice(0, TOP), worstCliff: [...out].sort((p, q) => q.cliff - p.cliff).slice(0, TOP) };
console.log(`${path.basename(dir)}: ${res.patches} level patches ≥ ${MIN} km² above ${LOW} m (tol ${TOL} m), ${(km2 / 1e6).toFixed(2)} Mkm²; cliff-edge cells (a land neighbour > ${DROP} m lower) ${cl}, ~${res.cliffKm} km`);
const line = p => `  cliff ${String(p.cliff).padStart(4)}  ${p.km2.toLocaleString().padStart(9)} km² at ${p.lat},${p.lon}  ${p.loM}–${p.hiM} m`;
console.log(' biggest:'); res.biggest.forEach(p => console.log(line(p)));
console.log(' most cliff:'); res.worstCliff.forEach(p => console.log(line(p)));
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(res, null, 1));
