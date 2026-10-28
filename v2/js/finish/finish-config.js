// Tunable constants of the Finish step (plans/V2_FINISH_PLAN.md): the expensive, on-request sculpting of one moment.
// Everything in km, Myr, °C and mm — never in cells — so a moment finished at 160K and at 10M is the same planet, the
// finer one showing more of it.

export const FINISH = {
    // ── F1: warp and detail ──
    warpKm: 14,                 // the whole surface domain-warped by up to about this (breaks the last of the sim's lines)…
    warpScaleKm: 150,           // …in waves about this long, and half and a quarter of it
    craggyKm: 0.05,             // fine relief on high, steep ground (none on the plains), ± this at 3 km up…
    craggyFromKm: 40,           // …from this wavelength down to what the mesh can show

    // ── the rivers: the carve run longer, with the climate's runoff ──
    carveTimeMyr: 1.0,          // (the timeline's 0.75; 1.2 cut trunk canyons too deep beside uncut ground — developer)
    carveRounds: [3, 2, 2, 2, 1],
    // runoff = rain − evaporation (Budyko's curve in Fu's form, ω), potential evaporation from the annual temperature
    petBaseMm: 300,             // potential evaporation at 0 °C…
    petPerC: 55,                // …plus this per °C (~1700 mm at 25 °C)
    petMinMm: 60,
    budykoW: 2.6,
    rainMaxMm: 6000,            // the climate's rain, for the finish's erosion, at most this (its grid has rare hotspots of
                                // 10 000–70 000 mm a year: ~0.2 % of land — Earth's wettest places get ~12 000)
    runoffFloor: 0.1,           // a desert's rivers still count this share of the mean (old wetter climates cut the wadis)…
    rainShare: 0.3,             // …and the drainage is weighted this much by the rain itself, the rest by the runoff (developer:
                                // "even deserts should get rivery erosion (even a little) cuz it gets some rain")
    wetPower: 0.5,              // the drainage's weight grows as this power of the (relative) water, at most wetMax times the
    wetMax: 2.5,                // mean: linear, the wettest regions carried ~10× the mean — valleys and grading far beyond the
                                // live terrain's, the land there "unnaturally blurry" (developer)
    // rivers wander: a fine relief the rivers are routed over (not the heights), from this wavelength down to what the mesh
    // shows, this high — so channels meander and bend instead of running straight down smooth slopes
    meanderKm: 0.03,
    meanderFromKm: 60,
    // dissection everywhere (developer: cutting "isolated … some mountains look blurry and not cut in"): every drainage
    // line cut in by a share of how steep the ground is — mountains dissected all over down to the mesh's own valleys,
    // plains calm; the ridges between them (the cells nothing drains into) kept. Its deepest cut, on steep ground: the
    // erosion strength's dissectKm (below)…
    dissectSlope: [0.02, 0.25], // …by the ground's steepness (km per km)…
    dissectKm2: [300, 8000],    // …and by the area draining there (km²: a ridge … a valley; 1.5 and 40 cells at 2.5M — in cells
                                // until 2026-10-15, so finer detail cut finer, shallower valleys)

    // ── how strongly the finish erodes the mountains (developer, 2026-10-15: "strengthen the erosion in a final detail pass,
    // particularly the fancy generated erosion we adapted from the paper, but not too much … break up SOME of the
    // monotony of the ridges"): 0 as it was … 3. The stream power (carve.js; Tzathas et al. 2024: erosion a wave climbing
    // each river at k·A^m) reaches further up the headwaters — m lower, k raised so a river draining erosionPivotKm2 cuts as
    // before; the dissection cuts deeper; soil creep rounds less; and the fold belts' crests stand harder, so the valleys
    // deepen between them rather than the ridges wearing away. The timeline's terrain is untouched
    erosionStrength: 3,
    erosionPivotKm2: 1e5,
    erosionLevels: {            // at strength 0, 1, 2, 3 (between them, linear)
        carveM: [0.4, 0.35, 0.3, 0.25],
        dissectKm: [0.35, 0.45, 0.55, 0.65],
        creepKm: [10, 8.5, 7, 5.5],
        crestHardness: [0.5, 0.55, 0.6, 0.65],
    },

    // ── F2: closed basins — a basin whose inflow cannot make up what its lake would lose to evaporation stays closed:
    // a flat salt pan or playa at the level where the two balance, the rivers of its catchment ending there ──
    basinMinKm2: 3000,          // (smaller hollows are left to the rivers — a hollow's sub-basin too: no lake of its own, filled
                                // by what its rivers bring, its water passing on; finish-basins.js hollowLakes)
    // ── F2: sediment — what the rivers cut, carried down and laid where they slow: fans at the mountain front,
    // floodplains, deltas at the sea ──
    sedimentShare: 0.35,        // the share of the eroded rock that travels as bedload (the rest is fine and reaches the sea)
    capacityK: 15,              // bedload a reach can carry: capacityK · drainage (km²) · slope — a river carries what it cut
                                // down its mountain slopes and drops it where it slows (below a slope of ~0.002)
    fanSpreadKm: 20,            // deposits spread over about this (fans and aprons, not ridges along the channel)
    deltaShare: 0.03,           // the share of a river's load built into a delta above the sea (the rest on the shelf)
    deltaTopKm: 0.004,          // a delta plain stands this high
    deltaMaxDepthKm: 0.15,      // …and grows only over the shelf
    // ── F2: hillslopes by climate — soil creep rounds the hills where it is wet and warm; deserts and cold ground stay
    // sharp ──
    // (its rounding, σ at full wetness: the erosion strength's creepKm, above)
    creepRainMm: [300, 1200],   // wetness from the annual rain…
    creepTempC: [-5, 10],       // …and the annual temperature

    // ── F3: the last ice age, Earth-like ──
    iceColdEqC: 3.5,            // colder than now at the equator…
    iceColdPoleC: 16,           // …and at the poles (polar amplification: ~ (|lat|/90)^1.5 between)
    iceDrier: 0.3,              // precipitation lower by up to this share toward the poles
    iceSeaDropKm: 0.12,         // the sea ~120 m lower: shelves bare, ice grounded on them
    iceGroundedKm: 0.4,         // ice grounded on the sea floor down to this depth where it spread from land
    iceMarginC: [2, 6],         // ice flows past its snowline into summers this much warmer: a glacier's tongue … an ice sheet's lobe
    iceSheetKm2: [3e4, 1e6],    // (by how big the snowfield it flows from is)
    iceNyeKm: 0.015,            // ice thickness √(iceNyeKm · distance to the margin), km (a plastic ice sheet: ~3.9 km at 1000 km)
    iceMaxKm: 4.5,
    troughKm: 0.6,              // deepest trough a glacier cuts (at the largest ice flux; 1.1 was too deep — developer)…
    troughFluxKm2: [2e3, 2e5],  // …from its snowfield's area
    troughWidthKm: [3, 14],     // a trough's half-width, small glacier → ice stream
    // the ice cuts where it slides fast: outlet glaciers and ice streams near its margins, down the land's own valleys (it
    // is steered by the bed) — not across the frozen interior of a sheet along its dome's straight flow lines
    iceCutsWithinKm: [250, 40], // (full within the second of the margin, none beyond the first)
    troughSoftGain: 0.5,        // a trough this much deeper per unit of the rock's softness above ½ (terrain/records.js iceSoft)
    // basins: an ice lobe sliding over soft rock digs it out broadly (the Great Lakes, the Baltic, the shield-edge lakes)
    basinKm: 0.5,               // the deepest a basin is dug (Superior's floor ~0.4 km below sea level, ~0.6 below its rim)…
    basinFeedKm: [10, 40],      // …where this much snowfield (km²) feeds each km of the ice's width (from the first, full by
                                // the second: a lobe's trunk; an ice sheet's median ~40)…
    basinWithinKm: [700, 300],  // …sliding near its margin (none farther in than the first, full within the second)…
    basinLipKm: [10, 80],       // …but shallowing toward the snout, where the ice thins (none at the margin, full by the
                                // second): the rim that holds the lake once the ice is gone…
    basinSoftPower: 2,          // …and the rock is soft (softness to this power: the platform's shales, not the shield)
    basinSmoothKm: 70,          // a lobe's breadth: its trunk's flux blurred over this
    basinCoreKm: 0.06,          // a basin: the cells dug at least this, joined — each cut below its rim's lowest ground…
    basinMaxCutKm: 0.8,         // …by at most this in all (a basin on steep ground holds its lake in its lower end)
    basinLowKm: [1.2, 0.5],     // …on lowland: the region's ground (blurred basinLowBlurKm) none above the first, full below the second…
    basinLowBlurKm: 150,
    basinSillKm: 40,            // …inland, behind a sill this far from the coast the ice did not dig (a basin open to the sea is a sound)…
    basinMaxKm2: 100000,        // …each a lobe's, at most this big (Superior 82,000 km²): a bigger one split where it was dug deepest…
    basinSplitStep: 1.25,       // …its core raised by this factor at a time
    basinRim: 0.15,             // hard rock in a basin is cut this share as deep as soft (the escarpments stand)
    iceSteer: 0.06,             // the ice routed over the bed plus this share of its thickness (its surface's pull)
    scourKm: 0.07,              // an ice sheet scours hollows this deep in its bed (lake districts on shields)…
    scourScaleKm: 45,           // …about this far apart
    moraineKm: 0.06,            // end moraines at the ice's farthest reach, and outwash plains beyond
    reboundLeft: 0.08,          // of the ice's weight (ρi/ρm × thickness), this share not yet rebounded (Hudson Bay, the Baltic;
                                // 0.2 sank basins that held vast lakes)…
    reboundKm: 350,             // …spread by the lithosphere over about this
    // ── F3b: outburst floods from the ice-dammed lakes (finish-floods.js; 0 floodCutKm: none) ──
    floodLakeMinKm2: 5000,      // an ice-dammed lake floods if at least this big…
    floodVolumeKm3: [20, 5000], // …and holding this much water above where the bare ground would hold it (a jökulhlaup …
                                // Lake Missoula's ~2 500): the flood's strength grows over this range, by the log
    floodCutKm: 0.25,           // the deepest a flood scours (the Scablands' coulees: 50–250 m)…
    floodWidthKm: [8, 45],      // …and its swath's half-width, a small flood → the greatest
    floodReachKm: 1500,         // a flood's strength fades over this far down its way
    floodSpillShare: 0.7,       // the spillway's flood, of the dam failure's
    floodUnderIce: 0.6,         // where it runs under the ice (tunnel valleys), of its strength in the open
    floodThreadKm: 40,          // the braided channels: about this far apart (wider than the Scablands' — shown from 2.5M cells)…
    floodThreadWidth: 0.12,     // …and this wide (of the noise's range on either side of its zero lines)
    floodTractShare: 0.35,      // the whole swath is scoured this share of the channels' depth (the land left between them)
    floodNotchKm: 0.25,         // the sill a lake spilled over notched at most this much below the swath…
    floodNotchReachKm: 150,     // …within this of the lake
    floodFloorKm: 0.03,         // a flood never cuts the land below this (on a lowland by the sea it lays its gravel down)
    floodRock: 0.6,             // the scoured ground's bare rock on the satellite view, of the flood basalt's tint
    lakeSiltShare: 0.3,         // a drained lake's floor raised by this share of the water over it…
    lakeSiltMaxKm: 0.04,        // …at most this: a flat plain of lake silts

    // ── R1: rivers and lakes (finish-hydro.js) ──
    riverMinM3s: 8,             // a river is traced from this discharge (the page draws from its own threshold, above it)
    riverWidthPerSqrtQ: 5,      // a river's width (m) per √(m³/s) — hydraulic geometry (Leopold & Maddock)
    bedLossMPerYear: 20,        // what a river's bed loses where it is fully arid (m a year over its width: seepage and
                                // evaporation — the Nile loses ~10 % over 1800 km of desert)
    lakeEvapShare: 1.2,         // open water evaporates this much of the land's potential evaporation (Penman 1948: a grass
                                // cover transpires 0.6–0.8 of open water's E0, so E0 ≈ 1.25–1.7 × the land's; with petBaseMm,
                                // petPerC: ~1.1 m a year at the Caspian's 12 °C — it loses ~1 m, Rodionov 1994 — ~2 m at the
                                // Dead Sea's 25 °C — 1.5–2 m, Salameh & El-Naser 1999). The closed basins' balance too
    lakeMinKm2: 300,            // a hollow is a lake from this size… (150 and 5 m: "too many lakes" — developer)
    lakeMinDepthM: 15,          // …and this depth; and only where it has an origin — scoured by the ice age (lake districts),
                                // or a hollow of the tectonic surface (rifts, forelands, closed basins: this share of its
    lakeTectonicShare: 0.25,    // cells, the tectonic surface's hollows at least tectonicHollowKm deep); the finishing's own
    tectonicHollowKm: 0.1,      // hollows (fans, loess and dunes damming valleys) are filled: flat valley floors
    breachKm: 0.6,              // an old basin that overflows has cut a gorge this deep through its rim (at most)…
    breachQ: [10, 1000],        // …by what spills over (m³/s): none below the first, full from the second…
    glacialBreachShare: 0.5,    // …half as deep in the ice age's own (young) hollows, and only by big rivers (glacialBreachQ, m³/s):
    glacialBreachQ: [500, 5000], // a big river breaks through its lakes, a small one keeps its lake district
    // which lakes stay (developer: "every river needs to end at ocean not lake"): a lake on a river is cut through to its
    // floor unless its river fills it and it is at least lakeKeepKm2 × √(inflow / 1000 m³/s) big (the ice age's lakes
    // glacialKeepShare of that). A basin its rivers cannot fill stays closed, at any height (2026-10-28)
    lakeKeepKm2: 5000,
    glacialKeepShare: 0.5,
    // a hollow the ice dug in soft rock (its basin, finish-ice) is a lake where at least basinLakeShare of its cells were dug
    // over basinLakeKm, and kept if its river fills it and it is basinKeepShare of lakeKeepKm2 × √(inflow / 1000 m³/s) —
    // the Great Lakes hold a river many times their size would cut through anywhere else
    basinLakeKm: 0.05,
    basinLakeShare: 0.25,
    basinKeepShare: 0.1,
    // Where a river must cut through — a basin it drains, a pocket in it — its gorge keeps the river's own course, every bend
    // of it, unless a shortcut is enough less work: the rock it cuts, and gorgeLengthKm for each km of its length (developer:
    // rivers "that go back and forth"; then "there should be some balance … between the 'true down' path and the 'shortcut'
    // path … Some windyness is good"). How direct: along its own course a river does only this share of the work, so a bend is
    // cut through only where the way round is over 1 / this times the shortcut (0.5: a detour twice as long); 0 keeps every
    // course as it was, 1 takes the way of least work
    riverDirectness: 0.1,
    gorgeLengthKm: 0.02,
    seaCutKm: 0,                // a basin below sea level opens into the ocean if its cut through dry land is at most this long
                                // (0: never — developer: a small trapped sea is "NOT a valid end it should go out to the real sea")…
    seaCutFloorKm: 0.003,       // …else its gorge stops this little above sea level (no arm of the sea winding inland); the
                                // ground it leaves below sea level is filled in to there (no dry land below sea level)
    // inland seas (2026-10-15, developer: inland seas "COMPLETELY dried out … leaving holes in the ground"): a body below
    // sea level behind a low, short barrier is a sea the mesh cannot connect — a strait narrower than its cells, low land
    // the carve keeps at its 2 m floor — opened into the ocean along the way it would spill, by a smooth weight on the
    // barrier's height and its length over dry land (open below the first of each, closed beyond the second)
    straitSillM: [3, 30],
    straitKm: [40, 160],
    straitDepthKm: 0.02,        // …the strait cut this far below sea level
    // a basin below sea level cut off from the world ocean is a remnant of the sea (finish-basins.js): its surface is set
    // by its water balance — the runoff of its catchment and the rain on it against what evaporates off its water — not
    // by sea level. Full to its rim, it spills on (a fresh lake whatever its size); short of it, a salt lake at its own
    // level, below sea level as the Caspian's and the Dead Sea's are, or — where next to nothing flows in — a playa on its
    // floor, the basin round it dry ground below sea level (the Qattara; the Messinian Mediterranean). Its floor is the
    // history's, filled by its rivers while it was cut off (tectonics/step/sea-fill.js). (Until 2026-10-27 it was filled
    // here as well toward 1 km below its rim, and a playa's toward 120 m; a salt lake needed a big basin for its river or
    // an old floor 0.2–0.5 km deep — seaFillKm, panDepthKm, panFlatShare, saltSeaDeepKm)
    seaBasinKm2: [5000, 20000], // a remnant of the sea: a body below sea level this big (km², from the first to fully the
    seaBasinDeepKm: [0.05, 0.2],// second) and this deep (km) — a smooth weight, the same at every detail; a smaller or
                                // shallower pit — a dip the finer mesh finds — is the land's: its rivers cut it through
    // (the sea is the world ocean — the water below sea level joined to the largest body of it: finish.js oceanMask; until
    // 2026-10-27 any body over 250 000 km² holding water below 1 km — seaSeedKm2, seaDeepKm — was sea, full at sea level)
    wetShare: 0.3,              // a month is wet where its rain passes this share of its potential evaporation (or it freezes)
    // each river's year: each month's runoff — rain, and snow kept until it melts (snowMeltMmPerC per °C above freezing, a
    // month) — less a share of the month's potential evaporation (monthEvapShare); a share of it seeps into the ground
    // (baseflowShare where it is humid, none in deserts) and drains back to the rivers slowly (baseflowMonths: the time a
    // dry season takes to drain the ground to a third); big lakes even out what they pass on (lakeRegulation)
    snowMeltMmPerC: 90,
    monthEvapShare: 0.8,
    baseflowShare: 0.5,
    baseflowMonths: 2.5,
    lakeRegulation: 0.6,
    // regimes: a month is dry when the river carries under dryShare of its mean (or under dryM3s); dry ephemeralMonths or
    // more — dry most of the year; fewer — seasonal; never — permanent, with a flood season if its peak month carries
    // floodRatio × its mean (the Nile, the Ganges, the snowmelt rivers; not the Amazon, the Mississippi, the Rhine). Fed
    // from afar: permanent where the land's rain is under farFedAridity of its potential evaporation
    dryShare: 0.03,
    dryM3s: 0.5,
    ephemeralMonths: 7,
    floodRatio: 2.5,
    farFedAridity: 0.35,

    // ── F5: the coast (finish-coast.js): the waves and their sand, over the interglacials' high seas ──
    coastYears: 30000,          // years of the sea at about its height (the Holocene's 7,000 and the last interglacials')
    coastSteps: 6,              // in this many steps (the waves found again each step, on the coast as it is)
    coastSeaKm2: 1e6,           // the open sea's coasts only: bodies of the sea at least this big (not the hollows below sea level
                                //   the ice dug inland, dry until the rivers fill them)
    waveDirs: 16,               // directions the waves are traced from
    waveStormShare: 1,          // the storms' winds about the months' mean (rain.js: gustiness, Eady rate × size): the waves grow
                                //   in the gales, not in the mean wind — the westerlies' seas, not the trades'
    waveSatK: 1e-4,             // a fully developed sea's power, kW/m per (m/s)⁵ (Pierson–Moskowitz: Hs 0.021 U², Te 0.45 U)…
    waveFetchK: 2.25,           // …reached over this many km per (m/s)² of fetch (JONSWAP: gF/U² ≈ 2.2·10⁴)
    swellDecayKm: 4000,         // swell's energy fades over this (e-folding; Ardhuin et al. 2009)
    waveFarKm: 4500,            // the open sea traced this far, on the climate's grid…
    waveFarStepKm: 150,
    waveNearKm: 300,            // …and the last of the way on the mesh, its headlands and islands sheltering
    cliffK: 0.6,                // cliff retreat, m/yr: cliffK · wave power (kW/m) · erodibility / (cliff height + toe, m)
    cliffToeM: 10,              //   (soft rock under 50 kW/m: ~1 m/yr at a 20 m cliff — Holderness, the Norfolk cliffs)
    cliffHardRatio: 1e-3,       // erodibility: 1 in the softest rock, this in the hardest (records.js iceSoft)
    coastMaxShare: 0.5,         // no more than this share of a cell cut back in a step
    platformKm: -0.01,          // cut down to a wave-cut platform this deep
    cliffSandShare: 0.5,        // of the rock cut, the sand and gravel the drift moves (the rest is mud, lost offshore)
    coastRiverSand: 0.1,        // of a river's load at its mouth, the sand the waves take along the shore
    coastSandKm: 0.001,         // loose sand on the shore at the start (km thick over a cell: ~0.015 km³ per km of coast at
                                //   2.5M — a beach and shoreface's prism)
    longshoreK: 2.5e-4,         // longshore drift, km³/yr per kW/m of deep-water power · cos^1.2 α · sin α (CERC 0.39,
                                //   refraction and breaking: a fifth of the deep water's)
    driftAlign: 0.2,            // the drift passes to the shore cell most along the shore, at least this aligned
    beachCrestKm: 0.003,        // sand is laid up to a beach's crest…
    closureKm: 0.06,            // …where the ground under it is no deeper than this (deeper, the waves cannot hold it: lost offshore)

    // ── F4: wind ──
    ergSlope: 0.006,            // sand seas: desert ground flatter than this…
    ergBelowKm: 0.05,           // …and at least about this much lower than its surroundings (sand gathers in basins)
    ergFill: 0.9,               // hollows in a sand sea filled to this share
    duneKm: 30,                 // dune ridges (draa) this far apart, where the mesh can show them (10M; ~4 cells a wave)…
    duneAmpKm: 0.08,            // …and this high
    panKm: 0.03,                // deflation pans in desert plains, this deep…
    panScaleKm: 35,             // …about this far apart
    loessKm: 0.08,              // loess downwind of deserts and the ice age's outwash, up to this thick…
    loessReachKm: 600,          // …over this far downwind
};

