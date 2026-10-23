// Where and why trenches are born, and how sealed seas fare: a history of the 'cycle' scene run headless, its subduction
// initiations listed by kind (between plates · inside a plate · a sealed sea's floor) with the age and the stress across
// the margin, and the largest sea caught between continents every 50 Myr.
// Usage: node v2/tools/trace-founders.mjs [simCells=20000] [seed …] [--len 600] [--set key=value,…]
import { labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { CrustType } from '../js/tectonics/model/crust.js';

const args = process.argv.slice(2), flag = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const len = Number(flag('--len') ?? 600), set = flag('--set');
const overrides = set ? Object.fromEntries(set.split(',').map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; })) : {};
const nums = args.map(Number), cells = nums[0] || 20000, seeds = nums.length > 1 ? nums.slice(1) : [12345];
const mesh = labMesh(cells), scene = TERRAIN_SCENES.find(s => s.id === 'cycle');

// the seas cut off from the world ocean, on the frame's world view (Mkm², largest first)
function caughtSeas(world) {
    const { owner, ownerCell, plates, landClaims } = world, { numCells, adjOffset, adjList, cellAreaKm2 } = mesh;
    const isSea = w => owner[w] < 0 || (landClaims[w] <= 1 && plates[owner[w]].crust.type[ownerCell[w]] === CrustType.OCEAN);
    const comp = new Int32Array(numCells).fill(-1), sizes = [];
    for (let w0 = 0; w0 < numCells; w0++) {
        if (!isSea(w0) || comp[w0] >= 0) continue;
        const q = [w0]; comp[w0] = sizes.length;
        for (let i = 0; i < q.length; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const nb = adjList[k]; if (comp[nb] < 0 && isSea(nb)) { comp[nb] = sizes.length; q.push(nb); } }
        sizes.push(q.length * cellAreaKm2 / 1e6);
    }
    return sizes.sort((a, b) => b - a).slice(1).filter(s => s >= 0.5);
}

for (const seed of seeds) {
    const t0 = performance.now();
    const world = scene.build(mesh, seed, { continentalFraction: 0.3 });
    Object.assign(world.config, { crustLedger: true }, overrides);
    const seas = [];
    simulate(world, { untilMyr: len, drive: scene.drive, snapshotEveryMyr: 50, onFrame: f => { if (f.time > 0) seas.push({ t: f.time, s: caughtSeas(world) }); } });
    const inits = world.events.filter(e => e.kind === EventKind.SUBDUCTION_INIT);
    const kind = e => e.data.sealed ? 'sealed' : e.data.stress !== undefined ? 'inside' : 'between';
    console.log(`seed ${seed}: ${((performance.now() - t0) / 1000).toFixed(0)} s, ${inits.length} trenches born`);
    for (const k of ['between', 'inside', 'sealed']) {
        const es = inits.filter(e => kind(e) === k);
        console.log(`  ${k.padEnd(8)} ${String(es.length).padStart(3)}  ${es.slice(0, 12).map(e => `${e.time.toFixed(0)}:${e.data.ageMyr.toFixed(0)}My${e.data.stress !== undefined ? `/σ${e.data.stress.toFixed(2)}` : ''}${e.data.areaMkm2 ? `/${e.data.areaMkm2.toFixed(1)}M` : ''}`).join(' ')}`);
    }
    const rifts = world.events.filter(e => e.kind === EventKind.RIFT);
    console.log(`  rifts ${rifts.length}: ${rifts.map(e => `${e.time.toFixed(0)}:${e.data.cause}/σ${(e.data.stress ?? 0).toFixed(2)}/${((e.data.share ?? 0) * 100).toFixed(0)}%`).join(' ')}`);
    console.log(`  caught seas ≥0.5 Mkm² (Mkm²): ${seas.map(x => `${x.t}:[${x.s.map(v => v.toFixed(1)).join(',')}]`).join(' ')}`);
    const land = world.plates.reduce((n, p) => n + (p.alive ? p.stats.continentalCells : 0), 0);
    const cellK = mesh.cellAreaKm2 / 1e6;
    console.log(`  budget (Mkm² where cells): ${Object.entries(world.budget ?? {}).map(([k, v]) => `${k} ${typeof v === 'number' ? (/Cells$/.test(k) ? (v * cellK).toFixed(1) : v.toFixed(1)) : ''}`).join(' · ')}`);
    const L = world.ledger, f = v => (v * cellK).toFixed(1);
    console.log(`  ledger, Mkm² continent/arc (start ${f(L.start.land)}/${f(L.start.arc)}): ${Object.entries(L.stages).filter(([, e]) => e.land || e.arc).map(([k, e]) => `${k} ${f(e.land)}/${f(e.arc)}`).join(' · ')}`);
    console.log(`  continental crust at ${len} Myr: ${(land * mesh.cellAreaKm2 / 1e6).toFixed(0)} Mkm², plates alive ${world.plates.filter(p => p.alive && !p.isBackground).length}`);
}
