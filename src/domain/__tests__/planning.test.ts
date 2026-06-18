import { describe, it, expect } from 'vitest';

import {
  deriveAxisInputs,
  buildRecommendationId,
  buildRecommendationFromScore,
  rankRecommendations,
  topRecommendations,
  isEligibleForAnalysis,
  generatePlanningAnalysis,
  DEFAULT_AXIS_DERIVATION
} from '../planning.js';
import { scoreOpportunity } from '../scoring.js';
import { validateRecommendation } from '../recommendation.js';
import type { City, Opportunity } from '../city.js';
import type { Recommendation } from '../recommendation.js';

function makeOpportunity(
  id: string,
  kind: Opportunity['kind'],
  status: Opportunity['status'] = 'active',
  metrics?: Opportunity['metrics'],
  createdAtTick = 0
): Opportunity {
  return {
    id,
    kind,
    description: `${kind} opportunity`,
    createdAtTick,
    status,
    metrics
  };
}

function makeCity(opportunities: Opportunity[], seed = 42, tick = 5): City {
  return {
    seed,
    width: 16,
    height: 16,
    startHour: 8,
    tick,
    hour: 8,
    population: 1000,
    opportunities
  };
}

function makeRec(id: string, opportunityId: string, score: number): Recommendation {
  return {
    id,
    opportunityId,
    evidence: [{ source: 'scoring', ref: 'user_value', weight: 0.5 }],
    score,
    confidence: 0.5,
    surfaces: ['plan'],
    rationale: 'test',
    createdAtTick: 1,
    schemaVersion: '1'
  };
}

