// Earth's surface on the lab's meshes: the derived artifact tools/make-earth-surface.mjs writes (see there for the source
// and its provenance), read back for check-ocean-earth.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const EARTH_SURFACE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
export const EARTH_SURFACE_MESHES = [40000, 160000];

/** The mesh's topology, hashed (cell count and adjacency): the artifact is per cell id, so it holds only on this mesh.
 *  Positions are left out: their last bits differ by CPU (mathFingerprint), the cells and their neighbours do not. */
export function meshFingerprint(mesh) {
    const h = crypto.createHash('sha256');
    h.update(Buffer.from(Uint32Array.from(mesh.adjOffset).buffer)); h.update(Buffer.from(Uint32Array.from(mesh.adjList).buffer));
    return `${mesh.numCells}:${h.digest('hex').slice(0, 16)}`;
}

/** Earth's surface in km on `mesh` (one of EARTH_SURFACE_MESHES), or { error } when the artifact is missing or stale. */
export function earthSurfaceKm(mesh) {
    const man = JSON.parse(fs.readFileSync(path.join(EARTH_SURFACE_DIR, 'earth-surface.json'), 'utf8')), m = man.meshes[mesh.numCells];
    if (!m) return { error: `no artifact for ${mesh.numCells} cells` };
    const fp = meshFingerprint(mesh);
    if (fp !== m.fingerprint) return { error: `mesh changed (${fp} vs ${m.fingerprint}): re-run tools/make-earth-surface.mjs` };
    const b = fs.readFileSync(path.join(EARTH_SURFACE_DIR, m.file)), i16 = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2), z = new Float32Array(i16.length);
    for (let c = 0; c < z.length; c++) z[c] = i16[c] / 1000;
    return { z, sourceSha256: man.sourceSha256 };
}
