// The new climate for any planet — the one call a generator makes. DOM-free; runs in a worker or in Node.
//
//   planetClimate({ xyz, elevKm, axes, land? }, options?) → computeClimate's result: per terrain cell
//   cell.koppen (Köppen id, V1's class table), cell.tAnnual (°C), cell.pAnnual (mm/year); on the 1° climate grid
//   months.T and months.P (12 monthly layers, °C at each grid cell's reference height, mm/month) and every stage's
//   fields (stages.temperature, .circulation, .ocean, .rain); timing.
//
// Evolution's frames: xyz on the unit sphere with z north (axes 'z-up'), heights in km with the sea at 0. V1's planets:
// y north ('y-up'). The climate is computed on a fixed lat-lon grid, so it is the same at every terrain resolution.

import { computeClimate, computeClimateAsync } from './core.js';
import { energyBalanceTemperature } from './temperature.js';
import { derivedCirculation } from './circulation.js';
import { windDrivenOcean } from './ocean.js';
import { columnWaterRain } from './rain.js';

/** The stages of the whole new climate: temperature ↔ pressure and wind ↔ ocean, then rain, then clouds. (The planet's star
 *  and orbit reach them as options.system: planet-system.js, Earth's by default.) */
export function climateStages() {
    return { temperature: energyBalanceTemperature(), circulation: derivedCirculation(), ocean: windDrivenOcean(), rain: columnWaterRain() };
}

/**
 * @param {{xyz: Float32Array|Float64Array, elevKm: Float32Array, axes: 'y-up'|'z-up', land?: Uint8Array}} input
 * @param {object} [options]  core options (anchors, lapseRateCPerKm, greenhouseWm2, precipScale, …) and system (planet-system.js)
 */
export function planetClimate(input, options = {}) {
    return computeClimate(input, { ...options, stages: climateStages(options) });
}

/** planetClimate with its solves on `solver` (a factory whose solvers answer asynchronously: gpu/climate-solver.js) — the finish's. */
export function planetClimateAsync(input, options = {}) {
    return computeClimateAsync(input, { ...options, stages: climateStages(options) });
}
