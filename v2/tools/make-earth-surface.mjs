// Earth's surface binned onto the lab's meshes, for check-ocean-earth (lane sliders). Writes the DERIVED artifact
// v2/tools/data/earth-surface-{40,160}k.i16 (one little-endian int16 per cell: the mean height in m of the ETOPO5 pixels
// that fall in it, by area) and earth-surface.json (its provenance: the source file's sha256, the mesh, the sampling), so
// the check runs where the 18 MB source is absent (the GCP gate: tuning/civ/data/ is gitignored).
// Source: ETOPO5 (NOAA NGDC 1988, 5′ grid, 4320 × 2160 big-endian int16 m, rows from 90° N, columns from 0° E; the ice
// surface on the ice sheets), fetched by tuning/civ/fetch-earth.sh. Every second row and column is sampled (10′, 2.3M
// pixels, ~30 per 160K cell); a cell no pixel fell in takes its neighbours' mean. Rounding to 1 m moves the poured level
// by well under 1 m.
// Re-run when labMesh changes (the check refuses an artifact whose mesh fingerprint no longer matches).
// Usage: node v2/tools/make-earth-surface.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { labMesh } from './lib/check-kit.mjs';
import { meshFingerprint, EARTH_SURFACE_DIR, EARTH_SURFACE_MESHES } from './lib/earth-surface.mjs';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ETOPO = path.join(ROOT, 'tuning/civ/data/raw/etopo/ETOPO5.DAT');

function earthSurfaceM(mesh, buf) {
    const n = mesh.numCells, sum = new Float64Array(n), wt = new Float64Array(n), D = Math.PI / 180;
    for (let r = 0; r < 2160; r += 2) {
        const la = (90 - (r + 0.5) / 12) * D, cl = Math.cos(la), sl = Math.sin(la);
        for (let q = 0; q < 4320; q += 2) {
            const lo = ((q + 0.5) / 12) * D, c = mesh.index.nearest(cl * Math.cos(lo), cl * Math.sin(lo), sl);
            sum[c] += cl * buf.readInt16BE(2 * (r * 4320 + q)); wt[c] += cl;
        }
    }
    const z = new Float64Array(n);
    for (let c = 0; c < n; c++) z[c] = wt[c] > 0 ? sum[c] / wt[c] : NaN;
    for (let c = 0; c < n; c++) if (z[c] !== z[c]) { let s = 0, k = 0; for (let j = mesh.adjOffset[c]; j < mesh.adjOffset[c + 1]; j++) { const v = z[mesh.adjList[j]]; if (v === v) { s += v; k++; } } z[c] = k ? s / k : 0; }
    const out = new Int16Array(n);
    for (let c = 0; c < n; c++) out[c] = Math.round(z[c]);
    return out;
}

if (!fs.existsSync(ETOPO)) { console.error(`missing ${ETOPO} (run tuning/civ/fetch-earth.sh)`); process.exit(1); }
const buf = fs.readFileSync(ETOPO), manifest = {
    source: 'ETOPO5 (NOAA NGDC 1988), tuning/civ/fetch-earth.sh', sourceSha256: crypto.createHash('sha256').update(buf).digest('hex'),
    sampling: 'every 2nd row and column (10′), area-weighted (cos lat) mean per nearest cell, m, rounded', tool: 'v2/tools/make-earth-surface.mjs', meshes: {},
};
for (const cells of EARTH_SURFACE_MESHES) {
    const mesh = labMesh(cells), z = earthSurfaceM(mesh, buf), file = `earth-surface-${cells / 1000}k.i16`;
    fs.writeFileSync(path.join(EARTH_SURFACE_DIR, file), Buffer.from(z.buffer));
    manifest.meshes[mesh.numCells] = { file, numCells: mesh.numCells, fingerprint: meshFingerprint(mesh), sha256: crypto.createHash('sha256').update(Buffer.from(z.buffer)).digest('hex') };
    console.log(`${cells}: ${file} ${z.byteLength} B`);
}
fs.writeFileSync(path.join(EARTH_SURFACE_DIR, 'earth-surface.json'), JSON.stringify(manifest, null, 2) + '\n');
