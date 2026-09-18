/**
 * Dev preview: the Coroid interface layer over a running mission.
 *
 * The page mounts the shared preview harness (canvas, adapters, deterministic
 * state) and layers the interface on top of it:
 *
 *  - `src/ui/hud.ts` renders the top overlay (context budget and its depletion
 *    bar, final-invariant counter, credits, reputation, sim clock, current phase
 *    and lane occupancy), the objective banner and the provenance-tagged event
 *    log terminal;
 *  - `src/ui/panels.ts` renders the task inspector, plan outline, verification
 *    report and codex as keyboard-trapped modal panels;
 *  - this file wires them together: every domain event the mission emits is
 *    appended to the terminal, every fixed step refreshes the readouts, and the
 *    keyboard shortcuts open and close the panels.
 *
 * A local **mission director** keeps the show alive: it emits ordinary domain
 * events (task progress, dispatch, context burn, rewards, gate runs, metric
 * measurements and mission status changes) on the simulated clock, so the whole
 * preview is deterministic and the interface only ever renders real state
 * transitions. Nothing here mutates state directly — the director emits events
 * and the runtime reduces them.
 *
 * The event log demonstrates announcements as well: settling invariants, falling
 * gates and mission status changes all reach the HUD's `aria-live` region.
 */

import '../src/styles/base.css';
import '../src/styles/hud.css';

import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  GridHelper,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';

import type { GameFrame } from '../src/game/Game';
import type { GameSystem } from '../src/game/systems';
import type { RenderAdapter } from '../src/render/renderer';
import { createSampleState } from '../src/sim/fixtures';
import { makeDomainEvent, type DomainEvent, type GameState, type MissionStatus } from '../src/sim/state';
import {
  createHudOverlay,
  type HudIntent,
  type HudOverlayHandle,
  type HudState,
} from '../src/ui/hud';
import {
  createPanelHost,
  type CodexConcept,
  type PanelHost,
  type PanelIntent,
  type PanelKind,
  type TaskContractMap,
} from '../src/ui/panels';
import { mountGamePreview, type PreviewAdapterPreference, type PreviewHarness } from './harness';

/* -------------------------------------------------------------------------- */
/* Holographic backdrop                                                       */
/* -------------------------------------------------------------------------- */

/** Footprint of the preview's emitter grid, in world units. */
export const FLOOR_SIZE = 92;

