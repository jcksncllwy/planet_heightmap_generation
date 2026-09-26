// Lab phase 8a — the tectonic surface: heights built from the history's records, before rivers carve them — and the
// machinery of every terrain phase (terrainPhase): 8b (phase8b-rivers.js) is the same surface, carved by rivers.
// Drawn on a terrain mesh finer than the sim mesh (160K / 640K / 2.5M cells), shaded so ridges read at planet scale.
// The history runs in a worker (the page stays responsive, and shows how far it has got); terrain is built on a pool
// of workers (terrain/terrain-pool.js) for whichever frame is shown — prepare(frame), awaited by the shell — and then,
// while the page is idle, for every other frame ahead of time (heights only, within a memory budget), so playing and
// scrubbing need no building. Built terrain outlives a rebuild of the phase: a display-only setting re-shades it.
// Without workers (Node: the check scripts) everything runs right here, with the same results.

import { TERRAIN_SCENES } from '../../tectonics/scenarios/terrain-scenes.js';
import { CrustType } from '../../tectonics/model/crust.js';
import { terrainMeshAsync, sampleOnto } from '../../terrain/terrain-mesh.js';
import { TerrainPool } from '../../terrain/terrain-pool.js';
import { runHistory } from '../history-runner.js';
import { synthesizeTerrain, hypsometry } from '../../terrain/synthesize.js';
import { terrainConfig } from '../../terrain/terrain-config.js';
import { kindType, deriveRecords } from '../../terrain/records.js';
import { locate } from '../../core/mesh-locate.js';
import { hillshade, paintRelief, tintOf } from '../../view/terrain-shade.js';
import { colorByCrustType, colorByOrogeny, OROGENY_RGB, css } from '../../view/palettes.js';
import { describeCell, recordedFrameAt, latLonOf, orogenyLegend } from './phase-kit.js';

