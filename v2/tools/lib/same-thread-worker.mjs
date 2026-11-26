// A web Worker for Node, run in this thread (tools/history-pause-probe.mjs): the module a page would start as a worker
// (history-worker.js: `self.onmessage`, `self.postMessage`) is imported here, and the two sides talk through a
// MessageChannel — structured-cloned, transferred and delivered a turn of the event loop later, as between a page and its
// worker. So the runner's worker path (app/history-runner.js) runs in Node as on the page, its messages arriving between
// the history's steps. One worker module per process (a module is loaded once): enough for a probe. Only `allow`ed
// scripts start; any other (helper-pool.js's helpers) throws, as a worker that cannot start one would (the same history).
import { MessageChannel } from 'node:worker_threads';

export function installSameThreadWorker(allow = url => /history-worker\.js$/.test(String(url))) {
    let used = false;
    globalThis.Worker = class SameThreadWorker {
        constructor(url) {
            if (!allow(url) || used) throw new Error(`same-thread-worker: will not start ${url}`);
            used = true;
            const { port1, port2 } = new MessageChannel();
            this.port = port1; this.onmessage = null; this.onerror = null;
            port1.onmessage = e => this.onmessage?.({ data: e.data });
            globalThis.self = {
                postMessage: (m, transfer) => port2.postMessage(m, transfer),
                set onmessage(fn) { port2.onmessage = e => fn({ data: e.data }); },       // (port2 starts once the module listens)
            };
            this.ready = import(url.href ?? url).catch(err => this.onerror?.({ message: err.stack ?? String(err) }));
            this.ports = [port1, port2];
        }
        postMessage(m, transfer) { this.port.postMessage(m, transfer); }
        terminate() { for (const p of this.ports) p.close(); }
    };
}
