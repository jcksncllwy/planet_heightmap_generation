// The Evolution page's history, saved to the machine's history cache as it is built (tools/lib/history-cache.mjs) — only
// when the local dev server served the page (app/history-code.js holds a hash: it wrote one in), so agents and tools can
// load exactly the frames the user is looking at. From the history worker: each packed frame is handed to fetch() as a
// Blob (a copy of its arrays, well under a millisecond) before it goes to the page, and the network does the rest off
// the history's thread; one upload at a time, in order. A failure stops the saving, quietly: it never touches the history.

import { frameChunks } from './frame-wire.js';

export class HistoryUpload {
    /**
     * @param {string} key   the history's key (app/history-key.js)
     * @param {Object} spec  what the history is (seed, scene, settings), for the cache entry's meta.json
     */
    constructor(key, spec) {
        this.key = key; this.ms = 0; this.frames = 0; this.dead = false;
        this.chain = this.post('begin', JSON.stringify({ key, spec }), 'application/json');
    }
    post(what, body, type) {
        return fetch(`/api/history/${what}?key=${this.key}`, { method: 'POST', body, headers: { 'Content-Type': type } })
            .then(r => { if (!r.ok) this.dead = true; }, () => { this.dead = true; });
    }
    /** A frame on the step grid (others are never kept: tools/lib/history-cache.mjs). */
    frame(packed) {
        if (this.dead) return;
        const t = performance.now(), blob = new Blob(frameChunks(packed));
        this.ms += performance.now() - t; this.frames++;
        this.chain = this.chain.then(() => (this.dead ? null : this.post('frame', blob, 'application/octet-stream')));
    }
    /** The run's end: its time and steps (the entry notes them). */
    done(info) { if (!this.dead) this.chain = this.chain.then(() => (this.dead ? null : this.post('done', JSON.stringify(info), 'application/json'))); }
}
