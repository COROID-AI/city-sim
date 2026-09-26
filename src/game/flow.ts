/**
 * Coroid mission flow: the state machine that drives one mission from brief to release.
 *
 * The phase-2 simulation modules each answer one question — what should be built
 * (`planner`), what may run now (`graph`), where it runs (`lanes`), what the
 * agent did (`agents`), what was proven (`verification`), how good it is
 * (`quality`) and what it cost (`economy`) — but none of them knows what a
 * *mission* is. This module is the single composer: it owns the mission clock,
 * the phase machine, the campaign progress, the tutorials and the win/loss
 * verdict, and it is the only place where the simulation modules meet.
 *
 * ## Lifecycle
 *
 * ```
 *  brief ──▶ plan ──▶ approve ──▶ dispatch ──▶ verify ──▶ release  (won)
 *                        ▲             ▲          │
 *                        │             └── repair ◀┘
 *                        └───────────────────────┘
 * ```
 *
 *  - `brief`    — the intake desk: lanes stand up, the deadline opens, the
 *                 tutorial waits for the player to acknowledge the request.
 *  - `plan`     — the request is decomposed, layered into phases and registered
 *                 as tasks, checks and criteria in one deterministic pass.
 *  - `approve`  — the human gate: nothing is dispatched until `approve()`.
 *  - `dispatch` — ready tasks are placed on lanes and run by the agent runtime.
 *  - `verify`   — the verification gate folds run outcomes into check outcomes,
 *                 opens repair objectives for failures and republishes the
 *                 plan, and the quality graph measures the criteria.
 *  - `repair`   — every open repair objective without a fix-up task gets one.
 *  - `release`  — the delivery manifest ships with every final invariant green.
 *
 * Transitions are checked against {@link PHASE_TRANSITIONS}, so an illegal move
 * is a programming error rather than a silent state. Every transition records a
 * {@link FlowTransition} — the from/to pair, the domain events it emitted, a
 * human sentence and a provenance tag — which is what the event terminal shows
 * when it explains *why* something happened.
 *
 * ## Determinism
 *
 * The flow owns exactly one clock, and it is the agent runtime's clock: one
 * fixed step advances the runtime (and therefore every working agent) by
 * `stepMs`, which is also the simulated millisecond stamped on every event the
 * flow emits. There is no wall clock, no `Math.random` and no DOM anywhere in
 * this module, and every module it composes is seeded from the mission's own
 * pacing seed, so replaying the same input sequence always produces the same
 * state, the same event journal and the same verdict.
 *
 * Speed multiplies the fixed-step budget per frame (1x, 2x, 4x) and pause stops
 * advancement entirely, so `advance(frame)` at 2x is exactly two `advance(frame)`
 * at 1x — verified by the flow tests.
 *
 * ## Win and loss
 *
 * Win and loss come from the mission catalogue: {@link evaluateMissionOutcome}
 * is the single source of the thresholds (context exhaustion, write-conflict
 * storm, unrepaired final invariants at the deadline, and the win conditions),
 * and this module feeds it measured metrics read from the state slices and the
 * module reports. A win additionally requires the verification ledger's release
 * readiness (final invariants only) and the quality graph's readiness to be met,
 * so the manifest can only ship with every final invariant green.
 *
 * ## Presentation
 *
 * The flow imports no renderer, UI or audio module. It exposes frozen
 * {@link MissionFlowSnapshot} snapshots, provenance-tagged log lines and intents
 * (`start`, `approve`, `acknowledge`, `setSpeed`, `pause`, `advance`), and the
 * integration layer wires those to whatever draws the factory.
 */

import { createDomainEventChannel, type DomainEventChannel } from './events';
import { DEFAULT_STEP_MS } from './loop';
import {
  evaluateMissionOutcome,
  getMission,
  isMissionUnlocked,
  listMissions,
  missionInitialStateOptions,
  nextMission,
  type DomainEventType,
  type LossKind,
  type MissionDefinition,
  type MissionMetric,
  type MissionReadings,
  type MissionVerdict,
  type ProvenanceKind,
  type TutorialStep,
  type TutorialTarget,
} from '../content/missions';
import { createAgentRuntime, type AgentRuntime, type AgentRuntimeReport, type AgentSettlement, type FixUpTask } from '../sim/agents';
import {
  applyEconomyTick,
  createEconomyActivity,
  readEconomyClock,
  readEconomyContext,
  type EconomyActivity,
  type EconomyActivityKind,
  type EconomyClockReading,
  type EconomyContextReading,
} from '../sim/economy';
import { buildDependencyGraph, queryConflicts, type DependencyGraph, type TaskOwnershipMap } from '../sim/graph';
import {
  createDispatchScheduler,
  type DispatchConflictFlag,
  type DispatchScheduler,
  type DispatchTaskInput,
  type LaneOccupancy,
} from '../sim/lanes';
import { generatePlan, laneIdFor, MAX_DIFFICULTY_LEVEL, MIN_DIFFICULTY_LEVEL, type PlanOutline, type PlanTaskOutline } from '../sim/planner';
import {
  createCriterionRegistry,
  registerCriteria as registerQualityCriteria,
  updateQualityGraph,
  type CriterionDeclaration as QualityCriterionDeclaration,
  type CriterionRegistry,
  type QualityGraph,
} from '../sim/quality';
import {
  applyDomainEvents,
  createInitialState,
  createSnapshot,
  makeDomainEvent,
  type DeepReadonly,
  type DomainEvent,
  type GameState,
  type LaneKind,
  type TaskStatus,
} from '../sim/state';
import {
  createVerificationLedger,
  evaluateReleaseReadiness,
  listBlockedTaskIds,
  listDispatchableTaskIds,
  registerChecks,
  registerCriteria as registerLedgerCriteria,
  runVerificationGate,
  supersedeCriterion,
  type CheckDeclaration,
  type CheckOutcome,
  type CriterionDeclaration as LedgerCriterionDeclaration,
  type ReleaseReadiness,
  type RepairObjective,
  type VerificationLedger,
  type VerificationReport,
} from '../sim/verification';

/* -------------------------------------------------------------------------- */
/* Lifecycle vocabulary                                                       */
/* -------------------------------------------------------------------------- */

/** The seven phases a mission moves through, in lifecycle order. */
export type MissionPhase = 'brief' | 'plan' | 'approve' | 'dispatch' | 'verify' | 'repair' | 'release';

/** Every phase, in lifecycle order. */export const MISSION_PHASES: readonly MissionPhase[] = Object.freeze([
  'brief',
  'plan',
  'approve',
  'dispatch',
  'verify',
  'repair',
  'release',
] as const);

/**
 * The legal transition table. A phase may only move to one of its listed
 * successors (or stay put), which is what keeps the lifecycle honest: the
 * release phase cannot be reached from `dispatch` without verifying first, and
 * `brief` cannot be re-entered once the mission is running.
 */
export const PHASE_TRANSITIONS: Readonly<Record<MissionPhase, readonly MissionPhase[]>> = Object.freeze({
  brief: Object.freeze(['plan'] as const),
  plan: Object.freeze(['approve'] as const),
  approve: Object.freeze(['dispatch'] as const),
  dispatch: Object.freeze(['verify', 'repair'] as const),
  verify: Object.freeze(['dispatch', 'repair', 'release'] as const),
  repair: Object.freeze(['dispatch'] as const),
  release: Object.freeze([] as const),
});

/** How a mission ends. `running` is the only non-terminal outcome. */
export type MissionOutcome = 'running' | 'won' | 'lost';

/** Where a provenance tag came from; the strings match the codex vocabulary. */
export type FlowProvenance = ProvenanceKind;

/** Canonical provenance order, used by the tests and the event terminal legend. */
export const FLOW_PROVENANCE_KINDS: readonly FlowProvenance[] = Object.freeze([
  'user_requirement',
  'repository_observation',
  'architect_choice',
] as const);

/* -------------------------------------------------------------------------- */
/* Pacing vocabulary                                                          */
/* -------------------------------------------------------------------------- */

/** The fixed-step multipliers the player may select. */
export type FlowSpeed = 1 | 2 | 4;

/** Every selectable speed, slowest first. */
export const FLOW_SPEEDS: readonly FlowSpeed[] = Object.freeze([1, 2, 4] as const);

/** Speed a mission starts at. */
export const DEFAULT_SPEED: FlowSpeed = 1;

/** Fixed simulation step, in simulated milliseconds. */
export const FLOW_STEP_MS = DEFAULT_STEP_MS;

/** How often the mission clock is carried into state while nothing else happens. */
export const CLOCK_CARRY_MS = 1_000;

/** How often the flow re-runs the heavy orchestration pass, in simulated ms. */
export const REVIEW_INTERVAL_MS = 250;

/**
 * Retries a task gets before it settles as failed.
 *
 * A single retry is enough for ordinary work, but a repair wave that fails
 * terminally leaves a final invariant unrepaired — the one thing that can stop a
 * release — so the flow gives every task, repairs included, three attempts at the
 * work before the gate stays red.
 */
export const FLOW_MAX_RETRIES = 2;

/** Balance knobs the flow applies on top of the mission catalogue. */
export interface FlowTuning {
  /** Credits dispatch costs, as a share of the task's own plan estimate. */
  dispatchCreditShare: number;
  /** Credits verification costs, as a share of the task's own plan estimate. */
  verificationCreditShare: number;
  /** Credits a repair costs, as a share of the repaired task's plan estimate. */
  repairCreditShare: number;
  /**
   * Extra repair waves the flow may open for one root task, on top of the
   * mission's own `repairsAllowed`.
   *
   * The runtime's repair budget counts *generations* — repairs of repairs — and a
   * flaky run must not doom a mission whose final invariants are still
   * repairable. The reserve lets the flow open a fresh wave for the same
   * objective a bounded number of times before the gate stays red, and the
   * mission's own clock and context budget are what finally stop it.
   */
  repairWaveReserve: number;
  /** Credits a shipped task earns, as a share of the planner's own estimate. */
  rewardShare: number;
  /** Reputation a shipped task earns. */
  rewardReputation: number;
  /** Review cadence in simulated milliseconds. */
  reviewIntervalMs: number;
}

