// Perturbed history paths for the path-sensitive checks (coast9, 2026-11-05).
// A history is chaotic: a no-physics nudge of an unrelated parameter sends it down another path (check-kit.mjs, "checks over a
// distribution of histories"). To ask whether a check judges the physics or the path, run its suite on several paths of the
// SAME model: GEO_SIM_PATH=k nudges plumeSpacingKm (how far a new plume rises from a live one, 1500 km) by ×(1 + k·1e-3) —
// 1.5 km per k, far under the uncertainty of the number, and the check-kit's own example of a neutral nudge. Unset or 0 is
// main's own path, the one the gate runs; the nudge is in the history cache's key (it is in the start world), so each path
// is built once. (gjallar's control nudged trenchDenudationKmPerMyr: with rockBook on, 63b39b6, that flux no longer enters
// the history — riverSupplyKm3 is bit-identical at ×1.003 — so it no longer leaves main's path; measured 2026-11-05.)
export const PATH_K = Number(process.env.GEO_SIM_PATH || 0);

/** The world, on path PATH_K (in place; returns it). */
export function onPath(world) {
    if (PATH_K !== 0) world.config.plumeSpacingKm *= 1 + PATH_K * 1e-3;
    return world;
}
