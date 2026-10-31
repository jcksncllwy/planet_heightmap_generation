# Civ layer — early human civilization on an Orogen planet

**Goal:** a ruleset that, run on a World Orogen planet, reliably grows foragers → farmers → villages → city-states → trade networks, up to simple metallurgy (copper, arsenical copper, tin bronze). **Acceptance test: it produces an Ur / Uruk / Babylon — and on Earth's own data it puts them where they were.**

Status: Phase 0 built (2026-10-21, branch `civ`). Sources and numbers are in [CIV_RESEARCH.md](CIV_RESEARCH.md); `[L]` marks a figure from the literature not yet checked against its primary source.

**Decisions (developer, 2026-10-21):**
- The civ layer is a feature *inside* Orogen (`v2/js/civ/`), not a separate codebase.
- Earth reference data may be downloaded for the Earth test (`tuning/civ/fetch-earth.sh`).
- The sim runs on a **human clock** (years, not Myr) for as long as it is asked to, on a finished moment's fixed geography.
- The first milestone is Phase 0: the cradle finder.

---

## 1. Philosophy (borrowed from Orogen)

Orogen is "concept art for planets: plausibility, not precision", and the civ layer should work the same way. Each rule should be **one documented heuristic from the archaeology/anthropology literature, in physical units** (km, years, persons/km², kg/ha, mm of rain). That gives three properties:

- **Scale invariance.** Results don't depend on mesh resolution, the same rule Orogen enforces.
- **Testability.** Every rule can be checked against Earth, the way Orogen's `tuning/climate/evaluate.mjs` scores its Köppen classes against the real map.
- **Explainability.** A city should be able to say *why* it's there: "levee on a flood-regime river through desert, 600 km downstream of a wild-cereal zone, with copper 1,100 km away by water".

We simulate **populations on cells** (GLUES-style aggregates), not individuals. Discrete settlements and polities appear only once villages exist. Household-level noise enters as **yield variance**, following the MASS project's finding that settlements fail because of their *most-stressed* households, not the average one.

## 2. What Orogen already gives us (and it's a lot)

All of these are per-cell fields from Evolution's **Add detail** (`v2/js/finish/finish.js`), and they run headlessly through `v2/tools/render-moment.mjs`:

| Orogen field | Civ use |
|---|---|
| `z` elevation, slope, `ocean`, `lake`, `lakeLevel` | Movement cost (Tobler), coast, harbours, defensibility, Last Glacial Maximum shoreline (re-threshold `z` at −120 m to expose the shelves) |
| Monthly T12 / P12 (via `cellClimate`), Köppen, `tAnnual`, `pAnnual` | Net primary productivity (Miami model), effective temperature (ET), crop envelopes, the 200–300 mm rain-fed limit |
| `cell-stats`: `aridity`, `growing` (months > 10 °C), `rainSeason` (seasonality), `tRange` | Wild-cereal suitability (Mediterranean seasonality), farming failure risk |
| `cover`: tree / grass / bare shares, biome, snow months | Forager game vs plant base, pastoral potential, timber |
| `rivers`: discharge (m³/s), **monthly flows**, **regime** (steady / *flood season* / seasonal / ephemeral), flood months, **`farFed`** | Irrigation and flood-recession farming, river transport. `farFed` is literally "a big river from wet mountains through dry country", the Nile / Tigris–Euphrates signature |
| `loess`, `erg` (sand seas), flood-basalt, ice | Fertile soils (loess, cf. the LBK and the Yellow River), barriers |
| Tectonic record (`CrustType`, `OrogenyType`, `CrustFlag`: SUTURE, FAILED_RIFT, LIP, TRENCH, ARC; belt side UPPER/LOWER; volcanic type) | **Ore geology**, see §5.6 |

So Orogen can already generate the *physical* preconditions of Mesopotamia from first principles. A collision belt (Zagros = HIMALAYAN/URAL, LOWER side) produces a foreland basin. Orographic rain on that belt feeds a far-fed river with a spring snowmelt flood. The river crosses a BWh desert to a gulf. The civ layer's job is to turn those preconditions into people.

## 3. Architecture

A feature of Evolution's finished moments, beside the climate and rivers it reads:

```
history → moment → finishPlanet (finish.js)        Earth: WorldClim + HydroRIVERS + MRDS (tuning/civ/lib/earth-world.mjs)
                 │                                         │
                 └────────────► the civ "world" ◄───────────┘  { mesh, z, ocean, lake, koppen, tAnnual, pAnnual, stats, rivers, loess, erg }
                                     │
v2/js/civ/civ-config.js     every constant in physical units, with its source; CIV_PRIORS = tuning ranges
v2/js/civ/substrate.js      static layers: NPP, ET, foragers, wild crop packages, rain-fed and irrigated yields, river regimes
v2/js/civ/resources.js      ores and materials from the tectonic record (or mapped deposits, on Earth)
v2/js/civ/cradles.js        Phase 0: ranked irrigable alluvia — where an Ur could arise
v2/js/civ/sim/…             Phases 1–5: the time-stepped rules (to come)
v2/tools/civ-cradles.mjs    headless: a generated world's layers, maps and cradles (→ v2/out/civ/); --seeds for a census
tuning/civ/earth-check.mjs  the Earth test (→ tuning/civ/results/)
```

- **No changes to the finish.** The civ layer reads `finishPlanet`'s return (with `debug` for loess and sand) and the moment's frame. Monthly T/P per cell would need a small hook in `finish.js`; Phase 0 manages without one (the cell-stats measures and Köppen carry the seasonality).
- **Köppen everywhere it helps.** The crop packages' climate envelopes are keyed by Köppen class (Cs → winter-rain cereals, Cw/Dw/Cfa → summer-rain cereals, Af/Am/Cwb → tubers), as are timber and salt flats. Envelopes keyed by class also make Diamond's axis effect come out of the rules by itself.
- **Scale.** Rules are in km. Phase 0 runs at 640K cells (~30 km), where a river's floodplain is narrower than a cell, so each river cell carries an *irrigable share* (floodplain width ∝ √discharge). Settlement-scale phases (city-states 15–30 km apart) want 2.5M cells (~14 km) on land.
- **The clock.** Years. Steps of ~25 yr (one generation) for foragers and early farmers, ~10 yr once villages exist, 1 yr once polities fight (as in Turchin 2013). The world's geography stays fixed while the sim runs; sea level and climate can be offset (a glacial stage: −120 m and a cooler, drier climate through the climate's own `greenhouseWm2` / `precipScale`). A run starts from a chosen origin (people arriving, or a "Holocene" switch) and runs until stopped.

## 4. Substrate (static layers, computed once per world)

1. **Net primary productivity (NPP)** from T and P (Miami model, Lieth 1975). **Effective temperature (ET)** = (18W − 10C)/(W − C + 8), from the warmest and coldest months.
2. **Forager carrying capacity K_f** = 10^(9.6e-4·NPP − 1.53) persons/km², times aquatic multipliers:
   - ×3–10 on coast, estuary, lake shore, and big-river cells (by discharge)
   - a seasonality penalty (short growing season → meat diet)

   Sanity bands: arctic 0.005–0.05, desert 0.01–0.2, savanna 0.1–0.5, rich coast 0.5–3.
3. **Wild-cereal suitability W** (Blumler; Mediterranean seasonality) = rainfall 300–800 mm × strong winter-wet/summer-dry seasonality (Csa/Csb/BSk margins) × hilly relief (ecotones, many microclimates within one territory). Analogous envelopes for other crop packages:
   - summer-monsoon millet/rice (Cwa / Cfa with flood plains)
   - tropical tubers (Af/Am, highland)
   - highland tubers / quinoa (cold high plateaus)

   Each package carries its own climate envelope, so Diamond's axis effect *emerges*: a package spreads only into cells inside its envelope.
4. **Farm yield Y** (kg/ha):
   - rain-fed 400–750 where P ≥ 250–300 mm (barley alone down to 200)
   - failure risk rising toward the isohyet, ~1 in 3 years at the edge
   - loess and floodplain bonus
5. **Irrigation potential I**: flat floodplain cells (low slope, near the channel, a few metres above it = levees) beside a river with regime FLOOD or STEADY, discharge above a threshold, and ideally `farFed` with low local rain.
   - Yield ~1,500 kg/ha, seed:yield ~1:20–30 (Ur III) vs 1:3–10 dry farming.
   - **Farmer capacity:** irrigated ≈ 250/km² of cultivated land vs rain-fed ≈ 17/km² regionally.
   - **Salinisation debt** accumulates where evaporation is high and drainage poor (−0.5–1%/yr; barley replaces wheat).
