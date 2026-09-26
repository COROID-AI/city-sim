/**
 * Verification gates, repair objectives and criterion lifecycles.
 *
 * This module owns the rules that decide whether work produced by the factory
 * may be trusted. It performs no I/O: callers declare the checks a task must
 * satisfy (`build`, `typecheck`, `test`, `composition`) and hand in the
 * outcomes their own runners collected. `runVerificationGate` evaluates those
 * inputs against the shared `GameState` plan graph and returns
 *
 *  - the next `VerificationLedger` (checks, outcomes, repair objectives, criteria),
 *  - the domain events describing what changed, and
 *  - the reduced `GameState` plus a compact report for the inspector panel and
 *    the event log.
 *
 * The rules encoded here mirror Coroid's verification policy:
 *
 *  1. A task whose declared checks fail keeps every dependent task `blocked`;
 *     dependents become dispatchable again only once the failing check passes.
 *  2. Every failing check opens exactly one repair objective citing the check id
 *     and its target file. The objective closes only when *that* check passes;
 *     a regression reopens the same objective instead of duplicating it.
 *  3. Evidence is compared by strength: a command-only check can never satisfy a
 *     browser, visual or screenshot criterion, and the mismatch is reported.
 *  4. Criteria move milestone -> final_invariant -> superseded. Superseding needs
 *     a replacement criterion key inside the same task, and only satisfied final
 *     invariants count toward release.
 *
 * Determinism: identical `(state, ledger, input)` triples always produce
 * identical results, results depend on nothing but their arguments (no timers,
 * DOM or three.js), and the caller's objects are never mutated.
 */

import {
  applyDomainEvents,
  makeDomainEvent,
  type DomainEvent,
  type GameState,
  type PlanTaskState,
  type TaskStatus,
} from './state';

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/** The kinds of check a task can declare. */
export type CheckKind = 'build' | 'typecheck' | 'test' | 'composition';

/** Outcome of one check; `pending` means no runner has reported yet. */
export type CheckStatus = 'passed' | 'failed' | 'pending';

/** How a check proves its assertion. */
export type EvidenceKind = 'command' | 'browser' | 'visual' | 'screenshot';

/** Lifecycle of a criterion: draft milestone, release invariant, or replaced. */
export type CriterionLifecycle = 'milestone' | 'final_invariant' | 'superseded';

/** Lane the gate reports its runs against in the shared verification slice. */
export const VERIFICATION_LANE_ID = 'lane-verify';

/**
 * Relative strength of an evidence kind. `command` proves only that a process
 * exited successfully; browser, visual and screenshot evidence prove something
 * about what a person actually sees. A stronger kind satisfies a weaker
 * requirement (a screenshot is visual evidence), never the other way round.
 */
const EVIDENCE_STRENGTH: Record<EvidenceKind, number> = {
  command: 0,
  browser: 1,
  visual: 2,
  screenshot: 3,
};

/** Evidence a check kind produces unless the declaration says otherwise. */
export const DEFAULT_CHECK_EVIDENCE: Record<CheckKind, EvidenceKind> = {
  build: 'command',
  typecheck: 'command',
  test: 'command',
  // Composition checks exercise the assembled application, so they may
  // legitimately claim browser/visual/screenshot evidence — but a plain
  // `command` run is still the default.
  composition: 'command',
};

/** Evidence kinds a check kind is allowed to claim at all. */
export const ALLOWED_CHECK_EVIDENCE: Record<CheckKind, readonly EvidenceKind[]> = {
  build: ['command'],
  typecheck: ['command'],
  test: ['command'],
  composition: ['command', 'browser', 'visual', 'screenshot'],
};

