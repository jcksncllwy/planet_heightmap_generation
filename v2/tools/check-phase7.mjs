// Headless acceptance checks for Phase 7a (hotspots and Large Igneous Provinces).
// Hard checks: a fixed plume draws a continuous, age-progressive track at the plate's speed and bends with it; volcano
// tops sink as the plate under them ages; a plume head floods a continent on arrival with a province in the configured
// size range that rides with it, and its tail links the traps to the plume; the plume sampler draws at its analytic
// weight; the mantle remembers the supercontinent; a plume that rifts is the one that flooded; bookkeeping and replay.
// Reported against Earth: volcano spacing, drowning age, province shape, plume counts, plume-head land/sea split and
// plume rifts.
// Usage: node v2/tools/check-phase7.mjs

import { check, report, section, finish, labMesh, cellsWhere, piecesOf, isConnected } from './lib/check-kit.mjs';
import { PLANET_RADIUS_KM } from '../js/core/sim-mesh.js';
import { tangentToward } from '../js/core/sphere-geom.js';
import { makeRng } from '../../js/rng.js';
import { HOTSPOT_SCENES } from '../js/tectonics/scenarios/hotspot-scenes.js';
import { TECTONICS } from '../js/tectonics/config.js';
import { simulate } from '../js/tectonics/simulate.js';
import { resolve } from '../js/tectonics/step/resolve.js';
import { pickPlumeSite } from '../js/tectonics/step/hotspots.js';
import { buildStartWorld } from '../js/tectonics/init/start-world.js';
import { frameTallies, volcanoTopKm, SEAMOUNT_KM } from '../js/tectonics/measure.js';
import { CrustType, VolcanicType } from '../js/tectonics/model/crust.js';
import { EventKind } from '../js/tectonics/model/world.js';
import { normalize } from '../js/core/sphere-geom.js';

const SEED = 12345, SNAPSHOT_MYR = 2;
const mesh = labMesh(), { numCells, xyz, adjOffset, adjList, edgeKm, cellAreaKm2 } = mesh;
const pos = w => [xyz[3 * w], xyz[3 * w + 1], xyz[3 * w + 2]];
const kmBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * PLANET_RADIUS_KM;
const continental = (f, w) => f.owner[w] >= 0 && (f.type[w] === CrustType.CONTINENT || f.type[w] === CrustType.CRATON);

function run(id, overrides = {}, seed = SEED) {
    const scene = HOTSPOT_SCENES.find(s => s.id === id), world = scene.build(mesh, seed);
    Object.assign(world.config, overrides);
    const { frames, steps } = simulate(world, { untilMyr: scene.maxMyr, drive: w => scene.drive(w), snapshotEveryMyr: SNAPSHOT_MYR });
    return { scene, world, frames, steps, events: world.events, last: frames.at(-1) };
}

/** Spearman rank correlation of two equal-length arrays. */
function spearman(a, b) {
    const rank = xs => { const idx = xs.map((x, i) => i).sort((i, j) => xs[i] - xs[j]), r = new Array(xs.length); idx.forEach((i, k) => { r[i] = k; }); return r; };
    const ra = rank(a), rb = rank(b), n = a.length, mean = (n - 1) / 2;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { num += (ra[i] - mean) * (rb[i] - mean); da += (ra[i] - mean) ** 2; db += (rb[i] - mean) ** 2; }
    return num / Math.sqrt(da * db);
}

