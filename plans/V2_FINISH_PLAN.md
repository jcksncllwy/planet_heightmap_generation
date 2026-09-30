# Evolution: finishing a moment — plan

The developer (2026-09-29): *"more 'finishing touches' on the planet. Once someone finds a good place, we can have a
relatively more expensive step that can diligently warp, add noise, and run more realistic erosion based on climate that
more accurately sculpts the final terrain. I'd love to incorporate real to the ocean rivers and erosion, adding in
glaciation/fjords/depressions from the last ice age, and sand/wind erosion."*

Decided with the developer (2026-09-29):
- **The whole planet**, with a choice of detail: the Evolution page's three (160K, 640K, 2.5M cells) **and one more,
  10M cells (~7.7 km)**, offered for finishing only.
- **Up to about a minute on a desktop**, with a progress bar (phones: a lighter version, and no 10M).
- **No water drawn** in rivers and lakes yet ("we WILL do rivers and lakes at some point, but not right now"): the land
  as the water shaped it.

This replaces step E of plans/V2_FULL_PLANET_PLAN.md (V1's erosion run as an experiment) and feeds step C (export): a
finished moment is what gets exported.

## What there is to build on

- **V2's carve** (`v2/js/terrain/carve.js`): analytical stream-power erosion, coarse to fine over meshes ×4 apart; every
  river reaches the sea (a priority flood breaches every pit); the history's own rivers followed (gorges); drowned
  valleys at mountainous coasts; submarine canyons. Rain is a latitude estimate (`rainAtLatitude`).
- **The new climate** (`v2/js/climate/`, run for the page in `evolution/climate-worker.js`): per terrain cell annual
  temperature and rain, Köppen; on a 1° grid the year / January / July temperature, rain, pressure and wind; currents,
  sea ice. ~1 s at 160K.
- **V1's finishing** (`js/terrain-post.js`): domain warp, detail noise, smoothing, a combined hydraulic (Braun–Willett) +
  thermal + glacial loop (the glaciation by latitude and height only; fjord carving), ridge sharpening, soil creep. Ideas
  and pieces to reuse, tuned for V1's meshes.
- **Measured for 10M cells** (Node, one thread, 20K plates, 1200 Myr): the mesh 14 s to build, 400 MB of arrays (2.4 GB
  peak with one frame's surface and carve); the surface 24 s, the carve 6.7 s. (2.5M: 2.5 s, 100 MB; 6.4 s; 2.6 s.)
  So at 10M the page and its terrain workers cannot each hold the mesh, as they do at 2.5M.

## How it works

- A **Finish** button beside Calculate Climate: finishes the moment shown at the detail chosen in its own drop-down
  (160K · 640K · 2.5M · 10M; phones up to 640K). It pauses, shows its stages as it goes, and can be cancelled.
- It runs in **its own worker**, which builds (and keeps) the mesh; the surface is synthesized by the terrain pool in
  **slices** (each worker gets only its cells' positions and sampling, never the whole 10M mesh); the carving and the
  finishing stages run in the finishing worker.
- The result comes back as an **equirectangular height raster** (e.g. 8192 × 4096, 16-bit: 67 MB), not as a mesh: the
  page paints and shades it for the globe and the map, and step C exports it. The page never holds the 10M mesh.
- Kept per moment while the history is open (as the climate is — the last four); a **Show Finished Moments** toggle
  compares it with the timeline's terrain; scrubbing away shows the live terrain again, and the finished moments are
  listed as links under the button.
- The climate it needs is calculated on the finish mesh itself (its costly part is on a fixed 1° grid; the per-cell part
  — lapse rate, orographic rain, Köppen — is linear, ~2 s at 10M). Smooth regional fields (an ice sheet's surface, its
  rebound, sand seas' surroundings, loess) are worked on a 0.25° lat-lon grid in km (finish-grid.js).
- Every rate in km, Myr, °C and mm (scale invariance): the same planet at every detail, more of it at the finer ones;
  the big rivers settled on the same coarse surface at every detail (`carveSettleCells`, already built).

## Phases (each checked in the browser before the next)

**F1 — the frame, and a first finish.** The button, the detail drop-down (10M included), the worker, slices, the raster,
Finished / Live, the cache. First contents: a diligent warp and detail noise (in the world's frame: a one-off moment), then
the carve run longer and with the **climate's rain** instead of the latitude estimate. *Done when*: a moment finishes at
each detail within the budget (10M ≤ ~1 min on the development desktop), memory stays within a tab's (measured), and
the finished terrain is the same planet as the live one, only sculpted.

**F2 — rivers, basins and hillslopes by climate.** Runoff = rain less evaporation (from temperature): wet regions drain
to the sea as now, but **dry basins stay closed** — salt flats, playas and inland basins, some below sea level (the Great
Basin, the Caspian, the Dead Sea) — instead of being breached; rivers **deposit** as well as cut: floodplains, alluvial
fans where they leave the mountains, deltas at their mouths. Hillslopes by climate: frost-shattered, talus-steep in cold
mountains; soil creep rounding the hills in wet lowlands; sharp and bare in deserts.

**F3 — the last ice age.** The moment's climate cooled by an **Ice age** amount (a setting: none · mild · Earth-like ·
strong; Earth's was ~5–6 °C globally, much more at high latitudes) with the sea ~120 m lower; **ice** where snow outlasts
summer — ice sheets on high-latitude continents, ice caps and valley glaciers on high mountains — its thickness and flow
from a simple ice-surface model. Where ice flowed fast it carved: **U-shaped valleys** along its paths, **cirques** at its
heads, **fjords** where it reached the sea (troughs cut below sea level, flooded when the sea came back), **scoured lake
districts** on shields, **moraines** and **outwash plains** at its farthest reach. Then the ice melts: the land it pressed
down is still sunk, rebounding (**Hudson Bay, the Baltic**). At 10M (~8 km) fjords and cirques show as landforms; at
2.5M as broad troughs.

**F4 — wind.** In hot deserts (Köppen BW), **sand seas**: low ground filled flat, with dune ridges across the
prevailing wind of the climate (their spacing the smallest the mesh can show — draa-scale, a texture more than
landforms); **deflation pans** in basin floors; **loess** mantling the land downwind of deserts and of the ice age's
outwash (softened, raised plains).

**F5 — finish.** Step C's export of a finished moment; phone limits measured on a real phone; README, tutorial, What's
New as CLAUDE.md asks.

## Status (2026-09-29)

**F1–F4 built** (developer: "just do 1-4, but for 3 just do earth like for now") — `v2/js/finish/`, the page's Finish
section (`evolution.html`, `evolution/finish-view.js`). F5 not started. Measured in headless Chrome on the development
desktop (20K plates, 300 Myr): 640K 8 s, 2.5M 15 s, 10M 53 s (13 s of it building the mesh, kept after); the whole
browser from ~2.4 GB to ~5.5 GB at the peak of a 10M finish (the finish worker ~3 GB), ~3.5 GB at 2.5M. In Node (20K,
1200 Myr, 10M): surface 8.4 s, climate 2.2 s, rivers 15 s, sediment 2.3 s, ice 2.5 s, wind 2.5 s; ~1 380 closed basins,
~1 300 deltas, ~30M km² of ice-age ice (5 sheets), ~7M km² of sand seas, ~18M km² of loess. Phones: 160K and 640K only
(640K in ~7 s on the desktop's CPU — to be measured on a phone).

What reads best: fjorded, island-strewn coasts where the ice reached the sea; troughs cut into glaciated uplands; flat
pan floors in dry basins. Weakest: sand seas — dunes only at 10M (30 km ridges, ~4 cells a wave), and the rivers' narrow
channels still show through them in places. The hover readout still describes the live terrain on a finished moment.
Not yet: the ice age's strength (Earth-like only, as asked), water drawn in rivers and lakes (later, by choice), export
(F5 / step C).

**Round 2 (developer: "rivers and cutting can be quite straight … only cutting in some places and not 'everywhere' (some
mountains look blurry and not cut in) … the poles have their weird carving way too deep and bad artifacts"; "even deserts
should get rivery erosion (even a little) cuz it gets some rain").** Diagnosed by switching stages off: the pole grooves
were the ice troughs — routed down the smooth dome of the ice-sheet surface, its flow lines straight and radial; the
isolated cutting is the carve's valley share (a cell drops by the share its valley takes, ∝ √drainage: trunk rivers cut
canyons, tributaries hardly mark the ground between); straight channels, routing over smooth slopes and the coarse
levels' straight valley segments; creep, loess and the warp were not the blur. Changed: the ice routed over the bed (its
valleys) plus 6 % of its thickness, cutting only near its margins (full within 40 km, none past 250 km — sliding outlet
glaciers, not the frozen interior), troughs 0.6 km at most (was 1.1); **dissection everywhere** after the carve — every
drainage line cut by up to 0.35 km × how steep the ground is × how many cells drain there (a ridge … a valley the mesh
shows), rivers still downhill; a fine routing relief (30 m, 60 km down to the mesh) so channels wander; the drainage
weighted 30 % by the rain itself (deserts' rivers cut a little); the carve 0.8 Myr (was 1.2). Timings unchanged
(10M ~52 s, 640K ~9 s on the page).

**Round 3 (developer: "places with a lot of water look unnaturally blurry").** Not the creep or the sediment (the same
with both off): the drainage weights were linear in the runoff, so the wettest regions carried ~10× the mean — their
valleys far wider and their land graded far flatter than the live terrain's. Now the weight is the square root of the
relative water, at most 2.5× the mean (deserts ~0.3× — their rivers cut a little more, as asked). The climate's rain is
also capped at 6000 mm for the finish: its grid has rare hotspots of 10 000–70 000 mm a year (~0.2 % of land; up to
6 400 mm in a month) — for the climate work to look at; the live Calculate Climate shows them too.

## Open questions, for when they come up

- Rivers and lakes drawn as water: later, by the developer's choice (the finish already knows where they are).
- Should the finish also run on the history's timeline (every frame)? Not planned: it is the expensive, on-request step.
