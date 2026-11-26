# Culture layer — languages and cultures on an Orogen planet

**Goal:** give the civ layer's people languages and cultures that spread with them, drift apart, borrow from each
other, shift and die, all from mechanisms in the literature. Families should form where people expanded, dialect
continua where they stayed, residual zones in the hills, and names that sound like their kin's. Nothing scripts an
outcome: there is no rule saying "a mountain is a border" or "farmers' language wins". **Acceptance:** on Earth's own
ground, the numbers fall within the record's ranges. Those numbers are how language distance grows with geographic
distance, the density of languages by latitude, the sizes of families and of language ranges, retention rates down the
tree, and the depth of the big families. They are bug checks, not targets (Earth is N of 1). On generated worlds, the
same rules give language maps that differ for reasons a player can read.

Status: spec only (2026-11-26, branch `langspec`, from main 4e80c7f). No code. Sources, and how far each was checked:
[CULTURE_SOURCES.md](CULTURE_SOURCES.md), with the marks used in NATION_SOURCES.md. Decisions for Jackson: §14.

**Jackson's input (2026-11-26):** while answering the nation layer's questions (names generated from each culture's
phonology), he asked for "a separate lane for culture and language spread, evolution, differentiation and blending."
The nation layer's culture tree (NATION_PLAN §7.4, stage N3) and its names (N7) consume this layer through the seam in
NATION_PLAN §7.4a. Where the two plans differ, this one owns the culture model.

---

## 1. What the layer is, and where it runs

### 1.1 What the civ layer already records

`v2/js/civ/sim.js` (read only for this spec):
- **Who came from whom.** `cameFrom` (per cell): the cell its people came from. That is the front's previous cell, a
  voyage's launch, or the shelf the rising sea drove them off. `arrival` gives when. One origin at 70 ka
  (`originBP`), so `cameFrom` is a tree over the peopled cells, rooted there.
- **Who brought farming.** `farmFrom` (per crop, per cell): the cell its farmers came from. `farmArrival` gives when;
  a centre or a landing starts a crop's front.
- **What happens when farmers arrive where people already live.** Nothing distinguishes newcomers from residents.
  The crop's domestication and skill pass along `farmFrom` (`pass`), and the cell's density grows toward the new
  capacity. On empty land a front seeds `seedShare` (5 %) of capacity. This layer needs the distinction, and §7.5
  derives it from the same seed.
- **The step.** One generation, `stepYears` = 25, from 70 ka to the end of the run: 2800 steps to 0 BP. Frames
  every `frameYears` = 500 yr. Density, way of life (`Life`) and crop per cell; towns and polities every
  `polityStepYears` = 100 yr (polity.js), 25 once the nation layer's realm step lands (NATION_PLAN §2).
- **The travel graph.** `routes.js` gives days per edge by month and craft (on foot, paddled, sail). Today only the
  page's travel view reads it (T0).
- **The mesh.** The page runs 160K cells, ~56 km apart and ~3,200 km² each; the tools can run 640K.

What it doesn't have: any notion of what people speak or practise. NATION_PLAN §7.4 sketched a placeholder: a culture
tree that splits at each landing and after T_split years out of contact. This plan replaces it.

### 1.2 Proposal: languages as a field of lects on the cells, with families and the tree read off it

**Recommended: every peopled cell carries a lect.** A lect is a small, explicit language state: a basic-vocabulary
list of cognate classes, a phonology and a naming grammar. It is inherited along `cameFrom` and `farmFrom`. Words are
replaced at the rates measured on real families, innovations spread to neighbours by the contact that travel time and
density allow, and whole populations shift by the Abrams–Strogatz dynamics. **Languages, dialects, families and the
tree are not state. They are read off the field**, the way CIV_PLAN §9 reads "forager" and "farmer" off the diet:
- a **language** is a connected group of cells whose lects are mutually intelligible (lexical similarity above a
  level, §7.9);
- a **family** is a clade of the tracked tree younger than the comparative method's reach (§7.9), so older relations
  exist in the run but are "undetectable", as on Earth;
- a **split** happens when contact stops homogenizing two parts of a language faster than drift separates them. No
  T_split clock decides it.

The reasons:
- **Splits come out of the mechanism.** This is the stepping-stone model of population genetics, with words in place
  of alleles. Similarity falls with distance and barriers, and dialect continua form where people are spread evenly.
  Sharp boundaries form where contact is thin (seas, mountains, deserts, empty land) or where two populations meet
  after long separation. Neither needs a rule (§7.3).
- **The rates are the literature's own numbers.** Pagel et al. 2007's per-meaning replacement rates go straight in
  (§7.2). Under neutral drift a lineage's substitution rate equals its innovation rate (Kimura's result [L]), whatever the
  number of cells, so the rates measured on trees are the rates the model runs at.
- **Distances are real lexical distances.** The nation layer's d(a, b) is the share of the basic list two lects don't
  share (§7.10). It is what lexicostatistics and ASJP measure, so it can be checked against Earth's.
- **Names come from the same state.** A lect's words and sound changes produce its names. Kin share cognates and
  most of their sound changes, so they sound alike by construction (§9).

