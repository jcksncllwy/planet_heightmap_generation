// riftprobe2 study (L1 of the rift program, the go/no-go): the driving force against the resisting force along every candidate
// rift band, per stress solve, at the declared and at sourced strengths, with and without the weakening a strength law would add.
// The 'cycle' scene (as riftyield.mjs), run with the rules as they are; read-only: nothing the history reads is changed (every
// extra stress solve puts world.plateStress back as it found it, so the history's own solves warm-start as they would have).
//
// A candidate band, per plate with continent, per solve: from each of up to JUNCTIONS junctions (land, not craton, ≥ riftMinArmKm
// from the plate's land edge, highest s1 ÷ strength first, ≥ riftMinArmKm apart: field/rift-stress.js stressJunctions, on world
// cells) the cheapest paths over the plate's land at cost strength ÷ normal tension per km (field/rift-stress.js stressPaths'
// cost, floor riftStressFloor), to the two land-edge cells (coast OR another plate: L3's cut ends at any plate edge) with the
// least summed cost whose chord is ≥ riftMinChordKm. Along that cut:
//     F_drive = Σ σn · km    (σn: the stress normal to the cut, s1 (n·d1)² + s2 (1 − (n·d1)²), signed: compression counts against)
//     F_R     = Σ T_y · km   (T_y: the variant's strength, below)
// and the band's ratio F_drive ÷ F_R (≥ 1: the plate's own stress beats the whole band's strength, the cut can stretch).
// Each strength variant searches its own paths (a weaker zone draws the cut to it).
//
// The strength variants (offline formulas; the model's own is 'decl' on the 3e12 history and 'cold+d' on the 1e13 one):
//   T_y = Y × craton (cratonStrength) × inherited (riftWeaknessCost on SUTURE/FAILED_RIFT/RIFT_MARGIN; with dmg)
//         × damage (1 − (1 − plateDamageKeep) D; with dmg) × heat W^(−h) × magma 1/m (within a plume head, below)
//   h: world.mantleHeat (0…1, insulation under a continent over mantleInsulateMyr) — W the strength lost under fully insulated
//      mantle; W 3–10 from creep's Arrhenius law for a ~100 K warmer mantle (see l1-report.md §2)
//   magma: within the head's LIP radius (h.lip.radiusKm, else 1000 km) for HEAD_MYR after the head arrives, ÷ m (Buck 2004/2006)
// Splits: at each step where rifting tries a cut (the history's own search request, before the split), the stress is solved on
// the world as it stands; after the step's torque balance it is solved again: per plate group (the parent's pieces, its
// neighbours, the rest) the best band ratio and the land yielding, before and after. Steps whose tries all fail are the control.
// 'law' (lane riftstrength): the bands at the model's own strengthOf, whatever it is — L2's acceptance.
// Usage: node v2/tools/riftforce.mjs [simCells=20000] [seed …] [--len 1200] [--set key=value,…] [--only v1,v2] [--label name] [--out file.jsonl]

import { writeFileSync, appendFileSync } from 'node:fs';
import { labMesh } from './lib/check-kit.mjs';
import { simulateAsync } from '../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { CrustType, CrustFlag } from '../js/tectonics/model/crust.js';
import { stressAt, solvePlateStress } from '../js/tectonics/field/plate-stress-field.js';
import { strengthOf } from '../js/tectonics/field/stress-step.js';
import { searchJunctions } from '../js/tectonics/step/rifting.js';
import { MinHeap } from '../js/core/min-heap.js';

const args = process.argv.slice(2), flag = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const only = flag('--only'), len = Number(flag('--len') ?? 1200), set = flag('--set'), label = flag('--label') ?? (set || 'base'), out = flag('--out');
const overrides = set ? Object.fromEntries(set.split(',').map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; })) : {};
const nums = args.filter(a => !a.startsWith('--')).map(Number);
const cells = nums[0] || 20000, seeds = nums.length > 1 ? nums.slice(1) : [12345, 777, 4242];
const mesh = labMesh(cells), scene = TERRAIN_SCENES.find(s => s.id === 'cycle');
const R = 6371, JUNCTIONS = 6, HEAD_MYR = 20, OFF = !!process.env.RIFTFORCE_OFF || args.includes("--off");    // --off: the history alone (the read-only control)
const emit = o => { const s = JSON.stringify(o); if (out) appendFileSync(out, s + '\n'); else console.log(s); };
if (out) writeFileSync(out, '');

