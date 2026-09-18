/**
 * Dependency graph: phase layering, cycle diagnostics and write-conflict boundaries.
 *
 * Runs in the default Node environment: the graph module must be usable with no
 * DOM, no canvas and no GPU, and every build/query must be pure, deterministic
 * and non-mutating. Graphs are built from the real `createSampleState` fixtures
 * so the layering rules are proven against the shared `GameState` contract
 * rather than against hand-written state objects.
 */

import { describe, expect, it } from 'vitest';

import { SAMPLE_MISSION_ID, SAMPLE_SEED, createSampleState } from '../src/sim/fixtures';
import {
  applyDomainEvents,
  createInitialState,
  createSnapshot,
  makeDomainEvent,
  type DomainEvent,
  type GameState,
} from '../src/sim/state';
import {
  buildDependencyGraph,
  planTasksFromState,
  queryBlockedTasks,
  queryConflicts,
  queryPhase,
  queryPhaseFlow,
  queryReadyTasks,
  queryTaskPhase,
  queryTaskReadiness,
  summarizeGraph,
  type DependencyGraph,
  type GraphTaskInput,
  type TaskOwnershipMap,
} from '../src/sim/graph';

/** The sample plan's phases, in plan order, for the shipped fixture. */
const SAMPLE_PHASES: readonly (readonly string[])[] = [
  ['task-shell'],
  ['task-contract'],
  ['task-lane-comets', 'task-gates', 'task-economy'],
  ['task-constellation'],
  ['task-review'],
];

/** Independent re-derivation of "do these two write sets claim a path twice?". */
function sharedPaths(left: readonly string[], right: readonly string[]): string[] {
  const shared: string[] = [];
  for (const a of left) {
    for (const b of right) {
      const overlaps = a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));
      if (!overlaps) continue;
      if (!shared.includes(a)) shared.push(a);
      if (!shared.includes(b)) shared.push(b);
    }
  }
  return shared;
}

/**
 * The invariant the player is taught: every task depends only on earlier
 * phases, and no phase contains two tasks with overlapping write ownership.
 */
function expectLayeredAndDisjoint(graph: DependencyGraph): void {
  for (const task of graph.tasks) {
    if (task.phase === null) continue;
    for (const dep of task.dependsOn) {
      const upstream = graph.byId[dep];
      if (!upstream) continue;
      expect(upstream.phase).not.toBeNull();
      expect(upstream.phase as number).toBeLessThan(task.phase);
    }
  }

  const listed: string[] = [];
  graph.phases.forEach((phase, index) => {
    expect(phase.index).toBe(index);
    expect(phase.label).toBe(`Phase ${index + 1}`);
    for (const id of phase.taskIds) {
      expect(graph.byId[id]?.phase).toBe(index);
      listed.push(id);
    }
    for (let i = 0; i < phase.taskIds.length; i += 1) {
      for (let j = i + 1; j < phase.taskIds.length; j += 1) {
        const left = graph.byId[phase.taskIds[i] ?? '']?.writeSet ?? [];
        const right = graph.byId[phase.taskIds[j] ?? '']?.writeSet ?? [];
        expect(sharedPaths(left, right)).toEqual([]);
      }
    }
  });

  const layered = graph.tasks.filter((task) => task.phase !== null).map((task) => task.id);
  expect([...listed].sort()).toEqual([...layered].sort());
}

/** Deterministic per-task ownership: unique write paths, so phases stay disjoint. */
function fixtureOwnership(state: GameState, missionId: string): TaskOwnershipMap {
  const ownership: Record<string, { writeSet: string[]; readSet: string[] }> = {};
  for (const id of state.plan.order) {
    ownership[id] = {
      writeSet: [`src/missions/${missionId}/${id}.ts`],
      readSet: ['src/sim/state.ts'],
    };
  }
  return ownership;
}

/** Reduce a script of plan updates into a new state (state is never mutated). */
function advance(state: GameState, at: number, updates: readonly [string, 'passed' | 'pending'][]) {
  const events: DomainEvent[] = updates.map(([taskId, status], index) =>
    makeDomainEvent('plan/task-updated', { taskId, status, progress: status === 'passed' ? 1 : 0 }, at + index),
  );
  return applyDomainEvents(state, events);
}

