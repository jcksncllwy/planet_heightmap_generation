# Nation layer — states, empires and nations on an Orogen planet

**Goal:** carry the civ layer's polities on from the first states to a world of territorial states, empires and (at
the end) nations. They should have borders that move, zones of influence that wax and wane, contested frontiers, and
a life story for each polity. Each rule is a mechanism from the literature. No rule scripts an outcome. **Acceptance:**
on Earth's own ground, its numbers fall within the record's ranges: polity lifetimes, the size of the largest polity
over time, the number of polities, where the great empires arise, and how far borders follow terrain. Those ranges are
bug checks, not targets (Earth is N of 1). On generated worlds, the same rules give worlds that differ for reasons a
player can read.

Status: spec only (2026-11-26, branch `nationspec`, from main 4e80c7f). No code. Sources and how far each was checked:
[NATION_SOURCES.md](NATION_SOURCES.md), whose marks are those of CIV_SOURCES.md, plus **[A]** for a source seen only
through its abstract or a summary. Decisions for Jackson: §14.

**Jackson's input (2026-11-26):**
- "Spec out what a nation layer would look like … an extension of the civilization layer, but essentially later in
  history"; research how nation-states form and evolve, and how to model it.
- On the views: "borders and zones of influence, contested areas, etc." Each comes from a model quantity, not from a
  drawing rule (§10).

---

## 1. What the layer is, and where it joins the civ layer

### 1.1 What the civ layer has today

`v2/js/civ/polity.js` (CIV_PLAN §5.5; Phase 4, second slice):
- every 100 years (`polityStepYears`), it takes the towns `settle.js` finds in that century's people;
- it gathers them into polities by war between neighbours. It uses Turchin et al. 2013's odds, with power growing with
  people and fading with land-km from the capital (Boulding), and the defender gaining 4 per km of height;
- a beaten town is absorbed only where its people can't leave (Carneiro's circumscription, as an exit cost). A taken
  capital brings its whole polity;
- collapse is likelier the more towns a polity holds, and famine shocks add to war and collapse;
- a polity holding the three tiers above the village is a **state** (Wright & Johnson 1975).

What it doesn't have:
- **Territory:** a polity is a set of towns. The land between them is no one's.
- **Persistence:** a polity's identity is a number. It has no name, no ruler, no institutions and no past.
- **Capacity:** power is head-count. Nothing is taxed, nothing pays an army, and reach is land-km, not days.
- **Identity:** there are no cultures or languages, so assimilation, frontiers and nationalism have nothing to act on.
- **Feedback:** polities don't touch the people. There are no war deaths, no state canals and no refugees
  (CIV_PLAN §8 item 6).
- **Time resolution:** a century is longer than most chiefdoms last (55–68 yr in Gavrilets et al. 2010's model), half a
  large polity's median time near its peak (130 yr, Taagepera 1997), and four or five reigns.

### 1.2 Proposal: polity.js grows into the nation layer (one polity model, chiefdom to nation-state)

**Recommended: one polity model, grown in place.** The same entities live from the first chiefdom to the last nation-state.
"Chiefdom", "state", "empire", "territorial state" and "nation-state" are **labels read off the polity's variables**,
as CIV_PLAN §9 made "forager" and "farmer" labels read off the diet. The reasons:
- **The seams.** CIV_PLAN §9 retired the civ layer's switches because "each fix in this file has patched a seam between
  two of those switches". A separate "nation stage" handed polities from polity.js would be that seam again: when does a
  polity cross, what becomes of its towns, which code owns a war between a crossed and an uncrossed one?
- **The record is continuous.** Political complexity rises and falls in small steps (Currie et al. 2010, 84 Austronesian
  societies [A]). Seshat's 414 polities lie along one dimension of complexity (PC1 77 % of the variance; Turchin et al.
  2018 [V]). Nothing in the record marks a break between an early state and an empire.
- **The mechanisms are the same ones, at larger reach.** War and its odds, distance decay, collapse and absorption are
  already in polity.js. The nation layer adds the variables they lack (territory, revenue, cohesion, identity) and the
  mechanisms that act on those variables.

Alternatives, not recommended:
- **(B) A new stage after polity.js.** Simpler to start, and polity.js stays untouched. But it means a hand-over rule and
  two war models, and Earth's continuity can't be checked across the seam.
- **(C) A post-process on the civ run's frames.** Cheapest, and it can't break the people. But it can never feed back
  (no war deaths or refugees), and frames come every 500 years (`frameYears`).

### 1.3 Where it runs

- Inside `sim.js`'s loop, where `pol.step(...)` runs now: the same mesh (the page's 160K, ~56 km cells; the tools' own),
  the same deterministic hashed chances, the same per-step inputs (density, way of life, K, famine).
- New modules under `v2/js/civ/nation/` (names provisional):
  - `nation-config.js`: every constant, with its source;
  - `realm.js`: the polity state and the step, grown out of polity.js;
  - `reach.js`: influence, administration and borders (§7.1);
  - `identity.js`: cultures, languages, assimilation and cohesion;
  - `succession.js`;
  - `chronicle.js`: events and life stories;
  - `names.js` (optional, §14 Q3).
- polity.js keeps its API (`step`, `packed`, `packedPolities`, `counts`), so the page and the tools keep working. It
  becomes the nation layer with its later mechanisms switched off.
- **Fingerprints.** As in C0 and D: each stage lands behind an option, and the civ fingerprints
  (`civ-fingerprint.mjs`) stay byte-identical with it off. A stage that changes the people (N4) goes on by default once its
  checks pass (Jackson, 2026-11-26).

## 2. Time span and step

**Span.** The layer runs from the first polity, as polity.js does now (on Earth the first states are at ~6–5 ka; on
the ensemble the median first state is at 6.5 ka). It runs to the civ run's end and on, as far as asked (`advance(toBP)`
already runs past 0 BP). **Recommended horizon: the agrarian world.** On Earth that is ~3000 BCE to ~1800 CE: city-states
to agrarian empires and early-modern territorial states. National identity comes as a final stage, switched on by the
state of the world rather than by a date (§7.8). The reasons:
- The civ layer's people are agrarian. Their numbers stop at what fields, herds and fish feed (Earth's civ run: ~224 M
  at 0 BP, about the world of 1 CE). There is no industrial growth, steam, railway or mass schooling.
- Every mechanism here comes from the agrarian and early-modern record. The modern drivers need a technology and
  economy layer the civ layer lacks: mass literacy and print (Anderson), industrial society's standard culture (Gellner),
  industrial war, global decolonization norms. Building that layer is a program of its own (§14 Q1).
- Earth's own clock: Taagepera 1997 [V] finds three jumps in polity size, ~3000 BC, ~600 BC and ~AD 1600. The first two
  belong to the agrarian world. The third, the early-modern and colonial one, sits at the horizon.

**Step: 25 years**, `sim.js`'s own generation (`stepYears`), with events drawn as hazards inside the step and dated
within it, for the stories. The reasons:
- About one reign. Mean tenure is 21.6 yr under primogeniture, 12.4 under election and 9.1 under agnatic seniority
  (Kokkonen & Sundell 2014, 961 European monarchs [V]). Successions need a step near a reign.
- Polity.js's century is too coarse: chiefdoms last 55–68 yr (Gavrilets et al. 2010 [V]), and a large polity holds
  half its peak for a median 130 yr (Taagepera 1997 [V]).
- Finer steps cost more and resolve nothing the inputs carry. The models that run yearly or two-yearly (Turchin et al.
  2013; Bennett 2022, 2 yr [V]; Fernández-Villaverde et al. 2023, 5 yr [V]) run on rectangles or hexes with fixed
  productivity. Ours read people who change only every 25 years.
- Conquest within a step can still run fast. A front may take several cells in a step, as far as the army's reach in
  days allows (§7.2), so a Mongol-like rise in a few decades is possible.

Cost: 5000 years is 200 steps (§11.3).

## 3. The research: how states and nations form and change

For each strand: what is **established** (replicated, measured), what is **contested**, and what is **just-so**
(narrative fitted to one case). Marks: [V] read in the primary source, [A] abstract or summary only, [L] a standard
figure not yet checked. Full rows are in NATION_SOURCES.md.

### 3.1 From chiefdoms and early states to territorial states, empires and their breakup
- **Established:**
  - Complexity rises and falls in small steps (Currie et al. 2010 [A]).
  - Seshat's complexity variables move together: scale, hierarchy and government (Turchin et al. 2018 [V]).
  - Chiefdoms cycle: they grow by conquest and collapse fast. In Gavrilets, Anderson & Turchin 2010 [V]'s model, the
    ten most significant complex chiefdoms live < 55–68 years on average, leaders rarely last 20–30 years, and rank-size
    curves are convex. Anderson 1994 describes the same cycling in the Mississippian record [L].
  - The state as ≥ 3 levels of hierarchy above the village (Wright & Johnson 1975) is a working definition, already in
    polity.js.
