// Tunable settings of the new climate, grouped by stage — a handful per stage, each with a physical meaning and a
// unit. Mutable so the tuning suite (tuning/climate/) can set them in-process; the app always uses the defaults.
// Each stage is tuned on its own against its own Earth observations, then frozen (plans/CLIMATE_REBUILD_PLAN.md).
// Tuning is light: the literature value (PARAM_PRIORS below) is the starting point and the pull; the whole Earth is
// used but every continent is scored on its own and none may end up worse than with the literature values.
// Temperature: tuned 2026-09-28 (tuning/climate/temperature-check.mjs --tune) — only the snow albedo, land heat
// store, wind heat-carrying, inversion wind and plateau lapse moved from their literature values.

export const PARAMS_DEFAULTS = Object.freeze({
    // ── Temperature (energy balance, temperature.js) ──
    TEMP_OLR_A: 203.3,          // W/m²       outgoing heat to space at 0 °C (sets the planet's overall warmth)
    TEMP_OLR_B: 2.09,           // W/m²/K     extra outgoing heat per degree warmer
    TEMP_DIFFUSIVITY: 0.65,     // W/m²/K     heat spread toward the poles by weather and ocean (unit-sphere diffusivity)
    TEMP_DIFFUSIVITY_EW: 0.3,   // W/m²/K     heat spread east–west: weaker — weather systems carry heat mainly poleward,
                                //            and land and sea exchange air mostly through the prevailing winds
    TEMP_ALBEDO: 0.30,          // –          share of sunlight reflected (clouds, surface) …
    TEMP_ALBEDO_LAT: 0.15,      // –          … plus this × P2(sin latitude): more at high latitudes (low sun, cloud)
    TEMP_ALBEDO_ICE: 0.60,      // –          reflected by sea ice, and by ground that stays snow-covered all year
    TEMP_ALBEDO_SNOW: 0.325,    // –          reflected by seasonal snow on land (forests and patchy snow keep it low);
                                //            it rises toward the ice value the longer the snow stays each year
    TEMP_ICE_WARM_C: 0,         // °C         snow / ice starts to appear below this …
    TEMP_ICE_COLD_C: -10,       // °C         … and covers everything below this (smooth in between)
    TEMP_LAND_HEAT_CAP: 8.93e6, // J/m²/K     how much heat land stores per degree (air column + top soil)
    TEMP_OCEAN_MIX_M: 50,       // m          depth of the sea's mixed layer (its heat store)
    TEMP_WIND_CARRY: 0.106,     // –          share of the air column's heat the wind carries along (mild west coasts)
    TEMP_INVERSION_C: 10,       // °C         how much colder the air near snowy ground gets than the air above it
                                //            when the sun is weak and the air calm (winter inversions over snow and ice)
    TEMP_INVERSION_WIND: 4.69,  // m/s        wind speed at which that inversion is half mixed away
    TEMP_PLATEAU_LAPSE: 4.84,   // °C/km     how much colder a large region is per km of its mean height (sunlit
                                //            plateaus heat the air above them, so less than the free air's 6.5;
                                //            the terrain cells below the grid still use the standard rate) …
    TEMP_ICE_LAPSE: 8.0,        // °C/km      … and the same for ground under snow most of the year: ice sheets reflect
                                //            the sun and chill the air, so more (blended by how long the snow lasts)
    TEMP_GRID_DEG: 2,           // °          grid the energy balance is solved on (its fields are smooth: 2° scores
                                //            the same as 1° at a third of the cost; results are interpolated to 1°)

    // ── Pressure and wind (circulation.js) ──
    // Tuned 2026-09-28 (tuning/climate/circulation-check.mjs --tune: open loop, continents and ocean basins weighted
    // equally, none worse than with the literature values). Ferrel width, sea friction angle and Hadley scale ended
    // at or near the edge of their ranges — a hint of the simple structure's limits.
    CIRC_HADLEY_SCALE: 1.425,   // –          Hadley-cell width relative to Held & Hou's estimate
    CIRC_FERREL_DEG: 35,        // °          from the subtropical high to the subpolar low (the Ferrel cell)
    CIRC_TROPICAL_HPA: 9.56,    // hPa        how much lower the tropical rain belt is than the subtropical highs
    CIRC_MIDLAT_HPA_PER_K: 0.49,// hPa/K      subtropical high to subpolar low, per degree of temperature drop between …
    CIRC_OPEN_SEA_BOOST: 0.69,  // –          … × (1 + this × the belt's sea share): open sea lets the westerlies run free
    CIRC_POLAR_HPA: 4.75,       // hPa        how much higher the polar high is than the subpolar low
    CIRC_THERMAL_HPA_PER_K: 0.775,// hPa/K    thermal lows and highs: lower pressure per degree warmer than the latitude
    CIRC_ROSSBY_KM: 812,        // km         scale the pressure responds to heating on (the Rossby radius)
    CIRC_TURN_OCEAN_DEG: 10,    // °          surface wind turned toward low pressure by friction, over the sea …
    CIRC_TURN_LAND_DEG: 32.5,   // °          … and over land (rougher)
    CIRC_SURFACE_WIND: 0.7,     // –          near-surface wind as a share of the wind above the friction layer
    CIRC_GRID_DEG: 2,           // °          grid the circulation is computed on (interpolated to 1°)

    // ── Ocean (ocean.js) ──
    OCEAN_FRICTION: 6e-6,       // 1/s        east–west friction of the gyres: sets the western boundary currents' width
                                //            (r/β ≈ 300 km, two cells of the 2° grid)
    OCEAN_FRICTION_NS: 3e-7,    // 1/s        north–south friction: small, so the open ocean keeps its Sverdrup balance
    OCEAN_CHANNEL_DRAG: 7.3e-7, // 1/s        friction balancing the wind in a circumpolar channel (its current's strength)
    OCEAN_GUST_MS: 4.26,        // m/s        wind variability (storms) that monthly-mean winds leave out, for the wind stress
    OCEAN_HEAT_SHARE: 0.073,    // –          share of the gyres' transport whose temperature reaches the sea surface
    OCEAN_UPWELL_DT: 4,         // °C         how much colder upwelled water is than the surface (warm seas; less in cold)
    OCEAN_QFLUX_MAX: 150,       // W/m²       cap on the ocean's local heating or cooling of the surface layer
    OCEAN_CURRENT_DEPTH_M: 200, // m          depth the gyres' transport is spread over, for surface current speed (display)
    OCEAN_GRID_DEG: 2,          // °          grid the ocean is computed on (interpolated to 1°)
});