describe('buildDependencyGraph', () => {
  it('layers the sample mission into dependency phases', () => {
    const state = createSampleState();
    const graph = buildDependencyGraph(state);

    expect(graph.planId).toBe(state.plan.id);
    expect(graph.status).toBe('accepted');
    expect(graph.diagnostics).toEqual([]);
    expect(graph.conflicts).toEqual([]);
    expect(graph.cycles).toEqual([]);

    expect(graph.phases.map((phase) => phase.taskIds)).toEqual(SAMPLE_PHASES);
    expect(graph.phases.map((phase) => phase.id)).toEqual([
      'phase-0',
      'phase-1',
      'phase-2',
      'phase-3',
      'phase-4',
    ]);
    expect(graph.phases.map((phase) => phase.label)).toEqual([
      'Phase 1',
      'Phase 2',
      'Phase 3',
      'Phase 4',
      'Phase 5',
    ]);
    expectLayeredAndDisjoint(graph);

    expect(graph.tasks).toHaveLength(state.plan.order.length);
    expect(graph.byId['task-review']?.dependsOn).toEqual(['task-gates', 'task-constellation']);
    expect(graph.byId['task-contract']?.dependents).toEqual([
      'task-lane-comets',
      'task-gates',
      'task-economy',
    ]);
    expect(graph.byId['task-shell']?.dependents).toEqual(['task-contract']);
    expect(graph.byId['task-shell']?.title).toBe('Scaffold the holographic shell');
    expect(graph.byId['task-shell']?.laneId).toBe('lane-build');

    expect(queryTaskPhase(graph, 'task-review')).toBe(4);
    expect(queryTaskPhase(graph, 'task-ghost')).toBeNull();
    expect(queryPhase(graph, 2)?.taskIds).toEqual(['task-lane-comets', 'task-gates', 'task-economy']);
    expect(queryPhase(graph, 2)?.label).toBe('Phase 3');
    expect(queryPhase(graph, 99)).toBeNull();
  });

  it('accepts and layers every authored mission fixture', () => {
    const seeds = [SAMPLE_SEED, 1, 7, 42, 2026];
    const missionIds = [SAMPLE_MISSION_ID, 'mission-coroid-repair-drill'];

    for (const seed of seeds) {
      for (const missionId of missionIds) {
        const state = createSampleState({ seed, missionId });
        const graph = buildDependencyGraph(state, fixtureOwnership(state, missionId));

        expect(graph.status).toBe('accepted');
        expect(graph.diagnostics).toEqual([]);
        expect(graph.conflicts).toEqual([]);
        expect(graph.tasks).toHaveLength(state.plan.order.length);
        expect(graph.phases[0]?.taskIds).toEqual(['task-shell']);
        expect(graph.phases.map((phase) => phase.taskIds)).toEqual(SAMPLE_PHASES);
        expectLayeredAndDisjoint(graph);
      }
    }
  });

  it('rejects dependency cycles with a readable diagnostic', () => {
    const tasks: GraphTaskInput[] = [
      { id: 'task-a', dependsOn: ['task-b'] },
      { id: 'task-b', dependsOn: ['task-c'] },
      { id: 'task-c', dependsOn: ['task-a'] },
      // Reaches the cycle without being part of it: it must not be reported twice.
      { id: 'task-d', dependsOn: ['task-a'] },
      { id: 'task-e' },
    ];

    const graph = buildDependencyGraph(tasks);
    expect(graph.status).toBe('rejected');
    expect(graph.planId).toBe('plan-adhoc');
    expect(graph.cycles).toEqual([
      { taskIds: ['task-a', 'task-b', 'task-c', 'task-a'], path: 'task-a → task-b → task-c → task-a' },
    ]);
    expect(graph.diagnostics).toEqual([
      {
        code: 'dependency-cycle',
        severity: 'error',
        message:
          'Cycle detected in plan dependsOn: task-a → task-b → task-c → task-a. Tasks on the cycle were not layered.',
        taskIds: ['task-a', 'task-b', 'task-c', 'task-a'],
        paths: [],
        phase: null,
      },
    ]);

    // The cyclic tasks are never layered; everything else still is.
    expect(graph.phases.map((phase) => phase.taskIds)).toEqual([['task-e']]);
    expect(graph.byId['task-a']?.phase).toBeNull();
    expect(graph.byId['task-e']?.phase).toBe(0);
    expect(summarizeGraph(graph)).toBe('Plan graph rejected: 1 dependency cycle.');

    const state = createInitialState();
    expect(queryTaskReadiness(graph, state, 'task-a').reason).toBe(
      'Not dispatchable: task sits on the dependency cycle task-a → task-b → task-c → task-a.',
    );
    expect(queryTaskReadiness(graph, state, 'task-a').flow).toBe('blocked');
    expect(queryTaskReadiness(graph, state, 'task-d').flow).toBe('blocked');
    expect(queryTaskReadiness(graph, state, 'task-e').flow).toBe('ready');
    expect(queryReadyTasks(graph, state).map((entry) => entry.taskId)).toEqual(['task-e']);

    const twoCycle = buildDependencyGraph([
      { id: 'task-a', dependsOn: ['task-b'] },
      { id: 'task-b', dependsOn: ['task-a'] },
    ]);
    expect(twoCycle.cycles.map((cycle) => cycle.path)).toEqual(['task-a → task-b → task-a']);

    // Same input, same graph — twice.
    expect(JSON.stringify(buildDependencyGraph(tasks))).toBe(JSON.stringify(graph));
  });

  it('reports unknown and self dependencies instead of producing an invalid graph', () => {
    const graph = buildDependencyGraph([
      { id: 't-shell', dependsOn: [] },
      { id: 't-review', dependsOn: ['t-shell', 't-ghost'] },
      { id: 't-self', dependsOn: ['t-self'] },
    ]);

    expect(graph.status).toBe('rejected');
    expect(graph.diagnostics.map((entry) => entry.code)).toEqual([
      'unknown-dependency',
      'self-dependency',
    ]);
    expect(graph.diagnostics.map((entry) => entry.message)).toEqual([
      'Task "t-review" depends on unknown task "t-ghost"; the dependency was ignored for layering.',
      'Task "t-self" depends on itself; the self dependency was ignored for layering.',
    ]);
    expect(graph.diagnostics[0]?.taskIds).toEqual(['t-review']);
    expect(graph.diagnostics[0]?.paths).toEqual(['t-ghost']);
    expect(graph.diagnostics[0]?.phase).toBeNull();

    // Known edges still layer, so the rest of the plan stays usable.
    expect(graph.byId['t-review']?.dependsOn).toEqual(['t-shell', 't-ghost']);
    expect(graph.byId['t-review']?.phase).toBe(1);
    expect(graph.byId['t-self']?.phase).toBe(0);
    expect(graph.phases.map((phase) => phase.taskIds)).toEqual([['t-shell', 't-self'], ['t-review']]);
    expect(summarizeGraph(graph)).toBe('Plan graph rejected: 1 unknown dependency, 1 malformed task.');

    const settledShell = applyDomainEvents(createInitialState(), [
      makeDomainEvent(
        'plan/task-registered',
        { task: { id: 't-shell', title: 'Shell', laneId: 'lane-build' } },
        0,
      ),
      makeDomainEvent('plan/task-updated', { taskId: 't-shell', status: 'passed', progress: 1 }, 10),
    ]);

    const readiness = queryTaskReadiness(graph, settledShell, 't-review');
    expect(readiness.flow).toBe('blocked');
    expect(readiness.unknownDependencies).toEqual(['t-ghost']);
    expect(readiness.blockedBy).toEqual(['t-ghost']);
    expect(readiness.reason).toBe('Blocked by unmet dependencies: t-ghost (no such task).');
    expect(queryReadyTasks(graph, settledShell).map((entry) => entry.taskId)).toEqual(['t-self']);
  });

  it('reports same-phase write conflicts with both task keys and the shared paths', () => {
    const state = createSampleState();
    const ownership: TaskOwnershipMap = {
      // Same file in two different phases: allowed, and normalised before compare.
      'task-shell': { writeSet: ['src/sim/state.ts'] },
      'task-contract': { writeSet: ['./src/sim//state.ts'] },
      'task-lane-comets': { writeSet: ['src/render/laneAgents.ts', 'src/sim/graph.ts'] },
      'task-gates': { writeSet: ['src/sim/graph.ts'] },
      'task-economy': { writeSet: ['src/sim/economy.ts'] },
      'task-constellation': { writeSet: ['src/render/qualityGraph.ts'] },
      'task-review': { writeSet: ['src/game/Game.ts'] },
    };

    const graph = buildDependencyGraph(state, ownership);

    expect(graph.status).toBe('rejected');
    expect(graph.conflicts).toEqual([
      {
        phase: 2,
        phaseLabel: 'Phase 3',
        taskIds: ['task-lane-comets', 'task-gates'],
        paths: ['src/sim/graph.ts'],
        message:
          'Phase 3 write conflict: "task-lane-comets" and "task-gates" both claim src/sim/graph.ts.',
      },
    ]);
    expect(graph.diagnostics).toEqual([
      {
        code: 'write-conflict',
        severity: 'error',
        message:
          'Phase 3 write conflict: "task-lane-comets" and "task-gates" both claim src/sim/graph.ts.',
        taskIds: ['task-lane-comets', 'task-gates'],
        paths: ['src/sim/graph.ts'],
        phase: 2,
      },
    ]);
    expect(queryConflicts(graph)).toEqual(graph.conflicts);
    expect(queryConflicts(graph, 'task-gates')).toHaveLength(1);
    expect(queryConflicts(graph, 'task-review')).toHaveLength(0);
    expect(summarizeGraph(graph)).toBe('Plan graph rejected: 1 write conflict.');

    // Conflict-free ownership keeps the same plan accepted and layer-disjoint.
    const clean = buildDependencyGraph(state, fixtureOwnership(state, SAMPLE_MISSION_ID));
    expect(clean.status).toBe('accepted');
    expect(clean.conflicts).toEqual([]);
    expectLayeredAndDisjoint(clean);
  });

  it('treats a declared directory as owning everything beneath it', () => {
    const graph = buildDependencyGraph([
      { id: 'task-a', writeSet: ['src/render/'] },
      { id: 'task-b', writeSet: ['./src/render/laneAgents.ts'] },
    ]);

    expect(graph.status).toBe('rejected');
    expect(graph.conflicts).toHaveLength(1);
    expect(graph.conflicts[0]?.taskIds).toEqual(['task-a', 'task-b']);
    expect(graph.conflicts[0]?.paths).toEqual(['src/render/', 'src/render/laneAgents.ts']);
    expect(graph.conflicts[0]?.message).toBe(
      'Phase 1 write conflict: "task-a" and "task-b" both claim src/render/, src/render/laneAgents.ts.',
    );
  });

  it('allows overlapping writes across phases and read-only overlaps in one phase', () => {
    const chained = buildDependencyGraph([
      { id: 'task-a', dependsOn: [], writeSet: ['src/sim/graph.ts'] },
      { id: 'task-b', dependsOn: ['task-a'], writeSet: ['./src/sim/graph.ts'] },
    ]);
    expect(chained.status).toBe('accepted');
    expect(chained.conflicts).toEqual([]);
    expect(chained.byId['task-b']?.phase).toBe(1);
    expectLayeredAndDisjoint(chained);

    const readers = buildDependencyGraph([
      { id: 'task-a', writeSet: ['src/a.ts'], readSet: ['src/shared.ts'] },
      { id: 'task-b', writeSet: ['src/b.ts'], readSet: ['./src/shared.ts'] },
    ]);
    expect(readers.status).toBe('accepted');
    expect(readers.conflicts).toEqual([]);
    expectLayeredAndDisjoint(readers);
  });

  it('builds the same graph from a frozen snapshot and never mutates its input', () => {
    const state = createSampleState();
    const snapshot = createSnapshot(state);
    const before = structuredClone(state);

    const graph = buildDependencyGraph(snapshot);
    expect(graph.status).toBe('accepted');
    expect(graph.phases.map((phase) => phase.taskIds)).toEqual(
      buildDependencyGraph(state).phases.map((phase) => phase.taskIds),
    );

    const ready = queryReadyTasks(graph, snapshot);
    const phaseFlow = queryPhaseFlow(graph, snapshot);
    queryBlockedTasks(graph, snapshot);
    queryTaskReadiness(graph, snapshot, 'task-review');

    // Queries are read-only: neither the live state nor the snapshot moved.
    expect(state).toEqual(before);
    expect(snapshot.plan.order).toEqual(before.plan.order);
    expect(state.revision).toBe(before.revision);

    // Repeated calls answer identically.
    expect(queryReadyTasks(graph, snapshot)).toEqual(ready);
    expect(queryPhaseFlow(graph, snapshot)).toEqual(phaseFlow);
    expect(JSON.stringify(queryPhaseFlow(graph, snapshot))).toBe(JSON.stringify(phaseFlow));

    // Graph results are frozen so no consumer can corrupt them.
    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.tasks)).toBe(true);
    expect(Object.isFrozen(graph.tasks[0])).toBe(true);
    expect(Object.isFrozen(graph.conflicts)).toBe(true);
  });

  it('projects the plan slice into graph input with ownership attached', () => {
    const state = createSampleState();
    const inputs = planTasksFromState(state, {
      'task-shell': { writeSet: ['src/sim/state.ts'], readSet: ['src/game/events.ts'] },
    });

    expect(inputs.map((input) => input.id)).toEqual(state.plan.order);
    expect(inputs[0]).toEqual({
      id: 'task-shell',
      title: 'Scaffold the holographic shell',
      laneId: 'lane-build',
      dependsOn: [],
      writeSet: ['src/sim/state.ts'],
      readSet: ['src/game/events.ts'],
    });
    expect(inputs.find((input) => input.id === 'task-lane-comets')).toMatchObject({
      id: 'task-lane-comets',
      dependsOn: ['task-contract'],
      writeSet: [],
      readSet: [],
    });
    expect(inputs.find((input) => input.id === 'task-review')?.dependsOn).toEqual([
      'task-gates',
      'task-constellation',
    ]);

    // The plan slice alone is enough to build the same phases.
    expect(buildDependencyGraph(state.plan).phases.map((phase) => phase.taskIds)).toEqual(SAMPLE_PHASES);
    expect(buildDependencyGraph(state.plan).status).toBe('accepted');
  });
});

