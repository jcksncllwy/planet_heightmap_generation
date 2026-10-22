// The civ layer's worker on the Evolution page (plans/CIV_PLAN.md): a finished moment's people (civ-page.js), from the
// world its finish sent (finish/finish-worker.js 'done' civ), so the page stays responsive through the run.
//
// Message in:  {type: 'people', id, world (its mesh as arrays), width}
// Messages out: {type: 'progress', id, share} · {type: 'people', id, ...peopleOfWorld's} · {type: 'error', id, message}

import { meshFromArrays } from '../core/sim-mesh.js';
import { peopleOfWorld } from './civ-page.js';
import { ensembleForcings } from './climate-var.js';

/** The climate ensemble's runs, one worker each, all at once (or null, to run them in turn, where a worker cannot start
 *  workers of its own). */
async function ensembleRuns(world) {
    if (typeof Worker === 'undefined') return null;
    try {
        return await Promise.all(ensembleForcings().map(forcing => new Promise((resolve, reject) => {
            const w = new Worker(new URL('./climate-run-worker.js', import.meta.url), { type: 'module' });
            w.onmessage = ({ data }) => { w.terminate(); data.error ? reject(new Error(data.error)) : resolve(data.rain); };
            w.onerror = e => { w.terminate(); reject(new Error(e.message || 'the climate run stopped')); };
            w.postMessage({ xyz: world.mesh.xyz, z: world.z, ocean: world.ocean, forcing });
        })));
    } catch (err) {
        console.warn('[civ] the climate ensemble in turn:', err);
        return null;
    }
}

self.onmessage = async ({ data }) => {
    if (data.type !== 'people') return;
    const { id, world, width } = data;
    try {
        const runs = await ensembleRuns(world);
        const r = peopleOfWorld({ ...world, mesh: meshFromArrays(world.mesh) }, width, share => self.postMessage({ type: 'progress', id, share }), runs);
        self.postMessage({ type: 'people', id, ...r }, [r.frames.buffer, r.bp.buffer, r.people.buffer, r.farmers.buffer, r.pix.buffer, ...r.towns.filter(Boolean).map(t => t.buffer)]);
    } catch (err) {
        self.postMessage({ type: 'error', id, message: err?.stack ?? String(err) });
    }
};
