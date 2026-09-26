/**
 * Mission flow integration tests.
 *
 * These are headless playthroughs: they drive `createMissionFlow` through the
 * real planner, dependency graph, lane scheduler, agent runtime, verification
 * gate, quality graph and economy, and assert on observable behaviour — the
 * lifecycle the mission walks, the repairs it opens, the manifest it ships and
 * the verdicts it declares.
 */

import { describe, expect, it } from 'vitest';

import {
  createMissionFlow,
  FLOW_PROVENANCE_KINDS,
  FLOW_STEP_MS,
  MISSION_PHASES,
  PHASE_TRANSITIONS,
  type MissionFlow,
  type MissionPhase,
} from '../src/game/flow';
import { MISSIONS, getMission } from '../src/content/missions';

/** Missions in campaign order, for unlock bookkeeping. */
const ALL_KEYS = MISSIONS.map((mission) => mission.key);

/**
 * A flow played with a quiet floor: no random failures, so a scripted
 * playthrough is a test of the machinery rather than of the dice.
 */
function createFlow(missionKey: string, overrides: Record<string, unknown> = {}): MissionFlow {
  return createMissionFlow({
    mission: missionKey,
    deliveredMissionKeys: ALL_KEYS,
    agent: { failureChance: 0, rollbackChance: 0 },
    ...overrides,
  });
}

/** Start and approve a mission, returning the flow with the floor open. */
function openFloor(missionKey: string, overrides: Record<string, unknown> = {}): MissionFlow {
  const flow = createFlow(missionKey, overrides);
  expect(flow.start()).not.toBeNull();
  expect(flow.approve()).not.toBeNull();
  return flow;
}

/** Open a mission's floor on the shipped balance, dice and all. */
function openFloorWithDice(missionKey: string): MissionFlow {
  const flow = createMissionFlow({ mission: missionKey, deliveredMissionKeys: ALL_KEYS });
  expect(flow.start()).not.toBeNull();
  expect(flow.approve()).not.toBeNull();
  return flow;
}

/** Advance in fixed slices until the mission ends or the frame budget runs out. */
function runToTerminal(flow: MissionFlow, maxFrames = 12_000, frameMs = 100): number {
  let frames = 0;
  while (flow.outcome === 'running' && frames < maxFrames) {
    flow.advance(frameMs);
    frames += 1;
  }
  return frames;
}

function phasesOf(flow: MissionFlow): MissionPhase[] {
  return flow.transitions().map((transition) => transition.to);
}

