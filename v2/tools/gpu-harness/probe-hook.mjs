// A window into the CPU erosion for the GPU lane, without touching finish-erode.js: `node --import` this and the module's
// source gains three calls, each a no-op unless a tool sets the global. It only reads: the CPU path run this way computes what
// it always does. A pattern that stops matching throws, rather than a tool quietly seeing nothing.
import { registerHooks } from 'node:module';

const EDITS = [
    ['finish/finish-erode.js', 'export function erodeLandscape(o, P) {', '$& o = globalThis.__erodeEnter?.(o, P) ?? o;'],
    ['finish/finish-erode.js', "lap('lay');", "$& globalThis.__erodeStep?.({ s, dt, count, fill, recv, rank, order, step, A, e, zNew, z, Qs, gross, dropped, lid, lakes, sink, base, t, trap, inlet, e_: e });"],
    ['finish/finish-basins.js', 'export function closedBasins(mesh, z, runoff, pet, rain, cellKm2, F, ocean, flood = null) {', '$& globalThis.__closedArgs?.({ mesh, runoff, pet, rain, cellKm2, F, ocean });'],
];
registerHooks({
    load(url, context, next) {
        const out = next(url, context), edits = EDITS.filter(([file]) => url.endsWith(file));
        if (!edits.length) return out;
        let source = String(out.source);
        for (const [, find, put] of edits) {
            if (!source.includes(find)) throw new Error(`probe-hook: "${find}" not found in ${url}`);
            source = source.replace(find, () => put.replace('$&', find));
        }
        return { ...out, source };
    },
});
