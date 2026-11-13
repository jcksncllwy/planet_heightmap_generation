// The history's surface erosion (lane graded, 2026-11-12; Jackson: "erosion through the history itself"). Every river step
// (heights.riverEveryMyr) the land is eroded on the sim mesh by the finish's own law, on the GPU (gpu/erode-gpu.js): Braun &
// Willett 2013's implicit stream power, n = 1, with Yuan et al. 2019's deposition (ERODE.G) and lakes that keep their load
// until full — at the finish's k and m (finish.js erosionAt), base level the sea as the one mask finds it (terrain/land-mask.js).
// So the finish starts from ground already graded at the history's resolution, and the land's wear is set by its slope, its
// drainage and its base level, not by how high it stands (the rule this replaces: heights.js erosionAtHeight).
//
// What it changes is the crust's records, as the wear did (no new carried field):
//   · the rock it takes off (E, km) comes first out of the hollow's sediment (basinFillKm: it is softest and on top), then out
//     of the rock's parts by one share — the relief and the swells as they stand, the column by thinning its crust (Airy: the
//     ground falls E × the column's slope, ~1/6 of it, Molnar & England 1990) — as heights.js wore them; the crests by the
//     same share at CREST_WEAR of its rate; the bedrock goes to wornKm, the rivers' book (step/rivers.js routes it out);
//   · the sediment it lays (D, km) goes to basinFillKm, which stands at 1 / LAND_SEDIMENT_LOAD_FACTOR of it;
//   · the tectonic rise's reference moves with it (heights.js tectRefKm): erosion is not tectonics.
// Determinism: float32 on the GPU, its rounding the vendor's, and the erosion feeds the dynamics (rootKm, upliftKm), so a
// history depends on its GPU: app/history-key.js gpuFingerprint keys the cache by it.

import { CrustType, CrustFlag, VolcanicType } from '../model/crust.js';
import { columnModel, arcSurfaceKm, ARC_ROOT_SHARE, LAND_SEDIMENT_LOAD_FACTOR } from '../measure.js';
import { arcCrustKm } from './collision.js';
import { recordWear } from './geology.js';
import { erosionAtLatitude, rainAtLatitude } from '../../terrain/terrain-config.js';
import { historyErodeSettings } from './erode-settings.js';
import { FINISH, erosionAt } from '../../finish/finish-config.js';

const R = 6371;
// The crests (rugged, prevRugged) wear at this share of the relief's own rate (the e-folding times the wear rule had:
// reliefTauMyr 100 against ruggedTauMyr 368 — an old belt keeps its grain, the Appalachians)
export const CREST_WEAR = 100 / 368;


export { historyErodeSettings };

const fields = new WeakMap();
/** Per mesh and constants: each world cell's drainage weight (rain ÷ rainRefMm) and its k without the rock's hardness. */
function fieldsOf(mesh, H) {
    let byH = fields.get(mesh);
    if (!byH) fields.set(mesh, byH = new Map());
    let f = byH.get(H);
    if (f) return f;
    const n = mesh.numCells, water = new Float32Array(n), kLat = new Float32Array(n), E = erosionAt(FINISH, H);
    for (let c = 0; c < n; c++) {
        const lat = Math.asin(Math.max(-1, Math.min(1, mesh.xyz[3 * c + 2]))) * 180 / Math.PI;
        water[c] = rainAtLatitude(lat, H) / H.rainRefMm;
        kLat[c] = H.carveK * E.kMul * erosionAtLatitude(lat, H);
    }
    byH.set(H, f = { water, kLat, m: E.m });
    return f;
}

/**
 * The GPU's job for this river step: the land's height against the sea (`height`, km, on world cells; `land` 1/0).
 * @returns {{o: Object, P: Object}} erodeGPU's arguments (o.z is the ground, eroded in place)
 */
export function erosionRequest(world, land, height, spanMyr, H) {
    const { mesh, plates, owner, ownerCell } = world, n = mesh.numCells, F = fieldsOf(mesh, H);
    const z = new Float32Array(n), ocean = new Uint8Array(n), k = new Float32Array(n);
    for (let w = 0; w < n; w++) {
        if (!land[w]) { ocean[w] = 1; continue; }
        z[w] = height[w];
        const crust = plates[owner[w]].crust, c = ownerCell[w];
        // (a shield's crystalline basement is harder: terrain-config carveCratonHardness, as the finish's carve reads it)
        k[w] = F.kLat[w] * (crust.type[c] === CrustType.CRATON ? 1 - H.carveCratonHardness : 1);
    }
    const none = { lakes: [], sink: new Uint8Array(n), base: new Float32Array(n) };
    return { o: { mesh, z, ocean, water: F.water, k, m: F.m, seaKm: 0, closed: () => none, column: null, uplift: null }, P: historyErodeSettings(spanMyr), z0: Float32Array.from(z) };
}

/**
 * Write the GPU's erosion into the crust's records. `req` from erosionRequest, its o.z now eroded. `moved` (km, per world
 * cell) receives the sediment the step took up (+, a hollow's fill eroded) or laid (−): the rivers route it with the bedrock.
 * @returns {{eroded: number, laid: number, fillTaken: number, unplaced: number}} km³: bedrock taken, sediment laid, fill re-eroded,
 *          and rock the solve took that no record could give (an arc's own crest: it wears its own way)
 */
