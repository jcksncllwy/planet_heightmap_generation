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
the **World** section — folded to a one-line summary once a history is building: the seed, **Water** (the ocean, × Earth's;
in the link `water=`) and **Continental Crust** (the start world's crust, % of the surface — not its land; `crust=`; Earth's
preset 1.00× and 41 %, the defaults; an older link's `cont=`, the retired land-size slider, takes them),
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
over `rainInlandKm`), the temperature by latitude less the lapse rate with height (`tempByLatitude`), a potential
evaporation from that temperature and the latitude's sunlight (`climate/water.js zonalPET`: the climate's own
Priestley–Taylor law, its seasons from the temperature stage's land response — the water ledger, 2026-11-06) and Add detail's Budyko runoff and its own balance (`finish-basins.js closedBasins` / `lakeBalance`: the
catchment's runoff against what its water loses at each level). One that fills is drawn as a lake at its spill level
(the ground of its hollow above sea level drowned too), one that keeps a lake as that lake, at its level, in its own
grey-teal (`terrain-shade.js cutOffTint`, without the glint), and its dry ground at its true depth — a salt flat at
the bottom, playa above it, the hollow's bare walls (`dryTintOf`, coloured by height above the brine lake or dry floor
each cell drains to, shaded as land; until 2026-11-09 painted 2 m above sea level, a green lowland where a 6 km hole
was). **The water is conserved** (2026-11-09): the history pours its whole inventory into the ocean-connected ground
every frame and holds every hollow behind a sill empty (`tectonics/ocean/inventory.js pourOcean`), so water a cut-off sea
holds here is the world ocean's, and the ocean is drawn lower by it (`oceanFallKm`: median ~1 m, up to 77 m over three
seeds' histories; the Stats say how much). An equilibrium per frame, nothing carried between frames (a sea dries in
10³–10⁴ years, a frame is 10⁶–10⁷). `tools/check-waterbooks.mjs` closes the books over three histories (every 20 Myr; `--every 10`: every frame).
Against Add detail at 640K over three seeds × four moments (`tools/basin-agree.mjs`): the same sign — water standing or
not — on 345 of 386 seas (89 %; 99 % by area); where they differ the zonal estimate is wet and the finish's climate
(rain shadows, monsoons) dry. ~70–190 ms a frame at 160K in the shading worker with its hillshade (Node, loaded), only when a cut-off body is as large as the
finish balances (`basinMinKm2`). The readout and the Stats say it is an estimate. **The real-climate balance** (2026-11-10, `terrain/climate-water.js`): a cut-off sea of ≥ 1 Mkm² that the history does not pour is
re-balanced on the *computed* climate once the frame has settled (not while the history plays): the Climate tab's own water where
the moment has it (1°), else a 3° `planetClimate` in the climate worker, one frame at a time, off the page's thread (its rain, its
potential evaporation and its runoff assembled as the finish does). The hover says "balanced on the climate (N°)" or "estimated by
latitude — the climate is being worked out". Over four histories (every 20 Myr) 24 % of frames want it (58 of 244); the worker's
3° climate takes a median 1.5 s (Node, loaded), 0.51 s a frame on average over all frames (budget 0.5 s; 2° was 0.74 s, 4° 0.57 s).
The computed climate flips wet/dry on few seas at 2° (1 of 151) but the held water moves a lot. **Limit — physics/consistency:**
the view now holds water in big cut-off seas that the history pours back into the ocean, so on those frames the drawn ocean and
the history's sea level disagree (seed 831576 at 900 Myr: the fall goes 13 → 233 m at 2°; held water over the 58 frames: median
+14 m, p90 +150 m) until the evaporite lane's per-basin balance moves into the history. The held water of a big sea is also
grid-sensitive: 3° and 4° stray from 2° by a median 33 % a frame (9 of 58 within 10 %), so read the number as an estimate, the
ocean fall included. View-only: the history and the finish are unchanged. The same on the lab's Terrain layer
(Phase 8a, at its Sea level). **Add detail** (the code's *finish*) sculpts the moment shown again, with care, at a detail of its own (160K · 640K · 2.5M · 10M
cells; phones up to 640K; plans/V2_FINISH_PLAN.md): the surface domain-warped and roughened on high ground; the climate
calculated on it; the rivers carving longer with the climate's runoff (rain less evaporation: Budyko's curve, Fu's ω 2.6,
on the climate's own potential evaporation — the rain stage's Priestley–Taylor rate from the sunlight the ground keeps and
the air's temperature, month by month (`finish.js potentialMonths`), the same air its land evaporated into, so the land
gives back what the atmosphere's balance lost to it: 0.33–0.42 of its rain against the climate's 0.32–0.43 over 3 seeds ×
2 moments, where a temperature-only form gave 0.37–0.52 — it missed the summers of the cold continents; Earth ~0.35–0.40,
Trenberth et al. 2007; the lakes' evaporation, the rivers' seasons and the ice age's water from it too; the land cover
keeps the temperature's, its S-curves fitted with it); liquid only where a month thaws (the thaw gate, lane polar, 2026-11-05:
`finish.js thawedWater`): each place's year split by the climate's own months at its height — rain in the months above
0 °C, snow in the others, melted in the thawed months at 120 mm a month per °C (snow's degree-day factor, 4.1 mm d⁻¹ K⁻¹,
Braithwaite 2008; the climate's own rate, and the cover's and the rivers' seasons' since); snow the thawed months cannot
melt is kept, and where no month thaws none of the year's water runs. Until then the ice sheets' snow ran off as rain:
2.4–7.7 % of the land, never thawing, gave 10–18 % of its rivers' water and 0–156 000 km² of fresh lakes standing on the ice
(3 seeds × 2 moments, `tools/polar-study.mjs`). The kept snow leaves as an ice sheet in its round leaves it (`iceDischarge`;
Cuffey & Paterson 2010): down the bed's fall, over its pits' rims, to the first ground where all its own snow melts — there
it runs off as meltwater — or to the sea, calved (booked: `stats.snowStore`); a hollow where no month thaws fills with its
ice and spills, no lake and no sink (`finish-fsm.js`). The rivers then carry 0.34–0.40 of the land's rain, 0.36–0.42 with the
ice's calving (it was 0.35–0.41, the ice's snow as rain); the endorheic share and the lakes as before but those on the ice.
What it skips: the ice has no dynamics (it takes the bed's fall, not its surface's) and its margin melts all it brings in
one cell; a month's mean below freezing has no thawing days (positive degree-days from the monthly spread); no store
carried between years but the kept snow (the water ledger, below), and the ice's own mass budget (model review
U9) is to replace `iceDischarge`, dry basins left closed —
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
like the live terrain; a handful of moments are kept in detail per history — up to four on a desktop (and no more than
1 GB between them: 209 MB each at 2.5M, measured; two at 10M), one on a small device — so stepping back onto one shows it at once; the one viewed
longest ago is let go once a new one is done (never the one on screen, so a cancel loses nothing). See "The finish cache"
for the moments detailed before. A finished moment brings **its own
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
(`finish-fsm.js`, Fill-Spill-Merge, Barnes, Callaghan & Wickert 2021, on the ground the time-stepped erosion left): each
hollow's tree of sub-basins (`finish-basins.js` hollowLakes) fills from what reaches it, its catchment's runoff and what
full hollows upstream spill into it, against what its lake would lose to evaporation at each level (open water at 1.2 × the
land's potential evaporation, less the rain on it: the paper has no evaporation, so this is its departure from it); a sub-basin
full to its sill spills into the one beside it, two full ones merge, and a hollow whose water cannot fill it is closed, its
rivers ending at a salt lake (or a playa) at its own level. Nothing is cut and no size, origin or age decides whether water
stands. The map's thresholds (`lakeMinKm2` 300 km², two cells, `lakeMinDepthM` 15 m) decide only what is drawn: water under
them full to its sill is filled to that sill (a pond the map cannot show, its river's load), and a whole hollow smaller or shallower than
the map shows fills and spills (a pit of a cell fills with load in thousands of years; judged as sinks, the dry lands' pits
took the water of the hollows below them); a sub-map pit inside a bigger closed hollow is where its water ends, its floor
levelled, not drawn. Then the rivers: a priority flood over land and water from the sea and from where water ends, each
cell down the steepest fall per km, a flat (a lake, a filled pond) by Barnes, Lehman & Mulla 2014's two gradients, as the
erosion routes; discharge in m³/s from each place's runoff, a lake passing on what reached it less its open water's loss,
less what dry river beds lose; each river's year — its
monthly flows from each month's rain and snowmelt (and groundwater draining back slowly), routed down the rivers — and
its regime: permanent, permanent with a yearly flood season (the Nile's), seasonal, dry most of the year. Its limits: it has
no time and no load, so it says where water stands on this ground, never whether the ground should hold it (that is the
erosion's: without it, a study switch, the lakes are ~2.5× Earth's); a young lake filling with sediment is not judged. Until
2026-11-03 (lane fsm-wire) `finish-hydro.js` rewrote the ground so its rivers could cross it — graded fills, gorges, pockets
cut, the ice's lakes kept only if big for their river, two late rounds of fills — 2.6–3.2 % of the land's cells at 2.5M; FSM
moves 1.3–1.9 %, all of it filling to a level water stands at. **The world ocean and the seas cut off from it** (2026-10-27,
`terrain/world-ocean.js`, `finish-basins.js`): the sea is the water below sea level joined to the largest body of it — the
world ocean; a body below sea level that does not join it has its surface set by its water balance, not by sea level (the
Caspian at −28 m, the Dead Sea at −430 m; the Mediterranean drawn down 1.5–3 km when the Atlantic was cut off in the
Messinian). A sea behind a low, short barrier (sill ≲ 30 m, ≲ 160 km of dry land — a strait narrower than the cells) is
first opened into the ocean. Any other is a closed basin: its lake grown from its lowest point, as water rising in it
would — a pocket behind a ridge only once the water tops it — until what evaporates off it (open water: 1.2 × the land's
potential evaporation, Penman 1948, less the rain on it) outweighs what flows in (its catchment's runoff, less what dry
river beds lose). Water balance settles in thousands of years, at once on the timeline's scale: the finish solves its
equilibrium. Full to its rim, it spills, a fresh lake at its rim; short
of it, a salt lake at its own level — below sea level, or above it in a basin whose rim is higher still — or, where too
little flows in for a lake the map can show, a playa: a flat on its floor, the basin round it dry ground below sea level
(the Qattara at −133 m; the Messinian floors 2–3 km down). Its floor is the history's, filled by its rivers while it was
cut off (`tectonics/step/sea-fill.js`); it is no longer filled here as well (until 2026-10-27: toward ≤ 1 km below its rim,
a playa toward 120 m, and any body over 250 000 km² with water below 1 km counted as the ocean, full at sea level). The
rivers carve down its dry slopes to its water — their base level its level, not sea level (the carve's sea is the world
ocean) — and the fans spread on its dry floor. Checked against Earth (`check-basins.mjs`): the balance gives the
Caspian's 371 000 km² from the Volga's inflow within ×1.5, the Dead Sea's ~1000 km² before its river was drawn off, and
the Messinian's drawdown in ~1 000 years; reported over three histories against Earth's closed seas. Drawn on the Terrain view as a flow map (hairlines, stronger for bigger
rivers, seasonal ones dashed; a River Density choice; a Rivers & Lakes toggle; Colour by Regime with a legend; the readout
names a river's discharge, regime and flood months, and a lake's kind). Measured when this stage was new (20K plates,
desktop): 640K ~8 s, 2.5M ~15 s, 10M ~53 s. The whole Add detail now (erosion, ice, wind, coast, water and climate since;
Chrome on an M1 Pro, erosion on WebGPU, 2026-11-02): 2.5M 74 s on a quiet machine (~190 s under load), 10M 259 s the
first time (mesh ~26 s of it, kept after), peak memory 13.6 GB at 10M — the Detail menu's "~4 min".
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
node v2/tools/check-waterbooks.mjs     # the water conserved: the history's pour holds it all, the view debits the ocean for its cut-off seas (every 20 Myr; --every 10 for every frame)
node v2/tools/trace-forces.mjs india mobility=3.5     # speeds / force-balance targets / situations over time
node v2/tools/trace-collisions.mjs wilson 160          # collision records, events, belt statistics
node v2/tools/render-frames.mjs tug plates            # PNG frames of a scene → v2/out/
node --max-old-space-size=16000 v2/tools/render-moment.mjs --seed 799224 [--cont 41] --time 290 [--cells 2500000] [--crop lon0,lon1,lat0,lat1] [--probe lat,lon;…] [--lakes] [--rivers [q0]] [--set key=value,…] [--debug] [--live [--plain]]
                                       # a detailed moment (Add detail) headlessly, painted as the page paints it → v2/out/moments/; its lakes, its cut-off seas, any empty basins, its coast's shape
                                       # (--live: the timeline's frame before any detail, at --cells, its cut-off seas tinted; --plain: as before they were)
node v2/tools/coast-shape.mjs --seed 626225 [--cont 41] --time 950 [--cells 1000000] [--bands] [--finish]
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
node v2/tools/finish-latest.mjs [--png]       # the finish cache: the finished moment the user is looking at, loaded in seconds (see "The finish cache")
node v2/tools/check-finish-cache.mjs          # the finish cache: bit for bit, the key, damaged files, the page's upload path
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
  land-mask        the land and the sea on the sim grid, and the sea's level: one mask the records, the history's rivers
                   and (through world-ocean on the drawn surface) the finish all read (standing goal #8)
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
  volcanoes        cones: hotspot islands / seamounts, island-arc chains, Andean stratovolcanoes, rift volcanoes; calderas
  lips             flood basalts on land: each province's pieces (centre, radius, age) and its radiating dyke swarm
  near-lists       which point features can reach a sim cell's terrain points
  synthesize       synthesizeTerrain(frame, simMesh, terrainMesh) → heightKm (+ components) = preparePlan (per frame)
                   + surfaceRange (any range of cells); hypsometry()
  world-ocean      the world ocean (the water below sea level joined to the largest body of it) and the seas cut off
                   from it — the finish's sea, and the timeline's cut-off tint
  basin-estimate   the timeline's cut-off seas balanced on the zonal climate (Add detail's own balance): lake or dry
                   hollow, the world ocean debited for the water they hold (shadeWithWater: with the frame's hillshade)
  climate-water    a frame's computed climate (planetClimate) as each cell's rain / PET / runoff, for a big cut-off sea's balance (the climate worker's 'water', 3°)
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
                   finish-lithology (rock and k_rock, before the carve), finish-ice (the last ice age), finish-floods (its ice-dammed lakes' outburst floods), finish-coast (waves, cliffs, longshore drift), finish-wind (sand seas, dunes, pans, loess), finish-hydro (rivers, their
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
   own frame (`riftCurve*`, `riftJag*`) that bends a rift and makes it jagged, instead of a straight cut. Each piece of continent keeps its own clock (`riftMinGapMyr` 30, the chance back by `riftSpacingMyr`, growing past `riftDueMyr`); nothing forces a rift and the world is not held to one at a time (upstream's `riftMaxGapMyr` 150 and `riftGlobalGapMyr` 10 were retired 2026-11-09: rifts are local, Earth has several under way at once, and riftaudit §2.2 found the supercontinent cycle intact on 3/3 seeds without them). The cycle's pace is the mantle's — no period is drawn: its pieces
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
   `cratonStrainShare` of its relief, each km of the shield costing as many km of the belt's reach as the craton's column is stronger (`cratonStrengthRatio`, ~3.5), and the
   shield thickening by only that much less: cratons are strong, not rigid. So orogenies accumulate, and an
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
scraps of craton inside a range read as the range (Phase 10 judges the scraps the land encloses; one at the sea's edge is a coast); and each craton has a character — a shallow sag basin, a broad swell
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
shelf break. An active margin with the history's trench in reach is derived (round 2, 2026-10-28; bounded to its own margin by its taper since lane coasts, below).
Its forearc, the wedge on the overriding plate's crust, slopes at one surface slope from the shelf break down to the
trench's axis. That slope is the wedge's critical taper (Davis, Suppe & Dahlen 1983; forearcs slope ~1–8°, Lallemand et
al. 1994). There is no abyssal floor between, so the crust's edge, the COB, lies at the trench. Seed 626225 at 300 Myr,
640K cells, mean depth 25–50 / 50–75 / 100–125 km off such coasts: −4.18 / −4.92 / −5.08 km before, −3.83 / −4.26 /
−4.55 km now. Many coasts the history calls active have no trench within reach, and they keep the profile. What tectonics treats as continental crust is unchanged (the history uses its land for
erosion, rivers, the sea's fill and the ledger), and the Evolution timeline already draws heights against the sea
(terrain-player, world-ocean.js), so flooded continental crust shows there as shallow sea; the lab's crust palettes
stay crust maps. Phase 13 reports the continental crust under the sea by stage of the cycle, the shelves' width by kind
of margin and the break's depth (`tools/lib/shelf-stats.mjs`). The sim's coasts are mostly active, and its continental
crust's area was set to Earth's land area (tectonics' `continentalFraction` 0.29), so its submerged share stayed small (~5–15 %
against Earth's ~20–30 % today). Since cont41 (2026-11-10) the default is Earth's crust share, 0.41 (below, "The world the
targets describe"). Crust whose platform lies below the shelf break — a submerged arc ridge, a drowned plateau — has no shelf graded up to
the sea at its edge (wave base never planed it): its edge falls from its own depth, with no rim of islets at sea level
around it or its holes (Kyushu–Palau, West Mariana and Lau ridges, Karig 1972; before, every hole in a submerged arc
field drew as a ring of islands).

**The mantle's swell and the sea level** (2026-10-27, `terrain/sea-level.js`). A continent is a lid: the mantle under
it warms (the history's `mantleHeat`, `mantleInsulateMyr`), and warm mantle lifts the surface over it — dynamic
topography (Gurnis 1988; Lenardic et al. 2005; Coltice et al. 2007; the African superswell, Pangaea's legacy, ~0.5 km
above the other shields, Nyblade & Robinson 1994). The swell is absolute, under the sea floor as under the land
(`mantleSwellKm` 1 km from fully cooled to fully insulated mantle, the heat smoothed over `mantleSwellSmoothKm` 400 km),
and the sea answers it. Reckoned (`sea-level.js seaLevel`; no water volume is kept, and `waterInventory: 0` selects it), the sea's level is the swell's mean under the sea floor; by default the level is instead where Earth's water stands when poured onto the ground ("The water inventory" below; `land-mask.js:103`).
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

**The water inventory** (2026-11-06, lane sliders; `tectonics/ocean/inventory.js`, `terrain/land-mask.js`). Jackson: "pour
an earth-like amount of water onto the planet and let it settle to determine where oceans are." The sea's level is where
a fixed volume of water stands — `waterInventory` × Earth's ocean (1.332e9 km³, Charette & Smith 2010) poured onto every
sim cell's ground (`surfaceKm`: the land as the rivers stand it, the floor by its depth–age law, both on the mantle's swell)
from the lowest cell and spilling outward (one priority flood and a running sum, `pourOcean`, ~10 ms at 40K) — not the
reckoning above, which calibrated the floor's mean depth so that a dispersed world's sea stood at 0. The pour is in the one
land mask, so the history's rivers and the terrain's records share it. It is on by default at Earth's 1.0× (Jackson,
2026-11-06); `waterInventory: 0` still gives the reckoned level. Only the level changes: which cells may be sea
(the crust's kind, filled seas, small pockets, lifted fills) is still the mask's rules, and the flood drowns at the poured
level. Its proof is Earth's own ground: `tools/check-ocean-earth.mjs` pours 1.0× onto ETOPO5 binned on the 40K and 160K
meshes (a committed derived artifact, `tools/data/earth-surface-*.i16`, `tools/make-earth-surface.mjs`) and the sea stands
at −11 / −13 m over 29.9 / 30.1 % land (Earth 0 m, 29.2 %). The lab's scenes of one mechanism (andes, laramide, india, mariana, japan, hawaii, traps, rift, cratons:
`terrain-scenes.js` fixtureOcean) keep the reckoned level: their ocean is a built fixture, not a history — the rift scene's
is 95 % of the cells, 97 % of it over 100 Myr old, and Earth's water on it stood 2.95 km under the datum, its new ridges
drawn dry — so only the whole planets pour. Phase 8a judges the floor's depth by age against the datum (Earth's water on
Earth's ground), and reports the depths under a seed's own sea and how much more its basins hold than Earth's ocean fills
(12345 at 600 Myr: +19.5 %, the sea 0.72 km under the datum; sliders4, 2026-11-07). On the model's own worlds the land, the level and the flooding
are outcomes (`tools/ocean-history.mjs`, by stage of the cycle; lane report 2026-11-06): with Earth's crust (41 %) and
water the land is 35–39 % (Earth 18–33 by stage), the continents little flooded, and the level swings 0.7–1.1 km over a
cycle (Earth 0.2–0.3): the history's floor stands ~0.4–0.6 km deeper than Earth's (its ages, little abyssal sediment, few
plateaus: `tools/ocean-floor.mjs`). The rivers' rise is drawn (2026-11-06): the rock they laid past an open margin's shelf
(`riseKm3`, a frame field) shallows the floor it lies on, Airy-loaded, in the records' depth and the pour's ground — on the
same frames it lifts the poured sea 165–182 m on average (183–241 m at 900–1200 Myr) and takes 0.4–0.9 points of land and its drowned margins are a fraction of Earth's shelves — the missing physics, not
the water. Limits: one water body at equilibrium; no water held on land (ice sheets, ~2 % of the ocean, are not taken
out yet); the ground is the history's per-cell column, not the finish's shelves.

**The pour starts in the ocean** (2026-11-10, lane pourstart; `pourOcean`, `land-mask.js pinnedHumid`; flag `pourFromOcean`, on). The pour above began in the lowest cell, assuming the ocean is where the deepest floor is; when a cut-off basin held that floor, it filled first and a water-poor pour stopped at the basin's sill with the ocean's share unspent (831576 at 360 Myr: +270 m, against −166 m poured from the ocean's side). Now, when the sweep pins at the start body's sill and the far side (the cells tied at that spill, below it) has more cells than the near side, it re-floods from the far side's lowest cell (up to 4 times), so the first body is the larger one, the world ocean. At a pinned sill the basin's climate decides who takes the shortfall (Jackson, 2026-11-10): `pinnedHumid` balances the basin on the zonal P − E the history already erodes by (`closedBasins` with the sea at the sill); a humid basin is brim-full and the ocean stands below the sill by the shortfall, an arid one keeps today's answer (the ocean at the sill, the basin's share stood from its bottom, `standFromBottom`). `landMask(frame, mesh, cfg, out, climate)` takes the computed climate when cutoff's real-climate balance lands. The pour also returns `topKm`, each wet cell's own surface, which the view's `standPoured` reads. No water is carried between frames: every body re-equilibrates in 10²–10⁴ yr against a 10-Myr frame (waterflow report), so memory belongs in rock (evaporites, sill incision: later lanes). Measured: on the same frozen ground only 831576 at 360 Myr moves (−436 m) of 484 frames in four histories; all 7 pinned frames are arid (the waterflow probe's "humid" 1070 was a 0.04 Mkm² pond read as the basin). On rebuilt histories, the level moves on 85 of 121 frames of 831576 (its tail diverges after 360), 15 of 626225 (≤ 1.2 m), 0 of 777, 40 of 12345 (≤ 4.7 m). Cost: the whole history 62 s against 63 s; the pour +0.4 ms at 40K, +2.2 ms at 160K, +61 ms at 2.5M, the humid judge ~40 ms per pinned call. `tools/check-pour.mjs` (suite `pour`) holds it. Limits: after a humid drawdown the ocean re-sweep can pin again at an inner sill and then settles arid (not seen); the mask is still crust-based (the pour sets only the level).

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
In `carve.js`: rias from the lowstands — the carve's base level is the glacial cycle's time-weighted mean sea, `carveSeaDropKm`
0.053 km below today's: the mean of Spratt & Lisiecki 2016's sea-level stack over the carve's 0.75 Myr (−53 m; the window hardly
matters), not its −120 m floor (`iceSeaDropKm`, the LGM's, which the finish's ice age keeps), since a lowstand lasts ~10–20 kyr of
each ~100 kyr cycle and the rivers grade to where the sea stood most of the time (held at the floor, the carve ran one-cell
drowned threads up whole networks, coastflood5). The history's own fall within the carve window (`tools/sea-window.mjs`) is
about 1 m median and 15 m at worst, so the ice term alone sets it. The shelf it bares is carved as land and
its rivers cut valleys down to it; today's sea then floods in once from the world ocean (`floodSea`), through every cell below 0
it reaches: the valleys it reaches are rias, the spurs between them headlands, and a hollow it does not reach stays as cut
(counted as `stats.lowstand.hollowKm2`). The finish's early erosion grades to the same level and floods once more at today's
sea; then the rivers fill the drowned valleys from their heads (`bayheadFill`, finish-erode.js): each river's load from the
erosion's last step, over `bayheadFillKyr` (8 kyr: the transgression and highstand, Stanley & Warne 1994), laid nearest its
mouth first up to today's sea, the lakes' own `deltaLayer`. A valley with a big load fills to a delta plain; one with little
stays an open ria, funnel-shaped, its mouth the last to fill (Dalrymple et al. 1992; Boyd et al. 1992). It skips: the
Holocene's own load (it uses the lowstand's), the tide carrying mud out of a valley, waves, and the overflow a full valley
would build onto the open shelf (counted, `stats.lowstand.bayhead.spiltKm3`). The sea is flooded once more after it.
Fjords are the ice's (finish-ice.js). Nothing draws a ria: no `drownValleys`, no coast-band warp, no `ria*` or `drown*` keys. Also
submarine canyons from big
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
over its 12 junctions is handed out in runs and its answers come back in the junctions' order.
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
  takes none — its roughness is what its rivers' lowstand valleys, drowned by today's sea (rias, carve.js), the ice's fjords (finish-ice.js) and the
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
- **A weak zone's strength** was `founderStrength` 0.08 slab pulls per 100 km (0.4 now, on the 6 × 10¹² N/m unit: `config.js:447`, "Plate stress and the rift stage" below): the 2–3 × 10¹² N/m a plate's resistance to
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

## A closing contact earns its slab (2026-10-31, branch trench)

Every closing contact used to become a trench within a step or two of real consumption. Closing is not subducting: a contact
is now `BoundaryKind.CONVERGING` (it pulls nothing, builds no belt or arc, and resists closing) until the founder law
(`founderUrge`) has held for `trenchEstablishKm` (100 km) of convergence: a fracture zone turns self-sustaining after ~100 km,
and cumulative convergence, not its rate, sets the balance (Hall et al. 2003; Gurnis, Hall & Lavier 2004). So one law decides
a trench's birth, at a passive margin or a contact (`establishes`, step/subduction-init.js). `founderSqueezeCmYr` was derived
as 3.4 cm/yr (17 now with `founderStrength` 0.4: `config.js:432`), the rate at which a contact's shared resistance reaches `founderStrength` (was 6, by hand).
Trenches die two ways: floor younger than `trenchDetachAgeMyr` (5 Myr) reaching one detaches the slab (Burkett & Billen 2009,
2010), and a slab no plate feeds fades over `founderSlabMyr` (a choice of scale, not a measured rate). An edge at rest keeps
its slab, so a world at rest can start itself; an oblique edge that still closes keeps its slab too, and land keeps its slab
record, which collisions read. Force and Wilson scenes keep the trenches they are given. Off-switch:
`MECHANISMS.trenchEstablish`. `tools/trace-trench.mjs` sorts a history's trenches by how each was established.
**Limits.** The force on a contact is read from its closing rate, not solved for. Rigid plates must still lose the overlap at
a contact that has not failed, so a CONVERGING contact consumes crust with no slab, where Earth's would stop or spread into a
diffuse belt. **This is an interim law:** plates that emerge from a stress solve (the closed-loop study) may replace it.

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

## A collision ends when its belt holds the pair (2026-11-09, lane weld)

- **What was wrong.** Traced step by step over the whole model (`tools/weld-trace.mjs`, 3 seeds × 3 paths), the big
  collisions did not stop: their closing fell to ~0.9 cm/yr 40–60 Myr after contact, then **crept at 0.5–0.8 cm/yr**, just
  above the stall rate, for 50–150 Myr more, and welded ~25 Myr after that (the stall clock, then the gap test waiting for
  its give-up). Contact → weld: median 124 Myr; the biggest weld of each history 112–269 Myr. Earth's ended collisions ran
  ~60–70 Myr from contact to the end of convergence (Alleghanian ~325→265 Ma, Hatcher 2002; Uralian ~320→250 Ma, Puchkov
  2009). The balance terms along the seam (`--forces`) show why: the viscous lock (`collisionResistance`) carries the
  push of the plates' other margins (ridge, rift, mantle flow, slab), and a coupling × rate can only damp a push, never stop it.
- **The physics added** (`sutureHoldGpe`; `torque-balance.js seamHold`, `forces.js` dhBelt, `collision.js`). A thin
  viscous sheet converges while the force on its edge beats the buoyancy of the crust it has thickened, and stops when it
  does not (England & McKenzie 1982; England & Houseman 1989). Each step the pair's push across the front — the force the
  lock now carries — is set against the plateau's GPE over the front (`collisionGpeNPerM`, ~5.7 × 10¹² N/m at Tibet's).
  Held through one seam check (`sutureCheckMyr`), the pair welds; the sea left between is a remnant (no give-up wait).
  The plateau counts, not the two crusts stacked in the overlap: that is the lower plate's edge going under, and
  counted, it held pairs from contact (welds 14–33 Myr in). India slowed as Tibet rose (Molnar & Stock 2009).
- **Numbers** (welds ≥ 1000 km, 3 seeds × 3 paths; Earth: km in the first 50 Myr ~2000–2500, total 2400–3200):
  | | km50 median | contact → weld, median (biggest weld per history) | total km median (biggest) |
  |---|---|---|---|
  | stall rule only | 1175 | 124 Myr (112–269) | 1787 (1884–4086) |
  | sutureHoldGpe | 1220 | 55 Myr (35–116) | 1298 (1401–3529) |
  | + mantleFlowDrag + collisionConveyor | 1470 | 52 Myr (51–159) | 1509 (1663–4207) |
  | GPE lock instead (collisionLockGpe) | 1053 | 81 Myr | 1247 (1113–2374) |
  km50 is now read by record identity (`belts-history.mjs`, `weld-trace.mjs`): a weld hands its open collisions on
  (inheritCollisions renames them) and a handed piece takes a copy (`ops/hand-collisions.js`), so a record keyed by its
  plates first appeared long after contact with all its km in it ("2933 of 2939 km in 50 Myr" on 4242 was 1479).
- **Off by default** (Jackson, 2026-11-10). In the India scene the hold welds India 26–38 Myr after contact and Asia's
  crust thickens less than check 7c asks, with or without mantleFlowDrag + collisionConveyor: the scene's push after
  contact is too weak to hold up a plateau (Earth's India still converges at ~4 cm/yr). Lane slab (2026-11-10) looked
  for the missing force and found the force is there but the rate is not: across the whole model the lower plate's slab
  pull does not drop at contact (median 8.8 × 10¹⁸ N before, 8.8 at contact, 7.3 at 8–20 Myr after), and the lock
  carries 2.7–6.1 × 10¹² N/m across the front, Tibet's 5–6 × 10¹² (Copley et al. 2010), at 1.2–1.6 cm/yr after 50 Myr
  against India's ~4. The viscous lock's rate per unit force is 3–6× too low, because its coupling grows with the
  overlap and the cratons (×4). The hanging slab (below) is modelled and does not change that; the hold waits on the
  lock's force–rate law.
- **Limits.** The push is the lock's force at the step's rotations, not a solve with the lock removed; the plateau's GPE
  alone (no lithospheric strength). The first 50 Myr are still slower than India's (~5 cm/yr): the drive after contact.

## Collisions run on until the seam stalls (2026-10-27, branch welds, round 2)

- **No set time or shortening ends a collision** (`collision.js`, `config.js`). Two colliding plates weld once the
  seam between them has been closing slower than `sutureStallCmYr` (0.4 cm/yr) for `sutureStallMyr` (12 Myr), with at
  least `sutureStallMinKm` (200 km) taken up. The 200 km counts either the shortening this pair absorbed or the overlap's
  depth (area over front), whichever is more: land stacked by a third plate or handed on at a weld counts too. Removed:
  welds after 600 km of shortening (`sutureShorteningKm`), after 40 Myr of contact (`sutureContactMyr`), at 0.4 Mkm² of
  overlap (`sutureOverlapKm2`), and the `overdue` weld after 120 Myr locked (`sutureLockMaxMyr`). Those were hand-set
  lock times. After the cores meet, the torque balance alone sets how fast the pair slows: the forces driving the two
  against the collision's viscous resistance. India has run 2400–3200 km into Asia since ~50 Ma and still converges
  (Molnar & Stock 2009; van Hinsbergen et al. 2012). Kept: the stack weld (`sutureStackKm`, 500 km deep), the stall
  give-up (`sutureStallGiveUpMyr`) and the gap stall (`sutureGapStallMyr`). The stack weld overrides the stall: land stacked that deep welds at once, stalled or not, converging or not (`collision.js:208`, `wouldWeld = (ready && closed && !sealing) || stacked`).
- **India** (Phase 5): contact at 50 Myr. Closing slows from 8.7 to ~2 cm/yr within ~12 Myr, then falls below the
  stall rate. The weld comes ~60 Myr after contact, after 1,050 km of shortening (main welded it at the 600 km lock). The upper plate's indentation at the weld is 946 / 736 / 631 km in Phase 5's scenes, inside Earth's 600–1,100 km (was 736 / 420 / 736). The
  area swept across the front matches the overlap the weld absorbs (1.46 against 1.22 Mkm²). Shortening stays short
  of Earth's 2,400–3,200 km because Phase 5's scenes leave the underthrust off (`onlyMechanisms`): the overlap stacks,
  and the stack's resistance stops the pair. A weaker `collisionResistance` (25 or 50 instead of 100) makes it weld
  stacked at ~1,200 km, so the lock's strength is not what limits it. With the underthrust on (Phase 7c's India), the
  crust reaches the 40 km thickening cap.
- **The collision lock is a bounded force (lane belts, `collisionLockGpe`, opt-in, off by default).** A contact resists with the
  gravitational potential energy of the thickened crust, ½ρc g(1−ρc/ρa)[(H+Δh)²−H²] per metre of front (5.7 × 10¹² N/m at
  Tibet's 35 km of extra crust; Copley et al. 2010). Δh is the larger of the thickest crust within two rings of the contact
  and the column in the overlap itself, where the two crusts are stacked one on the other (Argand 1924; Zhao et al. 2010),
  so the lock holds from first contact, before any belt is built, and in histories without the event rules
  (`forces.js frontThickening`). It enters the torque balance as that force ÷ the closing rate, no slower than the stall
  rate: a regularised friction, not `collisionResistance`'s viscosity per km² of overlap (which applies only with the flag off).
  **Why it stays off** (lane belts5, 2026-11-09). On, it passes Phase 5a's India and Phase 11's zipper, but not Phase 4's
  forces-only "collision slows the plate" (4.70 → 3.93 cm/yr) and "slows sharply on contact" (6.9 → 6.1). A force capped at the
  plateau's cannot stop a plate whose drive goes on; India's 20 → 6 cm/yr was its drive collapsing. Phase 7c's underthrust A/B
  also fails, because under a force the underthrust's thickening slows the pair. And the whole model's collisions come out short.
  The biggest weld per history by convergence after contact (`belts-history.mjs`, seeds 12345/777/4242, Chroma), against
  Earth's 2400–3200 km for India–Asia:

  | | km | Myr contact → weld | mean closing, cm/yr |
  |---|---|---|---|
  | off (`collisionResistance`) | 3025 / 3613 / 2939 | 233 / 145 / 156 | 1.3 / 2.5 / 1.9 |
  | lock | 2374 / 1461 / 1943 | 151 / 141 / 99 | 1.6 / 1.0 / 2.0 |
  | lock + `collisionSlabPull` | 1760 / 2502 / 1682 | 77 / 165 / 97 | 2.3 / 1.5 / 1.7 |

  India closed its 2400–3200 km in ~50 Myr (~5 cm/yr). The model's collisions reach Earth's distance (off) only by lasting
  3–4× too long at a third of the rate. What is missing is the drive after contact, not the lock: across the front Asia moves
  into India the whole time (mantle flow and its own suction), the lock resists Asia, and India's slab pull collapses 5–15 Myr
  after contact (lane upper, `belts-probe.mjs --forces`). Tried and dropped: the lower plate's crust going down as negative
  slab pull (Cloos 1993; it double-counted the slab the front already drops), upper-plate shortening behind a jammed craton.
  Phase 5's India (`NO_WINGS`, underthrust off) measures the stack weld, not the seam, and is not the acceptance scene.
- **The hanging slab (`collisionSlabPull`, opt-in, off by default; lane upper, rebuilt in lane slab 2026-11-10).** After
  contact the slab still hanging under the front keeps pulling the lower plate in (`forces.js hangingSlabPull`): its gross
  negative buoyancy (`collisionSlabGrossNPerM`, 3 × 10¹³ N/m; England & Wortel 1980), scaled like a trench's pull by the
  slab's age and length read at contact (the lower plate's ocean and the upper plate's trench within three rings of the
  front), net of the buoyancy of the continental crust underthrust after it (Cloos 1993), until the slab breaks off.
  - *The crust's buoyancy* counts only above the eclogite depth (`collisionEclogiteKm` 60: Holsnøy's lower-crust
    eclogites formed at ≥ 1.46 GPa, Austrheim 1991; eclogite ~6 % denser than the mantle, Hacker et al. 2003), down a slab
    of `collisionSlabDipDeg` 30 (32 ± 9° over 0–125 km, Lallemand et al. 2005): at most 120 km of crust offsets the slab.
    Before, every metre underthrust counted, and any collision's crust cancelled any slab within ~175 km, a few Myr in.
  - *Break-off* is the slab's own, not a cited time (was `collisionBreakoffMyr` 20). Stalled, the slab is warmed through
    from both faces; when its strong core (colder than `slabCoreTempShare` 0.6 of the mantle's 1350 °C, ~800 °C: Goetze &
    Evans 1979, Kirby 1987) is gone it necks and breaks (Davies & von Blanckenburg 1995; Duretz, Gerya & May 2011). The
    core of a plate of age A is 2√(κA) erf⁻¹(θ) thick; its first conductive mode warms through in A × 4 erf⁻¹(θ)² ⁄ π² ×
    ln(4(1 − θ⁄2) ⁄ π(1 − θ)), so κ cancels and t_b ≈ 0.115 A: 9 Myr for an 80-Myr slab, 16 for the India scene's ~140.
  - **Against Earth** (not fitted): van Hunen & Allen (2011) find break-off 20–25 Myr after contact for old slabs, ~10 for
    young. This break-off is earlier by about half, because it is the warming alone: the neck's own runaway is not drawn.
    θ maps almost one-for-one onto t_b (0.75 gives ~25 Myr), so it is taken from olivine's strength, not from their result.
  - **India scene** (`budget-scenes india`, 12345/777/4242, slab off → on):

    | | weld, Myr after contact | km at weld | km at 20 Myr |
    |---|---|---|---|
    | sutureHoldGpe on | 38 / 32 / 26 → 32 / 32 / 36 | 1115 / 1055 / 989 → 1099 / 1104 / 1135 | 947 / 928 / 936 → 1000 / 987 / 995 |
    | sutureHoldGpe off | 96 / 108 / 68 → 52 / 94 / 72 | 1371 / 1564 / 1093 → 1167 / 1425 / 1209 | the same |

    +50–60 km by 20 Myr; with the hold on India still welds ~30 Myr in, short of 7c. With the hold off it welds *sooner* on
    two seeds: the earlier push builds the overlap faster, and the lock stiffens with it.
  - **Whole model** (`weld-trace.mjs --forces --pull`, 3 seeds × 3 paths, Chroma; biggest weld per history, top-3 welds
    for the medians; Earth: km50 2000–2500, total 2400–3200, contact → weld ~60–70 Myr, ~4 cm/yr at 50 Myr):

    | | biggest: km50 median | total km median, in 2400–3200 (> 4000) | top 3: contact → weld | cm/yr at 20 / 50 Myr |
    |---|---|---|---|---|
    | hold off, slab off | 1335 | 2933, 4/9 (1) | 133 Myr | 2.4 / 1.1 |
    | hold off, slab on | 1824 | 2705, 5/9 (0) | 150 Myr | 1.9 / 1.2 |
    | hold on, slab off | 1459 | 1846, 2/9 (0) | 63 Myr | 2.7 / 1.6 |
    | hold on, slab on | 1720 | 1920, 1/9 (0) | 64 Myr | 3.0 / 1.6 |

    The slab adds to the first 50 Myr of the biggest collisions, and with the hold on keeps the weld time Earth's.
    It does not raise the closing at 50 Myr or the totals: the force across the front is already Earth's, and its
    rate is the viscous lock's (the "Off by default" note above).
  - **Limits.** One slab per collision, its age and length read once, when first seen; break-off counted from first contact,
    not from when the slab stalled; the neck's runaway not drawn (above); the cap at the equilibrium eclogite depth, while
    India's lower crust eclogitised late, where it reached its deepest, held back by the reaction's kinetics (Hetényi et
    al. 2007), so the cap leaves the most net pull it can; the detached slab's flow and the plate's other trenches beyond
    the front are the ordinary slab pull's (they carry on: the pull does not drop at contact, above).
  - *Off by default.* It stays off until the lock's force–rate law is settled: on its own it moves no acceptance target
    into Earth's range. Mantle flow drag + the conveyor (drive branch, held) slowed India on 2 of 3 seeds for a
    structural reason: the conveyor fades linearly to zero at 44 Myr (660 km ⁄ 1.5 cm/yr), front-loading its km, and
    it consumes India's flank ocean and Asia's trench sooner, so nothing is left pulling at 50 Myr. Don't retry it as is.
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
  Since 2026-11-05 (lane defects) it counts what a plate takes from the passive background at half. On Earth a ridge's far
  flank keeps half the new floor, but this model's background never accretes, so a slab-pulled plate takes the whole gap
  behind it. This is a simplification until the background accretes (the ocean-lifecycle lane). The founder scene's margin is
  an exact age tie, now drawn per history (`chooseFoundering`), and Westland sinking had grown it 52 % against 33 %.
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
node v2/tools/history.mjs hash f.bin g.bin               # frames' VALUE hashes — compare these (frame prints one too), never shasum:
                                                        # V8 writes one number as int32 or double by engine timing, so one history's
                                                        # file bytes differ run to run (lib/frame-hash.mjs; check-determinism.mjs)
sim-slots run -n 6 --gb 16 -- node --max-old-space-size=16000 v2/tools/render-moment.mjs --latest   # …rendered
node v2/tools/history.mjs ls                             # every entry; frame --key <key> --time T for any of them
```

## The finish cache (2026-11-04, branch fincache)

The history cache's twin, for "Add detail": every finished moment is kept on disk, machine-wide, so **any session can load
exactly the finished moment the user is looking at** — `node v2/tools/finish-latest.mjs`, or `loadLatestFinish({ mesh: true })`
from `v2/tools/lib/finish-cache.mjs` (the picture, per-cell z/ocean/lake/lakeLevel/glaciated on the finish's mesh, rivers,
the moment's climate, stats) — instead of finishing it again headlessly (which on Node would not even be the same picture:
the page erodes on the GPU, with Chromium's maths).

- **Store:** `~/.cache/geo-sim/finishes/<key>/` (`GEO_SIM_FINISH_CACHE_DIR`; `GEO_SIM_FINISH_CACHE=0` off): `page.bin` (what
  the page shows), `cells.bin`, `meta.json` (the spec, who made it, `state` uploading → complete). Files are sealed as
  history frames are (SHA-256 checked on every read; a damaged one is deleted and the moment finished again), written
  atomically; a Node finish holds `build.lock` and others wait for it. Cap `GEO_SIM_FINISH_CACHE_GB` (default 8): least
  recently used go first. One entry weighs 56 MB at 2.5M cells (the page's 4096-px picture: page 50 MB, cells 9 MB; measured 2026-11-04) and an estimated ~220 MB at 10M (8192 px: four times the cells and the pixels; not measured).
- **Key** (`app/finish-key.js`): the moment's history key and time, the finish code's hash (`finish-worker.js` and all it
  imports, `app/finish-code.js` as the dev server serves it), the detail, the picture's width, Greenhouse and
  Precipitation, People on/off, and the engine — page or Node, its maths, GPU or CPU erosion. Page and Node finishes file
  apart; a Node tool may *read* the page's (that is the point). View settings (river density, palette) are not in it.
- **Page:** the finish worker looks the moment up before finishing (a hit is back in seconds, "Detail brought back from
  the finish cache") and after a finish compresses and uploads it in the background (`/api/finish/*`). The view it posts
  to `latest.json` names the finished moment on screen (`finish`, `finishSpec`). The link gains `&detail=<Myr>&dcells=…`:
  a reload brings that moment back from the cache as soon as the history reaches it (never finished again unasked).
  **Stepping between detailed moments (2026-11-10, branch multimoment):** the page asks the worker once for its part of the
  key (`keyBase`: the code, the maths, the erosion engine), keys every moment of the history itself and asks the dev
  server which are whole (`POST /api/finish/has`, every few seconds at most while the history grows or the settings
  change). Those are marked faint on the timeline (the moments kept in memory solid); when the timeline settles (300 ms
  paused) on one, it is loaded with `cachedOnly` — never finished unasked. The link's `&detail=` names the detailed
  moment on screen, else the one viewed last.
- **Node:** `render-moment.mjs` goes through the cache (not with `--debug`, `--network`, `--overlay`, `--set`; `--no-cache`),
  and with `--latest` uses the page's own finish when the moment shown is detailed.

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
  `terrain/land-mask.js landMask` on the world's own view of the crust — the very decision `records.js deriveRecords`
  makes for a frame (until 2026-11-06 it asked `sea-level.js landAndSea`, which took every continent and arc as land
  however low: see "One land mask" below). The rivers route over heights against the sea with the swell in (it
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
  parent's speed (`steerBackArcStrips`). A strip's steered rotation, its parent's plus the rollback, is held to the same
  caps as the force balance's: with a keel, parent and rollback together had reached 10.2 cm/yr.
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
- **A filled sea closed in is a hollow too.** An enclosed sea fills to the sea's level (`step/sea-fill.js`). Where
  the land around it later rose and closed it in, the terrain drew it as a hollow: 4.4 Mkm² and 1.1 km deep on 626225
  at 600 Myr. It now traps like any other hollow. Rivers may cut into basin fill once its outlet lies lower, and fill
  on a shield wears at the soft cover's rate, not the crystalline basement's.
- **Tools.** `tools/trace-basins.mjs` reports the history's hollows through time and the finish's lakes, including
  how much of each lake lies over a history hollow and the crust under it. `tools/lib/land-water.mjs` holds the shared
  measurement. `check-basins` has a new section: trap efficiency against measured reservoirs, plus reports on the
  land's lakes, the largest and deepest, the land below its spill, the land's mean height and the fill held.

**Results** (40K, cont 30; rivers2 on main → basins, lakes on land as a share of land):
- 831576 (Jackson's seed): 9.5 → 5.6 % at 310 Myr (640K cells) and 7.5 → 2.2 % at 600.
- 626225: 9.4 → 4.3 % at 300 Myr, 4.0 → 3.8 % at 600 and 7.3 → 2.9 % at 950. The largest lake there fell from
  1.9 Mkm² to 0.85–0.90 Mkm², and the deepest from 4–5 km to 0.9–1.7 km.
- 12345: 13.4 → 3.0 % at 300 Myr, 14.9 → 3.7 % at 600 and 4.5 → 2.4 % at 950.
- `check-basins` (626225, 777, 12345; mean of 300, 600 and 950 Myr): lakes on land 3.1, 2.4 and 3.0 % (Earth
  1.8–3.7 %). Largest lake 0.52–0.93 Mkm² (Earth ≤ 0.45), deepest 0.85–2.2 km (Earth ≤ 1.7). Endorheic share
  29–35 % (Earth ~20 % today, Wang et al. 2018; the report's range 15–35 %).
- History, 831576 to 900 Myr: land below its spill fell from 18–28 % of land to 11–17 %, and hollow volume from
  2–12 to 0.4–1.5 Mkm³. The largest hollow fell from 2–14 to 0.2–1.1 Mkm². About 1,000 Mkm³ was trapped over 900 Myr
  (~1.1 km³ a year, beside Earth's ~7 km³ a year of river load).
- Time: no cost per step. Hollow labelling and trapping take 0.09 s of a 77 s history, and all of the rivers step
  2.1 s. Whole histories, interleaved against the base (seed 12345, no cache): 219 s against 228 s on average,
  within the noise of runs that take different paths.

**Checks** against rivers2 on main: invariants pass all 26. The Phase 9 near-miss (290 → 300 Myr rivers) now
passes. Two Phase 8b checks newly fail: "big rivers run through lowlands" (below) and "the first continents' swells
steer the history's rivers" (0.12 km of swell under big rivers against 0.19 at the divides: 0.63, where ≤ 0.6 is
asked). The rest match the base's set, or are timings or histories that took another path.

**The trade-off: big rivers stand higher.** In Phase 8b, "big rivers run through lowlands" (median under 0.40 km)
went from a pass on the base to 0.54–0.73 km. Land below 400 m went from 18 % to 11 %. On one frame, drawn with and
without its fill, the fill raises the big rivers' median from 0.40 to 0.66 km, and 79 % of big-river cells sit on
fill. Before, many big rivers ran along the floors of hollows that the finish then filled with lakes. Now those
floors are filled plains at their spill levels, and the spills stand high because the land does: the finished land
averages 0.84–1.05 km against Earth's 0.80–0.84 (Phase 13's land excess comes from its belts).

**What is left.** Only ~10 % of the remaining lake area lies over a history hollow. The largest left on 831576 at
310 Myr is 2.97 Mkm² and 0.86 km deep, on old continental crust with no history hollow under it. Most sit in belts: closed basins the
terrain draws between ranges, 0.2–0.9 Mkm² and 0.2–0.8 km deep (Earth's Altiplano and Tibetan lakes are far smaller).
Zeroing the terrain's own craton sags and foredeeps (`cratonSagKm`, `foredeepMaxKm`) left the lake area unchanged,
3.7–4.3 % against 3.6–3.8 %, so those depressions are not where the extra lakes come from. A few km-deep bodies lie
on island-arc crust: back-arc basins closed off by their arcs. `land-water.mjs` now counts a body as sea when a
quarter of it lies on open sea floor.

## A lake needs an origin and must outlast its river's load (2026-10-30, branch lakes)

**What was wrong.** On seed 831576 at 310 Myr lakes covered 6.1, 8.2 and 10.0 % of the land at 640K, 2.5M and 10M cells
(Earth 1.8-3.7 %). `tools/trace-lakes.mjs` books each lake cell to the code that made it. At 10M, 11.15 of 15.2 Mkm² came
from two paths with neither rule main's lakes obey: the late pass (no origin test: 11-17 % of its area on the tectonic
mask) and a hollow's fresh pockets (no size-for-its-river test). The big pockets were a hollow's main lake: its outlet
breached, the pond by the outlet filled, the rest found again as a "pocket". With both off, 640K and 2.5M agreed on all
three seeds. `pitDepthKm` and `pitBreachKm` made no difference (6.07 against 6.06 % at 640K).

**Now** (`finish-hydro.js` `lakeStands`), for hollows, pockets, late hollows and a closed hollow's full sub-basins alike:
- **An origin.** Ice-age scour, or a hollow of the tectonic surface. The finishing's own hollows fill.
- **Big for its river**: `lakeKeepKm2`, as before.
- **It outlasts its river's load**, unless the ice dug it. Origin alone was not enough: 74-81 % of the pockets' area was
  on the tectonic mask, hollows up to 1 Mkm² and 65-118 m deep with 20-40,000 m³/s through them. A river leaves its load
  in a lake, so a hollow fills in volume ÷ (inflow × `lakeLoadShare`), and the finish's rivers have run `carveTimeMyr`.
  That is the water's residence time over the load's share, in km³ and m³/s, the same at every detail.
- **A closed lake is not held to it.** Fill lifts its floor; its area stays what evaporation balances.

**`lakeLoadShare` 1e-4** (~150 mg/L at 1.5 t/m³) makes the limit a residence time of ~100 years. Inflows here are recalled
except Titicaca's (HESS 29: 655, 2025); volumes recalled. The world's mean (~530 mg/L, 3.5e-4, limit ~350 years) is its
mountain rivers'; the Selenga carries ~83 mg/L.

| Lake | Residence, yr | At 1e-4 | At 3.5e-4 |
|---|---|---|---|
| Baikal | ~390 | stands | barely stands |
| Tanganyika | ~950 | stands | stands |
| Malawi | ~290 | stands | fills |
| Victoria | ~110 | barely stands | fills |
| Titicaca | ~110 | barely stands | fills |

Victoria dried at ~15-17 ka, so that margin is thin on Earth too. These lakes also have what the rule leaves out: their
rifts sink. The Caspian and Aral are closed, so the rule does not judge them.

**Results** (lake share of land, base → this branch):

| Moment | 640K | 2.5M | 10M |
|---|---|---|---|
| 831576 at 310 Myr | 6.06 → 2.70 | 8.25 → 2.78 | 9.96 → 3.81 |
| 626225 at 300 Myr | 11.96 → 6.24 | 13.58 → 7.56 | not run |
| 12345 at 300 Myr | 5.48 → 3.36 | 6.95 → 5.77 | not run |

`check-basins`: largest lake 0.58-0.93 → 0.29-0.40 Mkm² (Earth to 0.45); land draining to closed basins 29-35 → 26-30 %.
Phase 8b's big rivers' median height 0.62 → 0.44 km (still over 0.40). At 10M on 831576, junctions 81° → 69°, Horton R_B
9.4 → 6.1, dead level 2 → 1 %, rising 4 → 3 %, dead-straight 0 → 0 %, Hack 0.57 both, plain gradient 2.6e-4 → 1.0e-4. Lakes
no longer cover the channels the measures read. Water stage at 10M 27.6 → 24.6 s (one pair, shared machine).

**Open:**
- **The spread left is single closed bodies.** 12345's 3.54 Mkm² lake at 2.5M (95,000 m³/s into a 4.4 Mkm² hollow, 1.19 Mkm²
  at 640K) is 2.3 points of its 5.77 %; 831576's 1.03 Mkm² salt lake at 10M is 0.7. One sill decides each. Trapped seas and
  closed sea basins 3-8 km deep make up about 4 points of 626225's 7.56 %. These are the history's and the belts' surfaces.
- Fresh through-flowing lakes off the ice nearly vanish: no rift this deep exists on these surfaces, and nothing tells
  the finish that a hollow still sinks. Earth keeps ~0.16 Mkm² in Baikal, Tanganyika, Malawi and Victoria.
- Closed lakes keep their speckle at 10M: ~1,800 of the 2,100 are under 1,000 km², 0.37 Mkm² in all. `lakeMinKm2` is one cell
  at 640K (two are asked: ~1,600 km²) and ~6 at 10M, unchanged here.

## Surface checks revised (2026-10-30, branch checkfix)

The surface audit (`audit-surface`, main 34abaab) found five failing checks of which none was a clean model failure. What changed:

- **Sea floor** (8b): the check predates submarine canyons. It now builds the carve a second time with `canyonKm: 0`: that sea must be exactly the tectonic surface; the canyons may only lower the cells under the sea, by at most `canyonDepthKm`, and move nothing above it. Still hard.
- **Rivers run downhill** (8b): drowned valley floors (cells the carve left below the sea) are counted apart, not as rivers. (Retired 2026-11-09, coastflood: `drownValleys` is gone; the carve grades to the lowstand and today's sea floods in once, so the note below is history.) Behind it a small model fix: `drownValleys` lowers each cell by its own drainage and relief, which could leave a river climbing; a cell still above the sea now stands no lower than its receiver where the drowning broke a downhill run (70 and 86 cells on two histories at 640K, 202 at 2.5M, all raised, at most 0.21 km; nothing else moves; a cell the carve left in a pit stays as it was). Still hard.
- **Moving continent carries its fine detail** (8a): `basinCover` (terrain/records.js) divided by `platformNoiseKm`, so with the noise off, as the check builds its noise-free surface, ~60 % of the interior was NaN. It is now 0 when there is no noise (bit-identical otherwise). The check picks the plate that turned most among those with at least 2,000 interior cells, counted on the terrain.
- **Swells steer rivers** (8b): divides exclude filled plains (they have none), and the ratio is the median over five histories (12345, 1, 2, 777, 4242), bound 0.6 unchanged and labelled as a picked mechanism bound.
- **Big rivers run through lowlands** (8b): now a `report()` against ETOPO5 measured the same way (0.21-0.24 km), plus a hard guard that there are big rivers to measure. The model's lack of lowland (12-30 % of land below 400 m against Earth's 46-50 %) is a land-height question for the belt work.

Round 2 (the tectonics checks, from `audit-tecton`):

- **5a belt widens**: the belt's 90th-percentile distance inland from the coast must grow from 40 to 80 Myr, on four seeds (`checkAcross`); the 1.12× cell ratio and the farthest-cell reach are gone (neither sourced; the cell ratio's jitter is ±10 cells). The growth in km is reported.
- **5b arc joined to the coast**: the share of the accreted arc within `arcCollapseKm` of the mainland that is joined to it, over six seeds, floor 0.5 (`JOINED_FLOOR`). The floor is a mechanism test (an arc that never joins is the bug), not an Earth figure; ruled by Jackson 2026-10-30. The misses of the old check were the chain's far ends, which have no coast to close on. The two arc-collision checks are not touched (that scene needs a closing drive that can't die).
- **7b fore-arc islands**: read as the mechanism's result (fore-arc island crust now continent, per seed), not as ISLE_MERGE events past a terrane area cut-off; the count tracks the crust ledger (152 · 109 · 223 cells against its 142 · 127 · 190). The area is reported.
- **7c**: the 1000 Myr two-minute check is no longer hard (a wall clock on a shared machine, of a run no user makes). The time at the whole-planet pace and the deterministic step count are reported. `check-kit.mjs` no longer lists speed as a hard check.
- **11 zipper**: the weld must come after first contact and as the seam stalling, on four seeds; the remnant sea's area is reported against the Black Sea to the Mediterranean (widest gap as detail only: it swings 121-849 km while the area holds 0.4-0.55 Mkm²).

## Who rides up at a collision (2026-10-30, branch polarity)

**The rule.** The upper plate at a new collision is the one with the longest slab within two aprons (`2 × apronKm`) of
the contact, read on both plates' rasters, ocean and land (`chooseSides`, `step/collision.js`). The ocean between the two
went down beneath that plate, so the continent arrives on the plate going down (Cloos 1993). With no slab on either
side, the larger continent rides up. A flip of polarity would be a further event; none is modelled.

**What was wrong.** The old rule counted land trench flags beside the overlap. The arriving continent's coast gains
fresh flags as it overrides the other plate's apron, so a handful of cells chose the side. At contact the ocean trench
has mostly gone: the slab is on land cells on both sides, so reading ocean cells alone does not work either.

**A craton split by a pulled strip is booked.** `pullArcsAfterTrenches` logged `splitCratons: []`; both back-arc branches
now use one helper.

## A sinking floor keeps its lake open (2026-10-30, branch lakes2)

**What was wrong.** `lakeStands` judged a spilling lake by its river's load alone, as if its floor stood still. That was
Jackson's question: where are the fresh lakes with rivers through them? Off the ice, few were left, and those that were
big enough to notice were one giant per world. Earth's spilling lakes off the ice mostly lie where the ground still
moves: rifts, an active range's basins (Titicaca), an arc's graben (Nicaragua). Victoria is the exception, a sag between
rifts, and it barely passes the load test anyway.

**Now** a lake's net fill is its river's load less the room its sinking floor makes. If that is nothing, it never fills.
```
net fill (km³/yr) = inflow × lakeLoadShare − lake area × mean sinking share × lakeSinkMmYr
it stands if      volume ≥ carveTimeMyr × net fill
```
- *(Retired with the lake rules in 7d91f0a: erosion replaced them. The history's rise now reaches the finish as the frame's `tectRateKm`, `ERODE.tectUplift`; the lane fluvial section below.)*
- **What sinks** (`sinkingGround`, read from the frame): ground the belts deformed lately, fading over `carveActiveMyr`,
  and rifts on continental crust. It is sinking against the sill, which is all a lake feels: a hollow in a rising belt
  deepens as its rim rises.
- **`lakeSinkMmYr` 0.25** is a floor's mean, half the peak of a wedge-shaped basin. Peaks: Malawi 0.5-1 mm/yr (Lyons et al.
  2011), Baikal over 0.385 (Colman et al. 2003), a foredeep ~0.25 (derived; its width is recalled). 0.5 gives nearly the same
  lakes: 2.5M shares move by at most 0.05 points, and the open share by at most 0.05 points of land.
- **No seeded lottery.** The first proposal was a share of time holding water, fill ÷ (fill + recurrence). No recurrence can
  be sourced for a broad platform hollow, and 4.29 of 6.49 Mkm² of 831576's non-ice hollows lie on ground never deformed.
  The history already says which ground is active, so nothing random picks the lakes.
- Earth's rule of thumb that lakes are young stays in `carveTimeMyr`. Floodplain, landslide and lava lakes are not modelled:
  nearly all are under `lakeMinKm2` (Sarez ~80 km², recalled).

**Earth's target.** Non-glacial spilling lakes of 1,000 km² and over come to ~0.19 Mkm², ~0.13 % of the land (Victoria,
Tanganyika, Baikal, Malawi, Titicaca, Nicaragua, Albert, Tana, Poyang and others; areas recalled). This is today's figure and
depends on how many rifts are open. `trace-lakes.mjs` prints it as "open fresh off the ice", which leaves out seas' remnants.

**Results** (lake share of land, then open fresh lakes as % of land without each world's biggest; base → this branch):

| Moment | Cells | Lakes, % | Open, % of land |
|---|---|---|---|
| 831576 at 310 Myr | 640K | 2.70 → 2.91 | 0.06 → 0.26 |
| | 2.5M | 2.78 → 2.76 | 0.07 → 0.19 |
| | 10M | 3.81 → 4.24 | 0.31 → 0.76 |
| 626225 at 300 Myr | 640K | 6.24 → 6.28 | 0.22 → 0.24 |
| | 2.5M | 7.56 → 7.59 | 0.23 → 0.25 |
| 12345 at 300 Myr | 640K | 3.36 → 3.43 | 0.04 → 0.11 |
| | 2.5M | 5.77 → 5.89 | 0.04 → 0.07 |

Dead-level and rising are no worse than base on any run. Dead-straight is too, but for 831576 at 10M, 0 → 1 % (rounded).

**Open:**
- **10M on 831576 stands above Earth's 3.7 %, as it did before** (3.81), now 4.24. One lake is 0.32 of that: 488K km² at 18.7°N,
  90 m deep on average, 16,000 m³/s through it, at the foot of an active range. Its sill closes a 496K hollow at 10M and a 190K
  one at 640K. Bigger than the Caspian, smaller than this world's 1.03 Mkm² closed lake. It stands on any sinking rate here,
  so the rate is not what sets it: the sill is. The open share at 10M also holds a 476K lake on main.
- **The 1 Mkm² giants** on 831576 and 12345 are 640K's and were there before. They are closed hollows' lakes, one sill each.
  At 2.5M on 831576 that hollow no longer closes (a gorge from a lake kept upstream, by the code's path; not traced), and its
  giant breaks into salt pockets: the share holds.
- **Rifts are nearly absent:** 0.06 Mkm² of hollows lie within 200 km of any ridge boundary, so Earth's 0.16 Mkm² of rift-lake
  kind come back as foreland and intermontane lakes instead. Deep rift hollows are the surface's to build.

## Erosion through time (2026-10-31; the finish's default since 2026-11-01)

**What it is.** Every finish runs time-stepped erosion and deposition (`finish/finish-erode.js`), and the hydrology's lake
rules stand down by constants, so hollows that survive are filled by the water balance alone. The design is `ERODE` in that
file. Jackson made it the default with bugs known, so that it meets the other features early. `erode: false` in
`finish-config.js` restores the old finish, carve and rules alone.

**What it does.** Implicit stream power (n = 1, Braun & Willett 2013) on a priority-flood network, with the carve's own k,
m, drainage, belt hold and valley share. Deposition is Yuan et al. 2019's G·Qs/A, inside the implicit solve. Laid after
the solve, deposits dammed big rivers. A lake keeps its load until full, and that load is laid out from its river mouths
(`delta`), so a filling lake shrinks and stays deep instead of keeping its whole area as a shallow sheet. Closed basins
come from `closedBasins`. The run:
- before the ice age, a ladder from 160K up to the shown mesh;
- fills bury the finer relief (`bury`);
- isostatic rebound of 0.82 (`rebound`, ρc/ρm = 2.7/3.3, Airy), on the coarsest level only;
- after wind and coast, a polish, because dunes and loess dam the plains erosion leaves;
- a terminal body shallower than a year's net evaporation becomes a pan (`playaYears`).

**Flats** drain by two gradients, away from higher ground and, at twice the weight, towards lower (`flatRule`, Barnes, Lehman &
Mulla 2014, after Garbrecht & Martz 1997). Until 2026-10-31 a flat's receivers were the flood's pop order, an arbitrary tie that
moved lake share by more than the noise, and that no parallel solver can repeat. `flatRule: false` restores it. **Single runs of a
seed under different tie-breaks still vary** (lake share ±0.07 on 831576, ±0.13 on 626225, standard errors of four runs): the figures
below are single runs from before this rule; with it, on Upwell, they are 2.27 / 3.61 / 2.47 %.

**Closed basins' load** (lane hollowfix, 2026-11-11; `closedOutlets` / `layClosed`, CPU and GPU alike). A closed basin's rivers
end at its water-balance lakes (`closedBasins`' water, each at the level its balance holds) or, in a dry basin, at its lowest
cell, the playa. The rest of the hollow is ground like any other: its rivers erode it and lay their load down on it by the stream
power and G, so its floor aggrades into fans graded to the lake. A lake's load is laid as its delta, up to the lake's level. What is
left raises the hollow from its lowest cell, the lake shallowing over a rising floor, up to its **rim** at most. A basin filled
to its rim is judged open at the next judge and drains through (overfilled lake basins become through-flowing: Carroll & Bohacs
1999, Geology 27: 99). **Until 2026-11-11** the whole hollow was the outlet, and its load was laid flat to the rim, the hollow's
spill level, not its lake's. That made dead-level slabs at sill height with cliffs at their rims, and the next judge decided their
drainage by ties. At 831576@430 2.5M (GPU), level patches dropped 562 → 512 and cliff-edge cells 41 → 9; at 716130 they dropped
891 → 835 and 30 → 9. The level area at 831 grew 6.29 → 8.56 Mkm², all of it a lake's graded plain (`level-fills.mjs --classify`;
the slab part, 4.61 → 4.54, is unchanged). One consequence is correct physics rather than a regression: at 831 the cut-off sea
(3.5 Mkm², floor −4.6 km, rim 2.05 km) fills and becomes a through-flowing plain with a few pans, so salt lakes drop
2.87 → 0.06 Mkm². **What it skips:** the load a full basin can't hold (`budget.overRimKm3PerYr`, 42 % of the closed load at 831)
is dropped, not carried over the sill. A closed basin's water evaporates, so nothing crosses its sill while it is closed. The
open item is to let that load raise the hollow past its rim and open it (four designs that moved the surplus to an outlet or its mouths failed: towers where G·Qs/A laid it on one cell, or a diverging budget).
Open lakes are still laid flat to their spill (the slab).

A mesh at or under a ladder level (within 10 %) runs that level's span itself, so 640K takes 160K then 0.2 Myr / 4 steps. To
compare, or to override any setting:
```
node v2/tools/render-moment.mjs --seed 831576 --cont 30 --time 310 --cells 2500000 --width 4096 --lakes --out name --set erode=false
node v2/tools/erode-study.mjs --seed 831576 --time 310 --cells 2500000 --erode '{"polishSteps":3}' --label name
```

**What it gives**, 831576@310 on main b34b7c0, off → on: lake share 5.59 → 3.74 % at 2.5M and 4.92 → 2.50 % at 640K (Earth
1.8–3.7), Horton 5.87 → 5.32, largest lake 0.82 → 0.71 Mkm². Dead level 1.2 → 3.1 % (Earth 0–2) and junction 80° → 83° (Earth
45–72) get worse. One seed; `erosion-report.md` in the lane's notes has the three-seed study, on an older history and with the
sea-level bug below. Its rivers once graded to the seabed at the coast; they now end at sea level.

**On the GPU (2026-11-01, branch gpu-wire).** Add detail's whole erosion stage runs on WebGPU where the browser has it:
`js/gpu/erode-gpu.js` holds FastFlow's depression routing (Jain et al. 2024, Cordonnier et al. 2019) for the network, then the CPU's own
arithmetic swept level by level over cells sorted by depth. The ladder and the polish both run on it, from 500K cells (`ERODE.gpuFloodCells`)
with closed basins' flood too. Laying lakes' load, the closed basins' water balance, the rebound and the ladder's maps stay on the CPU, and
the lay and rebound code is the CPU solver's own. `ERODE.gpu: false` turns it off. With no adapter, the finish runs the CPU solver; a device
lost mid-run fails that finish and the next one opens a new device. `stats.erodeOn` says which ran, and the page logs it. Limits: float32
throughout, so a near-tie between slopes can fall the other way; a machine repeats its own result bit for bit, but two GPUs can differ
slightly; a study's `trace`, `flatRule: false`, `lastClean` and `routeEvery` above 1 exist only on the CPU, and asking for one uses it.
The GPU mirrors the rock column (L3, below): the solve kernel cuts ground above the rock's top at the sediment's k and the rock under
it at the rock's, from one packed vec4 a cell (k, the rock's top, the sediment's k, so no extra binding; 12 bytes a cell more, ~120 MB
at 10M), and the rock's top follows the rebound as `settle` does on the CPU. The bed/mud split runs on the GPU too (lane spread): the
load kernel carries the mud beside the load, its share of each cut from the vec4's fourth word (`column.fine`) and its own
coefficient `Gf` in the uniform's spare slot, so still no extra binding beyond the load kernel reading the vec4; a Cell is 36 bytes.
On a captured 160K level (`gpu-capture`, which now saves the column; 12345@310) the GPU's first step matches the CPU's to float
precision with the split on (|dz| p99 2·10⁻⁷ km, what lakes kept and the export to the sea equal), and ten steps end at |dz| p99 0.5 m
as ties drift. `check-gpu` at the mirror (d081dce, the compressed spread): 9 of 9, lake share within 0.004 points of the CPU, land
|dz| p99 0.2–0.5 m. At the wide spread (spread, 640K, 831576 / 626225 / 12345 at 310) it reads lake share +0.18 / +0.01 / −0.06 points and
|dz| p99 10 / 3 / 15 m. Those sit inside the CPU's own floor at that spread: the same CPU code with each cell's neighbours reversed moves
lake share +0.43 / +0.30 / −0.11 and |dz| p99 105–122 m (at the compressed spread: +0.02 / −0.00 / −0.07, 85–92 m). The wide spread makes
single runs' lake share noisier by about ten times. Chrome on Upwell, 831576@310, 2.5M, Add detail (load 8–10): 65.1 s against 63.6 s
at d3ee416, erosion on the GPU 6.5 against 5.7 s, peak 8.3–8.5 GB against 8.6.

Measured (831576 at 310 Myr, Add detail in Chrome on Upwell, an Apple GPU through Metal, load ~7, `gpu-detail.mjs`): at 2.5M the whole finish
101 → 74 s, its erosion stage 19.3 → 5.7 s (the CPU side with no adapter given to the worker); at 10M the finish 259 s, erosion 24 s,
the browser's peak 13.6 GB (renderer 10.1, GPU process 3.8; 2.5M: 8.8 GB, the GPU process 1.4 against 0.6 on the CPU). On Chroma
(an NVIDIA Ampere GPU, Chrome, desktop session) 640K 32.7 s and 2.5M 68.8 s whole, erosion 3.4 and 6.5 s. Chrome and Dawn on one machine
agree bit for bit. Against the CPU the lake share differs by −0.003 points at 640K (three seeds, `check-gpu`) and −0.03 to +0.06 at 2.5M
(Chroma, four neighbour orders a seed) — inside the CPU's own spread when only its arbitrary neighbour order changes, which at
831576@430 alone swings fresh lakes 1.8–2.7 Mkm² and fills or empties the largest cut-off sea (183–531K km² of water). A planet's
biggest lakes can therefore look different on the GPU, as they would on the CPU with its neighbours listed in another order.

**Headless runs stay on the CPU.** Check suites and `render-moment` run the CPU solver: no GPU contention between suites, and no dependency
in a worktree without `npm ci` in `v2/tools/gpu-harness/`. So a render can differ slightly from what the page shows for the same moment.
What ties the two together: `check-gpu` (whole finishes, GPU against CPU: lake share, land |dz|, a bit-identical repeat; ⚑ if Dawn is not
installed), `gpu-browser.mjs` (Chrome against Dawn, bit for bit) and `gpu-detail.mjs` (the real page in Chrome, Add detail pressed). To run
any tool or suite on Dawn, as a browser would:

```bash
(cd v2/tools/gpu-harness && npm ci)
NODE_OPTIONS="--import=$PWD/v2/tools/gpu-harness/use-dawn.mjs" node v2/tools/render-moment.mjs --seed 831576 --cont 30 --time 310
```

**Limits.**
- **The largest lake on 831576 is over 0.45 Mkm²:** 0.71 Mkm² at 2.5M.
- **Lake share is low in the basins suite:** its mean over three moments is 0.70–0.94 % against 1.25–2.22 with this off, on
  the suite's own meshes. Earth's range is not reached at that detail.
- **Lake share runs low on two seeds of three at 2.5M** with the column on (table below), and no rule is left to relax.
- **Junction angles are not its cause, and it doesn't fix them:** 79–85°, Earth 45–72°. The control with rules off and no
  erosion is already 84° against main's 77°.
- **The span is the free parameter.** The solver sees only k·t, and the carve's k is already close to Earth's: about 13 km³/yr
  leaving the land at the coarsest level, against roughly 10. So k stays, and there is no plateau to run to: 1 Myr clears the
  sheets but takes 831576 to 1.45 % and dead level to 7.2 %. 0.5 Myr is a chosen compromise.
- **Time:** paired on 831576@310, total +10 % at 640K (58 → 65 s) and +31 % at 2.5M (102 → 134 s), under load of 2–3 per
  core, so no quiet figure. 10M was not run on this design, and its memory is unmeasured.

**Lake rules retired (L3, 2026-11-01).** With erosion the default, five hydrology rules were off, and they are now deleted: the artifact
pit, fill time (`lakeLoadShare`, with lakes2's sinking floors that offset it), breach by outflow, big-for-its-river and origin. Each alone
back on, 626225@300 / 12345@300 at 2.5M, against all off (share .72 / 1.30, open ≥ 1,000 km² .12 / .04): pit no change; fill time
share .60 / 1.25, open .00 / .00, so it empties the open lakes that are already at or under Earth's .13–.17, and the softened form
the study proposed has nothing to fix; breach, big-for-its-river and origin within noise (share ±.03, ±.04, +.02 / +.15). The default's
result is the same to the digit without them (831576@310, 2.5M, every field of the study). `erode=false` therefore no longer gives
the old world: it gives rules off with no erosion, which has too many lakes (it is a control).

**What stays** (until lane fsm-wire, 2026-11-03, which retired these too with the old hydrology): the ice age's own rules, big-for-its-river for its lakes (`lakeKeepKm2` with `glacialKeepShare`, `basinKeepShare`) and its
young hollows' breach (`glacialBreachQ`), because erosion runs at 1.5 % on the ice's ground; the least lake the map shows (`lakeMinKm2`,
`lakeMinDepthM`); the pans (`playaYears`); the water balance; and `oneWater` (a display and count rule, until a per-water salt balance or
Fill-Spill-Merge's level sets replace it). The sinking-floor sections and the rule sections above are history: their code is gone.

**Erosion reads the column (L3, 2026-11-01).** `rockColumn` (finish-lithology.js) reads the rock again after the carve, at the
depth the carve cut, so a canyon through cover has the rock under the cover. Ground above the rock is the finish's own sediment and
erodes as alluvium (`column.loose`). `settle` moves the rock's top with the rebound. The load is split into bed material and mud by
the rock's `coarse`, with shares `bedShareCoarse` 0.35 and `bedShareFine` 0.05 (geology-config.js), and mud has its own deposition
coefficient, `GFine`. `column: false` turns all of it off. A second read one bed lower moved nothing past noise at any spread and
was dropped.

Measured at 2.5M, 831576@310 / 626225@300 / 12345@300, one run each:

| | lake share % (1.8–3.7) | open ≥ 1,000 km² % (0.13–0.17) | largest Mkm² (≤ 0.45) | dead level % (0–2) | mean land km (.75–.95) | to sea km³/yr (~10) |
|---|---|---|---|---|---|---|
| no column | 3.74 / .96 / 2.09 | .20 / .20 / .25 | .71 / .05 / .09 | 3.1 / 1.3 / .5 | 1.00 / .90 / .78 | 11.5 / 11.7 / 12.7 |
| **column (default)** | 3.35 / .72 / 1.30 | .12 / .12 / .04 | .76 / .07 / .08 | 1.9 / .8 / 2.9 | .99 / .88 / .76 | 14.6 / 15.1 / 16.0 |
| column, `GFine` 0.5 | 3.34 / .67 / 1.10 | .83 / .20 / .01 | .94 / .17 / .09 | 2.4 / .8 / 3.1 | .97 / .86 / .74 | 18.2 / 19.0 / 19.9 |
| column, `GFine` 0.1 | 2.75 / .48 / .74 | .34 / .11 / .01 | .57 / .04 / .07 | 2.8 / 1.7 / 4.2 | .94 / .83 / .71 | not kept |
| column, spread ~100× | 4.22 / 1.20 / 1.89 | 1.17 / .41 / .41 | 1.02 / .07 / .31 | 1.5 / 1.1 / 1.8 | 1.04 / .93 / .81 | 8.6 / 8.3 / 9.5 |
| column, ~100×, `GFine` 0.5 | 3.83 / 1.00 / 1.75 | .90 / .19 / .35 | .70 / .08 / .29 | 1.7 / 1.9 / 2.7 | 1.02 / .92 / .80 | 10.3 / 9.7 / 11.0 |
| column, spread ~3000× | 4.80 / 1.89 / 2.96 | 1.31 / .71 / .52 | .92 / .07 / .41 | 1.8 / 2.5 / 3.3 | 1.06 / .95 / .83 | 3.7 / 4.0 / 4.2 |

(To sea is the finest level. Single runs carry the tie-break noise above. Spreads by `--set erodeGain=7.1` and `12.3`: ln(ratio) over
Δhard 0.65.) **The default is now ~100× with `GFine` 0.5** (Jackson, 2026-11-02; lane spread). Re-measured at the default on
d3ee416: share 3.06 / 1.00 / 1.75, open ≥ 1,000 km² .35 / .14 / .35, largest .94 (salt) / .17 / .29 Mkm², dead level 1.3 / 2.0 / 2.7 %,
mean land 1.05 / .98 / .80 km. 626225 and 12345 reproduce the row; 831576's history differs since (main's tectonics moved, 5d97f2e).
At the compressed spread, lowering mud's coefficient sent more to the sea, already over Earth's. Each step of
wider rock raises lake share, open lakes and the land's mean height and lowers the export. **Earth's range:** Stock & Montgomery
1999 (JGR 104(B3) 4983–4993) give K from 10⁻⁷–10⁻⁶ on granite and metamorphic rock to 10⁻⁴–10⁻² on mudstones, m = 0.4, n = 1, so 2–5 orders
(from the abstract; the tables were not reached). Those K include each site's climate, so they overstate rock alone. Which spread
and `GFine` to run is Jackson's call: ~100× with `GFine` 0.5 fits the export, but open lakes run over Earth's on all but one seed.

**Jackson's reports, 2026-11-01, page history `b3765410…` of 831576 (cont 30, 1200 Myr), 2.5M** (`tools/trace-interior.mjs`,
`tools/trace-rift.mjs`):
- *Lakes everywhere at 430 Myr* came from the finish before erosion was the default (his detail took 793 s on the history of
  1d851b5). On his current history at 430, the code of that time gives 3.15 % lake share and 172 waters ≥ 300 km² on one
  21 Mkm² continent, 53 of them salt at P/PET ≥ 0.5. The default gives 0.64 % and 29. The hollows are in the surface before any
  river work: 40.8 Mkm² of hollows ≥ 300 km² and 15 m deep before the carve, 20.6 after it, 3.0 after erosion. A salt lake at
  ~800 mm stands where its catchment is little bigger than its hollow: the net loss off open water (1.2 × PET − rain, ~870 mm
  there) outruns the inflow (one of 64,000 km² took 67 km³/yr against the 86 that would fill it). Earth has such lakes
  (Chilwa, recalled), but not by the hundred: Earth's interiors are integrated by rivers, and here that is the erosion's work.
  The default now runs under Earth's share on this world: 0.64 % against 1.8–3.7.
- *The giant fresh lake at 340 Myr* is a proto-ocean: 69 % of the sim cells under it are oceanic crust 0–1 Myr old, between
  plates 98 and 144. It is 0.997 Mkm², its floor −3.0 km, 1.75 M km³. Before the carve its lowest way out is a 917 m sill, so the
  surface never lets the sea in: the history makes the crust but not the flooding. That is a rift-stage finding, not the
  finish's. The finish then treats it as a remnant of the sea that its inflow (1,519 km³/yr, rain 1,232 mm) fills, and the
  hydrology's `h.sea` branch cut its outlet down to `seaCutFloorKm` (3 m; that branch is retired since 2026-11-03, lane rifton). Its way out then runs 7,756 km over land no higher than sea level (the
  hydrology cut 641 cells on this world, up to 1.2 km deep; how much of that path is cut was not separated). That is an outcome
  rule, and it makes the lake read as sea-level water. An isolated young rift basin full of fresh water has Earth analogues (the
  South Atlantic's pre-salt lakes, recalled), but not 1 Mkm² standing at sea level.

**Limits of the column.** One read: a river that cuts through a bed during the erosion keeps that bed's k. Cuts by ice and wind
don't count as depth. Sediment has one k. Time: the lithology stage goes from ~4–5 s to ~8–11 s at 2.5M, mostly the second rock read.

## The geological record (2026-10-31, branch litho, L1)

Each piece of crust now keeps a record of its rock column, ported from World Orogen (raguilar011095, GPL v3; the idea of
reading rock from orogenies and old seas comes from Madeline James's worldbuilding guide): `tectonics/model/geology.js`
(flags, frame encodings), `tectonics/step/geology.js`, `config.geology`. Records only: a history is identical with it or
without (`check-geology.mjs` hashes every frame both ways, two seeds).

- **Wear** (`recordWear`, from `heights.js`, every step): rock off the top. The root as it stands, the relief and swells as
  the crust they stand for (÷ the column's slope, ~6 km of rock per km of ground, as `crustThicknessKm` counts them; upstream
  counts them 1:1), and a share of the crests. It strips the cover above the rivers' standing fill, then the basement
  (`exhumKm`, which grade reads).
- **Cover** comes from this fork's books, not upstream's rates by setting: what `basinFillKm` and `seaFillKm` gain joins it,
  each `everyMyr`, with a make-up by the latitude it lies at then. What they lose by wear leaves it. A belt thickens it
  (`thickenCover`, from `buildHeights`).
- **Settings**: `arcMyr`, `riftAt`, and the flags WAS_ARC, FORELAND, BELT_FRONT, RIFT_BASIN, OPHIOLITE, SLAB_CHANGE.

**Limits** (also in the file's header):
- No shelf deposition: a river reaching the open ocean lays nothing on any cell, so shelves stay bare. Upstream's sea stand,
  flooding, SHELF and EPEIRIC are not ported, so no inland-sea cover either.
- The start world's exhumation and platform cover are a painted initial state (tier 3), booked apart in `geoBook.seededKm3`.
- Facies by latitude alone (tier 3). Carbonate is only the rivers' dissolved load in warm enclosed seas: no carbonate
  platforms and no flooding (a consequence of cover coming only from our books), so limestone runs low against Earth.
- `riftAt` and OPHIOLITE are read off crust flags at the clock's tick: up to `everyMyr` late, a re-rifted cell keeps its first date.
- A sealed cell copies its neighbour's record.
- A foreland has two flags, one per cause. FORELAND is land the heights sank under a load: 2-5 % of land by 400 Myr, and the
  only one the rock reads. BELT_FRONT is land within `forelandFlagKm` of a live belt's outer edge, by distance alone (tier 3):
  1.9 % of land at one moment (2.7 % at 40K), but kept for good, so 42-44 % by 400 Myr as the belts sweep the land. A third of it holds no
  fill, and its width depends on the sim mesh (about one cell at 20K). The old single flag read 49-58 % because it added
  these and the belts' own outer cells, a third of its new cells.

**The budget, measured** (20K, 400 Myr; Mkm³; seeds 12345 / 777): booked basin + sea fill 1004 / 1178, cover laid 666 / 858.
The gap is three things, each measured: river cuts refilled, which never enter `basinFillKm` (122 / 114); wear of fill inside
a tick (6 / 6); and over-booking in `rivers.js` `trapLoad` (212 / 200): `cutNow[c] -= u` runs before `vol(c, r)`, so `kept`
is computed on the reduced cut. Laid + those three matches the books to within 0.3 Mkm³.

## Rock at the finish: k_rock (2026-10-31, branch litho, L2)

Before the carve the finish reads the record into rock (`finish/finish-lithology.js`, `geology/rocks.js`, `geology/lithology.js`;
trimmed from World Orogen, GPL v3): per cell a rock class (`Rock`), `kRock` (erodibility, land mean 1), `bedded` (0…255) and
`coarse` (1 sand and gravel, 0 mud or solution), returned as `fin.litho` for other stages. `geology-config.js useRock` names
which hand rules k_rock replaces, one by one: the shield's and a flood basalt's carve hardness (`carveCratonHardness`,
`lipHardness`, zeroed in the surface's settings by `rockCfg`, so `terrain/synthesize.js` is unchanged and the terrain outside
the finish keeps them) and `iceSoft` on land, as the rock's softness with the land's mean held at the old rule's (without that, on
seed 777 at 300 Myr, 2.5M, coast erosion fell 56 %; with it, it still falls 40 %, 4157 to 2483 km³ on main at 2026-11-01. The whole fall is this switch (`--rock iceSoft=false`, same with erosion on or off). The land's mean is held, but the shore's softness falls from 0.58 to 0.43, and cliffs erode as `cliffHardRatio`^(1 − soft), so their mean rate halves, 0.103 to 0.050. No check covers it, and the cliffs' `cliffK` was set on soft rock, not on a world total). The crests' hardness stays: it is the drawn ridges' structure, which a rock read
from the record does not know.

k_rock ∝ e^(`erodeGain` (½ − hard)), `hard` from Selby's rock mass strength as upstream tabulates it. `erodeGain` is 7.1 (`geology-config.js:77`): ~100× between shale (hard 0.2) and granite (0.85), e^(7.1 × 0.65). Upstream's 2.3 (~4.5× between them, 5.6× softest to hardest) was the compressed spread this replaced (Jackson's ruling, 2026-11-02; L3's tests of wider ones are under Erosion through time).

**Limits**: the carve's k_rock is the rock at the uncarved surface; only the time-stepped erosion reads the layer it cuts (`rockColumn`, above). No
structure cues from the surface, no young sediment (it does not exist yet at this stage), no painted relief or cover stairs.
Rock patterns inside a sim cell are noise (tier 3). Mean 1 over land cells, not weighted by where erosion falls. Frames from
before the record read as zeros: bare basement by setting. History erosion is still rock-blind (L6): `heights.js` keeps its craton rule.

## Food: harvests, soil, fish and the land views (2026-10-31, branch civ-food)

The civ layer's crops, soil and fish, ported from upstream's Food tab (raguilar011095/planet_heightmap_generation,
plans/V2_FARMING_PLAN.md C1–C6b, `v2/js/farming/` — © Robert Aguilar, GPL v3) and written fresh on the civ substrate.
Details and checks: plans/CIV_PLAN.md §11; sources: plans/CIV_SOURCES.md.

- **Harvests a year** (`js/civ/crops.js`, constants in `js/civ/food-config.js`). Each crop class's kinds grow month by
  month by degree-days, wet enough and not drowned. A crop ripens after its cycle. A dry or cold month ends a run; winter
  grains sleep through the cold, tropical roots through a dry season. Harvests are a staircase, at most three a year.
  Rain-fed ones are discounted where the rains fail often; watered ones get ~60 mm a month. A rotation adds a second
  crop of another class in the months the first leaves. Rice needs a month warm enough to flower. Tree crops keep the
  old season (Thornthwaite, a temperature trapezoid).
- **Soil** (`substrate.js placeFood`): river silt, loess, dune sand, else middling ground; black earth, leaching and podzol
  from the land's cover. A crop's food scales by what it asks of the soil; harvests past the first only as the soil can
  feed them; poor warm ground is rested longer (forest fallow).
- **The sea's fish** (`substrate.js seaFish`): a rich shelf within ~40 km feeds up to 1 forager a km² of coast, added
  to the land's foragers. Cold and upwelling seas are rich; warm clear ones and ice-covered ones less. The 1 is Binford
  2001's (the 90th percentile of the groups living mostly on fish); upstream's 2.5 doubled Earth's early foragers.
- **The finish keeps months, not crops.** `civ/months.js` packs each cell's twelve months (24 bytes) when People is on.
  The crops are worked out on the cells read (`cropsFromMonths`), so crop changes do not change the finish's code hash.
- **The land views** (People layer → the view list → "The land, before anyone"): **Farmland** (barren … excellent, by
  the best rotation's food), **Soil** (its kind, brighter where fertile), **Staple food** (what its people would eat
  most), **Way of life** (farming, herding or gathering: the way that feeds most a km² by the economy's own land shares;
  herders only where the rain fails too often to farm, or nothing grows). Hover for all four at once.
- **The People view** now adds a "The land" line to the readout: the farmland's class and the way of life and staple the
  land would suit. Why: the People view shows who lives where, but not whether that is what the land favours. With the
  line, a herding people on good farmland, or foragers on a rich coast, read as what they are.

**Limits** (what it skips): one mean year per place (no frost days, no day length; bad years are climate-var.js's); canal
water the year round, not by the river's season (so the Nile's summer grain beats its winter wheat); no parent rock (TODO,
the geology survey's lithology); flooded paddy by warmth alone only on deltas and marshes; fallow by the soil, not by
people's numbers; the fish from the present sea also in the glacial climate, and on Earth from the coast's air; the
static way of life reads the rain's CV as the run does, but the Earth place check from storms alone.

**Measured** (base main e470080 → this branch):
- Crops against GAEZ v4 (Pearson/Spearman): winter cereals 0.55/0.66 → 0.69/0.71; summer 0.50/0.63 → 0.45/0.64;
  roots 0.58/0.66 → 0.62/0.66; tree 0.74/0.85; paddy 0.55/0.78 → 0.61/0.82.
- Upstream's Earth places (`food-check`): 101/110 hold.
- Earth's people (`civ-sim --earth`): arrivals 12/20 → 13/20; centres 2/10 → 4/10; farming on time 4/7 → 3/7; people at
  50 ka 5.5 → 7.8 M, 12 ka 18.3 → 23.8 M (estimates 1–10 M: both above), 0 BP 170 → 224 M; the first state ~5 ka → ~6 ka.
  The fish: 3.42 M foragers of Earth's capacity at 160K, 3.51 M at 640K (2.8 M when the runs above were made).
- Scale: check-civ-food holds at 40K and 160K on two worlds. Canal land, deltas and marshes are by km, not cells;
  the shelf is found between cells. Wetland is still 1.55–1.7× at 40K (open).
- Ensemble on main 83d20cd (seeds 1–10, main → branch): people at 0 BP 117 → 98 M; centres 45 → 45; all big
  landmasses peopled 8 → 8 worlds; first state 5.0 → 6.5 ka. The wild tree and paddy stands take no fallow (it had
  delayed seed 10's farming by 3 ka).
- Ten generated worlds (`civ-ensemble --seeds 1-10`): states on 8 → 9 worlds; median first city 5.0 → 6.0 ka, first
  state 2.5 → 6.0 ka; people at 0 BP 126 → 130 M. A generated world's origin is now on land when people set out (a
  shelf cell could be chosen before; the fish made it likely).
- Cost: the crops ~11 µs a land cell (~0.5 s on the page's 160K cells; ~2 s for Earth at 640K); the fish's grid
  (a million nearest-cell lookups) ~0.2–0.3 s at any detail.

```
node tuning/civ/food-check.mjs                     # upstream's Earth places: seasons, soils, staples, farmland, people
node v2/tools/check-civ-food.mjs [--cells 40000,160000]   # the same at two details; each mechanism; cost
node --max-old-space-size=16000 v2/tools/civ-land-views.mjs [--seed 799224 --time 290 --cells 2500000]
                                                   # the land views and the People view as PNGs → v2/out/civ/
```

## Shelves are built by rivers; what the lowland is short of (2026-10-31, branch lowland)

**A hollow's fill is booked correctly.** `trapLoad` in `step/rivers.js` shrank a cell's cut before reckoning the sediment it took, so the fill was over-counted by about 1.5× and the excess was taken out of the load going downstream (at times more than the load, so negative sediment ran on). The effect on the world is small: about 3 % of the rock reaching the mouths over 600 Myr, and no measured change in any lowland statistic beyond path noise.

**Shelves.** A river on a passive coast now builds its own margin before anything goes down a fan (`step/sea-fill.js` `buildShelves`). Its rock fills the coast nearest the mouth first, along the shore, up to the room the margin's subsidence makes (`terrain/margins.js` `shelfRoomKm2`, McKenzie's subsidence filled from the shoreline to the end of the necking zone), and only the surplus goes on. There is no share of the flux to set: accommodation limits it. The rock is kept per coast cell (`crust.shelfKm3`, km³ of rock) and the terrain's prism reads it (`terrain/records.js`), so a margin's supply is what its rivers really brought. A margin of the start world, which no river fed, keeps the old estimate (denudation over its age). What a coast keeps stays on its crust when the coast stops being one, so sutured and reactivated margins carry their old rock: 37–52 % of it lies inland of today's coasts by 300–950 Myr, the cover the geological record needs.

Limits (reduced physics): the rock is a total per coast cell, not a wedge on the mesh, and the prism's shape is the analytic one; longshore drift is a fixed reach of 1500 km (recalled), not a current; rock is never reworked at a lowstand; the prism stops at the necking zone, so it cannot prograde over distal crust or ocean floor as the Niger's and the Mississippi's do; and the supply uses `trenchDenudationKmPerMyr`, about twice Earth's flux. In practice nearly every margin is full (the rock available far exceeds the room), so the shelf's width is set by the margin's geometry and not yet by its rivers. A full margin holds 1.9–3.1 km of sediment on average over its 200 km, peaking at 8–13 km.

**What this does not fix.** The land is still too high and too little of it is lowland, and these were measured as *not* mainly sea-level or swell problems (640K, 9 moments, paired on the same frames where stated):

- The largest term in the land's height is the belts' uplift: 0.54 km averaged over all continental crust, on a column of about 0.30 km. 33–49 % of continental crust was worked by a belt in the last 50 Myr. Older ground has worn down (over 200 Myr: 0.16–0.28 km), so the excess is how much is active, not slow wear.
- The swell's amplitude is within Earth's range (p10–p90 about ±0.3 km against ~±500 m observed at long wavelength, Hoggard et al. 2016). Removing it lowers the land's mean by 0.13 km and its median by 0.21 km, and the craton swells and sags that read the same field account for almost none of that.
- Downwelling over slabs (Mitrovica et al. 1989; Gurnis 1992), tried at the sourced ~300 m over 1400 km, moved continental crust under the sea only from 3.8 to 4.0 %. It is not in the model. `tools/trace-lowland.mjs --slab` repeats the test. It is an overlay on finished frames, with no feedback on the history.
- Continental crust is about 28 % of the planet against Earth's ~41 %, so flooding 15–30 % of it would leave land under Earth's ~29 %. (Then; the default is 0.41 since cont41, 2026-11-10.)
- The sea stays where it was. A sea reckoned from Earth's water volume would need the history's sea floor to be right first (`seaLevelFloorAge` in `terrain-config.js`).
- Shelf area is ~0.7 % of the planet against ~7.5 %, while passive shelves are of a fair width: only about 35 % of the coast is passive (20 % late in a run), which comes back to how much trench there is.

`tools/trace-lowland.mjs` measures all of this at any moments. A single history is noisy: a 0.01 % change to one constant moves a moment's land below 400 m by ~5 points, so compare means over many moments, or the same frames.

## Plate stress and the rift stage (2026-11-02, lane pstress)

The forces and the rifts, closer to physics. The four steps below are flags in `config.js`, **on by default since 2026-11-03** (lane rifton; Jackson's ruling, with `plateYieldContinent` 3 × 10¹² N/m). Set them off to get the earlier history back. Numbers: `~/.cache/geo-sim/lanes-2026-10-29/pstress-report.md` and `rifton-report.md`.

- **Force unit (default).** `forceUnitNPerM` 6 × 10¹² N/m (slab pull's transmitted force, not its gross buoyancy). The rigid balance is linear in the forces, so the unit alone changes no speed (measured to 1e-9). With it, `ridgePush` 0.25 (×5 from 0.05; 0.25 × 6 × 10¹² = 1.5 × 10¹² N/m, `config.js:94`) and `founderStrength` 0.4, as one package (Jackson, 2026-11-02).
- **In-plate stress (`plateStress`).** Every `plateStressEveryMyr` the rigid plates' stress is solved on a ~5000-node sheet (`field/plate-stress-field.js`, CPU, deterministic) and held against the rock's strength (`field/stress-step.js`). Where it beats it, `crust.damage` is set to 1 and heals after. Records only: the history's motion is bit-identical with it on. Cost about +10 % of a history.
  Its loads are all those the motion solve has (lane defects, 2026-11-05): until then a land-on-land lock's collider half and the rift hinges' pins were left out (`plate-stress.js` kept only the world view's owner's couplings), so a colliding or unzipping plate's stress missed the forces holding it. With them, the loads' net imbalance fell 0.199 → 0.184, and rifts 52 → 55 on 3 seeds × 600 Myr (in path noise; `lanes-2026-10-29/defects/stress.jsonl`).
- **Diffuse extension (`plateStressRifts`).** Continent broken in tension gets a RIFT record with no work: wide-rift extension beside the narrow rifts. It stamps only crust with no record or a rift's, because a relabelled belt would keep its relief on `riftReliefTauMyr`. How much it adds follows the continents' strength: DECLARED 3 × 10¹² N/m from 2026-11-03 (Jackson), sourced since lane riftstrength (below).
- **Rifts by stress (`riftByStress`).** *Where* a continent rifts is chosen by tension over strength (`field/rift-stress.js`, `ops/rift-path.js` cost). *When* is still `rifting.js`'s rule.
- **Rift stage (`riftStage`).** The first `riftBreakupKm` (180 km) of a rift's opening is thinned CONTINENT with a rift record, not ocean. It closes most of the continental crust's run-down over a cycle (phase 13: 1200 ÷ start 0.79 → 0.91).
- **The finish's sea outlet cut** (`finish-hydro.js`, a trapped sea's outflow cut to sea level) is retired outright. A trapped remnant of the sea is a lake full to its rim; whether the sea gets into a young rift is the history's (the rift stage). With `riftStage` off, such a basin is now also a lake at its rim, not a sea-level lake.

## The continents' strength, sourced (2026-11-10, lane riftstrength)

The declared 3 × 10¹² N/m and the damage that kept a broken cell weak are replaced by a strength law in which every factor is a source's figure (`field/stress-step.js` `rockStrength`; config keys `plateYieldContinent`, `plateHeat*`, `plateCrustRefKm`, `plateStrengthCrust`, `magmaWeakening`, `magmaWeakMyr`, `riftWeaknessCost`):

- **Base: 1 × 10¹³ N/m.** Buck 1991's force to rift a ~40 km crust at ~65 mW/m² (his curves, as Hopper & Buck 1993 Fig. 1 reproduce them).
- **Heat.** A continent's insulation (`world.mantleHeat`, h 0–1) warms the mantle under it by up to 100 °C (Coltice et al. 2007). The boundary layer thins as η^⅓ (diffusion creep, E 250 kJ/mol), so the heat flow rises and the strength falls along Buck's curve: ×0.43 at the land's median h, ×0.30 at h = 1.
- **The crust's own thickness** (Buck's second axis). Strength is interpolated in ln between his 30 and 50 km curves and held at those curves outside that range: thick orogenic crust is weak (×0.45 at 50 km), thinned crust is strong (×2.2 at 30 km). The thickness read is the heights' (`measure.js` `crustThicknessKm`), which wear thins, so erosion feeds the history through it (Willett 1999's coupling). `plateStrengthCrust` off reads every continent at 40 km; phase 8a's like-for-like erosion pair turns it off.
- **The lithosphere: a craton's keel** (lane cratoncol; it replaced the constant `cratonStrength` 6). The mantle's share of the heat flow is conducted up through the lid, so it falls as 1 ÷ the lid's thickness. A craton's 250 km keel (`cratonLithKm`, against ordinary continent's `riftLithKm` 125, the column model's own) halves it: 42.5 mW/m² at rest (Archean provinces average 41 ± 11, Nyblade & Pollack 1993; 41, Michaut, Jaupart & Mareschal 2009), ×5.2 the reference continent's strength (Buck's curve, held at its lowest point, 44 mW/m²), ×3.5 ordinary 35 km crust as formed (`cratonStrengthRatio`: what orogeny's reach into a shield, back-arc break lines and failed arms read). Only half of a swell's warming reaches a craton's surface, so a craton keeps more of its strength over a warm mantle than ordinary ground does: ×2.3 at h = 1, where ordinary crust falls to ×0.30. Its limits: the keel is fixed at 250 km (no thinning by a plume or by long insulation: cratoncheck's decratonization, not built), steady conduction (a 250 km keel's diffusion time is ~2 Gyr, so the quasi-static warming overstates how fast heat reaches its top), and the crust's/mantle's split of the heat flow is ordinary continent's (cratons take only 12–17 mW/m² from the mantle, Jaupart & Mareschal 1999; the sum is what Buck's curve reads).
- **Magma.** Crust a plume head's flood basalt covered is ÷10 for 20 Myr after the eruption: dikes open the lithosphere at an order of magnitude less force than faulting needs (Bialas, Buck & Qin 2010).
- **Inherited lines** (sutures, failed arms, rifted margins) × `riftWeaknessCost`: strain softening (Naliboff et al. 2017).
- **Exceedance damage** is still stamped as a record and in the reports, but nothing reads it as strength. A cell that yielded once kept winning, and at 3e12 that shattered continents (lane riftprobe2).

What it gives (3 seeds, 1200 Myr; numbers in `~/.cache/geo-sim/lanes-2026-10-29/riftstrength/`):
- **Rift candidates** (`tools/riftforce.mjs`): 3.9–4.0 bands per solve beat their strength, against 5–10 targeted from Earth's rift record. That is an outcome of the sourced law, below Earth's median, and is reported, not tuned. No continent shatters after a split.
- **Plates at yield:** 46–50 % → 12.6–14 % (Earth 13–16 %, Gordon 1998; Kreemer et al. 2014).
- **Land in tension** 30–37 % → 7–8 % of the continents per solve. The diffuse extension counted by strain (≥ 10 %) is 3–5 % on both sides (Earth ~22 %), so the strain-counted share was already set by the rift stage, not by the declared strength. Compression stays at 40–49 % (Earth ~12 %).
- **Inheritance:** rift length along old lines 53–57 % → 45–49 % (phase 13). The heat and crust terms now compete with the old lines' ×`riftWeaknessCost`.
- **Whole history:** 124.0 → 118.7 s (bench-lab 160 K × 1200 Myr, Upwell).

## The swell's push and the whole-band rift (2026-11-10, lane riftswell)

A supercontinent used to break into slivers (supercontinent-scale first breakups: smaller side's median share 0.12; Pangea's were 0.3–0.5). Its interior was under compression and stronger than its margins, so the rift's junction, the cell of highest tension over strength, always sat in the ~250 km band where trench pull enters a plate (lane riftsize). Two changes, both on by default:

- **The swell's push (`swellPush`, `step/forces.js`).** Land over mantle a continent has insulated stands high (the model's own swell: `mantleSwellKm` × the smoothed heat, `terrain/sea-level.js`). The lithosphere over it carries the swell's gravitational potential energy and pushes away from its high centre: a body force −∇U, U = ρ̄ g L × the swell's height, with L and ρ̄ from the column model (≈ 3.9 × 10¹² N/m per km of swell). It acts on every cell of the plate, continent or ocean, and is a load internal to the plate: its net torque on the plate is taken back out, shared evenly over the plate's cells. So the stress field reads it and the torque balance doesn't. It puts an insulated interior in tension (Coblentz, Richardson & Sandiford 1994; Lithgow-Bertelloni & Silver 1998) and doesn't move plates. Body forces inside a plate sum to the boundary term (−∮ U n round its edge). Kept as a net (first built on continental cells only), it drove the lab's continents: each slid off the swell it started on (the heat stays in the mantle's frame) and was pushed on along its way. Asia went 1 → 5 cm/yr in the India scene against ~2 without it, and collisions in phases 5, 5b, 6b, 7c and 10 never welded (`riftswell/scenediag.mjs`). **Limit:** the swell's push across a plate's edge is dropped. In the model it reaches across trenches, where the slab cools the mantle and no swell should stand (Lowman & Gable 1999). A swell straddling a ridge would really push the neighbour away; that is not modelled. The swell's height is unchanged; only its horizontal force is new.
- **The whole band judged (`riftBandForce`, `field/rift-stress.js` `bandForce`).** A rift runs through where the force driving it, integrated along the band, beats the band's integrated strength (Buck 1991). Of the cuts searched, the one with the greatest F_drive ÷ F_R is taken, with F_drive = Σ σn·km (compression counts against) and F_R = Σ T·km. The junctions are only where a search starts: they are spread over the landmass (the peak cell, then the deepest cells at spacing √(area ÷ count)), so every part of it is searched. *When* a continent rifts is still `rifting.js`'s dice.
- **A slit is not a rift** (`ops/rift-partition.js`). A cut from the outer coast into a bay the land wraps round divides nothing. It used to score the scrap by its end as the smaller side (shares ~0.005), and the band ratio picked such cuts often. It now scores 0, as the function's comment always said.

Limits: the band test ranks cuts and does not trigger them (the yield trigger is the rift program's L3). The ratio is intensive, so a short band through weak ground can beat a long one through strong ground. The strength still rises inland (cratons on their keels, below), so slivers off weak margins still happen.

What it gives (riftsize's probe, 4 seeds, Chroma x64; head and base main 541b32e probed the same day; numbers in `~/.cache/geo-sim/lanes-2026-10-29/riftswell/report.md`):
- **Inland junctions and tensile interiors, yes:** landmasses in tension 0.41 → 0.81 of their cells. On supercontinent-scale landmasses the junction sits at 0.90 of the deepest cell's depth inland (was 0.46).
- **The smaller side's share doesn't move:** supercontinent-scale first breakups (> 120 Mkm², stress cause, after the start split) median 0.125 (n 18) → 0.089 (n 15), within path noise (±0.04). Pangea's 0.3–0.5 is not approached. The drive is now there; the strength field decides, and it doubles inland (cratons at a constant ×6). It won't move until strength comes from the column, the next step. (An earlier build with the push as a net force showed 0.15–0.30, but that came from continents surfing off their swells, not from the stress.)
- Rifts per seed: 39/29/45/34 (base 35/31/31/37). No frozen world, no storm.
- Phase 13 reports a supercontinent's first 3 breakups' share against Pangea (0.3–0.5), and the start split (t ≈ 2) on its own.
- Time (716130, 40K × 1200 Myr, one thread, Upwell, base and head interleaved, `riftswell/timing.mjs`): whole history 164.5 / 164.4 s → 161.2 / 150.4 s. The histories differ (36 rifts against 31), so the difference isn't the change's; it costs nothing visible. Per `gatherLoads` call: 4.2–5.3 → 8.5–10.2 ms, of which ~3–3.6 ms is smoothing the heat (`smoothHeat`, fresh every step because the heat changes every step). The edge tangents are worked out once per mesh. The band test and the junction spread are inside the rift search.

## The crust budget keeps its volume (2026-11-04, lane crust)
Before this lane the continents ran down over a cycle (area 1200 ÷ start 0.82 ± 0.04, volume 0.88 on 3 seeds): processes
deleted area that on Earth becomes thickness, and one process took the same coast twice. Now on by default
(`config.js`; each flag's comment has its source, and each new taker has its own crust-ledger stage, held by
check-invariants):
- **Rifts stretch, they do not make** (`riftStageVolume`, step/rifting.js stretchConserving): the rift stage's thinned
  margins are the zone's own crust spread wider, volume conserved.
- **Collisions keep what they consume** (`collisionVolume`, step/collision.js keepConsumed, ops/thicken.js): underthrust
  or overlapped crust stays as the upper plate's thickness, all but `collisionLostShare` 0.15 (Scholl & von Huene 2009).
  It is laid across the whole belt the collision has stamped since it began, in the plateau profile 1 − u² (England &
  Houseman 1986), then ring by ring from the front for what finds no room. (Laying it only on the step's own belt left the
  weld — which absorbs the most and comes after the seam stalls, a step that stamps no belt — to ring-fill ~100 cells to
  the 40 km ceiling: phase5's plateau check failed 2 of 3 seeds on that spike.)
- **A belt reaches as far as it strains** (`beltStrainRate`, **off by default**; built at 1e-15 /s): a live belt's width
  is its shortening rate now ÷ this, so a slowing belt narrows and a stalled one stops refreshing its record. Unsourced,
  declared as swept (3e-16 / 1e-15 / 3e-15). On, it took compressive records < 240 Myr from 61 to 55 % (3 seeds), but
  this step's Andean shortening gives sub-cell Andean belts (median 44 km against Earth's 300–700 km), so the Andes
  hold no main range behind the coast (check 8a) and the Laramide belt's area depends on the mesh (12.05 vs
  10.56 Mkm² at 40K/80K, check-scale). Left as a flag. Missing piece: probably the margin's shortening averaged
  over its life rather than this step's.
- **Andean belts add only arc magmatism** (`arcAdditionKm3PerKmMyr` 60, Scholl & von Huene 2009); their thickening beyond
  is the margin's own shortened crust.
- **One rock book** (`rockBook`): the rivers carry the rock the heights wear (crust.wornKm), not a flux of their own, and
  rock laid on continental crust still counts as its volume. It fixes a double loss: sediment subduction ate coast for
  rock the heights had already worn off (−6.4 Mkm² a cycle).
  Every km³ of it is booked where it goes (world.budget, km³): `basinFillKm3` (lakes and basins), `seaFillKm3` and
  `seaOverflowKm3` (an enclosed sea, to its level, and what it had no room for that drainage), `shelfKm3` (the passive
  margin's shelf), `riseKm3` (past the shelf with no trench in reach: slope, rise and abyssal plain, on ocean crust) and
  `fanKm3` (down a fan to a trench), which splits into `sedimentAllKm3` (down the channel) and `trenchKeptKm3` (the prism,
  or overtopping a full trench onto the incoming floor; `wedgeKm3` is the prism's own estimate from the fill). Their sum is
  the rivers' supply, `riverSupplyKm3` (cycle scene, 20K, 1200 Myr: 7.21 of 7.23 Gkm³ on 12345, 6.26 of 6.28 on 777).
  Only basin, sea and shelf fill on continental crust count as its volume; the rest lies on ocean crust (Cogley 1984).
- **The rivers' rock on the ocean floor rides to its trench** (lane crustfu2; step/floor-rock.js). The rise's rock is laid as a
  record, `crust.riseKm3`, on the ocean floor off its mouth by fill and spill (lane riserock; step/trench-fans.js layRise). The
  margin's sediment builds out to a graded profile it cannot stand above: the slope at ~3°, the rise at ~1:250 from its foot at
  2.5 km to its toe at 4.5 km, then the abyssal plain at ~1:1000 (`config.riseProfile`; Heezen, Tharp & Ewing 1959; Emery 1980).
  Each cell takes, nearest first, what fills its water down to that surface, Airy-loaded (measure.js SEDIMENT_LOAD_FACTOR),
  out to the turbidites' reach `trenchFanReachKm`; the walk may cross a drowned shelf or cape within `riseProfile.coastKm`.
  What the reach has no room for builds it up toward the sea's surface (each cell a like share of its room). A reach at that
  brim spills on past it over the ocean floor, each cell to its brim, and a sea whose every reachable floor is at the brim (a
  sea closed by land that sea-fill did not mark enclosed) sends the rest on as an enclosed sea's overflow (`seaOverflowKm3`;
  ~2–3 % of the rise on 626225/831576). No cell is capped and no rock stands above the sea. Floor merged under another
  plate's crust (step/floor-rock.js) spills its rock above the brim over that plate's ocean cells the same way. 3 seeds × 430/
  800/1200 Myr (40K): the rise's p99 11.0–15.6 km, the passive-margin mean 3.1–6.3 km and the max 16.0–22.9 km, against Earth's 5–15 km at the
  thickest and ~2–4 km mean (Straume et al. 2019 GlobSed; Poag 1985); was p99 33–84 and max to 552 km
  (tools/rise-thickness.mjs, commit 691cbbd). Not all inside Earth's range: the p99 tops 15 km at one moment (626225 at
  1200 Myr, 15.6; 831576 at 1200, 15.4), 4 of the 9 passive-margin means sit above 4 km (4.1–4.6, and 6.3 on 626225 at
  1200 Myr, the same moment as the 22.9 km max), and every max is past 15 km. The p99 is mostly in range (seven of nine
  at or under 14.2); the mean is the soft spot. Limits: the profile is measured as the crow flies, not along channels; one column per cell;
  compaction is one compacted density, not a porosity–depth law; the floor's depth is its age's (no swell). Margins at
  grade on floor 300–1100 Myr old, which this history never subducts, still send ~1/3 of the rise past the reach. That
  rock, and an enclosed sea's fill (`crust.seaFillKm`), moves with its plate. Where the floor is subducted (resolve.js, or a
  plate that runs out: ocean-plates.js), it meets the trench as any incoming sediment does: `min(T, accretionSedimentKm)` ×
  `sedimentSubductionShare` of the section goes down the channel and the rest is scraped into the prism (Clift & Vannucchi
  2004). The books are `riseDownKm3`, `riseKeptKm3`, `seaFillDownKm3`, `seaFillKeptKm3` and `riseUnlaidKm3`. A floor cell
  dropped onto crust another plate holds there (tidy, terrane accretion, the background ocean) carries its rock with it.
  Cycle scene, 20K, 1200 Myr, 12345 / 777 (Gkm³): of 2.80 / 3.13 laid, 0.50 / 0.57 went down, 1.61 / 1.92 went to the
  prism, 0.49 / 0.45 is still on the floor, and 0.19 (6–7 %) is lost to drop paths not yet carried (check-invariants
  reports the share). **Limits:** it is books and records only. The terrain does not read `riseKm3` (its rise is
  terrain/margins.js's analytic one) and the trenches' fill does not count it. The spread is by distance, not by where
  turbidity currents pond.
- **Subduction erosion** (`subductionErosionKm3PerKmMyr`, **off by default**; built at 36, `subductionErosionReachKm` 250; step/subduction-erosion.js):
  every closing overriding trench eats the continent nearest it within the fore-arc, thinning it until it founders. The
  rate per km is Earth's; the length that erodes is emergent (~0.8 AU removed against Earth's ~1.5).
  Off since 2026-11-05: with `beltStrainRate` off it held the Andes down. Check 8a's main range stood only 0.21 km over the
  coast (needs 0.3) and the upper-plate plateau 0.56 km over the foreland (needs 0.75); both pass with it at 0. The
  unsourced 250 km reach spans the inner half of the belt and eats the arc's root, where Earth's erosive margins lose the
  fore-arc wedge. **Follow-up:** a sourced trench-to-arc reach, then turn it back on.

Measured (3 seeds × 1200 Myr, mean of 300/600/900/1200; off → on, with `beltStrainRate` still on then, so the compressive
figure below is the flag's): area 1200 ÷ start 0.82 → 0.89 ± 0.01; continental crust
under the sea 7.0 → 18.6 % (Earth ~29); land 26.5 → 23.3 % of the sphere, crust 26.9 → 27.7 %; compressive records
< 240 Myr by reach 63.9 → 54.3 %. Check 13 now counts deformed crust **by strain** (≥ 10 % off its undeformed column), as
Müller et al. 2019's deforming networks count resolvably strained crust, not every cell a belt once touched; the reach
count is still printed beside it.

- **Each process counts once** (defects item 7, crustfu): the Andean arc cap (`arcAdditionKm3PerKmMyr`) bounds the root
  heights.js lays, rootGain included (it was 1.25 × the cap); with `riftStageVolume` a rift's shoulders are lifted, not
  thickened (flexural rebound and heat: Weissel & Karner 1989 — their record and uplift stand, no root); and synthesis's
  rifted-margin profile (terrain/margins.js) subsides only for the thinning beyond what the history's rift stage already
  did to the crust (its Airy part Si (d0 − d); the thermal part is all the profile's).

What this does not do (open):
- **Most worn rock leaves the continent.** It is booked now (above), but ~4–5 Gkm³ a cycle (rise ~1.9–2.4, the trenches'
  kept share ~1.7–2.2, enclosed-sea overflow ~0.7) lies on ocean crust, where on Earth most stays on the continents as
  recycled cover. Rock on the rise rides its floor to a trench; the raster does not carry it (no field), so its fate
  there — subducted or accreted — is not modelled.
- **The 41-vs-29 gap is the start inventory**, not geometry: `continentalFraction` 0.29 was in effect land (the default is
  0.41 since cont41, 2026-11-10: "The world the targets describe"). Progradation
  was measured and refuted as a crust maker (a filled sea floor carries ~14.6 km of sediment on ocean crust; Cogley 1984
  ends continental crust at the slope's foot).
- `collapseMakesArea` (a collapsing range spreading over its own plate's sea floor) stays off: +0.8 Mkm² a cycle, within
  noise.
- Intra-oceanic fore-arcs do not erode; the fore-arc reach (250 km) is recalled, not sourced.

## One water ledger (2026-11-06, lane water; model review U1)

Before, the land's water was computed six ways: the climate's Priestley–Taylor bucket (rain.js), the finish's Budyko
runoff on it, `runoffMonths`' own seasonal heuristic (a 1/12 share where no month ran: 2.7–10.5 % of the land), polar's
annual `thawedWater`, a linear 300 + 55·T potential evaporation in the timeline's basin estimate and `check-basins` (1/5–1/2
of Priestley–Taylor below 5 °C), and the cover's and civ's own buckets at 150 and 100 mm (`tools/water-study.mjs`, 3 seeds × 2
moments at 640K). Now one account, `climate/water.js`, books what each place's rain becomes, P = E + R + ΔS:

- **Snow** (`snowYear`): each month below 0 °C falls as snow and melts at 120 mm a month per °C (Braithwaite 2008). Three
  years from bare ground; what the third year keeps is the kept snow, the ice's store (`iceDischarge` takes it, as before).
- **The year's split** (`fuEvaporation`): Budyko in Fu's form (ω 2.6) on the climate's own Priestley–Taylor. On the
  finished ground its land evaporation is 0.97–1.01 of the climate's own. A pure monthly bucket ran off only 0.23–0.30,
  because monthly means lose the storms within the month (Milly 1994). So the year's split is Budyko's and the months only
  time it.
- **The months** (`waterMonths`): each month evaporates k·Ep_m, at most what the ground holds (its liquid plus a 150 mm
  soil, Manabe 1969, the one soil the cover reads too), with k set so the year matches Budyko's. The soil's spill runs
  off, part of it through the ground (baseflow). There's no 1/12 fallback: ground that never runs times its inflow by its
  melt, or else by its warmest month.
- **The lakes**: a hollow's water gathers every cell's runoff, so its sky water is the rain less the cell's own runoff
  (`skyKept`), not the rain. The old form counted each lake cell's rain twice, 360–970 km³/yr (0.9–2.9 % of the land's
  runoff). Open water loses E_open − E_land against it (closedBasins, the erosion's closed basins, the FSM).
- **The last ice age's lakes** read the sky's own runoff, not today's runoff with today's sheets' melt added. Today's
  sheets aren't the ice age's, and their melt had fed the ice-dammed lakes at the margins. floods, 7 worlds: seed
  626225@300's ice-dammed lakes went from 2.49 to 1.67 Mkm²; 12345@300's largest lake from 520 to 35 thousand km³, and its total from 1.17 to
  0.76 Mkm². The rest is proglacial physics (see the floods section). The ice age's own melt budget is U9.
- **The timeline** (`zonalPET`, `zonalPETAt`): Priestley–Taylor from the latitude's insolation, with seasons from the
  temperature stage's land response F̂/(B + K + iωC). `terrain/basin-estimate.js` and `check-basins`' Earth seas read it.
- **The climate** is bit-identical. Its Priestley–Taylor constants moved to water.js, and rain.js re-exports them. Its own
  bucket keeps its tuned 87.5 mm: that bucket sets how much the land gives back to the air, while the ledger only sets when.

Books: `stats.waterLedger` (rain, evaporation, runoff, kept, the climate's evaporation, closure). Reported in check-basins:
the land's runoff ÷ rain 0.34–0.40 (0.36–0.42 with the ice that reaches the sea; Earth 0.33–0.42, Dai & Trenberth 2002,
Oki & Kanae 2006), the sky's alone, and the closure against the climate's evaporation, within −1.5…+0.6 %.

**The cover** keeps 300 + 55·T as a classification index only (`FINISH.petBaseMm`, `petPerC`). Its wetness S-curves were
fitted on it, and it books no water. Its soil and snowmelt are the ledger's. Refitting the cover to AET/PET is a later lane.

**What it skips:** the month's mean temperature only (no thawing days from the monthly spread); snow's sublimation and
drift; frozen soil; no store carried between years but the kept snow; lakes and wetlands evaporate as their land does
in the ledger (their extra loss is the hollows').

**Not wired (other programs):** the history's rivers' fixed 0.35 runoff (`tectonics/step/rivers.js`) would read the
ledger's zonal shares (Budyko on `zonalPET`). Civ's Fu buckets (`civ/crops.js`, 100 mm) would read the ledger's soil and
monthly E per cell from the finish's fields.

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

## Path-sensitive checks made robust, and the rock-volume report (2026-11-05, lane coast9)

**Which checks, and why they flickered.** A history is chaotic, so a physics-neutral nudge sends it down another path. We ran
phases 9, 10 and 8a on main (63b39b6) and on three perturbed paths (`GEO_SIM_PATH=1,2,3`, `tools/lib/paths.mjs`: `plumeSpacingKm`
×(1 + k·10⁻³), 1.5 km per k). gjallar's earlier control, `trenchDenudationKmPerMyr`, no longer perturbs main: with `rockBook` on the
rivers carry the rock the heights wear, and `riverSupplyKm3` is bit-identical at ×1.003. Before the fixes the four paths read:

| check | main · +1 · +2 · +3 | class |
|---|---|---|
| p9 half-cell coast | 94.8 · 94.8 · 94.8 · 94.2 % vs ≥ 96 %: fails on every path | (b) the bound was above what either read reaches; cell-size-dependent |
| p9 land's shape (gain over the grid on every seed) | pass · fail · fail · pass | (a) a sign test on three reads, gains of 0.01–0.04 |
| p9 ridges (gain over the grid on every seed) | fail · fail · fail · fail | (b) both reads put the kernels on the crust: a gain of ~0 is expected, its sign is noise |
| p9 renewed after a period | pass · fail · fail · fail | (a)/(b) the bay sample is 68–883 cells: 0.3–1.4 independent 700 km patches |
| p10 craton scraps | formed in 1 of 3 sets on every path | (a) a set needed 3 scraps; they are rare (0–10 a history) |
| p8a moving continent keeps its detail | pass on all four paths; the scene formed 3 of 3 | none: it held once main's other failures were settled by the crust lane |

**What changed (check design, no model code).**
- *Half-cell coast.* Judged in km. The check counts cells within 300 km of a coast on both sides, a 600 km band; a coast displaced by *d* on
  average flips *d*/600 of them, so *d* = (1 − agreement) × 600 km. The world-grid read re-samples the crust through the nearest cell of a
  raster whose offset from the first is a fresh fraction of a cell: two independent roundings, |U₁ − U₂| with U uniform on ±*h*/2, whose mean is
  *h*/3. With *h* = √(cell area) = 113 km, *d*_max = 37.6 km, agreement ≥ 93.7 %. The crust read is held to that line and, separately, to
  beating the grid on average. It measured 30–32 km (94.7–94.9 %) on all four paths; the pre-Phase-9 92.4 % is 46 km, over the line. Scale-free: *h* moves with the mesh.
- *Gain over the grid* (coast, heights): 9 reads, not 3 (100, 150 and 200 Myr of each history); mean gain > 0 and a majority of reads favouring the crust (`lib/gain-test.mjs`).
- *Ridges:* demoted from "better than the grid" to "not worse": the two reads are the same by construction, so a gain isn't expected. It fails only if the mean gain is below zero by more than two standard errors (≈ 2 % false failure on a true tie). The ridge correlation itself (≥ 0.55) stays hard.
- *Renewal:* the ridges, thousands of cells, are the hard renewal check. The bays' renewal is a `report()` with its independent-patch count (a sample of ~1 patch reads −0.2…0.8 by chance); the bays' frame-to-frame hold stays hard with a 100-cell floor, n printed.
- *Craton scraps:* judged over the six histories together, scene formed at ≥ 5 scraps (was 3 in each of three sets), each scrap listed with where it was found.

**Open (class c, left failing where it fails).** On main 5ab3142's own path (`GEO_SIM_PATH` unset) the pooled scrap check fails on a real
hole: 40 scraps found, and one (history 12345 at 560 Myr, one cell, ground around it 0.10 km) reads 2.66 km below its surroundings, i.e. a
1-cell craton scrap standing ~2.6 km under the sea in the middle of lowland; the next worst is 0.98 km. The three perturbed paths pass (15, 26 and 9 scraps, worst under 0.5 km;
on 63b39b6 path +2 had a 0.72 km scrap inside a 2.78 km multi-belt range). Not investigated further: a scrap cell of craton can keep a base the surrounding crust's record
doesn't (the terrain reads the scrap's own raster cell). The 0.5 km absolute bound was set from the pre-fix worst (1.27 km); it scales with nothing and is not derived.

**Rock-volume report.** `node v2/tools/check-volume.mjs` (library `tools/lib/volume-books.mjs`) runs the 1200 Myr cycle at 20K cells with
the crust ledger's area and volume on, and prints per stage the continental and arc crust booked (read generically, so a new stage appears by itself),
the rock the heights wore off, and where the rivers set it down: basin fill, enclosed seas, shelves, trench wedge, sediment subducted (or, when
present, crustfu's `fanKm3`, `riseKm3`, `seaOverflowKm3`). On 63b39b6: 7.43 Gkm³ worn per cycle (Earth ≈ 6–10, recalled), 7.18 carried, 2.27 set down, so **5.16 Gkm³ (69 %) in no book.** On 5ab3142 (crustfu's books): 6.49 worn, 6.36 carried, 6.35 set down (basin .53, sea .68, overflow .70, shelves .35, trench fans 2.12, rise 1.97), **0.15 Gkm³ in no book.** Report only; ~8 min.

## The rock book closes stage by stage (2026-11-06, lane rockbook, review U2)

All the rock the planet holds is one record: crust-ledger.js `rockParts` counts continental crust (its kind's thickness plus its
root), the relief it carries (as the crust it stands for), the sediment on any cell (basin, enclosed-sea, shelf and rise rock),
island-arc crust with its root and relief, and the rock worn off and not yet carried (`crust.wornKm`). A stage that makes or
loses rock books the flow by name in km³ to `world.budget` (`tectonics/rock-book.js` lists them all): arcs grown, matured and
recycled; a collision's rock consumed and kept; pieces moved to another plate or handed back to the ocean; margin isles raised,
merged and eroded; a hollow's fill worn away. Every book is the cell's rock after its change less before, in the record's own
per-cell measure (`cellRockKm3`), so a book cannot drift from what it counts. `tools/lib/volume-books.mjs` `STAGE_FLOWS` says
which stage may book which flow, and `check-invariants.mjs` (the ledger's 300 Myr run, volume on) holds every stage's change in
rock to its books within 1 % of its gross movement (or 0.005 Gkm³). All of this only reads and counts: histories are
bit-identical (crust fields and the budget's other counters hash the same at 12345 × 400 Myr).

- **Measured** (20K, 300 Myr, seeds 12345 / 777 / 4242): every stage closes within 0.8 %, except the rivers and their fans,
  held as one unit (the fans spend over the next steps what the rivers deliver) to 5 %: −3.2 … −4.0 %. The gap is in
  step/rivers.js. trapLoad books the rock that refills a valley cut as `basinFillKm3`, but the cut (`crust.riverIncKm`) is a
  record with no volume (0.029 Gkm³ on 12345). Some supply also reaches no sink: ~0.015 Gkm³, ~10 Myr of the mouths' rate
  against a 4 Myr river span. The tolerance tightens to 1 % when rivers.js books `cutFillKm3`.
- **Unpaid sources, named:** a belt's relief and root (`beltReliefKm3`, `beltRootKm3`: the rigid upper plate loses nothing for
  them; review row 10, "belts from shortening"). A rift's shoulders are among them: `beltReliefKm3` booked in the rifts stage.
  An arc welded on as continent is reworked up to an ordinary continent's crust (`arcMaturedKm3`).
- **Not done:** one density/porosity law for the three sediment densities (margin 2400, fill 2500, foredeep 2700/900). It
  changes the path and the margin's density is the datum lane's to read; deferred.

## The craton-scrap hole was a coast (2026-11-06, lane scrap)

coast9 left phase 10's pooled scrap check failing on main's own path on one scrap: history 12345 at 560 Myr, one cell, 2.66 km
below the ground beside it (0.10 km). Traced on aa16a74, it is not a craton defect. The cell (world 29716, plate 159's raster
16016) is a coast tip, with the sea on 4 of its 7 sides. Its own column stands *higher* than its neighbours' (0.37 km against
0.21, `columnModel`), the records keep it land (`rec.land` 1, raster coast distance +9.8 km), and the craton terms play no part.
The margin line (`records.js marginLine`, σ ≥ `coastLineKm` 120 km: the coast at the scale of its promontories) draws the coast
across the cell, so its terrain points lie 58 km offshore and read the margin slope's depth (platform −2.57 km). The check's
"ground around" counted only the land neighbours, so it compared a coast tip with inland ground. Its continental neighbour
reads below sea level too (−0.36 km). As a control, every land cell of that history at 500–600 Myr with the sea on 3 sides
stands 0.42 km below its land neighbours (median; 0.47 for craton), and the worst 10 % stand more than 2 km below: a coast's drop.

**Change (check only, no physics).** `check-phase10.mjs` judges only the scraps the land encloses, with no sea cell beside them,
because a hole *in a range* is the defect it asks about. It reports the scraps at the sea's edge separately: their count, the gap's
median, 90th percentile and maximum, and how many read under the sea though their column is land.

**One land mask and one datum (standing goal #8; model review U3, 2026-11-06).** Each stage used to decide "is this land?"
on its own. The terrain's records went by the crust's height, with a below-sea column joined to the ocean drowned. The
history's rivers went by its kind: every continent and arc was land, however low. The finish's rock went by z ≤ 0, so a
closed hollow below the sea read as sea. Now there is one decision, `terrain/land-mask.js landMask`: water below the sea's
level is sea where it joins the world ocean. The records and the history's rivers read it on the sim grid. On a drawn
surface, `world-ocean.js worldOcean` applies the same rule to the heights; the finish's sea and its rock read that. The
mask smooths the mantle's heat once per call, so on the rivers' clock it costs ~8 ms at 40K. `tools/datum-study.mjs`
measures the stages against each other on 3 seeds × 300/560 Myr at 160K:
- The rivers saw 16–42 Mkm² more land than the terrain draws. Their sea stood 11–22 m off the terrain's, and 11–36 % of the
  cells they routed water through lay in the drawn sea. Now: the same land, the same sea, and 0.5–2.2 %.
- The margin line turns 455–709 land cells a moment into sea, so a coast tip's land column reads up to 6.7 km down the
  margin's slope. A line that turned no cell (drawn between the mask's cells) was tried and dropped (2026-11-06): it
  made those columns 1.0–1.6 km shallower, but it tied the drawn land to the grid's cells, and land heights followed
  the crust less through a half-cell turn (`check-phase9.mjs` "…and so does the land's shape": 0.87 → 0.83, on every
  perturbed path). Coast tips are left to their own follow-up. Of the points the coast puts offshore, the line puts
  58–63 % (3 seeds × 300/560 Myr), the anchored per-plate lookup and the coast's curvature term (`synthesize.js`) the rest.
  The largest group at 300 Myr lies onshore but low on rifted margins. Review U8 read it as the margin profile's thermal sag applied twice, a second subsidence on ground the
  history kept whole. The margin profile now reads the history's stretch record (`crust.riftThin`, 1 − 1/β): landward of
  the crust's edge the sag goes only as far as the history stretched (`margins.js` `subsidence`). The effect is near
  null (onshore-low points −0.1 to −0.8 %), and the reason is the finding: on 777 @300, 68 % of the onshore-low points
  sit on crust the history really stretched. Most of that lowland is a stretched margin's near-shore plain (median 30 km
  inland) sagging 0.1–0.3 km under the sea, not a double subsidence. U8 is to be re-scoped from this, not re-tried.
- Repair rules: none retired. The margin line's topology veto stays with the line that turns cells. Two are kept as
  named rules or physics. The pocket fill
  (`pocketSeaKm2`, review heuristic 07) is now applied alike by every stage, in the mask. The mask does not make it
  unnecessary: only a coastal sediment surface would fill such seas. The shelf top graded from the datum
  (`synthesize.js` `sedTop`) and the filled plain held at `max(0, seaKm)` (`records.js`; heuristic 20) are kept as
  physics, not repair: a shelf records its long-term base level. A sea that falls exposes it and a sea that rises drowns it.
- Civ's fixed coastline (`v2/js/civ/**`) is out of scope. To share the mask, civ would read `rec.land` (sim grid), or
  `worldOcean(mesh, z, 0)` on its own mesh, in place of its fixed coastline.


## Earth replay R1: the t₀ data, an Earth start world, a static force test (2026-11-06, lane replay1)

New files only; no model behaviour changed. Study: `~/obsidian/brain/projects/geo-sim-earth-replay-study.md`. Earth (Müller et al. 2019, 0–250 Ma) as the model's start world at t₀ (model time 0 = t₀ Ma), plus the checks that the plumbing and one force-balance solve on Earth's geometry read right. Everything is **report-only and held out**: no parameter may cite a replay number (study Q5).

**Run, from a fresh shell at the worktree root** (data is gitignored under `tuning/earth/data/`; python is the pygplates venv from `fetch-earth-replay.sh`, `-I` always; **never call pygplates `resolve_topologies()`** — it segfaults on this arm64 build; these tools use `TopologicalModel`):

    sh tuning/earth/fetch-earth-replay.sh && sh tuning/earth/fetch-earth-replay-r1.sh   # data (the second adds 65/250 Ma age grids + Cratons)
    node v2/tools/earth-replay-mesh.mjs                                    # dump the 40K and 80K lab-mesh cell centres
    PY=tuning/earth/data/venv/bin/python
    sim-slots run -n 2 --gb 4 --who $me -- $PY -I v2/tools/earth-replay-plates.py --cells 40000   # plate id per cell per Myr, 0–250: plates-<n>.u16 (20 MB at 40K; ~15 min on a loaded machine)
    sim-slots run -n 2 --gb 4 --who $me -- $PY -I v2/tools/earth-replay-crust.py  --cells 40000 --t0 0 65 100 250   # crust class + trenches at each t₀
    $PY -I v2/tools/earth-replay-poses.py --t0 0 65 100 250                # pygplates's own poses, the harness's reference
    node v2/tools/earth-replay-start-check.mjs                             # hard: the start builder cannot read an outcome
    node v2/tools/earth-replay-harness.mjs [--cells 40000] [--t0 100]      # hard: pose closure ≤ ½ cell, partition ≥ 95 % (≤ 5 Myr on)
    node v2/tools/earth-replay-static-force.mjs [--cells 40000] [--t0 0 65]   # report-only ω table (wrap heavy runs in sim-slots)

- `js/tectonics/scenarios/earth-start.js` — `buildEarthStart(mesh, seed, inputs)`: one plate per reconstruction plate id, pose identity at t₀; continent / craton / arc from the continental, craton and island-arc polygons carried to t₀; ocean `formedAt = −age` from the t₀ age grid; mature trenches on the overriding plate along topological subduction zones. Crust thickness, belts, hotspots, sediment and climate are the model's kind defaults. **Not registered** in the lab or any scene index (that needs existing files); tools import it directly.
- **It cannot read an outcome.** The builder is handed plain arrays and imports no reader; `earth-replay-inputs.mjs` loads them through `readInput`, which accepts only the manifest's t₀ files (the age grid *at t₀*, never today's). `earth-replay-start-check.mjs` asserts both import graphs and that the gate refuses ETOPO/CRUST1.0/other-time files.
- **Known limits.** Continental polygons are the present-day shapes carried back (mild outcome-awareness: score processes, not outlines). Cratons: Merdith 2021's layer is a mixed set of basement terranes in another frame, not a craton map; only features of type Craton or named craton/shield are used (~13 Mkm² of Earth's ~50), joined through the continental polygon's own rotation, so cratons are under-counted. Island arcs: the 35 static IslandArc polygons exist only for the youngest times (80 cells at 0 Ma, none at 100/250 Ma); arcs there are `formedAt` 0. Cells in a deforming network take its rigid block's or its own plate id. Slab age and dip are not given. 
- **Harness numbers** (40K, t₀ = 100): pose closure worst 0.009 km against pygplates (float32 mesh); partition agreement 98.7 % at +1 Myr, 96.1 % at +5, 90.8 % at +10, 69 % at +20 (crust made and lost since t₀ is not carried, so it drifts — plumbing, not physics).
- **Static force test**: builds Earth at t₀, one `updatePlateMotion` solve (`lastDt` set huge so the relaxation blend is 1), then each plate's ω against the Müller stage rotation around t₀ (mantle frame): fastest surface speed, pole position, area-weighted RMS velocity difference, plates at the hard cap or ≥ 85 % of the soft limit that bends ω first (`softenSpeed`, 7 cm/yr continental). A baseline for the force-model owner; tunes nothing.

