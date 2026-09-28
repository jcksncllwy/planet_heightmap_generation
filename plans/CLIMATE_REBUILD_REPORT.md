# The new climate — report

For the developer, written on 2026-09-28 while you were at work. Each phase has its own commit, its own section below
and its own panel section in the climate lab, so you can review them one at a time. The detailed engineering notes
per phase are in `plans/CLIMATE_REBUILD_PLAN.md`.

## How to review

- **Code.** Everything is in the worktree `.claude/worktrees/climate-rebuild`, on branch `climate-rebuild`, with one
  commit per phase: `git log --oneline v2-tectonics..climate-rebuild`, then `git show <commit>` for one phase. V1's app
  code (`js/`, `index.html`, `import.html`) is not touched by any phase.
- **The lab.** From the worktree, run `node tuning/dev-server.mjs 8147`, then open
  `http://localhost:8147/v2/climate-lab.html` (phone on the same Wi-Fi: `http://192.168.1.230:8147/v2/climate-lab.html`).
  - The panel has one section per phase, with its numbers.
  - "New climate" runs the whole new climate on this device, on Earth or on one of three test planets.
  - Every field (Köppen, Temperature, Seasonal swing, Rain, Pressure & wind, Ocean) has an "Observed", a "V1" and a
    "New" source; use Side by side to compare.
- **The checks.** One script per phase in `tuning/climate/`, listed in its README. They need the downloaded Earth data;
  the steps are in the README.
- **The lab's tables show the final settings.** The checks were re-run at the end, so a phase's table can differ a
  little from the numbers in its section below, which are from when the phase was built.

## Where it stands

| Phase | What | Gate | Headline |
|---|---|---|---|
| 0 | Earth references, the lab, V1 audited stage by stage | — | V1's stages are individually poor; rain costs the most |
| 1 | The core skeleton (grid, 12 months, height correction, Köppen) | passed | With real data, ≈ 88 % Köppen per terrain cell; no drift 160K–2.5M |
| 2 | Temperature (energy balance) | passed | 4.2 vs V1's 5.0 °C error (continents weighted equally); test planets physical |
| 3 | Pressure and wind (derived from temperature) | passed | Wind direction 73 % vs V1 52 %; monsoons reverse; rain belt 7° vs 11.6° |
| 4 | Ocean (gyres, circumpolar currents, upwelling → temperature) | passed | Warm-west / cold-east sea pattern 0.36 vs V1 0.24; Europe milder; all named currents right; effects ≈ ⅓ of real |
| 5 | Rain (a column-water budget) | partly | Every stage new: Köppen 46 % vs V1's 38 %; rain patterns and continents beat V1; deserts beside monsoons too wet, rainforests too dry |
| 6 | The coupled climate, tuned on Köppen; speed | mostly | **Köppen 49.5 % vs V1's 38 %**; no drift to 2.5M; 0.8 s in Chrome (V1: 0.5 s at 40K, 2.1 s at 160K) |
| 7 | Evolution | … | … |
| 8 | Mediterranean climates | … | … |

## Decisions waiting for you

1. **Points in the year: 4 or 6.** This matters for rain. The default is 6, the only setting that passed the Phase 0
   gate.
2. **Commit and merge.**
   - **Commits:** the phases are committed on `climate-rebuild`; nothing is pushed.
   - **Merging:** merge into `v2-tectonics` once your Evolution work is committed there. Phase 7's page wiring needs
     that page in this branch.
3. **The CLAUDE.md smoothing rule** (from the research). The new climate doesn't depend on it; fixing it for terrain
   code is separate.

## The approach, in one paragraph

Each stage answers one physical question with a handful of physical settings, and each setting has a literature value
and a range (`v2/js/climate/config.js`). Earth is a check, not the target.
- Each stage is scored on its own against real observations.
- Scoring uses the whole Earth, but each continent (and each ocean basin, for fields at sea) counts equally.
- A setting may move from its literature value only if no region gets worse.
- Three synthetic test planets must behave as physics expects.

