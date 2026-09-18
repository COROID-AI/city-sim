/**
 * Mission planner: request → governed, dependency-layered task outline.
 *
 * Every case here runs over the *shared* foundation contracts: `createSampleState`
 * supplies the mission request (identity, codename, objective) and the runtime
 * state the outline is registered into, and the plan is reduced through the same
 * domain events the game uses. Nothing is hand-written mission content.
 *
 * The planner owns a policy that the dependency graph enforces at runtime
 * (no same-phase dependency, no shared write path inside a phase). Rather than
 * importing the graph module — the planner is verified as a pure function of
 * request, seed and catalogue — the layering and ownership rules are re-derived
 * here from the outline itself, mirroring the graph's normalisation (separators,
 * `./` prefixes, repeated slashes and trailing-slash directory claims).
 */

import { describe, expect, it } from 'vitest';

import { SAMPLE_MISSION_ID, SAMPLE_SEED, createSampleState } from '../src/sim/fixtures';
import { createInitialState, listTasks } from '../src/sim/state';
import {
  DEFAULT_DIFFICULTY_LEVEL,
  DIFFICULTY_LADDER,
  MAX_DIFFICULTY_LEVEL,
  MISSION_WORKSTREAMS,
  PHASE_BLUEPRINTS,
  applyPlanOutline,
  generatePlan,
  missionRequestFromState,
  missionRequestVariants,
  normalizeRequest,
  planOutlineEvents,
  resolveDifficulty,
  slugifyMissionId,
  type PlanCriterionLifecycle,
  type SourceClaimAuthority,
} from '../src/sim/planner';

/* -------------------------------------------------------------------------- */
/* Independent re-derivations of the rules                                 */
/* -------------------------------------------------------------------------- */

/** Ownership path normalisation, mirroring the graph module's comparison rules. */
function normalizePath(path: string): string {
  let normalized = path.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  return normalized;
}

/** Two ownership entries collide when equal, or when a directory claim contains the other. */
function writesOverlap(left: string, right: string): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  if (a === b) return true;
  if (a.endsWith('/') && b.startsWith(a)) return true;
  if (b.endsWith('/') && a.startsWith(b)) return true;
  return false;
}

function sharedWritePaths(left: readonly string[], right: readonly string[]): string[] {
  const shared: string[] = [];
  for (const a of left) {
    for (const b of right) {
      if (!writesOverlap(a, b)) continue;
      if (!shared.includes(a)) shared.push(a);
      if (!shared.includes(b)) shared.push(b);
    }
  }
  return shared;
}

/**
 * Longest-path layering (Kahn in plan order) — an independent re-derivation of
 * the rule the graph module applies, so the assertions do not depend on it.
 */
function computePhases(outline: ReturnType<typeof generatePlan>): Map<string, number> {
  const ids = outline.order;
  const edges = new Map<string, string[]>();
  for (const task of outline.tasks) {
    edges.set(
      task.id,
      task.dependsOn.filter((dependency) => dependency !== task.id && ids.includes(dependency)),
    );
  }

  const indegree = new Map<string, number>(ids.map((id) => [id, (edges.get(id) ?? []).length]));
  const dependents = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const id of ids) {
    for (const dependency of edges.get(id) ?? []) dependents.get(dependency)?.push(id);
  }

  const queue = ids.filter((id) => indegree.get(id) === 0);
  const phaseOf = new Map<string, number>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    let phase = 0;
    for (const dependency of edges.get(id) ?? []) {
      const upstreamPhase = phaseOf.get(dependency);
      if (upstreamPhase !== undefined && upstreamPhase + 1 > phase) phase = upstreamPhase + 1;
    }
    phaseOf.set(id, phase);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }
  return phaseOf;
}

