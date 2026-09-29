// Evolution — World Orogen's tectonic-history generator, a side page beside Generate and Import Heightmap
// (plans/V2_FULL_PLANET_PLAN.md). Build New World runs the history in a worker and shows the planet AS IT BUILDS (each
// frame drawn as it arrives, rivers and all); then the whole history is a timeline to scrub and play. Three settings
// (starting continent size, history length, where it should end) and two resolutions (plates, terrain) — "way way fewer
// settings" than the lab (developer). The drawing is the lab's: a shaded equirectangular texture on a globe (fast to
// change every frame), inside V1's page layout, sidebar and bottom sheet.

import Delaunator from 'delaunator';
import { setDelaunator } from '../../../js/sphere-mesh.js';
import { buildSimMesh } from '../core/sim-mesh.js';
import { terrainMeshAsync } from '../terrain/terrain-mesh.js';
import { terrainConfig } from '../terrain/terrain-config.js';
import { SmoothMapRaster } from '../view/map-raster.js';
import { paintRelief } from '../view/terrain-shade.js';
import { colorByPlate } from '../view/palettes.js';
import { GlobeView } from '../app/globe-view.js';
import { drawGraticule } from '../app/overlays.js';
import { runHistory } from '../app/history-runner.js';
import { TERRAIN_SCENES } from '../tectonics/scenarios/terrain-scenes.js';
import { ENDINGS } from '../tectonics/ending.js';
import { TerrainPlayer } from './terrain-player.js';
import { paintPalette, heightLutOf, PALETTES, CRUST_WORDS, settingOf } from './looks.js';
import { ClimateService, CLIMATE_LAYERS, SEASONAL_LAYERS, paintClimate, paintUnavailable, drawArrows, drawLegend, readoutLines } from './climate-view.js';

setDelaunator(Delaunator);

const MESH_SEED = 12345;               // the sim mesh is the same for every planet (as the lab's); the seed shapes the world on it
const SNAPSHOT_MYR = 10;
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
const MAP_WIDTH = IS_TOUCH ? 1024 : 2048;
const SHARP_WIDTH = IS_TOUCH ? 0 : 4096;  // the sharper texture, when paused (desktop; developer: "Sharper when paused")
const SHARP_AFTER_MS = 300;               // (a scrub draws the lighter texture; the sharper one once it has settled)
const SHADING = { exaggeration: 20, seaLevelKm: 0 };
// terrain workers: on a phone a few (each holds its own copy of the meshes: memory), elsewhere one per core but one
const WORKERS = Number(new URLSearchParams(location.search).get('workers')) || (IS_TOUCH ? 3 : null);
const SCENE = TERRAIN_SCENES.find(s => s.id === 'cycle');      // the start world, every rule on — its length and ending set here

const $ = id => document.getElementById(id);
const ui = { canvas: $('canvas'), map: $('mapCanvas'), cont: $('sCont'), len: $('sLen'), ending: $('ending'), sim: $('simCells'), terrain: $('terrainCells'),
    seed: $('seedCode'), build: $('generate'), status: $('buildStatus'), timeline: $('timeline'), play: $('playBtn'), time: $('timeSlider'),
    timeLabel: $('timeLabel'), rate: $('rate'), live: $('liveBtn'), more: $('moreBtn'), hover: $('hoverInfo'), panel: $('ui'), stats: $('stats'), info: $('info'),
    railBuilt: $('railBuilt'), railShown: $('railShown'), ticks: $('timeTicks') };

// ── settings ──
ui.ending.innerHTML = ENDINGS.map(e => `<option value="${e.id}">${e.label}</option>`).join('');
const url = new URLSearchParams(location.search);
const setIf = (el, v) => { if (v !== null && [...(el.options ?? [])].some(o => o.value === v)) el.value = v; };
if (url.get('cont')) ui.cont.value = url.get('cont');
if (url.get('len')) ui.len.value = url.get('len');
// (a phone builds on 20K plates by default: a 1200 Myr history takes ~40 s on a desktop at 20K, ~85 s at 40K, and a phone's
// cores are several times slower — plans/V2_FULL_PLANET_PLAN.md, step A)
if (IS_TOUCH) ui.sim.value = '20000';
setIf(ui.ending, url.get('end')); setIf(ui.sim, url.get('sim')); setIf(ui.terrain, url.get('terrain'));
ui.seed.value = url.get('seed') ?? String(Math.floor(Math.random() * 1e6));
const labels = () => { $('vCont').textContent = `${ui.cont.value}%`; $('vLen').textContent = `${ui.len.value} Myr`; };
ui.cont.addEventListener('input', labels); ui.len.addEventListener('input', labels); labels();
$('reseedBtn').addEventListener('click', () => { ui.seed.value = String(Math.floor(Math.random() * 1e6)); build(); });
ui.build.addEventListener('click', () => build());
// (terrain detail only redraws the terrain: the history is the same at any terrain resolution)
ui.terrain.addEventListener('change', () => setTerrainDetail());
// (more: how far the history was kept going — a link rebuilds the same history, run on as far)
const saveUrl = () => history.replaceState(null, '', `?seed=${Number(ui.seed.value) || 0}&cont=${ui.cont.value}&len=${ui.len.value}&end=${ui.ending.value}&sim=${ui.sim.value}&terrain=${ui.terrain.value}` +
    (B?.moreTo ? `&more=${B.moreTo}` : ''));
