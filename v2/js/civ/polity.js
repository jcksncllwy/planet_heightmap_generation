// The civ layer's polities (plans/CIV_PLAN.md §5.5, Phase 4; sources: plans/CIV_SOURCES.md): the towns (settle.js) gathered
// into polities by war and pulled apart by collapse, century by century, kept from one century to the next.
//
//   war       neighbouring polities (towns within warKm of each other) fight, the likelier the fuller their land
//             (Carneiro 1970: war over land as population presses on it). Who wins: Turchin et al. 2013's form,
//             (P_att − P_def)/(P_att + P_def), each side's power growing with its people and falling with distance from its
//             capital (Boulding 1962's loss-of-strength gradient), the defender's with its height (Turchin's γ = 4 per km),
//             and each side's fortune (a lognormal draw: ours).
//   found     a town new to its place belongs to the bigger town whose hinterland it grew in (within its supply reach):
//             a city-state's tiers (Adams 1981's settlement hierarchy; ours as a rule).
//   absorb    a beaten town is absorbed — taxed, not driven off — only where its people cannot leave: the likelier the
//             further it is to free farmland (Carneiro's circumscription; Allen 1997's exit cost). Elsewhere they move
//             away and stay their own. A beaten capital brings its whole polity (ours; Sumer's hegemonies changed hands
//             so — Lugalzagesi's Umma taking Uruk's).
//   collapse  a polity breaks up, the likelier the more towns it holds (Turchin et al. 2013's disintegration, without the
//             cultural traits that hold it together — not modelled yet).
//   famine    a century's famine deaths (sim.js) beyond what the place is used to (its running norm: hardship that is
//             usual is planned for; a shock is not — Hsiang et al. 2013 find conflict rising with the anomaly) make war
//             likelier between hungry neighbours (Zhang et al. 2007: war follows harvest shortfalls) and break polities
//             up (Turchin & Nefedov 2009's secular cycles).
//   state     a polity holding all three tiers above the village (Wright & Johnson 1975).
//
// Deterministic: the same world and history give the same polities.

import { CIV } from './civ-config.js';
import { Life } from './sim.js';
import { MinHeap } from '../core/min-heap.js';
import { towns as townsOf, townNetwork } from './settle.js';

/** A standard normal draw from two uniform ones (Box–Muller). */
const gauss = (u, v) => Math.sqrt(-2 * Math.log(Math.max(1e-12, u))) * Math.cos(2 * Math.PI * v);
const rise = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
const R = 6371;

/** A town's flags in packed snapshots. */
export const TownFlag = Object.freeze({ IRRIGATED: 1, STATE: 2, CAPITAL: 4 });

export class Polities {
    constructor(w, sub, C = CIV) {
        this.w = w; this.sub = sub; this.C = C;
        this.net = townNetwork(w, sub, C);
        this.polityOf = new Int32Array(w.mesh.numCells).fill(-1);
        this.nextId = 0; this.tick = 0;
        this.towns = []; this.polities = new Map();
        this.exit = new Float32Array(w.mesh.numCells);
        this.famineNorm = new Float32Array(w.mesh.numCells);     // (each place's usual famine a step: a running mean)
    }

    /** A hashed chance in [0, 1) for this tick and two numbers: the same each run. */
    chance(a, b) {
        let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(this.tick + 0x27d4eb2f, 0x165667b1);
        h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
        return (h >>> 0) / 4294967296;
    }

