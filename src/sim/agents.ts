/**
 * Agent runtime — the workers that run inside a lane.
 *
 * A lane is a conduit; an agent is what actually moves work through it. This
 * module advances dispatched agent work in fixed simulation steps, burns context
 * tokens as it goes, and resolves each run to exactly one outcome:
 *
 *  - `success`  — the work is complete and handed to verification;
 *  - `failure`  — a defect roll broke the work; the run stops where it broke;
 *  - `rollback` — the change was judged unsound (or the finite context budget
 *                 ran out) and the agent undid it, leaving nothing behind.
 *
 * Every outcome is handed to a *policy*. The default policy is the lane
 * scheduler's `settle()` when one is wired in, so retries and terminal failures
 * are decided by the module that owns lane occupancy; a caller that wants a
 * different rule passes `decide`. When a failure is declared terminal, the
 * runtime materialises a fix-up task: a new plan task that depends on the failed
 * task, carries the repair objective, and claims write paths that are disjoint
 * from everything still in flight.
 *
 * Determinism: all randomness comes from the shared seeded RNG, the required
 * step count is derived from the task id and the seed rather than from draw
 * order, and agents are advanced in dispatch order. Replaying the same seed and
 * the same dispatch sequence therefore produces identical agent records.
 *
 * The runtime owns a simulated clock that starts at zero and advances by whole
 * fixed steps. Drive lane scheduling from `runtime.elapsedMs` so scheduler
 * events and agent events land on one timeline when they are reduced together.
 *
 * No DOM, timer or three.js usage: the runtime emits domain events through the
 * shared contract and reports plain snapshots.
 */

import { DEFAULT_STEP_MS, createRng, type Rng } from '../game/loop';
import { makeDomainEvent, type TaskStatus } from './state';
import {
  pathsConflict,
  type AgentOutcome,
  type ClaimedWriteSet,
  type DispatchEventSink,
  type DispatchScheduler,
  type SettlementDecision,
  type TaskSettlement,
} from './lanes';

export type { AgentOutcome } from './lanes';

/* -------------------------------------------------------------------------- */
/* Contracts                                                                  */
/* -------------------------------------------------------------------------- */

/** One unit of work the caller dispatched onto a lane. */
export interface AgentWorkItem {
  taskId: string;
  /** Lane the work runs on. Defaults to `lane-default`. */
  laneId?: string;
  title?: string;
  /** Fixed steps of work required; derived from the task id and seed when absent. */
  steps?: number;
  /** 1-based attempt number. The runtime counts attempts when it is absent. */
  attempt?: number;
  /** Paths the work writes, used to keep fix-up write sets disjoint. */
  writeSet?: readonly string[];
  /** Paths the work only reads. */
  readSet?: readonly string[];
}

/** One agent run, live while it works and frozen once it settles. */
export interface AgentRecord {
  /** Stable id: `agent-<task>-<attempt>`, unique within a runtime. */
  id: string;
  laneId: string;
  taskId: string;
  title: string;
  /** 1-based attempt number this run is. */
  attempt: number;
  /** Fixed steps of work this run must complete. */
  requiredSteps: number;
  /** Steps executed so far (kept across a rollback, for telemetry). */
  stepsDone: number;
  /** 0..1 completion ratio; resets to 0 when the run rolls back. */
  progress: number;
  status: 'working' | 'settled';
  outcome: AgentOutcome | null;
  /** Context tokens this run burned. */
  tokensSpent: number;
  startedAtMs: number;
  finishedAtMs: number | null;
  rollbacks: number;
  failures: number;
  writeSet: readonly string[];
  readSet: readonly string[];
  /** Sentences describing what happened, for the event log / inspector panel. */
  log: readonly string[];
}

