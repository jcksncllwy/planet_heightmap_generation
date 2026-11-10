// The measurement behind world-ocean.js FILLED (2026-11-10): for every body below sea level ≥ 0.5 Mkm² at 160K cells, every 20 Myr of four
// histories, the history's water poured onto its cells over the view's room below sea level — the view's surface against the history's ground.
// Usage (heavy: sim-slots run -n 2 --gb 4): node v2/tools/filled-study.mjs [cells 160000] [every 20] [out.json]
const R = new URL('../../', import.meta.url).pathname;
const D = (await import(R+'node_modules/delaunator/index.js')).default; (await import(R+'js/sphere-mesh.js')).setDelaunator(D);
const { buildSimMesh } = await import(R+'v2/js/core/sim-mesh.js');
const { terrainMesh, sampleOnto } = await import(R+'v2/js/terrain/terrain-mesh.js');
const { terrainConfig } = await import(R+'v2/js/terrain/terrain-config.js');
const { synthesizeTerrain } = await import(R+'v2/js/terrain/synthesize.js');
const { worldOcean } = await import(R+'v2/js/terrain/world-ocean.js');
const { landMask } = await import(R+'v2/js/terrain/land-mask.js');
const { simulateCached } = await import(R+'v2/tools/lib/history-cache.mjs');
const { pageWorld } = await import(R+'v2/tools/lib/moment-frame.mjs');
const { FRAME_FIELDS } = await import(R+'v2/js/terrain/terrain-pool.js');
const CELLS = Number(process.argv[2] || 160000), EVERY = Number(process.argv[3] || 20);
const runs = [[831576, 41, { waterInventory: 1 }], [626225, 30, {}], [777, 30, {}], [12345, 30, {}]];
const sim = buildSimMesh(40000, 12345), tm = terrainMesh(CELLS), a = 4*Math.PI*6371**2/tm.numCells;
const rows = [];
for (const [seed, cont, heights] of runs) {
  const cfg = terrainConfig(heights), { world, scene } = pageWorld({ seed, cont, sim: 40000, heights }), frames = [];
  simulateCached(world, { untilMyr: 1200, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => { if (Math.round(f.time) % EVERY) return; const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]])); fr.plates = f.plates.map(p => p && { quat: p.quat }); fr.time = f.time; frames.push(fr); } },
    { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim: 40000, by: 'dryocean-ratio' } });
  const sampler = sampleOnto(sim, tm, cfg, seed);
  const hv = new Int32Array(tm.numCells); for (let c=0;c<tm.numCells;c++){let k=3*c; if(sampler.weights[k+1]>sampler.weights[k])k++; if(sampler.weights[3*c+2]>sampler.weights[k])k=3*c+2; hv[c]=sampler.cells[k];}
  for (const f of frames) {
    const h = synthesizeTerrain(f, sim, tm, { cfg, seed, sampler, carve: true }).heightKm, out = {}, m = landMask(f, sim, cfg, out), g = out.groundKm, L = m.sl.seaKm, sea = out.pour.sea;
    const G = worldOcean(tm, h, 0), comp = new Int32Array(tm.numCells).fill(-1);
    G.bodies.forEach((b,i)=>{ if (b.cells*a < 5e5) return; const q=[b.first]; comp[b.first]=i; for(let k=0;k<q.length;k++){const c=q[k]; for(let j=tm.adjOffset[c];j<tm.adjOffset[c+1];j++){const nb=tm.adjList[j]; if(comp[nb]<0&&h[nb]<0){comp[nb]=i;q.push(nb);}}}});
    const room = new Float64Array(G.bodies.length), hist = new Float64Array(G.bodies.length), over = new Int32Array(G.bodies.length);
    for (let c=0;c<tm.numCells;c++){ const i=comp[c]; if(i<0) continue; room[i]+=-h[c]*a; const w=hv[c]; if(sea[w]){over[i]++; hist[i]+=Math.max(0,L-g[w])*a;} }
    G.bodies.forEach((b,i)=>{ if (b.cells*a < 5e5) return; rows.push({ seed, t: Math.round(f.time), ocean: i===0, km2: b.cells*a, cover: over[i]/b.cells, ratio: hist[i]/room[i], room: room[i] }); });
  }
  console.error('seed', seed, 'done', frames.length);
}
if (process.argv[4]) (await import('fs')).writeFileSync(process.argv[4], JSON.stringify(rows));
const q = (xs, p) => { const s = xs.slice().sort((x,y)=>x-y); return s[Math.floor(p*(s.length-1))]; };
const oc = rows.filter(r => r.ocean).map(r => r.ratio), full = rows.filter(r => !r.ocean && r.cover >= 0.99).map(r => r.ratio), part = rows.filter(r => !r.ocean && r.cover < 0.99 && r.cover > 0.01);
console.log('world ocean ratio (n', oc.length, '): min', q(oc,0).toFixed(3), 'p5', q(oc,.05).toFixed(3), 'median', q(oc,.5).toFixed(3), 'p95', q(oc,.95).toFixed(3), 'max', q(oc,1).toFixed(3));
if (full.length) console.log('cut bodies fully under history sea (n', full.length, '): min', q(full,0).toFixed(3), 'p5', q(full,.05).toFixed(3), 'median', q(full,.5).toFixed(3), 'max', q(full,1).toFixed(3));
console.log('partly poured cut bodies:', part.map(r => `${r.seed}@${r.t} ${(r.km2/1e6).toFixed(1)}Mkm² cover ${(100*r.cover).toFixed(0)}% ratio ${r.ratio.toFixed(3)}`).join(' | '));
