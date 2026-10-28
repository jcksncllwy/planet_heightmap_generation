// What the user is looking at, told to the dev server (tuning/dev-server.mjs → the history cache's latest.json): the
// history's key, the moment shown, the page's link, the time — so an agent can load exactly that frame
// (node v2/tools/history.mjs frame --latest). Only for a history the worker is saving (app/history-upload.js: the dev
// server served the page); elsewhere it never sends anything. Polled once a second, sent only when it changes.

const EVERY_MS = 1000;

/** @param {() => Object|null} read   the view now ({key, timeMyr, …}), or null while there is nothing saved to point at */
export function watchView(read) {
    let last = null, busy = false;
    setInterval(() => {
        if (busy) return;
        const v = read();
        if (!v?.key) return;
        const text = JSON.stringify(v);
        if (text === last) return;
        last = text; busy = true;
        fetch('/api/history/view', { method: 'POST', body: text, headers: { 'Content-Type': 'application/json' } })
            .catch(() => {}).finally(() => { busy = false; });
    }, EVERY_MS);
}