const V = (name, Y, dmg, W, m) => ({ name, Y, dmg, W, m });
const VARIANTS = [
    V('decl', 3e12, 1, 1, 1), V('decl-nd', 3e12, 0, 1, 1), V('decl+hm', 3e12, 1, 3, 6),
    V('cold', 1e13, 0, 1, 1), V('cold+d', 1e13, 1, 1, 1), V('cold+h3', 1e13, 0, 3, 1), V('cold+h10', 1e13, 0, 10, 1),
    V('cold+m', 1e13, 0, 1, 6), V('cold+dhm3', 1e13, 1, 3, 6), V('cold+dhm10', 1e13, 1, 10, 6),
    V('hb', 2e13, 0, 1, 1), V('hb+dhm10', 2e13, 1, 10, 6),
];
if (only) { const keep = new Set(only.split(',')); for (let i = VARIANTS.length - 1; i >= 0; i--) if (!keep.has(VARIANTS[i].name)) VARIANTS.splice(i, 1); }   // (--only a,b: just these offline variants; 'law', the model's own strengthOf, always)
const WEAK = CrustFlag.SUTURE | CrustFlag.FAILED_RIFT | CrustFlag.RIFT_MARGIN;
const r3 = x => Math.round(x * 1000) / 1000;

/** Per world cell: land (of its plate), the stress (NaN off the solve), and each variant's strength. */
function fields(w) {
    const { plates, owner, ownerCell, config, time, mantleHeat } = w, n = mesh.numCells, { xyz } = mesh;
    const land = new Uint8Array(n), s1 = new Float32Array(n).fill(NaN), s2 = new Float32Array(n), dir = new Float32Array(3 * n);
    const T = VARIANTS.map(() => new Float32Array(n)), model = new Float32Array(n), magma = new Uint8Array(n), s = { s1: 0, s2: 0, dir: [0, 0, 0] };
    const heads = (w.hotspots ?? []).filter(h => h.lip && time - h.bornAt <= HEAD_MYR && time >= h.bornAt).map(h => ({ xyz: h.xyz, cos: Math.cos((h.lip.radiusKm || 1000) / R) }));
    for (let c = 0; c < n; c++) {
        const o = owner[c]; if (o < 0 || plates[o].isBackground) continue;
        const cr = plates[o].crust, k = ownerCell[c], t = cr.type[k];
        if (t === CrustType.OCEAN) continue;
        land[c] = 1;
        if (stressAt(w, c, s)) { s1[c] = s.s1; s2[c] = s.s2; dir[3 * c] = s.dir[0]; dir[3 * c + 1] = s.dir[1]; dir[3 * c + 2] = s.dir[2]; }
        model[c] = strengthOf(cr, k, time, config, mantleHeat[c]);
        for (const h of heads) if (h.xyz[0] * xyz[3 * c] + h.xyz[1] * xyz[3 * c + 1] + h.xyz[2] * xyz[3 * c + 2] >= h.cos) { magma[c] = 1; break; }
        const craton = t === CrustType.CRATON ? config.cratonStrength : 1, inh = cr.flags[k] & WEAK ? config.riftWeaknessCost : 1;
        const dmg = 1 - (1 - config.plateDamageKeep) * cr.damage[k], heat = mantleHeat[c];
        VARIANTS.forEach((v, i) => { T[i][c] = v.Y * craton * (v.dmg ? inh * dmg : 1) * Math.pow(v.W, -heat) / (magma[c] ? v.m : 1); });
    }
    return { land, s1, s2, dir, T, model, magma };
}

/** The normal stress across the step a → b (stressPaths' σ, unfloored). */
function sigmaN(F, a, b) {
    const { xyz } = mesh;
    if (!(F.s1[b] === F.s1[b])) return NaN;
    let dx = xyz[3 * b] - xyz[3 * a], dy = xyz[3 * b + 1] - xyz[3 * a + 1], dz = xyz[3 * b + 2] - xyz[3 * a + 2];
    const bx = xyz[3 * b], by = xyz[3 * b + 1], bz = xyz[3 * b + 2], along = dx * bx + dy * by + dz * bz;
    dx -= along * bx; dy -= along * by; dz -= along * bz;
    let nx = by * dz - bz * dy, ny = bz * dx - bx * dz, nz = bx * dy - by * dx;
    const l = Math.hypot(nx, ny, nz) || 1, c = (nx * F.dir[3 * b] + ny * F.dir[3 * b + 1] + nz * F.dir[3 * b + 2]) / l, c2 = c * c;
    return F.s1[b] * c2 + F.s2[b] * (1 - c2);
}
const stepKm = (a, b) => { const { xyz } = mesh; return Math.hypot(xyz[3 * b] - xyz[3 * a], xyz[3 * b + 1] - xyz[3 * a + 1], xyz[3 * b + 2] - xyz[3 * a + 2]) * R; };
const dot = (a, b) => { const { xyz } = mesh; return xyz[3 * a] * xyz[3 * b] + xyz[3 * a + 1] * xyz[3 * b + 1] + xyz[3 * a + 2] * xyz[3 * b + 2]; };

