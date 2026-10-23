# Civ layer — sources ledger

Every rule the civ layer implements, where its algorithm or paradigm comes from, and how closely we follow it. Update a
row in the same commit as the rule it describes. Full digests, links and quotes are in `CIV_RESEARCH.md` (§A foragers and
agriculture, §B states and trade, §C worldbuilding sources).

**Fidelity**
- **Direct:** the source's formula or numbers, as published.
- **Adapted:** the source's mechanism, with our own form or parameters, usually because the source works on another scale or is verbal.
- **Ours:** no single source. A modelling choice made to fit the record, labelled as such, with the observation it was tuned to.

**Checked**
- **[V]:** read in a primary source, or in code that implements it, during this project.
- **[L]:** a standard figure from the literature, not yet checked against its primary source.

Tuned values are not facts. Where a value was calibrated on the Earth test (`v2/tools/civ-sim.mjs --earth`), the row says so.

## Substrate — what the land offers (`v2/js/civ/substrate.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Net primary productivity from annual temperature and rain: the lesser of two limits | Miami model, Lieth 1975 | Direct | [L] |
| Forager density from NPP: log₁₀D = 9.6e-4·NPP(gC) − 1.53 | Ethnographic regression over 357 groups, *Nature Communications* 2022 (doi 10.1038/s41467-022-32750-x) | Direct | [V] |
| Aquatic bonus for coasts, lake shores and big rivers (×2–2.5, capped ×8), on a 15 km strip | Binford 2001; Kelly 2013: aquatic foragers are the densest | Adapted: the multipliers and strip width are ours | [L] |
| Wetland and delta bonus (×4); delta reach ∝ √discharge | Pournelle 2003; Algaze 2008 (deltaic marsh Sumer). Delta geometry from hydraulic-geometry scaling | Adapted; reach coefficient ours (Nile and Tigris–Euphrates ~130 km) | [L] |
| Wild cereal suitability: rain and temperature windows, relief ("hilly flanks"), rain seasonality | Blumler 1992 (large-seeded grasses are Mediterranean); Braidwood's hilly flanks | Adapted: window shapes ours | [L] |
| Dense wild cereal stands feed foragers up to ×1.5 at their best (`wildCerealForage`); not in the glacial climate | Harlan 1967 (a family could reap a year's wild einkorn in three weeks); the Natufians' reason to settle | Adapted: the multiplier is ours | [L] |
| Package abundance (winter cereals 1, summer cereals 0.8, tubers 0.75) | Blumler 1992: 32 of the 56 largest-seeded grasses are Mediterranean | Ours, motivated by Blumler; calibrated so the Fertile Crescent is among the first centres on Earth | [L] |
| Package Köppen envelopes | Ours, from the wild ranges of wheat/barley, millets/rice, taro/yam/potato | Ours | — |
| Rain-fed yield 650 kg/ha; limit 200 mm (barley), full at 450 | Halstead 1995 (Neolithic yields 400–750); Grigg 1974; FAO | Direct ranges | [L] |
| Irrigated yield 1500 kg/ha, seed ratio 1:25 | Jacobsen & Adams 1958; Ur III records | Direct | [L] |
| Persons per km² of farmland = yield·(1−fallow)·(1−1/seed ratio)/275 kg | Grain need 250–300 kg/person/yr (Ur III rations ~0.8 kg/day) | Direct arithmetic | [L] |
| Irrigable land: broad plains within 120 km of a ≥150 m³/s river, ≤150 m above base level, ≤40 m above the river, gentle slope; floodplain width ∝ √discharge | Ours, from Sumer's and the Nile's geometry | Ours; calibrated so Earth's top cradles are Sumer, Egypt and the Indus | — |
| Vector-fever climate per cell (from the twelve months: `vector.rain`, `vector.warm`) | See §Disease | | |
| Irrigation only where the season is long: none under 6 months above 10 °C, full from 8 | Ours: the canal civilisations were all warm (Sumer ~9, Egypt 12, the Indus 10+) | Ours; set to drop the Volga and Ural deltas (~6), which grew states on Earth at [4, 7] | — |

### The resource map (plans/CIV_PLAN.md §9.2; `crops.js`, `substrate.js` food)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Crop suitability from the twelve months: a month counts by the crop's temperature trapezoid and its water ((P + a 100 mm soil store)/PET, the growing period's P ≥ ½ PET); the best run of season months, with enough rain over it | FAO 1978 agro-ecological zones; GAEZ v4 (Fischer et al. 2021); thermal limits after FAO Ecocrop | Adapted: monthly means for daily limits, five crop classes, profiles ours | [L] |
| PET by Thornthwaite with the day-length correction (shared with cell-stats) | Thornthwaite 1948 | Direct | [L] |
| Crop profiles (winter cereals 2–8–20–27 °C, 3.5–5 months; summer cereals 9–16–30–37, 2–4; roots warm 16–21–31–37, 4–7 or cool 3–9–20–26, 3–4.5; tree crops 15–21–32–38, 6–10; paddy 15–21–32–38 with water ≥ 0.9–1.4 PET) and the always-wet penalty on cereals | Ours, tuned against GAEZ v4 low-input rain-fed yields on Earth (`tuning/civ/crop-check.mjs`): Pearson 0.50–0.74, Spearman 0.63–0.85 per class | Ours, calibrated | [V] (the check) |
| Crop yields, fallow, seed ratios: roots 1500 kg grain-eq/ha with a 0.7 swidden fallow; tree crops 500, 0.3 shade; paddies 1200, little fallow; millets' seed ratio ~1:20 | Ruthenberg 1980 (*Farming Systems in the Tropics*); Bray 1986 (*The Rice Economies*) | Adapted, round figures | [L] |
| Watered cereals (canals): the crop's warmth alone, at the irrigated yield | As irrigation above | Adapted | [L] |
| Herds: grazing NPP × openness × 0.03 ÷ 2.3 t per TLU ÷ 4.5 TLU per person | Sandford 1983 (stocking for the drought years); Dahl & Hjort 1976 (*Having Herds*: TLU per person); Mongolia's 1918 census (~0.4 /km²); Coughenour et al. 1985 (Turkana densities; East Africa's savannas now 2–6) | Adapted; the off-take set so dryland pastoralists come out at ~0.5–2 /km², pre-modern densities (C1 halved it from 0.06, which gave modern ones) | [L] |
| Openness of the country per Köppen class | Ours, by eye from tree-cover maps (Hansen et al. 2013) | Ours | — |
| Wild food split: water's share = the aquatic bonus, seeds = the wild-cereal bonus, the land's share split plants/animals by effective temperature (plants 0.15 → 0.7 from ET 10 to 18), animals large/small by openness, plants roots/nuts by climate | Binford 2001 (hunting dominant below ET ~12, gathering above); Kelly 2013 | Adapted: the shares ours; the parts sum to the forager density exactly. Checked on Earth (C1): hunted 0.70 of the food at ET 10–12, 0.54 at 12–14; gathered 0.52 at 14–16, 0.67 at 16–18 — Binford's thresholds. Fishing ~15 % in the cool zones, below his coastal groups (the land-wide mean dilutes the coastal strip); not retuned | [L] |

