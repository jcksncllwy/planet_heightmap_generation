// Earth's ice, then and now, on the terrain mesh, for check-iceage-earth (lane iceage): writes the DERIVED artifact
// v2/tools/data/earth-ice-160k.u8 (one byte per cell: bit 0 under ICE-6G_C's ice at 21 ka, the Last Glacial Maximum; bit 1
// under its ice at 0 ka, today's sheets) and its provenance in earth-surface.json's `ice` entry (the source files' sha256, the
// mesh's fingerprint, the sampling), so the check runs where the 75 MB of source is absent.
// Source: ICE-6G_C (Peltier, Argus & Drummond 2015, JGR Solid Earth 120, 450–487), PMIP4's LGM ice sheets: `sftgif`, the
// ice's share of each 10′ point (%), fetched by tuning/climate/fetch-ice6g.sh. A cell is under the ice when the mean share of
// the points nearest it (cos-lat weighted) is at least half. Earth's surface itself is earth-terrain-160k.i16 (ETOPO5,
// make-earth-surface.mjs): the same mesh.
// Usage: node v2/tools/make-earth-ice.mjs [--ice6g tuning/climate/data/ice6g]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { meshFingerprint, EARTH_SURFACE_DIR, EARTH_ICE_MESH } from './lib/earth-surface.mjs';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const at = process.argv.indexOf('--ice6g'), DIR = at > 0 ? path.resolve(process.argv[at + 1]) : path.join(ROOT, 'tuning/climate/data/ice6g');

/** One 2-D float variable of a netCDF-3 classic file (CDF\x01 / \x02), and its file's bytes: ICE-6G_C's layout (no record
 *  dimension). Enough for these files only — tuning/climate/lib/nc-read.mjs is the general reader (it needs netcdfjs). */
function readNc3(file, want) {
    const b = fs.readFileSync(file), v = new DataView(b.buffer, b.byteOffset, b.byteLength), version = b[3];
    if (b.toString('latin1', 0, 3) !== 'CDF') throw new Error(`${file}: not netCDF-3`);
    let p = 8;
    const u32 = () => { const x = v.getUint32(p); p += 4; return x; }, off = () => { if (version === 2) { const x = Number(v.getBigUint64(p)); p += 8; return x; } return u32(); };
    const name = () => { const n = u32(), s = b.toString('latin1', p, p + n); p += (n + 3) & ~3; return s; };
    const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };
    const skipAttrs = () => { const tag = u32(), n = u32(); if (!tag && !n) return; for (let i = 0; i < n; i++) { name(); const t = u32(), m = u32(); p += (m * SIZE[t] + 3) & ~3; } };
    const dims = [];
    { const tag = u32(), n = u32(); if (tag || n) for (let i = 0; i < n; i++) dims.push({ name: name(), len: u32() }); }
    skipAttrs();
    const vars = {};
    { const tag = u32(), n = u32(); if (tag || n) for (let i = 0; i < n; i++) {
        const nm = name(), nd = u32(), ids = []; for (let k = 0; k < nd; k++) ids.push(u32());
        skipAttrs(); const type = u32(); u32(); vars[nm] = { dims: ids.map(d => dims[d]), type, begin: off() };
    } }
    const get = nm => {
        const V = vars[nm]; if (!V || V.type !== 5) throw new Error(`${file}: no float variable ${nm}`);
        const len = V.dims.reduce((a, d) => a * d.len, 1), o = new Float32Array(len);
        for (let i = 0; i < len; i++) o[i] = v.getFloat32(V.begin + 4 * i);
        return { data: o, dims: V.dims };
    };
    return { bytes: b, out: Object.fromEntries(want.map(w => [w, get(w)])) };
}

const files = { lgm: path.join(DIR, 'I6_C.VM5a_10min.21.nc'), now: path.join(DIR, 'I6_C.VM5a_10min.0.nc') };
for (const f of Object.values(files)) if (!fs.existsSync(f)) { console.error(`missing ${f} (run tuning/climate/fetch-ice6g.sh)`); process.exit(1); }
const mesh = terrainMesh(EARTH_ICE_MESH), n = mesh.numCells, D = Math.PI / 180, out = new Uint8Array(n), sources = {};
for (const [bit, key] of [[0, 'lgm'], [1, 'now']]) {
    const { bytes, out: { sftgif, lat, lon } } = readNc3(files[key], ['sftgif', 'lat', 'lon']), [NY, NX] = sftgif.dims.map(d => d.len);
    sources[key] = { file: path.basename(files[key]), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    const sum = new Float64Array(n), wt = new Float64Array(n);
    for (let j = 0; j < NY; j++) {
        const la = lat.data[j] * D, cl = Math.cos(la), sl = Math.sin(la);
        for (let i = 0; i < NX; i++) {
            const lo = lon.data[i] * D, c = mesh.index.nearest(cl * Math.cos(lo), cl * Math.sin(lo), sl);
            sum[c] += cl * sftgif.data[j * NX + i]; wt[c] += cl;
        }
    }
    // (a cell no point fell in takes its neighbours' mean)
    for (let c = 0; c < n; c++) {
        let s = wt[c] > 0 ? sum[c] / wt[c] : NaN;
        if (s !== s) { let a = 0, k = 0; for (let q = mesh.adjOffset[c]; q < mesh.adjOffset[c + 1]; q++) { const nb = mesh.adjList[q]; if (wt[nb] > 0) { a += sum[nb] / wt[nb]; k++; } } s = k ? a / k : 0; }
        if (s >= 50) out[c] |= 1 << bit;
    }
}
const file = `earth-ice-${EARTH_ICE_MESH / 1000}k.u8`, manPath = path.join(EARTH_SURFACE_DIR, 'earth-surface.json'), man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
fs.writeFileSync(path.join(EARTH_SURFACE_DIR, file), out);
man.ice = { source: 'ICE-6G_C (Peltier, Argus & Drummond 2015), sftgif at 21 and 0 ka, tuning/climate/fetch-ice6g.sh', sources,
    sampling: 'every 10′ point to its nearest cell, cos-lat weighted mean share ≥ 50 %; bit 0: 21 ka, bit 1: 0 ka', tool: 'v2/tools/make-earth-ice.mjs',
    file, numCells: n, fingerprint: meshFingerprint(mesh), sha256: crypto.createHash('sha256').update(out).digest('hex') };
fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');
const km2 = 4 * Math.PI * 6371 ** 2 / n, area = bit => { let s = 0; for (let c = 0; c < n; c++) if (out[c] >> bit & 1) s += km2; return (s / 1e6).toFixed(2); };
console.log(`${file}: ${n} cells; ice at 21 ka ${area(0)} Mkm², at 0 ka ${area(1)} Mkm²`);
