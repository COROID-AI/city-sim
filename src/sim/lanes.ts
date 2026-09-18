/**
 * Lane scheduling — how Coroid opens lanes and decides what runs in parallel.
 *
 * The plan slice says *what* a mission must ship; this module says *what may run
 * at the same time*. It is deliberately input-driven: the caller proves which
 * tasks are ready and which of them carry a write-ownership conflict, and hands
 * both sets in as explicit arguments. That is why the scheduler never imports
 * the dependency-graph module — the two can be built, tested and reasoned about
 * independently, and wiring them together is the composition layer's job.
 *
 * Lifecycle
 * ---------
 *  1. `schedule({ at, ready, conflicts })` closes lanes that drained, opens
 *     lanes for the work that is waiting and dispatches ready tasks onto them,
 *     honouring two hard boundaries: the mission lane limit and write ownership.
 *  2. `settle({ taskId, outcome, at })` records what an agent run produced. A run
 *     that failed or rolled back while attempts remain goes back on its lane (a
 *     bounded retry); the last attempt settles the task for good and is reported
 *     in `ScheduleReport.failed` so a fix-up task can be materialised.
 *  3. `report()` is the per-frame readout: occupancy per lane, in-flight tasks,
 *     waiting work and completed-task throughput for the HUD and the lane
 *     visualisation.
 *
 * Invariants
 * ----------
 *  - A lane carries one active task plus up to `capacity - 1` queued tasks.
 *  - At most `laneLimit` lanes are open, and a lane holds one active task, so at
 *    most `laneLimit` tasks are in flight no matter how much work is ready.
 *  - A task is never dispatched while a task it conflicts with — flagged by the
 *    caller or through overlapping write ownership — is claimed in another lane
 *    (active or queued). It waits there until that work settles.
 *  - No DOM, timer or three.js usage: the scheduler reads a state view, emits
 *    domain events through the shared contract and reports plain snapshots.
 */

import {
  makeDomainEvent,
  type DeepReadonly,
  type DomainEvent,
  type GameState,
  type LaneKind,
} from './state';

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

/** How an agent run ends: shipped, broken, or undone and requeued. */
export type AgentOutcome = 'success' | 'failure' | 'rollback';

/** Receives every domain event the scheduler emits. `channel.emit` fits here. */
export type DispatchEventSink = (event: DomainEvent) => void;

/** A lane the mission allows the scheduler to open. */
export interface DispatchLaneInput {
  id: string;
  kind?: LaneKind;
  label?: string;
  /** Agents the lane can crew: one active task plus `capacity - 1` waiting. */
  capacity?: number;
}

/** Lanes can be declared by hand or read straight out of the state. */
export type DispatchLaneSource = GameState | DeepReadonly<GameState> | readonly DispatchLaneInput[];

/** One task the caller has proven dispatchable. */
export interface DispatchTaskInput {
  id: string;
  title?: string;
  /** Lane the task belongs to. Tasks without one take the first free lane. */
  laneId?: string;
  /** Upstream keys, carried through for the HUD and the event log. */
  dependencies?: readonly string[];
  /** Paths the task writes. Two claimants never run at the same time. */
  writeSet?: readonly string[];
  /** Paths the task only reads. Overlaps here are allowed. */
  readSet?: readonly string[];
}

/**
 * A write-ownership conflict the caller found between two tasks.
 *
 * This is the graph module's `WriteConflict` payload reduced to the two facts
 * dispatch needs: which tasks collide and on which paths. Conflict flags are
 * authoritative while the other task is claimed; overlapping `writeSet`s are
 * treated the same way, so the boundary also holds for callers that publish
 * ownership without running a conflict query.
 */
export interface DispatchConflictFlag {
  taskIds: readonly [string, string];
  paths?: readonly string[];
}

export interface DispatchSchedulerOptions {
  /** Maximum number of lanes that may be open at once. Defaults to every lane. */
  laneLimit?: number;
  /** Extra attempts a task gets before it settles as failed. Defaults to 1. */
  maxRetries?: number;
  /** Event sink. Pass `channel.emit` to feed the runtime's reducers. */
  emit?: DispatchEventSink;
}

/* -------------------------------------------------------------------------- */
/* Reports                                                                    */
/* -------------------------------------------------------------------------- */

