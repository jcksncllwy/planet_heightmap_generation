// The stress a plate carries inside it. A plate is rigid: every part of it turns with the plate's one rotation, so what
// acts on a part of it — the forces at its boundary cells, the mantle's drag under it, the couplings to other plates — need
// not balance on that part; the rest of the plate makes up the difference through the rock between them. Each cell's
// share of all that, at the plate's present rotation, is its net torque
//        ρ_c = r × F_c  +  couplings at c  −  D_c ω          (D_c = c_drag (I − r rᵀ): the mantle's drag under the cell)
// and summed over the whole plate it is about nothing (the torque balance). Cut a region S out along a line: the rest of
// the plate must put −Σ_S ρ on S to keep it turning with the plate, through the line. Spread over the line as an even pull
// straight across it (σ per 100 km, along each cell's normal out of S), that is the stress there: positive, the rest holds
// S back — tension, S would leave if the line broke; negative, S is pressed against the rest — compression.
//
// The forces are those the last torque balance gathered (step/forces.js keeps each world cell's share, and whose cell it
// was); the rotations are the plates' current ones.

import { CrustType } from '../model/crust.js';
import { cellSpin } from './torque-balance.js';

/**
 * Each raster cell's net torque ρ_c (world frame, 3 per cell; 0 off the plate), at the plate's present rotation — kept on
 * the plate until the next torque balance. @returns {Float64Array|null} null if the plate's forces are not known yet
 */
export function netTorques(world, plate) {
    const { mesh, config, plates } = world, load = world.loads?.get(plate.id);
    if (!load || !world.cellTorque) return null;
    if (plate.netTorque?.at === world.loads) return plate.netTorque.rho;
    const { numCells, xyz } = mesh, { cellTorque, loadOwner, loadCell } = world;
    const rho = new Float64Array(3 * numCells), w0 = plate.omega, areaUnit = mesh.cellAreaKm2 / 1e4;
    // the driving forces, each on the cell the world view had there when they were gathered
    for (let w = 0; w < numCells; w++) {
        if (loadOwner[w] !== plate.id) continue;
        const c = loadCell[w];
        rho[3 * c] += cellTorque[3 * w]; rho[3 * c + 1] += cellTorque[3 * w + 1]; rho[3 * c + 2] += cellTorque[3 * w + 2];
    }
    // the couplings at the rotations the plates have now: −c (a · (ω − ω_other)) a, as torque-balance.js has them
    const couple = (w, a, k, other) => {
        if (loadOwner[w] !== plate.id) return;
        const o = plates[other]?.omega ?? [0, 0, 0], rel = a[0] * (w0[0] - o[0]) + a[1] * (w0[1] - o[1]) + a[2] * (w0[2] - o[2]), c = loadCell[w];
        for (let i = 0; i < 3; i++) rho[3 * c + i] -= k * rel * a[i];
    };
    for (const { w, r, n, other, length } of load.slabs) couple(w, cross(r, n), config.slabResistance * length, other);
    for (const { w, r, n, other, weight } of load.contacts) {
        const k = config.collisionResistance * areaUnit * weight, an = cross(r, n), o = plates[other]?.omega ?? [0, 0, 0];
        const closing = (w0[0] - o[0]) * an[0] + (w0[1] - o[1]) * an[1] + (w0[2] - o[2]) * an[2] > 0;
        couple(w, an, k * (closing ? 1 : config.collisionSeparateShare), other);
        couple(w, cross(r, an), k * config.collisionShearShare, other);
    }
    // the mantle's drag under each cell: −c (ω − (1 − j) r (r·ω))
    const perArea = areaUnit / config.mobility, { mask, type } = plate.crust, r = [0, 0, 0], keep = 1 - cellSpin(mesh);   // (torque-balance.js dragTensor)
    const cOf = { [CrustType.OCEAN]: config.dragOcean * perArea, [CrustType.CRATON]: config.dragCraton * perArea };
    for (let c = 0; c < numCells; c++) {
        if (!mask[c]) continue;
        plate.toWorld(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], r);
        const k = cOf[type[c]] ?? config.dragContinent * perArea, rw = r[0] * w0[0] + r[1] * w0[1] + r[2] * w0[2];
        for (let i = 0; i < 3; i++) rho[3 * c + i] -= k * (w0[i] - keep * r[i] * rw);
    }
    plate.netTorque = { at: world.loads, rho };
    return rho;
}

/**
 * The stress across a line inside a plate, from its cells' net torques (netTorques).
 * @param {Float64Array} rho   netTorques(world, plate)
 * @param {Iterable<number>} cells   the region S on one side of the line: raster cells of the plate
 * @param {{c:number, n:number[]}[]} cut   raster cells of S along the line, with the plate-frame unit tangent at each
 *                                          pointing out of S, across the line
 * @param {Float64Array|number[]} mat   the plate's rotation matrix (plate.mat: plate frame → world)
 * @returns {number} σ per 100 km of line — + tension, − compression
 */
export function stressAcross(rho, cells, cut, xyz, edgeKm, mat) {
    const tau = [0, 0, 0];
    for (const c of cells) { tau[0] += rho[3 * c]; tau[1] += rho[3 * c + 1]; tau[2] += rho[3 * c + 2]; }
    // an even pull σ across the line puts σ a on S, a = Σ ℓ r × n; the rest must cancel τ: σ = −τ·a / a·a
    // (a is taken in the plate's frame and turned into the world's: r × n turns with the plate)
    const step = edgeKm / 100, al = [0, 0, 0];
    for (const { c, n } of cut) {
        const rn = cross([xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]], n);
        for (let i = 0; i < 3; i++) al[i] += step * rn[i];
    }
    const a = [0, 1, 2].map(i => mat[3 * i] * al[0] + mat[3 * i + 1] * al[1] + mat[3 * i + 2] * al[2]);
    const aa = a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
    return aa > 1e-18 ? -(tau[0] * a[0] + tau[1] * a[1] + tau[2] * a[2]) / aa : 0;
}

/**
 * The cut along a set of raster cells of S that lie against crust outside it: at each, the plate-frame unit tangent toward
 * the neighbours that are not in S (but are in `across`, if given).
 */
export function cutAlong(mesh, cells, inS, across = null) {
    const { xyz, adjOffset, adjList } = mesh, out = [];
    for (const c of cells) {
        const x = xyz[3 * c], y = xyz[3 * c + 1], z = xyz[3 * c + 2], d = [0, 0, 0];
        for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
            const nb = adjList[k];
            if (inS[nb] || (across && !across(nb))) continue;
            d[0] += xyz[3 * nb] - x; d[1] += xyz[3 * nb + 1] - y; d[2] += xyz[3 * nb + 2] - z;
        }
        const along = d[0] * x + d[1] * y + d[2] * z;                         // (tangent at c: drop the radial part)
        d[0] -= along * x; d[1] -= along * y; d[2] -= along * z;
        const l = Math.hypot(d[0], d[1], d[2]);
        if (l > 1e-12) out.push({ c, n: [d[0] / l, d[1] / l, d[2] / l] });
    }
    return out;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
