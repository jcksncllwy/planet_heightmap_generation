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
import { pourOcean } from '../tectonics/ocean/inventory.js';
import { hillshade } from '../view/terrain-shade.js';

const R = 6371, D2R = Math.PI / 180;

/**
 * The area (km²) from which a cut-off sea is balanced on the computed climate, not the zonal one (the real-climate
 * balance, 2026-11-10: the page computes the frame's climate for it — climate-water.js — and the shading worker balances
 * again). The cutoff lane's threshold study (2026-11-10: the zonal estimate against the computed climate's balance over
 * three seeds' histories) found no wet/dry disagreement on seas of ≥ 0.1 Mkm², and 24 % disagreeing among smaller ones,
 * which hold little water; what the zonal table gets wrong on a big sea is how much it holds — and a sea of ≥ 1 Mkm²
 * (a Caspian is 0.37) holds 10⁴–10⁶ km³, a fall of the world ocean by metres, and makes its own rain, which no table by
 * latitude knows. Under it the zonal estimate stands; the climate costs 1.5–1.8 s a frame (climate-worker.js), so the
 * line is also what keeps the average under half a second a frame.
 */
export const CLIMATE_MIN_KM2 = 1e6;

/** Whether a frame's water (worldOcean's, or estimateCutOff's) has a sea the computed climate should balance: a body cut
 *  off from the world ocean of ≥ CLIMATE_MIN_KM2 the history pours nothing into (one it pours into stands the history's
 *  water, whatever the climate: standPoured). */
