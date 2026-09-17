/**
 * Dev preview: the motion layer of Coroid.
 *
 * The page composes the lane-agent view, the quality constellation and a small
 * deterministic show director on top of the shared preview harness, so a single
 * URL shows everything this module set delivers:
 *
 *  - agent comets streaming along the plan's dependency conduits (lane occupancy
 *    drives how many ride and how long their trails are);
 *  - verification gate rings cycling through pending → failed-with-repair →
 *    passed, complete with the magenta-red alarm;
 *  - the quality constellation completing milestones, retiring superseded ones
 *    and growing upward as final invariants settle.
 *
 * The director only emits domain events at the simulated clock the state
 * carries, so the whole show is deterministic and replay-identical: nothing here
 * reads wall-clock time.
 */

import '../src/styles/base.css';

import { GridHelper, Group, LineBasicMaterial } from 'three';

import type { GameSystem } from '../src/game/systems';
import type { GameFrame } from '../src/game/Game';
import type { RenderAdapter } from '../src/render/renderer';
import {
  classifyGateRing,
  createLaneAgentsSystem,
  measureLaneOccupancies,
} from '../src/render/laneAgents';
import { createConstellationLayout, createQualityGraphSystem } from '../src/render/qualityGraph';
import { createSampleState } from '../src/sim/fixtures';
import {
  makeDomainEvent,
  type DeepReadonly,
  type GameState,
  type TaskStatus,
} from '../src/sim/state';
import { mountGamePreview, type PreviewHarness } from './harness';

/* -------------------------------------------------------------------------- */
/* Show director                                                              */
/* -------------------------------------------------------------------------- */

export interface LaneShowDirectorOptions {
  /** System id. Defaults to `preview/lane-show-director`. */
  id?: string;
  /** Length of one loop of the show, in simulated milliseconds. */
  cycleMs?: number;
}

interface GateStep {
  /** Offset into the show cycle at which the step fires. */
  readonly delayMs: number;
  readonly gateId: string;
  readonly status: TaskStatus;
  readonly coverage: number;
}

/** The gate choreography: one loop of the light show. */
const GATE_STEPS: readonly GateStep[] = [
  { delayMs: 0, gateId: 'gate-boot-smoke', status: 'running', coverage: 0.4 },
  { delayMs: 0, gateId: 'gate-fidelity', status: 'pending', coverage: 0 },
  { delayMs: 2_500, gateId: 'gate-boot-smoke', status: 'failed', coverage: 0.32 },
  { delayMs: 9_000, gateId: 'gate-boot-smoke', status: 'passed', coverage: 1 },
  { delayMs: 14_000, gateId: 'gate-fidelity', status: 'running', coverage: 0.58 },
  { delayMs: 18_000, gateId: 'gate-fidelity', status: 'failed', coverage: 0.38 },
  { delayMs: 25_000, gateId: 'gate-fidelity', status: 'passed', coverage: 1 },
];

/** Fraction of the cycle at which each criterion reaches its target. */
const METRIC_COMPLETION: Readonly<Record<string, number>> = {
  'metric-determinism': 0.02,
  'metric-frame-budget': 0.32,
  'metric-contract-coverage': 0.52,
  'metric-readability': 0.72,
  'metric-fidelity': 0.88,
};
const DEFAULT_COMPLETION = 0.6;

/** Extra work queued onto lanes over time: comets multiply, trails stretch. */
const SPARE_QUEUE: readonly (readonly [string, string])[] = [
  ['lane-verify', 'task-constellation'],
  ['lane-build', 'task-economy'],
  ['lane-observe', 'task-gates'],
  ['lane-discovery', 'task-shell'],
  ['lane-verify', 'task-lane-comets'],
  ['lane-build', 'task-review'],
];

const PROGRESS_PER_TICK = 0.002;
const METRIC_INTERVAL_MS = 400;
const SPARE_INTERVAL_MS = 3_000;

/**
 * Drive the shipped fixture through the states the motion layer has to show.
 *
 * Emits task progress (comets move), queues spare work (occupancy grows), runs
 * the gate choreography (pending → alarm → passed, looping) and walks the
 * quality metrics to their targets (criteria change lifecycle).
 */
