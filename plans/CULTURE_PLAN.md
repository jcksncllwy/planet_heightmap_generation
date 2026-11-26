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
  (§7.2). Under neutral drift a lineage's substitution rate equals its innovation rate (Kimura's result), whatever the
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
  - Contact between neighbouring cells at 160K, ~0.1 per neighbour per step for a forager's dispersal (§7.3), must
    stay well under 1 for the discrete voter model to approximate the continuous one. A century step would make it ~0.5
    and over-mix.
  - The nation layer's realm step is 25 yr (NATION_PLAN §2), and shift under a ruler is part of the culture step.
  - Abrams–Strogatz shift takes a few generations to a few centuries; 25 yr resolves it.
- **Frames.** The culture labels (language and family per cell) and each language's representative lect go into the
  civ frames every `frameYears`. The full field is held in memory for the run and isn't stored per frame (§11.3).

## 3. The research

_(see §3 below, filled from the checked sources)_

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

At 160K cells, ~50K of them land: `lex` is ~8 MB, the rest ~3 MB.

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
- **The basic list.** M = 40 meanings, the ASJP list (Holman et al. 2008): the Swadesh items that are the most stable
  and the least borrowed. Each meaning m has its own replacement rate λ_m, taken from Pagel et al. 2007's per-meaning
  half-lives (750 to over 10,000 yr). The 40 rates are their distribution's quantiles, so the model's mean retention
  per millennium is an output to check against Lees 1953 and Swadesh, not an input.
- **Innovation.** Each step, meaning m in cell c gets a new cognate class with probability 1 − e^(−λ_m · 25 yr). The
  new class's id is a hash of (cell, step, meaning), so it is new to the world.
- **Why the rate is per cell and still right.** In the voter model an innovation in one cell usually dies out; one in
  k cells fixes across a k-cell language. A language's substitution rate is then λ_m, the per-cell innovation rate,
  whatever its size (Kimura's neutral result). So Pagel's rates, measured between languages on a tree, are the rates the
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
    Neighbours who can't understand each other don't level their words; they borrow (§7.6) and shift (§7.5);
  - **p_b** is b's prestige: 1 by default; towns and ruling cultures raise it (§7.5).
- **D, the diffusivity,** comes from human dispersal per generation, not from language data. The demic models'
  ⟨Δ²⟩ per generation (Ammerman & Cavalli-Sforza; Fort) and ethnographic marriage and parent–offspring distances
  (MacDonald & Hewlett 1999; Wijsman & Cavalli-Sforza 1984) give D = ⟨Δ²⟩ / (4T). Speech is learnt from parents and
  neighbours, so the flux of speakers is the flux of people (§3.1, the numbers).
- **What it predicts, as checks, not rules:**
  - **Isolation by distance.** In a 2-D stepping-stone model, identity falls off with distance like the Bessel
    function K₀(r/ξ), close to logarithmic over a wide range (Malécot; Kimura & Weiss 1964). That is Séguy's curve,
    lexical distance growing as the log of geographic distance, which dialectometry finds across Europe (Séguy 1971;
    Nerbonne 2010). It is the strongest single check on the contact rule (§11.1).
  - **Correlation length** ξ_m ≈ √(D/λ_m): a few hundred km for forager dispersal and Pagel's rates (§4). Fast meanings
    vary over shorter distances than slow ones, as dialect atlases show.
  - **Barriers.** Rugged land and rivers raise diversity (Axelsen & Manrubia 2014), because they cut contact.
  - **Isogloss dynamics.** Boundaries between dialect domains behave with a surface tension: they straighten, and
    population centres push them outward (Burridge 2017). The N_b/N_a term is that push.
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
    it, the model becomes Patriarca & Leppänen 2004's and Kandler's spatial versions: coexistence in separate regions
    with a moving front between them;
  - c is a rate (per generation), set on Earth's records of shift: the Celtic languages' decline curves (Kandler et al.
    2010); Weber 1976's France, which NATION_PLAN §7.4 already uses.
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
  basic vocabulary is the least borrowed, §3.3). A loan is the same cognate class, so lexical distance between
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
  into one language. s_lang is where a dialect ends and a language begins (§3.2; Ethnologue's own boundaries are
  argued case by case, so it is a convention, set once).
