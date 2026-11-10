// Headless check of the ocean's pour (tectonics/ocean/inventory.js pourOcean; lane pourstart, 2026-11-10): on built
// grounds, where the answer is known —
//  · from the ocean's side: the world's lowest cell lies in a deep basin cut off behind a sill, and the ocean poured from
//    its own floor stands below that sill. The pour must start again from the ocean, hold the basin empty, and stand
//    the ocean where it stands with the basin walled off (before the fix it pinned the world's sea at the basin's sill:
//    831576@360, +270 m against −166 m; waterflow report §2.1);
//  · a pinned sill, arid (no climate, or a dry basin): the ocean at the sill and the basin's share stood from its bottom
//    — its wet cells its lowest, not the heap's order;
//  · a pinned sill, humid: the basin brim-full at its sill and the ocean below it by what the basin holds;
//  · every case: the books close (the water standing = V, to single precision);
//  · the zonal judge (terrain/land-mask.js pinnedHumid, the closed-basin balance on the history's rain table): the same
//    basin humid under the equator's rain, arid under the subtropics'.
// At 40K and 160K cells (the scale: the same answers in km and m). ~10 s.
// Usage: node v2/tools/check-pour.mjs

import { check, report, section, finish } from './lib/check-kit.mjs';
import { buildSimMesh } from '../js/core/sim-mesh.js';
import { pourOcean } from '../js/tectonics/ocean/inventory.js';
import { pinnedHumid } from '../js/terrain/land-mask.js';
import { TERRAIN } from '../js/terrain/terrain-config.js';

const R = 6371, D = 180 / Math.PI, M = 1e6;

// A world: ocean floor at −4 km; a continent, a cap `capDeg` round (latB, 0), rising from +1 km at the basin to +2 at its
// coast; in it a basin, a cap `basinDeg` round the same point, a bowl from −6 km at its middle to −4.5 at its rim; one
// channel through the continent from the basin toward the equator, its floor at the sill `sillKm` — the only way between
// the basin and the ocean below the continent's height.
function world(mesh, latB, sillKm, basinDeg = 8, capDeg = 20) {
    const n = mesh.numCells, z = new Float32Array(n), basin = new Uint8Array(n), cx = Math.cos(latB / D), cz = Math.sin(latB / D);
    for (let c = 0; c < n; c++) {
        const x = mesh.xyz[3 * c], y = mesh.xyz[3 * c + 1], w = mesh.xyz[3 * c + 2], lat = Math.asin(w) * D, lon = Math.atan2(y, x) * D;
        const d = Math.acos(Math.min(1, x * cx + w * cz)) * D;
        if (d < basinDeg) { z[c] = -6 + 1.5 * d / basinDeg; basin[c] = 1; }
        else if (d < capDeg) z[c] = (Math.abs(lon) < 1.2 && (lat - latB) * Math.sign(latB) < 0) ? sillKm : 1 + (d - basinDeg) / (capDeg - basinDeg);
        else z[c] = -4;
    }
    return { z, basin };
}
const cellKm2 = mesh => 4 * Math.PI * R * R / mesh.numCells;
const booksOf = (mesh, z, P) => { let v = 0; for (let c = 0; c < mesh.numCells; c++) if (P.sea[c]) v += (P.topKm[c] - z[c]) * cellKm2(mesh); return v; };
const roomOf = (mesh, z, cells, L) => { let v = 0; for (let c = 0; c < mesh.numCells; c++) if (cells(c) && z[c] < L) v += (L - z[c]) * cellKm2(mesh); return v; };

