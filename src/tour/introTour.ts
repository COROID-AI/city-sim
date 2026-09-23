/**
 * Chrono City — cinematic camera choreography for the tour layer.
 *
 * This module owns *where the camera flies* and nothing else: no DOM, no
 * timeline, no audio and no scene systems. Keeping the choreography pure makes
 * it deterministic and unit-testable, while `tourApi.ts` decides *when* it
 * runs and which systems react to it.
 *
 * Three pieces are exported:
 *
 *   * `IntroTour`     — the intro flythrough. An authored keyframe path that
 *                       starts from, and settles back into, the exact frame the
 *                       navigation rig resumes from, so handing control back to
 *                       the user never produces a camera jump.
 *   * `HandoffBlend`  — the reusable "glide home" used whenever the tour stops
 *                       owning the camera: it blends from the pose the tour
 *                       last wrote towards the *live* navigation pose over a
 *                       short eased window, tracking the rig if the user is
 *                       already dragging.
 *   * `tourDriftPose` — the time-tour's slow orbital sway. At `t = 0` it is
 *                       exactly the pose it was handed, so the showcase camera
 *                       can start and stop without a seam.
 *
 * Orbit convention (shared with `NavigationRig` / `MovementController`): a pose
 * is a camera `position` plus the `target` it looks at, in metres in the world
 * frame (+X east, +Z south, +Y up). The camera sits at
 * `target + d * (sin(yaw)cos(pitch), -sin(pitch), cos(yaw)cos(pitch))`; the
 * `readOrbitOffset()` / `orbitPosition()` pair converts to and from that form,
 * which is what lets the drift orbit the block the way the rig does.
 *
 * Lifecycle:
 *   create    → `new IntroTour()`, `defaultIntroKeyframes()`, `new HandoffBlend()`.
 *   consume   → `intro.start(restPose)`, then `intro.advance(deltaMs, livePose)`
 *               once per frame; write `sample.pose` to the camera while
 *               `sample.ownsCamera` is true.
 *   integrate → `TourApi` owns one `IntroTour`, one `HandoffBlend` and the
 *               `SceneContext` tick that feeds them.
 */

import { CELL_HALF_DEPTH, CELL_HALF_WIDTH, SIDEWALK_CENTER_Z } from '../core/blockLayout';
import { clamp01, smoothStep01 } from '../core/eraContracts';

export const INTRO_TOUR_VERSION = 1;

/* ------------------------------------------------------------------------- *
 * Tuning constants
 * ------------------------------------------------------------------------- */

/** Length of the establishing flythrough. Long enough to read, short enough to skip. */
export const DEFAULT_INTRO_DURATION_MS = 11_000;

/**
 * The flythrough eases out of the pose the user will resume from, so the first
 * beat has no seam: the path is blended in over this window.
 */
export const DEFAULT_INTRO_BLEND_IN_MS = 900;

/**
 * How the flythrough leaves the user's frame: pulled back, lifted and angled
 * away from the block. Expressed as deltas from the *live* rest pose, so the
 * entry beat is always centred on whatever framing the rig is actually holding
 * and the camera never has to teleport into the opening shot.
 */
export const ENTRY_YAW_DELTA = -0.16;
export const ENTRY_PITCH_DELTA = -0.14;
export const ENTRY_DISTANCE_SCALE = 1.3;
export const ENTRY_TARGET_LIFT = 2;

/** Glide length when the tour gives the camera back to the navigation rig. */
export const DEFAULT_HANDOFF_MS = 620;

/**
 * Extra glide time per metre of retreat, so a cancel from altitude is a
 * deliberate pull-back onto the user's frame rather than a whip-pan: the tour
 * still yields instantly, it just travels home at a watchable speed.
 */
export const DEFAULT_HANDOFF_PER_METRE_MS = 26;

/** Longest hand-off glide we will ever run, so a far-away cancel still lands. */
export const MAX_HANDOFF_MS = 2800;

/** Period of the time-tour's slow orbital sway. */
export const DEFAULT_DRIFT_PERIOD_MS = 26_000;

/** Sway amplitudes around the base pose (radians for angles, fraction for distance). */
export const DEFAULT_DRIFT_YAW_AMPLITUDE = 0.34;
export const DEFAULT_DRIFT_PITCH_AMPLITUDE = 0.085;
export const DEFAULT_DRIFT_DISTANCE_SWING = 0.06;