## Rendering Earth (2026-11-06, lane earthrender)
`node v2/tools/render-earth.mjs [--crops-out <dir>]` draws ETOPO5 through render-moment's own picture path (`finishRaster` + `paintFinished`, palette `relief`) on the 2.5M terrain mesh: render only, ~10 s. Use it to tell a draw artifact (shows on Earth too, e.g. the stair-stepped coast) from a geometry artifact (the sim's straight shelf edges, detached flat islands, scattered lakes). Neutral defaults: no lakes, rivers, ice, lithology or Köppen. ETOPO5 (9 km) is read from `-civ`'s raw folder (read-only; `--etopo` for another path). It is finer than the 2.5M cell (~14 km), so a finer ETOPO adds nothing at this detail.

## Coasts: what makes the wiggle, and the sea side's two drawn defects (2026-11-07, lane coasts)

**The coastline's wiggle is the tectonic surface's.** On 831576 at 430 and 340 and 12345 at 560 (2.5M, finished), turning off
both lookup warps (`warpKm`, `cellWarp`; `render-moment --tset`) moves the coast's D by under ±0.06 by kind and with no
consistent sign (main 1.146 / 1.190 / 1.160 overall; Earth 1.15–1.35). Turning off the finish's erosion and waves as well
lowers local D at 15–42 km by only ~0.015–0.02. What the warps do is hide the grid: without them the coast's spectrum
(`render-moment` prints it) rises at 85–120 km, the sim's cell (430: 1.155 against 1.101/1.104 beside it; main 1.128).