describe('mission flow: lifecycle', () => {
  it('walks brief, plan, approve, dispatch, verify and release with legal transitions', () => {
    const flow = createFlow('request-to-plan');
    expect(flow.phase).toBe('brief');
    expect(flow.outcome).toBe('running');

    // The brief is gated on the player's acknowledgement: nothing runs before it.
    expect(flow.phase).toBe('brief');
    const plan = flow.start();
    expect(plan).not.toBeNull();
    expect(flow.phase).toBe('approve');
    expect(flow.snapshot().state.plan.order.length).toBeGreaterThanOrEqual(6);

    // Nothing is dispatched before the human approves the plan.
    flow.advance(1_000);
    expect(flow.snapshot().agents.activeAgents).toBe(0);
    expect(flow.events().some((event) => event.type === 'lane/assigned')).toBe(false);

    expect(flow.approve()).not.toBeNull();
    expect(flow.phase).toBe('dispatch');
    expect(flow.snapshot().agents.activeAgents).toBeGreaterThan(0);

    runToTerminal(flow);

    expect(flow.outcome).toBe('won');
    expect(flow.lossKind).toBeNull();
    expect(flow.phase).toBe('release');

    const visited = phasesOf(flow);
    expect(visited[0]).toBe('plan');
    expect(visited[1]).toBe('approve');
    expect(visited).toContain('dispatch');
    expect(visited).toContain('verify');
    expect(visited[visited.length - 1]).toBe('release');

    for (const transition of flow.transitions()) {
      expect(PHASE_TRANSITIONS[transition.from]).toContain(transition.to);
      expect(transition.events.length).toBeGreaterThanOrEqual(1);
      expect(FLOW_PROVENANCE_KINDS).toContain(transition.provenance);
      expect(transition.text.length).toBeGreaterThan(0);
      expect(transition.atMs).toBeGreaterThanOrEqual(0);
    }
    // Every state transition carried its events into the shared contract.
    const emitted = new Set(flow.events().map((event) => JSON.stringify(event)));
    for (const transition of flow.transitions()) {
      for (const event of transition.events) {
        expect(emitted.has(JSON.stringify(event))).toBe(true);
      }
    }
    expect(MISSION_PHASES.length).toBe(7);
  });

  it('refuses an illegal jump by construction and keeps phases monotone', () => {
    const flow = createFlow('request-to-plan');
    // `approve()` before `start()` is a no-op rather than a jump.
    expect(flow.approve()).toBeNull();
    expect(flow.phase).toBe('brief');
    // `start()` is idempotent while the mission runs.
    expect(flow.start()).not.toBeNull();
    expect(flow.start()).toBeNull();
    expect(flow.phase).toBe('approve');
    for (const [from, allowed] of Object.entries(PHASE_TRANSITIONS)) {
      expect(allowed).not.toContain(from);
    }
  });

  it('ships a manifest with provenance-tagged evidence for every passed task', () => {
    const flow = openFloor('parallel-lanes');
    runToTerminal(flow);
    const snapshot = flow.snapshot();

    expect(snapshot.outcome).toBe('won');
    expect(snapshot.manifest.shipped).toBe(true);
    expect(snapshot.manifest.shippedAtMs).not.toBeNull();
    expect(snapshot.manifest.entries.length).toBeGreaterThan(0);
    expect(snapshot.manifest.entries.length).toBe(snapshot.readings.metrics?.['tasks-passed']);
    expect(snapshot.manifest.coverageRatio).toBe(1);
    expect(snapshot.manifest.provenanceRatio).toBe(1);

    for (const entry of snapshot.manifest.entries) {
      expect(entry.evidenceCheckIds.length).toBeGreaterThan(0);
      expect(FLOW_PROVENANCE_KINDS).toContain(entry.provenance);
      expect(entry.taskId.length).toBeGreaterThan(0);
    }

    // Release readiness is decided by final invariants only.
    expect(snapshot.verification.readiness.finalInvariantKeys.length).toBeGreaterThan(0);
    expect(snapshot.verification.readiness.unmetKeys).toEqual([]);
    expect(snapshot.verification.readiness.ready).toBe(true);
    expect(snapshot.quality.invariantsAtRisk).toBe(0);
    expect(snapshot.quality.ready).toBe(true);
    expect(snapshot.verdict.outcome).toBe('won');
  });

  it('produces a provenance-tagged log for the event terminal', () => {
    const flow = openFloor('request-to-plan');
    runToTerminal(flow);
    const log = flow.log();
    expect(log.length).toBeGreaterThan(0);
    for (const entry of log) {
      expect(FLOW_PROVENANCE_KINDS).toContain(entry.provenance);
      expect(entry.text.length).toBeGreaterThan(0);
    }
    // The mission's own authored flavour lines are replayed with their provenance.
    const mission = getMission('request-to-plan');
    expect(mission).toBeDefined();
    for (const line of mission?.eventLog ?? []) {
      expect(log.some((entry) => entry.id === line.id && entry.provenance === line.provenance)).toBe(true);
    }
  });
});

describe('mission flow: repair', () => {
  it('blocks dependents, opens a repair objective and releases only after the fix-up passes', () => {
    const flow = openFloor('request-to-plan');
    // The very first task has dependents: every later phase waits on it.
    const root = flow.snapshot().state.plan.order[0];
    expect(root).toBeDefined();
    if (root === undefined) return;
    const dependents = flow.snapshot().plan.filter((row) => row.dependencies.includes(root)).map((row) => row.id);
    expect(dependents.length).toBeGreaterThan(0);

    // Let the plan settle so the root is in flight, then force its check to fail
    // when the run reports success.
    while (flow.snapshot().plan.find((row) => row.id === root)?.status === 'pending') {
      flow.advance(50);
    }
    const hazard = flow.forceCheckFailure(root, { detail: 'regression forced by the flow test' });
    expect(hazard.kind).toBe('failing-check');
    expect(hazard.provenance).toBe('architect_choice');

    let sawBlocked = false;
    let sawOpenRepair = false;
    let sawRepairTask = false;
    let frames = 0;
    while (flow.outcome === 'running' && frames < 12_000) {
      flow.advance(50);
      frames += 1;
      const snapshot = flow.snapshot();
      if (snapshot.verification.blockedTaskIds.some((taskId) => dependents.includes(taskId))) sawBlocked = true;
      if (snapshot.verification.openRepairObjectiveIds.length > 0) sawOpenRepair = true;
      if (snapshot.plan.some((row) => row.origin === 'repair')) sawRepairTask = true;
    }

    expect(sawBlocked).toBe(true);
    expect(sawOpenRepair).toBe(true);
    expect(sawRepairTask).toBe(true);
    expect(flow.outcome).toBe('won');

    const snapshot = flow.snapshot();
    // The repair objective that the forced failure opened is closed again.
    expect(snapshot.verification.openRepairObjectiveIds).toEqual([]);
    expect(snapshot.readings.metrics?.['failures-repaired']).toBeGreaterThanOrEqual(1);
    expect(snapshot.quality.invariantsAtRisk).toBe(0);
    expect(snapshot.verification.readiness.ready).toBe(true);
    // The superseded criterion history survives: the repair replaced a commitment.
    expect(snapshot.readings.metrics?.['criteria-superseded']).toBeGreaterThanOrEqual(1);
    expect(snapshot.verdict.outcome).toBe('won');
  });
});

