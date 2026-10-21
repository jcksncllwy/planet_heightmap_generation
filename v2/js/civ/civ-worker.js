// The civ layer's worker on the Evolution page (plans/CIV_PLAN.md): a finished moment's people (civ-page.js), from the
// world its finish sent (finish/finish-worker.js 'done' civ), so the page stays responsive through the run.
//
// Message in:  {type: 'people', id, world (its mesh as arrays), width}
// Messages out: {type: 'progress', id, share} · {type: 'people', id, ...peopleOfWorld's} · {type: 'error', id, message}

import { meshFromArrays } from '../core/sim-mesh.js';
import { peopleOfWorld } from './civ-page.js';

self.onmessage = ({ data }) => {
    if (data.type !== 'people') return;
    const { id, world, width } = data;
    try {
        const r = peopleOfWorld({ ...world, mesh: meshFromArrays(world.mesh) }, width, share => self.postMessage({ type: 'progress', id, share }));
        self.postMessage({ type: 'people', id, ...r }, [r.frames.buffer, r.bp.buffer, r.people.buffer, r.farmers.buffer, r.pix.buffer, ...r.towns.filter(Boolean).map(t => t.buffer)]);
    } catch (err) {
        self.postMessage({ type: 'error', id, message: err?.stack ?? String(err) });
    }
};