section('a plate slides over a fixed plume (Hawaii–Emperor)');
{
    const r = run('hawaii'), { last, scene } = r, H = last.hotspots[0]?.xyz;
    check('one plume, and it stays put in the mantle', !!H && r.frames.filter(f => f.hotspots.length).every(f => f.hotspots.length === 1 && kmBetween(f.hotspots[0].xyz, H) < 1e-6),
        H ? `${last.hotspots[0].name}, at the same mantle position in every frame` : 'no plume');
    const track = cellsWhere(numCells, w => last.volcType[w] === VolcanicType.TRACK && last.owner[w] >= 0);
    const pathKm = scene.speedCmYr * 10 * scene.maxMyr;
    check('the swell it lifts is one continuous ribbon, as long as the plate has travelled', isConnected(mesh, track) && track.length >= 0.8 * pathKm / edgeKm,
        `${track.length} track cells in ${isConnected(mesh, track) ? 'one piece' : 'several pieces'}; the plate travelled ${pathKm.toFixed(0)} km ≈ ${(pathKm / edgeKm).toFixed(0)} cells`);
    // the volcanoes on it come in bursts: the spacing of their centres along the chain, set by the plate's flexure — the next
    // breaks through hotspotSpacingAlpha flexural lengths from the last (ten Brink 1991)
    const volcanoes = track.filter(w => last.volcKm[w] >= SEAMOUNT_KM), edifices = piecesOf(mesh, volcanoes);
    const centreOf = cells => normalize(cells.reduce((s, w) => [s[0] + xyz[3 * w], s[1] + xyz[3 * w + 1], s[2] + xyz[3 * w + 2]], [0, 0, 0]));
    const byAge = edifices.map(e => ({ c: centreOf(e), age: e.reduce((s, w) => s + last.time - last.volcAt[w], 0) / e.length })).sort((a, b) => a.age - b.age);
    const gaps = byAge.slice(1).map((e, i) => kmBetween(e.c, byAge[i].c)).sort((a, b) => a - b);
    report('spacing of the volcanoes along the chain (median, centre to centre)', gaps.length ? gaps[gaps.length >> 1] : NaN,
        { earth: [40, 100], unit: ' km', digits: 0, source: 'Hawaii; flexural spacing ∝ Te^¾ (ten Brink 1991)', detail: `${edifices.length} volcanoes (${volcanoes.length} cells) along ${track.length} cells of swell; cells are ${edgeKm.toFixed(0)} km across; spacing ${r.world.config.hotspotSpacingAlpha} flexural lengths` });
    // each volcano's top sinks once it stops erupting: the floor under it deepens with its age (√age, Parsons & Sclater)
    // and the pile wears down. Followed frame to frame: a pile is known by its plume, eruption time and height
    const tops = new Map();
    for (const f of r.frames) {
        const now = new Map();
        for (let w = 0; w < numCells; w++) {
            const top = f.type[w] === CrustType.OCEAN ? volcanoTopKm(f, w) : null;
            if (top === null) continue;
            const key = `${f.volcSource[w]}|${f.volcAt[w]}|${f.volcKm[w]}`;
            now.set(key, Math.max(now.get(key) ?? -Infinity, top));
        }
        for (const [key, top] of now) (tops.get(key) ?? tops.set(key, []).get(key)).push({ time: f.time, age: f.time - Number(key.split('|')[1]), top });
    }
    let followed = 0, rises = 0, worstRise = 0;
    const drownAt = [];
    for (const seen of tops.values()) {
        if (seen.length < 2) continue;
        followed++;
        for (let i = 1; i < seen.length; i++) {
            const rise = seen[i].top - seen[i - 1].top;
            if (rise > 1e-3) { rises++; worstRise = Math.max(worstRise, rise); }
            if (seen[i - 1].top > 0 && seen[i].top <= 0) drownAt.push(seen[i].age);
        }
    }
    check('each volcano’s top sinks as the plate under it ages — none rises again without erupting', followed >= 10 && rises === 0,
        `${followed} volcanoes followed frame to frame; ${rises} times a top rose (by up to ${(1000 * worstRise).toFixed(0)} m)`);
    const islands = volcanoes.filter(w => volcanoTopKm(last, w) > 0), drowned = [...drownAt].sort((a, b) => a - b);
    report('age at which a volcano drowns (median)', drowned.length ? drowned[drowned.length >> 1] : NaN,
        { earth: [28, 30], unit: ' Myr', digits: 0, source: 'the Darwin Point: Kure, ~28–30 Ma', detail: `${drowned.length} volcanoes seen to drown, ${drowned.length ? `${drowned[0].toFixed(0)}–${drowned.at(-1).toFixed(0)}` : '–'} Myr after their last eruption; ${islands.length} island cells now` });
    const age = w => last.time - last.volcAt[w], dist = w => kmBetween(pos(w), H);
    const rho = spearman(track.map(age), track.map(dist));
    check('the chain is youngest over the plume and older downstream', rho > 0.95, `rank correlation of age with distance from the plume: ${rho.toFixed(3)}`);
    // the young leg (since the bend): distance ÷ age is the plate's speed at the plume
    const young = track.filter(w => age(w) > 3 && age(w) < last.time - scene.bendMyr - 2);
    const rate = young.reduce((s, w) => s + dist(w), 0) / young.reduce((s, w) => s + age(w), 0), expected = scene.speedCmYr * 10;
    check('the chain lengthens at the plate’s speed', Math.abs(rate - expected) < 0.15 * expected, `${rate.toFixed(0)} km per Myr of age along the young leg; the plate moves ${expected} km/Myr`);
    // the bend: at the point that was over the plume when the plate turned, the chain changes direction by the turn
    const bendAge = last.time - scene.bendMyr, B = track.reduce((best, w) => (Math.abs(age(w) - bendAge) < Math.abs(age(best) - bendAge) ? w : best), track[0]);
    const oldest = track.reduce((best, w) => (age(w) > age(best) ? w : best), track[0]);
    const toPlume = tangentToward(pos(B), pos(B), H), toOld = tangentToward(pos(B), pos(B), pos(oldest));
    const bend = 180 - Math.acos(Math.max(-1, Math.min(1, toPlume[0] * toOld[0] + toPlume[1] * toOld[1] + toPlume[2] * toOld[2]))) * 180 / Math.PI;
    const turn = Math.abs(scene.legs[1] - scene.legs[0]);
    check('it bends where the plate turned, by the angle it turned', Math.abs(bend - turn) < 15, `the chain turns ${bend.toFixed(0)}° at the ${bendAge.toFixed(0)}-Myr-old point; the plate turned ${turn}°`);
    check('no gaps', r.frames.every(f => frameTallies(f).gaps === 0), 'every frame');
}

