/**
 * Quality graph: criterion lifecycles, per-phase coverage and release readiness.
 *
 * Runs in the default Node environment against the real `GameState` contract:
 * criteria are registered through the shared `quality/measured` domain event and
 * scored against the shared sample fixture, so the numbers proven here are the
 * numbers the runtime sees. The tests also pin the two rules the win/loss
 * evaluation depends on — only final invariants block shipping, and superseded
 * criteria are history that can never inflate coverage or readiness — plus the
 * purity rule that lets the graph be recomputed every frame without drift.
 */

import { describe, expect, it } from 'vitest';

import { SAMPLE_SEED, createSampleState } from '../src/sim/fixtures';
import {
  applyDomainEvents,
  createInitialState,
  createSnapshot,
  makeDomainEvent,
  type DomainEvent,
  type GameState,
  type MetricRegistration,
} from '../src/sim/state';
import {
  DEFAULT_RELEASE_THRESHOLD,
  createCriterionRegistry,
  finalInvariantCompletion,
  isReleaseReady,
  registerCriteria,
  releaseReadiness,
  summarizeQualityGraph,
  updateQualityGraph,
  type CriterionDeclaration,
} from '../src/sim/quality';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A criterion measurement, with the defaults the reducer would apply anyway. */
function measurement(
  id: string,
  value: number,
  overrides: { label?: string; target?: number; weight?: number } = {},
): MetricRegistration {
  return {
    id,
    label: overrides.label ?? id,
    value,
    target: overrides.target ?? 1,
    weight: overrides.weight ?? 1,
  };
}

/** Reduce a measurement script into a fresh state through the shared reducer. */
function stateWith(criteria: readonly MetricRegistration[]): GameState {
  const events: DomainEvent[] = criteria.map((metric, index) =>
    makeDomainEvent('quality/measured', { metric }, 1_000 + index),
  );
  return applyDomainEvents(createInitialState(), events);
}

/** Re-measure one criterion later in the run, the way the runtime reports it. */
function remeasure(state: GameState, metric: MetricRegistration, at: number): GameState {
  return applyDomainEvents(state, [makeDomainEvent('quality/measured', { metric }, at)]);
}

const milestone = (key: string): CriterionDeclaration => ({ key, lifecycle: 'milestone' });
const invariant = (key: string): CriterionDeclaration => ({ key, lifecycle: 'final_invariant' });
const superseded = (key: string, supersededBy: string): CriterionDeclaration => ({
  key,
  lifecycle: 'superseded',
  supersededBy,
});

/* -------------------------------------------------------------------------- */
/* Per-phase coverage                                                         */
/* -------------------------------------------------------------------------- */

