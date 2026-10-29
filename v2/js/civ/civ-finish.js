// What the finish (v2/js/finish/finish.js) gathers for the civ layer while it works out a moment's climate — only when
// asked for it (finishPlanet's civ option; the Evolution page's People switch). Loaded by the finish on demand, so a
// finish without people loads none of the civ layer.

import { vectorCollector } from './disease.js';
import { cropCollector } from './crops.js';

/** The cells' disease vectors' and crops' climates, from each cell's twelve months as the finish's climate gives them. */
export function civCollector(n, latRadOf) {
    const vectors = vectorCollector(n), crops = cropCollector(n, latRadOf);
    return {
        add(c, T12, P12) { vectors.add(c, T12, P12); crops.add(c, T12, P12); },
        get fields() { return { vector: vectors.vector, crops: crops.crops }; },
    };
}

/** The winds and the surface currents by month, m/s, on the climate's grid, for the civ layer's travel (routes.js): the
 *  year's currents each month where the ocean has no seasons, calm where it was not run. */
export function travelFlow(grid, circ, ocean) {
    const G = grid.w * grid.h, curOf = k => ocean?.monthly?.[k] ?? (ocean?.[k] ? Float32Array.from({ length: 12 * G }, (_, i) => ocean[k][i % G]) : new Float32Array(12 * G));
    return { w: grid.w, h: grid.h, windU: Float32Array.from(circ.u), windV: Float32Array.from(circ.v), curU: Float32Array.from(curOf('u')), curV: Float32Array.from(curOf('v')) };
}
