// A packed frame (tectonics/frame-pack.js) as bytes, and back — the history cache's frame format, the same from the
// Evolution page's worker (which uploads its frames to the dev server) and from Node (tools/lib/history-cache.mjs, which
// keeps them compressed). Lossless: unpacked, a frame read back is the frame captured, to the bit.
//
//   'GSF1' · u32 header length · header (UTF-8 JSON) · zeros to a multiple of 8 · the fields' arrays, each 8-aligned
//
// The header holds the frame's meta (time, plates, events, cycle…) with the numbers JSON cannot hold tagged (NaN, ±∞,
// −0), and each field's description with the place of its arrays in the data that follows.

const MAGIC = 0x31465347;            // 'GSF1', little-endian
const CTORS = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
const PARTS = ['bits', 'values', 'steps', 'far'];

function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
}
function fromBase64(text) { const s = atob(text), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }

// (JSON with the values it would lose tagged: a key starting '$' marks one)
function replacer(key, v) {
    if (typeof v === 'number') return Number.isFinite(v) && !Object.is(v, -0) ? v : { $n: Object.is(v, -0) ? '-0' : String(v) };
    if (v === undefined) return Array.isArray(this) ? { $u: 1 } : undefined;
    if (v && typeof v === 'object') {
        if (ArrayBuffer.isView(v)) return { $t: v.constructor.name, $b: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
        if (v instanceof Map) return { $m: [...v] };
        if (v instanceof Set) return { $s: [...v] };
    }
    return v;
}
function reviver(key, v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    if ('$n' in v) return v.$n === '-0' ? -0 : Number(v.$n);
    if ('$u' in v) return undefined;
    if ('$t' in v) { const b = fromBase64(v.$b); return new CTORS[v.$t](b.buffer, 0, b.byteLength / CTORS[v.$t].BYTES_PER_ELEMENT); }
    if ('$m' in v) return new Map(v.$m);
    if ('$s' in v) return new Set(v.$s);
    return v;
}

/**
 * A packed frame as a list of byte chunks (for a Blob, or to join): the header, then each array.
 * @param {{meta: Object, fields: Object}} packed   tectonics/frame-pack.js packFrame(frame).packed
 * @returns {Uint8Array[]}
 */
export function frameChunks({ meta, fields }) {
    const desc = {}, arrays = [];
    let at = 0;
    for (const [name, f] of Object.entries(fields)) {
        const d = { type: f.type, length: f.length };
        if ('bg' in f) d.bg = f.bg;
        if ('first' in f) d.first = f.first;
        for (const part of PARTS) {
            const a = f[part];
            if (!a) continue;
            d[part] = [at, a.length, a.constructor.name];
            arrays.push(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
            at += (a.byteLength + 7) & ~7;
        }
        desc[name] = d;
    }
    const header = new TextEncoder().encode(JSON.stringify({ v: 1, meta, fields: desc, bytes: at }, replacer));
    const head = new Uint8Array((8 + header.length + 7) & ~7);
    new DataView(head.buffer).setUint32(0, MAGIC, true);
    new DataView(head.buffer).setUint32(4, header.length, true);
    head.set(header, 8);
    const chunks = [head];
    for (const a of arrays) { chunks.push(a); if (a.byteLength & 7) chunks.push(new Uint8Array(8 - (a.byteLength & 7))); }
    return chunks;
}

/** frameChunks joined into one array. */
export function frameBytes(packed) {
    const chunks = frameChunks(packed), out = new Uint8Array(chunks.reduce((s, c) => s + c.byteLength, 0));
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return out;
}

/**
 * Bytes back to a packed frame ({meta, fields}, as packFrame made it). Throws on anything that is not a whole frame.
 * @param {Uint8Array} bytes
 */
export function readFrameBytes(bytes) {
    if (bytes.byteLength < 8) throw new Error('frame: too short');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('frame: not a frame');
    const hl = dv.getUint32(4, true), base = (8 + hl + 7) & ~7;
    if (base > bytes.byteLength) throw new Error('frame: header cut short');
    const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl)), reviver);
    if (head.v !== 1 || base + head.bytes > bytes.byteLength) throw new Error('frame: data cut short');
    const fields = {};
    for (const [name, d] of Object.entries(head.fields)) {
        const f = { type: d.type, length: d.length };
        if ('bg' in d) f.bg = d.bg;
        if ('first' in d) f.first = d.first;
        for (const part of PARTS) {
            if (!d[part]) continue;
            const [off, n, ctor] = d[part], C = CTORS[ctor], start = bytes.byteOffset + base + off;
            if (!C || base + off + n * C.BYTES_PER_ELEMENT > bytes.byteLength) throw new Error(`frame: field ${name} out of range`);
            f[part] = start % C.BYTES_PER_ELEMENT === 0 ? new C(bytes.buffer, start, n) : new C(bytes.slice(base + off, base + off + n * C.BYTES_PER_ELEMENT).buffer);
        }
        fields[name] = f;
    }
    return { meta: head.meta, fields };
}