/** Why a ready task was not dispatched this pass. */
export type LaneRefusalReason = 'write-conflict' | 'lane-limit' | 'lane-capacity';

/** Where a write-ownership boundary came from. */
export type LaneConflictSource = 'flag' | 'ownership';

/** A ready task the scheduler held back, with the reason the HUD shows. */
export interface LaneRefusal {
  taskId: string;
  laneId: string | null;
  reason: LaneRefusalReason;
  /** `flag`: the caller flagged the pair. `ownership`: their write sets overlap. */
  source: LaneConflictSource | null;
  /** Claimed tasks that hold the conflicting ownership. */
  conflictingTaskIds: readonly string[];
  /** Overlapping paths, when the refusal is ownership-driven. */
  paths: readonly string[];
  /** Complete sentence, safe to push into the event log. */
  message: string;
}

/** One task that started or queued on a lane. */
export interface LaneDispatch {
  taskId: string;
  laneId: string;
  /** True when the lane was already crewed and the task joined its queue. */
  queued: boolean;
  /** The task input the placement was made from, for the agent runtime. */
  task: DispatchTaskInput;
  message: string;
}

/** A failed or rolled-back run that was sent back to its lane. */
export interface LaneRetry {
  taskId: string;
  laneId: string;
  outcome: AgentOutcome;
  /** Attempt number that just ended. */
  attempt: number;
  maxRetries: number;
  message: string;
}

/** A task that used up its attempts and settled as failed. */
export interface LaneFailure {
  taskId: string;
  laneId: string | null;
  attempts: number;
  outcome: AgentOutcome;
  message: string;
}

/** Per-lane load, shaped for the lane visualisation. */
export interface LaneOccupancy {
  laneId: string;
  label: string;
  kind: LaneKind;
  capacity: number;
  open: boolean;
  activeTaskId: string | null;
  queuedTaskIds: readonly string[];
  /** Active plus queued tasks. */
  claimed: number;
  /** `claimed / capacity`, clamped to 0..1. */
  utilization: number;
  /** Tasks this lane shipped since the scheduler was created. */
  completed: number;
}

/** The per-frame readout the HUD and the lane view draw from. */
export interface DispatchReport {
  /** Simulated millisecond of the last scheduling pass. */
  at: number;
  laneLimit: number;
  openLaneIds: readonly string[];
  /** Tasks running right now — one per open lane, never more than `laneLimit`. */
  inFlightTaskIds: readonly string[];
  /** Queued or held tasks that are not running yet. */
  waitingTaskIds: readonly string[];
  occupancy: readonly LaneOccupancy[];
  /** Tasks shipped successfully since the scheduler was created. */
  throughput: number;
  /** Completed tasks per simulated second. */
  throughputPerSecond: number;
  failureCount: number;
  retries: number;
  /** Refusals from the most recent pass. */
  refusals: readonly LaneRefusal[];
}

/** What one `schedule()` pass changed, on top of the current readout. */
export interface ScheduleReport extends DispatchReport {
  openedLaneIds: readonly string[];
  closedLaneIds: readonly string[];
  dispatched: readonly LaneDispatch[];
  /** Retries and requeues reported since the previous pass. */
  retried: readonly LaneRetry[];
  /** Tasks that settled as failed since the previous pass. */
  failed: readonly LaneFailure[];
}

/** One scheduling pass: what is proven ready, and what the mission can run. */
export interface ScheduleInput {
  /** Simulated millisecond of this pass. */
  at: number;
  /** Tasks the caller proved dispatchable, in plan order. */
  ready: readonly DispatchTaskInput[];
  /** Write-ownership conflicts between tasks, from the graph's conflict query. */
  conflicts?: readonly DispatchConflictFlag[];
  /** Change the mission lane limit (a lane was unlocked or lost). */
  laneLimit?: number;
}

/* -------------------------------------------------------------------------- */
/* Settlements                                                                */
/* -------------------------------------------------------------------------- */

/** What one agent run produced, as reported by the agent runtime. */
export interface TaskSettlement {
  taskId: string;
  outcome: AgentOutcome;
  /** Simulated millisecond the run ended. */
  at: number;
  laneId?: string | null;
  /** Attempt number of the run that produced this outcome. */
  attempt?: number;
  /** Extra context for the event log. */
  message?: string;
}