    /**
     * One step of `years`: the towns as they now are, then wars and collapses.
     * @param density persons/km² per cell; @param life sim.js Life per cell; @param K what farming feeds per cell (persons/km²)
     * @param famine each cell's famine deaths since the last step, as a share of its people (or null)
     */
    step(density, life, K, years, famine = null) {
        const { w, sub, C, net, polityOf } = this, { mesh } = w, n = mesh.numCells, xyz = mesh.xyz;
        this.tick++;
        // (famine beyond the usual: the shock, then the norm moves toward it)
        let shock = null;
        if (famine) {
            shock = new Float32Array(n);
            const norm = this.famineNorm, a = Math.min(1, years / C.famineNormYears);
            for (let c = 0; c < n; c++) if (famine[c] > 0 || norm[c] > 0) { shock[c] = Math.max(0, famine[c] - norm[c]); norm[c] += a * (famine[c] - norm[c]); }
        }
        // ── the towns now; each keeps its polity, a new one is its own ──
        const T = townsOf(w, sub, density, life, net, C), isTown = new Int32Array(n).fill(-1);
        T.forEach((t, i) => { isTown[t.cell] = i; });
        // (a town's site drifts from century to century as the claims shift: a new site takes the polity of the old town
        // nearest it, within townDriftKm. A town new there grows up in a bigger town's hinterland — within its supply
        // reach, paying it surplus (settle.js) — and is that town's; only one with neither is a polity of its own.
        // Towns come biggest first, so the bigger is placed before)
        const was = new Map(), placed = new Int32Array(n).fill(-1);
        for (const t of this.towns) if (polityOf[t.cell] >= 0) was.set(t.cell, polityOf[t.cell]);
        for (const t of T) {
            let id = was.has(t.cell) ? was.get(t.cell) : -1;
            if (id < 0) for (const [c] of net.reach(t.cell, C.townDriftKm)) if (was.has(c)) { id = was.get(c); break; }
            if (id < 0) for (const [c] of net.reach(t.cell, C.importKm)) if (placed[c] >= 0) { id = placed[c]; break; }
            polityOf[t.cell] = placed[t.cell] = id >= 0 ? id : this.nextId++;
        }
        for (const [c] of was) if (isTown[c] < 0) polityOf[c] = -1;
        const members = () => {
            const P = new Map();
            for (const t of T) {
                const id = polityOf[t.cell];
                let p = P.get(id);
                if (!p) P.set(id, p = { id, towns: [], people: 0 });
                p.towns.push(t); p.people += t.pop;
            }
            for (const p of P.values()) p.capital = p.towns[0];           // (towns come biggest first)
            return P;
        };
        let P = members();
        // ── how far each place is from free farmland: farmable, and empty or thinly farmed (cost in land km) ──
        const exit = this.exit.fill(Infinity), heap = new MinHeap(4096);
        for (let c = 0; c < n; c++) {
            if (!net.land(c) || !(sub.farmDry[c] > 0 || sub.irrig[c] > 0)) continue;
            if (life[c] < Life.FARMER || density[c] < C.freeShare * K[c]) { exit[c] = 0; heap.push(0, c); }
        }
        while (heap.size) {
            const a = heap.pop(), t = heap.lastKey;
            if (t > exit[a]) continue;
            for (let k = mesh.adjOffset[a]; k < mesh.adjOffset[a + 1]; k++) {
                const b = mesh.adjList[k];
                if (!net.land(b)) continue;
                const tb = t + net.cost(a, b, k);
                if (tb < exit[b] && tb <= C.exitKm[1]) { exit[b] = tb; heap.push(tb, b); }
            }
        }
        // ── wars between neighbours: each pair once, at its nearest towns ──
        const pairs = new Map();
        for (const t of T) {
            const a = polityOf[t.cell];
            for (const [c, cost] of net.reach(t.cell, C.warKm)) {
                const j = isTown[c];
                if (j < 0) continue;
                const b = polityOf[c];
                if (b === a) continue;
                const key = a < b ? `${a}|${b}` : `${b}|${a}`, old = pairs.get(key);
                if (!old || cost < old.cost) pairs.set(key, { a, b, ta: t, tb: T[j], cost });
            }
        }
        const pressure = c => (K[c] > 0 ? Math.min(1, density[c] / K[c]) : 0);
        const gc = (c1, c2) => R * Math.acos(Math.min(1, xyz[3 * c1] * xyz[3 * c2] + xyz[3 * c1 + 1] * xyz[3 * c2 + 1] + xyz[3 * c1 + 2] * xyz[3 * c2 + 2]));
        const power = (p, town) => 1 + C.warBeta * (p.people / C.warPowerPeople) * Math.exp(-gc(p.capital.cell, town.cell) / C.strengthKm);
        const taken = new Set(), st = this.stats = { pairs: pairs.size, press: 0, wars: 0, wins: 0, absorbed: 0, collapses: 0 };
        for (const pr of pairs.values()) {
            const pA = P.get(pr.a), pB = P.get(pr.b);
            if (!pA || !pB || taken.has(pr.ta.cell) || taken.has(pr.tb.cell)) continue;
            const hunger = shock ? (shock[pr.ta.cell] + shock[pr.tb.cell]) / 2 : 0;
            const press = (pressure(pr.ta.cell) + pressure(pr.tb.cell)) / 2 * (1 + C.warFamine * hunger);
            st.press += press / pairs.size;
            if (this.chance(pr.ta.cell, pr.tb.cell) >= 1 - Math.exp(-C.warPerCentury * press * years / 100)) continue;
            // (either side may attack; it attacks the other's nearest town)
            st.wars++;
            const aFirst = this.chance(pr.tb.cell, pr.ta.cell) < 0.5;
            const [att, def, town] = aFirst ? [pA, pB, pr.tb] : [pB, pA, pr.ta];
            const from = aFirst ? pr.ta : pr.tb;
            // (and the fortune of war: each side's power × a lognormal draw — Turchin's cells differ by their traits, ours
            // only by their people, and equals would never win)
            const luck = (a, b) => Math.exp(C.warLuck * gauss(this.chance(a, b + 7), this.chance(b, a + 11)));
            const pAtt = power(att, from) * luck(from.cell, town.cell), pDef = (power(def, town) + C.warElevation * Math.max(0, w.z[town.cell])) * luck(town.cell, from.cell);
            const win = Math.max(0, (pAtt - pDef) / (pAtt + pDef));
            if (this.chance(town.cell, this.tick) >= win) continue;
            st.wins++;
            // (beaten: absorbed where there is nowhere to go)
            if (this.chance(from.cell, town.cell + 1) >= rise(C.exitKm[0], C.exitKm[1], exit[town.cell])) continue;
            // (a capital taken takes its polity: its towns follow it)
            const lost = town === def.capital ? def.towns : [town];
            for (const t of lost) { polityOf[t.cell] = att.id; taken.add(t.cell); }
            st.absorbed += lost.length;
        }
        P = members();
        // ── collapse: the bigger, the likelier ──
        for (const p of P.values()) {
            if (p.towns.length < 2) continue;
            let hunger = 0;
            if (shock) { for (const t of p.towns) hunger += shock[t.cell] * t.pop; hunger /= Math.max(1, p.people); }
            const rate = C.collapseBase + C.collapsePerTown * (p.towns.length - 1) + C.collapseFamine * hunger;
            if (this.chance(p.capital.cell, p.id) >= 1 - Math.exp(-rate * years / 100)) continue;
            st.collapses++;
            for (const t of p.towns) polityOf[t.cell] = this.nextId++;
        }
        P = members();
        for (const p of P.values()) {
            const tiers = new Set(p.towns.map(t => t.tier));
            p.state = [1, 2, 3].every(k => tiers.has(k));
        }
        this.towns = T; this.polities = P;
    }

    /** The towns of `minTier` and up, packed for frames: Float32Array [lat, lon, people, TownFlag, polity] each. */
    packed(minTier = 2) {
        const big = this.towns.filter(t => t.tier >= minTier), out = new Float32Array(5 * big.length);
        big.forEach((t, i) => {
            const id = this.polityOf[t.cell], p = this.polities.get(id);
            out.set([t.lat, t.lon, t.pop, (t.irrigated ? TownFlag.IRRIGATED : 0) | (p?.state ? TownFlag.STATE : 0) | (p?.state && p.capital === t ? TownFlag.CAPITAL : 0), id], 5 * i);
        });
        return out;
    }

    /** Counts for a summary: towns, states, the biggest polity's towns. */
    counts() {
        let states = 0, biggest = 0;
        for (const p of this.polities.values()) { if (p.state) states++; biggest = Math.max(biggest, p.towns.length); }
        return { towns: this.towns.length, polities: this.polities.size, states, biggest };
    }
}
