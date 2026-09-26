/**
 * GameState / domain-event contract and fixture determinism.
 *
 * Runs in the default Node environment: the simulation layer must be usable with
 * no DOM, no canvas and no GPU.
 */

import { describe, expect, it } from 'vitest';

import { createDomainEventChannel, createDomainEventJournal } from '../src/game/events';
import { SAMPLE_SEED, createSampleState } from '../src/sim/fixtures';
import {
  applyDomainEvents,
  createInitialState,
  createSnapshot,
  getGate,
  getLane,
  getTask,
  listGates,
  listLanes,
  listMetrics,
  listTasks,
  makeDomainEvent,
  reduceDomainEvent,
  type DomainEvent,
  type GameState,
} from '../src/sim/state';

/** A representative mission script used across the contract tests. */
function scriptedEvents(): DomainEvent[] {
  return [
    makeDomainEvent('mission/started', {}, 0),
    makeDomainEvent(
      'lane/registered',
      { lane: { id: 'lane-build', kind: 'build', label: 'Build', capacity: 2 } },
      100,
    ),
    makeDomainEvent(
      'lane/registered',
      { lane: { id: 'lane-verify', kind: 'verify', label: 'Verify', capacity: 1 } },
      120,
    ),
    makeDomainEvent(
      'plan/task-registered',
      { task: { id: 't-a', title: 'Scaffold', laneId: 'lane-build', dependencies: [] } },
      200,
    ),
    makeDomainEvent(
      'plan/task-registered',
      { task: { id: 't-b', title: 'Contract', laneId: 'lane-build', dependencies: ['t-a'] } },
      210,
    ),
    makeDomainEvent(
      'plan/task-registered',
      { task: { id: 't-c', title: 'Verify', laneId: 'lane-verify', dependencies: [] } },
      220,
    ),
    makeDomainEvent('lane/assigned', { laneId: 'lane-build', taskId: 't-a' }, 300),
    makeDomainEvent('plan/task-updated', { taskId: 't-a', status: 'passed', progress: 1 }, 900),
    makeDomainEvent(
      'verification/gate-registered',
      { gate: { id: 'g-type', name: 'Typecheck', laneId: 'lane-verify' } },
      950,
    ),
    makeDomainEvent('verification/run', { gateId: 'g-type', status: 'passed', coverage: 1 }, 1000),
    makeDomainEvent(
      'quality/measured',
      { metric: { id: 'm-fidelity', label: 'Fidelity', value: 0.8, target: 1, weight: 3 } },
      1100,
    ),
    makeDomainEvent(
      'quality/measured',
      { metric: { id: 'm-determinism', label: 'Determinism', value: 1, target: 1, weight: 1 } },
      1110,
    ),
    makeDomainEvent(
      'quality/finding',
      { finding: { id: 'f-1', severity: 'low', summary: 'sparse grid', taskId: 't-a', atMs: 1100 } },
      1120,
    ),
    makeDomainEvent('economy/reward', { credits: 500, reputation: 4 }, 1200),
    makeDomainEvent('economy/spend', { credits: 120, contextTokens: 3000 }, 1300),
    makeDomainEvent('economy/deadline', { deadlineMs: 90_000 }, 1310),
  ];
}

function scriptedState(): GameState {
  return applyDomainEvents(createInitialState({ seed: 7 }), scriptedEvents());
}

