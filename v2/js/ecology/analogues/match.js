// The analogue matcher (ecodesign §7.2): given one cell — its habitat, the world's open grades and its landmass's isolation —
// rank the library's Earth assemblages by likeness and fill the cell's roles with look-alikes ("a giant ground browser, like
// Megatherium (Pampas, Pleistocene)"). A pure function over the card data: no state, no randomness, cheap enough per click.
//
// The score is a product of likenesses, each in (0, 1]:
//   grade      what kinds of life the world has against what the card's world had. A card that needs a grade the world
//              hasn't opened is out; each grade the world has and the card's world lacked costs ×0.6 (a modern world
//              is like a modern card first, a Cenozoic one second, never a Cambrian one).
//   habitat    the same habitat 1; a related one by the AFFINITY table; an unrelated one 0.05 (kept, so a world with a
//              habitat no card covers still gets its nearest). Each shared azonal habitat ×1.1.
//   climate    distance outside the card's annual-temperature range (e-folding 6 °C) and rain range (a factor of e^0.5 ≈ 1.6),
//              when both the cell and the card know them; a Köppen code the card lists ×1.1, a different main group ×0.85.
//   isolation  land only: connected / long-isolated / island, from the landmass's endemic share, isolation time and area.
//   depleted   ×0.7 for a present-day card whose large animals humans removed: a world without people is better
//              matched by the same habitat before the loss (the Pleistocene card), when the library has one.
// Limits (stated): the weights are judgement, not fitted (there is nothing to fit them to); the affinities are a hand
// table of which habitats share their life forms; a world's late "future" (past Earth's present on the clock) has no Earth
// precedent and gets the nearest role look-alikes, labelled so.

import { LAND_HABITATS, SEA_HABITATS, FRESH_HABITATS, ROLES, SIZE_CLASSES, GRADES } from './keys.js';
import { CARDS } from './cards.js';
import { SOURCES } from './sources.js';

// ── habitats ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Related habitats: [a, b, likeness]. Symmetric. Habitats that share their life forms (open grass, closed canopy, cold, …). */
const AFFINITY_PAIRS = [
    ['tropical-rainforest', 'tropical-dry-forest', 0.6], ['tropical-rainforest', 'temperate-rainforest', 0.4],
    ['tropical-rainforest', 'mangrove', 0.3], ['tropical-dry-forest', 'tropical-savanna', 0.6],
    ['tropical-savanna', 'temperate-grassland', 0.45], ['tropical-savanna', 'xeric-shrubland', 0.4],
    ['tropical-savanna', 'flooded-grassland', 0.5], ['tropical-savanna', 'mediterranean', 0.3],
    ['desert', 'xeric-shrubland', 0.6], ['desert', 'fog-desert', 0.6], ['xeric-shrubland', 'fog-desert', 0.4],
    ['xeric-shrubland', 'mediterranean', 0.5], ['xeric-shrubland', 'temperate-grassland', 0.5],
    ['mediterranean', 'temperate-broadleaf', 0.35], ['mediterranean', 'temperate-grassland', 0.35],
    ['temperate-grassland', 'montane-grassland', 0.5], ['temperate-grassland', 'flooded-grassland', 0.35],
    ['temperate-broadleaf', 'temperate-conifer', 0.6], ['temperate-broadleaf', 'temperate-rainforest', 0.5],
    ['temperate-conifer', 'temperate-rainforest', 0.6], ['temperate-conifer', 'boreal', 0.6],
    ['boreal', 'tundra', 0.4], ['tundra', 'alpine', 0.6], ['tundra', 'polar-desert', 0.5], ['polar-desert', 'ice', 0.5],
    ['alpine', 'montane-grassland', 0.6], ['flooded-grassland', 'mangrove', 0.3],
    ['coral-reef', 'seagrass', 0.5], ['coral-reef', 'shelf', 0.35], ['kelp', 'upwelling-shelf', 0.5], ['kelp', 'shelf', 0.4],
    ['seagrass', 'salt-marsh', 0.5], ['seagrass', 'shelf', 0.4], ['salt-marsh', 'shelf', 0.3],
    ['upwelling-shelf', 'open-productive', 0.6], ['upwelling-shelf', 'shelf', 0.5], ['shelf', 'epeiric', 0.8],
    ['shelf', 'open-productive', 0.4], ['epeiric', 'salt-marsh', 0.3], ['open-gyre', 'open-productive', 0.5],
    ['polar-sea', 'sea-ice-edge', 0.8], ['polar-sea', 'open-productive', 0.4], ['polar-sea', 'upwelling-shelf', 0.35],
    ['deep-sea', 'vent', 0.5], ['deep-sea', 'seep', 0.5], ['vent', 'seep', 0.6],
    ['lake', 'river', 0.5], ['lake', 'saline-lake', 0.4],
];
const AFFINITY = new Map();
for (const [a, b, w] of AFFINITY_PAIRS) { AFFINITY.set(`${a}|${b}`, w); AFFINITY.set(`${b}|${a}`, w); }
const UNRELATED = 0.05;
export const habitatLikeness = (a, b) => (a === b ? 1 : AFFINITY.get(`${a}|${b}`) ?? UNRELATED);

