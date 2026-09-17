/**
 * The fixed-step simulation engine.
 *
 * The engine owns a {@link SimClock} and a list of systems. Two ways to move
 * time forward are supported:
 *
 * - `update(realDeltaMs)` converts real elapsed milliseconds into whole fixed
 *   steps using `ticksPerSecond` and `speed`, capping catch-up so a stalled
 *   tab cannot trigger an unbounded step burst;
 * - `step(count)` runs exactly `count` fixed steps, which is what tests and
 *   deterministic tooling use.
 *
 * Every fixed step advances the clock by `minutesPerTick` sim-minutes and then
 * calls each system's `update()` in attach order. Hour boundaries reached
 * while the clock advances are broadcast to `onHourEnd`/`onHourStart` in attach
 * order, once per boundary, at the exact moment the boundary is crossed.
 */

import { SimClock, type HourBoundary, type SimTime, type Unsubscribe } from './clock';

/** Context handed to every system callback. */
export interface EngineContext {
  readonly engine: SimulationEngine;
  readonly clock: SimClock;
  /** Fixed sim-minute step used by the current tick. */
  readonly deltaMinutes: number;
  /** Number of fixed steps started so far (first tick is 1). */
  readonly tick: number;
  /** Snapshot of the clock taken when this context was created. */
  readonly simTime: SimTime;
}

/** A registered simulation system. Only `name` and `update` are required. */
export interface SimSystem {
  /** Unique name inside one engine; used for diagnostics and detaching. */
  readonly name: string;
  /** Called once when the system is attached. */
  onAttach?(context: EngineContext): void;
  /** Called once when the system is detached or the engine is disposed. */
  onDetach?(context: EngineContext): void;
  /** Called once per fixed step, in attach order. */
  update(context: EngineContext): void;
  /** Called once per sim-hour boundary, at the moment the hour begins. */
  onHourStart?(context: EngineContext, boundary: HourBoundary): void;
  /** Called once per sim-hour boundary, just before the next hour begins. */
  onHourEnd?(context: EngineContext, boundary: HourBoundary): void;
}

export type EngineState = 'running' | 'paused' | 'disposed';

export interface EngineOptions {
  /** Clock to drive; a fresh one is created when omitted. */
  clock?: SimClock;
  /** Sim-minutes per fixed step. Positive integer, defaults to 1. */
  minutesPerTick?: number;
  /** Fixed steps per real second at speed 1. Defaults to 60. */
  ticksPerSecond?: number;
  /** Speed multiplier applied to incoming real time. Defaults to 1. */
  speed?: number;
  /** Maximum fixed steps executed by a single `update()` call. Defaults to 240. */
  maxStepsPerUpdate?: number;
}

const DEFAULT_MINUTES_PER_TICK = 1;
const DEFAULT_TICKS_PER_SECOND = 60;
const DEFAULT_MAX_STEPS_PER_UPDATE = 240;
/** Keeps floating point accumulation from eating a step at an exact boundary. */
const STEP_EPSILON_MS = 1e-9;

function normalizeSpeed(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError(`speed must be a finite number greater than 0, received ${multiplier}`);
  }
  return multiplier;
}

export class SimulationEngine {
  /** Sim-minutes advanced per fixed step. */
  readonly minutesPerTick: number;
  /** Fixed steps per real second at speed 1. */
  readonly ticksPerSecond: number;
  /** Upper bound of fixed steps executed by a single `update()` call. */
  readonly maxStepsPerUpdate: number;

  private readonly clockRef: SimClock;
  private readonly unsubscribes: Unsubscribe[] = [];
  private readonly systemList: SimSystem[] = [];
  private readonly systemIndex = new Map<string, SimSystem>();
  private speedValue: number;
  private pausedFlag = false;
  private disposedFlag = false;
  private accumulatorMs = 0;
  private completedTicks = 0;

