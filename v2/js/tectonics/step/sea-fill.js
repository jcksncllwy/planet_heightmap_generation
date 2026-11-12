// Enclosed seas fill with sediment (crust-sink branch). A river that reaches the world ocean sends its rock out down its
// fan (step/trench-fans.js); one that runs into a sea the land has closed off — a remnant ocean inside a supercontinent,
// a sea a weld sealed — lays its rock on that sea's floor, and the sea fills: the Precaspian holds ~20 km of sediment,
// the Black Sea 14–19 km (Nikishin et al. 2015), the Gulf of Mexico ~15 km (Salvador 1991). The floor sinks under the
// load, so ~17 km of sediment fills 6 km of water (Airy: measure.js SEDIMENT_LOAD_FACTOR; Steckler & Watts 1978); a sea
// filled to sea level is a lowland basin — to the sea's level as it stands over the mantle's swell (branch unified-swell,
// 2026-10-29: terrain/sea-level.js; a floor the warm mantle holds up fills sooner, one over cooled mantle later, and a
// floor the swell has lifted to the sea is land to the history's rivers as it is to the terrain: rivers.js). Each mouth's rock fills the sea nearest its mouth first — its delta builds
// out, and the sea shrinks from its shores — at the rate its basin wears down (step/rivers.js), so a sea with a catchment
// ~5× its own area fills in ~70 Myr. The fill is a record on the crust (crust.seaFillKm: it moves with its plate): the
// terrain reads it as a shallower floor, and a sea filled to sea level as lowland (terrain/records.js; measure.js
// seaFilledUp). Its crust stays ocean crust: a basin filled on an ocean floor — the Black Sea's, the Gulf of Mexico's —
// is not continental crust (Earth's crustal budget counts it apart), and its sediment is the continents' own rock,
// moved, so the crust ledger does not change: the land it came from is only thinner, which an area ledger does not
// see. Such a floor can still be subducted, or caught in a collision, sediment and all.

import { CrustType, CrustFlag } from '../model/crust.js';
import { BoundaryKind } from '../model/world.js';
import { seaDepthKm, SEDIMENT_LOAD_FACTOR } from '../measure.js';
import { heightsOf } from './heights.js';
import { marginConstants, shelfRoomKm2 } from '../../terrain/margins.js';

/** Sediment builds a delta to the water's surface and its top plain this far above it (km): ~the high-water mark, a
 *  tidal range over mean sea (microtidal coasts < 2 m: Davies 1964) — so a sea filled up is land, not a film of water. */
const DELTA_TOP_KM = 0.001;

/**
 * Lay each enclosed-sea river's rock on its sea's floor (from step/rivers.js, after it drains the land): `mouths` with
 * their sea cell (world), `span` Myr of their basins' rock. Marks each mouth `enclosed` (true: its rock stays in its
 * sea, not down a fan). A sea is enclosed if it is not the world ocean, the largest body of water. `land` and `sea`
 * (the swell under each cell and the sea's level) are the rivers' own, as step/rivers.js reads them.
 */