// The finish's Biome ids (finish/finish-cover.js) → a habitat, refined by Köppen and height, for callers that have no habitat
// of their own (§2.1). The montane split uses the treeline's warmest-month ~6–7 °C (Körner & Paulsen 2004) when known.
const BIOME_HABITAT = [null, 'ice', 'polar-desert', 'tundra', 'boreal', 'temperate-conifer', 'temperate-broadleaf',
    'temperate-broadleaf', 'tropical-rainforest', 'tropical-dry-forest', 'tropical-savanna', 'mediterranean',
    'temperate-broadleaf', 'temperate-grassland', 'temperate-grassland', 'xeric-shrubland', 'desert'];

/** The cell's habitat key: its own, or one from its biome, Köppen class and height. */
export function resolveHabitat(cell) {
    if (cell.habitat) return cell.habitat;
    if (cell.realm === 'sea') return marineHabitat(cell.marine ?? {});
    if (cell.realm === 'fresh') return 'lake';
    const k = cell.koppen ?? '', main = k[0] ?? '';
    let h = BIOME_HABITAT[cell.biome ?? 0] ?? null;
    if (!h) h = { A: 'tropical-savanna', B: 'desert', C: 'temperate-broadleaf', D: 'boreal', E: 'tundra' }[main] ?? 'temperate-grassland';
    const tropical = main === 'A' || (cell.coldest ?? -99) >= 18;
    if (h === 'temperate-broadleaf' && tropical) h = (cell.pAnnual ?? 0) > 2000 ? 'tropical-rainforest' : 'tropical-dry-forest';
    if (h === 'temperate-broadleaf' && k[1] === 's') h = 'mediterranean';
    if (h === 'temperate-grassland' && (tropical || k === 'BSh')) h = k === 'BSh' ? 'xeric-shrubland' : 'tropical-savanna';
    if (h === 'tropical-savanna' && (main === 'C' || main === 'D') && !tropical) h = 'temperate-grassland';
    const high = (cell.zKm ?? 0) > 2.5;
    if (high && (h === 'temperate-grassland' || h === 'tropical-savanna' || h === 'xeric-shrubland')) h = 'montane-grassland';
    if (h === 'tundra' && (cell.zKm ?? 0) > 1.5 && (cell.warmest ?? 0) > 3) h = 'alpine';
    return h;
}

/** A sea cell's habitat from its fields, when the caller didn't name one (§2.1's marine table, in its order). */
function marineHabitat(m) {
    const depth = m.depthKm ?? 3, sst = m.sstC ?? 15, cold = m.sstColdC ?? sst;
    if (depth > 1) return 'deep-sea';
    if ((m.seaIce ?? 0) > 0.15) return 'sea-ice-edge';
    if (sst < 3) return 'polar-sea';
    if ((m.upwellingMd ?? 0) > 0.5 && depth < 0.5) return 'upwelling-shelf';
    if (depth < 0.05 && cold >= 18) return 'coral-reef';           // Kleypas et al. 1999
    if (depth < 0.2) return 'shelf';
    return sst > 22 ? 'open-gyre' : 'open-productive';
}

// ── grade, isolation, climate ──────────────────────────────────────────────────────────────────────────────────────────

const ALL_GRADES = new Set(GRADES);

function gradeLikeness(worldGrades, cardGrades) {
    let extra = 0;
    for (const g of cardGrades) if (!worldGrades.has(g)) return 0;            // the card's world had life this one lacks
    for (const g of worldGrades) if (!cardGrades.includes(g)) extra++;
    return 0.6 ** extra;
}

