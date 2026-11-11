// The analogue library (ecodesign §7): ~200 real Earth assemblages, each ONE place and time (a fossil formation or Lagerstätte,
// or a living ecoregion), written by hand in the cards-*.js files by era and realm. Every genus a card names was checked
// against a source by the analogue lane's verifier (fossil cards: a Paleobiology Database occurrence in that formation or
// area and age window; present cards: a GBIF occurrence within ~3° of the site); the references it found are in
// ./sources.js. A role the verifier could not support was dropped from the card, not kept as "probably".
//
// Here the files are joined and normalized: role tuples [genus, words, size] become objects, and each card gets the grades
// Earth had open at its age (./grades.js), which is what the matcher compares with a world's own grades (§7.2: grade first,
// never the date).

import { gradesOpenAt } from './grades.js';
import PRESENT_LAND from './cards-present-land.js';
import PRESENT_WATER from './cards-present-water.js';
import QUATERNARY from './cards-quaternary.js';
import CENOZOIC from './cards-cenozoic.js';
import MESOZOIC from './cards-mesozoic.js';
import PALEOZOIC from './cards-paleozoic.js';

function normalize(c) {
    const roles = {};
    for (const [role, v] of Object.entries(c.roles)) {
        const [like, words, size] = v;
        roles[role] = Object.freeze({ like, words, size: size ?? null });
    }
    return Object.freeze({
        ...c,
        habitats: Object.freeze([...c.habitats]),
        azonal: Object.freeze([...(c.azonal ?? [])]),
        koppen: Object.freeze([...(c.koppen ?? [])]),
        isolation: c.isolation ?? 'connected',
        area: c.area ?? 'continent',
        depleted: !!c.depleted,
        grades: Object.freeze(gradesOpenAt((c.ageMa[0] + c.ageMa[1]) / 2)),   // at the window's middle
        roles: Object.freeze(roles),
    });
}

/** Every card, normalized and frozen. */
export const CARDS = Object.freeze([PRESENT_LAND, PRESENT_WATER, QUATERNARY, CENOZOIC, MESOZOIC, PALEOZOIC].flat().map(normalize));

/** Card by id. */
export const CARD_BY_ID = new Map(CARDS.map(c => [c.id, c]));
