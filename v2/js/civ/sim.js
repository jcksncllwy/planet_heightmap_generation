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
//
// Deterministic: the same world and options give the same history. Frames (density and way of life per cell) every
// `frameYears`, for the timeline.

import { CIV } from './civ-config.js';
import { PACKAGES } from './substrate.js';
import { edgeLengths, frontArrival, offshoreKm, schedule, toblerFactor } from './travel.js';
import { spreadKm } from '../core/min-heap.js';
import { KOPPEN_CLASSES } from '../climate/koppen.js';

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
 * @param opts { origins: [cell] (default: the richest savanna), endBP (default 0), onFrame(frame), C }
 * @returns { frames, centres, totals, arrivalBP (Float32, per cell; NaN never), farmBP (per cell) }
 */
export function runCivSim(w, sub, { origins = null, endBP = 0, onFrame = null, C = CIV } = {}) {
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
    const crossingAt = t => schedule(C.crossingKm, bpOf(t));
    const slope = (a, b, k) => toblerFactor((Math.max(0, z[b]) - Math.max(0, z[a])) / len[k]);
    const foragerSpeed = (a, b, k, t) => {
        if (isWater(b)) return offshore[b] <= crossingAt(t) / 2 ? C.frontSeaKmYr : 0;
        if (isWater(a)) return C.frontSeaKmYr;
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
        let best = -1, bk = -1;
        for (const c of cells) if (KOPPEN_CLASSES[koppen[c]]?.code === 'Aw' && Kf[c] > bk) { bk = Kf[c]; best = c; }
        origins = best >= 0 ? [best] : [cells[0]];
    }
    const arrival = new Float64Array(n).fill(Infinity);
    for (const c of origins) arrival[c] = 0;
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
    frontArrival(mesh, len, arrival, foragerSpeed, null, Infinity, opensAt);

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
    const farmOpensAt = i => (b, t) => (isWater(b) || sub.farmDry[home[b]] > 0 ? t : Math.max(t, irrigKnown[i]));
    const farmSpeed = i => (a, b, k) => {
        if (isWater(b)) return offshore[b] <= crossingAt(T0) / 2 ? C.frontSeaKmYr : 0;
        if (!grows[i][b]) return 0;
        if (isWater(a)) return C.frontSeaKmYr;
        let v = C.frontFarmKmYr * slope(a, b, k);
        if (coastG[a] && coastG[b]) v = Math.max(v, C.frontFarmCoastKmYr);
        if (riverQ[a] >= C.frontRiverM3s && riverQ[b] >= C.frontRiverM3s) v = Math.max(v, C.frontFarmRiverKmYr);
        return v * (C.farmClimateFloor + (1 - C.farmClimateFloor) * fit[i][b]);
    };
    const d = new Float32Array(n), life = new Uint8Array(n), progress = new Float32Array(n), farmPkg = new Int8Array(n).fill(-1);
    const farmT = new Float64Array(n).fill(Infinity), centres = [], frames = [], totals = [], started = new Uint8Array(n);
    // a cell's chance in a step: a hash of the two, uniform in [0, 1) — the same each run
    const chance = (c, step) => { let h = Math.imul(c ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(step + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
    const aquaticHome = c => sub.wetland[home[c]] > 0 || sub.coastal[home[c]] || sub.lakeside[home[c]];
    /** What farming feeds here, persons/km² of country: fields on a share of it, irrigated on the alluvium once learnt. */
    const farmK = (c, t) => {
        const h = home[c], rain = C.cultivatedShare * sub.farmDry[h];
        const known = irrigKnown[farmPkg[c]], irr = sub.irrig[h] > 0 && t >= known
            ? sub.irrigShare[h] * C.alluviumShare * sub.farmWet[h] * Math.min(1, Math.max(0.05, (t - known) / C.irrigationRampYears)) : 0;
        return rain * (1 - sub.irrigShare[h]) + irr + (irr ? 0 : rain * sub.irrigShare[h]);
    };

    const end = tOf(endBP);
    let nextFrame = 0;
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
            const K = farming ? Math.max(farmK(c, t), forage(c)) : forage(c);
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
            if (bi >= 0) { farmPkg[c] = bi; farmT[c] = Math.max(bt, arrival[c]); }
        }
        totals.push({ bp, people: Math.round(people), farmers: Math.round(farmersPeople) });
        if (t >= nextFrame - 1e-9) {
            const dens = new Uint8Array(n), way = new Uint8Array(n);
            for (const c of cells) { dens[c] = densityByte(d[c]); way[c] = d[c] > 0 ? (life[c] || Life.FORAGER) : 0; }
            const frame = { bp, density: dens, life: way, farmPkg: Int8Array.from(farmPkg), people: Math.round(people), farmers: Math.round(farmersPeople), seaM: Math.round(seaKm * 1000) };
            frames.push(frame);
            if (onFrame) onFrame(frame);
            nextFrame += C.frameYears;
        }
    }
    const arrivalBP = new Float32Array(n).fill(NaN), farmBP = new Float32Array(n).fill(NaN);
    for (const c of cells) { if (arrival[c] < Infinity) arrivalBP[c] = bpOf(arrival[c]); if (farmT[c] < Infinity) farmBP[c] = bpOf(farmT[c]); }
    return { frames, centres: clusterCentres(mesh, centres, C.centreKm), totals, arrivalBP, farmBP, origins };
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
