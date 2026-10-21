// Cradles (plans/CIV_PLAN.md §6, check 1): the places on a finished moment where an Ur could arise, before anyone is
// simulated. A cradle is an irrigable alluvium — a big river across dry, gentle ground — and it ranks by what made
// southern Mesopotamia and Egypt:
//   capacity          the people its irrigated farmland feeds (irrigation ~10× rain-fed: Sumer's 1:20–30 seed returns)
//   circumscription   how hemmed in it is: the share of a ring around it that cannot be farmed (desert, mountain, sea) —
//                     Carneiro (1970); Allen (1997) for the Nile — so the losers of its wars cannot leave
//   wild cereals      a domestication zone within reach (the hilly flanks: 300–800 km from Sumer)
//   resources         copper, tin, obsidian, timber and stone within reach — the alluvium has none, so it must trade (Algaze)
//   river             a flood season and a far-fed river (the Nile's, the Tigris and Euphrates') help: predictable, taxable

import { CIV } from './civ-config.js';
import { PACKAGES } from './substrate.js';
import { Res, COPPER } from './resources.js';
import { spreadKm } from '../core/min-heap.js';
import { piecesOf } from '../core/mesh-bfs.js';
import { KOPPEN_CLASSES } from '../climate/koppen.js';
import { Regime } from '../finish/finish-hydro.js';

const DEG = 180 / Math.PI;

/** Distance (km) from every cell to the nearest cell where `isSource`, at most maxKm (Infinity beyond), through `canEnter`. */
function distanceTo(mesh, isSource, maxKm, canEnter = null) {
    const d = new Float64Array(mesh.numCells).fill(Infinity);
    for (let c = 0; c < mesh.numCells; c++) if (isSource(c)) d[c] = 0;
    spreadKm(mesh, d, { maxKm, canEnter: canEnter && ((a, b) => canEnter(b)) });
    return d;
}

export const RESOURCE_NEEDS = [
    { id: 'copper', bits: COPPER }, { id: 'tin', bits: Res.TIN }, { id: 'obsidian', bits: Res.OBSIDIAN },
    { id: 'timber', bits: Res.TIMBER }, { id: 'stone', bits: Res.STONE },
];

/**
 * The ranked cradles. `w`: { mesh, z, ocean, lake, koppen }; `sub`: civSubstrate; `res`: civResources.
 * Returns [{ rank, score, lat, lon, km2, capacity, circumscription, cerealKm: {package: km}, resourceKm: {id: km}, river… }].
 */
export function findCradles(w, sub, res, C = CIV) {
    const { mesh, ocean, lake, koppen } = w, n = mesh.numCells, xyz = mesh.xyz;
    const land = c => !ocean[c] && !lake[c];
    const irrigable = [];
    for (let c = 0; c < n; c++) if (sub.irrig[c] >= 0.25) irrigable.push(c);
    const areaOf = cells => cells.reduce((s, c) => s + sub.irrigShare[c] * sub.cellKm2, 0);
    const regions = piecesOf(mesh, irrigable).filter(p => areaOf(p) >= C.cradleMinKm2);
    if (!regions.length) return [];

    // the reaches every region is measured against, computed once for the planet
    const cerealD = Object.fromEntries(PACKAGES.map(p => [p.id, distanceTo(mesh, c => sub.wild[p.id][c] >= C.cerealCore, C.cerealReachKm, land)]));
    const resD = Object.fromEntries(RESOURCE_NEEDS.map(r => [r.id, distanceTo(mesh, c => (res[c] & r.bits) !== 0, C.resourceReachKm)]));
    const seaD = distanceTo(mesh, c => ocean[c] === 1, 2000);
    const farmable = c => land(c) && (sub.rainfed[c] >= 300 || sub.irrig[c] > 0);

    const out = [];
    const inRegion = new Int32Array(n).fill(-1);
    regions.forEach((p, i) => { for (const c of p) inRegion[c] = i; });
    regions.forEach((cells, i) => {
        let cap = 0, x = 0, y = 0, zz = 0, qMax = 0, flood = 0, far = 0, onRiver = 0;
        const kop = {};
        for (const c of cells) {
            cap += sub.farmers[c] * sub.irrigShare[c] * sub.cellKm2 * 0.5;    // half the alluvium in fields (fallow is in farmers)
            x += xyz[3 * c]; y += xyz[3 * c + 1]; zz += xyz[3 * c + 2];
            const code = KOPPEN_CLASSES[koppen[c]]?.code ?? '?'; kop[code] = (kop[code] ?? 0) + 1;
            const s = sub.irrigSrc[c];
            if (s >= 0) { onRiver++; if (sub.river.regime[s] === Regime.FLOOD) flood++; if (sub.river.farFed[s]) far++; if (sub.river.q[s] > qMax) qMax = sub.river.q[s]; }
        }
        // circumscription: the ring around it, how much of it cannot be farmed
        const ring = new Float64Array(n).fill(Infinity);
        for (const c of cells) ring[c] = 0;
        spreadKm(mesh, ring, { maxKm: C.cradleRingKm });
        let ringCells = 0, ringFarm = 0;
        for (let c = 0; c < n; c++) if (ring[c] > 0 && ring[c] < Infinity && inRegion[c] !== i) { ringCells++; if (farmable(c)) ringFarm++; }
        const circ = ringCells ? 1 - ringFarm / ringCells : 1;
        const minOver = D => { let m = Infinity; for (const c of cells) if (D[c] < m) m = D[c]; return m; };
        const cerealKm = Object.fromEntries(PACKAGES.map(p => [p.id, minOver(cerealD[p.id])]));
        const resourceKm = Object.fromEntries(RESOURCE_NEEDS.map(r => [r.id, minOver(resD[r.id])]));
        const bestCereal = Math.min(...Object.values(cerealKm));
        const cereal = bestCereal < Infinity ? Math.exp(-bestCereal / 500) : 0;
        const access = RESOURCE_NEEDS.reduce((s, r) => s + (resourceKm[r.id] < Infinity ? Math.exp(-resourceKm[r.id] / 1000) : 0), 0) / RESOURCE_NEEDS.length;
        const riverShare = onRiver ? (0.5 * flood + 0.5 * far) / onRiver : 0;
        const score = Math.log10(Math.max(10, cap)) * (0.3 + 0.7 * circ) * (0.15 + 0.85 * cereal) * (0.4 + 0.6 * access) * (0.8 + 0.4 * riverShare);
        const l = Math.hypot(x, y, zz);
        out.push({ score: +score.toFixed(3), lat: +(Math.asin(zz / l) * DEG).toFixed(1), lon: +(Math.atan2(y, x) * DEG).toFixed(1),
            km2: Math.round(areaOf(cells)), capacity: Math.round(cap), circumscription: +circ.toFixed(2),
            cerealKm: round(cerealKm), resourceKm: round(resourceKm), seaKm: Math.round(minOver(seaD)),
            river: { maxM3s: Math.round(qMax), floodShare: +(onRiver ? flood / onRiver : 0).toFixed(2), farFedShare: +(onRiver ? far / onRiver : 0).toFixed(2) },
            koppen: Object.fromEntries(Object.entries(kop).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => [k, +(v / cells.length).toFixed(2)])),
            cells });
    });
    out.sort((a, b) => b.score - a.score);
    out.forEach((r, i) => { r.rank = i + 1; });
    return out;
}

const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v < Infinity ? Math.round(v) : null]));
