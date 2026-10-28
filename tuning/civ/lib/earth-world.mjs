// Real Earth as a civ "world" — the same fields a finished moment gives the civ layer (v2/tools/civ-cradles.mjs worldOf),
// from observations, for the Earth test (plans/CIV_PLAN.md §6):
//   WorldClim 2.1 (Fick & Hijmans 2017; 1970–2000, 10′): monthly temperature and rain, elevation; its no-data is the sea
//   HydroRIVERS v1.0 (Lehner & Grill 2013): rivers with their long-term mean discharge — no monthly flows, so no regimes
//     (no flood-season bonus on Earth); far-fed from the land's own aridity, as finish-hydro.js decides it
//   USGS MRDS (2011): mapped mineral deposits, in place of the tectonic record's ores
//   ETOPO5 (NOAA NGDC 1988; 5′): the sea floor's depth — the shelves the glacial sea lays bare (Beringia, Sahul, Sunda)
//   NCEP/NCAR R1 winds and GODAS currents, by month (tuning/civ/fetch-flow.mjs): the travel graph's (w.flow), if fetched
// The Köppen class and the cell-stats measures are computed from the twelve months exactly as the climate does.
// Run tuning/civ/fetch-earth.sh first. Cached in tuning/civ/data/earth-<N>.bin.

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import Delaunator from 'delaunator';
import { fromArrayBuffer } from 'geotiff';
import * as shapefile from 'shapefile';
import { setDelaunator } from '../../../js/sphere-mesh.js';
import { buildSimMesh, meshFromArrays } from '../../../v2/js/core/sim-mesh.js';
import { classifyCell } from '../../../v2/js/climate/koppen.js';
import { cellStatsCollector, statValue } from '../../../v2/js/climate/cell-stats.js';
import { vectorCollector } from '../../../v2/js/civ/disease.js';
import { cropCollector, CROP_KEYS } from '../../../v2/js/civ/crops.js';
import { FINISH } from '../../../v2/js/finish/finish-config.js';
import { Res, COPPER } from '../../../v2/js/civ/resources.js';

setDelaunator(Delaunator);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const RAW = path.join(DIR, 'raw');
export const RIVER_MIN_M3S = 20;
const D = Math.PI / 180;

async function readTif(file) {
    const buf = fs.readFileSync(file), tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const img = await tiff.getImage(), [data] = await img.readRasters();
    return { w: img.getWidth(), h: img.getHeight(), data };
}

/** HydroRIVERS' reaches carrying ≥ RIVER_MIN_M3S, as points { lat, lon, q } (every vertex), cached. */
async function earthRivers() {
    const cache = path.join(DIR, `rivers-${RIVER_MIN_M3S}.bin`);
    if (fs.existsSync(cache)) return v8.deserialize(fs.readFileSync(cache));
    const shp = path.join(RAW, 'HydroRIVERS_v10_shp', 'HydroRIVERS_v10.shp');
    if (!fs.existsSync(shp)) throw new Error('unzip HydroRIVERS_v10_shp.zip in tuning/civ/data/raw/ first');
    const lat = [], lon = [], q = [];
    const src = await shapefile.open(shp, shp.replace(/\.shp$/, '.dbf'));
    let reaches = 0;
    for (;;) {
        const r = await src.read();
        if (r.done) break;
        const dis = r.value.properties.DIS_AV_CMS;
        if (!(dis >= RIVER_MIN_M3S)) continue;
        reaches++;
        for (const [x, y] of r.value.geometry.coordinates) { lat.push(y); lon.push(x); q.push(dis); }
    }
    const out = { lat: Float32Array.from(lat), lon: Float32Array.from(lon), q: Float32Array.from(q), reaches };
    fs.writeFileSync(cache, v8.serialize(out));
    return out;
}

/** MRDS deposits by commodity, as Res bits: [{ lat, lon, bits }]. Perlite and pumice stand for obsidian (volcanic glass). */
async function earthDeposits() {
    const file = path.join(RAW, 'mrds', 'mrds.csv'), out = [];
    const RULES = [[/copper/i, Res.COPPER_PORPHYRY], [/\btin\b/i, Res.TIN], [/gold/i, Res.GOLD], [/obsidian|perlite|pumice/i, Res.OBSIDIAN],
        [/asphalt|bitumen|tar sand/i, Res.BITUMEN], [/\bsalt\b|halite/i, Res.SALT]];
    const split = line => { const f = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { f.push(cur); cur = ''; } else cur += ch; } f.push(cur); return f; };
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    let head = null;
    for await (const line of rl) {
        const f = split(line);
        if (!head) { head = Object.fromEntries(f.map((k, i) => [k, i])); continue; }
        const la = +f[head.latitude], lo = +f[head.longitude], com = `${f[head.commod1]},${f[head.commod2]},${f[head.commod3]}`;
        if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
        let bits = 0;
        for (const [re, b] of RULES) if (re.test(com)) bits |= b;
        if (bits) out.push({ lat: la, lon: lo, bits });
    }
    return out;
}

/** The Earth world at N cells: { mesh, z, ocean, lake, koppen, tAnnual, pAnnual, stats, rivers, loess, erg, deposits }. */
/** Earth's monthly winds and currents (tuning/civ/fetch-flow.mjs), or null if not fetched. */
export function earthFlow() {
    const f = path.join(DIR, 'earth-flow.bin');
    return fs.existsSync(f) ? v8.deserialize(fs.readFileSync(f)) : null;
}

