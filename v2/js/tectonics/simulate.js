// The stepping loop:   move plates → resolve crust → classify boundaries → events → set the plates' motion.
// Motion comes from a `drive(world)` callback so the same loop serves prescribed test scenes and the
// force model (step/torque-balance.js `updatePlateMotion`). `drive` always sees a freshly resolved
// world, including at time 0, and `world.lastDt` tells it how long the last step was.

import { advancePlates } from './step/kinematics.js';
import { resolve } from './step/resolve.js';
import { classifyBoundaries } from './step/boundaries.js';
import { trackCollisions } from './step/collision.js';
import { growWings, buildArcs } from './step/wings.js';
import { collapseArcs } from './ops/collapse-arc.js';
import { tidyPlates, fillPinholes } from './ops/tidy-plates.js';
import { riftContinents } from './step/rifting.js';
import { initiateSubduction } from './step/subduction-init.js';
import { updateHotspots } from './step/hotspots.js';
import { openBackArcs, steerBackArcStrips } from './step/backarc.js';
import { growMarginIsles } from './step/margin-isles.js';
import { captureFrame } from './snapshot.js';
import { evolveHeights } from './step/heights.js';
import { CM_PER_YR_TO_RAD_PER_MYR } from './config.js';

/**
 * @param {import('./model/world.js').TectonicWorld} world
 * @param {Object} opts
 * @param {number} opts.untilMyr
 * @param {(world) => void} opts.drive          sets plate.omega for the coming step
 * @param {number} [opts.snapshotEveryMyr]      defaults to world.config.snapshotEveryMyr; a multiple of config.stepGridMyr, so
 *                                              that recording a history more or less often never changes it
 * @param {boolean} [opts.events]               run the event rules (collisions, belts, sutures, terranes, wings, arcs); false = kinematics and crust only
 * @param {(frame) => void} [opts.onFrame]      called with each frame as it is recorded (a worker streams them out; the
 *                                              history itself does not depend on it)
 * @returns {{frames: import('./snapshot.js').Frame[], steps: number, stepLog: Object[]}}
 *          frames[0] is the world as handed in (time 0 for a new world — a world can also be run on from
 *          where an earlier call stopped); then one frame per snapshot interval; the last is exactly untilMyr
 */
export function simulate(world, { untilMyr, drive, snapshotEveryMyr = world.config.snapshotEveryMyr, events = true, onFrame = null }) {
    const frames = [], stepLog = [];
    const record = frame => { frames.push(frame); onFrame?.(frame); };
    for (const p of world.plates) p.refreshExtent(world.mesh.xyz);
    resolve(world);
    if (events && tidyPlates(world)) resolve(world);         // a scene may hand a plate cells that are not joined to it: settle that before anything moves
    classifyBoundaries(world, 0);
    drive(world);
    steerBackArcStrips(world);
    record(captureFrame(world));

    // Steps never cross a multiple of stepGridMyr (and end exactly at untilMyr); snapshots are taken on that grid.
    // The steps a history takes therefore depend on the world alone — never on how often it is recorded.
    const grid = world.config.stepGridMyr;
    let nextSnapshot = Math.min(world.time + snapshotEveryMyr, untilMyr);
    while (world.time < untilMyr - 1e-9) {
        const nextGrid = (Math.floor(world.time / grid + 1e-9) + 1) * grid;
        const dt = Math.min(chooseStep(world), nextGrid - world.time, untilMyr - world.time);
        const cellsMoved = closingRate(world) * dt / world.mesh.edgeRad;
        advancePlates(world, dt);
        world.lastDt = dt;
        const tally = resolve(world);
        classifyBoundaries(world, dt);
        if (events) {
            // The event stages, in order. The world view (owner / ownerCell) was built by the resolve above; a stage that
            // adds, removes or rewrites a plate's cells marks it reshaped, and later stages skip reshaped plates or read
            // the plate's own raster (README: "Rules for event stages and ops"). Each returns how much it changed.
            let changed = 0;
            updateHotspots(world, dt);                 // plumes, LIPs, tracks — first, on the fresh view: stamps records only, queues plume rifts
            changed += trackCollisions(world, dt) ? 1 : 0;   // collision records, belts, sutures, docking, arc scraping (merges plates)
            changed += growWings(world, dt);           // trench wings capture passive ocean
            changed += buildArcs(world);               // island arcs behind mature ocean trenches (cell types only)
            changed += collapseArcs(world);            // an arc near its own coast lands on it
            changed += growMarginIsles(world, dt);     // fore-arc islands rise and join the coast (cell types only)
            changed += riftContinents(world, dt);      // plume and tension rifts (splits plates)
            changed += openBackArcs(world, dt);        // rolling-back trenches split off strips; finished strips rejoin
            changed += initiateSubduction(world, dt);  // passive margins founder (may carve an ocean plate)
            changed += tidyPlates(world);              // fragments join a neighbour; ocean scraps go to the passive ocean
            if (changed) {                              // crust changed: the world view must be rebuilt before anything reads it
                for (const p of world.plates) if (p.dirty) p.refreshExtent(world.mesh.xyz);
                resolve(world);
                if (fillPinholes(world)) { for (const p of world.plates) if (p.dirty) p.refreshExtent(world.mesh.xyz); resolve(world); }
                classifyBoundaries(world, 0);
            }
        }
        evolveHeights(world, dt);                           // heights wear down and spread (records only: nothing below reads them)
        drive(world);
        steerBackArcStrips(world);                          // a back-arc strip follows its retreating trench, whatever drives the rest
        stepLog.push({ time: world.time, dt, cellsMoved, ...tally });
        if (world.time >= nextSnapshot - 1e-9) {
            record(captureFrame(world));
            nextSnapshot = Math.min(nextSnapshot + snapshotEveryMyr, untilMyr);
        }
    }
    return { frames, steps: world.step, stepLog };
}

/** The fastest rate (rad/Myr) at which any two plates could be closing: the two largest |ω| added. */
function closingRate(world) {
    let first = 0, second = 0;
    for (const p of world.plates) {
        if (!p.alive) continue;
        const rate = Math.hypot(p.omega[0], p.omega[1], p.omega[2]);
        if (rate > first) { second = first; first = rate; } else if (rate > second) second = rate;
    }
    return first + second;
}

// Adaptive step: two plates closing head-on may together cover at most `maxCellsPerStep` cells, so
// convergence and divergence are always resolved about a cell at a time — at any resolution (a finer mesh takes
// more, shorter steps). The floor is the step two plates at the oceanic speed limit would need, so it scales with
// the mesh too; it only matters if something runs faster than the limits allow.
export function chooseStep(world) {
    const { maxStepMyr, maxCellsPerStep, maxSpeedOceanic } = world.config, rate = closingRate(world);
    const floor = maxCellsPerStep * world.mesh.edgeRad / (2 * maxSpeedOceanic * CM_PER_YR_TO_RAD_PER_MYR);
    if (rate < 1e-12) return maxStepMyr;
    return Math.max(floor, Math.min(maxStepMyr, maxCellsPerStep * world.mesh.edgeRad / rate));
}