## Cradles (`v2/js/civ/cradles.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Circumscription score: the non-farmable share of a 250 km ring around an alluvium | Carneiro 1970 | Adapted: a static proxy for exit cost | [L] |
| Wild cereals within reach (exp(−d/500 km)); resources within 2000 km | Algaze 2008 (raw-material asymmetry); the hilly flanks 300–800 km from Sumer | Adapted | [V] argument |

## Resources (`v2/js/civ/resources.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Ores by tectonic setting: ophiolite copper at sutures, porphyry at arcs, tin in collision belts, obsidian on young volcanics | Standard ore-deposit geology (CIV_RESEARCH §B4) | Adapted | [L] |
| On Earth: USGS MRDS deposits | USGS Mineral Resources Data System | Data | [V] |

## People: dispersal (`v2/js/civ/sim.js`, `travel.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| A front advancing at so many km/yr: the cheapest path in time (arrival-time Dijkstra) | Fisher–KPP wave of advance, v = 2√(rD); Fort, Pujol & Cavalli-Sforza 2004 | Adapted: speeds set directly, not from r and D | [V] |
| Speeds: 0.35 km/yr inland, 4 along coasts, 1 along big rivers | Coastal route out of Africa (Macaulay et al. 2005) | Ours; calibrated on Earth arrival dates | [L] |
| Slope slows the front | Tobler's hiking function, 1993 | Direct form, relative to flat ground | [V] |
| Foragers' sea crossings: ≤30 km before 60 ka, 100 km after (Sahul); never more | Bird et al. 2019; Okinawa ~35 ka, Cyprus ~12 ka no wider | Adapted | [V] |
| Voyaging is farmers'. From when farmers first farm a coast, crossings stay at 100 km, rise to 200 km by 7000 yr, then 900 km by 7300 yr and 2000 km by 9500 yr. At sea they move 1.5 km/yr, then 10 km/yr from 7300 yr. The voyagers carry every crop farmed on a coast by the time of each landing. They land only on land no one holds; they farm it with the best-fitting crop and forage where none grows. (This replaces fixed dates: 900 km at 3.2 ka, 2000 km by 1 ka.) | Austronesian/Lapita expansion (Kirch 2017; Bellwood 2017): Bismarcks to Samoa in ~300 yr; New Guinea's taro, yams, bananas and breadfruit taken up on the way; ~7000 yr from the first coastal farmers (Levant ~10.5 ka) to Lapita (~3.3 ka); Cuba ~7 ka as a ~200 km hop. The Maori's moa-hunters foraged beyond the kūmara's range | Ours as a rule; the delay is calibrated on Earth's single case. Earth arrivals 8/13 within ±2 ka: Fiji 3.4 ka, Madagascar 3.4, New Zealand 3.3 (record 0.8). Fiji, Samoa, Tahiti, North Island NZ and Madagascar farmed with tubers; South Island foragers | [L] |
| Fronts wait at barriers (ice until 15.5 ka; cold land opening on a ladder by how cold, 45 ka → 20 ka) | The record (Bacho Kiro, Yana, the Beringian standstill) | Ours; the ladder is calibrated to the record | [L] |
| Cold measured as Binford's effective temperature, with glacial cooling | Binford 2001 | Direct formula; the cooling share (0.6 °C per °C) is ours | [L] |
| Glacial world: sea level schedule, −6 °C, rain ×0.7; shelves exposed and drowned | Standard LGM reconstructions | Adapted | [L] |
| Logistic growth toward capacity (r 0.02 foragers, 0.03 farmers) | Neolithic demographic transition, Bocquet-Appel 2011 | Adapted: the rates are ours | [L] |
| Default origin: the richest savanna on the landmass (glacial bridges joining it) with the most tropical savanna (Aw) | Homo as a species of the open tropical grasslands (deMenocal 2004); Africa as precedent | Ours | — |

