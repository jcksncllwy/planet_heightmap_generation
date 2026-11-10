// The measurement behind the real-climate balance (2026-11-10; basin-estimate.js CLIMATE_MIN_KM2, climate-water.js): every
// 20 Myr of four histories at 160K cells, with the history's poured sea (world-ocean.js), the share of frames with a sea
// cut off from the world ocean of ≥ 1 Mkm² the history holds empty (needsClimate: the frames the page computes a 2°
// climate for), and on each such frame its seas balanced on the zonal climate against the computed one (planetClimate at
// 2°, climateWater): wet or dry, the water held, the ocean's fall, and the climate's time.
// Usage (heavy: sim-slots run -n 2 --gb 6): node v2/tools/climate-balance-study.mjs [every 20] [grid 2] [out.json]
const R = new URL('../../', import.meta.url).pathname;
const D = (await import(R + 'node_modules/delaunator/index.js')).default; (await import(R + 'js/sphere-mesh.js')).setDelaunator(D);
const { buildSimMesh } = await import(R + 'v2/js/core/sim-mesh.js');
const { terrainMesh, sampleOnto } = await import(R + 'v2/js/terrain/terrain-mesh.js');
const { terrainConfig, TERRAIN } = await import(R + 'v2/js/terrain/terrain-config.js');
const { synthesizeTerrain } = await import(R + 'v2/js/terrain/synthesize.js');
const { worldOcean } = await import(R + 'v2/js/terrain/world-ocean.js');
const { pouredSeaOnto } = await import(R + 'v2/js/terrain/land-mask.js');
const { estimateCutOff, needsClimate, CLIMATE_MIN_KM2 } = await import(R + 'v2/js/terrain/basin-estimate.js');
const { climateWater } = await import(R + 'v2/js/terrain/climate-water.js');
const { planetClimate } = await import(R + 'v2/js/climate/climate.js');
const { simulateCached } = await import(R + 'v2/tools/lib/history-cache.mjs');
const { pageWorld } = await import(R + 'v2/tools/lib/moment-frame.mjs');
const { FRAME_FIELDS } = await import(R + 'v2/js/terrain/terrain-pool.js');
const EVERY = Number(process.argv[2] || 20), GRID = Number(process.argv[3] || 2);
const runs = [[831576, 41, { waterInventory: 1 }], [626225, 30, {}], [777, 30, {}], [12345, 30, {}]];
const sim = buildSimMesh(40000, 12345), tm = terrainMesh(160000), n = tm.numCells, a = 4 * Math.PI * 6371 ** 2 / n;
const rows = [], seasOf = W => W.seas.filter(s => !s.history && s.km2 >= CLIMATE_MIN_KM2).map(s => ({ Mkm2: +(s.km2 / 1e6).toFixed(2), floorKm: +s.floorKm.toFixed(2), sillKm: +s.sillKm.toFixed(3), levelKm: +s.levelKm.toFixed(3), state: s.full ? 'full' : s.wet ? 'wet' : 'dry', heldKm3: Math.round(s.heldKm3) }));
for (const [seed, cont, heights] of runs) {
    const cfg = terrainConfig(heights), { world, scene } = pageWorld({ seed, cont, sim: 40000, heights }), frames = [];
    simulateCached(world, { untilMyr: 1200, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => { if (Math.round(f.time) % EVERY) return; const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]])); fr.plates = f.plates.map(p => p && { quat: p.quat }); fr.time = f.time; frames.push(fr); } },
        { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim: 40000, by: 'climate-balance-study' } });
    const sampler = sampleOnto(sim, tm, cfg, seed);
    let k = 0;
    for (const f of frames) {
        const h = synthesizeTerrain(f, sim, tm, { cfg, seed, sampler, carve: true }).heightKm, hist = pouredSeaOnto(f, sim, cfg, sampler);
        const fresh = () => worldOcean(tm, h, 0, hist), wo = fresh(), row = { seed, t: Math.round(f.time), wants: needsClimate(wo, n) };
        // (a body ≥ 1 Mkm² the history pours into: stood, never balanced — counted apart)
        row.pouredBig = wo.bodies.slice(1).filter(b => b.pouredKm3 > 0 && b.cells * a >= CLIMATE_MIN_KM2).length;
        if (row.wants) {
            k++;
            const Z = estimateCutOff(tm, h, wo, TERRAIN, 0);
            const t0 = performance.now(), res = planetClimate({ xyz: tm.xyz, elevKm: h, axes: 'z-up' }, { gridStepDeg: GRID }), w = climateWater(res, h), ms = performance.now() - t0;
            const C = estimateCutOff(tm, h, fresh(), TERRAIN, 0, undefined, w);
            Object.assign(row, { climateMs: Math.round(ms), zonal: { seas: seasOf(Z), heldKm3: Math.round(Z.heldKm3), fallM: +(1000 * Z.oceanFallKm).toFixed(2) }, computed: { seas: seasOf(C), heldKm3: Math.round(C.heldKm3), fallM: +(1000 * C.oceanFallKm).toFixed(2), source: C.climate, deg: C.climateDeg } });
            console.log(seed, row.t, `${(ms / 1000).toFixed(2)} s`, 'zonal', JSON.stringify(row.zonal.seas.map(s => `${s.Mkm2}:${s.state}:${s.heldKm3}`)), '→ computed', JSON.stringify(row.computed.seas.map(s => `${s.Mkm2}:${s.state}:${s.heldKm3}`)), `held ${row.zonal.heldKm3} → ${row.computed.heldKm3} km³`);
        }
        rows.push(row);
    }
    console.error('seed', seed, 'frames', frames.length, 'wanting the climate', k);
}
if (process.argv[4]) (await import('fs')).writeFileSync(process.argv[4], JSON.stringify(rows));
const want = rows.filter(r => r.wants), ms = want.map(r => r.climateMs).sort((x, y) => x - y);
console.log(`frames wanting the climate: ${want.length} of ${rows.length} (${(100 * want.length / rows.length).toFixed(1)} %); frames with a poured body ≥ 1 Mkm² (never balanced): ${rows.filter(r => r.pouredBig).length}`);
if (ms.length) console.log(`climate (${GRID}°, Node): median ${ms[ms.length >> 1]} ms, max ${ms[ms.length - 1]} ms; per frame on average ${(want.reduce((s, r) => s + r.climateMs, 0) / rows.length).toFixed(0)} ms`);
let flips = 0, seas = 0;
for (const r of want) for (const s of r.computed.seas) { seas++; const z = r.zonal.seas.find(q => Math.abs(q.Mkm2 - s.Mkm2) < 0.02 && q.floorKm === s.floorKm); if (z && (z.state === 'dry') !== (s.state === 'dry')) flips++; }
console.log(`seas ≥ 1 Mkm² balanced: ${seas}; wet/dry changed by the computed climate: ${flips}`);
