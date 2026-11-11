// The shared vocabulary of the ecology layer (ecodesign §2, §5, §7; the matcher's contract agreed between the eco-now lane L0
// and the analogue lane L5 through the supervisor, 2026-11-11). The detail pass (L0, later L6) names a cell's habitat, its
// marine tier, the world's open grades and the cell's roles with these keys; the analogue cards (./cards*.js) are keyed by the
// same strings, and matchAnalogues (./match.js) reads a MatchInput built from them. Frozen: renaming a key silently orphans
// every card and every caller that uses it, so an amendment goes through the supervisor as a recorded ruling.
//
// Strings, not numbers: the cards are hand-written data, and a readable key is what keeps a card checkable by eye.

/** Land habitats (zonal), about one per WWF biome (Olson et al. 2001; Dinerstein et al. 2017) plus the splits §2.1 adds. */
export const LAND_HABITATS = Object.freeze([
    'tropical-rainforest',   // aseasonal wet tropics (Af; Am's wetter part)
    'tropical-dry-forest',   // seasonal tropical forest that drops its leaves in the dry season (Am/Aw, high tree cover)
    'tropical-savanna',      // tropical grass with scattered trees, fire and a long dry season (Aw)
    'desert',                // hot or cold desert (BWh, BWk)
    'xeric-shrubland',       // semi-desert scrub and thorn steppe (BSh, BSk with shrubs)
    'fog-desert',            // coastal desert watered by fog off a cold upwelling sea (Namib, Atacama)
    'mediterranean',         // dry-summer scrub and woodland (Cs*)
    'temperate-grassland',   // prairie, steppe, pampas (BSk, Cf*/Df* with low tree cover)
    'temperate-broadleaf',   // deciduous or mixed broadleaf forest (Cfa, Cfb, Dfa, Dfb)
    'temperate-conifer',     // needle-leaf forest of the warm and temperate belts
    'temperate-rainforest',  // very wet cool coast forest (Cfb/Cfc on a windward coast)
    'boreal',                // taiga (Dfc, Dfd, Dwc …)
    'tundra',                // treeless arctic and subantarctic (ET)
    'polar-desert',          // dry polar ground with lichen and little else
    'ice',                   // ice sheet or cap (EF)
    'montane-grassland',     // high grassland above the forest in the warm belts (páramo, puna, Afroalpine)
    'alpine',                // above the treeline in the cool belts (Körner & Paulsen 2004)
    'flooded-grassland',     // seasonally flooded grass and swamp (Pantanal, Sudd, Okavango)
    'mangrove',              // tidal forest of tropical sedimentary coasts
]);

/** Azonal land habitats, overlaid on a zonal one (§2.1): a cell can have several. */
export const AZONAL_HABITATS = Object.freeze([
    'riparian', 'floodplain', 'lake-shore', 'wetland', 'dune', 'karst', 'ultramafic', 'young-lava', 'cave', 'salt-flat',
]);

/** Marine habitats and productivity tiers (§2.1's table; Ryther 1969, Longhurst 2007). */
export const SEA_HABITATS = Object.freeze([
    'coral-reef', 'kelp', 'seagrass', 'salt-marsh', 'upwelling-shelf', 'shelf', 'epeiric',
    'open-gyre', 'open-productive', 'polar-sea', 'sea-ice-edge', 'deep-sea', 'vent', 'seep',
]);

/** Fresh and inland waters. */
export const FRESH_HABITATS = Object.freeze(['lake', 'river', 'saline-lake']);

/** Realms: which habitat list a cell's `habitat` comes from. */
export const REALMS = Object.freeze(['land', 'sea', 'fresh']);

