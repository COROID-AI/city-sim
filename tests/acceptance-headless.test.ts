// @vitest-environment happy-dom
/**
 * End-to-end acceptance: scripted headless playthroughs, accessibility,
 * adaptive fidelity and release evidence.
 *
 * This suite is the repository's acceptance gate for the composed game. It is
 * deliberately **read-only** over the product: it imports the shipped
 * composition (`createSystems`), the frozen runtime (`createGame`), the mission
 * flow, the HUD's stable `data-hud` hooks, the adaptive governor and the perf
 * badge, and it never mutates a game, render, UI, audio or registry module. A
 * defect found here is reported as a failing criterion, not patched in place.
 *
 * What it proves, one scenario per acceptance criterion:
 *
 *  1. `scripted headless playthrough` — mission one is played from the brief
 *     through the seeded failing check and its repair to a shipped release
 *     manifest with every final invariant green; the same script replays into an
 *     identical event journal, transition list, state and manifest.
 *  2. `six-mission campaign` — every mission of the catalogue loads, plans and
 *     dispatches at least one lane through the composed runtime and wins, and a
 *     mission refuses to start until its predecessor has been delivered.
 *  3. `seeded failing check and repair` — the mission's own seeded failure shows
 *     a failed gate in the terminal, the repair objective in the terminal and the
 *     inspector, a running fix-up task on a busy lane, and recovered readiness.
 *  4. `keyboard-only and reduced motion` — mission one is completed with
 *     keyboard events alone (speed, pause/resume, approve, dispatch, panels), the
 *     host's reduced-motion preference reaches the camera rig, the audio bus and
 *     the fidelity governor and stops the idle drift, and objective/phase changes
 *     are announced through the single `aria-live` region.
 *  5. `adaptive quality under stress` — the badge's `data-hud="stress-toggle"`
 *     control drives the composed game into sustained over-budget windows, the
 *     governor downgrades a tier on its own, the badge reflects the new tier and
 *     the downgraded tier's frame budget holds.
 *  6. `release palette contract` — the shipped stylesheets still declare the
 *     contrast-checked HUD palette and the reduced-motion CSS contract that the
 *     browser matrix measures against.
 *
 * Fixed seeds
 * -----------
 * Every scenario runs on a fixed seed read from the mission catalogue's own
 * pacing seed (`getMission(key).pacing.seed`), so a run is reproducible from the
 * shipped content alone. The same seeds are recorded, with the browser scenario
 * matrix and its `data-hud` hooks, in `docs/ACCEPTANCE.md`.
 *
 * The browser half of the acceptance matrix (screen-state screenshots, the
 * keyboard/reduced-motion passes, the stress toggle and the contrast capture) is
 * executed by the browser verification provider against the dev server; this
 * suite is the headless half and runs in the node/happy-dom toolchain.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGame, type Game } from '../src/game/Game';
import {
  FLOW_PROVENANCE_KINDS,
  PHASE_TRANSITIONS,
  type MissionFlow,
  type MissionPhase,
} from '../src/game/flow';
import { createManualClock, type ManualClock } from '../src/game/loop';
import { createMissionInitialState, createSystems, type GameSystems } from '../src/game/systems';
import { MISSIONS, getMission, type MissionKey } from '../src/content/missions';
import { createHeadlessAdapter } from '../src/render/headless';
import {
  QUALITY_TIER_RANK,
  QUALITY_TIER_SETTINGS,
  QUALITY_WINDOW_SIZE,
  type AppliedQualitySettings,
  type QualityTier,
} from '../src/render/qualityTiers';
import type { RenderAdapter } from '../src/render/renderer';
import { PERF_HUD_KEYS } from '../src/ui/perfBadge';
import { PROVENANCE_KINDS, type ProvenanceKind } from '../src/ui/hud';

/* -------------------------------------------------------------------------- */
/* Fixed scenario parameters                                                  */
/* -------------------------------------------------------------------------- */

/** Fixed step every scenario runs at: the runtime's 60 Hz default. */
const STEP_MS = 1000 / 60;
/** The campaign, in catalogue order. */
const CAMPAIGN_KEYS: readonly MissionKey[] = MISSIONS.map((mission) => mission.key);
/** Mission the playthrough, repair, accessibility and stress scenarios play. */
const MISSION_ONE: MissionKey = MISSIONS[0]?.key ?? 'request-to-plan';
/** Frames a scenario may spend before it is reported as stuck. */
const FRAME_BUDGET = 20_000;
/** Modelled extra work per frame: a load the calm tier cannot carry. */
const STRESS_LOAD_MS = 20;

/** The seed a mission's own pacing assigns it. Never invented here. */
function missionSeed(key: MissionKey): number {
  return getMission(key)?.pacing.seed ?? 0;
}

/**
 * Seed recorded for every scenario of this suite, and for the browser matrix.
 *
 * `playthrough`, `replay`, `repair`, `keyboard`, `reducedMotion` and
 * `qualityStress` all play mission one and therefore share its pacing seed; the
 * campaign scenario runs each mission on its own. `docs/ACCEPTANCE.md` reproduces
 * this table.
 */
