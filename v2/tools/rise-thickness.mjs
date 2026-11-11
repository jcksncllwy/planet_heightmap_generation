// How thick the rivers' rise rock stands on the open floor (lane riserock): crust.riseKm3 (step/trench-fans.js layRise)
// over each ocean cell's area, km of rock per cell, read from the history's frames at a few moments. Per moment:
// - the open floor's distribution (ocean crust, no enclosed sea's fill): p50/p90/p99/max of the cells holding any;
// - the passive margins' mean: ocean cells within --margin km (default 400) of continental crust ON THE SAME PLATE (a
//   margin that rides with its continent, no trench between) — Earth's passive-margin sediment ~2–4 km (GlobSed,
//   Straume et al. 2019), the continental rise 5–15 km at its thickest (Emery 1980; Poag 1985 for the US East Coast);
// - where the thickest cell sits: its distance from that continent, its floor's age and depth;
// - by floor age: mean and max over margin cells, so a pile that grows with age shows.
// Usage: node v2/tools/rise-thickness.mjs [--seeds 831576,626225,12345] [--at 430,800,1200] [--sim 40000] [--cont 29]
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { simulateCached } from './lib/history-cache.mjs';
import { pageWorld, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { CrustType } from '../js/tectonics/model/crust.js';
import { seaDepthKm } from '../js/tectonics/measure.js';

setDelaunator(Delaunator);
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seeds = flag('--seeds', '831576,626225,12345').split(',').map(Number), at = flag('--at', '430,800,1200').split(',').map(Number);
const sim = Number(flag('--sim', 40000)), cont = Number(flag('--cont', DEFAULT_CONT)), marginKm = Number(flag('--margin', 400));
const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0, f1 = x => x.toFixed(1);
for (const seed of seeds) {
    const { scene, world } = pageWorld({ seed, cont, sim }), mesh = world.mesh, n = mesh.numCells, A = 4 * Math.PI * 6371 * 6371 / n;
    const { adjOffset, adjList } = mesh, edgeKm = mesh.edgeKm, maxHops = Math.round(marginKm / edgeKm), out = [];
    const want = new Set(at.map(t => Math.round(t)));
    simulateCached(world, { untilMyr: Math.max(...at), drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => {
        const t = Math.round(f.time);
        if (!want.has(t)) return;
        const ocean = w => f.owner[w] >= 0 && f.type[w] === CrustType.OCEAN && !(f.seaFillKm[w] > 0);
        // hops from continental crust over its own plate's ocean floor
        const dist = new Int32Array(n).fill(-1), queue = [];
        for (let w = 0; w < n; w++) if (f.owner[w] >= 0 && f.type[w] !== CrustType.OCEAN && f.type[w] !== CrustType.ARC) { dist[w] = 0; queue.push(w); }
        for (let i = 0; i < queue.length; i++) {
            const w = queue[i]; if (dist[w] >= maxHops) continue;
            for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) { const nb = adjList[k]; if (dist[nb] < 0 && ocean(nb) && f.owner[nb] === f.owner[w]) { dist[nb] = dist[w] + 1; queue.push(nb); } }
        }
        const th = [], margin = [], bins = [0, 50, 100, 150, 200, Infinity].slice(1).map(() => ({ n: 0, s: 0, mx: 0 }));
        let vol = 0, best = -1, bestT = 0;
        for (let w = 0; w < n; w++) {
            if (!ocean(w)) continue;
            const r = f.riseKm3[w] / A; vol += f.riseKm3[w];
            if (r > 0) th.push(r);
            if (r > bestT) { bestT = r; best = w; }
            if (dist[w] > 0) {
                margin.push(r);
                const age = t - f.formedAt[w], b = bins[Math.min(4, Math.floor(age / 50))];
                b.n++; b.s += r; b.mx = Math.max(b.mx, r);
            }
        }
        th.sort((a, b) => a - b);
        const mMean = margin.reduce((a, b) => a + b, 0) / Math.max(1, margin.length), age = best >= 0 ? t - f.formedAt[best] : 0;
        out.push(`t ${t}: open floor ${(vol / 1e6).toFixed(1)}e6 km³ on ${th.length} cells; km p50 ${f1(q(th, .5))} p90 ${f1(q(th, .9))} p99 ${f1(q(th, .99))} max ${f1(bestT)}; >15 km: ${th.filter(x => x > 15).length} cells`
            + `\n    passive margin (≤${marginKm} km, ${margin.length} cells): mean ${f1(mMean)} km`
            + `\n    thickest: ${best >= 0 ? (dist[best] >= 0 ? `${Math.round(dist[best] * edgeKm)} km from its continent` : 'not on a same-plate margin') : '-'}, floor ${Math.round(age)} Myr (${f1(seaDepthKm(age))} km deep)`
            + `\n    by floor age 0/50/100/150/200+: ${bins.map(b => b.n ? `${f1(b.s / b.n)}/${f1(b.mx)} (${b.n})` : '-').join('  ')}`);
    } }, { drive: scene.drive, spec: { scene: 'cycle', seed, cont, sim, by: 'rise-thickness' } });
    console.log(`seed ${seed}  (edge ${f1(edgeKm)} km)\n  ${out.join('\n  ')}`);
}
