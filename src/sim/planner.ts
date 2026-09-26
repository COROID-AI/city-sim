/**
 * Coroid mission planner: one request in, one governed plan out.
 *
 * `generatePlan` is the first lesson the player experiences. A mission request
 * arrives as prose, and the planner turns it into the phase/task outline an
 * architect would hand to the factory floor. Because that outline *is* the
 * execution contract of the mission, every generated task carries
 *
 *  - `readSet` / `writeSet` — the shared contracts the task consumes and the
 *    files it exclusively owns;
 *  - `checks` — how the task is verified, using the same vocabulary the
 *    verification module declares (`build`, `typecheck`, `test`, `composition`)
 *    plus the evidence kind each check can produce;
 *  - `criteria` — what going green *means*, each carrying a lifecycle
 *    (`milestone`, `final_invariant`, `superseded`) so the quality graph and the
 *    release gate can read the plan;
 *  - `sourceClaims` — why the work exists at all (a user requirement, repository
 *    evidence, or an architect's choice), which is what the game shows when the
 *    player asks "why is this task on the floor?".
 *
 * ## Contract
 *
 *  - **Deterministic.** The only inputs are the request, the seed and the
 *    authored catalogue below. All randomness is drawn from the shared seeded
 *    `createRng` stream (`../game/loop`), keyed by `missionId#seed`, so an
 *    identical mission id plus seed always yields an identical outline: same
 *    phases, task keys, dependency keys and write sets.
 *  - **Layered by construction.** A task's declared dependencies always live in
 *    strictly earlier phases, and no two tasks inside one phase claim the same
 *    write path, so the outline satisfies the dependency graph's layering rules
 *    without repair.
 *  - **Pure.** The planner reads no files, touches no DOM, and imports nothing
 *    from the graph, verification, lane or render modules. Generated tasks use
 *    the graph module's input field names (`id`, `title`, `laneId`, `dependsOn`,
 *    `readSet`, `writeSet`), so the integration owner can hand `outline.tasks`
 *    straight to `buildDependencyGraph` and compare `outline.phases` with the
 *    graph's layering.
 *  - **Emits plan events.** `outline.events` is a deterministic
 *    `plan/task-registered` script and `applyPlanOutline` reduces it into a
 *    `GameState` through the shared reducer — that is how a plan reaches the
 *    `plan` slice, and how a player watches the request become real work.
 *
 * ## Difficulty
 *
 * `difficulty` is part of the request (1..{@link MAX_DIFFICULTY_LEVEL}). The
 * authored ladder — `brief`, `standard`, `expansive`, `flagship` — gates how many
 * phases exist and how many optional workstreams each phase adds, so later
 * missions produce larger, deeper and wider outlines.
 * {@link missionRequestVariants} turns one foundation fixture state into the
 * whole ladder, which is exactly what the difficulty curve is verified against.
 *
 * ## Vocabulary ownership
 *
 * `PlanCheckKind`, `PlanEvidenceKind` and `PlanCriterionLifecycle` are
 * structurally identical to `CheckKind`, `EvidenceKind` and `CriterionLifecycle`
 * in `src/sim/verification.ts`. They are re-declared here on purpose: the
 * planner must stay a pure function of request, seed and catalogue, so it does
 * not import the verification (or graph) module. The integration owner can pass
 * `task.checks` and `task.criteria` straight to `registerChecks` /
 * `registerCriteria`.
 */

import { createRng, type Rng } from '../game/loop';
import {
  applyDomainEvents,
  makeDomainEvent,
  type DeepReadonly,
  type DomainEvent,
  type GameState,
  type LaneKind,
} from './state';

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/** The kinds of check a planned task can declare. Mirrors the verification module. */
export type PlanCheckKind = 'build' | 'typecheck' | 'test' | 'composition';

/** How a check proves its assertion. Mirrors the verification module. */
export type PlanEvidenceKind = 'command' | 'browser' | 'visual' | 'screenshot';

/**
 * Lifecycle of a planned criterion: a draft milestone, a release invariant, or a
 * criterion that a later one replaced. Generation never writes `superseded` —
 * that is a runtime transition owned by the verification module.
 */
export type PlanCriterionLifecycle = 'milestone' | 'final_invariant' | 'superseded';

/** Where a piece of plan work came from; shown to the player as "why this task?". */
export type SourceClaimAuthority = 'user_requirement' | 'repository_evidence' | 'architect_choice';

/** One reason a task exists, in the quality graph's claim vocabulary. */
export interface SourceClaim {
  authority: SourceClaimAuthority;
  statement: string;
}

/** Simulated milliseconds between two consecutive plan registration events. */
export const PLAN_EVENT_SPACING_MS = 120;

/** Runner budget a generated check is given unless the catalogue says otherwise. */
export const CHECK_TIMEOUT_MS = 300_000;

/** Foundation lane ids: `lane-<kind>` is the naming the shared state uses. */
export function laneIdFor(kind: LaneKind): string {
  return `lane-${kind}`;
}

/* -------------------------------------------------------------------------- */
/* Difficulty ladder                                                          */
/* -------------------------------------------------------------------------- */

export const MIN_DIFFICULTY_LEVEL = 1;
export const MAX_DIFFICULTY_LEVEL = 4;

/** Missions that do not state a difficulty are planned as `standard`. */
export const DEFAULT_DIFFICULTY_LEVEL = 2;

/** Named difficulty tiers, low to high. */
export type DifficultyTier = 'brief' | 'standard' | 'expansive' | 'flagship';

/** One step of the authored difficulty curve. */
export interface DifficultyStep {
  /** 1-based level; also the number of extra optional workstreams per phase, minus one. */
  readonly level: number;
  readonly tier: DifficultyTier;
  readonly label: string;
  readonly blurb: string;
  /** Optional workstreams each phase adds at this level. */
  readonly extraWorkstreams: number;
}

