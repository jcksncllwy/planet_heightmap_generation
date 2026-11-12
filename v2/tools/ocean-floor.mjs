// Why the open sea floor stands deeper than Earth's (lane sliders step 1, ocean-report step 3; report only): at every
// 10 Myr frame from 100 Myr, the history's open floor (sea floor the records do not fill to land) split into what sets
// its depth — the floor's ages, the depth–age law that turns them into depth, the sediment, the mantle's swell against the
// sea floor's reference, oceanic plateaus — and the same ages read through Earth's measured laws, and Earth's own ages
// read through the model's law. With the level Earth's water stands at on that ground (tectonics/ocean/inventory.js).
//
// Earth's figures used here (comparisons, not parameters):
// - Depth–age, GDH1 (Stein & Stein 1992, Nature 359: 123): 2.6 + 0.365 √t km for t < 20 Myr, 5.651 − 2.473 e^(−0.0278 t)
//   beyond. PS77 (Parsons & Sclater 1977, JGR 82: 803): 2.5 + 0.35 √t for t < 70, 6.4 − 3.2 e^(−t/62.8) beyond. Both
//   flatten past ~70 Myr (the plate's cooled thickness); the model's law (measure.js seaDepthKm) is half-space √t to its
//   6.4 km cap at ~121 Myr.
// - Ages: today's mean ~62–64 Myr (Müller et al. 2008, Science 319: 1357); the area–age distribution about triangular,
//   falling to nothing at tm ≈ 180 Myr (Parsons 1982; Sclater et al. 1980) — mean tm/3 = 60 Myr.
// Usage: node v2/tools/ocean-floor.mjs [--seeds 626225,777,12345] [--until 1200] [--sim 40000] [--cont 29] [--json out]

