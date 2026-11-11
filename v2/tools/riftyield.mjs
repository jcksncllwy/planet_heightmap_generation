// riftaudit study: what a yield test would start, if rifting's timing came from the stress field instead of the dice.
// The 'cycle' scene (as riftpace.mjs), run with the rules as they are; at each plate-stress solve (field/stress-step.js,
// every plateStressEveryMyr) the continental land broken in tension (s1 > strength, the very test that stamps the diffuse
// RIFT record) is grouped into connected zones per plate, and each zone is measured: its area, its extent (a two-sweep
// diameter, km), and whether it reaches the coast at two points at least riftMinChordKm apart (a through-going band: a
// rift that could cut the plate). Per solve: how many such bands, on how many plates at once, and the share of land
// yielding. No dice drawn, nothing written: the history is the rules' own.
// Usage: node v2/tools/riftyield.mjs [simCells=20000] [seed …] [--len 1200] [--set key=value,…] [--label name] [--json]

import { labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { stressAt } from '../js/tectonics/field/plate-stress-field.js';
import { strengthOf } from '../js/tectonics/field/stress-step.js';

const args = process.argv.slice(2), flag = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const len = Number(flag('--len') ?? 1200), set = flag('--set'), label = flag('--label') ?? (set || 'base');
const json = args.includes('--json');
const overrides = set ? Object.fromEntries(set.split(',').map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; })) : {};
const nums = args.filter(a => !a.startsWith('--')).map(Number);
const cells = nums[0] || 20000, seeds = nums.length > 1 ? nums.slice(1) : [12345, 777, 4242];
const mesh = labMesh(cells), scene = TERRAIN_SCENES.find(s => s.id === 'cycle');
const R = 6371, q = (xs, f) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };

function measure(w) {
    const { mesh: m, plates, owner, ownerCell, time, config } = w, { adjOffset, adjList, numCells, xyz, cellAreaKm2 } = m;
    const km = (a, b) => R * Math.acos(Math.max(-1, Math.min(1, xyz[3 * a] * xyz[3 * b] + xyz[3 * a + 1] * xyz[3 * b + 1] + xyz[3 * a + 2] * xyz[3 * b + 2])));
    const far = (from, list) => { let best = from, d = -1; for (const c of list) { const x = km(from, c); if (x > d) { d = x; best = c; } } return [best, d]; };
    const diam = list => { if (list.length < 2) return 0; const [a] = far(list[0], list); return far(a, list)[1]; };
    const s = { s1: 0, s2: 0, dir: [0, 0, 0] }, yielded = new Uint8Array(numCells), isLand = new Uint8Array(numCells);
    let land = 0, ylan = 0;
    for (let c = 0; c < numCells; c++) {
        const o = owner[c]; if (o < 0 || plates[o].isBackground) continue;
        const cr = plates[o].crust, k = ownerCell[c], t = cr.type[k];
        if (t === CrustType.OCEAN) continue;
        isLand[c] = 1; land++;
        if (t === CrustType.ARC || !stressAt(w, c, s)) continue;
        if (s.s1 > strengthOf(cr, k, time, config, w.mantleHeat[c])) { yielded[c] = 1; ylan++; }
    }
    const seen = new Uint8Array(numCells), zones = [];
    for (let c0 = 0; c0 < numCells; c0++) {
        if (!yielded[c0] || seen[c0]) continue;
        const o = owner[c0], list = [c0], coast = []; seen[c0] = 1;
        for (let i = 0; i < list.length; i++) {
            const c = list[i]; let onCoast = false;
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) {
                const nb = adjList[k];
                if (!isLand[nb]) onCoast = true;
                else if (yielded[nb] && !seen[nb] && owner[nb] === o) { seen[nb] = 1; list.push(nb); }
            }
            if (onCoast) coast.push(c);
        }
        zones.push({ plate: o, areaKm2: list.length * cellAreaKm2, extentKm: diam(list), coastSpanKm: diam(coast) });
    }
    const big = zones.filter(z => z.areaKm2 >= 1e5);
    const bands = zones.filter(z => z.coastSpanKm >= config.riftMinChordKm);
    return { t: time, landYield: ylan / Math.max(1, land), zones: big.length, riftScale: zones.filter(z => z.extentKm >= config.riftMinChordKm).length,
        bands: bands.length, bandPlates: new Set(bands.map(z => z.plate)).size, plates: plates.filter(p => p.alive && !p.isBackground).length };
}

for (const seed of seeds) {
    const t0 = performance.now();
    const world = scene.build(mesh, seed);
    Object.assign(world.config, overrides);
    const solves = []; let seenSolves = 0;
    const drive = w => { scene.drive(w); const n = w.stressLog?.length ?? 0; if (n > seenSolves) { seenSolves = n; solves.push(measure(w)); } };
    simulate(world, { untilMyr: len, drive, snapshotEveryMyr: 10 });
    const rifts = world.events.filter(e => e.kind === EventKind.RIFT).length;
    const col = k => solves.map(x => x[k]);
    const per100 = 100 / len;
    const r = { label, seed, cells, len, secs: +((performance.now() - t0) / 1000).toFixed(1), solves: solves.length, rifts, riftsPer100: +(rifts * per100).toFixed(2),
        landYield: { median: +q(col('landYield'), 0.5).toFixed(3), p90: +q(col('landYield'), 0.9).toFixed(3) },
        zonesPerSolve: { median: q(col('zones'), 0.5), max: Math.max(...col('zones')) },
        riftScalePerSolve: { median: q(col('riftScale'), 0.5), max: Math.max(...col('riftScale')) },
        bandsPerSolve: { mean: +(col('bands').reduce((a, b) => a + b, 0) / solves.length).toFixed(2), median: q(col('bands'), 0.5), max: Math.max(...col('bands')) },
        solvesWithBand: +(solves.filter(x => x.bands > 0).length / solves.length).toFixed(2),
        bandPlatesPerSolve: { median: q(col('bandPlates'), 0.5), max: Math.max(...col('bandPlates')) },
        series: solves.filter((_, i) => i % 5 === 0).map(x => `${Math.round(x.t)}:${x.bands}/${x.zones}/${(100 * x.landYield).toFixed(0)}%`) };
    if (json) console.log(JSON.stringify(r)); else console.log(JSON.stringify(r, null, 1));
}
