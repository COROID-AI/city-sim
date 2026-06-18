import { describe, it, expect } from 'vitest';

import {
  createRecommendationReview,
  transitionReview,
  validateReviewTransition,
  applyRefinement,
  InMemoryRecommendationReviewRepository
} from '../review.js';
import { createRecommendation, validateRecommendation } from '../recommendation.js';
import { AppError } from '../city.js';
import type { Recommendation } from '../recommendation.js';

function validRecommendation(id = 'rec_1'): Recommendation {
  return createRecommendation({
    id,
    opportunityId: 'opp_42_0_0',
    evidence: [{ source: 'metric', ref: 'safety', weight: 0.8 }],
    score: 0.7,
    confidence: 0.6,
    surfaces: ['plan', 'task'],
    rationale: 'improve crossing safety',
    createdAtTick: 3
  });
}

describe('createRecommendationReview', () => {
  it('creates a pending review wrapping a valid recommendation', () => {
    const rec = validRecommendation();
    const review = createRecommendationReview(rec, 'rev_1');
    expect(review.id).toBe('rev_1');
    expect(review.status).toBe('pending');
    expect(review.recommendationId).toBe('rec_1');
    expect(review.recommendation).toEqual(rec);
  });

  it('throws when the underlying recommendation is invalid', () => {
    const bad = { ...validRecommendation(), score: 5 } as Recommendation;
    expect(() => createRecommendationReview(bad, 'rev_1')).toThrow();
  });
});

describe('validateReviewTransition', () => {
  it('allows pending -> accepted / rejected / refined', () => {
    expect(validateReviewTransition('pending', 'accepted')).toBe('accepted');
    expect(validateReviewTransition('pending', 'rejected')).toBe('rejected');
    expect(validateReviewTransition('pending', 'refined')).toBe('refined');
  });

  it('allows refined -> accepted / rejected / refined', () => {
    expect(validateReviewTransition('refined', 'accepted')).toBe('accepted');
    expect(validateReviewTransition('refined', 'rejected')).toBe('rejected');
    expect(validateReviewTransition('refined', 'refined')).toBe('refined');
  });

  it('rejects transitions from terminal statuses', () => {
    const terminals = ['accepted', 'rejected', 'superseded'] as const;
    for (const from of terminals) {
      for (const to of ['accepted', 'rejected', 'refined', 'pending'] as const) {
        try {
          validateReviewTransition(from, to);
          throw new Error(`should have thrown for ${from} -> ${to}`);
        } catch (e) {
          expect((e as AppError).code).toBe('INVALID_REVIEW_TRANSITION');
        }
      }
    }
  });

  it('rejects pending -> pending and pending -> superseded', () => {
    expect(() => validateReviewTransition('pending', 'pending')).toThrow();
    expect(() => validateReviewTransition('pending', 'superseded')).toThrow();
  });
});

describe('transitionReview', () => {
  it('returns a new review with updated status', () => {
    const review = createRecommendationReview(validRecommendation(), 'rev_1');
    const accepted = transitionReview(review, 'accepted', {
      decidedBy: 'alice',
      note: 'looks good'
    });
    expect(accepted.status).toBe('accepted');
    expect(accepted.decidedBy).toBe('alice');
    expect(accepted.note).toBe('looks good');
    // Original is unchanged (immutable).
    expect(review.status).toBe('pending');
  });

  it('throws INVALID_REVIEW_TRANSITION on illegal edges', () => {
    const review = createRecommendationReview(validRecommendation(), 'rev_1');
    const accepted = transitionReview(review, 'accepted');
    try {
      transitionReview(accepted, 'refined');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe('INVALID_REVIEW_TRANSITION');
    }
  });
});

