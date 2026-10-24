// Enclosed seas fill with sediment (crust-sink branch). A river that reaches the world ocean sends its rock out down its
// fan (step/trench-fans.js); one that runs into a sea the land has closed off — a remnant ocean inside a supercontinent,
// a sea a weld sealed — lays its rock on that sea's floor, and the sea fills: the Precaspian holds ~20 km of sediment,
// the Black Sea 14–19 km (Nikishin et al. 2015), the Gulf of Mexico ~15 km (Salvador 1991). The floor sinks under the
// load, so ~17 km of sediment fills 6 km of water (Airy: measure.js SEDIMENT_LOAD_FACTOR; Steckler & Watts 1978); a sea
// filled to sea level is a lowland basin. Each mouth's rock fills the sea nearest its mouth first — its delta builds
// out, and the sea shrinks from its shores — at the rate its basin wears down (step/rivers.js), so a sea with a catchment
// ~5× its own area fills in ~70 Myr. The fill is a record on the crust (crust.seaFillKm: it moves with its plate): the
// terrain reads it as a shallower floor, and a sea filled to sea level as lowland (terrain/records.js; measure.js
// seaFilledUp). Its crust stays ocean crust: a basin filled on an ocean floor — the Black Sea's, the Gulf of Mexico's —
// is not continental crust (Earth's crustal budget counts it apart), and its sediment is the continents' own rock,
// moved, so the crust ledger does not change: the land it came from is only thinner, which an area ledger does not
// see. Such a floor can still be subducted, or caught in a collision, sediment and all.

import { CrustType, CrustFlag } from '../model/crust.js';
import { seaDepthKm, SEDIMENT_LOAD_FACTOR } from '../measure.js';

/**
 * Lay each enclosed-sea river's rock on its sea's floor (from step/rivers.js, after it drains the land): `mouths` with
 * their sea cell (world), `span` Myr of their basins' rock. Marks each mouth `enclosed` (true: its rock stays in its
 * sea, not down a fan). A sea is enclosed if it is not the world ocean, the largest body of water.
 */
export function fillEnclosedSeas(world, mouths, span, land) {
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
    // each mouth on an enclosed sea fills it nearest its mouth first
    const room = w => {
        const o = owner[w];
        if (o < 0) return 0;
        const crust = plates[o].crust, c = ownerCell[w];
        if (crust.type[c] !== CrustType.OCEAN || (crust.flags[c] & CrustFlag.TRENCH)) return 0;
        return Math.max(0, SEDIMENT_LOAD_FACTOR * seaDepthKm(time - crust.formedAt[c]) - crust.seaFillKm[c]);
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
    }
    s.mark = mark;
}

let scratch = null;
function scratchFor(n) {
    if (scratch?.n === n) return scratch;
    scratch = { n, comp: new Int32Array(n), stamp: new Int32Array(n), queue: new Int32Array(n), mark: 0 };
    return scratch;
}
