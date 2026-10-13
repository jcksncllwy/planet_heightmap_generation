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
drifting continent keeps its coasts, ridges and rivers, and its fine detail renews only slowly. Phase 10 (cratons) is
done: ranges meet shields as real ones do — foothills on the rim, a foreland lowland, steep where a plateau's back meets
one — and each shield has a character. Phase 11 (natural collisions) is done: continents pivot about their first
contact and weld once the seam has closed, so few seas are sealed in. Phase 12 (the sim's resolution) is done: 80K and
160K sim cells can be chosen in the lab (40K stays the default), and histories are faster and held in a quarter of the
memory. Phase 13 (the supercontinent cycle) is done: a supercontinent breaks up
in a burst of rifts over the mantle it has insulated, the mantle's flow spreads the pieces and gathers them again ~90°
away, and the new supercontinent breaks up in its turn (a 1200 Myr lab scene with a chart of it); and a whole planet's
history can be asked to **end in a stage of the cycle** — a supercontinent, one breaking up, or continents dispersed.
Next, per plans/V2_ROADMAP_PHASES_9_13.md: the full planet (the render mesh, V1's polish and climate). The phase table is in the design doc (§9). V2 is built **one phase at a time, each confirmed by
the developer before the next begins.**

## Running it

**Evolution** (`/evolution`, `evolution.html`) is the product page built on this engine — a side generator beside V1's
Generate and Import Heightmap. Its layout (plans/V2_EVOLUTION_UI_PLAN.md): the sidebar holds **New World** (a new seed),
the **World** section — folded to a one-line summary once a history is building: the seed, starting continent size,
history length, ending and **Quality** (Fast 20K plates / 160K terrain · Balanced 40K / 160K · Best 80K / 640K · Custom,
which shows the two resolutions), with Build This World — then the **context card**, and **View** (terrain colours,
globe or map, grid, auto-rotate, playback speed, stats). The context card names the moment shown, a **Preview** or
**Detailed** badge, and the one thing to do next — **Add detail** (with its Detail level), **Replace** the detailed
moment, **Cancel** while it runs, or **Export** — its button mirrored on the timeline, beside the moment; on the detailed
moment it holds the rivers' options, elsewhere a link back to it; **Extend history** once the history has reached its end.
The timeline is play, scrub and the time, with the badge (no Live button: its rail shades the time computed so far,
scrubbable while the rest fills in). On a phone the collapsed bottom sheet shows the moment and what is going on in a
line. A first-run **tutorial** (the "?" opens it again) sits over a history already building. The layers sit over the
planet (Terrain, Satellite — locked on previews — Climate, its own row: Köppen, temperature, rain, wind, currents, and
the season — Heightmap, Plates). The Climate tab works a paused preview's climate out by itself (about a second; its
legend says "Preview climate"); a legend card sits beside the planet; the "?" tooltips are drawn over the page (V1's are
clipped by the scrolling panel). A world runs its history and shows the planet as it builds, then the whole history is a
timeline to scrub and play; changing the terrain resolution redraws the same history (only the plates' resolution needs a
new build). **Extend history** runs a finished history on, 20 Myr at a time in the worker that ran it, until Stop
extending (`simulate`'s `resume`: the pieces are the
one history, bit for bit; the link records how far — `more=` — and rebuilds it; it stops for good at a memory budget,
~13,000 Myr at 40K). Its views are V1's:
Terrain (the lab's relief, or one of fifteen other palettes — maps and other worlds; "Blue Marble (by height)" colours by
height alone), Heightmap and Plates, globe (in V1's space: stars,
atmosphere, sunlight glinting off the sea) or map (centre longitude), grid, and V1's hover readout with the crust's age
and setting. **Add detail** (the code's *finish*) sculpts the moment shown again, with care, at a detail of its own (160K · 640K · 2.5M · 10M
cells; phones up to 640K; plans/V2_FINISH_PLAN.md): the surface domain-warped and roughened on high ground; the climate
calculated on it; the rivers carving longer with the climate's runoff (rain less evaporation), dry basins left closed —
flat pans where inflow and evaporation balance (the carve's `sink` / `base`); sediment laid down (fans, floodplains,
deltas); soil creep where it is wet and warm; an Earth-like last ice age (U-troughs, fjords, scoured lake hollows,
moraines, basins still sunk by the ice); and the wind (sand seas with dune ridges at 10M, pans, loess). It runs in its
own worker (which alone holds a 10M-cell mesh) and returns an equirectangular picture of heights and the ocean, painted
like the live terrain; one moment is kept in detail per history (the one before is let go once the next is done, so a cancel loses nothing). A finished moment brings **its own
climate, at its detail**: the grid's climate from the finish's climate stage, each cell's own (its height, its relief)
again on the finished surface — the climate tabs (Köppen, temperature, rain, wind, currents) and the readout use it,
drawn per pixel of the finished picture. **Satellite** (finished moments only; plans/V2_SATELLITE_PLAN.md): the planet as
from space, cloud-free, for the Year, January or July — each cell's cover from its twelve months (`finish-cover.js`: tree,
grass and bare shares by wetness and warmth through S-curves, so biomes blend; needle-leaved or broad, evergreen or
deciduous; grass green or dormant — golden with drought, brown with cold; a snowpack through the cold months, hidden in
part by forest canopy; ice caps), mixed in linear light from reference colours fitted to NASA's Blue Marble over Earth's
own observed climate, each climate's mean moved toward its own colour for the season (Blue Marble's mean per Köppen class,
greens made livelier) the deeper inside the climate (none at its edge, so transitions stay the cover's own, warped
and roughened by noise); the rain the cover reads a little smoothed, warped and roughened (less splotchy); each kind of ground tinted by warped noise between
a few natural colours (red, pale, dark or grey ground; lusher, olive or khaki grass; deeper, olive or bluer forest), with
a fine brightness mottling; the terrain (S2): tree and snow lines
by each place's full height, rock and scree on rugged or steep ground (most where dry or cold), in dry country greener
pole-facing slopes and valleys, the wind's sand seas, loess and the flood basalt that still caps the ground, and a flow
texture — an earthy tint by the area each place drains, so every valley network shows faintly; the sea dark by depth with lighter shelves and warm turquoise shallows, sea ice in its season, lakes
frozen in a cold month; the readout names the ground's biome. **Rivers and lakes** by the climate
(`finish-hydro.js`): discharge in m³/s from each place's runoff, less what dry river beds lose; each river's year — its
monthly flows from each month's rain and snowmelt (and groundwater draining back slowly), routed down the rivers — and
its regime: permanent, permanent with a yearly flood season (the Nile's), seasonal, dry most of the year; every river ends at the sea: a
lake stays only where its river fills it and it is big for its river, and passes all its water on; anything smaller —
or a basin its river cannot fill — is cut through by a gorge to its floor (old basins that overflow have cut their rims
down; the ice age's hollows are lake districts); no closed basins, no dry land below sea level (a sunk basin's pit is
filled in to sea level); only the real oceans are sea. Drawn on the Terrain view as a flow map (hairlines, stronger for bigger
rivers, seasonal ones dashed; a River Density choice; a Rivers & Lakes toggle; Colour by Regime with a legend; the readout
names a river's discharge, regime and flood months, and a lake's kind). Measured (20K plates, desktop): 640K
~8 s, 2.5M ~15 s, 10M ~53 s the first time (~40 s after: the mesh is kept), the browser ~3 GB above the page at 10M.
**Export** (on the timeline once the moment shown is finished; `js/evolution/export.js`, PNG files by `js/view/png.js`):
a 16-bit heightmap with the sea floor on a fixed scale (black −11 km, white +9 km — the same shade the same height on
every planet), a 16-bit land heightmap (the sea black, land 0…+9 km; re-imports on the Import Heightmap page, which
reads white as 6 km), a land mask, and the colour map as the Terrain view shows it (palette, lakes, rivers); at the
finished picture's width (4096, 8192 at 10M, 2048 on phones) or a half or quarter of it, averaged down; named by seed and
moment (`orogen-evolution-12345-760Myr-heightmap.png`).
The **Climate** tab gives the moment shown the new climate (`js/climate/`; Köppen, temperature, rain,
winds, currents — about a second, in a worker), kept per moment while the history is open. Its code is
`js/evolution/` (the shell, and `terrain-player.js`: per-frame terrain for frames that stream in); plan and status in
[`plans/V2_FULL_PLANET_PLAN.md`](../plans/V2_FULL_PLANET_PLAN.md). The rest of this section is the lab.

```
node tuning/dev-server.mjs 8123        # any static server works; there is no build step
open http://localhost:8123/v2/         # the lab; ?phase=1, 2, 3, 4, 5, 5b, 6a, 7a, 7b, 7c, 8a, 8b; &seed=…, &scene=india, &mobility=3.5 …
```

The lab is a test bench, not the product: each phase has a scene that isolates one mechanism, an
on-screen checklist of what to look for, live numbers, and a time scrubber. Space = play/pause,
← → = step a frame. It works on a phone (bottom sheet, tap to inspect). From 8a on the lab draws terrain on a finer
mesh than the sim's (a drop-down: 160K / 640K / 2.5M cells) and has a **Cross-section** tool: click two points. The
terrain labs also offer the **Sim resolution** — the plates the history runs on: 40K cells (121 km, the default), 80K
(86 km) or 160K (61 km); `&sim=80000` in the URL — the same planet in km and Myr, on finer plates, and slower to build.
The whole-planet scenes (600 Myr, and the 1200 Myr supercontinent cycle) have an **End as** drop-down (`&ending=`
supercontinent / breakup / dispersed): the history runs on past its length until the world is in that stage of the
cycle (at most 1000 Myr further) and stops there — the same history, only ending at a moment of that kind; a longer
run already made is cut rather than run again. They also chart the cycle (the largest landmass's share of the
continental crust, how many landmasses, the heat left under the last supercontinent, a tick per rift) and have a
**Mantle** layer: the mantle's heat, its flow as arrows, the upwelling and downwelling as markers.

```
node v2/tools/check-phase1.mjs         # … 2, 3, 4, 5, 5b, 6, 6b, 7, 7b, 7c, 8a, 8b, 9, 10, 11, 13 — headless acceptance checks, PASS/FAIL, exit code
node v2/tools/check-invariants.mjs     # invariants through whole histories: land never vanishes, dead plates empty, terrane ids, cratons
node v2/tools/check-scale.mjs          # the same scenes at 40K and 80K cells agree in km / km² / Myr; recording rate never changes a history
node v2/tools/trace-forces.mjs india mobility=3.5     # speeds / force-balance targets / situations over time
node v2/tools/trace-collisions.mjs wilson 160          # collision records, events, belt statistics
node v2/tools/render-frames.mjs tug plates            # PNG frames of a scene → v2/out/
node v2/tools/shoot-lab.mjs 4 56 http://localhost:8123 scene=india   # screenshots + page smoke test (needs the server)
node v2/tools/probe-play.mjs 8b history 40     # presses Play headlessly: frames painted, the page's long tasks (EXTRA=cells=2500000)
node v2/tools/bench-lab.mjs 2500000           # the lab's terrain pipeline piece by piece: timings + output hashes (is a speed-up exact?)
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
                     forces:        forces (at boundaries; and the mantle flow's drag on continents), torque-balance
                                    (updatePlateMotion)
                     events:        hotspots (plumes, LIPs, tracks, the mantle's heat), supercontinent (the cycle:
                                    landmasses counted, the mantle's upwelling and downwelling, its flow), collision
                                    (records, suture / docking), orogeny
                                    (belt spreading, underthrusting), wings (trench wings, island arcs — as wide as their distance from
                                    continents allows: a Mariana at sea, a Japan near land), margin-isles
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
  ending.js        choose your ending: a history run on until it is in a stage of the supercontinent cycle
  measure.js       measurements on Frames (margins, tallies, force situations), shared by the lab and the checks
js/terrain/        heights from a Frame (Phase 8), in km, on a terrain mesh of any resolution —
  terrain-config   every terrain tunable, in km / Myr (TERRAIN; terrainConfig(overrides))
  anchor           the fine detail belongs to the crust: plate-frame positions for noise, per-crust-cell random streams
  cratons          Phase 10: a craton's edge as a line on each plate's raster, the foreland a range bends into it,
                   each craton's character (sag basin, swell, flat shield)
  carve            Phase 8b: rivers carve the surface — the stream power law solved analytically in time along a
                   routed river network (Tzathas et al. 2024), coarse to fine over the sim and terrain meshes;
                   carve-worker carves whole frames off the page's thread
  terrain-mesh     the terrain mesh (cached per size) and sampleOnto: each terrain cell's 3 sim cells + weights,
                   looked up through a smooth noise warp so the sim's cells never show (the warp read from a table
                   precomputed on a cube map — within ~0.3 km of the noise, a fifth of the cost)
  records          step 1: the Frame read into per-sim-cell fields — signed coast distance, shelf / plain / slope by
                   kind of coast, sea-floor depth and age, trenches, the isostatic platform, and per belt: kind (type +
                   side of a collision), distance from its front, reach, relief, obliquity, the across-strike direction
  profiles         cross-sections of each kind of belt (WBP VIIa): crests, valleys, plateaus, basins vs distance from the front
  stripes          the parallel ridges inside a belt: phasor noise on kernels aligned across the strike (en-echelon
                   along transforms), faded where the mesh is too coarse to show them — summed at the corners of each
                   plate's raster and carried to the points between (stripeCarry; ~3 waves a point instead of ~28, the
                   same ridges to the eye); crossAt, the distance across a
                   belt as its kernels carry it (smooth, bending with the front) that the ridge noise is read at
  volcanoes        cones: hotspot islands / seamounts, island-arc chains, Andean stratovolcanoes
  lips             flood basalts on land: each province's pieces (centre, radius, age) and its radiating dyke swarm
  near-lists       which point features can reach a sim cell's terrain points
  synthesize       synthesizeTerrain(frame, simMesh, terrainMesh) → heightKm (+ components) = preparePlan (per frame)
                   + surfaceRange (any range of cells); hypsometry()
  terrain-pool     the same synthesis on worker threads (terrain-worker.js), bit for bit — each frame's plan built
                   once, by the first worker, and handed to the others over message ports; mesh-worker builds a
                   terrain mesh off the page's thread; shade-worker hillshades the frame shown, so the page's thread
                   only paints
js/view/           DOM-free painting: equirect raster (MapRaster for sim cells, SmoothMapRaster blending a fine mesh),
                   palettes (colours AND the name tables, e.g. OROGENY_NAME), terrain-shade (hypsometric tint, hillshade),
                   png (PNG files in the browser: 8/16-bit greyscale by hand, colour through a canvas; the download)
js/evolution/      the Evolution page: its shell (evolution-main), terrain-player (per-frame terrain as a history streams in), looks (palettes, heightmap, readout words), climate-view + climate-worker + climate-fields (the climate of a moment, on request or a finished moment's own; the Satellite view), finish-view (the Finish step's worker and painting), export (a finished moment's maps as PNG files)
js/finish/         the Finish step (plans/V2_FINISH_PLAN.md): finish.js (the stages, and the picture of heights), finish-worker,
                   finish-config (its tunables, in km / Myr / °C / mm), finish-grid (a lat-lon grid for smooth regional fields),
                   finish-basins (closed basins), finish-sediment (fans, floodplains, deltas; creep by climate),
                   finish-ice (the last ice age), finish-wind (sand seas, dunes, pans, loess), finish-hydro (rivers, their
                   regimes, lakes), finish-cover (the land's cover and its colours from space)
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
   → **events**, in this order — `updateHotspots` (first: it only stamps records) · `trackCycle` (the supercontinent
   cycle: counts the landmasses, moves the mantle's upwelling and downwelling; reads only) · `trackCollisions` · `growWings`
   · `buildArcs` · `collapseArcs` · `growMarginIsles` · `riftContinents` · `openBackArcs` · `initiateSubduction` ·
   `closeRemnantSeas` · `matureArcs` (arc crust welded onto a continent turns continental: how continents grow) ·
   `tidyPlates` → if any changed crust: refresh, `resolve` and classify again → `drive` (next velocities: a scene's
   prescribed motion, or `updatePlateMotion`) → `steerBackArcStrips`. `evolveHeights` (erosion of the height records,
   below) runs before `drive`. Steps are adaptive (a plate moves at most a
   cell per step) and never cross a multiple of `stepGridMyr`, so how often a history is recorded never changes it.
4. **Forces come from boundary state**, not velocities: trench flags, crust type and age, slab length. `D·ω = T` per
   plate, with basal drag, slab resistance and a viscous collision lock in `D`. Speeds are never scripted. One force
   is not at a boundary (Phase 13): the **mantle flow** drags on continents' roots — out from the upwelling under the
   last supercontinent (as strong as the heat the supercontinent left there), toward a downwelling ~90° from it (once
   the supercontinent has begun to break up). It is small next to slab pull, and left out of a plate's tension.
5. **The supercontinent cycle** (`step/supercontinent.js`, Phase 13): a continent's rift chance grows steeply with the
   mantle heat under it (`riftHeat*`; a rift's pieces still over hot mantle may rift again soon, `riftTenureHotMyr`), so
   a supercontinent that has sat long on its own mantle breaks up in a burst, and pieces that have drifted onto cool
   mantle hardly rift; the mantle flow spreads the pieces and gathers them again, and a new supercontinent (the largest
   landmass holding `superShare` of the continental crust for `cycleHoldMyr`) moves the upwelling under itself and the
   downwelling to a new point 90° away (its own seeded stream). Rifts follow old sutures, failed rifts and rifted
   margins about half the time (`riftWeaknessCost`), and otherwise the crust's grain — a smooth field in each plate's
   own frame (`riftCurve*`, `riftJag*`) that bends a rift and makes it jagged, instead of a straight cut. The cycle's pace is steered (developer: the next supercontinent
   "shouldnt happen until like 600 [Myr] in"): each supercontinent draws a period (`cyclePeriodMin/MaxMyr`); its pieces
   disperse — kept apart (`dispersalRepulsion`), the young oceans between them rarely foundering, a landmass that
   gathers too soon rifting readily — then gather (the pull toward the downwelling, full strength until
   `mantleInflowPackKm` from it), and the new supercontinent is held together until it first rifts. Landmasses are
   counted with land joined only by a neck under `cycleNeckKm` apart, so a supercontinent is one mass, not a chain.
6. **Rasters are rigid — except at a suture.** The one time crust is deformed is when two plates weld
   (`ops/merge-plates.js`: the lower is resampled into the upper's frame and the outlines are redrawn).
7. **Frames are the only interface downstream.** Views, stat panels and checks read `Frame`s (`snapshot.js`), the
   helpers in `measure.js`, and the event log; nothing downstream reaches into plate rasters.
8. **Belts record their geometry** for the terrain: every cell a belt shapes keeps where across the belt it lies
   (`beltU`, 0 at the front), how far the belt reached, which side of a collision it is on and the obliquity of the
   convergence (`crust.belt*`, written by `spreadBelt`). Scalars in the plate frame, so they never need rotating; the
   ridge direction is recovered at terrain time (straight away from the nearest front cell). When a newer orogeny
   takes a cell over, the old belt's record moves to `crust.prev*` (one layer deep), and the terrain shows it under
   the new one.
9. **Heights evolve with the history** (`step/heights.js`; records only — the history never reads them, and its event
   log is the same with or without them). Each crust cell carries an erodible root (`rootKm`, grown exactly as belts
   thicken the crust; Airy isostasy), a broad uplift (`upliftKm`, raised toward the belt's cross-section at the pace of
   the convergence its front absorbs, never lowered by a newer belt; foreland basins sink below 0), the size of its
   belts' crests (`rugged`, `prevRugged`) and a hotspot volcano's wear (`volcWornKm`). Every step erodes them at the
   latitude the cell is at then (faster where it rains more, and poleward under ice) and smooths the uplift sideways a
   little, never into the sea nor onto a craton's core (a belt reaches only a craton's rim, `cratonRimKm`: a low,
   thin-skinned fold-thrust belt over the shield's edge, with no thickening). So orogenies accumulate, and an old belt that drifted through the
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
of the belt's own uplift; the phasor sum taken at the corners of the plate's raster, where it rides with the crust, and
carried to each point from its three corners by continuing each corner's wave — `stripeCarry` 0 sums every kernel at
every point, the same look and ~30 % slower at 2.5M), ridge noise — simplex noise drawn out ~8× along the strike (read at the distance across the
belt, fast, and the position along it, slow), so its highs and lows run with the range — and cones. The first
continents are not flat: when the history starts they get broad swells (`baseKm`, up to `baseReliefKm`, half on
shields) that wear down like the rest of the relief and steer the history's rivers into the lowlands between them. Belts come in two layers — the current one and the one it overprinted, at half
strength with its own grain — and each corner's share is scaled by noise of its own, so kinds of ground interfinger.
Every erosion clock runs faster where it rains more — a hard-coded zonal-mean rainfall by latitude, with ice keeping
the high latitudes eroding (terrain-config.js rainByLatitude, glacialErosion; erosionAtLatitude), and faster on high
ground than on low (erosionAtHeight): old ranges linger as low hills. Volcanoes are irregular massifs, not cones: an
edifice with a noise-warped outline, broad ridges (rift zones, arc ridges) running out from the summit, gullies in the
lower flanks, sometimes a flank collapse. Flood basalts come in every size and shape (2026-09-29; the history's
`eruptLip`: 0.15–4 Mkm² log-uniform, one to four elongated flows off the plume, a warped ragged edge, nearly even
thickness — a plateau, not a dome) and are cut up as they wear along their drainage, not by a noise: the history records
how far each province has worn (`volcWornKm`, by the rain of its latitude), and the carving (`carve.js` stripBasalt)
strips the cap where its escarpment has retreated from the province's edge or its rivers' valleys have widened through
it — rates × the wear's age, a river's valley only once it has cut through the pile, the slopes widening as they retreat
(to `lipWallKm`) and wandering with a noise — so a young province is a plateau with canyons, then a dissected plateau
(the Deccan), then flat-topped hills along the divides, then remnants; the slopes are faintly benched
(terraceBasalt at `lipStairShare`); and its dykes radiate from the plume's centre as a wavy, fanned grain that comes out
from under the lava across its edge. The fine detail belongs to the crust (`anchor.js`): noise is read in the frame
of the plate under each point, and ridge kernels and volcanoes are keyed to crust cells — scrub the history and a
drifting continent carries its ridges and volcanoes with it. So does what they ride on (Phase 9): a frame carries every
plate's crust (its cells, their types and belts — the world view shows only the crust cell nearest each world cell, and
~15 % of a moving plate's cells are nobody's nearest), the coast distance, shelves and belt directions are measured on each
plate's own raster, and the terrain reads a moving plate's records over that raster (`anchorRecords`), so coastlines,
belt edges and ridges ride with their continent instead of re-forming at the scale of the sim cells as it moves. The fine
detail is not frozen for good, though (`detailRenewMyr`, 150 Myr): the ridges' phases drift, each at a rate of its own,
and the bays and headlands, the ridges' segments and crests and the ridge noise fade from one noise over to the next —
from one frame to the next nothing moves, while over a few hundred Myr the landscape is re-sculpted. Cratons meet the
ranges pressed against them as real shields do (Phase 10, `terrain/cratons.js`): the craton's edge is a line — the
signed distance to it on each plate's raster, moved by noise — not the sim cells' staircase; a range's foothills fade
across its rim; in front of them a foreland bends the shield down under the range's weight (a lowland ~0.1–0.3 km below
the shield beyond, then a low forebulge), except where a plateau's back meets the block and the front stays steep;
scraps of craton inside a range read as the range; and each craton has a character — a shallow sag basin, a broad swell
or a flat shield (`cratonCharacter`) — with a faint grain of domes and keels. Trapped pockets of
ocean crust smaller than `pocketSeaKm2` are lowland, and a margin's kind (so its shelf width) holds along
`coastKindKm` of its coast. In the lab, the erosion clocks marked "re-runs the history" rebuild the history (in its
worker) with the new constants; the history itself comes out the same. The lab builds the frame shown, then the ten frames
next to it the way you are moving (five behind) in the background (heights only, within a memory budget), so scrubbing
and playing near it need no building, and playing waits for a frame still being built; sea level and hillshade only
re-shade.

**Rivers (Phase 8b, `carve.js`).** The tectonic surface is carved by the stream power law, solved analytically in time
along the river network (Tzathas, Gailleton, Steer & Cordonnier 2024): after `carveTimeMyr` a point stands where the
ground downstream stood, the erosion wave having travelled up at k·A^m, plus the rock uplift gathered on the way —
with a short time (0.75 Myr) a valley floor drops only to the ground a little way downstream, so rivers descend with the
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
**At high terrain detail (Evolution, 2026-09-29; plans/V2_FULL_PLANET_PLAN.md).** The coast distance is read with each
sim cell's slope (`coastCurve`: Σ wᵢ (dᵢ + ∇dᵢ·(q − pᵢ)) — exact at the cells, seamless along edges), so coastlines
curve between the sim cells instead of running straight across each triangle; below the coast noise, octaves of coast
detail down to what the mesh can show (`coastDetailKm`, none at 160K). A second lookup warp works at the sim's own
scale (`cellWarp`: waves of a few sim cells, in sim cells so 20K gets as much as 80K) — read in the frame of the plate
under the point everywhere, off the rasters too, so it rides with the crust. The uplift and the platform are read
with each cell's slope as well, kept within each cell's neighbourhood range (`mountainCurve`), and a belt's crests at
the distance across it that the ridge kernels carry (`crestFollow`: a main crest is one curved line, not a zig-zag).
Hills go down to what the mesh can show, more on high ground, none at the shore (`hillsKm`); island arcs are cut
into chains of islands by a noise of islands (`arcStraitKm`: straits are shallow sea; a broad arc keeps its interior).
In `carve.js`: drowned valleys where hills and mountains meet the sea — each big valley lowered near its mouth along
the river, the sea then flooding in only where it connects (rias, fjords; `drownKm`) — and submarine canyons from big
rivers' mouths down the shelf and slope (`canyonKm`). Both fade out where the mesh cannot draw a valley (160K).
Evolution's page colours the Terrain and Heightmap layers per pixel from the blended heights
(`SmoothMapRaster.paintHeights`), so a shore is the heights' zero line — crisp — not land and sea colours blended across
a mesh triangle.
**No crest is a line (2026-09-29).** A belt's crests lie at distances from its front — contours of a smooth field, so
unbroken curves: thin crest ridges "too perfect and connected" (developer), and rings and crescents where the front is a
blob. Every crest is now spread by at least `crestBaseKm` (a Gaussian of that σ: exactly lower and wider, its bulk the
same — `profiles.js`) and made of broken, branching ridges: a ridged fractal (`crestRugged`, the massif's octaves, read
in the crust's frame) raises and lowers it. Old crests spread a little more with time quiet (`crestSpreadKm`, √ of the
time), the parallel ridges and ridge noise wearing slightly by wavelength (`crestTextureShare`); a faint rounded massif
texture (`massifKm`, `massifShare`). The parallel ridges are strong again, their troughs deeper than their crests are
high (`stripeShare`, `stripeLowGain`). The history is unchanged (its uplift uses the unworn profile).
**Scale invariance:** all lengths are km; noise is a function of position; waves shorter than ~2 terrain cells are
faded out, not aliased. `check-phase8a.mjs` compares 160K, 640K and 2.5M cells sim cell by sim cell.
A phase that draws terrain sets `displayMesh` (its layers paint terrain cells) and may offer `profileAlong` (the
cross-section tool); see the `Phase` typedef in phase-kit.js.

## Performance

Every optimisation so far is EXACT — the output does not change by a single bit — and is checked that way: a hash of
a 600 Myr history's event log and of every frame, and of the terrain's heights, before and after. The history
(single-threaded; steps depend on each other) ran 39 s → 26 s for 600 Myr in Node: precomputed search rings, lookups
skipped for the unrotated background and far from a plate's crust, each plate's lookups reused between the two
resolves of a step, contacts cached per resolve, scratch arrays reused. One change that is not exact (Phase 12): a
step may take two closing plates 1.5 cells, not 1 — a third fewer steps (600 Myr ≈ 27 s at 40K, ≈ 63 s at 80K,
~2.5 min at 160K). In the lab the history runs in a worker, so the page never freezes, and its frames come back packed
(tectonics/frame-pack.js: each mostly-empty record field as the cells that differ from its background, lossless) — a
600 Myr history in ~65 MB at 40K instead of 273, ~240 MB at 160K instead of 1.1 GB. Terrain is spread over workers (every cell depends only on its position and the per-frame plan, which
one worker builds and hands to the others): a whole-planet frame at 2.5M takes ~5.4 s on one thread, ~1–1.3 s on 8
workers (~0.4–0.5 s at 160K–640K); the terrain mesh is built in a worker while the history runs. Then the lab builds
the frames next to the one shown ahead, in the background (the ten nearest the way it is moving, five behind; heights as
16-bit metres, 320 MB at most — 64 MB on small devices) — not the whole history, which kept every core busy for
minutes; the page itself only paints (records, hillshade and carving all run on workers). Once
built, a frame shows in ~0.15–0.35 s at 640K and ~0.3–0.75 s at 2.5M in Chrome (re-shading only, on the shading
worker). Carving (8b) takes ~0.1 s at 160K, ~0.3 s at 640K and ~0.9 s at 2.5M on its worker, pipelined with the next
frame's surface.

A later exact pass (2026-09-28; plans/V2_PERFORMANCE_PLAN.md — hashes of four histories at 20K–80K and of every output of
the terrain pool): the supercontinent's push without a string per pair, nearest-crust searches not repeated for a plate
and point, per-cell arrays and per-step allocations gone, a fixed noise field computed once per cell, each mesh edge's
length computed once (the distance searches) — the Evolution history (the supercontinent cycle, 40K, 600 Myr)
39.7 → 36.1 s (−9 %; −8 % at 80K) on the 8-core, 16-thread development desktop. A second carving worker carves two
frames side by side at 2.5M only (−12 % a frame playing ahead; slower at 640K). Tried and reverted: every synthesis
worker planning the frame itself, and more synthesis workers than cores (both slower: the heights are noise arithmetic,
which a core's second thread barely helps). A multi-threaded history was assessed (~1.3× at best on 8 cores) and not
built; the plan lists approximations that would take a large share off, for the developer to choose.

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
