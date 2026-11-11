// The life of a place at TODAY'S GRADE (ecodesign L0, lanes ecodesign/report.md §2, §8): what a modern, Earth-like biosphere
// would make of the place's finished climate, water and ground — its habitat, how much grows, the herbivores and predators
// that growth feeds, its fungi and soil crusts, and at sea the plankton's yield and the steps from it to fish. The history
// of life (oxygen, which kinds of life exist yet, extinctions, each landmass's own lineages: ecodesign L1–L4) comes later;
// until then every world is read as if its life were Earth's today, and the panel says so.
//
// A pure function of one place's facts (cell-panel.js placeFacts) plus the climate's 1° grid: no finish stage, no cost to
// the finish — the panel works it out on click (~0.1 ms). The biomass and the pyramid come from measured relations, not
// from tables by biome:
//   NPP (land)       the Miami model (Lieth 1975; civ/substrate.js miamiNpp), g dry matter /m²/yr, from the year's T and rain;
//   herbivores       large-herbivore biomass from NPP across Africa's intact faunas, from the Namib to the wettest parks
//                    (Fløjgaard et al. 2022, J. Appl. Ecol. 59: 18 — preprint bioRxiv 10.1101/2020.02.27.968461, Table 1:
//                    ln B = −2.66 + 1.26 ln N, n = 69, R² 0.43; B kg/km², N MODIS MOD17A3 NPP in its stored unit,
//                    0.1 g C/m²/yr — the unit read off their Table 2, whose predictions the megaherbivore fit gives only with
//                    N in that unit: Faia Brava 605,900 kg C/km²/yr → 0.01·6059^1.51 = 5,180 kg/km², printed 5,173);
//                    dry matter → carbon by 0.47 (IPCC 2006 AFOLU default carbon fraction);
//   predators        Hatton et al. 2015 (Science 349: aac6284, Fig. 1): across African savanna parks the large carnivores
//                    (lion, hyena, leopard, cheetah, wild dog) weigh 0.094 · prey^0.73 kg/km² — the pyramid grows
//                    bottom-heavy as prey thickens (a tenfold richer park has ~5.4× the predators, not 10×);
//   the sea          Ryther 1969 (Science 166: 72): the plankton's yield by province (open ocean 50, coastal 100, upwelling
//                    300 g C/m²/yr), the steps from it to fish (5, 3, 1.5) and each step's efficiency (10, 15, 20 %);
//                    fish production = yield × efficiency^steps (Lindeman 1942's ladder, Ryther's numbers).
// Habitat (the analogue cards' keys, ./analogues/keys.js) is named from the finish's own ground cover (finish-cover.js
// landCover — recomputed here from the place's twelve months, as the finish computes it), Köppen, height, the coast and
// the sea beside it.
//
// What it skips (its limits, README "The Life section"):
//   - one grade only (today's, all kinds of life open); no landmass size or isolation (body-size caps, endemics: L1–L4);
//   - the herbivore law is Africa's, with its megafauna: it reads "present-natural" (no people, no lost megafauna), and
//     forests sit on the same line as savannas (the African data hold both; closed rainforest's ground herbivores are fewer
//     on other continents — Fløjgaard et al. find no line at all outside Africa);
//   - the sea's yield is Ryther's three provinces, not a nutrient model; reefs and kelp read the coastal tier though they
//     grow far more; no sea depth beyond the finish's picture (vents and seeps only where the frame's ridge is);
//   - mycorrhizae and soil crusts are shares from the cover by the rule of where each grows (Steidinger et al. 2019;
//     Belnap & Lange 2001), their thresholds recalled, not fitted;
//   - richness and endemism are not estimated (ecodesign §2.5: they need the history).

import { landCover, newCover, Biome } from '../finish/finish-cover.js';
import { miamiNpp } from '../civ/substrate.js';
import { Regime } from '../finish/finish-hydro.js';
import { KOPPEN_CLASSES } from '../climate/koppen.js';
import { Margin } from '../tectonics/measure.js';
import { CrustType } from '../tectonics/model/crust.js';
import { BoundaryKind } from '../tectonics/model/world.js';
import { PARAMS } from '../climate/config.js';
import { LAND_HABITATS, AZONAL_HABITATS, SEA_HABITATS, FRESH_HABITATS } from './analogues/keys.js';

