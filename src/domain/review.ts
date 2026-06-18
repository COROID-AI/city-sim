/**
 * Recommendation review: lets a user accept, reject, or refine an
 * opportunity Recommendation before it becomes a plan task.
 *
 * Pure TS built only on the existing {@link AppError} / {@link Recommendation}
 * seams. No new runtime dependencies.
 *
 * Lifecycle:
 *   pending -> accepted   (user accepts as-is)
 *   pending -> rejected   (user rejects)
 *   pending -> refined    (user adjusts, then accepts or rejects)
 *   refined -> accepted
 *   refined -> rejected
 *   refined -> refined    (further adjustment)
 *
 * `accepted` / `rejected` are terminal. Every transition goes through
 * {@link validateReviewTransition}, which throws {@link AppError} with code
 * `INVALID_REVIEW_TRANSITION` on illegal edges.
 */

import { AppError } from './city.js';
import type { AppErrorCode } from './city.js';
import {
  createRecommendation,
  validateRecommendation
} from './recommendation.js';
import type { Recommendation } from './recommendation.js';

/**
 * The status of a recommendation review.
 *
 * - `pending`  — awaiting a user decision.
 * - `accepted` — user accepted; terminal.
 * - `rejected` — user rejected; terminal.
 * - `refined`  — user adjusted the recommendation; may be further refined,
 *                accepted, or rejected.
 * - `superseded` — invalidated because a newer analysis replaced the
 *                underlying recommendation. Terminal.
 */
export type ReviewStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'refined'
  | 'superseded';

/**
 * Optional refinement overrides applied to a Recommendation. Every field is
 * optional; only provided fields override the original.
 */
export type Refinement = Readonly<{
  score?: number;
  confidence?: number;
  rationale?: string;
}>;

/**
 * A repository-backed review of a single Recommendation.
 *
 * `decidedBy` and `note` are optional forward-compatible metadata fields
 * (reviewer identity, free-form note) that require no schema bump.
 */
export type RecommendationReview = Readonly<{
  id: string;
  recommendationId: string;
  status: ReviewStatus;
  /** The recommendation under review (possibly refined). */
  recommendation: Recommendation;
  /** Optional reviewer identity. */
  decidedBy?: string;
  /** Optional free-form note. */
  note?: string;
}>;

/**
 * Legal transitions keyed by current status. Terminal statuses
 * (`accepted`, `rejected`, `superseded`) have no outgoing edges.
 */
const LEGAL_TRANSITIONS: Readonly<Record<ReviewStatus, ReadonlySet<ReviewStatus>>> = {
  pending: new Set<ReviewStatus>(['accepted', 'rejected', 'refined']),
  refined: new Set<ReviewStatus>(['accepted', 'rejected', 'refined']),
  accepted: new Set<ReviewStatus>(),
  rejected: new Set<ReviewStatus>(),
  superseded: new Set<ReviewStatus>()
};

/**
 * Validate that a transition from `from` to `to` is legal.
 *
 * Throws {@link AppError} with code `INVALID_REVIEW_TRANSITION` on illegal
 * edges. Returns `to` unchanged on success so callers can chain.
 */
export function validateReviewTransition(
  from: ReviewStatus,
  to: ReviewStatus
): ReviewStatus {
  if (!LEGAL_TRANSITIONS[from]?.has(to)) {
    throw new AppError(
      'INVALID_REVIEW_TRANSITION',
      `illegal review transition: ${from} -> ${to}`
    );
  }
  return to;
}

/**
 * Apply a refinement to a Recommendation, producing a new validated
 * Recommendation. Uses {@link createRecommendation} as the single validation
 * seam so the result always passes {@link validateRecommendation}.
 *
 * Only provided fields override the original; unprovided fields are inherited.
 */
export function applyRefinement(
  rec: Recommendation,
  refined?: Refinement
): Recommendation {
  return createRecommendation({
    id: rec.id,
    opportunityId: rec.opportunityId,
    evidence: rec.evidence,
    score: refined?.score ?? rec.score,
    confidence: refined?.confidence ?? rec.confidence,
    surfaces: rec.surfaces,
    rationale: refined?.rationale ?? rec.rationale,
    createdAtTick: rec.createdAtTick
  });
}

/**
 * Persistence seam for recommendation reviews. The in-memory implementation
 * below is the default; a real DB can drop in later without changing call
 * sites.
 */
export interface RecommendationReviewRepository {
  save(review: RecommendationReview): RecommendationReview;
  get(id: string): RecommendationReview | undefined;
  listByStatus(status: ReviewStatus): ReadonlyArray<RecommendationReview>;
  listByRecommendation(recommendationId: string): ReadonlyArray<RecommendationReview>;
  delete(id: string): boolean;
  /**
   * Atomically invalidate all non-terminal reviews for a recommendation by
   * moving them to `superseded`. Used when a new analysis run replaces the
   * underlying recommendation. Returns the count of affected reviews.
   */
  supersedeForRecommendation(recommendationId: string): number;
}

/**
 * Helper to construct a validated review in the `pending` status.
 */
export function createRecommendationReview(
  recommendation: Recommendation,
  id: string
): RecommendationReview {
  // Ensure the underlying recommendation is valid before wrapping it.
  validateRecommendation(recommendation);

  return {
    id,
    recommendationId: recommendation.id,
    status: 'pending',
    recommendation
  };
}

/**
 * Transition a review to a new status, returning a new immutable review.
 * Throws {@link AppError} (`INVALID_REVIEW_TRANSITION`) on illegal edges.
 */
export function transitionReview(
  review: RecommendationReview,
  to: ReviewStatus,
  options?: Readonly<{ decidedBy?: string; note?: string }>
): RecommendationReview {
  validateReviewTransition(review.status, to);
  return {
    ...review,
    status: to,
    decidedBy: options?.decidedBy ?? review.decidedBy,
    note: options?.note ?? review.note
  };
}

/**
 * In-process {@link RecommendationReviewRepository} backed by a Map.
 *
 * Iteration order is deterministic: insertion order (Map guarantees).
 */
export class InMemoryRecommendationReviewRepository
  implements RecommendationReviewRepository
{
  private readonly store: Map<string, RecommendationReview> = new Map();

  public save(review: RecommendationReview): RecommendationReview {
    this.store.set(review.id, review);
    return review;
  }

  public get(id: string): RecommendationReview | undefined {
    return this.store.get(id);
  }

  public listByStatus(status: ReviewStatus): ReadonlyArray<RecommendationReview> {
    const out: RecommendationReview[] = [];
    for (const review of this.store.values()) {
      if (review.status === status) {
        out.push(review);
      }
    }
    return out;
  }

  public listByRecommendation(
    recommendationId: string
  ): ReadonlyArray<RecommendationReview> {
    const out: RecommendationReview[] = [];
    for (const review of this.store.values()) {
      if (review.recommendationId === recommendationId) {
        out.push(review);
      }
    }
    return out;
  }

  public delete(id: string): boolean {
    return this.store.delete(id);
  }

  public supersedeForRecommendation(recommendationId: string): number {
    let count = 0;
    for (const [id, review] of this.store) {
      if (
        review.recommendationId === recommendationId &&
        (review.status === 'pending' || review.status === 'refined')
      ) {
        this.store.set(id, { ...review, status: 'superseded' });
        count++;
      }
    }
    return count;
  }
}

// Re-export so consumers can import everything from this module.
export type { AppErrorCode };
export { AppError };
