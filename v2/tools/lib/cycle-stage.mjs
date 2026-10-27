// Earth's land and sea by the stage of the supercontinent cycle (2026-10-27). Earth today is one moment of its cycle —
// dispersed, ~200 Myr after Pangaea began to break up — and the land share depends on the stage: the sea stands low
// against a supercontinent (its own warm mantle lifts it, the ocean's floor is old and deep) and high once it has broken
// up (the pieces ride onto cooled mantle, young ridges fill the basins). So a land share is compared against the
// range for the stage the frame is in, not today's alone (terrain/sea-level.js).

/** The stage a frame is in, by its supercontinent cycle (frame.cycle: step/supercontinent.js), or null between stages. */
export function stageOf(frame) {
    const c = frame.cycle;
    if (!c || !c.up) return null;
    if (c.phase === 'assembled') return 'supercontinent';
    // (Pangaea began to rift ~200 Ma; the Cretaceous highstand peaked ~90 Ma, ~110 Myr later — the seas spread over the
    // Late Jurassic and Cretaceous, 50–150 Myr after the breakup began; today is ~200 Myr after it)
    const after = c.breakupAt === null || c.breakupAt === undefined ? null : frame.time - c.breakupAt;
    if (after === null) return null;
    if (after >= EARLY_DISPERSAL_MYR[0] && after <= EARLY_DISPERSAL_MYR[1]) return 'early dispersal';
    return after > EARLY_DISPERSAL_MYR[1] ? 'late dispersal' : null;
}
export const EARLY_DISPERSAL_MYR = [50, 150];

/**
 * Earth's land share (% of the planet) by stage. Today 29 % (dispersed, late). A supercontinent's sea stood near
 * today's level or a little below it (Late Permian–Triassic: Haq & Al-Qahtani 2005), its continents little flooded
 * (Ronov 1994): 28–33 %. At the Cretaceous highstand (+170–250 m: Haq & Al-Qahtani 2005; Müller et al. 2008) shallow
 * seas covered ~30 % of today's continental area (Worsley et al. 1984; Ronov 1994): ~29 × 0.7 ≈ 20 %, 18–24 %.
 */
export const EARTH_LAND = {
    'supercontinent': { earth: [28, 33], source: 'Pangaea: the sea near today’s level or below it, little flooded (Haq & Al-Qahtani 2005; Ronov 1994)' },
    'early dispersal': { earth: [18, 24], source: 'the Cretaceous highstand: ~30 % of today’s continents under shallow seas (Worsley et al. 1984; Ronov 1994)' },
    'late dispersal': { earth: [24, 30], source: '29 % today' },
};
/** …and as a share of the same history's own late-dispersal (today-like) land: the stage's effect, whatever the crust's area. */
export const EARTH_LAND_RATIO = {
    'supercontinent': { earth: [1.0, 1.15], source: 'Pangaea’s sea at or below today’s (Haq & Al-Qahtani 2005)' },
    'early dispersal': { earth: [0.65, 0.8], source: '~30 % of today’s continental area flooded (Worsley et al. 1984; Ronov 1994)' },
};
