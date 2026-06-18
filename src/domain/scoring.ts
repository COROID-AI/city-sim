/**
 * Deterministic opportunity scoring rubric.
 *
 * Pure, framework-agnostic scoring that maps a set of normalized axis
 * inputs (each in [0,1]) into a single score, a confidence value, a set
 * of suggested implementation surfaces, and per-axis contributions. The
 * output is fully reproducible: no `Date.now`, no `Math.random`, no I/O,
 * and axis iteration order is fixed (sorted lexicographically) so IEEE-754
 * addition order is stable across engines.
 *
 * Downstream code wraps the produced draft fields with `createRecommendation`
 * (see `recommendation.ts`), which remains the single validation seam and
 * the only place that stamps `schemaVersion`. This module intentionally
 * produces plain draft data and does not mutate the `Recommendation` schema.
 */

import type { SuggestedImplementationSurface } from './recommendation.js';

/**
 * The five scoring axes. The literal union is also used as a stable key
 * set; iteration order is derived from `AXIS_IDS` (sorted) rather than
 * object key order to guarantee determinism.
 */
export type ScoringAxisId =
  | 'user_value'
  | 'implementation_fit'
  | 'repository_evidence'
  | 'risk'
  | 'confidence';

/**
 * Configuration for a single axis within a rubric.
 */
export type ScoringAxis = Readonly<{
  /** Relative weight in the weighted mean. May be 0 to disable an axis. */
  weight: number;
  /**
   * Whether the axis value should be inverted before contributing.
   * `risk` is inverted (high risk penalizes the score); all others are not.
   */
  inverted: boolean;
}>;

/**
 * A complete rubric: one entry per scoring axis. Weights need not sum to 1
 * (they are normalized), but `DEFAULT_RUBRIC` does sum to 1.0 for clarity.
 */
export type Rubric = Readonly<Record<ScoringAxisId, ScoringAxis>>;

/**
 * Raw, caller-supplied axis values. Values outside [0,1] and non-finite
 * values (NaN, Infinity) are coerced/clamped internally so the output is
 * always finite and in range.
 */
export type ScoringInput = Readonly<{
  opportunityId: string;
  user_value: number;
  implementation_fit: number;
  repository_evidence: number;
  /** 0 = safe, 1 = very risky. Inverted before combining. */
  risk: number;
  confidence: number;
}>;

/**
 * Per-axis contribution after weighting (used for rationale + surfaces).
 */
export type AxisContribution = Readonly<{
  axis: ScoringAxisId;
  /** Effective value in [0,1] after clamping and (optional) inversion. */
  effectiveValue: number;
  /** `effectiveValue * normalizedWeight`. */
  weightedContribution: number;
  /** Normalized weight in [0,1] (weight / totalWeight). */
  normalizedWeight: number;
}>;

/**
 * Output of `scoreOpportunity`. All numeric fields are finite and in [0,1].
 */
export type ScoringResult = Readonly<{
  opportunityId: string;
  /** Weighted mean of effective axis values in [0,1]. */
  score: number;
  /** Confidence in the score in [0,1]. */
  confidence: number;
  /**
   * Suggested implementation surfaces, in deterministic priority order
   * (plan > task > metric > policy). Falls back to `['metric']` when no
   * axis contributes meaningfully (e.g. all-zero rubric weights).
   */
  surfaces: ReadonlyArray<SuggestedImplementationSurface>;
  /** Per-axis contributions, sorted by axis id for stable ordering. */
  contributions: ReadonlyArray<AxisContribution>;
  /** The dominant axis (highest weighted contribution). */
  dominantAxis: ScoringAxisId;
}>;

/**
 * Default rubric. Weights sum to exactly 1.0. `risk` is inverted.
 *
 * Frozen at module load so accidental mutation cannot break reproducibility.
 */
export const DEFAULT_RUBRIC: Rubric = Object.freeze({
  user_value: { weight: 0.3, inverted: false },
  implementation_fit: { weight: 0.25, inverted: false },
  repository_evidence: { weight: 0.2, inverted: false },
  risk: { weight: 0.15, inverted: true },
  confidence: { weight: 0.1, inverted: false }
});

/**
 * Fixed, lexicographically-sorted axis id list. Iterating this (rather than
 * `Object.keys`) guarantees a stable reduction order across JS engines.
 */
const AXIS_IDS: ReadonlyArray<ScoringAxisId> = Object.freeze([
  'confidence',
  'implementation_fit',
  'repository_evidence',
  'risk',
  'user_value'
]);

/**
 * Deterministic surface priority order. When multiple surfaces qualify they
 * are emitted in this order so output is reproducible regardless of object
 * key enumeration order.
 */
const SURFACE_PRIORITY: ReadonlyArray<SuggestedImplementationSurface> =
  Object.freeze(['plan', 'task', 'metric', 'policy']);

/**
 * Maps an axis to the surface it suggests when it contributes strongly.
 * Only axes whose weighted contribution exceeds the surface threshold
 * (relative to the max contribution) emit a surface.
 */
const AXIS_TO_SURFACE: Readonly<Record<ScoringAxisId, SuggestedImplementationSurface>> =
  Object.freeze({
    user_value: 'plan',
    implementation_fit: 'task',
    repository_evidence: 'policy',
    risk: 'metric',
    confidence: 'metric'
  });

/**
 * Coerce a raw axis value to a finite number in [0,1].
 *
 * - `undefined` / `NaN` -> 0
 * - `Infinity` -> 1, `-Infinity` -> 0
 * - finite values are clamped to [0,1]
 */
