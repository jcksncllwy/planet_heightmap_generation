// Reads a fixture saved by gpu-capture.mjs: a run's mesh, fields and settings, and rebuilds its closed-basin judge.
import fs from 'node:fs';
import path from 'node:path';
import { closedBasins } from '../js/finish/finish-basins.js';

const TYPES = { Int32Array, Uint32Array, Float32Array, Float64Array, Uint8Array };
const read = (file, T) => { const b = fs.readFileSync(file); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };

export function loadRun(dir, id) {
    const R = JSON.parse(fs.readFileSync(path.join(dir, `run${id}`, 'run.json'))), run = path.join(dir, `run${id}`), m = path.join(dir, `mesh${R.n}`);
    const J = JSON.parse(fs.readFileSync(path.join(m, 'mesh.json'))), mesh = { numCells: J.numCells, edgeKm: J.edgeKm, adjOffset: read(path.join(m, 'adjOffset.bin'), TYPES[J.offType]), adjList: read(path.join(m, 'adjList.bin'), TYPES[J.adjType]), xyz: read(path.join(m, 'xyz.bin'), TYPES[J.xyzType]) };
    const f32 = k => read(path.join(run, k + '.bin'), Float32Array), u8 = k => read(path.join(run, k + '.bin'), Uint8Array);
    const C = JSON.parse(fs.readFileSync(path.join(run, 'closed.json'))), runoff = f32('runoff'), pet = f32('pet'), rain = f32('rain'), sea = u8('closedOcean');
    const o = { mesh, z: f32('z'), ocean: u8('ocean'), water: f32('water'), k: f32('k'), hold: f32('hold'), slow: R.slow ? f32('slow') : null, m: R.m, activeHold: R.activeHold, valleyKm: R.valleyKm, closed: g => closedBasins(mesh, g, runoff, pet, rain, C.cellKm2, C.F, sea) };
    return { o, P: R.P, meta: R };
}