/** Metres the showcase camera lifts (and raises its look target) at the sway's peak. */
export const DEFAULT_DRIFT_LIFT = 6.5;
export const DEFAULT_DRIFT_TARGET_LIFT = 2.5;

/* ------------------------------------------------------------------------- *
 * Poses
 * ------------------------------------------------------------------------- */

/** A world-space point in metres. */
export interface TourVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Everything the tour needs in order to place the camera: where it is, what it
 * looks at, and (optionally) the vertical field of view it shoots with.
 */
export interface CameraPose {
  readonly position: TourVec3;
  readonly target: TourVec3;
  /** Vertical field of view in degrees; omitted means "leave the camera's own". */
  readonly fov?: number;
}

/** Polar description of a pose, relative to its look target. */
export interface OrbitOffset {
  /** Heading around the target, radians, measured from +Z (south). */
  readonly yaw: number;
  /** Elevation above the horizon, radians, positive looks up. */
  readonly pitch: number;
  /** Distance from the target, metres. */
  readonly distance: number;
}

/** Creates a frozen world-space point. */
export function vec3(x: number, y: number, z: number): TourVec3 {
  return Object.freeze({ x, y, z });
}

/** Creates a frozen pose, dropping an undefined field of view. */
export function cameraPose(
  position: TourVec3,
  target: TourVec3,
  fov?: number,
): CameraPose {
  return Object.freeze(fov === undefined ? { position, target } : { position, target, fov });
}

/** `true` when two positions (or poses) are within `epsilon` metres / degrees. */
export function posesMatch(left: CameraPose, right: CameraPose, epsilon = 1e-6): boolean {
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= epsilon;
  return (
    close(left.position.x, right.position.x) &&
    close(left.position.y, right.position.y) &&
    close(left.position.z, right.position.z) &&
    close(left.target.x, right.target.x) &&
    close(left.target.y, right.target.y) &&
    close(left.target.z, right.target.z)
  );
}

/** Straight-line distance between two poses' camera positions, in metres. */
export function poseDistance(left: CameraPose, right: CameraPose): number {
  return Math.hypot(
    left.position.x - right.position.x,
    left.position.y - right.position.y,
    left.position.z - right.position.z,
  );
}

/** Linear blend between two poses; the eased weight is the caller's business. */
export function lerpPose(from: CameraPose, to: CameraPose, weight: number): CameraPose {
  const t = clamp01(weight);
  if (t >= 1) return to;
  if (t <= 0) return from;
  const mix = (a: number, b: number): number => a + (b - a) * t;
  const fov =
    from.fov !== undefined && to.fov !== undefined ? mix(from.fov, to.fov) : from.fov;
  return fov === undefined
    ? {
        position: vec3(
          mix(from.position.x, to.position.x),
          mix(from.position.y, to.position.y),
          mix(from.position.z, to.position.z),
        ),
        target: vec3(
          mix(from.target.x, to.target.x),
          mix(from.target.y, to.target.y),
          mix(from.target.z, to.target.z),
        ),
      }
    : {
        position: vec3(
          mix(from.position.x, to.position.x),
          mix(from.position.y, to.position.y),
          mix(from.position.z, to.position.z),
        ),
        target: vec3(
          mix(from.target.x, to.target.x),
          mix(from.target.y, to.target.y),
          mix(from.target.z, to.target.z),
        ),
        fov,
      };
}

/* ------------------------------------------------------------------------- *
 * Orbit maths
 * ------------------------------------------------------------------------- */

/** Splits a pose into the yaw / pitch / distance the navigation rig uses. */
export function readOrbitOffset(pose: CameraPose): OrbitOffset {
  const dx = pose.position.x - pose.target.x;
  const dy = pose.position.y - pose.target.y;
  const dz = pose.position.z - pose.target.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= 1e-6) {
    return { yaw: 0, pitch: 0, distance: 0 };
  }
  return {
    yaw: Math.atan2(dx, dz),
    pitch: Math.asin(Math.max(-1, Math.min(1, -dy / distance))),
    distance,
  };
}

/** Places a camera around `target` using the rig's orbit convention. */
export function orbitPosition(target: TourVec3, offset: OrbitOffset): TourVec3 {
  const cosPitch = Math.cos(offset.pitch);
  return vec3(
    target.x + Math.sin(offset.yaw) * cosPitch * offset.distance,
    target.y - Math.sin(offset.pitch) * offset.distance,
    target.z + Math.cos(offset.yaw) * cosPitch * offset.distance,
  );
}

