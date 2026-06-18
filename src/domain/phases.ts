/**
 * Implementation phases: materializes accepted recommendation reviews into
 * concrete phases, tasks, dependencies, and review steps.
 *
 * Pure TS built only on the existing {@link AppError} / {@link RecommendationReview}
 * seams. No new runtime dependencies. Mirrors the converter + repository
 * pattern used by Recommendation / RecommendationReview.
 *
 * Conversion is a PURE function ({@link convertAcceptedReviewToPhase});
 * persistence is a separate repository call
 * ({@link InMemoryPhaseRepository.save}). This separation keeps conversion
 * idempotent and decoupled from storage.
 *
 * Lifecycle:
 *   draft -> active      (phase begins execution)
 *   active -> completed  (phase finished; terminal)
 * `draft` is the initial status. `completed` is terminal.
 */

import { AppError } from './city.js';
import type { AppErrorCode } from './city.js';
import type { SuggestedImplementationSurface } from './recommendation.js';
import type { RecommendationReview } from './review.js';

/**
 * The status of an implementation phase.
 *
 * - `draft`     — created but not yet started.
 * - `active`    — execution in progress.
 * - `completed` — finished; terminal.
 */
export type PhaseStatus = 'draft' | 'active' | 'completed';

/**
 * The kind of work a {@link PhaseTask} represents. Derived from the
 * recommendation's {@link SuggestedImplementationSurface} values.
 */
export type PhaseTaskKind =
  | 'plan'
  | 'task'
  | 'metric'
  | 'policy';

/**
 * A single concrete task within a phase. Tasks are produced from a
 * recommendation's surfaces and carry a stable id and human-readable title.
 */
export type PhaseTask = Readonly<{
  id: string;
  kind: PhaseTaskKind;
  title: string;
  /**
   * Ids of other tasks within the same phase that must complete before this
   * task can start. Empty when the task has no intra-phase dependencies.
   */
  dependsOn: ReadonlyArray<string>;
}>;

/**
 * A review step attached to a phase. Represents a checkpoint a human (or
 * automated gate) must pass before the phase can advance.
 */
export type PhaseReviewStep = Readonly<{
  id: string;
  /** What is being reviewed (e.g. 'design', 'implementation', 'metrics'). */
  focus: string;
  /** Whether the review step has been satisfied. */
  passed: boolean;
}>;

/**
 * A repository-backed implementation phase materialized from an accepted
 * recommendation review.
 *
 * `schemaVersion` is a literal so future migrations are explicit.
 */
export type ImplementationPhase = Readonly<{
  id: string;
  /** The id of the accepted review this phase was converted from. */
  reviewId: string;
  /** The id of the recommendation the review targeted. */
  recommendationId: string;
  /** The id of the opportunity the recommendation was attached to. */
  opportunityId: string;
  status: PhaseStatus;
  tasks: ReadonlyArray<PhaseTask>;
  reviewSteps: ReadonlyArray<PhaseReviewStep>;
  /** The tick at which the source recommendation was created. */
  createdAtTick: number;
  schemaVersion: '1';
}>;

const SCHEMA_VERSION = '1' as const;

/**
 * Legal phase transitions keyed by current status. `completed` is terminal
 * and has no outgoing edges.
 */
const LEGAL_PHASE_TRANSITIONS: Readonly<
  Record<PhaseStatus, ReadonlySet<PhaseStatus>>
> = {
  draft: new Set<PhaseStatus>(['active']),
  active: new Set<PhaseStatus>(['completed']),
  completed: new Set<PhaseStatus>()
};

/**
 * Maps a {@link SuggestedImplementationSurface} to the {@link PhaseTaskKind}
 * and a default task title used when materializing a phase.
 */
const SURFACE_TASK_TITLES: Readonly<
  Record<SuggestedImplementationSurface, { kind: PhaseTaskKind; title: string }>
> = Object.freeze({
  plan: { kind: 'plan', title: 'Produce implementation plan' },
  task: { kind: 'task', title: 'Execute implementation task' },
  metric: { kind: 'metric', title: 'Instrument and track metric' },
  policy: { kind: 'policy', title: 'Define and apply policy' }
});

