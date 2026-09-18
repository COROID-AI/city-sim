/**
 * Coroid dependency graph: phases, cycle detection and write-conflict boundaries.
 *
 * The plan slice records *what* a mission must ship; the execution contract
 * records *which files* each task owns. This module turns both into one
 * deterministic, read-only graph:
 *
 *  - {@link buildDependencyGraph} layers tasks into phases with longest-path
 *    layering, so every task depends only on tasks in earlier phases;
 *  - cyclic `dependsOn` chains, self dependencies and unknown dependency keys
 *    never produce a malformed graph: they produce readable diagnostics and a
 *    `rejected` graph the runtime can refuse to dispatch from;
 *  - two tasks in one phase may not write the same path; every collision is
 *    reported with both task keys and the overlapping paths, which is what the
 *    player sees when a lane is refused;
 *  - {@link queryReadyTasks}, {@link queryBlockedTasks},
 *    {@link queryTaskReadiness} and {@link queryConflicts} answer dispatch
 *    questions against the completion recorded in `state.plan`.
 *
 * The module is pure and side-effect free: it reads state, never mutates it,
 * and uses no timers, randomness, DOM or rendering imports. The same inputs
 * always yield the same graph, so orchestration, the HUD and tests can call it
 * every tick.
 *
 * Path vocabulary: `dependsOn` is the graph's own name for upstream keys and
 * `dependencies` is accepted because that is the field the plan slice records.
 * Write ownership is compared after normalising separators, `./` prefixes and
 * repeated slashes; two entries overlap when they are identical or when one is
 * a declared directory (trailing slash) that contains the other. Glob patterns
 * are compared literally — declare a directory with a trailing slash to claim
 * everything beneath it.
 */

import type { DeepReadonly, GameState, PlanState, TaskStatus } from './state';

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

/** Paths a task touches while it works. Only `writeSet` is exclusive. */
export interface TaskOwnership {
  readSet?: readonly string[];
  writeSet?: readonly string[];
}

/** Ownership keyed by task id — the shape an execution contract publishes. */
export type TaskOwnershipMap = Readonly<Record<string, TaskOwnership>>;

/**
 * One task as the graph sees it.
 *
 * `title` and `laneId` are carried through for the HUD; `dependsOn` /
 * `dependencies` are merged in declaration order with duplicates removed.
 */
export interface GraphTaskInput {
  id: string;
  title?: string;
  laneId?: string;
  /** Upstream task keys this task waits for. */
  dependsOn?: readonly string[];
  /** Alias for `dependsOn`, matching the field the `plan` slice records. */
  dependencies?: readonly string[];
  /** Paths this task writes. Two tasks in one phase may never overlap here. */
  writeSet?: readonly string[];
  /** Paths this task only reads. Overlaps here are allowed and informational. */
  readSet?: readonly string[];
}

/**
 * Read-only state view. Accepts both the live `GameState` and the frozen
 * snapshot produced by `createSnapshot`.
 */
export type GraphStateView = DeepReadonly<GameState>;

/** Read-only plan-slice view. */
export type GraphPlanView = DeepReadonly<PlanState>;

/** Everything `buildDependencyGraph` can be built from. */
export type GraphSource = GraphStateView | GraphPlanView | readonly GraphTaskInput[];

/* -------------------------------------------------------------------------- */
/* Graph                                                                      */
/* -------------------------------------------------------------------------- */

/** A task inside a built graph. */
export interface DependencyGraphTask {
  id: string;
  title: string;
  laneId: string | null;
  /** Upstream keys exactly as declared, unknown keys included for diagnostics. */
  dependsOn: readonly string[];
  /** Downstream task keys in plan order. */
  dependents: readonly string[];
  /** Normalised write ownership. */
  writeSet: readonly string[];
  /** Normalised read ownership. */
  readSet: readonly string[];
  /** Zero-based phase index, or `null` when the task sits on a dependency cycle. */
  phase: number | null;
}