**The forearc wedge is bounded to its own margin** (synthesize.js, sea side). It used to be drawn wherever a trench lay
within 450 km and the ridge lay farther, so deep-ocean cells 230–400 km off an active coast were raised to −2…−2.6 km, and
the cut's contour showed as pale straight-edged patches. The wedge now has weight by its taper: its drop (shelf top to floor
plus the trench's depth) over its width W, coast to trench, through the cell. It fades from full at 2° to none at 1°
(`forearcTaperDeg`; critical-taper wedges slope ~1–8°, Davis, Suppe & Dahlen 1983; Earth's forearcs run 100–250 km coast
to trench). A wedge too wide for its drop is a sea floor, not a forearc. The ridge test is now a smooth step (30–90 km past
the trench) instead of a cut. 831576@430, 640K: lift > 0.3 km for W 0–250 / 250–400 / > 400 km goes 378 / 679 / 3734 →
255 / 65 / 0 cells. On the terrain scenes (andes, japan) the lost lift was detached: a rim ~900 km off the Andes scene's
coast and a −1.6 km plateau in mid back-arc sea. Their forearcs' ramps end without a step (`tools/forearc-scenes.mjs`
counts the lift, with the debug hook).

**The shelf grades to wave base under the poured sea, not the datum.** When the poured sea stands below the datum (a
lowstand), the sea-side shelf, its sediment top and the land-side submarine shelf grade to `shelfEdgeKm + min(0, seaKm)`.
A nearly filled narrow sea was drawn as a flat, detached dry island before (0.11 km above a sea at −0.26). A sea above the
datum still drowns the shelf: shelves are planed at the lowstands. records.js fills the floor with sediment to the same
wave base. Sea-side cells drawn dry on 831576@430: 0.76 % → 0.14 %. Of what remains, the flat islands' floor is the rise
rock's thickness (riseKm3 over area, 28–51 km), which is its own lane.

