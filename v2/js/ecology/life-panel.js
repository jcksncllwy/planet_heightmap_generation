// The place panel's Life section (cell-panel.js lifeHTML delegates here; lanes ecodesign §8): what lives at a place at today's
// grade, drawn from now.js lifeFacts. Three tiers, as the mock-ups have them:
//   a headline (the habitat in words, how much grows) and the grade it is read at — today's, a modern Earth-like biosphere,
//     until the history of life (ecodesign L1–L4) says which kinds of life this world has opened;
//   the food web as a pyramid of roles, top down: on land the large predators, the large herbivores (grazers and browsers by
//     the cover's grass share) and the plants' yearly growth; at sea the fish and the plankton, with Ryther's steps between.
//     The bars share one log scale (kg/km², 1 kg to 10,000 t): a tenfold step is the same length anywhere, so the pyramid's
//     shape is the transfer between levels, not the units' — the plants' and the plankton's bars are a year's growth, the
//     animals' are the standing biomass (the plankton's is carbon, the fish's wet weight: the row says which);
//   why: the chain of causes and the sources, folded.
// Look-alikes from Earth's history (the analogue cards, lane L5) go in each role's `like` slot when a matcher is passed in;
// without one the slot stays empty. Pure string-building: no DOM, so a check can draw it headless.

import { BIOME_WORDS } from '../finish/finish-cover.js';

export const HABITAT_WORDS = Object.freeze({
    'tropical-rainforest': 'Tropical rainforest', 'tropical-dry-forest': 'Tropical dry forest (leafless in the dry season)',
    'tropical-savanna': 'Tropical savanna: grass with scattered trees', desert: 'Desert', 'xeric-shrubland': 'Dry scrub and thorn steppe',
    'fog-desert': 'Fog desert, watered by a cold sea', mediterranean: 'Mediterranean scrub and woodland (dry summers)',
    'temperate-grassland': 'Temperate grassland (prairie, steppe)', 'temperate-broadleaf': 'Temperate broadleaf forest',
    'temperate-conifer': 'Temperate conifer forest', 'temperate-rainforest': 'Temperate rainforest', boreal: 'Boreal forest (taiga)',
    tundra: 'Tundra', 'polar-desert': 'Polar desert', ice: 'Ice', 'montane-grassland': 'Tropical high grassland (páramo, puna)',
    alpine: 'Alpine meadow and rock, above the trees', 'flooded-grassland': 'Seasonally flooded grassland', mangrove: 'Mangrove forest on a tidal coast',
    // the sea
    'coral-reef': 'Coral reef', kelp: 'Kelp forest on a rocky shore', seagrass: 'Seagrass meadows', 'salt-marsh': 'Salt marsh and mudflat',
    'upwelling-shelf': 'An upwelling sea: rich water rising from below', shelf: 'Shelf sea', epeiric: 'A shallow sea over a continent',
    'open-gyre': 'Open ocean, warm and clear (a gyre: little grows)', 'open-productive': 'Open ocean, cool and productive',
    'polar-sea': 'Polar sea under ice most of the year', 'sea-ice-edge': 'The sea ice\'s edge (a spring bloom)',
    // fresh water
    lake: 'A lake', 'saline-lake': 'A salt lake',
});
const AZONAL_WORDS = { riparian: 'a river\'s gallery forest', floodplain: 'a floodplain', 'salt-flat': 'a salt flat', karst: 'limestone karst', 'young-lava': 'young lava (plants just arriving)' };
const FLOOR_WORDS = { 'deep-sea': 'the deep-sea floor (mud, sparse life fed by what sinks)', vent: 'hydrothermal vents on the ridge (life fed by the vents\' chemistry)', seep: 'cold seeps by the trench (life fed by methane)' };
const PROVINCE_WORDS = { oceanic: 'open-ocean', coastal: 'coastal', upwelling: 'upwelling' };

const n0 = x => Math.round(x).toLocaleString();
/** A mass in kg/km² in the unit that reads best. */
const mass = kg => (kg >= 1000 ? `${kg >= 1e4 ? n0(kg / 1000) : (kg / 1000).toFixed(1)} t` : `${kg >= 10 ? n0(kg) : kg.toFixed(1)} kg`);
/** How much a place grows, in words (g dry matter /m²/yr; display bands only, nothing reads them). */
const growWords = npp => (npp < 50 ? 'almost nothing grows' : npp < 300 ? 'sparse growth' : npp < 800 ? 'moderate growth' : npp < 1500 ? 'productive' : 'very productive');
/** A bar on the shared log scale: 1 kg/km² → 0, 10,000 t/km² → full. */
const BAR_DECADES = 7;
const bar = (kgKm2, kind) => `<i class="evo-life-bar ${kind}" style="width:${(100 * Math.max(0.02, Math.min(1, Math.log10(Math.max(1, kgKm2)) / BAR_DECADES))).toFixed(1)}%"></i>`;
const tier = (label, kgKm2, kind, value, like) => `<div class="evo-life-tier" data-tier="${kind}"><span class="evo-life-role">${label}</span>`
    + `<span class="evo-life-amount"><span>${value}</span><span class="evo-life-track">${bar(kgKm2, kind)}</span></span>${like ? `<span class="evo-life-like">like ${like}</span>` : ''}</div>`;

const GRADE_LINE = '<p class="evo-life-grade">Read at <b>today\'s grade</b>: a modern Earth-like biosphere, as if this world\'s life were Earth\'s now. Which kinds of life it has opened, and when, comes with the history of life.</p>';
const SOURCES = {
    land: 'Miami NPP (Lieth 1975) · large herbivores from NPP, Africa (Fløjgaard et al. 2022) · predators 0.094·prey^0.73 (Hatton et al. 2015) · mycorrhizae (Steidinger et al. 2019) · crusts (Belnap & Lange 2001)',
    sea: 'provinces, yields, steps and efficiencies (Ryther 1969) · fish ≈ 10 × their carbon (recalled)',
};

