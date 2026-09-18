// @vitest-environment happy-dom
/**
 * The six-mission campaign and its codex.
 *
 * These tests are the composition check for `src/content/missions.ts`. The
 * catalogue is a data module and imports nothing, so the interesting assertions
 * happen *here*, where the test file is allowed to import everything the
 * catalogue cannot:
 *
 *  - mission pacing boots the real `createInitialState` contract and drives the
 *    real reducer (`applyDomainEvents`) with the mission lane kinds, gate
 *    checklist and task count;
 *  - win and loss thresholds are evaluated through the pure `evaluateMissionOutcome`
 *    helper over the shared metric vocabulary;
 *  - every tutorial target is resolved against the *real* interface: the HUD
 *    overlay and the panel host are mounted under happy-dom over the real sample
 *    fixture, and scene targets are matched against the render modules' actual
 *    scene-graph root names;
 *  - the codex text is asserted against the nine required Coroid concepts, so
 *    mission copy cannot silently lose one.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  MISSIONS,
  MISSION_COUNT,
  MISSION_KEYS,
  METRIC_SOURCES,
  PROVENANCE_KINDS,
  REQUIRED_CONCEPTS,
  CODEX_LIBRARY,
  LOSS_KIND_ORDER,
  campaignDifficulty,
  contextTokensPerTask,
  deadlineMsPerTask,
  evaluateMissionOutcome,
  getCodexEntry,
  getMission,
  getMissionByOrder,
  isMissionUnlocked,
  listMissions,
  missionCodex,
  missionIndex,
  missionInitialStateOptions,
  nextMission,
  requireMission,
  unlockedMissions,
  type CodexEntry,
  type ConceptKey,
  type DomainEventType,
  type LossCondition,
  type MissionDefinition,
  type MissionInitialStateOptions,
  type MissionMetric,
  type MissionReadings,
  type ProvenanceKind,
} from '../src/content/missions';
import { PLAN_GRAPH_NAMES } from '../src/render/nodes';
import { LANE_AGENT_NAMES } from '../src/render/laneAgents';
import { CRITERION_NAMES } from '../src/render/qualityGraph';
import { createSampleState } from '../src/sim/fixtures';
import {
  applyDomainEvents,
  createInitialState,
  makeDomainEvent,
  type DomainEvent,
  type InitialStateOptions,
} from '../src/sim/state';
import {
  PROVENANCE_KINDS as HUD_PROVENANCE_KINDS,
  createHudOverlay,
  type HudOverlayHandle,
  type ProvenanceKind as HudProvenanceKind,
} from '../src/ui/hud';
import {
  PANEL_KINDS,
  createPanelHost,
  type CodexConcept,
  type PanelHost,
  type TaskContractMap,
  type TaskContractView,
} from '../src/ui/panels';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function missionAt(index: number): MissionDefinition {
  const mission = MISSIONS[index];
  if (!mission) throw new Error(`[test] no mission at index ${index}`);
  return mission;
}

/** Compile-time proof that every tag this catalogue logs against is a domain event. */
function acceptsDomainEventType(type: DomainEventType): DomainEvent['type'] {
  return type;
}

/** Compile-time proof that a mission boot payload is a legal initial state payload. */
function asInitialStateOptions(options: MissionInitialStateOptions): InitialStateOptions {
  return options;
}

/** Compile-time proof that a mission codex entry is a legal interface codex concept. */
function asCodexConcept(entry: CodexEntry): CodexConcept {
  return entry;
}

/** Compile-time proof that the catalogue provenance vocabulary is the interface's. */
function asHudProvenance(kind: ProvenanceKind): HudProvenanceKind {
  return kind;
}

function conflictStormThreshold(mission: MissionDefinition): number {
  const condition = mission.loss.find((entry) => entry.kind === 'write-conflict-storm');
  return condition?.threshold ?? Number.POSITIVE_INFINITY;
}

function contextFloor(mission: MissionDefinition): number {
  const condition = mission.loss.find((entry) => entry.kind === 'context-exhaustion');
  return condition?.threshold ?? Number.POSITIVE_INFINITY;
}

function invariantDeadline(mission: MissionDefinition): LossCondition {
  const condition = mission.loss.find((entry) => entry.kind === 'invariant-deadline');
  if (!condition) throw new Error('[test] mission is missing the invariant-deadline loss');
  return condition;
}