/* ------------------------------------------------------------------------- *
 * Showcase drift
 * ------------------------------------------------------------------------- */

export interface TourDriftOptions {
  /** Full sway period in milliseconds. Defaults to `DEFAULT_DRIFT_PERIOD_MS`. */
  readonly periodMs?: number;
  /** Yaw sway in radians. Defaults to `DEFAULT_DRIFT_YAW_AMPLITUDE`. */
  readonly yawAmplitude?: number;
  /** Pitch sway in radians. Defaults to `DEFAULT_DRIFT_PITCH_AMPLITUDE`. */
  readonly pitchAmplitude?: number;
  /** Fractional distance swing. Defaults to `DEFAULT_DRIFT_DISTANCE_SWING`. */
  readonly distanceSwing?: number;
  /** Metres of lift at the sway's peak. Defaults to `DEFAULT_DRIFT_LIFT`. */
  readonly lift?: number;
  /** Metres the look target rises at the sway's peak. */
  readonly targetLift?: number;
}

function readNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/**
 * The time-tour camera: a slow orbital sway around `base`, closing the loop
 * every `periodMs`. Both the sway terms and the lift are zero at `t = 0`, so
 * the pose returned for the first frame is exactly `base` — the showcase can
 * begin (and, once the tour ends, the hand-off can begin) without a seam.
 */
export function tourDriftPose(
  elapsedMs: number,
  base: CameraPose,
  options: TourDriftOptions = {},
): CameraPose {
  const periodMs = Math.max(1000, readNumber(options.periodMs, DEFAULT_DRIFT_PERIOD_MS));
  const yawAmplitude = readNumber(options.yawAmplitude, DEFAULT_DRIFT_YAW_AMPLITUDE);
  const pitchAmplitude = readNumber(options.pitchAmplitude, DEFAULT_DRIFT_PITCH_AMPLITUDE);
  const distanceSwing = readNumber(options.distanceSwing, DEFAULT_DRIFT_DISTANCE_SWING);
  const lift = readNumber(options.lift, DEFAULT_DRIFT_LIFT);
  const targetLift = readNumber(options.targetLift, DEFAULT_DRIFT_TARGET_LIFT);

  const phase = ((Number.isFinite(elapsedMs) ? elapsedMs : 0) / periodMs) * Math.PI * 2;
  const sway = Math.sin(phase);
  const breathe = (1 - Math.cos(phase)) / 2;

  if (sway === 0 && breathe === 0) return base;

  const offset = readOrbitOffset(base);
  const target = vec3(base.target.x, base.target.y + targetLift * breathe, base.target.z);
  const position = orbitPosition(target, {
    yaw: offset.yaw + yawAmplitude * sway,
    // A half-frequency term keeps the pitch move from mirroring the yaw move.
    pitch: offset.pitch + pitchAmplitude * Math.sin(phase * 2) * 0.5,
    distance: offset.distance * (1 + distanceSwing * sway),
  });

  const lifted = vec3(position.x, position.y + lift * breathe, position.z);
  return base.fov === undefined
    ? { position: lifted, target }
    : { position: lifted, target, fov: base.fov };
}

/* ------------------------------------------------------------------------- *
 * Hand-off glide
 * ------------------------------------------------------------------------- */

/** Smoother (Perlin) step: zero velocity *and* acceleration at both ends. */
export function smootherStep01(value: number): number {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** One frame of a hand-off glide. */
export interface HandoffSample {
  readonly pose: CameraPose;
  /** Eased `0 → 1` weight of the target pose. */
  readonly progress: number;
  /** `true` on the frame the glide lands (and from then on). */
  readonly done: boolean;
}

function clampDuration(value: number | undefined, fallback: number): number {
  const resolved = value !== undefined && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(MAX_HANDOFF_MS, resolved));
}

/**
 * Glide length for a retreat of `distanceM` metres: a short seam stays snappy
 * (`baseMs`), a long pull-back is given proportionally more time so the camera
 * never whips home, and `MAX_HANDOFF_MS` keeps even an extreme cancel brisk.
 */
export function handoffDurationForDistance(
  distanceM: number,
  options: { baseMs?: number; perMetreMs?: number } = {},
): number {
  const base = clampDuration(options.baseMs, DEFAULT_HANDOFF_MS);
  const perMetre = Math.max(0, readNumber(options.perMetreMs, DEFAULT_HANDOFF_PER_METRE_MS));
  const distance = Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0;
  return clampDuration(base + distance * perMetre, base);
}

