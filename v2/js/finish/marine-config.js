// The sea's constants the history and the finish share (lane marine, 2026-11-21): a leaf file, so a step of the history
// (step/trench-fans.js, step/surface-erosion.js) and the finish's erosion (finish-erode.js ERODE) read one number each.

/** Storm wave base, km: the depth down to which waves move the floor's sediment — about half a storm wave's deep-water length,
 *  L = gT²/2π, T 8–10 s → 50–80 m (Immenhauser 2009, Earth-Sci. Rev. 96: 20–200 m by setting; Peters & Loss 2012, Geology 40:
 *  one wave population, no separate fair-weather base). Below it the waves' work falls off as e^(−(d − wb)/wb) (Kaufman et al.
 *  1991). A shelf fills toward it, and a sea floor shallower than it is planed. */
export const WAVE_BASE_KM = 0.06;

/** The shelf's diffusivity above wave base, km²/Myr (Kaufman et al. 1991's depth-dependent diffusion). Derived: at grade a shelf
 *  carries its rivers' load across at its topset's slope, q = K·S. Earth's ~10 km³/yr over ~3.5·10⁵ km of coast is q ≈ 3·10⁻⁵
 *  km²/yr; at S ≈ 10⁻³ (130 m over 100–150 km of shelf) K ≈ 0.03 km²/yr. (The Amazon's mud belt, ~1 km³/yr along ~1500 km,
 *  reads ~0.7 km²/yr: the range runs up to ~20× this mean.) */
export const MARINE_K = 3e4;
