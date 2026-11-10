// The world ocean, and the seas cut off from it. Water below sea level is the sea only where it is joined to the world
// ocean — the largest body of water, which on Earth holds 97 % of it and is all one (the Pacific, Atlantic, Indian,
// Southern and Arctic oceans join round Antarctica and through the Bering and Fram straits). A body below sea level that
// does not join it is a sea cut off: its surface is set by its own water balance, not by sea level — the rain on its
// catchment against what evaporates off its water (the Caspian at −28 m, the Dead Sea at −430 m; the Mediterranean drawn
// down 1.5–3 km when the Atlantic was cut off in the Messinian, Hsü et al. 1973; Ryan 2009). A timeline frame has no
// climate to balance it with (the finish has: finish-basins.js), so basin-estimate.js balances it on the zonal climate
// and its views draw it as a lake at that level, or as a dry hollow at its true depth — and lower the world ocean by the
// water it holds, which is the ocean's (the history pours all of it there and holds every hollow behind a sill empty).

/**
 * The history's water rules where it is given (history: land-mask.js pouredSeaOnto — per terrain cell, whether the history
 * pours the ocean onto it, tectonics/ocean/inventory.js pourOcean, and the water it stands there). The view's surface
 * (synthesize.js) is not the history's ground: at a seaway closing at sea level it can stand tens of metres higher
 * (831576 at 290 Myr: the history's sill at its sea level to the metre, the view's +44 m) and cut off an ocean the history
 * fills (34 Mkm², ~130 Mkm³) — which the view then dried on the zonal climate, the water lost from its books (−9 % of V).
 * So each body below sea level carries the water the history pours onto its cells (pouredKm3), and a body the history
 * fills — that water ≥ FILLED of its room below sea level — is the world ocean too. One the history pours less into (a
 * basin part-filled over a sill the level holds at: pourOcean) stays apart, and basin-estimate.js stands that water in it;
 * one it pours none into is cut off and balanced. Only at the frame's own sea level (0): the history poured at it; a
 * view's other sea level asks the ground alone.
 * @param {Object} mesh   adjOffset, adjList, numCells
 * @param {Float32Array} z  heights (km)
 * @param {number} seaLevelKm
 * @param {{sea: Uint8Array, waterKm: Float32Array}} [history]  the history's poured sea per cell (land-mask.js pouredSeaOnto)
 * @returns {{ocean: Uint8Array, cut: Uint8Array, bodies: {first: number, cells: number}[], oceanCells: number}}
 *   ocean: 1 on the world ocean; cut: 1 below sea level but cut off from it; bodies: every body below sea level, the
 *   world ocean first (its first cell, its size in cells — the bodies the history fills counted in — and, given the
 *   history, pouredKm3: the water it pours onto the body's cells)
 */
export function worldOcean(mesh, z, seaLevelKm = 0, history = null) {
    const { adjOffset, adjList, numCells: n } = mesh, s = scratchOf(n), { comp, queue } = s;
    comp.fill(-1);
    const bodies = [];
    let best = -1;
    for (let c = 0; c < n; c++) {
        if (!(z[c] < seaLevelKm) || comp[c] >= 0) continue;
        const id = bodies.length;
        let len = 1;
        queue[0] = c; comp[c] = id;
        for (let i = 0; i < len; i++) for (let k = adjOffset[queue[i]]; k < adjOffset[queue[i] + 1]; k++) { const nb = adjList[k]; if (comp[nb] < 0 && z[nb] < seaLevelKm) { comp[nb] = id; queue[len++] = nb; } }
        bodies.push({ first: c, cells: len, id });
        if (best < 0 || len > bodies[best].cells) best = id;
    }
    // (the bodies the history fills: its water on their cells against their room below sea level)
    const joined = new Uint8Array(bodies.length);
    if (best >= 0) joined[best] = 1;
    if (history && seaLevelKm === 0 && best >= 0) {
        const room = new Float64Array(bodies.length), poured = new Float64Array(bodies.length), cellKm2 = 4 * Math.PI * R * R / n;
        for (let c = 0; c < n; c++) { const b = comp[c]; if (b < 0) continue; room[b] += seaLevelKm - z[c]; if (history.sea[c]) poured[b] += history.waterKm[c]; }
        for (let b = 0; b < bodies.length; b++) {
            bodies[b].pouredKm3 = poured[b] * cellKm2;
            if (poured[b] >= FILLED * room[b]) joined[b] = 1;
        }
    }
    const ocean = new Uint8Array(n), cut = new Uint8Array(n);
    for (let c = 0; c < n; c++) { const b = comp[c]; if (b < 0) continue; if (joined[b]) ocean[c] = 1; else cut[c] = 1; }
    // (the world ocean first — the largest, with every body joined to it counted in — then the bodies cut off)
    const kept = [];
    let oceanCells = 0;
    for (const b of bodies) if (joined[b.id]) oceanCells += b.cells; else kept.push(b);
    if (best >= 0) kept.unshift({ ...bodies[best], cells: oceanCells });
    return { ocean, cut, bodies: kept, oceanCells };
}

const R = 6371;
/**
 * The share of a body's room below sea level the history's water must fill for the body to be the world ocean. Measured
 * (2026-11-10, 160K cells, every 20 Myr of four histories — 831576 at 41 % continent, 626225, 777, 12345 at 30 %): the
 * view's surface against the history's ground, as the history's water over the view's room — the world ocean's 0.975–1.007
 * (5th–95th percentile; least 0.877), a body the history fills 0.953–1.22, one it part-fills 0.81 at most (the basin
 * filling over its sill: 0.13–0.81). 0.90 lies in the gap; 0.95 would cut the filled bodies' low edge (831576 at 290 Myr:
 * 0.949).
 */
export const FILLED = 0.9;

// (scratch per mesh size: a timeline repaints often)
let scratch = null;
function scratchOf(n) {
    if (!scratch || scratch.comp.length !== n) scratch = { comp: new Int32Array(n), queue: new Int32Array(n) };
    return scratch;
}