/** One dependency layer: every task in it depends only on earlier phases. */
export interface DependencyPhase {
  /** Zero-based phase index; phase 0 has no upstream dependencies. */
  index: number;
  /** Stable id, e.g. `phase-0`. */
  id: string;
  /** Player-facing label, e.g. `Phase 1`. */
  label: string;
  /** Task keys in plan order. */
  taskIds: readonly string[];
}

/** One closed dependency cycle found while layering. */
export interface DependencyCycle {
  /** Closed walk: the first and last entries are the same task key. */
  taskIds: readonly string[];
  /** Readable path, e.g. `task-a → task-b → task-a`. */
  path: string;
}

/** Two same-phase tasks claiming the same write path. */
export interface WriteConflict {
  /** Zero-based phase index the collision was found in. */
  phase: number;
  /** Player-facing phase label, e.g. `Phase 2`. */
  phaseLabel: string;
  /** The two colliding task keys, in plan order. */
  taskIds: readonly [string, string];
  /** The overlapping paths, in declaration order. */
  paths: readonly string[];
  /** Event-log sentence naming both tasks and every shared path. */
  message: string;
}

/** Why a graph was rejected. */
export type GraphDiagnosticCode =
  | 'invalid-task'
  | 'duplicate-task'
  | 'self-dependency'
  | 'unknown-dependency'
  | 'dependency-cycle'
  | 'write-conflict';

/** One human-readable problem found while building a graph. */
export interface GraphDiagnostic {
  code: GraphDiagnosticCode;
  severity: 'error' | 'warning';
  /** Complete sentence, safe to push straight into the event log. */
  message: string;
  /** The task keys the diagnostic is about, in plan order. */
  taskIds: readonly string[];
  /** Overlapping paths (write conflicts) or the offending dependency key. */
  paths: readonly string[];
  /** Phase the diagnostic belongs to, or `null` when it is not phase-local. */
  phase: number | null;
}

/** `accepted` graphs may be dispatched from; `rejected` graphs must not be. */
export type GraphStatus = 'accepted' | 'rejected';

/** The frozen result of {@link buildDependencyGraph}. */
export interface DependencyGraph {
  /** Plan id the graph was built from (`plan-adhoc` for raw task lists). */
  planId: string;
  status: GraphStatus;
  /** Tasks in plan order. */
  tasks: readonly DependencyGraphTask[];
  /** Same tasks keyed by id, for O(1) queries. */
  byId: Readonly<Record<string, DependencyGraphTask>>;
  /** Dependency layers in ascending order; cyclic tasks are not listed. */
  phases: readonly DependencyPhase[];
  /** Every distinct cycle found, in plan order. */
  cycles: readonly DependencyCycle[];
  /** Every same-phase write collision, ordered by phase then plan order. */
  conflicts: readonly WriteConflict[];
  /** Every problem found, in discovery order (layering, cycles, then conflicts). */
  diagnostics: readonly GraphDiagnostic[];
}

/* -------------------------------------------------------------------------- */
/* Flow queries                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Dispatch verdict for one task:
 *
 *  - `ready`    — every upstream dependency has passed and the phase is clean;
 *  - `blocked`  — unmet dependency, write conflict, cycle, failure or a
 *                 recorded block in the plan slice;
 *  - `running`  — already in flight;
 *  - `settled`  — already passed;
 *  - `unknown`  — the task is not part of the graph.
 */
export type TaskFlowState = 'ready' | 'blocked' | 'running' | 'settled' | 'unknown';

/** Answer to "can this task be dispatched right now, and if not, why not?". */
export interface TaskReadiness {
  taskId: string;
  flow: TaskFlowState;
  /** Phase index, or `null` when the task sits on a cycle or is unknown. */
  phase: number | null;
  /** Upstream keys that have not passed yet, in declaration order. */
  blockedBy: readonly string[];
  /** Declared dependencies with no task in the graph. */
  unknownDependencies: readonly string[];
  /** Paths that collide with another task in the same phase. */
  conflictPaths: readonly string[];
  /** The other task keys involved in those collisions. */
  conflictingTaskIds: readonly string[];
  /** Lifecycle status recorded in the plan slice, if the task is known there. */
  recordedStatus: TaskStatus | null;
  /** One-sentence explanation for the event log and the HUD. */
  reason: string;
}