/**
 * Blends from a fixed "where the tour left the camera" pose towards a target
 * that is re-read every frame, so a user who is already dragging during the
 * hand-off is followed instead of fought. Once it lands, the blended pose *is*
 * the target pose, which is what makes the seam invisible.
 */
export class HandoffBlend {
  readonly version = INTRO_TOUR_VERSION;

  private readonly baseDuration: number;
  private activeDuration: number;
  private origin: CameraPose | null = null;
  private elapsed = 0;
  private running = false;

  constructor(durationMs: number = DEFAULT_HANDOFF_MS) {
    this.baseDuration = clampDuration(durationMs, DEFAULT_HANDOFF_MS);
    this.activeDuration = this.baseDuration;
  }

  /** Default glide length in milliseconds; `0` lands on the next frame. */
  get durationMs(): number {
    return this.baseDuration;
  }

  /** Length of the glide currently running (or of the next one to start). */
  get activeDurationMs(): number {
    return this.activeDuration;
  }

  /** `true` while the glide still owns the camera. */
  get active(): boolean {
    return this.running;
  }

  /** Eased `0 → 1` progress of the running glide. */
  get progress(): number {
    if (!this.running) return 1;
    return this.activeDuration <= 0 ? 1 : clamp01(this.elapsed / this.activeDuration);
  }

  /**
   * Starts a glide from `origin`, which is normally the pose just written.
   * `durationMs` overrides the default for this glide only — see
   * `handoffDurationForDistance()`.
   */
  begin(origin: CameraPose, durationMs?: number): void {
    this.origin = origin;
    this.activeDuration =
      durationMs === undefined ? this.baseDuration : clampDuration(durationMs, this.baseDuration);
    this.elapsed = 0;
    this.running = true;
  }

  /** Abandons the glide; the camera is left exactly where the caller put it. */
  cancel(): void {
    this.running = false;
    this.origin = null;
    this.elapsed = 0;
    this.activeDuration = this.baseDuration;
  }

  /** Advances the glide and resolves this frame's camera pose. */
  advance(deltaMs: number, target: CameraPose): HandoffSample {
    const origin = this.origin;
    if (!this.running || !origin) return { pose: target, progress: 1, done: true };

    const step = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
    this.elapsed = Math.min(this.activeDuration, this.elapsed + step);
    const progress = this.progress;
    const pose = lerpPose(origin, target, smootherStep01(progress));
    const done = progress >= 1;
    if (done) {
      this.running = false;
      this.origin = null;
      this.activeDuration = this.baseDuration;
    }
    return { pose, progress, done };
  }
}

/* ------------------------------------------------------------------------- *
 * Intro keyframes
 * ------------------------------------------------------------------------- */

/** One authored beat of the flythrough. */
export interface IntroKeyframe extends CameraPose {
  /** Stable id, used in logs and test labels. */
  readonly id: string;
  /** Position along the flythrough, `0 → 1` (strictly increasing; the last is `1`). */
  readonly at: number;
  /** Director's note: what the beat is for. */
  readonly note: string;
}

function keyframe(
  id: string,
  at: number,
  position: TourVec3,
  target: TourVec3,
  fov: number,
  note: string,
): IntroKeyframe {
  return Object.freeze({ id, at, position, target, fov, note });
}

/**
 * The entry beat: the pose the visitor resumes from, pulled back, lifted and
 * angled a little — the camera "leans out" of the user's viewpoint before the
 * authored beats take over. Derived from the live rest pose so the opening shot
 * is always centred on whatever framing the rig actually holds.
 */
export function introEntryPose(restPose: CameraPose, template: IntroKeyframe): IntroKeyframe {
  const offset = readOrbitOffset(restPose);
  const target = vec3(restPose.target.x, restPose.target.y + ENTRY_TARGET_LIFT, restPose.target.z);
  const position = orbitPosition(target, {
    yaw: offset.yaw + ENTRY_YAW_DELTA,
    // Never dip towards the ground or flip over the top of the block.
    pitch: Math.max(-1.35, Math.min(-0.2, offset.pitch + ENTRY_PITCH_DELTA)),
    distance: offset.distance * ENTRY_DISTANCE_SCALE,
  });
  return Object.freeze({
    id: template.id,
    at: template.at,
    position,
    target,
    fov: restPose.fov ?? template.fov,
    note: template.note,
  });
}

