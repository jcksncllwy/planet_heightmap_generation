// A cell's way of life (plans/CIV_PLAN.md §9.3, §9.5): what frames keep, and what towns and polities read. Today's model
// (sim.js) sets it by its switches; the economy will read it off what people eat (lifeOfDiet).

/** A cell's way of life, as frames keep it. (HERDER last: the older values keep their numbers.) */
export const Life = Object.freeze({ EMPTY: 0, FORAGER: 1, SEDENTARY: 2, CULTIVATING: 3, FARMER: 4, IRRIGATOR: 5, HERDER: 6 });
export const LIFE_NAMES = ['empty', 'foragers', 'settled foragers', 'cultivators', 'farmers', 'irrigation farmers', 'herders'];

/** Farms fields: farmers and irrigation farmers — who build towns and hold farmland. */
export const farms = l => l === Life.FARMER || l === Life.IRRIGATOR;
/** Lives in one place: settled foragers, cultivators and farmers. Herders move with their herds. */
export const settled = l => l >= Life.SEDENTARY && l <= Life.IRRIGATOR;

/**
 * The way of life a diet shows (§9.3's labels): its largest class, ties to the earlier of wild, cultivated, crops, herds.
 * @param diet { wild, cultivated, crops, herds } — shares of the people fed (wild foods; crops' wild forms under
 *   cultivation, not yet domesticated; domesticated crops; herds), summing to 1 or less
 * @param canals  its fields are watered by canals
 * @param packed  dense, storable wild food (aquatic, nuts, wild seeds) with the people past the packing threshold
 */
export function lifeOfDiet({ wild = 0, cultivated = 0, crops = 0, herds = 0 }, canals = false, packed = false) {
    const top = Math.max(wild, cultivated, crops, herds);
    if (!(top > 0)) return Life.EMPTY;
    if (wild === top) return packed ? Life.SEDENTARY : Life.FORAGER;
    if (cultivated === top) return Life.CULTIVATING;
    if (crops === top) return canals ? Life.IRRIGATOR : Life.FARMER;
    return Life.HERDER;
}
