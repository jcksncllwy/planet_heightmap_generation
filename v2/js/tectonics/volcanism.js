// Volcanism as fluxes (lane volcano; design: lanes-2026-10-29/volcano/report.md). The history already places its volcanoes —
// arcs (step/wings.js), plume tracks and flood basalts (step/hotspots.js), the ridges — but keeps no RATES: how much magma
// each setting makes in a frame, what share of it erupts, the gas it gives off, which centres are live and which of them
// can blow a caldera. This reads all of that off a frame (and the one before it) and never writes to the world: a records
// pass, like step/geology.js, so the history is the same with it or without it (its hash, every gate).
//
//   · volcStep(prev, frame, mesh, H)       one frame's record: magma and erupted km³/Myr by setting, gas Mt/yr, its LIPs
//                                           (volume, pulses, sills, thermogenic CO₂), its live volcanic centres (sites)
//   · riftMeltKm(β, ΔT)                     decompression melt under a stretched rift (McKenzie & Bickle 1988)
//   · recentEruptions(volc, seed, kyr, …)   a finished moment's eruptions over the last `kyr`, seeded, by VEI (detail pass)
//
// The magma by setting (km³/Myr, intrusive + extrusive):
//   ridge   new ocean floor (budget.created) × the melt column a normal mantle makes, 7 km (White, McKenzie & O'Nions 1992)
//   arc     the history's own arc magma book, budget.arcAddedKm3 (step/wings.js): the crust the arcs GAINED — Earth's net
//           growth figure (1.1–1.65 km³/yr, Reymer & Schubert 1984), not the gross melt (2.5–8; ~⅔ founders as cumulates,
//           Jagoutz & Kelemen 2015). `arcGross` scales it for gas (Jackson's ruling pending: report Q1; default 1)
//   plume   each live tail × its strength × Earth's mean tail (~1.5 km³/yr of oceanic-intraplate magma, ~5 % of Crisp's
//           26–34 km³/yr, over Sleep's ~45 hotspots)
//   rift    decompression melting under freshly stretched continent: riftThin (1 − 1/β) and the mantle's excess heat
//           (mantleHeat × 100 K, a plume within PLUME_REACH_KM up to +150 K × strength) — nothing tells a rift to erupt;
//           cold-mantle rifts stay dry (Iberia), hot ones flood (Afar)
//   lip     a plume head's flood basalt (the `lip` event): the volcKm the history piled over its cells, and as much again
//           intruded (I:E ~1 for flood basalts, White et al. 2006) — the model's own volume, ~2–3× Earth's per area (Q5: kept, flagged)
//
// What this skips (limits of a reduced model, tier 2 unless marked):
//   · A rift cell stretched over several frames is credited its whole melt H(β) in each, not the increment (a frame pair
//     cannot match crust cells cheaply: they ride their plates). Overcounts by at most the frames a rift stage lasts (1–2).
//     Exit: a riftThinPrev on the stretch record (a history field).
//   · The arc book's rate is the history's; nothing here reads convergence or slab age, though Earth's arc magma barely
//     tracks convergence anyway (Jicha & Jagoutz 2015). budget.trenchKmMyr undercounts Earth's trench length ~4–5×, so it
//     is not used.
//   · Silicic centres and VEI caps by setting are rules (tier 3) on the frame's crust and margins, after Jellinek & DePaolo
//     2003 and de Silva 2008 (big chambers need a big flux into warm, thick crust). Exit: a crustal-heat budget per centre.
//   · No subducted carbonate, no metamorphic CO₂ (the carbon box's: atmosphere A6), no tephra record in the rock column.

import { CrustType, VolcanicType, OrogenyType } from './model/crust.js';
import { BoundaryKind } from './model/world.js';
import { decodeFacies, decodeCoverKm, decodeArcMyr } from './model/geology.js';
import { crustThicknessKm } from './measure.js';
import { makeRng } from '../../../js/rng.js';