Alternatives, not recommended:
- **(B) A culture tree only** (NATION_PLAN §7.4's placeholder): nodes split at landings and after T_split out of
  contact. It is cheap and legible. But T_split is a tuned clock (glottochronology's failure, §3.2), dialect continua and
  borrowing have nowhere to live, and distance between nodes is just tree depth.
- **(C) Continuous culture vectors** (Axelrod-like traits, or a point random-walking in R^k): cheap, and smooth to
  average. But distances don't saturate the way lexical ones do, and there are no discrete words to make names from.

### 1.3 Where it runs

- **Inside `sim.js`'s loop, every step (25 yr), after the people and the realm step:** `culture.step(...)` reads that
  step's density, way of life, arrivals, farm arrivals, towns, and the realm's owner and ruling culture (from the
  last step). This is NATION_PLAN §7.4a's order: realm, then culture, each reading the other's previous state, so the
  run stays deterministic.
- **Before the nation layer exists,** the culture layer runs on what the civ layer has: arrivals, farming, towns, and
  polity.js's polities, which have capitals. So it can land first (§12).
- **New modules under `v2/js/civ/culture/`** (names provisional):
  - `culture-config.js`: every constant, with its source;
  - `lect.js`: the lect state, its step (inheritance, drift, contact, shift) and its GPU kernel (§11.3);
  - `lineage.js`: languages and families read off the field, the tracked tree and its dates;
  - `phonology.js`: sound changes, word forms and spelling;
  - `names.js`: names of places, peoples and realms;
  - `traits.js`: cultural traits beyond language (§7.8; later stage).
- **Fingerprints.** The culture layer only reads the people, so the civ fingerprints (`civ-fingerprint.mjs`) stay
  byte-identical with it on or off. It changes the people only through the nation layer, if at all (§8.3).

## 2. Time span and step

- **Span: from the first people (70 ka) to the run's end, and on as far as asked.** Starting at the origin, rather than
  seeding languages at the Holocene, is what lets families emerge. Every language descends from the origin's one
  lect, but beyond the comparative method's reach (§3.2) the relation is no longer detectable. The families of 0 BP are
  then the clades that survived the Holocene's expansions, as on Earth. A Holocene start would need its families
  drawn by hand.
- **Step: 25 years**, sim.js's generation. The reasons:
  - Contact between neighbouring cells at 160K is ~0.02–0.07 per neighbour per step (k_ab·25 yr at D = 3–12.5
    km²/yr, §7.3). It must stay well under 1 for the discrete voter model to approximate the continuous one. At 640K
    (cells half as far apart) it is four times as much, still under 0.3. A century step at 160K would be ~0.06–0.27 per
    neighbour, ~0.4–1.6 over six, and would over-mix.
  - The nation layer's realm step is 25 yr (NATION_PLAN §2), and shift under a ruler is part of the culture step.
  - Abrams–Strogatz shift takes a few generations to a few centuries; 25 yr resolves it.
- **Frames.** The culture labels (language and family per cell) and each language's representative lect go into the
  civ frames every `frameYears`. The full field is held in memory for the run and isn't stored per frame (§11.3).

## 3. The research

For each strand: what is **established** (replicated, measured), what is **contested**, and what is **just-so** (a
story fitted to one case). Marks, as NATION_PLAN's: [V] read in the primary source or its relevant section; [A] its
abstract or a scholarly summary only; [L] a standard attribution not yet checked; NOT FOUND where it was looked for and
not seen. Sonnet subagents checked each claim against its source (2026-11-25/26; the notes are in
`~/.cache/geo-sim/lanes-2026-10-29/langspec/verify/`). Full rows: CULTURE_SOURCES.md.

### 3.1 Spread: demic and cultural diffusion, farmers' languages, elites, spread and residual zones
- **The wave of advance.**
  - Farming crossed Europe at ~1 km/yr on average (Ammerman & Cavalli-Sforza 1971 [A]). Their 1973 chapter made it a
    demic wave: Fisher's reaction–diffusion front [A].
  - Regional rates were faster along the Danube–Rhine (~4–6 km/yr) and the Mediterranean coast (~10 km/yr) (Davison
    et al. [V], on the same data).
  - The observed front, 0.9–1.3 km/yr (Fort 2012 [V]). The civ layer already runs its fronts on these numbers
    (CIV_PLAN §5.4).
- **Demic and cultural together.** Cultural diffusion explains ~40 ± 8 % of the Neolithic front's **speed** in Europe,
  a continental average, so "the demic effect is ∼60 %". For the LBK the cultural share is "a very small percentage"
  (Fort 2012 [V]). These are shares of the spread rate, not of ancestry; Fort says the paper doesn't answer that. Ammerman & Cavalli-Sforza already wrote that
  demic and cultural diffusion are not exclusive (quoted by Fort [V]).
  - **Ancestry, from ancient DNA:** the steppe migrants of the 3rd millennium BCE replaced ~75 % of central Europe's
    ancestry; the Corded Ware people were 79 % Yamnaya-like, 4 % western hunter-gatherer and 17 % early farmer (Haak et
    al. 2015 [V]). Movements of whole populations happened, and the genes record them.
- **The farming/language dispersal hypothesis.** The largest language families spread with the first farmers
  (Diamond & Bellwood 2003 [V]; Bellwood & Renfrew 2002 [A]).
  - **Established, with conditions:** the hypothesis's own authors list six complications. Two matter here: hunter-
    gatherers expand too (Inuit; Athabaskan), and peripheral peoples shift to an expanding language with little of its
    speakers' ancestry (Diamond & Bellwood 2003 [V]).
  - **Contested:** agriculture is one driver among several, and the spread-zone concept is weak (Campbell 2002 [A]).
    The Andean case refines the rule rather than refuting it (Heggarty & Beresford-Jones 2010 [A]). Transeurasian
    as a farming dispersal, 9181 BP (95 % HPD 5595–12793) from millet farmers of the West Liao (Robbeets et al. 2021 [V]),
    is disputed: the lexical data can't separate inheritance from contact and chance (Tian et al. 2022, preprint; seen in a search summary only [L]).
  - **A forager counter-case:** Pama-Nyungan spread across most of Australia from the Gulf Plains in the mid-Holocene,
    "just under 6,000 years ago" (306 languages; Bouckaert, Bowern & Atkinson 2018 [A]; the date is from Bowern's own
    popular account, the paper's root age and HPD NOT FOUND), with no strong genetic sign of
    a population expansion. The authors' explanation is a package of cultural innovations that absorbed existing groups.
- **Elite dominance.** A language spreads through a small ruling group, by status rather than numbers (Renfrew 1987,
  as described in Renfrew 2000 [V]). Anatolia's Turkish speakers carry ~9.6 % Central Asian ancestry (6.5–12 % by
  region; Kars et al. 2021 [V]); most Turkic-speaking peoples resemble their neighbours genetically, "in agreement with
  the elite dominance model" (Yunusbayev et al. 2015 [A]).
- **Spread and residual zones** (Nichols 1992, through Urban 2024's paraphrase and Renfrew 2000 [V of those; the book
  not read]):
  - **spread zones** hold few families and little diversity. Expansions there are frequent and long, and "tend to
    completely or almost completely obliterate preexisting languages" (the Eurasian steppe is the stock example);
  - **residual (accretion) zones** hold old, deeply diverse families and isolates. No major expansion starts in one,
    but they take in intruders "as a refugium of sorts". "Often a residual zone will be located at the periphery of a
    spread zone" (Nichols 1992:21);
  - the Caucasus and New Guinea are the usual examples [A]. Northern Australia and California were not verified.
- **The three classic cases:**
  - **Bantu:** 424 Bantu and related languages; the in-group's root ~4,850 BP (Grollemund et al. 2015 [V]). Its route
    is contested. Grollemund: around the rainforest, by savanna corridors, with entry into the forest delayed ~300 yr.
    Koile et al. 2022 [V]: through it, root 5,110 BP (95 % HPD 4,640–5,770).
  - **Austronesian:** 400 languages, origin in Taiwan ~5,230 BP (95 % HPD 4,750–5,800), a "chained" tree through the
    Philippines, Borneo and Sulawesi to Oceania, with pauses and pulses tied to innovations (Gray, Drummond & Greenhill
    2009 [A]; the authors' recap 2010 [V]). Where the pauses fell: NOT FOUND in what was read.
  - **Indo-European:** root ages 7,800–9,800 BP (Gray & Atkinson 2003 [A]); decisive support for an Anatolian origin
    over a steppe one (Bouckaert et al. 2012 [A]; 8,000–9,500 is the hypothesis they tested, their fitted root NOT FOUND); the steppe, c. 6,500–5,500 BP, with ancestry constraints
    (Chang et al. 2015 [A]; ~6,500 from press accounts); ~8,120 BP, a
    hybrid with a homeland south of the Caucasus and a later steppe branch (Heggarty et al. 2023 [A]).
  - **Status.** Established: farming families are real and large, and their spread was largely demic. Contested: the
    homelands and dates (Indo-European above all), and how much elites against farmers did. Just-so: any single-cause
    story for one family.
- **For us:** the model must let **both** outcomes arise from the same rules. Farmers' numbers swamp thin foragers;
  dense foragers adopt farming and keep their language; a few rulers' language spreads by status; foragers can expand
  with a cultural advantage. §7.5's numbers-plus-status dynamics are built for exactly that.

### 3.2 Evolution and differentiation: rates, trees, continua, barriers, founders
- **Glottochronology's constant rate failed.**
  - Lees 1953 found 80.5 % (± 1.8 %, 90 % confidence) retention per millennium on the 200-word list (13 pairs). Swadesh's 100-word list
    gave 86 % (both via secondary text [L]).
  - Rates vary between related languages: Icelandic lost ~4 % per millennium and Norwegian (Riksmål) ~20 % (Bergsland
    & Vogt 1962, as paraphrased [L]).
  - **Established:** there is no constant rate. Rates vary by meaning and by lineage.
- **Rates by meaning.** Frequent words are replaced slowly and rare words fast. Frequency of use explains ~50 % of the
  variance in rates over 200 meanings in 87 Indo-European languages (Pagel, Atkinson & Meade 2007 [A]). Most words
  have a 50 % chance of replacement "roughly every 2,000–4,000 y". Numerals, pronouns and some adverbs have half-lives
  of 10,000, 20,000 or more (Pagel et al. 2013 [V], summarizing 2007). The "750 to 10,000 years" range often quoted for
  2007: NOT FOUND yet.
- **Deep words: contested.** A ~14,450-yr "Eurasiatic" tree from ultraconserved words (Pagel et al. 2013 [V]) was
  attacked as "correlation in, correlation out", with two unhistorical calibrations (Heggarty 2013 [V]). Not used.
- **Bayesian phylogenetics** dates families from cognate data (Gray & Atkinson 2003; Bouckaert et al. 2012; Gray et
  al. 2009; Grollemund et al. 2015; Koile et al. 2022; §3.1). Established as a method; its dates are contested where
  calibrations are few.
- **Bursts at splits.** 10–33 % of basic-vocabulary divergence arises at or near language splits: Bantu 31 %, Indo-
  European 21 %, Austronesian 9.5 %, and Polynesian alone ~33 % (Atkinson et al. 2008 [V]). Established, in three
  families.
- **Population size.** Larger Polynesian populations gain new words faster; smaller ones lose them faster (Bromham et
  al. 2015 [V], on sister pairs). The effect isn't universal (Greenhill et al. 2018 [A]). Contested.
- **Grammar is not the slow part.** Across 81 Austronesian languages, most grammatical features change *faster* than
  basic vocabulary, with more homoplasy and contact-induced bursts. There is a highly stable core in both (Greenhill et
  al. 2017 [V]).
- **The comparative method's reach.** "Diagnostic kinds of accidence … dissipate entirely after about 8000 years"
  (Nichols 1992:313, quoted by Renfrew 2000 [V]). Another view: the methods may hold "to a time depth of at least
  around 10,000 years" (Rankin 2003:207 [V]). The received figure is ~6,000 (Renfrew 2000 [V]). So **T_detect ≈ 8–10
  kyr**, contested at both ends.
- **Dialect continua and isolation by distance.**
  - Dialect distance grows **sublinearly** with geographic distance in virtually every study. Its best predictor is
    the logarithm of distance (Nerbonne & Heeringa 2007, in Nerbonne 2010 [V of the draft]). The correlations with log
    distance are r = 0.47 (Bantu, 53 sites), 0.49 (Bulgarian), 0.62 (Dutch) and 0.51 (a fourth dataset).
  - Séguy 1971 compared his curve with the square root of the log of distance (via Nerbonne [V]).
  - Burridge 2017 [V] models dialect domains: boundaries move with a surface tension (curvature shrinks), are driven
    **away from population centres** toward thinner people, and are shaped by coasts. His Séguy curve is a function of
    distance over √time that saturates; it has no innovation.
  - **Established:** sublinear growth of distance. **Contested:** its form (log against a saturating curve), and
    whether population sizes act as a "gravity". Nerbonne et al. found little support for population size in Dutch.
- **Gravity and hierarchy.** Innovations jump between towns, by population over distance squared, before they fill the
  country between (Trudgill 1974, via Burridge 2017 and Nerbonne et al. [V of those]). Established for modern towns;
  the agrarian case is untested.
- **Barriers.** Of 14 variables, landscape roughness and river density are the only two that affect linguistic
  diversity universally. The set explains up to 80 % of Africa's diversity, 69 % of Asia–Australia–Pacific's, 56 % of
  Europe's and 53 % of the Americas' (Axelsen & Manrubia 2014 [V]). Established.
- **A simple model already reproduces a continent.** Groups fill empty space, rainfall limits density, and groups
  divide past a maximum size. That gives 406 languages for Australia against 407 observed, and 56 % of the spatial
  variation (Gavin et al. 2017 [A]). Its split is a size rule. Ours comes from contact (§7.4), and Australia is the
  check (§11.1).
- **Founder effects in sounds: contested.**
  - Phoneme inventories in 504 languages decline with distance from Africa, which fits a serial founder effect
    (Atkinson 2011 [A]). Its variance figure: NOT FOUND.
  - Against: it is "an artifact of using suboptimal data, biased methodology, and unjustified assumptions" (Cysouw,
    Dediu & Moran 2012 [A]). In 725 languages most of the founder model's predictions fail for phonemes, though they
    hold for genes, because "phonemes change rapidly" (Hunley, Bowern & Healy 2012 [A]). In 2,082 languages there's no
    serial-founder signal, and near languages share more phonemes: contact (Creanza et al. 2015 [V], the first ~40 % of the text).
  - Inventory size against population: a "robust correlation" (Hay & Bauer 2007 [A]); "little support" once relatedness
    is controlled for (Moran, McCloy & Wright 2012 [A]).
  - **For us:** no founder rule. Founders copy their source's phonology exactly (§7.1), and the report checks whether
    a gradient appears (§11.1).
- **Social structure and morphology.** Languages with more speakers, larger areas and more neighbours have simpler
  inflection. Population predicts 26 of 28 morphological WALS features (2,236 languages; Lupyan & Dale 2010 [V]).
  Established as a correlation; its cause (adult learners) is argued. It is a later candidate for a non-neutral rate of
  setting change (§9.2).

### 3.3 Contact: borrowing, areas, shift, death, creoles
- **Borrowing against shift** (Thomason & Kaufman 1988, from Thomason's own summary [V]):
  - in **borrowing**, the first interference is loanwords, followed, "if contact becomes intense enough", by
    structural features;
  - in **shift**, "the first interference comprises phonological and syntactic features, and sometimes there are very
    few loanwords at any stage";
  - the borrowing scale runs from casual contact (content words only, non-basic before basic) to heavy structural
    borrowing. Its middle levels bring pronouns, low numerals and phonemes (secondary [A]; the fifth level's wording
    NOT FOUND).
  - Established: the two routes leave different signatures. That is §7.5's swap and §7.6's borrowing.
- **How much is borrowed** (Haspelmath & Tadmor 2009, WOLD: 41 languages, 1,460 meanings [V]):
  - loanword shares range from 62.7 % (Selice Romani), 51.7 % (Tarifiyt Berber) and 41.0 % (English) to 1.2 %
    (Mandarin). The mean over the 41 is 24 % (median 22 %; our arithmetic from their Table 1); 25.2 % pooled;
  - nouns 31.2 %, verbs 14.0 %, roughly two to one;
  - the Leipzig–Jakarta list ranks the 100 meanings most resistant to borrowing (with stability, universality and
    simplicity). Its own loan share: NOT FOUND.
- **Linguistic areas.** Features diffuse across unrelated languages through long multilingualism: India (Emeneau 1956
  [A]); the Balkans (Sandfeld 1930 [L]). A satisfactory definition is "extremely difficult, if it is possible at all"
  (via a Leiden source, search snippets only [L]). Established as a phenomenon; definitions are contested.
- **Shift and death** (Abrams & Strogatz 2003 [V]):
  - dx/dt = c[(1−x)·x^a·s − x·(1−x)^a·(1−s)], with a = 1.31 ± 0.25 over 42 regions;
  - "two languages cannot coexist stably";
  - **extensions:** a stable bilingual state is possible when the languages are similar enough (Mira & Paredes 2005
    [V abstract], Castilian and Galician). A bilingual state in a voter model changes coarsening from noise-driven to
    curvature-driven (Castelló, Eguíluz & San Miguel 2006 [V abstract]). The spatial version gives coexistence in
    separate zones (Patriarca & Leppänen 2004 [A]). Reaction–diffusion with monolinguals and bilinguals is fitted to
    Welsh and Gaelic censuses; a diglossia variant adds demand for the endangered language in some domains (Kandler, Unger & Steele 2010
    [V of the model's text, partly]; a stable-coexistence result NOT FOUND).
  - Established as fits to decline curves. Contested as a law: bilingualism and similarity allow coexistence.
- **Endangerment now.** Of ~7,000 documented languages nearly half are endangered; 37 % of 6,511 are threatened. Road
  density and years of schooling predict it; contact with other languages per se doesn't (Bromham et al. 2022 [V]).
  Krauss 1992 foresaw "the death or doom of 90 %" within the century (via Simons 2013 [V]). Simons finds the evidence not
  bearing out Krauss's companion estimate that half were already moribund. Modern-horizon matters, kept only to say that states and schools, not contact, kill
  languages.
- **Creoles.**
  - APiCS covers 76 pidgins and creoles (Michaelis et al. 2013 [V]).
  - The founder principle: a creole's structure is largely set by the vernaculars of the colony's founding population
    (Mufwene 1996 [V]). Demography decides: Jamaica went from 3 Africans per European in 1690 to over 10 by the
    mid-18th century; Barbados stayed under 3 (Mufwene 1996:92 [V], from Williams 1985).
  - That creole grammars are the world's simplest (McWhorter 2001 [L]) is contested (Seuren 2001 and
    later work [L]).
  - Established: creoles form where a new population is assembled from many languages under a dominant one.
    Contested: whether they are typologically special.

### 3.4 Culture beyond language
- **Transmission biases** (Boyd & Richerson 1985, as summarized by Mesoudi, Whiten & Laland 2006 and the SEP [V]):
  - guided variation;
  - direct bias;
  - indirect bias (copying the prestigious);
  - frequency-dependent bias, conformist above all.
  - "Content bias" and "prestige bias" are later names (Henrich and colleagues).
- **Population size and complexity: contested.**
  - Below a threshold number of social learners, which depends on a skill's difficulty, complex skills decay (Henrich
    2004 [V of the preprint], the Tasmanian case). Demography explains when modern behaviour appears (Powell, Shennan &
    Thomas 2009 [A]).
  - Oceanic islands with smaller populations had simpler marine toolkits (n = 10; Kline & Boyd 2010 [V]). Food-
    producing groups show a positive effect (Collard et al. 2013, 40 groups [A]).
  - Western North American hunter-gatherers show none, where risk predicts instead (Collard, Buchanan, O'Brien &
    Scholnick 2013 [A]). Of eight studies, six found no relationship (Vaesen et al. 2016 [V]). Henrich et al. 2016's
    reply says they misread the models [V].
  - The civ layer's economy already caps complex skills by people within reach (CIV_PLAN §9.1). This layer doesn't add
    a second version.
- **Branching and blending.** Cultural datasets fit trees about as well as biological ones (Collard, Shennan & Tehrani
  2006 [L], from summaries; contested by Morrison 2014 [L]). Turkmen textile designs were ~70 % homologous before the Russian conquest
  and ~60 % after. Branching stayed dominant; blending rose (Tehrani & Collard 2002, via Collard & Shennan 2008 [V]).
  Languages are not perfectly treelike either: delta scores average 0.41 for Polynesian and 0.22 for Indo-European
  (Gray, Bryant & Greenhill 2010 [V]).
- **Culture differs more than genes between neighbours.** Cultural F_ST between neighbouring countries averages 0.080,
  more than ten times the genetic F_ST's 0.0053 (Bell, Richerson & McElreath 2009 [V], World Values Survey). So culture
  can hold boundaries that genes don't.
- **Measuring cultural distance:**
  - cultural F_ST = (H_T − H_g)/H_T, averaged over questions (Muthukrishna et al. 2020 [V]): US regions 0.01, China
    0.05, the EU 0.09;
  - cultural fractionalization from structural distances between languages (Fearon 2003 [A]; formula NOT FOUND);
  - ELF at each level of the language tree (Desmet, Ortuño-Ortín & Wacziarg 2012 [V of the working paper]). It is not
    a pairwise distance; the paper sets itself apart from distance-weighted indices.
  - Our d(a, b) is the lexical version of these (§7.10).
- **Religion.**
  - In 96 Austronesian cultures, broad supernatural punishment precedes political complexity, and moralizing high gods
    follow it (Watts et al. 2015 [V]).
  - The Seshat moralizing-gods paper (Whitehouse et al. 2019) was **retracted** in 2021 [V].
  - Christianity's early growth, "40 % per decade" (Stark 1996): from magazines and blogs only [L].
  - A peer-reviewed model of elite-led conversion: NOT FOUND. "Cuius regio, eius religio" is a historical rule (1555),
    used here as a mechanism, not a sourced model.
- **Geography and persistence.** Linguistic diversity persists more where a country's axis runs north–south: about 5
  percentage points per standard deviation of the axis ratio, over 147 countries (Laitin, Moortgat & Robinson 2012 [V]).
  The effect shrinks with state age.
- **Genes and languages.** Genetic clusters of 42 populations correspond to language families, "with very few, easily
  understood overlaps" (Cavalli-Sforza et al. 1988 [A]). Contested in its details, established in outline.

### 3.5 Generating languages and names
- **Inventories** (WALS, Maddieson's chapters [V]):
  - consonants: a mean of 22.7 over 562 languages, from 6 (Rotokas) to 122 (!Xóõ);
  - vowel qualities: five is the commonest number (188 of 564), then six (100);
  - syllable structure: simple 61, moderately complex 274, complex 151 (of 486).
  - UPSID: 11 to 141 segments (Maddieson 1984 [A]).
  - PHOIBLE 2.0: 3,020 inventories, 3,183 segment types, 2,186 languages [V]. The commonest segments: NOT FOUND (to read
    from the data at L0).
- **The sonority sequencing principle:** sonority rises to the syllable's nucleus and falls after it (Clements 1990
  [L]).
- **Regular sound change.** The Neogrammarians' exceptionless sound laws (Osthoff & Brugmann 1878 [L]) against lexical
  diffusion (Wang 1969 [L]). Labov 1981 [A]: instrumental studies of change in progress support the Neogrammarians
  ("change affects all words that include the sound according to their phonetic environment"), while Chinese history
  supports gradual diffusion through the lexicon. In our words, the resolution: low-level phonetic change is regular, and more
  abstract change can diffuse word by word.
- **Catalogues of sound changes:** Kümmel 2007's *Konsonantenwandel* (consonant changes, with their languages and
  conditioning [A]); the Index Diachronica (a volunteer wiki); UniDia (Lyon). Sizes: NOT FOUND. These are the
  catalogue our settings' chains come from (§9.1).
- **Self-organization.** Agents evolve vowel systems like human ones, so innate bias isn't
  needed (de Boer 2000 [L], from a summary; the imitation games are described in his 1997 and 2001 work). Languages passed down chains of learners become structured and easier to learn (Kirby,
  Cornish & Smith 2008 [A]). These justify drift that stays within the space of natural languages, not random strings.
- **Procedural precedents** (what they do, and what carries over):
  - **Rosenfelder's tools** [V]: Gen builds words from phoneme categories and syllable patterns, with a frequency
    dropoff. SCA2 applies sound changes written as `s1/s2/e1_e2` rules, with categories, boundaries and
    exceptions. His *Language Construction Kit* [A].
  - **Lexurgy** [A]: a sound changer. **Vulgar** [A]: a generator of whole conlangs.
  - **Martin O'Leary's naming languages** [V]: weighted inventories, syllable patterns with cluster filters,
    orthography "patches" (French-like ch/j, Slavic-like š/ž), and one syllable per morpheme, reused across names. He
    *tried and rejected* starting from a proto-language with historical sound changes, and abandoned per-region
    languages "because it was too hard to make it clear". That is exactly what this plan does, so its views (§10) must
    make it clear.
  - **Azgaar's Fantasy Map Generator** [V code]: names by Markov chains trained on real name lists ("name bases"), and
    cultures grown from centres by an accumulated cost (biome, height, rivers, type) over a priority queue.
  - **Dwarf Fortress** [V wiki]: one shared list of 3,301 words; each language file is a translation table for them,
    and Dwarven words are used only in names. "The four predefined languages … have no real morphology." Symbols let a
    civilization prefer some word groups. The wiki doesn't say whether languages change over a world's history.
  - **Simulations:** Nettle 1999 [V] puts 400 speakers on a social (not spatial) grid; variation in learning, together
    with differences in social influence, drives change. The Schulze model (Schulze, Stauffer & Wichmann 2008 [V of the
    arXiv review]): languages are strings of F features that mutate, copy from others, and are abandoned for others by
    shift at (1−x)²r. On a lattice it gives roughly lognormal language sizes, with similarity falling with distance.
  - **What carries over:** Rosenfelder's ordered rewrite rules (§9.2); O'Leary's orthography patches as a spelling
    trait (§9.3) and morpheme reuse in names (§9.4); Schulze's copy-and-shift structure. Our version runs it on real
    geography and people, with sourced rates.
  - **What doesn't:** Markov chains on Earth's names (they'd make an Orogen world sound like Earth); DF's static tables
    (no drift that the wiki describes, so no kin).
- **Names keep.** "The names of large rivers are among the diachronically most stable of all words," and "are normally
  retained even when the area is invaded by speakers of another language." Of 92 large European rivers attested in
  Greek or Latin, 87 % keep their ancient names after 2,000 years (Peust 2015 [V]), so ~93 % per millennium. Krahe's "Old European" hydronymy as an Indo-European layer is
  contested (Vennemann 2003 and others [A]). The persistence itself isn't. This is §9.4's naming rule and its rate.

## 4. Quantitative regularities a model can be checked against

The ranges are **bug checks**: a run far outside them has a bug or a missing mechanism. They are not targets to fit.
Most of Earth's language numbers are snapshots of a world reshaped by the last 500 years (colonial spread, schools); the
table says which are, and the checks compare like with like (a modern figure as a sanity range only).

| Regularity | Earth's record | Source | Mark |
|---|---|---|---|
| Languages, families | 7,685 spoken L1 languages in 245 families and 183 isolates (Glottolog 5.4); 7,159 living (Ethnologue 28th ed.) | Glottolog; Ethnologue | [V]/[A] |
| Speakers per language | median ~7,000 (Ethnologue, a blog post [L]); range and speakers both ~lognormal; range rising toward higher latitudes, falling above 60° N | Ethnologue blog; Amano et al. 2014 | [A]/[V] |
| Languages by latitude | tropical countries: ln(languages) = 0.33 ln(pop) + 0.18·MGS − 0.62 (r = 0.63, 43 countries); diversity falls with \|latitude\| after correcting for space and relatedness, and rises with the growing season | Nettle 1998; Hua et al. 2019 | [V] |
| North America at contact | language-group density "six times or more" higher in the south than the north | Mace & Pagel 1995 | [A] |
| Cultures by latitude | 3,814 cultures: density and diversity fall with latitude; tropical cultures have smaller ranges | Collard & Foley 2002 | [A] |
| Family sizes | rank–size slope −1.905 (R² 0.957, Ethnologue families); a size-frequency exponent ~1.5 by our arithmetic | Wichmann 2005 | [V] |
| Australia, a forager continent | 407 languages; a simple fill-and-divide model gives 406 and 56 % of the spatial variation | Gavin et al. 2017 | [A] |
| Retention | ~80.5 % per millennium (200-list), 86 % (100-list); between lineages ~4–20 % lost per millennium | Lees 1953; Swadesh 1955; Bergsland & Vogt 1962 | [A] |
| Half-lives by meaning | most words 2,000–4,000 yr; numerals, pronouns 10,000–20,000+ ("750–10,000": NOT FOUND) | Pagel et al. 2007, 2013 | [A]/[V] |
| Bursts at splits | Bantu 31 %, Indo-European 21 %, Austronesian 9.5 % of divergence | Atkinson et al. 2008 | [V] |
| The comparative method's reach | ~8,000 yr (Nichols, quoted by Renfrew 2000); ≥ ~10,000 (Rankin) | Nichols 1992; Rankin 2003 | [V] Renfrew, Rankin |
| Distance and geography | sublinear; best predicted by log distance (r ≈ 0.47–0.62) | Nerbonne 2010 | [V] draft |
| Diversity and terrain | roughness and river density the only universal predictors (14 tested); up to 80 % of Africa's variance | Axelsen & Manrubia 2014 | [V] |
| Family roots | Bantu ~4,850 / 5,110 BP; Austronesian ~5,230 BP; Indo-European 6,500–9,800 BP (by method); Pama-Nyungan just under 6,000 BP (popular account); Transeurasian 9,181 BP (contested) | §3.1 | [V]/[A] |
| Demic share | cultural diffusion ~40 ± 8 % of the European Neolithic front's speed (a continental average) | Fort 2012 | [V] |
| Elite shift | Anatolian Turkish speakers ~9.6 % Central Asian ancestry | Kars et al. 2021 | [V] |
| Borrowing | WOLD mean ~24 % loans (1.2–62.7 %); nouns 31 %, verbs 14 % | Haspelmath & Tadmor 2009 | [V] |
| Shift | Abrams–Strogatz a = 1.31 ± 0.25 | Abrams & Strogatz 2003 | [V] |
| Name persistence | 87 % of 92 attested large rivers keep their ancient names over 2,000 yr | Peust 2015 | [V] |
| Dialect or language | LDN 0.51 (≈ 1,075–1,635 yr apart) | Wichmann 2019 | [V] |
| Intelligibility | lexical distance explains R² 0.57 (all pairs), 0.89 (Germanic) | Gooskens & van Heuven 2020 | [V] |
| Cultural vs genetic distance | neighbours' cultural F_ST 0.080 against genetic 0.0053 | Bell et al. 2009 | [V] |

Which don't depend on Earth's map, and so can be read off any world:
- the distance–geography curve's shape;
- retention and half-lives (as consistency checks of the code);
- languages by latitude and growing season;
- range and family size distributions;
- diversity against roughness;
- bursts at splits;
- name persistence.

Earth's own checks are the family roots and areas, the demic share, Australia's count and the Bantu route.

**What a 160K mesh can resolve.** A cell is ~3,200 km². Earth's 7,685 languages over ~134 Mkm² of ice-free land (a round figure [L]) average
~17,000 km², about five cells, but the median is far smaller: New Guinea's languages are sub-cell. So the model resolves
the forager continents (Australia: ~2,400 cells for 407 languages) and the farmed plains. Tropical horticulturalists'
diversity is a known limit (§14 Q1), and density checks use bands of latitude, not cell counts.

## 5. Existing models, and what carries over

| Model | What it is | Result | What carries over | What doesn't |
|---|---|---|---|---|
| Stepping-stone and voter models (Kimura & Weiss 1964; the voter model with innovation) | demes on a lattice exchange migrants; alleles mutate | similarity falls with distance; correlation length √(D/μ) | the core of §7.3, with words as alleles | random mating within a deme (our cell holds one lect) |
| Burridge 2017 (PRX) | speakers average neighbours' variants, weighted by density, with memory | isoglosses with surface tension, pushed away from dense centres; Séguy's curve analytically | density weighting (N_b/N_a); a check that boundaries straighten and move off cities | no innovation; continuous frequencies per variant |
| Abrams & Strogatz 2003 and extensions (Mira & Paredes; Patriarca & Leppänen; Kandler et al.; Castelló et al.) | the share of speakers of two languages, with status | one dies unless similarity, bilingualism or separation keeps both | §7.5 as written, with migration and similarity | two languages at a time, no words |
| Schulze, Stauffer & Wichmann 2008 | languages as strings of features: mutation, copying, shift by (1−x)² | roughly lognormal sizes; similarity falls with distance | copy-and-shift as separate processes; the size distribution as a check | lattice units not geography; abstract features |
| Nettle 1999 | 400 learners on a social grid, influence by status and distance | change from learning variation plus social influence | status as a weight on input | not spatial |
| Gavin et al. 2017 | groups fill space, density by rainfall, split past a size | Australia's 406 of 407 languages | the Australia check; density from the land (ours from the civ layer) | the split-at-size rule (ours emerges) |
| Bayesian phylogenetics (Gray, Atkinson, Bouckaert, Pagel…) | cognate-class data, rate models, dated trees | the families' roots and routes | the cognate-class state (§6), Pagel's rates, the reconstruction check (§7.9) | — (they infer; we simulate) |
| Rosenfelder (Gen, SCA2), Lexurgy | word generators; ordered rewrite rules | conlangs with histories | the ordered rules and categories (§9.2) | hand-written rules |
| O'Leary's naming languages | weighted inventories, syllable patterns, orthographies, reused morphemes | readable fantasy names | spelling patches as a trait; morphemes reused across names | static: no families, no change |
| Azgaar's FMG | name chains from Earth name lists; cultures by cost expansion | legible maps | the legibility of cost-grown cultures | Earth's names; one-shot cultures |
| Dwarf Fortress | translation tables of a shared word list; compound names | memorable names in Legends | compound names from meaningful words (§9.4) | no drift described, no kin |

## 6. State

**Per peopled cell** (on the civ mesh):

| Variable | Meaning | Type |
|---|---|---|
| `lex[c·M + m]` | the cognate class of meaning m in the cell's lect, for M meanings (M = 40, ASJP's list; §7.2) | Uint32 × M |
| `phon[c·P + k]` | the value of phonological and grammatical setting k (P ≈ 20; §9.1) | Uint8 × P |
| `phonT[c·P + k]` | when setting k took its value (for the order sound changes apply in, §9.2) | Float32 × P |
| `rival` | the cell whose lect is the second language here (a rival or ruler's lect), or −1 | Int32 |
| `x` | the share speaking the rival's language (Abrams–Strogatz's x; 0 where no rival) | Float32 |
| `trait[c·Q + q]` | cultural traits (practices, religion), Q ≈ 16 (§7.8; later stage) | Uint16 × Q |
| `lang`, `family` | the language and family it belongs to (read off, §7.9; recomputed every frame) | Int32, Int32 |

At 160K cells, ~50K of them land: `lex` is ~8 MB, `phonT` ~4 MB, the rest ~3 MB.

**The lineage** (`lineage.js`, small):
- languages: id, its representative lect (that of its most populous cell), its cells' count and people, its parent
  language and the date it split (or −1 for the origin), its death date;
- the tracked tree: every language that ever lived, with parent, birth and death, so any two languages' most recent
  common ancestor (MRCA) and its date come from walking up the tree;
- families: the clades below the reach of the comparative method (§7.9);
- names (§9): each language's endonym; the named places (towns, big rivers, regions) with their coiner and their
  underlying form.

**What it reads each step** (from the civ run, and from the nation layer once it exists): density `d`, `life`, the
step's new arrivals (`arrival` and `cameFrom`, the voyages' landings), new farm arrivals (`farmArrival`, `farmFrom`),
towns (settle.js), polities or realms (owner, suzerain, hold, ruling culture, capital), and the travel graph (once).

## 7. Mechanisms, each with its sources

The order in a step:
1. inheritance (newly peopled cells, farmers' arrivals);
2. drift: innovation of new words and sound changes;
3. contact: words and settings copied from neighbours;
4. shift: the rival language's share, and the swap when it wins;
5. every frame, read off languages, families and the tree.

Every chance is a hash of (cell, step, slot, salt), as `chance` in sim.js, so runs are deterministic (§11.2).

### 7.1 Inheritance: along `cameFrom` and `farmFrom`
- **A newly peopled cell copies its source's lect:** words, settings and traits. This includes the forager front, a
  voyage's landing (from its launch cell) and a cell resettled when the sea drowns its shelf. A front is a run of founder
  events. This is where the founder effect lives, if there is one (§3.5: Atkinson 2011 and its critics). The model
  doesn't shrink inventories on purpose; the check of §11.1 sees whether anything like it emerges.
- **Farmers arriving where people live** don't replace them. They bring their lect as the cell's **rival**, with a
  share x₀ (§7.5). Whether the cell's language changes is decided by the shift dynamics, not by the arrival.
- **Sea over the shelves:** where the rising sea moves a shelf's people into a peopled coast (sim.js's "the two mix"),
  the coast's people get the shelf's lect as a rival, with x₀ the shelf's share of the merged people.
- Sources: the farming/language dispersal (Bellwood & Renfrew; Diamond & Bellwood 2003) as the demic case;
  Fort 2012's demic–cultural mix as the reason both outcomes must be possible (§3.1).

### 7.2 Drift: innovation of words and sounds
- **The basic list.** M = 40 meanings, the ASJP list (Holman et al. 2008; the list as given in secondary sources [V]):
  eye, ear, nose, tongue, tooth, hand, knee, blood, bone, breast, liver, skin; louse, dog, fish, horn, tree, leaf;
  person, name; sun, star, water, fire, stone, path, mountain, night; drink, die, see, hear, come, new, full; one, two,
  I, you, we. These are the Swadesh items most stable and most useful for classifying. Each meaning m has its own replacement rate λ_m = ln 2 / h_m, from Pagel et al.'s per-meaning
  half-lives h_m: 2,000–4,000 yr for most words, 10,000–20,000 and more for numerals and pronouns (§3.2). The 40 rates
  are the quantiles of that distribution, read from their data at L0, so the model's mean retention per millennium is an
  output to check against Lees 1953 and Swadesh, not an input.
- **Innovation.** Each step, meaning m in cell c gets a new cognate class with probability 1 − e^(−λ_m · 25 yr). The
  new class's id is a hash of (cell, step, meaning), so it is new to the world.
- **Why the rate is per cell and still right.** In the voter model an innovation in one cell usually dies out; one in
  k cells fixes across a k-cell language. A language's substitution rate is then λ_m, the per-cell innovation rate,
  whatever its size (Kimura's neutral result [L]). So Pagel's rates, measured between languages on a tree, are the rates the
  cells run at. Atkinson et al. 2008's punctuational bursts at splits (§3.2) aren't added by rule. Whether something like
  them emerges at the founding of small daughter populations is a check.
- **Population size.** Bromham et al. 2015 find larger populations gain words faster and smaller ones lose them faster
  (§3.2). That is selection on words, not neutral drift. It is left out at first and kept as a check: the run's rates
  by language size against theirs.
- **Sound changes** (§9.2): each setting changes at its own rate, to a neighbouring value.

### 7.3 Contact: dialect continua and isolation by distance and barriers
- **The voter model on the travel graph.** Each step, each meaning (and each setting) of cell a may take the value of
  a neighbour b, with probability 1 − e^(−m_ab·25 yr). The rate:
  - m_ab = k_ab · (N_b / N_a) · g(sim_ab) · p_b, capped so that a cell keeps at least half its own input;
  - **k_ab = 4D / (deg_a · ℓ_ab²)** is the per-neighbour rate of a 2-D diffusion with diffusivity D on the mesh (on a
    six-neighbour lattice, Σ_b k_ab ℓ² = 4D). ℓ_ab is the **edge's effective distance**: its days on foot (or by boat,
    where boats exist) times a day's walk on the flat. A mountain edge that takes three times as long carries a ninth
    of the contact, and a sea with no boats carries none. Barriers act through travel time only;
  - **N_b / N_a** turns forward dispersal into the share of a's learners whose input comes from b (backward migration:
    a dense neighbour speaks to a sparse cell more than the reverse);
  - **g(sim)** is how far two lects understand each other. It is 1 within a dialect continuum and falls to a
    borrowing floor b_loan between mutually unintelligible lects (smooth in lexical similarity, between s_lo and s_hi).
    Among measured linguistic distances, lexical distance is the best predictor of how well related European languages
    understand each other once exposure is set aside: R² 0.57 over all pairs, 0.89 within Germanic, though syntax
    leads within Romance (Gooskens & van Heuven 2020 [V]). Exposure outweighs all of them; here that is contact. s_hi is set at s_lang (§7.9).
    Neighbours who can't understand each other don't level their words; they borrow (§7.6) and shift (§7.5);
  - **p_b** is b's prestige: 1 by default; towns and ruling cultures raise it (§7.5).
