# Climate Tuning Suite

Automated tuning of the climate simulation parameters against **real Earth**.

The suite runs the app's heightmap-import pipeline on `assets/earth.png` directly
in Node (no browser), simulates climate (wind → ocean currents → precipitation →
temperature → Köppen), and scores the resulting Köppen map against the observed
Köppen-Geiger classification (Kottek et al. 2006, 0.5°, observed 1976–2000).
An optimizer then tweaks the parameters in `js/climate-config.js` to maximize
the match.

## Scoring

Only cells where **both** the simulated mesh says land **and** the ground-truth
grid has a climate class are scored — coastline/land-mask disagreements are
excluded (and reported separately as `landAgreement`).

- `exactAcc` — fraction of scored cells with the exact Köppen class (30 types)
- `majorAcc` — match on major group only (A/B/C/D/E)
- `macroF1` — unweighted mean F1 across classes present in the truth, so rare
  but important classes (Mediterranean Csa/Csb, monsoon Cwa/Dwa…) aren't drowned
  out by large deserts and subarctic zones
- **objective = 0.5·exactAcc + 0.5·macroF1** — what the optimizer maximizes

Ground-truth codes are mapped onto the app's class set (`As` → `Aw`, the standard
merge). Ground truth lives in `data/ascii/Koeppen-Geiger-ASCII.txt`.

## Usage

```bash
# Baseline score of current defaults (+ PNG comparison maps)
node tuning/climate/evaluate.mjs --maps

# Optimize the ~35 high-impact parameters (150 evaluations)
node tuning/climate/optimize.mjs

# Longer run over all ~80 parameters
node tuning/climate/optimize.mjs --iters 500 --subset all --label big-run

# Validate the winner at higher resolution before trusting it
node tuning/climate/evaluate.mjs --params tuning/results/climate/<label>-best.json --n 160000 --maps

# Write the tuned values into js/climate-config.js (then review the diff!)
node tuning/climate/apply-params.mjs tuning/results/climate/<label>-best.json
```

Default mesh resolution is `--n 40000` (fast, ~seconds per evaluation).
Tuning results are exchangeable across resolutions to a good approximation
because the simulation is scale-invariant by design, but always validate at
≥160K before applying.

## Files

```
evaluate.mjs        score one parameter set, print report, optional PNG maps
optimize.mjs        coordinate descent + stochastic hill-climb over param-space
apply-params.mjs    write tuned values back into js/climate-config.js
param-space.mjs     min/max range + high-impact flag for every parameter
diagnose.mjs        spatial error report: group fractions per lat band + named regions
probe.mjs           parameter sensitivity: swing each lever, flag inert ones
probe-nindia.mjs    root-cause probe for the monsoon region
probe-desert.mjs    which lever controls the subtropical desert glut
probe-tier01.mjs    wiring check for the Tier 0/1 levers
lib/earth-context.mjs   Earth evaluation context (mesh from lib/earth-mesh.mjs) + ground-truth mapping
lib/score.mjs           climate chain runner + metrics (objective weights here)
lib/koppen-distance.mjs climatic-distance model for graded scoring
lib/ground-truth.mjs    Köppen-Geiger ASCII grid parser
lib/render.mjs          equirectangular PNG rendering (sim / truth / diff)
data/               ground truth (gitignored; see below to re-download)
maps/               rendered comparison maps (gitignored)
```

## Diagnostic workflow

The tuning loop is: **diagnose → probe → change/tune → re-diagnose**.

```bash
node tuning/climate/diagnose.mjs --n 160000   # where is it wrong (lat bands + regions)?
node tuning/climate/probe.mjs                 # do the levers that should fix it actually work?
```

`probe.mjs` swings each parameter between extremes and flags any that are **INERT**
(a likely bug or downstream cancellation) — this is how the monsoon-relief bug and
the classifier miscalibration were found. Always probe before adding new code: a
lever that does nothing means the fault is elsewhere.

The diff map colors: green = exact match, yellow = major group match,
red = wrong group, dark = not scored (ocean or mask disagreement).

## Re-downloading ground truth

The Vienna server can be unreachable; the Wayback Machine mirror works:

```powershell
curl.exe -L -o tuning/climate/data/Koeppen-Geiger-ASCII.zip `
  https://web.archive.org/web/2023id_/https://koeppen-geiger.vu-wien.ac.at/data/Koeppen-Geiger-ASCII.zip
Expand-Archive tuning/climate/data/Koeppen-Geiger-ASCII.zip tuning/climate/data/ascii
```

## New climate (Evolution): per-stage Earth references

The new climate (`v2/js/climate/`, plan in `plans/CLIMATE_REBUILD_PLAN.md`) is scored **stage by stage**
against observations on a shared 1° grid, not only on the final Köppen map.

```bash
npm install --no-save h5wasm netcdfjs geotiff   # dev-only readers (netCDF-4/HDF5, netCDF-3, GeoTIFF)
node tuning/climate/fetch-references.mjs        # ~210 MB download, all public (Beck archives from figshare can be slow)
node tuning/climate/regrid-references.mjs       # → data/ref1deg/: 12 monthly layers per field on the 1° grid
node tuning/climate/season-test.mjs             # can the climate run at K points in the year? (+ classifier check)
node tuning/climate/stage-audit.mjs [--n N]     # V1's climate, stage by stage, vs observations + truth swaps
node tuning/climate/hash-earth.mjs              # fingerprint of the Earth context + V1 climate (pure refactors: unchanged)
node tuning/climate/skeleton-check.mjs          # Phase 1: the new core fed with real data at 160K/640K/2.5M — ceiling + drift gate
node tuning/climate/temperature-check.mjs       # Phase 2: the temperature stage per continent, vs V1, truth swap, test planets
node tuning/climate/temperature-check.mjs --tune          # … continent-aware tuning (whole Earth, priors, no continent worse)
node tuning/climate/temperature-check.mjs --set TEMP_GRID_DEG=1   # … try settings without editing config.js
node tuning/climate/diag-temperature.mjs        # where the temperature is wrong (latitude bands, named regions)
node tuning/climate/circulation-check.mjs [--tune]  # Phase 3: pressure & wind per continent and ocean basin, vs V1,
                                                #   named features (monsoons, highs), coupled temperature, test planets
