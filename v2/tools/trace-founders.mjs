// Where and why trenches are born, and how sealed seas fare: a history of the 'cycle' scene run headless, its subduction
// initiations listed by kind (between plates · inside a plate · a sealed sea's floor) with the age and the stress across
// the margin, and the largest sea caught between continents every 50 Myr.
// Usage: node v2/tools/trace-founders.mjs [simCells=20000] [seed …] [--len 600] [--set key=value,…]
import { labMesh } from './lib/check-kit.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { TERRAIN_SCENES } from '../js/tectonics/scenarios/terrain-scenes.js';
import { EventKind, BoundaryKind } from '../js/tectonics/model/world.js';
import { CrustType, CrustFlag } from '../js/tectonics/model/crust.js';

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

// the plates' sizes and the sea floor's age on the frame's world view; the trenches (overriding boundary cells), their
// total length and the longest unbroken one
function plateShape(world) {
    const { owner, ownerCell, plates, time, boundaryKind } = world, { numCells, cellAreaKm2, edgeKm, adjOffset, adjList } = mesh, area = new Map();
    const ageList = [];
    let ages = 0, n = 0, trench = 0;
    for (let w = 0; w < numCells; w++) {
        const o = owner[w]; if (o < 0) continue;
        area.set(o, (area.get(o) ?? 0) + cellAreaKm2);
        const P = plates[o], c = ownerCell[w];
        if (P.crust.type[c] === CrustType.OCEAN) { const a = time - P.crust.formedAt[c]; ages += a; n++; ageList.push(a); }
        if (boundaryKind[w] === BoundaryKind.OVERRIDING) trench++;
    }
    const seen = new Uint8Array(numCells);
    let longest = 0;
    for (let s = 0; s < numCells; s++) {
        if (seen[s] || boundaryKind[s] !== BoundaryKind.OVERRIDING) continue;
        const q = [s]; seen[s] = 1;
        for (let i = 0; i < q.length; i++) for (let k = adjOffset[q[i]]; k < adjOffset[q[i] + 1]; k++) { const nb = adjList[k]; if (!seen[nb] && boundaryKind[nb] === BoundaryKind.OVERRIDING && owner[nb] === owner[s]) { seen[nb] = 1; q.push(nb); } }
        longest = Math.max(longest, q.length);
    }
    const mean = ages / Math.max(1, n), old2 = ageList.filter(a => a > 2 * mean).length / Math.max(1, n);
    const total = numCells * cellAreaKm2, sizes = [...area.values()], top = [...area].sort((x, y) => y[1] - x[1])[0][0], T = plates[top];
    return { land: 100 * T.stats.continentalCells / Math.max(1, T.stats.cells), largest: 100 * Math.max(...sizes) / total, big: sizes.filter(a => a >= 10 ** 7.5).length, age: mean, old2: 100 * old2, trenchKm: trench * edgeKm, longestKm: longest * edgeKm };
}

