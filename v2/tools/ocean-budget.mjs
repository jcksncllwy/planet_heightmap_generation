// The ocean's volume budget, term by term (lane sealevel, 2026-11-12): why the poured sea stands below the datum. Earth's
// water (tectonics/ocean/inventory.js EARTH_OCEAN_KM3) fills the room below the datum (z < 0) on Earth's ground exactly
// (check-ocean-earth.mjs: ETOPO5 pours to 0 m). On a history's ground (surfaceKm) the room at the datum is V(0); the sea
// stands below the datum by ≈ (V(0) − V_earth) ÷ the sea's area. This splits V(0) into who holds it: the ocean crust (its
// area, and its mean depth split into the depth–age law at its ages, the sediment, the swell against the sea's reference,
// plateaus), the drowned continental and arc crust (the margins), water behind sills, and the depth bands — against
// Earth's ETOPO5 on the same mesh size.
//   node v2/tools/ocean-budget.mjs --moments 831576@430,243751@720 [--sim 40000] [--tset k=v,…] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { momentFrame, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { landMask } from '../js/terrain/land-mask.js';
import { surfaceKm, pourOcean, EARTH_OCEAN_KM3 } from '../js/tectonics/ocean/inventory.js';
import { gdh1BasementKm, filledSeaDepthKm, LAND_SEDIMENT_LOAD_FACTOR } from '../js/tectonics/measure.js';
import { CrustType, VolcanicType } from '../js/tectonics/model/crust.js';
import { labMesh } from './lib/check-kit.mjs';
import { earthSurfaceKm } from './lib/earth-surface.mjs';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SIM = Number(arg('--sim', 40000)), JSON_OUT = arg('--json', null);
const MOMENTS = arg('--moments', '831576@430').split(',').map(s => s.split('@').map(Number));
const TSET = Object.fromEntries((arg('--tset', '') || '').split(',').filter(Boolean).map(kv => kv.split('=')).map(([k, v]) => [k, Number(v)]));
const H = terrainConfig(TSET), R = 6371, AREA = 4 * Math.PI * R * R;
const BANDS = [0, 0.2, 1, 2, 3, 4, 5, 6, 99];

// room below the datum by depth band (km³ per band of the column: the water between band edges over cells deeper than each)
function bands(z, wet) {
    const n = z.length, a = AREA / n, out = BANDS.slice(1).map(() => 0), area = BANDS.slice(1).map(() => 0);
    for (let w = 0; w < n; w++) {
        if (!wet(w) || !(z[w] < 0)) continue;
        const d = -z[w];
        for (let b = 0; b < BANDS.length - 1; b++) {
            const lo = BANDS[b], hi = BANDS[b + 1];
            if (d > lo) out[b] += (Math.min(d, hi) - lo) * a;
            if (d > lo && d <= hi) area[b] += a;
        }
    }
    return { km3: out.map(v => +(v / 1e6).toFixed(1)), areaPct: area.map(v => +(100 * v / AREA).toFixed(2)) };   // km3 in 1e6 km³
}

const out = { tset: TSET, bands: BANDS, earth: null, moments: [] };
{
    const mesh = labMesh(SIM), E = earthSurfaceKm(mesh);
    if (!E.error) {
        const z = E.z, n = z.length, a = AREA / n, P = pourOcean(mesh, z, EARTH_OCEAN_KM3);
        let v0 = 0, below0 = 0; for (let w = 0; w < n; w++) if (P.spill[w] < 0) { v0 += -z[w] * a; below0++; }
        out.earth = { levelKm: +P.levelKm.toFixed(3), land: +(100 * (1 - P.seaCells / n)).toFixed(1), V0e6: +(v0 / 1e6).toFixed(1), seaPctAtDatum: +(100 * below0 / n).toFixed(1),
            meanDepthAtDatum: +(v0 / (below0 * a)).toFixed(3), bands: bands(z, w => P.spill[w] < 0) };
    } else out.earth = { error: E.error };
}
console.log('earth', JSON.stringify(out.earth));