/**
 * The shipped balance.
 *
 * Credits are priced as shares of the plan's own per-task estimate rather than as
 * absolute amounts, so a mission stays solvent at every difficulty: shipping a
 * task earns its estimate, proving and dispatching it cost half of it, and a
 * repair wave is priced like the work it replaces. Reputation is left to the
 * economy module's shipped table, where verification earns trust and repairs
 * spend it.
 */
export const DEFAULT_FLOW_TUNING: FlowTuning = Object.freeze({
  dispatchCreditShare: 0.35,
  verificationCreditShare: 0.15,
  repairCreditShare: 0.5,
  repairWaveReserve: 2,
  rewardShare: 1,
  rewardReputation: 2,
  reviewIntervalMs: REVIEW_INTERVAL_MS,
});

/* -------------------------------------------------------------------------- */
/* Flow records                                                               */
/* -------------------------------------------------------------------------- */

/** Flow-only log sources, on top of the shared domain event tags. */
export type FlowLogTag =
  | 'flow/phase'
  | 'flow/tutorial'
  | 'flow/verdict'
  | 'flow/hazard'
  | 'flow/repair'
  | 'flow/manifest';

/** What a log line is about: a domain event tag or a flow-only tag. */
export type FlowLogSource = DomainEventType | FlowLogTag;

/**
 * One provenance-tagged line for the event terminal.
 *
 * The shape is field-for-field the mission catalogue's `MissionEventLine`, so
 * the HUD can render authored flavour and live flow lines the same way.
 */
export interface FlowLogEntry {
  readonly id: string;
  readonly atMs: number;
  readonly source: FlowLogSource;
  readonly provenance: FlowProvenance;
  readonly text: string;
}

/** One legal lifecycle move, with the events it emitted and why it happened. */
export interface FlowTransition {
  readonly id: string;
  readonly atMs: number;
  readonly from: MissionPhase;
  readonly to: MissionPhase;
  /** Domain events emitted as part of this transition, in emission order. */
  readonly events: readonly DomainEvent[];
  readonly provenance: FlowProvenance;
  /** One sentence explaining the move, safe to print in the event terminal. */
  readonly text: string;
}

/** One entry of the delivery manifest: a shipped task and the evidence behind it. */
export interface ManifestEntry {
  readonly id: string;
  readonly taskId: string;
  readonly title: string;
  readonly laneId: string;
  /** Green checks that stand behind the entry. */
  readonly evidenceCheckIds: readonly string[];
  /** Criteria the task's checks evidence. */
  readonly criterionKeys: readonly string[];
  readonly provenance: FlowProvenance;
  readonly atMs: number;
}

/** The release artefact: what the mission hands over, and how well covered it is. */
export interface ReleaseManifest {
  readonly id: string;
  readonly missionId: string;
  readonly codename: string;
  readonly assembledAtMs: number;
  readonly shipped: boolean;
  readonly shippedAtMs: number | null;
  readonly entries: readonly ManifestEntry[];
  /** Share of entries carrying a green check. */
  readonly coverageRatio: number;
  /** Share of entries carrying a provenance tag. */
  readonly provenanceRatio: number;
}

/** One ordered tutorial step, as the HUD consumes it. */
export interface TutorialProgress {
  readonly stepId: string;
  readonly index: number;
  readonly total: number;
  readonly title: string;
  readonly instruction: string;
  readonly lesson: string;
  /** Highlight targets the HUD rings: `[data-hud="..."]` or a scene root name. */
  readonly targets: readonly TutorialTarget[];
  readonly advanceWhen: TutorialStep['advanceWhen'];
  readonly completedStepIds: readonly string[];
  /** True when every step of the mission's tutorial has been completed. */
  readonly complete: boolean;
}

/** Campaign position and which missions the player may start. */
export interface CampaignProgress {
  readonly currentKey: string;
  readonly order: number;
  readonly missionCount: number;
  /** 0..1 campaign difficulty of the current mission. */
  readonly difficulty: number;
  /** Missions won so far, in campaign order. */
  readonly deliveredKeys: readonly string[];
  readonly unlockedKeys: readonly string[];
  readonly lockedKeys: readonly string[];
  /** The mission after this one, or `null` when the campaign is finished. */
  readonly nextKey: string | null;
  /** True when the current mission's own unlock condition is satisfied. */
  readonly unlocked: boolean;
}

/** One scripted obstacle the flow was handed (mission script, player or test). */
export interface FlowHazard {
  readonly id: string;
  readonly kind: 'failing-check' | 'context-drain';
  readonly atMs: number;
  readonly detail: string;
  readonly provenance: FlowProvenance;
}

/** A task the flow added on top of the generated plan. */
export interface FlowTaskRequest {
  readonly id: string;
  readonly title: string;
  readonly laneId?: string;
  readonly dependsOn?: readonly string[];
  readonly writeSet?: readonly string[];
  readonly readSet?: readonly string[];
  /** Checks to declare for the task; they pass when the task's run succeeds. */
  readonly checks?: readonly FlowCheckRequest[];
}

/** A check declaration the flow can attach to a task it adds. */
export interface FlowCheckRequest {
  readonly id: string;
  readonly kind: CheckDeclaration['kind'];
  readonly assertion: string;
  readonly targetFile?: string;
  readonly evidence?: CheckDeclaration['evidence'];
  readonly criterionKey?: string | null;
  readonly timeoutMs?: number;
}

/** What one `advance()` call actually simulated. */
export interface FlowFrameReport {
  /** Frame time the caller offered, in real milliseconds. */
  readonly frameMs: number;
  /** Simulated milliseconds consumed (0 while paused or off the running phases). */
  readonly simulatedMs: number;
  /** Fixed steps executed this frame. */
  readonly steps: number;
  readonly phase: MissionPhase;
  readonly outcome: MissionOutcome;
  readonly lossKind: LossKind | null;
}

/** One plan task as the HUD's outline and inspector show it. */
export interface FlowTaskRow {
  readonly id: string;
  readonly title: string;
  readonly laneId: string;
  readonly status: TaskStatus;
  readonly progress: number;
  readonly dependencies: readonly string[];
  readonly writeSet: readonly string[];
  readonly readSet: readonly string[];
  readonly checkIds: readonly string[];
  readonly criterionKeys: readonly string[];
  readonly origin: 'plan' | 'player' | 'repair';
  readonly phase: number | null;
  readonly provenance: FlowProvenance;
}

/** Everything the presentation layer needs about the verification gate. */
export interface FlowVerificationReading {
  readonly passRate: number;
  readonly gates: number;
  readonly gatesPassed: number;
  readonly gatesFailed: number;
  readonly checksDeclared: number;
  readonly checksGreen: number;
  readonly failuresRepaired: number;
  readonly openRepairObjectiveIds: readonly string[];
  readonly blockedTaskIds: readonly string[];
  readonly dispatchableTaskIds: readonly string[];
  readonly readiness: ReleaseReadiness;
  readonly summary: string;
}

/** Everything the presentation layer needs about the quality graph. */
export interface FlowQualityReading {
  readonly score: number;
  readonly readiness: number;
  readonly releaseThreshold: number;
  readonly ready: boolean;
  readonly measuredMetrics: number;
  readonly invariantsHeld: number;
  readonly invariantsAtRisk: number;
  readonly criteriaSuperseded: number;
  readonly blockers: readonly string[];
}

/** The frozen per-frame view of the whole mission. */
export interface MissionFlowSnapshot {
  readonly missionId: string;
  readonly codename: string;
  readonly objective: string;
  readonly phase: MissionPhase;
  readonly outcome: MissionOutcome;
  readonly lossKind: LossKind | null;
  readonly endReason: string | null;
  readonly simMs: number;
  readonly deadlineMs: number;
  readonly speed: FlowSpeed;
  readonly paused: boolean;
  readonly state: DeepReadonly<GameState>;
  readonly plan: readonly FlowTaskRow[];
  readonly lanes: readonly LaneOccupancy[];
  readonly agents: AgentRuntimeReport;
  readonly verification: FlowVerificationReading;
  readonly quality: FlowQualityReading;
  readonly economy: {
    readonly credits: number;
    readonly reputation: number;
    readonly context: EconomyContextReading;
    readonly clock: EconomyClockReading;
  };
  readonly readings: MissionReadings;
  readonly verdict: MissionVerdict;
  readonly tutorial: TutorialProgress;
  readonly campaign: CampaignProgress;
  readonly manifest: ReleaseManifest;
  readonly graph: {
    readonly status: DependencyGraph['status'];
    readonly taskCount: number;
    readonly phaseCount: number;
    readonly conflicts: number;
  };
  /** Trace of the most recent orchestration pass, for debugging and tests. */
  readonly log: readonly FlowLogEntry[];
}

/** Everything a caller may configure. Every field has a mission-derived default. */
export interface MissionFlowOptions {
  /** Mission key or definition. Unknown keys throw. */
  readonly mission: MissionDefinition | string;
  /** Missions already delivered before this one, for unlock gating. */
  readonly deliveredMissionKeys?: readonly string[];
  /** Fixed step in simulated milliseconds. Defaults to {@link FLOW_STEP_MS}. */
  readonly stepMs?: number;
  /** Starting speed. Defaults to {@link DEFAULT_SPEED}. */
  readonly speed?: FlowSpeed;
  /** Start paused. Defaults to `false`. */
  readonly paused?: boolean;
  /** Plan difficulty override (1..4); defaults to the level that covers the mission's plan size. */
  readonly difficulty?: number;
  /** Agent failure/rollback tuning, for a fully scripted run. */
  readonly agent?: {
    readonly failureChance?: number;
    readonly rollbackChance?: number;
    readonly maxRetries?: number;
    readonly maxFixUps?: number;
  };
  /** Flow balance overrides. */
  readonly tuning?: Partial<FlowTuning>;
  /** Run `start()` immediately (skips the brief acknowledgement). */
  readonly autoStart?: boolean;
  /** Run `approve()` immediately after planning (skips the human gate). */
  readonly autoApprove?: boolean;
  /** Share the presentation layer's event channel instead of creating one. */
  readonly channel?: DomainEventChannel;
}

/** The mission flow. Pure bookkeeping around the simulation modules. */
export interface MissionFlow {
  readonly mission: MissionDefinition;
  /** Live state. Treat as read-only: the flow owns it and moves it via events. */
  readonly state: GameState;
  readonly phase: MissionPhase;
  readonly outcome: MissionOutcome;
  readonly lossKind: LossKind | null;
  /** Simulated milliseconds on the mission clock. */
  readonly simMs: number;
  /** Planner difficulty the mission's outline was generated at. */
  readonly difficulty: number;
  readonly speed: FlowSpeed;
  readonly paused: boolean;
  /** Channel the flow emits every domain event into. */
  readonly channel: DomainEventChannel;

