// Fore-arc islands on continental margins. Above an Andean or Laramide trench, mountains do not only rise on the
// coast: the fore-arc between the coast and the trench is scraped up and pushed above the sea too — first as
// islands off the coast (Chiloé, Vancouver Island, the Channel Islands), which grow and in time merge with the
// mainland, until the land reaches almost to the trench. Each island is born at random along a mature, active
// trench, grows outward at a steady rate, and the coast itself creeps seaward more slowly (the accretionary
// wedge); an island that touches the mainland becomes part of it — continental crust, its own terrane.
// A strip of sea, marginIsleGapKm wide, is always left in front of the trench: the gap closes almost, never quite.
// Rates are per area and per km, not per cell: the same margin looks the same at every resolution.
//
// That is an ACCRETIONARY margin. Many of Earth's active margins are EROSIVE instead (Phase 7c): the trench
// scrapes the base of the fore-arc away and the coast retreats — the Andes have lost ~250 km of coast since the
// Jurassic. Which a stretch of margin is follows Clift & Vannucchi (2004): it accretes where convergence is slower
// than erosiveConvergenceCmYr and its trench holds at least accretionSedimentKm of sediment, and erodes otherwise. The
// sediment comes from the land within reach of the trench, as fast as that latitude erodes (rain, or ice), and from the
// incoming ocean floor, more the older it is: a trench off a continent in wet or icy latitudes fills (southern Chile,
// Alaska, Cascadia), one off a desert or out at sea starves (northern Chile, Tonga). An erosive margin raises no islands, and its coast
// — never a craton — turns to fore-arc sea at marginErosionKmPerMyr, until the coast lies marginErosionMaxGapKm from
// its trench. Trench cells carry CrustFlag.EROSIVE so frames can show which margins are which.

import { CrustType, CrustFlag } from '../model/crust.js';
import { BoundaryKind, EventKind } from '../model/world.js';
import { hopsFrom } from '../../core/mesh-bfs.js';
import { PLANET_RADIUS_KM } from '../../core/sim-mesh.js';
import { erosionAtLatitude } from '../../terrain/terrain-config.js';
import { heightsOf } from './heights.js';

