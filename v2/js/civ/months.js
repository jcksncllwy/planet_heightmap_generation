// A cell's twelve months, packed, as the finish keeps them for the civ layer (civ-finish.js) — on their own, so the
// crops' code (crops.js), worked out from them later, is not the finish's: changing it builds no finished world again.

/** A cell's twelve months packed, two bytes a month: °C in half degrees (−64…63.5), and rain as √mm × 8 (to 1016 mm a
 *  month; 2.5 mm steps at 100 mm, 8 at 1000) — what the finish keeps per land cell (civ-finish.js), for cropsFromMonths. */
export const packT = t => Math.max(-128, Math.min(127, Math.round(2 * t))), unpackT = b => b / 2;
export const packP = p => Math.min(255, Math.round(8 * Math.sqrt(Math.max(0, p)))), unpackP = b => (b / 8) ** 2;
/** A collector for the climate's onCell: each cell's months, packed ({T: Int8Array, P: Uint8Array}, 12 a cell). */
export function monthsCollector(n) {
    const months = { T: new Int8Array(12 * n), P: new Uint8Array(12 * n) };
    return { months, add(c, T12, P12) { for (let m = 0; m < 12; m++) { months.T[12 * c + m] = packT(T12[m]); months.P[12 * c + m] = packP(P12[m]); } } };
}
