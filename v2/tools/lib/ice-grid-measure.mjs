// The ice age's sheets measured for lane iceage's ice-grid study (2026-11-25: Jackson's "what does a finer ice grid buy?"):
// one world's glacialSheets answer (finish-ice.js) on the finish's mesh, as numbers two ice grids can be laid side by side on —
//   · the ice's area by region (60° of longitude × 10° bands of latitude) and its margin's position: the sheets' most
//     equatorward latitude in each 10° of longitude (the Laurentide's southern margin, ~39° N at 21 ka, is this number);
//   · the sheets (pieces ≥ ICE_SHEET_KM2: Benn & Evans) and the mountain ice caps (smaller pieces), their count and area, the
//     caps on high ground;
//   · the ice streams: connected cells sliding at STREAM_MA or more (ice streams flow at hundreds to thousands of m/a against
//     their sheet's few tens: Bennett 2003; Stokes & Clark 2001), their count, the outlets among them (those reaching the
//     margin), and their widths (area over length, the length the stream's longest span);
//   · the glaciated coast: ice cells beside the glacial sea's open water — their sliding speed's spread, what a trough's
//     erosion would read (B3);
//   · the time the sheets took.
// Shared by render-moment --ice-measure (a sim world's moment) and ice-grid-earth.mjs (Earth): both print the same lines.

export const STREAM_MA = 100, ICE_SHEET_KM2 = 5e4;

const q = (a, p) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/**
 * @param {{ mesh, z: Float32Array (km, the ground as the ice stood on it), sheet: glacialSheets' answer, iceMeshCells: number,
 *   label: string, log?: (s: string) => void }} o
 * @returns {Object} the numbers, as printed
 */
