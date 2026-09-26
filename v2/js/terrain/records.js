// Step 1 of terrain synthesis: read a Frame into smooth per-sim-cell fields that heights are built from — distance
// to the coast, the depth of the sea floor, the trench, the platform a continent stands at, and for every mountain
// belt: what kind it is, where across it a cell lies, which way its ridges run, and how high its relief stands.
// All on the 40K-cell sim mesh (cheap); synthesize.js carries them onto the terrain mesh.

import { CrustType, CrustFlag, OrogenyType, VolcanicType, BeltSide } from '../tectonics/model/crust.js';
import { BoundaryKind } from '../tectonics/model/world.js';
import { Margin, seaDepthKm } from '../tectonics/measure.js';
import { spreadKm } from '../core/min-heap.js';
import { erosionAtLatitude } from './terrain-config.js';
import { FastNoise as SimplexNoise } from '../core/fast-noise.js';     // (bit-identical to V1's SimplexNoise, faster)

const R = 6371;

/** A belt KIND: its orogeny type and its side of a collision (the profile depends on both). 0 = no belt. */
export const kindOf = (type, side) => type * 3 + side;
export const kindType = kind => (kind / 3) | 0;
export const kindSide = kind => kind % 3;

/** Sea pockets smaller than `maxKm2` (connected non-land cells enclosed by land) become land, in place. */
function fillPockets(simMesh, land, maxKm2) {
    const { adjOffset, adjList, numCells: n } = simMesh, maxCells = maxKm2 / (4 * Math.PI * 6371 * 6371 / n);
    if (maxCells < 1) return;
    const seen = new Uint8Array(n), members = [];
    for (let s = 0; s < n; s++) {
        if (land[s] || seen[s]) continue;
        members.length = 0; members.push(s); seen[s] = 1;
        for (let i = 0; i < members.length; i++) {
            const c = members[i];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const nb = adjList[k]; if (!land[nb] && !seen[nb]) { seen[nb] = 1; members.push(nb); } }
        }
        if (members.length < maxCells) for (const c of members) land[c] = 1;
    }
}

/** Kinds of coast, for shelf / plain / slope widths (terrain-config.js `margins`). */
export const CoastKind = Object.freeze({ PASSIVE: 0, ACTIVE: 1, TRANSFORM: 2, COLLISION: 3, ARC: 4 });
const COAST_KEYS = ['passive', 'active', 'transform', 'collision', 'arc'];

/**
 * @returns {Object} per-sim-cell fields (typed arrays of length numCells unless noted):
 *   land (1 = non-ocean crust) · arc (1 = island-arc crust) · coastKm (signed distance to the edge of the continental crust, + inland) ·
 *   shelfKm / plainKm / slopeKm (from the nearest coast's kind) · depthKm (sea floor, ocean cells) · ageMyr and
 *   fabricKm (abyssal-hill wavelength) for ocean cells · trenchKm / trenchDepthKm (distance to, and depth of, the
 *   live trench nearby) · riseKm (distance to it on the subducting plate) · platformKm (what a land cell stands at
 *   before relief) · armKm (distance from a failed rift arm) · erosion (how many times faster than the reference things
 *   erode here, by the latitude's estimated rainfall) · belts: [current, overprinted] (beltLayer below; the
 *   current layer's fields are also on the record itself: kind / dKm / reach / reliefKm / shear / across) · across (3 per cell: unit vector
 *   across the belt's strike, toward its far edge; zero if unknown).
 */
