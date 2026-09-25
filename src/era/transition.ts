/**
 * Era transformation controller.
 *
 * Owns the *visible* morph between two eras. Rather than alpha-fading two full
 * city layers at once (which interpenetrates geometry and causes depth-sorting
 * artefacts), the swap is staged per scene category: vehicles go first, then
 * storefronts, advertisements, buildings, pedestrians, props, roads and finally
 * the sky. Each category hands over inside its own short window, and the
 * incoming category rises/settles into place while the outgoing one compresses.
 * At most two categories are mid-swap at any instant.
 *
 * Colour grade, fog and sky palette are meanwhile lerped continuously, so the
 * whole frame visibly changes tone from the first millisecond of the change.
 *
 * The controller is three.js-only (no DOM, no WebGL) which keeps it fully
 * testable in Node with plain groups.
 */

import * as THREE from 'three';
import { CATEGORY_ORDER, type EraDefinition, type GradeSpec, type SceneCategory, type Year } from '../config/types';
import { ERAS } from '../config/eras';

/** Minimal structural contract a layer must satisfy to be transitioned. */
export interface TransitionLayerLike {
  year: Year;
  definition: EraDefinition;
  group: THREE.Object3D;
  categories: Record<SceneCategory, THREE.Object3D>;
  emissives: THREE.Mesh[];
}

export type TransitionEventType = 'start' | 'progress' | 'complete' | 'preview';

export interface TransitionEvent {
  type: TransitionEventType;
  /** Era the scene is leaving. */
  from: Year;
  /** Era the scene is heading to. */
  to: Year;
  /** 0..1 blend progress. */
  progress: number;
}

export interface TransitionState {
  active: boolean;
  previewing: boolean;
  /** Era currently in full control (updates only once a change completes). */
  committed: Year;
  from: Year;
  to: Year;
  progress: number;
  /** Per-era blend weights; only the two participating eras are non-zero. */
  weights: Record<Year, number>;
}

export interface CategoryBlend {
  category: SceneCategory;
  /** 0 = incoming era not yet in, 1 = incoming fully in. */
  incoming: number;
  incomingVisible: boolean;
  outgoingVisible: boolean;
}

export interface TransitionOptions {
  layers: ReadonlyMap<Year, TransitionLayerLike>;
  /** Full transformation duration in seconds. */
  duration?: number;
  /** Duration used when `prefers-reduced-motion` is set. */
  reducedMotionDuration?: number;
  reducedMotion?: boolean;
  /** Share of the timeline spent staggering the categories (0..0.8). */
  stagger?: number;
  onEvent?: (event: TransitionEvent) => void;
}

const DEFAULT_DURATION = 1.05;
const DEFAULT_REDUCED_DURATION = 0.14;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function zeroWeights(): Record<Year, number> {
  return { 1945: 0, 1965: 0, 1985: 0, 2005: 0, 2025: 0 };
}

function lerpGrade(a: GradeSpec, b: GradeSpec, t: number): GradeSpec {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  return {
    lift: lerp(a.lift, b.lift, t),
    saturation: lerp(a.saturation, b.saturation, t),
    gamma: lerp(a.gamma, b.gamma, t),
    temperature: lerp(a.temperature, b.temperature, t),
    grain: lerp(a.grain, b.grain, t),
    vignette: lerp(a.vignette, b.vignette, t),
    bloom: lerp(a.bloom, b.bloom, t),
  };
}

const BLACK = new THREE.Color('#000000');

export class EraTransitionController {
  private readonly layers: ReadonlyMap<Year, TransitionLayerLike>;
  private readonly baseDuration: number;
  private readonly reducedMotion: boolean;
  private readonly stagger: number;
  /** Width of one category's hand-over window (derived from `stagger`). */
  private readonly windowWidth: number;
  private readonly onEvent: ((event: TransitionEvent) => void) | undefined;

  private from: Year;
  private to: Year;
  private progress = 1;
  private active = false;
  private previewing = false;
  private committed: Year;
  private previewWeight = 0;

  constructor(options: TransitionOptions) {
    this.layers = options.layers;
    this.baseDuration = Math.max(0.05, options.duration ?? DEFAULT_DURATION);
    this.reducedMotion = options.reducedMotion ?? false;
    this.stagger = Math.min(0.9, Math.max(0, options.stagger ?? 0.85));
    // Windows are ~1.6 stagger steps wide, so at most two categories are ever
    // mid-hand-over at the same time (the depth-sorting mitigation).
    const spacing = CATEGORY_ORDER.length > 1 ? this.stagger / (CATEGORY_ORDER.length - 1) : 1;
    this.windowWidth = Math.min(1, Math.max(0.05, spacing * 1.6));
    this.onEvent = options.onEvent;
    const years = Array.from(this.layers.keys());
    const first = (years[0] ?? 1945) as Year;
    this.from = first;
    this.to = first;
    this.committed = first;
    this.applyImmediate(first);
  }

  /* --------------------------------------------------------- public API --- */

  /** Effective duration of a full transformation, in seconds. */
  get duration(): number {
    return this.activeDuration;
  }

