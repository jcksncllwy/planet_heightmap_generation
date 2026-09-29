# Evolution performance — plan and status

Started 2026-09-28. Developer: "Lets do the multi core, and the tuning round now" … "i am most curious about the 160 and
2.5m detail. so we should see how we make that fastest (improving 40k im sure helps too)" … "keep trying to optimize
after this. After that pass, identify the areas that are still expensive and propose (but do not implement) ways to
approximate them while shaving off a large portion of time". Rule for the pass: the same output, faster — no lower
resolution or quality ("20k as default is not an [optimization]. its a crutch"); every change proven by hashes.

The machine: AMD Ryzen 7 9800X3D — **8 cores, 16 threads** (not 16 cores). Timings are noisy run to run (one baseline
run of the 600 Myr history took 49 s, the next 40 s): the numbers below are the best of alternating runs.

## The exact pass (done, uncommitted) — outputs byte-identical

Verified by hashes: four histories (40K 600 Myr seed 12345, 40K 300 Myr seed 777, 80K 150 Myr seed 4242, 20K 400 Myr
seed 99 — every frame's arrays and plate rotations, and the event log) and the terrain pool's output at 160K / 640K /
2.5M (surface, carving inputs, sampler, carved heights, drainage, hillshade).

**History** (40K 600 Myr: 39.7 → 36.1 s, **−9 %**; 80K 200 Myr: 24.5 → 22.6 s, −8 %):
- the supercontinent push: pairs of plates as numbers, not strings built per call; continents clearly out of reach
  skipped before the arc-cosine;
- the world view: each plate's nearest crust found once per point (it was looked up twice), gap candidates marked in an
  array (not a Set);
- contact normals: each neighbour's unit direction computed once per mesh;
- forces: no array per cell; loads by plate id;
- arc collapse: working arrays kept between calls; "sea on the way in" found during the distance search (it walked
  every path again);
- plate pieces: the working array kept; margin islands: the erosion noise (a fixed field on the mesh) computed once per cell;
- distance searches (spreadKm, the history's and the terrain plan's): each edge's length computed once per mesh.

**Terrain** (per frame: ~5 % at 160K; 2.5M playback 1.26 → 1.11 s a frame with the second carving worker):
- the plan's near-lists built without 40,000 small arrays (pairs sorted by cell);
- a second carving worker for the finest terrain (frames carved side by side) — at 2.5M only: at 640K it was slower.

**Tried and reverted:** every synthesis worker planning the frame itself (instead of one planning and handing a 25 MB
plan to the others): slower — eight plans at once contend on 8 cores. More synthesis workers than cores (15 on this
16-thread CPU): slower at every size — the heights are noise arithmetic, which a core's second thread barely helps.

## Multi-core history — assessed, not built

The history steps one after another; within a step the work is spread over dozens of rules (the biggest, the world
view's gather, is 11 %). The parts that could run on several cores without changing a single bit — the gather's
lookups, gap growth, boundary and force loops, heights, rivers, frame capture and packing (sums kept in their order) —
are ~35–40 % of a step. On 8 cores, with six helpers, that is ~1.3× at best while nothing else runs — and less while the
page is building terrain (its 8 synthesis workers use the same cores: that is when you are watching). Its cost: most of
the engine's hot loops rewritten over shared memory, and the page cross-origin isolated (GitHub Pages cannot send the
headers: a service worker would, on every page of the site). Recommendation: not now; the approximations below give more.

## Still expensive (after the pass)

| | cost | where it goes |
|---|---|---|
| the history, 40K | ~36 s / 600 Myr (~72 s for 1200); ~46 ms a step, 782 steps | the world view rebuilt twice a step (gather + resolve ≈ 35 %), boundaries and forces (~10 %), rifting (~8 %), heights and rivers (~7 %), arcs, margin islands, tidying (~10 %), frames (~5 %) |
| the history, 160K plates | ~4× a step, ~2× the steps: ~8× the 40K history | the same rules |
| a frame at 160K terrain | ~0.4–0.5 s | the plan ~0.2 s (one worker; the others wait), handing it out ~0.1 s, the heights ~0.1 s, carving 0.1 s |
| a frame at 2.5M terrain | ~1.1 s playing ahead (2 carvers), ~2 s asked for alone | the heights ~0.9 s (noise: ~50 evaluations per land cell), carving ~1.0 s (one priority flood over 2.5M cells), the plan 0.2 s |

## Proposed approximations (not implemented — the developer's call)

**History**
1. **Longer steps** — a plate edge may move ~2 cells a step instead of ~1–1.5 (growth reach and gap rules widened to
   match): about half the steps, **~40 % off the history**. Risk: coarser collision timing and ridge jitter; the phase
   checks would need re-running and some re-tuning.
2. **Slow rules less often** — heights and erosion, rivers, margin islands, arc collapse, tidying, the rift search and
   the supercontinent's bookkeeping every 2–5 Myr (with their dt scaled) instead of every ~0.8 Myr step: **~20 %**.
   Risk: events shift by a step or two; rifts found a little later.
3. **World view by bands** — rebuild ownership only in a band around plate edges each step (interiors keep their owner;
   their crust records refreshed every few steps, and fully after any event): **~20–25 %**. Risk: interior records
   (crust age, belt records) lag a few steps.
Together (1 + 2 + 3): roughly **2–2.5× faster** — 1200 Myr at 40K in ~30 s instead of ~72.

**Terrain**
4. **Plan reuse** — build the full plan (coasts, belts, kernels, volcanoes) every 30–50 Myr and, between, carry it on
   the plates' current rotations (it is anchored to the plates): the plan's 0.2 s + 0.1 s hand-out mostly gone —
   **~50–60 % off a 160K frame**. Risk: features at active boundaries (new ridges, trenches, collisions) lag up to the
   reuse interval; seams where crust was created or destroyed.
5. **Octaves the terrain can show** — skip noise octaves finer than ~2 terrain cells (invisible, aliased at 160K):
   **~25–40 % off the heights at 160K**, less at 2.5M (whose cells resolve them). Risk: a slightly smoother look where
   the aliasing read as texture.
6. **Carve coarser while playing** — carve at 640K and carry the valleys onto 2.5M while the timeline plays; the full
   carve when paused and for exports: **~45 % off a 2.5M frame while playing**. Risk: the smallest streams missing in
   motion.
7. **Progressive detail while playing** — at 2.5M, play at 640K terrain (upsampled) and build the 2.5M frame when
   paused, as the sharper texture already does: **~70 % off 2.5M playback**; the frame you stop on, and every export,
   full detail. Risk: softer terrain in motion.

**Not an approximation, but the big lever for 2.5M:** the heights on the GPU (WebGPU compute: noise is ideal for it) —
~10–30× faster heights; float32 instead of float64, so heights differ below a metre (invisible; exports not
bit-identical with today's); a large port (the whole surface synthesis), with the CPU path kept for browsers without
WebGPU.
