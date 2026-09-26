/**
 * The Coroid campaign: six missions and the codex that teaches what Coroid is.
 *
 * Coroid is an autonomous software factory. A request arrives, the factory
 * decomposes it into a plan, layers that plan into phases, runs agent lanes in
 * parallel inside declared read/write ownership, proves the work with
 * verification checks, scores it on the quality graph, spends a fixed context
 * budget while it does so, and hands over a delivery manifest. The campaign
 * teaches that loop one concept at a time, from the intake desk to the last
 * mile, and everything the player reads on the floor comes from this file.
 *
 * This module is *content*: typed exported data plus pure lookup helpers. It
 * deliberately imports nothing — not the simulation, not the renderer, not the
 * interface — so the catalogue can be read by the planner, the flow layer, the
 * overlay, the codex panel and the tests without dragging a module graph along
 * with it. Where a shape must line up with a contract that lives elsewhere, the
 * shape is documented here and *asserted in `tests/missions.test.ts`*, which is
 * allowed to import the modules this one cannot:
 *
 *  - `MissionInitialStateOptions` matches the field names of `InitialStateOptions`
 *    in `src/sim/state.ts`, so `createInitialState(missionInitialStateOptions(m))`
 *    boots a mission straight onto the shared domain contract.
 *  - `CodexEntry` carries the `id`/`term`/`definition`/`category`/`provenance`
 *    fields of `CodexConcept` in `src/ui/panels.ts` and is structurally
 *    assignable to it, so a mission codex can be handed to `createCodexConcepts`
 *    as `extra` entries.
 *  - `ProvenanceKind`, `LaneKind`, `CheckKind` and the criterion lifecycles use
 *    the same literal strings as the shared contracts.
 *  - `TutorialTarget.selector` addresses real interface and scene hooks: either
 *    `[data-hud="..."]` (an existing HUD or panel hook) or the object name of a
 *    scene root (`plan-graph`, `lane-agents`, `quality-constellation`).
 *
 * Every mission ships measurable objectives, a win threshold, exactly the three
 * loss conditions the flow layer can evaluate (`context-exhaustion`,
 * `write-conflict-storm`, `invariant-deadline`), ordered tutorial steps, codex
 * entries, provenance-tagged event-log flavour lines and pacing knobs. Difficulty
 * rises monotonically: each mission plans more tasks, grants more context tokens
 * but fewer tokens per task, has a later deadline but less time per task, and
 * tolerates fewer conflicts, larger context floors and fewer repairs.
 */

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Stable mission keys.
 *
 * These strings are referenced by the planner, the flow layer, the interface
 * and the tests, so they never change once shipped.
 */
export type MissionKey =
  | 'request-to-plan'
  | 'parallel-lanes'
  | 'verification-gates'
  | 'quality-graph'
  | 'context-budget'
  | 'delivery-manifest';

/** Canonical campaign order. */
export const MISSION_KEYS: readonly MissionKey[] = [
  'request-to-plan',
  'parallel-lanes',
  'verification-gates',
  'quality-graph',
  'context-budget',
  'delivery-manifest',
];

/**
 * The nine Coroid concepts the campaign must teach.
 *
 * Every one of these is covered by a codex entry (see {@link REQUIRED_CONCEPTS}
 * and {@link CODEX_LIBRARY}).
 */
export type ConceptKey =
  | 'request-to-plan-decomposition'
  | 'phases-as-dependency-layers'
  | 'read-write-ownership'
  | 'parallel-agent-lanes'
  | 'verification-checks'
  | 'criterion-lifecycles'
  | 'quality-graph'
  | 'context-budget'
  | 'delivery-manifest';

/** The nine concepts, in teaching order. */
export const REQUIRED_CONCEPTS: readonly ConceptKey[] = [
  'request-to-plan-decomposition',
  'phases-as-dependency-layers',
  'read-write-ownership',
  'parallel-agent-lanes',
  'verification-checks',
  'criterion-lifecycles',
  'quality-graph',
  'context-budget',
  'delivery-manifest',
];

/** Codex topics: the nine concepts plus the two orientation entries. */
export type CodexTopic = ConceptKey | 'coroid' | 'provenance-tags';

/**
 * Where a line of content came from.
 *
 * This is in-game terminology, not metadata: the event log and the codex render
 * the tag as text plus a chip, so the provenance survives monochrome and a
 * screen reader. Values match `ProvenanceKind` in `src/ui/hud.ts`.
 */
export type ProvenanceKind = 'user_requirement' | 'repository_observation' | 'architect_choice';

/** Canonical provenance order, used by legends and by the campaign tests. */
export const PROVENANCE_KINDS: readonly ProvenanceKind[] = [
  'user_requirement',
  'repository_observation',
  'architect_choice',
];

/** Codex shelf an entry belongs to. Values match `CodexCategory` in `src/ui/panels.ts`. */
export type CodexCategory = 'mission' | 'lane' | 'verification' | 'quality' | 'economy';

/** Agent lane kinds. Values match `LaneKind` in `src/sim/state.ts`. */
export type LaneKind = 'discovery' | 'build' | 'verify' | 'integrate' | 'observe';

/** The four ways work is proven. Values match `CheckKind` in `src/sim/verification.ts`. */
export type CheckKind = 'build' | 'typecheck' | 'test' | 'composition';

/** Criterion lifecycles. Values match `CriterionLifecycle` in `src/sim/verification.ts`. */
export type CriterionLifecycle = 'milestone' | 'final_invariant' | 'superseded';

/** Domain event tags a mission may log against. Values match `DomainEvent['type']` in `src/sim/state.ts`. */
export type DomainEventType =
  | 'mission/started'
  | 'mission/status'
  | 'plan/task-registered'
  | 'plan/task-updated'
  | 'lane/registered'
  | 'lane/queued'
  | 'lane/assigned'
  | 'lane/released'
  | 'verification/gate-registered'
  | 'verification/run'
  | 'quality/measured'
  | 'quality/finding'
  | 'economy/spend'
  | 'economy/reward'
  | 'economy/deadline';

/** How a measured value is compared against a threshold. */
export type Comparison = 'gte' | 'lte';

/** Unit of a numeric threshold, so the HUD can format it. */
export type ThresholdUnit = 'count' | 'ratio' | 'credits';

/** Pacing tier: one per mission, rising with the campaign. */
export type MissionTier = 'orientation' | 'apprentice' | 'journeyman' | 'architect' | 'chief' | 'master';

/**
 * Everything the flow layer can measure to judge a mission.
 *
 * Each metric is read from the shared state slices, so no mission has to invent
 * a scoring rule of its own. `METRIC_SOURCES` documents where each one comes
 * from; the tests assert that every metric used by a mission is documented.
 */
export type MissionMetric =
  | 'intake-briefs-parsed'
  | 'tasks-registered'
  | 'phases-planned'
  | 'tasks-passed'
  | 'phases-complete'
  | 'lanes-active-peak'
  | 'ownership-coverage-ratio'
  | 'conflicts-open'
  | 'conflicts-resolved'
  | 'gates-passed'
  | 'checks-declared'
  | 'checks-green'
  | 'failures-repaired'
  | 'metrics-measured'
  | 'invariants-held'
  | 'invariants-at-risk'
  | 'criteria-superseded'
  | 'quality-score'
  | 'reputation'
  | 'credits'
  | 'context-remaining-ratio'
  | 'deadline-remaining-ratio'
  | 'manifest-entries'
  | 'manifest-coverage-ratio'
  | 'provenance-coverage-ratio';

/**
 * Where the flow layer reads each metric.
 *
 * Written as `slice → derivation` so the mapping stays reviewable: a mission may
 * only ask for a number the simulation can actually produce.
 */
export const METRIC_SOURCES: Readonly<Record<MissionMetric, string>> = {
  'intake-briefs-parsed': 'mission → requests decomposed at the intake desk',
  'tasks-registered': 'plan.order → registered task count',
  'phases-planned': 'graph → number of dependency layers the plan resolves into',
  'tasks-passed': 'plan.tasks → tasks settled `passed`',
  'phases-complete': 'graph → phases whose every task is `passed`',
  'lanes-active-peak': 'lanes → peak count of concurrently running tasks',
  'ownership-coverage-ratio': 'plan.tasks → share of tasks with a declared write set',
  'conflicts-open': 'graph → same-phase write-set overlaps still unresolved',
  'conflicts-resolved': 'graph → conflicts settled without stalling a lane',
  'gates-passed': 'verification.gates → gates settled `passed`',
  'checks-declared': 'verification → declared check kinds (build, typecheck, test, composition)',
  'checks-green': 'verification → individual checks reporting `passed`',
  'failures-repaired': 'verification → failing checks repaired in place',
  'metrics-measured': 'quality.metrics → measured metrics in the constellation',
  'invariants-held': 'quality → satisfied `final_invariant` criteria',
  'invariants-at-risk': 'quality → unsatisfied `final_invariant` criteria',
  'criteria-superseded': 'quality → criteria replaced by a successor criterion',
  'quality-score': 'quality.score → derived 0..1 weighted score',
  'reputation': 'economy.reputation → 0..100 reputation score',
  'credits': 'economy.credits → credits left in the vault',
  'context-remaining-ratio': 'economy → 1 - contextSpent / contextBudget',
  'deadline-remaining-ratio': 'economy → (deadlineMs - elapsedMs) / deadlineMs',
  'manifest-entries': 'manifest → delivered entries carrying a task and its evidence',
  'manifest-coverage-ratio': 'manifest → share of entries with a green check attached',
  'provenance-coverage-ratio': 'manifest → share of entries carrying a provenance tag',
};

/* -------------------------------------------------------------------------- */
/* Codex library                                                              */
/* -------------------------------------------------------------------------- */

/** One codex entry: the vocabulary a mission is built from. */
export interface CodexEntry {
  readonly id: string;
  /** Topic this entry teaches; `coroid` and `provenance-tags` orient the player. */
  readonly topic: CodexTopic;
  /** Term as it appears in the codex list. */
  readonly term: string;
  readonly definition: string;
  readonly category: CodexCategory;
  /** Where the concept itself came from, rendered as a provenance chip. */
  readonly provenance: ProvenanceKind;
  /** Mission that unlocks the entry. */
  readonly introducedBy: MissionKey;
}

/**
 * The whole codex: eleven entries, covering the nine required concepts.
 *
 * Entries are unlocked cumulatively as the campaign progresses, so the codex a
 * player opens in mission five still explains what they learned in mission one.
 */
