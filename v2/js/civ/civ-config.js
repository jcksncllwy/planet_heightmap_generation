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

    // ── the resources (plans/CIV_PLAN.md §9.2; substrate.js food) ──
    // the wild: the plants' share of the land's food, at low and high effective temperature (Binford 2001: hunting dominant
    // below ET ~12, gathering above ~15) [L]
    wildPlantShare: [0.15, 0.7],
    // the crop classes' yields (grain-equivalent kg/ha, by food energy) at their best with low inputs, their fallow and seed
    // ratios: Neolithic cereals as rain-fed above; millets' seed ratio high (a small seed, ~1:50); roots and tubers ~6–10
    // t/ha fresh at ~30 % dry matter, a long swidden fallow (Ruthenberg 1980); tree crops perennial, under a share of shade;
    // paddies renewed by their water, little fallow (Bray 1986) [L]
    cropFood: {
        winterCereal: { yieldKg: 650, fallow: 0.5, seedRatio: 6 },
        summerCereal: { yieldKg: 600, fallow: 0.5, seedRatio: 20 },
        roots: { yieldKg: 1500, fallow: 0.7, seedRatio: 8 },
        tree: { yieldKg: 500, fallow: 0.3, seedRatio: 50 },
        flooded: { yieldKg: 1200, fallow: 0.3, seedRatio: 25 },
    },
    // herds: grass NPP (t dry matter/km²) × the share grazed, held through the drought years (a herd is stocked for the bad
    // years, not the mean: Sandford 1983) ÷ a tropical livestock unit's intake (250 kg, ~2.3 t/yr) ÷ the TLU a pastoralist
    // lives on (Dahl & Hjort 1976: ~4–5 a person on milk) — set so the drylands' pastoralists come out at ~0.5–2 /km², as
    // before modern veterinary care and wells (Mongolia's 1918 census ~0.4; Turkana ~1; East Africa's savannas now 2–6,
    // Coughenour et al. 1985) [L]
    grazeUse: 0.03,
    tluIntakeT: 2.3,
    tluPerPerson: 4.5,

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
    // before ~60 ka, then ~100 (Sahul; Bird et al. 2019; Okinawa's ~35 ka, Cyprus's ~12 ka are no wider). No forager went
    // further: the open ocean is the voyagers' (below)
    frontSeaKmYr: [[70000, 1.5]],
    crossingKm: [[70000, 30], [60000, 100]],
    // Voyaging: open-ocean crossings were farmers' — the outrigger and the sail, crops and animals carried to plant an
    // empty shore (the Austronesians: rice and millet farmers on the south China coast by ~7 ka, Taiwan ~5 ka, Lapita's
    // ~850 km gaps from ~3.3 ka, Remote Polynesia's 2000+ km legs by ~1 ka; Kirch 2017, Bellwood 2017). It came slowly:
    // the first farmers held a coast by ~10.5 ka (the Levant), and for ~7000 years after, crossings stayed short — ~100–200
    // km (Cyprus, Cuba ~7 ka) — until Lapita's leap past the ~350 km of open sea into Remote Oceania, ~850 km within a
    // few centuries. So from when farmers first farm a coast, voyagers learn to cross further — years since → km — and
    // then sail at Lapita's pace, carrying every crop farmed on a coast by then…
    voyageKm: [[0, 100], [7000, 200], [7300, 900], [9500, 2000]],
    voyageSeaKmYr: [[0, 1.5], [7000, 1.5], [7300, 10]],
    // …and settle only land no one holds yet (with the best-fitting of their crops; where none grows they forage, as the
    // Maori's moa-hunters did beyond the kūmara's range)
    habitableKm2: [0.005, 0.05], // the front slows over thin land (capacity, persons/km²) and stops below the first
    coldET: 12,                 // and stops where Binford's effective temperature (the glacial one) is under this…
    // …until cold-climate kit (tailored clothing, needles, storage) — the colder, the later: by how far under (°C), when it
    // opens (years BP). Europe and southern Siberia ~45 ka, the Russian plain ~42, the Arctic ~32 (Yana), Chukotka and
    // Beringia's far end after the glacial maximum (the Beringian standstill)
    coldOpensBP: [[3, 45000], [4.5, 40000], [5.5, 32000], [6.5, 20000]],

    // ── Phase 2: settling down and domestication (Winterhalder & Kennett 2006: cultivate when it pays better) ──
    packingKm2: 0.091,          // Binford's packing threshold: residential mobility severely constrained (9.1 /100 km²)
    sedentaryWild: 0.4,         // dense, storable wild stands count as a reason to stay (or wetland, coast, lake shore)
    domesticationYears: 2000,   // cultivation to domestication (non-shattering cereals: ~2000 yr; Purugganan & Fuller 2009)
    wildMin: 0.3,               // stands poorer than this are not cultivated
    // Someone starting to cultivate is a rare event, likeliest at the best stands, used hardest: a hazard per km² and year
    // ∝ (W·u)^onsetPower (W, the wild stands' suitability; u, their share of the diet against useShare) — so a few regions begin, thousands of years apart, and their farmers' fronts
    // reach most others before they begin themselves (the record's ~10 centres, 11.5–4 ka)
    onsetPerKm2Yr: 2e-8,        // at W·u = 1: a 100 000 km² region of the best stands, used to the full, begins within ~500 yr
    onsetPower: 6,
    // …easing, the longer a people has lived settled and packed, to this over this long: population pressure turns people
    // to poorer plants (Cohen 1977; Binford 2001's packing → intensification). The best stands still go first; the
    // middling ones go late, where no farmers reached first — New Guinea's ~8.5 ka, the Andes' ~7, eastern North
    // America's ~4.5 (Larson et al. 2014)
    onsetPowerLate: 3,
    onsetEaseYears: 3000,
    chanceSeed: 0,              // the rare events' draws (onsets, landings): another seed, another history of the same world
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

    // ── good and bad years (climate-var.js): the planet's climate run again under its modes of variability ──
    varGridDeg: 2,              // the ensemble's climate grid (°): coarse is enough for rain belts' shifts
    modeWm2: 2,                 // one standard deviation of each mode's forcing (W/m²): calibrated on Earth's year-to-year
                                //   rain (the Sahel ~25 %, India's monsoon ~10 %; CIV_SOURCES §Climate variability)
    modeRho: 0.4,               // a mode's year-to-year persistence (lag-1 correlation): droughts come in runs
    eventMm: 20,                // rain per storm: CV = 1/√(P/eventMm) (Conrad 1941's curve)
    regionDeg: 2,               // a storm region (°): one year's storms are shared over it
    fuW: 2.6,                   // Fu's runoff curve's shape (Zhang et al. 2004: ~2.6 on average)
    riverSnapKm: 60,            // a world river point takes the strongest routed flow within this
    // a year's harvest against a normal one, and what the settled do about it (sim.js)
    floodHigh: 1.4,             // a flood this far above the usual breaks the banks: the river's harvest falls …
    floodDamage: 1,             // … by this per unit of flood beyond it (the Nile's high floods: Bell 1970; ours)
    aquaticSteady: 0.5,         // settled foragers by water: this share of their food (fish, fowl, shellfish) is steady
    storeYears: 1,              // farmers store up to a year's food (Halstead & O'Shea 1989: the normal surplus) …
    storeYearsForagers: 0.5,    // … settled foragers half that
    famineDeath: 0.3,           // deaths per year of food short beyond the store (Ó Gráda 2009's famines: ~5–15 % dead in
                                //   one or two years of a quarter to a half short; ours in form)
    famineMaxYear: 0.5,         // at most this share dies in one year
    // herds (sim.js herdYear): a drought's die-off and the slow regrowth (droughts take 30–60 % of the herds; mixed herds
    // rebuild in 3–4 years, small stock faster, cattle slower: McCabe 1987, Turkana; Marsabit 2009–11; FAO) [L]
    herdDieOff: 1,              // the share of the animals the year's grazing can't carry that die
    herdRecovery: 0.4,          // the herd's regrowth a year (logistic): from half to ~90 % in ~5 years

    // ── the economy (plans/CIV_PLAN.md §9.3; econ.js) ──
    useShare: 0.2,              // a resource at this share of the diet is in full use: skill and domestication at their full pace
    skillSeed: 0.3,             // the skill of those who first cultivate a wild stand, or keep a wild herd (ours)
    skillYears: 200,            // a skill is learnt over a few generations of full use (ours: the organism is the slow part)…
    forgetYears: 500,           // …and fades over this long unused (ours)
    // complex skills (farming, herding) held at most N / (N + skillPeople), N the people within contactKm: Henrich (2004)'s
    // threshold population, in our form (disputed: Vaesen et al. 2016)
    skillPeople: 500,
    contactKm: 50,
    contactShare: 0.5,          // a step's mixing toward the skill of the people a cell's came from (ours)
    cropMinSuit: 0.15,          // a domesticated crop or herd goes only where it grows this well (of its best)
    // cultivation before domestication spreads from where it began at this share of a farming front's speed, within the
    // wild form's range (the protracted model: cultivation began at many places, Allaby et al. 2017) [ours]
    cultivationSpread: 0.25,
    // the share of the country in fields at full use: early farmers' regional densities, a few per km² (the LBK ~1–5;
    // Zimmermann et al. 2009) — as the switches' cultivatedShare (2.5 % gave Earth ~25× HYDE at 8 ka)
    fieldLand: 0.01,
    // herds: wild ones are managed over their range (Zeder 2008: in the Zagros, managed hunting before the herds changed);
    // once domesticated, settled people's graze this share of the land (at most the open country): the fallow, the
    // stubble and the commons — a mixed farm's small herds, bound to its fields (Halstead 1981; Bogaard 2004) [ours]
    herdNear: 0.05,
    // pastoralists — once they live on milk (Dahl & Hjort 1976) — follow theirs over all the open country, growing this
    // share of the crops they could (Khazanov 1984: trading for grain); only where the rain's year-to-year CV reaches
    // mobileCV, where mobility pays (Ellis & Swift 1988's non-equilibrium rangelands), or where no crop grows (the cold)
    mobileCrops: 0.1,
    mobileCV: 0.33,
    // herds feed on their meat alone at first (this share of a dairy herd's people), and on their milk by use over dairyYears
    // after domestication: the secondary products (Sherratt 1981; milk residues by ~9 ka in Anatolia, Evershed et al. 2008;
    // specialised herders on the steppe and in the Sahel ~6–5 ka) [L]
    herdMeat: 0.25,
    dairyYears: 3000,
    treeWild: 0.6,              // the wild tree crops' stands at their best, and wild rice's and taro's (ours; the wild
    floodedWild: 0.4,           //   cereals' 1 and 0.8, PACKAGES' abundance; at 0.8 every warm marsh was a centre of them)

    // ── disease (disease.js): a share of the people a place would hold ──
    filterWarm: 0.5,            // the parasites pass only through country this suited to transmission by its warmth
    feverLoss: 0.25,            // vector fever where fully suited (ours: malaria's share of deaths where holoendemic,
                                //   ~a quarter of children's; Carter & Mendis 2002)
    snailLoss: 0.1,             // snail fever on warm irrigated land (ours)
    foragerExposure: 0.3,       // foragers on the move are this exposed (Livingstone 1958: settled farming made malaria)

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
    // famine: a century's famine deaths (share of the people) beyond the place's norm (a running mean over
    // famineNormYears) raise war's odds × (1 + warFamine × it) and add collapseFamine × it to the collapse rate (ours,
    // after Zhang et al. 2007, Hsiang et al. 2013 and Turchin & Nefedov 2009)
    famineNormYears: 500,
    warFamine: 10,
    collapseFamine: 3,
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
