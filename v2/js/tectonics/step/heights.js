// Heights as evolving state (Phase 8; developer: "bake in some of that history over time"). Every crust cell carries its
// own height story, riding on its plate like every other record — and since branch unified (2026-10-28) one physical
// height: a continental cell stands by isostasy on its crust and lithosphere (tectonics/measure.js columnModel), not at
// a height set for its kind:
//   · rootKm — its crust's thickness against its kind's as formed (riftCrustKm, cratonCrustKm): it grows exactly as
//     belts thicken the crust, and the rock erosion takes off thins it (< 0: thinner than formed); the column stands on it;
//   · upliftKm — the broad relief belts build on that: while a belt is active it rises toward the belt's cross-section
//     (terrain/profiles.js broadProfile) as its front absorbs convergence, never lowered by a newer belt — only erosion
//     lowers it — so orogenies accumulate; foreland basins sink below 0 and fill back in; it spreads a little sideways
//     over time (hillslope smoothing). Crust too, counted in the height it lifts (measure.js crustThicknessKm);
//   · rugged / prevRugged — how big the crests and ridges of the current belt and of the one it overprinted stand;
//   · volcWornKm — how far a hotspot volcano, or a flood basalt on land, has been worn down since it erupted;
//   · baseKm — the start world's own swells (seedBaseRelief): broad uplands and the lowlands between them, worn down
//     like the rest — so the first continents are not flat, and their rivers have somewhere to run from.
// Erosion takes the whole height down, every step, at the latitude the cell is at THEN (plates move: a range that
// drifted out of the tropics keeps the wear it took there), faster where it rains more (terrain-config.js
// erosionAtLatitude), and faster the higher the land stands — hardly at all on low ground (erosionAtHeight), so old
// ranges linger as low hills and shields sink toward the sea only over Gyr. The rock it takes thins the crust and the
// ground rebounds (~5/6 of it). Records only, but for the rivers, which run over these heights (step/rivers.js). Constants
// live with the terrain's (terrain-config.js); a world may carry its own in world.config.heights.

import { CrustType, CrustFlag, OrogenyType, VolcanicType } from '../model/crust.js';
import { ISLAND_EROSION_KM_PER_MYR, columnModel, arcSurfaceKm, ARC_ROOT_SHARE } from '../measure.js';
import { arcCrustKm } from './collision.js';
import { TERRAIN, erosionAtLatitude, erosionAtHeight } from '../../terrain/terrain-config.js';
import { broadProfile } from '../../terrain/profiles.js';
import { FastNoise } from '../../core/fast-noise.js';

const R = 6371;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The height constants a world runs with. */
export const heightsOf = config => config.heights ?? TERRAIN;

/** A belt's target relief (km) at full activity: its kind's crest height, lower while the belt is young (narrow). */
export function beltReliefKm(type, reachKm, H) {
    return H.reliefKm[type] * (H.youngShare + (1 - H.youngShare) * Math.min(1, reachKm / H.fullReachKm[type]));
}

/**
 * A belt shaped cell `c` this step (step/orogeny.js spreadBelt): thicken its root as its crust thickened, and raise its
 * uplift and ruggedness toward the belt's targets — the whole belt at the pace of the convergence its front absorbed
 * this step (`workKm`): a fast front builds its range fast.
 */
export function buildHeights(crust, c, type, side, u, reachKm, workKm, thickenedKm, config, amp = 1) {
    const H = heightsOf(config);
    crust.rootKm[c] += thickenedKm * (H.rootGain?.[type] ?? 1);
    // (amp: a craton's rim takes a thin-skinned belt, cratonStrainShare of the relief — orogeny.js)
    const A = amp * beltReliefKm(type, reachKm, H), share = 1 - Math.exp(-workKm / H.upliftBuildKm[type]);
    // (on island-arc crust a subduction belt's broad uplift is mostly the arc's own growth, which its maturity already
    // gives it — records.js platformKm, as for its root: only arcUpliftShare of it, or a Mariana would stand at sea level)
    const own = crust.type[c] === CrustType.ARC && (type === OrogenyType.ANDEAN || type === OrogenyType.ARC) ? H.arcUpliftShare : 1;
    const target = own * A * broadProfile(type, side, u * reachKm, reachKm);
    // rise toward a positive target (a newer, lower belt never lowers what an older one left) — or sink toward a
    // negative one: a foreland basin subsides under the load in front of a range, whatever stood there before
    if (target >= 0 ? target > crust.upliftKm[c] : target < crust.upliftKm[c]) crust.upliftKm[c] += (target - crust.upliftKm[c]) * share;
    if (A > crust.rugged[c]) crust.rugged[c] += (A - crust.rugged[c]) * share;
}

