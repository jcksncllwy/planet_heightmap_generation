// The analogue library's contract (ecodesign §7; the analogue lane L5). The shared keys (js/ecology/analogues/keys.js) are the
// vocabulary the detail pass and the cards agree on: every list frozen, its keys unique and well-formed, so a typo can't make
// a second spelling of a habitat that no card answers to.
// The cards (js/ecology/analogues/cards*.js) are checked for well-formed keys and for a source behind every role (the lane's
// verifier wrote sources.js from PBDB and GBIF; a role it could not support was dropped). The matcher (match.js) is checked on
// Earth points it must get right: the Serengeti, the Amazon, the Peru upwelling, the Pleistocene Pampas (ecodesign §7) and a long-isolated
// continent (Australia).
// Usage: node v2/tools/check-analogues.mjs

import { check, report, section, finish } from './lib/check-kit.mjs';
import * as K from '../js/ecology/analogues/keys.js';
import { CARDS } from '../js/ecology/analogues/cards.js';
import { SOURCES } from '../js/ecology/analogues/sources.js';
import { matchAnalogues, resolveHabitat, HABITATS_BY_REALM } from '../js/ecology/analogues/match.js';

section('the shared keys');
const lists = { LAND_HABITATS: K.LAND_HABITATS, AZONAL_HABITATS: K.AZONAL_HABITATS, SEA_HABITATS: K.SEA_HABITATS,
    FRESH_HABITATS: K.FRESH_HABITATS, REALMS: K.REALMS, GRADES: K.GRADES, ROLES: K.ROLES, ISOLATION: K.ISOLATION };
for (const [name, list] of Object.entries(lists)) {
    check(`${name} is frozen and non-empty`, Object.isFrozen(list) && list.length > 0, `${list.length} keys`);
    const dup = list.filter((k, i) => list.indexOf(k) !== i);
    check(`${name} has no duplicate key`, dup.length === 0, dup.join(', '));
    const bad = list.filter(k => !/^[a-z][a-zA-Z0-9-]*$/.test(k));
    check(`${name} keys are plain words (kebab or camel)`, bad.length === 0, bad.join(', '));
}
const habitats = [...K.LAND_HABITATS, ...K.AZONAL_HABITATS, ...K.SEA_HABITATS, ...K.FRESH_HABITATS];
const shared = habitats.filter((k, i) => habitats.indexOf(k) !== i);
check('no habitat key is in two habitat lists', shared.length === 0, shared.join(', '));
const sizes = Object.values(K.SIZE_CLASSES);
check('size classes tile 0 kg → ∞ without gaps', Object.isFrozen(K.SIZE_CLASSES) && sizes[0][0] === 0 && sizes.at(-1)[1] === Infinity
    && sizes.every((r, i) => i === 0 || r[0] === sizes[i - 1][1]));

section('the cards');
const ids = CARDS.map(c => c.id), dupIds = ids.filter((k, i) => ids.indexOf(k) !== i);
check('card ids are unique', dupIds.length === 0, dupIds.join(', '));
const badCards = [];
for (const c of CARDS) {
    const why = [];
    if (!K.REALMS.includes(c.realm)) why.push(`realm ${c.realm}`);
    for (const h of c.habitats) if (!HABITATS_BY_REALM[c.realm]?.includes(h)) why.push(`habitat ${h}`);
    if (!c.habitats.length) why.push('no habitat');
    for (const a of c.azonal) if (!K.AZONAL_HABITATS.includes(a)) why.push(`azonal ${a}`);
    for (const [r, v] of Object.entries(c.roles)) {
        if (!K.ROLES.includes(r)) why.push(`role ${r}`);
        if (v.size !== null && !(v.size in K.SIZE_CLASSES)) why.push(`size ${v.size}`);
        if (!/^[A-Z][a-z]+$/.test(v.like)) why.push(`genus ${v.like}`);
    }
    if (!K.ISOLATION.includes(c.isolation)) why.push(`isolation ${c.isolation}`);
    if (!(c.ageMa[0] >= c.ageMa[1] && c.ageMa[1] >= 0)) why.push(`ageMa ${c.ageMa}`);
    if (!(Math.abs(c.at?.[0]) <= 90 && Math.abs(c.at?.[1]) <= 180)) why.push('at');
    if (why.length) badCards.push(`${c.id}: ${why.join(', ')}`);
}
check('every card uses only the shared keys and is well-formed', badCards.length === 0, badCards.slice(0, 8).join(' · '));
const unsourced = CARDS.flatMap(c => Object.keys(c.roles).filter(r => !SOURCES[c.id]?.[r]?.length).map(r => `${c.id}.${r}`));
check('every role has a source (PBDB or GBIF, from the verifier)', unsourced.length === 0, `${unsourced.length} unsourced: ${unsourced.slice(0, 8).join(', ')}`);
const thin = CARDS.filter(c => Object.keys(c.roles).length < 3).map(c => c.id);
check('every card keeps at least 3 roles', thin.length === 0, thin.join(', '));
report('cards in the library', CARDS.length, { earth: [150, 250], digits: 0, source: 'ecodesign §7.3: ~150–250 assemblages' });

section('the matcher on Earth points (today\'s grade unless stated)');
const top = (cell, n = 1) => matchAnalogues(cell, { top: n });
const likes = m => Object.values(m.roles).map(r => r.like);
const serengeti = top({ realm: 'land', biome: 10, koppen: 'Aw', tAnnual: 21, pAnnual: 800, zKm: 1.5 }, 3);
check('Serengeti-like savanna → a tropical savanna card, with grazers', serengeti.ranked[0]?.card.habitats.includes('tropical-savanna') && !!serengeti.roles.grazer,
    `${serengeti.ranked.map(r => r.card.id).join(', ')}; grazer ${serengeti.roles.grazer?.label}`);
