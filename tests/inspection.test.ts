// @vitest-environment happy-dom
/**
 * Mission inspection rig: the deterministic control and readout surfaces the
 * browser scenario matrix drives.
 *
 * What it proves, one concern per test:
 *
 *  1. the fidelity self-test runs the *shipped* governor over the documented
 *     mission-load cost model, downgrades under the load, and reports the
 *     settled tier's median/p95 against that tier's own budget — including a
 *     plain miss when even the rescue tier cannot carry the load;
 *  2. the lifecycle readout reports the mission phase as a stable hook and the
 *     controls hold it there: brief → approval gate → execute → the seeded
 *     failing check's repair phase, with the failed gate line in the terminal
 *     and the phase announcement in the live region;
 *  3. `Step` advances exactly one fixed mission step and re-pauses, which is what
 *     makes the sub-frame phases observable;
 *  4. the motion toggle drives every motion layer (camera drift, audio bus, the
 *     document's CSS) and leaves the camera pose bit-identical across frames;
 *  5. the rig owns its DOM and stylesheet and releases both exactly once.
 *
 * The suite is read-only over the product: it composes the shipped registry, the
 * frozen runtime and the headless adapter, and it never mutates a game, render,
 * UI, audio or content module.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createGame, type Game } from '../src/game/Game';
import {
  INSPECTION_HUD_KEYS,
  INSPECTION_MOTION_ATTRIBUTE,
  INSPECTION_STYLE_ATTRIBUTE,
  MISSION_LOAD_MS,
  createInspectionSystem,
  missionLoadFrameMs,
  runMissionLoadBudgetCheck,
  type InspectionSystem,
} from '../src/game/inspection';
import { createManualClock, type ManualClock } from '../src/game/loop';
import { createMissionInitialState, createSystems, type GameSystems } from '../src/game/systems';
import { createHeadlessAdapter } from '../src/render/headless';
import { MINIMAL_TARGET_MS } from '../src/render/qualityTiers';
import type { RenderAdapter } from '../src/render/renderer';

/** Fixed step every run uses: the runtime's 60 Hz default. */
const STEP_MS = 1000 / 60;

interface InspectionRun {
  readonly game: Game;
  readonly bundle: GameSystems;
  readonly adapter: RenderAdapter;
  readonly clock: ManualClock;
  readonly inspection: InspectionSystem;
  readonly host: HTMLElement;
  dispose(): void;
}

const openRuns: InspectionRun[] = [];

afterEach(() => {
  for (const run of openRuns.splice(0)) run.dispose();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(INSPECTION_MOTION_ATTRIBUTE);
});

/** Boot the composed runtime with the inspection rig over the headless adapter. */
function boot(): InspectionRun {
  const host = document.createElement('div');
  host.id = 'inspection-host';
  document.body.append(host);
  const canvas = document.createElement('canvas');
  canvas.dataset.coroidCanvas = 'true';
  host.append(canvas);

  const bundle = createSystems({
    autoStart: false,
    autoApprove: false,
    canvas,
    interfaceHost: host,
  });
  const inspection = createInspectionSystem({
    mission: () => bundle.mission,
    camera: () => bundle.cameraRig.rig,
    audio: () => bundle.audio.bus,
    quality: () => bundle.quality,
    guided: true,
  });
  const adapter = createHeadlessAdapter({ width: 1280, height: 720 });
  const clock = createManualClock(0);
  const game = createGame({
    adapter,
    systems: [...bundle.list, inspection],
    state: createMissionInitialState(),
    clock,
    stepMs: STEP_MS,
  });

  const run: InspectionRun = {
    game,
    bundle,
    adapter,
    clock,
    inspection,
    host,
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

/** Advance a run by whole fixed-step frames. */
function advance(run: InspectionRun, frames = 1): void {
  for (let frame = 0; frame < frames; frame += 1) {
    run.clock.advance(STEP_MS);
    run.game.advance(STEP_MS);
  }
}

/** One element matching a stable hook. */
function hud<T extends HTMLElement = HTMLElement>(key: string): T | null {
  return document.querySelector<T>(`[data-hud="${key}"]`);
}

/** Text of a hook, or the empty string when it is absent. */
function hudText(key: string): string {
  return hud(key)?.textContent?.trim() ?? '';
}

/** The full-precision camera pose the rig publishes. */
function cameraPose(): string {
  return hud(INSPECTION_HUD_KEYS.cameraPose)?.dataset.pose ?? '';
}

/**
 * The drift-driven half of the camera pose — azimuth and polar.
 *
 * The idle drift moves exactly these two axes; the focus lift belongs to the
 * cinematic state transition, which is not the motion layer this preference
 * suppresses.
 */
function driftAxes(): string {
  return cameraPose().split(',').slice(0, 2).join(',');
}

/** The terminal's lines, as `source|text`. */
function logLines(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-hud="log-line"]')].map(
    (line) => `${line.dataset.source ?? ''}|${line.textContent ?? ''}`,
  );
}

