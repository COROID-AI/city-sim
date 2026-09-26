/**
 * Deterministic sample mission state.
 *
 * `createSampleState` builds a believable factory run on top of the real domain
 * event contract: it emits a registration/verification/economy event script and
 * reduces it through `applyDomainEvents`. Two properties follow from that:
 *
 *  - the fixture exercises the same reducer the runtime uses, so a fixture that
 *    looks right is evidence the contract works;
 *  - the result is deterministic for a given seed. The seed only jitters a few
 *    continuous values (task progress, gate coverage, metric values), so the
 *    structure later modules write into is always identical.
 */

import { createRng } from '../game/loop';
import {
  applyDomainEvents,
  createInitialState,
  makeDomainEvent,
  type DomainEvent,
  type GameState,
  type LaneKind,
} from './state';

/** Default seed for the fixture. */
export const SAMPLE_SEED = 20260917;

/** Default mission identity used by the fixture. */
export const SAMPLE_MISSION_ID = 'mission-coroid-holographic-factory';

export interface SampleStateOptions {
  seed?: number;
  missionId?: string;
  /** Simulated milliseconds the fixture run has been alive for. Defaults to 90s. */
  elapsedMs?: number;
}

interface LaneBlueprint {
  id: string;
  kind: LaneKind;
  label: string;
  capacity: number;
}

interface TaskBlueprint {
  id: string;
  title: string;
  laneId: string;
  status: 'pending' | 'running' | 'passed' | 'blocked';
  progress: number;
  jitter: number;
  dependencies: string[];
}

const LANE_BLUEPRINTS: readonly LaneBlueprint[] = [
  { id: 'lane-discovery', kind: 'discovery', label: 'Discovery', capacity: 2 },
  { id: 'lane-build', kind: 'build', label: 'Build', capacity: 4 },
  { id: 'lane-verify', kind: 'verify', label: 'Verification', capacity: 2 },
  { id: 'lane-integrate', kind: 'integrate', label: 'Integration', capacity: 1 },
  { id: 'lane-observe', kind: 'observe', label: 'Observability', capacity: 1 },
];

const TASK_BLUEPRINTS: readonly TaskBlueprint[] = [
  {
    id: 'task-shell',
    title: 'Scaffold the holographic shell',
    laneId: 'lane-build',
    status: 'passed',
    progress: 1,
    jitter: 0,
    dependencies: [],
  },
  {
    id: 'task-contract',
    title: 'Freeze the GameState contract',
    laneId: 'lane-build',
    status: 'passed',
    progress: 1,
    jitter: 0,
    dependencies: ['task-shell'],
  },
  {
    id: 'task-lane-comets',
    title: 'Stream the agent lane comets',
    laneId: 'lane-build',
    status: 'running',
    progress: 0.62,
    jitter: 0.09,
    dependencies: ['task-contract'],
  },
  {
    id: 'task-gates',
    title: 'Light the verification gates',
    laneId: 'lane-verify',
    status: 'running',
    progress: 0.48,
    jitter: 0.08,
    dependencies: ['task-contract'],
  },
  {
    id: 'task-constellation',
    title: 'Assemble the quality constellation',
    laneId: 'lane-build',
    status: 'running',
    progress: 0.31,
    jitter: 0.1,
    dependencies: ['task-lane-comets'],
  },
  {
    id: 'task-economy',
    title: 'Balance credits, context and deadlines',
    laneId: 'lane-observe',
    status: 'blocked',
    progress: 0.22,
    jitter: 0.06,
    dependencies: ['task-contract'],
  },
  {
    id: 'task-review',
    title: 'Ship the holographic review',
    laneId: 'lane-integrate',
    status: 'pending',
    progress: 0,
    jitter: 0,
    dependencies: ['task-gates', 'task-constellation'],
  },
];

interface GateBlueprint {
  id: string;
  name: string;
  laneId: string;
  status: 'pending' | 'running' | 'passed';
  coverage: number;
  jitter: number;
}

