/**
 * Parallel lane scheduling with agent execution, retries and fix-ups.
 *
 * The tests drive the real foundation contracts rather than hand-written state:
 * lane declarations come from `createSampleState`, every emitted event is
 * reduced back through `applyDomainEvents` so the assertions read the same
 * `GameState` the game renders, and the RNG is the shared seeded stream. They
 * run in the default Node environment — the modules must work with no DOM, no
 * canvas and no GPU — and they assert determinism by replaying the same seed and
 * the same ready sets twice and deep-comparing the lane and agent records.
 */

import { describe, expect, it } from 'vitest';

import { createDomainEventJournal } from '../src/game/events';
import { createAgentRuntime, deriveRequiredSteps, type FixUpTask } from '../src/sim/agents';
import { SAMPLE_SEED, createSampleState } from '../src/sim/fixtures';
import {
  createDispatchScheduler,
  overlappingPaths,
  type DispatchConflictFlag,
  type DispatchTaskInput,
  type ScheduleReport,
} from '../src/sim/lanes';
import { applyDomainEvents, type DomainEvent, type GameState } from '../src/sim/state';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A task the caller proved dispatchable, on one of the fixture's lanes. */
function readyTask(id: string, laneId: string, writeSet: readonly string[]): DispatchTaskInput {
  return { id, title: `${id} work`, laneId, writeSet };
}

/** Five tasks spread over the sample mission's lanes, with disjoint ownership. */
const MISSION_TASKS: readonly DispatchTaskInput[] = [
  {
    id: 'task-shell',
    title: 'Scaffold the holographic shell',
    laneId: 'lane-build',
    writeSet: ['src/main.ts', 'index.html'],
  },
  {
    id: 'task-lane-comets',
    title: 'Stream the agent lane comets',
    laneId: 'lane-build',
    writeSet: ['src/render/laneAgents.ts'],
  },
  {
    id: 'task-gates',
    title: 'Light the verification gates',
    laneId: 'lane-verify',
    writeSet: ['src/sim/verification.ts'],
  },
  {
    id: 'task-economy',
    title: 'Balance credits and context',
    laneId: 'lane-observe',
    writeSet: ['src/ui/panels.ts'],
  },
  {
    id: 'task-review',
    title: 'Ship the holographic review',
    laneId: 'lane-integrate',
    writeSet: ['README.md'],
  },
];

/** Event sink that keeps every domain event a module emits, in emission order. */
function createEventRecorder(): { events: DomainEvent[]; emit: (event: DomainEvent) => void } {
  const events: DomainEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}

/** Offer a dispatch to the agent runtime the way the composition layer does. */
function dispatchWork(
  runtime: ReturnType<typeof createAgentRuntime>,
  dispatch: ScheduleReport['dispatched'][number],
): void {
  if (dispatch.queued) return;
  runtime.dispatch({
    taskId: dispatch.taskId,
    laneId: dispatch.laneId,
    title: dispatch.task.title,
    writeSet: dispatch.task.writeSet,
  });
}

/**
 * One deterministic mission pass: schedule, dispatch the active work, advance
 * the agents. Every pass replays the same caller-side inputs, which is exactly
 * what a per-frame composition loop does.
 */
function runPass(
  scheduler: ReturnType<typeof createDispatchScheduler>,
  runtime: ReturnType<typeof createAgentRuntime>,
  ready: readonly DispatchTaskInput[],
  at: number,
): ScheduleReport {
  const report = scheduler.schedule({ at, ready });
  for (const dispatch of report.dispatched) dispatchWork(runtime, dispatch);
  runtime.advance(1_000);
  return report;
}

/* -------------------------------------------------------------------------- */
/* Lane scheduling                                                            */
/* -------------------------------------------------------------------------- */

