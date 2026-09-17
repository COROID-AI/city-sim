/**
 * The Coroid runtime.
 *
 * `createGame` wires three collaborators together and is closed for
 * modification:
 *
 *   RenderAdapter  ← draw frames, owns the scene root and GPU resources
 *   GameState      ← deterministic simulation document, mutated only by events
 *   systems.ts     ← the ordered system registry that composes the game
 *
 * Responsibilities:
 *  - attach every registered system once, in registry order;
 *  - advance the fixed-step loop, reduce queued domain events into state at each
 *    step boundary, then drive each system with a frozen snapshot;
 *  - request exactly one render per frame, exposing the loop's interpolation
 *    factor `alpha` for draw-time interpolation;
 *  - dispose every system exactly once and release the adapter's GPU resources.
 */

import { createDomainEventChannel, type DomainEventChannel } from './events';
import { createFixedStepLoop, type Clock, type FrameContext, type Rng } from './loop';
import { systems as registrySystems, type GameSystem, type SystemContext, type SystemUpdate } from './systems';
import type { DeepReadonly, DomainEvent, GameState } from '../sim/state';
import { applyDomainEvents, createInitialState, createSnapshot } from '../sim/state';
import type { RenderAdapter } from '../render/renderer';

/** Draw-time frame payload handed to `GameOptions.onFrame`. */
export interface GameFrame {
  /** 1-based rendered frame index. */
  readonly frame: number;
  /** Fixed steps executed during this frame. */
  readonly steps: number;
  /** Cumulative fixed steps executed so far. */
  readonly totalSteps: number;
  /** Draw-time interpolation factor in [0, 1). */
  readonly alpha: number;
  /** Simulated time elapsed, in milliseconds. */
  readonly elapsedMs: number;
  /** Number of attached systems (composition diagnostics). */
  readonly systems: number;
}

export interface GameStats {
  /** Cumulative fixed simulation steps. */
  readonly steps: number;
  /** Cumulative rendered frames. */
  readonly frames: number;
  /** Simulated time elapsed, in milliseconds. */
  readonly elapsedMs: number;
  /** Domain events applied to state so far. */
  readonly revision: number;
  /** Events emitted but not yet reduced into state. */
  readonly pendingEvents: number;
  /** Attached system count. */
  readonly systems: number;
}

export interface GameOptions {
  /** Render target. WebGL for the browser, headless for tests and CI. */
  adapter: RenderAdapter;
  /** Systems to attach. Defaults to the live registry exported from `systems.ts`. */
  systems?: readonly GameSystem[];
  /** Starting state. Defaults to `createInitialState({ seed })`. */
  state?: GameState;
  /** Seed for the deterministic RNG exposed to systems. Defaults to `1`. */
  seed?: number;
  /** Fixed simulation step in milliseconds. Defaults to 60 Hz. */
  stepMs?: number;
  /** Maximum steps per frame before time is dropped. Defaults to 240. */
  maxStepsPerFrame?: number;
  /** Time source for real-time playback. Defaults to `performance.now()`. */
  clock?: Clock;
  /**
   * Draw-time hook for presentation-only work (camera easing, materials,
   * HUD text). Called once per frame before the adapter renders, after the
   * state snapshot for this frame is settled.
   */
  onFrame?(frame: GameFrame): void;
}

/**
 * Running game instance.
 *
 * `state` is a frozen snapshot that is refreshed at every fixed-step boundary
 * and after every `commit()`. Systems emit events rather than mutating state;
 * events emitted outside a step (for example during setup) are reduced on the
 * next step boundary.
 */
export interface Game {
  readonly adapter: RenderAdapter;
  readonly systems: readonly GameSystem[];
  readonly events: DomainEventChannel;
  readonly rng: Rng;
  readonly clock: Clock;
  readonly stepMs: number;
  readonly seed: number;
  readonly stats: GameStats;
  readonly disposed: boolean;
  /** Frozen read-only state snapshot. */
  readonly state: DeepReadonly<GameState>;
  /** Start real-time playback driven by the clock. */
  start(): void;
  /** Stop real-time playback. Safe to call when already stopped. */
  stop(): void;
  /** Queue a domain event for the next reduction. */
  emit(event: DomainEvent): void;
  /** Reduce every queued event immediately. Returns how many were applied. */
  commit(): number;
  /** Advance deterministically by an explicit delta. Returns steps executed. */
  advance(ms: number): number;
  /** Present one frame at the current accumulator position. */
  render(): void;
  /** Dispose every system once, then the adapter. Idempotent. */
  dispose(): void;
}

