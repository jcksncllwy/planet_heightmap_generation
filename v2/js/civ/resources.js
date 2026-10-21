// Raw materials from the tectonic record (plans/CIV_PLAN.md §5.6): what the early metalworkers, knappers and builders
// could find, read from the moment's frame (the history's per-cell record on the sim mesh) and the finished surface.
// Each kind of deposit follows the setting real ones form in:
//   copper   ophiolites in old sutures (Troodos, Oman's "Magan"); porphyry and skarn over subduction (the Iranian arc,
//            the Andes); native copper in flood basalts and failed rifts (Keweenaw)
//   tin      granites of continental collisions, rare and patchy (Cornwall, the Erzgebirge, Afghanistan)
//   obsidian young volcanoes: arcs, rifts, hotspots on land (Göllü Dağ, Melos, the Ethiopian rift) — glass older than
//            ~10 Myr has devitrified
//   gold     arcs and old belts
//   bitumen  foreland basins in front of fold belts (Hit on the Euphrates)
//   salt     salt lakes and pans, dry coasts
//   flint    the old sedimentary cover of platforms and passive margins
//   stone    anywhere but alluvium and sand
//   timber   forest, by the climate
// Ore deposits are patches, not whole belts: each is gated by a smooth noise field (its own stream), so a belt holds a
// few districts of a few hundred km.

import { CrustType, CrustFlag, OrogenyType, VolcanicType, BeltSide } from '../tectonics/model/crust.js';
import { FastNoise } from '../core/fast-noise.js';
import { Water } from '../finish/finish-hydro.js';
import { KOPPEN_CLASSES } from '../climate/koppen.js';

export const Res = Object.freeze({
    COPPER_OPHIOLITE: 1, COPPER_PORPHYRY: 2, COPPER_NATIVE: 4, TIN: 8, OBSIDIAN: 16, GOLD: 32,
    BITUMEN: 64, SALT: 128, FLINT: 256, STONE: 512, TIMBER: 1024,
});
export const COPPER = Res.COPPER_OPHIOLITE | Res.COPPER_PORPHYRY | Res.COPPER_NATIVE;
export const RES_NAMES = Object.fromEntries(Object.entries(Res).map(([k, v]) => [v, k.toLowerCase()]));

/** The share of a setting's ground each deposit covers (by its noise field), and the noise's wavelength (km). */
const PATCH = { [Res.COPPER_OPHIOLITE]: 0.35, [Res.COPPER_PORPHYRY]: 0.25, [Res.COPPER_NATIVE]: 0.3, [Res.TIN]: 0.12,
    [Res.OBSIDIAN]: 0.3, [Res.GOLD]: 0.2, [Res.BITUMEN]: 0.3 };
const PATCH_KM = 400, OBSIDIAN_MYR = 10, YOUNG_BELT_MYR = 60;
const FOREST = new Set(['Af', 'Am', 'Cfa', 'Cfb', 'Cfc', 'Cwb', 'Dfa', 'Dfb', 'Dfc', 'Dwb', 'Dwc', 'Dsb', 'Csb']);

/**
 * Per fine cell, a bit set of Res. `frame`: the moment (frame.time, and the world-grid fields on `simMesh`) — none for a
 * world without a history (Earth), whose ores come as `deposits` instead; `fine`: the finished mesh, its z (km), ocean and
 * lake; `sub`: the substrate (civSubstrate: irrigation marks the alluvium).
 */
export function civResources({ frame = null, simMesh = null, fine, z, ocean, lake, koppen, pAnnual, erg, sub, seed = 0, deposits = null }) {
    const n = fine.numCells, xyz = fine.xyz, index = simMesh?.index, t = frame?.time;
    const out = new Uint16Array(n), R = 6371, f = R / PATCH_KM;
    const noise = new FastNoise(((seed | 0) * 0x2c1b + 0x51) >>> 0);
    const patch = (bit, c) => {
        const x = xyz[3 * c], y = xyz[3 * c + 1], w = xyz[3 * c + 2], o = Math.log2(bit) * 17.3;
        return 0.5 + 0.5 * noise.fbm(x * f + o, y * f + 3.1, w * f - o, 3, 0.5) * 1.6 > 1 - PATCH[bit];
    };
    for (let c = 0; c < n; c++) {
        if (ocean[c]) continue;
        let r = 0, platform = sub.relief[c] < 0.5;           // (old sedimentary cover: without a record, the low, gentle country)
        if (frame) {
            const s = index.nearest(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]);
            const type = frame.type[s], flags = frame.flags[s], oro = frame.oroType[s], side = frame.beltSide[s];
            const beltAge = oro ? t - frame.oroLast[s] : Infinity, volc = frame.volcType[s], volcAge = volc ? t - frame.volcAt[s] : Infinity;
            platform = (type === CrustType.CRATON || type === CrustType.CONTINENT) && !oro && volc !== VolcanicType.LIP;
            if (flags & (CrustFlag.SUTURE | CrustFlag.APRON) || (type === CrustType.ARC && beltAge < Infinity)) r |= Res.COPPER_OPHIOLITE;
            if (oro === OrogenyType.ANDEAN || oro === OrogenyType.LARAMIDE || oro === OrogenyType.ARC) r |= Res.COPPER_PORPHYRY | Res.GOLD;
            if (volc === VolcanicType.LIP || flags & CrustFlag.FAILED_RIFT) r |= Res.COPPER_NATIVE;
            if ((oro === OrogenyType.HIMALAYAN || oro === OrogenyType.URAL) && side !== BeltSide.LOWER) r |= Res.TIN | Res.GOLD;
            if (((oro === OrogenyType.ARC || oro === OrogenyType.ANDEAN || oro === OrogenyType.RIFT || oro === OrogenyType.HIMALAYAN) && beltAge < OBSIDIAN_MYR)
                || (volc === VolcanicType.TRACK && volcAge < OBSIDIAN_MYR)) r |= Res.OBSIDIAN;
            if (side === BeltSide.LOWER && beltAge < YOUNG_BELT_MYR && z[c] < 0.6) r |= Res.BITUMEN;
            for (const bit of [Res.COPPER_OPHIOLITE, Res.COPPER_PORPHYRY, Res.COPPER_NATIVE, Res.TIN, Res.OBSIDIAN, Res.GOLD, Res.BITUMEN]) if (r & bit && !patch(bit, c)) r &= ~bit;
        }
        if (lake[c] === Water.SALT || lake[c] === Water.PAN) r |= Res.SALT;
        const code = KOPPEN_CLASSES[koppen[c]]?.code ?? '';
        if (code.startsWith('BW') && sub.coastal[c]) r |= Res.SALT;
        if (lake[c]) { out[c] = r; continue; }
        const alluvium = sub.irrig[c] > 0 && sub.relief[c] < 0.1, sand = erg && erg[c] > 0.3;
        if (!alluvium && !sand) r |= Res.STONE;
        if (!alluvium && !sand && platform) r |= Res.FLINT;
        if (FOREST.has(code) && pAnnual[c] > 500) r |= Res.TIMBER;
        out[c] = r;
    }
    // known deposits (the Earth test: mapped ones, in place of the tectonic record's): [{ lat, lon, bits }]
    if (deposits) {
        const D = Math.PI / 180;
        for (const d of deposits) {
            const la = d.lat * D, lo = d.lon * D, c = fine.index.nearest(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
            if (!ocean[c]) out[c] |= d.bits;
        }
    }
    return out;
}
