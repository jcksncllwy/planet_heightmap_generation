// Headless acceptance checks for Phase 10 (cratons against the ranges, and their look — plans/V2_ROADMAP_PHASES_9_13.md):
// a belt rides onto a craton's rim but never into its core (history records only: no event changes); a range pressed
// against a craton from its lower plate bends a lowland into it; a plateau's back against a craton keeps a steep front;
// craton scraps read as their surroundings; cratons differ from one another and carry some relief, still calm; the
// same look at every terrain resolution.
// Usage: node v2/tools/check-phase10.mjs

import { check, section, finish, labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { CrustType, OrogenyType, BeltSide } from '../js/tectonics/model/crust.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { synthesizeTerrain } from '../js/terrain/synthesize.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { kindType, kindSide } from '../js/terrain/records.js';
import { spreadKm } from '../js/core/min-heap.js';

const SEED = 12345;
const mesh = labMesh(), n = mesh.numCells;
const median = a => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
const run = (id, until, overrides = null) => {
    const scene = TERRAIN_SCENES.find(s => s.id === id), world = scene.build(mesh, SEED);
    if (overrides) Object.assign(world.config, overrides);
    const { frames } = simulate(world, { untilMyr: until ?? scene.maxMyr, drive: w => scene.drive(w), snapshotEveryMyr: 10 });
    return { world, frames, frame: frames.at(-1) };
};
const isC = (F, w) => F.owner[w] >= 0 && F.type[w] === CrustType.CRATON, isLand = (F, w) => F.owner[w] >= 0 && F.type[w] !== CrustType.OCEAN;

/**
 * The cross-section at a craton's edge, at the terrain mesh's resolution: every terrain cell's distance from the
 * craton outline as the sim cells draw it (+ inside), counted only where the edge's outside sim cell passes `pressed`,
 * and only for the craton cells `mine` accepts. Returns the median height in bands of distance.
 */
function crossSection(F, T, tm, pressed, mine) {
    const tn = tm.numCells, cellOf = t => T.sampler.cells[3 * t], cls = new Uint8Array(tn), d = new Float32Array(tn).fill(Infinity), tag = new Int8Array(tn);
    for (let t = 0; t < tn; t++) cls[t] = isC(F, cellOf(t)) ? 1 : 0;
    for (let t = 0; t < tn; t++) for (let k = tm.adjOffset[t]; k < tm.adjOffset[t + 1]; k++) {
        const q = tm.adjList[k];
        if (cls[q] === cls[t]) continue;
        const inC = cls[t] ? cellOf(t) : cellOf(q), outC = cls[t] ? cellOf(q) : cellOf(t);
        if (pressed(outC) && mine(inC)) { d[t] = 15; tag[t] = 1; }
    }
    spreadKm(tm, d, { canEnter: (a, q) => cls[q] === cls[a], onReach: (a, q) => { tag[q] = tag[a]; }, maxKm: 800 });
    return (lo, hi) => { const h = []; for (let t = 0; t < tn; t++) { if (!tag[t] || !isLand(F, cellOf(t))) continue; const s = cls[t] ? d[t] : -d[t]; if (s >= lo && s < hi) h.push(T.heightKm[t]); } return median(h); };
}

// ── the rim belts: onto a craton's rim, never its core; records only ──
section('a belt rides onto a craton\'s rim');
const cr = run('cratons'), cfg = cr.world.config;
{
    // (every frame while the collision builds, up to the weld: the weld's redraw then moves crust under the records —
    // indenting the outlines by up to ~200 km — which Phase 11 takes on with the weld itself)
    const weldAt = cr.world.events.find(e => e.kind === 'suture')?.time ?? Infinity;
    let most = 0, deepest = 0, thick = 0;
    for (const F of cr.frames) {
        const notC = [], rim = [];
        for (let w = 0; w < n; w++) { if (F.owner[w] < 0) continue; if (!isC(F, w)) notC.push(w); else if (F.oroType[w]) rim.push(w); }
        thick += rim.filter(w => F.thickKm[w] > 0).length;
        if (F.time >= weldAt) continue;
        const kmTo = w => { let best = -1; for (const q of notC) { const c = mesh.xyz[3 * w] * mesh.xyz[3 * q] + mesh.xyz[3 * w + 1] * mesh.xyz[3 * q + 1] + mesh.xyz[3 * w + 2] * mesh.xyz[3 * q + 2]; if (c > best) best = c; } return Math.acos(Math.min(1, best)) * 6371; };
        most = Math.max(most, rim.length);
        for (const w of rim) deepest = Math.max(deepest, kmTo(w));
    }
    check('the collision\'s belt rides onto the shield\'s rim — never deeper than the rim — and the shield never thickens',
        most >= 5 && deepest <= cfg.cratonRimKm + mesh.edgeKm && thick === 0,
        `up to ${most} craton cells carry a belt before the weld (${weldAt} Myr), the deepest ${deepest.toFixed(0)} km in (the rim is ${cfg.cratonRimKm} km); ${thick} thickened in any frame`);
    const off = run('cratons', null, { cratonRimKm: 0 }), log = w => w.events.map(e => `${e.time}|${e.kind}|${e.text}`).join('\n');
    check('…and it changes no event of the history: only its records', log(off.world) === log(cr.world), `${cr.world.events.length} events, the same with and without the rim belts`);
}

// ── the lower plate's shield: a foreland; the upper plate's: a steep front ──
section('ranges against shields');
const tm640 = terrainMesh(640000);
{
    const F = cr.frame, T = synthesizeTerrain(F, mesh, tm640, { seed: SEED, carve: true });
    const Tflat = synthesizeTerrain(F, mesh, tm640, { seed: SEED, carve: true, cfg: terrainConfig({ foredeepPerKm: 0 }) });     // (no foreland at all)
    // (India's shield is the one further south; a pressed edge: the belt outside it, of its side)
    const lat = new Map(), cnt = new Map();
    for (let w = 0; w < n; w++) if (isC(F, w)) { lat.set(F.terrane[w], (lat.get(F.terrane[w]) ?? 0) + mesh.xyz[3 * w + 2]); cnt.set(F.terrane[w], (cnt.get(F.terrane[w]) ?? 0) + 1); }
    const [india, asia] = [...lat.keys()].sort((a, b) => lat.get(a) / cnt.get(a) - lat.get(b) / cnt.get(b));
    const kindAt = w => T.rec.belts[0].kind[w];
    const onLower = w => kindAt(w) && kindType(kindAt(w)) === OrogenyType.HIMALAYAN && kindSide(kindAt(w)) === BeltSide.LOWER;
    const onUpper = w => kindAt(w) && kindType(kindAt(w)) === OrogenyType.HIMALAYAN && kindSide(kindAt(w)) === BeltSide.UPPER;
    const lower = crossSection(F, T, tm640, onLower, w => F.terrane[w] === india), upper = crossSection(F, T, tm640, onUpper, w => F.terrane[w] === asia);
    const lowerFlat = crossSection(F, Tflat, tm640, onLower, w => F.terrane[w] === india), upperFlat = crossSection(F, Tflat, tm640, onUpper, w => F.terrane[w] === asia);
    // (how far the range bends the shield down: the same ground with no foreland at all, less as it is — the shield's
    // own character, a sag or a swell, cancels out)
    const lowRange = lower(-200, -40), lowFore = lower(80, 200), lowShield = lower(400, 600), lowBent = lowerFlat(80, 200) - lowFore;
    check('before the range on the lower plate, a lowland bends into the shield — lower than the shield beyond it',
        lowFore <= lowShield - 0.05 && lowBent >= 0.05 && lowRange > lowShield + 0.3,
        `India's side: the range ${lowRange.toFixed(2)} km (40–200 km outside the shield), the ground 80–200 km in ${lowFore.toFixed(2)} km (bent ${lowBent.toFixed(2)} km down by the range), the shield 400–600 km in ${lowShield.toFixed(2)} km`);
    // (a plateau's back loads the block at forelandUpperPlate of a range's weight: at most that share of the deepest
    // foreland — a trace, as the Sichuan Basin lies a little low before the Longmen Shan)
    const upBack = upper(-120, -40), upEdge = upper(0, 80), upBent = upperFlat(80, 200) - upper(80, 200), tcfg = terrainConfig();
    check('where the plateau\'s back meets the upper plate\'s shield, the front is steep, with little lowland before it',
        upBack - upEdge >= 0.3 && upBent <= tcfg.forelandUpperPlate * tcfg.foredeepMaxKm + 0.005 && upBent < lowBent / 2,
        `Asia's side: the plateau's back ${upBack.toFixed(2)} km (40–120 km outside), the shield's edge ${upEdge.toFixed(2)} km (0–80 km in); the shield bent ${upBent.toFixed(3)} km down 80–200 km in (India's: ${lowBent.toFixed(2)} km)`);

    // ── the same look at every resolution: the shields' median heights at 160K and 640K ──
    const tm160 = terrainMesh(160000), T160 = synthesizeTerrain(F, mesh, tm160, { seed: SEED, carve: true });
    const medOf = (TT, tm, ter) => { const h = []; for (let t = 0; t < tm.numCells; t++) { const c = TT.sampler.cells[3 * t]; if (isC(F, c) && F.terrane[c] === ter && TT.heightKm[t] > 0) h.push(TT.heightKm[t]); } return median(h); };
    const diffs = [india, asia].map(ter => Math.abs(medOf(T, tm640, ter) - medOf(T160, tm160, ter)));
    section('the same at every resolution');
    check('each shield stands at the same height at 160K and 640K', Math.max(...diffs) <= 0.05,
        `India's shield ${medOf(T, tm640, india).toFixed(3)} / ${medOf(T160, tm160, india).toFixed(3)} km, Asia's ${medOf(T, tm640, asia).toFixed(3)} / ${medOf(T160, tm160, asia).toFixed(3)} km (640K / 160K)`);
}

// ── a whole planet: cratons differ, carry some relief (still calm), and scraps don't show ──
section('cratons across a whole planet (600 Myr)');
{
    const { frame: F } = run('history', 600), tm = tm640;
    const T = synthesizeTerrain(F, mesh, tm, { seed: SEED, carve: true }), T0 = synthesizeTerrain(F, mesh, tm, { seed: SEED, carve: true, cfg: terrainConfig({ cratonCharacter: 0 }) });
    const cellOf = t => T.sampler.cells[3 * t];
    // depth into the craton on the sim grid (for "well inside")
    const din = new Float32Array(n).fill(Infinity);
    for (let w = 0; w < n; w++) if (isC(F, w)) for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1]; k++) if (!isC(F, mesh.adjList[k])) din[w] = 60;
    spreadKm(mesh, din, { canEnter: (a, q) => isC(F, q), maxKm: 3000 });
    const byT = new Map();
    for (let t = 0; t < tm.numCells; t++) { const c = cellOf(t); if (!isC(F, c) || din[c] <= 200 || T.heightKm[t] <= 0) continue; (byT.get(F.terrane[c]) ?? byT.set(F.terrane[c], []).get(F.terrane[c])).push(T.heightKm[t]); }
    const meds = [...byT.values()].filter(a => a.length > 300).map(median), mean = meds.reduce((s, v) => s + v, 0) / meds.length;
    const spread = Math.sqrt(meds.reduce((s, v) => s + (v - mean) ** 2, 0) / meds.length);
    check('cratons differ from one another: sag basins, swells, flat shields', meds.length >= 4 && spread >= 0.15,
        `the median heights of ${meds.length} cratons: ${meds.map(v => v.toFixed(2)).join(', ')} km (spread ${spread.toFixed(2)} km)`);
    // relief: the spread of heights within each sim cell and its neighbours (~250 km), well inside cratons, with the
    // characters and without; and on ordinary lowland (no belt, below 0.6 km)
    const stdIn = TT => {
        const ps = new Float64Array(n), ps2 = new Float64Array(n), pn = new Float64Array(n);
        for (let t = 0; t < tm.numCells; t++) { const c = cellOf(t); if (TT.heightKm[t] <= 0) continue; ps[c] += TT.heightKm[t]; ps2[c] += TT.heightKm[t] ** 2; pn[c]++; }
        return w => { let S1 = ps[w], S2 = ps2[w], N = pn[w]; for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1]; k++) { const q = mesh.adjList[k]; S1 += ps[q]; S2 += ps2[q]; N += pn[q]; } return N > 20 ? Math.sqrt(Math.max(0, S2 / N - (S1 / N) ** 2)) : NaN; };
    };
    const sd = stdIn(T), sd0 = stdIn(T0), withC = [], without = [], low = [];
    for (let w = 0; w < n; w++) {
        if (!isLand(F, w)) continue;
        if (isC(F, w) && din[w] > 200) { const a = sd(w), b = sd0(w); if (a === a && b === b) { withC.push(a); without.push(b); } }
        else if (!isC(F, w) && !F.oroType[w] && !F.prevType[w]) { const a = sd(w); if (a === a && T.rec.platformKm[w] < 0.6) low.push(a); }
    }
    const rc = median(withC), r0 = median(without), rl = median(low);
    check('cratons carry some relief — still the calmest ground', rc >= 1.3 * r0 && rc <= 1.3 * rl,
        `relief within ~250 km, well inside cratons: ${(1000 * rc).toFixed(0)} m (${(1000 * r0).toFixed(0)} m without their characters); on ordinary lowland ${(1000 * rl).toFixed(0)} m`);
}