export function createGame(options: GameOptions): Game {
  const adapter = options.adapter;
  if (adapter.disposed) {
    throw new Error('[coroid] createGame received an already disposed render adapter');
  }

  const seed = options.seed ?? 1;
  const channel = createDomainEventChannel();
  const requestedSystems = options.systems ?? registrySystems;
  const attached: GameSystem[] = [];

  let state: GameState = options.state ?? createInitialState({ seed });
  let snapshot: DeepReadonly<GameState> = createSnapshot(state);
  let disposed = false;
  let presentedFrames = 0;

  const loop = createFixedStepLoop({
    clock: options.clock,
    seed,
    stepMs: options.stepMs,
    maxStepsPerFrame: options.maxStepsPerFrame,
    onStep: runStep,
    onFrame: presentFrame,
  });

  const context: SystemContext = {
    scene: adapter.scene,
    camera: adapter.camera,
    adapter,
    events: channel,
    rng: loop.rng,
    clock: loop.clock,
    seed,
    stepMs: loop.stepMs,
  };

  const seenIds = new Set<string>();
  for (const system of requestedSystems) {
    if (!system || typeof system.id !== 'string' || system.id.length === 0) {
      throw new Error('[coroid] every system needs a non-empty string id');
    }
    if (seenIds.has(system.id)) {
      throw new Error(`[coroid] duplicate system id "${system.id}"`);
    }
    seenIds.add(system.id);
    system.attach(context);
    attached.push(system);
  }

  /**
   * Reduce queued events into state. Re-entrant emissions (a listener that
   * emits while a batch is applied) are folded in, with a hard iteration cap so
   * a runaway feedback loop cannot hang the frame.
   */
  function commit(): number {
    if (disposed) return 0;
    let applied = 0;
    let guard = 0;
    while (channel.pending > 0 && guard < 64) {
      const batch = channel.drain();
      if (batch.length === 0) break;
      state = applyDomainEvents(state, batch);
      snapshot = createSnapshot(state);
      applied += batch.length;
      guard += 1;
    }
    return applied;
  }

  function runStep(): void {
    // Events queued since the previous step boundary (setup, UI, other systems).
    commit();
    const payload: SystemUpdate = {
      context,
      state: snapshot,
      step: loop.steps,
      deltaMs: loop.stepMs,
      elapsedMs: loop.elapsedMs,
    };
    for (const system of attached) {
      system.update(payload);
    }
    // Events emitted by systems during this step apply within the same step.
    commit();
  }

  function draw(frame: GameFrame, alpha: number): void {
    presentedFrames += 1;
    options.onFrame?.({
      ...frame,
      frame: presentedFrames,
      alpha,
      systems: attached.length,
    });
    adapter.render(alpha);
  }

  function presentFrame(frame: FrameContext): void {
    draw(
      {
        frame: frame.frame,
        steps: frame.steps,
        totalSteps: frame.totalSteps,
        alpha: frame.alpha,
        elapsedMs: frame.elapsedMs,
        systems: attached.length,
      },
      frame.alpha,
    );
  }

  return {
    adapter,
    get systems() {
      return attached;
    },
    events: channel,
    rng: loop.rng,
    clock: loop.clock,
    stepMs: loop.stepMs,
    seed,
    get stats() {
      return {
        steps: loop.steps,
        frames: loop.frames,
        elapsedMs: loop.elapsedMs,
        revision: state.revision,
        pendingEvents: channel.pending,
        systems: attached.length,
      };
    },
    get disposed() {
      return disposed;
    },
    get state() {
      return snapshot;
    },
    start(): void {
      if (disposed) return;
      loop.start();
    },
    stop(): void {
      loop.stop();
    },
    emit(event: DomainEvent): void {
      if (disposed) return;
      channel.emit(event);
    },
    commit,
    advance(ms: number): number {
      if (disposed) return 0;
      const steps = loop.advance(ms);
      // Draw calls made outside a step (setup or tests) still settle events.
      commit();
      return steps;
    },
    render(): void {
      if (disposed) return;
      const alpha = loop.accumulator / loop.stepMs;
      draw(
        {
          frame: presentedFrames + 1,
          steps: 0,
          totalSteps: loop.steps,
          alpha,
          elapsedMs: loop.elapsedMs,
          systems: attached.length,
        },
        alpha,
      );
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      loop.dispose();
      // Systems tear down in reverse attach order, each exactly once.
      for (let index = attached.length - 1; index >= 0; index -= 1) {
        const system = attached[index];
        if (!system) continue;
        try {
          system.dispose();
        } catch (error) {
          console.error(`[coroid] system "${system.id}" failed to dispose`, error);
        }
      }
      attached.length = 0;
      channel.clear();
      adapter.dispose();
    },
  };
}
