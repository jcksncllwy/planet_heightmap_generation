// The starting condition of every history (WBP Part Va): one supercontinent of lettered
// cratons wrapped in accreted crust, on a single plate that also carries an apron of old ocean
// with a trench along its rim, all set in one passive pre-history ocean.

import { SimplexNoise } from '../../../../js/simplex-noise.js';
import { makeRng } from '../../../../js/rng.js';
import { TECTONICS } from '../config.js';
import { TectonicWorld, EventKind } from '../model/world.js';
import { CrustType, CrustFlag } from '../model/crust.js';
import { tangentBasis } from '../../core/sphere-geom.js';
import { placeCratons } from './cratons.js';
import { shapeLandmass } from './landmass.js';
import { plateOutlineWithApron, chooseActiveRim } from './rim-trench.js';

const MAX_ATTEMPTS = 24;
const RELAX_SPAN_AFTER = 18;        // the extent cap is a preference; the spacing promises are never relaxed
const FRACTION_TOLERANCE = 0.004;   // how far from the requested continental fraction still counts as a fit

/**
 * @param {Partial<typeof TECTONICS>} [overrides]  tunables that differ from the defaults; they become world.config
 * @returns {{world: TectonicWorld, start: Object}} `start` = layout facts (cratons, centre, passive sector, …)
 */
export function buildStartWorld(simMesh, seed, overrides = {}) {
    const world = new TectonicWorld(simMesh, seed, overrides), cfg = world.config;
    const found = findLayout(simMesh, seed, cfg);
    if (!found) throw new Error(`These settings do not fit on the planet for seed ${seed}: the cratons, the required gaps between them and their margins need more room than the requested continental area allows.`);
    const { layout, land, rng, middle } = found;
    const { numCells } = simMesh;

    const isLand = Uint8Array.from(land.type, t => (t === CrustType.OCEAN ? 0 : 1));
    const { inPlate, rim } = plateOutlineWithApron(simMesh, isLand, cfg);
    const reference = tangentBasis(middle)[0];
    const trench = chooseActiveRim(simMesh, rim, middle, reference, cfg.rimTrenchCoverage, rng);

    const continent = world.addPlate(layout.cratons.map(c => c.letter).join(''));
    const ocean = world.addPlate('Pre-history ocean');
    ocean.isBackground = true;
    for (let c = 0; c < numCells; c++) {
        if (!inPlate[c]) { ocean.crust.create(c, CrustType.OCEAN, -cfg.initialOceanAgeMyr); continue; }
        if (land.type[c] === CrustType.OCEAN) {
            continent.crust.create(c, CrustType.OCEAN, -cfg.initialOceanAgeMyr);
            continent.crust.flags[c] |= CrustFlag.APRON;
            if (trench.active[c]) continent.crust.armTrench(c, cfg.slabMatureKm);       // rim trenches start mature
        } else {
            continent.crust.create(c, land.type[c], -cfg.initialLandAgeMyr, land.terrane[c]);
            if (land.suture[c]) continent.crust.flags[c] |= CrustFlag.SUTURE;
        }
    }
    for (const p of world.plates) p.refreshExtent(simMesh.xyz);
    world.terraneLetters = Object.fromEntries(layout.cratons.map(c => [c.id, c.letter]));
    continent.born = -cfg.riftTenureMyr;                  // assembled in prehistory: it may rift from the first step (developer: within ~30 Myr)
    world.log(EventKind.START, `Supercontinent ${continent.name}: ${layout.cratons.length} cratons, ringed by subduction`, { plate: continent.id, cratons: layout.cratons.length });

    return {
        world,
        start: {
            cratons: layout.cratons, centre: middle, reference, elongation: layout.elongation,
            skirtKm: land.skirtKm, rim, passiveFrom: trench.passiveFrom, passiveTo: trench.passiveTo,
            attempts: found.attempts, cratonAreaScale: found.areaScale, fractionMet: found.fractionMet,
            config: cfg, continentId: continent.id, oceanId: ocean.id,
        },
    };
}

/**
 * Search for a craton layout + landmass that honours the priorities: (1) the spacing minimums, never
 * relaxed; (2) the continental fraction, hit as closely as possible; (3) the requested craton size, which
 * gives way. Each layout is tried with the cratons at full size first and then progressively smaller,
 * until the land the spacing rules force (cratons + their sea margins + the belts joining them) fits
 * inside the requested fraction. Later attempts use rounder, tighter clusters.
 */
function findLayout(simMesh, seed, cfg) {
    const { numCells } = simMesh, roundSpan = Math.acos(1 - 2 * cfg.continentalFraction) * 180 / Math.PI;
    let closest = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        let fit = null;
        for (const areaScale of shrinkSteps(cfg.cratonMinAreaScale)) {
            const rng = makeRng(seed * 31 + attempt * 7919 + 17), noise = new SimplexNoise(seed + attempt * 101);
            const stretch = 1 - attempt / MAX_ATTEMPTS;
            const layout = placeCratons(rng, cfg, stretch, areaScale);
            const land = layout && shapeLandmass(simMesh, layout.cratons, layout.centre, noise, cfg, stretch);
            if (!land) continue;                                   // did not pack, or the cratons are not joined into one landmass
            let cells = 0;
            for (let c = 0; c < numCells; c++) if (land.type[c] !== CrustType.OCEAN) cells++;
            const excess = cells / numCells - cfg.continentalFraction;
            const candidate = { layout, land, rng, areaScale, excess, attempts: attempt + 1 };
            if (!closest || Math.abs(excess) < Math.abs(closest.excess)) closest = candidate;
            if (Math.abs(excess) <= FRACTION_TOLERANCE) { fit = candidate; break; }
        }
        const chosen = fit ?? (attempt === MAX_ATTEMPTS - 1 ? closest : null);
        if (!chosen) continue;
        chosen.middle = landCentroid(simMesh, chosen.land.type);
        const tooWide = halfSpanDeg(simMesh, chosen.land.type, chosen.middle) > roundSpan + cfg.spanAllowanceDeg;
        if (fit && tooWide && attempt < RELAX_SPAN_AFTER) continue;
        return { ...chosen, fractionMet: !!fit, attempts: attempt + 1 };
    }
    return null;
}

/** Craton area factors to try, from full size down to the floor: 1, 0.85, 0.72, … , floor. */
function shrinkSteps(floor) {
    const lowest = Math.max(0.05, Math.min(1, floor)), steps = [];
    for (let k = 1; k > lowest; k *= 0.85) steps.push(k);
    steps.push(lowest);
    return steps;
}

function landCentroid(simMesh, type) {
    const { xyz, numCells } = simMesh;
    let sx = 0, sy = 0, sz = 0;
    for (let c = 0; c < numCells; c++) if (type[c] !== CrustType.OCEAN) { sx += xyz[3 * c]; sy += xyz[3 * c + 1]; sz += xyz[3 * c + 2]; }
    const l = Math.hypot(sx, sy, sz) || 1;
    return [sx / l, sy / l, sz / l];
}

function halfSpanDeg(simMesh, type, middle) {
    const { xyz, numCells } = simMesh;
    let far = 1;
    for (let c = 0; c < numCells; c++) {
        if (type[c] === CrustType.OCEAN) continue;
        const d = xyz[3 * c] * middle[0] + xyz[3 * c + 1] * middle[1] + xyz[3 * c + 2] * middle[2];
        if (d < far) far = d;
    }
    return Math.acos(Math.max(-1, far)) * 180 / Math.PI;
}