let linkedMore = Number(url.get('more')) || 0;          // (the first build only: a new world starts at its length)
// Keep going: the history runs on in pieces this long, until stopped (a multiple of the step grid and of the snapshot
// interval — pieces of the one history, the same as a single run: tectonics/simulate.js, resume)
const GO_PIECE_MYR = 20;
// …and stops for good when the history holds this much (a frame, packed, is ~24–28 bytes a plate cell: ~0.1 GB per
// 1000 Myr at 40K) — some 13,000 Myr at 40K on a desktop, 7,000 Myr at 20K on a phone
const HISTORY_BYTES = IS_TOUCH ? 400e6 : 1.5e9, FRAME_BYTES_PER_CELL = 28;
ui.seed.addEventListener('keydown', e => { if (e.key === 'Enter') build(); });

// ── drawing ──
// The planet is painted on an equirectangular texture — the globe's, and the map's (#mapCanvas shows it, turned to the
// centre longitude). Two of them on a desktop: the one painted while playing, and a sharper one painted when paused.
function texture(width) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = width >> 1;
    const ctx = canvas.getContext('2d');
    return { canvas, ctx, image: ctx.createImageData(width, width >> 1), width };
}
const tex = { lo: texture(MAP_WIDTH), sharp: null };
let shownTex = tex.lo;
// (V1's space around the globe — stars, atmosphere, its light, the sun glinting off the sea: developer: "I do like the
// starry background and the sunlight/reflection of V1")
const globe = new GlobeView(ui.canvas, tex.lo.canvas, { space: true });
globe.setSmooth(true);
globe.controls.autoRotateSpeed = 0.6;
const seaMask = texture(MAP_WIDTH);     // where the sea is, for the glint (the lighter resolution is enough for a glint)
let glinting = false;
const PALETTE_KEY = 'orogen.evolution.palette';
const storedPalette = (() => { try { return localStorage.getItem(PALETTE_KEY); } catch { return null; } })();
const view = { layer: 'terrain', palette: PALETTES[storedPalette] ? storedPalette : 'relief', mode: 'globe', grid: true, gridStep: 15, centerLon: 0, season: 'year' };
const climate = new ClimateService();   // the climate, on request, for the moment shown (climate-view.js)
/** Colour heights with the palette chosen (the lab's relief, or one of looks.js's). */
const tint = (heightKm, shade, out) => (view.palette === 'relief' ? paintRelief(heightKm, shade, out, { seaLevelKm: SHADING.seaLevelKm }) : paintPalette(view.palette, heightKm, shade, out, SHADING.seaLevelKm));
let raster = null;                      // the terrain mesh's pixel table (only the one in use: tens of MB at the finest detail)
const rasterOf = mesh => (raster?.mesh === mesh ? raster : (raster = { mesh, table: new SmoothMapRaster(mesh, MAP_WIDTH) })).table;
// the sharper pixel table: built a few rows at a time the first time the view is paused (~1 s, 117 MB), one mesh at a time
let sharp = null;
function sharpTableOf(mesh) {
    if (!SHARP_WIDTH) return null;
    if (sharp?.mesh !== mesh) {
        sharp?.controller.abort();
        const job = sharp = { mesh, table: null, controller: new AbortController() };
        SmoothMapRaster.build(mesh, SHARP_WIDTH, { signal: job.controller.signal })
            .then(t => { if (sharp === job) { job.table = t; dirty = true; } }).catch(() => {});
    }
    return sharp.table;
}
let lastScrub = 0;
const simMeshes = new Map();
const simMeshOf = n => { if (!simMeshes.has(n)) simMeshes.set(n, buildSimMesh(n, MESH_SEED)); return simMeshes.get(n); };

// ── one build: the history streaming in, its terrain, the timeline ──
let B = null;                           // { controller, player, frames, simMesh, tMesh, raster, live, started, endMyr, error }
let playing = false, playTime = 0, lastTick = 0, preparing = null, painted = null, paintedT = null, paintedRaster = null, paintedMesh = null, paintedSharp = false, dirty = true, cellRgb = null, simRgb = null;