describe('flow queries', () => {
  it('reports ready and blocked tasks from the plan slice', () => {
    const state = createSampleState();
    const graph = buildDependencyGraph(state);

    // Nothing is dispatchable yet: economy is recorded blocked, review still waits.
    expect(queryReadyTasks(graph, state)).toEqual([]);
    expect(queryBlockedTasks(graph, state).map((entry) => entry.taskId)).toEqual([
      'task-economy',
      'task-review',
    ]);

    const review = queryTaskReadiness(graph, state, 'task-review');
    expect(review).toEqual({
      taskId: 'task-review',
      flow: 'blocked',
      phase: 4,
      blockedBy: ['task-gates', 'task-constellation'],
      unknownDependencies: [],
      conflictPaths: [],
      conflictingTaskIds: [],
      recordedStatus: 'pending',
      reason: 'Blocked by unmet dependencies: task-gates, task-constellation.',
    });

    const economy = queryTaskReadiness(graph, state, 'task-economy');
    expect(economy.flow).toBe('blocked');
    expect(economy.blockedBy).toEqual([]);
    expect(economy.reason).toBe('Recorded as blocked in the plan slice; no upstream dependency is missing.');

    expect(queryTaskReadiness(graph, state, 'task-shell')).toMatchObject({
      flow: 'settled',
      phase: 0,
      recordedStatus: 'passed',
      reason: 'Already passed; nothing left to dispatch.',
    });
    expect(queryTaskReadiness(graph, state, 'task-lane-comets')).toMatchObject({
      flow: 'running',
      phase: 2,
      reason: 'Already running in Phase 3.',
    });
    expect(queryTaskReadiness(graph, state, 'task-missing')).toMatchObject({
      flow: 'unknown',
      phase: null,
      recordedStatus: null,
      reason: 'Task "task-missing" is not part of the plan graph.',
    });

    // Completing upstream work through domain events flips the flow verdicts.
    const settled = advance(state, 120_000, [
      ['task-gates', 'passed'],
      ['task-constellation', 'passed'],
    ]);
    expect(queryReadyTasks(graph, settled).map((entry) => entry.taskId)).toEqual(['task-review']);
    expect(queryBlockedTasks(graph, settled).map((entry) => entry.taskId)).toEqual(['task-economy']);
    expect(queryTaskReadiness(graph, settled, 'task-review')).toMatchObject({
      flow: 'ready',
      blockedBy: [],
      reason: 'Ready to dispatch in Phase 5; every dependency has passed.',
    });

    const unblocked = advance(settled, 130_000, [['task-economy', 'pending']]);
    expect(queryReadyTasks(graph, unblocked).map((entry) => entry.taskId)).toEqual([
      'task-economy',
      'task-review',
    ]);

    // Stable across repeated calls on the same state.
    expect(queryReadyTasks(graph, unblocked)).toEqual(queryReadyTasks(graph, unblocked));
    expect(JSON.stringify(queryBlockedTasks(graph, unblocked))).toBe(
      JSON.stringify(queryBlockedTasks(graph, unblocked)),
    );
  });

  it('refuses conflicted lanes and names the colliding tasks and paths', () => {
    const state = createSampleState();
    const graph = buildDependencyGraph(state, {
      'task-lane-comets': { writeSet: ['src/sim/graph.ts'] },
      'task-gates': { writeSet: ['src/sim/graph.ts'] },
    });

    expect(graph.conflicts).toHaveLength(1);

    const comets = queryTaskReadiness(graph, state, 'task-lane-comets');
    expect(comets.flow).toBe('blocked');
    expect(comets.conflictPaths).toEqual(['src/sim/graph.ts']);
    expect(comets.conflictingTaskIds).toEqual(['task-gates']);
    expect(comets.reason).toBe(
      'Refused: Phase 3 write ownership collides with "task-gates" on src/sim/graph.ts.',
    );

    const gates = queryTaskReadiness(graph, state, 'task-gates');
    expect(gates.flow).toBe('blocked');
    expect(gates.conflictingTaskIds).toEqual(['task-lane-comets']);
    expect(gates.reason).toBe(
      'Refused: Phase 3 write ownership collides with "task-lane-comets" on src/sim/graph.ts.',
    );

    // Only the colliding lane pair is refused; the rest of phase 3 stays running.
    expect(queryTaskReadiness(graph, state, 'task-economy').flow).toBe('blocked');
    expect(queryBlockedTasks(graph, state).map((entry) => entry.taskId)).toEqual([
      'task-lane-comets',
      'task-gates',
      'task-economy',
      'task-review',
    ]);
  });

  it('summarises each phase for the dispatch board', () => {
    const state = createSampleState();
    const graph = buildDependencyGraph(state);
    const flow = queryPhaseFlow(graph, state);

    expect(flow.map((phase) => phase.label)).toEqual([
      'Phase 1',
      'Phase 2',
      'Phase 3',
      'Phase 4',
      'Phase 5',
    ]);
    expect(flow[0]).toEqual({
      index: 0,
      label: 'Phase 1',
      taskIds: ['task-shell'],
      ready: [],
      running: [],
      blocked: [],
      settled: ['task-shell'],
    });
    expect(flow[2]).toEqual({
      index: 2,
      label: 'Phase 3',
      taskIds: ['task-lane-comets', 'task-gates', 'task-economy'],
      ready: [],
      running: ['task-lane-comets', 'task-gates'],
      blocked: ['task-economy'],
      settled: [],
    });
    expect(flow[4]).toEqual({
      index: 4,
      label: 'Phase 5',
      taskIds: ['task-review'],
      ready: [],
      running: [],
      blocked: ['task-review'],
      settled: [],
    });
    expect(summarizeGraph(graph)).toBe('Plan graph accepted: 7 tasks in 5 phases, no write conflicts.');
  });
});
