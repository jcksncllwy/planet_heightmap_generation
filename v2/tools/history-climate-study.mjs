// Phase 2 of lane gpuclimate (report-only): what a sampled climate in the history would cost and change. On a history's
// frames (the history cache's, sim mesh), the whole climate — planetClimateAsync with its solves on the GPU
// (gpu/climate-solver.js) — against the zonal proxy the history runs today (terrain-config.js rainAtLatitude,
// basin-estimate.js tempAtLatitude less the lapse rate; erosionAtLatitude, the erosion clocks' multiplier).
//   node v2/tools/history-climate-study.mjs --seeds 831576,243751,716130 [--times 100,300,…] [--sim 40000] [--grid 1] [--json out.json]
//   [--grids 1,2]: each frame on each grid, timed, and the later grids' years against the first's (a cheaper history sample)
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
import { terrainConfig, rainAtLatitude, erosionAtLatitude } from '../js/terrain/terrain-config.js';
import { tempAtLatitude } from '../js/terrain/basin-estimate.js';

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = arg('--seeds', '831576,243751,716130').split(',').map(Number), SIM = +arg('--sim', 40000), GRID = +arg('--grid', 1);
const GRIDS = arg('--grids', null)?.split(',').map(Number) ?? null;
const TIMES = arg('--times', '100,250,400,550,700,850,1000').split(',').map(Number), JSON_OUT = arg('--json', null);
setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const simMesh = buildSimMesh(SIM, MESH_SEED), n = simMesh.numCells, cfg = terrainConfig();
const { device } = await openDevice(gpu);
const kit = await climateSolverKit(device);
const BANDS = [0, 15, 30, 45, 60, 75, 90], bandOf = (lat) => Math.min(BANDS.length - 2, Math.floor(Math.abs(lat) / 15));
const rows = [];
for (const seed of SEEDS) for (const time of TIMES) {
    let frame;
    try { frame = await momentFrame(ROOT, { seed, sim: SIM, time }); } catch (e) { console.log(`${seed}@${time}: ${e.message}`); continue; }
    const z = surfaceKm(frame, simMesh, cfg), { land } = landMask(frame, simMesh, cfg, {});
    const climIn = { xyz: simMesh.xyz, elevKm: z, axes: 'z-up', land: Uint8Array.from(land) };
    if (GRIDS) {
        const out = [];
        for (const gd of GRIDS) {
            const t1 = performance.now(), r = await planetClimateAsync(climIn, { solver: kit, gridStepDeg: gd });
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
            console.log(`${seed}@${time} ${gd}°: ${row.ms} ms · against ${GRIDS[0]}°: ΔT mean ${(dT / N).toFixed(2)} |${(aT / N).toFixed(2)}| °C · P× ${Math.exp(lp / N).toFixed(3)} (|ln| ${(alp / N).toFixed(3)})`);
        }
        continue;
    }
    const t0 = performance.now();
    const res = await planetClimateAsync(climIn, { solver: kit, gridStepDeg: GRID });
    const ms = performance.now() - t0;
    kit.release();
    const { tAnnual, pAnnual, lat } = res.cell;
    // per land cell: the climate's year against the proxy's, and the erosion clock each implies
    const b = BANDS.slice(1).map(() => ({ n: 0, dT: 0, rP: 0, logP: 0, rE: 0 })), all = { n: 0, dT: 0, absDT: 0, logP: 0, absLogP: 0, rE: 0, absLogE: 0, wetter2: 0, drier2: 0 };
    for (let c = 0; c < n; c++) {
        if (!land[c] || !(pAnnual[c] === pAnnual[c])) continue;
        const la = lat[c], Pz = rainAtLatitude(la, cfg), Tz = tempAtLatitude(la, cfg) - cfg.lapseRateCPerKm * Math.max(0, z[c]);
        const P = Math.max(1, pAnnual[c]), T = tAnnual[c], lr = Math.log(P / Pz);
        // (the erosion clock the climate's rain would give, as erosionAtLatitude's rain part does from the proxy's)
        const wet = P / cfg.rainRefMm, wz = Pz / cfg.rainRefMm, ex = cfg.rainErosionExponent;
        const Ec = wet ** (ex * (wet > 1 ? cfg.wetErosionShare : 1)), Ez = wz ** (ex * (wz > 1 ? cfg.wetErosionShare : 1)), le = Math.log(Ec / Ez);
        const q = b[bandOf(la)];
        q.n++; q.dT += T - Tz; q.logP += lr; q.rE += le;
        all.n++; all.dT += T - Tz; all.absDT += Math.abs(T - Tz); all.logP += lr; all.absLogP += Math.abs(lr); all.absLogE += Math.abs(le);
        if (lr > Math.log(2)) all.wetter2++; if (lr < -Math.log(2)) all.drier2++;
    }
    const f = (x, k = 2) => x.toFixed(k);
    const row = { seed, time, ms: Math.round(ms), landCells: all.n, meanDT: all.dT / all.n, meanAbsDT: all.absDT / all.n, geoMeanP: Math.exp(all.logP / all.n), meanAbsLogP: all.absLogP / all.n,
        wetter2x: all.wetter2 / all.n, drier2x: all.drier2 / all.n, meanAbsLogE: all.absLogE / all.n,
        bands: b.map((q, i) => ({ band: `${BANDS[i]}–${BANDS[i + 1]}°`, n: q.n, dT: q.n ? q.dT / q.n : null, P: q.n ? Math.exp(q.logP / q.n) : null, E: q.n ? Math.exp(q.rE / q.n) : null })) };
    rows.push(row);
    console.log(`${seed}@${time}: ${row.ms} ms, ${all.n} land cells · T−Tzonal mean ${f(row.meanDT)} |${f(row.meanAbsDT)}| °C · P/Pzonal geo-mean ${f(row.geoMeanP)} (|ln| ${f(row.meanAbsLogP)}; ×2 wetter ${f(100 * row.wetter2x, 0)} %, ×½ drier ${f(100 * row.drier2x, 0)} %) · erosion clock |ln| ${f(row.meanAbsLogE)}`);
    console.log('    ' + row.bands.map(q => `${q.band}: n ${q.n} ΔT ${q.dT == null ? '–' : f(q.dT, 1)} P× ${q.P == null ? '–' : f(q.P)} E× ${q.E == null ? '–' : f(q.E)}`).join(' · '));
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
process.exit(0);
