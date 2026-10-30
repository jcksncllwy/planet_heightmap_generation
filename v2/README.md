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
history length, ending, the planet's **Temperature** (−30…+30 W/m²) and **Precipitation** (±50 %) — the climate's
options (`greenhouseWm2`: a radiative forcing in the energy balance; `precipScale`: the evaporation in the rain budget — so the ice, winds, currents and rain answer them), for the preview climate and Add detail alike; they change the climate only, so
previews are worked out again when shown and a detailed moment says it was made with the old ones (in the link: `greenhouse=`,
`rain=`) — and **Quality** (Fast 20K plates / 160K terrain · Balanced 40K / 160K · Best 80K / 640K · Custom,
which shows the two resolutions), with Build This World — then the **context card**, and **View** (terrain colours,
globe or map, grid, auto-rotate, playback speed, stats). The context card names the moment shown, a **Preview** or
**Detailed** badge, and the one thing to do next — **Add detail** (with its Detail level), **Cancel** while it runs, or
**Export** — its button mirrored on the timeline, beside the moment; on the detailed moment it holds the rivers' options,
elsewhere a note that adding detail replaces it, with a link back to it; **Extend history** once the history has reached its end.
The timeline is play, scrub and the time, with the badge (no Live button: its rail shades the time computed so far,
scrubbable while the rest fills in). On a phone the collapsed bottom sheet shows the moment and what is going on in a
line. A first-run **tutorial** (the "?" opens it again) sits over a history already building. The layers sit over the
planet (Terrain, Satellite — locked on previews — Climate, its own row: Köppen, temperature, rain, wind, currents, a
More… menu with Generate's other Inspect layers — pressure with the ITCZ, upwelling, ice, temperature range, rain shadow,
aridity, growing season, rain seasonality — and the season — Heightmap, Plates). The Climate tab works a paused preview's climate out by itself (a few seconds; its
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
and setting. A sea cut off from the world ocean (the largest body of water; `terrain/world-ocean.js`) has its level set
by its water balance, not by sea level, and a timeline frame has no climate — so it is balanced on the zonal climate the
history erodes by (2026-10-28, `terrain/basin-estimate.js`): the rain by latitude (`rainByLatitude`, falling off inland
over `rainInlandKm`), the temperature by latitude less the lapse rate with height (`tempByLatitude`), and Add detail's own
potential evaporation and Budyko runoff and its own balance (`finish-basins.js closedBasins` / `lakeBalance`: the
catchment's runoff against what its water loses at each level). One that fills is drawn as a lake at its spill level
(the ground of its hollow above sea level drowned too), one that keeps a lake as that lake, at its level, in its own
grey-teal (`terrain-shade.js cutOffTint`, without the glint), and its dry ground as lowland (a playa or a salt flat).
Against Add detail at 640K over three seeds × four moments (`tools/basin-agree.mjs`): the same sign — water standing or
not — on 345 of 386 seas (89 %; 99 % by area); where they differ the zonal estimate is wet and the finish's climate
(rain shadows, monsoons) dry. ~40 ms a frame at 160K in the shading worker, only when a cut-off body is as large as the
finish balances (`basinMinKm2`). The readout and the Stats say it is an estimate. The same on the lab's Terrain layer
(Phase 8a, at its Sea level). **Add detail** (the code's *finish*) sculpts the moment shown again, with care, at a detail of its own (160K · 640K · 2.5M · 10M
cells; phones up to 640K; plans/V2_FINISH_PLAN.md): the surface domain-warped and roughened on high ground; the climate
calculated on it; the rivers carving longer with the climate's runoff (rain less evaporation), dry basins left closed —
flat pans where inflow and evaporation balance, a cut-off sea's salt lake at its level (the carve's `sink` / `base`) — at the finish's own erosion strength
(`erosionStrength` 0–3, 3; developer, 2026-10-15: "break up SOME of the monotony of the ridges"): the stream power's m
lowered and k raised so its erosion climbs further up the headwaters (rivers draining 10⁵ km² cutting as before), the
dissection cut deeper (by drainage area in km², the same at every detail), soil creep shorter and the fold belts' crests
harder — over the mountains 5 % more relief, 13 % less ground above 4 km than at 0; sediment laid down (fans, floodplains,
deltas); soil creep where it is wet and warm; an Earth-like last ice age (U-troughs, fjords, scoured lake hollows,
moraines, basins still sunk by the ice; troughs deeper in soft rock, and where a lobe of the ice slid out over soft lowland
rock it dug a basin below its rim's lowest ground — the Great Lakes, Ladoga, Winnipeg; each a lobe's, at most Superior's
size, a bigger one split where it was dug deepest — kept as a lake behind a sill
of undug ground, or a sound where it opens to the sea; the rock's softness from the tectonic record, `records.js`
`iceSoft`: shields hard, failed rift arms, sutures and forelands soft, young belts and flood basalts harder) — and its
outburst floods: lakes dammed by the ice (water a priority flood holds
with the ice standing as a wall, and not without it) spill over their sills and burst their dams, each flood scouring a
swath of braided channels down its way to the sea as wide and deep as the lake's volume (the Channeled Scablands, River
Warren, tunnel valleys under the ice), its loess stripped and its rock bare on the satellite view, the lakes' floors left
flat with their silts (a hollow a flood's gorge drains, its pockets cut through with it); the wind (sand seas with dune ridges at 10M, pans, loess);
and the coast (finish-coast): the waves of the interglacials' high seas — grown by the climate's winds, storms and all,
over the open water toward a fully developed sea, carried on as swell, none under the sea ice, and traced in to each coast
from 16 directions so headlands take them from all round and bays from their mouths — cut the cliffs back (soft rock and
low coasts fastest) and drift the sand of the cliffs and the rivers along the shore as they meet it slantwise, laying it
where the drift slows: beaches, barriers and filled bays; the sand below the shoreface lost offshore. It runs in its
own worker (which alone holds a 10M-cell mesh) and returns an equirectangular picture of heights and the ocean, painted
like the live terrain; one moment is kept in detail per history (the one before is let go once the next is done, so a cancel loses nothing). A finished moment brings **its own
climate, at its detail**: the grid's climate from the finish's climate stage, each cell's own (its height, its relief)
again on the finished surface — the climate tabs (Köppen, temperature, rain, wind, currents, and More…'s layers) and the
readout use it, drawn per pixel of the finished picture (the land's measures — temperature range, aridity, growing season,
rain seasonality, from each cell's twelve months by `js/climate/cell-stats.js` — kept a byte each on its climate picture). **Satellite** (finished moments only; plans/V2_SATELLITE_PLAN.md): the planet as
from space, cloud-free, for the Year, January or July — each cell's cover from its twelve months (`finish-cover.js`: tree,
grass and bare shares by wetness and warmth through S-curves, so biomes blend; needle-leaved or broad, evergreen or
deciduous; grass green or dormant — golden with drought, brown with cold; a snowpack through the cold months (white once a few cm
lie — the winter tundra and steppe white from space), hidden in part by forest canopy; ice caps), mixed in linear light from reference colours fitted to NASA's Blue Marble over Earth's
own observed climate, each climate's mean moved toward its own colour for the season (Blue Marble's mean per Köppen class,
greens made livelier) the deeper inside the climate (none at its edge, so transitions stay the cover's own, warped
and roughened by noise); the rain the cover reads a little smoothed, warped and roughened (less splotchy); each kind of ground tinted by warped noise between
a few natural colours (red, pale, dark or grey ground; lusher, olive or khaki grass; deeper, olive or bluer forest), with
a fine brightness mottling; the terrain (S2): tree and snow lines
by each place's full height, rock and scree on rugged or steep ground (most where dry or cold), in dry country greener
pole-facing slopes and valleys, the wind's sand seas, loess and the flood basalt that still caps the ground, and a flow
texture — an earthy tint by the area each place drains, so every valley network shows faintly; the sea dark by depth with lighter shelves and warm turquoise shallows, sea ice in its season, lakes
frozen in a cold month; the readout names the ground's biome. On the page the land is drawn in its climates' colours by height
(`evolution/sat-style.js`): each family of climates (rainforest, savanna, desert, steppe, Mediterranean, temperate,
continental, taiga, tundra, ice) its lowland colour up to its tree line, then dark grey-red rock with a little of the biome
under it, grey rock and snow — a summer and a winter version (the lines lower in winter), each place by its latitude in its
own season and the even mean toward the equator (nothing flips there); the families blended over ~60 km, their edges
warped by fractal noise; an ice sheet's edge kept sharp; cold dry climates in the tundra's colours; the rivers' banks
greener the drier the climate and season (none under snow); the picture above's fine detail as brightness, and a quarter
of it over all for its texture; its snow where the climate has snow in the season shown. The sea ice is drawn with a
sharp, noise-ragged edge and loose floes where the cover is partial. **Rivers and lakes** by the climate
(`finish-hydro.js`): discharge in m³/s from each place's runoff, less what dry river beds lose; each river's year — its
monthly flows from each month's rain and snowmelt (and groundwater draining back slowly), routed down the rivers — and
its regime: permanent, permanent with a yearly flood season (the Nile's), seasonal, dry most of the year; every river ends at the sea: a
lake stays only where its river fills it and it is big for its river, and passes all its water on; anything smaller —
or a basin its river cannot fill — is cut through by a gorge to its floor (old basins that overflow have cut their rims
down; the ice age's hollows are lake districts). A gorge keeps its river's own course through the basin, every bend of
it, unless a shortcut is enough less work — the rock cut and a little for the length: along its own course a river does
only `riverDirectness` of the work (0.1), so a bend is cut through only where the way round is over ten times the
shortcut's (the worst hooks and tangles across drained basins — developer, rivers "that go back and forth", but "some
windyness is good"; 0 keeps every course, 1 takes the way of least work); a land basin closed only where its rivers cannot fill it (see *Closed basins at any height*), and no dry land below
sea level except a cut-off sea's (below). **The world ocean and the seas cut off from it** (2026-10-27,
`terrain/world-ocean.js`, `finish-basins.js`): the sea is the water below sea level joined to the largest body of it — the
world ocean; a body below sea level that does not join it has its surface set by its water balance, not by sea level (the
Caspian at −28 m, the Dead Sea at −430 m; the Mediterranean drawn down 1.5–3 km when the Atlantic was cut off in the
Messinian). A sea behind a low, short barrier (sill ≲ 30 m, ≲ 160 km of dry land — a strait narrower than the cells) is
first opened into the ocean. Any other is a closed basin: its lake grown from its lowest point, as water rising in it
would — a pocket behind a ridge only once the water tops it — until what evaporates off it (open water: 1.2 × the land's
potential evaporation, Penman 1948, less the rain on it) outweighs what flows in (its catchment's runoff, less what dry
river beds lose). Water balance settles in thousands of years, at once on the timeline's scale: the finish solves its
equilibrium. Full to its rim, it spills (its outflow cut down through the rim, a fresh lake just above sea level); short
of it, a salt lake at its own level — below sea level, or above it in a basin whose rim is higher still — or, where too
little flows in for a lake the map can show, a playa: a flat on its floor, the basin round it dry ground below sea level
(the Qattara at −133 m; the Messinian floors 2–3 km down). Its floor is the history's, filled by its rivers while it was
cut off (`tectonics/step/sea-fill.js`); it is no longer filled here as well (until 2026-10-27: toward ≤ 1 km below its rim,
a playa toward 120 m, and any body over 250 000 km² with water below 1 km counted as the ocean, full at sea level). The
rivers carve down its dry slopes to its water — their base level its level, not sea level (the carve's sea is the world
ocean) — and the fans spread on its dry floor. Checked against Earth (`check-basins.mjs`): the balance gives the
Caspian's 371 000 km² from the Volga's inflow within ×1.5, the Dead Sea's ~1000 km² before its river was drawn off, and
the Messinian's drawdown in ~1 000 years; reported over three histories against Earth's closed seas. A land
basin (or a full trapped sea's lowland) left without water drains whole: every
pocket in it (a sub-basin behind its own sill, which the gorge from the basin's floor does not reach) gets its own gorge
out from its lowest point. Drawn on the Terrain view as a flow map (hairlines, stronger for bigger
rivers, seasonal ones dashed; a River Density choice; a Rivers & Lakes toggle; Colour by Regime with a legend; the readout
names a river's discharge, regime and flood months, and a lake's kind). Measured (20K plates, desktop): 640K
~8 s, 2.5M ~15 s, 10M ~53 s the first time (~40 s after: the mesh is kept), the browser ~3 GB above the page at 10M.
**Export** (on the timeline once the moment shown is finished; `js/evolution/export.js`, PNG files by `js/view/png.js`,
the ZIP by `js/view/zip.js`): the colour map as the Terrain view shows it (palette, lakes, rivers); the Satellite view
for the year, January or July (as shown: no grid, no glint); the Köppen climate zones in their own colours, unshaded;
a 16-bit heightmap with the sea floor on a fixed scale (black −11 km, white +9 km — the same shade the same height on
every planet); a 16-bit land heightmap (the sea black, land 0…+9 km; re-imports on the Import Heightmap page, which reads
white as 6 km); a land mask; and the rivers and lakes alone on a transparent ground (the Terrain view's density and
colouring). **Export All** saves one of each (Satellite for the year) in one ZIP. Widths from 1024 to 16384 px (4096 on
phones): up to the finished picture's own (4096, 8192 at 10M, 2048 on phones) drawn from its detail, narrower ones
averaged down; wider ones enlarged for use downstream (developer, 2026-10-17) — heights by a clamped bicubic, coasts,
lakes and climate zones by the weighted majority of the nearest pixels, satellite colours blended, then painted at the
full width (`finish-view.js rasterAt`), so the shading, the coasts and the rivers' lines stay sharp. Named by seed and
moment (`orogen-evolution-12345-760Myr-heightmap.png`, `orogen-evolution-12345-760Myr.zip`).
The **Climate** tab gives the moment shown the new climate (`js/climate/`; Köppen, temperature, rain,
winds, currents — seasonal in the tropics, fading out by 60° — and More…'s layers, with Generate's colours and legends
from `js/climate-layers.js`; a few seconds, in a worker), kept per moment while the history is open. Its code is
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
node v2/tools/check-basins.mjs         # cut-off seas: the water balance against the Caspian, the Dead Sea, the Messinian; three histories finished, reported against Earth
node v2/tools/trace-forces.mjs india mobility=3.5     # speeds / force-balance targets / situations over time
node v2/tools/trace-collisions.mjs wilson 160          # collision records, events, belt statistics
node v2/tools/render-frames.mjs tug plates            # PNG frames of a scene → v2/out/
node --max-old-space-size=16000 v2/tools/render-moment.mjs --seed 799224 --cont 30 --time 290 [--cells 2500000] [--crop lon0,lon1,lat0,lat1] [--probe lat,lon;…] [--lakes] [--rivers [q0]] [--set key=value,…] [--debug] [--live [--plain]]
                                       # a detailed moment (Add detail) headlessly, painted as the page paints it → v2/out/moments/; its lakes, its cut-off seas, any empty basins, its coast's shape
                                       # (--live: the timeline's frame before any detail, at --cells, its cut-off seas tinted; --plain: as before they were)
node v2/tools/coast-shape.mjs --seed 626225 --cont 30 --time 950 [--cells 1000000] [--bands] [--finish]
                                       # the coastline's divider dimension D and L(50 km)/L(500 km) by kind of margin, against Earth; --bands: by source of its shape
node --max-old-space-size=16000 v2/tools/civ-cradles.mjs --seed 12345 --time 300 [--cells 640000] [--seeds 1,2,3]
                                       # the civ layer (plans/CIV_PLAN.md): a finished moment's substrate, resources and ranked
                                       # cradles — maps + cradles.json → v2/out/civ/; --seeds: a census of several worlds
node --max-old-space-size=16000 tuning/civ/earth-check.mjs   # the same cradle finder on real Earth (tuning/civ/fetch-earth.sh first)
node --max-old-space-size=16000 v2/tools/civ-sim.mjs --seed 12345 --time 300 [--origin lat,lon] [--end 0]   # or --earth
                                       # the civ layer's people, 70 ka → now on a human clock: foragers' dispersal, settling,
                                       # domestication centres, farming's fronts, irrigation — timeline.png + summary.json →
                                       # v2/out/civ/sim-*/; on Earth, scored against the record (arrivals, centres, farming)
node v2/tools/shoot-lab.mjs 4 56 http://localhost:8123 scene=india   # screenshots + page smoke test (needs the server)
node v2/tools/probe-play.mjs 8b history 40     # presses Play headlessly: frames painted, the page's long tasks (EXTRA=cells=2500000)
node v2/tools/bench-lab.mjs 2500000           # the lab's terrain pipeline piece by piece: timings + output hashes (is a speed-up exact?)
node v2/tools/history.mjs latest              # the history cache: what the user is looking at in the Evolution page (see "The history cache")
node v2/tools/history.mjs frame --latest --out f.bin   # …that very frame; also frame --seed … --time …, ls, gc, code
node v2/tools/check-history-cache.mjs         # the cache: frames bit for bit, the key, concurrent writers, damaged files
```

After an engine change run `check-invariants.mjs`, `check-scale.mjs` and the check scripts of the phases the change
touches; run all of them before calling a piece of work done. They need `npm install` (delaunator, pngjs; puppeteer
only for `shoot-lab`).

A history is chaotic: a ~4 % nudge of a parameter that has nothing to do with a check (`plumeSpacingKm` 1500→1560,
`mantleCoolMyr` 150→156) sends it down another path. A hard check on an outcome of one history judged that history, not
the physics, so those checks (phases 5, 7b, 8a, 9, 10) are judged over several (`lib/check-kit.mjs`: `checkAcross`,
`medianOf`). The scenes run on seeds 12345 · 1 · 2, and the whole planets on 12345 · 777 · 4242, the histories phase 13
reads too, built once in the history cache. The median goes against the threshold, or most of the seeds must pass. A
scene that did not form on a seed (no weld, no shield where one is looked for, no continent big enough to judge) is
counted and reported, not failed, unless that happens on most seeds.

## Layout

```
js/core/           geometry with no tectonics in it: rotations, sphere index, sim mesh, sphere-geom (distances,
                   centroids), mesh-bfs (hop distances, floods, connected pieces — use these, don't hand-roll a BFS),
                   mesh-locate (the triangle a point falls in, with barycentric weights), min-heap (+ spreadKm: Dijkstra
                   in km over a mesh), mesh-rings (every cell's rings 0–3, precomputed), fast-noise (bit-identical to V1's
                   SimplexNoise, faster); sim-mesh also rebuilds a mesh from its arrays (meshFromArrays: how workers get it);
                   device (SMALL_DEVICE: a phone or a device reporting ≤ 4 GB — the memory budgets that follow it)
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
                                    (belt spreading, underthrusting; an arc's crust thickening while its slab feeds it), wings (trench wings,
                                    island arcs — as wide as their distance from continents allows: a Mariana at sea, a
                                    Japan near land), margin-isles
                                    (fore-arc islands on accretionary margins, coast retreat on erosive ones),
                                    sediment-subduction (the trench's sediment down the subduction channel: the
                                    continent's sink at every trench), trench-fans (the rivers' rock out down their
                                    submarine fans to the trenches they reach, and along each trench's axis),
                                    rifting (when a continent rifts), backarc (slab rollback, back-arc seas),
                                    subduction-init (when a passive margin founders — between two plates, or inside a giant
                                    one: its old ocean then breaks away as a plate of its own; or a plate pressed together
                                    across its open ocean fails there — from the plates' own stresses, plate-stress), ocean-plates (the pre-history
                                    ocean becomes plates; big ocean plates split along a new ridge)
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
  margin-line      the coast's line: the land/sea raster's smooth contour (a Gaussian of a sim cell), the coast distance
                   measured exactly to it; gaussianAt (cached kernels) smooths a margin's shelf and plain along it
  margins          a rifted margin's cross-section from how its crust thinned (McKenzie 1978): the shoreline, the shelf
                   break the sediment builds out to, the coastal plain's flexural width
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
  world-ocean      the world ocean (the water below sea level joined to the largest body of it) and the seas cut off
                   from it — the finish's sea, and the timeline's cut-off tint
  basin-estimate   the timeline's cut-off seas balanced on the zonal climate (Add detail's own balance): lake or dry
  terrain-pool     the same synthesis on worker threads (terrain-worker.js), bit for bit — each frame's plan built
                   once, by the first worker, and handed to the others over message ports; mesh-worker builds a
                   terrain mesh off the page's thread; shade-worker hillshades the frame shown, so the page's thread
                   only paints
js/view/           DOM-free painting: equirect raster (MapRaster for sim cells, SmoothMapRaster blending a fine mesh),
                   gpu-paint (Evolution's moments painted on the GPU: the terrain mesh's triangles drawn flat on the texture),
                   palettes (colours AND the name tables, e.g. OROGENY_NAME), terrain-shade (hypsometric tint, hillshade),
                   png (PNG files in the browser: 8/16-bit greyscale and RGB by hand, colour with transparency through a canvas; the download), zip (a store-only ZIP for Export All)
js/evolution/      the Evolution page: its shell (evolution-main), terrain-player (per-frame terrain as a history streams in), looks (palettes, heightmap, readout words), climate-view + climate-worker + climate-fields (the climate of a moment, on request or a finished moment's own — the sea's drawn fields come carried across the coast from their own side and smoothly refined — grid.js refineForDrawing — so the sea shows no coastal rims, coarse-cell edges or polar wedges; the Satellite view), finish-view (the Finish step's worker and painting), export (a finished moment's maps as PNG files, or all in a ZIP)
js/finish/         the Finish step (plans/V2_FINISH_PLAN.md): finish.js (the stages, and the picture of heights), finish-worker,
                   finish-config (its tunables, in km / Myr / °C / mm), finish-grid (a lat-lon grid for smooth regional fields),
                   finish-basins (closed basins, cut-off seas: their lakes by water balance), finish-sediment (fans, floodplains, deltas; creep by climate),
                   finish-ice (the last ice age), finish-floods (its ice-dammed lakes' outburst floods), finish-coast (waves, cliffs, longshore drift), finish-wind (sand seas, dunes, pans, loess), finish-hydro (rivers, their
                   regimes, lakes), finish-cover (the land's cover and its colours from space)
js/civ/            the civ layer (plans/CIV_PLAN.md): civ-config (its constants, in km / years / persons per km² / kg per ha,
                   each with its source; CIV_PRIORS), substrate (what a finished moment offers people: NPP, foragers, wild
                   crop packages by Köppen, rain-fed and irrigated farming), resources (ores and materials from the
                   tectonic record), cradles (the irrigable alluvia where an Ur could arise, ranked), travel (fronts
                   in km/yr over the mesh, waiting at barriers), sim (the people: density and way of life per cell, 25-yr steps),
                   settle (towns fed by their fields and by water-borne surplus),
                   polity (polities by war, circumscription and collapse, kept century to century; states),
                   climate-var (good and bad years: the climate re-run under its modes; rivers routed) + climate-run-worker,
                   disease (vector fever and snail fever from the months, standing water and the cold filter),
                   civ-page + civ-worker (the Evolution page's People layer: a finish's world resampled to 160K cells, run in a
                   worker, one byte per cell and frame), civ-finish (what the finish gathers for it, only when asked)
js/app/            the lab: shell (lab-main), globe, canvas overlays, phases/ (one module per phase + phase-kit),
                   history-runner / history-worker (a scene's history off the page's thread, frames streamed back),
                   helper-pool / helper-worker (a few workers the history's worker starts: the start world's layout
                   attempts and each rift's junctions, side by side — the same history)
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
   `founderWithinPlates` · `retireBackground` · `splitOceanPlates` (these three on the slow clock; a sea sealed inside one plate founders beneath its shore whatever its size, old or squeezed enough; a plate with no coast to founder at may fail across its open ocean instead) · `matureArcs` (arc crust welded onto a continent turns continental: how continents grow) ·
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
   own frame (`riftCurve*`, `riftJag*`) that bends a rift and makes it jagged, instead of a straight cut. The cycle's pace is the mantle's — no period is drawn: its pieces
   disperse while the mantle the supercontinent warmed is still hot — kept apart (`dispersalRepulsion`), the young oceans between them rarely foundering, a landmass that
   gathers too soon rifting readily — then, once that mantle has cooled to `cycleGatherHeat`, gather (the pull toward the downwelling, full strength until
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
   thicken the crust — saturating toward `crustMaxThickKm` above normal, past which thickened crust spreads under its own weight; Airy isostasy), a broad uplift (`upliftKm`, raised toward the belt's cross-section at the pace of
   the convergence its front absorbs, never lowered by a newer belt; foreland basins sink below 0), the size of its
   belts' crests (`rugged`, `prevRugged`) and a hotspot volcano's wear (`volcWornKm`). Every step erodes them at the
   latitude the cell is at then (faster where it rains more, and poleward under ice) and smooths the uplift sideways a
   little, never into the sea. Ground raised past `collapseKm` (5 km) collapses under its own weight — its uplift and
   root flow out to its neighbours at `collapseKm2PerMyr`, crust moved, not lost — so plateaus level off at Tibet's and
   the Altiplano's heights and widen instead of rising on. A belt's reach is spent against the strength of the ground
   it crosses (the thin viscous sheet: a deforming zone widens as the lithosphere weakens): crust a belt has already
   thickened, and island-arc crust, is hot and weak (`beltHotStrength` × an ordinary continent's), so a long-lived margin
   widens over the crust it thickened — each column there thickening by that share as much, so the same shortening
   adds the same crust however wide it spreads (wider, lower) — while a belt crosses onto a craton only as a low, thin-skinned fold-thrust belt,
   `cratonStrainShare` of its relief, each km of the shield costing `cratonStrength` km of the belt's reach, and the
   shield thickening by only 1/`cratonStrength` as much: cratons are strong, not rigid. So orogenies accumulate, and an
   old belt that drifted through the tropics keeps the wear it took there. Constants: terrain-config.js (`upliftBuildKm`,
   `reliefTauMyr`, `ruggedTauMyr`, `diffusionKm2PerMyr`, `collapseKm`; the columns' `riftCrustKm`…, `cratonCrustKm`…: see
   "One height from the crust" below); a world may carry its own in
   `world.config.heights`.

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
across its rim; in front of them a foreland bends the shield down under the ranges' weight — every belt cell on the
plate a load (its height above what its own root floats), summed as a thin elastic plate bends under point loads
(Kelvin's −kei, over the flexural length of the shield's elastic thickness, `shieldElasticKm`): a lowland up to
`foredeepMaxKm` below the shield beyond, then a low forebulge. A lower plate carries the whole wedge — its own thrusts on
the shield's rim, and the upper plate's front where it is thrust under it (`underthrustKm`) — so its foreland is the deep
one; a plateau's back on an upper plate stands on its own root, so only its crests load the block, and the front there
stays steep;
scraps of craton inside a range read as the range; and each craton has a character — a shallow sag basin, a broad swell
or a flat shield (`cratonCharacter`; a swell or sag is the mantle's — which, and how strong, follows the mantle's heat
under the shield since branch unified-swell — so it rises over `cratonSwellFlankKm` in from the edge, not over a share of
the shield) — with a faint grain of domes and keels. Trapped pockets of
ocean crust smaller than `pocketSeaKm2` are lowland, and a margin's kind (so its shelf width) holds along
`coastKindKm` of its coast. **Passive margins mature** (2026-10-15, `marginMatureMyr`): a passive coast's age is the
oldest ocean floor beside it (the floor that formed as it broke away), or less where its own belt was active since; its
maturity, 1 − e^(−age / 60 Myr) (a stretched margin's thermal subsidence), widens the shelf (of a coast that never rifted; a rifted one: below) from ~40 to ~180 km and the
coastal plain from ~50 to ~240 km, and buries the relief under them by that share — a young rifted margin's shoulders
stand at the sea (the Red Sea), an old one's lie well inland behind a wide shelf and a low coastal plain (the US east
coast). A sea enclosed by land under ~1–4 million km² (`marginOpenSeaKm2`) is filled from its rim instead: its rim
matures into a lowland, but no widening shelf drowns it. In the lab, the erosion clocks marked "re-runs the history" rebuild the history (in its
worker) with the new constants; the history itself comes out the same. The lab builds the frame shown, then the ten frames
next to it the way you are moving (five behind) in the background (heights only, within a memory budget), so scrubbing
and playing near it need no building, and playing waits for a frame still being built; sea level and hillshade only
re-shade.

**The shoreline is where the surface crosses the sea** (2026-10-28, `terrain/margins.js`), not where the continental
crust ends. The history keeps a rifted margin's crust at full thickness to its rift line, where the new ocean began: the
continent–ocean boundary (COB). On Earth that crust thins toward the COB across a zone 150–400 km wide (Péron-Pinvidic
et al. 2013) and stands lower for it by isostasy — at once as it stretches and more as its heated lithosphere cools after
(McKenzie 1978; water-loaded, from the crust's and mantle's densities and expansion, `rift*` in terrain-config.js). So on
a rifted coast (a coast the history marked RIFT_MARGIN, or the start's own coasts) the crust's share of its thickness
is a smoothstep over `marginThinKm` 200 km from the COB (`marginThinCratonKm` 80 km beside a craton: cold, strong
lithosphere rifts narrow, Buck 1991). The history keeps a continent's area, not its thickness, so its crust edge is where
the zone's crust would end gathered to full thickness against the hinge: half way across the zone (∫ 1/β = ½, crust
volume kept through the stretching; margins.js `uEdge`) — the thinned crust reaches as far again beyond it, under the
sea, to the true COB, and the hinge lies as far inland (2026-10-28, round 2: before, the whole zone lay inside the
history's edge, and drowned the rift shoulders the history builds there). The surface is the land's own height
(platform, swell, belts, hills) less that subsidence, and the shoreline is where it crosses the frame's sea: a high rift
shoulder still stands above it, a low platform does not, and the COB lies at the foot of the slope. The sediment
the continent sheds (`denudationKmPerMyr` 0.05, Syvitski et al. 2005, over the landmass's area per km of its coast and
the margin's age) fills the drowned crust to a graded shelf down to the break at `shelfEdgeKm`, building it out toward the
end of the necking zone (crust thinned to `marginNeckCrustKm` 10 km — the break stands over the necking zone, Péron-Pinvidic
et al. 2013); below the break the slope is the prism's front (`clinoformGradient`); behind the shore the coastal plain
is the shelf load's flexural moat, 3πα/4 for an elastic thickness growing from 5 to 30 km with maturity
(`marginElasticKm`, Watts 2001). So a young margin has a narrow shelf over thinned crust falling away (the Red Sea), a
mature one a shelf ~100 km wide with its break at ~120–150 m. The other margins — active, transform, collision, arc,
and passive coasts that never rifted — keep their per-margin profiles (`margins` in terrain-config.js), which stand for
physics not derived yet. A transform margin has a sheared edge, but the history records no shear or age for it. A
collision coast faces no ocean COB, and an arc's heights come from its slab (records.js); their crust still ends at the
shelf break. An active margin with the history's trench within 450 km of its coast is derived (round 2, 2026-10-28).
Its forearc, the wedge on the overriding plate's crust, slopes at one surface slope from the shelf break down to the
trench's axis. That slope is the wedge's critical taper (Davis, Suppe & Dahlen 1983; forearcs slope ~1–8°, Lallemand et
al. 1994). There is no abyssal floor between, so the crust's edge, the COB, lies at the trench. Seed 626225 at 300 Myr,
640K cells, mean depth 25–50 / 50–75 / 100–125 km off such coasts: −4.18 / −4.92 / −5.08 km before, −3.83 / −4.26 /
−4.55 km now. Many coasts the history calls active have no trench within reach, and they keep the profile. What tectonics treats as continental crust is unchanged (the history uses its land for
erosion, rivers, the sea's fill and the ledger), and the Evolution timeline already draws heights against the sea
(terrain-player, world-ocean.js), so flooded continental crust shows there as shallow sea; the lab's crust palettes
stay crust maps. Phase 13 reports the continental crust under the sea by stage of the cycle, the shelves' width by kind
of margin and the break's depth (`tools/lib/shelf-stats.mjs`). The sim's coasts are mostly active, and its continental
crust's area was set to Earth's land area (tectonics' `continentalFraction`), so its submerged share stays small (~5–15 %
against Earth's ~20–30 % today). Crust whose platform lies below the shelf break — a submerged arc ridge, a drowned plateau — has no shelf graded up to
the sea at its edge (wave base never planed it): its edge falls from its own depth, with no rim of islets at sea level
around it or its holes (Kyushu–Palau, West Mariana and Lau ridges, Karig 1972; before, every hole in a submerged arc
field drew as a ring of islands).

**The mantle's swell and the sea level** (2026-10-27, `terrain/sea-level.js`). A continent is a lid: the mantle under
it warms (the history's `mantleHeat`, `mantleInsulateMyr`), and warm mantle lifts the surface over it — dynamic
topography (Gurnis 1988; Lenardic et al. 2005; Coltice et al. 2007; the African superswell, Pangaea's legacy, ~0.5 km
above the other shields, Nyblade & Robinson 1994). The swell is absolute, under the sea floor as under the land
(`mantleSwellKm` 1 km from fully cooled to fully insulated mantle, the heat smoothed over `mantleSwellSmoothKm` 400 km),
and the sea answers it: the ocean's water is a fixed volume, so the sea's level is the swell's mean under the sea floor.
Heights are today's, so each part is measured from what a dispersed world shows on average (`mantleSwellLandRef`,
`mantleSwellSeaRef`, measured over three histories' dispersed frames): a dispersed world's sea stands at 0 on average,
a supercontinent on its own warm mantle stands high as a whole and the sea falls against it (a lowstand, a dry, high
interior), and after the breakup the pieces ride onto mantle the ocean has cooled and sink, and shallow seas spread over
their low ground (Gurnis 1990). The sea floor's age would move the sea too — a young ocean, its ridges long and hot, is
shallower and holds less (Hays & Pitman 1973; Müller et al. 2008) — and it is computed against a dispersed world's mean
depth (`seaDepthRefKm`) and shown, but counted only with `seaLevelFloorAge` (off): the history's floor is older than
Earth's (mean 94–105 Myr against ~64) and its mean depth swings 4.4–5.0 km, so it would swing the sea 0.45–0.63 km over
a cycle (Earth 0.2–0.3 km), a lowstand after each breakup where Earth had its Cretaceous highstand.
The swell lifts the platform (tapering to the coast with it, as every platform height does) and the sea floor — read at
each point from the smooth world-fixed field, not through the land's corners, which would step it at the sim cell's
scale and drag a low coast along the steps (Phase 9's steady coasts); the sea's
level moves the whole surface, so the shoreline moves: shelves come out of the sea at a lowstand, coastal plains and
low interiors go under at a highstand. Before, the swell was relative to the land's own mean heat (developer, 8b round
6: so that the heat that gathers under any continent sitting still did not lift every height), and a supercontinent,
all of it as hot, got none. Read from the frame alone: the history is unchanged. The lab's Terrain phases show the
sea's level and both parts with the land share (and the Evolution page's statistics); the "Mantle swell" slider sets
`mantleSwellKm`, and "Sea floor's age moves the sea too" `seaLevelFloorAge`. Phase 13 reports the land share by stage of the cycle, the sea's first-order swing and the
supercontinent's interior height against the dispersed continents' (`tools/lib/cycle-stage.mjs`).

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
curve between the sim cells instead of running straight across each triangle; on a rugged coast (an island arc's, a young
collision coast's), below the coast noise, octaves of coast detail down to what the mesh can show (`coastDetailKm`, none at
160K). A second lookup warp works at the sim's own
scale (`cellWarp`: waves of a few sim cells, in sim cells so 20K gets as much as 80K) — read in the frame of the plate
under the point everywhere, off the rasters too, so it rides with the crust. The uplift and the platform are read
with each cell's slope as well, kept within each cell's neighbourhood range (`mountainCurve`), and a belt's crests at
the distance across it that the ridge kernels carry (`crestFollow`: a main crest is one curved line, not a zig-zag).
Hills go down to what the mesh can show, more on high ground, none at the shore (`hillsKm`); island arcs are cut
into chains of islands by a noise of islands (`arcStraitKm`: straits are shallow sea; a broad arc keeps its interior).
In `carve.js`: drowned valleys where hills and mountains meet the sea — each big valley lowered near its mouth along
the river, the sea then flooding in only where it connects — fjords (`drownKm` 180 km up the valley, 1.4 km deep at the
mouth) where the coast is cold, short shallow rias elsewhere (`riaKm` 60, 0.15 km: the sea risen since the ice age);
cold by the warmest month at sea level in Add detail (`drownColdC`: none at 19 °C, full by 13), by latitude on the
timeline (`drownColdLat` 44–58°) — and submarine canyons from big
rivers' mouths down the shelf and slope (`canyonKm`). Both fade out where the mesh cannot draw a valley (160K).
Evolution's page colours the Terrain and Heightmap layers per pixel from the blended heights
(`SmoothMapRaster.paintHeights`, or on the GPU `view/gpu-paint.js`), so a shore is the heights' zero line — crisp — not
land and sea colours blended across a mesh triangle.
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

Memory and speed on phones (2026-10-18, after Add detail at 640K closed the tab on a phone; measured in Chrome made to
look like an 8-core 4 GB phone — 20K, 160K, 1200 Myr — every output unchanged, by hashes): the history's worker no longer
keeps the frames it has sent (simulate's `keepFrames: false`: ~2 MB a frame at 20K — the whole history held twice); on a
small device Add detail lets the terrain's workers go while it runs (`TerrainPlayer.rest` / `wake`: frames asked for
meanwhile are built after), builds its surface on 3 workers rather than one per core, and its worker goes when it is done
(everywhere below 2.5M cells, whose mesh takes under a second or two to build again — the finer ones' is kept); a small
device keeps a third of the unpacked frames (32 MB). The page's memory once the history is built 1.36 → 1.03 GB, at its
peak during a 640K Add detail 1.81 → 1.35 GB, after it 1.53 → 0.84 GB (the browser's own count, its garbage included;
what the page's threads hold 0.97 → 0.58 GB built, 1.43 → 0.80 GB at the peak). Then an exact pass on Add detail: the
finished picture and the satellite look work out each column's longitude once (not per pixel), the look's tone and snow
exponentials once per pixel for its three views, its box statistics and the regional grid's blur run their column sums a
row at a time (in memory order; the same sums in the same order), and the grid's mean and blur fill their results with
plain loops (`Float32Array.from` with a callback was most of their time) — the picture at 4096 6.0 → 4.4 s, the ice age
0.65 → 0.28 s, the wind 1.17 → 0.71 s, the final climate 1.63 → 1.37 s (640K). In the history the remaining hot spots
(the world view's gather, the nearest-crust searches, the rift search) gained nothing measurable from further exact
changes (tried: each plate's edge marks kept while its crust is unchanged; the rift partition's arrays reused — reverted).

The whole-planet histories' pace (2026-10-18; plans/V2_PERFORMANCE_PLAN.md, phase 3 — every planet changes): the
Evolution history and the lab's whole planet (scenarios/terrain-scenes.js `WHOLE_PLANET_PACE`) let two closing plates move 2.25
cells a step (not 1.5: each flank of a gap grows about a cell) and run the slow rules every 3 Myr with the time since
(config `slowRulesEveryMyr`: arcs, margin islands, arc collapse, arc maturing, heights — tidying stays every step,
a fragment left a few Myr being a scrap, and the rivers keep their own clock); the scenes of one mechanism keep the finer
pace. Two exact changes with it: a rift's search works out the outer sea, the coast distances and its crust cells once
per plate (not per junction tried), the grain once per history, and scores its cuts over the plate's own cells
(ops/rift-path.js `riftContext`); the world view's gather passes over blocks of cells wholly outside a plate's band of
latitude (the mesh's cells are numbered down the sphere). A 1200 Myr history at 20K 29.5–33.2 s → 18.6–23.7 s (20–39 %),
600 Myr at 40K 31.1 → 25.2 s; Extend history still the one history. At 160K, 300 Myr 72 → 59 s. Checks 8a, 8b, 9, 10, 13
against the old pace: no new miss beyond chance (a different planet each run) — and the scraps of craton that sink into
a range as a flat hole (check 10) turn out to come at the old pace too, on other seeds (5.7 km on one): a terrain matter.

The history on more than one core, where it splits into pieces that do not depend on one another (2026-10-18; developer:
"lets do the rift and start world on multiple cores"): the history's worker starts up to 4 helpers (app/helper-pool.js;
the cores but one). The start world's layout attempts — each with its own rng and noise, so each depends on its number
alone (init/start-world.js `evaluateAttempt`) — are evaluated a batch at a time and taken in order by the same rules
(the chosen layout's cratons and rng placed again, cheaply, so the rim trenches come out the same); and each rift's search
over its 12 junctions (48 for an overdue piece) is handed out in runs and its answers come back in the junctions' order.
For that the step loop is a generator (simulate.js `stepsOf`): a rift yields its request (step/rifting.js), which
`simulate` answers in place and `simulateAsync` by the helpers. Every frame the same (Node: five histories in place and with
helpers, and one extended in two pieces; the page: its packed frames against Node's, desktop and phone settings). The start
world 25–40 % sooner (0.7–1.8 s → 0.5–1.2 s), a history 7–15 % (1200 Myr at 20K, 600 at 40K). Where a worker cannot start
workers of its own, the history runs in place as before.

Phone memory again (2026-10-18, after Add detail closed the tab on a phone once more): the helpers and the realism pass
had taken back what the first pass saved (peak 1.74 → 1.97 GB, same measure). A gone plate keeps its place in
`world.plates` (its id is its index) and kept its rasters too — ~110 bytes a cell, and a history makes ~100 plates and keeps
~20 (the realism pass's ocean plates and microplates: 54 → 92 at 1200 Myr, 20K). Now every gone plate shares one empty
raster (`world.goneCrust`, simulate.js — as a merge already gave the plate it ended a fresh one): the history's world
207 → 61 MB at 20K. And on a small device the history's worker lets its helpers go once a run is done (the page tells it:
`small`), starting them again — well under a second — when the history runs on. Peak during a 640K Add detail
1.97 → 1.66 GB, after it 1.64 → 1.22 GB; every frame the same (hashes: three histories in place, one with helpers).

The picture on the GPU (2026-10-18; developer: "lets do the GPU repaint"): Evolution painted every moment on the page's
thread — ~2M pixels each blended from three cells through a pixel table (`SmoothMapRaster`; 37 ms at 2048 px, 130 ms at
4096, and the 4096 table itself ~1 s and 117 MB to build), then sent as a texture. Now (`view/gpu-paint.js`) the terrain
mesh's triangles are drawn flat onto the texture by the GPU (a render target): a frame sends only each cell's height and
shade (or colour) as a small data texture; the GPU's own filling of each triangle is the three cells' blend, the palette
and shading done per pixel in the shader (heights blended, then coloured — the coasts as crisp), the sea mask for the glint
drawn the same way (the world ocean's only: a cut-off sea rides on the shade channel, + 2, and takes the palette's second
row, its cut-off colours), and the lines (grid, a climate layer's arrows) blended over in the same pass from a transparent canvas,
sent again only when they change. Against the CPU's painting: under 1 of 255 per channel on average, no gaps; ~1–2 ms at
4096. So every moment is drawn at 4096 px on a desktop (2048 on phones, twice the CPU's 1024) and no pixel table is built:
scrubbing at 160K went from 73 frames a second (43 slow frames in 4 s, 47 % of the page's time) to 144 (none, 1 %); at 640K
the worst frame from 118 to 9 ms; while a history builds, slow frames 51 → 5; the page's memory ~320 → 155 MB at 160K.
Detailed moments are still painted on canvases (their pictures come from the Finish step), and without WebGL 2 everything
is painted as before (`?gpu=0` forces it, for comparison). The map view is the same texture drawn flat by the globe's
renderer, letterboxed under the `#mapCanvas` frame. Zoom is V1's (`app/globe-view.js`): a wheel's notch is 14 % nearer
(OrbitControls' own was 5 %, and stepped), a pinch the fingers' ratio, and the camera eases to it.

A speed pass (2026-10-27; every output the same — whole histories compared frame by frame, every field, on two seeds over
1200 Myr at 40K, and Add detail's heights, ocean, lakes, waves, coast, climate and stats at 640K). Add detail at 640K (4
workers, desktop) 23.3–24.0 s → 18.5 s at the same CPU time (~37–38 s): the coast's swell traced on three of the terrain
pool's workers, with its rays' frames worked out inline and its tables flat (nothing allocated per step) — the coast
6.2 → 2.4 s; and the surface's plan begun on the pool's first worker while the terrain mesh is built and warped (the plan
needs only the cells' size) — the surface 4.2–4.4 → 3.2 s. The crust ledger (on in the checks) counts four cells at a
time: a 1200 Myr ledger history at 40K 167 → 144 s (instructions −18 %). The gather keeps each plate's crust-edge counts
up to date instead of marking them afresh (its share of a history's samples 3.4 → 1.3 %; a whole history within noise:
1200 Myr at 40K 139.5 → 138.4 s). Tried and not kept: the step's second resolve reusing the first one's growth verdicts
where nothing they read has changed (exact, but only a third qualify — the first resolve's births change the crust right
beside the ridge gaps the second asks about — and finding them cost more than it saved: +8 %); contacts kept across
resolves while their cells' owners stand (as dear to check as to work out); the checks' terrains built on a terrain pool
(8a, 13: the same terrains, bit for bit, but CPU +10 % and +67 % and no sooner on the shared machine). Not tried: the rift
search on helpers in the Node checks — each check holds one core under sim-slots, so it would add CPU, not save time.

## The realism pass (2026-10-18; plans/V2_REALISM_PASS_PLAN.md)

Twelve recorded 1200 Myr histories (3 seeds × 20K–160K) showed worlds that froze into one plate, oceans twice Earth's age,
explosive breakups, moth-eaten ocean plateaus, a featureless sea floor and a flat start world. In order:
- **Plate colours** follow the larger partner through welds and rifts (`Plate.hue`; display only). **Erosive margins** retreat
  along the trench's length, not per coast cell (a finer mesh draws a longer coast: it lost twice the land at 160K).
- **Living plates.** An old passive margin inside a plate founders
  like one between plates: its ocean breaks away as a plate of its own (`founderWithinPlates`). From `backgroundEndMyr` the
  pre-history ocean becomes plates; a plate with more than `oceanSplitAreaKm2` of ocean may split along a new ridge, its
  halves pushed apart as a rift's (`step/ocean-plates.js`); an ocean plate subducted below `oceanPlateCaptureKm2` is captured
  by its neighbour. Plates rise from ~6 to ~10–12, the largest falls from up to 100 % of the planet to about half.
- **Speeds saturate** smoothly (`continentalSoftCmYr`, `oceanicSoftCmYr`: v → v/√(1+(v/S)²); not tanh, whose last digit differs between engines) and the step follows the plates'
  fastest surface speeds, not their |ω| (a speck of a plate could spin at any rate). Breakups drift rather than fly apart;
  a 600 Myr history at 40K takes fewer steps than before (506 against 561), each a little dearer with more plates.
- **Ocean plateaus** are one smooth rise (`lipSeaSmoothKm`). **Ridge segments and fracture zones:** each cell of new floor
  records its distance from the two plates' spreading pole (`Crust.fzU`, `model/segments.js`; averaged rotations): the
  segments' floor reads a little older or younger and the ridge and isochrons step; troughs mark where it passes a whole
  number of segment lengths. **Open-ocean arcs** stand deeper (`arcOceanMatureKm` −1.5 km): a ridge its volcanoes break.
  (Since replaced: an arc stands on the crust its slab fed it — "Island arcs live by their slab", below.)
- **Old ranges in the start supercontinent:** worn Ural-type belts along about half its suture network (`startSuture*`),
  records only — the plate history is unchanged (hash).
- **Coasts drawn to their margins' lines** (developer, 2026-10-23: "I'm still not seeing things like the western coast
  of India or Africa … they're always squiggly"). Measured first (`tools/coast-shape.mjs --bands`; tools/lib/coast-fractal.mjs:
  the coastline's divider dimension D over 50–500 km rulers by kind of margin, on the zero contour of the surface): a mature
  passive coast stood at D ≈ 1.11–1.14 and an active one at 1.15–1.18 (Earth: South Africa 1.02, Richardson 1961 in
  Mandelbrot 1967; the Andean coast ~1.05). The squiggle lay in the sim-scale coast noise (`coastCellNoise`, the largest
  share), the lookup warps, the shelf's width jumping from one sim cell to the next with the floor beside it, and the sim
  raster's own staircase under them all. Now: the coast is the margin's smooth line (`margin-line.js`) — the 0.5 contour of
  the land/sea raster seen through a Gaussian of `coastLineKm` 120 km — the length of a rift's border-fault segments
  (50–150 km: Rosendahl 1987, Ebinger 1989), never under one sim cell — (a rift's cell-to-cell steps and the raster's
  staircase gone, its bends and transform steps kept; a cell turns only on the coast, never erasing an island or a lake,
  never parting a land or a sea), the coast distance measured exactly to that contour's segments, so the shelf's edge and
  the coastal plain are true offsets of it. Roughness is where the land at the sea is rough (records.js `rugged`): island
  arcs, and young collision coasts by their relief (`coastRuggedKm`, while the belt is fresh: `coastFreshMyr`) take the
  coast noise (`coastNoiseKm`), the fine detail and a sharper line (`coastLineRuggedKm`, never under half a sim cell); a passive or active margin
  takes none — its roughness is what its rivers' drowned valleys (rias, carve.js), the ice's fjords (finish-ice.js) and the
  waves (finish-coast.js) cut into it. The sim-scale coast noise is gone, and a margin's shelf, coastal plain and maturity
  are smoothed along it over its flexural scale (`shelfAlongKm`). D on the tectonic surface at 1M cells, two seeds:
  mature passive 1.13 → 1.04, young passive 1.08–1.11 → 1.02–1.13 (a few thousand km), active 1.15–1.18 → 1.09–1.11, arcs
  1.25–1.27 → 1.25 (Earth's island chains 1.15–1.35). Phase 8a reports D by kind against Earth.
  Round 2 (2026-10-28): the lookup warp (`warpKm`) still moved a passive coast by up to 70 km. A sediment coast is
  smooth because waves drive sand along it and straighten it within ~10⁵ yr at these scales (coastline diffusion: Ashton &
  Murray 2006). So on a passive margin, in proportion to the share its sediment has buried (its maturity), the coast is now
  read where the point is, not where the warp moved it. The coast field's gradient over the raster triangle is dotted with
  the warp's displacement, and that displacement is taken back (`sedimentCoastSmooth`, 1). A young, sediment-starved rift
  coast and an active one keep the warp. Measured A/B at 1M cells, three seeds × 300–1200 Myr: mature passive D changes by
  −0.02 to +0.02 on the longer coasts (5–17k km). So the warp was not what kept these coasts squiggly. On short coasts
  (2–3k km) D moves by up to ±0.05, which is noise.
- **Mountains shaped along their belts** (developer: noise on the mountains "ruined the ridgelines … leading ridges and
  edges"; "make sure they get a realistic shaping"): only the distance across a belt followed its smooth kernels; its
  width, crest height and age, its envelope (the evolved uplift) and its thickened crust were read cell by cell — lobed
  range edges, crests bent into crescents, blobs of crest height. Now, for the current belt, its width, crest height and
  quiet time are blended over its own kind's kernels (`beltCarry`; stripes.js `beltAt`, once per sim cell at the crust it
  shows, read over the triangles); the envelope's and the thickened crust's shapes come from their profiles at the point,
  times their heights blended the same way (`envelopeCarry`: moved by height × (the profile at the point − the profile as
  the cells sampled it), only where the kernels' and the cells' distances across the belt agree to within about a sim
  cell, the thickened crust's height capped at `collapseKm` and never on a shield — and both kept within the least and the
  most the history left about the point: no ground floats on more root, nor stands on more uplift, than the crust around
  it holds, so where a narrow stretch of belt meets a wide one the narrow one's far edge is not drawn as the wide one's
  main range); and the crests rise and fall along the
  strike (`crestAlongVar` 0.4 over `crestAlongKm` 300), read on the belt's front line so nothing moves across the belt.
  ~6 % more synthesis time at 640K; steady detail kept (a half-cell turn: 97.1 % of coasts, land heights 0.91).
Everything is to be tuned together at the end (developer); the measured impact of each step is in the plan.

## The crust budget (2026-10-23)

Continental crust grew ×1.14–1.29 over a 1200 Myr history; on Earth additions at arcs (~2.7 km³/yr) and losses
(~3.2 km³/yr) about balance, and the Phanerozoic's net growth is "effectively nil" (Scholl & von Huene 2009). The
budget is now measured per process in Earth's units — area × `continentCrustKm` (40 km), per km of overriding trench
over the run (check-phase13, "the crust budget against Earth's"). What changed:
- **Sediment subduction** (`step/sediment-subduction.js`, its own ledger stage `sedimentSubduction`). At every active
  continental margin the slab drags the base of the trench's fill down the subduction channel — about
  `accretionSedimentKm` of it, which is why a trench with more than ~1 km of sediment accretes the rest (Clift & Vannucchi
  2004; Cloos & Shreve 1988): F = v × min(h, 1 km) × the terrigenous share, km³/Myr per km of trench. It is booked as
  continental area over `continentCrustKm` and taken from the coast facing the trench (`sedimentSubductionShare`: the
  share lost for good, 1; 0 switches it off — mechanism `sedimentSubduction`).
- **The trench's fill is a flux.** The land within `trenchSedimentReachKm` of the coast (round 3: whole river basins,
  below) wears down at
  `trenchDenudationKmPerMyr` (0.1 km/Myr; river basins by ¹⁰Be: median 0.054, mean 0.218 — Portenga & Bierman 2011) × its
  latitude's erosion, and the fill stands at supply ÷ convergence: slow trenches off wet land fill, fast ones starve —
  the correlation Clift & Vannucchi find. (Was `trenchTerrigenousKm`, a fixed thickness whatever the convergence, sampled
  around the trench rather than behind its coast.) The 7c erosion scene's slow trench (~1–2.5 cm/yr) is therefore now
  mostly accretionary, as Cascadia is.
- **Erosive margins erode from their first convergence**: the slab-maturity gate (`marginIsleSlabKm`) now holds only the
  fore-arc islands, and a trench cell no longer on a continental margin drops its EROSIVE flag. The 34 % of active coast
  the lab read erosive came from coasts read off unjudged and stale trench flags; by trench length × time
  (`world.budget.erosiveTrenchKmMyr ÷ marginTrenchKmMyr`) 52–56 % of continental-margin trench is erosive (Earth ~57 %).

Round 2 closed the additions side:
- **Welds and docks pay for the sea they fill** (`ops/merge-plates.js` `closeSeasBetween`). Every cell of sea a weld
  fills with continent is paid for by a continental coast cell of the underthrust front (lower-plate and terrane crust
  first, then the nearest), which goes back to sea; arc fills are paid with arc coast, falling back to continent. A
  seam nets to exactly zero (invariant "a weld or a dock makes no crust"); before, it made ~20 km³/Myr per km of trench.
- **Fore-arc islands are the prism's sediment** (`wedgeConservation`). A non-erosive margin cell's trench scrapes off
  v × (h − `accretionSedimentKm`) × its length each step; the islands raised from the fore-arc's sea floor may hold only
  that volume over the crust they add (`continentCrustKm` − `oceanCrustKm`), and the rest waits. With the flux-fed trench
  fill that is ~3 km³/Myr per km, so the islands nearly vanish: seed 12345 at 300 Myr (1M cells) shows 1 standing island
  and 0.22 Mkm² grown into the mainland, against 5 and 3.44 Mkm² without the rule. No factor was added to bring them back.
- **Arcs mature at Earth's addition rate.** `arcContinentKmPerMyr` = 1.5: Earth's arc additions, ~2.5–2.7 km³/yr over
  ~42,000 km of trench (Scholl & von Huene 2009), are ~60 km³/Myr per km, ÷ `continentCrustKm` 40 km = 1.5 km of
  continental front per Myr. All of it is booked as added; how much lasts is left to the sinks (erosion, sediment,
  underthrusting), so the losses are not counted twice. (Was 3, with no source.)
- **The 7c erosion scene is driven**: Driftia turns about a pole set so that its trench converges at ~8 cm/yr in the north
  (erosive, above Clift & Vannucchi's 6 cm/yr) and ~3 cm/yr in the south (accretionary) — a scene setting, not physics.

What the books say (three seeds, 1200 Myr; check-phase13): continental crust changes −5.2 / −5.7 / −1.0 % over the
first 500 Myr and +1.4 / +1.3 / −0.8 % over the next (Earth ±10 %; on main ×1.15–1.29 over the run). Additions 63–72
km³/Myr per km of trench (Earth 30–65): almost all arcs, the islands ~3, the seams 0. Losses 47–57 (Earth 60–95):
underthrusting ~33, subduction erosion 10–12, sediment 3–4. Erosive share of continental-margin trench 48–57 % (Earth
~57 %).

Round 3 fed the trenches from whole drainage basins, and the enclosed seas from theirs:
- **Rivers carry their basins' rock to the sea** (`step/rivers.js`). Every drainage the history routes now also sums
  its basin's rock — `trenchDenudationKmPerMyr` × each cell's latitude erosion over the basin, kept apart by how much
  was continental crust — and hands it to the mouth (`world.riverMouths`). (`trenchSedimentReachKm`, the land within
  300 km of a trench, is gone: every land cell lies in a mapped basin.)
- **Submarine fans** (`step/trench-fans.js`). A mouth on the world ocean sends its rock across the ocean floor (land in
  the way stops it) to the nearest overriding trench within `trenchFanReachKm` — 3000 km, the Bengal–Nicobar fan's
  run from the Ganges–Brahmaputra to the Sumatra–Andaman trench (Curray et al. 2003) — and the trench spreads it along
  its axis, e-folding over `trenchAxialTransportKm` (700 km: half the ~1000–1400 km the Chile trench is turbidite-filled
  along its axis from its glacial south, Völker et al. 2013). A trench's supply per km over its convergence is its
  fill, as before; the prism (fill above `accretionSedimentKm`) raises the islands, unchanged. Intra-oceanic trenches
  in reach of a fan fill too (the Lesser Antilles off the Orinoco).
- **Sediment subduction is taken from the basins that sent it** (`step/sediment-subduction.js`): each mouth loses the
  share of its continental rock the trenches it reaches send down their channels, at the coast within half its basin's
  breadth of its mouth. Arc and island rock that goes down is counted in Earth's figure but not booked (the engine
  keeps arc crust apart from continent).
- **Enclosed seas fill** (`step/sea-fill.js`). A mouth on a sea that is not the world ocean lays its rock on that sea's
  floor, nearest its mouth first; the floor sinks under the load, ~2.84 km of sediment per km of water (Airy, mantle
  3.3, water 1.03, compacted fill 2.5 g/cm³: ~17 km fills 6 km — Steckler & Watts 1978; the Black Sea's 14–19 km,
  Nikishin et al. 2015; the Gulf of Mexico's ~15 km, Salvador 1991). The fill is a crust record (`crust.seaFillKm`,
  moving with its plate; frames carry it and `crustFill`); the terrain draws it as a shallower floor
  (`measure.js filledSeaDepthKm`) and a sea filled to sea level as lowland. Its crust stays ocean crust: the rock is the
  continents' own, moved, so the crust ledger does not change (enclosedSeaFill: false, mechanism `seaFill`, switches it
  off). Enclosed seas at 1000 Myr (seeds 626225 · 777 · 12345, counted with filled seas as land): 38 · 51 · 50 →
  8 · 18 · 4, their area 7.4 · 17.4 · 10.4 → 1.8 · 31.0 · 0.8 Mkm² (777's is one 26 Mkm² remnant ocean closing inside
  its gathering supercontinent); over each history 20–55 enclosed seas → 4–19, and the area on floor older than 340 Myr
  from 3–8 Mkm² to ~0–1.
- **The cost**: none measured. The new work (~2 % of a history) is paid for by computing each world cell's rain and
  erosion by latitude once instead of every drainage (the same numbers); with no rock to route (denudation 0) both
  versions run the same history in the same time (148 · 146 s against 148 · 144 s), and whole histories with it run
  −9 % · −3 % · +7 % (seeds 626225 · 777 · 12345) — their histories differ.

What the books say after round 3 (three seeds, 1200 Myr; check-phase13): continental crust changes −2.2 / +0.7 / −0.2 %
over the first 500 Myr and +3.9 / −1.2 / −2.2 % over the next (Earth ±10 %). Sediment subducted, all the rivers' rock:
25 km³/Myr per km of trench (Earth 15–35; was ~4 booked); the continents' own share 9 (booked as lost). Erosive share of
continental-margin trench 45–47 % (Earth ~57 %: thicker fill makes more margins accretionary, as it should). The prisms
take ~15 km³/Myr per km (was ~3), and the islands come back: seed 12345 at 300 Myr (1M cells) shows 11 standing
fore-arc islands and 1.53 Mkm² grown into the mainland (round 2: 1 and 0.22). Additions 68–80 km³/Myr per km (Earth
30–65), losses 49–59 (Earth 60–95).

Known gaps:
- **Intra-oceanic fore-arcs do not erode.** Tonga and the Marianas lose their fore-arcs to subduction erosion; here only
  continental margins erode, so every arc that reaches a continent arrives whole. Earth's ~60 km³/Myr/km of erosion
  includes them, which is part of why the engine's erosion (10–12) reads low.
- A filled sea's rock is not taken from the land it came from (thinning is invisible to an area ledger), and the fore-arc
  islands' rock is not either: both move continental rock, so neither is booked. Denudation is one rate everywhere
  (× latitude), not by relief; mountains shed more.
- Only fully enclosed seas fill; a remnant sea with a narrow mouth to the world ocean is treated as ocean (its rivers'
  rock goes down their fans).

## Subduction initiation from the plates' stresses (2026-10-23, branch stress-init)

`tools/trace-founders.mjs` now tallies where candidate margins are lost (`world.founderTrace`). On main it found new trenches
born 1–4 times per 100 Myr, and why: a weak zone was as strong as a whole slab pull (`founderStrength` 1.0) while the
plates' own stresses across their coasts are ±0.1 of one, so the squeeze barely counted and the floor's age (over
`subductionInitAgeMyr` 180 Myr) did nearly all the founding; ~80 % of the founders drawn between two plates were then
thrown away because the pair's contact was in pieces, none long enough; and a plate with no continent had no margin at
all. Now:
- **A weak zone's strength** is `founderStrength` 0.08 slab pulls per 100 km: the 2–3 × 10¹² N/m a plate's resistance to
  bending into a new trench peaks at (Gurnis, Hall & Lavier 2004) against a slab pull of ~3 × 10¹³ N/m. Most trenches are
  now born pressed together (induced), younger than their weight alone would sink them (Crameri et al. 2020).
- **Between two plates** each unbroken stretch of contact is a margin of its own, with its own age and closing.
- **The shortest margin a trench is born on** (`subductionInitMinLengthKm`) is 800 km: Earth's youngest trenches start that long
  — Puysegur ~800 km (Gurnis et al. 2004), Yap–Palau and Manila ~1000 km — and lengthen along strike (wings); a slab ~8× wider
  than the lithosphere is thick sinks as a sheet. It was 2000 km, unsourced, and threw out ~98 % of the stretches of contact
  between two plates (now ~87 %). The chance per km of margin is unchanged: the rates are quoted per
  `subductionInitRateLengthKm` 2000 km. On the 20K 'cycle' histories (`trace-founders`, 3 seeds × 600 Myr) trenches born
  between two plates go 9 → 36, all initiations 103 → 130.
- **Across a plate** (`founderAcross`): a plate's open ocean is tested on the line it would split along
  (`ocean-plates.js oceanLine`), with the stress the rest of the plate puts across it (`plate-stress.js`). Pressed together
  harder than a weak zone holds, the far side breaks away under a new trench, the older floor going down. Its weight is
  only the step in depth across the line (√age_old − √age_young): uniform floor has nothing to tip it (`founderUrge`'s
  `weightMyr`). Under tension the line waits for the split. Off-switch: `MECHANISMS.founderAcross`.
- A back-arc strip that takes a piece of craton with it books the split (`BACKARC_OPEN data.splitCratons`), as a rift does.
- Phase 13 reports, over its three 1200 Myr cycles from 100 Myr: initiations per 100 Myr, the sea floor's mean age,
  plates over 10^7.5 km² and back-arc seas opened.
Measured (phase 13, 3 seeds): initiations 3.5–4.1 → 5.6–6.3 per 100 Myr (Earth 12–30; the 6b histories 1.3–3 → 4–6.3);
plates holding ≥ 1 % of the planet 9.5–11.2 → 11.4–13.8 (Earth 12–14); the sea floor's median age 107–119 → 96–121 Myr
(Earth ~64). Not mended: the plate a supercontinent welds into still holds 66–83 % of the planet at its largest (51–73 %
before), and plates over 10^7.5 km² stay 4–5 (Earth 7).
Time: the extra plates cost ~17 % on the lab's 600 Myr history (40K, seeds 12345/777/4242/626225, each run beside main
under the same load). Exact speed-ups in the hot paths (commit "Exact speed-ups in the history's hot paths": the same
history to the bit, on this branch and on main) take ~9 % off main's own time and leave the branch +4 % wall, +6 % CPU
over main: 302 s against 290 s for the four histories.

## Sealed seas founder (2026-10-23, branch stress-init)

Seas sealed inside one plate (the "Swiss cheese": a sea whose seam has welded shut) only aged — no ridge feeds them and
no rule let one go down unless it was as big as a plate and its shore 800 km long. Now:
- **A sealed sea founders whatever its size** (`founderWithinPlates`): the shortest-margin and smallest-plate rules are
  for a margin facing open ocean, so a sealed sea (the plate's ocean `exteriorSea` leads no way out of) skips them. Its
  chance per km of shore and its urge (`founderUrge`: the floor's weight and the squeeze) are those of any margin: old
  floor goes down, a young back-arc just closed off is too light to. On Earth: the South Caspian floor beneath the Apsheron
  sill (Jackson et al. 2002), the Japan Sea's eastern margin (Tamaki & Honza 1985), the Ionian under the Calabrian and
  Hellenic arcs (Faccenna et al. 2014). The event reads "shore of a sealed sea" (`SUBDUCTION_INIT data.sealed`).
- **An ocean plate going down a trench is not captured** (`captureMicroplates`): a small plate with a subducting edge is
  pulled by its own slab, not carried by a neighbour, so it goes down to its last cell and then ends ("has gone down its
  trench"). Once it stops going down it is captured as before.
- Phase 13 reports the sealed seas' floor older than 340 Myr (the Herodotus Basin, Earth's oldest in-place ocean floor:
  Granot 2016), over the frames from 100 Myr.
Measured before the rebase onto main's sea fill (40K, 1000 Myr, seeds 626225 / 777 / 12345, enclosed seas ≥ 0.05 Mkm²):
floor older than 340 Myr at 1000 Myr 8.7 / 10.9 / 9.8 → 5.9 / 4.5 / 6.8 Mkm²; its mean over 300–1000 Myr 4.5 / 6.1 / 5.2 →
3.8 / 4.3 / 3.8 Mkm². The number of sealed seas and their area do not fall: seas keep being sealed as fast, but the old
floor in them goes down (100–170 sealed-sea founders per 1000 Myr, the floor's age at founding p10 / 50 / 90 ≈ 250–300 /
355–480 / 460–685 Myr; young sealed seas stay). With main's sea fill, against main
(the same runs; Mkm² at 1000 Myr, and the mean over 300–1000 Myr): enclosed seas 58 / 45 / 52 → 65 / 80 / 65, their floor
older than 340 Myr 4.0 / 5.8 / 7.2 → 6.9 / 8.1 / 4.9 (mean 3.1 / 7.1 / 4.8 → 3.6 / 5.7 / 3.1), and of that the floor not yet
filled to sea level 0.4 / 0.9 / 1.0 → 0.9 / 0.9 / 0.4 (mean 0.50 / 0.41 / 0.41 → 0.45 / 1.17 / 0.44). Not mended: the
branch's extra plates seal more seas than main does, and 160–280 sealed-sea founders per 1000 Myr only offset that; the
fill hides most of the old floor on both.

### Sealed seas by cause, and a sealed sea's floor going down whole (2026-10-26)

A probe (each step, the cells newly enclosed are tagged on their crust with the event that sealed them: weld exits,
arc docking, arc collapse, back-arc, rifts, fragments, founders, microplate capture; "closing" when no event touched the
sea's floor or rim) classified the seas at 1000 Myr and over the frames 300–1000 Myr (40K, seeds 626225 / 777 / 12345).
Weld exits seal almost nothing on either side (≤ 1 sea on the mean). Against main, the branch's excess came from:
- **arc docking** (mean 1.8 / 2.6 / 5.5 seas → 10.4 / 0.5 / 7.4; at 1000 Myr 2 → 36 seas on 626225), and two paths only
  the branch has — **founders inside a sealed sea** (0 → 1.1 / 3.3 / 2.0) and **the plate such a founder made captured
  back** (0 → 1.5 / 4.1 / 1.0). One cycle (626225, 104.0 Myr): "Thalassa 5 is born: 0.1 Mkm² of AEFGJK's old ocean
  breaks away · a new trench founders along 1456 km of AEFGJK's shore of a sealed sea"; 105.8 Myr: "Thalassa 5,
  subducted down to 0.06 Mkm², is captured by AEFGJK". Only the ocean nearest the failing shore went down; the rest of
  the sea stayed, the sliver came back, and the arc its trench raised ringed the sea into smaller seas.
- the rest, ~+16 seas over the three seeds on the mean with the round-3 rules switched off, is main's own closing and arc
  collapse on the branch's extra plates and trenches.

Now **a sealed sea's floor goes down whole** (`founderWithinPlates`): the take is all of the plate's ocean joined to the
failing shore, not the ocean nearest it — one slab cut off from any ridge, with nothing to hold part of it up (the South
Caspian under the Apsheron sill: Jackson et al. 2002) — and once a sea has gone down in a draw, its other shores do not
founder again. **A floor narrower than a starting slab** (`subductionInitSlabKm`, 150 km out from the shore) **has no slab
to sink** and stays. Sealed-sea founders 160–280 → 34–59 per 1000 Myr. Enclosed seas, mean over 300–1000 Myr (main →
before → now): 42.2 / 39.7 / 39.5 → 49.4 / 59.6 / 47.8 → 46.8 / 52.3 / 39.4; their area 11.2 / 14.7 / 10.7 → 12.8 / 22.8 /
12.0 → 9.9 / 14.5 / 10.9 Mkm². Arc docking 10.4 / 0.5 / 7.4 → 1.5 / 2.8 / 0.9; the two branch-only paths together 2.6 /
7.4 / 3.0 → 0.9 / 2.0 / 0.7. Area is main's; the count is still +15 % over the three seeds (most of it "closing" and arc
collapse: main's mechanisms on more plates). At 1000 Myr alone (one frame, noisy): 59 / 46 / 53 → 68 / 81 / 68 → 68 / 82 /
45. Time (600 Myr, 40K, four seeds twice beside main 3cc5283): 426.5 s against 429.8 s wall, CPU +2.8 %.

## Branch stress-init: costs and fixes after the rebase (2026-10-23)

- **A cell drags as a patch, not a point** (`torque-balance.js dragTensor`, `plate-stress.js`): turning about its own
  vertical, a cell drags its base too (a disc's polar moment, a ⁄ 2π of its area on the unit sphere). Without it a plate one
  or two cells across going down its trench spun up to thousands of rad/Myr, and its couplings put absurd stresses on its
  neighbours (a founder sample of −42.65 slab pulls per 100 km, on a cut 10,982 km long — not a short cut). Over a whole
  plate it adds ~10⁻⁴ of the drag; the fastest spin is now ~1 rad/Myr (a one-cell plate's edge then moves ~9 cm/yr).
- **The founder tests inside plates are drawn every `marginFounderEveryMyr` 4 Myr**, for the time since (they ran every
  step): the same chance per Myr, and a plate's draw tests all its margins. A trench takes ~10 Myr from first failure to
  sinking on its own (Gurnis, Hall & Lavier 2004), so a 4 Myr draw is finer than the process. Noise-level.
- **Rift scoring** (exact: the same history to the bit): the stress on a cut uses scratch masks instead of a fresh
  cell-sized array and a per-cell map each cut (~2 %), the heap swaps in place, and the partition tests land in place
  (~0.4 %); the founder tests reuse their scratch (exact, ~0.3 %).
- Time, on the lab's 600 Myr history (40K, seeds 12345 / 777 / 4242 / 626225, twice each, each run beside main 3cc5283
  under the same load): 437.6 s against 428.5 s, +2.1 % wall; CPU +5.5 %, nearly all of it the garbage collector's
  parallel threads (with `--single-threaded-gc`, +1.7 %). The founder clock alone takes ~4 s off a history whose tests
  ran every step (5.8 s → 1.6 s).

## Welds, sealed seas and deep stacks (2026-10-26, branch welds)

- **What "closing (no event)" was.** Tick by tick (a probe tagging every enclosed sea's cells in the world view and in
  each plate's raster), most seas that seal "with no event" are the world view flickering: it resamples the rigid rasters
  by nearest cell, so a sea's one-cell mouth opens and closes from step to step (1,800–2,400 reseals a history). The seas
  that are really sealed are ~75 % sealed inside one plate's own raster, and their causes, per 1000 Myr history, are an
  arc built in place (5–11 seas), welds (8–10), cells gained (~5), the rings arcs make as they dock (3–6), arcs collapsing
  (2–4) and microplate capture (1–3).
- **A weld waits while the sea it would seal is still closing** (`collision.js seaWeldWouldSeal`). At the moment a weld
  fired, about half of the sea it trapped was still closing faster than `sutureStallCmYr`: the stall and gap-stall exits
  saw a seam that had stopped shortening at the contact, not the sea beside it. The test lays the two rasters together,
  finds the sea that is open in each plate's own raster but walled in by the pair, and takes the fastest rate at which
  the lower plate's coast round it closes on the upper's. While that is above the stall rate the weld waits (`stacked`
  still welds; so did `overdue`, removed in round 2 below), and the trapped floor keeps going down, as remnant ocean basins close by continued
  convergence (Ingersoll, Dickinson & Graham 2003, GSA Spec. Pap. 372; the Bay of Bengal and Andaman Sea today).
  The SUTURE event gives the sea it sealed (`sealKm2`) and how fast it was closing.
- **Why not a remnant-ocean plate.** Carving the trapped floor off as its own plate inside the welded one does not
  consume it: with no trench of its own it is captured straight back, and while it lasts its divergent edges fill with
  new ocean on both flanks (resolve.js), so it keeps its area and only its floor gets younger. A remnant plate is only
  right once it can start its own trench; that choice is left open.
- **The redraw stays within the pair's outline** (`merge-plates.js`): it no longer spills past the upper plate's edge
  into a third plate (a 1–2-cell band over ~13,000 km of another plate's coast, seed 592250), and land squeezed back from
  the front stays land instead of drawing in sea from behind it (~1.6 Mkm² of new, at-once-sealed inland sea a history).
- **A weld hands the lower plate's collisions on** (`collision.js inheritCollisions`): its other open collisions become
  the welded plate's, merged with any it already had. They were dropped, and the overlap they carried was measured again
  against a new, short front — the deep stacks (16,603 km deep over its front on one seed).
- **A craton jams the underthrust** (`collision.js underthrust`): the lower plate's land between its own side and a
  craton in the overlap goes no further under (Cloos 1993; cratons as rigid, Lenardic & Moresi 1999). Consumed round it,
  a craton was cut off from its plate and deleted with the stranded piece by the tidy step.
- **`openSeaBetween` saturating at its 1000 km window** is not hiding a seam gap: widened to 8000 km, most welds read the
  cap, i.e. the rule then measures the world ocean between the plates' far coasts. The sea the weld would seal is the
  measure that matters, and it is now the one the weld uses.
- Numbers (40K, 1000 Myr, mean over the frames 300–1000 Myr, seeds 626225 / 777 / 12345 / 4242 / 101 / 202; main → branch):
  enclosed seas (≥ 0.05 Mkm²) 47.4 → 42.9; floor older than 340 Myr 3.27 → 2.75 Mkm²; seas sealed inside one plate
  30.3 from 35.2, their area 5.82 → 4.80 Mkm², their old floor 2.07 → 1.61 Mkm²; seas a weld sealed 10.9 → 7.7. The
  enclosed area alone (13.9 → 16.7 Mkm²) is dominated by whole oceans ringed by land on several plates while their
  coasts still close (seed 4242: 126 Mkm² at 700 Myr), not by sealed seas. Earth at this resolution has 3–4 enclosed
  seas floored by oceanic or oceanic-like crust (the Mediterranean with Gibraltar shut, the Black Sea, the South
  Caspian, perhaps the Red Sea), ~3–3.5 Mkm²: most of the rest is arcs, outside this branch. Deepest stack over 8
  seeds: 4 of 8 above the 750 km limit → none.
- Time, on the lab's 600 Myr history (40K, seeds 12345 / 777 / 4242 / 626225 twice each and 101 / 202 / 303 / 404 once,
  each run beside main 5bab988 under the same load): 987.9 s against 963.8 s, +2.5 % wall; main with an unrelated
  nudge (plumeSpacingKm 1500 → 1560) ran 953.9 s, −1.0 %. The sea test floods the pair's rasters, so it is taken only
  when it decides a weld (the seam closed, not stacked), once per `sutureCheckMyr`: taken at every check it
  cost ~3 % (not exact: the test then reads the sea a step or two later). The rest is the histories differing (seed
  12345 rifts a larger plate: +17 %; the other seeds −6 % to +9 %).

## Collisions run on until the seam stalls (2026-10-27, branch welds, round 2)

- **No set time or shortening ends a collision** (`collision.js`, `config.js`). Two colliding plates weld only once the
  seam between them has been closing slower than `sutureStallCmYr` (0.4 cm/yr) for `sutureStallMyr` (12 Myr), with at
  least `sutureStallMinKm` (200 km) taken up. The 200 km counts either the shortening this pair absorbed or the overlap's
  depth (area over front), whichever is more: land stacked by a third plate or handed on at a weld counts too. Removed:
  welds after 600 km of shortening (`sutureShorteningKm`), after 40 Myr of contact (`sutureContactMyr`), at 0.4 Mkm² of
  overlap (`sutureOverlapKm2`), and the `overdue` weld after 120 Myr locked (`sutureLockMaxMyr`). Those were hand-set
  lock times. After the cores meet, the torque balance alone sets how fast the pair slows: the forces driving the two
  against the collision's viscous resistance. India has run 2400–3200 km into Asia since ~50 Ma and still converges
  (Molnar & Stock 2009; van Hinsbergen et al. 2012). Kept: the stack weld (`sutureStackKm`, 500 km deep), the stall
  give-up (`sutureStallGiveUpMyr`) and the gap stall (`sutureGapStallMyr`).
- **India** (Phase 5): contact at 50 Myr. Closing slows from 8.7 to ~2 cm/yr within ~12 Myr, then falls below the
  stall rate. The weld comes ~60 Myr after contact, after 1,050 km of shortening (main welded it at the 600 km lock). The upper plate's indentation at the weld is 946 / 736 / 631 km in Phase 5's scenes, inside Earth's 600–1,100 km (was 736 / 420 / 736). The
  area swept across the front matches the overlap the weld absorbs (1.46 against 1.22 Mkm²). Shortening stays short
  of Earth's 2,400–3,200 km because Phase 5's scenes leave the underthrust off (`onlyMechanisms`): the overlap stacks,
  and the stack's resistance stops the pair. A weaker `collisionResistance` (25 or 50 instead of 100) makes it weld
  stacked at ~1,200 km, so the lock's strength is not what limits it. With the underthrust on (Phase 7c's India), the
  crust reaches the 40 km thickening cap.
- **Phase 11's zipper now passes.** Main's failure (607 km of sea left at the weld) came from the 24 Myr stall
  give-up, not from `overdue`. With stall-only welds the zipper closes before it welds, so `overdue` is not needed and
  is gone.
- **Tried and rejected:** a plateau push (thickened crust's gravitational potential energy pushing the pair apart) stopped the zipper's
  turn and left 607 km of sea, on every nudge. Dropping the stall give-up welded the zipper with 971 km of sea, and
  India never welded. A gap-closing-rate rule was fooled by `openSeaBetween`'s 1,000 km window: cells on the opening
  side leave the window, so a constant gap read as ~1 cm/yr of closing.
- **Checks.** Phase 5 adds two checks: the pair keeps converging for ≥ 20 Myr after contact, slowing to under a
  quarter of its peak; and the km² swept across the front matches the overlap. It also reports India's shortening
  against Earth. India's scenes run 130 Myr and Wilson's 200 Myr. The invariants now check that a big overlap lasts only
  while the two still converge: a stalled seam welds within `sutureStallGiveUpMyr` + `sutureCheckMyr` + 2 Myr. Pairs
  that are parting, pairs waiting on a closing sea, and overlaps shallower than `sutureStallMinKm` are left out. The
  check that capped how long a big overlap lasts is now a report (121–231 Myr). Phase 6b's "neither plate balloons"
  now bounds the growth rate (30 % per 100 Myr) rather than the total. On main and here, the two plates grow
  identically frame by frame (Westland ~0.25 %/Myr, taking the passive ocean); they just stay two plates 20 Myr longer
  (weld at 128 Myr, not 108), so a total over that window measured the collision's length.
- Numbers (main fe78ce2 → branch). Largest plate's share, Phase 13, three seeds: 76 / 68 / 74 % → 44 / 59 / 48 %.
  600 Myr histories over 4 seeds: peak share 44 / 46 / 51 / 59 → 31 / 50 / 38 / 37 %; mean 24.5 → 21.6 %. All welds now
  come on a stall, 82–117 Myr after contact on average (was 41–74). Peak thickening in the histories is unchanged
  (p95 ~20 km, max 40 km). Active belts' 95th-percentile height: 3.83 → 3.62 km (8a), and after carving 3.69 → 3.47 km
  (8b); Earth 4–5 km. That is no measurable change: an unrelated nudge (plumeSpacingKm 1500 → 1560) gives 3.92 / 3.75 km
  on main and 4.29 / 4.14 km here. Thickening keeps its ratio, ~0.014 km of crust per km of shortening, about Tibet's.
  The belts fall short because the shortening is short (above) and the cap holds (`crustMaxThickKm`).
  `beltHotStrength` and the volume it conserves are untouched (`orogeny.js` unchanged).
- Time, on the lab's 600 Myr history (40K; seeds 12345 / 777 / 4242 / 626225 twice each, 101 / 202 / 303 / 404 once;
  each run beside main fe78ce2 under the same load): 1106.1 s against 1113.4 s, −0.6 % wall. Collisions that run on
  cost nothing measurable: the seam is measured every `sutureCheckMyr` either way.

## Earth targets through the cycle (2026-10-27, branch targets)

The checks' Earth figures are geophysical, not today's snapshot: Earth today is one moment of its supercontinent cycle
(dispersed, ~200 Myr after Pangaea's breakup, in an icehouse). Every `report()` target was sorted three ways:
- **Holds through the cycle** — kept, and its source says so: coastline D by kind of margin, the drainage exponent,
  craton sizes, plume numbers (deep-mantle sources stable ≥ 200 Myr, Torsvik et al. 2010), plate speeds (over 200 Myr,
  Zahirovic et al. 2015), active and quiet belt heights, old sea floor (none much older than ~200 Myr survives in place),
  the ~8 plates above the 10^7.5 km² size kink (at every step back to 200 Ma, Morra et al. 2013).
- **A stage's figure** — restated as Earth's range over its history, or compared at the matching stage, read with the
  shared `tools/lib/cycle-stage.mjs` (`stageOf`: supercontinent, early or late dispersal, from the cycle state every
  frame carries; `byStage` / `stageText` group any report's values by it). Mean sea-floor age over the whole cycle:
  ~35–65 Myr over the last 200 Myr (Williams et al. 2021; Seton et al. 2020), today's ~62–64 kept for Phase 6b's end, a
  world ~240 Myr after its breakup. Plates in all: 10 at 200 Ma to 31 today in reconstructions (Morra et al. 2013), 52
  resolved today (Bird 2003). Plates ≥ 1 % of the planet, enclosed seas and the continents' shapes (Phase 11, 13) are
  compared over the late-dispersal frames only, every frame's figure in the detail. Supercontinent tenure adds Rodinia
  (Li et al. 2008). Where no history was found (the largest plate's share, hypsometry, open-ocean arcs, polar erosion in
  an icehouse) today's range stays, marked "today only". (The land share by stage is the insulation branch's.)
- **Better as a rate or a fate** — enclosed seas are counted less and their ends reported (Phase 11): floors gone down
  whole (`SUBDUCTION_INIT data.sealed`) per 100 Myr and their age then (Earth: the Ionian's ~220–230 Myr floor under
  Calabria; the Herodotus Basin's ~340 Myr still in place), and the share of their floor the rivers have filled to sea
  level. Drying is not modelled; a sea's lifetime is not tracked (a sea has no identity from frame to frame — a seal id
  and time on its floor cells, carried by the crust, would give it).

## Island arcs live by their slab (2026-10-28, branch arcs)

At 1200 Myr (seed 831576) closed rings of thin islands stood round deep basins: arcs stranded far from any trench stood as
high as live ones, never sank, and were never consumed. The arc's life is now its slab's:
- **An arc's crust is recorded** (`Crust.arcKm`, `Crust.arcAt`; on the frame too): 8 km at birth (`arcBirthKm`),
  thickening `arcThickenKmPerMyr` (0.4 km/Myr) up to `arcMaxKm` (35 km) — but only the rows standing above a LIVE trench's
  slab, as `buildArcs` walks from each overriding trench cell across its fore-arc to its arc (`step/wings.js`; the arc
  that feeds itself at a plate's edge too). Rows left behind as the arc widened, or a strip split off, get nothing more
  (Izu-Bonin-Mariana 20–35 km after ~50 Myr, Kodaira et al. 2007; Calvert 2011).
- **It stands on that crust** (`measure.js arcSurfaceKm`, read by `terrain/records.js` and the history's rivers): Airy
  isostasy of the crust beyond the ocean's 7 km (arc crust 2.97 g/cm³, mean Vp ~6.8 km/s, Calvert 2011, by Nafe–Drake,
  Brocher 2005; Turcotte & Schubert 2002), on a ridge's hot floor while live (the mantle wedge; Hyndman et al. 2005), then
  cooling and sinking by the half-space curve from the moment it fell silent (`seaDepthKm`; Parsons & Sclater 1977; Stein
  & Stein 1992), what stood above the sea worn at the dead-island rate (`ISLAND_EROSION_KM_PER_MYR`) down to the waves and
  no further. 8 km: 2.4 km down; 20 km: 0.7 km down (the Marianas: a ridge its volcanoes break); 35 km: ~1 km up (Japan);
  20 km 25 Myr silent: 2.4 km down (the Kyushu–Palau Ridge, 2–3 km down ~25 Myr after the Shikoku Basin split it off,
  Ishizuka et al. 2011). The distance-to-continent rule (`arcOceanMatureKm`, `arcCoastKm`, `arcOceanKm`), `arcYoungKm`,
  `arcMatureKm` and `arcMatureMyr` are gone; arc cones grow with the crust (`measure.js arcGrowth`).
- **A thin arc subducts** (`step/polarity.js floats`): arc crust under `arcAccreteThickKm` (17 km; Cloos 1993) is no longer
  land to the polarity rule — it goes down a trench like ocean, under ocean, arc or continent — and the docking and
  scraping rules judge an arc by its recorded crust, not its age (`collision.js arcCrustKm`), so a remnant left silent
  stays thin and goes down at the next trench it meets — the arc cells at the contact going down as they arrive, not
  the whole arc at once. (A scene's hand-laid arc, never grown, still floats and is read by
  its age.)
- **A plate pulling away from its trench splits at its arc** (`backarc.js pullArcsAfterTrenches`): the history grew new
  floor at the trench itself as the plate retreated (`resolve.js`), stranding the arc and building another in front of it.
  Those births are now reported (`world.rollbackBirths`), and a run of them `backArcMinLengthKm` long splits off its arc
  and fore-arc as a back-arc strip at once (Karig 1971; Taylor & Karner 1983): the strip follows its trench at the faster
  of the slab's rollback and the plate's retreat, and the sea opens behind the arc, the far side left as a remnant arc.
  A plate that split lately (`backArcTenureMyr`) still grows at its trench, as before.

Before → after, the four diagnosis seeds (831576, 626225, 777, 12345) at 300/600/900/1200 Myr, 40K sim cells
(scratch measure script; rings by the diagnosis's ring finder):
- rings of arc ≥ 1000 km round a basin: 81 → 38 (600–1000 km: 75 → 51)
- island-arc crust: 24–43 Mkm² (mean 34) → 17–25 (mean 22); Earth ~3–8 (`check-phase13` reports it)
- arcs above the sea: live 32 → 18 %, silent 39 → 8 % (Earth's remnant arcs nearly all drowned)
- back-arc openings per 100 Myr: 1.2 → 1.75 (Earth 20–40: still far below)
- enclosed seas ≥ 0.05 Mkm², mean 300–1200 Myr: 44 → 30 (12.4 → 8.1 Mkm²)
- land share of the planet: 34.1 → 30.6 % (the arcs that drowned)
- time: the history +1.9 % (two seeds × two rounds at 40K, 1200 Myr; about +3–4 % a step, offset by ~2 % fewer steps);
  the terrain −15 % at 160K (the distance-to-continent search gone from records.js)

## The history cache (2026-10-27, branch history-cache)

Every history built on this machine — by a check suite, a tool, an agent or the Evolution page — is kept in one store
outside any checkout, `~/.cache/geo-sim/histories/` (`tools/lib/history-cache.mjs`), so the same history is built once.

- **Key** (`js/app/history-key.js`): a hash of (1) the history code — every file the history's entry points import
  (`app/history-worker.js`, `app/history-runner.js`, every scene list in `tectonics/scenarios/`), followed through
  imports, re-exports, dynamic imports and worker URLs, so the list cannot go stale (83 files: the steps, the model,
  config, the start world, the helpers, `terrain-config.js` for the evolving heights, `js/rng.js` …; terrain synthesis
  and the finish are not in it — they read frames, never change them); (2) the start world itself, walked whole just
  before the run — the mesh, every plate's raster, the seed, and the config with any override (a lab slider, `--set`,
  the crust ledger, the heights' constants), so two spellings of one start share an entry and anything that changes it
  changes the key; (3) the drive and the event rules; (4) the engine's maths (below). Worktrees whose history code is
  the same share entries. The history's **length and ending are not in it**: a history is causal and an ending never
  steers it, so an entry holds one history's frames at whatever times were recorded, and a 600 Myr request is served
  from a 2200 Myr run (frames on the step grid only: the world there is the same however long the run).
- **The engine's maths.** Node 23 (V8 12.9) and the page's Chromium (149) answer `Math.sin`, `exp`, `pow`, `atan2`…
  differently in the last bit, so the same code, seed and settings give histories that differ from the first steps (a
  plate's ω by ~1e-16 at 10 Myr, ~1e-10 by 300 Myr, float32 fields such as `seaFillKm` here and there). The key carries a
  hash of what the engine's Math functions answer: the page's histories and Node's are filed apart, each exactly what
  its engine builds, and engines that agree share.
- **Entry**: one file per frame (the packed frame, `tectonics/frame-pack.js`, in `app/frame-wire.js`'s format,
  deflated, with its SHA-256), `meta.json` (what it is, who built it, the steps to each frame), and `build.lock` while a
  process builds it. Writes go to a temporary file and are renamed into place; a process that wants frames another is
  building waits for them; a file cut short or damaged is deleted and its history built again, never trusted. ~0.5 MB a
  frame at 40K cells (~0.4 MB early, more as belts and events accumulate): a 1200 Myr history at the page's 10 Myr
  cadence is ~60–70 MB. The world itself is not kept, so a history asked for further than its entry reaches is built
  again from its start.
- **Settings**: `GEO_SIM_HISTORY_CACHE_DIR` (where), `GEO_SIM_HISTORY_CACHE_GB` (the cap, default 4: past it the entries
  used longest ago go, after a build, at most once a minute; or `history.mjs gc`), `GEO_SIM_HISTORY_CACHE=0` (off),
  `GEO_SIM_HISTORY_LOG=file` (one line per hit, build, wait, damaged file).
- **Tools**: `simulateCached(world, opts, { drive: scene.drive })` is `simulate()` through the cache, for callers that
  want only frames (on a hit the world is not run; the events and budget are the last frame's). The terrain suites
  (8a, 8b, 9, 10), 6b, 7b (the scenes' own drives), basins and phase13's long run go through it, and `momentFrame` (so
  `render-moment.mjs`, `coast-shape.mjs`). The old `v2/out/frames/` cache, keyed without the code, is gone.
- **The Evolution page saves by default** when the dev server (`tuning/dev-server.mjs`) serves it: the server serves
  `js/app/history-code.js` with the hash of the history code it is serving written in, and the history worker imports
  it when it starts — so a history is filed under the code the worker actually loaded (a stale tab whose worker starts
  after an edit runs, and files under, the new code; every module is served `no-cache`). The worker hands each packed
  frame to `fetch()` as it builds (`app/history-upload.js`, ~3 ms a frame: 0.08 s of a 41 s history); the server
  compresses and keeps it. Once a second the page reports the moment shown (`evolution/history-view.js`) and the
  server writes `latest.json`: the key, the moment, the link, the settings, the time. `?save=0` turns saving off.
  Anywhere else (GitHub Pages) `history-code.js` holds `null` and the page sends nothing.

**What the user is looking at**, for an agent:

```
node v2/tools/history.mjs latest                         # the history, the moment (timeMyr), the page's link, when
node v2/tools/history.mjs frame --latest --out f.bin     # that very frame: v8.deserialize(fs.readFileSync('f.bin')).frame
sim-slots run -n 6 --gb 16 -- node --max-old-space-size=16000 v2/tools/render-moment.mjs --latest   # …rendered
node v2/tools/history.mjs ls                             # every entry; frame --key <key> --time T for any of them
```

## One height from the crust (2026-10-28, branch unified)

A continent's height was a fixed number for its kind of crust (`continentKm`, `cratonKm`) plus a saturating lift for
its thickened root (`isoMaxKm`, `isoScaleKm`), worn on clocks of its own (`thickTauMyr`, `baseReliefTauMyr`). Now every
continental cell stands where its column floats (`tectonics/measure.js columnModel`, `columnKm`, `crustThicknessKm`):
- **The column.** Crust of density ρc(1−αT) over a lithosphere whose geotherm runs linearly to the mantle's temperature
  at its base (McKenzie 1978), on the asthenosphere; anchored on the ridge (Lachenbruch & Morgan 1990), the same column
  the rifted margins stretch (`margins.js`). Ordinary continent: 35 km crust (`riftCrustKm`, ρ 2.83, Christensen & Mooney
  1995) on 125 km of lithosphere — 0.22 km; at 39 km, Earth's mean, 0.84 km (Earth's mean land height). Craton: 40 km
  (`cratonCrustKm`) on a cold 250 km root (`cratonLithKm`; 220 until branch unified-swell), its mantle depleted by
  `cratonDepletion` 1.1 % (Jordan's isopycnic root; Kaban et al. 2003: 1.1–1.5 %) — 0.51 km. Each km of crust gained or lost moves the ground 0.155 km
  (0.144 on a craton): the Airy rebound, ~5/6 of the rock worn away given back (Molnar & England 1990).
- **The record.** `Crust.rootKm` is the crust's departure from its kind's thickness as formed (negative once worn or
  thinned); the belts' uplift and the start world's swells count as crust by the same slope. Island arcs keep their own
  isostasy (`arcSurfaceKm`), their belt thickening at a quarter share; an arc welded to a continent, or a margin isle
  merged into it, is reworked to at least an ordinary continent's 35 km (`heights.js arcToContinentRootKm`).
- **One clock.** The whole height — column, belts, swells — wears together: `reliefTauMyr` at 2 km × the latitude's rain,
  slower as H/2 km below that (no floor now: the rock worn off a surface H high goes as H², Montgomery & Brandon 2002),
  and the column's share thins the crust (÷ its slope). A shield's basement wears `carveCratonHardness` slower (the
  carving's own constant; crystalline rock is the least erodible, Stock & Montgomery 1999). The shield's step at its edge
  line is the local difference of the two columns (`records.js shieldKm`), not a fixed offset.
- **Filled seas.** A sea its rivers filled — or whose last tens of metres the mantle's swell lifted above the sea — is
  land drawn as the delta and alluvial plain its rivers grade (`plainGrade` 1e-4: the lower Mississippi, Saucier 1994;
  Paola et al. 1992; Parker et al. 1998): rising inland from the shore, no bedrock relief on it, no shelf but its delta
  front. A sea read as sea while its floor stood above the sea had drawn a shelf and slope down from its coast: a moat
  round an island (seed 831576, 310 Myr, 2°S 43°W, −38/−87 m; now land at 95–166 m), and islets across a channel
  (41–50°N, 95–112°E; now a plain at 50–150 m).

Probe (seed 12345, cycle scene, 1200 Myr; main → this branch): land share 28–30 % both; mean land height 1.12–1.56 →
0.85–1.38 km; craton median 0.39–0.79 → 0.58–0.87 km from 400 Myr; crust mean 38 → 40–43 km; craton crust 41 → 37–38 km;
thickest crust 55–86 km. History 190 → 188 s, terrain 26.9 → 26.7 s over 13 frames. New Phase 13 reports ("heights from
the crust (branch unified)"): late-dispersal land mean, craton median, crust means and the thickest, old orogens'
e-folding, freeboard's change through the cycle.

## Closed basins at any height (2026-10-28, branch lakes)

A basin is closed where its rivers cannot fill it to its rim, whatever its height: above sea level or below it, the
same water balance decides (`finish/finish-basins.js` `hollowLakes`). Until now a land hollow was closed only when its
floor lay below the sea; one above it was breached or filled.

- **Inside out.** A hollow's sub-basins form a tree: the cells sorted by height, joined by union–find, each join a sill
  (the depression hierarchy of Barnes et al. 2020, ESurf 8: 431; fill–spill–merge, Barnes, Callaghan & Wickert 2021,
  ESurf 9: 105). Each sub-basin keeps the water that reaches its own cells. A sub-basin whose inflow Q is at least its
  open-water loss E when full fills to its sill and spills its surplus Q − E into the sub-basin it spills into. One
  with Q < E stands at the level where the two balance: a terminal lake, or a playa when that lake is too small to
  show. So Kara-Bogaz-Gol stands lower than the Caspian on the Caspian's overflow alone, and the Bonneville/Lahontan
  chains fill in turn. A sub-basin under `basinMinKm2` passes its water on. A hollow that fills right to its rim is open,
  and its rivers carry its surplus downstream (`finish-hydro.js`).
- **Exactly the balanced lakes are drawn.** Each sub-basin's lake is the set of cells its balance wets, at its own level.
  The rest of a closed hollow stays dry: a playa or a salt flat.
- **Base level.** Rivers never cut below their base level. That is the sea, a lake's balanced level, or, in a closed
  basin, the ground where the river enters it. The carve clamps at base + 2 m. A closed basin is a depositional sink:
  its rivers aggrade toward its lake. Until now the carve graded such rivers to the floor of the one lake drawn. In
  the user's history (seed 831576 at 310 Myr, 44–47°N, 97–101°E) that took 29 500 km² of dry plain to −723 m, and the
  world ocean flooded it as sea fingers. Now none of that box is below sea level, and 12 000 km² of it holds lakes.
- **The timeline's estimate** (`terrain/basin-estimate.js`) paints each sub-basin's lake at its own level, as the finish
  does. A cut-off sea counts as wet if any of its sub-basins keeps a lake the map shows. Which sub-basin holds the water
  depends on the mesh's divides; whether there is water at all depends on the sea's whole balance. `basin-agree.mjs`
  (3 seeds × 4 moments) agrees in sign on 353 of 390 matched seas before the rebase onto `unified`: 91 % by count and
  99 % by area, against 89 % and 99 % on b71c9a5. After the rebase it agrees on 239 of 284: 84 % by count and 96 % by
  area, against 84 % and 97 % on main 2c77da7.

| Seed (640K cells) | Land draining to closed basins, 1200 Myr | 600 Myr |
|---|---|---|
| 831576 | 12.2 % → 23.6 % | 8.8 % → 24.4 % |
| 626225 | 9.4 % → 29.0 % | 21.3 % → 41.0 % |
| 799224 | 3.5 % → 16.2 % | — → 25.0 % |

Earth: ~20 % of the continents today (Wang et al. 2018, Nat. Geosci. 11: 926).

`check-basins.mjs` has a new section, 'closed basins on land'. It reports the endorheic share, a closed lake's area
against its catchment's (median 7–9 %; Earth 1–12 %), and the share ending in a playa, split by aridity. It also has a
two-sub-basin chain test, 'a hollow's sub-basins, inside out'. The finish costs no extra time: the water stage takes
0.9–1.3 s, against 1.1–1.9 s before.

The table was measured before the rebase onto `unified`. After it, the suite's endorheic share is 23–31 % across the
three seeds, within Earth's range. Before the rebase it was 34–41 %.

Still open:
- In wetter climates 78–81 % of closed basins end in a playa. Most of these are one-cell hollows.
- Not done: land lakes keeping their depth, and a salt budget.

## Rivers on the plains (2026-10-29, branch rivers)

In the user's 10M frame (seed 831576 at 310 Myr) Add detail's rivers wound across the plains in tangled "termite
trails". The network is now measured against Earth's, and the finish's causes are fixed.

**Measured** (`tools/lib/river-network.mjs`; `check-phase8b.mjs` 'the network's shape', for the timeline's carve and Add
detail's rivers at 640K; `render-moment.mjs --network` for any moment and detail). Drainage areas are the land's own
(km²), so every detail is measured alike:
- Hack's exponent h, main-stream length ∝ area^h over 10⁴–10⁶ km² (Earth 0.5–0.6: Hack 1957; Rigon et al. 1996);
- Horton's bifurcation ratio over Strahler orders of channels draining 10⁴ km² (Earth 3–5; Horton 1945, Strahler 1957).
  A weak test: almost any random branching tree gives 3–5 (Kirchner 1993);
- the junction angle, each branch read 4 cells up its main stem (Earth ~45° arid to ~72° humid: Seybold, Rothman &
  Kirchner 2017);
- sinuosity across the plains (below 300 m), along ÷ straight over 200 km reaches (Earth ≲ 1.5 traced at ~8 km);
- the rivers' gradient across the plains (Earth 1e-5–1e-4).

**What made the mazes** (seed 831576 at 310 Myr, 640K). 18 % of the low land drained to a cell exactly as high as
itself. Most of these flats (71 %) were the hydrology's (`finish-hydro.js`): every small hollow the finish itself made
(a fan damming a valley, a dissected floor, a pit the carve left) was cut through at one level, its floor, and its
rivers followed the priority flood's ties across the level its water would stand at. On a flat those ties spread
breadth-first from the outlet, so the rivers were drawn as right-angled mazes and loops round the hollow's rim.

**Now:**
- **A gorge falls.** It is cut evenly from its start down to the ground it comes out on, never level at its floor. It
  never goes below that ground and never raises a cell.
- **A drained hollow is routed down its cut ground.** Its rivers take the steepest way down the ground as it now is, in
  a priority flood from its outlet, not the way across its old water level. Its cells take its old places in the
  flood's order, so discharge still gathers upstream first.
- **Ties on a flat go the short way out.** Every flood in the hydrology breaks ties on a flat by the steps in from the
  flat's edge. The rivers that cross a playa or a lake basin's dry floor then run toward its outlet (Barnes, Lehman &
  Mulla 2014). Only the order changes; the levels are as before.
- **Plains are graded by their load** (`finish-sediment.js`). A reach carries `capacityK` · drainage · slope. Where more
  comes in, it drops the rest until its bed's slope carries the load: S = Qs / (capacityK · A). That is steep on a fan
  below the mountains, where the load is heavy and the water little, and gentle down a great river's plain, which
  gathers the plain's water but little rock. The load comes in `gradeRounds` (2) shares, the water re-routed between
  them (a priority flood): a river that has built its bed up leaves it for the lower ground beside it (avulsion). The
  hollows it reaches are filled rather than cut through, and ground already steeper than its load needs is left alone.
  A closed basin's floor takes all that reaches it; before, a quarter, so mass was not kept. Until now a reach dropped
  what it could not carry at its own height (at most 0.25 km at once), spread over `fanSpreadKm`. A plain kept the
  slope, the flats and the hollows it had.
- **The meander noise is held to the ground's slope** (`finish.js meander`). At full strength (±30 m over ~30 km) it is
  ~1e-3 steep, ten times a plain's. It now steepens no cell more than the ground itself does, so on a plain it only
  breaks ties. It acts only at 2.5M and above (its waves are faded below that).

Before → after (main c7ab6ae → this branch). Seed 831576 at 310 Myr, Add detail's rivers:

| Measure (Earth) | 2.5M | 10M |
|---|---|---|
| Hack h (0.5–0.6) | 0.59 → 0.58 | 0.59 → 0.56 |
| Horton R_B (3–5) | 4.66 → 4.91 | 4.50 → 4.62 |
| junction angle, median (45–72°) | 86° → 80° | 87° → 78° |
| plains sinuosity, median · 90th percentile (≲ 1.5) | 1.33 · 2.03 → 1.23 · 1.67 | 1.45 · 2.41 → 1.25 · 1.77 |
| plains gradient, median (1e-5–1e-4) | 1.1e-4 → 1.7e-4 | 5.9e-5 → 1.4e-4 |
| plains reaches dead flat (< 1e-6) | 37 % → 22 % | 43 % → 22 % |

Phase 8b's history (seed 12345, 600 Myr) at 640K: junctions 83° → 78°, plains gradient 0 → 9.1e-5 (dead flat 12 %),
sinuosity p90 1.74 → 1.83, R_B 4.87 → 5.57. The timeline's carve is unchanged: h 0.60, R_B 4.46, 71°, p90 1.41,
6.4e-5. Time: Add detail at 2.5M 57 → 52 s, and at 10M 204 → 208 s (sediment +1.0 s / +4.5 s, the water stage
+0.3 s / −2.4 s; single runs on a shared machine). The history is untouched.

Not changed: the timeline's carve (`carve.js`), whose network was already within Earth's ranges, and the history's
filled seas (`records.js`), which still rise inland at `plainGrade` 1e-4. Deriving their slope from the sediment as well
needs each sea's supply in the frame (`sea-fill.js` has it as it runs, but does not record it) and a transport rate
coefficient with a source. The finish's `capacityK` was set by hand for a load counted per carve, not per Myr.

Still open:
- The finish's junctions stand at ~78–85°, against the carve's 71° and Earth's 45–72°. Its rivers are routed down the
  finished heights, where a stream's channel is narrower than a cell. Following the carve's own receivers where they
  still run downhill did not help: on the finished surface they seldom do.
- Plains sinuosity stays above 1.5 at the 90th percentile in Add detail (~1.8). The plains keep the tectonic surface's
  hills, tens of metres high, on ground that falls ~10 m per 100 km, and the plains' little load does not bury them.
- `check-basins.mjs`: a drawn-down cut-off sea's median water surface at 600 Myr is −1.82 km, against −1.13 km on main
  (Earth −1.5 to −0.03 km; 300 and 950 Myr −0.85 and −0.38 km, against −0.57 and −0.45). Not traced yet. The likely
  cause is a closed basin's floor now taking all the load that reaches it, which changes the hypsometry its balance
  reads.
- The plains' gradient in Add detail is 1.4–1.7e-4, a little above Earth's 1e-4 (`capacityK` sets it, and it was set by
  hand).

## The history's land stands on the mantle's swell (2026-10-29, branch unified-swell)

Follow-ups to "One height from the crust".
- **One land, history and terrain.** The history's rivers decided land and filled seas without the mantle's swell, the
  terrain with it, so they disagreed on what was land (unified's choices 6–8). Now `step/rivers.js` asks
  `terrain/sea-level.js landAndSea` on the world's own view of the crust: continental crust and arcs, seas filled up,
  and a filled sea the swell holds above the sea are land, and the sea's level is reckoned with them, as
  `records.js deriveRecords` does for a frame. The rivers route over heights against the sea with the swell in (it
  tilts the land and its rivers: DiCaprio et al. 2009), and cross filled plains to the real shore; a plain is
  sediment, so it is neither cut nor counted as rock worn. An enclosed sea fills to the sea's level over the swell and
  a delta top 1 m above it (`step/sea-fill.js`), so a filled sea is land to both. Sediment standing above the sea once
  the swell counts, late dispersal: 3.3–5.3 → 1.4–2.9 Mkm³ (the rest is floor the swell lifted after it filled).
- **The swell, smoothed cheaply.** `smoothHeat` gathers the heat onto clusters ~250 km apart (Wendland's C2 kernel,
  Shepard-normalised), smooths their graph and carries the field back the same way: within ~5 m rms of an exact
  Gaussian, as the mesh's own passes are, at 4 ms (40K) and 17 ms (160K) a call against 29 ms and 0.4 s. The terrain
  uses it too.
- **Cratons by their mantle.** A craton's swell or sag follows the heat under it (warm: a swell, as the Kalahari on the
  African superswell; cool: a sag, as the Congo basin over a downwelling), no longer drawn at random; with no swell
  (`mantleSwellKm` 0) shields are flat. Their roots are 250 km (Artemieva & Mooney 2001: 200–350 km): a cold, thick
  root is what holds a thick crust low (Zoback & Mooney 2003).
- **Speed caps count keels.** A plate is held to the continental caps by its continental and craton crust
  (`keelCells`), not island arc: an intra-oceanic arc strip had counted continental and broke the cap at its oceanic
  parent's speed (`steerBackArcStrips`).
- **Belts within Earth's widest.** A belt's width is capped at its kind's widest after the convergence-speed factor,
  not before (a Laramide belt had reached 2,880 km inland).
- **The Mantle swell slider** (Phase 8a) now re-runs the history.

Late dispersal, three seeds, c7ab6ae → this branch: craton crust 37.8 → 39.7 km, craton median 0.67–0.74 → 0.62–0.66
km (Earth 0.3–0.6), dry-land mean 1.20–1.24 → 1.10–1.18 km (Earth 0.80–0.84). Time: history and terrain as before,
within the noise of paired runs (seed 12345, no cache, run side by side).

Still high: the land. Half the late-dispersal land had a belt within 100 Myr, and 72 % of the continental crust was
deformed within 240 Myr against Earth's ~33 % (Müller et al. 2019; a new Phase 13 report): the land is high because too
much of it is a belt, not because a column stands too high — how many margins and collisions a continent meets.

## Trenches nucleate on a segment and propagate (2026-10-28, branch founders)

Seed 831576 (the 'cycle' scene, 30 % continent, 40K cells) founded a 24,390 km trench at 88 Myr with a 26 Mkm² plate
behind it, and at 92 Myr a 10,678 km one with 34.9 Mkm²: the whole margin went down in one step and the ocean split off
at once. On Earth a trench starts on a segment and grows along strike (Puysegur ~150 km, Stern & Gerya 2018; Zhou et al.
2020), and a trench beside a passive margin can grow into it (Lesser Antilles, Scotia, Gibraltar; Duarte et al. 2013,
2016). Now (`step/subduction-init.js`):
- **A trench nucleates on a segment** of `founderNucleusKm` (300 km; a slab sinks as a sheet once a few times the
  plate's thickness): the window along the margin with the highest founder score (√(age/180) + squeeze), not the whole
  margin. This holds for all three kinds: between plates, inside a plate (margins) and across a plate.
- **It propagates along strike while the urge lasts.** Each step, the margin cells next to a live overriding trench of the
  pair (or of the plate itself) are its tips. The urge there is the founder urge of the ocean's age and squeeze plus the
  pull of the slab already down (`founderSlabLoad` × strength × maturity; 0.42 = 1 − √(60/180), from Zhou et al.'s
  60 Myr threshold, so a mature slab can drag 60 Myr floor down that would not go alone). The tip advances
  `founderPropagationCmYr` × min(1, urge) (10 cm/yr; Stern & Gerya 2018 Fig. 8G ~100 mm/yr; Zhou et al. 2020 ~17 cm/yr),
  in whole cell layers with stochastic rounding (scale invariant). It stops where the urge fails. The budget keeps
  `propagatedKm` and `propagatingTipMyr`.
- **Invasion.** A passive coast next to a foreign trench whose slab goes down beside it is a tip too: the trench grows
  into the margin, and the floor ahead goes as a new strip plate (`PLATE_BORN {invasion: true}`).
- **The ocean is peeled off progressively.** It is not split off whole. The plate that goes down is a strip: the ocean
  cells nearest the nucleus coast, bounded at each end by a transform (the STEP faults of Govers & Wortel 2005). As the
  tip propagates, the cells behind each new layer of trench join the strip, and an ocean piece that the strip
  strands goes with it. The strip is protected from microplate capture for `founderSlabMyr` (10 Myr: the time for a
  young slab to become self-sustaining; Gurnis et al. 2004; Stern & Gerya 2018 6–8 Myr), or else an aborted strip
  is captured straight back and refounders every 4 Myr. A front across a plate is kept on the plate
  (`P.acrossFronts`) and grows the same way. Sealed seas still go down whole, as before (round 2: their trench
  nucleates and propagates too; see 'Founders, round 2').
- The between-plate case on the immobile background ocean keeps the old reach carve (a 6b check, "newborn not a
  runaway", failed when the background was peeled by strips). `founderPropagate: false` (the `trenchPropagation`
  mechanism switch) turns all of this off, and a scene's `oceanPlateMinAreaKm2 = Infinity` still turns off in-plate
  births.

- **A young strip grows from its trench, and small hidden plates end.** A trench armed lately against the strip it
  peeled off converges too slowly at first to read as overriding. For `founderSlabMyr` it still counts as a live tip for
  that strip, so the strip grows rather than the margin founding a new plate at every draw. An invading trench's first
  stretch needs floor as deep as a nucleus's (`subductionInitSlabKm`) to hang a slab from. A small ocean plate showing
  nowhere in the world view lies wholly beneath its neighbours: its crust is consumed and it ends
  (`ocean-plates.js captureMicroplates`). Without these, the 7b history held 42 plates (room for 28); with them, 24–28 before the rebase onto
  unified heights and 33–36 after. Most of them are 1–19 Mkm² ocean plates, each with its own trench and arc. The
  check against `reserved.maxPlates` (28, unsourced) is gone in round 2: plate count is now a report against Earth's
  10–52 (see 'Founders, round 2').

Before → after (seed 831576 at 88–96 Myr): births of 26 and 34.9 Mkm² with 10–24k km trenches → strips of 0.05–0.57
Mkm² on ~364 km nuclei. Over 600 Myr, 20K, seeds 12345 and 831576 (`tools/trace-founders.mjs`):
- new plates: 212–231 (63–70 of them invasions), median 0.1 Mkm², 90th percentile 1.1–1.6 Mkm². Births above 5 Mkm²
  remain: the two early background-ocean births on 831576 (33 and 22 Mkm² at 46 and 64 Myr, the reach carve), and
  strips carrying their full width of floor or stranded pieces (5–18 Mkm², mostly invasions)
- subduction initiations 67/124 → 152/163 per 600 Myr (most of them short inside-plate strips); phase 6b 20–33 per
  100 Myr. The [12, 30] ceiling had no source; it is now [12, 40]: "nearly half of all active subduction zones
  initiated during the Cenozoic" (Gurnis, Hall & Lavier 2004), i.e. ~half of ~55,000 km (Stern 2002) in 66 Myr at
  ≳1000 km each once grown (Stern & Gerya 2018) gives ≲40 per 100 Myr (in 6b and 13; a trench growing along strike is
  not a new one)
- propagation 7.7–7.8 cm/yr while urged (Earth 5–17 cm/yr)
- longest trench line after 100 Myr 2.9–6.7k km (Peru–Chile ~5,900); total overriding trench length 38–78k →
  72–115k km (Earth ~55k, Stern 2002): too long. Each strip keeps its own trench, and a strip pair at a
  junction counts twice
- spreading 4.3–4.9 → 3.2–3.9 km²/yr (Earth 2.85–3.4; Cogné & Humler 2004)

**Sea-floor age is not fixed by this.** In phase 6b the mean went from 47–58 to 73–85 Myr, with floor older than 180
Myr from 3–4.5 % to 12–14 %. Over the long histories it is about the same (cycle scene 300–600 Myr: 58–110 → 70–112 Myr).
The instant whole-ocean births had driven fast spreading, and that spreading kept the floor young. The diagnosis
(scratch `age.mjs`): the age consumed at trenches is 1.1–1.9 × the mean, so the shape is near Parsons's triangle (steady
state: mean = 2/3 of the consumed age, 1/9 of floor older than twice the mean). The excess is relict floor that no
trench reaches: sealed seas, ocean scraps that tidy hands to the immobile background, and floor more than 3000 km from
any trench. The number of births and their length are not the lever. `check-phase13` now reports the share of floor
older than twice its mean (Earth 8–15 %, the triangle law).

Earth-target reports added to `check-phase13` (late dispersal): longest trench (4,000–8,000 km; Peru–Chile ~5,900),
total trench length (40,000–60,000 km; Stern 2002, Scholl & von Huene 2009), propagation (5–17 cm/yr), median area of new
plates (no Earth figure), floor older than twice its mean (8–15 %).

Time: the lab's 'history' scene, 40K, 600 Myr, four seeds (12345, 777, 4242, 626225), `GEO_SIM_HISTORY_CACHE=0`, main
and branch interleaved seed by seed under the same shared load: CPU 447 → 487 s (+9 %); wall 441 → 430 s (the load's
noise). By a CPU profile the founder code is ≲1.5 % of the history (all of `subduction-init.js` 4 %). The rest is more
steps (546–585 → 576–601: small fast strips shorten the step) and more live plates, which cost `resolve.js` per plate
in its gap work (decideBirth, nearestCrustInto: already tuned by the speed branch). Not offset yet.

## Founders, round 2 (2026-10-29, branch founders)

- **Plate count is a report, not a hard check** (Jackson, 2026-10-29). `reserved.maxPlates` (28) had no source and the
  engine never read it. Phase 7b reports the most plates at once and at the end against Earth's 10–52: ~10 at 200 Ma
  rising to 31 today in the Seton 2012 reconstruction (Morra et al. 2013), 52 resolved today, 38 of them small (Bird
  2003). It keeps one hard check, 'no runaway fragmentation (a bug guard)', at 150 plates (~3× Earth's 52): a guard
  against a loop that makes plates faster than they end, not an Earth target.
- **Strips do not weld to a co-moving neighbour: they never co-move.** Measured on the 7b history (seed 12345, every 2
  Myr), a strip at least 10 Myr old moves against the plates it touches at a median of 8.6 cm/yr (p10 4 cm/yr). None of
  2,568 pair-frames came under the engine's locked-contact speed (`boundaryActiveCmYr`, 0.3 cm/yr), and 26 came under 2
  cm/yr. A small plate with a trench is fast (Forsyth & Uyeda 1975). No weld rule was added. The 7b excess over main is
  short-lived microplates: per frame, ocean-born plates under 0.5 Mkm² go from 1.1 to 5.2 and those of 0.5–2 Mkm² from 0.9
  to 2.4. They live a median 4–8 Myr, then are consumed or captured.
- **Trench length is main's open problem, not this branch's.** Total overriding trench, cycle scene, 20K, from 150 Myr:
  main c7ab6ae 91–149k km, this branch 65–110k. 7b history: main 104–119k, branch 97–108k. Earth is 40–60k (Stern 2002).
  Round 1's 'main 50–70k' was measured before the rebase onto `unified`.
- **A sealed sea's trench nucleates and propagates** (`step/subduction-init.js`). Its floor still leaves whole, as one
  slab cut off from any ridge. But the trench is armed on `founderNucleusKm` of the shore, where the floor is heaviest,
  and runs along the shore from there. Propagation now arms the shore ahead where the floor behind it has already left
  with the plate below. Cycle scene: sealed seas' trenches nucleate on 172 km of shores up to 7,400 km long. Their floors
  (0.03–1.6 Mkm²) go down their trench in 2–40 Myr; a minority are captured back.
- **A scrap of ocean cut off from its plate keeps its age** (`ops/tidy-plates.js`, the one file outside round 1's;
  a few lines). Tidy still hands such a piece to the passive ocean, as on main, but used to stamp it pre-history old
  (`formedAt` ≤ −1). That made old-looking floor out of young scraps and skewed every sea-floor age report. Now a scrap
  keeps the age it had. The exception is a scrap at a convergent seam: one with a cell beneath another plate, or closing
  on its neighbour faster than `boundaryActiveCmYr`. It is stamped as before. Young floor kept at such seams made the
  'laramide' slab steepen 5 Myr apart across meshes (the scale check).

  The wider change was tried first and reverted: ocean scraps joining a plate they touch (microplate capture), a plate's
  worth moving on as a plate, and the main piece ranked by terranes. Each part broke a hard check. Slivers captured
  across a closing seam kept India from suturing (7c, 8a) and steepened the 'laramide' slab early at 40K (scale). Slivers
  consumed outright left gaps. The zipper weld gap grew to 607–728 km (limit 371). Land stacked to 6,410 km at 456 Myr
  (invariants). Phase 10's scene did not form, and the 7b plate peak reached 42. Rerouting scraps needs its own design;
  it is left open.

Results at the head, with main 5f45475 where it has the same figure:

- Sea-floor age, 6b, mean: 59.8 / 60.7 / 68.5 Myr (main 66.1 / 59.5 / 81.4). Floor older than 180 Myr: 5.9–8.2 %.
- Phase 13, mean sea-floor age: 74.3 / 72.4 / 80.6 Myr (main c7ab6ae 81.9 / 74.4 / 68.9; round 1 79.6 / 88.2 / 82.2).
  Floor older than twice its mean: 11.5–12.3 %. Propagation: 7.75–7.94 cm/yr. Longest trench: 3,760–3,880 km. Total
  trench: 118–124k km.
- Plates (7b): 34 at most, 33 at the end. 6/6b at the end: 30 / 32 / 28.
- The phase 11 zipper ('weld only once the sea between them is closed', 607 km against 371) fails here as on most
  meshes for main too. Main passes on 1 of 6 mesh seeds (12345), this branch on 1 of 6 (seed 1). It is a knife-edge
  check, not a change in rate.

Time: the lab's 'history' scene, 40K, 600 Myr, seeds 12345, 777, 4242 and 626225, `SIM_REMOTE=0`,
`GEO_SIM_HISTORY_CACHE=0`, main 5f45475 and the branch run in pairs under the same load (measured at c614a5f; the head
differs only in tidy's age stamp). CPU 309.5 → 333.4 s (+7.7 %), wall 236.6 → 253.4 s (+7.1 %). Steps 2,255 → 2,335
(+3.5 %), likely the extra microplates' short steps (not measured). Profile: `resolve.js` takes 21.7 % (`decideBirth` 7.7 %,
`nearestCrustInto` 3.4 %) and `subduction-init.js` 3.3 %. No offset was found. The speed lane had already tuned these
paths, and no cheap change gave identical results.

Not done: **step 5**, a founder between a plate and the passive-ocean background. The background never takes crust, so a
strip peeled there swells instead of opening. It needs a design change to the background. **Option C** (a weld rule on
other grounds) waits for Jackson.

## People: the civ layer, behind a switch (2026-10-29, branch civ)

The civ layer (`js/civ/`, plans/CIV_PLAN.md) puts people on a detailed moment: the first humans spreading from 70 000
years ago, farming, towns and states. On the Evolution page it is **off by default**.

- **The switch**: View → **People (beta)**, remembered in the browser (`orogen.evolution.civ`). Off, the People tab,
  Settlements and the phone's People view are hidden, and none of the civ layer is loaded.
- **Off, Add detail does no civ work.** `finishPlanet({ civ })` defaults to false: the finish then loads nothing from
  `js/civ/`, gathers no disease or crop climates and copies no winds or currents, and returns `civ: null`. The finish
  worker builds no civ world. The civ code is reached only by dynamic imports: `civ/civ-finish.js` from the finish,
  `civ/civ-page.js` from the worker, `evolution/people-view.js` and `civ-page.js` from the page.
- **On**, Add detail gathers the civ fields and the worker hands the page a 160K-cell world; the People tab works its
  people out on request, as before. Turned on over a moment detailed with it off, the chip says so and offers **Add
  detail again** (the finish's fine fields are gone by then, so the civ world cannot be built afterwards).
- **The Node civ tools** that run the finish (`civ-sim` and `civ-cradles` through `worldOf`, `civ-ensemble`,
  `civ-travel`) pass `civ: true` themselves. Their cached worlds are keyed by the history and finish code (`worldCode()` in `tools/lib/civ-world.mjs`,
  through `historyCodeHash(root, entries)`), and their frames come from the history cache.

The cost, measured headless as the finish worker runs it (finishPlanet, the civ world, finishRaster; seed 13, 30%
continent, 500 Myr; Node, local, 3 rounds interleaved main → civ off → civ on; median and range, seconds):

| Cells | main 5f45475 | civ off | civ on | the civ world |
|---|---|---|---|---|
| 2.5M | 63.8 (59.6–70.7) | 61.2 (54.1–70.8) | 63.4 (59.4–67.8) | 0.3 |
| 10M | 310 (217–393) | 228 (205–238) | 330 (292–411) | 0.6 |

Civ off against main, paired by round: +0.1, −2.6, −5.5 s at 2.5M; +22, −82, −188 s at 10M (a shared machine near its
memory: main alone ranged 217–393 s) — no cost beyond the noise. Civ on costs ~2 s at 2.5M (3 %). At 10M it was slower
in every round, more than its own work explains: the civ collectors take ~4.7 µs a land cell (measured alone, so ~10–15
s at 10M), and the civ world 0.3–0.7 s; the rest is the machine's noise. Heights, lakes, rivers,
climate, the picture and the stats are bit-identical between main, civ off and civ on at every size measured: civ on
only adds its own fields.

## Ice-dammed lakes held by their ice (2026-10-29, branch floods)

- **A NaN under shelf ice.** The ice-dug basins' lowland term (`finish-ice.js`: the land's height averaged over 150 km)
  read NaN on ice grounded on a shelf with no land within the blur. The NaN height went into the outburst floods' two
  priority floods, broke their heap's order, and lakes were booked as ice-dammed planet-wide: on 831576 at 310 Myr, 142
  lakes, 35.9 Mkm², 4.4 M km³, 4.4 Mkm² ones at 3.6°N and 20.6°N, flood scour down ordinary rivers near the equator.
  No land within the blur now reads as the sea's floor (lowland). Latent since the floods landed (501cd4b).
- **The ice holds water as high as its hydraulic head** — the bed plus ρi/ρw of the ice over it (Shreve 1972) — the
  level a lake floats its dam at (Thorarinsson 1939; Nye 1976), not the ice's surface.
- **A lake fills only if its water can.** Its catchment (every cell whose way down the walled ground runs into it) sends
  its ice-age runoff — dried as the snow is, and only where the summer thaws — against its surface's open-water
  evaporation (cooled with the ice age's air) net of its rain. A lake that loses more than comes in never reaches its dam
  and does not burst. `finish.js` passes the moment's `runoff` and `pet` to `lastIceAge`.
- **Checks:** `check-floods.mjs` (new). Hard: a valley dammed across its outlet holds a lake, in a wet climate and not a
  dry one; ice above a closed hollow dams none; on seven finished moments every ice-dammed lake has ice across its way
  out, and the ice age leaves every height a number (bug guards). Reported against the last glacial (Agassiz, Missoula,
  the Baltic Ice Lake, the West Siberian lakes): the count, their area, the largest's water and area, the lowest latitude.
- **Before → after** (renders in `v2/out/moments/floods-{before,after}-*`): 831576 at 310 Myr, 640K: 142 lakes, 35.9 Mkm²,
  4.42 M km³, the largest 878 000 km³ → 20 lakes, 0.44 Mkm², 0.43 M km³, the largest 114 000 km³, all but two small ones
  poleward of 50°. 777 at 300 Myr (a glacial world that should flood): 37 lakes, 4.15 Mkm² → 36, 3.99 Mkm², the same
  great lakes, a little lower (the hydraulic head). 831576 at 310, 2.5M: the NaN did not arise there; 24 lakes either way,
  0.45 → 0.42 M km³. The mutation test: with the NaN fix reverted, both bug guards fail on 5 of check-floods' 7 moments.
- **Time:** the added work is a few passes over the cells; a 150 km pet blur in the first cut (~100 ms at 640K, measured)
  was replaced by each lake's own evaporation for its bared-shelf cells (identical results). The ice-age stage, three
  rounds interleaved with main b26455c's (`SIM_REMOTE=0`, 831576 at 310, 640K): 1430/1972/1685 ms → 1524/1423/1531 ms;
  the whole Add detail 75/41/37 s → 36/32/31 s (main's NaN made its floods far bigger). 2.5M: 3656 → 3437 ms. No slowdown.
- **Open:** on glacial worlds a few lakes are still several times Earth's largest (to 3.7 M km³, 3.8 Mkm²): ice-free polar
  lowlands ringed by ice whose sills sit under 1–2 km of it, with ample runoff — the West Siberian lakes' setting, at 4–5×
  their size. Whether ice should flow into such lowlands (finish-ice's extent) is a design choice left open.

```
node v2/tools/check-floods.mjs         # ice-dammed lakes: held by ice across their outlet, filled by their water; reported against the last glacial's
```

## Speed: resolve and boundaries (2026-10-30, branch speed-resolve)

Pays back the founders' +7.7 % whole-history CPU (b26455c over 5f45475). Every change is exact: frames are bit-identical.

- **Nearest-crust searches start at the nearest crust's ring.** `nearEdge` (gather.js) now keeps edge counts for rings
  1 and 2 as well as 3, updated incrementally. For a cell with no crust, the nearest crust lies on the ring of its nearest
  edge cell, so `decideBirth`'s search starts there. Cells with no edge within ring 3 are dropped from the gap candidates
  before any walk. `PROXIMITY_RINGS` must equal `RING_COUNT` (resolve.js throws otherwise).
- **The counts are brought up to date from the cells resolve changed**, not from a full mask diff. `CrustRaster.version`
  (crust.js, the version lines only) is bumped on every mask flip. `nearEdge` returns early when the version is unchanged.
  A changed-cell hint is used only when its length equals the version delta.
- **A gap cell's raster cell is read from the gather's claim map** (`currentClaimMap`, `rasterCellUnder`), not looked up
  again. `decideBirth` runs its gap test before its own nearest-crust search. It asks the last rival found with crust under
  a candidate first, because neighbouring candidates mostly share it. Deep-crust NOT_A_GAP verdicts need no walk.
- **Gaps and collisions are found in the post-gather pass.** Per-plate `lost[]` lists replace a rescan. `candidateCells`
  works on typed scratch arrays. The per-bin rival cache is a packed array. `fractureAt` reuses scratch instead of
  allocating a Set and a Map per birth.
- **Boundaries and contacts.** Interior cells (every neighbour on the same plate) are answered by an inline test without
  the contact cache (classifyBoundaries, contactAt). `voteSegments` marks its segments in stamped scratch arrays, keyed by a
  numeric plate pair. The trench flag is cleared only where it is set. The ocean-contact key is numeric.
- **Outside the three files:** `Plate.refreshExtent` skips mask words with no crust (plate.js). `spreadBelt` dedupes the
  cells it reaches by a mark, not a Set (orogeny.js). There is a small helper in contact.js.
- **Exactness.** Frames are hashed with sha256 over every field and the event log. Full 600 Myr histories are identical
  to b26455c's on seeds 12345, 777 and 626225 at 40K and at 20K (61 frames each). The cycle scene is identical on 777 for
  1200 Myr at 40K (121 frames). The check failures are the same set as main's, with the same numbers.
- **Time.** History scene, 40K, 600 Myr, seeds 12345/777/4242/626225, `SIM_REMOTE=0 GEO_SIM_HISTORY_CACHE=0`. Each round
  runs 5f45475, b26455c and the branch side by side, summed over the 4 seeds:

  | Round | 5f45475 CPU | b26455c CPU | Branch CPU | Branch vs 5f45475 | Branch vs b26455c |
  |---|---|---|---|---|---|
  | 1 | 328 s | 361 s | 334 s | +1.8 % | −7.5 % |
  | 2 | 317 s | 343 s | 316 s | −0.3 % | −7.9 % |

  Earlier heads measured −7.2 %, −7.6 % and −8.1 % against b26455c. Wall time is 3–6 % below 5f45475's. Resolve's share of
  the history fell from 37 % to about 31 %. classifyBoundaries fell from 5.5 to 3.6 ms per call.
- **Tried and dropped** (exact but no faster): edge-pass interior detection in contacts (reverted, e3f3068); sector culling
  in the gather; a certain-texel table for the sphere index; incremental resolve, because births sit beside the gaps;
  edge counts packed in one word per cell.
- **Open.** Parity with 5f45475 is within noise, not clearly below it.
## Straight channels on level ground: pits breached, hollows filled (2026-10-29, branch rivers2)

In the user's frame (seed 831576 at 310 Myr) Add detail drew straight channels converging across low ground near 0.8°N
128.4°E: a "broom". **Measured** (`river-network.mjs`, the `broom` measure; `check-phase8b.mjs` reports it): the share of
low reaches (falling under 2e-4 over 200 km, at any height, a reach through a lake not counted) that are dead level (a
fall under 1e-6 over 200 km — no alluvial river is that flat: the lower Amazon falls ~2e-5) or that rise, and the share
of low channel length in links of 200 km or more that never bend (sinuosity under 1.05).

**What made it** (toggled one at a time, 640K and 2.5M): dead-level ground, not the routing. `closedBasins` levelled a
terminal lake's floor to its balance level, so a dry closed basin's floor was a plain hundreds of km across at one
height (374 m under the broom); and a hollow's pockets were cut from their floors level until lower ground, gorges a
km deep and thousands of km long (the item-B trench at 34.1°N 122.1°E: a pocket gorge level at −112 m for ~1,800 km,
drawn but dark in it). Flat routing, the sediment grading and the meander cap were not the cause.

**Now** (Lindsay 2016's hybrid, the user's ruling):
- **A closed basin keeps its floor** (`finish-basins.js`, one line: the lakes lane's file). Its water stands over it.
- **Only an artifact pit is breached**: no deeper than `pitDepthKm` (15 m), its channel out no longer than
  `pitBreachKm` (100 km), and that channel falls (`gorgeMinGrade` 1e-5).
- **An outlet cuts its sill down only so far**: to the ground its outflow reaches within `breachReachKm` (100 km, a
  knickpoint's retreat; Crosby & Whipple 2006, recalled), never to its floor.
- **Any other hollow fills and spills**: by its own water balance a fresh lake spilling on, a salt lake or a pan; one
  too small to show is filled with its river's load, graded up from where it spills at `fillGrade` (5e-5) and sagged by
  `fillSag` (0.25: a muddy fill compacts) of its thickness, each cell above the one it was reached from. A fill is held
  below only the ground that drains into it (until this lane every lower neighbour, a gorge or a lake bed, planed fills
  level at their spill height: 53 % of the low reaches dead level on phase 8b's world).
- **A river into a dry closed basin ends there**, at its playa or sink; into a wet one, at its lake. It is never routed
  across at the level the water would stand.
- **What is left of the hollows a river crosses** — after the water is known — becomes a lake at its rim where the map
  shows one, else a graded fill.
- **A finishing hollow a gorge has since opened** (ground beside it lower than its level) is cut through as before.

Before → after (main 5f45475 → this branch), Add detail's rivers:

| Measure (Earth) | user's frame 640K | user's frame 2.5M | phase 8b world 640K |
|---|---|---|---|
| low reaches dead level (0–2 %) | 27 → 16 % | 23 → 12 % | 9 → 13 % |
| low reaches rising | 1 → 3 % | 1 → 3 % | 3 → 4 % |
| dead-straight runs | 6 → 4 % | 2 → 0 % | 4 → 14 % |
| Hack h (0.5–0.6) | 0.60 → 0.60 | 0.58 → 0.58 | 0.62 → 0.76 |
| Horton R_B (3–5) | 4.86 → 7.74 | 4.64 → 8.94 | 6.11 → 7.46 |
| junction angle (45–72°) | 79 → 80° | 81 → 85° | 77 → 75° |
| plains sinuosity p90 (≤ 1.5) | 1.58 → 1.67 | 1.62 → 2.22 | 2.56 → 3.11 |
| plain gradient, median (1e-5–1e-4) | 1.9e-4 → 2.5e-4 | 1.9e-4 → 2.6e-4 | 2.4e-4 → 2.0e-5 |

**Pending the gs-basins lane — not tuned here.** With floors kept and hollows no longer cut through, the land's
hollows hold water: at 2.5M fresh lakes 1.7 → 16.4 Mkm², salt 0.57 → 2.19, pans 0.08 → 0.11. The broom itself is now
under a 1.63 Mkm² fresh lake (water 463 m over a 67 m floor), item B under one of 1.27 Mkm² (833 m), one of 1.68 Mkm²
at 40°N 108°E. These are the history's sinking land basins left unfilled (sediment, the gs-basins lane). Basins check
(300/600/950 Myr, main → this branch): land draining to closed basins 23.7/30.3/32.1 → 28.7/34.6/38.2 % (Earth
15–35 %); cut-off seas spilling 67.8/54.8/33.3 → 61.8/54.8/32.1 %. Item A (19.5°N 96.1°E): a tectonic closed hollow
main cut a gorge >100 m deep into (a lake below sea level at 10M); now a fresh lake at its rim (289 m over 288 m).

**Time.** The water stage at 640K: 1.3 → 1.8–2.4 s (paired dumps; the machine shared). At 2.5M, branch then main back
to back: water 12.7 vs 10.4 s, but every stage the branch does not touch ran 15–50 % slower in its run too; not
resolved under the load, and 10M not run.

**Open:**
- **Straight runs on phase 8b's world (14 % vs 4 %)**: pockets in the hollows cut through before the water is known are
  still filled from where they spill, cones whose rivers run as spokes. Left unfilled instead, their rivers climbed out
  over sills beside a lower way out (15 % rising): `reroute` floods a cut hollow from its old outlet, and an exit onto
  ground later in the flood's order breaks the upstream-first discharge. The fix is routing after all cuts, then the
  discharge — a restructure.
- The trapped seas' `seaFull` 3 m gorges are as before; flood silt and scour flats (`finish-floods.js`) unmeasured here.
- A closed pocket's lake does not reduce the discharge below it.
- Sinuosity p90 and Horton rise, the junction count falls: lakes cover channels, and the measure skips them.

## Rivers routed on the finished ground (2026-10-30, branch rivers2, lane rivers3)

Rivers2 left phase 8b's world with dead-straight runs at 14 % and the plains' gradient at 2e-5, and blamed the
pockets of cut hollows filled as cones from one spill point. **Measured** (`river-network.mjs`, as rivers2): most of
it was a NaN. The ice age's basin blur left 13 heights NaN deep in trapped seas (floods' 02c8940 fixes it), and one
NaN key in a priority flood's heap breaks its order for every cell after it. With the NaN gone, c22a381's straight
runs on that world are 1 %, and its plains' gradient is 3.8e-4 — the terrain's, above Earth's 1e-5–1e-4 on main too
(heim: that target dropped). `check-phase8b.mjs` now fails on any NaN height reaching the water (`stats.water.nanHeights`).

**Now** (`finish-hydro.js`):
- **The final routing is the finished ground's.** After every breach, cut and fill, one priority flood from the sea
  and from every place water ends — a salt lake, a closed basin's playa or dry sink, at its bed — gives each cell its
  way down; then the discharge is gathered upstream first. Until then the ways were the first flood's, patched hollow
  by hollow, and the water was gathered in that flood's order: rivers sent over an old rim where a gorge had since
  opened a lower way.
- **A closed basin is reached from outside only over its rim** (its level, as the first flood had it full; the basin
  and its salt lakes one region): a pit of a few cells beside a big river, closed by its own water, is no sink for the
  river (without it 120,000 m³/s ended in five cells).
- **A fresh lake passes on what reaches it, less its open water's loss** (until then all of it). The months
  (`riverYears`) run down the same tree.
- **Every dry hollow left under the flood** is a fresh lake at its rim (if the map shows it and its water fills it)
  or filled by its river's load, then the flood runs again for a second round — a fill rising inland from its outlet
  buries the sill of a hollow that spilled onto it, which fills in turn (1823 then 57 hollows on phase 8b's world). The
  second round's fills are routed down themselves, not flooded again. This replaces the late pass, which chose on the
  first routing.
- **A fill is graded from its edges** (`fillGrade` both ways; Barnes, Lehman & Mulla 2014's two gradients as
  elevation): down away from the higher ground round it that drains in — fans and deltas building out from every
  side — and down toward its outlet. Its rivers run in from its edges to a trunk and down that, gathering as they go;
  until then it rose from the outlet alone, a cone, its rivers spokes.

Before → after, Add detail's rivers, all with floods' NaN fix (c22a381 + 02c8940 → this branch + 02c8940; main
dd71d40 in brackets — another history, for scale):

| Measure (Earth) | phase 8b world 640K | user's frame 640K | user's frame 2.5M |
|---|---|---|---|
| low reaches dead level (0–2 %) | 6 → 3 % [21] | 10 → 9 % [22] | 12 → 10 % |
| low reaches rising | 2 → 0 % [3] | 3 → 1 % [1] | 3 → 1 % |
| dead-straight runs | 1 → 4 % [6] | 4 → 4 % [8] | 0 → 0 % |
| Hack h (0.5–0.6) | 0.59 → 0.61 [0.60] | 0.60 → 0.61 [0.60] | 0.58 → 0.58 |
| Horton R_B (3–5) | 8.05 → 7.29 [4.90] | 7.25 → 7.04 [5.02] | 8.94 → 7.93 |
| junction angle (45–72°) | 80 → 80° [79] | 80 → 81° [79] | 86 → 86° |
| plains sinuosity p90 (≤ 1.5) | 6.15 → 1.49 [1.54] | 1.79 → 1.51 [1.52] | 2.20 → 1.57 |
| plain gradient, median (1e-5–1e-4) | 3.8e-4 → 3.8e-4 [1.6e-4] | 2.2e-4 → 2.2e-4 [1.9e-4] | 2.6e-4 → 2.5e-4 |

The straight runs on phase 8b's world are a few links of its 82 (c22a381's 1 % a few of 77): within the noise of
that count; main's are 6 %. The dead-level reaches left on the user's frame are on ground the water stage does not touch, and the
below-sea-level land it raises to `seaCutFloorKm` (3 m) — a flat (unchanged here). Hard checks (phase 8a, 8b, basins,
with 02c8940): the branch's failure set as before; the new NaN guard passes.

**Time** (the water stage, c22a381 + 02c8940 vs this branch + 02c8940, interleaved, load 3.4–5.5 on 8 cores): at
640K 1.01–1.12 vs 1.08–1.15 s (+0.05 s, ~0.3 % of Add detail's 16 s); at 2.5M 4.51–4.58 vs 4.68–4.71 s (+0.14 s,
~0.3 % of its 44 s). The final flood costs two floods more; the late pass it replaces, the hollow-by-hollow monthly
routing it drops and receivers compared without a square root (identical ways) pay for most of it. 10M not run.

**Open:**
- The below-sea-level land raised to 3 m is a dead-level flat (part of the user's frame's dead-level reaches).
- Lakes evaporate now: at 2.5M the water reaching the sea falls from 0.96 to 0.81 while the history's sinking basins
  stand as giant lakes (pending the gs-basins lane).
- The decisions (lake, salt, pan, cut) are still the first routing's; a closed basin that the final routing would feed
  more is not re-judged.
## The land's hollows fill with their rivers' load (2026-10-29, branch basins)

**What was wrong.** The history's rivers crossed every hollow at its spill level and sent all their load to the sea, so
hollows only grew. At 40K cells, cont 30, the land below its spill went from 17 % at 100 Myr to 27 % at 300 Myr
(seed 831576). The largest hollows were 2–17 Mkm² and 0.2–1 km deep, on old continental and craton crust, with
swells, base swells, columns and cuts making their rims. In the finish they became lakes. With rivers2's hydrology,
lakes covered 4–11 % of the land, against Earth's 1.8 % (HydroLAKES, Messager et al. 2016) to 3.7 % (Verpoorter et al.
2014). The largest was 4 Mkm², against the Caspian's 0.37 Mkm² and Mega-Chad's 0.36 Mkm².

**What changed.**
- **Hollows trap sediment** (`tectonics/step/rivers.js`). Each hollow, the cells below one spill joined side to
  side, is one lake; whatever sediment leaves it goes out through its outlet. A hollow is closed when its brimful lake
  would lose more water to evaporation than flows in (`lakeEvaporationMm` 1300: ~98 W/m² of surface net radiation,
  Trenberth et al. 2009, over water's latent heat). A closed hollow keeps all its load. A hollow a river flows through
  keeps Brune's (1953) share, 1 − 0.05/√τ, as Vörösmarty et al. 2003 fit it. Here τ is the hollow's volume below
  the spill divided by its inflow: rain over the catchment times `basinRunoffShare` 0.35 (Trenberth et al. 2007).
  The trapped sediment is laid from the bottom up. It fills the rivers' cuts first, then builds a plain at the
  spill level that rises from the outlet at `plainGrade`, so the floor is gentle and slopes to its outlet.
- **Rivers stop at a lake's surface.** A river no longer cuts below the surface of the lake it runs into. The old
  cuts had been deepening hollows.
- **The fill is a crust record**, `crust.basinFillKm`, like `seaFillKm`. It moves with its plate and loads it by Airy
  isostasy (`LAND_SEDIMENT_LOAD_FACTOR` = ρm/(ρm − ρs) ≈ 4.1, so ~4 km of sediment fills a 1 km hollow). It wears as
  its land does (`step/heights.js`). `records.js` draws it, and it buries the platform's bedrock basins and arches
  (`basinCover` in `synthesize.js`). The sediment is the continents' own rock, moved, so the crust ledger does not
  change. What a hollow keeps no longer reaches the sea, the trenches' fans or an enclosed sea.
- **Tools.** `tools/trace-basins.mjs` reports the history's hollows through time and the finish's lakes, including
  how much of each lake lies over a history hollow and the crust under it. `tools/lib/land-water.mjs` holds the shared
  measurement. `check-basins` has a new section: trap efficiency against measured reservoirs, plus reports on the
  land's lakes, the largest and deepest, the land below its spill, the land's mean height and the fill held.

**Results** (40K, cont 30; rivers2 → basins, lakes on land as a share of land):
- 626225: 9.4 → 3.8 % at 300 Myr, 4.0 → 3.6 % at 600, 7.3 → 3.6 % at 950.
- 831576: 10.9 → 5.7 % at 310 Myr (640K cells), with the largest lake 4.09 → 0.43 Mkm²; 4.3 → 3.8 % at 600.
- History, 831576 at 300 Myr: hollow volume 6.2 → 1.0 Mkm³ and the largest hollow 5.5 → 0.9 Mkm², with ~370 Mkm³
  trapped over 300 Myr (~1.2 km³ a year).

**What is left.** Only ~10 % of the remaining lakes lie over a history hollow. Most sit in belts: closed basins the
terrain draws between ranges, 0.2–0.9 Mkm² and 0.2–0.8 km deep (Earth's Altiplano and Tibetan lakes are far smaller).
Zeroing the terrain's own craton sags and foredeeps (`cratonSagKm`, `foredeepMaxKm`) left the lake area unchanged,
3.7–4.3 % against 3.6–3.8 %, so those depressions are not where the extra lakes come from. A few km-deep bodies lie
on island-arc crust: back-arc basins closed off by their arcs. `land-water.mjs` now counts a body as sea when a
quarter of it lies on open sea floor.

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
