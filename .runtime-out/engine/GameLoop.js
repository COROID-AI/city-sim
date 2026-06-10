"use strict";
/**
 * GameLoop — requestAnimationFrame driver with a fixed simulation step.
 *
 * Why fixed step: downstream systems (time, citizens, events) need
 * deterministic tick intervals so behavior is reproducible. We accumulate
 * wall-clock time and run as many fixed-size simulation steps as fit,
 * bounded to prevent the "spiral of death" when a single step stalls.
 *
 * Conventions:
 *   - All time values are in seconds.
 *   - The default fixed step is 20Hz (50ms), per spec.
 *   - Render happens once per rAF tick, after simulation steps for that tick.
 *   - Callbacks receive the *fixed* dt, not the wall dt, so they're stable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameLoop = void 0;
const DEFAULT_FIXED_STEP = 0.05; // 20Hz
const DEFAULT_MAX_CATCHUP = 0.25; // 5 ticks
const DEFAULT_MAX_STEPS = 5;
class GameLoop {
    constructor(options = {}) {
        this.stepCallbacks = [];
        this.renderCallbacks = [];
        this.rafHandle = null;
        this.running = false;
        this.accumulator = 0;
        this.lastTimestamp = 0;
        this.stepCounter = 0;
        /** True until the first tick has been seen; used to seed lastTimestamp. */
        this.firstTick = true;
        /** Override hooks for tests. When unset, rAF is resolved lazily from globalThis. */
        this.rafOverride = null;
        this.cancelRafOverride = null;
        this.tick = (timestamp) => {
            if (!this.running)
                return;
            // Seed lastTimestamp on the first tick so the first frame contributes
            // zero dt (no accumulated time) but subsequent frames measure real dt.
            if (this.firstTick) {
                this.lastTimestamp = timestamp;
                this.firstTick = false;
            }
            const frameDt = (timestamp - this.lastTimestamp) / 1000;
            this.lastTimestamp = timestamp;
            // Bound accumulator to avoid spiral of death after long pauses.
            this.accumulator = Math.min(this.accumulator + Math.max(0, frameDt), this.maxCatchup);
            let stepsThisFrame = 0;
            while (this.accumulator >= this.fixedStep && stepsThisFrame < this.maxSteps) {
                this.accumulator -= this.fixedStep;
                this.stepCounter += 1;
                stepsThisFrame += 1;
                for (const cb of this.stepCallbacks) {
                    cb(this.fixedStep, this.stepCounter);
                }
            }
            // If we hit the step cap, discard the rest of the catch-up debt so we
            // don't spend subsequent frames trying to pay it off.
            if (stepsThisFrame >= this.maxSteps) {
                this.accumulator = 0;
            }
            for (const cb of this.renderCallbacks) {
                cb(frameDt);
            }
            this.rafHandle = this.getRaf()(this.tick);
        };
        this.fixedStep = options.fixedStepSeconds ?? DEFAULT_FIXED_STEP;
        this.maxCatchup = options.maxCatchupSeconds ?? DEFAULT_MAX_CATCHUP;
        this.maxSteps = options.maxStepsPerFrame ?? DEFAULT_MAX_STEPS;
    }
    /**
     * Resolve rAF/cancelRaf. Looked up lazily on each start() so that tests
     * can monkey-patch globalThis.requestAnimationFrame before the loop
     * actually schedules a frame. Falls back to a setTimeout-based shim
     * (~60Hz) in non-browser environments.
     */
    getRaf() {
        if (this.rafOverride)
            return this.rafOverride;
        const g = globalThis;
        if (typeof g.requestAnimationFrame === 'function') {
            return g.requestAnimationFrame.bind(g);
        }
        return (cb) => {
            return setTimeout(() => cb(performance.now()), 16);
        };
    }
    getCancelRaf() {
        if (this.cancelRafOverride)
            return this.cancelRafOverride;
        const g = globalThis;
        if (typeof g.cancelAnimationFrame === 'function') {
            return g.cancelAnimationFrame.bind(g);
        }
        return (handle) => {
            clearTimeout(handle);
        };
    }
    /**
     * Test hook: install a custom rAF implementation. Returns the previous
     * value (or null) so tests can restore it. Calling with null restores
     * the default globalThis lookup.
     */
    setRaf(raf) {
        const prev = this.rafOverride;
        this.rafOverride = raf;
        return prev;
    }
    setCancelRaf(cancel) {
        const prev = this.cancelRafOverride;
        this.cancelRafOverride = cancel;
        return prev;
    }
    /** Register a per-fixed-step callback. Returns an unsubscribe function. */
    onStep(cb) {
        this.stepCallbacks.push(cb);
        return () => {
            this.stepCallbacks = this.stepCallbacks.filter((x) => x !== cb);
        };
    }
    /** Register a per-frame render callback. Returns an unsubscribe function. */
    onRender(cb) {
        this.renderCallbacks.push(cb);
        return () => {
            this.renderCallbacks = this.renderCallbacks.filter((x) => x !== cb);
        };
    }
    /** Start the loop. No-op if already running. */
    start() {
        if (this.running)
            return;
        this.running = true;
        this.accumulator = 0;
        this.lastTimestamp = 0;
        this.firstTick = true;
        this.rafHandle = this.getRaf()(this.tick);
    }
    /** Stop the loop and cancel the pending rAF. */
    stop() {
        if (!this.running)
            return;
        this.running = false;
        if (this.rafHandle !== null) {
            this.getCancelRaf()(this.rafHandle);
            this.rafHandle = null;
        }
    }
    /** True if the loop is currently driving frames. */
    isRunning() {
        return this.running;
    }
    /** Configured fixed step in seconds. */
    getFixedStep() {
        return this.fixedStep;
    }
}
exports.GameLoop = GameLoop;