| Each cell records its source: the cell the front reached it from (across water, the last peopled cell), a voyage's launch, the shelf the sea drove its people off. Each crop's front records its own; a centre or a landing starts one | Ours (bookkeeping for §9.4: migrants carry what they know) | Ours | — |
## People: settling and domestication (`v2/js/civ/sim.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Settled once density passes 0.091/km² beside wetland, coast, lake or rich wild stands | Binford's packing threshold (9.098 per 100 km²) | Direct threshold; the beside-what condition is adapted | [L] |
| *Retired (stage D, 2026-10-23; the economy's onset below):* cultivation begins as a rare event: hazard ∝ W⁶ × crowding | Ours; meant to give the record's ~10 centres staggered over 11.5–4 ka | Ours; calibrated on Earth | — |
| …the exponent eases from 6 to 3 over a cell's first 3000 years settled and packed: the best stands go first, middling ones late where no farmers came first | Population pressure → intensification (Cohen 1977; Binford 2001); the record's late centres on middling stands (New Guinea ~8.5 ka, Andes ~7, eastern North America ~4.5; Larson et al. 2014). Our W at Yellow River, Mesoamerica, Andes and New Guinea is 0.5–0.8 | Ours. Earth: centres 14 → 24, more of them spurious (11 → 20); known centres within 800 km and ±2 ka 2 → 4 of 10 | [L] |
| *Retired (stage D; the economy's allocation below):* people cultivate when it pays better than foraging, whose returns fall as land fills | Winterhalder & Kennett 2006 (behavioural ecology of adoption) | Adapted: a two-option return comparison | [L] |
| Domestication takes ~2000 years of cultivation | Purugganan & Fuller 2009 | Direct | [L] |
| Cultivation possible from 13 ka | Hillman et al. 2001 (Abu Hureyra); Richerson, Boyd & Bettinger 2001 (Holocene stability) | Direct date | [L] |

## People: farming spreads (`v2/js/civ/sim.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Demic front ~0.7 km/yr, 4 along coasts, 1.5 along rivers | Pinhasi, Fort & Ammerman 2005 (0.6–1.3 km/yr); Isern & Fort 2012 (Impressed Ware coasts 7.5–10.6) | Adapted; calibrated on Earth arrival dates | [V] |
| Slower where the package's climate fits badly (floor 20 %) | Bocquet-Appel et al. 2009 (the northern slowdown) | Ours | [L] |
| Desert alluvium farmed only once the package knows irrigation (2500 yr after its first centre); canals reach full density over 3000 more | Adams 1981 (Samarra → Ur III); Wittfogel critiqued: irrigation raises capacity, it is not a trigger | Ours, in that shape; calibrated on Sumer ~8 ka and Egypt ~7.5 ka | [L] |
| Farmers occupy 1 % of rain-fed land; 12 % of an irrigated alluvium at full | Zimmermann et al. 2009 (LBK 1–5/km²); HYDE 3.2 totals | Ours; calibrated on HYDE | [L] |

## Towns and states (`v2/js/civ/settle.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| A town's own fields: within 5 km, half farmed | Site catchment analysis: Chisholm 1968; Vita-Finzi & Higgs 1970 | Adapted | [L] |
| Grain brought in over cost-distance: land 1, river ¼, coast ⅛; reach 40 land-km | ORBIS cost ratios (Scheidel 2014: sea : river : land ~1 : 5 : 40–50) | Adapted: ratios compressed (coast ⅛, not 1/40), since early boats were coastal | [V] ratios |
| Rain-fed towns capped near 100–120 ha | Wilkinson 1994 | Emergent check, not a coded cap | [L] |
| Primacy: the biggest claim surplus first | Algaze 2008 (transport advantage); Adams 1981 | Ours (greedy) | — |
| Countryside empties into towns as irrigation intensifies (20 % → 60 %) | Adams 1981 (Early Dynastic Sumer ~80 % urban) | Ours in form | [L] |
| Size tiers 150 / 500 / 2500 / 15000 | Kosse 1990 (150, 500, 2500); Johnson 1982 scalar stress (×6); Alberti 2014 (127) | Direct thresholds, extended ×6 | [L], Alberti [V] |
| State = a polity with 3 tiers above the village | Wright & Johnson 1975 | Direct definition | [L] |

| Ways of life (`life.js`): towns are fed only by farmers' districts; herders' and foragers' land counts as free farmland for the exit test | Ours; pastoral land was farmed over where it could be (e.g. the Sahel, the steppe's edges) | Ours | — |
| Ways of life read off the diet (`lifeOfDiet`): the largest of wild, cultivated, crops, herds; canals make irrigators, packed storable wild food settled foragers | CIV_PLAN §9.3's labels (not yet used by the switches model) | Ours | — |
## Climate variability (`v2/js/civ/climate-var.js`; the forcing hook in `v2/js/climate/temperature.js`)

The planet's own climate model, run again under forcings; only the timing of the swings is drawn at random.

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Year-to-year rain from two modes of the climate: one hemisphere warmer than the other (the rain belt follows it), and land warmer against the sea (monsoon strength). Each cell's response is the Orogen climate re-run at ±1 σ of each, on a 2° grid | Folland, Palmer & Parker 1986 (Sahel rain and the interhemispheric sea-temperature contrast); the ITCZ following the warmer hemisphere (Chiang & Friedman 2012) | Adapted: the modes as uniform forcings (sin 2φ hemispheric; land share), not observed patterns. No ENSO: the Andes and Pacific coasts come out too steady | [L] |
| One σ = 2 W/m² of forcing | Ours: calibrated on Earth's year-to-year rain, not tuned further (modelled CV / observed: Sahel 0.25 / ~0.25, central India 0.19 / ~0.2, Baghdad 0.37 / ~0.4, Xi'an 0.20 / ~0.2, London 0.18 / ~0.15, Jerusalem 0.21 / ~0.3) | Ours | [L] targets |
| The modes persist: red noise, lag-1 correlation 0.4 | Sahel droughts' multi-year runs (Nicholson 2013) | Ours in value | [L] |
| Storms: CV = 1/√(P/20 mm), shared over a 2° region | Conrad 1941's curve of variability against mean rain; a Poisson count of storms reproduces it with ~20 mm storms | Adapted | [L] |
| Runoff by Fu's curve, w = 2.6 | Fu 1981; Zhang et al. 2004 (w ≈ 2.6) | Direct | [L] |
| Each mode's runoff routed down the land (priority flood, steepest descent); storms average out over a catchment; world river points snapped to the strongest routed flow within 60 km | Standard flow routing (the finish's own scheme, finish-hydro.js) | Ours: our own coarse routing (the world's river points carry no network yet) | — |
| Modelled flood CV (observed): the Nile 0.14 (~0.2), the Euphrates 0.24 (~0.3), the Tigris 0.23 (~0.3), the Indus 0.21 (~0.15), the Yellow River 0.32 (~0.2), the Niger 0.36 (~0.25) | Gauge records, from memory: to check against GRDC | Check only | [L] |

## Famine (`v2/js/civ/sim.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| The settled live year by year on harvest and store; foragers move instead | Halstead & O'Shea 1989, *Bad Year Economics* (mobility, diversification, storage, exchange) | Adapted: storage only, for the settled | [L] |
| Rain-fed harvest by the substrate's own yield ramp (200 → 450 mm); settled foragers' by the forager regression's own response to NPP, half their food (water's) steady | The substrate's rules (above) | Ours in combination | — |
| The river's harvest: the land watered follows the flood; a flood over 1.4× the usual does damage | Bell 1970 (low Niles and famine); Butzer 1976 (basin irrigation's area set by the flood) | Ours in form | [L] |
| Each year's harvest against its own long-run mean: the substrate's yields are averages over good and bad years | Halstead 1995 and Ur III yields are means | Ours (normalisation) | — |
| Farmers store up to a year's food, settled foragers half a year | Halstead & O'Shea 1989 (the normal surplus) | Ours in value | [L] |
| Deaths: 0.3 per year of food short beyond the store, at most half a year | Ó Gráda 2009, *Famine: A Short History* (5–15 % dead in major famines) | Ours; calibrated loosely | [L] |
| Outcome: famine deaths ~0.4–0.7 %/yr on marginal dry farming and the erratic Tigris–Euphrates, far less on the Nile | Emergent; the Nile's regularity against Mesopotamia's erratic floods is the classic contrast | Check | [L] |

