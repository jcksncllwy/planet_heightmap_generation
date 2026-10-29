// Headless acceptance checks for Phase 10 (cratons against the ranges, and their look — plans/V2_ROADMAP_PHASES_9_13.md).
// Hard checks: a collision's belt rides onto a craton's rim, and the rim belts change no event (records only); a range
// pressed against a craton from its lower plate bends a lowland into it, and the upper plate's shield is bent less than
// the lower's (retro < pro); each shield stands at the same height at 160K and 640K; craton relief is no more than
// ordinary lowland's; craton scraps read as their surroundings.
// Reported: how deep a belt reaches into a craton and how many craton cells thicken, the lower plate's foreland bend,
// the upper plate's front and bend, how much cratons differ from one another, and craton relief against lowland's.
// Usage: node v2/tools/check-phase10.mjs

import { check, checkAcross, report, section, finish, labMesh, medianOf, nearestFrame } from './lib/check-kit.mjs';
import { simulateCached } from './lib/history-cache.mjs';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { CrustType, OrogenyType, BeltSide } from '../js/tectonics/model/crust.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { synthesizeTerrain, flexuralLengthKm } from '../js/terrain/synthesize.js';
import { terrainConfig } from '../js/terrain/terrain-config.js';
import { kindType, kindSide } from '../js/terrain/records.js';
import { spreadKm } from '../js/core/min-heap.js';
import { buildAnchor } from '../js/terrain/anchor.js';

// (the scene's seeds — the India, Wilson and rift scenes' too — and the whole planet's, which phases 9 and 13 read as well)
const SEED = 12345, SCENE_SEEDS = [SEED, 1, 2], PLANET_SEEDS = [SEED, 777, 4242];
const mesh = labMesh(), n = mesh.numCells;
const median = a => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
const run = (id, until, overrides = null, seed = SEED) => {
    const scene = TERRAIN_SCENES.find(s => s.id === id), world = scene.build(mesh, seed);
    if (overrides) Object.assign(world.config, overrides);
    const { frames } = simulateCached(world, { untilMyr: until ?? scene.maxMyr, drive: w => scene.drive(w), snapshotEveryMyr: 10 }, { drive: scene.drive });     // (the history cache: tools/lib/history-cache.mjs)
    // (events: the last frame's — the world is not run when the history comes from the cache)
    return { world, frames, frame: frames.at(-1), events: frames.at(-1).events };
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
    // (every frame while the collision builds, up to the weld. After it the records reach a cell or two further in —
    // 344 km at most on the plate's own raster, 165 km in the India scene (Phase 11): the weld's belt is spread from the
    // seam as the redraw left it, and a path enters a craton half a cell before it counts. It does not show: the terrain
    // fades a belt's relief across the rim by the distance from the shield's edge line (terrain/cratons.js), not by records)
    const weldAt = cr.events.find(e => e.kind === 'suture')?.time ?? Infinity;
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
    check('the collision\'s belt rides onto the shield\'s rim', most > 0 && deepest > 0, `up to ${most} craton cells carry a belt before the weld (${weldAt} Myr)`);
    // (how deep, and how much a shield thickens, comes from its strength: each km of craton costs a belt cratonStrength km of
    // its reach, and it thickens 1/cratonStrength as much. On Earth craton cores rarely deform, but the Laramide reached into
    // Wyoming and the North China craton was destroyed)
    report('deepest a belt reaches into a craton before the weld', deepest, { unit: ' km', digits: 0, source: 'cratons resist deformation (Lenardic & Moresi 1999); the sub-Andean zone 50–100 km', detail: `cratonStrength ${cfg.cratonStrength}` });
    report('craton cells thickened by a belt (summed over frames)', thick, { digits: 0, source: 'craton cores rarely thicken' });
    const off = run('cratons', null, { cratonStrainShare: 0 }), log = w => w.events.map(e => `${e.time}|${e.kind}|${e.text}`).join('\n');
    check('…and it changes no event of the history: only its records', log(off) === log(cr), `${cr.events.length} events, the same with and without the rim belts`);
}