The stages are temperature → pressure and wind → ocean → rain → 12 months → Köppen. They run on a fixed 1–2° grid, so
the result is the same at every terrain resolution.

---

## Phase 0 — groundwork and measurements

**Built.**
- Real Earth data on a shared 1° grid: Beck 2023 monthly temperature and rain plus its Köppen map; NOAA pressure,
  winds, sea temperature, sea ice and rain.
- The climate lab.
- A stage-by-stage audit of V1's climate.
- A test of how many points in the year the climate needs.

**Found.**

| Stage | V1 against real Earth |
|---|---|
| Wind direction | Within 45° only 55 % of the time |
| Rain belt | 10–13° too far poleward |
| Ocean warmth | Barely related to the real warm and cold currents (corr. 0.22) |
| Rain | Poor (corr. ≈ 0.5) |
| Temperature | The best stage, but 7.8 °C typical winter error |

- V1 matches Beck's Köppen map on 38 % of land.
- Swapping real data in: real temperature with V1's rain gives 56 %, and V1's temperature with real rain gives 66 %.
  So rain costs the most.
- **Your suspicion that errors average out: confirmed.**
- **Two seasons break Köppen.** Six points in the year keep 96.5 % of land in its class; four keep 93.6 %.

**Check in the lab.** Köppen with the sources Beck, 12 months, 6 points, 4 points, 2 seasons and V1. Rain, Pressure &
wind and Ocean warmth: Observed vs V1, side by side.

## Phase 1 — the core skeleton

**Built.** `computeClimate()` (`v2/js/climate/core.js`):
- a fixed grid;
- 12 months rebuilt from K points;
- each terrain cell corrected for its own height;
- Köppen per terrain cell, with Beck's rules.

It is generator-neutral: V1's axes or Evolution's, heights in km.

**Numbers.**
- Fed real Earth data, it matches Beck's fine map on ≈ 88 % of land. That is the ceiling for everything that follows.
- No drift from 160K to 2.5M terrain cells: class shares move ≤ 0.4 %. V1's temperate share, by contrast, falls from
  18 % to 11 % between 40K and 640K.
- It takes 0.34 s at 2.5M cells in Chrome.

**Check in the lab.** New climate → Temperature: "Real data" → Run; then Köppen → New, side by side with Beck.

## Phase 2 — temperature

**Built.** A seasonal energy-balance model (`temperature.js`, with the multigrid solver `solver.js`):
- sunlight for any tilt;
- land stores little heat, the sea a lot;
- heat spreads mainly poleward and is carried by the winds;
- snow and sea ice, with only snow that survives the summer acting like an ice sheet;
- plateaus heat the air above them; ice sheets chill it;
- winter inversions over snow in calm air.

**Your two directions during the phase.**
- *Physical settings that transfer to other worlds; Earth isn't gospel.* Tuning on the Americas and checking on the rest
  overfit, so the fix was physics.
- *Tune on the whole Earth, per continent.* Done. Only five settings moved a little from their literature values.

**Numbers.**
- Typical June–August / December–February error on land: 4.2 / 5.4 °C, vs V1's 4.9 / 7.8.
- Continents weighted equally: 4.2 vs 5.0 °C.
- Köppen with real rain: 68 %, vs 64 % with V1's temperature.
- Test planets: seasons biggest inland, a mild west coast, supercontinent interiors swinging 38 °C.

**Known.**
- Europe is too cold (the Gulf Stream comes in Phase 4).
- Desert summers are too mild and the rainforest too warm (both need rain and clouds, Phase 6).

**Check in the lab.** New climate → Earth → Run → Temperature → New, side by side with any month; Seasonal swing;
"New − observed"; each test planet.

## Phase 3 — pressure and wind

**Built.** `circulation.js` derives pressure and winds from the temperature:
- belts placed by the planet's own warmth: the rain belt at each longitude's warmest latitude, Hadley edges from Held &
  Hou;
