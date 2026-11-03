// The stress field in the history (lane pstress): every plateStressEveryMyr the plates' stress is solved
// (field/plate-stress-field.js), held against the strength of the rock it is in, and where it beats it the lithosphere breaks:
// damage, a record on the crust raster (crust.damage, 0–1) that moves with its plate and heals after.
//
//   strength T_y = T_rock × (old weak line: riftWeaknessCost) × (1 − (1 − φ) D)                 (N/m, vertically integrated)
//     T_rock: old ocean plateYieldOcean × √(age ÷ plateYieldOceanAgeMyr) (to 1; half-space cooling thickens it), ordinary
//     continent plateYieldContinent, a craton × cratonStrength
//   breaks in tension where s1 > T_y, in compression where −s2 > plateYieldCompression × T_y
//   broken: D = 1; after, D falls as e^(−t ÷ plateDamageHealMyr)
//   with plateStressRifts, continental crust broken in tension is also logged as stretched: a RIFT record with no work
//     (crust.recordOrogeny), the diffuse extension of a wide rift (Basin and Range) beside the narrow rifts rifting.js cuts.
//     Only on crust with no record or a rift's: a pull across a belt still shortening must not refresh the belt's clock
//     (recordOrogeny keeps a belt's type against a rift's but times it), and a quiet belt relabelled a rift would keep its
//     relief 4.5× as long (step/heights.js wears a rift's uplift on riftReliefTauMyr, an escarpment's) — the opposite of
//     an orogen's collapse. (Measured 2026-11-02: allowing quiet belts, ~9 of the ~20 points it added at 5e12 were relabels.)
//
// Reduced model, and its limits: the plate stays rigid however broken it is (the stress is the rigid plate's: what it would
// carry, not what a broken plate passes on — the stress-field study's sheet was the deforming version, at ~10× the cost);
// damage is a yes/no break, not slip that accumulates (a rigid plate has no strain to measure slip by); the strength of
// continental lithosphere has no sourced figure (below), so the share that breaks is a finding at a declared strength, not a
// calibration (the plate force paradox: lane emerge, 2026-11-01).

import { CrustType, CrustFlag, OrogenyType } from '../model/crust.js';
import { solvePlateStress, stressAt } from './plate-stress-field.js';

const WEAK = CrustFlag.SUTURE | CrustFlag.FAILED_RIFT | CrustFlag.RIFT_MARGIN;

/** One step of the history's clock. @returns {number} 0 (records only: no crust moves) */
export function stepPlateStress(world, dt) {
    const { config } = world;
    if (!config.plateStress || !world.loads) return 0;
    // (on the step that lands on each multiple of plateStressEveryMyr — steps never cross the step grid, of which it is a multiple:
    // so the solves fall on the frames' moments — and at the first step)
    const every = config.plateStressEveryMyr, k = Math.round(world.time / every), last = world.stressAt;
    if (last !== undefined && !(Math.abs(world.time - k * every) < 1e-6 && k * every > last + 1e-6)) return 0;
    const span = last === undefined ? 0 : world.time - last;
    world.stressAt = world.time;
    const t0 = performance.now(), solved = solvePlateStress(world);
    if (!solved) return 0;
    const out = breakAndHeal(world, span);
    (world.stressLog ??= []).push({ time: world.time, ms: performance.now() - t0, ...solved, ...out });
    return 0;
}

/** The rock's strength at raster cell c of a plate (N/m), undamaged. */
export function rockStrength(crust, c, time, config) {
    const t = crust.type[c];
    let T = t === CrustType.OCEAN ? config.plateYieldOcean * Math.max(config.plateYieldOceanFloor, Math.min(1, Math.sqrt(Math.max(0, time - crust.formedAt[c]) / config.plateYieldOceanAgeMyr)))
        : t === CrustType.CRATON ? config.plateYieldContinent * config.cratonStrength : config.plateYieldContinent;
    if (crust.flags[c] & WEAK) T *= config.riftWeaknessCost;
    return T;
}

/** The strength with its damage. */
export function strengthOf(crust, c, time, config) { return rockStrength(crust, c, time, config) * (1 - (1 - config.plateDamageKeep) * crust.damage[c]); }

/** Heal every plate's damage over `span` Myr, then break where the stress now beats the strength. @returns shares of the
 *  plates' area breaking in tension and in compression (of all, and of continental crust), and damage's mean */
function breakAndHeal(world, span) {
    const { plates, config, owner, ownerCell, time, mesh } = world, heal = Math.exp(-span / config.plateDamageHealMyr);
    for (const p of plates) if (p.alive && !p.isBackground) { const D = p.crust.damage; for (let c = 0; c < D.length; c++) if (D[c]) D[c] *= heal; }
    const s = { s1: 0, s2: 0, dir: [0, 0, 0] };
    let n = 0, ten = 0, com = 0, land = 0, landTen = 0, landCom = 0, dSum = 0, stretched = 0;
    const stretch = !!config.plateStressRifts;
    for (let w = 0; w < mesh.numCells; w++) {
        const o = owner[w];
        if (o < 0 || plates[o].isBackground || !stressAt(world, w, s)) continue;
        const crust = plates[o].crust, c = ownerCell[w], T = strengthOf(crust, c, time, config), isLand = crust.type[c] !== CrustType.OCEAN;
        n++; if (isLand) land++;
        if (s.s1 > T) {
            crust.damage[c] = 1; ten++;
            if (isLand) {
                landTen++;
                if (stretch && crust.type[c] !== CrustType.ARC && (crust.oroType[c] === OrogenyType.NONE || crust.oroType[c] === OrogenyType.RIFT)) {
                    crust.recordOrogeny(c, OrogenyType.RIFT, 0, time, config.orogenyQuietMyr); stretched++;
                }
            }
        }
        else if (-s.s2 > config.plateYieldCompression * T) { crust.damage[c] = 1; com++; if (isLand) landCom++; }
        dSum += crust.damage[c];
    }
    return { tension: ten / Math.max(1, n), compression: com / Math.max(1, n), landTension: landTen / Math.max(1, land), landCompression: landCom / Math.max(1, land), landStretched: stretched / Math.max(1, land), damage: dSum / Math.max(1, n) };
}