const R = 6371;
/** Melt density, t/m³ = 10¹² kg per km³ ÷ 10³: 1 km³ of melt is 2.8 × 10¹² kg, and 1 wt % of it 28 Mt. */
const MELT_T_M3 = 2.8;
/** Oceanic crust: the melt column of a normal mantle (T_p ≈ 1315 °C), 7.1 ± 0.8 km (White, McKenzie & O'Nions 1992). */
export const RIDGE_MELT_KM = 7;
/** Earth's mean plume tail, km³/yr of magma per unit strength (hotspots.js strength 0.6–1.4, mean 1): Crisp 1984's
 *  oceanic-intraplate share (~5 % of 26–34 km³/yr ≈ 1.5) over Sleep 1990's ~45 hotspots. Hawaii (~0.2, Robinson & Eakins
 *  2006) is the strongest, ~6× the mean — the model's strengths span only 2.3×, so its strongest tails run under Hawaii. */
export const PLUME_KM3_YR = 0.033;
/** A flood basalt's intruded share, as a multiple of what erupted (I:E ≈ 1 for LIPs, the low end of White et al. 2006). */
const LIP_IE = 1;
/** The history's flood-basalt pile (lipThicknessKm 2, over the whole province) against Earth's mean lava thickness over a
 *  province's original extent, ~0.5–1 km (Deccan ~1 Mkm³ over ~1.5 Mkm²; Siberia ~1–2 Mkm³ of lavas over ~2.5–4 Mkm²). */
export const LIP_EARTH_SCALE = 0.4;
/** Intrusive : extrusive, by setting (White, Crisp & Spera 2006: ~5:1 on average, 1:1–16:1, no trend with setting;
 *  ridges 18:3 km³/yr in Crisp 1984; basaltic shields 1–2:1; the Kenya Rift ~310 000 km³ erupted of ~924 000 with its
 *  underplate, Guth 2016 / Latin et al. 1993). */
export const IE = Object.freeze({ ridge: 6, arc: 5, plume: 2, rift: 5, lip: LIP_IE });
/** Degassed share of the melt, wt % (sources in the report §3). CO₂, H₂O and Cl degas from all the magma (they exsolve at
 *  depth, intrusions included); S mostly from what erupts (SO₂ = 2 × S by mass). Ridge gas goes to the ocean. */
export const YIELD = Object.freeze({
    ridge: { co2: 0.15, h2o: 0.2, s: 0.1, cl: 0.01 },   // Saal et al. 2002 (undegassed MORB 0.05–0.15 wt % CO₂)
    arc: { co2: 0.6, h2o: 4, s: 0.2, cl: 0.15 },        // Plank et al. 2013 (H₂O 3.9); Wallace 2005 (S, Cl); Blundy et al. 2010 (CO₂ to ~0.9)
    plume: { co2: 0.7, h2o: 0.5, s: 0.13, cl: 0.03 },   // Gerlach et al. 2002 (Kīlauea primary CO₂ 0.70 wt %)
    rift: { co2: 1.5, h2o: 1, s: 0.1, cl: 0.1 },        // alkaline–carbonatite melts; Lee et al. 2016 (East African Rift diffuse CO₂, arc-like per km)
    lip: { co2: 0.5, h2o: 0.5, s: 0.165, cl: 0.03 },    // Self et al. 2006; Thordarson & Self 1996 (Roza 1300 km³ → 12 000 Tg SO₂: S 0.165 wt %)
});
/** Thermogenic CO₂ from sill aureoles in organic-rich host rock, t per m² of intruded basin (Svensen et al. 2018: 52–80),
 *  one sill level whose aureoles cover the basin (declared). Carbonate host rock gives CARB_SHARE of it (Ganino & Arndt
 *  2009, verify). Sills need a basin: cover at least SILL_COVER_KM thick (Svensen et al. 2009, Tunguska 3–12 km). */
export const THERMO_T_M2 = 66, THERMO_CARB_SHARE = 0.3, SILL_COVER_KM = 1;
/** Mantle excess temperature, K: fully insulated mantle (mantleHeat 1) +100 (Coltice et al. 2007); a plume within
 *  PLUME_REACH_KM up to +150 × strength, fading linearly with distance (Iceland, Afar ~+150–200; White & McKenzie 1989). */
const INSULATION_K = 100, PLUME_K = 150, PLUME_REACH_KM = 1000;
/** Thermal lithosphere before stretching (McKenzie & Bickle 1988), km. */
const LITH_KM = 125;
/** How long a margin stays a live arc after its belt last grew (Myr): the frame window's worth. */
const ARC_LIVE_MYR = 10;