async function build() {
    B?.controller.abort();
    B?.player?.dispose();
    const seed = Number(ui.seed.value) || 0, cont = Number(ui.cont.value) / 100, len = Number(ui.len.value), ending = ui.ending.value;
    const simCells = Number(ui.sim.value), terrainCells = Number(ui.terrain.value);
    const b = B = { controller: new AbortController(), player: null, frames: [], simMesh: null, tMesh: null, raster: null, live: true, started: performance.now(), endMyr: len, error: null, lengthMyr: len, doneText: null,
        climates: new Map(), climateJob: null, climateNote: null,         // (climates: frame → {tMesh, data}, while this history is open)
        run: null, going: false, wantGo: false, moreTo: linkedMore };      // (keep going: the history's run, kept to run on)
    linkedMore = 0;
    saveUrl();
    // (watching it build is playing it from the start, at the speed chosen — held at the newest moment built)
    playing = true; playTime = 0; preparing = null; painted = null; paintedT = null; paintedRaster = null; paintedMesh = null; paintedSharp = false; dirty = true;
    updateClimateUi();
    setScale(len); ui.time.value = 0; rail();
    blank();                                                                          // (the old world goes at once: a new one is starting)
    ui.timeLabel.textContent = 'Starting…';
    ui.play.innerHTML = '&#x23F8;';
    ui.timeline.hidden = false; ui.live.hidden = false;
    updateGoUi();
    ui.info.textContent = IS_TOUCH ? 'Watching the planet evolve — scrub the timeline at any time; tap the planet for details'
        : 'Watching the planet evolve — scrub the timeline at any time; hover the planet for details';
    status(`Starting a world (seed ${seed})…`, 0);
    if (IS_TOUCH) ui.panel.classList.add('collapsed');
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));            // (let the status paint first)
    if (B !== b) return;
    try {
        b.simMesh = simMeshOf(simCells);
        const meshReady = terrainMeshAsync(terrainCells);
        const run = runHistory({ list: 'terrain', scene: SCENE, ending, start: { continentalFraction: cont }, lengthMyr: len, keep: true }, b.simMesh, seed, SNAPSHOT_MYR,
            t => { if (B === b) progress(b, t); },
            frame => { if (B !== b) return; if (!b.frames.length) console.info(`[evolution] first frame simulated at ${((performance.now() - b.started) / 1000).toFixed(1)} s`); b.frames.push(frame); b.player?.addFrame(frame); if (frame.time > Number(ui.time.max)) setScale(frame.time); rail(); },
            b.controller.signal);
        b.tMesh = await meshReady;
        if (B !== b) return;
        b.seed = seed;
        useTerrain(b, b.tMesh, terrainCells);
        if (Number(ui.terrain.value) !== terrainCells) setTerrainDetail();          // (changed while the world was starting)
        simRgb = new Uint8Array(b.simMesh.numCells * 3);
        const done = await run;
        if (B !== b) return;
        b.run = done; b.simMyr = done.time; b.steps = done.steps;
        b.live = false; b.endMyr = b.frames.at(-1).time;
        setScale(b.endMyr); rail();
        b.player.finish();
        ui.live.hidden = true;
        const secs = (performance.now() - b.started) / 1000, stop = ENDINGS.find(e => e.id === ending);
        console.info(`[evolution] history: ${(done.ms / 1000).toFixed(1)} s in the worker, of which packing frames ${(done.packMs / 1000).toFixed(1)} s`);
        b.doneText = `${b.endMyr.toFixed(0)} Myr of history in ${secs.toFixed(0)} s · ${done.steps} steps` + (ending === 'none' ? '' : done.stopped ? ` — ends as ${stop.phrase}` : ` — did not reach ${stop.phrase} in time`);
        if (!b.retexturing) status(b.doneText, 1);
        dirty = true;
        updateGoUi();
        if (b.moreTo > b.simMyr) keepGoing(b, b.moreTo);                  // (a link to a history that was kept going)
        else b.moreTo = 0;
    } catch (err) {
        if (err.name === 'AbortError' || B !== b) return;
        b.error = err;
        status(`Could not build this world: ${err.message}`, null);
        console.error(err);
    }
}

/**
 * Keep going: the finished history runs on, a piece at a time, in the worker that ran it (it kept its world), until
 * stopped — or, from a link, until `until` Myr. The pieces make one history: the same as had it been run that long.
 */
async function keepGoing(b, until = Infinity) {
    if (B !== b || !b.run?.more || b.going) return;
    b.going = true; b.wantGo = true; b.live = true;
    b.goFrom ??= b.simMyr; b.goUntil = until; b.goStarted = performance.now();      // (from: where the history first ended)
    ui.live.hidden = false;
    updateGoUi();
    if (until === Infinity) { playTime = builtTo(); ui.time.value = playTime; setPlaying(true); dirty = true; }   // (watch it go on)
    progress(b, b.simMyr);
    let failed = null;
    try {
        while (b.wantGo && B === b && b.simMyr < until - 1e-9) {
            if (b.frames.length * FRAME_BYTES_PER_CELL * b.simMesh.numCells >= HISTORY_BYTES) { b.full = true; break; }
            const to = Math.min(until, b.simMyr + GO_PIECE_MYR);
            if (to > Number(ui.time.max)) { setScale(to); rail(); }
            const r = await b.run.more(to);
            if (B !== b) return;
            b.simMyr = r.time; b.steps = r.steps; b.moreTo = r.time;
            saveUrl();
        }
    } catch (err) {
        if (err.name === 'AbortError' || B !== b) return;
        failed = err; b.run = null;                                             // (its worker is gone)
        console.error(err);
    }
    if (B !== b) return;
    b.going = false; b.wantGo = false; b.live = false; b.endMyr = builtTo();
    setScale(b.endMyr); rail();
    ui.live.hidden = true;
    if (painted) ui.timeLabel.textContent = `${painted.time.toFixed(0)} Myr`;       // (no longer building)
    b.player?.finish();
    b.goSecs = (b.goSecs ?? 0) + (performance.now() - b.goStarted) / 1000;
    if (b.full) { b.run.close(); b.run = null; }                             // (its world goes too)
    b.doneText = failed ? `Could not keep going: ${String(failed.message).split('\n')[0]} — ${b.endMyr.toFixed(0)} Myr of history`
        : `${b.endMyr.toFixed(0)} Myr of history · ${b.steps} steps — kept going from ${b.goFrom.toFixed(0)} Myr (${b.goSecs.toFixed(0)} s)` +
            (b.full ? ' — as long a history as this device can hold' : '');
    if (!b.retexturing) status(b.doneText, failed ? null : 1);
    updateGoUi(); dirty = true;
}

