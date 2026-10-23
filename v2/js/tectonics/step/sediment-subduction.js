// Sediment subduction: the continent's sink at every active margin, erosive or accretionary. Rivers carry the land
// within reach of a trench into it (step/margin-isles.js trenchSediment: the land's share × how fast its latitude erodes,
// and the pelagic cover the incoming floor brings), and the downgoing plate drags the base of that fill down the
// subduction channel — about accretionSedimentKm of it: that is why a trench holding less than ~1 km of sediment
// accretes nothing and one holding more scrapes the rest off into a wedge (Clift & Vannucchi 2004; the channel itself:
// Cloos & Shreve 1988). Per km of trench, the sediment going down is
//     F = v × min(h, accretionSedimentKm) × (terrigenous share of h) × sedimentSubductionShare      (km³/Myr per km)
// with v the convergence (1 cm/yr = 10 km/Myr) and h the trench's fill: only the terrigenous share is continental
// crust lost; the pelagic share was never the continent's. Earth: ~40 % of the ~60 km³/Myr per km recycled at
// ocean-margin subduction zones (Scholl & von Huene 2009), i.e. ~24 km³/Myr per km — about 1 km³/yr in all.
//
// The engine's crust is area, not volume: what goes down is booked as continental area, its volume over
// continentCrustKm, and taken where the sediment came from — the coast facing the trench, the land within
// trenchSedimentReachKm that drains into it (a margin that loses its rock column founders below the sea first at its
// edge). The coast cells eaten are drawn at random, each weighted by its trench's flux; a cell owed that no coast is
// there to pay (none in reach, or only cratons) is not carried. Its own ledger stage, `sedimentSubduction`.

import { CrustType, CrustFlag } from '../model/crust.js';
import { hopsFrom } from '../../core/mesh-bfs.js';
import { marginTrenches } from './margin-isles.js';

/** @returns {number} continental cells lost to the trench this step */
export function subductSediment(world, dt) {
    const { mesh, plates, config, rngSediment: rng } = world, { adjOffset, adjList, edgeKm, cellAreaKm2, numCells } = mesh;
    const share = config.sedimentSubductionShare;
    if (!(share > 0) || dt <= 0) return 0;
    const reachHops = Math.max(1, Math.round(config.trenchSedimentReachKm / edgeKm)), channel = config.accretionSedimentKm;
    let lost = 0;
    for (const plate of plates) {
        if (!plate.alive || plate.isBackground || plate.crust.count === 0) continue;
        const m = marginTrenches(world, plate);
        if (!m || !m.cells.length) continue;
        const crust = plate.crust, { mask, type } = crust;
        // each trench cell's flux, as continental area owed this step (cells)
        const owed = new Float64Array(m.cells.length), slot = new Map();
        let total = 0;
        for (let i = 0; i < m.cells.length; i++) {
            const h = m.terrKm[i] + m.pelKm[i];
            if (!(h > 0) || !(m.conv[i] > 0)) continue;
            const km3PerMyrPerKm = m.conv[i] * 10 * Math.min(h, channel) * (m.terrKm[i] / h) * share;
            owed[i] = km3PerMyrPerKm * edgeKm * dt / config.continentCrustKm / cellAreaKm2;
            total += owed[i];
            slot.set(m.cells[i], i);
        }
        world.budget.sedimentKm3 = (world.budget.sedimentKm3 ?? 0) + total * cellAreaKm2 * config.continentCrustKm;
        plate.sedimentDue = (plate.sedimentDue ?? 0) + total;
        if (plate.sedimentDue < 1) continue;
        // the coast facing those trenches: continent (never a craton) beside the plate's own sea, within the trench's reach
        const { dist, source } = hopsFrom(mesh, m.cells, c => mask[c] === 1, reachHops);
        const coast = [], perTrench = new Float64Array(m.cells.length);
        for (let c = 0; c < numCells; c++) {
            if (!mask[c] || dist[c] < 0 || type[c] !== CrustType.CONTINENT) continue;
            let sea = -1;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (mask[nb] && type[nb] === CrustType.OCEAN) { sea = nb; break; } }
            if (sea < 0) continue;
            const i = slot.get(source[c]);
            if (i === undefined || !(owed[i] > 0)) continue;
            coast.push([c, sea, i]); perTrench[i]++;
        }
        if (!coast.length) { plate.sedimentDue = 0; continue; }
        // (each coast cell weighted by its trench's flux shared among that trench's coast cells)
        const weight = coast.map(([, , i]) => owed[i] / perTrench[i]);
        let sum = weight.reduce((a, b) => a + b, 0);
        const n = Math.min(Math.floor(plate.sedimentDue), coast.length), eaten = [];
        for (let k = 0; k < n && sum > 0; k++) {
            let r = rng() * sum, j = 0;
            while (j < coast.length - 1 && (weight[j] === 0 || (r -= weight[j]) > 0)) j++;
            if (weight[j] === 0) break;
            eaten.push(coast[j]); sum -= weight[j]; weight[j] = 0;
        }
        for (const [c, sea] of eaten) { crust.create(c, CrustType.OCEAN, crust.formedAt[sea]); crust.flags[c] = CrustFlag.APRON; }
        plate.sedimentDue = Math.min(1, plate.sedimentDue - eaten.length);     // (what found no coast is not carried)
        if (eaten.length) { plate.dirty = true; lost += eaten.length; world.budget.sedimentCells = (world.budget.sedimentCells ?? 0) + eaten.length; }
    }
    return lost;
}