/**
 * The start world's swells (developer, 8b round 5: "start the baseline with some large noise … that can erode over time
 * and direct rivers more consistently"): on every continent, broad uplands up to baseReliefKm high and the lowlands
 * between them, from a noise field of their own (their own seed: no other stream is touched) read where the crust is at
 * the start — so it runs on across plate boundaries. Once, when the history starts; crust made later starts flat.
 */
export function seedBaseRelief(world) {
    const H = heightsOf(world.config), { xyz } = world.mesh;
    if (!(H.baseReliefKm > 0)) return;
    const noise = new FastNoise((world.seed ^ 0xba5e) >>> 0), F = R / H.baseReliefScaleKm;
    for (const plate of world.plates) {
        if (!plate.alive) continue;
        const { mask, type, baseKm } = plate.crust, m = plate.mat;
        for (let c = 0; c < mask.length; c++) {
            if (!mask[c] || type[c] === CrustType.OCEAN || type[c] === CrustType.ARC) continue;
            const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2];
            const wx = m[0] * x + m[1] * y + m[2] * z, wy = m[3] * x + m[4] * y + m[5] * z, wz = m[6] * x + m[7] * y + m[8] * z;
            // (fbm ≈ ±0.65: a quarter of the land stays low, half rises past ~0.4 of the full height, a tenth near all of it)
            baseKm[c] = H.baseReliefKm * (type[c] === CrustType.CRATON ? H.baseReliefCraton : 1) * smooth(-0.1, 0.8, 1.6 * noise.fbm(wx * F + 2.1, wy * F + 7.7, wz * F + 4.9, 3, 0.5));
        }
    }
}

