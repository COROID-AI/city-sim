/**
 * Context budget, credits, reputation and deadlines.
 *
 * The economy layer must stay headless and pure: these tests drive
 * `src/sim/economy.ts` with explicit activity records (no lane, verification or
 * render module is imported) over the real `GameState` contract and the
 * deterministic sample fixture.
 */

import { describe, expect, it } from 'vitest';

import { createSampleState } from '../src/sim/fixtures';
import {
  applyDomainEvents,
  createInitialState,
  makeDomainEvent,
  type DomainEvent,
  type GameState,
  type InitialStateOptions,
} from '../src/sim/state';
import {
  CONTEXT_ACCRUAL_PER_SECOND,
  DEFAULT_CONTEXT_BUDGET,
  DEFAULT_DEADLINE_MS,
  DEFAULT_ECONOMY_TUNING,
  DEADLINE_CRITICAL_PRESSURE,
  DEADLINE_WARNING_PRESSURE,
  DISPATCH_COST,
  ECONOMY_ACTIVITY_KINDS,
  FIXUP_COST,
  STARVING_REPUTATION_PENALTY,
  VERIFICATION_COST,
  accruedContextTokens,
  activityCost,
  applyEconomyTick,
  createEconomyActivity,
  readEconomyClock,
  readEconomyContext,
  readEconomyPressure,
  resolveEconomyTuning,
  type ActivitySettlement,
  type EconomyActivity,
  type EconomyActivityKind,
  type EconomyTickResult,
} from '../src/sim/economy';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const LANE_ID = 'lane-build';

/**
 * A mission with one running task: the plan slice earns credits while the
 * economy is asked to pay for dispatch, verification and fix-ups.
 *
 * The setup events all land on simulated time 0 so the clock arithmetic in the
 * expectations below stays readable.
 */
function missionState(overrides: Partial<InitialStateOptions> = {}): GameState {
  const initial = createInitialState({
    missionId: 'mission-economy',
    codename: 'ECON-TEST',
    startingCredits: 5_000,
    creditRatePerTask: 12,
    contextBudget: 200_000,
    reputation: 50,
    deadlineMs: 600_000,
    ...overrides,
  });

  return applyDomainEvents(initial, [
    makeDomainEvent('mission/started', {}, 0),
    makeDomainEvent('lane/registered', { lane: { id: LANE_ID, kind: 'build', label: 'Build' } }, 0),
    makeDomainEvent('plan/task-registered', { task: { id: 'task-a', title: 'Task A', laneId: LANE_ID } }, 0),
    makeDomainEvent('lane/assigned', { laneId: LANE_ID, taskId: 'task-a' }, 0),
  ]);
}

const settlementOf = (result: EconomyTickResult, id: string): ActivitySettlement | undefined =>
  result.report.activities.find((entry) => entry.activityId === id);

/* -------------------------------------------------------------------------- */
/* Tuning                                                                     */
/* -------------------------------------------------------------------------- */