/** One phase summarised by dispatch flow, for the HUD's phase board. */
export interface PhaseFlow {
  index: number;
  label: string;
  taskIds: readonly string[];
  ready: readonly string[];
  running: readonly string[];
  blocked: readonly string[];
  settled: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Building                                                                   */
/* -------------------------------------------------------------------------- */

/** One task while it is being layered. */
interface TaskNode {
  id: string;
  title: string;
  laneId: string | null;
  /** Declared, trimmed, deduplicated upstream keys (self references included). */
  dependsOn: string[];
  writeSet: string[];
  readSet: string[];
}

/**
 * Build the deterministic dependency graph for a plan.
 *
 * Accepts a `GameState`, its `plan` slice (live or frozen snapshot) or a raw
 * task list. `ownership` attaches write/read ownership per task key, because
 * the plan slice records dependencies but not file ownership.
 *
 * The function never throws and never mutates its input: malformed plans come
 * back as a `rejected` graph whose `diagnostics` explain exactly what is wrong.
 */
export function buildDependencyGraph(
  source: GraphSource,
  ownership: TaskOwnershipMap = {},
): DependencyGraph {
  if (isGameState(source)) return buildGraph(source.plan.id, planTasksFromState(source, ownership));
  if (isPlanView(source)) return buildGraph(source.id, planTasksFromState(source, ownership));
  return buildGraph('plan-adhoc', [...source]);
}

/**
 * Project the plan slice into graph input, attaching ownership by task key.
 * Tasks are returned in stable plan order (any task missing from `order` is
 * appended in key order) so later layering is deterministic.
 */
export function planTasksFromState(
  source: GraphStateView | GraphPlanView,
  ownership: TaskOwnershipMap = {},
): GraphTaskInput[] {
  const plan = isGameState(source) ? source.plan : source;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of plan.order) {
    if (seen.has(id) || !plan.tasks[id]) continue;
    seen.add(id);
    ids.push(id);
  }
  for (const id of Object.keys(plan.tasks)) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids.flatMap((id) => {
    const task = plan.tasks[id];
    if (!task) return [];
    const own = ownership[id];
    return [
      {
        id: task.id,
        title: task.title,
        laneId: task.laneId,
        dependsOn: [...task.dependencies],
        writeSet: own?.writeSet ? [...own.writeSet] : [],
        readSet: own?.readSet ? [...own.readSet] : [],
      },
    ];
  });
}

function isGameState(value: GraphSource): value is GraphStateView {
  return !Array.isArray(value) && 'mission' in value && 'plan' in value;
}

function isPlanView(value: GraphSource): value is GraphPlanView {
  return !Array.isArray(value) && 'tasks' in value && 'order' in value;
}