for (const seed of seeds) {
    const t0 = performance.now();
    const world = scene.build(mesh, seed, { continentalFraction: 0.3 });
    Object.assign(world.config, { crustLedger: true }, overrides);
    world.founderTrace = { between: {}, inside: {} };                  // (subduction-init.js tallies where candidates are lost)
    const seas = [], shape = [];
    simulate(world, { untilMyr: len, drive: scene.drive, snapshotEveryMyr: 50, onFrame: f => { if (f.time > 0) { seas.push({ t: f.time, s: caughtSeas(world) }); shape.push({ t: f.time, ...plateShape(world) }); } } });
    const inits = world.events.filter(e => e.kind === EventKind.SUBDUCTION_INIT);
    const kind = e => e.data.sealed ? 'sealed' : e.data.across ? 'across' : e.data.stress !== undefined ? 'inside' : 'between';
    console.log(`seed ${seed}: ${((performance.now() - t0) / 1000).toFixed(0)} s, ${inits.length} trenches born`);
    for (const k of ['between', 'inside', 'across', 'sealed']) {
        const es = inits.filter(e => kind(e) === k);
        console.log(`  ${k.padEnd(8)} ${String(es.length).padStart(3)}  ${es.slice(0, 12).map(e => `${e.time.toFixed(0)}:${e.data.ageMyr.toFixed(0)}My${e.data.stress !== undefined ? `/σ${e.data.stress.toFixed(2)}` : ''}${e.data.areaMkm2 ? `/${e.data.areaMkm2.toFixed(1)}M` : ''}`).join(' ')}`);
    }
    const q = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
    for (const [k, t] of Object.entries(world.founderTrace)) {
        const S = t.samples ?? [], col = i => S.map(x => x[i]), A = t.acrossSamples ?? [];
        if (A.length) console.log(`    across: age p10/50/90 ${[0.1, 0.5, 0.9].map(p => q(A.map(x => x[0]), p).toFixed(0)).join('/')} Myr · σ p10/50/90 ${[0.1, 0.5, 0.9].map(p => q(A.map(x => x[1]), p).toFixed(2)).join('/')}`);
        console.log(`  candidates ${k}: ${Object.entries(t).filter(([n]) => !/amples$/.test(n)).map(([n, v]) => `${n} ${typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : v}`).join(' · ')}`);
        if (S.length) console.log(`    age p10/50/90 ${[0.1, 0.5, 0.9].map(p => q(col(0), p).toFixed(0)).join('/')} Myr · squeeze (${k === 'between' ? 'closing cm/yr' : 'σ, − compression'}) p10/50/90 ${[0.1, 0.5, 0.9].map(p => q(col(1), p).toFixed(2)).join('/')} · length p50 ${q(col(2), 0.5).toFixed(0)} km`);
    }
    console.log(`  plates every 50 Myr (largest % [its land %] · count ≥ 10^7.5 km² · mean sea-floor age Myr [% older than twice it] · trench km [longest]): ${shape.map(x => `${x.t}:${x.largest.toFixed(0)}[${x.land.toFixed(0)}]/${x.big}/${x.age.toFixed(0)}[${x.old2.toFixed(0)}]/${(x.trenchKm / 1000).toFixed(0)}k[${(x.longestKm / 1000).toFixed(1)}k]`).join(' ')}`);
    const born = world.events.filter(e => e.kind === EventKind.PLATE_BORN && !/pre-history/.test(e.text)).map(e => e.data.areaMkm2).sort((a, b) => a - b);
    const bigBirths = world.events.filter(e => e.kind === EventKind.PLATE_BORN && !/pre-history/.test(e.text) && e.data.areaMkm2 > 5).map(e => { const i = inits.find(x => x.time === e.time && x.data.lower === e.data.plate || x.data.upper === e.data.plate && x.time === e.time); return `${e.time.toFixed(0)}:${e.data.areaMkm2.toFixed(1)}M/${e.data.invasion ? 'invasion' : i ? kind(i) : 'birth'}/${i ? i.data.lengthKm.toFixed(0) + 'km' : ''}`; });
    console.log(`  plates born over 5 Mkm²: ${bigBirths.join(' ') || 'none'}`);
    const lens = inits.map(e => e.data.lengthKm).sort((a, b) => a - b), B = world.budget;
    console.log(`  plates born ${born.length} (Mkm² p10/50/90/max): ${[0.1, 0.5, 0.9].map(p => q(born, p).toFixed(1)).join('/')}/${(born.at(-1) ?? 0).toFixed(1)} · invasions ${world.events.filter(e => e.kind === EventKind.PLATE_BORN && e.data.invasion).length} · nucleus km p50/max ${q(lens, 0.5).toFixed(0)}/${(lens.at(-1) ?? 0).toFixed(0)} · propagated ${((B.propagatedKm ?? 0) / 1000).toFixed(0)}k km at ${((B.propagatedKm ?? 0) / Math.max(1e-9, B.propagatingTipMyr ?? 0) / 10).toFixed(1)} cm/yr while urged`);
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
