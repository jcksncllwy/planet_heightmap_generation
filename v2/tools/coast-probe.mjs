// What the sim knows under a point of the drawn map: the sim cells of the triangle the point falls in (unwarped — the
// lookup's warps move it by up to warpKm + cellWarp of a cell, so read the corners as "the cells about here"), each with its
// crust, its side of the land mask, whether the pour drowned it (its column, seaColKm), the floor depth the sea side reads,
// its signed coast distance before and after the margin's line, and its platform. For finding where a drawn feature comes
// from (lane coasts: the pale shelf patches and flat islands under the water inventory).
//
//   node v2/tools/coast-probe.mjs --seed 831576 --cont 30 --time 430 [--sim 40000] [--set key=value,…] --probe "lat,lon;lat,lon"
//        [--box lat0,lat1,lon0,lon1]  (every sim cell in the box, as a grid of characters: see the legend it prints)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { deriveRecords } from '../js/terrain/records.js';
import { landMask } from '../js/terrain/land-mask.js';
import { locate } from '../js/core/mesh-locate.js';
import { momentFrame, MESH_SEED, DEFAULT_CONT } from './lib/moment-frame.mjs';

setDelaunator(Delaunator);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('--seed', 831576)), CONT = Number(arg('--cont', DEFAULT_CONT)), SIM = Number(arg('--sim', 40000)), TIME = Number(arg('--time', 430));
const SET = Object.fromEntries((arg('--set', '') || '').split(/,(?=[A-Za-z])/).filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, Number.isFinite(Number(v)) ? Number(v) : JSON.parse(v)]; }));
const cfg = terrainConfig(SET), D2R = Math.PI / 180;

const frame = await momentFrame(ROOT, { seed: SEED, cont: CONT, sim: SIM, time: TIME });
const simMesh = buildSimMesh(SIM, MESH_SEED);
const mask = landMask(frame, simMesh, cfg);
const rec = deriveRecords(frame, simMesh, cfg, SEED);
const TYPE = ['ocean', 'continent', 'craton', 'arc'];
const xyzOf = (lat, lon) => [Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R)];
const latLon = c => { const x = simMesh.xyz[3 * c], y = simMesh.xyz[3 * c + 1], z = simMesh.xyz[3 * c + 2]; return [Math.asin(z) / D2R, Math.atan2(y, x) / D2R]; };
// (the sim mesh's own convention for lat/lon: checked on the cell nearest the point, printed with it)
const f2 = v => (v === v ? v.toFixed(2) : '—');
console.log(`seed ${SEED} at ${TIME} Myr: sea level ${rec.seaKm.toFixed(3)} km (the pour's: waterInventory ${cfg.waterInventory})`);
const describe = c => `cell ${c} @${latLon(c).map(v => v.toFixed(1)).join(',')} ${TYPE[frame.type[c]] ?? '?'} owner ${frame.owner[c]} · mask ${mask.land[c] ? 'land' : 'sea'}${mask.seaColKm[c] === mask.seaColKm[c] ? ` DROWNED col ${f2(mask.seaColKm[c])}` : ''}${mask.dryHollow[c] ? ' dryHollow' : ''} · rec ${rec.land[c] ? 'land' : 'sea'} coast ${Math.round(rec.coastKm[c])} km · depth ${f2(rec.depthKm[c])} platform ${f2(rec.platformKm[c])} shelf ${Math.round(rec.shelfKm[c])} seaFill ${f2(frame.seaFillKm?.[c] ?? NaN)} · lip ${f2(rec.lipKm?.[c] ?? NaN)} lipEdge ${f2(rec.lipEdgeKm?.[c] ?? NaN)} uplift ${f2(rec.upliftKm?.[c] ?? NaN)} arcKm ${f2(frame.arcKm?.[c] ?? NaN)} arc ${rec.arc[c]} rise ${f2(rec.riseKm?.[c] ?? NaN)} swell ${f2(rec.swellKm?.[c] ?? NaN)} age ${f2(rec.ageMyr?.[c] ?? NaN)} terrane ${frame.terrane?.[c] ?? '—'}`;
const cells = new Int32Array(3), w = new Float64Array(3);
for (const p of (arg('--probe', '') || '').split(';').filter(Boolean)) {
    const [lat, lon] = p.split(',').map(Number);
    locate(simMesh, ...xyzOf(lat, lon), cells, w);
    console.log(`\nprobe ${lat},${lon}:`);
    for (let i = 0; i < 3; i++) console.log(`  w ${w[i].toFixed(2)} ${describe(cells[i])}`);
}
// (--box: each sim cell in it as one character — '#' land, '+' land the margin's line turned to sea, 'o' sea the line turned
// to land, 'd' sea the pour drowned (continental column), '.' ocean crust's sea, 'h' a dry hollow — rows north to south)
const box = arg('--box', null)?.split(',').map(Number);
if (box) {
    const [la0, la1, lo0, lo1] = box, step = simMesh.edgeKm / 111.2 * 0.9, rows = [];
    for (let la = la1; la >= la0; la -= step) {
        let row = '';
        for (let lo = lo0; lo <= lo1; lo += step / Math.max(0.2, Math.cos(la * D2R))) {
            const c = simMesh.index.nearest(...xyzOf(la, lo));
            const mland = mask.land[c] === 1, rland = rec.land[c] === 1, side = rec.coastKm[c] >= 0;
            row += mask.dryHollow[c] ? 'h' : mland ? (side ? '#' : '+') : mask.seaColKm[c] === mask.seaColKm[c] ? (side ? 'D' : 'd') : (side ? 'o' : '.');
            void rland;
        }
        rows.push(`${la.toFixed(1).padStart(6)} ${row}`);
    }
    console.log(`\nbox ${box.join(',')} (# land, + land drawn as sea by the line, d drowned by the pour, D drowned but drawn as land, . sea, o sea drawn as land, h dry hollow):\n` + rows.join('\n'));
}