function toFiniteUnit(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? 1 : 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

/**
 * Clamp a finite number to [0,1] without the non-finite coercion rules
 * (used for aggregated results that are already known to be finite).
 */
function clamp01(value: number): number {
  if (Number.isNaN(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

/**
 * Score an opportunity against a rubric. Pure and deterministic.
 *
 * @param input  Raw axis values (non-finite/out-of-range values are clamped).
 * @param rubric Optional custom rubric; defaults to `DEFAULT_RUBRIC`.
 */
export function scoreOpportunity(
  input: ScoringInput,
  rubric: Rubric = DEFAULT_RUBRIC
): ScoringResult {
  // Sum of raw weights. If zero (all axes disabled), the weighted mean is
  // undefined; we treat that as a score of 0 with a metric-only fallback.
  const totalWeight = AXIS_IDS.reduce<number>((sum, axis) => {
    const axisCfg = rubric[axis];
    const w = axisCfg ? toFiniteUnit(axisCfg.weight) : 0;
    return sum + w;
  }, 0);

  // Build per-axis contributions in fixed (sorted) order.
  const contributions: AxisContribution[] = AXIS_IDS.map((axis) => {
    const axisCfg = rubric[axis];
    const weight = axisCfg ? toFiniteUnit(axisCfg.weight) : 0;
    const inverted = axisCfg ? axisCfg.inverted : false;
    const rawValue = toFiniteUnit(readAxisValue(input, axis));
    const effectiveValue = inverted ? 1 - rawValue : rawValue;
    const normalizedWeight = totalWeight > 0 ? weight / totalWeight : 0;
    const weightedContribution = effectiveValue * normalizedWeight;
    return { axis, effectiveValue, weightedContribution, normalizedWeight };
  });

  // Weighted mean of effective values. Zero when totalWeight is 0.
  const score = totalWeight > 0
    ? clamp01(contributions.reduce<number>((sum, c) => sum + c.weightedContribution, 0))
    : 0;

  // Confidence: the (normalized) weighted effective value of the confidence
  // axis alone, clamped to [0,1]. When the rubric disables confidence or all
  // weights are zero, confidence is 0.
  const confidenceContribution = contributions.find(
    (c) => c.axis === 'confidence'
  );
  const confidence = confidenceContribution
    ? clamp01(confidenceContribution.weightedContribution)
    : 0;

  // Dominant axis: highest weighted contribution. Ties broken by the fixed
  // AXIS_IDS order (first wins via strict `>` comparison).
  // AXIS_IDS is statically non-empty; assert to satisfy noUncheckedIndexedAccess.
  let dominantAxis: ScoringAxisId = AXIS_IDS[0]!;
  let dominantValue = Number.NEGATIVE_INFINITY;
  for (const c of contributions) {
    if (c.weightedContribution > dominantValue) {
      dominantValue = c.weightedContribution;
      dominantAxis = c.axis;
    }
  }

  // Surface selection: an axis suggests a surface when its weighted
  // contribution is at least half of the maximum contribution AND the total
  // weight is non-zero. With all-zero weights, no axis qualifies, so we fall
  // back to ['metric'] only.
  const surfaces = selectSurfaces(contributions, totalWeight);

  return {
    opportunityId: input.opportunityId,
    score,
    confidence,
    surfaces,
    contributions,
    dominantAxis
  };
}

/**
 * Read a raw axis value from the input by axis id. Centralized so the
 * axis->field mapping lives in exactly one place.
 */
function readAxisValue(input: ScoringInput, axis: ScoringAxisId): number {
  switch (axis) {
    case 'user_value':
      return input.user_value;
    case 'implementation_fit':
      return input.implementation_fit;
    case 'repository_evidence':
      return input.repository_evidence;
    case 'risk':
      return input.risk;
    case 'confidence':
      return input.confidence;
  }
}

/**
 * Select suggested surfaces deterministically.
 *
 * An axis qualifies when its weighted contribution is at least half of the
 * maximum weighted contribution across all axes. Qualifying axes are mapped
 * to surfaces and emitted in `SURFACE_PRIORITY` order, de-duplicated.
 *
 * When no axis qualifies (e.g. all-zero rubric weights, or total weight 0),
 * the result is the `['metric']` fallback so callers always get at least one
 * actionable surface.
 */
function selectSurfaces(
  contributions: ReadonlyArray<AxisContribution>,
  totalWeight: number
): ReadonlyArray<SuggestedImplementationSurface> {
  if (totalWeight <= 0) {
    return ['metric'];
  }

  // An axis qualifies for a surface only when its weighted contribution is
  // meaningfully positive (absolute threshold of 0.1). This keeps weak/low
  // signals from emitting surfaces: when every axis is weak we fall back to
  // the metric-only surface so callers always get one actionable suggestion.
  const CONTRIBUTION_THRESHOLD = 0.1;
  const qualifying = new Set<SuggestedImplementationSurface>();
  for (const c of contributions) {
    if (c.weightedContribution >= CONTRIBUTION_THRESHOLD) {
      qualifying.add(AXIS_TO_SURFACE[c.axis]);
    }
  }

  if (qualifying.size === 0) {
    return ['metric'];
  }

  // Emit in deterministic priority order.
  return SURFACE_PRIORITY.filter((s) => qualifying.has(s));
}

/**
 * Build a human-readable rationale string from a scoring result.
 *
 * The rationale always contains the opportunity id and the dominant axis
 * name. Deterministic for a given result.
 */
export function buildRationale(result: ScoringResult): string {
  const dominant = result.dominantAxis;
  const scorePct = (result.score * 100).toFixed(1);
  const confPct = (result.confidence * 100).toFixed(1);
  return (
    `Opportunity ${result.opportunityId} scored ${scorePct}% ` +
    `(confidence ${confPct}%); dominant axis: ${dominant}.`
  );
}
