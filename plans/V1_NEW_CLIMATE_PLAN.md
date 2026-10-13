# Generate & Import on the new climate — plan

The developer (2026-10-13): *"update the generate AND import to use the new climate code, as it's much faster and imo more
accurate"* — and *"the other piece that evolution doesn't have but should is the temperature and precipitation toggles
that allow users to increase or decrease planet-wide temperature and precipitation."*

Not started. This is the map of what it takes; the decisions it needs are at the end.

## Why

| | V1 climate (`js/wind.js` … `js/koppen.js`) | New climate (`v2/js/climate/`) |
|---|---|---|
| Earth Köppen match (Beck, land) | 38 % | 47–51 % (oracle ceiling ~88 %) |
| Temperature error on Earth | 5.0 °C | 4.2 °C |
| Wind direction within 45° | 52 % | 72 % |
| Time, desktop Chrome | 0.51 s at 40K · 2.07 s at 160K · 10.9 s at 640K · ~1 min at 2.5M | **0.8–1.0 s at any size** |
| Scale invariance | temperate share 18 % → 11 % from 160K to 2.5M | drift ≤ 0.4 % |

(plans/CLIMATE_REBUILD_REPORT.md.) Generate's default detail (~204K regions) runs V1's climate in roughly 2.5–3 s (between the 160K and 640K timings); the new one
would take ~1 s, and the same ~1 s at 2.5M — so **climate no longer has to be deferred above 300K**. The one place it is
slower: below ~80K regions (V1 0.5 s at 40K, less at 2K; the new one is ~0.8 s flat).

## What makes this tractable

- **The new climate was built to be called from V1.** `planetClimate({ xyz, elevKm, axes: 'y-up' }, options)` takes the
  unit-sphere positions and heights in km — no adjacency, no plates — and already supports V1's Y-up axes. The tuning
  scripts already run it on V1's Earth mesh (`profile-climate.mjs`, `coupled-check.mjs`) and the climate lab does too.
- **It is DOM-free and imports nothing of V1's climate** (one transitive import of `js/rng.js`). V1's module worker can
  import `../v2/js/climate/climate.js` directly — no build step, no copy.
- **Köppen is identical**: same 31 classes in the same order with the same colours (`js/koppen.js` vs
  `v2/js/climate/koppen.js`, checked). So the Climate tab, the Satellite colours (`biomeColor` by class), the Köppen legend
  and hover, and the Köppen / Satellite / Export All exports keep working unchanged.
- **The sliders' hooks exist**: `tempOffsetC` (°C) and `precipScale` (×) are options of `computeClimate` — neither page
  passes them today.
- **Heights**: V1 already has `elevToHeightKm` (`js/color-map.js:7`), sea at 0 km — what the new climate expects.

## What does not line up

V1's consumers read **per-region summer/winter fields, normalized 0–1**; the new climate gives **per-cell annual
temperature, rain and Köppen**, and **monthly fields on a 1° grid**. So the work is an adapter plus some consumer changes.

| V1 field / layer | Read by | From the new climate |
|---|---|---|
| `r_temperature_summer/winter` (0–1 ↔ −45…45 °C) | temperature layers, hover, (old Köppen) | land: each cell's July / January from `cellClimate`'s `onCell` (12 months per land cell); sea: the 1° grid's `monthlySL`, sampled bilinearly |
| `r_precip_summer/winter` (0–1, p95) | precipitation layers, hover | same, from the 12 months' rain — **in mm/month** (see Units) |
| `r_wind_east/north_*`, wind speed, pressure (hPa from 1013) | wind/pressure layers, wind arrows | circulation `u`, `v`, `slp` for July / January on the 1° grid, sampled to regions (east/north are the grid's u/v) |
| `itczLons`, `itczLatsSummer/Winter` | ITCZ line on the pressure layers | circulation's `itczLat` per longitude, July / January |
| `r_ocean_current_east/north_*`, speed, warmth | current layers + arrows | ocean `u`, `v` — **annual only** (the new ocean is driven by the year's mean stress), so summer = winter; warmth from the sea-temperature anomaly (as Evolution's Currents view), speed p95 |
| `koppen` | Climate tab, Satellite, legend, exports | `cell.koppen` — as is |
| `rainShadowSummer/Winter` | Inspect › Rain Shadow | **not an output today**: the orographic windward/lee factor is computed inside `rain.js` (`orographicRain`) — expose it |
| `continentality`, `tempContinentality` | Inspect › Continentality, Temp Continentality | **no like-for-like**: the new climate does continentality physically (air masses, `temperature.js` Phase 12). Nearest honest layer: the annual temperature range (July − January), which *is* continentality's effect |

### Units

V1 normalizes temperature and rain to 0–1 and the readouts then mislabel them (Import prints 0–1 values as "°C" and
"mm/yr"; Generate shows rain ×1000 as "mm"). The new climate's fields are physical. Plan: **carry °C and mm/month to
the main thread** and change the colour ramps and readouts to physical scales — Evolution's ramps
(`v2/js/evolution/climate-view.js`) already exist for exactly these, which also makes the three pages agree.

### The temperature offset

`tempOffsetC` is added **after** the physics (`core.js:115`): a −15 °C world reads colder and classifies colder, but
grows no extra sea ice or ice sheets and its rain does not change. For a believable "ice world" / "hothouse", feed it into
the energy balance instead (a forcing in `temperature.js`, so albedo and ice respond). Phase 1 decides by looking at both.

## Phases

**0 — Spike (S).** In Node: run the new climate on a Generate planet and an Import Earth at 2K · 40K · 200K · 640K · 2.5M
through V1's own mesh pipeline. Record timings, check land/sea (V1's elevation ≤ 0 is sea), and render Köppen maps next to
V1's. Try the two temperature-offset semantics at ±15 °C. No page changes.

