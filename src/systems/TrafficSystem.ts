/**
 * TrafficSystem.
 *
 * Spec reference: §7.4 Traffic.
 *
 * Cycles the city's traffic lights through:
 *   NS_GREEN -> ALL_RED -> EW_GREEN -> ALL_RED -> NS_GREEN
 *
 * Pure TypeScript, framework-agnostic. The renderer subscribes to
 * `getCurrentPhase()` and `getRedLightTiles()` to colour roads and
 * stop vehicles. The pathfinder and the vehicle advance code consume
 * the red-light tile set via the `TrafficSnapshot` contract defined
 * in `@/entities/Road`.
 *
 * Configuration: `greenDurationMs` and `allRedDurationMs` are
 * constructor options so tests can shorten the cycle to milliseconds
 * and assert the phase transitions deterministically.
 */
import type { TrafficPhase } from '@/entities/Road';

export interface TrafficSystemOptions {
  /** NS/EW green phase length in (scaled) milliseconds. Default 15000. */
  greenDurationMs?: number;
  /** ALL_RED safety phase length in (scaled) milliseconds. Default 2500. */
  allRedDurationMs?: number;
  /**
   * Initial phase. Defaults to 'NS_GREEN' so the first frame is
   * deterministic for tests and the renderer.
   */
  initialPhase?: TrafficPhase;
  /**
   * The intersections that participate in the cycle. Each entry is
   * an `x,y` key into the road graph. If omitted, the system has no
   * red-light tiles and `isTileOnRed` always returns false.
   */
  intersectionKeys?: readonly string[];
}

interface PhaseWindow {
  phase: TrafficPhase;
  /** Length of this phase in ms. */
  durationMs: number;
}

const CYCLE: readonly PhaseWindow[] = [
  { phase: 'NS_GREEN', durationMs: 15_000 },
  { phase: 'ALL_RED', durationMs: 2_500 },
  { phase: 'EW_GREEN', durationMs: 15_000 },
  { phase: 'ALL_RED', durationMs: 2_500 },
];

export class TrafficSystem {
  private readonly greenDurationMs: number;
  private readonly allRedDurationMs: number;
  private readonly intersections: ReadonlySet<string>;
  private readonly cycle: readonly PhaseWindow[];
  private phaseIndex: number;
  private phaseElapsedMs: number;

  constructor(options: TrafficSystemOptions = {}) {
    this.greenDurationMs = options.greenDurationMs ?? CYCLE[0]!.durationMs;
    this.allRedDurationMs = options.allRedDurationMs ?? CYCLE[1]!.durationMs;
    this.intersections = new Set(options.intersectionKeys ?? []);
    // Build a per-instance cycle so options take effect.
    this.cycle = [
      { phase: 'NS_GREEN', durationMs: this.greenDurationMs },
      { phase: 'ALL_RED', durationMs: this.allRedDurationMs },
      { phase: 'EW_GREEN', durationMs: this.greenDurationMs },
      { phase: 'ALL_RED', durationMs: this.allRedDurationMs },
    ];
    const initial = options.initialPhase ?? 'NS_GREEN';
    const idx = this.cycle.findIndex((w) => w.phase === initial);
    this.phaseIndex = idx >= 0 ? idx : 0;
    this.phaseElapsedMs = 0;
  }

  /** The current traffic-light phase. */
  getCurrentPhase(): TrafficPhase {
    return this.cycle[this.phaseIndex]?.phase ?? 'ALL_RED';
  }

  /**
   * Advance the clock by `deltaMs` (scaled milliseconds). Call once
   * per game tick; the system handles phase transitions internally.
   */
  tick(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) return;
    this.phaseElapsedMs += deltaMs;
    const current = this.cycle[this.phaseIndex];
    if (!current) return;
    if (this.phaseElapsedMs >= current.durationMs) {
      this.phaseElapsedMs -= current.durationMs;
      this.phaseIndex = (this.phaseIndex + 1) % this.cycle.length;
    }
  }

  /**
   * Returns the set of `x,y` keys for tiles that currently block
   * traffic. In the default model, ALL_RED phases block *all*
   * intersections, and the green phases block the opposing axis
   * (so an NS-bound car stops at an EW_GREEN intersection, and vice
   * versa). Without road-graph context we can only approximate axis
   * blocking at the per-tile level, so we conservatively treat every
   * intersection as red during ALL_RED. Green phases let all
   * intersections through - the pathfinder penalises the *opposing
   * approach* via the redLightTiles snapshot, not this method.
   *
   * If a more sophisticated axis-aware check is needed in the future
   * we can extend `TrafficSnapshot` to expose per-tile axis info.
   */
  getRedLightTiles(): ReadonlySet<string> {
    if (this.getCurrentPhase() === 'ALL_RED') {
      return this.intersections;
    }
    return EMPTY_SET;
  }

  /**
   * Returns true if the given intersection tile is currently blocked.
   * Convenience for the renderer and the vehicle advance code.
   */
  isTileOnRed(key: string): boolean {
    return this.getRedLightTiles().has(key);
  }

  /**
   * Returns true if the given intersection tile is *open* (i.e. not
   * currently red). The two predicates are exact complements when
   * the intersection list is non-empty, and both return false/true
   * for an unknown tile by convention.
   */
  isIntersectionOpen(key: string): boolean {
    if (!this.intersections.has(key)) return true;
    return !this.isTileOnRed(key);
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