/** The plates' land as lists, each with its edge cells and hop distance from the edge. */
function plateLands(w, F) {
    const { owner } = w, { adjOffset, adjList, numCells } = mesh, by = new Map();
    for (let c = 0; c < numCells; c++) if (F.land[c]) { let L = by.get(owner[c]); if (!L) by.set(owner[c], L = []); L.push(c); }
    const dist = new Int16Array(numCells).fill(-1), lands = [];
    for (const [p, list] of by) {
        const edge = []; let frontier = [];
        for (const c of list) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!F.land[nb] || owner[nb] !== p) { edge.push(c); dist[c] = 0; frontier.push(c); break; } }
        for (let d = 1; frontier.length; d++) { const next = []; for (const c of frontier) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (F.land[nb] && owner[nb] === p && dist[nb] < 0) { dist[nb] = d; next.push(nb); } } frontier = next; }
        lands.push({ plate: p, list, edge, areaMkm2: list.length * mesh.cellAreaKm2 / 1e6 });
    }
    return { lands, dist };
}

/** The candidate bands of one plate's land at strength T: one cut per junction. */
function bands(w, F, L, dist, T) {
    const { config, owner } = w, { adjOffset, adjList, numCells, edgeKm } = mesh, p = L.plate, floor = config.riftStressFloor * config.forceUnitNPerM;
    const minHops = Math.ceil(config.riftMinArmKm / edgeKm), cosApart = Math.cos(config.riftMinArmKm / R), cosChord = Math.cos(config.riftMinChordKm / R);
    const cand = L.list.filter(c => dist[c] >= minHops && w.plates[p].crust.type[w.ownerCell[c]] !== CrustType.CRATON && F.s1[c] === F.s1[c]);
    cand.sort((a, b) => F.s1[b] / T[b] - F.s1[a] / T[a] || a - b);
    const js = [];
    for (const c of cand) { if (js.length >= JUNCTIONS) break; if (!js.some(o => dot(o, c) > cosApart)) js.push(c); }
    const isEdge = new Set(L.edge), outs = [];
    for (const j of js) {
        const cost = new Map([[j, 0]]), from = new Map(), heap = new MinHeap(); heap.push(0, j);
        while (heap.size) {
            const a = heap.pop(), key = heap.lastKey;
            if (key > cost.get(a)) continue;
            for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
                const b = adjList[k];
                if (!F.land[b] || owner[b] !== p) continue;
                const sg = sigmaN(F, a, b), v = key + stepKm(a, b) * T[b] / Math.max(floor, sg === sg ? sg : floor);
                if (v < (cost.get(b) ?? Infinity)) { cost.set(b, v); from.set(b, a); heap.push(v, b); }
            }
        }
        const ends = L.edge.filter(c => cost.has(c)).sort((a, b) => cost.get(a) - cost.get(b));
        if (ends.length < 2) continue;
        const ea = ends[0], eb = ends.find(c => dot(c, ea) <= cosChord);
        if (eb === undefined) continue;
        let fd = 0, fr = 0, km = 0, mg = 0; const path = new Set();
        for (const e of [ea, eb]) for (let b = e; b !== j; b = from.get(b)) {
            const a = from.get(b); if (path.has(b)) continue; path.add(b);
            const d = stepKm(a, b), sg = sigmaN(F, a, b);
            fd += (sg === sg ? sg : 0) * d; fr += T[b] * d; km += d; if (F.magma[b]) mg += d;
        }
        outs.push({ ratio: fd / fr, fd, fr, km, magma: mg / km, path });
    }
    // distinct bands: a cut sharing over half its cells with a better one is the same band
    outs.sort((a, b) => b.ratio - a.ratio);
    const kept = [];
    for (const o of outs) { let same = false; for (const k of kept) { let sh = 0; for (const c of o.path) if (k.path.has(c)) sh++; if (sh > 0.5 * o.path.size) { same = true; break; } } if (!same) kept.push(o); }
    return kept;
}