/** Readings that satisfy every objective and every win threshold of a mission. */
function winningReadings(mission: MissionDefinition): MissionReadings {
  const win = mission.win;
  const metrics: Partial<Record<MissionMetric, number>> = {
    'quality-score': win.qualityScore,
    reputation: win.reputation,
    'tasks-passed': win.tasksPassed,
    'gates-passed': win.gatesPassed,
    'invariants-held': win.invariantsHeld,
    'invariants-at-risk': 0,
    credits: win.credits,
    'context-remaining-ratio': win.contextRemainingRatio,
    'manifest-entries': win.manifestEntries,
    'conflicts-open': 0,
    'conflicts-resolved': 2,
    'deadline-remaining-ratio': 0.5,
    'lanes-active-peak': mission.pacing.laneLimit,
    'ownership-coverage-ratio': 1,
    'phases-planned': 3,
    'phases-complete': 3,
    'intake-briefs-parsed': 1,
    'checks-declared': 4,
    'checks-green': mission.pacing.planTasks,
    'failures-repaired': 2,
    'metrics-measured': 5,
    'criteria-superseded': 2,
    'manifest-coverage-ratio': 1,
    'provenance-coverage-ratio': 1,
  };
  // Every objective is met exactly at its target (an `lte` objective is met by
  // sitting on it too), so the win threshold is the only remaining question.
  for (const objective of mission.objectives) {
    metrics[objective.metric] = objective.target;
  }
  return { elapsedMs: Math.round(mission.pacing.deadlineMs / 2), metrics };
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

describe('campaign catalogue', () => {
  it('ships six missions with unique stable keys in campaign order', () => {
    expect(MISSIONS).toHaveLength(6);
    expect(MISSION_COUNT).toBe(6);
    expect(listMissions()).toBe(MISSIONS);

    const keys = MISSIONS.map((mission) => mission.key);
    expect(keys).toEqual([...MISSION_KEYS]);
    expect(new Set(keys).size).toBe(keys.length);

    MISSIONS.forEach((mission, index) => {
      expect(mission.order).toBe(index + 1);
      expect(mission.id).toBe(`mission-${mission.key}`);
      expect(missionIndex(mission.key)).toBe(index);
    });
  });

  it('teaches a distinct concept per mission, all nine covered by the campaign', () => {
    const taught = MISSIONS.map((mission) => mission.teaches);
    expect(new Set(taught).size).toBe(MISSIONS.length);
    for (const concept of taught) expect(REQUIRED_CONCEPTS).toContain(concept);

    const unlocked = new Set(MISSIONS.flatMap((mission) => mission.unlocks));
    for (const concept of REQUIRED_CONCEPTS) {
      expect(unlocked.has(concept), `no mission introduces ${concept}`).toBe(true);
    }
    expect(REQUIRED_CONCEPTS).toHaveLength(9);
  });

  it('gives every mission distinctive copy and unlocks all five lane kinds', () => {
    const taglines = new Set<string>();
    const briefings = new Set<string>();
    const codenames = new Set<string>();
    const laneKinds = new Set<string>();

    for (const mission of MISSIONS) {
      expect(mission.title.length).toBeGreaterThan(3);
      expect(mission.tagline.length).toBeGreaterThan(10);
      expect(mission.briefing.length).toBeGreaterThan(80);
      expect(mission.objective.length).toBeGreaterThan(40);
      expect(mission.debrief.length).toBeGreaterThan(60);
      expect(mission.requiredLaneKinds.length).toBeGreaterThan(0);
      expect(mission.gateChecklist.length).toBeGreaterThan(0);
      expect(mission.claims.length).toBeGreaterThanOrEqual(2);

      taglines.add(mission.tagline);
      briefings.add(mission.briefing);
      codenames.add(mission.codename);
      for (const kind of mission.requiredLaneKinds) laneKinds.add(kind);
    }

    expect(taglines.size).toBe(MISSIONS.length);
    expect(briefings.size).toBe(MISSIONS.length);
    expect(codenames.size).toBe(MISSIONS.length);
    expect([...laneKinds].sort()).toEqual(
      ['build', 'discovery', 'integrate', 'observe', 'verify'].sort(),
    );
  });

  it('resolves missions by key, order and successor', () => {
    expect(getMission('request-to-plan')?.codename).toBe('BLUEPRINT ZERO');
    expect(getMission('not-a-mission')).toBeUndefined();
    expect(getMissionByOrder(3)?.key).toBe('verification-gates');
    expect(getMissionByOrder(7)).toBeUndefined();
    expect(getMissionByOrder(0)).toBeUndefined();

    expect(requireMission('delivery-manifest').order).toBe(6);
    expect(() => requireMission('nope')).toThrowError(/unknown mission "nope"/);

    expect(nextMission('request-to-plan')?.key).toBe('parallel-lanes');
    expect(nextMission('delivery-manifest')).toBeNull();
    expect(nextMission('nope')).toBeNull();
    expect(missionIndex('nope')).toBe(-1);
  });

  it('unlocks missions only once their predecessors are delivered', () => {
    expect(unlockedMissions([]).map((mission) => mission.key)).toEqual(['request-to-plan']);
    expect(isMissionUnlocked('request-to-plan', [])).toBe(true);
    expect(isMissionUnlocked('parallel-lanes', [])).toBe(false);
    expect(isMissionUnlocked('parallel-lanes', ['request-to-plan'])).toBe(true);
    expect(isMissionUnlocked('delivery-manifest', MISSION_KEYS.slice(0, 5))).toBe(true);
    expect(isMissionUnlocked('delivery-manifest', MISSION_KEYS.slice(0, 4))).toBe(false);
    expect(isMissionUnlocked('nope', MISSION_KEYS)).toBe(false);

    expect(unlockedMissions(MISSION_KEYS.slice(0, 1)).map((mission) => mission.key)).toEqual([
      'request-to-plan',
      'parallel-lanes',
    ]);
    expect(unlockedMissions(MISSION_KEYS.slice(0, 5))).toHaveLength(6);

    MISSIONS.forEach((mission, index) => {
      expect(mission.pacing.unlockAfter).toBe(index);
    });
  });

  it('escalates campaign difficulty monotonically', () => {
    const rising: readonly (readonly [string, (mission: MissionDefinition) => number])[] = [
      ['order', (mission) => mission.order],
      ['planTasks', (mission) => mission.pacing.planTasks],
      ['laneLimit', (mission) => mission.pacing.laneLimit],
      ['contextBudget', (mission) => mission.pacing.contextBudget],
      ['deadlineMs', (mission) => mission.pacing.deadlineMs],
      ['startingCredits', (mission) => mission.pacing.startingCredits],
      ['startingReputation', (mission) => mission.pacing.startingReputation],
      ['creditRatePerTask', (mission) => mission.pacing.creditRatePerTask],
      ['context floor (loss)', contextFloor],
      ['difficulty', campaignDifficulty],
    ];

    for (const [label, read] of rising) {
      for (let index = 1; index < MISSIONS.length; index += 1) {
        const previous = read(missionAt(index - 1));
        const current = read(missionAt(index));
        expect(current, `${label} must rise at mission ${index + 1}`).toBeGreaterThan(previous);
      }
    }

    const atLeast: readonly (readonly [string, (mission: MissionDefinition) => number])[] = [
      ['win.qualityScore', (mission) => mission.win.qualityScore],
      ['win.reputation', (mission) => mission.win.reputation],
      ['win.tasksPassed', (mission) => mission.win.tasksPassed],
      ['win.gatesPassed', (mission) => mission.win.gatesPassed],
      ['win.invariantsHeld', (mission) => mission.win.invariantsHeld],
      ['win.credits', (mission) => mission.win.credits],
      ['win.manifestEntries', (mission) => mission.win.manifestEntries],
    ];

    for (const [label, read] of atLeast) {
      for (let index = 1; index < MISSIONS.length; index += 1) {
        const previous = read(missionAt(index - 1));
        const current = read(missionAt(index));
        expect(current, `${label} must not fall at mission ${index + 1}`).toBeGreaterThanOrEqual(
          previous,
        );
      }
    }

    const falling: readonly (readonly [string, (mission: MissionDefinition) => number])[] = [
      ['context tokens per task', contextTokensPerTask],
      ['deadline per task', deadlineMsPerTask],
      ['conflict storm threshold', conflictStormThreshold],
    ];

    for (const [label, read] of falling) {
      for (let index = 1; index < MISSIONS.length; index += 1) {
        const previous = read(missionAt(index - 1));
        const current = read(missionAt(index));
        expect(current, `${label} must fall at mission ${index + 1}`).toBeLessThan(previous);
      }
    }

    const atMost: readonly (readonly [string, (mission: MissionDefinition) => number])[] = [
      ['writeOwnershipWindow', (mission) => mission.pacing.writeOwnershipWindow],
      ['repairsAllowed', (mission) => mission.pacing.repairsAllowed],
    ];

    for (const [label, read] of atMost) {
      for (let index = 1; index < MISSIONS.length; index += 1) {
        const previous = read(missionAt(index - 1));
        const current = read(missionAt(index));
        expect(current, `${label} must not rise at mission ${index + 1}`).toBeLessThanOrEqual(
          previous,
        );
      }
    }

    expect(campaignDifficulty('request-to-plan')).toBe(0);
    expect(campaignDifficulty('delivery-manifest')).toBe(1);
    expect(campaignDifficulty('unknown')).toBe(0);
    expect(campaignDifficulty(missionAt(2))).toBeCloseTo(0.4, 10);
  });
});

/* -------------------------------------------------------------------------- */
/* Objectives, win and loss                                                   */
/* -------------------------------------------------------------------------- */

describe('objectives, win thresholds and loss conditions', () => {
  it('defines measurable objectives that point at tutorial steps', () => {
    for (const mission of MISSIONS) {
      expect(mission.objectives.length).toBeGreaterThanOrEqual(4);
      const stepIds = new Set(mission.tutorial.map((step) => step.id));
      const objectiveIds = new Set(mission.objectives.map((objective) => objective.id));
      expect(objectiveIds.size).toBe(mission.objectives.length);

      for (const objective of mission.objectives) {
        expect(objective.label.length).toBeGreaterThan(5);
        expect(objective.detail.length).toBeGreaterThan(20);
        expect(Number.isFinite(objective.target)).toBe(true);
        expect(METRIC_SOURCES[objective.metric], `undocumented metric ${objective.metric}`).toBeTruthy();
        expect(stepIds.has(objective.tutorialStepId), `${objective.id} → missing step`).toBe(true);
      }

      for (const id of mission.win.requiredObjectiveIds) {
        expect(objectiveIds.has(id), `${mission.key} requires unknown objective ${id}`).toBe(true);
      }
      expect(mission.win.requiredObjectiveIds.length).toBeGreaterThan(0);
    }
  });

  it('keeps every win threshold reachable from the mission content', () => {
    for (const mission of MISSIONS) {
      const win = mission.win;
      expect(win.qualityScore).toBeGreaterThan(0);
      expect(win.qualityScore).toBeLessThanOrEqual(1);
      expect(win.contextRemainingRatio).toBeGreaterThan(contextFloor(mission));
      expect(win.reputation).toBeGreaterThan(0);
      expect(win.reputation).toBeLessThanOrEqual(100);
      expect(win.tasksPassed).toBeLessThanOrEqual(mission.pacing.planTasks);
      expect(win.gatesPassed).toBeLessThanOrEqual(mission.gateChecklist.length);
      expect(win.manifestEntries).toBeLessThanOrEqual(mission.pacing.planTasks);
      expect(win.invariantsHeld).toBeGreaterThan(0);
    }
  });

  it('ships exactly the three loss conditions with numeric thresholds', () => {
    for (const mission of MISSIONS) {
      expect(mission.loss).toHaveLength(3);
      expect(mission.loss.map((condition) => condition.kind)).toEqual([...LOSS_KIND_ORDER]);

      for (const condition of mission.loss) {
        expect(Number.isFinite(condition.threshold)).toBe(true);
        expect(condition.threshold).toBeGreaterThanOrEqual(0);
        expect(condition.label.length).toBeGreaterThan(3);
        expect(condition.detail.length).toBeGreaterThan(20);
        expect(METRIC_SOURCES[condition.metric], `undocumented metric ${condition.metric}`).toBeTruthy();
      }

      expect(mission.loss[0]?.evaluatedAt).toBe('anytime');
      expect(mission.loss[1]?.evaluatedAt).toBe('anytime');
      expect(invariantDeadline(mission).evaluatedAt).toBe('deadline');
      expect(invariantDeadline(mission).metric).toBe('invariants-at-risk');
      expect(invariantDeadline(mission).threshold).toBe(1);
      expect(contextFloor(mission)).toBeLessThan(mission.win.contextRemainingRatio);
    }
  });

  it('documents exactly the metrics the campaign uses and uses all of them', () => {
    const used = new Set<MissionMetric>();
    for (const mission of MISSIONS) {
      for (const objective of mission.objectives) used.add(objective.metric);
      for (const condition of mission.loss) used.add(condition.metric);
      for (const step of mission.tutorial) {
        if (step.advanceWhen.kind === 'metric') used.add(step.advanceWhen.metric);
      }
    }
    used.add('quality-score');
    used.add('reputation');
    used.add('tasks-passed');
    used.add('gates-passed');
    used.add('invariants-held');
    used.add('credits');
    used.add('context-remaining-ratio');
    used.add('manifest-entries');

    const documented = Object.keys(METRIC_SOURCES) as MissionMetric[];
    for (const metric of used) {
      expect(documented, `metric ${metric} is used but undocumented`).toContain(metric);
    }
    for (const metric of documented) {
      expect(used, `metric ${metric} is documented but never used`).toContain(metric);
    }
  });

  it('defines verification gates for every required lane kind', () => {
    for (const mission of MISSIONS) {
      const gateLaneKinds = new Set(mission.gateChecklist.map((gate) => gate.laneKind));
      expect(gateLaneKinds.size).toBeGreaterThanOrEqual(2);
      for (const gate of mission.gateChecklist) {
        expect(gate.assertion.length).toBeGreaterThan(20);
        expect(gate.targetFile.length).toBeGreaterThan(3);
        expect(gate.timeoutMs).toBeGreaterThan(0);
        expect(
          mission.requiredLaneKinds,
          `${mission.key} runs ${gate.id} on an unrequired lane`,
        ).toContain(gate.laneKind);
      }
    }

    const checkKinds = new Set(MISSIONS.flatMap((m) => m.gateChecklist.map((gate) => gate.checkKind)));
    expect([...checkKinds].sort()).toEqual(['build', 'composition', 'test', 'typecheck']);

    const laneKinds = new Set(MISSIONS.flatMap((m) => m.gateChecklist.map((gate) => gate.laneKind)));
    expect([...laneKinds].sort()).toEqual(
      ['build', 'discovery', 'integrate', 'observe', 'verify'].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Tutorials                                                                  */
/* -------------------------------------------------------------------------- */

describe('tutorial script', () => {
  it('orders steps and teaches the concept the mission is named for', () => {
    const stepIds = new Set<string>();
    for (const mission of MISSIONS) {
      expect(mission.tutorial.length).toBeGreaterThanOrEqual(5);
      mission.tutorial.forEach((step, index) => {
        expect(step.index).toBe(index + 1);
        expect(stepIds.has(step.id), `duplicate step id ${step.id}`).toBe(false);
        stepIds.add(step.id);
        expect(step.title.length).toBeGreaterThan(4);
        expect(step.instruction.length).toBeGreaterThan(20);
        expect(step.lesson.length).toBeGreaterThan(60);
        expect(step.targets.length).toBeGreaterThan(0);
        for (const target of step.targets) {
          expect(target.selector.length).toBeGreaterThan(3);
          expect(target.label.length).toBeGreaterThan(2);
        }
      });

      const codexTopics = mission.codex.map((entry) => entry.topic);
      expect(codexTopics).toContain(mission.teaches);
    }
  });

  it('only advances on real objectives, documented metrics and real domain events', () => {
    for (const mission of MISSIONS) {
      const objectiveIds = new Set(mission.objectives.map((objective) => objective.id));
      for (const step of mission.tutorial) {
        const advance = step.advanceWhen;
        switch (advance.kind) {
          case 'acknowledge':
            break;
          case 'objective':
            expect(
              objectiveIds.has(advance.objectiveId),
              `${step.id} → unknown objective ${advance.objectiveId}`,
            ).toBe(true);
            break;
          case 'metric':
            expect(METRIC_SOURCES[advance.metric]).toBeTruthy();
            expect(Number.isFinite(advance.target)).toBe(true);
            break;
          case 'event':
            expect(acceptsDomainEventType(advance.eventType)).toBe(advance.eventType);
            break;
        }
      }

      const first = mission.tutorial[0];
      expect(first?.targets.some((target) => target.surface !== 'scene')).toBe(true);
    }

    expect(MISSIONS[0]?.tutorial[0]?.advanceWhen.kind).toBe('acknowledge');
  });

  it('replays provenance-tagged event-log flavour lines', () => {
    for (const mission of MISSIONS) {
      expect(mission.eventLog.length).toBeGreaterThanOrEqual(3);
      const provenances = new Set<ProvenanceKind>();
      let previousAt = -1;
      for (const line of mission.eventLog) {
        expect(line.text.length).toBeGreaterThan(30);
        expect(line.atMs).toBeGreaterThan(previousAt);
        previousAt = line.atMs;
        expect(acceptsDomainEventType(line.source)).toBe(line.source);
        provenances.add(line.provenance);
      }
      expect([...provenances].sort()).toEqual([...PROVENANCE_KINDS].sort());
    }
  });

  it('carries claims whose authority is a provenance tag', () => {
    for (const mission of MISSIONS) {
      const authorities = new Set<ProvenanceKind>();
      for (const claim of mission.claims) {
        expect(claim.statement.length).toBeGreaterThan(30);
        authorities.add(claim.authority);
      }
      expect(authorities.size).toBeGreaterThanOrEqual(2);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Codex                                                                      */
/* -------------------------------------------------------------------------- */

describe('codex', () => {
  it('covers all nine Coroid concepts with in-game provenance tags', () => {
    const entries = MISSIONS.flatMap((mission) => mission.codex);
    const topics = new Set(entries.map((entry) => entry.topic));

    expect(REQUIRED_CONCEPTS).toHaveLength(9);
    for (const concept of REQUIRED_CONCEPTS) {
      expect(topics.has(concept), `codex is missing ${concept}`).toBe(true);
    }

    const provenances = new Set(entries.map((entry) => entry.provenance));
    expect([...provenances].sort()).toEqual([...PROVENANCE_KINDS].sort());
    expect([...HUD_PROVENANCE_KINDS].sort()).toEqual([...PROVENANCE_KINDS].sort());
    for (const kind of PROVENANCE_KINDS) {
      expect(asHudProvenance(kind)).toBe(kind);
    }
  });

  it('explains each required concept with the vocabulary of that concept', () => {
    const keywords: Readonly<Record<ConceptKey, readonly string[]>> = {
      'request-to-plan-decomposition': ['request', 'decompos', 'task'],
      'phases-as-dependency-layers': ['phase', 'depend'],
      'read-write-ownership': ['write set', 'read set', 'exclusive'],
      'parallel-agent-lanes': ['lane', 'parallel'],
      'verification-checks': ['build', 'typecheck', 'test', 'composition'],
      'criterion-lifecycles': ['milestone', 'final_invariant', 'superseded'],
      'quality-graph': ['quality', 'target', 'weight'],
      'context-budget': ['token', 'budget', 'exhaust'],
      'delivery-manifest': ['manifest', 'provenance', 'deadline'],
    };

    for (const concept of REQUIRED_CONCEPTS) {
      const entry = CODEX_LIBRARY[concept];
      expect(entry, `no codex entry for ${concept}`).toBeTruthy();
      const text = asCodexConcept(entry).definition.toLowerCase();
      for (const keyword of keywords[concept]) {
        expect(text, `${concept} copy lost "${keyword}"`).toContain(keyword);
      }
      expect(entry.term.length).toBeGreaterThan(3);
    }
  });

  it('unlocks codex entries cumulatively and never duplicates them', () => {
    const introduced = new Set<string>();
    let previousCount = 0;
    let previousIds: readonly string[] = [];

    for (const mission of MISSIONS) {
      expect(mission.codex.length).toBeGreaterThanOrEqual(previousCount);
      const ids = mission.codex.map((entry) => entry.id);
      expect(new Set(ids).size, `${mission.key} lists a codex entry twice`).toBe(ids.length);
      for (const prior of previousIds) {
        expect(ids).toContain(prior);
      }
      for (const topic of mission.unlocks) {
        const entry = CODEX_LIBRARY[topic];
        expect(introduced.has(entry.id), `${entry.id} introduced twice`).toBe(false);
        expect(ids, `${mission.key} unlocks ${topic} without listing it`).toContain(entry.id);
      }
      for (const topic of mission.unlocks) introduced.add(CODEX_LIBRARY[topic].id);

      for (const topic of mission.unlocks) {
        expect(mission.codex.map((entry) => entry.topic)).toContain(topic);
        expect(CODEX_LIBRARY[topic].introducedBy).toBe(mission.key);
      }

      previousCount = mission.codex.length;
      previousIds = ids;
    }

    const last = missionAt(MISSIONS.length - 1);
    expect(last.codex.length).toBeGreaterThanOrEqual(11);
    expect(missionCodex('delivery-manifest')).toBe(last.codex);
    expect(missionCodex(MISSIONS[0] as MissionDefinition)).toHaveLength(4);
    expect(getCodexEntry('codex-delivery-manifest')?.topic).toBe('delivery-manifest');
    expect(getCodexEntry('codex-nope')).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Booting a mission into the shared domain contract                          */
/* -------------------------------------------------------------------------- */

describe('booting a mission', () => {
  it('produces initial state options the domain contract accepts', () => {
    for (const mission of MISSIONS) {
      const options = missionInitialStateOptions(mission);
      expect(asInitialStateOptions(options)).toBe(options);

      const state = createInitialState(options);
      expect(state.seed).toBe(mission.pacing.seed);
      expect(state.mission.id).toBe(mission.id);
      expect(state.mission.codename).toBe(mission.codename);
      expect(state.mission.objective).toBe(mission.objective);
      expect(state.mission.status).toBe('bootstrapping');
      expect(state.economy.contextBudget).toBe(mission.pacing.contextBudget);
      expect(state.economy.deadlineMs).toBe(mission.pacing.deadlineMs);
      expect(state.economy.credits).toBe(mission.pacing.startingCredits);
      expect(state.economy.reputation).toBe(mission.pacing.startingReputation);
      expect(state.economy.creditRatePerTask).toBe(mission.pacing.creditRatePerTask);
    }

    const first = createInitialState(missionInitialStateOptions('quality-graph'));
    const second = createInitialState(missionInitialStateOptions(requireMission('quality-graph')));
    expect(first).toEqual(second);
    expect(() => missionInitialStateOptions('nope')).toThrowError(/unknown mission/);
  });

  it('drives the reducer with the mission lane kinds, gates and task count', () => {
    for (const mission of MISSIONS) {
      let state = createInitialState(missionInitialStateOptions(mission));
      const events: DomainEvent[] = [makeDomainEvent('mission/started', {}, 0)];
      let at = 0;
      const tick = (): number => {
        at += 120;
        return at;
      };

      for (const kind of mission.requiredLaneKinds) {
        events.push(
          makeDomainEvent(
            'lane/registered',
            { lane: { id: `lane-${kind}`, kind, label: `${kind} lane`, capacity: 2 } },
            tick(),
          ),
        );
      }
      for (const gate of mission.gateChecklist) {
        events.push(
          makeDomainEvent(
            'verification/gate-registered',
            { gate: { id: gate.id, name: gate.name, laneId: `lane-${gate.laneKind}` } },
            tick(),
          ),
        );
      }

      const laneIds = mission.requiredLaneKinds.map((kind) => `lane-${kind}`);
      for (let index = 0; index < mission.pacing.planTasks; index += 1) {
        const laneId = laneIds[index % laneIds.length] ?? laneIds[0] ?? 'lane-build';
        events.push(
          makeDomainEvent(
            'plan/task-registered',
            { task: { id: `task-${index}`, title: `Task ${index}`, laneId, dependencies: [] } },
            tick(),
          ),
        );
      }

      state = applyDomainEvents(state, events);
      expect(state.mission.status).toBe('running');
      expect(state.lanes.order).toHaveLength(mission.requiredLaneKinds.length);
      expect(state.verification.order).toHaveLength(mission.gateChecklist.length);
      expect(state.plan.order).toHaveLength(mission.pacing.planTasks);
      expect(state.mission.progress).toBe(0);
      expect(state.economy.contextSpent).toBe(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Win and loss evaluation                                                    */
/* -------------------------------------------------------------------------- */

describe('mission verdicts', () => {
  it('wins every mission when its objectives and win threshold are met', () => {
    for (const mission of MISSIONS) {
      const verdict = evaluateMissionOutcome(mission, winningReadings(mission));
      expect(verdict.outcome, `${mission.key}: ${verdict.reason}`).toBe('won');
      expect(verdict.lossKind).toBeNull();
      expect(verdict.blockingObjectiveIds).toEqual([]);
      expect(verdict.objectiveProgress).toBe(1);
      expect(verdict.deadlineRemainingMs).toBeGreaterThan(0);
    }
  });

  it('reports progress while the mission is still running', () => {
    const mission = requireMission('quality-graph');
    const readings = winningReadings(mission);
    const metrics = { ...readings.metrics, 'quality-score': 0.1 };
    const verdict = evaluateMissionOutcome(mission, { elapsedMs: 60_000, metrics });

    expect(verdict.outcome).toBe('running');
    expect(verdict.lossKind).toBeNull();
    expect(verdict.blockingObjectiveIds).toEqual(['obj-m4-score']);
    expect(verdict.unmetObjectiveIds).toContain('obj-m4-score');
    expect(verdict.objectiveProgress).toBeCloseTo(3 / 4, 10);
    expect(verdict.reason).toMatch(/required objective/);
  });

  it('loses to context exhaustion', () => {
    for (const mission of MISSIONS) {
      const readings = winningReadings(mission);
      const metrics = { ...readings.metrics, 'context-remaining-ratio': contextFloor(mission) };
      const verdict = evaluateMissionOutcome(mission, { elapsedMs: 10_000, metrics });
      expect(verdict.outcome).toBe('lost');
      expect(verdict.lossKind).toBe('context-exhaustion');
      expect(verdict.reason).toContain('context');
    }
  });

  it('loses to a write-ownership conflict storm', () => {
    for (const mission of MISSIONS) {
      const readings = winningReadings(mission);
      const metrics = { ...readings.metrics, 'conflicts-open': conflictStormThreshold(mission) };
      const verdict = evaluateMissionOutcome(mission, { elapsedMs: 10_000, metrics });
      expect(verdict.outcome).toBe('lost');
      expect(verdict.lossKind).toBe('write-conflict-storm');
    }
  });

  it('loses when a final invariant is unrepaired at the deadline', () => {
    for (const mission of MISSIONS) {
      const readings = winningReadings(mission);
      const metrics = { ...readings.metrics, 'invariants-at-risk': 1, 'invariants-held': 0 };
      const verdict = evaluateMissionOutcome(mission, {
        elapsedMs: mission.pacing.deadlineMs,
        metrics,
      });
      expect(verdict.outcome).toBe('lost');
      expect(verdict.lossKind).toBe('invariant-deadline');
      expect(verdict.deadlineRemainingMs).toBe(0);
    }
  });

  it('loses a delivery that lands after the deadline', () => {
    const mission = requireMission('delivery-manifest');
    const readings = winningReadings(mission);
    const metrics = { ...readings.metrics, 'tasks-passed': 4, 'manifest-entries': 2 };
    const verdict = evaluateMissionOutcome(mission, {
      elapsedMs: mission.pacing.deadlineMs + 1,
      metrics,
    });
    expect(verdict.outcome).toBe('lost');
    expect(verdict.lossKind).toBe('invariant-deadline');
    expect(verdict.blockingObjectiveIds.length).toBeGreaterThan(0);
  });

  it('wins a delivery that lands exactly on the deadline with invariants held', () => {
    for (const mission of MISSIONS) {
      const readings = winningReadings(mission);
      const verdict = evaluateMissionOutcome(mission, {
        elapsedMs: mission.pacing.deadlineMs,
        metrics: readings.metrics,
      });
      expect(verdict.outcome, `${mission.key}: ${verdict.reason}`).toBe('won');
      expect(verdict.deadlineRemainingMs).toBe(0);
    }
  });

  it('is pure and deterministic over its readings', () => {
    const mission = requireMission('parallel-lanes');
    const metrics = Object.freeze({ ...winningReadings(mission).metrics });
    const readings = Object.freeze({ elapsedMs: 30_000, metrics });

    const first = evaluateMissionOutcome(mission, readings);
    const second = evaluateMissionOutcome(mission, readings);
    expect(second).toEqual(first);
    expect(readings.elapsedMs).toBe(30_000);
    expect(metrics['conflicts-open']).toBe(0);

    expect(evaluateMissionOutcome('parallel-lanes', {}).outcome).toBe('running');
    expect(() => evaluateMissionOutcome('nope', {})).toThrowError(/unknown mission/);
  });
});

/* -------------------------------------------------------------------------- */
/* Interface integration                                                      */
/* -------------------------------------------------------------------------- */

interface MountedInterface {
  readonly overlay: HudOverlayHandle;
  readonly panels: PanelHost;
  readonly hudKeys: ReadonlySet<string>;
}

const SCENE_ROOTS: readonly string[] = [
  PLAN_GRAPH_NAMES.root,
  LANE_AGENT_NAMES.root,
  CRITERION_NAMES.root,
];

/**
 * Mount the real overlay and the real panel host over the real sample fixture,
 * then collect every `data-hud` hook the interface renders in any panel state.
 */
function mountInterface(): MountedInterface {
  const state = createSampleState();
  const overlay = createHudOverlay({ doc: document });
  overlay.update(state);
  overlay.pushEvent(makeDomainEvent('mission/started', {}, 0));
  overlay.pushEvent(
    makeDomainEvent(
      'plan/task-registered',
      { task: { id: 'task-plan', title: 'Decompose the request', laneId: 'lane-build' } },
      1_200,
    ),
  );
  overlay.pushEvent(
    makeDomainEvent(
      'quality/measured',
      { metric: { id: 'metric-score', label: 'Quality score', value: 0.7, target: 1, weight: 1 } },
      2_400,
    ),
  );

  const verification = requireMission('verification-gates');
  const gate = verification.gateChecklist[0];
  if (!gate) throw new Error('[test] the verification mission needs a gate');

  const contract: TaskContractView = {
    readSet: ['src/sim/state.ts'],
    writeSet: ['src/content/missions.ts'],
    checks: [
      {
        id: gate.id,
        kind: gate.checkKind,
        assertion: gate.assertion,
        targetFile: gate.targetFile,
        evidence: 'command',
        status: 'passed',
      },
    ],
    criteria: [
      {
        key: 'criterion-four-check-kinds',
        label: 'All four check kinds declared',
        lifecycle: 'final_invariant',
        requiredEvidence: 'command',
        satisfiedByCheckIds: [gate.id],
        provenance: 'architect_choice',
      },
    ],
    claims: verification.claims.map((claim) => ({
      statement: claim.statement,
      authority: claim.authority,
    })),
  };
  const contracts: TaskContractMap = Object.fromEntries(
    state.plan.order.map((taskId) => [taskId, contract]),
  );

  const panels = createPanelHost({
    doc: document,
    contracts,
    concepts: verification.codex,
  });

  const hudKeys = new Set<string>();
  const collect = (): void => {
    for (const element of document.querySelectorAll('[data-hud]')) {
      const key = element.getAttribute('data-hud');
      if (key) hudKeys.add(key);
    }
  };

  collect();
  for (const kind of PANEL_KINDS) {
    panels.openPanel(kind);
    panels.update(state);
    collect();
  }

  return { overlay, panels, hudKeys };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('interface integration', () => {
  it('points every tutorial target at a hook the interface really renders', () => {
    const { overlay, panels, hudKeys } = mountInterface();
    try {
      expect(SCENE_ROOTS).toEqual(['plan-graph', 'lane-agents', 'quality-constellation']);
      expect(hudKeys.size).toBeGreaterThan(20);

      for (const mission of MISSIONS) {
        for (const step of mission.tutorial) {
          for (const target of step.targets) {
            if (target.surface === 'scene') {
              expect(SCENE_ROOTS, `${step.id} → scene ${target.selector}`).toContain(
                target.selector,
              );
              continue;
            }
            const match = /^\[data-hud="([^"]+)"\]$/.exec(target.selector);
            expect(match, `${step.id} → ${target.selector}`).not.toBeNull();
            const key = match?.[1] ?? '';
            expect(hudKeys.has(key), `${step.id} → missing hook ${key}`).toBe(true);
          }
        }
      }
    } finally {
      panels.dispose();
      overlay.dispose();
    }
  });

  it('renders mission codex entries and claim provenance through the real panels', () => {
    const { overlay, panels } = mountInterface();
    try {
      panels.openPanel('codex');
      panels.update(createSampleState());

      const concepts = [...document.querySelectorAll('[data-hud="codex-entry"]')];
      const terms = [...document.querySelectorAll('[data-hud="codex-term"]')].map(
        (element) => element.textContent ?? '',
      );
      expect(concepts.length).toBeGreaterThan(0);
      for (const entry of requireMission('verification-gates').codex) {
        expect(terms, `codex panel is missing ${entry.term}`).toContain(entry.term);
      }

      const provenanceValues = new Set(
        [...document.querySelectorAll('[data-hud="codex-provenance"]')].map(
          (element) => element.getAttribute('data-provenance') ?? '',
        ),
      );
      expect(provenanceValues.has('architect_choice')).toBe(true);
      expect(provenanceValues.has('repository_observation')).toBe(true);

      const claimValues = new Set(
        [...document.querySelectorAll('[data-hud="claim-provenance"]')].map(
          (element) => element.getAttribute('data-provenance') ?? '',
        ),
      );
      expect([...claimValues].sort()).toEqual([...PROVENANCE_KINDS].sort());
    } finally {
      panels.dispose();
      overlay.dispose();
    }
  });

  it('renders the mission gate checklist as inspector checks', () => {
    const { overlay, panels } = mountInterface();
    try {
      panels.openPanel('inspector');
      panels.update(createSampleState());

      const checks = [...document.querySelectorAll('[data-hud="inspector-check"]')];
      expect(checks.length).toBe(1);
      const gate = requireMission('verification-gates').gateChecklist[0];
      expect(gate).toBeTruthy();
      expect(panels.selectedTaskId).toBeTruthy();
      expect(checks[0]?.textContent ?? '').toContain(String(gate?.assertion));
      expect(document.querySelector('[data-hud="criterion-lifecycle"]')?.textContent ?? '').toContain(
        'final invariant',
      );
    } finally {
      panels.dispose();
      overlay.dispose();
    }
  });
});
