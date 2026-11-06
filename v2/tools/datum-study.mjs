#!/usr/bin/env node
// Where the land, the sea and the surface datum disagree (standing goal #8, review U3): the records' land
// (terrain/records.js deriveRecords) against the history rivers' (tectonics/step/rivers.js: sea-level.js landAndSea)
// and against the drawn surface (synthesize.js), on whole-planet histories. Prints one JSON line per seed × moment.
//   node v2/tools/datum-study.mjs [--seeds 12345,777,4242] [--times 300,560] [--tm 160000]
import { labMesh } from './lib/check-kit.mjs';
import { simulateCached } from './lib/history-cache.mjs';
import { onPath } from './lib/paths.mjs';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { synthesizeTerrain } from '../js/terrain/synthesize.js';
import { landAndSea } from '../js/terrain/sea-level.js';
import { seaFilledUp } from '../js/tectonics/measure.js';
import { worldOcean } from '../js/terrain/world-ocean.js';
import { heightsOf } from '../js/tectonics/step/heights.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const seeds = arg('--seeds', '12345,777,4242').split(',').map(Number), times = arg('--times', '300,560').split(',').map(Number);
const mesh = labMesh(), n = mesh.numCells, tm = terrainMesh(Number(arg('--tm', '160000'))), tn = tm.numCells;
const cellKm2 = 4 * Math.PI * 6371 ** 2 / n, tKm2 = 4 * Math.PI * 6371 ** 2 / tn;
const scene = TERRAIN_SCENES.find(s => s.id === 'history');
const r = x => Math.round(x), r2 = x => Math.round(100 * x) / 100;

