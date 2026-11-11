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
//     does not take (step/sediment-subduction.js). One prism per upper plate, laid here and nowhere else; a plate welded
//     onto another hands it over (ops/merge-plates.js);
//   · each slow step a plate lays its prism on its own fore-arc FROM THE TRENCH SIDE IN, as fore-arc islands (ARC cells
//     flagged MARGIN_ISLE: step/margin-isles.js's kind). On Earth a prism emerges first at the wedge's crest — the
//     outer-arc high, marginIsleGapKm off its trench — as a chain of islands (Mentawai, Nias, Barbados, Kodiak; Karig &
//     Sharman 1975; Dickinson & Seely 1979), with a fore-arc basin behind it, and only later welds landward. So the
//     fore-arc sea (margin-isles' fore-arc: off the gap, between the coast and an accretionary trench) is laid ring by
//     ring from the trench — nearest it first, and along a ring the stretch whose trench is fed fastest first (its
//     convergence times the fill its subduction channel cannot take: where the wedge grows) — until the rock runs out.
//     An island is built to a continent's thickness (arcKm = riftCrustKm), so it costs that rock less the ocean crust
//     it stands on (oceanCrustKm: the fore-arc's own floor, its base), and joining the coast (margin-isles.js
//     mergeIntoMainland) changes its rock by nothing. This is the ONE place prism rock becomes cells: with prismAccretion
//     on, margin-isles raises no islands of its own (was: margin-isles drew islands from the prism at its own rates, but
//     ran before this stage, which laid the whole prism beside the coast each step and left it under a cell's worth — so
//     no island ever rose: phase 7c, crustmass8);
//   · where the fore-arc is full (laid to the coast), the prism thickens the land within marginIsleReachKm of the trench
//     instead — underplating and the prism's own stacking (rootKm, evenly over those cells): the rock is kept, none made
//     or lost. A plate with no accretionary margin of its own holds its prism until it has one again.
// Books (rock-book.js, the stage 'prismAccretion'): prismAccretedKm3, every cell's rock after less before; prismInKm3
// what was credited; the sheet holds the rest as the prism reservoir (Σ prismKm3 over the living plates).
// Limits (reduced physics): the prism is one number per plate, not a wedge along each trench — the rock scraped off one
// trench may be laid by another trench of the same plate; no taper (Davis, Suppe & Dahlen 1983) bounds how far out it
// builds or how thick it stacks; its rock is laid in steps of a whole cell, and an island stands at a continent's
// thickness from the step it is laid (the wedge's slow rise from the sea floor is not followed); a fore-arc's erosion (subduction erosion,
// off until S5 — ruling 6) does not draw it down.

import { CrustType, CrustFlag } from '../model/crust.js';
import { hopsFrom } from '../../core/mesh-bfs.js';
import { bookRock } from '../rock-book.js';
import { cellRockKm3 } from './crust-ledger.js';
import { marginTrenches } from './margin-isles.js';
import { heightsOf } from './heights.js';

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

/** @returns {number} cells of fore-arc island the prisms laid this step */
export function accretePrisms(world) {
    const { mesh, plates, config, time } = world, { adjOffset, adjList, edgeKm, cellAreaKm2: A, numCells: n } = mesh;
    if (!config.prismAccretion) return 0;
    const reachHops = Math.max(1, Math.round(config.marginIsleReachKm / edgeKm)), gapHops = Math.max(1, Math.round(config.marginIsleGapKm / edgeKm));
    const basement = config.oceanCrustKm * A, islandKm = heightsOf(config).riftCrustKm;
    let laid = 0, accreted = 0;
    for (const plate of plates) {
        if (!plate.alive || plate.isBackground || !(plate.prismKm3 > 0)) continue;
        const crust = plate.crust, { mask, type, flags } = crust;
        // its active continental margins (margin-isles.js marginTrenches: the trench cells with the plate's land within
        // reach, their convergence and fill; margin-isles has flagged the erosive ones this step) — an erosive stretch
        // builds no fore-arc: its trench eats it
        const m = marginTrenches(world, plate);
        if (!m || !m.cells.length) continue;                      // (no continental margin: the prism waits)
        const feed = new Float32Array(n);                          // (each trench cell's wedge growth, km³/Myr per km: v × the fill it keeps)
        for (let i = 0; i < m.cells.length; i++) feed[m.cells[i]] = m.conv[i] * Math.max(0, m.terrKm[i] + m.pelKm[i] - config.accretionSedimentKm);
        const onPlate = c => mask[c] === 1, { dist: trenchD, source } = hopsFrom(mesh, m.cells, onPlate, reachHops + 1), landD = m.landD;
        // the fore-arc sea (margin-isles' own): off the trench and its gap, between the coast and an accretionary trench
        const sea = [];
        for (let c = 0; c < n; c++) {
            if (!mask[c] || type[c] !== CrustType.OCEAN || (flags[c] & CrustFlag.TRENCH) || trenchD[c] < gapHops || landD[c] < 1 || landD[c] + trenchD[c] > reachHops + 1) continue;
            if (flags[source[c]] & CrustFlag.EROSIVE) continue;
            let edge = false;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (!mask[adjList[k]]) { edge = true; break; }
            if (!edge) sea.push(c);
        }
        // from the trench side in: the crest ring first, along it the best-fed stretch first
        sea.sort((a, b) => trenchD[a] - trenchD[b] || feed[source[b]] - feed[source[a]] || a - b);
        let full = true, here = 0;
        for (const c of sea) {
            const before = cellRockKm3(world, crust, c), was = [type[c], crust.formedAt[c], crust.terrane[c], flags[c], crust.arcKm[c]];
            type[c] = CrustType.ARC; crust.formedAt[c] = time; crust.arcKm[c] = islandKm;
            crust.terrane[c] = plate.marginIsleTerrane ??= world.nextTerraneId();
            flags[c] = (flags[c] & ~CrustFlag.APRON) | CrustFlag.MARGIN_ISLE;
            const made = cellRockKm3(world, crust, c) - before, cost = made - basement;
            if (cost > plate.prismKm3) { [type[c], crust.formedAt[c], crust.terrane[c], flags[c], crust.arcKm[c]] = was; full = false; break; }   // (the rest waits for more rock)
            plate.prismKm3 -= Math.max(0, cost); accreted += made; here++;
        }
        if (full && plate.prismKm3 > 0) {
            // the fore-arc is laid to the coast: the prism stacks and underplates the land within reach of the trench instead
            // (continent and craton: an island still standing keeps only ARC_ROOT_SHARE of a root when it joins the coast)
            const land = [];
            for (let c = 0; c < n; c++) if (mask[c] && (type[c] === CrustType.CONTINENT || type[c] === CrustType.CRATON) && trenchD[c] >= 0 && trenchD[c] <= reachHops) land.push(c);
            if (land.length) {
                const km = plate.prismKm3 / (land.length * A);
                for (const c of land) crust.rootKm[c] += km;
                accreted += plate.prismKm3; plate.prismKm3 = 0;
            }
        }
        if (here) { plate.dirty = true; laid += here; world.budget.isleRaisedCells = (world.budget.isleRaisedCells ?? 0) + here; }
    }
    if (accreted) bookRock('prismAccretedKm3', accreted);
    return laid;
}
