// The civ layer's people, on a human clock (plans/CIV_PLAN.md §5, Phases 1–3): a finished moment's geography, held fixed,
// lived on from `originBP` for as long as asked. Each cell carries a density (persons/km²) that grows logistically toward
// what its way of life lets the land feed; what changes is the way of life:
//
//   Phase 1  foragers spread from the origin as a front (the glacial climate's capacity, the ice sheets shut until they melt) (travel.js: ~1 km/yr inland, several along coasts and rivers,
//            across water as far as the era's boats reach), each cell filling once reached; the glacial world's lower sea
//            exposes the shelves and land bridges, and drowns them again as it rises (people move inland)
//   Phase 2  after the Holocene switch, foragers packed past Binford's threshold beside dense, storable food (wetlands,
//            coasts, lake shores, rich wild stands) settle; where cultivating their wild stands pays better than foraging
//            (Winterhalder & Kennett 2006) they cultivate, and over ~2000 years (Purugganan & Fuller 2009) domesticate:
//            a domestication centre, with its package (substrate.js PACKAGES)
//   Phase 3  farming spreads from each centre as a front (~1 km/yr, leapfrogging along coasts and rivers), only into
//            country its package grows in (Köppen envelopes: the axes come out by themselves); farmers grow faster and to
//            more; on a dry alluvium they learn irrigation, and its far greater yields
//   disease  vector fever and snail fever cost a share of the people where the months, the standing water and the
//            parasites' way there allow (disease.js)
//   famine   the settled live year by year on their harvests (climate-var.js: the planet's own good and bad years, the
//            rivers' floods with their catchments' rain), keep a store, and die when it runs out (Halstead & O'Shea
//            1989); foragers move instead
//
// Deterministic: the same world and options give the same history. Frames (density and way of life per cell) every
// `frameYears`, for the timeline.

import { CIV } from './civ-config.js';
import { PACKAGES } from './substrate.js';
import { edgeLengths, frontArrival, offshoreKm, schedule, toblerFactor } from './travel.js';
import { spreadKm } from '../core/min-heap.js';
import { KOPPEN_CLASSES } from '../climate/koppen.js';
import { Polities } from './polity.js';
import { climateVariability, modeSeries, modeLn, normal } from './climate-var.js';
import { parasiteRange, diseaseLoss } from './disease.js';

const rise = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DEG = 180 / Math.PI;

/** A cell's way of life, as frames keep it. */
export const Life = Object.freeze({ EMPTY: 0, FORAGER: 1, SEDENTARY: 2, CULTIVATING: 3, FARMER: 4, IRRIGATOR: 5 });
export const LIFE_NAMES = ['empty', 'foragers', 'settled foragers', 'cultivators', 'farmers', 'irrigation farmers'];

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
 * @returns { frames, centres, totals, arrivalBP (Float32, per cell; NaN never), farmBP (per cell) }
 */