| Herds (the herd response class): each year the animals the grazing can't carry die (grazing ∝ the year's NPP against a normal year's); the herd regrows logistically at 0.4 a year, from half to ~90 % in ~5 years; food ∝ the herd against its long-run mean | Drought losses of 30–60 %: McCabe 1987 (Turkana, a two-year drought: 63 % of cattle, 55 % of small stock); recovery in 3–4 years in Marsabit after 2009 and 2011; FAO (small stock 1.5–3 yr, cattle up to 10–12, after 30–40 % losses); Lesnoff et al. 2012 (Sahel: recovery times vary widely) | Ours in form; rates set between small stock and cattle. Not used by the switches model (no herders) | [L] |
## Disease (`v2/js/civ/disease.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Vector fever: the best 5-month run, each month min(temperature: 0 at 18 °C, 1 at 22–32, 0 at 40; rain: 0 at 0, 1 at 80 mm) | Craig, Snow & le Sueur 1999 (the MARA climate suitability for *P. falciparum*) | Direct form, from each cell's twelve months | [L] |
| Standing water (wetlands, irrigation) breeds it in a dry climate: there the warm months alone decide | Craig et al. 1999 (rivers and irrigation as exceptions in deserts) | Adapted | [L] |
| The cold filter: the parasites spread from the human origin only through country warm enough for transmission (suitability ≥ 0.5 by warmth), and across water people cross. Result on Earth: none in the Americas; New Guinea and northern Australia reached | The cold-filter argument for the Americas' freedom from Old World tropical disease before 1492 (e.g. Bates 1916–type arguments; reviewed by Reinhard et al. 2013 for parasites) | Ours as a rule | [L] |
| Losses: vector fever 25 % of the people a place would hold, snail fever 10 % on warm irrigated land; mobile foragers 30 % as exposed | Carter & Mendis 2002 (malaria's historical burden); Livingstone 1958 (settled farming made malaria); Kloos & David 2002 (schistosomiasis in Egypt) | Ours in value | [L] |
| Not modelled: tsetse (its range is Africa's by biogeography, not climate: it cannot be derived from the climate without pinning it); crowd diseases (need towns with their own demography); the Mediterranean's milder vivax malaria | — | — | — |

## Polities (`v2/js/civ/polity.js`)

Every `polityStepYears` (100), from each century's towns (`settle.js`). Polities do not feed back on the people yet.

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Polities grow by war between neighbours and shrink by collapse; the state emerges from the two | Turchin, Currie, Turner & Gavrilets 2013, *PNAS* 110:16384 (cultural multilevel selection on a grid of the Old World) | Adapted: towns, not 100 km cells; people stand in for their military traits | [L] |
| Who wins: (P_att − P_def)/(P_att + P_def), never below 0 | Turchin et al. 2013 | Direct form | [L] |
| Power = 1 + β·(people/10 000)·e^(−d/300 km), β = 1 | Turchin et al. 2013 (P = 1 + β Σ traits); distance decay of power from Boulding 1962 (*Conflict and Defense*, the loss-of-strength gradient) | Adapted: people for traits, 10 000 and 300 km ours | [L] |
| The defender + 4 per km of height | Turchin et al. 2013 (γ = 4, elevation) | Direct | [L] |
| The fortune of war: each side's power × e^(0.5·N(0,1)) | Ours: Turchin's cells differ by their traits; ours, by people alone, and equals would never beat each other | Ours | — |
| Neighbours: towns of different polities within 60 land-km (river and coast cheaper); a pair fights 0.5 times a century, × how full its land is | Carneiro 1970 (war follows population pressure on land) | Adapted: rate ours | [L] |
| A beaten town is absorbed only where its people cannot leave: chance 0 at 30 km from free farmland, 1 at 150 (land km; free = farmable and under half its capacity, or unfarmed) | Carneiro 1970 (circumscription); Allen 1997 (exit cost in Egypt) | Adapted: the exit-cost ramp is ours | [L] |
| A beaten capital brings its whole polity | Ours, after Sumer's hegemonies changing hands whole (Lugalzagesi of Umma taking Uruk, Ur and the rest, ~4.35 ka; the Sumerian King List's "kingship carried to …") | Ours | [L] |
| A new town in a bigger town's supply reach (`importKm`) belongs to it | Ours, from the city-state's hinterland of dependent towns (Adams 1981, *Heartland of Cities*: the Uruk-period settlement hierarchy) | Ours | [L] |
| A town whose site moves under 40 land-km is the same town (keeps its polity) | Ours (bookkeeping) | Ours | — |
| Collapse: 5 % a century, + 1 % for each town past the capital; a collapsed polity's towns each go their own way | Turchin et al. 2013 (δ₀ + δ_s·size; the traits' δ_a not modelled) | Adapted: rates ours, set so Sumer holds several city-states at 5 ka | [L] |
| A century's famine deaths beyond the place's norm (a 500-year running mean) raise war's odds × (1 + 10 × it) and add 3 × it to the collapse rate | Zhang et al. 2007, *PNAS* (war frequency follows harvest shortfalls); Hsiang, Burke & Miguel 2013, *Science* (conflict rises with the climate anomaly); Turchin & Nefedov 2009, *Secular Cycles* | Ours in form and value; the norm keeps usual hardship from breaking every polity | [L] |
| State = a polity holding towns of the three tiers above the village | Wright & Johnson 1975 (three levels of administrative hierarchy above the village) | Direct definition, read off settlement size | [L] |

