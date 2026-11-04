// (finish-fsm.js as finish.js sees it under fsm-register.mjs: the same pass, measured. One FSM line: its time, its census, the dry
// flats each surface leaves, and how far the ground moved)
import { fillSpillMerge as real } from '../js/finish/finish-fsm.js';
import { Water } from '../js/finish/finish-hydro.js';
const R = 6371;
export * from '../js/finish/finish-fsm.js';
export function fillSpillMerge(ctx, F) {
    const { mesh, z, ocean } = ctx, n = mesh.numCells, cellKm2 = 4 * Math.PI * 6371 ** 2 / n, before = z.slice(), t0 = performance.now();
    const out = real(ctx, F), ms = Math.round(performance.now() - t0);
    let moved = 0, fillKm3 = 0;
    for (let c = 0; c < n; c++) { const d = z[c] - before[c]; if (d !== 0) { moved++; fillKm3 += d * cellKm2; } }
    const land = n - ocean.reduce((v, x) => v + (x ? 1 : 0), 0), W = out.stats;
    console.log('FSM ' + JSON.stringify({ ms, stage: W.fsm, endo: +W.endorheicShare.toFixed(3), salt: W.saltLakes, pans: W.pans, fresh: W.freshLakes, byOrigin: W.byOriginShare, toBasins: +W.toBasinsShare.toFixed(3),
        moved: { cells: moved, pctLand: +(100 * moved / land).toFixed(2), fillKm3: Math.round(fillKm3) }, after: dryFlats(mesh, z, ocean, out.lake, out.lakeLevel), seas: W.seas.length }));
    return out;
}

/**
 * Dry flats on a finished surface: land out of the water with no neighbour strictly lower on land plus water, where water still
 * has to choose a way. Sinks (no way out at all) are not flats' business, so a flat here must touch ground level with it.
 * @returns {{cells: number, Mkm2: number, patches: number, largestKm2: number, withExit: number}} withExit: cells in a flat patch
 *   that has a way off at its own level or lower, the ones a flat rule has to route
 */
function dryFlats(mesh, z, ocean, lake, lakeLevel) {
    const { adjOffset, adjList, numCells: n } = mesh, cellKm2 = 4 * Math.PI * R * R / n;
    const at = c => (ocean[c] ? 0 : lake[c] === Water.FRESH || lake[c] === Water.SALT ? Math.max(z[c], lakeLevel[c]) : z[c]);
    const flat = new Uint8Array(n);
    let cells = 0;
    for (let c = 0; c < n; c++) {
        if (ocean[c] || lake[c]) continue;
        let low = false, level = false;
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const v = at(adjList[k]); if (v < z[c]) { low = true; break; } if (v === z[c]) level = true; }
        if (!low && level) { flat[c] = 1; cells++; }
    }
    const seen = new Uint8Array(n);
    let patches = 0, largest = 0, withExit = 0;
    for (let s = 0; s < n; s++) {
        if (!flat[s] || seen[s]) continue;
        const st = [s];
        seen[s] = 1;
        let size = 0, exit = false;
        while (st.length) {
            const c = st.pop();
            size++;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const y = adjList[k];
                if (flat[y]) { if (!seen[y]) { seen[y] = 1; st.push(y); } } else if (at(y) <= z[c]) exit = true;
            }
        }
        patches++;
        if (size > largest) largest = size;
        if (exit) withExit += size;
    }
    return { cells, Mkm2: +(cells * cellKm2 / 1e6).toFixed(3), patches, largestKm2: Math.round(largest * cellKm2), withExit };
}