/**
 * Melt under a rift stretched by β over mantle ΔT kelvin hotter than normal, km of melt column (McKenzie & Bickle 1988;
 * White & McKenzie 1989, Fig. 5, reduced): upwelling mantle crosses the solidus at z_s and melts up to the thinned
 * lithosphere's base a/β; the melt fraction grows about linearly with the decompression, so the column as its square.
 * H∞(ΔT) is the full column of a ridge on that mantle: 7 km × (1 + ΔT/80 K) — ~16 km at +100 K (about doubled: White &
 * McKenzie 1995), ~22 at +175 K (Iceland's 20–25 km at ~+150–200 K; a square law gave 42 km there, check-volcano).
 * z_s = 60 km + 0.3 km/K × ΔT: the dry solidus (~3.3 K/km) against the adiabat (~0.5 K/km).
 */
export function riftMeltKm(beta, dT) {
    if (!(beta > 1)) return 0;
    const t = Math.max(0, dT), zs = 60 + 0.3 * t, Hinf = RIDGE_MELT_KM * (1 + t / 80), d = zs - LITH_KM / beta;
    return d > 0 ? Hinf * (d / zs) ** 2 : 0;
}

/** Mt/yr of a species from km³/Myr of melt at `wt` %. */
const mtYr = (km3Myr, wt) => km3Myr * MELT_T_M3 * 1e-5 * wt;   // (km³/Myr × 2.8 × 10¹² kg × wt/100 ÷ 10⁹ kg/Mt ÷ 10⁶ yr: 1 km³/yr at 1 wt % = 28 Mt/yr)

/** A 32-bit hash of a string, for seeding a stream per named thing (FNV-1a). */
function hashStr(s, h = 2166136261) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/**
 * A flood basalt's eruption, inside its frame (ecodesign's kill score, the box's pulse run, the volcanic winters): seeded
 * per province, independent of every history stream. Duration 0.3–1 Myr log-uniform (Burgess & Bowring 2015: Siberia's
 * main phase < 1 Myr; Schoene et al. 2019, Sprain et al. 2019: the Deccan in ~1 Myr); 2–5 pulses (Deccan 4); flow fields of
 * 10³–10⁴ km³ log-uniform (Self et al. 2006; Roza 1300 km³), each erupting over 10–50 yr: the peak rate.
 */
