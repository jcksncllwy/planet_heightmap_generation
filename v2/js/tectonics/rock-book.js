// The rock book (lane rockbook, review U2): every km³ of continental and arc crust, the relief it carries and the sediment
// laid on it is in one record, and a stage that makes or removes rock books the flow, by name, in km³, to world.budget —
// the same counters the rivers' and trenches' sediment books already keep (riverSupplyKm3, riseKm3, …). What the record
// holds is step/crust-ledger.js rockParts; check-invariants.mjs holds each stage's change in it to the flows it booked.
// A step's code that has no world in hand (orogeny.js spreadBelt, called from boundaries, collisions, rifts, welds and
// accretions) books to the ACTIVE book, which simulate.js points at its world's budget before each stage: the stages of
// one history run in order on one thread, and a second history interleaved with it (a generator stepped by turns) is
// pointed back at its own before its next stage.
//
// The flows named here (km³; + makes rock, − removes it):
//   beltRootKm3     crust a belt's root gained (continent or arc) (or lost) — UNPAID: the rigid upper plate loses no area for it, so the
//                   shortening that should pay for it is not taken from anywhere (review row 10, "belts from shortening")
//   beltReliefKm3   the crust behind a belt's relief (uplift ÷ column slope, measure.js crustThicknessKm) — UNPAID likewise
//   arcRootAddedKm3 (config.crustPaidRelief) the root an Andean, Laramide or arc belt gained under its arc-magmatism cap
//                   (arcAdditionKm3PerKmMyr): a mantle source, paid — what beltRootKm3 was for those belts (lane crustmass S1)
//   arcAddedKm3     magma a fed arc gained, and a new arc's crust less the floor sediment it buries (step/wings.js buildArcs)
//   arcMaturedKm3   an arc welded on as continent: its rock as continent less as arc — the floor at an ordinary continent's
//                   crust, ARC_ROOT_SHARE of its root kept (step/arc-maturation.js)
//   isleMergedKm3   …the same for a fore-arc island joining its coast; isleRaisedKm3 the island the prism raises, less the
//                   floor sediment under it; marginErodedKm3 the coast an erosive margin eats (step/margin-isles.js)
//   prismAccretedKm3 (config.prismAccretion) the trenches' scraped-off rock laid on a fore-arc as continent, or stacked under
//                   its land (step/prism-accretion.js; it left the books as riseKeptKm3 / seaFillKeptKm3 / fanKm3)
//   arcRecycledKm3  thin arc going down a trench, or with its slab at a collision (step/resolve.js, step/collision.js)
//   arcCollapseKm3  an arc landing on its coast: the floor sediment it lands on (ops/collapse-arc.js)
//   collisionConsumedKm3  rock a collision takes off the map — the lower plate's edge underthrust, a weld's overlap and
//                   the sea it seals; collisionKeptKm3 what keepConsumed lays back as thickness (step/collision.js): their
//                   sum is the collision's loss (collisionLostShare, and the unplaced)
//   shortenedKm3    (< 0) an Andean margin's edge shortened away; shortenKeptKm3 what step/andean-shortening.js lays back as
//                   its belt's root: their sum is the unplaced (normally 0)
//   collapseNetKm3  orogenicCollapse's rock change (≈ 0: a quiet belt's root moved into the continental cell it makes on its
//                   coast, step/orogenic-collapse.js; the sea floor's sediment stays on the new cell)
//   movedLostKm3    a piece moved to another plate: land with no room left on its host, the host's floor sediment it
//                   buries (ops/tidy-plates.js transferCells, ops/scrape-arc.js, ops/accrete-terrane.js)
//   givenBackLostKm3  cells handed back to the passive ocean: their crust, the rivers' rock on them going with them
//                   (ops/tidy-plates.js giveToBackground)
//   fillWornKm3     a hollow's fill worn away with its land — not handed to the rivers (step/heights.js)
//   arcAgeingKm3    a hand-laid arc's measure thickening with its age: a term of the measure, booked only while the
//                   volume ledger runs (simulate.js; crust-ledger.js handLaidArcKm3)
// Each of these is the cell's rock after less before, in crust-ledger.js cellRockKm3 — the record's own measure — so a
// book cannot drift from what it books. The rivers' and trenches' sediment counters (riverSupplyKm3, basinFillKm3,
// seaFillKm3, seaOverflowKm3, shelfKm3, fanKm3, riseKm3, riseDownKm3, …) are the rest of the book; which stage may book
// which is tools/lib/volume-books.mjs STAGE_FLOWS (crust-report.md "rockbook").

let active = null;

/** Point the book at a world's budget (simulate.js, before each stage). */
export function useRockBook(budget) { active = budget; }

/** Book `km3` of rock to flow `name` in the active book (nothing when no history is running: a start world's build). */
export function bookRock(name, km3) { if (active && km3) active[name] = (active[name] ?? 0) + km3; }