/** The landmass's isolation class from the life record (null = a connected continent, today's default). */
export function isolationClass(iso) {
    if (!iso) return 'connected';
    if ((iso.areaMkm2 ?? Infinity) < 1) return 'island';                       // Madagascar 0.59, New Guinea 0.79, Borneo 0.74
    if ((iso.endemic ?? 0) > 0.5 || (iso.isolatedMyr ?? 0) > 30) return 'long-isolated';
    return 'connected';
}
const ISO_LIKENESS = { 'connected|long-isolated': 0.6, 'island|long-isolated': 0.6, 'connected|island': 0.4 };
const isoLikeness = (a, b) => (a === b ? 1 : ISO_LIKENESS[`${a}|${b}`] ?? ISO_LIKENESS[`${b}|${a}`] ?? 0.4);

const outside = (x, [lo, hi]) => (x < lo ? lo - x : x > hi ? x - hi : 0);
// A card's climate envelope read as a likelihood: flat inside, the Gaussian shoulders outside (scale 6 °C, 0.5 in ln mm, 4 °C
// SST), normalized, so the density inside is 1/(width + scale·√π). A point inside a narrow envelope is then stronger evidence
// than inside a wide one: the Pliocene Snake River card, whose glacial-to-warm envelope spans 20 °C, no longer ties the
// Pampas card, whose envelope (also LGM to Last Interglacial) spans 8 °C. Divided by the same density over the whole
// library's range on that axis, so a card with no envelope there scores 1 (no evidence either way), as before.
const SQRT_PI = Math.sqrt(Math.PI);
const lnP = env => env.pAnnual.map(v => Math.log(Math.max(1, v)));
const AXES = [
    { scale: 6, env: e => e.tAnnual, x: c => c.tAnnual },
    { scale: 0.5, env: e => e.pAnnual && lnP(e), x: c => (c.pAnnual > 0 ? Math.log(c.pAnnual) : NaN) },
    { scale: 4, env: e => e.sst, x: c => c.marine?.sstC },
];
for (const ax of AXES) {
    const spans = CARDS.map(c => c.env && ax.env(c.env)).filter(Boolean);
    ax.ref = Math.max(...spans.map(r => r[1])) - Math.min(...spans.map(r => r[0]));
}
function climateLikeness(cell, card) {
    let s = 1;
    for (const ax of AXES) {
        const r = card.env && ax.env(card.env), x = ax.x(cell);
        if (!r || !Number.isFinite(x)) continue;
        s *= Math.exp(-((outside(x, r) / ax.scale) ** 2)) * (ax.ref + ax.scale * SQRT_PI) / (r[1] - r[0] + ax.scale * SQRT_PI);
    }
    if (cell.koppen && card.koppen.length)
        s *= card.koppen.includes(cell.koppen) ? 1.1 : card.koppen.some(k => k[0] === cell.koppen[0]) ? 1 : 0.85;
    return s;
}

// ── the matcher ──────────────────────────────────────────────────────────────────────────────────────────────────────

const HERB_ROLES = new Set(['grazer', 'browser', 'megaherbivore', 'frugivore']);
const CARN_ROLES = new Set(['bigPredator', 'smallPredator', 'scavenger']);
const sizeFloorKg = size => (size ? SIZE_CLASSES[size][0] : 0);

/**
 * Rank the library for one cell and fill its roles.
 * @param {import('./keys.js').MatchInput} cell
 * @param {{top?: number, cards?: object[]}} [opt]  top: how many ranked cards to return (5)
 * The result gains `floor` ({habitat, ranked, roles}) when a sea cell names its floor apart from its surface.
 * @returns {{habitat: string, noPrecedent: boolean, ranked: {card: object, score: number, why: string[]}[],
 *            roles: Object<string, {like: string, words: string, size: string|null, card: string, place: string,
 *                                   ageMa: number[], label: string, fromOther: boolean, refs: string[]}>}}
 */