describe('mission flow: loss conditions', () => {
  it('declares context exhaustion when the mission burns through its budget', () => {
    const flow = openFloor('request-to-plan');
    const budget = flow.snapshot().state.economy.contextBudget;
    flow.drainContext(budget, 'an expensive detour the intake desk insisted on');
    flow.advance(100);

    expect(flow.outcome).toBe('lost');
    expect(flow.lossKind).toBe('context-exhaustion');
    expect(flow.snapshot().state.mission.status).toBe('blocked');
    expect(flow.log().some((entry) => entry.source === 'flow/verdict' && entry.text.includes('context-exhaustion'))).toBe(
      true,
    );
  });

  it('declares a write-conflict storm when same-phase ownership collides', () => {
    const flow = openFloor('parallel-lanes');
    // Extra work that claims one path from several tasks in the same phase.
    for (let index = 1; index <= 4; index += 1) {
      flow.addTask({
        id: `storm-${index}`,
        title: `Unplanned work ${index}`,
        laneId: 'lane-build',
        writeSet: ['src/game/storm-shared.ts'],
      });
    }
    flow.advance(100);

    const snapshot = flow.snapshot();
    expect(snapshot.readings.metrics?.['conflicts-open']).toBeGreaterThanOrEqual(6);
    expect(flow.outcome).toBe('lost');
    expect(flow.lossKind).toBe('write-conflict-storm');
    expect(snapshot.graph.status).toBe('rejected');
    expect(snapshot.graph.conflicts).toBeGreaterThanOrEqual(6);
  });

  it('declares unrepaired final invariants when the delivery slot closes', () => {
    // A floor where every run breaks: nothing can be proven, so the invariants
    // stay at risk until the mission clock runs out.
    const flow = openFloor('request-to-plan', { agent: { failureChance: 1, rollbackChance: 0 } });
    runToTerminal(flow, 40_000, 250);

    expect(flow.outcome).toBe('lost');
    expect(flow.lossKind).toBe('invariant-deadline');
    const snapshot = flow.snapshot();
    expect(snapshot.simMs).toBeGreaterThanOrEqual(snapshot.deadlineMs);
    expect(snapshot.quality.invariantsAtRisk).toBeGreaterThanOrEqual(1);
    expect(snapshot.verification.readiness.ready).toBe(false);
    expect(snapshot.manifest.shipped).toBe(false);
    expect(snapshot.readings.metrics?.['failures-repaired']).toBe(0);
  });
});

