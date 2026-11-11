// The stress field in the history (lane pstress): every plateStressEveryMyr the plates' stress is solved
// (field/plate-stress-field.js), held against the strength of the rock it is in, and where it beats it the lithosphere breaks:
// a record on the crust raster (crust.damage, 0–1) that moves with its plate and heals after. No strength reads it (lane
// riftstrength, below): it is where the field yielded, for the reports.
//
//   strength T_y = T_rock × (old weak line: riftWeaknessCost)                                     (N/m, vertically integrated)
//     T_rock: old ocean plateYieldOcean × √(age ÷ plateYieldOceanAgeMyr) (to 1; half-space cooling thickens it); continent
//       plateYieldContinent × heat H(h, its crust, its lithosphere: a craton's keel) × magma (÷ magmaWeakening on a fresh LIP)
//   breaks in tension where s1 > T_y, in compression where −s2 > plateYieldCompression × T_y
//   broken: D = 1; after, D falls as e^(−t ÷ plateDamageHealMyr)
//   with plateStressRifts, continental crust broken in tension is also logged as stretched: a RIFT record with no work
//     (crust.recordOrogeny), the diffuse extension of a wide rift (Basin and Range) beside the narrow rifts rifting.js cuts.
//     Only on crust with no record or a rift's: a pull across a belt still shortening must not refresh the belt's clock
//     (recordOrogeny keeps a belt's type against a rift's but times it), and a quiet belt relabelled a rift would keep its
//     relief 4.5× as long (step/heights.js wears a rift's uplift on riftReliefTauMyr, an escarpment's) — the opposite of
//     an orogen's collapse. (Measured 2026-11-02: allowing quiet belts, ~9 of the ~20 points it added at 5e12 were relabels.)
//
// The continent's strength law (lane riftstrength, L2 of the rift program, 2026-11-10; every factor sourced in config.js):
//   - plateYieldContinent 1e13: Buck 1991's integrated strength (his figure, reproduced as Hopper & Buck 1993 Fig. 1) of a
//     ~40 km crust at ~65 mW/m², Earth's average continent — the strength of continent over mantle no continent has warmed;
//   - heat H(h): h = world.mantleHeat (0…1, the insulation a continent built under itself, step/hotspots.js). A mantle
//     warmed ΔT = h × plateHeatWarmK (Coltice et al. 2007: up to 100 °C under a supercontinent) is less viscous, so the
//     thermal boundary layer under the lid thins (δ ∝ η^⅓, boundary-layer theory) and the mantle heat flow rises:
//       q = qRef + qMantle × [(1 + ΔT ÷ ΔT_lid) × exp(E ÷ 3R × (1/T_m − 1/(T_m + ΔT))) − 1]
//     and the strength falls along Buck's curve at the cell's own crust thickness (between his 30 and 50 km curves, in ln),
//     H = B(q, km) ÷ B(qRef, plateCrustRefKm 40). At 40 km H is 1 → ~0.30 from h 0 → 1 (×2.3 weaker at the land's median h
//     0.62); a 50 km crust (an orogen's) keeps ×0.45 of a 40 km one's at qRef, 30 km (thinned) ×2.2;
//   - magma: crust a plume head's flood basalt covered (volcType LIP) within magmaWeakMyr of its eruption is ÷ magmaWeakening
//     weaker: dikes open at a force an order of magnitude below the one tectonic faulting needs (Bialas, Buck & Qin 2010);
//   - inherited lines (SUTURE, FAILED_RIFT, RIFT_MARGIN: crust a collision, a failed arm or a stage strained) × riftWeaknessCost:
//     strain softening, the friction and cohesion of a zone that took strain halving (Naliboff et al. 2017) on its brittle share.
// Exceedance damage (D = 1 wherever s1 once beat T_y, keeping 0.17 of the strength for ~300 Myr) is no longer in the strength:
// a cell that yielded once kept winning, and at the declared 3e12 that shattered (lane riftprobe2: ×2–3 the winning bands).
// Its limits: H is quasi-static (the boundary layer is taken as thinned as soon as the mantle warms; it lags by its
// diffusion time, tens of Myr, which the insulation's own ~100 Myr ramp mostly covers); Buck's curve is one strain rate and two
// crust thicknesses (a thinner or thicker crust is held at the nearer one); magma weakens only under a head's LIP, not along a tail; the
// inherited lines do not heal (Bercovici & Ricard 2014: weak zones outlast a Wilson cycle).
//
// Reduced model, and its limits: the plate stays rigid however broken it is (the stress is the rigid plate's: what it would
// carry, not what a broken plate passes on — the stress-field study's sheet was the deforming version, at ~10× the cost);
// damage is a yes/no break, not slip that accumulates (a rigid plate has no strain to measure slip by), so it is a record only.

