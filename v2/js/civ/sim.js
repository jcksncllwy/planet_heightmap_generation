// The civ layer's people, on a human clock (plans/CIV_PLAN.md §5, Phases 1–3): a finished moment's geography, held fixed,
// lived on from `originBP` for as long as asked. Each cell carries a density (persons/km²) that grows logistically toward
// what its way of life lets the land feed; what changes is the way of life:
//
//   Phase 1  foragers spread from the origin as a front (the glacial climate's capacity, the ice sheets shut until they melt) (travel.js: ~1 km/yr inland, several along coasts and rivers,
//            across water as far as the era's boats reach), each cell filling once reached; the glacial world's lower sea
//            exposes the shelves and land bridges, and drowns them again as it rises (people move inland)
//   economy  from the end of the glacial (plans/CIV_PLAN.md §9.3; econ.js): each cell's diet by equal marginal return over
//            the wild resources and the domesticates it has, its way of life the largest share. Packed foragers settle;
//            where a wild stand is good and already used hard, someone starts to cultivate it, and by use over ~2000 years
//            (Purugganan & Fuller 2009) domesticates it: a centre. Cultivation spreads within the wild range, the
//            domesticated crop as a front of its own (~1 km/yr, faster along coasts and rivers); herds go on to milk, and
//            to pastoralism where the rain is fickle; on a dry alluvium farmers learn irrigation
//   disease  vector fever and snail fever cost a share of the people where the months, the standing water and the
//            parasites' way there allow (disease.js)
//   famine   the settled live year by year on their harvests (climate-var.js: the planet's own good and bad years, the
//            rivers' floods with their catchments' rain), keep a store, and die when it runs out (Halstead & O'Shea
//            1989); foragers move instead
//
// Deterministic: the same world and options give the same history. Frames (density and way of life per cell) every
// `frameYears`, for the timeline.

import { CIV } from './civ-config.js';
import { PACKAGES, FOODS, WILD_FOODS } from './substrate.js';
import { Life, farms, settled, lifeOfDiet } from './life.js';
import { edgeLengths, frontArrival, offshoreKm, schedule, seaGate, toblerFactor } from './travel.js';
import { travelGraph, Craft } from './routes.js';
import { spreadKm } from '../core/min-heap.js';
import { KOPPEN_CLASSES } from '../climate/koppen.js';
import { Polities } from './polity.js';
import { climateVariability, modeSeries, modeLn, normal } from './climate-var.js';
import { parasiteRange, diseaseLoss } from './disease.js';
import { domesticates, allocate, RANK, skillCap, learn, domesticate, cultivated } from './econ.js';

/** A herd's year (plans/CIV_PLAN.md §9.2, the herd response class): the animals the year's grazing (`g`, against a normal
 *  year's) can't carry die, and the herd grows back slowly — over years, where a harvest comes back the next. */
export const herdYear = (stock, g, C = CIV) => {
    const s = stock - C.herdDieOff * Math.max(0, stock - g);
    return s + C.herdRecovery * s * (1 - s);
};

const rise = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DEG = 180 / Math.PI;

export { Life, LIFE_NAMES, farms, settled, lifeOfDiet } from './life.js';

/** Density's one-byte encoding in frames: 0 = nobody, else 10^((q − 1)/40 − 4) persons/km² (1e-4 … ~2000). */
export const densityByte = d => (d > 1e-4 ? Math.min(255, 1 + Math.round(40 * (Math.log10(d) + 4))) : 0);
export const byteDensity = q => (q ? Math.pow(10, (q - 1) / 40 - 4) : 0);

/**
 * @param w    the world (civ-cradles.mjs worldOf / earth-world.mjs): mesh, z (km; the sea floor's depth where known), ocean, lake, koppen
 * @param sub  civSubstrate(w)
 * @param opts { origins: [cell] (default: the richest savanna of the biggest landmass), endBP (default 0), onFrame(frame),
 *   polities (default true: towns and polities, polity.js, every polityStepYears once there are farmers),
 *   famine (default true: good and bad years, climate-var.js), vary (climateVariability(w, sub), if already made),
 *   disease (default true: disease.js), C }
 * @returns { frames (each: density, life, crop — its dominant crop, a FOODS index or −1 — farmPkg, …), centres, totals,
 *   arrivalBP (Float32, per cell; NaN never), farmBP (per cell), cameFrom (per cell: the cell its people came from; −1
 *   never), farmFrom ({crop: per cell, the cell its farmers came from}), coastBP ({crop: when voyagers took it up}),
 *   packages (the ids farmPkg and centres' pkg name: the domesticates', econ.js) }
 */
export function runCivSim(w, sub, opts = {}) {
    const sim = createCivSim(w, sub, opts);
    sim.advance(opts.endBP ?? 0);
    return sim.result();
}

/**
 * The same run, kept alive: advance(toBP) lives on to that year (past 0 BP into the world's future, as far as asked),
 * calling onFrame for each new frame; result() reads it as runCivSim returns it, at any point. opts as runCivSim's,
 * without endBP; frameYears (default C.frameYears) — how often a frame is kept — may be changed between advances.
 */
