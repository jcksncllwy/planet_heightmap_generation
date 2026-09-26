// Tunable constants of terrain synthesis (Phase 8). Everything is in kilometres and Myr, never in cells, so the
// same planet comes out at any terrain resolution — a finer mesh shows more detail, not a different world.
// Heights are km above sea level.

import { OrogenyType } from '../tectonics/model/crust.js';

export const TERRAIN = {
    // ── Carrying the sim's records onto a finer mesh ──
    warpKm: 70,                 // lookup positions are displaced by up to this (smooth noise), so the sim's 121 km cells never show
    warpScale: 4,               // noise frequency of that warp on the unit sphere (≈ 1500 km features, plus finer octaves)

    // ── Coasts ──
    coastNoiseKm: 45,           // the coast is moved in and out by up to this, at 200–1500 km scales: bays and headlands
    shelfEdgeKm: -0.15,         // depth of the shelf break, at the edge of the continental crust
    // per kind of margin (measure.js Margin): width of the continental shelf, of the low coastal plain behind the
    // shoreline, and of the slope down to the deep sea
    margins: {
        passive:   { shelfKm: 150, plainKm: 180, slopeKm: 110 },   // rifted, trailing: wide shelves, low coasts (Argentina, the US east coast)
        active:    { shelfKm: 15,  plainKm: 25,  slopeKm: 45 },    // a trench offshore: narrow shelf, the coastal range rises from the sea
        transform: { shelfKm: 30,  plainKm: 50,  slopeKm: 50 },
        collision: { shelfKm: 40,  plainKm: 80,  slopeKm: 80 },
        arc:       { shelfKm: 5,   plainKm: 15,  slopeKm: 40 },    // island arcs: steep volcanic flanks
    },
    shelfNoise: 0.45,           // shelves vary in width by ± this share along the coast
    pocketSeaKm2: 50000,        // a pocket of ocean crust trapped in the land smaller than this is a lowland, not a sea (a
                                // one-cell sliver would otherwise stand as a deep hole ringed by drowned shelf)
    coastKindKm: 250,           // a margin's kind holds along its stretch of coast: a bay or a headland's flank within this
                                // many km (along the coast) of an active / transform / collision coast is one too

    // ── Continental platform ──
    continentKm: 0.12,          // unthickened continental crust: lowland platforms and plains
    cratonKm: 0.28,             // shields: low, flat, stable
    platformNoiseKm: 0.16,      // broad basins and arches (the Michigan basin, the Ozark dome), 400–2000 km across
    // Airy isostasy: thickened crust floats higher, with diminishing returns (a 35 km thicker crust stands ~5 km: Tibet)
    isoMaxKm: 6,
    isoScaleKm: 30,             // (≈ 0.17 km of height per km of extra crust at first; 35 km → 4.2 km, before the belt's relief)
    thickTauMyr: 130,           // once a belt falls quiet, its root is eroded and rebounds away over this e-folding time
    swellKm: 0.35,              // broad uplift over hot mantle (the African superswell), × mantleHeat²
    lipLandKm: 0.6,             // flood basalt on land: this much height per km of basalt
    lipSeaKm: 1.4,              // an oceanic plateau (Ontong Java) rises this much per km of basalt
    lipMaxKm: 2.5,              // (only this much of a pile counts: where a hotspot track crossed a LIP the record holds the edifice)
    failedArmKm: 0.4,           // a failed rift arm (aulacogen) is a sagged, sediment-filled corridor this much lower…
    failedArmHalfKm: 45,        // …about twice this wide — low land, not sea (the Benue trough, the Reelfoot rift)

    // ── Island arcs ──
    arcYoungKm: -2.0,           // the ridge an arc stands on, when young: under water, only its volcanoes break the surface
    arcMatureKm: 0.3,           // …and when mature: continuous land (Japan)
    arcMatureMyr: 150,          // (a Mariana, ~50 Myr old, is still mostly under water: islands on a submarine ridge)
    arcUpliftShare: 0.25,       // a subduction belt's broad uplift counts this much on arc crust (its maturity gives the rest)
    foreArcIsleKm: 0.2,         // a fore-arc island (step/margin-isles.js): low

    // ── Oceans ──
    fabricPeriodMyr: 2,         // abyssal hills run along the isochrons, one every this much crust age
    fabricKm: 0.12,             // their height on young floor…
    fabricOldKm: 0.03,          // …and on old floor, buried in sediment
    fabricTauMyr: 60,
    trenchKm: 2.4,              // a trench is this much deeper than the floor beside it (under an old slab; a young one 60 %)
    trenchHalfKm: 55,           // its half-width
    riseKm: 0.35,               // the outer rise on the subducting plate, this high…
    riseAtKm: 160,              // …this far from the trench axis

    // ── Mountain belts: relief on top of the isostatic platform (profiles.js lays out the cross-sections) ──
    reliefKm: {                 // crest height of each kind of belt when mature and active
        [OrogenyType.ANDEAN]: 2.7, [OrogenyType.LARAMIDE]: 1.5, [OrogenyType.URAL]: 1.7, [OrogenyType.HIMALAYAN]: 3.2,
        [OrogenyType.ARC]: 0.8, [OrogenyType.RIFT]: 1.4, [OrogenyType.TRANSPRESSION]: 1.9,
    },
    fullReachKm: {              // a belt this wide counts as mature (a young one is narrower and lower)
        [OrogenyType.ANDEAN]: 450, [OrogenyType.LARAMIDE]: 900, [OrogenyType.URAL]: 250, [OrogenyType.HIMALAYAN]: 900,
        [OrogenyType.ARC]: 200, [OrogenyType.RIFT]: 220, [OrogenyType.TRANSPRESSION]: 80,
    },
    youngShare: 0.55,           // a belt just begun stands at this share of a mature one's relief (a young arc like the Cascades: 3–4 km with its volcanoes)
    // ── Heights evolving through the history (tectonics/step/heights.js) ── every rate below is × the erosion factor of
    // the latitude the crust is at, step by step. (Changing these re-runs the history in the lab.)
    upliftBuildKm: {            // an active belt builds its uplift and ruggedness toward their targets, e-folding every this
                                // many km its front absorbs (Andean fronts count 12 % of the slab — andeanWorkShare — so
                                // theirs is shorter; rifts and accretions build theirs at once)
        [OrogenyType.ANDEAN]: 20, [OrogenyType.LARAMIDE]: 20, [OrogenyType.URAL]: 30, [OrogenyType.HIMALAYAN]: 50,
        [OrogenyType.ARC]: 20, [OrogenyType.RIFT]: 1, [OrogenyType.TRANSPRESSION]: 30,
    },
    // (developer, round 4: erosion here a little slower overall — 8b's rivers cut down more, and the two should balance)
    reliefTauMyr: 170,          // uplift wears away over this e-folding time (at erosionHeight.refKm)…
    riftReliefTauMyr: 450,      // …except a rifted margin's shoulders: the great escarpment retreats rather than wears down
                                // (the Drakensberg ~180 Myr, the Brazilian highlands ~130 Myr, the Western Ghats ~90 Myr)
    ruggedTauMyr: 350,          // the crests and ridges of a belt wear away more slowly: an old belt keeps its grain (the Appalachians)
    // High ground wears fast, low ground slowly (developer: "wear down higher places faster — really slower on lower
    // places"): denudation rises with relief (Ahnert 1970; Montgomery & Brandon 2002), which is also why old ranges
    // persist as low hills for hundreds of Myr (Baldwin et al. 2003). Every clock above runs × (H / refKm) below refKm
    // (never under floor) and × (H / refKm)^0.5 above it (at most max) — H: the belt's height above its plain
    // (evolved uplift + the root's isostatic lift).
    // (a 600 Myr planet: median land 0.71 → 0.87 km, belts quiet 300+ Myr keep ~0.4 km of uplift instead of 0.2)
    erosionHeight: { refKm: 2, floor: 0.5, max: 1.8 },
    diffusionKm2PerMyr: 80,     // hillslope smoothing of the uplift: range edges spread and blend over time (not onto cratons)
    alongStrikeVar: 0.3,        // crest heights vary by ± this share along a range
    // Where two kinds of ground meet — two belts, a belt and the plain, a craton and its neighbours — each corner's
    // share is scaled by noise of its own, so they interfinger over about blendNoiseKm instead of blending linearly
    blendNoise: 1.4,            // (weights × e^(± this))
    blendNoiseKm: 180,
    edgeJitter: 0.13,           // a belt's far edge wanders by ± this share of its width
    // A belt a newer orogeny overprinted still shows under it, at this share of its own (age-decayed) relief and with
    // its own ridge grain (developer: the new should dominate, not erase — cross-cutting grain makes ranges varied)
    overprintShare: 0.5,

    // ── Ridges inside a belt: strike-parallel stripes (stripes.js) ──
    stripeKm: {                 // wavelength of the main set of parallel ridges, per kind of belt
        [OrogenyType.ANDEAN]: 75, [OrogenyType.LARAMIDE]: 190, [OrogenyType.URAL]: 70, [OrogenyType.HIMALAYAN]: 95,
        [OrogenyType.ARC]: 60, [OrogenyType.RIFT]: 90, [OrogenyType.TRANSPRESSION]: 55,
    },
    // Their height is GUIDANCE layered on the belt's own uplift (developer: "guides, layered on top of other
    // increases"): a share of the local relief, plus a little on a young belt's low ground; 8b carves the rest
    stripeShare: 0.22,          // ± this share of the belt's relief where they are (round 4: up from 0.14 — the layering
                                // gives the texture, the ridges give it structure)
    stripeBaseKm: 0.13,         // …plus ± this much (× the belt's intensity and activity)
    stripeWaveJitter: 0.25,     // each kernel's wavelength varies by ± this share, and its direction by ±…
    stripeAngleJitterDeg: 10,   // …this: spacing and strike wander, ridges fork and end — less perfect
    stripeFineShare: 0.4,       // a second, finer set (wavelength ÷ stripeFineRatio) this strong, for fine meshes
    stripeFineRatio: 2.6,
    stripeBandKm: 150,          // kernel envelope (σ) of the phasor sum: must overlap from one sim cell to the next
    stripeMeanderKm: 16,        // stripes wander by about this much…
    stripeMeanderAlongKm: 350,  // …over this distance (so they bend by ~15° at most, and stay parallel to the front)
    // En-echelon ridges: where plates met obliquely, fold axes turn by half the obliquity. Along a transform that is
    // the whole story (the Transverse Ranges); at an oblique trench or collision most of the sideways motion goes onto
    // a separate fault along the margin (strain partitioning — the Great Sumatran Fault), so folds stay nearly parallel.
    enEchelonShare: { [OrogenyType.TRANSPRESSION]: 1, other: 0.25 },
    stripeSegmentKm: 300,       // ridges come in segments about this long — a tangle of shorter ridgelines
    minWavesPerCell: 2.0,       // a wavelength shorter than this many terrain cells is faded out (it would only alias)
    fullWavesPerCell: 3.2,

    // ── Volcanoes ── (developer: fewer, thicker, and spreading out as they erode — not a pox of little cones)
    arcConeShare: 0.6,          // chance of a volcano per sim cell of island arc…
    arcActiveMyr: 25,           // …while it is an active arc (arc crust accreted into a continent, now in a collision belt, has none)…
    arcFrontKm: 130,            // …and only along its volcanic front: one line on the trench side, not across a whole swath of arc crust
    andeanConeShare: 0.35,      // chance of a stratovolcano per sim cell along an active Andean volcanic range
    coneKm: { young: 2.5, mature: 2.0, andean: 1.2 },   // cone heights above what they stand on
    coneRadiusKm: { young: 34, mature: 48, andean: 34 },
    coneActiveMyr: 15,          // an Andean volcanic range falls silent this long after its margin stops
    coneSpreadMyr: 25,          // as a volcano erodes it spreads: over about this long it grows ×(1 + coneSpread) wider…
    coneSpread: 0.6,
    coneSettle: 0.35,           // …and loses this share of its height, turning from a cone into a broad, rounded shield
    // no two volcanoes the same shape (developer: "too perfectly circular", then "more ridgey and irregularly shaped"):
    // a ragged central edifice, ridges (arms) running out from the summit, gullies in the flanks, sometimes a collapse
    coneElongation: { hotspot: 0.3, arc: 0.35, andean: 0.25 },   // the edifice's long axis is up to 1 + this times the short one
    coneWarp: 0.3,              // a volcano's own coordinates are warped by smooth noise this strong (× its radius): irregular
    coneLobes: 0.1,             // outline wobble: up to ± this share of the radius in each of three harmonics…
    coneLobesFine: 0.04,        // …and a fifth-order one this strong: a ragged edge
    coneArms: { hotspot: [2, 3], arc: [1, 2], andean: [0, 2] },   // arms per volcano, fewest…most: a shield's rift zones,
                                // spread round it; an arc volcano's ridge along the arc
    coneArmLength: { hotspot: [1.3, 2.4], arc: [0.9, 1.6], andean: [0.7, 1.3] },   // × the radius
    coneArmWidth: [0.35, 0.55], // × the radius (the width of the ridge where it leaves the summit)
    coneArmHeight: [0.8, 0.95], // an arm's crest where it leaves the summit, × the volcano's height; it stays high, then falls to its tip
    coneRibs: { young: 0.12, worn: 0.35 },   // gullies cut the lower flanks this deep (share of the height), deeper as it erodes
    coneRibCount: [5, 9],       // about this many gullies round a volcano
    coneCollapse: { hotspot: 0.3, arc: 0.2, andean: 0.15 },   // chance of a flank-collapse amphitheatre (El Golfo, Mount St Helens)…
    coneCollapseDepth: [0.3, 0.6],                               // …cutting this share of the height out of one side
    coneSatellites: { hotspot: 0.6, arc: 0.35, andean: 0.3 },    // chance of flank vents out along the arms

    // ── Erosion follows rainfall ──
    // A hard-coded estimate of zonal-mean precipitation by |latitude| (mm/yr, after Earth's: the wet equatorial belt,
    // the dry subtropics, the mid-latitude storm tracks, the dry poles). Every erosion clock of the tectonic surface —
    // relief of a quiet belt, its root rebounding, a rift's shoulders, a volcano wearing down and spreading — runs
    // (rain / rainRefMm)^rainErosionExponent times as fast, and softer still where it is wetter than the reference
    // (developer, round 4: the contrast was too strong, especially at the equator): ×wetErosionShare on the exponent.
    // Heights erode at the latitude the crust is at, step by step (tectonics/step/heights.js).
    rainByLatitude: [[0, 2000], [10, 1600], [20, 950], [30, 850], [40, 1050], [50, 1100], [60, 800], [70, 400], [80, 200], [90, 120]],
    rainRefMm: 1000,
    rainErosionExponent: 0.6,   // 0 = erosion everywhere alike
    wetErosionShare: 0.6,       // (equator: 2000 mm → ×1.28, the subtropics' 850 mm → ×0.91)
    // …except where ice does the work (developer): glaciers erode fast though little falls, so poleward of the storm
    // tracks erosion holds near their level — the rate is the larger of rain's and this, by |latitude|
    glacialErosion: [[45, 0], [52, 0.95], [58, 1.07], [90, 1.0]],
};