const GATE_BLUEPRINTS: readonly GateBlueprint[] = [
  {
    id: 'gate-typecheck',
    name: 'Typecheck',
    laneId: 'lane-verify',
    status: 'passed',
    coverage: 1,
    jitter: 0,
  },
  {
    id: 'gate-bundle',
    name: 'Production bundle',
    laneId: 'lane-verify',
    status: 'passed',
    coverage: 1,
    jitter: 0,
  },
  {
    id: 'gate-boot-smoke',
    name: 'Boot smoke',
    laneId: 'lane-verify',
    status: 'running',
    coverage: 0.5,
    jitter: 0.12,
  },
  {
    id: 'gate-fidelity',
    name: 'Hologram fidelity',
    laneId: 'lane-observe',
    status: 'pending',
    coverage: 0,
    jitter: 0,
  },
];

interface MetricBlueprint {
  id: string;
  label: string;
  value: number;
  target: number;
  weight: number;
  jitter: number;
}

const METRIC_BLUEPRINTS: readonly MetricBlueprint[] = [
  { id: 'metric-fidelity', label: 'Visual fidelity', value: 0.86, target: 1, weight: 0.25, jitter: 0.05 },
  { id: 'metric-determinism', label: 'Determinism', value: 1, target: 1, weight: 0.3, jitter: 0 },
  { id: 'metric-frame-budget', label: 'Frame budget', value: 0.78, target: 1, weight: 0.15, jitter: 0.06 },
  {
    id: 'metric-contract-coverage',
    label: 'Contract coverage',
    value: 0.9,
    target: 0.95,
    weight: 0.2,
    jitter: 0.03,
  },
  { id: 'metric-readability', label: 'Readability', value: 0.82, target: 1, weight: 0.1, jitter: 0.04 },
];

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);
const round = (value: number, places = 3): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function resolveSeed(input: number | SampleStateOptions = {}): number {
  if (typeof input === 'number') return input;
  return input.seed ?? SAMPLE_SEED;
}

/**
 * Build the deterministic sample mission state.
 *
 * Accepts a seed directly (`createSampleState(7)`) or an options object
 * (`createSampleState({ seed: 7, missionId })`).
 */
