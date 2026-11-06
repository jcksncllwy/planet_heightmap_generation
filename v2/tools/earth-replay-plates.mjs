// Loader for the precomputed plate-id table (tools/earth-replay-plates.py) and the Müller 2019 rotations. Reads only
// reconstruction inputs: this is a t₀-side module, safe for the start builder to import (see earth-replay-manifest.mjs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './earth-replay-mesh.mjs';
import { loadRotations } from './earth-replay-lib.mjs';

export const MULLER_ROT = join(DATA_DIR, 'raw/muller2019/Rotations/Rotations/Muller_etal_2019_CombinedRotations.rot');

/** Plate id per cell at each whole Ma: `at(ma)` is a Uint16Array view (0 = no topology there). Throws if the table is absent. */
export function loadPlateTable(cells) {
    const buf = readFileSync(join(DATA_DIR, `plates-${cells}.u16`)), meta = JSON.parse(readFileSync(join(DATA_DIR, `plates-${cells}.json`), 'utf8'));
    const n = meta.cells, all = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
    if (all.length !== n * meta.times) throw new Error(`plates-${cells}.u16 is ${all.length} ids, expected ${n} × ${meta.times}`);
    return { cells: n, times: meta.times, meta, at: ma => { const t = Math.round(ma); if (t < 0 || t >= meta.times) throw new RangeError(`no plate table for ${ma} Ma`); return all.subarray(t * n, (t + 1) * n); } };
}

export const loadMullerRotations = () => loadRotations(MULLER_ROT);
