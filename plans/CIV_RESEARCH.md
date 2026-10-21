# Civ layer — research digests (2026-10-21)

Two web-research passes behind CIV_PLAN.md. [V]/[L]/[unverified] tags are the researchers' own: confirm [L]/[unverified] numbers against primary sources before hard-coding.

## A. Foragers, dispersal, agriculture origins & spread, yields

I've collected numbers and sources for all five topics. Not everything is equally solid: some figures I confirmed against the papers, and the rest come from memory of the literature and are marked **[unverified]**. Several primary texts weren't reachable (Binford's book, Kelly's tables, and the Mesopotamian yield papers by Jacobsen & Adams, Powell and Maekawa), so pull those originals before you hard-code those numbers.

---

## 1. Hunter-gatherer density, group sizes and mobility

**Effective temperature (ET).** This is Binford's main climate variable, following Bailey (1960):
`ET = (18·W − 10·C) / (W − C + 8)`, where W is the mean temperature of the warmest month and C of the coldest month, in °C. ET runs from about 8 (polar) to about 26 (equatorial). You can compute it directly from your monthly temperature grid.
- Rough bands **[unverified, after Binford 1980 and 2001]**:
  - ET < ~11–12: diet is mostly meat or fish, and food storage is needed.
  - ET above ~15: plant foods dominate.
  - Reliance on aquatic food rises toward high latitudes and wherever aquatic resources exist.