- **Tracking.** Each new language takes the id of the previous frame's language with which it shares the most cells.
  A previous language whose cells now fall under two or more ids **split**: the first keeps the id and the others are
  its daughters, dated to this frame. One whose cells are all taken by another **died**, by shift or emptiness.
- **Families.** Two languages are in one family when their MRCA in the tracked tree is younger than T_detect, the
  comparative method's reach (~6–10 kyr; §3.2). Older relations are real in the run but undetectable, as on Earth. An
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
- These match the measures in the literature: Fearon 2003's and Desmet et al. 2012's tree distances, and Muthukrishna
  et al. 2020's cultural F_ST (§3.4).

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
  only), with a rate per setting. The rates are ours, scaled to make settings change more slowly than basic words.
  Grammar's stability varies by feature as much as vocabulary's does (Greenhill et al. 2017), so the per-setting rates
  should come from a stability ranking (§3.5).
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
- An underlying class "water" *kalu and "people" *tami.
- Daughter A took intervocalic voicing, then final vowel loss: *kalu → *kalu (no stop between vowels) → kal; *tami
  → tam. Its people are the "Tamkal" (people + water, modifier last).
- Daughter B took palatalization, then lenition: *kalu → kalu; *tami → tami → tahmi? No: lenition touches
  intervocalic stops only. Its "people" is tami and its "water" kalu, and its people-suffix makes them the "Tamini".
- A third, unrelated lect in the same area shares B's palatalization but not its classes: its "water" is ʃeno, its
  "people" omba.
- A and B's names share roots (tam-, kal-) that the third lect's don't; B and the third lect share a sound.

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
- **Range sizes:** languages' areas, roughly lognormal, with smaller ranges toward the tropics (Sutherland 2003).
- **Families:** the count of families and isolates per land area, and family sizes against Wichmann 2005's power law.
- **Spread and residual zones:** on Earth, the families covering the Bantu, Austronesian and Indo-European areas at
  0 BP, and their MRCA ages against the published roots (§3.1, §4). Whether the Bantu front's languages skirt the
  rainforest (Grollemund et al. 2015). Whether the Caucasus and the New Guinea highlands are residual zones (many
  families per area).
- **Demic share:** on Earth's European farming front, the share of cells whose lect is the farmers' against the share
  whose people kept theirs, beside Fort 2012's ~60 % demic.
- **Barriers:** diversity against ruggedness and river density (Axelsen & Manrubia 2014).
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
  ~5·10⁹ slot updates and ~3·10¹⁰ neighbour reads a run:
  - **on the CPU in JS:** ~1 min at 160K (by the civ layer's own measured throughput), against the People run's ~18 s.
    Too slow;
  - **on the GPU** (one WGSL kernel per step: every slot of every cell in parallel, reading its neighbours'
    previous values; integer hashes): ~1–3 s for a run at 160K, mostly dispatch overhead. This is the agent brief's rule
    (new processes are WGSL, through `gpu-device.js`; Dawn for the tools), and the kernel is a stencil, the easy case;
  - shift (x per cell) and inheritance are a few passes over the cells per step on the CPU, ~1 ms;
  - the lineage reader every frame: a leader clustering over the land cells, ~20 ms × 140 frames (or every 100 yr for
    the nation layer's culture ids: ~700 × 20 ms ≈ 14 s, so on demand, or on the GPU too).
- **Readback:** the nation layer needs `lang` per cell and the ruling lects each step. That is ~0.2 MB, or on demand.
- **Memory:** ~11 MB of state at 160K, ~45 MB at 640K.
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
  - Checks: the nation layer's culture area against complexity (Currie & Mace 2009), from its side; Weber's France.
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
_(§14 below)_