export function needsClimate(water, numCells) {
    const cellKm2 = 4 * Math.PI * R * R / numCells;
    return (water?.bodies ?? []).slice(1).some(b => !(b.pouredKm3 > 0) && b.cells * cellKm2 >= CLIMATE_MIN_KM2);
}

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
 *  · given: 1 on the wet cells of a sea the history part-fills (water.bodies[].pouredKm3, world-ocean.js: it pours water
 *    onto the body short of filling it — a basin filling over the sill the ocean's level holds at), 2 on its dry floor —
 *    that water stood from the bottom (pourOcean on its cells alone), not balanced: the history's, not the climate's;
 *  · givenKm3: that water (in the history's books already: not debited);
 *  · heldKm3: the water standing apart from the world ocean by the estimate (every cut-off body but those, balanced or not);
 *  · oceanFallKm: how far the world ocean falls to hold that water back (heldKm3 over its area) — the history pours its
 *    whole inventory into the ocean-connected ground (tectonics/ocean/inventory.js pourOcean) and holds every hollow
 *    behind a sill empty, so water a view stands in a cut-off sea is the ocean's: it is debited here, and the books close;
 *  · seas: per sea {km2, floorKm, sillKm, levelKm, full, wet, low (its lowest cell), heldKm3} (the history's: history,
 *    givenKm3, no sill);
 *  · climate: 'zonal', or 'computed' when `climate` was given; climateDeg: its grid (°), when it says.
 * `climate` (optional): the frame's computed water per cell, mm/yr — {rain, pet, runoff} (the climate the model computes,
 * as the finish assembles it); without it, the zonal climate (zonalWater).
 * The heights themselves are not changed: a dry sea is drawn at its true floor (hillshade by `dry`, as land).
 */
export function estimateCutOff(mesh, z, water, cfg, seaLevelKm = 0, F = FINISH, climate = null) {
    const n = mesh.numCells, cellKm2 = 4 * Math.PI * R * R / n, cut = new Uint8Array(n), dry = new Uint8Array(n), given = new Uint8Array(n), seas = [];
    const zz = new Float32Array(n);
    for (let c = 0; c < n; c++) zz[c] = z[c] - seaLevelKm;
    const level = new Float32Array(n).fill(NaN), base = new Float32Array(n).fill(NaN);   // (a wet cell's water level; a dry one's floor)
    // (a body the history pours water into, short of filling it — world-ocean.js: a basin part-filled over the sill the
    // ocean's level holds at — stands that water, filled from its bottom; it is the history's, so neither balanced nor
    // debited from the ocean)
    const poured = (water.bodies ?? []).slice(1).filter(b => b.pouredKm3 > 0);
    let givenKm3 = 0;
    for (const b of poured) givenKm3 += standPoured(mesh, zz, water.cut, b, cut, level, given, seas, cellKm2);
    // (nothing to balance unless a cut-off body the history pours nothing into is as large as the finish balances:
    // finish-config.js basinMinKm2)
    const any = (water.bodies ?? []).slice(1).some(b => !(b.pouredKm3 > 0) && b.cells * cellKm2 >= F.basinMinKm2);
    if (any) {
        // (the balance reads the history's part-filled seas as the ocean: their catchments drain to the history's water)
        let ocean = water.ocean ?? null;
        if (ocean && poured.length) { ocean = ocean.slice(); for (let c = 0; c < n; c++) if (given[c]) ocean[c] = 1; }   // (wet and dry)
        const { rain, pet, runoff } = climate ?? zonalWater(mesh, zz, cfg, F, ocean);
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
    for (let c = 0; c < n; c++) if (cut[c] === 1 && !given[c]) heldKm3 += Math.max(0, level[c] - zz[c]) * cellKm2;
    const source = climate ? 'computed' : 'zonal', climateDeg = climate?.gridDeg ?? null;
    if (!(heldKm3 > 0) && !seas.length) return Object.assign(water, { cut, dry, given, paintKm: null, seas, heldKm3: 0, givenKm3, oceanFallKm: 0, climate: source, climateDeg });
    const oceanFallKm = oceanFall(water.ocean, zz, heldKm3, cellKm2);
    const paintKm = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        if (cut[c] === 1) paintKm[c] = seaLevelKm + Math.min(-0.001, zz[c] - level[c]);
        else if (cut[c] === 2) { dry[c] = 1; paintKm[c] = seaLevelKm - 0.001 - Math.max(0, zz[c] - base[c]); }
        else paintKm[c] = z[c] + oceanFallKm;
    }
    return Object.assign(water, { cut, dry, given, paintKm, seas, heldKm3, givenKm3, oceanFallKm, climate: source, climateDeg });
}

/**
 * Stand the water the history pours onto a body (b.pouredKm3) in it, from its bottom up: pourOcean on the body's cells
 * alone (the same pour the history makes, every other cell walled off) — its level, and the cells under it wet (cut 1,
 * given 1); the rest of its floor dry (cut 2, given 2: the history's, not the climate's). Adds the sea to `seas` (history: true). @returns the water stood (km³)
 */
function standPoured(mesh, zz, cutOff, b, cut, level, given, seas, cellKm2) {
    const n = mesh.numCells, walled = new Float32Array(n).fill(Infinity), cells = [b.first];
    walled[b.first] = zz[b.first];
    for (let i = 0; i < cells.length; i++) for (let k = mesh.adjOffset[cells[i]]; k < mesh.adjOffset[cells[i] + 1]; k++) {
        const nb = mesh.adjList[k];
        if (cutOff[nb] && walled[nb] === Infinity) { walled[nb] = zz[nb]; cells.push(nb); }
    }
    let room = 0;
    for (const c of cells) room += -zz[c] * cellKm2;
    const P = pourOcean(mesh, walled, Math.min(b.pouredKm3, room));
    const lv = Math.min(0, P.levelKm);
    let low = b.first, held = 0, wet = 0;
    for (const c of cells) {
        if (zz[c] < zz[low]) low = c;
        if (P.sea[c] && zz[c] < lv) { cut[c] = 1; level[c] = lv; given[c] = 1; held += (lv - zz[c]) * cellKm2; wet++; }
        else { cut[c] = 2; given[c] = 2; }
    }
    seas.push({ km2: cells.length * cellKm2, floorKm: zz[low], sillKm: NaN, levelKm: lv, full: wet === cells.length, wet: wet > 0, low, heldKm3: 0, givenKm3: held, history: true });
    return held;
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
 * How far (km) the world ocean falls to give up `heldKm3`: the level d at which the ocean's water above −d is exactly the
 * held water — Σ over its cells of the slice between −d and its frame's level — solved by Newton's method (the slice
 * grows by the area still under water; a few rounds, to under a km³: the fall is metres to tens of metres).
 */
export function oceanFall(ocean, zz, heldKm3, cellKm2) {
    if (!(heldKm3 > 0) || !ocean) return 0;
    let d = 0;
    for (let round = 0; round < 8; round++) {
        let given = 0, area = 0;                                     // (water above −d, and the area under it)
        for (let c = 0; c < zz.length; c++) if (ocean[c] && zz[c] < 0) { given += Math.min(d, -zz[c]) * cellKm2; if (zz[c] < -d) area += cellKm2; }
        if (!(area > 0)) break;
        const step = (heldKm3 - given) / area;
        d += step;
        if (Math.abs(step * area) < 1e-3 * heldKm3 * 1e-3) break;
    }
    return d;
}

/**
 * A frame's hillshade with its water (worldOcean at opts.seaLevelKm — with opts.history, the history's poured sea: world-ocean.js — then estimateCutOff,
 * on opts.climate where the page has computed it: climate-water.js) as shade.water — balanced first,
 * so a dried cut-off sea is shaded as land is (terrain-shade.js hillshade's `dry`). The shading worker's job, and the
 * pages' where there is none.
 */
export function shadeWithWater(mesh, heightKm, opts = {}, cfg) {
    const { history = null, climate = null, ...shading } = opts, sea = shading.seaLevelKm ?? 0;
    const water = estimateCutOff(mesh, heightKm, worldOcean(mesh, heightKm, sea, history), cfg, sea, FINISH, climate);
    const shade = hillshade(mesh, heightKm, { ...shading, dry: water.dry });
    shade.water = water;
    return shade;
}

const oceanOf = (water, n) => { const o = new Uint8Array(n); for (let c = 0; c < n; c++) if (water.ocean?.[c]) o[c] = 1; return o; };
