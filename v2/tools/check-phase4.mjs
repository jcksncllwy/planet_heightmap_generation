// Headless acceptance checks for Phase 4 (plate driving forces).
// Usage: node v2/tools/check-phase4.mjs
// Hard checks: the solver, crust rules under computed motion, the speed cap never engaging, and the force balance doing
// what its physics says — a plate heads for its trench, balanced pulls cancel, the stronger pull wins, a landmass pulls
// itself apart, collision slows the plates, slab-attached ocean outruns a continent, more drag or resistance slows, no
// suction no motion, forces independent of the mesh. Reported: the speeds that come out (settled speeds, cruising and
// peak speeds, spreading rates, response time) against Earth's (Zahirovic et al. 2015 and others), and the collision's
// overlap, which with forces alone nothing takes up (colliding plates keep converging; the budget in km² is Phase 5's).

import { check, report, section, finish, labMesh, mean, largestJump, relativeCmYr } from './lib/check-kit.mjs';
import { makeRng } from '../../js/rng.js';
import { PLANET_RADIUS_KM } from '../js/core/sim-mesh.js';
import { FORCE_SCENES } from '../js/tectonics/scenarios/force-scenes.js';
import { simulate } from '../js/tectonics/simulate.js';
import { updatePlateMotion, solve3 } from '../js/tectonics/step/torque-balance.js';
import { frameTallies, situationOf, isSteady } from '../js/tectonics/measure.js';
import { CrustType } from '../js/tectonics/model/crust.js';
import { resolve } from '../js/tectonics/step/resolve.js';
import { gatherLoads } from '../js/tectonics/step/forces.js';

const SEED = 12345, SNAPSHOT_MYR = 2, SPIN_UP_MYR = 20;
const mesh = labMesh();
const frameIndex = myr => Math.round(myr / SNAPSHOT_MYR);

function landCells(world) {
    let n = 0;
    for (const p of world.plates) for (let c = 0; c < p.crust.mask.length; c++) if (p.crust.mask[c] && p.crust.type[c] !== CrustType.OCEAN) n++;
    return n;
}

/** Simulate one Phase 4 scene with the force model as the only source of motion. */
function run(id, overrides = {}, onMesh = mesh) {
    const scene = FORCE_SCENES.find(s => s.id === id), world = scene.build(onMesh, SEED);
    Object.assign(world.config, overrides);
    const landBefore = landCells(world);
    const { frames, steps } = simulate(world, { untilMyr: scene.maxMyr, drive: updatePlateMotion, snapshotEveryMyr: SNAPSHOT_MYR, events: false });     // forces alone: collision events are Phase 5
    const idOf = Object.fromEntries(frames[0].plates.map(p => [p.name, p.id]));
    const tallies = frames.map(frameTallies);
    return {
        scene, world, frames, steps, idOf,
        movers: frames[0].plates.filter(p => !p.isBackground).map(p => p.name),
        plate: (name, myr) => frames[frameIndex(myr)].plates[idOf[name]],
        track: name => frames.map(f => f.plates[idOf[name]].speedCmYr),
        landDrift: landCells(world) - landBefore,
        maxGaps: Math.max(...tallies.map(t => t.gaps)),
        collision: tallies.map(t => t.collision),
    };
}

/**
 * How much of a plate's velocity (at its centre, at time `myr`) points west: 1 = due west, −1 = due east.
 * (Judged from the velocity: the centre of area itself lags, because new ocean keeps being added behind the plate.)
 */
function westwardShare(r, name, myr) {
    const { omega: o, centre: c } = r.plate(name, myr), v = [o[1] * c[2] - o[2] * c[1], o[2] * c[0] - o[0] * c[2], o[0] * c[1] - o[1] * c[0]];
    const west = [c[1], -c[0], 0], speed = Math.hypot(...v), length = Math.hypot(...west);
    return speed < 1e-12 ? 0 : (v[0] * west[0] + v[1] * west[1]) / (speed * length);
}

