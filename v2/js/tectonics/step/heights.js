// Heights as evolving state (Phase 8; developer: "bake in some of that history over time"). Every crust cell carries its
// own height story, riding on its plate like every other record:
//   · rootKm — the thickened crust that can still wear away: it grows exactly as belts thicken the crust, and erodes
//     (isostatic rebound) every step; heights come from it by Airy isostasy;
//   · upliftKm — the broad relief belts build above that: while a belt is active it rises toward the belt's
//     cross-section (terrain/profiles.js broadProfile) as its front absorbs convergence, never lowered by a newer belt —
//     only erosion lowers it — so orogenies accumulate; foreland basins sink below 0 and fill back in; it spreads a
//     little sideways over time (hillslope smoothing);
//   · rugged / prevRugged — how big the crests and ridges of the current belt and of the one it overprinted stand;
//   · volcWornKm — how far a hotspot volcano has been worn down since it last erupted.
// Erosion runs every step at the latitude the cell is at THEN (plates move: a range that drifted out of the tropics
// keeps the wear it took there), faster where it rains more (terrain-config.js erosionAtLatitude), and faster the
// higher the belt stands — slowly on low ground (erosionAtHeight), so old ranges linger as low hills.
// Records only: the history never reads them (heights and history are decoupled — developer). Constants live with the
// terrain's (terrain-config.js); a world may carry its own in world.config.heights.

import { CrustType, OrogenyType, VolcanicType } from '../model/crust.js';
import { ISLAND_EROSION_KM_PER_MYR } from '../measure.js';
import { TERRAIN, erosionAtLatitude, erosionAtHeight } from '../../terrain/terrain-config.js';
import { broadProfile } from '../../terrain/profiles.js';

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
export function buildHeights(crust, c, type, side, u, reachKm, workKm, thickenedKm, config) {
    const H = heightsOf(config);
    crust.rootKm[c] += thickenedKm;
    const A = beltReliefKm(type, reachKm, H), share = 1 - Math.exp(-workKm / H.upliftBuildKm[type]);
    // (on island-arc crust a subduction belt's broad uplift is mostly the arc's own growth, which its maturity already
    // gives it — records.js platformKm, as for its root: only arcUpliftShare of it, or a Mariana would stand at sea level)
    const own = crust.type[c] === CrustType.ARC && (type === OrogenyType.ANDEAN || type === OrogenyType.ARC) ? H.arcUpliftShare : 1;
    const target = own * A * broadProfile(type, side, u * reachKm, reachKm);
    // rise toward a positive target (a newer, lower belt never lowers what an older one left) — or sink toward a
    // negative one: a foreland basin subsides under the load in front of a range, whatever stood there before
    if (target >= 0 ? target > crust.upliftKm[c] : target < crust.upliftKm[c]) crust.upliftKm[c] += (target - crust.upliftKm[c]) * share;
    if (A > crust.rugged[c]) crust.rugged[c] += (A - crust.rugged[c]) * share;
}

/** Erosion and hillslope smoothing, once per step over every plate. @returns {number} 0 (it never changes crust) */
export function evolveHeights(world, dt) {
    if (dt <= 0) return 0;
    const { mesh, plates, time } = world, H = heightsOf(world.config);
    const { adjOffset, adjList, xyz, edgeKm } = mesh;
    const rate = rateTable(H), lift = isoLiftTable(H);
    const spread = H.diffusionKm2PerMyr * dt * (2 / 3) / (edgeKm * edgeKm);      // hexagonal-lattice Laplacian, per step
    let flux = scratch.flux;
    if (!flux || flux.length !== mesh.numCells) flux = scratch.flux = new Float32Array(mesh.numCells);
    for (const plate of plates) {
        if (!plate.alive || plate.crust.count === 0) continue;
        const { mask, type, oroType, volcType, volcKm, volcAt, rootKm, upliftKm, rugged, prevRugged, volcWornKm } = plate.crust;
        const m = plate.mat, n = mask.length;
        // hillslope smoothing of the uplift, within the plate's land — never into the sea, nor onto a craton (a shield is
        // rigid and cold: a neighbouring range does not spread onto it)
        const spreads = c => mask[c] && type[c] !== CrustType.OCEAN && type[c] !== CrustType.CRATON;
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
            const rift = oroType[c] === OrogenyType.RIFT, up = upliftKm[c] + flux[c];
            // how fast here: the latitude's rain (or ice), × how high the belt stands above its plain — the evolved uplift
            // plus its root's isostatic lift. A basin (below 0) fills back at the reference rate; a rift's shoulders are
            // an escarpment that retreats at its own pace, whatever its height.
            const height = Math.max(0, up) + lift[Math.min(LIFT_TABLE - 1, Math.round(rootKm[c] * (type[c] === CrustType.ARC ? 0.25 : 1) * LIFT_PER_KM))];
            const e = rate[bin] * dt * (rift || up < 0 ? 1 : erosionAtHeight(height, H));
            upliftKm[c] = up * wear(e / (rift ? H.riftReliefTauMyr : H.reliefTauMyr));     // (a basin fills back toward 0 as a range wears down to it)
            rootKm[c] *= wear(e / H.thickTauMyr);
            rugged[c] *= wear(e / (rift ? H.riftReliefTauMyr : H.ruggedTauMyr));
            prevRugged[c] *= wear(e / H.ruggedTauMyr);
        }
    }
    return 0;
}

// The erosion rate by latitude is a function of z = sin(latitude), tabulated; the root's isostatic lift too.
const TABLE = 1024, LIFT_TABLE = 1024, LIFT_PER_KM = 4;
const scratch = { flux: null, tables: null, lift: null };
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
