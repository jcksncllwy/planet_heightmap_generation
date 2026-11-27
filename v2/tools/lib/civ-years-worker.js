// civ-years-browser.mjs's worker: the civ GPU context opened in a module worker, as civ-worker.js opens it on the page.
import { civGPU } from '../../js/civ/civ-gpu.js';
import { runFixture } from './civ-years-fixture.js';
self.onmessage = async () => {
    try { const ctx = await civGPU(), out = await runFixture(ctx); self.postMessage({ out, info: `${ctx.info?.vendor} ${ctx.info?.architecture}` }, [out.buffer]); }
    catch (e) { self.postMessage({ error: e?.stack ?? String(e) }); }
};
