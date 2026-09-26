/**
 * Coroid domain state contract.
 *
 * Everything the factory simulation knows lives in a single `GameState`
 * document made of six slices that later modules write into:
 *
 *  - `mission`      — what is being shipped, how far along it is, how much time it burned
 *  - `plan`         — the registered tasks and their lifecycle
 *  - `lanes`        — the agent lanes (discovery/build/verify/integrate/observe) and their load
 *  - `verification` — the gates that must go green before work is trusted
 *  - `quality`      — measured quality metrics and the findings raised against them
 *  - `economy`      — credits, context budget, reputation and the deadline
 *
 * Contract rules:
 *  - State is a plain, serialisable object graph (no class instances, no Dates).
 *  - `reduceDomainEvent` is pure: it never mutates the state it is handed.
 *  - Aggregate fields (`mission.progress`, `lane.utilization`,
 *    `verification.passRate`, `quality.score`, `economy.creditsPerSecond`) are
 *    *derived*: every reduction recomputes them from the primitive slices, so
 *    replaying the same events always yields the same aggregates.
 *  - Consumers (renderers, UI, tests) read frozen snapshots from
 *    `createSnapshot`, never the live state object.
 */

/** Lifecycle status shared by plan tasks and verification gates. */
export type TaskStatus = 'pending' | 'running' | 'passed' | 'failed' | 'blocked';

/** High level status of the mission the factory is producing. */
export type MissionStatus = 'bootstrapping' | 'running' | 'delivering' | 'delivered' | 'blocked';

/** The kind of work an agent lane performs. */
export type LaneKind = 'discovery' | 'build' | 'verify' | 'integrate' | 'observe';

/** Severity of a quality finding. */
export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** `mission` slice: the objective currently on the factory floor. */
export interface MissionState {
  id: string;
  codename: string;
  objective: string;
  status: MissionStatus;
  /** Simulated milliseconds consumed so far (advanced by event timestamps). */
  elapsedMs: number;
  /** Derived 0..1 completion ratio over the plan. */
  progress: number;
}

/** `plan` slice: one task of the mission plan. */
export interface PlanTaskState {
  id: string;
  title: string;
  laneId: string;
  status: TaskStatus;
  /** 0..1 completion ratio reported for this task. */
  progress: number;
  dependencies: string[];
  startedAtMs: number | null;
  finishedAtMs: number | null;
}

/** `plan` slice: registered tasks plus their stable insertion order. */
export interface PlanState {
  id: string;
  order: string[];
  tasks: Record<string, PlanTaskState>;
}

/** `lane` slice: an agent lane that carries tasks through the factory. */
export interface LaneState {
  id: string;
  kind: LaneKind;
  label: string;
  capacity: number;
  activeTaskId: string | null;
  queue: string[];
  /** Derived 0..1 utilisation from the running tasks assigned to the lane. */
  utilization: number;
}

/** `lane` slice: lanes plus their stable insertion order. */
export interface LaneSlice {
  order: string[];
  lanes: Record<string, LaneState>;
}

/** `verification` slice: a gate that proves a slice of the mission. */
export interface VerificationGateState {
  id: string;
  name: string;
  laneId: string;
  status: TaskStatus;
  /** Derived-adjacent 0..1 coverage reported by the last run. */
  coverage: number;
  attempts: number;
  lastRunAtMs: number | null;
}

/** `verification` slice: gates, their order and the derived pass rate. */
export interface VerificationState {
  order: string[];
  gates: Record<string, VerificationGateState>;
  /** Derived 0..1 ratio of settled gates that passed. */
  passRate: number;
}

/** `quality` slice: one measured quality metric. */
export interface QualityMetricState {
  id: string;
  label: string;
  /** Measured 0..1 value. */
  value: number;
  /** 0..1 target the value is judged against. */
  target: number;
  /** Relative weight used by the derived constellation score. */
  weight: number;
}

/** `quality` slice: a finding raised against the current state of the work. */
export interface QualityFinding {
  id: string;
  severity: FindingSeverity;
  summary: string;
  taskId: string | null;
  atMs: number;
}

/** `quality` slice: metrics, findings and the derived weighted score. */
export interface QualityState {
  order: string[];
  metrics: Record<string, QualityMetricState>;
  findings: QualityFinding[];
  /** Derived 0..1 weighted score across all metrics. */
  score: number;
}

