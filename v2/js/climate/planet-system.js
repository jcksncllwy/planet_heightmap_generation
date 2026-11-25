// The planet and its star: ONE object the climate (insolation, temperature, rain, evaporation) and the ice read — the star's
// luminosity and type, the orbit's size, shape and tilt, and how the orbit varies through time. Every value defaults to
// Earth's (lane iceage, Jackson 2026-11-25: "a general planet-and-star system … default every value to Earth's"). DOM-free.
//
//   star.luminosityLsun   the star's luminosity in Suns (IAU 2015 nominal L☉ = 3.828e26 W; Prša et al. 2016)
//   star.teffK            its effective temperature (K): its spectrum, as a black body's colour. The Sun 5772 K (Prša et al.
//                         2016). Where the climate uses it: the snow's and the ice's broadband albedo (albedoRatios, below) —
//                         ice and snow are bright in the visible and dark in the near-infrared, so a cool red star's light
//                         is absorbed by them far more, a hot white star's less (Shields et al. 2013, Astrobiology 13, 715).
//                         What it does NOT reach (the climate is gray otherwise): the air's absorption (more of a red star's
//                         light is absorbed by water vapour and CO2 above the surface), Rayleigh scattering's colour, the
//                         sea's and the land's own spectra, the ocean's mixing depth of sunlight, and photosynthesis.
//   star.spectralType     a label only (from teffK where not given)
//   orbit.semiMajorAU     the orbit's mean distance (AU): the sunlight at the top of the air is S_EARTH · L / a² (S_EARTH, the
//                         total solar irradiance at 1 AU: 1360.8 ± 0.5 W/m², Kopp & Lean 2011)
//   orbit.eccentricity    e: the sunlight through the year goes as (a/r)² = ((1 + e cos ν)/(1 − e²))² (ν the true anomaly), and
//                         the seasons' lengths with Kepler's second law. Earth 0.0167
//   orbit.obliquityDeg    the axis's tilt. Earth 23.44
//   orbit.perihelionSunLonDeg  where in its year the planet is nearest its star: the star's longitude, seen from the planet,
//                         from the northern spring equinox, at perihelion. Earth 282.9° (perihelion ~3 January; Berger's
//                         ϖ, the longitude of perihelion from the moving equinox, is this − 180°: 102.9°)
//   orbit.cycle           how the three above vary with time: null (fixed), or a table of Berger 1978's form (berger1978.js:
//                         obliquity a cosine series about its mean, e cos π / e sin π cosine and sine series, the precession
//                         a sine series about its steady rate) — Earth's: BERGER_1978. With a cycle the values above are
//                         replaced by the cycle's at `epochKyr`.
//   epochKyr              when, in thousands of years before the moment the planet is drawn at (Earth's "present": 1950 CE).
//                         0 with Earth's cycle gives e 0.0167, 23.44°, ϖ 102.7° (Berger 1978 at 1950).
// The calendar: t in months from the start of the month after the northern winter solstice; the northern spring equinox stays
// at t = EQUINOX_MONTH (insolation.js) whatever the orbit (a calendar kept to the seasons, as Earth's is), and the months are
// equal shares of the year in time — so with e > 0 the star moves faster near perihelion and the seasons differ in length.
// What it skips: the planet's rotation rate (day length 24 h), its radius and gravity (the climate's are Earth's), tides,
// and the anomalistic year's difference from the tropical (the ~21 kyr precession cycle is the cycle's).

import { BERGER_1978 } from './berger1978.js';

export const S_EARTH = 1361;                 // W/m² at 1 AU from the Sun (insolation.js SOLAR_CONSTANT)
export const SUN_TEFF_K = 5772;

export const EARTH_SYSTEM = Object.freeze({
    star: Object.freeze({ luminosityLsun: 1, teffK: SUN_TEFF_K, spectralType: 'G2V' }),
    // (the values today — J2000: e 0.01671, ε 23.44°, ϖ 102.94°; Simon et al. 1994. The cycle is off by default: Berger
    // 1978 at 1950 gives the same to < 0.01 and the ice age turns it on)
    orbit: Object.freeze({ semiMajorAU: 1, eccentricity: 0.0167, obliquityDeg: 23.44, perihelionSunLonDeg: 282.94, cycle: null }),
    epochKyr: 0,
});

/** A full system from a partial one (any missing value Earth's). */
export function systemOf(s = null) {
    if (!s) return EARTH_SYSTEM;
    return { star: { ...EARTH_SYSTEM.star, ...(s.star ?? {}) }, orbit: { ...EARTH_SYSTEM.orbit, ...(s.orbit ?? {}) }, epochKyr: s.epochKyr ?? 0 };
}

/** Earth's orbital cycle (Berger 1978) as a system's orbit.cycle. */
export const EARTH_CYCLE = BERGER_1978;

const DEG = Math.PI / 180, ARCSEC = 1 / 3600;