  constructor(options: EngineOptions = {}) {
    const minutesPerTick = options.minutesPerTick ?? DEFAULT_MINUTES_PER_TICK;
    if (!Number.isInteger(minutesPerTick) || minutesPerTick < 1) {
      throw new RangeError(`minutesPerTick must be a positive integer, received ${minutesPerTick}`);
    }
    const ticksPerSecond = options.ticksPerSecond ?? DEFAULT_TICKS_PER_SECOND;
    if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) {
      throw new RangeError(`ticksPerSecond must be a finite number greater than 0, received ${ticksPerSecond}`);
    }
    const maxStepsPerUpdate = options.maxStepsPerUpdate ?? DEFAULT_MAX_STEPS_PER_UPDATE;
    if (!Number.isInteger(maxStepsPerUpdate) || maxStepsPerUpdate < 1) {
      throw new RangeError(`maxStepsPerUpdate must be a positive integer, received ${maxStepsPerUpdate}`);
    }
    this.minutesPerTick = minutesPerTick;
    this.ticksPerSecond = ticksPerSecond;
    this.maxStepsPerUpdate = maxStepsPerUpdate;
    this.speedValue = normalizeSpeed(options.speed ?? 1);
    this.clockRef = options.clock ?? new SimClock({ minutesPerTick });
    this.unsubscribes.push(
      this.clockRef.onHourStart((boundary) => this.dispatchHourStart(boundary)),
      this.clockRef.onHourEnd((boundary) => this.dispatchHourEnd(boundary)),
    );
  }

  /* ------------------------------------------------------------- reading -- */

  get clock(): SimClock {
    return this.clockRef;
  }

  get state(): EngineState {
    if (this.disposedFlag) {
      return 'disposed';
    }
    return this.pausedFlag ? 'paused' : 'running';
  }

  get speed(): number {
    return this.speedValue;
  }

  get isPaused(): boolean {
    return this.pausedFlag;
  }

  /** Number of fixed steps executed so far. */
  get tickCount(): number {
    return this.completedTicks;
  }

  get systemCount(): number {
    return this.systemList.length;
  }

  /** Copy of the system list, in attach order. */
  get systems(): readonly SimSystem[] {
    return [...this.systemList];
  }

  /** Looks a system up by its unique name. */
  getSystem(name: string): SimSystem | undefined {
    return this.systemIndex.get(name);
  }

  /* ---------------------------------------------------------- lifecycle -- */

  /**
   * Registers a system. Systems run in attach order.
   * Returns a detach function; names must be unique per engine.
   */
  attach(system: SimSystem): () => boolean {
    this.assertUsable('attach');
    if (!system || typeof system.update !== 'function') {
      throw new TypeError('SimulationEngine.attach(system) expects an object with an update() method');
    }
    if (this.systemIndex.has(system.name)) {
      throw new Error(`SimulationEngine already has a system named "${system.name}"`);
    }
    this.systemList.push(system);
    this.systemIndex.set(system.name, system);
    system.onAttach?.(this.createContext());
    return () => this.detach(system);
  }

  /** Removes a system by instance or name. Returns true when it was attached. */
  detach(systemOrName: SimSystem | string): boolean {
    const name = typeof systemOrName === 'string' ? systemOrName : systemOrName.name;
    const system = this.systemIndex.get(name);
    if (!system) {
      return false;
    }
    const index = this.systemList.indexOf(system);
    if (index >= 0) {
      this.systemList.splice(index, 1);
    }
    this.systemIndex.delete(name);
    if (!this.disposedFlag) {
      system.onDetach?.(this.createContext());
    }
    return true;
  }

  /** Pauses simulation time; `update()` and `step()` become no-ops. */
  pause(): void {
    if (!this.disposedFlag) {
      this.pausedFlag = true;
    }
  }

  /** Resumes simulation time. */
  resume(): void {
    if (!this.disposedFlag) {
      this.pausedFlag = false;
    }
  }

  /** Flips pause state and returns the new value (`true` = paused). */
  togglePause(): boolean {
    if (!this.disposedFlag) {
      this.pausedFlag = !this.pausedFlag;
    }
    return this.pausedFlag;
  }

  /** Sets the speed multiplier applied to real elapsed time. */
  setSpeed(multiplier: number): void {
    this.speedValue = normalizeSpeed(multiplier);
  }

  /**
   * Converts real elapsed milliseconds into fixed steps.
   * Returns the number of steps executed (0 while paused or disposed).
   */
  update(realDeltaMs: number): number {
    if (this.disposedFlag || this.pausedFlag) {
      return 0;
    }
    if (!Number.isFinite(realDeltaMs) || realDeltaMs <= 0) {
      return 0;
    }
    const msPerTick = 1000 / this.ticksPerSecond;
    this.accumulatorMs += realDeltaMs * this.speedValue;
    let steps = 0;
    while (steps < this.maxStepsPerUpdate && this.accumulatorMs + STEP_EPSILON_MS >= msPerTick) {
      this.accumulatorMs -= msPerTick;
      if (this.accumulatorMs < 0) {
        this.accumulatorMs = 0;
      }
      this.runTick();
      steps += 1;
    }
    if (this.accumulatorMs >= msPerTick) {
      // Step budget exhausted: drop the backlog instead of spiralling.
      this.accumulatorMs = 0;
    }
    return steps;
  }

  /**
   * Runs exactly `count` fixed steps, ignoring real time.
   * Returns the number of steps executed (0 while paused or disposed).
   */
  step(count = 1): number {
    if (this.disposedFlag || this.pausedFlag) {
      return 0;
    }
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`step(count) expects a non-negative integer, received ${count}`);
    }
    for (let index = 0; index < count; index += 1) {
      this.runTick();
    }
    return count;
  }

  /**
   * Detaches every system, unsubscribes from the clock and stops advancing.
   * Safe to call more than once.
   */
  dispose(): void {
    if (this.disposedFlag) {
      return;
    }
    this.disposedFlag = true;
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes.length = 0;
    const systems = [...this.systemList];
    this.systemList.length = 0;
    this.systemIndex.clear();
    this.accumulatorMs = 0;
    const context = this.createContext();
    for (const system of systems) {
      system.onDetach?.(context);
    }
  }

  /* ------------------------------------------------------------ internal -- */

  private runTick(): void {
    this.completedTicks += 1;
    this.clockRef.advanceMinutes(this.minutesPerTick);
    const context = this.createContext();
    for (const system of [...this.systemList]) {
      system.update(context);
    }
  }

  private dispatchHourStart(boundary: HourBoundary): void {
    if (this.disposedFlag) {
      return;
    }
    const context = this.createContext();
    for (const system of [...this.systemList]) {
      system.onHourStart?.(context, boundary);
    }
  }

  private dispatchHourEnd(boundary: HourBoundary): void {
    if (this.disposedFlag) {
      return;
    }
    const context = this.createContext();
    for (const system of [...this.systemList]) {
      system.onHourEnd?.(context, boundary);
    }
  }

  private createContext(): EngineContext {
    return {
      engine: this,
      clock: this.clockRef,
      deltaMinutes: this.minutesPerTick,
      tick: this.completedTicks,
      simTime: this.clockRef.time,
    };
  }

  private assertUsable(action: string): void {
    if (this.disposedFlag) {
      throw new Error(`SimulationEngine.${action}() cannot be used after dispose()`);
    }
  }
}