  /* Intents */
  /** Acknowledge the brief and decompose the request. `brief -> plan -> approve`. */
  start(): FlowTransition | null;
  /** Satisfy the current tutorial step when it waits for an acknowledgement. */
  acknowledge(): boolean;
  /** Approve the plan and open the floor. `approve -> dispatch`. */
  approve(): FlowTransition | null;
  /** Advance the mission clock by a frame, scaled by the current speed. */
  advance(frameMs: number): FlowFrameReport;
  setSpeed(speed: FlowSpeed): FlowSpeed;
  pause(): boolean;
  resume(): boolean;
  togglePause(): boolean;

  /* Scripted obstacles */
  /** Force the next outcome of a task's (or check's) next verification to fail. */
  forceCheckFailure(target: string, options?: { detail?: string; times?: number }): FlowHazard;
  /** Burn context tokens directly, e.g. an expensive detour the mission took. */
  drainContext(tokens: number, detail?: string): FlowHazard;
  /** Register extra work: a player action or a mission script. */
  addTask(request: FlowTaskRequest): FlowTaskRow;

  /* Readings */
  snapshot(): MissionFlowSnapshot;
  taskRows(): readonly FlowTaskRow[];
  tutorial(): TutorialProgress;
  campaign(): CampaignProgress;
  manifest(): ReleaseManifest;
  readings(): MissionReadings;
  verdict(): MissionVerdict;
  graph(): DependencyGraph;
  ledger(): VerificationLedger;
  quality(): QualityGraph;
  /** The append-only journal of every domain event the flow emitted. */
  events(): readonly DomainEvent[];
  transitions(): readonly FlowTransition[];
  log(): readonly FlowLogEntry[];
  hazards(): readonly FlowHazard[];
  /** True when the current mission may be started given the campaign progress. */
  isUnlocked(key?: string): boolean;
}

/* -------------------------------------------------------------------------- */
/* Internal bookkeeping                                                       */
/* -------------------------------------------------------------------------- */

/** Where a task came from. */
type TaskOrigin = 'plan' | 'player' | 'repair';

/** Everything the flow remembers about one task on the floor. */
interface TaskContract {
  id: string;
  title: string;
  laneId: string;
  dependsOn: readonly string[];
  writeSet: readonly string[];
  readSet: readonly string[];
  checkIds: readonly string[];
  criterionKeys: readonly string[];
  origin: TaskOrigin;
  estimateCredits: number;
  provenance: FlowProvenance;
  /** Repair bookkeeping, present exactly for repair tasks. */
  repair: {
    /** Ultimate root task of the repair chain. */
    rootTaskId: string;
    /** The task this repair fixes. */
    dependsOn: string;
    generation: number;
    /** Checks of the repaired task that this repair re-runs. */
    targetCheckIds: readonly string[];
  } | null;
}

/** Bookkeeping for one scored criterion. */
interface CriterionContract {
  key: string;
  taskId: string;
  label: string;
  requiredEvidence: LedgerCriterionDeclaration['requiredEvidence'];
  lifecycle: LedgerCriterionDeclaration['lifecycle'];
  /** Last measured 0..1 value, so the flow only emits on change. */
  measured: number | null;
}

/** A queued forced failure. */
interface ForcedFailure {
  remaining: number;
  detail: string;
}

const LANE_KIND_ORDER: readonly LaneKind[] = Object.freeze([
  'discovery',
  'build',
  'verify',
  'integrate',
  'observe',
] as const);

const LANE_LABELS: Readonly<Record<LaneKind, string>> = Object.freeze({
  discovery: 'Discovery lane',
  build: 'Build lane',
  verify: 'Verification lane',
  integrate: 'Integration lane',
  observe: 'Observation lane',
});