// ── the lower plate's shield: a foreland; the upper plate's: a steep front ──
section('ranges against shields');
const tm640 = terrainMesh(640000);
{
    // (the scene on three seeds — its coasts and shields drawn from each seed's noise: a range's foreland is a mechanism,
    // but where the shield's edge falls under the range, and whether a shield edge lies under a belt at all, is the
    // collision's chance. A seed whose cross-section finds no shield edge under a belt is counted as the scene not forming)
    const sides = SCENE_SEEDS.map(seed => {
        const r = seed === SEED ? cr : run('cratons', null, null, seed), F = r.frame, T = synthesizeTerrain(F, mesh, tm640, { seed, carve: true });
        const Tflat = synthesizeTerrain(F, mesh, tm640, { seed, carve: true, cfg: terrainConfig({ foredeepPerKm: 0 }) });     // (no foreland at all)
        // (India's shield is the one further south; a pressed edge: the belt outside it — on India's, any collision belt: its
        // own lower side's, or the upper plate's front where that overrides it (since Phase 11's collisions most of India's
        // lower belt lies hidden under Asia's front, and the world shows Asia's belt against India's shield — the range the
        // pro-foreland bends under, India being thrust beneath it); on Asia's, its own upper side's)
        const lat = new Map(), cnt = new Map();
        for (let w = 0; w < n; w++) if (isC(F, w)) { lat.set(F.terrane[w], (lat.get(F.terrane[w]) ?? 0) + mesh.xyz[3 * w + 2]); cnt.set(F.terrane[w], (cnt.get(F.terrane[w]) ?? 0) + 1); }
        const [india, asia] = [...lat.keys()].sort((a, b) => lat.get(a) / cnt.get(a) - lat.get(b) / cnt.get(b));
        const kindAt = w => T.rec.belts[0].kind[w];
        const onLower = w => kindAt(w) && kindType(kindAt(w)) === OrogenyType.HIMALAYAN;
        const onUpper = w => kindAt(w) && kindType(kindAt(w)) === OrogenyType.HIMALAYAN && kindSide(kindAt(w)) === BeltSide.UPPER;
        const lower = crossSection(F, T, tm640, onLower, w => F.terrane[w] === india), upper = crossSection(F, T, tm640, onUpper, w => F.terrane[w] === asia);
        const lowerFlat = crossSection(F, Tflat, tm640, onLower, w => F.terrane[w] === india), upperFlat = crossSection(F, Tflat, tm640, onUpper, w => F.terrane[w] === asia);
        // (how far the range bends the shield down: the same ground with no foreland at all, less as it is — the shield's
        // own character, a sag or a swell, cancels out)
        const lowRange = lower(-200, -40), lowFore = lower(80, 200), lowShield = lower(400, 600), lowBent = lowerFlat(80, 200) - lowFore;
        const upBack = upper(-120, -40), upEdge = upper(0, 80), upBent = upperFlat(80, 200) - upper(80, 200);
        // (the same look at every resolution: the shields' median heights at 160K and 640K)
        const tm160 = terrainMesh(160000), T160 = synthesizeTerrain(F, mesh, tm160, { seed, carve: true });
        const medOf = (TT, tm, ter) => { const h = []; for (let t = 0; t < tm.numCells; t++) { const c = TT.sampler.cells[3 * t]; if (isC(F, c) && F.terrane[c] === ter && TT.heightKm[t] > 0) h.push(TT.heightKm[t]); } return median(h); };
        const res = [india, asia].map(ter => [medOf(T, tm640, ter), medOf(T160, tm160, ter)]);
        return { seed, lowRange, lowFore, lowShield, lowBent, upBack, upEdge, upBent, res };
    });
    const fin = (...v) => v.every(Number.isFinite);
    // (the 0.05 km margins are a smoke test of the foreland: its width is the flexural solution's, α = (4D/Δρg)^¼ for the
    // shield's elastic thickness (reported below) — and flexure also predicts a forebulge ~3πα/4 out, which the "shield
    // beyond" here may read)
    checkAcross('before the range on the lower plate, a lowland bends into the shield — lower than the shield beyond it',
        sides.map(s => ({ label: s.seed, formed: fin(s.lowRange, s.lowFore, s.lowShield, s.lowBent), ok: s.lowFore <= s.lowShield - 0.05 && s.lowBent >= 0.05 && s.lowRange > s.lowShield + 0.3,
            text: `India's side: the range ${s.lowRange.toFixed(2)} km (40–200 km outside the shield), the ground 80–200 km in ${s.lowFore.toFixed(2)} km (bent ${s.lowBent.toFixed(2)} km down by the range), the shield 400–600 km in ${s.lowShield.toFixed(2)} km` })),
        { scene: 'ranges against shields: India\'s shield edge under its range' });
    // (a plateau's back stands on its own thickened root, so only the crests of its ranges load the block — the Sichuan
    // Basin lies a little low before the Longmen Shan. Retro-forelands are shallower than pro-forelands (Naylor & Sinclair
    // 2008): that inequality is the check, on the seeds where both shields' edges lie under their belts; the steep front
    // is reported)
    checkAcross('the upper plate\'s shield is bent less before the plateau than the lower plate\'s before the range (retro < pro)',
        sides.map(s => ({ label: s.seed, formed: fin(s.upBent, s.lowBent), ok: s.upBent < s.lowBent, text: `Asia's shield bent ${s.upBent.toFixed(3)} km down 80–200 km in; India's ${s.lowBent.toFixed(2)} km` })),
        { scene: 'ranges against shields: Asia\'s shield edge under its plateau' });
    const tcfg = terrainConfig();
    report('the plateau\'s front: its back above the shield\'s edge', sides.map(s => s.upBack - s.upEdge).filter(Number.isFinite), { unit: ' km', digits: 2, source: 'a steep front with little lowland (Longmen Shan)', detail: sides.map(s => `${s.seed}: the plateau's back ${s.upBack.toFixed(2)} km (40–120 km outside), the shield's edge ${s.upEdge.toFixed(2)} km (0–80 km in)`).join(' · ') });
    report('upper plate\'s bend ÷ lower plate\'s', sides.map(s => s.upBent / s.lowBent).filter(Number.isFinite), { digits: 2, unit: '×', source: 'retro-forelands shallower than pro-forelands (Naylor & Sinclair 2008)', detail: `the plateau's back loads by its crests only; foredeepMaxKm ${tcfg.foredeepMaxKm} km; seeds ${SCENE_SEEDS.join(', ')}` });
    report('the shields\' flexural length', flexuralLengthKm(tcfg.shieldElasticKm), { unit: ' km', digits: 0, earth: [100, 250], source: 'cratonic Te 40–100 km (Watts 2001); the Ganges foredeep ~250–450 km wide ≈ πα/2 + the thrusts',
        detail: `Te ${tcfg.shieldElasticKm} km: the foredeep ~${(3 * Math.PI / 4 * flexuralLengthKm(tcfg.shieldElasticKm)).toFixed(0)} km out from its load, the forebulge's crest ~${(Math.PI * flexuralLengthKm(tcfg.shieldElasticKm)).toFixed(0)} km` });

    // ── the same look at every resolution (a numerical property: on every seed) ──
    section('the same at every resolution');
    check('each shield stands at the same height at 160K and 640K', sides.every(s => s.res.every(([a, b]) => Math.abs(a - b) <= 0.05)),
        sides.map(s => `${s.seed}: India's shield ${s.res[0].map(v => v.toFixed(3)).join(' / ')} km, Asia's ${s.res[1].map(v => v.toFixed(3)).join(' / ')} km`).join(' · ') + ' (640K / 160K)');
}

