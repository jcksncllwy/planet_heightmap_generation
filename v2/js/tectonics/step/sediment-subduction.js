// Sediment subduction: the continent's sink at every subduction zone, erosive or accretionary, continental margin or
// island arc. Rivers carry their basins' rock to the trenches their fans reach (step/trench-fans.js; the fill:
// step/margin-isles.js trenchSediment, with the pelagic cover the incoming floor brings), and the downgoing plate drags the base of that fill down the
// subduction channel — about accretionSedimentKm of it: that is why a trench holding less than ~1 km of sediment
// accretes nothing and one holding more scrapes the rest off into a wedge (Clift & Vannucchi 2004; the channel itself:
// Cloos & Shreve 1988). Per km of trench, the sediment going down is
//     F = v × min(h, accretionSedimentKm) × (terrigenous share of h) × sedimentSubductionShare      (km³/Myr per km)
// with v the convergence (1 cm/yr = 10 km/Myr) and h the trench's fill: only the terrigenous share is continental
// crust lost; the pelagic share was never the continent's. Earth: ~40 % of the ~60 km³/Myr per km recycled at
// ocean-margin subduction zones (Scholl & von Huene 2009), i.e. ~24 km³/Myr per km — about 1 km³/yr in all.
//
// The engine's crust is area, not volume: what goes down is booked as continental area, its volume over
// continentCrustKm, and taken where the sediment came from — the river basins whose fans fed that trench
// (step/trench-fans.js), each losing what share of its rock the trenches it reaches send down, at the coast around its
// mouth: within half its basin's breadth (√area ÷ 2) of the mouth, never a craton (a basin that loses its rock column
// founders below the sea first at its edge). The coast cells eaten are drawn at random, each weighted by its basins'
// losses; a cell owed that no coast is there to pay is not carried. Its own ledger stage, `sedimentSubduction`.

import { CrustType, CrustFlag } from '../model/crust.js';
import { trenchFans } from './trench-fans.js';
import { trenchSediment } from './margin-isles.js';

/** @returns {number} continental cells lost to the trenches this step */
export function subductSediment(world, dt) {
    const { mesh, plates, config, owner, rngSediment: rng } = world, { adjOffset, adjList, edgeKm, cellAreaKm2 } = mesh;
    const share = config.sedimentSubductionShare, channel = config.accretionSedimentKm;
    if (!(share > 0) || dt <= 0) return 0;
    const { deliveries } = trenchFans(world);
    if (!deliveries.length) return 0;
    // the share of what a trench cell receives that goes down its channel: v × min(h, channel) × (terrigenous share of
    // h) over the supply — the rest is scraped off into the prism, or overtops a full trench
    const downShare = new Map();
    const shareAt = w => {
        let f = downShare.get(w);
        if (f !== undefined) return f;
        const sed = trenchSediment(world, owner[w], w), h = sed.terrKm + sed.pelKm, v = Math.max(0, world.convergence[w]) * 10;
        f = sed.supply > 0 && h > 0 && v > 0 ? Math.min(1, v * Math.min(h, channel) * (sed.terrKm / h) * share / sed.supply) : 0;
        downShare.set(w, f);
        return f;
    };
    // each basin's continental rock lost, km³/Myr, gathered per source plate onto the coast around its mouth
    const byPlate = new Map();
    let km3 = 0, allKm3 = 0;
    for (const { mouth, cells, weights } of deliveries) {
        let f = 0;
        for (let i = 0; i < cells.length; i++) f += weights[i] * shareAt(cells[i]);
        allKm3 += mouth.km3 * f * dt;               // (all the rivers' rock that goes down, arcs' and islands' too: Earth's figure)
        const lost = mouth.contKm3 * f;
        if (!(lost > 0)) continue;
        km3 += lost * dt;
        if (!byPlate.has(mouth.plate)) byPlate.set(mouth.plate, []);
        byPlate.get(mouth.plate).push([mouth, lost]);
    }
    world.budget.sedimentKm3 = (world.budget.sedimentKm3 ?? 0) + km3;
    world.budget.sedimentAllKm3 = (world.budget.sedimentAllKm3 ?? 0) + allKm3;
    let lost = 0;
    for (const [id, list] of byPlate) {
        const plate = plates[id], crust = plate.crust, { mask, type } = crust;
        plate.sedimentDue = (plate.sedimentDue ?? 0) + list.reduce((a, [, l]) => a + l, 0) * dt / (config.continentCrustKm * cellAreaKm2);
        if (plate.sedimentDue < 1) continue;
        // the coast around each mouth: continent (never a craton) beside the plate's own sea, within half the basin's breadth
        const weight = new Map();
        const coastSea = c => { for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (mask[nb] && type[nb] === CrustType.OCEAN) return nb; } return -1; };
        for (const [mouth, l] of list) {
            if (!mask[mouth.cell]) continue;
            const hops = Math.round(0.5 * Math.sqrt(mouth.basinKm2) / edgeKm), ring = [mouth.cell], coast = [];
            const mark = new Set([mouth.cell]);
            for (let h = 0, from = 0; ; h++) {
                const to = ring.length;
                for (let i = from; i < to; i++) { const c = ring[i]; if (type[c] === CrustType.CONTINENT && coastSea(c) >= 0) coast.push(c); }
                if (h >= hops) break;
                for (let i = from; i < to; i++) for (let k = adjOffset[ring[i]]; k < adjOffset[ring[i] + 1]; k++) {
                    const nb = adjList[k];
                    if (mask[nb] && type[nb] !== CrustType.OCEAN && !mark.has(nb)) { mark.add(nb); ring.push(nb); }
                }
                from = to;
                if (ring.length === to) break;
            }
            for (const c of coast) weight.set(c, (weight.get(c) ?? 0) + l / coast.length);
        }
        const coast = [...weight.keys()], w = coast.map(c => weight.get(c));
        if (!coast.length) { plate.sedimentDue = 0; continue; }
        let sum = w.reduce((a, b) => a + b, 0);
        const n = Math.min(Math.floor(plate.sedimentDue), coast.length), eaten = [];
        for (let k = 0; k < n && sum > 0; k++) {
            let r = rng() * sum, j = 0;
            while (j < coast.length - 1 && (w[j] === 0 || (r -= w[j]) > 0)) j++;
            if (w[j] === 0) break;
            eaten.push(coast[j]); sum -= w[j]; w[j] = 0;
        }
        for (const c of eaten) { crust.create(c, CrustType.OCEAN, crust.formedAt[coastSea(c)]); crust.flags[c] = CrustFlag.APRON; }
        plate.sedimentDue = Math.min(1, plate.sedimentDue - eaten.length);     // (what found no coast is not carried)
        if (eaten.length) { plate.dirty = true; lost += eaten.length; world.budget.sedimentCells = (world.budget.sedimentCells ?? 0) + eaten.length; }
    }
    return lost;
}
