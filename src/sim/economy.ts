/**
 * Context budget, credits, reputation and deadlines.
 *
 * This is the accounting layer of the factory. Mission 5 of the campaign runs the
 * floor on a *finite* context window: every dispatched agent, every verification
 * run and every fix-up burns context tokens, credits and a little reputation,
 * while the mission clock keeps walking towards a hard deadline. The game is
 * about prioritising inside those limits, so the limits live here, in one
 * deterministic module, rather than being sprinkled through the systems that do
 * the work.
 *
 * What one tick does
 *
 *  1. **Accrues context.** The mission clock earns `contextAccrualPerSecond`
 *     tokens per simulated second, capped by the mission's finite allowance
 *     (`state.economy.contextBudget`). Accrual is *derived* from the clock, never
 *     stored: two callers that report the same simulated time see the same
 *     allowance, and repeating a tick cannot earn tokens twice.
 *  2. **Accrues credits.** Active plan tasks earn `runningTasks ×
 *     creditRatePerTask` credits per simulated second — exactly the rate the
 *     derived `economy.creditsPerSecond` advertises.
 *  3. **Settles activities.** Every record handed in via `activities` requests
 *     the cost configured for its kind (`dispatch`, `verification`, `fixup`).
 *     Costs are charged against what the mission has actually accrued, in a
 *     deterministic order, so the budget can never go negative: an activity that
 *     cannot be funded is reported as *starved* and spends only the headroom
 *     that exists.
 *  4. **Applies reputation.** Dispatch is neutral, verification earns trust and a
 *     fix-up burns it; a starved activity never improves reputation and instead
 *     takes the harsher of its own delta and `starvingReputationPenalty`.
 *  5. **Evaluates pressure.** Deadline pressure (`elapsed / deadline`) rises with
 *     the mission clock and is banded `safe` → `warning` → `critical` →
 *     `expired`, and budget exhaustion is latched *once* per mission: the tick
 *     that burns the last token reports `exhaustion.reported === true` and no
 *     later tick repeats it, so the flow layer can declare a loss exactly once.
 *
 * Determinism and purity
 *
 *  - `applyEconomyTick(state, input)` returns new objects: the input `state` and
 *    the caller's `activities` array are never mutated.
 *  - Results depend on nothing but their arguments — no wall clock, no
 *    randomness, no DOM, no three.js, no imports of the lane or verification
 *    modules. Replaying a mission therefore yields identical economies.
 *  - Exhaustion needs no hidden latch: `contextSpent` is monotone and clamped to
 *    the allowance, which makes "the last token is gone" a single, reproducible
 *    tick.
 *
 * Integration
 *
 *  - Every effect is emitted as a standard domain event (`economy/spend`,
 *    `economy/reward`, `economy/deadline`) stamped at the tick clock, so reducing
 *    them through `applyDomainEvents` produces exactly the state the report
 *    describes. Reducing them also moves `mission.elapsedMs` forward, which is
 *    the clock the HUD renders.
 *  - The allowance, the credit rate and the deadline length are read from
 *    `state.economy` so the HUD, the flow layer and this module always quote the
 *    same numbers. The exported `DEFAULT_*` tuning constants are the values
 *    mission definitions pass to `createInitialState`, and the per-tick
 *    `tuning` overrides carry the rates that have no home in the slice
 *    (accrual, costs, penalties, pressure bands).
 *  - The clock reading (`remainingMs`, `pressure`, `band`, `expired`) and
 *    `context.remainingTokens` / `context.remainingFraction` are the values the
 *    mission clock and the depletion bar show.
 */

import {
  applyDomainEvents,
  makeDomainEvent,
  type DomainEvent,
  type GameState,
} from './state';

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/** The three ways work burns the factory's resources. */
export type EconomyActivityKind = 'dispatch' | 'verification' | 'fixup';

/** Stable kind order: used for tuning tables, reports and tests. */
export const ECONOMY_ACTIVITY_KINDS: readonly EconomyActivityKind[] = ['dispatch', 'verification', 'fixup'];