// (--terrain [cells]: the tectonic surface synthesize.js draws at each probe, before the finish — its height and parts at
// the terrain cell nearest the point, and the sim cells its warped lookup read: tells the history's ground from the finish's)
if (process.argv.includes('--terrain')) {
    const { terrainMesh } = await import('../js/terrain/terrain-mesh.js');
    const { synthesizeTerrain } = await import('../js/terrain/synthesize.js');
    const { sampleOnto } = await import('../js/terrain/terrain-mesh.js');
    const tm = terrainMesh(Number(arg('--terrain', '640000')) || 640000), S = sampleOnto(simMesh, tm, cfg, SEED);
    const nT = tm.numCells, DB = globalThis.__coastDbg = { rs: new Float32Array(nT).fill(NaN), floor: new Float32Array(nT).fill(NaN), c: new Int32Array(3 * nT), w: new Float32Array(3 * nT), slope: new Float32Array(nT), top: new Float32Array(nT), coast: new Float32Array(nT), act: new Float32Array(nT), lift: new Float32Array(nT), tk: new Float32Array(nT).fill(NaN), rk: new Float32Array(nT).fill(NaN) };
    const T = synthesizeTerrain(frame, simMesh, tm, { cfg, seed: SEED, parts: true, sampler: S });
    { const H = T.tectonicKm ?? T.heightKm; let off = 0, dry = 0, dryRift = 0, dryFore = 0, dryNear = 0;
      for (let t = 0; t < nT; t++) { if (!(DB.floor[t] === DB.floor[t])) continue; off++; if (H[t] > 0) { dry++; if (DB.rs[t] > 0.5) dryRift++; if (DB.tk[t] < 450) dryFore++; if (DB.coast[t] > -60) dryNear++; } }
      console.log(`sea-side cells drawn dry: ${dry} of ${off} (${(100 * dry / off).toFixed(2)} %); of them rifted ${dryRift}, forearc ${dryFore}, within 60 km of the line ${dryNear}`); }
    for (const p of (arg('--probe', '') || '').split(';').filter(Boolean)) {
        const [lat, lon] = p.split(',').map(Number), t = tm.index.nearest(...xyzOf(lat, lon)), P = T.parts;
        const read = [0, 1, 2].map(i => `${S.cells[3 * t + i]}(${S.weights[3 * t + i].toFixed(2)})`).join(' ');
        if (DB.floor[t] === DB.floor[t]) console.log(`  sea side: floor ${f2(DB.floor[t])} top ${f2(DB.top[t])} slope ${Math.round(DB.slope[t])} coast ${Math.round(DB.coast[t])} rs ${f2(DB.rs[t])} act ${f2(DB.act[t])} tk ${Math.round(DB.tk[t])} rk ${Math.round(DB.rk[t])}; read ${[0, 1, 2].map(i => `${DB.c[3 * t + i]}(${DB.w[3 * t + i].toFixed(2)}) depth ${f2(rec.depthKm[DB.c[3 * t + i]])} ${mask.land[DB.c[3 * t + i]] ? 'LAND' : 'sea'} @${latLon(DB.c[3 * t + i]).map(v => v.toFixed(1)).join(',')}`).join(' · ')}`);
        console.log(`terrain ${lat},${lon}: [sea dbg rs ${f2(P.dshelf[t])} thinW ${Math.round(P.dplain[t])} raster ${P.dcoast[t]} floor ${f2(P.stripes[t])} c0 ${Math.floor(P.cones[t])} (${describe(Math.floor(P.cones[t])).slice(0, 160)})] h ${f2((T.tectonicKm ?? T.heightKm)[t])} km · platform ${f2(P.platform[t])} relief ${f2(P.relief[t])} lip ${f2(P.lip[t])} coastRaw ${Math.round(P.dcoastRaw[t])} (world ${Math.round([0, 1, 2].reduce((s, i) => s + S.weights[3 * t + i] * rec.coastKm[S.cells[3 * t + i]], 0))}) slope ${Math.round([0, 1, 2].reduce((s, i) => s + S.weights[3 * t + i] * rec.slopeKm[S.cells[3 * t + i]], 0))} rift ${[0, 1, 2].map(i => f2(rec.riftShare[S.cells[3 * t + i]])).join("/")} thin ${[0, 1, 2].map(i => Math.round(rec.thinKm[S.cells[3 * t + i]])).join("/")} · read sim cells ${read}`);
    }
}
// (--terrain: the sea side of the coast line drawn dry — terrain cells whose coast distance is offshore but whose height
// stands above the sea — by what drew them: the rifted margin's section (rs), the forearc ramp (a trench in reach), the rest)
if (process.argv.includes('--terrain') && globalThis.__coastDbg) {
    const DB = globalThis.__coastDbg, n = DB.floor.length;
    // (re-derived from the debug buffers; the tectonic heights are not kept above, so this reads the sea side's own state)
    let sea = 0, rift = 0, fore = 0;
    for (let t = 0; t < n; t++) { if (!(DB.floor[t] === DB.floor[t])) continue; sea++; if (DB.rs[t] > 0.5) rift++; if (DB.tk[t] < 450) fore++; }
    console.log(`sea-side terrain cells ${sea}: rifted section ${(100 * rift / sea).toFixed(1)} %, forearc ramp in reach ${(100 * fore / sea).toFixed(1)} %`);
    // (the forearc ramp's lift by the wedge's width W, coast to trench through the cell: Earth's forearcs are 100–250 km, so a
    // lift where W is far beyond that is a trench of another margin drawing a shallow patch offshore — lane coasts2)
    if (DB.lift) { const bins = [[0, 250], [250, 400], [400, 1e9]].map(([a, b]) => ({ a, b, n: 0, km: 0 }));
      for (let t = 0; t < n; t++) if (DB.lift[t] > 0.3) { const W = DB.tk[t] - DB.coast[t], B = bins.find(x => W >= x.a && W < x.b); if (B) { B.n++; B.km += DB.lift[t]; } }
      console.log('forearc ramp lifting > 0.3 km, by W coast to trench: ' + bins.map(B => `${B.a}–${B.b < 1e9 ? B.b : '∞'} km ${B.n} cells (mean ${(B.km / Math.max(1, B.n)).toFixed(2)} km)`).join(' · ')); }
}
