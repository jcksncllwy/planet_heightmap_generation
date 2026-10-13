// Ocean stage: wind-driven currents, and the heat they move — for the temperature stage. DOM-free.
//
//  • Gyres. The wind's stress on the sea, curled, drives a steady circulation: in the open ocean the Sverdrup
//    balance, closed by a narrow, fast current along each basin's western edge (Stommel's model:
//    r∇²Ψ + β ∂Ψ/∂x = curl τ / ρ₀ for the transport streamfunction Ψ, Ψ fixed along every coast). This gives the
//    Gulf Stream and the Kuroshio, and cold equatorward currents on the eastern side, on any map.
//  • Circumpolar channels. Where a whole latitude band is open sea (the Southern Ocean on Earth), the westerlies
//    drive an eastward current round the planet, balanced by friction; the landmasses on either side then sit at
//    different Ψ, which lets that current through.
//  • Heat. Currents carry the surface temperature: warm water poleward along western edges, cold water equatorward
//    along eastern ones (advective heating, from the currents and the sea temperature). Where the winds push
//    surface water away (Ekman transport — along coasts with the coast on the left in the north, at the equator),
//    cold water wells up from below. Both become a heat source / sink for the sea's mixed layer, which the
//    temperature stage adds to its energy balance; the winds carry the result inland (a mild Europe, cool
//    California and Namib coasts).
//  • Seasons (plans/V1_NEW_CLIMATE_PLAN.md, "Seasonal currents"). The model is linear in the wind stress, so it is solved
//    for the year's mean stress and for its annual cycle (the first harmonic, two more solves), and each month's
//    gyres are the mean plus that month's part of the cycle. Real gyres adjust to the wind over months near the
//    equator but years at midlatitudes (the planetary waves that set them up are slow there), so the seasonal part is
//    whole in the tropics and fades out poleward (OCEAN_SEASON_FULL_DEG → OCEAN_SEASON_ZERO_DEG): the monsoon seas'
//    currents reverse (the Somali Current), the equatorial currents swell and ebb, the great gyres hold steady. The
//    Ekman transport answers each month's wind at once at every latitude, so the upwelling follows the month (the
//    summer monsoon's cold Arabian Sea, California's spring and summer). The heat they carry is monthly too.
//  • The overturning. Warm surface water also flows poleward to the seas that open onto the polar ocean, sinks there
//    and gives up its heat (the North Atlantic Drift: a mild north-west Europe, an ice-free Norwegian Sea). It forms in
//    a hemisphere's seas that reach the polar ocean through open water from the midlatitudes (the Atlantic through the
//    Nordic seas; not the Pacific, closed at the Bering Strait) and not beyond a circumpolar channel (its current
//    blocks the way, as the Antarctic Circumpolar Current does).

import { LatLonGrid, coarsenField, refineField } from './grid.js';
import { HelmholtzSolver } from './solver.js';
import { PARAMS } from './config.js';

const OMEGA_ROT = 7.292e-5;
const R_PLANET = 6.371e6;
const RHO_AIR = 1.2, RHO_SEA = 1025, CP_SEA = 3990;
const DRAG_COEFF = 1.3e-3;           // air–sea drag coefficient
const DEG = Math.PI / 180;
const CARRY_TRACE_KM = 1500;         // how far back a current's water keeps the temperature of where it came from …
const CARRY_CALM_MS = 0.005;         // … faded where the surface current is below about this (m/s)
const MOC_FROM_DEG = 40;             // the overturning's heat is released poleward of this latitude …
const MOC_FULL_DEG = 55;             // … fully from here …
const MOC_POLAR_DEG = 75;            // … in seas connected to the polar sea (poleward of this) …
const MOC_REACH_KM = 2500;           // … most near the polar opening (e-folding distance by sea)

/**
 * stage(ctx, circulation, temperature) → { psi (G, Sv), u, v (G, surface current m/s, annual), qflux (G, W/m², annual:
 * advection + upwelling + overturning), carried (G, °C: the latitude-average sea temperature where each current's
 * water comes from, minus here), upwelling (G, m/day), monthly: { u, v, qflux, upwelling (12 × G, mid-month) }, channels,
 * ms }. Fields on the core grid; the annual ones are the months' means.
 */