/** @returns {number} cells raised or merged this step */
export function growMarginIsles(world, dt) {
    const { mesh, plates, config, time, boundaryKind, rngMarginIsle: rng } = world;
    const { adjOffset, adjList, xyz, index, edgeKm, cellAreaKm2, numCells } = mesh;
    if (dt <= 0 || (config.marginIsleRatePerMyr <= 0 && config.marginIsleGrowKmPerMyr <= 0 && config.marginErosionKmPerMyr <= 0)) return 0;
    const pErode = Math.min(1, config.marginErosionKmPerMyr * dt / edgeKm);
    const erodeHops = Math.max(1, Math.round(config.marginErosionMaxGapKm / edgeKm));
    const reachHops = Math.max(1, Math.round(config.marginIsleReachKm / edgeKm)), gapHops = Math.max(1, Math.round(config.marginIsleGapKm / edgeKm));
    const pBorn = config.marginIsleRatePerMyr * dt * cellAreaKm2 / (1000 * 0.5 * config.marginIsleReachKm);     // per km² of fore-arc: births per 1000 km of margin
    const pGrow = Math.min(1, config.marginIsleGrowKmPerMyr * dt / edgeKm), pCoast = pGrow * config.marginIsleCoastShare;
    const P = [0, 0, 0];
    let changed = 0;
    for (const plate of plates) {
        if (!plate.alive || plate.isBackground || plate.crust.count === 0) continue;
        const crust = plate.crust, { mask, type, flags, slabKm } = crust;
        const isLand = c => type[c] === CrustType.CONTINENT || type[c] === CrustType.CRATON;
        let anyTrench = false;                                   // (no trench cell at all: nothing below applies — skip the searches)
        for (let c = 0; c < numCells && !anyTrench; c++) if (mask[c] && type[c] === CrustType.OCEAN && (flags[c] & CrustFlag.TRENCH)) anyTrench = true;
        if (!anyTrench) continue;
        // the trench cells of a mature, active continental margin
        const onPlate = c => mask[c] === 1, landD = hopsFrom(mesh, cellsWhere(numCells, c => mask[c] && isLand(c)), onPlate, reachHops + 1).dist;
        const trench = cellsWhere(numCells, c => {
            if (!mask[c] || type[c] !== CrustType.OCEAN || !(flags[c] & CrustFlag.TRENCH) || landD[c] < 0) return false;
            let slab = slabKm[c];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (mask[nb] && (flags[nb] & CrustFlag.TRENCH)) slab = Math.max(slab, slabKm[nb]); }
            if (slab < config.marginIsleSlabKm) return false;
            plate.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], P);
            return boundaryKind[index.nearest(P[0], P[1], P[2])] === BoundaryKind.OVERRIDING;
        });
        if (!trench.length) continue;
        // erosive or accretionary, trench cell by trench cell (the flag is what frames show)
        for (const c of trench) {
            plate.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], P);
            const w = index.nearest(P[0], P[1], P[2]), rate = Math.max(0, world.convergence[w]);
            const erosive = config.marginErosionKmPerMyr > 0 && (rate > config.erosiveConvergenceCmYr || trenchSedimentKm(world, plate, P, w) < config.accretionSedimentKm);
            if (erosive) flags[c] |= CrustFlag.EROSIVE; else flags[c] &= ~CrustFlag.EROSIVE;
        }
        const { dist: trenchD, source: nearestTrench } = hopsFrom(mesh, trench, onPlate, Math.max(reachHops, erodeHops) + 1);
        const erosive = c => (flags[nearestTrench[c]] & CrustFlag.EROSIVE) !== 0;
        // an erosive margin eats its coast (never a craton), back to marginErosionMaxGapKm from its trench
        if (pErode > 0) {
            const coastCells = [];
            for (let c = 0; c < numCells; c++) {
                if (!mask[c] || trenchD[c] < 0 || trenchD[c] >= erodeHops || !erosive(c)) continue;
                if (type[c] === CrustType.OCEAN || type[c] === CrustType.CRATON) continue;
                let sea = null;                                          // a coast cell: sea of its own plate beside it
                for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (mask[nb] && type[nb] === CrustType.OCEAN) { sea = nb; break; } }
                if (sea !== null) coastCells.push([c, sea]);
            }
            // (the coast retreats marginErosionKmPerMyr along the TRENCH's length: a coast counted cell by cell is longer
            // the finer the mesh — its every inlet drawn — so per coast cell it lost twice the land at 160K as at 20K;
            // where the coast is more intricate than its trench, the same retreat is shared among more cells)
            let erosiveTrench = 0;
            for (const c of trench) if (flags[c] & CrustFlag.EROSIVE) erosiveTrench++;
            const p = pErode * Math.min(1, erosiveTrench / Math.max(1, coastCells.length)), eaten = [];
            for (const [c, sea] of coastCells) if (rng() < p) eaten.push([c, crust.formedAt[sea]]);
            for (const [c, age] of eaten) { crust.create(c, CrustType.OCEAN, age); flags[c] = CrustFlag.APRON; }
            if (eaten.length) { plate.dirty = true; changed += eaten.length; world.budget.erodedCells += eaten.length; }
        }
        // the fore-arc: sea between this coast and its trench, keeping the gap in front of the trench
        const raise = [];
        for (let c = 0; c < numCells; c++) {
            if (!mask[c] || type[c] !== CrustType.OCEAN || (flags[c] & CrustFlag.TRENCH) || trenchD[c] < gapHops || landD[c] < 1 || landD[c] + trenchD[c] > reachHops + 1 || erosive(c)) continue;
            let island = false, coast = false, edge = false;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (!mask[nb]) { edge = true; break; }
                if (type[nb] === CrustType.ARC && (flags[nb] & CrustFlag.MARGIN_ISLE)) island = true; else if (isLand(nb)) coast = true;
            }
            if (edge) continue;
            if (rng() < (island ? pGrow : coast ? pCoast : pBorn)) raise.push(c);
        }
        if (raise.length) {
            plate.marginIsleTerrane ??= world.nextTerraneId();
            for (const c of raise) {
                type[c] = CrustType.ARC; crust.formedAt[c] = time;
                flags[c] = (flags[c] & ~CrustFlag.APRON) | CrustFlag.MARGIN_ISLE;
                crust.terrane[c] = plate.marginIsleTerrane;
            }
            changed += raise.length;
            plate.dirty = true;
        }
        changed += mergeIntoMainland(world, plate);
    }
    return changed;
}