/** A cost triple: context tokens, credits and the reputation the activity moves. */
export interface EconomyCost {
  /** Context tokens drawn from the mission's finite allowance. */
  readonly contextTokens: number;
  /** Credits taken out of the vault. */
  readonly credits: number;
  /** Reputation earned (positive) or burned (negative). */
  readonly reputation: number;
}

/**
 * One resource-consuming activity.
 *
 * The record is produced by whichever system did the work — the lane system for
 * a dispatch, the verification system for a run, the flow layer for a fix-up —
 * and handed to {@link applyEconomyTick}. That indirection is deliberate: this
 * module never imports those modules, it only prices the records it is given,
 * which keeps dispatch, verification and repair free of accounting code.
 */
export interface EconomyActivity {
  /** Stable activity id, carried into the settlement report. */
  readonly id: string;
  readonly kind: EconomyActivityKind;
  /** Simulated millisecond the activity consumed resources at. */
  readonly atMs: number;
  /** Optional per-activity overrides on top of the configured kind cost. */
  readonly cost?: Partial<EconomyCost>;
  /** Optional task or gate label carried into the settlement report. */
  readonly label?: string;
}

/* -------------------------------------------------------------------------- */
/* Tuning constants                                                           */
/* -------------------------------------------------------------------------- */

/** Tokens one dispatched task burns while its lane works (the priciest step). */
export const DISPATCH_COST: EconomyCost = { contextTokens: 4_800, credits: 140, reputation: 0 };
/** Tokens one verification run burns; proving work earns a little reputation. */
export const VERIFICATION_COST: EconomyCost = { contextTokens: 2_400, credits: 60, reputation: 1 };
/** Tokens one fix-up burns; repairs are expensive and erode trust. */
export const FIXUP_COST: EconomyCost = { contextTokens: 3_600, credits: 220, reputation: -4 };

/** Context tokens the mission clock earns per simulated second. */
export const CONTEXT_ACCRUAL_PER_SECOND = 2_400;
/** Finite token allowance a mission gets when its definition does not set one. */
export const DEFAULT_CONTEXT_BUDGET = 200_000;
/** Credits an active task earns per simulated second. */
export const DEFAULT_CREDIT_RATE_PER_TASK = 12;
/** Deadline length a mission falls back to when its definition does not set one (45 min). */
export const DEFAULT_DEADLINE_MS = 45 * 60 * 1000;
/** Reputation a starved activity burns instead of its own delta. */
export const STARVING_REPUTATION_PENALTY = -3;
/** Deadline pressure at which the mission clock turns urgent. */
export const DEADLINE_WARNING_PRESSURE = 0.75;
/** Deadline pressure at which the mission clock turns critical. */
export const DEADLINE_CRITICAL_PRESSURE = 0.9;

/* -------------------------------------------------------------------------- */
/* Tuning                                                                     */
/* -------------------------------------------------------------------------- */

/** Every number a mission may rebalance without touching the simulation code. */
export interface EconomyTuning {
  /** Mission-definition default for the finite allowance (state carries the live value). */
  readonly contextBudget: number;
  /** Context tokens earned per simulated second, capped by the allowance. */
  readonly contextAccrualPerSecond: number;
  /** Mission-definition default for the per-task credit rate. */
  readonly creditRatePerTask: number;
  /** Mission-definition default for the deadline length. */
  readonly deadlineMs: number;
  /** Configured cost per activity kind. */
  readonly costs: Readonly<Record<EconomyActivityKind, EconomyCost>>;
  /** Reputation a starved activity takes when it cannot be funded. */
  readonly starvingReputationPenalty: number;
  /** Pressure at which the clock is reported as `warning`. */
  readonly deadlineWarningPressure: number;
  /** Pressure at which the clock is reported as `critical`. */
  readonly deadlineCriticalPressure: number;
}