- **D, the diffusivity,** comes from human dispersal per generation, not from language data: D = ⟨Δ²⟩ / (4T), with
  ⟨Δ²⟩ the mean squared displacement in a generation of T years.
  - **Farmers:** Fort 2012's ethnographic kernel for preindustrial farmers [V] puts 42 % of children within 2.3 km of
    their parents and 1 % at 100 km. That gives ⟨Δ²⟩ ≈ 360 km² (our arithmetic), so D ≈ 3 km²/yr at T = 30 yr.
  - **The Neolithic front models** use D ≈ 12.5 km²/yr after Ammerman & Cavalli-Sforza (Davison et al., arXiv
    q-bio/0505013 [V]). That is the upper value.
  - **Foragers** are more mobile. Their kernel (Fort, Pujol & Cavalli-Sforza 2004) wasn't reached; it is read at L0.
  - D is a property of the way of life, so the cell's `life` selects it.
  - Speech is learnt from parents and neighbours, so the flux of speakers is taken as the flux of people. That is an
    assumption, and labelled as one.
- **What it predicts, as checks, not rules:**
  - **Isolation by distance.** In a 2-D stepping-stone model, identity falls off with distance like the Bessel
    function K₀(r/ξ), close to logarithmic over a wide range (Malécot; Kimura & Weiss 1964 [L]: the standard result,
    not read in the primary). Dialectometry finds lexical distance growing about as the log of geographic distance, in
    Bantu, Bulgarian and Dutch data (Nerbonne & Heeringa 2007, in Nerbonne 2010 [V draft]). Burridge's saturating
    Séguy curve is the other candidate; the check tells them apart. It is the strongest single check on the contact rule (§11.1).
  - **Correlation length** ξ_m ≈ √(D/λ_m). For a word of half-life 3,000 yr it is ~110 km at the farmers' D = 3 km²/yr
    and ~230 km at 12.5. For one of 20,000 yr it is ~290–600 km. So a language spans one to a few hundred km where people
    are spread evenly, two to four cells at 160K; that is why §11.1's scale check matters. Fast meanings vary over
    shorter distances than slow ones, as dialect atlases show.
  - **The log law has a population-genetic twin:** in two dimensions, F_ST/(1 − F_ST) between demes grows linearly in
    the log of distance (Rousset 1997 [A]). The log law of dialectometry is that law, with words for genes.
  - **Barriers.** Rugged land and rivers raise diversity (Axelsen & Manrubia 2014), because they cut contact.
  - **Isogloss dynamics.** Boundaries between dialect domains behave with a surface tension: they straighten, and
    they are driven away from dense population centres toward thinner people (Burridge 2017). The N_b/N_a term is that
    push.
