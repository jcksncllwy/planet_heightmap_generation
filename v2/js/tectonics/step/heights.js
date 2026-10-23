// Heights as evolving state (Phase 8; developer: "bake in some of that history over time"). Every crust cell carries its
// own height story, riding on its plate like every other record:
//   · rootKm — the thickened crust that can still wear away: it grows exactly as belts thicken the crust, and erodes
//     (isostatic rebound) every step; heights come from it by Airy isostasy;
//   · upliftKm — the broad relief belts build above that: while a belt is active it rises toward the belt's
//     cross-section (terrain/profiles.js broadProfile) as its front absorbs convergence, never lowered by a newer belt —
//     only erosion lowers it — so orogenies accumulate; foreland basins sink below 0 and fill back in; it spreads a
//     little sideways over time (hillslope smoothing);
//   · rugged / prevRugged — how big the crests and ridges of the current belt and of the one it overprinted stand;
//   · volcWornKm — how far a hotspot volcano, or a flood basalt on land, has been worn down since it erupted;
//   · baseKm — the start world's own swells (seedBaseRelief): broad uplands and the lowlands between them, worn down
//     like the uplift — so the first continents are not flat, and their rivers have somewhere to run from.
// Erosion runs every step at the latitude the cell is at THEN (plates move: a range that drifted out of the tropics
// keeps the wear it took there), faster where it rains more (terrain-config.js erosionAtLatitude), and faster the
// higher the belt stands — slowly on low ground (erosionAtHeight), so old ranges linger as low hills.
// Records only: the history never reads them (heights and history are decoupled — developer). Constants live with the
// terrain's (terrain-config.js); a world may carry its own in world.config.heights.

