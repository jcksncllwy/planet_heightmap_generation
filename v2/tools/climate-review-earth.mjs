#!/usr/bin/env node
// Climate review (Q2): the climate core on an Earth mesh against the climate lab's Earth references.
// Report-only. Prints zonal annual T and seasonal amplitude by 10° band, the global and land water budget
// before and after the rain corrections, sea-ice extent by month and monsoon seasonality.
//
//   node v2/tools/climate-review-earth.mjs [--n 160000] [--json out.json]
//
// Needs the references: node tuning/climate/fetch-references.mjs && node tuning/climate/regrid-references.mjs
import fs from 'node:fs';
import { loadEarthGrayscale } from '../../tuning/climate/lib/earth-context.mjs';
import { buildEarthMesh } from '../../tuning/climate/lib/earth-mesh.mjs';
import { loadReferences } from '../../tuning/climate/lib/ref.mjs';
import { gridWeights } from '../../tuning/climate/lib/compare.mjs';
import { elevToHeightKm } from '../../js/color-map.js';
import { computeClimate, cellLatLon } from '../js/climate/core.js';
import { energyBalanceTemperature } from '../js/climate/temperature.js';
import { derivedCirculation } from '../js/climate/circulation.js';
import { windDrivenOcean } from '../js/climate/ocean.js';
import { columnWaterRain } from '../js/climate/rain.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('--n', 160000), JSON_OUT = arg('--json', null);
const R_KM = 6371, EARTH_KM2 = 4 * Math.PI * R_KM * R_KM;

const { grid, fields: obs, land: obsLand } = loadReferences();
const G = grid.size, W = gridWeights(grid);
const Wsum = W.reduce((a, b) => a + b, 0);
const km2 = (c) => W[c] / Wsum * EARTH_KM2;
const latOf = (c) => grid.lat[Math.floor(c / grid.w)], lonOf = (c) => grid.lon[c % grid.w];

// ── Earth mesh and the climate ──
const { gray, width, height } = loadEarthGrayscale();
const e = buildEarthMesh(gray, width, height, { N });
const n = e.mesh.numRegions, elevKm = new Float32Array(n);
for (let r = 0; r < n; r++) elevKm[r] = elevToHeightKm(e.r_elevation[r]);
const t0 = performance.now();
const res = computeClimate({ xyz: e.r_xyz, elevKm, axes: 'y-up' },
    { stages: { temperature: energyBalanceTemperature(), circulation: derivedCirculation(), ocean: windDrivenOcean(), rain: columnWaterRain() } });
const ms = performance.now() - t0;
const T = res.stages.temperature, Rn = res.stages.rain, K = Rn.P.length / G;
const landFrac = res.surface.landFrac;
const out = { N, ms: Math.round(ms), K };

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const table = (title, head, rows) => {
    console.log(`\n### ${title}\n\n| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`);
    for (const r of rows) console.log(`| ${r.join(' | ')} |`);
};

// ── 1. Zonal annual T and seasonal amplitude, 10° bands ──
// all surface: model T.monthly vs NCEP near-surface air; land: model vs Beck t2m on land cells (landFrac ≥ 0.5)
function zonal(model, ref, mask) {
    const bands = [];
    for (let lo = -90; lo < 90; lo += 10) {
        let sw = 0, sm = 0, so = 0, am = 0, ao = 0;
        for (let c = 0; c < G; c++) {
            const la = latOf(c); if (la < lo || la >= lo + 10 || !mask(c)) continue;
            let ok = true, mmn = Infinity, mmx = -Infinity, omn = Infinity, omx = -Infinity, msum = 0, osum = 0;
            for (let m = 0; m < 12; m++) {
                const a = model[m * G + c], b = ref[m * G + c];
                if (!(a === a && b === b)) { ok = false; break; }
                msum += a; osum += b; mmn = Math.min(mmn, a); mmx = Math.max(mmx, a); omn = Math.min(omn, b); omx = Math.max(omx, b);
            }
            if (!ok) continue;
            sw += W[c]; sm += W[c] * msum / 12; so += W[c] * osum / 12; am += W[c] * (mmx - mmn); ao += W[c] * (omx - omn);
        }
        bands.push({ band: `${lo}…${lo + 10}`, n: sw, Tm: sm / sw, To: so / sw, Am: am / sw, Ao: ao / sw });
    }
    return bands;
}
const zAll = zonal(T.monthly, obs.airNear, () => true);
const zLand = zonal(T.monthly, obs.t2m, (c) => obsLand[c] && landFrac[c] >= 0.5);
out.zonalAll = zAll; out.zonalLand = zLand;
table('Zonal annual T and seasonal amplitude (max−min month), °C — all surface vs NCEP air; land vs Beck',
    ['band', 'T model', 'T obs', 'ΔT', 'amp model', 'amp obs', 'Δamp', 'land T model', 'land T obs', 'land ΔT', 'land amp m', 'land amp o', 'land Δamp'],
    zAll.map((z, i) => { const l = zLand[i]; return [z.band, f1(z.Tm), f1(z.To), f1(z.Tm - z.To), f1(z.Am), f1(z.Ao), f1(z.Am - z.Ao),
        f1(l.Tm), f1(l.To), f1(l.Tm - l.To), f1(l.Am), f1(l.Ao), f1(l.Am - l.Ao)]; }));