// ── a whole planet: cratons differ, carry some relief (still calm), and scraps don't show ──
section('cratons across a whole planet (600 Myr)');
{
    // (on the three whole planets phases 9 and 13 read: how rough a planet's cratons and lowlands stand is its history's —
    // the mantle under them, the belts beside them — and swings with a nudge of an unrelated parameter (mantleCoolMyr
    // 150→156: 119 m against 101 on seed 12345; over four nudges × three planets the ratio ran 0.99–1.36, median ~1.15): the
    // median over the three planets, each at 400, 500 and 600 Myr — frames 100 Myr apart, as far apart as a history forgets
    // (the drift of phase 9 renews the fine detail in 150) — nine samples against the 10 %, the frames from the same history)
    const planet = (seed, t) => {
        const { frames } = run('history', 600, null, seed), F = nearestFrame(frames, t), tm = tm640;
        const T = synthesizeTerrain(F, mesh, tm, { seed, carve: true });
        // (without the cratons' characters: only at 600 Myr, for the listing — the check reads T)
        const T0 = t === 600 ? synthesizeTerrain(F, mesh, tm, { seed, carve: true, cfg: terrainConfig({ cratonCharacter: 0 }) }) : null;
        const cellOf = t => T.sampler.cells[3 * t];
        // depth into the craton on the sim grid (for "well inside")
        const din = new Float32Array(n).fill(Infinity);
        for (let w = 0; w < n; w++) if (isC(F, w)) for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1]; k++) if (!isC(F, mesh.adjList[k])) din[w] = 60;
        spreadKm(mesh, din, { canEnter: (a, q) => isC(F, q), maxKm: 3000 });
        const byT = new Map();
        for (let t = 0; t < tm.numCells; t++) { const c = cellOf(t); if (!isC(F, c) || din[c] <= 200 || T.heightKm[t] <= 0) continue; (byT.get(F.terrane[c]) ?? byT.set(F.terrane[c], []).get(F.terrane[c])).push(T.heightKm[t]); }
        const meds = [...byT.values()].filter(a => a.length > 300).map(median), mean = meds.reduce((s, v) => s + v, 0) / meds.length;
        const spread = Math.sqrt(meds.reduce((s, v) => s + (v - mean) ** 2, 0) / meds.length);
        // (the differences are random "characters" today, cratonCharacter; the physics would be dynamic topography and
        // intracratonic subsidence)
        // relief: the spread of heights within each sim cell and its neighbours (~250 km) about the plane that fits them, well
        // inside cratons, with the characters and without; and on ordinary lowland (no belt, below 0.6 km). About the plane:
        // relief is the ground's amplitude about its regional surface, and a swell or sag is a tilt 1,000–2,000 km across
        // (the mantle's dynamic topography: Burke 1996; Hager 1985) — over its ~500 km flank it tilts a 250 km window by tens
        // of metres without roughening it (the raw spread read that tilt as relief: 75 m against lowland's 72 on main)
        const byCell = Array.from({ length: n }, () => []);
        for (let t = 0; t < tm.numCells; t++) byCell[cellOf(t)].push(t);
        const stdIn = TT => w => {
            const ts = [...byCell[w]]; for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1]; k++) ts.push(...byCell[mesh.adjList[k]]);
            const x0 = mesh.xyz[3 * w], y0 = mesh.xyz[3 * w + 1], z0 = mesh.xyz[3 * w + 2], l = Math.hypot(x0, y0) || 1;
            const ex = -y0 / l, ey = x0 / l, nx = -z0 * ey, ny = z0 * ex, nz = x0 * ey - y0 * ex;      // a tangent frame at w
            let N = 0, su = 0, sv = 0, sh = 0, suu = 0, svv = 0, suv = 0, suh = 0, svh = 0, shh = 0;
            for (const t of ts) {
                const h = TT.heightKm[t]; if (h <= 0) continue;
                const dx = tm.xyz[3 * t] - x0, dy = tm.xyz[3 * t + 1] - y0, dz = tm.xyz[3 * t + 2] - z0, u = dx * ex + dy * ey, v = dx * nx + dy * ny + dz * nz;
                N++; su += u; sv += v; sh += h; suu += u * u; svv += v * v; suv += u * v; suh += u * h; svh += v * h; shh += h * h;
            }
            if (N <= 20) return NaN;
            const cuu = suu / N - (su / N) ** 2, cvv = svv / N - (sv / N) ** 2, cuv = suv / N - su * sv / N / N, cuh = suh / N - su * sh / N / N,
                cvh = svh / N - sv * sh / N / N, chh = shh / N - (sh / N) ** 2, det = cuu * cvv - cuv * cuv;
            const b = det > 0 ? (cvv * cuh - cuv * cvh) / det : 0, c = det > 0 ? (cuu * cvh - cuv * cuh) / det : 0;
            return Math.sqrt(Math.max(0, chh - b * cuh - c * cvh));                                  // the residual about the plane
        };
        const sd = stdIn(T), sd0 = T0 ? stdIn(T0) : () => NaN, withC = [], without = [], low = [];
        for (let w = 0; w < n; w++) {
            if (!isLand(F, w)) continue;
            if (isC(F, w) && din[w] > 200) { const a = sd(w); if (a === a) { withC.push(a); if (T0) { const b = sd0(w); if (b === b) without.push(b); } } }
            else if (!isC(F, w) && !F.oroType[w] && !F.prevType[w]) { const a = sd(w); if (a === a && T.rec.platformKm[w] < 0.6) low.push(a); }
        }
        return { seed, t, rc: median(withC), r0: median(without), rl: median(low), spread, meds };
    };
    const samples = PLANET_SEEDS.flatMap(seed => [400, 500, 600].map(t => planet(seed, t))), planets = samples.filter(x => x.t === 600);
    const each = fn => planets.map(x => `${x.seed}: ${fn(x)}`).join(' · '), eachT = fn => samples.map(x => `${x.seed}@${x.t}: ${fn(x)}`).join(' · ');
    report('spread of craton heights (standard deviation of their medians)', planets.map(x => x.spread), { earth: [0.2, 0.5], unit: ' km', digits: 2, source: 'cratons vary by ~±0.5 km: African swells, Congo sag, low Canadian Shield (Hager 1985; Flament et al. 2013)',
        detail: `the median heights of the cratons — ${each(x => x.meds.map(v => v.toFixed(2)).join(', ') + ' km')}` });
    // within 10 %: Earth's shields and its stable platforms both stand at ~20–100 m of local relief (the Canadian Shield's
    // knob-and-lake ground beside the Interior Plains; Fennoscandia beside the Russian Platform), so a shield is not
    // calmer than a platform by any sure margin — what the check guards is that a craton is no ruggeder than lowland, and
    // a metre either way (58 vs 57 m) is the noise of which cells fall in the sample, not a difference in the ground
    const ratio = medianOf(samples.map(x => x.rc / x.rl));
    check('cratons are no rougher than ordinary lowland (within 10 %)', ratio <= 1.1,
        `craton relief ÷ lowland relief ${ratio.toFixed(2)}× (median of ${samples.length}: ${PLANET_SEEDS.length} planets at 400, 500, 600 Myr) — relief within ~250 km about its regional plane, well inside cratons (at 600 Myr also without their characters) against ordinary lowland: ${eachT(x => `${(1000 * x.rc).toFixed(0)} m${x.t === 600 ? ` (${(1000 * x.r0).toFixed(0)} m)` : ''} against ${(1000 * x.rl).toFixed(0)} m`)}`);
    report('craton relief ÷ lowland relief (400 · 500 · 600 Myr per planet)', samples.map(x => x.rc / x.rl), { digits: 2, unit: '×', source: 'shields are low-relief' });
}