/**
 * The Life section's HTML for one place. L: now.js lifeFacts (null: nothing to say), detailed: whether the moment has its
 * finish, like(role, L) → a look-alike's name or null (the analogue matcher; optional).
 */
export function lifeSectionHTML(L, detailed, like = null) {
    if (!detailed) return '<p class="evo-cell-need">Add detail to see what lives here (at today\'s grade: a modern Earth-like biosphere).</p>';
    if (!L) return '<p class="evo-cell-quiet">No climate here to read its life from.</p>';
    const lk = role => (like ? like(role, L) : null);
    return L.realm === 'sea' ? seaHTML(L, lk) : landHTML(L, lk);
}

function landHTML(L, lk) {
    const az = L.azonal.map(a => AZONAL_WORDS[a]).filter(Boolean);
    let s = `<p class="evo-life-head"><b>${L.realm === 'fresh' ? `${HABITAT_WORDS[L.freshHabitat] ?? 'Fresh water'} in ${(HABITAT_WORDS[L.habitat] ?? L.habitat).toLowerCase()} country` : HABITAT_WORDS[L.habitat] ?? L.habitat}</b>`
        + `${az.length ? `, with ${az.join(' and ')}` : ''} · ${growWords(L.npp)} (NPP ${n0(L.npp)} g/m²/yr)</p>`;
    s += GRADE_LINE;
    s += '<div class="evo-life-web">';
    if (L.npp > 0) {
        const graze = L.grazeShare, herbWords = L.herbivores > 0 ? `${mass(L.herbivores)}/km²${graze >= 0.15 && graze <= 0.85 ? ` · grazers ~${n0(100 * graze)} %, browsers ~${n0(100 * (1 - graze))} %` : graze > 0.85 ? ' · mostly grazers' : ' · mostly browsers'}` : 'too little growth to feed large ones';
        s += tier('PREDATORS', L.predators, 'pred', L.predators > 0 ? `large ones ${mass(L.predators)}/km²` : '—', lk('bigPredator'));
        s += tier('HERBIVORES', L.herbivores, 'herb', `large ones ${herbWords}`, lk(graze >= 0.5 ? 'grazer' : 'browser'));
        s += tier('PLANTS', L.npp * 1000, 'plant', `${n0(L.npp)} t/km² grown a year${L.cover ? ` · ${BIOME_WORDS[L.cover.biome]?.toLowerCase() ?? ''}, ${n0(100 * L.cover.V)} % cover` : ''}`, lk('plants'));
    } else s += '<p class="evo-cell-quiet">Too cold or too dry for plants: no food web on the ground.</p>';
    s += '</div>';
    const fu = L.fungi, soil = [];
    if (fu && fu.am + fu.ecm + fu.eric > 0) soil.push(`mycorrhizae ${[[fu.am, 'arbuscular'], [fu.ecm, 'ectomycorrhizal'], [fu.eric, 'ericoid']].filter(([x]) => x >= 0.05).sort((a, b) => b[0] - a[0]).map(([x, w]) => `${w} ${n0(100 * x)} %`).join(' · ')}`);
    if (L.crust >= 0.05) soil.push(`lichens and soil crusts on ~${n0(100 * L.crust)} % of the ground`);
    if (soil.length) s += `<p class="evo-life-soil"><span class="evo-life-role">FUNGI/SOIL</span> ${soil.join(' · ')}</p>`;
    if (L.herbivores > 0) s += `<p class="evo-life-sum">Food web: plants → large herbivores → large predators · predators ${(100 * L.predators / L.herbivores).toFixed(1)} % of their prey's weight</p>`;
    return s + whyHTML(L, 'land');
}

function seaHTML(L, lk) {
    const w = L.web;
    let s = `<p class="evo-life-head"><b>${HABITAT_WORDS[L.habitat] ?? L.habitat}</b> · ${PROVINCE_WORDS[w.province]} waters (plankton ${n0(w.nppC)} g C/m²/yr)</p>`;
    if (L.floor) s += `<p class="evo-life-floor">Below: ${FLOOR_WORDS[L.floor]}</p>`;
    s += GRADE_LINE;
    s += '<div class="evo-life-web">';
    s += tier('FISH', w.fishWetTkm2 * 1000, 'pred', `${w.fishWetTkm2 >= 1 ? `${w.fishWetTkm2.toFixed(w.fishWetTkm2 < 10 ? 1 : 0)} t` : `${n0(w.fishWetTkm2 * 1000)} kg`}/km² a year (wet)`, lk(w.province === 'upwelling' ? 'forageFish' : 'marinePredator'));
    s += `<div class="evo-life-steps">↑ ${w.steps} step${w.steps === 1 ? '' : 's'} at ${n0(100 * w.eff)} % each</div>`;
    s += tier('PLANKTON', w.nppC * 1000, 'plant', `${n0(w.nppC)} t C/km² grown a year`, lk('plankton'));
    s += '</div>';
    s += `<p class="evo-life-sum">Food web: ${w.steps} step${w.steps === 1 ? '' : 's'} from plankton to fish (Ryther: the fewer the steps, the more of the growth reaches fish)</p>`;
    return s + whyHTML(L, 'sea');
}

const whyHTML = (L, realm) => `<details class="evo-life-why"><summary>why</summary><p>${L.why.join(' · ')}${L.habitat ? ` → <i>${L.habitat}</i>` : ''}</p><p class="evo-life-src">${SOURCES[realm]}</p></details>`;