6. **Cost surfaces.**
   - Land: Tobler v = 6·e^(−3.5|S+0.05|) km/h; ×0.6 off-path; penalties for forest, swamp, desert and river crossings.
   - River: downstream ~65 km/day, upstream 10–15.
   - Sea: ~50–100 km per daylight day, coast-hugging, with max open-water hops by era.
   - Relative bulk cost sea : river-down : river-up : donkey ≈ **1 : 4–5 : 8–10 : 30–40** (from ORBIS / Diocletian's edict).
7. **Resource deposits** from geology (§5.6).

## 5. Rules, in the order they switch on

### 5.1 Origin and dispersal (foragers)
- **Origin:** a tropical savanna (Aw) region with high K_f on the largest continent, or chosen by the user.
- **Spread** is reaction–diffusion on K_f (Fisher–KPP with generation delay): v = 2√(aD)/(1 + aT/2), a ≈ 0.02–0.03/yr, T ≈ 25–30 yr. Inland fronts move ~0.5–1 km/yr; coasts and river valleys run 2–10× faster (coastal route; ~5–10 km/yr down the Americas).
- **Barriers:**
  - ice
  - hyper-arid cells (P < ~150–250 mm) unless a "green" humid-period pulse is on; pulses are optional climate wiggles
  - open water beyond the era's limit: ≤ 20–30 km before 60 ka; ≤ ~100 km if the far shore is visible after; open ocean only with Austronesian-style tech
- **Sea level:** −120 m during the glacial stage, so Beringia-style land bridges and exposed shelves appear for free from Orogen's bathymetry. They drown at the Holocene transition, pushing people inland. This is the "Gulf Oasis" story behind southern Mesopotamia.
- **Group structure:** bands of ~25, mating networks of ~500. Territory = group size / density.

### 5.2 Holocene switch, sedentism and packing
- **Farming is impossible before the Holocene switch** (Richerson, Boyd & Bettinger 2001), modelled as a drop in climate variance plus a CO₂ rise.
- **Packing:**
  - Density > 1.6/100 km² constrains big-game hunting.
  - Density > **9.1/100 km²** (Binford's packing threshold) marks a cell as *intensifying*: broad-spectrum diet, aquatic foods, sedentism where resources are dense and storable (aquatic + W).

### 5.3 Domestication
For each sedentary, packed cell with W > 0, a "cultivation" counter runs:

```
hazard ∝ W · packing · invU(climate volatility) · time
```

- `invU` is the inverted-U of Ashraf & Michalopoulos: intermediate volatility domesticates first.
- Pre-domestication cultivation lasts ~1–3 kyr before the package "fixes".
- Expect 2–10 independent centres per Earth-like world. Animals (sheep, goats, cattle) come from grassland/steppe herds near the same centres.

### 5.4 Spread of farming
- **Demic wave:** ~0.6–1.3 km/yr (Pinhasi et al. 2005), with a ≈ 0.03/yr and ⟨Δ²⟩ ≈ 1,500 km² per generation.
- **Leapfrog** along coasts and rivers at 5–10 km/yr: seed colonies up to 100–300 km ahead.
- **Stall** at envelope edges, slowed by climate mismatch. Loess is a highway.
- Farmers reach 10–100× forager density. Foragers next to farmers either adopt (if already packed) or retreat.
- **Pastoralism** branches off where grass share is high but rain-fed farming fails (BSk), creating the steppe frontier Turchin needs.

### 5.5 Settlements, hierarchy, and the state
- **Settlement siting** (fine grid). Score =
  - farm catchment: distance-weighted yield within ~5 km, weight 1 at 0–1 km falling to 0 at 4–5 km (Chisholm; Vita-Finzi & Higgs)
  - water: exp(−d / 0.5–1 km) to permanent water
  - levee crest bonus
  - confluence, head of navigation, harbour, delta-edge bonuses
  - defensibility × local conflict
- **Settlement size cap.** A settlement can't exceed what its catchment yields × reliability feeds, plus *imported grain by water*. Rain-fed towns therefore cap near ~100–120 ha (Wilkinson 1994), while river cities can reach Uruk's 400+ ha.
- **Hierarchy tiers.** Thresholds at ~150 / ~500 / ~2,500 people (Kosse; Alberti 2014 measured 127), each tier ~×6 units (Johnson's scalar stress). A **state** is ≥ 3 administrative levels above the village (Wright & Johnson). Otherwise villages fission.
- **Surplus capture** ∝ storable-crop share × harvest seasonality × predictability (Mayshar, Moav & Pascali). Cereals and flood-recession farming are taxable; tubers aren't, so the humid tropics resist states.
- **Circumscription** (Carneiro; Allen). Exit cost = least-cost distance to farmable land outside the region. When pressure P/K → 1, conflicts arise. Losers are absorbed (taxed) rather than displaced with probability ∝ exit cost × P/K. A river corridor through desert maximises this.
- **War and polity dynamics:** Turchin et al. 2013 almost verbatim.
  - P_att = 1 + β·Σtraits
  - P_def adds +γ·elev (γ = 4)
  - win = (P_att − P_def)/(P_att + P_def)
  - ethnocide, trait mutation (μ₀₁ = 1e-4, μ₁₀ = 2e-3), disintegration δ₀ = 0.05 + δ_s·size − δ_a·traits
  - military technology seeded at pastoral/steppe frontiers

  Use their 4-neighbour logic on the fine grid, scaled to km.
- **Nucleation.** When conflict is high, the rural population moves into the nearest walled centre (Adams's Early Dynastic "emptying countryside"). That produces primate cities.

### 5.6 Resources and metallurgy from the tectonic record
| Resource | Orogen signal | Earth analogue |
|---|---|---|
| Copper (ophiolite / volcanogenic massive sulfide, VMS) | `SUTURE` flag + old oceanic slivers (`APRON`, docked `ARC` terranes) | Troodos, Oman ("Magan"), Ergani |
| Copper (porphyry / skarn), gold | `ANDEAN` / `ARC` belts, UPPER side | Iranian arc, Andes |
| Native copper | `LIP` flood basalts, `FAILED_RIFT` | Keweenaw |
| Tin | `HIMALAYAN` / `URAL` collision belts (S-type granites), rare and patchy | Cornwall, Erzgebirge, Afghanistan, Kestel |
| Obsidian | Young (< ~10 Myr) volcanics: `ARC`, rifts, hotspot `TRACK` on continents | Göllü Dağ, Melos, Ethiopian Rift |
| Flint / chert | Old sedimentary platforms, passive margins (`RIFT_MARGIN`), cratonic cover | Chalk of NW Europe |
| Bitumen, salt | Foreland basin (collision LOWER side); evaporites in terminal lakes / rifts / arid coasts | Hit on the Euphrates |
| Timber | Climate: tree share on rainy uplands | Lebanon cedars, Zagros oak |
| Building stone | Anything except alluvium / sand sea | (Mesopotamia had none) |

- **Tech gates.** Each is a diffusing trait that needs both the resource *in the network* and a prerequisite, so it spreads by contact, not by date:
  - copper working ← native copper + sedentism
  - smelting ← pottery kilns (sedentary farming + time); Earth ~5000 BCE
  - arsenical copper ← arc/skarn ores
  - tin bronze ← tin AND copper both in the trade network (~3300–3000 BCE)
- **Obsidian** is the first long-distance good, so it bootstraps networks early. Fall-off: share = 0.8 within a ~300 km supply zone, then ×e^(−(d−300)/λ) with λ ≈ 40–70 km (Renfrew).

### 5.7 Trade
- A least-cost graph over settlements, mixing land, river and sea edges.
- Gravity flows T_ij = k·M_i·M_j / C_ij^(1–2).
- **Demand** = elite population × materials *missing* locally (Algaze's asymmetry: the alluvium exports textiles and grain, imports metal, timber and stone).
- Water access multiplies market reach, which is the Sumerian advantage.
- High-demand, high-cost links spawn **trade colonies** upriver toward deposits (the Uruk expansion).
- **Seasonal sea edges:** monsoon direction by month comes straight from Orogen's monthly winds.
- **Pack animals:** donkey caravans at ~30 km/day with ~65–75 kg loads (Old Assyrian); camels only after ~1000 BCE.

## 6. The "Ur chain": what must happen, as checks

These are the acceptance tests. Each link is a measurable predicate on a run:

1. **Mesopotamia candidates exist.** The world has ≥ 1 region with an arid alluvial plain (BWh/BSh, aridity < 0.2) beside a `farFed` river with a FLOOD regime, discharge ≳ 500 m³/s, with circumscription exit cost above a threshold. *(Computable from Orogen data alone, before any sim. This should be Phase 0.)*
2. **A domestication centre arises in a high-W zone within ~300–1,000 km upstream or adjacent** (the hilly flanks), several kyr after the Holocene switch.
3. **Farming reaches the alluvium, irrigation switches on**, and density jumps ≥ 10× over rain-fed neighbours.
4. **Settlements on levees 15–30 km apart**, with the countryside nucleating into a primate city ≥ 10–40k people within ~2–4 kyr of irrigation (Uruk ~40–50k by 3000 BCE).
5. **≥ 3 administrative tiers** → state.
6. **Trade routes reach copper (suture/arc) and later tin through river + coastal sea legs.** Bronze appears there before rain-fed regions with the same climate but no water transport.
7. **Counterfactual:** the same climate without the far-fed river (rain-fed only) produces towns capped near ~100–120 ha and no early state.

**Earth test** (the real validation, like Orogen's Köppen score). Run on real Earth data (WorldClim + HydroSHEDS + ETOPO + a geology/deposits layer) from a ~60 ka start. Score:
- domestication centres vs the known ~10 (Fertile Crescent, Yangtze, Yellow River, New Guinea, Mesoamerica, Andes, eastern North America, Sahel, Ethiopia, India)
- first-farming dates vs the Pinhasi radiocarbon fronts
- first cities in Mesopotamia / Nile / Indus / Yellow River
- population against HYDE 3.2 (~4.5M at 10,000 BCE, ~45M at 3000 BCE)

Then tune within the literature ranges, exactly as `coupled-check.mjs --tune` tunes Orogen's climate within `PARAM_PRIORS`.

## 7. Phases

| # | Phase | Status |
|---|---|---|
| 0 | **Substrate, resources, cradle finder; the Earth test** | **Built.** Earth: Sumer #2, Egypt #5, the Indus #9 of 57 (the Oxus delta #1). See below |
| 1 | Forager dispersal (sea level, crossings, density over time) | next |
| 2 | Holocene: sedentism and domestication | |
| 3 | Farming spread, pastoralism, irrigation | |
| 4 | Settlements, hierarchy, polities, war | |
| 5 | Resources, trade and metallurgy | |
| 6 | Tuning against Earth (dates, places, HYDE population) | |
| 7 | The page: a civ tab on Evolution's finished moment, a timeline of the people | |

### Phase 0 results (2026-10-21)

**Earth** (`node --max-old-space-size=16000 tuning/civ/earth-check.mjs`, 640K cells; WorldClim 1970–2000, HydroRIVERS, MRDS):

| Known cradle | Rank |
|---|---|
| Oxus (BMAC) | #1 |
| Sumer / Susiana | #2 |
| Egypt | #5 |
| Indus | #9 |
| Norte Chico (Peru) | not found (its valleys are small: < 5,000 km², < 150 m³/s) |

The rest of the top 15 are real irrigation societies that stayed below statehood (the lower Colorado's Hohokam, the Helmand's Shahr-i Sokhta, the Draa) or places farming arrived late (Patagonia's Chubut, the Columbia, the Murray, the Orange). Telling those apart is the time-stepped sim's job (the domestication centre's distance and timing, the trade network), not the cradle finder's.

**Known gaps:**
- Earth's rivers have no regimes (HydroRIVERS has no monthly flows), so Earth gets no flood-season bonus.
- Alluvia are generous where flat desert surrounds a river (Egypt's region spreads into Sudan's plains).
- Phase 0 has no travel costs yet: distances are km over the mesh (wild cereals over land only; resources over land and sea alike), not Tobler/ORBIS costs.

## 7b. What the worldbuilding sources change (CIV_RESEARCH.md §C)

Adopted, each because the literature backs it:
- **Deltas aren't penalised.** Ur, Uruk and Eridu grew on levees in a deltaic marsh (Pournelle 2003; Algaze 2008), even though Madeline James's overlay avoids deltas. Levee-and-marsh mosaics score high for proto-cities; marsh foods count as aquatic resources.
- **Salt layer** (Artifexian WL48; Harding 2013):
  - coastal pans in dry climates, boiling elsewhere (needs fuel)
  - playas
  - brine springs and diapirs over old evaporites

  Salt towns are early trade nodes (Provadia-Solnitsata).
- **Fuel layer** (WL45–47). A tree line by growing-season temperature (Körner & Paulsen 2004), not latitude bands. Forest is charcoal; peat; dung and reed on treeless floodplains. Smelting output ∝ ore ∩ fuel. Fuel can be traded.
- **Metallurgy tiers** (WL45–46; Lechtman 1996; Thornton 2010):
  1. native copper on flood basalts, cold-hammered
  2. oxidised, enriched caps, best in semi-arid climates (Sillitoe 2005): the first smelting
  3. arsenical copper (widespread)
  4. tin bronze, with **placer tin downstream of collisional granites**. Tin is a long-distance good, and Near Eastern tin came from Central Asia.

  Before ~1000 BCE only rich ores (~10 % Cu) count.
- **Domesticates.** Animal availability comes from biome × megafauna extinction (Koch & Barnosky 2006: Africa 21 % … Australia 88 % lost). It gates the plough, the wheel and pastoralism, and with them the steppe-nomad "mirror empires" (Barfield 1989).
- **Crop gate.** Growing degree-days plus growing-season aridity (Worldbuilding Pasta's bioclimate; BIOME / GAEZ), beside the Köppen envelopes. Soil bonuses: loess, alluvium, andosols on young volcanics.
- **Foragers.** The diet mix (hunting / gathering / fishing) follows effective temperature (Binford; Marlowe 2005). **Upwelling coasts** give dense sedentary foragers (Moseley 1975: the Andean coast).
- **Farming adoption.** Foragers adopt farming when its returns beat their falling foraging returns (Winterhalder & Kennett 2006). Adoption brings a fertility bump at the Neolithic demographic transition (Bocquet-Appel 2011). Domestication takes millennia (Purugganan & Fuller 2009), not 10 generations.
- **Settlements.**
  - Size follows Zipf with primacy allowed, since early Mesopotamia was primate.
  - Footprint ∝ population^(2/3) (Ortman et al. 2014).
  - Mines work through a foothill river town, then boats.
- **Polities.**
  - Turchin 2013 plus per-cell solidarity ("asabiya") and Boulding's loss-of-strength gradient with distance from the capital. Fractal Philosophy's attempt warns of two failure modes: freezing at chokepoints and churning too fast.
  - Era caps on empire area for calibration (Taagepera: ≤ ~1M km² before 600 BCE).
- **Trade** by social distance: gift with kin, exchange further out, raiding strangers (Sahlins 1972). Monsoon reversal opens the first open-water routes.
- **Corrections:** grain need is ~250 kg/person/yr, not 1 t. Cities come after farming, not before (contra Jacobs).

### Phases 1–3 results (2026-10-21)

`v2/js/civ/sim.js` runs 70 ka → 0 BP in 25-yr steps (~17 s on Earth at 640k cells): one forager front from the origin
(travel.js: 0.35 km/yr inland, 4 along glacial coasts, 1 along big rivers, sea crossings ≤ 30 km before 60 ka and 100 km
after; it waits at the ice sheets until 15.5 ka and at cold country until a ladder by how cold: 45 ka → 20 ka), glacial
capacity blending to Holocene between 14.7 and 11.7 ka, shelves drowned as the sea rises; then settling (Binford's
packing plus wetland/coast/lake or rich stands), a rare onset of cultivation (hazard ∝ W⁶, crowding), cultivation when it
pays better (Winterhalder & Kennett), 2000 yr to domesticate, then each package's farming front (0.7 km/yr, 4 on coasts,
1.5 on rivers, slowed to 20 % where its climate fits badly); a desert's alluvium waits until the package has known
irrigation for 2500 yr, and its canals grow to full density over 3000 more.

Earth (`civ-sim.mjs --earth`):
- **Arrivals:** 6/10 within ±2 ka. Misses: the Levant is too early (65 ka), Japan and Tasmania are early (45 ka), and Alaska is far too early (34 ka; there's no Beringian standstill).
- **Centres:** Fertile Crescent 10.8 ka ✓ (the 2nd centre, after one in Burma at 10.9 ka), Ganges 9.9 ✓, Ethiopia 7.8 ✓. There are 20 centres in all, 15 far from known ones (California, Zambia, SE Brazil, …). Yangtze, Yellow River, New Guinea and Andes have none; Mesoamerica is late. Wild ranges on Earth are contingent, so these misses are expected from climate alone.
- **Farming arrives:** 6/7 within ±2 ka: Greece 10.4, Southern Mesopotamia 8.2, Egypt 7.9, Iberia 8.9, Britain 7.5, Scandinavia 5.7. Mehrgarh is never reached.
- **Population** vs HYDE 3.2: 10 ka 21 M (7), 8 ka 31 M (11.5), 6 ka 69 M (28), 4 ka 101 M (72). The excess is mostly foragers (~18 M of Holocene capacity).

Holocene seafaring (crossings 100 km → 900 km at 3.2 ka → 2000 km at 1 ka, 10 km/yr at sea; fronts wait at the shore
until the crossing opens): Fiji 3.2 ka ✓, Madagascar 3.1 ✓ (a little early), New Zealand 2.9 ✗ (0.8–0.7 in the record) —
arrivals 8/13.

Generated world 12345 (time 300), the origin the richest savanna of the biggest landmass (glacial bridges joining it):
the main continent filled by ~30 ka, seven centres between 10.6 and 3.9 ka, farmers over much of it by 0 BP; the other
continents reached by sea after ~3 ka, their coasts first.

### The People layer (2026-10-21)

Evolution's layer bar has a **People** tab, which works on a detailed moment. Each finish also sends back the moment's world for
the civ layer: a 160K-cell resample, ~0.3 s and ~5 MB more per finish. Choosing People runs the sim in
`v2/js/civ/civ-worker.js` (~3 s). The result is 141 frames, one every 500 years, at one byte per cell (~22 MB). A slider and
play button scrub from 70 ka to now. The layer paints foragers in cool colours and farmers in warm ones, with ringed
centres, a legend with totals, and a hover readout. Results at 160K vs 640K on Earth are close: 75 vs 69 M people at 6 ka,
with similar scores.

Settlements are their own overlay, as of 2026-10-22. A **● Settlements** toggle puts the towns and centres on any layer
except Plates (Terrain, Satellite, Climate, Heightmap); it is always on in People. The choice is kept in localStorage. Town
dots are sized by log population. Hovering anywhere shows the place's people, how long they have been there, its way of
life and its nearest town. Clicking a town opens a card with:
- what feeds it;
- the people around it;
- its polity (independent, a capital, or ruled from somewhere and how far away);
- how long a town has stood there;
- its land's rain and flood variability and its fever burden.

The card follows that spot as the year slider moves, which shows a town's rise and fall. Per frame the sim also sends a
small polity table (`Polities.packedPolities`) so the card can name a town's polity.

The "oversized rain-fed towns" turned out to be a labelling problem. On world 626225 at 480 Myr, 263 towns of 2,500+ stood on
rain-fed districts, and the biggest had 22k people. Of those 263:
- 8, from 8.7k to 22k, are fed by irrigated land. More than half their grain comes from irrigated districts nearby, or
  ships 100–200 km along a coast or river. Such a town is a canal economy's port or edge-town; its own ~60 km cell is
  simply not irrigated. Towns now carry `canalFed`, with `TownFlag.CANAL_FED` set when its own district is not irrigated,
  and the card says so.
- The other 255 are truly rain-fed. 247 are under 5k and the biggest is 10.6k, in line with Wilkinson's few thousand
  (and Tell Leilan/Brak's later peaks).

The run goes on past now, as of 2026-10-22. `createCivSim` keeps the sim alive (`runCivSim` wraps it; advancing in
chunks gives the same run as one call), and the People worker keeps the latest two runs. The people bar has two buttons:
- **+25 yr** lives one more generation;
- **Run on** keeps adding generations, ~13 a second at 160K cells, with the slider following the newest year unless it
  has been scrubbed back.

Past now a frame is kept every generation, and years read "N years after now". The world's climate and sea level stay as
they are now.

### Phase 4, first slice: towns and states (2026-10-21)

`v2/js/civ/settle.js` works on any moment of the sim:
- **Town size:** each farmed district's town is fed by its own fields (5 km, half farmed, at the yield its density shows, so it
  grows with the canals). It also gets the surplus of districts it reaches: 40 land-km, a navigable river's km costing ¼
  and a coast's ⅛. The biggest claim first, so a primate city takes its rivals' surplus.
- **Who moves in:** a share of each district's people, 20 % rain-fed rising to 60 % as irrigation intensifies (Adams's
  emptied countryside).
- **Tiers:** 150, 500, 2500 and 15000 people (Kosse, then ×6).
- **Polities:** a town falls under the nearest bigger one within 60 land-km. A polity with all three tiers above the
  village is a state (Wright & Johnson). (Replaced by war and collapse: see the next section.)

Earth (`civ-sim.mjs --earth`):

| Region | 7 ka | 6 ka | 5 ka | Record |
|---|---|---|---|---|
| Near Uruk | 10k | 19k, a state | 22k, a state | a city ~5.5 ka, ~40k by 5 ka |
| Near Memphis | 10k | 22k, a state | 32k | |
| Indus | 16k, a state | | | 2 ka too early: the spurious Ganges centre gives it irrigation by 7.4 ka |
| Erlitou | under 1k | | | rain-fed millet: a miss |

- Rain-fed towns stay under ~3–5k everywhere: Wilkinson's cap, Ur chain link 7 ✓.
- States worldwide: 1 at 7 ka, 29 at 6 ka, 79 at 5 ka. That is high; every big desert river grows them.

The People layer draws the towns of 2500+ for each frame from 12 ka on as dots, with state towns in gold and capitals
ringed. The legend counts them and the readout names the nearest town.

### Phase 4, second slice: polities by war and collapse (2026-10-21)

`v2/js/civ/polity.js` keeps polities from century to century over each century's towns. Sources for every rule are in
`CIV_SOURCES.md` §Polities.
- **Founding:** a town new to its place joins the bigger town whose supply reach it grew in. Otherwise it is a polity of its own.
- **War:** neighbouring polities fight, more often the fuller their land (Carneiro).
  - The odds are Turchin et al. 2013's (P_a − P_d)/(P_a + P_d).
  - Power grows with people and fades with distance from the capital (Boulding). The defender gains with height.
  - Each side's power is multiplied by its fortune, so that equals can beat each other.
- **Absorption:** a beaten town is absorbed only where its people cannot leave for free farmland: Carneiro's circumscription,
  as an exit cost. A beaten capital brings its whole polity.
- **Collapse:** more likely the more towns a polity holds.

Earth, 5 ka:
- 30 states (15 at 5.5 ka).
- Near Uruk: about 85 polities among 126 towns, of which 2–3 city-states with 7–11 towns each. That is an Early
  Dynastic-like patchwork.
- Susa (Khuzestan), the Egyptian delta, the Nile valley and Merv also hold states.

The false ones:
- the Indus, ~1.5 ka early (its canals come as early as Sumer's);
- the Jubba, the Senegal and the Upper Nile;
- California's Central Valley.

These are substrate and farming-spread problems.
- Irrigation now needs 6+ months above 10 °C, full at 8. This dropped the Volga and Ural deltas, which led the world at 5.5 ka under [4, 7].
- State membership flickers century to century (wars and collapses), so single-run spot checks are noisy.

### Good and bad years, famine and disease (2026-10-22)

Variability comes from the planet's own climate model, not noise on the yields (`climate-var.js`):
- **Ensemble:** the climate is re-run under ±1 σ of two forcings, a hemispheric contrast (the rain belt follows the warmer
  hemisphere) and a land–sea contrast (the monsoons). That's a small, default-off forcing hook in `climate/temperature.js`.
- **Each cell's response** to each swing is its share of the year-to-year rain.
- **Storms** add a dry place's chanciness (Conrad's curve).
- **Rivers:** each run's runoff is routed down the land, so a river's flood answers its catchment's rain.
- **What's random:** only the timing (a red-noise series of the swings).
- **Earth, untuned:** rain CVs match observed ones (Sahel 0.25, India 0.19, Baghdad 0.37, the loess 0.20); rivers are within
  about ±0.1 (the Nile a little steady). No ENSO, so the Andes are too steady.

Famine (`sim.js`):
- The settled live year by year: harvests by the substrate's own curves, against their long-run means, with a store of a
  year (half for settled foragers). The shortfall beyond the store kills.
- Famine falls on marginal dry farming (the Levant, Greece) and the erratic Tigris–Euphrates at ~0.4–0.7 %/yr. The Nile
  is far gentler.
- Polities answer famine shocks (beyond each place's norm) with more war and collapse.

Disease (`disease.js`):
- **Vector fever:** Craig et al.'s malaria climate suitability, from each cell's twelve months; standing water (wetlands,
  canals) breeds it in deserts.
- **Snail fever** on warm irrigated land.
- **The cold filter:** the parasites spread with people only through warm country and short crossings, so on Earth the
  Americas have none (Beringia filtered them out), while New Guinea is reached.

Earth with all three:
- 3 states at 5.5 ka (Akkad/Kish, the Indus, the Egyptian delta), 5 at 5 ka (adding Susiana, the Jubba, the Senegal).
- Disease removed the tropical false states (Burma, the Gezira, Nubia).
- The Ganges and Mesoamerican centres are lost (both were off-record anyway).
- Page: People ~18 s (was ~6), the ensemble's five runs in parallel workers.

### Who spreads first: the origin and voyaging (2026-10-22)

On world 626225, foragers and farmers seemed to spread together. Two rules caused it:
- **The origin.** It was the biggest landmass's richest savanna. Here the biggest landmass is a boreal one, with no savanna
  at all.
- **Seafaring by date.** It opened 900 km crossings at 3.2 ka on every world. The other four landmasses are 1,250 km of open
  ocean away, so they were all reached at ~2 ka, foragers and farmers together.

Changes:
- **Origin.** People now arise on the landmass with the most tropical savanna.
- **Voyaging.** It belongs to farmers. A package's crossings grow with the years since its farmers first farmed a coast,
  and voyagers land only on empty land (sources: CIV_SOURCES.md, dispersal). Foragers never cross more than 100 km.

Results:
- **Earth:** arrivals 9/13, up from 8/13.
- **World 12345:** its two other big continents (58M and 22M km²), which foragers cannot reach, are found by its farmers'
  voyagers ~1 ka. Their first people are farmers, as on Madagascar and New Zealand.
- **World 626225:** with only the origin and voyaging changes, it was a dead end. People arise on a tropical continent of
  23.8M km² whose best wild stands are middling (tubers W ≤ 0.78). The W⁶ odds give about one expected onset over the
  Holocene, and that run drew none.

Two follow-ups, the same day:
- **Domestication eases with time settled.** The odds' exponent falls from 6 to 3 over a cell's first 3000 years settled
  and packed (Cohen's population pressure). Earth's later centres sat on middling stands (our W is 0.5–0.8 at Yellow River,
  Mesoamerica, Andes and New Guinea).
  - Earth: 4/10 known centres within 800 km, up from 2. But 24 centres in all, 20 of them away from known ones (was 11 of
    14). 43M farmers at 6 ka (HYDE ~28M people in all).
  - World 626225: tubers domesticated at 9.3 ka, a quarter of the continent farmed by 7 ka. Its voyagers reach the 28M km²
    cereal continent ~0.5 ka.
- **Voyagers carry the crops known on coasts.** Each package used to sail alone, so wheat and millet farmers landed first on
  the tropical Pacific and lived there as foragers. Now one front carries every crop farmed on a coast by each landing's
  time. Earth: Fiji, Samoa, Tahiti, North Island NZ and Madagascar farmed with tubers; South Island NZ foragers; arrivals
  8/13. The early cities are unchanged.

## 8. Next

0. The resources-and-skills model (§9): first its ensemble runner, then the resource map, then the economy.
1. Tighten the alluvium: broad-plain irrigation spreads too far on flat desert (one generated world's top cradle is 2.9M km²; Earth's Nile region ~560k km² vs a real valley and delta of ~35k).
2. Earth: monthly river regimes (from WorldClim's monthly runoff routed down HydroRIVERS), so the Nile's flood counts.
3. Forager capacity ~2–3× HYDE; a Beringian standstill; Japan/Tasmania crossings by sea level at the time.
4. A river network for the civ layer. Rebuild the reaches' order and junctions from the finish's river output
   (start/cell, which `civWorldFromFinish` drops today) and HydroRIVERS' NEXT_DOWN (dropped by the Earth loader). Uses:
   - upstream/downstream travel costs (ORBIS);
   - basins as units (the upstream–downstream water conflict of Lagash and Umma);
   - flood routing on the world's own rivers, in place of climate-var.js's coarse drainage.
5. Long climate change from orbital forcing: the end of the African Humid Period ~5.5 ka pushed people into the Nile
   valley (Kuper & Kröpelin 2006). It needs eccentricity and precession in climate/insolation.js.
6. Phase 4, next: rain-fed intensification (loess, the Yellow River; Erlitou is still a miss); the Indus too early (flood-
   recession farming, not canals?); polities feeding back on people (war deaths, a state's canals); a states count averaged
   over seeds — then trade along settle.js's costs and metallurgy.

## 9. Next model: resources and skills (design, 2026-10-22; revised after review the same day)

The model has outgrown its switches. Today a cell's people are in one of six states: empty, foragers, settled foragers,
cultivators, farmers, irrigators. Fixed rules move them between states:
- Binford's packing threshold starts settling;
- a W⁶ dice roll starts cultivation;
- three crop packages, each a list of Köppen zones, spread as fronts;
- a special rule lets farmers voyage.

Each fix in this file has patched a seam between two of those switches.

This design replaces the switches with an economy. Each place has resources, and its people know how to use them. Work
goes where it returns the most. Know-how grows with use and fades without it. Crops and herds, once domesticated, are
things carried, like seed and stock. Foragers, farmers, herders and irrigators become labels read off what people eat.

### 9.1 Principles

- **Diet by return.** Resources are ranked by their return per hour of work. A lower-ranked one enters the diet as the
  higher-ranked ones grow scarcer: the diet-breadth model (MacArthur & Pianka 1966; Kelly 2013, ch. 3). Flannery's (1969)
  "broad spectrum revolution" is this model under crowding (Cohen 1977, population pressure).
- **Know-how by use.** Using a resource raises the skill to use it.
- **Domestication belongs to the organism.** Cultivating a plant or keeping an animal changes the plant or animal; that is
  Rindos's (1984) co-evolution. It takes ~2000 years of cultivation (Purugganan & Fuller 2009; Fuller 2007). So a
  domesticated crop is a property of the crop's population, not of the people. It travels as seed and stock, and is lost
  only after long disuse.
- **Starting is rare.** Planting begins as a rare event, likeliest at the best wild stands among crowded, settled people.
  Today's W⁶ hazard with its easing is moved into the new model, not removed. Use and learning set only the ~2000 years
  after onset. Without this, every crowded place domesticates within two thousand years of the Holocene.
- **Complex know-how needs people.** Farming, herding and boats are skills a group holds only with enough people to hold
  them. This is adapted from Henrich (2004), whose model uses a threshold population; our formula is ours, and the claim
  is disputed (Vaesen et al. 2016). Foraging skills have a floor and don't decay away.

### 9.2 Resources: what the land offers (the resource map)

Each cell gets, for each resource r, a capacity K_r: people per km² of country that r feeds at full skill, using all the
land suited to it. The set:

| Resource | Class | Capacity from |
|---|---|---|
| large game | wild | NPP and openness (grassland, tundra), the forager regression's terrestrial share (Binford 2001) |
| small game, fowl | wild | NPP |
| fish, shellfish, sea mammals | wild | coast, lake, big river; the existing aquatic terms |
| wild grass seeds | wild | large-seeded annual grasses: seasonal drought with a cool wet season (Blumler 1992, a dissertation; by way of Diamond 1997) |
| wild roots, tubers | wild | seasonal tropics and their highlands |
| nuts, fruit | wild | temperate and tropical forest |
| winter cereals | crop | agro-climatic yield from monthly T and P, FAO's 1978 AEZ method; GAEZ v4's low-input yields (Fischer et al. 2021) to check. Wild form: wild grass seeds. |
| summer cereals | crop | same, warm wet season. Wild form: wild grass seeds. |
| roots and tubers | crop | same, long humid season. Wild form: wild roots. |
| tree crops (banana, breadfruit, coconut) | crop | humid tropics. Wild form: nuts and fruit. |
| flooded fields (rice, taro) | crop | warm alluvium or wet ground with water to hold. Wild form: wild grass seeds, wild roots. |
| herds (sheep, goats, cattle) | herd | grazing from grass NPP. Wild form: wild sheep, goats and aurochs in uplands and steppe. Herding begins through its own rare onset where wild herd animals are hunted under pressure (Zeder's prey pathway; Zeder 2012), or comes by contact. Heavy hunting alone doesn't train it. |

- **Land budget.** Fields and pasture take land from wild stands and game, so capacities don't stack. A cell's land is
  shared out: fields (crop share), pasture (herd share), the rest wild. Wild capacity falls with the share taken.
  Flooded fields and canals both draw on `irrigShare`; they share it.
- **Irrigation** stays as now: canals multiply a cereal's capacity on irrigable alluvium (§5, Phase 4). Knowing canals
  becomes a skill of its own, in place of today's per-package `irrigKnown`.
- **Crop capacity** follows the AEZ logic. From the months:
  - the length of the growing period, the months where P ≥ ½ PET and T is above the crop's base;
  - the crop's temperature profile;
  - frost and heat limits (Ecocrop's).
- **Wild capacities** come from the forager regression, split by biome. A regression check in stage B makes sure their
  sum reproduces today's `sub.forager`.
- **Good and bad years** stay as now, grouped into five response classes:
  - rain-fed (crops and wild plants, by the rain);
  - river (flooded and irrigated fields, by the flood);
  - wild game (by NPP);
  - water foods (steady);
  - herds (drought die-off, with a slower recovery).

### 9.3 People: know-how, crops and allocation

**State per cell:**
- skill s_r ∈ [0, 1] for each resource: know-how, which mixes and fades;
- domestication D_c ∈ [0, 1] for each crop and herd: how far the organism is domesticated; it travels as seed and stock;
- each crop's climate adaptation: the Köppen zone or months it is adapted to (below).

**Quantities each generation, with N the cell's people (per km²):**
- x_r: people fed by r;
- φ_r = x_r / K_r: how much of r is used up (depletion);
- w_r = x_r / N: r's share of the diet.

**Return.** ρ_r = ρ⁰_r · g(s_r) · (1 − δ φ_r), where ρ⁰_r is r's base return per hour. Kelly's ethnographic return rates
give the ordering only: large game highest, seeds lowest. They are post-encounter rates, so they can't give absolute
values. For a crop, the capacity is its wild form's until D_c ≥ D_dom, and then the crop's own capacity where it grows.

**Allocation: equal marginal return.** Work is spread so that every resource in use returns the same at the margin, the
"water-filling" solution with one cut-off return, O(R log R) per cell. Low-ranked resources then enter as the high ones
are depleted, as the diet-breadth model says.

**Learning.** s_r += α_r · w_r · (1 − s_r). Crops: D_c += α_D · w_c, so domestication follows use of the cultivated form
over ~2000 years.

**Forgetting.**
- Skill fades, s_r −= β s_r, when unused.
- Complex skills (crops, herds, canals, boats) are capped at S(N_local), with N_local the people within a contact radius.
- Wild skills keep a floor s_wild.
- D_c falls only after long disuse: the crop's seed stock is lost.

**Contact and migration.**
- Skills move toward neighbours' skills, weighted by people and travel cost (settle.js's costs).
- Crops and herds take the neighbours' maximum D_c: seed is given, not averaged.
- Migrants carry both. This needs `frontArrival` to record each cell's source cell.

**Onset.** A rare hashed hazard, as today's (W^k × crowding, k easing from 6 to 3 with years settled). It starts
cultivating a crop's wild form: its first use, at s_seed. A centre is a cell whose D_c crosses D_dom without having
received the crop. `clusterCentres` and the Earth centre checks read that event.

**Hunger.** Defined at the generation scale as packing pressure N / K (Binford's packing). It raises the onset hazard
and lets a known, low-ranked resource enter at a poor return. It is not the yearly store, which would be circular:
today's famine loop runs only for settled cells, and "settled" is now read off the diet.

**Crops keep their climate.** A crop is adapted to the climate where it was domesticated; today's Köppen `fit` serves.
Its capacity elsewhere falls with the mismatch (today's `farmClimateFloor`), and its adaptation shifts slowly where it
is farmed. This keeps the east–west axis effect: wheat doesn't jump latitudes by contact.

**Capacity and growth.** K = Σ_r x_r, within the land budget, less disease. People grow toward K logistically. The
growth rate rises with the share of stored, sedentary food, a stand-in for the Neolithic demographic transition
(Bocquet-Appel 2011).

**Labels** are read off the diet, by a fixed mapping onto `Life` (adding HERDER):
- foragers: wild > ½;
- settled foragers: wild > ½, and dense, storable foods (aquatic, nuts, wild seeds) with N above packing;
- farmers: crops > ½;
- irrigators: farmers on canals;
- herders: herds > ½;
- mixed diets go to their largest class.

### 9.4 Movement

- **Where people go** stays `frontArrival`:
  - the Pleistocene forager front;
  - in the Holocene, a front per crop, seeded at each centre as today.
  - Skills and crops ride with the movers (via the source-cell record) and spread by contact.
- **Reaction–diffusion is deferred.** The review showed that coast and river diffusion (D ≈ 150–1000 km²/yr) makes an
  explicit step unstable at 160K–640K cells. Its lattice speed also changes with resolution (cells of ~56 km against a
  front of √(D/r) ≈ 16 km). It may come later (stage C2) with sub-stepping, a density cutoff, and Fort's time-delayed
  speed v = 2√(rD)/(1 + rT/2). If it does, farmers entering occupied land is a competition (Aoki, Shida & Shigesada
  1996), not plain Fisher.
- **Farming spreads by contact as well as by migration** where foragers adopt: Fort's (2012, PNAS) demic–cultural mix,
  about 60 % demic in Europe.
- **Voyaging** keeps today's rule, but voyagers carry their launch cells' skills and crops. The Lapita kit needs no
  special case.

### 9.5 What it replaces, what stays, and what must adapt

- **Replaces:**
  - the settled, cultivating, farmer and irrigator switches;
  - PACKAGES as Köppen lists, which become crops with an adapted climate;
  - per-package `irrigKnown`;
  - the farmers-only voyaging special case.
- **Moves, not removed:** the onset hazard.
- **Stays:**
  - the Pleistocene front and glacial climate;
  - famine, disease and climate variability;
  - towns and polities;
  - canals.
- **Must adapt (a compatibility layer, built before the economy):**
  - `polity.step` and settle.js's `towns` read `Life` (the "< FARMER" free-land test) and `Kc = farmK`. They will get
    the label mapping and K from crops and herds.
  - Frames carry `life` and `farmPkg` for the UI. They will carry the label and the dominant crop.
  - Voyaging's `coastT` and `firstCoast` will be read per crop.
  - When the sea floods a shelf, its people already move to `home[c]`; their skills and crops must move with them.
  - `liveYears` needs a herd response class.
- The old model stays behind an option (`runCivSim(…, { economy: 'switches' })`) until the new one does better on the
  checks below.

### 9.6 Checks

- **Earth:** today's scores (arrivals, centres, farming arrivals, early cities). New checks:
  - herders on the Eurasian steppe and in the Sahel after ~6 ka, before farmers there;
  - Australia stays foragers;
  - New Guinea's highlands farm roots;
  - the Pacific farmed with roots and trees;
  - population within ~1.5× HYDE.
- **Ensemble (stage A).** Target ranges, set once the baseline is in:
  - most worlds farm;
  - some, but not all, form states by 3 ka;
  - first cities spread over thousands of years, not all at once;
  - a few worlds stay forager worlds.
- **Bench (stage A′).** A test strip at 160K and 640K checking:
  - the farming front's speed (~0.6–1.3 km/yr, Pinhasi et al. 2005);
  - the time from onset to domestication (~2000 yr);
  - the onset's rarity (a few centres per continent);
  - that the summed wild capacities match `sub.forager`.

### 9.7 Stages

- **A. Ensemble runner** (`v2/tools/civ-ensemble.mjs`, built 2026-10-22). It builds worlds as the page does, caches
  them, prints per-world and summary numbers, and compares two runs (`--compare`). `--set` overrides config values.
- **A′. Bench:** the test strip above. Built 2026-10-22 (`v2/tools/civ-bench.mjs`): a 39 M km² strip, 25–50° N, a
  winter-rain climate everywhere. The current model, at 160K / 640K cells:
  - the inland farming front 1.06 / 0.92 km/yr (record 0.6–1.3), 1.7–1.8 with the coastal route;
  - onset to domestication exactly 2000 yr (the rule, as built);
  - 30 / 36 onset cells and 5.4 / 7.2 centres per 10 M km² of ideal land. Earth has ~1 centre per 10 M km² of all land,
    and one on the Fertile Crescent's ~2 M km²: where all land is ideal, onsets are too common. That is C1's to fix;
  - across a 4× change of detail: the front ×0.87 inland, onsets per area ×1.18, centres ×1.33 (fewer merge into one
    at a fixed `centreKm`);
  - the wild resources sum to the forager density to 1e-9.
- **B. Resource map** (`substrate.js`): AEZ crop capacities from the months (the finish keeps T12 and P12 for
  vectorCollector; keep a monthly summary too), herds, and the split wild capacities. Shown as a layer, and checked on
  Earth against GAEZ by correlation. The regression check on `sub.forager` goes here too.
  Built 2026-10-22:
  - `crops.js`: five crop classes' suitability from the twelve months (temperature trapezoids, AEZ's growing period
    with a 100 mm soil store, the season's rain), collected in the finish and the Earth world like the disease climate.
    Against GAEZ v4's low-input rain-fed yields on Earth (`tuning/civ/crop-check.mjs`): Pearson 0.50–0.74, Spearman
    0.63–0.85 per class. GAEZ also counts soils; ours leaves those to the substrate (leached tropics, loess).
  - `substrate.js` `food`: twelve resources in persons/km² (the wild of the country; crops of their fields; herds of the
    country), `canalFood` for watered cereals, `open`, `wildHerd`. Herds come out at 1.5–4.5 /km² in Earth's drylands.
  - The map: the People layer's Show picker (each resource, all wild food, the best crop), with a readout line.
  - The old model reads none of it: the 20-world ensemble is unchanged.
  - Not yet: the land budget (C1 shares the land out), and the wild split's ratios are round figures to tune in C1.

- **C0. Compatibility layer:** labels → `Life`, the dominant crop, the source-cell record in `frontArrival`, herd famine.
  Built 2026-10-23:
  - `life.js`: `Life` with HERDER (appended, so the old values keep their numbers), the predicates `farms` and `settled`,
    and `lifeOfDiet`, §9.3's labels (the largest diet class). Towns and polities test `farms`, not "≥ FARMER": herders
    feed no towns, and their land counts as free farmland.
  - Frames carry `crop`, the dominant crop as a FOODS index (packages now name theirs: tubers are `roots`). The page
    sends two bytes per cell and frame: density, and way of life with crop. The People layer shows herders in earth
    tones and the readout says "farmers of summer cereals".
  - `frontArrival(…, from)` records each cell's source. The run returns `cameFrom` (who its people came from: across
    water, the last peopled cell; a landing's launch; the shelf the sea drove them off) and `farmFrom` per crop (a centre
    or a landing starts a crop's front). Checked: every peopled cell has a source, and every farmed cell traces back to
    a root.
  - `coastBP` per crop: when voyagers took it up.
  - `liveYears` has the herd class (`herdYear`): drought kills the animals the grazing can't carry; the herd regrows over
    ~5 years. A half year's grazing kills 40 %.
  - The old model is unchanged: three worlds' runs are byte-identical (frames, towns, polities, arrival and farming
    dates; `v2/tools/civ-fingerprint.mjs`), the 20-world ensemble matches base in every number, and the bench is identical
    (its runs took ~3 s longer, within what timings vary).
- **C1. The economy on today's movement,** behind the option. Compare on Earth, the ensemble and the bench.
  Built 2026-10-23 (`econ.js`; `sim.js` with `economy: 'resources'`; the page with `?economy=resources`):
  - Each peopled cell's diet by equal marginal return over the wild resources and the domesticates it has; its way of
    life is the largest diet class. Crops and herds take land from the wild (fields 1 % at full use; settled herds 5 %).
  - Domestication by use (D 0 → 1 in ~2000 yr); herds go on to milk (D 2). Cultivation spreads within the wild range at a
    quarter of a farming front's speed; the domesticated crop has its own front. Skills are learnt, fade and are capped
    by the people within 50 km.
  - Herding: wild herds are managed over their range; domestic ones are bound to the farm. Mobile pastoralism only where
    the rain's CV reaches 0.33, or no crop grows (Ellis & Swift 1988).
  - Onset: one hazard per settled cell, at the wild form it lacks, by how good the stands are and how hard they are
    already used (the broad spectrum; Winterhalder & Kennett 2006). No crowding term.
  - Bench (160K): the inland front 1.5 km/yr (record 0.6–1.3), onset to domestication 2025 yr, 18 regions on the
    strip. Regions per 10 M km² of ideal land (a crop's wild form ≥ 0.5): the strip 88, Earth's record 6.5. The strip's
    wild cereals sit mostly at 0.3–0.5, so this measure turns on the threshold; Earth's own count is the better check.
  - Earth (two draws, `chanceSeed` 0 and 1): the Fertile Crescent first in both (10.7–10.8 ka); 2 and 5 of 10 centres
    within ±2 ka; 32 regions (the record's 10, ~24 with the minor ones); farming arrives on time in 3 of 7 places
    (Britain, Iberia and Scandinavia too early); people 38–56 M at 8 ka (HYDE ~5–10 M), 150 M at 2 ka (HYDE ~188 M).
    The old model: 18 M at 12 ka, 77 M at 2 ka. One draw is one sample: compare settings on several seeds.
  - Ensemble (20 worlds): farming on all, towns of 15 K+ and states on 19; the first centre 10.8 ka (base 10.9), the
    first city 6.0 ka (6.5), the first state 5.5 ka (6.0); 41 centres (19); 151 M people now (100 M).
  - The old model is unchanged: three worlds' fingerprints are byte-identical.
  - Open: too many centres still (~3× the record's); the early population 4–8× HYDE; California's wild cereals (the
    climate fits, the grasses were never there); the front ~20 % fast inland.
  - The page: the People layer's "Land in use" shows each place's fields and pasture (the economy only).
- **C2 (optional). Reaction–diffusion movement,** if C1's fronts are the weak point.
- **D. The switches retired** (2026-10-23, at Jackson's word): the economy is the only model. Gone: the `economy`
  option and the page's `?economy=`; the switches' onset, cultivation, farming fronts and farm capacity; `forageDecline`,
  `cultivatedYield`, `onsetCrowding`. Before 13 ka the run is the foragers' alone, as before. The economy's runs are
  byte-identical across the change (three worlds' fingerprints), which are now the baseline.

### 9.8 Parameters, and what pins them

About 15 new dynamic parameters and ~40 in the resource map.

| Parameter | Pinned by |
|---|---|
| AEZ and Ecocrop thermal limits | the literature |
| growth rate r | the literature |
| time to domesticate | the literature (~2000 yr) |
| α_D | derived from the time to domesticate |
| s_seed | fixed |
| D_dom | fixed |
| N₀, ρ⁰ ordering | loose |
| contact weight, β, δ, onset rate, hunger trigger | tuned on Earth, checked on the ensemble |

Each gets a ledger row when it enters the code.

**Cost.** The economy runs only in the Holocene (~470 of 2800 steps) and only on peopled cells. Estimate: ~1 minute
more per world at 160K, ~4× at 640K. Memory: ~8 MB per array set at 160K, ~31 MB at 640K.

## 10. Travel and trade (design, 2026-10-23)

Travel cost decides where farming spreads first, where a town can draw its grain, which towns grow, and how far a polity
reaches. Today it is fixed: so many km/yr per kind of edge for the fronts, and for towns 40 km of land, a river's km at a
quarter and a coast's at an eighth. Voyaging is a reach in km by era. None of it knows the wind, the current, the season
or the tracks people wear.

The plan: one travel graph, in days, by month. Fronts, voyages, towns, trade and polities all read it. Trade is flows
over it, and the flows wear paths that make it cheaper.

### 10.1 One travel graph, in days, by month

- Every edge of the mesh (land, river, coast, open sea) has a cost in days for a loaded traveller, for each month.
  Costs are directional: a→b is not b→a (downstream, downwind).
- **Land.** Walking ~25–30 km a day on the flat, by Tobler's function on slope. Pack animals once they exist (the donkey
  ~6 ka in NE Africa; the camel later; Bulliet 1975). Frozen or flooded months are closed or slow.
- **Rivers.** Downstream at the current plus paddling; upstream by towing, slower. Navigable above a discharge, as now.
- **Sea.** A boat's speed from the wind's angle to its heading (a polar), plus the current as a vector. A paddled craft
  barely feels the wind; a sail runs fast downwind and slow, or not at all, into it. Its days at sea are limited (water,
  food), so a crossing must fit a season's winds.
- **Craft by era.** Paddle and raft first; the sail (the Gulf ~7 ka, the Nile ~5.5 ka); the Austronesian outrigger sail
  (~3.5 ka). Boat-building spreads like a skill (§9.3), with the people who have it.
- **Winds and currents come from the planet's own climate.** The finish keeps the winds (the year, January, July). It
  must also keep the monthly winds, and the ocean stage's currents (annual and monthly), on the civ world.
- **Size.** 12 months × ~6 edges a cell × 4 bytes: ~46 MB at 160K cells, ~185 MB at 640K. At 640K: half precision, or
  four seasons in place of twelve months.

### 10.2 Voyaging on the winds

- The sea graph replaces `voyageKm` and `voyageSeaKmYr`. A landing is any coast reachable within the craft's days at sea,
  in a month whose winds allow it. Voyagers sail when the winds serve, and return when they turn.
- Upwind exploration falls out of it: sailing into the prevailing wind is slow but the way home is fast and safe, so
  early voyagers go upwind first (Irwin 1992).
- Drift carries unintended landings (Avis, Montenegro & Weaver 2007).

### 10.3 Paths and roads

- Each edge carries wear. Trips add to it; it fades slowly when unused (Helbing, Keltsch & Molnár 1997: trails as the
  walkers' own record). Its cost falls with wear, from open country to a path's.
- States can build roads: a share of their surplus into their busiest edges. Later.
- Trips come from the trade flows (10.4), and from movers along the fronts.
- Effect: traffic concentrates on a few routes. Towns grow at junctions, fords, passes and portages.

### 10.4 Trade: flows between places

- Flows by spatial interaction: S_ij = O_i · W_j^α · exp(−β c_ij) / Σ_k W_k^α · exp(−β c_ik), with c the travel days
  (Wilson 1971).
- Towns grow toward what flows to them: dW_j/dt = ε (D_j − κ W_j) (Harris & Wilson 1978). In archaeology this gives the
  Greek poleis' hierarchy (Rihll & Wilson 1987) and Crete's (Bevan & Wilson 2013). For the economy, it replaces
  `settle.js`'s "biggest claim first".
- Goods, in order:
  1. Grain: the towns' food. It replaces the 40 km import reach.
  2. Materials missing where they are wanted: stone, obsidian, copper, tin, timber (§5.6 deposits). Demand is the elite's
     want for what the land lacks (Algaze 2008: the alluvium sells grain and cloth, and buys metal, timber and stone).
- The Aegean's maritime network is the model for the sea's part (Knappett, Evans & Rivers 2008).

### 10.5 What it changes

- **Fronts.** Each edge's speed from its days (coasts and rivers fast as now, the sea by its winds).
- **Towns.** Their food's reach in days, and their sizes from the flows.
- **Polities.** Their reach in days (`polity.js` uses the same network).
- **Earth.** Earth needs winds and currents too. Either run Orogen's climate on Earth's relief (as the climate checks
  do), or use observed climatologies (ERA5 winds, OSCAR currents). The first tests the planet's own physics; the second
  tests the travel rules alone.

### 10.6 Checks

- **Roman travel times by month** against ORBIS (Scheidel 2014): e.g. Rome–Alexandria by sea in summer and winter, within
  ~30 %.
- **Old Assyrian caravans:** Assur to Kanesh in ~6 weeks (Veenhof 1972). The distance elasticity of trade, ~2
  (Barjamovic et al. 2019).
- **The Pacific:** the order and dates of Remote Oceania's settlement (Montenegro, Callaghan & Fitzpatrick 2016).
- **The Indian Ocean:** the monsoon's sailing seasons.
- **Towns:** the rank-size slope (~1) and spacing; the river, coast and inland shares.
- **The Ur chain, link 6:** trade reaches copper along rivers and coasts first.

### 10.7 Stages

- **T0. The travel graph.** Monthly winds and currents kept on the civ world; edge days by month; a map view of travel
  time from a clicked place (isochrones), by month. Nothing else reads it yet (the fingerprints stay).

  **Done (2026-10-23).** `routes.js` (`travelGraph`, `travelDays`); the finish keeps its monthly winds and currents on
  the civ world (`w.flow`); the page's People layer has a travel view (on foot, paddled, under sail; click a place,
  pick a month); `v2/tools/civ-travel.mjs` prints speeds and draws maps. World 6 (300 Myr):
  - Median km a day: on foot 25; rivers 50 down; paddled 40 on water; sail 59 along coasts and ~155 at sea (~6.5 km/h).
  - Crow-flight pace on foot over 800–2000 km: 15–18 km a day (the Old Assyrian caravans' ~17–20).
  - Land within a year of a river mouth: on foot 33 M km², paddled 131, sail 154.
  - The winds as the climate gives them are monthly means of the vector: 2.7 m/s on average, about half the day's
    wind. Sail uses the day's wind, √(mean² + 4.5²), and the mean's direction only for its steady share. So the wind's
    direction matters modestly here: an edge's slow way is ×1.05 its fast way (median), ×1.35 (90th percentile).
  - Fixed on the way: `travelDays` lost cells to float32 rounding (the heap's key outran the stored time).
  - Open for T1: paddlers now cross open ocean at 40 km a day. Voyaging needs a limit on days away from land per craft.
  - Open for the Earth check: whether the trades come out steady enough (Casson: Rome to Alexandria in 2–3 weeks,
    the way back against the wind in 1–2 months).
- **T1. Fronts and voyaging on the graph** (the economy only).

  **Done (2026-10-27).** Fronts cross water on the travel graph (`seaGate` in `travel.js`):
  - A water leg keeps its days from shore for each month it could have set out in. It goes on while its best
    month's days are within the era's reach; else it waits for the reach to grow. So crossings are directional
    and seasonal. The fronts' pace in km a year is unchanged.
  - A leg counts days away from land. By any shore, ice-covered ones included, it is at most the days in from
    there (the coastal route past the ice).
  - Foragers and farm fronts paddle: `crossingDays` 0.75 days, then 2.5 from 60 ka.
  - Voyages paddle until `voyageSailYears` (7000 yr after the first farmed coast), then sail: `voyageDays`
    2.5 → 5 → 9 → 20 days. When the sail comes, every launched coast plans its voyages again.
  - Earth winds and currents: NCEP/NCAR R1 and GODAS through `tuning/civ/fetch-flow.mjs` (run it once; the
    data is gitignored).
  - New arrival rows: Cyprus, Cuba, Samoa, Tahiti, Marquesas, Hawaii, Rapa Nui.

  Earth (seed 0), against the code before T1: 12/20 dates within ±2 ka (10/17 before). Fiji 3.4 ka, Samoa 3.3,
  Madagascar 3.4, Hawaii 3.0 (was 2.0), Rapa Nui 2.0 (was never). Monte Verde 15.5 ka. 170 M people at 0 BP
  (174 before). Farming on time in 4 of 7 places (3 before).

  Ensemble (20 worlds, `t1base` → `t1`): all big landmasses peopled on 20 of 20 worlds (19 before); centres 45
  (43); first city 6.5 ka (same); first state 5.5 ka (6.0); 137 M people at 0 BP (134.5); farmed share 0.46
  (0.45). T1 changes little away from the far islands.

  Rebased onto main 5f45475 (2026-10-29: cratons, unified heights, island arcs, closed basins, rivers). The civ
  tools' caches are now keyed by the history and finish code (`worldCode`, lib/civ-world.mjs); their frames come
  from the history cache. Earth is unchanged. The ensemble on the new worlds (`t1` → `t1r`, the new baseline):
  people at 0 BP 103 M (137); centres 36 (45); farmed share 0.38 (0.46); first city 6.0 ka (6.5), first state 5.0 ka
  (5.5); towns of 15 K+ on 19 of 20 worlds, states on 17, all big landmasses peopled on 17 (all 20).

  Open:
  - No Long Pause. East Polynesia comes ~2 kyr early (Tahiti 3.0 ka against 1–0.85). Caps of 10–30 days all give
    ~3.0 ka: on the real trades a sail makes 150–230 km a day, and the chains east of Samoa have no long leg. The
    record's cause is debated (ENSO westerly spells, the canoe itself).
    Pause-shaped ladders don't make one either. 10 days to 9500 yr then 25 days moves only Rapa Nui (2.0 → 1.2 ka);
    12 then 25 also loses Hawaii. Tahiti and the Marquesas stay at ~3.0 ka: their hops fit in 10 days. The default
    ladder stays (the km ladder at 40 and ~100 km a day; not fitted to one island).
  - Cuba at 43.7 ka (record 7–6): the Florida Current carries paddlers across the glacial strait.
  - Beringia still 33.6 ka (record 20–14); New Zealand 3.3 ka (record 0.8–0.7).
  - Drift landings are not modelled.
- **T2. Flows and towns** (Rihll–Wilson), grain first.
- **T3. Wear and paths;** then states' roads.
- **T4. Materials,** with the deposits of §5.6.

## 11. Food: harvests, soil, fish and the land views (2026-10-31, branch civ-food)

Ported from upstream's Food tab (raguilar011095/planet_heightmap_generation b9eb7fe; plans/V2_FARMING_PLAN.md C1–C6b;
© Robert Aguilar, GPL v3). Written fresh on the civ substrate, not merged. Sources: plans/CIV_SOURCES.md, "The resource map".

### 11.1 What changed

- **Harvests a year, not a suitability.** `crops.js` counts each class's harvests on the place's twelve months:
  degree-days to a cycle, runs broken by a dry or cold month, a staircase, at most three. Winter grains sleep through
  the cold; tropical roots through a dry season. Rain-fed harvests are discounted where the rains fail often. Watered
  harvests get ~60 mm a month. A second crop of another class fills the months the first leaves (the rotation).
  Paddy needs a month ≥ 18–22 °C to set grain. A temperate millet kind is ours.
- **Soil, the climate half.** River silt, loess, dune sand, else middling ground. Black earth, leaching and podzol from
  the land's cover. Silt is leached less (floods renew it). A crop's food scales by how much it asks of the soil.
  Harvests past the first count only as the soil can feed them. Poor ground is rested longer (forest fallow).
  The parent rock is a TODO for the geology survey (gs-geosurvey).
- **Fish.** The shelf within ~40 km, richer where the sea is cold or upwelling, less under ice. Up to 1 forager a
  km² of coast (Binford 2001: the 90th percentile of groups living ≥ 60 % on fish; upstream's 2.5 is above them all), added to the land's foragers. The old coast multiplier is gone. Earth reads its sea from the coast's air.
  The shelf is read on a fixed 0.25° grid, each grid cell taking the mesh cell it lies in; each land cell takes the
  mean over its own grid cells. So a coarse cell's coast is a strip of it, not its centre, and the total holds across
  details (Earth 3.05 M at 160K, 3.15 M at 640K).
- **Months, not crops, in the finish.** The finish packs each cell's twelve months (24 bytes). Crops are worked out on the
  cells read (the page's 160K; the tools' own). So `crops.js` is outside the finish's code hash.
- **Land views** on the People layer: Farmland, Soil, Staple food, Way of life. The People view's readout adds a line
  for what the land would support, to read the people against.

### 11.2 Not taken

Hearths and crop spread; the 10× gatherers' hold; cradles. The economy, not a switch, decides who farms.

### 11.3 Checks

- `tuning/civ/crop-check.mjs` (GAEZ v4, Pearson/Spearman): winter cereals 0.55/0.66 → 0.69/0.71; summer 0.50/0.63 →
  0.45/0.64 (misses 9.1 → 7.0 %); roots 0.58/0.66 → 0.62/0.66; tree 0.74/0.85 unchanged; paddy 0.55/0.78 → 0.61/0.82.
- `tuning/civ/food-check.mjs` (upstream's ~95 Earth places, WorldClim 10′): 101/110 hold. Season and soil 40/41;
  staples 26/32; farmland 22/22; people 13/15. Off: Arizona's season (rain 1.7 months); the Rub al Khali has herds
  (0.30 a km², at the line); England and Iowa grow roots best (potatoes outyield grain at civ-config's yields); the Nile
  and Mesopotamia grow summer grain best (canals water the year round, not by the flood); Mongolia farms (its rain's CV
  from storms alone is 0.28, under the herders' 0.33); Bengal 400.4 a km² (want ≤ 400).
- `v2/tools/check-civ-food.mjs`: the same at two details, each mechanism where its physics puts it, cost. All 27
  hold at 40K and 160K. Reported, not checked: main's delta wetland covers 2.7× the land at 40K (each delta cell is
  all marsh), so foragers over all the land differ 14 %; away from wetland they agree (0.089 vs 0.089). The fish
  agree within 27 % in total (0.58 vs 0.79 M); per km of coast 0.86×.
- Earth (`civ-sim --earth`, base e470080 → this branch): arrivals 12/20 → 13/20; centres 2/10 → 4/10; farming on time
  4/7 → 3/7; people 50 ka 5.5 → 7.8 M, 12 ka 18.3 → 23.8 M, 6 ka 69.9 → 91.0 M, 0 BP 170 → 224 M; first state ~5 ka →
  ~6 ka. Uruk 8.1k → 6.8k at 7 ka; Memphis 17.5k → 28.1k at 5 ka; Mohenjo-daro 10.0k → 53.5k at 6 ka (earlier and bigger:
  two watered harvests a year on the Indus); Erlitou still none.
- Fish at upstream's 2.5 a km² first (run 2): 50 ka 12.4 M, 12 ka 34.7 M. At Binford's 1 (run 3): above. Both above the
  1–10 M estimated for 12 ka (Thomlinson 1975; Pala et al. 2012), as base already was (open: forager capacity, §8 item 3).
- A latent bug the fish showed: a generated world's origin could be a glacial shelf cell, sea when people set out (its
  coast's capacity read through `home`); seed 6 then had no people. The origin is now on land at the sea level of
  `originBP` (`sim.js`).
- Ensemble (`civ-ensemble --seeds 1-10`, base `foodbase` → `food`): farming on 10/10 worlds both; towns of 15K+ and
  states 8 → 9 worlds; all big landmasses peopled 10 → 9 (seed 6: its 40 Mkm² landmass never, base by 0 ka); median
  first city 5.0 → 6.0 ka, first state 2.5 → 6.0 ka; centres 24 → 22; people at 0 BP 126 → 130 M; farmed share
  0.52 → 0.48. Seed 6's people start on its richest savanna coast now (the fish), 41.5 → 21 M at 0 BP. (Rerun with
  the shelf read cell by cell; before it, the first state 5.5 ka and 129 M.)