export async function earthWorld(N = 640000) {
    const cache = path.join(DIR, `earth-${Math.round(N / 1000)}k.bin`);
    if (fs.existsSync(cache)) {
        const w = v8.deserialize(fs.readFileSync(cache));
        if (CROP_KEYS.every(k => w.crops?.[k])) { w.mesh = meshFromArrays(w.mesh); w.flow = earthFlow(); return w; }   // (an older cache, without the crops' climate: built again)
    }
    const mesh = buildSimMesh(N, 12345), n = mesh.numCells, xyz = mesh.xyz;
    const wc = f => readTif(path.join(RAW, 'wc', f));
    const elev = await wc('wc2.1_10m_elev.tif'), T = [], P = [];
    for (let m = 1; m <= 12; m++) { T.push((await wc(`wc2.1_10m_tavg_${String(m).padStart(2, '0')}.tif`)).data); P.push((await wc(`wc2.1_10m_prec_${String(m).padStart(2, '0')}.tif`)).data); }
    const { w: GW, h: GH } = elev;
    // ETOPO5: 4320 × 2160 big-endian int16 metres, rows from 90° N, columns from 0° E
    const etopo = fs.readFileSync(path.join(RAW, 'etopo', 'ETOPO5.DAT'));
    const etopoAt = (la, lo) => { const r = Math.min(2159, Math.max(0, Math.round((90 - la) * 12))), q = Math.round(((lo + 360) % 360) * 12) % 4320; return etopo.readInt16BE(2 * (r * 4320 + q)); };
    const z = new Float32Array(n), ocean = new Uint8Array(n), lake = new Uint8Array(n), koppen = new Uint8Array(n);
    const tAnnual = new Float32Array(n).fill(NaN), pAnnual = new Float32Array(n).fill(NaN), lat = new Float32Array(n), lon = new Float32Array(n);
    const col = cellStatsCollector(n, c => lat[c] * D, { bytes: true }), vectors = vectorCollector(n), crops = cropCollector(n, c => lat[c] * D), T12 = new Float64Array(12), P12 = new Float64Array(12);
    for (let c = 0; c < n; c++) {
        const x = xyz[3 * c], y = xyz[3 * c + 1], zz = xyz[3 * c + 2];
        lat[c] = Math.asin(Math.max(-1, Math.min(1, zz))) / D; lon[c] = Math.atan2(y, x) / D;
        const i = Math.min(GW - 1, Math.floor((lon[c] + 180) / 360 * GW)), j = Math.min(GH - 1, Math.floor((90 - lat[c]) / 180 * GH)), k = j * GW + i;
        const e = elev.data[k];
        if (!(e > -1e4) || !(T[0][k] > -1e4)) { ocean[c] = 1; z[c] = Math.min(-0.001, etopoAt(lat[c], lon[c]) / 1000); continue; }
        z[c] = e / 1000;
        let ts = 0, ps = 0;
        for (let m = 0; m < 12; m++) { T12[m] = T[m][k]; P12[m] = P[m][k]; ts += T12[m]; ps += P12[m]; }
        tAnnual[c] = ts / 12; pAnnual[c] = ps;
        koppen[c] = classifyCell(T12, P12);
        col.add(c, T12, P12);
        vectors.add(c, T12, P12);
        crops.add(c, T12, P12);
    }
    // the rivers: far-fed where the land's own rain is under farFedAridity of its potential evaporation
    const Rv = await earthRivers(), farFed = new Uint8Array(Rv.q.length);
    for (let p = 0; p < Rv.q.length; p++) {
        const la = Rv.lat[p] * D, lo = Rv.lon[p] * D, c = mesh.index.nearest(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
        const a = statValue(col.stats.aridity, 'aridity', c);
        farFed[p] = a === a && a < FINISH.farFedAridity && Rv.q[p] >= 100 ? 1 : 0;
    }
    // the Last Glacial Maximum's ice sheets, roughly (Ehlers & Gibbard 2004, by eye): Laurentide and Cordilleran, the
    // Fennoscandian and British, Patagonia's, Greenland's and Antarctica's — Beringia and Siberia ice-free
    const ice = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
        const la = lat[c], lo = lon[c];
        if (la > 47 && lo > -137 && lo < -52 && !(la > 60 && lo < -138)) ice[c] = 1;                       // North America
        else if (la > 40 && lo > -95 && lo < -70) ice[c] = 1;                                               // the Laurentide's lobes
        else if (la > 60 && lo > -75 && lo < -10) ice[c] = 1;                                               // Greenland
        else if ((la > 54 && lo > -11 && lo < 3) || (la > 55 && lo >= 3 && lo < 60) || (la > 52 && lo > 5 && lo < 35)) ice[c] = 1; // Europe
        else if (la < -40 && lo > -76 && lo < -70) ice[c] = 1;                                              // Patagonia
        else if (la < -60) ice[c] = 1;
    }
    const w = { seed: 'earth', ice, mesh: { numCells: n, xyz, adjOffset: mesh.adjOffset, adjList: mesh.adjList }, z, ocean, lake, koppen, tAnnual, pAnnual,
        stats: col.stats, rivers: { lat: Rv.lat, lon: Rv.lon, q: Rv.q, regime: null, farFed }, loess: null, erg: null, vector: vectors.vector, crops: crops.crops, deposits: await earthDeposits() };
    fs.writeFileSync(cache, v8.serialize(w));
    w.mesh = meshFromArrays(w.mesh); w.flow = earthFlow();
    return w;
}

export { COPPER };
