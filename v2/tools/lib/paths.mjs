// Perturbed history paths for the path-sensitive checks (coast9, 2026-11-05).
// A history is chaotic: a no-physics nudge of an unrelated parameter sends it down another path (check-kit.mjs, "checks over a
// distribution of histories"). To ask whether a check judges the physics or the path, run its suite on several paths of the
// SAME model: GEO_SIM_PATH=k nudges trenchDenudationKmPerMyr by ×(1 + k·1e-4) — gjallar's control on main (0.1001 · 0.0999 ·
// 0.1002 are k = 1, −1, 2) — a 0.01 % change of a flux that is ~5 % of nothing a check reads, only enough to leave the
// float-identical path. Unset or 0 is main's own path, the one the gate runs; the nudge is in the history cache's key (it is in
// the start world), so each path is built once.
export const PATH_K = Number(process.env.GEO_SIM_PATH || 0);

/** The world, on path PATH_K (in place; returns it). */
export function onPath(world) {
    if (PATH_K !== 0) world.config.trenchDenudationKmPerMyr *= 1 + PATH_K * 1e-4;
    return world;
}
