/**
 * Tests for the recommendation-to-plan conversion seam:
 * {@link convertAcceptedReviewToPhase} and {@link listAcceptedReviews}.
 *
 * These tests lock in the contract that only `accepted` reviews convert to
 * phases, that conversion is deterministic, and that confidence does NOT
 * gate conversion (a low-confidence accepted recommendation still converts).
 */

import { describe, it, expect } from 'vitest';

import {
  convertAcceptedReviewToPhase,
  buildPhaseId,
  listAcceptedReviews
} from '../phases.js';
import {
  createRecommendationReview,
  transitionReview
} from '../review.js';
import { createRecommendation } from '../recommendation.js';
import { AppError } from '../city.js';
import type { Recommendation } from '../recommendation.js';
import type { RecommendationReview, ReviewStatus } from '../review.js';
import type { SuggestedImplementationSurface } from '../recommendation.js';

/**
 * Factory: build a valid, schema-versioned Recommendation. Mirrors the
 * `validRecommendation` helper used by the other domain test files so the
 * `schemaVersion: '1'` stamp is always applied via `createRecommendation`.
 */
function validRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return createRecommendation({
    id: overrides.id ?? 'rec_1',
    opportunityId: overrides.opportunityId ?? 'opp_42_0_0',
    evidence: overrides.evidence ?? [{ source: 'metric', ref: 'safety', weight: 0.8 }],
    score: overrides.score ?? 0.7,
    confidence: overrides.confidence ?? 0.6,
    surfaces: overrides.surfaces ?? ['plan', 'task'],
    rationale: overrides.rationale ?? 'improve crossing safety',
    createdAtTick: overrides.createdAtTick ?? 3
  });
}

/**
 * Factory: build a review already in the `accepted` status wrapping a valid
 * recommendation. The review id is stable so phase ids are deterministic.
 */
function acceptedReview(
  rec: Recommendation = validRecommendation(),
  reviewId = 'rev_1'
): RecommendationReview {
  const pending = createRecommendationReview(rec, reviewId);
  return transitionReview(pending, 'accepted');
}

const VALID_KINDS: ReadonlySet<SuggestedImplementationSurface> = new Set([
  'plan',
  'task',
  'metric',
  'policy'
]);