section('the solver');
{
    const rng = makeRng(7);
    let worst = 0;
    for (let k = 0; k < 200; k++) {
        const D = new Float64Array(9);                     // a random drag tensor: Σ c (I − r rᵀ)
        for (let j = 0; j < 30; j++) {
            const z = rng() * 2 - 1, a = rng() * 2 * Math.PI, s = Math.sqrt(1 - z * z), r = [s * Math.cos(a), s * Math.sin(a), z], c = 0.2 + rng();
            for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) D[3 * p + q] += c * ((p === q ? 1 : 0) - r[p] * r[q]);
        }
        const b = [rng() - 0.5, rng() - 0.5, rng() - 0.5], x = solve3(D, b);
        for (let p = 0; p < 3; p++) worst = Math.max(worst, Math.abs(D[3 * p] * x[0] + D[3 * p + 1] * x[1] + D[3 * p + 2] * x[2] - b[p]));
    }
    check('torque balance is solved exactly', worst < 1e-10, `largest residual |D·ω − T| over 200 random plates: ${worst.toExponential(1)}`);
}

section('every scene');
const runs = Object.fromEntries(FORCE_SCENES.map(s => [s.id, run(s.id)]));
const settled = { continental: [], oceanic: [] };       // per scene: mean settled speed of its continental / oceanic plates
for (const r of Object.values(runs)) {
    const id = r.scene.id;
    check(`${id}: crust rules hold under computed motion`, r.maxGaps === 0 && r.landDrift === 0, `${r.maxGaps} gap cells, ${r.landDrift} land cells changed, ${r.steps} steps`);

    // Speeds must come out of the force balance. The speed cap is a backstop; if it ever engages, a force is missing.
    const capped = r.frames.flatMap(f => f.plates.filter(p => p.dynamics?.capped).map(p => `${p.name} at ${f.time} Myr`));
    const fastest = Math.max(...r.movers.map(name => Math.max(...r.track(name))));
    check(`${id}: the speed cap never engages`, capped.length === 0, capped.length ? capped.slice(0, 4).join(', ') : `fastest plate ${fastest.toFixed(1)} cm/yr, set by the balance of forces alone`);

    // Each plate is only ever in a situation the scene expects; whenever it has settled, its speed is gathered for the report.
    const surprises = [], speeds = { continental: [], oceanic: [] };
    for (const f of r.frames) for (const p of f.plates) {
        if (p.isBackground || f.time < SPIN_UP_MYR) continue;
        const kind = situationOf(p.dynamics), expected = r.scene.expect[p.name] ?? r.scene.expect['*'];
        if (!expected.includes(kind)) surprises.push(`${p.name} is “${kind}” at ${f.time} Myr`);
        if (isSteady(p)) speeds[(p.keelCells ?? p.landCells) > r.world.config.continentalPlateShare * p.cells ? 'continental' : 'oceanic'].push(p.speedCmYr);
    }
    check(`${id}: plates are in the situations the scene sets up`, surprises.length === 0, surprises.length ? surprises.slice(0, 4).join('; ') : Object.entries(r.scene.expect).map(([n, k]) => `${n}: ${k.join(' → ')}`).join(' · '));
    for (const k of ['continental', 'oceanic']) if (speeds[k].length) settled[k].push({ id, v: mean(speeds[k]), n: speeds[k].length });
}
// (Worldbuilding Pasta's bands per situation were a blog's; Earth's figures: Zahirovic et al. 2015, EPSL 418 — median RMS
// plate speed ~4 cm/yr over 200 Myr, plates > 25 % craton ~2.8, slab-attached oceanic plates 2–3× faster than continental)
report('settled speed, continental plates (mean per scene)', settled.continental.map(s => s.v), { earth: [1, 4], unit: ' cm/yr', source: 'Zahirovic et al. 2015, EPSL 418 — holds through the cycle: speeds over the last 200 Myr',
    detail: settled.continental.map(s => `${s.id} ${s.v.toFixed(2)} (${s.n} plate-frames)`).join(', ') });
report('settled speed, oceanic plates (mean per scene)', settled.oceanic.map(s => s.v), { earth: [5, 10], unit: ' cm/yr', source: 'slab-attached plates, Zahirovic et al. 2015; Forsyth & Uyeda 1975',
    detail: settled.oceanic.map(s => `${s.id} ${s.v.toFixed(2)} (${s.n} plate-frames)`).join(', ') || 'no oceanic plate settles in these scenes' });