function buildGraph(planId: string, inputs: readonly GraphTaskInput[]): DependencyGraph {
  const diagnostics: GraphDiagnostic[] = [];
  const nodes = new Map<string, TaskNode>();

  for (const input of inputs) {
    if (!input || typeof input.id !== 'string') {
      diagnostics.push(
        diagnostic('invalid-task', 'Skipped a plan task without an id; every task needs a key to be layered.'),
      );
      continue;
    }
    const id = input.id.trim();
    if (id === '') {
      diagnostics.push(
        diagnostic('invalid-task', 'Skipped a plan task with a blank id; every task needs a key to be layered.'),
      );
      continue;
    }
    if (nodes.has(id)) {
      diagnostics.push(
        diagnostic('duplicate-task', `Task "${id}" was declared more than once; the first declaration was kept.`, [id]),
      );
      continue;
    }
    nodes.set(id, {
      id,
      title: input.title?.trim() || id,
      laneId: input.laneId?.trim() || null,
      dependsOn: uniqueKeys([...(input.dependsOn ?? []), ...(input.dependencies ?? [])]),
      writeSet: uniquePaths(input.writeSet ?? []),
      readSet: uniquePaths(input.readSet ?? []),
    });
  }

  const order = [...nodes.keys()];

  // Layering edges: unknown keys and self references are reported, then dropped
  // so the rest of the plan can still be layered into a usable graph.
  const edges = new Map<string, string[]>();
  for (const node of nodes.values()) {
    const known: string[] = [];
    for (const key of node.dependsOn) {
      if (key === node.id) {
        diagnostics.push(
          diagnostic(
            'self-dependency',
            `Task "${node.id}" depends on itself; the self dependency was ignored for layering.`,
            [node.id],
          ),
        );
        continue;
      }
      if (!nodes.has(key)) {
        diagnostics.push(
          diagnostic(
            'unknown-dependency',
            `Task "${node.id}" depends on unknown task "${key}"; the dependency was ignored for layering.`,
            [node.id],
            [key],
          ),
        );
        continue;
      }
      known.push(key);
    }
    edges.set(node.id, known);
  }

  const dependents = new Map<string, string[]>();
  for (const id of order) dependents.set(id, []);
  for (const id of order) {
    for (const dep of edges.get(id) ?? []) pushInto(dependents, dep, id);
  }

  const phaseOf = layerTasks(order, edges, dependents);

  // Whatever is left unlayered sits on a cycle. Walk each one in plan order and
  // report the cycle it reaches exactly once.
  const unlayered = order.filter((id) => !phaseOf.has(id));
  const unlayeredSet = new Set(unlayered);
  const cycles: DependencyCycle[] = [];
  const reported = new Set<string>();
  for (const id of unlayered) {
    const walk = extractCycle(id, edges, unlayeredSet);
    const first = walk[0];
    if (first === undefined) continue;
    const key = canonicalCycleKey(walk, order);
    if (reported.has(key)) continue;
    reported.add(key);
    const closed = [...walk, first];
    const path = closed.join(' → ');
    cycles.push({ taskIds: closed, path });
    diagnostics.push(
      diagnostic(
        'dependency-cycle',
        `Cycle detected in plan dependsOn: ${path}. Tasks on the cycle were not layered.`,
        closed,
      ),
    );
  }

  const phaseCount = phaseOf.size === 0 ? 0 : Math.max(...phaseOf.values()) + 1;
  const phases: DependencyPhase[] = [];
  for (let index = 0; index < phaseCount; index += 1) {
    phases.push({
      index,
      id: `phase-${index}`,
      label: phaseLabel(index),
      taskIds: order.filter((id) => phaseOf.get(id) === index),
    });
  }

  // Conflict boundaries: within one phase, two tasks may not claim the same path.
  const conflicts: WriteConflict[] = [];
  for (const phase of phases) {
    for (let i = 0; i < phase.taskIds.length; i += 1) {
      for (let j = i + 1; j < phase.taskIds.length; j += 1) {
        const left = nodes.get(phase.taskIds[i] ?? '');
        const right = nodes.get(phase.taskIds[j] ?? '');
        if (!left || !right) continue;
        const paths = overlappingWritePaths(left.writeSet, right.writeSet);
        if (paths.length === 0) continue;
        const message = `${phase.label} write conflict: "${left.id}" and "${right.id}" both claim ${paths.join(', ')}.`;
        const conflict: WriteConflict = {
          phase: phase.index,
          phaseLabel: phase.label,
          taskIds: [left.id, right.id],
          paths: [...paths],
          message,
        };
        Object.freeze(conflict.taskIds);
        Object.freeze(conflict.paths);
        conflicts.push(Object.freeze(conflict));
        diagnostics.push(
          diagnostic('write-conflict', message, [left.id, right.id], paths, phase.index),
        );
      }
    }
  }

  const tasks: DependencyGraphTask[] = order.flatMap((id) => {
    const node = nodes.get(id);
    if (!node) return [];
    return [
      Object.freeze({
        id: node.id,
        title: node.title,
        laneId: node.laneId,
        dependsOn: Object.freeze([...node.dependsOn]),
        dependents: Object.freeze([...(dependents.get(id) ?? [])]),
        writeSet: Object.freeze([...node.writeSet]),
        readSet: Object.freeze([...node.readSet]),
        phase: phaseOf.get(id) ?? null,
      }),
    ];
  });

  const byId: Record<string, DependencyGraphTask> = {};
  for (const task of tasks) byId[task.id] = task;

  return Object.freeze({
    planId,
    status: diagnostics.length === 0 ? 'accepted' : 'rejected',
    tasks: Object.freeze(tasks),
    byId: Object.freeze(byId),
    phases: Object.freeze(
      phases.map((phase) =>
        Object.freeze({ ...phase, taskIds: Object.freeze([...phase.taskIds]) }),
      ),
    ),
    cycles: Object.freeze(cycles.map((cycle) => Object.freeze({ ...cycle, taskIds: Object.freeze([...cycle.taskIds]) }))),
    conflicts: Object.freeze(conflicts),
    diagnostics: Object.freeze(diagnostics.map((entry) => Object.freeze({ ...entry }))),
  });
}

