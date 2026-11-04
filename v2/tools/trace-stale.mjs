// Phase 11's stale belt cells, traced (lane crust, 1c): check-phase11's staleShare, with each stale cell's story — its
// kind, how long since its belt last reached it (beltAt), and whether it reads farther or nearer than its neighbours.
// Hypothesis: a belt whose reach shrinks leaves its fringe cells unrefreshed while the cells inside are re-laid each step
// over ground the belt itself has weakened (strength falls as the crust thickens), so their strength-weighted distances
// shrink and the fringe's stay where they were.
// Usage: node v2/tools/trace-stale.mjs [--seed 12345] [--myr 600] [--set key=value …]
import { labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { BUDGET_SCENES } from '../js/tectonics/scenarios/budget-scenes.js';
import { buildStartWorld } from '../js/tectonics/init/start-world.js';
import { CrustType, CrustFlag, OrogenyType } from '../js/tectonics/model/crust.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const seed = +arg('seed', 12345), MYR = +arg('myr', 600);
const sets = process.argv.flatMap((a, i) => a === '--set' ? [process.argv[i + 1]] : []);
const mesh = labMesh(), n = mesh.numCells;
const { world } = buildStartWorld(mesh, seed);
for (const s of sets) {
    const [k, v] = s.split('=');
    if (!(k in world.config)) throw new Error(`unknown config key ${k}`);
    world.config[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v;
}
const NAME = Object.fromEntries(Object.entries(OrogenyType).map(([k, v]) => [v, k]));
const WEAK = CrustFlag.SUTURE | CrustFlag.FAILED_RIFT | CrustFlag.RIFT_MARGIN, jump = 1.3 * mesh.edgeKm;
const look = time => {
    let belt = 0, stale = 0;
    const byKind = {}, lag = { now: 0, recent: 0, old: 0 }, dir = { farther: 0, nearer: 0 };
    for (const p of world.plates) {
        if (!p.alive) continue;
        const k = p.crust;
        for (let c = 0; c < n; c++) {
            if (!k.mask[c] || k.type[c] === CrustType.OCEAN || !k.oroType[c] || !(k.beltReach[c] > 0)) continue;
            belt++;
            if (k.type[c] === CrustType.CRATON || (k.flags[c] & WEAK)) continue;
            const vals = [];
            for (let j = mesh.adjOffset[c]; j < mesh.adjOffset[c + 1]; j++) {
                const q = mesh.adjList[j];
                if (k.mask[q] && k.type[q] !== CrustType.OCEAN && k.type[q] !== CrustType.CRATON && !(k.flags[q] & WEAK) && k.oroType[q] === k.oroType[c] && k.oroStart[q] === k.oroStart[c] && k.beltSide[q] === k.beltSide[c] && k.beltReach[q] > 0) vals.push(k.beltU[q] * k.beltReach[q]);
            }
            if (vals.length < 2) continue;
            vals.sort((a, b) => a - b);
            const mid = vals.length % 2 ? vals[vals.length >> 1] : 0.5 * (vals[(vals.length >> 1) - 1] + vals[vals.length >> 1]), me = k.beltU[c] * k.beltReach[c];
            if (Math.abs(me - mid) <= jump) continue;
            stale++;
            const kind = NAME[k.oroType[c]] ?? k.oroType[c];
            byKind[kind] = (byKind[kind] ?? 0) + 1;
            const since = time - k.beltAt[c];
            lag[since <= 5 ? 'now' : since <= 50 ? 'recent' : 'old']++;
            dir[me > mid ? 'farther' : 'nearer']++;
        }
    }
    return { time, belt, stale, share: +(stale / Math.max(1, belt) * 100).toFixed(2), byKind, lag, dir };
};
const rows = [];
simulate(world, { untilMyr: MYR, drive: BUDGET_SCENES.find(s => s.id === 'history').drive, snapshotEveryMyr: 50, onFrame: f => {
    if (f.time > 0 && f.time % 100 === 0) { const r = look(f.time); rows.push(r); console.log(JSON.stringify(r)); }
} });
console.log(`STALE_JSON ${JSON.stringify({ seed, sets, max: Math.max(...rows.map(r => r.share)), rows })}`);
