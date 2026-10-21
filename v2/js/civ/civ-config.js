// Tunable constants of the civ layer (plans/CIV_PLAN.md): people on a finished moment. Everything in km, years, persons/km²,
// kg/ha, mm and °C — never in cells — so a world read at 640K and at 2.5M is the same world. Each constant carries the
// literature it comes from; CIV_PRIORS gives the range it may be tuned within (as the climate's PARAM_PRIORS does).
// [L] marks a figure from the literature not yet checked against its primary source (plans/CIV_RESEARCH.md).

export const CIV = {
    // ── foragers: density from the land's productivity ──
    // NPP by the Miami model (Lieth 1975): the lesser of a temperature and a rainfall limit, g dry matter /m²/yr…
    nppMax: 3000,
    // …read as carbon (×0.45) by the ethnographic regression of forager density on NPP (357 groups; Nat. Commun. 2022):
    // log10 D = slope · NPP(g C) + icept, persons/km². NPP explains < 30 % of it: the aquatic and cover terms below do much.
    foragerSlope: 9.6e-4,
    foragerIcept: -1.53,
    foragerRainforest: 0.4,     // closed tropical forest feeds fewer foragers than its NPP says (Kelly: 0.05–0.3/km²) [L]
    foragerMax: 3,              // the richest coasts (the Northwest Coast, California) [L]
    wildCerealForage: 1.5,      // dense wild cereal stands feed foragers this much more at their best (Harlan 1967: a family
                                // could reap a year's grain in three weeks) — the Natufians' reason to settle; not in the glacial
    // the aquatic bonus: coasts, lake shores and big rivers (×3–10 on the richest; Binford, Kelly) [L]
    aquaticStripKm: 15,         // the bonuses below are a strip this wide along the water (so the same at every detail)
    aquaticCoast: 2.5,
    aquaticLake: 2,
    aquaticRiverM3s: 30,        // a river this big starts to count…
    aquaticRiverMax: 2.5,       // …up to this many times more people on a river of 30 000 m³/s
    aquaticMax: 8,
    // wetlands: deltas and big rivers' marshes — fish, fowl, reeds, dates; the setting of the first sedentary villages and of
    // Eridu, Ur and Uruk themselves (Pournelle 2003; Algaze 2008), of the Natufians' lakes, of Jiahu's and Hemudu's marshes
    wetlandAquatic: 4,          // a wetland feeds this many times more foragers (with the river's and the coast's own bonus)
    deltaMinM3s: 300,           // a river this big builds a delta at its mouth…
    deltaKmPerRootM3s: 2.5,     // …reaching this far inland per √(m³/s): ~130 km for the Tigris–Euphrates' ~2500, ~130 for the Nile's
    deltaMaxKm: 0.02,           // …over ground at most this high
    marshMinM3s: 300,           // and a big river's marshes upstream, where its valley is flat
    marshReliefKm: 0.04,
    marshShare: 0.6,            // (a marsh is part of its cell; a delta all of it)

    // ── wild cereals and the other crop packages: where farming can begin ──
    // Blumler (1992): the large-seeded wild grasses are in Mediterranean climates (wet winter, long dry summer); the hilly
    // flanks (Braidwood) — many microclimates within a forager's reach.
    cerealRainMm: [250, 350, 900, 1300],    // rain window: rises over the first pair, falls over the second
    cerealTempC: [6, 11, 21, 26],           // annual mean, the same way
    cerealSeasonality: [0.35, 0.8], // and only where the rain is strongly seasonal (Walsh & Lawler's index): annuals that
                                    // store their year in a big seed are the dry season's answer (Blumler 1992)
    reliefKm: [0.15, 0.8],                  // relief within reliefRadiusKm: flat ground 0.6 of hilly ground's suitability
    reliefRadiusKm: 40,

    // ── farming ──
    // rain-fed cereals: barley fails below ~200 mm, wheat needs 250–300 (Grigg 1974; FAO); Neolithic yields 400–750 kg/ha
    // (Halstead 1995) — manured gardens more [L]
    rainfedMinMm: 200,
    rainfedFullMm: 450,
    rainfedYield: 650,          // kg/ha at its best
    rainfedGrowMonths: [3, 6],  // months above 10 °C: none at 3, full at 6
    loessBonus: 0.3,            // loess: the LBK's and the Yellow River's soil
    tropicalLeach: 0.6,         // Af/Am: leached soils, cereals poor (roots and tubers do better)
    // irrigation on alluvium: southern Mesopotamia ~1500 kg/ha, seed:yield 1:20–30 (Ur III; Jacobsen & Adams 1958) [L]
    irrigatedYield: 1500,
    irrigRiverM3s: 150,         // a river big enough to irrigate from (the Euphrates ~500, the Diyala ~200)
    // a river's floodplain, inside its own cell: width ∝ √discharge (hydraulic geometry; the Nile's ~2800 m³/s ~ 15 km of
    // valley floor, the Indus' ~6600 ~ 25) — the alluvium a cell's mesh is too coarse to show
    floodplainCoef: 0.3,        // km per √(m³/s)
    floodplainMaxKm: 40,
    // and broad alluvial plains beyond it (Sumer's, ~150–200 km wide): gentle ground spreading out from the river
    irrigReachKm: 120,
    plainMaxKm: 0.15,           // …only on low ground near base level, where rivers build plains (Sumer's is under 100 m; the
                                // Sudan's plains at 400 m are not the Nile's alluvium — its valley there is its floodplain alone)          // how far across its alluvium (the Mesopotamian plain is ~150–200 km wide)
    irrigHeadM: 40,             // at most this far above the river (levees, then the floodplain's gentle rise)
    irrigSlope: 0.0015,         // and this gentle (1.5 m/km)
    irrigNeedAridity: [0.2, 0.65],  // where it is needed: full below the first aridity index (P/PET), none above the second
    irrigGrowMonths: [6, 8],    // months above 10 °C: the irrigated alluvia were all warm (Sumer, Egypt, the Indus: 8–12;
                                // the Volga and Ural deltas, ~6, were never canal lands)
    floodBonus: 0.25,           // a river with a flood season: basin / flood-recession farming (the Nile's), more taxable
    farFedBonus: 0.25,          // a river from wet mountains through dry country (the Nile, the Tigris and Euphrates)
    // persons a km² of farmland feeds: yield × (1 − fallow) × (1 − 1/seedRatio) / grain per person
    fallow: 0.5,
    grainPerPersonKg: 275,      // 250–300 kg/yr (Ur III rations ~0.8 kg/day)
    seedRatioRainfed: 6,
    seedRatioIrrigated: 25,

    // ── the clock (years before present, BP; the sim runs on past 0 if asked) ──
    originBP: 70000,            // people set out (Out of Africa ~70–55 ka; Africa itself already peopled)
    holoceneBP: 11700,          // the climate steadies: farming possible from here (Richerson, Boyd & Bettinger 2001)
    stepYears: 25,              // a generation
    frameYears: 500,            // a density frame kept every this often
    // the glacial world before it: sea level (m) through the run — the shelves and land bridges exposed, drowned again
    seaLevelM: [[70000, -80], [30000, -90], [20000, -120], [11700, -60], [7000, 0]],
    // the glacial climate feeds fewer foragers: the land ~6 °C colder and drier, and low CO₂ (LGM Europe's ~36 % habitable;
    // Tallavaara et al. 2015) — capacity worked out again from that climate, rising to the Holocene's over glacialToBP
    glacialDT: -6,
    glacialPScale: 0.7,
    glacialToBP: [14700, 11700],
    iceUntilBP: 15500,          // the last ice age's ice sheets (the finish's own, finish-ice.js) shut people out until this
                                // (the Americas' coastal route open ~16 ka, the ice-free corridor ~14–13 ka)

    // ── Phase 1: foragers spread (a Fisher–KPP front, v = 2√(rD), on the cheapest path in time) ──
    rForager: 0.02,             // growth rate per year at low density (0.02–0.03; Fort et al.)
    seedShare: 0.05,            // a cell's people when the front arrives, of its capacity
    // Speeds: the record's first arrivals average ~0.3 km/yr inland out of Africa (Arabia to Europe, 6500 km in ~20 kyr),
    // faster along coasts (to Sahul by ~50–65 ka: ~1 km/yr), the late-glacial recolonisation ~0.8 (Fort et al. 2004)
    frontLandKmYr: 0.35,
    frontCoastKmYr: 4,          // the coastal route: to Sahul in a few kyr (Macaulay et al. 2005), down the Americas' coast fast
    frontRiverKmYr: 1.0,        // along big rivers
    frontRiverM3s: 100,
    // across water, where the crossing is short enough — by era (years BP → km/yr, km; each never falling): ≤ 20–30 km
    // before ~60 ka, then ~100 (Sahul; Bird et al. 2019); the outrigger and the sail from ~3.3 ka — Lapita from the
    // Bismarcks to Samoa, ~3000 km in ~300 yr, gaps of ~850 km (Kirch 2017) — and Remote Oceania's longest legs by ~1 ka
    frontSeaKmYr: [[70000, 1.5], [3500, 1.5], [3200, 10]],
    crossingKm: [[70000, 30], [60000, 100], [3500, 100], [3200, 900], [1000, 2000]],
    habitableKm2: [0.005, 0.05], // the front slows over thin land (capacity, persons/km²) and stops below the first
    coldET: 12,                 // and stops where Binford's effective temperature (the glacial one) is under this…
    // …until cold-climate kit (tailored clothing, needles, storage) — the colder, the later: by how far under (°C), when it
    // opens (years BP). Europe and southern Siberia ~45 ka, the Russian plain ~42, the Arctic ~32 (Yana), Chukotka and
    // Beringia's far end after the glacial maximum (the Beringian standstill)
    coldOpensBP: [[3, 45000], [4.5, 40000], [5.5, 32000], [6.5, 20000]],

    // ── Phase 2: settling down and domestication (Winterhalder & Kennett 2006: cultivate when it pays better) ──
    packingKm2: 0.091,          // Binford's packing threshold: residential mobility severely constrained (9.1 /100 km²)
    sedentaryWild: 0.4,         // dense, storable wild stands count as a reason to stay (or wetland, coast, lake shore)
    forageDecline: 0.5,         // foraging returns fall this much from empty land to full (diminishing returns)
    cultivatedYield: 0.35,      // cultivating wild plants yields this share of domesticated returns, rising to all of it…
    domesticationYears: 2000,   // …over this long (non-shattering cereals: ~2000 yr of cultivation; Purugganan & Fuller 2009)
    wildMin: 0.3,               // stands poorer than this are not cultivated
    // Someone starting to cultivate is a rare event, likeliest at the best stands: a hazard per km² and year ∝ W^onsetPower
    // (W, the wild stands' suitability) — so a few regions begin, thousands of years apart, and their farmers' fronts
    // reach most others before they begin themselves (the record's ~10 centres, 11.5–4 ka)
    onsetPerKm2Yr: 2e-8,        // at W = 1 and twice the packing density: a 100 000 km² region of the best stands begins within ~500 yr
    onsetPower: 6,
    onsetCrowding: 1,           // and ∝ (density / packing threshold)^this, at most ×4: the crowded (Natufians) begin first
    centreKm: 400,              // domestication cells of one package this close are one centre
    cultivationFromBP: 13000,   // cultivation began in the late glacial's warm spells (Abu Hureyra ~13 ka; Hillman et al. 2001)

    // ── Phase 3: farming spreads (demic, ~1 km/yr; Pinhasi, Fort & Ammerman 2005) ──
    rFarmer: 0.03,              // farmers grow faster (the Neolithic demographic transition; Bocquet-Appel 2011)
    frontFarmKmYr: 0.7,         // (Europe's average 0.6–1.3 km/yr includes the coastal and river leaps below)
    frontFarmCoastKmYr: 4,      // leapfrogging along coasts (Impressed Ware's pulse: 7.5–10.6 km/yr; Isern & Fort 2012)
    frontFarmRiverKmYr: 1.5,    // and rivers (the LBK: ~1–5)
    // slower where the package's climate suits it less (its Köppen weight 0 → this share of the speed, 1 → all of it): the
    // crops' adaptation to cold and long days held farming at the North European plain ~1000 yr (Bocquet-Appel et al. 2009)
    farmClimateFloor: 0.2,
    // the share of the country in fields (farmers per km² of farmland → per km² of country): early farmers' regional
    // densities were a few per km² (the LBK ~1–5; Zimmermann et al. 2009), world ~5–20 M by 7 ka (HYDE 3.2)
    cultivatedShare: 0.01,
    alluviumShare: 0.12,        // and of an irrigated alluvium, at its fullest: Sumer's plain ~30 per km² (Ur III: ~1 M on ~35 000 km²)
    // irrigation: a package's farmers learn it this long after its first centre (wheat ~10.5 ka → Samarra's canals ~8 ka);
    // until then they cannot farm a desert's alluvium at all (Sumer's ~8 ka, Egypt's valley ~7.5 ka), only a wetter one's
    irrigationDelayYears: 2500,
    irrigationRampYears: 3000,  // and the canals grow to their fullest over this long (Samarra ~8 ka → Ur III ~4.1 ka; Adams 1981)

    // ── cradles: where an Ur could arise (plans/CIV_PLAN.md §6, check 1) ──
    cradleMinKm2: 5000,         // an irrigable alluvium at least this big (Egypt's valley and delta ~30 000 km²)
    cradleRingKm: 250,          // circumscription read on a ring this wide around it (Carneiro)
    cerealReachKm: 1000,        // wild cereals within this (the hilly flanks are 300–800 km from Sumer)
    cerealCore: 0.6,            // suitability that counts as a wild-cereal zone
    resourceReachKm: 2000,      // raw materials within this (Sumer's tin came from ~2000–2500 km)

    // ── Phase 4: towns, their size, polities (settle.js) ──
    // A town is fed by its own fields — within an hour's walk, on part of the land (Chisholm 1968; Vita-Finzi & Higgs 1970)
    // — and by grain brought in: overland only a little way, by river and coast much further (ORBIS's costs, land : river :
    // sea ~ 30–40 : 4–5 : 1; Scheidel 2014). So a rain-fed town tops out near ~100–120 ha, a few thousand people
    // (Wilkinson 1994), and a river city on an irrigated plain reaches Uruk's tens of thousands (Algaze 2008).
    feedKm: 5,                  // its fields: within this…
    fieldShare: 0.5,            // …this share of the land in them (the rest fallow pasture, marsh, houses, roads)
    importKm: 40,               // grain brought in: overland this far, at most (falling off linearly)…
    riverCostShare: 0.25,       // …a navigable river's km costing this many land km (both ways: down with the current, up by towing)
    coastCostShare: 0.125,      // …a coast's, this many
    navigableM3s: 100,          // a river this big carries boats
    surplusShare: [0.1, 0.25],  // the share of a district's people its harvest can spare for a town: rain-fed, irrigated
    // the share of a district's people who come to live in its town: rain-fed, irrigated — the irrigated alluvia's countryside
    // emptied into walled cities (Adams 1981: ~80 % urban in Early Dynastic Sumer)
    nucleation: [0.2, 0.6],
    townMin: 150,               // a settlement smaller than this is a hamlet, not counted
    // tiers of size (people): village, large village, town, city — Kosse 1990's ~150 / ~500 / ~2500, then ×6 (Johnson's
    // scalar stress); a polity with all three tiers above the village is a state (Wright & Johnson 1975)
    tiers: [150, 500, 2500, 15000],

    // ── Phase 4: polities, by war and collapse (polity.js), every polityStepYears ──
    polityStepYears: 100,
    townDriftKm: 40,            // a town's site moving this far (land km) is the same town
    warKm: 60,                  // towns this close (land km; less by water) are neighbours: they may fight
    warPerCentury: 0.5,         // a pair of neighbours fights this often a century on full land (× density / capacity)
    // power: 1 + warBeta × (people in its towns / warPowerPeople) × e^(−km from its capital / strengthKm) — Turchin et al.
    // 2013's P = 1 + β Σ traits (β = 1), its people standing in for the traits; Boulding 1962's loss-of-strength gradient
    warBeta: 1,
    warPowerPeople: 10000,
    strengthKm: 300,
    warLuck: 0.5,               // the fortune of war: each side's power × e^(this × a standard normal draw) (ours)
    warElevation: 4,            // the defender's power + this per km of height (Turchin et al. 2013: γ = 4) [V]
    // a beaten town is absorbed with a chance rising from 0 to 1 over this cost to free farmland (land km; Carneiro 1970)
    exitKm: [30, 150],
    freeShare: 0.5,             // farmland is free to settle where it holds under this share of what farming feeds
    // a polity breaks up this often a century, and this much more for each town past its capital (Turchin et al. 2013's
    // δ₀ + δ_s·size, without its traits' δ_a)
    collapseBase: 0.05,
    collapsePerTown: 0.01,
};

/** Literature ranges each constant may be tuned within (Earth test, plans/CIV_PLAN.md §6). */
export const CIV_PRIORS = {
    foragerSlope: [7e-4, 1.2e-3],
    foragerIcept: [-1.9, -1.2],
    aquaticCoast: [1.5, 5],
    aquaticMax: [3, 10],
    rainfedMinMm: [150, 300],
    rainfedYield: [400, 1000],
    irrigatedYield: [900, 2500],
    irrigRiverM3s: [50, 400],
    seedRatioRainfed: [3, 10],
    seedRatioIrrigated: [15, 30],
    grainPerPersonKg: [200, 300],
};