export function applyErosion(world, req, land, moved, H) {
    const { mesh, plates, owner, ownerCell, time } = world, n = mesh.numCells, cellArea = 4 * Math.PI * R * R / n;
    const geo = world.config.geology?.records ? world.config.geology : null, span = req.P.timeMyr;
    const C = columnModel(H), z = req.o.z, z0 = req.z0, F = LAND_SEDIMENT_LOAD_FACTOR;
    let eroded = 0, laid = 0, fillTaken = 0, unplaced = 0;
    for (let w = 0; w < n; w++) {
        moved[w] = 0;
        if (!land[w]) continue;
        const dz = z[w] - z0[w];
        if (dz === 0) continue;
        const crust = plates[owner[w]].crust, c = ownerCell[w], type = crust.type[c];
        if (dz > 0) { crust.basinFillKm[c] += dz; moved[w] = -dz; laid += dz; continue; }
        let E = -dz;
        // the hollow's sediment first
        const take = Math.min(E, crust.basinFillKm[c]);
        if (take > 0) { crust.basinFillKm[c] -= take; moved[w] = take; fillTaken += take; E -= take; }
        if (!(E > 0) || type === CrustType.OCEAN) { if (E > 0) unplaced += E; continue; }
        // then the rock, every part by one share — as far as the parts reach (land the mantle's swell holds up stands higher than
        // its parts): the rest thins the crust under it, the column's own job (Airy)
        const arc = type === CrustType.ARC, slope = arc ? C.slope[1] * ARC_ROOT_SHARE : C.slope[type];
        const colOf = () => (arc ? slope * Math.max(0, crust.rootKm[c]) : C.ref[type] + slope * crust.rootKm[c]);
        const col = colOf(), up = Math.max(0, crust.upliftKm[c]), b0 = Math.max(0, crust.baseKm[c]), parts = up + b0 + Math.max(0, col);
        const before = crust.upliftKm[c] + crust.baseKm[c] + col, r0 = crust.rootKm[c], c0 = crust.rugged[c] + crust.prevRugged[c];
        const drop = Math.min(parts, E * slope), keep = parts > 0 ? 1 - drop / parts : 1;
        if (crust.upliftKm[c] > 0) crust.upliftKm[c] *= keep;
        if (crust.baseKm[c] > 0) crust.baseKm[c] *= keep;
        if (col > 0) crust.rootKm[c] -= col * (1 - keep) / slope;
        let rest = E - drop / slope;
        if (rest > 1e-9) { if (arc) unplaced += rest; else crust.rootKm[c] -= rest; rest = arc ? rest : 0; }
        const x = keep > 0 ? -Math.log(keep) * CREST_WEAR : Infinity, crest = Math.exp(-x);
        crust.rugged[c] *= crest; crust.prevRugged[c] *= crest;
        // (the rock: the root thinned, and the crust the relief and the swells stood for — as heights.js wore them)
        const rock = r0 - crust.rootKm[c] + (up - Math.max(0, crust.upliftKm[c]) + b0 - Math.max(0, crust.baseKm[c])) / slope;
        crust.wornKm[c] += rock;
        // (the geological record, step/geology.js: the rock this took off, and a share of the crests)
        if (geo) recordWear(crust, c, rock + geo.crestShare * c0 * (1 - crest), 0, time, span, geo);
        crust.tectRefKm[c] += crust.upliftKm[c] + crust.baseKm[c] + colOf() - before;   // (erosion is not tectonic rise: heights.js)
        eroded += rock;
    }
    return { eroded: eroded * cellArea, laid: laid * cellArea, fillTaken: fillTaken * cellArea, unplaced: unplaced * cellArea };
}

/** The land's height against the sea that the history erodes and routes (km): as records.js draws the platform — the column,
 *  the belts' uplift, the swells, a flood basalt's pile, the mantle's swell against its side's reference, the sea's level —
 *  with the sediment in its hollows at its loaded height. A filled sea: its plain, from the sea's level up. */
export function landHeightKm(world, w, H, swellKm, seaKm, landRef, seaRef) {
    const C = columnModel(H), { plates, owner, ownerCell, time } = world;
    const crust = plates[owner[w]].crust, c = ownerCell[w], type = crust.type[c], laid = crust.basinFillKm[c] / LAND_SEDIMENT_LOAD_FACTOR;
    if (type === CrustType.OCEAN) return Math.max(0, seaKm) - seaKm + laid;
    let b, full;
    if (type === CrustType.ARC) {
        b = (crust.flags[c] & CrustFlag.MARGIN_ISLE) ? H.foreArcIsleKm
            : arcSurfaceKm(arcCrustKm(crust, c, time, world.config), crust.arcKm[c] > 0 ? time - crust.arcAt[c] : 0);     // (as the terrain stands it: records.js)
        full = b + C.slope[1] * ARC_ROOT_SHARE * Math.max(0, crust.rootKm[c]);
    } else full = C.ref[type] + C.slope[type] * crust.rootKm[c];
    full += crust.upliftKm[c] + crust.baseKm[c] + (crust.volcType[c] === VolcanicType.LIP ? Math.max(0, H.lipLandKm * Math.min(H.lipMaxKm, crust.volcKm[c]) - crust.volcWornKm[c]) : 0);
    // (the swell is the mantle's, broad: it tilts the land and its rivers with it)
    return full + swellKm[w] - (type === CrustType.ARC ? seaRef : landRef) - seaKm + laid;
}
