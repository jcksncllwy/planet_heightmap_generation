// Every tunable of the finish's geology, in physical units — km, Myr, shares — so it reads the same at every detail. The
// history's own record has its tunables in tectonics/config.js `geology`.
//
// Ported from World Orogen (raguilar011095/planet_heightmap_generation, GPL v3), trimmed to the physical layer. The idea of
// reading rock from a world's orogenies and old seas comes from Madeline James's worldbuilding guide: an idea source, a
// method for drawing by hand, not code.
//
// guideRules: where the science disagrees with her guide, the stance taken — each one back to her rule in a line.

export const GEOLOGY = {
    guideRules: {
        coalByWetBelts: true,   // coal where a basin lay in a wet belt; false: her rule, within 45° of the equator (the
                                // history lays it: tectonics config geology.coalByWetBelts takes it from here — a new world)
    },

    // The hand rules the rock's k_rock stands in for at the finish, each kept until the checks say it can go (false: the old
    // rule): the shield's and a flood basalt's carve hardness, the crests', and records.js iceSoft on land
    useRock: { craton: true, lip: true, crest: false, iceSoft: true },

    // ── the cover as beds, cut by the surface (upstream's values: read for the look, tier 3 — rocks.js header) ──
    coverShowKm: 0.05,          // cover thinner than this (where the surface meets it) is the basement's
    highStripFromKm: 1.5,       // high ground sheds its cover: from this regional height (over ~50 km)…
    highStripPerKm: 1,          // …this many km of it per km higher (the crystalline cores of high ranges)
    despeckle: 2,               // passes of a majority filter: a cell alone among another kind takes theirs
    recordBlurCells: 0.6,       // the record reads smoothly, over this many sim cells
    bedKm: 0.35,                // the beds (formations) about this thick (0.6–1.4 × it), counted up from the basement
    reliefKm: 40,               // a place's relief: its height over the land around it (~this far) — low places bare older beds…
    reliefGain: 1.5,            // …the relief × this (the beds lie flat; a little more shows the pattern at a map's scale)
    foldKm: 70,                 // a fold belt's folds this far apart (and a set 2.6 × longer)…
    foldDepthKm: 2,             // …an anticline baring beds this much deeper than its syncline keeps: stripes along the belt
    bedJitterKm: 0.12,          // the beds' contacts wander by this (noise, 150 and 75 km)
    contactWarpKm: [30, 160],   // the record read displaced by up to ~this (km), in waves from this long down to what the mesh draws
    facieKm: 350,               // each bed's kind changes across country over about this (sand to mud to lime)
    lavaShow: [0.15, 0.5],      // a flood basalt's cap on the ground (carve's lip, 0…1)
    // ── the basement, by the setting the crust was last in and how deep it is worn (its grade) ──
    gradeKm: { slate: [4, 8], gneiss: [16, 24] },   // worn this deep: into slate and schist, then gneiss and migmatite (Barrovian
                                                    // depths; upstream's plans/V2_GEOLOGY_RESEARCH.md §3)
    volcanicLidKm: [1.5, 4],    // an arc's volcanic pile: bared to its plutons once its unroofing passes this
    arcActiveMyr: [10, 60],     // a subduction belt counts as a live arc for this long after it was last active (then fading)
    arcFront: [0.05, 0.55],     // the volcanic arc across an Andean belt: from its front (0) to this far across (1 = far edge)
    collisionGranite: 0.3,      // granite plutons' share of a collision belt worn past its sediments (S-type)
    arcGranite: 0.65,           // …of an arc's roots once its lid is gone (batholiths: the Sierra Nevada)
    beltGranite: 0.2,           // …of an old mobile belt's
    felsicThickKm: [15, 40],    // an arc on crust thickened this much turns andesite → rhyolite and tuff
    greenstoneShare: [0.15, 0.35],  // each craton's greenstone belts (per craton; the rest granite-gneiss domes)
    domeKm: 90,                 // dome-and-keel: the domes' spacing (Pilbara: 30–70 km domes, ~120 km apart)
    beltStyleShare: 0.4,        // cratons in long parallel belts (the Superior's) rather than domes
    beltSpacingKm: 220,         // …their spacing
    ophioliteFlag: 0.55,        // a closed sea's floor, thrust up (GeoFlag.OPHIOLITE): ophiolite this much of it, mélange the rest
    sutureOphiolite: 0.35,      // along an old suture: thin slivers this strong
    shaleMarine: 0.55,          // shale's share of sand-and-mud laid in the sea (the rest sandstone); on land…
    shaleLand: 0.25,            // …this
    saltShare: 0.5,             // a bed is salt by the cover's salt share × this (it dissolves at the surface: rarely seen)
    basalSand: 0.5,             // the lowest bed, laid as the sea first spread over the basement, sandier by this
    patchKm: 110,               // the patches each kind of rock comes in (noise, so edges are ragged, never the sim's cells)

    // ── what each rock does to the land, in rocks.js Rock's order: sea, young sediment, sandstone, shale, limestone, salt,
    // basalt, andesite & rhyolite, granite, slate & schist, gneiss, shield, greenstone, ophiolite ──
    lithology: {
        // against erosion, 0…1 (rock mass strength: quartz sandstone, granite and gneiss strong; shale, salt and loose sediment weak — Selby 1980)
        hard: [0, 0.1, 0.7, 0.2, 0.75, 0.1, 0.8, 0.55, 0.85, 0.5, 0.8, 0.75, 0.7, 0.4],
        // limestone dissolves where it is wet: its hardness from `hard` (dry) to this (wet), by the year's rain (mm), where it is warm enough to (°C)
        solubleHard: 0.3, solubleRainMm: [500, 1400], solubleTempC: [-2, 8],
        // layered and flat enough to stand in steps, 0…1
        bedded: [0, 0, 0.9, 0.4, 0.8, 0, 0.7, 0.3, 0, 0, 0, 0, 0, 0],
        soluble: [0, 0, 0, 0, 1, 0.6, 0, 0, 0, 0, 0, 0, 0, 0],
        // what it breaks down to: 1 coarse (sand and gravel, bedload: granite, sandstone, gneiss), 0 fine (mud, or dissolved)
        // (ours, recalled: quartz-rich rock weathers to sand; shale, tuff and basalt to clay; limestone mostly to solution)
        coarse: [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0],
        // erodibility: k_rock ∝ e^(erodeGain (½ − hard)) (upstream's 2.3: shale ~2×, granite ~0.45×, ~4.5× between them; Jackson's
        // ruling 3: this compressed spread first, Earth's range tested in L3)
        erodeGain: 2.3,
        // the share of what a rock breaks down to that the rivers roll or bounce on their beds, the rest going in suspension or solution:
        // derived so the land's load is ~14 % bed material (~3 of ~22 Gt/yr: a global model of river outlets, erosion-report.md, search
        // summary only), with ~30 % of land on coarse rock
        bedShareCoarse: 0.35, bedShareFine: 0.05,
    },
};