section('a plume head reaches a drifting continent (Deccan)');
{
    const r = run('deccan'), { last, scene, world } = r, cfg = world.config, H = last.hotspots[0]?.xyz;
    const lipEvent = r.events.find(e => e.kind === EventKind.LIP);
    check('the head floods the continent with basalt the moment it arrives', !!lipEvent && Math.abs(lipEvent.time - scene.arrivesMyr) < SNAPSHOT_MYR + 1e-6 && lipEvent.data.onLand,
        lipEvent ? `${lipEvent.time.toFixed(0)} Myr: ${lipEvent.text}` : 'no LIP');
    const lip = cellsWhere(numCells, w => last.volcType[w] === VolcanicType.LIP && last.owner[w] >= 0);
    const smallest = 1e6 * cfg.lipAreaMinMkm2 / cellAreaKm2, largest = 1e6 * cfg.lipAreaMaxMkm2 / cellAreaKm2;
    const onLand = lip.filter(w => continental(last, w)).length;
    // its outline: lobed and ragged, or a disc? (Earth's provinces are ragged, much of it from later erosion and burial)
    const c = normalize(lip.reduce((s, w) => [s[0] + xyz[3 * w], s[1] + xyz[3 * w + 1], s[2] + xyz[3 * w + 2]], [0, 0, 0])), lipSet = new Set(lip);
    const rim = lip.filter(w => { for (let k = adjOffset[w]; k < adjOffset[w + 1]; k++) if (!lipSet.has(adjList[k])) return true; return false; }).map(w => kmBetween(pos(w), c));
    const spread = Math.max(...rim) / Math.min(...rim);
    report('the province’s outline: farthest ÷ nearest edge from its middle', spread, { digits: 1, unit: '×', source: 'ragged on Earth; a disc would be ~1.2×', detail: `its edge lies ${Math.min(...rim).toFixed(0)}–${Math.max(...rim).toFixed(0)} km from its middle` });
    // (the configured range is Bryan & Ernst 2008's > 0.1 Mkm² up to Siberia; CAMP reached ~10 Mkm²)
    check('…a province in the configured size range, and it rides on with the continent', lip.length >= 0.7 * smallest && lip.length <= 1.3 * largest && onLand >= 0.8 * lip.length,
        `${lip.length} LIP cells (${(lip.length * cellAreaKm2 / 1e6).toFixed(1)} Mkm², expected ${(smallest * cellAreaKm2 / 1e6).toFixed(1)}–${(largest * cellAreaKm2 / 1e6).toFixed(1)}); ${onLand} of them still on the continent at ${last.time} Myr`);
    // from the plume now, along volcanic crust only, back to the traps
    const here = mesh.index.nearest(H[0], H[1], H[2]), volcanic = new Set(cellsWhere(numCells, w => last.volcType[w] !== VolcanicType.NONE && last.owner[w] >= 0));
    const seen = new Set([here]);
    let reachesTraps = false;
    for (let queue = [here], i = 0; i < queue.length && !reachesTraps; i++) for (let k = adjOffset[queue[i]]; k < adjOffset[queue[i] + 1]; k++) {
        const nb = adjList[k];
        if (!volcanic.has(nb) || seen.has(nb)) continue;
        seen.add(nb); queue.push(nb);
        if (last.volcType[nb] === VolcanicType.LIP) reachesTraps = true;
    }
    check('then the tail draws an unbroken chain from the traps to where the plume is now', reachesTraps, reachesTraps ? `volcanic crust links the plume to the traps, ${kmBetween(H, pos(lip[0])).toFixed(0)} km away` : 'the chain is broken');
    const youngest = cellsWhere(numCells, w => volcanic.has(w)).reduce((best, w) => (last.volcAt[w] > last.volcAt[best] ? w : best), here);
    check('…youngest over the plume', kmBetween(pos(youngest), H) < 1.5 * edgeKm, `the most recent eruption is ${kmBetween(pos(youngest), H).toFixed(0)} km from the plume`);
    // (whether a plume head rifts a continent comes from how hard the continent is pulled apart, plumeRiftTension — a head
    // alone does not break a plate: Buiter & Torsvik 2014; this scene's continent is not pulled apart)
    check('a continent that is not pulled apart is only scarred, not rifted', !r.events.some(e => e.kind === EventKind.RIFT), `${r.events.filter(e => e.kind === EventKind.RIFT).length} rifts`);
}

