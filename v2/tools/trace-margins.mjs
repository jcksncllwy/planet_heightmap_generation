// Do the history's rifts leave a stretched continental margin (lane contarea, sessrumnir's question before A1)? On Earth a
// passive margin is 100–300 km of thinned continental crust from the necking zone to the continent–ocean boundary, β 2–5 at
// its distal end (Sutra et al. 2013, G³; Iberia–Newfoundland, Gómez-Romeu et al. 2019), and the shelf, slope and rise sit on
// it (Cogley 1984). This reads, every --every Myr of a page history, each plate's passive continent–ocean boundary (a
// continent or craton cell beside its own plate's ocean, no trench within two cells): the crust there (C.crust + rootKm,
// so β = C.crust[CONTINENT] ÷ it), how far inland from it the crust stays thinned (β ≥ 1.1), and the planet's area of
// thinned continental crust; and at each rift stage's end (breakup), the stage's zone across both halves.
// Prints one line `MARGINS_JSON {…}`.
//   node v2/tools/trace-margins.mjs --seed 716130 [--myr 1100] [--every 50] [--set key=value …]

import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { simulate } from '../js/tectonics/simulate.js';
import { CrustType, CrustFlag } from '../js/tectonics/model/crust.js';
import { columnModel } from '../js/tectonics/measure.js';
import { heightsOf } from '../js/tectonics/step/heights.js';
import { pageWorld, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { onPath, PATH_K } from './lib/paths.mjs';

setDelaunator(Delaunator);
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const seed = +arg('seed', 716130), MYR = +arg('myr', 1100), SIM = +arg('sim', 40000), cont = +arg('cont', DEFAULT_CONT), EVERY = +arg('every', 50);
const sets = argv.flatMap((a, i) => a === '--set' ? [argv[i + 1]] : []);

const { scene, world } = pageWorld({ seed, cont, sim: SIM });
onPath(world);
for (const s of sets) {
    const [k, v] = s.split('=');
    if (!(k in world.config)) throw new Error(`unknown config key ${k}`);
    world.config[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v;
}
const { adjOffset, adjList, numCells: n, edgeKm, cellAreaKm2: A } = world.mesh;
const C = columnModel(heightsOf(world.config)), H0 = C.crust[CrustType.CONTINENT], THIN_BETA = 1.1;
const isCont = t => t === CrustType.CONTINENT || t === CrustType.CRATON;
const crustKm = (k, c) => C.crust[k.type[c]] + k.rootKm[c];
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };

/** One plate's passive boundary cells, their β and their thinned width (hops inland while β ≥ THIN_BETA, from the boundary). */
function margins(plate, out) {
    const k = plate.crust, { mask, type, flags } = k;
    const trenchNear = new Uint8Array(n), seen = new Int32Array(n).fill(-1);
    let ring = [];
    for (let c = 0; c < n; c++) if (mask[c] && type[c] === CrustType.OCEAN && (flags[c] & CrustFlag.TRENCH)) { trenchNear[c] = 1; ring.push(c); }
    for (let h = 0; h < 2; h++) { const next = []; for (const c of ring) for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const nb = adjList[j]; if (!trenchNear[nb]) { trenchNear[nb] = 1; next.push(nb); } } ring = next; }
    for (let c = 0; c < n; c++) {
        if (!mask[c] || !isCont(type[c]) || trenchNear[c]) continue;
        let cob = false;
        for (let j = adjOffset[c]; j < adjOffset[c + 1]; j++) { const nb = adjList[j]; if (mask[nb] && type[nb] === CrustType.OCEAN) { cob = true; break; } }
        if (!cob) continue;
        const beta = H0 / Math.max(1e-3, crustKm(k, c));
        out.cob.push(beta); out.rifted += (flags[c] & CrustFlag.RIFT_MARGIN) ? 1 : 0;
        // thinned width: hops inland over continent while thinned (β ≥ THIN_BETA), the boundary cell counted as one
        let w = 0;
        if (beta >= THIN_BETA) {
            const stamp = out.stamp++; let fr = [c]; seen[c] = stamp; w = 1;
            for (let h = 0; h < 6 && fr.length; h++) {
                const next = [];
                for (const x of fr) for (let j = adjOffset[x]; j < adjOffset[x + 1]; j++) { const nb = adjList[j]; if (seen[nb] !== stamp && mask[nb] && isCont(type[nb]) && H0 / Math.max(1e-3, crustKm(k, nb)) >= THIN_BETA) { seen[nb] = stamp; next.push(nb); } }
                if (next.length) w++; fr = next;
            }
        }
        out.width.push(w * edgeKm);
    }
}

