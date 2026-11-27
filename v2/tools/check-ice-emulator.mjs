#!/usr/bin/env node
// The glacial cycle's response table (finish/ice-emulator.js, lane iceemu E2, 2026-11-27) against the climate it stands in
// for, on Earth's ground (ETOPO5 less today's ice, on the 160K terrain mesh, the bed bare as a generated world's is): the
// table fitted to solves at the cycle's corners (cornerEpochs), then held out against full solves at other epochs of the last
// 120 kyr. Skill = 1 − Σ(table − solve)² / Σ(solve − its mean over the epochs)², per land grid cell and month: the share of
// the orbit's own signal in the land's monthly temperature that the table carries. The target, ≥ 90 %, is the plan's (the
// cycle study's prototype, probes/emulator-test.mjs, explained 92 % with the climate's own sheets off); this check is the
// seam with the climate's code — it is to run again whenever the climate changes (climbias), and a fall below it means the
// orbit's response stopped being linear enough for the table, not a constant to move.
// The solves as cycledIce runs them: the climate's own perennial snow off (ownSheets: false; the ice model's H the only
// sheet), solves F.iceTableKyr apart over F.iceCycleKyr. GEO_SIM_EMU_OWNSHEETS=1, GEO_SIM_EMU_K, GEO_SIM_EMU_METHOD, GEO_SIM_EMU_H:
// a study's other choices.
//   node v2/tools/check-ice-emulator.mjs        (needs a GPU: Dawn in Node, through check-kit)
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { check, report, section, finish } from './lib/check-kit.mjs';
import { earthSurfaceKm, earthIce, EARTH_ICE_MESH } from './lib/earth-surface.mjs';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { worldOcean } from '../js/terrain/world-ocean.js';
import { finishDevice } from '../js/gpu/finish-gpu.js';
import { FINISH } from '../js/finish/finish-config.js';
import { glacialClimate } from '../js/finish/finish-ice.js';
import { cornerEpochs, orbitPredictors, fitTable } from '../js/finish/ice-emulator.js';
import { EARTH_SYSTEM, EARTH_CYCLE } from '../js/climate/planet-system.js';
import { ICE } from '../js/gpu/ice-sheet.js';

setDelaunator(Delaunator);
const t0 = performance.now(), F = FINISH, own = (globalThis.process?.env?.GEO_SIM_EMU_OWNSHEETS ?? '0') !== '0';
const mesh = terrainMesh(EARTH_ICE_MESH), n = mesh.numCells, x = mesh.xyz;
const S = earthSurfaceKm(mesh, { terrain: true }), I6 = earthIce(mesh);
section('inputs');
check('Earth\'s ground on the 160K terrain mesh', !S.error && !I6.error, S.error ?? I6.error ?? '');
if (S.error || I6.error) process.exit(finish('ice-emulator'));
// (the bed bare and rebounded, as check-iceage-earth's: today's ice gone, the ground it pressed down risen by ρ_i/ρ_m of it)
const z = Float32Array.from(S.z, (v, c) => v - (I6.thickNowKm ? I6.thickNowKm[c] * (1 - ICE.rhoIce / ICE.rhoMantle) : 0));
const land = Uint8Array.from(worldOcean(mesh, z, 0).ocean, o => (o ? 0 : 1)), iceMask = new Uint8Array(n);
const device = await finishDevice(), system = { ...EARTH_SYSTEM, orbit: { ...EARTH_SYSTEM.orbit, cycle: EARTH_CYCLE }, atmosphere: { ...EARTH_SYSTEM.atmosphere, co2: null } };
const climateOptions = own ? {} : { ownSheets: false };
const solve = async k => { const tw = performance.now(), r = await glacialClimate(device, { x, elevKm: z, land, iceMask, system: { ...system, epochKyr: k }, climateOptions }, F);
    return { k, x: orbitPredictors(system, k), Tsl: r.Tsl, P: r.P, landFrac: r.landFrac, grid: r.grid, ms: performance.now() - tw }; };

