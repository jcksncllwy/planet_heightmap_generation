// The coast's GPU kernels' test (lane gpucells M2): js/gpu/coast-rays.js (the waves' far field on the climate grid and their
// near field on the mesh) against the CPU's float64 tracer it replaced (tools/lib/coast-reference.mjs, finish-coast.js's as
// of b9e3d4f), and js/gpu/labels.js under terrain/world-ocean.js worldOceanGPU against the CPU flood — on a terrain mesh
// with continents, islands, a fjord coast and lakes below sea level; twice each, for determinism.
//   node v2/tools/coast-rays-test.mjs [--cells 160000] [--reps 2]
// under Dawn (v2/tools/gpu-harness: `npm ci` there first). Exit 1 if a case misses its tolerance or does not repeat itself.
// Tolerances:
//   · the world ocean, the seas cut off and the bodies (worldOcean's whole answer) EQUAL to the CPU's, at three sea levels:
//     the coast decides land;
//   · the open sea (the coast's) equal to the CPU's flood of the world ocean's bodies at least coastSeaKm2 big;
//   · a ray's waves within 1e-4 of the CPU's (relative to the larger of its value and 1e-3 of the field's p99) — the f32
//     tables and exponentials, the far field's weights at the ray's end — except a ray whose path differs (it passed within
//     a hair of a cell's, a grid cell's or a direction's edge: the f32 place against the f64), on at most 1e-3 of the rays.
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import { gpu } from './gpu-harness/dawn.mjs';
import { openDevice } from '../js/gpu/gpu-device.js';
import { coastRaysGPU } from '../js/gpu/coast-rays.js';
import { terrainMesh } from '../js/terrain/terrain-mesh.js';
import { worldOcean, worldOceanGPU } from '../js/terrain/world-ocean.js';
import { cellLatLon } from '../js/climate/core.js';
import { seaRange } from '../js/finish/finish-coast.js';
import { FINISH } from '../js/finish/finish-config.js';
import { waveTracer, gridCell, openSea } from './lib/coast-reference.mjs';

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CELLS = +arg('--cells', 160000), REPS = +arg('--reps', 2), TOL = { rel: 1e-4, floor: 1e-3, pathShare: 1e-3 };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

setDelaunator(Delaunator);
const mesh = terrainMesh(CELLS), n = mesh.numCells, { xyz } = mesh, F = FINISH;
const lat = new Float32Array(n), lon = new Float32Array(n);
cellLatLon(xyz, 'z-up', lat, lon);
// (a ground: continents, a ragged coast of fine-scale relief (fjords, islands), lakes and basins below sea level inland)
const z = new Float32Array(n);
for (let c = 0; c < n; c++) {
    const x = xyz[3 * c], y = xyz[3 * c + 1], w = xyz[3 * c + 2];
    let h = 1.1 * Math.sin(3 * x + 1) * Math.cos(2 * y - 0.5) + 0.6 * Math.sin(5 * w + 2 * x) - 0.3;
    h += 0.25 * Math.sin(41 * x + 7) * Math.sin(37 * y - 3) * Math.sin(29 * w + 1) + 0.08 * Math.sin(150 * x) * Math.sin(140 * w);
    if (h > 0.6 && Math.sin(23 * x + 19 * y) > 0.7) h = -0.2;                                   // (hollows below sea level inland)
    z[c] = h;
}
const { device, info } = await openDevice(gpu);
console.log(`${n.toLocaleString()} cells · GPU: ${info?.description || info?.architecture || '?'}`);

