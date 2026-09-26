# World Orogen V2 — tectonic history engine (work in progress)

V2 simulates a planet's **tectonic history** — a supercontinent of cratons breaking up, oceans
opening and closing, continents colliding — in the spirit of Worldbuilding Pasta's GPlates
workflow, fully automated and in the browser. It lives beside V1 and never touches it; it imports
V1's generic modules (`js/sphere-mesh.js`, `js/rng.js`, `js/simplex-noise.js`) instead of copying them.

The design, the phase plan and the decision log are in
[`plans/V2_TECTONIC_HISTORY_DESIGN.md`](../plans/V2_TECTONIC_HISTORY_DESIGN.md). Read §3–§4 and §10
before changing the engine.

**Status:** Phases 1–7 are built — rigid kinematics · ridges & trenches · the generated start world · plate
driving forces · collisions (belts, suturing with redraw) · trench wings, island arcs, terrane docking · rifting,
foundering margins, oceanic plate birth · hotspots & LIPs · margins, flat slabs, back-arc seas, fore-arc islands · the
crust budget: erosive margins, continental underthrusting, arc recycling. Phase 8 (terrain) is done: **8a**, the
tectonic surface — heights from the records, with ridges laid out along each belt's front — and **8b**, rivers
carving it — with the history's own rivers, which persist and cut gorges as the land rises under them — plus flood
basalts cut into mesas and stairs. Phase 9 (steady detail) is done: the terrain is read on each plate's own crust, so a
drifting continent keeps its coasts, ridges and rivers, and its fine detail renews only slowly. Next, per
plans/V2_ROADMAP_PHASES_9_13.md: 10 start-world defaults, 11 natural collisions, 12 the sim's resolution, 13 the
supercontinent cycle — then the full planet (the render mesh, V1's polish and climate). The phase table is in the design doc (§9). V2 is built **one phase at a time, each confirmed by
the developer before the next begins.**

## Running it

```
node tuning/dev-server.mjs 8123        # any static server works; there is no build step
open http://localhost:8123/v2/         # the lab; ?phase=1, 2, 3, 4, 5, 5b, 6a, 7a, 7b, 7c, 8a, 8b; &seed=…, &scene=india, &mobility=3.5 …
```

The lab is a test bench, not the product: each phase has a scene that isolates one mechanism, an
on-screen checklist of what to look for, live numbers, and a time scrubber. Space = play/pause,
← → = step a frame. It works on a phone (bottom sheet, tap to inspect). From 8a on the lab draws terrain on a finer
mesh than the sim's (a drop-down: 160K / 640K / 2.5M cells) and has a **Cross-section** tool: click two points.

```
node v2/tools/check-phase1.mjs         # … 2, 3, 4, 5, 5b, 6, 6b, 7, 7b, 7c, 8a, 8b, 9 — headless acceptance checks, PASS/FAIL, exit code
node v2/tools/check-invariants.mjs     # invariants through whole histories: land never vanishes, dead plates empty, terrane ids, cratons
node v2/tools/check-scale.mjs          # the same scenes at 40K and 80K cells agree in km / km² / Myr; recording rate never changes a history
node v2/tools/trace-forces.mjs india mobility=3.5     # speeds / force-balance targets / situations over time
node v2/tools/trace-collisions.mjs wilson 160          # collision records, events, belt statistics
node v2/tools/render-frames.mjs tug plates            # PNG frames of a scene → v2/out/
node v2/tools/shoot-lab.mjs 4 56 http://localhost:8123 scene=india   # screenshots + page smoke test (needs the server)
```

After an engine change run `check-invariants.mjs`, `check-scale.mjs` and the check scripts of the phases the change
touches; run all of them before calling a piece of work done. They need `npm install` (delaunator, pngjs; puppeteer
only for `shoot-lab`).

## Layout

```
js/core/           geometry with no tectonics in it: rotations, sphere index, sim mesh, sphere-geom (distances,
                   centroids), mesh-bfs (hop distances, floods, connected pieces — use these, don't hand-roll a BFS),
                   mesh-locate (the triangle a point falls in, with barycentric weights), min-heap (+ spreadKm: Dijkstra
                   in km over a mesh), mesh-rings (every cell's rings 0–3, precomputed), fast-noise (bit-identical to V1's
                   SimplexNoise, faster); sim-mesh also rebuilds a mesh from its arrays (meshFromArrays: how workers get it)
js/tectonics/
  config.js        every tunable, in physical units (km, Myr, cm/yr); MECHANISMS = each mechanism's off-switch
  model/           crust.js (CrustRaster: per-plate cells in the plate's own frame; CELL_FIELDS; the type / flag /
                   orogeny / volcanic enums) · plate.js (Plate) · world.js (TectonicWorld, EventKind, BoundaryKind)
  init/            the start world: cratons → landmass → apron + rim trench → world; and its measurer
  step/            the stages of a step —
                     motion & view: kinematics, gather, resolve (subduct + grow), occupancy (coarse bins that let the
                                    growth step skip far plates), reconstruct (read-only playback)
                     boundaries:    contact, polarity (which side goes down), boundaries (classification, trench
                                    records, Andean / Laramide / transpression belts, flat slabs)
                     forces:        forces, torque-balance (updatePlateMotion)
                     events:        hotspots (plumes, LIPs, tracks), collision (records, suture / docking), orogeny
                                    (belt spreading, underthrusting), wings (trench wings, island arcs), margin-isles
                                    (fore-arc islands on accretionary margins, coast retreat on erosive ones),
                                    rifting (when a continent rifts), backarc (slab rollback, back-arc seas),
                                    subduction-init (when a passive margin founders)
                     heights:       the evolving height records (root, uplift, crest size, volcano wear) and
                                    their erosion by latitude — records only, the history never reads them
                     rivers:        the history's rivers: drained every few Myr, cutting as they go (gorges
                                    where land rose under them) — records only too
  ops/             plate surgery, called by the event stages: rift (path + split), merge-plates (suture with the
                   outline redraw), accrete-terrane (docking), scrape-arc, collapse-arc (fore-arc closure),
                   birth-ocean-plate (a plate carved out of the passive ocean), tidy-plates (integrity: fragments,
                   pinholes, transferCells / freeCellBeside / bridgePieces)
  scenarios/       hand-built test worlds for the lab and the checks (scene-kit: continents, aprons, oceans)
  simulate.js      the loop        snapshot.js   Frame (what everything downstream reads)
  measure.js       measurements on Frames (margins, tallies, force situations), shared by the lab and the checks
js/terrain/        heights from a Frame (Phase 8), in km, on a terrain mesh of any resolution —
  terrain-config   every terrain tunable, in km / Myr (TERRAIN; terrainConfig(overrides))
  anchor           the fine detail belongs to the crust: plate-frame positions for noise, per-crust-cell random streams
  carve            Phase 8b: rivers carve the surface — the stream power law solved analytically in time along a
                   routed river network (Tzathas et al. 2024), coarse to fine over the sim and terrain meshes;
                   carve-worker carves whole frames off the page's thread
  terrain-mesh     the terrain mesh (cached per size) and sampleOnto: each terrain cell's 3 sim cells + weights,
                   looked up through a smooth noise warp so the sim's cells never show
  records          step 1: the Frame read into per-sim-cell fields — signed coast distance, shelf / plain / slope by
                   kind of coast, sea-floor depth and age, trenches, the isostatic platform, and per belt: kind (type +
                   side of a collision), distance from its front, reach, relief, obliquity, the across-strike direction
  profiles         cross-sections of each kind of belt (WBP VIIa): crests, valleys, plateaus, basins vs distance from the front
  stripes          the parallel ridges inside a belt: phasor noise on kernels aligned across the strike (en-echelon
                   along transforms), faded where the mesh is too coarse to show them; crossAt, the distance across a
                   belt as its kernels carry it (smooth, bending with the front) that the ridge noise is read at
  volcanoes        cones: hotspot islands / seamounts, island-arc chains, Andean stratovolcanoes
  lips             flood basalts on land: each province's pieces (centre, radius, age) and its radiating dyke swarm
  near-lists       which point features can reach a sim cell's terrain points
  synthesize       synthesizeTerrain(frame, simMesh, terrainMesh) → heightKm (+ components) = preparePlan (per frame)
                   + surfaceRange (any range of cells); hypsometry()
  terrain-pool     the same synthesis on worker threads (terrain-worker.js), bit for bit; mesh-worker builds a
                   terrain mesh off the page's thread
js/view/           DOM-free painting: equirect raster (MapRaster for sim cells, SmoothMapRaster blending a fine mesh),
                   palettes (colours AND the name tables, e.g. OROGENY_NAME), terrain-shade (hypsometric tint, hillshade)
js/app/            the lab: shell (lab-main), globe, canvas overlays, phases/ (one module per phase + phase-kit),
                   history-runner / history-worker (a scene's history off the page's thread, frames streamed back)
tools/             check scripts (+ lib/check-kit.mjs: shared frame helpers), trace / render / screenshot helpers
```

## How the engine is put together

1. **Crust lives in plate frames.** Each plate owns a raster over the same sim mesh, in its *own* frame, plus a
   rotation. Moving a plate changes one quaternion; crust is not resampled as it moves, so continents stay rigid.
   The **world view** (`world.owner` / `ownerCell`: who is where) is rebuilt by *gather*: each world cell asks each
   plate "do you have crust here?". No claim = a gap, two = convergence.
2. **Continents first.** Only land is a primary moving object. The pre-history ocean is one passive plate that
   never moves, never pushes back and never accepts crust (a trench against it first carves a real plate out of
   it). New ocean crust is written into the rasters of the plates flanking a gap.
3. **A step** (`simulate.js`):
   `advance` (move by ω·dt) → `resolve` (subduct overlaps by the polarity rule, grow crust into gaps: the world view
   is now fresh) → `classifyBoundaries` (ridge / trench / transform / collision; trench slab records; Andean belts)
   → **events**, in this order — `updateHotspots` (first: it only stamps records) · `trackCollisions` · `growWings`
   · `buildArcs` · `collapseArcs` · `growMarginIsles` · `riftContinents` · `openBackArcs` · `initiateSubduction` ·
   `tidyPlates` → if any changed crust: refresh, `resolve` and classify again → `drive` (next velocities: a scene's
   prescribed motion, or `updatePlateMotion`) → `steerBackArcStrips`. `evolveHeights` (erosion of the height records,
   below) runs before `drive`. Steps are adaptive (a plate moves at most a
   cell per step) and never cross a multiple of `stepGridMyr`, so how often a history is recorded never changes it.
4. **Forces come from boundary state**, not velocities: trench flags, crust type and age, slab length. `D·ω = T` per
   plate, with basal drag, slab resistance and a viscous collision lock in `D`. Speeds are never scripted.
5. **Rasters are rigid — except at a suture.** The one time crust is deformed is when two plates weld
   (`ops/merge-plates.js`: the lower is resampled into the upper's frame and the outlines are redrawn).
6. **Frames are the only interface downstream.** Views, stat panels and checks read `Frame`s (`snapshot.js`), the
   helpers in `measure.js`, and the event log; nothing downstream reaches into plate rasters.
7. **Belts record their geometry** for the terrain: every cell a belt shapes keeps where across the belt it lies
   (`beltU`, 0 at the front), how far the belt reached, which side of a collision it is on and the obliquity of the
   convergence (`crust.belt*`, written by `spreadBelt`). Scalars in the plate frame, so they never need rotating; the
   ridge direction is recovered at terrain time (straight away from the nearest front cell). When a newer orogeny
   takes a cell over, the old belt's record moves to `crust.prev*` (one layer deep), and the terrain shows it under
   the new one.
8. **Heights evolve with the history** (`step/heights.js`; records only — the history never reads them, and its event
   log is the same with or without them). Each crust cell carries an erodible root (`rootKm`, grown exactly as belts
   thicken the crust; Airy isostasy), a broad uplift (`upliftKm`, raised toward the belt's cross-section at the pace of
   the convergence its front absorbs, never lowered by a newer belt; foreland basins sink below 0), the size of its
   belts' crests (`rugged`, `prevRugged`) and a hotspot volcano's wear (`volcWornKm`). Every step erodes them at the
   latitude the cell is at then (faster where it rains more, and poleward under ice) and smooths the uplift sideways a
   little, never into the sea nor onto a craton. So orogenies accumulate, and an old belt that drifted through the
   tropics keeps the wear it took there. Constants: terrain-config.js (`upliftBuildKm`, `reliefTauMyr`,
   `thickTauMyr`, `ruggedTauMyr`, `diffusionKm2PerMyr`); a world may carry its own in `world.config.heights`.

### Rules for event stages and ops (break these and histories go subtly wrong)

- **The world view goes stale during the events.** It was built before them; every stage after the first that
  changes crust makes it stale for the plates involved. An op that adds, removes or rewrites a plate's cells calls
  `plate.markReshaped()`; a stage that reads `world.owner` / `ownerCell` skips plates with `plate.reshaped` (or
  re-checks the plate's own raster, `crust.mask[cell]`). `resolve` clears it. Changing a cell's type in place
  (an arc, an island) only sets `dirty`.
- **Dead plates.** A merged / swallowed plate has `alive = false` and an empty raster; a stage that works on pairs it
  found at the start of the step re-checks `alive` before using either plate.
- **Land is never deleted.** Moving land onto land stacks it beside (`freeCellBeside`) or, only if there is no
  room, absorbs it — counted and reported. `check-invariants.mjs` fails on a step that loses land.
- **Every per-cell field** is in `CELL_FIELDS` (model/crust.js); copy cells with `copyFrom` / `snapshot` / `restore`,
  never field by field.
- **Terrane ids** are unique in a world and never remapped: new ones come from `world.nextTerraneId()`.
- **A stage returns a count** (cells or events changed); the loop sums them to decide whether to re-resolve, so
  `undefined` would silently skip it.

### Adding a mechanism (an event stage)

1. Its code in `step/<name>.js` (plate surgery in `ops/`); call it from the event list in `simulate.js` at the place
   whose inputs it needs, with a comment on what it reads and changes.
2. Its own random stream on `TectonicWorld` (`this.rngX = makeRng(seed ^ 0x…)`) — never another mechanism's, or
   adding it re-rolls every existing history.
3. Tunables in a titled group of `config.js`, in km / Myr / cm·yr⁻¹ (scale-invariant: rates × dt, per km or km²,
   hops only via `km / edgeKm`); its **off-switch in `MECHANISMS`** (config.js), so every older scene excludes it.
4. Its events: a new `EventKind` (model/world.js) with the fields of its `data`, and an `EVENT_STYLE` entry
   (app/phases/phase-kit.js). Code reads `kind` and `data`, never `text`.
5. A new crust type, flag, orogeny or volcanic type: the enum in model/crust.js, then its colour and name in
   view/palettes.js (`TYPE_RGB`, `OROGENY_RGB` + `OROGENY_NAME`, …) and its line in `describeCell` (phase-kit.js).
6. A scene that isolates it, a lab phase and a check script (below); `check-scale.mjs` gains a line if it builds
   something with a size.

### Adding a phase

1. Describe it to the developer and get a go-ahead (phase gate).
2. Engine code as above; a test scene under `scenarios/` that isolates the mechanism with `onlyMechanisms(…)` and is
   *unfair* (unequal speeds, off-centre geometry, several seeds).
3. `js/app/phases/phase<N>-….js` exporting `createPhase(simMesh, seed, overrides)`; the contract is the `Phase`
   typedef in `phase-kit.js` (`assertPhaseContract` enforces it). Use the kit: `SNAPSHOT_MYR`, `describeCell`,
   `eventRows`, `speedSeries`, `orogenyLegend`, `boundaryLegend`, `latLonOf`. Register it in `PHASES` in
   `lab-main.js` and move `LATEST_PHASE` to it.
4. `tools/check-phase<N>.mjs` on `lib/check-kit.mjs`: numeric checks whose expectations do **not** come from the code
   path under test, that fail when the feature is absent (no `every` over an empty list), ending with
   `checkLabPhaseLoads(...)`.
5. Update the design doc (§9 status table, §10 log) and stop for confirmation.

A new **layer**: a painter in view/palettes.js, its colours there, a `{ label, paint }` entry in each phase that shows
it, and legend rows from the same colour constants.

## Terrain (Phase 8)

`synthesizeTerrain(frame, simMesh, terrainMesh)` turns one Frame into heights (km above sea level) on a terrain mesh
of any size — the sim mesh's 121 km cells are far too coarse for ridges. Records are read on the sim mesh
(`records.js`), then every terrain cell blends its three sim cells: the continental platform over land corners, the
sea floor over ocean corners, the land/sea transition from the interpolated signed coast distance (so coasts have a
shape in km, not in cells), each belt kind by its share of the weights. The broad relief is the uplift the history evolved
(engine rule 8), interpolated over land corners; on it, each belt's crests (`profiles.js` crestProfile × the evolved
crest size), plus strike-parallel ridges (`stripes.js`: guidance, a share
of the belt's own uplift), ridge noise — simplex noise drawn out ~8× along the strike (read at the distance across the
belt, fast, and the position along it, slow), so its highs and lows run with the range — and cones. The first
continents are not flat: when the history starts they get broad swells (`baseKm`, up to `baseReliefKm`, half on
shields) that wear down like the rest of the relief and steer the history's rivers into the lowlands between them. Belts come in two layers — the current one and the one it overprinted, at half
strength with its own grain — and each corner's share is scaled by noise of its own, so kinds of ground interfinger.
Every erosion clock runs faster where it rains more — a hard-coded zonal-mean rainfall by latitude, with ice keeping
the high latitudes eroding (terrain-config.js rainByLatitude, glacialErosion; erosionAtLatitude), and faster on high
ground than on low (erosionAtHeight): old ranges linger as low hills. Volcanoes are irregular massifs, not cones: an
edifice with a noise-warped outline, broad ridges (rift zones, arc ridges) running out from the summit, gullies in the
lower flanks, sometimes a flank collapse. Flood basalts (`lips.js`) are cut up as they wear, not ground flat: the
history records how far each province has worn (`volcWornKm`, by the rain of its latitude), and the terrain strips its
cap where a mesa noise of its own stands below that — in tiers, sooner near the province's edge — so a young province
is a plateau with a lobed edge, then an escarpment retreats with mesas left before it, then buttes and remnants; after
the rivers carve, wherever the basalt is cut into it is stepped (`carve.js` terraceBasalt: flat treads, cliffs), its
canyons steep-walled; and its dykes radiate from the plume's centre as a wavy, fanned grain that comes out from under
the lava across its edge. The fine detail belongs to the crust (`anchor.js`): noise is read in the frame
of the plate under each point, and ridge kernels and volcanoes are keyed to crust cells — scrub the history and a
drifting continent carries its ridges and volcanoes with it. So does what they ride on (Phase 9): a frame carries every
plate's crust (its cells, their types and belts — the world view shows only the crust cell nearest each world cell, and
~15 % of a moving plate's cells are nobody's nearest), the coast distance, shelves and belt directions are measured on each
plate's own raster, and the terrain reads a moving plate's records over that raster (`anchorRecords`), so coastlines,
belt edges and ridges ride with their continent instead of re-forming at the scale of the sim cells as it moves. The fine
detail is not frozen for good, though (`detailRenewMyr`, 150 Myr): the ridges' phases drift, each at a rate of its own,
and the bays and headlands, the ridges' segments and crests and the ridge noise fade from one noise over to the next —
from one frame to the next nothing moves, while over a few hundred Myr the landscape is re-sculpted. Trapped pockets of
ocean crust smaller than `pocketSeaKm2` are lowland, and a margin's kind (so its shelf width) holds along
`coastKindKm` of its coast. In the lab, the erosion clocks marked "re-runs the history" rebuild the history (in its
worker) with the new constants; the history itself comes out the same. The lab builds the frame shown, then every other
frame in the background (heights only, within a memory budget), so scrubbing and playing need no building; sea level
and hillshade only re-shade.

**Rivers (Phase 8b, `carve.js`).** The tectonic surface is carved by the stream power law, solved analytically in time
along the river network (Tzathas, Gailleton, Steer & Cordonnier 2024): after `carveTimeMyr` a point stands where the
ground downstream stood, the erosion wave having travelled up at k·A^m, plus the rock uplift gathered on the way —
with a short time (0.6 Myr) a valley floor drops only to the ground a little way downstream, so rivers descend with the
existing topography and cut deep where the land falls steeply; ridges and plateau tops survive. The network
is a priority flood from the sea with slope-weighted random receivers; drainage areas are in km² (rain-weighted). Every
river carves: a cell drops by the share of it its valley takes, the valley widening with √(discharge) (`carveValleyKm`
wide at 10⁴ km²), so great rivers cut whole cells and streams barely mark theirs; valley sides are held to
`carveHillSlope`. Solved coarse to fine (sim mesh, then the terrain meshes up to the one shown), so the big
rivers are the same at every resolution. The lab's 8b phase shows every frame carved (the surface first, then its
carving from a worker); the Drainage layer shows the network, which is not drawn on the terrain by default.
**Rivers through the history (8b-2, `step/rivers.js`).** Every 4 Myr the history drains its land on the sim mesh, over the
evolved height less what rivers already cut there — so a river keeps a course it has cut — and each river cuts by stream
power toward a share A / (A + `riverHalfKm2`) of the relief it crosses. The cut is a crust record (`riverIncKm`); where
land rose under a river that kept up, it is a gorge. The carving routes over the surface less that record and makes
every river bed at least as deep, so rivers follow their historical courses and canyons show where they held them. Small
rivers are routed over a micro-relief of the crust's own, so they ride with their continent between frames.
**Scale invariance:** all lengths are km; noise is a function of position; waves shorter than ~2 terrain cells are
faded out, not aliased. `check-phase8a.mjs` compares 160K, 640K and 2.5M cells sim cell by sim cell.
A phase that draws terrain sets `displayMesh` (its layers paint terrain cells) and may offer `profileAlong` (the
cross-section tool); see the `Phase` typedef in phase-kit.js.