export function deriveRecords(frame, simMesh, cfg, seed = 0) {
    const n = simMesh.numCells, { xyz, adjOffset, adjList } = simMesh, time = frame.time;
    const noise = new SimplexNoise(seed * 13 + 5);
    const land = new Uint8Array(n);
    const arc = new Uint8Array(n);
    for (let w = 0; w < n; w++) {
        land[w] = frame.owner[w] >= 0 && frame.type[w] !== CrustType.OCEAN ? 1 : 0;
        arc[w] = land[w] && frame.type[w] === CrustType.ARC ? 1 : 0;
    }
    fillPockets(simMesh, land, cfg.pocketSeaKm2);

    // ── the coast: signed distance to the edge of the land crust, and what kind of coast is nearest ──
    const dist = new Float32Array(n).fill(Infinity), coastKind = new Uint8Array(n);
    const kindAtCoast = w => {                                        // w: a land cell on the coast
        if (frame.type[w] === CrustType.ARC && !(frame.flags[w] & CrustFlag.MARGIN_ISLE)) return CoastKind.ARC;
        const t = frame.margin[w] & Margin.TYPE;
        return t === Margin.ACTIVE ? CoastKind.ACTIVE : t === Margin.TRANSFORM ? CoastKind.TRANSFORM : t === Margin.COLLISION ? CoastKind.COLLISION : CoastKind.PASSIVE;
    };
    // A margin's kind is a property of a stretch of coast, not of one cell: the coast cells of a bay, or of a headland's
    // flank, on an active margin are not themselves at the plate boundary — alone they would read passive, and a passive
    // shelf (150 km) would drown the land behind the coastal range in patches. So the kinds other than passive carry
    // along the coast (coast cell to coast cell) for coastKindKm; a passive coast cell they reach takes the nearest.
    const onCoast = new Uint8Array(n), ownKind = new Uint8Array(n), along = new Float32Array(n).fill(Infinity);
    for (let w = 0; w < n; w++) {
        if (!land[w]) continue;
        for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) if (!land[adjList[k]]) { onCoast[w] = 1; break; }
        if (!onCoast[w]) continue;
        ownKind[w] = kindAtCoast(w);
        if (ownKind[w] !== CoastKind.PASSIVE && ownKind[w] !== CoastKind.ARC) along[w] = 0;
    }
    const carried = ownKind.slice();
    spreadKm(simMesh, along, { canEnter: (a, b) => onCoast[b] === 1, onReach: (a, b) => { carried[b] = carried[a]; }, maxKm: cfg.coastKindKm });
    for (let w = 0; w < n; w++) if (onCoast[w] && ownKind[w] === CoastKind.PASSIVE && along[w] <= cfg.coastKindKm) ownKind[w] = carried[w];
    for (let w = 0; w < n; w++) for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
        const nb = adjList[k];
        if (land[nb] === land[w]) continue;
        const half = 0.5 * R * Math.acos(Math.min(1, xyz[3 * w] * xyz[3 * nb] + xyz[3 * w + 1] * xyz[3 * nb + 1] + xyz[3 * w + 2] * xyz[3 * nb + 2]));
        if (half < dist[w]) { dist[w] = half; coastKind[w] = ownKind[land[w] ? w : nb]; }
    }
    spreadKm(simMesh, dist, { canEnter: (a, b) => land[a] === land[b], onReach: (a, b) => { coastKind[b] = coastKind[a]; }, maxKm: 6000 });
    const coastKm = new Float32Array(n), shelfKm = new Float32Array(n), plainKm = new Float32Array(n), slopeKm = new Float32Array(n);
    for (let w = 0; w < n; w++) {
        const d = Math.min(6000, dist[w]);
        coastKm[w] = land[w] ? d : -d;
        const m = cfg.margins[COAST_KEYS[coastKind[w]]], x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2];
        const vary = 1 + cfg.shelfNoise * noise.fbm(x * 9 + 1.7, y * 9 + 4.2, z * 9 + 8.1, 3, 0.5) * 1.6;
        shelfKm[w] = m.shelfKm * Math.max(0.2, vary); plainKm[w] = m.plainKm; slopeKm[w] = m.slopeKm;
    }

    // ── the sea floor: half-space cooling depth; oceanic plateaus; abyssal-hill wavelength from the age gradient ──
    const depthKm = new Float32Array(n), ageMyr = new Float32Array(n), fabricKm = new Float32Array(n);
    for (let w = 0; w < n; w++) {
        if (land[w]) continue;
        const age = frame.owner[w] >= 0 ? Math.max(0, time - frame.formedAt[w]) : 100;
        ageMyr[w] = age;
        depthKm[w] = seaDepthKm(age) - (frame.volcType[w] === VolcanicType.LIP ? cfg.lipSeaKm * Math.min(cfg.lipMaxKm, frame.volcKm[w]) : 0);
    }
    const grad = [0, 0, 0];
    for (let w = 0; w < n; w++) {
        if (land[w]) continue;
        const g = gradient(simMesh, ageMyr, w, nb => !land[nb], grad);     // Myr per km
        fabricKm[w] = g > 1e-4 ? cfg.fabricPeriodMyr / g : 1e4;
    }

    // ── live trenches: the axis is the subducting plate's edge; depth by the age of the slab going down ──
    const trenchDist = new Float32Array(n).fill(Infinity), riseDist = new Float32Array(n).fill(Infinity), trenchDepthKm = new Float32Array(n);
    for (let w = 0; w < n; w++) {
        if (frame.boundary[w] !== BoundaryKind.SUBDUCTING || land[w]) continue;
        trenchDist[w] = 0; riseDist[w] = 0;
        trenchDepthKm[w] = cfg.trenchKm * (0.6 + 0.4 * Math.min(1, ageMyr[w] / 100));
    }
    spreadKm(simMesh, trenchDist, { canEnter: (a, b) => !land[b], onReach: (a, b) => { trenchDepthKm[b] = trenchDepthKm[a]; }, maxKm: 500 });
    spreadKm(simMesh, riseDist, { canEnter: (a, b) => !land[b] && frame.owner[b] === frame.owner[a], maxKm: 500 });
    const trenchKm = new Float32Array(n), riseKm = new Float32Array(n);
    for (let w = 0; w < n; w++) { trenchKm[w] = Math.min(1e4, trenchDist[w]); riseKm[w] = Math.min(1e4, riseDist[w]); }

    // ── how fast things erode here: faster where it rains more (terrain-config.js rainByLatitude) ──
    const erosion = new Float32Array(n);
    for (let w = 0; w < n; w++) erosion[w] = erosionAtLatitude(Math.asin(Math.max(-1, Math.min(1, xyz[3 * w + 2]))) * 180 / Math.PI, cfg);

    // ── the continental platform: crust kind, isostasy of the thickened crust, mantle swell, flood basalts ──
    const platformKm = new Float32Array(n), quietMyr = new Float32Array(n);
    for (let w = 0; w < n; w++) {
        if (!land[w]) continue;
        const type = frame.type[w], flags = frame.flags[w];
        const quiet = frame.oroType[w] ? Math.max(0, time - frame.oroLast[w]) : time;
        quietMyr[w] = quiet;
        let h;
        if (type === CrustType.CRATON) h = cfg.cratonKm;
        else if (type === CrustType.ARC) {
            if (flags & CrustFlag.MARGIN_ISLE) h = cfg.foreArcIsleKm;
            else { const m = Math.min(1, Math.max(0, (time - frame.formedAt[w]) / cfg.arcMatureMyr)); h = cfg.arcYoungKm + (cfg.arcMatureKm - cfg.arcYoungKm) * m ** 0.7; }
        } else h = cfg.continentKm;
        // the evolved root, by Airy isostasy, and the evolved uplift above it (tectonics/step/heights.js)
        const root = frame.rootKm[w] * (type === CrustType.ARC ? 0.25 : 1);     // (an arc's recorded thickening is mostly its own growth, already in its maturity)
        h += cfg.isoMaxKm * (1 - Math.exp(-root / cfg.isoScaleKm));        // (the evolved uplift is carried separately: upliftKm)
        h += cfg.swellKm * (frame.mantleHeat[w] / 255) ** 2;
        if (frame.volcType[w] === VolcanicType.LIP) h += cfg.lipLandKm * Math.min(cfg.lipMaxKm, frame.volcKm[w]);
        platformKm[w] = h;
    }

    // ── failed rift arms: distance from the arm (a line one cell wide — the terrain gives it a width in km) ──
    const armDist = new Float32Array(n).fill(Infinity);
    for (let w = 0; w < n; w++) if (land[w] && (frame.flags[w] & CrustFlag.FAILED_RIFT)) armDist[w] = 0;
    spreadKm(simMesh, armDist, { maxKm: 600 });
    const armKm = Float32Array.from(armDist, d => Math.min(1e4, d));

    // ── belts, in two layers: the current belt, and the one it overprinted (crust.prev*) ──
    const current = beltLayer(frame, simMesh, cfg, land, coastKm, { type: frame.oroType, u: frame.beltU, reach: frame.beltReach, side: frame.beltSide, shear: frame.beltShear, last: frame.oroLast, rugged: frame.rugged });
    const overprinted = beltLayer(frame, simMesh, cfg, land, coastKm, { type: frame.prevType, u: frame.prevU, reach: frame.prevReach, side: frame.prevSide, shear: frame.prevShear, last: frame.prevLast, rugged: frame.prevRugged });
    const { kind, dKm, reach, reliefKm, shear, across } = current;

    return { land, arc, coastKm, coastKind, shelfKm, plainKm, slopeKm, depthKm, ageMyr, fabricKm, trenchKm, riseKm, trenchDepthKm,
        platformKm, upliftKm: frame.upliftKm, quietMyr, armKm, erosion, kind, dKm, reach, reliefKm, shear, across, belts: [current, overprinted], time };
}