export const PARAMS = { ...PARAMS_DEFAULTS };

// What each tunable is expected to be on any Earth-like planet: a literature value and a physically plausible
// range. Tuning against Earth may only nudge a setting within its range and pays for moving away from the
// literature value, so the result stays a set of physical constants rather than a fit to Earth's geography.
export const PARAM_PRIORS = Object.freeze({
    TEMP_OLR_A:         { value: 203.3, min: 195, max: 215, source: 'North & Coakley 1979, satellite OLR fit' },
    TEMP_OLR_B:         { value: 2.09, min: 1.6, max: 2.4, source: 'North & Coakley 1979; Graves et al. 1993 (1.5–2.2)' },
    TEMP_DIFFUSIVITY:   { value: 0.65, min: 0.3, max: 1.0, source: 'North 1981 (0.649); North, Mengel & Short 1983 (≈0.67)' },
    TEMP_ALBEDO:        { value: 0.30, min: 0.25, max: 0.35, source: "Earth's planetary albedo ≈ 0.30" },
    TEMP_ALBEDO_LAT:    { value: 0.15, min: 0.0, max: 0.25, source: 'North 1975 P2 albedo term (0.2 incl. ice)' },
    TEMP_ALBEDO_ICE:    { value: 0.60, min: 0.45, max: 0.70, source: 'North 1975 ice-cap albedo 0.62' },
    TEMP_ALBEDO_SNOW:   { value: 0.40, min: 0.30, max: 0.60, source: 'snow-covered forest ≈ 0.2–0.35, open snow 0.6–0.8; seasonal snow is patchy' },
    TEMP_LAND_HEAT_CAP: { value: 8.4e6, min: 3e6, max: 2e7, source: '≈ 2 m water equivalent (air column + top soil)' },
    TEMP_OCEAN_MIX_M:   { value: 50, min: 25, max: 100, source: 'ocean mixed layer, 30–100 m' },
    TEMP_DIFFUSIVITY_EW: { value: 0.3, min: 0.05, max: 1.0, source: 'eddy heat flux is mainly meridional (v′T′ ≫ u′T′); east–west exchange by the mean winds' },
    TEMP_WIND_CARRY:    { value: 0.05, min: 0.0, max: 0.30, source: 'share of the air column\'s heat the (near-surface) wind carries; no direct literature value — bounded by the whole column moving at about the surface wind' },
    TEMP_INVERSION_C:   { value: 10, min: 5, max: 15, source: 'Arctic winter surface inversions ≈ 10–15 K (Serreze et al. 1992); strongest in the dark over snow' },
    TEMP_INVERSION_WIND: { value: 5, min: 3, max: 8, source: 'stable boundary layers break down above ≈ 5–7 m/s near-surface wind' },
    TEMP_PLATEAU_LAPSE: { value: 5.0, min: 4.0, max: 6.5, source: 'near-surface lapse rates over large elevated terrain ≈ 4.5–5.5 °C/km (elevated heating)' },
    TEMP_ICE_LAPSE:     { value: 8.0, min: 6.5, max: 10, source: 'Antarctic ice-sheet surface temperature vs height ≈ 8 K/km (Fortuin & Oerlemans 1990)' },

    CIRC_HADLEY_SCALE:  { value: 1.2, min: 0.9, max: 1.5, source: 'Held & Hou 1980 underestimates the observed Hadley edge by ~20 % (e.g. Frierson et al. 2007)' },
    CIRC_FERREL_DEG:    { value: 30, min: 20, max: 35, source: 'subtropical highs ≈ 30°, subpolar lows ≈ 60° (three-cell circulation)' },
    CIRC_TROPICAL_HPA:  { value: 9, min: 5, max: 14, source: 'zonal-mean sea-level pressure ≈ 1009 hPa in the rain belt vs ≈ 1018 in the subtropical highs' },
    CIRC_MIDLAT_HPA_PER_K: { value: 0.6, min: 0.3, max: 1.2, source: 'the midlatitude drop (≈ 10–30 hPa) grows with the ≈ 20–30 K contrast across the storm belt' },
    CIRC_OPEN_SEA_BOOST: { value: 1.0, min: 0, max: 2.5, source: 'the Southern Ocean\'s westerlies and trough are far stronger than the land-broken northern ones; no direct literature value' },
    CIRC_POLAR_HPA:     { value: 6, min: 2, max: 12, source: 'polar highs a few hPa above the subpolar troughs' },
    CIRC_THERMAL_HPA_PER_K: { value: 1.0, min: 0.4, max: 1.6, source: 'hydrostatic: warming the lowest 2–3 km by 1 K lowers surface pressure ≈ 0.9–1.3 hPa' },
    CIRC_ROSSBY_KM:     { value: 1000, min: 500, max: 2000, source: 'Rossby radius of deformation ≈ 1000 km in midlatitudes' },
    CIRC_TURN_OCEAN_DEG: { value: 20, min: 10, max: 30, source: 'surface wind crosses isobars at ≈ 10–20° over the sea' },
    CIRC_TURN_LAND_DEG: { value: 35, min: 25, max: 45, source: '… and ≈ 30–45° over land' },
    CIRC_SURFACE_WIND:  { value: 0.7, min: 0.5, max: 0.9, source: 'near-surface wind ≈ 0.6–0.8 of the geostrophic wind' },

    OCEAN_FRICTION:     { value: 6e-6, min: 3e-6, max: 1.5e-5, source: 'Stommel layer width r/β should span ≈ 2 grid cells (MITgcm guidance); ≈ 300 km at 2°' },
    OCEAN_GUST_MS:      { value: 6, min: 3, max: 9, source: 'bulk formulas on climatological winds add a gustiness / synoptic speed of a few m/s' },
    OCEAN_CHANNEL_DRAG: { value: 5e-7, min: 1e-7, max: 2e-6, source: 'sets a circumpolar current of ≈ 100–150 Sv on Earth (the ACC)' },
    OCEAN_HEAT_SHARE:   { value: 0.05, min: 0.01, max: 0.2, source: 'scaled to the ocean\'s ≈ 1–2 PW poleward heat transport; no direct literature value' },
    OCEAN_UPWELL_DT:    { value: 4, min: 2, max: 8, source: 'coastal upwelling cools the surface a few °C (thermocline water)' },
});

export function setParams(p) { Object.assign(PARAMS, p); }
export function resetParams() { Object.assign(PARAMS, PARAMS_DEFAULTS); }
