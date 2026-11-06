// The t₀-side loader of the Earth replay: reads the ALLOWLISTED inputs of a start at t₀ (Q5.5 of the study) and hands them to
// scenarios/earth-start.js as plain arrays. Every file goes through `readInput`, which refuses anything not in MANIFEST — today's
// observations (ETOPO, WorldClim, HydroRIVERS, CRUST1.0, palaeo-DEMs) are compare-side only and have no entry here; the age grid
// is only the one AT t₀. tools/earth-replay-start-check.mjs asserts the allowlist and the import graph.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './earth-replay-mesh.mjs';
import { loadNetcdfGrid } from './earth-replay-lib.mjs';
import { loadPlateTable } from './earth-replay-plates.mjs';
import { xyzToLatLon } from '../js/tectonics/step/kinematics.js';

/** Every file a start may read, as a function of (cells, t₀). */
export const MANIFEST = Object.freeze({
    'rotations (Müller 2019)':            () => 'raw/muller2019/Rotations/Rotations/Muller_etal_2019_CombinedRotations.rot',
    'topologies → plate ids, all times':  cells => `plates-${cells}.u16`,
    'plate-id table meta':                cells => `plates-${cells}.json`,
    'crust class at t₀':                  (cells, t0) => `crust-${cells}-${t0}.u8`,
    'trenches at t₀':                     (cells, t0) => `trench-${cells}-${t0}.u8`,
    'ocean age grid at t₀':               (cells, t0) => `raw/muller2019/agegrid/age-${t0}.nc`,
});
const allowed = (cells, t0) => new Set(Object.values(MANIFEST).map(f => f(cells, t0)));

export function readInput(rel, cells, t0) {
    if (!allowed(cells, t0).has(rel)) throw new Error(`earth start input not in the manifest: ${rel}`);
    return readFileSync(join(DATA_DIR, rel));
}

/** The `inputs` argument of buildEarthStart for this mesh at t₀ (a whole Ma with a precomputed crust file and an age grid). */
export async function loadStartInputs(mesh, t0) {
    const cells = mesh.numCells - 1;                         // (files are named for the requested cell count; the mesh has one more)
    const table = loadPlateTable(cells);
    const u8 = rel => { const b = readInput(rel, cells, t0); return new Uint8Array(b.buffer, b.byteOffset, b.length); };
    const crustClass = u8(MANIFEST['crust class at t₀'](cells, t0)), trench = u8(MANIFEST['trenches at t₀'](cells, t0));
    // (the grid's path passes the same gate: readInput checks the name, loadNetcdfGrid then opens it)
    const gridRel = MANIFEST['ocean age grid at t₀'](cells, t0);
    if (!allowed(cells, t0).has(gridRel)) throw new Error('age grid not in manifest');
    const { lat, lon, z, fill } = await loadNetcdfGrid(join(DATA_DIR, gridRel), DATA_DIR);
    const nx = lon.length, ny = lat.length, ageMyr = new Float32Array(mesh.numCells);
    for (let c = 0; c < mesh.numCells; c++) {
        const { lat: la, lon: lo } = mesh_latlon(mesh, c);
        const j = Math.min(ny - 1, Math.max(0, Math.round((la - lat[0]) / (lat[ny - 1] - lat[0]) * (ny - 1))));
        const i = Math.min(nx - 1, Math.max(0, Math.round((((lo - lon[0]) % 360 + 360) % 360) / (lon[nx - 1] - lon[0]) * (nx - 1))));
        const v = z[j * nx + i];
        ageMyr[c] = Number.isFinite(v) && v !== fill && v >= 0 && v < 1000 ? v : NaN;
    }
    return { t0, plateIds: Uint16Array.from(table.at(t0)), crustClass, trench, ageMyr };
}

const mesh_latlon = (mesh, c) => xyzToLatLon(mesh.xyz[3 * c], mesh.xyz[3 * c + 1], mesh.xyz[3 * c + 2]);
