// A frame's hash by its VALUES — the one to compare histories by (determinism lane, 2026-11-09).
// A frame file's bytes (history.mjs frame: v8.serialize) are NOT a history's fingerprint: V8 writes the same number as an
// int32 ('I') or a double ('N') by how the engine happens to hold that object field when it is written (a field that ever
// held a double keeps a double representation; which fields have depends on JIT and inline-cache timing), so the same
// history's frame comes out 3 ways in 4 runs (upper2, main ffee7a0, 12345 @600 40K: fc9ad764 ×2, b06a5b46, 8e893a04 —
// one value hash, 7b6d93cf7b06; the parts differ only in the plates' and events' number tags). shasum a frame file and two
// identical histories may "differ"; hash it here and they agree, and a difference is a real one.
// Exact: numbers by their shortest round-trip text (String; -0 kept apart from 0), typed arrays by their bytes, object keys
// in their own order (a history that builds an object in another order is another history's code).
import crypto from 'node:crypto';

export function canonical(v) {
    if (ArrayBuffer.isView(v)) return `${v.constructor.name}:${Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')}`;
    if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (v === undefined) return 'u';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v instanceof Map) return `M{${[...v].map(([k, x]) => `${canonical(k)}:${canonical(x)}`).join(',')}}`;
    if (v instanceof Set) return `S{${[...v].map(canonical).join(',')}}`;
    return `{${Object.keys(v).map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}

const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

/** Each field's hash, by the field's name (sorted) — to name the fields where two frames part. */
export const fieldHashes = frame => Object.fromEntries(Object.keys(frame).sort().map(k => [k, sha(canonical(frame[k]))]));

/** The frame's hash: of its fields' hashes, by name. */
export const frameHash = frame => sha(JSON.stringify(fieldHashes(frame)));
