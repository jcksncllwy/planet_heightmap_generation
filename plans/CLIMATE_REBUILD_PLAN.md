# New climate for Evolution — plan

Draft, 2026-09-27, for the developer to agree before anything is built (plan first; one browser-verifiable phase at a
time). Branch `climate-rebuild`, in the worktree `.claude/worktrees/climate-rebuild`, from `v2-tectonics` at b0662f1.
Background: the research report `reports/Climate generation rewrite options.md` and its notes (main checkout).

## What the developer asked for (2026-09-27)

- **A new climate, built from scratch, for the Evolution tab only.** V1 keeps its climate untouched. V1 may get this
  climate *eventually*, most likely as part of a V1 rewrite, so the new code must not depend on V1 but must stay easy
  for a future V1 to call.
- **Why a rebuild.** Today's climate is hard to work on, too slow and unrealistic. The developer's own read: "I'm not sure
  any individual portion really works … a ton of errors that are averaging out in a direction that is sort of ok. The
  inability to understand it makes it very hard." The audit backs this for precipitation and Köppen.
- **Per-stage tuning is critical**, with a final Köppen-level tuning on top.
- **Four points in the year**, if it can be done reliably.
- **Fast on phones**: not much slower than today's climate, ideally faster.
- **Mediterranean climates must be there**; they can be worked on in a later phase.
- **Best results win, not physics for its own sake**: "we dont NEED physics, we should do the thing that produces the
  best results."
- Work happens in a separate worktree.

This replaces step D of `plans/V2_FULL_PLANET_PLAN.md` ("climate from V1"). That plan should be updated once the
Evolution work is merged into this branch.

## The shape of the new climate

**One pure module**, `v2/js/climate/`. It is DOM-free and runs in a worker, with no imports from V1's climate files. It
has one entry point:

`computeClimate(input, options)`