import { CrustType, CrustFlag, OrogenyType, VolcanicType } from '../model/crust.js';
import { solvePlateStress, stressAt } from './plate-stress-field.js';
import { crustThicknessKm } from '../measure.js';
import { heightsOf } from '../step/heights.js';
import { arcCrustKm } from '../step/collision.js';

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

// Buck 1991's force to rift the lithosphere (10¹² N/m) against surface heat flow (mW/m²), read off his figure as Hopper & Buck
// 1993 reproduce it (Fig. 1: 30 and 50 km crust, digitized 2026-11-10, lane riftstrength). Its second axis is the crust's
// thickness: a thicker crust puts more of the column in weak quartz-feldspar rock and warms its own Moho, so 50 km of crust is
// ~5× weaker than 30 at 65 mW/m² (Buck 1991: thickened orogenic crust is where wide rifts and core complexes form). Between
// the two the strength is interpolated in ln B against the thickness; outside them it is held at the nearer curve (the figure
// says nothing past them: a 70 km plateau is taken as weak as 50 km, a stretched 20 km margin as strong as 30).
const BUCK_Q = [44, 50, 56, 60, 66, 70, 76, 80, 86, 90, 96, 100, 106];
const BUCK_30KM = [58.3, 42.0, 30.4, 25.4, 18.9, 15.5, 11.6, 9.4, 7.1, 5.8, 3.9, 2.8, 1.5];
const BUCK_50KM = [35.5, 21.7, 11.9, 7.3, 3.4, 2.5, 1.6, 1.5, 1.3, 1.2, 0.9, 0.8, 0.7];
const BUCK_KM = [30, 50];
/** ln B(q, crust km): Buck's curves interpolated in ln, in heat flow and in crust thickness (each clamped to the figure). */
function lnBuck(q, km) {
    const at = curve => {
        if (q <= BUCK_Q[0]) return Math.log(curve[0]);
        for (let i = 1; i < BUCK_Q.length; i++) if (q <= BUCK_Q[i]) { const f = (q - BUCK_Q[i - 1]) / (BUCK_Q[i] - BUCK_Q[i - 1]); return (1 - f) * Math.log(curve[i - 1]) + f * Math.log(curve[i]); }
        return Math.log(curve[curve.length - 1]);
    };
    const f = Math.max(0, Math.min(1, (km - BUCK_KM[0]) / (BUCK_KM[1] - BUCK_KM[0])));
    return (1 - f) * at(BUCK_30KM) + f * at(BUCK_50KM);
}
/** The heat-flow rise under mantle warmed by h of full insulation (mW/m²): the boundary layer thinned as η^⅓. */
export function heatFlowRise(h, config) {
    const dT = h * config.plateHeatWarmK, T = config.plateHeatMantleK, eR = config.plateHeatCreepKJ * 1e3 / (3 * 8.314);
    return config.plateHeatMantleFlow * ((1 + dT / config.plateHeatLidK) * Math.exp(eR * (1 / T - 1 / (T + dT))) - 1);
}
const HEAT_STEPS = 64, KM_STEPS = 20;           // (h by 1/64; crust by 1 km across the figure's 30–50)
const heatTables = new Map();                   // (one table per lithosphere: ordinary continent's and a craton's)
let heatKey = '';
/**
 * The share of plateYieldContinent a continent of `km` crust on `lithKm` of lithosphere keeps over mantle warmed by h (0…1),
 * along Buck's curves: B(q(h, lithKm), km) ÷ B(qRef, plateCrustRefKm). (km omitted: the reference crust; lithKm omitted:
 * the reference lithosphere, the column model's riftLithKm — i.e. the heat weakening alone.)
 *
 * The lithosphere (lane cratoncol): the mantle's share of the surface heat flow is conducted up through the lid, so it falls
 * as 1 ÷ its thickness (steady conduction, q = k ΔT ÷ L): q = (qRef − qMantle) + (qMantle + Δq(h)) × riftLithKm ÷ lithKm.
 * A craton's 250 km keel (cratonLithKm) halves it: 42.5 mW/m² at rest — Archean provinces average 41 ± 11 (Nyblade &
 * Pollack 1993 via Rudnick et al. 1998; 41, Michaut, Jaupart & Mareschal 2009, Lithos 109) — and only half of a swell's rise
 * reaches its surface. (The split is the model's, not a craton's: Earth's cratons take 12–17 of it from the mantle, Jaupart &
 * Mareschal 1999, and more from their crust; the sum is what Buck's curve reads.) Below the figure's 44 mW/m² it is held at 44.
 */