/** Group task keys by an externally computed phase index. */
function groupByPhase(outline: ReturnType<typeof generatePlan>, phaseOf: ReadonlyMap<string, number>): string[][] {
  const groups: string[][] = [];
  for (const task of outline.tasks) {
    const phase = phaseOf.get(task.id);
    if (phase === undefined) continue;
    const bucket = groups[phase] ?? (groups[phase] = []);
    bucket.push(task.id);
  }
  return groups;
}

/** No phase may contain two tasks whose write sets collide. */
function expectPhasesDisjoint(outline: ReturnType<typeof generatePlan>, groups: readonly (readonly string[])[]): void {
  const byId = new Map(outline.tasks.map((task) => [task.id, task]));
  groups.forEach((group, phase) => {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = byId.get(group[i] ?? '');
        const right = byId.get(group[j] ?? '');
        if (!left || !right) continue;
        expect(sharedWritePaths(left.writeSet, right.writeSet), `phase ${phase}: ${left.id} vs ${right.id}`).toEqual([]);
      }
    }
  });
}

/** Relative strength of evidence kinds: stronger evidence satisfies a weaker requirement. */
const EVIDENCE_STRENGTH: Record<string, number> = { command: 0, browser: 1, visual: 2, screenshot: 3 };

const CRITERION_LIFECYCLES: readonly PlanCriterionLifecycle[] = ['milestone', 'final_invariant', 'superseded'];
const CLAIM_AUTHORITIES: readonly SourceClaimAuthority[] = ['user_requirement', 'repository_evidence', 'architect_choice'];
const CHECK_KINDS: readonly string[] = ['build', 'typecheck', 'test', 'composition'];
const EVIDENCE_KINDS: readonly string[] = ['command', 'browser', 'visual', 'screenshot'];

/** Every (difficulty, seed) pair the structural invariants are exercised over. */
const MATRIX: readonly { level: number; seed: number }[] = DIFFICULTY_LADDER.flatMap((step) =>
  [SAMPLE_SEED, 7, 4242].map((seed) => ({ level: step.level, seed })),
);

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

