// The parallel ridges inside a mountain belt: thrust sheets and folds stacked along the front. A phasor-noise sum
// (Tricard et al. 2019, as V1's phasor ridges) of kernels placed on the belt's sim cells, each oriented ACROSS the
// belt's strike — the direction in which the recorded distance from the front grows — so the stripes run parallel
// to the front and follow its curves. Where the plates met obliquely the kernels are turned by half the obliquity,
// the way en-echelon folds form in a shear zone: stripes cross the belt at a slant, in short staggered segments
// (fully along a transform; only slightly at an oblique trench or collision, where the sideways motion is partitioned).
// Stripes are asymmetric — a gentle back, a steep face toward the belt's far edge (thrusts verge to the foreland).
// Each kernel's wavelength and direction are jittered a little, so spacing and strike wander and ridges fork and end.
// Kernels belong to the crust (anchor.js): each sits where its crust cell is now and draws its jitter and phases from
// that cell's own stream, so a range keeps its ridges as its plate moves.

import { kindType, kindSide } from './records.js';
import { BeltSide } from '../tectonics/model/crust.js';
import { nearLists } from './near-lists.js';
import { cellRng } from './anchor.js';

const R = 6371, TAU = 2 * Math.PI;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** One kernel per belt cell of a belt layer (records.js beltLayer) that has relief and a direction. */
export function buildStripeKernels(rec, simMesh, cfg, seed, anchor) {
    const { xyz, numCells } = simMesh, { cell, home } = anchor;
    const homes = [], pos = [], dir = [], wave = [], phase = [], phase2 = [], d0 = [], acr = [];
    for (let w = 0; w < numCells; w++) {
        const ax = rec.across[3 * w], ay = rec.across[3 * w + 1], az = rec.across[3 * w + 2];
        if (!rec.kind[w] || rec.reliefKm[w] < 0.02 || !(ax || ay || az)) continue;
        const x = xyz[3 * w], y = xyz[3 * w + 1], z = xyz[3 * w + 2];
        const type = kindType(rec.kind[w]), share = cfg.enEchelonShare[type] ?? cfg.enEchelonShare.other, rng = cellRng(seed, cell[w], 3);
        const jitter = (rng() * 2 - 1) * cfg.stripeAngleJitterDeg;                                  // (no two kernels quite agree)
        const tilt = (share * (rec.shear[w] / 2) + jitter) * Math.PI / 180, c = Math.cos(tilt), s = Math.sin(tilt);      // + dextral → turned counter-clockwise
        const cx = y * az - z * ay, cy = z * ax - x * az, cz = x * ay - y * ax;
        homes.push(w); pos.push(home[3 * w], home[3 * w + 1], home[3 * w + 2]);
        dir.push(ax * c + cx * s, ay * c + cy * s, az * c + cz * s);
        wave.push(cfg.stripeKm[type] * (1 + cfg.stripeWaveJitter * (rng() * 2 - 1)));
        phase.push(rng() * TAU); phase2.push(rng() * TAU);
        // (for crossAt: the cell's distance from the front and its plain across direction — both negative on the lower
        // side of a collision, so the distance runs on through the suture)
        const sign = kindSide(rec.kind[w]) === BeltSide.LOWER ? -1 : 1;
        d0.push(sign * rec.dKm[w]); acr.push(sign * ax, sign * ay, sign * az);
    }
    const reachKm = cfg.stripeBandKm * 2.5;
    const near = nearLists(simMesh, homes, pos, () => reachKm);
    return { count: homes.length, pos: Float32Array.from(pos), dir: Float32Array.from(dir), wave: Float32Array.from(wave),
        phase: Float32Array.from(phase), phase2: Float32Array.from(phase2), d0: Float32Array.from(d0), acr: Float32Array.from(acr),
        near, cut2: (reachKm / R) ** 2 };
}

/**
 * The distance across the belt (km from its front; negative on the lower side of a collision, so it runs on through the
 * suture) at the point w: each kernel's own distance, carried on along its own across direction, blended by the kernels'
 * smooth windows — a coordinate that follows the belt's curves without the steps an interpolation over the sim mesh's
 * triangles has where a belt's kind changes. out[0] = the distance, out[1] = the kernels' total weight (0: no belt).
 */