section('plumes favour insulated mantle — but not only');
{
    // the sampler itself, on the start world with the mantle under the supercontinent fully insulated
    const { world } = buildStartWorld(mesh, SEED);
    for (const p of world.plates) p.refreshExtent(xyz);
    resolve(world);
    let land = 0;
    for (let w = 0; w < numCells; w++) {
        const o = world.owner[w], t = o >= 0 ? world.plates[o].crust.type[world.ownerCell[w]] : -1;
        world.mantleHeat[w] = t === CrustType.CONTINENT || t === CrustType.CRATON ? 1 : 0;
        land += world.mantleHeat[w];
    }
    const rng = makeRng(99);
    let under = 0;
    const draws = 3000;
    for (let i = 0; i < draws; i++) if (world.mantleHeat[pickPlumeSite(world, rng)] === 1) under++;
    // a unit test of the sampler, not physics (whether plumes favour insulated mantle is disputed: Coltice et al. 2007
    // against Burke & Torsvik 2004): with no live plume to keep away from, a cell is drawn with weight plumeOceanWeight
    // + (1 − plumeOceanWeight) × heat, so the share under continent is land ÷ (land + plumeOceanWeight × sea)
    const landShare = land / numCells, share = under / draws, cool = world.config.plumeOceanWeight;
    const analytic = landShare / (landShare + cool * (1 - landShare)), sigma = Math.sqrt(analytic * (1 - analytic) / draws);
    check('the plume sampler draws under continent at its analytic weight (unit test)', Math.abs(share - analytic) <= 4 * sigma,
        `${(100 * share).toFixed(1)} % of ${draws} draws under continent, which covers ${(100 * landShare).toFixed(0)} % of the planet; weight ${cool} at sea gives ${(100 * analytic).toFixed(1)} % (± ${(100 * sigma).toFixed(1)})`);

    const r = run('history'), { last, frames } = r;
    // (the counts across seeds: the scene's own seed and two more)
    const others = [SEED + 1, SEED + 2].map(seed => run('history', {}, seed)), runs = [r, ...others];
    const headsOf = x => x.events.filter(e => e.kind === EventKind.LIP), onLandShare = x => headsOf(x).filter(e => e.data.onLand).length / Math.max(1, headsOf(x).length);
    report('share of plume heads rising under continent (the rest under open ocean)', runs.map(x => 100 * onLandShare(x)), { digits: 0, unit: ' %', source: 'Earth has both: Deccan, Siberia on land; Ontong Java, Kerguelen at sea',
        detail: runs.map(x => `${headsOf(x).filter(e => e.data.onLand).length} traps, ${headsOf(x).filter(e => !e.data.onLand).length} plateaus`).join(' · ') });
    report('live plumes at the end of a history', runs.map(x => x.last.hotspots.length), { earth: [7, 50], digits: 0, source: '7 deep plumes of 49 hotspots (Courtillot et al. 2003); ~27 in tomography (French & Romanowicz 2015); 40–50 in catalogues',
        detail: `at ${last.time} Myr, seeds ${runs.map((x, i) => SEED + i).join(', ')}` });
    let was = 0, nWas = 0, never = 0, nNever = 0;
    for (let w = 0; w < numCells; w++) {
        if (continental(last, w)) continue;
        if (continental(frames[0], w)) { was += last.mantleHeat[w]; nWas++; } else { never += last.mantleHeat[w]; nNever++; }
    }
    const heatWas = was / nWas / 255, heatNever = never / nNever / 255;
    check('the mantle remembers where the supercontinent was', heatWas > heatNever, `mean heat at ${last.time} Myr where the supercontinent sat but is now ocean: ${heatWas.toFixed(2)}; where there was never continent: ${heatNever.toFixed(2)}`);
    // how long it remembers: the mantle cools back over mantleCoolMyr once the continent has gone (Coltice et al. 2007:
    // a supercontinent warms the mantle by up to ~100 °C)
    report('mantle heat where the supercontinent sat ÷ where there was never continent', heatWas / heatNever, { digits: 2, unit: '×', source: 'Coltice et al. 2007: warmer under a supercontinent', detail: `at ${last.time} Myr; it cools back over ~${r.world.config.mantleCoolMyr} Myr (mantleCoolMyr)` });
    const plumeRifts = r.events.filter(e => e.kind === EventKind.RIFT && e.data.cause === 'plume').length, rifts = r.events.filter(e => e.kind === EventKind.RIFT).length;
    report('rifts opened by a plume head', plumeRifts, { digits: 0, source: 'plume–rift links are real (Courtillot et al. 1999); no Earth count', detail: `${rifts} rifts in ${last.time} Myr, ${plumeRifts} of them by a plume head` });
    check('no gaps', frames.every(f => frameTallies(f).gaps === 0), 'every frame');
}