const RESOLUTIONS = [
    { value: '160000', label: '160K cells · 61 km (quick)' },
    { value: '640000', label: '640K cells · 30 km' },
    { value: '2500000', label: '2.5M cells · 15 km (slow)' },
];
const DEFAULT_CELLS = 640000;
// display settings (no re-synthesis) and terrain constants (terrain-config.js) the lab can change
const VIEW_TUNABLES = [
    { id: 'exaggeration', label: 'Hillshade: slope exaggeration (display only)', min: 5, max: 60, step: 5, value: 20 },
    { id: 'seaLevelKm', label: 'Sea level', min: -0.6, max: 0.6, step: 0.05, unit: ' km', value: 0 },
];
const TERRAIN_TUNABLES = [
    { id: 'stripeShare', label: 'Parallel ridges: share of the belt’s own uplift', min: 0, max: 0.5, step: 0.02 },
    { id: 'ridgeNoiseShare', label: 'Ridge noise along the ranges: share of the belt’s uplift', min: 0, max: 0.5, step: 0.02 },
    { id: 'ridgeNoiseStretch', label: 'Ridge noise: times longer along the range than across', min: 1, max: 16, step: 1 },
    { id: 'detailRenewMyr', label: 'Fine detail slowly renews over (0 = frozen on the crust)', min: 0, max: 500, step: 10, unit: ' Myr' },
    { id: 'baseReliefKm', label: 'Swells of the first continents (re-runs the history)', min: 0, max: 2, step: 0.1, unit: ' km', evolves: true },
    { id: 'lipWearKmPerMyr', label: 'Flood basalts wear down (re-runs the history)', min: 0, max: 0.02, step: 0.001, unit: ' km/Myr', evolves: true },
    { id: 'dykeKm', label: 'Radiating dykes around flood basalts: height of their grain', min: 0, max: 0.3, step: 0.01, unit: ' km' },
    { id: 'reliefTauMyr', label: 'Uplift wears away over (re-runs the history)', min: 30, max: 400, step: 1, unit: ' Myr', evolves: true },
    { id: 'thickTauMyr', label: 'A thickened root rebounds away over (re-runs the history)', min: 30, max: 400, step: 1, unit: ' Myr', evolves: true },
    { id: 'ruggedTauMyr', label: 'Crests and ridges wear away over (re-runs the history)', min: 50, max: 800, step: 1, unit: ' Myr', evolves: true },
    { id: 'coastNoiseKm', label: 'Coastline irregularity', min: 0, max: 120, step: 5, unit: ' km' },
    { id: 'rainErosionExponent', label: 'Erosion follows rainfall by latitude, 0 = everywhere alike (re-runs the history)', min: 0, max: 1.5, step: 0.1, evolves: true },
];
const CHECKLISTS = {
    andes: [
        'Along the leading (western) coast, from the sea inland: a trench with a low outer rise beyond it, a narrow shelf, a coastal range, a valley behind it, then the main range with volcanoes — the highest ground — and further inland fold ridges running PARALLEL to the coast (Ridges only layer; Belts layer shows the ridge directions).',
        'The trailing coast behind has a wide shelf and a low coastal plain. Use the Cross-section tool across the margin to see the profile.',
    ],
    laramide: ['The belt reaches far inland: a high interior with blocky ranges and a front range bracketing it on the inland side, and no volcanoes over the flat slab.'],
    india: [
        'Across the suture (Cross-section tool, drawn from India into Asia): India’s lowland, a foreland basin, fold hills, the highest range just off the suture; then on Asia’s side a plateau with low internal ridges, a back range, and a fall line to the lowland beyond.',
        'Heights evolve: the plates welded near 48 Myr and the belt has worn in the tropics since — scrub back toward the weld to see the plateau at its highest, then watch it wear down (2–4 km by the end).',
        'Ridges run parallel to the suture on both sides.',
    ],
    mariana: ['A chain of small volcanic islands on a submarine ridge, the trench in front of it (7–11 km deep), a young, shallower back-arc basin behind it.'],
    japan: ['The strip that rifted off is a mountainous island arc with volcanoes; the back-arc sea behind it is young ocean floor, shallower than the old ocean.'],
    hawaii: ['Near the plume the volcanoes stand as islands; downstream they are worn down and sink with the aging floor: seamounts in a line along the plate’s motion.'],
    traps: [
        'Scrub from the eruption (12 Myr) on: a young province is a plateau with a lobed edge; with time its cap is cut away — first at its edge (an escarpment retreating inward) and where it is weakest — leaving flat-topped mesas, then buttes, then scattered remnants.',
        'Hillshade: around the province, and on it where it has worn away, a faint grain of dykes radiating from the plume’s centre, out to about twice the province’s radius.',
    ],
    rift: ['The new coasts are lifted into shoulders — an escarpment facing the young ocean, sloping gently inland. The arm that failed is a low corridor into the continent. The young ocean has a ridge along its middle.'],
    history: [
        'Young belts stand high and sharp; old belts are low but keep their grain of parallel ridges; cratons are flat and low; about half the land is lowland.',
        'Ridges only layer: besides the parallel ridges, long highs and lows drawn out along every range (ridge noise), bending with the belt’s front.',
        'Go back to the start: the first continents have broad swells with lowlands between them; the rivers gather in the lowlands, and the swells wear down as the history runs.',
        'Heights accumulate: where a new belt overprints an old one the old relief is not erased, and a belt that drifted through the wet tropics is lower than one of the same age at the dry subtropics (Erosion rate layer).',
        'Passive margins have wide shelves, active margins narrow ones; mid-ocean ridges stand ~2.5 km deep, old floor 5–6 km, trenches deeper still.',
        'Switch the terrain resolution: the same planet at every resolution — only finer detail (the parallel ridges appear from 640K up).',
        'Scrub through the history: a drifting continent carries its fine detail with it — its coastline, its shelves, the edges of its belts, its ridges, its volcanoes, the grain of its plains — changing only where the history changes it (Phase 9: the terrain is read on each plate’s own crust), and, slowly, as its fine detail renews: over a few hundred Myr its bays and headlands and the grain of its ridges re-form (the “Fine detail slowly renews” slider; 0 freezes it).',
    ],
};

/** Colour of an erosion factor: brown where things erode slowly, through pale, to blue where fast. */
function erosionRgb(e) {
    const t = Math.max(0, Math.min(1, (e - 0.8) / 1.0));
    return t < 0.25 ? [176, 134, 84].map((c, i) => c + ([226, 220, 196][i] - c) * t / 0.25) : [226, 220, 196].map((c, i) => c + ([46, 104, 196][i] - c) * (t - 0.25) / 0.75);
}

