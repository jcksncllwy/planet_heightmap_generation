# Nation layer — sources ledger

Every rule the nation layer plans (plans/NATION_PLAN.md), where its mechanism comes from, and how closely we mean to
follow it. None of it is in code yet. When a stage lands, its rows move from "planned" to the code's file, in the same
commit as the rule, as CIV_SOURCES.md does. The source checks behind the marks are in
`~/.cache/geo-sim/lanes-2026-10-29/nationspec/verify/` (2026-11-26), with the PDFs read in `verify/pdfs/`.

**Fidelity** (as CIV_SOURCES.md)
- **Direct:** the source's formula or numbers, as published.
- **Adapted:** the source's mechanism, in our own form or with our own parameters.
- **Ours:** no single source; a modelling choice, labelled, with what it's meant to fit.

**Checked**
- **[V]:** read in the primary source (or in a working-paper version of it) during this project.
- **[A]:** the abstract, the publisher's description, or a scholarly summary only. The claim is the source's own, but
  its numbers or wording weren't seen in the text.
- **[L]:** a standard figure or attribution from the literature, not yet checked.
- **NOT FOUND:** looked for and not found in what was read. Don't cite the number until it is.

## Reach: influence, administration, borders and zones (NATION_PLAN §7.1; planned `nation/reach.js`)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Influence I = F·e^(−t/τ): force falling with travel days from a seat | Boulding 1962 (loss-of-strength gradient); ORBIS (Scheidel 2014) for travel time as the measure | Adapted: exponential in days, not Boulding's linear in distance; τ ours | [A] |
| The border is where two influences are equal; the strongest polity per cell by one multi-source Dijkstra with keys −τ·log F | Boulding 1962 (where two powers' strengths are equal; exact wording unchecked); the additively weighted Voronoi | Ours (the algorithm); Adapted (the idea) | [A] |
| Administered where tax exceeds the cost of collecting it at that distance | Herbst 2000 (holding thin land doesn't pay; power broadcast from cores); Scott 2009 (friction of terrain); Sng 2014 (monitoring cost with distance) | Adapted: the cost form ours | [A] |
| Only storable, legible crops are taxable | Scott 2017; Mayshar, Moav & Pascali (CIV_SOURCES, already in CIV_PLAN §5.5) | Adapted | [L] |
| Tribute zones and vassals where a polity is strongest but administering doesn't pay; multiple overlords where two beat the local power | Thongchai 1994 (tribute to two or more overlords; unclaimed buffers); Wolters 1982 (overlapping maṇḍala); Tambiah 1977 (galactic polity); Lattimore 1940 (frontier as gradation) | Adapted: verbal sources made a comparison of quantities | [A] |
| Disputed where the strongest's war odds are under w_c | Turchin et al. 2013 (the odds' form) | Ours: the margin from the war model's own uncertainty | [V] form |
| Claims after N_core generations held; they fade after N_claim | Abramson & Carter 2016 (historical boundaries shape later claims); EU4's cores; CK3's de jure | Ours: N_core, N_claim | [A] |
| Spheres: a town most of whose trade runs to p's towns | Wilson 1971 flows (CIV_PLAN §10.4, T2); Victoria 3's spheres (legibility) | Ours | — |

## War and conquest (NATION_PLAN §7.2)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Odds (P_a − P_d)/(P_a + P_d); defender + γ·elevation | Turchin, Currie, Turner & Gavrilets 2013, PNAS 110:16384 (main text: the forms; γ and β values in its SI, not read) | Direct form | [V] form, [L] values |
| Power from army × asabiya × MilTech, decaying with days | Turchin 2003 App. A2 (force from asabiya, projected with distance; via Bennett 2016's prose); Turchin et al. 2022 (iron and cavalry) | Adapted | [A] |
| War hazard with land pressure | Carneiro 1970 (as polity.js) | Adapted | [A] |
| Wars against equals rare: attack thresholds | Cederman 2002 (GeoSim: attack thresholds typically 2–3) | Adapted | [A] |
| Conquest along a front as far as campaign reach in days | Bennett 2022 (logistics from a central depot) | Adapted: reach in days ours | [V] |
| Nomad reach 200 km, confederations ~550 km | Bennett 2022 | Direct, then in days | [V] |
| Steppe confederations grow with the farmed states they border | Turchin 2009 (mirror empires; > 90 % of megaempires by the arid belt); Barfield 1989 (the steppe and China; his claim unchecked) | Adapted | [A] |
| War deaths kept for the size distribution | Clauset 2018 (α = 1.53 ± 0.07 above 7061 deaths, via a later paper's quote); Richardson 1948/1960 | — (a check) | [A] |

## Revenue, capacity and succession (NATION_PLAN §7.3)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Capacity grows by investment under external threat, decays otherwise | Besley & Persson 2009 (capacity with common-interest needs like war, and inclusive institutions); Gennaioli & Voth 2015 (costlier war; divided states drop out) | Adapted | [A] |
| One-sided threats favour empire; many-sided ones fragmentation (from the same rule) | Ko, Koyama & Sng 2018 ("a severe, unidirectional threat from the Eurasian steppe") | Adapted: an outcome to check, not a rule | [V] |
| Far provinces yield less and resent more | Sng 2014; Stasavage 2010 | Adapted | [A] |
| Tax rate θ | Monson & Scheidel 2015 (the "5–10 % of output" commonly quoted: NOT FOUND); Karaman & Pamuk 2010 (per-capita gaps; numbers NOT FOUND) | Ours: tuned on Earth | [A] |
| Reigns by rule: mean tenure 21.6 yr (primogeniture), 12.4 (election), 9.1 (agnatic seniority); deposed 16 / 49 / 57 % (own coding); primogeniture 75 % lower hazard of deposition than election | Kokkonen & Sundell 2014, APSR 108:438 (961 monarchs, 42 states, 1000–1800; Table 1, Model 1a) | Direct | [V] |
| Partible inheritance divides the realm | the Frankish partitions [L]; Scheidel 2019 (inheritance customs in Europe's fragmentation); CK3 (partition) | Adapted: 2–4 parts ours | [A] |
| Collapse with lasting population pressure | Turchin & Nefedov 2009 (secular cycles); Bennett 2016 (demographic-structural crises) | Adapted | [A]/[V] |
| Collapse with famine shocks | Zhang et al. 2007; Hsiang, Burke & Miguel 2013 (as polity.js) | Adapted | [L] |
| Collapse with low cohesion | Turchin 2003 (below a threshold of combined asabiya; via Bennett 2016) | Adapted | [A] |
| Collapse with size (base) | Turchin et al. 2013 (δ₀ + δ_s·size) | Adapted (as polity.js) | [V] form |

## Identity (NATION_PLAN §7.4)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Cultures from who came from whom; daughters on isolation past T_split | farming/language dispersal (Bellwood & Renfrew) | Ours: T_split tuned (glottochronology is contested) | [L] |
| Language shift dx/dt = c[(1−x)x^a s − x(1−x)^a(1−s)], a = 1.31 ± 0.25 | Abrams & Strogatz 2003, Nature 424:900 | Direct form and a; s from the polity's hold (ours); c tuned | [V] |
| Asabiya grows logistically on metaethnic frontiers, decays inside | Turchin 2003 (rules via Bennett 2016's prose; equations unchecked) | Adapted | [A] |
| Military technology: born where its means exist, spreads by contact, never lost | Turchin et al. 2013 (seeded at the steppe, diffusing with probability σ, never lost); Turchin et al. 2022 (iron and cavalry) | Adapted: born by the land, not Earth's map | [V] |

## Rebellion, alliances, migration, the national stage (NATION_PLAN §7.5–7.8)

| Rule | Source | Fidelity | Checked |
|---|---|---|---|
| Provinces rebel with distance, burden, famine, their own cohesion; odds as war | Gavrilets, Anderson & Turchin 2010 (secession in chiefdom cycling); Sng 2014 | Adapted | [V]/[A] |
| Alliances when a third's influence threatens both | Walt 1987 (balance of threat: power, proximity, offensive capability, intentions); Waltz 1979; Cederman 2002 (defensive alliances) | Adapted | [A] |
| Trading cities hold their own | Abramson 2017 (cities explain fragmentation: +14–20 % states per doubling of urban people); Spruyt 1994 | Adapted | [V]/[A] |
| Mobilization M (towns, writing, contact) switches culture into legitimacy | Deutsch 1953; Anderson 1983; Gellner 1983 | Ours: a stand-in for a missing technology layer | [A]/[L] |
| Nation-states with power shifts and neighbours' diffusion | Wimmer & Feinstein 2010 (145 states, 1816–2001) | Adapted | [A] |
| Unification of co-cultural neighbours destabilizes | Cederman 2002 | Adapted | [A] |
| States make nations (schools, roads, conscription speed the shift) | Weber 1976 (1863: French not spoken in 8,381 of 37,510 communes, "about a quarter of the population") | Adapted | [V] |

## Checks (NATION_PLAN §4, §11.1)

| Number | Source | Checked |
|---|---|---|
| Median 130 yr above half peak (78 polities); 16 ≥ 300 yr; D ≈ 25·R^0.5; median D/R ≈ 3 | Taagepera 1997, ISQ 41:475, doi 10.1111/0020-8833.00053 | [V] |
| Largest polity 0.25 Mkm² (Egypt) ~3000 BC; ≤ 1.1 to 650 BC; ≥ 2.3 after; Achaemenid 5.5, Han 6, Caliphate 11.1, Mongol 24, Russia 22.8 (1895), Qing 14.7 (1790), British 35.5 (1920) | Taagepera 1997 (text and appendix) | [V] |
| Effective number by area: ~10⁴ early; ~600 → 30 over 500 BC–AD 1600; < 30 after 1800; 24 after 1991 | Taagepera 1997 | [V] |
| Exponential lifetimes, λ = 0.46 /century, mean ~220 yr, 41 empires | Arbesman 2011, Historical Methods 44:127 | [V] |
| Chiefdom lifetimes < 55–68 yr; leaders 20–30 yr; convex rank-size | Gavrilets, Anderson & Turchin 2010, Cliodynamics 1:58 | [V] |
| ≥ 60 megaempires (≥ 1 Mkm²), > 90 % by the arid belt | Turchin 2009, J. Global History 4:191 | [A] |
| 62 largest empires lean E–W | Turchin, Adams & Hall 2006, JWSR 12:219 | [A] |
| Retrodiction R² 0.65 (0.16 without MilTech diffusion) | Turchin et al. 2013 | [V] |
| 73 % of spatial variance; too many small states before 1000 CE, too few > 3 Mkm² | Bennett 2022, PLOS ONE 17:e0261816 | [V] |
| PC1 77.2 % of variance, 414 polities, 30 NGAs | Turchin et al. 2018, PNAS 115:E144 | [V] |
| European states 1100–1790: median ~15,100 km² in 1100, falling; small states survived better | Abramson 2017, Int. Org. 71:97 | [V] |
| China's Herfindahl > 0.5 after ~300 five-year periods; Europe ~0.2 at 500 | Fernández-Villaverde, Koyama, Lin & Sng 2023, QJE 138:1173 (NBER w27774) | [V] |
| COW members 23 / 39 / 42 / 45 / 59 / 64 / 75 / 107 / 134 / 156 / 165 / 191 / 195 (1816 … 2016) | COW State System Membership v2016 (states2016.csv), counted 2026-11-26 | [V] |
| ISD: ~134 states in 1816; 482 in 1816–2016 (V2) | Griffiths & Butcher 2013; ISD V2 codebook | [A]/[V] |
| UN 51 (1945) → 193 (2011) | un.org | [V] |
| Rivers 23 % of international borders, 17 % provincial, 12 % county | Popelka & Smith 2020, Water Policy 22:293 (via NASA Earth Observatory) | [A] |
| Border fractal dimension 1.000–1.100 for most countries | Alesina, Easterly & Matuszeski 2011, JEEA 9:246 (NBER w12328) | [V] |
| 229 of 825 African groups (27.7 %) partitioned at ≥ 10 % of homeland; conflict ~40 % likelier | Michalopoulos & Papaioannou 2016, AER 106:1802 (NBER w17620) | [V] |
| War sizes α = 1.53 ± 0.07 | Clauset 2018, Science Advances 4:eaao3580 | [A] |
| ~22 % of 1513 European monarchs died violently (600–1800) | Eisner 2011, Br. J. Criminol. 51:556 | [A] |
| Language area: political complexity the strongest predictor | Currie & Mace 2009, PNAS 106:7339 | [A] |
| Complexity changes in small steps, up and down | Currie et al. 2010, Nature 467:801 | [A] |
| ~6× more languages per area in the south of North America than the north | Mace & Pagel 1995, Proc R Soc B 261:117 | [A] |

## Not used, and why

- **Tilly 1990's counts** ("~500 units in 1490 to ~25–30 by 1900"): NOT FOUND in chapters 1, 3 and 6. A review gives
  ~200 in 1500 to ~25 by 1918, another >1000 around AD 900–1000. They likely sit in ch. 2, unread. Abramson's data stand
  in.
- **Carneiro 1978's** ~600,000 autonomous units at 1000 BC: NOT FOUND. Speculative in any case. Taagepera's effective
  numbers are measured instead.
- **Taagepera's "fast rise, slow decline"**: not in the 1997 paper. It relates duration to rise time (D ≈ 25·R^0.5)
  instead.
- **Africa's "44 %" or "80 %" straight borders**: NOT FOUND in Alesina et al. 2011. They measure fractal dimension.
- **Mean reign "20–25 years" for all monarchs**: no source found. Kokkonen & Sundell's tenures by rule are used.
- **Engels 1978's ration and carrying figures**: NOT FOUND (the book unread). Campaign reach is in days, tuned.
- **Turchin et al. 2013's parameter values**: in the SI, which was blocked. polity.js's γ = 4 stays [L].
- **Turchin 2003's asabiya equations**: the book's appendix unread. The rules are from Bennett 2016's prose.
- **Moralizing gods (Whitehouse et al. 2019, Nature)**: retracted 2021.
- **Blaydes & Chaney 2013's reign lengths by century**: NOT FOUND (no text reachable). Their claim stands [A]: reigns
  in Western Europe lengthened after the 10th century against the Islamic world's.

## Bibliography

Each entry carries its checked mark. A DOI is given where it was seen.

- Abramson, S.F. 2017. The economic origins of the territorial state. *International Organization* 71(1):97–130. [V]
- Abramson, S.F. & Carter, D.B. 2016. The historical origins of territorial disputes. *APSR* 110(4):675–698.
  doi 10.1017/S0003055416000381. [A]
- Abrams, D.M. & Strogatz, S.H. 2003. Modelling the dynamics of language death. *Nature* 424:900. doi 10.1038/424900a. [V]
- Alesina, A., Easterly, W. & Matuszeski, J. 2011. Artificial states. *JEEA* 9(2):246–277 (NBER WP 12328). [V]
- Alesina, A. & Spolaore, E. 1997. On the number and size of nations. *QJE* 112(4):1027–1056. [A]
- Anderson, B. 1983. *Imagined Communities*. Verso. [L]
- Anderson, D.G. 1994. *The Savannah River Chiefdoms: Political Change in the Late Prehistoric Southeast*. U. Alabama
  Press. [L]
- Arbesman, S. 2011. The life-spans of empires. *Historical Methods* 44(3):127–129. doi 10.1080/01615440.2011.577733. [V]
- Barfield, T.J. 1989. *The Perilous Frontier: Nomadic Empires and China*. Blackwell. [A]
- Bennett, J.S. 2016. Repeated demographic-structural crises propel the spread of large-scale agrarian states throughout
  the Old World. *Cliodynamics* 7:1–36. [V]
- Bennett, J.S. 2022. Retrodicting the rise, spread, and fall of large-scale states in the Old World. *PLOS ONE*
  17(1):e0261816. doi 10.1371/journal.pone.0261816. [V]
- Besley, T. & Persson, T. 2009. The origins of state capacity. *AER* 99(4):1218–1244. [A]
- Blaydes, L. & Chaney, E. 2013. The feudal revolution and Europe's rise. *APSR* 107(1):16–34. [A]
- Boulding, K.E. 1962. *Conflict and Defense: A General Theory*. Harper. [A]
- Branch, J. 2014. *The Cartographic State*. Cambridge UP. doi 10.1017/CBO9781139644372. [A]
- Carneiro, R.L. 1970. A theory of the origin of the state. *Science* 169:733–738. doi 10.1126/science.169.3947.733. [A]
- Cederman, L.-E. 1997. *Emergent Actors in World Politics*. Princeton UP. [L]
- Cederman, L.-E. 2002. Endogenizing geopolitical boundaries with agent-based modeling. *PNAS* 99(suppl 3):7296–7303.
  doi 10.1073/pnas.082081099. [A]
- Cederman, L.-E. 2003. Modeling the size of wars. *APSR* 97(1):135–150. [A]
- Centeno, M.A. 2002. *Blood and Debt: War and the Nation-State in Latin America*. Penn State UP. [A]
- Clauset, A. 2018. Trends and fluctuations in the severity of interstate wars. *Science Advances* 4(2):eaao3580.
  doi 10.1126/sciadv.aao3580. [A]
- Correlates of War Project. State System Membership List v2016 (states2016.csv). [V, counted]
- Currie, T.E. & Mace, R. 2009. Political complexity predicts the spread of ethnolinguistic groups. *PNAS*
  106(18):7339–7344. doi 10.1073/pnas.0804698106. [A]
- Currie, T.E., Greenhill, S.J., Gray, R.D., Hasegawa, T. & Mace, R. 2010. Rise and fall of political complexity in
  island South-East Asia and the Pacific. *Nature* 467:801–804. [A]
- Deutsch, K.W. 1953. *Nationalism and Social Communication*. MIT Press. [A]
- Diamond, J. 1997. *Guns, Germs, and Steel*. Norton (ch. 16). [A]
- Eisner, M. 2011. Killing kings: patterns of regicide in Europe, AD 600–1800. *Br. J. Criminol.* 51(3):556–577. [A]
- Fernández-Villaverde, J., Koyama, M., Lin, Y. & Sng, T.-H. 2023. The fractured-land hypothesis. *QJE*
  138(2):1173–1231 (NBER w27774). [V of the WP]
- Gavrilets, S., Anderson, D.G. & Turchin, P. 2010. Cycling in the complexity of early societies. *Cliodynamics*
  1(1):58–80. doi 10.21237/c7clio11193. [V]
- Gellner, E. 1983. *Nations and Nationalism*. Blackwell. [L]
- Gennaioli, N. & Voth, H.-J. 2015. State capacity and military conflict. *REStud* 82(4):1409–1448. [A]
- Griffiths, R.D. & Butcher, C.R. 2013. Introducing the International System(s) Dataset (ISD), 1816–2011.
  *International Interactions* 39(5):748–768. [A]; ISD V2 codebook [V]
- Herbst, J. 2000. *States and Power in Africa*. Princeton UP. [A]
- Hui, V.T. 2005. *War and State Formation in Ancient China and Early Modern Europe*. Cambridge UP. [A]
- Karaman, K.K. & Pamuk, Ş. 2010. Ottoman state finances in European perspective, 1500–1914. *JEH* 70(3):593–629. [A]
- Kitamura, S. & Lagerlöf, N.-P. 2020. Geography and state fragmentation. *JEEA* 18(4):1726–1769.
  doi 10.1093/jeea/jvz032. [A]
- Ko, C.Y., Koyama, M. & Sng, T.-H. 2018. Unified China and divided Europe. *International Economic Review*
  59(1):285–327. doi 10.1111/iere.12270. [V of the WP]
- Kohler, T.A., Cockburn, D., Hooper, P.L., Bocinsky, R.K. & Kobti, Z. 2012. The coevolution of group size and
  leadership. *Advances in Complex Systems* 15(1&2):1150007. [A]
- Kokkonen, A. & Sundell, A. 2014. Delivering stability—primogeniture and autocratic survival in European monarchies
  1000–1800. *APSR* 108(2):438–453. doi 10.1017/S000305541400015X. [V]
- Lake, D.A. & O'Mahony, A. 2004. The incredible shrinking state. *J. Conflict Resolution* 48(5):699–722. [A]
- Lattimore, O. 1940. *Inner Asian Frontiers of China*. American Geographical Society. [A]
- Mace, R. & Pagel, M. 1995. A latitudinal gradient in the density of human languages in North America. *Proc R Soc B*
  261:117–121. [A]
- Michalopoulos, S. & Papaioannou, E. 2016. The long-run effects of the scramble for Africa. *AER* 106(7):1802–1848
  (NBER w17620). [V of the WP]
- Monson, A. & Scheidel, W. (eds) 2015. *Fiscal Regimes and the Political Economy of Premodern States*. Cambridge UP. [A]
- Nettle, D. 1998. Explaining global patterns of language diversity. *J. Anthropological Archaeology* 17(4):354–374. [A]
- Osiander, A. 2001. Sovereignty, international relations, and the Westphalian myth. *International Organization*
  55(2):251–287. doi 10.1162/00208180151140577. [A]
- Popelka, S.J. & Smith, L.C. 2020. Rivers as political borders. *Water Policy* 22(3):293–312. [A]
- Scheidel, W. 2019. *Escape from Rome*. Princeton UP. [A]
- Scott, J.C. 2009. *The Art of Not Being Governed*. Yale UP. [A]
- Scott, J.C. 2017. *Against the Grain*. Yale UP. [L]
- Smith, A.D. 1986. *The Ethnic Origins of Nations*. Blackwell. [L]
- Sng, T.-H. 2014. Size and dynastic decline. *Explorations in Economic History* 54:107–127. [A]
- Spruyt, H. 1994. *The Sovereign State and Its Competitors*. Princeton UP. [A]
- Stasavage, D. 2010. When distance mattered. *APSR* 104(4):625–643. [A]
- Strang, D. 1991. Global patterns of decolonization, 1500–1987. *ISQ* 35(4):429–454. doi 10.2307/2600949. [A]
- Taagepera, R. 1978. Size and duration of empires: systematics of size. *Social Science Research* 7:108–127. [A]
- Taagepera, R. 1979. Size and duration of empires: growth-decline curves, 600 B.C. to 600 A.D. *Social Science History*
  3(3/4):115–138. doi 10.2307/1170959. [A]
- Taagepera, R. 1997. Expansion and contraction patterns of large polities: context for Russia. *ISQ* 41(3):475–504.
  doi 10.1111/0020-8833.00053. [V]
- Tainter, J.A. 1988. *The Collapse of Complex Societies*. Cambridge UP. [A]
- Tambiah, S.J. 1977. The galactic polity. *Annals NY Acad. Sci.* 293:69–97 (reprinted *HAU* 3(3), 2013). [A]
- Thongchai Winichakul 1994. *Siam Mapped*. U. Hawai'i Press. [A]
- Tilly, C. 1990. *Coercion, Capital, and European States, AD 990–1990*. Blackwell. [L]; counts NOT FOUND
- Turchin, P. 2003. *Historical Dynamics: Why States Rise and Fall*. Princeton UP. [A]
- Turchin, P. 2009. A theory for formation of large empires. *J. Global History* 4(2):191–217. [A]
- Turchin, P., Adams, J.M. & Hall, T.D. 2006. East-West orientation of historical empires and modern states. *JWSR*
  12(2):219–229. [A]
- Turchin, P., Currie, T.E., Turner, E.A.L. & Gavrilets, S. 2013. War, space, and the evolution of Old World complex
  societies. *PNAS* 110(41):16384–16389. doi 10.1073/pnas.1308825110. [V main text]
- Turchin, P. et al. 2018. Quantitative historical analysis uncovers a single dimension of complexity…. *PNAS*
  115(2):E144–E151. doi 10.1073/pnas.1708800115. [V]
- Turchin, P. et al. 2022. Disentangling the evolutionary drivers of social complexity. *Science Advances*
  8(25):eabn3517. doi 10.1126/sciadv.abn3517. [V]
- Turchin, P. & Nefedov, S.A. 2009. *Secular Cycles*. Princeton UP. [A]
- Walt, S.M. 1987. *The Origins of Alliances*. Cornell UP. [A]
- Waltz, K.N. 1979. *Theory of International Politics*. [A]
- Weber, E. 1976. *Peasants into Frenchmen*. Stanford UP. [V, via the book's text]
- Wimmer, A. & Feinstein, Y. 2010. The rise of the nation-state across the world, 1816 to 2001. *ASR* 75(5):764–790. [A]
- Wimmer, A. & Min, B. 2006. From empire to nation-state. *ASR* 71(6):867–897. [V, first page]
- Wolters, O.W. 1982. *History, Culture, and Region in Southeast Asian Perspectives*. ISEAS (rev. 1999). [A]

**Game and tool precedents** (for legibility, not mechanism):
- Dwarf Fortress, Legends mode (dwarffortresswiki.org/legends) [A].
- Crusader Kings III, dev diary 25 "Map features and map modes" (forum.paradoxplaza.com) and dev diary 17 (partition)
  [A].
- Europa Universalis IV, cores and overextension (dev diaries, forum quotes) [A].
- Victoria 3, dev diaries 109 and 116 (power blocs; sphere of influence map mode) [A].
- Azgaar's Fantasy Map Generator, wiki "Culture types" (cost-distance expansion) [V].
