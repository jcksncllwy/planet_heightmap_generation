/**
 * How much of the glacial cycle the sea stands below a sill: the share of time a sea behind that sill is cut off from the
 * world ocean, and how often the sea falls below it — each fall a fresh isolation its water must be drawn down from
 * again. Lane highstand, 2026-11-12 (Jackson's option (a), seaage/report.md Task 3).
 *
 * From the Spratt & Lisiecki 2016 sea-level stack (Clim. Past 12:1079, doi:10.5194/cp-12-1079-2016; NOAA WDS
 * Paleoclimatology, `SeaLev_longPC1`: the scaled first principal component of five reconstructions, 0–798 ka, one value a
 * kyr, metres above today's sea). Tabulated every 5 m from +20 m (above the record's highest stand, +19 m at MIS 5e/11:
 * never reached, always cut off) to −130 m (its lowest, the LGM's: never below, never cut off):
 *   f      the share of the 799 values below the sill (the stack's mean, −52.9 m, is the finish's lowstand, carveSeaDropKm);
 *   falls  how many times, oldest to youngest, the sea passes from above the sill to below it within the record (a sea cut
 *          off before 798 ka and never refilled since counts none).
 * Earth's straits read off it: the Bosporus (−35 m) 0.67, cut off through every glacial — the Black Sea's Neoeuxine lake
 * (Ryan et al. 1997); Bab-el-Mandeb (−137 m) 0, never closed at the LGM (Siddall et al. 2003, Nature 423:853); Gibraltar's
 * Camarinal sill (−284 m) 0 — the Messinian closure was tectonic, not eustatic (Krijgsman et al. 1999).
 * It is a Pleistocene cycle, ±60 m about its mean: an Earth-now assumption (greenhouse epochs swing tens of metres, Miller
 * et al. 2005, Science 310:1293), the one the finish's lowstand already makes.
 */
const TOP_M = 20, STEP_M = 5;
const F = [1, 0.992, 0.987, 0.982, 0.976, 0.954, 0.91, 0.859, 0.806, 0.761, 0.718, 0.668, 0.618, 0.568, 0.512, 0.453, 0.409,
    0.36, 0.322, 0.283, 0.243, 0.199, 0.151, 0.11, 0.075, 0.063, 0.048, 0.031, 0.019, 0.004, 0];
const FALLS = [0, 1, 1, 1, 2, 5, 11, 14, 14, 14, 16, 14, 15, 16, 17, 14, 14, 12, 9, 9, 14, 14, 10, 7, 6, 5, 5, 3, 4, 1, 0];
/** The record's length (kyr): the stack's falls are per this long. */
export const STACK_KYR = 798;

/**
 * The share of the cycle a sill (km, against today's sea) is above the sea, and the sea's falls below it per STACK_KYR;
 * linear between the table's rows, 1 and 0 falls above it, 0 below it.
 * @param {number} sillKm
 * @returns {{f: number, falls: number}}
 */
export function cutOffShare(sillKm) {
    const x = (TOP_M - 1000 * sillKm) / STEP_M;
    if (!(x > 0)) return { f: 1, falls: 0 };
    if (x >= F.length - 1) return { f: 0, falls: 0 };
    const i = Math.floor(x), u = x - i;
    return { f: F[i] + u * (F[i + 1] - F[i]), falls: FALLS[i] + u * (FALLS[i + 1] - FALLS[i]) };
}
