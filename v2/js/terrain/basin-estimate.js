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
//  · potential evaporation and runoff: the water ledger's (climate/water.js): Priestley–Taylor from the latitude's
//    sunlight and the temperature, its seasons the temperature stage's land response (zonalPET), and Budyko's curve in
//    Fu's form (budykoW) — the finish's own, so the two disagree only where the climate does (rain shadows, monsoons,
//    continental interiors — what a zonal table cannot know). Until 2026-11-06 the temperature's 300 + 55 T: 1/5–1/2 of
//    the climate's own below 5 °C, its runoff 0.43–0.54 of the rain against the finish's 0.34–0.40 (tools/water-study.mjs).
//
// A sea that fills to its sill is drawn as a lake at its spill level (its hollow's ground above sea level drowned too);
// one that keeps a lake below its sill, as that lake at its balance level and dry ground around it; one that dries, as a
// dry hollow at its true depth: a salt flat at the bottom, playa above it, bare walls (no water stands; until 2026-11-09
// every dry cell was painted 2 m above sea level, a green lowland where a 6 km hole was). Agreement with the finish, in
// sign (wet or dry) per sea, is measured by tools/basin-agree.mjs.
//
// The water is conserved. The history (tectonics/ocean/inventory.js pourOcean) pours its whole inventory into the
// ocean-connected ground every frame and holds every hollow behind a sill empty; water a cut-off sea holds here is the
// world ocean's — what it loses by evaporation reaches the ocean through the atmosphere — so the ocean is drawn lower by
// it (oceanFallKm: 0–77 m over three seeds' histories, median ~1 m). An equilibrium per frame, nothing carried between
// frames: a sea dries in 10³–10⁴ years (the Messinian), a frame is 10⁶–10⁷. tools/check-waterbooks.mjs closes the books.

import { rainAtLatitude } from './terrain-config.js';
import { FINISH } from '../finish/finish-config.js';
import { closedBasins } from '../finish/finish-basins.js';
import { zonalPETAt, fuEvaporation } from '../climate/water.js';
import { worldOcean } from './world-ocean.js';
import { hillshade } from '../view/terrain-shade.js';

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
    const lapse = cfg.lapseRateCPerKm ?? 6.5;
    for (let c = 0; c < n; c++) {
        if (ocean && ocean[c]) continue;                          // (the world ocean's cells: the balance never reads them)
        const P = inland ? Z.rain[c] * Math.exp(-inland[c] / L) : Z.rain[c], E0 = Math.max(F.petMinMm, zonalPETAt(Z.lat[c], Z.temp[c] - lapse * Math.max(0, z[c])));
        rain[c] = P; pet[c] = E0;
        runoff[c] = P > 0 ? P - fuEvaporation(P, E0, F.budykoW) : 0;
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
    const n = mesh.numCells, xyz = mesh.xyz, rain = new Float32Array(n), temp = new Float32Array(n), lats = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        const lat = Math.asin(Math.max(-1, Math.min(1, xyz[3 * c + 2]))) / D2R;
        rain[c] = rainAtLatitude(lat, cfg); temp[c] = tempAtLatitude(lat, cfg); lats[c] = lat;
    }
    return (zonal = { mesh, cfg, rain, temp, lat: lats });
}

/**
 * The seas cut off from the world ocean (water from world-ocean.js), balanced: adds to `water`
 *  · cut (replaced): 1 where water stands in them by the estimate — at its level, ground above the sea it drowns included;
 *    2 on the ground of a cut-off sea the estimate leaves dry (the painters' third row: salt flat, playa, bare walls);
 *  · dry: 1 where cut is 2;
 *  · paintKm: heights to paint by, or null when no water is held apart from the world ocean — a lake's cells its depth
 *    under its own level (below the frame's sea); dry ground below the sea by its height above the hollow's brine lake
 *    (or its floor, if none: sea − 1 m − that height, so the dry row's colours run from salt at the bottom to the walls,
 *    and a lake's shore blends with its lake); every other cell at its height + oceanFallKm (the world ocean lowered);
 *  · heldKm3: the water standing apart from the world ocean (every cut-off body, balanced or not);
 *  · oceanFallKm: how far the world ocean falls to hold that water back (heldKm3 over its area) — the history pours its
 *    whole inventory into the ocean-connected ground (tectonics/ocean/inventory.js pourOcean) and holds every hollow
 *    behind a sill empty, so water a view stands in a cut-off sea is the ocean's: it is debited here, and the books close;
 *  · seas: per sea {km2, floorKm, sillKm, levelKm, full, wet, low (its lowest cell), heldKm3}.
 * The heights themselves are not changed: a dry sea is drawn at its true floor (hillshade by `dry`, as land).
 */