describe('mission requests', () => {
  it('derives the request from the shared fixture state', () => {
    const state = createSampleState();
    const request = missionRequestFromState(state);

    expect(request.missionId).toBe(SAMPLE_MISSION_ID);
    expect(request.codename).toBe(state.mission.codename);
    expect(request.objective).toBe(state.mission.objective);
    expect(request.difficulty).toBe(DEFAULT_DIFFICULTY_LEVEL);

    // Difficulty is clamped to the authored ladder rather than trusted.
    expect(resolveDifficulty(99)).toBe(MAX_DIFFICULTY_LEVEL);
    expect(resolveDifficulty(-3)).toBe(1);
    expect(resolveDifficulty(Number.NaN)).toBe(DEFAULT_DIFFICULTY_LEVEL);
    expect(missionRequestFromState(state, 0).difficulty).toBe(1);
    expect(missionRequestFromState(state, 1.9).difficulty).toBe(1);
  });

  it('falls back to the shared defaults instead of producing empty identifiers', () => {
    const blank = normalizeRequest({ missionId: '  ', objective: '  ', codename: '' });

    expect(blank.missionId).toBe('mission-coroid');
    expect(blank.codename).toBe('COROID');
    expect(blank.objective.length).toBeGreaterThan(0);
    expect(slugifyMissionId(blank.missionId)).toBe('coroid');
    expect(slugifyMissionId('mission-coroid-holographic-factory')).toBe('coroid-holographic-factory');
  });

  it('offers the whole difficulty ladder for one fixture state', () => {
    const variants = missionRequestVariants(createSampleState());

    expect(variants).toHaveLength(DIFFICULTY_LADDER.length);
    expect(variants.map((variant) => variant.difficulty)).toEqual(DIFFICULTY_LADDER.map((step) => step.level));
    for (const variant of variants) {
      expect(variant.missionId).toBe(SAMPLE_MISSION_ID);
      expect(variant.objective).toBe(createSampleState().mission.objective);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Determinism                                                                */
/* -------------------------------------------------------------------------- */

describe('determinism', () => {
  it('produces an identical outline for the same mission id and seed', () => {
    const state = createSampleState();
    const request = missionRequestFromState(state, 3);

    const first = generatePlan(request, SAMPLE_SEED);
    const second = generatePlan(request, SAMPLE_SEED);

    expect(second).toEqual(first);
    expect(planOutlineEvents(second)).toEqual(planOutlineEvents(first));
    expect(first.events).toEqual(planOutlineEvents(first));

    // Phases, task keys, dependency keys and write sets are all stable.
    expect(second.phases.map((phase) => phase.taskKeys)).toEqual(first.phases.map((phase) => phase.taskKeys));
    expect(second.tasks.map((task) => task.dependsOn)).toEqual(first.tasks.map((task) => task.dependsOn));
    expect(second.tasks.map((task) => task.writeSet)).toEqual(first.tasks.map((task) => task.writeSet));
    expect(second.tasks.map((task) => task.readSet)).toEqual(first.tasks.map((task) => task.readSet));
  });

  it('plans a fixture state exactly like the request derived from it', () => {
    const state = createSampleState();

    const fromState = generatePlan(state);
    const fromRequest = generatePlan(missionRequestFromState(state), state.seed);

    expect(fromState).toEqual(fromRequest);
    expect(fromState.seed).toBe(state.seed);
    expect(fromState.missionId).toBe(state.mission.id);
  });

  it('keeps the outline shape when only the seed changes', () => {
    const request = missionRequestFromState(createSampleState(), 3);

    const first = generatePlan(request, 11);
    const second = generatePlan(request, 12);

    expect(second.summary.taskCount).toBe(first.summary.taskCount);
    expect(second.summary.phaseCount).toBe(first.summary.phaseCount);
    expect(second.summary.maxParallelTasks).toBe(first.summary.maxParallelTasks);
    expect(generatePlan(request, 11)).toEqual(first);

    // The seed decides *which* optional workstreams join a phase, so across a scan
    // of seeds the chosen content must actually vary — otherwise the RNG is inert
    // and "seeded planning" would be decoration.
    const keySets = new Set(
      Array.from({ length: 8 }, (_, index) => generatePlan(request, index + 1).order.join('|')),
    );
    expect(keySets.size).toBeGreaterThan(1);
  });

  it('emits a deterministic plan/task-registered script', () => {
    const request = missionRequestFromState(createSampleState(), 2);
    const outline = generatePlan(request, SAMPLE_SEED);
    const events = outline.events;

    expect(events).toHaveLength(outline.tasks.length);
    events.forEach((event, index) => {
      expect(event.type).toBe('plan/task-registered');
      const payload = event.type === 'plan/task-registered' ? event.task : null;
      expect(payload).not.toBeNull();
      expect(payload?.id).toBe(outline.order[index]);
      expect(payload?.title).toBe(outline.tasks[index]?.title);
      expect(payload?.laneId).toBe(outline.tasks[index]?.laneId);
      expect(payload?.dependencies).toEqual(outline.tasks[index]?.dependsOn);
      if (index > 0) expect(event.at).toBeGreaterThan(events[index - 1]?.at ?? 0);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Task metadata                                                              */
/* -------------------------------------------------------------------------- */

describe('task metadata', () => {
  it('attaches readSet, writeSet, checks, criteria and source claims to every task', () => {
    const state = createSampleState();
    const outline = generatePlan(missionRequestFromState(state, 4), SAMPLE_SEED);
    const checkIds = new Set<string>();

    expect(outline.tasks.length).toBeGreaterThan(0);
    for (const task of outline.tasks) {
      expect(task.readSet.length, `${task.id} readSet`).toBeGreaterThan(0);
      expect(task.writeSet.length, `${task.id} writeSet`).toBeGreaterThan(0);
      expect(task.checks.length, `${task.id} checks`).toBeGreaterThan(0);
      expect(task.criteria.length, `${task.id} criteria`).toBeGreaterThan(0);
      expect(task.sourceClaims.length, `${task.id} claims`).toBeGreaterThan(0);
      expect(task.readSet.every((path) => path !== '' && normalizePath(path) === path)).toBe(true);
      expect(task.writeSet.every((path) => path !== '' && normalizePath(path) === path)).toBe(true);
      expect(task.estimateCredits).toBeGreaterThan(0);
      expect(task.estimateContextTokens).toBeGreaterThan(0);

      const criterionKeys = new Set(task.criteria.map((criterion) => criterion.key));
      for (const criterion of task.criteria) {
        expect(criterion.taskId).toBe(task.id);
        expect(criterion.key.startsWith(task.id)).toBe(true);
        expect(criterion.label.trim().length).toBeGreaterThan(0);
        expect(CRITERION_LIFECYCLES).toContain(criterion.lifecycle);
        expect(EVIDENCE_KINDS).toContain(criterion.requiredEvidence);
        // Every criterion ships with a check that can actually satisfy it.
        expect(task.checks.some((check) => check.criterionKey === criterion.key)).toBe(true);
      }

      for (const claim of task.sourceClaims) {
        expect(CLAIM_AUTHORITIES).toContain(claim.authority);
        expect(claim.statement.trim().length).toBeGreaterThan(0);
      }

      for (const check of task.checks) {
        expect(check.taskId).toBe(task.id);
        expect(checkIds.has(check.id), `duplicate check id ${check.id}`).toBe(false);
        checkIds.add(check.id);
        expect(CHECK_KINDS).toContain(check.kind);
        expect(EVIDENCE_KINDS).toContain(check.evidence);
        expect(task.writeSet).toContain(check.targetFile);
        expect(check.timeoutMs).toBeGreaterThan(0);
        expect(criterionKeys.has(check.criterionKey), `${check.id} cites ${check.criterionKey}`).toBe(true);
        if (check.kind !== 'composition') expect(check.evidence).toBe('command');

        const criterion = task.criteria.find((entry) => entry.key === check.criterionKey);
        expect(criterion).toBeDefined();
        expect(EVIDENCE_STRENGTH[check.evidence] ?? -1).toBeGreaterThanOrEqual(
          EVIDENCE_STRENGTH[criterion?.requiredEvidence ?? ''] ?? -1,
        );
      }
    }

    // The framing task carries the player's own words, and release work carries invariants.
    const framing = outline.tasks.find((task) => task.phase === 0);
    expect(framing?.sourceClaims.some((claim) => claim.authority === 'user_requirement')).toBe(true);
    expect(
      framing?.sourceClaims.some(
        (claim) => claim.authority === 'user_requirement' && claim.statement.includes(state.mission.objective),
      ),
    ).toBe(true);
    expect(outline.claims.some((claim) => claim.authority === 'user_requirement')).toBe(true);
    expect(
      outline.tasks.filter((task) => task.criteria.some((criterion) => criterion.lifecycle === 'final_invariant')).length,
    ).toBeGreaterThan(0);
  });

  it('names every task after the mission it belongs to', () => {
    const outline = generatePlan(missionRequestFromState(createSampleState(), 3), SAMPLE_SEED);
    const slug = slugifyMissionId(SAMPLE_MISSION_ID);

    for (const task of outline.tasks) {
      expect(task.id.startsWith(`${slug}-`)).toBe(true);
      expect(outline.order).toContain(task.id);
      for (const path of [...task.writeSet, ...task.readSet]) {
        if (path.startsWith('src/missions/') || path.startsWith('tests/missions/')) {
          expect(path.startsWith(`src/missions/${slug}/`) || path.startsWith(`tests/missions/${slug}/`)).toBe(true);
        }
      }
    }
    expect(outline.planId).toBe(`plan-${slug}`);
    expect(outline.phases.map((phase) => phase.id)).toEqual(outline.phases.map((_, index) => `phase-${index}`));
  });
});

/* -------------------------------------------------------------------------- */
/* Layering and write ownership                                               */
/* -------------------------------------------------------------------------- */

describe('layering and write ownership', () => {
  it('never shares write ownership inside a phase, at any difficulty or seed', () => {
    for (const { level, seed } of MATRIX) {
      const outline = generatePlan(missionRequestFromState(createSampleState(), level), seed);
      const byId = new Map(outline.tasks.map((task) => [task.id, task]));

      // Authored phases.
      expectPhasesDisjoint(outline, outline.phases.map((phase) => phase.taskKeys));

      // And the phases the layering algorithm derives from the outline itself.
      const phaseOf = computePhases(outline);
      expectPhasesDisjoint(outline, groupByPhase(outline, phaseOf));

      // A task that claimed one path twice would collide with itself.
      for (const task of outline.tasks) {
        expect(new Set(task.writeSet.map(normalizePath)).size, `${task.id} self-overlap`).toBe(task.writeSet.length);
        expect(byId.get(task.id)).toBe(task);
      }
    }
  });

  it('generates outlines that satisfy the layering rules without repair', () => {
    for (const { level, seed } of MATRIX) {
      const outline = generatePlan(missionRequestFromState(createSampleState(), level), seed);
      const ids = outline.order;
      const byId = new Map(outline.tasks.map((task) => [task.id, task]));

      expect(new Set(ids).size).toBe(ids.length);
      expect(outline.tasks.map((task) => task.id)).toEqual([...ids]);

      const phaseOf = computePhases(outline);
      expect(phaseOf.size, `every task layers at level ${level}`).toBe(outline.tasks.length);
      expect(Math.max(...phaseOf.values()) + 1).toBe(outline.phases.length);

      for (const task of outline.tasks) {
        expect(task.dependsOn).not.toContain(task.id);
        expect(new Set(task.dependsOn).size).toBe(task.dependsOn.length);
        for (const dependency of task.dependsOn) {
          const upstream = byId.get(dependency);
          expect(upstream, `${task.id} → ${dependency} resolves`).toBeDefined();
          // No dependency lands in the same authored phase...
          expect(upstream?.phase).toBeLessThan(task.phase);
          // ...and none lands in the same computed phase either.
          expect(phaseOf.get(dependency) ?? Number.NaN).toBeLessThan(phaseOf.get(task.id) ?? Number.NaN);
        }
      }

      // Plan order is already topological, so the graph module never has to reorder.
      const seen = new Set<string>();
      for (const task of outline.tasks) {
        for (const dependency of task.dependsOn) expect(seen.has(dependency)).toBe(true);
        seen.add(task.id);
      }

      // Every task is listed in exactly one phase, at its authored index.
      const listed: string[] = [];
      outline.phases.forEach((phase, index) => {
        expect(phase.index).toBe(index);
        expect(phase.label).toBe(`Phase ${index + 1}`);
        expect(phase.title.trim().length).toBeGreaterThan(0);
        expect(phase.intent.trim().length).toBeGreaterThan(0);
        for (const key of phase.taskKeys) {
          listed.push(key);
          expect(byId.get(key)?.phase).toBe(index);
        }
      });
      expect([...listed].sort()).toEqual([...ids].sort());
      expect(outline.summary.phaseCount).toBe(outline.phases.length);
      expect(outline.summary.taskCount).toBe(outline.tasks.length);
      expect(outline.summary.maxParallelTasks).toBe(
        outline.phases.reduce((widest, phase) => Math.max(widest, phase.taskKeys.length), 0),
      );
    }
  });

  it('authors a catalogue that cannot produce a broken plan', () => {
    const phaseIndexes = new Set(PHASE_BLUEPRINTS.map((phase) => phase.index));
    const writeOwners = new Map<string, string>();

    expect(new Set(MISSION_WORKSTREAMS.map((workstream) => workstream.key)).size).toBe(MISSION_WORKSTREAMS.length);

    for (const workstream of MISSION_WORKSTREAMS) {
      expect(phaseIndexes.has(workstream.phase), `${workstream.key} has a known phase`).toBe(true);
      expect(workstream.writes.length).toBeGreaterThan(0);
      expect(workstream.reads.length).toBeGreaterThan(0);
      expect(workstream.verifications.length).toBeGreaterThan(0);
      expect(workstream.claims.length).toBeGreaterThan(0);

      for (const path of workstream.writes) {
        const normalized = normalizePath(path);
        expect(writeOwners.has(normalized), `${normalized} is claimed twice`).toBe(false);
        writeOwners.set(normalized, workstream.key);
      }

      for (const dependency of workstream.dependsOn) {
        const upstream = MISSION_WORKSTREAMS.find((candidate) => candidate.key === dependency);
        expect(upstream, `${workstream.key} → ${dependency}`).toBeDefined();
        // Optional work may be skipped, so nothing may depend on it...
        expect(upstream?.core).toBe(true);
        // ...and no dependency may share a phase with its dependent.
        expect(upstream?.phase).toBeLessThan(workstream.phase);
      }
    }

    PHASE_BLUEPRINTS.forEach((phase, index) => {
      expect(phase.index).toBe(index);
      expect(phase.minDifficulty).toBeGreaterThanOrEqual(1);
      const inPhase = MISSION_WORKSTREAMS.filter((workstream) => workstream.phase === index);
      expect(inPhase.filter((workstream) => workstream.core).length, `phase ${index} core`).toBeGreaterThan(0);
      // The framing phase is a single discovery task; every other phase carries a
      // three-deep optional pool, which is what lets difficulty widen it.
      const expectedOptionals = index === 0 ? 0 : 3;
      expect(inPhase.filter((workstream) => !workstream.core).length, `phase ${index} optional pool`).toBe(
        expectedOptionals,
      );
    });

    expect(Math.max(...PHASE_BLUEPRINTS.map((phase) => phase.minDifficulty))).toBeLessThanOrEqual(MAX_DIFFICULTY_LEVEL);
  });
});

/* -------------------------------------------------------------------------- */
/* Difficulty curve                                                           */
/* -------------------------------------------------------------------------- */

describe('difficulty curve', () => {
  it('grows larger, deeper and wider as mission difficulty increases', () => {
    const state = createSampleState();
    const variants = missionRequestVariants(state);
    const outlines = variants.map((variant) => generatePlan(variant, SAMPLE_SEED));

    expect(outlines.map((outline) => outline.tier)).toEqual(DIFFICULTY_LADDER.map((step) => step.tier));
    expect(outlines.map((outline) => outline.difficulty)).toEqual(DIFFICULTY_LADDER.map((step) => step.level));

    const taskCounts = outlines.map((outline) => outline.summary.taskCount);
    const phaseCounts = outlines.map((outline) => outline.summary.phaseCount);
    const widths = outlines.map((outline) => outline.summary.maxParallelTasks);
    const parallelPhases = outlines.map(
      (outline) => outline.phases.filter((phase) => phase.taskKeys.length > 1).length,
    );

    for (let index = 1; index < outlines.length; index += 1) {
      expect(taskCounts[index] ?? 0).toBeGreaterThan(taskCounts[index - 1] ?? 0);
      expect(phaseCounts[index] ?? 0).toBeGreaterThan(phaseCounts[index - 1] ?? 0);
      expect(widths[index] ?? 0).toBeGreaterThan(widths[index - 1] ?? 0);
      expect(parallelPhases[index] ?? 0).toBeGreaterThan(parallelPhases[index - 1] ?? 0);
    }

    // The harder the mission, the more work it can run at once.
    expect(widths[0]).toBeGreaterThan(1);
    expect(widths[widths.length - 1]).toBeGreaterThan(widths[0] ?? 0);

    for (const outline of outlines) {
      // Same request, same catalogue: every level keeps the authored ladder intact.
      expect(outline.summary.checkCount).toBe(outline.tasks.reduce((total, task) => total + task.checks.length, 0));
      expect(outline.summary.criterionCount).toBe(
        outline.tasks.reduce((total, task) => total + task.criteria.length, 0),
      );
      expect(outline.summary.claimCount).toBe(
        outline.tasks.reduce((total, task) => total + task.sourceClaims.length, 0),
      );
      expect(outline.summary.estimatedCredits).toBe(
        outline.tasks.reduce((total, task) => total + task.estimateCredits, 0),
      );
      expect(outline.summary.estimatedContextTokens).toBe(
        outline.tasks.reduce((total, task) => total + task.estimateContextTokens, 0),
      );
    }
  });

  it('keeps the authored phase order as difficulty adds phases', () => {
    const state = createSampleState();
    const outlines = missionRequestVariants(state).map((variant) => generatePlan(variant, SAMPLE_SEED));

    for (const outline of outlines) {
      const expected = PHASE_BLUEPRINTS.filter((phase) => phase.minDifficulty <= outline.difficulty);
      expect(outline.phases.map((phase) => phase.index)).toEqual(expected.map((phase) => phase.index));
      expect(outline.phases.map((phase) => phase.title)).toEqual(expected.map((phase) => phase.title));
      expect(outline.phases.map((phase) => phase.laneFocus)).toEqual(expected.map((phase) => phase.laneFocus));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Registration into shared state                                             */
/* -------------------------------------------------------------------------- */

describe('plan registration', () => {
  it('reduces its plan events into the shared fixture state', () => {
    const state = createSampleState();
    const outline = generatePlan(missionRequestFromState(state, 3), SAMPLE_SEED);
    const next = applyPlanOutline(state, outline);

    // The caller's state is never mutated.
    expect(state.plan.order).not.toContain(outline.order[0]);
    expect(Object.keys(state.plan.tasks)).not.toContain(outline.order[0]);

    expect(next.plan.id).toBe(state.plan.id);
    expect(next.mission.id).toBe(state.mission.id);
    expect(next.revision).toBe(state.revision + outline.tasks.length);
    expect(next.plan.order.slice(0, state.plan.order.length)).toEqual(state.plan.order);
    expect(next.plan.order.slice(state.plan.order.length)).toEqual(outline.order);

    const registered = listTasks(next).filter((task) => outline.order.includes(task.id));
    expect(registered.map((task) => task.id)).toEqual(outline.order);
    for (const task of outline.tasks) {
      const stored = next.plan.tasks[task.id];
      expect(stored, `${task.id} registered`).toBeDefined();
      expect(stored?.title).toBe(task.title);
      expect(stored?.laneId).toBe(task.laneId);
      expect(stored?.dependencies).toEqual(task.dependsOn);
      expect(stored?.status).toBe('pending');
    }

    // Generated work lands on the lanes the foundation already registers.
    const foundationLanes = new Set(Object.keys(state.lanes.lanes));
    for (const task of outline.tasks) expect(foundationLanes.has(task.laneId)).toBe(true);

    // Replaying the same outline is idempotent.
    expect(applyPlanOutline(state, outline)).toEqual(next);
  });

  it('registers into a bare initial state too', () => {
    const outline = generatePlan({ missionId: 'mission-holo-review', objective: 'Ship the review', difficulty: 1 }, 5);
    const bare = createInitialState({ missionId: outline.missionId });

    const next = applyPlanOutline(bare, outline);

    expect(next.plan.order).toEqual(outline.order);
    expect(next.mission.progress).toBe(0);
    expect(listTasks(next).every((task) => task.dependencies.every((key) => outline.order.includes(key)))).toBe(true);
    expect(listTasks(next).every((task) => task.laneId.startsWith('lane-'))).toBe(true);
  });
});