/**
 * The orbit at its epoch: { eccentricity, obliquityDeg, perihelionSunLonDeg }. With a cycle, Berger 1978's sums (the
 * formulae of shr_orb_mod.F90 shr_orb_params, which follow the paper) at `epochKyr` before the present.
 */
export function orbitAt(system = EARTH_SYSTEM) {
    const s = systemOf(system), o = s.orbit, C = o.cycle;
    if (!C) return { eccentricity: o.eccentricity, obliquityDeg: o.obliquityDeg, perihelionSunLonDeg: o.perihelionSunLonDeg };
    const years = -1000 * s.epochKyr;            // (the series run in years from 1950, the past negative)
    let ob = 0, ec = 0, es = 0, mv = 0;
    for (const [a, r, p] of C.obliquity) ob += a * ARCSEC * Math.cos((r * ARCSEC * years + p) * DEG);
    for (const [a, r, p] of C.eccentricity) { const x = (r * ARCSEC * years + p) * DEG; ec += a * Math.cos(x); es += a * Math.sin(x); }
    for (const [a, r, p] of C.precession) mv += a * ARCSEC * Math.sin((r * ARCSEC * years + p) * DEG);
    const e = Math.hypot(ec, es), fixedPerihelion = Math.atan2(es, ec) / DEG;          // (π, from the fixed equinox)
    const varpi = fixedPerihelion + C.precessionRateArcsec * ARCSEC * years + C.precessionPhaseDeg + mv;   // (ϖ, from the moving equinox)
    return { eccentricity: e, obliquityDeg: C.obliquityMeanDeg + ob, perihelionSunLonDeg: (((varpi + 180) % 360) + 360) % 360 };
}

/** The year's sunlight at the top of the air at the orbit's mean distance (W/m²): S_EARTH · L / a². */
export const solarConstantOf = (system = EARTH_SYSTEM) => { const s = systemOf(system); return S_EARTH * s.star.luminosityLsun / (s.orbit.semiMajorAU ** 2); };

/**
 * The star through the year: at(t) → { declination (radians), irradiance (W/m², at the planet's distance then) } for t in
 * months (insolation.js's calendar). Kepler's equation solved for the mean anomaly at t, the spring equinox held at
 * `equinoxMonth`. With e = 0 this is insolation.js's circular orbit exactly.
 */
export function starCalendar(system = EARTH_SYSTEM, equinoxMonth = 2.63) {
    const { eccentricity: e, obliquityDeg, perihelionSunLonDeg } = orbitAt(system), S0 = solarConstantOf(system);
    const sinEps = Math.sin(obliquityDeg * DEG), Lp = perihelionSunLonDeg * DEG, k = Math.sqrt((1 + e) / (1 - e));
    // (the mean anomaly at the spring equinox, where the star's longitude λ = ν + Lp is 0)
    const Eeq = 2 * Math.atan(Math.tan(-Lp / 2) / k), Meq = Eeq - e * Math.sin(Eeq);
    const at = t => {
        const M = Meq + 2 * Math.PI * (t - equinoxMonth) / 12;
        let E = M;
        for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        const nu = 2 * Math.atan(k * Math.tan(E / 2)), lambda = nu + Lp;
        return { declination: Math.asin(sinEps * Math.sin(lambda)), irradiance: S0 * ((1 + e * Math.cos(nu)) / (1 - e * e)) ** 2 };
    };
    return { at, eccentricity: e, obliquityDeg, perihelionSunLonDeg, solarConstant: S0 };
}

// The surface's broadband albedo under another star, relative to under the Sun: Shields et al. 2013 Table 2 (SMART, no
// gases or clouds, Rayleigh scattering on — the surface's own, the climate's atmosphere adds the rest): snow 0.850 · 0.797 ·
// 0.520 and blue (bare) ice 0.373 · 0.293 · 0.094 under an F2 (HD 128167, ~6700 K), the Sun and an M3.5 (AD Leo, ~3400 K)
// star. Between them by the star's effective temperature, linearly; held at the ends.
const ALBEDO_BY_TEFF = [[3400, 0.520 / 0.797, 0.094 / 0.293], [SUN_TEFF_K, 1, 1], [6700, 0.850 / 0.797, 0.373 / 0.293]];
/** { snow, ice }: the factor the star's spectrum puts on the snow's and the ice's albedo (1 under the Sun). */
export function albedoRatios(system = EARTH_SYSTEM) {
    const T = systemOf(system).star.teffK, A = ALBEDO_BY_TEFF;
    if (T <= A[0][0]) return { snow: A[0][1], ice: A[0][2] };
    if (T >= A[2][0]) return { snow: A[2][1], ice: A[2][2] };
    const i = T < A[1][0] ? 0 : 1, f = (T - A[i][0]) / (A[i + 1][0] - A[i][0]);
    return { snow: A[i][1] + f * (A[i + 1][1] - A[i][1]), ice: A[i][2] + f * (A[i + 1][2] - A[i][2]) };
}