/** Every plate's bands under every variant (and the model's own strength), plus land yielding. */
function survey(w, F, variants = VARIANTS.map((_, i) => i), withModel = false) {
    const { lands, dist } = plateLands(w, F), res = [];
    for (const L of lands) {
        if (L.list.length < 4) continue;
        const r = { plate: L.plate, area: r3(L.areaMkm2), v: {} };
        for (const i of variants) r.v[VARIANTS[i].name] = bands(w, F, L, dist, F.T[i]).map(b => [r3(b.ratio), Math.round(b.km), r3(b.magma)]);
        if (withModel) {
            const b = bands(w, F, L, dist, F.model); r.model = b.length ? r3(b[0].ratio) : null; r.v.law = b.map(x => [r3(x.ratio), Math.round(x.km), r3(x.magma)]);
            let y = 0; for (const c of L.list) if (F.s1[c] > F.model[c]) y++; r.yield = r3(y / L.list.length);
            r.meanS1 = Math.round(L.list.reduce((s, c) => s + (F.s1[c] === F.s1[c] ? F.s1[c] : 0), 0) / L.list.length / 1e9);    // GN/m
        }
        res.push(r);
    }
    return res;
}

/** Solve the stress on the world as it stands and survey it, leaving the history's world.plateStress as it was. */
function solvedSurvey(w) {
    // (step/plate-stress.js netTorques caches each plate's torques on world.loads: a solve here, before steerBackArcStrips turns
    // the strips, would hand the history's own solve stale torques — so the caches go back too)
    const keep = w.plateStress, cached = w.plates.map(p => p.netTorque);
    try { if (!solvePlateStress(w)) return null; return survey(w, fields(w), [], true); }
    finally { w.plateStress = keep; w.plates.forEach((p, i) => { if (cached[i] === undefined) delete p.netTorque; else p.netTorque = cached[i]; }); }
}
const neighbours = (w, p) => { const { adjOffset, adjList } = mesh, s = new Set(); for (let c = 0; c < mesh.numCells; c++) if (w.owner[c] === p) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const o = w.owner[adjList[k]]; if (o !== p && o >= 0 && !w.plates[o].isBackground) s.add(o); } return [...s]; };

for (const seed of seeds) {
    const t0 = performance.now();
    const world = scene.build(mesh, seed, { continentalFraction: 0.3 });
    Object.assign(world.config, overrides);
    let seenSolves = 0, seenEvents = 0, pre = null, surveyMs = 0, splitMs = 0;
    const helpers = { async searchJunctions(w, req) {
        if (!OFF && (!pre || pre.time !== w.time)) {
            const t = performance.now();
            pre = { time: w.time, plates: solvedSurvey(w), nbs: new Map(), alive: new Set(w.plates.filter(p => p.alive && !p.isBackground).map(p => p.id)) };
            splitMs += performance.now() - t;
        }
        if (pre && !pre.nbs.has(req.plate.id)) pre.nbs.set(req.plate.id, neighbours(w, req.plate.id));
        return searchJunctions(w, req);
    } };
    const drive = w => {
        scene.drive(w);
        if (pre && pre.time === w.time) {
            const t = performance.now(), post = solvedSurvey(w), rifts = w.events.slice(seenEvents).filter(e => e.kind === EventKind.RIFT && e.time === w.time);
            splitMs += performance.now() - t;
            emit({ kind: 'split', seed, t: r3(w.time), tried: [...pre.nbs.keys()], nbs: Object.fromEntries(pre.nbs), rifts: rifts.map(e => ({ plate: e.data.plate, fresh: e.data.fresh, cause: e.data.cause, km: Math.round(e.data.lengthKm) })), pre: pre.plates, post });
            pre = null;
        }
        seenEvents = w.events.length;
        const n = w.stressLog?.length ?? 0;
        if (n > seenSolves && !OFF) {
            seenSolves = n; const t = performance.now();
            const F = fields(w), res = survey(w, F, undefined, true);
            surveyMs += performance.now() - t;
            emit({ kind: 'solve', seed, t: r3(w.time), heat: r3(w.mantleHeat.reduce((s, h, c) => s + (F.land[c] ? h : 0), 0) / Math.max(1, F.land.reduce((s, x) => s + x, 0))), plates: res });
        }
    };
    await simulateAsync(world, { untilMyr: len, drive, snapshotEveryMyr: 10, keepFrames: false }, helpers);
    const ev = world.events.filter(e => e.kind === EventKind.RIFT || e.kind === EventKind.SUPERCONTINENT).map(e => e.kind === EventKind.RIFT ? ['R', r3(e.time), e.data.cause] : [e.data.up ? 'S' : 'D', r3(e.time)]);
    emit({ kind: 'done', label, seed, cells, len, secs: +((performance.now() - t0) / 1000).toFixed(1), surveySecs: +(surveyMs / 1000).toFixed(1), splitSecs: +(splitMs / 1000).toFixed(1),
        rifts: world.events.filter(e => e.kind === EventKind.RIFT).length, solves: seenSolves, events: ev, config: { plateYieldContinent: world.config.plateYieldContinent } });
}
