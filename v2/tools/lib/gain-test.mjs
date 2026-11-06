// Judging "read A is better than read B" over several paired samples (coast9, 2026-11-05). Three histories' worth of reads, each
// required to favour A, flipped on about one history in six on perturbed paths of main when A and B differ by 0.01–0.03: the
// sign of a small gain, on few samples, is chance. These two tests are over every paired sample at once.
const stats = xs => { const n = xs.length, m = xs.reduce((s, v) => s + v, 0) / n, sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, n - 1)); return { n, mean: m, se: sd / Math.sqrt(n), pos: xs.filter(v => v > 0).length }; };

/** A beats B: the mean gain is positive and a majority of the samples favour A (the kit's own "more than half" rule). */
export function gainPositive(gains) { const s = stats(gains); return { ...s, ok: s.n > 0 && s.mean > 0 && s.pos > s.n / 2 }; }

/** A is not worse than B: only a mean gain below zero by more than two standard errors fails (one-sided, a true tie fails ~2 % of the
 *  time). For two reads that are the same by construction — the ridge kernels sit on the crust in both — where a positive gain is not
 *  expected and its sign is noise. */
export function gainNotWorse(gains) { const s = stats(gains); return { ...s, ok: s.n > 0 && s.mean + 2 * s.se >= 0 }; }