section(`the table (the climate's own sheets ${own ? 'on' : 'off'}, the CO2 held)`);
const K = Number(globalThis.process?.env?.GEO_SIM_EMU_K ?? Math.round(F.iceCycleKyr / F.iceTableKyr) + 1), corners = cornerEpochs(system, { fromKyr: 120, toKyr: 0, k: K, ...(globalThis.process?.env?.GEO_SIM_EMU_METHOD ? { method: globalThis.process.env.GEO_SIM_EMU_METHOD } : {}) }), fitS = [];
for (const k of corners) fitS.push(await solve(k));
// (held out: the midpoints between the corners, never a corner)
const sorted = [...corners].sort((a, b) => a - b), HELD = sorted.slice(1).map((t, i) => Math.round((t + sorted[i]) / 2)).filter(t => !corners.includes(t));
const hEnv = globalThis.process?.env?.GEO_SIM_EMU_H, table = fitTable(fitS, hEnv ? { h: Number(hEnv) } : {}), held = [];
for (const k of HELD) held.push(await solve(k));
const G = fitS[0].grid.size, w = fitS[0].grid.w, lf = fitS[0].landFrac, all = [...fitS, ...held];
// (the table's answers once per held epoch, not per cell: at() makes the whole field)
for (const r of held) r.pred = table.at(r.x);
const skillOf = (key, sel) => {
    let e2 = 0, s2 = 0, cnt = 0;
    for (let g = 0; g < G; g++) {
        if (!(lf[g] > 0.5)) continue;
        const la = 90 - (Math.floor(g / w) + 0.5) * 180 / (G / w);
        for (const m of sel(la)) {
            const i = m * G + g; let mean = 0; for (const r of all) mean += r[key][i]; mean /= all.length;
            for (const r of held) { e2 += (r.pred[key][i] - r[key][i]) ** 2; s2 += (r[key][i] - mean) ** 2; cnt++; }
        }
    }
    return { skill: 1 - e2 / s2, rms: Math.sqrt(e2 / cnt), sig: Math.sqrt(s2 / cnt) };
};
// (as cycledIce reads it: the nearest solve (its anchor, ≤ half the spacing away) plus the table's change from its epoch to
// the held one — the plane's bias between solves cancels)
for (const r of held) { const c = fitS.reduce((b, q) => (Math.abs(q.k - r.k) < Math.abs(b.k - r.k) ? q : b)), tr = r.pred, tc = table.at(c.x);
    r.plane = r.pred; r.pred = { Tsl: Float32Array.from(c.Tsl, (v, i) => v + tr.Tsl[i] - tc.Tsl[i]), P: Float32Array.from(c.P, (v, i) => v + tr.P[i] - tc.P[i]) }; }
const months = () => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], summer = la => (la > 0 ? [5, 6, 7] : [11, 0, 1]);
const tAll = skillOf('Tsl', months), tSum = skillOf('Tsl', summer), pAll = skillOf('P', months);
for (const r of held) [r.pred, r.plane] = [r.plane, r.pred];
const tPlane = skillOf('Tsl', months), pPlane = skillOf('P', months);
for (const r of held) [r.pred, r.plane] = [r.plane, r.pred];
const msMean = all.reduce((a, r) => a + r.ms, 0) / all.length;
// (each held epoch's own error, land monthly T and the global mean land T: where the climate left the table's plane)
const perHeld = held.map(r => { let e2 = 0, cnt = 0, mt = 0, mp = 0;
    for (let g = 0; g < G; g++) { if (!(lf[g] > 0.5)) continue; for (let m = 0; m < 12; m++) { const i = m * G + g; e2 += (r.pred.Tsl[i] - r.Tsl[i]) ** 2; mt += r.Tsl[i]; mp += r.pred.Tsl[i]; cnt++; } }
    return `${r.k} ka ${Math.sqrt(e2 / cnt).toFixed(2)} K (mean ${(mt / cnt).toFixed(2)} vs table ${(mp / cnt).toFixed(2)})`; });
console.log('held epochs:', perHeld.join(' · '));
console.log('corners, the mean land T:', fitS.map(r => { let mt = 0, cnt = 0; for (let g = 0; g < G; g++) if (lf[g] > 0.5) for (let m = 0; m < 12; m++) { mt += r.Tsl[m * G + g]; cnt++; } return `${r.k} ka ${(mt / cnt).toFixed(2)}`; }).join(' · '));
check('the table, read from the nearest solve as cycledIce reads it, carries ≥ 90 % of the held-out land temperature\'s orbital signal (monthly, every land cell)', tAll.skill >= 0.9,
    `${(100 * tAll.skill).toFixed(1)} %: error rms ${tAll.rms.toFixed(2)} K against the signal's ${tAll.sig.toFixed(2)} K; corners ${corners.join(', ')} ka, held ${HELD.join(', ')} ka; bandwidth ${table.bandwidth.toFixed(2)}`);
report('the table alone (one plane, no anchor): the held-out land temperature\'s skill', 100 * tPlane.skill, { unit: ' %', digits: 1, detail: `error rms ${tPlane.rms.toFixed(2)} K; precipitation ${(100 * pPlane.skill).toFixed(0)} %` });
report('the summer\'s land temperature (JJA north, DJF south): the table\'s skill', 100 * tSum.skill, { unit: ' %', digits: 1, detail: `error rms ${tSum.rms.toFixed(2)} K, signal ${tSum.sig.toFixed(2)} K — the season the ice's melt reads` });
report('the land\'s monthly precipitation: the table\'s skill', 100 * pAll.skill, { unit: ' %', digits: 1, detail: `error rms ${pAll.rms.toFixed(1)}, signal ${pAll.sig.toFixed(1)} (the climate's units, mm a month)` });
report('a solve\'s cost (cycledIce: the table\'s, and one per F.iceResolveKyr)', msMean / 1000, { unit: ' s', digits: 1, detail: `${all.length} solves on the 160K mesh` });
console.log(`(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(finish('ice-emulator'));