describe('GameState contract', () => {
  it('creates the initial state with every slice and derived aggregate present', () => {
    const state = createInitialState({ seed: 42 });

    expect(state.seed).toBe(42);
    expect(state.revision).toBe(0);
    expect(state.mission.status).toBe('bootstrapping');
    expect(state.mission.progress).toBe(0);
    expect(state.plan.order).toEqual([]);
    expect(state.plan.tasks).toEqual({});
    expect(state.lanes.order).toEqual([]);
    expect(state.lanes.lanes).toEqual({});
    expect(state.verification.passRate).toBe(0);
    expect(state.quality.score).toBe(0);
    expect(state.quality.findings).toEqual([]);
    expect(state.economy.creditsPerSecond).toBe(0);
  });

  it('is deterministic for identical initial options', () => {
    expect(createInitialState({ seed: 3, missionId: 'm' })).toEqual(
      createInitialState({ seed: 3, missionId: 'm' }),
    );
  });

  it('reduces events without mutating the input state', () => {
    const before = scriptedState();
    const frozen = structuredClone(before);

    const after = reduceDomainEvent(before, makeDomainEvent('mission/status', { status: 'delivering' }, 2000));

    expect(before).toEqual(frozen);
    expect(after).not.toBe(before);
    expect(after.mission.status).toBe('delivering');
    expect(after.revision).toBe(before.revision + 1);
    // Untouched slices keep their identity: the reducer copies only what changes.
    expect(after.plan).toBe(before.plan);
  });

  it('derives mission, lane, verification, quality and economy aggregates from the slices', () => {
    const state = scriptedState();

    expect(state.mission.status).toBe('running');
    expect(state.mission.elapsedMs).toBe(1310);
    expect(state.mission.progress).toBeCloseTo(1 / 3, 6);

    const build = getLane(state, 'lane-build');
    const verify = getLane(state, 'lane-verify');
    expect(build?.activeTaskId).toBe('t-a');
    expect(build?.utilization).toBe(0);
    expect(verify?.utilization).toBe(0);
    expect(state.lanes.order).toEqual(['lane-build', 'lane-verify']);

    expect(state.verification.passRate).toBe(1);
    expect(getGate(state, 'g-type')?.attempts).toBe(1);
    expect(getGate(state, 'g-type')?.lastRunAtMs).toBe(1000);

    expect(state.quality.score).toBeCloseTo(0.85, 6);
    expect(state.quality.findings).toHaveLength(1);

    expect(state.economy.credits).toBe(380);
    expect(state.economy.contextSpent).toBe(3000);
    expect(state.economy.reputation).toBe(54);
    expect(state.economy.deadlineMs).toBe(90_000);
    expect(state.economy.creditsPerSecond).toBe(0);
  });

  it('tracks task lifecycle timestamps and lane utilisation', () => {
    let state = createInitialState({ seed: 1 });
    state = applyDomainEvents(state, [
      makeDomainEvent(
        'lane/registered',
        { lane: { id: 'lane-build', kind: 'build', label: 'Build', capacity: 2 } },
        0,
      ),
      makeDomainEvent(
        'plan/task-registered',
        { task: { id: 't-a', title: 'A', laneId: 'lane-build' } },
        10,
      ),
      makeDomainEvent(
        'plan/task-registered',
        { task: { id: 't-b', title: 'B', laneId: 'lane-build' } },
        20,
      ),
      makeDomainEvent('lane/queued', { laneId: 'lane-build', taskId: 't-b' }, 30),
      makeDomainEvent('lane/assigned', { laneId: 'lane-build', taskId: 't-a' }, 40),
      makeDomainEvent('lane/assigned', { laneId: 'lane-build', taskId: 't-b' }, 50),
    ]);

    expect(getTask(state, 't-a')?.status).toBe('running');
    expect(getTask(state, 't-a')?.startedAtMs).toBe(40);
    // Two running tasks against capacity 2 saturate the lane.
    expect(getLane(state, 'lane-build')?.utilization).toBe(1);
    expect(getLane(state, 'lane-build')?.queue).toEqual([]);

    state = reduceDomainEvent(
      state,
      makeDomainEvent('plan/task-updated', { taskId: 't-a', status: 'failed', progress: 0.4 }, 90),
    );
    expect(getTask(state, 't-a')?.finishedAtMs).toBe(90);
    expect(getLane(state, 'lane-build')?.utilization).toBe(0.5);
    expect(state.verification.passRate).toBe(0);
  });

  it('applies batches in simulated-time order regardless of input order', () => {
    const events = scriptedEvents();
    const forward = applyDomainEvents(createInitialState({ seed: 7 }), events);
    const reversed = applyDomainEvents(createInitialState({ seed: 7 }), [...events].reverse());

    expect(reversed).toEqual(forward);
    expect(reversed.revision).toBe(events.length);
  });

  it('replays the same events into the same state (determinism)', () => {
    const events = scriptedEvents();
    const first = applyDomainEvents(createInitialState({ seed: 7 }), events);
    const second = applyDomainEvents(createInitialState({ seed: 7 }), events);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('exposes frozen read-only snapshots', () => {
    const snapshot = createSnapshot(scriptedState());

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.mission)).toBe(true);
    expect(Object.isFrozen(snapshot.plan.tasks)).toBe(true);
    expect(Object.isFrozen(snapshot.quality.findings)).toBe(true);
    expect(() => {
      (snapshot.mission as { codename: string }).codename = 'mutated';
    }).toThrow(TypeError);
  });

  it('offers order-stable selectors for every ordered slice', () => {
    const state = scriptedState();
    expect(listTasks(state).map((task) => task.id)).toEqual(['t-a', 't-b', 't-c']);
    expect(listLanes(state).map((lane) => lane.id)).toEqual(['lane-build', 'lane-verify']);
    expect(listGates(state).map((gate) => gate.id)).toEqual(['g-type']);
    expect(listMetrics(state).map((metric) => metric.id)).toEqual(['m-fidelity', 'm-determinism']);
  });
});