export const CODEX_LIBRARY: Readonly<Record<CodexTopic, CodexEntry>> = {
  coroid: {
    id: 'codex-coroid',
    topic: 'coroid',
    term: 'Coroid',
    category: 'mission',
    provenance: 'user_requirement',
    introducedBy: 'request-to-plan',
    definition:
      'Coroid is an autonomous software factory. A request is decomposed into a plan, the plan is layered into phases, agent lanes build and verify the work in parallel, and the factory ships a delivery manifest that says exactly what was proven. Everything on the floor is that loop, running.',
  },
  'provenance-tags': {
    id: 'codex-provenance-tags',
    topic: 'provenance-tags',
    term: 'Provenance tag',
    category: 'mission',
    provenance: 'user_requirement',
    introducedBy: 'request-to-plan',
    definition:
      'Every log line and every codex entry says where it came from: user_requirement for what the brief fixed, repository_observation for what the work actually showed, architect_choice for what the plan decided. The tag is written out as text next to its chip, because provenance is not decoration.',
  },
  'request-to-plan-decomposition': {
    id: 'codex-request-to-plan',
    topic: 'request-to-plan-decomposition',
    term: 'Request-to-plan decomposition',
    category: 'mission',
    provenance: 'user_requirement',
    introducedBy: 'request-to-plan',
    definition:
      'A request arrives as one sentence. Decomposition turns it into verifiable tasks, each naming what it owns, what it depends on and how it will be checked, so the plan, not a person, decides the order of work. A task you cannot verify is a task you have not finished planning.',
  },
  'phases-as-dependency-layers': {
    id: 'codex-phases',
    topic: 'phases-as-dependency-layers',
    term: 'Phase (dependency layer)',
    category: 'mission',
    provenance: 'architect_choice',
    introducedBy: 'request-to-plan',
    definition:
      'Phases are dependency layers. A task may only depend on tasks in an earlier phase, so each phase can be dispatched in parallel and nothing waits on work that has not been planned yet. Dependency is declared, never inferred from the order tasks were typed in.',
  },
  'read-write-ownership': {
    id: 'codex-ownership',
    topic: 'read-write-ownership',
    term: 'Read set and write set',
    category: 'lane',
    provenance: 'architect_choice',
    introducedBy: 'parallel-lanes',
    definition:
      'Every task declares the files it reads and the files it writes. Write sets are exclusive: only one task may write a path at a time. Read sets may overlap freely. A conflict boundary is the plan drawing that line before two lanes discover it by colliding.',
  },
  'parallel-agent-lanes': {
    id: 'codex-agent-lanes',
    topic: 'parallel-agent-lanes',
    term: 'Agent lane',
    category: 'lane',
    provenance: 'architect_choice',
    introducedBy: 'parallel-lanes',
    definition:
      'An agent lane carries one kind of work: discovery, build, verify, integrate or observe. A lane runs several tasks at once up to its lane limit, which is why Coroid is fast; declared ownership is why parallel lanes are safe. Watch lane occupancy to see how much of the floor is actually working.',
  },
  'verification-checks': {
    id: 'codex-verification-checks',
    topic: 'verification-checks',
    term: 'Verification check',
    category: 'verification',
    provenance: 'repository_observation',
    introducedBy: 'verification-gates',
    definition:
      'Checks are the four ways work is proven: build, typecheck, test and composition. A failing check keeps its dependent tasks blocked and opens a repair objective naming the offending file, and the objective only closes when that same check goes green. Nothing is trusted on a hunch, and a repair beats a restart.',
  },
  'criterion-lifecycles': {
    id: 'codex-criterion-lifecycles',
    topic: 'criterion-lifecycles',
    term: 'Criterion lifecycle',
    category: 'quality',
    provenance: 'architect_choice',
    introducedBy: 'quality-graph',
    definition:
      'A criterion starts as a milestone, graduates to a final_invariant when it must hold at delivery, and is superseded when a replacement criterion takes over. Only satisfied final_invariant criteria count toward release, and a final_invariant still unrepaired at the deadline loses the mission.',
  },
  'quality-graph': {
    id: 'codex-quality-graph',
    topic: 'quality-graph',
    term: 'Quality graph',
    category: 'quality',
    provenance: 'repository_observation',
    introducedBy: 'quality-graph',
    definition:
      'The quality graph is the weighted constellation of measured metrics, open findings and live criteria. Your score is each measured value against its target, weighted, so one perfect metric cannot hide a failing invariant. Read the constellation before you claim the release.',
  },
  'context-budget': {
    id: 'codex-context-budget',
    topic: 'context-budget',
    term: 'Context budget',
    category: 'economy',
    provenance: 'user_requirement',
    introducedBy: 'context-budget',
    definition:
      'Every mission runs on a fixed context budget: the tokens agents spend reading, planning and repairing. When the budget is exhausted the agents stop mid-task and the mission is lost, so wide reads and repeated repairs are real costs. Batch your reads and spend tokens where they buy verified work.',
  },
  'delivery-manifest': {
    id: 'codex-delivery-manifest',
    topic: 'delivery-manifest',
    term: 'Delivery manifest',
    category: 'economy',
    provenance: 'architect_choice',
    introducedBy: 'delivery-manifest',
    definition:
      'The delivery manifest is the claim Coroid actually hands over: every task, the checks that ran, each criterion with its evidence and provenance tag, and what the run cost in credits and context. A mission wins when the manifest is complete, every final_invariant holds and the deadline has not passed.',
  },
};

/** Orientation entries every mission ships. */
export const CODEX_ORIENTATION_TOPICS: readonly CodexTopic[] = ['coroid', 'provenance-tags'];

/** Look up a codex entry by id, without tripping over `noUncheckedIndexedAccess`. */
export function getCodexEntry(id: string): CodexEntry | undefined {
  return MISSION_CODEX_ENTRIES.find((entry) => entry.id === id);
}

/** Every codex entry the campaign can unlock, in teaching order. */
export const MISSION_CODEX_ENTRIES: readonly CodexEntry[] = REQUIRED_CONCEPTS.reduce<CodexEntry[]>(
  (entries, topic) => {
    const entry = CODEX_LIBRARY[topic];
    if (entry) entries.push(entry);
    return entries;
  },
  CODEX_ORIENTATION_TOPICS.flatMap((topic) => {
    const entry = CODEX_LIBRARY[topic];
    return entry ? [entry] : [];
  }),
);

/* -------------------------------------------------------------------------- */
/* Mission shapes                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Pacing and budget knobs.
 *
 * The planner and the flow layer derive difficulty from these numbers, so they
 * live here as tunable content rather than as constants buried in systems code.
 */
export interface MissionPacing {
  /** 1..6 campaign position; also the difficulty tier. */
  readonly order: number;
  readonly tier: MissionTier;
  /** Deterministic seed used when the mission boots its state. */
  readonly seed: number;
  /** Tasks the mission plans to ship at its difficulty target. */
  readonly planTasks: number;
  /** Maximum tasks allowed to run concurrently across all lanes. */
  readonly laneLimit: number;
  /** Context tokens granted for the whole mission. */
  readonly contextBudget: number;
  /** Simulated milliseconds the mission must be delivered in. */
  readonly deadlineMs: number;
  /** Largest write set a single task may declare, in files. */
  readonly writeOwnershipWindow: number;
  /** Failures a task may repair before the gate stays red. */
  readonly repairsAllowed: number;
  readonly startingCredits: number;
  readonly startingReputation: number;
  readonly creditRatePerTask: number;
  /** Missions that must be delivered before this one unlocks (`order - 1`). */
  readonly unlockAfter: number;
}

/** One objective the flow layer evaluates: a metric, a direction and a target. */
export interface MissionObjective {
  readonly id: string;
  readonly label: string;
  /** Why the objective exists, in the player's language. */
  readonly detail: string;
  readonly metric: MissionMetric;
  readonly comparator: Comparison;
  readonly target: number;
  readonly unit: ThresholdUnit;
  /** True when missing the objective loses the mission, not just the rating. */
  readonly required: boolean;
  /** Tutorial step that teaches how to reach it. */
  readonly tutorialStepId: string;
}

/** Everything that must be true when the manifest is handed over. */
export interface WinThreshold {
  /** Objective ids the flow layer must see satisfied. */
  readonly requiredObjectiveIds: readonly string[];
  readonly qualityScore: number;
  readonly reputation: number;
  readonly tasksPassed: number;
  readonly gatesPassed: number;
  readonly invariantsHeld: number;
  readonly credits: number;
  /** Context that must still be unspent, as a 0..1 ratio. */
  readonly contextRemainingRatio: number;
  readonly manifestEntries: number;
}

/** The three ways a mission is lost. */
export type LossKind = 'context-exhaustion' | 'write-conflict-storm' | 'invariant-deadline';

/** One loss condition with the numeric threshold the flow layer evaluates. */
export interface LossCondition {
  readonly kind: LossKind;
  readonly label: string;
  /** What the player is told when this condition fires. */
  readonly detail: string;
  readonly metric: MissionMetric;
  readonly comparator: Comparison;
  readonly threshold: number;
  readonly unit: ThresholdUnit;
  /** `anytime` fires as soon as it is true; `deadline` is judged at the deadline. */
  readonly evaluatedAt: 'anytime' | 'deadline';
}

/** A stable interface or scene address a tutorial step highlights. */
export interface TutorialTarget {
  readonly surface: 'hud' | 'panel' | 'scene';
  /**
   * `[data-hud="..."]` for hud/panel surfaces, or the object name of a scene
   * root (`plan-graph`, `lane-agents`, `quality-constellation`).
   */
  readonly selector: string;
  /** Coach-mark copy naming what the player should look at. */
  readonly label: string;
}

/** What the flow layer waits for before advancing the tutorial. */
export type TutorialAdvance =
  | { readonly kind: 'acknowledge' }
  | { readonly kind: 'objective'; readonly objectiveId: string }
  | {
      readonly kind: 'metric';
      readonly metric: MissionMetric;
      readonly comparator: Comparison;
      readonly target: number;
    }
  | { readonly kind: 'event'; readonly eventType: DomainEventType };

/** One ordered tutorial step. */
export interface TutorialStep {
  readonly id: string;
  /** 1-based position in the mission tutorial. */
  readonly index: number;
  readonly title: string;
  /** What the player does, imperative. */
  readonly instruction: string;
  /** What the step teaches about Coroid. */
  readonly lesson: string;
  readonly targets: readonly TutorialTarget[];
  readonly advanceWhen: TutorialAdvance;
}

/** A verification gate the mission expects on the floor. */
export interface MissionGateSpec {
  readonly id: string;
  readonly name: string;
  readonly checkKind: CheckKind;
  readonly laneKind: LaneKind;
  readonly assertion: string;
  readonly targetFile: string;
  readonly timeoutMs: number;
}

/** A flavour line the mission replays into the event terminal. */
export interface MissionEventLine {
  readonly id: string;
  readonly atMs: number;
  /** Domain event tag the line stands for. */
  readonly source: DomainEventType;
  readonly provenance: ProvenanceKind;
  readonly text: string;
}

/** A claim the mission answers, with the provenance of who made it. */
export interface MissionClaim {
  readonly statement: string;
  readonly authority: ProvenanceKind;
}

/** One mission of the campaign. */
export interface MissionDefinition {
  readonly key: MissionKey;
  /** Stable state identity: `mission-<key>`. */
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly codename: string;
  readonly tagline: string;
  /** Briefing shown when the mission starts. */
  readonly briefing: string;
  /** Objective text written into `mission.objective` when the mission boots. */
  readonly objective: string;
  /** Debrief shown when the mission is delivered. */
  readonly debrief: string;
  /** The distinct concept this mission teaches. */
  readonly teaches: ConceptKey;
  readonly pacing: MissionPacing;
  readonly requiredLaneKinds: readonly LaneKind[];
  readonly gateChecklist: readonly MissionGateSpec[];
  readonly objectives: readonly MissionObjective[];
  readonly win: WinThreshold;
  /** Exactly three conditions: context exhaustion, conflict storm, invariants at deadline. */
  readonly loss: readonly [LossCondition, LossCondition, LossCondition];
  readonly tutorial: readonly TutorialStep[];
  /** Codex entries unlocked up to and including this mission. */
  readonly codex: readonly CodexEntry[];
  /** Topics this mission introduces. */
  readonly unlocks: readonly CodexTopic[];
  readonly eventLog: readonly MissionEventLine[];
  readonly claims: readonly MissionClaim[];
}

/** The three loss conditions in canonical order, shared by every mission. */
export const LOSS_KIND_ORDER: readonly LossKind[] = [
  'context-exhaustion',
  'write-conflict-storm',
  'invariant-deadline',
];

/* -------------------------------------------------------------------------- */
/* Mission specifications                                                     */
/* -------------------------------------------------------------------------- */

interface MissionSpec extends Omit<MissionDefinition, 'id' | 'codex' | 'unlocks'> {
  /** Codex topics this mission unlocks. */
  readonly introduces: readonly CodexTopic[];
}