**Left, in their own lanes** (the lane's report: sized plans): the coast tips (277–424 land cells per world drawn on the sea
side of their sim cell) and replacing the warp with the history's eroded relief, flooded at the current level.


## Fluvial: erosion over the history's window (2026-11-10, lane fluvial)

The finish's erosion used to run a short ladder (10 + 4 + 2 steps) from the moment's surface. It now runs over the
**window the history itself covers** (`tectSpanMyr`, carried on the terrain-pool frame: the slim frame had dropped the
scalar, so the span never engaged before c92d61f). Processes, all in `finish-erode.js` (`ERODE`):

- `tectUplift` (U): the history's rise reaches the finish as `tectRateKm`, so rock uplift and incision balance over the window.
  The old `sinkingGround` is retired.
- `spanWindow` / `spanMaxMyr` (20): the ladder is stretched to the window, each rung at its own dt.
- `spanSplit` **'even'** (default): every rung stretched alike. `'coarse'` put all the extra time on the 160K rung, whose
  ~56 km spacing printed as ~100 km mounds (spectral power ×2.7–3.6 at 50–240 km; U added only ×1.2–2). With 'even' the
  mounds become dendritic dissection.
- `hillD` / `diffD`: hillslope and channel diffusion, 0.01; inert at physical D, pinned to 0 in check-gpu.

