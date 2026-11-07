// Two histories of one world, frame by frame: where do they part, and what parts first? (pathctl, 2026-11-07)
// A history is chaotic (check-kit.mjs, "checks over a distribution of histories"), so a change that alters any cell's fate
// sends it down another path. To tell an honest different history from a broken one, run the same scene and seed twice —
// once per variant — snapshot on the step grid (config.stepGridMyr: histories do not depend on how often they are
// recorded, simulate.js), and report, per group of fields, the first frame at which the two differ and by how much:
//   mask   the land and the sea as the terrain stands them (terrain/land-mask.js, under each variant's own heights)
//   rivers the drained area (riverKm2)
//   rock   what the rivers and the sea lay down and cut (riverIncKm, basinFillKm, seaFillKm, shelfKm3, riseKm3)
//   crust  the crust itself (type, thickKm, rootKm, upliftKm)
//   owner  which plate holds each cell
//   forces each plate's rotation (omega) — the torque balance's outcome
// and, at the end, every lasting continent–continent contact (≥ 20 Myr, phase 6's test) in each, by its plates' names.
//   node v2/tools/history-diff.mjs --scene breakup|start [--seed 12345] [--until Myr] --a path=0 --b water=0
// Variants (comma-separated): path=k (lib/paths.mjs's nudge, plumeSpacingKm × (1 + k·1e-3)); water=x (heights.waterInventory).
import { labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { RIFT_SCENES } from '../js/tectonics/scenarios/rift-scenes.js';
import { BUDGET_SCENES } from '../js/tectonics/scenarios/budget-scenes.js';
import { updatePlateMotion } from '../js/tectonics/step/torque-balance.js';
import { heightsOf } from '../js/tectonics/step/heights.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { landMask } from '../js/terrain/land-mask.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SCENE = arg('scene', 'breakup'), SEED = Number(arg('seed', 12345)), A = arg('a', 'path=0'), B = arg('b', 'water=0');
const mesh = labMesh(), n = mesh.numCells;
const scenes = {
    breakup: { build: seed => RIFT_SCENES.find(s => s.id === 'breakup').build(mesh, seed), drive: updatePlateMotion, maxMyr: 300, config: { crustLedger: true } },   // (phase 6's run('breakup'))
    start: { build: seed => BUDGET_SCENES.find(s => s.id === 'history').build(mesh, seed), drive: BUDGET_SCENES.find(s => s.id === 'history').drive, maxMyr: 600, config: {} },   // (phase 11's whole histories)
};
const sc = scenes[SCENE], UNTIL = Number(arg('until', sc.maxMyr));

function variantWorld(spec) {
    const world = sc.build(SEED);
    Object.assign(world.config, sc.config);
    for (const part of spec.split(',').filter(Boolean)) {
        const [k, v] = part.split('=');
        if (k === 'path') world.config.plumeSpacingKm *= 1 + Number(v) * 1e-3;
        else if (k === 'water') world.config.heights = terrainConfig({ ...heightsOf(world.config), waterInventory: Number(v) });
        else throw new Error(`unknown variant ${part}`);
    }
    return world;
}

const GROUPS = { rivers: ['riverKm2'], rock: ['riverIncKm', 'basinFillKm', 'seaFillKm', 'shelfKm3', 'riseKm3'], crust: ['type', 'thickKm', 'rootKm', 'upliftKm'], owner: ['owner'] };
function run(spec) {
    const world = variantWorld(spec), H = heightsOf(world.config), out = {}, frames = [];
    simulate(world, { untilMyr: UNTIL, drive: sc.drive, snapshotEveryMyr: world.config.stepGridMyr, keepFrames: false, onFrame: f => {
        const keep = { time: f.time, mask: landMask(f, mesh, H, out).land.slice(), omega: f.plates.map(p => p.alive ? [...p.omega] : null), names: f.plates.map(p => p.name) };
        for (const fields of Object.values(GROUPS)) for (const k of fields) keep[k] = f[k].slice();
        frames.push(keep);
    } });
    const contacts = [...world.collisions.values()].filter(r => r.contactMyr >= 20).map(r => ({ pair: `${world.plates[r.lower].name} into ${world.plates[r.upper].name}`, contactMyr: r.contactMyr,
        sutured: !!r.sutured, closing: r.closingCmYr, mean: r.meanRateCmYr, speeding: !!r.sutured && !(r.closingCmYr < r.meanRateCmYr) }));
    return { frames, contacts, events: world.events.length };
}

const t0 = performance.now(), a = run(A), b = run(B);
const differs = (x, y) => { let c = 0, m = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { c++; m = Math.max(m, Math.abs(x[i] - y[i])); } return { c, m }; };
const first = {};
for (let i = 0; i < Math.min(a.frames.length, b.frames.length); i++) {
    const fa = a.frames[i], fb = b.frames[i];
    const d = { mask: differs(fa.mask, fb.mask) };
    for (const [g, fields] of Object.entries(GROUPS)) d[g] = fields.map(k => ({ k, ...differs(fa[k], fb[k]) })).filter(x => x.c > 0);
    let om = 0; fa.omega.forEach((w, p) => { const v = fb.omega[p]; if (!w !== !v) om = Infinity; else if (w) om = Math.max(om, ...w.map((x, j) => Math.abs(x - v[j]))); });
    d.forces = om;
    if (!first.mask && d.mask.c) first.mask = `${fa.time} Myr: ${d.mask.c} cells`;
    for (const g of Object.keys(GROUPS)) if (!first[g] && d[g].length) first[g] = `${fa.time} Myr: ${d[g].map(x => `${x.k} ${x.c} cells (max |Δ| ${x.m.toPrecision(3)})`).join(', ')}`;
    if (!first.forces && om > 0) first.forces = `${fa.time} Myr: max |Δω| ${om.toPrecision(3)}`;
    const want = (i % 25 === 0) || i === a.frames.length - 1;
    if (want) console.log(`  ${String(fa.time).padStart(4)} Myr  mask ${d.mask.c}  owner ${d.owner[0]?.c ?? 0}  type ${d.crust.find(x => x.k === 'type')?.c ?? 0}  riverKm2 ${d.rivers[0]?.c ?? 0}  max|Δω| ${om.toPrecision(3)}`);
}
console.log(`\n${SCENE} seed ${SEED}, ${UNTIL} Myr: A = ${A} vs B = ${B} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
for (const g of ['mask', 'rivers', 'rock', 'crust', 'owner', 'forces']) console.log(`  first ${g.padEnd(6)} difference: ${first[g] ?? 'none'}`);
console.log(`  events: A ${a.events}, B ${b.events}`);
const fmt = c => `${c.pair} ${c.contactMyr.toFixed(0)} Myr ${c.sutured ? 'welded' : 'open'} ${c.closing.toFixed(2)} vs mean ${c.mean.toFixed(2)}${c.speeding ? ' ⚑ SPEEDING' : ''}`;
console.log(`  lasting contacts A:\n${a.contacts.map(c => `    ${fmt(c)}`).join('\n') || '    none'}`);
console.log(`  lasting contacts B:\n${b.contacts.map(c => `    ${fmt(c)}`).join('\n') || '    none'}`);
const pa = new Set(a.contacts.map(c => c.pair)), pb = new Set(b.contacts.map(c => c.pair));
console.log(`  pairs in both ${[...pa].filter(p => pb.has(p)).length}, only A ${[...pa].filter(p => !pb.has(p)).join(' | ') || '—'}, only B ${[...pb].filter(p => !pa.has(p)).join(' | ') || '—'}`);
