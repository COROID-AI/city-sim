import { validateRecommendation } from './validate';
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
  value: 0.2,
  components: [{ key: 'k', weight: 1, contribution: 0.2 }],
} as const satisfies OpportunityScore;

const confidence = {
  value: 0.9,
  basis: 'mixed',
} as const satisfies OpportunityConfidence;

const surfaces: readonly ImplementationSurface[] = [
  { kind: 'code-path', ref: 'src/x.ts' },
  { kind: 'module', modulePath: 'src/x.ts', symbol: 'x' },
  { kind: 'config', configPath: 'tsconfig.json', key: 'compilerOptions.strict' },
  { kind: 'doc', docPath: 'README.md', anchor: 'a' },
] as const satisfies readonly ImplementationSurface[];

const evidence: readonly OpportunityEvidence[] = [
  { kind: 'metric', id: 'm1', path: '/a', observed: 1, expected: 2 },
] as const satisfies readonly OpportunityEvidence[];

const validBase = {
  id: 'r1',
  title: 't',
  summary: 's',
  category: 'performance' as const satisfies RecommendationCategory,
  evidence,
  score,
  confidence,
  surfaces,
  status: 'proposed' as const satisfies RecommendationStatus,
  createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
  rationale: 'r',
  tags: ['a'] as const,
} satisfies OpportunityRecommendation;

test('validator accepts fully-populated valid recommendation', () => {
  const res = validateRecommendation(validBase);
  expect(res.ok).toBe(true);
});

test('validator rejects missing id', () => {
  const res = validateRecommendation({ ...validBase, id: '' });
  expect(res.ok).toBe(false);
});

test('validator rejects out-of-range score', () => {
  const res = validateRecommendation({ ...validBase, score: { ...score, value: 1.1 } });
  expect(res.ok).toBe(false);
});

test('validator rejects out-of-range confidence', () => {
  const res = validateRecommendation({ ...validBase, confidence: { ...confidence, value: -0.1 } });
  expect(res.ok).toBe(false);
});

test('validator rejects unknown category', () => {
  const res = validateRecommendation({ ...validBase, category: 'unknown' as RecommendationCategory });
  expect(res.ok).toBe(false);
});

test('validator rejects unknown status', () => {
  const res = validateRecommendation({ ...validBase, status: 'unknown' as RecommendationStatus });
  expect(res.ok).toBe(false);
});

test('validator rejects malformed evidence kind', () => {
  const badEvidence = [{ kind: 'nope', id: 'e1', path: '/a', observed: 1, expected: 2 }];
  const res = validateRecommendation({ ...validBase, evidence: badEvidence as unknown as OpportunityEvidence[] });
  expect(res.ok).toBe(false);
});

test('validator rejects surface kind not in union', () => {
  const badSurfaces = [{ kind: 'nope', ref: 'src/x.ts' }];
  const res = validateRecommendation({ ...validBase, surfaces: badSurfaces as unknown as ImplementationSurface[] });
  expect(res.ok).toBe(false);
});

test('compile-time fixtures exercise every RecommendationCategory and ImplementationSurface variant', () => {
  const categories = [
    'performance',
    'reliability',
    'ux',
    'cost',
    'security',
    'testability',
    'accessibility',
    'documentation',
  ] as const satisfies readonly RecommendationCategory[];

  expect(categories).toHaveLength(8);

  const allSurfaces = [
    { kind: 'code-path', ref: 'src/a.ts' },
    { kind: 'module', modulePath: 'src/b.ts', symbol: 'b' },
    { kind: 'config', configPath: 'tsconfig.json', key: 'compilerOptions.strict' },
    { kind: 'doc', docPath: 'README.md', anchor: 'x' },
  ] as const satisfies readonly ImplementationSurface[];

  expect(allSurfaces).toHaveLength(4);
});

test('serialize then deserialize via JSON retains structural fields', () => {
  const original: OpportunityRecommendation = validBase;
  const json = JSON.parse(JSON.stringify(original)) as OpportunityRecommendation;

  expect(json).toEqual(original);
});