/**
 * Heat of the overturning (W/m², G): per hemisphere without a circumpolar channel, the sea poleward of MOC_FROM_DEG
 * connected to the polar sea (≥ MOC_POLAR_DEG) gets the heat, weighted by e^{−(distance by sea from the polar sea)/
 * MOC_REACH_KM} and a ramp from MOC_FROM_DEG to MOC_FULL_DEG — most in the seas nearest the polar opening. (The same
 * heat is taken from all the sea evenly, with the rest of the ocean's net, below: taking it from the hemisphere's
 * tropics alone cooled them enough to move the rain belts.)
 */
function overturningHeat(g, isSea, channels, pw) {
    const G = g.size, w = g.w, h = g.h, dRad = g.step * DEG;
    const q = new Float64Array(G);
    if (!(pw > 0)) return q;
    const area = (j) => R_PLANET * R_PLANET * dRad * dRad * Math.cos(g.lat[j] * DEG);
    const stepKm = g.step * 111.2;
    for (const s of [1, -1]) {
        // a channel between the midlatitudes and the polar sea blocks it (an open polar cap is not one)
        if (channels.some(ch => [ch.jStart, ch.jEnd].some(jj => s * g.lat[jj] > 0 && s * g.lat[jj] < MOC_POLAR_DEG))) continue;
        // distance by sea from the polar sea, over the sea poleward of MOC_FROM_DEG (breadth-first, ≈ km)
        const dist = new Float64Array(G).fill(Infinity), queue = [];
        for (let j = 0; j < h; j++) if (s * g.lat[j] >= MOC_POLAR_DEG) for (let i = 0; i < w; i++) { const c = j * w + i; if (isSea[c]) { dist[c] = 0; queue.push(c); } }
        for (let k = 0; k < queue.length; k++) {
            const c = queue[k], j = Math.floor(c / w), i = c % w;
            const nb = [j * w + (i + 1) % w, j * w + (i - 1 + w) % w, j > 0 ? c - w : -1, j < h - 1 ? c + w : -1];
            for (const n of nb) {
                if (n < 0 || !isSea[n] || s * g.lat[Math.floor(n / w)] < MOC_FROM_DEG) continue;
                const d = dist[c] + (n === c - w || n === c + w ? stepKm : stepKm * Math.cos(g.lat[j] * DEG));
                if (d < dist[n]) { dist[n] = d; queue.push(n); }
            }
        }
        let wsum = 0;
        const wt = new Float64Array(G);
        for (let j = 0; j < h; j++) {
            const la = s * g.lat[j];
            const ramp = Math.max(0, Math.min(1, (la - MOC_FROM_DEG) / (MOC_FULL_DEG - MOC_FROM_DEG)));
            for (let i = 0; i < w; i++) {
                const c = j * w + i; if (!isSea[c]) continue;
                if (la >= MOC_FROM_DEG && dist[c] < Infinity) { wt[c] = ramp * ramp * (3 - 2 * ramp) * Math.exp(-dist[c] / MOC_REACH_KM); wsum += wt[c] * area(j); }
            }
        }
        if (!(wsum > 0)) continue;
        const P = pw * 1e15;
        for (let j = 0; j < h; j++) { const la = s * g.lat[j]; for (let i = 0; i < w; i++) {
            const c = j * w + i; if (!isSea[c]) continue;
            if (wt[c] > 0) q[c] += P * wt[c] / wsum;
        } }
    }
    return q;
}