for (const seed of seeds) {
    const world = onPath(scene.build(mesh, seed));
    const { frames } = simulateCached(world, { untilMyr: Math.max(...times), drive: w => scene.drive(w), snapshotEveryMyr: 10 }, { drive: scene.drive });
    const H = heightsOf(world.config);
    for (const time of times) {
        const F = frames.find(f => f.time === time);
        if (!F) { console.log(JSON.stringify({ seed, time, missing: true })); continue; }
        const T = synthesizeTerrain(F, mesh, tm, { seed, parts: true }), rec = T.rec;
        // ── the rivers' land, as step/rivers.js builds it from the world view ──
        const rl = new Uint8Array(n);
        for (let w = 0; w < n; w++) if (F.owner[w] >= 0 && (F.type[w] !== CrustType.OCEAN || (F.seaFillKm[w] > 0 && seaFilledUp(time - F.formedAt[w], F.seaFillKm[w])))) rl[w] = 1;
        const slR = landAndSea(F, mesh, H, rl);
        let recLand = 0, rivLand = 0, recOnly = 0, rivOnly = 0, rivOnlyCont = 0, rivOnlyArc = 0;
        for (let w = 0; w < n; w++) {
            const a = rec.land[w] ? 1 : 0, b = rl[w] ? 1 : 0;
            recLand += a; rivLand += b;
            if (a && !b) recOnly++;
            if (b && !a) { rivOnly++; if (F.type[w] === CrustType.ARC) rivOnlyArc++; else rivOnlyCont++; }
        }
        // ── the drawn surface (heights against the sea's level) against the records' land, per sim cell ──
        const up = new Float64Array(n), cnt = new Uint32Array(n), wet = new Uint32Array(n);
        let drawnLand = 0, drawnSeaRecLand = 0, drawnLandRecSea = 0;
        for (let t = 0; t < tn; t++) {
            const w = T.sampler.cells[3 * t], z = T.heightKm[t], dry = z >= 0;
            up[w] += z; cnt[w]++; if (!dry) wet[w]++;
            if (dry) drawnLand++;
            if (!dry && rec.land[w]) drawnSeaRecLand++;
            if (dry && !rec.land[w]) drawnLandRecSea++;
        }
        // land cells (records) whose terrain points are mostly under the sea; how deep; how many have their column well up
        const under = [];
        for (let w = 0; w < n; w++) if (rec.land[w] && cnt[w] && wet[w] > cnt[w] / 2) {
            let seaN = 0; for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1]; k++) if (!rec.land[mesh.adjList[k]]) seaN++;
            under.push({ mean: up[w] / cnt[w], seaN, dry: rec.dryHollow?.[w] ? 1 : 0 });
        }
        // why: each terrain point under the sea on land (records; not a dry hollow) — the margin line flipped its sim cell to
        // sea (rec.coastKm < 0 at the cell), the coast read there (line, warp) is offshore, the coast noise / fine detail /
        // arc straits moved it offshore, or the coast is onshore and the height still came out under the sea
        const why = { cellFlipped: 0, rawOffshore: 0, noiseOffshore: 0, onshoreLow: 0 }, zOf = { cellFlipped: [], rawOffshore: [], noiseOffshore: [], onshoreLow: [] }, riftOn = [];
        for (let t = 0; t < tn; t++) {
            const w = T.sampler.cells[3 * t];
            if (!rec.land[w] || rec.dryHollow[w] || !(T.heightKm[t] < 0)) continue;
            const k = rec.coastKm[w] < 0 ? 'cellFlipped' : T.parts.dcoastRaw[t] < 0 ? 'rawOffshore' : T.parts.dcoast[t] > 0 ? 'onshoreLow' : 'noiseOffshore';   // (dcoast: land side only)
            why[k]++; zOf[k].push(T.heightKm[t]);
            if (k === 'onshoreLow') riftOn.push(rec.riftShare[w]);
        }
        const um = under.map(u => u.mean).sort((a, b) => a - b), q = p => um.length ? r2(um[Math.min(um.length - 1, Math.floor(p * um.length))]) : null;
        // ── bodies below the sea cut off from the world ocean, on the drawn surface ──
        const wo = worldOcean(tm, T.heightKm, 0);
        let cutPts = 0, cutOnRecSea = 0, cutOnRecLandHollow = 0, cutOnRecLandOther = 0, cutBodies = wo.bodies.length - 1;
        for (let t = 0; t < tn; t++) if (wo.cut[t]) {
            const w = T.sampler.cells[3 * t]; cutPts++;
            if (!rec.land[w]) cutOnRecSea++; else if (rec.dryHollow?.[w]) cutOnRecLandHollow++; else cutOnRecLandOther++;
        }
        // ── the history's rivers: drainage it routed across cells the records (or the drawing) put in the sea ──
        let riv = 0, rivRecSea = 0, rivDrawnSea = 0; const A0 = 1e5;
        for (let w = 0; w < n; w++) if (F.riverKm2[w] > A0 && rl[w]) { riv++; if (!rec.land[w]) rivRecSea++; if (cnt[w] && wet[w] > cnt[w] / 2) rivDrawnSea++; }
        console.log(JSON.stringify({
            seed, time,
            seaKm: { records: r2(1000 * rec.seaKm) / 1000, rivers: r2(1000 * slR.seaKm) / 1000 },
            landMkm2: { records: r2(recLand * cellKm2 / 1e6), rivers: r2(rivLand * cellKm2 / 1e6), drawn: r2(drawnLand * tKm2 / 1e6) },
            recVsRivers: { recordsOnly: recOnly, riversOnly: rivOnly, riversOnlyCont: rivOnlyCont, riversOnlyArc: rivOnlyArc, cells: recLand },
            drawnVsRecords: { seaOnRecLandMkm2: r2(drawnSeaRecLand * tKm2 / 1e6), landOnRecSeaMkm2: r2(drawnLandRecSea * tKm2 / 1e6) },
            landCellsDrawnUnderSea: { count: under.length, coastal: under.filter(u => u.seaN > 0).length, dryHollow: under.filter(u => u.dry).length, p50: q(0.5), p10: q(0.1), min: q(0) },
            whyUnder: why,
            whyMedianKm: Object.fromEntries(Object.entries(zOf).map(([k, a]) => [k, a.length ? r2(a.sort((x, y) => x - y)[a.length >> 1]) : null])),
            onshoreLowRifted: riftOn.filter(x => x > 0.5).length,
            cutBelowSea: { bodies: cutBodies, pts: cutPts, onRecSea: cutOnRecSea, onDryHollow: cutOnRecLandHollow, onRecLandOther: cutOnRecLandOther },
            rivers: { cells: riv, overRecSea: rivRecSea, overDrawnSea: rivDrawnSea },
            ms: r(Object.values(T.ms).reduce((a, b) => a + b, 0)),
        }));
    }
}