section('one-sided trench');
const solo = runs['one-sided'];
{
    const cruising = solo.track('Solo').slice(frameIndex(30));
    // (the speed is the balance of its trench's suction against its keel's drag; whether it is Earth's is the report below)
    check('active-margin continent: its trench\'s suction moves it', mean(cruising) > 0.1, `Solo cruises at ${mean(cruising).toFixed(2)} cm/yr (30–80 Myr), from rest`);
    report('active-margin continent: cruising speed', mean(cruising), { earth: [1, 4], unit: ' cm/yr', source: 'cratonic plates ~2.8 cm/yr median RMS, Zahirovic et al. 2015' });
    const west = [20, 40, 60, 80].map(t => westwardShare(solo, 'Solo', t));
    check('it heads for its trench', Math.min(...west) > 0.9, `trench on the west coast → share of its velocity pointing west at 20/40/60/80 Myr: ${west.map(v => v.toFixed(2)).join(' / ')}`);
    const spinUp = solo.track('Solo').findIndex(v => v > 0.8 * mean(cruising)) * SNAPSHOT_MYR;
    check('motion is smooth', largestJump(cruising) < 0.35 && spinUp >= 0,
        `largest change between frames (${SNAPSHOT_MYR} Myr) once under way: ${largestJump(cruising).toFixed(2)} cm/yr; reaches 80 % of cruising speed after ${spinUp} Myr`);
    // (plates have no inertia: the force balance answers at once; what takes time is the slab growing — here the trench
    // cells maturing, config.slabMatureKm — so the response time is reported, not required)
    report('response time: from rest to 80 % of cruising speed', spinUp, { earth: [1, 5], unit: ' Myr', digits: 0, source: 'observed plate-motion changes take ~1–5 Myr (Iaffaldano & Bunge 2015, Annu. Rev.)' });
}

section('tug of war');
{
    const r = runs.tug, early = Math.max(...r.track('Balanced').slice(0, frameIndex(30) + 1)), soloEarly = Math.max(...solo.track('Solo').slice(0, frameIndex(30) + 1));
    check('balanced pulls (nearly) cancel', early < 0.4 * soloEarly && r.plate('Balanced', 20).dynamics.tension > 0.8,
        `“Balanced” stays below ${early.toFixed(2)} cm/yr for the first 30 Myr while the one-sided continent reaches ${soloEarly.toFixed(2)}; tension ${r.plate('Balanced', 20).dynamics.tension.toFixed(2)}; ${r.plate('Balanced', 80).speedCmYr.toFixed(1)} cm/yr by 80 Myr once the unstable balance tips`);
    const lop = mean(r.track('Lopsided').slice(frameIndex(20))), west = [20, 50, 80].map(t => westwardShare(r, 'Lopsided', t));
    check('unequal pulls: it goes to the stronger side', Math.min(...west) > 0.8,
        `“Lopsided” (long trench west, short trench east) drifts at ${lop.toFixed(2)} cm/yr; share of its velocity pointing west at 20/50/80 Myr: ${west.map(v => v.toFixed(2)).join(' / ')}`);
    report('unequal pulls: the drift speed', lop, { unit: ' cm/yr' });
}

