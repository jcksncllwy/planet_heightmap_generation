// Phase 2 of lane gpuclimate (report-only): what a sampled climate in the history would cost and change. On a history's
// frames (the history cache's, sim mesh), the whole climate — planetClimateAsync with its solves on the GPU
// (gpu/climate-solver.js) — in variants. (Its comparison against the zonal proxy tables retired with the tables: lane
// rainland; the history samples its climate since gpuclimate P4.)
//   node v2/tools/history-climate-study.mjs --seeds 831576,243751,716130 [--times 100,300,…] [--sim 40000] [--json out.json]
//   [--variants 1,2,2+c1,2+c1+nc,2+c1+nc+a4] (default 1,2): each frame's climate in each variant, timed, the later ones' years against the
//   first's (a cheaper history sample): the grid (°), +c1 one temperature ↔ winds ↔ ocean round, +nc no clouds-from-rain pass,
//   +aN N anchors in the year
// Heights: inventory.js surfaceKm (today's datum, so the moment's sea level is not taken off: ± a few hundred m of lapse);
// land: land-mask.js landMask's.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { gpu } from './gpu-harness/dawn.mjs';
import { openDevice } from '../js/gpu/gpu-device.js';
import { climateSolverKit } from '../js/gpu/climate-solver.js';
import { planetClimateAsync } from '../js/climate/climate.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { surfaceKm } from '../js/tectonics/ocean/inventory.js';
import { landMask } from '../js/terrain/land-mask.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = arg('--seeds', '831576,243751,716130').split(',').map(Number), SIM = +arg('--sim', 40000);
const variant = (v) => { const [gd, ...f] = v.split('+'), o = { gridStepDeg: +gd };
    for (const x of f) { if (x === 'c1') o.couplingsWithOcean = 1; else if (x === 'nc') o.cloudsFromRain = false; else if (/^a\d+$/.test(x)) o.anchors = +x.slice(1); else throw new Error(`variant ${v}: ${x}?`); }
    return o; };
const GRIDS = arg('--variants', arg('--grids', '1,2')).split(',');
const TIMES = arg('--times', '100,250,400,550,700,850,1000').split(',').map(Number), JSON_OUT = arg('--json', null);
setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const simMesh = buildSimMesh(SIM, MESH_SEED), n = simMesh.numCells, cfg = terrainConfig();
const { device } = await openDevice(gpu);
const kit = await climateSolverKit(device);
const rows = [];
for (const seed of SEEDS) for (const time of TIMES) {
    let frame;
    try { frame = await momentFrame(ROOT, { seed, sim: SIM, time }); } catch (e) { console.log(`${seed}@${time}: ${e.message}`); continue; }
    const z = surfaceKm(frame, simMesh, cfg), { land } = landMask(frame, simMesh, cfg, {});
    const climIn = { xyz: simMesh.xyz, elevKm: z, axes: 'z-up', land: Uint8Array.from(land) };
    {
        const out = [];
        for (const gd of GRIDS) {
            const t1 = performance.now(), r = await planetClimateAsync(climIn, { solver: kit, ...variant(gd) });
            kit.release(); out.push({ gd, ms: performance.now() - t1, r });
        }
        const a = out[0].r.cell;
        for (const { gd, ms, r } of out) {
            let N = 0, dT = 0, aT = 0, lp = 0, alp = 0;
            for (let c = 0; c < n; c++) {
                if (!land[c] || !(a.pAnnual[c] === a.pAnnual[c])) continue;
                const d = r.cell.tAnnual[c] - a.tAnnual[c], l = Math.log(Math.max(1, r.cell.pAnnual[c]) / Math.max(1, a.pAnnual[c]));
                N++; dT += d; aT += Math.abs(d); lp += l; alp += Math.abs(l);
            }
            const row = { seed, time, grid: gd, ms: Math.round(ms), vsFirst: { meanDT: dT / N, meanAbsDT: aT / N, geoP: Math.exp(lp / N), meanAbsLogP: alp / N } };
            rows.push(row);
            console.log(`${seed}@${time} ${gd}: ${row.ms} ms · against ${GRIDS[0]}: ΔT mean ${(dT / N).toFixed(2)} |${(aT / N).toFixed(2)}| °C · P× ${Math.exp(lp / N).toFixed(3)} (|ln| ${(alp / N).toFixed(3)})`);
        }
    }
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
process.exit(0);