/** Mission overrides: every field optional, cost overrides per activity kind. */
export type EconomyTuningOverrides = Partial<Omit<EconomyTuning, 'costs'>> & {
  readonly costs?: Partial<Record<EconomyActivityKind, Partial<EconomyCost>>>;
};

/** The shipped balance: cheap verification, expensive dispatch and painful repairs. */
export const DEFAULT_ECONOMY_TUNING: EconomyTuning = {
  contextBudget: DEFAULT_CONTEXT_BUDGET,
  contextAccrualPerSecond: CONTEXT_ACCRUAL_PER_SECOND,
  creditRatePerTask: DEFAULT_CREDIT_RATE_PER_TASK,
  deadlineMs: DEFAULT_DEADLINE_MS,
  costs: {
    dispatch: DISPATCH_COST,
    verification: VERIFICATION_COST,
    fixup: FIXUP_COST,
  },
  starvingReputationPenalty: STARVING_REPUTATION_PENALTY,
  deadlineWarningPressure: DEADLINE_WARNING_PRESSURE,
  deadlineCriticalPressure: DEADLINE_CRITICAL_PRESSURE,
};

/**
 * Merge mission overrides onto the defaults.
 *
 * Numbers are normalised rather than trusted: tokens and credits are rounded to
 * whole non-negative values, and a non-positive allowance/rate/accrual falls
 * back to the default so a malformed mission definition cannot silently turn
 * every activity into a starved one.
 */
export function resolveEconomyTuning(overrides: EconomyTuningOverrides = {}): EconomyTuning {
  const costs: Record<EconomyActivityKind, EconomyCost> = {
    dispatch: resolveCost('dispatch', overrides.costs?.dispatch),
    verification: resolveCost('verification', overrides.costs?.verification),
    fixup: resolveCost('fixup', overrides.costs?.fixup),
  };

  return {
    contextBudget: Math.max(0, Math.round(positive(overrides.contextBudget, DEFAULT_CONTEXT_BUDGET))),
    contextAccrualPerSecond: nonNegative(overrides.contextAccrualPerSecond, CONTEXT_ACCRUAL_PER_SECOND),
    creditRatePerTask: nonNegative(overrides.creditRatePerTask, DEFAULT_CREDIT_RATE_PER_TASK),
    deadlineMs: Math.max(0, Math.round(nonNegative(overrides.deadlineMs, DEFAULT_DEADLINE_MS))),
    costs,
    starvingReputationPenalty: finiteOr(overrides.starvingReputationPenalty, STARVING_REPUTATION_PENALTY),
    deadlineWarningPressure: clamp01(finiteOr(overrides.deadlineWarningPressure, DEADLINE_WARNING_PRESSURE)),
    deadlineCriticalPressure: clamp01(finiteOr(overrides.deadlineCriticalPressure, DEADLINE_CRITICAL_PRESSURE)),
  };
}

/**
 * Resolve the cost of one activity kind.
 *
 * `override` wins field by field over the tuning table, so a single exceptional
 * activity can be priced without redefining the whole balance.
 */
export function activityCost(
  kind: EconomyActivityKind,
  override?: Partial<EconomyCost>,
  tuning: EconomyTuning = DEFAULT_ECONOMY_TUNING,
): EconomyCost {
  const base = tuning.costs[kind] ?? DEFAULT_ECONOMY_TUNING.costs[kind];
  return normalizeCost({
    contextTokens: override?.contextTokens ?? base.contextTokens,
    credits: override?.credits ?? base.credits,
    reputation: override?.reputation ?? base.reputation,
  });
}

/**
 * Build an activity record with a deterministic default id.
 *
 * Helper for the systems that dispatch and verify work: they describe *what*
 * happened, this module decides what it costs.
 */
export function createEconomyActivity(
  kind: EconomyActivityKind,
  atMs: number,
  options: { id?: string; label?: string; cost?: Partial<EconomyCost> } = {},
): EconomyActivity {
  const at = Math.max(0, finiteOr(atMs, 0));
  return {
    id: options.id ?? `${kind}@${at}`,
    kind,
    atMs: at,
    cost: options.cost ? { ...options.cost } : undefined,
    label: options.label,
  };
}

