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

## Where it stands

| Phase | What | Gate | Headline |
|---|---|---|---|
| 0 | Earth references, the lab, V1 audited stage by stage | — | V1's stages are individually poor; rain costs the most |
| 1 | The core skeleton (grid, 12 months, height correction, Köppen) | passed | With real data, ≈ 88 % Köppen per terrain cell; no drift 160K–2.5M |
| 2 | Temperature (energy balance) | passed | 4.2 vs V1's 5.0 °C error (continents weighted equally); test planets physical |
| 3 | Pressure and wind (derived from temperature) | passed | Wind direction 73 % vs V1 52 %; monsoons reverse; rain belt 7° vs 11.6° |
| 4 | Ocean | … | … |
| 5 | Rain | … | … |
| 6 | The coupled climate, tuned on Köppen | … | … |
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

*(in progress)*

## Phase 5 — rain

*(to come)*

## Phase 6 — the coupled climate

*(to come)*

## Phase 7 — Evolution

*(to come)*

## Phase 8 — Mediterranean climates

*(to come)*