const MISSION_SPECS: readonly MissionSpec[] = [
  {
    key: 'request-to-plan',
    order: 1,
    title: 'Request to plan',
    codename: 'BLUEPRINT ZERO',
    tagline: 'One sentence in, a layered plan out.',
    briefing:
      'The intake desk hands you a single request: make Coroid feel alive. Nothing on the floor moves until that sentence becomes tasks that can be built and checked. Your first job is decomposition, and the first lesson is that a plan you can verify beats a plan that merely sounds complete.',
    objective:
      'Decompose the intake request into at least six tasks with declared ownership, layered into phases that never depend on later work, and dispatch the first phase.',
    debrief:
      'You have seen the shape of a Coroid mission: a request becomes a plan, the plan becomes dependency layers, and every task carries the evidence it will be judged by.',
    teaches: 'request-to-plan-decomposition',
    introduces: ['request-to-plan-decomposition', 'phases-as-dependency-layers'],
    pacing: {
      order: 1,
      tier: 'orientation',
      seed: 20_260_919,
      planTasks: 6,
      laneLimit: 2,
      contextBudget: 60_000,
      deadlineMs: 5 * 60 * 1000,
      writeOwnershipWindow: 4,
      repairsAllowed: 3,
      startingCredits: 600,
      startingReputation: 40,
      creditRatePerTask: 8,
      unlockAfter: 0,
    },
    requiredLaneKinds: ['discovery', 'build', 'verify', 'integrate'],
    gateChecklist: [
      {
        id: 'gate-brief-typecheck',
        name: 'Brief typecheck',
        checkKind: 'typecheck',
        laneKind: 'verify',
        assertion: 'The intake brief and the plan outline compile with no errors.',
        targetFile: 'src/content/missions.ts',
        timeoutMs: 120_000,
      },
      {
        id: 'gate-brief-build',
        name: 'Brief build',
        checkKind: 'build',
        laneKind: 'integrate',
        assertion: 'The planned first phase builds from a clean checkout.',
        targetFile: 'src/main.ts',
        timeoutMs: 180_000,
      },
      {
        id: 'gate-brief-scope',
        name: 'Brief scope check',
        checkKind: 'test',
        laneKind: 'discovery',
        assertion: 'The intake brief names every constraint the plan claims to answer.',
        targetFile: 'src/content/missions.ts',
        timeoutMs: 120_000,
      },
    ],
    objectives: [
      {
        id: 'obj-m1-brief',
        label: 'Parse the intake request',
        detail: 'Read the request on the objective banner and log it as one decomposable brief.',
        metric: 'intake-briefs-parsed',
        comparator: 'gte',
        target: 1,
        unit: 'count',
        required: true,
        tutorialStepId: 'm1-read-request',
      },
      {
        id: 'obj-m1-tasks',
        label: 'Register six verifiable tasks',
        detail: 'Every task names a lane, a write set and the check that will prove it.',
        metric: 'tasks-registered',
        comparator: 'gte',
        target: 6,
        unit: 'count',
        required: true,
        tutorialStepId: 'm1-decompose',
      },
      {
        id: 'obj-m1-phases',
        label: 'Layer the plan into phases',
        detail: 'Three dependency layers, no task depending on a later phase.',
        metric: 'phases-planned',
        comparator: 'gte',
        target: 3,
        unit: 'count',
        required: false,
        tutorialStepId: 'm1-layer-phases',
      },
      {
        id: 'obj-m1-first-phase',
        label: 'Dispatch the first phase',
        detail: 'Phase one runs to completion before anything downstream is started.',
        metric: 'phases-complete',
        comparator: 'gte',
        target: 1,
        unit: 'count',
        required: true,
        tutorialStepId: 'm1-dispatch',
      },
    ],
    win: {
      requiredObjectiveIds: ['obj-m1-brief', 'obj-m1-tasks', 'obj-m1-first-phase'],
      qualityScore: 0.55,
      reputation: 50,
      tasksPassed: 5,
      gatesPassed: 2,
      invariantsHeld: 1,
      credits: 500,
      contextRemainingRatio: 0.12,
      manifestEntries: 0,
    },
    loss: [
      {
        kind: 'context-exhaustion',
        label: 'Context exhausted',
        detail: 'The intake desk ran out of context while reading the request.',
        metric: 'context-remaining-ratio',
        comparator: 'lte',
        threshold: 0.02,
        unit: 'ratio',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'write-conflict-storm',
        label: 'Conflict storm',
        detail: 'Six concurrent write-ownership conflicts are more than a two-lane floor can settle.',
        metric: 'conflicts-open',
        comparator: 'gte',
        threshold: 6,
        unit: 'count',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'invariant-deadline',
        label: 'Invariants unrepaired at the deadline',
        detail: 'A final invariant was still unsatisfied when the delivery slot closed.',
        metric: 'invariants-at-risk',
        comparator: 'gte',
        threshold: 1,
        unit: 'count',
        evaluatedAt: 'deadline',
      },
    ],
    tutorial: [
      {
        id: 'm1-read-request',
        index: 1,
        title: 'Read the request',
        instruction: 'Read the objective on the banner, then acknowledge it on the terminal.',
        lesson:
          'A mission starts as one sentence from a user. Coroid keeps that sentence visible while the plan is built, because every later claim is judged against it.',
        targets: [
          { surface: 'hud', selector: '[data-hud="banner"]', label: 'Objective banner' },
          { surface: 'hud', selector: '[data-hud="objective"]', label: 'Intake request' },
        ],
        advanceWhen: { kind: 'acknowledge' },
      },
      {
        id: 'm1-open-outline',
        index: 2,
        title: 'Open the plan outline',
        instruction: 'Open the plan outline panel and watch the intake lane claim the first task.',
        lesson:
          'Decomposition is visible work: the outline lists every task the plan will own, and the event terminal records each registration with its provenance tag.',
        targets: [
          { surface: 'panel', selector: '[data-hud="panel-outline"]', label: 'Plan outline panel' },
          { surface: 'panel', selector: '[data-hud="outline-row"]', label: 'Planned task row' },
        ],
        advanceWhen: { kind: 'event', eventType: 'plan/task-registered' },
      },
      {
        id: 'm1-decompose',
        index: 3,
        title: 'Decompose into verifiable tasks',
        instruction: 'Grow the plan to six tasks; each one names the lane it runs on and the files it owns.',
        lesson:
          'A task you cannot verify is a task you have not finished planning. Coroid refuses work without a declared write set because two unnamed lanes will always find the same file.',
        targets: [
          { surface: 'scene', selector: 'plan-graph', label: 'Plan graph nodes' },
          { surface: 'hud', selector: '[data-hud="mission-progress"]', label: 'Plan progress meter' },
        ],
        advanceWhen: { kind: 'metric', metric: 'tasks-registered', comparator: 'gte', target: 6 },
      },
      {
        id: 'm1-layer-phases',
        index: 4,
        title: 'Layer the plan into phases',
        instruction: 'Declare dependencies so the plan resolves into three dependency layers.',
        lesson:
          'Phases are dependency layers. A task may only depend on an earlier phase, so each phase can be dispatched in parallel and nothing waits on work that has not been planned yet.',
        targets: [
          { surface: 'panel', selector: '[data-hud="outline-phase"]', label: 'Phase group' },
          { surface: 'scene', selector: 'plan-graph', label: 'Phase tier platforms' },
        ],
        advanceWhen: { kind: 'metric', metric: 'phases-planned', comparator: 'gte', target: 3 },
      },
      {
        id: 'm1-dispatch',
        index: 5,
        title: 'Dispatch the first phase',
        instruction: 'Release the first phase and watch lane occupancy move off zero.',
        lesson:
          'Plans do not ship; phases do. Dispatching is what turns a plan document into agent work, and the first phase is the only one that can start with no upstream waiting.',
        targets: [
          { surface: 'hud', selector: '[data-hud="event-log"]', label: 'Event terminal' },
          { surface: 'hud', selector: '[data-hud="lane-occupancy"]', label: 'Lane occupancy' },
        ],
        advanceWhen: { kind: 'objective', objectiveId: 'obj-m1-first-phase' },
      },
    ],
    eventLog: [
      {
        id: 'log-m1-request',
        atMs: 0,
        source: 'mission/started',
        provenance: 'user_requirement',
        text: 'Request accepted: make Coroid feel alive. One sentence, six tasks to find.',
      },
      {
        id: 'log-m1-lanes',
        atMs: 900,
        source: 'lane/registered',
        provenance: 'architect_choice',
        text: 'Discovery and build lanes stand up on the floor; the plan decides who waits for whom.',
      },
      {
        id: 'log-m1-deadline',
        atMs: 1_800,
        source: 'economy/deadline',
        provenance: 'user_requirement',
        text: 'Delivery slot opened: five minutes and sixty thousand context tokens.',
      },
      {
        id: 'log-m1-scan',
        atMs: 2_600,
        source: 'quality/measured',
        provenance: 'repository_observation',
        text: 'Repository scan measured six candidate write paths for the first phase.',
      },
    ],
    claims: [
      {
        statement: 'The game must be fun, impressive and specifically describe what coroid.ai is about.',
        authority: 'user_requirement',
      },
      {
        statement: 'The campaign teaches platform concepts rather than simulating a city.',
        authority: 'architect_choice',
      },
      {
        statement: 'The shared domain contract in src/sim/state.ts fixes the slices the plan writes into.',
        authority: 'repository_observation',
      },
    ],
  },

  {
    key: 'parallel-lanes',
    order: 2,
    title: 'Parallel lanes',
    codename: 'LANE STORM',
    tagline: 'Two lanes, one file, no argument.',
    briefing:
      'The plan is layered; now the floor wants to run. Lanes are cheap when they touch different files and expensive when they collide, so this mission puts two tasks on the same phase and asks you to draw the boundary before the conflict storm starts.',
    objective:
      'Run at least three lanes in parallel on a layered plan, declare read and write ownership for every task, and settle every write conflict without stalling work.',
    debrief:
      'Parallelism is a property of ownership, not of enthusiasm. You declared write sets, watched two lanes dispute a path and resolved it as a boundary instead of a race.',
    teaches: 'parallel-agent-lanes',
    introduces: ['read-write-ownership', 'parallel-agent-lanes'],
    pacing: {
      order: 2,
      tier: 'apprentice',
      seed: 20_260_920,
      planTasks: 8,
      laneLimit: 3,
      contextBudget: 75_000,
      deadlineMs: 6 * 60 * 1000,
      writeOwnershipWindow: 3,
      repairsAllowed: 3,
      startingCredits: 900,
      startingReputation: 44,
      creditRatePerTask: 10,
      unlockAfter: 1,
    },
    requiredLaneKinds: ['discovery', 'build', 'integrate', 'verify'],
    gateChecklist: [
      {
        id: 'gate-lanes-typecheck',
        name: 'Ownership typecheck',
        checkKind: 'typecheck',
        laneKind: 'verify',
        assertion: 'Every declared read set and write set typechecks against the ownership map.',
        targetFile: 'src/sim/graph.ts',
        timeoutMs: 120_000,
      },
      {
        id: 'gate-lanes-build',
        name: 'Lane build',
        checkKind: 'build',
        laneKind: 'build',
        assertion: 'Both parallel lanes build from their own write sets without touching each other.',
        targetFile: 'src/render/laneAgents.ts',
        timeoutMs: 180_000,
      },
      {
        id: 'gate-lanes-test',
        name: 'Conflict regression',
        checkKind: 'test',
        laneKind: 'verify',
        assertion: 'A same-phase write overlap is reported as a conflict instead of a corrupted merge.',
        targetFile: 'tests/graph.test.ts',
        timeoutMs: 180_000,
      },
    ],
    objectives: [
      {
        id: 'obj-m2-ownership',
        label: 'Declare ownership everywhere',
        detail: 'Ninety percent of tasks must declare the files they write.',
        metric: 'ownership-coverage-ratio',
        comparator: 'gte',
        target: 0.9,
        unit: 'ratio',
        required: true,
        tutorialStepId: 'm2-declare-ownership',
      },
      {
        id: 'obj-m2-parallel',
        label: 'Run three lanes at once',
        detail: 'Peak concurrency of three running tasks, inside the lane limit.',
        metric: 'lanes-active-peak',
        comparator: 'gte',
        target: 3,
        unit: 'count',
        required: true,
        tutorialStepId: 'm2-dispatch-parallel',
      },
      {
        id: 'obj-m2-conflicts',
        label: 'Settle every write conflict',
        detail: 'No unresolved same-phase write overlap when the mission is judged.',
        metric: 'conflicts-open',
        comparator: 'lte',
        target: 0,
        unit: 'count',
        required: true,
        tutorialStepId: 'm2-boundary',
      },
      {
        id: 'obj-m2-phase',
        label: 'Settle the phase plan',
        detail: 'The layered plan is fully built out and settled.',
        metric: 'tasks-passed',
        comparator: 'gte',
        target: 7,
        unit: 'count',
        required: false,
        tutorialStepId: 'm2-settle-phase',
      },
      {
        id: 'obj-m2-settled-conflicts',
        label: 'Settle conflicts without a stall',
        detail: 'Two write conflicts resolved as ownership decisions rather than lane restarts.',
        metric: 'conflicts-resolved',
        comparator: 'gte',
        target: 2,
        unit: 'count',
        required: false,
        tutorialStepId: 'm2-boundary',
      },
    ],
    win: {
      requiredObjectiveIds: ['obj-m2-ownership', 'obj-m2-parallel', 'obj-m2-conflicts'],
      qualityScore: 0.62,
      reputation: 56,
      tasksPassed: 7,
      gatesPassed: 3,
      invariantsHeld: 2,
      credits: 700,
      contextRemainingRatio: 0.13,
      manifestEntries: 0,
    },
    loss: [
      {
        kind: 'context-exhaustion',
        label: 'Context exhausted',
        detail: 'Three lanes reading the same files burned the context budget before the phase settled.',
        metric: 'context-remaining-ratio',
        comparator: 'lte',
        threshold: 0.03,
        unit: 'ratio',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'write-conflict-storm',
        label: 'Conflict storm',
        detail: 'Five same-phase write conflicts at once means ownership was never declared.',
        metric: 'conflicts-open',
        comparator: 'gte',
        threshold: 5,
        unit: 'count',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'invariant-deadline',
        label: 'Invariants unrepaired at the deadline',
        detail: 'A final invariant was still unsatisfied when the delivery slot closed.',
        metric: 'invariants-at-risk',
        comparator: 'gte',
        threshold: 1,
        unit: 'count',
        evaluatedAt: 'deadline',
      },
    ],
    tutorial: [
      {
        id: 'm2-read-occupancy',
        index: 1,
        title: 'Read lane occupancy',
        instruction: 'Open the overlay and read how many lanes are busy before you dispatch anything.',
        lesson:
          'A lane is a queue with a capacity. Occupancy tells you whether the floor is working or stacked up, and it is the number you push on when a phase is late.',
        targets: [
          { surface: 'hud', selector: '[data-hud="lane-occupancy"]', label: 'Lane occupancy strip' },
          { surface: 'hud', selector: '[data-hud="lane"]', label: 'Individual lane chip' },
        ],
        advanceWhen: { kind: 'metric', metric: 'lanes-active-peak', comparator: 'gte', target: 2 },
      },
      {
        id: 'm2-declare-ownership',
        index: 2,
        title: 'Declare read and write ownership',
        instruction: 'Open the task inspector and give every task a read set and an exclusive write set.',
        lesson:
          'Write sets are exclusive, read sets are shared. Declaring both is what lets Coroid run lanes in parallel without merging two halves of the same file.',
        targets: [
          { surface: 'panel', selector: '[data-hud="panel-inspector"]', label: 'Task inspector' },
          { surface: 'panel', selector: '[data-hud="inspector-writeset"]', label: 'Declared write set' },
          { surface: 'scene', selector: 'plan-graph', label: 'Plan graph nodes' },
        ],
        advanceWhen: {
          kind: 'metric',
          metric: 'ownership-coverage-ratio',
          comparator: 'gte',
          target: 0.9,
        },
      },
      {
        id: 'm2-dispatch-parallel',
        index: 3,
        title: 'Dispatch three lanes in parallel',
        instruction: 'Start three tasks on the same phase and watch the occupancy strip move.',
        lesson:
          'Parallel lanes are why Coroid is fast. The lane limit caps concurrency so the floor stays schedulable instead of thrashing.',
        targets: [
          { surface: 'hud', selector: '[data-hud="lane"]', label: 'Lane chips' },
          { surface: 'hud', selector: '[data-hud="lane-occupancy"]', label: 'Lane occupancy strip' },
        ],
        advanceWhen: { kind: 'metric', metric: 'lanes-active-peak', comparator: 'gte', target: 3 },
      },
      {
        id: 'm2-boundary',
        index: 4,
        title: 'Draw the conflict boundary',
        instruction: 'When two tasks claim the same path, reassign one of them and log the boundary.',
        lesson:
          'A write conflict is not a bug in the lane; it is a missing decision in the plan. Coroid reports it in the event terminal naming both tasks and every shared path.',
        targets: [
          { surface: 'hud', selector: '[data-hud="event-log"]', label: 'Event terminal' },
          { surface: 'scene', selector: 'lane-agents', label: 'Lane comet traffic' },
        ],
        advanceWhen: { kind: 'metric', metric: 'conflicts-open', comparator: 'lte', target: 0 },
      },
      {
        id: 'm2-settle-phase',
        index: 5,
        title: 'Settle the phase',
        instruction: 'Keep the lanes busy until the phase plan is fully settled.',
        lesson:
          'Settled work is the only work that counts. A phase is done when every task in it is passed, not when every lane looks busy.',
        targets: [
          { surface: 'panel', selector: '[data-hud="outline-phase"]', label: 'Phase group' },
          { surface: 'hud', selector: '[data-hud="mission-progress"]', label: 'Plan progress meter' },
        ],
        advanceWhen: { kind: 'objective', objectiveId: 'obj-m2-phase' },
      },
    ],
    eventLog: [
      {
        id: 'log-m2-request',
        atMs: 0,
        source: 'mission/started',
        provenance: 'user_requirement',
        text: 'Request: run the plan in parallel lanes without either lane breaking the other.',
      },
      {
        id: 'log-m2-register',
        atMs: 900,
        source: 'lane/registered',
        provenance: 'architect_choice',
        text: 'Three lanes online: build, integrate and verify, each with its own capacity.',
      },
      {
        id: 'log-m2-assign',
        atMs: 1_400,
        source: 'lane/assigned',
        provenance: 'architect_choice',
        text: 'Two tasks dispatched onto the same phase; write sets do not overlap, so both run.',
      },
      {
        id: 'log-m2-collide',
        atMs: 3_200,
        source: 'quality/finding',
        provenance: 'repository_observation',
        text: 'Same-phase write overlap found on one path; the plan reassigns it to the later lane.',
      },
    ],
    claims: [
      {
        statement: 'The game must look and feel impressive while staying legible at a glance.',
        authority: 'user_requirement',
      },
      {
        statement: 'Lane capacity and concurrency limits are content, so missions can tighten them.',
        authority: 'architect_choice',
      },
      {
        statement: 'Same-phase write overlaps are already detected by the dependency graph module.',
        authority: 'repository_observation',
      },
    ],
  },

  {
    key: 'verification-gates',
    order: 3,
    title: 'Verification gates',
    codename: 'GATEKEEPER',
    tagline: 'Nothing ships on a hunch.',
    briefing:
      'The lanes produced code; now prove it. Gates are the only thing standing between a busy floor and a shipped product, and every gate needs a check, a written assertion and a repair path. Your lesson here is that failing fast is cheaper than trusting fast.',
    objective:
      'Attach all four check kinds to the plan, turn eleven checks green, close two repair objectives in place and land every gate before delivery.',
    debrief:
      'You saw how Coroid proves work: checks first, repair objectives instead of restarts, and a gate that stays red until the specific failing check goes green.',
    teaches: 'verification-checks',
    introduces: ['verification-checks'],
    pacing: {
      order: 3,
      tier: 'journeyman',
      seed: 20_260_921,
      planTasks: 11,
      laneLimit: 4,
      contextBudget: 95_000,
      deadlineMs: 7 * 60 * 1000,
      writeOwnershipWindow: 3,
      repairsAllowed: 2,
      startingCredits: 1_200,
      startingReputation: 48,
      creditRatePerTask: 12,
      unlockAfter: 2,
    },
    requiredLaneKinds: ['build', 'verify', 'integrate', 'observe'],
    gateChecklist: [
      {
        id: 'gate-gates-typecheck',
        name: 'Typecheck',
        checkKind: 'typecheck',
        laneKind: 'verify',
        assertion: 'The whole factory compiles with no type errors before any gate is trusted.',
        targetFile: 'src/sim/verification.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-gates-build',
        name: 'Production build',
        checkKind: 'build',
        laneKind: 'integrate',
        assertion: 'The production bundle builds clean and boots the floor shell.',
        targetFile: 'vite.config.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-gates-test',
        name: 'Verification tests',
        checkKind: 'test',
        laneKind: 'verify',
        assertion: 'Failing checks block dependents and open exactly one repair objective.',
        targetFile: 'tests/verification.test.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-gates-composition',
        name: 'Composition probe',
        checkKind: 'composition',
        laneKind: 'observe',
        assertion: 'The assembled application boots in a browser and the floor updates without errors.',
        targetFile: 'dev-preview/harness.ts',
        timeoutMs: 300_000,
      },
    ],
    objectives: [
      {
        id: 'obj-m3-checks',
        label: 'Declare all four check kinds',
        detail: 'Build, typecheck, test and composition each appear at least once.',
        metric: 'checks-declared',
        comparator: 'gte',
        target: 4,
        unit: 'count',
        required: true,
        tutorialStepId: 'm3-declare-checks',
      },
      {
        id: 'obj-m3-green',
        label: 'Turn eleven checks green',
        detail: 'Every declared check reports passed before the manifest is assembled.',
        metric: 'checks-green',
        comparator: 'gte',
        target: 11,
        unit: 'count',
        required: false,
        tutorialStepId: 'm3-green',
      },
      {
        id: 'obj-m3-gates',
        label: 'Land every gate',
        detail: 'All four verification gates settle green.',
        metric: 'gates-passed',
        comparator: 'gte',
        target: 4,
        unit: 'count',
        required: true,
        tutorialStepId: 'm3-green',
      },
      {
        id: 'obj-m3-repairs',
        label: 'Repair failures in place',
        detail: 'Two failing checks closed by repairing the task instead of restarting it.',
        metric: 'failures-repaired',
        comparator: 'gte',
        target: 2,
        unit: 'count',
        required: true,
        tutorialStepId: 'm3-repair',
      },
    ],
    win: {
      requiredObjectiveIds: ['obj-m3-checks', 'obj-m3-gates', 'obj-m3-repairs'],
      qualityScore: 0.68,
      reputation: 62,
      tasksPassed: 10,
      gatesPassed: 4,
      invariantsHeld: 3,
      credits: 900,
      contextRemainingRatio: 0.14,
      manifestEntries: 0,
    },
    loss: [
      {
        kind: 'context-exhaustion',
        label: 'Context exhausted',
        detail: 'Re-running gates without repairing exhausted the context budget.',
        metric: 'context-remaining-ratio',
        comparator: 'lte',
        threshold: 0.04,
        unit: 'ratio',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'write-conflict-storm',
        label: 'Conflict storm',
        detail: 'Four simultaneous repair tasks rewriting the same paths is a conflict storm.',
        metric: 'conflicts-open',
        comparator: 'gte',
        threshold: 4,
        unit: 'count',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'invariant-deadline',
        label: 'Invariants unrepaired at the deadline',
        detail: 'A final invariant was still unsatisfied when the delivery slot closed.',
        metric: 'invariants-at-risk',
        comparator: 'gte',
        threshold: 1,
        unit: 'count',
        evaluatedAt: 'deadline',
      },
    ],
    tutorial: [
      {
        id: 'm3-declare-checks',
        index: 1,
        title: 'Attach the four check kinds',
        instruction: 'In the inspector, give each task the checks that will prove it.',
        lesson:
          'Coroid recognises four check kinds: build, typecheck, test and composition. A gate is only as strong as the checks declared underneath it, and every check names the file a repair would touch.',
        targets: [
          { surface: 'panel', selector: '[data-hud="panel-inspector"]', label: 'Task inspector' },
          { surface: 'panel', selector: '[data-hud="check-kind"]', label: 'Declared check kind' },
          { surface: 'panel', selector: '[data-hud="inspector-check"]', label: 'Declared check' },
        ],
        advanceWhen: { kind: 'metric', metric: 'checks-declared', comparator: 'gte', target: 4 },
      },
      {
        id: 'm3-open-report',
        index: 2,
        title: 'Open the verification report',
        instruction: 'Open the verification report and start the gates.',
        lesson:
          'The report lists every gate with its lane, coverage and attempt count. Running a gate is a domain event like any other, so a failure is visible on the floor the moment it happens.',
        targets: [
          { surface: 'panel', selector: '[data-hud="panel-report"]', label: 'Verification report' },
          { surface: 'panel', selector: '[data-hud="report-gate"]', label: 'Gate card' },
        ],
        advanceWhen: { kind: 'event', eventType: 'verification/run' },
      },
      {
        id: 'm3-read-failure',
        index: 3,
        title: 'Read the failure',
        instruction: 'Watch the failing gate in the terminal and read what its check asserted.',
        lesson:
          'A failed check keeps every dependent task blocked. That is the point: blocked dependents stop the floor from building on work that was never proven.',
        targets: [
          { surface: 'panel', selector: '[data-hud="report-gate"]', label: 'Failing gate card' },
          { surface: 'hud', selector: '[data-hud="event-log"]', label: 'Event terminal' },
        ],
        advanceWhen: { kind: 'metric', metric: 'gates-passed', comparator: 'lte', target: 3 },
      },
      {
        id: 'm3-repair',
        index: 4,
        title: 'Close the repair objective',
        instruction: 'Repair the offending file and re-run the check until the objective closes.',
        lesson:
          'A repair objective cites the check id and its target file, and it reopens rather than duplicates if the check regresses. Restarting the task is never the cheaper answer here.',
        targets: [
          { surface: 'panel', selector: '[data-hud="report-finding"]', label: 'Open finding' },
          { surface: 'hud', selector: '[data-hud="event-log"]', label: 'Event terminal' },
        ],
        advanceWhen: { kind: 'metric', metric: 'failures-repaired', comparator: 'gte', target: 2 },
      },
      {
        id: 'm3-green',
        index: 5,
        title: 'Land every gate green',
        instruction: 'Keep repairing until all four gates report passed.',
        lesson:
          'Green gates are the difference between a busy floor and a trustworthy one. Only then does the work become eligible for the delivery manifest.',
        targets: [
          { surface: 'panel', selector: '[data-hud="panel-report"]', label: 'Verification report' },
          { surface: 'hud', selector: '[data-hud="invariants"]', label: 'Final invariants readout' },
        ],
        advanceWhen: { kind: 'objective', objectiveId: 'obj-m3-gates' },
      },
    ],
    eventLog: [
      {
        id: 'log-m3-checks',
        atMs: 0,
        source: 'mission/started',
        provenance: 'user_requirement',
        text: 'Every task must declare its checks before its lane may pick it up.',
      },
      {
        id: 'log-m3-register',
        atMs: 1_200,
        source: 'verification/gate-registered',
        provenance: 'architect_choice',
        text: 'Four gates registered: typecheck, build, test and composition probe.',
      },
      {
        id: 'log-m3-run',
        atMs: 4_600,
        source: 'verification/run',
        provenance: 'repository_observation',
        text: 'Composition probe failed on the assembled build; dependents stay blocked.',
      },
      {
        id: 'log-m3-cost',
        atMs: 7_200,
        source: 'economy/spend',
        provenance: 'repository_observation',
        text: 'Gate reruns spent 9,800 context tokens; repairs are cheaper than repetition.',
      },
    ],
    claims: [
      {
        statement: 'The game must show how work is proven, not only how it is produced.',
        authority: 'user_requirement',
      },
      {
        statement: 'Repair objectives reopen instead of duplicating when a check regresses.',
        authority: 'architect_choice',
      },
      {
        statement: 'The verification module defines the four check kinds and the evidence strengths.',
        authority: 'repository_observation',
      },
    ],
  },

  {
    key: 'quality-graph',
    order: 4,
    title: 'The quality graph',
    codename: 'CONSTELLATION',
    tagline: 'A score you can argue with.',
    briefing:
      'Green gates mean the work runs; the quality graph says whether it is good. Every metric is measured against a target, every finding is resolved or carried, and every criterion has a lifecycle. Promote what must hold, supersede what you replaced, and let the constellation argue your release.',
    objective:
      'Measure five metrics into the constellation, promote three criteria to final invariants, supersede two replaced criteria and lift the weighted score to 0.74 before releasing.',
    debrief:
      'You promoted milestones into final invariants, superseded what they replaced and read a weighted score instead of a single number. That is the release argument Coroid expects.',
    teaches: 'quality-graph',
    introduces: ['criterion-lifecycles', 'quality-graph'],
    pacing: {
      order: 4,
      tier: 'architect',
      seed: 20_260_922,
      planTasks: 14,
      laneLimit: 6,
      contextBudget: 110_000,
      deadlineMs: 8 * 60 * 1000,
      writeOwnershipWindow: 2,
      repairsAllowed: 2,
      startingCredits: 1_500,
      startingReputation: 52,
      creditRatePerTask: 14,
      unlockAfter: 3,
    },
    requiredLaneKinds: ['build', 'verify', 'observe'],
    gateChecklist: [
      {
        id: 'gate-quality-typecheck',
        name: 'Quality typecheck',
        checkKind: 'typecheck',
        laneKind: 'verify',
        assertion: 'Metric, finding and criterion data typecheck against the quality contract.',
        targetFile: 'src/render/qualityGraph.ts',
        timeoutMs: 240_000,
      },
      {
        id: 'gate-quality-test',
        name: 'Scoring tests',
        checkKind: 'test',
        laneKind: 'verify',
        assertion: 'A weighted score never hides a failing invariant, and supersession keeps order.',
        targetFile: 'tests/verification.test.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-quality-build',
        name: 'Constellation build',
        checkKind: 'build',
        laneKind: 'build',
        assertion: 'The quality constellation builds and renders from measured metrics.',
        targetFile: 'src/render/qualityGraph.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-quality-composition',
        name: 'Release composition',
        checkKind: 'composition',
        laneKind: 'observe',
        assertion: 'The assembled application shows the constellation holding its invariants.',
        targetFile: 'dev-preview/harness.ts',
        timeoutMs: 300_000,
      },
    ],
    objectives: [
      {
        id: 'obj-m4-metrics',
        label: 'Measure the quality graph',
        detail: 'Five metrics measured against their targets and plotted in the constellation.',
        metric: 'metrics-measured',
        comparator: 'gte',
        target: 5,
        unit: 'count',
        required: true,
        tutorialStepId: 'm4-open-constellation',
      },
      {
        id: 'obj-m4-invariants',
        label: 'Promote three final invariants',
        detail: 'Three criteria graduated from milestone to final_invariant.',
        metric: 'invariants-held',
        comparator: 'gte',
        target: 3,
        unit: 'count',
        required: true,
        tutorialStepId: 'm4-promote',
      },
      {
        id: 'obj-m4-superseded',
        label: 'Supersede two replaced criteria',
        detail: 'Criteria that a successor replaced are marked superseded, not deleted.',
        metric: 'criteria-superseded',
        comparator: 'gte',
        target: 2,
        unit: 'count',
        required: true,
        tutorialStepId: 'm4-supersede',
      },
      {
        id: 'obj-m4-score',
        label: 'Reach the release score',
        detail: 'Weighted quality score of 0.74 or better.',
        metric: 'quality-score',
        comparator: 'gte',
        target: 0.74,
        unit: 'ratio',
        required: true,
        tutorialStepId: 'm4-release-score',
      },
    ],
    win: {
      requiredObjectiveIds: [
        'obj-m4-metrics',
        'obj-m4-invariants',
        'obj-m4-superseded',
        'obj-m4-score',
      ],
      qualityScore: 0.74,
      reputation: 68,
      tasksPassed: 13,
      gatesPassed: 4,
      invariantsHeld: 3,
      credits: 1_100,
      contextRemainingRatio: 0.14,
      manifestEntries: 0,
    },
    loss: [
      {
        kind: 'context-exhaustion',
        label: 'Context exhausted',
        detail: 'Measuring every metric by hand left no context for the release argument.',
        metric: 'context-remaining-ratio',
        comparator: 'lte',
        threshold: 0.05,
        unit: 'ratio',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'write-conflict-storm',
        label: 'Conflict storm',
        detail: 'Three open write conflicts while the constellation is being re-measured.',
        metric: 'conflicts-open',
        comparator: 'gte',
        threshold: 3,
        unit: 'count',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'invariant-deadline',
        label: 'Invariants unrepaired at the deadline',
        detail: 'A final invariant was still unsatisfied when the delivery slot closed.',
        metric: 'invariants-at-risk',
        comparator: 'gte',
        threshold: 1,
        unit: 'count',
        evaluatedAt: 'deadline',
      },
    ],
    tutorial: [
      {
        id: 'm4-open-constellation',
        index: 1,
        title: 'Open the quality constellation',
        instruction: 'Open the quality graph and plot the metrics the floor has measured.',
        lesson:
          'The quality graph is a constellation of measured metrics. Each star is a value against its target, which is why a single perfect metric can never carry the release on its own.',
        targets: [
          { surface: 'scene', selector: 'quality-constellation', label: 'Quality constellation' },
          { surface: 'panel', selector: '[data-hud="panel-report"]', label: 'Verification and quality report' },
        ],
        advanceWhen: { kind: 'metric', metric: 'metrics-measured', comparator: 'gte', target: 5 },
      },
      {
        id: 'm4-read-targets',
        index: 2,
        title: 'Read value against target',
        instruction: 'Read each metric card and note which one is short of its target.',
        lesson:
          'Every metric has a target and a weight. The score is the weighted average of value over target, so a low-weight metric can never offset a failing invariant.',
        targets: [
          { surface: 'panel', selector: '[data-hud="report-metric"]', label: 'Metric card' },
          { surface: 'panel', selector: '[data-hud="metric-state"]', label: 'Metric state chip' },
        ],
        advanceWhen: { kind: 'metric', metric: 'quality-score', comparator: 'gte', target: 0.5 },
      },
      {
        id: 'm4-promote',
        index: 3,
        title: 'Promote a criterion to a final invariant',
        instruction: 'In the inspector, promote the criteria that must hold at delivery.',
        lesson:
          'A criterion starts as a milestone and graduates to final_invariant when the release depends on it. Only satisfied final invariants count at delivery, so promoting one is a promise you have to keep.',
        targets: [
          { surface: 'panel', selector: '[data-hud="inspector-criterion"]', label: 'Criterion row' },
          { surface: 'panel', selector: '[data-hud="criterion-lifecycle"]', label: 'Lifecycle chip' },
        ],
        advanceWhen: { kind: 'metric', metric: 'invariants-held', comparator: 'gte', target: 3 },
      },
      {
        id: 'm4-supersede',
        index: 4,
        title: 'Supersede what you replaced',
        instruction: 'Supersede the criteria a successor took over, keeping their provenance visible.',
        lesson:
          'Superseding needs a replacement criterion with its own key inside the same task. The old criterion stays in the constellation, dimmed, so the history of the release stays readable.',
        targets: [
          { surface: 'panel', selector: '[data-hud="criterion-lifecycle"]', label: 'Lifecycle chip' },
          { surface: 'panel', selector: '[data-hud="criterion-provenance"]', label: 'Criterion provenance chip' },
        ],
        advanceWhen: { kind: 'metric', metric: 'criteria-superseded', comparator: 'gte', target: 2 },
      },
      {
        id: 'm4-release-score',
        index: 5,
        title: 'Hold the release score',
        instruction: 'Lift the weighted score to 0.74 with every final invariant still holding.',
        lesson:
          'A release is a claim you can defend: a score you can argue with, invariants you can point at, and findings you chose to carry rather than hide.',
        targets: [
          { surface: 'scene', selector: 'quality-constellation', label: 'Quality constellation' },
          { surface: 'hud', selector: '[data-hud="invariants"]', label: 'Final invariants readout' },
        ],
        advanceWhen: { kind: 'objective', objectiveId: 'obj-m4-score' },
      },
    ],
    eventLog: [
      {
        id: 'log-m4-request',
        atMs: 0,
        source: 'mission/started',
        provenance: 'user_requirement',
        text: 'Request: prove quality rather than asserting it. The graph has to argue the release.',
      },
      {
        id: 'log-m4-measure',
        atMs: 1_600,
        source: 'quality/measured',
        provenance: 'repository_observation',
        text: 'Five metrics measured against their targets; the constellation is live.',
      },
      {
        id: 'log-m4-promote',
        atMs: 3_400,
        source: 'mission/status',
        provenance: 'architect_choice',
        text: 'Three milestones promoted to final invariants; two replaced criteria superseded.',
      },
    ],
    claims: [
      {
        statement: 'The game must prove quality rather than assert it.',
        authority: 'user_requirement',
      },
      {
        statement: 'Criterion lifecycles are milestone, final_invariant and superseded.',
        authority: 'architect_choice',
      },
      {
        statement: 'The quality constellation module weights criteria by their declared weight.',
        authority: 'repository_observation',
      },
    ],
  },

  {
    key: 'context-budget',
    order: 5,
    title: 'The context budget',
    codename: 'TOKEN PRESSURE',
    tagline: 'Attention is the scarcest resource on the floor.',
    briefing:
      'Every agent reads into a fixed context budget, and this mission makes that budget bite: seventeen tasks, nine minutes and one hundred and thirty thousand tokens. Batch your reads, keep the lanes busy, bank the credits and finish with context still in the tank.',
    objective:
      'Ship seventeen tasks with the lanes continuously busy, keep at least 14% of the context budget unspent and 1300 credits banked, and deliver before the clock runs out.',
    debrief:
      'You spent tokens deliberately: batched reads, continuous lane occupancy and repairs only where they bought verified work. Context, not code, was the constraint you managed.',
    teaches: 'context-budget',
    introduces: ['context-budget'],
    pacing: {
      order: 5,
      tier: 'chief',
      seed: 20_260_923,
      planTasks: 17,
      laneLimit: 8,
      contextBudget: 130_000,
      deadlineMs: 9 * 60 * 1000,
      writeOwnershipWindow: 2,
      repairsAllowed: 1,
      startingCredits: 1_800,
      startingReputation: 56,
      creditRatePerTask: 16,
      unlockAfter: 4,
    },
    requiredLaneKinds: ['build', 'verify', 'observe'],
    gateChecklist: [
      {
        id: 'gate-budget-typecheck',
        name: 'Budget typecheck',
        checkKind: 'typecheck',
        laneKind: 'verify',
        assertion: 'The budget, credit and reputation readings typecheck against the economy slice.',
        targetFile: 'src/ui/hud.ts',
        timeoutMs: 240_000,
      },
      {
        id: 'gate-budget-build',
        name: 'Budget build',
        checkKind: 'build',
        laneKind: 'build',
        assertion: 'The floor builds while the context meter is below the depletion threshold.',
        targetFile: 'src/game/loop.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-budget-test',
        name: 'Spend accounting',
        checkKind: 'test',
        laneKind: 'verify',
        assertion: 'Every token spent is accounted for and derived rates never drift from the slices.',
        targetFile: 'tests/state.test.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-budget-composition',
        name: 'Batched-read composition',
        checkKind: 'composition',
        laneKind: 'observe',
        assertion: 'The assembled application runs a plan inside its budget under live play.',
        targetFile: 'dev-preview/harness.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-budget-reward',
        name: 'Credit reward',
        checkKind: 'test',
        laneKind: 'observe',
        assertion: 'Credits are earned per running task and banked against the delivery.',
        targetFile: 'tests/state.test.ts',
        timeoutMs: 300_000,
      },
    ],
    objectives: [
      {
        id: 'obj-m5-context',
        label: 'Deliver inside the context budget',
        detail: 'At least 14% of the context budget still unspent at delivery.',
        metric: 'context-remaining-ratio',
        comparator: 'gte',
        target: 0.14,
        unit: 'ratio',
        required: true,
        tutorialStepId: 'm5-watch-budget',
      },
      {
        id: 'obj-m5-throughput',
        label: 'Keep the lanes busy',
        detail: 'Sixteen tasks settled while concurrency stays near the lane limit.',
        metric: 'tasks-passed',
        comparator: 'gte',
        target: 16,
        unit: 'count',
        required: true,
        tutorialStepId: 'm5-batch-reads',
      },
      {
        id: 'obj-m5-credits',
        label: 'Bank the credits',
        detail: 'Thirteen hundred credits left in the vault when the manifest is handed over.',
        metric: 'credits',
        comparator: 'gte',
        target: 1_300,
        unit: 'credits',
        required: true,
        tutorialStepId: 'm5-bank-credits',
      },
      {
        id: 'obj-m5-clock',
        label: 'Beat the clock',
        detail: 'Eight percent of the delivery window still on the clock at handover.',
        metric: 'deadline-remaining-ratio',
        comparator: 'gte',
        target: 0.08,
        unit: 'ratio',
        required: true,
        tutorialStepId: 'm5-watch-clock',
      },
    ],
    win: {
      requiredObjectiveIds: [
        'obj-m5-context',
        'obj-m5-throughput',
        'obj-m5-credits',
        'obj-m5-clock',
      ],
      qualityScore: 0.8,
      reputation: 74,
      tasksPassed: 16,
      gatesPassed: 5,
      invariantsHeld: 4,
      credits: 1_300,
      contextRemainingRatio: 0.14,
      manifestEntries: 0,
    },
    loss: [
      {
        kind: 'context-exhaustion',
        label: 'Context exhausted',
        detail: 'The floor ran out of context mid-phase; agents stopped holding their tasks.',
        metric: 'context-remaining-ratio',
        comparator: 'lte',
        threshold: 0.06,
        unit: 'ratio',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'write-conflict-storm',
        label: 'Conflict storm',
        detail: 'Two open write conflicts already stall a floor running this many lanes.',
        metric: 'conflicts-open',
        comparator: 'gte',
        threshold: 2,
        unit: 'count',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'invariant-deadline',
        label: 'Invariants unrepaired at the deadline',
        detail: 'A final invariant was still unsatisfied when the delivery slot closed.',
        metric: 'invariants-at-risk',
        comparator: 'gte',
        threshold: 1,
        unit: 'count',
        evaluatedAt: 'deadline',
      },
    ],
    tutorial: [
      {
        id: 'm5-watch-budget',
        index: 1,
        title: 'Watch the context meter',
        instruction: 'Watch the context readout while the lanes read their first files.',
        lesson:
          'The context budget is the mission attention budget. It depletes as agents read, plan and repair, and when it hits the floor the mission is lost even if every task was half done.',
        targets: [
          { surface: 'hud', selector: '[data-hud="budget"]', label: 'Context budget readout' },
          { surface: 'hud', selector: '[data-hud="clock"]', label: 'Sim clock' },
        ],
        advanceWhen: {
          kind: 'metric',
          metric: 'context-remaining-ratio',
          comparator: 'gte',
          target: 0.5,
        },
      },
      {
        id: 'm5-batch-reads',
        index: 2,
        title: 'Batch reads per lane',
        instruction: 'Give each lane one batched read instead of five small ones and raise occupancy.',
        lesson:
          'Wide repeated reads are the fastest way to burn a budget. Coroid rewards lanes that read once, write once and keep moving, which is why occupancy and context spend are read together.',
        targets: [
          { surface: 'hud', selector: '[data-hud="lane-occupancy"]', label: 'Lane occupancy strip' },
          { surface: 'scene', selector: 'plan-graph', label: 'Plan graph nodes' },
        ],
        advanceWhen: { kind: 'metric', metric: 'lanes-active-peak', comparator: 'gte', target: 4 },
      },
      {
        id: 'm5-bank-credits',
        index: 3,
        title: 'Bank the credits',
        instruction: 'Keep running tasks paid and let the vault fill before delivery.',
        lesson:
          'Credits are earned per running task per second. Idle lanes are not free: they cost the reputation you need for the next mission and the credits you need to finish this one.',
        targets: [
          { surface: 'hud', selector: '[data-hud="credits"]', label: 'Credits readout' },
          { surface: 'hud', selector: '[data-hud="reputation"]', label: 'Reputation meter' },
        ],
        advanceWhen: { kind: 'metric', metric: 'credits', comparator: 'gte', target: 900 },
      },
      {
        id: 'm5-watch-clock',
        index: 4,
        title: 'Watch the clock',
        instruction: 'Read the clock against plan progress and cut scope, not lanes, when time runs short.',
        lesson:
          'The deadline is part of the content, not a timer bolted on. Later missions plan more work into less time per task, so pacing is a decision you make early.',
        targets: [
          { surface: 'hud', selector: '[data-hud="clock"]', label: 'Sim clock' },
          { surface: 'hud', selector: '[data-hud="mission-progress"]', label: 'Plan progress meter' },
        ],
        advanceWhen: {
          kind: 'metric',
          metric: 'deadline-remaining-ratio',
          comparator: 'lte',
          target: 0.5,
        },
      },
      {
        id: 'm5-deliver-thrifty',
        index: 5,
        title: 'Deliver thrifty',
        instruction: 'Hand over with context and credits still in hand, so the next mission starts solvent.',
        lesson:
          'Coroid carries context and reputation between missions. Finishing with margin is how a campaign stays playable instead of ending in a repair debt.',
        targets: [
          { surface: 'hud', selector: '[data-hud="budget"]', label: 'Context budget readout' },
          { surface: 'hud', selector: '[data-hud="invariants"]', label: 'Final invariants readout' },
        ],
        advanceWhen: { kind: 'objective', objectiveId: 'obj-m5-context' },
      },
    ],
    eventLog: [
      {
        id: 'log-m5-deadline',
        atMs: 0,
        source: 'economy/deadline',
        provenance: 'user_requirement',
        text: 'Thirteen hundred thousand tokens for seventeen tasks: nine minutes, no extensions.',
      },
      {
        id: 'log-m5-dispatch',
        atMs: 1_300,
        source: 'lane/assigned',
        provenance: 'architect_choice',
        text: 'Eight tasks dispatched at once, one batched read each.',
      },
      {
        id: 'log-m5-spend',
        atMs: 5_400,
        source: 'economy/spend',
        provenance: 'repository_observation',
        text: 'Context spend crossed half the budget while two lanes were still queued.',
      },
      {
        id: 'log-m5-reward',
        atMs: 7_100,
        source: 'economy/reward',
        provenance: 'repository_observation',
        text: 'Credits banked for every running task; the vault outpaces the burn rate.',
      },
    ],
    claims: [
      {
        statement: 'The game must stay playable inside a real attention and token budget.',
        authority: 'user_requirement',
      },
      {
        statement: 'Budgets, lane limits and deadlines are content so missions can tighten them.',
        authority: 'architect_choice',
      },
      {
        statement: 'Context spend and credit rate are derived in the shared state reducer.',
        authority: 'repository_observation',
      },
    ],
  },

  {
    key: 'delivery-manifest',
    order: 6,
    title: 'The delivery manifest',
    codename: 'LAST MILE',
    tagline: 'Ship the receipts, not the promises.',
    briefing:
      'Twenty tasks, six gates, five final invariants and ten minutes: the last mission asks for the manifest. Every delivered claim needs a task, a check and a provenance tag, because the manifest is what Coroid actually hands over when the floor goes quiet.',
    objective:
      'Assemble a manifest of twenty evidence-backed entries with full provenance coverage, five final invariants holding and every gate green, delivered before the deadline.',
    debrief:
      'You delivered a manifest rather than an opinion: tasks, checks, criteria, provenance tags and cost, all auditable. That is what Coroid ships.',
    teaches: 'delivery-manifest',
    introduces: ['delivery-manifest'],
    pacing: {
      order: 6,
      tier: 'master',
      seed: 20_260_924,
      planTasks: 20,
      laneLimit: 10,
      contextBudget: 145_000,
      deadlineMs: 10 * 60 * 1000,
      writeOwnershipWindow: 1,
      repairsAllowed: 1,
      startingCredits: 2_000,
      startingReputation: 60,
      creditRatePerTask: 18,
      unlockAfter: 5,
    },
    requiredLaneKinds: ['build', 'verify', 'integrate', 'observe'],
    gateChecklist: [
      {
        id: 'gate-manifest-typecheck',
        name: 'Manifest typecheck',
        checkKind: 'typecheck',
        laneKind: 'verify',
        assertion: 'Every manifest entry typechecks against the task, check and criterion contracts.',
        targetFile: 'src/content/missions.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-manifest-build',
        name: 'Release build',
        checkKind: 'build',
        laneKind: 'integrate',
        assertion: 'The release bundle builds and the floor boots from a clean checkout.',
        targetFile: 'vite.config.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-manifest-test',
        name: 'Manifest tests',
        checkKind: 'test',
        laneKind: 'verify',
        assertion: 'Every manifest entry resolves to a task and to a check that actually ran.',
        targetFile: 'tests/missions.test.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-manifest-composition',
        name: 'Delivery composition',
        checkKind: 'composition',
        laneKind: 'observe',
        assertion: 'The assembled application boots, reports the manifest and holds the invariants.',
        targetFile: 'dev-preview/harness.ts',
        timeoutMs: 300_000,
      },
      {
        id: 'gate-manifest-provenance',
        name: 'Provenance coverage',
        checkKind: 'test',
        laneKind: 'observe',
        assertion: 'Every manifest line carries a provenance tag from the brief, the repo or the plan.',
        targetFile: 'src/ui/hud.ts',
        timeoutMs: 240_000,
      },
      {
        id: 'gate-manifest-signoff',
        name: 'Delivery sign-off',
        checkKind: 'composition',
        laneKind: 'integrate',
        assertion: 'The delivery gate accepts the manifest with every criterion satisfied.',
        targetFile: 'src/sim/verification.ts',
        timeoutMs: 300_000,
      },
    ],
    objectives: [
      {
        id: 'obj-m6-manifest',
        label: 'Assemble the delivery manifest',
        detail: 'Twenty entries, each naming its task and the evidence behind it.',
        metric: 'manifest-entries',
        comparator: 'gte',
        target: 20,
        unit: 'count',
        required: true,
        tutorialStepId: 'm6-collect-evidence',
      },
      {
        id: 'obj-m6-coverage',
        label: 'Prove every claim with a check',
        detail: 'Ninety-five percent of manifest entries carry a green check.',
        metric: 'manifest-coverage-ratio',
        comparator: 'gte',
        target: 0.95,
        unit: 'ratio',
        required: true,
        tutorialStepId: 'm6-collect-evidence',
      },
      {
        id: 'obj-m6-provenance',
        label: 'Tag every line',
        detail: 'Full provenance coverage: user_requirement, repository_observation or architect_choice.',
        metric: 'provenance-coverage-ratio',
        comparator: 'gte',
        target: 1,
        unit: 'ratio',
        required: true,
        tutorialStepId: 'm6-tag-provenance',
      },
      {
        id: 'obj-m6-deliver',
        label: 'Deliver before the deadline',
        detail: 'Four percent of the delivery window still on the clock at handover.',
        metric: 'deadline-remaining-ratio',
        comparator: 'gte',
        target: 0.04,
        unit: 'ratio',
        required: true,
        tutorialStepId: 'm6-deliver',
      },
    ],
    win: {
      requiredObjectiveIds: [
        'obj-m6-manifest',
        'obj-m6-coverage',
        'obj-m6-provenance',
        'obj-m6-deliver',
      ],
      qualityScore: 0.86,
      reputation: 80,
      tasksPassed: 19,
      gatesPassed: 6,
      invariantsHeld: 5,
      credits: 1_500,
      contextRemainingRatio: 0.16,
      manifestEntries: 18,
    },
    loss: [
      {
        kind: 'context-exhaustion',
        label: 'Context exhausted',
        detail: 'The manifest was being written when the context budget ran dry.',
        metric: 'context-remaining-ratio',
        comparator: 'lte',
        threshold: 0.07,
        unit: 'ratio',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'write-conflict-storm',
        label: 'Conflict storm',
        detail: 'One unresolved write conflict is enough to invalidate a delivery manifest.',
        metric: 'conflicts-open',
        comparator: 'gte',
        threshold: 1,
        unit: 'count',
        evaluatedAt: 'anytime',
      },
      {
        kind: 'invariant-deadline',
        label: 'Invariants unrepaired at the deadline',
        detail:
          'A final invariant was still unsatisfied at the deadline, so the manifest could not be signed.',
        metric: 'invariants-at-risk',
        comparator: 'gte',
        threshold: 1,
        unit: 'count',
        evaluatedAt: 'deadline',
      },
    ],
    tutorial: [
      {
        id: 'm6-freeze-plan',
        index: 1,
        title: 'Freeze the plan',
        instruction: 'Register the full twenty-task plan and freeze it: no work appears after the freeze.',
        lesson:
          'A manifest can only describe a plan that stopped changing. Freezing the plan is what makes the delivered claim checkable instead of aspirational.',
        targets: [
          { surface: 'hud', selector: '[data-hud="mission-progress"]', label: 'Plan progress meter' },
          { surface: 'panel', selector: '[data-hud="panel-outline"]', label: 'Frozen plan outline' },
        ],
        advanceWhen: { kind: 'metric', metric: 'tasks-registered', comparator: 'gte', target: 20 },
      },
      {
        id: 'm6-collect-evidence',
        index: 2,
        title: 'Collect evidence per entry',
        instruction: 'Attach the check that proves each entry and keep the gates green.',
        lesson:
          'An entry without evidence is a promise. Coroid assembles the manifest from checks that actually ran, so a claimed task with no green check never reaches delivery.',
        targets: [
          { surface: 'panel', selector: '[data-hud="panel-report"]', label: 'Verification report' },
          { surface: 'panel', selector: '[data-hud="inspector-check"]', label: 'Declared check' },
        ],
        advanceWhen: { kind: 'metric', metric: 'manifest-entries', comparator: 'gte', target: 12 },
      },
      {
        id: 'm6-tag-provenance',
        index: 3,
        title: 'Tag every line with provenance',
        instruction: 'Check the terminal and the codex: every line names its source, not just its colour.',
        lesson:
          'Provenance is in-game terminology: user_requirement, repository_observation or architect_choice. A manifest line without a tag is a claim nobody can audit.',
        targets: [
          { surface: 'hud', selector: '[data-hud="log-provenance"]', label: 'Provenance chip on a log line' },
          { surface: 'panel', selector: '[data-hud="codex-provenance"]', label: 'Codex provenance chip' },
        ],
        advanceWhen: {
          kind: 'metric',
          metric: 'provenance-coverage-ratio',
          comparator: 'gte',
          target: 1,
        },
      },
      {
        id: 'm6-hold-invariants',
        index: 4,
        title: 'Hold every final invariant',
        instruction: 'Keep all five final invariants satisfied while the last tasks settle.',
        lesson:
          'Only satisfied final invariants count toward release, and an unrepaired one at the deadline loses the mission. This is the condition the whole campaign has been building toward.',
        targets: [
          { surface: 'hud', selector: '[data-hud="invariants"]', label: 'Final invariants readout' },
          { surface: 'panel', selector: '[data-hud="inspector-criterion"]', label: 'Criterion row' },
        ],
        advanceWhen: { kind: 'metric', metric: 'invariants-held', comparator: 'gte', target: 5 },
      },
      {
        id: 'm6-deliver',
        index: 5,
        title: 'Sign and deliver',
        instruction: 'Read the manifest in the codex and hand it over before the clock runs out.',
        lesson:
          'The delivery manifest is what Coroid ships: tasks, checks, criteria, provenance and cost in one auditable claim. When the floor goes quiet, that document is the product.',
        targets: [
          { surface: 'panel', selector: '[data-hud="panel-codex"]', label: 'Codex panel' },
          { surface: 'panel', selector: '[data-hud="codex-entry"]', label: 'Codex entry' },
          { surface: 'hud', selector: '[data-hud="clock"]', label: 'Sim clock' },
        ],
        advanceWhen: { kind: 'objective', objectiveId: 'obj-m6-deliver' },
      },
    ],
    eventLog: [
      {
        id: 'log-m6-freeze',
        atMs: 0,
        source: 'mission/started',
        provenance: 'user_requirement',
        text: 'Twenty tasks frozen for delivery; every line must carry evidence and a tag.',
      },
      {
        id: 'log-m6-manifest',
        atMs: 1_500,
        source: 'plan/task-registered',
        provenance: 'architect_choice',
        text: 'Manifest entries opened per task, each pointing at the check that proves it.',
      },
      {
        id: 'log-m6-gates',
        atMs: 4_200,
        source: 'verification/run',
        provenance: 'repository_observation',
        text: 'Six gates reported green; provenance coverage complete on every entry.',
      },
      {
        id: 'log-m6-signoff',
        atMs: 7_800,
        source: 'economy/reward',
        provenance: 'repository_observation',
        text: 'Delivery accepted with context to spare: the campaign is complete.',
      },
    ],
    claims: [
      {
        statement: 'The game must describe what Coroid actually delivers, not only how it works.',
        authority: 'user_requirement',
      },
      {
        statement: 'The delivery manifest is the final win condition of the campaign.',
        authority: 'architect_choice',
      },
      {
        statement: 'Provenance tags already exist in the interface contracts and are reused verbatim.',
        authority: 'repository_observation',
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Campaign assembly                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Turn the specs into the shipped catalogue.
 *
 * Derived fields live here so the content cannot drift: the state id is
 * `mission-<key>`, and a mission codex is the cumulative set of entries unlocked
 * up to and including that mission, which is what a codex panel should show.
 */
function buildCampaign(specs: readonly MissionSpec[]): readonly MissionDefinition[] {
  const unlocked: CodexTopic[] = [...CODEX_ORIENTATION_TOPICS];
  return specs.map((spec) => {
    for (const topic of spec.introduces) {
      if (!unlocked.includes(topic)) unlocked.push(topic);
    }
    const codex = unlocked.flatMap((topic) => {
      const entry = CODEX_LIBRARY[topic];
      return entry ? [entry] : [];
    });
    return {
      ...spec,
      id: `mission-${spec.key}`,
      codex,
      unlocks: [...spec.introduces],
    } satisfies MissionDefinition;
  });
}

/** The six missions, in campaign order. */
export const MISSIONS: readonly MissionDefinition[] = buildCampaign(MISSION_SPECS);

/** Number of missions in the campaign. */
export const MISSION_COUNT = MISSIONS.length;

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

/** Every mission, in campaign order. */
export function listMissions(): readonly MissionDefinition[] {
  return MISSIONS;
}

/** Look up a mission by its stable key; `undefined` for an unknown key. */
export function getMission(key: string): MissionDefinition | undefined {
  return MISSIONS.find((mission) => mission.key === key);
}

/**
 * Look up a mission by key, throwing when the key is unknown.
 *
 * Use this in wiring code where an unknown key is a programming error rather
 * than player input.
 */
export function requireMission(key: string): MissionDefinition {
  const mission = getMission(key);
  if (!mission) {
    throw new Error(`[coroid] unknown mission "${key}"; expected one of ${MISSION_KEYS.join(', ')}`);
  }
  return mission;
}

/** Look up a mission by 1-based campaign order; `undefined` when out of range. */
export function getMissionByOrder(order: number): MissionDefinition | undefined {
  return MISSIONS.find((mission) => mission.order === order);
}

/** The mission after `key`, or `null` when the campaign is finished. */
export function nextMission(key: string): MissionDefinition | null {
  const mission = getMission(key);
  if (!mission) return null;
  return getMissionByOrder(mission.order + 1) ?? null;
}

/** Zero-based campaign index of a mission, or `-1` for an unknown key. */
export function missionIndex(key: string): number {
  return MISSIONS.findIndex((mission) => mission.key === key);
}

/**
 * Whether a mission may be started.
 *
 * A mission unlocks once `unlockAfter` prior missions have been delivered, so
 * `isMissionUnlocked('parallel-lanes', ['request-to-plan'])` is `true` while
 * `isMissionUnlocked('parallel-lanes', [])` is `false`.
 */
export function isMissionUnlocked(key: string, deliveredKeys: readonly string[]): boolean {
  const mission = getMission(key);
  if (!mission) return false;
  const delivered = new Set(deliveredKeys);
  for (let order = 1; order <= mission.pacing.unlockAfter; order += 1) {
    const prior = getMissionByOrder(order);
    if (!prior || !delivered.has(prior.key)) return false;
  }
  return true;
}

/** Missions that may be started given what has been delivered, in campaign order. */
export function unlockedMissions(deliveredKeys: readonly string[]): readonly MissionDefinition[] {
  return MISSIONS.filter((mission) => isMissionUnlocked(mission.key, deliveredKeys));
}

/**
 * Campaign difficulty on a 0..1 scale: `0` for the first mission, `1` for the
 * last. The flow layer uses it to pace tutorials against budgets.
 */
export function campaignDifficulty(missionOrKey: MissionDefinition | string): number {
  const mission = typeof missionOrKey === 'string' ? getMission(missionOrKey) : missionOrKey;
  if (!mission || MISSION_COUNT <= 1) return 0;
  return (mission.order - 1) / (MISSION_COUNT - 1);
}

/* -------------------------------------------------------------------------- */
/* Pacing helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Context tokens the mission may spend per planned task. */
export function contextTokensPerTask(mission: MissionDefinition): number {
  const tasks = Math.max(1, mission.pacing.planTasks);
  return mission.pacing.contextBudget / tasks;
}

/** Simulated milliseconds the mission has per planned task. */
export function deadlineMsPerTask(mission: MissionDefinition): number {
  const tasks = Math.max(1, mission.pacing.planTasks);
  return mission.pacing.deadlineMs / tasks;
}

/* -------------------------------------------------------------------------- */
/* Booting a mission                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Field-for-field match for `InitialStateOptions` in `src/sim/state.ts`.
 *
 * The catalogue cannot import the simulation, so the correspondence is kept in
 * the shape itself and asserted in `tests/missions.test.ts`.
 */
export interface MissionInitialStateOptions {
  readonly seed: number;
  readonly missionId: string;
  readonly codename: string;
  readonly objective: string;
  readonly startingCredits: number;
  readonly creditRatePerTask: number;
  readonly contextBudget: number;
  readonly reputation: number;
  readonly deadlineMs: number;
}

/** Options that boot a mission onto the shared domain contract. */
export function missionInitialStateOptions(
  missionOrKey: MissionDefinition | string,
): MissionInitialStateOptions {
  const mission = typeof missionOrKey === 'string' ? requireMission(missionOrKey) : missionOrKey;
  return {
    seed: mission.pacing.seed,
    missionId: mission.id,
    codename: mission.codename,
    objective: mission.objective,
    startingCredits: mission.pacing.startingCredits,
    creditRatePerTask: mission.pacing.creditRatePerTask,
    contextBudget: mission.pacing.contextBudget,
    reputation: mission.pacing.startingReputation,
    deadlineMs: mission.pacing.deadlineMs,
  };
}

/* -------------------------------------------------------------------------- */
/* Win and loss evaluation                                                    */
/* -------------------------------------------------------------------------- */

/** Measured values the flow layer hands to {@link evaluateMissionOutcome}. */
export interface MissionReadings {
  /** Simulated milliseconds the mission has been running for. */
  readonly elapsedMs?: number;
  /** Whatever the flow layer has measured; a missing metric reads as `0`. */
  readonly metrics?: Partial<Record<MissionMetric, number>>;
}

/** Why a mission ended, and which objectives were satisfied on the way. */
export interface MissionVerdict {
  readonly outcome: 'won' | 'lost' | 'running';
  /** Set when `outcome` is `lost`. */
  readonly lossKind: LossKind | null;
  readonly satisfiedObjectiveIds: readonly string[];
  readonly unmetObjectiveIds: readonly string[];
  /** Objective ids that must be satisfied for a win but are not. */
  readonly blockingObjectiveIds: readonly string[];
  /** Fraction of all objectives satisfied, 0..1. */
  readonly objectiveProgress: number;
  /** Milliseconds left on the clock, floored at 0. */
  readonly deadlineRemainingMs: number;
  /** One sentence the HUD can print. */
  readonly reason: string;
}

function compareThreshold(comparator: Comparison, value: number, threshold: number): boolean {
  return comparator === 'gte' ? value >= threshold : value <= threshold;
}

/**
 * Read a measured metric.
 *
 * A metric the flow layer has not measured yet is `undefined`, not `0`: the
 * verdict logic must not mistake "no data" for "the worst possible value".
 */
function readMetric(readings: MissionReadings, metric: MissionMetric): number | undefined {
  const value = readings.metrics?.[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** True when a measured value crosses its threshold; unmeasured values never do. */
function thresholdHit(value: number | undefined, comparator: Comparison, threshold: number): boolean {
  if (value === undefined) return false;
  return compareThreshold(comparator, value, threshold);
}

function atLeast(readings: MissionReadings, metric: MissionMetric, target: number): boolean {
  const value = readMetric(readings, metric);
  return value !== undefined && value >= target;
}

function winConditionsMet(mission: MissionDefinition, readings: MissionReadings): boolean {
  const win = mission.win;
  return (
    atLeast(readings, 'quality-score', win.qualityScore) &&
    atLeast(readings, 'reputation', win.reputation) &&
    atLeast(readings, 'tasks-passed', win.tasksPassed) &&
    atLeast(readings, 'gates-passed', win.gatesPassed) &&
    atLeast(readings, 'invariants-held', win.invariantsHeld) &&
    atLeast(readings, 'credits', win.credits) &&
    atLeast(readings, 'context-remaining-ratio', win.contextRemainingRatio) &&
    atLeast(readings, 'manifest-entries', win.manifestEntries)
  );
}

/**
 * Decide where a mission stands.
 *
 * Rules, in evaluation order:
 *
 *  1. Any loss condition whose `evaluatedAt` is `anytime` fires as soon as its
 *     threshold is crossed (context exhaustion, then a conflict storm).
 *  2. At the deadline, the `invariant-deadline` condition fires when a final
 *     invariant is still unrepaired, and it also fires when the delivery slot
 *     closes without a win — the manifest cannot be signed late.
 *  3. A mission is won when every required objective is met, the win threshold
 *     holds and the deadline has not passed.
 *  4. Otherwise the mission is still running.
 *
 * Metrics the flow layer has not measured are neither satisfied nor fatal: an
 * unmeasured objective counts as unmet (so it blocks a win, which the HUD can
 * explain) and an unmeasured loss condition never fires.
 *
 * The function is pure: it never mutates `readings` and depends on nothing but
 * its arguments, so replaying the same numbers always yields the same verdict.
 */
export function evaluateMissionOutcome(
  missionOrKey: MissionDefinition | string,
  readings: MissionReadings = {},
): MissionVerdict {
  const mission = typeof missionOrKey === 'string' ? requireMission(missionOrKey) : missionOrKey;
  const elapsedMs = Math.max(0, readings.elapsedMs ?? 0);
  const deadlineMs = mission.pacing.deadlineMs;
  const atDeadline = elapsedMs >= deadlineMs;
  const deadlineRemainingMs = Math.max(0, deadlineMs - elapsedMs);

  const satisfiedObjectiveIds: string[] = [];
  const unmetObjectiveIds: string[] = [];
  for (const objective of mission.objectives) {
    const met = thresholdHit(
      readMetric(readings, objective.metric),
      objective.comparator,
      objective.target,
    );
    (met ? satisfiedObjectiveIds : unmetObjectiveIds).push(objective.id);
  }

  const requiredIds = new Set(mission.win.requiredObjectiveIds);
  const blockingObjectiveIds = unmetObjectiveIds.filter((id) => requiredIds.has(id));
  const objectivesMet = blockingObjectiveIds.length === 0;
  const win = objectivesMet && winConditionsMet(mission, readings);

  // Loss condition 3 covers both halves of the deadline rule.
  const lossHits: LossCondition[] = [];
  for (const condition of mission.loss) {
    if (condition.evaluatedAt === 'deadline' && !atDeadline) continue;
    if (thresholdHit(readMetric(readings, condition.metric), condition.comparator, condition.threshold)) {
      lossHits.push(condition);
    }
  }
  if (!win && atDeadline) {
    const deadlineCondition = mission.loss.find((condition) => condition.kind === 'invariant-deadline');
    if (deadlineCondition && !lossHits.includes(deadlineCondition)) lossHits.push(deadlineCondition);
  }

  const objectiveProgress =
    mission.objectives.length === 0
      ? 1
      : satisfiedObjectiveIds.length / mission.objectives.length;

  if (lossHits.length > 0) {
    const loss = lossHits[0] as LossCondition;
    return {
      outcome: 'lost',
      lossKind: loss.kind,
      satisfiedObjectiveIds,
      unmetObjectiveIds,
      blockingObjectiveIds,
      objectiveProgress,
      deadlineRemainingMs,
      reason: loss.detail,
    };
  }

  if (win) {
    return {
      outcome: 'won',
      lossKind: null,
      satisfiedObjectiveIds,
      unmetObjectiveIds,
      blockingObjectiveIds,
      objectiveProgress,
      deadlineRemainingMs,
      reason: `${mission.codename} delivered with ${satisfiedObjectiveIds.length} of ${mission.objectives.length} objectives met.`,
    };
  }

  return {
    outcome: 'running',
    lossKind: null,
    satisfiedObjectiveIds,
    unmetObjectiveIds,
    blockingObjectiveIds,
    objectiveProgress,
    deadlineRemainingMs,
    reason: `Still running: ${blockingObjectiveIds.length} required objective(s) unmet with ${Math.round(
      deadlineRemainingMs / 1000,
    )}s on the clock.`,
  };
}

/** Codex entries a mission unlocks, ready to hand to `createCodexConcepts` as extras. */
export function missionCodex(missionOrKey: MissionDefinition | string): readonly CodexEntry[] {
  const mission = typeof missionOrKey === 'string' ? requireMission(missionOrKey) : missionOrKey;
  return mission.codex;
}