export function lipPulses(seed, name, volKm3) {
    const r = makeRng((hashStr(name) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0);
    const durMyr = 0.3 * (1 / 0.3) ** r(), pulses = 2 + Math.floor(r() * 4);
    const flowKm3 = 1e3 * 10 ** r(), flowYr = 10 + 40 * r();
    return { durMyr, pulses, flowKm3, flows: Math.max(1, Math.round(volKm3 / flowKm3)), peakKm3yr: flowKm3 / flowYr,
        so2PerFlowTg: flowKm3 * MELT_T_M3 * 1e3 * 2 * YIELD.lip.s / 100 };   // (Tg: km³ × 2.8 × 10³ Tg/km³ × SO₂ share)
}

/**
 * One frame's volcanism. `prev` is the frame before (its books give the window's rates); `H` the terrain constants
 * (terrainConfig: the column model's crust thicknesses). @returns the `volc` record (report §2)
 */
export function volcStep(prev, frame, mesh, H, { seed = 0, arcGross = 1 } = {}) {
    const { numCells: n, xyz } = mesh, cellKm2 = mesh.cellAreaKm2 ?? 4 * Math.PI * R * R / n, t = frame.time;
    const dt = prev ? Math.max(1e-6, t - prev.time) : 10, t0 = t - dt;
    const B = frame.budget ?? {}, P = prev?.budget ?? {};
    const magma = { ridge: 0, arc: 0, plume: 0, rift: 0, lip: 0 };
    magma.ridge = prev ? Math.max(0, (B.created ?? 0) - (P.created ?? 0)) * cellKm2 * RIDGE_MELT_KM / dt : 0;
    magma.arc = prev ? Math.max(0, (B.arcAddedKm3 ?? 0) - (P.arcAddedKm3 ?? 0)) / dt : 0;
    const hs = frame.hotspots ?? [];
    for (const h of hs) magma.plume += h.strength * PLUME_KM3_YR * 1e6;

    // ── the mantle's excess heat at a cell: insulation, and a plume near it ──
    const plumeCos = Math.cos(PLUME_REACH_KM / R);
    const excessK = w => {
        let k = INSULATION_K * (frame.mantleHeat ? frame.mantleHeat[w] / 255 : 0), best = 0;
        const x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2];
        for (const h of hs) {
            const c = x * h.xyz[0] + y * h.xyz[1] + z * h.xyz[2];
            if (c > plumeCos) best = Math.max(best, PLUME_K * h.strength * (1 - R * Math.acos(Math.min(1, c)) / PLUME_REACH_KM));
        }
        return k + best;
    };
    const crustKm = w => crustThicknessKm(H, frame.type[w], frame.rootKm[w], frame.upliftKm[w], frame.baseKm[w]);
    const continental = w => frame.owner[w] >= 0 && (frame.type[w] === CrustType.CONTINENT || frame.type[w] === CrustType.CRATON);

    // ── rifts: decompression melt under the crust stretched in this window ──
    const sites = [];
    for (let w = 0; w < n; w++) {
        if (!(frame.riftThin[w] > 0) || !(frame.riftThinAt[w] > t0) || frame.type[w] === CrustType.OCEAN || frame.owner[w] < 0) continue;
        const beta = 1 / Math.max(1e-3, 1 - frame.riftThin[w]), dK = excessK(w), Hm = riftMeltKm(beta, dK);
        if (!(Hm > 0)) continue;
        const km3Myr = Hm * cellKm2 / dt;
        magma.rift += km3Myr;
        // (a centre on crust still ≥ 25 km thick differentiates to peralkaline rhyolite — the Kenyan and Ethiopian rift
        // calderas, Menengai, Suswa, Corbetti: up to VEI 6; on thinner crust it stays basaltic, VEI ≤ 4. Hot mantle barely
        // melting — a column under 1 km — gives the low-degree, CO₂-rich melts: nephelinite and carbonatite, Oldoinyo
        // Lengai; Dasgupta & Hirschmann 2006: carbonated peridotite melts first, deepest)
        const thick = crustKm(w) >= 25;
        sites.push({ w, kind: 'rift', km3Myr, beta, dK, silicic: false, veiMax: thick ? 6 : 4, carbonatite: dK > 80 && Hm < 1 });
    }

    // ── flood basalts erupted in the window: their volume, pulses, sills and the gas their sills cook out of the cover ──
    const lips = [], fac = { carb: 0, salt: 0, coal: 0, organic: 0 };
    for (const e of frame.events ?? []) {
        if (e.kind !== 'lip' || !(e.time > t0 && e.time <= t)) continue;
        const src = e.data.hotspot + 1;
        let volKm3 = 0, sillKm2 = 0, coal = 0, organic = 0, salt = 0, carb = 0;
        for (let w = 0; w < n; w++) {
            if (frame.volcType[w] !== VolcanicType.LIP || frame.volcSource[w] !== src || !(frame.volcAt[w] > t0)) continue;
            volKm3 += frame.volcKm[w] * cellKm2;
            if (decodeCoverKm(frame.coverKm[w]) >= SILL_COVER_KM) {
                decodeFacies(frame.facies[w], fac);
                sillKm2 += cellKm2; coal += fac.coal * cellKm2; organic += fac.organic * cellKm2; salt += fac.salt * cellKm2; carb += fac.carb * cellKm2;
            }
        }
        const share = v => sillKm2 > 0 ? v / sillKm2 : 0, f = { coal: share(coal), organic: share(organic), salt: share(salt), carb: share(carb) };
        // (Gt CO₂: km² × 10⁶ m² × t/m² ÷ 10⁹)
        const thermoGtCO2 = sillKm2 * 1e6 * THERMO_T_M2 * (Math.min(1, f.coal + f.organic) + THERMO_CARB_SHARE * f.carb) / 1e9;
        const pul = lipPulses(seed, e.data.name, volKm3);
        magma.lip += volKm3 * (1 + LIP_IE) / dt;
        lips.push({ name: e.data.name, t: e.time, onLand: e.data.onLand, areaMkm2: e.data.areaMkm2, volKm3, overEarth: 1 / LIP_EARTH_SCALE,   // (the model's own volume, flagged ~2–3× Earth's per area: Jackson, Q5 — a LIP-volume lane is queued)
           
            ...pul, sillMkm2: sillKm2 / 1e6, facies: f, thermoGtCO2, haloTag: f.salt > 0.2 });
    }

    // ── live centres: arc and Andean fronts, plume tails; silicic where a big flux meets thick, warm crust ──
    // (the volcanic front only: a live arc or Andean belt cell on the upper plate of a subduction zone or next to one —
    // the belt itself runs hundreds of km inland, its volcanoes ~100–200 km from the trench, Syracuse & Abers 2006)
    const { adjOffset, adjList } = mesh, arcCells = [];
    const overriding = w => frame.boundary[w] === BoundaryKind.OVERRIDING;
    for (let w = 0; w < n; w++) {
        if (frame.owner[w] < 0) continue;
        const o = frame.oroType[w];
        if (!((o === OrogenyType.ARC || o === OrogenyType.ANDEAN) && frame.oroLast[w] > t - ARC_LIVE_MYR)) continue;
        let front = overriding(w);
        for (let k = adjOffset[w]; !front && k < adjOffset[w + 1]; k++) front = overriding(adjList[k]) && frame.owner[adjList[k]] === frame.owner[w];
        if (front) arcCells.push(w);
    }
    const perArc = arcCells.length ? magma.arc / arcCells.length : 0;
    for (const w of arcCells) {
        const cont = continental(w), km = crustKm(w), riftedArc = frame.riftThin[w] > 0 && frame.riftThinAt[w] > t0;
        // (thickened continental arcs — the Altiplano–Puna, La Garita — and rifted arcs — Taupō — reach M8; ordinary
        // continental arcs and mature island arcs VEI 7 — Tambora, on ~20 km of crust; young island arcs VEI 5)
        const veiMax = (cont && km >= 45) || riftedArc ? 8 : cont || decodeArcMyr(frame.arcMyr[w]) >= 20 ? 7 : 5;
        sites.push({ w, kind: cont ? 'andean' : 'arc', km3Myr: perArc, silicic: veiMax >= 7, veiMax, crustKm: km });
    }
    for (const h of hs) {
        let best = -1, bc = -2;
        for (let w = 0; w < n; w++) { const c = xyz[3 * w] * h.xyz[0] + xyz[3 * w + 1] * h.xyz[1] + xyz[3 * w + 2] * h.xyz[2]; if (c > bc) { bc = c; best = w; } }
        const cont = best >= 0 && continental(best);
        // (a plume under a continent stalls in its crust and makes a silicic caldera field — Yellowstone; on the sea floor a shield)
        sites.push({ w: best, kind: 'plume', km3Myr: h.strength * PLUME_KM3_YR * 1e6, hotspot: h.id, silicic: cont, veiMax: cont ? 8 : 4 });
    }

    const erupted = {}, gas = { co2: {}, so2: {}, h2o: {}, cl: {} };
    for (const k of Object.keys(magma)) {
        erupted[k] = magma[k] / (1 + IE[k]);
        const m = k === 'arc' ? magma[k] * arcGross : magma[k], e = k === 'arc' ? erupted[k] * arcGross : erupted[k], Y = YIELD[k];
        gas.co2[k] = mtYr(m, Y.co2); gas.h2o[k] = mtYr(m, Y.h2o); gas.cl[k] = mtYr(m, Y.cl); gas.so2[k] = mtYr(e, 2 * Y.s);
    }
    // (the sills' CO₂ over the frame, Mt/yr: what the box adds to steady degassing; its pulse is the province's own)
    gas.co2.thermo = lips.reduce((s, l) => s + l.thermoGtCO2, 0) * 1e3 / (dt * 1e6);
    return { v: 1, time: t, dt, magma, erupted, gas, lips, sites };
}