**1 — The adapter (M).** `js/climate-new.js`: V1 mesh + `r_elevation` + sliders → `planetClimate(…, { axes: 'y-up',
tempOffsetC, precipScale })` → V1-shaped `climateFields` and `debugLayers` (table above), plus the physical values.
Expose the orographic factor from `rain.js` (a small, additive change in v2 — Evolution unaffected). Unit-test the
adapter's mapping on Earth (July hotter than January in the north, westerlies at 45°, Köppen = `cell.koppen`).

**2 — Wire it in (S).** `js/planet-worker.js`: the five places that run the V1 chain (`handleGenerate`, `handleReapply`,
`handleEditRecompute`, `handleImportHeightmap`, `handleComputeClimate`) and `generateFallback` call the adapter. Keep a
`?climate=v1` URL flag during development for side-by-side comparison. A slider change reruns the climate (~1 s, as now —
V1 cached wind and ocean; the new one recomputes, which is what the coupling needs).

**3 — Consumers (M).** `planet-mesh.js` colour functions (three copies: map mesh, globe mesh, recolour) to physical
ramps; legends; hover readouts on both pages (fixes Import's mislabelled units); ITCZ line; the Inspect list
(Rain Shadow from the exposed factor; Continentality → annual temperature range; drop or re-point Temp Continentality —
**decision**). Consider adding the new climate's extras as layers: sea ice, ice sheets, sea-temperature anomaly.

**4 — Deferred climate and speed (S).** With ~1 s at any size, drop the 300K "skip climate" path (`shouldSkipClimate`,
`state.climateComputed`, the export modal's disabled types, Export All's pre-compute) or keep it only on phones — measure
on a phone first. Below ~80K the new climate is slower than V1; acceptable at ≤ 0.5 s extra, but measure.

**5 — Import specifics (S).** The initial import ignores the Temperature / Precipitation sliders (sends neither) — pass
them. Land Coverage's dryness hack (`precipitation.js:515`: big continents drier) has no place in the new climate, which
dries continental interiors physically — remove it, check large-continent planets still look right.

**6 — Tuning & CLAUDE.md (S–M).** `tuning/climate/evaluate.mjs` / `optimize.mjs` still score **V1's** climate (their
`lib/score.mjs` imports `js/wind.js` …). Point them at the adapter (or at `computeClimate` on the V1 Earth mesh, as the
v2 scripts already do), reconcile the three conflicting descriptions of the objective (README, comment, code), and update
CLAUDE.md's climate paragraph: tunables live in `v2/js/climate/config.js` (`PARAMS`), not `js/climate-config.js`.

**7 — Evolution's Temperature & Precipitation (S–M).** The same two controls (−15…+15 °C; ±50 %) in Evolution's World
section, in the link (`temp=`, `rain=`), passed to the climate worker and to Finish. Changing one: preview climates are
recomputed on demand (~1 s); a detailed moment is *out of date* — its rivers, glaciers and Satellite were sculpted by the
old climate — so the card says so and offers Add detail again. Also update the tutorial's "Steer it" step.

**8 — Satellite (optional, L).** V1's Satellite view colours by Köppen class (`biomeColor`). Evolution's is far better —
forest / grass / bare / snow cover from each cell's 12 months (`finish-cover.js` `landCover`). Using it for Generate and
Import is the biggest visual upgrade on offer, but a bigger job (per-region months, its colour pipeline, export). A
separate step, after the rest has settled.

**9 — Cleanup & docs (S).** Once the flag has been unused for a while: delete V1's climate modules (`wind.js`, `ocean.js`,
`precipitation.js`, `heuristic-precip.js`, `temperature.js`, `climate-config.js`, the old Köppen rules), `?climate=v1`
and the old tuning. README (Features: wind, ocean, precipitation paragraphs describe V1's models), the Generate tutorial
(step 3: "At high detail, climate is skipped automatically"), `llms.txt` (technical details), What's New (a heads-up:
planet codes still load but climates change, as last time).

## Against "What Users Love"

- **Climate depth** — gains accuracy; every layer keeps a meaningful equivalent (the Continentality layers change
  meaning — decision below). Never fewer layers.
- **Instant** — faster at the default detail and far faster above it; slightly slower at the lowest detail.
- **Customizability** — the Temperature / Precipitation sliders keep their ranges, so **planet codes stay valid** (no
  `planet-code.js` change) — but the same code gives a different climate.
- **Mobile** — the 1° grid costs the same on a phone at any detail; measure the absolute time on a phone (Phase 4).

## Decisions needed

1. **Continentality layers**: re-point *Continentality* to the annual temperature range and drop *Temp Continentality*
   (it shows V1's zone bookkeeping), or keep both with new meanings?
2. **Temperature slider semantics**: a post-hoc shift (as now, cheap) or a forcing (ice and rain respond — more believable
   at ±15 °C)?
3. **Seasons**: keep V1's Summer / Winter labels, or use Evolution's January / July / Year everywhere?
4. **Satellite (Phase 8)**: in this project or later?
5. **Transition**: ship behind a flag first, or switch outright on the branch and compare there?