- **Towns and routes** (later stage, with T2's trade flows): contact along trade links, by Trudgill 1974's gravity
  model (P_i · P_j / d²), adds the hierarchical, town-to-town diffusion of innovations dialect geography sees.

### 7.4 Splitting
- **Nothing triggers a split.** Where contact across a group of cells falls below what holds it together against
  drift, its parts drift apart, and once similarity drops below s_hi, g(sim) cuts contact further. So divergence is
  self-reinforcing, and a split, once begun, sticks.
- **What drives splits:** distance (a range much wider than ξ); thin people (a desert or a cold fringe); barriers in
  travel days; sea crossings, at the founding of an island population; and new, sparsely peopled land at a front.
- **Its date** is when the lineage reader (§7.9) first sees two languages where it saw one.

### 7.5 Shift, bilingualism and death
- **The rival language.** A cell has at most one rival: the lect of incoming farmers (§7.1), of a merged shelf
  population, of an unintelligible neighbour whose contact input is the largest, or of its ruler (from the nation
  layer, or polity.js's capital before it). x is the share of the cell's people who speak it.
- **The dynamics: Abrams–Strogatz with migration.** dx/dt = c[(1−x)·x^a·s − x·(1−x)^a·(1−s)] + Σ_b m'_ab·(x_b − x):
  - the first term is Abrams & Strogatz 2003. a = 1.31 (their fit to 42 regions); s is the rival's status. With a > 1,
    x = 0 and x = 1 are both stable: two languages in one place don't coexist, and the majority, weighted by status,
    wins;
  - the second is the flux of speakers from neighbours that speak the rival (m' is §7.3's k_ab·N_b/N_a without g). With
    it, the model becomes a spatial version like Patriarca & Leppänen 2004's (coexistence in separate regions [A]) and
    Kandler et al.'s reaction–diffusion of monolinguals and bilinguals;
  - c is a rate (per generation), set on Earth's records of shift: the Celtic languages' decline curves (Kandler et al.
    2010); Weber 1976's France [L here; NATION_PLAN marks it V], which NATION_PLAN §7.4 already uses.
- **x₀ for farmers arriving.** The newcomers are the farm front's seed, the same `seedShare` of the new capacity that
  sim.js gives an empty cell, against the residents: x₀ = σK_F / (σK_F + d_res). Farmers live at 10–100× forager
  density, so x₀ runs from ~⅓ (dense, settled foragers) to over ⅘ (thin foragers). The model then decides by numbers
  and status:
  - where farmers' numbers swamp the residents, their language spreads with their farming: the farming/language
    dispersal;
  - where packed foragers adopt farming before many farmers arrive, the foragers keep their language. These are the
    critics' cases (§3.1).
  - Neither outcome is a rule, and Fort 2012's demic share is a check on Earth (§11.1).
- **Status s.** It is ½ (neutral) unless something raises it:
  - **the rival is the ruler's** (nation layer): s rises with the hold. Administered land counts for more than
    tributary land, and more again where the rival is spoken in the seats and towns (NATION_PLAN §7.4a's "status a
    culture gets from ruling"). Elite dominance (Renfrew 1987) is this case: a small ruling class whose language spreads
    because of its status, not its numbers;
  - **towns:** a town's lect has more status in its hinterland;
  - **the national stage** (NATION_PLAN §7.8, N6): schools raise the state language's status (Weber 1976).
- **The swap.** When x passes ½, the cell's lect becomes the rival's. Thomason & Kaufman 1988 say what a shift keeps
  of the old language:
  - **words:** a few. Each meaning keeps its old cognate class with a small substrate probability r_lex;
  - **sounds and grammar:** much more. Each setting keeps its old value with probability r_phon > r_lex. A language
    learnt by a shifting population carries their accent into it;
  - **names:** the places keep theirs (§9.4).
  - The old language then becomes the rival at x = 1 − x, so it can die out there, or come back if its status rises.
- **Bilingualism** is x between, say, 0.1 and 0.9. It is when borrowing runs fastest (§7.6). The Abrams–Strogatz
  extensions that allow stable bilingual coexistence between similar languages (Mira & Paredes 2005; Castelló et al.
  2006) enter through g(sim): similar lects level by contact rather than compete.
- **Death:** a language dies when its last cell shifts or empties. The lineage records the date and who replaced it.

### 7.6 Borrowing and areal features
- **Loans into the basic list.** Between unintelligible lects, meaning m crosses at the borrowing floor b_loan · β_m,
  and faster in bilingual cells: b_loan · β_m · (1 + x/x_b). β_m is m's borrowability, low for the ASJP list (WOLD's
  borrowing ranking, the Leipzig–Jakarta list, puts basic meanings last, §3.3; the ASJP items' own β is to be read from
  WOLD at L0). A loan is the same cognate class, so lexical distance between
  neighbouring languages falls, which is why lexicostatistics overstates closeness in contact zones.
- **The borrowing scale.** Casual contact passes words; intense, long contact with widespread bilingualism passes
  sounds and structure (Thomason & Kaufman 1988). So settings cross between unintelligible lects only in bilingual
  cells (x past a level), at their own rates.
- **Areal features and Sprachbund.** Settings that cross language boundaries this way and accumulate over centuries
  give linguistic areas: unrelated languages sharing sounds and grammar (Emeneau 1956's India; the Balkans). That is an
  outcome to look for (§11.1), not a rule.
- **Culture traits** borrow far more freely than basic words (§7.8).

### 7.7 Blending: koinés, mixed languages and creoles
- **Koinés** (dialect mixing in new towns, Trudgill's new-dialect formation): a town drawing people from many
  mutually intelligible lects gets, by the voter model, a lect mixed from its inputs, with each meaning's majority
  variant. That is a koiné, with no extra rule.
- **Mixed languages and creoles** need conditions the agrarian world rarely makes: a new population assembled from
  many unintelligible languages, with no majority, under a dominant lexifier. Plantation colonies and trade ports are
  the record's cases (§3.3). The rule, as a later stage:
  - where a cell's inputs (new people within a few generations) have no lect over a share f_mix, and the top one has
    status;
  - the new lect takes the top one's words (the lexifier), but its settings reset toward the least marked values (the
    simplification McWhorter 2001 finds in creole grammars), or keep the substrate majority's;
  - it is a new language in the tree with the lexifier as parent and a "creole" flag.
  - It is the one rule here that writes an outcome. It stays off until the colonial horizon (NATION_PLAN §14 Q1 (c))
    or a trade-port case needs it.

### 7.8 Culture beyond language: practices and religion (later stage)
- **Traits.** Q ≈ 16 cultural traits per cell, each with a few values, drawn from the Ethnographic Atlas's kinds of
  variable (Murdock 1967). Examples: descent, residence after marriage, marriage form, burial, house form, the main
  cults. The way of life (forager, farmer, herder) is already the civ layer's, and know-how (crops, boats, irrigation,
  metallurgy) is the economy's skills model (CIV_PLAN §9.3). Neither is duplicated here.
- **Transmission** follows Boyd & Richerson 1985's biases:
  - vertical, inherited along `cameFrom` like the lect;
  - horizontal, by the same contact as §7.3, but with no intelligibility barrier and at each trait's own rate. Traits
    cross language boundaries more freely than words;
  - conformist: adoption grows faster than linearly with a trait's local share (the Abrams–Strogatz exponent plays this
    role);
  - prestige: from towns and rulers.
  - Collard, Shennan & Tehrani 2006 find cultural data about as treelike as biological. Traits are therefore neither
    wholly inherited nor wholly borrowed.
- **Religion** is one trait with two extra rules from the record:
  - **rulers convert their realms,** at a rate set by the hold (cuius regio, eius religio): the status term again;
  - **missionary religions spread along routes and through towns,** faster than practices. A religion takes this
    property at its birth, as a hashed trait.
  - The moralizing-gods dataset (Whitehouse et al. 2019) was retracted, and NATION_PLAN doesn't use it. Neither does this
    plan.
- **Henrich's population size and complexity:** already in the economy, where complex skills are capped by the people
  within 50 km (CIV_PLAN §9.1). It is contested (Vaesen et al. 2016) and lives there, not here.

### 7.9 Reading languages, families and the tree off the field
Every frame (the civ frames' `frameYears`, and on demand for the nation layer):
- **Languages.** Seeds go in order of people, so the largest cell first. A language is the connected set of cells
  whose lexical similarity to its seed's lect is at least s_lang. Each seed is the most populous cell not yet taken.
  This is leader clustering; a connected-components rule on similar neighbours would chain a whole dialect continuum
  into one language. s_lang is where a dialect ends and a language begins:
  - **sourced:** Wichmann 2019 [V] proposes a universal cut-off between dialect pairs and language pairs at ASJP's
    normalized Levenshtein distance LDN = 0.51 (mean 0.514 ± 0.071), about 1,075–1,635 years of separation;
  - in L1, with no word forms yet, s_lang is the cognate similarity our rates give after that separation (~1,350 yr),
    so the threshold is derived, not tuned;
  - from L3, on generated forms, it is LDN = 0.51 itself, measured as ASJP measures it.
- **Tracking.** Each new language takes the id of the previous frame's language with which it shares the most cells.
  A previous language whose cells now fall under two or more ids **split**: the first keeps the id and the others are
  its daughters, dated to this frame. One whose cells are all taken by another **died**, by shift or emptiness.
- **Families.** Two languages are in one family when their MRCA in the tracked tree is younger than T_detect, the
  comparative method's reach (T_detect ≈ 8–10 kyr; §3.2). Older relations are real in the run but undetectable, as on
  Earth. An
  isolate is a family of one. Counts and sizes are checks (§4, §11.1).
- **Reconstruction, as a check:** a tree built from the 0 BP lects alone (lexical distances, UPGMA or neighbour-joining)
  against the tracked tree. This is how far a linguist looking only at today's lects would get the history right, and it
  is a test of the method, not the world.

### 7.10 Cultural distance, for the nation layer
- **d_lex(a, b)** = the share of the 40 meanings where the two lects' cognate classes differ: 0 for the same lect, 1 for
  lects that share nothing. Unrelated lects share nothing, since every class is unique, so there are no chance
  resemblances.
- **d_trait(a, b)** = the share of traits that differ (once traits exist).
- **d(a, b)** = (w_L·d_lex + w_T·d_trait) / (w_L + w_T), equal weights until a reason appears. It is a distance in [0, 1],
  as NATION_PLAN §7.4a asks.
- **The tree distance** is the MRCA's age, for when the nation layer wants "how long ago were we one people". It is
  given alongside d.
- These match the measures in the literature: Fearon 2003's structural distances between languages, and Muthukrishna
  et al. 2020's cultural F_ST (§3.4). Desmet et al. 2012's ELF by tree level can be computed from the tracked tree for
  any realm, if the nation layer wants a fractionalization index.

## 8. The seam with the nation layer

### 8.1 What the nation layer reads from here (NATION_PLAN §7.4a), each step
- **culture per cell:** `lang[c]` (the language id) and `family[c]`; the rival's language and share x where two mix
  (§7.5), for §7.5's minorities and §7.8's homogeneity;
- **culture per town:** the town's cell's language, for seats, capitals and a polity's ruling culture;
- **distance d(a, b)** between two cells' or two languages' lects (§7.10), and the MRCA age;
- **names** (§9): for a cell, town, river, region, people or realm, in a given language: `nameOf(kind, place, lang)`.
  Daughter languages' names drift from their parents' through their own sound changes;
- **writing:** not owned here (§14 Q7).

### 8.2 What it reads from the nation layer, each step
- per cell: the administering polity, its suzerain, the hold (administered, tributary or none);
- per polity: its ruling culture (the capital's language), its seats and towns, and conquest settlement (which seats
  were settled by the ruling culture's people);
- the status s of a ruling culture in each cell it holds (§7.5); and, from N6, the national stage's schooling.

Conquest settlement brings the rulers' lect in as people, not just status: settled seats copy it as the cell's lect,
or as the rival with x₀ as §7.5's newcomers.

### 8.3 Order and independence: which lands first
- **The culture layer lands first** (§12 L1–L3). It runs on the civ layer alone: arrivals, farming, towns, and polity.js's
  capitals for the status term. Its outputs (maps, the tree, names) are worth having with no nation layer.
- **The nation layer's N3 consumes it.** Until it does, NATION_PLAN's N0–N2 run with no culture: asabiya and
  legitimacy have no culture term, as polity.js has none now.
- **Then the coupling:** the culture step reads realms (owner, hold, ruling culture) in place of polity.js's capitals.
  It changes no people. Feedback onto the people runs through the nation layer's own N4, which uses culture (for
  rebellion and asabiya).
- Each side reads the other's state from the step before, so either can be switched off and the other still runs.

## 9. Names: from each language's phonology, through its sound changes

### 9.1 What a lect's phonology is
P ≈ 20 settings, each with a few values. They are typological features of the kind WALS maps (§3.5):
- **inventory:**
  - vowel qualities (3, 5, 7, 9);
  - vowel length (yes/no);
  - stop series (one; voiced and voiceless; plus aspirated or ejective);
  - fricatives (few, many);
  - nasal vowels;
  - tone (none, two levels, more);
- **phonotactics:**
  - largest onset (C, CC, CCC);
  - codas (none, sonorants only, any);
  - word shape (stress initial or penultimate);
- **processes, each a stage along a chain:**
  - lenition (none, intervocalic voicing, spirantization, loss);
  - palatalization before front vowels (none, k→tʃ, all velars and dentals);
  - final vowel reduction (none, schwa, loss);
  - vowel harmony;
  - l/r merger;
- **naming grammar:**
  - modifier–head order in compounds;
  - genitive order;
  - whether the people's affix is a prefix or a suffix (a Bantu-like ba- or a -ni);
  - the place affix.

The founding lect at the origin draws its settings from Earth's frequencies (the commonest values most likely;
PHOIBLE, WALS). From there they change by drift and contact like the words, each at its own rate.

### 9.2 Sound change as regular rules, in the order they happened
- **A change is a value step** along a setting's chain (no lenition → intervocalic voicing, codas any → sonorants
  only), with a rate per setting. The rates are ours. Greenhill et al. 2017 find most grammatical features change
  faster than basic vocabulary, around a stable core, so settings are not assumed slower than words. Dediu & Cysouw
  2013 [V] rank 62 WALS features over seven methods: word order (genitive–noun, object–verb, adposition) is the most
  stable area, and phonology spans the whole range (front rounded vowels near the top, consonant inventories and
  voicing near the bottom). Their ranking orders our settings' rates.
