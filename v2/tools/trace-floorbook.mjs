// The ocean floor's books over a page history (lane oldfloor, 2026-11-22: phase 1, measure only): which stage of a step makes
// ocean floor and which destroys it, and how old the floor each destroys is. Diagnostics: nothing here changes the history.
//   - NET, per stage (exact): every live raster's ocean cells, in age classes, scanned after each stage of every step — the
//     crust ledger's stage hook (world.ledger.stages is read once per stage by crust-ledger.js book(); a Proxy there sees it).
//     Catches every way floor stops being floor: removed (subducted, consumed), retyped (an arc, a margin isle, a collapse's
//     continent), handed between plates (nets to zero).
//   - GROSS, per stage: CrustRaster.remove / create / copyFrom / restore on ocean cells, by the floor's age.
//   - RESOLVE's consumption by the kind of boundary the consumed world cell was on (the classification from before the
//     resolve: world.boundaryKind is not cleared by it): which contacts eat floor.
//   node v2/tools/trace-floorbook.mjs --seed 716130 [--myr 700] [--cont 41] [--from 200] [--out f.json]
// Prints `FLOORBOOK_JSON {…}`: per stage, km²/yr over t ≥ from.
import fs from 'node:fs';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { CrustType, CrustRaster } from '../js/tectonics/model/crust.js';
import { BoundaryKind } from '../js/tectonics/model/world.js';

setDelaunator(Delaunator);
if (!globalThis.navigator?.gpu) await import('./gpu-harness/use-dawn.mjs').catch(() => null);
const MF = await import('./lib/moment-frame.mjs');
const { simulate } = await import('../js/tectonics/simulate.js');

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const seed = +arg('seed', 716130), MYR = +arg('myr', 700), SIM = +arg('sim', 40000), FROM = +arg('from', 200);
const cont = +arg('cont', MF.DEFAULT_CONT ?? 41), OUT = arg('out', null);
const { scene, world } = MF.pageWorld({ seed, cont, sim: SIM });
const n = world.mesh.numCells, km2 = world.mesh.cellAreaKm2;
const OCEAN = CrustType.OCEAN;
const CLASSES = [30, 100, 180, Infinity], cls = a => a < 30 ? 0 : a < 100 ? 1 : a < 180 ? 2 : 3;
const KIND = Object.fromEntries(Object.entries(BoundaryKind).map(([k, v]) => [v, k]));

// gross flows since the last stage hook
let pend = { rem: [0, 0, 0, 0], add: [0, 0, 0, 0] };
const P = CrustRaster.prototype, orig = { remove: P.remove, create: P.create, copyFrom: P.copyFrom, restore: P.restore };
P.remove = function (cell) { if (this.mask[cell] && this.type[cell] === OCEAN) pend.rem[cls(world.time - this.formedAt[cell])]++; return orig.remove.call(this, cell); };
P.create = function (cell, type, formedAt, terrane) { const r = orig.create.call(this, cell, type, formedAt, terrane); if (type === OCEAN) pend.add[cls(world.time - formedAt)]++; return r; };
P.copyFrom = function (cell, other, from) { const r = orig.copyFrom.call(this, cell, other, from); if (this.type[cell] === OCEAN) pend.add[cls(world.time - this.formedAt[cell])]++; return r; };
P.restore = function (cell, values) { const r = orig.restore.call(this, cell, values); if (this.type[cell] === OCEAN) pend.add[cls(world.time - this.formedAt[cell])]++; return r; };

// net: ocean cells per age class over every live raster (age against a time fixed per step, so ageing inside a step is not a flow)
let stepT = 0;
function oceanTally() {
    const c = [0, 0, 0, 0];
    for (const p of world.plates) {
        if (!p.alive) continue;
        const { mask, type, formedAt } = p.crust;
        for (let i = 0; i < mask.length; i++) if (mask[i] && type[i] === OCEAN) c[cls(stepT - formedAt[i])]++;
    }
    return c;
}
const book = {};               // stage → { net:[4], rem:[4], add:[4], byKind:{} } in cells, summed over t ≥ FROM
let last = null, lastStage = null;
function onStage(stage) {
    if (stage === 'kinematics') { stepT = world.time; last = oceanTally(); pend = { rem: [0, 0, 0, 0], add: [0, 0, 0, 0] }; lastStage = stage; return; }
    if (!last) return;
    const now = oceanTally();
    if (world.time >= FROM) {
        const e = book[stage] ??= { net: [0, 0, 0, 0], rem: [0, 0, 0, 0], add: [0, 0, 0, 0], byKind: {} };
        for (let i = 0; i < 4; i++) { e.net[i] += now[i] - last[i]; e.rem[i] += pend.rem[i]; e.add[i] += pend.add[i]; }
        if (stage === 'resolve') for (let w = 0; w < n; w++) if (world.consumedAt[w]) { const k = KIND[world.boundaryKind[w]] ?? world.boundaryKind[w]; e.byKind[k] = (e.byKind[k] ?? 0) + 1; }
    }
    last = now; pend = { rem: [0, 0, 0, 0], add: [0, 0, 0, 0] }; lastStage = stage;
}
world.config.crustLedger = true;
const stages = new Proxy({}, { get(t, k) { if (typeof k === 'string') onStage(k); return t[k]; } });
world.ledger = { start: null, stages };

const t0 = performance.now();
await simulate(world, {
    untilMyr: MYR, snapshotEveryMyr: 10, keepFrames: false, drive: w => scene.drive(w),
    onFrame: f => { if (Math.round(f.time) % 100 === 0) process.stderr.write(`t ${Math.round(f.time)} (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`); },
});
const yrs = (MYR - FROM) * 1e6, rate = c => +(c * km2 / yrs).toFixed(3);
const out = { seed, cont, sim: SIM, from: FROM, myr: MYR, classes: CLASSES, unit: 'km²/yr', seconds: +((performance.now() - t0) / 1000).toFixed(1), stages: {} };
for (const [s, e] of Object.entries(book)) out.stages[s] = { net: e.net.map(rate), rem: e.rem.map(rate), add: e.add.map(rate), byKind: Object.fromEntries(Object.entries(e.byKind).map(([k, v]) => [k, rate(v)])) };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`FLOORBOOK_JSON ${JSON.stringify(out)}`);