export const DIFFICULTY_LADDER: readonly DifficultyStep[] = Object.freeze([
  {
    level: 1,
    tier: 'brief',
    label: 'Brief',
    blurb: 'A framing task, one contract phase and a compact domain core: three phases the floor can explain in one breath.',
    extraWorkstreams: 0,
  },
  {
    level: 2,
    tier: 'standard',
    label: 'Standard',
    blurb: 'Adds the presentation phase plus one extra workstream in every parallel phase.',
    extraWorkstreams: 1,
  },
  {
    level: 3,
    tier: 'expansive',
    label: 'Expansive',
    blurb: 'Adds the integration phase and widens every parallel phase by a second extra workstream.',
    extraWorkstreams: 2,
  },
  {
    level: 4,
    tier: 'flagship',
    label: 'Flagship',
    blurb: 'Adds release and observation and pulls in the whole catalogue: the deepest, widest outline the planner authors.',
    extraWorkstreams: 3,
  },
]);

/** Clamp any input to the authored ladder. */
export function resolveDifficulty(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_DIFFICULTY_LEVEL;
  const level = Math.trunc(value);
  if (level < MIN_DIFFICULTY_LEVEL) return MIN_DIFFICULTY_LEVEL;
  if (level > MAX_DIFFICULTY_LEVEL) return MAX_DIFFICULTY_LEVEL;
  return level;
}

/** The ladder step for a difficulty level (already clamped). */
export function difficultyStep(level: number): DifficultyStep {
  const index = resolveDifficulty(level) - 1;
  // The ladder is authored to cover 1..MAX_DIFFICULTY_LEVEL; the fallback keeps
  // the function total without inventing a tier.
  return DIFFICULTY_LADDER[index] ?? DIFFICULTY_LADDER[0]!;
}

/* -------------------------------------------------------------------------- */
/* Authored phases                                                            */
/* -------------------------------------------------------------------------- */

/** One authored phase of the architect's decomposition. */
export interface PhaseBlueprint {
  /** Zero-based phase index; also the layering depth the phase sits at. */
  readonly index: number;
  readonly title: string;
  /** What the phase is for, in architect language. */
  readonly intent: string;
  /** Dominant lane of the phase, for the HUD's phase board. */
  readonly laneFocus: LaneKind;
  /** Lowest difficulty level at which this phase appears. */
  readonly minDifficulty: number;
}

/**
 * The authored phase skeleton. Phase inclusion is monotone in difficulty, so a
 * harder mission is always at least as deep as an easier one.
 */
export const PHASE_BLUEPRINTS: readonly PhaseBlueprint[] = Object.freeze([
  {
    index: 0,
    title: 'Frame the request',
    intent: 'Turn the raw mission request into governed work items with owners, write boundaries and checks.',
    laneFocus: 'discovery',
    minDifficulty: 1,
  },
  {
    index: 1,
    title: 'Freeze the shared contracts',
    intent: 'Freeze the contracts every later module is written against, so parallel work cannot drift.',
    laneFocus: 'build',
    minDifficulty: 1,
  },
  {
    index: 2,
    title: 'Build the domain modules',
    intent: 'Build the deterministic domain modules that actually make the mission run.',
    laneFocus: 'build',
    minDifficulty: 1,
  },
  {
    index: 3,
    title: 'Compose the presentation layer',
    intent: 'Compose the presentation layer that shows the player what the factory is doing.',
    laneFocus: 'build',
    minDifficulty: 2,
  },
  {
    index: 4,
    title: 'Integrate and verify',
    intent: 'Assemble the mission in a browser and prove each criterion with real evidence.',
    laneFocus: 'verify',
    minDifficulty: 3,
  },
  {
    index: 5,
    title: 'Release and observe',
    intent: 'Ship the mission, then watch it in production and capture what to change next.',
    laneFocus: 'integrate',
    minDifficulty: 4,
  },
]);

/* -------------------------------------------------------------------------- */
/* Authored workstreams                                                       */
/* -------------------------------------------------------------------------- */