const PHASE_STATUS: Readonly<Record<MissionPhase, GameState['mission']['status']>> = Object.freeze({
  brief: 'bootstrapping',
  plan: 'running',
  approve: 'running',
  dispatch: 'running',
  verify: 'running',
  repair: 'running',
  release: 'delivering',
});

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function ratio(part: number, whole: number): number {
  return whole <= 0 ? 0 : clamp01(part / whole);
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function isFlowSpeed(value: number): value is FlowSpeed {
  return value === 1 || value === 2 || value === 4;
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Map the planner's claim vocabulary onto the codex provenance vocabulary. */
function mapClaimAuthority(authority: string | undefined): FlowProvenance {
  if (authority === 'user_requirement') return 'user_requirement';
  if (authority === 'repository_evidence' || authority === 'repository_observation') {
    return 'repository_observation';
  }
  return 'architect_choice';
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Create the mission flow for one mission.
 *
 * The flow boots in `brief`: the mission's lanes are registered on the floor and
 * the mission clock stands still until the player acknowledges the request with
 * `start()` and approves the plan with `approve()`. Everything else — the plan,
 * the checks, the criteria, the manifest and the verdict — follows from the
 * mission definition and the seeded simulation.
 */
export function createMissionFlow(options: MissionFlowOptions): MissionFlow {
  const mission = typeof options.mission === 'string' ? requireMissionKey(options.mission) : options.mission;
  const tuning: FlowTuning = { ...DEFAULT_FLOW_TUNING, ...options.tuning };
  const stepMs = options.stepMs !== undefined && options.stepMs > 0 ? options.stepMs : FLOW_STEP_MS;
  const channel = options.channel ?? createDomainEventChannel();
  const emit = (event: DomainEvent): void => {
    channel.emit(event);
  };

  /* ---------------------------------------------------------------------- */
  /* Mutable flow state                                                     */
  /* ---------------------------------------------------------------------- */

  let state: GameState = createInitialState(missionInitialStateOptions(mission));
  let phase: MissionPhase = 'brief';
  let outcome: MissionOutcome = 'running';
  let lossKind: LossKind | null = null;
  let endReason: string | null = null;
  let speed: FlowSpeed = isFlowSpeed(options.speed ?? DEFAULT_SPEED) ? (options.speed ?? DEFAULT_SPEED) : DEFAULT_SPEED;
  let paused = options.paused === true;
  let difficulty = 0;
  let tutorialIndex = 0;
  let briefParsed = false;
  let accumulator = 0;
  let lastReviewAt = 0;
  let lastClockCarryAt = 0;
  let dirty = true;
  let peakActiveAgents = 0;
  let conflictsResolved = 0;

  let ledger: VerificationLedger = createVerificationLedger();
  let qualityRegistry: CriterionRegistry = createCriterionRegistry();
  let report: VerificationReport | null = null;
  let lastGraph: DependencyGraph | null = null;
  let currentVerdict: MissionVerdict = evaluateMissionOutcome(mission, { elapsedMs: 0, metrics: {} });
  let currentReadings: MissionReadings = { elapsedMs: 0, metrics: {} };
  let qualityGraph: QualityGraph = updateQualityGraph(state, { registry: qualityRegistry });
  let manifest: ReleaseManifest = frozenManifest(0, []);
  /** Criteria the flow measures, including superseded history. */
  const criteria = new Map<string, CriterionContract>();
  /** Every task the flow knows about. */
  const contracts = new Map<string, TaskContract>();
  /** Open repair objective check id -> repair task id. */
  const repairBindings = new Map<string, string>();
  /** Repair tasks waiting for a lane. */
  const repairQueue: string[] = [];
  /** Repair generations used per root task. */
  const repairGenerations = new Map<string, number>();
  /** Queued forced check failures. */
  const forcedFailures = new Map<string, ForcedFailure>();
  /** Events by type already emitted, for `event` tutorial steps. */
  const eventTypesSeen = new Set<DomainEventType>();
  /** Outcomes queued for the next gate run. */
  const outcomeQueue: CheckOutcome[] = [];
  /** Activities queued for the next economy tick. */
  const pendingActivities: EconomyActivity[] = [];
  /** Conflict pair keys open at the previous review. */
  let openConflictKeys = new Set<string>();
  const delivered = new Set<string>(options.deliveredMissionKeys ?? []);
  const journal: DomainEvent[] = [];
  const transitions: FlowTransition[] = [];
  const logEntries: FlowLogEntry[] = [];
  const hazards: FlowHazard[] = [];
  let sequence = 0;

  channel.on((event) => {
    journal.push(event);
    eventTypesSeen.add(event.type);
  });

  /* ---------------------------------------------------------------------- */
  /* Small helpers                                                          */
  /* ---------------------------------------------------------------------- */

  function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}`;
  }

  function pushLog(source: FlowLogSource, provenance: FlowProvenance, text: string, atMs = simMs()): void {
    logEntries.push({ id: nextId('log'), atMs, source, provenance, text });
  }

  function flush(): void {
    const drained = channel.drain();
    if (drained.length === 0) return;
    state = applyDomainEvents(state, drained);
  }

  function simMs(): number {
    return runtime.elapsedMs;
  }

  /* ---------------------------------------------------------------------- */
  /* Scheduler and agent runtime                                            */
  /* ---------------------------------------------------------------------- */

  function registerLanes(outline: PlanOutline | null, atMs?: number): void {
    const at = atMs ?? simMs();
    const kinds = new Set<LaneKind>(mission.requiredLaneKinds as readonly LaneKind[]);
    kinds.add('verify');
    for (const task of outline?.tasks ?? []) {
      const kind = laneKindOf(task.laneId);
      if (kind) kinds.add(kind);
    }
    const ordered = LANE_KIND_ORDER.filter((kind) => kinds.has(kind));
    for (const kind of ordered) {
      const laneId = laneIdFor(kind);
      if (state.lanes.lanes[laneId]) continue;
      emit(
        makeDomainEvent(
          'lane/registered',
          { lane: { id: laneId, kind, label: LANE_LABELS[kind], capacity: 1 } },
          at,
        ),
      );
    }
    flush();
  }

  // The floor stands up before the scheduler reads it: the lane slice is the
  // scheduler's source of truth, so registration has to land first. This runs
  // before the agent runtime exists, so the stand-up is stamped at mission 0.
  registerLanes(null, 0);

  const scheduler: DispatchScheduler = createDispatchScheduler(state, {
    laneLimit: mission.pacing.laneLimit,
    maxRetries: FLOW_MAX_RETRIES,
    emit,
  });

  const runtime: AgentRuntime = createAgentRuntime({
    seed: mission.pacing.seed,
    stepMs,
    contextBudget: mission.pacing.contextBudget,
    failureChance: options.agent?.failureChance ?? 0.05,
    rollbackChance: options.agent?.rollbackChance ?? 0.03,
    maxRetries: options.agent?.maxRetries ?? 1,
    maxFixUps: options.agent?.maxFixUps ?? mission.pacing.repairsAllowed,
    scheduler,
    emit,
  });

  /* ---------------------------------------------------------------------- */
  /* Lifecycle transitions                                                  */
  /* ---------------------------------------------------------------------- */

  function assertLegal(from: MissionPhase, to: MissionPhase): void {
    const allowed = PHASE_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error(`[coroid] illegal mission phase transition ${from} -> ${to}`);
    }
  }

  /**
   * Move to a legal successor phase, emitting the mission status event (and any
   * work events the caller supplies) and recording the transition.
   *
   * Every transition therefore carries at least one domain event plus a
   * provenance tag, which is what lets the event terminal show both *what*
   * changed and *why* the flow decided to change it.
   */
  function transitionWith(
    to: MissionPhase,
    provenance: FlowProvenance,
    text: string,
    events: () => readonly DomainEvent[],
  ): FlowTransition {
    const from = phase;
    assertLegal(from, to);
    const at = simMs();
    const emitted: DomainEvent[] = [
      makeDomainEvent('mission/status', { status: PHASE_STATUS[to] }, at),
    ];
    for (const event of events()) emitted.push(event);
    for (const event of emitted) emit(event);
    phase = to;
    const record: FlowTransition = Object.freeze({
      id: nextId('transition'),
      atMs: at,
      from,
      to,
      events: Object.freeze([...emitted]),
      provenance,
      text,
    });
    transitions.push(record);
    pushLog('flow/phase', provenance, `${from} -> ${to}: ${text}`, at);
    dirty = true;
    return record;
  }

  /* ---------------------------------------------------------------------- */
  /* Brief, plan and approve                                                */
  /* ---------------------------------------------------------------------- */

  function requireMissionKey(key: string): MissionDefinition {
    const found = getMission(key);
    if (!found) throw new Error(`[coroid] unknown mission "${key}"`);
    return found;
  }

  function chooseOutline(): PlanOutline {
    const request = {
      missionId: mission.id,
      codename: mission.codename,
      objective: mission.objective,
      difficulty: options.difficulty ?? MIN_DIFFICULTY_LEVEL,
    };
    const target = Math.max(1, mission.pacing.planTasks);
    let fallback: PlanOutline | null = null;
    for (let level = MIN_DIFFICULTY_LEVEL; level <= MAX_DIFFICULTY_LEVEL; level += 1) {
      const outline = generatePlan({ ...request, difficulty: level }, mission.pacing.seed);
      fallback = fallback ?? outline;
      if (outline.summary.taskCount >= target) return outline;
    }
    /* istanbul ignore next -- every authored mission covers its plan size at level 4 */
    return fallback ?? generatePlan(request, mission.pacing.seed);
  }

  function registerContract(task: PlanTaskOutline): void {
    const criteriaForTask = task.criteria.map((criterion) => ({
      key: criterion.key,
      taskId: criterion.taskId,
      label: criterion.label,
      requiredEvidence: criterion.requiredEvidence,
      lifecycle: criterion.lifecycle,
    })) satisfies LedgerCriterionDeclaration[];

    contracts.set(task.id, {
      id: task.id,
      title: task.title,
      laneId: task.laneId,
      dependsOn: [...task.dependsOn],
      writeSet: [...task.writeSet],
      readSet: [...task.readSet],
      checkIds: task.checks.map((check) => check.id),
      criterionKeys: task.criteria.map((criterion) => criterion.key),
      origin: 'plan',
      estimateCredits: task.estimateCredits,
      provenance: mapClaimAuthority(task.sourceClaims[0]?.authority),
      repair: null,
    });

    ledger = registerChecks(ledger, task.checks as readonly CheckDeclaration[]);
    ledger = registerLedgerCriteria(ledger, criteriaForTask);
    qualityRegistry = registerQualityCriteria(qualityRegistry, criteriaForTask);
    for (const criterion of criteriaForTask) {
      criteria.set(criterion.key, {
        key: criterion.key,
        taskId: criterion.taskId,
        label: criterion.label,
        requiredEvidence: criterion.requiredEvidence,
        lifecycle: criterion.lifecycle ?? 'milestone',
        measured: null,
      });
    }
  }

  /** Mission-level gates land on the first task running on their lane. */
  function registerMissionGates(outline: PlanOutline): void {
    if (outline.tasks.length === 0) return;
    const declarations: CheckDeclaration[] = [];
    for (const gate of mission.gateChecklist) {
      const host =
        outline.tasks.find((task) => task.laneId === laneIdFor(gate.laneKind)) ?? (outline.tasks[0] as PlanTaskOutline);
      const contract = contracts.get(host.id);
      if (!contract) continue;
      const declaration: CheckDeclaration = {
        id: gate.id,
        taskId: host.id,
        kind: gate.checkKind as CheckDeclaration['kind'],
        assertion: gate.assertion,
        targetFile: gate.targetFile,
        ...(gate.checkKind === 'composition' ? { evidence: 'browser' as const } : {}),
        criterionKey: null,
        timeoutMs: gate.timeoutMs,
      };
      declarations.push(declaration);
      const updated: TaskContract = { ...contract, checkIds: unique([...contract.checkIds, gate.id]) };
      contracts.set(host.id, updated);
    }
    ledger = registerChecks(ledger, declarations);
  }

  function buildPlan(): void {
    const outline = chooseOutline();
    difficulty = outline.difficulty;
    for (const task of outline.tasks) registerContract(task);
    registerMissionGates(outline);
    // The planner authors the registration script; the flow stamps it onto the
    // mission clock and lets the shared reducer own the `plan` slice.
    const baseAt = simMs();
    for (const event of outline.events) {
      if (event.type !== 'plan/task-registered') continue;
      emit(makeDomainEvent('plan/task-registered', { task: event.task }, baseAt));
    }
    flush();
    pushLog(
      'plan/task-registered',
      'architect_choice',
      `Plan ${outline.planId}: ${outline.summary.taskCount} tasks in ${outline.summary.phaseCount} phases, ${outline.summary.checkCount} checks, difficulty ${outline.tier}.`,
      baseAt,
    );
  }

  function start(): FlowTransition | null {
    if (phase !== 'brief') return null;
    if (!isMissionUnlocked(mission.key, [...delivered])) {
      pushLog(
        'flow/verdict',
        'user_requirement',
        `Mission "${mission.key}" is locked until ${mission.pacing.unlockAfter} earlier mission(s) are delivered.`,
        0,
      );
      return null;
    }
    emit(makeDomainEvent('mission/started', {}, 0));
    emit(makeDomainEvent('economy/deadline', { deadlineMs: mission.pacing.deadlineMs }, 0));
    registerLanes(null);
    briefParsed = true;
    pushLog('mission/started', 'user_requirement', `Request accepted: ${mission.objective}`, 0);
    pushLog('economy/deadline', 'user_requirement', `Delivery slot opened: ${Math.round(mission.pacing.deadlineMs / 1000)}s and ${mission.pacing.contextBudget} context tokens.`, 0);
    const toPlan = transitionWith(
      'plan',
      'user_requirement',
      'the intake request is decomposed',
      () => [],
    );
    acknowledge();
    buildPlan();
    registerLanes(null);
    const toApprove = transitionWith(
      'approve',
      'architect_choice',
      `the plan is ready for approval (${state.plan.order.length} tasks registered)`,
      () => [],
    );
    flush();
    applyImmediateReview();
    if (options.autoApprove === true) approve();
    return toApprove ?? toPlan;
  }

  function approve(): FlowTransition | null {
    if (phase !== 'approve') return null;
    const record = transitionWith('dispatch', 'user_requirement', 'the human approved the plan; the floor opens', () => []);
    flush();
    applyImmediateReview();
    return record;
  }

  function acknowledge(): boolean {
    const step = currentStep();
    if (!step || step.advanceWhen.kind !== 'acknowledge') return false;
    completeStep(step);
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Tutorial                                                               */
  /* ---------------------------------------------------------------------- */

  function steps(): readonly TutorialStep[] {
    return mission.tutorial;
  }

  function currentStep(): TutorialStep | null {
    return steps()[tutorialIndex] ?? null;
  }

  function completeStep(step: TutorialStep): void {
    tutorialIndex += 1;
    pushLog('flow/tutorial', 'architect_choice', `Tutorial ${step.index}: ${step.title} — ${step.lesson}`);
  }

  function stepSatisfied(step: TutorialStep, readings: MissionReadings, verdict: MissionVerdict): boolean {
    const advance = step.advanceWhen;
    switch (advance.kind) {
      case 'acknowledge':
        return false;
      case 'objective':
        return verdict.satisfiedObjectiveIds.includes(advance.objectiveId);
      case 'metric': {
        const value = readings.metrics?.[advance.metric];
        if (value === undefined) return false;
        return advance.comparator === 'gte' ? value >= advance.target : value <= advance.target;
      }
      case 'event':
        return eventTypesSeen.has(advance.eventType);
      default:
        return false;
    }
  }

  function advanceTutorial(readings: MissionReadings, verdict: MissionVerdict): void {
    let guard = 0;
    while (guard < steps().length + 1) {
      guard += 1;
      const step = currentStep();
      if (!step) return;
      if (!stepSatisfied(step, readings, verdict)) return;
      completeStep(step);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Repair registration                                                    */
  /* ---------------------------------------------------------------------- */

  function repairCheckId(taskId: string): string {
    return `check-${taskId}`;
  }

  function laneKindOf(laneId: string): LaneKind | null {
    const match = LANE_KIND_ORDER.find((kind) => laneIdFor(kind) === laneId);
    return match ?? null;
  }

  function repairLaneFor(taskId: string): string {
    const contract = contracts.get(taskId);
    if (contract && laneKindOf(contract.laneId)) return contract.laneId;
    return laneIdFor('verify');
  }

  function nextRepairTaskId(failedTaskId: string, generation: number): string {
    let wave = Math.max(1, generation);
    let id = wave <= 1 ? `fixup-${failedTaskId}` : `fixup-${failedTaskId}-${wave}`;
    while (contracts.has(id) || state.plan.tasks[id] !== undefined) {
      wave += 1;
      id = `fixup-${failedTaskId}-${wave}`;
    }
    return id;
  }

  function rootOf(taskId: string): string {
    const contract = contracts.get(taskId);
    return contract?.repair ? contract.repair.rootTaskId : taskId;
  }

  function openObjectives(): RepairObjective[] {
    return ledger.repairOrder.flatMap((checkId) => {
      const objective = ledger.repairs[checkId];
      return objective && objective.status === 'open' ? [objective] : [];
    });
  }

  function registerRepairTask(
    objective: RepairObjective,
    options: { taskId: string; alreadyRegistered: boolean; fixUp?: FixUpTask },
  ): string {
    const taskId = options.taskId;
    const failedCheck = ledger.checks[objective.checkId];
    const repairedTask = contracts.get(objective.taskId);
    const root = rootOf(objective.taskId);
    const generation = (repairGenerations.get(root) ?? 0) + 1;
    repairGenerations.set(root, Math.max(repairGenerations.get(root) ?? 0, generation));

    const ownCheckId = repairCheckId(taskId);
    const laneId = options.fixUp?.laneId ?? repairLaneFor(objective.taskId);
    const writeSet = options.fixUp ? [...options.fixUp.writeSet] : unique([objective.targetFile]);
    const dependsOn = [objective.taskId];

    const contract: TaskContract = {
      id: taskId,
      title: options.fixUp?.objective ?? `Repair ${objective.taskId}: ${objective.assertion}`,
      laneId,
      dependsOn,
      writeSet,
      readSet: [],
      checkIds: [ownCheckId],
      criterionKeys: [],
      origin: 'repair',
      estimateCredits: repairedTask?.estimateCredits ?? 0,
      provenance: 'architect_choice',
      repair: {
        rootTaskId: root,
        dependsOn: objective.taskId,
        generation,
        targetCheckIds: [objective.checkId],
      },
    };
    contracts.set(taskId, contract);

    if (!options.alreadyRegistered) {
      emit(
        makeDomainEvent(
          'plan/task-registered',
          {
            task: {
              id: taskId,
              title: contract.title,
              laneId,
              dependencies: dependsOn,
              status: 'pending',
              progress: 0,
            },
          },
          simMs(),
        ),
      );
    }

    const declaration: CheckDeclaration = {
      id: ownCheckId,
      taskId,
      kind: failedCheck?.kind ?? 'test',
      assertion: `Repair of ${objective.taskId}: ${objective.assertion}`,
      targetFile: objective.targetFile,
      ...(failedCheck ? { evidence: failedCheck.evidence } : {}),
      criterionKey: null,
      ...(failedCheck?.timeoutMs === undefined || failedCheck.timeoutMs === null
        ? {}
        : { timeoutMs: failedCheck.timeoutMs }),
    };
    ledger = registerChecks(ledger, [declaration]);

    // The commitment the failing check stood for is replaced, never deleted.
    const criterionKey = failedCheck?.criterionKey ?? null;
    const criterion = criterionKey ? criteria.get(criterionKey) : undefined;
    if (criterionKey && criterion && criterion.lifecycle !== 'superseded') {
      const replacementKey = `${criterionKey}-repair-${generation}`;
      const replacement: LedgerCriterionDeclaration = {
        key: replacementKey,
        taskId: criterion.taskId,
        label: `${criterion.label} (repaired)`,
        requiredEvidence: criterion.requiredEvidence,
        lifecycle: criterion.lifecycle,
      };
      ledger = registerLedgerCriteria(ledger, [replacement]);
      const superseded = supersedeCriterion(ledger, criterionKey, replacementKey);
      ledger = superseded.ledger;
      qualityRegistry = registerQualityCriteria(qualityRegistry, [
        { key: criterionKey, lifecycle: 'superseded', supersededBy: replacementKey, label: criterion.label },
        {
          key: replacementKey,
          lifecycle: criterion.lifecycle,
          label: replacement.label ?? replacementKey,
        },
      ] satisfies QualityCriterionDeclaration[]);
      criteria.set(replacementKey, {
        key: replacementKey,
        taskId: criterion.taskId,
        label: replacement.label ?? replacementKey,
        requiredEvidence: replacement.requiredEvidence,
        lifecycle: criterion.lifecycle,
        measured: null,
      });
      criteria.set(criterionKey, { ...criterion, lifecycle: 'superseded' });
      pushLog(
        'flow/repair',
        'architect_choice',
        `Criterion ${criterionKey} superseded by ${replacementKey}: a repair now carries the commitment.`,
      );
    }

    repairBindings.set(objective.checkId, taskId);
    repairQueue.push(taskId);
    pushLog(
      'flow/repair',
      'architect_choice',
      `Repair "${taskId}" opened for check ${objective.checkId} (${objective.targetFile}).`,
    );
    return taskId;
  }

  function planRepairs(): void {
    const maxWaves = Math.max(1, mission.pacing.repairsAllowed) + Math.max(0, tuning.repairWaveReserve);
    for (const objective of openObjectives()) {
      if (repairBindings.has(objective.checkId)) continue;
      const fixUp = runtime.fixUps.find(
        (candidate) => candidate.dependsOn === objective.taskId && !isBoundRepairTask(candidate.id),
      );
      const root = rootOf(objective.taskId);
      if ((repairGenerations.get(root) ?? 0) >= maxWaves) continue;
      let taskId: string;
      let alreadyRegistered = false;
      if (fixUp) {
        taskId = fixUp.id;
        alreadyRegistered = true;
        if (!contracts.has(taskId)) {
          /* The runtime registers its fix-up through a plan event; make sure the
           * flow has a contract for it before binding the objective. */
          registerRepairTask(objective, { taskId, alreadyRegistered: true, fixUp });
          continue;
        }
      } else {
        taskId = nextRepairTaskId(objective.taskId, (repairGenerations.get(root) ?? 0) + 1);
      }
      registerRepairTask(objective, { taskId, alreadyRegistered, ...(fixUp ? { fixUp } : {}) });
    }
  }

  function isBoundRepairTask(taskId: string): boolean {
    for (const bound of repairBindings.values()) {
      if (bound === taskId) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------------- */
  /* Verification and quality                                               */
  /* ---------------------------------------------------------------------- */

  function taskCheckIds(taskId: string): readonly string[] {
    return contracts.get(taskId)?.checkIds ?? [];
  }

  function firstUnresolvedCheckId(taskId: string): string | null {
    const checks = taskCheckIds(taskId);
    for (const checkId of checks) {
      if (ledger.outcomes[checkId]?.status !== 'passed') return checkId;
    }
    return checks[0] ?? null;
  }

  function queueOutcome(checkId: string, status: 'passed' | 'failed', atMs: number, detail?: string): void {
    outcomeQueue.push({
      checkId,
      status,
      atMs,
      ...(detail === undefined ? {} : { detail }),
    });
  }

  function consumeForcedFailure(checkId: string): ForcedFailure | null {
    const forced = forcedFailures.get(checkId);
    if (!forced) return null;
    if (forced.remaining <= 1) forcedFailures.delete(checkId);
    else forcedFailures.set(checkId, { ...forced, remaining: forced.remaining - 1 });
    return forced;
  }

  function runGate(): void {
    const outcomes = outcomeQueue.splice(0, outcomeQueue.length);
    const result = runVerificationGate(state, { ledger, outcomes, atMs: simMs() });
    ledger = result.ledger;
    report = result.report;
    for (const event of result.events) emit(event);
  }

  function measureQuality(): void {
    for (const criterion of criteria.values()) {
      if (criterion.lifecycle === 'superseded') continue;
      const task = state.plan.tasks[criterion.taskId];
      const taskPassed = task?.status === 'passed';
      const value = taskPassed ? 1 : task?.status === 'failed' ? 0 : round(clamp01(task?.progress ?? 0));
      if (criterion.measured === value) continue;
      criterion.measured = value;
      emit(
        makeDomainEvent(
          'quality/measured',
          {
            metric: {
              id: criterion.key,
              label: criterion.label,
              value,
              target: 1,
              weight: 1,
            },
          },
          simMs(),
        ),
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Economy                                                                */
  /* ---------------------------------------------------------------------- */

  /** Activities already paid for, so a retry never pays twice. */
  const chargedActivities = new Set<string>();

  /** Credit share of the mission's own per-task estimate for each activity kind. */
  function creditShareFor(kind: EconomyActivityKind): number {
    if (kind === 'dispatch') return tuning.dispatchCreditShare;
    if (kind === 'verification') return tuning.verificationCreditShare;
    return tuning.repairCreditShare;
  }

  /**
   * Price one step of work against the plan's own estimate for the task.
   *
   * An activity is charged once per task (`kind:taskId`), so a retry re-runs the
   * work without re-billing it — the plan's estimate already covers the task.
   *
   * The agent runtime owns the mission's token ledger (every agent step emits an
   * `economy/spend` event), so activities are priced with zero context tokens: the
   * flow charges credits from the plan's estimate and leaves reputation to the
   * economy module's shipped table, where verification earns trust and repairs
   * spend it. That keeps exactly one ledger per resource.
   */
  function chargeActivity(kind: EconomyActivityKind, key: string, label: string, estimateCredits: number): void {
    const chargeKey = `${kind}:${key}`;
    if (chargedActivities.has(chargeKey)) return;
    chargedActivities.add(chargeKey);
    const credits = Math.max(0, Math.round(Math.max(0, estimateCredits) * creditShareFor(kind)));
    pendingActivities.push(
      createEconomyActivity(kind, simMs(), {
        id: chargeKey,
        label,
        cost: { contextTokens: 0, credits },
      }),
    );
  }

  /**
   * Settle the ticks's activities: credits, reputation and the mission clock.
   *
   * Tokens are deliberately absent — the agent runtime burns them through its own
   * `economy/spend` events — so the economy module here only prices the work the
   * flow asked for and reports the starvation and exhaustion readings the flow
   * evaluates.
   */
  function runEconomy(): void {
    const activities = pendingActivities.splice(0, pendingActivities.length);
    const result = applyEconomyTick(state, { atMs: simMs(), activities });
    for (const event of result.events) emit(event);
  }

  function rewardTask(taskId: string): void {
    const contract = contracts.get(taskId);
    const credits = Math.max(0, Math.round((contract?.estimateCredits ?? 0) * tuning.rewardShare));
    emit(
      makeDomainEvent(
        'economy/reward',
        { credits, reputation: tuning.rewardReputation },
        simMs(),
      ),
    );
    pushLog(
      'economy/reward',
      'repository_observation',
      `"${taskId}" shipped: +${credits} credits, +${tuning.rewardReputation} reputation.`,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Agent settlements                                                      */
  /* ---------------------------------------------------------------------- */

  function isRepairTask(taskId: string): boolean {
    return contracts.get(taskId)?.origin === 'repair';
  }

  function closeRepairChain(taskId: string, atMs: number): void {
    let current: string | undefined = taskId;
    const guard = new Set<string>();
    while (current !== undefined && !guard.has(current)) {
      guard.add(current);
      const contract = contracts.get(current);
      if (!contract) return;
      for (const checkId of contract.checkIds) queueOutcome(checkId, 'passed', atMs);
      if (!contract.repair) return;
      for (const checkId of contract.repair.targetCheckIds) queueOutcome(checkId, 'passed', atMs);
      current = contract.repair.dependsOn;
    }
  }

  function accumulateSettlements(settlements: readonly AgentSettlement[]): void {
    for (const settlement of settlements) {
      const contract = contracts.get(settlement.taskId);
      if (!contract) continue;
      if (settlement.outcome === 'success') {
        if (contract.repair) {
          closeRepairChain(settlement.taskId, settlement.at);
        } else {
          for (const checkId of contract.checkIds) {
            const forced = consumeForcedFailure(checkId);
            if (forced) {
              queueOutcome(checkId, 'failed', settlement.at, forced.detail);
              pushLog('verification/run', 'repository_observation', `Forced failure on ${checkId}: ${forced.detail}`, settlement.at);
            } else {
              queueOutcome(checkId, 'passed', settlement.at);
            }
          }
        }
        rewardTask(settlement.taskId);
        chargeActivity('verification', settlement.taskId, contract.title, contract.estimateCredits);
        continue;
      }

      if (settlement.decision.requeued) continue;

      const failingCheckId = firstUnresolvedCheckId(settlement.taskId);
      if (failingCheckId) {
        queueOutcome(failingCheckId, 'failed', settlement.at, settlement.reason);
      }
    }
    dirty = true;
  }

  /* ---------------------------------------------------------------------- */
  /* Dispatch                                                               */
  /* ---------------------------------------------------------------------- */

  function toDispatchInput(taskId: string): DispatchTaskInput | null {
    const contract = contracts.get(taskId);
    if (!contract) return null;
    return {
      id: contract.id,
      title: contract.title,
      laneId: contract.laneId,
      dependencies: [...contract.dependsOn],
      writeSet: [...contract.writeSet],
      readSet: [...contract.readSet],
    };
  }

  function conflictFlags(graph: DependencyGraph): DispatchConflictFlag[] {
    return queryConflicts(graph).map((conflict) => ({
      taskIds: conflict.taskIds,
      paths: [...conflict.paths],
    }));
  }

  function dispatchPass(graph: DependencyGraph): void {
    const at = simMs();
    const repairReady = repairQueue.flatMap((taskId) => {
      const input = toDispatchInput(taskId);
      return input ? [input] : [];
    });
    const ready = listDispatchableTaskIds(state, ledger).flatMap((taskId) => {
      if (isRepairTask(taskId)) return [];
      const input = toDispatchInput(taskId);
      return input ? [input] : [];
    });

    const scheduleReport = scheduler.schedule({
      at,
      ready: [...repairReady, ...ready],
      conflicts: conflictFlags(graph),
      laneLimit: mission.pacing.laneLimit,
    });

    let dispatched = 0;
    for (const placement of scheduleReport.dispatched) {
      if (placement.queued) continue;
      const contract = contracts.get(placement.taskId);
      if (!contract) continue;
      const queuedAt = repairQueue.indexOf(placement.taskId);
      if (queuedAt >= 0) repairQueue.splice(queuedAt, 1);
      runtime.dispatch({
        taskId: contract.id,
        laneId: placement.laneId,
        title: contract.title,
        writeSet: contract.writeSet,
        readSet: contract.readSet,
      });
      chargeActivity(
        contract.origin === 'repair' ? 'fixup' : 'dispatch',
        contract.id,
        contract.title,
        contract.estimateCredits,
      );
      dispatched += 1;
    }
    if (dispatched > 0) {
      peakActiveAgents = Math.max(peakActiveAgents, runtime.report().activeAgents);
    }
    for (const refusal of scheduleReport.refusals) {
      if (refusal.reason !== 'write-conflict') continue;
      pushLog('lane/queued', 'repository_observation', refusal.message, at);
    }
    if (graph.status === 'rejected' && graph.conflicts.length > 0) {
      pushLog(
        'flow/repair',
        'architect_choice',
        `Graph rejected: ${graph.conflicts.length} same-phase write conflict(s) still open.`,
        at,
      );
    }
  }

  /** True when nothing is running, queued or ready: the floor has gone quiet. */
  function floorIdle(): boolean {
    const occupancy = scheduler.report(simMs());
    return occupancy.inFlightTaskIds.length === 0 && occupancy.waitingTaskIds.length === 0;
  }

  function pendingDispatchable(): readonly string[] {
    return listDispatchableTaskIds(state, ledger).filter((taskId) => !isRepairTask(taskId));
  }

  /* ---------------------------------------------------------------------- */
  /* Manifest and release                                                   */
  /* ---------------------------------------------------------------------- */

  function buildManifest(shipped: boolean, shippedAtMs: number | null): ReleaseManifest {
    const entries: ManifestEntry[] = [];
    for (const taskId of state.plan.order) {
      const task = state.plan.tasks[taskId];
      if (!task || task.status !== 'passed') continue;
      const contract = contracts.get(taskId);
      const evidenceCheckIds = (contract?.checkIds ?? []).filter(
        (checkId) => ledger.outcomes[checkId]?.status === 'passed',
      );
      entries.push({
        id: `manifest-${taskId}`,
        taskId,
        title: task.title,
        laneId: task.laneId,
        evidenceCheckIds,
        criterionKeys: [...(contract?.criterionKeys ?? [])],
        provenance: contract?.provenance ?? 'architect_choice',
        atMs: task.finishedAtMs ?? simMs(),
      });
    }
    const covered = entries.filter((entry) => entry.evidenceCheckIds.length > 0).length;
    return frozenManifest(simMs(), entries, shipped, shippedAtMs, covered);
  }

  function frozenManifest(
    assembledAtMs: number,
    entries: readonly ManifestEntry[],
    shipped = false,
    shippedAtMs: number | null = null,
    covered?: number,
  ): ReleaseManifest {
    const withEvidence = covered ?? entries.filter((entry) => entry.evidenceCheckIds.length > 0).length;
    const withProvenance = entries.filter((entry) => FLOW_PROVENANCE_KINDS.includes(entry.provenance)).length;
    return Object.freeze({
      id: `manifest-${mission.id}`,
      missionId: mission.id,
      codename: mission.codename,
      assembledAtMs,
      shipped,
      shippedAtMs,
      entries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))),
      coverageRatio: ratio(withEvidence, entries.length),
      provenanceRatio: ratio(withProvenance, entries.length),
    });
  }

  /**
   * The release gate. Shipping needs all of:
   *
   *  - the catalogue's own verdict (every required objective and win threshold
   *    from the mission definition),
   *  - the verification ledger's release readiness, which counts final
   *    invariants only,
   *  - the quality graph's readiness with at least one final invariant declared,
   *  - a non-empty manifest, so there is something to hand over.
   *
   * Work that was never repaired because its repair waves ran out keeps a task
   * failed, but it does not by itself stop the release: what stops the release is
   * an unmet final invariant, which is exactly what the two readiness gates
   * measure.
   */
  function releaseGateMet(): boolean {
    if (currentVerdict.outcome !== 'won') return false;
    const verificationReady = evaluateReleaseReadiness(ledger);
    const qualityReady = qualityGraph.finalInvariants.total > 0 && qualityGraph.ready;
    return verificationReady.ready && qualityReady && manifest.entries.length > 0;
  }

  function ship(): void {
    const shippedManifest = buildManifest(true, simMs());
    manifest = shippedManifest;
    emit(makeDomainEvent('mission/status', { status: 'delivered' }, simMs()));
    outcome = 'won';
    lossKind = null;
    endReason = `${mission.codename} delivered with ${shippedManifest.entries.length} manifest entries and every final invariant green.`;
    delivered.add(mission.key);
    pushLog('flow/manifest', 'user_requirement', endReason);
    pushLog('flow/verdict', 'user_requirement', `WIN: ${endReason}`);
    finishFloor();
  }

  function lose(kind: LossKind, reason: string): void {
    if (outcome !== 'running') return;
    outcome = 'lost';
    lossKind = kind;
    endReason = reason;
    emit(makeDomainEvent('mission/status', { status: 'blocked' }, simMs()));
    pushLog('flow/verdict', 'user_requirement', `LOSS (${kind}): ${reason}`);
    finishFloor();
  }

  /* ---------------------------------------------------------------------- */
  /* Readings                                                               */
  /* ---------------------------------------------------------------------- */

  function graphOf(): DependencyGraph {
    const ownership: Record<string, { writeSet: readonly string[]; readSet: readonly string[] }> = {};
    for (const contract of contracts.values()) {
      ownership[contract.id] = { writeSet: contract.writeSet, readSet: contract.readSet };
    }
    return buildDependencyGraph(state, ownership as TaskOwnershipMap);
  }

  function computeReadings(graph: DependencyGraph): MissionReadings {
    const metrics: Partial<Record<MissionMetric, number>> = {};
    const tasks = state.plan.order.flatMap((taskId) => {
      const task = state.plan.tasks[taskId];
      return task ? [task] : [];
    });
    const passed = tasks.filter((task) => task.status === 'passed').length;
    const phasesComplete = graph.phases.filter((phaseEntry) =>
      phaseEntry.taskIds.length > 0 &&
      phaseEntry.taskIds.every((taskId) => state.plan.tasks[taskId]?.status === 'passed'),
    ).length;
    const owned = tasks.filter((task) => (contracts.get(task.id)?.writeSet.length ?? 0) > 0).length;
    const gates = state.verification.order.flatMap((gateId) => {
      const gate = state.verification.gates[gateId];
      return gate ? [gate] : [];
    });
    const checkKinds = new Set(
      ledger.checkOrder.flatMap((checkId) => {
        const check = ledger.checks[checkId];
        return check ? [check.kind] : [];
      }),
    );
    const checksGreen = ledger.checkOrder.filter(
      (checkId) => ledger.outcomes[checkId]?.status === 'passed',
    ).length;
    const closedRepairs = ledger.repairOrder.filter(
      (checkId) => ledger.repairs[checkId]?.status === 'closed',
    ).length;
    const context = readEconomyContext(state, { atMs: simMs() });
    const clock = readEconomyClock(state, { atMs: simMs() });
    const deadlineRemainingRatio =
      mission.pacing.deadlineMs <= 0 ? 0 : clamp01(clock.remainingMs / mission.pacing.deadlineMs);

    metrics['intake-briefs-parsed'] = briefParsed ? 1 : 0;
    metrics['tasks-registered'] = tasks.length;
    metrics['phases-planned'] = graph.phases.length;
    metrics['tasks-passed'] = passed;
    metrics['phases-complete'] = phasesComplete;
    metrics['lanes-active-peak'] = peakActiveAgents;
    metrics['ownership-coverage-ratio'] = ratio(owned, tasks.length);
    metrics['conflicts-open'] = graph.conflicts.length;
    metrics['conflicts-resolved'] = conflictsResolved;
    metrics['gates-passed'] = gates.filter((gate) => gate.status === 'passed').length;
    metrics['checks-declared'] = checkKinds.size;
    metrics['checks-green'] = checksGreen;
    metrics['failures-repaired'] = closedRepairs;
    metrics['metrics-measured'] = state.quality.order.length;
    metrics['invariants-held'] = qualityGraph.finalInvariants.satisfied;
    metrics['invariants-at-risk'] = qualityGraph.finalInvariants.pending;
    metrics['criteria-superseded'] = qualityGraph.supersededCount;
    metrics['quality-score'] = round(qualityGraph.score);
    metrics['reputation'] = state.economy.reputation;
    metrics['credits'] = state.economy.credits;
    metrics['context-remaining-ratio'] = round(context.remainingFraction);
    metrics['deadline-remaining-ratio'] = round(deadlineRemainingRatio);
    metrics['manifest-entries'] = manifest.entries.length;
    metrics['manifest-coverage-ratio'] = round(manifest.coverageRatio);
    metrics['provenance-coverage-ratio'] = round(manifest.provenanceRatio);

    return { elapsedMs: simMs(), metrics };
  }

  /* ---------------------------------------------------------------------- */
  /* Phase work                                                             */
  /* ---------------------------------------------------------------------- */

  function observeConflicts(graph: DependencyGraph): void {
    const next = new Set(graph.conflicts.map((conflict) => `${conflict.taskIds[0]}|${conflict.taskIds[1]}`));
    let resolved = 0;
    for (const key of openConflictKeys) {
      if (next.has(key)) continue;
      const [left, right] = key.split('|');
      const leftPassed = left !== undefined && state.plan.tasks[left]?.status === 'passed';
      const rightPassed = right !== undefined && state.plan.tasks[right]?.status === 'passed';
      if (leftPassed || rightPassed) resolved += 1;
    }
    conflictsResolved += resolved;
    openConflictKeys = next;
  }

  function phaseWork(graph: DependencyGraph): void {
    if (outcome !== 'running') return;
    switch (phase) {
      case 'dispatch': {
        dispatchPass(graph);
        if (openObjectives().length > 0) {
          const unbound = openObjectives().some((objective) => !repairBindings.has(objective.checkId));
          if (unbound) {
            transitionWith('repair', 'architect_choice', 'a failing check needs a repair wave', () => []);
            return;
          }
        }
        if (floorIdle() && pendingDispatchable().length === 0) {
          transitionWith('verify', 'architect_choice', 'nothing is left to dispatch; the gate takes over', () => []);
        }
        return;
      }
      case 'verify': {
        const unbound = openObjectives().some((objective) => !repairBindings.has(objective.checkId));
        if (unbound) {
          transitionWith('repair', 'architect_choice', 'a repair objective is open without a fix-up task', () => []);
          return;
        }
        if (releaseGateMet()) {
          transitionWith('release', 'user_requirement', 'every final invariant is green; the manifest ships', () => []);
          ship();
          return;
        }
        if (pendingDispatchable().length > 0 || repairQueue.length > 0) {
          transitionWith('dispatch', 'architect_choice', 'verified work released its dependents', () => []);
          return;
        }
        if (openObjectives().length > 0 && floorIdle()) {
          transitionWith('repair', 'architect_choice', 'the floor is quiet but a repair objective is open', () => []);
          return;
        }
        if (simMs() >= mission.pacing.deadlineMs && !releaseGateMet()) {
          lose(
            'invariant-deadline',
            'The delivery slot closed with final invariants still unrepaired.',
          );
        }
        return;
      }
      case 'repair': {
        planRepairs();
        transitionWith('dispatch', 'architect_choice', 'repair work is on the floor', () => []);
        return;
      }
      default:
        return;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* The orchestration pass                                                 */
  /* ---------------------------------------------------------------------- */

  function contractRows(): readonly FlowTaskRow[] {
    const graph = lastGraph;
    return Object.freeze(
      state.plan.order.flatMap((taskId) => {
        const task = state.plan.tasks[taskId];
        const contract = contracts.get(taskId);
        if (!task || !contract) return [];
        return [
          Object.freeze({
            id: task.id,
            title: task.title,
            laneId: task.laneId,
            status: task.status,
            progress: task.progress,
            dependencies: Object.freeze([...task.dependencies]),
            writeSet: Object.freeze([...contract.writeSet]),
            readSet: Object.freeze([...contract.readSet]),
            checkIds: Object.freeze([...contract.checkIds]),
            criterionKeys: Object.freeze([...contract.criterionKeys]),
            origin: contract.origin,
            phase: graph?.byId[taskId]?.phase ?? null,
            provenance: contract.provenance,
          }),
        ];
      }),
    );
  }

  function replayMissionLines(force = false): void {
    const at = simMs();
    for (const line of mission.eventLog) {
      if (!force && line.atMs > at) continue;
      if (logEntries.some((entry) => entry.id === line.id)) continue;
      logEntries.push({
        id: line.id,
        atMs: line.atMs,
        source: line.source,
        provenance: line.provenance,
        text: line.text,
      });
    }
  }

  /**
   * Close the floor when the mission ends.
   *
   * Every lane is released and shut down, and any authored flavour line the
   * mission had not reached yet is replayed so the terminal shows the whole
   * story of the run.
   */
  function finishFloor(): void {
    scheduler.closeAll(simMs());
    replayMissionLines(true);
    flush();
  }

  function carryClock(): void {
    const at = simMs();
    if (at - lastClockCarryAt < CLOCK_CARRY_MS) return;
    lastClockCarryAt = at;
    emit(makeDomainEvent('mission/status', { status: state.mission.status }, at));
  }

  function review(): void {
    if (outcome !== 'running') return;
    const graph = graphOf();
    lastGraph = graph;
    observeConflicts(graph);
    runGate();
    measureQuality();
    qualityGraph = updateQualityGraph(state, { registry: qualityRegistry });
    manifest = buildManifest(false, null);
    currentReadings = computeReadings(graph);
    currentVerdict = evaluateMissionOutcome(mission, currentReadings);
    dirty = false;
    lastReviewAt = simMs();

    if (currentVerdict.outcome === 'lost') {
      lose(currentVerdict.lossKind ?? 'invariant-deadline', currentVerdict.reason);
    } else {
      phaseWork(graph);
      if (outcome === 'running' && currentVerdict.outcome === 'won' && !releaseGateMet() && simMs() >= mission.pacing.deadlineMs) {
        lose('invariant-deadline', 'The mission met its targets but a final invariant was never repaired.');
      }
    }

    runEconomy();
    advanceTutorial(currentReadings, currentVerdict);
    replayMissionLines();
    carryClock();
    flush();
  }

  function applyImmediateReview(): void {
    review();
    flush();
  }

  /** One fixed simulation step. */
  function stepOnce(): void {
    const settlements = runtime.advance(stepMs);
    accumulateSettlements(settlements);
    const working = runtime.report().activeAgents;
    if (working > peakActiveAgents) peakActiveAgents = working;
    const due = dirty || simMs() - lastReviewAt >= tuning.reviewIntervalMs;
    if (due) review();
    flush();
  }

  /* ---------------------------------------------------------------------- */
  /* Public intents                                                         */
  /* ---------------------------------------------------------------------- */

  function setSpeed(next: FlowSpeed): FlowSpeed {
    if (isFlowSpeed(next)) speed = next;
    return speed;
  }

  function pause(): boolean {
    paused = true;
    return paused;
  }

  function resume(): boolean {
    paused = false;
    return paused;
  }

  function togglePause(): boolean {
    paused = !paused;
    return paused;
  }

  /**
   * Advance the mission by one frame of real time.
   *
   * The frame's time is converted to a whole number of fixed steps exactly once
   * per frame, and the current speed multiplies that budget — so `advance(2000)`
   * at 2x simulates exactly what two `advance(1000)` calls at 1x simulate. The
   * leftover fraction of a step stays in the accumulator, so pacing never drifts.
   *
   * While paused, or before the plan is approved, no simulation time passes at
   * all: the deadline cannot run down while the player is reading.
   */
  function advance(frameMs: number): FlowFrameReport {
    const offered = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : 0;
    let steps = 0;
    if (!paused && outcome === 'running' && isRunningPhase()) {
      accumulator += offered;
      const budgetSteps = Math.floor(accumulator / stepMs);
      if (budgetSteps > 0) {
        accumulator -= budgetSteps * stepMs;
        for (let index = 0; index < budgetSteps && outcome === 'running'; index += 1) {
          for (let multiplier = 0; multiplier < speed && outcome === 'running'; multiplier += 1) {
            stepOnce();
            steps += 1;
          }
        }
      }
    }
    return Object.freeze({
      frameMs: offered,
      simulatedMs: steps === 0 ? 0 : steps * stepMs,
      steps,
      phase,
      outcome,
      lossKind,
    });
  }

  function isRunningPhase(): boolean {
    return phase === 'dispatch' || phase === 'verify' || phase === 'repair' || phase === 'release';
  }

  function forceCheckFailure(target: string, settings: { detail?: string; times?: number } = {}): FlowHazard {
    const contract = contracts.get(target);
    const checkId = contract ? (firstUnresolvedCheckId(target) ?? target) : target;
    const times = Math.max(1, Math.trunc(settings.times ?? 1));
    const detail = settings.detail ?? 'the mission script forced this check to fail';
    forcedFailures.set(checkId, { remaining: times, detail });
    const hazard: FlowHazard = Object.freeze({
      id: nextId('hazard'),
      kind: 'failing-check',
      atMs: simMs(),
      detail: `${checkId}: ${detail}`,
      provenance: 'architect_choice',
    });
    hazards.push(hazard);
    pushLog('flow/hazard', 'architect_choice', `Fault injected on ${checkId}: ${detail}`);
    dirty = true;
    return hazard;
  }

  function drainContext(tokens: number, detail?: string): FlowHazard {
    const amount = Math.max(0, Math.round(Number.isFinite(tokens) ? tokens : 0));
    emit(makeDomainEvent('economy/spend', { credits: 0, contextTokens: amount }, simMs()));
    const hazard: FlowHazard = Object.freeze({
      id: nextId('hazard'),
      kind: 'context-drain',
      atMs: simMs(),
      detail: detail ?? `burned ${amount} context tokens`,
      provenance: 'architect_choice',
    });
    hazards.push(hazard);
    pushLog('flow/hazard', 'architect_choice', `Context drained: ${hazard.detail}`);
    flush();
    dirty = true;
    return hazard;
  }

  function addTask(request: FlowTaskRequest): FlowTaskRow {
    const id = request.id.trim();
    if (id.length === 0) throw new Error('[coroid] flow.addTask requires a task id');
    const laneId = request.laneId ?? laneIdFor('build');
    const writeSet = unique(request.writeSet ?? []);
    const readSet = unique(request.readSet ?? []);
    const dependsOn = unique(request.dependsOn ?? []);
    const checks: CheckDeclaration[] = (request.checks ?? []).map((check) => ({
      id: check.id,
      taskId: id,
      kind: check.kind,
      assertion: check.assertion,
      targetFile: check.targetFile ?? writeSet[0] ?? id,
      ...(check.evidence === undefined ? {} : { evidence: check.evidence }),
      criterionKey: check.criterionKey ?? null,
      ...(check.timeoutMs === undefined ? {} : { timeoutMs: check.timeoutMs }),
    }));

    contracts.set(id, {
      id,
      title: request.title,
      laneId,
      dependsOn,
      writeSet,
      readSet,
      checkIds: checks.map((check) => check.id),
      criterionKeys: [],
      origin: 'player',
      estimateCredits: 0,
      provenance: 'user_requirement',
      repair: null,
    });
    ledger = registerChecks(ledger, checks);
    emit(
      makeDomainEvent(
        'plan/task-registered',
        {
          task: {
            id,
            title: request.title,
            laneId,
            dependencies: dependsOn,
            status: 'pending',
            progress: 0,
          },
        },
        simMs(),
      ),
    );
    pushLog('plan/task-registered', 'user_requirement', `Extra work registered: "${id}" on ${laneId}.`);
    flush();
    dirty = true;
    const rows = contractRows();
    return (
      rows.find((row) => row.id === id) ?? {
        id,
        title: request.title,
        laneId,
        status: 'pending' as TaskStatus,
        progress: 0,
        dependencies: Object.freeze(dependsOn),
        writeSet: Object.freeze(writeSet),
        readSet: Object.freeze(readSet),
        checkIds: Object.freeze(checks.map((check) => check.id)),
        criterionKeys: Object.freeze([]),
        origin: 'player' as TaskOrigin,
        phase: null,
        provenance: 'user_requirement' as FlowProvenance,
      }
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Snapshot                                                               */
  /* ---------------------------------------------------------------------- */

  function tutorialProgress(): TutorialProgress {
    const step = currentStep();
    const completed = steps().slice(0, tutorialIndex).map((entry) => entry.id);
    return Object.freeze({
      stepId: step?.id ?? '',
      index: step?.index ?? steps().length,
      total: steps().length,
      title: step?.title ?? 'Mission complete',
      instruction: step?.instruction ?? 'Every tutorial step for this mission is done.',
      lesson: step?.lesson ?? '',
      targets: Object.freeze([...(step?.targets ?? [])]),
      advanceWhen: step?.advanceWhen ?? { kind: 'acknowledge' as const },
      completedStepIds: Object.freeze(completed),
      complete: step === null,
    });
  }

  function campaignProgress(): CampaignProgress {
    const deliveredKeys = listMissions()
      .map((entry) => entry.key)
      .filter((key) => delivered.has(key));
    const unlockedKeys: string[] = [];
    const lockedKeys: string[] = [];
    for (const entry of listMissions()) {
      if (isMissionUnlocked(entry.key, deliveredKeys)) unlockedKeys.push(entry.key);
      else lockedKeys.push(entry.key);
    }
    const campaign = listMissions();
    const span = campaign.length <= 1 ? 1 : campaign.length - 1;
    const difficultyRatio = clamp01((mission.order - 1) / span);
    return Object.freeze({
      currentKey: mission.key,
      order: mission.order,
      missionCount: campaign.length,
      difficulty: round(difficultyRatio),
      deliveredKeys: Object.freeze(deliveredKeys),
      unlockedKeys: Object.freeze(unlockedKeys),
      lockedKeys: Object.freeze(lockedKeys),
      nextKey: nextMission(mission.key)?.key ?? null,
      unlocked: isMissionUnlocked(mission.key, deliveredKeys),
    });
  }

  function verificationReading(): FlowVerificationReading {
    const gates = state.verification.order.flatMap((gateId) => {
      const gate = state.verification.gates[gateId];
      return gate ? [gate] : [];
    });
    const checksGreen = ledger.checkOrder.filter(
      (checkId) => ledger.outcomes[checkId]?.status === 'passed',
    ).length;
    const closedRepairs = ledger.repairOrder.filter(
      (checkId) => ledger.repairs[checkId]?.status === 'closed',
    ).length;
    return Object.freeze({
      passRate: state.verification.passRate,
      gates: gates.length,
      gatesPassed: gates.filter((gate) => gate.status === 'passed').length,
      gatesFailed: gates.filter((gate) => gate.status === 'failed').length,
      checksDeclared: ledger.checkOrder.length,
      checksGreen,
      failuresRepaired: closedRepairs,
      openRepairObjectiveIds: Object.freeze(
        openObjectives().map((objective) => objective.id),
      ),
      blockedTaskIds: Object.freeze(listBlockedTaskIds(state, ledger)),
      dispatchableTaskIds: Object.freeze(listDispatchableTaskIds(state, ledger)),
      readiness: report?.readiness ?? evaluateReleaseReadiness(ledger),
      summary: report?.summary ?? 'The verification gate has not run yet.',
    });
  }

  function qualityReading(): FlowQualityReading {
    return Object.freeze({
      score: qualityGraph.score,
      readiness: qualityGraph.readiness,
      releaseThreshold: qualityGraph.releaseThreshold,
      ready: qualityGraph.ready,
      measuredMetrics: state.quality.order.length,
      invariantsHeld: qualityGraph.finalInvariants.satisfied,
      invariantsAtRisk: qualityGraph.finalInvariants.pending,
      criteriaSuperseded: qualityGraph.supersededCount,
      blockers: Object.freeze([...qualityGraph.blockers]),
    });
  }

  function snapshot(): MissionFlowSnapshot {
    return Object.freeze({
      missionId: mission.id,
      codename: mission.codename,
      objective: mission.objective,
      phase,
      outcome,
      lossKind,
      endReason,
      simMs: simMs(),
      deadlineMs: mission.pacing.deadlineMs,
      speed,
      paused,
      state: createSnapshot(state),
      plan: contractRows(),
      lanes: Object.freeze(scheduler.report(simMs()).occupancy),
      agents: runtime.report(),
      verification: verificationReading(),
      quality: qualityReading(),
      economy: Object.freeze({
        credits: state.economy.credits,
        reputation: state.economy.reputation,
        context: readEconomyContext(state, { atMs: simMs() }),
        clock: readEconomyClock(state, { atMs: simMs() }),
      }),
      readings: currentReadings,
      verdict: currentVerdict,
      tutorial: tutorialProgress(),
      campaign: campaignProgress(),
      manifest,
      graph: Object.freeze({
        status: lastGraph?.status ?? 'accepted',
        taskCount: state.plan.order.length,
        phaseCount: lastGraph?.phases.length ?? 0,
        conflicts: lastGraph?.conflicts.length ?? 0,
      }),
      log: Object.freeze([...logEntries]),
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Wiring                                                                 */
  /* ---------------------------------------------------------------------- */

  lastClockCarryAt = 0;

  if (options.autoStart === true) start();

  return {
    mission,
    get state(): GameState {
      return state;
    },
    get phase(): MissionPhase {
      return phase;
    },
    get outcome(): MissionOutcome {
      return outcome;
    },
    get lossKind(): LossKind | null {
      return lossKind;
    },
    get simMs(): number {
      return simMs();
    },
    get difficulty(): number {
      return difficulty;
    },
    get speed(): FlowSpeed {
      return speed;
    },
    get paused(): boolean {
      return paused;
    },
    channel,
    start,
    acknowledge,
    approve,
    advance,
    setSpeed,
    pause,
    resume,
    togglePause,
    forceCheckFailure,
    drainContext,
    addTask,
    snapshot,
    taskRows: contractRows,
    tutorial: tutorialProgress,
    campaign: campaignProgress,
    manifest: () => manifest,
    readings: () => currentReadings,
    verdict: () => currentVerdict,
    graph: () => lastGraph ?? graphOf(),
    ledger: () => ledger,
    quality: () => qualityGraph,
    events: () => Object.freeze([...journal]),
    transitions: () => Object.freeze([...transitions]),
    log: () => Object.freeze([...logEntries]),
    hazards: () => Object.freeze([...hazards]),
    isUnlocked: (key?: string) => isMissionUnlocked(key ?? mission.key, [...delivered]),
  };
}
