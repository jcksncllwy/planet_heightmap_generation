// Is a small input change kept local by the finish? (lane hollowfix; fensalir's locality gate.) Two render-moment --dump dirs of
// the same moment, a base and a nudged run: the footprint is where their ground differs at the 'surface' stage (before any finish
// process); then, stage by stage, how many cells moved by more than 1 m, 10 m, 100 m, the most, and how far from the footprint
// the farthest moved cell lies (great-circle km to its nearest footprint cell), with the moved area binned by that distance.
//   node v2/tools/finish-locality.mjs <base dump> <nudged dump> [--foot 0.1] [--bar 500] [--json out.json]
// --foot: m a surface cell must differ by to count in the footprint; --bar: the footprint bar, km (cells moved past it are the
// gate's "outside").
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2), [A, B] = argv, arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const FOOT = +arg('--foot', 0.1) / 1000, BAR = +arg('--bar', 500), R = 6371, D = Math.PI / 180;
const stages = fs.readdirSync(A).filter(f => f.endsWith('.z.f32')).sort();
const rd = (d, f) => { const b = fs.readFileSync(path.join(d, f)); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const za0 = rd(A, stages.find(f => /surface/.test(f))), zb0 = rd(B, stages.find(f => /surface/.test(f))), n = za0.length;
const ll = new Float32Array(fs.readFileSync(path.join(A, `ll-${n}.f32`)).buffer.slice(0));
const X = new Float64Array(3 * n);
for (let c = 0; c < n; c++) { const la = ll[2 * c] * D, lo = ll[2 * c + 1] * D; X[3 * c] = Math.cos(la) * Math.cos(lo); X[3 * c + 1] = Math.cos(la) * Math.sin(lo); X[3 * c + 2] = Math.sin(la); }
const foot = [];
for (let c = 0; c < n; c++) if (Math.abs(za0[c] - zb0[c]) > FOOT) foot.push(c);
// (the distance to the footprint: the nearest footprint cell, by the largest dot product; footprints are small, so brute force over
// a coarse 1° bucket of them is plenty)
const fx = Float64Array.from(foot.flatMap(c => [X[3 * c], X[3 * c + 1], X[3 * c + 2]]));
const distKm = c => { let best = -2; for (let i = 0; i < fx.length; i += 3) { const d = X[3 * c] * fx[i] + X[3 * c + 1] * fx[i + 1] + X[3 * c + 2] * fx[i + 2]; if (d > best) best = d; } return R * Math.acos(Math.min(1, best)); };
const a = 4 * Math.PI * R * R / n, BINS = [100, 300, 1000, 3000, Infinity], rows = [];
console.log(`footprint: ${foot.length} cells (${Math.round(foot.length * a).toLocaleString()} km²) where the surface differs by > ${FOOT * 1000} m; bar ${BAR} km`);
for (const f of stages) {
    if (!fs.existsSync(path.join(B, f))) continue;
    const za = rd(A, f), zb = rd(B, f);
    let m1 = 0, m10 = 0, m100 = 0, maxM = 0, far = 0, farAt = -1, outside = 0, outsideMax = 0;
    const bin = new Float64Array(BINS.length);
    for (let c = 0; c < n; c++) {
        const d = Math.abs(za[c] - zb[c]) * 1000;
        if (!(d > 1)) continue;
        m1++; if (d > 10) m10++; if (d > 100) m100++; if (d > maxM) maxM = d;
        const k = foot.length ? distKm(c) : Infinity;
        bin[BINS.findIndex(b => k <= b)] += a;
        if (k > far) { far = k; farAt = c; }
        if (k > BAR) { outside++; if (d > outsideMax) outsideMax = d; }
    }
    const row = { stage: f.replace('.z.f32', ''), moved1m: m1, moved10m: m10, moved100m: m100, maxM: Math.round(maxM), farKm: Math.round(far), farAt: farAt >= 0 ? [+ll[2 * farAt].toFixed(1), +ll[2 * farAt + 1].toFixed(1)] : null, outsideBar: outside, outsideMaxM: Math.round(outsideMax), km2ByDist: Object.fromEntries(BINS.map((b, i) => [`≤${b}`, Math.round(bin[i])])) };
    rows.push(row);
    console.log(`${row.stage.padEnd(36)} >1 m ${String(m1).padStart(8)}  >10 m ${String(m10).padStart(8)}  >100 m ${String(m100).padStart(7)}  max ${String(row.maxM).padStart(5)} m  farthest ${String(row.farKm).padStart(5)} km ${row.farAt ?? ''}  past bar ${outside} (max ${row.outsideMaxM} m)`);
}
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify({ A, B, footCells: foot.length, bar: BAR, rows }, null, 1));