## The economy (`v2/js/civ/econ.js`, `sim.js`; plans/CIV_PLAN.md §9.3, stages C1 and D)

From the end of the glacial (13 ka) each peopled cell's diet is worked out from what the land feeds. Since stage D
(2026-10-23) it is the only model: the switches' own onset and cultivation rules above are retired.

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Allocation by equal marginal return: each resource's return falls linearly with its use, a·(1 − x/K); work goes where it returns most, so low-ranked resources enter the diet as the high-ranked ones are used up (water-filling, exact) | MacArthur & Pianka 1966, *American Naturalist* (diet breadth); Flannery 1969 (the broad spectrum under crowding) | Adapted: the linear depletion and the equal-margin solution ours; the ranking is the model's | [L] |
| Return ranks: large game 1, aquatic 0.7, herds 0.6, small game 0.5, nuts 0.4, wild roots 0.35, wild seeds 0.3, crops 0.25 (× skill) | Kelly 2013, *The Lifeways of Hunter-Gatherers*, ch. 3 (post-encounter return rates: the order only) | Adapted: the order Kelly's, the values ours | [L] |
| Land budget: fields (1 % of the land at full use, the alluvium's share where watered; 2.5 % gave Earth ~25× HYDE at 8 ka) and settled people's pasture take land from the wild | Ours (§9.2); the field share from early farmers' densities, the LBK's 1–5 /km² (Zimmermann et al. 2009) | Ours, tuned | [L] |
| Settled herds: wild ones managed over all their open range until domesticated; then a mixed farm's small herds, on 5 % of the land (fallow, stubble, the commons; at most the open country) | Zeder 2008, *PNAS* (managed hunting in the Zagros before the herds changed); Halstead 1981, "Counting sheep in Neolithic and Bronze Age Greece" (in Hodder et al., eds, *Pattern of the Past*); Bogaard 2004, *Neolithic Farming in Central Europe* (small, field-bound herds) | Adapted: the 5 % ours (60 % of the open land made herders of most farming country on world 6) | [L] |
| Cultivation takes over a crop's wild stands (cereals and wild rice: wild seeds; roots: wild roots; tree crops: nuts; herds: large game; stands several crops share are split by how well each one's wild form grows); its capacity runs from the stands' to the crop's own as it is domesticated; none where it feeds less than the stands | Rindos 1984, *The Origins of Agriculture* (co-evolution); Winterhalder & Kennett 2006 (cultivate when it pays) | Adapted | [L] |
| Domestication D by use of the cultivated form: 0 → 1 over 2000 years at ≥ 20 % of the diet, slower below | Purugganan & Fuller 2009, *Nature*; Fuller 2007, *Annals of Botany*; Allaby et al. 2017 (better than the first for the rate) | Adapted: the rate theirs, the use share ours | [L] |
| Seed is given: along a front each cell takes the most domesticated crop of the people it came from; the domesticated crop has a front of its own that goes on into land still cultivating the wild form. A centre is a lineage domesticating before that front reaches it | §9.3; Allaby et al. 2017 (protracted, many loci) | Ours | — |
| Cultivation before domestication spreads from its onset at 0.25 of a farming front's speed, within the wild form's range | Ours, set on the bench: none gives 6.4 centres per 10 M km² of ideal land and an inland front of 1.1 km/yr; full speed 2.3 and 45 km/yr; 0.25 gives 3.6 and 1.2 | Ours, tuned | — |
| Onset: one hazard per settled cell, (W × u)^k (k easing 6 → 3), at the domesticate it lacks with the highest W × u: W its wild form's stands, u the share of the diet already taken from them against 20 % (gathered or hunted hard) — no crowding term. Settled foragers sit near their capacity, so the margin λ itself is ~0 everywhere; how far down the ranks the diet reaches into a stand is what differs | Flannery 1969 (the broad spectrum); Winterhalder & Kennett 2006, *Behavioral Ecology and the Transition to Agriculture* (cultivation where it pays against the margin); Zeder 2012, "Pathways to animal domestication" (in Gepts et al., eds, *Biodiversity in Agriculture*: the prey pathway) | Adapted: the form ours | [L] |
| Wild flooded crops (rice, taro) at 0.4 × suitability × wetland: at 0.8 every warm marsh was a centre of them | Ours | Ours, tuned | — |
| Wild forms: tree crops' in closed forest (0.6 × the crop's suitability × closedness); rice's and taro's in marshes and deltas (× wetland; below); herds' the wild herd animals (`wildHerd`) | Ours | Ours | — |
| Skills of the domesticates: learnt by use (0.3 → 0.9 in ~400 years of full use), fading unused (half in ~350), mixing toward the source's along a front (half a step); held at most N/(N + 500), N the people within 50 km | Henrich 2004, *American Antiquity* (a threshold population; disputed by Vaesen et al. 2016, *PNAS*) | Adapted: the form ours | [L] |
| Growth rate rises from the foragers' 0.02 to the farmers' 0.03 with the share of food from crops and herds | Bocquet-Appel 2011, *Science* (the Neolithic demographic transition) | Adapted | [L] |
| Herds feed on their meat alone at domestication (0.25 of a dairy herd's people) and on their milk by use over 3000 years after | Sherratt 1981 (the secondary products revolution); Evershed et al. 2008, *Nature* (milk residues by ~9 ka in NW Anatolia) | Adapted: timing ours | [L] |
| Pastoralism: once milked, people may follow their herds over all the open land, growing 0.1 of the crops they could and the wild thinned by the grazing — where that feeds more than settled mixed farming, and only where the rain's year-to-year CV (storms' and modes') is 0.33 or more, or no crop grows to farm (the cold) | Ellis & Swift 1988, *Journal of Range Management* 41 (non-equilibrium rangelands: mobility pays where rain's CV > ~33 %); Khazanov 1984, *Nomads and the Outside World* (the dry margins; trade for grain); Dahl & Hjort 1976 (pastoralists live on milk); Marshall & Hildebrand 2002, *Journal of World Prehistory* (herding before crops where rain is unpredictable) | Adapted: the shares ours | [L] |
| Ways of life read off the diet (lifeOfDiet: the largest class; settled where packed beside storable food, as the switches') | §9.3; Binford 2001 (packing) | Ours | — |

## Design sources for the next model (plans/CIV_PLAN.md §9; not yet in code)

Cited in the §9 design. Each moves into its section's table, with fidelity, when its rule enters the code (C1 moved diet
breadth, the broad spectrum, Rindos, the domestication rate, Henrich, Zeder and Bocquet-Appel into the economy's table;
with their full references).