describe('applyRefinement', () => {
  it('overrides only provided fields', () => {
    const rec = validRecommendation();
    const refined = applyRefinement(rec, { score: 0.9 });
    expect(refined.score).toBe(0.9);
    expect(refined.confidence).toBe(rec.confidence);
    expect(refined.rationale).toBe(rec.rationale);
    expect(refined.id).toBe(rec.id);
    expect(refined.schemaVersion).toBe('1');
  });

  it('produces a recommendation that passes validateRecommendation', () => {
    const rec = validRecommendation();
    const refined = applyRefinement(rec, {
      score: 0.4,
      confidence: 0.5,
      rationale: 'adjusted after review'
    });
    // Should not throw.
    expect(validateRecommendation(refined)).toBe(refined);
  });

  it('re-throws AppError when refinement produces invalid values', () => {
    const rec = validRecommendation();
    expect(() => applyRefinement(rec, { score: 5 })).toThrow();
    expect(() => applyRefinement(rec, { confidence: -1 })).toThrow();
  });

  it('returns an equivalent recommendation when no overrides given', () => {
    const rec = validRecommendation();
    const refined = applyRefinement(rec);
    expect(refined).toEqual(rec);
  });
});

describe('InMemoryRecommendationReviewRepository', () => {
  it('save / get round-trips a review', () => {
    const repo = new InMemoryRecommendationReviewRepository();
    const review = createRecommendationReview(validRecommendation(), 'rev_1');
    repo.save(review);
    expect(repo.get('rev_1')).toEqual(review);
  });

  it('get returns undefined for unknown id', () => {
    const repo = new InMemoryRecommendationReviewRepository();
    expect(repo.get('nope')).toBeUndefined();
  });

  it('listByStatus filters and preserves insertion order', () => {
    const repo = new InMemoryRecommendationReviewRepository();
    const r1 = createRecommendationReview(validRecommendation('rec_a'), 'rev_1');
    const r2 = createRecommendationReview(validRecommendation('rec_b'), 'rev_2');
    const r3 = createRecommendationReview(validRecommendation('rec_c'), 'rev_3');
    repo.save(r1);
    repo.save(r2);
    repo.save(r3);
    repo.save(transitionReview(r2, 'accepted'));

    const pending = repo.listByStatus('pending');
    expect(pending.map((r) => r.id)).toEqual(['rev_1', 'rev_3']);

    const accepted = repo.listByStatus('accepted');
    expect(accepted.map((r) => r.id)).toEqual(['rev_2']);
  });

  it('listByRecommendation filters by recommendation id', () => {
    const repo = new InMemoryRecommendationReviewRepository();
    const r1 = createRecommendationReview(validRecommendation('rec_a'), 'rev_1');
    const r2 = createRecommendationReview(validRecommendation('rec_b'), 'rev_2');
    repo.save(r1);
    repo.save(r2);

    const forA = repo.listByRecommendation('rec_a');
    expect(forA.map((r) => r.id)).toEqual(['rev_1']);
  });

  it('delete removes and returns true; false when absent', () => {
    const repo = new InMemoryRecommendationReviewRepository();
    repo.save(createRecommendationReview(validRecommendation(), 'rev_1'));
    expect(repo.delete('rev_1')).toBe(true);
    expect(repo.get('rev_1')).toBeUndefined();
    expect(repo.delete('rev_1')).toBe(false);
  });

  it('supersedeForRecommendation moves pending/refined to superseded', () => {
    const repo = new InMemoryRecommendationReviewRepository();
    const r1 = createRecommendationReview(validRecommendation('rec_a'), 'rev_1');
    const r2 = createRecommendationReview(validRecommendation('rec_a'), 'rev_2');
    const r3 = createRecommendationReview(validRecommendation('rec_b'), 'rev_3');
    repo.save(r1);
    // r2 is refined then saved.
    repo.save(transitionReview(r2, 'refined'));
    repo.save(r3);
    // r1 accepted — should NOT be superseded.
    repo.save(transitionReview(r1, 'accepted'));

    const count = repo.supersedeForRecommendation('rec_a');
    expect(count).toBe(1); // only r2 (refined) is non-terminal for rec_a

    const superseded = repo.listByStatus('superseded');
    expect(superseded.map((r) => r.id)).toEqual(['rev_2']);

    // rec_b review is untouched.
    expect(repo.get('rev_3')?.status).toBe('pending');
  });

  it('supersedeForRecommendation returns 0 when no non-terminal reviews exist', () => {
    const repo = new InMemoryRecommendationReviewRepository();
    expect(repo.supersedeForRecommendation('rec_none')).toBe(0);
  });
});
