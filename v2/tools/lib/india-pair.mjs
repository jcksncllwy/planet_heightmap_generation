// The India–Asia pair in a run of the India scene (scenarios/force-scenes.js 'india', and the budget and terrain scenes built
// on it). India has neighbours of its own there — Antarctica across its ridge, Africa and Australia across transforms — and
// they collide too, with Asia and with India, so a check about India meeting Asia reads the pair, not the world's first
// collision or every belt (sessrumnir's ruling (A), lane gpelock 2026-11-25). Shared by check-phase5, -7c and -8a.
import { spreadKm } from '../../js/core/min-heap.js';
import { EventKind } from '../../js/tectonics/model/world.js';
import { isLand } from './check-kit.mjs';

/** The pair, read off a run's first frame (each plate's id and its land's terranes as built) and its event log:
 *  contact / suture — the pair's collision and weld events, by plate id (each side's id, plus the ids of the plates it was
 *    welded into before the pair's own weld);
 *  rec — the collision record the weld closed, or before a weld the pair's open one (given the world); indiaIds / asiaIds;
 *  pairT — India's and Asia's terranes; sideT(id) — the terranes of the side a plate id is on; ownTerrane / ours — land no
 *    neighbour brought (an arc's counts as the pair's);
 *  isOverlap / overlapCount — overlap whose owner and collider are the pair;
 *  beltScope(frame) — a cell is the pair's belt if it is nearer the other side's land than any neighbour's (on India,
 *    nearer Asia's; elsewhere, nearer India's): Asia's coast is indented by Africa and Australia too, and Australia's arcs
 *    reach India. */
export function indiaAsiaPair(first, events, mesh, world = null) {
    const { numCells } = mesh, built = new Map();
    for (const p of first.plates) {
        if (p.isBackground) continue;
        const terranes = new Set();
        for (let w = 0; w < numCells; w++) if (first.owner[w] === p.id && isLand(first, w)) terranes.add(first.terrane[w]);
        built.set(p.name, { id: p.id, terranes });
    }
    const india = built.get('India'), asia = built.get('Asia'), gi = new Set([india.id]), ga = new Set([asia.id]);
    const otherT = new Set([...built].filter(([name]) => name !== 'India' && name !== 'Asia').flatMap(([, b]) => [...b.terranes]));
    const isPair = (u, l) => (gi.has(u) && ga.has(l)) || (ga.has(u) && gi.has(l));
    let contact, suture;
    for (const e of events) {
        const u = e.data?.upper, l = e.data?.lower;
        if (u === undefined || suture) continue;
        if (e.kind === EventKind.COLLISION && !contact && isPair(u, l)) contact = e;
        if (e.kind === EventKind.SUTURE) { if (isPair(u, l)) suture = e; else for (const g of [gi, ga]) if (g.has(l)) g.add(u); }
    }
    // (the record: the one the weld closed, or before a weld the pair's open one)
    const recs = world ? [...world.collisions.values()] : [];
    const rec = suture ? recs.find(c => c.upper === suture.data.upper && c.lower === suture.data.lower) : recs.find(c => isPair(c.upper, c.lower));
    const pairT = new Set([...india.terranes, ...asia.terranes]);
    const sideT = id => (gi.has(id) ? india.terranes : asia.terranes), ownTerrane = t => !otherT.has(t), ours = (f, w) => ownTerrane(f.terrane[w]);
    const isOverlap = (f, w) => f.overlap[w] === 2 && isPair(f.owner[w], f.collider[w]);
    const overlapCount = f => { let n = 0; for (let w = 0; w < numCells; w++) if (isOverlap(f, w)) n++; return n; };
    const beltScope = f => {
        const from = T => { const d = new Float64Array(numCells).fill(Infinity); for (let w = 0; w < numCells; w++) if (isLand(f, w) && T.has(f.terrane[w])) d[w] = 0; spreadKm(mesh, d); return d; };
        const dI = from(india.terranes), dA = from(asia.terranes), dO = from(otherT);
        return w => ours(f, w) && (india.terranes.has(f.terrane[w]) ? dA[w] <= dO[w] : dI[w] <= dO[w]);
    };
    return { contact, suture, rec, indiaIds: gi, asiaIds: ga, pairT, sideT, ownTerrane, ours, isOverlap, overlapCount, beltScope };
}