/** `economy` slice: the resources the factory spends while it works. */
export interface EconomyState {
  credits: number;
  /** Credits earned per second, per actively running task. */
  creditRatePerTask: number;
  /** Derived burn/earning rate: running tasks × `creditRatePerTask`. */
  creditsPerSecond: number;
  contextBudget: number;
  contextSpent: number;
  /** 0..100 reputation score. */
  reputation: number;
  deadlineMs: number;
}

/** The complete deterministic state document for one factory run. */
export interface GameState {
  /** Seed that deterministic fixtures and RNG streams are derived from. */
  seed: number;
  /** Monotonic count of domain events applied to this state. */
  revision: number;
  mission: MissionState;
  plan: PlanState;
  lanes: LaneSlice;
  verification: VerificationState;
  quality: QualityState;
  economy: EconomyState;
}

/* -------------------------------------------------------------------------- */
/* Domain events                                                              */
/* -------------------------------------------------------------------------- */

/** Registration payload for a plan task; lifecycle fields are optional. */
export type TaskRegistration = Pick<PlanTaskState, 'id' | 'title' | 'laneId'> &
  Partial<Omit<PlanTaskState, 'id' | 'title' | 'laneId'>>;

/** Registration payload for an agent lane; behaviour fields are optional. */
export type LaneRegistration = Pick<LaneState, 'id' | 'kind' | 'label'> &
  Partial<Omit<LaneState, 'id' | 'kind' | 'label'>>;

/** Registration payload for a verification gate. */
export type GateRegistration = Pick<VerificationGateState, 'id' | 'name' | 'laneId'> &
  Partial<Omit<VerificationGateState, 'id' | 'name' | 'laneId'>>;

/** Registration payload for a quality metric. */
export type MetricRegistration = Pick<QualityMetricState, 'id' | 'label' | 'value'> &
  Partial<Omit<QualityMetricState, 'id' | 'label' | 'value'>>;

/**
 * Everything that can happen to the factory.
 *
 * Every event carries `at`: the simulated millisecond it happened at. The
 * reducer uses it for `mission.elapsedMs`, and `applyDomainEvents` sorts by it,
 * which is what makes replay order deterministic.
 */
export type DomainEvent =
  | { type: 'mission/started'; at: number }
  | { type: 'mission/status'; at: number; status: MissionStatus }
  | { type: 'plan/task-registered'; at: number; task: TaskRegistration }
  | {
      type: 'plan/task-updated';
      at: number;
      taskId: string;
      status?: TaskStatus;
      progress?: number;
      laneId?: string;
    }
  | { type: 'lane/registered'; at: number; lane: LaneRegistration }
  | { type: 'lane/queued'; at: number; laneId: string; taskId: string }
  | { type: 'lane/assigned'; at: number; laneId: string; taskId: string }
  | { type: 'lane/released'; at: number; laneId: string; taskId: string }
  | { type: 'verification/gate-registered'; at: number; gate: GateRegistration }
  | { type: 'verification/run'; at: number; gateId: string; status: TaskStatus; coverage: number }
  | { type: 'quality/measured'; at: number; metric: MetricRegistration }
  | { type: 'quality/finding'; at: number; finding: QualityFinding }
  | { type: 'economy/spend'; at: number; credits: number; contextTokens: number }
  | { type: 'economy/reward'; at: number; credits: number; reputation: number }
  | { type: 'economy/deadline'; at: number; deadlineMs: number };

/** Convenience alias for the discriminated union member for a given type tag. */
export type DomainEventOf<T extends DomainEvent['type']> = Extract<DomainEvent, { type: T }>;

/** Clock/timestamp-aware constructor for domain events. */
export function makeDomainEvent<T extends DomainEvent['type']>(
  type: T,
  payload: Omit<DomainEventOf<T>, 'type' | 'at'>,
  at: number,
): DomainEventOf<T> {
  return { type, at, ...payload } as DomainEventOf<T>;
}

/* -------------------------------------------------------------------------- */
/* Initial state                                                              */
/* -------------------------------------------------------------------------- */

export interface InitialStateOptions {
  seed?: number;
  missionId?: string;
  planId?: string;
  codename?: string;
  objective?: string;
  startingCredits?: number;
  creditRatePerTask?: number;
  contextBudget?: number;
  reputation?: number;
  deadlineMs?: number;
}

