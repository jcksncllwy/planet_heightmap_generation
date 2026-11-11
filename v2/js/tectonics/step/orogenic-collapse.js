// Orogenic collapse at the free edge (lane beltthick; config.orogenicCollapse, on): a thickened belt that has gone quiet
// spreads, and where it stands on its own coast it spreads over the sea beside it, making continent. Shortening takes area
// (step/andean-shortening.js, a collision's consumed crust: collision.js keepConsumed) and keeps the volume as root; on Earth
// the area comes back once the push that held the root up stops: the thick, hot crust flows out under its own weight and the
// upper crust extends over it (Dewey 1988, Tectonics 7 "Extensional collapse of orogens"). Earth's rates: western North
// America after the Laramide/Sevier, ~1.9 Mkm² extended since ~30 Ma (Henry & Aranda-Gomez 1992, Geology 20) by 50 % (north)
// to 200 % (central Basin and Range: McQuarrie & Wernicke 2005, Geosphere 1), so ~0.6–1 Mkm² of area made, ~0.02–0.03 Mkm²/Myr;
// the Aegean behind the Hellenides, up to ~600 km of trench retreat since ~45 Ma over a ~600 km front (Jolivet & Brun 2010,
// Int. J. Earth Sci. 99; Jolivet et al. 2013, Tectonophysics 597), ~0.008 Mkm²/Myr: together ~0.03–0.04 Mkm²/Myr, the order
// of the shortening it gives back (the Central Andes' ~300–350 km since ~45 Ma along ~1500 km and ~100 km elsewhere, with the Cordillera's: ~0.025–0.035 Mkm²/Myr). Over Earth's
// supercontinent cycle continental area holds within ~10 % (freeboard: Wise 1974; Galer 1991), which a shortening with no
// collapse to return its area cannot give.
//
// The law is crust-flow.js's own, carried across the coast: there the channel (K = ρc g h_ch³ ÷ 12η, its geotherm and lag)
// moves crust down the ground's slope within a plate's continent; at a post-active belt's coast (collapseSource: a shortening
// belt quiet for orogenyQuietMyr; never a craton, a rift or an arc) each sea face is a sink of conductance coef × K toward the
// ground an ordinary continent stands at (C.ref: a root of 0). So only root spreads: a belt that has spent its root makes no
// more area, and an ordinary continent's own crust never thins through this (the runaway the crust-only strain law had,
// crustmass S4, needs crust BELOW the reference to keep spreading; this has none). The volume that crossed is owed, as
// area = volume ÷ the crust it spreads at (an ordinary continent's, C.crust[CONTINENT]), to this stage, which takes it from
// the sources' roots and lays one ordinary continental cell per crust's worth on the most-fed sea face. No new parameter.
//
// Limits (a reduced model): the new crust is made at the coast, not where the belt extends inside (a rigid raster can only add
// cells at the edge — the Basin and Range's widening shows here as the coast moving out by the same area); no metamorphic
// core complexes, no detachments, no extension-driven magmatism; the owed volume is taken from the sources when the cell is
// made (a step later), not as it flows; a collapse onto a trench's apron is not separated from one onto a passive margin.

import { CrustType, CrustFlag } from '../model/crust.js';
import { columnModel } from '../measure.js';
import { heightsOf } from './heights.js';
import { cellRockKm3 } from './crust-ledger.js';
import { bookRock } from '../rock-book.js';
import { collapseSource } from './crust-flow.js';

/** @returns {number} continental cells made this step by collapse at the free edge */
export function collapseOrogens(world) {
    const { plates, config, time, mesh } = world;
    if (!config.orogenicCollapse) return 0;
    const C = columnModel(heightsOf(config)), h0 = C.crust[CrustType.CONTINENT];
    let made = 0;
    for (const plate of plates) {
        const faces = plate.collapseFaces, due = plate.collapseDue ?? 0, owing = plate.collapseSrc;
        plate.collapseFaces = plate.collapseSrc = null;
        if (!plate.alive || !faces?.size) { plate.collapseDue = 0; continue; }
        const crust = plate.crust, { mask, type, rootKm, oroType, terrane, formedAt } = crust;
        // the nearest faces first (B2: a belt's inland outflow makes its area at the plate's nearest coast), then the most fed (ties by index: deterministic); each source's root, the most-fed source first
        const order = [...faces.entries()].sort((a, b) => a[1].hops - b[1].hops || b[1].km - a[1].km || a[0] - b[0]);
        const sources = [...new Set([...order.map(e => e[1].src), ...(owing ?? [])])];       // (then every cell that owed, by index)
        let want = Math.floor(due), n = 0, rock = 0;
        for (const [c, f] of order) {
            if (n >= want) break;
            if (!mask[c] || type[c] !== CrustType.OCEAN) continue;
            // h0 of root, from this face's source first, then the plate's other collapsing sources
            let have = 0;
            const take = [];
            for (const s of [f.src, ...sources]) {
                if (have >= h0) break;
                // (still a quiet belt: a record that restarted, or a cell rifted since the heights step, gives nothing)
                if (!mask[s] || type[s] !== CrustType.CONTINENT || take.some(t => t[0] === s) || !collapseSource(oroType[s], time - crust.oroLast[s], config)) continue;
                const k = Math.min(Math.max(0, rootKm[s]), h0 - have);
                if (k > 0) { take.push([s, k]); have += k; }
            }
            if (have < h0 - 1e-9) break;                                     // (the belts' root is spent: no more area)
            rock -= cellRockKm3(world, crust, c);
            for (const [s, k] of take) { rock -= cellRockKm3(world, crust, s); rootKm[s] -= k; rock += cellRockKm3(world, crust, s); }
            // the sea's own sediment stays where it lay (now on land): the cell is remade around it
            const keep = crust.fields.map(a => a[c]);
            const F = crust.fields, keepIdx = ['basinFillKm', 'seaFillKm', 'shelfKm3', 'riseKm3', 'wornKm'].map(name => F.indexOf(crust[name]));
            crust.create(c, CrustType.CONTINENT, time, terrane[f.src]);
            for (const i of keepIdx) if (i >= 0) F[i][c] = keep[i];
            rock += cellRockKm3(world, crust, c);
            n++;
            const kind = oroType[f.src];
            (world.budget.collapseCellsByKind ??= {})[kind] = (world.budget.collapseCellsByKind[kind] ?? 0) + 1;
        }
        // (an owed fraction carries while the belt keeps spreading; what found no face or no root is forgotten — its rock never left)
        plate.collapseDue = n ? Math.min(due - n, 1) : Math.min(due, 1);
        if (!n) continue;
        made += n;
        world.budget.collapseCells = (world.budget.collapseCells ?? 0) + n;
        world.budget.collapseMadeKm3 = (world.budget.collapseMadeKm3 ?? 0) + n * h0 * mesh.cellAreaKm2;
        bookRock('collapseNetKm3', rock);                                   // (≈ 0: root moved into a new cell; the float's last digits)
        plate.markReshaped();
        plate.dirty = true;
    }
    return made;
}
