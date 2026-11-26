// A dead plate's memory, let go. A plate dies when its last crust goes: welded into another (collision.js), or
// a split or a birth that found nothing to take (subduction-init.js, ocean-plates.js). It stays in world.plates, as
// its id is its index and frames, records and colours name it, but nothing moves it or reads its crust again. Yet each
// plate holds a raster the size of the mesh (CrustRaster: ~211 bytes a cell, 8.4 MB at 40K cells) and a few
// mesh-sized caches of the steps (gather.js's claim map and near-edge marks, rift-stress, collapse sources). Over a
// long history most plates are dead: on the Evolution page's seed 243751, 353 of 360 at 1200 Myr, 3.3 GB in the history
// worker, which keeps its world for Keep going (pagemem, 2026-11-26). This sweep drops whatever a dead plate holds
// that is mesh-sized, keeping what names it (id, name, hue, born, quat, stats), so the frames and records read the same.
//
// Called between steps by whoever runs a history (the page's history worker after each frame; the Node tools' history
// cache, simulateCached): it changes no history (the frames' value hashes match without it), it only frees memory.
// Nothing may read a dead plate's crust after this. GEO_SIM_DEAD_PLATE_TRAP=1 (Node) or trap: true puts a getter
// that throws in place of each dropped field, so a run proves it (pagemem's check: three worlds, full length).

/** Is this value mesh-sized: a typed array of at least `n` entries, or an object holding one (one level down)? */
function meshSized(v, n) {
    if (!v || typeof v !== 'object') return false;
    if (ArrayBuffer.isView(v)) return v.length >= n;
    if (v instanceof Map || v instanceof Set) return false;           // (wings: a few entries per trench tip)
    for (const x of Object.values(v)) if (ArrayBuffer.isView(x) && x.length >= n) return true;
    return false;
}

// (the plates swept: kept here, not marked on the plate, so a plate's own fields stay as the steps made them)
const swept = new WeakSet();
const TRAP = typeof process !== 'undefined' && process.env?.GEO_SIM_DEAD_PLATE_TRAP === '1';

/**
 * Let go of the mesh-sized arrays of every plate that has died since the last sweep.
 * @param {Object} world  the world (plates, mesh)
 * @param {{trap?: boolean}} [o]  trap: a throwing getter in place of each dropped field (a run that reads one fails)
 * @returns {{plates: number, bytes: number}}  how many plates were swept now, and the bytes let go (each buffer once)
 */
export function freeDeadPlates(world, { trap = TRAP } = {}) {
    const n = world.mesh.numCells, seen = new Set();
    let plates = 0, bytes = 0;
    for (const p of world.plates) {
        if (!p || p.alive || swept.has(p)) continue;
        for (const k of Object.keys(p)) {
            const v = p[k];
            if (!meshSized(v, n)) continue;
            for (const x of ArrayBuffer.isView(v) ? [v] : Object.values(v)) {
                if (ArrayBuffer.isView(x) && !seen.has(x.buffer)) { seen.add(x.buffer); bytes += x.buffer.byteLength; }
            }
            if (trap) {
                const id = p.id;
                Object.defineProperty(p, k, { configurable: true, enumerable: false,
                    get() { throw new Error(`free-dead-plates: plate ${id}'s ${k} was read after the plate died`); },
                    set() { throw new Error(`free-dead-plates: plate ${id}'s ${k} was written after the plate died`); } });
            } else p[k] = null;
        }
        swept.add(p);
        plates++;
    }
    return { plates, bytes };
}