/** The Keep going button: shown once a history is done — Keep going, Stop while it goes on, Stopping… until its piece is done. */
function updateGoUi() {
    const b = B, btn = ui.more;
    btn.hidden = !b?.run?.more;
    if (btn.hidden) return;
    btn.disabled = b.going && !b.wantGo;
    btn.classList.toggle('on', b.going);
    btn.innerHTML = !b.going ? '&#x23E9;<span class="lbl"> Keep going</span>' : b.wantGo ? '&#x25A0;<span class="lbl"> Stop</span>' : '&#x2026;<span class="lbl"> Stopping</span>';
    btn.title = !b.going ? 'Run the history on from where it ended, for as long as you like' : b.wantGo ? 'Stop the history here (you can keep going again later)' : 'Stopping once this piece of history is done';
    btn.setAttribute('aria-label', b.going ? (b.wantGo ? 'Stop' : 'Stopping') : 'Keep going');
}

/** Draw a build's frames on a terrain mesh: a player of its own (the frames so far handed over; the rest arrive as they come). */
function useTerrain(b, tMesh, cells) {
    const old = b.player;
    b.tMesh = tMesh; b.terrainCells = cells;             // (the setting: a mesh has about that many cells)
    b.raster = rasterOf(tMesh);
    b.player = new TerrainPlayer({ simMesh: b.simMesh, tMesh, cfg: terrainConfig(), seed: b.seed, shading: SHADING, workers: WORKERS, onBuilt: () => { dirty = true; } });
    for (const f of b.frames) b.player.addFrame(f);
    old?.dispose();
    cellRgb = new Uint8Array(tMesh.numCells * 3);
    preparing = null; dirty = true;
}

/** Terrain Detail changed: the same history, its terrain built again at the new resolution (the old one shown until then). */
async function setTerrainDetail() {
    saveUrl();
    const b = B, cells = Number(ui.terrain.value);
    if (!b?.player || b.error) return;                          // (no world yet, or still starting: build() reads the setting)
    if (b.terrainCells === cells) {                              // (back to the detail shown: nothing to build)
        if (b.retexturing) { b.retexturing = null; if (b.doneText) status(b.doneText, 1); }
        return;
    }
    b.retexturing = cells; b.retextureAt = performance.now();
    status(`Building the terrain at ${ui.terrain.selectedOptions[0].textContent.split(' ·')[0]}…`, null);
    try {
        const tMesh = await terrainMeshAsync(cells);
        if (B !== b || b.retexturing !== cells) return;
        useTerrain(b, tMesh, cells);
    } catch (err) {
        if (B === b) { b.retexturing = null; status(`Could not build the terrain: ${err.message}`, null); }
        console.error(err);
    }
}