export function fillEnclosedSeas(world, mouths, span, land, sea) {
    const { mesh, plates, owner, ownerCell, time, config } = world, { adjOffset, adjList, numCells: n } = mesh;
    for (const m of mouths) m.enclosed = false;
    if (!config.enclosedSeaFill || !mouths.length) return;
    const cellArea = 4 * Math.PI * 6371 * 6371 / n, s = scratchFor(n), { comp, stamp } = s;
    // the bodies of water, the largest the world ocean
    comp.fill(-1);
    let ocean = -1, biggest = 0, id = 0;
    const q = s.queue;
    for (let w = 0; w < n; w++) {
        if (land[w] || comp[w] >= 0) continue;
        let len = 1; q[0] = w; comp[w] = id;
        for (let i = 0; i < len; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const nb = adjList[k]; if (!land[nb] && comp[nb] < 0) { comp[nb] = id; q[len++] = nb; } }
        if (len > biggest) { biggest = len; ocean = id; }
        id++;
    }
    // each mouth on an enclosed sea fills it nearest its mouth first, up to the sea's level: the water over the floor —
    // its depth by age, raised by the mantle's swell (from fully cooled mantle: terrain/sea-level.js), under the sea's level
    // against today's datum — filled by SEDIMENT_LOAD_FACTOR times as much sediment (the floor sinks under it: Airy)
        const room = w => {
        const o = owner[w];
        if (o < 0) return 0;
        const crust = plates[o].crust, c = ownerCell[w];
        if (crust.type[c] !== CrustType.OCEAN || (crust.flags[c] & CrustFlag.TRENCH)) return 0;
        const water = seaDepthKm(time - crust.formedAt[c]) - sea.swellKm[w] + sea.seaKm + DELTA_TOP_KM;
        return Math.max(0, SEDIMENT_LOAD_FACTOR * water - crust.seaFillKm[c]);
    };
    let mark = s.mark;
    for (const m of mouths) {
        if (m.sea < 0 || comp[m.sea] < 0 || comp[m.sea] === ocean) continue;
        m.enclosed = true;
        let km3 = m.km3 * span, len = 1;
        q[0] = m.sea; stamp[m.sea] = ++mark;
        for (let i = 0; i < len && km3 > 0; i++) {
            const w = q[i], r = room(w);
            if (r > 0) { const km = Math.min(r, km3 / cellArea); plates[owner[w]].crust.seaFillKm[ownerCell[w]] += km; km3 -= km * cellArea; }
            for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) { const nb = adjList[k]; if (!land[nb] && stamp[nb] !== mark) { stamp[nb] = mark; q[len++] = nb; } }
        }
        world.budget.seaFillKm3 = (world.budget.seaFillKm3 ?? 0) + m.km3 * span - Math.max(0, km3);
        world.budget.seaOverflowKm3 = (world.budget.seaOverflowKm3 ?? 0) + Math.max(0, km3);   // (a sea filled to its level: the rest)
    }
    s.mark = mark;
}

// ── A passive margin keeps its rivers' rock, as far as it has room (lane lowland, 2026-10-31) ── A river on an open coast
// builds a shelf before anything goes down a fan: the wedge sits on the crust the rift thinned, and the room for it is that
// crust's subsidence, which the margin's cooling goes on making (McKenzie 1978; terrain/margins.js, which draws the prism
// and owns the sum: shelfRoomKm2). So what a margin holds is limited by accommodation, not by a share of the flux: the rock
// fills the coast nearest the mouth first, along the shore, and what the margin has no room for carries on down its fan
// (step/trench-fans.js) or out to the rise. A big river builds a wide shelf and a coast without one stays narrow.
// Limits (reduced physics): the rock is a total per coast cell, not a wedge on the mesh (the prism's shape is the analytic
// one in margins.js); longshore drift is a reach, not a current; the rock is never reworked at a lowstand; a margin's kind is
// the frame's own reading (classifyMargins), not its leading or trailing side; and the supply
// inherits trenchDenudationKmPerMyr, ~2× Earth's flux (terrain-config.js denudationKmPerMyr has the sourced 0.05).
/** How far along its coast a river's rock is carried (km): the Amazon's mud runs ~1500 km along the Guianas (recalled). */
const SHELF_ALONG_KM = 1500;

/**
 * Lay each open-coast river's rock on its own passive margin (from step/rivers.js, after fillEnclosedSeas): nearest the
 * mouth first, each coast cell up to the room its margin's age gives it (crust.shelfKm3), and take it off the mouth, so
 * only the surplus reaches a fan. `span` Myr of rock; rates in km³/Myr, as `mouths` carry them.
 */