export function createCivSim(w, sub, { origins = null, onFrame = null, polities = true, famine = true, vary = null, disease = true, C = CIV } = {}) {
    const { mesh, z, ocean, lake, koppen } = w, n = mesh.numCells, { adjOffset, adjList } = mesh, len = edgeLengths(mesh);
    const cellKm2 = sub.cellKm2, T0 = C.originBP;
    const tOf = bp => T0 - bp, bpOf = t => T0 - t;

    // ── where people can be: land, and the shelves the glacial sea lays bare (fed as the nearest coast is) ──
    const minSeaKm = Math.min(...C.seaLevelM.map(r => r[1])) / 1000;
    const shelf = c => ocean[c] && z[c] >= minSeaKm;
    const home = new Int32Array(n).fill(-1), dHome = new Float64Array(n).fill(Infinity);
    for (let c = 0; c < n; c++) if (!ocean[c] && !lake[c]) { home[c] = c; dHome[c] = 0; }
    spreadKm(mesh, dHome, { canEnter: (a, b) => shelf(b), onReach: (a, b) => { home[b] = home[a]; } });
    const Kf = new Float32Array(n), KfG = new Float32Array(n), ice = w.ice ?? null;
    for (let c = 0; c < n; c++) if (home[c] >= 0) { Kf[c] = sub.forager[home[c]]; KfG[c] = sub.forageGlacial[home[c]]; }
    const iced = (c, bp) => ice && ice[c] && bp > C.iceUntilBP;
    const cells = [];
    for (let c = 0; c < n; c++) if (home[c] >= 0) cells.push(c);
    const dry = (c, seaKm) => home[c] >= 0 && (home[c] === c || z[c] >= seaKm);   // (land at this sea level)

    // ── the front's ways: the glacial coasts (an average glacial sea), big rivers, water no wider than the era allows ──
    const frontSeaKm = schedule(C.seaLevelM, 30000) / 1000;
    const isWater = c => !dry(c, frontSeaKm);
    const offshore = offshoreKm(mesh, isWater);
    const coastG = new Uint8Array(n);
    for (const c of cells) if (dry(c, frontSeaKm)) for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) if (isWater(adjList[k])) { coastG[c] = 1; break; }
    const riverQ = sub.river.q;
    const seaSpeed = t => schedule(C.frontSeaKmYr, bpOf(t));
    // the crossings (plans/CIV_PLAN.md §10.2): a water leg's days from the shore, paddled, by the month set out in, on the
    // planet's winds and currents (routes.js) — within the era's reach (C.crossingDays), or the front waits at the shore
    // until the reach grows (crossings only lengthen)
    const paddle = travelGraph(w, sub, Craft.PADDLE, C);
    const crossingOpens = (need, t) => {
        if (schedule(C.crossingDays, bpOf(t)) >= need) return t;
        const K = C.crossingDays;
        for (let i = 1; i < K.length; i++) if (K[i][1] >= need) {
            const [b0, k0] = K[i - 1], [b1, k1] = K[i];
            return Math.max(t, tOf(b0 + (b1 - b0) * (need - k0) / (k1 - k0)));
        }
        return Infinity;
    };
    const crossing = seaGate(paddle, isWater, crossingOpens, mesh);
    const slope = (a, b, k) => toblerFactor((Math.max(0, z[b]) - Math.max(0, z[a])) / len[k]);
    const foragerSpeed = (a, b, k, t) => {
        if (isWater(a) || isWater(b)) return seaSpeed(t);
        const bp = bpOf(t), g = rise(-C.glacialToBP[0], -C.glacialToBP[1], -bp);
        const hab = rise(C.habitableKm2[0], C.habitableKm2[1], KfG[b] + (Kf[b] - KfG[b]) * g);
        if (!hab) return 0;
        let v = C.frontLandKmYr * slope(a, b, k);
        if (coastG[a] && coastG[b]) v = Math.max(v, C.frontCoastKmYr);
        if (riverQ[a] >= C.frontRiverM3s && riverQ[b] >= C.frontRiverM3s) v = Math.max(v, C.frontRiverKmYr);
        return v * hab;
    };

    // ── Phase 1's front, from the origin(s) ──
    if (!origins) {
        // the richest savanna of the landmass (joined by the glacial sea's land bridges) with the most savanna: a species
        // of the open tropical grasslands arising where they are widest, as Africa's did (its savannas the cradle of
        // Homo; deMenocal 2004) — else, with no savanna anywhere, the biggest landmass's richest land
        const part = new Int32Array(n).fill(-1), size = [];
        for (const c0 of cells) {
            if (part[c0] >= 0 || !dry(c0, minSeaKm)) continue;
            const id = size.length, stack = [c0];
            part[c0] = id; size.push(0);
            while (stack.length) {
                const c = stack.pop();
                size[id]++;
                for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const b = adjList[k]; if (part[b] < 0 && home[b] >= 0 && dry(b, minSeaKm)) { part[b] = id; stack.push(b); } }
            }
        }
        const savanna = new Float64Array(size.length), isSavanna = c => KOPPEN_CLASSES[koppen[home[c]]]?.code === 'Aw';
        for (const c of cells) if (part[c] >= 0 && isSavanna(c)) savanna[part[c]]++;
        const main = Math.max(...savanna) > 0 ? savanna.indexOf(Math.max(...savanna)) : size.indexOf(Math.max(...size));
        // (on land at the sea level when people set out: not a glacial shelf that was sea then — a rich fishing coast's
        // shelf cells read their coast's capacity)
        const startSeaKm = schedule(C.seaLevelM, T0) / 1000;
        let best = -1, bk = -1, any = -1, ak = -1;
        for (const c of cells) {
            if (part[c] !== main || !dry(c, startSeaKm)) continue;
            if (isSavanna(c) && Kf[c] > bk) { bk = Kf[c]; best = c; }
            if (Kf[c] > ak) { ak = Kf[c]; any = c; }
        }
        origins = [best >= 0 ? best : any];
    }
    const arrival = new Float64Array(n).fill(Infinity);
    // (each cell's source: who its people came from — the front's cell before it, a voyage's launch, the shelf the sea
    // drove them off — so that they can carry what they know and grow; plans/CIV_PLAN.md §9.4)
    const cameFrom = new Int32Array(n).fill(-1);
    for (const c of origins) { arrival[c] = 0; cameFrom[c] = c; }
    // (barriers that lift: the ice sheets as they melt, the cold country once people are equipped for it — the front waits)
    const coldBy = c => C.coldET - (sub.et[home[c]] + C.glacialDT * 0.6);       // (ET falls ~0.6 °C per °C of cooling)
    const lastCold = C.coldOpensBP[C.coldOpensBP.length - 1];
    const coldOpens = x => (x >= lastCold[0] ? lastCold[1] : schedule(C.coldOpensBP.map(([k, bp]) => [-k, bp]), -x));
    const opensAt = (b, t) => {
        if (isWater(b)) return t;
        let o = t;
        if (ice && ice[b]) o = Math.max(o, tOf(C.iceUntilBP));
        if (coldBy(b) > 0) o = Math.max(o, tOf(coldOpens(coldBy(b))));
        return o;
    };
    frontArrival(mesh, len, arrival, foragerSpeed, null, Infinity, opensAt, cameFrom, crossing);

    // ── disease: where the parasites reached with people (the cold filter), and what each way of life loses ──
    const range = disease ? parasiteRange(w, origins,
        (a, b) => (home[b] >= 0 && dry(b, minSeaKm)) || (isWater(b) && 2 * offshore[b] <= schedule(C.crossingDays, C.holoceneBP) * C.paddleKmh * C.boatHours), C, c => (isWater(c) ? -1 : home[c])) : null;
    const health = (c, settled, irrigating) => (range ? 1 - diseaseLoss(w, home[c], range, sub.wetland[home[c]] > 0 || irrigating ? 1 : 0, irrigating, settled, C) : 1);

    // ── Phase 2–3 state ──
    // (the richest wild stand of the packages' wild cereals and roots: a reason to settle)
    const bestWild = new Float32Array(n);
    for (const c of cells) for (const p of PACKAGES) { const v = sub.wild[p.id][c]; if (v > bestWild[c]) bestWild[c] = v; }
    // the crops and herds that fronts carry (econ.js)
    const DOM = domesticates(sub, C);
    const fit = DOM.map(() => new Float32Array(n));                             // (its climate weight, for the front's speed)
    // (where each one's wild form grows, which its cultivated form may go to before it is domesticated)
    const wildRange = DOM.map(() => new Uint8Array(n));
    const grows = DOM.map((p, i) => {
        const ok = new Uint8Array(n);
        for (const c of cells) {
            const h = home[c], W = p.wild(h), s = p.suit(h);
            wildRange[i][c] = W >= C.wildMin ? 1 : 0;
            // where its own climate grows it, its wild form's range, or (cereals) watered on an alluvium
            ok[c] = s >= C.cropMinSuit || wildRange[i][c] || (p.cereal && sub.irrig[h] >= 0.1) ? 1 : 0;
            fit[i][c] = p.cereal && sub.irrig[h] >= 0.1 ? 1 : Math.min(1, Math.max(s, W));
        }
        return ok;
    });
    const farmArrival = DOM.map(() => new Float64Array(n).fill(Infinity)), farmFrom = DOM.map(() => new Int32Array(n).fill(-1));
    // each package's farmers know irrigation from this long after its first centre; a desert's alluvium waits for it
    const irrigKnown = DOM.map(() => Infinity);
    // (each domesticate's domestication D and skill per cell; and the fronts of its cultivation before it is domesticated —
    // from each onset, within its wild form's range — apart from the domesticated crop's, which comes after and goes on
    // into them: seed is given)
    const Dm = DOM.map(() => new Float32Array(n)), Sk = DOM.map(() => new Float32Array(n));
    const cultArrival = DOM.map(() => new Float64Array(n).fill(Infinity)), cultFrom = DOM.map(() => new Int32Array(n).fill(-1));
    // (a cereal's land with no rain-fed crop: only watered, once canals are known)
    const needsCanal = (i, h, b) => !(DOM[i].suit(h) >= C.cropMinSuit || wildRange[i][b]);
    const farmOpensAt = i => (b, t) => (isWater(b) ? t : needsCanal(i, home[b], b) ? Math.max(t, irrigKnown[i]) : t);
    const farmSpeed = (i, wildOnly = false) => (a, b, k, t) => {
        if (isWater(b)) return seaSpeed(t);
        if (!(wildOnly ? wildRange[i][b] : grows[i][b])) return 0;
        if (isWater(a)) return seaSpeed(t);
        let v = C.frontFarmKmYr * slope(a, b, k);
        if (coastG[a] && coastG[b]) v = Math.max(v, C.frontFarmCoastKmYr);
        if (riverQ[a] >= C.frontRiverM3s && riverQ[b] >= C.frontRiverM3s) v = Math.max(v, C.frontFarmRiverKmYr);
        return v * (C.farmClimateFloor + (1 - C.farmClimateFloor) * fit[i][b]) * (wildOnly ? C.cultivationSpread : 1);
    };
    // (each front's cells in order of arrival, for what its people carry: made again whenever the front moves)
    const order = DOM.map(() => null), cultOrder = DOM.map(() => null);
    const spread = (i, sources) => { frontArrival(mesh, len, farmArrival[i], farmSpeed(i), sources, Infinity, farmOpensAt(i), farmFrom[i], crossing); order[i] = null; };
    const spreadCult = (i, sources) => { frontArrival(mesh, len, cultArrival[i], farmSpeed(i, true), sources, Infinity, farmOpensAt(i), cultFrom[i], crossing); cultOrder[i] = null; };
    // ── voyaging: from when farmers first farm a coast, crossings grow (C.voyageDays) — the world's voyagers carrying every
    // crop farmed on a coast by then (Lapita's kit: Austronesian voyagers took up New Guinea's taro, yams, bananas and
    // breadfruit on the way; Kirch 2017). They land only on shores no one holds, farm them with the best-fitting of those
    // crops (or forage, where none grows), and people spread from there as on any other land ──
    const ladderAt = (L, x) => schedule(L.map(([a, b]) => [-a, b]), -x);         // (a ladder [[x, y], …], x ascending)
    const ladderReaches = (L, y) => {
        if (L[0][1] >= y) return L[0][0];
        for (let i = 1; i < L.length; i++) if (L[i][1] >= y) { const [x0, y0] = L[i - 1], [x1, y1] = L[i]; return x0 + (x1 - x0) * (y - y0) / (y1 - y0); }
        return Infinity;
    };
    const coastT = DOM.map(() => Infinity);
    let firstCoast = Infinity, voyage = null, voyageFrom = null, launch = [];
    const atSea = c => isWater(c) || ocean[c];
    const voyageSpeed = (a, b, k, t) => {
        if (atSea(b)) return ladderAt(C.voyageSeaKmYr, t - firstCoast);
        // (ashore: only from the sea, onto land no one holds, that people can live on — open of ice and cold)
        return atSea(a) && arrival[b] > t && Kf[b] >= C.habitableKm2[0] && opensAt(b, t) <= t ? ladderAt(C.voyageSeaKmYr, t - firstCoast) : 0;
    };
    // (their crossings: paddled until the sail comes, voyageSailYears after the first farmed coast — days at sea by the
    // month set out in, within C.voyageDays then, or waiting until the ladder reaches them)
    const voyageOpens = (need, t) => Math.max(t, firstCoast + ladderReaches(C.voyageDays, need));
    let voyagePaddle = null, voyageSail = null, lastGate = null;
    const launched = [];
    const sailOpens = (need, t) => Math.max(voyageOpens(need, t), firstCoast + C.voyageSailYears);
    const voyageGate = t => (t - firstCoast >= C.voyageSailYears ? (voyageSail ??= seaGate(travelGraph(w, sub, Craft.SAIL, C), atSea, sailOpens, mesh))
        : (voyagePaddle ??= seaGate(paddle, atSea, voyageOpens, mesh)));
    /** The voyage's launch cell for a landing at c: back along its course to the coast it set out from. */
    const launchOf = c => { let a = voyageFrom[c]; for (let k = 0; a >= 0 && voyageFrom[a] !== a && k < n; k++) a = voyageFrom[a]; return a; };
    /** The voyages from the coasts newly farmed, and the landings due by `until` (each with the crops known by then). */
    const sail = until => {
        const v = voyage ??= new Float64Array(n).fill(Infinity), gate = voyageGate(until);
        voyageFrom ??= new Int32Array(n).fill(-1);
        // (the new coasts; and when the sail comes, every coast again: their voyages were planned paddling)
        for (const c of launch) launched.push(c);
        const from = gate !== lastGate ? launched : launch;
        // (the paddlers' plans are dropped: their times at sea would bar the sail's longer legs — and the landings made
        // keep their arrivals)
        if (gate !== lastGate && lastGate) { v.fill(Infinity); voyageFrom.fill(-1); }
        lastGate = gate;
        if (from.length) {
            for (const c of from) { v[c] = Math.min(v[c], farmT[c]); if (v[c] === farmT[c]) voyageFrom[c] = c; }
            launch = [];
            frontArrival(mesh, len, v, voyageSpeed, from, Infinity, null, voyageFrom, gate);
        }
        const landed = [], farmed = DOM.map(() => []);
        for (const c of cells) if (!atSea(c) && v[c] <= until && v[c] < arrival[c]) {
            arrival[c] = v[c]; cameFrom[c] = launchOf(c); landed.push(c);
            let bi = -1;
            for (let i = 0; i < DOM.length; i++) if (coastT[i] <= v[c] && grows[i][c] && DOM[i].suit(home[c]) >= C.cropMinSuit && (bi < 0 || fit[i][c] > fit[bi][c])) bi = i;
            // (the crop's front starts again here: its farmers came from the launch, as cameFrom says — with the crop
            // domesticated and their skill)
            if (bi >= 0 && v[c] < farmArrival[bi][c]) { farmArrival[bi][c] = v[c]; farmFrom[bi][c] = c; farmed[bi].push(c); Dm[bi][c] = 1; Sk[bi][c] = 1; }
        }
        if (landed.length) frontArrival(mesh, len, arrival, foragerSpeed, landed, Infinity, opensAt, cameFrom, crossing);
        farmed.forEach((F, i) => { if (F.length) spread(i, F); });
    };

    const d = new Float32Array(n), life = new Uint8Array(n), farmPkg = new Int8Array(n).fill(-1);
    const farmT = new Float64Array(n).fill(Infinity), centres = [], frames = [], totals = [], started = new Uint8Array(n), startT = new Float64Array(n).fill(Infinity);
    // (the longer a people has lived settled and packed, the poorer the stands it will take up: the odds' steepness eases)
    const settledYears = new Float32Array(n);
    const onsetPower = c => C.onsetPower - (C.onsetPower - C.onsetPowerLate) * Math.min(1, settledYears[c] / C.onsetEaseYears);
    // a cell's chance in a step: a hash of the two, uniform in [0, 1) — the same each run
    const chance = (c, step) => { let h = Math.imul(c ^ 0x9e3779b9 ^ C.chanceSeed, 0x85ebca6b) ^ Math.imul(step + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
    const aquaticHome = c => sub.wetland[home[c]] > 0 || sub.coastal[home[c]] || sub.lakeside[home[c]];

    // ── good and bad years: the settled live year by year on their harvests and their store ──
    const V = famine ? (vary ?? climateVariability(w, sub, C)) : null;
    let modes = V ? modeSeries(Math.ceil(tOf(0)) + C.stepYears + 1, C) : null;   // (grown as the run goes on: the same years, longer)
    const store = new Float32Array(n), famineShare = new Float32Array(n);
    const famineCentury = new Float32Array(n);   // (each cell's famine deaths, summed over the run: a diagnostic)
    const regionNoise = V ? new Float32Array(V.regions * C.stepYears) : null, regionStamp = V ? new Int32Array(V.regions).fill(-1) : null;
    const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    const nppP = p => C.nppMax * (1 - Math.exp(-0.000664 * p));
    const riverNoise = new Map();               // (a river's storms, per year of this step: shared by everyone it waters)
    let riverNoiseStep = -1, famineDead = 0;
    const meanF = new Float32Array(3 * n).fill(NaN), MEAN_DRAWS = 64;
    let herdStock = null, herdMean = null;      // (each cell's herd against a full one, and its long-run mean: made once herds are kept)
    /** One step's years for a settled or herding cell: each year's harvest against a normal one — rain-fed fields by the
     *  substrate's own yield ramp, the river's by its flood (the land watered follows it; a flood far above the usual breaks
     *  the banks and the works), the wild by the forager regression's own response to the year's NPP (water foods steady),
     *  herds by their stock (herdYear: the year's grazing, with the NPP) — its store, its famines. What it lives on, persons/km²:
     *  kR rain-fed fields, kI watered ones, kH herds, Kw the wild; cap, the most it stores (years of food). */
    const liveYears = (c, t, step, cap, kR, kI, kH, Kw) => {
        const h = home[c], y0 = Math.round(t);
        // (what stays the same all step)
        const P = w.pAnnual[h], r = V.region[h], cv = V.rainCV[h];
        if (regionStamp[r] !== step) { regionStamp[r] = step; for (let k = 0; k < C.stepYears; k++) regionNoise[r * C.stepYears + k] = normal(r, y0 + k); }
        const ramp0 = kR > 0 ? smooth(C.rainfedMinMm, C.rainfedFullMm, P) : 0, lnFull = Math.log(C.rainfedFullMm / Math.max(1, P));
        const src = kI > 0 ? sub.irrigSrc[h] : -1;
        let rn = null;
        if (src >= 0) {
            if (riverNoiseStep !== step) { riverNoise.clear(); riverNoiseStep = step; }
            rn = riverNoise.get(src);
            if (!rn) { rn = new Float32Array(C.stepYears); for (let k = 0; k < C.stepYears; k++) rn[k] = V.riverCV[src] * normal(src + 7 * n, y0 + k); riverNoise.set(src, rn); }
        }
        const grazed = Kw > 0 || kH > 0, tl = grazed ? C.nppMax / (1 + Math.exp(1.315 - 0.119 * w.tAnnual[h])) : 0, n0 = grazed ? Math.min(tl, nppP(P)) : 0;
        const steady = aquaticHome(c) ? C.aquaticSteady : 0, kWild = C.foragerSlope * 0.45;
        // (the substrate's yields are averages over good years and bad — Halstead's, Ur III's — so each year's harvest is
        // against its own long-run mean: capacity stays what the land feeds on average)
        if (meanF[3 * c] !== meanF[3 * c]) {
            let mR = 0, mI = 0, mW = 0;
            for (let k = 0; k < MEAN_DRAWS; k++) {
                const aH = normal(k, 101), aL = normal(k, 102), lnx = modeLn(V.rainLn, h, aH, aL) + cv * normal(k, 103);
                mR += ramp0 > 0 ? (lnx >= lnFull ? 1 : smooth(C.rainfedMinMm, C.rainfedFullMm, P * Math.exp(lnx)) / ramp0) : 1;
                const s0 = sub.irrigSrc[h];
                if (s0 >= 0) { const q = Math.exp(modeLn(V.riverLn, s0, aH, aL) + V.riverCV[s0] * normal(k, 104)); mI += q < 1 ? q : q > C.floodHigh ? Math.max(0, 1 - C.floodDamage * (q - C.floodHigh)) : 1; }
                else mI += 1;
                const t1 = C.nppMax / (1 + Math.exp(1.315 - 0.119 * w.tAnnual[h]));
                mW += Math.pow(10, kWild * (Math.min(t1, nppP(P * Math.exp(lnx))) - Math.min(t1, nppP(P))));
            }
            meanF[3 * c] = Math.max(0.05, mR / MEAN_DRAWS); meanF[3 * c + 1] = Math.max(0.05, mI / MEAN_DRAWS); meanF[3 * c + 2] = Math.max(0.05, mW / MEAN_DRAWS);
        }
        // (a herd's mean stock, from a long run of its years: its yield's average over good years and bad, as the fields')
        if (kH > 0) {
            herdStock ??= new Float32Array(n).fill(1); herdMean ??= new Float32Array(n);
            if (!(herdMean[c] > 0)) {
                let s = 1, m = 0;
                for (let k = 0; k < 20 + 4 * MEAN_DRAWS; k++) {
                    const lnx = modeLn(V.rainLn, h, normal(k, 101), normal(k, 102)) + cv * normal(k, 103);
                    s = herdYear(s, Math.min(tl, nppP(P * Math.exp(lnx))) / Math.max(1e-9, n0), C);
                    if (k >= 20) m += s;
                }
                herdMean[c] = Math.max(0.05, m / (4 * MEAN_DRAWS));
            }
        }
        const mR = meanF[3 * c], mI = meanF[3 * c + 1], mW = steady + (1 - steady) * meanF[3 * c + 2];
        let dd = d[c], st = store[c], dead = 0;
        for (let j = 0; j < C.stepYears; j++) {
            const y = y0 + j;
            if (2 * y + 1 >= modes.length) modes = modeSeries(2 * y + 1000, C);
            const aH = modes[2 * y], aL = modes[2 * y + 1];
            const lnx = modeLn(V.rainLn, h, aH, aL) + cv * regionNoise[r * C.stepYears + j];
            let food = 0;
            if (kR > 0) food += kR * (lnx >= lnFull ? 1 : smooth(C.rainfedMinMm, C.rainfedFullMm, P * Math.exp(lnx)) / ramp0) / mR;
            if (src >= 0) {
                const q = Math.exp(modeLn(V.riverLn, src, aH, aL) + rn[j]);
                food += kI * (q < 1 ? q : q > C.floodHigh ? Math.max(0, 1 - C.floodDamage * (q - C.floodHigh)) : 1) / mI;
            } else food += kI;
            if (kH > 0) { const hs = herdStock[c] = herdYear(herdStock[c], Math.min(tl, nppP(P * Math.exp(lnx))) / Math.max(1e-9, n0), C); food += kH * hs / herdMean[c]; }
            if (Kw > 0) food += Kw * (steady + (1 - steady) * Math.pow(10, kWild * (Math.min(tl, nppP(P * Math.exp(lnx))) - n0))) / mW;
            st += food / Math.max(1e-12, dd) - 1;
            if (st > cap) st = cap;
            if (st < 0) {
                const loss = Math.min(C.famineMaxYear, C.famineDeath * -st);
                dead += dd * loss; dd *= 1 - loss; st = 0;
            }
        }
        store[c] = st;
        if (dead > 0) { famineShare[c] += dead / d[c]; famineCentury[c] += dead / d[c]; d[c] = dd; famineDead += dead * cellKm2; }
    };

    let nextFrame = 0, nextPolity = 0, nextVoyage = 0, anyFarmers = false, frameYears = C.frameYears, t = 0, step = 0;
    const pol = polities ? new Polities(w, sub, C) : null, Kc = pol ? new Float32Array(n) : null;
    /** A cell's dominant crop (a FOODS index), or −1: the domesticate that feeds the most of its people, where they
     *  cultivate, farm or herd. */
    const FOOD_OF = DOM.map(p => FOODS.indexOf(p.food));
    const cropOf = c => (life[c] >= Life.CULTIVATING && domTop[c] >= 0 ? FOOD_OF[domTop[c]] : -1);
    // ── the economy (plans/CIV_PLAN.md §9.3; econ.js): what each peopled cell eats, from the end of the glacial on ──
    const NW = WILD_FOODS.length, M = NW + DOM.length, HERD = DOM.findIndex(p => p.herd);
    const Kx = new Float64Array(M), ax = new Float64Array(M), xx = new Float64Array(M), kRi = new Float64Array(DOM.length), kIi = new Float64Array(DOM.length);
    const ordX = Array.from({ length: M }, (_, i) => i), wildFood = WILD_FOODS.map(f => sub.food[f]), wildRank = WILD_FOODS.map(f => RANK[f]);
    const FROM = DOM.map(p => WILD_FOODS.indexOf(p.from)), SAME_FROM = DOM.map(p => DOM.map((q, k) => k).filter(k => DOM[k].from === p.from)), wildK0 = new Float64Array(NW);
    const canalK = DOM.map(p => sub.canalFood[p.food] ?? null), domRank = DOM.map(p => RANK[p.food]), contactKm2 = Math.PI * C.contactKm * C.contactKm;
    // (each cell's land in fields and pasture, its diet's share from crops and herds, its fields' capacity, its main domesticate)
    // (each cell's land as the map shows it: its share in fields, and in pasture — a mobile people's over all they range)
    const fieldLandOf = new Float32Array(n), pastureOf = new Float32Array(n);
    const taken = new Float32Array(n), domShare = new Float32Array(n), cropK = new Float32Array(n), domTop = new Int8Array(n).fill(-1);
    const domRoot = DOM.map(() => new Set());
    // (where herders may go mobile: where the rain fails too often to stay — its CV, the storms' and the modes' — or no
    // crop grows well enough to farm by rain, the cold margins; Ellis & Swift 1988)
    const roam = new Uint8Array(sub.n), herdLand = new Float32Array(sub.n);
    for (let h = 0; h < sub.n; h++) {
        let v = V ? V.rainCV[h] ** 2 : 0;
        if (V) for (let m = 0; m < 4; m++) v += V.rainLn[4 * h + m] ** 2 / 2;
        roam[h] = Math.sqrt(v) >= C.mobileCV || DOM.every(p => p.herd || p.suit(h) < C.cropMinSuit) ? 1 : 0;
        // (the share of the open country settled herds graze)
        herdLand[h] = sub.open[h] > 0 ? Math.min(1, C.herdNear / sub.open[h]) : 0;
    }
    let onsets = [], domesticated = [];
    /** What each front's people carry, in order of arrival: the crop's domestication (seed is given: the most domesticated
     *  of the people it came from) and its skill (mixing toward theirs). Where a crop is newly domesticated, its front goes on
     *  beyond its wild form's range. */
    const ordered = A => {
        const list = [];
        for (let c = 0; c < n; c++) if (A[c] < Infinity) list.push(c);
        list.sort((a, b) => A[a] - A[b]);
        return Int32Array.from(list);
    };
    const pass = (O, A, F, D, S) => {
        for (const c of O) {
            if (A[c] > t) break;
            const a = F[c];
            if (a >= 0 && a !== c) { if (D[a] > D[c]) D[c] = D[a]; S[c] += C.contactShare * (S[a] - S[c]); }
        }
    };
    const carry = () => {
        for (let i = 0; i < DOM.length; i++) {
            cultOrder[i] ??= ordered(cultArrival[i]);
            pass(cultOrder[i], cultArrival[i], cultFrom[i], Dm[i], Sk[i]);
            order[i] ??= ordered(farmArrival[i]);
            pass(order[i], farmArrival[i], farmFrom[i], Dm[i], Sk[i]);
            // (the cultivators whose crop is now domesticated: from them, the domesticated crop's front)
            const src = [], A = farmArrival[i];
            for (const c of cultOrder[i]) {
                if (cultArrival[i][c] > t) break;
                if (Dm[i][c] >= 1 && A[c] > t) { A[c] = t; farmFrom[i][c] = c; src.push(c); }
            }
            if (src.length) spread(i, src);
        }
    };
    const has = (i, c) => cultArrival[i][c] <= t || farmArrival[i][c] <= t;
    /** One cell's generation in the economy: its diet by equal marginal return, its people, its way of life, what it learns,
     *  whether it starts to cultivate (or keep herds), its good and bad years. */
    const economyOf = (c, forageK, bp) => {
        const h = home[c], scale = Kf[c] > 0 ? forageK / Kf[c] : 0, free = 1 - taken[c], share = sub.irrigShare[h];
        // what each resource feeds, at the skill the people have: the wild on the land not in fields or pasture (the land
        // budget); the domesticates they have, their cultivated forms yielding less until domesticated
        for (let j = 0; j < NW; j++) { Kx[j] = wildK0[j] = wildFood[j][h] * scale * free; ax[j] = wildRank[j]; }
        for (let i = 0; i < DOM.length; i++) {
            const j = NW + i, p = DOM[i];
            Kx[j] = 0; ax[j] = 0; kRi[i] = 0; kIi[i] = 0;
            if (!has(i, c)) continue;
            const s = Sk[i][c];
            if (p.herd) kRi[i] = sub.food.herds[h] * (Dm[i][c] < 1 ? 1 : herdLand[h]) * s;   // (wild herds, managed where they range)
            else {
                const rain = C.fieldLand * sub.food[p.food][h], known = irrigKnown[i];
                const irr = p.cereal && sub.irrig[h] > 0 && t >= known
                    ? share * C.alluviumShare * canalK[i][h] * Math.min(1, Math.max(0.05, (t - known) / C.irrigationRampYears)) : 0;
                // (flooded fields on a river's or a marsh's water live by its flood)
                if (p.food === 'flooded' && sub.irrigSrc[h] >= 0) kIi[i] = rain * s;
                else { kRi[i] = (rain * (1 - share) + (irr ? 0 : rain * share)) * s; kIi[i] = irr * s; }
            }
            // (its cultivation takes over its wild form's stands, as far as it pays better: from them to the crop's own
            // capacity as it is domesticated)
            // (stands that feed several crops' wild forms — wild seeds: the winter and summer grasses, wild rice — are shared
            // by how well each grows here)
            const wf = FROM[i], Wi = p.wild(h);
            let Wsum = 0;
            for (const q of SAME_FROM[i]) Wsum += DOM[q].wild(h);
            const part = Wsum > 0 ? Wi / Wsum : 0, Kw0 = wildK0[wf] * part, full = kRi[i] + kIi[i], k = cultivated(Dm[i][c], Kw0, full, p.herd, C);
            if (!(k > 0) || !(full > 0)) { kRi[i] = 0; kIi[i] = 0; continue; }
            kRi[i] *= k / full; kIi[i] *= k / full;
            Kx[j] = k; Kx[wf] = Math.max(0, Kx[wf] - Kw0); ax[j] = domRank[i] * s;
        }
        // or they follow their herds over the whole range (once they live on their milk), growing little and the
        // wild thinned by the grazing — where that feeds more, where the rain is too fickle or the land too cold to farm
        // (pastoralism in the dry and cold margins; Khazanov 1984)
        let Ksum = 0;
        for (let j = 0; j < M; j++) Ksum += Kx[j];
        let mobile = false;
        if (HERD >= 0 && roam[h] && Dm[HERD][c] >= 2 && Kx[NW + HERD] > 0) {
            let alt = Kx[NW + HERD] / herdLand[h], open = sub.open[h];
            for (let j = 0; j < NW; j++) alt += Kx[j] > 0 ? wildFood[j][h] * scale * (1 - open) : 0;
            for (let i = 0; i < DOM.length; i++) if (i !== HERD) alt += Kx[NW + i] * C.mobileCrops;
            if (alt > Ksum) {
                mobile = true; Ksum = alt;
                for (let j = 0; j < NW; j++) if (Kx[j] > 0) Kx[j] = wildFood[j][h] * scale * (1 - open);
                for (let i = 0; i < DOM.length; i++) { const f = i === HERD ? 1 / herdLand[h] : C.mobileCrops; Kx[NW + i] *= f; kRi[i] *= f; kIi[i] *= f; }
            }
        }
        const hl = health(c, settled(life[c]), life[c] === Life.IRRIGATOR);
        const K = Ksum * hl;
        if (d[c] === 0) d[c] = C.seedShare * K;
        const N = Math.max(1e-12, d[c] / Math.max(1e-9, hl));
        allocate(Kx, ax, N, xx, M, ordX);
        // the diet, by class; the land its fields and herds take
        let wild = 0, cult = 0, crops = 0, herds = 0, canal = 0, best = -1, bx = 0, fields = 0, pasture = 0, fieldK = 0, kR = 0, kI = 0, kH = 0, Kw = 0;
        for (let j = 0; j < NW; j++) { wild += xx[j]; Kw += Kx[j]; }
        for (let i = 0; i < DOM.length; i++) {
            const x = xx[NW + i], k = Kx[NW + i];
            if (!(k > 0)) continue;
            const dom = Dm[i][c] >= 1;
            if (DOM[i].herd) { if (dom) { herds += x; kH += k; } else { wild += x; Kw += k; } pasture += (x / k) * sub.open[h] * (dom && !mobile ? herdLand[h] : 1); }
            else {
                if (dom) crops += x; else cult += x;
                fieldK += k; kR += kRi[i]; kI += kIi[i];
                fields += (x / k) * (kIi[i] > 0 ? C.alluviumShare * share + C.fieldLand * (1 - share) : C.fieldLand);
                canal += x * kIi[i] / k;
            }
            if (x > bx) { bx = x; best = i; }
        }
        taken[c] = mobile ? 0 : Math.min(0.95, fields + pasture);
        fieldLandOf[c] = Math.min(1, fields); pastureOf[c] = Math.min(1, pasture);
        const packed = !mobile && d[c] >= C.packingKm2 && (aquaticHome(c) || bestWild[c] >= C.sedentaryWild);
        life[c] = lifeOfDiet({ wild, cultivated: cult, crops, herds }, canal > 0.5 * crops, packed);
        domShare[c] = (cult + crops + herds) / N;
        domTop[c] = best;
        cropK[c] = fieldK;
        // the people: toward what the land feeds, faster the more of their food is stored and sown
        const r = C.rForager + (C.rFarmer - C.rForager) * domShare[c];
        d[c] = K > 0 ? Math.max(0, d[c] + r * d[c] * (1 - d[c] / K) * C.stepYears) : d[c] * 0.5;
        // what they learn: each domesticate's skill by use, held only as far as the people within reach can hold it; its
        // domestication by use of its cultivated form
        let near = d[c], k = 1;
        for (let e = adjOffset[c]; e < adjOffset[c + 1]; e++) { const b = adjList[e]; if (home[b] >= 0) { near += d[b]; k++; } }
        const cap = skillCap(near / k * contactKm2, C);
        for (let i = 0; i < DOM.length; i++) {
            if (!has(i, c)) continue;
            const wi = xx[NW + i] / N;
            Sk[i][c] = Math.min(cap, learn(Sk[i][c], wi, C));
            const D0 = Dm[i][c];
            Dm[i][c] = domesticate(D0, wi, DOM[i].herd, C);
            if (D0 < 1 && Dm[i][c] >= 1 && farmArrival[i][c] > t) domesticated.push([i, c]);
        }
        // someone starts to cultivate a wild stand (or to keep wild herds): a rare event, likeliest at the best stands among
        // the settled, where they are already gathered (or hunted) hard — where the margin has fallen to them (the broad
        // spectrum, Flannery 1969; cultivation where it pays, Winterhalder & Kennett 2006; the prey pathway, Zeder 2012)
        if (packed) {
            settledYears[c] += C.stepYears;
            const pw = onsetPower(c);
            // (one chance a step, as the switches': at the best wild stand of a domesticate it has not got, by how good it is
            // and how hard it is used — its share of the diet against useShare)
            let i = -1, W = 0, U = 0;
            for (let q = 0; q < DOM.length; q++) {
                if (has(q, c)) continue;
                const w = DOM[q].wild(h), u = w * Math.min(1, xx[FROM[q]] / N / C.useShare);
                if (u > U) { U = u; W = w; i = q; }
            }
            if (i >= 0 && W >= C.wildMin && chance(c, step) < 1 - Math.exp(-C.onsetPerKm2Yr * cellKm2 * Math.pow(U, pw) * C.stepYears)) {
                cultArrival[i][c] = t; cultFrom[i][c] = c; Sk[i][c] = Math.max(Sk[i][c], C.skillSeed);
                startT[c] = Math.min(startT[c], t); started[c] = 1; onsets.push([i, c]);
            }
        }
        // farmers: from when a cell first farms; on a coast, they launch voyages with the crops they grow
        const f = farms(life[c]);
        farmPkg[c] = f ? best : -1;
        if (f && farmT[c] === Infinity) {
            farmT[c] = t;
            if (home[c] === c && sub.coastal[c] === 1) {
                for (let i = 0; i < DOM.length; i++) if (Dm[i][c] >= 1 && xx[NW + i] > 0) coastT[i] = Math.min(coastT[i], t);
                firstCoast = Math.min(firstCoast, t); launch.push(c);
            }
        }
        // good and bad years, for the settled and the herders: their fields, rain-fed and watered, their herds and the wild
        if (V && (settled(life[c]) || life[c] === Life.HERDER) && d[c] > 0) liveYears(c, t, step, f || life[c] === Life.HERDER ? C.storeYears : C.storeYearsForagers, kR, kI, kH, Kw);
    };
    /** After a generation of the economy: the new centres (a lineage's first domestication, at the cell where it began), the
     *  fronts of new cultivation. */
    const econAfter = bp => {
        for (const [i, c] of domesticated) {
            let a = c, k = 0;
            while (cultFrom[i][a] >= 0 && cultFrom[i][a] !== a && k++ < n) a = cultFrom[i][a];
            if (domRoot[i].has(a)) continue;
            domRoot[i].add(a);
            centres.push({ cell: a, pkg: DOM[i].id, bp });
            if (DOM[i].cereal && irrigKnown[i] === Infinity) irrigKnown[i] = t + C.irrigationDelayYears;
        }
        for (let i = 0; i < DOM.length; i++) { const S = onsets.filter(x => x[0] === i).map(x => x[1]); if (S.length) spreadCult(i, S); }
        onsets = []; domesticated = [];
    };

    /** One generation (C.stepYears) of the run. */
    const live = () => {
        const bp = bpOf(t), seaKm = schedule(C.seaLevelM, bp) / 1000, holo = bp <= C.holoceneBP;
        const g = rise(-C.glacialToBP[0], -C.glacialToBP[1], -bp);
        const forage = c => (iced(c, bp) ? 0 : KfG[c] + (Kf[c] - KfG[c]) * g);
        const economic = bp <= C.cultivationFromBP;
        let people = 0, farmersPeople = 0;
        if (economic) carry();
        for (const c of cells) {
            if (arrival[c] > t) continue;
            // the sea over the shelves: their people move to the coast that feeds them (and are its source, if it had none;
            // where it had people, the two mix — the economy's skills will be shared out here, by people)
            if (!dry(c, seaKm)) { if (d[c] > 0) { const h = home[c]; if (!(d[h] > 0)) cameFrom[h] = c; d[h] += d[c]; d[c] = 0; } life[c] = Life.EMPTY; continue; }
            if (economic) {
                economyOf(c, forage(c), bp);
                people += d[c] * cellKm2;
                if (farmPkg[c] >= 0) farmersPeople += d[c] * cellKm2;
                continue;
            }
            // (before the economy, foragers: what the land feeds, less what its diseases take)
            const K = forage(c) * health(c, false, false);
            if (d[c] === 0) d[c] = C.seedShare * K;
            d[c] = K > 0 ? Math.max(0, d[c] + C.rForager * d[c] * (1 - d[c] / K) * C.stepYears) : d[c] * 0.5;
            life[c] = Life.FORAGER;
            people += d[c] * cellKm2;
        }
        if (economic) econAfter(bp);
        if (t >= nextVoyage) { nextVoyage += C.frameYears; if (launch.length || voyage) sail(nextVoyage); }
        totals.push({ bp, people: Math.round(people), farmers: Math.round(farmersPeople), famineDead: Math.round(famineDead) });
        famineDead = 0;
        // towns and polities, every polityStepYears once there are farmers
        if (pol && farmersPeople > 0 && t >= nextPolity - 1e-9) {
            for (const c of cells) Kc[c] = farmPkg[c] >= 0 ? cropK[c] : 0;
            pol.step(d, life, Kc, anyFarmers ? C.polityStepYears : 0, famineShare);
            famineShare.fill(0);
            anyFarmers = true;
            nextPolity = t + C.polityStepYears;
        }
        if (t >= nextFrame - 1e-9) {
            const dens = new Uint8Array(n), way = new Uint8Array(n), crop = new Int8Array(n).fill(-1);
            for (const c of cells) {
                dens[c] = densityByte(d[c]); way[c] = d[c] > 0 ? (life[c] || Life.FORAGER) : 0;
                if (d[c] > 0) crop[c] = cropOf(c);
            }
            // (the land in use: a byte a cell, fields' share in the low four bits and pasture's in the high — each 0 for none,
            // else 1–15 on a log scale, 15 the whole cell, 10 a tenth, 5 a hundredth)
            const land = new Uint8Array(n), q = v => (v < 1e-4 ? 0 : Math.max(1, Math.min(15, Math.round(15 + 5 * Math.log10(v)))));
            for (const c of cells) if (d[c] > 0) land[c] = q(fieldLandOf[c]) | (q(pastureOf[c]) << 4);
            const frame = { bp, density: dens, life: way, crop, land, farmPkg: Int8Array.from(farmPkg), people: Math.round(people), farmers: Math.round(farmersPeople), seaM: Math.round(seaKm * 1000),
                towns: pol && anyFarmers ? pol.packed() : null, polityTable: pol && anyFarmers ? pol.packedPolities() : null, polities: pol && anyFarmers ? pol.counts() : null };
            frames.push(frame);
            if (onFrame) onFrame(frame);
            nextFrame += frameYears;
        }
    };
    const advance = (toBP, every = frameYears) => {
        if (every !== frameYears) { nextFrame = Math.min(nextFrame, t); frameYears = every; }   // (the next generation lived is the first at the new pace)
        for (const end = tOf(toBP); t <= end + 1e-9; t += C.stepYears, step++) live();
    };
    const result = () => {
        const arrivalBP = new Float32Array(n).fill(NaN), farmBP = new Float32Array(n).fill(NaN), onsetBP = new Float32Array(n).fill(NaN);
        // (sources across water: fronts cross lakes and the sea, where no one lives — back to the last place people do)
        const peopled = from => {
            const out = new Int32Array(n).fill(-1);
            for (const c of cells) { let a = from[c], k = 0; while (a >= 0 && home[a] < 0 && from[a] !== a && k++ < n) a = from[a]; out[c] = a; }
            return out;
        };
        for (const c of cells) { if (arrival[c] < Infinity) arrivalBP[c] = bpOf(arrival[c]); if (farmT[c] < Infinity) farmBP[c] = bpOf(farmT[c]); if (startT[c] < Infinity) onsetBP[c] = bpOf(startT[c]); }
        return { frames, centres: clusterCentres(mesh, centres, C.centreKm), totals, arrivalBP, farmBP, onsetBP, centreCells: centres, farmPkg, origins, polities: pol, famine: famine ? famineCentury : null, parasites: range, vary: V,
            voyagingBP: coastT.map(x => (x < Infinity ? bpOf(x) : null)),
            // (per crop: when its farmers first farmed a coast — from then voyagers carry it)
            coastBP: Object.fromEntries(DOM.map((p, i) => [p.food, coastT[i] < Infinity ? bpOf(coastT[i]) : null])),
            cameFrom: peopled(cameFrom), farmFrom: Object.fromEntries(DOM.map((p, i) => [p.food, peopled(farmFrom[i])])), packages: DOM.map(p => p.id) };
    };
    return { advance, result, get bp() { return bpOf(t - C.stepYears); }, get frames() { return frames; } };
}

/** Domestication cells, gathered into centres: the same package, within `km` of one another — each with its first date and its middle. */
function clusterCentres(mesh, list, km) {
    const xyz = mesh.xyz, cosR = Math.cos(km / 6371), seen = new Uint8Array(list.length), out = [];
    const near = (a, b) => xyz[3 * a] * xyz[3 * b] + xyz[3 * a + 1] * xyz[3 * b + 1] + xyz[3 * a + 2] * xyz[3 * b + 2] >= cosR;
    for (let s = 0; s < list.length; s++) {
        if (seen[s]) continue;
        const group = [list[s]]; seen[s] = 1;
        for (let i = 0; i < group.length; i++) for (let j = 0; j < list.length; j++)
            if (!seen[j] && list[j].pkg === list[s].pkg && near(group[i].cell, list[j].cell)) { seen[j] = 1; group.push(list[j]); }
        let X = 0, Y = 0, Z = 0, bp = -Infinity;
        for (const g of group) { X += xyz[3 * g.cell]; Y += xyz[3 * g.cell + 1]; Z += xyz[3 * g.cell + 2]; bp = Math.max(bp, g.bp); }
        const l = Math.hypot(X, Y, Z);
        out.push({ pkg: list[s].pkg, bp, cells: group.length, lat: +(Math.asin(Z / l) * DEG).toFixed(1), lon: +(Math.atan2(Y, X) * DEG).toFixed(1) });
    }
    return out.sort((a, b) => b.bp - a.bp);
}
