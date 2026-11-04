// A finished moment on the wire and on disk (the finish cache: tools/lib/finish-cache.mjs, filled by the finish worker
// through the dev server and by Node tools): any tree of plain values and typed arrays — the finish worker's 'done'
// (raster, rivers, climate, civ, stats) or the finish's per-cell fields — as one run of bytes, the same in a browser and
// in Node.
//
// Bytes:  'GSFW' · u32 version · u32 the tree's JSON length · the JSON (UTF-8) · padding to 8 · each array's bytes, each
//         starting on a multiple of 8 (so a reader's views onto the one buffer are aligned: no copy).
// Tree:   JSON, every typed array replaced by {"$a": its type, "o": its offset in the bytes, "n": its length}. Numbers that
//         JSON cannot hold (NaN, ±Infinity, −0) go as {"$n": "NaN"…}; undefined is dropped (as JSON drops it).

const MAGIC = 'GSFW', VERSION = 1;
const TYPES = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
const pad8 = n => (n + 7) & ~7;

/**
 * A tree's bytes, as chunks to hand to a Blob or write in turn (no copy of the arrays' bytes here).
 * @returns {{chunks: Uint8Array[], bytes: number}}
 */
export function treeChunks(tree) {
    const arrays = [];
    let at = 0;
    const json = JSON.stringify(tree, function (k, v) {
        const raw = this[k];                                          // (before toJSON: a typed array as it is)
        if (ArrayBuffer.isView(raw)) {
            if (!TYPES[raw.constructor.name]) throw new Error(`finish-wire: a ${raw.constructor.name} cannot go`);
            const o = at;
            arrays.push(raw); at = pad8(at + raw.byteLength);
            return { $a: raw.constructor.name, o, n: raw.length };
        }
        if (typeof raw === 'number' && (!Number.isFinite(raw) || Object.is(raw, -0))) return { $n: Object.is(raw, -0) ? '-0' : String(raw) };
        return v;
    });
    const text = new TextEncoder().encode(json), headLen = pad8(12 + text.length);
    const head = new Uint8Array(headLen), dv = new DataView(head.buffer);
    for (let i = 0; i < 4; i++) head[i] = MAGIC.charCodeAt(i);
    dv.setUint32(4, VERSION, true); dv.setUint32(8, text.length, true);
    head.set(text, 12);
    const chunks = [head];
    let written = 0;
    for (const a of arrays) {
        const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        chunks.push(b); written += b.byteLength;
        const gap = pad8(written) - written;
        if (gap) { chunks.push(new Uint8Array(gap)); written += gap; }
    }
    return { chunks, bytes: headLen + written };
}

/** A tree's bytes in one buffer. */
export function treeBytes(tree) {
    const { chunks, bytes } = treeChunks(tree), out = new Uint8Array(bytes);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.byteLength; }
    return out;
}

/**
 * The tree in a run of bytes: its arrays are views onto `bytes`' buffer where they are aligned (a Uint8Array read from a
 * file or the network, at its buffer's start, always is), else copies.
 */
export function readTree(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.byteLength < 12 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== MAGIC) throw new Error('finish-wire: not a finished moment');
    if (dv.getUint32(4, true) !== VERSION) throw new Error(`finish-wire: version ${dv.getUint32(4, true)}, this reads ${VERSION}`);
    const len = dv.getUint32(8, true), base = pad8(12 + len);
    if (base > u8.byteLength) throw new Error('finish-wire: cut short');
    const json = new TextDecoder().decode(u8.subarray(12, 12 + len));
    let end = base;
    const tree = JSON.parse(json, (k, v) => {
        if (v && typeof v === 'object' && typeof v.$a === 'string' && TYPES[v.$a]) {
            const T = TYPES[v.$a], off = u8.byteOffset + base + v.o, size = v.n * T.BYTES_PER_ELEMENT;
            if (base + v.o + size > u8.byteLength) throw new Error('finish-wire: cut short');
            end = Math.max(end, pad8(base + v.o + size));
            return off % T.BYTES_PER_ELEMENT === 0 ? new T(u8.buffer, off, v.n) : new T(u8.buffer.slice(off, off + size));
        }
        if (v && typeof v === 'object' && typeof v.$n === 'string' && Object.keys(v).length === 1) return v.$n === '-0' ? -0 : Number(v.$n);
        return v;
    });
    // (exactly as long as the writer made it: its last array and that array's padding — no more, no less)
    if (end !== u8.byteLength) throw new Error(`finish-wire: ${u8.byteLength} bytes where ${end} were written`);
    return tree;
}