export function runCivSim(w, sub, { origins = null, endBP = 0, onFrame = null, polities = true, famine = true, vary = null, disease = true, C = CIV } = {}) {
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
    const crossingAt = t => schedule(C.crossingKm, bpOf(t)), seaSpeed = t => schedule(C.frontSeaKmYr, bpOf(t));
    // the earliest time ≥ t a front may put out over water cell b (crossings only lengthen): a front waits at the shore
    const seaOpens = (b, t) => {
        const need = 2 * offshore[b];
        if (crossingAt(t) >= need) return t;
        const K = C.crossingKm;
        for (let i = 1; i < K.length; i++) if (K[i][1] >= need) {
            const [b0, k0] = K[i - 1], [b1, k1] = K[i];
            return Math.max(t, tOf(b0 + (b1 - b0) * (need - k0) / (k1 - k0)));
        }
        return Infinity;
    };
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
        let best = -1, bk = -1, any = -1, ak = -1;
        for (const c of cells) {
            if (part[c] !== main) continue;
            if (isSavanna(c) && Kf[c] > bk) { bk = Kf[c]; best = c; }
            if (Kf[c] > ak) { ak = Kf[c]; any = c; }
        }
        origins = [best >= 0 ? best : any];
    }
    const arrival = new Float64Array(n).fill(Infinity);
    for (const c of origins) arrival[c] = 0;
    // (barriers that lift: the ice sheets as they melt, the cold country once people are equipped for it — the front waits)
    const coldBy = c => C.coldET - (sub.et[home[c]] + C.glacialDT * 0.6);       // (ET falls ~0.6 °C per °C of cooling)
    const lastCold = C.coldOpensBP[C.coldOpensBP.length - 1];
    const coldOpens = x => (x >= lastCold[0] ? lastCold[1] : schedule(C.coldOpensBP.map(([k, bp]) => [-k, bp]), -x));
    const opensAt = (b, t) => {
        if (isWater(b)) return seaOpens(b, t);
        let o = t;
        if (ice && ice[b]) o = Math.max(o, tOf(C.iceUntilBP));
        if (coldBy(b) > 0) o = Math.max(o, tOf(coldOpens(coldBy(b))));
        return o;
    };
    frontArrival(mesh, len, arrival, foragerSpeed, null, Infinity, opensAt);

    // ── disease: where the parasites reached with people (the cold filter), and what each way of life loses ──
    const range = disease ? parasiteRange(w, origins,
        (a, b) => (home[b] >= 0 && dry(b, minSeaKm)) || (isWater(b) && 2 * offshore[b] <= schedule(C.crossingKm, C.holoceneBP)), C, c => (isWater(c) ? -1 : home[c])) : null;
    const health = (c, settled, irrigating) => (range ? 1 - diseaseLoss(w, home[c], range, sub.wetland[home[c]] > 0 || irrigating ? 1 : 0, irrigating, settled, C) : 1);

    // ── Phase 2–3 state ──
    const bestPkg = new Int8Array(n).fill(-1), bestWild = new Float32Array(n);
    for (const c of cells) PACKAGES.forEach((p, i) => { const v = sub.wild[p.id][c]; if (v > bestWild[c]) { bestWild[c] = v; bestPkg[c] = i; } });
    const fit = PACKAGES.map(() => new Float32Array(n));                        // (its climate weight, for the front's speed)
    const grows = PACKAGES.map((p, i) => {
        const ok = new Uint8Array(n);
        for (const c of cells) {
            const h = home[c], code = KOPPEN_CLASSES[koppen[h]]?.code ?? '';
            // where its climate grows it, or (cereals) watered on an alluvium in a dry one — Egypt's, Sumer's winter wheat
            ok[c] = ((p.koppen[code] ?? 0) > 0 && (sub.farmDry[h] > 0 || sub.irrig[h] > 0)) || (p.cereal && sub.irrig[h] >= 0.1) ? 1 : 0;
            fit[i][c] = sub.irrig[h] >= 0.1 ? 1 : (p.koppen[code] ?? 0);
        }
        return ok;
    });
    const farmArrival = PACKAGES.map(() => new Float64Array(n).fill(Infinity));
    // each package's farmers know irrigation from this long after its first centre; a desert's alluvium waits for it
    const irrigKnown = PACKAGES.map(() => Infinity);
    const farmOpensAt = i => (b, t) => (isWater(b) ? seaOpens(b, t) : sub.farmDry[home[b]] > 0 ? t : Math.max(t, irrigKnown[i]));
    const farmSpeed = i => (a, b, k, t) => {
        if (isWater(b)) return seaSpeed(t);
        if (!grows[i][b]) return 0;
        if (isWater(a)) return seaSpeed(t);
        let v = C.frontFarmKmYr * slope(a, b, k);
        if (coastG[a] && coastG[b]) v = Math.max(v, C.frontFarmCoastKmYr);
        if (riverQ[a] >= C.frontRiverM3s && riverQ[b] >= C.frontRiverM3s) v = Math.max(v, C.frontFarmRiverKmYr);
        return v * (C.farmClimateFloor + (1 - C.farmClimateFloor) * fit[i][b]);
    };
    // ── voyaging: each package's farmers, from when they first farm a coast, cross ever further (C.voyageKm) — and land
    // only on shores no one holds, where people then spread as on any other (foragers' front, and the package's own) ──
    const ladderAt = (L, x) => schedule(L.map(([a, b]) => [-a, b]), -x);         // (a ladder [[x, y], …], x ascending)
    const ladderReaches = (L, y) => {
        if (L[0][1] >= y) return L[0][0];
        for (let i = 1; i < L.length; i++) if (L[i][1] >= y) { const [x0, y0] = L[i - 1], [x1, y1] = L[i]; return x0 + (x1 - x0) * (y - y0) / (y1 - y0); }
        return Infinity;
    };
    const coastT = PACKAGES.map(() => Infinity), voyage = PACKAGES.map(() => null), launch = PACKAGES.map(() => []);
    const atSea = c => isWater(c) || ocean[c];
    const voyageSpeed = i => (a, b, k, t) => {
        if (atSea(b)) return ladderAt(C.voyageSeaKmYr, t - coastT[i]);
        // (ashore: only from the sea, onto land no one holds, that people can live on — open of ice and cold)
        return atSea(a) && arrival[b] > t && Kf[b] >= C.habitableKm2[0] && opensAt(b, t) <= t ? ladderAt(C.voyageSeaKmYr, t - coastT[i]) : 0;
    };
    const voyageOpens = i => (b, t) => (isWater(b) ? Math.max(t, coastT[i] + ladderReaches(C.voyageKm, 2 * offshore[b])) : t);
    const sail = i => {
        const v = voyage[i] ??= new Float64Array(n).fill(Infinity), from = launch[i];
        for (const c of from) v[c] = Math.min(v[c], farmT[c]);
        launch[i] = [];
        frontArrival(mesh, len, v, voyageSpeed(i), from, Infinity, voyageOpens(i));
        const landed = [], farmed = [];
        for (const c of cells) if (!atSea(c) && v[c] < arrival[c]) {
            arrival[c] = v[c]; landed.push(c);
            if (grows[i][c] && v[c] < farmArrival[i][c]) { farmArrival[i][c] = v[c]; farmed.push(c); }
        }
        if (landed.length) frontArrival(mesh, len, arrival, foragerSpeed, landed, Infinity, opensAt);
        if (farmed.length) frontArrival(mesh, len, farmArrival[i], farmSpeed(i), farmed, Infinity, farmOpensAt(i));
    };

    const d = new Float32Array(n), life = new Uint8Array(n), progress = new Float32Array(n), farmPkg = new Int8Array(n).fill(-1);
    const farmT = new Float64Array(n).fill(Infinity), centres = [], frames = [], totals = [], started = new Uint8Array(n);
    // a cell's chance in a step: a hash of the two, uniform in [0, 1) — the same each run
    const chance = (c, step) => { let h = Math.imul(c ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(step + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
    const aquaticHome = c => sub.wetland[home[c]] > 0 || sub.coastal[home[c]] || sub.lakeside[home[c]];
    /** What farming feeds here, persons/km² of country: fields on a share of it, irrigated on the alluvium once learnt. */
    let kRain = 0, kIrr = 0;                    // (farmK's two parts: rain-fed, and watered by the river)
    const farmK = (c, t) => {
        const h = home[c], rain = C.cultivatedShare * sub.farmDry[h];
        const known = irrigKnown[farmPkg[c]], irr = sub.irrig[h] > 0 && t >= known
            ? sub.irrigShare[h] * C.alluviumShare * sub.farmWet[h] * Math.min(1, Math.max(0.05, (t - known) / C.irrigationRampYears)) : 0;
        kRain = rain * (1 - sub.irrigShare[h]) + (irr ? 0 : rain * sub.irrigShare[h]); kIrr = irr;
        return kRain + kIrr;
    };

    // ── good and bad years: the settled live year by year on their harvests and their store ──
    const V = famine ? (vary ?? climateVariability(w, sub, C)) : null;
    const modes = V ? modeSeries(Math.ceil(tOf(endBP)) + C.stepYears + 1, C) : null;
    const store = new Float32Array(n), famineShare = new Float32Array(n);
    const famineCentury = new Float32Array(n);   // (each cell's famine deaths, summed over the run: a diagnostic)
    const regionNoise = V ? new Float32Array(V.regions * C.stepYears) : null, regionStamp = V ? new Int32Array(V.regions).fill(-1) : null;
    const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    const nppP = p => C.nppMax * (1 - Math.exp(-0.000664 * p));
    const riverNoise = new Map();               // (a river's storms, per year of this step: shared by everyone it waters)
    let riverNoiseStep = -1, famineDead = 0;
    const meanF = new Float32Array(3 * n).fill(NaN), MEAN_DRAWS = 64;
    /** One step's years for a settled cell: each year's harvest against a normal one — rain-fed fields by the substrate's
     *  own yield ramp, the river's by its flood (the land watered follows it; a flood far above the usual breaks the
     *  banks and the works), the wild by the forager regression's own response to the year's NPP (water foods steady) —
     *  its store, its famines. */
    const liveYears = (c, t, step, farming, wildK) => {
        const h = home[c], y0 = Math.round(t), cap = farming ? C.storeYears : C.storeYearsForagers;
        if (!farming || farmK(c, t) < wildK) { kRain = 0; kIrr = 0; }
        const kR = kRain, kI = kIrr, Kw = kR + kI > 0 ? 0 : wildK;
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
        const tl = Kw > 0 ? C.nppMax / (1 + Math.exp(1.315 - 0.119 * w.tAnnual[h])) : 0, n0 = Kw > 0 ? Math.min(tl, nppP(P)) : 0;
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
        const mR = meanF[3 * c], mI = meanF[3 * c + 1], mW = steady + (1 - steady) * meanF[3 * c + 2];
        let dd = d[c], st = store[c], dead = 0;
        for (let j = 0; j < C.stepYears; j++) {
            const y = y0 + j, aH = modes[2 * y], aL = modes[2 * y + 1];
            const lnx = modeLn(V.rainLn, h, aH, aL) + cv * regionNoise[r * C.stepYears + j];
            let food = 0;
            if (kR > 0) food += kR * (lnx >= lnFull ? 1 : smooth(C.rainfedMinMm, C.rainfedFullMm, P * Math.exp(lnx)) / ramp0) / mR;
            if (src >= 0) {
                const q = Math.exp(modeLn(V.riverLn, src, aH, aL) + rn[j]);
                food += kI * (q < 1 ? q : q > C.floodHigh ? Math.max(0, 1 - C.floodDamage * (q - C.floodHigh)) : 1) / mI;
            } else food += kI;
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

    const end = tOf(endBP);
    let nextFrame = 0, nextPolity = 0, nextVoyage = 0, anyFarmers = false;
    const pol = polities ? new Polities(w, sub, C) : null, Kc = pol ? new Float32Array(n) : null;
    for (let t = 0, step = 0; t <= end + 1e-9; t += C.stepYears, step++) {
        const bp = bpOf(t), seaKm = schedule(C.seaLevelM, bp) / 1000, holo = bp <= C.holoceneBP;
        const g = rise(-C.glacialToBP[0], -C.glacialToBP[1], -bp);
        const forage = c => (iced(c, bp) ? 0 : KfG[c] + (Kf[c] - KfG[c]) * g);
        const newCentres = [];
        let people = 0, farmersPeople = 0;
        for (const c of cells) {
            if (arrival[c] > t) continue;
            // the sea over the shelves: their people move to the coast that feeds them
            if (!dry(c, seaKm)) { if (d[c] > 0) { d[home[c]] += d[c]; d[c] = 0; } life[c] = Life.EMPTY; continue; }
            const farming = farmPkg[c] >= 0;
            // (what the land feeds, less what its diseases take: by the way of life the cell had)
            const K = (farming ? Math.max(farmK(c, t), forage(c)) : forage(c)) * health(c, life[c] >= Life.SEDENTARY, life[c] === Life.IRRIGATOR);
            if (d[c] === 0) d[c] = C.seedShare * K;
            const r = farming ? C.rFarmer : C.rForager;
            d[c] = K > 0 ? Math.max(0, d[c] + r * d[c] * (1 - d[c] / K) * C.stepYears) : d[c] * 0.5;
            // ways of life
            if (farming) life[c] = sub.irrig[home[c]] > 0 && t >= irrigKnown[farmPkg[c]] ? Life.IRRIGATOR : Life.FARMER;
            else {
                const sedentary = bp <= C.cultivationFromBP && d[c] >= C.packingKm2 && (aquaticHome(c) || bestWild[c] >= C.sedentaryWild);
                life[c] = sedentary ? Life.SEDENTARY : Life.FORAGER;
                // someone starts cultivating: a rare event, likeliest at the best stands
                if (sedentary && !started[c] && bestWild[c] >= C.wildMin
                    && chance(c, step) < 1 - Math.exp(-C.onsetPerKm2Yr * cellKm2 * Math.pow(bestWild[c], C.onsetPower) * Math.min(4, Math.pow(d[c] / C.packingKm2, C.onsetCrowding)) / 2 * C.stepYears)) started[c] = 1;
                if (sedentary && started[c]) {
                    // cultivate when it pays better: foraging's returns falling as the land fills, cultivation's rising as
                    // the plants are domesticated
                    const W = bestWild[c], rf = 1 - C.forageDecline * Math.min(1, d[c] / Math.max(1e-9, forage(c)));
                    const rc = (C.cultivatedShare * sub.farmDry[home[c]] / Math.max(1e-9, forage(c))) * W * (C.cultivatedYield + (1 - C.cultivatedYield) * progress[c]);
                    if (rc > rf) {
                        life[c] = Life.CULTIVATING;
                        progress[c] += C.stepYears / C.domesticationYears;
                        if (progress[c] >= 1) {
                            const i = bestPkg[c];
                            if (farmArrival[i][c] > t) { farmArrival[i][c] = t; newCentres.push([i, c]); centres.push({ cell: c, pkg: PACKAGES[i].id, bp }); }
                        }
                    }
                }
            }
            if (V && life[c] >= Life.SEDENTARY && d[c] > 0) liveYears(c, t, step, farming, forage(c));
            people += d[c] * cellKm2;
            if (farming) farmersPeople += d[c] * cellKm2;
        }
        // new centres: their packages' fronts (each package's arrival only improves)
        for (const i of new Set(newCentres.map(x => x[0]))) {
            if (irrigKnown[i] === Infinity) irrigKnown[i] = t + C.irrigationDelayYears;
            frontArrival(mesh, len, farmArrival[i], farmSpeed(i), newCentres.filter(x => x[0] === i).map(x => x[1]), Infinity, farmOpensAt(i));
        }
        // farmers arriving: the earliest package wins the cell
        for (const c of cells) {
            if (farmPkg[c] >= 0 || arrival[c] > t) continue;
            let bi = -1, bt = Infinity;
            for (let i = 0; i < PACKAGES.length; i++) if (farmArrival[i][c] <= t && farmArrival[i][c] < bt) { bt = farmArrival[i][c]; bi = i; }
            if (bi >= 0) {
                farmPkg[c] = bi; farmT[c] = Math.max(bt, arrival[c]);
                if (home[c] === c && sub.coastal[c] === 1) { coastT[bi] = Math.min(coastT[bi], farmT[c]); launch[bi].push(c); }
            }
        }
        if (t >= nextVoyage) { nextVoyage += C.frameYears; for (let i = 0; i < PACKAGES.length; i++) if (launch[i].length) sail(i); }
        totals.push({ bp, people: Math.round(people), farmers: Math.round(farmersPeople), famineDead: Math.round(famineDead) });
        famineDead = 0;
        // towns and polities, every polityStepYears once there are farmers
        if (pol && farmersPeople > 0 && t >= nextPolity - 1e-9) {
            for (const c of cells) Kc[c] = farmPkg[c] >= 0 ? farmK(c, t) : 0;
            pol.step(d, life, Kc, anyFarmers ? C.polityStepYears : 0, famineShare);
            famineShare.fill(0);
            anyFarmers = true;
            nextPolity = t + C.polityStepYears;
        }
        if (t >= nextFrame - 1e-9) {
            const dens = new Uint8Array(n), way = new Uint8Array(n);
            for (const c of cells) { dens[c] = densityByte(d[c]); way[c] = d[c] > 0 ? (life[c] || Life.FORAGER) : 0; }
            const frame = { bp, density: dens, life: way, farmPkg: Int8Array.from(farmPkg), people: Math.round(people), farmers: Math.round(farmersPeople), seaM: Math.round(seaKm * 1000),
                towns: pol && anyFarmers ? pol.packed() : null, polityTable: pol && anyFarmers ? pol.packedPolities() : null, polities: pol && anyFarmers ? pol.counts() : null };
            frames.push(frame);
            if (onFrame) onFrame(frame);
            nextFrame += C.frameYears;
        }
    }
    const arrivalBP = new Float32Array(n).fill(NaN), farmBP = new Float32Array(n).fill(NaN);
    for (const c of cells) { if (arrival[c] < Infinity) arrivalBP[c] = bpOf(arrival[c]); if (farmT[c] < Infinity) farmBP[c] = bpOf(farmT[c]); }
    return { frames, centres: clusterCentres(mesh, centres, C.centreKm), totals, arrivalBP, farmBP, farmPkg, origins, polities: pol, famine: famine ? famineCentury : null, parasites: range, vary: V,
        voyagingBP: coastT.map(x => (x < Infinity ? bpOf(x) : null)) };
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