export function crossAt(K, c0, wx, wy, wz, out) {
    const { offset, items } = K.near, { pos, acr, d0, cut2 } = K;
    let s = 0, sum = 0;
    for (let j = offset[c0]; j < offset[c0 + 1]; j++) {
        const k = items[j], dx = wx - pos[3 * k], dy = wy - pos[3 * k + 1], dz = wz - pos[3 * k + 2], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= cut2) continue;
        const q = 1 - d2 / cut2, g = q * q * q;
        s += g * (d0[k] + (dx * acr[3 * k] + dy * acr[3 * k + 1] + dz * acr[3 * k + 2]) * R);
        sum += g;
    }
    out[0] = sum > 1e-9 ? s / sum : 0;
    out[1] = sum;
}

/** An asymmetric ridge profile of a phase angle: −1 in the valley, +1 on the crest, the steep face after the crest. */
function ridge(theta) {
    const t = theta / TAU + 0.5, r = 0.65;
    let v = t < r ? t / r : (1 - t) / (1 - r);
    v = v * v * (3 - 2 * v);
    return 2 * v - 1;
}

/**
 * The stripe value (about −1…+1, plus a finer set) at the terrain point p, whose nearest sim cell is c0; w* is p
 * displaced by the meander warp. K.fade1 / K.fade2 (per kernel, set by the caller for its mesh) remove waves of the main
 * and fine set that the terrain mesh is too coarse to show.
 */
export function stripeAt(K, c0, px, py, pz, wx, wy, wz, fineShare, fineRatio) {
    const { offset, items } = K.near, { pos, dir, wave, phase, phase2, cut2, fade1, fade2 } = K;
    let re = 0, im = 0, re2 = 0, im2 = 0, sum = 0, fadeSum = 0, fineSum = 0;
    // how well the kernels agree on a direction (as lines: 0 = every way, 1 = all parallel), in a frame at p
    let rx = 0, ry = 0, rz = 0, qx = 0, qy = 0, qz = 0, c2 = 0, s2 = 0;
    for (let j = offset[c0]; j < offset[c0 + 1]; j++) {
        const k = items[j], kx = pos[3 * k], ky = pos[3 * k + 1], kz = pos[3 * k + 2];
        const dx = px - kx, dy = py - ky, dz = pz - kz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= cut2) continue;
        const q = 1 - d2 / cut2, g = q * q * q;                          // compact smooth window
        const lam = wave[k], f1 = fade1[k];
        if (f1 <= 0 && fineShare <= 0) continue;
        const dxk = dir[3 * k], dyk = dir[3 * k + 1], dzk = dir[3 * k + 2];
        if (!(rx || ry || rz)) { rx = dxk; ry = dyk; rz = dzk; qx = py * rz - pz * ry; qy = pz * rx - px * rz; qz = px * ry - py * rx; }
        const ca = dxk * rx + dyk * ry + dzk * rz, sa = dxk * qx + dyk * qy + dzk * qz, n2 = ca * ca + sa * sa || 1;
        c2 += g * (ca * ca - sa * sa) / n2; s2 += g * 2 * ca * sa / n2;
        const s = ((wx - kx) * dxk + (wy - ky) * dyk + (wz - kz) * dzk) * R;   // km along the kernel's direction
        const a = TAU * s / lam + phase[k];
        re += g * Math.cos(a); im += g * Math.sin(a);
        sum += g; fadeSum += g * f1;
        const f2 = fade2[k];
        if (f2 > 0) { const b = TAU * s * fineRatio / lam + phase2[k]; re2 += g * f2 * Math.cos(b); im2 += g * f2 * Math.sin(b); fineSum += g * f2; }
    }
    if (sum <= 1e-9) return 0;
    // where the kernels cancel, or point every which way, the phase means nothing: no stripes there (they would be blobs)
    const agree = Math.hypot(c2, s2) / sum, coherent = Math.min(1, Math.hypot(re, im) / (0.15 * sum)) * smooth(0.35, 0.75, agree);
    let v = (fadeSum / sum) * coherent * ridge(Math.atan2(im, re));
    if (fineSum > 0) v += fineShare * (fineSum / sum) * Math.min(1, Math.hypot(re2, im2) / (0.15 * fineSum)) * smooth(0.35, 0.75, agree) * ridge(Math.atan2(im2, re2));
    return v;
}