section('self-driven Wilson cycle');
{
    const r = runs.wilson, contact = r.collision.findIndex(c => c > 0) * SNAPSHOT_MYR;
    const west = r.plate('West', 40).speedCmYr, east = r.plate('East', 40).speedCmYr, apart = relativeCmYr(r.plate('West', 40), r.plate('East', 40));
    const gapDeg = myr => { const a = r.plate('West', myr).centre, b = r.plate('East', myr).centre; return Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180 / Math.PI; };
    check('the landmass pulls itself apart', apart > 0 && gapDeg(40) > gapDeg(0),
        `at 40 Myr West ${west.toFixed(2)} and East ${east.toFixed(2)} cm/yr, ${apart.toFixed(2)} cm/yr apart, no prescribed motion; their centres ${gapDeg(0).toFixed(1)}° → ${gapDeg(40).toFixed(1)}° apart`);
    report('young ocean: full spreading rate between the halves (40 Myr)', apart, { earth: [2, 4], unit: ' cm/yr', source: 'the young Atlantic opened at ~2–4 cm/yr full rate', detail: `West ${west.toFixed(2)}, East ${east.toFixed(2)} cm/yr` });
    const track = r.track('East'), before = mean(track.slice(frameIndex(contact) - 6, frameIndex(contact))), after = mean(track.slice(frameIndex(contact) + 10, frameIndex(contact) + 25));
    check('collision slows the plate', contact > 0 && after < 0.75 * before, `East meets Far at ${contact} Myr: ${before.toFixed(2)} → ${after.toFixed(2)} cm/yr`);
    // (colliding plates keep converging; with the event rules on, the overlap is taken up as belt and welded, and that budget
    // in km² is checked in Phase 5. Here, forces alone, nothing takes it up: it is only reported.)
    const late = r.collision.slice(-15), peak = Math.max(...r.collision), mkm2 = cells => cells * mesh.cellAreaKm2 / 1e6;
    report('collision: land-on-land overlap at its peak', mkm2(peak), { unit: ' Mkm²', detail: `forces alone, nothing takes it up (the km² budget: Phase 5); ${mkm2(r.collision.at(-1)).toFixed(2)} Mkm² at the end, ${r.scene.maxMyr - contact} Myr after contact; the last 15 frames vary by ${mkm2(Math.max(...late) - Math.min(...late)).toFixed(2)} Mkm²` });
    // judged at the seam: locked plates may still pivot about it, so their centres can differ in speed
    const last = r.frames.at(-1), oE = last.plates[r.idOf.East].omega, oF = last.plates[r.idOf.Far].omega, d = [oE[0] - oF[0], oE[1] - oF[1], oE[2] - oF[2]];
    let slip = 0, seam = 0;
    for (let c = 0; c < mesh.numCells; c++) {
        if (last.overlap[c] !== 2) continue;
        const x = mesh.xyz[3 * c], y = mesh.xyz[3 * c + 1], z = mesh.xyz[3 * c + 2];
        slip += Math.hypot(d[1] * z - d[2] * y, d[2] * x - d[0] * z, d[0] * y - d[1] * x) * PLANET_RADIUS_KM / 10; seam++;
    }
    // (Earth's seams do not stop: India–Asia went from ~15–18 cm/yr before the collision to ~4–5 after, and still converges)
    report('collision: convergence along the seam after ÷ approach before', seam > 0 ? slip / seam / before : null, { earth: [0.25, 0.35], source: 'India–Asia (van Hinsbergen et al. 2011)',
        detail: `slip along the East–Far seam at ${r.scene.maxMyr} Myr: ${(slip / Math.max(1, seam)).toFixed(2)} cm/yr over ${seam} cells, against ${before.toFixed(2)} cm/yr of approach before contact; Far, with no trench of its own at first, is pushed along at ${r.plate('Far', r.scene.maxMyr).speedCmYr.toFixed(2)} cm/yr` });
}