describe('mission flow: tutorials and unlocks', () => {
  it('surfaces tutorial steps in order with their highlight targets', () => {
    const mission = getMission('request-to-plan');
    const flow = createFlow('request-to-plan');
    const catalogue = mission?.tutorial ?? [];
    expect(catalogue.length).toBeGreaterThan(0);

    const first = catalogue[0];
    expect(flow.tutorial().stepId).toBe(first?.id);
    expect(flow.tutorial().targets).toEqual(first?.targets);
    expect(flow.tutorial().targets.length).toBeGreaterThan(0);
    for (const target of flow.tutorial().targets) {
      expect(['hud', 'panel', 'scene']).toContain(target.surface);
      expect(target.selector.length).toBeGreaterThan(0);
    }

    // The first step waits for an explicit acknowledgement.
    expect(first?.advanceWhen.kind).toBe('acknowledge');
    expect(flow.acknowledge()).toBe(true);
    expect(flow.tutorial().completedStepIds).toEqual([first?.id]);
    expect(flow.acknowledge()).toBe(false);

    flow.start();
    flow.approve();
    const seen: string[] = [...flow.tutorial().completedStepIds];
    let frames = 0;
    while (flow.outcome === 'running' && frames < 12_000) {
      flow.advance(50);
      frames += 1;
      const progress = flow.tutorial();
      if (!seen.includes(progress.stepId) && progress.stepId !== '') seen.push(progress.stepId);
      for (const target of progress.targets) {
        expect(target.selector.length).toBeGreaterThan(0);
      }
    }

    // Every step of the mission surfaced, in catalogue order.
    const order = catalogue.map((step) => step.id);
    const completed = flow.tutorial().completedStepIds;
    expect(completed.length).toBe(order.length);
    expect(completed).toEqual(order);
    expect(seen).toEqual(order);
    expect(flow.tutorial().complete).toBe(true);
  });

  it('keeps later missions locked until earlier missions are won', () => {
    const locked = createMissionFlow({ mission: 'parallel-lanes' });
    expect(locked.campaign().unlocked).toBe(false);
    expect(locked.campaign().lockedKeys).toContain('parallel-lanes');
    expect(locked.start()).toBeNull();
    expect(locked.phase).toBe('brief');

    // Win mission one, then hand its delivered key to the next mission.
    const first = createMissionFlow({
      mission: 'request-to-plan',
      agent: { failureChance: 0, rollbackChance: 0 },
    });
    expect(first.start()).not.toBeNull();
    expect(first.approve()).not.toBeNull();
    runToTerminal(first);
    expect(first.outcome).toBe('won');
    expect(first.campaign().deliveredKeys).toContain('request-to-plan');

    const second = createMissionFlow({
      mission: 'parallel-lanes',
      deliveredMissionKeys: first.campaign().deliveredKeys,
      agent: { failureChance: 0, rollbackChance: 0 },
    });
    expect(second.campaign().unlocked).toBe(true);
    expect(second.campaign().lockedKeys).toContain('delivery-manifest');
    expect(second.isUnlocked()).toBe(true);
    expect(second.start()).not.toBeNull();

    // The catalogue order is the unlock order.
    expect(first.campaign().nextKey).toBe('parallel-lanes');
    expect(first.campaign().missionCount).toBe(MISSIONS.length);
    expect(ALL_KEYS).toEqual(MISSIONS.map((mission) => mission.key));
  });
});

describe('mission flow: pacing', () => {
  it('makes 2x and 4x equal to repeated 1x frames and freezes while paused', () => {
    const at = (speed: 1 | 2 | 4, frames: number, frameMs: number) => {
      const flow = openFloor('parallel-lanes');
      flow.setSpeed(speed);
      let simulated = 0;
      for (let index = 0; index < frames; index += 1) {
        simulated += flow.advance(frameMs).steps;
      }
      return {
        steps: simulated,
        state: JSON.stringify(flow.snapshot().state),
        journal: flow.events().map((event) => JSON.stringify(event)).join('\n'),
        phase: flow.phase,
      };
    };

    const one = at(1, 4, 1_000);
    const two = at(2, 2, 2_000);
    const four = at(4, 1, 4_000);

    expect(one.steps).toBeGreaterThan(0);
    expect(two.steps).toBe(one.steps);
    expect(four.steps).toBe(one.steps);
    expect(two.state).toBe(one.state);
    expect(four.state).toBe(one.state);
    expect(two.journal).toBe(one.journal);
    expect(four.journal).toBe(one.journal);

    // Pause stops simulation advancement entirely.
    const flow = openFloor('delivery-manifest');
    flow.advance(1_000);
    const before = JSON.stringify(flow.snapshot().state);
    const revision = flow.snapshot().state.revision;
    expect(flow.pause()).toBe(true);
    const frame = flow.advance(10_000);
    expect(frame.steps).toBe(0);
    expect(frame.simulatedMs).toBe(0);
    expect(JSON.stringify(flow.snapshot().state)).toBe(before);
    expect(flow.snapshot().state.revision).toBe(revision);
    expect(flow.snapshot().simMs).toBeGreaterThan(0);

    expect(flow.resume()).toBe(false);
    expect(flow.advance(1_000).steps).toBeGreaterThan(0);
    expect(flow.togglePause()).toBe(true);
    expect(flow.togglePause()).toBe(false);
    expect(flow.setSpeed(4)).toBe(4);
    expect(flow.snapshot().speed).toBe(4);
  });

  it('replays a scripted input sequence into an identical state and event journal', () => {
    const script = (): { state: string; journal: string; phase: MissionPhase; outcome: string; log: string } => {
      const flow = createMissionFlow({
        mission: 'request-to-plan',
        deliveredMissionKeys: ALL_KEYS,
      });
      flow.start();
      flow.acknowledge();
      flow.approve();
      flow.setSpeed(2);
      for (let index = 0; index < 8; index += 1) flow.advance(200);
      const victim = flow.snapshot().plan[0]?.id ?? '';
      flow.forceCheckFailure(victim, { detail: 'scripted regression' });
      flow.pause();
      flow.advance(5_000);
      flow.resume();
      flow.setSpeed(1);
      for (let index = 0; index < 120; index += 1) flow.advance(200);
      return {
        state: JSON.stringify(flow.snapshot().state),
        journal: flow.events().map((event) => JSON.stringify(event)).join('\n'),
        phase: flow.phase,
        outcome: flow.outcome,
        log: flow.log().map((entry) => `${entry.atMs}|${entry.source}|${entry.provenance}|${entry.text}`).join('\n'),
      };
    };

    const first = script();
    const second = script();
    expect(second.state).toBe(first.state);
    expect(second.journal).toBe(first.journal);
    expect(second.log).toBe(first.log);
    expect(second.phase).toBe(first.phase);
    expect(second.outcome).toBe(first.outcome);
    expect(first.journal.length).toBeGreaterThan(0);
    expect(FLOW_STEP_MS).toBeGreaterThan(0);
  });
});

