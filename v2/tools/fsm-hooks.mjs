// (the loader hook: finish.js's import of finish-fsm.js, and only that one, goes to tools/fsm-shim.mjs)
const SHIM = new URL('./fsm-shim.mjs', import.meta.url).href;
export async function resolve(spec, context, next) {
    if (spec === './finish-fsm.js' && context.parentURL?.endsWith('/finish/finish.js')) return { url: SHIM, shortCircuit: true };
    return next(spec, context);
}