const gm = (bands) => { let s = 0, w = 0; for (const b of bands) if (b.n) { s += b.n * (b.Tm - b.To); w += b.n; } return s / w; };
out.globalBiasAll = gm(zAll); out.globalBiasLand = gm(zLand);
console.log(`\nArea-weighted mean bias: all surface ${f2(out.globalBiasAll)} °C, land ${f2(out.globalBiasLand)} °C`);

// ── 2. Water budget (10³ km³/yr). Anchors are evenly spaced in the year, so the anchor mean is the annual mean. ──
// mm/month over km² → km³/yr: mm·km² = 1e-6 km³; ×12
const toKm3 = (mmMonth, a) => mmMonth * a * 1e-6 * 12;
let Pl = 0, Po = 0, El = 0, Eo = 0, Fr = 0, PlObs = 0, PlObsModel = 0;
for (let c = 0; c < G; c++) {
    const a = km2(c), lf = landFrac[c] || 0;
    let p = 0, eAll = 0, eL = 0;
    for (let k = 0; k < K; k++) { p += Rn.P[k * G + c]; eAll += Rn.E[k * G + c]; eL += Rn.Eland[k * G + c]; }
    p /= K; eAll /= K; eL /= K;
    Pl += toKm3(p * lf, a); Po += toKm3(p * (1 - lf), a);
    El += toKm3(eL * lf, a); Eo += toKm3(eAll - eL * lf, a);   // E is per cell area, Eland per unit land area
    Fr += toKm3((Rn.frontal[c] || 0) / K, a);
    if (obsLand[c]) {
        let po = 0, pm = 0, ok = true;
        for (let m = 0; m < 12; m++) { const v = obs.precip[m * G + c]; if (!(v === v)) { ok = false; break; } po += v; pm += res.months.P[m * G + c]; }
        if (ok) { PlObs += po * a * 1e-6; PlObsModel += pm * a * 1e-6; }
    }
}
// the terrain cells (finish input): annual P per cell over equal-area cells
let PcellLand = 0;
const cellKm2 = EARTH_KM2 / n;
for (let r = 0; r < n; r++) if (elevKm[r] > 0) PcellLand += (res.cell.pAnnual[r] || 0) * cellKm2 * 1e-6;
const bal = Rn.balance;
out.water = { Pland: Pl, Pocean: Po, Eland: El, Eocean: Eo, frontal: Fr, PlandObsMask: PlObs, PlandModelSameMask: PlObsModel, PcellLand, balancePerAnchor: bal };
const k3 = (x) => (x / 1e3).toFixed(1);
table('Water budget, 10³ km³/yr (Earth: Trenberth et al. 2007 land P 113, land E 73, runoff 40; ocean P 373, E 413)',
    ['term', 'model', 'Earth'],
    [['land P (grid, after corrections)', k3(Pl), '113'], ['land E (Eland × land share)', k3(El), '73'], ['land P − E', k3(Pl - El), '40'],
     ['ocean P', k3(Po), '373'], ['ocean E', k3(Eo), '413'], ['global P / global E', f2((Pl + Po) / (El + Eo)), '1.00'],
     ['frontal add (in land P)', k3(Fr), '—'], ['land P on Beck mask: model / Beck', `${k3(PlObsModel)} / ${k3(PlObs)}`, ''],
     ['land P on terrain cells (cell.pAnnual)', k3(PcellLand), ''],
     ['rain-stage balance per anchor (sum P / sum E, before corrections)', bal.map(f2).join(' '), '1.00']]);

