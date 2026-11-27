// What a history's frames have in common, sent from its worker once and shared on the page (pagemem2, 2026-11-27).
// A frame carries every event so far (snapshot.js: the world's log, copied), an entry for every plate ever made, dead ones
// included, and the climate the history holds — and each frame crossed to the page as its own structured clone of them,
// so a long Keep going held ~25× its frames' packed fields: 5–7 MB a frame at 4,000 Myr on 40K cells (8,276 events, 1,457
// plates), the page's memory growing as the square of the history's length until the renderer crashed (~8,150 Myr).
// Now the worker (history-worker.js send) posts only what the frame before did not have:
//   · events: the ones logged since (the world's log is only ever added to — model/world.js log — and an event is never
//     changed once logged: checked frame by frame on three worlds, pagemem2 transport-probe); the page keeps one list, and
//     each frame's `events` is its first n, read when asked;
//   · plates: an entry the same as the frame before's, value for value (a dead plate's, from its death on), is sent as
//     null and the page reuses the one it has;
//   · climate: the same sample as the frame before's (the same arrays: a sample is a new object, never changed in place —
//     step/climate-sample.js) is not sent again.
// The frames are the same, value for value (their full value hashes, the first run and Keep going's pieces); the history
// itself is untouched (this is only the crossing), and so is what the worker saves to the history cache (the whole frame,
// history-upload.js, before this).
import { PackedFrame } from '../tectonics/frame-pack.js';

// (deep equality by value — numbers by Object.is, so −0 and NaN are their own values, keys in their own order as the frame's
// value hash reads them: tools/lib/frame-hash.mjs)
function same(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
        if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
        return true;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i] || !same(a[ka[i]], b[kb[i]])) return false;
    return true;
}
// (the same sample: the same keys holding the very same values — its arrays the same objects)
function sameSample(a, b) {
    if (!a || !b) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && Object.is(a[k], b[k]));
}

/** The worker's side: what it has posted of the frames before. One per history (a new history starts a new one). */
export class ShareSender {
    constructor() { this.events = null; this.plates = null; this.climate = null; }
    /**
     * @param {Object} meta  a packed frame's meta (frame-pack.js packFrame; not changed here)
     * @returns {{meta: Object, share: Object}}  the meta to post and what the page takes from the frame before:
     *          {eventsFrom?: number, platesSame?: Int32Array, climate?: true}
     */
    meta(meta) {
        const out = { ...meta }, share = {};
        const ev = meta.events, oldEv = this.events;
        if (Array.isArray(ev)) {
            // (the world's own event objects, the frame before's first: the log only grows)
            let prefix = !!oldEv && ev.length >= oldEv.length;
            for (let i = 0; prefix && i < oldEv.length; i++) prefix = ev[i] === oldEv[i];
            if (prefix) { out.events = ev.slice(oldEv.length); share.eventsFrom = oldEv.length; }
            this.events = ev;
        }
        const pl = meta.plates, oldPl = this.plates;
        if (Array.isArray(pl)) {
            if (oldPl) {
                const sameAt = [];
                for (let i = 0; i < Math.min(pl.length, oldPl.length); i++) if (pl[i] && oldPl[i] && same(pl[i], oldPl[i])) sameAt.push(i);
                if (sameAt.length) { out.plates = pl.slice(); for (const i of sameAt) out.plates[i] = null; share.platesSame = Int32Array.from(sameAt); }
            }
            this.plates = pl;
        }
        if (meta.climate && sameSample(meta.climate, this.climate)) { out.climate = null; share.climate = true; }
        this.climate = meta.climate ?? null;
        return { meta: out, share };
    }
}

/** The page's side: the frames as they were, from what the worker posted. One per history. */
export class ShareJoin {
    constructor() { this.events = []; this.plates = null; this.climate = null; }
    /** @returns {PackedFrame} the frame posted as `packed` ({meta, fields}) with `share` (ShareSender.meta's) */
    frame({ meta: posted, fields }, share = {}) {
        const meta = { ...posted };
        let n = null;
        if (Array.isArray(posted.events)) {
            if (share.eventsFrom != null) {
                if (share.eventsFrom !== this.events.length) throw new Error(`history frames: ${this.events.length} events held, the worker sent those after ${share.eventsFrom}`);
                for (const e of posted.events) this.events.push(e);
            } else this.events = posted.events.slice();
            n = this.events.length;
            delete meta.events;
        }
        if (share.platesSame) {
            const plates = meta.plates = posted.plates.slice();
            for (const i of share.platesSame) plates[i] = this.plates[i];
        }
        if (Array.isArray(meta.plates)) this.plates = meta.plates;
        if (share.climate) meta.climate = this.climate;
        this.climate = meta.climate ?? null;
        const frame = new PackedFrame({ meta, fields });
        if (n !== null) {
            // (the frame's events: the history's first n, as a list of its own when read — the events themselves shared)
            const all = this.events;
            Object.defineProperty(frame, 'events', { get: () => all.slice(0, n), set(v) { Object.defineProperty(this, 'events', { value: v, writable: true, enumerable: true, configurable: true }); }, enumerable: true, configurable: true });
        }
        return frame;
    }
}
