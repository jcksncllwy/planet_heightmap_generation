// Harness check of the Earth replay's plumbing (study Q5.1): is the start world, turned forward by the reconstruction's rotations,
// where the reconstruction says it is?  Standalone, not in run-checks.  Plumbing, not physics — same rotations in, same poses out.
//   pose closure         each plate's pose, from this repo's rotation reader, against pygplates's own composition of the same
//                        tree (earth-replay-poses.py), as the farthest any cell of the plate lands apart: ≤ ½ cell edge.
//   partition agreement  every plate's t₀ cells, carried to time t by the model's own plate transform, painted onto the mesh and
//                        compared with the topology-resolved plate under each painted cell (the plate-id table at t): ≥ 95 %
//                        at the short sample times (≤ 5 Myr on: 10 Myr already reads ~91 % at 40K — boundaries move). Crust made and lost since t₀ (ridges, trenches) is not carried, so longer
//                        times drift; they are reported, not checked.
//   node v2/tools/earth-replay-harness.mjs [--cells 40000] [--t0 100]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, section, report, finish, labMesh } from './lib/check-kit.mjs';
import { DATA_DIR } from './earth-replay-mesh.mjs';
import { loadStartInputs } from './earth-replay-inputs.mjs';
import { loadPlateTable, loadMullerRotations } from './earth-replay-plates.mjs';
import { quatConj, rotate } from './earth-replay-lib.mjs';
import { quatMul } from '../js/core/rotation.js';
import { buildEarthStart } from '../js/tectonics/scenarios/earth-start.js';
import { PLANET_RADIUS_KM } from '../js/core/sim-mesh.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const CELLS = arg('--cells', 40000), T0 = arg('--t0', 100), CHECKED_UP_TO = 5;      // (Myr after t₀ whose partition agreement is a hard check)
const mesh = labMesh(CELLS), inputs = await loadStartInputs(mesh, T0), { world, start } = buildEarthStart(mesh, 12345, inputs);
const rot = loadMullerRotations(), table = loadPlateTable(CELLS), ref = JSON.parse(readFileSync(join(DATA_DIR, `poses-${T0}.json`), 'utf8'));
const forward = (id, t) => quatMul(rot.total(id, t), quatConj(rot.total(id, T0)));      // t₀ position → position at t
const times = ref.times;

section(`Start world at ${T0} Ma, ${CELLS / 1000}K cells: ${world.plates.length} plates`);
check('every cell has a plate and a crust', world.plates.reduce((n, p) => n + p.crust.count, 0) === mesh.numCells, `${start.unfilled} cells outside every topology were given the nearest plate`);

section('Pose closure: the model\'s plate pose against pygplates\'s');
let compared = 0;
const worst = { km: 0, id: 0, t: 0 }, p = [0, 0, 0], r = [0, 0, 0];
for (const plate of world.plates) {
    const id = start.idOfPlate[plate.id], cells = [];
    for (let c = 0; c < mesh.numCells; c++) if (plate.crust.mask[c]) cells.push(c);
    for (const t of times) {
        const qr = ref.poses[id]?.[String(t)] ?? ref.poses[id]?.[t.toFixed(1)];
        if (!qr) continue;
        compared++;
        plate.setQuat(forward(id, t));
        for (const c of cells) {
            plate.toWorld(mesh.xyz[3 * c], mesh.xyz[3 * c + 1], mesh.xyz[3 * c + 2], p);
            const q = rotate(qr, [mesh.xyz[3 * c], mesh.xyz[3 * c + 1], mesh.xyz[3 * c + 2]]);
            const km = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * PLANET_RADIUS_KM;
            if (km > worst.km) { worst.km = km; worst.id = id; worst.t = t; }
        }
    }
}
check(`every cell of every plate lands within ½ cell (${(mesh.edgeKm / 2).toFixed(0)} km) of pygplates's pose`, worst.km <= mesh.edgeKm / 2, `worst ${worst.km.toExponential(2)} km (plate ${worst.id}, ${worst.t} Ma); ${compared} plate-times compared`);
check('…and it compared something', compared >= world.plates.length * times.length * 0.8, `${compared} of ${world.plates.length * times.length}`);

section('Partition agreement: carried plates against the topology-resolved plate under each cell');
for (const plate of world.plates) plate.setQuat([1, 0, 0, 0]);
for (const t of times) {
    const painted = new Int32Array(mesh.numCells).fill(-1), at = table.at(t);
    for (const plate of world.plates) {
        const id = start.idOfPlate[plate.id];
        plate.setQuat(forward(id, t));
        for (let c = 0; c < mesh.numCells; c++) {
            if (!plate.crust.mask[c]) continue;
            plate.toWorld(mesh.xyz[3 * c], mesh.xyz[3 * c + 1], mesh.xyz[3 * c + 2], p);
            painted[mesh.index.nearest(p[0], p[1], p[2])] = id;
        }
    }
    let n = 0, agree = 0, known = 0;
    for (let c = 0; c < mesh.numCells; c++) if (painted[c] >= 0) { n++; if (at[c]) { known++; if (at[c] === painted[c]) agree++; } }
    const pct = 100 * agree / known, covered = 100 * n / mesh.numCells, label = `${t} Ma (${(T0 - t).toFixed(0)} Myr on)`;
    if (T0 - t <= CHECKED_UP_TO) check(`partition agreement ≥ 95 % at ${label}`, pct >= 95, `${pct.toFixed(1)} % of ${known} painted cells with a topology (${covered.toFixed(1)} % of the mesh painted)`);
    else report(`partition agreement at ${label}`, pct, { unit: ' %', digits: 1, source: 'harness only: crust made / lost since t₀ is not carried' });
}
finish();
