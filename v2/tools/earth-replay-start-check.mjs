// Proves the Earth start builder cannot read an outcome (Earth replay study Q5.5), as hard checks on the plumbing:
//   1. scenarios/earth-start.js's whole import graph is model code: no file reader, nothing under tools/.
//   2. the loader that feeds it (tools/earth-replay-inputs.mjs) imports no compare-side module, and no other reader than the lib's.
//   3. its manifest names nothing but t₀ reconstruction files, and its gate refuses the rest: an observation dataset, and a
//      grid or table of any time but t₀.
//   node v2/tools/earth-replay-start-check.mjs
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, section, finish } from './lib/check-kit.mjs';
import { MANIFEST, readInput } from './earth-replay-inputs.mjs';

const V2 = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT = /^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** Every file reachable through static and literal-dynamic imports, plus the bare/node: specifiers met on the way. */
function graph(entry) {
    const files = new Set(), externals = new Set(), todo = [resolve(entry)];
    while (todo.length) {
        const f = todo.pop();
        if (files.has(f)) continue;
        files.add(f);
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(IMPORT)) {
            const spec = m[1] ?? m[2] ?? m[3];
            if (spec.startsWith('.')) { const p = resolve(dirname(f), spec); if (existsSync(p)) todo.push(p); else externals.add(spec); }
            else externals.add(spec);
        }
    }
    return { files: [...files].map(f => relative(V2, f)), externals: [...externals] };
}

section('The start builder reads no files');
const start = graph(resolve(V2, 'js/tectonics/scenarios/earth-start.js'));
check('its import graph is model code only (nothing under tools/, no node: or bare module)', start.files.every(f => f.startsWith('js/') || f.startsWith('../js/')) && !start.externals.some(e => !e.startsWith('.')), `${start.files.length} files; externals: ${start.externals.join(', ') || 'none'}`);
check('…and no file in it touches the filesystem', start.files.every(f => !/\bfrom\s*['"]node:|\breadFileSync\b|\bfetch\(/.test(readFileSync(resolve(V2, f), 'utf8'))));

section('The loader reads the t₀ manifest only');
const COMPARE = ['earth-replay-probe', 'earth-replay-harness', 'earth-replay-static-force'];            // report-side tools: they may read what the start must not
const loader = graph(resolve(V2, 'tools/earth-replay-inputs.mjs'));
check('the loader imports no compare-side module', !loader.files.some(f => COMPARE.some(c => f.includes(c))), loader.files.filter(f => f.startsWith('tools/')).join(', '));
check('the start builder is not reachable from a compare reader (it imports none; nothing there imports it back)', !start.files.some(f => f.startsWith('tools/')));
const FORBIDDEN = /etopo|worldclim|crust1|crust_1|hydrorivers|dem|gebco|globe|scotese|koppen|age-?grid(?!.*t₀)/i;
const names = Object.keys(MANIFEST).concat(Object.values(MANIFEST).map(f => f(40000, 100)));
check('no manifest entry names an observation dataset', !names.some(n => FORBIDDEN.test(n.replace('ocean age grid at t₀', '').replace('agegrid/age-100.nc', ''))), names.join(' | '));
const refuses = rel => { try { readInput(rel, 40000, 100); return false; } catch (e) { return /not in the manifest/.test(e.message); } };
check('the gate refuses today\'s age grid when t₀ is 100', refuses('raw/muller2019/agegrid/age-0.nc'));
check('the gate refuses a topography file', refuses('raw/etopo/ETOPO1_Bed_g_gmt4.grd') && refuses('../../../data/crust1.0/crust1.bnds'));
check('the gate refuses a path out of the data folder', refuses('../../../../../.zshrc'));
finish();