describe('mission flow: campaign integration', () => {
  it('plays every mission of the campaign to a win on the shipped balance', () => {
    const delivered: string[] = [];
    for (const mission of MISSIONS) {
      const flow = createMissionFlow({ mission: mission.key, deliveredMissionKeys: [...delivered] });
      expect(flow.start()).not.toBeNull();
      expect(flow.approve()).not.toBeNull();
      runToTerminal(flow, 12_000, 100);

      const snapshot = flow.snapshot();
      expect(snapshot.outcome, `${mission.key} should be winnable`).toBe('won');
      expect(snapshot.verdict.blockingObjectiveIds).toEqual([]);
      expect(snapshot.verification.readiness.ready).toBe(true);
      expect(snapshot.quality.ready).toBe(true);
      expect(snapshot.manifest.entries.length).toBeGreaterThanOrEqual(mission.pacing.planTasks - 4);
      expect(snapshot.readings.metrics?.['context-remaining-ratio'] ?? 0).toBeGreaterThan(0);
      delivered.push(mission.key);
    }
    expect(delivered).toEqual(ALL_KEYS);
  });

  it('drives every mission phase through the simulation modules', () => {
    const flow = openFloorWithDice('quality-graph');
    runToTerminal(flow);
    const snapshot = flow.snapshot();

    // Lanes came from the mission's own lane kinds and were opened by the scheduler.
    expect(snapshot.lanes.length).toBeGreaterThanOrEqual(3);
    for (const lane of snapshot.lanes) {
      expect(lane.laneId).toMatch(/^lane-[a-z]+$/);
      expect(lane.activeTaskId).toBeNull();
      expect(lane.open).toBe(false);
    }
    expect(snapshot.agents.activeAgents).toBe(0);
    expect(snapshot.agents.settledAgents).toBeGreaterThan(0);
    expect(snapshot.graph.phaseCount).toBeGreaterThanOrEqual(3);
    expect(snapshot.verification.gates).toBe(snapshot.verification.checksDeclared);
    expect(snapshot.verification.gatesPassed).toBeGreaterThan(0);
    expect(snapshot.verification.checksGreen).toBeGreaterThan(0);
    expect(snapshot.verification.readiness.ready).toBe(true);
    expect(snapshot.quality.measuredMetrics).toBeGreaterThanOrEqual(5);
    expect(snapshot.readings.metrics?.['checks-declared']).toBe(4);
    expect(snapshot.readings.metrics?.['ownership-coverage-ratio']).toBe(1);
    expect(snapshot.readings.metrics?.['conflicts-open']).toBe(0);
    expect(snapshot.readings.metrics?.['phases-complete']).toBe(snapshot.graph.phaseCount);
    expect(snapshot.state.mission.status).toBe('delivered');
    expect(snapshot.campaign.deliveredKeys).toContain('quality-graph');
    expect(snapshot.economy.credits).toBeGreaterThan(0);
    expect(flow.outcome).toBe('won');
  });
});
