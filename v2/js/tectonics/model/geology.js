// The geological record each piece of crust keeps: what happened at its surface — the sediment laid on it and what kind,
// how deep erosion has cut into it, how long it stood in a live magmatic arc — so the finish can say what rock is exposed
// there. Records only, like the heights (step/geology.js): the history never reads them. The raster keeps them in full
// (model/crust.js); a frame keeps them packed into bytes (the encodings below — one place for writer and readers).
// Ported from World Orogen (raguilar011095, GPL v3), without its shallow-sea record (lane litho: no shelf or flooding here).

// Bit flags for the `geoFlags` field: settings the crust has been in, which its other records do not keep.
export const GeoFlag = Object.freeze({
    WAS_ARC: 1,       // born in an island arc — kept after it matures into continent (arc-maturation.js only changes `type`)
    FORELAND: 2,      // sat in a foreland basin (the heights sank it under a range's load)
    RIFT_BASIN: 4,    // sat in a rift basin while it was young (a failed arm, an aulacogen)
    OPHIOLITE: 8,     // ocean floor caught up into land as a sea closed (ops/merge-plates.js closeSeasBetween, ops/collapse-arc.js)
    SLAB_CHANGE: 16,  // stood in a live arc when its slab flattened or steepened (porphyry copper's favourite moment)
    BELT_FRONT: 32,   // lay on the plain just before a live belt's outer edge (by distance alone: not a basin, see step/geology.js)
});

// ── A frame's geology fields: what each holds and how it is packed into a byte or two per cell ──
export const GEO_FRAME_FIELDS = ['geoFlags', 'coverKm', 'coverMaxKm', 'coverMaxAge', 'facies', 'exhumKm', 'unroofKm', 'arcMyr'];

// (cover by the square root: fine where thin, ~0.2 km at 10 km; to 25 km, past the deepest filled sea's ~20 km, sea-fill.js)
const COVER_MAX_KM = 25;
const EXHUM_STEP_KM = 0.25, ARC_STEP_MYR = 2, AGE_STEP_MYR = 8;

export const encodeCoverKm = km => Math.min(255, Math.round(255 * Math.sqrt(Math.max(0, km) / COVER_MAX_KM)));
export const decodeCoverKm = v => COVER_MAX_KM * (v / 255) ** 2;
export const encodeExhumKm = km => Math.min(255, Math.round(Math.max(0, km) / EXHUM_STEP_KM));
export const decodeExhumKm = v => v * EXHUM_STEP_KM;
export const encodeUnroofKm = km => Math.max(-127, Math.min(127, Math.round(km / EXHUM_STEP_KM)));
export const decodeUnroofKm = v => v * EXHUM_STEP_KM;
export const encodeArcMyr = myr => Math.min(255, Math.round(myr / ARC_STEP_MYR));
export const decodeArcMyr = v => v * ARC_STEP_MYR;
/** How long ago (Myr), in AGE_STEP_MYR steps (0…2040 Myr). */
export const encodeAge = myr => Math.min(255, Math.max(0, Math.round(myr / AGE_STEP_MYR)));
export const decodeAge = v => v * AGE_STEP_MYR;
/** The cover's make-up, a nibble each (0…15): carbonate, salt, coal, organic-rich (source rock); the rest sand and mud. */
export function encodeFacies(carb, salt, coal, organic) {
    const q = x => Math.min(15, Math.max(0, Math.round(15 * x)));
    return q(carb) | (q(salt) << 4) | (q(coal) << 8) | (q(organic) << 12);
}
export function decodeFacies(v, out = { carb: 0, salt: 0, coal: 0, organic: 0 }) {
    out.carb = (v & 15) / 15; out.salt = ((v >> 4) & 15) / 15; out.coal = ((v >> 8) & 15) / 15; out.organic = ((v >> 12) & 15) / 15;
    return out;
}