import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { simulateCached } from './lib/history-cache.mjs';
import { pageWorld, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { FRAME_FIELDS } from '../js/terrain/terrain-pool.js';
import { CrustType, VolcanicType } from '../js/tectonics/model/crust.js';
import { mantleWarmth } from '../js/terrain/sea-level.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { seaDepthKm, seaFilledUp, SEDIMENT_LOAD_FACTOR, LAND_SEDIMENT_LOAD_FACTOR } from '../js/tectonics/measure.js';
import { surfaceKm, pourOcean, EARTH_OCEAN_KM3 } from '../js/tectonics/ocean/inventory.js';

setDelaunator(Delaunator);
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seeds = flag('--seeds', '626225,777,12345').split(',').map(Number), until = Number(flag('--until', 1200));
const sim = Number(flag('--sim', 40000)), cont = Number(flag('--cont', DEFAULT_CONT)), jsonOut = flag('--json', null);
const H = terrainConfig({});

const gdh1 = t => t < 20 ? 2.6 + 0.365 * Math.sqrt(t) : 5.651 - 2.473 * Math.exp(-0.0278 * t);
const ps77 = t => t < 70 ? 2.5 + 0.35 * Math.sqrt(t) : 6.4 - 3.2 * Math.exp(-t / 62.8);
// a law's mean depth over Earth's triangular area–age distribution (density ∝ 1 − t/tm on [0, tm])
const triMean = (law, tm = 180) => { let s = 0, wsum = 0; for (let t = 0.25; t < tm; t += 0.5) { const p = 1 - t / tm; s += p * law(t); wsum += p; } return s / wsum; };
const EARTH = { modelLaw: triMean(seaDepthKm), gdh1: triMean(gdh1), ps77: triMean(ps77) };
console.log(`Earth's ages (triangular, tm 180, mean 60 Myr) through each law: model ${EARTH.modelLaw.toFixed(2)} km · GDH1 ${EARTH.gdh1.toFixed(2)} · PS77 ${EARTH.ps77.toFixed(2)}`);

const rows = [];
for (const seed of seeds) {
    const { scene, world } = pageWorld({ seed, cont, sim }), simMesh = buildSimMesh(sim, MESH_SEED), n = simMesh.numCells;
    const z = new Float32Array(n);
    let scratch = null;
    simulateCached(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
        if (f.time < 100) return;
        const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]]));
        surfaceKm(fr, simMesh, H, z);
        const heat = mantleWarmth(fr, simMesh, H);
        const P = pourOcean(simMesh, z, EARTH_OCEAN_KM3, scratch); scratch = P.scratch;
        let N = 0, ownerless = 0, sZ = 0, sAge = 0, sLaw = 0, sFill = 0, sSwell = 0, sLip = 0, sBasin = 0, sG = 0, sP = 0, old = 0, sRise = 0, riseVol = 0, hasRise = !!f.riseKm3;
        const cellKm2 = 4 * Math.PI * 6371 * 6371 / n;
        const ages = [];
        for (let w = 0; w < n; w++) {
            const o = fr.owner[w];
            if (o >= 0 && fr.type[w] !== CrustType.OCEAN) continue;
            if (o >= 0 && fr.seaFillKm[w] > 0 && seaFilledUp(fr.time - fr.formedAt[w], fr.seaFillKm[w])) continue;   // (filled to land)
            const age = o >= 0 && fr.formedAt[w] >= 0 ? Math.max(0, fr.time - fr.formedAt[w]) : 100;
            const law = seaDepthKm(age), fill = o >= 0 ? Math.min(law, (fr.seaFillKm[w] ?? 0) / SEDIMENT_LOAD_FACTOR) : 0;
            N++; if (o < 0) ownerless++;
            sZ += z[w]; sAge += age; sLaw += law; sFill += fill; sSwell += H.mantleSwellKm * heat[w];
            sLip += o >= 0 && fr.volcType[w] === VolcanicType.LIP ? H.lipSeaKm * Math.min(H.lipMaxKm, fr.volcKm[w]) : 0;
            sBasin += o >= 0 ? (fr.basinFillKm?.[w] ?? 0) / LAND_SEDIMENT_LOAD_FACTOR : 0;
            if (hasRise && o >= 0) { riseVol += f.riseKm3[w]; sRise += f.riseKm3[w] / cellKm2 / SEDIMENT_LOAD_FACTOR; }
            sG += gdh1(age); sP += ps77(age); if (age > 120) old++;
            ages.push(age);
        }
        const meanAge = sAge / N, k = 60 / meanAge;
        let sRescaled = 0; for (const a of ages) sRescaled += seaDepthKm(a * k);
        ages.sort((a, b) => a - b);
        let land = 0; for (let w = 0; w < n; w++) if (!P.sea[w]) land++;
        rows.push({ seed, t: Math.round(fr.time), share: N / n, ownerless: ownerless / N, zKm: sZ / N, age: meanAge, ageMedian: ages[N >> 1],
            old120: old / N, law: sLaw / N, fill: sFill / N, swell: sSwell / N, lip: sLip / N, basin: sBasin / N, gdh1: sG / N, ps77: sP / N,
            lawAtEarthMean: sRescaled / N, rise: hasRise ? sRise / N : NaN, riseVolKm3: riseVol, levelKm: P.levelKm, land: land / n });
    } }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim, meshSeed: MESH_SEED, heights: {}, by: 'ocean-floor' } });
}

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f2 = x => x.toFixed(2), pc = x => (100 * x).toFixed(1);
for (const seed of seeds) {
    const R = rows.filter(r => r.seed === seed), med = k => q(R.map(r => r[k]), 0.5);
    console.log(`\nseed ${seed} (${R.length} frames, t ≥ 100; medians over frames)`);
    console.log(`  open floor ${pc(med('share'))} % of the surface (ownerless ${pc(med('ownerless'))} %), its surface ${f2(med('zKm'))} km; Earth's water stands at ${(1000 * med('levelKm')).toFixed(0)} m (p5 ${(1000 * q(R.map(r => r.levelKm), 0.05)).toFixed(0)}, p95 ${(1000 * q(R.map(r => r.levelKm), 0.95)).toFixed(0)}), land ${pc(med('land'))} %`);
    console.log(`  ages: mean ${med('age').toFixed(0)} Myr, median ${med('ageMedian').toFixed(0)}, older than 120 Myr ${pc(med('old120'))} %  (Earth mean 62–64, triangular tm 180: ~11 % beyond 120)`);
    console.log(`  depth by its law ${f2(med('law'))} km · same ages by GDH1 ${f2(med('gdh1'))} (−${f2(med('law') - med('gdh1'))}) · by PS77 ${f2(med('ps77'))} (−${f2(med('law') - med('ps77'))}) · model law at a 60 Myr mean ${f2(med('lawAtEarthMean'))} (−${f2(med('law') - med('lawAtEarthMean'))})`);
    console.log(`  shallowing terms: sediment ${f2(med('fill'))} km · swell − sea ref ${f2(med('swell'))} · plateaus ${f2(med('lip'))} · basin fill ${f2(med('basin'))} · the rivers' rise if drawn ${f2(med('rise'))} (standing ${(med('riseVolKm3') / 1e6).toFixed(1)}e6 km³; Earth's marine sediment 3.01e8 km³, mean 0.72 km: Straume et al. 2019)`);
}
console.log(`\nEarth's ages through the model law ${f2(EARTH.modelLaw)} km, GDH1 ${f2(EARTH.gdh1)}, PS77 ${f2(EARTH.ps77)}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ EARTH, rows }));
