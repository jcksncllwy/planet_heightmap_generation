// The machine's history cache (tools/lib/history-cache.mjs), from the command line — and what the user is looking at in
// the Evolution page (served by the dev server, the page saves its history to the cache and notes the moment shown).
//
//   node v2/tools/history.mjs latest                       what the user is viewing: the history, the moment, the link
//   node v2/tools/history.mjs frame --latest [--out f.bin] that very frame, written to a file
//   node v2/tools/history.mjs frame --seed 626225 --time 950 [--cont 30] [--sim 40000] [--out f.bin] [--no-build]
//                                                          the page's history for these settings as Node builds it (built if not cached —
//                                                          run that through sim-slots: sim-slots run -n 1 --gb 3 -- node …)
//   node v2/tools/history.mjs frame --key <key> --time 950 [--out f.bin]   any entry's frame (keys: ls)
//   node v2/tools/history.mjs ls                           the entries: what each is, how far it reaches, its size
//   node v2/tools/history.mjs gc [--cap-gb 4]              evict the entries used longest ago, to the cap
//   node v2/tools/history.mjs code [--files]               this checkout's history code hash (and the files it covers)
//
// The page's histories are built by the browser's engine, whose maths differ from Node's in the last bit (history-key.js),
// so --seed finds Node's history for those settings, not the page's; the page's own frames come by --latest or --key.
// A frame file is v8.serialize({ frame }) — the whole frame, as captureFrame made it: v8.deserialize(fs.readFileSync(f)).frame.
// Without --out it is written to v2/out/frames/frame-<seed>-<time>.bin.

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import Delaunator from 'delaunator';
import { setDelaunator } from '../../js/sphere-mesh.js';
import * as HC from './lib/history-cache.mjs';
import { mathFingerprint } from '../js/app/history-key.js';
import { momentFrame, pageWorld } from './lib/moment-frame.mjs';

setDelaunator(Delaunator);
const [cmd = 'help', ...rest] = process.argv.slice(2);
const arg = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const has = k => rest.includes(k);
const mb = b => `${(b / 1e6).toFixed(1)} MB`;
const ago = ms => { const s = (Date.now() - ms) / 1000; return s < 120 ? `${s.toFixed(0)} s ago` : s < 7200 ? `${(s / 60).toFixed(0)} min ago` : s < 172800 ? `${(s / 3600).toFixed(0)} h ago` : `${(s / 86400).toFixed(0)} d ago`; };

function writeFrame(frame, out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, v8.serialize({ frame }));
    console.log(JSON.stringify({ file: path.resolve(out), time: frame.time }));
}
const defaultOut = (seed, t) => path.join(HC.REPO_ROOT, 'v2', 'out', 'frames', `frame-${seed}-${t}.bin`);

if (cmd === 'latest') {
    const v = HC.readLatest();
    if (!v) { console.log('nothing yet: open the Evolution page from the dev server (node tuning/dev-server.mjs 8124) and build a world'); process.exit(1); }
    const times = HC.entryTimes(v.key), here = HC.codeHash();
    console.log(JSON.stringify({ ...v, cached: times.some(t => Math.abs(t - v.timeMyr) < 1e-6), entryFrames: times.length, entryReachesMyr: times.at(-1) ?? null, sameCodeAsThisCheckout: v.code === here, nodeRebuildsItExactly: v.meta?.math === mathFingerprint() }, null, 1));
} else if (cmd === 'frame') {
    if (has('--latest')) {
        const v = HC.readLatest();
        if (!v) { console.error('no latest.json: nothing viewed yet'); process.exit(1); }
        const frame = HC.getFrame(v.key, v.timeMyr);
        if (!frame) { console.error(`frame ${v.timeMyr} Myr of ${v.key} is not in the cache (still uploading, or evicted): build it with frame --seed ${v.seed} --cont ${v.cont} --sim ${v.sim} --time ${v.timeMyr}${v.code !== HC.codeHash() ? ' — note this checkout\'s history code differs from the page\'s' : ''}`); process.exit(1); }
        writeFrame(frame, arg('--out', defaultOut(v.seed, v.timeMyr)));
    } else if (has('--key')) {
        const key = arg('--key'), time = Number(arg('--time', NaN)), frame = HC.getFrame(key, time);
        if (!frame) { console.error(`not cached: ${key} at ${time} Myr (frames there: ${HC.entryTimes(key).join(', ') || 'none'})`); process.exit(1); }
        writeFrame(frame, arg('--out', defaultOut(HC.readMeta(key)?.spec?.seed ?? key, time)));
    } else {
        const seed = Number(arg('--seed', NaN)), time = Number(arg('--time', NaN)), cont = Number(arg('--cont', 30)), sim = Number(arg('--sim', 40000));
        if (!Number.isFinite(seed) || !Number.isFinite(time)) { console.error('frame needs --latest, or --seed and --time'); process.exit(1); }
        if (has('--no-build')) {
            const { key } = pageWorld({ seed, cont, sim }), frame = HC.getFrame(key, time);
            if (!frame) { console.error(`not cached: ${key} at ${time} Myr`); process.exit(1); }
            writeFrame(frame, arg('--out', defaultOut(seed, time)));
        } else writeFrame(await momentFrame(HC.REPO_ROOT, { seed, cont, sim, time, full: true }), arg('--out', defaultOut(seed, time)));
    }
} else if (cmd === 'ls') {
    const here = HC.codeHash(), entries = HC.listEntries();
    console.log(`${HC.CACHE_DIR}: ${entries.length} entries, ${mb(entries.reduce((s, e) => s + e.bytes, 0))} (cap ${mb(HC.CAP_BYTES)}); this checkout's history code ${here}`);
    for (const e of entries) {
        const t = HC.entryTimes(e.key), s = e.meta?.spec ?? {};
        const what = [s.scene && `scene ${s.scene}`, s.seed !== undefined && `seed ${s.seed}`, s.cont !== undefined && `cont ${s.cont}`, (s.sim ?? s.cells) && `${s.sim ?? s.cells} cells`].filter(Boolean).join(' · ');
        console.log(`${e.key}  ${e.meta?.code === here ? 'this code' : `code ${e.meta?.code ?? '?'}`}  ${what || '(no meta)'}  ${t.length} frames ${t[0] ?? '–'}–${t.at(-1) ?? '–'} Myr  ${mb(e.bytes)}  by ${e.meta?.builtBy ?? '?'}${e.meta?.math && e.meta.math !== mathFingerprint() ? ' (another engine\'s maths)' : ''}  used ${ago(e.usedAt)}`);
    }
} else if (cmd === 'gc') {
    const r = HC.gc({ capBytes: Number(arg('--cap-gb', HC.CAP_BYTES / 1e9)) * 1e9 });
    console.log(`${mb(r.before)} → ${mb(r.after)}: ${r.removed.length} entries removed`);
} else if (cmd === 'code') {
    const h = HC.historyCodeHash();
    console.log(h.hash);
    if (has('--files')) console.log(h.files.join('\n'));
} else {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
}