for (const cells of [40000, 160000]) {
    const mesh = buildSimMesh(cells, 12345), n = mesh.numCells, a = cellKm2(mesh), sill = 0.27, tol = 1e-5;
    const { z, basin } = world(mesh, 25, sill);
    const ocean = c => z[c] === -4, roomO = roomOf(mesh, z, ocean, sill), roomB = roomOf(mesh, z, c => basin[c], sill);

    section(`from the ocean's side (${cells / 1000}K cells): the world's lowest cell in a basin behind a sill`);
    {
        const V = 0.9 * roomO, P = pourOcean(mesh, z, V);
        const walled = Float32Array.from(z); for (let c = 0; c < n; c++) if (basin[c]) walled[c] = 50;
        const Q = pourOcean(mesh, walled, V);
        let wetBasin = 0; for (let c = 0; c < n; c++) if (basin[c] && P.sea[c]) wetBasin++;
        check('the ocean stands where it does with the basin walled off', Math.abs(P.levelKm - Q.levelKm) < 1e-4,
            `${(1000 * P.levelKm).toFixed(1)} m against ${(1000 * Q.levelKm).toFixed(1)} m (the sill ${1000 * sill} m; ${P.restarts} re-pour)`);
        check('the basin behind the sill is held empty', wetBasin === 0 && P.below > 0, `${wetBasin} of its cells wet; ${P.below} cells below the level behind a sill`);
        check('the books close', Math.abs(booksOf(mesh, z, P) / V - 1) < tol, `${(booksOf(mesh, z, P) / V - 1).toExponential(1)}`);
    }

    section(`a pinned sill (${cells / 1000}K cells): the ocean overfills to the sill, the basin takes the rest`);
    {
        const V = roomO + 0.05 * roomB;
        const P = pourOcean(mesh, z, V);                                   // (no climate: arid)
        let wet = 0, wetMax = -Infinity, dryMin = Infinity, top = NaN;
        for (let c = 0; c < n; c++) if (basin[c]) { if (P.sea[c]) { wet++; wetMax = Math.max(wetMax, z[c]); top = P.topKm[c]; } else dryMin = Math.min(dryMin, z[c]); }
        check('arid: the ocean at the sill', Math.abs(P.levelKm - sill) < 1e-6 && P.pin && !P.pin.humid, `${(1000 * P.levelKm).toFixed(2)} m`);
        check('arid: the basin\'s water stood from its bottom', wet > 0 && wetMax <= dryMin && top < sill,
            `${wet} cells wet, the highest at ${(1000 * wetMax).toFixed(0)} m, the lowest dry at ${(1000 * dryMin).toFixed(0)} m; its lake at ${(1000 * top).toFixed(0)} m`);
        check('arid: the books close', Math.abs(booksOf(mesh, z, P) / V - 1) < tol, `${(booksOf(mesh, z, P) / V - 1).toExponential(1)}; the basin holds ${(P.pin.basinKm3 / M).toFixed(2)} of ${(roomB / M).toFixed(2)} Mkm³`);
        const H = pourOcean(mesh, z, V, null, { humid: () => true });
        let full = 0, oceanKm2 = 0;
        for (let c = 0; c < n; c++) { if (basin[c] && H.sea[c] && Math.abs(H.topKm[c] - sill) < 1e-6) full++; if (ocean(c) && H.sea[c]) oceanKm2 += a; }
        let basinCells = 0; for (let c = 0; c < n; c++) basinCells += basin[c];
        const expect = sill - (roomO + roomB - V) / oceanKm2;              // (the shortfall over the ocean's flat floor)
        check('humid: the basin brim-full at its sill', full === basinCells && H.pin?.humid, `${full} of ${basinCells} cells at the sill`);
        check('humid: the ocean below the sill by what the basin holds', Math.abs(H.levelKm - expect) < 1e-3,
            `${(1000 * H.levelKm).toFixed(1)} m (expected ${(1000 * expect).toFixed(1)} m)`);
        check('humid: the books close', Math.abs(booksOf(mesh, z, H) / V - 1) < tol, `${(booksOf(mesh, z, H) / V - 1).toExponential(1)}`);
    }
}

section('the zonal judge: the same basin (0.6 Mkm², its catchment 4 Mkm²) under the equator\'s rain and the subtropics\'');
{
    const mesh = buildSimMesh(40000, 12345), n = mesh.numCells, sill = 0.27, out = {};
    for (const [latB, want] of [[5, true], [-25, false]]) {
        const { z, basin } = world(mesh, latB, sill, 4, 12), ocean = new Uint8Array(n);
        for (let c = 0; c < n; c++) if (z[c] === -4) ocean[c] = 1;
        const t0 = performance.now(), humid = pinnedHumid(mesh, z, TERRAIN)({ sillKm: sill, basin, ocean }), ms = performance.now() - t0;
        check(`a basin at ${Math.abs(latB)}°${latB < 0 ? 'S' : 'N'} is ${want ? 'humid (fills itself brim-full)' : 'arid (draws down behind its sill)'}`, humid === want, `judged ${humid ? 'humid' : 'arid'} in ${ms.toFixed(0)} ms`);
        out[latB] = ms;
    }
    report('the judge\'s cost per pinned pour (40K cells)', Math.max(...Object.values(out)), { unit: ' ms', digits: 0, source: 'runs only on a pinned pour, ~1–2 % of drainages' });
}

finish('pour');