const SCENARIO_SEEDS: Readonly<Record<string, number>> = Object.freeze({
  playthrough: missionSeed(MISSION_ONE),
  replay: missionSeed(MISSION_ONE),
  repair: missionSeed(MISSION_ONE),
  keyboard: missionSeed(MISSION_ONE),
  reducedMotion: missionSeed(MISSION_ONE),
  qualityStress: missionSeed(MISSION_ONE),
  ...Object.fromEntries(CAMPAIGN_KEYS.map((key) => [`campaign:${key}`, missionSeed(key)])),
});

/* -------------------------------------------------------------------------- */
/* Composed-runtime harness                                                   */
/* -------------------------------------------------------------------------- */

interface ComposedRun {
  readonly game: Game;
  readonly bundle: GameSystems;
  readonly adapter: RenderAdapter;
  readonly clock: ManualClock;
  readonly host: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly missionKey: MissionKey;
  readonly seed: number;
  readonly flow: MissionFlow;
  /** Frames this run has advanced, for evidence. */
  frames: number;
  dispose(): void;
}

interface BootOptions {
  missionKey?: MissionKey;
  deliveredMissionKeys?: readonly string[];
  autoStart?: boolean;
  autoApprove?: boolean;
  qualityTier?: QualityTier;
  seed?: number;
}

const openRuns: ComposedRun[] = [];

