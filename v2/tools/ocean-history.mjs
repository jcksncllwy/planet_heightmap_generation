// The water inventory over whole histories (lane sliders step 2): histories run with `waterInventory` (× Earth's ocean,
// terrain/land-mask.js), and at every 10 Myr frame the one land mask's answer — the sea's level, the land's share, the
// continental crust under the sea — beside Earth's ranges for the cycle's stage (tools/lib/cycle-stage.mjs). Outcomes,
// reported; nothing here is tuned to them (Jackson via gulltoppr, 2026-11-06: the model must give Earth's values given
// Earth's conditions — tools/check-ocean-earth.mjs — and seeds report theirs). Earth's sea over the Phanerozoic: from
// ~today's level (Pangaea) to +150…+250 m (the Late Cretaceous, the Ordovician), a cycle's swing of ~0.2–0.3 km (Haq &
// Al-Qahtani 2005; Haq & Schutter 2008; Müller et al. 2008).
// Usage: node v2/tools/ocean-history.mjs [--seeds 626225,777,12345] [--until 1200] [--sim 40000] [--cont 29]
//        [--water 0,1] [--json out.json]        (water 0: the reckoned level, for the base — asked for explicitly: the pour is on by default)
import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { simulateCached } from './lib/history-cache.mjs';
import { pageWorld, MESH_SEED } from './lib/moment-frame.mjs';
import { FRAME_FIELDS } from '../js/terrain/terrain-pool.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { landMask } from '../js/terrain/land-mask.js';
import { stageOf, EARTH_LAND, EARTH_SUBMERGED, STAGES } from './lib/cycle-stage.mjs';

setDelaunator(Delaunator);
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seeds = flag('--seeds', '626225,777,12345').split(',').map(Number), until = Number(flag('--until', 1200));
const sim = Number(flag('--sim', 40000)), cont = Number(flag('--cont', 29)), jsonOut = flag('--json', null);
const waters = flag('--water', '0,1').split(',').map(Number);
const out = [], pct = x => (100 * x).toFixed(1), mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

for (const water of waters) for (const seed of seeds) {
    const heights = { waterInventory: water }, H = terrainConfig(heights);
    const { scene, world } = pageWorld({ seed, cont, sim, heights }), simMesh = buildSimMesh(sim, MESH_SEED), n = simMesh.numCells;
    const rows = [], mask = {}, t0 = performance.now();
    let maskMs = 0;
    simulateCached(world, { untilMyr: until, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
        const fr = Object.fromEntries(FRAME_FIELDS.map(k => [k, f[k]])), m0 = performance.now();
        const { land, sl } = landMask(fr, simMesh, H, mask);
        maskMs += performance.now() - m0;
        let landN = 0, contN = 0, contSea = 0;
        for (let w = 0; w < n; w++) {
            landN += land[w];
            if (fr.owner[w] >= 0 && (fr.type[w] === CrustType.CONTINENT || fr.type[w] === CrustType.CRATON)) { contN++; if (!land[w]) contSea++; }
        }
        rows.push({ water, seed, t: Math.round(f.time), stage: stageOf(f), seaKm: sl.seaKm, land: landN / n, crust: contN / n, submerged: contSea / Math.max(1, contN) });
    } }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim, meshSeed: MESH_SEED, heights, by: 'ocean-history' } });
    const wall = (performance.now() - t0) / 1000;
    out.push(...rows);
    const late = rows.filter(r => r.t >= 100), L = late.map(r => r.seaKm * 1000), mn = a => Math.min(...a), mx = a => Math.max(...a);
    console.log(`water ${water || 'off (reckoned)'} · seed ${seed} · cont ${cont} (${rows.length} frames, ${wall.toFixed(0)} s, mask ${(maskMs / rows.length).toFixed(1)} ms/frame)`);
    console.log(`   level ${mn(L).toFixed(0)}…${mx(L).toFixed(0)} m (swing ${(mx(L) - mn(L)).toFixed(0)} m; Earth ~200–300) · land ${pct(mn(late.map(r => r.land)))}…${pct(mx(late.map(r => r.land)))} % · crust ${pct(late[0].crust)} → ${pct(late.at(-1).crust)} %`);
    for (const s of STAGES) {
        const a = late.filter(r => r.stage === s);
        if (!a.length) { console.log(`   ${s}: no frames`); continue; }
        const lv = mean(a.map(r => r.seaKm * 1000)), ld = 100 * mean(a.map(r => r.land)), sb = 100 * mean(a.map(r => r.submerged));
        const flagOut = (v, e) => v < e[0] || v > e[1] ? ' ⚑' : '';
        console.log(`   ${s} (${a.length}): level ${lv.toFixed(0)} m · land ${ld.toFixed(1)} % (Earth ${EARTH_LAND[s].earth.join('–')})${flagOut(ld, EARTH_LAND[s].earth)} · continental crust under the sea ${sb.toFixed(1)} % (Earth ${EARTH_SUBMERGED[s].earth.join('–')})${flagOut(sb, EARTH_SUBMERGED[s].earth)}`);
    }
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out));
