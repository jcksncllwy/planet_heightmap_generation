# Culture layer — sources ledger

Every rule the culture layer plans (plans/CULTURE_PLAN.md), where its mechanism comes from, and how closely we mean to
follow it. None of it is in code yet. When a stage lands, its rows move from "planned" to the code's file, in the same
commit as the rule, as CIV_SOURCES.md does. The source checks behind the marks are in
`~/.cache/geo-sim/lanes-2026-10-29/langspec/verify/` (2026-11-25/26: batches A–G, Sonnet subagents reading the texts;
the PDFs and pages read are in `verify/pdfs/`).

**Fidelity** (as CIV_SOURCES.md)
- **Direct:** the source's formula or numbers, as published.
- **Adapted:** the source's mechanism, in our own form or with our own parameters.
- **Ours:** no single source; a modelling choice, labelled, with what it's meant to fit.

**Checked** (as NATION_SOURCES.md)
- **[V]:** read in the primary source (or a working-paper or preprint version, or its relevant section) during this
  project.
- **[A]:** the abstract, the publisher's description, or a scholarly summary only.
- **[L]:** a standard attribution from the literature, not yet checked.
- **NOT FOUND:** looked for and not found in what was read. Don't cite the number until it is.

## Inheritance (CULTURE_PLAN §7.1; planned `culture/lect.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| A newly peopled cell copies its source's lect (along `cameFrom`, a landing's launch, a drowned shelf) | the founder model of dispersal; cf. Atkinson 2011 (serial founders) | Ours: an exact copy, with no inventory loss | [A] |
| Farmers arriving where people live bring their lect as a rival, not a replacement | Diamond & Bellwood 2003 (complications: shift, hunter-gatherer expansions); Fort 2012 (demic and cultural together) | Adapted | [V] |
| The newcomers' share x₀ = σK_F / (σK_F + d_res), σ the front's seed share | sim.js `seedShare` (the civ layer's own seed of a front) | Ours, from an existing constant | — |

## Drift (§7.2)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| The basic list: 40 meanings | ASJP's 40-item list (Holman et al. 2008; the list via Wikipedia's ASJP page, citing the paper) | Direct (the list) | [A] paper; [V] list, secondary |
| Per-meaning replacement rates λ_m = ln 2 / h_m, the quantiles of the measured distribution | Pagel, Atkinson & Meade 2007 (frequency predicts rate; ~50 % of variance; 200 meanings, 87 languages); half-lives "2,000–4,000 y" for most, "10,000, 20,000 or even more" for the slowest (Pagel et al. 2013) | Direct (rates), once read from their data | [A] 2007, [V] 2013; the 2007 range "750–10,000" NOT FOUND |
| A lineage's substitution rate equals the per-cell innovation rate, whatever its size | Kimura's neutral theory (substitution rate = mutation rate) | Direct (the theorem) | [L] |
| No size effect on rates at first; a check against it | Bromham et al. 2015 (larger Polynesian populations gain words faster, smaller lose faster); Greenhill et al. 2018 (not universal) | — (a check) | [V]/[A] |
| No punctuational bursts by rule; a check | Atkinson et al. 2008: 31 % (Bantu), 21 % (IE), 9.5 % (Austronesian), ~33 % (Polynesian) at splits | — (a check) | [V] |

## Contact (§7.3)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| The voter model with innovation on the mesh: each slot copies a neighbour at rate m_ab | the stepping-stone model (Kimura & Weiss 1964; Malécot) with words as alleles; Schulze, Stauffer & Wichmann 2008 (copying between speakers' feature strings) | Adapted | [A] K&W; [V] Schulze review |
| k_ab = 4D/(deg·ℓ²), ℓ in travel-days × a flat day's walk | a 2-D diffusion's finite-difference rate; routes.js's days | Ours (the discretization) | — |
| D = ⟨Δ²⟩/(4T) by way of life: farmers ~3 km²/yr from Fort 2012's preindustrial kernel (⟨Δ²⟩ ≈ 360 km², our arithmetic, T = 30 yr); 12.5 km²/yr as the Neolithic front models use (Davison et al., after A&CS); foragers to read (Fort, Pujol & Cavalli-Sforza 2004, NOT FOUND yet) | Fort 2012; Davison et al. | Direct (kernel, main text; SI not read), Ours (⟨Δ²⟩ and D derived) | [V]/[V] |
| Backward migration: a's input from b ∝ N_b / N_a | demography of dispersal; Burridge 2017 (density-weighted averaging) | Adapted | [V] Burridge |
| Intelligibility g(sim): full levelling within a continuum, a borrowing floor between unintelligible lects | Mira & Paredes 2005 (similarity allows bilingual coexistence); Gooskens & van Heuven 2020 (lexical distance explains intelligibility, R² 0.57 all pairs, 0.89 Germanic) | Ours (the smooth step); s_hi = s_lang | [V abstract]/[V] |
| Expected: lexical distance sublinear in distance, near logarithmic | Nerbonne 2010 / Nerbonne & Heeringa 2007 (log distance the best predictor; r 0.47–0.62); Séguy 1971; the genetic twin: F_ST/(1−F_ST) linear in ln distance in 2-D (Rousset 1997) | — (a check) | [V draft]; Séguy via Nerbonne; Rousset [A] |
| Expected: boundaries with surface tension, driven off dense centres | Burridge 2017, eq. (9) | — (a check) | [V] |
| Expected: diversity rising with roughness and river density | Axelsen & Manrubia 2014 | — (a check) | [V] |
| Later: town-to-town diffusion by P_i P_j / d² | Trudgill 1974's gravity model (via Burridge; Nerbonne et al.) | Adapted, at T2 | [V] secondary; primary not read |

## Splitting and the lineage (§7.4, §7.9; planned `culture/lineage.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| No split rule: splits emerge where contact can't hold drift | the stepping-stone model; contrast Gavin et al. 2017's split-at-size rule | Ours | [A] Gavin |
| Languages by leader clustering at s_lang: the cut-off LDN = 0.51 (≈ 1,075–1,635 yr apart); in L1 the cognate similarity our rates give at ~1,350 yr | Wichmann 2019 (ASJP, 7,500+ varieties); SIL's ~70 % rule (Kluge, NOT FOUND in primary) | Direct (LDN), Adapted (the L1 stand-in) | [V] |
| Families: clades younger than T_detect ≈ 8–10 kyr | Nichols 1992:313 ("dissipate entirely after about 8000 years", quoted by Renfrew 2000); Rankin 2003:207 ("at least around 10,000 years") | Adapted | [V] Renfrew, Rankin; Nichols via them |
| Reconstruction check: UPGMA or NJ on 0 BP lects against the tracked tree | Bayesian and distance phylogenetics (Gray & Atkinson 2003 etc.) | — (a check) | [A] |

## Shift, bilingualism, death (§7.5)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| dx/dt = c[(1−x)x^a s − x(1−x)^a(1−s)], a = 1.31 | Abrams & Strogatz 2003 (42 regions; no stable coexistence) | Direct | [V] |
| Plus migration of speakers (reaction–diffusion form) | Patriarca & Leppänen 2004 (coexistence in separate zones); Kandler, Unger & Steele 2010 (monolinguals and bilinguals, fitted to Welsh and Gaelic censuses) | Adapted | [A] P&L; [V partial] Kandler model text |
| Rate c set on Earth's shift records | Kandler et al. 2010's Celtic series; Weber 1976's France (NATION_PLAN) | Tuned, labelled | [V partial]/[L here] |
| Status s: ½ by default; raised by the ruler's hold, towns, schooling | Renfrew 1987 (elite dominance, via Renfrew 2000); Kars et al. 2021 (Anatolia ~9.6 % Central Asian ancestry); Yunusbayev et al. 2015 | Adapted; the mapping from hold to s is ours | [V]/[V]/[A] |
| The swap keeps few words (r_lex) and more sounds (r_phon > r_lex) | Thomason & Kaufman 1988 (shift brings phonological and syntactic interference, "sometimes … very few loanwords"; from Thomason's own summary) | Adapted; r values ours | [V summary]; the book [L] |
| Bilingual coexistence of similar lects through g(sim) | Mira & Paredes 2005; Castelló, Eguíluz & San Miguel 2006 | Adapted | [V abstracts] |

## Borrowing and areas (§7.6)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Loans into the basic list at b_loan·β_m, faster with bilingualism | Haspelmath & Tadmor 2009 (WOLD: loans 1.2–62.7 % by language, a mean ~24 % by our arithmetic from Table 1; nouns 31 %, verbs 14 %; the Leipzig–Jakarta list ranks resistance to borrowing, its own loan share NOT FOUND) | Adapted; β_m from the L–J ranking, b_loan ours | [V] |
| Settings cross only under bilingualism | Thomason & Kaufman 1988's borrowing scale (words first, structure with intense contact) | Adapted | [V summary]; levels [A] |
| Expected: linguistic areas | Emeneau 1956; Sandfeld 1930 | — (a check) | [A]/[L] |

## Blending (§7.7)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Koinés from the voter model's majority in mixed towns | Trudgill's new-dialect formation | Adapted (no rule) | [L] |
| Creoles (later): no input over f_mix, a status lexifier, settings toward unmarked or the substrate's | Mufwene 1996 (the founder principle; colony demography, Jamaica 3:1 → >10:1); McWhorter 2001 (simplest grammars, contested) | Ours, an outcome rule, off by default | [V]/[L] |
| Creole and pidgin features for checks | APiCS (Michaelis et al. 2013): 76 languages, 130 features | — | [V] |

## Culture traits and religion (§7.8; planned `culture/traits.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Vertical, horizontal, conformist and prestige transmission | Boyd & Richerson 1985 (guided variation; direct, indirect and frequency-dependent bias), via Mesoudi, Whiten & Laland 2006 and the SEP | Adapted | [V] summaries; the book [L] |
| Trait kinds from the Ethnographic Atlas | Murdock 1967 | Adapted (the kinds) | [L] |
| Traits partly treelike | Collard, Shennan & Tehrani 2006 (cultural ≈ biological treeness; contested by Morrison 2014); Tehrani & Collard 2002 (Turkmen designs ~70 % → ~60 % homologous) | — (a check) | [L]/[V secondary] |
| Rulers convert their realms; missionary religions spread along routes | cuius regio, eius religio (1555), as a mechanism | Ours | — ; a sourced model NOT FOUND |
| Not used: moralizing gods from Seshat | Whitehouse et al. 2019, retracted 2021 | — | [V] |
| Complex skills and population size: left to the economy | Henrich 2004; Kline & Boyd 2010; against: Vaesen et al. 2016; Collard et al. 2013 | — (CIV_PLAN §9.1) | [V]/[V]/[V]/[A] |

## Distance (§7.10)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| d_lex = share of the 40 meanings with different classes | lexicostatistics; ASJP (Holman et al. 2008, 2011) | Adapted | [A] |
| Comparable to cultural F_ST and structural distances | Muthukrishna et al. 2020 (F_ST = (H_T − H_g)/H_T over questions); Fearon 2003 (formula NOT FOUND); Desmet et al. 2012 (ELF by tree level) | — | [V]/[A]/[V WP] |
| Cultural differences between neighbours exceed genetic | Bell, Richerson & McElreath 2009 (F_ST 0.080 vs 0.0053) | — (context) | [V] |

## Phonology and names (§9; planned `culture/phonology.js`, `culture/names.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| The founding lect's settings from Earth's frequencies | WALS chs. 1, 2, 12 (Maddieson 2013: consonants mean 22.7; five vowels commonest, 188/564; syllables simple 61 / moderate 274 / complex 151); PHOIBLE 2.0 (3,020 inventories, 2,186 languages) | Direct (frequencies) | [V] |
| Sound changes as regular rules over all words | Osthoff & Brugmann 1878; Labov 1981 (regular at the phonetic level) | Adapted | [L]/[A] |
| Chains of change (lenition, palatalization, final loss, tonogenesis) | Kümmel 2007; Index Diachronica; UniDia | Adapted (the catalogue) | [A] |
| Applied in the order taken | Rosenfelder's SCA2 (rules `s1/s2/e1_e2`; their order of application not confirmed in what was read); historical linguistics' relative chronology | Adapted | [V]/[L] |
| Settings' rates: not slower than words; ordered by feature stability | Greenhill et al. 2017 (most grammatical features faster than basic vocabulary; 81 Austronesian languages); Dediu & Cysouw 2013 (62 WALS features, 7 methods: word order most stable; phonology spans the range; consonant inventories near the bottom) | Ours (rates), ordered by the sources | [V]/[V] |
| Syllables by sonority | Clements 1990 | Adapted | [L] |
| Underlying forms by segment frequency; frequent meanings shorter | PHOIBLE; Zipf's law of abbreviation in 986 languages (Bentz & Ferrer-i-Cancho 2016) | Adapted | [V]/[L] |
| Spelling as an inherited trait (orthography patches) | O'Leary's naming languages (mewo2.com, via the Wayback Machine) | Adapted | [V] |
| Names as compounds of meaningful words | Dwarf Fortress (language_words.txt, translation tables, compound tokens); O'Leary (morpheme reuse) | Adapted | [V] |
| Places named once, kept through shift; renamed at a hazard | Peust 2015 (of the 92 large European rivers attested in Greek or Latin, 78 kept their ancient names and 4 with alternates count half: 80/92 = 87 % after 2,000 yr; "normally retained even when the area is invaded"); Krahe 1964 (Old European hydronymy; contested by Vennemann 2003) | Direct (the rate for large rivers); the hazard for others ours | [V]/[L] |
| Not used: Markov chains on Earth's names | Azgaar's FMG (nameBases, Markov chains) | — | [V code] |

## Earth checks (§4, §11.1)

| Check | Source | Checked |
|---|---|---|
| 7,685 languages, 245 families, 183 isolates | Glottolog 5.4 (glottolog.org) | [V] |
| 7,159 living languages | Ethnologue 28th ed. (2025) | [A] |
| Median ~7,000 speakers | Ethnologue (blog) | [L] |
| Lognormal ranges and speakers; latitude | Amano et al. 2014 | [V] |
| Languages vs population and growing season | Nettle 1998 (ln L = 0.33 ln P + 0.18 MGS − 0.62, r = 0.63, 43 tropical countries) | [V] |
| Latitude and growing season after corrections | Hua et al. 2019 (6,425 languages) | [V] |
| North America's gradient (≥ 6×) | Mace & Pagel 1995 | [A], a catalogue record and summary |
| Cultures by latitude (3,814) | Collard & Foley 2002 | [A] |
| Family sizes: rank–size slope −1.905 | Wichmann 2005 | [V] |
| Australia: 407 languages; model 406 | Gavin et al. 2017 | [A] |
| Retention 80.5 % / 86 % per millennium | Lees 1953; Swadesh 1955 (via secondary text) | [L] |
| Bantu roots, route | Grollemund et al. 2015 (424 languages; in-group ~4,850 BP; around the forest); Koile et al. 2022 (5,110 BP; through it) | [V] |
| Austronesian root | Gray, Drummond & Greenhill 2009 (400 languages, ~5,230 BP, HPD 4,750–5,800) | [A]; recap [V] |
| Indo-European root | Gray & Atkinson 2003 (7,800–9,800); Bouckaert et al. 2012 (Anatolia; fitted root NOT FOUND); Chang et al. 2015 (steppe, c. 6,500–5,500); Heggarty et al. 2023 (~8,120) | [A] |
| Pama-Nyungan | Bouckaert, Bowern & Atkinson 2018 (306 languages; Gulf Plains; mid-Holocene; "just under 6,000" from Bowern's popular account) | [A] |
| Transeurasian (contested) | Robbeets et al. 2021 (9,181 BP, HPD 5,595–12,793); Tian et al. 2022 | [V]/[L] |
| Steppe ancestry | Haak et al. 2015 (Corded Ware 79 % Yamnaya-like in the 3-way model; ~75 % headline) | [V] |
| Front speed and cultural share | Fort 2012 (0.9–1.3 km/yr; cultural 40 ± 8 % of the speed) | [V] |
| Founder effects (contested) | Atkinson 2011; Cysouw, Dediu & Moran 2012; Hunley, Bowern & Healy 2012; Creanza et al. 2015 | [A]/[A]/[A]/[V, part] |
| Inventory and population (contested) | Hay & Bauer 2007; Moran, McCloy & Wright 2012 | [A] |
| Morphology and population | Lupyan & Dale 2010 (26/28 features; 2,236 languages) | [V] |
| Genes and languages | Cavalli-Sforza et al. 1988 | [A] |
| North–south axes and persistence | Laitin, Moortgat & Robinson 2012 (~5 points per SD of axis ratio) | [V] |
| Endangerment (modern) | Bromham et al. 2022 (37 % of 6,511 threatened; roads and schooling); Krauss 1992 (via Simons 2013) | [V]/[V secondary] |

## References

- Abrams DM, Strogatz SH 2003. Modelling the dynamics of language death. *Nature* 424:900. doi:10.1038/424900a
- Amano T et al. 2014. Global distribution and drivers of language extinction risk. *Proc R Soc B* 281:20141574
- Ammerman AJ, Cavalli-Sforza LL 1971. Measuring the rate of spread of early farming in Europe. *Man* 6:674–688
- Ammerman AJ, Cavalli-Sforza LL 1984. *The Neolithic Transition and the Genetics of Populations in Europe.* Princeton UP
- Atkinson QD 2011. Phonemic diversity supports a serial founder effect model of language expansion from Africa.
  *Science* 332:346–349. doi:10.1126/science.1199295
- Atkinson QD, Meade A, Venditti C, Greenhill SJ, Pagel M 2008. Languages evolve in punctuational bursts. *Science*
  319:588. doi:10.1126/science.1149683
- Axelsen JB, Manrubia S 2014. River density and landscape roughness are universal determinants of linguistic
  diversity. *Proc R Soc B* 281:20133029. doi:10.1098/rspb.2013.3029
- Bell AV, Richerson PJ, McElreath R 2009. Culture rather than genes provides greater scope for the evolution of
  large-scale human prosociality. *PNAS* 106:17671–17674. doi:10.1073/pnas.0903232106
- Bellwood P, Renfrew C (eds) 2002. *Examining the Farming/Language Dispersal Hypothesis.* McDonald Institute
- Bergsland K, Vogt H 1962. On the validity of glottochronology. *Current Anthropology* 3:115–153
- Bouckaert R et al. 2012. Mapping the origins and expansion of the Indo-European language family. *Science*
  337:957–960. doi:10.1126/science.1219669
- Bouckaert RR, Bowern C, Atkinson QD 2018. The origin and expansion of Pama–Nyungan languages across Australia.
  *Nat Ecol Evol* 2:741–749. doi:10.1038/s41559-018-0489-3
- Boyd R, Richerson PJ 1985. *Culture and the Evolutionary Process.* U Chicago Press
- Bromham L, Hua X, Fitzpatrick TG, Greenhill SJ 2015. Rate of language evolution is affected by population size.
  *PNAS* 112:2097–2102. doi:10.1073/pnas.1419704112
- Bromham L et al. 2022. Global predictors of language endangerment and the future of linguistic diversity. *Nat Ecol
  Evol* 6:163–173. doi:10.1038/s41559-021-01604-y
- Bentz C, Ferrer-i-Cancho R 2016. Zipf's law of abbreviation as a language universal. Leiden Workshop proceedings
- Burridge J 2017. Spatial evolution of human dialects. *Phys Rev X* 7:031008. doi:10.1103/PhysRevX.7.031008
- Campbell L 2002. What drives linguistic diversification and language spread? In Bellwood & Renfrew (eds), 49–63
- Castelló X, Eguíluz VM, San Miguel M 2006. Ordering dynamics with two non-excluding options: bilingualism in
  language competition. *New J Phys* 8:308. doi:10.1088/1367-2630/8/12/308
- Cavalli-Sforza LL, Piazza A, Menozzi P, Mountain J 1988. Reconstruction of human evolution. *PNAS* 85:6002–6006
- Chang W, Cathcart C, Hall D, Garrett A 2015. Ancestry-constrained phylogenetic analysis supports the Indo-European
  steppe hypothesis. *Language* 91:194–244. doi:10.1353/lan.2015.0005
- Clements GN 1990. The role of the sonority cycle in core syllabification. *Papers in Laboratory Phonology I*, 283–333
- Collard M, Shennan SJ, Tehrani JJ 2006. Branching, blending, and the evolution of cultural similarities and
  differences among human populations. *Evol Hum Behav* 27:169–184
- Collard M, Foley RA 2002. Latitudinal patterns and environmental determinants of recent human cultural diversity.
  *Evol Ecol Res* 4:371–383
- Creanza N et al. 2015. A comparison of worldwide phonemic and genetic variation in human populations. *PNAS*
  112:1265–1272. doi:10.1073/pnas.1424033112
- Cysouw M, Dediu D, Moran S 2012. Comment on "Phonemic diversity…". *Science* 335:657. doi:10.1126/science.1208841
- Dediu D, Cysouw M 2013. Some structural aspects of language are more stable than others. *PLoS ONE* 8:e55009
- Davison K, Dolukhanov P, Sarson GR, Shukurov A. Environmental effects on the spread of the Neolithic. arXiv
  q-bio/0505013 (read; its journal version not checked)
- de Boer B 2000. Self-organization in vowel systems. *J Phonetics* 28:441–465
- Diamond J, Bellwood P 2003. Farmers and their languages: the first expansions. *Science* 300:597–603
- Emeneau MB 1956. India as a linguistic area. *Language* 32:3–16
- Fearon JD 2003. Ethnic and cultural diversity by country. *J Econ Growth* 8:195–222
- Fort J 2012. Synthesis between demic and cultural diffusion in the Neolithic transition in Europe. *PNAS*
  109:18669–18673. doi:10.1073/pnas.1200662109
- Gavin MC et al. 2017. Process-based modelling shows how climate and demography shape language diversity. *Global
  Ecol Biogeogr* 26:584–591. doi:10.1111/geb.12563
- Gray RD, Atkinson QD 2003. Language-tree divergence times support the Anatolian theory of Indo-European origin.
  *Nature* 426:435–439
- Gray RD, Drummond AJ, Greenhill SJ 2009. Language phylogenies reveal expansion pulses and pauses in Pacific
  settlement. *Science* 323:479–483
- Gray RD, Bryant D, Greenhill SJ 2010. On the shape and fabric of human history. *Phil Trans R Soc B* 365:3923–3933
- Gooskens C, van Heuven VJ 2020. How well can intelligibility of closely related languages in Europe be predicted
  by linguistic and non-linguistic variables? *Linguistic Approaches to Bilingualism* 10:351–379
- Greenhill SJ et al. 2017. Evolutionary dynamics of language systems. *PNAS* 114:E8822–E8829
- Grollemund R et al. 2015. Bantu expansion shows that habitat alters the route and pace of human dispersals. *PNAS*
  112:13296–13301
- Haak W et al. 2015. Massive migration from the steppe was a source for Indo-European languages in Europe. *Nature*
  522:207–211
- Haspelmath M, Tadmor U (eds) 2009. *Loanwords in the World's Languages.* De Gruyter Mouton
- Hay J, Bauer L 2007. Phoneme inventory size and population size. *Language* 83:388–400
- Heggarty P 2013. Ultraconserved words and Eurasiatic? *PNAS* 110:E3254
- Heggarty P et al. 2023. Language trees with sampled ancestors support a hybrid model for the origin of
  Indo-European languages. *Science* 381:eabg0818
- Henrich J 2004. Demography and cultural evolution: the Tasmanian case. *American Antiquity* 69:197–214
- Holman EW et al. 2008. Explorations in automated language classification. *Folia Linguistica* 42:331–354
- Hua X et al. 2019. The ecological drivers of variation in global language diversity. *Nat Commun* 10:2047
- Hunley K, Bowern C, Healy M 2012. Rejection of a serial founder effects model of genetic and linguistic coevolution.
  *Proc R Soc B* 279:2281–2288
- Kandler A, Unger R, Steele J 2010. Language shift, bilingualism and the future of Britain's Celtic languages. *Phil
  Trans R Soc B* 365:3855–3864
- Kars ME et al. 2021. The genetic structure of the Turkish population reveals high levels of variation and admixture.
  *PNAS* 118:e2026076118
- Kimura M, Weiss GH 1964. The stepping stone model of population structure and the decrease of genetic correlation
  with distance. *Genetics* 49:561–576
- Kirby S, Cornish H, Smith K 2008. Cumulative cultural evolution in the laboratory. *PNAS* 105:10681–10686
- Kline MA, Boyd R 2010. Population size predicts technological complexity in Oceania. *Proc R Soc B* 277:2559–2564
- Koile E et al. 2022. Phylogeographic analysis of the Bantu language expansion supports a rainforest route. *PNAS*
  119:e2112853119
- Kümmel MJ 2007. *Konsonantenwandel.* Reichert
- Labov W 1981. Resolving the Neogrammarian controversy. *Language* 57:267–308
- Laitin DD, Moortgat J, Robinson AL 2012. Geographic axes and the persistence of cultural diversity. *PNAS*
  109:10263–10268
- Lees RB 1953. The basis of glottochronology. *Language* 29:113–127
- Lupyan G, Dale R 2010. Language structure is partly determined by social structure. *PLoS ONE* 5:e8559
- Mace R, Pagel M 1995. A latitudinal gradient in the density of human languages in North America. *Proc R Soc B*
  261:117–121
- Maddieson I 1984. *Patterns of Sounds.* Cambridge UP; Maddieson I 2013, WALS chapters 1, 2, 12
- McWhorter J 2001. The world's simplest grammars are creole grammars. *Linguistic Typology* 5:125–166
- Mesoudi A, Whiten A, Laland KN 2006. Towards a unified science of cultural evolution. *Behav Brain Sci* 29:329–347 (target article;
  commentaries to 383)
- Michaelis SM et al. (eds) 2013. *The Atlas of Pidgin and Creole Language Structures.* OUP
- Mira J, Paredes Á 2005. Interlinguistic similarity and language death dynamics. *Europhys Lett* 69:1031–1034
- Moran S, McCloy D (eds) 2019. *PHOIBLE 2.0.* doi:10.5281/zenodo.2593234
- Moran S, McCloy D, Wright R 2012. Revisiting population size vs. phoneme inventory size. *Language* 88:877–893
- Mufwene SS 1996. The founder principle in creole genesis. *Diachronica* 13:83–134
- Muthukrishna M et al. 2020. Beyond WEIRD psychology. *Psychol Sci* 31:678–701
- Nerbonne J 2010. Measuring the diffusion of linguistic change. *Phil Trans R Soc B* 365:3821–3828
- Nettle D 1998. Explaining global patterns of language diversity. *J Anthropol Archaeol* 17:354–374
- Nettle D 1999. Using social impact theory to simulate language change. *Lingua* 108:95–117
- Nichols J 1992. *Linguistic Diversity in Space and Time.* U Chicago Press
- O'Leary M c. 2015–16. Generating naming languages. mewo2.com/notes/naming-language (Wayback copy)
- Pagel M, Atkinson QD, Meade A 2007. Frequency of word-use predicts rates of lexical evolution throughout
  Indo-European history. *Nature* 449:717–720
- Pagel M, Atkinson QD, Calude AS, Meade A 2013. Ultraconserved words point to deep language ancestry across Eurasia.
  *PNAS* 110:8471–8476
- Patriarca M, Leppänen T 2004. Modeling language competition. *Physica A* 338:296–299
- Peust C 2015. How old are the river names of Europe? A glottochronological approach. *Linguistik online* 70
- Rankin RL 2003. The comparative method. In Joseph & Janda (eds), *Handbook of Historical Linguistics*, 183–212
- Renfrew C 1987. *Archaeology and Language.* Jonathan Cape; Renfrew C 2000. At the edge of knowability. *Camb Archaeol
  J* 10:7–34
- Robbeets M et al. 2021. Triangulation supports agricultural spread of the Transeurasian languages. *Nature*
  599:616–621
- Rosenfelder M. *The Language Construction Kit*; Gen; SCA2 (zompist.com)
- Rousset F 1997. Genetic differentiation and estimation of gene flow from F-statistics under isolation by distance.
  *Genetics* 145:1219–1228
- Schulze C, Stauffer D, Wichmann S 2008. Birth, survival and death of languages by Monte Carlo simulation. *Commun
  Comput Phys* 3:271–294 (arXiv:0704.0691)
- Swadesh M 1955. Towards greater accuracy in lexicostatistic dating. *IJAL* 21:121–137
- Tehrani J, Collard M 2002. Investigating cultural evolution through biological phylogenetic analyses of Turkmen
  textiles. *J Anthropol Archaeol* 21:443–463
- Thomason SG, Kaufman T 1988. *Language Contact, Creolization, and Genetic Linguistics.* U California Press
- Trudgill P 1974. Linguistic change and diffusion. *Language in Society* 3:215–246
- Vaesen K, Collard M, Cosgrove R, Roebroeks W 2016. Population size does not explain past changes in cultural
  complexity. *PNAS* 113:E2241–E2247
- Watts J et al. 2015. Broad supernatural punishment but not moralizing high gods precede the evolution of political
  complexity in Austronesia. *Proc R Soc B* 282:20142556
- Wichmann S 2019. How to distinguish languages and dialects. *Computational Linguistics* 45:823–831
- Wichmann S 2005. On the power-law distribution of language family sizes. *J Linguistics* 41:117–131

### Cited, and to be checked or read before a stage relies on them
- Collard M, Buchanan B, O'Brien MJ, Scholnick J 2013. *Phil Trans R Soc B* 368:20120412 [A]
- Collard M, Ruttle A, Buchanan B, O'Brien MJ 2013. *PLoS ONE* 8:e72628 [A]
- Currie TE, Mace R 2009 (ethnolinguistic area and political complexity; via NATION_SOURCES) [L]
- Greenhill SJ et al. 2018. *Frontiers in Psychology*, doi:10.3389/fpsyg.2018.00576 [A, snippet]
- Heggarty P, Beresford-Jones D 2010. Agriculture and language dispersals. *Curr Anthropol* 51:163–191 [A]
- Holman EW et al. 2011. Automated dating of the world's language families. *Curr Anthropol* 52:841–875 [L]
- Krahe H 1964. *Unsere ältesten Flussnamen.* Harrassowitz [L]
- Malécot G 1951 (the 2-D isolation-by-distance formula) [L]
- Morrison DA 2014. bioRxiv 10.1101/006486 [L]
- Murdock GP 1967. *Ethnographic Atlas.* U Pittsburgh Press [L]
- Powell A, Shennan S, Thomas MG 2009. *Science* 324:1298–1301 [A]
- Seuren P 2001. Simple and transparent. *Linguistic Typology* 5:176–180 [L]
- Stark R 1996. *The Rise of Christianity.* Princeton UP [L]
- Tian Z et al. 2022. bioRxiv 10.1101/2022.06.09.495471 [L]
- Urban M 2024. Global language geography and language history. *Open Research Europe* 4:213 [V]
- Vennemann T 2003. *Europa Vasconica – Europa Semitica.* De Gruyter [L]
- Weber E 1976. *Peasants into Frenchmen.* Stanford UP (read by nationspec; not here) [L]
- Whitehouse H et al. 2019, retracted 2021 (Retraction Note *Nature* 595:320) [V]
- Yunusbayev B et al. 2015. *PLoS Genet* 11:e1005068 [A]
- Henrich 2004 was read in the author's pre-publication copy, marked not for citation; check the printed wording.