afterEach(() => {
  for (const run of openRuns.splice(0)) run.dispose();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/**
 * Boot the shipped composition over the headless adapter with a manual clock.
 *
 * The manual clock is what makes the headless half honest: the mission, the
 * systems and the fidelity governor all advance by exactly the frame time the
 * scenario hands them, so a run is reproducible down to the millisecond instead
 * of depending on how fast the test host happens to be.
 */
function boot(options: BootOptions = {}): ComposedRun {
  const missionKey = options.missionKey ?? MISSION_ONE;
  const seed = options.seed ?? missionSeed(missionKey);
  const host = document.createElement('div');
  host.id = 'acceptance-host';
  document.body.append(host);
  const canvas = document.createElement('canvas');
  canvas.dataset.coroidCanvas = 'true';
  host.append(canvas);

  const bundle = createSystems({
    missionKey,
    deliveredMissionKeys: options.deliveredMissionKeys ?? [],
    autoStart: options.autoStart ?? false,
    autoApprove: options.autoApprove ?? false,
    canvas,
    interfaceHost: host,
    ...(options.qualityTier ? { qualityTier: options.qualityTier } : {}),
  });
  const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
  const clock = createManualClock(0);
  const game = createGame({
    adapter,
    systems: bundle.list,
    state: createMissionInitialState(missionKey),
    seed,
    clock,
    stepMs: STEP_MS,
  });

  const flow = bundle.mission.flow;
  if (!flow) throw new Error('[acceptance] the mission flow failed to attach');

  const run: ComposedRun = {
    game,
    bundle,
    adapter,
    clock,
    host,
    canvas,
    missionKey,
    seed,
    flow,
    frames: 0,
    dispose(): void {
      const index = openRuns.indexOf(run);
      if (index >= 0) openRuns.splice(index, 1);
      game.dispose();
      host.remove();
    },
  };
  openRuns.push(run);
  return run;
}

/** Advance a run by whole frames of an explicit frame time. */
function advanceFrames(run: ComposedRun, frames: number, frameMs = STEP_MS): void {
  for (let frame = 0; frame < frames; frame += 1) {
    run.clock.advance(frameMs);
    run.game.advance(frameMs);
    run.frames += 1;
  }
}

/** Advance until the mission reaches a terminal outcome. Returns frames spent. */
function playToTerminal(run: ComposedRun, maxFrames = FRAME_BUDGET): number {
  let frames = 0;
  while (run.flow.outcome === 'running' && frames < maxFrames) {
    advanceFrames(run, 1);
    frames += 1;
  }
  return frames;
}

/**
 * Let a few more frames run after the terminal outcome.
 *
 * A live page keeps painting after the mission is won, which is how the last
 * domain events (mission status `delivered`) reach the runtime state, the HUD
 * and the event terminal. The browser scenario matrix sees the same settling.
 */
function settle(run: ComposedRun, frames = 8): void {
  advanceFrames(run, frames);
}

/* -------------------------------------------------------------------------- */
/* Stable DOM hook helpers                                                    */
/* -------------------------------------------------------------------------- */

/** One element matching a stable `data-hud` hook. */
function hud<T extends HTMLElement = HTMLElement>(key: string): T | null {
  return document.querySelector<T>(`[data-hud="${key}"]`);
}

/** Every element matching a stable `data-hud` hook. */
function hudAll<T extends HTMLElement = HTMLElement>(key: string): T[] {
  return [...document.querySelectorAll<T>(`[data-hud="${key}"]`)];
}

/** Text of a hook, or the empty string when it is absent. */
function hudText(key: string): string {
  return hud(key)?.textContent?.trim() ?? '';
}

/** Press one key where the composed input router listens. */
function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** The event terminal's lines, as `source|provenance|text`. */
function logTexts(): string[] {
  return hudAll('log-line').map(
    (line) => `${line.dataset.source ?? ''}|${line.dataset.provenance ?? ''}|${line.textContent ?? ''}`,
  );
}

/** Open one modal panel through the HUD's own button, as the browser matrix does. */
function openPanel(run: ComposedRun, action: 'inspector' | 'outline' | 'report' | 'codex'): void {
  hud<HTMLButtonElement>(`action-${action}`)?.click();
  advanceFrames(run, 1);
}

/** Close whatever modal panel is open. */
function closePanel(): void {
  press('Escape');
}

/* -------------------------------------------------------------------------- */
/* Frame-cost model and motion/quality host stubs                             */
/* -------------------------------------------------------------------------- */

/**
 * Frame-cost model of the fidelity loop.
 *
 * Cost rises with the four settings a tier writes — pixel ratio, the post chain,
 * shadows and instances — and never falls below the fixed step the runtime
 * already spends simulating. It is the monotone cost model the governor must
 * converge under, not a prediction of any GPU: the closed loop is what proves
 * the downgrade actually buys back the budget.
 */
function modelFrameMs(applied: AppliedQualitySettings, load: number, stepMs: number): number {
  const fill = applied.pixelRatio * applied.pixelRatio;
  const postFactor = applied.post ? 1 : 0.4;
  const shadowFactor = applied.shadows ? 1.3 : 1;
  const instanceFactor = 1 + applied.instanceCount / 4096;
  return stepMs + load * fill * postFactor * shadowFactor * instanceFactor;
}

/** Advance frames whose cost follows the settings the governor just applied. */
function driveModelledFrames(run: ComposedRun, frames: number, load = STRESS_LOAD_MS): void {
  for (let frame = 0; frame < frames; frame += 1) {
    advanceFrames(run, 1, modelFrameMs(run.bundle.quality.applied, load, STEP_MS));
  }
}

/** Answer the host's reduced-motion media query with `matches`. */
function stubReducedMotion(matches: boolean): () => void {
  const original = window.matchMedia;
  const stub = ((query: string) => ({
    matches: matches && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.matchMedia = stub;
  return () => {
    window.matchMedia = original;
  };
}

/** Every phase a flow's transition log has been through, plus where it started. */
function visitedPhases(flow: MissionFlow): Set<MissionPhase> {
  const visited = new Set<MissionPhase>(['brief']);
  for (const transition of flow.transitions()) {
    visited.add(transition.from);
    visited.add(transition.to);
  }
  return visited;
}

/* -------------------------------------------------------------------------- */
/* Scenario: scripted headless playthrough                                    */
/* -------------------------------------------------------------------------- */

describe('acceptance: scripted headless playthrough of mission one', () => {
  it('plays brief to a shipped release manifest with every final invariant green', () => {
    const run = boot();
    const flow = run.flow;
    const mission = getMission(MISSION_ONE);
    const errors = vi.spyOn(console, 'error');
    expect(run.seed, 'the playthrough runs on the mission catalogue seed').toBe(
      SCENARIO_SEEDS.playthrough,
    );

    /* ── Brief: the intake desk; nothing runs until the request is acknowledged. */
    // One frame lets the interface render its first readout; the mission itself
    // does not advance while the brief is unacknowledged.
    advanceFrames(run, 1);
    expect(flow.phase).toBe('brief');
    expect(flow.outcome).toBe('running');
    expect(hudText('mission-status')).toBe('bootstrapping');
    expect(hudText('objective')).toBe(mission?.objective ?? '');
    expect(flow.snapshot().plan.length).toBe(0);
    expect(flow.simMs).toBe(0);
    expect(flow.snapshot().agents.activeAgents).toBe(0);
    expect(flow.events().some((event) => event.type === 'lane/assigned')).toBe(false);
    expect(run.bundle.cameraRig.rig?.state).toBe('brief');

    /* ── Plan: the request decomposes into layered, owned, checkable tasks. */
    const plan = flow.start();
    expect(plan, 'the brief acknowledges into the plan').not.toBeNull();
    expect(flow.phase).toBe('approve');
    const rows = flow.taskRows();
    expect(rows.length).toBeGreaterThanOrEqual(mission?.pacing.planTasks ?? 1);
    for (const row of rows) {
      expect(row.title.length, row.id).toBeGreaterThan(0);
      expect(row.writeSet.length, `${row.id} declares ownership`).toBeGreaterThan(0);
      expect(row.readSet.length, `${row.id} declares what it reads`).toBeGreaterThan(0);
      expect(row.checkIds.length, `${row.id} declares a check`).toBeGreaterThan(0);
      expect(row.criterionKeys.length, `${row.id} is scored by a criterion`).toBeGreaterThan(0);
      expect(FLOW_PROVENANCE_KINDS).toContain(row.provenance);
    }

    /* ── Approve → dispatch: the human gate opens the floor. */
    expect(flow.approve(), 'the plan approves into the floor').not.toBeNull();
    expect(flow.phase).toBe('dispatch');
    advanceFrames(run, 2);
    expect(flow.snapshot().agents.activeAgents).toBeGreaterThan(0);
    expect(flow.events().some((event) => event.type === 'lane/assigned')).toBe(true);

    /* ── Execute → verify → repair → release. */
    const frames = playToTerminal(run);
    settle(run);
    expect(frames, 'mission one is winnable').toBeLessThan(FRAME_BUDGET);
    expect(flow.outcome).toBe('won');
    expect(flow.lossKind).toBeNull();
    expect(flow.phase).toBe('release');

    const visited = visitedPhases(flow);
    for (const phase of [
      'brief',
      'plan',
      'approve',
      'dispatch',
      'verify',
      'repair',
      'release',
    ] as const) {
      expect(visited, `phase ${phase} is reached`).toContain(phase);
    }
    for (const transition of flow.transitions()) {
      expect(PHASE_TRANSITIONS[transition.from], `${transition.from} -> ${transition.to}`).toContain(
        transition.to,
      );
      expect(transition.events.length, transition.id).toBeGreaterThan(0);
      expect(transition.text.length, transition.id).toBeGreaterThan(0);
      expect(FLOW_PROVENANCE_KINDS).toContain(transition.provenance);
    }
    // The transition log is a view of the emitted journal, not a second history.
    const emitted = new Set(flow.events().map((event) => JSON.stringify(event)));
    for (const transition of flow.transitions()) {
      for (const event of transition.events) {
        expect(emitted.has(JSON.stringify(event)), transition.id).toBe(true);
      }
    }

    /* ── Release: the manifest, the invariants and the criterion lifecycles. */
    const snapshot = flow.snapshot();
    const manifest = flow.manifest();
    expect(manifest.shipped).toBe(true);
    expect(manifest.shippedAtMs).not.toBeNull();
    expect(manifest.missionId).toBe(mission?.id ?? '');
    expect(manifest.entries.length).toBeGreaterThan(0);
    expect(manifest.coverageRatio).toBe(1);
    expect(manifest.provenanceRatio).toBe(1);
    for (const entry of manifest.entries) {
      expect(entry.evidenceCheckIds.length, entry.id).toBeGreaterThan(0);
      expect(entry.title.length, entry.id).toBeGreaterThan(0);
      expect(FLOW_PROVENANCE_KINDS).toContain(entry.provenance);
      // Planned work is scored by criteria of its own; a fix-up wave ships with
      // the evidence of the task it repaired instead (`closeRepairChain`), so it
      // carries checks but no criterion of its own.
      const row = snapshot.plan.find((candidate) => candidate.id === entry.taskId);
      if (row?.origin === 'plan') {
        expect(entry.criterionKeys.length, entry.id).toBeGreaterThan(0);
      }
    }
    // The repair wave the seeded failure opened is part of the shipped manifest.
    expect(manifest.entries.some((entry) => entry.taskId.startsWith('fixup-'))).toBe(true);

    // Every *final invariant* is green: readiness is decided by final invariants
    // only, and the quality graph reports nothing left at risk.
    expect(snapshot.verification.readiness.finalInvariantKeys.length).toBeGreaterThan(0);
    expect(snapshot.verification.readiness.unmetKeys).toEqual([]);
    expect(snapshot.verification.readiness.ready).toBe(true);
    expect(snapshot.quality.invariantsAtRisk).toBe(0);
    expect(snapshot.quality.ready).toBe(true);
    expect(snapshot.verdict.outcome).toBe('won');
    expect(snapshot.verdict.blockingObjectiveIds).toEqual([]);

    // Criterion lifecycles survive the repair: milestones, final invariants and
    // at least one superseded commitment.
    const ledgerCriteria = Object.values(flow.ledger().criteria);
    expect(ledgerCriteria.length).toBeGreaterThan(0);
    expect(ledgerCriteria.some((criterion) => criterion.lifecycle === 'final_invariant')).toBe(true);
    for (const criterion of ledgerCriteria) {
      expect(['milestone', 'final_invariant', 'superseded']).toContain(
        criterion.lifecycle ?? 'milestone',
      );
    }

    /* ── The release screen shows the same verdict through its own hooks. */
    expect(hudText('mission-status')).toBe('delivered');
    expect(hudText('mission-progress-label')).toBe('100% shipped');
    expect(hud('mission-progress')?.getAttribute('aria-valuenow')).toBe('100');
    expect(hudText('codename')).toBe(mission?.codename ?? '');
    expect(hudText('mission-id')).toBe(mission?.id ?? '');

    openPanel(run, 'report');
    const report = hud('panel-report');
    expect(report).not.toBeNull();
    expect(hudText('report-pass-rate')).toBe('100%');
    expect(hudText('report-invariants')).toMatch(/hold$/);
    const gateStatuses = hudAll('gate-status').map((chip) => chip.dataset.status ?? '');
    expect(gateStatuses.length).toBeGreaterThan(0);
    expect(gateStatuses.every((status) => status === 'passed')).toBe(true);
    expect(hudAll('report-metric').length).toBeGreaterThan(0);
    const lifecycles = new Set(hudAll('metric-state').map((chip) => chip.dataset.lifecycle ?? ''));
    expect(lifecycles.has('final_invariant')).toBe(true);
    expect([...lifecycles].every((value) => value === 'final_invariant' || value === 'milestone')).toBe(
      true,
    );

    // The terminal is provenance-tagged: the release screen's mission summary.
    const lines = logTexts();
    expect(lines.length).toBeGreaterThan(0);
    const provenance = new Set(lines.map((line) => line.split('|')[1] ?? ''));
    expect(provenance.size).toBeGreaterThanOrEqual(2);
    for (const kind of provenance) {
      expect(PROVENANCE_KINDS).toContain(kind as ProvenanceKind);
    }

    expect(errors).not.toHaveBeenCalled();
  });

  it('replays the same script into an identical journal, state and manifest', () => {
    const first = replayScript();
    const second = replayScript();

    expect(first.journal.length, 'the script emits a journal to replay').toBeGreaterThan(0);
    expect(second.journal).toEqual(first.journal);
    expect(second.transitions).toEqual(first.transitions);
    expect(second.state).toBe(first.state);
    expect(second.manifest).toBe(first.manifest);
    expect(second.terminal).toEqual(first.terminal);
    expect(second.phase).toBe('release');
    expect(second.outcome).toBe(first.outcome);
    expect(first.outcome).toBe('won');
  });
});

interface ReplayEvidence {
  readonly journal: readonly string[];
  readonly transitions: readonly string[];
  readonly state: string;
  readonly manifest: string;
  readonly terminal: readonly string[];
  readonly phase: MissionPhase;
  readonly outcome: string;
}

/**
 * One scripted playthrough of mission one through the composed runtime.
 *
 * The script is fixed: the composed arc auto-starts and auto-approves, then the
 * scenario advances fixed frames for a fixed budget. Nothing in it reads the
 * clock, the DOM or the host, so two calls must produce byte-identical evidence.
 */
function replayScript(): ReplayEvidence {
  const run = boot({ autoStart: true, autoApprove: true });
  const journal: string[] = [];
  const stop = run.game.events.on((event) => journal.push(JSON.stringify(event)));
  const frames = playToTerminal(run);
  settle(run, 4);
  stop();
  const evidence: ReplayEvidence = {
    journal,
    transitions: run.flow.transitions().map((transition) => JSON.stringify(transition)),
    state: JSON.stringify(run.flow.state),
    manifest: JSON.stringify(run.flow.manifest()),
    terminal: logTexts(),
    phase: run.flow.phase,
    outcome: run.flow.outcome,
  };
  expect(frames).toBeLessThan(FRAME_BUDGET);
  run.dispose();
  return evidence;
}

/* -------------------------------------------------------------------------- */
/* Scenario: six-mission campaign                                             */
/* -------------------------------------------------------------------------- */

describe('acceptance: six-mission campaign', () => {
  it('loads, plans and dispatches every mission, honouring unlock progression', () => {
    const errors = vi.spyOn(console, 'error');
    const delivered: string[] = [];
    const rows: { key: string; seed: number; frames: number; lanes: string[]; entries: number }[] = [];

    for (const mission of MISSIONS) {
      const run = boot({
        missionKey: mission.key,
        deliveredMissionKeys: [...delivered],
      });
      const flow = run.flow;
      expect(flow.campaign().unlocked, `${mission.key} is unlocked by its predecessor`).toBe(true);
      expect(flow.campaign().currentKey).toBe(mission.key);
      expect(flow.campaign().lockedKeys).not.toContain(mission.key);
      expect(run.seed).toBe(SCENARIO_SEEDS[`campaign:${mission.key}`]);

      const assigned: string[] = [];
      const stop = run.game.events.on((event) => {
        if (event.type === 'lane/assigned') assigned.push(event.laneId);
      });
      expect(flow.start(), `${mission.key} plans`).not.toBeNull();
      expect(flow.approve(), `${mission.key} dispatches`).not.toBeNull();
      const frames = playToTerminal(run);
      settle(run, 4);
      stop();

      const snapshot = flow.snapshot();
      expect(frames, mission.key).toBeLessThan(FRAME_BUDGET);
      expect(flow.outcome, `${mission.key} is winnable`).toBe('won');
      expect(snapshot.verification.readiness.ready, mission.key).toBe(true);
      expect(snapshot.verification.readiness.unmetKeys, mission.key).toEqual([]);
      expect(snapshot.quality.invariantsAtRisk, mission.key).toBe(0);
      expect(snapshot.plan.length, `${mission.key} registered its plan`).toBeGreaterThan(0);
      // At least one lane carried work, and the lane is one the mission asked for.
      expect(assigned.length, `${mission.key} dispatched work`).toBeGreaterThan(0);
      expect(new Set(assigned).size, mission.key).toBeGreaterThanOrEqual(1);
      expect(flow.manifest().shipped, mission.key).toBe(true);
      expect(flow.manifest().entries.length, mission.key).toBeGreaterThan(0);

      rows.push({
        key: mission.key,
        seed: mission.pacing.seed,
        frames,
        lanes: [...new Set(assigned)],
        entries: flow.manifest().entries.length,
      });
      delivered.push(mission.key);
      expect(flow.campaign().deliveredKeys).toEqual(delivered);
      run.dispose();
    }

    // The catalogue order is the unlock order, and every mission delivered.
    expect(rows.map((row) => row.key)).toEqual([...CAMPAIGN_KEYS]);
    expect(delivered).toEqual([...CAMPAIGN_KEYS]);
    expect(rows.every((row) => row.frames > 0 && row.entries > 0)).toBe(true);

    /* A later mission stays locked until its predecessor ships. */
    const lastKey = CAMPAIGN_KEYS[CAMPAIGN_KEYS.length - 1] ?? MISSION_ONE;
    const gated = boot({ missionKey: lastKey, deliveredMissionKeys: [] });
    expect(gated.flow.campaign().unlocked).toBe(false);
    expect(gated.flow.campaign().lockedKeys).toContain(lastKey);
    expect(gated.flow.isUnlocked()).toBe(false);
    expect(gated.flow.start(), 'a locked mission refuses to start').toBeNull();
    expect(gated.flow.phase).toBe('brief');
    advanceFrames(gated, 30);
    expect(gated.flow.snapshot().plan.length).toBe(0);
    expect(gated.game.state.plan.order.length).toBe(0);
    expect(gated.flow.events().some((event) => event.type === 'lane/assigned')).toBe(false);
    gated.dispose();

    expect(errors).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Scenario: the seeded failing check and its repair                          */
/* -------------------------------------------------------------------------- */

describe('acceptance: the seeded failing check and its repair', () => {
  it('shows the failed gate, the repair objective, a running fix-up lane and recovered readiness', () => {
    const run = boot();
    const flow = run.flow;
    expect(run.seed).toBe(SCENARIO_SEEDS.repair);

    // The seeded arc, driven through the documented hotkeys: approve the brief,
    // then let the mission's own dice (5 % per run, mission seed) raise the fault.
    press('a');
    press('a');
    advanceFrames(run, 1);

    const seen = {
      runtimeFailedGates: 0,
      failedGateLine: '',
      repairLogLine: '',
      repairAnnouncement: '',
      openRepairObjective: false,
      readinessDropped: false,
      repairTaskId: '',
      repairTaskRunning: false,
      busyLane: false,
      inspectorFailedCheck: false,
      reportFailedGate: false,
    };

    let frames = 0;
    while (flow.outcome === 'running' && frames < FRAME_BUDGET) {
      advanceFrames(run, 1);
      frames += 1;
      const snapshot = flow.snapshot();

      const runtimeFailed = Object.values(run.game.state.verification.gates).filter(
        (gate) => gate.status === 'failed',
      ).length;
      seen.runtimeFailedGates = Math.max(seen.runtimeFailedGates, runtimeFailed);
      if (snapshot.verification.openRepairObjectiveIds.length > 0) seen.openRepairObjective = true;
      if (!snapshot.verification.readiness.ready) seen.readinessDropped = true;

      for (const line of logTexts()) {
        const [source = '', , text = ''] = line.split('|');
        if (source === 'verification/run' && text.includes('→ failed')) seen.failedGateLine = line;
        if (source === 'plan/task-registered' && text.includes('Repair "')) seen.repairLogLine = line;
      }

      const announcement = hud('live')?.dataset.message ?? '';
      if (announcement.includes('Mission phase → repair')) seen.repairAnnouncement = announcement;
      if (hudAll('lane').some((chip) => chip.dataset.busy === 'true')) seen.busyLane = true;

      const repairRow = snapshot.plan.find((row) => row.origin === 'repair');
      if (repairRow) {
        seen.repairTaskId = repairRow.id;
        if (repairRow.status === 'running') seen.repairTaskRunning = true;

        // While the fix-up is in flight, the inspector shows the failed check
        // that opened the repair objective — the contract the panel layer shares
        // with the mission.
        if (!seen.inspectorFailedCheck) {
          const contracts = run.bundle.mission.contracts();
          const failedTaskId = Object.keys(contracts).find((taskId) =>
            contracts[taskId]?.checks?.some((check) => check.status === 'failed'),
          );
          if (failedTaskId) {
            // Selecting a subject is what the plan outline's row click does.
            run.bundle.panels.host?.selectTask(failedTaskId);
            openPanel(run, 'inspector');
            if (hudText('inspector-task-id') === failedTaskId) {
              seen.inspectorFailedCheck = hudAll('check-status').some(
                (chip) => chip.dataset.status === 'failed',
              );
            }
            openPanel(run, 'report');
            seen.reportFailedGate = hudAll('gate-status').some(
              (chip) => chip.dataset.status === 'failed',
            );
            closePanel();
          }
        }
      }
    }

    expect(seen.runtimeFailedGates, 'the seeded run really failed a gate').toBeGreaterThan(0);
    expect(seen.failedGateLine, 'the failed gate reaches the terminal').toContain('→ failed');
    expect(seen.repairLogLine, 'the repair objective reaches the terminal').toContain('Repair "');
    expect(seen.repairAnnouncement, 'the repair phase is announced').toBe('Mission phase → repair');
    expect(seen.openRepairObjective, 'a repair objective is opened').toBe(true);
    expect(seen.readinessDropped, 'readiness recovers from a red gate').toBe(true);
    expect(seen.repairTaskId.length, 'a fix-up task is registered').toBeGreaterThan(0);
    expect(seen.repairTaskRunning, 'the fix-up lane runs the repair').toBe(true);
    expect(seen.busyLane, 'a lane chip reports busy work').toBe(true);
    expect(seen.inspectorFailedCheck, 'the inspector shows the failed check').toBe(true);
    expect(seen.reportFailedGate, 'the report shows the failed gate card').toBe(true);

    // …and the repair closes: readiness recovers and the release still ships.
    const snapshot = flow.snapshot();
    expect(flow.outcome).toBe('won');
    expect(snapshot.verification.openRepairObjectiveIds).toEqual([]);
    expect(snapshot.readings.metrics?.['failures-repaired'] ?? 0).toBeGreaterThanOrEqual(1);
    expect(snapshot.verification.readiness.ready).toBe(true);
    expect(snapshot.quality.invariantsAtRisk).toBe(0);
    expect(flow.manifest().shipped).toBe(true);
    expect(
      snapshot.plan.some((row) => row.origin === 'repair' && row.status === 'passed'),
    ).toBe(true);

    openPanel(run, 'report');
    expect(hudAll('gate-status').every((chip) => chip.dataset.status === 'passed')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Scenario: keyboard-only play, reduced motion and aria-live                 */
/* -------------------------------------------------------------------------- */

describe('acceptance: accessibility', () => {
  it('completes mission one with keyboard events alone', () => {
    const run = boot();
    const flow = run.flow;
    const router = run.bundle.input.router;
    expect(router).not.toBeNull();

    // `4` selects the fastest documented speed.
    press('4');
    expect(flow.speed).toBe(4);
    expect(router?.time.speed).toBe(4);

    // Space pauses and resumes without letting the mission clock move.
    const pausedAt = flow.simMs;
    const planAtPause = flow.snapshot().plan.length;
    press(' ');
    expect(flow.paused).toBe(true);
    advanceFrames(run, 30);
    expect(flow.simMs).toBe(pausedAt);
    expect(flow.snapshot().plan.length).toBe(planAtPause);
    expect(flow.outcome).toBe('running');
    press(' ');
    expect(flow.paused).toBe(false);

    // `A` acknowledges the brief and approves the plan; `D` dispatches work.
    press('a');
    expect(flow.phase).toBe('approve');
    advanceFrames(run, 2);
    press('a');
    expect(flow.phase).toBe('dispatch');
    advanceFrames(run, 2);
    expect(router?.stepFocus(1)).toBe(true);
    press('d');
    advanceFrames(run, 4);
    expect(flow.snapshot().plan.some((row) => row.status !== 'pending')).toBe(true);

    // Panels open and close from the keyboard alone.
    press('v');
    expect(run.bundle.panels.host?.open).toBe('report');
    expect(hud('panel-report')).not.toBeNull();
    press('Escape');
    expect(run.bundle.panels.host?.open).toBeNull();

    const frames = playToTerminal(run);
    settle(run);
    expect(frames).toBeLessThan(FRAME_BUDGET);
    expect(flow.outcome).toBe('won');
    expect(flow.phase).toBe('release');
    expect(flow.manifest().shipped).toBe(true);
    expect(flow.snapshot().agents.activeAgents).toBe(0);
    expect(router?.focusedTaskId).toBeTruthy();
  });

  it('suppresses the camera rig motion when the host prefers reduced motion', () => {
    const restore = stubReducedMotion(true);
    try {
      const run = boot();
      const rig = run.bundle.cameraRig.rig;
      expect(rig).not.toBeNull();
      const openingAzimuth = rig?.pose.azimuth ?? Number.NaN;
      advanceFrames(run, 120);
      // The idle drift is the rig's motion layer: with reduced motion the pose
      // must be bit-identical, not merely small.
      expect(rig?.pose.azimuth).toBe(openingAzimuth);
      expect(rig?.transitioning).toBe(false);
      expect(rig?.mode).toBe('named');
      expect(rig?.state).toBe('brief');
      // The preference reaches the composed systems, not just the stylesheet.
      expect(run.bundle.audio.bus?.reducedMotion).toBe(true);
      expect(run.bundle.quality.signals.reducedMotion).toBe(true);
      run.dispose();
    } finally {
      restore();
    }

    // Control: without the preference the same frames move the camera.
    const run = boot();
    const rig = run.bundle.cameraRig.rig;
    const openingAzimuth = rig?.pose.azimuth ?? Number.NaN;
    advanceFrames(run, 120);
    expect(rig?.pose.azimuth).not.toBe(openingAzimuth);
    expect(run.bundle.audio.bus?.reducedMotion).toBe(false);
    expect(run.bundle.quality.signals.reducedMotion).toBe(false);
  });

  it('announces objective, phase and invariant changes through the aria-live region', () => {
    const run = boot({ autoStart: true, autoApprove: true });
    const live = hud('live');
    expect(live, 'the HUD publishes a single live region').not.toBeNull();
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.getAttribute('aria-atomic')).toBe('true');

    const messages: string[] = [];
    let frames = 0;
    while (run.flow.outcome === 'running' && frames < FRAME_BUDGET) {
      advanceFrames(run, 1);
      frames += 1;
      const message = hud('live')?.dataset.message ?? '';
      if (message && messages[messages.length - 1] !== message) messages.push(message);
    }
    settle(run);

    const phaseMessages = messages.filter((message) => message.startsWith('Mission phase → '));
    for (const phase of ['dispatch', 'repair', 'verify', 'release']) {
      expect(phaseMessages, `the ${phase} phase is announced`).toContain(`Mission phase → ${phase}`);
    }
    expect(messages.some((message) => message.startsWith('Invariant settled'))).toBe(true);
    // The release changes the banner's objective/status, which also announces.
    expect(hudText('live')).toMatch(/^(Mission |Objective updated:)/);
    expect(hudText('mission-status')).toBe('delivered');
  });
});

/* -------------------------------------------------------------------------- */
/* Scenario: adaptive quality under stress                                    */
/* -------------------------------------------------------------------------- */

describe('acceptance: adaptive quality under stress', () => {
  it('downgrades a tier through the stress control and holds the tier budget', () => {
    const run = boot({ qualityTier: 'calm' });
    const quality = run.bundle.quality;

    expect(quality.tier).toBe('calm');
    expect(hudText(PERF_HUD_KEYS.tier)).toBe('CALM');
    expect(hud(PERF_HUD_KEYS.badge)).not.toBeNull();

    // The acceptance control is a real, clickable button on the badge.
    const stressButton = hud<HTMLButtonElement>(PERF_HUD_KEYS.stress);
    expect(stressButton, 'the badge publishes the stress control').not.toBeNull();
    expect(stressButton?.dataset.stress).toBe('off');
    stressButton?.click();
    expect(quality.stressActive).toBe(true);
    const stressedRank = QUALITY_TIER_RANK[quality.tier];

    // Sustained over-budget frames: the governor sheds on its own until the
    // cheaper configuration's budget is measured holding again.
    let frames = 0;
    const cap = QUALITY_WINDOW_SIZE * 16;
    while (
      (QUALITY_TIER_RANK[quality.tier] >= stressedRank || !quality.stats.budgetHeld) &&
      frames < cap
    ) {
      driveModelledFrames(run, 1);
      frames += 1;
    }
    expect(frames, 'the governor downgrades under sustained load').toBeLessThan(cap);
    expect(QUALITY_TIER_RANK[quality.tier]).toBeLessThan(stressedRank);
    expect(quality.tier, 'the runaway configuration is abandoned').toBe('minimal');
    expect(quality.applied.tier).toBe(quality.tier);
    expect(run.adapter.pixelRatio).toBe(QUALITY_TIER_SETTINGS[quality.tier].pixelRatio);

    // The downgrade is visible on the badge, not only in the governor.
    driveModelledFrames(run, QUALITY_WINDOW_SIZE * 2);
    expect(hudText(PERF_HUD_KEYS.tier)).toBe(quality.tier.toUpperCase());
    expect(hud(PERF_HUD_KEYS.badge)?.dataset.tier).toBe(quality.tier);
    expect(hud<HTMLButtonElement>(PERF_HUD_KEYS.stress)?.dataset.stress).toBe('on');
    expect(hud<HTMLButtonElement>(PERF_HUD_KEYS.stress)?.getAttribute('aria-pressed')).toBe('true');
    expect(hud(PERF_HUD_KEYS.mode)?.dataset.hold).toBe('false');

    // The selected tier's budget holds: median inside the target and p95 inside
    // the ceiling, which is what "the frame budget is preserved" means here.
    const stats = quality.stats;
    expect(stats.budgetMs).toBe(QUALITY_TIER_SETTINGS[quality.tier].budget.targetMs);
    expect(stats.samples).toBeGreaterThan(0);
    expect(stats.medianMs).toBeLessThanOrEqual(stats.budgetMs);
    expect(stats.p95Ms).toBeLessThanOrEqual(stats.budgetMs * 2);
    expect(stats.budgetHeld).toBe(true);
    expect(hudText(PERF_HUD_KEYS.verdict)).toBe('INSIDE BUDGET');
    expect(hudAll('lane').length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Scenario: the release palette and motion contracts                         */
/* -------------------------------------------------------------------------- */

describe('acceptance: release palette and motion contract', () => {
  it('keeps the contrast-checked palette and the reduced-motion CSS contract', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles/hud.css'), 'utf8');

    // Every interactive HUD colour is declared with the ratio it was measured
    // against, which is what the browser contrast capture re-checks.
    const palette: readonly [string, RegExp][] = [
      ['--hud-ink: #e8f7ff', /--hud-ink: #e8f7ff; \/\* \d+(?:\.\d+)?:1 \*\//],
      ['--hud-muted: #9fbdcd', /--hud-muted: #9fbdcd; \/\* \d+(?:\.\d+)?:1 \*\//],
      ['--hud-cyan: #35f0ff', /--hud-cyan: #35f0ff; \/\* \d+(?:\.\d+)?:1 \*\//],
      ['--hud-ok: #59ff9b', /--hud-ok: #59ff9b; \/\* \d+(?:\.\d+)?:1 \*\//],
      ['--hud-alarm: #ff5c7a', /--hud-alarm: #ff5c7a; \/\* \d+(?:\.\d+)?:1 \*\//],
    ];
    for (const [name, pattern] of palette) {
      expect(stylesheet, name).toMatch(pattern);
    }
    // Reduced motion stops every HUD animation as well as the WebGL motion layer.
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
    const base = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');
    expect(base).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
