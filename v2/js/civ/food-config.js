// What the land could feed before anyone lives there (plans/CIV_PLAN.md §11): harvests a year, the soil's climate half,
// the sea's fish. Ported from upstream's Food tab (raguilar011095/planet_heightmap_generation, plans/V2_FARMING_PLAN.md
// C1–C6b: v2/js/farming/farming-config.js, living.js — © Robert Aguilar, GPL v3) and fitted to the civ layer: the crops
// are its classes (crops.js), the soil and the fish feed its resources (substrate.js). Each value's source is upstream's
// unless marked [ours]. Physical units throughout (°C, mm, months, km), so the same at every detail.

export const FOOD = {
    // ── the months: warm enough and wet enough (FAO's length of growing period) ──
    warmC: [5, 15],             // a month grows crops from this mean °C (wheat's and barley's minimum) to fully at this
    wetShare: [0.25, 0.6],      // …and is wet enough as its rain, melt and the soil's water pass about half its potential
                                // evaporation (FAO: P > 0.5 PET; the finish's straight-line PET runs high in spring and
                                // autumn, so a little under)
    soilMm: 100,                // the water the soil holds into a dry spell (FAO's 100 mm)

    // ── each crop class's kinds (crops.js): grows each month as it is warm past its `base` (linearly to its `opt`imum:
    // growing degree-days), not too `hot` (fading from, gone at), `wet` enough (its water ÷ potential evaporation) and,
    // unless a paddy, not drowned (`soggy`: the month's water past evaporation, mm); ripens after `cycle` months of that
    // growth; a run broken by a dry or a cold month is lost (winter grains sleep through the cold: `dormant`); at most `max`
    // harvests a year (wheat and barley one: they flower on the lengthening days after a winter's chill). A class's
    // kinds: the best of them (× its `share`). `soil`: how much the crop asks of the soil (its food × (1 − soil + soil ×
    // fertility): tubers little, paddy rice much); `weight`: what a harvest feeds against a wheat harvest's (for the
    // rotations: a second crop counted in the first's). FAO ECOCROP's windows ──
    crops: {
        // paddy rice: from 12 °C, best by 26 (cool summers chill its flowers sterile); standing water; ~3.8 months; two or
        // three crops a year where it is warm and wet the year round
        // (its flowers want a warm month: `flower`, the warmest month's mean °C from which it sets grain, fully at the
        // second — rice's critical low temperature at flowering ~22 °C, Yoshida 1981, recalled; Hokkaido's paddies at the
        // edge) [ours: upstream's has none; without it the wet tropics' highlands at 17 °C grew rice]
        paddy: { weight: 1.4, soil: 1, kinds: [{ base: 12, opt: 26, hot: [35, 40], wet: [0.8, 1.4], cycle: 3.8, paddy: true, flower: [18, 22], share: 1 }] },
        // wheat and barley: autumn-sown, sleeping through a winter, or spring-sown; ~2000 degree-days from 0 °C
        winterCereal: { weight: 0.9, soil: 0.65, kinds: [{ base: 0, opt: 16, hot: [19, 25], wet: [0.15, 0.5], soggy: [200, 400], cycle: 4, dormant: true, max: 1, share: 1 }] },
        // the warm season's grains: maize where it is wet enough for long enough (~1500 degree-days from 10 °C); millet
        // and sorghum, quick and drought-hardy (the Sahel's)
        // and the temperate millets, broomcorn and foxtail (the Yellow River's first grain; Bronze Age Europe's): quick (60–
        // 90 days) and cooler, from ~8 °C (Ecocrop, Panicum miliaceum and Setaria italica — recalled) [ours: a kind upstream
        // has not; without it no summer grain grew north of ~40° but maize in the hottest summers]
        summerCereal: { weight: 1, soil: 0.65, kinds: [{ base: 10, opt: 24, hot: [34, 40], wet: [0.35, 0.8], soggy: [120, 260], cycle: 3.8, share: 1 },
            { base: 12, opt: 28, hot: [38, 44], wet: [0.15, 0.45], soggy: [50, 150], cycle: 2.8, share: 0.75 },
            { base: 8, opt: 22, hot: [32, 38], wet: [0.25, 0.6], soggy: [80, 200], cycle: 2.5, share: 0.7 }] },
        // roots and tubers: yams, cassava, taro and sweet potatoes in the wet tropics (a long season, poor soil will do);
        // potatoes in cool highlands and short summers
        // (the tropical ones wait out a dry season — yams' tubers dormant, cassava shedding its leaves (El-Sharkawy 2007): a dry
        // month pauses them rather than killing the crop — `dryDormant`, ours)
        roots: { weight: 0.85, soil: 0.25, kinds: [{ base: 12, opt: 25, hot: [36, 40], wet: [0.3, 0.7], soggy: [150, 300], cycle: 6, dryDormant: true, share: 1 },
            { base: 5, opt: 16, hot: [21, 26], wet: [0.3, 0.7], soggy: [100, 220], cycle: 3.2, max: 1, share: 0.8 }] },
    },
    treeSoil: 0.25,             // tree crops (crops.js's season, not harvests: perennial) ask this much of the soil, as tubers [ours]
    // ── harvests: a staircase — nothing until a crop ripens; a second needs a second whole cycle ──
    harvestBreak: 0.15,         // a month growing less than this ends a crop's run (what was sown dies)…
    dormantKillC: -15,          // …but winter grains sleep through cold months above this (°C, the month's mean)
    harvestTurn: 0.75,          // months between one harvest and the next crop's start (reaping, threshing, ploughing, sowing)
    harvestRamp: 0.35,          // a crop cut short by up to this share of its cycle still yields (eased: less)
    maxHarvests: 3,             // at most this many of one crop a year (rice in Java and Bengal: three)
    relayAt: 0.15,              // a rotation's second crop, of another class, takes the months the first grows less than this
                                // in (rice then winter wheat on the Yangtze; winter wheat then millet on the Nile)
    multiSoil: [0.45, 0.9],     // harvests past the first count as the soil can feed them, from this fertility to this
    seasonRisk: 0.2,            // rain-fed harvests lost to failed rains, at most this share more…
    riskSeason: [0.5, 1],       // …where the year's rain comes in a few months (Walsh & Lawler's seasonality)…
    riskWet: [1, 0.5],          // …and the year is not so wet that a short rain still suffices (rain ÷ potential evaporation)
    rainReliable: [0.12, 0.3],  // rain-fed crops count fully only where the year is this wet or more: drier, the rains fail
                                // too often (the herders' lands)
    waterSupplyMm: 60,          // water brought by canal or flood: about this much a month — a cool season's grain in a
                                // desert, not a summer's thirst nor a paddy's standing water (Egypt and Mesopotamia grew
                                // wheat and barley in winter)

    // ── the soil: what it formed from (its parent material) × what the climate made of it ──
    parent: { silt: 1, loess: 0.95, sand: 0.05, rock: 0.7 },  // river silt, loess, dune sand; `rock`: any other ground, as
                                // middling — TODO the parent rock (granite poor, basalt rich, limestone good…) from the
                                // geology survey's rock types, when it lands (upstream's rocks.js; lane gs-geosurvey)
    soilRef: 0.7,               // the soil the crops' yields (civ-config cropFood, rainfedYield) are for: middling ground,
                                // neither leached nor black [ours: so the yields keep their sources' meaning]
    // black earth (chernozem, mollisols): deep humus under the temperate grasslands and forest-steppe, by climate — the
    // year's rain ÷ potential evaporation from this (a deep sod)…
    blackWet: [0.3, 0.55],
    blackWetMax: [1.35, 0.9],   // …to this (wetter: forest soils, leached)…
    blackWarmest: [15, 21],     // …with summers this warm (°C, the warmest month: the tundra's grass makes none)…
    blackColdest: [15, 5],      // …and winters this cool (the coldest month: the savanna's grass makes none)…
    blackBonus: 0.3,            // …up to this much richer
    leachWet: [0.6, 1.3],       // leaching (laterite, oxisols): where the year is this wet (rain ÷ potential evaporation)…
    leachWarm: [14, 22],        // …and this warm (°C, the year's mean)…
    leachLoss: 0.6,             // …up to this share of its fertility…
    leachRenew: 0.85,           // …this share of it spared where floods renew the ground (river silt). (Volcanic ash, a young
                                // basalt, a rising range renew it too: with the parent rock, TODO)
    podzolNeedle: [0.25, 0.7],  // podzol: acid ground under boreal conifers — by their share of the cover…
    podzolColdest: [0, -8],     // …where winters are this cold (°C)…
    podzolWarmest: [21, 17],    // …and summers this cool (Manchuria's hot summers make black earth)…
    podzolLoss: 0.4,            // …up to this share of its fertility
    // the fallow the soil asks (upstream's people.js croppedShare; Ruthenberg's cultivation intensity R, the years cropped ÷
    // the years cropped and fallow; Allan's critical densities): a field farmed as often as its crop's own round allows
    // (civ-config cropFood fallow) on ground this fertile and more…
    fallowSoil: [0.3, 0.65],
    fallowMin: 0.15,            // …on poorer, rested down to this share of that: forest fallow, R ~10–25 % (the Amazon's,
                                // the Congo's, Borneo's shifting cultivation)…
    fallowWarm: [9.5, 11.5],    // …longest where it is warm the year round (its months warm enough to grow: no winter slows
                                // the soil's exhaustion — leaching, decay, weeds)…
    fallowCool: 0.5,            // …a winter's land this much of it (manure and rotation: an outfield, a heath rested). A
                                // river's flood renews its silt: cropped as its crop allows

    // ── the sea's fish: the shelf within a day's paddle, richer where the water is cold or upwelling (living.js GATHER) ──
    shelfKm: 0.2,               // the shelf: sea shallower than this (km) — where fish and shellfish are within reach
    reachKm: 40,                // the sea's food within about this of the shore (a Gaussian's spread: a day's paddle out and back)
    warmShelf: 0.3,             // a warm, clear tropical shelf's richness (reefs, lagoons) against a cold or upwelling one's (1)…
    coldSea: [24, 12],          // …richer as the sea's year runs from this warm to this cold (°C: cold water is rich in nutrients)…
    upwell: [0.1, 1],           // …or as its upwelling runs from this to this (m/day: Peru's, California's, Namibia's coasts)…
    seaIceLoss: 0.9,            // …less under sea ice (its year's share × this)
    fishRich: [0.02, 0.25],     // a coast's fishing from the sea's richness within reach (the shelf's share × its richness):
                                // little from the first, the most from the second…
    fishPeople: 1,              // …feeding up to this many foragers a km² of the coast's land — Binford 2001's hunter-gatherers
                                // (via D-PLACE, B003/B008): of the 76 living ≥ 60 % on fish, the 90th percentile 1.04 a km²
                                // (median 0.26; the richest sea coast, the Nuu-chah-nulth, 1.54). Upstream's 2.5 is above
                                // every marine group, and put Earth's foragers at 12 M by 50 ka (12 ka estimates: 1–10 M,
                                // Thomlinson 1975; Pala et al. 2012). Added to what the land feeds them, not a multiple of
                                // it: the sea's food does not wait on the land's (Peru's desert coast fed Caral's builders)…
    fishSummer: [1, 4],        // …as the land has a summer (its months warm enough to grow: the Arctic's coasts fed few)
    gridDeg: 0.25,              // the sea read on a grid this fine (fixed in degrees: the same at every detail; fine enough
                                // for reachKm's spread to be the grid's and not its cells')

    // ── the views (substrate.js stapleOf, the Farmland view) ──
    stapleMin: 1,               // a staple: a crop feeding at least this many a km² of its field [ours]…
    herdMin: 0.3,               // …or herds this many a km² of their pasture (Mongolia's 1918 census ~0.4: civ-config grazeUse)
    // the Farmland view's classes (upstream's farming-config classesV): the best rotation's food in good harvests a year
    // (placeFood farmV) from which the land is poor, fair, good, excellent
    farmClasses: [0.12, 0.35, 0.65, 1.25],
};
