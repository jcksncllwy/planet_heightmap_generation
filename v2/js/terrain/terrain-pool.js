// Terrain synthesis spread over worker threads (terrain-worker.js): the terrain cells are cut into chunks, each worker
// always gets the same chunks (so it keeps their positions and sampler between frames), builds the per-frame plan itself
// and computes the surface of its chunks. The result is exactly synthesizeTerrain's — every cell depends only on its
// position and the plan — only faster. Works in the browser (module workers) and in Node (worker threads).
// Carving (Phase 8b) needs a whole frame at once: one more worker (carve-worker.js) carves each frame the chunk workers
// have built, on a queue of its own, so the next frame's surface is built while this one is carved.

import { preparePlan, carveLadder, carveSettings, carveInputs, surfaceParts } from './synthesize.js';
import { terrainMeshAsync } from './terrain-mesh.js';

const IS_NODE = typeof window === 'undefined' && typeof process !== 'undefined' && !!process.versions?.node;
const CHUNKS_PER_WORKER = 8;          // more chunks than workers, dealt round-robin: land and sea even out between workers
// the Frame fields terrain synthesis reads (a worker is sent only these)
// (every frame field the terrain reads — records.js, volcanoes.js — including the evolved heights; plus each plate's
// rotation, below)
const FRAME_FIELDS = ['time', 'owner', 'type', 'flags', 'terrane', 'formedAt', 'boundary', 'margin', 'mantleHeat', 'oroType', 'oroLast', 'thickKm',
    'beltU', 'beltReach', 'beltSide', 'beltShear', 'prevType', 'prevLast', 'prevU', 'prevReach', 'prevSide', 'prevShear', 'volcType', 'volcAt', 'volcKm', 'volcSource',
    'crustCells', 'crustType', 'crustBelt', 'crustReach', 'rootKm', 'upliftKm', 'baseKm', 'rugged', 'prevRugged', 'volcWornKm', 'riverIncKm', 'riverKm2'];

async function spawn(file = './terrain-worker.js') {
    const url = new URL(file, import.meta.url);
    if (IS_NODE) {
        const { Worker } = await import('node:worker_threads');
        const w = new Worker(url);
        w.unref();                                        // (idle workers never keep a Node process alive; a job holds them)
        return { post: (m, t) => w.postMessage(m, t), listen: fn => w.on('message', fn), terminate: () => w.terminate(), hold: on => (on ? w.ref() : w.unref()) };
    }
    const w = new Worker(url, { type: 'module' });
    return { post: (m, t) => w.postMessage(m, t), listen: fn => w.addEventListener('message', e => fn(e.data)), terminate: () => w.terminate(), hold: () => {} };
}

/** How many workers to use by default: all cores but one (for the page), at most 8 (each holds a copy of the plan). */
export async function defaultPoolSize() {
    const cores = IS_NODE ? (await import('node:os')).availableParallelism() : (navigator.hardwareConcurrency || 4);
    return Math.max(1, Math.min(8, cores - 1));
}

export class TerrainPool {
    /** @param {Object} simMesh  the mesh the frames live on (sent to every worker once) */
    static async create(simMesh, size = null) {
        const n = size ?? await defaultPoolSize();
        const workers = await Promise.all(Array.from({ length: n }, spawn));
        const arrays = { numCells: simMesh.numCells, xyz: simMesh.xyz, adjOffset: simMesh.adjOffset, adjList: simMesh.adjList };
        for (const w of workers) w.post({ type: 'sim', mesh: arrays });
        return new TerrainPool(workers, simMesh);
    }

    constructor(workers, simMesh) {
        this.workers = workers;
        this.sim = simMesh;
        this.meshes = new Map();             // terrain mesh → { chunks: [{id, from, to}], sampler: {cells, weights, key} | null }
        this.nextJob = 1;
        this.queue = Promise.resolve();      // jobs run one at a time
        this.pending = new Map();            // job id → handler
        workers.forEach(w => w.listen(msg => this.pending.get(msg.jobId)?.(msg)));
    }

    get size() { return this.workers.length; }

    terminate() { for (const w of this.workers) w.terminate(); this.workers = []; this.carver?.worker.terminate(); this.carver = null; }

    /**
     * synthesizeTerrain(frame, simMesh, tMesh, { cfg, seed, parts }) on the pool: same result (heightKm, parts, rec,
     * sampler, kernels, volcanoes), bit for bit. `records: false` leaves out the records (rec null): heights only, and
     * nothing of the job runs on the caller's thread.
     */
    synthesize(frame, tMesh, opts) {
        const run = this.queue.then(() => this.run(frame, tMesh, opts));
        this.queue = run.catch(() => {});
        return run;
    }

    async run(frame, tMesh, { cfg, seed = 0, parts: wantParts = false, records = true, carveInputs = false }) {
        const started = performance.now(), W = this.workers.length, n = tMesh.numCells;
        for (const w of this.workers) w.hold(true);
        try { return await this.runHeld(frame, tMesh, { cfg, seed, wantParts, records, carveInputs }, started, W, n); } finally { for (const w of this.workers) w.hold(false); }
    }