| Idea | Source | Checked |
|---|---|---|
| Population pressure drives intensification | Cohen 1977, *The Food Crisis in Prehistory* | [L] |
| Time-delayed front speed v = 2√(rD)/(1 + rT/2); demic–cultural mix, ~60 % demic in Europe | Fort 2012, *PNAS* | [L] |
| Farmers entering occupied land as competition | Aoki, Shida & Shigesada 1996, *Theoretical Population Biology* | [L] |
| The end of the African Humid Period (~5.5 ka) pushes people into the Nile valley (a planned rule: needs orbital forcing) | Kuper & Kröpelin 2006, *Science* | [L] |
| Agro-climatic yield from the months | FAO 1978 AEZ; GAEZ v4 (Fischer et al. 2021) | in use, see the resource map |
| Travel and trade (plans/CIV_PLAN.md §10): seasonal travel costs on a network, by month and craft | Scheidel 2014, *Journal of Roman Archaeology* 27 (ORBIS); Casson 1971, *Ships and Seamanship in the Ancient World* (speeds by wind) | [L] |
| Voyaging: upwind exploration; drift and sailing simulations of the Pacific | Irwin 1992, *The Prehistoric Exploration and Colonisation of the Pacific*; Avis, Montenegro & Weaver 2007, *Journal of Island and Coastal Archaeology*; Montenegro, Callaghan & Fitzpatrick 2016, *PNAS* | [L] |
| Boats and sails: the Gulf's by the Ubaid; pack animals and the wheel | Carter 2006, *Antiquity*; Bulliet 1975, *The Camel and the Wheel* | [L] |
| Trails worn by use, fading unused | Helbing, Keltsch & Molnár 1997, *Nature* | [L] |
| Spatial interaction; towns growing toward their inflow | Wilson 1971, *Environment and Planning*; Harris & Wilson 1978, *Environment and Planning A*; Rihll & Wilson 1987, *Histoire & Mesure*; Bevan & Wilson 2013, *Journal of Archaeological Science* | [L] |
| Maritime networks of the Aegean Bronze Age | Knappett, Evans & Rivers 2008, *Antiquity* | [L] |
| Old Assyrian trade: caravan times; distance elasticity ~2 | Veenhof 1972, *Aspects of Old Assyrian Trade*; Barjamovic, Chaney, Coşar & Hortaçsu 2019, *Quarterly Journal of Economics* | [L] |
| Trade's asymmetry: the alluvium's exports and imports | Algaze 2008, *Ancient Mesopotamia at the Dawn of Civilization* | [L] |