const frames = [], breakups = [];
let lastStages = new Map();
const t0 = performance.now();
await simulate(world, {
    untilMyr: MYR, snapshotEveryMyr: 10, keepFrames: false,
    drive: w => scene.drive(w),
    onFrame: f => {
        // breakups: a rift stage gone from the list since the last frame — its zone, both halves: the crust of each cell
        const now = new Map((world.riftStages ?? []).map(st => [`${st.a}:${st.b}:${st.born}`, st]));
        for (const [key, st] of lastStages) if (!now.has(key)) {
            const betas = [], byHop = new Map();
            for (const id of [st.a, st.b]) {
                const P = world.plates[id];
                if (!P?.alive) continue;
                for (let i = 0; i < st.zone.length; i++) {
                    const c = st.zone[i];
                    if (!P.crust.mask[c] || P.crust.type[c] !== CrustType.CONTINENT) continue;
                    const b = H0 / Math.max(1e-3, crustKm(P.crust, c)); betas.push(b);
                    const h = st.hop[i]; (byHop.get(h) ?? byHop.set(h, []).get(h)).push(b);
                }
            }
            breakups.push({ t: Math.round(f.time), born: Math.round(st.born), lengthKm: Math.round(st.lengthKm), openedKm: Math.round(st.stretchedKm2 / st.lengthKm), cells: betas.length,
                betaMed: q(betas, 0.5), betaMax: q(betas, 0.999), thinnedCells: betas.filter(b => b >= THIN_BETA).length,
                byHop: Object.fromEntries([...byHop].sort((a, b) => a[0] - b[0]).map(([h, bs]) => [h, [bs.length, q(bs, 0.5)]])) });
        }
        lastStages = now;
        if (Math.round(f.time) % EVERY !== 0) return;
        const out = { cob: [], width: [], rifted: 0, stamp: 0 };
        let contCells = 0, thinCells = 0, beta2 = 0;
        for (const p of world.plates) {
            if (!p.alive || p.isBackground) continue;
            margins(p, out);
            const k = p.crust;
            for (let c = 0; c < n; c++) {
                if (!k.mask[c] || !isCont(k.type[c])) continue;
                contCells++;
                const b = H0 / Math.max(1e-3, crustKm(k, c));
                if (b >= THIN_BETA) thinCells++;
                if (b >= 2) beta2++;
            }
        }
        frames.push({ t: Math.round(f.time), cobCells: out.cob.length, cobKm: Math.round(out.cob.length * edgeKm), riftedShare: out.cob.length ? +(out.rifted / out.cob.length).toFixed(3) : 0,
            cobThinShare: out.cob.length ? +(out.cob.filter(b => b >= THIN_BETA).length / out.cob.length).toFixed(3) : 0,
            cobBetaMed: q(out.cob, 0.5), cobBetaP90: q(out.cob, 0.9), widthMedKm: q(out.width, 0.5), widthP90Km: q(out.width, 0.9),
            contPct: +(100 * contCells / n).toFixed(2), thinPct: +(100 * thinCells / n).toFixed(2), beta2Pct: +(100 * beta2 / n).toFixed(2) });
        const fr = frames.at(-1);
        process.stderr.write(`t ${fr.t}  cob ${fr.cobKm} km  thin@cob ${fr.cobThinShare}  β med ${fr.cobBetaMed} p90 ${fr.cobBetaP90}  width med ${fr.widthMedKm} km  thin ${fr.thinPct} % of planet  (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`);
    },
});
console.log(`MARGINS_JSON ${JSON.stringify({ seed, cont, path: PATH_K, sets, edgeKm: +edgeKm.toFixed(1), cellKm2: Math.round(A), seconds: +((performance.now() - t0) / 1000).toFixed(1), frames, breakups })}`);
