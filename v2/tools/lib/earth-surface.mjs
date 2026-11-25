// Earth's surface on the lab's meshes: the derived artifact tools/make-earth-surface.mjs writes (see there for the source
// and its provenance), read back for check-ocean-earth.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const EARTH_SURFACE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
export const EARTH_SURFACE_MESHES = [40000, 160000];
/** The terrain meshes (terrain-mesh.js) Earth is binned onto too: check-phase8b's coast by margin (lane coastsmooth). */
export const EARTH_TERRAIN_MESHES = [160000, 640000];

/** The terrain mesh Earth's ice (ICE-6G_C at 21 and 0 ka) is binned onto: check-iceage-earth (lane iceage; make-earth-ice.mjs). */
export const EARTH_ICE_MESH = 160000;

/** The mesh's topology, hashed (cell count and adjacency): the artifact is per cell id, so it holds only on this mesh.
 *  Positions are left out: their last bits differ by CPU (mathFingerprint), the cells and their neighbours do not. */
export function meshFingerprint(mesh) {
    const h = crypto.createHash('sha256');
    h.update(Buffer.from(Uint32Array.from(mesh.adjOffset).buffer)); h.update(Buffer.from(Uint32Array.from(mesh.adjList).buffer));
    return `${mesh.numCells}:${h.digest('hex').slice(0, 16)}`;
}

/** Earth's surface in km on `mesh` (one of EARTH_SURFACE_MESHES), or { error } when the artifact is missing or stale. */
export function earthSurfaceKm(mesh, { terrain = false } = {}) {
    const man = JSON.parse(fs.readFileSync(path.join(EARTH_SURFACE_DIR, 'earth-surface.json'), 'utf8')), m = (terrain ? man.terrain ?? {} : man.meshes)[mesh.numCells];
    if (!m) return { error: `no artifact for ${mesh.numCells} cells` };
    const fp = meshFingerprint(mesh);
    if (fp !== m.fingerprint) return { error: `mesh changed (${fp} vs ${m.fingerprint}): re-run tools/make-earth-surface.mjs` };
    const b = fs.readFileSync(path.join(EARTH_SURFACE_DIR, m.file)), i16 = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2), z = new Float32Array(i16.length);
    for (let c = 0; c < z.length; c++) z[c] = i16[c] / 1000;
    return { z, sourceSha256: man.sourceSha256 };
}

/** Earth's ice on the terrain mesh of EARTH_ICE_MESH cells (make-earth-ice.mjs): { lgm, now } (Uint8Array, 1 under ICE-6G_C's
 *  ice at 21 ka / 0 ka) and thickNowKm (today's ice's thickness, km; null in an older artifact), or { error } when the artifact is missing or its mesh has changed. */
export function earthIce(mesh) {
    const m = JSON.parse(fs.readFileSync(path.join(EARTH_SURFACE_DIR, 'earth-surface.json'), 'utf8')).ice;
    if (!m || m.numCells !== mesh.numCells) return { error: `no ice artifact for ${mesh.numCells} cells (run tools/make-earth-ice.mjs)` };
    const fp = meshFingerprint(mesh);
    if (fp !== m.fingerprint) return { error: `mesh changed (${fp} vs ${m.fingerprint}): re-run tools/make-earth-ice.mjs` };
    const b = fs.readFileSync(path.join(EARTH_SURFACE_DIR, m.file));
    // (today's ice's thickness, km, where the artifact has it: ICE-6G_C's surface over its bed at 0 ka)
    let thickNowKm = null;
    if (m.thickFile && fs.existsSync(path.join(EARTH_SURFACE_DIR, m.thickFile))) { const t = fs.readFileSync(path.join(EARTH_SURFACE_DIR, m.thickFile)), i16 = new Int16Array(t.buffer, t.byteOffset, t.byteLength / 2); thickNowKm = Float32Array.from(i16, v => v / 1000); }
    return { lgm: Uint8Array.from(b, v => v & 1), now: Uint8Array.from(b, v => v >> 1 & 1), thickNowKm, source: m.source };
}