/** Erosion and hillslope smoothing, once per step over every plate. @returns {number} 0 (it never changes crust) */
export function evolveHeights(world, dt) {
    if (dt <= 0) return 0;
    const { mesh, plates, time, config } = world, H = heightsOf(config);
    const { adjOffset, adjList, xyz, edgeKm } = mesh;
    const rate = rateTable(H), C = columnModel(H);
    const spread = H.diffusionKm2PerMyr * dt * (2 / 3) / (edgeKm * edgeKm);      // hexagonal-lattice Laplacian, per step
    let flux = scratch.flux;
    if (!flux || flux.length !== mesh.numCells) flux = scratch.flux = new Float32Array(mesh.numCells), scratch.rootFlux = new Float32Array(mesh.numCells);
    for (const plate of plates) {
        if (!plate.alive || plate.crust.count === 0) continue;
        const crust = plate.crust, { mask, type, flags, oroType, volcType, volcKm, volcAt, rootKm, upliftKm, baseKm, rugged, prevRugged, volcWornKm, riverIncKm } = crust;
        const m = plate.mat, n = mask.length;
        // the column a cell stands on (km above the sea, the mantle's swell aside: tectonics/measure.js): a continent's
        // and a craton's from their crust; an island arc's thickening only — its own crust stands by arcSurfaceKm, which
        // wears its own way (an arc's recorded thickening is mostly its own growth: a quarter of it counts)
        const colOf = c => (type[c] === CrustType.ARC ? C.slope[1] * ARC_ROOT_SHARE * Math.max(0, rootKm[c]) : C.ref[type[c]] + C.slope[type[c]] * rootKm[c]);
        // hillslope smoothing of the uplift, within the plate's land — never into the sea, nor onto a craton's core (a
        // shield is rigid and cold: a neighbouring range does not spread onto it), only onto its rim, where a belt rides
        const spreads = c => mask[c] && type[c] !== CrustType.OCEAN && (type[c] !== CrustType.CRATON || oroType[c] !== 0);
        // Gravitational collapse: crust raised past collapseKm can no longer hold itself up — its hot, thick lower crust
        // flows out from under it (Clark & Royden 2000) and the high ground extends (Dewey 1988), so plateaus stop rising
        // at ~4–5 km and widen instead (Tibet, the Altiplano; Molnar & Lyon-Caen 1988). Where a cell stands that high, its
        // uplift and its thickened crust spread to its neighbours at collapseKm2PerMyr — crust moved, not lost: a plateau
        // levels off and grows outward (sub-stepped where a step is too long for that rate on this mesh)
        const collapse = H.collapseKm2PerMyr > 0, kc = collapse ? H.collapseKm2PerMyr * dt * (2 / 3) / (edgeKm * edgeKm) : 0;
        if (collapse) {
            let hi = scratch.hi;
            if (!hi || hi.length !== n) hi = scratch.hi = new Float32Array(n);
            const sub = Math.max(1, Math.ceil(kc / 0.12)), kSub = kc / sub;
            for (let it = 0; it < sub; it++) {
                let any = false;
                for (let c = 0; c < n; c++) {
                    hi[c] = 0;
                    if (!spreads(c)) continue;
                    const h = Math.max(0, upliftKm[c]) + baseKm[c] + colOf(c);
                    if (h > H.collapseKm - 0.25) { hi[c] = Math.min(1, (h - H.collapseKm + 0.25) / 0.5); any = true; }
                }
                if (!any) break;
                for (let c = 0; c < n; c++) {
                    flux[c] = 0; scratch.rootFlux[c] = 0;
                    if (!spreads(c)) continue;
                    let du = 0, dr = 0;
                    for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                        const nb = adjList[k];
                        if (!spreads(nb)) continue;
                        const f = kSub * Math.max(hi[c], hi[nb]);
                        if (f > 0) { du += f * (upliftKm[nb] - upliftKm[c]); dr += f * (Math.max(0, rootKm[nb]) - Math.max(0, rootKm[c])); }
                    }
                    flux[c] = du; scratch.rootFlux[c] = dr;
                }
                // (only the thickening spreads: crust thinner than formed has no hot root to flow)
                for (let c = 0; c < n; c++) if (flux[c] || scratch.rootFlux[c]) { upliftKm[c] += flux[c]; rootKm[c] += scratch.rootFlux[c]; }
            }
        }
        for (let c = 0; c < n; c++) {
            flux[c] = 0;
            if (!spreads(c)) continue;
            let lap = 0;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (spreads(nb)) lap += upliftKm[nb] - upliftKm[c]; }
            flux[c] = spread * lap;
        }
        for (let c = 0; c < n; c++) {
            if (!mask[c]) continue;
            // the cell's latitude now: the z row of the plate's rotation
            const z = m[6] * xyz[3 * c] + m[7] * xyz[3 * c + 1] + m[8] * xyz[3 * c + 2];
            const bin = Math.min(TABLE - 1, Math.max(0, Math.floor((z + 1) * 0.5 * TABLE)));
            if (volcType[c] === VolcanicType.TRACK && volcKm[c] > 0) volcWornKm[c] = time - volcAt[c] <= dt + 1e-9 ? 0 : volcWornKm[c] + ISLAND_EROSION_KM_PER_MYR * dt * rate[bin];
            if (type[c] === CrustType.OCEAN) continue;
            // a flood basalt on land wears too — slowly (a hard cap), from its eruption on (terrain/lips.js cuts it up by it)
            if (volcType[c] === VolcanicType.LIP) volcWornKm[c] = time - volcAt[c] <= dt + 1e-9 ? 0 : volcWornKm[c] + H.lipWearKmPerMyr * dt * rate[bin];
            // The whole height wears (branch unified, 2026-10-28): how fast, by the latitude's rain (or ice) × how high the
            // land stands above the sea — its column, its belts' relief, its swells (and an arc's own crest). Each part
            // comes down by the same share: the relief and the swells as they stand, the column by thinning its crust —
            // the rock worn off is that share of the column ÷ its slope, ~6 times what the ground loses (Airy rebound,
            // Molnar & England 1990): an old range wears down and its root rebounds; a shield thins and sinks toward the
            // sea, slowly (erosionAtHeight: low ground hardly wears). A basin (below 0) fills back at the reference rate; a
            // rift's shoulders are an escarpment that retreats at its own pace, whatever its height.
            const rift = oroType[c] === OrogenyType.RIFT, up = upliftKm[c] + flux[c], arc = type[c] === CrustType.ARC;
            const col = colOf(c);
            let height = Math.max(0, up) + baseKm[c] + Math.max(0, col);
            if (arc && !(flags[c] & CrustFlag.MARGIN_ISLE)) height += Math.max(0, arcSurfaceKm(arcCrustKm(crust, c, time, config), crust.arcKm[c] > 0 ? time - crust.arcAt[c] : 0));
            // (a shield's crystalline basement wears slower than the cover and the young rock of a range, by the carving's
            // own hardness of it: terrain-config.js carveCratonHardness — bedrock erodibility spans orders of magnitude by
            // lithology, crystalline the least: Stock & Montgomery 1999; cratons 1–10 m/Myr, Bierman & Caffee 2001)
            const hard = type[c] === CrustType.CRATON ? 1 - (H.carveCratonHardness ?? 0) : 1;
            const e = rate[bin] * dt * hard * erosionAtHeight(height, H), keep = wear(e / H.reliefTauMyr);
            upliftKm[c] = up * (up < 0 ? wear(rate[bin] * dt / H.reliefTauMyr) : rift ? wear(e / H.riftReliefTauMyr) : keep);     // (a basin fills back toward 0 as a range wears down to it)
            if (col > 0) rootKm[c] -= col * (1 - keep) / (arc ? C.slope[1] * ARC_ROOT_SHARE : C.slope[type[c]]);
            rugged[c] *= wear(e / (rift ? H.riftReliefTauMyr : H.ruggedTauMyr));
            prevRugged[c] *= wear(e / H.ruggedTauMyr);
            riverIncKm[c] *= wear(e / H.ruggedTauMyr);              // (a gorge's walls wear back like the belt's crests)
            if (baseKm[c] > 0) baseKm[c] *= keep;
        }
    }
    return 0;
}


