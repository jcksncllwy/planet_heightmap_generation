// The water ledger's inventory (lane water, 2026-11-06): for each seed@moment, the finish run at --cells, and every place
// the program computes the land's water, side by side on the same finished cells — so their disagreement is measured,
// not argued. One JSON line per run:
//   pet     the land's potential evaporation (mm/yr, land mean, and by the year's mean temperature): the climate's
//           Priestley–Taylor (rain.js, what the finish's runoff uses), the temperature's 300 + 55 T (the cover's, civ's,
//           basin-estimate's and check-basins'), Thornthwaite (cell-stats.js: aridity);
//   share   land runoff ÷ land rain by each path: the climate's own P − E on its grid; the finish's (liquid through
//           Budyko, + the ice's meltwater); Budyko on the temperature's PET (basin-estimate's formula on the real
//           climate); the climate's own monthly bucket run on each cell (Turc–Pike, its RAIN_SOIL_MM, snow kept below
//           0 °C, 120 mm/°C melt — the ledger to be); the cover's bucket (its snow, 150 mm, the temperature's PET);
//   snow    the two snow models' liquid share of the land's rain: thawedWater (cell height) against runoffMonths' (grid
//           height), and the land under runoffMonths' 1/12 fallback;
//   close   the books: the finish's land evaporation (liquid − runoff) against the climate's (its Eland, the water the
//           air got from that land); Σ P − E_climate − runoff − kept snow over the land (km³/yr); the frontal rain (added
//           after the budget: water from no evaporation) as a share of the land's rain; the lakes' double count (FSM and
//           closedBasins add each lake cell's land runoff and also its open water's loss net of the rain on it — the
//           rain counted twice: Σ over lake cells of their runoff, km³/yr, and as a share of the water reaching lakes).
//   node v2/tools/water-study.mjs --runs 831576@430,831576@340 [--cont 30] [--sim 40000] [--cells 640000] [--set k=v,…]
// Run it through sim-slots (sim-slots run -n 4 --gb 8 --who water -- node …).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH, COVER } from '../js/finish/finish-config.js';
import { CORE_DEFAULTS } from '../js/climate/core.js';
import { PARAMS } from '../js/climate/config.js';
import { thornthwaite } from '../js/climate/cell-stats.js';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CONT = Number(arg('--cont', 30)), SIM = Number(arg('--sim', 40000)), CELLS = Number(arg('--cells', 640000));
const F = { ...FINISH };
for (const kv of (arg('--set', '') || '').split(/,(?=[A-Za-z])/).filter(Boolean)) { const [k, v] = kv.split('='); F[k] = Number.isFinite(Number(v)) ? Number(v) : JSON.parse(v); }
const simMesh = buildSimMesh(SIM, MESH_SEED), gamma = CORE_DEFAULTS.lapseRateCPerKm;
const r3 = x => x === null || !Number.isFinite(x) ? null : Math.round(1000 * x) / 1000, r0 = Math.round;
const turcPike = (avail, ep) => avail / Math.sqrt(1 + (avail / Math.max(1e-12, ep)) ** 2);
const budyko = (P, E0, w) => P > 0 ? Math.max(0, P - P * (1 + E0 / P - (1 + (E0 / P) ** w) ** (1 / w))) : 0;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const BANDS = [-Infinity, -5, 5, 15, 22, Infinity];