export function heatWeakening(h, config, km = config.plateCrustRefKm, lithKm = heightsOf(config).riftLithKm) {
    const key = `${config.plateHeatWarmK},${config.plateHeatMantleK},${config.plateHeatCreepKJ},${config.plateHeatMantleFlow},${config.plateHeatLidK},${config.plateHeatFlowRef},${config.plateCrustRefKm},${heightsOf(config).riftLithKm}`;
    if (key !== heatKey) { heatKey = key; heatTables.clear(); }
    let heatTable = heatTables.get(lithKm);
    if (!heatTable) {
        heatTable = new Float64Array((HEAT_STEPS + 1) * (KM_STEPS + 1));
        heatTables.set(lithKm, heatTable);
        const q0 = config.plateHeatFlowRef, b0 = lnBuck(q0, config.plateCrustRefKm), qm = config.plateHeatMantleFlow, thin = heightsOf(config).riftLithKm / lithKm;
        for (let i = 0; i <= HEAT_STEPS; i++) {
            const rise = heatFlowRise(i / HEAT_STEPS, config), q = thin === 1 ? q0 + rise : q0 - qm + (qm + rise) * thin;
            for (let j = 0; j <= KM_STEPS; j++) heatTable[i * (KM_STEPS + 1) + j] = lnBuck(q, BUCK_KM[0] + (BUCK_KM[1] - BUCK_KM[0]) * j / KM_STEPS) - b0;
        }
    }
    const x = Math.max(0, Math.min(1, h)) * HEAT_STEPS, i = Math.min(HEAT_STEPS - 1, Math.floor(x)), fx = x - i;
    const y = Math.max(0, Math.min(1, (km - BUCK_KM[0]) / (BUCK_KM[1] - BUCK_KM[0]))) * KM_STEPS, j = Math.min(KM_STEPS - 1, Math.floor(y)), fy = y - j;
    const K = KM_STEPS + 1, a = heatTable[i * K + j], b = heatTable[i * K + j + 1], c = heatTable[(i + 1) * K + j], d = heatTable[(i + 1) * K + j + 1];
    return Math.exp((1 - fx) * ((1 - fy) * a + fy * b) + fx * ((1 - fy) * c + fy * d));
}
/** The lithosphere under a continental cell (km): the column model's (step/measure.js columnModel) — a craton's keel or ordinary continent's. */
export function lithKmOf(type, config) { const H = heightsOf(config); return type === CrustType.CRATON ? H.cratonLithKm : H.riftLithKm; }
/**
 * How many times as hard to break a craton is as ordinary continent, each column as formed (cratonCrustKm on cratonLithKm,
 * riftCrustKm on riftLithKm) over mantle no continent has warmed: ~3.5 by default (Buck's curves; was the constant 6). For
 * the processes that weigh a craton against ordinary ground without a stress field of their own (step/orogeny.js a belt's reach
 * into a shield, step/backarc.js a strip's break line, ops/rift-path.js a failed arm).
 */
export function cratonStrengthRatio(config) {
    const H = heightsOf(config);
    return heatWeakening(0, config, H.cratonCrustKm, H.cratonLithKm) / heatWeakening(0, config, H.riftCrustKm, H.riftLithKm);
}
/** The crust's thickness at raster cell c (km): a continent's as formed, thickened or thinned, with the crust its relief stands for. */
function crustKmAt(crust, c, time, config) {
    const t = crust.type[c];
    if (t === CrustType.ARC) return arcCrustKm(crust, c, time, config) + crust.rootKm[c];
    return crustThicknessKm(heightsOf(config), t, crust.rootKm[c], crust.upliftKm[c], crust.baseKm[c]);
}

/** The rock's strength at raster cell c of a plate (N/m), over mantle heat h (world.mantleHeat at its world cell, 0…1). */
export function rockStrength(crust, c, time, config, h = 0) {
    const t = crust.type[c];
    let T;
    if (t === CrustType.OCEAN) T = config.plateYieldOcean * Math.max(config.plateYieldOceanFloor, Math.min(1, Math.sqrt(Math.max(0, time - crust.formedAt[c]) / config.plateYieldOceanAgeMyr)));
    else {
        T = config.plateYieldContinent * heatWeakening(h, config, config.plateStrengthCrust ? crustKmAt(crust, c, time, config) : config.plateCrustRefKm, lithKmOf(t, config));
        if (crust.volcType[c] === VolcanicType.LIP && time - crust.volcAt[c] <= config.magmaWeakMyr) T /= config.magmaWeakening;
    }
    if (crust.flags[c] & WEAK) T *= config.riftWeaknessCost;
    return T;
}

/** The strength a stress is held against (damage is a record only: lane riftstrength). */
export function strengthOf(crust, c, time, config, h = 0) { return rockStrength(crust, c, time, config, h); }

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
        const crust = plates[o].crust, c = ownerCell[w], T = strengthOf(crust, c, time, config, world.mantleHeat[w]), isLand = crust.type[c] !== CrustType.OCEAN;
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