// ── the land's cover, as a satellite sees it (plans/V2_SATELLITE_PLAN.md; finish-cover.js) — from each place's twelve
// months. Wetness = rain ÷ potential evaporation (FINISH.petBaseMm, petPerC); warmth from the warmest month; the S-curves'
// ends below ([from, to]) are where a share goes from none to all ──
export const COVER = {
    vegWet: [0.02, 0.28],       // all vegetation (trees, grass, shrub, moss): by the year's wetness… (greener than the
                                // first cut, 0.03–0.4 — developer: "everything looks a bit too dry/not green" — and closer
                                // to Blue Marble on Earth too: July 6.3 → 4.2, January 10.2 → 9.2 per channel)
    vegWarm: [1, 8],            // …and the warmest month (°C: polar desert below, tundra between, full above)
    treeWet: [0.3, 0.85],       // trees: by the year's wetness (savanna and woodland between)…
    treeWarm: [9, 13],          // …the warmest month (the tree line: Köppen's 10 °C)…
    treeSeason: [1, 3],         // …and the growing months (warm and wet enough) — a long dry or cold year has none
    needleCold: [-2, -14],      // needle-leaved: by a cold winter (the coldest month, °C)…
    needleCool: [16, 11],       // …or a cool summer (the warmest month: mountain and maritime conifers)
    evergreenWarm: [4, 16],     // broad-leaved evergreen: by a mild winter (the coldest month)…
    evergreenDry: [3, 7],       // …unless the dry season is this many months long (dry forests shed their leaves)
    growWarm: [1, 8],           // a month green: warm enough (°C)…
    leafWarm: [3, 10],          // …(trees leaf out later)…
    grassWet: [0.18, 0.6],      // …and wet enough (its rain and the soil's water ÷ its potential evaporation; grass…
    treeWetMonth: [0.1, 0.45],  // …trees, with deeper roots)
    soilMm: 150,                // the water the soil holds through a dry spell
    lag: 0.4,                   // a month's look is this much the month before's (greening and browning take time)
    snowPhase: [2, -2],         // snow, not rain: from this °C (none) to this (all)
    snowMeltMmPerC: 90,         // snow melts this many mm a month per °C above freezing
    snowCoverMm: [3, 20],       // snow on the ground (mm of water): first patches → white (≈ 7 cm of snow buries
                                // tundra and grass: the winter Arctic and the steppes white from space; a mild
                                // European January mostly bare)
    snowLossMm: 10,             // a snowpack loses up to this much a month to the dry winter air (thin snow on dry steppes
    snowLossWarm: [-15, 0],     // goes) — the more, the less cold (°C: in a Siberian winter it hardly goes at all)
    snowYear: [0.5, 0.85],      // the year's look: snow where it lies over half the year (patchy) to most of it (white)
    snowUnderTrees: 0.3,        // a full evergreen canopy hides this share of the snow, a leafless one half of it (from
                                // space a snowy taiga is grey-white: Blue Marble, January)
    larchCold: [-25, -38],      // needle-leaved trees that drop their needles (larch): by a very cold winter
    // ice sheets (developer: "the poles, especially when there is land, is frequently not icey, which feels super wrong"):
    // the climate runs on bare bedrock, without an ice sheet's feedback (its kilometres of height and its whiteness keep it
    // cold through the summer) — so where the summer is this cool (the warmest month, °C: none at the first, all at the
    // second) and this much snow falls in a year (mm: none … all; the dry Arctic coasts of Siberia stay bare), the land
    // carries an ice sheet, white in every season; warmer fringes stay tundra (Greenland's coast). (By the year's mean
    // instead, Siberia's and Canada's forests — mean −5…−15 °C, warm summers — turned to ice: the Earth check, July 6 → 16)
    iceSheetTw: [7, 3],
    iceSheetSnowMm: [60, 200],
    // …and the summer that still freezes over warmer toward the pole (the polar night, the ice's own feedback): by up to
    // this many °C, from the first latitude to the second — the poles read icy (developer)
    iceSheetPolarC: 5,
    iceSheetPolarLat: [60, 80],
    // each climate's mean colour on the planet moved this share of the way to its own (Blue Marble's mean per Köppen class
    // and season, finish-cover.js CLIMATE_RGB) — a ratio per class, season and channel (within climateRatio), blurred this
    // far so climates hand over gradually; the cover keeps its detail within the climate
    climateBias: 0.7,
    climateBiasKm: 100,
    climateRatio: [0.33, 3],
    // …strongest deep inside a climate: from none at its edge with another to all this deep (km) — near the edge the
    // cover's own colours, which change smoothly, carry the transition; the depth roughened by noise this strong (km), and
    // the corrections displaced by up to about this (km), both at this size (km) — so the transitions meander
    climateDepthKm: [0, 450],
    climateDepthNoiseKm: 180,
    climateWarpKm: 150,
    climateNoiseKm: 700,
    // the rain the cover reads: each place's year of rain moved this share of the way (in logs) to its surroundings' —
    // blurred over this far (km), warped by up to about this (km), roughened by e^{±this}, at this size (km) — so the
    // green and the bare follow the regional climate, not each cell's own wobble (the climate tabs keep their own rain)
    coverRainShare: 0.5,
    coverRainKm: 80,
    coverRainWarpKm: 110,
    coverRainNoise: 0.2,
    coverRainNoiseKm: 250,
    // variety (developer: "too 'one color' … add noise to shift naturally between a couple colors for each climate and
    // between climates"): each kind of ground tinted by noise between a few natural colours — the same noise everywhere,
    // so it flows across climates. Tints are linear-light multipliers, at full strength varyStrength standard deviations
    // of the noise out: bare ground red (iron-rich) or pale (sand, limestone) by province, dark (basalt, varnish) or grey
    // (gravel, granite) by patch; grass lusher or olive, khaki where the ground is red; trees deeper or olive, needle-
    // leaved bluer in the dark patches
    varySoil: { red: [1.25, 0.9, 0.72], pale: [1.18, 1.16, 1.14], dark: [0.64, 0.64, 0.67], grey: [0.93, 0.98, 1.08] },
    varyGrass: { lush: [0.85, 1.24, 0.72], olive: [0.8, 0.85, 0.64], khaki: [1.26, 1.07, 0.87] },
    varyTree: { deep: [0.72, 1.07, 0.68], olive: [1.27, 1.07, 0.74], blue: [0.82, 0.94, 1.3] },
    varyKm: [900, 260, 400],    // the noise's size (km): provinces, patches, the vegetation's own — domain-warped by
    varyWarp: 0.6,              // this share of its size (so its shapes stretch and wander, like geology, not blobs)
    varyStrength: 1.8,          // (developer: at 1.5 "way too much, tone it down a lot"; at 4.5 "crank up the noise to be like 75%
                                // towards what we had before": the tints' strength goes as 1 / this)
    varyFineKm: 50,             // and a fine mottling of the picture's brightness, this size (km; per pixel)…
    varyBright: 0.031,          // …± this share
    // the ground's own rock and sand (S2): the bare ground tinted (linear-light multipliers) toward the wind's sand seas,
    // its loess, and the flood basalt where it still caps the ground (dark trap rock: the Deccan from space)
    sandTint: [1.22, 1.1, 0.86],
    loessTint: [1.1, 1.05, 0.92],
    basaltTint: [0.5, 0.48, 0.47],

    // ── the terrain in the satellite view (S2, plans/V2_SATELLITE_PLAN.md) ──
    // the cover's temperatures at each place's own full height (the climate takes only part of a place's height above
    // its surroundings — CORE_DEFAULTS.terrainRelief — so its classes are not speckled; tree and snow lines follow it all)
    fullLapse: true,
    // rock and scree where the ground is rugged: from none to rockMax as the height varies this much (km, its standard
    // deviation within valleyKm) — or, where the detail shows cliffs, as steep as this (m per km, over a picture's pixel;
    // a pixel's slope is broad: the land's 99th percentile is ~60 at 640K)…
    rockRelief: [0.1, 0.45],
    rockSlope: [60, 200],
    rockMax: 0.85,
    rockExposure: 0.4,          // …in a warm, humid place only this share of it (forest holds steep slopes); all where dry or cold
    rockWarm: [140, 122, 102],  // the rock: warm brown where it is warm…
    rockCold: [124, 122, 118],  // …grey where it is cold
    rockUnderSnow: 0.6,         // a snowy month keeps this share of the rock (cliffs: snow slides off)
    // in dry country (by its dryness) the slopes facing the pole are greener, those facing the equator barer…
    aspectShare: 0.45,
    aspectSlope: [8, 40],       // …on slopes this steep (m/km, over a picture's pixel)
    // …and the valleys greener, the ridges barer — by the height against the surroundings this far around (km), per
    // valleyKmPerFull km below or above
    valleyKm: 25,
    valleyKmPerFull: 0.3,
    valleyShare: 0.5,
    greenerTint: [0.85, 1.0, 0.8],
    barerTint: [1.1, 1.05, 0.96],
    // the mountains' own texture (developer: "the mountains themselves need to be more prominent and evocative … it is NOT
    // immediately clear where the big mountains are"): where the ground is rugged (its height's spread within valleyKm:
    // mtnRelief, km) or high (mtnHeightKm, up to mtnHigh of it), a crumpled ridged micro-relief up to mtnReliefKm high —
    // at mtnTextureKm, its octaves down to two pixels — lit as the page lights the relief (× mtnExaggeration), its crests
    // barer by up to mtnCrestRock; it multiplies the climate's own colours (dark creased forest, rock, snow with grey creases)
    mtnRelief: [0.08, 0.35],
    mtnHeightKm: [1.2, 3.5],
    mtnHigh: 0.8,
    mtnReliefKm: 0.35,
    mtnExaggeration: 14,        // (20: with the deeper shading, "the hillshading is too strong" — developer)
    mtnTextureKm: 60,
    mtnCrestRock: 0.35,
    // the mountains' tone (developer: "a darker or browner color for the mountains … maybe varied by age or height"): a dark
    // warm brown (linear-light multipliers) over mountainous ground, up to mtnTone — all of it on young ranges (a belt the
    // history still raises), mtnToneOld of it on old worn ones (soil and forest cover them), and the more the higher
    // (from mtnToneHeightKm[0] at half to [1] at all); a third as much under snow
    mtnToneTint: [0.7, 0.6, 0.5],
    mtnTone: 0.6,
    mtnToneOld: 0.35,
    mtnToneHeightKm: [0.8, 3.5],

    // ── rivers green the dry land (S3; developer: "rivers should make things greener, this should only really be
    // noticable in arid climates") ──
    // a green ribbon along each river carrying ripMinM3s or more: ripWidthKm × √(q / 1000 m³/s) wide (within ripWidthMaxKm;
    // narrower than a pixel, fainter), up to ripWiden times wider on low ground (below ripLowKm: floodplains and deltas),
    // by the place's dryness, none under snow; and a fringe ripLakeKm wide
    // around the lakes (oases)
    ripMinM3s: 15,
    ripWidthKm: 6,
    ripWidthMinKm: 8,           // (every river at least this wide: a glow, not a line — developer: "blend more"; 14: "too thick")
    ripStrengthM3s: [15, 2000], // its opacity by its discharge: a third at the first, all at the second (log)
    ripWidthMaxKm: 12,          // (30: "the thickest rivers need to be way thinner on the satelite map (small ones are ok)")
    ripWiden: 0.5,
    ripLowKm: [0.25, 0.02],
    ripLakeKm: 12,
    ripMax: 0.9,
    // (developer: "the green from rivers should blend more, stronger in the middle and fade out … a bit of a warp that is
    // blended with the original to give a bit of waveyness … noisier colors and opaque on top of the base color"): its
    // profile a bell — all at the middle, none ripSpread half-widths out; a copy of it displaced by noise (up to about
    // ripWarpKm, in waves ripWarpWaveKm long) blended with the original (it at ripOriginal); its green between two by
    // noise at ripGrainKm
    ripSpread: 2.8,
    ripWarpKm: 3.5,
    ripWarpWaveKm: 45,
    ripOriginal: 0.7,
    // its colour the climate's own green, well watered (developer: "the neon green is awful. It should be more an
    // intensification of the natural hues of green of the climate its going through"): the place's cover again with its
    // rain raised to ripWetness of its potential evaporation (its season, its warmth, its variety — an oasis's palms, a
    // cold steppe's willows, dormant in a cold month); its opacity grained by noise at ripGrainKm (± ripGrain)
    ripWetness: 0.55,
    ripGrainKm: 25,
    ripGrain: 0.06,             // (0.2: "rivers need to be less noisy")
    // a flow texture (developer: "a light earthy/natural texture layed over the whole planet scaled by the FLOW of each
    // area (at some opacity) … to add additional texture and help blend between areas"): an earthy tint (linear-light
    // multipliers), grained by noise at flowGrainKm, laid over everything at up to flowOpacity — by the area each place
    // drains, from flowAreaKm2[0] (none) to [1] (all; km², log-scaled: every valley system shows, the trunks most); half
    // as strong on snow
    flowTint: [0.74, 0.62, 0.46],     // (warmer: developer)
    flowOpacity: 0.6,
    flowAreaKm2: [400, 40000],
    flowGrainKm: 12,
    flowGrain: 0.5,
    // …those colours made livelier (finish-cover.js livelier): greens (hues from…to, °) turned this share of the way to
    // this hue, saturation and brightness times these — golds, browns, greys and snow as Blue Marble has them
    climateGreen: { from: [40, 58], to: [150, 175], hue: 105, share: 0.5, sat: 1.4, value: 1.3 },
};
