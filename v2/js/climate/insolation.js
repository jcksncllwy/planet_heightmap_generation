// Sunlight at the top of the atmosphere: daily-mean insolation by latitude and time of year. The star and the orbit (its
// eccentricity, tilt, perihelion, the star's luminosity and distance) are planet-system.js's: insolationTable takes its
// starCalendar; declination(t, tilt) is the circular orbit's (e = 0), kept for the tools. DOM-free.
//
// Calendar: t in months from the start of the month after the northern winter solstice (Earth: 1 January); month m
// is centred on t = m + 0.5. The northern spring equinox falls at t = 2.63 (Earth: 20 March).

export const SOLAR_CONSTANT = 1361;          // W/m²
export const EQUINOX_MONTH = 2.63;

/** Daily-mean insolation (W/m²) at latitude φ (radians) when the solar declination is δ (radians). */
export function dailyInsolation(phi, delta, S0 = SOLAR_CONSTANT) {
    const x = -Math.tan(phi) * Math.tan(delta);
    const h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);           // hour angle of sunset (polar night / day)
    return (S0 / Math.PI) * (h0 * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(h0));
}

/** Solar declination (radians) at time t (months), for axial tilt in degrees. */
export function declination(t, tiltDeg) {
    const L = 2 * Math.PI * (t - EQUINOX_MONTH) / 12;                    // solar longitude
    return Math.asin(Math.sin(tiltDeg * Math.PI / 180) * Math.sin(L));
}

/**
 * Insolation per latitude row at NT evenly spaced times of year (t_k = 12·k / NT months).
 * @param {Float64Array} latDeg  row latitudes
 * @param {{at: (t: number) => {declination: number, irradiance: number}}} star  planet-system.js starCalendar
 * @returns {Float64Array} NT × rows, time-major
 */
export function insolationTable(latDeg, star, NT = 24) {
    const rows = latDeg.length, out = new Float64Array(NT * rows);
    for (let k = 0; k < NT; k++) {
        const { declination: delta, irradiance } = star.at(12 * k / NT);
        for (let j = 0; j < rows; j++) out[k * rows + j] = dailyInsolation(latDeg[j] * Math.PI / 180, delta, irradiance);
    }
    return out;
}
