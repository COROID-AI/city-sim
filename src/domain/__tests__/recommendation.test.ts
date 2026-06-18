import { describe, it, expect } from 'vitest';

import {
  InMemoryRecommendationRepository,
  createRecommendation,
  validateRecommendation
} from '../recommendation.js';
import { AppError } from '../city.js';
import type { Recommendation } from '../recommendation.js';

function validBase(): Omit<Recommendation, 'schemaVersion'> {
  return {
    id: 'rec_1',
    opportunityId: 'opp_42_0_0',
    evidence: [{ source: 'metric', ref: 'safety', weight: 0.8 }],
    score: 0.7,
    confidence: 0.6,
    surfaces: ['plan', 'task'],
    rationale: 'improve crossing safety',
    createdAtTick: 3
  };
}

describe('createRecommendation', () => {
  it('fills schemaVersion literal "1"', () => {
    const rec = createRecommendation(validBase());
    expect(rec.schemaVersion).toBe('1');
  });

  it('preserves provided fields', () => {
    const rec = createRecommendation(validBase());
    expect(rec.id).toBe('rec_1');
    expect(rec.opportunityId).toBe('opp_42_0_0');
    expect(rec.evidence).toHaveLength(1);
    expect(rec.surfaces).toEqual(['plan', 'task']);
  });
});

describe('validateRecommendation', () => {
  it('throws INVALID_RECOMMENDATION_EVIDENCE for empty evidence', () => {
    const bad = { ...validBase(), evidence: [] };
    try {
      validateRecommendation({ ...bad, schemaVersion: '1' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe('INVALID_RECOMMENDATION_EVIDENCE');
    }
  });

  it('throws INVALID_RECOMMENDATION_SCORE for out-of-range score', () => {
    const bad = { ...validBase(), score: 1.5 };
    try {
      validateRecommendation({ ...bad, schemaVersion: '1' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe('INVALID_RECOMMENDATION_SCORE');
    }
  });

  it('throws INVALID_RECOMMENDATION_SCORE for negative score', () => {
    const bad = { ...validBase(), score: -0.1 };
    try {
      validateRecommendation({ ...bad, schemaVersion: '1' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe('INVALID_RECOMMENDATION_SCORE');
    }
  });

  it('throws INVALID_RECOMMENDATION_CONFIDENCE for out-of-range confidence', () => {
    const bad = { ...validBase(), confidence: 2 };
    try {
      validateRecommendation({ ...bad, schemaVersion: '1' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe('INVALID_RECOMMENDATION_CONFIDENCE');
    }
  });

  it('throws INVALID_RECOMMENDATION_SURFACE for unknown surface', () => {
    const bad = { ...validBase(), surfaces: ['plan', 'bogus'] as never[] };
    try {
      validateRecommendation({ ...bad, schemaVersion: '1' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe('INVALID_RECOMMENDATION_SURFACE');
    }
  });

  it('accepts boundary values 0 and 1 for score and confidence', () => {
    const rec = createRecommendation({
      ...validBase(),
      score: 0,
      confidence: 1
    });
    expect(rec.score).toBe(0);
    expect(rec.confidence).toBe(1);
  });
});

describe('InMemoryRecommendationRepository', () => {
  it('save / get round-trips a recommendation', () => {
    const repo = new InMemoryRecommendationRepository();
    const rec = createRecommendation(validBase());
    repo.save(rec);
    expect(repo.get('rec_1')).toEqual(rec);
  });

  it('get returns undefined for unknown id', () => {
    const repo = new InMemoryRecommendationRepository();
    expect(repo.get('nope')).toBeUndefined();
  });

  it('listByOpportunity filters and preserves insertion order', () => {
    const repo = new InMemoryRecommendationRepository();
    const a = createRecommendation({ ...validBase(), id: 'a', opportunityId: 'oppA' });
    const b = createRecommendation({ ...validBase(), id: 'b', opportunityId: 'oppB' });
    const c = createRecommendation({ ...validBase(), id: 'c', opportunityId: 'oppA' });
    repo.save(a);
    repo.save(b);
    repo.save(c);

    const forA = repo.listByOpportunity('oppA');
    expect(forA.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('delete removes and returns true; false when absent', () => {
    const repo = new InMemoryRecommendationRepository();
    repo.save(createRecommendation(validBase()));
    expect(repo.delete('rec_1')).toBe(true);
    expect(repo.get('rec_1')).toBeUndefined();
    expect(repo.delete('rec_1')).toBe(false);
  });

  it('save validates and rejects invalid recommendations', () => {
    const repo = new InMemoryRecommendationRepository();
    const bad = { ...validBase(), score: 5, schemaVersion: '1' as const };
    expect(() => repo.save(bad)).toThrow();
    expect(repo.get('rec_1')).toBeUndefined();
  });
});
