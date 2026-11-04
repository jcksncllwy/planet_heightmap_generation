// The continental crust's budget over the supercontinent cycle (lane crust, stage 0: diagnosis, report only). One seed of
// the lab's 1200 Myr cycle scene with the crust ledger on, and per frame: the continental crust's AREA and its VOLUME
// (area × tectonics/measure.js crustThicknessKm — does the crust go, or only fold up?), its thickness spread, the share
// of it carrying each kind of record by the record's age since last active, and at a few moments its hypsometry on the
// synthesized surface (how much of it stands below the sea, and where). Collisions' own loss is split into underthrusting
// (world.budget.underthrustCells), the welds' absorbed overlap (SUTURE events' landLostCells) and seas sealed (net of the
// coast paid), the rest left as "other".
// Usage: node v2/tools/trace-crust.mjs --seed 12345 [--myr 1200] [--cells 40000] [--set key=value …] [--hyps 300,600,900,1200]
// Prints a human summary and one line `CRUST_JSON {…}`.

import { labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { CrustType, OrogenyType } from '../js/tectonics/model/crust.js';
import { crustThicknessKm } from '../js/tectonics/measure.js';
import { synthesizeTerrain } from '../js/terrain/synthesize.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { TERRAIN } from '../js/terrain/terrain-config.js';
import { marginConstants } from '../js/terrain/margins.js';
import { CoastKind } from '../js/terrain/records.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const seed = +arg('seed', 12345), MYR = +arg('myr', 1200), CELLS = +arg('cells', 40000);
const HYPS = String(arg('hyps', '300,600,900,1200')).split(',').map(Number);
const sets = process.argv.flatMap((a, i) => a === '--set' ? [process.argv[i + 1]] : []);
const mesh = labMesh(CELLS), n = mesh.numCells, km2 = mesh.cellAreaKm2;
const scene = TERRAIN_SCENES.find(s => s.id === 'cycle');
const world = scene.build(mesh, seed);
world.config.crustLedger = true;
if (!process.argv.includes('--novol')) world.config.crustLedgerVolume = true;
for (const s of sets) {
    const [k, v] = s.split('=');
    if (!(k in world.config)) throw new Error(`unknown config key ${k}`);
    world.config[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v;
}
const tm = HYPS.length ? terrainMesh(160000) : null;
const TYPES = Object.entries(OrogenyType).filter(([, v]) => v > 0);
const AGE_BINS = [50, 100, 150, 240, Infinity];           // record age since last active (Myr): <50, 50–100, 100–150, 150–240, ≥240
const H_EDGES = [-4, -2, -1, -0.5, -0.2, 0, 0.2, 0.4, 1, 2, Infinity];   // km, on the synthesized surface

const frames = [], ledgerAt = [], hyps = [];
const t0 = performance.now();
simulate(world, {
    untilMyr: MYR, snapshotEveryMyr: 10, keepFrames: false,
    drive: w => {
        scene.drive(w);
        const t = Math.round(w.time);
        if (t % 100 === 0 && !ledgerAt.some(x => x.time === t)) ledgerAt.push({ time: t, stages: Object.fromEntries(Object.entries(w.ledger?.stages ?? {}).map(([k, e]) => [k, e.land])), budget: { ...w.budget } });
    },
    onFrame: f => {
        let area = 0, vol = 0, thick = { t35: 0, t45: 0, t55: 0, t65: 0 }, craton = 0, thickKmSum = 0, rootPos = 0;
        const rec = Object.fromEntries(TYPES.map(([k]) => [k, AGE_BINS.map(() => 0)])), cont = new Uint8Array(n);
        for (let w = 0; w < n; w++) {
            if (f.owner[w] < 0) continue;
            const ty = f.type[w];
            if (ty !== CrustType.CONTINENT && ty !== CrustType.CRATON) continue;
            cont[w] = 1; area++;
            if (ty === CrustType.CRATON) craton++;
            const k = crustThicknessKm(TERRAIN, ty, f.rootKm[w], f.upliftKm[w], f.baseKm[w]);
            vol += k; thickKmSum += f.thickKm?.[w] ?? 0; if (f.rootKm[w] > 0) rootPos++;
            if (k > 35) thick.t35++; if (k > 45) thick.t45++; if (k > 55) thick.t55++; if (k > 65) thick.t65++;
            const o = f.oroType[w];
            if (o) { const age = f.time - f.oroLast[w], b = AGE_BINS.findIndex(e => age < e); rec[TYPES.find(([, v]) => v === o)[0]][b]++; }
        }
        const fr = { time: f.time, areaMkm2: area * km2 / 1e6, volGkm3: vol * km2 / 1e9, meanKm: vol / Math.max(1, area), craton: craton / Math.max(1, area),
            thick: Object.fromEntries(Object.entries(thick).map(([k, v]) => [k, v / Math.max(1, area)])), thickKmMean: thickKmSum / Math.max(1, area), rootPos: rootPos / Math.max(1, area),
            rec: Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.map(x => x / Math.max(1, area))])) };
        frames.push(fr);
        if (tm && HYPS.some(h => Math.abs(h - f.time) < 1e-6)) {
            const T = synthesizeTerrain(f, mesh, tm, { seed });
            const bins = H_EDGES.map(() => 0); let nc = 0, nLand = 0, nAll = tm.numCells, sumUp = 0, belowShelf = 0;
            for (let t = 0; t < tm.numCells; t++) {
                const h = T.heightKm[t]; if (h > 0) nLand++;
                if (!cont[T.sampler.cells[3 * t]]) continue;
                nc++; bins[H_EDGES.findIndex(e => h < e)]++;
                if (h > 0) sumUp += h;
            }
            // (the rifted margins' thinned crust beyond the history's crust edge, out to the true COB under the sea: the
            // terrain draws it (synthesize.js, margins.js uEdge) though the history counts it as ocean — Earth's continental
            // area counts it: Cogley 1984 takes the crust to the foot of the slope)
            const MC = marginConstants(TERRAIN), R = T.rec, S = T.sampler;
            let band = 0;
            for (let t = 0; t < tm.numCells; t++) {
                const a = S.cells[3 * t], b = S.cells[3 * t + 1], c = S.cells[3 * t + 2], wa = S.weights[3 * t], wb = S.weights[3 * t + 1], wc = S.weights[3 * t + 2];
                if (cont[a] || T.heightKm[t] > 0 || R.coastKind[a] !== CoastKind.PASSIVE) continue;
                const coast = wa * R.coastKm[a] + wb * R.coastKm[b] + wc * R.coastKm[c], thin = wa * R.thinKm[a] + wb * R.thinKm[b] + wc * R.thinKm[c];
                if (coast < 0 && coast > -MC.uEdge * thin) band += wa * R.riftShare[a] + wb * R.riftShare[b] + wc * R.riftShare[c];
            }
            hyps.push({ time: f.time, contShare: nc / nAll, landShare: nLand / nAll, contBelowSea: bins.slice(0, 6).reduce((a, b) => a + b, 0) / Math.max(1, nc),
                bins: bins.map(b => b / Math.max(1, nc)), seaKm: T.rec.seaKm, marginBand: band / nAll });
        }
    },
});
const secs = (performance.now() - t0) / 1000;
const ev = world.events, sutures = ev.filter(e => e.kind === EventKind.SUTURE);
const sutureLost = sutures.reduce((s, e) => s + (e.data?.landLostCells ?? 0), 0);
const Mk = c => c * km2 / 1e6;
const L = world.ledger.stages, B = world.budget;
const collOther = (L.collisions?.land ?? 0) + (B.underthrustCells ?? 0) - (B.sealedLandCells ?? 0) + (B.sealPaidCells ?? 0) + sutureLost;
const out = { seed, myr: MYR, cells: CELLS, sets, secs, cellKm2: km2,
    ledger: Object.fromEntries(Object.entries(L).map(([k, e]) => [k, { landMkm2: Mk(e.land), arcMkm2: Mk(e.arc), volGkm3: (e.vol ?? 0) * km2 / 1e9 }])),
    collisions: { underthrust: -Mk(B.underthrustCells ?? 0), sutureOverlap: -Mk(sutureLost), sealedLand: Mk(B.sealedLandCells ?? 0), sealPaid: -Mk(B.sealPaidCells ?? 0), other: Mk(collOther), sutures: sutures.length },
    budget: Object.fromEntries(Object.entries(B).filter(([k]) => /Cells$/.test(k)).map(([k, v]) => [k, Mk(v)])),
    sedGkm3: Object.fromEntries(Object.entries(B).filter(([k]) => /Km3$/.test(k)).map(([k, v]) => [k, v / 1e9])),   // the sediment books (km³ → Gkm³): where the worn rock went
    volBudget: Object.fromEntries(Object.entries(B).filter(([k]) => /^collision\w+Km$/.test(k)).map(([k, v]) => [k, v * km2 / 1e9])),   // Gkm³
    ledgerAt: ledgerAt.map(x => ({ time: x.time, stages: Object.fromEntries(Object.entries(x.stages).filter(([, v]) => v).map(([k, v]) => [k, Mk(v)])), underthrust: Mk(x.budget.underthrustCells ?? 0) })),
    frames, hyps };