/**
 * The authored flythrough: lean out of the user's frame, rise to the wide
 * establishing shot, descend onto the south road, skim the sidewalk past the
 * shopfronts, then lift over the roofline and settle home.
 *
 * Beats are pitched so the camera never travels faster than a real flythrough
 * would: adjacent beats are 20-95 m apart and share ~2 s of the timeline each.
 *
 * The first beat is replaced at `start()` by `introEntryPose()` and the last by
 * the rig's live pose, so the path begins *and* ends on the frame the visitor
 * resumes from — the camera never teleports in or out of the cinematic.
 */
export function defaultIntroKeyframes(): readonly IntroKeyframe[] {
  return Object.freeze([
    keyframe(
      'pull-back',
      0,
      vec3(-15, 87, 95),
      vec3(0, 8, 0),
      52,
      'Opens on the frame the visitor resumes from, pulled back and lifted (replaced at start).',
    ),
    keyframe(
      'establish',
      0.2,
      vec3(CELL_HALF_WIDTH * 1.5, 96, CELL_HALF_DEPTH * 2.9),
      vec3(0, 26, 0),
      44,
      'High establishing shot from the south-east: the whole cell, its road ring and the sky.',
    ),
    keyframe(
      'descend',
      0.42,
      vec3(CELL_HALF_WIDTH * 1.15, 44, CELL_HALF_DEPTH * 2.05),
      vec3(0, 18, -2),
      48,
      'Descending towards the block, the avenues opening up below.',
    ),
    keyframe(
      'street-glide',
      0.58,
      vec3(CELL_HALF_WIDTH * 0.5, 9, CELL_HALF_DEPTH * 1.1),
      vec3(-6, 10, -6),
      54,
      'Street level: skimming the south road, traffic and pedestrians crossing frame.',
    ),
    keyframe(
      'sidewalk',
      0.7,
      vec3(10, 5.2, SIDEWALK_CENTER_Z),
      vec3(-12, 8, -8),
      58,
      'Gliding along the sidewalk, close enough to read the shopfront signage.',
    ),
    keyframe(
      'roof-rise',
      0.88,
      vec3(CELL_HALF_WIDTH * 0.86, 62, CELL_HALF_DEPTH * 1.45),
      vec3(0, 22, -4),
      48,
      'Lifting out over the roofline for the final reveal of the block.',
    ),
    keyframe(
      'hero-return',
      1,
      vec3(0, 56, 82),
      vec3(0, 6, 0),
      55,
      'Settles on the frame the navigation rig resumes from (replaced at start).',
    ),
  ]);
}

/* ------------------------------------------------------------------------- *
 * Path sampling
 * ------------------------------------------------------------------------- */

function keyframeRange(keyframes: readonly IntroKeyframe[]): { first: IntroKeyframe; last: IntroKeyframe } {
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (!first || !last) throw new RangeError('An intro path needs at least one keyframe.');
  return { first, last };
}

/** Index of the keyframe the path is leaving at `progress`. */
export function introKeyframeIndexAt(
  keyframes: readonly IntroKeyframe[],
  progress: number,
): number {
  const p = clamp01(progress);
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const next = keyframes[index + 1] as IntroKeyframe;
    if (p < next.at) return index;
  }
  return Math.max(0, keyframes.length - 1);
}

/**
 * Samples the authored path. Each segment is eased with a smooth (Hermite)
 * curve, so the camera decelerates into every beat and accelerates out of it —
 * a drone settling on its marks rather than a linear interpolator.
 */
export function sampleIntroPose(
  keyframes: readonly IntroKeyframe[],
  progress: number,
): CameraPose {
  const { first, last } = keyframeRange(keyframes);
  const p = clamp01(progress);
  if (keyframes.length === 1 || p <= first.at) return first;
  if (p >= last.at) return last;

  const index = introKeyframeIndexAt(keyframes, p);
  const from = keyframes[index] as IntroKeyframe;
  const to = (keyframes[index + 1] ?? last) as IntroKeyframe;
  const span = to.at - from.at;
  if (span <= 0) return to;
  return lerpPose(from, to, smoothStep01((p - from.at) / span));
}

/* ------------------------------------------------------------------------- *
 * IntroTour
 * ------------------------------------------------------------------------- */