// The last history simulated (per scene and seed), so changing a terrain setting does not re-run it.
let simCache = null;
// One worker pool for the page (browser only: in Node the checks synthesize in place)
let poolPromise = null;
const usePool = typeof window !== 'undefined' && typeof Worker !== 'undefined';
// Terrain built so far, for one history, resolution and set of terrain settings — kept across rebuilds of the phase:
// every frame's heights (16-bit metres), within BUDGET bytes, and the full result (components, records) of the last few
let store = null;
let prefetchToken = 0;             // (a rebuilt phase takes over the building ahead)
const smallDevice = typeof navigator !== 'undefined' && ((navigator.deviceMemory ?? 8) <= 4 || !!globalThis.matchMedia?.('(pointer: coarse)').matches);
const BUDGET = smallDevice ? 64e6 : 320e6;

/** Phase 8a: the tectonic surface. */
export const createPhase = terrainPhase({
    id: '8a',
    title: 'Phase 8a — Tectonic surface',
    summary: 'Heights built during the history and eroded as it runs (by the rainfall of the latitude each piece of crust was at), drawn before rivers carve them (Phase 8b): the sea floor from crust age, with trenches and abyssal hills; continents on an isostatic platform with shelves by kind of margin; and mountain belts laid out across their width by kind of belt and side of the collision — crests, valleys, plateaus and basins where WBP’s range geometries put them — with ridges running parallel to each belt’s front, in staggered segments where the plates met obliquely. Drawn on a terrain mesh finer than the sim mesh, the same planet at any resolution. ',
    checklists: CHECKLISTS,
    checkCommand: 'node v2/tools/check-phase8a.mjs',
    lowlandNote: 'of land below 400 m (Earth ≈ half; rivers lower it in 8b)',
});

/**
 * A terrain lab phase: the history (in a worker), and terrain for its frames on a pool of workers, built ahead.
 * spec: { id, title, summary, checklists (per scene), checkCommand, lowlandNote, carve?: rivers carve the surface,
 * tunables?: extra terrain constants, extraLayers?: (ctx) => layers, extraLegend?: [] }
 */