/**
 * The crust (rootKm: km against an ordinary continent's as formed) an island arc's cell carries when it turns continental
 * (step/arc-maturation.js, step/margin-isles.js): the arc's own crust and its share of what belts thickened it by,
 * reworked to at least an ordinary continent's thickness — those steps' premise: a welded arc is thickened and intruded
 * into continental crust (the North American Cordillera, the Central Asian Orogenic Belt).
 */
export function arcToContinentRootKm(crust, c, time, config) {
    return Math.max(0, arcCrustKm(crust, c, time, config) + ARC_ROOT_SHARE * Math.max(0, crust.rootKm[c]) - heightsOf(config).riftCrustKm);
}

// The erosion rate by latitude is a function of z = sin(latitude), tabulated.
const TABLE = 1024;
const scratch = { flux: null, rootFlux: null, hi: null, tables: null };
/** e^−x for the small x of one step (exact enough, and far cheaper than exp per cell per step). */
const wear = x => (x < 0.05 ? 1 - x * (1 - x * (0.5 - x / 6)) : Math.exp(-x));

function rateTable(H) {
    let t = scratch.tables;
    if (!t || t.H !== H) {
        const rate = new Float64Array(TABLE);
        for (let i = 0; i < TABLE; i++) rate[i] = erosionAtLatitude(Math.asin(Math.min(1, Math.max(-1, (i + 0.5) / TABLE * 2 - 1))) * 180 / Math.PI, H);
        t = scratch.tables = { H, rate };
    }
    return t.rate;
}