/**
 * Validate that a phase transition from `from` to `to` is legal.
 *
 * Throws {@link AppError} with code `INVALID_PHASE_TRANSITION` on illegal
 * edges. Returns `to` unchanged on success so callers can chain.
 */
export function validatePhaseTransition(
  from: PhaseStatus,
  to: PhaseStatus
): PhaseStatus {
  if (!LEGAL_PHASE_TRANSITIONS[from]?.has(to)) {
    throw new AppError(
      'INVALID_PHASE_TRANSITION',
      `illegal phase transition: ${from} -> ${to}`
    );
  }
  return to;
}

/**
 * Runtime validation for an ImplementationPhase. Throws {@link AppError}
 * with phase-specific codes for each failure mode.
 *
 * Returns the (unchanged) phase so callers can chain.
 */
export function validatePhase(phase: ImplementationPhase): ImplementationPhase {
  if (!phase || typeof phase !== 'object') {
    throw new AppError('INVALID_PHASE', 'phase must be an object');
  }

  if (typeof phase.id !== 'string' || phase.id.trim() === '') {
    throw new AppError('INVALID_PHASE', 'id must be a non-empty string');
  }
  if (typeof phase.reviewId !== 'string' || phase.reviewId.trim() === '') {
    throw new AppError('INVALID_PHASE', 'reviewId must be a non-empty string');
  }
  if (
    typeof phase.recommendationId !== 'string' ||
    phase.recommendationId.trim() === ''
  ) {
    throw new AppError(
      'INVALID_PHASE',
      'recommendationId must be a non-empty string'
    );
  }
  if (
    typeof phase.opportunityId !== 'string' ||
    phase.opportunityId.trim() === ''
  ) {
    throw new AppError(
      'INVALID_PHASE',
      'opportunityId must be a non-empty string'
    );
  }

  if (
    phase.status !== 'draft' &&
    phase.status !== 'active' &&
    phase.status !== 'completed'
  ) {
    throw new AppError(
      'INVALID_PHASE_STATUS',
      `unknown phase status: ${String(phase.status)}`
    );
  }

  if (!Array.isArray(phase.tasks) || phase.tasks.length === 0) {
    throw new AppError('INVALID_PHASE', 'tasks must be a non-empty array');
  }

  const taskIds = new Set<string>();
  for (const task of phase.tasks) {
    if (!task || typeof task.id !== 'string' || task.id.trim() === '') {
      throw new AppError('INVALID_PHASE_TASK', 'each task requires a non-empty id');
    }
    if (taskIds.has(task.id)) {
      throw new AppError('INVALID_PHASE_TASK', `duplicate task id: ${task.id}`);
    }
    taskIds.add(task.id);

    const validKinds: ReadonlySet<PhaseTaskKind> = new Set([
      'plan',
      'task',
      'metric',
      'policy'
    ]);
    if (!validKinds.has(task.kind)) {
      throw new AppError(
        'INVALID_PHASE_TASK',
        `unknown task kind: ${String(task.kind)}`
      );
    }
    if (typeof task.title !== 'string' || task.title.trim() === '') {
      throw new AppError(
        'INVALID_PHASE_TASK',
        `task ${task.id} requires a non-empty title`
      );
    }
    if (!Array.isArray(task.dependsOn)) {
      throw new AppError(
        'INVALID_PHASE_TASK',
        `task ${task.id} dependsOn must be an array`
      );
    }
    for (const dep of task.dependsOn) {
      if (typeof dep !== 'string' || !taskIds.has(dep)) {
        throw new AppError(
          'INVALID_PHASE_TASK',
          `task ${task.id} depends on unknown task: ${String(dep)}`
        );
      }
    }
  }

  if (!Array.isArray(phase.reviewSteps)) {
    throw new AppError('INVALID_PHASE', 'reviewSteps must be an array');
  }
  const stepIds = new Set<string>();
  for (const step of phase.reviewSteps) {
    if (!step || typeof step.id !== 'string' || step.id.trim() === '') {
      throw new AppError(
        'INVALID_PHASE',
        'each review step requires a non-empty id'
      );
    }
    if (stepIds.has(step.id)) {
      throw new AppError(
        'INVALID_PHASE',
        `duplicate review step id: ${step.id}`
      );
    }
    stepIds.add(step.id);
    if (typeof step.focus !== 'string' || step.focus.trim() === '') {
      throw new AppError(
        'INVALID_PHASE',
        `review step ${step.id} requires a non-empty focus`
      );
    }
    if (typeof step.passed !== 'boolean') {
      throw new AppError(
        'INVALID_PHASE',
        `review step ${step.id} passed must be a boolean`
      );
    }
  }

  if (typeof phase.createdAtTick !== 'number' || !Number.isFinite(phase.createdAtTick)) {
    throw new AppError('INVALID_PHASE', 'createdAtTick must be a finite number');
  }

  return phase;
}