/** A plain sea, while a new world starts. */
function blank() {
    const px = new Uint8Array(3), t = tex.lo;
    tint(new Float32Array([-4]), new Float32Array([0.8]), px);
    glint(false);
    t.ctx.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`;
    t.ctx.fillRect(0, 0, t.width, t.width >> 1);
    show(t);
}

/** The glint on (the sea mask painted with each frame) or off. */
function glint(on) {
    if (on === glinting) return;
    glinting = on;
    globe.setSeaMask(on ? seaMask.canvas : null);
}

/** Put a painted texture on the globe and the map. */
function show(t) {
    shownTex = t;
    globe.setSource(t.canvas);
    globe.textureChanged();
    drawMap();
}

/** The map view: the texture turned so that the centre longitude is in the middle. */
function drawMap() {
    if (view.mode !== 'map') return;
    const src = shownTex.canvas, W = src.width, H = src.height, c = ui.map.getContext('2d');
    if (ui.map.width !== W) { ui.map.width = W; ui.map.height = H; }
    const s = Math.round((((view.centerLon / 360) * W) % W + W) % W);
    c.drawImage(src, s, 0, W - s, H, 0, 0, W - s, H);
    if (s) c.drawImage(src, 0, 0, s, H, W - s, 0, s, H);
}

function progress(b, t) {
    if (b.retexturing) return;
    if (b.going) {
        const secs = (performance.now() - b.goStarted) / 1000, linked = b.goUntil !== Infinity;
        status(linked ? `Running on to ${b.goUntil} Myr, as in the link… ${t.toFixed(0)} Myr · ${secs.toFixed(0)} s` : `Keeping going… ${t.toFixed(0)} Myr · ${secs.toFixed(0)} s (from ${b.goFrom.toFixed(0)} Myr)`,
            linked ? Math.min(1, (t - b.goFrom) / Math.max(1, b.goUntil - b.goFrom)) : null);
        return;
    }
    const target = b.lengthMyr, secs = (performance.now() - b.started) / 1000;
    status(t <= target ? `Simulating the history… ${t.toFixed(0)} of ${target} Myr · ${secs.toFixed(0)} s` : `Running on until it ends as asked… ${t.toFixed(0)} Myr · ${secs.toFixed(0)} s`, Math.min(1, t / target));
}
function status(text, share) {
    ui.status.hidden = false;
    ui.status.innerHTML = `${text}${share === null ? '' : `<div class="bar"><i style="width:${(100 * share).toFixed(1)}%"></i></div>`}`;
}

// ── the timeline's scale: the whole history from the start (not only what is built), what is built so far, the moment shown ──
/** The scale runs to `max` Myr (the history's length — or further, when it runs on to reach its ending), with a few labels. */
function setScale(max) {
    ui.time.max = max;
    const step = [100, 200, 250, 300, 500, 1000, 2000, 2500, 5000].find(s => max / s <= 6) ?? 10000, marks = [];
    for (let t = 0; t < max - step * 0.6; t += step) marks.push(t);
    marks.push(max);
    ui.ticks.innerHTML = marks.map(t => `<span style="left:${(100 * t / max).toFixed(2)}%">${t}</span>`).join('');
}
/** The rail: built so far (faint), up to the moment shown (bright). */
function rail() {
    const max = Number(ui.time.max) || 1, built = B?.frames.length ? B.frames.at(-1).time : 0, shown = painted ? painted.time : Number(ui.time.value);
    ui.railBuilt.style.width = `${(100 * Math.min(1, built / max)).toFixed(2)}%`;
    ui.railShown.style.width = `${(100 * Math.min(1, shown / max)).toFixed(2)}%`;
}
/** Latest time the history has reached (a scrub may not go past it while it is still building). */
const builtTo = () => (B?.frames.length ? B.frames.at(-1).time : 0);

/** The recorded frame nearest to time t. */
function frameAt(t) {
    const f = B.frames;
    let lo = 0, hi = f.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (f[mid].time < t) lo = mid + 1; else hi = mid; }
    return lo > 0 && Math.abs(f[lo - 1].time - t) <= Math.abs(f[lo].time - t) ? f[lo - 1] : f[lo];
}

function paint(frame, sharpTable = null) {
    const T = B.player.terrainOf(frame), out = cellRgb;
    // (the terrain and the heightmap are coloured per pixel from the heights — their coasts crisp; the other layers per cell)
    let byHeight = null;
    if (view.layer === 'plates') {
        // the plates, carried from the sim cells onto the terrain and shaded by it
        colorByPlate(frame, simRgb);
        const { cells: sc, weights: sw } = T.sampler;
        for (let t = 0; t < B.tMesh.numCells; t++) {
            const k = 0.45 + 0.55 * T.shade[t];
            for (let ch = 0; ch < 3; ch++) out[3 * t + ch] = Math.min(255, k * (sw[3 * t] * simRgb[3 * sc[3 * t] + ch] + sw[3 * t + 1] * simRgb[3 * sc[3 * t + 1] + ch] + sw[3 * t + 2] * simRgb[3 * sc[3 * t + 2] + ch]));
        }
    } else if (view.layer === 'heightmap') byHeight = heightLutOf('heightmap');
    else if (CLIMATE_LAYERS.has(view.layer)) {
        // the climate of this moment, if it has been calculated; else the terrain greyed (and the chip offers it)
        const C = climateOf(frame);
        if (C) paintClimate(view.layer, view.season, C, T, B.tMesh, out, o => tint(T.heightKm, T.shade, o));
        else { tint(T.heightKm, T.shade, out); paintUnavailable(out, B.tMesh.numCells); }
    } else byHeight = heightLutOf(view.palette);
    // the sun glints off the sea on the Terrain view (V1's water shows there only)
    glint(view.layer === 'terrain');
    if (glinting) {
        B.raster.paintSea(T.heightKm, seaMask.image.data, SHADING.seaLevelKm);
        seaMask.ctx.putImageData(seaMask.image, 0, 0);
        globe.seaMaskChanged();
    }
    const table = sharpTable ?? B.raster, t = sharpTable ? (tex.sharp ??= texture(SHARP_WIDTH)) : tex.lo;
    if (byHeight) table.paintHeights(T.heightKm, T.shade, byHeight, t.image.data, SHADING.seaLevelKm);
    else table.paint(out, t.image.data);
    t.ctx.putImageData(t.image, 0, 0);
    const C = CLIMATE_LAYERS.has(view.layer) ? climateOf(frame) : null;
    if (C && (view.layer === 'wind' || view.layer === 'currents')) {
        const k = t.width / MAP_WIDTH;
        t.ctx.save(); t.ctx.scale(k, k); drawArrows(t.ctx, MAP_WIDTH, view.layer, view.season, C); t.ctx.restore();
    }
    if (view.grid) {
        // (lines as thick on the sharper texture as on the other)
        const k = t.width / MAP_WIDTH;
        t.ctx.save(); t.ctx.scale(k, k); drawGraticule(t.ctx, MAP_WIDTH, MAP_WIDTH >> 1, view.gridStep); t.ctx.restore();
    }
    show(t);
    if (!B.firstDrawn) { B.firstDrawn = true; console.info(`[evolution] first frame drawn at ${((performance.now() - B.started) / 1000).toFixed(1)} s`); }
    painted = frame; paintedT = T; paintedRaster = table; paintedMesh = B.tMesh; paintedSharp = !!sharpTable;
    const legend = $('climateLegend'), legendKey = C ? `${view.layer}|${view.season}|${frame.time}|${B.terrainCells}` : '';
    if (legend.dataset.key !== legendKey) { if (C) drawLegend(legend, view.layer, view.season, C, T); else legend.innerHTML = ''; legend.dataset.key = legendKey; }
    updateClimateUi();
    if (B.retexturing && B.retexturing === B.terrainCells) {
        console.info(`[evolution] terrain at ${B.retexturing} cells drawn in ${((performance.now() - B.retextureAt) / 1000).toFixed(1)} s`);
        B.retexturing = null; if (B.doneText) status(B.doneText, 1);
    }
    ui.timeLabel.textContent = !B.live ? `${frame.time.toFixed(0)} Myr` : B.going ? `${frame.time.toFixed(0)} Myr · going on` : `${frame.time.toFixed(0)} of ${Number(ui.time.max)} Myr · building`;
    rail();
    stats(T, frame);
}

// ── the climate (step D): calculated on request for the moment shown, kept per moment while the history is open ──
const climateOf = frame => { const e = B?.climates.get(frame); return e && e.tMesh === B.tMesh ? e.data : null; };

async function calculateClimate() {
    const b = B, frame = painted, T = paintedT;
    if (!b?.tMesh || !frame || paintedMesh !== b.tMesh || b.climateJob || climateOf(frame)) return;
    setPlaying(false);                                  // (it is this moment you are looking at)
    const tMesh = b.tMesh, started = performance.now();
    b.climateJob = { frame };
    updateClimateUi();
    try {
        const data = await climate.compute(tMesh, T.heightKm);
        if (B !== b) return;
        b.climates.set(frame, { tMesh, data });
        const secs = (performance.now() - started) / 1000;
        b.climateNote = `Climate for ${frame.time.toFixed(0)} Myr in ${secs.toFixed(1)} s`;
        console.info(`[evolution] climate for ${frame.time.toFixed(0)} Myr: ${(data.ms / 1000).toFixed(2)} s in the worker, ${secs.toFixed(2)} s in all`);
        if (!CLIMATE_LAYERS.has(view.layer)) setLayer('koppen');
    } catch (err) {
        if (B === b) b.climateNote = `Could not calculate the climate: ${String(err.message).split('\n')[0]}`;
        console.error(err);
    } finally {
        if (B === b) { b.climateJob = null; dirty = true; updateClimateUi(); }
    }
}

/** The Calculate button, the moments with a climate, the season choice, and the chip over the planet. */
function updateClimateUi() {
    const b = B, frame = painted, have = frame ? climateOf(frame) : null, job = b?.climateJob;
    const btn = $('climateBtn');
    btn.disabled = !frame || !!job || !!have;
    btn.textContent = job ? `Calculating the climate for ${job.frame.time.toFixed(0)} Myr…` : have ? `Climate calculated · ${frame.time.toFixed(0)} Myr`
        : frame ? `Calculate Climate · ${frame.time.toFixed(0)} Myr` : 'Calculate Climate';
    const done = b ? [...b.climates.entries()].filter(([, e]) => e.tMesh === b.tMesh).map(([f]) => f).sort((x, y) => x.time - y.time) : [];
    $('climateInfo').innerHTML = (b?.climateNote ? `<div>${b.climateNote}</div>` : '') +
        (done.length ? `<div>Calculated for ${done.map(f => `<a href="#" data-t="${f.time}">${f.time.toFixed(0)} Myr</a>`).join(' · ')}</div>` : '');
    const chip = $('climateChip');
    chip.hidden = !CLIMATE_LAYERS.has(view.layer) || !frame || (!!have && !job);
    if (!chip.hidden) {
        const stale = !job && b.climates.has(frame);
        $('climateChipText').textContent = job ? `Calculating the climate for ${job.frame.time.toFixed(0)} Myr…`
            : stale ? `The climate for ${frame.time.toFixed(0)} Myr was calculated at another terrain detail`
            : `No climate for ${frame.time.toFixed(0)} Myr` + (done.length ? ` — calculated for ${done.map(f => f.time.toFixed(0)).join(', ')} Myr` : '');
        $('climateChipBtn').hidden = !!job;
    }
    $('seasonGroup').hidden = !SEASONAL_LAYERS.has(view.layer);
}

function stats(T, frame) {
    if (!$('statsDetails').open) return;
    const h = T.hyps, km = v => `${Math.round(v * 1000).toLocaleString()} m`;
    ui.stats.innerHTML = `<div>${frame.time.toFixed(0)} Myr</div><div>Land: ${(100 * h.landShare).toFixed(1)} % of the planet</div>` +
        `<div>Below 400 m: ${(100 * h.below400).toFixed(0)} % of the land</div><div>Median land: ${km(h.landKm[2])} · 90 % below ${km(h.landKm[4])}</div>` +
        `<div>Plates: ${frame.plates.filter(p => p.alive && !p.isBackground).length}</div>`;
}

function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    if (B?.player && B.frames.length) {
        // wall-clock playback at the speed chosen; a frame still being built holds the clock, and so does the newest
        // moment built while the history is still arriving (it goes on as the next arrive)
        if (playing && B.player.isReady(frameAt(playTime))) {
            playTime += dt * Number(ui.rate.value);
            const end = builtTo();
            if (playTime >= end) { playTime = end; if (!B.live) setPlaying(false); }
            ui.time.value = playTime;
        }
        const frame = frameAt(Number(ui.time.value));
        // (paused and settled: the sharper texture, once its table is built)
        const sharpTable = !playing && now - lastScrub > SHARP_AFTER_MS ? sharpTableOf(B.tMesh) : null;
        if (B.player.isReady(frame)) { if (frame !== painted || dirty || !!sharpTable !== paintedSharp) { paint(frame, sharpTable); dirty = false; } }
        else if (!preparing) {
            const p = preparing = B.player.prepare(frame).catch(err => console.error(err)).finally(() => { if (preparing === p) preparing = null; dirty = true; });
        }
        // (the Live button lit while the playhead is at the newest moment built)
        ui.live.classList.toggle('on', B.live && playing && playTime >= builtTo() - SNAPSHOT_MYR);
    }
    globe.controls.autoRotate = $('chkRotate').checked && view.mode === 'globe';
    if (view.mode === 'globe') { globe.resize(); globe.renderIfNeeded(); }
}
requestAnimationFrame(tick);

// ── the timeline ──
function setPlaying(on) {
    playing = on;
    ui.play.innerHTML = on ? '&#x23F8;' : '&#x25B6;';
    if (on && !B.live && playTime >= builtTo()) playTime = 0;                      // (at the end: from the start again)
}
ui.play.addEventListener('click', () => { if (B?.frames.length) setPlaying(!playing); });
ui.time.addEventListener('input', () => {
    // (not past what is built: the rest of the scale is the history still to come)
    if (Number(ui.time.value) > builtTo()) ui.time.value = builtTo();
    playTime = Number(ui.time.value); dirty = true; lastScrub = performance.now(); rail();
});
// Live: to the newest moment built, playing on from there
ui.live.addEventListener('click', () => { if (!B?.frames.length) return; playTime = builtTo(); ui.time.value = playTime; setPlaying(true); dirty = true; rail(); });
// Keep going / Stop (a stop lets the piece under way finish: the worker is in the middle of it)
ui.more.addEventListener('click', () => {
    const b = B;
    if (!b?.run?.more) return;
    if (!b.going) keepGoing(b);
    else { b.wantGo = false; b.goUntil = Infinity; updateGoUi(); }
});
addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); ui.play.click(); }
});

// ── view options (V1's) ──
function setLayer(layer) {
    view.layer = layer; dirty = true;
    for (const b of document.querySelectorAll('#mapTabs .map-tab')) b.classList.toggle('active', b.dataset.layer === layer);
    $('mobileViewSwitch').value = layer;
    $('paletteGroup').hidden = layer !== 'terrain';
    updateClimateUi();
}
for (const b of document.querySelectorAll('#mapTabs .map-tab')) b.addEventListener('click', () => setLayer(b.dataset.layer));
$('mobileViewSwitch').addEventListener('change', e => setLayer(e.target.value));
$('climateBtn').addEventListener('click', () => calculateClimate());
$('climateChipBtn').addEventListener('click', () => calculateClimate());
$('season').addEventListener('change', e => { view.season = e.target.value; dirty = true; });
$('climateInfo').addEventListener('click', e => {
    // (a moment with a climate: go there)
    const a = e.target.closest('a[data-t]');
    if (!a || !B?.frames.length) return;
    e.preventDefault();
    setPlaying(false);
    playTime = Number(a.dataset.t); ui.time.value = playTime; dirty = true; rail();
});
$('palette').value = view.palette;
$('palette').addEventListener('change', e => {
    view.palette = e.target.value; dirty = true;
    try { localStorage.setItem(PALETTE_KEY, view.palette); } catch { /* (remembered only where the browser allows) */ }
});
$('viewMode').addEventListener('change', e => {
    view.mode = e.target.value;
    globe._dirty = true;
    ui.canvas.hidden = view.mode !== 'globe';
    ui.map.hidden = view.mode !== 'map';
    $('mapCenterLonGroup').hidden = view.mode !== 'map';
    ui.hover.style.display = 'none';
    drawMap();
});
$('sMapCenterLon').addEventListener('input', e => {
    view.centerLon = Number(e.target.value);
    $('vMapCenterLon').textContent = `${view.centerLon}°`;
    drawMap();
});
$('chkGrid').checked = view.grid;
$('chkGrid').addEventListener('change', e => { view.grid = e.target.checked; dirty = true; });
$('gridSpacing').addEventListener('change', e => { view.gridStep = Number(e.target.value); dirty = true; });
$('statsDetails').addEventListener('toggle', () => { dirty = true; });

// ── hover readout (V1's): the crust and plate, height, position, crust age and setting under the pointer ──
/** Where the pointer is on the texture, as fractions [u (west → east), v (north → south)] — or null, off the planet. */
function placeUnder(e) {
    if (view.mode === 'globe') {
        const uv = globe.uvAt(e.clientX, e.clientY);
        return uv ? [uv.x, 1 - uv.y] : null;
    }
    const W = ui.map.width, H = ui.map.height, r = ui.map.getBoundingClientRect(), s = Math.min(r.width / W, r.height / H);
    const x = (e.clientX - r.left - (r.width - W * s) / 2) / s, y = (e.clientY - r.top - (r.height - H * s) / 2) / s;
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    return [((x / W + view.centerLon / 360) % 1 + 1) % 1, y / H];
}
function readout(e) {
    const p = painted && paintedRaster ? placeUnder(e) : null;
    if (!p) { ui.hover.style.display = 'none'; return; }
    const t = paintedRaster.cellAt(p[0] * paintedRaster.width, p[1] * paintedRaster.height), h = paintedT.heightKm[t] - SHADING.seaLevelKm;
    // (the sim cell that weighs most in this terrain cell: its crust, plate and history)
    const { cells, weights } = paintedT.sampler;
    let w = cells[3 * t];
    if (weights[3 * t + 1] > weights[3 * t] && weights[3 * t + 1] >= weights[3 * t + 2]) w = cells[3 * t + 1];
    else if (weights[3 * t + 2] > weights[3 * t] && weights[3 * t + 2] > weights[3 * t + 1]) w = cells[3 * t + 2];
    const f = painted, lat = 90 - p[1] * 180, lon = p[0] * 360 - 180, lines = [];
    const plate = f.owner[w], type = f.type[w], oceanic = type === 0;
    if (plate >= 0) lines.push(`<span style="color:${oceanic ? '#4af' : '#6b3'}">●</span> <b>${CRUST_WORDS[type] ?? 'Crust'}</b> · plate ${plate}`);
    lines.push(`<span class="hi-label">Elev</span> ${Math.round(h * 1000).toLocaleString()} m`);
    lines.push(`<span class="hi-label">Coord</span> ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`);
    if (plate >= 0) lines.push(`<span class="hi-label">Age</span> ${Math.max(0, Math.round(f.time - f.formedAt[w])).toLocaleString()} Myr`);
    const setting = plate >= 0 ? settingOf(f, w) : null;
    if (setting) lines.push(`<span class="hi-label">Setting</span> ${setting}`);
    // the climate, where this moment has one: its Köppen class, temperature and rain
    const C = climateOf(f);
    if (C && paintedMesh === B.tMesh) lines.push(...readoutLines(C, paintedT, B.tMesh, t));
    ui.hover.innerHTML = lines.join('<br>');
    ui.hover.style.display = 'block';
}
for (const el of [ui.canvas, ui.map]) {
    // (a mouse: as it moves; a finger: a tap shows it, a drag turns the globe and hides it)
    let down = null;
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointermove', e => {
        if (e.pointerType === 'mouse') { if (!e.buttons) readout(e); else ui.hover.style.display = 'none'; }
        else if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) { down = null; ui.hover.style.display = 'none'; }
    });
    el.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse' && down) readout(e); down = null; });
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') ui.hover.style.display = 'none'; });
}

// ── the side panel: collapse on desktop, a draggable bottom sheet on phones (as V1's) ──
$('sidebarToggle').addEventListener('click', () => ui.panel.classList.toggle('collapsed'));
(function bottomSheet() {
    const handle = $('sheetHandle'), mobile = () => matchMedia('(max-width: 768px)').matches;
    let startY = 0, startOffset = 0, dragging = false, moved = false, lastY = 0, lastT = 0, velocity = 0;
    const collapsedOffset = () => ui.panel.offsetHeight - 60;
    handle.addEventListener('pointerdown', e => {
        if (!mobile()) return;
        e.preventDefault(); handle.setPointerCapture(e.pointerId);
        dragging = true; moved = false; startY = lastY = e.clientY; lastT = performance.now(); velocity = 0;
        startOffset = ui.panel.classList.contains('collapsed') ? collapsedOffset() : 0;
        ui.panel.classList.add('dragging'); ui.panel.style.transition = 'none';
    });
    handle.addEventListener('pointermove', e => {
        if (!dragging) return;
        const now = performance.now();
        velocity = (e.clientY - lastY) / Math.max(1, now - lastT); lastY = e.clientY; lastT = now;
        if (Math.abs(e.clientY - startY) > 4) moved = true;
        const y = Math.max(0, Math.min(collapsedOffset(), startOffset + e.clientY - startY));
        ui.panel.style.transform = `translateY(${y}px)`;
    });
    const end = () => {
        if (!dragging) return;
        dragging = false;
        ui.panel.classList.remove('dragging'); ui.panel.style.transition = ''; ui.panel.style.transform = '';
        if (!moved) { ui.panel.classList.toggle('collapsed'); return; }
        const y = startOffset + lastY - startY, collapse = velocity > 0.4 || (velocity > -0.4 && y > collapsedOffset() / 2);
        ui.panel.classList.toggle('collapsed', collapse);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    if (mobile()) ui.panel.classList.add('collapsed');
})();

build();
