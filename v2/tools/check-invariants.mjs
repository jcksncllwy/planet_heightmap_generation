// Engine invariants that hold in EVERY history, whatever the phase: checked step by step through whole start-world
// histories on more than one seed. Not tied to a phase — run it after any engine change.
// Usage: node v2/tools/check-invariants.mjs

import { check, section, finish, labMesh } from './lib/check-kit.mjs';
import { MARGIN_SCENES } from '../js/tectonics/scenarios/margin-scenes.js';
import { simulate } from '../js/tectonics/simulate.js';
import { CrustRaster, CrustType, CELL_FIELDS } from '../js/tectonics/model/crust.js';
import { TECTONICS, MECHANISMS } from '../js/tectonics/config.js';

const SEEDS = [12345, 777, 592250];     // (592250: the developer saw two rift halves driven back through each other there)
const HISTORY_MYR = 600;                 // longer than a phase scene: long histories are the point (1000–2000 Myr planned)
const MAX_LAND_DROP_PER_STEP = 0.01;     // land is never deleted: a step may lose at most this share of it (belts absorb a little)
const BIG_OVERLAP_KM2 = 1e5, MAX_BIG_OVERLAP_MYR = 40;      // two plates' land may overlap this much for at most this long before it welds
const mesh = labMesh();

section('the crust raster and the config');
{
    const r = new CrustRaster(4);
    const arrays = Object.keys(r).filter(k => ArrayBuffer.isView(r[k]) && k !== 'mask');
    const missing = arrays.filter(k => !CELL_FIELDS.includes(k));
    check('every per-cell array of a CrustRaster is in CELL_FIELDS (so create / copyFrom / snapshot handle it)', missing.length === 0,
        missing.length ? `missing: ${missing.join(', ')}` : `${arrays.length} arrays, all listed`);
    const history = MARGIN_SCENES.find(s => s.id === 'history'), w = history.build(mesh, SEEDS[0]);
    check('each world gets its own copy of the config, nested groups included', w.config !== TECTONICS && w.config.belts !== TECTONICS.belts && w.config.belts.andean !== TECTONICS.belts.andean,
        'world.config and world.config.belts are copies');
    const unknown = Object.values(MECHANISMS).flatMap(Object.keys).filter(k => !(k in TECTONICS));
    check('every mechanism off-switch names a real config key', unknown.length === 0, unknown.length ? `unknown: ${unknown.join(', ')}` : `${Object.keys(MECHANISMS).length} mechanisms`);
}

for (const seed of SEEDS) {
    section(`a whole history, seed ${seed}`);
    const scene = MARGIN_SCENES.find(s => s.id === 'history'), world = scene.build(mesh, seed);
    const landOf = w => { let n = 0; for (const p of w.plates) if (p.alive) { const { mask, type } = p.crust; for (let c = 0; c < mask.length; c++) if (mask[c] && type[c] !== CrustType.OCEAN) n++; } return n; };
    const cratonIds = Object.keys(world.terraneLetters ?? {}).map(Number);
    let prevLand = landOf(world), worstDrop = 0, worstAt = 0, deadWithCrust = [], maxTerrane = 0, lostCratonAt = null;
    const overlapSince = new Map();          // plate pair → since when its land has overlapped by more than BIG_OVERLAP_KM2
    let biggestOverlap = { cells: 0 }, longestOverlap = { myr: 0 };
    simulate(world, {
        untilMyr: HISTORY_MYR, snapshotEveryMyr: 50,
        drive: w => {
            scene.drive(w);
            // after the previous step's events and view rebuild:
            const land = landOf(w), drop = (prevLand - land) / prevLand;
            if (drop > worstDrop) { worstDrop = drop; worstAt = w.time; }
            prevLand = land;
            for (const p of w.plates) if (!p.alive && p.crust.count > 0 && !deadWithCrust.includes(p.name)) deadWithCrust.push(`${p.name} (${p.crust.count} cells at ${w.time.toFixed(0)} Myr)`);
            maxTerrane = Math.max(maxTerrane, w.lastTerraneId);
            // land-on-land overlap per pair of plates: never beyond the weld's own threshold, never big for long
            const pairs = new Map();
            for (let x = 0; x < mesh.numCells; x++) if (w.landClaims[x] > 1 && w.collider[x] >= 0) { const a = w.owner[x], b = w.collider[x], k = a < b ? `${a}:${b}` : `${b}:${a}`; pairs.set(k, (pairs.get(k) ?? 0) + 1); }
            for (const [k, n] of pairs) {
                if (n > biggestOverlap.cells) biggestOverlap = { cells: n, at: w.time, pair: k };
                if (n * mesh.cellAreaKm2 >= BIG_OVERLAP_KM2) { if (!overlapSince.has(k)) overlapSince.set(k, w.time); }
            }
            for (const [k, since] of overlapSince) {
                if (!pairs.has(k) || pairs.get(k) * mesh.cellAreaKm2 < BIG_OVERLAP_KM2) { overlapSince.delete(k); continue; }
                if (w.time - since > longestOverlap.myr) longestOverlap = { myr: w.time - since, pair: k, since };
            }
            if (lostCratonAt === null) {
                const present = new Set();
                for (const p of w.plates) if (p.alive) { const { mask, type, terrane } = p.crust; for (let c = 0; c < mask.length; c++) if (mask[c] && type[c] === CrustType.CRATON) present.add(terrane[c]); }
                const lost = cratonIds.filter(id => !present.has(id));
                if (lost.length) lostCratonAt = `${lost.map(id => world.terraneLetters[id]).join(', ')} at ${w.time.toFixed(0)} Myr`;
            }
        },
    });
    check('land never vanishes: no step loses more than a sliver of it', worstDrop <= MAX_LAND_DROP_PER_STEP,
        `worst step: ${(100 * worstDrop).toFixed(2)} % of the land at ${worstAt.toFixed(1)} Myr (limit ${100 * MAX_LAND_DROP_PER_STEP} %); ${landOf(world)} land cells at the end`);
    check('a plate that is gone holds no crust (nothing was welded onto a dead plate)', deadWithCrust.length === 0, deadWithCrust.join('; ') || `${world.plates.filter(p => !p.alive).length} plates gone, all empty`);
    check('terrane ids stay few: crust keeps its id whichever plate carries it', maxTerrane < 2000, `highest terrane id handed out: ${maxTerrane}`);
    check('no two plates stack land on land beyond the weld threshold', biggestOverlap.cells * mesh.cellAreaKm2 <= 1.5 * world.config.sutureOverlapKm2,
        `largest overlap ${(biggestOverlap.cells * mesh.cellAreaKm2 / 1e6).toFixed(2)} Mkm² (${biggestOverlap.pair ?? '—'} at ${biggestOverlap.at?.toFixed(0) ?? '—'} Myr; weld at ${(world.config.sutureOverlapKm2 / 1e6).toFixed(1)})`);
    check('…and no big overlap lasts', longestOverlap.myr <= MAX_BIG_OVERLAP_MYR, `longest overlap over ${BIG_OVERLAP_KM2 / 1e3}k km²: ${longestOverlap.myr.toFixed(0)} Myr${longestOverlap.pair ? ` (${longestOverlap.pair} from ${longestOverlap.since.toFixed(0)} Myr)` : ''}`);
    check('every craton survives the whole history, with its letter', cratonIds.length > 0 && lostCratonAt === null, lostCratonAt ?? `${cratonIds.length} cratons, all present at ${world.time.toFixed(0)} Myr`);
}

finish('Invariants');