// ── the world ocean, exactly ──
for (const sea of [0, 0.3, -0.45]) {
    const t0 = performance.now(), cpu = worldOcean(mesh, z, sea), t1 = performance.now();
    const cpuCopy = { ocean: cpu.ocean.slice(), cut: cpu.cut.slice(), bodies: JSON.stringify(cpu.bodies), oceanCells: cpu.oceanCells };
    const runs = [];
    for (let k = 0; k < REPS; k++) { const t = performance.now(), g = await worldOceanGPU(device, mesh, z, sea); runs.push({ g: { ocean: g.ocean.slice(), cut: g.cut.slice(), bodies: JSON.stringify(g.bodies), oceanCells: g.oceanCells }, ms: performance.now() - t }); }
    const g = runs[0].g;
    console.log(`sea level ${sea} km: ${JSON.parse(cpuCopy.bodies).length} bodies, world ocean ${cpuCopy.oceanCells.toLocaleString()} cells · CPU ${(t1 - t0).toFixed(0)} ms, GPU ${runs.map(r => r.ms.toFixed(0)).join(' / ')} ms`);
    check(same(g.ocean, cpuCopy.ocean) && same(g.cut, cpuCopy.cut) && g.bodies === cpuCopy.bodies && g.oceanCells === cpuCopy.oceanCells
        && runs.every(r => same(r.g.ocean, g.ocean) && r.g.bodies === g.bodies), `worldOceanGPU equals worldOcean to the cell at ${sea} km (ocean, cut, bodies), and repeats`);
}
{
    const minCells = F.coastSeaKm2 / (4 * Math.PI * 6371 * 6371 / n), W = await worldOceanGPU(device, mesh, z, 0);
    const open = W.oceanCells >= minCells ? W.ocean : new Uint8Array(n), ref = openSea(mesh, worldOcean(mesh, z, 0).ocean, minCells);
    check(same(open, ref), 'the open sea: the world ocean if at least coastSeaKm2, as the old flood of its bodies that big');
}

// ── the waves ──
const climGrid = { w: 360, h: 180 }, G = climGrid.w * climGrid.h, D = F.waveDirs;
const seas = { D, w: climGrid.w, h: climGrid.h, su: new Float32Array(4 * G), sv: new Float32Array(4 * G), ss: new Float32Array(4 * climGrid.h) };
const si = new Float32Array(4 * G);
for (let s = 0; s < 4; s++) for (let g = 0; g < G; g++) {
    const j = Math.floor(g / climGrid.w), i = g - j * climGrid.w, la = 90 - j - 0.5;
    seas.su[s * G + g] = 9 * Math.sin(la * Math.PI / 60) * Math.cos(la * Math.PI / 180) + 3 * Math.sin(i * 0.05 + s);
    seas.sv[s * G + g] = 3 * Math.cos(i * 0.07 - j * 0.04 + s);
    si[s * G + g] = Math.abs(la) > 70 - 5 * s ? Math.min(1, (Math.abs(la) - 60) / 15) : 0;
    if (s === 0 && g < climGrid.h) for (let k = 0; k < 4; k++) seas.ss[k * climGrid.h + g] = 1.5 + Math.abs(Math.sin(g * Math.PI / 180)) * 3;
}
const gen5 = new Float32Array(4 * G * D), genU = new Float32Array(4 * G * D);
seaRange(seas, 0, G, gen5, genU);
const landG = new Float32Array(G), cntG = new Float32Array(G), landMask = new Uint8Array(G), step = 180 / climGrid.h;
for (let c = 0; c < n; c++) { const g = gridCell(climGrid, step, lat[c], lon[c]); cntG[g]++; if (z[c] >= 0) landG[g]++; }
for (let g = 0; g < G; g++) landMask[g] = cntG[g] > 0 && landG[g] > 0.5 * cntG[g] ? 1 : 0;
const edgeKm = mesh.edgeKm;
const T = { D, w: climGrid.w, h: climGrid.h, gen5, genU, si, landMask, far: null, swellDecayKm: F.swellDecayKm, waveSatK: F.waveSatK, waveFetchK: F.waveFetchK,
    farStep: F.waveFarStepKm, farSteps: Math.round(F.waveFarKm / F.waveFarStepKm), nearStep: 1.5 * edgeKm, nearSteps: Math.floor(F.waveNearKm / (1.5 * edgeKm)) };
