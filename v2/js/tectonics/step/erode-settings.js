// The settings one history erosion step runs the finish's solver with (lane graded): a leaf file, so that app/history-key.js
// (gpuFingerprint) can read them without importing the history's steps (step/surface-erosion.js uses them).

import { ERODE } from '../../finish/finish-erode.js';

/** The settings one history erosion step runs with, for a span of `spanMyr`. The sea's law on (lane marine3, M3): the waves work
 *  the drowned continent, erosionRequest's marineField (step/surface-erosion.js), at the finish's K0 and wave base. */
export function historyErodeSettings(spanMyr) {
    return { ...ERODE, timeMyr: spanMyr, steps: 1, closedEvery: 1, rebound: 0, delta: false, column: false, hillD: 0, diffD: 0, kScale: 1, trace: false, marine: true };
}