/** Holographic ground plane: emitter grid, subgrid, a sweep ring and a column. */
export function createPreviewFloor(adapter: RenderAdapter): Group {
  const root = new Group();
  root.name = 'hud-preview-floor';

  const grid = new GridHelper(FLOOR_SIZE, 52, 0x1f7f99, 0x0d3346);
  grid.position.y = 0.02;
  const gridMaterial = grid.material as LineBasicMaterial;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.38;
  gridMaterial.depthWrite = false;

  const subgrid = new GridHelper(FLOOR_SIZE * 0.4, 26, 0x35f0ff, 0x116079);
  subgrid.position.y = 0.04;
  const subgridMaterial = subgrid.material as LineBasicMaterial;
  subgridMaterial.transparent = true;
  subgridMaterial.opacity = 0.2;
  subgridMaterial.depthWrite = false;

  const ringMaterial = new MeshBasicMaterial({
    color: 0x35f0ff,
    transparent: true,
    opacity: 0.22,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const ring = new Mesh(new RingGeometry(13.4, 13.5, 192), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;

  const columnMaterial = new MeshBasicMaterial({
    color: 0x9ffbff,
    transparent: true,
    opacity: 0.05,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const column = new Mesh(new CylinderGeometry(3.1, 3.6, 22, 64, 1, true), columnMaterial);
  column.position.y = 11;

  root.add(grid, subgrid, ring, column);
  adapter.scene.add(root);
  return root;
}

/** Slow orbit that keeps the floor and the emitter column in frame. */
export function orbitCamera(adapter: RenderAdapter, elapsedMs: number): void {
  const seconds = elapsedMs / 1000;
  const angle = 0.9 + Math.sin(seconds * 0.05) * 0.6;
  const radius = 36 + Math.sin(seconds * 0.037) * 3;
  const camera = adapter.camera;
  camera.position.set(
    Math.cos(angle) * radius,
    18 + Math.sin(seconds * 0.061) * 2.2,
    Math.sin(angle) * radius,
  );
  camera.lookAt(0, 9, 0);
}

/* -------------------------------------------------------------------------- */
/* Mission director                                                           */
/* -------------------------------------------------------------------------- */

export interface MissionDirectorOptions {
  /** System id. Defaults to `preview/hud-mission-director`. */
  id?: string;
  /** Simulated milliseconds between task-progress events. */
  progressIntervalMs?: number;
  /** Simulated milliseconds between context-burn events. */
  burnIntervalMs?: number;
  /** Simulated milliseconds between metric measurements. */
  metricIntervalMs?: number;
  /** Simulated milliseconds between gate runs. */
  gateIntervalMs?: number;
  /** Simulated milliseconds between mission status changes. */
  statusIntervalMs?: number;
}

/** Spare work the director queues onto lanes so occupancy keeps moving. */
const SPARE_QUEUE: readonly (readonly [laneId: string, taskId: string])[] = [
  ['lane-verify', 'task-constellation'],
  ['lane-build', 'task-economy'],
  ['lane-observe', 'task-gates'],
  ['lane-discovery', 'task-shell'],
  ['lane-verify', 'task-lane-comets'],
  ['lane-integrate', 'task-review'],
];

/** The status loop the banner announces through the live region. */
const STATUS_CYCLE: readonly MissionStatus[] = ['running', 'delivering', 'delivered', 'running'];

/** Gate outcomes cycled by the director: running, running, passed, alarm, repair. */
const GATE_PATTERN: readonly { status: 'running' | 'passed' | 'failed'; coverage: number }[] = [
  { status: 'running', coverage: 0.42 },
  { status: 'running', coverage: 0.74 },
  { status: 'passed', coverage: 1 },
  { status: 'failed', coverage: 0.31 },
  { status: 'running', coverage: 0.62 },
  { status: 'passed', coverage: 1 },
];

const PROGRESS_STEP = 0.055;
const METRIC_STEP = 0.34;
const METRIC_FLOOR = 0.04;

/**
 * Drive a fixture mission through the states the interface has to show.
 *
 * The director owns no state of its own beyond cursors and accumulators: it
 * reads the frozen snapshot each step and emits domain events on the simulated
 * clock, which is what makes the preview deterministic and replay-identical.
 */
export function createMissionDirector(options: MissionDirectorOptions = {}): GameSystem {
  const progressIntervalMs = options.progressIntervalMs ?? 900;
  const burnIntervalMs = options.burnIntervalMs ?? 750;
  const metricIntervalMs = options.metricIntervalMs ?? 2_400;
  const gateIntervalMs = options.gateIntervalMs ?? 5_500;
  const statusIntervalMs = options.statusIntervalMs ?? 21_000;
  const queueIntervalMs = 3_000;
  const rewardIntervalMs = 6_000;

  const fired = new Map<string, number>();
  let clockMs = 0;
  let initialised = false;
  let gateCursor = 0;
  let queueCursor = 0;
  let statusCursor = 0;

  /** True at most once per interval, keyed so every schedule runs on its own. */
  const due = (key: string, intervalMs: number, elapsedMs: number): boolean => {
    const index = Math.floor(elapsedMs / intervalMs);
    const last = fired.get(key) ?? -1;
    if (index <= last) return false;
    fired.set(key, index);
    return true;
  };

  return {
    id: options.id ?? 'preview/hud-mission-director',
    attach(): void {
      // Nothing to attach: the director is pure state choreography.
    },
    update(update): void {
      const state = update.state;
      const emit = (event: DomainEvent): void => update.context.events.emit(event);

      if (!initialised) {
        // The fixture starts at t+90s; keep the simulated clock monotonic.
        clockMs = Math.max(clockMs, state.mission.elapsedMs);
        initialised = true;
        // The first line of the terminal: the brief starts the mission.
        emit(makeDomainEvent('mission/started', {}, clockMs));
      }
      clockMs += Math.max(1, Math.round(update.deltaMs));
      const elapsed = clockMs;

      // 1. Task progress, completion, release and dispatch.
      if (due('progress', progressIntervalMs, elapsed)) {
        for (const taskId of state.plan.order) {
          const task = state.plan.tasks[taskId];
          if (!task || task.status !== 'running') continue;
          const progress = Math.min(1, Math.round((task.progress + PROGRESS_STEP) * 1000) / 1000);
          if (progress >= 1) continue; // completion is handled below, in one event
          emit(makeDomainEvent('plan/task-updated', { taskId, progress }, elapsed));
        }

        const finishing = state.plan.order.find((taskId) => {
          const task = state.plan.tasks[taskId];
          return !!task && task.status === 'running' && task.progress >= 1 - PROGRESS_STEP;
        });
        if (finishing) {
          const finished = state.plan.tasks[finishing];
          emit(
            makeDomainEvent(
              'plan/task-updated',
              { taskId: finishing, status: 'passed', progress: 1 },
              elapsed,
            ),
          );
          if (finished) {
            emit(
              makeDomainEvent('lane/released', { laneId: finished.laneId, taskId: finishing }, elapsed),
            );
          }
          const ready = state.plan.order.find((taskId) => {
            const task = state.plan.tasks[taskId];
            if (!task || (task.status !== 'pending' && task.status !== 'blocked')) return false;
            return task.dependencies.every(
              (dependency) =>
                dependency === finishing || state.plan.tasks[dependency]?.status === 'passed',
            );
          });
          const nextTask = ready ? state.plan.tasks[ready] : undefined;
          if (nextTask) {
            emit(
              makeDomainEvent(
                'lane/assigned',
                { laneId: nextTask.laneId, taskId: nextTask.id },
                elapsed,
              ),
            );
          }
        }
      }

      // 2. Context burn: the depletion bar visibly falls.
      if (due('burn', burnIntervalMs, elapsed)) {
        emit(
          makeDomainEvent(
            'economy/spend',
            {
              credits: 16 + Math.round(update.context.rng.float(0, 24)),
              contextTokens: 520 + Math.round(update.context.rng.float(0, 1_240)),
            },
            elapsed,
          ),
        );
      }

      // 3. Rewards keep credits and reputation moving.
      if (due('reward', rewardIntervalMs, elapsed)) {
        emit(
          makeDomainEvent(
            'economy/reward',
            { credits: 300 + Math.round(update.context.rng.float(0, 220)), reputation: 1 },
            elapsed,
          ),
        );
      }

      // 4. Criteria settle one at a time, then one slips to show the alarm path.
      if (due('metric', metricIntervalMs, elapsed)) {
        const pending = state.quality.order.find((metricId) => {
          const metric = state.quality.metrics[metricId];
          return !!metric && metric.value < metric.target - 1e-6;
        });
        if (pending) {
          const metric = state.quality.metrics[pending];
          if (metric) {
            const value = Math.min(
              metric.target,
              Math.round((metric.value + Math.max(METRIC_FLOOR, (metric.target - metric.value) * METRIC_STEP)) * 1000) /
                1000,
            );
            emit(
              makeDomainEvent(
                'quality/measured',
                { metric: { id: metric.id, label: metric.label, value, target: metric.target, weight: metric.weight } },
                elapsed,
              ),
            );
          }
        } else {
          // Every invariant holds: let the weakest slip so the mission keeps moving.
          const weakest = state.quality.order.reduce<string | null>((lowest, metricId) => {
            const metric = state.quality.metrics[metricId];
            if (!metric) return lowest;
            if (lowest === null) return metricId;
            const other = state.quality.metrics[lowest];
            return other && metric.value < other.value ? metricId : lowest;
          }, null);
          const metric = weakest ? state.quality.metrics[weakest] : undefined;
          if (metric) {
            const value = Math.max(0, Math.round((metric.target - 0.34) * 1000) / 1000);
            emit(
              makeDomainEvent(
                'quality/measured',
                { metric: { id: metric.id, label: metric.label, value, target: metric.target, weight: metric.weight } },
                elapsed,
              ),
            );
          }
        }
      }

      // 5. Gate runs cycle through running, passed and alarm-with-repair.
      if (due('gate', gateIntervalMs, elapsed)) {
        const gateId = state.verification.order[gateCursor % Math.max(1, state.verification.order.length)];
        gateCursor += 1;
        const step = GATE_PATTERN[gateCursor % GATE_PATTERN.length];
        if (gateId && step) {
          emit(
            makeDomainEvent(
              'verification/run',
              { gateId, status: step.status, coverage: step.coverage },
              elapsed,
            ),
          );
        }
      }

      // 6. Spare work arrives on the lanes, then clears again.
      if (due('queue', queueIntervalMs, elapsed)) {
        const spare = SPARE_QUEUE[queueCursor % SPARE_QUEUE.length];
        queueCursor += 1;
        if (spare) {
          const [laneId, taskId] = spare;
          emit(makeDomainEvent('lane/queued', { laneId, taskId }, elapsed));
        }
      }

      // 7. Mission status walks its lifecycle so the banner announces changes.
      if (due('status', statusIntervalMs, elapsed)) {
        const status = STATUS_CYCLE[statusCursor % STATUS_CYCLE.length];
        statusCursor += 1;
        if (status) emit(makeDomainEvent('mission/status', { status }, elapsed));
      }
    },
    dispose(): void {
      fired.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Preview execution contracts                                                */
/* -------------------------------------------------------------------------- */

/**
 * Representative execution-contract data for the preview.
 *
 * The real contracts arrive from the flow layer (`readSet` / `writeSet` /
 * `checks` / `criteria` / `claims` per task); the preview ships a small, honest
 * sample so the inspector can be reviewed in a browser without that layer.
 */
export const PREVIEW_CONTRACTS: TaskContractMap = {
  'task-contract': {
    readSet: ['package.json', 'vite.config.ts', 'tsconfig.json'],
    writeSet: ['src/sim/state.ts', 'src/sim/fixtures.ts', 'tests/state.test.ts'],
    checks: [
      {
        id: 'check-state-typecheck',
        kind: 'typecheck',
        assertion: 'Every state slice, event and selector compiles under strict TypeScript.',
        targetFile: 'src/sim/state.ts',
        evidence: 'command',
        status: 'passed',
      },
      {
        id: 'check-state-replay',
        kind: 'test',
        assertion: 'Replaying the same event list yields an identical state document.',
        targetFile: 'tests/state.test.ts',
        evidence: 'command',
        status: 'passed',
      },
    ],
    criteria: [
      {
        key: 'criterion-deterministic-replay',
        label: 'The same events always reduce to the same state.',
        requiredEvidence: 'command',
        lifecycle: 'final_invariant',
        satisfiedByCheckIds: ['check-state-replay'],
        provenance: 'user_requirement',
      },
    ],
    claims: [
      {
        statement: 'The product must be playable in a browser and show what Coroid is while it plays.',
        authority: 'user_requirement',
      },
      {
        statement: 'State is a plain serialisable document with no class instances or Dates.',
        authority: 'repository_observation',
      },
      {
        statement: 'Aggregates such as mission progress are derived on every reduction.',
        authority: 'architect_choice',
      },
    ],
  },
  'task-lane-comets': {
    readSet: ['src/sim/state.ts', 'src/sim/fixtures.ts', 'dev-preview/harness.ts'],
    writeSet: ['src/render/laneAgents.ts', 'tests/lane-view.test.ts'],
    checks: [
      {
        id: 'check-comets-typecheck',
        kind: 'typecheck',
        assertion: 'The lane agent view compiles with no errors.',
        targetFile: 'src/render/laneAgents.ts',
        evidence: 'command',
        status: 'passed',
      },
      {
        id: 'check-comets-render',
        kind: 'composition',
        assertion: 'Comets ride the dependency conduits and release every geometry on dispose.',
        targetFile: 'tests/lane-view.test.ts',
        evidence: 'command',
        status: 'running',
        detail: 'frame budget still above target at wide framing',
      },
    ],
    criteria: [
      {
        key: 'criterion-lane-motion',
        label: 'Agents visibly travel between dependent tasks.',
        requiredEvidence: 'visual',
        lifecycle: 'milestone',
        satisfiedByCheckIds: ['check-comets-render'],
        provenance: 'architect_choice',
      },
      {
        key: 'criterion-lane-legibility',
        label: 'A viewer can tell load, direction and speed without a legend.',
        requiredEvidence: 'visual',
        lifecycle: 'final_invariant',
        satisfiedByCheckIds: [],
        provenance: 'user_requirement',
      },
    ],
    claims: [
      {
        statement: 'The interface must read clearly while the simulation plays.',
        authority: 'user_requirement',
      },
      {
        statement: 'The dependency graph exposes phases, conduits and write conflicts.',
        authority: 'repository_observation',
      },
      {
        statement: 'Comets ride dependency conduits rather than straight lane lines.',
        authority: 'architect_choice',
      },
    ],
  },
  'task-gates': {
    readSet: ['src/sim/state.ts', 'src/sim/fixtures.ts'],
    writeSet: ['src/sim/verification.ts', 'tests/verification.test.ts'],
    checks: [
      {
        id: 'check-gate-repair',
        kind: 'test',
        assertion: 'A failing check opens exactly one repair objective and closes it on repair.',
        targetFile: 'tests/verification.test.ts',
        evidence: 'command',
        status: 'passed',
      },
      {
        id: 'check-gate-evidence',
        kind: 'test',
        assertion: 'Weaker evidence never satisfies a criterion that needs stronger evidence.',
        targetFile: 'src/sim/verification.ts',
        evidence: 'command',
        status: 'pending',
      },
    ],
    criteria: [
      {
        key: 'criterion-release-readiness',
        label: 'Nothing ships while a repair objective is open.',
        requiredEvidence: 'command',
        lifecycle: 'final_invariant',
        satisfiedByCheckIds: [],
        provenance: 'user_requirement',
      },
    ],
    claims: [
      {
        statement: 'The game must show which gates are green before work is trusted.',
        authority: 'user_requirement',
      },
      {
        statement: 'Criterion lifecycles promote milestones to final invariants explicitly.',
        authority: 'repository_observation',
      },
    ],
  },
  'task-constellation': {
    readSet: ['src/sim/state.ts', 'src/sim/fixtures.ts'],
    writeSet: ['src/render/qualityGraph.ts', 'tests/lane-view.test.ts'],
    checks: [
      {
        id: 'check-constellation-typecheck',
        kind: 'typecheck',
        assertion: 'The constellation layout compiles under strict TypeScript.',
        targetFile: 'src/render/qualityGraph.ts',
        evidence: 'command',
        status: 'passed',
      },
    ],
    criteria: [
      {
        key: 'criterion-invariants-rise',
        label: 'Settled invariants climb above the milestones that fed them.',
        requiredEvidence: 'visual',
        lifecycle: 'final_invariant',
        satisfiedByCheckIds: [],
        provenance: 'architect_choice',
      },
    ],
    claims: [
      {
        statement: 'Quality has to be visible, not a hidden number.',
        authority: 'user_requirement',
      },
      {
        statement: 'Metrics carry value, target and weight in the shared state slice.',
        authority: 'repository_observation',
      },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* Preview harness                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Mission briefings the preview hands to the interface in rotation.
 *
 * The simulation's objective is fixed by the fixture; when the flow layer exists
 * it will hand the HUD a fresh mission state whenever the brief changes. Until
 * then the preview projects these briefings onto the snapshot it renders
 * (preview-only: the game's own state is never touched) so the objective banner
 * and its `aria-live` announcement can be reviewed in a browser.
 */
export const PREVIEW_BRIEFINGS: readonly string[] = [
  'Name the lanes, say what each one is building, and keep the mission inside its context budget before the deadline.',
  'Prove the factory can replan: a failing gate opens a repair objective and the lanes re-route around it.',
  'Keep every token and credit accounted for: the mission ships inside its context budget and its deadline.',
  'Hand the finished work over: the plan closes, the final invariants hold and the mission is delivered.',
];

declare global {
  interface Window {
    /** Browser-verification handle for the interface preview page. */
    coroidHud?: HudPreviewHandle;
  }
}

export interface HudPreviewOptions {
  /** Host element. Defaults to `#hud-preview`. */
  host?: HTMLElement | null;
  /** Render adapter preference. Tests pass `'headless'`. */
  adapter?: PreviewAdapterPreference;
  /** Begin real-time playback. Defaults to `true`. */
  autoStart?: boolean;
  /** Starting state. Defaults to the seeded sample mission. */
  state?: GameState;
  seed?: number;
  /** Extra codex concepts merged over the mission-derived ones. */
  concepts?: readonly CodexConcept[];
  /** Execution contracts rendered by the inspector. Defaults to the samples. */
  contracts?: TaskContractMap;
  /** Register window-level shortcuts for the panels. Defaults to `true`. */
  keyboard?: boolean;
  /**
   * Simulated milliseconds between automatic briefing rotations. `0` disables
   * the rotation. Defaults to 25s.
   */
  briefingIntervalMs?: number;
  /** Observes HUD and panel intents (tests, tutorials). */
  onIntent?(intent: HudIntent | PanelIntent): void;
}

export interface HudPreviewHandle {
  readonly harness: PreviewHarness;
  readonly hud: HudOverlayHandle;
  readonly panels: PanelHost;
  /** Pull the latest snapshot into the overlay and the open panel. */
  sync(): void;
  /** Project the next mission briefing and announce it. Returns the objective. */
  nextBriefing(): string;
  /** Handle a keyboard event; returns true when it was consumed. */
  handleKey(event: KeyboardEvent): boolean;
  /** Readable summary of the surface, for screenshots and acceptance scripts. */
  describe(): string[];
  dispose(): void;
}

/**
 * Mount the interface preview. Returns `null` when there is no host element to
 * mount into (for example when this module is imported by a test that builds its
 * own DOM).
 */
export function bootHudPreview(options: HudPreviewOptions = {}): HudPreviewHandle | null {
  if (typeof document === 'undefined') return null;
  const host = options.host ?? document.getElementById('hud-preview');
  if (!host) return null;

  const hud = createHudOverlay({
    host,
    logLimit: 90,
    onIntent: (intent) => {
      options.onIntent?.(intent);
      panels.togglePanel(intent.panel);
    },
  });
  const panels = createPanelHost({
    host,
    contracts: options.contracts ?? PREVIEW_CONTRACTS,
    concepts: options.concepts,
    announce: (message) => hud.announce(message),
    onIntent: (intent) => options.onIntent?.(intent),
  });

  const status = host.querySelector<HTMLElement>('#hud-preview-status');
  const briefingButton = host.querySelector<HTMLElement>('#hud-preview-briefing');
  const briefingIntervalMs = options.briefingIntervalMs ?? 25_000;
  let frames = 0;
  let disposed = false;
  let briefingIndex = -1;
  let lastBriefingMs = 0;

  const harness = mountGamePreview({
    container: host,
    adapter: options.adapter ?? 'auto',
    // The interface replaces the harness's small text overlay.
    overlay: false,
    state: options.state ?? createSampleState(),
    systems: [createMissionDirector()],
    autoStart: options.autoStart,
    onFrame: (frame: GameFrame) => {
      orbitCamera(harness.adapter, frame.elapsedMs);
      frames += 1;
      if (frame.frame === 1 || frame.frame % 3 === 0) sync();
      if (briefingIntervalMs > 0 && frame.elapsedMs - lastBriefingMs >= briefingIntervalMs) {
        lastBriefingMs = frame.elapsedMs;
        nextBriefing();
      }
    },
  });

  const unsubscribe = harness.game.events.on((event) => {
    hud.pushEvent(event);
  });

  /** The snapshot the interface renders: the mission, plus the active briefing. */
  function projectedState(): HudState {
    const state = harness.game.state;
    if (briefingIndex < 0) return state;
    const objective = PREVIEW_BRIEFINGS[briefingIndex % PREVIEW_BRIEFINGS.length];
    if (!objective) return state;
    return { ...state, mission: { ...state.mission, objective } };
  }

  /** Push the current snapshot through the interface. */
  function sync(): void {
    if (disposed) return;
    const state = projectedState();
    hud.update(state);
    panels.update(state);
  }

  /** Advance to the next briefing; the banner announces the change. */
  function nextBriefing(): string {
    briefingIndex += 1;
    const state = projectedState();
    hud.update(state);
    panels.update(state);
    return state.mission.objective;
  }

  /**
   * Window-level shortcuts. Escape and Tab are handled by the panel host first
   * (they only mean something while a panel is open), then the hotkeys.
   */
  function handleKey(event: KeyboardEvent): boolean {
    if (panels.handleKey(event)) return true;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return false;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return false;
    }
    const hotkeys: Record<string, PanelKind | undefined> = {
      i: 'inspector',
      o: 'outline',
      v: 'report',
      c: 'codex',
    };
    if (event.key.toLowerCase() === 'b') {
      event.preventDefault();
      nextBriefing();
      return true;
    }
    const panel = hotkeys[event.key.toLowerCase()];
    if (!panel) return false;
    event.preventDefault();
    panels.togglePanel(panel);
    return true;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    handleKey(event);
  };
  if (options.keyboard !== false) {
    window.addEventListener('keydown', onKeyDown);
  }
  const onBriefingClick = (): void => {
    nextBriefing();
  };
  briefingButton?.addEventListener('click', onBriefingClick);

  function describe(): string[] {
    const state = harness.game.state;
    return [
      `coroid interface preview · frame ${frames} · ${harness.adapter.kind}`,
      `mission    ${state.mission.codename} ${state.mission.status} ${(state.mission.progress * 100).toFixed(0)}%`,
      `budget     ${Math.round(state.economy.contextSpent / 1000)}k / ${Math.round(state.economy.contextBudget / 1000)}k`,
      `credits    ${Math.round(state.economy.credits)} · reputation ${Math.round(state.economy.reputation)}`,
      `lanes      ${state.lanes.order.filter((laneId) => state.lanes.lanes[laneId]?.activeTaskId).length}/${state.lanes.order.length} busy`,
      `briefing   ${briefingIndex < 0 ? 'mission brief' : `${(briefingIndex % PREVIEW_BRIEFINGS.length) + 1}/${PREVIEW_BRIEFINGS.length}`}`,
      `log lines  ${hud.log.entries.length} · panel ${panels.open ?? 'none'} · task ${panels.selectedTaskId ?? 'none'}`,
    ];
  }

  createPreviewFloor(harness.adapter);
  sync();

  if (status) {
    status.textContent = `interface online · ${harness.adapter.kind} adapter${
      harness.usedHeadlessFallback ? ' (headless fallback)' : ''
    } · I O V C open panels · B rotates the briefing · Esc closes`;
  }

  const handle: HudPreviewHandle = {
    harness,
    hud,
    panels,
    sync,
    nextBriefing,
    handleKey,
    describe,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (options.keyboard !== false) {
        window.removeEventListener('keydown', onKeyDown);
      }
      briefingButton?.removeEventListener('click', onBriefingClick);
      unsubscribe();
      panels.dispose();
      hud.dispose();
      harness.dispose();
    },
  };
  window.coroidHud = handle;
  return handle;
}

try {
  bootHudPreview();
} catch (error) {
  console.error('[coroid] failed to mount the interface preview', error);
  const status = typeof document === 'undefined' ? null : document.getElementById('hud-preview-status');
  if (status) {
    status.textContent = 'Interface offline — this browser could not provide a renderer.';
  }
}