/**
 * Build a deterministic phase id: `phase_{seed}_{reviewId}`.
 *
 * Re-running conversion with the same seed and review always yields the
 * same id, making the seam reproducible and enabling idempotency checks.
 */
export function buildPhaseId(seed: number, reviewId: string): string {
  return `phase_${seed}_${reviewId}`;
}

/**
 * Construct a validated ImplementationPhase in the `draft` status.
 * Centralizes the schema version so call sites stay terse.
 */
export function createImplementationPhase(
  input: Omit<ImplementationPhase, 'status' | 'schemaVersion'> & {
    status?: PhaseStatus;
  }
): ImplementationPhase {
  const phase: ImplementationPhase = {
    ...input,
    status: input.status ?? 'draft',
    schemaVersion: SCHEMA_VERSION
  };
  return validatePhase(phase);
}

/**
 * Transition a phase to a new status, returning a new immutable phase.
 * Throws {@link AppError} (`INVALID_PHASE_TRANSITION`) on illegal edges.
 */
export function transitionPhase(
  phase: ImplementationPhase,
  to: PhaseStatus
): ImplementationPhase {
  validatePhaseTransition(phase.status, to);
  return { ...phase, status: to };
}

/**
 * Mark a {@link PhaseReviewStep} as passed (or not) by id, returning a new
 * immutable phase. Throws {@link AppError} (`PHASE_NOT_FOUND`) when the
 * step id is unknown.
 */
export function setReviewStepPassed(
  phase: ImplementationPhase,
  stepId: string,
  passed: boolean
): ImplementationPhase {
  const exists = phase.reviewSteps.some((s) => s.id === stepId);
  if (!exists) {
    throw new AppError(
      'PHASE_NOT_FOUND',
      `review step not found: ${stepId}`
    );
  }
  return {
    ...phase,
    reviewSteps: phase.reviewSteps.map((s) =>
      s.id === stepId ? { ...s, passed } : s
    )
  };
}

/**
 * Convert an accepted {@link RecommendationReview} into a draft
 * {@link ImplementationPhase}. PURE and deterministic: the same inputs
 * always produce a deep-equal phase.
 *
 * The review MUST be in the `accepted` status; otherwise an
 * {@link AppError} (`INVALID_REVIEW_STATUS`) is thrown.
 *
 * Tasks are derived from the recommendation's `surfaces`. The first surface
 * becomes the root task (no dependencies); subsequent tasks depend on the
 * immediately preceding task, forming a linear chain. A final review step
 * (`review`) is always appended.
 *
 * @param review  The accepted recommendation review to convert.
 * @param seed    The city seed used to build a deterministic phase id.
 */