export function terrainPhase(spec) {
    return async function createPhase(simMesh, seed, overrides = {}, hooks = {}) {
    const scene = TERRAIN_SCENES.find(s => s.id === overrides.scene) ?? TERRAIN_SCENES[0];
    const TUNABLES = [...TERRAIN_TUNABLES, ...(spec.tunables ?? [])], carve = !!spec.carve;
    const cells = RESOLUTIONS.some(r => Number(r.value) === Number(overrides.cells)) ? Number(overrides.cells) : DEFAULT_CELLS;
    const snapshotMyr = scene.maxMyr > 200 ? 10 : 2;
    // the height constants the history evolves its heights with (the history itself is the same whatever they are)
    const heights = Object.fromEntries(TUNABLES.filter(t => t.evolves && overrides[t.id] !== undefined).map(t => [t.id, overrides[t.id]]));
    const key = `${scene.id}|${seed}|${simMesh.numCells}|${JSON.stringify(heights)}`;
    const meshReady = terrainMeshAsync(cells);                 // (built in a worker, alongside the history)
    if (simCache?.key !== key) {
        const started = performance.now();
        const { frames, steps } = await runHistory({ list: 'terrain', scene, heights }, simMesh, seed, snapshotMyr,
            t => hooks.progress?.(`Simulating the history… ${t.toFixed(0)} of ${scene.maxMyr} Myr`));
        simCache = { key, frames, steps, simMs: performance.now() - started };
    }
    hooks.progress?.('Building terrain…');
    const { frames, steps, simMs } = simCache;
    const view = Object.fromEntries(VIEW_TUNABLES.map(t => [t.id, overrides[t.id] ?? t.value]));
    const cfgOverrides = Object.fromEntries(TUNABLES.filter(t => overrides[t.id] !== undefined).map(t => [t.id, overrides[t.id]]));
    const cfg = terrainConfig(cfgOverrides);
    const tMesh = await meshReady;

    // ── terrain per frame ── The frame the shell asks for is built on the pool (prepare); then, while the page is idle,
    // the others, nearest first — heights only — as far as the budget allows. The store outlives this phase object: a
    // display-only setting (sea level, hillshade) makes a new phase that finds everything built and only re-shades.
    // (a carving phase shows a frame's surface at once and its carved terrain when that is ready; it keeps only
    // carved heights for the frames built ahead)
    const storeKey = `${spec.id}|${key}|${cells}|${JSON.stringify(cfgOverrides)}`;
    if (store?.key !== storeKey) store = { key: storeKey, sampler: null, full: new Map(), heights: new Map(), bytes: 0, carving: new Map() };
    const S = store, shown = new Map(), token = ++prefetchToken, index = new Map(frames.map((f, i) => [f, i]));
    let current = frames.length - 1, poolReady = null, prefetching = false;
    // a frame ready to paint: its heights, shaded for this view; its records only when a layer asks for them
    const keep = (frame, r) => {
        const shade = hillshade(tMesh, r.heightKm, { exaggeration: view.exaggeration, seaLevelKm: view.seaLevelKm });
        let rec = r.rec ?? null;
        const out = { heightKm: r.heightKm, parts: r.parts, sampler: r.sampler ?? S.sampler, ms: r.ms, kernels: r.kernels, volcanoes: r.volcanoes,
            tectonicKm: r.tectonicKm ?? null, drainage: r.drainage ?? null, carved: !carve || r.carved !== false,
            shade, hyps: hypsometry(r.heightKm, view.seaLevelKm), get rec() { return rec ??= deriveRecords(frame, simMesh, cfg, seed); } };
        shown.set(frame, out);
        if (shown.size > 4) shown.delete(shown.keys().next().value);
        return out;
    };
    const storeHeights = (frame, r) => {
        if (S.heights.has(frame)) return;
        const q = new Int16Array(r.heightKm.length);
        for (let i = 0; i < q.length; i++) q[i] = Math.round(r.heightKm[i] * 1000);
        S.heights.set(frame, { q, ms: r.ms, kernels: r.kernels, volcanoes: r.volcanoes });
        S.bytes += q.byteLength;
        // over budget: drop the frames farthest from the one on screen
        while (S.bytes > BUDGET && S.heights.size > 1) {
            let far = null, d = -1;
            for (const g of S.heights.keys()) { const dd = Math.abs((index.get(g) ?? 0) - current); if (dd > d) { d = dd; far = g; } }
            S.bytes -= S.heights.get(far).q.byteLength; S.heights.delete(far);
        }
    };
    const remember = (frame, r) => {
        S.sampler ??= r.sampler;
        S.full.set(frame, r);
        if (S.full.size > 4) S.full.delete(S.full.keys().next().value);
        if (r.carved !== false) storeHeights(frame, r);
    };
    const fromHeights = frame => {
        const s = S.heights.get(frame);
        if (!s) return null;
        const heightKm = new Float32Array(s.q.length);
        for (let i = 0; i < heightKm.length; i++) heightKm[i] = s.q[i] / 1000;
        return { heightKm, parts: null, rec: null, sampler: S.sampler, ms: s.ms, kernels: s.kernels, volcanoes: s.volcanoes };
    };
    function terrainOf(frame) {
        current = index.get(frame) ?? current;
        const s = shown.get(frame), full = S.full.get(frame);
        if (s && (s.parts || !full) && (s.carved || !full?.carved)) return s;
        const r = S.full.get(frame) ?? fromHeights(frame);
        if (r) { if (poolReady) prefetch(poolReady); return keep(frame, r); }
        S.sampler ??= sampleOnto(simMesh, tMesh, cfg, seed);                // (in place: Node, or a layer that asked before prepare)
        const T = synthesizeTerrain(frame, simMesh, tMesh, { cfg, seed, sampler: S.sampler, parts: true, carve });
        remember(frame, T);
        return keep(frame, T);
    }
    // ready to paint: heights for most layers; the components too for a layer that needs them (Ridges only); the
    // carving too for one that shows it (Carving depth, Drainage, the surface before carving)
    const isReady = (frame, layer) => !usePool || (layer?.needsCarving ? !!S.full.get(frame)?.drainage
        : layer?.needsParts ? S.full.has(frame) : S.full.has(frame) || S.heights.has(frame));
    async function prepare(frame, layer) {
        current = index.get(frame) ?? current;
        if (!usePool) return;
        const pool = poolReady ??= await (poolPromise ??= TerrainPool.create(simMesh));
        if (!isReady(frame, layer)) {
            const full = S.full.get(frame);
            if (!full || !(layer?.needsParts || layer?.needsCarving) || full.parts) {
                // the surface; a carving phase shows it until its carving is ready (on the carving worker)
                const surf = full ?? await pool.synthesize(frame, tMesh, { cfg, seed, parts: true, carveInputs: carve });
                if (!carve) remember(frame, surf);
                else {
                    if (!full) remember(frame, { ...surf, tectonicKm: surf.heightKm, carved: false });
                    const carving = carveShown(pool, frame, surf);
                    if (layer?.needsCarving) await carving;
                }
            }
        }
        prefetch(pool);
    }
    // carve the frame on screen, and paint it again when done
    function carveShown(pool, frame, surf) {
        if (S.full.get(frame)?.drainage) return Promise.resolve();
        if (S.carving.has(frame)) return S.carving.get(frame);
        const job = pool.carve(tMesh, surf, cfg).then(C => {
            if (store !== S) return;
            remember(frame, { ...surf, heightKm: C.z, tectonicKm: surf.heightKm, drainage: C.area, carved: true, ms: { ...surf.ms, carve: C.ms } });
            shown.delete(frame);
            hooks.repaint?.();
        }).finally(() => S.carving.delete(frame));
        S.carving.set(frame, job);
        return job;
    }
    // building ahead, one frame at a time (a frame the shell asks for waits at most for the one in hand): the nearest to
    // the frame on screen that is not built yet, among as many as the budget holds
    async function prefetch(pool) {
        if (prefetching) return;
        prefetching = true;
        let carvingAhead = null;
        try {
            for (;;) {
                if (token !== prefetchToken || store !== S) return;                  // (the phase was rebuilt: its successor carries on)
                const room = Math.max(4, Math.floor(BUDGET / (2 * tMesh.numCells)));
                const next = frames.map((_, i) => i).sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || a - b)
                    .slice(0, room).find(i => !S.heights.has(frames[i]) && !S.carving.has(frames[i]));
                if (next === undefined) break;
                const frame = frames[next];
                const r = await pool.synthesize(frame, tMesh, { cfg, seed, parts: false, records: false, carveInputs: carve });
                if (token !== prefetchToken || store !== S) return;
                S.sampler ??= r.sampler;
                if (!carve) { storeHeights(frame, r); continue; }
                // (carved on the carving worker while the next frame's surface is built)
                await carvingAhead;
                if (token !== prefetchToken || store !== S) return;
                carvingAhead = pool.carve(tMesh, r, cfg).then(C => { if (store === S) storeHeights(frame, { ...r, heightKm: C.z }); })
                    .catch(() => {}).finally(() => S.carving.delete(frame));
                S.carving.set(frame, carvingAhead);
            }
            await carvingAhead;
        } catch { /* building ahead is only a convenience: frames are built when asked for */ } finally { prefetching = false; }
    }
    // a sim-cell layer (crust type, orogeny) carried onto the terrain mesh, shaded by the relief
    const simRgb = new Uint8Array(simMesh.numCells * 3);
    const simLayer = paintSim => (frame, out) => {
        const T = terrainOf(frame), { cells: sc, weights: sw } = T.sampler;
        paintSim(frame, simRgb);
        for (let t = 0; t < tMesh.numCells; t++) {
            const k = 0.45 + 0.55 * T.shade[t];
            for (let ch = 0; ch < 3; ch++) out[3 * t + ch] = Math.min(255, k * (sw[3 * t] * simRgb[3 * sc[3 * t] + ch] + sw[3 * t + 1] * simRgb[3 * sc[3 * t + 1] + ch] + sw[3 * t + 2] * simRgb[3 * sc[3 * t + 2] + ch]));
        }
    };

    const layers = [
        { label: 'Terrain', paint(frame, out) { const T = terrainOf(frame); paintRelief(T.heightKm, T.shade, out, { seaLevelKm: view.seaLevelKm }); } },
        { label: 'Hillshade', paint(frame, out) { const T = terrainOf(frame); paintRelief(T.heightKm, T.shade, out, { mode: 'shade' }); } },
        {
            label: 'Belts', paint: simLayer(colorByOrogeny),
            // ridge directions: a tick along the strike at every belt cell, as the stripes are laid out
            overlay(g, raster, frame) {
                const { rec } = terrainOf(frame), { xyz } = simMesh, L = 55 / 6371;
                g.save(); g.lineWidth = 1.6;
                for (let w = 0; w < simMesh.numCells; w++) {
                    const ax = rec.across[3 * w], ay = rec.across[3 * w + 1], az = rec.across[3 * w + 2];
                    if (!rec.kind[w] || !(ax || ay || az) || rec.reliefKm[w] < 0.05) continue;
                    const x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2];
                    const sx = y * az - z * ay, sy = z * ax - x * az, sz = x * ay - y * ax;      // strike = p × across
                    const [x0, y0] = raster.project(x - L * sx, y - L * sy, z - L * sz), [x1, y1] = raster.project(x + L * sx, y + L * sy, z + L * sz);
                    if (Math.abs(x1 - x0) > raster.width / 2) continue;
                    g.strokeStyle = '#101010';
                    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
                }
                g.restore();
            },
        },
        {
            label: 'Ridges only', needsParts: true, paint(frame, out) {
                const T = terrainOf(frame), s = T.parts.stripes;
                for (let t = 0; t < tMesh.numCells; t++) {
                    const v = Math.max(-1, Math.min(1, s[t] / 0.5)), k = 0.55 + 0.45 * T.shade[t];
                    out[3 * t] = Math.min(255, k * (v > 0 ? 255 : 255 * (1 + v))); out[3 * t + 1] = Math.min(255, k * 255 * (1 - Math.abs(v))); out[3 * t + 2] = Math.min(255, k * (v < 0 ? 255 : 255 * (1 - v)));
                }
            },
        },
        ...(spec.extraLayers?.({ terrainOf, tMesh, view }) ?? []),
        { label: 'Crust type', paint: simLayer(colorByCrustType) },
        {
            // how fast things erode, by the latitude's estimated rainfall (and ice, poleward): brown slow, blue fast
            label: 'Erosion rate', paint: simLayer((frame, out) => {
                const e = terrainOf(frame).rec.erosion;
                for (let w = 0; w < e.length; w++) { const c = erosionRgb(e[w]); out[3 * w] = c[0]; out[3 * w + 1] = c[1]; out[3 * w + 2] = c[2]; }
            }),
        },
    ];

    const centre = (frames[0].plates.find(p => !p.isBackground) ?? frames[0].plates[0]).centre;
    const km = v => `${Math.round(v * 1000).toLocaleString()} m`;
    return {
        title: spec.title,
        summary: spec.summary + scene.about,
        checklist: [...spec.checklists[scene.id], 'Terrain is built for the frame shown, then for every other frame in the background: once they are built, scrubbing and playing need no waiting, and sea level or hillshade changes only re-shade.'],
        checkCommand: spec.checkCommand,
        maxTime: scene.maxMyr,
        timeStep: snapshotMyr,
        initialTime: scene.maxMyr,
        initialView: scene.focus?.(frames.at(-1), simMesh) ?? scene.view ?? latLonOf(centre),
        displayMesh: tMesh,
        params: [
            { id: 'scene', label: 'Scene', value: scene.id, options: TERRAIN_SCENES.map(s => ({ value: s.id, label: s.label })) },
            { id: 'cells', label: 'Terrain resolution', value: String(cells), options: RESOLUTIONS, keepView: true },
            ...VIEW_TUNABLES.map(t => ({ ...t, value: view[t.id] })),
            ...TUNABLES.map(t => ({ ...t, value: cfg[t.id] })),
        ],
        layers,
        hasBoundaries: false,
        legend: [
            ...[[-6, 'abyssal plain (−6 km)'], [-2.5, 'mid-ocean ridge (−2.5 km)'], [-0.1, 'continental shelf'], [0.15, 'lowland'], [1, 'upland (1 km)'], [2.5, 'mountains (2.5 km)'], [4, 'high mountains / plateau (4 km)'], [6, 'peaks (6 km)']]
                .map(([h, label]) => ({ color: css(tintOf(h)), label })),
            ...orogenyLegend(undefined, ' (Belts layer; ticks: ridge direction)'),
            ...[[0.9, 'erosion ×0.9 — dry subtropics (Erosion rate layer)'], [1.05, 'erosion ×1.05 — storm tracks, and ice toward the poles'], [1.28, 'erosion ×1.3 — the wet equator']]
                .map(([e, label]) => ({ color: css(erosionRgb(e)), label })),
            ...(spec.extraLegend ?? []),
        ],

        frameAt(t) { return recordedFrameAt(frames, t); },
        prepare,
        isReady,

        stats(frame) {
            const T = terrainOf(frame), hy = T.hyps, [, , q50, , q90, q99] = hy.landKm;
            let max = -Infinity; for (const v of T.heightKm) max = Math.max(max, v);
            const bins = [[-Infinity, 0.2, 'below 200 m'], [0.2, 0.4, '200–400 m'], [0.4, 1, '400 m – 1 km'], [1, 2, '1–2 km'], [2, 3, '2–3 km'], [3, 5, '3–5 km'], [5, Infinity, 'above 5 km']];
            const land = []; for (const v of T.heightKm) if (v > view.seaLevelKm) land.push(v - view.seaLevelKm);
            const rows = bins.map(([lo, hi, name]) => { const n = land.filter(v => v >= lo && v < hi).length; return { name, color: css(tintOf(Math.max(0.05, Number.isFinite(hi) ? (Math.max(0, lo) + hi) / 2 : 6))), cells: [`${(100 * n / Math.max(1, land.length)).toFixed(1)} %`] }; });
            return {
                cards: [
                    { big: `${(100 * hy.landShare).toFixed(1)} %`, small: `of the planet is land (sea level ${view.seaLevelKm >= 0 ? '+' : ''}${view.seaLevelKm} km)` },
                    { big: km(q50), small: `median land height · 90 % below ${km(q90)} · highest ${km(max - view.seaLevelKm)}` },
                    { big: `${(100 * hy.below400).toFixed(0)} %`, small: spec.lowlandNote },
                    { big: `${((T.ms.pooled ?? (T.ms.records + T.ms.surface + (T.ms.sample ?? 0))) / 1000).toFixed(2)} s`, small: `terrain at ${tMesh.numCells.toLocaleString()} cells${T.ms.workers ? ` on ${T.ms.workers} workers` : ''} · ${T.kernels.toLocaleString()} ridge kernels · ${T.volcanoes.toLocaleString()} volcanoes` + (carve ? (T.carved ? ` · rivers carved in ${((T.ms.carve ?? 0) / 1000).toFixed(2)} s` : ' · carving the rivers…') : '') },
                ],
                head: ['Land height', 'share of land'],
                rows,
                hint: `History: ${steps} steps in ${(simMs / 1000).toFixed(1)} s (kept while you change terrain settings).`,
            };
        },

        markers() { return []; },

        describeCell(frame, t) {
            const T = terrainOf(frame), h = T.heightKm[t] - view.seaLevelKm, w = T.sampler.cells[3 * t];
            const where = h >= 0 ? `${km(h)} above sea level` : `${km(-h)} deep`;
            return `${where} · ${describeCell(frame, w)}`;
        },

        profileAlong(frame, a, b, samples) {
            const T = terrainOf(frame), c3 = [0, 0, 0], w3 = [0, 0, 0], kms = [], heightKm = [];
            const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))), s = Math.sin(ang) || 1;
            for (let i = 0; i <= samples; i++) {
                const f = i / samples, ka = ang ? Math.sin((1 - f) * ang) / s : 1 - f, kb = ang ? Math.sin(f * ang) / s : f;
                let x = ka * a[0] + kb * b[0], y = ka * a[1] + kb * b[1], z = ka * a[2] + kb * b[2];
                const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
                locate(tMesh, x, y, z, c3, w3);
                kms.push(f * ang * 6371);
                heightKm.push(w3[0] * T.heightKm[c3[0]] + w3[1] * T.heightKm[c3[1]] + w3[2] * T.heightKm[c3[2]] - view.seaLevelKm);
            }
            return { km: kms, heightKm, note: `Terrain at ${tMesh.numCells.toLocaleString()} cells.` };
        },
    };
    };
}
