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
//   beltRootKm3     crust a belt's root gained (or lost) — UNPAID: the rigid upper plate loses no area for it, so the
//                   shortening that should pay for it is not taken from anywhere (review row 10, "belts from shortening")
//   beltReliefKm3   the crust behind a belt's relief (uplift ÷ column slope, measure.js crustThicknessKm) — UNPAID likewise
// …and the ones other files book where their process runs (see crust-report.md "rockbook").

let active = null;

/** Point the book at a world's budget (simulate.js, before each stage). */
export function useRockBook(budget) { active = budget; }

/** Book `km3` of rock to flow `name` in the active book (nothing when no history is running: a start world's build). */
export function bookRock(name, km3) { if (active && km3) active[name] = (active[name] ?? 0) + km3; }