describe('sample state fixture', () => {
  it('is deterministic for a given seed, in both call styles', () => {
    const fromNumber = createSampleState(SAMPLE_SEED);
    const fromOptions = createSampleState({ seed: SAMPLE_SEED });

    expect(JSON.stringify(fromOptions)).toBe(JSON.stringify(fromNumber));
    expect(createSampleState(SAMPLE_SEED)).toEqual(fromNumber);
  });

  it('jitters seeded values so different seeds produce different runs', () => {
    const a = createSampleState(1);
    const b = createSampleState(2);

    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    // The structure later modules write into stays identical.
    expect(Object.keys(b.plan.tasks)).toEqual(Object.keys(a.plan.tasks));
    expect(b.lanes.order).toEqual(a.lanes.order);
  });

  it('populates every slice with believable, self-consistent values', () => {
    const state = createSampleState(SAMPLE_SEED);

    expect(state.mission.status).toBe('running');
    expect(state.mission.codename).toBe('HOLO-FACTORY');
    expect(state.mission.progress).toBeCloseTo(2 / 7, 6);
    expect(state.mission.elapsedMs).toBeGreaterThan(0);

    expect(state.plan.order).toHaveLength(7);
    expect(listTasks(state).filter((task) => task.status === 'running').length).toBeGreaterThan(0);
    expect(listTasks(state).filter((task) => task.status === 'passed')).toHaveLength(2);
    expect(listLanes(state)).toHaveLength(5);
    expect(listGates(state)).toHaveLength(4);
    expect(state.verification.passRate).toBe(1);
    expect(listMetrics(state)).toHaveLength(5);
    expect(state.quality.score).toBeGreaterThan(0);
    expect(state.quality.score).toBeLessThanOrEqual(1);
    expect(state.quality.findings).toHaveLength(2);
    expect(state.economy.credits).toBeGreaterThan(0);
    expect(state.economy.creditsPerSecond).toBeGreaterThan(0);
    expect(state.economy.contextSpent).toBeGreaterThan(0);
    expect(state.economy.contextSpent).toBeLessThan(state.economy.contextBudget);
    expect(state.economy.reputation).toBeGreaterThan(50);

    // Running tasks are on lanes; the checkpointed mission has moved on.
    expect(listLanes(state).filter((lane) => lane.activeTaskId !== null).length).toBeGreaterThan(0);
    expect(getLane(state, 'lane-build')?.utilization).toBeGreaterThan(0);
    expect(createSnapshot(state).plan.tasks['task-shell']?.status).toBe('passed');
  });
});

describe('domain event channel and journal', () => {
  it('drains queued events in simulated-time order', () => {
    const channel = createDomainEventChannel();
    channel.emit(makeDomainEvent('economy/reward', { credits: 5, reputation: 1 }, 300));
    channel.emit(makeDomainEvent('mission/started', {}, 100));
    channel.emit(makeDomainEvent('mission/status', { status: 'delivering' }, 200));

    expect(channel.pending).toBe(3);
    expect(channel.drain().map((event) => event.at)).toEqual([100, 200, 300]);
    expect(channel.pending).toBe(0);
    expect(channel.drain()).toEqual([]);
  });

  it('notifies listeners in emission order and stops after unsubscribe', () => {
    const channel = createDomainEventChannel();
    const seen: number[] = [];
    const unsubscribe = channel.on((event) => seen.push(event.at));

    channel.emit(makeDomainEvent('mission/started', {}, 10));
    channel.emit(makeDomainEvent('mission/started', {}, 20));
    unsubscribe();
    channel.emit(makeDomainEvent('mission/started', {}, 30));

    expect(seen).toEqual([10, 20]);
    expect(channel.pending).toBe(3);
  });

  it('replays a journal deterministically and can consume it', () => {
    const journal = createDomainEventJournal();
    for (const event of scriptedEvents()) {
      journal.record(event);
    }
    const initial = createInitialState({ seed: 7 });

    const first = journal.replay(initial);
    const second = journal.replay(initial);
    expect(second.state).toEqual(first.state);
    expect(journal.length).toBe(scriptedEvents().length);

    const consumed = journal.drainTo(initial);
    expect(consumed.state).toEqual(first.state);
    expect(journal.length).toBe(0);
    expect(journal.drainTo(initial).state).toEqual(initial);
  });
});