  /** Force the scene into a single era with no animation (boot / deep link). */
  applyImmediate(year: Year): void {
    this.from = year;
    this.to = year;
    this.committed = year;
    this.progress = 1;
    this.active = false;
    this.previewing = false;
    this.previewWeight = 0;
    this.setVisibility(year, null, 1);
    this.resetCategoryTransforms(year);
  }

  /** Begin the animated transformation to `year`. */
  selectYear(year: Year): void {
    if (!this.layers.has(year)) return;
    const dominant = this.dominantYear();
    if (!this.previewing && dominant === year && !this.active) {
      this.from = year;
      this.to = year;
      this.committed = year;
      this.progress = 1;
      this.setVisibility(year, null, 1);
      this.resetCategoryTransforms(year);
      return;
    }
    this.previewing = false;
    this.from = dominant;
    this.to = year;
    this.progress = 0;
    this.active = true;
    this.applyProgress(0);
    this.emit('start', 0);
  }

  /**
   * Continuous scrub preview while the slider handle is dragged. `index` is the
   * fractional slider position (0..4). Nothing is committed here.
   */
  preview(index: number): void {
    const years = Array.from(this.layers.keys());
    const maxIndex = years.length - 1;
    const clamped = Math.min(Math.max(index, 0), maxIndex);
    const lower = Math.floor(clamped);
    const upper = Math.min(lower + 1, maxIndex);
    const weight = clamped - lower;
    const fromYear = years[lower];
    const toYear = years[upper];

    this.previewing = true;
    this.active = false;
    this.from = fromYear;
    this.to = toYear;
    this.previewWeight = weight;
    this.progress = weight;

    for (const year of years) {
      const layer = this.layers.get(year);
      if (!layer) continue;
      layer.group.visible = year === fromYear || year === toYear;
    }
    const fromLayer = this.layers.get(fromYear);
    const toLayer = this.layers.get(toYear);
    if (fromLayer) {
      fromLayer.group.scale.setScalar(1);
      fromLayer.group.position.y = 0;
    }
    if (toLayer) {
      toLayer.group.scale.setScalar(0.965 + 0.035 * weight);
      toLayer.group.position.y = -1.4 * (1 - weight);
    }
    this.emit('preview', weight);
  }

  /** Release the drag at a fractional index: snaps and completes the change. */
  commitPreview(index: number): void {
    const years = Array.from(this.layers.keys());
    const snapped = years[Math.round(Math.min(Math.max(index, 0), years.length - 1))];
    // Continue from whichever era was dominant on screen during the preview so
    // the settle never jumps back to a layer the user has already scrubbed past.
    const onScreen = this.previewWeight >= 0.5 ? this.to : this.from;
    this.previewing = false;
    this.committed = onScreen;
    this.selectYear(snapped);
  }

  /** Advance the transformation. Returns true while still animating. */
  update(dt: number): boolean {
    if (!this.active) return false;
    const step = Math.min(Math.max(dt, 0), 0.25);
    this.progress = clamp01(this.progress + step / this.activeDuration);
    this.applyProgress(this.progress);
    if (this.progress >= 1) {
      this.active = false;
      this.committed = this.to;
      this.emit('complete', 1);
      return false;
    }
    this.emit('progress', this.progress);
    return true;
  }

  /** Observable state, consumed by the HUD, audio and the tests. */
  get state(): TransitionState {
    const weights = zeroWeights();
    for (const year of this.layers.keys()) {
      if (year === this.from) weights[year] = 1 - this.progress;
      else if (year === this.to) weights[year] = this.progress;
      else weights[year] = 0;
    }
    if (this.previewing) {
      const years = Array.from(this.layers.keys());
      for (const year of years) weights[year] = 0;
      weights[this.from] = 1 - this.previewWeight;
      weights[this.to] = this.previewWeight;
    }
    return {
      active: this.active,
      previewing: this.previewing,
      committed: this.committed,
      from: this.from,
      to: this.to,
      progress: this.progress,
      weights,
    };
  }

  /** Era in full control right now (during a change: the incoming one). */
  get target(): Year {
    return this.to;
  }

  /** Era with the largest blend weight. */
  dominantYear(): Year {
    if (!this.active && !this.previewing) return this.committed;
    return this.progress >= 0.5 ? this.to : this.from;
  }

  /** Lerped colour grade at the current progress. */
  get currentGrade(): GradeSpec {
    return lerpGrade(this.eras(this.from).grade, this.eras(this.to).grade, this.progress);
  }

  /** Lerped fog colour + density at the current progress. */
  get currentFog(): { color: THREE.Color; density: number } {
    if (this.progress <= 0) {
      const palette = this.eras(this.from).palette;
      return { color: new THREE.Color(palette.fog), density: palette.fogDensity };
    }
    if (this.progress >= 1) {
      const palette = this.eras(this.to).palette;
      return { color: new THREE.Color(palette.fog), density: palette.fogDensity };
    }
    const a = this.eras(this.from).palette;
    const b = this.eras(this.to).palette;
    return {
      color: new THREE.Color(a.fog).lerp(new THREE.Color(b.fog), this.progress),
      density: lerp(a.fogDensity, b.fogDensity, this.progress),
    };
  }

