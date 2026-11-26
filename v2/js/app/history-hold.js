// Pausing a history (the Evolution page's Pause, Jackson 2026-11-26: "often I'm most interested in a particular point in
// time and could pause the history generation to accelerate adding detail to that particular point"). The history and
// Add detail share the GPU and the CPU; a paused history leaves both to the finish.
//
// A pause takes hold at the next frame (a snapshot: every SNAPSHOT_MYR of the page's history), never inside a step. It
// asks simulate to stop there — the stopAt it already asks after each snapshot, for a chosen ending — and on resume
// runs on from that frame with simulate's `resume` (tectonics/simulate.js: a history run on in pieces whose ends are on
// the step grid is the one history run in one go, to the bit; snapshots are on that grid). So a paused history is the
// unpaused one: the same steps, the same frames, the same history-cache key (worked out from the start world, before
// the first step) and entry. Nothing in tectonics knows about it. tools/check-history-pause.mjs holds it to that.
//
// Two sides use one class: the page's (it asks: pause(), resume(), end(); and is told where it was held — mirror()),
// and the runner's, beside the world (history-worker.js, or history-runner.js where there is no worker), whose runHeld()
// does the holding.

export class HistoryHold {
    wanted = false;         // a pause is asked for: it takes hold at the next frame
    heldAt = null;          // the time (Myr) of the frame the history is held at; null while it runs
    heldMs = 0;             // how long it has been held, all told (a run's timings leave it out)
    relay = null;           // (the page's side, where the history runs in a worker: each ask is passed on to it — history-runner.js)
    #listeners = new Set();
    #release = null;        // (held here: lets it go — 'go', or 'end' to end the run at the frame it is held at)
    #since = 0;
    #endAsked = false;

    /** Told of every change (wanted, heldAt). Returns a function that stops telling. */
    on(fn) { this.#listeners.add(fn); return () => this.#listeners.delete(fn); }
    #emit() { for (const fn of this.#listeners) fn(this); }

    get paused() { return this.heldAt !== null; }
    /** Pause at the next frame (nothing to do if it is already asked). */
    pause() { this.relay?.('pause'); if (!this.wanted) { this.wanted = true; this.#emit(); } }
    /** Go on — or call off a pause that has not taken hold yet. */
    resume() { this.relay?.('resume'); this.#endAsked = false; this.#let('go'); }
    toggle() { if (this.wanted || this.paused) this.resume(); else this.pause(); }
    /** End a run on (Extend history) at the frame it is held at — or, if the pause has not taken hold yet, at the frame it
     *  takes hold at — as if it had been asked to run only that far: the next run on starts there, no step lost or run
     *  twice. Running, not pausing: nothing (the run on ends where it was to). A first run is let go, not ended. */
    end() { this.relay?.('end'); if (this.paused) this.#let('end'); else if (this.wanted) this.#endAsked = true; }
    #let(how) {
        if (!this.wanted && !this.paused) return;
        this.wanted = false;
        const release = this.#release;
        this.#release = null;
        if (release) release(how); else this.#emit();
    }

    /** The page's side: the worker's hold, as it reports it. */
    mirror({ wanted, heldAt }) { if (wanted !== this.wanted || heldAt !== this.heldAt) { this.wanted = wanted; this.heldAt = heldAt; this.#emit(); } }

    /** The runner's side: hold here, at the frame of `timeMyr`, until let go. Resolves 'go' or 'end' — 'go' at once if
     *  no pause is asked (it was called off before it took hold), 'end' at once if an end was asked before it did. */
    async hold(timeMyr) {
        if (!this.wanted) return 'go';
        if (this.#endAsked) { this.#endAsked = false; this.wanted = false; this.#emit(); return 'end'; }
        this.heldAt = timeMyr; this.#since = performance.now();
        const how = await new Promise(r => { this.#release = r; this.#emit(); });
        this.heldMs += performance.now() - this.#since;
        this.heldAt = null;
        this.#emit();
        return how;
    }
}

/**
 * simulate(world, opts), pausable at its frames by `hold` (a HistoryHold; null: simply run). `run` is the simulate to
 * call (history-worker.js: with its helpers). The frames and step log of the pieces are put together, so the result is
 * the one run's; `ended`: a run on (opts.resume) that was ended where it was held (hold.end()).
 * A run on asked to pause before it starts holds at once, at the frame the history stopped at (Extend history's pieces:
 * a pause asked between two pieces holds there, not a frame into the next).
 */
export async function runHeld(run, world, opts, hold) {
    if (!hold) return run(world, opts);
    const { stopAt = null, untilMyr } = opts, frames = [], stepLog = [];
    let held = false;
    // (the chosen ending is asked first, exactly as unpaused; a pause asked at the run's last frame has nothing to hold)
    const stopHere = w => { if (stopAt?.(w)) return true; held = hold.wanted && w.time < untilMyr - 1e-9; return held; };
    let resume = !!opts.resume;
    if (resume && hold.wanted && world.time < untilMyr - 1e-9 && await hold.hold(world.time) === 'end') return { frames, steps: world.step, stepLog, stopped: false, ended: true };
    for (;;) {
        held = false;
        const r = await run(world, { ...opts, stopAt: stopHere, resume });
        frames.push(...r.frames); stepLog.push(...(r.stepLog ?? []));
        if (!held) return { ...r, frames, stepLog };
        resume = true;
        if (await hold.hold(world.time) === 'end' && opts.resume) return { ...r, frames, stepLog, stopped: false, ended: true };
    }
}