export function createSampleState(input: number | SampleStateOptions = {}): GameState {
  const options: SampleStateOptions = typeof input === 'number' ? { seed: input } : input;
  const seed = resolveSeed(options);
  const missionId = options.missionId ?? SAMPLE_MISSION_ID;
  const horizonMs = options.elapsedMs ?? 90_000;
  const rng = createRng(seed);

  const events: DomainEvent[] = [];
  // Simulated clock for the fixture script: a fixed cadence so replay is stable.
  let at = 0;
  const tick = (ms: number): number => {
    at += ms;
    return at;
  };

  const initial = createInitialState({
    seed,
    missionId,
    codename: 'HOLO-FACTORY',
    objective:
      'Show what Coroid is: an autonomous software factory where agent lanes plan, build, verify and ship work while the holographic floor reports every move.',
    startingCredits: 4_000 + Math.round(rng.float(0, 400)),
    creditRatePerTask: 12,
    contextBudget: 200_000,
    reputation: 68,
    deadlineMs: 45 * 60 * 1000,
  });

  events.push(makeDomainEvent('mission/started', {}, tick(0)));
  events.push(makeDomainEvent('economy/reward', { credits: 960, reputation: 5 }, tick(600)));
  events.push(
    makeDomainEvent('economy/spend', { credits: 240, contextTokens: 18_400 }, tick(1_200)),
  );

  for (const lane of LANE_BLUEPRINTS) {
    events.push(
      makeDomainEvent(
        'lane/registered',
        { lane: { id: lane.id, kind: lane.kind, label: lane.label, capacity: lane.capacity } },
        tick(200),
      ),
    );
  }

  for (const task of TASK_BLUEPRINTS) {
    const progress =
      task.status === 'running' ? clamp01(task.progress + rng.float(-task.jitter, task.jitter)) : task.progress;
    events.push(
      makeDomainEvent(
        'plan/task-registered',
        {
          task: {
            id: task.id,
            title: task.title,
            laneId: task.laneId,
            status: task.status === 'blocked' ? 'blocked' : task.status === 'pending' ? 'pending' : 'running',
            progress: round(progress),
            dependencies: [...task.dependencies],
          },
        },
        tick(400),
      ),
    );
  }

  // Settle the completed tasks through the normal update path.
  for (const task of TASK_BLUEPRINTS) {
    if (task.status !== 'passed') continue;
    events.push(
      makeDomainEvent('plan/task-updated', { taskId: task.id, status: 'passed', progress: 1 }, tick(300)),
    );
  }

  // Put the running tasks on their lanes: assignment marks them as running.
  const runningTasks = TASK_BLUEPRINTS.filter((task) => task.status === 'running');
  const activeLaneIds = new Set<string>();
  runningTasks.forEach((task, index) => {
    if (activeLaneIds.has(task.laneId)) {
      events.push(makeDomainEvent('lane/queued', { laneId: task.laneId, taskId: task.id }, tick(150)));
      return;
    }
    activeLaneIds.add(task.laneId);
    events.push(
      makeDomainEvent('lane/assigned', { laneId: task.laneId, taskId: task.id }, tick(150 + index * 40)),
    );
  });

  for (const gate of GATE_BLUEPRINTS) {
    const coverage =
      gate.status === 'pending' ? 0 : clamp01(gate.coverage + rng.float(-gate.jitter, gate.jitter));
    events.push(
      makeDomainEvent(
        'verification/gate-registered',
        {
          gate: {
            id: gate.id,
            name: gate.name,
            laneId: gate.laneId,
            status: gate.status === 'pending' ? 'pending' : gate.coverage >= 1 ? 'passed' : 'running',
            coverage: gate.coverage >= 1 ? 1 : round(coverage),
            attempts: gate.status === 'pending' ? 0 : 1,
            lastRunAtMs: gate.status === 'pending' ? null : 5_000,
          },
        },
        tick(320),
      ),
    );
  }

  for (const metric of METRIC_BLUEPRINTS) {
    const value =
      metric.jitter === 0 ? metric.value : clamp01(metric.value + rng.float(-metric.jitter, metric.jitter));
    events.push(
      makeDomainEvent(
        'quality/measured',
        {
          metric: {
            id: metric.id,
            label: metric.label,
            value: metric.value === 1 ? 1 : round(value),
            target: metric.target,
            weight: metric.weight,
          },
        },
        tick(260),
      ),
    );
  }

  events.push(
    makeDomainEvent(
      'quality/finding',
      {
        finding: {
          id: 'finding-hologram-density',
          severity: 'low',
          summary: 'Hologram density on the outer grid reads sparse at wide framing.',
          taskId: 'task-lane-comets',
          atMs: 12_000,
        },
      },
      tick(200),
    ),
  );
  events.push(
    makeDomainEvent(
      'quality/finding',
      {
        finding: {
          id: 'finding-context-pressure',
          severity: 'medium',
          summary: 'Observability lane is consuming context faster than the deadline allows.',
          taskId: 'task-economy',
          atMs: 31_000,
        },
      },
      tick(200),
    ),
  );

  events.push(
    makeDomainEvent(
      'economy/spend',
      { credits: 320, contextTokens: 42_600 + Math.round(rng.float(0, 4_000)) },
      tick(2_400),
    ),
  );
  events.push(makeDomainEvent('economy/deadline', { deadlineMs: 45 * 60 * 1000 }, tick(400)));

  // Let the fixture script end at the requested simulated horizon.
  if (horizonMs > at) at = horizonMs;

  return applyDomainEvents(initial, events);
}