/**
 * One layer of belts, read from the given per-cell record arrays (the current belt's, or the overprinted one's):
 * { kind, dKm (distance from the front), reach, reliefKm (its crests' evolved height), shear, quietMyr, across (3 per cell:
 * unit vector across the strike, toward the far edge; zero if unknown) }.
 */
function beltLayer(frame, simMesh, cfg, land, coastKm, rec) {
    const n = simMesh.numCells, { xyz, adjOffset, adjList } = simMesh, time = frame.time, grad = [0, 0, 0];
    const kind = new Uint8Array(n), dKm = new Float32Array(n), reach = new Float32Array(n), reliefKm = new Float32Array(n), shear = new Float32Array(n), quietMyr = new Float32Array(n);
    for (let w = 0; w < n; w++) {
        const type = rec.type[w];
        if (!land[w] || !type) continue;
        kind[w] = kindOf(type, type === OrogenyType.URAL || type === OrogenyType.HIMALAYAN ? rec.side[w] || BeltSide.UPPER : BeltSide.NONE);
        reach[w] = rec.reach[w];
        dKm[w] = (rec.u[w] / 255) * reach[w];
        shear[w] = rec.shear[w];
        quietMyr[w] = Math.max(0, time - rec.last[w]);
        reliefKm[w] = rec.rugged[w];                  // the crests' height, as the history built and wore it (tectonics/step/heights.js)
    }

    // which way across the strike: straight away from the nearest point of the belt's front
    // (Not the gradient of the recorded distance itself: that was measured along mesh edges, and a distance measured
    // that way has contours that snap toward the mesh's six directions — its gradient is off by tens of degrees.)
    let across = new Float32Array(3 * n);
    const fromFront = new Float32Array(n).fill(Infinity), frontOf = new Int32Array(n).fill(-1);
    for (let w = 0; w < n; w++) if (kind[w] && reach[w] > 0 && rec.u[w] === 0) { fromFront[w] = 0; frontOf[w] = w; }
    spreadKm(simMesh, fromFront, { canEnter: (a, b) => kind[b] === kind[a], onReach: (a, b) => { frontOf[b] = frontOf[a]; } });
    for (let w = 0; w < n; w++) {
        if (!kind[w]) continue;
        const f = frontOf[w];
        if (f >= 0 && f !== w) {
            const x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2];
            let ax = x - xyz[3 * f], ay = y - xyz[3 * f + 1], az = z - xyz[3 * f + 2];
            const r = ax * x + ay * y + az * z; ax -= r * x; ay -= r * y; az -= r * z;
            const l = Math.hypot(ax, ay, az);
            if (l > 1e-9) { across[3 * w] = ax / l; across[3 * w + 1] = ay / l; across[3 * w + 2] = az / l; continue; }
        }
        const g = gradient(simMesh, dKm, w, nb => kind[nb] === kind[w] && reach[nb] > 0, grad);     // (a front cell: its belt's slope)
        if (g > 1e-3) { across[3 * w] = grad[0] / g; across[3 * w + 1] = grad[1] / g; across[3 * w + 2] = grad[2] / g; }
    }
    for (let pass = 0; pass < 2; pass++) {                                   // smooth over ~250 km within the belt
        const next = new Float32Array(3 * n);
        for (let w = 0; w < n; w++) {
            if (!kind[w]) continue;
            let ax = across[3 * w], ay = across[3 * w + 1], az = across[3 * w + 2];
            for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) { const nb = adjList[k]; if (kind[nb] === kind[w]) { ax += across[3 * nb]; ay += across[3 * nb + 1]; az += across[3 * nb + 2]; } }
            const x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2], r = ax * x + ay * y + az * z;
            ax -= r * x; ay -= r * y; az -= r * z;
            const l = Math.hypot(ax, ay, az);
            if (l > 1e-6) { next[3 * w] = ax / l; next[3 * w + 1] = ay / l; next[3 * w + 2] = az / l; }
        }
        across = next;
    }
    // where the belt gives no direction (a belt one cell wide, an arc's birth line), fall back on the coast's: inland
    for (let w = 0; w < n; w++) {
        if (!kind[w] || across[3 * w] || across[3 * w + 1] || across[3 * w + 2]) continue;
        const g = gradient(simMesh, coastKm, w, () => true, grad);
        if (g > 1e-6) { across[3 * w] = grad[0] / g; across[3 * w + 1] = grad[1] / g; across[3 * w + 2] = grad[2] / g; }
    }
    return { kind, dKm, reach, reliefKm, shear, quietMyr, across };
}

