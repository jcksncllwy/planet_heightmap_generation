// The accretionary prism as continental crust (lane crustmass S2, config.prismAccretion; Jackson's ruling 3: the prism
// counts as continental crust). At a trench the downgoing plate drags only the base of its sediment down the subduction
// channel — about accretionSedimentKm of it — and scrapes the rest off against the upper plate (Clift & Vannucchi 2004;
// the channel: Cloos & Shreve 1988; the law in step/floor-rock.js and step/sediment-subduction.js). Until S2 that scraped
// rock was a book only (riseKeptKm3, seaFillKeptKm3, trenchKeptKm3): ~0.4–1 Gkm³ a 1200 Myr cycle left the world.
// On Earth it builds the upper plate's fore-arc out toward its trench, and in time becomes continental crust: the Makran,
// the Olympics of Cascadia, Alaska's Chugach and Kodiak, the Shimanto belt of Japan grew so; accretionary orogens add
// crust at their trench edge (Cawood et al. 2009; von Huene & Scholl 1991). Here:
//   · every km³ kept at a trench is credited to the plate overriding it there, as `plate.prismKm3` (creditPrism) — the
//     rise and sea fill on floor that goes down (step/resolve.js → step/floor-rock.js) and the fans' rock the channel
//     does not take (step/sediment-subduction.js). One prism per upper plate: its fore-arc islands rise out of it first
//     (step/margin-isles.js, wedgeConservation), and a plate welded onto another hands it over (ops/merge-plates.js);
//   · each slow step a plate lays its prism on its own fore-arc: the sea beside its land (continent, craton or arc)
//     between its coast and its trench, nearest the trench first, but never within marginIsleGapKm of it (the trench and
//     its slope stay sea), becomes continent — area at the plate's active free edge, the mirror of the passive margin's
//     O2. A cell costs its rock as continent less the ocean crust it stands on (oceanCrustKm: the prism is built on the
//     fore-arc's own floor, which it keeps as its base — margin-isles.js charges its islands the same);
//   · where the fore-arc is full (the land at the gap already), the prism thickens the land within marginIsleReachKm of
//     the trench instead — underplating and the prism's own stacking (rootKm, evenly over those cells): the rock is kept,
//     none made or lost. A plate with no trench of its own holds its prism until it has one again.
// Books (rock-book.js, the stage 'prismAccretion'): prismAccretedKm3, every cell's rock after less before; prismInKm3
// what was credited; the sheet holds the rest as the prism reservoir (Σ prismKm3 over the living plates).
// Limits (reduced physics): the prism is one number per plate, not a wedge along each trench — the rock scraped off one
// trench may be laid by another trench of the same plate; no taper (Davis, Suppe & Dahlen 1983) bounds how far out it
// builds or how thick it stacks; its rock is laid in steps of a whole cell; a fore-arc's erosion (subduction erosion,
// off until S5 — ruling 6) does not draw it down.

import { CrustType, CrustFlag } from '../model/crust.js';
import { hopsFrom } from '../../core/mesh-bfs.js';
import { bookRock } from '../rock-book.js';
import { cellRockKm3 } from './crust-ledger.js';

/** Credit `km3` of scraped-off trench rock to plate `over`'s prism (config.prismAccretion; the background ocean has no
 * fore-arc, so what it overrides stays a book of rock kept). */
export function creditPrism(world, over, km3) {
    if (!world.config.prismAccretion || !over || over.isBackground || !(km3 > 0)) return;
    over.prismKm3 = (over.prismKm3 ?? 0) + km3;
    world.budget.prismInKm3 = (world.budget.prismInKm3 ?? 0) + km3;
}

/** A plate welded onto another hands its prism over (ops/merge-plates.js). */
export function handOverPrism(from, to) {
    if (!(from.prismKm3 > 0)) return;
    to.prismKm3 = (to.prismKm3 ?? 0) + from.prismKm3;
    from.prismKm3 = 0;
}

/** Σ the prisms the living plates hold (km³; the balance sheet's reservoir). */
export function prismHeldKm3(world) {
    let v = 0;
    for (const p of world.plates) if (p.alive && p.prismKm3 > 0) v += p.prismKm3;
    return v;
}

/** @returns {number} cells of continent the prisms laid this step */
export function accretePrisms(world) {
    const { mesh, plates, config, time } = world, { adjOffset, adjList, edgeKm, cellAreaKm2: A, numCells: n } = mesh;
    if (!config.prismAccretion) return 0;
    const reachHops = Math.max(1, Math.round(config.marginIsleReachKm / edgeKm)), gapHops = Math.max(1, Math.round(config.marginIsleGapKm / edgeKm));
    const basement = config.oceanCrustKm * A;
    let laid = 0, accreted = 0;
    for (const plate of plates) {
        if (!plate.alive || plate.isBackground || !(plate.prismKm3 > 0)) continue;
        const crust = plate.crust, { mask, type, flags } = crust;
        const trench = [];
        for (let c = 0; c < n; c++) if (mask[c] && type[c] === CrustType.OCEAN && (flags[c] & CrustFlag.TRENCH)) trench.push(c);
        if (!trench.length) continue;                             // (no trench: the prism waits)
        const trenchD = hopsFrom(mesh, trench, c => mask[c] === 1, reachHops + 1).dist;
        const isLand = c => type[c] !== CrustType.OCEAN;
        // the fore-arc sea: own ocean, off the trench and its gap, within reach, beside the plate's land — nearest the trench first
        const sea = [];
        for (let c = 0; c < n; c++) {
            if (!mask[c] || type[c] !== CrustType.OCEAN || (flags[c] & CrustFlag.TRENCH) || trenchD[c] < gapHops || trenchD[c] > reachHops) continue;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (mask[nb] && isLand(nb)) { sea.push(c); break; } }
        }
        sea.sort((a, b) => trenchD[a] - trenchD[b] || a - b);
        let full = true, here = 0;
        for (const c of sea) {
            const before = cellRockKm3(world, crust, c), was = [type[c], crust.formedAt[c], crust.terrane[c], flags[c]];
            type[c] = CrustType.CONTINENT; crust.formedAt[c] = time;
            crust.terrane[c] = plate.prismTerrane ??= world.nextTerraneId();
            flags[c] &= ~CrustFlag.APRON;
            const made = cellRockKm3(world, crust, c) - before, cost = made - basement;
            if (cost > plate.prismKm3) { [type[c], crust.formedAt[c], crust.terrane[c], flags[c]] = was; full = false; break; }   // (the rest waits for more rock)
            plate.prismKm3 -= Math.max(0, cost); accreted += made; here++;
        }
        if (full && plate.prismKm3 > 0) {
            // the fore-arc is land to its gap: the prism stacks and underplates the land within reach of the trench instead
            const land = [];
            for (let c = 0; c < n; c++) if (mask[c] && isLand(c) && trenchD[c] >= 0 && trenchD[c] <= reachHops) land.push(c);
            if (land.length) {
                const km = plate.prismKm3 / (land.length * A);
                for (const c of land) crust.rootKm[c] += km;
                accreted += plate.prismKm3; plate.prismKm3 = 0;
            }
        }
        if (here) { plate.dirty = true; laid += here; }
    }
    if (accreted) bookRock('prismAccretedKm3', accreted);
    return laid;
}