describe('updateQualityGraph coverage', () => {
  it('reports coverage per phase as satisfied criteria over total criteria', () => {
    const state = stateWith([
      measurement('c-typed', 1, { weight: 0.4 }),
      measurement('c-booted', 0.4, { weight: 0.3 }),
      measurement('c-notes', 1, { weight: 0.1 }),
      measurement('c-contrast', 0.5, { weight: 0.1 }),
    ]);
    const registry = createCriterionRegistry([
      invariant('c-typed'),
      invariant('c-booted'),
      milestone('c-notes'),
      milestone('c-contrast'),
    ]);

    const graph = updateQualityGraph(state, { registry });

    expect(graph.phases.milestone).toMatchObject({ total: 2, satisfied: 1, unmet: 1, coverage: 0.5 });
    expect(graph.phases.milestone.satisfiedKeys).toEqual(['c-notes']);
    expect(graph.phases.milestone.unmetKeys).toEqual(['c-contrast']);
    expect(graph.phases.final_invariant).toMatchObject({ total: 2, satisfied: 1, unmet: 1, coverage: 0.5 });
    expect(graph.coverage).toEqual({ milestone: 0.5, final_invariant: 0.5 });
    expect(graph.liveCount).toBe(4);
    expect(graph.releaseThreshold).toBe(DEFAULT_RELEASE_THRESHOLD);

    // Coverage is exactly the satisfied/total ratio, re-derived independently.
    for (const phase of ['milestone', 'final_invariant'] as const) {
      const counts = graph.phases[phase];
      expect(counts.coverage).toBeCloseTo(counts.satisfied / counts.total, 10);
      expect(counts.total).toBe(counts.satisfied + counts.unmet);
    }
  });

  it('excludes superseded criteria from every phase and links them to their replacement', () => {
    const state = stateWith([
      measurement('c-typed', 1, { weight: 0.4 }),
      measurement('c-notes', 1, { weight: 0.1 }),
      measurement('c-legacy', 0.5, { weight: 0.05 }),
    ]);
    const registry = createCriterionRegistry([
      invariant('c-typed'),
      milestone('c-notes'),
      superseded('c-legacy', 'c-notes'),
    ]);

    const graph = updateQualityGraph(state, { registry });

    expect(graph.byKey['c-legacy']).toMatchObject({
      lifecycle: 'superseded',
      phase: 'superseded',
      supersededBy: 'c-notes',
      satisfied: false,
    });
    expect(graph.supersededCount).toBe(1);
    expect(graph.superseded.map((criterion) => criterion.key)).toEqual(['c-legacy']);
    // Retired work leaves the denominator as well as the numerator.
    expect(graph.phases.milestone.total).toBe(1);
    expect(graph.phases.milestone.satisfiedKeys).toEqual(['c-notes']);
    expect(graph.coverage.milestone).toBe(1);

    const trimmedState = stateWith([
      measurement('c-typed', 1, { weight: 0.4 }),
      measurement('c-notes', 1, { weight: 0.1 }),
    ]);
    const trimmed = updateQualityGraph(trimmedState, {
      registry: createCriterionRegistry([invariant('c-typed'), milestone('c-notes')]),
    });
    expect(graph.coverage).toEqual(trimmed.coverage);
    expect(graph.readiness).toBe(trimmed.readiness);
  });

  it('keeps a superseded invariant out of the readiness denominator', () => {
    const state = stateWith([
      measurement('inv-core', 1, { weight: 0.5 }),
      measurement('inv-legacy', 0.3, { weight: 0.25 }),
    ]);
    const graph = updateQualityGraph(state, {
      registry: [invariant('inv-core'), superseded('inv-legacy', 'inv-core')],
    });

    // Counted, the retired invariant would drag readiness to 0.5/0.75 and block
    // the release; as history it changes neither.
    expect(graph.finalInvariants).toMatchObject({ total: 1, satisfied: 1, pending: 0, complete: true });
    expect(graph.readiness).toBe(1);
    expect(graph.ready).toBe(true);
    expect(graph.blockers).toEqual([]);
  });

  it('classifies undeclared criteria from their measurements', () => {
    const state = stateWith([
      measurement('draft', 1, { weight: 0.1 }),
      measurement('replacement', 1, { weight: 0.2 }),
      measurement('inv', 0.5, { weight: 0.3 }),
    ]);

    const graph = updateQualityGraph(state);

    expect(graph.byKey['draft']).toMatchObject({ lifecycle: 'superseded', supersededBy: 'replacement' });
    expect(graph.byKey['replacement']?.lifecycle).toBe('milestone');
    expect(graph.byKey['inv']).toMatchObject({ lifecycle: 'final_invariant', satisfied: false });
    expect(graph.phases.milestone.total).toBe(1);
    expect(graph.coverage.milestone).toBe(1);
    expect(graph.readiness).toBe(0);
    expect(graph.ready).toBe(false);
  });

  it('scores the shipped sample mission from the shared fixture', () => {
    const state = createSampleState(SAMPLE_SEED);
    const graph = updateQualityGraph(state);

    expect(graph.criteria.map((criterion) => criterion.key)).toEqual(state.quality.order);
    expect(graph.byKey['metric-determinism']).toMatchObject({ lifecycle: 'final_invariant', satisfied: true });
    expect(graph.byKey['metric-fidelity']).toMatchObject({ lifecycle: 'final_invariant', satisfied: false });
    expect(graph.byKey['metric-frame-budget']?.lifecycle).toBe('milestone');
    expect(graph.byKey['metric-contract-coverage']?.lifecycle).toBe('milestone');
    expect(graph.byKey['metric-readability']?.lifecycle).toBe('milestone');

    expect(graph.phases.final_invariant).toMatchObject({ total: 2, satisfied: 1, coverage: 0.5 });
    expect(graph.phases.milestone).toMatchObject({ total: 3, satisfied: 0, coverage: 0 });
    // Determinism holds (weight 0.3), fidelity does not (weight 0.25).
    expect(graph.readiness).toBeCloseTo(0.3 / 0.55, 10);
    expect(graph.ready).toBe(false);
    expect(graph.blockers).toEqual(['metric-fidelity']);
    expect(graph.supersededCount).toBe(0);

    expect(finalInvariantCompletion(state)).toEqual(graph.finalInvariants);
    expect(releaseReadiness(state)).toBe(graph.readiness);
    expect(isReleaseReady(state)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Release readiness                                                          */
/* -------------------------------------------------------------------------- */

describe('release readiness', () => {
  it('is driven by final invariants only', () => {
    const registry = createCriterionRegistry([
      invariant('inv-a'),
      invariant('inv-b'),
      milestone('ms-a'),
      milestone('ms-b'),
    ]);

    const draftsUnfinished = stateWith([
      measurement('inv-a', 1, { weight: 0.3 }),
      measurement('inv-b', 1, { weight: 0.25 }),
      measurement('ms-a', 0.2, { weight: 0.1 }),
      measurement('ms-b', 0, { weight: 0.05 }),
    ]);
    const shipping = updateQualityGraph(draftsUnfinished, { registry });

    expect(shipping.coverage.milestone).toBe(0);
    expect(shipping.readiness).toBe(1);
    expect(shipping.ready).toBe(true);
    expect(shipping.blockers).toEqual([]);
    expect(shipping.score).toBeLessThan(1); // the drafts still cost quality

    const invariantsUnfinished = stateWith([
      measurement('inv-a', 1, { weight: 0.3 }),
      measurement('inv-b', 0.9, { weight: 0.25 }),
      measurement('ms-a', 1, { weight: 0.1 }),
      measurement('ms-b', 1, { weight: 0.05 }),
    ]);
    const blocked = updateQualityGraph(invariantsUnfinished, { registry });

    expect(blocked.coverage.milestone).toBe(1);
    expect(blocked.readiness).toBeLessThan(DEFAULT_RELEASE_THRESHOLD);
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers).toEqual(['inv-b']);
  });

  it('never unlocks shipping with milestones alone', () => {
    const state = stateWith([measurement('ms-a', 1, { weight: 0.2 }), measurement('ms-b', 1, { weight: 0.15 })]);

    const graph = updateQualityGraph(state, { registry: [milestone('ms-a'), milestone('ms-b')] });

    expect(graph.coverage.milestone).toBe(1);
    expect(graph.finalInvariants).toMatchObject({ total: 0, satisfied: 0, completion: 0, complete: false });
    expect(graph.readiness).toBe(0);
    expect(graph.ready).toBe(false);
    expect(graph.blockers).toEqual([]);
  });

  it('treats a declared but unmeasured final invariant as unmet', () => {
    const state = stateWith([measurement('inv-a', 1, { weight: 0.3 })]);

    const graph = updateQualityGraph(state, {
      registry: [invariant('inv-a'), { key: 'inv-boot', lifecycle: 'final_invariant', label: 'Boot smoke' }],
    });

    expect(graph.byKey['inv-boot']).toMatchObject({
      label: 'Boot smoke',
      measured: false,
      value: 0,
      satisfied: false,
    });
    expect(graph.finalInvariants).toMatchObject({ total: 2, satisfied: 1, pending: 1, complete: false });
    expect(graph.readiness).toBeLessThan(DEFAULT_RELEASE_THRESHOLD);
    expect(graph.ready).toBe(false);
    expect(graph.blockers).toEqual(['inv-boot']);
  });

  it('drops below the threshold when a final invariant starts failing', () => {
    const base = stateWith([
      measurement('inv-typecheck', 1, { weight: 0.3 }),
      measurement('inv-boot', 1, { weight: 0.25 }),
    ]);
    const registry = createCriterionRegistry([invariant('inv-typecheck'), invariant('inv-boot')]);

    const shipping = updateQualityGraph(base, { registry });
    expect(shipping.finalInvariants).toMatchObject({ total: 2, satisfied: 2, complete: true });
    expect(shipping.readiness).toBe(1);
    expect(shipping.ready).toBe(true);

    const regressed = remeasure(base, measurement('inv-boot', 0.6, { weight: 0.25 }), 5_000);
    const failing = updateQualityGraph(regressed, { registry });

    expect(failing.readiness).toBeLessThan(failing.releaseThreshold);
    expect(failing.readiness).toBeLessThan(shipping.readiness);
    expect(failing.ready).toBe(false);
    expect(failing.blockers).toEqual(['inv-boot']);
    expect(failing.finalInvariants).toMatchObject({ total: 2, satisfied: 1, pending: 1, complete: false });

    // The regression is a property of the new state, not of the previous score.
    expect(updateQualityGraph(base, { registry })).toEqual(shipping);
  });
});

/* -------------------------------------------------------------------------- */
/* Purity                                                                     */
/* -------------------------------------------------------------------------- */

describe('quality graph purity', () => {
  it('is a pure function of the criterion records in state', () => {
    const state = createSampleState(SAMPLE_SEED);
    const before = createSnapshot(state);

    const first = updateQualityGraph(state);
    const second = updateQualityGraph(state);

    expect(second).toEqual(first);
    expect(createSnapshot(state)).toEqual(before); // nothing was mutated
    // Renderers and the HUD read frozen snapshots; they must score identically.
    expect(updateQualityGraph(createSnapshot(state))).toEqual(first);
    // ... and rebuilding the same mission drifts nothing either.
    expect(updateQualityGraph(createSampleState(SAMPLE_SEED))).toEqual(first);
  });

  it('summarizes the release decision for the log and the HUD', () => {
    const state = stateWith([measurement('inv-a', 0.5, { weight: 0.3 })]);

    const line = summarizeQualityGraph(updateQualityGraph(state, { registry: [invariant('inv-a')] }));

    expect(line).toContain('not ready');
    expect(line).toContain('readiness 0.00/1.00');
    expect(line).toContain('final invariants 0/1');
    expect(line).toContain('0 superseded');
  });
});

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

describe('registerCriteria', () => {
  it('moves a criterion through its lifecycles without mutating the registry', () => {
    const draft = createCriterionRegistry([milestone('c-notes')]);
    const promoted = registerCriteria(draft, [invariant('c-notes')]);
    const retired = registerCriteria(promoted, [superseded('c-notes', 'c-typed'), invariant('c-typed')]);

    expect(draft.criteria['c-notes']?.lifecycle).toBe('milestone');
    expect(promoted.criteria['c-notes']?.lifecycle).toBe('final_invariant');
    expect(retired.criteria['c-notes']).toMatchObject({ lifecycle: 'superseded', supersededBy: 'c-typed' });
    expect(retired.order).toEqual(['c-notes', 'c-typed']);
    expect(retired.diagnostics).toEqual([]);
  });

  it('resolves a replacement declared in an earlier registration', () => {
    const withReplacement = registerCriteria(createCriterionRegistry([milestone('c-typed')]), [
      superseded('c-notes', 'c-typed'),
    ]);

    expect(withReplacement.criteria['c-notes']).toMatchObject({
      lifecycle: 'superseded',
      supersededBy: 'c-typed',
    });
    expect(withReplacement.diagnostics).toEqual([]);
  });

  it('refuses a supersession that would drop a commitment', () => {
    const unknown = createCriterionRegistry([superseded('c-a', 'c-missing')]);
    expect(unknown.criteria['c-a']?.lifecycle).toBe('milestone');
    expect(unknown.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unknown-replacement']);

    const self = createCriterionRegistry([superseded('c-a', 'c-a')]);
    expect(self.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['self-replacement']);

    const cycle = createCriterionRegistry([superseded('c-a', 'c-b'), superseded('c-b', 'c-a')]);
    expect(cycle.criteria['c-a']?.lifecycle).toBe('milestone');
    expect(cycle.criteria['c-b']?.lifecycle).toBe('milestone');
    expect(cycle.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'replacement-superseded',
      'replacement-superseded',
    ]);

    const blank = createCriterionRegistry([{ key: '   ' }]);
    expect(blank.order).toEqual([]);
    expect(blank.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['missing-key']);
  });
});
