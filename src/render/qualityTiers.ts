/**
 * Adaptive quality tiers — the frame-time budget governor of the composed game.
 *
 * Why this exists
 * ---------------
 * The presentation target is high fidelity in a real browser, so the frame
 * budget is a deliverable rather than a hope. The world, the plan graph, the
 * lane views and the post chain all expose cost; this module is the single
 * authority that *measures* the frame, decides how much fidelity that budget
 * can carry, and writes the decision back into the presentation with no
 * simulation involvement at all.
 *
 * The module in four pieces
 * -------------------------
 *  1. `createFrameTimeMonitor()` — a fixed-capacity ring buffer of measured
 *     frame times. Percentiles are recomputed in place into an owned record, so
 *     the measurement path allocates nothing and the buffer never grows.
 *  2. `selectQualityTier()` — the deterministic selection rule. A *completed
 *     window* of samples maps to `minimal`, `calm` or `boosted`, and the rule is
 *     hysteretic: stepping down takes consecutive over-budget windows, stepping
 *     back up takes several windows of measured headroom, and every change is
 *     followed by a settle period. The tier therefore cannot oscillate frame to
 *     frame — or even window to window.
 *  3. `applyQualityTier()` — the imperative half: adapter pixel ratio, the
 *     shadow switches a shadow pass reads, post-processing enablement and
 *     preset, and the instanced stress field's count. It writes presentation
 *     only: no simulation state is read or touched.
 *  4. `createQualityTierSystem()` — the game system that ties those together,
 *     registered after every other system (see `src/game/systems.ts`).
 *
 * Where frame time comes from
 * ---------------------------
 * The runtime offers systems no draw-time hook, so the governor samples the
 * runtime's own clock at the fixed-step boundary. With the usual one step per
 * rendered frame, the delta between two samples *is* the frame time; the
 * `minSampleMs` filter drops the catch-up steps that share a frame with an
 * earlier one. The clock is injectable, which is what makes the whole loop
 * deterministic under test: feed a manual clock and the governor sees exactly
 * the frame-time sequence the test chose.
 *
 * The stress rig
 * --------------
 * Acceptance has to be able to force sustained over-budget windows *inside the
 * composed game*. The governor therefore owns a stress rig: a real instanced
 * field whose instance count the tiers scale, plus a bounded CPU load whose
 * calibrated size follows the tier (`stressMs`). Both are honest work measured
 * by the same monitor as every other frame — nothing is injected into the
 * statistics. The rig is inert until the perf surface's `data-hud="stress-toggle"`
 * control engages it. Engaging it restarts the measurement window, forgets the
 * demotion memory, re-arms the ladder at the richest tier the device may run,
 * and pins upgrades off (`allowUpgrade`), so a stress run always begins from an
 * over-ambitious configuration and then observes the governor shedding its way
 * down to one the host can actually hold — instead of oscillating between tiers.
 *
 * Demotion memory
 * ---------------
 * Climbing into a tier the host cannot hold is not free: the governor remembers
 * every demotion from a tier (`strikes`), makes the next attempt cost that much
 * more headroom, and after `QUALITY_THRESHOLDS.maxStrikes` failures stops
 * offering the tier at all. `reset()` — and therefore the stress control —
 * forgives that memory, so a deliberate restart is always possible.
 *
 * Shadow switch surface
 * ---------------------
 * The shared `RenderAdapter` contract exposes no shadow-map toggle, so the
 * tier's `shadows` flag drives the *scene-side* switches a shadow pass consumes:
 * `castShadow` on every light and on the rig's own casters, `receiveShadow` on
 * every mesh. The `AppliedQualitySettings` record returned by
 * `applyQualityTier()` is the authoritative declaration of what a tier costs,
 * including the number of switch writes it performed.
 */

import {
  BoxGeometry,
  Color,
  InstancedMesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';

import type { GameSystem, SystemContext, SystemUpdate } from '../game/systems';
import { POST_QUALITY_SETTINGS, type PostQualityPreset } from './effects';
import type { RenderAdapter } from './renderer';

/* -------------------------------------------------------------------------- */
/* Tiers                                                                      */
/* -------------------------------------------------------------------------- */

/** Every adaptive tier, cheapest first. */
export const QUALITY_TIERS = ['minimal', 'calm', 'boosted'] as const;

export type QualityTier = (typeof QUALITY_TIERS)[number];

/** Cheapest tier: the rescue configuration under sustained load. */
export const MINIMAL_QUALITY_TIER: QualityTier = 'minimal';
/** 60 fps tier: what a fresh run starts on. */
export const CALM_QUALITY_TIER: QualityTier = 'calm';
/** Richest tier: reached only with measured headroom. */
export const BOOSTED_QUALITY_TIER: QualityTier = 'boosted';

/** Tier a fresh run starts on. Boosted is earned by measurement, never assumed. */
export const DEFAULT_QUALITY_TIER: QualityTier = CALM_QUALITY_TIER;

/** Rank of each tier; higher means more fidelity and more cost. */
export const QUALITY_TIER_RANK: Readonly<Record<QualityTier, number>> = {
  minimal: 0,
  calm: 1,
  boosted: 2,
};

/** Target median frame time of the calm tier, milliseconds (60 fps). */
export const CALM_TARGET_MS = 16.7;
/** Target median frame time of the minimal tier, milliseconds (30 fps rescue). */
export const MINIMAL_TARGET_MS = 1000 / 30;
/** Target median frame time of the boosted tier, milliseconds (90 fps). */
export const BOOSTED_TARGET_MS = 1000 / 90;

/** The budget a tier is judged against: a median target and a hard p95 ceiling. */
export interface QualityTierBudget {
  /** Median frame time the tier aims for, milliseconds. */
  readonly targetMs: number;
  /** p95 ceiling, milliseconds. Always 2× the target. */
  readonly ceilingMs: number;
}

/** Everything a tier decides. Records are serialisable and immutable. */
export interface QualityTierSettings {
  readonly tier: QualityTier;
  /** Pixel ratio written to the shared render adapter. */
  readonly pixelRatio: number;
  /** Scene-side shadow switches the tier enables. */
  readonly shadows: boolean;
  /** Whether the in-scene post chain (bloom halos, god rays, screen pass) draws. */
  readonly post: boolean;
  /** Post-processing preset applied to the world. */
  readonly postPreset: PostQualityPreset;
  /** Fraction of the stress field's instances the tier draws. */
  readonly instanceScale: number;
  /** CPU cost the stress rig aims for at this tier, milliseconds. */
  readonly stressMs: number;
  readonly budget: QualityTierBudget;
}

/**
 * The three tiers.
 *
 * `calm` is the shipped default and keeps the neon art direction intact: the
 * `high` post preset draws bloom halos and the god-ray fan, shadows stay on and
 * the pixel ratio is supersampled. `boosted` adds the `ultra` preset and a 2×
 * pixel ratio for hero framing. `minimal` is the rescue tier: it sheds the post
 * chain entirely, halves the instance budget twice over and drops to 0.75× so a
 * loaded frame comes back inside 33 ms.
 */
export const QUALITY_TIER_SETTINGS: Readonly<Record<QualityTier, QualityTierSettings>> = {
  minimal: {
    tier: 'minimal',
    pixelRatio: 0.75,
    shadows: false,
    post: false,
    postPreset: 'low',
    instanceScale: 0.125,
    stressMs: 4,
    budget: { targetMs: MINIMAL_TARGET_MS, ceilingMs: MINIMAL_TARGET_MS * 2 },
  },
  calm: {
    tier: 'calm',
    pixelRatio: 1.5,
    shadows: true,
    post: true,
    postPreset: 'high',
    instanceScale: 0.5,
    stressMs: 20,
    budget: { targetMs: CALM_TARGET_MS, ceilingMs: CALM_TARGET_MS * 2 },
  },
  boosted: {
    tier: 'boosted',
    pixelRatio: 2,
    shadows: true,
    post: true,
    postPreset: 'ultra',
    instanceScale: 1,
    stressMs: 42,
    budget: { targetMs: BOOSTED_TARGET_MS, ceilingMs: BOOSTED_TARGET_MS * 2 },
  },
};

/** Resolve a tier (or an absent one) to its settings record. */
export function resolveTierSettings(tier?: QualityTier | null): QualityTierSettings {
  if (tier && tier in QUALITY_TIER_SETTINGS) return QUALITY_TIER_SETTINGS[tier];
  return QUALITY_TIER_SETTINGS[DEFAULT_QUALITY_TIER];
}

/** Rank of a tier; higher is richer. */
export function tierRank(tier: QualityTier): number {
  return QUALITY_TIER_RANK[tier];
}

/** Clamp a tier into an inclusive `[min, max]` band. */
export function clampQualityTier(
  tier: QualityTier,
  min: QualityTier = MINIMAL_QUALITY_TIER,
  max: QualityTier = BOOSTED_QUALITY_TIER,
): QualityTier {
  const low = tierRank(min) <= tierRank(max) ? min : max;
  const high = tierRank(min) <= tierRank(max) ? max : min;
  if (tierRank(tier) < tierRank(low)) return low;
  if (tierRank(tier) > tierRank(high)) return high;
  return tier;
}

/** Step a tier one rank up (`1`) or down (`-1`), clamped at the ends. */
export function stepQualityTier(tier: QualityTier, direction: -1 | 1): QualityTier {
  return clampQualityTier(QUALITY_TIERS[QUALITY_TIERS.indexOf(tier) + direction] ?? tier);
}

/* -------------------------------------------------------------------------- */
/* Device signals                                                             */
/* -------------------------------------------------------------------------- */

/** What the governor knows about the host before it has measured anything. */
export interface QualityDeviceSignals {
  readonly devicePixelRatio: number;
  readonly hardwareConcurrency: number;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
}

/** Read the host's device signals; safe where any of them are unavailable. */
export function detectDeviceSignals(): QualityDeviceSignals {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const connection =
    nav && 'connection' in nav
      ? (nav as Navigator & { connection?: { saveData?: boolean } }).connection
      : null;
  let reducedMotion = false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      reducedMotion = false;
    }
  }
  const ratio = typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
  return {
    devicePixelRatio: ratio > 0 ? ratio : 1,
    hardwareConcurrency: nav?.hardwareConcurrency && nav.hardwareConcurrency > 0
      ? nav.hardwareConcurrency
      : 4,
    reducedMotion,
    saveData: connection?.saveData === true,
  };
}