// ── scraps of craton (1–3 sim cells, as a collision leaves them: the India scene, and the whole planet) ──
section('scraps of craton');
{
    // the ground on each scrap against the ring of ground around it
    const gapsOf = (F, T, tm) => {
        const cellOf = t => T.sampler.cells[3 * t], seen = new Uint8Array(n), gaps = [];
        const meanH = cells => { const set = new Set(cells); let s = 0, m = 0; for (let t = 0; t < tm.numCells; t++) if (set.has(cellOf(t))) { s += T.heightKm[t]; m++; } return m ? s / m : NaN; };
        for (let w0 = 0; w0 < n; w0++) {
            if (!isC(F, w0) || seen[w0]) continue;
            const patch = [w0]; seen[w0] = 1;
            for (let i = 0; i < patch.length; i++) for (let k = mesh.adjOffset[patch[i]]; k < mesh.adjOffset[patch[i] + 1]; k++) { const q = mesh.adjList[k]; if (isC(F, q) && !seen[q]) { seen[q] = 1; patch.push(q); } }
            if (patch.length > 3) continue;
            const ring = new Set();
            for (const w of patch) for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1]; k++) { const q = mesh.adjList[k]; if (!isC(F, q) && isLand(F, q)) ring.add(q); }
            if (ring.size < 3) continue;
            const inside = meanH(patch), around = meanH([...ring]);
            if (inside === inside && around === around) gaps.push(around - inside);
        }
        return gaps;
    };
    // (scraps are rare and sim-cell sized: several frames, at 160K. Measured before Phase 10: median 0.02 km, the worst
    // 1.27 km. The worst now, ~0.8 km, is not a scrap: the visible tip of a shield hidden under the upper plate in a
    // collision's overlap — the weld's geometry, which Phase 11 takes on)
    const gaps = [], found = [], tm160 = terrainMesh(160000);
    for (const [id, times] of [['india', [60, 70, 80, 90]], ['history', [100, 200, 300, 400, 500, 600]]]) {
        const { frames } = run(id, Math.max(...times));
        let k = 0;
        for (const F of frames.filter(f => times.includes(f.time))) { const g = gapsOf(F, synthesizeTerrain(F, mesh, tm160, { seed: SEED }), tm160); gaps.push(...g); k += g.length; }
        found.push(`${k} in the ${id} scene`);
    }
    check('scraps of craton read as the ground around them — no flat holes in a range', gaps.length >= 5 && median(gaps) <= 0.1,
        `craton scraps of 1–3 sim cells over ${found.join(' and ')}: the ground around them stands ${median(gaps).toFixed(2)} km above them (median; before Phase 10 0.02 km, the worst 1.27 km — now ${Math.max(...gaps).toFixed(2)} km)`);
}

finish('Phase 10');
