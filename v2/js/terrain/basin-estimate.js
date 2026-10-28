// The seas cut off from the world ocean on a timeline frame, estimated (2026-10-28, shoreline round 2). A frame has no
// climate, so world-ocean.js could only say such a sea's level is unknown, and the timeline drew all of it grey-teal —
// which read as water, though most of them are dry hollows (the finish, finish-basins.js, finds a playa or a salt flat
// in most). Here each is balanced as the finish balances it (finish-basins.js closedBasins: its catchment's runoff
// against what its water would lose at each level — lakeBalance), only with the zonal climate the history's own erosion
// reads instead of a computed one:
//
//  · rain: terrain-config.js rainByLatitude (rainAtLatitude: zonal means, the same table the history erodes by), less
//    inland as the sea's moisture rains out on its way (× e^(−d / rainInlandKm), d the distance from the world ocean);
//  · temperature: tempByLatitude (zonal annual means at sea level) less the lapse rate with height;
//  · potential evaporation and runoff: the finish's own formulas (finish-config.js petBaseMm + petPerC × T; Budyko's
//    curve in Fu's form, budykoW), so the two disagree only where the climate does (rain shadows, monsoons, continental
//    interiors — what a zonal table cannot know).
//
// A sea that fills to its sill is drawn as a lake at its spill level (its hollow's ground above sea level drowned too);
// one that keeps a lake below its sill, as that lake at its balance level and dry ground around it; one that dries, as
// lowland (a salt flat or a playa: no water stands). Agreement with the finish, in sign (wet or dry) per sea, is
// measured by tools/basin-agree.mjs.

import { rainAtLatitude } from './terrain-config.js';
import { FINISH } from '../finish/finish-config.js';
import { closedBasins } from '../finish/finish-basins.js';

const R = 6371, D2R = Math.PI / 180;

/** Zonal mean temperature at sea level (°C) at a latitude, from cfg.tempByLatitude. */
export function tempAtLatitude(latDeg, cfg) {
    const table = cfg.tempByLatitude, a = Math.min(90, Math.abs(latDeg));
    for (let i = 1; i < table.length; i++) {
        const [l0, t0] = table[i - 1], [l1, t1] = table[i];
        if (a <= l1) return t0 + (t1 - t0) * (a - l0) / (l1 - l0);
    }
    return table[table.length - 1][1];
}

/**
 * The zonal water balance per cell: rain, potential evaporation and runoff (mm/yr) — the finish's formulas on the
 * zonal climate (heights in km above the frame's sea).
 */
export function zonalWater(mesh, z, cfg, F = FINISH, ocean = null) {
    const n = mesh.numCells, Z = zonalOf(mesh, cfg), rain = new Float32Array(n), pet = new Float32Array(n), runoff = new Float32Array(n);
    // (the rain the zonal mean gives, less inland: what the winds bring from the sea rains out as they go — ocean is the
    // world ocean, its distance spread over the mesh's cells)
    const inland = ocean && cfg.rainInlandKm > 0 ? oceanDistance(mesh, ocean) : null, L = cfg.rainInlandKm;
    const lapse = cfg.lapseRateCPerKm ?? 6.5, w = F.budykoW, iw = 1 / w;
    for (let c = 0; c < n; c++) {
        if (ocean && ocean[c]) continue;                          // (the world ocean's cells: the balance never reads them)
        const P = inland ? Z.rain[c] * Math.exp(-inland[c] / L) : Z.rain[c], E0 = Math.max(F.petMinMm, F.petBaseMm + F.petPerC * (Z.temp[c] - lapse * Math.max(0, z[c])));
        rain[c] = P; pet[c] = E0;
        if (P > 0) { const f = E0 / P; runoff[c] = Math.max(0, P - P * (1 + f - Math.pow(1 + Math.pow(f, w), iw))); }
    }
    return { rain, pet, runoff };
}

