// Headless checks for the ice age's outburst floods (finish/finish-floods.js, finish-ice.js): a lake is ice-dammed only
// where the ice stands across its way out — the water a priority flood with the ice as a wall holds above where the bare
// ground would hold it, if its catchment's water can fill it. Hard: on a valley of a few cells, ice across the outlet
// holds a lake (in a wet climate, not a dry one) and ice up in the mountains holds none; and on finished worlds, every lake booked as ice-dammed has ice across its way out (a bug guard: on
// 2026-10-29 a NaN height under shelf ice broke the floods' heap and 36 Mkm² of closed basins, some at the equator, were
// booked as dammed), and the ice age leaves no height that is not a number. Reported against the last glacial's ice-dammed
// lakes: how many there were, their area, the largest's water, how near the equator they came.
// Usage: node v2/tools/check-floods.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, report, section, finish } from './lib/check-kit.mjs';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { momentFrame, MESH_SEED } from './lib/moment-frame.mjs';
import { TerrainPool } from '../js/terrain/terrain-pool.js';
import { finishPlanet } from '../js/finish/finish.js';
import { FINISH } from '../js/finish/finish-config.js';
import { outburstFloods } from '../js/finish/finish-floods.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = 6371, F = FINISH;

section('a valley and its ice');
// A valley as a chain of cells along the equator, 30 km apart, 1000 km² each: the sea, a coastal plain rising to a sill
// 300 m up, a basin 50 m up behind it, and the land rising beyond to a range 2 km high. Without ice the basin is a closed
// hollow, filled (by the bare ground's flood) to its sill: no ice holds it.
{
    const N = 400, stepKm = 30, cellKm2 = 1000, ground = [];
    for (let i = 0; i < N; i++) ground.push(i < 20 ? -1 : i < 40 ? 0.02 + 0.01 * (i - 20) : i === 40 ? 0.3 : i <= 120 ? 0.05 : 0.4 + 1.6 * (i - 121) / (N - 122));
    const adjOffset = new Int32Array(N + 1), adj = [], xyz = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) {
        if (i > 0) adj.push(i - 1);
        if (i < N - 1) adj.push(i + 1);
        adjOffset[i + 1] = adj.length;
        const a = i * stepKm / R;
        xyz[3 * i] = Math.cos(a); xyz[3 * i + 1] = Math.sin(a);
    }
    const mesh = { numCells: N, adjOffset, adjList: Int32Array.from(adj), xyz, edgeKm: stepKm };
    const valley = (from, to, surfaceKm, water = null) => {
        const z = Float32Array.from(ground), ice = new Uint8Array(N), S = new Float32Array(N);
        for (let i = from; i <= to; i++) { ice[i] = 1; S[i] = Math.max(z[i] + 0.05, surfaceKm); }
        return outburstFloods({ mesh, z, ice, S, cellKm2, seed: 1, water }, F);
    };
    // (the ice age's water, the same everywhere: rain, runoff and potential evaporation, mm/year)
    const climate = (rain, runoff, pet) => ({ rain: new Float32Array(N).fill(rain), runoff: new Float32Array(N).fill(runoff), pet: new Float32Array(N).fill(pet) });
    // (a lobe across the sill, its surface 1 km up: the basin backs up behind it to the lobe's surface — Lake Missoula behind the Purcell lobe)
    const dammed = valley(35, 45, 1.0);
    check('ice across a valley\'s outlet holds a lake behind it, and the lake has ice across its way out', dammed.lakes === 1 && dammed.unheld === 0,
        `${dammed.lakes} lake(s), ${Math.round(dammed.lakeKm2).toLocaleString()} km², ${Math.round(dammed.volumeKm3).toLocaleString()} km³; ${dammed.unheld} with no ice across its way out`);
    // (the same dam in a wet cold climate — 500 mm of rain, 300 of it running off, 250 mm of potential evaporation: the
    // valley's ~275 cells of catchment feed far more than the lake's surface loses — and in a dry one: 150 mm of rain, 5 mm
    // running off, 1500 mm of potential evaporation, its surface losing ~1.6 m a year)
    const wet = valley(35, 45, 1.0, climate(500, 300, 250)), dry = valley(35, 45, 1.0, climate(150, 5, 1500));
    check('the dammed valley fills in a wet climate and not in a dry one (a lake that loses more than comes in never reaches its dam)', wet.lakes === 1 && dry.lakes === 0,
        `wet ${wet.lakes} lake(s) · dry ${dry.lakes}`);
    // (a glacier in the range above the basin, none at its sill: the hollow is the hollow it always was)
    const upstream = valley(300, N - 1, 2.5);
    check('ice up in the range above a closed hollow, none across its outlet, dams no lake', upstream.lakes === 0, `${upstream.lakes} lake(s), ${Math.round(upstream.lakeKm2).toLocaleString()} km²`);
}