for (const run of arg('--runs', '831576@430').split(',')) {
    const [seed, time] = run.split('@').map(Number), t0 = performance.now();
    const frame = await momentFrame(ROOT, { seed, cont: CONT, sim: SIM, time });
    const pool = await TerrainPool.create(simMesh);
    const fin = await finishPlanet({ frame, simMesh, seed, cells: CELLS, pool, closePool: true, debug: true, F, onStage: () => {} });
    const { mesh, z, ocean, lake } = fin, L = fin.layers, n = mesh.numCells, WG = L.waterGrid, g = WG.grid, G = g.size, w = g.w, h = g.h;
    const km2 = 4 * Math.PI * 6371 ** 2 / n;
    // (grid lookups: bilinear, as finish.js corners)
    const bi = new Int32Array(4), bw = new Float64Array(4);
    const corners = (la, lo) => {            // (finish.js corners)
        const step = 180 / h, x = (lo + 180) / step - 0.5, y = Math.max(0, Math.min(h - 1, (90 - la) / step - 0.5));
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        const i0 = ((x0 % w) + w) % w, i1 = i0 + 1 === w ? 0 : i0 + 1, j1 = y0 + 1 < h ? y0 + 1 : y0;
        bi[0] = y0 * w + i0; bi[1] = y0 * w + i1; bi[2] = j1 * w + i0; bi[3] = j1 * w + i1;
        bw[0] = (1 - fx) * (1 - fy); bw[1] = fx * (1 - fy); bw[2] = (1 - fx) * fy; bw[3] = fx * fy;
    };
    const at = (f, o = 0) => f[o + bi[0]] * bw[0] + f[o + bi[1]] * bw[1] + f[o + bi[2]] * bw[2] + f[o + bi[3]] * bw[3];
    const hL = WG.surface.meanLandKm, Tsl = new Float32Array(12 * G);
    for (let q = 0; q < G; q++) { const hr = hL[q] === hL[q] ? Math.max(0, hL[q]) : 0; for (let m = 0; m < 12; m++) Tsl[m * G + q] = WG.months.T[m * G + q] + gamma * hr; }
    // (runoffMonths' grid snow: the liquid share of each grid point's year, and whether it falls back to 1/12)
    const gLiq = new Float32Array(G), gFall = new Uint8Array(G);
    for (let q = 0; q < G; q++) {
        let snow = 0, sl = 0, all = 0;
        for (let cyc = 0; cyc < 3; cyc++) for (let m = 0; m < 12; m++) {
            const T = WG.months.T[m * G + q], P = Math.max(0, WG.months.P[m * G + q]);
            let liq; if (T < 0) { snow += P; liq = 0; } else { const melt = Math.min(snow, F.snowMeltMmPerC * T); snow -= melt; liq = P + melt; }
            if (cyc === 2) { sl += liq; all += P; }
        }
        gLiq[q] = all > 0 ? sl / all : 1;
        let sf = 0; for (let m = 0; m < 12; m++) sf += WG.share[m][q];
        gFall[q] = 1;
        for (let m = 0; m < 12; m++) if (Math.abs(WG.share[m][q] - 1 / 12) > 1e-6) gFall[q] = 0;
        if (sl > 0) gFall[q] = 0;
    }
    const ElandYr = new Float32Array(G);
    if (WG.Eland) for (let q = 0; q < G; q++) { let e = 0; for (let k = 0; k < WG.anchors; k++) e += WG.Eland[k * G + q]; ElandYr[q] = 12 * e / WG.anchors; }
    // per land cell
    const T12 = new Float64Array(12), P12 = new Float64Array(12), E12 = new Float64Array(12), TH = new Float64Array(12);
    const S = { land: 0, P: 0, pt: 0, lin: 0, thw: 0, Rfin: 0, Rlin: 0, Rledger: 0, Kledger: 0, Eledger: 0, Rcover: 0, liqCell: 0, liqGrid: 0, fallKm2: 0, frozenKm2: 0,
        Efin: 0, Eclim: 0, absE: 0, kept: 0 };
    const band = BANDS.slice(1).map(() => ({ km2: 0, pt: 0, lin: 0, thw: 0 }));
    const Smax = PARAMS.RAIN_SOIL_MM;
    for (let c = 0; c < n; c++) {
        if (ocean[c] || lake[c] || !(z[c] > 0)) continue;
        const P = Math.max(0, L.rain[c]);
        if (!(P === P)) continue;
        corners(L.lat[c], L.lon[c]);
        const hc = gamma * Math.max(0, z[c]);
        let all = 0;
        for (let m = 0; m < 12; m++) { T12[m] = at(Tsl, m * G) - hc; P12[m] = Math.max(0, at(WG.months.P, m * G)); E12[m] = Math.max(0, at(WG.petM, m * G)); all += P12[m]; }
        for (let m = 0; m < 12; m++) P12[m] = all > 0 ? P * P12[m] / all : P / 12;
        const tA = L.tAnn[c], pt = L.pet[c], lin = Math.max(F.petMinMm, F.petBaseMm + F.petPerC * tA);
        thornthwaite(T12, L.lat[c] * Math.PI / 180, TH);
        let thw = 0; for (let m = 0; m < 12; m++) thw += TH[m];
        S.land++; S.P += P; S.pt += pt; S.lin += lin; S.thw += thw;
        for (let b = 0; b < band.length; b++) if (tA >= BANDS[b] && tA < BANDS[b + 1]) { band[b].km2 += km2; band[b].pt += pt; band[b].lin += lin; band[b].thw += thw; }
        // the finish's runoff (incl. the ice's meltwater added at margins) and Budyko on the temperature's PET
        S.Rfin += L.runoff[c]; S.Rlin += budyko(P, lin, F.budykoW); S.kept += L.snowStore[c];
        const Ef = Math.max(0, L.liquid[c] - L.runoff[c]), Ec = at(ElandYr);
        S.Efin += Ef; S.Eclim += Ec; S.absE += Math.abs(Ef - Ec);
        S.liqCell += L.liquid[c]; S.liqGrid += P * at(gLiq);
        if (at(gFall) > 0.5) S.fallKm2 += km2;
        if (L.frozen[c]) S.frozenKm2 += km2;
        // the climate's monthly bucket on this cell (the ledger to be): snow below 0 °C, melt 120/°C, Turc–Pike from
        // input + the soil's store, the store capped at RAIN_SOIL_MM, overflow runs off; three years from half full
        {
            let snow = 0, soil = 0.5 * Smax, R = 0, E = 0, kept0 = 0;
            for (let cyc = 0; cyc < 3; cyc++) {
                if (cyc === 2) kept0 = snow;
                for (let m = 0; m < 12; m++) {
                    let input;
                    if (T12[m] < 0) { snow += P12[m]; input = 0; } else { const melt = Math.min(snow, F.snowMeltMmPerC * T12[m]); snow -= melt; input = P12[m] + melt; }
                    const et = turcPike(input + soil, E12[m]);
                    const s1 = soil + input - et;
                    if (cyc === 2) { E += et; R += Math.max(0, s1 - Smax); }
                    soil = Math.min(Smax, Math.max(0, s1));
                }
            }
            S.Rledger += R; S.Eledger += E; S.Kledger += snow - kept0;
        }
        // the cover's bucket (its snow phase and loss, 150 mm, the temperature's PET): what it would spill
        {
            let swe = 0, soil = 0, R = 0;
            for (let cyc = 0; cyc < 3; cyc++) for (let m = 0; m < 12; m++) {
                const p = P12[m], pet = Math.max(5, (F.petBaseMm + F.petPerC * T12[m]) / 12), snowfall = p * smooth(COVER.snowPhase[0], COVER.snowPhase[1], T12[m]);
                swe += snowfall;
                const melt = Math.min(swe, COVER.snowMeltMmPerC * Math.max(0, T12[m]));
                swe = Math.max(0, swe - melt - COVER.snowLossMm * smooth(COVER.snowLossWarm[0], COVER.snowLossWarm[1], T12[m]));
                const liquid = p - snowfall + melt, s1 = soil + liquid - pet;
                if (cyc === 2) R += Math.max(0, s1 - COVER.soilMm);
                soil = Math.min(COVER.soilMm, Math.max(0, s1));
            }
            S.Rcover += R;
        }
    }
    // lakes: the double count (each lake cell's own land runoff, added to the water that reaches the lake, besides its
    // open water's loss net of the rain on it), against all the land runoff reaching lake cells' catchments (the FSM's q)
    let dbl = 0, lakeKm2 = 0, lakeRain = 0;
    for (let c = 0; c < n; c++) if (lake[c] && lake[c] !== 3) { dbl += Math.max(0, L.runoff[c]) * km2 * 1e-6; lakeKm2 += km2; lakeRain += Math.max(0, L.rain[c]) * km2 * 1e-6; }
    // the frontal rain's share of the land's rain (the grid's, land-weighted)
    let fr = 0, pr = 0;
    if (WG.frontal && WG.rainP) for (let q = 0; q < G; q++) {
        const lf = WG.surface.landFrac[q]; if (!(lf > 0)) continue;
        const cw = Math.cos((90 - (Math.floor(q / w) + 0.5) * 180 / h) * Math.PI / 180) * lf;
        let p = 0; for (let k = 0; k < WG.anchors; k++) p += WG.rainP[k * G + q];
        fr += cw * WG.frontal[q] / lf; pr += cw * p;
    }
    const st = fin.stats, toKm3 = x => r0(x * km2 * 1e-6);
    console.log(JSON.stringify({ run, cells: CELLS, s: r0((performance.now() - t0) / 1000),
        landMkm2: r3(S.land * km2 / 1e6), rainMm: r0(S.P / S.land),
        pet: { pt: r0(S.pt / S.land), lin: r0(S.lin / S.land), thw: r0(S.thw / S.land),
            bands: band.map((b, i) => ({ t: `${BANDS[i]}..${BANDS[i + 1]}`, Mkm2: r3(b.km2 / 1e6), pt: r0(b.pt * km2 / Math.max(1, b.km2)), lin: r0(b.lin * km2 / Math.max(1, b.km2)), thw: r0(b.thw * km2 / Math.max(1, b.km2)) })) },
        share: { climate: st.climateRunoffShare, finish: st.runoffShare, finishWithIce: st.runoffShareWithIce, finishCells: r3(S.Rfin / S.P), budykoLinPet: r3(S.Rlin / S.P),
            ledgerBucket: r3(S.Rledger / S.P), ledgerKept: r3(S.Kledger / S.P), coverBucket: r3(S.Rcover / S.P) },
        snow: { liquidCell: r3(S.liqCell / S.P), liquidGrid: r3(S.liqGrid / S.P), fallbackPct: r3(100 * S.fallKm2 / (S.land * km2)), frozenPct: r3(100 * S.frozenKm2 / (S.land * km2)) },
        close: { Pkm3: toKm3(S.P), EfinKm3: toKm3(S.Efin), EclimKm3: toKm3(S.Eclim), EledgerKm3: toKm3(S.Eledger), meanAbsEOverP: r3(S.absE / S.P),
            gapKm3: toKm3(S.P - S.Eclim - S.Rfin - S.kept), gapShare: r3((S.P - S.Eclim - S.Rfin - S.kept) / S.P),
            frontalShare: pr > 0 ? r3(fr / pr) : null, lakeKkm2: r0(lakeKm2 / 1e3), lakeDoubleKm3: r0(dbl), lakeRainKm3: r0(lakeRain),
            lakeDoubleOverRunoff: r3(dbl / Math.max(1e-9, S.Rfin * km2 * 1e-6)) },
        snowStore: st.snowStore, water: { toSea: st.water?.toSeaShare, toBasins: st.water?.toBasinsShare, lost: st.water?.lostShare } }));
}
