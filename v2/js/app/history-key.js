// The history cache's key (tools/lib/history-cache.mjs; the Evolution page saves its histories under it): what makes a
// history the history it is. A history is a pure function of the code that runs it, its start world and how it is driven
// (tectonics/simulate.js: same code, same world, same drive — the same history, to the bit, in Node and in the page's worker).
// So the key is a hash of
//   · the history code — every file the history's entry points import (tools/lib/history-cache.mjs historyCodeHash), as
//     the page's dev server served it or as Node reads it;
//   · the start world itself, walked whole just before the run: the mesh, every plate's crust raster, the config with any
//     overrides (lab sliders, --set, the crust ledger, the evolving heights' constants), the seed, the plumes a scene
//     schedules… — so two spellings of one start (a scene's default and the same value set by hand, two scenes that share
//     a start world) share an entry, and anything that changes the start changes the key with no list to keep up;
//   · the drive (its name and source) and whether the event rules run.
// What the walk cannot see is a closure's state: the world's random streams (model/world.js). They are seeded from the
// seed, which is in the key, and no start-world builder draws from them — so a fresh world's streams are the seed's (a
// world that has already run, world.time > 0, is never keyed).
// The hash is 128 bits from four 32-bit murmur3 lanes — not cryptographic, only a cache key over the world's own data —
// the same in Node and in a browser worker (no async digest), ~40 ms for a 40K-cell start world.

const C1 = 0xcc9e2d51, C2 = 0x1b873593;
const f64 = new Float64Array(1), f64Words = new Uint32Array(f64.buffer);

class Hash128 {
    constructor() { this.h = [0x9747b28c, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f]; this.n = 0; }
    word(k) {
        k = Math.imul(k | 0, C1); k = (k << 15) | (k >>> 17); k = Math.imul(k, C2);
        const i = this.n++ & 3;
        let h = this.h[i] ^ k;
        h = (h << 13) | (h >>> 19);
        this.h[i] = (Math.imul(h, 5) + 0xe6546b64) | 0;
    }
    num(x) { f64[0] = x; this.word(f64Words[0]); this.word(f64Words[1]); }
    str(s) { this.word(s.length); for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i)); }
    /** A typed array's bytes, as 32-bit words and a tail. */
    view(v) {
        const bytes = v.byteLength, whole = bytes >>> 2;
        this.word(bytes);
        const aligned = (v.byteOffset & 3) === 0;
        const words = aligned ? new Uint32Array(v.buffer, v.byteOffset, whole) : new Uint32Array(new Uint8Array(v.buffer, v.byteOffset, whole * 4).slice().buffer);
        for (let i = 0; i < whole; i++) this.word(words[i]);
        if (bytes & 3) { const tail = new Uint8Array(v.buffer, v.byteOffset + whole * 4, bytes & 3); let k = 0; for (let i = 0; i < tail.length; i++) k |= tail[i] << (8 * i); this.word(k); }
    }
    hex() {
        const h = this.h.slice();
        for (let i = 0; i < 4; i++) h[i] ^= this.n;
        h[0] += h[1] + h[2] + h[3]; h[1] += h[0]; h[2] += h[0]; h[3] += h[0];
        for (let i = 0; i < 4; i++) { let x = h[i]; x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; h[i] = x; }
        h[0] += h[1] + h[2] + h[3]; h[1] += h[0]; h[2] += h[0]; h[3] += h[0];
        return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
    }
}

/** Everything a value holds, walked in a fixed order (an object's keys sorted; a shared object once, then by reference). */
function walk(H, x, seen, mesh) {
    if (x === null) return H.word(1);
    switch (typeof x) {
        case 'undefined': return H.word(2);
        case 'boolean': return H.word(x ? 3 : 4);
        case 'number': H.word(5); return H.num(x);
        case 'string': H.word(6); return H.str(x);
        case 'bigint': H.word(7); return H.str(x.toString());
        case 'function': return H.word(8);                  // (code: in the code hash; its closure's state, see above)
        case 'symbol': return H.word(9);
    }
    if (x === mesh) return H.word(10);                      // (hashed once, apart: see worldFingerprint)
    if (seen.has(x)) { H.word(11); return H.word(seen.get(x)); }
    seen.set(x, seen.size);
    if (ArrayBuffer.isView(x)) { H.word(12); H.str(x.constructor.name); return H.view(x); }
    if (x instanceof ArrayBuffer) { H.word(13); return H.view(new Uint8Array(x)); }
    if (Array.isArray(x)) { H.word(14); H.word(x.length); for (let i = 0; i < x.length; i++) walk(H, x[i], seen, mesh); return; }
    if (x instanceof Map) { H.word(15); H.word(x.size); for (const [k, v] of x) { walk(H, k, seen, mesh); walk(H, v, seen, mesh); } return; }
    if (x instanceof Set) { H.word(16); H.word(x.size); for (const v of x) walk(H, v, seen, mesh); return; }
    if (x instanceof WeakMap || x instanceof WeakSet) return H.word(17);
    H.word(18); H.str(x.constructor?.name ?? '');
    const keys = Object.keys(x).sort();
    H.word(keys.length);
    for (const k of keys) { H.str(k); walk(H, x[k], seen, mesh); }
}

/**
 * The start world's fingerprint: its mesh (the arrays the page's worker is handed: positions and adjacency) and
 * everything else it holds. @returns {string} 32 hex digits
 */
export function worldFingerprint(world) {
    const H = new Hash128(), m = world.mesh;
    H.str('mesh'); H.word(m.numCells); H.view(m.xyz); H.view(m.adjOffset); H.view(m.adjList);
    H.str('world'); walk(H, world, new Map(), m);
    return H.hex();
}

/** A drive's identity: its name and its source (what it does with the world is in the code hash). */
export function driveId(drive) { const H = new Hash128(); H.str(drive?.name ?? ''); H.str(String(drive)); return `${drive?.name || 'drive'}:${H.hex().slice(0, 12)}`; }

/**
 * The key of a history: the code, the start world, the drive, the event rules. Null for a world that is not at its
 * start (a resumed world's random streams are past the seed's).
 * @param {string} codeHash   tools/lib/history-cache.mjs historyCodeHash (in the page: app/history-code.js, as served)
 * @returns {string|null} 32 hex digits
 */
export function historyKey(codeHash, world, drive, events = true) {
    if (!codeHash || world.time !== 0 || world.step !== 0) return null;
    const H = new Hash128();
    H.str('geo-sim history v1'); H.str(codeHash); H.str(worldFingerprint(world)); H.str(driveId(drive)); H.word(events ? 1 : 0);
    return H.hex();
}
