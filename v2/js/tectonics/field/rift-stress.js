// Where a continent breaks, from its stress (lane pstress, stage 2; config.riftByStress). A rift opens where the plate's own
// stress (field/plate-stress-field.js) pulls hardest against the strength of the ground (field/stress-step.js strengthOf:
// rock, old weak lines, damage), and runs across the pull: a fault opens normal to the most tensile stress.
//   - the junction: the land cells where s1 ÷ strength is highest (tension over strength), spread apart, deep enough inland;
//   - the arms: cheapest paths over the land at a cost per km of strength ÷ the tension across the step (the normal stress
//     on the plane the step runs along: s1 (n·d1)² + s2 (1 − (n·d1)²), n the step's normal, d1 s1's direction), × the grain
//     (ops/rift-path.js grainOf: the crust's old fabric). Where nothing pulls (tension under riftStressFloor), the floor
//     holds the cost finite, and the weakest ground breaks, as before.
// When a rift happens stays as it was (step/rifting.js: the chance per Myr, the pace, plumes, overdue pieces): only WHERE is
// the stress's. Stopgap with an exit plan: the timing goes to the yield test once the force scale and the continents' strength
// are settled (stress-field study, rank 3).
//
// Everything a search reads is per raster cell of the plate, worked out here once per rift (riftStressContext), so a helper
// worker (app/helper-worker.js) gets it with the rest of ops/rift-path.js's context.

import { CrustType } from '../model/crust.js';
import { solvePlateStress, stressAt } from './plate-stress-field.js';
import { strengthOf } from './stress-step.js';
import { MinHeap } from '../../core/min-heap.js';

/**
 * The plate's stress and strength per raster cell (NaN where its cell is not in the world view: under another plate).
 * The stress is the last solve's if no older than plateStressEveryMyr, else solved now.
 * @returns {{s1: Float32Array, s2: Float32Array, dir: Float32Array, strength: Float32Array, floor: number}|null}
 */
export function riftStressContext(world, plate) {
    const { mesh, config, time } = world, { numCells, xyz, index } = mesh, crust = plate.crust;
    if (!world.loads) return null;
    if (plate.riftStress?.at === time && plate.riftStress.version === crust.version && plate.riftStress.loads === world.loads) return plate.riftStress.st;
    if (!world.plateStress || time - world.plateStress.at > config.plateStressEveryMyr + 1e-9) solvePlateStress(world);
    if (!world.plateStress) return null;
    const s1 = new Float32Array(numCells).fill(NaN), s2 = new Float32Array(numCells).fill(NaN), dir = new Float32Array(3 * numCells), strength = new Float32Array(numCells);
    const p = [0, 0, 0], s = { s1: 0, s2: 0, dir: [0, 0, 0] }, back = [0, 0, 0];
    for (let c = 0; c < numCells; c++) {
        if (!crust.mask[c]) continue;
        strength[c] = strengthOf(crust, c, time, config);
        plate.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], p);
        const w = index.nearest(p[0], p[1], p[2]);
        if (world.owner[w] !== plate.id || world.ownerCell[w] !== c || !stressAt(world, w, s)) continue;
        s1[c] = s.s1; s2[c] = s.s2;
        plate.toPlateFrame(s.dir[0], s.dir[1], s.dir[2], back);         // (the direction in the plate's frame, as the raster is)
        dir[3 * c] = back[0]; dir[3 * c + 1] = back[1]; dir[3 * c + 2] = back[2];
    }
    const st = { s1, s2, dir, strength, floor: config.riftStressFloor * config.forceUnitNPerM };
    plate.riftStress = { at: time, version: crust.version, loads: world.loads, st };
    return st;
}

/**
 * Junctions for a rift without a plume: the land cells (not craton) at least riftMinArmKm from the coast, highest s1 ÷ strength
 * first, each at least riftMinArmKm from those taken before. @returns raster cells (up to `count`)
 */
export function stressJunctions(world, plate, st, count) {
    const { mesh, config } = world, { adjOffset, adjList, numCells, edgeKm, xyz } = mesh, crust = plate.crust;
    const land = c => crust.mask[c] && crust.type[c] !== CrustType.OCEAN;
    const dist = new Int16Array(numCells).fill(-1);
    let frontier = [];
    for (let c = 0; c < numCells; c++) { if (!land(c)) continue; for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (!land(adjList[k])) { dist[c] = 0; frontier.push(c); break; } }
    for (let d = 1; frontier.length; d++) { const next = []; for (const c of frontier) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (land(nb) && dist[nb] < 0) { dist[nb] = d; next.push(nb); } } frontier = next; }
    const minHops = Math.ceil(config.riftMinArmKm / edgeKm), cand = [];
    for (let c = 0; c < numCells; c++) if (land(c) && dist[c] >= minHops && crust.type[c] !== CrustType.CRATON && st.s1[c] === st.s1[c]) cand.push(c);
    cand.sort((a, b) => st.s1[b] / st.strength[b] - st.s1[a] / st.strength[a] || a - b);
    const out = [], cosApart = Math.cos(config.riftMinArmKm / 6371);
    for (const c of cand) {
        if (out.length >= count) break;
        if (out.some(o => xyz[3 * o] * xyz[3 * c] + xyz[3 * o + 1] * xyz[3 * c + 1] + xyz[3 * o + 2] * xyz[3 * c + 2] > cosApart)) continue;
        out.push(c);
    }
    return out;
}

/**
 * Cheapest paths from `junction` over the plate's land at the stress's cost (above): { cost, from } as ops/rift-path.js
 * cheapestPaths has them. A cell with no stress (under another plate) costs as the floor does.
 */
export function stressPaths(mesh, crust, junction, st, grain) {
    const { adjOffset, adjList, numCells, xyz } = mesh, cost = new Float64Array(numCells).fill(Infinity), from = new Int32Array(numCells).fill(-1);
    const land = c => crust.mask[c] && crust.type[c] !== CrustType.OCEAN, heap = new MinHeap();
    cost[junction] = 0; heap.push(0, junction);
    while (heap.size) {
        const a = heap.pop(), key = heap.lastKey;
        if (key > cost[a]) continue;
        const ax = xyz[3 * a], ay = xyz[3 * a + 1], az = xyz[3 * a + 2];
        for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
            const b = adjList[k];
            if (!land(b)) continue;
            let dx = xyz[3 * b] - ax, dy = xyz[3 * b + 1] - ay, dz = xyz[3 * b + 2] - az;
            const km = Math.hypot(dx, dy, dz) * 6371;
            // the step's normal in the tangent plane at b (n = r × d), and the stress normal to the plane it runs along
            const bx = xyz[3 * b], by = xyz[3 * b + 1], bz = xyz[3 * b + 2], along = dx * bx + dy * by + dz * bz;
            dx -= along * bx; dy -= along * by; dz -= along * bz;
            let nx = by * dz - bz * dy, ny = bz * dx - bx * dz, nz = bx * dy - by * dx;
            const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
            let sigma = st.floor;
            if (st.s1[b] === st.s1[b]) {
                const c = nx * st.dir[3 * b] + ny * st.dir[3 * b + 1] + nz * st.dir[3 * b + 2], c2 = c * c;
                sigma = Math.max(st.floor, st.s1[b] * c2 + st.s2[b] * (1 - c2));
            }
            const v = key + km * grain(b) * st.strength[b] / sigma;
            if (v < cost[b]) { cost[b] = v; from[b] = a; heap.push(v, b); }
        }
    }
    return { cost, from };
}