/** Distance (km) from the world ocean over the mesh (cells × its mean edge; a breadth-first spread). */
function oceanDistance(mesh, ocean) {
    const n = mesh.numCells, d = new Float32Array(n).fill(Infinity), q = new Int32Array(n), step = mesh.edgeKm ?? 2 * R * Math.sqrt(Math.PI / n);
    let len = 0;
    for (let c = 0; c < n; c++) if (ocean[c]) { d[c] = 0; q[len++] = c; }
    for (let i = 0; i < len; i++) {
        const c = q[i];
        for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) { const b = mesh.adjList[k]; if (d[b] === Infinity) { d[b] = d[c] + step; q[len++] = b; } }
    }
    return d;
}

// (the zonal climate per cell of a mesh, at sea level — by latitude only, so once per mesh)
let zonal = null;
function zonalOf(mesh, cfg) {
    if (zonal?.mesh === mesh && zonal.cfg === cfg) return zonal;
    const n = mesh.numCells, xyz = mesh.xyz, rain = new Float32Array(n), temp = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        const lat = Math.asin(Math.max(-1, Math.min(1, xyz[3 * c + 2]))) / D2R;
        rain[c] = rainAtLatitude(lat, cfg); temp[c] = tempAtLatitude(lat, cfg);
    }
    return (zonal = { mesh, cfg, rain, temp });
}

/**
 * The seas cut off from the world ocean (water from world-ocean.js), balanced: adds to `water`
 *  · cut (replaced): 1 where water stands in them by the estimate — at its level, ground above the sea it drowns included;
 *  · dry: 1 on the ground of a cut-off sea the estimate leaves dry;
 *  · paintKm: heights to paint by — a lake's cells its depth under its own level (below the frame's sea), dry ground just
 *    above the sea (lowland) — or null when there is no cut-off sea;
 *  · seas: per sea {km2, floorKm, sillKm, levelKm, full, wet, low (its lowest cell)}.
 * The heights themselves are not changed.
 */
export function estimateCutOff(mesh, z, water, cfg, seaLevelKm = 0, F = FINISH) {
    const n = mesh.numCells;
    // (nothing to balance unless a cut-off body is as large as the finish balances: finish-config.js basinMinKm2)
    const cellKm2 = 4 * Math.PI * R * R / n, any = (water.bodies ?? []).slice(1).some(b => b.cells * cellKm2 >= F.basinMinKm2);
    if (!any) return Object.assign(water, { dry: new Uint8Array(n), paintKm: null, seas: [] });
    const zz = new Float32Array(n);
    for (let c = 0; c < n; c++) zz[c] = z[c] - seaLevelKm;
    const ocean = water.ocean ?? null;
    const { rain, pet, runoff } = zonalWater(mesh, zz, cfg, F, ocean);
    const B = closedBasins(mesh, zz.slice(), runoff, pet, rain, cellKm2, F, ocean ?? oceanOf(water, n));
    const cut = new Uint8Array(n), dry = new Uint8Array(n), paintKm = Float32Array.from(z), seas = [];
    for (const S of B.seas) {
        const id = S.id, level = S.levelKm;
        let low = -1;
        for (const c of B.lakes[id].cells) {
            if (low < 0 || zz[c] < zz[low]) low = c;
            // (water: the whole hollow when it fills to its sill; else each of its lakes at its own level — finish-basins.js
            // hollowLakes: a sub-basin behind a sill stands at its own balance)
            const lv = S.full ? level : B.water[c], wet = S.full ? zz[c] < lv : lv === lv;
            if (wet) { cut[c] = 1; paintKm[c] = seaLevelKm + Math.min(-0.001, zz[c] - lv); }
            else if (zz[c] < 0) { dry[c] = 1; paintKm[c] = seaLevelKm + 0.002; }
        }
        seas.push({ km2: S.km2, floorKm: S.floorKm, sillKm: S.sillKm, levelKm: level, full: S.full, wet: S.wet, low });
    }
    // (a cut-off body under basinMinKm2 — too small for the finish to balance — stays as world-ocean.js marks it)
    for (let c = 0; c < n; c++) if (water.cut[c] && !cut[c] && !dry[c]) cut[c] = 1;
    return Object.assign(water, { cut, dry, paintKm, seas });
}

const oceanOf = (water, n) => { const o = new Uint8Array(n); for (let c = 0; c < n; c++) if (water.ocean?.[c]) o[c] = 1; return o; };