/** Estimated mean rainfall (mm/yr) at a latitude (degrees), from cfg.rainByLatitude. */
export function rainAtLatitude(latDeg, cfg) {
    const table = cfg.rainByLatitude, a = Math.min(90, Math.abs(latDeg));
    for (let i = 1; i < table.length; i++) {
        const [l0, r0] = table[i - 1], [l1, r1] = table[i];
        if (a <= l1) return r0 + (r1 - r0) * (a - l0) / (l1 - l0);
    }
    return table[table.length - 1][1];
}

/**
 * How many times faster than at rainRefMm things erode at this latitude: by the rain that falls there, or — poleward —
 * by the ice (cfg.glacialErosion), whichever is more. With rainErosionExponent 0, 1 everywhere.
 */
export function erosionAtLatitude(latDeg, cfg) {
    if (cfg.rainErosionExponent <= 0) return 1;
    const wet = rainAtLatitude(latDeg, cfg) / cfg.rainRefMm;
    const rain = wet ** (cfg.rainErosionExponent * (wet > 1 ? cfg.wetErosionShare : 1));
    const g = cfg.glacialErosion, a = Math.min(90, Math.abs(latDeg));
    let ice = 0;
    if (a > g[0][0]) for (let i = 1; i < g.length; i++) if (a <= g[i][0]) { const [l0, v0] = g[i - 1], [l1, v1] = g[i]; ice = v0 + (v1 - v0) * (a - l0) / (l1 - l0); break; }
    return Math.max(rain, ice);
}

/**
 * How many times faster than the reference a belt standing `heightKm` above its plain wears down (cfg.erosionHeight):
 * slower on low ground, faster on high.
 */
export function erosionAtHeight(heightKm, cfg) {
    const { refKm, floor, max } = cfg.erosionHeight, x = heightKm / refKm;
    return x <= 1 ? Math.max(floor, x) : Math.min(max, Math.sqrt(x));
}

/** Terrain constants with the given overrides (shallow for scalars, one level deep for grouped tables). */
export function terrainConfig(overrides = {}) {
    const out = structuredClone(TERRAIN);
    for (const [k, v] of Object.entries(overrides)) if (k in out && typeof v === typeof out[k]) out[k] = v;
    return out;
}
