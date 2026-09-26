# V2 roadmap — phases 9 to 13 (before the full planet)

Written 2026-09-26, after Phase 8 closed. Each phase below has a **definition of done** to agree with the developer
before it is built; none starts until the one before it is confirmed (design doc §9).

## Decisions that shape this roadmap (developer, 2026-09-26)

- **Order: steady detail, start-world defaults, natural collisions, sim resolution, supercontinent cycle** —
  numbered 9 to 13 in that order — then the full planet. "The parked are the most important things … before moving
  forward. I think it's a lot of small tweaks and rethinking."
- **Steady detail is critical.**
- **Collisions need rethinking** before the supercontinent cycle: "way way too many captured seas in between
  continents, and a lot of dangly and long snake-like continents and islands … collisions need to be more natural,
  more fluid, more rotating and kinematic." A few small remnant seas are right — "it just shouldn't be a crazy amount".
- **More cratons at the start** — "so fewer fully undisturbed pieces of land over history". (Tried in Phase 10: the
  count makes no measurable difference; the developer: craton BEHAVIOUR will do more. Phase 10 became the cratons' edges
  and look; the untouched-land targets moved to Phase 13.)
- **Try a finer sim mesh** — "it is a bit too blocky right now" (the heights already give much of the detail).
- **Not in V2:** plate editing (V1 and V2 live side by side). **Parked:** heights feeding the history (a height ceiling
  that turns into width) — not critical. **Speed** becomes part of the full-planet phase.

## How every phase runs

1. Plan and definition of done agreed (this document).
2. Built, with a lab scene that isolates it, an on-screen checklist, and a headless check script with numeric
   pass/fail.
3. **History changes are allowed in phases 9 (part B), 10, 11, 12 and 13** — each changes how the planet evolves. When one
   does: every earlier suite is re-run; a failure is analysed, and a check is re-baselined only with the reason written
   down (design doc §10); each scene must still tell its story (India still collides and builds its plateau, the Andes
   still rise, Hawaii still draws its chain…). A new probabilistic rule gets its own seeded stream.
4. Scale invariance holds (km, Myr, °C — never cell counts), and moving a terrain look slider never changes the history.
5. Confirmed by the developer in the browser; then the next phase.

## Where the world stands (baseline, 2026-09-26)

History scene (the generated start world, every mechanism on), 600 Myr, sim mesh 40K cells (121 km), seeds 12345 and
777, measured every 100 Myr. Definitions used throughout:

- **enclosed sea** — ocean crust not connected to the world ocean, larger than 50,000 km² (the terrain already fills
  smaller pockets as lowland);
- **thinness** of a landmass — its deepest point from the coast ÷ the radius of a disc of the same area (a disc 1, a
  ring or a snake ≪ 1; below 0.35 reads as a snake or a ring);
- **undisturbed** crust — continental crust that no belt (current or overprinted), rift margin, failed rift or flood basalt
  has touched.

| Measure | Now |
|---|---|
| Enclosed seas | 3–13 at a time; almost all lie inside ONE plate (sealed in at a weld); seed 12345 at 600 Myr: a 62 Mkm² ocean inside a ring continent of 3 plates (73 Mkm² enclosed in all) |
| Big landmasses | thinness 0.27–0.40 for the largest ones late in the history (a ring; snake-like), 0.5–0.9 for the rest |
| Small bits (< 0.3 Mkm²) | 41–96 at a time: 34–85 island-arc pieces, 2–16 fore-arc isles, 1–4 continental scraps |
| Undisturbed continental crust at 600 Myr | 30 % / 42 % (about half of it craton); largest untouched patch 10–18 Mkm² (South America ≈ 17.8) |
| Small rivers between frames 10 Myr apart | log-drainage correlation 0.20 (routed at random: 0.12) |
| History time, 600 Myr | 21–28 s at 40K cells; 51 s at 80K |

What causes the collision problems (read in the code):

