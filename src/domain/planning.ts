/**
 * Planning analysis: converts repository summaries and opportunity data
 * into ranked, schema-versioned Recommendations.
 *
 * Pure and deterministic. No `Date.now`, no `Math.random`, no I/O. The
 * same input always produces a deep-equal output across invocations.
 *
 * Pipeline:
 *   Opportunity[]
 *     -> filter (only draft/active)
 *     -> deriveAxisInputs (kind + metrics -> 5 normalized axes)
 *     -> scoreOpportunity (rubric)
 *     -> buildRecommendationFromScore (createRecommendation seam)
 *     -> rankRecommendations (score desc, opportunityId asc)
 *
 * Non-{draft,active} opportunities (accepted/completed) are explicitly
 * excluded so the analysis only surfaces actionable improvements.
 */

import type { City, Opportunity, MetricKey } from './city.js';
import type { Recommendation, RecommendationEvidence } from './recommendation.js';
import { createRecommendation } from './recommendation.js';
import {
  scoreOpportunity,
  buildRationale,
  DEFAULT_RUBRIC
} from './scoring.js';
import type { Rubric, ScoringInput, ScoringResult } from './scoring.js';

/**
 * Per-kind baseline offsets for axis derivation. Different opportunity
 * kinds rank differently by default, preventing low-variance (degenerate)
 * rankings when raw metrics are uniform.
 */
export const DEFAULT_AXIS_DERIVATION: Readonly<
  Record<Opportunity['kind'], Readonly<Record<keyof Omit<ScoringInput, 'opportunityId'>, number>>>
> = Object.freeze({
  transport: { user_value: 0.15, implementation_fit: 0.1, repository_evidence: 0.05, risk: -0.05, confidence: 0.0 },
  housing: { user_value: 0.1, implementation_fit: 0.15, repository_evidence: 0.05, risk: -0.1, confidence: 0.05 },
  safety: { user_value: 0.2, implementation_fit: 0.05, repository_evidence: 0.0, risk: -0.15, confidence: 0.1 },
  economy: { user_value: 0.05, implementation_fit: 0.2, repository_evidence: 0.1, risk: 0.0, confidence: 0.05 },
  environment: { user_value: 0.1, implementation_fit: 0.0, repository_evidence: 0.15, risk: -0.05, confidence: 0.0 }
});

/**
 * Input for {@link generatePlanningAnalysis}.
 */
export type PlanningAnalysisInput = Readonly<{
  city: City;
  /** The tick at which the analysis is performed (included in rec ids). */
  analysisTick: number;
  /** Optional custom rubric; defaults to {@link DEFAULT_RUBRIC}. */
  rubric?: Rubric;
  /** Optional custom axis derivation offsets; defaults to {@link DEFAULT_AXIS_DERIVATION}. */
  axisDerivation?: typeof DEFAULT_AXIS_DERIVATION;
}>;

/**
 * Coerce a value to a finite number in [0,1].
 * NaN / undefined -> 0, Infinity -> 1, -Infinity -> 0, finite clamped.
 */