node tuning/climate/ocean-check.mjs [--tune]    # Phase 4: sea temperature per basin, currents and upwelling coasts,
                                                #   land temperature with/without the ocean's heat, test planets
node tuning/climate/rain-check.mjs [--tune] [--quick]  # Phase 5: rain per continent (Beck) and ocean basin (GPCP), with
                                                #   real and with derived winds; vs V1; named features; truth swap;
                                                #   every stage new; test planets (--quick: open loop only)
node tuning/climate/diag-rain.mjs [--derived]   # where the rain is wrong: zonal means, named boxes, wet-season map
node tuning/climate/coupled-check.mjs [--tune] [--quick]  # Phase 6: every stage new — Köppen per continent with each
                                                #   stage's score as a guardrail; drift at 640K/2.5M; test planets;
                                                #   --tune: the final Köppen-level tune (TUNE_KEYS=… to choose)
node tuning/climate/profile-climate.mjs         # every stage call timed
node tuning/climate/hash-climate.mjs            # fingerprint of every stage's output (exact speed-ups keep it)
node tuning/climate/test-solver.mjs             # the grid solver recovers a known field (correctness + speed)
node tuning/dev-server.mjs 8147                 # then open http://localhost:8147/v2/climate-lab.html
```

| Field (data/ref1deg/) | Source | Licence |
|---|---|---|
| `t2m`, `precip` — monthly land temperature (°C) and rain (mm/month) | Beck et al. 2023, 1991–2020, 1° | CC BY 4.0 |
| `koppen_beck.u8` (1°), `koppen_beck_0p1.u8` (0.1°) — Köppen truth | Beck et al. 2023, 1991–2020 | CC BY 4.0 |
| `slp`, `u10`, `v10` — sea-level pressure, near-surface wind | NCEP/NCAR Reanalysis 1, 1991–2020, 2.5° | public domain |
| `sst`, `seaIce` — sea-surface temperature, sea-ice fraction | NOAA OISST v2, 1991–2020, 1° | public domain |
| `precipAll` — rain over land and sea | GPCP v2.3, 1991–2020, 2.5° | public domain |

Beck's monthly temperature and rain are the data behind Beck's own Köppen map, so the temperature, rain and
Köppen answer keys are consistent with each other (the new classifier reproduces the published map on 93 % of land).
The Köppen truth for the new climate is Beck (0 °C C/D boundary), not the Kottek map the V1 tuner uses.

**Earth is a check, not the target.** Every new-climate setting is a physical quantity with a literature value and a
plausible range (`v2/js/climate/config.js` `PARAM_PRIORS`). Tuning uses the whole Earth, but each continent is scored on
its own and weighted equally (`lib/continents.mjs`), a change is kept only if no continent ends up worse than with the
literature values, and every setting is pulled toward its literature value. Each stage must also behave as physics
expects on synthetic test planets (`v2/js/climate/test-planets.js`).

Files: `fetch-references.mjs`, `regrid-references.mjs`, `inspect-references.mjs` (list variables),
`season-test.mjs`, `stage-audit.mjs`, `hash-earth.mjs`, `skeleton-check.mjs`, `temperature-check.mjs`,
`diag-temperature.mjs`, `test-solver.mjs`, `circulation-check.mjs`, `ocean-check.mjs`, `rain-check.mjs`, `diag-rain.mjs`, `diag-planet-rain.mjs`, `coupled-check.mjs`,
`profile-climate.mjs`, `hash-climate.mjs`; `lib/continents.mjs` (continent-aware scoring),
`lib/regions.mjs` (continents + ocean basins), `lib/nc-read.mjs` (netCDF reader), `lib/unzip.mjs`
(dependency-free zip entry extraction), `lib/ref.mjs` (reference loader), `lib/compare.mjs` (area-weighted class
comparison), `lib/earth-mesh.mjs` (the Earth mesh, environment-free — shared by `earth-context.mjs` and the browser
climate lab). Outputs: `tuning/results/climate/{season-test,stage-audit-N}.json` and `data/lab/` (the lab's copies).

## How parameters flow

`js/climate-config.js` exports a mutable `CLIMATE` object (defaults frozen in
`CLIMATE_DEFAULTS`). The climate modules (`wind.js`, `temperature.js`,
`precipitation.js`, `heuristic-precip.js`) read it at runtime, so the optimizer
sweeps parameters in-process without reloading. The browser app always runs the
defaults — tuning only changes the app when you run `apply-params.mjs` and
commit the result.