/* -------------------------------------------------------------------------- */
/* Accrual                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Context tokens the mission has earned by `elapsedMs`.
 *
 * Floored to whole tokens and capped by the finite allowance, so accrual is a
 * pure, monotone function of the clock: more time can never mean fewer tokens,
 * and no amount of time can exceed the mission's allowance.
 */
export function accruedContextTokens(
  elapsedMs: number,
  allowanceTokens: number,
  accrualPerSecond: number = CONTEXT_ACCRUAL_PER_SECOND,
): number {
  const allowance = Math.max(0, Math.round(finiteOr(allowanceTokens, 0)));
  if (allowance === 0) return 0;
  const seconds = Math.max(0, finiteOr(elapsedMs, 0)) / 1000;
  const earned = Math.floor(seconds * Math.max(0, finiteOr(accrualPerSecond, 0)));
  return earned >= allowance ? allowance : earned;
}

/* -------------------------------------------------------------------------- */
/* Readings                                                                   */
/* -------------------------------------------------------------------------- */

/** How much of the finite context allowance is left, and what is spendable now. */
export interface EconomyContextReading {
  /** The mission's finite token allowance (`state.economy.contextBudget`). */
  readonly allowanceTokens: number;
  /** Tokens earned by the mission clock so far, capped by the allowance. */
  readonly accruedTokens: number;
  /** Cumulative tokens spent, clamped to the allowance. */
  readonly spentTokens: number;
  /** `allowanceTokens - spentTokens`, never negative: the depletion bar's value. */
  readonly remainingTokens: number;
  /** `accruedTokens - spentTokens`, never negative: what a tick could spend now. */
  readonly availableTokens: number;
  /** 0..1 share of the allowance already burned. */
  readonly spentFraction: number;
  /** 0..1 share of the allowance still available. */
  readonly remainingFraction: number;
  /** Tokens earned per simulated second. */
  readonly accrualPerSecond: number;
}

/** Urgency band of the mission clock. */
export type EconomyClockBand = 'safe' | 'warning' | 'critical' | 'expired';

/** The mission clock: elapsed, deadline, remaining time and pressure. */
export interface EconomyClockReading {
  readonly elapsedMs: number;
  readonly deadlineMs: number;
  readonly remainingMs: number;
  /** 0..1 share of the deadline consumed; `0` when the mission has no deadline. */
  readonly pressure: number;
  readonly band: EconomyClockBand;
  readonly expired: boolean;
}

/** Options shared by the read-only selectors. */
export interface EconomyReadingOptions {
  /** Simulated time to read at. Defaults to `state.mission.elapsedMs`. */
  readonly atMs?: number;
  /** Mission tuning overrides (accrual rate, penalties, pressure bands). */
  readonly tuning?: EconomyTuningOverrides;
}

/** Context budget reading for the HUD and the flow layer. */
export function readEconomyContext(
  state: GameState,
  options: EconomyReadingOptions = {},
): EconomyContextReading {
  return contextReading(state, options.atMs ?? state.mission.elapsedMs, resolveEconomyTuning(options.tuning));
}

/**
 * Deadline reading for the mission clock.
 *
 * A deadline of zero or less means the mission runs without clock pressure
 * (`expired === false`, `pressure === 0`), which is exactly how the HUD reads a
 * cleared deadline; any positive deadline bands the clock as it is consumed.
 */
export function readEconomyClock(
  state: GameState,
  options: EconomyReadingOptions = {},
): EconomyClockReading {
  return clockReading(
    options.atMs ?? state.mission.elapsedMs,
    state.economy.deadlineMs,
    resolveEconomyTuning(options.tuning),
  );
}

/** Deadline pressure plus the exhaustion latch, without settling anything. */
export interface EconomyPressureReading {
  readonly context: EconomyContextReading;
  readonly clock: EconomyClockReading;
  /**
   * Mission-level latch: the finite allowance is fully consumed.
   *
   * A mission that declares no allowance can never exhaust — it simply cannot
   * spend — so missions must declare a positive `contextBudget` to opt into the
   * loss condition.
   */
  readonly exhausted: boolean;
}