/** The scheduler's verdict on a settled run. */
export interface SettlementDecision {
  taskId: string;
  outcome: AgentOutcome;
  /** Attempt that just ended (1-based). */
  attempt: number;
  laneId: string | null;
  /** True when the task went back on its lane for another attempt. */
  requeued: boolean;
  /** True when the task will not be attempted again. */
  terminal: boolean;
  /** True when the failure needs a fix-up task. */
  needsFixUp: boolean;
  reason: string;
}

/** Write ownership claimed by one active or queued task. */
export interface ClaimedWriteSet {
  taskId: string;
  laneId: string;
  writeSet: readonly string[];
}

/** The lane scheduler. Pure bookkeeping: it never mutates the state object. */
export interface DispatchScheduler {
  readonly laneLimit: number;
  readonly maxRetries: number;
  /** Occupancy snapshot, in lane declaration order. */
  readonly occupancy: readonly LaneOccupancy[];
  /** Change the mission lane limit. */
  setLaneLimit(limit: number): void;
  /** Run one scheduling pass over the caller's ready and conflict sets. */
  schedule(input: ScheduleInput): ScheduleReport;
  /** Record an agent outcome and decide whether the task is retried. */
  settle(settlement: TaskSettlement): SettlementDecision;
  /** Write ownership claimed by active and queued tasks. */
  claimedWriteSets(excludeTaskId?: string): readonly ClaimedWriteSet[];
  /** Close every lane (mission end, teardown or a from-scratch replay). */
  closeAll(at: number): ScheduleReport;
  /** Readout for the HUD and the lane view. Safe to call every frame. */
  report(at?: number): DispatchReport;
  reset(): void;
}

/* -------------------------------------------------------------------------- */
/* Path ownership                                                             */
/* -------------------------------------------------------------------------- */

/** Normalise a declared path: forward slashes, no `./`, no empty segments. */
export function normalizePath(path: string): string {
  let normalized = path.trim().replace(/\\/g, '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  return normalized.replace(/\/{2,}/g, '/');
}

/**
 * Do two declared paths claim the same work?
 *
 * Paths overlap when they are identical, or when one is a declared directory
 * (trailing slash) containing the other. Glob patterns are compared literally —
 * declare a directory with a trailing slash to claim everything beneath it.
 */
export function pathsConflict(left: string, right: string): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  if (a.length === 0 || b.length === 0) return false;
  return a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));
}