- **Each setting is a function on word forms,** applied to every word. That is the Neogrammarian regularity (Osthoff &
  Brugmann 1878). Labov 1981's resolution of lexical diffusion, that sound changes are regular at the level of
  phonetic categories, is enough here.
- **Order:** a lect applies its changes in the order it took them (`phonT`), so relative chronology matters as it does
  in real histories. For example, lenition before final vowel loss gives a different word from the reverse. Two kin
  that took the same changes in a different order differ in exactly the words those changes touch.
- **Changes that make new contrasts:** palatalization makes a new series, and lost codas can give tone or nasal
  vowels (tonogenesis). Each is a chain step whose function changes the inventory.

### 9.3 Word forms
- **The underlying form** of a cognate class is generated from its id (a hash): one to three syllables over a
  maximal segment set, with segments drawn by their frequency in the world's languages (PHOIBLE). Meanings used more
  often get shorter forms: Zipf's law of abbreviation, which the frequency ranking already carries.
- **The surface form in a lect** is the underlying form passed through the lect's settings in their order: its
  inventory's mergers, phonotactics (clusters broken or dropped, codas lost, the sonority sequencing principle), then
  the processes.
- **Why kin sound alike.** Two daughters of one language share most cognate classes, so the same underlying forms,
  and most of their settings, so the same rules. Their words differ only by the changes they don't share. Unrelated
  neighbours in a linguistic area share settings but not classes, so their words have the same feel but aren't the
  same words. That is the difference between cognates and areal resemblance.
