// The history's helpers (app/helper-pool.js: the start world's layout attempts and each rift's junction searches, side by
// side in worker threads) are a speedup only: a history run with them is the history run without, every frame the same
// by value (lib/frame-hash.mjs), the same steps. No other suite runs a history with helpers — every tool calls simulate()
// with none — so when cratoncol made the rift's search read a key outside config.rift… (a craton's strength,
// field/stress-step.js cratonStrengthRatio) the helpers, sent only config.rift…, got NaN for it and their histories
// parted from 240 Myr on seed 243751, unseen for two weeks (pagemem2, 2026-11-27). Two of the page's worlds ('cycle'
// scene), built and run each way; the check also asks that the helpers did search some rifts (else it proves nothing).
// Usage: node v2/tools/check-history-helpers.mjs   (~3 min; needs a GPU — Dawn — as every history)
process.env.GEO_SIM_HISTORY_CACHE = '0';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import './gpu-harness/history-dawn.mjs';
import { check, section, finish } from './lib/check-kit.mjs';
import { frameHash } from './lib/frame-hash.mjs';
import { pageWorld, DEFAULT_CONT } from './lib/moment-frame.mjs';
import { simulate } from '../js/tectonics/simulate.js';
import { HelperPool } from '../js/app/helper-pool.js';

setDelaunator(Delaunator);
const CELLS = 10000, MYR = 600, EVERY = 10;
// (243751: Jackson's world, whose first rift through a craton came at 240 Myr on 40K cells; 12345: the lab's)
const WORLDS = [243751, 12345];

const helpers = await HelperPool.create(pageWorld({ seed: WORLDS[0], sim: CELLS }).world.mesh, 3);
let searches = 0, layouts = 0;
const counted = {
    get size() { return helpers.size; },
    searchJunctions: (w, job) => { searches++; return helpers.searchJunctions(w, job); },
    layoutAttempts: (...a) => { layouts++; return helpers.layoutAttempts(...a); },
};
async function run(seed, withHelpers) {
    const { scene, world: plain } = pageWorld({ seed, sim: CELLS });
    // (with helpers, the start world too is built as the history's worker builds it: its layout attempts side by side)
    const world = withHelpers ? await scene.buildAsync(plain.mesh, seed, { continentalFraction: DEFAULT_CONT / 100 }, counted) : plain;
    world.config.heights = plain.config.heights;
    const hashes = [];
    const r = await simulate(world, { untilMyr: MYR, drive: w => scene.drive(w), snapshotEveryMyr: EVERY, keepFrames: false, onFrame: f => hashes.push([f.time, frameHash(f)]) }, withHelpers ? counted : null);
    return { hashes, steps: r.steps };
}
for (const seed of WORLDS) {
    section(`seed ${seed}, ${CELLS} cells, ${MYR} Myr: with helpers (${helpers.size}) and without`);
    const s0 = searches, l0 = layouts;
    const a = await run(seed, false), b = await run(seed, true);
    const part = a.hashes.findIndex(([t, h], i) => !b.hashes[i] || b.hashes[i][0] !== t || b.hashes[i][1] !== h);
    check('every frame the same, by value, and the same steps', part < 0 && a.hashes.length === b.hashes.length && a.steps === b.steps,
        `${a.hashes.length} frames vs ${b.hashes.length}, ${a.steps} steps vs ${b.steps}` + (part >= 0 ? `; first parting at ${a.hashes[part][0]} Myr` : `; last ${a.hashes.at(-1)?.join(' ')}`));
    check('…and the helpers did the work (rift searches and the start world\'s layout attempts)', searches > s0 && layouts > l0, `${searches - s0} rift searches, ${layouts - l0} layout batches`);
}
helpers.terminate();
finish('history-helpers');