/**
 * Highest tier a device may ever reach.
 *
 * A memory- or bandwidth-saver host, or a two-core machine, is capped at calm:
 * the governor may still shed to minimal when it measures trouble, but it must
 * not spend a budget the device has said it does not have.
 */
export function deviceTierCeiling(signals: QualityDeviceSignals = detectDeviceSignals()): QualityTier {
  if (signals.saveData) return CALM_QUALITY_TIER;
  if (signals.hardwareConcurrency <= 2) return CALM_QUALITY_TIER;
  return BOOSTED_QUALITY_TIER;
}

/**
 * Tier a fresh run starts on.
 *
 * Defaults to calm — the shipped, art-directive-preserving target — and only
 * drops to minimal when the device explicitly asks for less work. Boosted is
 * never a starting point: it has to be earned by measured headroom.
 */
export function initialQualityTier(
  signals: QualityDeviceSignals = detectDeviceSignals(),
): QualityTier {
  if (signals.saveData) return MINIMAL_QUALITY_TIER;
  if (signals.hardwareConcurrency <= 2) return MINIMAL_QUALITY_TIER;
  if (signals.devicePixelRatio <= 0.5) return MINIMAL_QUALITY_TIER;
  return DEFAULT_QUALITY_TIER;
}

/* -------------------------------------------------------------------------- */
/* Frame-time monitor                                                         */
/* -------------------------------------------------------------------------- */

/** Default samples per window: ~0.4 s at 60 fps. */
export const QUALITY_WINDOW_SIZE = 24;
/**
 * Samples under this many milliseconds are catch-up steps sharing a frame, not
 * frames of their own. They are dropped so one slow frame cannot be halved.
 */
export const QUALITY_MIN_SAMPLE_MS = 1;
/** Fraction of the tier target the median must fall under to count as headroom. */
export const QUALITY_HEADROOM_FRACTION = 0.6;

/**
 * Rolling frame-time statistics.
 *
 * The record is owned by the monitor and updated in place — read it, do not
 * retain it across a tier change.
 */
export interface FrameTimeStats {
  /** Samples a full window holds (the monitor's fixed capacity). */
  readonly window: number;
  /** Samples currently in the window. */
  readonly samples: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  /** Frames per second implied by the median. */
  readonly fps: number;
  /** Tier target the window is judged against. */
  readonly budgetMs: number;
  /** Median above the tier's target: this window spent more than it may. */
  readonly overBudget: boolean;
  /** Median well inside the target *and* p95 inside the target itself. */
  readonly headroom: boolean;
  /** Median inside the target and p95 inside the ceiling (2× target). */
  readonly budgetHeld: boolean;
  /** Bumped on every accepted sample, so consumers can skip work. */
  readonly revision: number;
}

/** Live record shape; assignable to the read-only `FrameTimeStats`. */
interface LiveFrameTimeStats {
  window: number;
  samples: number;
  medianMs: number;
  p95Ms: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  fps: number;
  budgetMs: number;
  overBudget: boolean;
  headroom: boolean;
  budgetHeld: boolean;
  revision: number;
}

export interface FrameTimeMonitorOptions {
  /** Samples per window. Defaults to `QUALITY_WINDOW_SIZE`. */
  window?: number;
  /** Tier target the statistics are judged against, milliseconds. */
  budgetMs?: number;
  /** Smallest delta counted as a frame. Defaults to `QUALITY_MIN_SAMPLE_MS`. */
  minSampleMs?: number;
  /** Fraction of the target that counts as headroom. Defaults to `0.6`. */
  headroomFraction?: number;
}

export interface FrameTimeMonitor {
  /** Fixed ring capacity; the buffer never grows. */
  readonly capacity: number;
  /** Samples currently in the window. */
  readonly count: number;
  /** Whether the ring has filled at least once. */
  readonly filled: boolean;
  /** Windows completed since creation (every `capacity` accepted samples). */
  readonly windows: number;
  /** Accepted samples since creation. */
  readonly accepted: number;
  /** Live window statistics; updated in place, never reallocated. */
  readonly stats: FrameTimeStats;
  /** Push one measured frame time. Returns `true` when a window just completed. */
  push(frameMs: number): boolean;
  /** Retarget the window without dropping its samples. */
  setBudget(budgetMs: number): void;
  /** Empty the ring. */
  reset(): void;
}

