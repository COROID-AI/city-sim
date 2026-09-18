/**
 * The quality graph: criterion lifecycles, per-phase coverage and release
 * readiness.
 *
 * The `quality` slice records what the factory has *measured*. This module turns
 * those measurements, plus the declared criterion lifecycles, into the graph the
 * mission is judged by:
 *
 *  - **registration** — {@link createCriterionRegistry} and
 *    {@link registerCriteria} declare a criterion's lifecycle
 *    (`milestone` -> `final_invariant` -> `superseded`) and, for a superseded
 *    criterion, the replacement key that now carries the commitment;
 *  - **coverage** — every scored phase (`milestone`, `final_invariant`) reports
 *    satisfied criteria over total criteria. Superseded entries are history: they
 *    stay in the graph, linked to their replacement, and are excluded from every
 *    phase's numerator and denominator;
 *  - **readiness** — only final invariants are ship-blocking, so readiness is the
 *    weight-share of the final invariants that currently hold. A plan with unmet
 *    milestones but satisfied final invariants still reaches the release
 *    threshold; one failing final invariant drops below it on the very next
 *    recomputation;
 *  - **completion** — {@link finalInvariantCompletion} exposes how many final
 *    invariants hold, which is the value win/loss evaluation reads, and
 *    {@link isReleaseReady} is the ship decision itself.
 *
 * Purity: everything here is a pure function of `(state, declarations)`, so the
 * graph can be recomputed every frame without drift — two calls on the same state
 * return identical numbers — and no caller object is ever mutated. There are no
 * timers, no randomness and no DOM, three.js, verification or rendering imports.
 *
 * Surface note: the foundation contract's `quality` slice carries a criterion's
 * measurement (`id`, `label`, `value`, `target`, `weight`) but no lifecycle
 * field, so lifecycles are declared through the registry above. A measurement no
 * declaration covers is still judged: its lifecycle is derived with the same
 * weight rule the quality constellation draws with, so an undeclared heavy
 * criterion is a final invariant instead of being silently ignored.
 */

import type { DeepReadonly, GameState, QualityMetricState } from './state';

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a criterion: a draft milestone, a release invariant, or history. */
export type CriterionLifecycle = 'milestone' | 'final_invariant' | 'superseded';

/** The lifecycles that report coverage; `superseded` is history, not a phase. */
export type CriterionPhase = 'milestone' | 'final_invariant';

/** Scored phases, in report order. */
export const CRITERION_PHASES: readonly CriterionPhase[] = ['milestone', 'final_invariant'];

/**
 * Readiness a mission needs before it may ship. `1` means every live final
 * invariant must hold, so a mission with no final invariant at all can never be
 * ready and a milestone can never unlock the threshold on its own.
 */
export const DEFAULT_RELEASE_THRESHOLD = 1;

/**
 * Weight at or above which an *undeclared* measurement counts as a final
 * invariant. Matches the weight rule the quality constellation draws with, so the
 * score and the picture agree even before a mission declares its criteria.
 */
export const DEFAULT_INVARIANT_WEIGHT = 0.25;

/** Tolerance used when comparing a measured value against its target. */
const EPSILON = 1e-6;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Read-only view of the shared state, accepted live or frozen. */
export type QualityGraphView = DeepReadonly<GameState>;

/** The subset of a criterion the scoring rules need. */
export interface CriterionScoreInput {
  /** Measured 0..1 value. */
  readonly value: number;
  /** 0..1 target the value is judged against. */
  readonly target: number;
  /** Relative weight used by the readiness and score aggregates. */
  readonly weight: number;
}

/** The measured criterion record read from the `quality` slice. */
export type CriterionMeasurement = DeepReadonly<QualityMetricState>;

/** True when the measured value has reached the criterion's target. */
export function isCriterionSatisfied(criterion: CriterionScoreInput): boolean {
  if (criterion.target <= 0) return criterion.value > 0;
  return criterion.value >= criterion.target - EPSILON;
}

