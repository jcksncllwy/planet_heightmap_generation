// The finish cache's key (tools/lib/finish-cache.mjs; the finish worker files the page's finished moments under it, Node
// tools theirs): what makes a finished moment the picture it is. A finish is a pure function of
//   · the moment: its history's key (app/history-key.js: the history code, the start world, the drive, the engine's maths)
//     and the time — so the frame it starts from;
//   · the finish code — every file the finish worker imports, followed through (tools/lib/history-cache.mjs
//     historyCodeHash from finish/finish-worker.js), as the dev server served it (app/finish-code.js) or as Node reads it;
//   · the settings the page hands the finish: the detail (cells), the picture's width, the climate's Greenhouse and
//     Precipitation, and whether the People layer's world is built (civ: it adds to the output, never changes the rest,
//     but an entry without it cannot serve a page that wants it);
//   · the engine: where it ran (the page's worker or Node), its maths (mathFingerprint: Chromium and Node differ in the
//     last bit of sin, exp…) and what ran the erosion (the GPU's solver or the CPU's: they agree only to within float
//     noise, finish.js erosionSolver). So the page's finishes and Node's are filed apart, as their histories are.
// Not in it: the river density (a drawing threshold, riverPaths' q0), the palette and every other view setting — they
// draw a finished moment, they never change it. Nor the finish's pool size: its slices are put together the same way
// whatever their number (terrain-pool.js).
// The hash is 128 bits from four 32-bit lanes (FNV-1a, each lane its own offset, mixed as murmur3 finishes) over the
// settings written out in a fixed order — a cache key, not a signature; the same in a browser and in Node, and sync.

export const FINISH_KEY_VERSION = 'geo-sim finish v1';

/** The climate options as the climate reads them (climate/core.js CORE_DEFAULTS: 0 W/m², ×1), so `{}` and the page's
 *  sliders at rest share a key. */
export const climateSettings = (o = {}) => ({ greenhouseWm2: o.greenhouseWm2 ?? 0, precipScale: o.precipScale ?? 1 });

/** What ran the erosion, from the finish's stats.erodeOn (finish.js: 'cpu', the GPU's description, or none: erosion off). */
export const erosionOf = erodeOn => (erodeOn == null ? 'off' : erodeOn === 'cpu' ? 'cpu' : 'gpu');

/**
 * The settings a finished moment is keyed by, in one fixed shape (what meta.json keeps, and latest.json names).
 * @param {{history: string, timeMyr: number, code: string, cells: number, width: number, climate?: Object (else
 *          greenhouseWm2 and precipScale, as a spec holds them), civ?: boolean,
 *          host: 'page'|'node', math: string, erosion: 'gpu'|'cpu'|'off'}} s
 */
export function finishSpec(s) {
    // (the climate as options, or already spelt out: a spec read back from meta.json keys as it was keyed)
    const c = climateSettings(s.climate ?? s);
    return { history: s.history, timeMyr: Math.round(s.timeMyr * 1000) / 1000, code: s.code, cells: s.cells, width: s.width,
        greenhouseWm2: c.greenhouseWm2, precipScale: c.precipScale, civ: !!s.civ, host: s.host, math: s.math, erosion: s.erosion };
}

/** @returns {string|null} 32 hex digits (null without a history key or a code hash: nothing to file it under) */
export function finishKey(s) {
    if (!s.history || !s.code) return null;
    const p = finishSpec(s);
    return hash128([FINISH_KEY_VERSION, p.history, Math.round(p.timeMyr * 1000), p.code, p.cells, p.width, p.greenhouseWm2, p.precipScale, p.civ ? 1 : 0, p.host, p.math, p.erosion].map(String).join('\u0000'));
}

function hash128(text) {
    const h = [0x811c9dc5, 0x050c5d1f, 0x2b1d4c6b, 0x7d3a9e57];
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        for (let l = 0; l < 4; l++) h[l] = Math.imul(h[l] ^ (c + l * 0x9e37), 0x01000193);
    }
    return h.map((x, l) => {
        x ^= text.length + l; x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
        return (x >>> 0).toString(16).padStart(8, '0');
    }).join('');
}