function clampNumber(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Median of the first `count` entries of an ascending-sorted array. */
function medianOf(sorted: Float64Array, count: number): number {
  if (count <= 0) return 0;
  const mid = count >> 1;
  if ((count & 1) === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Nearest-rank percentile of the first `count` entries of a sorted array. */
function percentileOf(sorted: Float64Array, count: number, fraction: number): number {
  if (count <= 0) return 0;
  const index = clampNumber(Math.ceil(fraction * count) - 1, 0, count - 1);
  return sorted[index] ?? 0;
}

/**
 * Create a fixed-capacity frame-time monitor.
 *
 * `push()` writes one sample into the ring and never allocates; the percentile
 * sort runs into a preallocated scratch buffer and only when the statistics are
 * actually read. `stats` is one owned object for the monitor's whole life, so a
 * consumer polling it every frame allocates nothing either.
 */
export function createFrameTimeMonitor(options: FrameTimeMonitorOptions = {}): FrameTimeMonitor {
  const capacity = Math.max(2, Math.floor(options.window ?? QUALITY_WINDOW_SIZE));
  const minSampleMs = Math.max(0, options.minSampleMs ?? QUALITY_MIN_SAMPLE_MS);
  const headroomFraction = clampNumber(options.headroomFraction ?? QUALITY_HEADROOM_FRACTION, 0, 1);

  const buffer = new Float64Array(capacity);
  const scratch = new Float64Array(capacity);
  const stats: LiveFrameTimeStats = {
    window: capacity,
    samples: 0,
    medianMs: 0,
    p95Ms: 0,
    meanMs: 0,
    minMs: 0,
    maxMs: 0,
    fps: 0,
    budgetMs: Math.max(0, options.budgetMs ?? CALM_TARGET_MS),
    overBudget: false,
    headroom: false,
    budgetHeld: false,
    revision: 0,
  };

  let head = 0;
  let count = 0;
  let accepted = 0;
  let windows = 0;
  let dirty = true;

  function refresh(): void {
    if (!dirty) return;
    dirty = false;

    for (let index = 0; index < count; index += 1) scratch[index] = buffer[index] ?? 0;
    // Insertion sort: allocation-free, and at window sizes this is nanoseconds.
    for (let index = 1; index < count; index += 1) {
      const value = scratch[index] ?? 0;
      let cursor = index - 1;
      while (cursor >= 0 && (scratch[cursor] ?? 0) > value) {
        scratch[cursor + 1] = scratch[cursor] ?? 0;
        cursor -= 1;
      }
      scratch[cursor + 1] = value;
    }

    let sum = 0;
    let max = 0;
    for (let index = 0; index < count; index += 1) {
      const value = scratch[index] ?? 0;
      if (value > max) max = value;
      sum += value;
    }

    const medianMs = medianOf(scratch, count);
    const budgetMs = stats.budgetMs;
    stats.samples = count;
    stats.medianMs = medianMs;
    stats.p95Ms = percentileOf(scratch, count, 0.95);
    stats.meanMs = count > 0 ? sum / count : 0;
    stats.minMs = count > 0 ? (scratch[0] ?? 0) : 0;
    stats.maxMs = max;
    stats.fps = medianMs > 0 ? 1000 / medianMs : 0;
    stats.overBudget = count > 0 && medianMs > budgetMs;
    stats.headroom = count > 0 && medianMs <= budgetMs * headroomFraction && stats.p95Ms <= budgetMs;
    stats.budgetHeld = count > 0 && medianMs <= budgetMs && stats.p95Ms <= budgetMs * 2;
  }

  return {
    capacity,
    get count() {
      return count;
    },
    get filled() {
      return windows > 0;
    },
    get windows() {
      return windows;
    },
    get accepted() {
      return accepted;
    },
    get stats() {
      refresh();
      return stats;
    },
    push(frameMs: number): boolean {
      if (!Number.isFinite(frameMs) || frameMs < minSampleMs) return false;
      buffer[head] = frameMs;
      head = (head + 1) % capacity;
      if (count < capacity) count += 1;
      accepted += 1;
      dirty = true;
      stats.revision += 1;
      if (count < capacity || accepted % capacity !== 0) return false;
      windows += 1;
      return true;
    },
    setBudget(budgetMs: number): void {
      const next = Math.max(0, budgetMs);
      if (next === stats.budgetMs) return;
      stats.budgetMs = next;
      dirty = true;
    },
    reset(): void {
      head = 0;
      count = 0;
      accepted = 0;
      windows = 0;
      dirty = true;
      stats.revision += 1;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Selection rule                                                             */
/* -------------------------------------------------------------------------- */

/** Why the governor changed tier. */
export type QualityChangeReason =
  | 'startup'
  | 'over-budget'
  | 'headroom'
  | 'device'
  | 'manual'
  | 'hold';

/** The hysteresis that keeps the tier from oscillating. */
export interface TierThresholds {
  /** Fraction of the target that counts as headroom. */
  readonly headroomFraction: number;
  /** Consecutive over-budget windows before stepping down. */
  readonly degradeWindows: number;
  /** Consecutive headroom windows before stepping up, before any demotion. */
  readonly upgradeWindows: number;
  /** Windows a tier holds after a change before it may change again. */
  readonly settleWindows: number;
  /**
   * Demotions a tier may suffer before the governor stops climbing back to it.
   *
   * A host that has already failed to hold a tier twice should not be handed it
   * again on the next quiet window: without this, a machine that sits just
   * inside one tier and just outside the next flips between them forever.
   */
  readonly maxStrikes: number;
  /**
   * Completed windows without a demotion that forgive one strike.
   *
   * Long on purpose — a demotion is remembered for the working session — and
   * bounded so a host that genuinely improved does eventually get its fidelity
   * back. `AdaptiveQuality.reset()` forgets it immediately.
   */
  readonly strikeDecayWindows: number;
}

/** Shipped hysteresis: ~0.8 s to shed load, ~2 s to spend headroom. */
export const QUALITY_THRESHOLDS: TierThresholds = {
  headroomFraction: QUALITY_HEADROOM_FRACTION,
  degradeWindows: 2,
  upgradeWindows: 4,
  settleWindows: 1,
  maxStrikes: 2,
  strikeDecayWindows: 1800,
};

export interface TierDecisionInput {
  readonly current: QualityTier;
  /** Window statistics to judge; only the derived flags are read. */
  readonly stats: FrameTimeStats;
  /** Over-budget windows observed in a row before this one. */
  readonly overBudgetWindows: number;
  /** Headroom windows observed in a row before this one. */
  readonly headroomWindows: number;
  /** Windows elapsed since the last tier change. */
  readonly windowsSinceChange: number;
  /** Whether the governor may spend headroom. Defaults to `true`. */
  readonly allowUpgrade?: boolean;
  /** Demotions the tier one step up has already suffered. Defaults to `0`. */
  readonly upgradeStrikes?: number;
  readonly minTier?: QualityTier;
  readonly maxTier?: QualityTier;
  readonly thresholds?: Partial<TierThresholds>;
}

/** What the rule decided for one completed window. */
export interface TierDecision {
  readonly tier: QualityTier;
  readonly changed: boolean;
  readonly reason: QualityChangeReason;
  readonly overBudgetWindows: number;
  readonly headroomWindows: number;
  readonly windowsSinceChange: number;
  /** Headroom windows the next tier up needs before it may be climbed onto. */
  readonly upgradeWindowsRequired: number;
  /** True when the next tier up has failed too often to be tried again. */
  readonly upgradeBlocked: boolean;
  readonly medianMs: number;
  readonly p95Ms: number;
}

/**
 * Map one completed window of frame-time statistics to a tier.
 *
 * Pure and deterministic: the same inputs always produce the same decision, so
 * a recorded frame-time sequence replays to the same tier ladder. The rule is
 * deliberately asymmetric — one bad window changes nothing, two in a row shed
 * load; four good ones in a row (with a two-window settle after any change) are
 * needed to spend it again.
 */
export function selectQualityTier(input: TierDecisionInput): TierDecision {
  const stats = input.stats;
  const thresholds = input.thresholds;
  const degradeWindows = thresholds?.degradeWindows ?? QUALITY_THRESHOLDS.degradeWindows;
  const upgradeWindows = thresholds?.upgradeWindows ?? QUALITY_THRESHOLDS.upgradeWindows;
  const settleWindows = thresholds?.settleWindows ?? QUALITY_THRESHOLDS.settleWindows;
  const maxStrikes = thresholds?.maxStrikes ?? QUALITY_THRESHOLDS.maxStrikes;
  const minTier = input.minTier ?? MINIMAL_QUALITY_TIER;
  const maxTier = input.maxTier ?? BOOSTED_QUALITY_TIER;
  const allowUpgrade = input.allowUpgrade !== false;

  // Every demotion from the next tier up makes climbing back onto it costlier:
  // once it has failed `maxStrikes` times the governor stops trying.
  const upgradeStrikes = Math.max(0, Math.floor(input.upgradeStrikes ?? 0));
  const upgradeWindowsRequired = upgradeWindows * (upgradeStrikes + 1);
  const upgradeBlocked = upgradeStrikes > maxStrikes;

  let overBudgetWindows = stats.overBudget ? input.overBudgetWindows + 1 : 0;
  let headroomWindows = allowUpgrade && stats.headroom ? input.headroomWindows + 1 : 0;

  const settled = input.windowsSinceChange >= settleWindows;
  let tier = input.current;
  let reason: QualityChangeReason = 'hold';

  const clamped = clampQualityTier(input.current, minTier, maxTier);
  if (clamped !== input.current) {
    tier = clamped;
    reason = 'device';
  } else if (settled && overBudgetWindows >= degradeWindows) {
    tier = stepQualityTier(input.current, -1);
    if (tier !== input.current) reason = 'over-budget';
  } else if (
    settled &&
    !upgradeBlocked &&
    headroomWindows >= upgradeWindowsRequired
  ) {
    tier = stepQualityTier(input.current, 1);
    if (tier !== input.current) reason = 'headroom';
  }

  const next = clampQualityTier(tier, minTier, maxTier);
  const changed = next !== input.current;
  if (changed) {
    overBudgetWindows = 0;
    headroomWindows = 0;
  }

  return {
    tier: next,
    changed,
    reason: changed ? reason : 'hold',
    overBudgetWindows,
    headroomWindows,
    windowsSinceChange: changed ? 0 : input.windowsSinceChange + 1,
    upgradeWindowsRequired,
    upgradeBlocked,
    medianMs: stats.medianMs,
    p95Ms: stats.p95Ms,
  };
}

/* -------------------------------------------------------------------------- */
/* Controller                                                                 */
/* -------------------------------------------------------------------------- */

export interface AdaptiveQualityOptions extends FrameTimeMonitorOptions {
  /** Starting tier. Defaults to `calm`. */
  tier?: QualityTier;
  /** Start with the tier pinned. Defaults to `false`. */
  hold?: boolean;
  /** Lowest tier the device may run. Defaults to `minimal`. */
  minTier?: QualityTier;
  /** Highest tier the device may run. Defaults to `boosted`. */
  maxTier?: QualityTier;
  /** Whether headroom may be spent. Defaults to `true`. */
  allowUpgrade?: boolean;
  readonly thresholds?: Partial<TierThresholds>;
  /** Called once per tier change, after the monitor has been retargeted. */
  onChange?(tier: QualityTier, reason: QualityChangeReason): void;
}

/** A measured, hysteretic tier controller over one frame-time monitor. */
export interface AdaptiveQuality {
  readonly monitor: FrameTimeMonitor;
  readonly tier: QualityTier;
  readonly stats: FrameTimeStats;
  /** Live record of the last window evaluation; updated in place. */
  readonly decision: TierDecision;
  readonly minTier: QualityTier;
  readonly maxTier: QualityTier;
  readonly allowUpgrade: boolean;
  /** Whether the tier is pinned (measured, but never changed by the governor). */
  readonly holding: boolean;
  /** Completed windows since creation. */
  readonly windows: number;
  /** Tier changes since creation. */
  readonly changes: number;
  /** Reason of the last change. */
  readonly reason: QualityChangeReason;
  /** Demotions each tier has suffered, indexed by `QUALITY_TIER_RANK`. */
  readonly strikes: readonly number[];
  /** Completed windows since the last demotion. */
  readonly quietWindows: number;
  /** Feed one measured frame time. Returns `true` when the tier changed. */
  observe(frameMs: number): boolean;
  /** Force a tier (clamped to the device band). Returns `true` when it moved. */
  setTier(tier: QualityTier, reason?: QualityChangeReason): boolean;
  /** Narrow or widen the device band. */
  setLimits(minTier?: QualityTier | null, maxTier?: QualityTier | null): void;
  /** Pin the governor to shedding load (true) or let it spend headroom (false). */
  setAllowUpgrade(allowUpgrade: boolean): void;
  /**
   * Pin the tier: samples keep being measured (the badge stays live), but
   * nothing moves the tier until the hold is released.
   */
  setHold(holding: boolean): void;
  /**
   * Drop every sample and restart on `tier` (defaults to the current one).
   *
   * This also forgets the demotion memory: a reset is the host saying the
   * conditions have changed, so previously failed tiers may be tried again.
   */
  reset(tier?: QualityTier): void;
}

interface LiveTierDecision {
  tier: QualityTier;
  changed: boolean;
  reason: QualityChangeReason;
  overBudgetWindows: number;
  headroomWindows: number;
  windowsSinceChange: number;
  upgradeWindowsRequired: number;
  upgradeBlocked: boolean;
  medianMs: number;
  p95Ms: number;
}

/**
 * Create the adaptive controller: a monitor plus the selection rule and the
 * bookkeeping that turns per-frame samples into rare, deliberate tier changes.
 *
 * `observe()` is the whole hot path — one push, and on the window boundary one
 * pure decision. Nothing in it allocates.
 */
export function createAdaptiveQuality(options: AdaptiveQualityOptions = {}): AdaptiveQuality {
  let minTier = options.minTier ?? MINIMAL_QUALITY_TIER;
  let maxTier = options.maxTier ?? BOOSTED_QUALITY_TIER;
  const thresholds = options.thresholds;
  let tier = clampQualityTier(options.tier ?? DEFAULT_QUALITY_TIER, minTier, maxTier);
  let allowUpgrade = options.allowUpgrade ?? true;
  let holding = options.hold === true;
  let changes = 0;
  let reason: QualityChangeReason = 'startup';

  const monitor = createFrameTimeMonitor({
    window: options.window,
    budgetMs: resolveTierSettings(tier).budget.targetMs,
    minSampleMs: options.minSampleMs,
    headroomFraction: thresholds?.headroomFraction ?? QUALITY_HEADROOM_FRACTION,
  });

  const decision: LiveTierDecision = {
    tier,
    changed: false,
    reason: 'startup',
    overBudgetWindows: 0,
    headroomWindows: 0,
    windowsSinceChange: thresholds?.settleWindows ?? QUALITY_THRESHOLDS.settleWindows,
    upgradeWindowsRequired: thresholds?.upgradeWindows ?? QUALITY_THRESHOLDS.upgradeWindows,
    upgradeBlocked: false,
    medianMs: 0,
    p95Ms: 0,
  };

  /** Demotions per tier rank, and how long the run has been quiet since one. */
  const strikes = [0, 0, 0];
  let quietWindows = 0;

  function commit(next: QualityTier, nextReason: QualityChangeReason): boolean {
    if (next === tier) return false;
    tier = next;
    reason = nextReason;
    changes += 1;
    monitor.setBudget(resolveTierSettings(tier).budget.targetMs);
    options.onChange?.(tier, nextReason);
    return true;
  }

  return {
    monitor,
    get tier() {
      return tier;
    },
    get stats() {
      return monitor.stats;
    },
    get decision() {
      return decision;
    },
    minTier,
    maxTier,
    get allowUpgrade() {
      return allowUpgrade;
    },
    get holding() {
      return holding;
    },
    get windows() {
      return monitor.windows;
    },
    get changes() {
      return changes;
    },
    get reason() {
      return reason;
    },
    get strikes() {
      return strikes;
    },
    get quietWindows() {
      return quietWindows;
    },
    observe(frameMs: number): boolean {
      if (!monitor.push(frameMs)) return false;
      // A pinned tier still measures — the badge must stay live — but the
      // governor leaves it where the host put it.
      if (holding) return false;
      const rank = QUALITY_TIER_RANK[tier];
      const result = selectQualityTier({
        current: tier,
        stats: monitor.stats,
        overBudgetWindows: decision.overBudgetWindows,
        headroomWindows: decision.headroomWindows,
        windowsSinceChange: decision.windowsSinceChange,
        allowUpgrade,
        upgradeStrikes: strikes[rank + 1] ?? 0,
        minTier,
        maxTier,
        thresholds,
      });
      decision.tier = result.tier;
      decision.changed = result.changed;
      decision.reason = result.reason;
      decision.overBudgetWindows = result.overBudgetWindows;
      decision.headroomWindows = result.headroomWindows;
      decision.windowsSinceChange = result.windowsSinceChange;
      decision.upgradeWindowsRequired = result.upgradeWindowsRequired;
      decision.upgradeBlocked = result.upgradeBlocked;
      decision.medianMs = result.medianMs;
      decision.p95Ms = result.p95Ms;

      // Demotion memory: a tier the host has now failed to hold `maxStrikes`
      // times stops being offered on the next quiet window, and quiet runs
      // slowly forgive the strikes so a genuinely improved host can climb again.
      if (result.changed && result.reason === 'over-budget') {
        strikes[rank] = (strikes[rank] ?? 0) + 1;
        quietWindows = 0;
      } else if (!result.changed) {
        quietWindows += 1;
        const decay = thresholds?.strikeDecayWindows ?? QUALITY_THRESHOLDS.strikeDecayWindows;
        if (quietWindows >= decay) {
          quietWindows = 0;
          for (let index = 0; index < strikes.length; index += 1) {
            strikes[index] = Math.max(0, (strikes[index] ?? 0) - 1);
          }
        }
      }

      return commit(result.tier, result.reason);
    },
    setTier(tier_, reason_ = 'manual'): boolean {
      return commit(clampQualityTier(tier_, minTier, maxTier), reason_);
    },
    setLimits(nextMin?: QualityTier | null, nextMax?: QualityTier | null): void {
      if (nextMin) minTier = nextMin;
      if (nextMax) maxTier = nextMax;
      const clamped = clampQualityTier(tier, minTier, maxTier);
      if (clamped !== tier) commit(clamped, 'device');
    },
    setAllowUpgrade(next: boolean): void {
      allowUpgrade = next !== false;
      if (!allowUpgrade) decision.headroomWindows = 0;
    },
    setHold(next: boolean): void {
      const value = next === true;
      if (value === holding) return;
      holding = value;
      if (!holding) {
        // Released: judge the next window on its own merits, with a settle
        // window in front of it, instead of inheriting the held run's history.
        decision.overBudgetWindows = 0;
        decision.headroomWindows = 0;
        decision.windowsSinceChange = 0;
        decision.changed = false;
        decision.reason = 'hold';
      }
    },
    reset(tier_?: QualityTier): void {
      monitor.reset();
      // A reset is a fresh evaluation: forget the demotion memory too.
      for (let index = 0; index < strikes.length; index += 1) strikes[index] = 0;
      quietWindows = 0;
      decision.overBudgetWindows = 0;
      decision.headroomWindows = 0;
      decision.windowsSinceChange = thresholds?.settleWindows ?? QUALITY_THRESHOLDS.settleWindows;
      decision.changed = false;
      decision.reason = 'startup';
      const nextStrikes = strikes[QUALITY_TIER_RANK[tier] + 1] ?? 0;
      decision.upgradeWindowsRequired =
        (thresholds?.upgradeWindows ?? QUALITY_THRESHOLDS.upgradeWindows) * (nextStrikes + 1);
      decision.upgradeBlocked = nextStrikes > (thresholds?.maxStrikes ?? QUALITY_THRESHOLDS.maxStrikes);
      if (tier_ && tier_ !== tier) {
        const target = clampQualityTier(tier_, minTier, maxTier);
        tier = target;
        monitor.setBudget(resolveTierSettings(tier).budget.targetMs);
        options.onChange?.(tier, 'manual');
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Applied settings                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The authoritative declaration of what the active tier costs.
 *
 * Owned and updated in place by the governor: read it, do not retain it.
 */
export interface AppliedQualitySettings {
  readonly tier: QualityTier;
  /** Pixel ratio written to the adapter. */
  readonly pixelRatio: number;
  readonly shadows: boolean;
  readonly post: boolean;
  readonly postPreset: PostQualityPreset;
  /** Halo sprites per anchor the active post preset draws. */
  readonly haloRings: number;
  /** Volumetric shafts the active post preset draws. */
  readonly rayCount: number;
  readonly instanceScale: number;
  /** Instances the governed field actually draws at this tier. */
  readonly instanceCount: number;
  readonly targetMs: number;
  readonly ceilingMs: number;
  /** Shadow switches written on the last application. */
  readonly shadowLights: number;
  readonly shadowCasters: number;
  readonly shadowReceivers: number;
  /** Bumped on every application, so consumers can skip work. */
  readonly revision: number;
}

/** Live record shape; assignable to the read-only `AppliedQualitySettings`. */
interface LiveAppliedQualitySettings {
  tier: QualityTier;
  pixelRatio: number;
  shadows: boolean;
  post: boolean;
  postPreset: PostQualityPreset;
  haloRings: number;
  rayCount: number;
  instanceScale: number;
  instanceCount: number;
  targetMs: number;
  ceilingMs: number;
  shadowLights: number;
  shadowCasters: number;
  shadowReceivers: number;
  revision: number;
}

/** Build the zeroed record `applyQualityTier()` writes into. */
export function createAppliedQualitySettings(
  tier: QualityTier = DEFAULT_QUALITY_TIER,
): AppliedQualitySettings {
  return {
    tier,
    pixelRatio: 0,
    shadows: false,
    post: false,
    postPreset: 'low',
    haloRings: 0,
    rayCount: 0,
    instanceScale: 0,
    instanceCount: 0,
    targetMs: 0,
    ceilingMs: 0,
    shadowLights: 0,
    shadowCasters: 0,
    shadowReceivers: 0,
    revision: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Shadow switches                                                            */
/* -------------------------------------------------------------------------- */

/** `userData` flag marking a mesh as a shadow caster for the tier governor. */
export const SHADOW_CASTER_FLAG = 'coroidShadowCaster';

/** Counts of the scene-side shadow switches one application wrote. */
export interface ShadowSwitchReport {
  readonly enabled: boolean;
  readonly lights: number;
  readonly casters: number;
  readonly receivers: number;
}

/**
 * Drive the scene-side shadow switches for a subtree.
 *
 * Every light becomes a shadow emitter, every mesh a receiver, and every mesh
 * flagged `userData.coroidShadowCaster` a caster. These are the flags a shadow
 * pass reads; the tier's `shadows` setting is what turns them on and off.
 */
export function applyQualityShadows(root: Object3D, enabled: boolean): ShadowSwitchReport {
  let lights = 0;
  let casters = 0;
  let receivers = 0;

  root.traverse((object) => {
    const light = object as Object3D & { isLight?: boolean; castShadow?: boolean };
    if (light.isLight === true) {
      light.castShadow = enabled;
      lights += 1;
      return;
    }
    const mesh = object as Object3D & {
      isMesh?: boolean;
      isInstancedMesh?: boolean;
      castShadow?: boolean;
      receiveShadow?: boolean;
    };
    if (mesh.isMesh !== true && mesh.isInstancedMesh !== true) return;
    mesh.receiveShadow = enabled;
    receivers += 1;
    if (object.userData[SHADOW_CASTER_FLAG] === true) {
      mesh.castShadow = enabled;
      casters += 1;
    }
  });

  return { enabled, lights, casters, receivers };
}

/* -------------------------------------------------------------------------- */
/* Instancing and the stress rig                                              */
/* -------------------------------------------------------------------------- */

/** An instance field whose draw count the tiers govern. */
export interface QualityInstanceHook {
  /** Object standing in the scene; the governor sets its instance count. */
  readonly object: Object3D;
  /** Instances the field can draw at full budget. */
  readonly capacity: number;
  /** Draw `fraction` of the capacity; returns the count actually applied. */
  setInstanceBudget(fraction: number): number;
  /** Follow the tier's shadow flag on the objects this hook owns. */
  setShadows(enabled: boolean): void;
}

/** Object name of the stress field, so tools and tests can address it. */
export const STRESS_FIELD_NAME = 'perf-stress-field';
/** Instances the stress field allocates: a 16³ lattice. */
export const STRESS_INSTANCE_CAPACITY = 4096;
/** Iterations the burn starts from per target millisecond. */
export const STRESS_ITERATIONS_PER_MS = 140_000;
/** Smallest and largest burn the rig will ever run. */
export const STRESS_MIN_ITERATIONS = 20_000;
export const STRESS_MAX_ITERATIONS = 60_000_000;
/** A burn shorter than this cannot calibrate (a manual clock reads 0). */
export const STRESS_CALIBRATION_FLOOR_MS = 0.05;

export interface StressRigOptions {
  /** Instance capacity. Defaults to `STRESS_INSTANCE_CAPACITY`. */
  capacity?: number;
  /** CPU cost target per tier, milliseconds. Defaults to the tier settings. */
  targets?: Partial<Record<QualityTier, number>>;
  /** Half-extent of the field in world units. Defaults to `22`. */
  extent?: number;
  /** Height the field reaches. Defaults to `26`. */
  height?: number;
}

/**
 * The perf stress rig.
 *
 * A real instanced field plus a measured, self-calibrating CPU burn. The field
 * gives the tier ladder a concrete instance budget to scale; the burn is what
 * lets acceptance force sustained over-budget windows on *any* host — it sizes
 * itself so the tier's `stressMs` is actually spent, using the runtime clock,
 * and it never fabricates a sample: the monitor measures the frame the burn
 * really produced. With an injected (manual) clock the burn cannot calibrate and
 * simply holds its deterministic size.
 */
export interface StressRig extends QualityInstanceHook {
  readonly root: InstancedMesh;
  readonly active: boolean;
  /** Instances currently drawn. */
  readonly count: number;
  /** Current burn size, in loop iterations. */
  readonly iterations: number;
  /** Wall time the last burn took, milliseconds. */
  readonly burnedMs: number;
  /** CPU target the current tier aims for, milliseconds. */
  readonly targetMs: number;
  readonly disposed: boolean;
  setActive(active: boolean): void;
  /** Retarget the burn for a tier. */
  setTier(tier: QualityTier): void;
  /** Spend one frame's stress load; returns the measured wall time. */
  burn(now: () => number): number;
  dispose(): void;
}

/** Deterministic pseudo-random in [0, 1) from an integer, for field placement. */
function hash01(value: number): number {
  const x = Math.sin(value * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Create the stress rig under `parent`.
 *
 * The field is built once — geometry, material and every instance matrix — and
 * hidden, so an idle composed game pays nothing for it while the tier's
 * instance budget stays concrete and observable.
 */
export function createStressRig(
  parent: Object3D,
  options: StressRigOptions = {},
): StressRig {
  const side = Math.max(2, Math.round(Math.cbrt(options.capacity ?? STRESS_INSTANCE_CAPACITY)));
  const capacity = side * side * side;
  const extent = options.extent ?? 22;
  const height = options.height ?? 26;
  const targets = options.targets;

  const geometry = new BoxGeometry(0.34, 0.34, 0.34);
  const material = new MeshStandardMaterial({
    color: 0x8fa6bd,
    emissive: 0x1d5f7a,
    emissiveIntensity: 0.7,
    metalness: 0.65,
    roughness: 0.32,
  });

  const root = new InstancedMesh(geometry, material, capacity);
  root.name = STRESS_FIELD_NAME;
  root.userData[SHADOW_CASTER_FLAG] = true;
  root.visible = false;
  root.count = 0;
  root.frustumCulled = false;
  root.matrixAutoUpdate = false;
  parent.add(root);

  const matrixScratch = new Float64Array(16);
  const quaternion = new Quaternion();
  const axis = new Vector3(1, 1, 0).normalize();
  const position = new Vector3();
  const scale = new Vector3();
  const cyan = new Color(0x35f0ff);
  const magenta = new Color(0xff4fd8);
  const tint = new Color();

  for (let index = 0; index < capacity; index += 1) {
    const ix = index % side;
    const iy = Math.floor(index / side) % side;
    const iz = Math.floor(index / (side * side)) % side;
    const unit = 1 / Math.max(1, side - 1);
    position.set(
      (ix * unit - 0.5) * extent * 2 + (hash01(index * 3 + 1) - 0.5) * 1.6,
      1.4 + iy * unit * height,
      (iz * unit - 0.5) * extent * 2 + (hash01(index * 3 + 2) - 0.5) * 1.6,
    );
    const size = 0.7 + hash01(index * 3 + 3) * 1.5;
    scale.set(size, size, size);
    quaternion.setFromAxisAngle(axis, hash01(index * 5 + 7) * Math.PI);

    matrixScratch[0] = (1 - 2 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z)) * scale.x;
    matrixScratch[1] = 2 * (quaternion.x * quaternion.y + quaternion.z * quaternion.w) * scale.x;
    matrixScratch[2] = 2 * (quaternion.x * quaternion.z - quaternion.y * quaternion.w) * scale.x;
    matrixScratch[3] = 0;
    matrixScratch[4] = 2 * (quaternion.x * quaternion.y - quaternion.z * quaternion.w) * scale.y;
    matrixScratch[5] = (1 - 2 * (quaternion.x * quaternion.x + quaternion.z * quaternion.z)) * scale.y;
    matrixScratch[6] = 2 * (quaternion.y * quaternion.z + quaternion.x * quaternion.w) * scale.y;
    matrixScratch[7] = 0;
    matrixScratch[8] = 2 * (quaternion.x * quaternion.z + quaternion.y * quaternion.w) * scale.z;
    matrixScratch[9] = 2 * (quaternion.y * quaternion.z - quaternion.x * quaternion.w) * scale.z;
    matrixScratch[10] = (1 - 2 * (quaternion.x * quaternion.x + quaternion.y * quaternion.y)) * scale.z;
    matrixScratch[11] = 0;
    matrixScratch[12] = position.x;
    matrixScratch[13] = position.y;
    matrixScratch[14] = position.z;
    matrixScratch[15] = 1;
    root.instanceMatrix.array.set(matrixScratch, index * 16);

    tint.copy(index % 2 === 0 ? cyan : magenta);
    root.setColorAt(index, tint);
  }
  root.instanceMatrix.needsUpdate = true;
  if (root.instanceColor) root.instanceColor.needsUpdate = true;

  /** Allocated once: the burn's working set never grows and never allocates. */
  const heat = new Float64Array(1024);
  for (let index = 0; index < heat.length; index += 1) {
    heat[index] = 1 + (index % 17) * 0.001;
  }

  let disposed = false;
  let active = false;
  let scaleFraction = 0;
  let count = 0;
  let targetMs = resolveTierSettings(DEFAULT_QUALITY_TIER).stressMs;
  let iterations = Math.max(
    STRESS_MIN_ITERATIONS,
    Math.round(targetMs * STRESS_ITERATIONS_PER_MS),
  );
  let burnedMs = 0;
  let sink = 0;

  function syncCount(): void {
    count = active ? Math.max(0, Math.min(capacity, Math.round(capacity * scaleFraction))) : 0;
    root.count = count;
    root.visible = active && count > 0;
  }

  return {
    root,
    capacity,
    get object() {
      return root;
    },
    get active() {
      return active;
    },
    get count() {
      return count;
    },
    get iterations() {
      return iterations;
    },
    get burnedMs() {
      return burnedMs;
    },
    get targetMs() {
      return targetMs;
    },
    get disposed() {
      return disposed;
    },
    setInstanceBudget(fraction: number): number {
      scaleFraction = clampNumber(fraction, 0, 1);
      syncCount();
      return count;
    },
    setShadows(enabled: boolean): void {
      root.castShadow = enabled;
      root.receiveShadow = enabled;
    },
    setActive(next: boolean): void {
      active = next !== false && !disposed;
      syncCount();
    },
    setTier(tier: QualityTier): void {
      const settings = resolveTierSettings(tier);
      targetMs = targets?.[tier] ?? settings.stressMs;
      iterations = Math.max(
        STRESS_MIN_ITERATIONS,
        Math.round(targetMs * STRESS_ITERATIONS_PER_MS),
      );
      burnedMs = 0;
    },
    burn(now: () => number): number {
      if (disposed || !active) return 0;
      const started = now();
      let accumulator = 0;
      const steps = iterations;
      for (let index = 0; index < steps; index += 1) {
        const slot = index & 1023;
        const value = (heat[slot] ?? 0) * 1.0000001 + (index & 7);
        heat[slot] = value;
        accumulator += value;
      }
      sink = accumulator;
      const measured = now() - started;
      burnedMs = measured > 0 ? measured : 0;
      if (measured >= STRESS_CALIBRATION_FLOOR_MS) {
        const factor = clampNumber(targetMs / measured, 0.5, 2);
        iterations = clampNumber(
          Math.round(iterations * factor),
          STRESS_MIN_ITERATIONS,
          STRESS_MAX_ITERATIONS,
        );
      }
      return burnedMs;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      active = false;
      count = 0;
      root.removeFromParent();
      root.clear();
      geometry.dispose();
      material.dispose();
      root.dispose();
      void sink;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Application                                                                */
/* -------------------------------------------------------------------------- */

/** The post chain surface a tier drives, structurally satisfied by `World`. */
export interface QualityPostChainHook {
  readonly glow: Object3D;
  readonly rays: Object3D;
  readonly screen: Object3D;
}

/** The world surface a tier drives, structurally satisfied by `World`. */
export interface QualityWorldHook {
  setPreset(preset: PostQualityPreset): void;
  readonly post: QualityPostChainHook | null;
}

/** Everything a tier writes, and nothing else. */
export interface QualityTarget {
  /** Adapter whose pixel ratio and scene the tier governs. */
  readonly adapter: RenderAdapter;
  /** World whose post preset and post chain the tier governs. */
  readonly world?: QualityWorldHook | null;
  /** Scene root scanned for shadow switches. Defaults to `adapter.scene`. */
  readonly scene?: Object3D | null;
  /** Instance field whose draw count the tier scales. */
  readonly instances?: QualityInstanceHook | null;
}

/**
 * Apply a tier to the shared adapter and the presentation it owns.
 *
 * Writes are idempotent and allocation-free: pass the governor's owned `into`
 * record and nothing is created, pass nothing and one small record is built.
 * Simulation state is neither read nor written here.
 */
export function applyQualityTier(
  target: QualityTarget,
  tier: QualityTier,
  into: AppliedQualitySettings = createAppliedQualitySettings(tier),
): AppliedQualitySettings {
  const settings = resolveTierSettings(tier);
  const preset = POST_QUALITY_SETTINGS[settings.postPreset];
  const adapter = target.adapter;

  if (!adapter.disposed && adapter.pixelRatio !== settings.pixelRatio) {
    adapter.resize(adapter.width, adapter.height, settings.pixelRatio);
  }

  const world = target.world ?? null;
  if (world) {
    world.setPreset(settings.postPreset);
    const chain = world.post;
    if (chain) {
      chain.glow.visible = settings.post;
      chain.rays.visible = settings.post;
      chain.screen.visible = settings.post;
    }
  }

  const shadows = applyQualityShadows(target.scene ?? adapter.scene, settings.shadows);

  const instances = target.instances ?? null;
  const instanceCount = instances ? instances.setInstanceBudget(settings.instanceScale) : 0;
  instances?.setShadows(settings.shadows);

  const record = into as LiveAppliedQualitySettings;
  record.tier = settings.tier;
  record.pixelRatio = settings.pixelRatio;
  record.shadows = settings.shadows;
  record.post = settings.post;
  record.postPreset = settings.postPreset;
  record.haloRings = preset.haloRings;
  record.rayCount = preset.rayCount;
  record.instanceScale = settings.instanceScale;
  record.instanceCount = instanceCount;
  record.targetMs = settings.budget.targetMs;
  record.ceilingMs = settings.budget.ceilingMs;
  record.shadowLights = shadows.lights;
  record.shadowCasters = shadows.casters;
  record.shadowReceivers = shadows.receivers;
  record.revision += 1;
  return into;
}

/* -------------------------------------------------------------------------- */
/* Game system                                                                */
/* -------------------------------------------------------------------------- */

/** Live performance state of the governor; one owned record, updated in place. */
export interface QualityTierState {
  readonly tier: QualityTier;
  readonly fps: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly samples: number;
  readonly window: number;
  readonly budgetMs: number;
  readonly overBudget: boolean;
  readonly headroom: boolean;
  readonly stress: boolean;
  /** Whether the tier is pinned rather than adaptive. */
  readonly held: boolean;
  readonly applied: AppliedQualitySettings;
  /** Bumped on every tier application. */
  readonly revision: number;
}

interface LiveQualityTierState {
  tier: QualityTier;
  fps: number;
  medianMs: number;
  p95Ms: number;
  samples: number;
  window: number;
  budgetMs: number;
  overBudget: boolean;
  headroom: boolean;
  stress: boolean;
  held: boolean;
  applied: AppliedQualitySettings | null;
  revision: number;
}

export interface QualityTierSystemOptions {
  /** System id. Defaults to `render/quality-tiers`. */
  id?: string;
  /** Starting tier. Defaults to the device-derived `initialQualityTier()`. */
  tier?: QualityTier;
  /** Device signals; read at attach when omitted. */
  signals?: QualityDeviceSignals;
  /** Samples per window. Defaults to `QUALITY_WINDOW_SIZE`. */
  window?: number;
  /** Hysteresis overrides. */
  thresholds?: Partial<TierThresholds>;
  /** Accessor for the world whose post chain the tier governs. */
  world?: () => QualityWorldHook | null;
  /** Stress rig configuration, or `false` to compose without one. */
  stress?: StressRigOptions | false;
  /**
   * Log tier changes and the first window that holds a new tier on the console.
   * Defaults to `true`: a handover of fidelity is exactly the kind of rare event
   * that belongs in a diagnostic log. Pass `false` for silent runs.
   */
  log?: boolean;
  /** Listener called after every tier application. */
  onChange?(state: QualityTierState): void;
}

/** The adaptive quality governor as a composable game system. */
export interface QualityTierSystem extends GameSystem {
  readonly tier: QualityTier;
  readonly applied: AppliedQualitySettings;
  /** Live governor state; updated in place. */
  readonly state: QualityTierState;
  readonly monitor: FrameTimeMonitor;
  readonly stats: FrameTimeStats;
  readonly adaptive: AdaptiveQuality;
  readonly stressActive: boolean;
  /** Whether the tier is pinned rather than adaptive. */
  readonly holding: boolean;
  readonly rig: StressRig | null;
  readonly signals: QualityDeviceSignals;
  /** Tier changes applied since attach. */
  readonly changes: number;
  readonly disposed: boolean;
  /** Force a tier; the governor clamps it to the device band. */
  setTier(tier: QualityTier, reason?: QualityChangeReason): boolean;
  /**
   * Pin a tier, or release the pin with `null`.
   *
   * Pinning is what lets a host inspect a tier's presentation on a machine that
   * cannot hold it adaptively: the measurement keeps running, so the readout
   * still reports the real frame time, but the tiers stop moving. Engaging the
   * stress rig releases the pin — a stress run has to adapt to mean anything.
   */
  holdTier(tier: QualityTier | null): boolean;
  /** Engage or release the stress rig. Returns `true` when it moved. */
  setStress(active: boolean): boolean;
  toggleStress(): boolean;
  /** Subscribe to tier applications; returns an unsubscribe function. */
  subscribe(listener: (state: QualityTierState) => void): () => void;
}

/**
 * Compose the adaptive governor as a game system.
 *
 * Register it **after** every other system: it reads the adapter, the composed
 * scene and the world's post chain, and it is the last writer to the registry
 * (see `src/game/systems.ts`). It attaches without a DOM, without a canvas and
 * without the world, so headless tests can drive the tier ladder directly.
 */
export function createQualityTierSystem(
  options: QualityTierSystemOptions = {},
): QualityTierSystem {
  const signals = options.signals ?? detectDeviceSignals();
  const maxTier = deviceTierCeiling(signals);
  const initialTier = clampQualityTier(options.tier ?? initialQualityTier(signals), MINIMAL_QUALITY_TIER, maxTier);

  const applied = createAppliedQualitySettings(initialTier);
  const listeners = new Set<(state: QualityTierState) => void>();
  const liveState: LiveQualityTierState = {
    tier: initialTier,
    fps: 0,
    medianMs: 0,
    p95Ms: 0,
    samples: 0,
    window: options.window ?? QUALITY_WINDOW_SIZE,
    budgetMs: resolveTierSettings(initialTier).budget.targetMs,
    overBudget: false,
    headroom: false,
    stress: false,
    held: false,
    applied,
    revision: 0,
  };

  let rig: StressRig | null = null;
  let scene: Object3D | null = null;
  let adapter: RenderAdapter | null = null;
  let clockNow: (() => number) | null = null;
  let lastSampleMs = 0;
  let changes = 0;
  let disposed = false;
  let stressActive = false;

  /** Rare, high-value diagnostics: one line per tier change, not per frame. */
  function logLine(message: string): void {
    if (options.log === false || typeof console === 'undefined') return;
    console.info(`[coroid] ${message}`);
  }

  const adaptive = createAdaptiveQuality({
    tier: initialTier,
    window: options.window,
    minTier: MINIMAL_QUALITY_TIER,
    maxTier,
    // A stress run may only shed load: the rig measures the worst case, so the
    // governor must not spend headroom it did not really find.
    allowUpgrade: true,
    ...(options.thresholds ? { thresholds: options.thresholds } : {}),
    onChange: (tier, reason) => {
      apply(tier, reason);
    },
  });

  function syncState(): void {
    const stats = adaptive.stats;
    liveState.tier = adaptive.tier;
    liveState.fps = stats.fps;
    liveState.medianMs = stats.medianMs;
    liveState.p95Ms = stats.p95Ms;
    liveState.samples = stats.samples;
    liveState.window = stats.window;
    liveState.budgetMs = stats.budgetMs;
    liveState.overBudget = stats.overBudget;
    liveState.headroom = stats.headroom;
    liveState.stress = stressActive;
    liveState.held = adaptive.holding;
    liveState.applied = applied;
    liveState.revision = applied.revision;
  }

  function notify(): void {
    if (listeners.size === 0) return;
    syncState();
    for (const listener of listeners) listener(liveState as QualityTierState);
    options.onChange?.(liveState as QualityTierState);
  }

  /** Write the tier into the presentation; called on every change. */
  function apply(tier: QualityTier, reason: QualityChangeReason): void {
    if (reason !== 'hold') changes += 1;
    rig?.setTier(tier);
    if (adapter) {
      applyQualityTier(
        {
          adapter,
          world: options.world?.() ?? null,
          scene,
          instances: rig,
        },
        tier,
        applied,
      );
    } else {
      // Not attached (or already torn down): keep the record honest anyway.
      const settings = resolveTierSettings(tier);
      const record = applied as LiveAppliedQualitySettings;
      record.tier = settings.tier;
      record.pixelRatio = settings.pixelRatio;
      record.shadows = settings.shadows;
      record.post = settings.post;
      record.postPreset = settings.postPreset;
      record.haloRings = POST_QUALITY_SETTINGS[settings.postPreset].haloRings;
      record.rayCount = POST_QUALITY_SETTINGS[settings.postPreset].rayCount;
      record.instanceScale = settings.instanceScale;
      record.instanceCount = rig?.count ?? 0;
      record.targetMs = settings.budget.targetMs;
      record.ceilingMs = settings.budget.ceilingMs;
      record.revision += 1;
    }
    syncState();
    notify();
    if (reason !== 'startup' && reason !== 'hold') {
      logLine(
        `quality tier → ${tier} (${reason}) · median ${liveState.medianMs.toFixed(1)} ms · p95 ${liveState.p95Ms.toFixed(1)} ms · ${liveState.fps > 0 ? liveState.fps.toFixed(0) : '—'} fps · pixel ratio ${applied.pixelRatio} · post ${applied.post ? applied.postPreset : 'off'} · shadows ${applied.shadows ? 'on' : 'off'} · instances ${applied.instanceCount} · demotions ${adaptive.strikes.join('/')}`,
      );
    }
  }

  const system: QualityTierSystem = {
    id: options.id ?? 'render/quality-tiers',
    get tier() {
      return adaptive.tier;
    },
    applied,
    get state() {
      syncState();
      return liveState as QualityTierState;
    },
    get monitor() {
      return adaptive.monitor;
    },
    get stats() {
      return adaptive.stats;
    },
    get adaptive() {
      return adaptive;
    },
    get stressActive() {
      return stressActive;
    },
    get holding() {
      return adaptive.holding;
    },
    get rig() {
      return rig;
    },
    signals,
    get changes() {
      return changes;
    },
    get disposed() {
      return disposed;
    },
    attach(context: SystemContext): void {
      if (disposed) return;
      adapter = context.adapter;
      scene = context.scene;
      clockNow = () => context.clock.now();
      lastSampleMs = context.clock.now();
      if (options.stress !== false) {
        rig = createStressRig(context.scene, options.stress ?? {});
      }
      apply(adaptive.tier, 'startup');
    },
    update(_update: SystemUpdate): void {
      if (disposed || !clockNow) return;
      const now = clockNow();
      const delta = now - lastSampleMs;
      lastSampleMs = now;
      // Measure first, then spend: the sample this step records is the frame the
      // previous step's burn and the renderer actually took.
      const changed = adaptive.observe(delta);
      if (stressActive) rig?.burn(clockNow);
      // The first whole window on a new tier is the one that shows whether the
      // handover worked; record it once, in text, for acceptance to read.
      if (!changed && adaptive.decision.windowsSinceChange === 1) {
        const stats = adaptive.stats;
        if (stats.samples > 0) {
          logLine(
            `quality holding ${adaptive.tier} · median ${stats.medianMs.toFixed(1)} ms / ${stats.budgetMs.toFixed(1)} ms target ${stats.medianMs <= stats.budgetMs ? '✓' : '✗'} · p95 ${stats.p95Ms.toFixed(1)} ms / ${(stats.budgetMs * 2).toFixed(1)} ms ceiling ${stats.p95Ms <= stats.budgetMs * 2 ? '✓' : '✗'} · ${stats.fps > 0 ? stats.fps.toFixed(0) : '—'} fps${stressActive ? ' · stress rig engaged' : ''}`,
          );
        }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      rig?.dispose();
      rig = null;
      scene = null;
      adapter = null;
      clockNow = null;
      stressActive = false;
      adaptive.setHold(false);
      liveState.stress = false;
      liveState.held = false;
    },
    setTier(tier: QualityTier, reason: QualityChangeReason = 'manual'): boolean {
      if (disposed) return false;
      return adaptive.setTier(tier, reason);
    },
    holdTier(tier: QualityTier | null): boolean {
      if (disposed) return false;
      if (tier === null) {
        const wasHeld = adaptive.holding;
        adaptive.setHold(false);
        if (wasHeld) {
          syncState();
          notify();
          logLine(`quality tier released · adaptive from ${adaptive.tier}`);
        }
        return wasHeld;
      }
      const moved = adaptive.setTier(tier, 'manual');
      adaptive.setHold(true);
      syncState();
      notify();
      logLine(`quality tier pinned to ${adaptive.tier} · measurement continues`);
      return moved || adaptive.holding;
    },
    setStress(active: boolean): boolean {
      if (disposed) return false;
      const next = active === true;
      if (next === stressActive) return false;
      stressActive = next;
      rig?.setActive(next);
      // A stress run may only shed load: the rig measures the worst case, so the
      // governor must not spend headroom it did not really find. It also
      // releases any pinned tier — an adaptive run is the whole point.
      adaptive.setAllowUpgrade(!next);
      adaptive.setHold(false);
      if (next) {
        // Engaging the rig probes the worst case: the richest configuration the
        // device allows *plus* forced load, so the run observes the governor
        // shedding a tier the host cannot afford instead of only the load
        // itself. The window restarts, so the ladder is judged on stress frames.
        adaptive.reset(adaptive.maxTier);
      } else {
        adaptive.reset(adaptive.tier);
      }
      rig?.setTier(adaptive.tier);
      // Re-apply so the instance budget and the applied record follow the rig.
      apply(adaptive.tier, 'hold');
      logLine(
        next
          ? `stress rig engaged · re-armed at ${adaptive.tier} · ${rig?.count ?? 0}/${rig?.capacity ?? 0} instances · ${rig?.targetMs.toFixed(0) ?? '0'} ms/frame load`
          : `stress rig released · tier ${adaptive.tier}`,
      );
      return true;
    },
    toggleStress(): boolean {
      return system.setStress(!stressActive);
    },
    subscribe(listener: (state: QualityTierState) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return system;
}