/** Overlapping paths between two write sets, in declaration order, deduplicated. */
export function overlappingPaths(left: readonly string[], right: readonly string[]): string[] {
  const shared: string[] = [];
  for (const a of left) {
    for (const b of right) {
      if (!pathsConflict(a, b)) continue;
      for (const path of [normalizePath(a), normalizePath(b)]) {
        if (path.length > 0 && !shared.includes(path)) shared.push(path);
      }
    }
  }
  return shared;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Extra attempts a task gets before it settles as failed. */
export const DEFAULT_MAX_RETRIES = 1;

/** Default agents a lane may crew when the declaration leaves capacity out. */
export const DEFAULT_LANE_CAPACITY = 1;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampLaneLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function timestamp(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
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

/** One lane while the scheduler is running. */
interface SchedulerLane {
  id: string;
  kind: LaneKind;
  label: string;
  capacity: number;
  activeTaskId: string | null;
  queue: string[];
  open: boolean;
  completed: number;
}

/** Everything the scheduler remembers about one task it has dispatched. */
interface TaskRecord {
  taskId: string;
  title: string;
  laneId: string;
  writeSet: string[];
  readSet: string[];
  attempts: number;
  settled: boolean;
  outcome: AgentOutcome | null;
  input: DispatchTaskInput;
}

/** Where a task can go on the floor. */
interface Placement {
  lane: SchedulerLane;
  queued?: boolean;
}

/** One ownership boundary found between a candidate and claimed work. */
interface Boundary {
  otherTaskId: string;
  paths: string[];
  flagged: boolean;
}

function cloneTaskInput(task: DispatchTaskInput): DispatchTaskInput {
  return {
    id: task.id,
    ...(task.title === undefined ? {} : { title: task.title }),
    ...(task.laneId === undefined ? {} : { laneId: task.laneId }),
    dependencies: [...(task.dependencies ?? [])],
    writeSet: [...(task.writeSet ?? [])],
    readSet: [...(task.readSet ?? [])],
  };
}

function isLaneList(source: DispatchLaneSource): source is readonly DispatchLaneInput[] {
  return Array.isArray(source);
}

/** Lanes declared by hand, normalised and deduplicated in declaration order. */
function readLaneInputs(inputs: readonly DispatchLaneInput[]): DispatchLaneInput[] {
  const declared: DispatchLaneInput[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const id = typeof input?.id === 'string' ? input.id.trim() : '';
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    declared.push({ ...input, id });
  }
  return declared;
}

/** Lanes read out of the state's lane slice, in stable registration order. */
function readLaneSlice(state: GameState | DeepReadonly<GameState>): DispatchLaneInput[] {
  const slice = state.lanes;
  const inputs: DispatchLaneInput[] = [];
  const push = (id: string): void => {
    const lane = slice.lanes[id];
    if (!lane) return;
    inputs.push({ id: lane.id, kind: lane.kind, label: lane.label, capacity: lane.capacity });
  };
  for (const id of slice.order) push(id);
  for (const id of Object.keys(slice.lanes)) {
    if (!slice.order.includes(id)) push(id);
  }
  return inputs;
}

function toSchedulerLane(input: DispatchLaneInput): SchedulerLane {
  return {
    id: input.id,
    kind: input.kind ?? 'build',
    label: input.label ?? input.id,
    capacity: Math.max(1, Math.trunc(input.capacity ?? DEFAULT_LANE_CAPACITY)),
    activeTaskId: null,
    queue: [],
    open: false,
    completed: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Scheduler                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Create a lane scheduler over a mission's lanes.
 *
 * `source` is the `GameState` (or its frozen snapshot) whose `lanes` slice
 * defines the floor, or an explicit lane list for plan-only callers. Nothing is
 * stored by reference: every structure the scheduler reports is a fresh copy, so
 * a HUD can hold on to a report without seeing it change under its feet.
 */
export function createDispatchScheduler(
  source: DispatchLaneSource,
  options: DispatchSchedulerOptions = {},
): DispatchScheduler {
  const emit: DispatchEventSink = options.emit ?? (() => undefined);

  const declared = isLaneList(source) ? readLaneInputs(source) : readLaneSlice(source);
  const lanes: SchedulerLane[] = declared.map(toSchedulerLane);
  if (lanes.length === 0) {
    lanes.push(toSchedulerLane({ id: 'lane-default', kind: 'build', label: 'Build', capacity: 1 }));
  }
  const lanesById = new Map<string, SchedulerLane>();
  for (const lane of lanes) lanesById.set(lane.id, lane);

  const records = new Map<string, TaskRecord>();
  const settledTasks = new Set<string>();
  const maxRetries = Math.max(0, Math.trunc(options.maxRetries ?? DEFAULT_MAX_RETRIES));
  let laneLimit = clampLaneLimit(options.laneLimit ?? lanes.length);
  let throughput = 0;
  let failureCount = 0;
  let retryCount = 0;
  let lastAt = 0;
  let currentRefusals: LaneRefusal[] = [];
  let pendingRetries: LaneRetry[] = [];
  let pendingFailures: LaneFailure[] = [];

  /* ---------------------------------------------------------------------- */
  /* Queries                                                                */
  /* ---------------------------------------------------------------------- */

  function openLaneCount(): number {
    let open = 0;
    for (const lane of lanes) if (lane.open) open += 1;
    return open;
  }

  function laneQueueRoom(lane: SchedulerLane): boolean {
    return lane.queue.length < Math.max(0, lane.capacity - 1);
  }

  function isClaimed(taskId: string): boolean {
    for (const lane of lanes) {
      if (lane.activeTaskId === taskId) return true;
      if (lane.queue.includes(taskId)) return true;
    }
    return false;
  }

  /** Tasks currently claimed by a lane, active first then queued, in lane order. */
  function claimedRecords(excludeTaskId?: string): TaskRecord[] {
    const claimed: TaskRecord[] = [];
    const seen = new Set<string>();
    const push = (taskId: string): void => {
      if (taskId === excludeTaskId || seen.has(taskId)) return;
      seen.add(taskId);
      const record = records.get(taskId);
      if (record && !record.settled) claimed.push(record);
    };
    for (const lane of lanes) {
      if (lane.activeTaskId !== null) push(lane.activeTaskId);
      for (const taskId of lane.queue) push(taskId);
    }
    return claimed;
  }

  function occupancyOf(lane: SchedulerLane): LaneOccupancy {
    const claimed = (lane.activeTaskId === null ? 0 : 1) + lane.queue.length;
    return {
      laneId: lane.id,
      label: lane.label,
      kind: lane.kind,
      capacity: lane.capacity,
      open: lane.open,
      activeTaskId: lane.activeTaskId,
      queuedTaskIds: [...lane.queue],
      claimed,
      utilization: round(clamp01(lane.capacity === 0 ? 0 : claimed / lane.capacity), 3),
      completed: lane.completed,
    };
  }

  function buildReport(at: number): DispatchReport {
    const openLaneIds: string[] = [];
    const inFlightTaskIds: string[] = [];
    const waiting: string[] = [];
    const occupancy: LaneOccupancy[] = [];
    for (const lane of lanes) {
      if (lane.open) openLaneIds.push(lane.id);
      if (lane.activeTaskId !== null) inFlightTaskIds.push(lane.activeTaskId);
      for (const taskId of lane.queue) waiting.push(taskId);
      occupancy.push(occupancyOf(lane));
    }
    for (const refusal of currentRefusals) waiting.push(refusal.taskId);
    const elapsed = Math.max(lastAt, 0);
    return {
      at,
      laneLimit,
      openLaneIds,
      inFlightTaskIds,
      waitingTaskIds: unique(waiting),
      occupancy,
      throughput,
      throughputPerSecond: elapsed > 0 ? round((throughput / elapsed) * 1000, 3) : 0,
      failureCount,
      retries: retryCount,
      refusals: currentRefusals.map((refusal) => ({
        ...refusal,
        conflictingTaskIds: [...refusal.conflictingTaskIds],
        paths: [...refusal.paths],
      })),
    };
  }

  function decision(
    settlement: TaskSettlement,
    attempt: number,
    laneId: string | null,
    flags: { requeued: boolean; terminal: boolean; needsFixUp: boolean; reason: string },
  ): SettlementDecision {
    return {
      taskId: settlement.taskId,
      outcome: settlement.outcome,
      attempt,
      laneId,
      requeued: flags.requeued,
      terminal: flags.terminal,
      needsFixUp: flags.needsFixUp,
      reason: flags.reason,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Mutation                                                               */
  /* ---------------------------------------------------------------------- */

  function ensureRecord(task: DispatchTaskInput, laneId: string): TaskRecord {
    const existing = records.get(task.id);
    if (existing) {
      existing.input = cloneTaskInput({
        ...existing.input,
        ...task,
        writeSet: task.writeSet ?? existing.writeSet,
        readSet: task.readSet ?? existing.readSet,
      });
      existing.laneId = laneId;
      existing.writeSet = [...(task.writeSet ?? existing.writeSet)];
      return existing;
    }
    const record: TaskRecord = {
      taskId: task.id,
      title: task.title ?? task.id,
      laneId,
      writeSet: [...(task.writeSet ?? [])],
      readSet: [...(task.readSet ?? [])],
      attempts: 0,
      settled: false,
      outcome: null,
      input: cloneTaskInput(task),
    };
    records.set(task.id, record);
    return record;
  }

  /** Send a task to work: it takes the lane's agent slot and counts an attempt. */
  function activate(lane: SchedulerLane, taskId: string, at: number, opened: string[]): LaneDispatch {
    const record = records.get(taskId) ?? ensureRecord({ id: taskId }, lane.id);
    record.attempts += 1;
    record.laneId = lane.id;
    if (!lane.open) {
      lane.open = true;
      opened.push(lane.id);
    }
    lane.activeTaskId = taskId;
    lane.queue = lane.queue.filter((id) => id !== taskId);
    emit(makeDomainEvent('lane/assigned', { laneId: lane.id, taskId }, at));
    return {
      taskId,
      laneId: lane.id,
      queued: false,
      task: cloneTaskInput(record.input),
      message: `"${taskId}" started on ${lane.label} (attempt ${record.attempts}).`,
    };
  }

  /** Free a lane slot, or drop a queued task, whichever the task holds. */
  function releaseLane(lane: SchedulerLane, taskId: string, at: number): void {
    if (lane.activeTaskId === taskId) {
      lane.activeTaskId = null;
      emit(makeDomainEvent('lane/released', { laneId: lane.id, taskId }, at));
      return;
    }
    lane.queue = lane.queue.filter((id) => id !== taskId);
  }

  /** Where may this task go? Preference, then spill, then queue. */
  function findPlacement(task: DispatchTaskInput): Placement | null {
    const preferred = task.laneId === undefined ? undefined : lanesById.get(task.laneId);
    const ordered: SchedulerLane[] = [];
    if (preferred) ordered.push(preferred);
    for (const lane of lanes) if (lane !== preferred) ordered.push(lane);

    if (preferred) {
      const slot = laneSlot(preferred);
      if (slot === 'active') return { lane: preferred };
      if (slot === 'queue') return { lane: preferred, queued: true };
    }
    // Spill into a lane that is already open and crewed by nothing.
    for (const lane of ordered) {
      if (lane === preferred) continue;
      if (lane.open && lane.activeTaskId === null && lane.queue.length === 0) return { lane };
    }
    // Then open a lane, while the mission lane limit allows it.
    for (const lane of ordered) {
      if (lane === preferred) continue;
      if (!lane.open && openLaneCount() < laneLimit) return { lane };
    }
    // Finally wait in a queue rather than block the floor.
    for (const lane of ordered) {
      if (lane === preferred) continue;
      if (lane.open && laneQueueRoom(lane)) return { lane, queued: true };
    }
    return null;
  }

  function laneSlot(lane: SchedulerLane): 'active' | 'queue' | null {
    if (lane.activeTaskId === null && lane.queue.length === 0) {
      if (!lane.open && openLaneCount() >= laneLimit) return null;
      return 'active';
    }
    if (lane.open && laneQueueRoom(lane)) return 'queue';
    return null;
  }

  /** Ownership boundaries between a candidate and the work a lane already holds. */
  function boundariesFor(task: DispatchTaskInput, flags: readonly DispatchConflictFlag[]): Boundary[] {
    const boundaries = new Map<string, Boundary>();
    const add = (otherTaskId: string, paths: readonly string[], flagged: boolean): void => {
      if (otherTaskId.length === 0 || otherTaskId === task.id || !isClaimed(otherTaskId)) return;
      const existing = boundaries.get(otherTaskId);
      if (existing) {
        existing.paths = unique([...existing.paths, ...paths]);
        existing.flagged = existing.flagged || flagged;
        return;
      }
      boundaries.set(otherTaskId, { otherTaskId, paths: unique([...paths]), flagged });
    };

    for (const flag of flags) {
      const [left, right] = flag.taskIds;
      if (left === task.id) add(right, flag.paths ?? [], true);
      else if (right === task.id) add(left, flag.paths ?? [], true);
    }

    for (const record of claimedRecords(task.id)) {
      const shared = overlappingPaths(task.writeSet ?? [], record.writeSet);
      if (shared.length > 0) add(record.taskId, shared, false);
    }

    return [...boundaries.values()];
  }

  function refusalMessage(refusal: Omit<LaneRefusal, 'message'>): string {
    if (refusal.reason === 'write-conflict') {
      const others = refusal.conflictingTaskIds.map((id) => `"${id}"`).join(', ');
      const on = refusal.paths.length > 0 ? ` on ${refusal.paths.join(', ')}` : '';
      const origin =
        refusal.source === 'flag'
          ? 'the mission graph flagged a write conflict'
          : 'their write ownership overlaps';
      return `Refused "${refusal.taskId}": ${origin} with ${others}${on}. It waits until that work settles.`;
    }
    if (refusal.reason === 'lane-limit') {
      return `Held "${refusal.taskId}": the mission lane limit of ${laneLimit} ${
        laneLimit === 1 ? 'lane is' : 'lanes are'
      } already committed.`;
    }
    const where = refusal.laneId === null ? 'every lane' : `lane "${refusal.laneId}"`;
    return `Held "${refusal.taskId}": ${where} is crewed to capacity.`;
  }

  /* ---------------------------------------------------------------------- */
  /* Public API                                                             */
  /* ---------------------------------------------------------------------- */

  function setLaneLimit(limit: number): void {
    laneLimit = clampLaneLimit(limit);
  }

  function schedule(input: ScheduleInput): ScheduleReport {
    const at = timestamp(input.at, lastAt);
    lastAt = Math.max(lastAt, at);
    if (input.laneLimit !== undefined) setLaneLimit(input.laneLimit);

    const openedLaneIds: string[] = [];
    const closedLaneIds: string[] = [];
    const dispatched: LaneDispatch[] = [];
    const refused: LaneRefusal[] = [];
    const retried = pendingRetries;
    const failed = pendingFailures;
    pendingRetries = [];
    pendingFailures = [];
    currentRefusals = refused;

    // 1. Lanes that drained close, so their slot is free for waiting work.
    for (const lane of lanes) {
      if (!lane.open) continue;
      if (lane.activeTaskId !== null || lane.queue.length > 0) continue;
      lane.open = false;
      closedLaneIds.push(lane.id);
    }

    // 2. Work already claimed on a lane — a bounded retry, or a task queued for
    //    want of an agent — starts as soon as the lane has an agent free.
    for (const lane of lanes) {
      if (lane.activeTaskId !== null) continue;
      const queued = lane.queue[0];
      if (queued === undefined) continue;
      dispatched.push(activate(lane, queued, at, openedLaneIds));
    }

    // 3. New ready work fills what is left, one task per lane and never above
    //    the mission lane limit or across a write-ownership boundary.
    const conflicts = input.conflicts ?? [];
    for (const task of input.ready) {
      const taskId = typeof task?.id === 'string' ? task.id.trim() : '';
      if (taskId.length === 0) continue;
      const candidate = taskId === task.id ? task : { ...task, id: taskId };
      if (settledTasks.has(taskId) || isClaimed(taskId)) continue;

      const boundaries = boundariesFor(candidate, conflicts);
      if (boundaries.length > 0) {
        const partial: Omit<LaneRefusal, 'message'> = {
          taskId,
          laneId: candidate.laneId ?? null,
          reason: 'write-conflict',
          source: boundaries.some((boundary) => boundary.flagged) ? 'flag' : 'ownership',
          conflictingTaskIds: boundaries.map((boundary) => boundary.otherTaskId),
          paths: unique(boundaries.flatMap((boundary) => boundary.paths)),
        };
        refused.push({ ...partial, message: refusalMessage(partial) });
        continue;
      }

      const placement = findPlacement(candidate);
      if (!placement) {
        const limited = openLaneCount() >= laneLimit && lanes.some((lane) => !lane.open);
        const partial: Omit<LaneRefusal, 'message'> = {
          taskId,
          laneId: candidate.laneId ?? null,
          reason: limited ? 'lane-limit' : 'lane-capacity',
          source: null,
          conflictingTaskIds: [],
          paths: [],
        };
        refused.push({ ...partial, message: refusalMessage(partial) });
        continue;
      }

      if (placement.queued === true) {
        const lane = placement.lane;
        const record = ensureRecord(candidate, lane.id);
        if (!lane.queue.includes(taskId)) lane.queue.push(taskId);
        emit(makeDomainEvent('lane/queued', { laneId: lane.id, taskId }, at));
        dispatched.push({
          taskId,
          laneId: lane.id,
          queued: true,
          task: cloneTaskInput(record.input),
          message: `"${taskId}" waits on ${lane.label} behind ${
            lane.activeTaskId === null ? 'the current work' : `"${lane.activeTaskId}"`
          }.`,
        });
        continue;
      }

      ensureRecord(candidate, placement.lane.id);
      dispatched.push(activate(placement.lane, taskId, at, openedLaneIds));
    }

    return {
      ...buildReport(at),
      openedLaneIds: unique(openedLaneIds),
      closedLaneIds: unique(closedLaneIds),
      dispatched,
      retried,
      failed,
    };
  }

  function settle(settlement: TaskSettlement): SettlementDecision {
    const at = timestamp(settlement.at, lastAt);
    lastAt = Math.max(lastAt, at);
    const taskId = settlement.taskId;
    const record = records.get(taskId);
    const laneId = settlement.laneId ?? record?.laneId ?? null;
    const lane = laneId === null ? undefined : lanesById.get(laneId);
    const attempts = record
      ? Math.max(1, record.attempts)
      : Math.max(1, Math.trunc(settlement.attempt ?? 1));

    if (settlement.outcome === 'success') {
      if (lane) releaseLane(lane, taskId, at);
      if (record) {
        record.settled = true;
        record.outcome = 'success';
      }
      settledTasks.add(taskId);
      throughput += 1;
      if (lane) lane.completed += 1;
      return decision(settlement, attempts, laneId, {
        requeued: false,
        terminal: true,
        needsFixUp: false,
        reason: lane
          ? `"${taskId}" shipped from ${lane.label} on attempt ${attempts}.`
          : `"${taskId}" shipped on attempt ${attempts}.`,
      });
    }

    // A failed or rolled-back run gets another attempt while attempts remain.
    if (record && !record.settled && lane && attempts <= maxRetries) {
      releaseLane(lane, taskId, at);
      if (!lane.queue.includes(taskId)) lane.queue.push(taskId);
      emit(makeDomainEvent('lane/queued', { laneId: lane.id, taskId }, at));
      retryCount += 1;
      const outcomeLabel = settlement.outcome === 'rollback' ? 'rolled back' : 'failed';
      const retry: LaneRetry = {
        taskId,
        laneId: lane.id,
        outcome: settlement.outcome,
        attempt: attempts,
        maxRetries,
        message: `"${taskId}" ${outcomeLabel} on attempt ${attempts}; requeued on ${lane.label}.`,
      };
      pendingRetries.push(retry);
      return decision(settlement, attempts, laneId, {
        requeued: true,
        terminal: false,
        needsFixUp: false,
        reason: retry.message,
      });
    }

    if (lane) releaseLane(lane, taskId, at);
    if (record) {
      record.settled = true;
      record.outcome = settlement.outcome;
    }
    settledTasks.add(taskId);
    failureCount += 1;
    const outcomeLabel = settlement.outcome === 'rollback' ? 'rolled back' : 'failed';
    const failure: LaneFailure = {
      taskId,
      laneId,
      attempts,
      outcome: settlement.outcome,
      message: `"${taskId}" ${outcomeLabel} on attempt ${attempts} of ${maxRetries + 1}; it needs a fix-up.`,
    };
    pendingFailures.push(failure);
    return decision(settlement, attempts, laneId, {
      requeued: false,
      terminal: true,
      needsFixUp: true,
      reason: failure.message,
    });
  }

  function claimedWriteSets(excludeTaskId?: string): readonly ClaimedWriteSet[] {
    return claimedRecords(excludeTaskId).map((record) => ({
      taskId: record.taskId,
      laneId: record.laneId,
      writeSet: [...record.writeSet],
    }));
  }

  function closeAll(at: number): ScheduleReport {
    const closed: string[] = [];
    const refused: LaneRefusal[] = [];
    currentRefusals = refused;
    for (const lane of lanes) {
      if (lane.activeTaskId !== null) releaseLane(lane, lane.activeTaskId, at);
      lane.queue = [];
      if (lane.open) {
        lane.open = false;
        closed.push(lane.id);
      }
    }
    return {
      ...buildReport(at),
      openedLaneIds: [],
      closedLaneIds: closed,
      dispatched: [],
      retried: [],
      failed: [],
    };
  }

  function reset(): void {
    for (const lane of lanes) {
      lane.activeTaskId = null;
      lane.queue = [];
      lane.open = false;
      lane.completed = 0;
    }
    records.clear();
    settledTasks.clear();
    currentRefusals = [];
    pendingRetries = [];
    pendingFailures = [];
    throughput = 0;
    failureCount = 0;
    retryCount = 0;
    lastAt = 0;
  }

  return {
    get laneLimit() {
      return laneLimit;
    },
    get maxRetries() {
      return maxRetries;
    },
    get occupancy() {
      return lanes.map(occupancyOf);
    },
    setLaneLimit,
    schedule,
    settle,
    claimedWriteSets,
    closeAll,
    report: (at = lastAt) => buildReport(at),
    reset,
  };
}