/** True when `provided` evidence is strong enough to satisfy `required`. */
export function evidenceSatisfies(required: EvidenceKind, provided: EvidenceKind): boolean {
  return EVIDENCE_STRENGTH[provided] >= EVIDENCE_STRENGTH[required];
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

/** A check a task declares; the outcome arrives separately from its runner. */
export interface CheckDeclaration {
  id: string;
  taskId: string;
  kind: CheckKind;
  /** What going green means, in reviewer language. */
  assertion: string;
  /** File the repair objective points at when this check fails. */
  targetFile: string;
  /** Evidence the check produces. Defaults to `DEFAULT_CHECK_EVIDENCE[kind]`. */
  evidence?: EvidenceKind;
  /** Criterion this check is offered as evidence for, if any. */
  criterionKey?: string | null;
  /** Simulated time budget the runner was given. */
  timeoutMs?: number;
}

/** A declaration with its defaults resolved; this is what the ledger stores. */
export interface ResolvedCheck {
  id: string;
  taskId: string;
  kind: CheckKind;
  assertion: string;
  targetFile: string;
  evidence: EvidenceKind;
  criterionKey: string | null;
  timeoutMs: number | null;
}

/** The latest outcome reported for a check. */
export interface CheckOutcome {
  checkId: string;
  status: 'passed' | 'failed';
  /** Runner detail (error code, failing test name, log tail). */
  detail?: string;
  /** Simulated millisecond the runner finished; defaults to the gate run time. */
  atMs?: number;
}

/* -------------------------------------------------------------------------- */
/* Repair objectives and criteria                                             */
/* -------------------------------------------------------------------------- */

/**
 * Work item opened by a failing check. Exactly one objective exists per check:
 * it stays open while the check fails and closes when the check passes.
 */
export interface RepairObjective {
  id: string;
  checkId: string;
  taskId: string;
  targetFile: string;
  assertion: string;
  status: 'open' | 'closed';
  openedAtMs: number;
  closedAtMs: number | null;
}

/** A criterion a task must satisfy; promotion/supersession are explicit transitions. */
export interface CriterionDeclaration {
  key: string;
  taskId: string;
  label: string;
  /** Evidence a check must provide to satisfy this criterion. */
  requiredEvidence: EvidenceKind;
  /** Starting lifecycle. Defaults to `'milestone'`. */
  lifecycle?: CriterionLifecycle;
}

/** Stored criterion, including the checks that currently satisfy it. */
export interface CriterionRecord {
  key: string;
  taskId: string;
  label: string;
  lifecycle: CriterionLifecycle;
  requiredEvidence: EvidenceKind;
  /** Replacement criterion key; only set once the criterion is superseded. */
  replacedBy: string | null;
  /** Passing checks in the same task whose evidence satisfies the criterion. */
  satisfiedByCheckIds: string[];
}

/**
 * The verification module's own memory. It is a plain value: functions below
 * take a ledger and return a new one, so a caller can snapshot, diff or replay it.
 */
export interface VerificationLedger {
  checks: Record<string, ResolvedCheck>;
  /** Check ids in declaration order (deterministic report ordering). */
  checkOrder: string[];
  outcomes: Record<string, CheckOutcome>;
  repairs: Record<string, RepairObjective>;
  /** Check ids that have (or had) a repair objective, in first-open order. */
  repairOrder: string[];
  criteria: Record<string, CriterionRecord>;
  criterionOrder: string[];
  /** Outcomes handed in for checks that were never declared. */
  unmatchedOutcomeIds: string[];
}

/** Empty ledger; the starting point for a mission's verification history. */
export function createVerificationLedger(): VerificationLedger {
  return {
    checks: {},
    checkOrder: [],
    outcomes: {},
    repairs: {},
    repairOrder: [],
    criteria: {},
    criterionOrder: [],
    unmatchedOutcomeIds: [],
  };
}

/** Deterministic id for the single repair objective owned by a check. */
export function repairObjectiveId(checkId: string): string {
  return `repair-${checkId}`;
}

/* -------------------------------------------------------------------------- */
/* Ledger operations                                                          */
/* -------------------------------------------------------------------------- */

function resolveCheck(declaration: CheckDeclaration): ResolvedCheck {
  return {
    id: declaration.id,
    taskId: declaration.taskId,
    kind: declaration.kind,
    assertion: declaration.assertion,
    targetFile: declaration.targetFile,
    evidence: declaration.evidence ?? DEFAULT_CHECK_EVIDENCE[declaration.kind],
    criterionKey: declaration.criterionKey ?? null,
    timeoutMs: declaration.timeoutMs ?? null,
  };
}

/**
 * Register check declarations. Registration is idempotent: the first
 * declaration wins, so replaying the same check set never reshuffles the ledger.
 * Returns the input ledger unchanged when nothing new was added.
 */
export function registerChecks(
  ledger: VerificationLedger,
  declarations: readonly CheckDeclaration[],
): VerificationLedger {
  const checks = { ...ledger.checks };
  const checkOrder = [...ledger.checkOrder];
  let added = false;

  for (const declaration of declarations) {
    if (checks[declaration.id]) continue;
    checks[declaration.id] = resolveCheck(declaration);
    checkOrder.push(declaration.id);
    added = true;
  }

  return added ? { ...ledger, checks, checkOrder } : ledger;
}

/** Record the latest outcome per check. Unknown check ids are surfaced, not dropped. */
export function recordCheckOutcomes(
  ledger: VerificationLedger,
  outcomes: readonly CheckOutcome[],
): VerificationLedger {
  if (outcomes.length === 0) return ledger;

  const recorded: Record<string, CheckOutcome> = { ...ledger.outcomes };
  const unmatched = new Set(ledger.unmatchedOutcomeIds);

  for (const outcome of outcomes) {
    if (!ledger.checks[outcome.checkId]) {
      unmatched.add(outcome.checkId);
      continue;
    }
    recorded[outcome.checkId] = { ...outcome };
  }

  return { ...ledger, outcomes: recorded, unmatchedOutcomeIds: [...unmatched] };
}

/** Register criteria. Also idempotent: an existing key keeps its lifecycle. */
export function registerCriteria(
  ledger: VerificationLedger,
  declarations: readonly CriterionDeclaration[],
): VerificationLedger {
  const criteria = { ...ledger.criteria };
  const criterionOrder = [...ledger.criterionOrder];
  let added = false;

  for (const declaration of declarations) {
    if (criteria[declaration.key]) continue;
    criteria[declaration.key] = {
      key: declaration.key,
      taskId: declaration.taskId,
      label: declaration.label,
      lifecycle: declaration.lifecycle ?? 'milestone',
      requiredEvidence: declaration.requiredEvidence,
      replacedBy: null,
      satisfiedByCheckIds: [],
    };
    criterionOrder.push(declaration.key);
    added = true;
  }

  return added ? { ...ledger, criteria, criterionOrder } : ledger;
}

/** Result of a criterion lifecycle transition. */
export interface CriterionTransitionResult {
  ok: boolean;
  errors: string[];
  ledger: VerificationLedger;
  criterion: CriterionRecord | null;
}

function criterionFailure(ledger: VerificationLedger, message: string): CriterionTransitionResult {
  return { ok: false, errors: [message], ledger, criterion: null };
}

/**
 * Milestone -> final invariant. Only final invariants are counted by
 * `evaluateReleaseReadiness`, so promotion is the act of declaring a criterion
 * release blocking.
 */
export function promoteCriterion(
  ledger: VerificationLedger,
  criterionKey: string,
): CriterionTransitionResult {
  const criterion = ledger.criteria[criterionKey];
  if (!criterion) return criterionFailure(ledger, `unknown criterion: ${criterionKey}`);
  if (criterion.lifecycle === 'superseded') {
    return criterionFailure(ledger, `criterion ${criterionKey} is superseded and cannot be promoted`);
  }
  if (criterion.lifecycle === 'final_invariant') {
    return criterionFailure(ledger, `criterion ${criterionKey} is already a final invariant`);
  }

  const updated: CriterionRecord = { ...criterion, lifecycle: 'final_invariant' };
  return {
    ok: true,
    errors: [],
    ledger: { ...ledger, criteria: { ...ledger.criteria, [criterionKey]: updated } },
    criterion: updated,
  };
}

/**
 * Any lifecycle -> superseded. Superseding is only legal when a live
 * replacement criterion exists in the same task, which is what keeps a mission
 * from quietly dropping a commitment.
 */
export function supersedeCriterion(
  ledger: VerificationLedger,
  criterionKey: string,
  replacementKey: string,
): CriterionTransitionResult {
  const criterion = ledger.criteria[criterionKey];
  if (!criterion) return criterionFailure(ledger, `unknown criterion: ${criterionKey}`);
  if (criterion.lifecycle === 'superseded') {
    return criterionFailure(ledger, `criterion ${criterionKey} is already superseded`);
  }
  if (criterionKey === replacementKey) {
    return criterionFailure(ledger, `criterion ${criterionKey} cannot supersede itself`);
  }

  const replacement = ledger.criteria[replacementKey];
  if (!replacement) {
    return criterionFailure(
      ledger,
      `superseded criterion ${criterionKey} requires a replacement criterion; ${replacementKey} is not registered`,
    );
  }
  if (replacement.taskId !== criterion.taskId) {
    return criterionFailure(
      ledger,
      `replacement ${replacementKey} must belong to the same task (${criterion.taskId}) as ${criterionKey}`,
    );
  }
  if (replacement.lifecycle === 'superseded') {
    return criterionFailure(ledger, `replacement ${replacementKey} is itself superseded`);
  }

  const updated: CriterionRecord = {
    ...criterion,
    lifecycle: 'superseded',
    replacedBy: replacementKey,
  };
  return {
    ok: true,
    errors: [],
    ledger: { ...ledger, criteria: { ...ledger.criteria, [criterionKey]: updated } },
    criterion: updated,
  };
}

/* -------------------------------------------------------------------------- */
/* Evidence rules                                                             */
/* -------------------------------------------------------------------------- */

/** Why a check was rejected as evidence. */
export type EvidenceMismatchCode =
  | 'command-only-evidence'
  | 'insufficient-evidence'
  | 'check-kind-evidence'
  | 'missing-criterion'
  | 'cross-task-criterion';

/** A rejected evidence offer, reported to the inspector panel and event log. */
export interface EvidenceMismatch {
  code: EvidenceMismatchCode;
  checkId: string;
  taskId: string;
  criterionKey: string | null;
  required: EvidenceKind | null;
  provided: EvidenceKind;
  message: string;
}

/**
 * Every check that cannot stand as evidence for the criterion it names — most
 * importantly a command-only check offered for a browser, visual or screenshot
 * criterion. Ordered by check declaration order so runs are comparable.
 */
export function collectEvidenceMismatches(ledger: VerificationLedger): EvidenceMismatch[] {
  const mismatches: EvidenceMismatch[] = [];

  for (const checkId of ledger.checkOrder) {
    const check = ledger.checks[checkId];
    if (!check) continue;

    if (!ALLOWED_CHECK_EVIDENCE[check.kind].includes(check.evidence)) {
      mismatches.push({
        code: 'check-kind-evidence',
        checkId: check.id,
        taskId: check.taskId,
        criterionKey: check.criterionKey,
        required: null,
        provided: check.evidence,
        message: `a ${check.kind} check cannot claim ${check.evidence} evidence`,
      });
    }

    if (!check.criterionKey) continue;
    const criterion = ledger.criteria[check.criterionKey];
    if (!criterion) {
      mismatches.push({
        code: 'missing-criterion',
        checkId: check.id,
        taskId: check.taskId,
        criterionKey: check.criterionKey,
        required: null,
        provided: check.evidence,
        message: `criterion ${check.criterionKey} is not registered`,
      });
      continue;
    }
    if (criterion.taskId !== check.taskId) {
      mismatches.push({
        code: 'cross-task-criterion',
        checkId: check.id,
        taskId: check.taskId,
        criterionKey: criterion.key,
        required: criterion.requiredEvidence,
        provided: check.evidence,
        message: `criterion ${criterion.key} lives in task ${criterion.taskId}, not ${check.taskId}`,
      });
      continue;
    }
    if (evidenceSatisfies(criterion.requiredEvidence, check.evidence)) continue;

    const commandOnly = check.evidence === 'command';
    mismatches.push({
      code: commandOnly ? 'command-only-evidence' : 'insufficient-evidence',
      checkId: check.id,
      taskId: check.taskId,
      criterionKey: criterion.key,
      required: criterion.requiredEvidence,
      provided: check.evidence,
      message: commandOnly
        ? `a command-only ${check.kind} check cannot satisfy the ${criterion.requiredEvidence} criterion ${criterion.key}`
        : `${check.evidence} evidence is weaker than the ${criterion.requiredEvidence} criterion ${criterion.key} requires`,
    });
  }

  return mismatches;
}

/** Passing checks that legitimately evidence a criterion inside its own task. */
function satisfyingCheckIds(
  criterion: CriterionRecord,
  ledger: VerificationLedger,
): string[] {
  const satisfied: string[] = [];

  for (const checkId of ledger.checkOrder) {
    const check = ledger.checks[checkId];
    if (!check || check.taskId !== criterion.taskId) continue;
    const outcome = ledger.outcomes[check.id];
    if (!outcome || outcome.status !== 'passed') continue;
    if (!ALLOWED_CHECK_EVIDENCE[check.kind].includes(check.evidence)) continue;
    if (!evidenceSatisfies(criterion.requiredEvidence, check.evidence)) continue;
    satisfied.push(check.id);
  }

  return satisfied;
}

/* -------------------------------------------------------------------------- */
/* Release readiness                                                          */
/* -------------------------------------------------------------------------- */

/** Which criteria stand between the mission and release. */
export interface ReleaseReadiness {
  /**
   * Ready only when at least one final invariant has been declared and every
   * final invariant is satisfied. Milestones and superseded criteria never
   * count, so `ready` also reports the case "nothing has been promoted yet".
   */
  ready: boolean;
  finalInvariantKeys: string[];
  satisfiedKeys: string[];
  unmetKeys: string[];
  supersededKeys: string[];
}

/** Evaluate release readiness from final invariants only. */
export function evaluateReleaseReadiness(ledger: VerificationLedger): ReleaseReadiness {
  const finalInvariantKeys: string[] = [];
  const satisfiedKeys: string[] = [];
  const unmetKeys: string[] = [];
  const supersededKeys: string[] = [];

  for (const key of ledger.criterionOrder) {
    const criterion = ledger.criteria[key];
    if (!criterion) continue;
    if (criterion.lifecycle === 'superseded') {
      supersededKeys.push(key);
      continue;
    }
    if (criterion.lifecycle !== 'final_invariant') continue; // milestones are drafts
    finalInvariantKeys.push(key);
    if (satisfyingCheckIds(criterion, ledger).length > 0) satisfiedKeys.push(key);
    else unmetKeys.push(key);
  }

  return {
    ready: finalInvariantKeys.length > 0 && unmetKeys.length === 0,
    finalInvariantKeys,
    satisfiedKeys,
    unmetKeys,
    supersededKeys,
  };
}

/* -------------------------------------------------------------------------- */
/* Task gating                                                                */
/* -------------------------------------------------------------------------- */

function groupChecksByTask(ledger: VerificationLedger): Record<string, ResolvedCheck[]> {
  const grouped: Record<string, ResolvedCheck[]> = {};

  for (const checkId of ledger.checkOrder) {
    const check = ledger.checks[checkId];
    if (!check) continue;
    const bucket = grouped[check.taskId];
    if (bucket) bucket.push(check);
    else grouped[check.taskId] = [check];
  }

  return grouped;
}

function checksForTask(ledger: VerificationLedger, taskId: string): ResolvedCheck[] {
  return ledger.checkOrder.flatMap((checkId) => {
    const check = ledger.checks[checkId];
    return check && check.taskId === taskId ? [check] : [];
  });
}

/**
 * Gate status of a task from its declared checks.
 *
 * A task that declares no checks keeps the plan's own lifecycle — except
 * `blocked`, which is *derived* by the gate (see `computeGateStatuses`) and is
 * therefore reinterpreted instead of trusted, so a task unblocks once its
 * upstream checks go green.
 */
function evaluateTaskStatus(
  task: PlanTaskState,
  checks: readonly ResolvedCheck[],
  ledger: VerificationLedger,
): TaskStatus {
  if (checks.length === 0) {
    if (task.status === 'blocked') return task.startedAtMs === null ? 'pending' : 'running';
    return task.status;
  }

  let passed = 0;
  let failed = 0;
  let unresolved = 0;

  for (const check of checks) {
    const outcome = ledger.outcomes[check.id];
    if (!outcome) {
      unresolved += 1;
      continue;
    }
    if (outcome.status === 'passed') passed += 1;
    else failed += 1;
  }

  if (failed > 0) return 'failed';
  if (unresolved === 0 && passed === checks.length) return 'passed';
  return passed > 0 ? 'running' : 'pending';
}

/**
 * Gate status per plan task. Failing checks block the task itself and every
 * dependent task, transitively; dependents are released as soon as the failing
 * check passes.
 */
export function resolveTaskGateStatuses(
  state: GameState,
  ledger: VerificationLedger,
): Record<string, TaskStatus> {
  const checksByTask = groupChecksByTask(ledger);
  const statuses: Record<string, TaskStatus> = {};

  for (const taskId of state.plan.order) {
    const task = state.plan.tasks[taskId];
    if (!task) continue;
    statuses[taskId] = evaluateTaskStatus(task, checksByTask[taskId] ?? [], ledger);
  }

  // Blocking is transitive over the dependency graph. The loop is bounded by the
  // task count and stops as soon as a full pass changes nothing.
  const passes = Math.max(1, state.plan.order.length);
  for (let pass = 0; pass < passes; pass += 1) {
    let changed = false;

    for (const taskId of state.plan.order) {
      const task = state.plan.tasks[taskId];
      if (!task) continue;

      const ownStatus = evaluateTaskStatus(task, checksByTask[taskId] ?? [], ledger);
      const upstreamBroken =
        ownStatus !== 'failed' &&
        task.dependencies.some((dependencyId) => {
          const dependencyStatus = statuses[dependencyId];
          return dependencyStatus === 'failed' || dependencyStatus === 'blocked';
        });
      const nextStatus: TaskStatus = upstreamBroken ? 'blocked' : ownStatus;

      if (statuses[taskId] !== nextStatus) {
        statuses[taskId] = nextStatus;
        changed = true;
      }
    }

    if (!changed) break;
  }

  return statuses;
}

function listTaskIds(
  state: GameState,
  predicate: (taskId: string) => boolean,
): string[] {
  return state.plan.order.filter((taskId) => Boolean(state.plan.tasks[taskId]) && predicate(taskId));
}

/** Task ids held `blocked` by a failing upstream check. */
export function listBlockedTaskIds(
  state: GameState,
  ledger: VerificationLedger,
): string[] {
  const statuses = resolveTaskGateStatuses(state, ledger);
  return listTaskIds(state, (taskId) => statuses[taskId] === 'blocked');
}

/** Task ids ready to be handed to a lane: open work whose upstream gates are green. */
export function listDispatchableTaskIds(
  state: GameState,
  ledger: VerificationLedger,
): string[] {
  const statuses = resolveTaskGateStatuses(state, ledger);

  return listTaskIds(state, (taskId) => {
    const task = state.plan.tasks[taskId];
    const status = statuses[taskId];
    if (!task || !status) return false;
    if (status === 'passed' || status === 'failed' || status === 'blocked') return false;
    return task.dependencies.every((dependencyId) => statuses[dependencyId] === 'passed');
  });
}

/* -------------------------------------------------------------------------- */
/* Repair objectives                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Reconcile repair objectives with the latest outcomes.
 *
 * A failed check opens its objective (or reopens it after a regression); only
 * that same check passing closes it. Objective ids are derived from the check
 * id, so a check can never accumulate duplicates.
 */
function reconcileRepairObjectives(ledger: VerificationLedger, atMs: number): VerificationLedger {
  const repairs = { ...ledger.repairs };
  const repairOrder = [...ledger.repairOrder];
  let changed = false;

  for (const checkId of ledger.checkOrder) {
    const check = ledger.checks[checkId];
    if (!check) continue;
    const outcome = ledger.outcomes[checkId];
    if (!outcome) continue;

    const existing = repairs[checkId];

    if (outcome.status === 'failed') {
      if (!existing) {
        repairs[checkId] = {
          id: repairObjectiveId(check.id),
          checkId: check.id,
          taskId: check.taskId,
          targetFile: check.targetFile,
          assertion: check.assertion,
          status: 'open',
          openedAtMs: outcome.atMs ?? atMs,
          closedAtMs: null,
        };
        repairOrder.push(check.id);
        changed = true;
      } else if (existing.status === 'closed') {
        repairs[checkId] = {
          ...existing,
          status: 'open',
          openedAtMs: outcome.atMs ?? atMs,
          closedAtMs: null,
        };
        changed = true;
      }
      continue;
    }

    // The check passed: it may close its own objective and nothing else's.
    if (existing && existing.status === 'open') {
      repairs[checkId] = {
        ...existing,
        status: 'closed',
        closedAtMs: outcome.atMs ?? atMs,
      };
      changed = true;
    }
  }

  return changed ? { ...ledger, repairs, repairOrder } : ledger;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

function coverageFor(status: CheckStatus): number {
  return status === 'passed' ? 1 : 0;
}

/**
 * Domain events that fold the gate evaluation into the shared state contract:
 * check declarations become verification gates, outcomes become gate runs, and
 * gated task statuses become plan updates.
 *
 * Gate runs are emitted only when the recorded gate would actually change, so
 * re-evaluating an unchanged check set leaves state untouched (deterministic
 * replay) while a repaired check still counts as a fresh attempt.
 */
function buildGateEvents(
  state: GameState,
  ledger: VerificationLedger,
  statuses: Record<string, TaskStatus>,
  atMs: number,
): DomainEvent[] {
  const events: DomainEvent[] = [];

  for (const checkId of ledger.checkOrder) {
    const check = ledger.checks[checkId];
    if (!check) continue;
    if (state.verification.gates[check.id]) continue;
    events.push(
      makeDomainEvent(
        'verification/gate-registered',
        {
          gate: {
            id: check.id,
            name: `${check.kind} · ${check.taskId}`,
            laneId: VERIFICATION_LANE_ID,
            status: 'pending',
            coverage: 0,
            attempts: 0,
            lastRunAtMs: null,
          },
        },
        atMs,
      ),
    );
  }

  for (const checkId of ledger.checkOrder) {
    const check = ledger.checks[checkId];
    const outcome = ledger.outcomes[checkId];
    if (!check || !outcome) continue;
    const coverage = coverageFor(outcome.status);
    const gate = state.verification.gates[check.id];
    if (gate && gate.status === outcome.status && gate.coverage === coverage) continue;
    events.push(
      makeDomainEvent(
        'verification/run',
        { gateId: check.id, status: outcome.status, coverage },
        outcome.atMs ?? atMs,
      ),
    );
  }

  for (const taskId of state.plan.order) {
    const task = state.plan.tasks[taskId];
    if (!task) continue;
    const status = statuses[taskId];
    if (!status || status === task.status) continue;
    events.push(
      makeDomainEvent(
        'plan/task-updated',
        { taskId, status, progress: status === 'passed' ? 1 : undefined },
        atMs,
      ),
    );
  }

  return events;
}

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

/** One check as the inspector panel shows it. */
export interface CheckReportEntry {
  checkId: string;
  taskId: string;
  kind: CheckKind;
  assertion: string;
  targetFile: string;
  evidence: EvidenceKind;
  timeoutMs: number | null;
  status: CheckStatus;
  detail: string | null;
}

/** Compact per-task verification summary. */
export interface TaskVerificationReport {
  taskId: string;
  title: string;
  status: TaskStatus;
  passed: CheckReportEntry[];
  failed: CheckReportEntry[];
  pending: CheckReportEntry[];
  /** Upstream tasks whose failing checks hold this task blocked. */
  blockedBy: string[];
  /** Check ids with an open repair objective. */
  openRepairCheckIds: string[];
}

/** Totals across every evaluated task. */
export interface VerificationTotals {
  checks: number;
  passed: number;
  failed: number;
  pending: number;
  openRepairs: number;
  closedRepairs: number;
  evidenceMismatches: number;
}

/** The report handed to the inspector panel and appended to the event log. */
export interface VerificationReport {
  atMs: number;
  tasks: TaskVerificationReport[];
  totals: VerificationTotals;
  evidenceMismatches: EvidenceMismatch[];
  repairObjectives: RepairObjective[];
  blockedTaskIds: string[];
  dispatchableTaskIds: string[];
  readiness: ReleaseReadiness;
  unmatchedOutcomeIds: string[];
  /** One line for the event log. */
  summary: string;
  /** Per-check log lines ready to be rendered verbatim. */
  logLines: string[];
}

function toCheckEntry(check: ResolvedCheck, ledger: VerificationLedger): CheckReportEntry {
  const outcome = ledger.outcomes[check.id];
  return {
    checkId: check.id,
    taskId: check.taskId,
    kind: check.kind,
    assertion: check.assertion,
    targetFile: check.targetFile,
    evidence: check.evidence,
    timeoutMs: check.timeoutMs,
    status: outcome ? outcome.status : 'pending',
    detail: outcome?.detail ?? null,
  };
}

function buildReport(
  state: GameState,
  ledger: VerificationLedger,
  statuses: Record<string, TaskStatus>,
  blockedTaskIds: readonly string[],
  dispatchableTaskIds: readonly string[],
  atMs: number,
): VerificationReport {
  const tasks: TaskVerificationReport[] = [];
  const logLines: string[] = [];
  let passed = 0;
  let failed = 0;
  let pending = 0;

  for (const taskId of state.plan.order) {
    const task = state.plan.tasks[taskId];
    if (!task) continue;
    const checks = checksForTask(ledger, taskId);
    if (checks.length === 0) continue; // only tasks that declared checks are "evaluated"

    const taskPassed: CheckReportEntry[] = [];
    const taskFailed: CheckReportEntry[] = [];
    const taskPending: CheckReportEntry[] = [];
    const openRepairCheckIds: string[] = [];

    for (const check of checks) {
      const entry = toCheckEntry(check, ledger);
      if (entry.status === 'passed') taskPassed.push(entry);
      else if (entry.status === 'failed') taskFailed.push(entry);
      else taskPending.push(entry);
      if (ledger.repairs[check.id]?.status === 'open') openRepairCheckIds.push(check.id);
    }

    passed += taskPassed.length;
    failed += taskFailed.length;
    pending += taskPending.length;

    const blockedBy = task.dependencies.filter((dependencyId) => {
      const dependencyStatus = statuses[dependencyId];
      return dependencyStatus === 'failed' || dependencyStatus === 'blocked';
    });
    const status = statuses[taskId] ?? task.status;

    tasks.push({
      taskId,
      title: task.title,
      status,
      passed: taskPassed,
      failed: taskFailed,
      pending: taskPending,
      blockedBy,
      openRepairCheckIds,
    });

    logLines.push(
      `[verify] ${taskId} ${status} — ${taskPassed.length}/${checks.length} checks passed` +
        (blockedBy.length > 0 ? ` (blocked by ${blockedBy.join(', ')})` : ''),
    );
    for (const entry of taskFailed) {
      logLines.push(`[repair] ${entry.checkId} ${entry.kind} failed: ${entry.assertion} → ${entry.targetFile}`);
    }
  }

  const evidenceMismatches = collectEvidenceMismatches(ledger);
  for (const mismatch of evidenceMismatches) {
    logLines.push(`[evidence] ${mismatch.checkId}: ${mismatch.message}`);
  }

  const repairObjectives = ledger.repairOrder.flatMap((checkId) => {
    const objective = ledger.repairs[checkId];
    return objective ? [{ ...objective }] : [];
  });
  const openRepairs = repairObjectives.filter((objective) => objective.status === 'open').length;

  const readiness = evaluateReleaseReadiness(ledger);
  logLines.push(
    `[release] ${readiness.ready ? 'ready' : 'not ready'} — final invariants ` +
      `${readiness.satisfiedKeys.length}/${readiness.finalInvariantKeys.length} satisfied`,
  );

  return {
    atMs,
    tasks,
    totals: {
      checks: passed + failed + pending,
      passed,
      failed,
      pending,
      openRepairs,
      closedRepairs: repairObjectives.length - openRepairs,
      evidenceMismatches: evidenceMismatches.length,
    },
    evidenceMismatches,
    repairObjectives,
    blockedTaskIds: [...blockedTaskIds],
    dispatchableTaskIds: [...dispatchableTaskIds],
    readiness,
    unmatchedOutcomeIds: [...ledger.unmatchedOutcomeIds],
    summary:
      `${tasks.length} task(s) gated: ${failed} failed, ${passed} passed, ${pending} pending; ` +
      `${openRepairs} open repair objective(s); release ${readiness.ready ? 'ready' : 'not ready'}`,
    logLines,
  };
}

/* -------------------------------------------------------------------------- */
/* Gate entry point                                                           */
/* -------------------------------------------------------------------------- */

/** Everything a gate run needs. Every field is optional; state carries the rest. */
export interface VerificationGateInput {
  /** Previous ledger. Omit to start a fresh verification history. */
  ledger?: VerificationLedger | null;
  /** Checks to declare (idempotent). */
  checks?: readonly CheckDeclaration[];
  /** Criteria to declare (idempotent; lifecycles are never reset). */
  criteria?: readonly CriterionDeclaration[];
  /** Latest outcomes from the callers' own runners. */
  outcomes?: readonly CheckOutcome[];
  /** Simulated time of this gate run. Defaults to `state.mission.elapsedMs`. */
  atMs?: number;
}

/** Result of one gate evaluation. */
export interface VerificationGateResult {
  ledger: VerificationLedger;
  report: VerificationReport;
  /** State after the emitted events are reduced; the input state is untouched. */
  state: GameState;
  events: DomainEvent[];
  blockedTaskIds: string[];
  dispatchableTaskIds: string[];
  readiness: ReleaseReadiness;
}

/**
 * Evaluate a task's declared checks and fold the result back into the mission.
 *
 * `checks` and `outcomes` are collected by the caller: this module never runs a
 * command, reads a file or touches the DOM. It decides what the outcomes mean —
 * which tasks are gated, which repair objectives open or close, which criteria
 * are satisfied — and returns the events plus reduced state that carry that
 * decision to the rest of the game.
 */
export function runVerificationGate(
  state: GameState,
  input: VerificationGateInput = {},
): VerificationGateResult {
  const atMs = input.atMs ?? state.mission.elapsedMs;

  let ledger = input.ledger ?? createVerificationLedger();
  ledger = registerChecks(ledger, input.checks ?? []);
  ledger = registerCriteria(ledger, input.criteria ?? []);
  ledger = recordCheckOutcomes(ledger, input.outcomes ?? []);
  ledger = reconcileRepairObjectives(ledger, atMs);
  ledger = refreshCriterionSatisfaction(ledger);

  const statuses = resolveTaskGateStatuses(state, ledger);
  const blockedTaskIds = listTaskIds(state, (taskId) => statuses[taskId] === 'blocked');
  const dispatchableTaskIds = listDispatchableTaskIds(state, ledger);

  const events = buildGateEvents(state, ledger, statuses, atMs);
  const nextState = events.length === 0 ? state : applyDomainEvents(state, events);
  const report = buildReport(nextState, ledger, statuses, blockedTaskIds, dispatchableTaskIds, atMs);

  return {
    ledger,
    report,
    state: nextState,
    events,
    blockedTaskIds,
    dispatchableTaskIds,
    readiness: report.readiness,
  };
}

/** Recompute which passing checks satisfy each criterion (derived, never stored by hand). */
function refreshCriterionSatisfaction(ledger: VerificationLedger): VerificationLedger {
  const criteria: Record<string, CriterionRecord> = {};

  for (const [key, criterion] of Object.entries(ledger.criteria)) {
    criteria[key] = { ...criterion, satisfiedByCheckIds: satisfyingCheckIds(criterion, ledger) };
  }

  return { ...ledger, criteria };
}