section('the plumes of 6a and of 7a are one and the same');
{
    const r = run('history', { plumeRiftChance: 1 });
    const plumeRifts = r.events.filter(e => e.kind === EventKind.RIFT && e.data.cause === 'plume');
    // (a head under a piece of continent too young to rift waits for it — plumeRiftWaitMyr; its LIP erupts on arrival)
    const wait = TECTONICS.plumeRiftWaitMyr;
    const matched = plumeRifts.filter(rift => r.events.some(e => e.kind === EventKind.LIP && e.data.hotspot === rift.data.hotspot && rift.time - e.time > -1e-6 && rift.time - e.time < wait + 1e-6));
    check('a plume head that splits a continent is the same plume that floods it with basalt', plumeRifts.length >= 1 && matched.length === plumeRifts.length,
        `${plumeRifts.length} plume rifts (every head allowed to split); ${matched.length} of them erupted their own LIP when it arrived, at most ${wait} Myr before the rift`);
    const b = run('history', { plumeRiftChance: 1 });                       // (a replay of r)
    check('the same seed replays the same history', r.events.length === b.events.length && r.events.every((e, i) => e.text === b.events[i].text) && r.frames.at(-1).owner.every((o, w) => o === b.frames.at(-1).owner[w]), `${r.events.length} events and the final world, identical`);
}

finish('Phase 7a');