// ── the measured relations ──
export const LIFE = Object.freeze({
    carbonPerDm: 0.47,                  // g C per g dry matter (IPCC 2006 AFOLU vol. 4 default carbon fraction)
    herbLnA: -2.66, herbK: 1.26,        // Fløjgaard et al. 2022 Table 1, Africa (mean NPP, 100 km): ln B = lnA + k ln N
    herbNppUnit: 0.1,                   // … N's unit, g C/m²/yr (MOD17A3's stored integer, scale 1e-4 kg C/m²; see the header)
    predC: 0.094, predK: 0.73,          // Hatton et al. 2015 Fig. 1: predator = c · prey^k (kg/km²), African savannas
    // Ryther 1969 Table 1: a province's yield (g C/m²/yr), its trophic steps to fish, each step's ecological efficiency
    sea: Object.freeze({ oceanic: [50, 5, 0.10], coastal: [100, 3, 0.15], upwelling: [300, 1.5, 0.20] }),
    fishWetPerC: 10,                    // g wet fish per g C (fish are ~10 % carbon by wet mass; recalled — Pauly & Christensen 1995 use 1:9)
});

// ── classification thresholds (habitat keys; recalled where marked, sourced where cited) ──
const H = {
    // the sea counts as upwelling where the wind drives ≥ 0.5 m²/s of water offshore per metre of coast (a Bakun index of
    // 50 m³/s per 100 m — the main upwelling seasons off California, Peru and NW Africa run ~50–200; recalled), welling up
    // over the climate's own coastal zone (climate/config.js OCEAN_COAST_KM, 300 km): its 1° field is that transport ÷ the
    // zone's width, so the threshold is too — 0.5 / 300 km = 0.14 m/day (upwellingMd below)
    upwellM2s: 0.5,
    shelfKm: 0.2,                       // the shelf's edge (~200 m; and the photic zone's floor)
    deepKm: 1.0,                        // below this, the deep sea
    reefColdSst: 18,                    // °C coldest-month SST for reef-building corals (Kleypas et al. 1999)
    reefDepthKm: 0.1,                   // … shallow enough for their light (Kleypas: most reef growth above ~30–50 m; the picture's cell is coarser)
    kelpWarmSst: 20,                    // °C warmest-month SST at or under which kelp forests grow (Steneck et al. 2002)
    mangroveColdSst: 20,                // °C coldest-month SST for mangroves (Giri et al. 2011: the 20 °C winter isotherm)
    coastKm: 40,                        // a cell this near the sea is "on the coast" (~two cells at 2.5M; mangroves, fog)
    fogKm: 150,                         // fog off a cold sea reaches this far inland (the Namib's fog belt ~100–150 km; recalled)
    coldSeaAnom: -2,                    // °C: a sea this much colder than its latitude's mean makes fog (Atacama, Namib; recalled)
    epeiricKm: 300,                     // a shelf sea over continental crust this far from land is an epeiric sea
    iceSea: 0.5, iceEdge: 0.1,          // sea-ice share of the year: polar sea / its edge
    gyreSst: 18,                        // °C: warm, stratified open water without upwelling is the oligotrophic gyre (Longhurst 2007; recalled)
    treelineTw: 10,                     // °C warmest month: no trees below it (Köppen's E; Körner & Paulsen 2004 put the line at 6.4 °C growing-season mean)
    lapseCPerKm: 6.5,                   // °C/km, the standard atmosphere's: to tell a mountain's cold from a latitude's
    tropicAlpineRange: 10,              // °C warmest − coldest: an aseasonal alpine belt is the tropics' (páramo, puna, Afroalpine)
    riparianQ: 10,                      // m³/s: a river big enough to keep its own gallery forest (ecodesign §2.1)
    riparianKm: 20,                     // … within this of the place
    karstCarb: 0.5,                     // limestone share of the rock at which karst forms (recalled)
    youngLavaMyr: 10,                   // a flood basalt this young is still bare-ish rock (primary succession; one frame)
};

/** The upwelling (m/day, the climate's coastal-zone mean) at which a sea counts as an upwelling sea. */
export const upwellingMd = () => H.upwellM2s / (PARAMS.OCEAN_COAST_KM * 1000) * 86400;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const R_KM = 6371;

/** The sea's fields near (lat, lon) on the climate's 1° grid: the sea cells within `km`, the nearest weighting most —
 *  for a coast's fog and mangroves, which live on land but answer to the sea beside them. null if no sea is that near. */
