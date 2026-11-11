// When each grade opened on Earth (Ma), so a card can say what kinds of life its world had (ecodesign §4.2). The matcher
// compares a world's open grades with a card's, never the dates: a world whose flowers are open but grasses aren't matches
// Cretaceous–Eocene cards wherever its own clock reads (§7.2). The dates are Earth's single sample; a world's own grades
// come from its history (L3's doors and seeded lags), not from this table.
//
// Each date is the first good evidence of the grade as an ecological presence, not its molecular-clock origin, read from
// the cited paper's own abstract (checked 2026-11-11; DOIs given). Where a source names a stage instead of a number, the date
// is that stage's boundary on the ICS chart (as served by Macrostrat's intervals API), taking the bound the source guarantees.
export const GRADE_OPENS_MA = Object.freeze({
    // Bangiomorpha, a red alga: first appearance 1.047 +0.013/-0.017 Ga by Re-Os (Gibson et al. 2018, Geology 46: 135,
    // doi:10.1130/G39829.1). Before any anchor the page uses.
    algae: 1047,
    // the oldest architecturally complex macrofossils, upper Drook Formation, Mistaken Point: 574.17 ± 0.66 Ma (Matthews et al.
    // 2021, GSA Bulletin 133: 612, doi:10.1130/B35646.1)
    animals: 574,
    // the earliest generally accepted land-plant spores, mid-Ordovician (Llanvirn), "475 million years ago" (Wellman,
    // Osterloff & Mohiuddin 2003, Nature 425: 282, doi:10.1038/nature01884)
    landPlants: 475,
    // the earliest direct record of land animals (centipedes, a trigonotarbid) at Ludford Lane, Shropshire (Jeram, Selden &
    // Edwards 1990, Science 250: 658, doi:10.1126/science.250.4981.658), in the Ludlow Bone Bed at the base of the Přídolí
    // (Siveter, GCR vol. 35, Ludford Lane and Ludford Corner); base Přídolí 422.7 Ma (ICS). Pneumodesmus, once called the
    // oldest, is 413.7 ± 4.4 Ma by U-Pb and so younger (Suarez et al. 2017, PLoS ONE 12: e0179262).
    landAnimals: 423,
    // the Gilboa forest stumps (Eospermatopteris with Wattieza crowns), "about 385 million years old" (Stein et al. 2007,
    // Nature 446: 904, doi:10.1038/nature05705)
    forests: 385,
    // Elkinsia, cupulate ovules from the "late Devonian" of West Virginia (Rothwell, Scheckler & Gillespie 1989, Bot Gaz 150:
    // 170, doi:10.1086/337763); the abstract gives no finer age, so the Devonian's end, 358.86 Ma (ICS), the latest it allows
    seeds: 359,
    // white-rot lignin decay "around the end of the Carboniferous" by molecular clock (Floudas et al. 2012, Science 336: 1715,
    // doi:10.1126/science.1221748); end Carboniferous 298.9 Ma (ICS)
    woodRot: 299,
    // monosulcate angiosperm pollen appears in northern Gondwana in the Valanginian (Coiro, Doyle & Hilton 2019, New Phytol
    // 223: 83, doi:10.1111/nph.15708); top of the Valanginian 132.6 Ma (ICS)
    flowers: 133,
    // Teilhardina on three northern continents at the Paleocene–Eocene Thermal Maximum, "approximately 55.5 mya" (Smith,
    // Rose & Gingerich 2006, PNAS 103: 11223, doi:10.1073/pnas.0511296103)
    primates: 55.5,
    // open-habitat grasses diversified by 34 Ma but became ecologically dominant (in North America) 7–11 Myr later, i.e. 27–23
    // Ma, late Oligocene or early Miocene (Strömberg 2005, PNAS 102: 11980, doi:10.1073/pnas.0505700102); the middle, 25
    grasses: 25,
    // the global rise of C4 biomass "between 8 and 6 million years ago" (Cerling et al. 1997, Nature 389: 153, doi:10.1038/38229)
    c4: 8,
    // Sahelanthropus, Chad, "between 6 and 7 million years old" by its fauna (Brunet et al. 2002, Nature 418: 145,
    // doi:10.1038/nature00879)
    hominins: 7,
});

/** The grades Earth had open at `ma` (Ma before present), in GRADE_OPENS_MA order. */
export function gradesOpenAt(ma) {
    return Object.keys(GRADE_OPENS_MA).filter(g => GRADE_OPENS_MA[g] >= ma);
}
