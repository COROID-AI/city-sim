import { describe, it, expect } from 'vitest';

import {
  DEFAULT_RUBRIC,
  scoreOpportunity,
  buildRationale
} from '../scoring.js';
import type { Rubric, ScoringInput } from '../scoring.js';

function baseInput(): ScoringInput {
  return {
    opportunityId: 'opp_42_0_0',
    user_value: 0.6,
    implementation_fit: 0.7,
    repository_evidence: 0.5,
    risk: 0.3,
    confidence: 0.8
  };
}

describe('DEFAULT_RUBRIC', () => {
  it('weights sum to 1.0', () => {
    const sum =
      DEFAULT_RUBRIC.confidence.weight +
      DEFAULT_RUBRIC.implementation_fit.weight +
      DEFAULT_RUBRIC.repository_evidence.weight +
      DEFAULT_RUBRIC.risk.weight +
      DEFAULT_RUBRIC.user_value.weight;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DEFAULT_RUBRIC)).toBe(true);
  });

  it('risk axis is inverted', () => {
    expect(DEFAULT_RUBRIC.risk.inverted).toBe(true);
  });
});

describe('scoreOpportunity — determinism', () => {
  it('returns deep-equal results across 100 runs', () => {
    const input = baseInput();
    const first = scoreOpportunity(input);
    for (let i = 0; i < 100; i++) {
      const again = scoreOpportunity(input);
      expect(again).toEqual(first);
    }
  });

  it('does not mutate the input', () => {
    const input = baseInput();
    const snapshot = { ...input };
    scoreOpportunity(input);
    expect(input).toEqual(snapshot);
  });
});

describe('scoreOpportunity — boundary clamping', () => {
  it('clamps values above 1 to 1', () => {
    const result = scoreOpportunity({
      ...baseInput(),
      user_value: 1.5
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('clamps negative values to 0', () => {
    const result = scoreOpportunity({
      ...baseInput(),
      implementation_fit: -0.1
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('treats NaN as 0', () => {
    const result = scoreOpportunity({
      ...baseInput(),
      confidence: NaN
    });
    expect(result.confidence).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('treats Infinity as clamped to 1', () => {
    const result = scoreOpportunity({
      ...baseInput(),
      user_value: Infinity
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('treats -Infinity as 0', () => {
    const result = scoreOpportunity({
      ...baseInput(),
      risk: -Infinity
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe('scoreOpportunity — axis monotonicity', () => {
  it('bumping user_value up never decreases score', () => {
    const low = scoreOpportunity({ ...baseInput(), user_value: 0.3 });
    const high = scoreOpportunity({ ...baseInput(), user_value: 0.9 });
    expect(high.score).toBeGreaterThanOrEqual(low.score);
  });

  it('bumping implementation_fit up never decreases score', () => {
    const low = scoreOpportunity({ ...baseInput(), implementation_fit: 0.2 });
    const high = scoreOpportunity({ ...baseInput(), implementation_fit: 0.8 });
    expect(high.score).toBeGreaterThanOrEqual(low.score);
  });

  it('bumping repository_evidence up never decreases score', () => {
    const low = scoreOpportunity({ ...baseInput(), repository_evidence: 0.1 });
    const high = scoreOpportunity({ ...baseInput(), repository_evidence: 0.9 });
    expect(high.score).toBeGreaterThanOrEqual(low.score);
  });

  it('bumping confidence up never decreases score', () => {
    const low = scoreOpportunity({ ...baseInput(), confidence: 0.1 });
    const high = scoreOpportunity({ ...baseInput(), confidence: 0.9 });
    expect(high.score).toBeGreaterThanOrEqual(low.score);
  });

  it('bumping risk up DECREASES score (inverted axis)', () => {
    const low = scoreOpportunity({ ...baseInput(), risk: 0.1 });
    const high = scoreOpportunity({ ...baseInput(), risk: 0.9 });
    expect(high.score).toBeLessThan(low.score);
  });
});

describe('scoreOpportunity — surface selection', () => {
  it('case: high risk, low fit → only metric surface', () => {
    const result = scoreOpportunity({
      ...baseInput(),
      risk: 0.9,
      implementation_fit: 0.2,
      user_value: 0.2,
      repository_evidence: 0.2
    });
    expect(result.surfaces).toEqual(['metric']);
  });

  it('case: low risk, high fit, high user_value → plan + task + metric', () => {
    const result = scoreOpportunity({
      ...baseInput(),
      risk: 0.1,
      implementation_fit: 0.8,
      user_value: 0.8,
      repository_evidence: 0.2
    });
    expect(result.surfaces).toContain('plan');
    expect(result.surfaces).toContain('task');
    expect(result.surfaces).toContain('metric');
    // plan should come before task (priority order)
    expect(result.surfaces.indexOf('plan')).toBeLessThan(
      result.surfaces.indexOf('task')
    );
  });

  it('case: high repository_evidence → includes policy surface', () => {
    const result = scoreOpportunity({
      ...baseInput(),
      repository_evidence: 0.9
    });
    expect(result.surfaces).toContain('policy');
  });

  it('case: mixed values produces a valid score in [0,1]', () => {
    const result = scoreOpportunity({
      ...baseInput(),
      user_value: 0.4,
      implementation_fit: 0.6,
      repository_evidence: 0.5,
      risk: 0.5,
      confidence: 0.5
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.surfaces.length).toBeGreaterThanOrEqual(1);
  });
});

describe('scoreOpportunity — custom rubric', () => {
  it('all-zero weights → score 0 and surfaces fallback to metric only', () => {
    const zeroRubric: Rubric = {
      confidence: { weight: 0, inverted: false },
      implementation_fit: { weight: 0, inverted: false },
      repository_evidence: { weight: 0, inverted: false },
      risk: { weight: 0, inverted: true },
      user_value: { weight: 0, inverted: false }
    };
    const result = scoreOpportunity(baseInput(), zeroRubric);
    expect(result.score).toBe(0);
    expect(result.surfaces).toEqual(['metric']);
  });
});

describe('buildRationale', () => {
  it('returns a non-empty string containing the opportunity id', () => {
    const result = scoreOpportunity(baseInput());
    const rationale = buildRationale(result);
    expect(typeof rationale).toBe('string');
    expect(rationale.length).toBeGreaterThan(0);
    expect(rationale).toContain('opp_42_0_0');
  });

  it('contains one of the five axis names', () => {
    const result = scoreOpportunity(baseInput());
    const rationale = buildRationale(result);
    const axisNames = [
      'user_value',
      'implementation_fit',
      'repository_evidence',
      'risk',
      'confidence'
    ];
    expect(axisNames.some((name) => rationale.includes(name))).toBe(true);
  });

  it('is deterministic for the same result', () => {
    const result = scoreOpportunity(baseInput());
    expect(buildRationale(result)).toBe(buildRationale(result));
  });
});
