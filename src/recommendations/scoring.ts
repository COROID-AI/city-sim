import type { OpportunityConfidence, OpportunityEvidence, OpportunityScore } from './types';

export type OpportunityDimensions = {
  readonly userValue: number;
  readonly implementationFit: number;
  readonly repositoryEvidence: number;
  readonly risk: number;
  readonly confidence: number;
};

export type ConfidenceBasisInput = {
  readonly evidence: readonly OpportunityEvidence[];
  readonly metrics: readonly string[];
  readonly comparisons: readonly OpportunityEvidence[];
};

const SCORING_WEIGHTS = Object.freeze({
  userValue: 0.3,
  implementationFit: 0.25,
  repositoryEvidence: 0.2,
  risk: 0.15,
  confidence: 0.1,
} as const);

type ComponentKey = keyof typeof SCORING_WEIGHTS;

type ComponentSpec = {
  readonly key: ComponentKey;
  readonly weight: number;
};

const COMPONENT_SPECS: readonly ComponentSpec[] = Object.freeze([
  { key: 'userValue', weight: SCORING_WEIGHTS.userValue },
  { key: 'implementationFit', weight: SCORING_WEIGHTS.implementationFit },
  { key: 'repositoryEvidence', weight: SCORING_WEIGHTS.repositoryEvidence },
  { key: 'risk', weight: SCORING_WEIGHTS.risk },
  { key: 'confidence', weight: SCORING_WEIGHTS.confidence },
]);

function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    throw new TypeError('All scoring dimensions must be finite numbers.');
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function deepFreezeWeights(weights: unknown): unknown {
  if (typeof weights !== 'object' || weights === null) return weights;
  const obj = weights as Record<string, unknown>;
  for (const v of Object.values(obj)) {
    deepFreezeWeights(v);
  }
  return Object.freeze(obj);
}

deepFreezeWeights(SCORING_WEIGHTS);

function assertWeightsSumToOne(weights: typeof SCORING_WEIGHTS): void {
  const sum =
    weights.userValue + weights.implementationFit + weights.repositoryEvidence + weights.risk + weights.confidence;
  // Allow tiny float errors from literal sums.
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`SCORING_WEIGHTS must sum to 1.0; got ${sum}`);
  }
}

assertWeightsSumToOne(SCORING_WEIGHTS);

function deriveConfidenceBasis(input: ConfidenceBasisInput): OpportunityConfidence['basis'] {
  const hasEvidence = input.evidence.length > 0;
  const hasMetrics = input.metrics.length > 0;
  const hasComparison = input.comparisons.length > 0;

  if (hasEvidence && !hasComparison && !hasMetrics) return 'evidence-strength';
  if (!hasEvidence && hasComparison) return 'historical-precedent';
  if (!hasEvidence && !hasComparison && !hasMetrics) return 'analyst-judgment';

  // Mixed kinds.
  return 'mixed';
}

export type ScoreOpportunityOptions = {
  readonly riskAsPenalty?: boolean;
};

export type ScoreOpportunityInput = OpportunityDimensions & {
  readonly confidenceBasis: ConfidenceBasisInput;
};

export function scoreOpportunity(
  input: ScoreOpportunityInput,
  options: ScoreOpportunityOptions = {},
): OpportunityScore & { confidence: OpportunityConfidence } {
  const userValue = clamp01(input.userValue);
  const implementationFit = clamp01(input.implementationFit);
  const repositoryEvidence = clamp01(input.repositoryEvidence);
  const risk = clamp01(input.risk);
  const confidenceDimension = clamp01(input.confidence);

  const clampedByKey: Record<ComponentKey, number> = {
    userValue,
    implementationFit,
    repositoryEvidence,
    risk,
    confidence: confidenceDimension,
  };

  const components = COMPONENT_SPECS.map((spec) => {
    const contribution = round6(spec.weight * clampedByKey[spec.key]);
    return {
      key: spec.key,
      weight: spec.weight,
      contribution,
    };
  });

  const weightedSum = components.reduce((acc, c) => acc + c.contribution, 0);

  const riskAsPenalty = options.riskAsPenalty ?? true;
  const riskPenalty = riskAsPenalty ? 1 - 0.5 * risk : 1 + 0.5 * risk;

  const value = round6(weightedSum * riskPenalty);

  const confidenceBasis = deriveConfidenceBasis(input.confidenceBasis);
  const confidence: OpportunityConfidence = {
    value: clamp01(input.confidence),
    basis: confidenceBasis,
  };

  return {
    value,
    components: components.map((c) => ({
      key: c.key,
      weight: c.weight,
      contribution: c.contribution,
    })),
    confidence,
  };
}
