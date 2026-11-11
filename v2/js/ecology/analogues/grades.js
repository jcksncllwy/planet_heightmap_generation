// When each grade opened on Earth (Ma), so a card can say what kinds of life its world had (ecodesign §4.2). The matcher
// compares a world's open grades with a card's, never the dates: a world whose flowers are open but grasses aren't matches
// Cretaceous–Eocene cards wherever its own clock reads (§7.2). The dates are Earth's single sample; a world's own grades
// come from its history (L3's doors and seeded lags), not from this table.
//
// Each date is the first good evidence of the grade as an ecological presence, not its molecular-clock origin:
export const GRADE_OPENS_MA = Object.freeze({
    algae: 1050,       // Bangiomorpha, a red alga, ~1.05 Ga (Gibson et al. 2018, Geology 46: 135); before any anchor the page uses
    animals: 571,      // the Avalon assemblage at Mistaken Point, ~571–565 Ma (Matthews et al. 2021, J Geol Soc 178)
    landPlants: 470,   // cryptospores of the Middle Ordovician, ~470 Ma (Wellman, Osterloff & Mohiuddin 2003, Nature 425: 282)
    landAnimals: 425,  // Pneumodesmus, the oldest air-breathing land animal, ~425 Ma (Suarez et al. 2017, Hist Biol 29: 1095)
    forests: 385,      // Gilboa's Eospermatopteris (Wattieza) trees, Middle Devonian (Stein et al. 2007, Nature 446: 904)
    seeds: 365,        // Elkinsia and the Famennian seed plants (Rothwell, Scheckler & Gillespie 1989, Bot Gaz 150: 170)
    woodRot: 295,      // white-rot Agaricomycetes by molecular clock (Floudas et al. 2012, Science 336: 1715)
    flowers: 130,      // angiosperm pollen from the Valanginian–Hauterivian, ~135–130 Ma (Friis, Crane & Pedersen 2011)
    primates: 56,      // Teilhardina at the Paleocene–Eocene boundary (Smith, Rose & Gingerich 2006, PNAS 103: 11223)
    grasses: 25,       // grass-dominated open habitats, late Oligocene–early Miocene (Strömberg 2011, Annu Rev Earth Planet Sci 39: 517)
    c4: 8,             // the C4 grassland expansion, 8–6 Ma (Cerling et al. 1997, Nature 389: 153)
    hominins: 7,       // Sahelanthropus, ~7 Ma (Brunet et al. 2002, Nature 418: 145)
});

/** The grades Earth had open at `ma` (Ma before present), in GRADE_OPENS_MA order. */
export function gradesOpenAt(ma) {
    return Object.keys(GRADE_OPENS_MA).filter(g => GRADE_OPENS_MA[g] >= ma);
}
