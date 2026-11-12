// When each sea was cut off from the world ocean (lane seaage, 2026-11-12; records only: nothing in the history reads them).
// A sea the land closes off — a remnant ocean inside a supercontinent, a sea a weld sealed, the Mediterranean at Gibraltar
// 5.97 Ma — is the world ocean's water until then, and dries only as fast as its evaporation outruns its rivers: the
// Messinian Mediterranean fell ~1.5 km in roughly 1–10 kyr once cut off (Krijgsman et al. 1999 date the closure; Ryan 2009
// on the drawdown), while the Black Sea, whose rivers out-supply its evaporation, kept a lake through its lowstand
// isolation (Ryan et al. 1997; Neoeuxine). The finish (finish.js seaDrying) needs how long ago each sea it finds cut off
// was closed to know how much of its window that sea stood dry: this records it.
//
// Every step, the land and the sea now (step/rivers.js seaMaskNow: the one mask on the crust as it stands, against the
// level its last river step found — the level is reckoned every riverEveryMyr, the coast moves every step); the sea's
// connected parts; the largest is the world ocean. Each world cell keeps the last time it lay in the world ocean
// (seaOpenAt); a part cut off from it was closed at the first step after the latest time any of its cells was open
// (its cutOffAt: the history's step resolution, ~1 Myr; a part never open: −Infinity, older than any window). On the
// world cells: seaCutAt, NaN off the cut-off seas, shipped on every frame (snapshot.js). The log (world.seaLog, each
// frame its entries since the frame before): the sea's level each river step (rivers.js), each sea cut off ('cut': its
// area, centre and cutOffAt) and each cut-off sea's water that rejoins the ocean ('rejoin': the area, by the cutOffAt it
// had), for seas of at least pocketSeaKm2 (smaller enclosed seas are filled as lowland by the mask: land-mask.js).
//
// Limits: the world cells are fixed while the plates move (~10–100 km a step against ~110 km cells at 40K), so a sea's
// edge cells read the history of the ground that lay there; the part's own cutOffAt is its latest open cell's, which a
// strait's last cell decides.

import { seaMaskNow } from './rivers.js';
import { heightsOf } from './heights.js';

const R = 6371;
let scratch = null;

/** Label the world's seas now and update the sea-age records. @returns {number} 0 (it never changes crust) */
export function evolveSeaAge(world) {
    const land = seaMaskNow(world);
    if (!land) return 0;                                         // (before the first river step: no sea level yet)
    const { mesh, time } = world, { adjOffset, adjList, numCells: n, xyz } = mesh, cellKm2 = 4 * Math.PI * R * R / n;
    if (scratch?.n !== n) scratch = { n, part: new Int32Array(n), queue: new Int32Array(n) };
    const { part, queue } = scratch;
    // ── the sea's connected parts ──
    part.fill(-1);
    const size = [], first = [];
    for (let s = 0; s < n; s++) {
        if (land[s] || part[s] >= 0) continue;
        const id = size.length;
        let head = 0, tail = 0;
        queue[tail++] = s; part[s] = id;
        while (head < tail) {
            const c = queue[head++];
            for (let k = adjOffset[c]; k < adjOffset[c + 1]; k++) { const q = adjList[k]; if (!land[q] && part[q] < 0) { part[q] = id; queue[tail++] = q; } }
        }
        size.push(tail); first.push(s);
    }
    let ocean = -1;
    for (let i = 0; i < size.length; i++) if (ocean < 0 || size[i] > size[ocean]) ocean = i;
    const openAt = world.seaOpenAt ??= new Float32Array(n).fill(-Infinity);
    const cutAt = world.seaCutAt ??= new Float32Array(n).fill(NaN);
    const times = world.seaAgeTimes ??= [];
    const log = world.seaLog ??= [];
    const minCells = heightsOf(world.config).pocketSeaKm2 / cellKm2;
    // ── what rejoined: cells of a cut-off sea at the last step in the world ocean now, by the cutOffAt they had ──
    const back = new Map();
    for (let w = 0; w < n; w++) {
        if (part[w] === ocean && cutAt[w] === cutAt[w]) back.set(cutAt[w], (back.get(cutAt[w]) ?? 0) + 1);
        if (part[w] === ocean) openAt[w] = time;
    }
    for (const [at, cells] of back) if (cells >= minCells) log.push({ t: time, kind: 'rejoin', cutOffAt: at, km2: Math.round(cells * cellKm2) });
    // ── each cut-off part: the latest time any of its cells lay in the world ocean, and the step after it its closing ──
    const latest = new Float64Array(size.length).fill(-Infinity);
    for (let w = 0; w < n; w++) { const p = part[w]; if (p >= 0 && p !== ocean && openAt[w] > latest[p]) latest[p] = openAt[w]; }
    const closedAt = new Float64Array(size.length);
    for (let p = 0; p < size.length; p++) closedAt[p] = latest[p] === -Infinity ? -Infinity : stepAfter(times, latest[p], time);
    for (let w = 0; w < n; w++) { const p = part[w]; cutAt[w] = p >= 0 && p !== ocean ? closedAt[p] : NaN; }
    // (a sea cut off this step: its area and centre)
    const last = times.length ? times[times.length - 1] : -Infinity;
    for (let p = 0; p < size.length; p++) {
        if (p === ocean || latest[p] !== last || size[p] < minCells) continue;
        let x = 0, y = 0, z = 0;
        for (let w = 0; w < n; w++) if (part[w] === p) { x += xyz[3 * w]; y += xyz[3 * w + 1]; z += xyz[3 * w + 2]; }
        const r = Math.hypot(x, y, z) || 1;
        log.push({ t: time, kind: 'cut', cutOffAt: closedAt[p], km2: Math.round(size[p] * cellKm2), lat: +(Math.asin(z / r) * 180 / Math.PI).toFixed(1), lon: +(Math.atan2(y, x) * 180 / Math.PI).toFixed(1) });
    }
    times.push(time);
    return 0;
}

/** The first labelled step after `t` (the times in order), or `now` if none came between. */
function stepAfter(times, t, now) {
    let lo = 0, hi = times.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m + 1; else hi = m; }
    return lo < times.length ? times[lo] : now;
}