describe('lane scheduling', () => {
  it('never keeps more tasks in flight than the mission lane limit', () => {
    const state = createSampleState(SAMPLE_SEED);
    const scheduler = createDispatchScheduler(state, { laneLimit: 2, maxRetries: 0 });

    // Seven tasks over five lanes, one agent each: the mission may only run two.
    const ready: DispatchTaskInput[] = [
      readyTask('task-1', 'lane-discovery', ['src/sim/a.ts']),
      readyTask('task-2', 'lane-build', ['src/sim/b.ts']),
      readyTask('task-3', 'lane-verify', ['src/sim/c.ts']),
      readyTask('task-4', 'lane-observe', ['src/sim/d.ts']),
      readyTask('task-5', 'lane-integrate', ['src/sim/e.ts']),
      readyTask('task-6', 'lane-discovery', ['src/sim/f.ts']),
      readyTask('task-7', 'lane-build', ['src/sim/g.ts']),
      readyTask('task-8', 'lane-verify', ['src/sim/h.ts']),
    ];

    const first = scheduler.schedule({ at: 1_000, ready });
    expect(first.laneLimit).toBe(2);
    expect(first.inFlightTaskIds).toHaveLength(2);
    expect(first.openLaneIds).toHaveLength(2);
    expect(first.dispatched.filter((dispatch) => !dispatch.queued).map((dispatch) => dispatch.taskId)).toEqual([
      'task-1',
      'task-2',
    ]);
    expect(first.dispatched.filter((dispatch) => dispatch.queued).length).toBeGreaterThan(0);
    // Two tasks fit no lane and no queue: they are refused with the lane limit.
    expect(first.refusals.map((refusal) => refusal.taskId)).toEqual(['task-7', 'task-8']);
    for (const refusal of first.refusals) expect(refusal.reason).toBe('lane-limit');
    expect(first.refusals[0]?.message).toContain('lane limit');

    // Replaying the same ready set every frame never breaks the limit.
    let report = first;
    for (let pass = 1; pass < 8; pass += 1) {
      report = scheduler.schedule({ at: 1_000 + pass * 100, ready });
      expect(report.inFlightTaskIds.length).toBeLessThanOrEqual(2);
      expect(report.openLaneIds.length).toBeLessThanOrEqual(2);
      expect(report.dispatched.filter((dispatch) => !dispatch.queued)).toEqual([]);
    }
    expect(report.waitingTaskIds).toEqual(expect.arrayContaining(['task-3', 'task-4', 'task-5']));
  });

  it('opens the next lane as in-flight work drains', () => {
    const state = createSampleState(SAMPLE_SEED);
    const scheduler = createDispatchScheduler(state, { laneLimit: 2, maxRetries: 0 });
    const ready = [
      readyTask('task-1', 'lane-discovery', ['src/sim/a.ts']),
      readyTask('task-2', 'lane-build', ['src/sim/b.ts']),
      readyTask('task-3', 'lane-build', ['src/sim/c.ts']),
    ];

    const first = scheduler.schedule({ at: 500, ready });
    expect(first.inFlightTaskIds).toEqual(['task-1', 'task-2']);
    expect(first.dispatched.filter((dispatch) => dispatch.queued).map((dispatch) => dispatch.taskId)).toEqual([
      'task-3',
    ]);

    // task-2 ships: its lane slot is free, so the queued task starts.
    scheduler.settle({ taskId: 'task-2', outcome: 'success', at: 900 });
    const second = scheduler.schedule({ at: 1_000, ready });
    expect(second.inFlightTaskIds).toEqual(['task-1', 'task-3']);
    expect(second.inFlightTaskIds).toHaveLength(2);
    expect(second.occupancy.find((lane) => lane.laneId === 'lane-build')?.activeTaskId).toBe('task-3');
  });

  it('refuses conflict-flagged tasks until the conflicting task completes', () => {
    const state = createSampleState(SAMPLE_SEED);
    const scheduler = createDispatchScheduler(state, { laneLimit: 3, maxRetries: 0 });
    const ready = [
      readyTask('task-a', 'lane-build', ['src/sim/state.ts']),
      readyTask('task-b', 'lane-verify', ['src/sim/state.ts']),
    ];
    const conflicts: DispatchConflictFlag[] = [
      { taskIds: ['task-a', 'task-b'], paths: ['src/sim/state.ts'] },
    ];

    const first = scheduler.schedule({ at: 100, ready, conflicts });
    expect(first.inFlightTaskIds).toEqual(['task-a']);
    const refusal = first.refusals.find((entry) => entry.taskId === 'task-b');
    expect(refusal?.reason).toBe('write-conflict');
    expect(refusal?.source).toBe('flag');
    expect(refusal?.conflictingTaskIds).toEqual(['task-a']);
    expect(refusal?.paths).toEqual(['src/sim/state.ts']);
    expect(refusal?.message).toContain('task-a');

    // Still refused while task-a holds the ownership.
    const second = scheduler.schedule({ at: 200, ready, conflicts });
    expect(second.inFlightTaskIds).not.toContain('task-b');
    expect(second.refusals.some((entry) => entry.taskId === 'task-b')).toBe(true);

    // task-a completes: the boundary lifts and task-b may run.
    const verdict = scheduler.settle({ taskId: 'task-a', outcome: 'success', at: 300 });
    expect(verdict.terminal).toBe(true);
    expect(verdict.needsFixUp).toBe(false);
    const third = scheduler.schedule({ at: 400, ready, conflicts });
    expect(third.inFlightTaskIds).toContain('task-b');
    expect(third.refusals).toEqual([]);
  });

  it('keeps overlapping write ownership out of parallel lanes without a flag', () => {
    const state = createSampleState(SAMPLE_SEED);
    const scheduler = createDispatchScheduler(state, { laneLimit: 3, maxRetries: 0 });
    const ready = [
      readyTask('task-build', 'lane-build', ['src/sim/', 'src/ui/hud.ts']),
      readyTask('task-ui', 'lane-verify', ['src/ui/hud.ts']),
    ];

    const report = scheduler.schedule({ at: 100, ready });
    expect(report.inFlightTaskIds).toEqual(['task-build']);
    const refusal = report.refusals.find((entry) => entry.taskId === 'task-ui');
    expect(refusal?.reason).toBe('write-conflict');
    expect(refusal?.source).toBe('ownership');
    expect(refusal?.conflictingTaskIds).toEqual(['task-build']);
    expect(refusal?.paths).toEqual(['src/ui/hud.ts']);
  });

  it('reports lane occupancy, throughput and closures every pass', () => {
    const state = createSampleState(SAMPLE_SEED);
    const scheduler = createDispatchScheduler(state, { laneLimit: 3, maxRetries: 0 });
    const ready = [
      readyTask('task-a', 'lane-build', ['src/sim/a.ts']),
      readyTask('task-b', 'lane-verify', ['src/sim/b.ts']),
    ];

    const first = scheduler.schedule({ at: 10_000, ready });
    const build = first.occupancy.find((lane) => lane.laneId === 'lane-build');
    expect(build).toMatchObject({
      laneId: 'lane-build',
      open: true,
      activeTaskId: 'task-a',
      capacity: 4,
      claimed: 1,
      completed: 0,
    });
    expect(build?.utilization).toBeCloseTo(0.25, 6);
    expect(first.throughput).toBe(0);
    expect(first.throughputPerSecond).toBe(0);

    scheduler.settle({ taskId: 'task-a', outcome: 'success', at: 20_000 });
    const shipped = scheduler.schedule({ at: 20_000, ready });
    expect(shipped.throughput).toBe(1);
    expect(shipped.throughputPerSecond).toBeCloseTo(0.05, 6);
    expect(shipped.occupancy.find((lane) => lane.laneId === 'lane-build')?.completed).toBe(1);
    expect(shipped.closedLaneIds).toEqual(['lane-build']);

    scheduler.settle({ taskId: 'task-b', outcome: 'success', at: 21_000 });
    const drained = scheduler.schedule({ at: 21_000, ready });
    expect(drained.inFlightTaskIds).toEqual([]);
    expect(drained.openLaneIds).toEqual([]);
    expect(drained.closedLaneIds).toEqual(['lane-verify']);
    expect(drained.throughput).toBe(2);

    // `report()` is a pure read: reading it twice yields the same numbers.
    expect(scheduler.report(21_000)).toEqual(scheduler.report(21_000));
    expect(scheduler.report(21_000).occupancy.every((lane) => !lane.open && lane.claimed === 0)).toBe(true);
  });

  it('closes every lane on teardown', () => {
    const state = createSampleState(SAMPLE_SEED);
    const scheduler = createDispatchScheduler(state, { laneLimit: 2, maxRetries: 0 });
    const ready = [
      readyTask('task-a', 'lane-build', ['src/sim/a.ts']),
      readyTask('task-b', 'lane-verify', ['src/sim/b.ts']),
      readyTask('task-c', 'lane-verify', ['src/sim/c.ts']),
    ];
    scheduler.schedule({ at: 1_000, ready });

    const closed = scheduler.closeAll(2_000);
    expect(closed.closedLaneIds).toEqual(['lane-build', 'lane-verify']);
    expect(closed.openLaneIds).toEqual([]);
    expect(closed.inFlightTaskIds).toEqual([]);
    expect(closed.occupancy.every((lane) => !lane.open && lane.queuedTaskIds.length === 0)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Agent execution                                                            */
/* -------------------------------------------------------------------------- */

describe('agent execution', () => {
  it('advances work in fixed steps and burns context tokens', () => {
    const recorder = createEventRecorder();
    const runtime = createAgentRuntime({
      seed: 42,
      stepMs: 100,
      failureChance: 0,
      rollbackChance: 0,
      tokensPerStep: 500,
      tokensJitter: 0,
      contextBudget: 1_000_000,
      emit: recorder.emit,
    });

    const record = runtime.dispatch({
      taskId: 'task-lane-comets',
      laneId: 'lane-build',
      title: 'Stream the agent lane comets',
      writeSet: ['src/render/laneAgents.ts'],
    });
    const steps = deriveRequiredSteps('task-lane-comets', 42, 6, 12);
    expect(record.requiredSteps).toBe(steps);
    expect(record.progress).toBe(0);
    expect(runtime.elapsedMs).toBe(0);

    // Progress moves one fixed step at a time, and every step costs tokens.
    for (let index = 1; index < steps; index += 1) runtime.step();
    expect(runtime.agents[0]?.stepsDone).toBe(steps - 1);
    expect(runtime.agents[0]?.progress).toBeCloseTo((steps - 1) / steps, 6);
    expect(runtime.contextSpent).toBe(500 * (steps - 1));
    expect(runtime.agents[0]?.status).toBe('working');

    const settlements = runtime.step();
    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.outcome).toBe('success');
    expect(settlements[0]?.decision.terminal).toBe(true);
    expect(settlements[0]?.contextTokens).toBe(500 * steps);
    expect(runtime.agents[0]?.progress).toBe(1);
    expect(runtime.contextSpent).toBe(500 * steps);
    expect(recorder.events.filter((event) => event.type === 'economy/spend')).toHaveLength(steps);
    expect(recorder.events.filter((event) => event.type === 'plan/task-updated')).toHaveLength(1);

    // `advance()` spends whole steps only; a partial frame runs nothing.
    expect(runtime.advance(50)).toEqual([]);
    expect(runtime.advance(100)).toEqual([]);
    expect(runtime.elapsedMs).toBe(steps * 100 + 100);
    expect(runtime.report()).toMatchObject({
      activeAgents: 0,
      settledAgents: 1,
      contextSpent: 500 * steps,
      contextBudget: 1_000_000,
    });
  });

  it('rolls the work back when the finite context budget runs out', () => {
    const runtime = createAgentRuntime({
      seed: 5,
      stepMs: 100,
      failureChance: 0,
      rollbackChance: 0,
      tokensPerStep: 500,
      tokensJitter: 0,
      contextBudget: 1_000,
      maxRetries: 0,
    });
    runtime.dispatch({ taskId: 'task-economy', laneId: 'lane-observe', writeSet: ['src/ui/panels.ts'] });

    expect(runtime.step()).toEqual([]);
    const settlements = runtime.step();
    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.outcome).toBe('rollback');
    expect(settlements[0]?.reason).toContain('context budget');
    expect(settlements[0]?.decision.needsFixUp).toBe(true);
    expect(runtime.contextSpent).toBeGreaterThanOrEqual(runtime.contextBudget);
    expect(runtime.agents[0]?.progress).toBe(0);
    expect(runtime.agents[0]?.rollbacks).toBe(1);
    expect(runtime.report().contextRemaining).toBe(0);
  });

  it('resolves outcomes deterministically for a given seed', () => {
    const run = (): string => {
      const runtime = createAgentRuntime({
        seed: 77,
        stepMs: 100,
        failureChance: 0.4,
        rollbackChance: 0.2,
        tokensPerStep: 300,
        tokensJitter: 40,
        contextBudget: 400_000,
        maxRetries: 0,
      });
      runtime.dispatch({ taskId: 'task-gates', laneId: 'lane-verify', writeSet: ['src/sim/verification.ts'] });
      while (runtime.report().activeAgents > 0) runtime.advance(1_000);
      return JSON.stringify({ agents: runtime.agents, settlements: runtime.settlements });
    };

    expect(run()).toBe(run());
    const settled = JSON.parse(run()) as { settlements: { outcome: string }[] };
    expect(settled.settlements).toHaveLength(1);
    expect(['success', 'failure', 'rollback']).toContain(settled.settlements[0]?.outcome);
  });
});

/* -------------------------------------------------------------------------- */
/* Retries and fix-ups                                                        */
/* -------------------------------------------------------------------------- */

describe('retries and fix-ups', () => {
  it('retries a failed run once, then materialises a fix-up task', () => {
    const state = createSampleState(SAMPLE_SEED);
    const recorder = createEventRecorder();
    const scheduler = createDispatchScheduler(state, {
      laneLimit: 1,
      maxRetries: 1,
      emit: recorder.emit,
    });
    const runtime = createAgentRuntime({
      seed: 9,
      stepMs: 100,
      failureChance: 1,
      rollbackChance: 0,
      tokensPerStep: 100,
      tokensJitter: 0,
      contextBudget: 1_000_000,
      maxFixUps: 2,
      scheduler,
      emit: recorder.emit,
      // Work another lane still holds, so the repair has to steer around it.
      claimedWriteSets: () => [
        { taskId: 'task-gates', laneId: 'lane-verify', writeSet: ['src/sim/state.ts'] },
      ],
    });

    const failedTask = 'task-lane-comets';
    const ready: DispatchTaskInput[] = [
      {
        id: failedTask,
        title: 'Stream the agent lane comets',
        laneId: 'lane-build',
        writeSet: ['src/render/laneAgents.ts', 'src/sim/state.ts'],
      },
    ];

    const reports: ScheduleReport[] = [];
    for (let pass = 0; pass < 5; pass += 1) {
      reports.push(runPass(scheduler, runtime, ready, pass * 1_000));
    }

    // Attempt 1 was retried, attempt 2 was terminal: at most two runs.
    expect(runtime.settlements).toHaveLength(2);
    expect(runtime.settlements[0]?.outcome).toBe('failure');
    expect(runtime.settlements[0]?.decision.requeued).toBe(true);
    expect(runtime.settlements[0]?.decision.terminal).toBe(false);
    expect(runtime.settlements[1]?.outcome).toBe('failure');
    expect(runtime.settlements[1]?.decision.terminal).toBe(true);
    expect(runtime.settlements[1]?.decision.needsFixUp).toBe(true);
    expect(runtime.agents.map((agent) => agent.attempt)).toEqual([1, 2]);
    expect(runtime.agents.every((agent) => agent.status === 'settled')).toBe(true);

    // Bounded retries: the scheduler counted one retry and one terminal failure.
    expect(scheduler.report().retries).toBe(1);
    expect(scheduler.report().failureCount).toBe(1);
    expect(reports.flatMap((report) => report.retried).map((retry) => retry.attempt)).toEqual([1]);
    expect(reports.flatMap((report) => report.failed).map((failure) => failure.attempts)).toEqual([2]);

    // Exactly one fix-up, depending on the failed task and carrying the objective.
    expect(runtime.fixUps).toHaveLength(1);
    const fixUp = runtime.fixUps[0] as FixUpTask;
    expect(fixUp.id).toBe(`fixup-${failedTask}`);
    expect(fixUp.rootTaskId).toBe(failedTask);
    expect(fixUp.dependsOn).toBe(failedTask);
    expect(fixUp.generation).toBe(1);
    expect(fixUp.laneId).toBe('lane-build');
    expect(fixUp.objective).toContain('Repair');
    expect(fixUp.objective).toContain('Stream the agent lane comets');

    // The write set steers around work that is still claimed.
    expect(fixUp.writeSet).toEqual(['src/render/laneAgents.ts']);
    expect(overlappingPaths(fixUp.writeSet, ['src/sim/state.ts'])).toEqual([]);
    for (const holder of scheduler.claimedWriteSets(fixUp.dependsOn)) {
      expect(overlappingPaths(fixUp.writeSet, holder.writeSet)).toEqual([]);
    }

    // The fix-up went into the plan through the shared event contract.
    const reduced = applyDomainEvents(state, recorder.events);
    expect(reduced.plan.order).toContain(fixUp.id);
    expect(reduced.plan.tasks[failedTask]?.status).toBe('failed');
    expect(reduced.plan.tasks[fixUp.id]?.status).toBe('pending');
    expect(reduced.plan.tasks[fixUp.id]?.dependencies).toEqual([failedTask]);
    expect(reduced.plan.tasks[fixUp.id]?.title).toContain('Repair');
    expect(reduced.quality.findings.some((finding) => finding.taskId === failedTask)).toBe(true);
    expect(reduced.economy.contextSpent).toBeGreaterThan(state.economy.contextSpent);

    // The repair wave is dispatchable work: offering it claims a lane of its own.
    const repairPass = scheduler.schedule({
      at: 99_000,
      ready: [{ id: fixUp.id, title: fixUp.objective, laneId: fixUp.laneId, writeSet: fixUp.writeSet }],
    });
    expect(repairPass.inFlightTaskIds).toContain(fixUp.id);
  });

  it('gives a repair wave private ownership when everything it wrote is claimed', () => {
    const state = createSampleState(SAMPLE_SEED);
    const scheduler = createDispatchScheduler(state, { laneLimit: 1, maxRetries: 0 });
    const runtime = createAgentRuntime({
      seed: 13,
      stepMs: 100,
      failureChance: 1,
      rollbackChance: 0,
      tokensPerStep: 100,
      tokensJitter: 0,
      contextBudget: 1_000_000,
      scheduler,
      claimedWriteSets: () => [
        { taskId: 'task-elsewhere', laneId: 'lane-verify', writeSet: ['src/sim/state.ts'] },
      ],
    });

    const ready = [
      readyTask('task-lane-comets', 'lane-build', ['src/sim/state.ts']),
    ];
    for (let pass = 0; pass < 3; pass += 1) runPass(scheduler, runtime, ready, pass * 1_000);

    expect(runtime.fixUps).toHaveLength(1);
    const fixUp = runtime.fixUps[0] as FixUpTask;
    expect(fixUp.writeSet).toEqual(['fixups/task-lane-comets']);
    expect(overlappingPaths(fixUp.writeSet, ['src/sim/state.ts'])).toEqual([]);
  });

  it('bounds the repair waves a single task may spawn', () => {
    const state = createSampleState(SAMPLE_SEED);
    const scheduler = createDispatchScheduler(state, { laneLimit: 1, maxRetries: 0 });
    const runtime = createAgentRuntime({
      seed: 21,
      stepMs: 100,
      failureChance: 1,
      rollbackChance: 0,
      tokensPerStep: 80,
      tokensJitter: 0,
      contextBudget: 1_000_000,
      maxFixUps: 1,
      scheduler,
    });

    const ready: DispatchTaskInput[] = [
      readyTask('task-gates', 'lane-verify', ['src/sim/verification.ts']),
    ];
    const passes: ScheduleReport[] = [];
    for (let pass = 0; pass < 4; pass += 1) {
      passes.push(scheduler.schedule({ at: pass * 1_000, ready }));
      for (const dispatch of passes[pass]?.dispatched ?? []) dispatchWork(runtime, dispatch);
      runtime.advance(1_000);
    }

    // The failed task spawns one repair wave, and the repair's own failure does
    // not spawn a second one — the bound is per root task.
    expect(runtime.fixUps.map((fixUp) => fixUp.id)).toEqual(['fixup-task-gates']);

    const repair = runtime.fixUps[0] as FixUpTask;
    const repaired = scheduler.schedule({
      at: 50_000,
      ready: [{ id: repair.id, title: repair.objective, laneId: repair.laneId, writeSet: repair.writeSet }],
    });
    expect(repaired.inFlightTaskIds).toContain(repair.id);
  });

  it('requeues a rollback and escalates it once the attempts run out', () => {
    const state = createSampleState(SAMPLE_SEED);
    const recorder = createEventRecorder();
    const scheduler = createDispatchScheduler(state, { laneLimit: 1, maxRetries: 1, emit: recorder.emit });
    const runtime = createAgentRuntime({
      seed: 3,
      stepMs: 100,
      failureChance: 0,
      rollbackChance: 1,
      tokensPerStep: 250,
      tokensJitter: 0,
      contextBudget: 1_000_000,
      scheduler,
      emit: recorder.emit,
    });

    const ready: DispatchTaskInput[] = [
      readyTask('task-lane-comets', 'lane-build', ['src/render/laneAgents.ts']),
    ];
    const reports: ScheduleReport[] = [];
    for (let pass = 0; pass < 4; pass += 1) reports.push(runPass(scheduler, runtime, ready, pass * 1_000));

    expect(runtime.settlements).toHaveLength(2);
    expect(runtime.settlements[0]?.outcome).toBe('rollback');
    expect(runtime.settlements[0]?.progress).toBe(0);
    expect(runtime.settlements[0]?.decision.requeued).toBe(true);
    expect(runtime.settlements[0]?.contextTokens).toBeGreaterThan(0);
    expect(runtime.settlements[1]?.outcome).toBe('rollback');
    expect(runtime.settlements[1]?.decision.terminal).toBe(true);
    expect(runtime.settlements[1]?.decision.needsFixUp).toBe(true);
    expect(runtime.fixUps.map((fixUp) => fixUp.id)).toEqual(['fixup-task-lane-comets']);
    expect(reports.flatMap((report) => report.retried)).toHaveLength(1);
    expect(reports.flatMap((report) => report.failed)).toHaveLength(1);

    // A rollback leaves the plan task waiting rather than failed.
    const reduced = applyDomainEvents(state, recorder.events);
    expect(reduced.plan.tasks['task-lane-comets']?.status).toBe('failed');
    const statuses = recorder.events
      .filter((event) => event.type === 'plan/task-updated')
      .map((event) => (event.type === 'plan/task-updated' ? event.status : undefined));
    expect(statuses).toEqual(['pending', 'failed']);
  });
});

/* -------------------------------------------------------------------------- */
/* Determinism and integration                                               */
/* -------------------------------------------------------------------------- */

describe('determinism and integration', () => {
  interface MissionRun {
    reports: readonly ScheduleReport[];
    agents: ReturnType<typeof createAgentRuntime>['agents'];
    settlements: ReturnType<typeof createAgentRuntime>['settlements'];
    fixUps: readonly FixUpTask[];
    state: GameState;
  }

  function simulateMission(seed: number, passes = 10): MissionRun {
    const state = createSampleState(seed);
    const recorder = createEventRecorder();
    const scheduler = createDispatchScheduler(state, {
      laneLimit: 2,
      maxRetries: 1,
      emit: recorder.emit,
    });
    const runtime = createAgentRuntime({
      seed,
      stepMs: 100,
      failureChance: 0.3,
      rollbackChance: 0.2,
      tokensPerStep: 400,
      tokensJitter: 25,
      contextBudget: 60_000,
      maxFixUps: 2,
      scheduler,
      emit: recorder.emit,
    });

    const reports: ScheduleReport[] = [];
    for (let pass = 0; pass < passes; pass += 1) {
      reports.push(runPass(scheduler, runtime, MISSION_TASKS, pass * 1_000));
    }

    return {
      reports,
      agents: runtime.agents,
      settlements: runtime.settlements,
      fixUps: runtime.fixUps,
      state: applyDomainEvents(state, recorder.events),
    };
  }

  it('replays the same seed and ready sets to identical lane and agent records', () => {
    const first = simulateMission(SAMPLE_SEED);
    const second = simulateMission(SAMPLE_SEED);

    expect(second.reports).toEqual(first.reports);
    expect(second.agents).toEqual(first.agents);
    expect(second.settlements).toEqual(first.settlements);
    expect(second.fixUps).toEqual(first.fixUps);
    expect(second.state).toEqual(first.state);

    // The run is not vacuous: agents worked, and the mission saw a repair wave.
    expect(first.agents.length).toBeGreaterThan(2);
    expect(first.settlements.some((settlement) => settlement.outcome !== 'success')).toBe(true);
    expect(first.state.plan.order.some((taskId) => taskId.startsWith('fixup-'))).toBe(true);
    expect(first.state.economy.contextSpent).toBeGreaterThan(createSampleState(SAMPLE_SEED).economy.contextSpent);
  });

  it('schedules a different mission when the seed changes', () => {
    const first = simulateMission(SAMPLE_SEED);
    const other = simulateMission(SAMPLE_SEED + 1);
    expect(other.agents).not.toEqual(first.agents);
    expect(other.settlements).not.toEqual(first.settlements);
  });

  it('reduces every lane fact into the shared GameState without mutating it', () => {
    const state = createSampleState(SAMPLE_SEED);
    const pristine = structuredClone(state);
    const recorder = createEventRecorder();
    const scheduler = createDispatchScheduler(state, {
      laneLimit: 2,
      maxRetries: 0,
      emit: recorder.emit,
    });
    const runtime = createAgentRuntime({
      seed: 11,
      stepMs: 100,
      failureChance: 0,
      rollbackChance: 0,
      tokensPerStep: 300,
      tokensJitter: 0,
      contextBudget: 1_000_000,
      scheduler,
      emit: recorder.emit,
    });

    const ready: DispatchTaskInput[] = [
      readyTask('task-lane-comets', 'lane-build', ['src/render/laneAgents.ts']),
      readyTask('task-gates', 'lane-verify', ['src/sim/verification.ts']),
      readyTask('task-economy', 'lane-observe', ['src/ui/panels.ts']),
    ];

    // The mission clock is the runtime's clock, so lane and agent events share
    // a single timeline when they are reduced together.
    const first = scheduler.schedule({ at: runtime.elapsedMs, ready });
    for (const dispatch of first.dispatched) dispatchWork(runtime, dispatch);
    const running = applyDomainEvents(state, recorder.events);
    expect(first.inFlightTaskIds).toHaveLength(2);
    expect(running.lanes.lanes['lane-build']?.activeTaskId).toBe('task-lane-comets');
    expect(running.lanes.lanes['lane-build']?.utilization).toBeGreaterThan(0);
    expect(running.plan.tasks['task-lane-comets']?.status).toBe('running');
    expect(running.mission.elapsedMs).toBeGreaterThanOrEqual(pristine.mission.elapsedMs);
    expect(running.lanes.lanes['lane-build']?.queue).toContain('task-economy');

    // Run the dispatched agents to completion, then reduce the rest.
    let guard = 0;
    while (runtime.report().activeAgents > 0 && guard < 50) {
      runtime.advance(1_000);
      guard += 1;
    }
    const settled = applyDomainEvents(state, recorder.events);
    expect(runtime.report().activeAgents).toBe(0);
    expect(settled.lanes.lanes['lane-build']?.activeTaskId).toBeNull();
    expect(settled.lanes.lanes['lane-verify']?.activeTaskId).toBeNull();
    expect(settled.plan.tasks['task-lane-comets']?.status).toBe('passed');
    expect(settled.plan.tasks['task-gates']?.status).toBe('passed');
    expect(settled.plan.tasks['task-lane-comets']?.finishedAtMs).not.toBeNull();
    expect(settled.plan.tasks['task-lane-comets']?.progress).toBe(1);
    expect(settled.economy.contextSpent - state.economy.contextSpent).toBe(runtime.contextSpent);

    // The state the scheduler was handed was never touched.
    expect(state).toEqual(pristine);

    // Emitted events replay through the journal onto the same result.
    const journal = createDomainEventJournal();
    for (const event of recorder.events) journal.record(event);
    expect(journal.replay(state).state).toEqual(settled);
  });
});
