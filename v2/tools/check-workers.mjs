// Every web worker that can reach V1's buildSphere (through buildSimMesh, the plate stress field's own mesh…) must set
// Delaunator itself: a worker has its own module state, and no import map. The Node tools set it for themselves, which is
// how the history worker shipped without it (2026-11-03: "_Delaunator is not a constructor" at the first rift). Static: from
// each worker's entry file, follow the relative imports; if a buildSphere / buildSimMesh call is in reach, the entry
// (or the file it loads Delaunator in) must call setDelaunator.
// Usage: node v2/tools/check-workers.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { check, section, finish } = await import('./lib/check-kit.mjs');

const JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../js');
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(JS);
const src = new Map(files.map(f => [f, fs.readFileSync(f, 'utf8')]));

const entries = new Set();
for (const [f, s] of src) for (const m of s.matchAll(/new Worker\(\s*(?:new URL\()?\s*['"`](\.[^'"`]+)['"`]/g)) entries.add(path.resolve(path.dirname(f), m[1]));
for (const [f, s] of src) for (const m of s.matchAll(/new URL\(\s*['"](\.[^'"]*worker\.js)['"]/g)) entries.add(path.resolve(path.dirname(f), m[1]));      // (a Worker made from a variable: helper-pool.js)
const importsOf = f => [...src.get(f).matchAll(/(?:from|import\()\s*['"](\.[^'"]+)['"]/g)].map(m => path.resolve(path.dirname(f), m[1])).filter(p => src.has(p));
const reaches = entry => { const seen = new Set([entry]), todo = [entry]; while (todo.length) for (const n of importsOf(todo.pop())) if (!seen.has(n)) { seen.add(n); todo.push(n); } return [...seen]; };
// Known, reported to the supervisor 2026-11-03, not fixed here (not the hotfix's files): civ/civ-page.js:48 builds a coarse
// mesh when the moment's mesh is bigger than PAGE_CELLS, in civ-worker, which never sets Delaunator. Remove when it does.
const KNOWN_OPEN = new Set(['civ/civ-worker.js']);
const builds = f => /\b(?:buildSphere|buildSimMesh)\(/.test(src.get(f).replace(/export function (?:buildSphere|buildSimMesh)\(/g, ''));

section('worker entries that can build a mesh set Delaunator');
check('found the workers', entries.size >= 7, `${entries.size}`);
for (const entry of entries) {
    if (!src.has(entry)) { check(`${path.relative(JS, entry)} exists`, false); continue; }
    const closure = reaches(entry), builder = closure.find(f => f !== entry && builds(f)) ?? (builds(entry) ? entry : null);
    if (!builder) continue;                                           // (cannot reach a mesh build: nothing to set)
    if (KNOWN_OPEN.has(path.relative(JS, entry)) && !/\bsetDelaunator\(/.test(src.get(entry))) { console.log(`KNOWN ${path.relative(JS, entry)} does not set Delaunator (reaches ${path.relative(JS, builder)})`); continue; }
    check(`${path.relative(JS, entry)} sets Delaunator (reaches ${path.relative(JS, builder)})`, /\bsetDelaunator\(/.test(src.get(entry)));
}
finish('workers');