describe('tuning', () => {
  it('exports the constants mission definitions override', () => {
    expect(ECONOMY_ACTIVITY_KINDS).toEqual(['dispatch', 'verification', 'fixup']);
    expect(DISPATCH_COST.contextTokens).toBeGreaterThan(VERIFICATION_COST.contextTokens);
    expect(DISPATCH_COST.contextTokens).toBeGreaterThan(FIXUP_COST.contextTokens);
    expect(FIXUP_COST.credits).toBeGreaterThan(DISPATCH_COST.credits);
    expect(VERIFICATION_COST.reputation).toBeGreaterThan(0);
    expect(FIXUP_COST.reputation).toBeLessThan(0);
    expect(CONTEXT_ACCRUAL_PER_SECOND).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_BUDGET).toBeGreaterThan(0);
    expect(DEFAULT_DEADLINE_MS).toBeGreaterThan(0);
    expect(STARVING_REPUTATION_PENALTY).toBeLessThan(0);
    expect(DEADLINE_WARNING_PRESSURE).toBeLessThan(DEADLINE_CRITICAL_PRESSURE);
  });

  it('merges overrides without mutating the shipped balance', () => {
    const tuning = resolveEconomyTuning({
      contextAccrualPerSecond: 10,
      deadlineWarningPressure: 0.5,
      costs: { dispatch: { contextTokens: 5, credits: 1, reputation: -2 } },
    });

    expect(tuning.contextAccrualPerSecond).toBe(10);
    expect(tuning.deadlineWarningPressure).toBe(0.5);
    expect(tuning.costs.dispatch).toEqual({ contextTokens: 5, credits: 1, reputation: -2 });
    expect(tuning.costs.verification).toEqual({ ...VERIFICATION_COST });
    expect(tuning.costs.fixup).toEqual({ ...FIXUP_COST });
    expect(DEFAULT_ECONOMY_TUNING.costs.dispatch).toEqual({ ...DISPATCH_COST });

    // A malformed definition cannot silently turn every activity into a starved one.
    expect(resolveEconomyTuning({ contextAccrualPerSecond: -1 }).contextAccrualPerSecond).toBe(
      CONTEXT_ACCRUAL_PER_SECOND,
    );
    expect(resolveEconomyTuning({ contextBudget: 0 }).contextBudget).toBe(DEFAULT_CONTEXT_BUDGET);
  });

  it('resolves per-activity costs on top of the tuning table', () => {
    expect(activityCost('dispatch')).toEqual({ ...DISPATCH_COST });
    expect(activityCost('dispatch', { contextTokens: 12 })).toEqual({ ...DISPATCH_COST, contextTokens: 12 });
    expect(activityCost('fixup', { contextTokens: -5, credits: -2 }).contextTokens).toBe(0);
    expect(activityCost('fixup', { contextTokens: -5, credits: -2 }).credits).toBe(0);
    expect(activityCost('verification', undefined, resolveEconomyTuning({})).reputation).toBe(1);
    expect(
      activityCost('verification', undefined, resolveEconomyTuning({ costs: { verification: { credits: 7 } } }))
        .credits,
    ).toBe(7);
  });

  it('builds activity records with deterministic ids', () => {
    const activity = createEconomyActivity('dispatch', 1_500, { label: 'task-a' });
    expect(activity).toEqual({ id: 'dispatch@1500', kind: 'dispatch', atMs: 1_500, cost: undefined, label: 'task-a' });
    expect(createEconomyActivity('fixup', -10).atMs).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Accrual                                                                    */
/* -------------------------------------------------------------------------- */

describe('context accrual', () => {
  it('earns tokens with the mission clock, capped by the finite allowance', () => {
    expect(accruedContextTokens(0, 200_000, 2_400)).toBe(0);
    expect(accruedContextTokens(1_000, 200_000, 2_400)).toBe(2_400);
    expect(accruedContextTokens(10_000, 200_000, 2_400)).toBe(24_000);
    expect(accruedContextTokens(10 * 60_000, 200_000, 2_400)).toBe(200_000);
    expect(accruedContextTokens(-5_000, 200_000, 2_400)).toBe(0);
  });

  it('reads the allowance, spend and headroom from state', () => {
    const state = missionState();
    const early = readEconomyContext(state, { atMs: 1_000 });
    const later = readEconomyContext(state, { atMs: 30_000 });

    expect(early.accruedTokens).toBe(2_400);
    expect(later.accruedTokens).toBe(72_000);
    expect(later.accruedTokens).toBeGreaterThan(early.accruedTokens);
    expect(early.availableTokens).toBe(early.accruedTokens);
    expect(later.availableTokens).toBeLessThanOrEqual(later.allowanceTokens);
    expect(early.spentTokens).toBe(0);
    expect(early.remainingTokens).toBe(early.allowanceTokens);
    expect(early.spentFraction).toBe(0);
    expect(early.remainingFraction).toBe(1);
  });

  it('derives accrual from the clock, so repeated ticks cannot double-earn', () => {
    const once = applyEconomyTick(missionState(), { deltaMs: 10_000 });
    const twice = applyEconomyTick(once.state, { deltaMs: 10_000 });

    expect(once.report.context.accruedTokens).toBe(24_000);
    expect(twice.report.context.accruedTokens).toBe(48_000);
    expect(twice.report.context.accruedTokens - once.report.context.accruedTokens).toBe(24_000);
  });
});

/* -------------------------------------------------------------------------- */
/* Costs                                                                      */
/* -------------------------------------------------------------------------- */

describe('activity costs', () => {
  it('prices dispatch, verification and fix-ups and moves credits and reputation', () => {
    const state = missionState();
    const result = applyEconomyTick(state, {
      deltaMs: 20_000,
      activities: [
        createEconomyActivity('dispatch', 19_000, { id: 'a-dispatch', label: 'task-a' }),
        createEconomyActivity('verification', 19_500, { id: 'a-verify' }),
        createEconomyActivity('fixup', 20_000, { id: 'a-fixup' }),
      ],
    });

    const expectedTokens =
      DISPATCH_COST.contextTokens + VERIFICATION_COST.contextTokens + FIXUP_COST.contextTokens;
    const expectedCredits = DISPATCH_COST.credits + VERIFICATION_COST.credits + FIXUP_COST.credits;
    const expectedReputation = DISPATCH_COST.reputation + VERIFICATION_COST.reputation + FIXUP_COST.reputation;

    // Budget: spent exactly the configured token costs, capped by the allowance.
    expect(result.state.economy.contextSpent).toBe(expectedTokens);
    expect(result.state.economy.contextBudget).toBe(200_000);
    expect(result.report.charges).toEqual({ tokens: expectedTokens, credits: expectedCredits, activityCount: 3 });
    expect(result.report.starvation.starved).toBe(false);
    expect(result.report.context.remainingTokens).toBe(200_000 - expectedTokens);

    // Credits: one running task earns 12 cr/s while the activities pay their costs.
    expect(result.state.economy.credits).toBeCloseTo(5_000 + 12 * 20 - expectedCredits, 6);
    expect(result.report.credits).toEqual({
      before: 5_000,
      after: 5_000 + 240 - expectedCredits,
      earned: 240,
      spent: expectedCredits,
      perSecond: 12,
      runningTasks: 1,
      ratePerTask: 12,
    });

    // Reputation: verification earns, fix-ups burn, dispatch is neutral.
    expect(result.state.economy.reputation).toBeCloseTo(50 + expectedReputation, 6);
    expect(result.report.reputation).toEqual({ before: 50, after: 50 + expectedReputation, delta: expectedReputation });

    // Per-activity accounting mirrors the configured costs.
    expect(settlementOf(result, 'a-dispatch')?.charged).toEqual({ ...DISPATCH_COST });
    expect(settlementOf(result, 'a-verify')?.charged).toEqual({ ...VERIFICATION_COST });
    expect(settlementOf(result, 'a-fixup')?.charged).toEqual({ ...FIXUP_COST });
    expect(settlementOf(result, 'a-dispatch')?.label).toBe('task-a');
    expect(result.report.activities.map((entry) => entry.activityId)).toEqual(['a-dispatch', 'a-verify', 'a-fixup']);

    // The state the events reduce to is exactly the state the report describes.
    expect(applyDomainEvents(state, result.events)).toEqual(result.state);
    expect(result.events.filter((event) => event.type === 'economy/spend')).toHaveLength(3);
  });

  it('never lets the budget or the vault go negative', () => {
    const state = missionState({ startingCredits: 100 });
    const result = applyEconomyTick(state, {
      deltaMs: 1_000,
      activities: [createEconomyActivity('dispatch', 1_000, { id: 'a-dispatch' })],
    });

    // Only the 2.4k tokens the clock has earned could be spent.
    expect(result.state.economy.contextSpent).toBe(2_400);
    expect(result.state.economy.contextBudget).toBe(200_000);
    expect(result.report.context.spentTokens).toBeLessThanOrEqual(result.report.context.allowanceTokens);
    expect(result.report.context.remainingTokens).toBe(200_000 - 2_400);

    const settled = settlementOf(result, 'a-dispatch');
    expect(settled?.starved).toBe(true);
    expect(settled?.requested).toEqual({ ...DISPATCH_COST });
    expect(settled?.starvedTokens).toBe(DISPATCH_COST.contextTokens - 2_400);
    expect(result.report.starvation).toEqual({
      starvedTokens: DISPATCH_COST.contextTokens - 2_400,
      unaffordableCredits: DISPATCH_COST.credits - (100 + 12),
      starvedActivityIds: ['a-dispatch'],
      starved: true,
    });

    // 100 credits + 12 earned cannot cover a 140 credit dispatch.
    expect(result.state.economy.credits).toBe(0);
    expect(result.report.credits.spent).toBe(112);

    // A starved activity never improves reputation; it takes the harsher delta.
    expect(result.state.economy.reputation).toBeCloseTo(50 + STARVING_REPUTATION_PENALTY, 6);
    expect(result.report.exhaustion).toEqual({ exhausted: false, reported: false, atMs: null });
  });

  it('clamps malformed costs and never rewinds the clock', () => {
    const state = missionState();
    const result = applyEconomyTick(state, {
      deltaMs: -5_000,
      activities: [
        createEconomyActivity('dispatch', -10, {
          id: 'neg',
          cost: { contextTokens: -100, credits: -5, reputation: Number.NaN },
        }),
      ],
    });

    expect(result.report.atMs).toBe(state.mission.elapsedMs);
    expect(result.report.deltaMs).toBe(0);
    expect(settlementOf(result, 'neg')?.requested).toEqual({ contextTokens: 0, credits: 0, reputation: 0 });
    expect(result.state.economy.contextSpent).toBe(state.economy.contextSpent);
  });
});

/* -------------------------------------------------------------------------- */
/* Exhaustion                                                                 */
/* -------------------------------------------------------------------------- */

describe('budget exhaustion', () => {
  it('reports exhaustion exactly once per mission', () => {
    const steps: readonly { deltaMs: number; kind: EconomyActivityKind }[] = [
      { deltaMs: 5_000, kind: 'dispatch' }, // 4 800 of the 10 000 token allowance
      { deltaMs: 5_000, kind: 'fixup' }, // + 3 600 -> 8 400
      { deltaMs: 5_000, kind: 'verification' }, // + 1 600 funded, 800 starved -> 10 000
      { deltaMs: 5_000, kind: 'dispatch' }, // starved; nothing left to burn
      { deltaMs: 5_000, kind: 'dispatch' },
    ];

    let current = missionState({ startingCredits: 5_000, contextBudget: 10_000 });
    const reportedAt: number[] = [];

    steps.forEach((step, index) => {
      const at = current.mission.elapsedMs + step.deltaMs;
      const result = applyEconomyTick(current, {
        deltaMs: step.deltaMs,
        activities: [createEconomyActivity(step.kind, at, { id: `step-${index}` })],
      });

      if (result.report.exhaustion.reported) reportedAt.push(index);
      expect(result.state.economy.contextBudget).toBe(10_000);
      expect(result.state.economy.contextSpent).toBeLessThanOrEqual(10_000);

      if (index === 0) expect(result.report.exhaustion.exhausted).toBe(false);
      if (index === 1) expect(result.state.economy.contextSpent).toBe(8_400);
      if (index === 2) {
        // The crossing tick: the last 1 600 tokens are burned and 800 go unfunded.
        expect(result.state.economy.contextSpent).toBe(10_000);
        expect(result.report.exhaustion).toEqual({ exhausted: true, reported: true, atMs: 15_000 });
        expect(result.report.starvation.starvedTokens).toBe(800);
        expect(settlementOf(result, 'step-2')?.starvedTokens).toBe(800);
      }
      if (index > 2) {
        expect(result.report.exhaustion).toEqual({ exhausted: true, reported: false, atMs: null });
        expect(result.state.economy.contextSpent).toBe(10_000);
      }

      current = result.state;
    });

    expect(reportedAt).toEqual([2]);
    expect(readEconomyPressure(current).exhausted).toBe(true);

    // A later tick still cannot repeat the report.
    const after = applyEconomyTick(current, {
      deltaMs: 5_000,
      activities: [createEconomyActivity('dispatch', current.mission.elapsedMs + 5_000, { id: 'after' })],
    });
    expect(after.report.exhaustion).toEqual({ exhausted: true, reported: false, atMs: null });
    expect(after.state.economy.contextSpent).toBe(10_000);
  });

  it('keeps the budget inside its limits across a long deterministic run', () => {
    let current = missionState({ startingCredits: 1_000, contextBudget: 30_000 });
    let reported = 0;

    for (let step = 0; step < 40; step += 1) {
      const kind = ECONOMY_ACTIVITY_KINDS[step % ECONOMY_ACTIVITY_KINDS.length] ?? 'dispatch';
      const at = current.mission.elapsedMs + 500;
      const result = applyEconomyTick(current, {
        deltaMs: 500,
        activities: [createEconomyActivity(kind, at, { id: `step-${step}` })],
      });

      if (result.report.exhaustion.reported) reported += 1;
      expect(result.state.economy.contextSpent).toBeGreaterThanOrEqual(0);
      expect(result.state.economy.contextSpent).toBeLessThanOrEqual(result.state.economy.contextBudget);
      expect(result.state.economy.credits).toBeGreaterThanOrEqual(0);
      expect(result.state.economy.reputation).toBeGreaterThanOrEqual(0);
      expect(result.state.economy.reputation).toBeLessThanOrEqual(100);
      current = result.state;
    }

    expect(reported).toBe(1);
    expect(current.economy.contextSpent).toBe(current.economy.contextBudget);
  });
});

/* -------------------------------------------------------------------------- */
/* Deadline pressure                                                          */
/* -------------------------------------------------------------------------- */

describe('deadline pressure', () => {
  it('raises pressure with the mission clock and bands the clock', () => {
    const state = missionState({ deadlineMs: 600_000 });
    const safe = readEconomyClock(state, { atMs: 0 });
    const warning = readEconomyClock(state, { atMs: 450_000 });
    const critical = readEconomyClock(state, { atMs: 540_000 });
    const expired = readEconomyClock(state, { atMs: 600_000 });

    expect(safe).toMatchObject({ pressure: 0, band: 'safe', expired: false, remainingMs: 600_000 });
    expect(warning.band).toBe('warning');
    expect(warning.pressure).toBeCloseTo(0.75, 6);
    expect(critical.band).toBe('critical');
    expect(critical.pressure).toBeCloseTo(0.9, 6);
    expect(expired.band).toBe('expired');
    expect(expired.expired).toBe(true);
    expect(expired.pressure).toBe(1);
    expect(expired.remainingMs).toBe(0);
    expect(safe.remainingMs).toBeGreaterThan(warning.remainingMs);
    expect(readEconomyClock(state).elapsedMs).toBe(state.mission.elapsedMs);
  });

  it('reports no clock pressure when the mission has no deadline', () => {
    const state = missionState({ deadlineMs: 0 });
    const clock = readEconomyClock(state, { atMs: 10_000_000 });
    expect(clock).toMatchObject({ deadlineMs: 0, remainingMs: 0, pressure: 0, band: 'safe', expired: false });
  });

  it('installs the mission deadline and reports the tick clock the HUD shows', () => {
    const state = missionState();
    const result = applyEconomyTick(state, { deltaMs: 120_000, deadlineMs: 90_000 });

    expect(result.events.filter((event) => event.type === 'economy/deadline')).toHaveLength(1);
    expect(result.state.economy.deadlineMs).toBe(90_000);
    expect(result.report.clock).toMatchObject({
      elapsedMs: 120_000,
      deadlineMs: 90_000,
      remainingMs: 0,
      pressure: 1,
      band: 'expired',
      expired: true,
    });
    expect(result.report.deadlineLapsed).toBe(true);

    // The HUD clock reads exactly these two fields off the state.
    expect(result.state.mission.elapsedMs).toBe(result.report.clock.elapsedMs);
    expect(result.state.economy.deadlineMs).toBe(result.report.clock.deadlineMs);

    // The lapse is reported once: the next tick observes an already-expired clock.
    const second = applyEconomyTick(result.state, { deltaMs: 1_000 });
    expect(second.report.clock.expired).toBe(true);
    expect(second.report.deadlineLapsed).toBe(false);

    // Re-installing the same deadline emits nothing.
    const unchanged = applyEconomyTick(state, { deltaMs: 1_000, deadlineMs: state.economy.deadlineMs });
    expect(unchanged.events.some((event) => event.type === 'economy/deadline')).toBe(false);
  });

  it('exposes deadline pressure and exhaustion without ticking', () => {
    const state = missionState({ contextBudget: 1_000, deadlineMs: 100_000 });
    const before = readEconomyPressure(state, { atMs: 90_000 });

    expect(before.context.allowanceTokens).toBe(1_000);
    expect(before.context.accruedTokens).toBe(1_000);
    expect(before.clock.band).toBe('critical');
    expect(before.exhausted).toBe(false);

    const drained = applyDomainEvents(state, [
      makeDomainEvent('economy/spend', { credits: 0, contextTokens: 1_000 }, 90_000),
    ]);
    const after = readEconomyPressure(drained, { atMs: 90_000 });
    expect(after.exhausted).toBe(true);
    expect(after.context.remainingTokens).toBe(0);
    expect(after.context.remainingFraction).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Reputation                                                                 */
/* -------------------------------------------------------------------------- */

describe('reputation', () => {
  it('clamps reputation to the 0..100 scale', () => {
    const praised = applyEconomyTick(missionState({ reputation: 99 }), {
      deltaMs: 20_000,
      activities: [createEconomyActivity('verification', 20_000, { id: 'v1' })],
    });
    expect(praised.state.economy.reputation).toBe(100);

    const tarnished = applyEconomyTick(missionState({ reputation: 1 }), {
      deltaMs: 20_000,
      activities: [createEconomyActivity('fixup', 20_000, { id: 'f1' })],
    });
    expect(tarnished.state.economy.reputation).toBe(0);
    expect(tarnished.report.reputation.delta).toBe(-1);
  });

  it('never rewards a starved activity', () => {
    const state = missionState({ startingCredits: 5_000, contextBudget: 1_000, reputation: 50 });
    const result = applyEconomyTick(state, {
      deltaMs: 500,
      activities: [createEconomyActivity('verification', 500, { id: 'v1' })],
    });

    // 1 200 tokens accrued of a 2 400 token verification: starved.
    expect(settlementOf(result, 'v1')?.starved).toBe(true);
    expect(result.state.economy.reputation).toBeCloseTo(50 + STARVING_REPUTATION_PENALTY, 6);
    expect(result.report.reputation.delta).toBe(STARVING_REPUTATION_PENALTY);
  });
});

/* -------------------------------------------------------------------------- */
/* Determinism                                                                */
/* -------------------------------------------------------------------------- */

describe('determinism', () => {
  it('is a pure function of state, clock and activities', () => {
    const state = createSampleState();
    const activities: EconomyActivity[] = [
      createEconomyActivity('verification', state.mission.elapsedMs + 1_000, { id: 'verify-x' }),
    ];
    const input = { deltaMs: 1_000, activities };

    const stateSnapshot = structuredClone(state);
    const activitiesSnapshot = structuredClone(activities);
    const first = applyEconomyTick(state, input);
    const second = applyEconomyTick(state, input);

    // Inputs are never mutated.
    expect(state).toEqual(stateSnapshot);
    expect(activities).toEqual(activitiesSnapshot);

    // The same inputs always produce the same economy.
    expect(first.state).toEqual(second.state);
    expect(first.report).toEqual(second.report);
    expect(first.events).toEqual(second.events);
    expect(applyDomainEvents(state, first.events)).toEqual(first.state);

    // A later clock earns more context.
    const later = applyEconomyTick(state, { ...input, deltaMs: 60_000 });
    expect(later.report.context.accruedTokens).toBeGreaterThan(first.report.context.accruedTokens);
  });

  it('replays the sample mission into an identical economy', () => {
    const script: readonly DomainEvent[] = [
      makeDomainEvent('mission/started', {}, 0),
      makeDomainEvent('economy/reward', { credits: 400, reputation: 2 }, 1_000),
      makeDomainEvent('economy/spend', { credits: 120, contextTokens: 9_000 }, 2_000),
    ];
    const build = () =>
      applyDomainEvents(
        createInitialState({
          contextBudget: 20_000,
          startingCredits: 500,
          creditRatePerTask: 12,
          reputation: 60,
          deadlineMs: 300_000,
        }),
        script,
      );

    const a = build();
    const b = build();
    expect(a.economy).toEqual(b.economy);

    const runA = applyEconomyTick(a, {
      deltaMs: 5_000,
      activities: [createEconomyActivity('dispatch', 5_000, { id: 'd' })],
    });
    const runB = applyEconomyTick(b, {
      deltaMs: 5_000,
      activities: [createEconomyActivity('dispatch', 5_000, { id: 'd' })],
    });

    expect(runA.state.economy).toEqual(runB.state.economy);
    expect(runA.report).toEqual(runB.report);
  });

  it('prices activities against the real sample fixture', () => {
    const state = createSampleState();
    expect(state.mission.elapsedMs).toBeGreaterThan(0);
    expect(state.economy.contextSpent).toBeGreaterThan(0);

    // The fixture has already out-spent the tokens it earned by its own clock.
    const early = applyEconomyTick(state, {
      atMs: state.mission.elapsedMs,
      activities: [createEconomyActivity('dispatch', state.mission.elapsedMs, { id: 'early' })],
    });
    expect(early.report.context.availableTokens).toBeLessThan(DISPATCH_COST.contextTokens);
    expect(settlementOf(early, 'early')?.starved).toBe(true);
    expect(early.report.starvation.starvedTokens).toBe(
      DISPATCH_COST.contextTokens - early.report.context.availableTokens,
    );
    expect(early.state.economy.contextSpent).toBe(state.economy.contextSpent);

    // Ten minutes of mission clock earn the whole allowance, so dispatch funds again.
    const later = applyEconomyTick(state, {
      atMs: 10 * 60_000,
      activities: [createEconomyActivity('dispatch', 10 * 60_000, { id: 'later' })],
    });
    expect(later.report.context.accruedTokens).toBe(state.economy.contextBudget);
    expect(settlementOf(later, 'later')?.starved).toBe(false);
    expect(later.state.economy.contextSpent).toBeCloseTo(
      state.economy.contextSpent + DISPATCH_COST.contextTokens,
      6,
    );
    expect(later.state.economy.contextSpent).toBeLessThanOrEqual(later.state.economy.contextBudget);
    expect(later.state.economy.credits).toBeGreaterThan(0);
  });
});