/** Mission clock in simulated milliseconds. */
function simMs(run: InspectionRun): number {
  return run.bundle.mission.flow?.simMs ?? Number.NaN;
}

/* -------------------------------------------------------------------------- */
/* Fidelity self-test                                                         */
/* -------------------------------------------------------------------------- */

describe('mission-load fidelity self-test', () => {
  it('models the documented cost of the tier ladder', () => {
    expect(missionLoadFrameMs('calm', 0, STEP_MS)).toBeCloseTo(STEP_MS, 6);
    // calm: 1.5 pixel ratio²=2.25, post on, shadows on (×1.3), no instances.
    expect(missionLoadFrameMs('calm', MISSION_LOAD_MS, STEP_MS)).toBeCloseTo(
      STEP_MS + MISSION_LOAD_MS * 2.25 * 1.3,
      6,
    );
    expect(missionLoadFrameMs('minimal', MISSION_LOAD_MS, STEP_MS)).toBeLessThan(
      missionLoadFrameMs('calm', MISSION_LOAD_MS, STEP_MS),
    );
    expect(missionLoadFrameMs('boosted', MISSION_LOAD_MS, STEP_MS)).toBeGreaterThan(
      missionLoadFrameMs('calm', MISSION_LOAD_MS, STEP_MS),
    );
  });

  it('downgrades under a full mission load and holds the settled tier budget', () => {
    const result = runMissionLoadBudgetCheck({ tier: 'calm' });

    expect(result.startTier).toBe('calm');
    expect(result.tier).toBe('minimal');
    expect(result.downgrades).toBeGreaterThan(0);
    expect(result.verdict).toBe('pass');
    expect(result.medianMs).toBeLessThanOrEqual(result.budgetMs);
    expect(result.p95Ms).toBeLessThanOrEqual(result.ceilingMs);
    expect(result.budgetMs).toBeCloseTo(MINIMAL_TARGET_MS, 6);
    expect(result.ceilingMs).toBeCloseTo(MINIMAL_TARGET_MS * 2, 6);
  });

  it('reports a miss rather than rubber-stamping an unholdable budget', () => {
    const result = runMissionLoadBudgetCheck({ tier: 'calm', load: 400, frames: 240 });

    expect(result.tier).toBe('minimal');
    expect(result.verdict).toBe('fail');
    expect(result.medianMs).toBeGreaterThan(result.budgetMs);
    expect(result.p95Ms).toBeGreaterThan(result.ceilingMs);
  });

  it('publishes the verdict on the readout when the control is clicked', () => {
    boot();
    hud<HTMLButtonElement>(INSPECTION_HUD_KEYS.budgetCheck)?.click();

    expect(hud(INSPECTION_HUD_KEYS.budgetVerdict)?.dataset.verdict).toBe('pass');
    expect(hudText(INSPECTION_HUD_KEYS.budgetVerdict)).toBe('Frame budget held');
    expect(hud(INSPECTION_HUD_KEYS.budgetTier)?.dataset.tier).toBe('minimal');

    const medianMs = Number(hud(INSPECTION_HUD_KEYS.budgetMedian)?.dataset.medianMs);
    const budgetMs = Number(hud(INSPECTION_HUD_KEYS.budgetMedian)?.dataset.budgetMs);
    const p95Ms = Number(hud(INSPECTION_HUD_KEYS.budgetP95)?.dataset.p95Ms);
    const ceilingMs = Number(hud(INSPECTION_HUD_KEYS.budgetP95)?.dataset.ceilingMs);
    expect(medianMs).toBeLessThanOrEqual(budgetMs);
    expect(p95Ms).toBeLessThanOrEqual(ceilingMs);
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle control                                                          */
/* -------------------------------------------------------------------------- */

describe('deterministic lifecycle control', () => {
  it('mounts every hook with its own stylesheet', () => {
    boot();
    for (const key of Object.values(INSPECTION_HUD_KEYS)) {
      expect(hud(key), key).not.toBeNull();
    }
    expect(document.querySelector(`style[${INSPECTION_STYLE_ATTRIBUTE}]`)).not.toBeNull();
  });

  it('holds the brief, the approval gate and the seeded repair phase', () => {
    const run = boot();
    advance(run, 3);

    // Brief: nothing dispatched, the mission clock has not moved.
    expect(run.bundle.mission.phase).toBe('brief');
    expect(hud(INSPECTION_HUD_KEYS.phase)?.dataset.phase).toBe('brief');
    expect(hudText(INSPECTION_HUD_KEYS.phase)).toBe('Phase brief');
    expect(run.bundle.mission.taskRows()).toHaveLength(0);

    // Brief → the approval gate: the plan is registered and held for approval.
    run.inspection.nextPhase();
    advance(run, 3);
    expect(run.bundle.mission.phase).toBe('approve');
    expect(run.bundle.mission.flow?.paused).toBe(true);
    expect(hud(INSPECTION_HUD_KEYS.phase)?.dataset.phase).toBe('approve');
    expect(run.bundle.mission.taskRows().length).toBeGreaterThan(0);

    // Approving opens the floor and holds on execute.
    run.inspection.approve();
    advance(run, 3);
    expect(run.bundle.mission.phase).toBe('dispatch');
    expect(run.bundle.mission.flow?.paused).toBe(true);
    expect(hudText(INSPECTION_HUD_KEYS.phaseState)).toBe('Run state paused');

    // Next phase runs to the mission's own seeded failure and holds on repair.
    run.inspection.nextPhase();
    let frames = 0;
    while (run.bundle.mission.phase !== 'repair' && frames < 600) {
      advance(run, 1);
      frames += 1;
    }
    expect(run.bundle.mission.phase).toBe('repair');
    expect(run.bundle.mission.flow?.paused).toBe(true);
    expect(hud(INSPECTION_HUD_KEYS.phase)?.dataset.phase).toBe('repair');
    expect(hudText('live')).toBe('Mission phase → repair');
    expect(
      logLines().some(
        (line) => line.startsWith('verification/run|') && line.includes('failed'),
      ),
    ).toBe(true);

    // Playing the arc out recovers readiness and ships: the release readings the
    // acceptance suite asserts are reachable from the held repair phase.
    run.inspection.play();
    frames = 0;
    while (run.bundle.mission.phase !== 'release' && frames < 2_000) {
      advance(run, 1);
      frames += 1;
    }
    expect(run.bundle.mission.phase).toBe('release');
    expect(run.bundle.mission.flow?.outcome).toBe('won');
    expect(hudText('mission-progress-label')).toBe('100% shipped');
    expect(run.bundle.mission.flow?.paused).toBe(true);
  });

  it('advances exactly one fixed mission step per step click', () => {
    const run = boot();
    run.inspection.nextPhase();
    run.inspection.approve();
    advance(run, 5);

    const before = simMs(run);
    // Paused: the mission clock does not move however many frames pass.
    advance(run, 12);
    expect(simMs(run)).toBe(before);

    run.inspection.step();
    advance(run, 1);
    expect(simMs(run)).toBeCloseTo(before + STEP_MS, 6);
    expect(run.bundle.mission.flow?.paused).toBe(true);

    // And it re-pauses: no further mission time is spent.
    advance(run, 12);
    expect(simMs(run)).toBeCloseTo(before + STEP_MS, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* Motion preference                                                          */
/* -------------------------------------------------------------------------- */

describe('motion preference', () => {
  it('suppresses the camera drift and reaches every motion layer', () => {
    const run = boot();
    const toggle = hud<HTMLButtonElement>(INSPECTION_HUD_KEYS.motionToggle);
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    toggle?.click();

    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(hudText(INSPECTION_HUD_KEYS.motionState)).toBe('Motion reduced');
    expect(hud(INSPECTION_HUD_KEYS.motionState)?.dataset.reducedMotion).toBe('true');
    expect(run.bundle.audio.bus?.reducedMotion).toBe(true);
    expect(document.documentElement.getAttribute(INSPECTION_MOTION_ATTRIBUTE)).toBe('reduced');

    // 120 frames leave the drifted axes bit-identical: no drift, no shake.
    const opening = driftAxes();
    advance(run, 120);
    expect(driftAxes()).toBe(opening);
  });

  it('leaves the drift running without the preference, and can be reverted', () => {
    const run = boot();
    const toggle = hud<HTMLButtonElement>(INSPECTION_HUD_KEYS.motionToggle);
    expect(hudText(INSPECTION_HUD_KEYS.motionState)).toBe('Motion full');
    expect(run.bundle.audio.bus?.reducedMotion).toBe(false);

    // Control: with the drift on the same frames move the camera.
    const opening = driftAxes();
    advance(run, 120);
    expect(driftAxes()).not.toBe(opening);

    // The preference is reversible from the same control.
    toggle?.click();
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    toggle?.click();
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(hud(INSPECTION_HUD_KEYS.motionState)?.dataset.reducedMotion).toBe('false');
    expect(hudText(INSPECTION_HUD_KEYS.motionState)).toBe('Motion full');
    expect(run.bundle.audio.bus?.reducedMotion).toBe(false);
    expect(document.documentElement.getAttribute(INSPECTION_MOTION_ATTRIBUTE)).toBe('full');
  });
});

/* -------------------------------------------------------------------------- */
/* Teardown                                                                   */
/* -------------------------------------------------------------------------- */

describe('teardown', () => {
  it('removes its DOM and its stylesheet exactly once', () => {
    const run = boot();
    expect(hud(INSPECTION_HUD_KEYS.root)).not.toBeNull();

    run.game.dispose();
    expect(hud(INSPECTION_HUD_KEYS.root)).toBeNull();
    expect(document.querySelector(`style[${INSPECTION_STYLE_ATTRIBUTE}]`)).toBeNull();

    // Idempotent: a second dispose is a no-op, not a throw.
    expect(() => run.game.dispose()).not.toThrow();
  });
});
