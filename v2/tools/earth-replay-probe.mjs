// Earth replay study, Q1 probe: proves the reconstruction data parses and measures what a replay would be driven by and
// compared against. Report-only; it runs nothing of the model's (the replay itself is lane work: the study note's plan).
//   node v2/tools/earth-replay-probe.mjs [--n 20000]        (after tuning/earth/fetch-earth-replay.sh)
// Prints: the rotation tree's size; a closure test (South America against Africa at 120 Ma: the South Atlantic fit);
// plate speeds of today's crust through time (Müller 2019, mantle frame); how much of today's crust the static polygons can
// carry back to each time; and the ocean-floor age distribution of Müller 2019's age grids at 0–200 Ma — Earth's own range of
// that statistic over the last cycle, which is what the methodology asks a model statistic to be compared against.

import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { loadRotations, loadGpmlPolygons, insidePolygon, fibonacciSphere, rotate, quatConj, loadNetcdfGrid } from './earth-replay-lib.mjs';
import { quatMul } from '../js/core/rotation.js';
import { latLonToXyz, xyzToLatLon } from '../js/tectonics/step/kinematics.js';

const here = dirname(fileURLToPath(import.meta.url));
const EARTH = resolvePath(here, '../../tuning/earth/data');
const RAW = EARTH + '/raw/muller2019';
const R_KM = 6371, RAD_PER_MYR_TO_CM_YR = R_KM * 1e5 / 1e6;        // 1 rad/Myr at Earth's radius = 637.1 cm/yr
const n = +(process.argv[process.argv.indexOf('--n') + 1] || 0) || 20000;
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
const fmt = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : '—';

const t0 = Date.now();
const rot = loadRotations(RAW + '/Rotations/Rotations/Muller_etal_2019_CombinedRotations.rot');
let samples = 0; for (const l of rot.seqs.values()) for (const s of l) samples += s.samples.length;
console.log(`Müller 2019 rotations: ${rot.seqs.size} moving plates, ${samples} samples (${Date.now() - t0} ms)`);

// ── closure test: Recife against Africa at 120 Ma should sit on the Cameroon–Gabon margin (the pre-rift South Atlantic fit)
{
    const SAM = 201, AFR = 701, t = 120;
    const rel = quatMul(quatConj(rot.total(AFR, t)), rot.total(SAM, t));     // South America's motion in Africa's frame
    const recife = latLonToXyz(-8.05, -34.9), at = rotate(rel, recife), ll = xyzToLatLon(...at);
    const douala = latLonToXyz(4.05, 9.7);
    console.log(`closure: Recife at 120 Ma in Africa's frame → ${fmt(ll.lat)}°, ${fmt(ll.lon)}° — ${fmt(angle(at, douala) * R_KM, 0)} km from Douala (a fit puts it within a few hundred)`);
    const rel0 = quatMul(quatConj(rot.total(AFR, 0)), rot.total(SAM, 0));
    console.log(`         at 0 Ma the same rotation moves Recife ${fmt(angle(rotate(rel0, recife), recife) * R_KM, 3)} km (identity)`);
}

// ── static polygons → today's crust on a Fibonacci grid
const t1 = Date.now();
const polys = loadGpmlPolygons(RAW + '/StaticPolygons/StaticPolygons/Muller_etal_2019_Global_StaticPlatePolygons.gpmlz');
const pts = fibonacciSphere(n), owner = new Array(n).fill(null);
for (let i = 0; i < n; i++) for (const p of polys) if (p.end <= 0 && insidePolygon(p, pts[i])) { owner[i] = p; break; }
const covered = owner.filter(Boolean).length, ids = new Set(owner.filter(Boolean).map(p => p.plateId));
console.log(`static polygons: ${polys.length} rings, ${ids.size} plate ids on the grid; ${fmt(100 * covered / n)} % of ${n} points covered (${Date.now() - t1} ms)`);
const missingRot = [...ids].filter(id => !rot.has(id));
if (missingRot.length) console.log(`  plate ids with no rotation: ${missingRot.slice(0, 12).join(' ')}${missingRot.length > 12 ? ' …' : ''}`);

// ── through time: how much of today's crust existed, its speeds (stage t → t+1 Myr), how many plate ids carry ≥1 % of it
console.log('\n  Ma | today\'s crust that existed | RMS speed cm/yr | median | p90 | ids ≥1 % | biggest-id share');
for (const t of [0, 10, 25, 50, 75, 100, 125, 150, 175, 200, 225, 249]) {
    const speeds = [], byId = new Map();
    for (let i = 0; i < n; i++) {
        const p = owner[i];
        if (!p || p.begin < t) continue;
        const a = rotate(rot.total(p.plateId, t), pts[i]), b = rotate(rot.total(p.plateId, t + 1), pts[i]);
        speeds.push(angle(a, b) * RAD_PER_MYR_TO_CM_YR);
        byId.set(p.plateId, (byId.get(p.plateId) ?? 0) + 1);
    }
    speeds.sort((x, y) => x - y);
    const rms = Math.sqrt(speeds.reduce((s, v) => s + v * v, 0) / speeds.length), q = f => speeds[Math.floor(f * (speeds.length - 1))];
    const big = [...byId.values()].filter(c => c >= 0.01 * speeds.length).length, top = Math.max(...byId.values()) / speeds.length;
    console.log(`  ${String(t).padStart(3)} | ${fmt(100 * speeds.length / n).padStart(5)} % | ${fmt(rms)} | ${fmt(q(0.5))} | ${fmt(q(0.9))} | ${big} | ${fmt(100 * top, 0)} %`);
}

// ── age grids: Earth's ocean-floor age distribution over the last 200 Myr (area-weighted by cos lat)
console.log('\n  Ma | ocean area (age-grid cells) % of sphere | mean age Myr | median | p90 | max | >100 Myr % | >150 Myr %');
for (const t of [0, 50, 100, 150, 200]) {
    let g;
    try { g = await loadNetcdfGrid(`${RAW}/agegrid/age-${t}.nc`, EARTH); } catch (e) { console.log(`  ${t}: ${e.message}`); continue; }
    const { lat, lon, z, fill } = g, nx = lon.length, ny = lat.length;
    const vals = [], w = [];
    let wAll = 0;
    for (let j = 0; j < ny; j++) {
        const c = Math.cos(lat[j] * Math.PI / 180);
        for (let i = 0; i < nx; i++) {
            if (i === nx - 1 && Math.abs(lon[nx - 1] - lon[0] - 360) < 1e-6) continue;   // (a grid that repeats its first column)
            wAll += c;
            const v = z[j * nx + i];
            if (!Number.isFinite(v) || v === fill || v < 0 || v > 1000) continue;
            vals.push(v); w.push(c);
        }
    }
    const order = vals.map((_, k) => k).sort((a, b) => vals[a] - vals[b]);
    const W = w.reduce((s, v) => s + v, 0);
    const wq = f => { let acc = 0; for (const k of order) { acc += w[k]; if (acc >= f * W) return vals[k]; } return NaN; };
    const mean = vals.reduce((s, v, k) => s + v * w[k], 0) / W;
    const over = a => 100 * vals.reduce((s, v, k) => s + (v > a ? w[k] : 0), 0) / W;
    console.log(`  ${String(t).padStart(3)} | ${fmt(100 * W / wAll)} % | ${fmt(mean)} | ${fmt(wq(0.5))} | ${fmt(wq(0.9))} | ${fmt(vals[order.at(-1)], 0)} | ${fmt(over(100))} | ${fmt(over(150))}   (${nx}×${ny}, vars ${g.keys.join(',')})`);
}
console.log(`\n(total ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
