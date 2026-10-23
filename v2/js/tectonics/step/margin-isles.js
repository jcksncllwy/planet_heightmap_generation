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
// sediment comes from the land within reach of the trench, as fast as that land wears down (trenchDenudationKmPerMyr, by
// latitude: rain, or ice), spread over the floor the convergence brings in — the fill stands at supply ÷ convergence —
// and from the incoming ocean floor, more the older it is: a slow trench off a continent in wet or icy latitudes fills
// (Alaska, Cascadia), a fast one, or one off a desert or out at sea, starves (northern Chile, Tonga). Whatever the kind,
// the base of that fill goes down the subduction channel with the slab: step/sediment-subduction.js. An erosive margin
// raises no islands, and its coast — never a craton — turns to fore-arc sea at marginErosionKmPerMyr, until the coast
// lies marginErosionMaxGapKm from its trench (it erodes from its first convergence; islands rise only off a mature one). Trench cells carry CrustFlag.EROSIVE so frames can show which margins are which.

import { CrustType, CrustFlag } from '../model/crust.js';
import { BoundaryKind, EventKind } from '../model/world.js';
import { hopsFrom } from '../../core/mesh-bfs.js';
import { PLANET_RADIUS_KM } from '../../core/sim-mesh.js';
import { erosionAtLatitude } from '../../terrain/terrain-config.js';
import { heightsOf } from './heights.js';
import { CM_PER_YR_TO_KM_PER_MYR } from '../config.js';