export function windDrivenOcean() {
    return (ctx, circ, temperature) => {
        const t0 = performance.now();
        const P = { ...PARAMS };
        const core = ctx.grid;
        const ratio = Math.round(P.OCEAN_GRID_DEG / core.step);
        const g = ratio > 1 ? new LatLonGrid(core.step * ratio) : core;
        const G = g.size, w = g.w, h = g.h;
        const co = (f) => coarsenField(core, g, ratio, f);
        const land = co(ctx.surface.landFrac);
        const isSea = new Uint8Array(G);
        for (let c = 0; c < G; c++) isSea[c] = land[c] < 0.5 ? 1 : 0;
        const dRad = g.step * DEG;
        const cosLat = Float64Array.from(g.lat, l => Math.cos(l * DEG));

        // ── Each month's wind stress (from the monthly winds: τ = ρ_a C_d |U| U) and sea temperature, and their means ──
        const tx = new Float64Array(G), ty = new Float64Array(G), sst = new Float64Array(G);
        const txM = new Float64Array(12 * G), tyM = new Float64Array(12 * G), sstM = new Float64Array(12 * G);
        const uM = new Float64Array(G), vM = new Float64Array(G), tM = new Float64Array(G);
        for (let m = 0; m < 12; m++) {
            uM.set(co(circ.u.subarray(m * core.size, (m + 1) * core.size)));
            vM.set(co(circ.v.subarray(m * core.size, (m + 1) * core.size)));
            tM.set(co(temperature.monthlySL.subarray(m * core.size, (m + 1) * core.size)));
            for (let c = 0; c < G; c++) {
                // bulk stress with the storms the monthly mean leaves out: the typical speed, not the mean vector's
                const s = Math.sqrt(uM[c] * uM[c] + vM[c] * vM[c] + P.OCEAN_GUST_MS * P.OCEAN_GUST_MS), k = m * G + c;
                txM[k] = RHO_AIR * DRAG_COEFF * s * uM[c]; tyM[k] = RHO_AIR * DRAG_COEFF * s * vM[c]; sstM[k] = Math.max(-1.8, tM[c]);
                tx[c] += txM[k] / 12; ty[c] += tyM[k] / 12; sst[c] += sstM[k] / 12;
            }
        }
        // the stress's annual cycle: its first harmonic, x(t) ≈ x̄ + 2(x₁ᵣ cos θ − x₁ᵢ sin θ), θ = 2πt/12, month m at t = m + ½
        const seasonal = P.OCEAN_SEASON_SCALE > 0;
        const phase = m => 2 * Math.PI * (m + 0.5) / 12;
        const tx1r = new Float64Array(G), tx1i = new Float64Array(G), ty1r = new Float64Array(G), ty1i = new Float64Array(G);
        if (seasonal) for (let m = 0; m < 12; m++) {
            const cm = Math.cos(phase(m)) / 12, sm = Math.sin(phase(m)) / 12;
            for (let c = 0; c < G; c++) { const k = m * G + c; tx1r[c] += txM[k] * cm; tx1i[c] -= txM[k] * sm; ty1r[c] += tyM[k] * cm; ty1i[c] -= tyM[k] * sm; }
        }

        // ── Wind-stress curl (N/m³) ──
        const curlOf = (sx, sy) => {
            const out = new Float64Array(G);
            for (let j = 0; j < h; j++) {
                const cj = Math.max(0.05, cosLat[j]);
                for (let i = 0; i < w; i++) {
                    const c = j * w + i;
                    const dtydl = (sy[j * w + (i + 1) % w] - sy[j * w + (i - 1 + w) % w]) / (2 * dRad);
                    const txN = j > 0 ? sx[c - w] * cosLat[j - 1] : sx[c] * cosLat[j], txS = j < h - 1 ? sx[c + w] * cosLat[j + 1] : sx[c] * cosLat[j];
                    const dtxdp = (txN - txS) / ((j > 0 && j < h - 1 ? 2 : 1) * dRad);
                    out[c] = (dtydl - dtxdp) / (R_PLANET * cj);
                }
            }
            return out;
        };
        const curl = curlOf(tx, ty);

        // ── Circumpolar channels: latitude rows that are open sea all round; eastward current, friction-balanced ──
        const openRow = new Uint8Array(h);
        for (let j = 0; j < h; j++) { let all = true; for (let i = 0; i < w && all; i++) all = isSea[j * w + i] === 1; openRow[j] = all ? 1 : 0; }
        // transport per row (m³/s) of the channel's zonal-mean wind stress over friction; psiRef[j]: the Ψ a landmass
        // takes if it lies just north of row j (from the south pole)
        const channelsOf = (sx) => {
            let psiAcc = 0;
            const psiRef = new Float64Array(h), channels = [];
            for (let j = h - 1; j >= 0; j--) {
                if (openRow[j]) {
                    let txm = 0; for (let i = 0; i < w; i++) txm += sx[j * w + i]; txm /= w;
                    const U = txm / (RHO_SEA * P.OCEAN_CHANNEL_DRAG);     // depth-integrated eastward transport per width (m²/s)
                    psiAcc -= U * R_PLANET * dRad;                         // Ψ decreases northward for eastward flow (U = −∂Ψ/∂y)
                    if (!channels.length || channels[channels.length - 1].jEnd !== j + 1) channels.push({ jStart: j, jEnd: j, transport: 0 });
                    const ch = channels[channels.length - 1]; ch.jEnd = j; ch.transport += U * R_PLANET * dRad;
                }
                psiRef[j] = psiAcc;
            }
            return { psiRef, channels };
        };
        const { channels } = channelsOf(tx);

        // ── Stommel: −r∇²Ψ − 2Ω ∂Ψ/∂λ = −a² curl τ / ρ₀ over the sea; Ψ held at its coast value on land ──
        // (the solver's form σΨ − D∇²Ψ + (γu·∇)Ψ = f on the unit sphere; the β term as an eastward "advection"
        // coefficient −2Ω·a·cos φ; land by a large σ pinning Ψ to the landmass's value)
        const r = P.OCEAN_FRICTION;
        const sigma = new Float64Array(G), zeroI = new Float64Array(G), gu = new Float64Array(G), gv = new Float64Array(G);
        const pin = 1e3 * r / (dRad * dRad);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            const c = j * w + i;
            gu[c] = -2 * OMEGA_ROT * R_PLANET * cosLat[j];
            // land and the open channel rows are held at their Ψ (in a channel, the friction-balanced current)
            if (!(isSea[c] && !openRow[j])) sigma[c] = pin;
        }
        // friction: east–west sets the western boundary current's width; north–south kept small so the open ocean
        // keeps its Sverdrup balance (isotropic friction wide enough for the grid smears the gyres — Stommel box test)
        const solver = new HelmholtzSolver(g, P.OCEAN_FRICTION_NS, r);
        solver.setOperator(sigma, zeroI, gu, gv, 1);
        /** The gyres of a wind stress (linear in it): Ψ, and the depth-integrated transport U = −∂Ψ/∂y, V = ∂Ψ/∂x. */
        const gyres = (sx, sy, sCurl) => {
            const { psiRef } = channelsOf(sx);
            // Solve for the departure Ψ' from the held values (Ψ = Ψ_ref + Ψ'), so the convergence test measures the open
            // sea and not the large pinning terms: Ψ' = 0 where held, A·Ψ' = f − A·Ψ_ref over the sea.
            const f = new Float64Array(G), fi = new Float64Array(G);
            const psiRow = new Float64Array(G), psiRowI = new Float64Array(G), Aref = new Float64Array(G), ArefI = new Float64Array(G);
            for (let c = 0; c < G; c++) psiRow[c] = psiRef[Math.floor(c / w)];
            solver.apply(psiRow, psiRowI, Aref, ArefI);
            for (let c = 0; c < G; c++) f[c] = sigma[c] > 0 ? 0 : -R_PLANET * R_PLANET * sCurl[c] / RHO_SEA - Aref[c];
            const psi = new Float64Array(G), psiI = new Float64Array(G);
            const stats = solver.solve(f, fi, psi, psiI, { maxCycles: 80, tol: 1e-10 });
            for (let c = 0; c < G; c++) psi[c] += psiRow[c];
            const U = new Float64Array(G), V = new Float64Array(G);
            for (let j = 0; j < h; j++) {
                const cj = Math.max(0.05, cosLat[j]);
                for (let i = 0; i < w; i++) {
                    const c = j * w + i;
                    if (!isSea[c]) continue;
                    const pn = j > 0 ? psi[c - w] : psi[c], ps = j < h - 1 ? psi[c + w] : psi[c];
                    U[c] = -(pn - ps) / ((j > 0 && j < h - 1 ? 2 : 1) * dRad * R_PLANET);
                    V[c] = (psi[j * w + (i + 1) % w] - psi[j * w + (i - 1 + w) % w]) / (2 * dRad * R_PLANET * cj);
                }
            }
            return { psi, U, V, stats };
        };
        const mean = gyres(tx, ty, curl), psi = mean.psi, U = mean.U, V = mean.V, solveStats = mean.stats;

        // ── Each month's currents: the mean, plus the month's part of the annual cycle where the gyres can follow it —
        // whole to OCEAN_SEASON_FULL_DEG, fading (smoothly) to nothing at OCEAN_SEASON_ZERO_DEG ──
        const UM = new Float64Array(12 * G), VM = new Float64Array(12 * G);
        for (let m = 0; m < 12; m++) { UM.set(U, m * G); VM.set(V, m * G); }
        if (seasonal) {
            const re = gyres(tx1r, ty1r, curlOf(tx1r, ty1r)), im = gyres(tx1i, ty1i, curlOf(tx1i, ty1i));
            const fade = new Float64Array(h);
            for (let j = 0; j < h; j++) {
                const x = Math.max(0, Math.min(1, (Math.abs(g.lat[j]) - P.OCEAN_SEASON_FULL_DEG) / Math.max(1e-6, P.OCEAN_SEASON_ZERO_DEG - P.OCEAN_SEASON_FULL_DEG)));
                fade[j] = P.OCEAN_SEASON_SCALE * (1 - x * x * (3 - 2 * x));
            }
            for (let m = 0; m < 12; m++) {
                const cm = 2 * Math.cos(phase(m)), sm = 2 * Math.sin(phase(m));
                for (let c = 0; c < G; c++) {
                    if (!isSea[c]) continue;
                    const k = m * G + c, fj = fade[Math.floor(c / w)];
                    UM[k] += fj * (re.U[c] * cm - im.U[c] * sm);
                    VM[k] += fj * (re.V[c] * cm - im.V[c] * sm);
                }
            }
        }

        // ── Heat: advection of the sea temperature by the currents, and upwelling ──
        // Across latitudes, what a current carries is relative: flowing poleward it brings the warmer water of the
        // latitudes it comes from, flowing equatorward the colder — so its heat is its north–south transport across
        // the gradient of the latitude's average sea temperature (smoothed over ≈ ±6°), not the model's own local
        // sea temperature (already evened out by the energy balance, which would carry almost nothing). East–west,
        // the local sea temperature (the equatorial currents carry the cold east Pacific west).
        const rowsOf = (sstF) => {
            const seaRow = new Float64Array(h), dTdy = new Float64Array(h);
            for (let j = 0; j < h; j++) { let s = 0, n = 0; for (let i = 0; i < w; i++) { const c = j * w + i; if (isSea[c]) { s += sstF[c]; n++; } } seaRow[j] = n ? s / n : NaN; }
            for (let j = 0; j < h; j++) if (!(seaRow[j] === seaRow[j])) { let jj = j; while (jj > 0 && !(seaRow[jj] === seaRow[jj])) jj--; seaRow[j] = seaRow[jj] === seaRow[jj] ? seaRow[jj] : 0; }
            const rowSm = new Float64Array(h), rSm = Math.max(1, Math.round(6 / g.step));
            for (let j = 0; j < h; j++) { let s = 0, n = 0; for (let d = -rSm; d <= rSm; d++) { const jj = j + d; if (jj >= 0 && jj < h) { s += seaRow[jj]; n++; } } rowSm[j] = s / n; }
            for (let j = 0; j < h; j++) { const jn = Math.max(0, j - 1), js = Math.min(h - 1, j + 1); dTdy[j] = (rowSm[jn] - rowSm[js]) / ((js - jn) * dRad * R_PLANET); }
            return { rowSm, dTdy };
        };
        const fMin = 2 * OMEGA_ROT * Math.sin(5 * DEG);
        /** One period's heat (W/m²) from its stress, currents and sea temperature: advection, upwelling (and m/s of it). */
        const heatOf = (sx, sy, Uc, Vc, sstF) => {
            const { dTdy } = rowsOf(sstF);
            const qAdv = new Float64Array(G), qUp = new Float64Array(G), wUp = new Float64Array(G);
            const Mx = new Float64Array(G), My = new Float64Array(G);           // Ekman transport (m²/s), zero on land
            for (let j = 0; j < h; j++) {
                let fc = 2 * OMEGA_ROT * Math.sin(g.lat[j] * DEG);
                if (Math.abs(fc) < fMin) fc = fc < 0 ? -fMin : fMin;
                for (let i = 0; i < w; i++) {
                    const c = j * w + i;
                    if (!isSea[c]) continue;
                    Mx[c] = sy[c] / (RHO_SEA * fc); My[c] = -sx[c] / (RHO_SEA * fc);
                }
            }
            for (let j = 0; j < h; j++) {
                const cj = Math.max(0.05, cosLat[j]), dx = dRad * R_PLANET * cj, dy = dRad * R_PLANET;
                for (let i = 0; i < w; i++) {
                    const c = j * w + i;
                    if (!isSea[c]) continue;
                    const ce = j * w + (i + 1) % w, cw = j * w + (i - 1 + w) % w, cn = j > 0 ? c - w : -1, cs = j < h - 1 ? c + w : -1;
                    // upwind gradient of the sea temperature (sea neighbours only)
                    const Tc = sstF[c];
                    let gx = 0, gy = 0;
                    if (Uc[c] > 0 && isSea[cw]) gx = (Tc - sstF[cw]) / dx; else if (Uc[c] < 0 && isSea[ce]) gx = (sstF[ce] - Tc) / dx;
                    qAdv[c] = -RHO_SEA * CP_SEA * (P.OCEAN_HEAT_SHARE * Uc[c] * gx + P.OCEAN_MERID_SHARE * Vc[c] * dTdy[j]);
                    // Ekman divergence → upwelling (m/s); land neighbours carry no Ekman transport
                    const div = (Mx[ce] - Mx[cw]) / (2 * dx) + ((cn >= 0 ? My[cn] * cosLat[j - 1] : 0) - (cs >= 0 ? My[cs] * cosLat[j + 1] : 0)) / (2 * dy * cj);
                    // at a coast, the Ekman transport straight offshore wells up within the coastal cell (one-sided: the
                    // centred divergence spreads it over two cells)
                    let coastW = 0;
                    if (!isSea[ce]) coastW += Math.max(0, -Mx[c]) / dx;
                    if (!isSea[cw]) coastW += Math.max(0, Mx[c]) / dx;
                    if (cn >= 0 && !isSea[cn]) coastW += Math.max(0, -My[c]) / dy;
                    if (cs >= 0 && !isSea[cs]) coastW += Math.max(0, My[c]) / dy;
                    const wv = Math.max(0, div, coastW);
                    wUp[c] = wv;
                    const thermo = Math.max(0, Math.min(1, (Tc - 2) / 15));      // cold polar water has little to upwell
                    qUp[c] = -RHO_SEA * CP_SEA * wv * P.OCEAN_UPWELL_DT * thermo;
                }
            }
            return { qAdv, qUp, wUp };
        };
        // ── What each current carries: the temperature of the latitudes its water comes from. Traced back along the
        // current for CARRY_TRACE_KM (as far as surface water keeps its temperature against the air: a few months at
        // the gyres' speeds), the average sea temperature there minus here — a poleward current warm, an equatorward
        // one cold, a slow broad current as much as a fast narrow one; faded where the sea barely moves. (The year's
        // currents: it is the sea's lasting warm and cold.) ──
        const carried = new Float64Array(G);
        {
            const { rowSm } = rowsOf(sst);
            const nSteps = Math.max(1, Math.round(CARRY_TRACE_KM / (g.step * 111.2)));
            const tzAt = (y) => { const yy = Math.max(0, Math.min(h - 1, y - 0.5)), j0 = Math.floor(yy), f = yy - j0; return rowSm[j0] * (1 - f) + rowSm[Math.min(h - 1, j0 + 1)] * f; };
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const c = j * w + i; if (!isSea[c]) continue;
                const sp0 = Math.hypot(U[c], V[c]); if (!(sp0 > 0)) continue;
                let y = j + 0.5, x = i + 0.5;
                for (let k = 0; k < nSteps; k++) {
                    const cc = Math.floor(y) * w + ((Math.floor(x) % w) + w) % w, sp = Math.hypot(U[cc], V[cc]);
                    if (!(sp > 0)) break;
                    const cls = Math.max(0.1, cosLat[Math.floor(y)]);
                    const ny = y + V[cc] / sp, nx = x - U[cc] / sp / cls;                // one cell upstream (rows run south)
                    if (ny < 0 || ny >= h || !isSea[Math.floor(ny) * w + ((Math.floor(nx) % w) + w) % w]) break;
                    y = ny; x = nx;
                }
                carried[c] = (tzAt(y) - tzAt(j + 0.5)) * Math.tanh(sp0 / P.OCEAN_CURRENT_DEPTH_M / CARRY_CALM_MS);
            }
        }
        // the overturning: OCEAN_OVERTURN_PW per hemisphere, released over the seas the polar ocean opens onto
        const qMoc = overturningHeat(g, isSea, channels, P.OCEAN_OVERTURN_PW);
        // The heat of a period: advection + overturning + upwelling, less the net (the ocean moves heat, it does not make
        // it; area-weighted over the sea), capped. Seasonal: each month from its own stress, currents and sea; else the
        // year's (as before seasons: the months then all carry the year's heat).
        const qOf = (H) => {
            let net = 0, area = 0;
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = j * w + i; if (!isSea[c]) continue; net += (H.qAdv[c] + qMoc[c] + H.qUp[c]) * cosLat[j]; area += cosLat[j]; }
            net /= area;
            const q = new Float64Array(G);
            for (let c = 0; c < G; c++) q[c] = isSea[c] ? Math.max(-P.OCEAN_QFLUX_MAX, Math.min(P.OCEAN_QFLUX_MAX, H.qAdv[c] + qMoc[c] + H.qUp[c] - net)) : 0;
            return q;
        };
        const q = new Float64Array(G), qAdv = new Float64Array(G), qUp = new Float64Array(G), wUp = new Float64Array(G);
        const qM = new Float64Array(12 * G), wUpM = new Float64Array(12 * G);
        if (seasonal) {
            for (let m = 0; m < 12; m++) {
                const sl = (f) => f.subarray(m * G, (m + 1) * G);
                const H = heatOf(sl(txM), sl(tyM), sl(UM), sl(VM), sl(sstM)), qm = qOf(H);
                qM.set(qm, m * G); wUpM.set(H.wUp, m * G);
                for (let c = 0; c < G; c++) { q[c] += qm[c] / 12; qAdv[c] += H.qAdv[c] / 12; qUp[c] += H.qUp[c] / 12; wUp[c] += H.wUp[c] / 12; }
            }
        } else {
            const H = heatOf(tx, ty, U, V, sst);
            q.set(qOf(H)); qAdv.set(H.qAdv); qUp.set(H.qUp); wUp.set(H.wUp);
            for (let m = 0; m < 12; m++) { qM.set(q, m * G); wUpM.set(wUp, m * G); }
        }
        for (let c = 0; c < G; c++) qAdv[c] += qMoc[c];

        // ── To the core grid ──
        const out = (src) => { const o = new Float32Array(core.size); refineField(g, core, ratio, src, o, 0); return o; };
        const outM = (src) => { const o = new Float32Array(12 * core.size); for (let m = 0; m < 12; m++) refineField(g, core, ratio, src.subarray(m * G, (m + 1) * G), o.subarray(m * core.size, (m + 1) * core.size), 0); return o; };
        const surf = (x, c) => (isSea[c % G] ? x / P.OCEAN_CURRENT_DEPTH_M : 0);
        return {
            psi: out(psi.map(x => x / 1e6)), u: out(U.map(surf)), v: out(V.map(surf)), qflux: out(q), qAdvection: out(qAdv), qUpwelling: out(qUp), qOverturning: out(qMoc), carried: out(carried),
            upwelling: out(wUp.map(x => x * 86400)), seaMask: out(Float64Array.from(isSea)), curl: out(curl),
            // (null without seasons: the temperature stage then takes the year's heat, as before)
            monthly: seasonal ? { u: outM(UM.map(surf)), v: outM(VM.map(surf)), qflux: outM(qM), upwelling: outM(wUpM.map(x => x * 86400)) } : null,
            stress: { x: out(tx), y: out(ty) },
            channels: channels.map(ch => ({ fromLat: g.lat[ch.jStart], toLat: g.lat[ch.jEnd], transportSv: ch.transport / 1e6 })),
            solver: solveStats, ms: performance.now() - t0, source: 'wind-driven ocean',
        };
    };
}