export function convertAcceptedReviewToPhase(
  review: RecommendationReview,
  seed: number
): ImplementationPhase {
  if (review.status !== 'accepted') {
    throw new AppError(
      'INVALID_REVIEW_STATUS',
      `can only convert accepted reviews (got ${review.status})`
    );
  }

  const rec = review.recommendation;
  const surfaces = rec.surfaces;

  if (!Array.isArray(surfaces) || surfaces.length === 0) {
    throw new AppError(
      'INVALID_PHASE_TASK',
      'recommendation has no surfaces to map to tasks'
    );
  }

  const tasks: PhaseTask[] = [];
  let prevId: string | undefined;
  surfaces.forEach((surface: SuggestedImplementationSurface, idx: number) => {
    const mapping = SURFACE_TASK_TITLES[surface];
    if (!mapping) {
      throw new AppError(
        'INVALID_PHASE_TASK',
        `unknown surface: ${String(surface)}`
      );
    }
    const id = `task_${idx}_${mapping.kind}`;
    tasks.push({
      id,
      kind: mapping.kind,
      title: mapping.title,
      dependsOn: prevId ? [prevId] : []
    });
    prevId = id;
  });

  const reviewSteps: PhaseReviewStep[] = [
    { id: 'review', focus: 'phase-completion', passed: false }
  ];

  const id = buildPhaseId(seed, review.id);

  return createImplementationPhase({
    id,
    reviewId: review.id,
    recommendationId: rec.id,
    opportunityId: rec.opportunityId,
    tasks,
    reviewSteps,
    createdAtTick: rec.createdAtTick
  });
}

/**
 * Persistence seam for implementation phases. The in-memory implementation
 * below is the default; a real DB can drop in later without changing call
 * sites.
 */
export interface PhaseRepository {
  /**
   * Persist a phase. Throws {@link AppError} (`DUPLICATE_PHASE`) if a phase
   * with the same id already exists. Callers wanting graceful reuse should
   * check existence first via {@link get}.
   */
  save(phase: ImplementationPhase): ImplementationPhase;
  get(id: string): ImplementationPhase | undefined;
  list(): ReadonlyArray<ImplementationPhase>;
  listByStatus(status: PhaseStatus): ReadonlyArray<ImplementationPhase>;
  listByOpportunity(opportunityId: string): ReadonlyArray<ImplementationPhase>;
  delete(id: string): boolean;
}

/**
 * In-process {@link PhaseRepository} backed by a Map.
 *
 * Iteration order is deterministic: insertion order (Map guarantees).
 */
export class InMemoryPhaseRepository implements PhaseRepository {
  private readonly store: Map<string, ImplementationPhase> = new Map();

  public save(phase: ImplementationPhase): ImplementationPhase {
    validatePhase(phase);
    if (this.store.has(phase.id)) {
      throw new AppError(
        'DUPLICATE_PHASE',
        `phase already exists: ${phase.id}`
      );
    }
    this.store.set(phase.id, phase);
    return phase;
  }

  public get(id: string): ImplementationPhase | undefined {
    return this.store.get(id);
  }

  public list(): ReadonlyArray<ImplementationPhase> {
    return [...this.store.values()];
  }

  public listByStatus(status: PhaseStatus): ReadonlyArray<ImplementationPhase> {
    const out: ImplementationPhase[] = [];
    for (const phase of this.store.values()) {
      if (phase.status === status) {
        out.push(phase);
      }
    }
    return out;
  }

  public listByOpportunity(
    opportunityId: string
  ): ReadonlyArray<ImplementationPhase> {
    const out: ImplementationPhase[] = [];
    for (const phase of this.store.values()) {
      if (phase.opportunityId === opportunityId) {
        out.push(phase);
      }
    }
    return out;
  }

  public delete(id: string): boolean {
    return this.store.delete(id);
  }
}

/**
 * Helper: return all reviews in the `accepted` status, preserving insertion
 * order. Reviews that are pending / refined / rejected / superseded are
 * ignored.
 */
export function listAcceptedReviews(
  reviews: ReadonlyArray<RecommendationReview>
): RecommendationReview[] {
  const out: RecommendationReview[] = [];
  for (const review of reviews) {
    if (review.status === 'accepted') {
      out.push(review);
    }
  }
  return out;
}

// Re-export so consumers can import everything from this module.
export type { AppErrorCode };
export { AppError };
