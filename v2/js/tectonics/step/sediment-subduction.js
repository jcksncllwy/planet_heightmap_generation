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
// The rock that goes down was the continents': the erosion took it off their crust as it wore (crust.wornKm), so it is
// booked here (budget.sedimentKm3), not taken from the coast a second time. Its own ledger stage, `sedimentSubduction`.

import { trenchFans } from './trench-fans.js';
import { trenchSediment } from './margin-isles.js';
import { creditPrism } from './prism-accretion.js';

/** @returns {number} 0 (the rock is booked; no crust changes) */
export function subductSediment(world, dt) {
    const { plates, config, owner } = world;
    const share = config.sedimentSubductionShare, channel = config.accretionSedimentKm;
    const prism = config.prismAccretion;
    // (sedimentSubductionShare 0: the channels take nothing — but with prismAccretion on, all the fans' rock is still
    // scraped off into the prisms, so the books below run; was: an early return that credited no prism at all, and a
    // scene with this sink off — phase 7c's margins — raised no fore-arc island, crustmass8)
    if (dt <= 0 || !(share > 0 || prism)) return 0;
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
    let km3 = 0, allKm3 = 0, keptKm3 = 0;
    for (const { mouth, cells, weights } of deliveries) {
        let f = 0;
        for (let i = 0; i < cells.length; i++) f += weights[i] * shareAt(cells[i]);
        allKm3 += mouth.km3 * f * dt;               // (all the rivers' rock that goes down, arcs' and islands' too: Earth's figure)
        keptKm3 += mouth.km3 * (1 - f) * dt;        // (…and what stays at the margin: the prism, or a full trench overtopping)
        // (config.prismAccretion: what the channels do not take is the overriding plates' prisms, trench cell by trench cell —
        // the share each takes of the mouth's rock, less what goes down there: step/prism-accretion.js)
        if (prism) for (let i = 0; i < cells.length; i++) creditPrism(world, plates[owner[cells[i]]], mouth.km3 * weights[i] * (1 - shareAt(cells[i])) * dt);
        km3 += mouth.contKm3 * f * dt;
    }
    world.budget.sedimentKm3 = (world.budget.sedimentKm3 ?? 0) + km3;
    world.budget.sedimentAllKm3 = (world.budget.sedimentAllKm3 ?? 0) + allKm3;
    // (the fans' rock that does not go down stays on the margin: scraped into the prism, or, where the trench is full,
    // spread over the incoming plate's floor to come back to the trench later — rock on ocean crust either way, not continental
    // crust. budget.wedgeKm3 is the prism's own estimate (fill above the channel × convergence, step/margin-isles.js): the
    // rest of trenchKeptKm3 is overtopping. fanKm3 = sedimentAllKm3 + trenchKeptKm3, step/trench-fans.js bookFans)
    world.budget.trenchKeptKm3 = (world.budget.trenchKeptKm3 ?? 0) + keptKm3;
    // (the rivers' rock is what the erosion already took off the crust (crust.wornKm, step/surface-erosion.js) — it left the
    // continent's books as it wore, so it is booked here, not taken from the coast again. Lane crust; the coast-eating flux
    // this once ran, config.rockBook false, retired at lane graded)
    return 0;
}