export function createLaneShowDirector(options: LaneShowDirectorOptions = {}): GameSystem {
  const cycleMs = options.cycleMs ?? 36_000;
  const baseValues = new Map<string, number>();
  let origin = Number.NaN;
  let stepCursor = -1;
  let lastPhase = 0;
  let metricAccum = 0;
  let spareAccum = 0;
  let spareIndex = 0;

  return {
    id: options.id ?? 'preview/lane-show-director',
    attach(): void {
      // Nothing to attach: the director is pure state choreography.
    },
    update(update): void {
      const state = update.state;
      const context = update.context;
      if (Number.isNaN(origin)) {
        origin = state.mission.elapsedMs;
        for (const metricId of state.quality.order) {
          const metric = state.quality.metrics[metricId];
          if (metric) baseValues.set(metricId, metric.value);
        }
      }

      // Keep event timestamps on the state's own clock: that is what advances
      // simulated time (and therefore comet motion) at all.
      const at = state.mission.elapsedMs + Math.max(1, Math.round(update.deltaMs));
      const phase = (((at - origin) % cycleMs) + cycleMs) % cycleMs;
      if (phase < lastPhase) stepCursor = -1; // new loop of the show
      lastPhase = phase;

      // 1. Gate choreography.
      let nextCursor = stepCursor;
      for (let index = stepCursor + 1; index < GATE_STEPS.length; index += 1) {
        const step = GATE_STEPS[index];
        if (!step || step.delayMs > phase) break;
        nextCursor = index;
      }
      if (nextCursor !== stepCursor) {
        for (let index = stepCursor + 1; index <= nextCursor; index += 1) {
          const step = GATE_STEPS[index];
          if (!step) continue;
          context.events.emit(
            makeDomainEvent(
              'verification/run',
              { gateId: step.gateId, status: step.status, coverage: step.coverage },
              at,
            ),
          );
        }
        stepCursor = nextCursor;
      }

      // 2. Comet motion: progress on every running task, plus promotions.
      for (const taskId of state.plan.order) {
        const task = state.plan.tasks[taskId];
        if (!task || task.status !== 'running') continue;
        const progress = Math.min(1, task.progress + PROGRESS_PER_TICK);
        context.events.emit(
          makeDomainEvent(
            'plan/task-updated',
            progress >= 1 ? { taskId, progress, status: 'passed' } : { taskId, progress },
            at,
          ),
        );
      }
      for (const taskId of state.plan.order) {
        const task = state.plan.tasks[taskId];
        if (!task || (task.status !== 'pending' && task.status !== 'blocked')) continue;
        const ready = task.dependencies.every(
          (dependency) => state.plan.tasks[dependency]?.status === 'passed',
        );
        if (!ready) continue;
        context.events.emit(makeDomainEvent('lane/assigned', { laneId: task.laneId, taskId }, at));
        break;
      }

      // 3. Occupancy creep: queued work keeps arriving on the lanes.
      spareAccum += update.deltaMs;
      if (spareAccum >= SPARE_INTERVAL_MS) {
        spareAccum = 0;
        const spare = SPARE_QUEUE[spareIndex % SPARE_QUEUE.length];
        spareIndex += 1;
        if (spare) {
          context.events.emit(makeDomainEvent('lane/queued', { laneId: spare[0], taskId: spare[1] }, at));
        }
      }

      // 4. Criteria climb towards their targets, then the loop resets them.
      metricAccum += update.deltaMs;
      if (metricAccum >= METRIC_INTERVAL_MS) {
        metricAccum = 0;
        for (const metricId of state.quality.order) {
          const metric = state.quality.metrics[metricId];
          if (!metric) continue;
          const base = baseValues.get(metricId) ?? metric.value;
          const completion = METRIC_COMPLETION[metricId] ?? DEFAULT_COMPLETION;
          const fraction = Math.min(1, phase / Math.max(1, completion * cycleMs));
          const value = Math.round((base + (metric.target - base) * fraction) * 1_000) / 1_000;
          if (Math.abs(value - metric.value) < 0.001) continue;
          context.events.emit(
            makeDomainEvent(
              'quality/measured',
              {
                metric: {
                  id: metricId,
                  label: metric.label,
                  value,
                  target: metric.target,
                  weight: metric.weight,
                },
              },
              at,
            ),
          );
        }
      }
    },
    dispose(): void {
      baseValues.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Camera and HUD                                                             */
/* -------------------------------------------------------------------------- */

/** Footprint of the preview's emitter grid, in world units. */
export const FLOOR_SIZE = 84;

/** Slow orbit that keeps the floor and the floating constellation in frame. */
export function orbitCamera(adapter: RenderAdapter, elapsedMs: number): void {
  const seconds = elapsedMs / 1_000;
  const angle = 0.95 + Math.sin(seconds * 0.055) * 0.55;
  const radius = 35 + Math.sin(seconds * 0.041) * 3.5;
  const camera = adapter.camera;
  camera.position.set(
    Math.cos(angle) * radius,
    17 + Math.sin(seconds * 0.073) * 2.4,
    Math.sin(angle) * radius,
  );
  camera.lookAt(0, 8.5, 0);
}

/**
 * Ground the hologram: a faint emitter grid so the conduits and gate rings read
 * against the void. Owned by the page (the harness disposes it with the scene).
 */
export function createPreviewFloor(adapter: RenderAdapter): Group {
  const root = new Group();
  root.name = 'lane-view-floor';

  const grid = new GridHelper(FLOOR_SIZE, 48, 0x1f7f99, 0x0d3346);
  grid.position.y = 0.02;
  const gridMaterial = grid.material as LineBasicMaterial;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.4;
  gridMaterial.depthWrite = false;

  const subgrid = new GridHelper(FLOOR_SIZE * 0.42, 24, 0x35f0ff, 0x116079);
  subgrid.position.y = 0.04;
  const subgridMaterial = subgrid.material as LineBasicMaterial;
  subgridMaterial.transparent = true;
  subgridMaterial.opacity = 0.22;
  subgridMaterial.depthWrite = false;

  root.add(grid, subgrid);
  adapter.scene.add(root);
  return root;
}

/** The live hologram summary shown in the corner ticker. */
export function describeHologram(state: DeepReadonly<GameState>): string[] {
  const lanes = measureLaneOccupancies(state);
  const travellers = lanes.reduce((total, lane) => total + lane.occupancy, 0);
  const busyLanes = lanes.filter((lane) => lane.occupancy > 0).length;

  const rings = state.verification.order.flatMap((gateId) => {
    const gate = state.verification.gates[gateId];
    return gate ? [classifyGateRing(gate.status)] : [];
  });
  const alarm = rings.filter((ring) => ring.state === 'failed').length;
  const passed = rings.filter((ring) => ring.state === 'passed').length;
  const pending = rings.length - alarm - passed;

  const criteria = createConstellationLayout(state);
  const invariants = criteria.filter((criterion) => criterion.kind === 'final-invariant');
  const milestones = criteria.filter((criterion) => criterion.kind === 'milestone').length;
  const superseded = criteria.filter((criterion) => criterion.kind === 'superseded').length;
  const settled = invariants.filter((criterion) => criterion.completed).length;
  const apex = criteria.reduce((top, criterion) => Math.max(top, criterion.position.y), 0);

  return [
    `agents travelling  ${travellers}   lanes ${busyLanes}/${lanes.length}`,
    `gate rings         ${passed} passed · ${pending} pending · ${alarm} alarm`,
    `constellation      ${milestones} milestone · ${invariants.length} invariant (${settled} settled)`,
    `                   ${superseded} superseded · apex ${apex.toFixed(1)} m`,
  ];
}

/** Header line for the page ticker: adapter, frame counter and mission clock. */
export function describeStatus(harness: PreviewHarness, frame: GameFrame): string {
  const state = harness.game.state;
  const seconds = Math.max(0, frame.elapsedMs) / 1_000;
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  const progress = (state.mission.progress * 100).toFixed(0).padStart(3);
  return `${harness.adapter.kind} · frame ${frame.frame} · mission ${state.mission.status} ${progress}% · t+${mm}:${ss}`;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export interface CoroidLaneViewHandle {
  readonly harness: PreviewHarness;
  /** On-demand gate scenarios a browser verifier (or a human) can trigger. */
  readonly scenarios: ScenarioControls;
  /** Exactly the lines the page ticker shows. */
  summary(): string[];
}

/** Deterministic gate scenarios exposed to the preview page controls. */
export interface ScenarioControls {
  /** Fail a gate so the magenta-red repair alarm appears on demand. */
  failGate(): void;
  /** Settle every gate back to passed. */
  repairGates(): void;
}

/** The slice of a running game the scenarios drive. */
export interface ScenarioHost {
  readonly game: {
    readonly state: DeepReadonly<GameState>;
    emit(event: ReturnType<typeof makeDomainEvent<'verification/run'>>): void;
    commit(): number;
  };
}

/**
 * Build the on-demand gate scenarios.
 *
 * Kept independent of the DOM so tests can drive exactly what the preview
 * buttons drive; `wireScenarioButtons` only adds the click listeners.
 */
export function createScenarioControls(host: ScenarioHost): ScenarioControls {
  const game = host.game;
  const emitGateRun = (gateId: string, status: TaskStatus, coverage: number): void => {
    game.emit(
      makeDomainEvent('verification/run', { gateId, status, coverage }, game.state.mission.elapsedMs + 1),
    );
  };

  return {
    failGate(): void {
      const state = game.state;
      const target =
        state.verification.order.find((gateId) => {
          const gate = state.verification.gates[gateId];
          return gate !== undefined && gate.status !== 'failed';
        }) ?? state.verification.order[0];
      if (!target) return;
      emitGateRun(target, 'failed', 0.34);
      game.commit();
    },
    repairGates(): void {
      for (const gateId of game.state.verification.order) {
        emitGateRun(gateId, 'passed', 1);
      }
      game.commit();
    },
  };
}

/** Hook the page's `data-coroid-scenario` buttons up to the scenarios. */
function wireScenarioButtons(document: Document, controls: ScenarioControls): void {
  const alarm = document.querySelector<HTMLButtonElement>('[data-coroid-scenario="gate-alarm"]');
  const repair = document.querySelector<HTMLButtonElement>('[data-coroid-scenario="gate-repair"]');
  alarm?.addEventListener('click', () => controls.failGate());
  repair?.addEventListener('click', () => controls.repairGates());
}

declare global {
  interface Window {
    /** Browser-verification handle for the lane-view preview page. */
    coroidLaneView?: CoroidLaneViewHandle;
  }
}

export interface LanePreviewOptions {
  /** Host element. Defaults to `#lane-view`. */
  host?: HTMLElement | null;
  /** Ticker element. Defaults to `#lane-view-ticker`. */
  ticker?: HTMLElement | null;
}

/** Mount the preview page: harness, views, director, camera and ticker. */
export function bootLanePreview(options: LanePreviewOptions = {}): CoroidLaneViewHandle | null {
  if (typeof document === 'undefined') return null;
  const host = options.host ?? document.getElementById('lane-view');
  if (!host) return null;
  const ticker =
    options.ticker === undefined ? document.getElementById('lane-view-ticker') : options.ticker;

  const mounted = mountGamePreview({
    container: host,
    adapter: 'auto',
    // The page provides its own HUD (status line + hologram summary), so the
    // harness's small overlay stays out of the way.
    overlay: false,
    state: createSampleState(),
    systems: [createLaneAgentsSystem(), createQualityGraphSystem(), createLaneShowDirector()],
    onFrame: (frame) => {
      orbitCamera(mounted.adapter, frame.elapsedMs);
      if (ticker && (frame.frame === 1 || frame.frame % 15 === 0)) {
        ticker.textContent = [
          describeStatus(mounted, frame),
          ...describeHologram(mounted.game.state),
        ].join('\n');
      }
    },
  });

  const handle: CoroidLaneViewHandle = {
    harness: mounted,
    scenarios: createScenarioControls(mounted),
    summary: () => describeHologram(mounted.game.state),
  };
  createPreviewFloor(mounted.adapter);
  wireScenarioButtons(document, handle.scenarios);
  window.coroidLaneView = handle;
  return handle;
}

try {
  bootLanePreview();
} catch (error) {
  console.error('[coroid] failed to mount the lane-view preview', error);
  const ticker = document.getElementById('lane-view-ticker');
  if (ticker) {
    ticker.textContent =
      'Hologram offline — this browser could not provide a renderer for the lane view.';
  }
}