**Kept on purpose.** R5 (a bed stands at least at its receiver's, never above the tectonic surface): without it 7770 river
cells were carved below their receiver and 8b's downhill check failed. R6 (a cell drops by its valley's share,
`carveValleyKm`, 20): without it a coastal strip drowned (land −5 to −7 %, drowned-valley backstop 28.13 → 25.27 % of the
planet; with it 27.2 %). The finish solvers' R6 share is deleted. 8b standalone, all on, R6 and even: every check passes
(0 river cells below their receiver; drowned valleys 29.13 → 27.94 %).

**What it costs** (831576@430, history cache off; `stats.erode.levels[]` gives it per rung). Cost is steps × per-step cost:

| | 160K | 640K | 2.5M | erosion stage |
|---|---|---|---|---|
| base (steps) | 10 | 4 | 2 | 640K 3.6–3.9 s; 2.5M ≈ 5 s of rungs |
| head, coarse | 194 steps, 19.6 s | 4, 2.0 s | 2, 1.9 s | 640K 32–34 s (Chroma D3D12) |
| head, even | 125 steps, 12.9 s | 50, 12.3 s | 25, 18.1 s | 2.5M 47.6 s (Upwell Metal, load ~25) |

Per step ≈ 0.10 s at 160K, 0.25 s at 640K, 0.7 s at 2.5M, so the span costs roughly 3.3 s per Myr at 640K whatever the split.
History and every other finish stage are unchanged (history 70–72 s vs 71–74 s; finish 112–117 s → 125–142 s). To cut
it: a bigger dt (0.05 → 0.1 halves the steps) or a lower `spanMaxMyr`; neither has been judged on the crops.