section('India');
{
    const r = runs.india, contact = r.collision.findIndex(c => c > 0) * SNAPSHOT_MYR, india = r.track('India'), peak = Math.max(...india);
    const asiaBefore = mean(r.track('Asia').slice(frameIndex(10), frameIndex(contact)));
    check('subducting ocean plate: more than twice as fast as a suction-driven continent', peak > 2 * asiaBefore,
        `India peaks at ${peak.toFixed(1)} cm/yr — ${(peak / asiaBefore).toFixed(1)}× the continent it is heading for (${asiaBefore.toFixed(2)}); oceanic plates run 2–3× continental (Zahirovic et al. 2015)`);
    report('subducting ocean plate: peak speed', peak, { earth: [5, 10], unit: ' cm/yr', digits: 1, source: 'typical slab-attached plates (Zahirovic et al. 2015); India\'s ~18 cm/yr was exceptional (Kumar et al. 2007)' });
    const after = mean(india.slice(frameIndex(contact) + 8));
    check('it slows sharply on contact', contact > 0 && after < 0.65 * peak, `contact at ${contact} Myr: ${peak.toFixed(1)} → ${after.toFixed(1)} cm/yr (the real India: 20 → 6)`);
    // (the overlap turned into belt, as a budget in km²: Phase 5, with the event rules on)
    report('India: land-on-land overlap at its peak', Math.max(...r.collision) * mesh.cellAreaKm2 / 1e6, { unit: ' Mkm²', detail: 'forces alone, nothing takes it up (the km² budget: Phase 5)' });
    const stiff = run('india', { slabResistance: 2 * r.world.config.slabResistance }), stiffPeak = Math.max(...stiff.track('India'));
    check('its speed is set by slab pull against the mantle’s resistance', stiffPeak < 0.75 * peak, `doubling the slab resistance: peak ${peak.toFixed(1)} → ${stiffPeak.toFixed(1)} cm/yr (×${(stiffPeak / peak).toFixed(2)}; ×0.5 if the resistance were all of it, v ∝ F/η)`);
}

section('the start world');
{
    const r = runs.start, name = r.movers[0], top = Math.max(...r.track(name)), tension = r.plate(name, r.scene.maxMyr).dynamics.tension;
    // (tension = 1 − |net torque| ÷ the sum of the one-sided pulls' torques: the pulls round the rim must very nearly cancel)
    check('ringed supercontinent: its pulls very nearly cancel', 1 - tension < 0.3, `net torque ${((1 - tension) * 100).toFixed(0)} % of the sum of the one-sided pulls (tension ${tension.toFixed(2)})`);
    report('ringed supercontinent: its top speed', top, { unit: ' cm/yr', source: 'Pangea drifted slowly northward in the Permian–Triassic', detail: `${name} in ${r.scene.maxMyr} Myr` });
}

section('the physics responds the way it should');
{
    const cruise = r => mean(r.track('Solo').slice(frameIndex(30)));
    const cfg = solo.world.config, heavy = run('one-sided', { dragContinent: 2 * cfg.dragContinent, dragCraton: 2 * cfg.dragCraton }), none = run('one-sided', { slabSuction: 0 });
    check('more continental drag → slower continent', cruise(heavy) < 0.7 * cruise(solo), `${cruise(solo).toFixed(2)} → ${cruise(heavy).toFixed(2)} cm/yr with drag doubled`);
    check('no suction → no motion', Math.max(...none.track('Solo')) < 0.05, `fastest speed with suction off: ${Math.max(...none.track('Solo')).toFixed(3)} cm/yr`);
    // the forces themselves must not depend on the mesh …
    const pulls = [16000, 40000, 90000].map(cells => {
        const m = labMesh(cells), world = FORCE_SCENES[0].build(m, SEED);
        for (const p of world.plates) p.refreshExtent(m.xyz);
        resolve(world);
        return gatherLoads(world).get(world.plates.find(p => p.name === 'Solo').id).torqueMagnitudeSum;
    });
    const spread = (Math.max(...pulls) - Math.min(...pulls)) / mean(pulls);
    check('forces do not depend on mesh resolution', spread < 0.1, `total trench torque on the same continent at 16K / 40K / 90K cells: ${pulls.map(v => v.toFixed(1)).join(' / ')} (spread ${(spread * 100).toFixed(0)} %)`);
    // … the speed that emerges over time is allowed a wider margin (it also depends on how newly formed trench cells mature)
    const coarse = run('one-sided', {}, labMesh(16000));
    check('emergent speed is similar on a coarser mesh', Math.abs(cruise(coarse) - cruise(solo)) / cruise(solo) < 0.3,
        `${cruise(solo).toFixed(2)} cm/yr on 40K cells vs ${cruise(coarse).toFixed(2)} on 16K cells (the history always runs on the fixed 40K mesh, whatever the render detail)`);
    report('mesh convergence: emergent speed, 16K against 40K cells', 100 * Math.abs(cruise(coarse) - cruise(solo)) / cruise(solo), { unit: ' %', digits: 0 });
}

finish('Phase 4');