describe('convertAcceptedReviewToPhase', () => {
  describe('accepted -> phase conversion', () => {
    it('produces a draft phase with schemaVersion 1 and a deterministic id', () => {
      const rec = validRecommendation();
      const review = acceptedReview(rec, 'rev_7');
      const seed = 42;

      const phase = convertAcceptedReviewToPhase(review, seed);

      expect(phase.status).toBe('draft');
      expect(phase.schemaVersion).toBe('1');
      expect(phase.id).toBe(buildPhaseId(seed, review.id));
      expect(phase.reviewId).toBe(review.id);
    });

    it('maps each surface to a task with a valid kind and non-empty title', () => {
      const surfaces: SuggestedImplementationSurface[] = ['plan', 'task', 'metric', 'policy'];
      const rec = validRecommendation({ surfaces });
      const review = acceptedReview(rec);

      const phase = convertAcceptedReviewToPhase(review, 1);

      expect(phase.tasks).toHaveLength(surfaces.length);
      for (const task of phase.tasks) {
        expect(VALID_KINDS.has(task.kind)).toBe(true);
        expect(task.title.trim().length).toBeGreaterThan(0);
      }
    });

    it('chains tasks: first has no deps, each subsequent depends on the previous', () => {
      const rec = validRecommendation({ surfaces: ['plan', 'task', 'metric'] });
      const review = acceptedReview(rec);

      const phase = convertAcceptedReviewToPhase(review, 1);

      expect(phase.tasks).toHaveLength(3);
      // First task: no intra-phase dependencies.
      expect(phase.tasks[0]?.dependsOn).toEqual([]);
      // Each subsequent task depends on the immediately preceding task id.
      for (let i = 1; i < phase.tasks.length; i++) {
        const prev = phase.tasks[i - 1];
        const curr = phase.tasks[i];
        expect(prev).toBeDefined();
        expect(curr).toBeDefined();
        expect(curr?.dependsOn).toEqual([prev?.id]);
      }
    });

    it('appends a phase-completion review step with passed=false', () => {
      const review = acceptedReview();

      const phase = convertAcceptedReviewToPhase(review, 1);

      const completion = phase.reviewSteps.find((s) => s.focus === 'phase-completion');
      expect(completion).toBeDefined();
      expect(completion?.passed).toBe(false);
    });

    it('propagates createdAtTick and opportunityId from the recommendation', () => {
      const rec = validRecommendation({
        opportunityId: 'opp_99_1_2',
        createdAtTick: 17
      });
      const review = acceptedReview(rec);

      const phase = convertAcceptedReviewToPhase(review, 1);

      expect(phase.createdAtTick).toBe(rec.createdAtTick);
      expect(phase.opportunityId).toBe(rec.opportunityId);
      expect(phase.recommendationId).toBe(rec.id);
    });

    it('is deterministic: same inputs yield deep-equal phases', () => {
      const rec = validRecommendation({ surfaces: ['plan', 'task', 'policy'] });
      const review = acceptedReview(rec, 'rev_det');

      const a = convertAcceptedReviewToPhase(review, 7);
      const b = convertAcceptedReviewToPhase(review, 7);

      expect(a).toEqual(b);
    });
  });

  describe('non-accepted statuses throw INVALID_REVIEW_STATUS', () => {
    const nonAccepted: ReadonlyArray<ReviewStatus> = [
      'pending',
      'rejected',
      'refined',
      'superseded'
    ];

    for (const status of nonAccepted) {
      it(`throws when review status is ${status}`, () => {
        const rec = validRecommendation();
        const review = createRecommendationReview(rec, 'rev_status');
        // Drive the review into the target status via legal transitions.
        // `pending` needs no transition; `refined`/`rejected` are reachable
        // from pending; `superseded` is set directly (terminal, bypassing
        // the transition guard which would otherwise reject it).
        const prepared: RecommendationReview =
          status === 'pending'
            ? review
            : status === 'superseded'
              ? { ...review, status: 'superseded' }
              : transitionReview(review, status);

        try {
          convertAcceptedReviewToPhase(prepared, 1);
          throw new Error(`should have thrown for status ${status}`);
        } catch (e) {
          expect(e).toBeInstanceOf(AppError);
          expect((e as AppError).code).toBe('INVALID_REVIEW_STATUS');
        }
      });
    }
  });

  describe('low-confidence accepted recommendations', () => {
    it('converts a confidence=0 accepted recommendation without error', () => {
      const rec = validRecommendation({ confidence: 0 });
      const review = acceptedReview(rec, 'rev_low_conf');

      const phase = convertAcceptedReviewToPhase(review, 1);

      // Conversion succeeds and yields a well-formed draft phase. Confidence
      // is intentionally NOT propagated into the phase, so it is not asserted.
      expect(phase.status).toBe('draft');
      expect(phase.schemaVersion).toBe('1');
      expect(phase.tasks.length).toBe(rec.surfaces.length);
    });

    it('converts a score=0 boundary-case accepted recommendation without error', () => {
      const rec = validRecommendation({ score: 0, confidence: 0 });
      const review = acceptedReview(rec, 'rev_zero_score');

      const phase = convertAcceptedReviewToPhase(review, 1);

      expect(phase.status).toBe('draft');
      expect(phase.opportunityId).toBe(rec.opportunityId);
    });
  });
});

describe('listAcceptedReviews', () => {
  it('returns only accepted reviews in insertion order', () => {
    const base = validRecommendation();
    const r1 = createRecommendationReview(base, 'rev_1'); // pending
    const r2 = acceptedReview(base, 'rev_2'); // accepted
    const r3 = transitionReview(createRecommendationReview(base, 'rev_3'), 'refined'); // refined
    const r4 = transitionReview(createRecommendationReview(base, 'rev_4'), 'rejected'); // rejected
    const r5: RecommendationReview = { ...createRecommendationReview(base, 'rev_5'), status: 'superseded' }; // superseded
    const r6 = acceptedReview(base, 'rev_6'); // accepted

    const reviews: RecommendationReview[] = [r1, r2, r3, r4, r5, r6];

    const accepted = listAcceptedReviews(reviews);

    expect(accepted.map((r) => r.id)).toEqual(['rev_2', 'rev_6']);
  });

  it('returns an empty array when given no reviews', () => {
    expect(listAcceptedReviews([])).toEqual([]);
  });

  it('returns an empty array when no reviews are accepted', () => {
    const base = validRecommendation();
    const pending = createRecommendationReview(base, 'rev_1');
    const rejected = transitionReview(createRecommendationReview(base, 'rev_2'), 'rejected');

    expect(listAcceptedReviews([pending, rejected])).toEqual([]);
  });
});