- **The collision lock is total.** torque-balance.js ties colliding plates on their WHOLE relative velocity ("slow,
  stop, and move as one"), so at first contact the pair stops pivoting: the rest of the ocean between them stays open.
- **Welding comes too early.** collision.js welds a pair after 600 km of shortening, 40 Myr of contact, a stall or a
  big overlap (front ≥ 800 km); merge-plates.js closes only straits narrower than ~520 km. Anything wider stays inside
  the merged plate — ocean crust with no boundary around it — and nothing can ever close it.
- **Rings.** Continents welding one after another around an ocean build a ring with a sealed ocean inside: the 62 Mkm²
  sea and the 0.27 "snake".
- **Island arcs are most of the "dangly islands"**: long chains of small arc pieces (34–85 at a time).

---

## Phase 9 — Steady detail

*Goal:* scrub the history and a drifting continent keeps its coastline, its medium-scale shapes and its small rivers,
changing only where the history changes.

**A. Records read in each plate's own frame.** The terrain's records (coast distance, shelf, platform, belts, uplift,
…) live on the fixed world grid: every frame a moving plate's crust is re-sampled onto different world cells, and the
terrain interpolates across world-grid triangles — so medium-scale shapes (coast wiggles at ~120 km, the edges of belts)
re-form as a plate moves. The fine noise is already anchored (8a, round 4); this anchors what it rides on.
- Each world cell's record values go to its crust cell (plate, raster cell — anchor.js already knows it); the terrain
  interpolates over the PLATE RASTER's triangles at the point's plate-frame position (the same mesh geometry, carried by
  the plate). Raster cells no world cell shows (rotation leaves a few) take their visible neighbours' mean.
- Across a plate boundary each side samples its own plate, blended as plateFramePoint blends now.
- Records that belong to the world (a trench line, the boundary between two plates) are checked one by one: most are
  measured from features that move with a plate and carry over unchanged.

**B. Stale belt positions fixed at the source.** ~2 % of belt cells carry a distance across their belt that jumps by
more than a cell spacing from their neighbours' (380 of 16,655 at 600 Myr); the terrain repairs them (records.js,
the "donut" fix). Trace each back to the step that stamped it — suspects: a belt front that moved on and left older
stamps behind (orogeny.js spreadBelt), and the resampling of the lower plate at a weld (merge-plates.js) — and fix it
there. This changes histories (belt positions feed the belts' own growth).

**Status: accepted 2026-09-26 (developer) — A built (design doc §10; check-phase9, 8 checks); then, on the developer's
"a little bit too consistent", the fine detail renews slowly (detailRenewMyr, 150 Myr — steady from frame to frame,
re-sculpted over a few hundred Myr). B moved to Phase 11 (developer agreed): its likely sources — the weld's repainting
of the seam, a belt front moving on — are the collision code Phase 11 rewrites, the terrain's repair already hides the
donuts, and fixing it changes every history, which Phase 11 does anyway.**

**Definition of done** (revised with the developer: "improvement and overall feel of stability, not perfection"; the
small-river correlation replaced by river course persistence — streams below the terrain mesh's grain re-form by
construction)
- Lab: the history and India scenes, scrubbed frame by frame, show no re-forming coastlines or belt edges on a drifting
  continent; checklist items for both.
- Rivers over 10,000 km²: ≥ 90 % run within a terrain cell of one at the same crust 10 Myr before (reached 95–96 %).
- Coastline: on the plate that moved most, land/sea agrees at the same crust position 10 Myr apart on **≥ 95 %** of
  terrain cells within 300 km of its coast (was 87–95 %; reached 94–97 %; the terrain mesh's own grain costs ~1–2 %).
- ~~Belt positions: 0 stale cells~~ — moved to Phase 11 with B.
- Anchored detail (8a check) stays ≥ 0.95; 640K terrain still ≤ 2 s; every suite passes (reached: history bit-identical).

## Phase 10 — Start-world defaults and cratons

*Goal:* more, smaller cratons, so more of the land is worked by rifts and belts over the history — fewer big,
untouched interiors (A); and cratons that look like shields and meet the ranges pressed against them the way real ones
do (B — developer, 2026-09-26: "better ways to treat cratons so they blend with stronger mountain ranges that border up
very close to them … research more about cratons and how they work and look").

### A. More, smaller cratons — tried, dropped (2026-09-26)

The plan was cratonCount 14 → ~22 and smaller cores, on the idea that more seams between cratons mean more rifts and
less untouched land. Measured over three seeds (12345, 777, 4242), 600 Myr, undisturbed continental crust / largest
untouched patch:

| Start world | 600 Myr |
|---|---|
| 14 cratons (now) | 30 / 42 / 46 % — 10–18 Mkm² |
| 18 cratons, largest ≤ 3,000 km | 40 / 33 / 49 % — 8–20 Mkm² |
| 22 cratons, largest ≤ 3,000 km | 36 / 30 / 46 % — 12–17 Mkm² |
| 26 cratons, largest ≤ 3,000 km | 38 / 51 / 39 % — 7–27 Mkm² |

No trend: the seeds differ more than the settings. What works the land is how often it breaks up and collides — 13–16
rifts in 600 Myr, only 3–8 plates alive at a time, continents few and huge (the largest 75–140 Mkm²), and a continent
under 18 Mkm² never rifts without a plume. Letting 10 Mkm² continents rift on their own (riftMinContinentKm2 1e7) helped
two seeds of three (22 % / 29 % / 40 %); doubling the rift rate did not help. The developer: "the changes we are making
to craton behavior will do more to affect the desired outcome than the changes to number of cratons". So Phase 10 is B;
the untouched-land targets (≤ 25 %, largest patch ≤ 8 Mkm²) move to Phase 13, where breakups come in bursts — with the
rift threshold as a lever to try there.

### B. Cratons: their edges against the ranges, and their look

**What goes wrong now** (history scene at 300 and 600 Myr, India scene; 51 of 775 craton-edge cells at 600 Myr have
ground > 1.5 km higher within 250 km). A belt cannot enter a craton (orogeny.js) and the uplift's hillslope smoothing
stops at it (heights.js), so:
1. a range pressed against a craton ends in a **wall along the craton's outline — the sim mesh's 121 km staircase**,
   drawn into the terrain;
2. **no foreland**: the flat shield (cratonKm 0.28) runs right up to the foot of the range;
3. **small craton scraps** (a few cells) read as flat, stair-edged holes inside mountain belts;
4. **interiors are blank and all alike**: one flat platform, a start swell at half strength that has worn away by
   ~400 Myr.

**How real cratons meet ranges and what they look like** (read for this plan):
- Cratons are rigid: deformation piles up against them and goes around them, and it concentrates at their margins,
  where the lithosphere steps from thick to thin. Around the Tarim block 94–100 % of the Cenozoic shortening sits in
  the ranges along its margins, with a few basement-cored uplifts inside; the block itself is a low basin ringed by
  ranges. A craton hemmed in by ranges is right; the problem is how the edge is drawn.
- The thrust front follows the craton's margin at the scale of its **promontories and embayments**, not finer: the belt
  reaches farther onto the craton, and wider, in embayments (salients — with the deepest foreland) and is narrow at
  promontories (recesses — basement massifs in the belt). Transform offsets of the old margin become transverse zones
  (Thomas 1977, 2006).
- A stiff craton (effective elastic thickness 80–90 km) bends under a range's weight into a **wide, shallow foreland**
  (Watts 1992): a **foredeep 100–300 km wide**, filled to a lowland of megafans with an **axial trunk river parallel to
  the range**, fed from both sides (the Ganges, between the Himalaya and the Bundelkhand craton: megafans over 150 km
  long), then a **forebulge 60–470 km wide and only tens to a few hundred metres high** — often buried, or broken into
  arches (DeCelles & Giles 1996). So the range's foot is a lowland, lower than the shield beyond it.
- Where a plateau's edge meets a rigid block, the front is abrupt: the Longmen Shan drops ~4 km over 30–50 km to the
  Sichuan Basin (Yangtze craton), with little shortening. **A steep front is right for an upper plate's plateau edge; a
  foreland is right where the craton is the lower plate.**
- Shield interiors are calm but not blank: **basins and swells 1,000–2,000 km apart** (Africa's heights have two modes,
  300–400 m and 900–1,100 m); **saucer-shaped sag basins** from 400 km (Williston) to 1.4 Mkm² (Congo), separated by
  basement arches; a **dome-and-keel grain** — granite domes 50–100 km across between curvilinear greenstone belts; most
  of the Canadian Shield a rolling upland under 600 m. Knob-and-lake terrain and inselberg fields lie below our grid.

**Build** (the rim belts change the history — see the decisions below; the rest is terrain only):
1. **The craton's edge is a line, not cells.** A signed distance to the craton's edge, measured on each plate's own
   raster (as the coast is since Phase 9), moved in and out by noise (as the coastline's bays and headlands are): the
   range front and the shield's platform follow that line, and craton scraps smaller than ~50,000 km² blend into what
   surrounds them. Salients and recesses come from the history's own belt shapes; nothing traces the cells.
2. **The range tapers at the line, and a foreland bends into the craton.** A flexural profile on the craton side: a
   foredeep lowland 100–300 km wide (its width from a stiff plate's flexural parameter, its depth from the load of the
   range beside it, filled to a low plain), rising to a low forebulge (≤ ~0.2 km), then the shield. It goes on the lower
   side of a collision and behind an Andean range; where a plateau's edge meets the block, the front stays steep. The
   carving should then find the trunk river along the front by itself.
3. **Cratons with characters.** Each craton (keyed by its terrane id, a stream of its own) takes a long-wavelength
   shape: a sag basin (a low interior plain), a swell (a high shield plateau, up to ~1 km), or a flat shield; plus a
   faint grain of domes and keels (~70–100 km, tens of metres to ~150 m). Still the calmest ground on the planet.

**Decided with the developer (2026-09-26)**
- **Belts reach a little onto the craton's rim in the history** ("yes that is great"): a thin-skinned fold-thrust belt
  over the craton's edge, as in the sub-Andean zone and the Canadian Rockies' foothills — low relief, no thickening of
  the shield itself; the craton's core stays impassable. This changes histories (re-baselined with reasons, as A does).
- **Craton characters in between** ("in between, we can tweak that later"): swells up to ~0.5 km above the shield,
  sag basins down to ~0.1 km — not the subtle ±0.2 km nor a Kalahari-like 1 km plateau; a lab slider for their strength.

**Status: accepted 2026-09-26 (developer: "ok that is good"; "close and commit 10") — check-phase10 (8), lab scene
"Ranges against cratons".** Built: the rim belts (tectonics/step/orogeny.js; the events of
every history unchanged, only its records and heights), the edge line, the foreland and the characters
(terrain/cratons.js). Measured at pressed edges (history, 600 Myr, median across every kind of front): the drop from the
range to the shield spread over ~160 km instead of ~120; the ground 80–200 km in ~0.1 km below the shield beyond (none
before); craton medians spread 0.21–0.24 km apart (0.07–0.13 before); relief within cratons ×1.6. In the craton scene:
India's shield bent 0.15 km down before the range (Asia's, behind the plateau, 0.04 — a steep front). Craton scraps: median
gap to their surroundings 0.01 km; the worst (0.77 km, 1.27 before) is the tip of a shield hidden in a collision's overlap —
the weld's geometry, for Phase 11 (as is the weld's redraw moving crust under rim records, up to ~280 km in). Terrain at
640K 1.96–2.08 s across runs (an exact early exit, heights byte-identical).

**Definition of done**
- Lab: a craton terrain scene (a collision with a craton on the lower plate, and a plateau's edge against a craton)
  plus the history scene; checklist items: the range front follows the craton's large shape but never its cells; a
  lowland foreland with a river along the front; a plateau edge against a craton stays steep; cratons differ from one
  another; small craton scraps don't show as holes.
- Checks (history scene, 3 seeds, 300 and 600 Myr, 640K; baselines measured first and written into the check):
  - wherever a range ≥ 1.5 km abuts a craton on its lower side, the ground 50–200 km inside the craton is lower than
    the shield 400–600 km in (a foredeep), and the steepest slope lies in the range, not at the craton's edge;
  - craton scraps under 50,000 km² sit within the height range of the ground around them;
  - relief within cratons at least 1.5× now, but still below the relief of ordinary lowland;
  - craton median heights differ from craton to craton (spread ≥ 0.15 km);
  - the rim belts: every suite passes, histories re-baselined with reasons; the terrain parts leave the history unchanged
    (hash); 640K terrain ≤ 2.1 s; the same look at 160K, 640K and 2.5M.
- Order: the rim belts first (they change every history), then the edge line, the foreland and the characters (terrain).

Sources: DeCelles & Giles 1996, *Foreland basin systems*, Basin Research 8; Thomas 2006, *Tectonic inheritance at a
continental margin*, GSA Today 16(2) (and Thomas 1977, AJS); Watts 1992, Basin Research 4; Godard et al. 2009 and
others on the Longmen Shan; the Tarim regional overview (Earth-Science Reviews 2019); Burke's African basin-and-swell;
the Pilbara dome-and-keel (Sandiford et al. 2004); Crosby et al. 2010 (Congo Basin).

## Phase 11 — Natural collisions

*Goal:* collisions that close oceans — continents pivot about their first contact and keep converging, closing the gap
like a zipper, so few seas are sealed in and assemblies are compact, not rings and snakes; fewer, shorter island-arc
chains.

1. **Contact as a pivot, not a lock.** In the torque balance, a land-on-land contact resists the CONVERGING part of the
   relative motion (as a trench resists along its normal) with only a weak drag along it — not the whole relative
   velocity. Slab pull from the lower plate's remaining trenches then turns it about the contact, and the rest of the
   margin closes.
2. **Weld when the seam has closed, not at first contact.** A pair welds once the sea between the two facing coasts is
   narrow along most of the front (or, as a fallback, after a long time locked together) — not after a fixed shortening
   or contact time with the ocean beyond still open.
3. **Remnant seas close.** Ocean crust sealed inside one plate (after a weld, a docking, a captured wing) shrinks from its
   margins at a closing rate (inward thrusting, ophiolite obduction) — so a remnant sea lives some tens of Myr, and only
   a few, small, young ones exist at a time (the Mediterranean, the Black Sea).
4. **Island arcs.** Fewer, shorter, more segmented chains: arc crust only along a trench's mature parts, and small
   pieces recycled or accreted sooner. The arcs on trenches stay (the Aleutians, Indonesia).
5. **The weld's redraw** (indentation and escape) is checked for long tongues of land: none should come out snake-like.
6. **Stale belt positions fixed at the source** (from Phase 9B): ~1.8 % of belt crust cells carry a distance across
   their belt far from their neighbours' (174 of 9,632 at 600 Myr) — 104 stamped in the same step as their neighbours
   (most likely the weld's repainting of the seam: trace one through the weld first to confirm), 68 left from an older
   stamp a belt front that moved on no longer reaches (orogeny.js spreadBelt — Andean belts too, not only collisions).
   Fixed in the rewritten weld and in spreadBelt; the terrain's repair (records.js, the "donut" fix) stays as a guard.

**Definition of done**
- Lab — a new "zipper" scene: two continents meeting at an angle close the ocean between them after first contact,
  pivoting, and weld along ≥ 70 % of their shared margin, with no sea over 0.5 Mkm² left between them; checklist item.
- History (3 seeds, 600 Myr, every 50 Myr):
  - enclosed seas over 0.5 Mkm²: **≤ 3 at a time, none over 3 Mkm²**, all enclosed seas together ≤ 5 Mkm² (now up to
    73 Mkm²);
  - no continental landmass over 5 Mkm² with thinness below 0.35; the largest landmasses' median thinness ≥ 0.5;
  - island-arc pieces **≤ 30** at a time (now 34–85), fore-arc isles ≤ 10 — arcs still stand along trenches.
- Belt positions: **0** stale cells in every frame of three seeds; the terrain-side repair becomes a guard that never
  fires (kept, with a check that it does not).
- The India scene still collides and builds its plateau; plate speeds stay in WBP's bands (Phase 4); every suite
  passes, histories re-baselined with reasons.

## Phase 12 — Sim resolution test

*Goal:* see whether a finer plate stage looks better (less blocky) and what it costs, then choose.

- Run the same seeds at 40K (121 km, now), 80K (~86 km) and 160K (~60 km) sim cells. Everything is in km and Myr
  (check-scale covers the tectonics), so the planet should be the same planet, finer.
- Compare: history time; the Phase 11 shape measures; belt widths and heights; coastline blockiness; the terrain side
  by side in the lab.
- Note: some of the "blockiness" was the terrain's distance bug (fixed 2026-09-26: coast distances, belt directions) —
  compared after that fix.

**Definition of done**
- The lab can build a history at 40K / 80K / 160K sim cells (a setting), and a comparison — screenshots and the
  numbers above — is shown to the developer; the default is chosen from it.
- Measured: 80K ≈ 1.8× the history time of 40K (51 s vs 28 s for 600 Myr); 160K to be measured.
- If the default changes: every suite passes at it, check-scale holds, and 600 Myr stays within a time budget agreed
  here (e.g. ≤ 60 s — speed work proper is in the full-planet phase).

## Phase 13 — Supercontinent cycle

*Goal:* the WBP cycle — a supercontinent breaks up in a burst of rifts, the pieces drift through a quiet spell, and they
reassemble into a new supercontinent, which in time breaks up again.

- Breakup comes in bursts: the chance of rifting grows with the supercontinent's tenure and the heat insulated under it
  (mantle heat), then falls away once it is broken up.
- Reassembly by ocean closure — introversion (the young interior ocean closes) or extroversion (the old outer ocean
  closes) — through subduction starting at old passive margins (6b) and the zipper collisions of Phase 11 (so the new
  supercontinent is compact, not a ring).
- Breakups follow old sutures and belts (the Wilson cycle: the Atlantic reopened along the Appalachian suture).
- A history can be asked to end in a stage: breakup, dispersal or assembly.

**Definition of done**
- Lab: a chart of the landmass count and the largest landmass's share of continental crust through time; a 1000 Myr
  history scene; the end stage as a scene option; checklist items.
- Three seeds, 1000 Myr: at least one full cycle — supercontinent (largest landmass ≥ 70 % of continental crust) →
  breakup in a burst (≥ 3 rifts within 60 Myr) → dispersal (largest ≤ 40 %) → reassembly (≥ 70 % again), a cycle of
  300–700 Myr.
- ≥ 60 % of rift length follows old sutures or belts; the reassembled supercontinent has thinness ≥ 0.5 and no enclosed
  sea over 3 Mkm².
- Untouched land (from Phase 10): undisturbed continental crust **≤ 25 %** at 600 Myr (30–46 % now) and the largest
  untouched patch **≤ 8 Mkm²** (10–18 now), three seeds — breakups in bursts should get there; the rift threshold
  (riftMinContinentKm2 → 1e7 helped two seeds of three) is a lever to try.
- Every suite passes, histories re-baselined with reasons.

## After phase 13: the full planet

V2 in the real app: projection to V1's render mesh, V1's erosion and climate (wind, currents, Köppen) on V2 terrain,
the app UI, planet codes, export, mobile — and speed (the history's time; showing the world as it evolves). V1 stays
beside it, with its plate editing.

## Parked

- Heights feeding the history — a height ceiling that turns into width (plateaus), belt shape by climate (critical
  taper), wider Andean belts. Not critical (developer).
- Sediment from the history's rivers deciding which margins accrete and which erode.
