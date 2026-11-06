// Readers for plate-reconstruction data (the Earth replay study, ~/obsidian/brain/projects/geo-sim-earth-replay-study.md):
// GPlates rotation files (.rot) as a rotation tree, GPML static polygons, and HDF5/netCDF4 age grids. Data comes from
// tuning/earth/fetch-earth-replay.sh. Study tooling only: nothing in the model imports this.
//
// A .rot line is `moving time lat lon angle fixed ! comment`: the finite rotation that carries the moving plate from where it
// is today to where it was `time` Ma, relative to the fixed plate (Cox & Hart 1986; the GPlates convention, right-handed,
// angle in degrees). Plate 0 is the absolute frame (Müller 2019: the mantle; Merdith 2021: the spin axis). A moving plate's
// lines form one or more sequences, one per fixed plate (a "crossover" hands it from one to the next); between two samples
// of a sequence the rotation is slerped, as GPlates does. Lines whose moving id is 999 are comments.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { quatFromAxisAngle, quatMul, quatNormalize } from '../js/core/rotation.js';
import { latLonToXyz } from '../js/tectonics/step/kinematics.js';

const D2R = Math.PI / 180;

export const quatConj = q => [q[0], -q[1], -q[2], -q[3]];

export function quatFromPole(lat, lon, angleDeg) {
    const [x, y, z] = latLonToXyz(lat, lon);
    return quatFromAxisAngle(x, y, z, angleDeg * D2R);
}

function slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map(v => -v); d = -d; }                     // the short way round
    if (d > 0.9995) return quatNormalize(a.map((v, i) => v + (b[i] - v) * t));
    const th = Math.acos(d), s = Math.sin(th);
    const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return a.map((v, i) => wa * v + wb * b[i]);
}

/** Rotate unit vector p by quaternion q. */
export function rotate(q, p) {
    const r = quatMul(quatMul(q, [0, p[0], p[1], p[2]]), quatConj(q));
    return [r[1], r[2], r[3]];
}

/** Parse a .rot file into a rotation tree: total(plateId, timeMa) → quaternion (present → that time, absolute frame). */
export function loadRotations(path) {
    const seqs = new Map();                                       // moving id → [{ fixed, samples: [{t, q}] }]
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const f = line.split('!')[0].trim().split(/\s+/);
        if (f.length < 6) continue;
        const [moving, t, lat, lon, angle, fixed] = f.map(Number);
        if (moving === 999 || !Number.isFinite(t)) continue;
        let list = seqs.get(moving);
        if (!list) seqs.set(moving, list = []);
        let s = list[list.length - 1];
        if (!s || s.fixed !== fixed || t < s.samples[s.samples.length - 1].t) list.push(s = { fixed, samples: [] });
        s.samples.push({ t, q: quatFromPole(lat, lon, angle) });
    }
    const cache = new Map();
    function relative(moving, t) {                                // { fixed, q } or null
        for (const s of seqs.get(moving) ?? []) {
            const sm = s.samples, n = sm.length;
            if (t < sm[0].t - 1e-9 || t > sm[n - 1].t + 1e-9) continue;
            for (let i = 1; i < n; i++) if (t <= sm[i].t + 1e-9) {
                const span = sm[i].t - sm[i - 1].t;
                return { fixed: s.fixed, q: span > 0 ? slerp(sm[i - 1].q, sm[i].q, (t - sm[i - 1].t) / span) : sm[i].q };
            }
            return { fixed: s.fixed, q: sm[0].q };
        }
        return null;
    }
    function total(plate, t, depth = 0) {
        if (plate === 0 || depth > 60) return [1, 0, 0, 0];
        const key = plate + '@' + t;
        if (cache.has(key)) return cache.get(key);
        const r = relative(plate, t);
        const q = r ? quatNormalize(quatMul(total(r.fixed, t, depth + 1), r.q)) : null;   // apply the relative motion, then the fixed plate's
        cache.set(key, q ?? [1, 0, 0, 0]);
        return q ?? [1, 0, 0, 0];
    }
    const span = id => { const s = seqs.get(id); return s ? [Math.min(...s.map(x => x.samples[0].t)), Math.max(...s.map(x => x.samples.at(-1).t))] : null; };
    return { seqs, total, relative, span, has: id => seqs.has(id) };
}

