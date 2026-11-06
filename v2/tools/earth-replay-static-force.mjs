// Static force test of the Earth replay (study lane L1): build Earth at t₀ as the model's start world, run the model's torque
// balance (`updatePlateMotion`) ONCE on it, and set each plate's ω against the reconstruction's own at t₀. REPORT-ONLY and TUNES
// NOTHING: a baseline for the force-model owner (#10/#11), never a target. Pre-registered comparisons: ω magnitude (the fastest
// surface speed, cm/yr), pole position (° apart) and the area-weighted RMS of the velocity difference, for the plates ≥ 1 % of
// Earth; every plate that hits a speed cap is flagged ('CAP': the hard cap; 'soft': ≥ 85 % of the soft limit that bends ω first).
//   node v2/tools/earth-replay-static-force.mjs [--cells 40000] [--t0 0 65]
// Caveats: the model's ω is a force balance on a start world with no history (no slab age, no ridge, mantle flow from the
// supercontinent cycle absent); Earth's is the stage rotation over the Myr around t₀ in the Müller 2019 mantle frame.
import { report, section, finish, check, labMesh } from './lib/check-kit.mjs';
import { loadStartInputs } from './earth-replay-inputs.mjs';
import { loadMullerRotations } from './earth-replay-plates.mjs';
import { quatConj } from './earth-replay-lib.mjs';
import { quatMul } from '../js/core/rotation.js';
import { buildEarthStart } from '../js/tectonics/scenarios/earth-start.js';
import { simulate } from '../js/tectonics/simulate.js';
import { updatePlateMotion } from '../js/tectonics/step/torque-balance.js';
import { keeled } from '../js/tectonics/step/torque-balance.js';
import { xyzToLatLon } from '../js/tectonics/step/kinematics.js';
import { PLANET_RADIUS_KM } from '../js/core/sim-mesh.js';

const arg = k => { const i = process.argv.indexOf(k); if (i < 0) return null; const out = []; for (let j = i + 1; j < process.argv.length && !process.argv[j].startsWith('--'); j++) out.push(+process.argv[j]); return out; };
const CELLS = arg('--cells')?.[0] ?? 40000, T0S = arg('--t0') ?? [0, 65];
const CM_YR_PER_RAD_MYR = PLANET_RADIUS_KM * 1e5 / 1e6;                    // 1 rad/Myr at the surface = 637.1 cm/yr
const NAMES = { 101: 'N America', 201: 'S America', 301: 'Eurasia', 501: 'India', 701: 'Africa', 801: 'Australia', 802: 'Antarctica', 901: 'Pacific', 902: 'Nazca/Farallon', 911: 'Cocos', 919: 'Juan de Fuca', 709: 'Arabia', 702: 'Somalia', 511: 'Burma' };

/** Axis·angle-per-Myr (rad/Myr, world frame) of a quaternion turned through `dt` Myr. */
function omegaOf(q, dt) {
    if (q[0] < 0) q = q.map(v => -v);
    const s = Math.hypot(q[1], q[2], q[3]);
    if (s < 1e-15) return [0, 0, 0];
    const k = 2 * Math.atan2(s, q[0]) / dt / s;
    return [q[1] * k, q[2] * k, q[3] * k];
}
const speed = w => Math.hypot(...w) * CM_YR_PER_RAD_MYR;
const pole = w => { const m = Math.hypot(...w); return m < 1e-12 ? null : xyzToLatLon(w[0] / m, w[1] / m, w[2] / m); };
const poleSep = (a, b) => { const m = Math.hypot(...a) * Math.hypot(...b); return m < 1e-24 ? NaN : Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / m))) * 180 / Math.PI; };