const amazon = top({ realm: 'land', biome: 8, koppen: 'Af', tAnnual: 27, pAnnual: 2300, zKm: 0.1 }, 3);
check('Amazon-like rainforest → a tropical rainforest card, with tree-dwellers', amazon.ranked[0]?.card.habitats.includes('tropical-rainforest') && !!amazon.roles.arboreal,
    `${amazon.ranked.map(r => r.card.id).join(', ')}; arboreal ${amazon.roles.arboreal?.label}`);
const peru = top({ realm: 'sea', marine: { sstC: 17, sstColdC: 15, depthKm: 0.1, upwellingMd: 1.0 } }, 3);
check('Peru-like upwelling shelf → an upwelling card, with forage fish', peru.habitat === 'upwelling-shelf' && peru.ranked[0]?.card.habitats.includes('upwelling-shelf') && !!peru.roles.forageFish,
    `${peru.ranked.map(r => r.card.id).join(', ')}; forage fish ${peru.roles.forageFish?.label}`);
const pampas = top({ realm: 'land', biome: 13, koppen: 'Cfa', tAnnual: 15, pAnnual: 900, zKm: 0.05 }, 3);
// The gate's intent (Jackson: "a habitat for something like a giant ground sloth"): a ground-sloth-like megaherbivore leads
// that role and the Pampas card is among the top three. Not "Megatherium" literally: nothing in a cell's fields makes it South
// American (no generated world has a South America), and on climate alone Late Pleistocene Florida (Megalonyx) fits a 15 °C,
// 900 mm Cfa grassland as well as Luján does (gladsheim ruling, 2026-11-11). Provinciality comes from L4's lineage pools.
const sloth = pampas.roles.megaherbivore?.like;
check('Pampas-like grassland, no people → a giant ground sloth leads the megaherbivores, the Pampas card in the top 3',
    (sloth === 'Megatherium' || sloth === 'Megalonyx') && pampas.ranked.some(r => r.card.id === 'lujan-pampas'),
    `${pampas.ranked.map(r => r.card.id).join(', ')}; megaherbivore ${sloth}; ${likes(pampas).join(', ')}`);

// A long-isolated continent (Australia-like: endemic lineages, isolated ≫ 30 Myr, 7.7 Mkm²) must draw on long-isolated
// cards, not on the connected continents' faunas with the same climate.
const oz = top({ realm: 'land', habitat: 'xeric-shrubland', koppen: 'BSh', tAnnual: 21, pAnnual: 350,
    isolation: { endemic: 0.8, isolatedMyr: 45, areaMkm2: 7.7 } }, 3);
check('a long-isolated dry continent → long-isolated cards lead (Australia-like, not Africa-like)',
    oz.ranked[0]?.card.isolation === 'long-isolated' && oz.ranked.filter(r => r.card.isolation === 'long-isolated').length >= 2,
    `${oz.ranked.map(r => `${r.card.id} (${r.card.isolation})`).join(', ')}; ${likes(oz).join(', ')}`);

const ventCell = top({ realm: 'sea', habitat: 'open-gyre', floor: 'vent', marine: { sstC: 25, depthKm: 2.6 } }, 3);
check('a gyre surface over a vent field gets both: the gyre above, the vent fauna on the floor', ventCell.habitat === 'open-gyre' && ventCell.floor?.habitat === 'vent' && ventCell.floor.ranked[0]?.card.habitats.includes('vent'),
    `surface ${ventCell.ranked.map(r => r.card.id).join(', ')}; floor ${ventCell.floor?.ranked.map(r => r.card.id).join(', ')}`);

section('grade, future and determinism');
const flowersOnly = ['algae', 'animals', 'landPlants', 'landAnimals', 'forests', 'seeds', 'woodRot', 'flowers'];
const cret = top({ realm: 'land', habitat: 'tropical-rainforest', grades: flowersOnly }, 5);
check('a world with flowers but no primates or grasses matches only cards from before them', cret.ranked.length > 0 && cret.ranked.every(r => r.card.grades.every(g => flowersOnly.includes(g))),
    cret.ranked.map(r => `${r.card.id} ${r.card.ageMa[0]} Ma`).join(', '));
const cambrian = top({ realm: 'sea', habitat: 'shelf', grades: ['algae', 'animals'] }, 3);
check('a world with animals in the sea and nothing on land matches Ediacaran–Cambrian–Ordovician seas', cambrian.ranked.length > 0 && cambrian.ranked.every(r => r.card.ageMa[1] > 443),
    cambrian.ranked.map(r => `${r.card.id} ${r.card.ageMa[0]} Ma`).join(', '));
const future = top({ realm: 'land', habitat: 'tropical-savanna', earthLikeMa: -150 });
check('a moment past Earth\'s present says "no Earth precedent"', future.noPrecedent && Object.values(future.roles).every(r => r.label.includes('no Earth precedent')));
const a = JSON.stringify(top({ realm: 'land', biome: 4, koppen: 'Dfc', tAnnual: -3, pAnnual: 450 }, 10)), b = JSON.stringify(top({ realm: 'land', biome: 4, koppen: 'Dfc', tAnnual: -3, pAnnual: 450 }, 10));
check('the matcher is deterministic', a === b);
const unmatched = [...K.LAND_HABITATS].filter(h => !top({ realm: 'land', habitat: h }).ranked.length);
check('every land habitat gets some match at today\'s grade', unmatched.length === 0, unmatched.join(', '));
check('a biome-only cell resolves to a habitat key', [1, 4, 8, 10, 13, 16].every(b => K.LAND_HABITATS.includes(resolveHabitat({ realm: 'land', biome: b }))));
finish('Analogues');
