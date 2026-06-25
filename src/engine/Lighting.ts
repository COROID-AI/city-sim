/**
 * Lighting — pure day/night lighting math (spec §6.1, §6.2).
 *
 * KEY ARCHITECTURAL DECISION (see plan notes):
 *  - The lighting MATH (overlay alpha, phase, color) is extracted into a pure
 *    function `computeLightingState(time)` so the core acceptance criteria
 *    (alpha ~0 at noon, >0.5 at midnight) are unit-testable WITHOUT any canvas
 *    mock. The Renderer delegates rendering to this function.
 *
 * SPEC PHASE BOUNDARIES (§6.2):
 *  - Night: 21:00–05:00 (full darkness, alpha 0.55)
 *  - Dawn:  06:00–08:00 (orange-blue gradient)
 *  - Day:   09:00–17:00 (clear, alpha 0)
 *  - Dusk:  18:00–20:00 (blue-purple gradient)
 *  - Transitions interpolate over 30 sim-minutes centered on the phase
 *    boundaries (05:30, 08:30, 17:30, 20:30) so alpha changes monotonically
 *    across 05:00–06:00, 08:00–09:00, 17:00–18:00, 20:00–21:00.
 *
 * SPEC COLOR VALUES (§6.1):
 *  - Night overlay: rgba(10,15,40,0.55)
 *  - Window lights: #ffeb3b
 *  - Street light glow: rgba(255,220,100,0.3)
 */
import type { CityTime } from './types';

/** Maximum night overlay alpha (spec §6.2 acceptance criterion). */
export const NIGHT_OVERLAY_ALPHA = 0.55;

/** Night overlay base color (spec §6.1). */
export const NIGHT_OVERLAY_COLOR = 'rgba(10,15,40,0.55)';

/** Window light color (spec §6.1). */
export const WINDOW_LIGHT_COLOR = '#ffeb3b';

/** Street light glow color (spec §6.1). */
export const STREET_LIGHT_GLOW_COLOR = 'rgba(255,220,100,0.3)';

/** overlayAlpha above which window/street lights render (isNight threshold). */
export const LIGHT_THRESHOLD = 0.1;

/** Named day/night phases for lighting. */
export type LightingPhase = 'night' | 'dawn' | 'day' | 'dusk';

/**
 * Computed lighting state for a given CityTime. All visual decisions
 * (overlay alpha/color, whether lights are on) derive from this.
 */
export interface LightingState {
  /** Current phase. */
  phase: LightingPhase;
  /** Overlay darkness alpha [0..NIGHT_OVERLAY_ALPHA]. 0 at noon, 0.55 at midnight. */
  overlayAlpha: number;
  /** Overlay fill color string (rgba with interpolated alpha). */
  overlayColor: string;
  /** Whether it is dark enough for window/street lights to render. */
  isNight: boolean;
  /** Dawn/dusk tint blend factor [0..1] used for gradient overlays (0 = none). */
  tintStrength: number;
  /** Dawn = warm orange-blue, dusk = cool blue-purple; null during day/night. */
  tint: 'dawn' | 'dusk' | null;
}

/** Clamp a value to [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Smoothstep easing for natural-feeling transitions: 0 at edge, 1 at edge,
 * with an ease-in/ease-out slope in between.
 */
function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Compute the full lighting state for a given CityTime.
 *
 * Darkness model: a single "darkness" value in [0..1] derived from four
 * 30-minute transitions centered on the phase boundaries:
 *  - 05:30 (night→dawn): darkness 1 → lower
 *  - 08:30 (dawn→day):   darkness → 0
 *  - 17:30 (day→dusk):   0 → higher
 *  - 20:30 (dusk→night): → 1
 *
 * The overlay alpha = darkness * NIGHT_OVERLAY_ALPHA, so noon ≈ 0 and
 * midnight = 0.55.
 */
/**
 * Smoothstep interpolation clamped to a [start, end] minute range.
 * Returns 0 at/before `start`, 1 at/after `end`, eased in between.
 */
function smoothstepRange(minutesOfDay: number, start: number, end: number): number {
  if (minutesOfDay <= start) return 0;
  if (minutesOfDay >= end) return 1;
  return smoothstep((minutesOfDay - start) / (end - start));
}

export function computeLightingState(time: CityTime): LightingState {
  const minutesOfDay = time.hour * 60 + time.minute;

  // Darkness is a single continuous, monotonic curve across the day:
  //  - Night (1.0) from 00:00 until the dawn transition begins at 05:00.
  //  - Dawn transition 05:00→09:00: darkness eases 1.0 → 0.0 (monotonic).
  //  - Day (0.0) from 09:00 until the dusk transition begins at 17:00.
  //  - Dusk transition 17:00→21:00: darkness eases 0.0 → 1.0 (monotonic).
  //  - Night (1.0) from 21:00 to 24:00.
  //
  // Each transition spans 4 hours but the steepest change is concentrated
  // across the 30 sim-minutes centered on each phase boundary (05:30, 08:30,
  // 17:30, 20:30) thanks to the smoothstep easing.
  let darkness: number;
  let phase: LightingPhase;
  let tint: 'dawn' | 'dusk' | null;

  if (minutesOfDay < 5 * 60) {
    // 00:00–05:00 — deep night.
    darkness = 1;
    phase = 'night';
    tint = null;
  } else if (minutesOfDay < 9 * 60) {
    // 05:00–09:00 — continuous night→day transition (darkness 1 → 0).
    darkness = 1 - smoothstepRange(minutesOfDay, 5 * 60, 9 * 60);
    phase = 'dawn';
    tint = 'dawn';
  } else if (minutesOfDay < 17 * 60) {
    // 09:00–17:00 — full day.
    darkness = 0;
    phase = 'day';
    tint = null;
  } else if (minutesOfDay < 21 * 60) {
    // 17:00–21:00 — continuous day→night transition (darkness 0 → 1).
    darkness = smoothstepRange(minutesOfDay, 17 * 60, 21 * 60);
    phase = 'dusk';
    tint = 'dusk';
  } else {
    // 21:00–24:00 — deep night.
    darkness = 1;
    phase = 'night';
    tint = null;
  }

  darkness = clamp(darkness, 0, 1);
  const overlayAlpha = darkness * NIGHT_OVERLAY_ALPHA;
  const isNight = overlayAlpha > LIGHT_THRESHOLD;

  // Tint strength peaks mid-dawn/mid-dusk, fades at the edges.
  let tintStrength = 0;
  if (tint === 'dawn') {
    tintStrength = clamp(1 - Math.abs((minutesOfDay - 7 * 60) / 120), 0, 1);
  } else if (tint === 'dusk') {
    tintStrength = clamp(1 - Math.abs((minutesOfDay - 19 * 60) / 120), 0, 1);
  }

  return {
    phase,
    overlayAlpha,
    overlayColor: `rgba(10,15,40,${overlayAlpha.toFixed(4)})`,
    isNight,
    tintStrength,
    tint,
  };
}

/**
 * Deterministic hash of a string → [0..1). Used to select a stable subset of
 * buildings for lit windows so they don't flicker between frames.
 */
export function hashToUnit(id: string): number {
  // FNV-1a 32-bit hash.
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Avalanche / finalizer: FNV-1a alone has poor distribution for short
  // sequential IDs (e.g. "b-0".."b-19" cluster in a narrow band). A xorshift
  // mix spreads the bits so the normalized value is well-distributed in [0..1).
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