  /** Lerped sky palette (hex strings) at the current progress. */
  get currentPalette() {
    const a = this.eras(this.from).palette;
    if (this.progress <= 0) return a;
    const b = this.eras(this.to).palette;
    if (this.progress >= 1) return b;
    const t = this.progress;
    const mixHex = (x: string, y: string): string => '#' + new THREE.Color(x).lerp(new THREE.Color(y), t).getHexString();
    return {
      ...b,
      skyTop: mixHex(a.skyTop, b.skyTop),
      skyBottom: mixHex(a.skyBottom, b.skyBottom),
      fog: mixHex(a.fog, b.fog),
      horizon: mixHex(a.horizon, b.horizon),
      sun: mixHex(a.sun, b.sun),
      sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
      fogDensity: lerp(a.fogDensity, b.fogDensity, t),
      ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, t),
      hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, t),
      clarity: lerp(a.clarity, b.clarity, t),
    };
  }

  /** Stagger window for a category, used by the tests and the HUD debug view. */
  categoryBlend(category: SceneCategory): CategoryBlend {
    const index = CATEGORY_ORDER.indexOf(category);
    const total = CATEGORY_ORDER.length;
    const p = this.previewing
      ? // During a drag the whole layer set blends gently and uniformly.
        this.previewWeight
      : this.progress;
    const width = this.previewing ? 1 : this.windowWidth;
    const start = this.previewing ? 0 : (this.stagger * index) / Math.max(1, total - 1);
    const incoming = clamp01((p - start) / Math.max(width, 1e-3));
    return {
      category,
      incoming,
      incomingVisible: incoming > 0.001,
      outgoingVisible: incoming < 0.999,
    };
  }

  /** Which layers are currently visible (never more than two). */
  get visibleYears(): Year[] {
    const out: Year[] = [];
    for (const year of this.layers.keys()) {
      if (this.layers.get(year)?.group.visible) out.push(year);
    }
    return out;
  }

  /* -------------------------------------------------------- internals ---- */

  private get activeDuration(): number {
    return this.reducedMotion ? DEFAULT_REDUCED_DURATION : this.baseDuration;
  }

  private eras(year: Year): EraDefinition {
    return this.layers.get(year)?.definition ?? ERAS[year];
  }

  private emit(type: TransitionEventType, progress: number): void {
    this.onEvent?.({ type, from: this.from, to: this.to, progress });
  }

  /** Apply visibility + per-category transforms for a given progress. */
  private applyProgress(p: number): void {
    this.setVisibility(this.from, this.to, p);
    const fromLayer = this.layers.get(this.from);
    const toLayer = this.layers.get(this.to);
    if (!fromLayer || !toLayer) return;

    for (const category of CATEGORY_ORDER) {
      const blend = this.categoryBlend(category);
      const incomingGroup = toLayer.categories[category];
      const outgoingGroup = fromLayer.categories[category];
      const eased = easeInOut(blend.incoming);

      if (incomingGroup) {
        incomingGroup.visible = blend.incomingVisible;
        incomingGroup.scale.setScalar(0.92 + 0.08 * eased);
        // Rise out of the pavement as it lands.
        incomingGroup.position.set(0, -3.2 * (1 - eased), 0);
      }
      if (outgoingGroup) {
        outgoingGroup.visible = blend.outgoingVisible && this.from !== this.to;
        outgoingGroup.scale.setScalar(1 - 0.05 * eased);
        outgoingGroup.position.set(0, 0, 0);
      }
    }

    if (p >= 1) {
      // Snap the incoming layer to a pristine pose.
      for (const category of CATEGORY_ORDER) {
        const group = toLayer.categories[category];
        if (!group) continue;
        group.visible = true;
        group.scale.setScalar(1);
        group.position.set(0, 0, 0);
      }
      if (this.from !== this.to) fromLayer.group.visible = false;
    }
  }

  private setVisibility(from: Year, to: Year | null, progress: number): void {
    for (const year of this.layers.keys()) {
      const layer = this.layers.get(year);
      if (!layer) continue;
      if (to === null) {
        layer.group.visible = year === from;
        if (layer.group.visible) {
          layer.group.scale.setScalar(1);
          layer.group.position.set(0, 0, 0);
        }
        continue;
      }
      const visible = year === from || year === to;
      layer.group.visible = visible;
      if (visible) {
        layer.group.scale.setScalar(1);
        layer.group.position.set(0, 0, 0);
      }
      if (year === from && progress >= 1) layer.group.visible = false;
    }
  }

  private resetCategoryTransforms(year: Year): void {
    const layer = this.layers.get(year);
    if (!layer) return;
    for (const category of CATEGORY_ORDER) {
      const group = layer.categories[category];
      if (!group) continue;
      group.visible = true;
      group.scale.setScalar(1);
      group.position.set(0, 0, 0);
    }
  }
}

/** Convenience: black used as the signature colour when nothing is visible. */
export const TRANSITION_BLACK = BLACK;