/** Phase of the intro. `flying` and `handoff` both own the camera. */
export type IntroPhase = 'idle' | 'flying' | 'handoff' | 'finished';

/** One frame of intro state. */
export interface IntroSample {
  readonly phase: IntroPhase;
  /** Linear `0 → 1` progress through the flythrough. */
  readonly progress: number;
  readonly keyframeIndex: number;
  readonly keyframe: IntroKeyframe;
  /** Camera pose to write this frame (already blended during the hand-off). */
  readonly pose: CameraPose;
  /** `true` while the tour must keep the camera; `false` once it has let go. */
  readonly ownsCamera: boolean;
  /** `true` from the frame the hand-off lands (and every frame after). */
  readonly finished: boolean;
}

export interface IntroTourOptions {
  /** Path to fly. Defaults to `defaultIntroKeyframes()`. */
  readonly keyframes?: readonly IntroKeyframe[];
  /** Flythrough length in milliseconds. Defaults to `DEFAULT_INTRO_DURATION_MS`. */
  readonly durationMs?: number;
  /** Window over which the path is blended out of the rest pose. */
  readonly blendInMs?: number;
  /** Hand-off glide length in milliseconds. Defaults to `DEFAULT_HANDOFF_MS`. */
  readonly handoffMs?: number;
}

/**
 * The intro flythrough state machine.
 *
 * `start(restPose)` snapshots the pose the user will resume from and rewrites
 * the final keyframe to match it. `advance()` then walks the path, blends into
 * it over `blendInMs`, and — either when the path ends or the moment `cancel()`
 * is called — glides back onto the *live* rest pose with `HandoffBlend`.
 */
export class IntroTour {
  readonly version = INTRO_TOUR_VERSION;

  private readonly authoredKeyframes: readonly IntroKeyframe[];
  private readonly duration: number;
  private readonly blendIn: number;

  private path: readonly IntroKeyframe[];
  private readonly handoff: HandoffBlend;
  private phaseState: IntroPhase = 'idle';
  private elapsed = 0;
  private basePose: CameraPose | null = null;
  private lastPose: CameraPose;

  constructor(options: IntroTourOptions = {}) {
    const authored = options.keyframes ?? defaultIntroKeyframes();
    if (authored.length === 0) throw new RangeError('IntroTour needs at least one keyframe.');
    this.authoredKeyframes = authored;
    this.path = authored;
    this.duration = Math.max(0, readNumber(options.durationMs, DEFAULT_INTRO_DURATION_MS));
    this.blendIn = Math.max(0, Math.min(this.duration, readNumber(options.blendInMs, DEFAULT_INTRO_BLEND_IN_MS)));
    this.handoff = new HandoffBlend(options.handoffMs ?? DEFAULT_HANDOFF_MS);
    this.lastPose = sampleIntroPose(authored, 0);
  }

  /* ---------------- state ---------------- */

  get phase(): IntroPhase {
    return this.phaseState;
  }

  /** `true` while the tour owns the camera. */
  get ownsCamera(): boolean {
    return this.phaseState === 'flying' || this.phaseState === 'handoff';
  }

  /** `true` once the flythrough has landed and the camera is back with the user. */
  get isFinished(): boolean {
    return this.phaseState === 'finished';
  }

  /** `true` between `start()` and the end of the hand-off. */
  get isRunning(): boolean {
    return this.phaseState === 'flying' || this.phaseState === 'handoff';
  }

  get durationMs(): number {
    return this.duration;
  }

  get handoffMs(): number {
    return this.handoff.durationMs;
  }

  /** Linear `0 → 1` progress through the flythrough. */
  get progress(): number {
    if (this.duration <= 0) return this.phaseState === 'idle' ? 0 : 1;
    return clamp01(this.elapsed / this.duration);
  }

  get elapsedMs(): number {
    return this.elapsed;
  }

  /** The path currently being flown (the last keyframe tracks the rest pose). */
  get keyframes(): readonly IntroKeyframe[] {
    return this.path;
  }

  /** The most recent camera pose this tour resolved. */
  get pose(): CameraPose {
    return this.lastPose;
  }

  /* ---------------- lifecycle ---------------- */

