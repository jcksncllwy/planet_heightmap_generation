// Building blocks for hand-made test scenes: drop a noise-shaped continent onto a plate, give it
// an ocean apron with a trench on chosen stretches of its rim, attach a patch of ocean to a
// plate, and fill everything left over with the passive pre-history ocean.
// Azimuths are degrees about the continent's centre: 0° = east, 90° = north, 180° = west.

import { PLANET_RADIUS_KM } from '../../core/sim-mesh.js';
import { polarFrame, tangentBasis } from '../../core/sphere-geom.js';
import { touches } from '../../core/mesh-bfs.js';
import { CrustType, CrustFlag } from '../model/crust.js';
import { latLonToXyz } from '../step/kinematics.js';
import { plateOutlineWithApron } from '../init/rim-trench.js';
import { PREHISTORY } from '../init/prehistory-ocean.js';

/** Tracks which sim cells a scene has already given to some plate. */
export function sceneCanvas(simMesh, cfg) { return { mesh: simMesh, taken: new Uint8Array(simMesh.numCells), landAgeMyr: cfg.initialLandAgeMyr, lastTerrane: 0 }; }

/** A terrane id no other piece of this scene uses (terrane ids are unique across a world: see TectonicWorld.nextTerraneId). */
export function sceneTerrane(canvas) { return ++canvas.lastTerrane; }

/**
 * @param {{plate, centre:[number,number], radiusKm:number, cratonKm?:number, wobble?:number}} o
 * @returns {{centre:number[], isLand:Uint8Array}}
 */
export function addContinent(canvas, noise, { plate, centre, radiusKm, cratonKm = radiusKm * 0.4, wobble = 0.22 }) {
    const { mesh, taken } = canvas, { xyz, numCells } = mesh;
    const c = latLonToXyz(centre[0], centre[1]), isLand = new Uint8Array(numCells);
    const k = (centre[0] * 0.37 + centre[1] * 0.11) % 17;          // de-correlate the outlines of different continents
    const terrane = sceneTerrane(canvas);
    for (let i = 0; i < numCells; i++) {
        if (taken[i]) continue;
        const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
        const d = Math.acos(Math.max(-1, Math.min(1, x * c[0] + y * c[1] + z * c[2]))) * PLANET_RADIUS_KM;
        const shaped = d * (1 + wobble * noise.fbm(x * 2.3 + k, y * 2.3 + k, z * 2.3 + k, 5));
        if (shaped > radiusKm) continue;
        plate.crust.create(i, shaped < cratonKm ? CrustType.CRATON : CrustType.CONTINENT, -canvas.landAgeMyr, terrane);
        isLand[i] = 1; taken[i] = 1;
    }
    return { centre: c, isLand };
}

/**
 * Give a continent's plate an apron of old ocean and flag its rim as trench inside the given
 * azimuth sectors ('all', or a list of [fromDeg, toDeg]; empty list = passive all round).
 */
export function addApronAndTrench(canvas, plate, continent, sectors, cfg) {
    const { mesh, taken } = canvas, { xyz, numCells } = mesh;
    const { inPlate, rim } = plateOutlineWithApron(mesh, continent.isLand, cfg);
    for (let i = 0; i < numCells; i++) {
        if (!inPlate[i] || taken[i]) continue;
        plate.crust.create(i, CrustType.OCEAN, PREHISTORY);
        plate.crust.flags[i] |= CrustFlag.APRON;
        taken[i] = 1;
    }
    const toPolar = polarFrame(continent.centre, tangentBasis(continent.centre)[0]);
    for (const i of rim) if (plate.crust.mask[i] && inSectors(toPolar(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]).azimuth, sectors)) plate.crust.armTrench(i, cfg.slabMatureKm);
}

/** Arm the coast cells of a land-only plate (no apron) as a mature trench inside the given sectors. */
export function flagCoastTrench(mesh, plate, centreXyz, sectors, cfg) {
    const { xyz, numCells } = mesh, crust = plate.crust;
    const toPolar = polarFrame(centreXyz, tangentBasis(centreXyz)[0]);
    for (let i = 0; i < numCells; i++) {
        if (!crust.mask[i] || !touches(mesh, i, nb => !crust.mask[nb])) continue;
        if (inSectors(toPolar(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]).azimuth, sectors)) crust.armTrench(i, cfg.slabMatureKm);
    }
}

/** Attach free ocean cells chosen by `wanted(x, y, z)` to a plate (ordinary ocean floor, not apron). */
export function addOcean(canvas, plate, wanted, formedAt) {
    const { mesh, taken } = canvas, { xyz, numCells } = mesh;
    for (let i = 0; i < numCells; i++) {
        if (taken[i] || !wanted(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2])) continue;
        plate.crust.create(i, CrustType.OCEAN, formedAt);
        taken[i] = 1;
    }
}

/** Everything not yet claimed becomes the passive pre-history ocean. */
export function fillBackground(canvas, world, cfg) {
    const ocean = world.addPlate('Pre-history ocean');
    ocean.isBackground = true;
    for (let i = 0; i < canvas.mesh.numCells; i++) if (!canvas.taken[i]) ocean.crust.create(i, CrustType.OCEAN, PREHISTORY);
    for (const p of world.plates) p.refreshExtent(canvas.mesh.xyz);
    return ocean;
}