- **Loans** keep the lender's class, so the borrower's own settings reshape them: loans are adapted to the borrower's
  phonology.
- **Spelling.** A lect's romanization (which letters stand for /ʃ/, /x/, long vowels) is a cultural trait inherited
  and borrowed like the others. Related languages spell alike, and names stay readable in Latin letters.

### 9.4 Names of places, peoples and realms
- **Compounds** of meanings from an extended naming list (water, river, hill, stone, people, house or town, big, new,
  white, red, black, sun, and so on), in the lect's compound order, with its people and place affixes. The naming list
  (~30 more meanings) drifts like the basic list, at the faster rates of ordinary vocabulary.
- **Endonyms:** a people's name for itself is built on its word for "people" or "person". This is a widespread pattern;
  it is treated as a pattern, not a law.
- **Places are named once and keep their names.** A place (a town, a big river, a region) is named by the lect that
  first lived there, when it is first peopled or founded. Its underlying form is stored. Later languages there say the
  same name through their own settings: they borrow it, adapt it, and don't coin a new one. This is why river names are
  the oldest layer of toponymy, surviving language shift (Krahe's Old European hydronymy; §3.5).
  - A place is renamed only at a hazard: conquest settlement, or a town refounded. So the map carries the record of
    who was there first.
- **Realms** (NATION_PLAN N7) take the name of their capital, or their ruling people's name with the place affix
  ("land of the X"). A daughter state's name drifts with its language.
- **Exonyms:** each language's name for another people is that people's endonym passed through the speaker's settings
  (a loan). So one realm is known by kin-sounding names around it.
- **Deterministic:** everything is a hash of the world's ids, so the same world gives the same names.

### 9.5 An example of the intended behaviour (made up, to show the mechanism, not a result)
- A parent language has the classes "water" *kapu and "people" *tami, and puts the modifier first.
- **Daughter A** took intervocalic voicing, then final vowel loss: *kapu → kabu → kab; *tami → tam. Its people are the
  "Tamkab" (people + water).
- **Daughter B** took final vowel loss, then intervocalic voicing: *kapu → kap (no stop is left between vowels to
  voice); *tami → tam. Its people are the "Tamkap". The same two changes in the other order give a different word:
  relative chronology.
- **A third, unrelated lect** in the same area shares A's voicing but none of its classes. Its "water" is ʃeno and its
  "people" omba, so its names have A's sound pattern but not A's roots.
- A and B's names share roots (tam-, ka-) that the third lect's don't: kin by descent. A and the third lect share a
  sound pattern: an areal resemblance.

## 10. Views

All on the People layer, from model quantities; the view only colours them.

| View | What it shows | The quantity behind it |
|---|---|---|
| **Languages** | each language a colour, with related languages in related colours (hue by family, shade by branch); bilingual cells hatched in the rival's colour | `lang`, `family`, x |
| **Families** | families only, so spread zones (one family over a wide area) and residual zones (many families in the hills) show at a glance | `family` |
| **Dialect boundaries** | each edge between cells drawn with a weight ∝ the lexical distance across it: a dialectometry "honeycomb" map, where boundaries emerge as bundles of edges | d_lex across each edge |
| **A word** | pick a meaning ("water"); colour by cognate class, and label each class with its surface form in each language: a dialect atlas sheet | `lex[·, m]`, §9.3 |
| **A sound** | pick a setting (lenition, tone); colour by value, so areal features and their spread show | `phon[·, k]` |
| **Cultures** (later) | traits, religion | `trait` |

- **Time.** Frames every `frameYears` replay languages spreading, splitting and dying on the People layer's timeline,
  and on the nation layer's (NATION_PLAN §10.3) once it exists.
- **The tree.** A side panel: the tracked tree, dated, coloured as the map. Click a branch to light up its cells; click
  a cell to find its language in the tree. Families are boxed at T_detect, and dead languages are drawn as ended
  branches.
- **The readout** at the pointer:
  - the language's endonym, its family and its nearest kin;
  - a few of its words ("water: kal, stone: dun");
  - the place's name and who named it ("Sedra, named by the Old Kalish c. 4.2 ka");
  - the rival language and its share, where there is one.
- **The language card** (click): its dates, its parent and daughters, its area and people over time, its sound
  changes in order, its word list beside its parent's, and the names its speakers gave.

## 11. Checks, determinism and cost

### 11.1 Earth checks (bugs, not targets) and the ensemble
On `civ-sim --earth` and the ensemble, as `report()` lines that never fail a run. The ranges are §4's.
- **Isolation by distance:** lexical distance against geographic distance among cells, binned. The curve should be
  sublinear, close to logarithmic (Séguy; Nerbonne). This is the first check, and it needs no Earth map.
- **Retention:** the share of the basic list kept per millennium down the tracked tree (an output; Lees' ~80 %) and
  each meaning's half-life against its input (a consistency check of the code).
- **Language density by latitude:** languages per 10⁶ km² by latitude band and by growing season (Mace & Pagel 1995;
  Nettle 1998; Collard & Foley 2002). At 160K, a cell is ~3,200 km², so the model resolves languages down to a few
  cells; the check is on bands, not counts.
- **Range sizes:** languages' areas and speakers, roughly lognormal, with ranges growing toward higher latitudes and
  shrinking again above 60° N (Amano et al. 2014).
- **Families:** the count of families and isolates per land area, and family sizes against Wichmann 2005's power law.
- **Spread and residual zones:** on Earth, the families covering the Bantu, Austronesian and Indo-European areas at
  0 BP, and their MRCA ages against the published roots (§3.1, §4). Whether the Bantu front's languages skirt the
  rainforest (Grollemund et al. 2015). Whether the Caucasus and the New Guinea highlands are residual zones (many
  families per area).
- **Demic share:** on Earth's European farming front, the share of cells whose lect became the farmers' against the
  share whose people kept theirs. Fort 2012's ~40 % cultural is a share of the front's speed, not of cells, so this is a
  sanity range, with ancient DNA's ancestry shares (Haak et al. 2015) beside it.
- **Barriers:** diversity against ruggedness and river density (Axelsen & Manrubia 2014).
- **Australia:** the number of languages on Earth's Australia at the eve of contact, and their spatial pattern, against
  the record's 407 and Gavin et al. 2017's model (406, 56 % of the spatial variation). A forager continent at a
  resolution the mesh holds (~2,400 cells).
- **Bursts at splits:** the share of lexical divergence that arises near splits in the tracked tree, beside Atkinson et
  al. 2008's 9.5–31 %. Nothing builds bursts in, so any found are emergent.
- **Rates and population size:** gains and losses of cognates by language size, beside Bromham et al. 2015 (larger gain
  faster, smaller lose faster). Under neutral drift the model should show none; a difference is a finding.
- **Name persistence:** the share of big rivers' names kept over 2,000 years, beside Peust 2015's 87 %. This checks the
  renaming hazard of §9.4.
- **Kin sound alike:** the normalized edit distance between generated names against the lexical distance between
  their languages. It should rise with distance, and unrelated languages should sit at chance.
- **Founder effects:** inventory size (from the settings) against the distance from the origin along `cameFrom`. Report
  only, since the record is contested (Atkinson 2011 against Cysouw et al. 2012, Hunley et al. 2012, Creanza et al.
  2015).
- **Scale:** the same world at 40K and 160K (as `check-civ-food` does). The correlation length in km and the language
  count per area at scales above both meshes' cells should agree.
- **Gene–language congruence** (optional, with §14 Q6's ancestry field): Cavalli-Sforza et al. 1988.

### 11.2 Determinism
- Every chance is a hash of integers (cell, step, slot, salt). Class ids are hashes. Contact rates are computed once,
  on the CPU, and handed to the step as integer thresholds, so the step uses only integer arithmetic. Its result is then
  the same on every GPU (Metal, D3D12, Vulkan) and on the CPU reference. That answers the agent brief's "determinism
  across GPUs" for this process: they agree bit for bit.
- Class ids are 32-bit hashes. A collision makes two unrelated classes look alike. With ~10⁴ live classes per meaning
  at once, the chance of any collision in a run is ~10⁻² per meaning (birthday bound), and its effect is one shared word.
  Accepted, and noted; 64-bit ids (two u32) if it ever matters.
- The lineage reader breaks ties by cell index.
- `civ-fingerprint.mjs` grows a culture section (each frame's labels, the tree, a hash of the lects).

### 11.3 Cost (estimates, to measure)
- **The step:** ~50K land cells × (40 meanings + 20 settings) × ~6 neighbours, 2800 steps from 70 ka. That is
  ~8·10⁹ slot updates and ~5·10¹⁰ neighbour reads a run if every land cell were peopled
  throughout; ~5·10⁹ allowing for the cells peopled late (to measure):
  - **on the CPU in JS:** ~1 min at 160K (by the civ layer's own measured throughput), against the People run's ~18 s.
    Too slow;
  - **on the GPU** (one WGSL kernel per step: every slot of every cell in parallel, reading its neighbours'
    previous values; integer hashes): ~1–3 s for a run at 160K, mostly dispatch overhead. This is the agent brief's rule
    (new processes are WGSL, through `gpu-device.js`; Dawn for the tools), and the kernel is a stencil, the easy case;
  - shift (x per cell) and inheritance are a few passes over the cells per step on the CPU, ~1 ms;
  - the lineage reader every frame: a leader clustering over the land cells, ~20 ms × 140 frames (or every 100 yr for
    the nation layer's culture ids: ~700 × 20 ms ≈ 14 s, so on demand, or on the GPU too).
- **Readback:** the nation layer needs `lang` per cell and the ruling lects each step. That is ~0.2 MB, or on demand.
- **Memory:** ~15 MB of state at 160K (`lex` 8, `phonT` 4, the rest 3), ~60 MB at 640K.
- **Storage:** per frame, `lang` and `family` per cell (Int32 each, ~1.3 MB at 160K, or Uint16 of a frame-local table)
  and the representative lects (~10³ languages × 40 × 4 B); the tree. For 140 frames, ~100 MB uncompressed; store as
  changes (most cells keep their language from frame to frame), ~10 MB.
- **At 640K:** ~4× (CIV_PLAN §9.8's scaling).

## 12. Stages (each lands on its own, with its checks)

- **L0. The record and the harness.** No sim change.
  - `tuning/culture/`: Glottolog's languages (points, families, isolates; CC-BY), ASJP's 40-item lists for the
    retention and Séguy checks on real data, WALS's feature frequencies for the founding phonology, PHOIBLE's segment
    frequencies.
  - `culture-report.mjs`: §11.1's measures, run first on Earth's real data. That says what each check returns for the
    world, before any model.
- **L1. Lects: inheritance, drift and contact.** The words only (40 meanings). Inheritance along `cameFrom` and
  `farmFrom` (farmers taking over only empty land: no shift yet); innovation at Pagel's rates; contact by the voter
  model on the travel graph. The lineage reader, the tree, families.
  - The GPU kernel and its CPU reference (for the check only), with a parity check.
  - Views: Languages, Families, Dialect boundaries, A word; the tree panel; the readout.
  - Checks: Séguy's curve; retention; latitude; families and sizes; scale 40K vs 160K; determinism across GPUs; time.
- **L2. Shift and death.** Rivals and x; Abrams–Strogatz with migration; farmers' x₀; substrate; status from towns and
  polity.js's capitals; borrowing between unintelligible lects; death in the tree.
  - Checks: Earth's spread zones (Bantu, Austronesian, Indo-European) and residual zones; the demic share; shift
    curves against Kandler et al. 2010's Celtic case.
- **L3. Phonology and names.** Settings, sound changes in order, word forms, spelling; the naming list; places named
  once; endonyms and exonyms; `nameOf` for the nation layer (N7).
  - Views: A sound; names on the map and in the readout.
  - Checks: kin sound alike; the founder-effect report; areal features.
- **L4. Nation coupling** (after NATION_PLAN N2): status from realms' hold; conquest settlement; the culture ids and
  d(a, b) the nation layer's N3 reads; N6's schooling.
  - Checks: the nation layer's culture area against complexity (Currie & Mace 2009 [L]), from its side; Weber's France.
- **L5. Traits and religion** (§7.8), and d_trait in d(a, b).
- **L6. Contact along routes and blending** (needs civ T2): Trudgill's gravity contact through towns, lingua francas,
  koinés; mixed languages and creoles only with the colonial horizon (§7.7).

## 13. What it needs from the civ and nation layers that they don't have yet

- **A step hook in `sim.js`:** `culture.step(...)` after the people and the polities, with the step's new arrivals and
  farm arrivals (cells and sources). The arrays exist; the hook doesn't.
- **The travel graph as an input to the step** (routes.js T0, already built), on foot, with boats where the era has
  them: the voyaging ladder's craft by date. Only edge days are needed, not Dijkstras.
- **Migrants:** sim.js doesn't track who moves. x₀ for farmers (§7.5) uses `seedShare`, the front's own seed. If the
  civ layer ever moves people explicitly (CIV_PLAN §9.4's deferred reaction–diffusion, or the nation layer's refugees),
  the culture layer should read the flux instead.
- **Frames:** a culture section in each frame (labels and the language table), and the worker's message to the page.
- **The GPU in the civ worker,** for the step's kernel (§14 Q2).
- **From the nation layer:** §8.2's inputs, and its N3 and N7 reading §8.1's outputs (NATION_PLAN changes proposed in
  this lane's report, not made here).

## 14. Open questions for Jackson

**Q1. Resolution.** At the page's 160K, a cell is ~3,200 km². Forager continents and farmed plains resolve. The tropics'
small languages (New Guinea's ~1,000) are sub-cell.
- (a) Accept. Languages smaller than a few cells don't exist in the run; density checks use latitude bands.
- (b) Run the culture layer on a finer mesh than the people (640K: ~800 km² cells), interpolating density down.
- (c) Keep 160K, and give each cell an estimated count of sub-cell languages from its people and growing season
  (Nettle 1998's regression). A number for the readout, not lects.
- **Recommend (a), with (c) as a cheap readout later.** (b) quadruples the cost for diversity the people's own cells
  don't carry. The planet-scale picture (families, spread and residual zones) is what 160K shows well.

**Q2. The GPU.** The step is ~5–8·10⁹ slot updates a run: ~1 min in JS, ~1–3 s as a WGSL kernel (§11.3). The civ layer
has no GPU dependency today: it runs in a page worker and in Node tools.
- (a) WGSL kernel, as the agent brief's rule says (Dawn for the tools; WebGPU in the worker). An integer-only kernel
  agrees bit for bit across GPUs.
- (b) CPU in JS. Simpler; a minute added to every People run.
- (c) CPU with a smaller list (20 meanings) and event-driven updates: ~15 s, and coarser distances.
- **Recommend (a).** The kernel is a stencil, the easiest kind, and determinism comes free with integers. The CPU
  reference stays as a check, not a path.

**Q3. Start at the origin or at the Holocene?**
- (a) From the first people (70 ka). Families emerge as the clades that survive the comparative method's horizon.
- (b) From the Holocene, with languages seeded as one per region. Cheaper (~470 steps, not 2,800), but its families are
  drawn by the seeding.
- **Recommend (a).** It is the only way families and isolates come from the run. The Pleistocene steps cost ~80 % of the
  time, but on the GPU that is a second or two.

**Q4. Culture beyond language.** How much, and when?
- (a) Language only: d(a, b) is lexical.
- (b) Language plus ~16 practice traits (L5), with traits in d(a, b).
- (c) (b) plus religion, with rulers converting realms and missionary religions spreading along routes.
- **Recommend (a) for L1–L4, then (b).** The nation layer's needs (identity, distance, names) are met by language. Traits
  add map modes and texture. Religion (c) has the thinnest sourcing of anything here: no peer-reviewed conversion model
  was found. Decide after seeing (b).

**Q5. Names: how far?**
- (a) Places, peoples and realms (NATION_PLAN's Q3 (b)).
- (b) (a) plus exonyms (each people's own name for its neighbours), shown in the readout.
- (c) (b) plus personal and dynastic names for the chronicle.
- **Recommend (b).** Exonyms cost almost nothing once names exist, and they make a realm's neighbours feel like
  neighbours. (c) is character stories; NATION_PLAN declined them.

**Q6. Ancestry.** Track who descends from whom (a few ancestry components per cell, inherited and mixed like the lect,
but never shifting)?
- (a) No.
- (b) Yes, as a check layer: genes against languages (Cavalli-Sforza et al. 1988), elite shift (Kars et al. 2021),
  demic fronts (Haak et al. 2015).
- **Recommend (b), at L2.** It is cheap (8 floats a cell) and is the only way to check the shift mechanism against
  ancient DNA. It is also a map players like ("where the steppe people's descendants live").

**Q7. Writing.** NATION_PLAN §7.8 needs a "writing" know-how for mobilization.
- (a) The civ economy's skills model owns it (CIV_PLAN §9.3), as a skill born in states.
- (b) This layer owns it, as a cultural trait that spreads by contact.
- **Recommend (a).** Writing behaves like the economy's know-how (needs people, administration, a use), not like a
  practice. This layer can show which languages are written.

**Q8. Creoles and mixed languages.**
- (a) Leave them for the colonial horizon (NATION_PLAN Q1 (c)).
- (b) Build §7.7's rule now, for trade ports and conquest settlement.
- **Recommend (a).** The agrarian record's blending is koinés and areal borrowing, which come free. Creoles need the
  plantation and port demography the civ layer doesn't make, and §7.7's rule is the one place an outcome is written in.

**Q9. Language and dialect.** Where does the reader draw the line (s_lang)?
- (a) One threshold for the world, a convention (like Ethnologue's case-by-case calls, made uniform).
- (b) Two levels: "languages" at s_lang, "dialect groups" within them at a higher similarity, both shown.
- **Recommend (b).** A dialect continuum is real in the model, and showing two levels makes it visible rather than
  hiding it inside an arbitrary count.