/** Static polygons from a .gpml or .gpmlz: [{ plateId, begin, end, type, ring: [[x,y,z]…], centre, radius }]. */
export function loadGpmlPolygons(path) {
    let xml = readFileSync(path);
    if (path.endsWith('.gpmlz')) xml = gunzipSync(xml);
    xml = xml.toString('utf8');
    const out = [];
    for (const chunk of xml.split('<gml:featureMember>').slice(1)) {
        const id = +(/<gpml:reconstructionPlateId>[\s\S]*?<gpml:value>\s*(-?\d+)/.exec(chunk)?.[1] ?? NaN);
        const times = [...chunk.matchAll(/<gml:timePosition[^>]*>([^<]+)</g)].map(m => m[1].trim());
        const num = s => s?.includes('distantPast') ? Infinity : s?.includes('distantFuture') ? -Infinity : +s;
        const type = /^\s*<gpml:(\w+)/.exec(chunk)?.[1] ?? '?';
        for (const m of chunk.matchAll(/<gml:posList[^>]*>([^<]+)</g)) {
            const v = m[1].trim().split(/\s+/).map(Number), ring = [];
            for (let i = 0; i + 1 < v.length; i += 2) ring.push(latLonToXyz(v[i], v[i + 1]));
            if (ring.length < 3) continue;
            const c = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]), l = Math.hypot(...c) || 1;
            const centre = c.map(x => x / l);
            let radius = 0;
            for (const p of ring) radius = Math.max(radius, Math.acos(Math.max(-1, Math.min(1, p[0] * centre[0] + p[1] * centre[1] + p[2] * centre[2]))));
            out.push({ plateId: id, begin: num(times[0]), end: num(times[1]), type, ring, centre, radius });
        }
    }
    return out;
}

/** Spherical point-in-polygon by winding number (polygons smaller than a hemisphere about their vertex mean). */
export function insidePolygon(poly, p) {
    const d = p[0] * poly.centre[0] + p[1] * poly.centre[1] + p[2] * poly.centre[2];
    if (Math.acos(Math.max(-1, Math.min(1, d))) > poly.radius + 1e-9) return false;
    // tangent-plane basis at p
    const a = Math.abs(p[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let e1 = [a[1] * p[2] - a[2] * p[1], a[2] * p[0] - a[0] * p[2], a[0] * p[1] - a[1] * p[0]];
    const l = Math.hypot(...e1); e1 = e1.map(x => x / l);
    const e2 = [p[1] * e1[2] - p[2] * e1[1], p[2] * e1[0] - p[0] * e1[2], p[0] * e1[1] - p[1] * e1[0]];
    let wind = 0, prev = null;
    const ring = poly.ring;
    for (let i = 0; i <= ring.length; i++) {
        const v = ring[i % ring.length];
        const ang = Math.atan2(v[0] * e2[0] + v[1] * e2[1] + v[2] * e2[2], v[0] * e1[0] + v[1] * e1[1] + v[2] * e1[2]);
        if (prev !== null) { let da = ang - prev; if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI; wind += da; }
        prev = ang;
    }
    return Math.abs(wind) > Math.PI;
}

/** Quasi-uniform points on the sphere (Fibonacci lattice): each stands for 4π/n sr. */
export function fibonacciSphere(n) {
    const pts = [], g = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
        const z = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - z * z);
        pts.push([r * Math.cos(g * i), r * Math.sin(g * i), z]);
    }
    return pts;
}

/** A netCDF4 lat/lon grid read with h5wasm (installed under tuning/earth/data by the fetch script). */
export async function loadNetcdfGrid(path, h5wasmDir) {
    const h5wasm = (await import(h5wasmDir + '/node_modules/h5wasm/dist/node/hdf5_hl.js')).default ?? await import(h5wasmDir + '/node_modules/h5wasm/dist/node/hdf5_hl.js');
    await h5wasm.ready;
    const f = new h5wasm.File(path, 'r');
    const keys = f.keys();
    const latK = keys.find(k => /^(lat|y)/i.test(k)), lonK = keys.find(k => /^(lon|x)/i.test(k));
    const zK = keys.find(k => k !== latK && k !== lonK && f.get(k)?.shape?.length === 2);
    const lat = f.get(latK).value, lon = f.get(lonK).value, ds = f.get(zK);
    const z = ds.value, fill = ds.attrs?._FillValue?.value;
    f.close();
    return { lat, lon, z, fill: Array.isArray(fill) ? fill[0] : fill, keys };
}