// ── eruptions at a finished moment (detail pass; never in the history: Jackson, atmosphere Q6) ──

/** Earth's global eruption rates, per yr, by VEI class: 2–6 from Papale 2018 (λ, GVP + LaMEVE); 7 from Newhall, Self &
 *  Robock 2018 (1–2 per kyr; Papale's 1 per 2800 yr is an incomplete record); 8 from Rougier et al. 2018 (1 per 17 kyr,
 *  5.2–48). */
export const EARTH_VEI_PER_YR = Object.freeze({ 2: 15.2, 3: 4.55, 4: 0.544, 5: 0.0731, 6: 0.0139, 7: 0.0015, 8: 5.9e-5 });
/** Explosivity by setting: the VEI ≥ 4 record is ~90 % subduction zones (Siebert, Simkin & Kimberly 2010); basaltic
 *  shields and rifts are mostly effusive. Earth's explosive weight is its arcs' erupted ~0.5 km³/yr (Crisp 1984: 0.4–0.6)
 *  plus its silicic continental centres' ~0.1: EARTH_WEIGHT km³/yr, which carries EARTH_VEI_PER_YR. */
export const EXPLOSIVITY = Object.freeze({ arc: 1, andean: 1, rift: 0.3, plume: 0.1 }), EARTH_WEIGHT = 0.6;
/** Bulk volume of an eruption of a VEI class, km³ (VEI 4 ≥ 0.1, each class ×10; Newhall & Self 1982). */
export const veiKm3 = v => 10 ** (v - 5);

