// Earth at a start time t₀ as a model start world (Earth replay study Q2, ~/obsidian/brain/projects/geo-sim-earth-replay-study.md).
// Model time 0 = t₀ Ma. It is a pure function of the t₀ inputs it is HANDED (`inputs`, below) and the mesh: it imports no file
// reader, so it cannot read an outcome — today's topography, CRUST1.0 and the rest are not reachable from here (the import graph is
// asserted by tools/earth-replay-start-check.mjs; the loader that fills `inputs` reads an allowlisted manifest only, Q5.5).
//
//   plates / cells   one model plate per reconstruction plate id, holding the cells the plate-id table gives it at t₀;
//                    pose = identity at t₀ (the world frame IS the t₀ frame). Cells no topology covers go to the nearest plate.
//   continent/ocean the continental polygons carried to t₀ (CONTINENT; CRATON inside a craton polygon; ARC inside an island-arc
//                    polygon, formedAt 0: the polygons carry no arc age); everything else is ocean. Mildly outcome-aware: today's continents rotated back know their outline.
//   ocean age        formedAt = −age, from the age grid AT t₀ (the model's default where the grid is silent, e.g. marginal basins).
//   continent age    the model's default (config.initialLandAgeMyr): nothing in the reconstruction gives it.
//   trenches         cells of the overriding plate along a topological SubductionZone, armed MATURE like the start world's rim
//                    trenches (the slab is already long). Not given: slab age and dip (the model's kind defaults).
// Not given, so left to the model's own defaults: crust thickness, standing belts, hotspots, sediment, rivers, climate. Never seeded
// from anything that postdates t₀.
//
// Not registered in any scene index or the lab (new files only); tools import `buildEarthStart` directly.
import { TectonicWorld, EventKind } from '../model/world.js';
import { CrustType, CrustFlag } from '../model/crust.js';

export const EARTH_CLASS = Object.freeze({ OCEAN: 0, CONTINENT: 1, CRATON: 2, ARC: 3 });

/**
 * @param {import('../../core/sim-mesh.js').SimMesh} simMesh
 * @param {number} seed  (the model's rng streams; the start itself draws none)
 * @param {{t0: number, plateIds: Uint16Array, crustClass: Uint8Array, trench: Uint8Array, ageMyr: Float32Array}} inputs
 *        per sim-mesh cell: reconstruction plate id at t₀ (0 = none), EARTH_CLASS, 1 on a trench, ocean-floor age at t₀ (NaN = none)
 * @returns {{world: TectonicWorld, start: {t0: number, plateOfId: Map<number, number>, idOfPlate: number[], unfilled: number}}}
 */
export function buildEarthStart(simMesh, seed, inputs, overrides = {}) {
    const { numCells, adjOffset, adjList } = simMesh, { t0, plateIds, crustClass, trench, ageMyr } = inputs;
    for (const [k, a] of Object.entries({ plateIds, crustClass, trench, ageMyr })) if (a.length !== numCells) throw new Error(`earth start: ${k} has ${a.length} cells, the mesh ${numCells}`);
    const world = new TectonicWorld(simMesh, seed, overrides), cfg = world.config;

    // Cells no topology covers (a sliver between resolved boundaries): the nearest covered cell's plate, spread outward hop by hop.
    const owner = Uint16Array.from(plateIds);
    let frontier = [], unfilled = 0;
    for (let c = 0; c < numCells; c++) if (!owner[c]) { unfilled++; frontier.push(c); }
    for (let guard = 0; frontier.length && guard < 50; guard++) {
        const next = [], give = new Map();
        for (const c of frontier) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (owner[adjList[k]]) { give.set(c, owner[adjList[k]]); break; }
        for (const [c, id] of give) owner[c] = id;
        for (const c of frontier) if (!owner[c]) next.push(c);
        frontier = next;
    }
    if (frontier.length) throw new Error(`earth start: ${frontier.length} cells reach no plate`);

    const plateOfId = new Map(), idOfPlate = [];
    for (let c = 0; c < numCells; c++) if (!plateOfId.has(owner[c])) {
        const p = world.addPlate(`P${owner[c]}`);
        plateOfId.set(owner[c], p.id); idOfPlate[p.id] = owner[c];
    }

    // Terranes: one per connected piece of continent on a plate (ids unique across the world: TectonicWorld.nextTerraneId).
    const terrane = new Uint16Array(numCells);
    const isLandish = c => crustClass[c] !== EARTH_CLASS.OCEAN;
    for (let c = 0; c < numCells; c++) {
        if (!isLandish(c) || terrane[c]) continue;
        const id = world.nextTerraneId(), stack = [c];
        terrane[c] = id;
        while (stack.length) {
            const u = stack.pop();
            for (let k = adjOffset[u]; k < adjOffset[u + 1]; k++) {
                const v = adjList[k];
                if (!terrane[v] && isLandish(v) && owner[v] === owner[c] && (crustClass[v] === EARTH_CLASS.ARC) === (crustClass[c] === EARTH_CLASS.ARC)) { terrane[v] = id; stack.push(v); }
            }
        }
    }

    for (let c = 0; c < numCells; c++) {
        const plate = world.plates[plateOfId.get(owner[c])], crust = plate.crust;
        switch (crustClass[c]) {
            case EARTH_CLASS.CONTINENT: crust.create(c, CrustType.CONTINENT, -cfg.initialLandAgeMyr, terrane[c]); break;
            case EARTH_CLASS.CRATON: crust.create(c, CrustType.CRATON, -cfg.initialLandAgeMyr, terrane[c]); break;
            case EARTH_CLASS.ARC: crust.create(c, CrustType.ARC, 0, terrane[c]); break;
            default: crust.create(c, CrustType.OCEAN, -(Number.isFinite(ageMyr[c]) ? ageMyr[c] : cfg.initialOceanAgeMyr));
        }
        if (trench[c]) crust.armTrench(c, cfg.slabMatureKm);
    }
    for (const p of world.plates) p.refreshExtent(simMesh.xyz);
    world.log(EventKind.START, `Earth at ${t0} Ma: ${world.plates.length} plates from the Müller 2019 reconstruction`, { t0, plates: world.plates.length });
    return { world, start: { t0, plateOfId, idOfPlate, unfilled } };
}