- thermal lows over warm ground and highs over cold ground, with plateaus as elevated heat sources;
- winds from pressure with friction.

Temperature and winds run together until they agree.

**Numbers** (against V1 on the same cells, regions weighted equally):

| Measure | New | V1 |
|---|---|---|
| Wind direction within 45° | 73 % | 52 % |
| Pressure pattern error | 2.9 hPa | 4.0 hPa |
| Rain belt | 7.0° off | 11.6° off |

- **Named features:** the South Asian monsoon reverses (south-westerly in July), and the West African and East Asian
  winter monsoons are right. The eastern-ocean summer highs, the Siberian High and the Aleutian Low are present at
  about half strength.
- **Coupled:** temperature is no worse with its own winds.
- **Test planets:** trade winds and westerlies appear by themselves; monsoon winds onto the tropical continent and the
  supercontinent.

**Known.**
- The highs and lows are about half strength, which matters for Mediterranean climates (Phase 8).
- Southern Ocean winds are too weak.
- The coupled step is ~0.5–0.9 s (a speed pass is planned).

**Check in the lab.** New climate → Earth, Winds "Derived" → Run → Pressure & wind → New, side by side, month slider;
the cyan line is the new rain belt.

## Phase 4 — ocean

**Built.** `ocean.js`:
- Wind-driven gyres (a Stommel model). The Gulf Stream and Kuroshio come out of the physics on any map.
- Circumpolar currents where a latitude belt is open sea.
- The heat both carry into the temperature: warm water poleward along western edges, and cold upwelling where winds
  push surface water offshore (California, Peru, Namib, the Canaries, the equatorial Pacific).

Temperature, winds and ocean run together.

**Numbers.**
- The sea's warm-west / cold-east pattern: 0.36 vs V1's 0.24.
- Europe's temperature error: 5.4 vs 6.0 °C (real winds), 5.1 vs 5.4 °C (coupled).
- All named currents flow the right way, and all four upwelling coasts come out colder than their latitude.
- Test planets: warm currents poleward along east coasts, cold ones along west coasts.

**Known.**
- The effects are about a third of reality's.
- The North Atlantic isn't warmer than its latitude (that needs the deep overturning circulation, which this simple
  ocean doesn't have).
- With the model's own, gentler winds, the pattern weakens.

**Check in the lab.** New climate → Earth → Run → Ocean warmth → New, side by side with Observed (the arrows are the
currents); Sea ice → New by month.

## Phase 5 — rain

**Built.** `rain.js`: the water in each air column, in balance at each point in the year.
- **In:** evaporation from the sea (warm water, wind, storms); from land as much as the sunshine can evaporate and the
  ground holds, with snow and soil carrying water from wet months into dry ones.
- **Moved:** by the winds (only a shallow layer converges under dry air, a deep one where it rains) and mixed by storms.
- **Out:** rain, which grows steeply as the air nears saturation.
  - Winter storms make the storm belts rain more, so winter-wet west coasts appear by themselves.
  - Air off a cold sea is stable and rains less.
  - Mountains hold water back: wet windward, dry lee.

Water is conserved exactly (rain = evaporation worldwide). Everything is physics with literature ranges; Earth only
nudged the settings.