function poisson(rng, mean) {
    if (mean <= 0) return 0;
    if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng())));
    let k = 0, p = 1; const L = Math.exp(-mean);
    while ((p *= rng()) > L) k++;
    return k;
}

/**
 * The eruptions of the last `kyr` thousand years at a moment, from its `volc` record: per site and VEI class a seeded
 * Poisson draw, the world's rate per class = Earth's × (its explosive weight ÷ Earth's), shared among the sites whose VEI
 * cap allows the class, by weight (a site erupts its erupted km³/Myr × its setting's explosivity). So a world with no
 * thick-crust arcs and no plume under a continent has no super-eruptions. @returns [{ w, kind, vei, ageYr, km3, so2Tg }]
 * sorted youngest first; `near` (a cell list) keeps only those sites; `minVei` (default 4) the classes drawn.
 */
export function recentEruptions(volc, seed, kyr, { minVei = 4, near = null } = {}) {
    const sites = volc.sites.filter(s => EXPLOSIVITY[s.kind] > 0 && s.km3Myr > 0);
    const weight = s => s.km3Myr / (1 + IE[s.kind === 'andean' ? 'arc' : s.kind]) * 1e-6 * EXPLOSIVITY[s.kind];   // km³/yr erupted × explosivity
    const W = sites.reduce((a, s) => a + weight(s), 0), keep = near ? new Set(near) : null, out = [];
    for (let v = minVei; v <= 8; v++) {
        const able = sites.filter(s => s.veiMax >= v), Wv = able.reduce((a, s) => a + weight(s), 0);
        if (!(Wv > 0)) continue;
        const rate = EARTH_VEI_PER_YR[v] * W / EARTH_WEIGHT;        // per yr, the whole world
        for (const s of able) {
            if (keep && !keep.has(s.w)) continue;
            const rng = makeRng((Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(s.w + 1, 0x85ebca6b) ^ Math.imul(v, 0xc2b2ae35) ^ Math.round(volc.time * 16)) >>> 0);
            const k = poisson(rng, rate * weight(s) / Wv * kyr * 1e3);
            for (let i = 0; i < k; i++) {
                const km3 = veiKm3(v) * (1 + 9 * rng());
                // (SO₂ by size, Tg: 3 × km³^0.6 through Pinatubo's ~15–20 Tg for ~10 km³ bulk and Tambora's 53–58 for ~150
                // (Self et al. 2004): the big silicic eruptions are S-poor, so it grows slower than the volume)
                out.push({ w: s.w, kind: s.kind, vei: v, ageYr: rng() * kyr * 1e3, km3, so2Tg: 3 * km3 ** 0.6 });
            }
        }
    }
    return out.sort((a, b) => a.ageYr - b.ageYr);
}
