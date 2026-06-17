import {
  InMemoryRecommendationRepository,
  type RecommendationFilter,
} from './repository';
import {
  validateRecommendation,
  type ValidationResult,
} from './validate';
import type {
  ImplementationSurface,
  OpportunityConfidence,
  OpportunityEvidence,
  OpportunityRecommendation,
  OpportunityScore,
  RecommendationCategory,
  RecommendationStatus,
} from './types';

const score = {
  value: 0.6,
  components: [
    { key: 'latency', weight: 0.5, contribution: 0.3 },
    { key: 'memory', weight: 0.5, contribution: 0.3 },
  ],
} as const satisfies OpportunityScore;

const confidence = {
  value: 0.75,
  basis: 'evidence-strength',
} as const satisfies OpportunityConfidence;

const surfaces: readonly ImplementationSurface[] = [
  { kind: 'code-path', ref: 'src/systems/TimeSystem.ts:advanceTick' },
  { kind: 'module', modulePath: 'src/systems/TimeSystem.ts', symbol: 'TimeSystem' },
  { kind: 'config', configPath: 'tsconfig.json', key: 'compilerOptions.strict' },
  { kind: 'doc', docPath: 'docs/decisions.md', anchor: 'time-system' },
] as const satisfies readonly ImplementationSurface[];

const evidenceByKind: readonly OpportunityEvidence[] = [
  { kind: 'metric', id: 'e-m1', path: '/sim/frameTimeMs', observed: 120, expected: 80 },
  { kind: 'file', id: 'e-f1', path: 'src/systems/TimeSystem.ts', lines: [10, 11], excerpt: 'tick++' },
  { kind: 'event', id: 'e-ev1', system: 'TimeSystem', payloadRef: 'EventBus::tick' },
  { kind: 'comparison', id: 'e-c1', baselineId: 'v1', candidateId: 'v2' },
] as const satisfies readonly OpportunityEvidence[];

const baseRecommendation = {
  id: 'r1',
  title: 'Improve tick batching',
  summary: 'Batch events to reduce per-tick allocations.',
  category: 'performance' as const satisfies RecommendationCategory,
  evidence: evidenceByKind,
  score,
  confidence,
  surfaces,
  status: 'proposed' as const satisfies RecommendationStatus,
  createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
  rationale: 'Deterministic batching reduces overhead without changing semantics.',
  tags: ['perf', 'batching'] as const,
} satisfies OpportunityRecommendation;

function buildRec(partial: Partial<OpportunityRecommendation> & { id: string }): OpportunityRecommendation {
  return { ...baseRecommendation, ...partial };
}

describe('InMemoryRecommendationRepository', () => {
  test('add/get/list round-trip', () => {
    const repo = new InMemoryRecommendationRepository();
    repo.add(buildRec({ id: 'r1' }));

    expect(repo.get('r1')).not.toBeNull();
    expect(repo.get('missing')).toBeNull();

    const listed = repo.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe('r1');
  });

  test('list filters by status/category/minConfidence', () => {
    const repo = new InMemoryRecommendationRepository();
    repo.add(buildRec({ id: 'r1', status: 'proposed', category: 'performance' }));
    repo.add(buildRec({ id: 'r2', status: 'under-review', category: 'reliability', confidence: { value: 0.5, basis: 'mixed' } }));
    repo.add(buildRec({ id: 'r3', status: 'accepted', category: 'performance', confidence: { value: 0.9, basis: 'historical-precedent' } }));

    const filter: RecommendationFilter = { status: 'accepted', category: 'performance', minConfidence: 0.8 };
    const listed = repo.list(filter);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe('r3');
  });

  test('updateStatus rejects illegal transitions', () => {
    const repo = new InMemoryRecommendationRepository();
    repo.add(buildRec({ id: 'r1', status: 'rejected' }));

    expect(() => repo.updateStatus('r1', 'accepted')).toThrow(/Illegal status transition/);
  });

  test('updateStatus accepts legal transitions', () => {
    const repo = new InMemoryRecommendationRepository();
    repo.add(buildRec({ id: 'r1', status: 'proposed' }));
    repo.updateStatus('r1', 'under-review');

    const updated = repo.get('r1');
    expect(updated?.status).toBe('under-review');
  });

  test('remove idempotency', () => {
    const repo = new InMemoryRecommendationRepository();
    repo.add(buildRec({ id: 'r1' }));
    repo.remove('r1');
    repo.remove('r1');
    expect(repo.get('r1')).toBeNull();
  });

  test('validation failure on add is surfaced (not silently stored)', () => {
    const repo = new InMemoryRecommendationRepository();
    const invalid: OpportunityRecommendation = {
      ...buildRec({ id: 'r1' }),
      id: '' as string,
    };

    const result: ValidationResult = validateRecommendation(invalid);
    expect(result.ok).toBe(false);

    expect(() => repo.add(invalid)).toThrow(/Cannot add invalid recommendation/);
    expect(repo.get('r1')).toBeNull();
  });
});