function clampUnit(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? 1 : 0;
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Read a metric from an opportunity, returning undefined when absent.
 */
function readMetric(opportunity: Opportunity, key: MetricKey): number | undefined {
  const m = opportunity.metrics;
  if (!m) return undefined;
  const v = m[key];
  return typeof v === 'number' ? v : undefined;
}

/**
 * Derive the five normalized scoring axis inputs from an opportunity's
 * kind and metrics. All outputs are finite and clamped to [0,1].
 *
 * Derivation strategy (per axis):
 *  - user_value: overallScore metric (or 0.5 default) + kind offset
 *  - implementation_fit: economicHealth metric (or 0.5) + kind offset
 *  - repository_evidence: environmentalImpact metric (or 0.5) + kind offset
 *  - risk: safety metric inverted (low safety = high risk) + kind offset
 *  - confidence: walkability metric (or 0.5) + kind offset
 */
export function deriveAxisInputs(
  opportunity: Opportunity,
  axisDerivation: typeof DEFAULT_AXIS_DERIVATION = DEFAULT_AXIS_DERIVATION
): ScoringInput {
  const offsets = axisDerivation[opportunity.kind];

  const overall = readMetric(opportunity, 'overallScore');
  const economic = readMetric(opportunity, 'economicHealth');
  const environmental = readMetric(opportunity, 'environmentalImpact');
  const safety = readMetric(opportunity, 'safety');
  const walkability = readMetric(opportunity, 'walkability');

  const userValue = clampUnit((overall ?? 0.5) + (offsets?.user_value ?? 0));
  const implementationFit = clampUnit((economic ?? 0.5) + (offsets?.implementation_fit ?? 0));
  const repositoryEvidence = clampUnit((environmental ?? 0.5) + (offsets?.repository_evidence ?? 0));
  // Risk: low safety -> high risk. Invert safety (1 - safety) then apply offset.
  const risk = clampUnit((safety === undefined ? 0.5 : 1 - safety) + (offsets?.risk ?? 0));
  const confidence = clampUnit((walkability ?? 0.5) + (offsets?.confidence ?? 0));

  return {
    opportunityId: opportunity.id,
    user_value: userValue,
    implementation_fit: implementationFit,
    repository_evidence: repositoryEvidence,
    risk,
    confidence
  };
}

/**
 * Build a stable recommendation id: `rec_{seed}_{tick}_{oppIdx}_{analysisTick}`.
 *
 * `oppIdx` is the opportunity's index within the city's opportunity list,
 * ensuring uniqueness even when the same opportunity is re-analyzed across
 * different analysis ticks.
 */
export function buildRecommendationId(
  seed: number,
  createdAtTick: number,
  oppIdx: number,
  analysisTick: number
): string {
  return `rec_${seed}_${createdAtTick}_${oppIdx}_${analysisTick}`;
}

/**
 * Build evidence entries from a scoring result. Always includes at least
 * one entry (the dominant axis contribution).
 */
function buildEvidence(result: ScoringResult): ReadonlyArray<RecommendationEvidence> {
  const evidence: RecommendationEvidence[] = result.contributions
    .filter((c) => c.weightedContribution > 0)
    .map((c) => ({
      source: 'scoring',
      ref: c.axis,
      weight: c.weightedContribution
    }));

  // Guarantee at least one evidence entry per the schema contract.
  if (evidence.length === 0) {
    evidence.push({
      source: 'scoring',
      ref: result.dominantAxis,
      weight: 0
    });
  }

  return evidence;
}

/**
 * Convert a scoring result into a validated Recommendation.
 *
 * Uses {@link createRecommendation} as the single validation seam, which
 * stamps `schemaVersion: '1'`.
 */
export function buildRecommendationFromScore(
  result: ScoringResult,
  id: string,
  createdAtTick: number
): Recommendation {
  const evidence = buildEvidence(result);
  const rationale = buildRationale(result);

  return createRecommendation({
    id,
    opportunityId: result.opportunityId,
    evidence,
    score: result.score,
    confidence: result.confidence,
    surfaces: result.surfaces,
    rationale,
    createdAtTick
  });
}

/**
 * Rank recommendations deterministically: score descending, then
 * opportunityId ascending (stable tie-break).
 */
export function rankRecommendations(
  recommendations: ReadonlyArray<Recommendation>
): Recommendation[] {
  return [...recommendations].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Tie-break: ascending opportunityId for stable ordering.
    if (a.opportunityId < b.opportunityId) return -1;
    if (a.opportunityId > b.opportunityId) return 1;
    return 0;
  });
}

/**
 * Return the top-k recommendations without reordering (uses
 * {@link rankRecommendations} then slices).
 */
export function topRecommendations(
  recommendations: ReadonlyArray<Recommendation>,
  k: number
): Recommendation[] {
  const ranked = rankRecommendations(recommendations);
  const limit = Math.max(0, Math.floor(k));
  return ranked.slice(0, limit);
}

/**
 * Filter predicate: only draft or active opportunities are eligible for
 * planning analysis. Accepted/completed are excluded.
 */
export function isEligibleForAnalysis(opportunity: Opportunity): boolean {
  return opportunity.status === 'draft' || opportunity.status === 'active';
}

/**
 * Generate a ranked list of Recommendations for a city's eligible
 * opportunities. Pure and deterministic.
 *
 * @returns A new ranked array of validated Recommendations.
 */
export function generatePlanningAnalysis(
  input: PlanningAnalysisInput
): Recommendation[] {
  const { city, analysisTick } = input;
  const rubric = input.rubric ?? DEFAULT_RUBRIC;
  const axisDerivation = input.axisDerivation ?? DEFAULT_AXIS_DERIVATION;

  const recommendations: Recommendation[] = [];

  for (let i = 0; i < city.opportunities.length; i++) {
    // noUncheckedIndexedAccess: index access returns T | undefined.
    const opportunity = city.opportunities[i];
    if (!opportunity) continue;

    if (!isEligibleForAnalysis(opportunity)) continue;

    const axisInputs = deriveAxisInputs(opportunity, axisDerivation);
    const result = scoreOpportunity(axisInputs, rubric);
    const id = buildRecommendationId(
      city.seed,
      opportunity.createdAtTick,
      i,
      analysisTick
    );
    const rec = buildRecommendationFromScore(result, id, analysisTick);
    recommendations.push(rec);
  }

  return rankRecommendations(recommendations);
}
