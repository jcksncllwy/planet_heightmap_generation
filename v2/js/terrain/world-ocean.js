// The world ocean, and the seas cut off from it. Water below sea level is the sea only where it is joined to the world
// ocean — the largest body of water, which on Earth holds 97 % of it and is all one (the Pacific, Atlantic, Indian,
// Southern and Arctic oceans join round Antarctica and through the Bering and Fram straits). A body below sea level that
// does not join it is a sea cut off: its surface is set by its own water balance, not by sea level — the rain on its
// catchment against what evaporates off its water (the Caspian at −28 m, the Dead Sea at −430 m; the Mediterranean drawn
// down 1.5–3 km when the Atlantic was cut off in the Messinian, Hsü et al. 1973; Ryan 2009). A timeline frame has no
// climate to balance it with (the finish has: finish-basins.js), so its views draw such a sea apart from the ocean.

/**
 * @param {Object} mesh   adjOffset, adjList, numCells
 * @param {Float32Array} z  heights (km)
 * @param {number} seaLevelKm
 * @returns {{ocean: Uint8Array, cut: Uint8Array, bodies: {first: number, cells: number}[], oceanCells: number}}
 *   ocean: 1 on the world ocean; cut: 1 below sea level but cut off from it; bodies: every body below sea level, the
 *   world ocean first (its first cell and its size in cells)
 */
export function worldOcean(mesh, z, seaLevelKm = 0) {
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
    const ocean = new Uint8Array(n), cut = new Uint8Array(n);
    for (let c = 0; c < n; c++) { const b = comp[c]; if (b < 0) continue; if (b === best) ocean[c] = 1; else cut[c] = 1; }
    if (best > 0) { const [o] = bodies.splice(best, 1); bodies.unshift(o); }
    return { ocean, cut, bodies, oceanCells: best >= 0 ? bodies[0].cells : 0 };
}

// (scratch per mesh size: a timeline repaints often)
let scratch = null;
function scratchOf(n) {
    if (!scratch || scratch.comp.length !== n) scratch = { comp: new Int32Array(n), queue: new Int32Array(n) };
    return scratch;
}