/** 0..1 progress of a measurement towards its target. */
export function criterionSatisfaction(criterion: CriterionScoreInput): number {
  if (criterion.target <= 0) return criterion.value > 0 ? 1 : 0;
  return clamp01(criterion.value / criterion.target);
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One criterion declaration.
 *
 * The key matches the metric id the reducer stores in `state.quality`.
 * Lifecycle transitions are expressed by re-registering the same key, so a single
 * entry point covers `milestone` -> `final_invariant` -> `superseded`.
 */
export interface CriterionDeclaration {
  /** Key of the criterion; equals the measured metric id in state. */
  key: string;
  /** Lifecycle to record. Defaults to `milestone`. */
  lifecycle?: CriterionLifecycle;
  /**
   * Replacement criterion key. Required for `superseded`: a commitment is only
   * dropped when another live criterion takes it over.
   */
  supersededBy?: string | null;
  /** Label used while state carries no measurement for this key yet. */
  label?: string;
}

/** A declaration with its lifecycle resolved. */
export interface RegisteredCriterion {
  readonly key: string;
  readonly lifecycle: CriterionLifecycle;
  /** Replacement key, set exactly when the lifecycle is `superseded`. */
  readonly supersededBy: string | null;
  readonly label: string | null;
}

export type CriterionDiagnosticCode =
  | 'missing-key'
  | 'unknown-replacement'
  | 'self-replacement'
  | 'replacement-superseded';

/** A declaration the registry refused to honour, with the reason why. */
export interface CriterionDiagnostic {
  readonly code: CriterionDiagnosticCode;
  readonly key: string;
  readonly message: string;
}

/** Declared criterion lifecycles plus the diagnostics left by registering them. */
export interface CriterionRegistry {
  /** Declared keys in registration order. */
  readonly order: readonly string[];
  readonly criteria: Readonly<Record<string, RegisteredCriterion>>;
  readonly diagnostics: readonly CriterionDiagnostic[];
}

const EMPTY_REGISTRY: CriterionRegistry = { order: [], criteria: {}, diagnostics: [] };

/**
 * Register criteria, returning a new registry.
 *
 * - The latest declaration for a key wins, which is how a criterion is promoted
 *   to `final_invariant` or retired as `superseded`.
 * - A `superseded` declaration is honoured only when its replacement exists (in
 *   the same batch or an earlier one) and is not itself superseded. Otherwise the
 *   criterion keeps the lifecycle it already had and the refusal is recorded as a
 *   diagnostic, so a mission can never quietly drop a commitment.
 * - The input registry is never mutated; registering nothing returns it as-is.
 */
export function registerCriteria(
  registry: CriterionRegistry,
  declarations: readonly CriterionDeclaration[],
): CriterionRegistry {
  if (declarations.length === 0) return registry;

  // Later declarations in one batch win, so a batch may register a criterion and
  // its replacement in a single call.
  const batch = new Map<string, CriterionDeclaration>();
  const order = [...registry.order];
  const criteria: Record<string, RegisteredCriterion> = { ...registry.criteria };
  const diagnostics: CriterionDiagnostic[] = [...registry.diagnostics];

  for (const declaration of declarations) {
    const key = declaration.key.trim();
    if (key === '') {
      diagnostics.push({
        code: 'missing-key',
        key: declaration.key,
        message: 'criterion declaration is missing a key',
      });
      continue;
    }
    batch.set(key, declaration);
  }

  for (const [key, declaration] of batch) {
    const previous = registry.criteria[key];
    const requested = declaration.lifecycle ?? 'milestone';
    let lifecycle = requested;
    let supersededBy: string | null = null;

    if (requested === 'superseded') {
      const replacementKey = (declaration.supersededBy ?? '').trim();
      const refusal = checkReplacement(key, replacementKey, batch, registry);
      if (refusal) {
        diagnostics.push(refusal);
        lifecycle = previous?.lifecycle ?? 'milestone';
        supersededBy = previous?.supersededBy ?? null;
      } else {
        supersededBy = replacementKey;
      }
    }

    criteria[key] = { key, lifecycle, supersededBy, label: declaration.label ?? previous?.label ?? null };
    if (!previous) order.push(key);
  }

  return { order, criteria, diagnostics };
}

/** Build a registry from a declaration list. */
export function createCriterionRegistry(
  declarations: readonly CriterionDeclaration[] = [],
): CriterionRegistry {
  return registerCriteria(EMPTY_REGISTRY, declarations);
}

/** Why a `superseded` declaration may not be honoured, or `null` when it may. */
function checkReplacement(
  key: string,
  replacementKey: string,
  batch: ReadonlyMap<string, CriterionDeclaration>,
  registry: CriterionRegistry,
): CriterionDiagnostic | null {
  if (replacementKey === '') {
    return {
      code: 'unknown-replacement',
      key,
      message: `superseded criterion ${key} needs a replacement criterion key`,
    };
  }
  if (replacementKey === key) {
    return { code: 'self-replacement', key, message: `criterion ${key} cannot supersede itself` };
  }

  const inBatch = batch.get(replacementKey);
  const registered = registry.criteria[replacementKey];
  if (!inBatch && !registered) {
    return {
      code: 'unknown-replacement',
      key,
      message: `replacement ${replacementKey} is not registered`,
    };
  }

  const replacementLifecycle = inBatch?.lifecycle ?? registered?.lifecycle ?? 'milestone';
  if (replacementLifecycle === 'superseded') {
    return {
      code: 'replacement-superseded',
      key,
      message: `replacement ${replacementKey} is itself superseded`,
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Lifecycle derivation                                                       */
/* -------------------------------------------------------------------------- */

/** A criterion source: a measurement, or a declared criterion without one yet. */
export interface CriterionSource extends CriterionScoreInput {
  readonly key: string;
  readonly label: string;
  /** False when the criterion is declared but state carries no measurement. */
  readonly measured: boolean;
}

/** Classification of a criterion that no declaration covers. */
export interface CriterionClassification {
  readonly lifecycle: CriterionLifecycle;
  /** Replacement key, set exactly when the lifecycle is `superseded`. */
  readonly supersededBy: string | null;
}

export interface LifecycleDerivationOptions {
  /** Weight at or above which a criterion is a final invariant. */
  invariantWeight?: number;
  /** Keys that may not act as a replacement (e.g. criteria already superseded). */
  unavailable?: ReadonlySet<string>;
}

/**
 * Classify an undeclared criterion from its measurement and its siblings.
 *
 *  1. a criterion at or above `invariantWeight` is a `final_invariant` — it must
 *     hold before the mission ships, so it is never replaced;
 *  2. a *held* milestone that a later-registered, strictly heavier and held
 *     sibling has taken over is `superseded`, linked to that sibling;
 *  3. everything else is a `milestone`.
 *
 * Pure and deterministic: the same sources always classify the same way.
 */
export function classifyCriterionSource(
  sources: readonly CriterionSource[],
  index: number,
  options: LifecycleDerivationOptions = {},
): CriterionClassification {
  const source = sources[index];
  if (!source) return { lifecycle: 'milestone', supersededBy: null };

  const invariantWeight = options.invariantWeight ?? DEFAULT_INVARIANT_WEIGHT;
  if (source.weight >= invariantWeight) {
    return { lifecycle: 'final_invariant', supersededBy: null };
  }
  if (!isCriterionSatisfied(source)) return { lifecycle: 'milestone', supersededBy: null };

  const replacement = findReplacement(sources, index, options.unavailable);
  return replacement
    ? { lifecycle: 'superseded', supersededBy: replacement.key }
    : { lifecycle: 'milestone', supersededBy: null };
}

/** Heaviest later-registered, held sibling that can take over from `index`. */
function findReplacement(
  sources: readonly CriterionSource[],
  index: number,
  unavailable?: ReadonlySet<string>,
): CriterionSource | null {
  const source = sources[index];
  if (!source) return null;

  let best: CriterionSource | null = null;
  for (let candidate = index + 1; candidate < sources.length; candidate += 1) {
    const replacement = sources[candidate];
    if (!replacement) continue;
    if (unavailable?.has(replacement.key)) continue;
    if (replacement.weight <= source.weight) continue;
    if (!isCriterionSatisfied(replacement)) continue;
    if (best === null || replacement.weight > best.weight) best = replacement;
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* The graph                                                                  */
/* -------------------------------------------------------------------------- */

/** One criterion, with its lifecycle and measurement resolved. */
export interface QualityCriterion extends CriterionScoreInput {
  readonly key: string;
  readonly label: string;
  readonly lifecycle: CriterionLifecycle;
  /** Scored phase; `superseded` for history, which no phase scores. */
  readonly phase: CriterionLifecycle;
  /** Replacement key, set exactly when the lifecycle is `superseded`. */
  readonly supersededBy: string | null;
  /** 0..1 progress towards the target. */
  readonly satisfaction: number;
  /** True when the measured value reached the target. */
  readonly satisfied: boolean;
  /** False when the criterion is declared but state carries no measurement. */
  readonly measured: boolean;
}

/** Coverage of one scored phase: satisfied criteria over total criteria. */
export interface PhaseCoverage {
  readonly phase: CriterionPhase;
  readonly total: number;
  readonly satisfied: number;
  readonly unmet: number;
  /** `satisfied / total`, clamped to 0..1 and 0 for an empty phase. */
  readonly coverage: number;
  readonly satisfiedKeys: readonly string[];
  readonly unmetKeys: readonly string[];
}

/** How far the mission's final invariants are from letting it ship. */
export interface FinalInvariantCompletion {
  readonly total: number;
  readonly satisfied: number;
  readonly pending: number;
  /** `satisfied / total`, 0 when the mission declares no final invariant. */
  readonly completion: number;
  /** True when at least one final invariant exists and every one of them holds. */
  readonly complete: boolean;
  readonly satisfiedKeys: readonly string[];
  readonly pendingKeys: readonly string[];
}

/** Everything one recomputation of the quality graph reports. */
export interface QualityGraph {
  /** Every criterion in registration order, superseded history included. */
  readonly criteria: readonly QualityCriterion[];
  readonly order: readonly string[];
  readonly byKey: Readonly<Record<string, QualityCriterion>>;
  /** Live criteria: everything that is not superseded. */
  readonly liveCount: number;
  readonly supersededCount: number;
  /** Superseded criteria, each linked to its replacement. */
  readonly superseded: readonly QualityCriterion[];
  /** Coverage per scored phase; superseded criteria are excluded. */
  readonly phases: Readonly<Record<CriterionPhase, PhaseCoverage>>;
  /** Per-phase coverage as plain numbers, e.g. `{ milestone: 0, final_invariant: 0.5 }`. */
  readonly coverage: Readonly<Record<CriterionPhase, number>>;
  readonly finalInvariants: FinalInvariantCompletion;
  /** Weight-share of satisfied final invariants; 0 when there are none. */
  readonly readiness: number;
  readonly releaseThreshold: number;
  /** Readiness at the threshold with at least one final invariant declared. */
  readonly ready: boolean;
  /** Unmet final invariants — what keeps the mission from shipping. */
  readonly blockers: readonly string[];
  /** Weighted satisfaction across every live criterion, superseded excluded. */
  readonly score: number;
}

export interface QualityGraphOptions {
  /** Declared lifecycles: a registry, or a plain declaration list. */
  registry?: CriterionRegistry | readonly CriterionDeclaration[];
  /** Weight at or above which an undeclared criterion is a final invariant. */
  invariantWeight?: number;
  /** Readiness needed to ship. Defaults to {@link DEFAULT_RELEASE_THRESHOLD}. */
  releaseThreshold?: number;
}

/**
 * Recompute the quality graph for `state`.
 *
 * Pure and idempotent: identical `(state, options)` always produce an identical
 * graph, which is what lets the runtime call it every frame without drift.
 */
export function updateQualityGraph(
  state: QualityGraphView,
  options: QualityGraphOptions = {},
): QualityGraph {
  const registry = resolveRegistry(options.registry);
  const invariantWeight = options.invariantWeight ?? DEFAULT_INVARIANT_WEIGHT;
  const releaseThreshold = options.releaseThreshold ?? DEFAULT_RELEASE_THRESHOLD;

  const sources = criterionSources(state, registry);
  const unavailable = new Set(
    registry.order.filter((key) => registry.criteria[key]?.lifecycle === 'superseded'),
  );

  const criteria: QualityCriterion[] = sources.map((source, index) => {
    const declared = registry.criteria[source.key];
    const classification: CriterionClassification = declared
      ? {
          lifecycle: declared.lifecycle,
          supersededBy: declared.lifecycle === 'superseded' ? declared.supersededBy : null,
        }
      : classifyCriterionSource(sources, index, { invariantWeight, unavailable });

    return {
      key: source.key,
      label: source.label,
      lifecycle: classification.lifecycle,
      phase: classification.lifecycle,
      supersededBy: classification.supersededBy,
      value: source.value,
      target: source.target,
      weight: source.weight,
      satisfaction: criterionSatisfaction(source),
      satisfied: isCriterionSatisfied(source),
      measured: source.measured,
    };
  });

  const milestonePhase = buildPhaseCoverage('milestone', criteria);
  const invariantPhase = buildPhaseCoverage('final_invariant', criteria);
  const finalInvariants = buildCompletion(invariantPhase);
  const superseded = criteria.filter((criterion) => criterion.lifecycle === 'superseded');
  const readiness = weightedReadiness(
    criteria.filter((criterion) => criterion.lifecycle === 'final_invariant'),
  );

  const byKey: Record<string, QualityCriterion> = {};
  for (const criterion of criteria) byKey[criterion.key] = criterion;

  return {
    criteria,
    order: criteria.map((criterion) => criterion.key),
    byKey,
    liveCount: criteria.length - superseded.length,
    supersededCount: superseded.length,
    superseded,
    phases: { milestone: milestonePhase, final_invariant: invariantPhase },
    coverage: {
      milestone: milestonePhase.coverage,
      final_invariant: invariantPhase.coverage,
    },
    finalInvariants,
    readiness,
    releaseThreshold,
    ready: finalInvariants.total > 0 && readiness >= releaseThreshold,
    blockers: finalInvariants.pendingKeys,
    score: weightedScore(criteria),
  };
}

function resolveRegistry(
  input: CriterionRegistry | readonly CriterionDeclaration[] | undefined,
): CriterionRegistry {
  if (input === undefined) return EMPTY_REGISTRY;
  if (isRegistry(input)) return input;
  return createCriterionRegistry(input);
}

function isRegistry(
  value: CriterionRegistry | readonly CriterionDeclaration[],
): value is CriterionRegistry {
  return !Array.isArray(value);
}

/**
 * Criteria in report order: every criterion state has measured, then criteria
 * that are declared but not measured yet. An unmeasured final invariant is an
 * unmet commitment rather than an absent one, so it still belongs in the graph.
 */
function criterionSources(state: QualityGraphView, registry: CriterionRegistry): CriterionSource[] {
  const sources: CriterionSource[] = [];
  const measured = new Set<string>();

  for (const id of state.quality.order) {
    const metric = state.quality.metrics[id];
    if (!metric) continue;
    measured.add(metric.id);
    sources.push({
      key: metric.id,
      label: metric.label,
      value: metric.value,
      target: metric.target,
      weight: metric.weight,
      measured: true,
    });
  }

  for (const key of registry.order) {
    if (measured.has(key)) continue;
    const declared = registry.criteria[key];
    if (!declared) continue;
    sources.push({
      key,
      label: declared.label ?? key,
      value: 0,
      target: 0,
      weight: 0,
      measured: false,
    });
  }

  return sources;
}

function buildPhaseCoverage(
  phase: CriterionPhase,
  criteria: readonly QualityCriterion[],
): PhaseCoverage {
  const satisfiedKeys: string[] = [];
  const unmetKeys: string[] = [];

  for (const criterion of criteria) {
    if (criterion.phase !== phase) continue;
    (criterion.satisfied ? satisfiedKeys : unmetKeys).push(criterion.key);
  }

  const total = satisfiedKeys.length + unmetKeys.length;
  return {
    phase,
    total,
    satisfied: satisfiedKeys.length,
    unmet: unmetKeys.length,
    coverage: ratio(satisfiedKeys.length, total),
    satisfiedKeys,
    unmetKeys,
  };
}

function buildCompletion(coverage: PhaseCoverage): FinalInvariantCompletion {
  return {
    total: coverage.total,
    satisfied: coverage.satisfied,
    pending: coverage.unmet,
    completion: coverage.coverage,
    complete: coverage.total > 0 && coverage.unmet === 0,
    satisfiedKeys: coverage.satisfiedKeys,
    pendingKeys: coverage.unmetKeys,
  };
}

/**
 * Weight-share of the final invariants that hold. Returns 0 when the mission
 * declares none: shipping is never unlocked by the absence of commitments, only
 * by holding them. Because every invariant carries at least
 * {@link UNWEIGHTED_CRITERION_WEIGHT}, one unmet invariant always keeps the
 * result below a threshold of 1.
 */
function weightedReadiness(invariants: readonly QualityCriterion[]): number {
  if (invariants.length === 0) return 0;

  let totalWeight = 0;
  let satisfiedWeight = 0;
  for (const invariant of invariants) {
    const weight = effectiveWeight(invariant);
    totalWeight += weight;
    if (invariant.satisfied) satisfiedWeight += weight;
  }

  return clamp01(satisfiedWeight / totalWeight);
}

/** Weighted satisfaction across every live criterion. */
function weightedScore(criteria: readonly QualityCriterion[]): number {
  let live = 0;
  let totalWeight = 0;
  let weighted = 0;

  for (const criterion of criteria) {
    if (criterion.lifecycle === 'superseded') continue;
    live += 1;
    const weight = effectiveWeight(criterion);
    totalWeight += weight;
    weighted += criterion.satisfaction * weight;
  }

  if (live === 0) return 0;
  return clamp01(weighted / totalWeight);
}

function ratio(part: number, whole: number): number {
  return whole <= 0 ? 0 : clamp01(part / whole);
}

/**
 * Weight a criterion carries when it declares none — an undeclared weight, or a
 * criterion that is registered before state has measured it. Such a criterion
 * takes a full single share instead of being drowned out by weighted siblings, so
 * a declared final invariant is ship-blocking from the moment it exists.
 */
const UNWEIGHTED_CRITERION_WEIGHT = 1;

function effectiveWeight(criterion: CriterionScoreInput): number {
  return criterion.weight > 0 ? criterion.weight : UNWEIGHTED_CRITERION_WEIGHT;
}

/* -------------------------------------------------------------------------- */
/* Selectors for win/loss and the HUD                                         */
/* -------------------------------------------------------------------------- */

/** Overall release-readiness score for `state`. */
export function releaseReadiness(
  state: QualityGraphView,
  options: QualityGraphOptions = {},
): number {
  return updateQualityGraph(state, options).readiness;
}

/** Final-invariant completion — the progress figure win/loss evaluation reads. */
export function finalInvariantCompletion(
  state: QualityGraphView,
  options: QualityGraphOptions = {},
): FinalInvariantCompletion {
  return updateQualityGraph(state, options).finalInvariants;
}

/** True when the mission may ship: final invariants exist and readiness clears it. */
export function isReleaseReady(
  state: QualityGraphView,
  options: QualityGraphOptions = {},
): boolean {
  return updateQualityGraph(state, options).ready;
}

/** One-line release status for the event log and the inspector panel. */
export function summarizeQualityGraph(graph: QualityGraph): string {
  const invariants = graph.finalInvariants;
  return (
    `[release] ${graph.ready ? 'ready' : 'not ready'}` +
    ` · readiness ${graph.readiness.toFixed(2)}/${graph.releaseThreshold.toFixed(2)}` +
    ` · final invariants ${invariants.satisfied}/${invariants.total}` +
    ` · coverage milestone ${graph.coverage.milestone.toFixed(2)},` +
    ` final_invariant ${graph.coverage.final_invariant.toFixed(2)}` +
    ` · ${graph.supersededCount} superseded`
  );
}