export function measureIceGrid({ mesh, z, sheet, iceMeshCells, label, log = console.log }) {
    const n = mesh.numCells, { adjOffset, adjList, xyz } = mesh, R = 6371, cellKm2 = 4 * Math.PI * R * R / n, sea = sheet.seaKm;
    const ice = sheet.ice, u = sheet.uSlide, lat = new Float32Array(n), lon = new Float32Array(n);
    for (let c = 0; c < n; c++) { lat[c] = Math.asin(xyz[3 * c + 2]) * 180 / Math.PI; lon[c] = Math.atan2(xyz[3 * c + 1], xyz[3 * c]) * 180 / Math.PI; }
    const water = c => !ice[c] && z[c] < sea;
    // (the ice's connected pieces)
    const piece = new Int32Array(n).fill(-1), pieces = [];
    for (let c = 0; c < n; c++) {
        if (!ice[c] || piece[c] >= 0) continue;
        const id = pieces.length, st = [c]; piece[c] = id; let cells = 0, hi = 0;
        while (st.length) { const a = st.pop(); cells++; hi += z[a] > 1 ? 1 : 0; for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) { const b = adjList[k]; if (ice[b] && piece[b] < 0) { piece[b] = id; st.push(b); } } }
        pieces.push({ km2: cells * cellKm2, high: hi / cells });
    }
    const sheetOf = c => pieces[piece[c]].km2 >= ICE_SHEET_KM2;
    const sheets = pieces.filter(p => p.km2 >= ICE_SHEET_KM2), caps = pieces.filter(p => p.km2 < ICE_SHEET_KM2);
    // (area by region; the margin by 10° of longitude)
    const area = new Map(), marginN = new Float32Array(36).fill(NaN), marginS = new Float32Array(36).fill(NaN);
    let total = 0;
    for (let c = 0; c < n; c++) {
        if (!ice[c]) continue;
        total += cellKm2;
        const key = `${Math.floor((lon[c] + 180) / 60) * 60 - 180}E ${lat[c] >= 0 ? Math.floor(lat[c] / 10) * 10 + 'N' : Math.floor(-lat[c] / 10) * 10 + 'S'}`;
        area.set(key, (area.get(key) ?? 0) + cellKm2);
        if (!sheetOf(c)) continue;
        const s = Math.min(35, Math.floor((lon[c] + 180) / 10));
        if (lat[c] >= 0) { if (!(marginN[s] <= lat[c])) marginN[s] = lat[c]; } else if (!(marginS[s] >= lat[c])) marginS[s] = lat[c];
    }
    // (the ice streams: connected sliding cells at STREAM_MA or more)
    const seen = new Uint8Array(n), streams = [];
    for (let c = 0; c < n; c++) {
        if (!ice[c] || !(u[c] >= STREAM_MA) || seen[c]) continue;
        const st = [c], cells = []; seen[c] = 1; let outlet = false;
        while (st.length) {
            const a = st.pop(); cells.push(a);
            for (let k = adjOffset[a]; k < adjOffset[a + 1]; k++) {
                const b = adjList[k];
                if (!ice[b]) outlet = true;
                else if (u[b] >= STREAM_MA && !seen[b]) { seen[b] = 1; st.push(b); }
            }
        }
        // (its length: the longest span, from its farthest cell from the first, then the farthest from that — exact on a path)
        const far = from => { let best = from, bd = -1; for (const a of cells) { const d = xyz[3 * a] * xyz[3 * from] + xyz[3 * a + 1] * xyz[3 * from + 1] + xyz[3 * a + 2] * xyz[3 * from + 2]; const ang = Math.acos(Math.min(1, d)); if (ang > bd) { bd = ang; best = a; } } return [best, bd * R]; };
        const [e1] = far(cells[0]), [, len] = far(e1), km2 = cells.length * cellKm2, lenKm = Math.max(len, Math.sqrt(cellKm2));
        let umax = 0; for (const a of cells) umax = Math.max(umax, u[a]);
        streams.push({ km2, lenKm, widthKm: km2 / lenKm, outlet, umax, lat: lat[cells[0]], lon: lon[cells[0]] });
    }
    // (the glaciated coast: ice beside the glacial sea's open water)
    const coastU = [];
    for (let c = 0; c < n; c++) {
        if (!ice[c]) continue;
        let w = false; for (let k = adjOffset[c]; k < adjOffset[c + 1] && !w; k++) w = water(adjList[k]);
        if (w) coastU.push(u[c]);
    }
    const sliding = coastU.filter(v => v > 0).length, fast = coastU.filter(v => v >= STREAM_MA).length;
    const outlets = streams.filter(s => s.outlet), widths = streams.map(s => s.widthKm);
    const iceEdgeKm = Math.sqrt(4 * Math.PI * R * R / iceMeshCells * 2 / Math.sqrt(3));
    const out = {
        label, iceMeshCells, iceEdgeKm, finishCells: n, ms: sheet.ms, rounds: sheet.rounds.map(r => ({ epochKyr: r.epochKyr, kyr: r.kyr, steps: r.steps, ms: r.ms, iceMkm2: r.iceMkm2, seaM: r.seaM })), maxKyr: sheet.maxKyr ?? null, cost: sheet.cost ?? null, seaM: 1000 * sea,
        iceMkm2: total / 1e6, sheets: sheets.length, sheetMkm2: sheets.reduce((s, p) => s + p.km2, 0) / 1e6,
        caps: caps.length, capKm2: caps.reduce((s, p) => s + p.km2, 0), capsHigh: caps.filter(p => p.high > 0.5).length,
        streams: streams.length, outlets: outlets.length, widthKm: { p10: q(widths, 0.1), median: q(widths, 0.5), p90: q(widths, 0.9), max: Math.max(0, ...widths) },
        coast: { cells: coastU.length, sliding: sliding / Math.max(1, coastU.length), fast: fast / Math.max(1, coastU.length), median: q(coastU, 0.5), p90: q(coastU, 0.9), max: Math.max(0, ...coastU) },
        area: Object.fromEntries([...area].sort().map(([k, v]) => [k, Math.round(v / 1e3)])),
        marginN: Array.from(marginN, v => v === v ? Math.round(v * 10) / 10 : null), marginS: Array.from(marginS, v => v === v ? Math.round(v * 10) / 10 : null),
    };
    log(`\n── ice grid: ${label} — ice mesh ${iceMeshCells.toLocaleString()} cells (~${iceEdgeKm.toFixed(0)} km), finish mesh ${n.toLocaleString()} ──`);
    // (the cycle, cycledIce: its cost, its largest ice's epoch, and the ice every 10 kyr)
    if (sheet.cost) log(`time: ${(sheet.ms / 1000).toFixed(1)} s (climate ${(sheet.cost.climateMs / 1000).toFixed(1)} s, ${sheet.cost.solves} solves; ice ${(sheet.cost.iceMs / 1000).toFixed(1)} s); the cycle's largest ice at ${sheet.maxKyr} ka; made ${sheet.cost.madeKm3.toExponential(1)} km³, ${sheet.cost.retries} batches halved; ka: ${sheet.rounds.filter(r => Math.abs(r.epochKyr / 10 - Math.round(r.epochKyr / 10)) < 1e-6).map(r => `${r.epochKyr} ${r.iceMkm2.toFixed(1)} Mkm² ${r.seaM.toFixed(0)} m`).join(' · ')}`);
    else log(`time: ${(sheet.ms / 1000).toFixed(1)} s; rounds ${out.rounds.map(r => `${r.kyr} kyr ${r.steps} steps ${(r.ms / 1000).toFixed(1)} s ${r.iceMkm2.toFixed(1)} Mkm² sea ${r.seaM.toFixed(0)} m${r.change < Infinity ? ` Δvol ${(100 * r.change).toFixed(1)} %` : ""}`).join(' · ')}`);
    log(`ice ${out.iceMkm2.toFixed(2)} Mkm²: ${out.sheets} sheets ${out.sheetMkm2.toFixed(2)} Mkm²; ${out.caps} mountain caps ${(out.capKm2 / 1e3).toFixed(0)}k km² (${out.capsHigh} mostly above 1 km)`);
    log(`ice streams (≥ ${STREAM_MA} m/a sliding): ${out.streams}, ${out.outlets} reaching the margin; width p10/median/p90/max ${[out.widthKm.p10, out.widthKm.median, out.widthKm.p90, out.widthKm.max].map(v => v.toFixed(0)).join('/')} km`);
    log(`glaciated coast: ${out.coast.cells} cells, ${(100 * out.coast.sliding).toFixed(0)} % sliding, ${(100 * out.coast.fast).toFixed(0)} % ≥ ${STREAM_MA} m/a; sliding median/p90/max ${[out.coast.median, out.coast.p90, out.coast.max].map(v => v.toFixed(0)).join('/')} m/a`);
    log(`area by region (k km²): ${Object.entries(out.area).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    log(`margin N by 10° lon from 180W (most equatorward sheet ice, °): ${out.marginN.map(v => v ?? '–').join(' ')}`);
    log(`margin S by 10° lon from 180W: ${out.marginS.map(v => v ?? '–').join(' ')}`);
    log(`REPORT_JSON ${JSON.stringify({ iceGrid: out })}`);
    return out;
}
