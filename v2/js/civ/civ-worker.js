// The civ layer's worker on the Evolution page (plans/CIV_PLAN.md): a finished moment's people (civ-page.js), from the
// world its finish sent (finish/finish-worker.js 'done' civ), so the page stays responsive through the run.
//
// Messages in:  {type: 'people', id, world (its mesh as arrays), width} — a run to now, kept to go on with ·
//               {type: 'more', id, run (the 'people' id), toBP, every} — go on with that run to toBP (past now: negative)
// Messages out: {type: 'progress', id, share} · {type: 'people', id, ...startPeople's result} ·
//               {type: 'more', id, ...morePeople's} · {type: 'error', id, message}

import { meshFromArrays } from '../core/sim-mesh.js';
import { startPeople, morePeople } from './civ-page.js';
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

const KEEP = 2;                 // (runs kept alive to go on with: the latest few moments')
const runs = new Map();
const moved = r => [r.frames.buffer, r.bp.buffer, r.people.buffer, r.farmers.buffer, ...r.towns.filter(Boolean).map(t => t.buffer)];   // (the rest is small: cloned)

self.onmessage = async ({ data }) => {
    const { id } = data;
    try {
        if (data.type === 'people') {
            const { world, width } = data, climate = await ensembleRuns(world);
            const { state, result } = startPeople({ ...world, mesh: meshFromArrays(world.mesh) }, width, share => self.postMessage({ type: 'progress', id, share }), climate);
            runs.set(id, state);
            while (runs.size > KEEP) runs.delete(runs.keys().next().value);
            self.postMessage({ type: 'people', id, ...result }, [...moved(result), result.pix.buffer, result.food.buffer]);
        } else if (data.type === 'more') {
            const state = runs.get(data.run);
            if (!state) throw new Error('that run is no longer kept');
            const r = morePeople(state, data.toBP, data.every);
            self.postMessage({ type: 'more', id, ...r }, moved(r));
        }
    } catch (err) {
        self.postMessage({ type: 'error', id, message: err?.stack ?? String(err) });
    }
};