// (the coast as coastWork finds it: land beside the open sea, and the sea beside land)
const ocean = worldOcean(mesh, z, 0).ocean, coast = [];
for (let c = 0; c < n; c++) {
    const land = z[c] >= 0;
    if (!land && !ocean[c]) continue;
    for (let k = mesh.adjOffset[c]; k < mesh.adjOffset[c + 1]; k++) { const nb = mesh.adjList[k]; if ((land && ocean[nb]) || (!land && z[nb] >= 0)) { coast.push(c); break; } }
}
const cells = Int32Array.from(coast);
let t0 = performance.now();
const tracer = waveTracer(T, mesh, lat, lon), far = new Float32Array(4 * G * D);
tracer.farRange(0, G, far); T.far = far;
const tFar = performance.now() - t0; t0 = performance.now();
const near = new Float32Array(cells.length * D);
tracer.near(z, cells, 0, cells.length, near);
const tNear = performance.now() - t0;
const gruns = [];
for (let k = 0; k < REPS; k++) {
    const t = performance.now(), rays = await coastRaysGPU(device, T, mesh, lat, lon), tf = await rays.far(), t1 = performance.now(), nr = await rays.near(z, cells);
    gruns.push({ far: tf, near: nr, msFar: t1 - t, msNear: performance.now() - t1 }); rays.destroy();
}
console.log(`waves: ${cells.length.toLocaleString()} coast cells × ${D} · near ${T.nearSteps} steps of ${T.nearStep.toFixed(1)} km, far ${T.farSteps} of ${T.farStep} km · CPU far ${tFar.toFixed(0)} ms, near ${tNear.toFixed(0)} ms (one thread); GPU far ${gruns.map(r => r.msFar.toFixed(0)).join(' / ')} ms, near ${gruns.map(r => r.msNear.toFixed(0)).join(' / ')} ms`);
const compare = (a, b, what) => {
    const v = Float64Array.from(b).filter(x => x > 0).sort(), floor = TOL.floor * (v.length ? v[Math.floor(0.99 * (v.length - 1))] : 1);
    let off = 0, worst = 0, zero = 0, big = 0;
    const rel = [], offRel = [];
    for (let i = 0; i < a.length; i++) {
        const r = Math.abs(a[i] - b[i]) / Math.max(Math.abs(b[i]), floor);
        if (r > TOL.rel) {
            off++; offRel.push(r);
            if ((a[i] === 0) !== (b[i] === 0)) zero++;          // (one met land and the other did not: the walk's or the grid's land at a step)
            else if (r > 0.01) big++;
        } else { worst = Math.max(worst, r); rel.push(r); }
    }
    rel.sort((x, y) => x - y); offRel.sort((x, y) => x - y);
    console.log(`${what}: ${a.length.toLocaleString()} rays · within: p99 ${(rel[Math.floor(0.99 * (rel.length - 1))] ?? 0).toExponential(2)} max ${worst.toExponential(2)} · off (a path differs) ${off} (${(off / a.length).toExponential(2)})`
        + (off ? `: ${zero} land met by one only, ${big} more than 1 % apart, the rest a growth step's grid cell or direction; off rays' |Δ| median ${offRel[offRel.length >> 1].toExponential(2)} max ${offRel.at(-1).toExponential(2)}` : ''));
    return off <= TOL.pathShare * a.length;
};
check(compare(gruns[0].far, far, 'far field'), `far field within ${TOL.rel} relative, but ≤ ${TOL.pathShare} of the rays (their path differs)`);
check(compare(gruns[0].near, near, 'near field'), `near field within ${TOL.rel} relative, but ≤ ${TOL.pathShare} of the rays (their path differs)`);
check(gruns.every(r => same(r.far, gruns[0].far) && same(r.near, gruns[0].near)), `the waves repeat themselves to the bit (${REPS} runs)`);
device.destroy();
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