// ── 3. Sea-ice extent (cells with concentration > 0.15), 10⁶ km² ──
const si = T.seaIce;
let siMax = 0; for (let i = 0; i < si.length; i++) if (si[i] > siMax) siMax = si[i];
const ext = (field, m, north) => { let s = 0; for (let c = 0; c < G; c++) { if ((latOf(c) > 0) !== north) continue; const v = field[m * G + c]; if (v > 0.15) s += km2(c); } return s / 1e6; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
out.seaIce = MON.map((mo, m) => ({ mo, nhM: ext(si, m, true), nhO: ext(obs.seaIce, m, true), shM: ext(si, m, false), shO: ext(obs.seaIce, m, false) }));
out.seaIceFieldMax = siMax;
table(`Sea-ice extent (>0.15), 10⁶ km² — model vs OISST 1991–2020 (model field max ${f2(siMax)})`, ['month', 'NH model', 'NH obs', 'SH model', 'SH obs'],
    out.seaIce.map(s => [s.mo, f1(s.nhM), f1(s.nhO), f1(s.shM), f1(s.shO)]));

// ── 4. Monsoons: share of the annual land rain falling in the local summer half (MJJASO north, NDJFMA south) ──
const BOXES = [
    ['South Asia', 10, 30, 70, 90, 'N'], ['West Africa Sahel', 8, 18, -15, 15, 'N'], ['East Asia', 22, 40, 105, 122, 'N'],
    ['N. American monsoon', 18, 32, -112, -100, 'N'], ['N. Australia', -20, -10, 120, 150, 'S'], ['S. Am. monsoon', -20, -5, -60, -40, 'S'],
    ['S. Africa summer rain', -25, -10, 20, 35, 'S'],
    ['Mediterranean (winter rain)', 32, 44, -8, 30, 'N'], ['Central Chile (winter rain)', -38, -30, -73, -70, 'S'], ['SW Australia (winter rain)', -35, -30, 114, 120, 'S'],
];
const SUMMER = { N: [4, 5, 6, 7, 8, 9], S: [10, 11, 0, 1, 2, 3] };
out.monsoon = BOXES.map(([name, la0, la1, lo0, lo1, h]) => {
    let pm = 0, ps = 0, om = 0, os = 0, w = 0;
    for (let c = 0; c < G; c++) {
        const la = latOf(c), lo = lonOf(c); if (la < la0 || la >= la1 || lo < lo0 || lo >= lo1 || !obsLand[c]) continue;
        let ok = true; for (let m = 0; m < 12; m++) if (!(obs.precip[m * G + c] === obs.precip[m * G + c])) ok = false;
        if (!ok) continue;
        for (let m = 0; m < 12; m++) {
            const a = res.months.P[m * G + c] * W[c], b = obs.precip[m * G + c] * W[c];
            pm += a; om += b; if (SUMMER[h].includes(m)) { ps += a; os += b; }
        }
        w += W[c];
    }
    return { name, modelAnnual: pm / w, obsAnnual: om / w, modelSummerShare: ps / pm, obsSummerShare: os / om };
});
table('Monsoon and winter-rain boxes — annual land P (mm) and local-summer-half share', ['box', 'P model', 'P obs', 'summer share model', 'summer share obs'],
    out.monsoon.map(b => [b.name, Math.round(b.modelAnnual), Math.round(b.obsAnnual), `${Math.round(100 * b.modelSummerShare)} %`, `${Math.round(100 * b.obsSummerShare)} %`]));

console.log(`\n(N ${N}, climate ${(ms / 1000).toFixed(1)} s, ${K} anchors)`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