/**
 * Longest-path layering (Kahn in plan order).
 *
 * A task is released once every known upstream task has been released, so its
 * phase is one past the deepest upstream phase. Tasks that never reach
 * in-degree zero sit on a cycle and stay out of the returned map.
 */
function layerTasks(
  order: readonly string[],
  edges: ReadonlyMap<string, string[]>,
  dependents: ReadonlyMap<string, string[]>,
): Map<string, number> {
  const indegree = new Map<string, number>();
  for (const id of order) indegree.set(id, (edges.get(id) ?? []).length);

  const queue = order.filter((id) => indegree.get(id) === 0);
  const phaseOf = new Map<string, number>();

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    let phase = 0;
    for (const dep of edges.get(id) ?? []) {
      const depPhase = phaseOf.get(dep);
      if (depPhase !== undefined && depPhase + 1 > phase) phase = depPhase + 1;
    }
    phaseOf.set(id, phase);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }

  return phaseOf;
}

/**
 * Follow known upstream edges from `start` until a task repeats, then return
 * the repeating suffix. Deterministic because edges keep declaration order.
 */
function extractCycle(
  start: string,
  edges: ReadonlyMap<string, string[]>,
  unlayered: ReadonlySet<string>,
): string[] {
  const path: string[] = [];
  const seen = new Map<string, number>();
  let current: string | undefined = start;

  while (current !== undefined) {
    const at = seen.get(current);
    if (at !== undefined) return path.slice(at);
    seen.set(current, path.length);
    path.push(current);
    current = (edges.get(current) ?? []).find((dep) => unlayered.has(dep));
  }

  return [];
}