/** What one agent run produced, with the policy verdict that followed it. */
export interface AgentSettlement {
  agentId: string;
  taskId: string;
  laneId: string;
  outcome: AgentOutcome;
  attempt: number;
  /** Simulated millisecond the run ended. */
  at: number;
  /** Completion ratio of the run when it ended. */
  progress: number;
  /** Context tokens the run burned in total. */
  contextTokens: number;
  reason: string;
  /** Fix-up task materialised for this outcome, if any. */
  fixUpTaskId: string | null;
  /** Retry-vs-fix-up verdict the policy returned. */
  decision: SettlementDecision;
}

/** A repair wave: the new task a terminal failure spawned. */
export interface FixUpTask {
  id: string;
  /** The mission task this repair wave belongs to. */
  rootTaskId: string;
  /** The task the fix-up depends on — the run that failed. */
  dependsOn: string;
  laneId: string;
  /** 1 for the first repair wave, 2 for a repair of a repair, and so on. */
  generation: number;
  /** Repair objective, also registered as the plan task's title. */
  objective: string;
  /** Write ownership, disjoint from everything in flight. */
  writeSet: readonly string[];
  requiredSteps: number;
  reason: string;
  at: number;
}

/** Per-lane agent load, shaped for the HUD. */
export interface AgentLaneLoad {
  laneId: string;
  activeAgents: number;
  tokensSpent: number;
  working: boolean;
  taskIds: readonly string[];
}

/** The per-frame readout of the agent floor. */
export interface AgentRuntimeReport {
  elapsedMs: number;
  contextBudget: number;
  contextSpent: number;
  contextRemaining: number;
  /** 0..1 share of the mission context budget already spent. */
  contextPressure: number;
  activeAgents: number;
  settledAgents: number;
  lanes: readonly AgentLaneLoad[];
}

export interface AgentRuntimeOptions {
  /** Seed for the runtime's own RNG stream. Defaults to `1`. */
  seed?: number | string;
  /** Fixed simulation step in milliseconds. Defaults to the loop's 60 Hz step. */
  stepMs?: number;
  /** Context tokens an agent burns per step. Defaults to 320. */
  tokensPerStep?: number;
  /** Per-step token jitter, drawn from the seeded RNG. Defaults to 60. */
  tokensJitter?: number;
  /** Finite context budget for the mission. Defaults to 200_000 tokens. */
  contextBudget?: number;
  /** Chance per step that the work breaks. Defaults to 0.05. */
  failureChance?: number;
  /** Chance per step that the work is judged unsound and rolled back. Defaults to 0.03. */
  rollbackChance?: number;
  /** Steps of work a task needs, when the task does not declare them. */
  minSteps?: number;
  maxSteps?: number;
  /** Repair waves allowed per root task. Defaults to 2. */
  maxFixUps?: number;
  /** Attempts allowed by the built-in policy when no scheduler is wired. Defaults to 1. */
  maxRetries?: number;
  /** Lane new fix-up tasks are registered on. Defaults to the failed task's lane. */
  repairLaneId?: string;
  /** Upper bound on steps `advance()` executes in one call. Defaults to 240. */
  maxStepsPerAdvance?: number;
  /** Event sink. Pass `channel.emit` to feed the runtime's reducers. */
  emit?: DispatchEventSink;
  /** Scheduler that decides retries and terminal failures. */
  scheduler?: DispatchScheduler;
  /** Custom dispatch policy; overrides `scheduler` when both are given. */
  decide?: (settlement: TaskSettlement) => SettlementDecision;
  /** Extra claimed write ownership used when planning a fix-up. */
  claimedWriteSets?: () => readonly ClaimedWriteSet[];
}