/** Read the mission's pressure without ticking: what the flow layer evaluates. */
export function readEconomyPressure(
  state: GameState,
  options: EconomyReadingOptions = {},
): EconomyPressureReading {
  const tuning = resolveEconomyTuning(options.tuning);
  const atMs = options.atMs ?? state.mission.elapsedMs;
  const context = contextReading(state, atMs, tuning);
  return {
    context,
    clock: clockReading(atMs, state.economy.deadlineMs, tuning),
    exhausted: context.allowanceTokens > 0 && context.spentTokens >= context.allowanceTokens,
  };
}

/* -------------------------------------------------------------------------- */
/* Tick contract                                                              */
/* -------------------------------------------------------------------------- */

/** Everything one economy tick needs. Every field is optional. */
export interface EconomyTickInput {
  /** Absolute simulated time the tick lands on. */
  readonly atMs?: number;
  /** Simulated milliseconds since the state's clock; ignored when `atMs` is given. */
  readonly deltaMs?: number;
  /**
   * Work to price in this tick. Records may be stamped at any simulated time in
   * the tick's past: the tick funds them from the allowance accrued by the time
   * the tick lands on.
   */
  readonly activities?: readonly EconomyActivity[];
  /** Per-mission tuning overrides. */
  readonly tuning?: EconomyTuningOverrides;
  /**
   * Install a new mission deadline, emitting `economy/deadline` when it differs
   * from the one already in state.
   */
  readonly deadlineMs?: number;
}

/** One priced activity: what it asked for and what the mission could pay. */
export interface ActivitySettlement {
  readonly activityId: string;
  readonly kind: EconomyActivityKind;
  readonly label: string | null;
  readonly atMs: number;
  /** The cost the activity asked for. */
  readonly requested: EconomyCost;
  /** What the mission actually paid (never more than `requested`). */
  readonly charged: EconomyCost;
  /** Tokens the activity asked for and did not get. */
  readonly starvedTokens: number;
  /** Credits the activity asked for and did not get. */
  readonly unaffordableCredits: number;
  /** True when the activity could not fund its token cost. */
  readonly starved: boolean;
  /** Reputation actually applied, after clamping and the starvation rule. */
  readonly reputationDelta: number;
}

/** What this tick paid for. */
export interface EconomyChargeReport {
  readonly tokens: number;
  readonly credits: number;
  readonly activityCount: number;
}

/** Work the mission could not pay for during this tick. */
export interface EconomyStarvationReport {
  /** Tokens demanded but not funded. */
  readonly starvedTokens: number;
  /** Credits demanded but not funded. */
  readonly unaffordableCredits: number;
  /** Ids of the activities that went short, in settlement order. */
  readonly starvedActivityIds: readonly string[];
  /** True when at least one activity went short. */
  readonly starved: boolean;
}

/** Credit movements of one tick. */
export interface EconomyCreditReport {
  readonly before: number;
  readonly after: number;
  /** Credits earned by the running tasks during the tick. */
  readonly earned: number;
  /** Credits paid out to the settled activities. */
  readonly spent: number;
  /** Derived earning rate the state advertises (`runningTasks × ratePerTask`). */
  readonly perSecond: number;
  readonly runningTasks: number;
  readonly ratePerTask: number;
}

