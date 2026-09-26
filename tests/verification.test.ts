/**
 * Verification gates, repair objectives and criterion lifecycles.
 *
 * The simulation layer must stay headless: these tests drive
 * `src/sim/verification.ts` with explicit check outcomes (no command is ever
 * executed) over the real `GameState` contract and the deterministic sample
 * fixture.
 */

import { describe, expect, it } from 'vitest';

import { createSampleState } from '../src/sim/fixtures';
import {
  applyDomainEvents,
  createInitialState,
  makeDomainEvent,
  type DomainEvent,
  type GameState,
} from '../src/sim/state';
import {
  DEFAULT_CHECK_EVIDENCE,
  VERIFICATION_LANE_ID,
  collectEvidenceMismatches,
  createVerificationLedger,
  evaluateReleaseReadiness,
  promoteCriterion,
  registerChecks,
  resolveTaskGateStatuses,
  runVerificationGate,
  supersedeCriterion,
  type CheckDeclaration,
  type CheckOutcome,
  type CriterionDeclaration,
  type VerificationLedger,
} from '../src/sim/verification';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const TASK_CORE = 'task-core';
const TASK_GATE = 'task-gate';
const TASK_RELEASE = 'task-release';

const TYPECHECK_CHECK: CheckDeclaration = {
  id: 'chk-core-typecheck',
  taskId: TASK_CORE,
  kind: 'typecheck',
  assertion: 'src/sim/verification.ts and its test compile with no errors.',
  targetFile: 'src/sim/verification.ts',
  timeoutMs: 300_000,
};

const TEST_CHECK: CheckDeclaration = {
  id: 'chk-gate-test',
  taskId: TASK_GATE,
  kind: 'test',
  assertion: 'Verification gates, repair objectives and criterion lifecycles behave correctly.',
  targetFile: 'tests/verification.test.ts',
};

/** Three tasks in a chain: core -> gate -> release. */
function planEvents(): DomainEvent[] {
  return [
    makeDomainEvent('mission/started', {}, 0),
    makeDomainEvent(
      'lane/registered',
      { lane: { id: 'lane-verify', kind: 'verify', label: 'Verification', capacity: 2 } },
      10,
    ),
    makeDomainEvent(
      'plan/task-registered',
      { task: { id: TASK_CORE, title: 'Build the verification module', laneId: 'lane-build' } },
      20,
    ),
    makeDomainEvent(
      'plan/task-registered',
      {
        task: {
          id: TASK_GATE,
          title: 'Gate the dependents',
          laneId: 'lane-build',
          dependencies: [TASK_CORE],
        },
      },
      30,
    ),
    makeDomainEvent(
      'plan/task-registered',
      {
        task: {
          id: TASK_RELEASE,
          title: 'Ship the release',
          laneId: 'lane-integrate',
          dependencies: [TASK_GATE],
        },
      },
      40,
    ),
  ];
}

function gateState(): GameState {
  return applyDomainEvents(
    createInitialState({ seed: 11, missionId: 'mission-verification' }),
    planEvents(),
  );
}

const pass = (checkId: string, atMs?: number): CheckOutcome => ({ checkId, status: 'passed', atMs });
const fail = (checkId: string, detail?: string, atMs?: number): CheckOutcome => ({
  checkId,
  status: 'failed',
  detail,
  atMs,
});

function taskStatus(state: GameState, taskId: string): string | undefined {
  return state.plan.tasks[taskId]?.status;
}

/* -------------------------------------------------------------------------- */
/* Gating                                                                     */
/* -------------------------------------------------------------------------- */

