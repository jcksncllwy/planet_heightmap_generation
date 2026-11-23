// Does a scene's history come out the same however it is built? (histdet lane, 2026-11-23.) Builds a terrain scene's
// history (check-phase8a/8b's run(): TERRAIN_SCENES, the lab mesh) with the cache off — optionally after other scenes'
// histories in the same process (--before history,andes: what check-phase8a builds first) — and hashes every field of
// every frame BY VALUE, after the cache's own pack/unpack (so a cache entry's frames, --entry KEY, compare like for like).
//   node v2/tools/scene-determinism-probe.mjs --scene india [--seed 12345] [--before a,b] [--out f.jsonl]
//   node v2/tools/scene-determinism-probe.mjs --chain a,b,c [--out f.jsonl]   (each scene in turn, one process, each hashed:
//                                                  every scene's frames tagged { scene }; compare with --diff --scene b)
//   node v2/tools/scene-determinism-probe.mjs --entry 0cbcdf62… [--out f.jsonl]      (hash a cache entry's frames)
//   node v2/tools/scene-determinism-probe.mjs --diff a.jsonl b.jsonl                  (first time and fields that part)
// One JSON line per frame: { time, step, all, fields: { name: hash } }; then { final, steps, s }.
process.env.GEO_SIM_HISTORY_CACHE = '0';
import fs from 'node:fs';
import crypto from 'node:crypto';
// (imported only now: a static import is evaluated before the line above, and history-cache.mjs reads the switch as it loads)
const { fieldHashes } = await import('./lib/frame-hash.mjs');
const { labMesh } = await import('./lib/check-kit.mjs');
const { simulateCached, entryTimes, getFrame, unpackFrame, ENABLED } = await import('./lib/history-cache.mjs');
const { packFrame } = await import('../js/tectonics/frame-pack.js');
const { frameBytes, readFrameBytes } = await import('../js/app/frame-wire.js');
const { TERRAIN_SCENES } = await import('../js/tectonics/scenarios/terrain-scenes.js');
if (ENABLED) throw new Error('the history cache is on: this probe must build');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const read = f => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.fields);
if (argv[0] === '--diff') {
    const only = arg("--scene", null), pick = rs => (only ? rs.filter(r => r.scene === undefined || r.scene === only) : rs);
    const [a, b] = [pick(read(argv[1])), pick(read(argv[2]))], bt = new Map(b.map(r => [r.time, r]));
    for (const r of a) {
        const s = bt.get(r.time);
        if (!s || r.all === s.all) continue;
        const diff = Object.keys({ ...r.fields, ...s.fields }).filter(k => r.fields[k] !== s.fields[k]);
        console.log(JSON.stringify({ firstTime: r.time, steps: [r.step, s.step], fields: diff }));
        process.exit(1);
    }
    console.log(JSON.stringify({ identical: true, frames: a.filter(r => bt.has(r.time)).length }));
    process.exit(0);
}

const lines = [], out = arg('--out', null), all = crypto.createHash('sha1'), t0 = Date.now();
const emit = o => { const s = JSON.stringify(o); lines.push(s); if (!out) console.log(s); };
const hashFrame = (f, step) => { const fields = fieldHashes(f), fh = crypto.createHash('sha1').update(JSON.stringify(fields)).digest('hex').slice(0, 12); all.update(fh); emit({ time: f.time, step, all: fh, fields }); };
// a live frame as the cache would hand it back (packed and unpacked: the cache's own round trip)
const roundTrip = f => unpackFrame(readFrameBytes(frameBytes(packFrame(f).packed)));

const entry = arg('--entry', null);
if (entry) {
    for (const t of entryTimes(entry)) hashFrame(getFrame(entry, t), null);
    emit({ entry, final: all.digest('hex').slice(0, 12) });
} else {
    const mesh = labMesh(), seed = Number(arg('--seed', 12345));
    const beforeMyr = Number(arg('--before-myr', 0));   // (>0: the --before histories stop there — enough to leave their state)
    const build = async (id, onFrame, untilMyr = null) => {
        const scene = TERRAIN_SCENES.find(s => s.id === id), world = scene.build(mesh, seed);
        // (as check-phase8a's run(): its cadence, its drive; simulateCached with the cache off is simulate())
        await simulateCached(world, { untilMyr: untilMyr ?? scene.maxMyr, drive: w => scene.drive(w), snapshotEveryMyr: 10, keepFrames: false, onFrame: f => onFrame?.(f, world) }, { drive: scene.drive });
        return world;
    };
    const chain = arg('--chain', null);
    if (chain) {
        for (const id of chain.split(',')) {
            const h = crypto.createHash('sha1'), t1 = Date.now();
            const world = await build(id, (f, w) => { const fields = fieldHashes(roundTrip(f)), fh = crypto.createHash('sha1').update(JSON.stringify(fields)).digest('hex').slice(0, 12); h.update(fh); emit({ scene: id, time: f.time, step: w.step, all: fh, fields }); });
            emit({ scene: id, seed, chain, final: h.digest('hex').slice(0, 12), steps: world.step, s: (Date.now() - t1) / 1000 });
        }
    } else {
        for (const id of (arg('--before', '') || '').split(',').filter(Boolean)) await build(id, null, beforeMyr || null);
        const world = await build(arg('--scene', 'india'), (f, w) => hashFrame(roundTrip(f), w.step));
        emit({ scene: arg('--scene', 'india'), seed, before: arg('--before', ''), final: all.digest('hex').slice(0, 12), steps: world.step, s: (Date.now() - t0) / 1000 });
    }
}
if (out) fs.writeFileSync(out, lines.join('\n') + '\n');
process.exit(0);