**Numbers (all on, vs main).** Above 4 km: 2.30 % of land at 2.5M (Earth 2–3 %); max height 6.7 → 7.7 km and 7.1 → 8.2 km (the
top peaks are still rising at the window's end); mean land 1.67–1.83 → 1.42–1.65 km (Earth 0.8; the offset predates the lane).
Lake share (640K replicates) stays at or below base's range for 831576@420–440 and sits 0.4–0.5 % against 0.14–0.17 % for 12345.

**Open.** rake-compress loses on M1; hillD/diffD at physical D are inert; 'even' still dissects plateaus hard over 10 Myr
(a K question); the span's GPU cost; mean land is 2× Earth's; scattered 30–50 km hills on the lowland east of the 831576@430
belt that base lacks (seen in the 2.5M crops, not yet measured).

## Volcanism: fluxes, rift volcanoes, calderas and eruptions (2026-11-10, lane volcano)

Design and numbers: `lanes-2026-10-29/volcano/report.md`. The history already placed its volcanoes (arcs, plume tracks,
flood basalts, ridges) but kept no rates. `tectonics/volcanism.js` reads them off the frames, as records, and never
writes to the world: the history and its hash are unchanged.

- **`volcStep(prev, frame, mesh, H)`** gives a frame's `volc` record: magma and erupted km³/Myr by setting, gas (CO₂,
  H₂O, SO₂, Cl) in Mt/yr from a cited yield table, the frame's LIPs (volume, pulses, sills, thermogenic CO₂ from the
  cover's coal, organic and salt facies), and its live centres (arc front, rift, plume) with a VEI cap.
  `tools/volc-flux.mjs` prints a cached history's record against Earth's ranges.
  - **ridge:** new floor × 7 km of melt.
  - **arc:** the history's arc book (net crust growth) × **ARC_GROSS = 3**, since ~⅔ of arc melt founders as cumulates
    (Jagoutz & Kelemen 2015). The melt is what degasses and erupts.
  - **plume:** strength × Earth's mean tail.
  - **rift:** decompression melting under the stretch (`riftMeltKm(β, ΔT)`, McKenzie & Bickle 1988). The mantle's
    excess heat comes from insulation and nearby plumes, so hot rifts melt and cold ones stay dry.
  - **LIP:** the model's own volume (~2–3× Earth's per area; a LIP-volume lane is queued).