    /**
     * Carve a frame's surface (synthesize's result, built with carveInputs: true) on the carving worker — carve.js's
     * carveTerrain over the sim mesh and the terrain meshes up to tMesh. Queued apart from the surfaces.
     * @returns {Promise<{z: Float32Array, area: Float32Array, ms: number}>}
     */
    carve(tMesh, built, cfg) {
        const run = (this.carveQueue ?? Promise.resolve()).then(() => this.runCarve(tMesh, built, cfg));
        this.carveQueue = run.catch(() => {});
        return run;
    }

    async runCarve(tMesh, built, cfg) {
        if (!this.carver) {
            const worker = await spawn('./carve-worker.js'), pending = new Map();
            worker.listen(msg => pending.get(msg.jobId)?.(msg));
            this.carver = { worker, pending, sent: new Set() };
        }
        const { worker, pending, sent } = this.carver;
        const sizes = carveLadder(this.sim, tMesh, n => n).slice(1, -1);            // (the terrain meshes between)
        const ladder = [this.sim, ...(await Promise.all(sizes.map(n => terrainMeshAsync(n)))), tMesh];
        for (const m of ladder) if (!sent.has(m.numCells)) {                      // (each mesh sent once, copied)
            worker.post({ type: 'mesh', mesh: { numCells: m.numCells, xyz: m.xyz, adjOffset: m.adjOffset, adjList: m.adjList } });
            sent.add(m.numCells);
        }
        const jobId = this.nextJob++, fields = { ...built.carveIn, z: built.heightKm };
        worker.hold(true);
        try {
            return await new Promise((resolve, reject) => {
                pending.set(jobId, msg => {
                    pending.delete(jobId);
                    if (msg.type === 'error') reject(new Error(`carve worker: ${msg.message}`)); else resolve({ z: msg.z, area: msg.area, ms: msg.ms });
                });
                worker.post({ type: 'carve', jobId, ladder: ladder.map(m => m.numCells), fields, settings: carveSettings(cfg) });
            });
        } finally { worker.hold(false); }
    }

    async runHeld(frame, tMesh, { cfg, seed, wantParts, records, carveInputs: wantCarve }, started, W, n) {
        let mesh = this.meshes.get(tMesh);
        if (!mesh) {                              // first time on this mesh: deal out its chunks, and each worker's positions
            const count = W * CHUNKS_PER_WORKER, chunks = [];
            for (let i = 0; i < count; i++) chunks.push({ id: `${n}:${i}`, from: Math.floor(i * n / count), to: Math.floor((i + 1) * n / count) });
            this.workers.forEach((w, wi) => {
                const mine = chunks.filter((_, i) => i % W === wi).map(c => ({ id: c.id, xyz: tMesh.xyz.slice(3 * c.from, 3 * c.to) }));
                w.post({ type: 'chunks', chunks: mine }, mine.map(c => c.xyz.buffer));
            });
            this.meshes.set(tMesh, mesh = { chunks, sampler: null });
        }
        const samplerKey = `${seed}|${cfg.warpKm}|${cfg.warpScale}`;
        const reuseSampler = mesh.sampler?.key === samplerKey;
        const sampler = reuseSampler ? mesh.sampler : { cells: new Int32Array(3 * n), weights: new Float32Array(3 * n), key: samplerKey };
        const heightKm = new Float32Array(n);
        const parts = wantParts ? surfaceParts(n) : null;
        const carveIn = wantCarve ? carveInputs(n) : null;
        const byId = new Map(mesh.chunks.map(c => [c.id, c]));
        const jobId = this.nextJob++, slim = Object.fromEntries(FRAME_FIELDS.map(k => [k, frame[k]]));
        slim.plates = frame.plates.map(p => p && { quat: p.quat });           // (the plates' rotations: detail is anchored to the crust)

        let counts = null;
        const finished = new Promise((resolve, reject) => {
            let done = 0;
            this.pending.set(jobId, msg => {
                if (msg.type === 'error') { this.pending.delete(jobId); reject(new Error(`terrain worker: ${msg.message}`)); return; }
                if (msg.type === 'done') { counts ??= msg; if (++done === W) { this.pending.delete(jobId); resolve(); } return; }
                const c = byId.get(msg.id);
                heightKm.set(msg.heightKm, c.from);
                if (parts) for (const k of Object.keys(parts)) parts[k].set(msg.parts[k], c.from);
                if (carveIn) for (const k of Object.keys(carveIn)) carveIn[k].set(msg.carve[k], c.from);
                if (msg.cells) { sampler.cells.set(msg.cells, 3 * c.from); sampler.weights.set(msg.weights, 3 * c.from); }
            });
        });
        this.workers.forEach((w, wi) => w.post({ type: 'job', jobId, frame: slim, cfg, seed, edgeKm: tMesh.edgeKm, parts: wantParts, carve: wantCarve, samplerKey,
            chunkIds: mesh.chunks.filter((_, i) => i % W === wi).map(c => c.id) }));
        // meanwhile, the plan here too: the caller reads the records (ridge directions, belt kinds) as well as the heights
        // (unless it asked for heights only — a frame built ahead, in the background, keeps the page's thread free)
        const t0 = performance.now(), plan = records ? preparePlan(frame, this.sim, cfg, seed, tMesh.edgeKm) : null, planMs = performance.now() - t0;
        await finished;
        mesh.sampler = sampler;
        return { heightKm, parts, carveIn, rec: plan?.rec ?? null, sampler, ms: { records: planMs, pooled: performance.now() - started, workers: W },
            kernels: counts.kernels, volcanoes: counts.volcanoes };
    }
}