/** Rotate a cycle to its lowest plan-order task so duplicates collapse to one key. */
function canonicalCycleKey(cycle: readonly string[], order: readonly string[]): string {
  const indexOf = new Map(order.map((id, index) => [id, index]));
  const rank = (id: string | undefined): number => (id === undefined ? -1 : (indexOf.get(id) ?? -1));
  let best = 0;
  for (let i = 1; i < cycle.length; i += 1) {
    if (rank(cycle[i]) < rank(cycle[best])) best = i;
  }
  return [...cycle.slice(best), ...cycle.slice(0, best)].join('|');
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

/** Answer "what is this task waiting for?" against the plan slice. */
export function queryTaskReadiness(
  graph: DependencyGraph,
  state: GraphStateView,
  taskId: string,
): TaskReadiness {
  const task = graph.byId[taskId];
  const recordedStatus = state.plan.tasks[taskId]?.status ?? null;

  if (!task) {
    return readiness(taskId, 'unknown', null, [], [], [], [], recordedStatus, `Task "${taskId}" is not part of the plan graph.`);
  }

  const blocking = graph.conflicts.filter((conflict) => conflict.taskIds.includes(taskId));
  const conflictPaths = unique(blocking.flatMap((conflict) => [...conflict.paths]));
  const conflictingTaskIds = unique(
    blocking.flatMap((conflict) => conflict.taskIds.filter((id) => id !== taskId)),
  );

  const blockedBy: string[] = [];
  const unknownDependencies: string[] = [];
  for (const key of task.dependsOn) {
    if (key === task.id) continue;
    if (!graph.byId[key]) {
      unknownDependencies.push(key);
      blockedBy.push(key);
      continue;
    }
    if (state.plan.tasks[key]?.status !== 'passed') blockedBy.push(key);
  }

  const cycle = graph.cycles.find((candidate) => candidate.taskIds.slice(0, -1).includes(taskId));
  const unmet = blockedBy
    .map((key) => (unknownDependencies.includes(key) ? `${key} (no such task)` : key))
    .join(', ');

  const record = (
    flow: TaskFlowState,
    reason: string,
  ): TaskReadiness =>
    readiness(
      task.id,
      flow,
      task.phase,
      blockedBy,
      unknownDependencies,
      conflictPaths,
      conflictingTaskIds,
      recordedStatus,
      reason,
    );

  if (recordedStatus === 'passed') return record('settled', 'Already passed; nothing left to dispatch.');
  if (conflictPaths.length > 0) {
    return record(
      'blocked',
      `Refused: ${phaseLabel(task.phase)} write ownership collides with ${conflictingTaskIds
        .map((id) => `"${id}"`)
        .join(', ')} on ${conflictPaths.join(', ')}.`,
    );
  }
  if (cycle) return record('blocked', `Not dispatchable: task sits on the dependency cycle ${cycle.path}.`);
  if (recordedStatus === 'failed') {
    return record('blocked', 'Recorded as failed; repair it before it can be dispatched again.');
  }
  if (recordedStatus === 'running') return record('running', `Already running in ${phaseLabel(task.phase)}.`);
  if (blockedBy.length > 0) return record('blocked', `Blocked by unmet dependencies: ${unmet}.`);
  if (recordedStatus === 'blocked') {
    return record('blocked', 'Recorded as blocked in the plan slice; no upstream dependency is missing.');
  }
  return record('ready', `Ready to dispatch in ${phaseLabel(task.phase)}; every dependency has passed.`);
}

/** Tasks that can be dispatched right now, in plan order. */
export function queryReadyTasks(graph: DependencyGraph, state: GraphStateView): readonly TaskReadiness[] {
  return graph.tasks
    .map((task) => queryTaskReadiness(graph, state, task.id))
    .filter((entry) => entry.flow === 'ready');
}

/** Tasks that must not be dispatched right now, in plan order. */
export function queryBlockedTasks(graph: DependencyGraph, state: GraphStateView): readonly TaskReadiness[] {
  return graph.tasks
    .map((task) => queryTaskReadiness(graph, state, task.id))
    .filter((entry) => entry.flow === 'blocked');
}

/** Write conflicts, optionally only those touching one task. */
export function queryConflicts(graph: DependencyGraph, taskId?: string): readonly WriteConflict[] {
  if (taskId === undefined) return graph.conflicts;
  return graph.conflicts.filter((conflict) => conflict.taskIds.includes(taskId));
}

/** Look up one phase by index. */
export function queryPhase(graph: DependencyGraph, index: number): DependencyPhase | null {
  return graph.phases[index] ?? null;
}

/** Phase index of a task, or `null` when it is unknown or on a cycle. */
export function queryTaskPhase(graph: DependencyGraph, taskId: string): number | null {
  return graph.byId[taskId]?.phase ?? null;
}

/** Per-phase dispatch buckets, for the phase board and the flow view. */
export function queryPhaseFlow(graph: DependencyGraph, state: GraphStateView): readonly PhaseFlow[] {
  return graph.phases.map((phase) => {
    const flow = phase.taskIds.map((id) => queryTaskReadiness(graph, state, id));
    const pick = (wanted: TaskFlowState): string[] =>
      flow.filter((entry) => entry.flow === wanted).map((entry) => entry.taskId);
    return {
      index: phase.index,
      label: phase.label,
      taskIds: [...phase.taskIds],
      ready: pick('ready'),
      running: pick('running'),
      blocked: pick('blocked'),
      settled: pick('settled'),
    };
  });
}

/** One-line verdict for the event log: counts phases, cycles and conflicts. */
export function summarizeGraph(graph: DependencyGraph): string {
  if (graph.status === 'accepted') {
    return `Plan graph accepted: ${countLabel(graph.tasks.length, 'task')} in ${countLabel(graph.phases.length, 'phase')}, no write conflicts.`;
  }
  const reasons: string[] = [];
  const unknownDependencies = graph.diagnostics.filter(
    (entry) => entry.code === 'unknown-dependency',
  ).length;
  if (graph.cycles.length > 0) reasons.push(countLabel(graph.cycles.length, 'dependency cycle'));
  if (unknownDependencies > 0) reasons.push(countLabel(unknownDependencies, 'unknown dependency'));
  if (graph.conflicts.length > 0) reasons.push(countLabel(graph.conflicts.length, 'write conflict'));
  const other = graph.diagnostics.filter(
    (entry) =>
      entry.code === 'invalid-task' ||
      entry.code === 'duplicate-task' ||
      entry.code === 'self-dependency',
  ).length;
  if (other > 0) reasons.push(countLabel(other, 'malformed task'));
  return `Plan graph rejected: ${reasons.join(', ')}.`;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function readiness(
  taskId: string,
  flow: TaskFlowState,
  phase: number | null,
  blockedBy: readonly string[],
  unknownDependencies: readonly string[],
  conflictPaths: readonly string[],
  conflictingTaskIds: readonly string[],
  recordedStatus: TaskStatus | null,
  reason: string,
): TaskReadiness {
  return {
    taskId,
    flow,
    phase,
    blockedBy: [...blockedBy],
    unknownDependencies: [...unknownDependencies],
    conflictPaths: [...conflictPaths],
    conflictingTaskIds: [...conflictingTaskIds],
    recordedStatus,
    reason,
  };
}

function diagnostic(
  code: GraphDiagnosticCode,
  message: string,
  taskIds: readonly string[] = [],
  paths: readonly string[] = [],
  phase: number | null = null,
): GraphDiagnostic {
  return { code, severity: 'error', message, taskIds: [...taskIds], paths: [...paths], phase };
}

function phaseLabel(phase: number | null): string {
  return phase === null ? 'an unlayered phase' : `Phase ${phase + 1}`;
}

function countLabel(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

function unique(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) if (!result.includes(value)) result.push(value);
  return result;
}

function uniqueKeys(keys: readonly string[]): string[] {
  return unique(keys.map((key) => key.trim()).filter((key) => key !== ''));
}

/** Normalise a declared ownership path so equivalent spellings compare equal. */
function normalizeOwnershipPath(path: string): string {
  let normalized = path.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  return normalized;
}

function uniquePaths(paths: readonly string[]): string[] {
  return unique(
    paths.map((path) => normalizeOwnershipPath(path)).filter((path) => path !== ''),
  );
}

/** Two ownership entries collide when they are the same path or one contains the other. */
function ownershipPathsOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.endsWith('/') && right.startsWith(left)) return true;
  if (right.endsWith('/') && left.startsWith(right)) return true;
  return false;
}

/** The exact overlapping paths of two write sets, in declaration order. */
function overlappingWritePaths(left: readonly string[], right: readonly string[]): string[] {
  const result: string[] = [];
  for (const a of left) {
    for (const b of right) {
      if (!ownershipPathsOverlap(a, b)) continue;
      if (!result.includes(a)) result.push(a);
      if (!result.includes(b)) result.push(b);
    }
  }
  return result;
}
