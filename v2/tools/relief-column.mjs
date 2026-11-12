// Why the land stands high (lane reliefcheck, 2026-11-12): the platform's height on the sim grid split into its parts —
// the column as formed (CM.ref by kind), its thickening (slope × rootKm), the start world's swells as worn (baseKm), the
// rivers' basin fill (basinFillKm / LAND_SEDIMENT_LOAD_FACTOR), the mantle's swell against the land's reference, and the
// sea's level — as terrain/land-mask.js crustColumnKm and terrain/records.js deriveRecords add them. Land cells only
// (land-mask.js landMask), equal-area sim cells. Reports the quantiles of each part and of the platform above the sea, and the sea floor's age.
//   node v2/tools/relief-column.mjs --seed 831576 --time 430 [--tset k=v,…]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const { buildSimMesh } = await import('../js/core/sim-mesh.js');
const { momentFrame, MESH_SEED, DEFAULT_CONT } = await import('./lib/moment-frame.mjs');
const { terrainConfig } = await import('../js/terrain/terrain-config.js');
const { landMask } = await import('../js/terrain/land-mask.js');
const { columnModel, LAND_SEDIMENT_LOAD_FACTOR } = await import('../js/tectonics/measure.js');
const { CrustType } = await import('../js/tectonics/model/crust.js');
const SEED = Number(arg('--seed', 831576)), TIME = Number(arg('--time', 430)), SIM = Number(arg('--sim', 40000));
const TSET = Object.fromEntries((arg('--tset', '') || '').split(',').filter(Boolean).map(kv => kv.split('=')).map(([k, v]) => [k, Number(v)]));
const cfg = terrainConfig(TSET), frame = await momentFrame(ROOT, { seed: SEED, cont: DEFAULT_CONT, sim: SIM, time: TIME });
const simMesh = buildSimMesh(SIM, MESH_SEED), CM = columnModel(cfg), m = landMask(frame, simMesh, cfg), sl = m.sl;
const parts = { ref: [], root: [], base: [], fill: [], swell: [], platformAboveSea: [], rootKm: [] }, kinds = {};
const landRef = cfg.mantleSwellKm * cfg.mantleSwellLandRef;
for (let w = 0; w < simMesh.numCells; w++) {
    if (!m.land[w]) continue;
    const t = frame.type[w], k = t === CrustType.OCEAN ? CrustType.CONTINENT : t;
    kinds[t] = (kinds[t] ?? 0) + 1;
    const ref = t === CrustType.ARC ? NaN : CM.ref[k], root = t === CrustType.ARC ? NaN : CM.slope[k] * frame.rootKm[w];
    const base = frame.baseKm[w], fill = (frame.basinFillKm?.[w] ?? 0) / LAND_SEDIMENT_LOAD_FACTOR, swell = sl.swellKm[w] - landRef;
    parts.ref.push(ref); parts.root.push(root); parts.base.push(base); parts.fill.push(fill); parts.swell.push(swell); parts.rootKm.push(frame.rootKm[w]);
    parts.platformAboveSea.push(ref + root + base + fill + swell - sl.seaKm);
}
const q = a => { const b = a.filter(v => v === v).sort((x, y) => x - y), at = p => +b[Math.floor(p * (b.length - 1))].toFixed(3); return { mean: +(b.reduce((s, v) => s + v, 0) / b.length).toFixed(3), p10: at(0.1), p25: at(0.25), p50: at(0.5), p75: at(0.75), p90: at(0.9) }; };
const out = { seed: SEED, time: TIME, tset: TSET, landCells: parts.ref.length, kinds, seaKm: +sl.seaKm.toFixed(3), landRefKm: landRef, CMref: CM.ref.map(v => +v.toFixed(3)),
    parts: Object.fromEntries(Object.entries(parts).map(([k, a]) => [k, q(a)])) };
const fin = parts.platformAboveSea.filter(v => v === v);
out.belowShare = Object.fromEntries([0.2, 0.5, 1].map(t => [`<${t * 1000}m`, +(100 * fin.filter(v => v < t).length / fin.length).toFixed(1)]));
// the sea floor's age (a poured sea stands lower on older, deeper floor; Earth's mean ~62 Myr: Müller et al. 2008, Seton et al. 2020)
const ages = []; for (let w = 0; w < simMesh.numCells; w++) if (frame.owner[w] >= 0 && frame.type[w] === CrustType.OCEAN && !m.land[w]) ages.push(TIME - frame.formedAt[w]);
ages.sort((a, b) => a - b);
out.floorAgeMyr = { mean: Math.round(ages.reduce((a, b) => a + b, 0) / ages.length), p50: Math.round(ages[ages.length >> 1]), p90: Math.round(ages[Math.floor(0.9 * ages.length)]), olderThan180: +(100 * ages.filter(v => v > 180).length / ages.length).toFixed(1) };
console.log(JSON.stringify(out, null, 1));
process.exit(0);