Notes on these sources from the §9 design review (2026-10-22):
- MacArthur & Pianka add a lower-ranked item when encounters with the higher-ranked ones fall, not when those "can't feed" people. §9.1 now says so.
- Kelly 2013's return rates are post-encounter rates that leave out search time. Use them for the ordering only, and check the table number.
- Henrich 2004 models a threshold population by imperfect copying (a Gumbel draw). Our S(N) is our own formula: "adapted", and disputed by Vaesen et al. 2016.
- Boserup 1965 is about intensifying farming, not hunger taking up a new resource. Cohen 1977 fits that better, so §9 cites Cohen.
- GAEZ v4 uses a daily water balance and modern cultivars. Our monthly "P ≥ ½ PET" is the FAO 1978 method; compare against GAEZ's low-input yields only.
- The demic–cultural mix (~60 % demic) is Fort 2012, not Fort, Pujol & Cavalli-Sforza 2004, which is the Palaeolithic wave-of-advance paper (used for that above).
- The review found these correct as used: Flannery 1969, Rindos 1984, Binford 2001, Blumler 1992 (a dissertation, cited by way of Diamond 1997), Bocquet-Appel 2011.

## Data for the Earth test (`tuning/civ/`)

| Data | Source | Notes |
|---|---|---|
| Climate (monthly T, P, elevation, 10′) | WorldClim 2.1 (Fick & Hijmans 2017) | Köppen and cell stats computed as the climate does |
| Rivers with discharge | HydroRIVERS v1.0 (Lehner & Grill 2013) | No monthly regimes |
| Sea floor | ETOPO5 (NOAA NGDC 1988) | Glacial shelves |
| Crop yields to check the crops' climate | GAEZ v4 low-input rain-fed attainable yields, 1981–2010 (Fischer et al. 2021; FAO/IIASA) | Validation only (`crop-check.mjs`) |
| Deposits | USGS MRDS | |
| LGM ice | Ehlers & Gibbard 2004, roughly, by eye | Boxes by latitude and longitude |
| Population totals | HYDE 3.2 (Klein Goldewijk et al. 2017) | Validation only |
| Arrival, centre and farming dates | Listed in `civ-sim.mjs` beside each site; centres from Larson et al. 2014 (*PNAS*) and Fuller 2011 | Validation only |