- **Input.** Everything is generator-neutral:
  - cell positions on the unit sphere and the pole axis (Evolution is z-north);
  - elevation in km (Evolution's heights already are);
  - an optional land mask (default: elevation > 0; Evolution's crust type can refine it).
- **Options:** axial tilt (fixed at Earth's 23.4° unless the developer asks for a control), temperature offset, rain
  scale, seed.
- **Outputs.** In physical units:
  - 12 monthly temperatures (°C) and rain totals (mm), synthesised from 4 anchors;
  - pressure, wind, currents and sea temperature at the 4 anchors;
  - a Köppen id per terrain cell, using V1's 31-class table and colours so the maps look familiar.
- **Memory.** Monthly values are not stored for every terrain cell (2.5M × 24 values would be too much). Each cell is
  classified directly from the grid fields plus its local height corrections.

**Fixed climate grid.** The climate runs on a fixed grid (1° lat-lon by default; the final size is set by the speed
budget). The grid is the same at every terrain resolution (160K, 640K, 2.5M) and on every device. Only local work with
a fixed footprint in km touches the terrain cells: lapse rate and upslope rain. Köppen is classified per terrain cell
from continuous fields, never interpolated. Scale invariance holds by construction. A lat-lon grid also paints
straight onto Evolution's texture globe.

**Stages are slots with a contract.** The order is temperature → pressure and wind → ocean → rain → months → Köppen.
Every stage:
- answers one question;
- outputs physical units;
- has its own layer in the lab;
- has its own Earth reference and score;
- owns a handful of knobs (about 4–8) with physical meaning;
- never reads a later stage;
- never patches another stage's output.

**Best method wins, per stage.** Candidates for each slot are:
- physics (the report's picks: energy balance, derived pressure, wind-driven gyres, a column-water budget);
- an empirical fit to Earth data;
- a borrowed rule (ideas from Undiscovered Worlds, mapgen4, WorldForge 2, or a good idea from V1's climate);
- a small learned model.

A bake-off picks the winner, judged in this order:
1. The stage's score against its Earth reference.
2. The non-Earth checks: synthetic continents, paleo snapshots and Evolution supercontinents. A method that wins on
   Earth by memorising Earth fails here and loses.
3. How it looks to the developer in the lab.
4. Speed.

## Scoring: every stage against Earth, Köppen on top

**Earth references.** These are downloaded once, regridded offline to the climate grid, and kept in
`tuning/climate/data/` (gitignored, with a fetch-and-regrid script):

| Stage | Reference | Licence |
|---|---|---|
| Pressure, wind, sea temperature, sea ice | ERA5 monthly means (needs a free Copernicus account), or NOAA's NCEP reanalysis (no account) | CC BY 4.0 / public domain |
| Monthly temperature and rain | CHELSA V2.1 | CC0 |
| Köppen | Beck V3 (1991–2020) | CC BY 4.0 |

Earth is fed to the new module the same way an Evolution frame would be: positions plus elevation in km from
`assets/earth.png`.

**Open loop, then closed loop.** A stage is first scored with *observed* inputs, so its error is its own. Then it is
scored fed by the new upstream stages. **Truth swaps** attribute Köppen errors to a stage: observed temperature with
simulated rain, and the reverse.

**Tuning:**
1. Each stage is tuned against its own reference, then frozen.
2. A final Köppen-level tune on top then adjusts only a few coupling and classification knobs. Every stage score is a
   guardrail that may not regress beyond a set tolerance, so the final tune cannot buy Köppen points by breaking a stage.

**Gates.** These are pass/fail, not weights in the objective:
- **Regimes present**:
  - Mediterranean on west coasts at 30–45°;
  - the South Asian monsoon;
  - Cfb in Western Europe;
  - BWk in the Gobi;
  - BSk in Patagonia.
- **No drift across terrain resolution**: 160K, 640K and 2.5M agree.
- **Synthetic continents behave**: a flat tropical rectangle, a mid-latitude rectangle (desert → Mediterranean → oceanic
  up its west coast, humid east coast), and an equatorial supercontinent (dry, continental interior).
- **The speed budget** below.

**Baseline.** V1's current climate, run read-only on Earth, is scored the same way in Phase 0. The new stages must beat
it.

## Speed budget

- **The reference is V1's climate today**, measured on the desktop: **0.51 s at 40K, 2.07 s at 160K, 10.9 s at 640K**.
  Phones have not been measured yet.
- **Budget.** "Calculate climate" for any Evolution moment must be no slower than V1's climate at its 40K default,
  on the desktop and on a phone, at Evolution's default terrain resolution. At 2.5M it must still take only a few
  seconds. The climate grid's cost does not grow with terrain resolution; only the per-cell finishing does.
- **Levers if the budget is tight**, in order:
  1. a coarser grid (1.5° or 2°: 2.25–4× fewer cells);
  2. fewer coupling iterations;
  3. WASM SIMD for the hot kernels, only if it reproduces the Köppen classes exactly.

  The grid is the same on every device. A phone-only coarser grid would give phones a different planet.
- The lab page gets a timing button the developer can open on a phone.

## Seasons: four anchors, proven before they are used

The model runs at 4 points of the orbit, a season apart. The temperature stage carries the seasonal lag. The 12 months
are synthesised from the anchors:
- **Temperature**: a mean plus harmonics.
- **Rain**: a shape that stays positive and can dip to near zero in a dry season.

**Phase 0 tests this on real data first.**
- The test: take CHELSA's 12 observed months, keep 4 a season apart, rebuild the 12, classify, and compare with the
  classification from all 12.
- Proposed gate: at least 95 % of land keeps its class, and Cs, Cw, Am and Dw each keep at least 90 % of their area.
- If the gate fails, the model uses 6 anchors (×1.5 the seasonal cost), or 12 if it must.

## The phases (each confirmed in the browser before the next)

Nothing in V1 (`js/`, `index.html`, `import.html`) is modified at any point. Phases 0–6 need nothing from the Evolution
page, so they can proceed while that page is still being built. Where a stage is not built yet, Earth uses observed
fields and test planets use a simple zonal first guess. Each gate is a single evaluation run, not an optimiser sweep.

| Phase | Builds | Check in the browser | Gate before approval |
|---|---|---|---|
| **0. Groundwork and measurements** | Earth references fetched and regridded; a **climate lab page** (Earth and test planets on a globe and map, any field as a layer, simulated vs observed side by side, season slider, timing button); per-stage scores and truth swaps for V1's current climate (read-only); the 4-anchor test; speed of V1's climate and of basic grid work on the desktop and the developer's phone | The lab shows V1's current fields next to real Earth; a table shows which of today's stages work, how much of the Köppen error each causes, and the timings | Baselines recorded; 4-anchor gate passed (or the anchor count decided); phone numbers known |
| **1. Skeleton** | `v2/js/climate/`: the input contract, fixed grid, aggregation from terrain, per-cell finishing, 12-month synthesis, Köppen with Beck's rules | Earth Köppen from *observed* data looks the same at 160K, 640K and 2.5M | Drift ≈ 0; oracle ceiling recorded; skeleton cost within budget |
| **2. Temperature** | Bake-off (energy balance first); temperature offset; tilt as an internal option | Monthly temperature vs CHELSA; big seasonal swings inland, mild ocean-side climates, seasonal lag | Beats V1's temperature score open loop; truth swap beats V1's |
| **3. Pressure and wind** | Bake-off (derived pressure first) | Pressure and wind by anchor vs ERA5: summer lows over continents, highs over eastern oceans, monsoon reversal | Beats V1's wind score; temperature does not regress in closed loop |
| **4. Ocean** | Bake-off (wind-driven gyres first); sea temperature, coastal upwelling, sea ice | Gyres with strong western boundary currents and a circumpolar current; cold upwelling coasts; ice by month | Sea-temperature pattern beats V1's ocean warmth; cold coasts present |
| **5. Rain** | Bake-off (column-water budget first); upslope rain on the terrain | Monthly rain in mm vs CHELSA; rain shadows; monsoon wet and dry seasons | Beats V1's rain score; truth swap beats V1's |
| **6. Close the loop and tune on top** | Coupled chain; final Köppen-level tune within the stage guardrails | Full climate on Earth, synthetic continents and saved Evolution frames, at all terrain resolutions, desktop and phone | Every stage near its open-loop score; Köppen beats V1 on Earth; no-drift, synthetic-continent and speed gates pass |
| **7. Into Evolution** | "Calculate climate" button for the moment shown; climate layers in Evolution's globe and map (Köppen, temperature, rain, wind, currents, sea ice), kept per moment while the history is open; climate maps in its exports; phone layout; README, tutorial, SEO and `llms.txt` updates; What's New question | Any frame gets its climate in seconds; a supercontinent's interior reads dry and continental; works on a phone | Developer sign-off |
| **8. Mediterranean** | Whatever makes the Mediterranean gate pass: first from the circulation, else a named, smooth mechanism inside the circulation or rain stage (eddy moisture scaled by storm-track strength, descent west of monsoon heating, or an Undiscovered-Worlds-style shift of rain into winter). Never a downstream patch | West coasts at 30–45° show Cs on Earth and on Evolution planets | Regime gates pass; nothing else regresses |

Phases 7 and 8 can swap if the developer wants Mediterranean climates in place before the climate reaches Evolution.

## Phase 0 — built 2026-09-27, awaiting the developer's check

**What was built**
- **Earth references.** `tuning/climate/fetch-references.mjs` and `regrid-references.mjs` put the reference data on
  the 1° grid (`v2/js/climate/grid.js`):
  - pressure, wind, SST, sea ice and GPCP rain from NOAA (public domain, no account);
  - monthly temperature and rain plus the Köppen map from Beck et al. 2023 (CC BY 4.0).

  Beck's monthly data is the data behind Beck's own map, so it replaced CHELSA: the answer keys are consistent, and the
  files are small.
- **The Köppen classifier with Beck's rules**, `v2/js/climate/koppen.js`, plus 12-month synthesis from K points,
  `v2/js/climate/seasons.js`. These are the first two pieces of the new core.
- **The climate lab**, `v2/climate-lab.html`:
  - real Earth next to V1's climate on the imported Earth, on a globe, a map, or side by side;
  - fields: Köppen, temperature, rain, pressure and wind, ocean warmth, sea ice;
  - the rain belt (ITCZ), observed vs V1;
  - the per-stage scores, the truth swaps and the season test;
  - timing buttons.

  It works in a phone-sized layout: bottom sheet, 44 px controls.
- **Per-stage audit and season test.** `tuning/climate/stage-audit.mjs` (V1 per stage, truth swaps) and
  `season-test.mjs` (K points in the year).
- **Earth mesh refactor.** The mesh builder is now environment-free (`tuning/climate/lib/earth-mesh.mjs`, shared by
  Node and the browser). The Earth context plus V1 climate hash is unchanged (`hash-earth.mjs`: b62546c8…).

**What the numbers say** (V1 at 160K on the imported Earth, against observations; June–August / December–February)

| Stage | V1 against real Earth | Reading |
|---|---|---|
| Pressure | pattern corr. 0.57 / 0.45; land–sea highs and lows corr. 0.28 / 0.31 | poor: prescribed belts, weak continental pattern |
| Wind | direction within 45°: 56 % / 55 % (sea 62 %, land 31 %) | poor |
| Rain belt (ITCZ) | typical error 10.5° / 13.2°; mean latitude 18.8° vs real 8.5° (Jun–Aug) | poor: far too far poleward |
| Ocean warmth | vs the real warm/cold current pattern: corr. 0.22 / 0.22 | poor |
| Temperature | corr. 0.97 / 0.93; typical error 4.9 / 7.8 °C | the best stage, but winters are off |
| Rain | log corr. 0.49 / 0.59; wet season the right way round 76 % | poor |

Köppen against the Beck map, with every row using the new classifier:

| Temperature + rain | Same class | Same group |
|---|---|---|
| Real 12 months | 93.1 % | 97.1 % |
| Real, 2 seasons only (the best any 2-season model can do) | 82.2 % | — |
| V1 + V1 | 38.3 % | 71.3 % |
| Real temperature + V1 rain | 55.8 % | — |
| V1 temperature + real rain | 65.7 % | — |

**The developer's hypothesis is confirmed.** Every stage except temperature is individually poor, and **rain costs the
most**. V1 as shipped scores 33–38 % against Beck (37.6 % per region at 0.1°).

**Speed on this desktop (Chrome).**
- V1's climate on Earth: 0.9–1.0 s at 40K, 3.4 s at 160K. That is the budget.
- The new core's building blocks on the 1° grid:

  | Building block | Time |
  |---|---|
  | Diffusion pass | 0.22 ms |
  | Semi-Lagrangian advection step | 1.3 ms |
  | Sampling 4 fields onto 2.5M cells | 0.44 s (including their lat/lon) |
  | 12 months + Köppen for 160K cells | 58 ms |
- **Phone: not measured yet.** Open the lab on the phone (same Wi-Fi, dev server running):
  `http://192.168.1.230:8147/v2/climate-lab.html` → Speed.

**Four points in the year: the gate is not met.** These are Köppen results rebuilt from K points of real data, with
the points on the months where Earth's seasons peak:

| Points | Land keeping its class | Cs | Cw | Am | Dw | Gate |
|---|---|---|---|---|---|---|
| 2 | 83.7 % | 71 % | 69 % | 45 % | 76 % | no |
| 4 | 93.6 % | 89 % | 85 % | 89 % | 84 % | no (needs 95 / 90) |
| 6 | 96.5 % | 92 % | 94 % | 92 % | 94 % | **pass** |

With 4 points, temperature alone is fine (97.8 % of land kept); the losses come from rain (95.7 % alone).
**Decision for the developer:**
1. 6 points everywhere (×1.5 the seasonal cost). This is the default in Phase 1.
2. 4 points for temperature and circulation, 6 for rain.
3. 4 points everywhere, accepting ~94 %.

The core takes K as a setting, so this can change later.

## Phase 1 — built 2026-09-27 overnight (the developer asked for it to go ahead), awaiting the developer's check

**What was built:** `v2/js/climate/core.js`, the one generator-neutral entry point, `computeClimate(input, options)`.
- **Input:** cell positions, elevation in km, `axes: 'y-up'` (V1) or `'z-up'` (Evolution), optional land mask. No
  plate data.
- **Pipeline:**
  1. cell latitude and longitude;
  2. the surface aggregated onto the 1° grid (land fraction, mean land height);
  3. the climate at K points in the year;
  4. 12 months on the grid;
  5. per terrain cell: bilinear sampling of the grid fields, temperature corrected for the cell's own height
     (6.5 °C/km, via sea-level reduction), and Köppen per cell.

  Nothing is stored per cell per month.
- **The physics stages are not built yet.** The K-point fields come from `options.anchorSource`. On Earth,
  `observedAnchors()` feeds real monthly data (the "oracle" run), and later phases replace it stage by stage.
- **Defaults:** 6 points, rain interpolated as a square root, grid 1°.
- **Lab:** the climate lab has a "New climate · Phase 1 skeleton" panel. It runs the core in a worker at 160K, 640K or
  2.5M, with 4, 6 or 12 points and the height correction on or off. It scores the result against Beck's 0.1° map and
  draws the per-cell Köppen (Köppen → "New (Phase 1)"; use Side by side to compare with Beck).
- **Check:** `tuning/climate/skeleton-check.mjs` runs the same at 160K, 640K and 2.5M.

**Numbers:** Earth with real data, per terrain cell, against Beck's 0.1° map.

| Terrain cells | Same class (6 points) | 12 months | No height correction | Group | New climate time (Node) |
|---|---|---|---|---|---|
| 160K | 87.6 % | 88.6 % | 86.2 % | 95.0 % | 48 ms |
| 640K | 87.9 % | 89.0 % | 86.2 % | 95.1 % | 62 ms |
| 2.5M | 87.9 % | 89.0 % | 86.2 % | 95.1 % | 162 ms |

- **Gate: passed.**
  - Across resolutions the share of land in each class differs by at most 0.40 %, and group shares by 0.17 points.
  - Without the height correction, agreement spreads by only 0.08 points.
  - With it, agreement rises by 0.3 points at finer terrain, as mountains resolve. That is wanted, not drift.
  - For comparison, V1's temperate share falls from 17.9 % to 10.6 % between 40K and 640K.
- **The oracle ceiling is ~88 % same class and ~95 % same group per terrain cell.** No physics can beat it with this
  pipeline, so the stages to come are judged against it, not against 100 %.
  - The ceilings for the seasonal regimes are lower: Cs 72–74 %, Cw 76–77 %, Am 83 %, Dw 73–75 %. Much of that comes
    from coarse 1° rain at coasts and mountains, which the upslope rain in Phase 5 can improve.
- **Speed (desktop Chrome):** the new climate takes 65 ms at 160K and 0.34 s at 2.5M. V1 takes 0.9 s at 40K and about a
  minute at 2.5M. The skeleton is far inside the budget; the physics stages get the rest.
- **Evolution's axes:** the same Earth turned to z-north classifies identically, cell for cell.

**Not in Phase 1 (as planned):** any physics; a first-guess source for planets other than Earth (it comes with the
temperature stage in Phase 2); README and `v2/README.md` updates. Both READMEs have uncommitted edits in the main
checkout, so they are updated when this branch is merged, to avoid conflicts. The tuning README is updated.

## Still to decide

1. **Where the code lives.** Recommended: `v2/js/climate/`, so V1 is untouched and a future V1 rewrite imports it from
   there.
2. **Truth map: Kottek → Beck.** Recommended. V1's baseline is scored on Beck too, so the comparison is like for like.
3. **Reproducibility.** Recommended: the same Köppen classes on every device, with plain JS as the canonical path.
4. **Axial tilt.** Fixed at Earth's value for now: Evolution keeps its three sliders unless the developer asks.
5. **Machine learning** only as a bake-off candidate that wins on the scores and passes the non-Earth gates.
6. **The CLAUDE.md smoothing rule.** The new climate avoids the problem (long-range work happens on the fixed grid, in
   km). Fixing the rule for V1 and terrain code can wait for the V1 rewrite.

## Practical notes

- **The Evolution page is not in this branch yet.** It exists only as uncommitted work in the main checkout
  (`evolution.html`, `v2/js/evolution/`, `v2/evolution.css`). Phases 0–6 do not need it. Phase 7 needs it committed on
  `v2-tectonics` and merged into this branch.
- **V1's climate is read, never changed.** Its modules are imported read-only by the lab and the benchmark, for the
  baseline.
- **The ground truth is not in the worktree.** `tuning/climate/data/` is gitignored, so the Kottek ground truth must be
  copied in from the main checkout.

## Phase 2 — the temperature stage, built 2026-09-28, awaiting the developer's check

**The developer's direction during the phase.**
- "Make sure the parameters are those that would most naturally transfer seamlessly to another world … not treat the
  earth comparison like gospel."
- Tune on the whole Earth, but make the evaluations continent-aware.

**How that was applied.**
- Every setting is a physical quantity with a literature value and a range (`v2/js/climate/config.js` `PARAM_PRIORS`).
- Tuning (`tuning/climate/temperature-check.mjs --tune`) uses the whole Earth:
  - each continent is scored on its own and weighted equally;
  - no continent may end up more than 0.15 °C worse than with the literature values;
  - every setting pays for moving away from its literature value.
- A first try, tuning on the Americas and checking on the rest of the world, overfit: the rest got worse. The fix was
  physics, not more tuning.

**What was built.** `v2/js/climate/temperature.js`, a seasonal energy-balance model solved directly for the yearly
cycle: the mean and two harmonics, a few outer iterations for snow and ice, and no spin-up. It has the following
physics, each piece a physical mechanism that works on any planet:
- **Sunlight** for any axial tilt (`insolation.js`).
- **Heat radiated to space.**
- **Heat spreading**, stronger north–south than east–west. Weather carries heat mainly poleward; land and sea exchange
  air through the winds.
- **Heat carried by the winds.** The Earth run uses the observed winds for now.
- **Heat storage:** land small, a mixed-layer ocean, and frozen sea storing little.
- **Albedo** rising toward the poles, with seasonal snow on land reflecting little. Snow that survives the summer, an
  ice sheet, reflects like sea ice.
- **Height.** Sunlit plateaus cool 4.8 °C/km, ice sheets 8 °C/km, and the terrain below the grid 6.5 °C/km.
- **Winter inversions.** Air by snowy ground under a weak sun is up to 10 °C colder, mixed away by wind.

Around the stage:
- `solver.js`: a multigrid solver on the lat-lon grid, checked by `tuning/climate/test-solver.mjs`.
- `inputs.js`: observations for stages not built yet on Earth, and placeholders (textbook wind belts, a zonal rain
  curve) on other planets.
- `test-planets.js`: three synthetic continents.
- The core now takes `stages: { winds, temperature, rain }`.
- The lab runs the new climate on Earth or a test planet. It adds "New" and "New − observed" sources for Temperature
  (every month), a Seasonal swing field, and a Phase 2 results section.

**Tuned (light).** From the literature values:

| Setting | Literature | Tuned |
|---|---|---|
| Snow albedo | 0.40 | 0.325 |
| Land heat store | 8.4e6 | 8.93e6 |
| Wind heat-carrying | 0.05 | 0.106 |
| Inversion wind | 5 | 4.7 m/s |
| Plateau lapse | 5.0 | 4.84 °C/km |

Everything else stayed at its literature value.

**Numbers.** Earth, with observed winds; typical monthly error on land.

| Region | New | June–August / December–February: new | V1 |
|---|---|---|---|
| North America | 4.8 °C | 3.7 / 5.3 | 4.1 / 8.3 |
| South America | 3.1 | 2.3 / 3.5 | 4.2 / 3.8 |
| Europe | 6.0 | 3.6 / 7.4 | 4.2 / 5.6 |
| Africa | 4.3 | 4.6 / 3.0 | 4.1 / 3.4 |
| Asia | 5.2 | 3.6 / 6.0 | 4.8 / 10.5 |
| Australia | 3.5 | 2.6 / 4.4 | 2.0 / 5.2 |
| All land | 5.3 | 4.2 / 5.4 | 4.9 / 7.8 |

- **Seasonal swing on land:** 19.6 °C modelled vs 19.6 real; Siberia 43 vs 47, Canada 32 vs 37.
- **At sea (ice-free):** 3.0 °C typical error.
- **Köppen with the real rain:** new temperature 68 % same class / 86 % group, against V1's temperature at 64 % / 85 %.
  The ceiling with real temperature is 88 %.
- **Test planets:** all physical checks pass.
  - Seasons are biggest inland, then on the coast, then at sea.
  - The west coast is milder than the east in winter.
  - Land is hotter than the sea in summer and colder in winter.
  - Seasons are small at the equator.
  - Supercontinent interior swing 38 °C vs 6 °C at sea.
- **Speed:** the temperature stage takes ≈ 0.19 s warm in Node (2° grid; 1° scores the same at three times the cost).
  The whole new climate at 160K takes 0.25 s in desktop Chrome.

**Gate: passed.**
- June–August / December–February error with continents weighted equally: 4.2 °C vs V1's 5.0 °C.
- Truth swap beats V1's.
- Test planets pass.

**Known remaining errors, and where they get fixed.**
- **Europe is ~3.5 °C too cold.** Its winter error is 7.4 °C. It is missing the ocean's heat transport (the Gulf
  Stream): Phase 4.
- **Hot desert summers are too mild and the cloudy tropics too warm** (Sahara July 27 vs 33 °C, Amazon 30 vs 26 °C).
  These need rain and clouds feeding back on temperature: Phase 6 coupling.
- **Tibet's winter is too cold** (−23 vs −16 °C). Real Tibet is dry, so it has little snow. This also needs rain: Phase 6.
- **Antarctica is ~8 °C too warm, but stays ice cap.** It is not tuned on; ice-sheet physics is minimal.

## Phase 3 — pressure and wind, built 2026-09-28 (the developer asked for all phases to continue)

**What was built.** `v2/js/climate/circulation.js`: sea-level pressure and near-surface winds derived from the
temperature, with nothing placed at Earth's latitudes.
- **Zonal belts.**
  - The tropical trough sits at each longitude's own warmest latitude: over the sea the warmest water, over a summer
    continent its heat low, i.e. the monsoon trough.
  - The subtropical highs sit at the Hadley-cell edges (Held & Hou, from this planet's equator-to-pole contrast).
  - The subpolar lows sit one Ferrel cell further out.
  - The midlatitude pressure drop grows with the temperature contrast across the storm belt, and more where the belt
    is open sea.
- **Thermal lows and highs.** Air warmer than its latitude's average leaves low pressure, colder air high pressure,
  smoothed at the Rossby radius. Warmth is measured at the free air's lapse rate, so sunlit plateaus count as the
  elevated heat sources they are (the Tibetan and South Asian summer low).
- **Winds from pressure with friction:** one linear balance gives winds along the isobars at midlatitudes, turned
  toward the lows (more over land), and straight down-gradient at the equator.
- **Coupling.** In the core, temperature and winds need each other; two rounds settle them, the second temperature
  starting warm.
- **Scoring.** `tuning/climate/circulation-check.mjs` scores per continent and ocean basin, each weighted equally. It
  also checks named features and the test planets.
- **Lab:** Pressure & wind → "New" and "New − observed" for any month, with the new rain-belt line in cyan. On Earth,
  the new climate can run with derived or real winds.

**Open-loop input.** It should have been NCEP's near-surface air temperature, but NOAA's server was down (503) all
morning. The run used "real where observed" instead: Beck on land, OISST at sea, and the Phase 2 model for the 14 % of
cells under sea ice or in gaps. The script switches to NCEP air automatically once it is downloaded.

**Tuned (region-aware, priors).** Hadley scale 1.43, Ferrel width 35°, tropical drop 9.6 hPa, midlatitude
0.49 hPa/K, open-sea boost 0.69, polar high 4.75 hPa, thermal 0.78 hPa/K, Rossby radius 812 km, friction turning
10° at sea and 32.5° on land. Three of these sit at or near the edge of their range (Ferrel width, sea turning, Hadley
scale), a hint of the simple structure's limits.

**Numbers, against V1 on the same cells** (June–August and December–February means; regions weighted equally):

| Measure | New | V1 |
|---|---|---|
| Wind direction within 45° | **73 %** | 52 % |
| Pressure pattern error | **2.9 hPa** | 4.0 hPa |
| East–west pressure correlation | **0.57** | 0.30 |
| Rain belt, distance from the real rain maximum | **7.0°** | 11.6° |

**Named features on Earth, all passing:**
- the South Asian monsoon: south-westerly in July, north-easterly in January;
- the West African monsoon;
- the East Asian winter monsoon;
- summer highs over the eastern Pacific and Atlantic, at about half their real strength;
- the Siberian High and the Aleutian Low, at about half their real strength.

**Coupled, on Earth:** temperature error is 4.39 °C with its own winds vs 4.48 °C with the real winds (no worse), and
Köppen with real rain is 68.1 %.

**Test planets, all passing:**
- trade winds and westerlies appear on their own;
- a thermal low over the summer continent and a high over the winter one;
- westerlies onto the west coast;
- on the tropical continent the rain belt swings ±11° over land against ±1° at sea;
- southerly summer monsoon winds on the tropical continent and onshore ones on the supercontinent.

**Gate: passed.**

**Known limits.**
- **Weak circulation features.** The Siberian High, Aleutian Low and eastern-ocean summer highs are about half their
  real strength. That matters for Mediterranean climates; Phase 8 revisits it.
- **Southern Ocean winds** are right in direction (≈ 87 % within 45°) but too weak (≈ 0.4 of the real speed).
- **Rain-belt measure.** Over the Sahara the rain belt follows the heat low (≈ 20°N, the real surface front) rather than
  the rain maximum (≈ 10°N). The rain stage (Phase 5) decides where rain actually falls.
- **Speed.** Circulation is ~80 ms. The coupled temperature ↔ winds step is ~0.5 s in Node and ~0.9 s cold in Chrome;
  a speed pass is due before Phase 7.

## Phase 4 — ocean, built 2026-09-28

**What was built.** `v2/js/climate/ocean.js`:
- **Wind-driven gyres.** A Stommel solve for the ocean's transport on the 2° grid, forced by the curl of the wind
  stress. Coasts are held fixed by a large pinning term. East–west friction sets the western boundary current's width
  (about two cells); north–south friction is kept small so the open ocean keeps its Sverdrup balance.
  - This was found with a Stommel box test. Isotropic friction wide enough for the grid smeared the gyres to ~30 % of
    Sverdrup.
- **Circumpolar channels.** Latitude rows that are open sea all round carry a friction-balanced eastward current. The
  landmasses on either side are held at different transport values, which lets the current through.
- **Wind stress** includes a gustiness speed. Monthly-mean winds lack the storms, and stress grows with the square of
  the speed.
- **Heat for the temperature stage** (a yearly source or sink for the sea's surface layer, with the net removed):
  - currents carrying the sea temperature, warm water poleward on western edges;
  - Ekman upwelling of cold water where winds push surface water away (the California, Peru, Benguela and Canary
    coasts; the equatorial Pacific).
- **Coupling:** temperature ↔ winds ↔ ocean, three rounds. Monthly sea ice is now also an output of the temperature
  stage.
- **Check and lab:** `tuning/climate/ocean-check.mjs`; in the lab, Ocean warmth → New (with current arrows), Sea ice →
  New.

**Tuned (basin- and continent-aware).** Heat share 0.073, gustiness 4.3 m/s, channel drag 7.3e-7; friction and upwelling
stayed at their literature values.

**Numbers (open loop, real winds).**
- The sea's east–west pattern (warm western, cold eastern boundaries): correlation 0.43 with the ocean vs 0.30 without.
  For June–August / December–February: 0.36 vs V1's ocean warmth at 0.24.
- Monthly error, with the ocean vs without:
  - North Atlantic sea temperature 3.4 vs 4.1 °C;
  - Europe's land temperature 5.4 vs 6.0 °C.
- Named features that pass:
  - the Gulf Stream and Kuroshio flow poleward;
  - the California and Humboldt currents flow equatorward;
  - the circumpolar current flows east (≈ 70 Sv);
  - the four upwelling coasts are colder than their latitude, by 1–2 °C where reality has 3–6 °C;
  - the equatorial Pacific has a cold east.
- **Coupled:** Europe's temperature error is 5.1 vs 5.4 °C without the ocean. Mean land error is unchanged or slightly
  better, and Köppen with real rain is unchanged (68 %).
- **Test planets:** warm poleward currents along the east coasts, cold equatorward ones along the west coasts, and the
  sea colder off west coasts.

**Gate: passed.**

**Known limits.**
- **The North Atlantic is not warmer than its latitude** (−0.6 °C vs a real +3). The gyre's heat settles off North
  America. The extra real warmth comes from the deep overturning circulation, which this model does not have.
- **The coupled sea pattern is weaker than with real winds** (east–west correlation ≈ 0.05 vs 0.43). The derived winds
  are weaker and smoother than the real ones.
- **Sea anomalies are about a third of the real ones**, and currents slow (a 2° grid and climatological winds).