**Packing thresholds** (Binford 2001, from secondary sources):
- About **1.6 persons/100 km²**: groups that live mainly on large game start to become "packed", i.e. constrained in how far they can move.
- **9.1 persons/100 km²** (Binford's figure is 9.098): residential mobility is severely constrained. Groups must widen their diet (aquatic foods, intensive plant use, horticulture). Binford argued farming spread almost instantly where foragers had already crossed this threshold.
- Rule you could use: when density exceeds 0.091/km², switch the cell to "intensifying / ready to adopt farming".

**Density as a function of net primary productivity (NPP)** (357 ethnographic groups, reported in the 2022 Nature Communications paper):
- `log10(D) = 9.6×10⁻⁴ · NPP − 1.53`, with D in persons/km² and NPP probably in g C/m²/yr (units not checked).
- This works out to about 0.03/km² at NPP 0, 0.27/km² at 1,000, and about 2/km² at 2,000.
- NPP explains less than 30% of the variance. At the same NPP, density varies about 1,000-fold.
- Short growing seasons push diets toward meat, so for those cells adjust by seasonality as well as annual NPP (Zhu et al. 2021, Nature Ecology & Evolution).

**Typical densities in persons/km² [unverified ranges, from Kelly 2013 and Binford 2001]:**

| Setting | Density |
|---|---|
| Arctic / boreal | 0.005–0.05 |
| Arid desert (Western Desert Aboriginal groups, ǃKung/Ju/'hoansi) | 0.01–0.2 |
| Tropical forest | 0.05–0.3 |
| Savanna / temperate | 0.1–0.5 |
| Rich riverine or coastal (Northwest Coast, California) | 0.5–3+ |

- A practical rule: give coastal, estuarine and anadromous-fish river cells a ×3–10 multiplier.
- European Last Glacial Maximum total: **130,000–410,000 people**, with about 36% of Europe climatically suitable even in the coldest phases (Tallavaara et al. 2015, PNAS).

**Group sizes ("magic numbers"):**
- Each level of organisation is about **4×** the size of the one below it (Hamilton et al. 2007, Proc. R. Soc. B, 1,189 groups in 339 societies).
- Empirical layer sizes are about **4.6 / 14.3 / 42.6 / 132.5 / 566.6 / 1,728** (Zhou et al. 2005). In rule terms: family about 5, residential band 25–50, clan about 150, mating network or "tribe" about 500–1,500.

**Territory size:**
- Home range grows only about **70% for each doubling of population**, so range ∝ N^0.77. Denser groups therefore use land more efficiently (Hamilton et al. 2007, PNAS; covered by Scientific American, 2011).
- Derive territory size as group size ÷ density. Example: 25 people at 0.1/km² need about 250 km².

**Mobility:**
- Residential moves range from **0 to about 60 per year** (Kelly 1995, Table 4), scaling inversely with how dense resources are within a patch.
- Typical **[unverified]**: 5–15 moves/yr, 5–30 km per move, and total residential distance per year of about 50 to over 500 km.
- Mobility shifts from residential to logistic (task groups travel from a base) as ET falls and storage rises (Binford 1980; Kelly 1983).

## 2. Dispersal of early modern humans

**Fisher-KPP speed:** `v = 2√(aD)`.
- The time-delayed version (Fort & Méndez 1999) adds the generation gap: `v = 2√(aD)/(1 + aT/2)`, with `D = ⟨Δ²⟩/(4T)`.
- For hunter-gatherers: a ≈ 0.02–0.03/yr, T ≈ 25–30 yr. Paleolithic mobility gives D of roughly 10–50 km²/yr **[order of magnitude, unverified]**.

**Observed speeds:**
- Late-glacial recolonisation of northern Europe: **0.8 km/yr (95% CI 0.5–1.1)**. The authors suggest a similar speed for the spread into the Levant and Europe at 42–36 ka (Fort, Pujol & Cavalli-Sforza 2004).
- India to Australia about 65 ka "most likely in only a few thousand years", i.e. **several km/yr** along the coast (Macaulay et al. 2005).
- My own derivation: about 12,000 km in 5–10 kyr gives roughly 1–3 km/yr along the coastal route, and Beringia to Chile (about 15 ka) implies **5–10+ km/yr**. Coastal and empty-continent fronts move faster than inland ones.

**Water crossings to Sahul** (Bird et al. 2019, Scientific Reports):
- Sea level was 75–85 m below today. The route needed **at least one crossing of about 100 km plus several of 20–30 km**.
- The final crossing of about 90 km succeeded 82.6% of the time over 4 days in optimal conditions.
- Random drift reaches Sahul with probability under 5% unless about 40 or more adults are swept off at least once every 20 years.
- Intentional voyaging (choosing a departure window, paddling 0.5 knots) raises success on the final crossing to 13–89%.
- The northern route (Sulawesi to New Guinea) is favoured because the destination island stays visible throughout each crossing.

Suggested rule:

| Era | Allowed crossing |
|---|---|
| Before 60 ka | ≤ ~20–30 km, intervisible only |
| 60–50 ka onward | ≤ ~100 km if the far shore is visible |
| After ~3.5 ka (Austronesian/Lapita) | Open-ocean voyages of hundreds of km |

**Corridors and barriers:**
- Green Sahara / African Humid Periods (about 130–115 ka, 105–95 ka, 11–5 ka) open the Sahara and Arabia. Use precipitation above ~150–250 mm as the passable threshold **[heuristic]**.
- An Indian Ocean–rim exit as early as about 130 ka is possible (Reyes-Centeno et al. 2014, PNAS).
- Dispersal came in pulses: South Asia and Sahul by about 50 ka, Europe by about 45 ka (Timmermann & Friedrich 2016; deMenocal & Stringer 2016).
- Ice and hyper-arid desert are impassable. River valleys and coasts carry dispersal at roughly 2–10× the inland speed.

## 3. Where agriculture originates

**Mediterranean-climate seed grasses** (Blumler 1992, as cited in Diamond 1997, ch. 8):
- Of the world's 56 largest-seeded wild grasses, **32 grow wild in Mediterranean-type climates** **[I could not verify this online]**.
- Rule: centres of domestication are favoured by a strongly seasonal climate (wet winter, long dry summer). That climate favours large-seeded annuals that store energy in the seed and are easy to harvest.

**Holocene stability** (Richerson, Boyd & Bettinger 2001, American Antiquity 66:387):
- Glacial climates were dry, low in CO₂ (~180–190 ppm) and highly variable on decadal-to-centennial scales, which made farming "impossible".
- In the Holocene (CO₂ ~260–280 ppm, stable) farming became "mandatory" in the long run, and intensification ran in one direction only.
- Rule: allow domestication only after about 11.7 ka, or more generally when the variance of your climate series falls below a threshold.

**Climate volatility** (Ashraf & Michalopoulos 2015, Review of Economics & Statistics 97:589):
- Year-to-year temperature volatility has a **hump-shaped** effect on when farming is adopted.
- Intermediate volatility leads to the earliest adoption: shocks push foragers to experiment and build tacit knowledge, without destroying the resource base.
- Rule: adoption hazard ∝ σ·exp(−σ²/2σ*²), or a similar inverted-U curve.

**GLUES** (Wirtz & Lemmen 2003; Lemmen et al. 2011):
- Each region carries three traits: technology T_A, economic diversity, and farming share.
- Population: `dP/dt = r·P`. Each trait X changes as `dX/dt = δ_X·∂r/∂X`, so traits move in whichever direction raises the growth rate.
- Reduced growth rate: `r = μ(1 − ωT_A)(1 − γ√T_A·P)·SI − ρ·T_A⁻¹·P`. SI is food production, which depends on NPP; the remaining terms cost administration and overuse.
- Regions are NPP clusters. The code is open source (arXiv 1108.2585 and 1502.00201).

**Other predictors (qualitative):**
- Sedentism comes before farming (Natufian, about 15–11.5 ka).
- Packing past Binford's threshold (§1).
- Hilly flanks and ecotones, where steep elevation gradients put many microclimates within one territory's reach.
- Abundant wild cereal stands near permanent water.

## 4. Spread of farming

**Europe-wide rate:**
- About **1 km/yr** from a regression on 53 sites (Ammerman & Cavalli-Sforza 1971/1984).
- Pinhasi, Fort & Ammerman (2005, PLoS Biology 3:e410) used 735 sites and found **0.6–1.3 km/yr**, with origin in the northern Levant / Mesopotamia.
- Demic-diffusion parameters: a = 0.029–0.035/yr, mobility ⟨Δ²⟩ = 900–2,200 km² per generation, T = 29–35 yr. These predict **0.6–1.1 km/yr**.
- Check: a = 0.032, T = 32 and ⟨Δ²⟩ = 1,500 give D ≈ 11.7 km²/yr and v ≈ 0.81 km/yr.
- Reaching northwest Europe took more than 3,000 years.

**Faster routes:**
- Mediterranean Impressed Ware: **7.5–10.6 km/yr**, at least 79% of it demic (Isern & Fort, "Dispersal distances and cultural effects…", Univ. Girona). Others give about 10 km/yr.
- Danube–Rhine LBK: up to about **5 km/yr**.
- Atlantic coast: no clear acceleration.
- In Africa: herders 1.4–3.3 km/yr, Bantu farmers 1.5–2.3 km/yr.
- Rule: a coastal or riverine corridor gives ×5–10 speed by leapfrogging. Seed sites up to about 100–300 km ahead of the front along coasts **[heuristic]**.

**Stalling:** the front paused for centuries at the Carpathian basin edge and at the LBK's northern limit (the loess boundary). Diamond's axis hypothesis says crops spread more easily along latitude (same day length and season) than across it. Rule: slow the front by a factor tied to the climate mismatch, e.g. a change in Köppen class or growing-degree-days.

**Farmer vs forager density:**
- Genetic effective population of farmers is about **5×** that of hunter-gatherers (Tsoupas et al. 2025, Science Advances). In other regions the minimum ratio is 1.1 (Leonardi et al. 2017).
- Census densities **[unverified]**: early farmers about 1–10/km² regionally (LBK settlement cells higher) vs foragers about 0.01–0.3, i.e. 10–100×.
- Birth rate jumps within less than 1,000 years of adoption (Bocquet-Appel 2008).

## 5. Yields and carrying capacity

**Rainfall limits for rainfed cereals:**
- Barley fails below about **200 mm/yr**; wheat needs **250–300 mm**. The Negev's Be'er Sheva basin, at about 200 mm, sits on the edge (Grigg 1974; Rosen 2017).
- FAO zoning: 200–250 mm supports only barley or grazing; 250–350 mm supports barley and wheat.
- Near East archaeological maps use the 200 mm isohyet as the dry-farming boundary.
- Add inter-annual variability. Near the boundary, harvests fail in roughly 1 year in 3 **[heuristic]**.

**Rainfed Neolithic yields:**
- Halstead (1995): a household of 4–5 needs 2–3 ha of intensively worked land to produce about 1,500 kg of cereal, i.e. **~500–750 kg/ha**.
- Modelling studies use **400–600 kg/ha**.
- Manured garden plots (Bogaard; Vaiglova et al. 2023) probably reached 1,000–2,000 kg/ha **[unverified]**.
- Seed:yield ratios for dry farming are about **1:3–1:10**. Medieval Europe sat at 1:3–1:5 (Slicher van Bath) **[unverified]**.

**Irrigated southern Mesopotamia [unverified, widely quoted]:**
- Girsu barley yields per Jacobsen & Adams (1958, Science 128:1251): about **2,537 L/ha** around 2400 BC, about 1,460 L/ha around 2100 BC, about 897 L/ha around 1700 BC. Barley weighs about 0.6–0.7 kg/L.
- They tie the decline to salinisation and a shift from wheat to barley.
- Ur III seed:yield is roughly **1:20–1:30**. Sargonic claims of 1:76 are doubtful.
- Powell (1985, ZA 75:7–38) disputes progressive salinisation. Maekawa's Ur III Lagash texts confirm "remarkably high" ratios.

**Carrying-capacity formula** (my own derivation):
`persons/km² = Y · 100 · f_crop · (1 − fallow) · (1 − 1/SYR) / R`
- Y is yield in kg/ha, f_crop the cultivated share, SYR the seed:yield ratio, and R grain per person per year.
- Use R ≈ 250–300 kg. The Ur III ration was about 60 sila/month ≈ 0.8 kg/day.

| Case | Y (kg/ha) | Fallow | SYR | Cultivated share | Result |
|---|---|---|---|---|---|
| Irrigated Sumer | 1,500 | 50% (alternate-year) | 1:25 | 100% | ~**250/km²** of cultivated land |
| Rainfed Neolithic | 600 | 50% | 1:6 | 20% | ~**17/km²** regionally |

**Salinisation rule:** in irrigated cells with poor drainage and high evaporation, cut yield by about 0.5–1% per year of continuous irrigation. Fallow or silt-flushing resets it, and barley replaces wheat once salinity is moderate (Jacobsen & Adams 1958).

---

### Sources
- Bailey 1960; Binford 1980 (American Antiquity 45:4); Binford 2001, *Constructing Frames of Reference* (UC Press). Packing thresholds via secondary sources: https://texasbeyondhistory.net/waco/images/population.html and https://www.npshistory.com/series/archeology/18h/report.pdf
- Kelly 2013, *The Lifeways of Hunter-Gatherers* (CUP): https://assets.cambridge.org/97811070/24878/frontmatter/9781107024878_frontmatter.pdf ; Kelly 1983 mobility: https://hraf.yale.edu/documents/334
- NPP regression and Pleistocene/Holocene limiting factors (2022, Nature Communications): https://dx.doi.org/10.1038/s41467-022-32750-x and https://pmc.ncbi.nlm.nih.gov/articles/PMC9448755/
- Zhu et al. 2021, seasonality and density (Nature Ecology & Evolution): https://link.springer.com/article/10.1038/s41559-021-01548-3
- Tallavaara et al. 2015, PNAS 112:8232: https://pmc.ncbi.nlm.nih.gov/articles/PMC4500234
- Hamilton et al. 2007, Proc. R. Soc. B 274:2195 (doi 10.1098/rspb.2007.0564); Zhou et al. 2005 layer sizes via https://arxiv.org/pdf/1707.01744 ; home-range scaling: https://www.scientificamerican.com/blog/guest-blog/hunter-gatherers-show-human-populations-are-hardwired-for-density
- Fort, Pujol & Cavalli-Sforza 2004, Cambridge Archaeological Journal 14:53: https://dugi-doc.udg.edu/handle/10256/7774
- Macaulay et al. 2005, Science 308:1034: https://openresearch-repository.anu.edu.au/items/ad3d414a-b7ef-4aaf-bbb6-e55c0567bdd7
- Bird et al. 2019, Scientific Reports, doi 10.1038/s41598-019-42946-9: https://openresearch-repository.anu.edu.au/bitstream/1885/237919/1/s41598-019-42946-9.pdf
- Reyes-Centeno et al. 2014, PNAS (press release): https://sciencedaily.com/releases/2014/04/140421164242.htm ; deMenocal & Stringer 2016: https://climate.fas.harvard.edu/resource/demenocalstringer2016pdf
- Richerson, Boyd & Bettinger 2001: https://faculty.bennington.edu/~kwoods/classes/env%20hist%20ag/readings_21/Richerson%20et%20al.%20-%202001%20-%20Was%20agriculture%20impossible%20during%20the%20Pleistocene%20.pdf
- Ashraf & Michalopoulos 2015: https://www.nber.org/system/files/working_papers/w18765/w18765.pdf
- GLUES (Wirtz & Lemmen 2003; Lemmen et al. 2011): https://arxiv.org/pdf/1108.2585 , https://arxiv.org/pdf/1502.00201 , https://nat-esm-system.dkrz.de/Optional%20Components/GLUES.html
- Pinhasi, Fort & Ammerman 2005: https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.0030410
- Mediterranean Neolithic spread (Isern & Fort): https://dugi-doc.udg.edu/handle/10256/21439 ; LBK and coastal rates: https://arxiv.org/pdf/1203.4471 ; African expansion rates: https://communities.springernature.com/posts/explaining-human-range-expansions
- Tsoupas et al. 2025: https://archive-ouverte.unige.ch/unige:187834 ; Leonardi et al. 2017: https://sfera.unife.it/retrieve/e309ade1-6336-3969-e053-3a05fe0a2c94/Leonardi%20Sci%20Rep.pdf ; Bocquet-Appel 2008 (Springer book)
- Diamond 1997, *Guns, Germs, and Steel* (axis hypothesis; Blumler seed data)
- 200/250 mm limits: https://books.ub.uni-heidelberg.de/propylaeum/catalog/view/1121/1931/100198 , https://www.fao.org/4/Y4732E/y4732e06.htm , https://archaeologydataservice.ac.uk/catalogue/adsdata/arch-907-1/dissemination/pdf/Vol2//Vol2_Chap1Figs.pdf
- Halstead yields: https://scholarlypublications.universiteitleiden.nl/access/item%253A4098125/view ; Vaiglova et al. 2023: https://researchers.une.edu.au/en/publications/exploring-diversity-in-neolithic-agropastoral-management-in-mainl-7/
- Jacobsen & Adams 1958, Science 128:1251: https://keibi.uni-tuebingen.de/Record/KEI00116827 ; Powell 1985: https://keibi.uni-tuebingen.de/Record/KEI00062118 ; Maekawa: https://blogs.fu-berlin.de/knowtheancients/2024/09/27/kazuya-maekawa-1942-2024/

## B. State formation, settlement siting, trade, metallurgy, precedents

I couldn't reach every primary source (several PDFs were paywalled or blocked). Each item below is marked: **[V]** means I checked it in a primary source or code this session; **[L]** means a standard figure from the literature that I did not re-check. Treat [L] numbers as starting values and confirm them before anything depends on them.

The main corrections to the brief: ORBIS's own costs give sea : river : land of about 1 : 5 : 40–50, not 1 : 5 : 28. Renfrew's 300 km supply zone is real, but his fall-off was not explicitly exponential. And GUARD's code shows that two of Turchin's published parameters differ from what the original code ran.

## 1. State formation and urbanization

**Carneiro's circumscription theory** (Carneiro 1970, *Science* 169:733) [L]
- Farmland hemmed in by desert, mountains or sea, combined with population growth, leads to war over land. In circumscribed land the losers can't flee, so they are subordinated and taxed; that is the state.
- "Social circumscription": dense neighbours block flight just as terrain does. "Resource concentration": rich riverine or coastal patches act the same way.
- As a rule: per farmland region, compute **exit cost** = least-cost distance to the nearest farmable cell outside the region, or the fraction of its perimeter that is desert, mountain or sea. Losers of a war conflict are absorbed rather than displaced with probability rising in exit cost × population pressure (P/K).

**Allen 1997, "Agriculture and the Origins of the State in Ancient Egypt"** ([IDEAS](https://ideas.repec.org/a/eee/exehis/v34y1997i2p135-154.html)) [V abstract]
- An elite's surplus extraction is greatest when producers can't move. Desert confined the Nile population to a line, so the only escape was along the river.
- He argues this immobility is why a unified state formed and lasted. It is the same exit-cost logic, specialised to a linear oasis.

**Wittfogel's hydraulic hypothesis** (*Oriental Despotism*, 1957) [L]
- Claim: large-scale irrigation requires centralized management, which produces despotic states.
- Critique: Adams (1966, *Evolution of Urban Society*; 1981) showed that early Mesopotamian irrigation was small-scale and managed locally. Large state canal systems came after the state formed.
- As a rule: irrigation should *raise carrying capacity, sedentism and the value of territory*, which feeds into circumscription. It should not be a direct trigger for a state. Allow late state-run canal projects as a positive feedback once a state exists.

**Mayshar, Moav & Pascali, "Cereals, Appropriability and Hierarchy"** (JPE 2022, published as "The Origin of the State: Land Productivity or Appropriability?") ([WP pdf](https://warwick.ac.uk/fac/soc/economics/staff/omoav/mayshar_et_al_jpe_2nd_11_oct_2019.pdf), [press release](https://warwick.ac.uk/news/pressreleases/study_sheds_new/)) [V claim; effect sizes not retrieved]
- Hierarchy is predicted by land suitability for cereals *relative to* roots and tubers, not by productivity.
- Cereals are seasonal, storable and easy to see and seize, so they can be taxed. Tubers are perishable and can be left in the ground until needed.
- As a rule: tax base / surplus capture ∝ storable-crop share × harvest seasonality. A highly productive tuber zone (humid tropical Köppen Af/Am) should not form states easily. Their earlier work (Mayshar, Moav & Neeman) adds that "transparency" matters: flood-recession farming makes yields predictable and therefore easy to tax.

**Algaze** (2001, *Current Anthropology* 42:199–234; 2008, *Ancient Mesopotamia at the Dawn of Civilization*, Chicago) ([UCP](https://www.press.uchicago.edu/ucp/books/book/chicago/A/bo5911057.html)) [V argument]
- The "Sumerian takeoff" rested on two things. First, cheap downstream river and canal transport of bulk goods gave southern polities a competitive edge over landlocked rivals. Second, there was an asymmetry: the alluvium exported processed goods (textiles) and imported raw materials (timber, metal, stone), the "Uruk expansion" of colonies upriver at roughly 3500–3100 BCE.
- His other preconditions: high and diverse alluvial productivity (grain, date palm, marsh resources, fish, herds), followed by labour and accounting innovations.
- As a rule: a settlement's market-access potential is the sum of (partner population / water-transport cost). Raw-material deficit plus water access produces trade colonies along rivers toward ore and timber sources.

**Turchin, Currie, Turner & Gavrilets 2013, PNAS 110:16384** ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3799307)). Default parameters come from the SI as encoded in the Alan Turing Institute replication ([GUARD repo](https://github.com/alan-turing-institute/guard), `guard/parameters.py`; Bennett et al. 2019 [arXiv 1903.11729](https://arxiv.org/abs/1903.11729)). [V]
- **Grid and setup:**
  - Afro-Eurasia on a 100×100 km grid with 4-neighbour adjacency.
  - Cell types are agri, steppe or desert. Only agri cells can attack or be attacked; 2,647 agri cells in total.
  - Agriculture spreads on a historical schedule.
  - 1-year step, 1500 BCE to 1500 CE, scored on "imperial density" (a polity of at least 10 cells lasting at least 100 years). Results are averaged over 20 runs.
- **State per cell:** 10 binary "ultrasocial" traits and 5 binary military-technology (MilTech) traits. MilTech starts at 1 in cells bordering the steppe and diffuses with σ = 0.25.
  - GUARD found that in the original code, diffusion is tied to attack attempts, in the attack direction.
- **Attack power:**
  - P_att = 1 + β·Σ(ultrasocial traits over the polity), with β = 1.
  - P_def = the same + γ·elevation(km), with γ = 4; the elevation term is dropped for sea attacks.
  - Win probability = max(0, (P_att − P_def)/(P_att + P_def)). Each cell attacks a random one of its 4 neighbours.
- **Ethnocide** (the winner's traits overwrite the loser's): ε = ε_min + (ε_max − ε_min)·(MilTech/5) − γ₁·elev, clipped to [0, 1].
  - ε_min = 0.05 and γ₁ = 1. ε_max is 1 in the SI but 2 in the original code.
- **Trait mutation:** μ₀₁ = 0.0001, μ₁₀ = 0.002, so traits decay unless selected for.
- **Disintegration:** P = δ₀ + max(0, δ_s·size − δ_a·mean_traits), with δ₀ = 0.05, δ_s = 0.05, δ_a = 2.
- **Sea attacks:** reach d_sea = 1 cell plus Δ per step. Δ = 0.025 in the SI, 0.0025 in the code.
- **Fit (R²):** full model 0.65; no elevation 0.48; no MilTech effect on ethnocide 0.16; MilTech seeded at random rather than from the steppe 0.17.

**Size thresholds** [L, except Alberti]
- Johnson 1982 ("Organizational structure and scalar stress", in *Theory and Explanation in Archaeology*, pp. 389–421): decision-making degrades above about **6 units**, so groups subdivide or add a level of hierarchy. This supports a rule of "one tier per roughly ×6 units."
- Alberti 2014 ([PLoS ONE](https://pmc.ncbi.nlm.nih.gov/articles/PMC3953443)) [V]: Hutterite colonies hit critical scalar stress at **127 people** (95% CI 122–132), with peak fission probability at 158.
- Kosse 1990 (*Journal of Anthropological Archaeology* 9): thresholds at roughly **150** (face-to-face groups), about **500 ± 100** (needs formal leadership), and about **2,500** (needs institutionalized hierarchy). These are the usual band → village → chiefdom → state breakpoints.
- Wright & Johnson 1975: a state is defined by **3 or more levels of administrative hierarchy above the village** (4 tiers of settlement size); a chiefdom has 1–2.
- **Uruk** [V, Wikipedia summarising Van De Mieroop and Nissen] ([Uruk](https://en.wikipedia.org/wiki/Uruk)):
  - Size: about 100 ha around 3200 BCE; walls enclosing about 450–600 ha around 2900–2800 BCE. Contemporary sites were about 10 ha.
  - Population: about 40–50k (up to 80k at peak), with 80–90k in the hinterland.
  - Density: use **100–200 people/ha** for Mesopotamian tells [L, Postgate; Adams].
- **Rank-size (Zipf)** [L]: P_r = P₁/r^q with q ≈ 1. Early Mesopotamia shows *primate* or convex deviations. A primate city emerges when one centre captures transport and redistribution flows.

## 2. Where settlements go

- **Catchment** [L]:
  - Vita-Finzi & Higgs 1970: hunter-gatherer exploitation radius about **10 km (2 h walk)**; farmers about **5 km (1 h)**.
  - Chisholm 1962 (*Rural Settlement and Land Use*): returns to cultivation fall noticeably beyond **about 1 km**, and fields beyond **3–4 km** are marginal.
  - As a rule: farm output is a distance-weighted sum over cells within about 5 km, with weight about 1 at 0–1 km, falling linearly to 0 around 4–5 km.
- **Rain-fed vs irrigated** [L/V]:
  - Rain-fed farming needs **at least 200–300 mm/yr** ([ISAC, Upper Mesopotamia landscape](https://isac.uchicago.edu/node/2500)).
  - Wilkinson 1994 (*Current Anthropology* 35:483) found rain-fed northern Mesopotamian cities capped at roughly **100–120 ha**. The limit came from the size of the field area within walking distance and from rainfall variability. Southern irrigated cities exceeded this (Uruk at 400+ ha), because boats extend the effective catchment.
  - As a rule: max sustainable town size = (field area within about 5 km × yield × reliability) / per-capita need, plus river-imported grain.
- **Water and terrain** [L]:
  - Neolithic and Bronze Age sites sit overwhelmingly within about 1 km of permanent water; use exponential decay with a length of about 0.5–1 km.
  - In alluvium, settle on **levee crests**, which sit 1–3 m above the floodplain, are well drained and lie next to the channel. Avoid back-swamps.
  - Bonuses: confluences, the head of navigation, the edge of a fan or delta, and natural harbours.
  - Defensibility (bluffs, spurs, islands) matters more in contested zones; weight it by local conflict intensity.
- **Spacing** [L/V]:
  - Christaller's central place theory: hexagonal market areas, K = 3 (market), K = 4 (transport), K = 7 (administration). Each higher tier's spacing is √K times the one below.
  - Sumer had about a dozen city-states, bounded by canals and boundary stones ([Wikipedia: Sumer](https://snl.no/Sumer)). Neighbouring centres were typically **about 15–30 km** apart; for example Girsu is about 25 km from Lagash ([Lagash](https://en.wikipedia.org/wiki/Lagash)). That gives a radius of roughly 10–15 km per city territory, i.e. about **one day's round trip**.
  - Adams (*Heartland of Cities*, 1981) traced settlement following shifting Euphrates channels as linear strings of sites, and rapid nucleation into a few large centres in Early Dynastic times, when the countryside emptied. As a rule: when conflict is high, rural population migrates into the nearest walled centre ("ruralization reversal").

## 3. Travel costs and trade

**Tobler's hiking function** (Tobler 1993) [L, standard]
- Walking speed v = 6·exp(−3.5·|S + 0.05|) km/h, where S = dh/dx is the slope. That gives 5.04 km/h on the flat and a peak of 6 km/h at −2.86°.
- Off-path, multiply by 0.6.
- Cost-distance and least-cost paths are then Dijkstra over 1/v. Common refinements:
  - Naismith's rule: about 1 h per 600 m of ascent.
  - Herzog's metabolic cost function for loads.
  - Penalties for crossing rivers, swamps and dense forest.

**ORBIS (Scheidel, Meeks & Weiland 2012)** ([ORBIS v1 pdf](https://orbis.stanford.edu/orbis2012/ORBIS_v1paper_20120501.pdf)) [V]
- **Speeds (km/day):**
  - Ox cart 12; porter or heavily loaded mule 20.
  - Foot, an army on the march, a moderately loaded pack animal, a camel caravan: **30**.
  - Horseback 56; post relay 250.
  - River, downstream: 65 typical; Middle Euphrates 65, Upper Euphrates 75.
  - River, upstream (towing): 15; **Euphrates 10**.
  - Nile: downstream 35–50 normally and 90–100 in flood season (Jul–Oct), with northerly winds allowing upstream sailing.
  - Canals: 15 in both directions.
- **Costs (Diocletian's Price Edict, 301 CE), per kg of wheat per km:**
  - Donkey/camel: **0.028**
  - Wagon: **0.035**
  - River downstream: **0.0034**; upstream: **0.0068**
  - Sea: **0.1 denarii per kg per day** of sailing (Arnaud's rule: 1 denarius per day). Sea charges track *time*, not distance.
- **Implied ratio:** at roughly 100–140 km per sailing day, sea : river-down : river-up : donkey : wagon ≈ **1 : 4–5 : 8–10 : 30–40 : 40–50**.
  - This is my derivation, not a figure stated in the ORBIS paper. The commonly quoted 1 : 4.9 : 28 did not turn up in any source I could check.
  - Duncan-Jones: carting wheat 100 Roman miles overland cost 55% of its value, versus 1.3% by sea ([SJSU summary](https://sjsu.edu/faculty/watkins/rome.htm)).
- **Loads:** donkey about 300 Roman lb (about 97 kg), camel 600 lb (194 kg), wagon 1,200 lb.

**Old Assyrian caravans** (about 1900 BCE) [V, secondary sources]
- Assur to Kanesh is about 1,000–1,200 km, in caravans of 10–50 donkeys ([ANE Today](https://anetoday.org/?p=6841)).
- Larsen (1967, *Old Assyrian Caravan Procedure*) and Veenhof [L]: a standard load was about 65–75 kg (≈130 minas of tin plus textiles), and the trip took about 6 weeks, i.e. about 25–30 km/day.
- Camels as pack animals: Arabia from about 1000 BCE onward; Bactrian later. Gate camels to after about 1000 BCE.

**Sea routes in the Gulf** [V replica data; L history]
- Speed: a reconstructed Magan reed-and-bitumen boat reached up to 5.6 knots in trials ([Smithsonian](https://www.smithsonianmag.com/smart-news/this-bronze-age-ship-replica-made-from-reeds-and-goat-hair-just-sailed-50-nautical-miles-180984728/)).
- Monsoon timing: a planned Oman (Sur) to India (Dwarka) crossing on the monsoon was budgeted at about 15 days ([Penn Museum](https://penn.museum/about/press-room/press-releases/penn-museum-curator-gregory-possehl-sets-sail-beside-the-re-created-reed-boat-qmaganq-following-historic-trade-route-journey-from-oman-to-india)).
- Bronze Age planning values [L]:
  - About 2–4 knots, i.e. 50–100 km per daylight day.
  - Coast-hugging and daylight-only until about the 2nd millennium BCE.
  - Open-water hops limited to roughly 1–2 days or less than about 150 km out of sight of land.
- The Ur → Dilmun (Bahrain) → Magan (Oman) → Meluhha (Indus) chain covered about 3,000 km in stages.
- Indian Ocean monsoon: NE wind Nov–Mar (outbound west from India), SW wind Jun–Sep (toward India; rough at its peak). Persian Gulf: prevailing NW shamal. As a rule: sea-edge cost depends on month and direction.

**Gravity model** [L]: trade flow T_ij = k·M_i^a·M_j^b / C_ij^c, with a, b ≈ 1 and c ≈ 1–2. Use cost-distance C, not Euclidean distance.

**Obsidian fall-off** (Renfrew, Dixon & Cann 1968; Renfrew 1969, 1977) ([MapAspects summary](https://mapaspects.org/book/export/html/1901/index.html)) [V]
- **Supply zone:** within about **300 km** of the source, obsidian makes up more than **80%** of chipped stone; people procured it directly.
- **Contact zone:** beyond 300 km, the share falls off. Renfrew described it as monotonic, often plotted on a log-linear scale. Down-the-line exchange gives roughly exponential decay; the commonly quoted halving every ~25–50 km in the contact zone is [L].
- As a rule: share(d) = 0.8 for d < 300 km, else 0.8·exp(−(d − 300)/λ) with λ ≈ 40–70 km. Directional trade along rivers or coasts flattens the curve.

## 4. Raw materials by tectonic setting [L, except where noted]

| Resource | Tectonic setting | Examples | Timing |
|---|---|---|---|
| **Copper (ophiolite, VMS)** | Obducted oceanic crust in suture zones | Troodos (Cyprus); Semail/Oman ("Magan", [Oman ophiolite](https://www.jstor.org/stable/j.ctvndv6cp.1) [V]); Ergani (Anatolia) | Oman's large-scale production about 3000–2000 BCE |
| **Copper (porphyry, skarn)** | Subduction arcs | Iranian (Urmia–Dokhtar) and Andean arcs | |
| **Copper (native)** | Rift and flood-basalt settings | Keweenaw basalts; Çayönü used Ergani native copper about 8000 BCE | |
| **Smelted / arsenical copper** | Arsenic-bearing fahlore in arc/skarn ores | Belovode (Serbia), first smelting about **5000 BCE** (Radivojević et al. 2010); Nahal Mishmar about 4000 BCE | Arsenical copper dominant about 4000–3000 BCE |
| **Tin** | S-type granites from crustal melting in collision belts and post-collisional plutons | Cornwall/Devon; Erzgebirge (about 2500 BCE claimed, contested); Kestel/Göltepe in the Taurus (3rd millennium BCE, low grade) [V]; Afghanistan and Central Asia (Mushiston) as the main eastern source [V] | Tin bronze sustained across West Asia from about **3000 BCE** (earliest about 3300) [V] |
| **Obsidian** | Young (Neogene–Quaternary) silicic volcanism at arcs, back-arc and continental rifts, rhyolitic hotspots | Göllü Dağ/Nenezi (Cappadocia, arc); Bingöl/Nemrut (eastern Anatolia, collision volcanism); Melos (Aegean arc); Ethiopian Rift; Yellowstone (hotspot) | Old obsidian devitrifies; use vents younger than about 10 Myr |
| **Flint/chert** | Chalk and limestone platforms on passive margins and cratonic basins | Ubiquitous in sedimentary cover; absent on alluvium and young volcanics | |
| **Bitumen** | Oil seeps in foreland basins in front of fold-thrust belts | Hit on the Euphrates, Zagros foreland | |
| **Salt** | Evaporite basins (rift and foreland); salt domes; arid coasts and playas | | |
| **Timber** | Climate rather than tectonics: mountains catching orographic rain | Cedars of Lebanon/Amanus, Zagros oak | Seen from the alluvium, this is upriver or uplift-driven rainfall |
| **Building stone, gold** | Gold: arcs and orogenic belts, placers downstream | Mesopotamia relied on mud brick | |

**Why Mesopotamia traded:** the alluvium is a Quaternary foreland-basin fill with no stone, metal or good timber, only clay, reeds, bitumen and grain. Its abundant storable surplus combined with zero local raw materials produces long-distance trade, which runs over cheap water routes (Algaze). As a rule: a settlement's import demand ∝ elite population × missing materials, sourced via least-cost path to the nearest deposit of the right tectonic class.

## 5. Precedents in simulation

- **Turchin 2013:** see §1 for the full parameters. Code: GUARD (Python, YAML inputs); original in APL.
- **GLUES** (Wirtz & Lemmen 2003, *Climatic Change*; Lemmen, Gronenborn & Wirtz 2011, *Journal of Archaeological Science*) ([arXiv 1104.1905](https://arxiv.org/abs/1104.1905), [DKRZ docs](https://nat-esm-system.dkrz.de/Optional%20Components/GLUES.html)) [V]
  - **685 world regions**, about 8000 BCE to 1500 CE.
  - Each region holds a population density plus 3 average traits: technology, the farming : foraging ratio, and economic diversity (number of domesticates). Traits evolve by adaptive dynamics up the local growth-rate gradient, and spread by diffusion between regions. GPL, written in C and C++.
  - Reproduces the spread rate of farming in Europe and its timing in the Indus.
- **Seshat** (Turchin et al. 2018, PNAS 115:E144) [L]: 51 complexity variables in 9 groups. The first principal component explains about **77%** of variance, i.e. complexity is essentially one-dimensional. Its components include polity population, territory, size of the largest settlement and hierarchy levels. Useful as a validation target.
- **HYDE 3.2** (Klein Goldewijk et al. 2017, *Earth System Science Data*) [L]: gridded population, cropland and pasture from 10,000 BCE at 5′ resolution. World population was about 4.5 million at 10,000 BCE and about 45 million at 3000 BCE. A useful check on carrying capacity.
- **ORBIS:** see §3.
- **MASS / ENKIMDU** (Wilkinson, Christiansen, Altaweel et al., Chicago and Argonne, from 2002) ([UChicago Magazine](https://magazine.uchicago.edu/0612/investigations/next.shtml)) [V]
  - Household agents, daily steps over a 100-year run.
  - Covers rain-fed north versus irrigated south: crops, weather, disease, warfare, kinship.
  - Key finding: *a settlement's sustainability is driven by its most-stressed households, not mean properties*. So simulate a distribution of households, not averages.
- **Village Ecodynamics Project** (Kohler & Varien 2012, *Emergence and Collapse of Early Villages*, University of California Press) [L]
  - Mesa Verde, about 600–1280 CE. Household agents choose farm plots using a paleo-productivity model derived from tree rings, with turkey and deer hunting.
  - Later versions add group formation and hierarchy when group size and food stress pass thresholds. Calibrated to site counts.
- **Azgaar's Fantasy Map Generator** ([repo](https://github.com/Azgaar/Fantasy-Map-Generator), `src/generators/population-generator.ts`, `burgs-generator.ts`) [V code]
  - Suitability score: start from biome habitability, then add:
    - +250 × normalized(river flux + confluence flux)
    - −(height − 50)/5
    - coastal bonuses: estuary +15, ocean coast +5, safe harbour +20, freshwater lake +30, salt lake +10, dry lake −5, lava −30
    - goods bonus
  - Final score s = score/5; rural population = s × cell area / mean cell area.
  - Capitals: candidates sorted by s × U(0.5, 1); minimum spacing = (W + H)/2 / n_capitals, shrunk by ÷1.2 when placement fails.
  - Towns: s × Gaussian jitter, spacing ∝ (W + H)/150 / (n^0.7/66), each test also jittered by Gauss(1, 0.3); spacing is halved when no more towns fit.
  - Population multipliers: ×1.3 for a capital or a port.
- **Dwarf Fortress** [L]: world generation places civilizations by biome preference per race, then runs history with sites growing and being conquered. It is not empirically calibrated, so it gives little for quantitative rules.

**Useful rule chain for your planet** (my synthesis, not a source finding):
1. Carrying capacity K comes from climate, soil and river regime, with a bonus for flood-recession farming.
2. Storable-cereal share sets the taxable surplus (Mayshar et al.).
3. Exit cost and circumscription set the probability that a conquered group is absorbed rather than flees (Carneiro, Allen).
4. Water-transport access sets market reach and trade asymmetry (Algaze, ORBIS).
5. Size thresholds of about 150, 500 and 2,500, plus ×6 per hierarchy tier, add administrative levels (Johnson, Kosse).
6. Inter-polity war uses Turchin's power, ethnocide and disintegration equations, with MilTech seeded from steppe or Köppen BSk cells.
7. Raw-material demand is routed by least-cost path to deposits of the matching tectonic class.

## C. Worldbuilding sources (Worldbuilding Pasta, Artifexian, Madeline James, Worldbuilding Notes, Fractal Philosophy), checked against the literature

I've written the digest below. I read 24 transcripts (about 95k words) and the Madeline James blog posts. Worldbuilding Pasta was checked against its full site map. YouTube rate-limited (HTTP 429) two Madeline James transcripts, Part 4 and Part 12, so I used her matching blog posts instead. The verdicts come from my knowledge of the literature, not fresh lookups, so check exact figures before building on them.

# Worldbuilding sources → civ-layer heuristics

## 1. Worldbuilding Pasta (blog)
**What exists.** The blog has no posts on humans, agriculture, settlement, trade or ore deposits. The site map is at https://worldbuildingpasta.blogspot.com/p/blog-page.html, and Part VIIa says mineral resources are "for another time". What it does have is strong climate, terrain and river material, plus scattered notes on human land use.

- **Bioclimate system:** "Beyond Köppen-Geiger II", https://worldbuildingpasta.blogspot.com/2025/03/beyond-koppen-geiger-climate.html
  - Growing degree-days (GDD), base 5 °C, with daily credit capped at 20 for 25–40 °C and falling to 0 at 50 °C. One growing degree-month = 30 GDD.
  - Thresholds: tundra below about 350 GDD; temperate/boreal boundary at 1,300; above 2,300 means a long season with possible multiple harvests; barren when GDD (base 0) is below 50.
  - Aridity index, actual evapotranspiration over potential (after Prentice): above 0.9 rainforest, below 0.2 arid, below 0.06 hyperarid.
  - Light floor: below about 20 W/m² large plants can't cover respiration.
  - **Verdict: CONSISTENT** with the BIOME family of models (Prentice 1992; Haxeltine & Prentice 1996) and with FAO GAEZ "length of growing period" logic.
  - **NEW:** a better crop-viability gate than Köppen alone. Gate rainfed cereals on GDD plus growing-season aridity, not only annual rainfall (the 200–300 mm rule).
- **"Apple Pie VIb: Biomes"**, https://worldbuildingpasta.blogspot.com/2020/05/an-apple-pie-from-scratch-part-vib.html
  - Crops by zone: Mediterranean → wheat, barley, olive, grape. Humid subtropical → rice, soy. Hot steppe → millet. Savanna → sorghum, yams. Desert floodplains → the Nile, Tigris–Euphrates and Indus cradles. Subarctic → no productive farming. Rainforest → slash-and-burn on leached soils.
  - **Verdict: CONSISTENT** as a coarse rule.
- **"Apple Pie VIIb: Erosion"**, https://worldbuildingpasta.blogspot.com/2022/02/an-apple-pie-from-scratch-part-viib.html
  - Floodplains are the most fertile land, and flood *reliability* matters (Egypt). The Nile floodplain is about 20 km wide.
  - Loess (wind-blown glacial dust carried hundreds to thousands of km) makes good farmland. Young glacial outwash is poor.
  - Deltas: shifting channels hinder settlement and ships.
  - Rias make sheltered ports. River islands make defensible crossings.
  - Endorheic basins (about a quarter of land area) yield evaporites.
  - **Verdict:** loess and alluvium CONSISTENT; LBK farmers settled on loess (Bogaard). The ria and river-island rules are UNVERIFIED but plausible.
  - **NEW:** loess as a soil bonus downwind of former ice sheets.
- **"Apple Pie VIIa: Tectonics"**, https://worldbuildingpasta.blogspot.com/2021/07/an-apple-pie-from-scratch-part-viia.html
  - Volcanic ash soils attract settlement. Foreland basins can be good farmland (Fertile Crescent example).
  - **Verdict: CONSISTENT.** Andosols are fertile; the Zagros foreland is part of the Fertile Crescent.
- **"Hurried Thoughts: You Can't Feed a Society with Mushrooms"**, https://worldbuildingpasta.blogspot.com/2024/01/hurried-thoughts-you-cant-feed-society.html
  - About 90% energy loss per trophic level, and diets of 8–12 MJ/person/day: CONSISTENT.
  - But "≈1 t dry food per person per year" is **CONTRADICTED**. 10 MJ/day is about 3.65 GJ/yr, or roughly 230 kg of grain at ~16 MJ/kg. Archaeological catchment models use about 250 kg grain/person/yr (e.g. Wilkinson's Upper Mesopotamia work). Don't use 1 t.

## 2. Artifexian (YouTube)
The resource videos (Logs 44–48) are the most useful material from any of these sources. Note that Artifexian builds them largely from Madeline James's guides and personal notes from Worldbuilding Pasta's author.

- **"Fuel & The Copper Age – WL45"**, https://www.youtube.com/watch?v=z38GgH8En3E
  - **Tree line:** 4,000 m between 30°N and 30°S, then minus 130 m per degree for 20°, then minus 75 m per degree. No wood in BW/BS, ET or EF climates. Peat where Cfb/Dfb/Dfc/subarctic climates overlap the last glacial ice sheets.
    - **Verdict: PARTLY.** Körner & Paulsen 2004 put tree line at a growing-season mean of about 6.4 °C. Dry subtropical tree lines go higher (about 4,600–4,800 m), so latitude bands are a poor proxy.
    - **Change:** Orogen has monthly temperatures, so use the temperature threshold directly.
    - **NEW / changes rules:** a **fuel layer** (forest → charcoal, peat). Add from the literature: in treeless river valleys, dung and reed were real fuels (Mesopotamia, Andes). Artifexian's "no fuel in BW/BS" is too strict for floodplains.
  - **Copper by period and deposit type.** The copper-rich zone is the whole deformation zone of young active ranges, plus old ranges only sparsely (erosion has stripped them). LIP, rift and hotspot mountains are excluded.
    - Native copper (cold-hammered, no smelting) in carbonates around basaltic LIPs and hotspots.
    - Secondary-enrichment native copper and oxides over volcanogenic massive sulfide (VMS) deposits in collisional or back-arc settings. He applies this only in seasonally dry tropical/subtropical climates and excludes anywhere with winters below 6 °C.
    - Arsenical copper near coal or old shallow-sea carbonates.
    - **Verdict:**
      - Native copper at flood basalts: CONSISTENT. The Keweenaw basalts of the Midcontinent Rift fed the "Old Copper" culture.
      - Early use of oxidised and native ores before sulfides: CONSISTENT (Roberts, Thornton & Pigott 2009; Radivojević et al. 2010, smelting at Belovode about 5000 BCE).
      - The climate gate is PARTLY right: supergene enrichment favours semi-arid climates with a falling water table (Sillitoe 2005). The snow exclusion is his own invention.
    - **NEW:** LIP/hotspot native copper as a pre-smelting tier, and secondary-enrichment caps (gossans) as the first smelted ores.
  - Gold placers downstream of rhyolite or andesite in active ranges, richest where glaciers retreated or rainfall is high. **Verdict: CONSISTENT.**
- **"The Bronze Age – WL46"**, https://www.youtube.com/watch?v=OFaf-f_XY6I
  - VMS deposits in collisional orogens are the main Bronze Age copper. Sedimentary-exhalative (sedex) deposits sit over old back-arc shallow seas. Skarns form where igneous rock meets carbonate. He skips porphyry as too low-grade for early mining.
  - Tin belts sit in collisional orogens with felsic rock, with **alluvial tin downstream**.
  - Arsenic halos around igneous rock make **arsenical bronze, which is more widespread than tin-bronze**.
  - **Bronze potential = (As-Cu ∪ Sn-Cu ∪ Cu+Sn in one trade region) ∩ fuel**, with fuel tradeable uphill.
  - **Verdict:**
    - Arsenical bronze first: CONSISTENT (Lechtman 1996; Thornton 2010).
    - Tin from S-type granites and placers: CONSISTENT (Lehmann 2021). Placer streaming dominated ancient tin (Cornwall, Erzgebirge, Central Asia).
    - Porphyry too low-grade: PARTLY. Oxidised porphyry caps were worked in places.
  - **Changes your list:** add **placer tin downstream of granite belts**, an **arsenic-copper tier before tin**, and a fuel intersection. Tin travelled thousands of km in reality (Near East tin from Central Asia; Berger et al. 2019 isotope work). Make tin a long-range trade good, not a local requirement.
- **"The Iron Age – WL47"**, https://www.youtube.com/watch?v=d3VKSjEZwSw
  - Bog iron forms in low wetlands downhill of metal-bearing ranges. Marine oolitic ironstone, in former warm shallow seas, is the dominant type. Iron laterites form on LIPs in the wet-dry tropics. Meteoric iron: about one per continent. Large Iron Age cultures need **fuel ∩ iron**.
  - **Verdict: CONSISTENT.** One figure I'm adding: bloomery iron took roughly 10 kg or more of charcoal per kg of iron (Crew 1991), so wood is binding.
- **"Salt – WL48"**, https://www.youtube.com/watch?v=g3a0wXxsDTo
  - Coastal salt by solar evaporation in arid or semi-arid climates, and by boiling elsewhere (needs fuel).
  - Salt flats in arid depressions over old lake sediments; very large ones only in tectonically active regions.
  - Rock salt in old shallow-sea evaporites at about 20–33° palaeolatitude, minable only where later uplift or diapirs brought it to the surface (Zagros salt glaciers).
  - **Verdict: CONSISTENT** (Harding 2013, *Salt in Prehistoric Europe*).
  - **Refinement from research:** brine springs above buried salt were early centres. Provadia-Solnitsata (about 4700–4200 BCE) was a fortified salt town; Hallstatt was a mined salt centre.
  - **NEW:** a salt layer is missing from your list entirely. It is a strong pull for trade nodes in cereal-eating societies.
- **"Rocks – WL44"**, https://www.youtube.com/watch?v=HQ4NeMNap_0
  - Mask past shallow seas: land now at 0–200 m elevation counts as former sea unless its mountains are younger. Carbonates sit in old shallow seas, sandstone in areas that were never sea. **Verdict: PARTLY.** It's a crude proxy. Useful only because flint, limestone, evaporites and oolitic iron depend on it.
- **"Humans – WL49"** and **"You Fixed My Humans – WL50"**, https://www.youtube.com/watch?v=DSq8rhuWTq4 and https://www.youtube.com/watch?v=roZCzp6HcNE
  - Mostly setting decisions specific to his world. The transferable claims:
    - Deltas form only where big, wet basins drain into protected bays. **Verdict: PARTLY**: delta presence depends on sediment flux against wave and tide reworking (Nienhuis et al. 2020).
    - **Upwelling coasts lead to fishing economies.** **Verdict: CONSISTENT** with Moseley 1975 (*Maritime Foundations of Andean Civilization*).
    - A rain-shadowed volcanic island as the civilization core: UNVERIFIED.
  - **NEW:** upwelling coasts as a hot spot for dense sedentary foragers.
- **"Where Metals Are Found On Fantasy Worlds"**, https://www.youtube.com/watch?v=b9qvQspSbWc
  - Most young ore lies on the overriding plate of subduction zones and at hotspots.
  - Epithermal gold zones run outward: Au+Ag+Cu, then Au+Ag+Pb+Zn, then Au+Ag+Hg.
  - Iron oxide copper-gold (IOCG) deposits sit in rifts and old crust. Ni-Cu, platinum, chrome and diamonds sit in cratons.
  - Mississippi Valley-type (MVT) lead-zinc can lie hundreds of km across foreland basins from its source.
  - **Verdict: CONSISTENT.** This overlaps your existing tectonic-ore list.
- **"Atlas Map 7: Borders, Cities & Towns"** and **"Atlas Map 9: Transport"**, https://www.youtube.com/watch?v=cZkeLdZoKTg and https://www.youtube.com/watch?v=li-L_jyEkTo
  - Map-styling conventions only. No placement, spacing or transport-cost rules.

## 3. Madeline James Worldbuilds (YouTube and blog)
- **"Part 4: Mapping Early Civilizations / Antiquity"** (blog version), https://www.madelinejameswrites.com/blog/antiquity; video https://www.youtube.com/watch?v=rWAMiUPUF5o
  - **State placement as an overlay:**
    1. Grain-crop climate ∩ good soil (loess or alluvium).
    2. ∩ navigable flat rivers or calm enclosed seas.
    3. ∩ circumscription by desert, mountain or ocean.
    4. Do **not** found states in deltas or wetlands.
  - **Crops by climate:** rice in Am/Cfa/Cwa/Dwa/Dwb, especially irrigated foothills. Wheat, barley and maize in Cs/Cw/Dfa/Dfb.
  - **Taxable crop:** visible ripening, predictable harvest, storable. Tubers are poor taxable crops.
  - Sedentism appears first in rich wetlands and at the edges of game-migration routes.
  - **Nomadic or seafaring "twin"** next to each state.
  - Agriculture predates states by about 4,000 years. Most people lived in states only from about 1600 CE.
  - Sources: Scott, *Against the Grain*; Flannery & Marcus.
  - **Verdicts:**
    - Overlay and circumscription: CONSISTENT; matches Carneiro and Mayshar et al., already on your list.
    - **Avoid deltas and wetlands: CONTRADICTED for Sumer.** Pournelle (2003; 2013) and Algaze (2008) argue that Ur, Uruk and Eridu grew on levees inside a deltaic marsh. Marsh fish, reeds and dates, plus cheap boat transport down a branching river network, drove the "Sumerian takeoff".
    - **Change:** let deltaic levee-and-marsh mosaics score high for proto-cities.
    - State/nomad twins: CONSISTENT (Barfield 1989, *The Perilous Frontier*; Turchin 2009, "A theory for formation of large empires"). **NEW.**
- **"Part 1: Cultural Divides and Physiographic Regions"**, https://www.youtube.com/watch?v=f-MRoDN4IfA
  - Culture boundaries run along ocean, fast steep rivers, mountain edges (where hills turn steep, not the ridge line), deserts and steppe.
  - A climate barrier with no geographic barrier lets trade through but blocks expansion.
  - Big floodplains inside deserts are separate farming centres.
  - **Farming spreads east–west**, along bands of similar climate (Diamond).
  - **Verdict:**
    - East–west spread: PARTLY to CONSISTENT. Laitin, Moortgat & Robinson 2012 (PNAS) find cultural traits spread more easily along latitude.
    - Physiographic boundaries: PARTLY.
    - Implementation: modulate your 1 km/yr Fisher-KPP spread by *climate similarity to the crop's origin*, not by direction as such.
- **"Part 2: Migration, Extinctions, Available Animals"**, https://www.youtube.com/watch?v=sP8HKK3c1Zo
  - Humans originate in savanna with gallery forest along rivers, 30°N–30°S. They spread along coasts and rivers and across low-sea-level land bridges.
  - Extinction of animals over 44 kg by continent: Africa 21%, Eurasia 35%, North America 72%, South America 83%, Australia 88% (Koch & Barnosky 2006).
  - The later humans arrive, the more megafauna die and the fewer domesticates and draft animals remain.
  - **Verdict:**
    - Koch & Barnosky figures: CONSISTENT. The link to domesticates is PARTLY right (Diamond; Larson & Fuller 2014).
    - "Domestication takes about 10 generations" is **CONTRADICTED** for crops: non-shattering cereals took about 2,000 years or more (Purugganan & Fuller 2009). It is also too fast for most animals (Zeder 2012).
- **"Part 3: Domesticated Animals and Beasts of Burden"**, https://www.youtube.com/watch?v=mGyzxnxsia8
  - Diamond's 14 large domesticable mammals and his 6 criteria.
  - Habitats:
    - Sheep and goats: highlands.
    - Cattle: open grassland and woodland.
    - Pigs and water buffalo: warm, wet ground.
    - Horses: open plains.
    - Camels and donkeys: deserts.
    - Llamas and alpacas: high, dry or cold uplands.
    - Yaks: high plateaus.
    - Reindeer: taiga and tundra.
  - Draft animals enable plough and wheel. Pack animals dominate where there are no roads.
  - **Verdict: CONSISTENT** as a coarse rule.
  - **NEW:** a domesticate-availability map (biome × extinction severity) that gates the plough, wheeled transport and pastoralism.
- **"Part 5: Empires, Democracy, Bureaucracy"**, https://www.youtube.com/watch?v=mdN9xDZfXjM
  - Councils disappear above about 25 people per square mile, roughly 10/km² (Stasavage).
  - Writing plus compact intensive agriculture leads to bureaucracy and autocracy. Cheap exit means less hierarchy.
  - **Empire size caps by era** (Taagepera; Scheidel):
    - 3000–600 BCE: about 1 million km² at most.
    - 600 BCE–600 CE: about 3–6.5 million km².
    - Peripheral empires: 100–300 thousand km².
  - **Verdict:**
    - Taagepera: CONSISTENT. Useful as a calibration target for your Turchin model.
    - The Stasavage threshold is the source's own figure, not independently checked: UNVERIFIED. It is **NEW** as a governance-type switch.
- **"Part 7: Age of Sail"**, https://www.youtube.com/watch?v=Hw1u93d8aw4
  - Wind belts: doldrums and about 30° calms; trade winds (about 5–30°) for sailing west; westerlies (30–60°) for sailing east. Coastal routes first.
  - Slavery where land is plentiful and labour scarce.
  - **Verdict:**
    - Wind belts: CONSISTENT.
    - Slavery rule: CONSISTENT; this is the Nieboer–Domar hypothesis (Domar 1970).
  - For your Bronze Age layer, add monsoon wind reversal as the key early open-water enabler (Arabian Sea / Gulf trade with Meluhha). That comes from the literature, not her.
- **"Part 8: Challenges and Adaptations"**, https://www.youtube.com/watch?v=CCYMEg5o0SI
  - Plough agriculture brings a stronger gender division; hoe agriculture less.
  - Rugged terrain means weak state reach. Inca relay runners covered up to about 250 miles/day.
  - **Verdict:**
    - Plough and gender: CONSISTENT (Alesina, Giuliano & Nunn 2013).
    - Terrain friction: CONSISTENT (Scott 2009, *Zomia*).
    - Relay speed: CONSISTENT (Hyslop, about 240 km/day).
- **"Currency and everything that came before"**, https://www.youtube.com/watch?v=v_X3xP9awss
  - Gift economy before barter. Exchange follows social distance: gift with kin, neutral exchange further out, theft with strangers.
  - **Sumer was first to a commodity economy because it lacked essential goods.**
  - Obsidian as proto-money from about 12,000 BCE.
  - Silver was the unit of account, with payment in barley (Hammurabi). A shekel was about 0.4 oz.
  - **Verdict:**
    - Reciprocity by social distance: CONSISTENT (Sahlins 1972; Graeber 2011). **NEW** as a trade-mode rule.
    - Sumer's resource deficit driving trade: CONSISTENT (Algaze).
    - Obsidian as *money*: UNVERIFIED. Exchange, yes (your Renfrew fall-off rule).
    - Shekel weight: PARTLY. It is about 8.3 g (0.29 oz).
- **"Part 12: Ore Deposits by Era"** (blog version), https://www.madelinejameswrites.com/blog/deposits-and-gemology-extended
  - Bronze Age economic copper grade was about 10–15%, against about 0.3% today.
  - About 99% of tin deposits are tied to felsic rocks.
  - Dates (Hauptmann): copper smelting from about 5400–4500 BCE, Bronze Age onset about 4000–3500 BCE, Iron Age about 1200 BCE.
  - Flint from carbonates and riverbeds, obsidian from rhyolitic provinces.
  - Sedex lead-zinc in rift and passive-margin basins; MVT at basin edges near evaporites.
  - **Verdict: CONSISTENT.**
  - **NEW:** the ore-grade threshold. Only weathered, enriched caps count before about 1000 BCE.
- **Madeline James Writes** (@madelinejameswrites): writing and craft vlogs only. Nothing relevant.

## 4. Worldbuilding Notes (YouTube)
- **"Forager Forge: The Hunter-Gatherer Diet"**, https://www.youtube.com/watch?v=z4RGd4q6kXM
  - Diet mix follows effective temperature and primary production. Desert foragers gather up to 85% of their food (Kalahari). Arctic foragers gather about 0% and live by hunting and fishing.
  - Optimal foraging "diet breadth": rank resources by kcal per handling minute, add lower-ranked items only when search costs rise (worked example: 17.5 vs 21.6 kcal/min). Foragers leave a patch when its return rate drops.
  - **Verdict:**
    - Diet by effective temperature: CONSISTENT (Binford 2001; Marlowe 2005).
    - Diet breadth: CONSISTENT (MacArthur & Pianka 1966; Charnov 1976).
  - **NEW:** a hunting/gathering/fishing mix by effective temperature. And a farming-adoption trigger: adopt cultivation when crop return rates beat declining forager return rates (Winterhalder & Kennett 2006).
- **"Hunters and Toddlers"**, https://www.youtube.com/watch?v=Mf98B51WRE8
  - Forager women have 4–5 births with spacing of several years (Kalahari). **Verdict: CONSISTENT** (Blurton Jones 1986).
  - **Research add (NEW):** the Neolithic Demographic Transition. Fertility rose with farming (Bocquet-Appel 2011), while health and stature fell (Scott; Mummert et al. 2011). Use it for a growth-rate bump at farming adoption.
- **"Bird Island: The Size of Every Village"** and **"Story World: Hills, Rivers, Towns"**, https://www.youtube.com/watch?v=-6hL5SjHdOg and https://www.youtube.com/watch?v=1cQBrY9FFoo
  - **Zipf rank-size:** the town at rank n has population P₁/n. Her worked example: 100 villages, 22,400 people, largest 4,318.
  - Largest village at the mouth of the largest river (salmon), then by river size.
  - Towns need drinking water, arable land and a resource.
  - Ore is processed at the mine, carried down to lowland foothill river towns, then shipped on by boat.
  - **Verdict:**
    - Zipf: PARTLY. Early systems are often primate or convex: Uruk dwarfed every other site (Johnson 1980/1987; Adams).
    - **NEW:** settlement scaling. Settled area grows as roughly N^(2/3) (Ortman et al. 2014, pre-Hispanic Basin of Mexico). Use it to turn population into footprint.
    - Mine → foothill river-town → boat chain: CONSISTENT as a pattern.
- **"Artisans Without Cities"**, https://www.youtube.com/watch?v=fiMsCO5i3Dg
  - Itinerant craftspeople settled once demand was high enough, and cities grew around them. The book she cites is almost certainly Jane Jacobs, *The Economy of Cities* (1969).
  - **Verdict:**
    - Cities before farming: CONTRADICTED. Domestication predates Çatalhöyük-type towns.
    - Itinerant smiths before workshop nucleation: PARTLY. That pattern is attested for Bronze Age metalworkers.
- **"The Division of Labour"**, https://www.youtube.com/watch?v=Ra1yKsCJ0ow
  - New Guinea is an independent agricultural centre, about 10,000 years old (taro, banana, sago). **Verdict: CONSISTENT** (Kuk Swamp; Denham 2003).
  - Implication: tuber and tree-crop farming arises in humid tropical highlands but rarely produces states. This fits Mayshar's appropriability argument.

## 5. Lower-priority channels
- **Fractal Philosophy, "Simulating the Evolution of Empires"**, https://www.youtube.com/watch?v=1p3tMNbFdCs
  - The same kind of project as yours: a tectonic planet generator plus a history simulation.
  - Model: each tile holds a solidarity value (Turchin's "asabiya"). It rises on borders with other empires and decays inside. Power is summed over tiles and **decays with distance from the capital**. Higher power takes a tile. Tiles with neutral high solidarity spawn new empires.
  - Problems he found:
    - The border-driven version freezes at chokepoints.
    - A group-selection version (Price equation, internal vs external competition) churns too fast.
    - Both "slide" across terrain unrealistically.
  - **Verdict: PARTLY.**
    - Metaethnic frontiers do predict large polities (Turchin 2003 *Historical Dynamics*; Turchin et al. 2013).
    - The asabiya dynamics themselves are weakly tested.
    - Distance decay is Boulding's loss-of-strength gradient (1962).
  - **NEW** relative to your Turchin 2013 entry: per-tile asabiya plus a loss-of-strength gradient, and his warning about both failure modes.
- **Historia Civilis, Kilroy's Kartography, Overly Sarcastic Productions, Hello Future Me:** not reviewed (time and rate limits). They are narrative or cartographic and unlikely to add rules.
- **Suggested extra source, not on your list:** Bret Devereaux's ACOUP blog, "Bread: How Did They Make It?" and "Resources for World-Builders" (https://acoup.blog/resources-for-world-builders/). It has seed:yield ratios, household labour and tax-take numbers, and is better sourced than any of the channels above.

## What's new or would change your rules
1. **Sumerian cities in deltaic marsh:** don't penalise deltas. Score levee-and-marsh mosaics high, and model cheap boat transport down a branching river network (Pournelle; Algaze).
2. **Salt layer:** coastal pans in BW/BS climates, brine springs over buried evaporites, uplifted or diapiric rock salt, playas. Salt draws early fortified trade nodes.
3. **Fuel layer:** a forest/charcoal/peat budget, plus dung and reed in treeless floodplains. Use a growing-season-temperature tree line. Bronze and iron output ∝ ore ∩ fuel.
4. **Metallurgy tiers:**
   - Native copper at flood basalts and LIPs (cold-hammered).
   - Weathered oxide caps in semi-arid climates (first smelting).
   - Arsenical copper (widespread).
   - Tin-bronze needing placer tin downstream of collisional granites, traded thousands of km.
   - Ore-grade threshold of about 10%.
5. **Domesticate availability** (biome × megafauna-extinction severity) gates plough, wheel and pastoralism, and with it the nomadic "mirror empires" on the steppe frontier.
6. **Diffusion weighted by climate similarity** to the crop's origin (east–west effect).
7. **Aquatic and upwelling resources** produce dense sedentary foragers (Moseley; Binford's aquatic thresholds). Add a fishing share to the NPP density rule. Mix foraging strategies by effective temperature.
8. **Crop gate:** Pasta GDD and aridity plus a Köppen crop map (rice vs wheat/barley/millet) and a soil bonus (loess, alluvium, andosols).
9. **Demography:** a Neolithic fertility bump with worse health. Size distribution: Zipf with primacy allowed. Footprint ∝ N^(2/3).
10. **Polity rules:** about 10/km² as a council/autocracy switch (Stasavage, unverified). Era-based empire area caps (Taagepera). Asabiya plus a loss-of-strength gradient.
11. **Trade mode by social distance** (Sahlins). Resource-deficit cores (no timber, stone or metal) drive long-distance trade (Algaze). Monsoon reversal for early open-water routes.
12. **Corrections:** use about 250 kg grain/person/yr, not 1 t. Domestication takes millennia, not 10 generations. Ignore cities-before-farming (Jacobs).