export function nearSea(C, lat, lon, km = H.fogKm) {
    const g = C?.grid, sea = C?.sea;
    if (!g || !sea) return null;
    const w = g.w, h = g.h, step = 180 / h, Ts = C.Tsea ?? C.T, reach = Math.ceil(km / (111.2 * step)) + 1;
    const y0 = Math.floor((90 - lat) / step), x0 = Math.floor((lon + 180) / step);
    let wsum = 0, tY = 0, tJ = 0, tL = 0, up = 0, an = 0, best = Infinity;
    for (let dy = -reach; dy <= reach; dy++) {
        const y = y0 + dy;
        if (y < 0 || y >= h) continue;
        const la = 90 - (y + 0.5) * step, cl = Math.max(0.05, Math.cos(la * Math.PI / 180)), rx = Math.min(w >> 1, Math.ceil(reach / cl));
        for (let dx = -rx; dx <= rx; dx++) {
            const x = (((x0 + dx) % w) + w) % w, i = y * w + x;
            if (sea[i] !== 1) continue;
            const lo = -180 + (x + 0.5) * step, d = gcKm(lat, lon, la, lo);
            if (d > km) continue;
            const k = 1 / (1 + d / 50);
            wsum += k; tY += k * Ts.year[i]; tJ += k * Ts.jan[i]; tL += k * Ts.jul[i];
            up += k * Math.max(0, C.upwelling?.year[i] ?? 0); an += k * (C.sstAnom?.year[i] ?? 0);
            if (d < best) best = d;
        }
    }
    if (!wsum) return null;
    return { tYear: tY / wsum, tJan: tJ / wsum, tJul: tL / wsum, upwelling: up / wsum, anom: an / wsum, km: best };
}
function gcKm(la1, lo1, la2, lo2) {
    const r = Math.PI / 180, a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ── land ──

/** Large-herbivore biomass (kg/km²) on land growing `nppDm` g dry matter /m²/yr (Fløjgaard et al. 2022, Africa). */
export function herbivoreKgKm2(nppDm, L = LIFE) {
    const n = nppDm * L.carbonPerDm / L.herbNppUnit;
    return n > 1 ? Math.exp(L.herbLnA + L.herbK * Math.log(n)) : 0;
}
/** Large-predator biomass (kg/km²) on `preyKgKm2` of large-herbivore prey (Hatton et al. 2015). */
export const predatorKgKm2 = (preyKgKm2, L = LIFE) => (preyKgKm2 > 0 ? L.predC * preyKgKm2 ** L.predK : 0);

/** The zonal land habitat (LAND_HABITATS) from the cover, Köppen, height and the coast. */
function landHabitat(cv, K, heightKm, seaBeside, coastKm, margin) {
    const b = cv.biome, code = KOPPEN_CLASSES[K.koppen]?.code ?? '';
    // (cold enough for no trees: by altitude — the same months at sea level would grow them — or by latitude)
    if (b === Biome.TUNDRA || b === Biome.POLAR_DESERT || b === Biome.ICE) {
        if (b === Biome.ICE) return 'ice';
        const byHeight = cv.warmest + H.lapseCPerKm * Math.max(0, heightKm) >= H.treelineTw;
        if (byHeight) return cv.warmest - cv.coldest <= H.tropicAlpineRange ? 'montane-grassland' : 'alpine';
        return b === Biome.TUNDRA ? 'tundra' : 'polar-desert';
    }
    // (a coastal desert beside a cold, upwelling sea: fog feeds it)
    if ((b === Biome.DESERT || b === Biome.SEMI_DESERT) && seaBeside && seaBeside.km <= H.fogKm
        && (seaBeside.upwelling >= upwellingMd() || seaBeside.anom <= H.coldSeaAnom)) return 'fog-desert';
    // (a tropical sedimentary coast: mangroves)
    if (coastKm <= H.coastKm && heightKm < 0.02 && seaBeside && Math.min(seaBeside.tJan, seaBeside.tJul) >= H.mangroveColdSst
        && margin !== Margin.ACTIVE && cv.V >= 0.35) return 'mangrove';
    // (Köppen settles what the cover's shares leave open: the dry-summer climates are the Mediterranean scrub whatever their
    // tree share; the cold-winter needle-leaf woodland at the tundra's edge is the taiga's (WWF lumps forest-tundra with
    // boreal); a very wet, cool-summer forest coast is temperate rainforest — WWF's own definitions)
    if (code.startsWith('Cs') && (b === Biome.STEPPE || b === Biome.GRASSLAND || b === Biome.WOODLAND || b === Biome.SEMI_DESERT || b === Biome.MEDITERRANEAN)) return 'mediterranean';
    if ((b === Biome.WOODLAND || b === Biome.CONIFER) && cv.needle >= 0.5 && cv.coldest < -8) return 'boreal';
    if ((b === Biome.CONIFER || b === Biome.EVERGREEN || b === Biome.DECIDUOUS) && cv.wetness >= 2 && /^C.[bc]$/.test(code)) return 'temperate-rainforest';
    switch (b) {
        case Biome.RAINFOREST: return 'tropical-rainforest';
        case Biome.DRY_FOREST: return 'tropical-dry-forest';
        case Biome.SAVANNA: return 'tropical-savanna';
        case Biome.DESERT: return 'desert';
        case Biome.SEMI_DESERT: return 'xeric-shrubland';
        case Biome.MEDITERRANEAN: return 'mediterranean';
        case Biome.GRASSLAND: return cv.coldest >= 15 ? 'tropical-savanna' : 'temperate-grassland';
        case Biome.STEPPE: return 'temperate-grassland';
        case Biome.BOREAL: return 'boreal';
        case Biome.CONIFER: return 'temperate-conifer';
        case Biome.EVERGREEN: return 'temperate-broadleaf';
        case Biome.DECIDUOUS: return 'temperate-broadleaf';
        case Biome.WOODLAND: return cv.needle >= 0.5 ? 'temperate-conifer' : 'temperate-broadleaf';
        default: return 'xeric-shrubland';
    }
}

/** Mycorrhizal shares of the plant cover (Read 1991; Steidinger et al. 2019, Nature 569: 404): ectomycorrhizal where
 *  decomposition is slow (cold or seasonally dry: needle-leaved trees and the temperate broadleaves — Pinaceae, Fagaceae,
 *  Betulaceae), ericoid in heath and tundra, arbuscular elsewhere (grasses, herbs, most tropical trees). Recalled cut-offs. */
function fungi(cv) {
    if (cv.V <= 0) return { am: 0, ecm: 0, eric: 0 };
    const slow = 1 - smooth(8, 20, cv.tAnn);                                   // (decomposition slowed by the cold)
    const ecmTree = cv.tree * Math.max(cv.needle, (1 - cv.needle) * slow * (1 - cv.evergreen * smooth(16, 22, cv.coldest)));
    const eric = (cv.V - cv.tree) * (1 - smooth(6, 14, cv.warmest));           // (dwarf shrubs, heath, tundra)
    const am = Math.max(0, cv.V - ecmTree - eric);
    return { am: am / cv.V, ecm: ecmTree / cv.V, eric: eric / cv.V };
}
/** Lichens and biological soil crusts on the open ground (Belnap & Lange 2001; Elbert et al. 2012): they hold what vascular
 *  plants leave bare, where there is water enough for them (dew, fog, snowmelt) — none on the hyper-arid core or under ice. */
function crusts(cv, fog) {
    if (cv.biome === Biome.ICE) return 0;
    const bare = 1 - cv.V, wet = Math.max(smooth(0.03, 0.15, cv.wetness), fog ? 1 : 0), warmEnough = smooth(-2, 3, cv.warmest);
    return bare * wet * warmEnough;
}

// ── the sea ──
/** The sea's habitat (SEA_HABITATS) by its surface — what lives in the light and feeds everything below: ice, upwelling, the
 *  shelf's kinds, the open sea's warmth — and its floor, where it is deep (deep-sea, or a vent or seep where the frame's
 *  plate edge is a ridge or a trench). */
function seaHabitat(F, sea, depthKm, frame, w) {
    const sstCold = Math.min(sea.tJan, sea.tJul), sstWarm = Math.max(sea.tJan, sea.tJul), ice = sea.ice ?? 0, up = sea.upwelling ?? 0, U = upwellingMd();
    const b = frame?.boundary?.[w], floor = depthKm > H.deepKm ? (b === BoundaryKind.RIDGE ? 'vent' : b === BoundaryKind.SUBDUCTING ? 'seep' : 'deep-sea') : null;
    const coastal = (F.coastKm ?? Infinity) <= PARAMS.OCEAN_COAST_KM;
    let habitat;
    if (ice >= H.iceSea) habitat = 'polar-sea';
    else if (ice >= H.iceEdge) habitat = 'sea-ice-edge';
    else if (up >= U && coastal) habitat = 'upwelling-shelf';
    else if (depthKm <= H.shelfKm) {
        const margin = frame?.margin ? frame.margin[w] & Margin.TYPE : 0;
        if (depthKm <= H.reefDepthKm && sstCold >= H.reefColdSst) habitat = 'coral-reef';
        else if (depthKm <= H.reefDepthKm && sstWarm <= H.kelpWarmSst && margin === Margin.ACTIVE) habitat = 'kelp';
        else if ((F.coastKm ?? 0) >= H.epeiricKm && frame && frame.type[w] !== CrustType.OCEAN) habitat = 'epeiric';
        else if (depthKm <= H.reefDepthKm && (F.coastKm ?? Infinity) <= H.coastKm) habitat = sstCold >= 10 ? 'seagrass' : 'salt-marsh';
        else habitat = 'shelf';
    } else habitat = up >= U || sea.tYear < H.gyreSst ? 'open-productive' : 'open-gyre';
    return { habitat, floor };
}
const PROVINCE = { 'upwelling-shelf': 'upwelling', 'open-productive': 'coastal', shelf: 'coastal', epeiric: 'coastal', 'coral-reef': 'coastal',
    kelp: 'coastal', seagrass: 'coastal', 'salt-marsh': 'coastal', 'sea-ice-edge': 'coastal', 'polar-sea': 'oceanic', 'open-gyre': 'oceanic',
};

/** The sea's food web by Ryther's province: yield, steps to fish, efficiency, fish production. */
export function seaWeb(habitat, L = LIFE) {
    const prov = PROVINCE[habitat] ?? 'oceanic', [npp, steps, eff] = L.sea[prov];
    const fishC = npp * eff ** steps;                                           // g C/m²/yr
    return { province: prov, nppC: npp, steps, eff, fishC, fishWetTkm2: fishC * L.fishWetPerC };   // (g/m² = t/km²)
}

// ── a place ──

/**
 * The life of a place (F: cell-panel.js placeFacts) at today's grade — or null without a climate. C: the climate the panel
 * reads (the finish's, else the preview's); frame: the moment's frame (its sim cell's crust, margin and boundary).
 * Returns { grade, realm, habitat, azonal[], …the realm's numbers, why[] } — and `match`, the analogue matcher's input
 * (keys.js MatchInput), so the cards can be laid over it.
 */
export function lifeFacts(F, C, frame) {
    const K = F?.climate;
    if (!K) return null;
    const w = F.simCell, out = { grade: 'today', source: K.source, why: [] };
    const freshKind = { lake: 'lake', saltLake: 'saline-lake', cutSea: 'lake', sillSea: 'lake' }[F.kind];

    if (F.kind === 'ocean') {
        if (!K.sea) return null;
        const depthKm = Math.max(0, -F.heightM / 1000), { habitat, floor } = seaHabitat(F, K.sea, depthKm, frame, w), web = seaWeb(habitat);
        Object.assign(out, { realm: 'sea', habitat, floor, depthKm, sea: K.sea, web });
        out.why.push(`${depthKm < 1 ? `${Math.round(depthKm * 1000)} m` : `${depthKm.toFixed(1)} km`} deep`, `the sea ${K.sea.tYear.toFixed(0)} °C (${Math.min(K.sea.tJan, K.sea.tJul).toFixed(0)}–${Math.max(K.sea.tJan, K.sea.tJul).toFixed(0)})`,
            K.sea.upwelling > 0.05 ? `upwelling ${K.sea.upwelling.toFixed(2)} m/day` : 'little upwelling', K.sea.ice > 0.05 ? `ice ${Math.round(100 * K.sea.ice)} % of the year` : null);
        out.match = { realm: 'sea', habitat, floor, zKm: -depthKm, marine: { sstC: K.sea.tYear, sstColdC: Math.min(K.sea.tJan, K.sea.tJul), depthKm, upwellingMd: K.sea.upwelling ?? 0, seaIce: K.sea.ice ?? 0 }, grades: null };
        out.why = out.why.filter(Boolean);
        return out;
    }
    if (!K.land && !freshKind) return null;
    if (!K.T12) return null;

    // the cover, as the finish works it out from the place's months (finish-cover.js)
    const cv = landCover(K.T12, K.P12, newCover(), undefined, undefined, F.lat);
    const heightKm = F.heightM / 1000, margin = frame?.margin ? frame.margin[w] & Margin.TYPE : 0;
    const seaBeside = F.coastKm != null && F.coastKm <= H.fogKm ? nearSea(C, F.lat, F.lon) : null;
    const habitat = landHabitat(cv, K, heightKm, seaBeside, F.coastKm ?? Infinity, margin);
    const npp = cv.biome === Biome.ICE || KOPPEN_CLASSES[K.koppen]?.code === 'EF' ? 0 : miamiNpp(K.tAnnual, K.pAnnual);
    const herb = herbivoreKgKm2(npp), pred = predatorKgKm2(herb), fog = habitat === 'fog-desert';
    const azonal = [];
    const r = F.river;
    if (r && r.q >= H.riparianQ && r.km <= H.riparianKm) azonal.push('riparian');
    if (r && r.regime === Regime.FLOOD && r.km <= H.riparianKm) azonal.push('floodplain');
    if (F.kind === 'saltPan') azonal.push('salt-flat');
    if ((F.ground?.facies?.carb ?? 0) >= H.karstCarb) azonal.push('karst');
    if (F.ground?.volcanic?.kind === 'lip' && F.ground.volcanic.atMyr != null && F.timeMyr - F.ground.volcanic.atMyr <= H.youngLavaMyr) azonal.push('young-lava');
    const flooded = azonal.includes('floodplain') && cv.grass > cv.tree && (habitat === 'tropical-savanna' || habitat === 'temperate-grassland');

    Object.assign(out, {
        realm: freshKind ? 'fresh' : 'land', habitat: flooded ? 'flooded-grassland' : habitat, freshHabitat: freshKind ?? null, azonal,
        cover: { V: cv.V, tree: cv.tree, grass: cv.grass, needle: cv.needle, evergreen: cv.evergreen, biome: cv.biome, wetness: cv.wetness, warmest: cv.warmest, coldest: cv.coldest },
        npp, herbivores: herb, predators: pred, grazeShare: cv.V > 0 ? cv.grass / cv.V : 0,
        fungi: fungi(cv), crust: crusts(cv, fog), seaBeside,
    });
    out.why.push(`${KOPPEN_CLASSES[K.koppen]?.code ?? '?'} · ${K.tAnnual.toFixed(0)} °C · ${Math.round(K.pAnnual)} mm`, `cover ${Math.round(100 * cv.V)} % (trees ${Math.round(100 * cv.tree)} %)`,
        heightKm > 0.5 ? `${Math.round(F.heightM)} m up` : null,
        fog ? `a cold sea ${Math.round(seaBeside.km)} km away (${seaBeside.anom.toFixed(1)} °C against its latitude${seaBeside.upwelling > 0.05 ? `, upwelling ${seaBeside.upwelling.toFixed(2)} m/day` : ''})` : null,
        ...azonal.map(a => ({ riparian: `a river of ${Math.round(r.q)} m³/s`, floodplain: 'its river floods', 'salt-flat': 'a closed basin\'s salt', karst: 'limestone at the surface', 'young-lava': 'young flood basalt' }[a])));
    out.why = out.why.filter(Boolean);
    out.match = { realm: out.realm, habitat: out.realm === 'fresh' ? freshKind : out.habitat, azonal, biome: cv.biome, koppen: KOPPEN_CLASSES[K.koppen]?.code,
        tAnnual: K.tAnnual, pAnnual: K.pAnnual, warmest: cv.warmest, coldest: cv.coldest, npp, tree: cv.tree, grass: cv.grass, zKm: heightKm, grades: null, isolation: null, bodyCapKg: null, earthLikeMa: null };
    return out;
}

// (the vocabulary this module may emit — a check holds it to the frozen keys)
export const EMITS = Object.freeze({
    land: Object.freeze(['tropical-rainforest', 'tropical-dry-forest', 'tropical-savanna', 'desert', 'xeric-shrubland', 'fog-desert', 'mediterranean',
        'temperate-grassland', 'temperate-broadleaf', 'temperate-conifer', 'temperate-rainforest', 'boreal', 'tundra', 'polar-desert', 'ice',
        'montane-grassland', 'alpine', 'flooded-grassland', 'mangrove']),
    azonal: Object.freeze(['riparian', 'floodplain', 'salt-flat', 'karst', 'young-lava']),
    sea: Object.freeze([...Object.keys(PROVINCE), 'deep-sea', 'vent', 'seep']),
    fresh: Object.freeze(['lake', 'saline-lake']),
});
export const KEYS = { LAND_HABITATS, AZONAL_HABITATS, SEA_HABITATS, FRESH_HABITATS };
