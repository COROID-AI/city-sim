import type { AppErrorCode } from './city.js';
import { AppError } from './city.js';

/**
 * Where a recommendation may be materialized by a downstream consumer.
 * Narrow literal union so the review UI can render distinct actions.
 */
export type SuggestedImplementationSurface = 'plan' | 'task' | 'metric' | 'policy';

/**
 * A single piece of supporting evidence for a recommendation.
 * Typed refs (rather than free-form strings) enable provenance tracking.
 */
export type RecommendationEvidence = Readonly<{
  /** Provenance category / system that produced this evidence. */
  source: string;
  /** Stable reference id within `source` (e.g. metric key, rule id). */
  ref: string;
  /** Relative weight in [0, 1]. */
  weight: number;
}>;

/**
 * A repository-backed recommendation attached to an Opportunity.
 *
 * `schemaVersion` is a literal so future migrations are explicit and
 * consumers can branch on a known shape.
 */
export type Recommendation = Readonly<{
  id: string;
  opportunityId: string;
  evidence: ReadonlyArray<RecommendationEvidence>;
  /** Overall score in the closed interval [0, 1]. */
  score: number;
  /** Confidence in the score in the closed interval [0, 1]. */
  confidence: number;
  surfaces: ReadonlyArray<SuggestedImplementationSurface>;
 rationale: string;
  createdAtTick: number;
  schemaVersion: '1';
}>;

const SCHEMA_VERSION = '1' as const;

const VALID_SURFACES: ReadonlySet<SuggestedImplementationSurface> = new Set([
  'plan',
  'task',
  'metric',
  'policy'
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function inUnitInterval(value: number): boolean {
  return value >= 0 && value <= 1;
}

/**
 * Runtime validation for a Recommendation. Throws {@link AppError} with
 * recommendation-specific codes for each failure mode.
 *
 * Returns the (unchanged) recommendation so callers can chain.
 */
export function validateRecommendation(rec: Recommendation): Recommendation {
  if (!rec || typeof rec !== 'object') {
    throw new AppError('INVALID_RECOMMENDATION', 'recommendation must be an object');
  }

  // Evidence: non-empty array of well-formed entries.
  if (!Array.isArray(rec.evidence) || rec.evidence.length === 0) {
    throw new AppError(
      'INVALID_RECOMMENDATION_EVIDENCE',
      'evidence must be a non-empty array'
    );
  }

  for (const ev of rec.evidence) {
    if (
      !ev ||
      typeof ev.source !== 'string' ||
      ev.source.trim() === '' ||
      typeof ev.ref !== 'string' ||
      ev.ref.trim() === '' ||
      !isFiniteNumber(ev.weight) ||
      !inUnitInterval(ev.weight)
    ) {
      throw new AppError(
        'INVALID_RECOMMENDATION_EVIDENCE',
        'each evidence entry requires non-empty source, ref and a weight in [0, 1]'
      );
    }
  }

  // Score: finite number in [0, 1].
  if (!isFiniteNumber(rec.score) || !inUnitInterval(rec.score)) {
    throw new AppError(
      'INVALID_RECOMMENDATION_SCORE',
      `score must be a finite number in [0, 1] (got ${String(rec.score)})`
    );
  }

  // Confidence: finite number in [0, 1].
  if (!isFiniteNumber(rec.confidence) || !inUnitInterval(rec.confidence)) {
    throw new AppError(
      'INVALID_RECOMMENDATION_CONFIDENCE',
      `confidence must be a finite number in [0, 1] (got ${String(rec.confidence)})`
    );
  }

  // Surfaces: non-empty array of known literals.
  if (!Array.isArray(rec.surfaces) || rec.surfaces.length === 0) {
    throw new AppError(
      'INVALID_RECOMMENDATION_SURFACE',
      'surfaces must be a non-empty array'
    );
  }
  for (const surface of rec.surfaces) {
    if (!VALID_SURFACES.has(surface)) {
      throw new AppError(
        'INVALID_RECOMMENDATION_SURFACE',
        `unknown surface: ${String(surface)}`
      );
    }
  }

  return rec;
}

/**
 * Persistence seam for Recommendations. The in-memory implementation below
 * is the default; a real DB can drop in later without changing call sites.
 */
export interface RecommendationRepository {
  save(rec: Recommendation): Recommendation;
  get(id: string): Recommendation | undefined;
  listByOpportunity(opportunityId: string): ReadonlyArray<Recommendation>;
  delete(id: string): boolean;
}

/**
 * In-process {@link RecommendationRepository} backed by a Map.
 *
 * Iteration order is deterministic: insertion order (Map guarantees) for
 * `listByOpportunity`, filtered by opportunityId.
 */
export class InMemoryRecommendationRepository implements RecommendationRepository {
  private readonly store: Map<string, Recommendation> = new Map();

  public save(rec: Recommendation): Recommendation {
    validateRecommendation(rec);
    this.store.set(rec.id, rec);
    return rec;
  }

  public get(id: string): Recommendation | undefined {
    return this.store.get(id);
  }

  public listByOpportunity(opportunityId: string): ReadonlyArray<Recommendation> {
    const out: Recommendation[] = [];
    for (const rec of this.store.values()) {
      if (rec.opportunityId === opportunityId) {
        out.push(rec);
      }
    }
    return out;
  }

  public delete(id: string): boolean {
    return this.store.delete(id);
  }
}

/**
 * Helper to construct a validated Recommendation with the current schema
 * version filled in. Centralizes the literal so call sites stay terse.
 */
export function createRecommendation(
  input: Omit<Recommendation, 'schemaVersion'>
): Recommendation {
  const rec: Recommendation = { ...input, schemaVersion: SCHEMA_VERSION };
  return validateRecommendation(rec);
}

// Re-export AppError/AppErrorCode so consumers can import everything from here.
export type { AppErrorCode };
export { AppError };