  /**
   * Restarts the flythrough from the beginning, landing on `restPose`. The
   * entry beat is derived from `restPose` and the final beat rewritten to match
   * it, so the camera neither teleports into the opening shot nor jumps when the
   * rig takes over at the end.
   */
  start(restPose: CameraPose): void {
    const authored = this.authoredKeyframes;
    const lastIndex = authored.length - 1;
    const restFov = restPose.fov;
    this.path = authored.map((frame, index) => {
      if (index === 0) return introEntryPose(restPose, frame);
      if (index === lastIndex) {
        return Object.freeze({
          ...frame,
          position: vec3(restPose.position.x, restPose.position.y, restPose.position.z),
          target: vec3(restPose.target.x, restPose.target.y, restPose.target.z),
          ...(restFov === undefined ? { fov: frame.fov } : { fov: restFov }),
        });
      }
      return frame;
    });
    this.basePose = cameraPose(
      vec3(restPose.position.x, restPose.position.y, restPose.position.z),
      vec3(restPose.target.x, restPose.target.y, restPose.target.z),
      restFov,
    );
    this.elapsed = 0;
    this.phaseState = 'flying';
    this.handoff.cancel();
    this.lastPose = this.compose(0);
  }

  /** Abandons the flythrough and starts the glide home from the current frame. */
  cancel(): void {
    if (this.phaseState !== 'flying') return;
    this.beginHandoff(this.lastPose);
  }

  /** Jumps to the last beat and glides home from there. */
  skipToEnd(): void {
    if (this.phaseState !== 'flying') return;
    this.elapsed = this.duration;
    this.beginHandoff(this.compose(1));
  }

  /** Returns the tour to its idle state without touching the camera. */
  reset(): void {
    this.handoff.cancel();
    this.phaseState = 'idle';
    this.elapsed = 0;
    this.basePose = null;
    this.path = this.authoredKeyframes;
    this.lastPose = sampleIntroPose(this.authoredKeyframes, 0);
  }

  /**
   * Advances one frame. `livePose` is where the user's navigation would put the
   * camera right now, which is what the hand-off glides onto.
   */
  advance(deltaMs: number, livePose: CameraPose): IntroSample {
    const step = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;

    if (this.phaseState === 'flying') {
      this.elapsed = Math.min(this.duration, this.elapsed + step);
      const progress = this.progress;
      const pose = this.compose(progress);
      this.lastPose = pose;
      if (progress >= 1) this.beginHandoff(pose);
    } else if (this.phaseState === 'handoff') {
      const result = this.handoff.advance(step, livePose);
      this.lastPose = result.pose;
      if (result.done) this.phaseState = 'finished';
    }

    return this.sampleState();
  }

  /** Camera pose on the path at `progress` (0 = rest pose, 1 = final beat). */
  sample(progress: number): CameraPose {
    return this.compose(clamp01(progress));
  }

  /* ---------------- internals ---------------- */

  private beginHandoff(origin: CameraPose): void {
    this.phaseState = 'handoff';
    // A zero-length glide still records its origin, so the first hand-off frame
    // simply lands on the live pose. Otherwise the glide is sized to the
    // distance it has to cover, so a cancel from altitude pulls back gracefully.
    const distance = this.basePose ? poseDistance(origin, this.basePose) : 0;
    this.handoff.begin(origin, handoffDurationForDistance(distance, { baseMs: this.handoff.durationMs }));
  }

  /**
   * The authored path, blended out of the rest pose over `blendInMs`. At
   * `progress === 0` the result is exactly the rest pose — that is the whole
   * trick behind "no camera jump when the intro starts".
   */
  private compose(progress: number): CameraPose {
    const path = sampleIntroPose(this.path, progress);
    const base = this.basePose;
    if (!base || this.blendIn <= 0 || this.duration <= 0) return path;
    const weight = smoothStep01(progress / (this.blendIn / this.duration));
    return weight >= 1 ? path : lerpPose(base, path, weight);
  }

  private sampleState(): IntroSample {
    const progress = this.progress;
    const index = introKeyframeIndexAt(this.path, progress);
    const keyframe = (this.path[index] ?? this.path[this.path.length - 1]) as IntroKeyframe;
    return {
      phase: this.phaseState,
      progress,
      keyframeIndex: index,
      keyframe,
      pose: this.lastPose,
      ownsCamera: this.ownsCamera,
      finished: this.phaseState === 'finished',
    };
  }
}

/** Creates an intro flythrough (`create` half of the lifecycle). */
export function createIntroTour(options: IntroTourOptions = {}): IntroTour {
  return new IntroTour(options);
}