for (const [seed, time] of MOMENTS) {
    const frame = await momentFrame(ROOT, { seed, cont: DEFAULT_CONT, sim: SIM, time });
    const simMesh = buildSimMesh(SIM, MESH_SEED), n = simMesh.numCells, a = AREA / n;
    const m = landMask(frame, simMesh, H), sl = m.sl, z = surfaceKm(frame, simMesh, H, new Float32Array(n), sl.swellKm);
    const P = pourOcean(simMesh, z, H.waterInventory * EARTH_OCEAN_KM3, null, { fromOcean: true });
    const seaRef = sl.seaRefKm;                                  // (the floor's swell against the mantle under its young floor: sea-level.js youngFloorSwellKm)
    // V(0): the room under the datum the ocean reaches at the datum (spill < 0), and who holds it
    const kinds = {}, add = (k, w) => { const r = kinds[k] ??= { cells: 0, km3: 0 }; r.cells++; r.km3 += -z[w] * a; };
    // the ocean crust's mean depth below the datum, split: −z = gdh1(age) − sediment (the pelagic drape and the rivers' rock, loaded) − swell − lip − fill
    const oc = { cells: 0, age: 0, gdh1: 0, sed: 0, swell: 0, lip: 0, fill: 0, ageHist: [0, 0, 0, 0, 0, 0, 0], bin: [], heat: [] };   // ages 0-20-40-60-100-140-180-∞
    const AGE_EDGES = [20, 40, 60, 100, 140, 180, Infinity];
    for (let w = 0; w < n; w++) {
        if (!(P.spill[w] < 0)) continue;
        const o = frame.owner[w], t = frame.type[w];
        const k = o < 0 ? 'gap' : t === CrustType.OCEAN ? 'ocean' : t === CrustType.ARC ? 'arc' : t === CrustType.CRATON ? 'craton' : 'continent';
        add(k, w);
        if (k !== 'ocean' && k !== 'gap') continue;
        const age = o >= 0 && frame.formedAt[w] >= 0 ? Math.max(0, frame.time - frame.formedAt[w]) : 100;
        const rock = o >= 0 ? (frame.seaFillKm?.[w] ?? 0) + (frame.riseKm3?.[w] ?? 0) / simMesh.cellAreaKm2 : 0;
        oc.cells++; oc.age += age; oc.gdh1 += gdh1BasementKm(age); oc.sed += gdh1BasementKm(age) - filledSeaDepthKm(age, rock);
        oc.swell += sl.swellKm[w] - seaRef;
        oc.lip += o >= 0 && frame.volcType[w] === VolcanicType.LIP ? H.lipSeaKm * Math.min(H.lipMaxKm, frame.volcKm[w]) : 0;
        oc.fill += o >= 0 ? (frame.basinFillKm?.[w] ?? 0) / LAND_SEDIMENT_LOAD_FACTOR : 0;
        const b = AGE_EDGES.findIndex(e => age < e); oc.ageHist[b]++;
        const r = oc.bin[b] ??= { n: 0, gdh1: 0, sed: 0, swell: 0, z: 0 }; r.n++; r.gdh1 += gdh1BasementKm(age); r.sed += gdh1BasementKm(age) - filledSeaDepthKm(age, rock); r.swell += sl.swellKm[w] - seaRef; r.z += -z[w];
        oc.heat.push(sl.swellKm[w] / H.mantleSwellKm);
    }
    let v0 = 0, cells0 = 0; for (const k in kinds) { v0 += kinds[k].km3; cells0 += kinds[k].cells; }
    const mean = v => +(v / oc.cells).toFixed(3);
    const row = { seed, time, levelKm: +P.levelKm.toFixed(3), maskSeaKm: +sl.seaKm.toFixed(3), land: +(100 * (1 - P.seaCells / n)).toFixed(1), closedBelow: P.below, pin: P.pin,
        V0e6: +(v0 / 1e6).toFixed(1), seaPctAtDatum: +(100 * cells0 / n).toFixed(1), meanDepthAtDatum: +(v0 / (cells0 * a)).toFixed(3),
        kinds: Object.fromEntries(Object.entries(kinds).map(([k, r]) => [k, { pct: +(100 * r.cells / n).toFixed(2), km3e6: +(r.km3 / 1e6).toFixed(1), meanKm: +(r.km3 / r.cells / a).toFixed(3) }])),
        ocean: { pct: +(100 * oc.cells / n).toFixed(2), ageMyr: mean(oc.age), gdh1Km: mean(oc.gdh1), sedimentKm: mean(oc.sed), swellKm: mean(oc.swell), lipKm: mean(oc.lip), fillKm: mean(oc.fill),
            ageSharePct: oc.ageHist.map(c => +(100 * c / oc.cells).toFixed(1)),
            byAge: oc.bin.map((r, i) => r && { to: AGE_EDGES[i], depth: +(r.z / r.n).toFixed(2), gdh1: +(r.gdh1 / r.n).toFixed(2), sed: +(r.sed / r.n).toFixed(2), swell: +(r.swell / r.n).toFixed(2) }),
            heatQ: (h => [0.05, 0.1, 0.25, 0.5, 0.75, 0.9].map(p => +h[Math.floor(p * (h.length - 1))].toFixed(3)))(oc.heat.sort((x, y) => x - y)) },
        oceanCrustAllPct: 0, bands: bands(z, w => P.spill[w] < 0) };
    let ocAll = 0; for (let w = 0; w < n; w++) if (frame.owner[w] < 0 || frame.type[w] === CrustType.OCEAN) ocAll++;
    row.oceanCrustAllPct = +(100 * ocAll / n).toFixed(2);
    out.moments.push(row);
    console.log(JSON.stringify(row));
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
process.exit(0);