describe('verification gate blocking', () => {
  it('keeps every dependent task blocked while an upstream check fails', () => {
    const state = gateState();
    const result = runVerificationGate(state, {
      checks: [TYPECHECK_CHECK, TEST_CHECK],
      outcomes: [fail(TYPECHECK_CHECK.id, 'TS2345: argument of type ...')],
    });

    expect(result.report.tasks.map((task) => [task.taskId, task.status])).toEqual([
      [TASK_CORE, 'failed'],
      [TASK_GATE, 'blocked'],
    ]);
    expect(result.blockedTaskIds).toEqual([TASK_GATE, TASK_RELEASE]);
    expect(result.dispatchableTaskIds).toEqual([]);
    expect(result.report.tasks[1]?.blockedBy).toEqual([TASK_CORE]);
    expect(resolveTaskGateStatuses(state, result.ledger)).toEqual({
      [TASK_CORE]: 'failed',
      [TASK_GATE]: 'blocked',
      [TASK_RELEASE]: 'blocked',
    });

    // The failure reaches the shared slices through ordinary domain events.
    expect(result.state.plan.tasks[TASK_GATE]?.status).toBe('blocked');
    expect(result.state.plan.tasks[TASK_RELEASE]?.status).toBe('blocked');
    expect(result.state.verification.gates[TYPECHECK_CHECK.id]?.status).toBe('failed');
    expect(result.state.verification.gates[TYPECHECK_CHECK.id]?.laneId).toBe(VERIFICATION_LANE_ID);
    expect(result.state.verification.gates[TYPECHECK_CHECK.id]?.coverage).toBe(0);
    expect(result.events.map((event) => event.type)).toContain('plan/task-updated');
    expect(
      result.events.some(
        (event) => event.type === 'verification/run' && event.gateId === TYPECHECK_CHECK.id,
      ),
    ).toBe(true);
  });

  it('releases dependents once the failing check passes', () => {
    const failing = runVerificationGate(gateState(), {
      checks: [TYPECHECK_CHECK, TEST_CHECK],
      outcomes: [fail(TYPECHECK_CHECK.id, 'TS2345')],
    });

    const repaired = runVerificationGate(failing.state, {
      ledger: failing.ledger,
      outcomes: [pass(TYPECHECK_CHECK.id)],
    });

    expect(repaired.blockedTaskIds).toEqual([]);
    expect(repaired.dispatchableTaskIds).toEqual([TASK_GATE]);
    expect(taskStatus(repaired.state, TASK_CORE)).toBe('passed');
    expect(taskStatus(repaired.state, TASK_GATE)).toBe('pending');
    expect(repaired.state.verification.gates[TYPECHECK_CHECK.id]?.status).toBe('passed');
    expect(repaired.state.verification.gates[TYPECHECK_CHECK.id]?.coverage).toBe(1);

    const shipped = runVerificationGate(repaired.state, {
      ledger: repaired.ledger,
      outcomes: [pass(TEST_CHECK.id)],
    });

    expect(shipped.blockedTaskIds).toEqual([]);
    expect(shipped.dispatchableTaskIds).toEqual([TASK_RELEASE]);
    expect(taskStatus(shipped.state, TASK_GATE)).toBe('passed');
  });

  it('reads the real sample fixture plan and records gate runs into the verification slice', () => {
    const state = createSampleState(20260917);
    const check: CheckDeclaration = {
      id: 'chk-comets-build',
      taskId: 'task-lane-comets',
      kind: 'build',
      assertion: 'The lane comet system compiles.',
      targetFile: 'src/render/laneAgents.ts',
    };

    const failing = runVerificationGate(state, {
      checks: [check],
      outcomes: [fail(check.id, 'TS2304: cannot find name', 95_000)],
    });

    expect(failing.blockedTaskIds).toContain('task-constellation');
    expect(failing.blockedTaskIds).toContain('task-review');
    expect(failing.state.plan.tasks['task-constellation']?.status).toBe('blocked');
    expect(failing.state.verification.gates[check.id]?.status).toBe('failed');
    expect(failing.state.verification.passRate).toBeLessThan(state.verification.passRate);

    const repaired = runVerificationGate(failing.state, {
      ledger: failing.ledger,
      checks: [check],
      outcomes: [pass(check.id, 96_000)],
    });

    expect(repaired.blockedTaskIds).toEqual([]);
    expect(repaired.dispatchableTaskIds).toContain('task-constellation');
    expect(taskStatus(repaired.state, 'task-lane-comets')).toBe('passed');
    expect(repaired.state.plan.tasks['task-constellation']?.status).not.toBe('blocked');
    expect(repaired.state.verification.gates[check.id]?.status).toBe('passed');
    expect(repaired.state.verification.gates[check.id]?.attempts).toBe(2);
    expect(repaired.state.verification.passRate).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Repair objectives                                                          */
/* -------------------------------------------------------------------------- */

describe('repair objectives', () => {
  it('opens exactly one objective per failing check, citing the check id and target file', () => {
    const result = runVerificationGate(gateState(), {
      checks: [TYPECHECK_CHECK, TEST_CHECK],
      outcomes: [
        fail(TYPECHECK_CHECK.id, 'TS2345', 120),
        fail(TEST_CHECK.id, '1 test failed', 130),
      ],
    });

    expect(result.ledger.repairOrder).toEqual([TYPECHECK_CHECK.id, TEST_CHECK.id]);
    expect(result.report.totals.openRepairs).toBe(2);

    const objective = result.ledger.repairs[TYPECHECK_CHECK.id];
    expect(objective?.id).toBe(`repair-${TYPECHECK_CHECK.id}`);
    expect(objective?.checkId).toBe(TYPECHECK_CHECK.id);
    expect(objective?.taskId).toBe(TASK_CORE);
    expect(objective?.targetFile).toBe('src/sim/verification.ts');
    expect(objective?.assertion).toContain('compile with no errors');
    expect(objective?.status).toBe('open');
    expect(objective?.openedAtMs).toBe(120);
    expect(objective?.closedAtMs).toBeNull();
    expect(result.report.tasks[0]?.openRepairCheckIds).toEqual([TYPECHECK_CHECK.id]);

    // Re-evaluating the same failing outcomes must not duplicate anything.
    const again = runVerificationGate(result.state, {
      ledger: result.ledger,
      checks: [TYPECHECK_CHECK, TEST_CHECK],
      outcomes: [
        fail(TYPECHECK_CHECK.id, 'TS2345', 120),
        fail(TEST_CHECK.id, '1 test failed', 130),
      ],
    });

    expect(again.ledger.repairOrder).toEqual([TYPECHECK_CHECK.id, TEST_CHECK.id]);
    expect(Object.keys(again.ledger.repairs)).toEqual([TYPECHECK_CHECK.id, TEST_CHECK.id]);
    expect(again.ledger.repairs[TYPECHECK_CHECK.id]?.openedAtMs).toBe(120);
    expect(again.ledger.repairs[TYPECHECK_CHECK.id]?.status).toBe('open');
  });

  it('closes an objective only when that same check passes', () => {
    const failing = runVerificationGate(gateState(), {
      checks: [TYPECHECK_CHECK, TEST_CHECK],
      outcomes: [fail(TYPECHECK_CHECK.id), fail(TEST_CHECK.id)],
    });
    expect(failing.report.totals.openRepairs).toBe(2);

    const partial = runVerificationGate(failing.state, {
      ledger: failing.ledger,
      outcomes: [fail(TYPECHECK_CHECK.id), pass(TEST_CHECK.id, 400)],
    });

    expect(partial.ledger.repairs[TEST_CHECK.id]?.status).toBe('closed');
    expect(partial.ledger.repairs[TEST_CHECK.id]?.closedAtMs).toBe(400);
    expect(partial.ledger.repairs[TYPECHECK_CHECK.id]?.status).toBe('open');
    expect(partial.ledger.repairs[TYPECHECK_CHECK.id]?.closedAtMs).toBeNull();

    const repaired = runVerificationGate(partial.state, {
      ledger: partial.ledger,
      outcomes: [pass(TYPECHECK_CHECK.id, 500)],
    });

    expect(repaired.ledger.repairs[TYPECHECK_CHECK.id]?.status).toBe('closed');
    expect(repaired.ledger.repairs[TYPECHECK_CHECK.id]?.closedAtMs).toBe(500);
    expect(repaired.report.totals.openRepairs).toBe(0);
    expect(repaired.report.totals.closedRepairs).toBe(2);
    expect(repaired.blockedTaskIds).toEqual([]);
  });

  it('reopens the same objective when a repaired check regresses', () => {
    const first = runVerificationGate(gateState(), {
      checks: [TEST_CHECK],
      outcomes: [fail(TEST_CHECK.id)],
    });
    const closed = runVerificationGate(first.state, {
      ledger: first.ledger,
      outcomes: [pass(TEST_CHECK.id)],
    });
    const regressed = runVerificationGate(closed.state, {
      ledger: closed.ledger,
      outcomes: [fail(TEST_CHECK.id, 'flaky suite')],
    });

    expect(regressed.ledger.repairs[TEST_CHECK.id]?.status).toBe('open');
    expect(regressed.ledger.repairs[TEST_CHECK.id]?.closedAtMs).toBeNull();
    expect(regressed.ledger.repairOrder.filter((id) => id === TEST_CHECK.id)).toEqual([
      TEST_CHECK.id,
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Evidence rules                                                             */
/* -------------------------------------------------------------------------- */

describe('check-kind evidence rules', () => {
  const visualCriterion: CriterionDeclaration = {
    key: 'criterion-boot-visible',
    taskId: TASK_GATE,
    label: 'The boot sequence is visible in the browser.',
    requiredEvidence: 'visual',
  };

  it('defaults command-style checks to command evidence', () => {
    const ledger = registerChecks(createVerificationLedger(), [TYPECHECK_CHECK, TEST_CHECK]);
    expect(DEFAULT_CHECK_EVIDENCE.test).toBe('command');
    expect(ledger.checks[TYPECHECK_CHECK.id]?.evidence).toBe('command');
    expect(ledger.checks[TEST_CHECK.id]?.evidence).toBe('command');
  });

  it('rejects a command-only check as evidence for a visual criterion and reports the mismatch', () => {
    const commandCheck: CheckDeclaration = {
      id: 'chk-boot-smoke',
      taskId: TASK_GATE,
      kind: 'test',
      assertion: 'Boot smoke test exits 0.',
      targetFile: 'tests/boot.test.ts',
      criterionKey: visualCriterion.key,
    };

    const result = runVerificationGate(gateState(), {
      checks: [commandCheck],
      criteria: [visualCriterion],
      outcomes: [pass(commandCheck.id)],
    });

    const mismatch = result.report.evidenceMismatches.find(
      (candidate) => candidate.checkId === commandCheck.id,
    );
    expect(mismatch?.code).toBe('command-only-evidence');
    expect(mismatch?.required).toBe('visual');
    expect(mismatch?.provided).toBe('command');
    expect(mismatch?.message).toContain('command-only');
    expect(collectEvidenceMismatches(result.ledger)).toEqual(result.report.evidenceMismatches);
    expect(result.report.totals.evidenceMismatches).toBe(1);
    expect(result.report.logLines.some((line) => line.includes('[evidence]'))).toBe(true);

    // A passing command check cannot close the visual criterion.
    const promoted = promoteCriterion(result.ledger, visualCriterion.key);
    expect(promoted.ok).toBe(true);
    const readiness = evaluateReleaseReadiness(promoted.ledger);
    expect(readiness.unmetKeys).toEqual([visualCriterion.key]);
    expect(readiness.ready).toBe(false);
  });

  it('accepts browser-grade composition evidence for the same criterion', () => {
    const commandCheck: CheckDeclaration = {
      id: 'chk-boot-smoke',
      taskId: TASK_GATE,
      kind: 'test',
      assertion: 'Boot smoke test exits 0.',
      targetFile: 'tests/boot.test.ts',
      criterionKey: visualCriterion.key,
    };
    const compositionCheck: CheckDeclaration = {
      id: 'chk-boot-composition',
      taskId: TASK_GATE,
      kind: 'composition',
      assertion: 'Compose the runtime and screenshot the boot frame.',
      targetFile: 'dev-preview/harness.ts',
      evidence: 'screenshot',
      criterionKey: visualCriterion.key,
    };

    const first = runVerificationGate(gateState(), {
      checks: [commandCheck],
      criteria: [visualCriterion],
      outcomes: [pass(commandCheck.id)],
    });
    const promoted = promoteCriterion(first.ledger, visualCriterion.key).ledger;

    const composed = runVerificationGate(first.state, {
      ledger: promoted,
      checks: [compositionCheck],
      criteria: [visualCriterion],
      outcomes: [pass(compositionCheck.id)],
    });

    expect(
      composed.report.evidenceMismatches.some(
        (mismatch) => mismatch.checkId === compositionCheck.id,
      ),
    ).toBe(false);
    expect(composed.ledger.criteria[visualCriterion.key]?.satisfiedByCheckIds).toEqual([
      compositionCheck.id,
    ]);
    expect(evaluateReleaseReadiness(composed.ledger).ready).toBe(true);
    expect(evaluateReleaseReadiness(composed.ledger).satisfiedKeys).toEqual([visualCriterion.key]);
  });

  it('rejects evidence a check kind is not allowed to claim', () => {
    const bogus: CheckDeclaration = {
      id: 'chk-bogus-browser-test',
      taskId: TASK_GATE,
      kind: 'test',
      assertion: 'Unit test claims browser evidence.',
      targetFile: 'tests/verification.test.ts',
      evidence: 'browser',
      criterionKey: visualCriterion.key,
    };

    const result = runVerificationGate(gateState(), {
      checks: [bogus],
      criteria: [visualCriterion],
      outcomes: [pass(bogus.id)],
    });

    expect(result.report.evidenceMismatches.map((mismatch) => mismatch.code)).toEqual([
      'check-kind-evidence',
      'insufficient-evidence',
    ]);
    // Even the weaker browser claim is disallowed for a unit test, so the visual
    // criterion stays unmet.
    const promoted = promoteCriterion(result.ledger, visualCriterion.key).ledger;
    expect(evaluateReleaseReadiness(promoted).unmetKeys).toEqual([visualCriterion.key]);
  });

  it('reports outcomes handed in for checks that were never declared', () => {
    const result = runVerificationGate(gateState(), {
      checks: [TYPECHECK_CHECK],
      outcomes: [pass('chk-not-declared')],
    });

    expect(result.report.unmatchedOutcomeIds).toEqual(['chk-not-declared']);
    expect(result.ledger.repairs).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* Criterion lifecycles                                                       */
/* -------------------------------------------------------------------------- */

describe('criterion lifecycles', () => {
  const criteria: CriterionDeclaration[] = [
    {
      key: 'criterion-mission-3',
      taskId: TASK_CORE,
      label: 'Mission 3 verification gate is green.',
      requiredEvidence: 'command',
    },
    {
      key: 'criterion-mission-4',
      taskId: TASK_CORE,
      label: 'Mission 4 verification gate is green.',
      requiredEvidence: 'command',
    },
    {
      key: 'criterion-elsewhere',
      taskId: TASK_GATE,
      label: 'Belongs to another task.',
      requiredEvidence: 'command',
    },
  ];

  function baseLedger(): VerificationLedger {
    return runVerificationGate(gateState(), { criteria }).ledger;
  }

  it('starts criteria as milestones and promotes them to final invariants', () => {
    const ledger = baseLedger();
    expect(ledger.criteria['criterion-mission-3']?.lifecycle).toBe('milestone');
    expect(evaluateReleaseReadiness(ledger).finalInvariantKeys).toEqual([]);
    expect(evaluateReleaseReadiness(ledger).ready).toBe(false);

    const promoted = promoteCriterion(ledger, 'criterion-mission-3');
    expect(promoted.ok).toBe(true);
    expect(promoted.criterion?.lifecycle).toBe('final_invariant');
    expect(promoted.ledger.criteria['criterion-mission-3']?.lifecycle).toBe('final_invariant');
    // The input ledger is untouched.
    expect(ledger.criteria['criterion-mission-3']?.lifecycle).toBe('milestone');

    expect(promoteCriterion(promoted.ledger, 'criterion-mission-3').ok).toBe(false);
    expect(promoteCriterion(ledger, 'criterion-not-registered').ok).toBe(false);
  });

  it('requires a replacement key inside the same task before superseding', () => {
    const promoted = promoteCriterion(baseLedger(), 'criterion-mission-3');

    const missing = supersedeCriterion(
      promoted.ledger,
      'criterion-mission-3',
      'criterion-not-registered',
    );
    expect(missing.ok).toBe(false);
    expect(missing.errors[0]).toContain('criterion-not-registered');
    expect(promoted.ledger.criteria['criterion-mission-3']?.lifecycle).toBe('final_invariant');

    const crossTask = supersedeCriterion(
      promoted.ledger,
      'criterion-mission-3',
      'criterion-elsewhere',
    );
    expect(crossTask.ok).toBe(false);
    expect(crossTask.errors[0]).toContain(TASK_CORE);

    const selfSupersede = supersedeCriterion(
      promoted.ledger,
      'criterion-mission-3',
      'criterion-mission-3',
    );
    expect(selfSupersede.ok).toBe(false);

    const superseded = supersedeCriterion(
      promoted.ledger,
      'criterion-mission-3',
      'criterion-mission-4',
    );
    expect(superseded.ok).toBe(true);
    expect(superseded.criterion?.lifecycle).toBe('superseded');
    expect(superseded.criterion?.replacedBy).toBe('criterion-mission-4');

    const readiness = evaluateReleaseReadiness(superseded.ledger);
    expect(readiness.supersededKeys).toEqual(['criterion-mission-3']);
    expect(readiness.finalInvariantKeys).toEqual([]);
    expect(readiness.ready).toBe(false);
    expect(
      promoteCriterion(superseded.ledger, 'criterion-mission-3').errors[0],
    ).toContain('superseded');
  });

  it('counts only satisfied final invariants toward release', () => {
    const promoted = promoteCriterion(baseLedger(), 'criterion-mission-3').ledger;
    const superseded = supersedeCriterion(
      promoted,
      'criterion-mission-3',
      'criterion-mission-4',
    ).ledger;

    const commandCheck: CheckDeclaration = {
      id: 'chk-release-command',
      taskId: TASK_CORE,
      kind: 'build',
      assertion: 'The verification module builds for release.',
      targetFile: 'src/sim/verification.ts',
      criterionKey: 'criterion-mission-4',
    };

    // Milestones never count, even when they are satisfied.
    const run = runVerificationGate(gateState(), {
      ledger: superseded,
      criteria,
      checks: [commandCheck],
      outcomes: [pass(commandCheck.id)],
    });
    const milestoneReadiness = evaluateReleaseReadiness(run.ledger);
    expect(milestoneReadiness.finalInvariantKeys).toEqual([]);
    expect(milestoneReadiness.ready).toBe(false);
    expect(run.ledger.criteria['criterion-mission-4']?.satisfiedByCheckIds).toEqual([
      commandCheck.id,
    ]);

    const releaseLedger = promoteCriterion(run.ledger, 'criterion-mission-4').ledger;
    const release = evaluateReleaseReadiness(releaseLedger);
    expect(release.finalInvariantKeys).toEqual(['criterion-mission-4']);
    expect(release.satisfiedKeys).toEqual(['criterion-mission-4']);
    expect(release.unmetKeys).toEqual([]);
    expect(release.ready).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Report and determinism                                                     */
/* -------------------------------------------------------------------------- */

describe('verification report', () => {
  it('summarises passed, failed and pending checks with assertions and targets', () => {
    const result = runVerificationGate(gateState(), {
      checks: [TYPECHECK_CHECK, TEST_CHECK],
      outcomes: [fail(TYPECHECK_CHECK.id, 'TS2345: argument of type ...', 300)],
      atMs: 12_345,
    });

    expect(result.report.atMs).toBe(12_345);
    expect(result.report.tasks).toHaveLength(2);

    const first = result.report.tasks[0];
    expect(first?.taskId).toBe(TASK_CORE);
    expect(first?.title).toBe('Build the verification module');
    expect(first?.passed).toEqual([]);
    expect(first?.failed[0]).toMatchObject({
      checkId: TYPECHECK_CHECK.id,
      taskId: TASK_CORE,
      kind: 'typecheck',
      assertion: TYPECHECK_CHECK.assertion,
      targetFile: 'src/sim/verification.ts',
      evidence: 'command',
      timeoutMs: 300_000,
      status: 'failed',
      detail: 'TS2345: argument of type ...',
    });

    const second = result.report.tasks[1];
    expect(second?.taskId).toBe(TASK_GATE);
    expect(second?.pending[0]?.checkId).toBe(TEST_CHECK.id);
    expect(second?.status).toBe('blocked');

    expect(result.report.totals).toEqual({
      checks: 2,
      passed: 0,
      failed: 1,
      pending: 1,
      openRepairs: 1,
      closedRepairs: 0,
      evidenceMismatches: 0,
    });
    expect(result.report.repairObjectives).toHaveLength(1);
    expect(result.report.blockedTaskIds).toEqual([TASK_GATE, TASK_RELEASE]);
    expect(result.report.summary).toContain('1 failed');
    expect(result.report.summary).toContain('1 open repair objective');
    expect(result.report.logLines.some((line) => line.includes(TYPECHECK_CHECK.id))).toBe(true);
    expect(
      result.report.logLines.some((line) => line.includes('src/sim/verification.ts')),
    ).toBe(true);
  });

  it('is deterministic and idempotent for an unchanged check set', () => {
    const checks = [TYPECHECK_CHECK, TEST_CHECK];
    const outcomes = [fail(TYPECHECK_CHECK.id, 'TS2345', 900)];
    // Same induced gate-run time for every evaluation: the simulated clock is
    // not part of the check set, so it must not leak into the comparison.
    const atMs = 900;

    const first = runVerificationGate(gateState(), { checks, outcomes, atMs });
    const second = runVerificationGate(gateState(), { checks, outcomes, atMs });

    expect(second.report).toEqual(first.report);
    expect(second.state).toEqual(first.state);
    expect(second.ledger).toEqual(first.ledger);
    expect(first.ledger.repairOrder).toHaveLength(1);

    // Replaying the identical evaluation against the already-updated state is a
    // no-op: same report, same state, no extra events, no duplicate objective.
    const replay = runVerificationGate(first.state, {
      ledger: first.ledger,
      checks,
      outcomes,
      atMs,
    });

    expect(replay.report).toEqual(first.report);
    expect(replay.state).toEqual(first.state);
    expect(replay.ledger).toEqual(first.ledger);
    expect(replay.events).toEqual([]);
    expect(replay.ledger.repairOrder).toHaveLength(1);
  });

  it('keeps the first declaration for a check id', () => {
    const ledger = registerChecks(createVerificationLedger(), [TYPECHECK_CHECK]);
    const again = registerChecks(ledger, [
      { ...TYPECHECK_CHECK, targetFile: 'somewhere/else.ts' },
    ]);

    expect(again).toBe(ledger);
    expect(again.checks[TYPECHECK_CHECK.id]?.targetFile).toBe('src/sim/verification.ts');
  });
});
