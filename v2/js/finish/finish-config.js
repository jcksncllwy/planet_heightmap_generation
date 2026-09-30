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
    // plains calm; the ridges between them (the cells nothing drains into) kept
    dissectKm: 0.35,            // deepest cut, on steep ground…
    dissectSlope: [0.02, 0.25], // …by the ground's steepness (km per km)…
    dissectCells: [1.5, 40],    // …and by how many cells drain there (a ridge … a valley the mesh can show)

    // ── F2: closed basins — a basin whose inflow cannot make up what its lake would lose to evaporation stays closed:
    // a flat salt pan or playa at the level where the two balance, the rivers of its catchment ending there ──
    basinMinKm2: 3000,          // (smaller hollows are left to the rivers)
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
    creepKm: 10,                // rounding (σ) at full wetness
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
    iceSteer: 0.06,             // the ice routed over the bed plus this share of its thickness (its surface's pull)
    scourKm: 0.07,              // an ice sheet scours hollows this deep in its bed (lake districts on shields)…
    scourScaleKm: 45,           // …about this far apart
    moraineKm: 0.06,            // end moraines at the ice's farthest reach, and outwash plains beyond
    reboundLeft: 0.2,           // of the ice's weight (ρi/ρm × thickness), this share not yet rebounded (Hudson Bay, the Baltic)…
    reboundKm: 350,             // …spread by the lithosphere over about this

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