describe('deriveAxisInputs', () => {
  it('clamps values to [0,1] and coerces NaN to 0', () => {
    const opp = makeOpportunity('opp_1', 'safety', 'active', {
      overallScore: 5, // out of range -> clamped
      economicHealth: NaN, // -> 0 after default 0.5 + offset
      environmentalImpact: -3, // -> clamped
      safety: 0.4,
      walkability: 0.6
    });
    const axes = deriveAxisInputs(opp);
    expect(axes.user_value).toBeGreaterThanOrEqual(0);
    expect(axes.user_value).toBeLessThanOrEqual(1);
    expect(axes.implementation_fit).toBeGreaterThanOrEqual(0);
    expect(axes.implementation_fit).toBeLessThanOrEqual(1);
    expect(axes.repository_evidence).toBeGreaterThanOrEqual(0);
    expect(axes.repository_evidence).toBeLessThanOrEqual(1);
    expect(axes.risk).toBeGreaterThanOrEqual(0);
    expect(axes.risk).toBeLessThanOrEqual(1);
    expect(axes.confidence).toBeGreaterThanOrEqual(0);
    expect(axes.confidence).toBeLessThanOrEqual(1);
  });

  it('produces finite values in [0,1] for all five axes', () => {
    const opp = makeOpportunity('opp_2', 'transport', 'active', {
      overallScore: 0.7,
      economicHealth: 0.3,
      environmentalImpact: 0.8,
      safety: 0.2,
      walkability: 0.9
    });
    const axes = deriveAxisInputs(opp);
    const values = [axes.user_value, axes.implementation_fit, axes.repository_evidence, axes.risk, axes.confidence];
    for (const v of values) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('inverts safety for risk (low safety = high risk)', () => {
    const lowSafety = makeOpportunity('opp_a', 'safety', 'active', { safety: 0.1 });
    const highSafety = makeOpportunity('opp_b', 'safety', 'active', { safety: 0.9 });
    const lowAxes = deriveAxisInputs(lowSafety);
    const highAxes = deriveAxisInputs(highSafety);
    expect(lowAxes.risk).toBeGreaterThan(highAxes.risk);
  });

  it('uses default 0.5 when metrics are absent', () => {
    const opp = makeOpportunity('opp_3', 'economy', 'active');
    const axes = deriveAxisInputs(opp);
    // economy offset for user_value is 0.05 -> 0.5 + 0.05 = 0.55
    expect(axes.user_value).toBeCloseTo(0.55, 5);
  });
});

describe('buildRecommendationId', () => {
  it('follows the rec_{seed}_{tick}_{oppIdx}_{analysisTick} pattern', () => {
    const id = buildRecommendationId(42, 3, 1, 7);
    expect(id).toBe('rec_42_3_1_7');
  });
});

describe('buildRecommendationFromScore', () => {
  it('returns a Recommendation passing validateRecommendation', () => {
    const result = scoreOpportunity({
      opportunityId: 'opp_42_0_0',
      user_value: 0.6,
      implementation_fit: 0.7,
      repository_evidence: 0.5,
      risk: 0.3,
      confidence: 0.8
    });
    const rec = buildRecommendationFromScore(result, 'rec_42_0_0_7', 7);
    expect(() => validateRecommendation(rec)).not.toThrow();
    expect(rec.schemaVersion).toBe('1');
    expect(rec.evidence.length).toBeGreaterThanOrEqual(1);
    expect(rec.rationale).toContain('opp_42_0_0');
  });
});

describe('rankRecommendations', () => {
  it('sorts by score descending', () => {
    const recs = [
      makeRec('r1', 'opp_a', 0.3),
      makeRec('r2', 'opp_b', 0.8),
      makeRec('r3', 'opp_c', 0.5)
    ];
    const ranked = rankRecommendations(recs);
    expect(ranked.map((r) => r.score)).toEqual([0.8, 0.5, 0.3]);
  });

  it('breaks ties by ascending opportunityId', () => {
    const recs = [
      makeRec('r1', 'opp_z', 0.5),
      makeRec('r2', 'opp_a', 0.5),
      makeRec('r3', 'opp_m', 0.5)
    ];
    const ranked = rankRecommendations(recs);
    expect(ranked.map((r) => r.opportunityId)).toEqual(['opp_a', 'opp_m', 'opp_z']);
  });

  it('does not mutate the input array', () => {
    const recs = [
      makeRec('r1', 'opp_a', 0.3),
      makeRec('r2', 'opp_b', 0.8)
    ];
    const original = [...recs];
    rankRecommendations(recs);
    expect(recs.map((r) => r.id)).toEqual(original.map((r) => r.id));
  });
});

describe('topRecommendations', () => {
  it('returns at most k entries', () => {
    const recs = [
      makeRec('r1', 'opp_a', 0.3),
      makeRec('r2', 'opp_b', 0.8),
      makeRec('r3', 'opp_c', 0.5)
    ];
    expect(topRecommendations(recs, 2).length).toBe(2);
    expect(topRecommendations(recs, 0).length).toBe(0);
    expect(topRecommendations(recs, 10).length).toBe(3);
  });

  it('never reorders (follows rank order)', () => {
    const recs = [
      makeRec('r1', 'opp_a', 0.1),
      makeRec('r2', 'opp_b', 0.9),
      makeRec('r3', 'opp_c', 0.5)
    ];
    const top = topRecommendations(recs, 2);
    expect(top[0]!.score).toBe(0.9);
    expect(top[1]!.score).toBe(0.5);
  });
});

describe('isEligibleForAnalysis', () => {
  it('includes draft and active', () => {
    expect(isEligibleForAnalysis(makeOpportunity('o1', 'safety', 'draft'))).toBe(true);
    expect(isEligibleForAnalysis(makeOpportunity('o2', 'safety', 'active'))).toBe(true);
  });

  it('excludes accepted and completed', () => {
    expect(isEligibleForAnalysis(makeOpportunity('o3', 'safety', 'accepted'))).toBe(false);
    expect(isEligibleForAnalysis(makeOpportunity('o4', 'safety', 'completed'))).toBe(false);
  });
});

describe('generatePlanningAnalysis', () => {
  it('is deterministic across 50 invocations (deep-equal)', () => {
    const city = makeCity([
      makeOpportunity('opp_42_0_0', 'transport', 'active', { overallScore: 0.7, safety: 0.3 }, 0),
      makeOpportunity('opp_42_0_1', 'housing', 'active', { overallScore: 0.5, safety: 0.6 }, 0),
      makeOpportunity('opp_42_0_2', 'safety', 'draft', { overallScore: 0.8, safety: 0.2 }, 0)
    ]);
    const input = { city, analysisTick: 5 };
    const first = generatePlanningAnalysis(input);
    for (let i = 0; i < 50; i++) {
      const run = generatePlanningAnalysis(input);
      expect(run).toEqual(first);
    }
  });

  it('excludes accepted and completed opportunities', () => {
    const city = makeCity([
      makeOpportunity('opp_42_0_0', 'transport', 'active'),
      makeOpportunity('opp_42_0_1', 'housing', 'accepted'),
      makeOpportunity('opp_42_0_2', 'safety', 'completed')
    ]);
    const recs = generatePlanningAnalysis({ city, analysisTick: 5 });
    expect(recs.length).toBe(1);
    expect(recs[0]!.opportunityId).toBe('opp_42_0_0');
  });

  it('produces recommendations with schemaVersion 1 and non-empty evidence', () => {
    const city = makeCity([
      makeOpportunity('opp_42_0_0', 'transport', 'active', { overallScore: 0.7 }),
      makeOpportunity('opp_42_0_1', 'economy', 'active', { overallScore: 0.6 })
    ]);
    const recs = generatePlanningAnalysis({ city, analysisTick: 3 });
    for (const rec of recs) {
      expect(rec.schemaVersion).toBe('1');
      expect(rec.evidence.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('generates ids following the stable pattern', () => {
    const city = makeCity([
      makeOpportunity('opp_42_0_0', 'transport', 'active', undefined, 0)
    ]);
    const recs = generatePlanningAnalysis({ city, analysisTick: 9 });
    expect(recs[0]!.id).toBe('rec_42_0_0_9');
  });

  it('end-to-end: 3 mixed-kind opportunities yield distinct ids, non-empty rationales', () => {
    const city = makeCity([
      makeOpportunity('opp_42_0_0', 'transport', 'active', { overallScore: 0.6, safety: 0.4, economicHealth: 0.7, environmentalImpact: 0.5, walkability: 0.6 }, 0),
      makeOpportunity('opp_42_0_1', 'housing', 'active', { overallScore: 0.7, safety: 0.5, economicHealth: 0.4, environmentalImpact: 0.6, walkability: 0.8 }, 0),
      makeOpportunity('opp_42_0_2', 'economy', 'active', { overallScore: 0.5, safety: 0.7, economicHealth: 0.8, environmentalImpact: 0.3, walkability: 0.5 }, 0)
    ]);
    const recs = generatePlanningAnalysis({ city, analysisTick: 5 });
    expect(recs.length).toBe(3);

    const ids = recs.map((r) => r.id);
    expect(new Set(ids).size).toBe(3); // distinct

    for (const rec of recs) {
      expect(rec.rationale.length).toBeGreaterThan(0);
      expect(rec.schemaVersion).toBe('1');
    }

    // Scores are non-degenerate: not all equal
    const scores = recs.map((r) => r.score);
    const uniqueScores = new Set(scores.map((s) => s.toFixed(6)));
    expect(uniqueScores.size).toBeGreaterThan(1);
  });

  it('returns empty array when no eligible opportunities', () => {
    const city = makeCity([
      makeOpportunity('opp_42_0_0', 'transport', 'accepted'),
      makeOpportunity('opp_42_0_1', 'housing', 'completed')
    ]);
    const recs = generatePlanningAnalysis({ city, analysisTick: 5 });
    expect(recs).toEqual([]);
  });
});

describe('DEFAULT_AXIS_DERIVATION', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(DEFAULT_AXIS_DERIVATION)).toBe(true);
  });

  it('has entries for all five kinds', () => {
    const kinds = Object.keys(DEFAULT_AXIS_DERIVATION);
    expect(kinds).toEqual(expect.arrayContaining(['transport', 'housing', 'safety', 'economy', 'environment']));
  });
});