## Performance

Every optimisation so far is EXACT — the output does not change by a single bit — and is checked that way: a hash of
a 600 Myr history's event log and of every frame, and of the terrain's heights, before and after. The history
(single-threaded; steps depend on each other) ran 39 s → 26 s for 600 Myr in Node: precomputed search rings, lookups
skipped for the unrotated background and far from a plate's crust, each plate's lookups reused between the two
resolves of a step, contacts cached per resolve, scratch arrays reused. In the lab it runs in a worker, so the page
never freezes. Terrain is spread over workers (every cell depends only on its position and the per-frame plan):
2.5M cells 5.2 s → ~0.6 s a frame; the terrain mesh is built in a worker while the history runs. Then the lab builds
every other frame ahead, in the background (heights as 16-bit metres, 320 MB at most — 64 MB on small devices): once
built, a frame shows in ~0.15–0.35 s at 640K and ~0.4 s at 2.5M in Chrome (re-shading only). Carving (8b) takes
0.2 s at 160K, ~0.9 s at 640K and ~2.6 s at 2.5M on its worker, pipelined with the next frame's surface.

## Conventions

- **Scale invariance.** Everything is in km / Myr / cm·yr⁻¹. Never a bare hop count: `withinKm` for a distance
  guarantee, `Math.round(km / mesh.edgeKm)` where a hop count is really meant. The history always runs on the fixed
  sim mesh (`simCells`), independent of render detail — but `check-scale.mjs` holds the rules to it.
- **Config.** `new TectonicWorld(simMesh, seed, overrides)` → `world.config` (a deep copy of `TECTONICS`). Engine code
  reads `world.config`, never the defaults. Scenes and lab phases also set `world.config` keys after `build()`: that
  only works for keys read while the history runs, not for ones read while building the world.
- **Determinism.** All randomness comes from seeded streams (`makeRng`), one per mechanism; no `Math.random`, no
  random-comparator sorts. Same seed → same world in every browser.
- **Scenes** keep their own data in `plate.scene`; look plates up by name, never by index; events give plates by id.
- **Provisional cells.** A world cell that no raster holds crust for is marked, never disguised
  (`Provisional.NEWBORN` = ridge axis, `LIKE_NEIGHBOUR` = passing hole ahead of a closing edge).
- **Debugging crust growth:** `decideBirth(world, plate, cell, everyone)` in `step/resolve.js` returns `{born, why}`.