export function buildShelves(world, mouths, span, land) {
    const { mesh, plates, owner, ownerCell, time, config } = world, { adjOffset, adjList, edgeKm, numCells: n } = mesh;
    if (!mouths.length) return;
    const H = heightsOf(config), C = marginConstants(H), s = scratchFor(n), { stamp, queue: q } = s, reach = Math.max(1, Math.round(SHELF_ALONG_KM / edgeKm));
    const continental = t => t === CrustType.CONTINENT || t === CrustType.CRATON;
    const seaBeside = w => { for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) if (!land[adjList[k]]) return adjList[k]; return -1; };
    // (is this coast passive? As tectonics/measure.js classifyMargins reads a frame: out to sea over its own plate, the first
    // boundary met within marginReachKm — a trench or a transform or a collision is not; a ridge, a lower plate's edge or
    // nothing is. Asked of few cells, so walked from each and kept for this drainage: 1 passive, 2 not)
    const kinds = s.kinds, hops = Math.max(1, Math.round(config.marginReachKm / edgeKm)), seen = s.seen;
    kinds.fill(0);
    const passive = (w0, plate) => {
        if (kinds[w0]) return kinds[w0] === 1;
        let tick = ++s.tick, ring = [w0], kind = 1;
        seen[w0] = tick;
        walk: for (let hop = 0; hop <= hops && ring.length; hop++) {
            const next = [];
            for (const c of ring) {
                const b = world.boundaryKind[c], k = plates[plate].crust, cc = ownerCell[c];
                if (b === BoundaryKind.OVERRIDING || b === BoundaryKind.TRANSFORM || b === BoundaryKind.COLLISION || (owner[c] === plate && k.type[cc] === CrustType.OCEAN && (k.flags[cc] & CrustFlag.TRENCH))) { kind = 2; break walk; }
                if (b === BoundaryKind.RIDGE || b === BoundaryKind.SUBDUCTING) break walk;
                for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) {
                    const nb = adjList[j];
                    if (seen[nb] === tick || owner[nb] !== plate || (land[nb] && hop > 0)) continue;
                    seen[nb] = tick; next.push(nb);
                }
            }
            ring = next;
        }
        kinds[w0] = kind;
        return kind === 1;
    };
    let mark = s.mark;
    for (const m of mouths) {
        if (m.enclosed || !(m.km3 > 0) || owner[m.world] !== m.plate) continue;
        const crust = plates[m.plate].crust;
        if (!continental(crust.type[m.cell])) continue;
        const start = m.world, total = m.km3 * span;
        if (seaBeside(start) < 0 || !passive(start, m.plate)) continue;
        let km3 = total, len = 1, hop = 0, ringEnd = 1;
        q[0] = start; stamp[start] = ++mark;
        for (let i = 0; i < len && km3 > 0; i++) {
            if (i === ringEnd) { if (++hop > reach) break; ringEnd = len; }
            const w = q[i], c = ownerCell[w], sea = seaBeside(w);
            const floorOwn = owner[sea] === m.plate && crust.type[ownerCell[sea]] === CrustType.OCEAN && crust.formedAt[ownerCell[sea]] >= 0;
            if (floorOwn && passive(w, m.plate)) {
                // (the room on this cell's length of coast, in rock: margins.js works in sediment, compacted: riftSedRho)
                const age = Math.max(0, time - crust.formedAt[ownerCell[sea]]), room = shelfRoomKm2(C, H.marginThinKm, 1 - Math.exp(-age / H.marginMatureMyr)) * edgeKm * (H.riftSedRho / H.riftCrustRho);
                const take = Math.min(km3, Math.max(0, room - crust.shelfKm3[c]));
                if (take > 0) { crust.shelfKm3[c] += take; km3 -= take; }
            }
            for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
                const nb = adjList[k];
                if (stamp[nb] !== mark && land[nb] && owner[nb] === m.plate && continental(crust.type[ownerCell[nb]]) && seaBeside(nb) >= 0) { stamp[nb] = mark; q[len++] = nb; }
            }
        }
        if (km3 < total) {
            const keep = km3 / total;
            world.budget.shelfKm3 = (world.budget.shelfKm3 ?? 0) + total - km3;
            m.km3 *= keep; m.contKm3 *= keep;
        }
    }
    s.mark = mark;
}

let scratch = null;
function scratchFor(n) {
    if (scratch?.n === n) return scratch;
    scratch = { n, comp: new Int32Array(n), stamp: new Int32Array(n), queue: new Int32Array(n), mark: 0, kinds: new Uint8Array(n), seen: new Int32Array(n), tick: 0 };
    return scratch;
}