export function matchAnalogues(cell, { top = 5, cards = CARDS } = {}) {
    const habitat = resolveHabitat(cell);
    const world = new Set(cell.grades ?? ALL_GRADES);
    const iso = isolationClass(cell.isolation);
    const azonal = new Set(cell.azonal ?? []);
    const scored = [];
    for (const card of cards) {
        if (card.realm !== cell.realm) continue;
        const g = gradeLikeness(world, card.grades);
        if (g === 0) continue;
        const h = Math.max(...card.habitats.map(ch => habitatLikeness(habitat, ch)));
        const az = card.azonal.reduce((s, a) => (azonal.has(a) ? s * 1.1 : s), 1);
        const c = climateLikeness(cell, card);
        const i = cell.realm === 'land' ? isoLikeness(iso, card.isolation) : 1;
        const d = card.depleted ? 0.7 : 1;
        const score = g * h * az * c * i * d;
        const why = [`habitat ${card.habitats.join('/')} vs ${habitat}: ×${h.toFixed(2)}`, `grade ×${g.toFixed(2)}`];
        if (az !== 1) why.push(`shared azonal ×${az.toFixed(2)}`);
        if (c !== 1) why.push(`climate ×${c.toFixed(2)}`);
        if (i !== 1) why.push(`isolation ${card.isolation} vs ${iso} ×${i.toFixed(2)}`);
        if (d !== 1) why.push('large animals lost to people ×0.70');
        scored.push({ card, score, why });
    }
    scored.sort((a, b) => b.score - a.score || (a.card.id < b.card.id ? -1 : 1));   // ties by id: deterministic
    const noPrecedent = Number.isFinite(cell.earthLikeMa) && cell.earthLikeMa < 0;
    const out = { habitat, noPrecedent, ranked: scored.slice(0, top), roles: fillRoles(scored, cell, noPrecedent) };
    // the sea floor is matched on its own (amendment 1): open gyre at the surface, a vent field below
    if (cell.realm === 'sea' && cell.floor && cell.floor !== habitat) {
        const { floor: _f, ...surface } = cell;
        const f = matchAnalogues({ ...surface, habitat: cell.floor }, { top, cards });
        out.floor = { habitat: f.habitat, ranked: f.ranked, roles: f.roles };
    }
    return out;
}

// Each role from the best-ranked card that has it and whose animal fits the landmass's body-size cap (×2, §7.2 step 5),
// looking no further than the cards that still match well (half the best score); "fromOther" when it isn't the top card.
function fillRoles(scored, cell, noPrecedent) {
    const roles = {};
    if (!scored.length) return roles;
    const floor = scored[0].score * 0.5;
    const capOf = role => (HERB_ROLES.has(role) ? cell.bodyCapKg?.herb : CARN_ROLES.has(role) ? cell.bodyCapKg?.carn : null);
    for (const role of ROLES) {
        const cap = capOf(role);
        for (const { card, score } of scored) {
            if (score < floor) break;
            const r = card.roles[role];
            if (!r) continue;
            if (Number.isFinite(cap) && sizeFloorKg(r.size) > 2 * cap) continue;
            roles[role] = { ...r, card: card.id, place: card.place, ageMa: card.ageMa, fromOther: card !== scored[0].card,
                label: likeLabel(r, card, noPrecedent), refs: SOURCES[card.id]?.[role] ?? [] };
            break;
        }
    }
    return roles;
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Earth's period name for an age (ICS 2023 boundaries, rounded). */
export function eraOf(ma) {
    const ERAS = [[0.0117, 'Holocene'], [2.58, 'Pleistocene'], [5.33, 'Pliocene'], [23.03, 'Miocene'], [33.9, 'Oligocene'],
        [56, 'Eocene'], [66, 'Paleocene'], [145, 'Cretaceous'], [201.4, 'Jurassic'], [251.9, 'Triassic'], [298.9, 'Permian'],
        [358.9, 'Carboniferous'], [419.2, 'Devonian'], [443.8, 'Silurian'], [485.4, 'Ordovician'], [538.8, 'Cambrian'],
        [635, 'Ediacaran'], [Infinity, 'Cryogenian']];
    for (const [end, name] of ERAS) if (ma <= end) return name;
    return 'Precambrian';
}

/** "a giant ground sloth …, like Megatherium (Pampas, Pleistocene)"; today's cards say "today" instead of a period. */
export function likeLabel(role, card, noPrecedent = false) {
    const when = card.ageMa[0] === 0 ? 'today' : eraOf((card.ageMa[0] + card.ageMa[1]) / 2);
    const like = `like ${role.like} (${card.place}, ${when})`;
    return noPrecedent ? `${role.words}: no Earth precedent for this age; the nearest role look-alike is ${like}` : `${role.words}, ${like}`;
}

export const HABITATS_BY_REALM = { land: LAND_HABITATS, sea: SEA_HABITATS, fresh: FRESH_HABITATS };