// ── scraps of craton (1–3 sim cells, as a collision leaves them: the India scene, and the whole planet) ──
section('scraps of craton');
{
    // A scrap is found on its plate's own raster — the crust itself — not in the world view: the world samples a moved
    // plate's raster, and where it skips the cell that joins a shield's narrow neck to the rest, the neck's tip shows as a
    // one-cell "scrap" in the world view though the terrain (which reads the raster) draws it as the shield it is (Phase
    // 11: 7 of the 10 world-view scraps over these frames were such tips, the lowland of a shield reaching into foothills).
    const gapsOf = (F, tm, seed) => {
        const A = buildAnchor(F, mesh), craton = new Map(), gaps = [];
        for (let i = 0; i < F.crustCells.length; i++) { if (F.crustType[i] !== CrustType.CRATON) continue; const o = Math.floor(F.crustCells[i] / n); (craton.get(o) ?? craton.set(o, new Uint8Array(n)).get(o))[F.crustCells[i] - o * n] = 1; }
        const rasterPatch = (o, r0) => { const m = craton.get(o); if (!m?.[r0]) return 0; const q = [r0], seen = new Set(q); for (let i = 0; i < q.length && q.length <= 3; i++) for (let k = mesh.adjOffset[q[i]]; k < mesh.adjOffset[q[i] + 1]; k++) { const x = mesh.adjList[k]; if (m[x] && !seen.has(x)) { seen.add(x); q.push(x); } } return q.length; };
        let T = null; const seen = new Uint8Array(n);
        for (let w0 = 0; w0 < n; w0++) {
            if (!isC(F, w0) || seen[w0]) continue;
            const patch = [w0]; seen[w0] = 1;
            for (let i = 0; i < patch.length; i++) for (let k = mesh.adjOffset[patch[i]]; k < mesh.adjOffset[patch[i] + 1]; k++) { const q = mesh.adjList[k]; if (isC(F, q) && !seen[q]) { seen[q] = 1; patch.push(q); } }
            if (patch.length > 3) continue;
            const o = F.owner[w0], onRaster = A.moved[o] ? rasterPatch(o, A.cell[w0]) : patch.length;
            if (onRaster < 1 || onRaster > 3) continue;                          // (a bigger shield's tip, seen through the world view)
            const ring = new Set();
            for (const w of patch) for (let k = mesh.adjOffset[w]; k < mesh.adjOffset[w + 1]; k++) { const q = mesh.adjList[k]; if (!isC(F, q) && isLand(F, q)) ring.add(q); }
            if (ring.size < 3) continue;
            T ??= synthesizeTerrain(F, mesh, tm, { seed });
            const meanH = cells => { const set = new Set(cells); let s = 0, m = 0; for (let t = 0; t < tm.numCells; t++) if (set.has(T.sampler.cells[3 * t])) { s += T.heightKm[t]; m++; } return m ? s / m : NaN; };
            const inside = meanH(patch), around = meanH([...ring]);
            if (inside === inside && around === around) gaps.push(around - inside);
        }
        return gaps;
    };
    // (scraps are rare and sim-cell sized: many frames, at 160K. Measured before Phase 10: median 0.02 km, the worst 1.27 km.
    // Which scraps a collision leaves is the history's chance: judged over three sets of histories — the India scene and
    // the whole planet on a seed each — a set with fewer than 3 scraps counted as not forming the scene)
    const tm160 = terrainMesh(160000);
    const sets = SCENE_SEEDS.map((sceneSeed, i) => {
        const gaps = [], found = [];
        for (const [id, seed, times] of [['india', sceneSeed, [50, 60, 70, 80, 90]], ['history', PLANET_SEEDS[i], Array.from({ length: 30 }, (_, j) => 20 * (j + 1))]]) {
            const { frames } = run(id, Math.max(...times), null, seed);
            let k = 0;
            for (const F of frames.filter(f => times.includes(f.time))) { const g = gapsOf(F, tm160, seed); gaps.push(...g); k += g.length; }
            found.push(`${k} in ${id} ${seed}`);
        }
        return { label: `${sceneSeed}/${PLANET_SEEDS[i]}`, gaps, found };
    });
    checkAcross('scraps of craton read as the ground around them — no flat holes in a range',
        sets.map(x => ({ label: x.label, formed: x.gaps.length >= 3, ok: median(x.gaps) <= 0.1 && Math.max(...x.gaps) <= 0.5,
            text: `${x.found.join(', ')}: around them ${median(x.gaps).toFixed(2)} km above (median), the most ${Math.max(...x.gaps).toFixed(2)} km` })),
        { scene: 'scraps of craton (3 or more in a set of histories)', detail: 'craton scraps of 1–3 cells on their own plate\'s raster; the ground around them stands this far above them — below, where negative (before Phase 10 median 0.02 km, the worst 1.27 km)' });
}

finish('Phase 10');