/** Reputation movements of one tick. */
export interface EconomyReputationReport {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

/**
 * The mission's exhaustion latch.
 *
 * `exhausted` is a predicate over state (true from the tick that burned the last
 * token onwards); `reported` is true *only* on that crossing tick, which is how
 * the flow layer declares the loss exactly once per mission.
 */
export interface EconomyExhaustionReport {
  readonly exhausted: boolean;
  readonly reported: boolean;
  /** Simulated time of the crossing tick, or `null` on every other tick. */
  readonly atMs: number | null;
}

/** Everything one economy tick decided. */
export interface EconomyReport {
  /** Simulated time this tick accounted for — never behind `state.mission.elapsedMs`. */
  readonly atMs: number;
  /** Simulated milliseconds this tick advanced. */
  readonly deltaMs: number;
  readonly context: EconomyContextReading;
  readonly charges: EconomyChargeReport;
  readonly starvation: EconomyStarvationReport;
  readonly credits: EconomyCreditReport;
  readonly reputation: EconomyReputationReport;
  readonly clock: EconomyClockReading;
  /** True only on the tick that crossed the deadline — the clock's loss signal. */
  readonly deadlineLapsed: boolean;
  readonly exhaustion: EconomyExhaustionReport;
  /** Per-activity settlements, in settlement order. */
  readonly activities: readonly ActivitySettlement[];
}

/** Result of one economy tick. */
export interface EconomyTickResult {
  /** State after the emitted events are reduced; the input state is untouched. */
  state: GameState;
  events: DomainEvent[];
  report: EconomyReport;
}

/* -------------------------------------------------------------------------- */
/* Tick                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Price one step of factory work against the mission's context budget, credits,
 * reputation and deadline.
 *
 * Pure and side-effect free: the same `(state, input)` triple always produces the
 * same events, state and report, so a mission can be replayed tick for tick.
 */
export function applyEconomyTick(state: GameState, input: EconomyTickInput = {}): EconomyTickResult {
  const tuning = resolveEconomyTuning(input.tuning);
  const elapsedBefore = Math.max(0, finiteOr(state.mission.elapsedMs, 0));

  // Settle in (time, declaration) order so the charging sequence is deterministic.
  const entries = (input.activities ?? [])
    .map((activity, index) => ({
      activity,
      index,
      atMs: Math.max(0, finiteOr(activity.atMs, elapsedBefore)),
    }))
    .sort((a, b) => a.atMs - b.atMs || a.index - b.index);

  const requestedAt =
    input.atMs === undefined
      ? elapsedBefore + Math.max(0, finiteOr(input.deltaMs, 0))
      : Math.max(0, finiteOr(input.atMs, elapsedBefore));
  let atMs = Math.max(elapsedBefore, requestedAt);
  for (const entry of entries) atMs = Math.max(atMs, entry.atMs);

  // --- context -----------------------------------------------------------------
  const allowanceTokens = Math.max(0, finiteOr(state.economy.contextBudget, 0));
  const accrualPerSecond = tuning.contextAccrualPerSecond;
  const spentBefore = clamp(finiteOr(state.economy.contextSpent, 0), 0, allowanceTokens);
  const accruedTokens = accruedContextTokens(atMs, allowanceTokens, accrualPerSecond);
  const availableTokens = Math.max(0, accruedTokens - spentBefore);
  let headroom = availableTokens;

  // --- credits -----------------------------------------------------------------
  const runningTasks = countRunningTasks(state);
  const ratePerTask = nonNegative(state.economy.creditRatePerTask, tuning.creditRatePerTask);
  const creditsPerSecond = runningTasks * ratePerTask;
  const deltaMs = Math.max(0, atMs - elapsedBefore);
  const creditsBefore = clamp(finiteOr(state.economy.credits, 0), 0, MAX_CREDITS);
  const creditsEarned = Math.min(MAX_CREDITS, creditsPerSecond * (deltaMs / 1000));
  let credits = clamp(creditsBefore + creditsEarned, 0, MAX_CREDITS);

  // --- reputation --------------------------------------------------------------
  const reputationBefore = clamp(finiteOr(state.economy.reputation, 0), 0, 100);
  let reputation = reputationBefore;

  // --- activities --------------------------------------------------------------
  const activities: ActivitySettlement[] = [];
  const starvedActivityIds: string[] = [];
  let chargedTokens = 0;
  let chargedCredits = 0;
  let starvedTokens = 0;
  let unaffordableCredits = 0;

  for (const entry of entries) {
    const { activity } = entry;
    const requested = activityCost(activity.kind, activity.cost, tuning);

    const fundedTokens = Math.min(requested.contextTokens, headroom);
    const missingTokens = requested.contextTokens - fundedTokens;
    headroom -= fundedTokens;
    chargedTokens += fundedTokens;
    starvedTokens += missingTokens;

    const fundedCredits = Math.min(requested.credits, credits);
    const missingCredits = requested.credits - fundedCredits;
    credits -= fundedCredits;
    chargedCredits += fundedCredits;
    unaffordableCredits += missingCredits;

    const starved = missingTokens > 0;
    if (starved) starvedActivityIds.push(activity.id);

    // An activity that starved never improves reputation: it takes the harsher of
    // its own delta and the starvation penalty.
    const appliedReputation = starved
      ? Math.min(requested.reputation, tuning.starvingReputationPenalty)
      : requested.reputation;
    const reputationAtStart = reputation;
    reputation = clamp(reputation + appliedReputation, 0, 100);

    activities.push({
      activityId: activity.id,
      kind: activity.kind,
      label: activity.label ?? null,
      atMs: entry.atMs,
      requested,
      charged: { contextTokens: fundedTokens, credits: fundedCredits, reputation: appliedReputation },
      starvedTokens: missingTokens,
      unaffordableCredits: missingCredits,
      starved,
      reputationDelta: reputation - reputationAtStart,
    });
  }

  // --- exhaustion --------------------------------------------------------------
  const spentAfter = Math.min(allowanceTokens, spentBefore + chargedTokens);
  const exhaustedBefore = allowanceTokens > 0 && spentBefore >= allowanceTokens;
  const exhausted = allowanceTokens > 0 && spentAfter >= allowanceTokens;
  const exhaustionReported = exhausted && !exhaustedBefore;

  // --- deadline ----------------------------------------------------------------
  const deadlineBefore = Math.max(0, finiteOr(state.economy.deadlineMs, 0));
  const deadlineAfter =
    input.deadlineMs === undefined
      ? deadlineBefore
      : Math.max(0, finiteOr(input.deadlineMs, deadlineBefore));
  const clockBefore = clockReading(elapsedBefore, deadlineBefore, tuning);
  const clock = clockReading(atMs, deadlineAfter, tuning);

  // --- events ------------------------------------------------------------------
  const events: DomainEvent[] = [];
  if (creditsEarned > 0) {
    events.push(makeDomainEvent('economy/reward', { credits: creditsEarned, reputation: 0 }, atMs));
  }
  if (deadlineAfter !== deadlineBefore) {
    events.push(makeDomainEvent('economy/deadline', { deadlineMs: deadlineAfter }, atMs));
  }
  for (const settlement of activities) {
    if (settlement.charged.contextTokens > 0 || settlement.charged.credits > 0) {
      events.push(
        makeDomainEvent(
          'economy/spend',
          { credits: settlement.charged.credits, contextTokens: settlement.charged.contextTokens },
          atMs,
        ),
      );
    }
    if (settlement.reputationDelta !== 0) {
      events.push(
        makeDomainEvent('economy/reward', { credits: 0, reputation: settlement.reputationDelta }, atMs),
      );
    }
  }

  const nextState = events.length === 0 ? state : applyDomainEvents(state, events);
  const remainingTokens = Math.max(0, allowanceTokens - spentAfter);

  const report: EconomyReport = {
    atMs,
    deltaMs,
    context: {
      allowanceTokens,
      accruedTokens,
      spentTokens: spentAfter,
      remainingTokens,
      availableTokens,
      spentFraction: allowanceTokens === 0 ? 1 : clamp01(spentAfter / allowanceTokens),
      remainingFraction: allowanceTokens === 0 ? 0 : clamp01(remainingTokens / allowanceTokens),
      accrualPerSecond,
    },
    charges: { tokens: chargedTokens, credits: chargedCredits, activityCount: activities.length },
    starvation: {
      starvedTokens,
      unaffordableCredits,
      starvedActivityIds,
      starved: starvedTokens > 0 || unaffordableCredits > 0,
    },
    credits: {
      before: creditsBefore,
      after: credits,
      earned: creditsEarned,
      spent: chargedCredits,
      perSecond: creditsPerSecond,
      runningTasks,
      ratePerTask,
    },
    reputation: {
      before: reputationBefore,
      after: reputation,
      delta: reputation - reputationBefore,
    },
    clock,
    deadlineLapsed: clock.expired && !clockBefore.expired,
    exhaustion: {
      exhausted,
      reported: exhaustionReported,
      atMs: exhaustionReported ? atMs : null,
    },
    activities,
  };

  return { state: nextState, events, report };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/** Credits cannot exceed the safe-integer range the state contract clamps to. */
const MAX_CREDITS = Number.MAX_SAFE_INTEGER;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const clamp01 = (value: number): number => clamp(value, 0, 1);

const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const nonNegative = (value: number | undefined, fallback: number): number => {
  const resolved = finiteOr(value, fallback);
  return resolved >= 0 ? resolved : fallback;
};

const positive = (value: number | undefined, fallback: number): number => {
  const resolved = finiteOr(value, fallback);
  return resolved > 0 ? resolved : fallback;
};

/** Normalise a cost: whole non-negative tokens/credits, signed reputation. */
function normalizeCost(cost: EconomyCost): EconomyCost {
  return {
    contextTokens: Math.max(0, Math.round(finiteOr(cost.contextTokens, 0))),
    credits: Math.max(0, finiteOr(cost.credits, 0)),
    reputation: finiteOr(cost.reputation, 0),
  };
}

function resolveCost(kind: EconomyActivityKind, override?: Partial<EconomyCost>): EconomyCost {
  return activityCost(kind, override, DEFAULT_ECONOMY_TUNING);
}

/** Running plan tasks are the ones that earn credits for the factory. */
function countRunningTasks(state: GameState): number {
  let running = 0;
  for (const task of Object.values(state.plan.tasks)) {
    if (task.status === 'running') running += 1;
  }
  return running;
}

function contextReading(
  state: GameState,
  atMs: number,
  tuning: EconomyTuning,
): EconomyContextReading {
  const allowanceTokens = Math.max(0, finiteOr(state.economy.contextBudget, 0));
  const spentTokens = clamp(finiteOr(state.economy.contextSpent, 0), 0, allowanceTokens);
  const accruedTokens = accruedContextTokens(atMs, allowanceTokens, tuning.contextAccrualPerSecond);
  const remainingTokens = Math.max(0, allowanceTokens - spentTokens);
  return {
    allowanceTokens,
    accruedTokens,
    spentTokens,
    remainingTokens,
    availableTokens: Math.max(0, accruedTokens - spentTokens),
    spentFraction: allowanceTokens === 0 ? 1 : clamp01(spentTokens / allowanceTokens),
    remainingFraction: allowanceTokens === 0 ? 0 : clamp01(remainingTokens / allowanceTokens),
    accrualPerSecond: tuning.contextAccrualPerSecond,
  };
}

function clockReading(elapsedMs: number, deadlineMs: number, tuning: EconomyTuning): EconomyClockReading {
  const elapsed = Math.max(0, finiteOr(elapsedMs, 0));
  const deadline = Math.max(0, finiteOr(deadlineMs, 0));
  const expired = deadline > 0 && elapsed >= deadline;
  const pressure = deadline === 0 ? 0 : clamp01(elapsed / deadline);
  const band: EconomyClockBand = expired
    ? 'expired'
    : pressure >= tuning.deadlineCriticalPressure
      ? 'critical'
      : pressure >= tuning.deadlineWarningPressure
        ? 'warning'
        : 'safe';
  return {
    elapsedMs: elapsed,
    deadlineMs: deadline,
    remainingMs: Math.max(0, deadline - elapsed),
    pressure,
    band,
    expired,
  };
}
