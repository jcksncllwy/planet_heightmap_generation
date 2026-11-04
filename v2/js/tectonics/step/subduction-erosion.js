// Subduction erosion (lane crust, config.subductionErosionKm3PerKmMyr; 0 = off): the continent's larger sink at
// subduction zones. The downgoing plate abrades the base of the overriding plate's fore-arc and drags the rock down the
// subduction channel; the fore-arc thins and subsides and the trench migrates landward (the Andes' margin, ~250 km since
// the Jurassic; Japan, Central America: Clift & Vannucchi 2004, Rev. Geophys. 42 RG2001). Scholl & von Huene 2009 (GSL
// Spec. Publ. 318) put ocean-margin recycling at ~2.5 km³/yr at ~60 km³ Myr⁻¹ per km of trench (so ~41,700 km of it),
// ~60 % of it subduction erosion: ~1.5 km³/yr, a mean of ~36 km³ Myr⁻¹ per km (my arithmetic). Measured long-term rates
// run ~30 (SW Japan) to 50–70 (Peru, N Chile) and ~115 km³ Myr⁻¹ km⁻¹ (central Chile) (von Huene et al. 2004, via the
// Durham mantleplumes summary).
//
// Here: every overriding trench front that closes (boundaryKind OVERRIDING, convergence > 0) takes that mean volume per
// km of its length per Myr off the continental crust nearest it on its own plate within the fore-arc's reach
// (subductionErosionReachKm), thinning it (rootKm); a cell thinned past the hyperextended floor (THIN_FLOOR_KM) founders
// to ocean floor, its remainder lost with it — so the coast retreats from the trench as the fore-arc is eaten. Its own
// ledger stage, `subductionErosion`.
//
// Limits (reduced physics): the rate is Earth's mean on every closing front — no split into erosive margins (fast, little
// trench fill) and accretionary ones (thick fill: Clift & Vannucchi's ~1 km of trench sediment), whose mean the figure
// already is; no dependence on the convergence rate beyond closing at all; cratons and island arcs are not eaten (a
// craton's edge rarely faces a trench; arcs keep their own crust model, step/arcs.js).

import { CrustType, CrustFlag } from '../model/crust.js';
import { BoundaryKind } from '../model/world.js';
import { columnModel } from '../measure.js';
import { heightsOf } from './heights.js';

const THIN_FLOOR_KM = 3;   // (as step/rifting.js: the hyperextended domain's thinnest crust, ~3 km, Sutra et al. 2013)

/** @returns {number} continental cells lost to subduction erosion this step */
export function erodeForeArcs(world, dt) {
    const { mesh, plates, owner, ownerCell, boundaryKind, convergence, config, time } = world, { adjOffset, adjList, edgeKm, cellAreaKm2 } = mesh;
    const rate = config.subductionErosionKm3PerKmMyr;
    if (!(rate > 0) || dt <= 0) return 0;
    const C = columnModel(heightsOf(config)), hops = Math.max(1, Math.round(config.subductionErosionReachKm / edgeKm));
    const dueKm = rate * dt * edgeKm / cellAreaKm2;           // (km of crust off one cell, per front cell: a cell's width of trench)
    const due = new Map();                                    // plate id → Map(cell → km of crust owed)
    let km3 = 0;
    for (let w = 0; w < owner.length; w++) {
        if (boundaryKind[w] !== BoundaryKind.OVERRIDING || !(convergence[w] > 0)) continue;
        const id = owner[w];
        if (id < 0) continue;
        const crust = plates[id].crust, { mask, type } = crust;
        // the nearest ring of continent within the fore-arc's reach, the front's due shared over it
        let ring = [ownerCell[w]], seen = new Set(ring), hit = [];
        for (let h = 0; h <= hops && ring.length && !hit.length; h++) {
            for (const c of ring) if (type[c] === CrustType.CONTINENT) hit.push(c);
            if (hit.length || h === hops) break;
            const next = [];
            for (const c of ring) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (mask[nb] && !seen.has(nb)) { seen.add(nb); next.push(nb); } }
            ring = next;
        }
        if (!hit.length) continue;
        let m = due.get(id);
        if (!m) due.set(id, m = new Map());
        for (const c of hit) m.set(c, (m.get(c) ?? 0) + dueKm / hit.length);
    }
    let lost = 0;
    for (const [id, m] of due) {
        const plate = plates[id], crust = plate.crust, { rootKm, type, mask } = crust;
        for (const [c, km] of m) {
            const h = C.crust[type[c]] + rootKm[c];
            if (h - km > THIN_FLOOR_KM) { rootKm[c] -= km; km3 += km * cellAreaKm2; continue; }
            // (thinned to nothing: the fore-arc founders, the coast steps back; its floor dated as the sea beside it)
            let at = time;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (mask[nb] && type[nb] === CrustType.OCEAN && crust.formedAt[nb] >= 0) { at = Math.min(at, crust.formedAt[nb]); } }
            km3 += Math.max(0, h) * cellAreaKm2;
            crust.create(c, CrustType.OCEAN, at);
            crust.flags[c] = CrustFlag.APRON;
            lost++;
        }
        plate.dirty = true;
    }
    world.budget.subductionErosionKm3 = (world.budget.subductionErosionKm3 ?? 0) + km3;
    if (lost) world.budget.subductionErosionCells = (world.budget.subductionErosionCells ?? 0) + lost;
    return lost;
}