/** A check plus the criterion that check is offered as evidence for. */
interface VerificationBlueprint {
  readonly kind: PlanCheckKind;
  readonly assertion: string;
  /** Which write path the repair objective points at. Defaults to `source`. */
  readonly target?: 'source' | 'test';
  /** Evidence the check produces; defaults to `command`, or `browser` for composition. */
  readonly evidence?: PlanEvidenceKind;
  /** Runner budget override. Defaults to {@link CHECK_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  readonly criterion: {
    readonly label: string;
    readonly lifecycle: PlanCriterionLifecycle;
  };
}

/**
 * One authored workstream: the unit an architect decomposes a request into.
 *
 * `writes` and `reads` are templates; `{mission}` is replaced with the mission
 * slug. `dependsOn` names other workstreams, and the authored catalogue keeps
 * every dependency inside a strictly earlier phase, which is what makes the
 * generated outline layered by construction.
 */
export interface MissionWorkstream {
  /** Stable catalogue key; becomes the tail of the generated task key. */
  readonly key: string;
  readonly phase: number;
  readonly title: string;
  readonly lane: LaneKind;
  /** Core workstreams always appear with their phase; optional ones are drawn by difficulty. */
  readonly core: boolean;
  readonly writes: readonly string[];
  readonly reads: readonly string[];
  readonly dependsOn: readonly string[];
  readonly verifications: readonly VerificationBlueprint[];
  readonly claims: readonly SourceClaim[];
  readonly estimateCredits: number;
  readonly estimateContextTokens: number;
}

const architectClaim = (statement: string): SourceClaim => ({ authority: 'architect_choice', statement });
const repositoryClaim = (statement: string): SourceClaim => ({ authority: 'repository_evidence', statement });
const userClaim = (statement: string): SourceClaim => ({ authority: 'user_requirement', statement });

const milestone = (
  kind: PlanCheckKind,
  assertion: string,
  label: string,
  options: { target?: 'source' | 'test'; lifecycle?: PlanCriterionLifecycle; evidence?: PlanEvidenceKind } = {},
): VerificationBlueprint => ({
  kind,
  assertion,
  ...(options.target === undefined ? {} : { target: options.target }),
  ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
  criterion: { label, lifecycle: options.lifecycle ?? 'milestone' },
});

/**
 * The authored catalogue. It is deliberately read-only data: the planner never
 * mutates it, so two missions never contaminate each other's plans.
 *
 * Rules the catalogue obeys (asserted by `tests/planner.test.ts`):
 *  - keys are unique and every write path is claimed by exactly one workstream;
 *  - `dependsOn` only names `core` workstreams in strictly earlier phases, so a
 *    dependency can never be missing and can never land in the same phase;
 *  - every phase has at least one core workstream and a pool of three optional
 *    ones, which is what lets difficulty widen a phase without changing its depth.
 */
export const MISSION_WORKSTREAMS: readonly MissionWorkstream[] = Object.freeze([
  {
    key: 'request-brief',
    phase: 0,
    title: 'Frame the mission request into governed work',
    lane: 'discovery',
    core: true,
    writes: ['src/missions/{mission}/request-brief.ts', 'tests/missions/{mission}/request-brief.test.ts'],
    reads: ['README.md', 'package.json'],
    dependsOn: [],
    verifications: [
      milestone('typecheck', 'The mission brief compiles against the shared GameState contract.', 'The request becomes verifiable work items, not prose', {
        lifecycle: 'final_invariant',
      }),
      milestone('test', 'Every declared work item names a lane, a write set and at least one check.', 'Nothing reaches a lane without a check and an owner', {
        target: 'test',
      }),
    ],
    claims: [
      architectClaim('Decompose before building: the floor only accepts work items that carry an owner, a write boundary and a check.'),
      repositoryClaim('Reads the repository statement of the product (README.md, package.json) before proposing any work item.'),
    ],
    estimateCredits: 120,
    estimateContextTokens: 18_000,
  },
  {
    key: 'state-contract',
    phase: 1,
    title: 'Freeze the mission state contract',
    lane: 'build',
    core: true,
    writes: ['src/missions/{mission}/state-contract.ts', 'tests/missions/{mission}/state-contract.test.ts'],
    reads: ['src/sim/state.ts', 'package.json'],
    dependsOn: ['request-brief'],
    verifications: [
      milestone('typecheck', 'The mission state contract compiles against the shared GameState slices.', 'The state slice is frozen before any module writes into it', {
        lifecycle: 'final_invariant',
      }),
      milestone('test', 'Replaying the contract events produces an identical state snapshot.', 'Contract replay is deterministic', { target: 'test' }),
    ],
    claims: [
      architectClaim('Freeze the contract first: every later module is written against it, so parallel work cannot drift.'),
      repositoryClaim('Extends the shared plan/task slice and TaskStatus vocabulary from src/sim/state.ts.'),
    ],
    estimateCredits: 180,
    estimateContextTokens: 26_000,
  },
  {
    key: 'event-contract',
    phase: 1,
    title: 'Freeze the domain event contract',
    lane: 'build',
    core: true,
    writes: ['src/missions/{mission}/event-contract.ts', 'tests/missions/{mission}/event-contract.test.ts'],
    reads: ['src/sim/state.ts', 'src/game/events.ts'],
    dependsOn: ['request-brief'],
    verifications: [
      milestone('typecheck', 'The event contract compiles against the shared DomainEvent union.', 'Every state change travels as a domain event', {
        lifecycle: 'final_invariant',
      }),
      milestone('test', 'Equal timestamps replay in emission order, so logs cannot reorder history.', 'Event replays are order-stable', { target: 'test' }),
    ],
    claims: [
      architectClaim('Events, not direct mutation: the contract fixes the only channel through which mission state changes.'),
      repositoryClaim('Uses the shared emission channel and DomainEvent union already owned by src/game/events.ts.'),
    ],
    estimateCredits: 180,
    estimateContextTokens: 24_000,
  },
  {
    key: 'lane-registry',
    phase: 1,
    title: 'Register the agent lanes and their capacities',
    lane: 'build',
    core: false,
    writes: ['src/missions/{mission}/lane-registry.ts', 'tests/missions/{mission}/lane-registry.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['request-brief'],
    verifications: [
      milestone('typecheck', 'Lane registrations compile against the shared LaneState contract.', 'Lanes are registered with a kind, a label and a capacity'),
      milestone('test', 'Utilisation is re-derived from running tasks rather than stored by hand.', 'Lane load stays derived, never hand-written', { target: 'test' }),
    ],
    claims: [
      architectClaim('Work is only parallel if the lanes that carry it are declared, so the registry ships with the contracts.'),
    ],
    estimateCredits: 130,
    estimateContextTokens: 15_000,
  },
  {
    key: 'quality-budget',
    phase: 1,
    title: 'Budget the quality metrics and their targets',
    lane: 'build',
    core: false,
    writes: ['src/missions/{mission}/quality-budget.ts', 'tests/missions/{mission}/quality-budget.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['request-brief'],
    verifications: [
      milestone('typecheck', 'Metric registrations compile against the shared QualityState slice.', 'Quality metrics carry a value, a target and a weight'),
      milestone('test', 'A mission cannot declare a metric it has no check for.', 'Every measured metric is earned by a check', {
        target: 'test',
        lifecycle: 'final_invariant',
      }),
    ],
    claims: [architectClaim('Measure what the mission promises, and only what a check can actually produce evidence for.')],
    estimateCredits: 140,
    estimateContextTokens: 16_000,
  },
  {
    key: 'context-ledger',
    phase: 1,
    title: 'Ledger the context and credit budget',
    lane: 'build',
    core: false,
    writes: ['src/missions/{mission}/context-ledger.ts', 'tests/missions/{mission}/context-ledger.test.ts'],
    reads: ['src/sim/state.ts', 'package.json'],
    dependsOn: ['request-brief'],
    verifications: [
      milestone('typecheck', 'The ledger compiles against the shared economy slice.', 'Spending is recorded as events, never as direct mutation'),
      milestone('test', 'Spend, reward and deadline events reduce to the same derived rates every replay.', 'Budget replay is deterministic', { target: 'test' }),
    ],
    claims: [architectClaim('A mission that cannot afford its own context will not finish; the budget is planned, not discovered.')],
    estimateCredits: 150,
    estimateContextTokens: 17_000,
  },
  {
    key: 'sim-core',
    phase: 2,
    title: 'Drive the mission from one deterministic simulation core',
    lane: 'build',
    core: true,
    writes: ['src/missions/{mission}/sim-core.ts', 'tests/missions/{mission}/sim-core.test.ts'],
    reads: ['src/sim/state.ts', 'src/game/loop.ts'],
    dependsOn: ['state-contract', 'event-contract'],
    verifications: [
      milestone('test', 'The same seed and request reduce to the same state after the same event script.', 'Seeded replay is bit-for-bit deterministic', {
        target: 'test',
        lifecycle: 'final_invariant',
      }),
      milestone('typecheck', 'The core compiles without reaching into rendering or the DOM.', 'The simulation core stays headless'),
    ],
    claims: [
      architectClaim('One core owns the tick: randomness comes from the seeded RNG, so the floor can always be replayed.'),
      repositoryClaim('Reuses the fixed-step clock and seeded RNG shared by src/game/loop.ts.'),
    ],
    estimateCredits: 320,
    estimateContextTokens: 42_000,
  },
  {
    key: 'mission-model',
    phase: 2,
    title: 'Model the mission timeline and its progress',
    lane: 'build',
    core: true,
    writes: ['src/missions/{mission}/mission-model.ts', 'tests/missions/{mission}/mission-model.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['state-contract'],
    verifications: [
      milestone('test', 'Progress is derived from passed tasks and never stored independently.', 'Mission progress cannot drift from the plan', { target: 'test' }),
      milestone('typecheck', 'The model compiles against the shared MissionState contract.', 'The timeline reads the shared mission slice'),
    ],
    claims: [architectClaim('The player watches progress; progress must be a pure function of the plan, or the HUD will lie.')],
    estimateCredits: 240,
    estimateContextTokens: 30_000,
  },
  {
    key: 'dependency-graph',
    phase: 2,
    title: 'Layer work into phases and write-conflict boundaries',
    lane: 'build',
    core: false,
    writes: ['src/missions/{mission}/dependency-graph.ts', 'tests/missions/{mission}/dependency-graph.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['state-contract', 'event-contract'],
    verifications: [
      milestone('test', 'A task never depends on work in its own phase, and no phase claims one path twice.', 'Layering and write boundaries hold without repair', {
        target: 'test',
        lifecycle: 'final_invariant',
      }),
      milestone('typecheck', 'Graph inputs compile against the shared plan slice.', 'The graph reads the plan slice directly'),
    ],
    claims: [architectClaim('Parallelism is only safe when ownership is exclusive inside a phase; the graph is what makes it provable.')],
    estimateCredits: 280,
    estimateContextTokens: 34_000,
  },
  {
    key: 'lane-dispatch',
    phase: 2,
    title: 'Dispatch ready work onto the agent lanes',
    lane: 'build',
    core: false,
    writes: ['src/missions/{mission}/lane-dispatch.ts', 'tests/missions/{mission}/lane-dispatch.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['state-contract', 'event-contract'],
    verifications: [
      milestone('test', 'A task whose upstream dependency has not passed is never assigned.', 'Nothing is dispatched ahead of its dependencies', {
        target: 'test',
        lifecycle: 'final_invariant',
      }),
      milestone('typecheck', 'Dispatch compiles against the shared lane and plan slices.', 'Dispatch speaks the shared lane vocabulary'),
    ],
    claims: [architectClaim('Lanes pull work, they do not invent it: dispatch only ever offers ready, conflict-free tasks.')],
    estimateCredits: 260,
    estimateContextTokens: 32_000,
  },
  {
    key: 'verification-engine',
    phase: 2,
    title: 'Turn declared checks into gates and repair objectives',
    lane: 'build',
    core: false,
    writes: ['src/missions/{mission}/verification-engine.ts', 'tests/missions/{mission}/verification-engine.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['state-contract', 'event-contract'],
    verifications: [
      milestone('test', 'A failing check opens exactly one repair objective and closes it when that check passes.', 'Failing checks open one repair each, not a stream', {
        target: 'test',
        lifecycle: 'final_invariant',
      }),
      milestone('typecheck', 'Gate declarations compile against the shared verification slice.', 'Gates register through the shared slice'),
    ],
    claims: [architectClaim('Verification is a policy, not a runner: this module decides what an outcome means for the plan.')],
    estimateCredits: 300,
    estimateContextTokens: 36_000,
  },
  {
    key: 'renderer-shell',
    phase: 3,
    title: 'Render the holographic factory floor',
    lane: 'build',
    core: true,
    writes: ['src/missions/{mission}/renderer-shell.ts', 'tests/missions/{mission}/renderer-shell.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['sim-core', 'mission-model'],
    verifications: [
      milestone('build', 'The mission bundle builds for the browser without a GPU at test time.', 'The scene builds inside the frame budget', { lifecycle: 'final_invariant' }),
      milestone('composition', 'The floor renders the live plan in a real browser, not only in a headless scene.', 'A player can see the plan on the floor', {
        target: 'test',
        lifecycle: 'final_invariant',
        evidence: 'browser',
      }),
    ],
    claims: [
      architectClaim('The floor is the product: if the plan is invisible, the factory has nothing to say.'),
      userClaim('The player must see what Coroid is doing without opening a console.'),
    ],
    estimateCredits: 360,
    estimateContextTokens: 48_000,
  },
  {
    key: 'hud-overlay',
    phase: 3,
    title: 'Overlay the mission readout and the phase board',
    lane: 'build',
    core: true,
    writes: ['src/missions/{mission}/hud-overlay.ts', 'tests/missions/{mission}/hud-overlay.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['sim-core', 'mission-model'],
    verifications: [
      milestone('build', 'The overlay builds with the shell and imports no GPU-only code path.', 'The readout ships with the shell'),
      milestone('composition', 'The HUD states phase, progress and blockers legibly at 1280x720.', 'The readout explains the mission at a glance', {
        target: 'test',
        lifecycle: 'final_invariant',
        evidence: 'visual',
      }),
    ],
    claims: [
      architectClaim('A plan the player cannot read is indistinguishable from no plan.'),
      userClaim('The player must be able to tell how far the mission has come and what is blocked.'),
    ],
    estimateCredits: 300,
    estimateContextTokens: 38_000,
  },
  {
    key: 'audio-cues',
    phase: 3,
    title: 'Cue the factory audio to plan transitions',
    lane: 'build',
    core: false,
    writes: ['src/missions/{mission}/audio-cues.ts', 'tests/missions/{mission}/audio-cues.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['sim-core'],
    verifications: [
      milestone('build', 'The cue module builds without requiring an audio device at test time.', 'Cues degrade silently on muted hosts'),
      milestone('composition', 'Cues fire from plan events in a browser session and never block the frame.', 'Cues ride the plan events a player hears', {
        target: 'test',
        evidence: 'browser',
      }),
    ],
    claims: [architectClaim('Sound is feedback, never the message: every cue must be redundant with something visible.')],
    estimateCredits: 180,
    estimateContextTokens: 22_000,
  },
  {
    key: 'dev-preview-harness',
    phase: 3,
    title: 'Stand up the mission dev-preview harness',
    lane: 'build',
    core: false,
    writes: ['src/missions/{mission}/dev-preview-harness.ts', 'tests/missions/{mission}/dev-preview-harness.test.ts'],
    reads: ['src/sim/fixtures.ts'],
    dependsOn: ['sim-core', 'mission-model'],
    verifications: [
      milestone('build', 'The harness builds against the shared fixture module.', 'The harness boots from the shared fixtures'),
      milestone('composition', 'The harness drives the mission from deterministic fixture state in a browser.', 'Reviewers can replay the mission by hand', {
        target: 'test',
        evidence: 'browser',
      }),
    ],
    claims: [repositoryClaim('Boots from createSampleState so the preview never invents its own mission content.')],
    estimateCredits: 200,
    estimateContextTokens: 24_000,
  },
  {
    key: 'quality-constellation',
    phase: 3,
    title: 'Grow the quality constellation from criterion lifecycles',
    lane: 'build',
    core: false,
    writes: ['src/missions/{mission}/quality-constellation.ts', 'tests/missions/{mission}/quality-constellation.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['sim-core'],
    verifications: [
      milestone('build', 'The constellation builds from metric state alone, with no hand-authored positions.', 'The constellation is derived, never authored'),
      milestone('composition', 'Milestones, invariants and superseded criteria are visually distinguishable.', 'A player can read criterion lifecycles', {
        target: 'test',
        lifecycle: 'final_invariant',
        evidence: 'visual',
      }),
    ],
    claims: [architectClaim('Quality is shown as growth: milestones give way to release invariants, and the player sees the handover.')],
    estimateCredits: 260,
    estimateContextTokens: 30_000,
  },
  {
    key: 'composition-gate',
    phase: 4,
    title: 'Gate the assembled mission on composition evidence',
    lane: 'verify',
    core: true,
    writes: ['src/missions/{mission}/composition-gate.ts', 'tests/missions/{mission}/composition-gate.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['renderer-shell', 'hud-overlay'],
    verifications: [
      milestone('composition', 'The assembled mission boots in a browser with an empty console and a live plan readout.', 'The assembled mission boots cleanly', {
        target: 'test',
        lifecycle: 'final_invariant',
        evidence: 'browser',
      }),
      milestone('test', 'Every criterion in the plan is reachable by a check that can satisfy it.', 'No criterion ships without a satisfiable path', {
        lifecycle: 'final_invariant',
      }),
    ],
    claims: [
      architectClaim('Modules passing alone prove nothing: the mission is gated on the assembled application.'),
      repositoryClaim('Reads the shared plan slice to walk every declared criterion and check.'),
    ],
    estimateCredits: 340,
    estimateContextTokens: 40_000,
  },
  {
    key: 'browser-smoke',
    phase: 4,
    title: 'Smoke the mission boot path in a browser',
    lane: 'verify',
    core: false,
    writes: ['src/missions/{mission}/browser-smoke.ts', 'tests/missions/{mission}/browser-smoke.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['renderer-shell', 'hud-overlay'],
    verifications: [
      milestone('composition', 'Boot, first frame and first plan event are observed in a browser with no console errors.', 'The boot path is proven in a browser', {
        target: 'test',
        lifecycle: 'final_invariant',
        evidence: 'browser',
      }),
      milestone('test', 'A failed boot reports which stage of the boot path failed.', 'Boot failures name their stage'),
    ],
    claims: [architectClaim('Configured is not booted: only an observed first frame counts as boot evidence.')],
    estimateCredits: 220,
    estimateContextTokens: 26_000,
  },
  {
    key: 'regression-suite',
    phase: 4,
    title: 'Regress the plan, the graph and the gates together',
    lane: 'verify',
    core: false,
    writes: ['src/missions/{mission}/regression-suite.ts', 'tests/missions/{mission}/regression-suite.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['sim-core', 'mission-model'],
    verifications: [
      milestone('test', 'Determinism, layering and write-ownership invariants are re-checked on every run.', 'The execution contract is re-proven each run', {
        target: 'test',
        lifecycle: 'final_invariant',
      }),
      milestone('composition', 'The suite reports its verdicts into the mission readout, not only into stdout.', 'Regression results reach the player', {
        evidence: 'browser',
      }),
    ],
    claims: [architectClaim('Invariants that are not re-checked are decoration; the suite keeps the contract honest.')],
    estimateCredits: 240,
    estimateContextTokens: 28_000,
  },
  {
    key: 'accessibility-pass',
    phase: 4,
    title: 'Pass contrast, motion and keyboard checks on the readout',
    lane: 'verify',
    core: false,
    writes: ['src/missions/{mission}/accessibility-pass.ts', 'tests/missions/{mission}/accessibility-pass.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['hud-overlay'],
    verifications: [
      milestone('composition', 'The readout stays legible under reduced motion and at low contrast.', 'The mission stays readable for every player', {
        target: 'test',
        lifecycle: 'final_invariant',
        evidence: 'visual',
      }),
      milestone('build', 'The accessibility pass ships with the mission bundle, not as a side script.', 'Accessibility ships with the mission'),
    ],
    claims: [userClaim('Every player must be able to read the plan, so accessibility is a release invariant rather than a polish task.')],
    estimateCredits: 190,
    estimateContextTokens: 23_000,
  },
  {
    key: 'release-review',
    phase: 5,
    title: 'Review and ship the released mission',
    lane: 'integrate',
    core: true,
    writes: ['src/missions/{mission}/release-review.ts', 'tests/missions/{mission}/release-review.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['composition-gate'],
    verifications: [
      milestone('composition', 'Release evidence is a screenshot of the shipped mission with its plan and gates visible.', 'Release carries visual evidence, not just an exit code', {
        target: 'test',
        lifecycle: 'final_invariant',
        evidence: 'screenshot',
      }),
      milestone('build', 'The production bundle is produced from the reviewed commit.', 'The shipped bundle matches the reviewed commit', {
        lifecycle: 'final_invariant',
      }),
    ],
    claims: [architectClaim('A mission is shipped by a person who saw it work, so release evidence is a screenshot, not a log line.')],
    estimateCredits: 260,
    estimateContextTokens: 26_000,
  },
  {
    key: 'telemetry-runbook',
    phase: 5,
    title: 'Runbook the telemetry a shipped mission emits',
    lane: 'observe',
    core: false,
    writes: ['src/missions/{mission}/telemetry-runbook.ts', 'tests/missions/{mission}/telemetry-runbook.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['composition-gate'],
    verifications: [
      milestone('build', 'The runbook builds and documents each emitted signal it depends on.', 'Every signal the runbook watches is really emitted'),
      milestone('composition', 'The runbook is readable from the mission readout in a browser.', 'The runbook is reachable when it is needed', { evidence: 'browser' }),
    ],
    claims: [architectClaim('Observation is planned work with an owner, not an afterthought once the floor is on fire.')],
    estimateCredits: 180,
    estimateContextTokens: 20_000,
  },
  {
    key: 'release-notes',
    phase: 5,
    title: 'Write the release notes the player actually reads',
    lane: 'integrate',
    core: false,
    writes: ['src/missions/{mission}/release-notes.ts', 'tests/missions/{mission}/release-notes.test.ts'],
    reads: ['README.md'],
    dependsOn: ['composition-gate'],
    verifications: [
      milestone('build', 'The notes build from the plan tree rather than from memory.', 'Release notes cite the shipped plan'),
      milestone('composition', 'The notes are readable in the same surface the mission ships.', 'The player can read what changed', { evidence: 'browser' }),
    ],
    claims: [architectClaim('The plan already knows what shipped; notes are generated from it so they cannot fall out of date.')],
    estimateCredits: 140,
    estimateContextTokens: 16_000,
  },
  {
    key: 'postmortem-loop',
    phase: 5,
    title: 'Close the observation loop into the next plan',
    lane: 'observe',
    core: false,
    writes: ['src/missions/{mission}/postmortem-loop.ts', 'tests/missions/{mission}/postmortem-loop.test.ts'],
    reads: ['src/sim/state.ts'],
    dependsOn: ['composition-gate'],
    verifications: [
      milestone('test', 'Every finding raised in production becomes a candidate work item with a source claim.', 'Production findings re-enter planning', {
        target: 'test',
        lifecycle: 'final_invariant',
      }),
      milestone('build', 'The loop ships with the mission and survives a restart.', 'Observation survives the session'),
    ],
    claims: [architectClaim('What the factory learns must become the next request; otherwise the floor never improves.')],
    estimateCredits: 200,
    estimateContextTokens: 24_000,
  },
]);

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

/** What the planner needs to know before it can decompose a request. */
export interface MissionRequest {
  missionId: string;
  codename?: string;
  /** The mission objective, in the words the player was given. */
  objective: string;
  /** Authored difficulty level 1..4; defaults to {@link DEFAULT_DIFFICULTY_LEVEL}. */
  difficulty?: number;
}

/** The planner accepts a request, or the mission slice of a foundation state. */
export type PlanSource = MissionRequest | DeepReadonly<GameState>;

const DEFAULT_MISSION_ID = 'mission-coroid';
const DEFAULT_CODENAME = 'COROID';
const DEFAULT_OBJECTIVE =
  'Show what Coroid is: an autonomous software factory where agent lanes plan, build, verify and ship work.';
const DEFAULT_PLAN_SEED = 1;

function isGameStateSource(source: PlanSource): source is DeepReadonly<GameState> {
  return 'mission' in source && 'plan' in source;
}

function nonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Fill a request's blanks and clamp its difficulty. Deterministic, and the only
 * place defaults are applied, so `generatePlan` never has to guess.
 */
export function normalizeRequest(source: PlanSource): MissionRequest {
  if (isGameStateSource(source)) {
    return normalizeRequest({
      missionId: source.mission.id,
      codename: source.mission.codename,
      objective: source.mission.objective,
      difficulty: undefined,
    });
  }
  return {
    missionId: nonEmpty(source.missionId, DEFAULT_MISSION_ID),
    codename: nonEmpty(source.codename, DEFAULT_CODENAME),
    objective: nonEmpty(source.objective, DEFAULT_OBJECTIVE),
    difficulty: resolveDifficulty(source.difficulty),
  };
}

/**
 * Derive the request from a foundation fixture/runtime state.
 *
 * The mission's identity and words come from `state.mission`, so the fixture is
 * the single source of mission content: the planner never carries a content
 * catalogue of its own. `difficulty` is the one thing the state cannot tell us,
 * so the caller may pass it explicitly.
 */
export function missionRequestFromState(state: DeepReadonly<GameState>, difficulty?: number): MissionRequest {
  return normalizeRequest({
    missionId: state.mission.id,
    codename: state.mission.codename,
    objective: state.mission.objective,
    difficulty,
  });
}

/**
 * The whole authored difficulty ladder for one fixture state, low to high.
 *
 * This is how the difficulty curve is exercised without inventing mission
 * content: every variant is the same foundation request, planned at a different
 * level.
 */
export function missionRequestVariants(state: DeepReadonly<GameState>): MissionRequest[] {
  return DIFFICULTY_LADDER.map((step) => missionRequestFromState(state, step.level));
}

/** Mission id → key/path slug. `mission-coroid-holographic-factory` → `coroid-holographic-factory`. */
export function slugifyMissionId(missionId: string): string {
  const normalized = missionId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const withoutPrefix = normalized.startsWith('mission-') ? normalized.slice('mission-'.length) : normalized;
  return withoutPrefix || 'mission';
}

/* -------------------------------------------------------------------------- */
/* Outline types                                                              */
/* -------------------------------------------------------------------------- */

/** A check attached to a generated task; consumable by the verification module. */
export interface PlanCheckDeclaration {
  id: string;
  taskId: string;
  kind: PlanCheckKind;
  assertion: string;
  /** File the repair objective points at when this check fails. */
  targetFile: string;
  evidence: PlanEvidenceKind;
  /** Criterion this check is offered as evidence for; always set by the planner. */
  criterionKey: string;
  timeoutMs: number;
}

/** A criterion attached to a generated task; consumable by the verification module. */
export interface PlanCriterionDeclaration {
  key: string;
  taskId: string;
  label: string;
  requiredEvidence: PlanEvidenceKind;
  lifecycle: PlanCriterionLifecycle;
}

/** One task of a generated outline. Field names match the dependency graph's inputs. */
export interface PlanTaskOutline {
  /** Unique task key within the outline. */
  id: string;
  title: string;
  laneId: string;
  /** Zero-based authored phase the task belongs to. */
  phase: number;
  /** Upstream task keys, always in strictly earlier phases. */
  dependsOn: string[];
  /** Shared contracts this task consumes, plus everything its dependencies wrote. */
  readSet: string[];
  /** Files this task exclusively owns; never shared inside a phase. */
  writeSet: string[];
  checks: PlanCheckDeclaration[];
  criteria: PlanCriterionDeclaration[];
  sourceClaims: SourceClaim[];
  estimateCredits: number;
  estimateContextTokens: number;
}

/** One phase of a generated outline. */
export interface PlanPhaseOutline {
  index: number;
  /** Graph-compatible phase id, e.g. `phase-0`. */
  id: string;
  /** Graph-compatible label, e.g. `Phase 1`. */
  label: string;
  /** Architect-facing phase name, e.g. `Frame the request`. */
  title: string;
  intent: string;
  laneFocus: LaneKind;
  taskKeys: string[];
}

/** Derived totals, so the HUD and the economy can read the plan without a walk. */
export interface PlanOutlineSummary {
  taskCount: number;
  phaseCount: number;
  /** Largest number of tasks in one phase: how wide the mission can run. */
  maxParallelTasks: number;
  checkCount: number;
  criterionCount: number;
  claimCount: number;
  estimatedCredits: number;
  estimatedContextTokens: number;
}

/** The complete, immutable-by-convention result of planning one request. */
export interface PlanOutline {
  missionId: string;
  planId: string;
  seed: number;
  difficulty: number;
  tier: DifficultyTier;
  phases: PlanPhaseOutline[];
  /** Tasks in plan order; the order is already topological. */
  tasks: PlanTaskOutline[];
  /** Task keys in plan order, matching `tasks`. */
  order: string[];
  /** Mission-level claims: why this decomposition exists at all. */
  claims: SourceClaim[];
  /** Deterministic `plan/task-registered` script for the `plan` slice. */
  events: DomainEvent[];
  summary: PlanOutlineSummary;
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                 */
/* -------------------------------------------------------------------------- */

/** Clamp an evidence kind to what a check kind is allowed to claim. */
function resolveEvidence(kind: PlanCheckKind, evidence: PlanEvidenceKind | undefined): PlanEvidenceKind {
  if (kind !== 'composition') return 'command';
  return evidence ?? 'browser';
}

/** Trim, normalise and de-duplicate ownership paths, keeping declaration order. */
function uniquePaths(paths: readonly string[]): string[] {
  const result: string[] = [];
  for (const path of paths) {
    let normalized = path.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    while (normalized.startsWith('./')) normalized = normalized.slice(2);
    if (normalized === '' || result.includes(normalized)) continue;
    result.push(normalized);
  }
  return result;
}

function fillMission(template: string, missionSlug: string): string {
  return template.replace(/\{mission\}/g, missionSlug);
}

/**
 * Draw `count` entries from a pool using the seeded stream.
 *
 * The *number* drawn is decided by difficulty, never by the seed, so growth
 * across the ladder is guaranteed; the seed only decides which of the equally
 * valid optional workstreams are picked.
 */
function drawOptional<T>(pool: readonly T[], count: number, rng: Rng): T[] {
  if (count <= 0 || pool.length === 0) return [];
  const remaining = [...pool];
  const drawn: T[] = [];
  const wanted = Math.min(count, remaining.length);
  for (let index = 0; index < wanted; index += 1) {
    const [picked] = remaining.splice(rng.int(0, remaining.length - 1), 1);
    if (picked !== undefined) drawn.push(picked);
  }
  return drawn;
}

/** Jitter a base estimate around ±12%, drawing from the seeded stream. */
function jitterEstimate(base: number, rng: Rng): number {
  const spread = Math.max(0, Math.round(base * 0.12));
  return Math.max(1, base + rng.int(-spread, spread));
}

function objectiveClaim(request: MissionRequest): SourceClaim {
  return userClaim(`Mission request: ${request.objective}`);
}

function missionClaims(request: MissionRequest, difficulty: number, step: DifficultyStep): SourceClaim[] {
  return [
    objectiveClaim(request),
    architectClaim(
      `Decomposed into ${step.label} work (difficulty ${difficulty}/${MAX_DIFFICULTY_LEVEL}): ${step.blurb}`,
    ),
    repositoryClaim(
      'Registers through the shared plan slice (src/sim/state.ts) using plan/task-registered domain events, and is layered by construction so the dependency graph accepts it without repair.',
    ),
  ];
}

/** One workstream resolved far enough to be turned into a task. */
interface ResolvedWorkstream {
  workstream: MissionWorkstream;
  taskKey: string;
  writeSet: string[];
}

function consumptionClaims(dependsOn: readonly string[], byId: ReadonlyMap<string, PlanTaskOutline>): SourceClaim[] {
  const claims: SourceClaim[] = [];
  for (const dependency of dependsOn) {
    const upstream = byId.get(dependency);
    if (!upstream) continue;
    claims.push(
      repositoryClaim(
        `Consumes ${dependency} (${upstream.writeSet.join(', ')}), already landed in Phase ${upstream.phase + 1}.`,
      ),
    );
  }
  return claims;
}

/**
 * Decompose a mission request into a phased task outline.
 *
 * Deterministic in `(request, seed)`: the same mission id and seed always yield
 * the same phases, task keys, dependency keys and write sets. The outline is
 * layered by construction and never contains two tasks that own the same path
 * inside one phase.
 */
export function generatePlan(source: PlanSource, seed?: number): PlanOutline {
  const request = normalizeRequest(source);
  const difficulty = resolveDifficulty(request.difficulty);
  const step = difficultyStep(difficulty);
  const resolvedSeed = seed ?? (isGameStateSource(source) ? source.seed : DEFAULT_PLAN_SEED);
  const missionSlug = slugifyMissionId(request.missionId);
  const planId = `plan-${missionSlug}`;
  const rng = createRng(`${request.missionId}#${resolvedSeed}`);

  const byId = new Map<string, PlanTaskOutline>();
  const resolved = new Map<string, ResolvedWorkstream>();
  const tasks: PlanTaskOutline[] = [];
  const phases: PlanPhaseOutline[] = [];

  for (const phase of PHASE_BLUEPRINTS) {
    if (phase.minDifficulty > difficulty) continue;

    const inPhase = MISSION_WORKSTREAMS.filter((workstream) => workstream.phase === phase.index);
    const optionalPool = inPhase.filter((workstream) => !workstream.core);
    const drawn = new Set(drawOptional(optionalPool, step.extraWorkstreams, rng).map((entry) => entry.key));
    // Authored catalogue order keeps phases, and therefore plan order, stable.
    const selected = inPhase.filter((workstream) => workstream.core || drawn.has(workstream.key));

    const taskKeys: string[] = [];
    for (const workstream of selected) {
      const taskKey = `${missionSlug}-${workstream.key}`;
      const writeSet = uniquePaths(workstream.writes.map((path) => fillMission(path, missionSlug)));
      const dependsOn = workstream.dependsOn.flatMap((dependency) => {
        const upstream = resolved.get(dependency);
        return upstream ? [upstream.taskKey] : [];
      });
      const readSet = uniquePaths([
        ...workstream.reads,
        ...dependsOn.flatMap((dependency) => byId.get(dependency)?.writeSet ?? []),
      ]);

      const criteria: PlanCriterionDeclaration[] = [];
      const checks: PlanCheckDeclaration[] = [];
      workstream.verifications.forEach((verification, index) => {
        const criterionKey = `${taskKey}-criterion-${index + 1}`;
        const evidence = resolveEvidence(verification.kind, verification.evidence);
        criteria.push({
          key: criterionKey,
          taskId: taskKey,
          label: verification.criterion.label,
          requiredEvidence: evidence,
          lifecycle: verification.criterion.lifecycle,
        });
        checks.push({
          id: `${taskKey}-check-${index + 1}`,
          taskId: taskKey,
          kind: verification.kind,
          assertion: verification.assertion,
          targetFile: writeSet[verification.target === 'test' ? 1 : 0] ?? writeSet[0] ?? '',
          evidence,
          criterionKey,
          timeoutMs: verification.timeoutMs ?? CHECK_TIMEOUT_MS,
        });
      });

      const sourceClaims: SourceClaim[] = [
        ...workstream.claims.map((claim) => ({ ...claim })),
        ...(phase.index === 0 ? [objectiveClaim(request)] : []),
        ...consumptionClaims(dependsOn, byId),
      ];

      const task: PlanTaskOutline = {
        id: taskKey,
        title: workstream.title,
        laneId: laneIdFor(workstream.lane),
        phase: phase.index,
        dependsOn,
        readSet,
        writeSet,
        checks,
        criteria,
        sourceClaims,
        estimateCredits: jitterEstimate(workstream.estimateCredits, rng),
        estimateContextTokens: jitterEstimate(workstream.estimateContextTokens, rng),
      };

      tasks.push(task);
      byId.set(taskKey, task);
      resolved.set(workstream.key, { workstream, taskKey, writeSet });
      taskKeys.push(taskKey);
    }

    phases.push({
      index: phase.index,
      id: `phase-${phase.index}`,
      label: `Phase ${phase.index + 1}`,
      title: phase.title,
      intent: phase.intent,
      laneFocus: phase.laneFocus,
      taskKeys,
    });
  }

  const outline: PlanOutline = {
    missionId: request.missionId,
    planId,
    seed: resolvedSeed,
    difficulty,
    tier: step.tier,
    phases,
    tasks,
    order: tasks.map((task) => task.id),
    claims: missionClaims(request, difficulty, step),
    events: [],
    summary: {
      taskCount: tasks.length,
      phaseCount: phases.length,
      maxParallelTasks: phases.reduce((widest, phase) => Math.max(widest, phase.taskKeys.length), 0),
      checkCount: tasks.reduce((total, task) => total + task.checks.length, 0),
      criterionCount: tasks.reduce((total, task) => total + task.criteria.length, 0),
      claimCount: tasks.reduce((total, task) => total + task.sourceClaims.length, 0),
      estimatedCredits: tasks.reduce((total, task) => total + task.estimateCredits, 0),
      estimatedContextTokens: tasks.reduce((total, task) => total + task.estimateContextTokens, 0),
    },
  };

  return { ...outline, events: planOutlineEvents(outline) };
}

/* -------------------------------------------------------------------------- */
/* Domain events                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The deterministic `plan/task-registered` script for an outline.
 *
 * Registration happens in plan order, one task per {@link PLAN_EVENT_SPACING_MS}
 * starting at `baseAtMs`, so replaying the script always registers the same
 * tasks in the same order with the same dependencies.
 */
export function planOutlineEvents(outline: PlanOutline, baseAtMs = 0): DomainEvent[] {
  return outline.tasks.map((task, index) =>
    makeDomainEvent(
      'plan/task-registered',
      {
        task: {
          id: task.id,
          title: task.title,
          laneId: task.laneId,
          status: 'pending',
          progress: 0,
          dependencies: [...task.dependsOn],
        },
      },
      baseAtMs + index * PLAN_EVENT_SPACING_MS,
    ),
  );
}

/**
 * Reduce an outline's plan events into a state through the shared reducer.
 *
 * This is the planner's only contact with the runtime: it emits events onto the
 * `plan` slice and lets `reduceDomainEvent` own every state change. The caller's
 * state is never mutated.
 */
export function applyPlanOutline(state: GameState, outline: PlanOutline, baseAtMs = state.mission.elapsedMs): GameState {
  return applyDomainEvents(state, planOutlineEvents(outline, baseAtMs));
}