const mesh = labMesh(CELLS), rot = loadMullerRotations(), earthShare = 1 / 100;
for (const t0 of T0S) {
    const inputs = await loadStartInputs(mesh, t0), { world, start } = buildEarthStart(mesh, 12345, inputs), cfg = world.config;
    // (lastDt = ∞-ish makes the relaxation blend 1: the balance's target, not a first step from rest)
    simulate(world, { untilMyr: 0, events: false, drive: w => { w.lastDt = 1e9; updatePlateMotion(w); } });
    const earthOmega = id => omegaOf(quatMul(rot.total(id, t0 - 0.5 < 0 ? 0 : t0 - 0.5), quatConj(rot.total(id, t0 + 0.5))), t0 < 0.5 ? 0.5 : 1);
    section(`Static force test, Earth at ${t0} Ma, ${CELLS / 1000}K cells (report-only; tunes nothing)`);
    console.log(`caps: continental ${cfg.maxSpeedContinental}, oceanic ${cfg.maxSpeedOceanic} cm/yr; softened at ${cfg.continentalSoftCmYr} / ${cfg.oceanicSoftCmYr}`);
    console.log('plate            area%   Earth cm/yr  pole(lat,lon)      model cm/yr  pole(lat,lon)     pole Δ°  ×Earth  cap');
    let sumSq = 0, nCells = 0, capped = [], rows = [];
    for (const plate of world.plates) {
        const id = start.idOfPlate[plate.id], we = earthOmega(id), wm = plate.omega, n = plate.crust.count;
        // velocity difference over the plate's cells (cells have equal area)
        for (let c = 0; c < mesh.numCells; c++) if (plate.crust.mask[c]) {
            const x = mesh.xyz[3 * c], y = mesh.xyz[3 * c + 1], z = mesh.xyz[3 * c + 2], d = [wm[0] - we[0], wm[1] - we[1], wm[2] - we[2]];
            sumSq += (d[1] * z - d[2] * y) ** 2 + (d[2] * x - d[0] * z) ** 2 + (d[0] * y - d[1] * x) ** 2; nCells++;
        }
        const cont = keeled(plate, cfg), hard = cont ? cfg.maxSpeedContinental : cfg.maxSpeedOceanic, soft = cont ? cfg.continentalSoftCmYr : cfg.oceanicSoftCmYr;
        // (the soft limit bends ω smoothly toward `soft` long before the hard cap: ≥ 85 % of it means the force balance was pushing past it)
        const isCapped = !!plate.dynamics?.capped, nearSoft = speed(wm) >= 0.85 * soft && soft > 0;
        if ((isCapped || nearSoft) && n >= 4) capped.push(`${NAMES[id] ?? id} (${n} cells, ${speed(wm).toFixed(1)} cm/yr, ${isCapped ? 'hard cap ' + hard : 'soft limit ' + soft})`);
        if (n / mesh.numCells >= earthShare) rows.push({ id, share: 100 * n / mesh.numCells, se: speed(we), sm: speed(wm), pe: pole(we), pm: pole(wm), sep: poleSep(we, wm), isCapped: isCapped || nearSoft, hard: isCapped });
    }
    for (const r of rows.sort((a, b) => b.share - a.share)) {
        const p = q => q ? `${q.lat.toFixed(0).padStart(4)},${q.lon.toFixed(0).padStart(5)}` : '   —      ';
        console.log(`${(NAMES[r.id] ?? String(r.id)).padEnd(16)} ${r.share.toFixed(1).padStart(5)}  ${r.se.toFixed(1).padStart(10)}   ${p(r.pe)}      ${r.sm.toFixed(1).padStart(10)}   ${p(r.pm)}     ${r.sep.toFixed(0).padStart(6)}  ${(r.sm / r.se).toFixed(2).padStart(6)}  ${r.hard ? 'CAP' : r.isCapped ? 'soft' : ''}`);
    }
    report(`area-weighted RMS velocity difference, Earth ${t0} Ma`, Math.sqrt(sumSq / nCells) * CM_YR_PER_RAD_MYR, { unit: ' cm/yr', source: 'report-only baseline; no Earth range — the comparison is the number' });
    report(`plates ≥ 1 % of Earth at a cap or soft limit, ${t0} Ma`, rows.filter(r => r.isCapped).length, { source: `all at a limit (≥ 4 cells): ${capped.join('; ') || 'none'}` });
    check(`every plate got a finite ω`, world.plates.every(p => p.omega.every(Number.isFinite)));
}
finish();