/**
 * Each scene plate's own ocean, aged as the floor of a plate whose ridge is its far edge: oldest at its trench, younger away
 * from it, 0 at the ridge farthest from any trench. A scene's ocean of one age (initialOceanAgeMyr) puts 0 Myr floor, opened
 * behind a moving plate, against 150 Myr floor: a step of the whole of the old floor's GPE that no ridge makes (forces.js
 * ridgePushGpe). Distances are walked through the plate's own ocean from its trench (its own trench cells, or those it faces
 * on another plate). The ridge is where the plate's ocean meets the pre-history ocean, which does not move, so the plate laid
 * all its floor there at the whole spreading rate (SCENE_SPREAD_KM_PER_MYR) — or, for the pairs in `ridges` ([plateA, plateB]
 * ids: two scene plates whose oceans meet at a spreading ridge; a plate may have several), where it meets a partner's ocean: each side then got half
 * the floor, at half the rate. A plate in such a pair is aged from that ridge alone, trench or not: its floor's age is its
 * distance from the ridge at half the rate, walked across the plate's own crust (ocean and continent alike, so a continent
 * riding on the plate does not bend the isochrons around it), and its isochrons lie along the ridge, not along whatever trench
 * the far edge happens to meet. (Aged back from the trench, India's floor took the shape of Asia's trench arc: ~20 Myr older
 * east of India than west at one latitude, and the GPE at its coasts pushed it west at ~5 cm/yr. Lane gpelock 2026-11-25.)
 * Ages are capped at initialOceanAgeMyr. A plate with neither a passive edge nor a trench keeps its ages. Call after
 * fillBackground.
 */
export function ageFromRidges(world, cfg, ridges = []) {
    const { mesh, plates } = world, { numCells, adjOffset, adjList, edgeKm } = mesh, bg = plates.find(p => p.isBackground);
    const own = new Int32Array(numCells).fill(-1);
    for (const p of plates) for (let c = 0; c < numCells; c++) if (p.crust.mask[c]) own[c] = p.id;
    const trenchAt = c => own[c] >= 0 && (plates[own[c]].crust.flags[c] & CrustFlag.TRENCH) !== 0;
    const partnerOf = new Map();                                                           // plate id → its ridge partners' ids
    for (const [x, y] of ridges) for (const [u, v] of [[x, y], [y, x]]) (partnerOf.get(u) ?? partnerOf.set(u, new Set()).get(u)).add(v);
    for (const p of plates) {
        if (p.isBackground) continue;
        const K = p.crust, ocean = c => own[c] === p.id && K.type[c] === CrustType.OCEAN, partner = partnerOf.get(p.id);
        const atPartner = c => partner !== undefined && !trenchAt(c) && touches(mesh, c, nb => partner.has(own[nb]) && plates[own[nb]].crust.type[nb] === CrustType.OCEAN && !trenchAt(nb));
        const D = new Float64Array(numCells).fill(Infinity), queue = [];
        if (partner !== undefined) {                                                        // aged from its ridge alone
            for (let c = 0; c < numCells; c++) if (ocean(c) && atPartner(c)) { D[c] = 0; queue.push(c); }
            walk(queue, D, c => own[c] === p.id);
            for (const c of queue) if (ocean(c)) K.formedAt[c] = -Math.min(cfg.initialOceanAgeMyr, D[c] / (SCENE_SPREAD_KM_PER_MYR / 2));
            continue;
        }
        for (let c = 0; c < numCells; c++) {
            if (!ocean(c)) continue;
            let front = trenchAt(c);
            for (let k = adjOffset[c]; !front && k < adjOffset[c + 1]; k++) { const nb = adjList[k]; front = own[nb] !== p.id && own[nb] !== bg?.id && trenchAt(nb); }
            if (front) { D[c] = 0; queue.push(c); }
        }
        walk(queue, D, ocean);
        let ridgeKm = -1;
        const rate = SCENE_SPREAD_KM_PER_MYR;
        for (const c of queue) {
            if (trenchAt(c) || !(D[c] > ridgeKm)) continue;
            if (touches(mesh, c, nb => own[nb] === bg?.id)) ridgeKm = D[c];
        }
        if (!(ridgeKm > 0)) continue;
        for (const c of queue) K.formedAt[c] = -Math.min(cfg.initialOceanAgeMyr, Math.max(0, ridgeKm - D[c]) / rate);
    }
    function walk(queue, D, ocean) {
        for (let i = 0; i < queue.length; i++) {
            const c = queue[i];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (ocean(nb) && D[nb] === Infinity) { D[nb] = D[c] + edgeKm; queue.push(nb); } }
        }
    }
}
/** The rate a scene plate's ocean was laid at by its ridge: the full spreading rate of Earth's ridges on average, ~3.4 km²/yr
 *  of new floor (Rowley 2002, GSA Bull. 114) over ~62,000 km of ridge (recalled) ≈ 5.5 cm/yr. (The pre-history ocean does not
 *  move: the gap a plate opens behind it is all its own, at its whole speed, as this floor was.) */
export const SCENE_SPREAD_KM_PER_MYR = 55;

function inSectors(azimuth, sectors) {
    if (sectors === 'all') return true;          // (a [0, 360] pair would wrap to a single point — say 'all' instead)
    return sectors.some(([from, to]) => (((azimuth - from) % 360) + 360) % 360 <= (((to - from) % 360) + 360) % 360);
}