**Numbers** (real temperature, so the error is the rain stage's own):

| Measure | New (real winds) | New (own winds) | V1 |
|---|---|---|---|
| Rain pattern, Jun–Aug / Dec–Feb | 0.66 / 0.65 | 0.61 / 0.57 | 0.46 / 0.62 |
| Wet season the right way round | 78 % | 79 % | 81 % |
| Typical error per continent (lower is better) | 0.75 | 0.79 | 0.82 |
| Köppen: real temperature + this rain | 56.4 % | — | 55.2 % |

- **The whole new climate on Earth** (every stage new): **Köppen 46 % of land vs V1's 38 %**, wet season right way round
  88 %.
- **Named features that work:** the Atacama and inland Australia are dry; the South Asian, West African and East Asian
  monsoons; winter-wet California; the Pacific Northwest's rain shadow; the eastern Pacific rain belt north of the
  equator.
- **Test planets:** all pass. The coastal range is 77 vs 28 mm/month windward vs lee. The supercontinent has wet
  equatorial coasts and an arid interior, as paleoclimate runs of Pangaea do.

**Gate: partly met.** The truth swap, season patterns, continents and test planets beat V1 or pass. Two things don't:
the wet-season measure (78 % vs 81 %; it is 88 % with every stage new), and 9 of 16 named features.

**Known.**
- Deserts next to monsoons are too wet (Sahara, Arabia, Thar).
- Rainforests are too dry (Congo, the Maritime Continent).
- Patagonia's rain shadow is too weak.
- With the model's own winds, Africa's rain belt runs into the Sahara: the circulation puts the tropical trough at the
  hottest latitude. Phase 6 places it by where the air is moist and warm.
- It is slow: the whole climate takes 2.2 s at 160K in Chrome (V1: 0.5 s at 40K). The speed pass is Phase 6.

**Check in the lab.** New climate → Earth (Rain "New (Phase 5)") → Run → Rain → New, side by side with Observed; "New −
observed" for the ratio; Köppen → New against the Beck map. The test planets, including the new coastal range.

## Phase 6 — the coupled climate

**Built.**
- **Rain feeds back into temperature through clouds.** Rainy land is shaded and dry land gets the full sun; the planet's
  average brightness is unchanged. This fixed part of Phase 2's known error (desert summers too mild, wet summers too
  warm): land temperature error 4.4 → 3.9 °C, Köppen +2.3 points.
- **A final Köppen-level tune** of a few coupling settings. Each stage's own score was a guardrail and no continent could
  get worse; only the cloud strength moved, within its literature range.
- **A speed pass.**
  - The grid-scale stages now run on a 3° grid (scores the same or better).
  - Two coupling rounds instead of three.
  - Solver and smoothing speed-ups.
- **Tried and dropped:** placing the tropical rain belt by where the air is moist (the textbook monsoon fix) made
  Köppen worse (45–46 % vs 46.3 %), so it isn't in.

**Numbers** (Earth, every stage new):

| | New | V1 |
|---|---|---|
| Köppen, same class as Beck | **49.5 %** | 38 % |
| Same major group (A/B/C/D/E) | 74.9 % | — |
| Per continent | N. America 50, S. America 41, Europe 50, Africa 61, Asia 30, Australia 62 % | — |
| Same at 640K / 2.5M cells | 49.4 % / 49.4 % (class shares within 0.6 %) | V1 drifts: its temperate share falls 18 → 11 % from 40K to 640K |
| Time, Chrome desktop, 40K / 160K | 0.8 s / 0.8 s | 0.51 s / 2.07 s |

Every stage's own gate still passes at the final settings.

**Gate: mostly passed.** Köppen beats V1, no drift, stages hold. **Speed:** 1.6× slower than V1 at V1's 40K default,
faster than V1 from 160K up (the new climate barely depends on the terrain resolution).

**Known.**
- Asia is the weakest continent (30 %): boreal summers still a little warm; Tibet comes out as cold desert.
- Dry-winter climates (Cw, Dw) are nearly missing.
- Mediterranean recall is 7 %: Phase 8.
- The test planets come out arid (a flat mid-latitude continent is about ⅔ desert or steppe). The model's own
  westerlies are weak, so moisture reaches inland poorly. On Evolution's planets this will read as too much desert.

**Check in the lab.** New climate → Earth → Run (40K or 160K; the time is in the table) → Köppen → New, side by side with
the Beck map; Temperature → "New − observed". The Phase 6 table has the per-continent scores, regimes, drift and the
test planets' climates.

## Phase 7 — Evolution

*(to come)*

## Phase 8 — Mediterranean climates

*(to come)*