/** Build the empty state for a mission. Deterministic for identical options. */
export function createInitialState(options: InitialStateOptions = {}): GameState {
  return {
    seed: options.seed ?? 1,
    revision: 0,
    mission: {
      id: options.missionId ?? 'mission-coroid',
      codename: options.codename ?? 'COROID',
      objective:
        options.objective ??
        'Describe Coroid: an autonomous software factory where agent lanes build, verify and ship work.',
      status: 'bootstrapping',
      elapsedMs: 0,
      progress: 0,
    },
    plan: {
      id: options.planId ?? 'plan-coroid',
      order: [],
      tasks: {},
    },
    lanes: {
      order: [],
      lanes: {},
    },
    verification: {
      order: [],
      gates: {},
      passRate: 0,
    },
    quality: {
      order: [],
      metrics: {},
      findings: [],
      score: 0,
    },
    economy: {
      credits: options.startingCredits ?? 0,
      creditRatePerTask: options.creditRatePerTask ?? 12,
      creditsPerSecond: 0,
      contextBudget: options.contextBudget ?? 200_000,
      contextSpent: 0,
      reputation: options.reputation ?? 50,
      deadlineMs: options.deadlineMs ?? 60 * 60 * 1000,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Reducer                                                                    */
/* -------------------------------------------------------------------------- */

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/**
 * Apply one domain event, returning a new state. The input state is never
 * mutated, and every aggregate field is re-derived before the result is
 * returned.
 */
export function reduceDomainEvent(state: GameState, event: DomainEvent): GameState {
  const next: GameState = { ...state, revision: state.revision + 1 };
  next.mission = {
    ...state.mission,
    elapsedMs: Math.max(state.mission.elapsedMs, event.at),
  };

  switch (event.type) {
    case 'mission/started':
      next.mission = { ...next.mission, status: 'running' };
      break;

    case 'mission/status':
      next.mission = { ...next.mission, status: event.status };
      break;

    case 'plan/task-registered': {
      const registration = event.task;
      const task: PlanTaskState = {
        id: registration.id,
        title: registration.title,
        laneId: registration.laneId,
        status: registration.status ?? 'pending',
        progress: clamp01(registration.progress ?? 0),
        dependencies: registration.dependencies ? [...registration.dependencies] : [],
        startedAtMs: registration.startedAtMs ?? null,
        finishedAtMs: registration.finishedAtMs ?? null,
      };
      next.plan = {
        ...state.plan,
        order: state.plan.tasks[task.id] ? state.plan.order : [...state.plan.order, task.id],
        tasks: { ...state.plan.tasks, [task.id]: task },
      };
      break;
    }

    case 'plan/task-updated': {
      const current = state.plan.tasks[event.taskId];
      if (!current) break;
      const status = event.status ?? current.status;
      const settled = status === 'passed' || status === 'failed';
      const updated: PlanTaskState = {
        ...current,
        status,
        progress: event.progress === undefined ? current.progress : clamp01(event.progress),
        laneId: event.laneId ?? current.laneId,
        startedAtMs:
          current.startedAtMs ??
          (status === 'running' || settled ? event.at : null),
        finishedAtMs: settled ? event.at : current.finishedAtMs,
      };
      next.plan = { ...state.plan, tasks: { ...state.plan.tasks, [event.taskId]: updated } };
      break;
    }

    case 'lane/registered': {
      const registration = event.lane;
      const lane: LaneState = {
        id: registration.id,
        kind: registration.kind,
        label: registration.label,
        capacity: Math.max(1, registration.capacity ?? 1),
        activeTaskId: registration.activeTaskId ?? null,
        queue: registration.queue ? [...registration.queue] : [],
        utilization: 0,
      };
      next.lanes = {
        ...state.lanes,
        order: state.lanes.lanes[lane.id] ? state.lanes.order : [...state.lanes.order, lane.id],
        lanes: { ...state.lanes.lanes, [lane.id]: lane },
      };
      break;
    }

    case 'lane/queued': {
      const lane = state.lanes.lanes[event.laneId];
      if (!lane || lane.queue.includes(event.taskId)) break;
      next.lanes = {
        ...state.lanes,
        lanes: {
          ...state.lanes.lanes,
          [event.laneId]: { ...lane, queue: [...lane.queue, event.taskId] },
        },
      };
      break;
    }

    case 'lane/assigned': {
      const lane = state.lanes.lanes[event.laneId];
      if (!lane) break;
      next.lanes = {
        ...state.lanes,
        lanes: {
          ...state.lanes.lanes,
          [event.laneId]: {
            ...lane,
            activeTaskId: event.taskId,
            queue: lane.queue.filter((id) => id !== event.taskId),
          },
        },
      };
      const task = state.plan.tasks[event.taskId];
      if (task && task.status !== 'passed' && task.status !== 'failed') {
        next.plan = {
          ...state.plan,
          tasks: {
            ...state.plan.tasks,
            [event.taskId]: {
              ...task,
              laneId: event.laneId,
              status: 'running',
              startedAtMs: task.startedAtMs ?? event.at,
            },
          },
        };
      }
      break;
    }

    case 'lane/released': {
      const lane = state.lanes.lanes[event.laneId];
      if (!lane) break;
      if (lane.activeTaskId === event.taskId) {
        next.lanes = {
          ...state.lanes,
          lanes: { ...state.lanes.lanes, [event.laneId]: { ...lane, activeTaskId: null } },
        };
      }
      break;
    }

    case 'verification/gate-registered': {
      const registration = event.gate;
      const gate: VerificationGateState = {
        id: registration.id,
        name: registration.name,
        laneId: registration.laneId,
        status: registration.status ?? 'pending',
        coverage: clamp01(registration.coverage ?? 0),
        attempts: registration.attempts ?? 0,
        lastRunAtMs: registration.lastRunAtMs ?? null,
      };
      next.verification = {
        ...state.verification,
        order: state.verification.gates[gate.id]
          ? state.verification.order
          : [...state.verification.order, gate.id],
        gates: { ...state.verification.gates, [gate.id]: gate },
      };
      break;
    }

    case 'verification/run': {
      const gate = state.verification.gates[event.gateId];
      if (!gate) break;
      next.verification = {
        ...state.verification,
        gates: {
          ...state.verification.gates,
          [event.gateId]: {
            ...gate,
            status: event.status,
            coverage: clamp01(event.coverage),
            attempts: gate.attempts + 1,
            lastRunAtMs: event.at,
          },
        },
      };
      break;
    }

    case 'quality/measured': {
      const registration = event.metric;
      const metric: QualityMetricState = {
        id: registration.id,
        label: registration.label,
        value: clamp01(registration.value),
        target: registration.target === undefined ? 1 : clamp01(registration.target),
        weight: registration.weight === undefined ? 1 : Math.max(0, registration.weight),
      };
      next.quality = {
        ...state.quality,
        order: state.quality.metrics[metric.id]
          ? state.quality.order
          : [...state.quality.order, metric.id],
        metrics: { ...state.quality.metrics, [metric.id]: metric },
        findings: state.quality.findings,
      };
      break;
    }

    case 'quality/finding':
      next.quality = {
        ...state.quality,
        findings: [...state.quality.findings, { ...event.finding }],
      };
      break;

    case 'economy/spend': {
      const economy = state.economy;
      next.economy = {
        ...economy,
        credits: clamp(economy.credits - event.credits, 0, Number.MAX_SAFE_INTEGER),
        contextSpent: clamp(economy.contextSpent + event.contextTokens, 0, Number.MAX_SAFE_INTEGER),
      };
      break;
    }

    case 'economy/reward': {
      const economy = state.economy;
      next.economy = {
        ...economy,
        credits: clamp(economy.credits + event.credits, 0, Number.MAX_SAFE_INTEGER),
        reputation: clamp(economy.reputation + event.reputation, 0, 100),
      };
      break;
    }

    case 'economy/deadline':
      next.economy = { ...state.economy, deadlineMs: Math.max(0, event.deadlineMs) };
      break;

    default:
      return assertNever(event);
  }

  return recomputeDerivedState(next);
}

/** Exhaustiveness guard for the reducer switch. */
function assertNever(value: never): never {
  throw new Error(`[coroid] unhandled domain event: ${JSON.stringify(value)}`);
}

/**
 * Recompute every derived aggregate from the primitive slices.
 *
 * Kept separate (and exported for tests) so replay determinism has a single
 * source of truth: derived values are never stored by hand and never drift
 * from the slices they summarise.
 */
export function recomputeDerivedState(state: GameState): GameState {
  const tasks = Object.values(state.plan.tasks);
  const totalTasks = tasks.length;
  const settledTasks = tasks.filter((task) => task.status === 'passed').length;
  const runningTasks = tasks.filter((task) => task.status === 'running').length;

  const mission: MissionState = {
    ...state.mission,
    progress: totalTasks === 0 ? 0 : clamp01(settledTasks / totalTasks),
  };

  const lanes: Record<string, LaneState> = {};
  for (const [id, lane] of Object.entries(state.lanes.lanes)) {
    const active = tasks.filter((task) => task.laneId === id && task.status === 'running').length;
    lanes[id] = { ...lane, utilization: clamp01(active / lane.capacity) };
  }

  const gates = Object.values(state.verification.gates);
  const passedGates = gates.filter((gate) => gate.status === 'passed').length;
  const failedGates = gates.filter((gate) => gate.status === 'failed').length;
  const settledGates = passedGates + failedGates;
  const verification: VerificationState = {
    ...state.verification,
    passRate: settledGates === 0 ? 0 : clamp01(passedGates / settledGates),
  };

  const metrics = Object.values(state.quality.metrics);
  const totalWeight = metrics.reduce((sum, metric) => sum + metric.weight, 0);
  const weighted = metrics.reduce(
    (sum, metric) => sum + clamp01(metric.target === 0 ? 0 : metric.value / metric.target) * metric.weight,
    0,
  );
  const quality: QualityState = {
    ...state.quality,
    score: totalWeight === 0 ? 0 : clamp01(weighted / totalWeight),
  };

  const economy: EconomyState = {
    ...state.economy,
    creditsPerSecond: runningTasks * state.economy.creditRatePerTask,
    contextSpent: clamp(state.economy.contextSpent, 0, Number.MAX_SAFE_INTEGER),
    reputation: clamp(state.economy.reputation, 0, 100),
  };

  return { ...state, mission, lanes: { ...state.lanes, lanes }, verification, quality, economy };
}

/* -------------------------------------------------------------------------- */
/* Batch application                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Total order over domain events: simulated time first, caller order second.
 * `Array.prototype.sort` is stable, so equal timestamps keep their input order.
 */
export function compareDomainEvents(a: DomainEvent, b: DomainEvent): number {
  return a.at - b.at;
}

/** Apply a batch of events in deterministic (time, then input) order. */
export function applyDomainEvents(state: GameState, events: readonly DomainEvent[]): GameState {
  const ordered = [...events].sort(compareDomainEvents);
  let next = state;
  for (const event of ordered) {
    next = reduceDomainEvent(next, event);
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Snapshots and selectors                                                    */
/* -------------------------------------------------------------------------- */

/** Recursively read-only projection of a value. */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

/**
 * Produce a frozen deep copy of the state for rendering, UI and tests.
 * Structural typing makes the copy read-only; `Object.freeze` enforces it.
 */
export function createSnapshot(state: GameState): DeepReadonly<GameState> {
  return deepFreeze(structuredClone(state)) as DeepReadonly<GameState>;
}

/** Look up a plan task without tripping over `noUncheckedIndexedAccess`. */
export function getTask(state: GameState, taskId: string): PlanTaskState | undefined {
  return state.plan.tasks[taskId];
}

/** Look up a lane without tripping over `noUncheckedIndexedAccess`. */
export function getLane(state: GameState, laneId: string): LaneState | undefined {
  return state.lanes.lanes[laneId];
}

/** Look up a verification gate. */
export function getGate(state: GameState, gateId: string): VerificationGateState | undefined {
  return state.verification.gates[gateId];
}

/** Tasks in stable plan order. */
export function listTasks(state: GameState): PlanTaskState[] {
  return state.plan.order.flatMap((id) => {
    const task = state.plan.tasks[id];
    return task ? [task] : [];
  });
}

/** Lanes in stable registration order. */
export function listLanes(state: GameState): LaneState[] {
  return state.lanes.order.flatMap((id) => {
    const lane = state.lanes.lanes[id];
    return lane ? [lane] : [];
  });
}

/** Gates in stable registration order. */
export function listGates(state: GameState): VerificationGateState[] {
  return state.verification.order.flatMap((id) => {
    const gate = state.verification.gates[id];
    return gate ? [gate] : [];
  });
}

/** Quality metrics in stable registration order. */
export function listMetrics(state: GameState): QualityMetricState[] {
  return state.quality.order.flatMap((id) => {
    const metric = state.quality.metrics[id];
    return metric ? [metric] : [];
  });
}
