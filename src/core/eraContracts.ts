/**
 * Chrono City — era contracts.
 *
 * The shared vocabulary that every era-driven system speaks: the five era ids,
 * the descriptor each era *timeline* task instantiates, and the `EraBlendable`
 * interface that lets a system morph between two eras without knowing how the
 * transition is scheduled.
 *
 * This module deliberately contains no era *content* (no palettes, no sounds,
 * no meshes) — only the contract, so content tasks stay free to define what a
 * given year looks and sounds like.
 *
 * Lifecycle:
 *   create    → the contracts (types, `ERA_IDS`, helpers) are created here.
 *   consume   → systems import `EraId` / `EraDescriptor` / `EraBlendable`.
 *   integrate → the timeline runtime calls `setEra()` once and then feeds
 *               `updateEraTransition()` once per frame until the tween lands.
 */

export const ERA_CONTRACTS_VERSION = 1;

/**
 * The five eras Chrono City can show, in chronological order.
 * Keep this the single source of truth: order defines the timeline and the
 * numeric strings define the `EraId` union.
 */
export const ERA_IDS = ['1945', '1965', '1985', '2005', '2025'] as const;

/** A year-based era identifier. */
export type EraId = (typeof ERA_IDS)[number];

/** The era the app starts in before any timeline system moves it. */
export const DEFAULT_ERA: EraId = '2025';

/** Earliest era in the timeline. */
export const FIRST_ERA: EraId = '1945';

/** Latest era in the timeline. */
export const LAST_ERA: EraId = '2025';

/**
 * Static, era-neutral description of one era. The era timeline task owns the
 * concrete instances; every other system consumes them read-only.
 */
export interface EraDescriptor {
  /** Canonical id, also the year label. */
  readonly id: EraId;
  /** Numeric year (e.g. `1985`) for interpolation and timeline maths. */
  readonly year: number;
  /** Short human-readable title, e.g. for the HUD. */
  readonly label: string;
  /** One-sentence summary of what defines the era. */
  readonly description: string;
}

/** Options accepted when a system is asked to move to an era. */
export interface EraTransitionOptions {
  /** Tween length in milliseconds. `0` snaps immediately. */
  readonly durationMs?: number;
  /** Skip the tween entirely and apply the target era at full strength. */
  readonly immediate?: boolean;
}

/**
 * Snapshot of the active tween, handed to `updateEraTransition()` alongside the
 * progress value so systems can branch on the endpoints or on whether the
 * transition has finished.
 */
export interface EraTransitionInfo {
  /** Era the transition started from. */
  readonly from: EraId;
  /** Era the transition is heading to. */
  readonly to: EraId;
  /** Milliseconds elapsed since the transition began. */
  readonly elapsedMs: number;
  /** Total tween length in milliseconds (`0` for instant switches). */
  readonly durationMs: number;
  /** `true` while the tween is still running. */
  readonly active: boolean;
}

/**
 * Implemented by every system that visibly changes with the era.
 *
 * Contract:
 *  - `setEra()` is called once when a transition starts; it records the target
 *    and prepares whatever the tween will need.
 *  - `updateEraTransition(progress, info)` is called every frame while the
 *    tween runs (`progress` in `[0, 1]`, `0` = fully the source era, `1` = fully
 *    the target era) and once more with `1` when it completes. Implementations
 *    must interpolate between the two eras rather than snapping.
 */
export interface EraBlendable {
  setEra(era: EraId, options?: EraTransitionOptions): void;
  updateEraTransition(progress: number, transition: EraTransitionInfo): void;
}

/** Clamps an arbitrary number into the canonical unit progress range. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Eases a clamped progress value with a smooth (Hermite) curve. */
export function smoothStep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/** Narrows an unknown value to `EraId`. */
export function isEraId(value: unknown): value is EraId {
  return typeof value === 'string' && (ERA_IDS as readonly string[]).includes(value);
}

/** Throws a descriptive error when `value` is not a known era id. */
export function assertEraId(value: unknown): EraId {
  if (!isEraId(value)) {
    throw new RangeError(
      `Unknown era ${String(value)}; expected one of ${ERA_IDS.join(', ')}.`,
    );
  }
  return value;
}

/** Position of an era inside `ERA_IDS`, or `-1` when unknown. */
export function eraIndex(era: EraId): number {
  return (ERA_IDS as readonly string[]).indexOf(era);
}

/** Numeric year of an era id. */
export function eraYear(era: EraId): number {
  return Number.parseInt(era, 10);
}

/** Era immediately before `era` (older), or `null` at the start of the timeline. */
export function previousEra(era: EraId): EraId | null {
  const index = eraIndex(era);
  return index > 0 ? ERA_IDS[index - 1] : null;
}

/** Era immediately after `era` (newer), or `null` at the end of the timeline. */
export function nextEra(era: EraId): EraId | null {
  const index = eraIndex(era);
  return index >= 0 && index < ERA_IDS.length - 1 ? ERA_IDS[index + 1] : null;
}

/**
 * Convenience aggregate so consumers can do
 * `import { EraContracts } from './eraContracts'` and reach the whole contract
 * surface (ids plus helpers) from a single frozen namespace object.
 */
export const EraContracts = Object.freeze({
  version: ERA_CONTRACTS_VERSION,
  ids: ERA_IDS,
  defaultEra: DEFAULT_ERA,
  firstEra: FIRST_ERA,
  lastEra: LAST_ERA,
  isEraId,
  assertEraId,
  eraIndex,
  eraYear,
  previousEra,
  nextEra,
  clamp01,
  smoothStep01,
});