- **`recentEruptions(volc, seed, kyr)`** draws a finished moment's eruptions by VEI: Earth's rates (Papale 2018;
  Newhall et al. 2018; Rougier et al. 2018) scaled by the world's explosive arc weight, and shared only among centres
  whose cap allows the class. A world without thick-crust arcs or continental plumes has no super-eruptions. Sizes
  within a class follow N(> V) ∝ V^−0.8. Eruptions never enter the history; LIP pulses stay in-frame records.
- **Drawn at a finished moment (default on; `terrain/volcanoes.js`, `momentVolc` on the moment's own frame):**
  - **Rift volcanoes:** where a rift melts in the last 10 Myr, as many cones as `riftConeShare` (0.5, declared) of the
    erupted lava builds, ridges along the rift. Satellite cones are common.
  - **Calderas:** at silicic centres, the largest eruption of the last 2 Myr leaves a collapse whose area is its
    dense-rock volume ÷ 1.5 km of subsidence (Lipman 1997). Each has a floor ~0.7 km down, filling with age (e-fold
    1 Myr), a low rim, and sometimes a resurgent dome. Only the VEI classes whose caldera spans two terrain cells are
    drawn: VEI 8 at the gallery's 2.5M cells, VEI 7 from ~3 km cells.
  - The finish floods the closed floors into lakes by itself.
- **Limits:**
  - A rift cell stretched over several frames is credited its whole melt in each (an exit is `riftThinPrev`).
  - Silicic caps are rules on crust thickness and setting (tier 3).
  - A caldera is its single largest eruption's (nested collapses are not summed).
  - At a moment the arc rate is the history's mean so far (one frame has no window book).
  - No subducted carbonate or metamorphic CO₂: the carbon box's.
  - No ash or andisols yet (V7).
  - The history's trench record (`budget.trenchKmMyr`, ~10 500 km) is ~4–5× short of Earth's, so it isn't used.
- **Checks:** `tools/check-volcano.mjs` (the melt law, the Earth-rate eruption draw, records-only, the arc factor,
  calderas only at silicic centres and shaped as depressions, no rift volcano without melt), plus report lines
  against Crisp 1984, Fischer et al. 2019 and Wong et al. 2019.


## The world the targets describe: continental crust 41 % (2026-11-10, lane cont41)

`continentalFraction` (tectonics config) is the start world's continental **crust**, shelves and drowned margins included, not its
land. Its default was 0.29, Earth's *land* share, a leftover from before the water inventory, when the crust stood almost all
above a reckoned sea. Under the poured sea (Earth's 1.332e9 km³) a 29 % crust leaves ~360 Mkm² of deep floor and no margin to
flood, so the sea stood 0.60–0.85 km below datum at every moment ≥ 300 Myr on every seed. Every Earth land-height target was
judged on that world (lane landheight, 2026-11-10). The default is now **0.41**, Earth's continental crust incl. shelves
(Cogley 1984; ~41 % crust under ~29 % land), on Jackson's ruling (2026-11-10). It is a world setting, not a tuning.

- **One source.** The Evolution page's Crust slider starts at the config default (`evolution-main.js`; a link's `crust=` still
  wins), the lab's start-world panel reads it, and the tools take `DEFAULT_CONT` from `tools/lib/moment-frame.mjs`
  (`pageWorld`/`momentFrame` default to it). Every check and study tool that hard-coded 29 or 30 (`cont: 30`, `--cont 30`,
  `continentalFraction: 0.3`, check-basins included) now follows it. Deliberate values stay: check-phase3's variant
  worlds, check-history-cache's 0.35 key test, check-waterbooks' explicit 41.
- **What moves** (landheight's probe on the 3 seeds, sim 40K, finish CPU 160K; `cont41/probe-table.txt` in the lane folder):
  finished land mean above the poured sea at 300 Myr 1.28 / 1.29 / 1.04 km (cont 29) → 1.08 / 0.65 / 0.90 (cont 41; Earth
  0.81 on the same mesh); finished land below 500 m 25–30 % → 36–42 % (Earth 54 %); the poured sea at 300 Myr −0.64…−0.76
  → −0.04…+0.06 km. Late frames still fall where continental area is lost (716130 at 1200 Myr: 124 Mkm² of crust, sea
  −1.09, land 2.96 km): that is the crust budget's to hold (crustmass S3/S4), not the datum's.
- **The start frame** stands at 2.25 km (cont 29: 2.95): the placeholder ocean is uniformly old. A separate lane gives it Earth's
  age spread.
- Gate land-height numbers before this change measured the 29 % world; compare against the cont41 baseline.