// Islands that touch the mainland become part of it: continental crust, keeping their own terrane.
function mergeIntoMainland(world, plate) {
    const { mesh, config } = world, { adjOffset, adjList, numCells, cellAreaKm2 } = mesh, crust = plate.crust, { mask, type, flags } = crust;
    const seen = new Uint8Array(numCells);
    let merged = 0;
    for (let s = 0; s < numCells; s++) {
        if (seen[s] || !mask[s] || !(flags[s] & CrustFlag.MARGIN_ISLE) || type[s] !== CrustType.ARC) continue;
        const piece = [s]; seen[s] = 1;
        let touches = false;
        for (let i = 0; i < piece.length; i++) for (let k = adjOffset[piece[i]]; k < adjOffset[piece[i] + 1]; k++) {
            const nb = adjList[k];
            if (!mask[nb]) continue;
            if (type[nb] === CrustType.CONTINENT || type[nb] === CrustType.CRATON) touches = true;
            else if (!seen[nb] && type[nb] === CrustType.ARC && (flags[nb] & CrustFlag.MARGIN_ISLE)) { seen[nb] = 1; piece.push(nb); }
        }
        if (!touches) continue;
        for (const c of piece) type[c] = CrustType.CONTINENT;
        merged += piece.length;
        if (piece.length * cellAreaKm2 >= config.terraneMinAreaKm2) world.log(EventKind.ISLE_MERGE, `an island off ${plate.name}’s coast (${(piece.length * cellAreaKm2 / 1e3).toFixed(0)}k km²) has grown into the mainland`, { plate: plate.id, areaKm2: piece.length * cellAreaKm2 });
    }
    if (merged) plate.dirty = true;
    return merged;
}

/**
 * How much sediment fills the trench at world position P (world cell w, on `plate`'s side), km: the land around it — the
 * share of continental crust, any plate's, sampled on rings out to trenchSedimentReachKm — × trenchTerrigenousKm × how
 * fast its latitude erodes, plus the pelagic cover the incoming ocean floor brings, by its age.
 */
function trenchSedimentKm(world, plate, P, w) {
    const { config, mesh, owner, ownerCell, plates, time } = world, { index, adjOffset, adjList } = mesh;
    const e1 = normalizeTangent(P), e2 = [P[1] * e1[2] - P[2] * e1[1], P[2] * e1[0] - P[0] * e1[2], P[0] * e1[1] - P[1] * e1[0]];
    let land = 0, n = 0;
    for (let ring = 1; ring <= SEDIMENT_RINGS; ring++) {
        const d = config.trenchSedimentReachKm * ring / SEDIMENT_RINGS / PLANET_RADIUS_KM, cd = Math.cos(d), sd = Math.sin(d);
        for (let k = 0; k < SEDIMENT_SPOKES; k++) {
            const a = 2 * Math.PI * (k + 0.5 * ring) / SEDIMENT_SPOKES, ca = Math.cos(a) * sd, sa = Math.sin(a) * sd;
            const q = index.nearest(cd * P[0] + ca * e1[0] + sa * e2[0], cd * P[1] + ca * e1[1] + sa * e2[1], cd * P[2] + ca * e1[2] + sa * e2[2]);
            const o = owner[q];
            if (o >= 0) { const t = plates[o].crust.type[ownerCell[q]]; if (t === CrustType.CONTINENT || t === CrustType.CRATON) land++; }
            n++;
        }
    }
    const lat = Math.asin(Math.max(-1, Math.min(1, P[2]))) * 180 / Math.PI;
    let incomingAge = 0;
    for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
        const nb = adjList[k], o = owner[nb];
        if (o >= 0 && o !== plate.id && plates[o].crust.type[ownerCell[nb]] === CrustType.OCEAN) incomingAge = Math.max(incomingAge, time - plates[o].crust.formedAt[ownerCell[nb]]);
    }
    return config.trenchTerrigenousKm * (land / n) * erosionAtLatitude(lat, heightsOf(config)) + config.trenchPelagicKmPerMyr * incomingAge;
}
const SEDIMENT_RINGS = 3, SEDIMENT_SPOKES = 12;

/** A unit vector tangent to the sphere at P. */
function normalizeTangent(P) {
    const ref = Math.abs(P[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const t = [P[1] * ref[2] - P[2] * ref[1], P[2] * ref[0] - P[0] * ref[2], P[0] * ref[1] - P[1] * ref[0]], l = Math.hypot(...t);
    return [t[0] / l, t[1] / l, t[2] / l];
}

function cellsWhere(n, test) { const out = []; for (let c = 0; c < n; c++) if (test(c)) out.push(c); return out; }

/** Hops through this plate's crust from the given cells (−1 beyond `maxHops`). */