/** Grades: the kinds of life a world has opened (ecodesign §4.2, §5 `life.grades`). A card lists the grades it needs. */
export const GRADES = Object.freeze([
    'algae',        // eukaryotic algae (present at the anchor, ~750 Ma-like)
    'animals',      // animals in the sea (Ediacaran–Cambrian)
    'landPlants',   // plants on land (cryptospores ~470 Ma; vascular ~430)
    'landAnimals',  // arthropods and then tetrapods ashore (~420; ~375–365 Ma)
    'forests',      // trees and forests (~385 Ma)
    'seeds',        // seed plants: dry interiors open (~365 Ma)
    'woodRot',      // lignin-degrading (white-rot) fungi (~295 Ma by molecular clock; Floudas et al. 2012)
    'flowers',      // flowering plants and their pollinators (~140–125 Ma)
    'grasses',      // grasses and open grassland (grasses ~70–55 Ma; open grassland Miocene)
    'c4',           // C4 grassland (expansion 8–6 Ma)
    'primates',     // primates (~66–56 Ma)
    'hominins',     // hominins (~7–6 Ma)
]);

/** Roles (ecodesign §2.3's guild table plus the sea's). A card fills the roles its assemblage had. */
export const ROLES = Object.freeze([
    // land
    'plants', 'grazer', 'browser', 'megaherbivore', 'frugivore', 'granivore', 'nectarivore',
    'bigPredator', 'smallPredator', 'insectivore', 'scavenger', 'decomposer', 'pollinator', 'seedDisperser',
    'engineer', 'flyer', 'arboreal', 'burrower',
    // water
    'aquaticGrazer', 'aquaticPredator', 'plankton', 'filterFeeder', 'forageFish', 'marinePredator', 'topMarine',
    'reefBuilder', 'benthos', 'shoreBird',
]);

/** Body-size classes, by adult mass (decades from 1 kg). */
export const SIZE_CLASSES = Object.freeze({ xs: [0, 1], s: [1, 10], m: [10, 100], l: [100, 1000], xl: [1000, 10000], xxl: [10000, Infinity] });

/** Isolation classes for a card's place (§7.2 step 3). */
export const ISOLATION = Object.freeze(['connected', 'long-isolated', 'island']);

/**
 * One cell, as the matcher reads it. Only `realm` and either `habitat` or `biome`/`koppen` are required: the rest are optional,
 * so the eco-now lane (today's grade, no life record) can call it before the history of life (L1–L4) exists.
 * @typedef {Object} MatchInput
 * @property {'land'|'sea'|'fresh'} realm
 * @property {string} [habitat]        one of LAND_HABITATS / SEA_HABITATS / FRESH_HABITATS by realm
 * @property {'deep-sea'|'vent'|'seep'} [floor]  sea only: the sea floor's habitat beside the surface one (ruling, amendment 1)
 * @property {string[]} [azonal]       AZONAL_HABITATS present in the cell (optional: lake-shore, wetland, dune, ultramafic and
 *                                     cave aren't derivable from the panel's fields yet, so the matcher works without them)
 * @property {number} [biome]          finish-cover Biome id (1–16), used when `habitat` is absent
 * @property {string} [koppen]         Köppen–Geiger code ('Aw', 'BWh', …), likewise
 * @property {number} [tAnnual]        annual mean temperature, °C
 * @property {number} [pAnnual]        annual rain, mm
 * @property {number} [warmest]        warmest month, °C
 * @property {number} [coldest]        coldest month, °C
 * @property {number} [npp]            net primary productivity, g DM/m²/yr (land; Miami)
 * @property {number} [tree]           tree share of the cover, 0–1
 * @property {number} [grass]          grass share of the cover, 0–1
 * @property {number} [zKm]            surface height, km (negative at sea)
 * @property {{sstC?:number, sstColdC?:number, depthKm?:number, upwellingMd?:number, seaIce?:number}} [marine]
 * @property {string[]|null} [grades]  open GRADES; null or absent = today's grade (all open)
 * @property {{endemic?:number, isolatedMyr?:number, areaMkm2?:number}|null} [isolation]  null = a connected continent
 * @property {{herb?:number, carn?:number}|null} [bodyCapKg]  the landmass's largest herbivore and carnivore (§2.2, Burness 2001)
 * @property {number|null} [earthLikeMa]  the clock's "like N Ma"; negative = past Earth's present ("no Earth precedent")
 */