/** The agent runtime. Advances work, burns context and materialises fix-ups. */
export interface AgentRuntime {
  readonly stepMs: number;
  readonly seed: number;
  readonly contextBudget: number;
  readonly contextSpent: number;
  readonly elapsedMs: number;
  /** Agent records in dispatch order. */
  readonly agents: readonly AgentRecord[];
  /** Every settlement the runtime produced, in order. */
  readonly settlements: readonly AgentSettlement[];
  /** Fix-up tasks materialised so far, in creation order. */
  readonly fixUps: readonly FixUpTask[];
  /** Dispatch work onto a lane. Idempotent while the task is already running. */
  dispatch(work: AgentWorkItem): AgentRecord;
  /** Advance every working agent by exactly one fixed step. */
  step(): readonly AgentSettlement[];
  /** Advance by a delta, executing whole fixed steps only. */
  advance(deltaMs: number): readonly AgentSettlement[];
  /** Readout for the HUD and the lane view. Safe to call every frame. */
  report(): AgentRuntimeReport;
  reset(): void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Default context tokens an agent burns per fixed step. */
export const DEFAULT_TOKENS_PER_STEP = 320;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** FNV-1a hash, so a task id spreads its required steps deterministically. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Fixed steps of work a task needs, derived from its id and the run's seed.
 *
 * Deriving from a hash rather than from the RNG stream keeps the workload of a
 * task independent of how many rolls happened before it, so a replay that adds
 * an unrelated agent still gives every task the same number of steps.
 */
export function deriveRequiredSteps(
  taskId: string,
  seed: number | string,
  minSteps = 6,
  maxSteps = 12,
): number {
  const min = Math.max(1, Math.trunc(minSteps));
  const max = Math.max(min, Math.trunc(maxSteps));
  return min + (hashString(`${seed}:${taskId}`) % (max - min + 1));
}

/**
 * Internally mutable agent record. The runtime appends to the log and the
 * ownership sets while a run is alive; consumers only ever see the read-only
 * `AgentRecord` copies the runtime hands out.
 */
interface MutableAgentRecord extends Omit<AgentRecord, 'writeSet' | 'readSet' | 'log'> {
  writeSet: string[];
  readSet: string[];
  log: string[];
}

/** Mutable per-lane accumulator used while building a report. */
interface MutableLaneLoad {
  laneId: string;
  activeAgents: number;
  tokensSpent: number;
  taskIds: string[];
}

/* -------------------------------------------------------------------------- */
/* Runtime                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Create the agent runtime for a mission.
 *
 * Wire a scheduler to get mission-grade retries: `createAgentRuntime({ scheduler })`
 * forwards every outcome to `scheduler.settle()` and materialises a fix-up task
 * only once the scheduler declares the failure terminal.
 */
export function createAgentRuntime(options: AgentRuntimeOptions = {}): AgentRuntime {
  const emit: DispatchEventSink = options.emit ?? (() => undefined);
  const stepMs = options.stepMs !== undefined && options.stepMs > 0 ? options.stepMs : DEFAULT_STEP_MS;
  const rng: Rng = createRng(options.seed ?? 1);
  const seed = rng.seed;
  const tokensPerStep = Math.max(1, Math.trunc(options.tokensPerStep ?? DEFAULT_TOKENS_PER_STEP));
  const tokensJitter = Math.max(0, Math.trunc(options.tokensJitter ?? 60));
  const contextBudget = Math.max(1, Math.trunc(options.contextBudget ?? 200_000));
  const failureChance = clamp01(options.failureChance ?? 0.05);
  const rollbackChance = clamp01(options.rollbackChance ?? 0.03);
  const minSteps = Math.max(1, Math.trunc(options.minSteps ?? 6));
  const maxSteps = Math.max(minSteps, Math.trunc(options.maxSteps ?? 12));
  const maxFixUps = Math.max(0, Math.trunc(options.maxFixUps ?? 2));
  const maxRetries = Math.max(0, Math.trunc(options.maxRetries ?? 1));
  const maxStepsPerAdvance = Math.max(1, Math.trunc(options.maxStepsPerAdvance ?? 240));
  const repairLaneId = options.repairLaneId;
  const scheduler = options.scheduler;

  const agents: MutableAgentRecord[] = [];
  const history: AgentSettlement[] = [];
  const fixUps: FixUpTask[] = [];
  const localAttempts = new Map<string, number>();
  const fixUpRoots = new Map<string, string>();
  const fixUpDepth = new Map<string, number>();
  const usedFixUpIds = new Set<string>();
  const agentIds = new Set<string>();
  let elapsedMs = 0;
  let accumulator = 0;
  let contextSpent = 0;

  /* ---------------------------------------------------------------------- */
  /* Policy                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Built-in policy: no scheduler, no retry semantics beyond the runtime's own
   * bound. It mirrors the two things a caller must be able to rely on without
   * wiring anything: a rollback means the task goes back to the ready pool, and
   * a failure that runs out of attempts needs a fix-up.
   */
  function defaultDecision(settlement: TaskSettlement): SettlementDecision {
    const attempt = Math.max(1, Math.trunc(settlement.attempt ?? 1));
    const laneId = settlement.laneId ?? null;
    const base = { taskId: settlement.taskId, outcome: settlement.outcome, attempt, laneId };
    if (settlement.outcome === 'success') {
      return {
        ...base,
        requeued: false,
        terminal: true,
        needsFixUp: false,
        reason: `"${settlement.taskId}" shipped on attempt ${attempt}.`,
      };
    }
    if (attempt <= maxRetries) {
      return {
        ...base,
        requeued: true,
        terminal: false,
        needsFixUp: false,
        reason: `Attempt ${attempt} of ${maxRetries + 1} ended in ${
          settlement.outcome === 'rollback' ? 'a rollback' : 'failure'
        }; the task is offered for another run.`,
      };
    }
    return {
      ...base,
      requeued: false,
      terminal: true,
      needsFixUp: true,
      reason: `Attempt ${attempt} of ${maxRetries + 1} ended in ${
        settlement.outcome === 'rollback' ? 'a rollback' : 'failure'
      }; a fix-up task is required.`,
    };
  }

  const policy: (settlement: TaskSettlement) => SettlementDecision =
    options.decide ?? (scheduler ? (settlement) => scheduler.settle(settlement) : defaultDecision);

  /* ---------------------------------------------------------------------- */
  /* Fix-ups                                                                */
  /* ---------------------------------------------------------------------- */

  /** Write ownership held by work that is still running or waiting. */
  function claimedWriteSets(excludeTaskId?: string): ClaimedWriteSet[] {
    const holders = new Map<string, ClaimedWriteSet>();
    const push = (taskId: string, laneId: string, writeSet: readonly string[]): void => {
      if (taskId === excludeTaskId || holders.has(taskId)) return;
      holders.set(taskId, { taskId, laneId, writeSet: [...writeSet] });
    };
    for (const agent of agents) {
      if (agent.status !== 'working') continue;
      push(agent.taskId, agent.laneId, agent.writeSet);
    }
    if (scheduler) {
      for (const holder of scheduler.claimedWriteSets(excludeTaskId)) {
        push(holder.taskId, holder.laneId, holder.writeSet);
      }
    }
    for (const holder of options.claimedWriteSets?.() ?? []) {
      push(holder.taskId, holder.laneId, holder.writeSet);
    }
    return [...holders.values()];
  }

  /** Repair ownership: the failed task's paths, minus everything still claimed. */
  function repairWriteSet(agent: MutableAgentRecord, rootTaskId: string): string[] {
    const claimed = claimedWriteSets(agent.taskId);
    const free: string[] = [];
    for (const path of agent.writeSet) {
      const collides = claimed.some((holder) =>
        holder.writeSet.some((claimedPath) => pathsConflict(path, claimedPath)),
      );
      if (!collides && !free.includes(path)) free.push(path);
    }
    // Nothing of the original ownership is free: claim a private repair corner
    // instead of writing over work another lane still holds.
    return free.length > 0 ? free : [`fixups/${rootTaskId}`];
  }

  function fixUpId(rootTaskId: string, generation: number): string {
    return generation <= 1 ? `fixup-${rootTaskId}` : `fixup-${rootTaskId}-${generation}`;
  }

  /** Register the repair wave a terminal failure called for. */
  function materializeFixUp(
    agent: MutableAgentRecord,
    outcome: AgentOutcome,
    reason: string,
  ): FixUpTask | null {
    const rootTaskId = fixUpRoots.get(agent.taskId) ?? agent.taskId;
    let generation = (fixUpDepth.get(rootTaskId) ?? 0) + 1;
    let id = fixUpId(rootTaskId, generation);
    while (usedFixUpIds.has(id)) {
      generation += 1;
      id = fixUpId(rootTaskId, generation);
    }
    if (generation > maxFixUps) {
      agent.log.push(`Repair waves exhausted for "${rootTaskId}"; no further fix-up was registered.`);
      return null;
    }

    const objective = `Repair "${agent.title}" after it ${
      outcome === 'rollback' ? 'rolled back' : 'failed'
    }: ${reason}.`;
    const fixUp: FixUpTask = {
      id,
      rootTaskId,
      dependsOn: agent.taskId,
      laneId: repairLaneId ?? agent.laneId,
      generation,
      objective,
      writeSet: repairWriteSet(agent, rootTaskId),
      requiredSteps: deriveRequiredSteps(id, seed, minSteps, maxSteps),
      reason,
      at: elapsedMs,
    };
    usedFixUpIds.add(id);
    fixUpRoots.set(id, rootTaskId);
    fixUpDepth.set(rootTaskId, generation);
    fixUps.push(fixUp);
    emit(
      makeDomainEvent(
        'plan/task-registered',
        {
          task: {
            id,
            title: objective,
            laneId: fixUp.laneId,
            dependencies: [agent.taskId],
            status: 'pending',
            progress: 0,
          },
        },
        elapsedMs,
      ),
    );
    agent.log.push(`Fix-up "${id}" registered for "${agent.taskId}".`);
    return fixUp;
  }

  /* ---------------------------------------------------------------------- */
  /* Stepping                                                               */
  /* ---------------------------------------------------------------------- */

  function tokensForStep(): number {
    if (tokensJitter === 0) return tokensPerStep;
    return Math.max(1, tokensPerStep + rng.int(-tokensJitter, tokensJitter));
  }

  /** Close a run out: record the outcome, ask the policy, project the plan. */
  function finalize(agent: MutableAgentRecord, outcome: AgentOutcome, reason: string): AgentSettlement {
    agent.status = 'settled';
    agent.outcome = outcome;
    agent.finishedAtMs = elapsedMs;
    agent.progress = outcome === 'success' ? 1 : outcome === 'rollback' ? 0 : agent.progress;
    agent.log.push(`Step ${agent.stepsDone}: ${reason}.`);

    const taskSettlement: TaskSettlement = {
      taskId: agent.taskId,
      outcome,
      at: elapsedMs,
      laneId: agent.laneId,
      attempt: agent.attempt,
      message: reason,
    };
    const verdict = policy(taskSettlement);
    agent.log.push(verdict.reason);

    const fixUp = outcome !== 'success' && verdict.needsFixUp ? materializeFixUp(agent, outcome, reason) : null;

    // The runtime owns the plan projection: a task's recorded status is the run
    // outcome and the dispatch verdict taken together.
    const status: TaskStatus = outcome === 'success' ? 'passed' : verdict.requeued ? 'pending' : 'failed';
    emit(
      makeDomainEvent(
        'plan/task-updated',
        { taskId: agent.taskId, status, progress: round(agent.progress, 4), laneId: agent.laneId },
        elapsedMs,
      ),
    );

    if (outcome !== 'success') {
      emit(
        makeDomainEvent(
          'quality/finding',
          {
            finding: {
              id: `finding-${agent.id}`,
              severity: outcome === 'rollback' ? 'low' : verdict.terminal ? 'high' : 'medium',
              summary: `${agent.title}: ${reason}.`,
              taskId: agent.taskId,
              atMs: elapsedMs,
            },
          },
          elapsedMs,
        ),
      );
    }

    const settlement: AgentSettlement = {
      agentId: agent.id,
      taskId: agent.taskId,
      laneId: agent.laneId,
      outcome,
      attempt: agent.attempt,
      at: elapsedMs,
      progress: agent.progress,
      contextTokens: agent.tokensSpent,
      reason,
      fixUpTaskId: fixUp === null ? null : fixUp.id,
      decision: verdict,
    };
    history.push(settlement);
    return cloneSettlement(settlement);
  }

  function step(): readonly AgentSettlement[] {
    elapsedMs += stepMs;
    const produced: AgentSettlement[] = [];
    for (const agent of agents) {
      if (agent.status !== 'working') continue;

      const tokens = tokensForStep();
      // One roll and one token draw per agent-step, always in this order, so the
      // stream is a pure function of the seed and the dispatch sequence.
      const roll = rng.next();
      agent.stepsDone += 1;
      agent.tokensSpent += tokens;
      contextSpent += tokens;
      emit(makeDomainEvent('economy/spend', { credits: 0, contextTokens: tokens }, elapsedMs));

      if (contextSpent >= contextBudget) {
        agent.rollbacks += 1;
        agent.progress = 0;
        produced.push(
          finalize(
            agent,
            'rollback',
            `context budget spent (${contextSpent}/${contextBudget} tokens), so the agent rolled its work back`,
          ),
        );
        continue;
      }

      if (roll < failureChance) {
        agent.failures += 1;
        produced.push(finalize(agent, 'failure', 'a defect roll broke the work the agent was writing'));
        continue;
      }

      const progressBefore = agent.progress;
      agent.progress = clamp01(agent.requiredSteps === 0 ? 1 : agent.stepsDone / agent.requiredSteps);
      if (agent.progress >= 1) {
        produced.push(finalize(agent, 'success', 'the work is complete and handed to verification'));
        continue;
      }

      // Nothing to roll back while the agent has not written anything yet.
      if (progressBefore > 0 && roll >= 1 - rollbackChance) {
        agent.rollbacks += 1;
        agent.progress = 0;
        produced.push(finalize(agent, 'rollback', 'the change was judged unsound and rolled back'));
      }
    }
    return produced;
  }

  function advance(deltaMs: number): readonly AgentSettlement[] {
    accumulator += deltaMs > 0 ? deltaMs : 0;
    const produced: AgentSettlement[] = [];
    let executed = 0;
    while (accumulator >= stepMs && executed < maxStepsPerAdvance) {
      accumulator -= stepMs;
      executed += 1;
      for (const settlement of step()) produced.push(settlement);
    }
    // Steps that could not be simulated are dropped rather than carried forever.
    if (accumulator >= stepMs) accumulator %= stepMs;
    return produced;
  }

  /* ---------------------------------------------------------------------- */
  /* Dispatch and reporting                                                 */
  /* ---------------------------------------------------------------------- */

  function uniqueAgentId(taskId: string, attempt: number): string {
    const base = `agent-${taskId}-${attempt}`;
    let id = base;
    let suffix = 1;
    while (agentIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    agentIds.add(id);
    return id;
  }

  function dispatch(work: AgentWorkItem): AgentRecord {
    const taskId = typeof work?.taskId === 'string' ? work.taskId.trim() : '';
    if (taskId.length === 0) {
      throw new Error('[coroid] agent runtime dispatch requires a task id');
    }
    const running = agents.find((agent) => agent.taskId === taskId && agent.status === 'working');
    if (running) return cloneAgent(running);

    const attempt = Math.max(1, Math.trunc(work.attempt ?? (localAttempts.get(taskId) ?? 0) + 1));
    localAttempts.set(taskId, Math.max(localAttempts.get(taskId) ?? 0, attempt));
    const requiredSteps =
      work.steps !== undefined && work.steps > 0
        ? Math.max(1, Math.trunc(work.steps))
        : deriveRequiredSteps(taskId, seed, minSteps, maxSteps);

    const agent: MutableAgentRecord = {
      id: uniqueAgentId(taskId, attempt),
      laneId: work.laneId ?? 'lane-default',
      taskId,
      title: work.title ?? taskId,
      attempt,
      requiredSteps,
      stepsDone: 0,
      progress: 0,
      status: 'working',
      outcome: null,
      tokensSpent: 0,
      startedAtMs: elapsedMs,
      finishedAtMs: null,
      rollbacks: 0,
      failures: 0,
      writeSet: [...(work.writeSet ?? [])],
      readSet: [...(work.readSet ?? [])],
      log: [`Dispatched to ${work.laneId ?? 'lane-default'} with ${requiredSteps} steps of work.`],
    };
    agents.push(agent);
    return cloneAgent(agent);
  }

  function report(): AgentRuntimeReport {
    const loads: MutableLaneLoad[] = [];
    const byLane = new Map<string, MutableLaneLoad>();
    let activeAgents = 0;
    let settledAgents = 0;

    for (const agent of agents) {
      if (agent.status === 'working') activeAgents += 1;
      else settledAgents += 1;
      let load = byLane.get(agent.laneId);
      if (!load) {
        load = { laneId: agent.laneId, activeAgents: 0, tokensSpent: 0, taskIds: [] };
        byLane.set(agent.laneId, load);
        loads.push(load);
      }
      if (agent.status === 'working') {
        load.activeAgents += 1;
        load.taskIds.push(agent.taskId);
      }
      load.tokensSpent += agent.tokensSpent;
    }

    return {
      elapsedMs,
      contextBudget,
      contextSpent,
      contextRemaining: Math.max(0, contextBudget - contextSpent),
      contextPressure: round(clamp01(contextSpent / contextBudget), 4),
      activeAgents,
      settledAgents,
      lanes: loads.map((load) => ({
        laneId: load.laneId,
        activeAgents: load.activeAgents,
        tokensSpent: load.tokensSpent,
        working: load.activeAgents > 0,
        taskIds: [...load.taskIds],
      })),
    };
  }

  function reset(): void {
    agents.length = 0;
    history.length = 0;
    fixUps.length = 0;
    localAttempts.clear();
    fixUpRoots.clear();
    fixUpDepth.clear();
    usedFixUpIds.clear();
    agentIds.clear();
    elapsedMs = 0;
    accumulator = 0;
    contextSpent = 0;
    rng.reset();
  }

  return {
    stepMs,
    seed,
    contextBudget,
    get contextSpent() {
      return contextSpent;
    },
    get elapsedMs() {
      return elapsedMs;
    },
    get agents() {
      return agents.map(cloneAgent);
    },
    get settlements() {
      return history.map(cloneSettlement);
    },
    get fixUps() {
      return fixUps.map(cloneFixUp);
    },
    dispatch,
    step,
    advance,
    report,
    reset,
  };
}

/* -------------------------------------------------------------------------- */
/* Snapshot helpers                                                           */
/* -------------------------------------------------------------------------- */

function cloneAgent(agent: MutableAgentRecord): AgentRecord {
  return {
    ...agent,
    writeSet: [...agent.writeSet],
    readSet: [...agent.readSet],
    log: [...agent.log],
  };
}

function cloneSettlement(settlement: AgentSettlement): AgentSettlement {
  return { ...settlement, decision: { ...settlement.decision } };
}

function cloneFixUp(fixUp: FixUpTask): FixUpTask {
  return { ...fixUp, writeSet: [...fixUp.writeSet] };
}