export function estimateCutOff(mesh, z, water, cfg, seaLevelKm = 0, F = FINISH) {
    const n = mesh.numCells, cellKm2 = 4 * Math.PI * R * R / n, cut = new Uint8Array(n), dry = new Uint8Array(n), seas = [];
    // (nothing to balance unless a cut-off body is as large as the finish balances: finish-config.js basinMinKm2)
    const any = (water.bodies ?? []).slice(1).some(b => b.cells * cellKm2 >= F.basinMinKm2);
    const zz = new Float32Array(n);
    for (let c = 0; c < n; c++) zz[c] = z[c] - seaLevelKm;
    const level = new Float32Array(n).fill(NaN), base = new Float32Array(n).fill(NaN);   // (a wet cell's water level; a dry one's floor)
    if (any) {
        const ocean = water.ocean ?? null;
        const { rain, pet, runoff } = zonalWater(mesh, zz, cfg, F, ocean);
        const kept = new Float32Array(n);                             // (the sky water each cell's ground keeps: closedBasins)
        for (let c = 0; c < n; c++) kept[c] = rain[c] - runoff[c];
        const B = closedBasins(mesh, zz.slice(), runoff, pet, kept, cellKm2, F, ocean ?? oceanOf(water, n));
        for (const S of B.seas) {
            let low = -1, held = 0;
            for (const c of B.lakes[S.id].cells) {
                if (low < 0 || zz[c] < zz[low]) low = c;
                // (water: the whole hollow when it fills to its sill; else each of its lakes at its own level — finish-basins.js
                // hollowLakes: a sub-basin behind a sill stands at its own balance)
                const lv = S.full ? S.levelKm : B.water[c];
                if (S.full ? zz[c] < lv : lv === lv) { cut[c] = 1; level[c] = lv; held += Math.max(0, lv - zz[c]) * cellKm2; }
                else if (zz[c] < 0) cut[c] = 2;
            }
            seas.push({ km2: S.km2, floorKm: S.floorKm, sillKm: S.sillKm, levelKm: S.levelKm, full: S.full, wet: S.wet, low, heldKm3: held });
        }
    }
    dryBase(mesh, zz, cut, level, base);
    // (a cut-off body under basinMinKm2 — too small for the finish to balance — stays as world-ocean.js marks it: water to
    // the frame's sea level, held apart from the ocean like any other)
    for (let c = 0; c < n; c++) if (water.cut[c] && !cut[c]) { cut[c] = 1; level[c] = 0; }
    let heldKm3 = 0;
    for (let c = 0; c < n; c++) if (cut[c] === 1) heldKm3 += Math.max(0, level[c] - zz[c]) * cellKm2;
    if (!(heldKm3 > 0) && !seas.length) return Object.assign(water, { cut, dry, paintKm: null, seas, heldKm3: 0, oceanFallKm: 0 });
    const oceanFallKm = oceanFall(water.ocean, zz, heldKm3, cellKm2);
    const paintKm = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        if (cut[c] === 1) paintKm[c] = seaLevelKm + Math.min(-0.001, zz[c] - level[c]);
        else if (cut[c] === 2) { dry[c] = 1; paintKm[c] = seaLevelKm - 0.001 - Math.max(0, zz[c] - base[c]); }
        else paintKm[c] = z[c] + oceanFallKm;
    }
    return Object.assign(water, { cut, dry, paintKm, seas, heldKm3, oceanFallKm });
}

/**
 * Each dried cell's base (km): the level of the brine lake it drains down to, or the bottom of the dry hollow it drains
 * to — so its colour runs salt → playa → walls up from its own sub-basin's floor, and a lake's shore meets its lake. Cells
 * lowest first, each from its lowest lower neighbour (steepest descent, in one pass).
 */
function dryBase(mesh, zz, cut, level, base) {
    const cells = [];
    for (let c = 0; c < zz.length; c++) if (cut[c] === 2) cells.push(c);
    cells.sort((a, b) => zz[a] - zz[b]);
    for (const c of cells) {
        let lo = -1;
        for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) { const b = mesh.adjList[k]; if (zz[b] < zz[c] && (lo < 0 || zz[b] < zz[lo])) lo = b; }
        base[c] = lo < 0 ? zz[c] : cut[lo] === 1 ? level[lo] : cut[lo] === 2 ? base[lo] : zz[c];
    }
}

/**
 * How far (km) the world ocean falls to give up `heldKm3`: the held water over the ocean's area at its lowered level (its
 * cells deeper than the fall; once round, the fall is metres to tens of metres against shelves hundreds of km wide).
 */
export function oceanFall(ocean, zz, heldKm3, cellKm2) {
    if (!(heldKm3 > 0) || !ocean) return 0;
    let d = 0;
    for (let round = 0; round < 2; round++) {
        let a = 0;
        for (let c = 0; c < zz.length; c++) if (ocean[c] && zz[c] < -d) a += cellKm2;
        d = a > 0 ? heldKm3 / a : 0;
    }
    return d;
}

/**
 * A frame's hillshade with its water (worldOcean at opts.seaLevelKm, then estimateCutOff) as shade.water — balanced first,
 * so a dried cut-off sea is shaded as land is (terrain-shade.js hillshade's `dry`). The shading worker's job, and the
 * pages' where there is none.
 */
export function shadeWithWater(mesh, heightKm, opts = {}, cfg) {
    const sea = opts.seaLevelKm ?? 0, water = estimateCutOff(mesh, heightKm, worldOcean(mesh, heightKm, sea), cfg, sea);
    const shade = hillshade(mesh, heightKm, { ...opts, dry: water.dry });
    shade.water = water;
    return shade;
}

const oceanOf = (water, n) => { const o = new Uint8Array(n); for (let c = 0; c < n; c++) if (water.ocean?.[c]) o[c] = 1; return o; };