/**
 * Least-squares gradient of `field` at cell w (per km, as a tangent vector in `out`) from the neighbours that pass
 * `use`. Returns its magnitude (0 if it cannot be fitted).
 */
export function gradient(mesh, field, w, use, out) {
    const { xyz, adjOffset, adjList } = mesh;
    const x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2];
    // tangent basis at w
    let ex = -y, ey = x, ez = 0;
    if (Math.hypot(ex, ey) < 1e-6) { ex = 1; ey = 0; }
    const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
    const nx = y * ez - z * ey, ny = z * ex - x * ez, nz = x * ey - y * ex;
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, used = 0;
    for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) {
        const nb = adjList[k];
        if (!use(nb)) continue;
        const dx = (xyz[3 * nb] - x) * R, dy = (xyz[3 * nb + 1] - y) * R, dz = (xyz[3 * nb + 2] - z) * R;
        const u = dx * ex + dy * ey + dz * ez, v = dx * nx + dy * ny + dz * nz, df = field[nb] - field[w];
        a11 += u * u; a12 += u * v; a22 += v * v; b1 += u * df; b2 += v * df; used++;
    }
    const det = a11 * a22 - a12 * a12;
    if (used < 2 || Math.abs(det) < 1e-6 * (a11 + a22) ** 2) { out[0] = out[1] = out[2] = 0; return 0; }
    const g1 = (a22 * b1 - a12 * b2) / det, g2 = (a11 * b2 - a12 * b1) / det;
    out[0] = g1 * ex + g2 * nx; out[1] = g1 * ey + g2 * ny; out[2] = g1 * ez + g2 * nz;
    return Math.hypot(g1, g2);
}
