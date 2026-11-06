// Dump a sim mesh's cell centres (Float64 xyz, little-endian) for the offline pygplates precompute, which cannot call JS:
//   node v2/tools/earth-replay-mesh.mjs [--cells 40000 ...]   → tuning/earth/data/mesh-<cells>.f64
// The mesh is the lab's (fixed seed 12345, tools/lib/check-kit.mjs labMesh), the same the checks and check-scale.mjs build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { labMesh } from './lib/check-kit.mjs';

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../tuning/earth/data');
export const MESH_SIZES = [40000, 80000];            // check-scale.mjs COARSE and FINE

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2), sizes = args[0] === '--cells' ? args.slice(1).map(Number) : MESH_SIZES;
    mkdirSync(DATA_DIR, { recursive: true });
    for (const n of sizes) {
        const mesh = labMesh(n), buf = Buffer.from(new Float64Array(mesh.xyz).buffer);
        writeFileSync(join(DATA_DIR, `mesh-${n}.f64`), buf);
        console.log(`mesh-${n}.f64: ${mesh.numCells} cells, ${buf.length} bytes`);
    }
}