- **Established (Taagepera 1997 [V], 78 large polities):**
  - Large polities hold half their peak for a median 130 years, unchanged over 5000 years. Only 16 lasted 300 years or
    more.
  - Duration and rise time go together: D ≈ 25·R^0.5 (years), median D/R ≈ 3.
  - Empire lifetimes are about exponential: λ = 0.46 per century, mean ~220 yr, over 41 empires of 3000 BCE–600 CE
    (Arbesman 2011 [V], on Taagepera's data). A memoryless hazard is the null model.
- **Contested:** why collapse happens.
  - Diminishing returns on complexity (Tainter 1988 [A]). Bardi et al. note it isn't quantitative.
  - Demographic-structural pressure: population against land, elite overproduction (Turchin & Nefedov 2009 [A]; Bennett
    2016's model [V]).
  - Climate shocks (Zhang et al. 2007; already in polity.js).
  - All three have support. Their relative weight is open.
- **Just-so:** single-cause collapse stories for particular empires.

### 3.2 War and state capacity (Tilly and the bellicist debate)
- **The claim.** "War made the state, and the state made war": competition among European states selected for those
  that could tax and field armies (Tilly 1990 [L]). The counts usually quoted from Tilly, ~500 units in 1490 falling to
  ~25–30 by 1900, were **not found** in the chapters checked (one review gives ~200 in 1500; §4 uses Abramson's
  measured data instead).
- **Established mechanism (in models and some data):**
  - Fiscal capacity is an investment. It rises with common-interest needs such as external war and with inclusive
    institutions (Besley & Persson 2009 [A]).
  - The Military Revolution raised war's cost, and divided states dropped out (Gennaioli & Voth 2015 [A]).
  - The steppe threat to China came from one direction. That favoured empire, while Europe's several smaller threats
    favoured fragmentation (Ko, Koyama & Sng 2018 [V]).
- **Contested, and important for us:**
  - Bellicism doesn't travel. Latin America's wars were limited and debt-financed and built no strong states
    ("limited war, limited states"; Centeno 2002 [A]). Africa's low densities made holding land too costly, so states
    broadcast power from cores (Herbst 2000 [A]).
  - Abramson 2017 [V] finds that small units thrived in Europe until 1790, and that cities and economic activity
    explain where states formed better than war does.
  - So war is one driver among several, and its effect depends on density and on what can be taxed.
- **Design consequence.** War builds capacity only where there's surplus to tax and the land is worth holding (§7.2,
  §7.3). That makes Herbst's and Centeno's cases outcomes of the same rules, not exceptions.

### 3.3 The size of states (Alesina & Spolaore) and the empire-size record (Taagepera)
- **Alesina & Spolaore 1997 [A]:**
  - States' sizes trade the economies of scale of public goods and defence against the cost of a heterogeneous
    population.
  - More trade openness (economic integration) and democratization mean more, smaller countries.
  - Established as a model. Testing it is hard (Lake & O'Mahony 2004 [A]: average state size nearly doubled 1816–1876,
    then fell).
- **Taagepera 1997 [V], the largest polity:**

  | Period | The largest polity |
  |---|---|
  | before ~3000 BC | no polity over 0.01 Mkm² |
  | ~3000 BC | unified Egypt, 0.25 Mkm² |
  | up to ~650 BC | never over 1.1 Mkm² (0.3–1 % of the dry land) |
  | after ~650 BC | never under 2.3 Mkm² |
  | 500 BC–AD 1600 | records from Achaemenid Persia (5.5 Mkm²) to the Mongols (24 Mkm²), 5–20 % of the dry land |
  | after 1600 | 15–25 % (the British Empire 35.5 Mkm² in 1920) |

- **The effective number of polities by area** (Taagepera 1997 [V]): ~10,000 in empire-building phases of the first
  2400 years (beyond 100,000 in breakdowns), ~600 to 30 over 500 BC–AD 1600, under 30 since 1800, 24 after 1991.
- **Megaempires** (≥ 1 Mkm²): at least 60 of them, 3000 BCE–1800 CE, and over 90 % arose in or next to the Old World's
  arid belt, at steppe frontiers (Turchin 2009 [A], journal abstract).
- **Orientation:** the 62 largest empires are elongated east–west more than north–south (Turchin, Adams & Hall 2006 [A]).
  This is consistent with Diamond's axes, and with Laitin et al. 2012 [L] on cultural diffusion.

### 3.4 Cliodynamics: metaethnic frontiers, asabiya, the Seshat data
- **The theory** (Turchin 2003, *Historical Dynamics*, ch. 4 and App. A2 [A via Bennett 2016]):
  - Cohesion (Ibn Khaldun's *asabiya*) grows on frontiers with culturally distant others (metaethnic frontiers) and
    decays in the safe interior.
  - A polity's force is its regions' asabiya projected to its borders, falling with distance.
  - Large polities break up when their combined asabiya falls below a threshold.
  - Exact equations unverified: the book's appendix wasn't read. Bennett 2016 gives the rules in prose. The aspatial
    reduction (dA/dt = cSA(1−A/h) − a; dS/dt = r(1−A/2b)S(1−S)) is from a later arXiv paper.
- **Turchin et al. 2013 [V main text]:**
  - Model: 100 × 100 km cells over Afro-Eurasia, 1500 BCE–1500 CE; military technology seeded at the steppe's edge and
    diffusing; ultrasocial traits; conquest odds (P_a − P_d)/(P_a + P_d); elevation for the defender; disintegration
    δ₀ + δ_s·size − δ_a·traits.
  - Results: R² 0.65 against maps of polities > ~100,000 km² every 100 years. Without military technology's
    diffusion, 0.16.
  - Parameter values are in its SI, not checked (polity.js uses γ = 4 [L]).
- **Bennett 2022 [V]:**
  - Adds logistics from a central depot, demographic-structural civil war, and nomadic confederations (strike zone 200
    km, nearly tripling to 550 km). 2-year steps.
  - Results: 73 % of the spatial variance. Too many small states before 1000 CE; too few of the very large (> 3 Mkm²).
- **Seshat** (Turchin et al. 2022 [V]): agricultural productivity (with a lag) and military technology, iron weapons and
  cavalry above all, are the strongest predictors of social scale. Agriculture is necessary but not sufficient.
- **Contested:**
  - Asabiya is hard to measure independently of the outcome it explains. The metaethnic-frontier test is Turchin's own.
  - Seshat's coding is debated (the moralizing-gods paper of 2019 was retracted; not used here).
  - The war-and-space retrodiction is strong evidence that *geography plus diffusing military technology* matters.
    It is weaker evidence for asabiya itself.

### 3.5 Natural frontiers and geography (Diamond and others; critics)
- **Diamond 1997** ch. 16 [A]: Europe's indented coasts, peninsulas and mountains favoured many states; China's smooth
  coast and open core favoured unity. Narrative, and partly just-so.
- **Fernández-Villaverde, Koyama, Lin & Sng 2023 [V of the WP]** test it in a model:
  - 65,641 hex cells of 28 km radius (a day's walk), 5-year periods. Conflict is at a border, with odds by the polities'
    summed productivity and geography. One cell is annexed per win; secession is at borders.
  - Results: China centralizes (Herfindahl > 0.5 after ~300 periods, → 1); Europe stays fragmented (~0.2 at 500).
  - Either rugged terrain or a high-productivity core (the North China plain) is sufficient. Neither is necessary.
- **Kitamura & Lagerlöf 2020 [A]:** Europe's borders 1500–2020, and where they ran along mountains and rivers.
- **Ko, Koyama & Sng 2018 [V]:** the direction of threats matters as much as the terrain.
- **Scheidel 2019 [A]:** no empire of Rome's scale ever re-formed in Europe. Its competitive fragmentation had several
  causes (geography, ecology, inheritance customs, distance from the steppe).
- **Status:**
  - Established: geography shapes fragmentation, through productivity cores and travel costs as much as through
    mountains as walls.
  - Contested: the size of the effect, and whether it works through borders or through cores.
  - Just-so: "Europe's coastline made democracy".
- **For us, this is ideal:** terrain, cores and steppe are all on the planet. The model's job is to let them act through
  travel cost and productivity, never through a "mountains are borders" rule.

### 3.6 Fiscal and administrative capacity and the reach of the state
- **Loss of strength:** power falls with distance from its base (Boulding 1962 [A]: the "loss-of-strength gradient").
  It falls in travel time, not km. ORBIS (Scheidel 2014) makes Rome's reach a matter of days by season [L, CIV_SOURCES].
- **Distance and representation:** distance limited representation and monitoring:
  - assemblies were easier to sustain in compact polities (Stasavage 2010 [A]: European boundaries and populations
    1250–1750);
  - in a large state, distance raises the cost of monitoring officials, who then extort; size hastened Qing decline
    (Sng 2014 [A]).
- **Terrain and the state** (Scott 2009 [A]):
  - States run out of breath with distance and altitude: the "friction of terrain".
  - Zomia, the highlands above ~300 m from central Vietnam to northeast India, held people who kept away from states.
  - States tax what is legible and storable: grain, not tubers (Scott 2017; Mayshar, Moav & Pascali, already in
    CIV_PLAN §5.5).
- **Fiscal levels:**
  - Premodern take: the "~5–10 % of output" commonly cited was not found in Monson & Scheidel 2015 [A].
  - Per-capita revenue gaps between European states and the Ottomans opened in the 1600s–1700s (Karaman & Pamuk 2010
    [A]; their numbers not read).
  - Taxation's level is therefore a parameter to set from the Earth test, not a sourced number yet.
- **Established:** distance decay of control, and the legibility of the taxed. **Contested:** the functional form
  (exponential in days is our choice; Boulding's was linear) and the take's level.

### 3.7 Language and ethnicity: diffusion, assimilation, nationalism
- **Diffusion:**
  - Language families spread with farmers (Bellwood & Renfrew's farming/language dispersal [L]). The civ layer's
    fronts already carry a lineage (`cameFrom`, `farmFrom`).
  - Language density follows latitude and the growing season: more, smaller languages in the tropics (Mace & Pagel
    1995 [A]: ~6× from south to north in North America; Nettle 1998 [A]).
  - An ethnolinguistic group's area grows with its political complexity, which is the strongest predictor after
    climate controls (Currie & Mace 2009 [A]).
- **Assimilation** (Abrams & Strogatz 2003 [V]):
  - dx/dt = c[(1−x)·x^a·s − x·(1−x)^a·(1−s)], where x is the speakers' share and s the language's status.
  - a = 1.31 ± 0.25 across 42 regions (Wales, Scotland, Peru, Bolivia, Ireland, Alsace-Lorraine).
  - Two languages don't coexist stably in it. The lower-status one dies, at a rate set by s.
  - Established as a fit to decline curves. Contested as a law: bilingualism, and later models with a < 1 for
    coexistence.
- **Nationalism:**
  - Gellner 1983 [L]: industrial society needs a standard high culture, so polity and culture come to coincide.
  - Anderson 1983 [L]: print capitalism made "imagined communities".
  - Deutsch 1953 [A]: mobilization (into communication networks) against assimilation, two rates.
  - Weber 1976 [V]: in 1863 French was not spoken in 8,381 of France's 37,510 communes, "about a quarter of the
    population". The nation was made after the state, by schools, roads and conscription.
  - Smith 1986 [L]: nations have older ethnic cores (ethnosymbolism).
  - Established: nation-states are recent and were made by states as much as states were made by nations.
  - Contested: modernist (Gellner, Anderson) against ethnosymbolist (Smith) accounts. Both agree on a late, rapid
    switch.
- **When nation-states arise** (Wimmer & Feinstein 2010 [A]; 145 states, 1816–2001): a nation-state is likelier when a
  power shift lets nationalists overthrow or absorb the old regime, and with diffusion from neighbours or within the
  same empire. A world-wide model's hegemony is a poor predictor of single cases.

### 3.8 The Westphalian system, colonial borders, decolonization, secession and unification
- **Westphalia** as the founding of sovereignty is a later myth (Osiander 2001 [A]). Exclusive linear territory spread
  with mapping and was depicted before it was practised (Branch 2014 [A]). Before that, authority was zonal:
  - Thongchai 1994 [A]: a small polity could pay tribute to two or more overlords and stay sovereign, and some land was
    no one's, a buffer;
  - Wolters 1982 [A]: overlapping *maṇḍala*, "circles of kings";
  - Tambiah 1977 [A]: the galactic polity;
  - Lattimore 1940 [A]: the steppe frontier as a gradation, not a line.
  - **This is the record's own case for zones of influence and contested areas (§10).**
- **Colonial borders:**
  - They split ethnic homelands: 229 of 825 African groups (27.7 %) have ≥ 10 % of their homeland in more than one state
    (Michalopoulos & Papaioannou 2016 [V of the WP]). Conflict is ~40 % likelier in partitioned homelands.
  - Alesina, Easterly & Matuszeski 2011 [V of the WP] measure artificiality by border fractal dimension (most borders
    1.000–1.100) and by the share of people in partitioned groups.
  - Prior boundaries shape later territorial claims (Abramson & Carter 2016 [A]).
- **The number of states:**
  - Correlates of War members [V, counted from states2016.csv]:

    | 1816 | 1850 | 1900 | 1914 | 1920 | 1945 | 1950 | 1960 | 1970 | 1980 | 1990 | 2000 | 2016 |
    |---|---|---|---|---|---|---|---|---|---|---|---|---|
    | 23 | 39 | 42 | 45 | 59 | 64 | 75 | 107 | 134 | 156 | 165 | 191 | 195 |

  - Counting non-European polities too (the ISD): ~134 in 1816, then a fall [A], and 482 states over 1816–2016 in its
    second version [V codebook]. The 19th century's fall is the colonial absorption of Asian and African polities that
    COW never counted.
  - UN members: 51 in 1945, 193 in 2011 [V].
- **Decolonization** came in waves driven mainly by conditions outside the dependency (Strang 1991 [A]). **Unification**
  of co-national fragments (Italy, Germany) and **secession** of national minorities are the two faces of the national
  principle (Cederman 2002 [A]: in GeoSim, national unification destabilizes the balance of power).
- **For us:** Westphalia, colonization and decolonization are modern-horizon matters (§14 Q1). Zonal authority, tribute
  and overlapping claims are agrarian ones, and they are in scope.

## 4. Quantitative regularities a model can be checked against

The ranges are **bug checks**: a run far outside them has a bug or a missing mechanism. They are not targets to fit
(the agent brief's "Earth is N of 1"). Where a number depends on the era, compare the same era of the run.

| Regularity | Earth's record | Source | Mark |
|---|---|---|---|
| Large polities' time above half their peak | median 130 yr (78 polities), unchanged over 5 kyr; 16 of 78 ≥ 300 yr | Taagepera 1997 | [V] |
| Duration vs rise time | D ≈ 25·R^0.5 yr; median D/R ≈ 3 | Taagepera 1997 | [V] |
| Empire lifetimes | ~exponential, λ = 0.46 /century, mean ~220 yr (41 empires, 3000 BCE–600 CE) | Arbesman 2011 | [V] |
| Chiefdom lifetimes (model) | < 55–68 yr for the most significant complex chiefdoms | Gavrilets et al. 2010 | [V] |
| Largest polity's area | 0.25 Mkm² ~3000 BC; ≤ 1.1 to 650 BC; ≥ 2.3 after; 5.5 → 24 Mkm² 500 BC–AD 1600 | Taagepera 1997 | [V] |
| Size jumps | ~3000 BC, ~600 BC, ~AD 1600 | Taagepera 1997 | [V] |
| Effective number of polities (by area) | ~10⁴ early; ~600 → 30 over 500 BC–AD 1600; < 30 after 1800 | Taagepera 1997 | [V] |
| Megaempires (≥ 1 Mkm²) | ≥ 60 in 3000 BCE–1800 CE; > 90 % in or by the arid belt | Turchin 2009 | [A] |
| Elongation | 62 largest empires lean east–west | Turchin, Adams & Hall 2006 | [A] |
| Where large polities arise | the war-and-space model's R² 0.65 (Turchin 2013), 0.73 (Bennett 2022) against 100-yr maps | Turchin et al. 2013; Bennett 2022 | [V] |
| European state sizes | median ~15,100 km² in 1100, falling over 1100–1790 (to a few hundred km² by our arithmetic); small states survived better | Abramson 2017 | [V] |
| Cities and fragmentation | +14–20 % states per doubling of urban population | Abramson 2017 | [V] |
| States in the system | COW: 23 (1816), 42 (1900), 64 (1945), 107 (1960), 195 (2016); ISD ~134 (1816) | COW v2016; Griffiths & Butcher 2013 | [V]/[A] |
| Borders on rivers | 23 % of international borders; 17 % of provincial; 12 % of county-level | Popelka & Smith 2020 (NASA summary) | [A] |
| Border wiggliness | fractal dimension 1.000–1.100 for most land borders | Alesina, Easterly & Matuszeski 2011 | [V] |
| Partitioned homelands (Africa) | 27.7 % of groups have ≥ 10 % of homeland in another state | Michalopoulos & Papaioannou 2016 | [V] |
| War sizes | power law, α = 1.53 ± 0.07 above 7061 battle deaths (95 interstate wars 1823–2003) | Clauset 2018 | [A] |
| Reigns | mean tenure 21.6 yr (primogeniture), 12.4 (election), 9.1 (agnatic seniority); deposed 16/49/57 % | Kokkonen & Sundell 2014 | [V] |
| Violent royal deaths | ~22 % of 1513 European monarchs, 600–1800 | Eisner 2011 | [A] |
| Language shift | Abrams–Strogatz exponent a = 1.31 ± 0.25 | Abrams & Strogatz 2003 | [V] |
| Language area vs complexity | complexity the strongest predictor of an ethnolinguistic group's area | Currie & Mace 2009 | [A] |
| Language density | ~6× denser in the south than the north of North America | Mace & Pagel 1995 | [A] |

Of these, the lifetimes, the largest polity's curve, the steppe-frontier share, the river-border share and the war-size
exponent need no Earth-specific map and can be read off any world (§11.1).

## 5. Existing models, and what carries over

| Model | What it is | Results | What carries over | What doesn't |
|---|---|---|---|---|
| Turchin et al. 2013 (PNAS) | 100 km grid of Afro-Eurasia, 1500 BCE–1500 CE; ultrasocial traits; military technology from the steppe; conquest odds; elevation; disintegration | R² 0.65 vs maps of large polities; 0.16 without MilTech diffusion | the odds (already in polity.js); MilTech as a diffusing know-how from herders' frontiers; elevation for defence | traits as abstract bits; fixed agricultural map; a grid in place of travel time |
| Bennett 2016, 2022 (Cliodynamics; PLOS ONE) | Turchin 2013 + logistics from a central depot, demographic-structural civil war, nomadic confederations; 2-yr steps | 73 % of spatial variance; too many small states before 1000 CE, too few > 3 Mkm² | logistics as reach from a centre; civil war from population pressure; confederations of herders with long strike reach | Earth-specific seeding of the steppe (ours comes from the herders the economy finds) |
| Turchin 2003 asabiya (*Historical Dynamics*, App. A2) | asabiya grows on frontiers, decays inside; force projected to borders with distance decay; collapse below a threshold | rise-and-fall cycles on an abstract rectangle | cohesion as a per-cell field driven by metaethnic frontiers (§7.4) | the rectangle; the equations unchecked |
| Gavrilets, Anderson & Turchin 2010 (Cliodynamics) | villages on a hex grid; hierarchical polities with span of control; conquest, secession, tribute | stochastic cycling; chiefdom lives < 55–68 yr; convex rank-size | hierarchy levels from conquest (our tiers); a chief's time in power (τ) as the key parameter; a lifetime check | villages as equal units |
| Cederman 1997, 2002 (GeoSim, *Emergent Actors*; PNAS) | a grid of primitive actors; states as emergent hierarchies; attack thresholds 2–3; defensive alliances; nationalism as cultural strings (8 traits × 25 values) | power-law war sizes in some regimes; nationalism steepens them; unification destabilizes | emergent states from local conquest; alliances; nationalism as a later layer on culture; war-size distribution as a check | abstract square world, no geography |
| Artzrouni & Komlos 1996 (Historical Methods) | a "predatory" spatial model of Europe: wars far from the centre are harder to win | the European state system's basic features (500–1800) [A] | distance-to-centre decay as the shape-maker | details unread |
| Abramson 2017 (Int. Org.) | not a simulation: a dataset of every European state 1100–1790 | small states thrived; cities explain fragmentation | the Earth check of sizes and counts; that towns (trade) can hold their own as city-states | — |
| Fernández-Villaverde et al. 2023 (QJE) | 28 km hexes of Eurasia, 5-yr periods; border conflict by productivity and terrain; secession | China unifies, Europe doesn't; terrain or a productive core suffices | productivity cores and terrain acting through conflict odds; secession at borders; the Herfindahl check | one cell per win; no culture |
| Kohler et al. 2012 (Village Ecodynamics) | households' farm, hunt and settle choices; public-goods game; leadership | leaders pay off past a group size | that hierarchy emerges where groups pass a size, already the civ layer's tiers | household level, far below our scale |
| Azgaar's Fantasy Map Generator | cultures and states expand from centres by accumulated cost (biome, height, rivers, coasts) | legible fantasy maps | the legibility of cost-distance territories; that a pure cost-expansion gives plausible borders | one-shot, no time; costs are artistic |
| Dwarf Fortress world history | civilizations, sites, wars and figures over a run of years; Legends mode browses maps and histories | the touchstone for generated history players read | a chronicle of events with dated, named actors; a map you can scrub through history | individual-level agents; no sourced mechanisms |
| Crusader Kings III | characters; succession laws (partition, primogeniture…); de jure vs de facto realms | stories from succession | partition as a mechanism of breakup; de jure (claims) vs de facto (held) map modes | character simulation |
| Europa Universalis IV / Victoria 3 | provinces; cores and overextension; subjects; spheres of influence | readable strategy maps | claims from long holding (cores); costs of holding non-core land; subjects tinted by overlord; spheres as a map mode | player-driven, balanced for play |

**What carries over, in short:**
- the odds and the elevation term (already in polity.js);
- military technology as a diffusing know-how (Turchin 2013, Seshat);
- reach from a centre in travel cost (Boulding, Artzrouni & Komlos, Bennett's logistics);
- cohesion born on frontiers (Turchin 2003);
- breakup by succession (CK) and by demographic pressure (Bennett);
- claims from long holding (EU's cores; Abramson & Carter);
- a dated chronicle (Dwarf Fortress).

**What doesn't carry over:**
- abstract grids and traits;
- Earth-specific seeding;
- player-balance mechanics (EU's monarch points, the AI's aggression knobs).

## 6. State variables

**Per cell** (on the civ mesh; most change only every step):

| Variable | Meaning | Type |
|---|---|---|
| `owner` | the polity that administers it, or −1 (no state) | Int32 |
| `suzerain` | the polity it pays tribute to, if it isn't administered (zones, §7.1), or −1 | Int32 |
| `held` | generations held by `owner` (for claims) | Uint8 |
| `claim` | the polity holding a claim on it (a past long-time owner), and since when | Int32 + Float32 |
| `culture` | its people's culture (a node of the culture tree) | Int32 |
| `shift` | the share speaking the ruling culture, where it differs (Abrams–Strogatz's x) | Float32 |
| `asabiya` | cohesion, 0–1 (Turchin 2003) | Float32 |
| `milTech` | known military kinds, bits (chariot, cavalry, iron) | Uint8 |

**Per polity:**
- identity: id, name (§14 Q3), founded, ended, how it began (founding, secession, partition, rebellion), how it ended;
- capital (cell, and its history), seats (the towns that administer: its tier-2+ towns);
- ruler: reign start, succession rule (partible, elective, seniority, primogeniture);
- the ruling culture;
- revenue, army, administrative capacity κ (days of reach, §7.3);
- legitimacy (0–1), cohesion (asabiya, people-weighted);
- relations: wars (with start and front), alliances, overlord and subjects;
- the record: area, people and revenue per step, for its card and the checks.

**What it reads each step from the civ run** (as polity.js does): density, way of life, crop, K, famine, towns. It
also reads the travel graph (`routes.js`) once.

## 7. Mechanisms, each with its sources

The ordering in a step:
1. reach;
2. revenue and capacity;
3. war;
4. succession and collapse;
5. rebellion and secession;
6. identity: assimilation, cohesion and MilTech;
7. the record.

Hazards are 1 − e^(−rate·25 yr), with the same hashed chances polity.js uses, so runs stay deterministic.

### 7.1 Reach: influence, administration, borders and zones (the quantity behind every view)
- **Influence.** Polity p's influence at cell c is I_p(c) = F_p,s · e^(−t_s(c)/τ), the best over p's seats s.
  - F_p,s is the force p can bring from seat s: its army, shared over its seats by their revenue (§7.3).
  - t_s(c) is travel days from s to c on `routes.js`'s graph, in the campaign season (the months armies move: ours),
    on foot or by the polity's craft.
  - τ is the loss-of-strength scale in days (Boulding 1962; in time, not km, after ORBIS). Our exponential replaces
    Boulding's linear gradient, so that influence never goes negative.
- **Computing it, cheaply.** Since log I = log F − t/τ, the polity with the most influence at each cell is a single
  multi-source Dijkstra over the travel graph: every seat starts at key −τ·log F_p,s (an additively weighted Voronoi
  diagram in travel time). Keeping the best two labels per cell gives the second-strongest polity too. That is one pass
  per step for all polities, not one per polity.
- **The border is where two influences are equal.** Boulding's analysis puts the line between two powers where their
  strengths are equal (his exact wording is unchecked).
- **Administration.** Cell c is administered by p, so `owner` = p, where both of these hold:
  - p is the strongest there;
  - administering pays: the tax c yields exceeds the cost of collecting it. Yield is the surplus of its farmers
    (density × the taxable share of their food, the storable crops; Mayshar, Moav & Pascali; Scott 2017). Cost rises
    with days from the nearest seat, against the polity's capacity κ.
  - This is Herbst's and Scott's point as a quantity: thin or untaxable people (herders, foragers, tuber farmers, the
    hills) aren't worth administering, however strong the state.
- **Zones of influence** (tribute, vassals, spheres): where p is strongest but administering doesn't pay, and its
  influence beats the local power, c is p's tributary (`suzerain` = p).
  - The local power is the local polity's force, or for the stateless, the people's own (density × asabiya).
  - Where a local polity exists, it is p's vassal: it pays tribute and keeps its ruler (Thongchai's tributaries; the
    maṇḍala).
  - Where none exists, its people are raided or pay tribute: a frontier.
  - **Spheres of trade dominance** come with T2's flows: a town most of whose trade runs to p's towns is in p's sphere
    (needs civ T2; §13).
- **Contested.** Three kinds:
  - **Disputed:** the second polity's influence is close to the first's. Close means the strongest would win a war
    there with odds under a set level (Turchin's (P₁ − P₂)/(P₁ + P₂) < w_c, with each side's fortune). The margin
    therefore comes from the war model's own uncertainty, not from a drawing width.
  - **Fronts:** cells where a war of this step was fought, or that changed hands.
  - **Claims:** cells held for ≥ N_core generations by a polity that lost them (EU's cores; CK's de jure; Abramson &
    Carter 2016: older boundaries shape later claims). A claim fades after N_claim generations without a try.
  - Cells under more than one tribute (Thongchai's two or more overlords) are contested zones too: their top two
    polities both exceed the local power.
- **No-state land:** where no polity's influence beats the local power. It is Scott's non-state space, and what is
  left of it over time is an output (§10).
- Every one of these is a comparison of model quantities: force, days, surplus, collection cost and war odds. None is
  drawn.

### 7.2 War and conquest
- **Who fights:** neighbours (polities whose influence regions touch), at a hazard that rises with the pressure of
  people on land (Carneiro 1970; polity.js's rule, kept) and with the attacker's power ratio. Cederman's attack
  threshold of 2–3 makes wars against equals rare.
- **The odds:** Turchin et al. 2013's (P_a − P_d)/(P_a + P_d), with P = 1 + β·(army × asabiya × MilTech factor) ×
  e^(−t/τ) at the front, the fortune of war as now, and the defender +γ·elevation. Turchin's A2 uses force as
  asabiya × size. Seshat 2022 has iron and cavalry the strongest predictors of scale.
- **What is taken:**
  - the front's cells, as far as the attacker's campaign reach in days allows this step. It's a march, not one cell
    per win (Fernández-Villaverde et al.) and not one town (polity.js);
  - a taken capital brings the polity, as now;
  - Carneiro's exit cost still decides whether the beaten are absorbed or move away.
- **Nomads:** herders' polities (Life.HERDER) fight with long reach (Bennett 2022's strike zone 200 km, 550 km for
  confederations). They take tribute rather than administer (§7.1: herders' land isn't worth administering, but
  farmers' land within their reach pays tribute). A steppe confederation's force grows with the farmed states it
  borders: Turchin 2009's mirror empires, and the check that > 90 % of megaempires arise by the arid belt.
- **Its cost:** soldiers killed, a share of the army per year at war (N4 writes them into the people). Battles' deaths
  are kept for the war-size check (Clauset 2018).

### 7.3 Revenue, capacity, fragmentation and succession
- **Revenue:** the tax of administered cells, plus tribute from zones, plus tolls on trade (T2), less collection cost.
  The rate θ is a parameter to set on Earth: the sourced premodern take wasn't found (§3.6).
- **Army:** revenue over a soldier's cost (his food: the same grain the town's people eat).
- **Capacity κ:** the days from a seat within which collecting tax pays.
  - It grows by investment, which a polity makes when its external threat is high: the influence of rivals at its
    borders against its own (Besley & Persson 2009; Gennaioli & Voth 2015).
  - It decays slowly otherwise. Ko, Koyama & Sng's one-sided threat and Europe's many-sided ones then make different
    outcomes from the same rule.
- **Overstretch:** monitoring costs grow with days from the capital. Far provinces yield less (agents' extortion)
  and resent more, adding to the rebellion hazard (§7.5). Sng 2014; Stasavage 2010.
- **Succession:**
  - Each ruler's reign ends at a hazard set by the succession rule, from Kokkonen & Sundell 2014's tenures: 21.6
    years under primogeniture, 12.4 under election, 9.1 under agnatic seniority.
  - At a succession, a **partible** rule divides the realm among heirs: two to four parts, along its seats' regions (the
    Frankish partitions; CK's partition; Scheidel 2019 on inheritance customs).
  - An elective or seniority rule risks a **crisis**: deposition with the source's shares (49 %, 57 %, against 16 %
    under primogeniture), and a civil war that may split the realm in two along its top two seats.
  - Rules are inherited by successor states and copied from neighbours (contested; primogeniture spread across Europe
    1000–1800).
- **Collapse:** the hazard rises with three things:
  - population pressure held over time (density near K for generations means elite overproduction; Turchin & Nefedov
    2009; Bennett 2016);
  - famine shocks (as now: Zhang et al. 2007; Hsiang et al. 2013);
  - low cohesion (Turchin 2003: below a threshold of combined asabiya).
  - Polity.js's "the more towns, the likelier" (Turchin 2013's δ_s) stays as the base.
  - A collapsed realm breaks into its seats' regions, not into single towns.

### 7.4 Identity: culture, language, assimilation, cohesion and military technology
- **Cultures and their tree come from langspec** (CULTURE_PLAN §7.1–7.4 and §7.9; seam §7.4a). The earlier
  placeholder here (daughters at landings and after a tuned T_split out of contact) is retired: in langspec's model
  splits emerge from contact and drift, and there is no T_split.
- **Assimilation moves to the culture layer** (CULTURE_PLAN's shift rule, Abrams & Strogatz 2003). The nation layer
  doesn't shift anyone's language. It supplies the inputs:
  - status s for the ruling culture, from the polity's hold (administered over tributary) and the share of its people
    in towns and in the seats;
  - conquest settlement (who moved where).
  - langspec sets the rate c on Kandler et al.'s Celtic series and Weber's France. Conquered cultures fading where
    states last and hold tight, and surviving in hills and zones, is then langspec's output, read back through the seam.
- **Cohesion (asabiya):**
  - A cell's asabiya grows logistically where it lies on a **metaethnic frontier**: within D_f days of people of a
    distant culture. Distant means a long time since the two were one people (langspec's MRCA age, §7.4a), or a
    different way of life (herders against farmers:
    the steppe frontier).
  - It decays where the cell is safe inside.
  - A polity's cohesion is its people-weighted mean. It multiplies its force (§7.2) and holds off collapse (§7.3).
  - Turchin 2003 (rules from Bennett 2016's prose; equations to check).
- **Military technology** (Turchin et al. 2013; Seshat 2022): chariot, cavalry and iron are know-how bits.
  - They are born where their means exist: riding needs domesticated herds (econ's D) at a farm–steppe frontier; iron
    needs ore (resources.js, T4).
  - They spread cell to cell by contact, and are never lost.
  - Seeded by the land, not by Earth's map.

### 7.4a The seam with langspec (culture and language)

Jackson (2026-11-26) put culture and language in a lane of their own, langspec: spread, evolution, differentiation and
blending. The nation layer owns none of that model. §7.4's culture tree, assimilation rule and T_split are this
plan's **placeholder** for it, kept only to say what the nation layer needs. Where langspec's model differs, langspec's
model wins.

**What the nation layer reads from langspec,** each step, on the civ mesh (amended 2026-11-26 from langspec's report and
Jackson's culture answers, §14):
- **culture per cell** (CULTURE_PLAN §8.1): `lang[c]`, a language id from langspec's tracked tree, and `family[c]`;
  where two mix, the rival's language and its share x (for §7.5's minorities and §7.8's homogeneity). Ids stay stable
  across frames by overlap matching, and a split gives daughter ids, so a realm's ruling culture can be followed
  through a split. The nation layer reads the **language** level; dialects (Jackson: two levels) are for display.
- **culture per town,** for seats, capitals and a polity's ruling culture;
- **distance between two cultures:** d(a, b), the lexical distance on langspec's 40-meaning list, from 0 (the same) to 1
  (unrelated), later mixed with the ~16 customs once culture L5 exists; and alongside it the **MRCA age**, how long
  since the two were one people. Metaethnic frontiers (asabiya, §7.4) use the MRCA age; legitimacy after the national
  stage (§7.8), unification (co-cultural means d below a level) and minorities use d. Religion is not in d: it waits
  for langspec's religion revision (§14).
- **names** (CULTURE_PLAN L3): for a culture, a deterministic generator of place, people and realm names, drifting down
  the tree, **plus exonyms** (what a neighbour calls a realm). Personal names (rulers, dynasties) are not here; they
  belong to a later "story" layer.
- **ancestry** (langspec's check layer, L2) is not read by the nation layer, but it uses the conquest settlement the
  nation layer gives, so aDNA checks see conquest.

**Writing is not langspec's** (Jackson, 2026-11-26): it is a know-how in the civ economy's skills model (§13), which
§7.8's mobilization reads.

**What the nation layer gives langspec** each step:
- per cell: the administering polity, its suzerain and the hold (administered, tributary or none);
- per polity: its ruling culture, its seats and towns, and conquest settlement (who moved where);
- the status a culture gets from ruling (Abrams–Strogatz's s), as the input to langspec's shift rule (§7.4).

**Order:** both run inside sim.js's step, realm then culture. Each reads the other's state from the last step, so the
run stays deterministic.

### 7.5 Rebellion and secession
- A province (a seat's region) rebels at a hazard that grows with:
  - its distance in days from the capital (overstretch);
  - the tax it pays against what it gets: tribute out, no defence;
  - famine shocks;
  - its own cohesion, where it differs from the realm's;
  - after the national stage, its cultural distance from the ruling culture.
- The rebellion's odds are the war odds between the province's force and the realm's at that distance. A win makes it
  a polity of its own (a secession), with the province's seat as capital.
- Chiefdom cycling (Gavrilets et al. 2010; Anderson 1994) is this rule at small scale.

### 7.6 Trade and alliances
- **Alliances by the balance of threat** (Walt 1987):
  - Two polities ally when a third's influence at both their borders exceeds each one's own. Threat is power ×
    proximity, which the influence field already is.
  - An alliance adds allies' force to a defender's at the front, and ends when the threat passes.
  - Cederman's GeoSim has defensive alliances in this spirit.
- **Trade** waits for T2's flows: Wilson's spatial interaction, already designed in CIV_PLAN §10.4. With it come:
  - tolls on flows through a polity (revenue);
  - **spheres** (§7.1);
  - the capital-intensive path: Tilly's trading cities, with revenue from trade and not land. City-states and leagues
    can hold their own against territorial states (Abramson 2017's cities; Spruyt 1994's competitors).

### 7.7 Migration
- **Defeat:** where exit cost is low, the beaten move away rather than be absorbed (polity.js's rule, kept). With N4,
  they move as people, into the nearest free farmland.
- **Conquest settlement:** a polity's ruling culture settles new seats (towns founded or taken), so it spreads faster
  than assimilation alone would carry it.
- **Nomad incursions:** herders' polities moving into farmed land they conquer (Bennett 2022's confederations).
- The movement itself is `sim.js`'s. The nation layer only adds the pushes. The effect is visible only from N4.

### 7.8 The national stage: identity becomes political
- **The switch.** Each polity has a mobilization index M:
  - its towns' share of its people;
  - the know-how of writing, read from the civ economy's skills model (§13; born in states old enough, spread by
    contact);
  - how quickly its towns reach each other, in days.
  - Where M passes M*, culture enters legitimacy (Deutsch 1953's mobilization; Anderson's print; Gellner's standard
    culture).
  - It is a state of the world, not a date. A world that never urbanizes never gets nationalism.
- **After the switch:**
  - legitimacy rises with the share of its people of the ruling culture. Multi-cultural realms get rebellion pressure
    from their minorities (§7.5);
  - co-cultural neighbours get a **unification** hazard. The war or merger odds are raised by a shared culture
    (Cederman 2002: unification destabilizes the balance);
  - assimilation speeds up: the ruling culture's status rises with schools (Weber 1976).
  - Wimmer & Feinstein 2010: nation-states form when a power shift lets nationalists in, and diffuse among neighbours.
    Both are already hazards here, since a power shift is a collapse or a lost war.
- **Without a technology layer, M is a stand-in.** It is the stage most open to the charge of rules over mechanism, and
  it lands last (§12, N6; §14 Q1).

### 7.9 Out of scope by default
- Westphalian sovereignty as a norm.
- Overseas colonial empires, and decolonization.
- Industrial war.
- These need the modern horizon (§14 Q1). Some pieces would carry over: the civ layer's voyaging (who can reach
  whom), disease.js's cold filter (the germs that made the Americas' contact catastrophe) and the culture tree
  (partitioned homelands).

## 8. What it reads from the planet and the civ layer

| Input | From | Use |
|---|---|---|
| Travel days by month and craft | `routes.js` (T0), the planet's winds and currents | reach (τ), campaign reach, contact for culture and MilTech, seats' monitoring |
| Elevation, slope | the finish (`w.z`) | defender's gain (γ), travel cost (Tobler, through routes.js) |
| Rivers (navigable), coasts | the finish; `settle.js`'s network | travel cost (cheap along, through routes.js); river borders arise where crossing costs and the far bank's influence meet. A river network for basins is CIV_PLAN §8 item 4 |
| Climate shocks | `climate-var.js` through famine | collapse, war, rebellion |
| Long climate change | not yet (CIV_PLAN §8 item 5) | the African Humid Period's end and others as pressure on states |
| People, way of life, crop, K | `sim.js` each step | taxable surplus, army's base, pressure, herders as nomads, farmers as the administered |
| Towns and tiers | `settle.js` | seats, capitals, the state label, mobilization |
| Who came from whom | `sim.js`'s `cameFrom`, `farmFrom`, `coastBP` | the culture tree |
| Ores | `resources.js` | iron for MilTech (T4) |
| Herds' domestication | `econ.js` (D, milk at D 2) | riding, cavalry |
| Trade flows | T2 (not built) | tolls, spheres, trading cities |

## 9. Outputs

- **Per step:**
  - owner, suzerain, claim and contested state per cell (stored as changes, §11.3);
  - each polity's record: area, people, revenue, army, cohesion, capital;
  - the chronicle's events, each dated within the step: founding, war (with sides, front, outcome and deaths),
    conquest, succession, partition, crisis, rebellion, secession, collapse, alliance, unification, culture shift.
- **Per run:**
  - every polity's life story: when and how it began, its capitals, its peak area and date (with its rise and duration
    by Taagepera's measures), its rulers' count, its wars, how it ended and who took its land;
  - the culture tree, with each culture's area over time;
  - the checks' numbers (§11.1).
- **Names** (optional, §14 Q3): from each root culture's generated phonology, names for polities, places and cultures.
  A daughter culture's names drift from its parent's.

## 10. Views: borders, zones of influence, contested areas

Jackson's ask (2026-11-26): "borders and zones of influence, contested areas, etc." Each mark on the map is a model
quantity from §7.1. The view only colours it.

### 10.1 What each mark is

| Mark | Drawn as | The quantity behind it |
|---|---|---|
| **Hard border, administered land** | the realm's colour, solid; a line where two administered realms meet | `owner` = p: p strongest and administering pays (tax > collection cost) |
| **Zone of influence: tribute, vassals** | the overlord's colour, lighter, striped over the vassal's own colour where it has one (EU's subjects) | `suzerain` = p: p strongest, administering doesn't pay, its influence beats the local power |
| **Influence fading with reach** | the strongest realm's tint, alpha ∝ log I_p(c) between the local power and the administering line (a halo) | I_p(c) = F·e^(−t/τ) |
| **Sphere (trade dominance)** | a dotted wash in the realm's colour | the share of a town's flows to p's towns > ½ (needs T2) |
| **Disputed borderland** | hatching in the top two realms' colours | the strongest would win a war there with odds < w_c |
| **Front, war zone** | red hatching, this step's | a war fought there this step, or cells changed hands |
| **Claim** | a dashed outline in the claimant's colour | held ≥ N_core generations by a polity that lost it |
| **Multiple tribute** | both overlords' stripes | top two both beat the local power (Thongchai's two or more overlords) |
| **No-state land** | the land's own colours (the People or Land views beneath) | no influence beats the local power (Scott's non-state space) |

### 10.2 At planet scale and regional scale
- **Planet scale** (the whole map):
  - realms as fills with their halos;
  - the largest realms labelled (by area, or by people);
  - town dots as now, gold where a state holds them;
  - small polities, under a few cells (city-states), as their towns' dots ringed in their colour, not as fills;
  - zones and contested land as tints, so the eye reads cores, spheres and frontiers at once. The maṇḍala picture:
    solid centres fading outward, overlapping.
- **Regional scale** (zoomed):
  - borders as lines, seats and capitals marked;
  - provinces (seats' regions) as faint inner lines;
  - fronts and claims distinct;
  - the readout names everything at the pointer: the administering realm and how far its seat is in days, the overlord,
    the claimants, the second-strongest and its odds.
  - Cells are ~56 km at the page's 160K, so a region of a few hundred km has borders a few cells wide. That is the
    case for drawing borders along cell edges smoothed by the travel field's own level sets (the equal-influence line
    interpolated), not as cell outlines.
- **Colours that last:**
  - a realm keeps its colour for its whole life (Paradox's and Dwarf Fortress's legibility);
  - a successor takes a shade of its parent's;
  - neighbours are kept apart by a colouring chosen when each realm is born (from those its neighbours don't use).

### 10.3 Over time
- Frames every step (25 yr) for the realm layer, so borders move smoothly when scrubbed, and influence waxes and wanes
  as forces change. The 500-yr density frames stay as they are; the realm layer stores changes, not frames (§11.3).
- **The timeline** (Jackson, Q2; stage N2): a slider over the run's steps replays the border changes, with play and
  step buttons, and the selected realm's area-over-time curve under it.
- **A realm's card** (clicking its land or capital):
  - its name, dates, capitals, rulers, wars;
  - an area-over-time sparkline: Taagepera's rise, plateau and fall, with its R and D marked;
  - the realm outlined at its peak;
  - "who took its land".
- **The chronicle:** a list of the frame's events, clickable to the place (Dwarf Fortress's Legends; CK's history).
- **Map modes beside Realms:**
  - **Cultures** (the culture tree's colours, shifted cells shaded);
  - **Influence of …** (one realm's I as isolines in days of its reach);
  - **Claims** (de jure against de facto, CK's pair);
  - **Wars** (fronts across the last century).

### 10.4 Precedents for legibility
- **Paradox:**
  - EU4's subjects in the overlord's colour and occupied land striped;
  - CK3's realm (de facto) beside de jure modes;
  - Victoria 3's sphere-of-influence map mode, which shows a power bloc's reach and its origin [A].
- **Dwarf Fortress:** Legends mode's historical map, showing territorial disputes between civilizations, and site
  histories [A].
- **Historical atlases:** vassals in a paler shade of the overlord's colour (a common convention; anecdotal [A]).
  Euratlas shows alternative overlordships.
- **The scholarly case:** zonal, overlapping premodern authority, the reason not to draw a premodern world as a
  political map of today (Thongchai; Wolters; Tambiah; Branch; Lattimore).

## 11. Checks, determinism and cost

### 11.1 Earth checks (bugs, not targets) and the ensemble
On `civ-sim --earth` and the ensemble (`civ-ensemble`), read as `report()` lines. They never fail a run; their ranges
are from §4.
- **Lifetimes:**
  - duration above half peak (median ~130 yr; Taagepera);
  - the exponential's mean (~220 yr; Arbesman);
  - chiefdoms' lifetimes (Gavrilets).
- **The largest polity's area over time,** against Taagepera's curve for the same era of the run. Run years are
  relative, so compare the curve's shape, measured from the first state: ≤ ~1 Mkm² for the first ~2500 years, then
  growth.
- **Megaempires:** the share of ≥ 1 Mkm² realms within so many days of herders' land (Turchin 2009: > 90 %), and their
  E–W elongation (Turchin, Adams & Hall).
- **Where large realms arise on Earth:** R² against Turchin et al. 2013's own data (maps of polities > 100,000 km²
  every 100 yr, 1500 BCE–1500 CE, in their SI; to fetch). 0.65 and 0.73 are the published models', not a pass line.
- **Effective number of polities by area** (Taagepera's N_A), and the Herfindahl of sub-regions (Fernández-Villaverde's
  China-vs-Europe check, on Earth).
- **Borders:**
  - the share of administered border length on navigable rivers (23 % internationally, Popelka & Smith; a modern
    figure, so a sanity range);
  - border fractal dimension (1.00–1.10, Alesina et al.).
- **Wars:** the war-size distribution's tail exponent (Clauset: 1.53).
- **Reigns and successions:** tenure by rule, out as in (a consistency check of the code against its source).
- **Cultures:**
  - culture area against polity complexity (Currie & Mace);
  - culture density against latitude (Mace & Pagel);
  - Abramson's European sizes (Earth only; at 160K, ~56 km cells, the median European state of 1100 is a few cells, and
    those of 1790 are sub-cell, so this wants the tools' finer mesh).

### 11.2 Determinism and scale
- **Determinism:**
  - every chance is polity.js's hash of (tick, cells, ids);
  - the Dijkstra breaks ties by cell index;
  - the same world and history give the same realms, events and names;
  - `civ-fingerprint.mjs` grows to cover the realm record.
- **Scale invariance:** every reach is in days and every size in km², so results should hold across meshes (40K vs
  160K, as `check-civ-food` does). Small realms below a cell are the known limit. They live as towns, not land.

### 11.3 Cost (estimates, to measure)
- **The reach pass** is one 2-label multi-source Dijkstra on ~160K cells × ~6 edges. That's ~30–80 ms in JS, on a
  campaign-season cost precomputed once.
- **Per-cell passes** (assimilation, asabiya, MilTech diffusion) are ~10 ms.
- **A run:** 200 steps over 5 kyr, about 10–25 s on top of the People run's ~18 s at 160K.
  - On the page, after the People run, in its worker.
  - In the ensemble, 20 worlds × that.
  - At 640K, ~4× (CIV_PLAN §9.8's scaling). The People mesh may move to 640K (Jackson's culture answer, §14), so this
    is the case to cost: civgpu-run is measuring 160K vs 640K People runs, and the reach pass's share is to be
    measured on top. The Dijkstra is serial; if it dominates at 640K, a GPU relaxation (Bellman–Ford sweeps) or a
    coarser reach mesh are the options, decided on the measurement.
- **Storage:**
  - owner changes per step are a few % of cells (~6 bytes each, about 30 KB a step, ~6 MB a run);
  - influence fields aren't stored; they are recomputed for the frame shown (one pass, ~50 ms);
  - realm records and the chronicle are small.
- If a stage misses these, the reach pass moves to the GPU first (a frontier relaxation; the agent brief's GPU
  opportunities line).

## 12. Stages (each lands on its own, with its checks)

- **N0. The record and its checks.** No sim change.
  - `tuning/nation/`: Taagepera's tables (the 1997 appendix), COW counts, Abramson's sizes, Turchin 2013's maps (SI)
    for the retrodiction, Popelka & Smith's river borders.
  - A `nation-report.mjs` that reads today's polity.js runs and prints §11.1's numbers. This is the baseline.
  - Polity.js's century step already gives lifetimes and counts. Expect a first finding: they are short and
    over-many, since collapse is per town.
- **N1. Territory and the views.**
  - Reach (§7.1) over today's polities: influence from their towns (people as force), administration, zones,
    contested, claims.
  - The Realms map mode, card and readout.
  - Nothing feeds back, so the people's fingerprints are unchanged.
  - Checks: river and mountain border shares against random; fractal dimension; 40K vs 160K; the view at planet and
    regional scale, rendered for Jackson.
- **N2. The realm step.**
  - 25-yr step; revenue, army, capacity; campaign reach in days; succession rules; collapse into seats' regions; the
    chronicle and life stories.
  - **The timeline view** (§10.3; §14 Q2): borders scrubbed step by step from the stored changes; a realm's area over
    time on its card; the chronicle at each step.
  - Checks: lifetimes (130 / 220 yr), largest polity's curve, N_A, reigns by rule; ensemble medians; time cost; the
    timeline replays to the same borders as the run (the changes store is exact).
- **N3. Identity** (consumes langspec's culture model through the seam of §7.4a; langspec builds it). Needs culture
  **L1** (identity and distance).
  - Culture per cell and town, distances and MRCA ages, read from langspec; asabiya on metaethnic frontiers;
    MilTech know-how (riding from herds; iron waits for T4).
  - Nomad confederations.
  - Checks: Earth retrodiction R²; megaempires by the arid belt and their elongation; culture area vs complexity;
    culture density vs latitude.
- **Language shift under the realm** is culture **L4**, langspec's stage. It needs N2's hold and seats (the status s)
  and comes after N2; N4's conquest settlement feeds it further.
- **N4. Feedback onto the people.** On by default once its checks pass (Jackson, Q4). It changes the civ
  fingerprints, which become the new baseline.
  - War deaths; refugees and conquest settlement; state works (canals and granaries that raise K or the store); taxes
    as a drain on the store.
  - Checks: the civ layer's own Earth numbers (HYDE populations, the Ur chain) not broken; famine rates.
- **N5. Alliances, vassals in full, trade spheres and trading cities** (needs civ T2).
  - Checks: Abramson's cities-and-fragmentation elasticity on Earth; war-size exponent.
- **N6. The national stage** (§7.8; gated by §14 Q1).
  - Mobilization, culture in legitimacy, unification and national secession, faster assimilation (through s, in
    langspec's shift rule). Writing comes from the civ economy's skills model, so N6 needs it there.
  - Checks: partitioned homelands; the late-and-fast switch (states' cultural homogeneity before and after).
- **N7. Names and the written chronicle** (§14 Q3): place, people and realm names and exonyms from each culture's
  phonology, through langspec's generator (§7.4a). Needs culture **L3**. Rulers' names wait for the story layer.

## 13. What it needs from the civ layer that the civ layer doesn't have yet

- **Polities feeding back on the people** (CIV_PLAN §8 item 6): war deaths, state canals. This is N4, written in sim.js
  through a hook the nation layer fills.
- **The river network** (§8 item 4): basins as units (Lagash and Umma's water war), river crossings as costs, and the
  river-border check needs the reaches' order.
- **Trade flows** (§10.7 T2): tolls, spheres, trading cities.
- **Materials** (T4): iron for MilTech; tin and copper for bronze-age power.
- **Riding:** herds exist with domestication D and milk at D 2. Riding (horse-like herds) is a further know-how the
  economy would grant, at herds' D past milk and a large-herbivore wild form. It's needed for cavalry and nomad reach.
- **Long climate change** (§8 item 5): pressure on states over centuries (the 4.2 ka event; the African Humid Period's
  end).
- **Frames' polity state:** frames carry towns and a polity table. The realm layer adds a changes store and its records
  (§11.3).
- **Writing** (for N6's mobilization): a know-how born in states, carried by the economy's skills model (§9.3), as
  Jackson decided (2026-11-26). Jackson also wants the civ model's organization reviewed for subsystems that
  generalize the way the skills model does (writing, MilTech's know-how bits and riding could all be skills); that
  review is a civ-layer task, recorded here, not done in this lane.
- **Finer detail for regional views and Earth's European check:** the page's 160K is ~56 km. The tools can run 640K.
- **Polity.js's town-level rules that the realm step replaces** (proposed in the report as a CIV_PLAN amendment, not
  made here):
  - collapse into single towns;
  - power from head-count;
  - reach in land-km.

## 14. Open questions for Jackson

**Answered (Jackson, 2026-11-26, via sessrumnir):**
- **Q1:** (b), agrarian plus the national stage (N0–N6).
- **Q2:** (c), the map modes plus a **timeline**: scrub borders through history and follow a realm's area over time.
  It is planned in at N2, not left for later (§12).
- **Q3:** (b), names from each culture's phonology. Culture and language spread, evolution, differentiation and
  blending get a lane of their own, **langspec**. The nation layer's culture tree (§7.4, N3) and names (N7) consume
  that lane's model; the seam is §7.4a.
- **Q4:** (c), feedback onto the people (N4) **on by default once its checks pass**, with no option-off stage first.
- **Q5:** (a), one model from polity.js's first polity.
- **Q6:** yes, fetch Turchin et al. 2013's maps for the Earth R² check (N0).
- **Q7:** (a), 160K cells; small realms live as town dots.

**Amended (Jackson's culture answers, 2026-11-26, via sessrumnir; langspec's six proposed changes applied):**
- **Culture tree (§7.4):** the placeholder is replaced by a pointer to CULTURE_PLAN §7.1–7.4 and §7.9; T_split is gone.
- **Culture per cell (§7.4a):** `lang[c]` plus `family[c]`, and the rival language with share x; ids stable by overlap
  matching. Dialects are shown at two levels; the nation layer reads languages.
- **Distance (§7.4a):** lexical distance on the 40-meaning list, mixed with the ~16 customs at culture L5 (Jackson:
  yes), with the MRCA age alongside for metaethnic frontiers. Religion is held until langspec's religion revision,
  then re-asked; until then it plays no part in legitimacy.
- **Assimilation (§7.4):** the shift rule moves to langspec; the nation layer supplies s and conquest settlement.
- **Writing (§7.4a, §7.8, §13):** owned by the civ economy's skills model. Jackson also asked for a review of the civ
  model's organization for subsystems that generalize like the skills model (§13).
- **Stages (§12):** N3 needs culture L1, N7 needs L3; shift under the realm is culture L4, after N2.
- **Names (Q3):** (a) of langspec's question, places, peoples and realms, plus exonyms. Personal names later, in a
  future story layer.
- **Ancestry:** a check layer in langspec, fed by the nation layer's conquest settlement.
- **Creoles:** later, at the colonial horizon (beyond this plan's Q1 (b)).
- **Start:** culture runs from the first people (70 ka); the nation layer still starts at polity.js's first polity.
- **Mesh (revises Q7):** Jackson chose 640K for the culture layer and wants a real time cost; civgpu-run is measuring
  160K vs 640K People runs. The nation layer runs on the People mesh, so it follows: sub-cell realms still live as town
  dots, and the reach pass's cost at 640K is measured on top (§11.3).
- **GPU:** the culture layer gets a GPU kernel, and a civgpu lane now studies GPU for the civ layer. The nation layer's
  per-cell passes are GPU-friendly; its Dijkstra is the open case (§11.3).

The questions as they were put:


**Q1. Scope and horizon.** How far in history?
- (a) **Agrarian only:** city-states to agrarian empires and early-modern territorial states; no nationalism (N0–N5).
- (b) **Agrarian plus the national stage,** as a stand-in switch (N0–N6). Nationalism appears where towns and writing
  are dense, without an industrial economy.
- (c) **Through the modern era:** colonial empires, decolonization, industrial states. This needs a technology and
  economy layer first (growth past agrarian K, print, industry): a separate program.
- **Recommend (b), built in order, stopping after N5 to look.** N6 is cheap once identity exists, and it gives the
  layer its name. (c) is a program of its own and shouldn't be promised from here.

**Q2. How much to show the player, and how.**
- (a) A Realms map mode on the People layer, with borders, zones, contested land, a card and a chronicle (N1–N2).
- (b) (a) plus the Cultures, Influence, Claims and Wars modes.
- (c) (b) plus a timeline view: scrub borders through history, and follow a realm's area over time.
- **Recommend (a) at N1–N2 and (b) at N3.** (c) is the most "legible" for a player (Dwarf Fortress's Legends) but costs
  the most UI; decide after seeing (a).

**Q3. Names and cultures.** Are names generated?
- (a) No names: realms are numbered and coloured, and cultures are tree nodes.
- (b) Generated names from each root culture's phonology, drifting down the tree (a culture's names sound like its
  kin's). Deterministic per world.
- (c) (b) plus generated ethnonyms, rulers' names and dynasties for the chronicle.
- **Recommend (b),** after N3 has a culture tree to hang it on. Names make the chronicle readable at little cost.
  Rulers' names (c) only if Jackson wants character stories, which is CK's territory rather than ours.

**Q4. Feedback onto the people (N4).** It changes the civ layer's results and fingerprints.
- (a) Never: the nation layer only reads.
- (b) Behind an option, default off.
- (c) Default on once its checks pass.
- **Recommend (b) then (c).** War deaths and state canals are part of how states shape where people live.

**Q5. The start.**
- (a) One model from polity.js's first polity (§1.2).
- (b) The realm step starts only once a polity is a state (Wright & Johnson), and chiefdoms stay polity.js's.
- **Recommend (a).** The seam in (b) is the one CIV_PLAN §9 retired. Chiefdom cycling is a check worth having.

**Q6. Earth retrodiction.** Fetch Turchin et al. 2013's polity maps (their SI data) for an R² check on Earth?
- **Recommend yes.** It's the only spatial-temporal check with published model scores to compare against. The scores
  aren't a target.

**Q7. Mesh.** The page's 160K cells are ~56 km, coarser than Europe's small states.
- (a) Accept: small realms live as towns.
- (b) Run the realm layer on a finer mesh than the people.
- **Recommend (a).** The realm layer is meant for the planet-scale picture. City-states as town dots are legible, and
  (b) doubles the cost for detail the people's own cells don't carry.