const f0 = frames[0], fE = frames.at(-1);
console.log(`seed ${seed}, ${MYR} Myr, ${CELLS} cells, ${secs.toFixed(0)} s${sets.length ? `, set ${sets.join(' ')}` : ''}`);
console.log(`area ${f0.areaMkm2.toFixed(1)} → ${fE.areaMkm2.toFixed(1)} Mkm² (×${(fE.areaMkm2 / f0.areaMkm2).toFixed(3)}); volume ${f0.volGkm3.toFixed(2)} → ${fE.volGkm3.toFixed(2)} Gkm³ (×${(fE.volGkm3 / f0.volGkm3).toFixed(3)}); mean thickness ${f0.meanKm.toFixed(1)} → ${fE.meanKm.toFixed(1)} km`);
console.log('ledger (Mkm²):', Object.entries(out.ledger).filter(([, e]) => e.landMkm2).map(([k, e]) => `${k} ${e.landMkm2.toFixed(1)}`).join(', '));
console.log('ledger volume (Gkm³):', Object.entries(out.ledger).filter(([, e]) => Math.abs(e.volGkm3) > 1e-4).map(([k, e]) => `${k} ${e.volGkm3.toFixed(3)}`).join(', '));
console.log('collisions split (Mkm²):', Object.entries(out.collisions).map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(1) : v}`).join(', '));
if (Object.keys(out.volBudget).length) console.log('collision volume (Gkm³):', Object.entries(out.volBudget).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', '));
console.log('CRUST_JSON ' + JSON.stringify(out));
