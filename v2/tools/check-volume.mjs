// The rock-volume books over a history (coast9, 2026-11-05): a REPORT, not a check — no hard line here yet. It closes the books
// on rock: for each stage of a step, the continental and arc crust made or lost (area, and volume), the rock the heights wore
// off the crust, and where the rivers set it down — and what is left in no book. It exists to make the crust lane's erosion leak
// (~4 Gkm³ of worn rock a cycle that lands nowhere, crust-report.md) a number a run prints, so the fix can be seen to close it.
// The stages are read generically from the crust ledger (tools/lib/volume-books.mjs): a stage another lane adds appears by itself.
// Usage: node v2/tools/check-volume.mjs

import { report, section, finish } from './lib/check-kit.mjs';
import { volumeBooks, closure } from './lib/volume-books.mjs';

const SEEDS = [12345], MYR = 1200;
const f1 = v => (Number.isFinite(v) ? v.toFixed(2) : String(v));

section(`rock volume over the supercontinent cycle (${MYR} Myr, per 1200 Myr)`);
const runs = SEEDS.map(seed => ({ seed, ...closure(volumeBooks({ seed, myr: MYR }), 1200) }));
const stageNames = [...new Set(runs.flatMap(r => Object.keys(r.stageGkm3)))];
// (a stage that booked nothing in volume or area is named once, not reported: 37 lines of zeros hid the books)
const booked = name => runs.some(r => Math.abs(r.stageGkm3[name] ?? 0) > 0.005 || r.cells[name]?.land || r.cells[name]?.arc);
for (const name of stageNames.filter(booked))
    report(`volume booked by stage ${name}, Gkm³ per cycle`, runs.map(r => r.stageGkm3[name] ?? 0), { digits: 2, detail: `area ${runs.map(r => `${r.seed}: ${Math.round(r.cells[name]?.land ?? 0)} cells of continent, ${Math.round(r.cells[name]?.arc ?? 0)} of arc`).join(' · ')}` });
console.log(`(stages that booked nothing: ${stageNames.filter(n => !booked(n)).join(', ') || 'none'})`);
report('rock worn off the crust by the heights, Gkm³ per cycle', runs.map(r => r.worn), { digits: 2,
    earth: [5, 9], source: 'continental denudation ~12–20 Gt/yr of solids to the ocean ÷ 2.5 t/m³ ≈ 5–8 km³/yr, ×1.2 Gyr ≈ 6–10 Gkm³ per 1200 Myr (Milliman & Syvitski 1992; Syvitski et al. 2005 — recalled, not opened here; the figure depends on the cycle through relief and area)' });
report('rock the rivers carry to the sea, Gkm³ per cycle', runs.map(r => r.supplied), { digits: 2, detail: 'rivers.js riverSupplyKm3; with rockBook on it should equal the rock worn off the crust' });
for (const key of Object.keys(runs[0].sinks))
    report(`…set down: ${key}, Gkm³ per cycle`, runs.map(r => r.sinks[key]), { digits: 2 });
report('…set down, all books, Gkm³ per cycle', runs.map(r => r.placed), { digits: 2 });
report('worn rock in NO book (worn − set down), Gkm³ per cycle', runs.map(r => r.unbooked), { digits: 2, earth: [0, 0.5], source: 'a closed book is ~0: mass is conserved, so what the crust loses lands in a basin, the sea floor or the mantle (subduction); 0.5 Gkm³ allows the books\' rounding (a cell-column\'s fill is booked in whole steps)', detail: `${runs.map(r => `${r.seed}: ${f1(r.unbooked)} of ${f1(r.worn)} worn = ${f1(100 * r.unbooked / r.worn)} %`).join(' · ')}; the rivers\' own supply less what is set down: ${runs.map(r => f1(r.suppliedUnbooked)).join(' · ')}` });
finish('Volume');