section('ice-dammed lakes on finished worlds (finished at 160K cells)');
// The moments: the one the regression was found on (seed 831576 at 310 Myr: 142 lakes booked, the largest 4.4 Mkm² at
// 3.6°N), and the basins suite's three seeds at the cycle's two ends.
const MOMENTS = [[831576, 310], [626225, 300], [626225, 950], [777, 300], [777, 950], [12345, 300], [12345, 950]];
const SIM = 40000, CELLS = 160000, simMesh = buildSimMesh(SIM, MESH_SEED), rows = [];
for (const [seed, time] of MOMENTS) {
    const frame = await momentFrame(ROOT, { seed, cont: 30, sim: SIM, time });
    const pool = await TerrainPool.create(simMesh);
    const fin = await finishPlanet({ frame, simMesh, seed, cells: CELLS, pool, closePool: true });
    const fl = fin.stats.floods, g = fl.guard ?? { unheld: NaN, lats: [] };
    let bad = 0;
    for (let c = 0; c < fin.z.length; c++) if (!Number.isFinite(fin.z[c])) bad++;
    const lowLat = g.lats.length ? Math.min(...g.lats.map(Math.abs)) : NaN;
    rows.push({ label: `${seed}@${time}`, lakes: fl.lakes, km2: fl.lakeKm2, largestKm3: fl.largestKm3, largestKm2: fl.biggest[0]?.km2 ?? 0, unheld: g.unheld, bad, lowLat, iceKm2: fin.stats.iceKm2 });
    console.log(`    ${seed} at ${time} Myr: ice ${(fin.stats.iceKm2 / 1e6).toFixed(1)} Mkm²; ${fl.lakes} ice-dammed lakes, ${(fl.lakeKm2 / 1e6).toFixed(2)} Mkm², ${Math.round(fl.volumeKm3).toLocaleString()} km³, the largest ${Math.round(fl.largestKm3).toLocaleString()} km³; at ${g.lats.map(v => `${v}°`).join(', ') || '—'}`);
}
const each = f => rows.map(r => `${r.label} ${f(r)}`).join(' · ');
check('every ice-dammed lake has ice across its way out (bug guard: the floods agree)', rows.every(r => r.unheld === 0), each(r => `${r.unheld} of ${r.lakes}`));
check('the ice age leaves every height a number (bug guard: a NaN breaks the floods\' heap)', rows.every(r => r.bad === 0), each(r => `${r.bad}`));
// (the last glacial's, at its greatest: North America's — Agassiz, Ojibway, McConnell, Missoula, Columbia — and Eurasia's —
// the Baltic Ice Lake, the West Siberian lakes and Komi, Vitim. Not all at once, and how many a world has depends on how
// much land its cycle has put under the ice: none with no continent near a pole)
const glacial = rows.filter(r => r.iceKm2 > 1e6), withLakes = rows.filter(r => r.lakes > 0);
report('ice-dammed lakes ≥ 5000 km² at the ice age, worlds with over 1 Mkm² of ice', glacial.map(r => r.lakes), { earth: [3, 25], digits: 0,
    source: 'the last glaciation: Agassiz, Ojibway, McConnell, Missoula, Columbia (Teller 1987); the Baltic Ice Lake (Jakobsson et al. 2007); West Siberia, Komi, Pechora (Mangerud et al. 2004); Vitim (Margold et al. 2018)',
    detail: each(r => `${r.lakes} (ice ${(r.iceKm2 / 1e6).toFixed(1)} Mkm²)`) });
report('their area in all', glacial.map(r => r.km2 / 1e6), { earth: [0.2, 1.5], unit: ' Mkm²', digits: 2,
    source: 'Agassiz >0.26 Mkm² (Leverington et al. 2000), the Baltic Ice Lake 0.35 (Jakobsson et al. 2007), the West Siberian lakes together ~twice the Caspian, ~0.74 (Krinner et al. 2004; Mangerud et al. 2004)' });
report('the largest one\'s water (held above the bare ground)', withLakes.map(r => r.largestKm3), { earth: [1e4, 2e5], unit: ' km³', digits: 0,
    source: 'Agassiz ≥22 700 km³ at 9.4 ka (Leverington et al. 2000), up to ~163 000 at its greatest (Teller et al. 2002); the Baltic Ice Lake ~29 000 (Jakobsson et al. 2007); Missoula ~2 500 (O\'Connor & Baker 1992)' });
report('the largest one\'s area', withLakes.map(r => r.largestKm2 / 1e6), { earth: [0.1, 0.8], unit: ' Mkm²', digits: 2,
    source: 'Agassiz 0.15–0.26 Mkm² (Leverington et al. 2000, 2002), the Baltic Ice Lake 0.35 (Jakobsson et al. 2007), the West Siberian lake (Mangerud et al. 2004)' });
report('the nearest any came to the equator', withLakes.map(r => r.lowLat), { earth: [40, 90], unit: '°', digits: 1,
    source: 'Missoula at 47°N and Columbia at 48°N the lowest of those over 5000 km² (O\'Connor & Baker 1992); the mountain glaciers\' lakes nearer the equator are far smaller (the Tsangpo\'s, ~30°N, Montgomery et al. 2004)' });

finish('floods');