import { CrustType, OrogenyType, VolcanicType } from '../model/crust.js';
import { ISLAND_EROSION_KM_PER_MYR } from '../measure.js';
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
    const { mesh, plates, time } = world, H = heightsOf(world.config);
    const { adjOffset, adjList, xyz, edgeKm } = mesh;
    const rate = rateTable(H), lift = isoLiftTable(H);
    const spread = H.diffusionKm2PerMyr * dt * (2 / 3) / (edgeKm * edgeKm);      // hexagonal-lattice Laplacian, per step
    let flux = scratch.flux;
    if (!flux || flux.length !== mesh.numCells) flux = scratch.flux = new Float32Array(mesh.numCells), scratch.rootFlux = new Float32Array(mesh.numCells);
    for (const plate of plates) {
        if (!plate.alive || plate.crust.count === 0) continue;
        const { mask, type, oroType, volcType, volcKm, volcAt, rootKm, upliftKm, baseKm, rugged, prevRugged, volcWornKm, riverIncKm } = plate.crust;
        const m = plate.mat, n = mask.length;
        // hillslope smoothing of the uplift, within the plate's land — never into the sea, nor onto a craton's core (a
        // shield is rigid and cold: a neighbouring range does not spread onto it), only onto its rim, where a belt rides
        const spreads = c => mask[c] && type[c] !== CrustType.OCEAN && (type[c] !== CrustType.CRATON || oroType[c] !== 0);
        // Gravitational collapse: crust raised past collapseKm can no longer hold itself up — its hot, thick lower crust
        // flows out from under it (Clark & Royden 2000) and the high ground extends (Dewey 1988), so plateaus stop rising
        // at ~4–5 km and widen instead (Tibet, the Altiplano; Molnar & Lyon-Caen 1988). Where a cell stands that high, its
        // uplift and its thickened root spread to its neighbours at collapseKm2PerMyr — crust moved, not lost: a plateau
        // levels off and grows outward (sub-stepped where a step is too long for that rate on this mesh)
        const collapse = H.collapseKm2PerMyr > 0, kc = collapse ? H.collapseKm2PerMyr * dt * (2 / 3) / (edgeKm * edgeKm) : 0;
        if (collapse) {
            let hi = scratch.hi;
            if (!hi || hi.length !== n) hi = scratch.hi = new Float32Array(n);
            const sub = Math.max(1, Math.ceil(kc / 0.12)), kSub = kc / sub, isoOf = c => lift[Math.min(LIFT_TABLE - 1, Math.round(rootKm[c] * (type[c] === CrustType.ARC ? 0.25 : 1) * LIFT_PER_KM))];
            for (let it = 0; it < sub; it++) {
                let any = false;
                for (let c = 0; c < n; c++) {
                    hi[c] = 0;
                    if (!spreads(c)) continue;
                    const h = Math.max(0, upliftKm[c]) + baseKm[c] + isoOf(c);
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
                        if (f > 0) { du += f * (upliftKm[nb] - upliftKm[c]); dr += f * (rootKm[nb] - rootKm[c]); }
                    }
                    flux[c] = du; scratch.rootFlux[c] = dr;
                }
                for (let c = 0; c < n; c++) if (flux[c] || scratch.rootFlux[c]) { upliftKm[c] += flux[c]; rootKm[c] = Math.max(0, rootKm[c] + scratch.rootFlux[c]); }
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
            const rift = oroType[c] === OrogenyType.RIFT, up = upliftKm[c] + flux[c];
            // how fast here: the latitude's rain (or ice), × how high the belt stands above its plain — the evolved uplift
            // plus its root's isostatic lift. A basin (below 0) fills back at the reference rate; a rift's shoulders are
            // an escarpment that retreats at its own pace, whatever its height.
            const height = Math.max(0, up) + baseKm[c] + lift[Math.min(LIFT_TABLE - 1, Math.round(rootKm[c] * (type[c] === CrustType.ARC ? 0.25 : 1) * LIFT_PER_KM))];
            const e = rate[bin] * dt * (rift || up < 0 ? 1 : erosionAtHeight(height, H));
            upliftKm[c] = up * wear(e / (rift ? H.riftReliefTauMyr : H.reliefTauMyr));     // (a basin fills back toward 0 as a range wears down to it)
            rootKm[c] *= wear(e / H.thickTauMyr);
            rugged[c] *= wear(e / (rift ? H.riftReliefTauMyr : H.ruggedTauMyr));
            prevRugged[c] *= wear(e / H.ruggedTauMyr);
            riverIncKm[c] *= wear(e / H.ruggedTauMyr);              // (a gorge's walls wear back like the belt's crests)
            if (baseKm[c] > 0) baseKm[c] *= wear(e / H.baseReliefTauMyr);
        }
    }
    return 0;
}

// The erosion rate by latitude is a function of z = sin(latitude), tabulated; the root's isostatic lift too.
const TABLE = 1024, LIFT_TABLE = 1024, LIFT_PER_KM = 4;
const scratch = { flux: null, rootFlux: null, hi: null, tables: null, lift: null };
/** e^−x for the small x of one step (exact enough, and far cheaper than exp per cell per step). */
const wear = x => (x < 0.05 ? 1 - x * (1 - x * (0.5 - x / 6)) : Math.exp(-x));

function isoLiftTable(H) {
    let t = scratch.lift;
    if (!t || t.H !== H) {
        const v = new Float64Array(LIFT_TABLE);
        for (let i = 0; i < LIFT_TABLE; i++) v[i] = H.isoMaxKm * (1 - Math.exp(-(i / LIFT_PER_KM) / H.isoScaleKm));
        t = scratch.lift = { H, v };
    }
    return t.v;
}

function rateTable(H) {
    let t = scratch.tables;
    if (!t || t.H !== H) {
        const rate = new Float64Array(TABLE);
        for (let i = 0; i < TABLE; i++) rate[i] = erosionAtLatitude(Math.asin(Math.min(1, Math.max(-1, (i + 0.5) / TABLE * 2 - 1))) * 180 / Math.PI, H);
        t = scratch.tables = { H, rate };
    }
    return t.rate;
}