/** @returns {number} cells raised or merged this step */
export function growMarginIsles(world, dt) {
    const { mesh, plates, config, time, rngMarginIsle: rng } = world;
    const { adjOffset, adjList, edgeKm, cellAreaKm2, numCells } = mesh;
    if (dt <= 0 || (config.marginIsleRatePerMyr <= 0 && config.marginIsleGrowKmPerMyr <= 0 && config.marginErosionKmPerMyr <= 0)) return 0;
    const pErode = Math.min(1, config.marginErosionKmPerMyr * dt / edgeKm);
    const erodeHops = Math.max(1, Math.round(config.marginErosionMaxGapKm / edgeKm));
    const reachHops = Math.max(1, Math.round(config.marginIsleReachKm / edgeKm)), gapHops = Math.max(1, Math.round(config.marginIsleGapKm / edgeKm));
    const pBorn = config.marginIsleRatePerMyr * dt * cellAreaKm2 / (1000 * 0.5 * config.marginIsleReachKm);     // per km² of fore-arc: births per 1000 km of margin
    const pGrow = Math.min(1, config.marginIsleGrowKmPerMyr * dt / edgeKm), pCoast = pGrow * config.marginIsleCoastShare;
    let changed = 0;
    for (const plate of plates) {
        if (!plate.alive || plate.isBackground || plate.crust.count === 0) continue;
        const crust = plate.crust, { mask, type, flags } = crust;
        const isLand = c => type[c] === CrustType.CONTINENT || type[c] === CrustType.CRATON;
        // the trench cells of an active continental margin (step/margin-isles.js marginTrenches: shared with the sediment
        // that goes down them, step/sediment-subduction.js), and of those, the mature ones whose fore-arc can rise
        const m = marginTrenches(world, plate);
        if (!m) continue;
        const onPlate = c => mask[c] === 1, landD = m.landD, trench = m.cells;
        // erosive or accretionary, trench cell by trench cell (the flag is what frames show). (A margin erodes from the
        // moment it converges: the slab need not be mature for the trench to scrape the fore-arc's base — Clift &
        // Vannucchi 2004's rule is convergence and sediment, nothing else. Was: only trenches past marginIsleSlabKm were
        // judged, and a young one kept whatever flag it had.) A trench cell no longer on a continental margin loses its flag.
        for (const c of m.allTrench) flags[c] &= ~CrustFlag.EROSIVE;
        let erosiveTrench = 0, wedgeKm3 = 0;
        for (let i = 0; i < trench.length; i++) {
            const h = m.terrKm[i] + m.pelKm[i];
            const erosive = config.marginErosionKmPerMyr > 0 && (m.conv[i] > config.erosiveConvergenceCmYr || h < config.accretionSedimentKm);
            if (erosive) { flags[trench[i]] |= CrustFlag.EROSIVE; erosiveTrench++; }
            else wedgeKm3 += m.conv[i] * CM_PER_YR_TO_KM_PER_MYR * Math.max(0, h - config.accretionSedimentKm) * edgeKm * dt;   // scraped off into the prism
        }
        world.budget.wedgeKm3 = (world.budget.wedgeKm3 ?? 0) + wedgeKm3;
        // (the margins' length over time, km·Myr — every overriding trench, the continental margins among them, the erosive
        // ones among those: the share of erosive margin and the fluxes per km of trench are read from these)
        const B = world.budget, km = edgeKm * dt;
        B.trenchKmMyr = (B.trenchKmMyr ?? 0) + m.overriding * km;
        B.marginTrenchKmMyr = (B.marginTrenchKmMyr ?? 0) + trench.length * km;
        B.erosiveTrenchKmMyr = (B.erosiveTrenchKmMyr ?? 0) + erosiveTrench * km;
        if (!trench.length) continue;
        // (erosion measures from every margin trench cell; the fore-arc islands, as before, from the mature ones only)
        const mature = trench.filter((c, i) => m.mature[i]);
        const all = hopsFrom(mesh, trench, onPlate, Math.max(reachHops, erodeHops) + 1);
        const { dist: trenchD, source: nearestTrench } = mature.length === trench.length ? all : hopsFrom(mesh, mature, onPlate, reachHops + 1);
        const erosive = c => (flags[nearestTrench[c]] & CrustFlag.EROSIVE) !== 0;
        // an erosive margin eats its coast (never a craton), back to marginErosionMaxGapKm from its trench
        if (pErode > 0 && erosiveTrench > 0) {
            const trenchD = all.dist, erosive = c => (flags[all.source[c]] & CrustFlag.EROSIVE) !== 0;
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
        // (the islands are the accretionary prism risen above the sea, so they are made of what the trench scrapes off —
        // crust-sink branch: per km of accretionary trench, v × (fill − accretionSedimentKm), the fill the subduction
        // channel cannot take — and of the fore-arc's own ocean crust beneath, oceanCrustKm of it; a cell of island costs
        // continentCrustKm − oceanCrustKm of scraped sediment over its area. The prism keeps what it has not yet raised.
        // Where the islands' rates would raise more than the prism holds, those to rise are drawn at random among them)
        if (config.wedgeConservation) {
            plate.wedgeDue = (plate.wedgeDue ?? 0) + wedgeKm3 / ((config.continentCrustKm - config.oceanCrustKm) * cellAreaKm2);
            if (raise.length > plate.wedgeDue) {
                for (let i = raise.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [raise[i], raise[j]] = [raise[j], raise[i]]; }
                raise.length = Math.floor(plate.wedgeDue);
            }
            plate.wedgeDue -= raise.length;
        }
        if (raise.length) {
            world.budget.isleRaisedCells = (world.budget.isleRaisedCells ?? 0) + raise.length;
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
 * A plate's active continental margin, once a step (cached on world.foreArcs for the stages after it): its trench cells
 * (ocean, TRENCH, on an OVERRIDING boundary, with the plate's own land within marginIsleReachKm), each one's convergence
 * (cm/yr), its trench's fill — terrigenous and pelagic, km (trenchSediment) — and whether its slab is mature enough
 * (marginIsleSlabKm) for the fore-arc to rise. Also every trench cell of the plate (allTrench), how many of them lie on
 * an overriding boundary at all, ocean margins included (overriding), and the hops from the plate's land (landD).
 * @returns {null|{cells: number[], conv: Float32Array, terrKm: Float32Array, pelKm: Float32Array, mature: Uint8Array, allTrench: number[], overriding: number, landD: Int16Array}}
 */
export function marginTrenches(world, plate) {
    const { mesh, config, boundaryKind } = world, { adjOffset, adjList, xyz, index, edgeKm, numCells } = mesh;
    if (world.foreArcs?.step !== world.step) world.foreArcs = { step: world.step, byPlate: new Map() };
    const cache = world.foreArcs.byPlate;
    if (cache.has(plate.id)) return cache.get(plate.id);
    const { mask, type, flags, slabKm } = plate.crust;
    const allTrench = cellsWhere(numCells, c => mask[c] && type[c] === CrustType.OCEAN && (flags[c] & CrustFlag.TRENCH));
    let out = null;
    if (allTrench.length) {           // (no trench cell at all: nothing applies — skip the searches)
        const reachHops = Math.max(1, Math.round(config.marginIsleReachKm / edgeKm));
        const isLand = c => type[c] === CrustType.CONTINENT || type[c] === CrustType.CRATON;
        const landD = hopsFrom(mesh, cellsWhere(numCells, c => mask[c] && isLand(c)), c => mask[c] === 1, reachHops + 1).dist;
        const cells = [], conv = [], terrKm = [], pelKm = [], mature = [], P = [0, 0, 0];
        let overriding = 0;
        for (const c of allTrench) {
            plate.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], P);
            const w = index.nearest(P[0], P[1], P[2]);
            if (boundaryKind[w] !== BoundaryKind.OVERRIDING) continue;
            overriding++;
            if (landD[c] < 0) continue;
            let slab = slabKm[c];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (mask[nb] && (flags[nb] & CrustFlag.TRENCH)) slab = Math.max(slab, slabKm[nb]); }
            const sed = trenchSediment(world, plate, P, w, landD[c] * edgeKm);
            cells.push(c); conv.push(Math.max(0, world.convergence[w])); terrKm.push(sed.terrKm); pelKm.push(sed.pelKm);
            mature.push(slab >= config.marginIsleSlabKm ? 1 : 0);
        }
        out = { cells, conv: Float32Array.from(conv), terrKm: Float32Array.from(terrKm), pelKm: Float32Array.from(pelKm), mature: Uint8Array.from(mature), allTrench, overriding, landD };
    }
    cache.set(plate.id, out);
    return out;
}

/**
 * How much sediment fills the trench at world position P (world cell w, on `plate`'s side), km: terrigenous — what the
 * land around it delivers (the share of continental crust, any plate's, sampled on rings from its coast — `coastKm` off —
 * out to trenchSedimentReachKm beyond: the rivers cross the fore-arc to the trench down its canyons, so a wide fore-arc
 * sea does not starve a trench whose coast has rivers ×
 * trenchDenudationKmPerMyr × how fast its latitude erodes: `supply`, km³/Myr per km of trench) over the convergence that
 * carries it away — and pelagic, the cover the incoming ocean floor brings, by its age.
 * @returns {{terrKm: number, pelKm: number, supply: number}}
 */
export function trenchSediment(world, plate, P, w, coastKm = 0) {
    const { config, mesh, owner, ownerCell, plates, time } = world, { index, adjOffset, adjList } = mesh;
    const e1 = normalizeTangent(P), e2 = [P[1] * e1[2] - P[2] * e1[1], P[2] * e1[0] - P[0] * e1[2], P[0] * e1[1] - P[1] * e1[0]];
    let land = 0, n = 0;
    for (let ring = 1; ring <= SEDIMENT_RINGS; ring++) {
        const d = (coastKm + config.trenchSedimentReachKm * ring / SEDIMENT_RINGS) / PLANET_RADIUS_KM, cd = Math.cos(d), sd = Math.sin(d);
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
    // (terrigenous: what the land in reach delivers per km of trench — its area per km, the land's share of a strip
    // trenchSedimentReachKm either side, × how fast it wears down — spread over the floor the convergence brings in: the
    // fill at supply ÷ convergence; a trench holds at most TRENCH_FILL_MAX_KM)
    const supply = config.trenchDenudationKmPerMyr * erosionAtLatitude(lat, heightsOf(config)) * (land / n) * 2 * config.trenchSedimentReachKm;   // km³/Myr per km
    const v = Math.max(0, world.convergence[w]) * CM_PER_YR_TO_KM_PER_MYR;
    return { terrKm: supply > 0 ? Math.min(TRENCH_FILL_MAX_KM, supply / Math.max(v, 1e-6)) : 0, pelKm: config.trenchPelagicKmPerMyr * incomingAge, supply };
}
const SEDIMENT_RINGS = 3, SEDIMENT_SPOKES = 12;
const TRENCH_FILL_MAX_KM = 8;      // (a trench is filled to its rim at most: ~8 km of fill in the Makran, Cascadia and Barbados' wedges are ~3–7)

/** A unit vector tangent to the sphere at P. */
function normalizeTangent(P) {
    const ref = Math.abs(P[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const t = [P[1] * ref[2] - P[2] * ref[1], P[2] * ref[0] - P[0] * ref[2], P[0] * ref[1] - P[1] * ref[0]], l = Math.hypot(...t);
    return [t[0] / l, t[1] / l, t[2] / l];
}

function cellsWhere(n, test) { const out = []; for (let c = 0; c < n; c++) if (test(c)) out.push(c); return out; }

/** Hops through this plate's crust from the given cells (−1 beyond `maxHops`). */
