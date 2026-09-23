/**
 * Chrono City — pedestrian crowd and street life.
 *
 * The crowd simulates everyone walking the block: they follow the sidewalk ring
 * the `BlockLayout` defines, queue behind each other, cross the road on the
 * shared crosswalk anchors, pause at the storefront band to window-shop, stop to
 * talk, and fire footsteps and crowd murmur through the `AudioDirector` from
 * their own positions.
 *
 * Everything spatial derives from `src/core/blockLayout.ts` — the sidewalk ring,
 * the crosswalk anchors, the block footprint — so the crowd can never drift from
 * the geometry the streetscape builds. There are no private layout constants.
 *
 * Responsibilities:
 *   create    → `new CrowdSystem()` / `createCrowdSystem()` builds the group, the
 *               pooled figures and one scripted street-life itinerary per person.
 *   consume   → `tick()` runs from the shared `SceneContext` tick registry;
 *               `setEra()` / `updateEraTransition()` implement `EraBlendable` so
 *               the `TimelineRuntime` crossfades every wardrobe; `attachAudio()`
 *               registers the murmur cue and its positional emitters.
 *   integrate → `pedestriansApi` owns the wiring and publishes the handle.
 *
 * Animation budget:
 *   - `maxFigures` caps simultaneous articulated figures (default 24);
 *   - every pose is pure trig over a pooled per-pedestrian phase, so a frame
 *     allocates nothing;
 *   - `MAX_TICK_SECONDS` clamps the step after a tab switch, so a long pause can
 *     never teleport the crowd across the block.
 */

import * as THREE from 'three';

import {
  BLOCK_HALF_DEPTH,
  BLOCK_HALF_WIDTH,
  BlockLayout,
  SIDEWALK_WIDTH,
  type CrosswalkAnchor,
  type Vec2,
} from '../../core/blockLayout';
import {
  DEFAULT_ERA,
  assertEraId,
  clamp01,
  type EraBlendable,
  type EraId,
  type EraTransitionInfo,
  type EraTransitionOptions,
} from '../../core/eraContracts';
import type { FrameInfo, RandomSource, SceneContext, SystemRegistration } from '../../core/sceneContext';
import {
  FOOTSTEP_CUE,
  clamp,
  connectSeries,
  createNoiseBuffer,
  startVoice,
  type CueDefinition,
} from '../../audio/sfxSynth';
import type { AudioDirector } from '../../audio/audioDirector';
import type { MaterialLibrary } from '../../materials/materialLibrary';
import {
  DEFAULT_FIGURE_CAPACITY,
  FigurePool,
  createPedestrianFigure,
  type FigurePoolRandom,
  type FigurePoseKind,
  type PedestrianFigure,
} from './figureFactory';
import {
  OUTFITS,
  blendOutfits,
  outfitFor,
  type BlendedOutfit,
  type EraOutfit,
} from './outfits';

export const CROWD_VERSION = 1;

/** Group every figure is parented to. */
export const CROWD_GROUP_NAME = 'chrono-pedestrian-crowd';

/** Tick-system id the crowd registers on the `SceneContext`. */
export const CROWD_SYSTEM_ID = 'chrono-pedestrian-crowd';

/**
 * Runs after the timeline (`-1000`) so a frame's era progress is already
 * applied, and well before audio (`90`) so emitters read fresh positions.
 */
export const CROWD_SYSTEM_ORDER = 20;

/** Default crowd size: one person every ~17 m of the 272 m sidewalk loop. */
export const DEFAULT_CROWD_COUNT = 16;

/** Hard cap on simultaneous articulated figures. */
export const DEFAULT_MAX_FIGURES = DEFAULT_FIGURE_CAPACITY;

/** Closest two pedestrians may stand, centre to centre, in metres. */
export const DEFAULT_MIN_SEPARATION = 0.62;

/** Relaxation passes per frame for the separation solver. */
export const SEPARATION_ITERATIONS = 3;

/** Keeps bodies off the sidewalk edge and out of the storefront glass. */
export const PEDESTRIAN_EDGE_MARGIN = 0.3;

/** How far a window-shopper steps in towards the storefront band. */
export const WINDOW_SHOPPING_INSET = SIDEWALK_WIDTH / 2 - PEDESTRIAN_EDGE_MARGIN;

/** Seconds a window-shopper takes to step in and back out again. */
export const WINDOW_SHOPPING_BLEND_SECONDS = 0.9;

export const DEFAULT_WALK_SPEED = 1.25;
export const WALK_SPEED_SPREAD = 0.22;
/** Crossing the road is a touch brisker than strolling the pavement. */
export const CROSSING_SPEED = 1.45;
/** Metres per single footstep; two steps make one animation cycle. */
export const STRIDE_LENGTH = 0.72;
export const STRIDE_CYCLE_LENGTH = STRIDE_LENGTH * 2;
/** How close (ahead) a walker must be to a kerb before stepping off it. */
export const CROSSWALK_TRIGGER_DISTANCE = 1.5;
/** Pause at the far kerb before walking back. */
export const CROSSING_KERB_DWELL_SECONDS = 0.8;
/** Longest simulated step; guards against a tab-switch teleport. */
export const MAX_TICK_SECONDS = 0.1;
/** Car-following: look-ahead distance and the gap a walker keeps. */
export const FOLLOW_LOOKAHEAD = 2.4;
export const FOLLOWING_GAP = 0.95;
/** Range within which one pedestrian may strike up a conversation. */
export const TALK_PARTNER_RANGE = 9;
/** Minimum time a pedestrian dragged into a conversation stays there. */
export const TALK_PARTNER_MIN_SECONDS = 4;

/* ------------------------------------------------------------------------- *
 * Crowd audio
 * ------------------------------------------------------------------------- */

/** Synthesized crowd murmur/street-chatter cue registered on the director. */
export const CROWD_MURMUR_CUE = 'crowd-murmur';

/** Loop length of the murmur bed in seconds. */
export const CROWD_MURMUR_LOOP_SECONDS = 3.6;

/** Id prefix of the looping murmur emitters that ride with the pedestrians. */
export const CROWD_MURMUR_EMITTER_PREFIX = 'chrono-pedestrian-murmur';

/** Number of pedestrians that carry a continuous murmur emitter. */
export const DEFAULT_MURMUR_EMITTERS = 4;

export const MURMUR_EMITTER_GAIN = 0.45;
/** Height above the pavement the murmur emitters sit at (roughly head height). */
export const MURMUR_EMITTER_HEIGHT = 1.5;
export const MURMUR_BURST_GAIN = 0.5;
export const MURMUR_BURST_MIN_SECONDS = 1.6;
export const MURMUR_BURST_SPREAD_SECONDS = 0.35;

/** Footstep voice gain before distance rolloff. */
export const FOOTSTEP_GAIN = 0.4;

/**
 * The audio surface the crowd drives. Structurally identical to the subset of
 * `AudioDirector` it needs, so the real director can be passed straight in
 * (and a test double only has to implement what the crowd actually calls).
 */
export type PedestrianAudioHost = Pick<
  AudioDirector,
  | 'isUnlocked'
  | 'play'
  | 'registerEmitter'
  | 'unregisterEmitter'
  | 'registerCue'
  | 'registerCueAlias'
  | 'hasCue'
>;

/**
 * Crowd murmur: a band-passed noise bed with a slow swell, looped under the
 * block and optionally rendered as a short one-shot "burst" for a pair of
 * pedestrians mid-conversation (`play(..., { loop: false })`).
 *
 * Built from the shared `sfxSynth` primitives, so it is deterministic for a
 * given seed and uses the same node graph the traffic bed does.
 */
export function createCrowdMurmurCue(): CueDefinition {
  return {
    name: CROWD_MURMUR_CUE,
    bus: 'ambience',
    duration: CROWD_MURMUR_LOOP_SECONDS,
    loop: true,
    positional: true,
    tags: ['crowd', 'pedestrian', 'murmur', 'voice'],
    render({ context, output, time, gain, rate, seed, loop }) {
      const energy = clamp(rate, 0.5, 2);

      const noise = context.createBufferSource();
      noise.buffer = createNoiseBuffer(context, { seconds: CROWD_MURMUR_LOOP_SECONDS, seed });
      noise.loop = true;
      noise.playbackRate.value = 0.92 * energy;

      // Voice band: the range speech carries in, with a high-pass so the bed
      // never rumbles into the traffic layer.
      const air = context.createBiquadFilter();
      air.type = 'highpass';
      air.frequency.value = 220 * energy;

      const voices = context.createBiquadFilter();
      voices.type = 'bandpass';
      voices.frequency.value = 480 * energy;
      voices.Q.value = 1.1;

      const body = context.createGain();
      body.gain.value = 0.3 * gain;

      // Slow swell keeps the loop from reading as static.
      const motion = context.createOscillator();
      motion.type = 'sine';
      motion.frequency.value = 0.19;
      const motionDepth = context.createGain();
      motionDepth.gain.value = 0.11 * gain;
      connectSeries([motion, motionDepth, body.gain]);

      connectSeries([noise, air, voices, body, output]);

      return startVoice({
        nodes: [noise, air, voices, body, motion, motionDepth],
        sources: [noise, motion],
        start: time,
        ...(loop ? {} : { stopAt: time + 1.4 }),
      });
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Layout helpers — everything derives from `BlockLayout`
 * ------------------------------------------------------------------------- */

/** Length of the closed sidewalk loop in metres. */
export const SIDEWALK_LOOP_METRES = BlockLayout.sidewalkLoopLength;

/** Wraps a metre offset into `[0, length)`. */
export function wrapMetres(value: number, length = SIDEWALK_LOOP_METRES): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % length) + length) % length;
}

/** Distance from a point to the block footprint (`0` when inside it). */
export function distanceFromBlock(point: Vec2): number {
  const dx = Math.max(0, Math.abs(point.x) - BLOCK_HALF_WIDTH);
  const dz = Math.max(0, Math.abs(point.z) - BLOCK_HALF_DEPTH);
  return Math.hypot(dx, dz);
}

/** Direction from a sidewalk point towards the block (the inward normal). */
export function inwardNormal(point: Vec2): Vec2 {
  const targetX = clamp(point.x, -BLOCK_HALF_WIDTH, BLOCK_HALF_WIDTH);
  const targetZ = clamp(point.z, -BLOCK_HALF_DEPTH, BLOCK_HALF_DEPTH);
  const dx = targetX - point.x;
  const dz = targetZ - point.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return { x: 0, z: 0 };
  return { x: dx / length, z: dz / length };
}

/**
 * Pushes a point back onto the sidewalk band and out of the block footprint.
 * This is the guard that keeps every pedestrian on the pavement the
 * `BlockLayout` describes — including while the separation solver nudges them.
 */
export function clampToSidewalkBand(point: Vec2, margin = PEDESTRIAN_EDGE_MARGIN): Vec2 {
  const outerX = BlockLayout.sidewalk.outerX - margin;
  const outerZ = BlockLayout.sidewalk.outerZ - margin;
  const innerX = BlockLayout.sidewalk.innerX + margin;
  const innerZ = BlockLayout.sidewalk.innerZ + margin;

  let x = clamp(point.x, -outerX, outerX);
  let z = clamp(point.z, -outerZ, outerZ);

  if (Math.abs(x) < innerX && Math.abs(z) < innerZ) {
    const pushX = innerX - Math.abs(x);
    const pushZ = innerZ - Math.abs(z);
    if (pushX <= pushZ) x = Math.sign(x || 1) * innerX;
    else z = Math.sign(z || 1) * innerZ;
  }

  return { x, z };
}

/** Loop parameter (metres from the loop start) closest to a world point. */
export function loopParamAt(point: Vec2): number {
  const loop = BlockLayout.sidewalkLoop;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestParam = 0;
  let travelled = 0;

  for (let index = 0; index < loop.length; index += 1) {
    const from = loop[index];
    const to = loop[(index + 1) % loop.length];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length === 0) continue;
    const ratio = clamp01(((point.x - from.x) * dx + (point.z - from.z) * dz) / (length * length));
    const projectedX = from.x + dx * ratio;
    const projectedZ = from.z + dz * ratio;
    const distance = Math.hypot(point.x - projectedX, point.z - projectedZ);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestParam = travelled + ratio * length;
    }
    travelled += length;
  }

  return bestParam;
}

/** A crosswalk anchor plus where it meets the sidewalk loop. */
export interface CrosswalkStop {
  readonly anchor: CrosswalkAnchor;
  readonly loopParam: number;
}

/** Every crosswalk, indexed by where a pedestrian steps off the pavement. */
export const CROSSWALK_STOPS: readonly CrosswalkStop[] = Object.freeze(
  BlockLayout.crosswalks.map((anchor) => Object.freeze({ anchor, loopParam: loopParamAt(anchor.near) })),
);

/** A point `progress` of the way across a crossing, offset across the band. */
export function crosswalkPoint(anchor: CrosswalkAnchor, progress: number, lateral = 0): Vec2 {
  const t = clamp01(progress);
  const x = anchor.near.x + (anchor.far.x - anchor.near.x) * t;
  const z = anchor.near.z + (anchor.far.z - anchor.near.z) * t;
  const halfWidth = anchor.width / 2 - PEDESTRIAN_EDGE_MARGIN;
  const offset = clamp(lateral, -halfWidth, halfWidth);
  return anchor.axis === 'x' ? { x, z: z + offset } : { x: x + offset, z };
}

/** Keeps a point inside one crossing's zebra band. */
export function clampToCrosswalk(
  point: Vec2,
  anchor: CrosswalkAnchor,
  margin = PEDESTRIAN_EDGE_MARGIN,
): Vec2 {
  const halfWidth = anchor.width / 2 - margin;
  if (anchor.axis === 'x') {
    return {
      x: clamp(point.x, Math.min(anchor.near.x, anchor.far.x), Math.max(anchor.near.x, anchor.far.x)),
      z: clamp(point.z, anchor.center.z - halfWidth, anchor.center.z + halfWidth),
    };
  }
  return {
    x: clamp(point.x, anchor.center.x - halfWidth, anchor.center.x + halfWidth),
    z: clamp(point.z, Math.min(anchor.near.z, anchor.far.z), Math.max(anchor.near.z, anchor.far.z)),
  };
}

/** Unit tangent of the sidewalk loop at `s`, pointing the way of travel. */
export function loopTangent(s: number, direction: 1 | -1): Vec2 {
  const step = 0.4;
  const ahead = BlockLayout.pointOnSidewalkLoop((s + step) / SIDEWALK_LOOP_METRES);
  const behind = BlockLayout.pointOnSidewalkLoop((s - step) / SIDEWALK_LOOP_METRES);
  const dx = (ahead.x - behind.x) * direction;
  const dz = (ahead.z - behind.z) * direction;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

/** Y rotation that makes a figure's local +Z point along `direction`. */
export function yawFromDirection(direction: Vec2): number {
  return Math.atan2(direction.x, direction.z);
}

/* ------------------------------------------------------------------------- *
 * States and itineraries
 * ------------------------------------------------------------------------- */

/** Everything a pedestrian can be doing. */
export const PEDESTRIAN_STATES = [
  'walking',
  'idle',
  'talking',
  'crossing',
  'window-shopping',
] as const;

export type PedestrianState = (typeof PEDESTRIAN_STATES)[number];

/** Read-only view of one pedestrian for tests, HUD systems and harnesses. */
export interface PedestrianSnapshot {
  readonly id: string;
  readonly index: number;
  readonly figureId: string;
  readonly state: PedestrianState;
  readonly position: Vec2;
  readonly yaw: number;
  readonly direction: 1 | -1;
  readonly lateral: number;
  readonly speed: number;
  readonly distanceAlongLoop: number;
  readonly animationPhase: number;
  readonly outfitEra: EraId;
  /** Anchor id while crossing, otherwise `null`. */
  readonly crossingAnchorId: string | null;
  /** `1` when fully stepped in to the storefront glass, `0` when on the path. */
  readonly windowShopping: number;
}

/** One entry in a pedestrian's street-life itinerary. */
export interface PedestrianBeat {
  readonly activity: PedestrianState;
  readonly duration: number;
}

/** Seconds range for each activity; `crossing` is driven by the geometry. */
const BEAT_DURATIONS: Readonly<Record<PedestrianState, readonly [number, number]>> = Object.freeze({
  walking: [4, 9],
  idle: [3.5, 6.5],
  talking: [5, 9],
  'window-shopping': [5.5, 9.5],
  crossing: [0, 0],
});

/** The four activities that alternate with walking. */
const SPECIAL_ACTIVITIES: readonly PedestrianState[] = Object.freeze([
  'window-shopping',
  'crossing',
  'talking',
  'idle',
]);

function beatDuration(activity: PedestrianState, random: RandomSource): number {
  const [min, max] = BEAT_DURATIONS[activity];
  if (max <= min) return min;
  return random.float(min, max);
}

/**
 * Builds a repeating scripted itinerary: walking beats separated by
 * window-shopping, crossings, conversations and idle pauses.
 *
 * The *first* special beat is handed out round-robin (`index % 4`), which
 * guarantees that a block populated with a handful of pedestrians shows every
 * street-life behaviour early instead of waiting on a random draw.
 */
export function buildItinerary(random: RandomSource, index: number): readonly PedestrianBeat[] {
  const shuffled = random.shuffle(SPECIAL_ACTIVITIES);
  const first = SPECIAL_ACTIVITIES[index % SPECIAL_ACTIVITIES.length];
  const order = [first, ...shuffled.filter((activity) => activity !== first)];
  const beats: PedestrianBeat[] = [];

  order.forEach((activity, position) => {
    const walkSeconds = position === 0 ? random.float(2.5, 5) : random.float(4, 9);
    beats.push(Object.freeze({ activity: 'walking', duration: walkSeconds }));
    beats.push(Object.freeze({ activity, duration: beatDuration(activity, random) }));
  });
  beats.push(Object.freeze({ activity: 'walking', duration: random.float(6, 11) }));

  return Object.freeze(beats);
}

interface CrossingRun {
  readonly anchor: CrosswalkAnchor;
  progress: number;
  leg: 'out' | 'dwell' | 'back';
  dwell: number;
}

/** One simulated person: itinerary, placement, wardrobe and animation phase. */
class CrowdPedestrian {
  readonly index: number;
  readonly id: string;
  readonly figure: PedestrianFigure;
  readonly variant: number;
  readonly direction: 1 | -1;
  readonly lateral: number;
  readonly baseSpeed: number;
  readonly itinerary: readonly PedestrianBeat[];

  s: number;
  state: PedestrianState = 'walking';
  stateTimer: number;
  stateDuration: number;
  beatIndex = 0;
  position: Vec2 = { x: 0, z: 0 };
  yaw = 0;
  speed: number;
  speedFactor = 1;
  animationPhase = 0;
  stepMarker = -1;
  windowBlend = 0;
  pendingCrossing = false;
  crossing: CrossingRun | null = null;
  talkPartner: string | null = null;
  murmurTimer: number;

  constructor(options: {
    index: number;
    id: string;
    figure: PedestrianFigure;
    s: number;
    direction: 1 | -1;
    lateral: number;
    baseSpeed: number;
    itinerary: readonly PedestrianBeat[];
    murmurTimer: number;
  }) {
    this.index = options.index;
    this.id = options.id;
    this.figure = options.figure;
    this.variant = options.figure.variant;
    this.s = options.s;
    this.direction = options.direction;
    this.lateral = options.lateral;
    this.baseSpeed = options.baseSpeed;
    this.speed = options.baseSpeed;
    this.itinerary = options.itinerary;
    this.stateTimer = options.itinerary[0]?.duration ?? 4;
    this.stateDuration = this.stateTimer;
    this.murmurTimer = options.murmurTimer;
  }

  /** Immutable snapshot handed to HUD/tests/audio. */
  snapshot(outfitEra: EraId): PedestrianSnapshot {
    return Object.freeze({
      id: this.id,
      index: this.index,
      figureId: this.figure.id,
      state: this.state,
      position: Object.freeze({ x: this.position.x, z: this.position.z }),
      yaw: this.yaw,
      direction: this.direction,
      lateral: this.lateral,
      speed: this.speed,
      distanceAlongLoop: this.s,
      animationPhase: this.animationPhase,
      outfitEra,
      crossingAnchorId: this.crossing ? this.crossing.anchor.id : null,
      windowShopping: this.windowBlend,
    });
  }
}

/* ------------------------------------------------------------------------- *
 * Crowd system
 * ------------------------------------------------------------------------- */

export interface CrowdSystemOptions {
  /** Shared scene context: tick registry and deterministic RNG. */
  readonly scene: SceneContext;
  /** Borrow a figure pool instead of creating one. */
  readonly pool?: FigurePool;
  /** Material source for a pool this system creates. */
  readonly library?: MaterialLibrary | null;
  /** Object the crowd group is parented to. Defaults to `scene.scene`. */
  readonly parent?: THREE.Object3D | null;
  /** Audio host; footsteps and murmur are silent until one is attached. */
  readonly audio?: PedestrianAudioHost | null;
  /** Number of pedestrians. Defaults to `DEFAULT_CROWD_COUNT`, capped by capacity. */
  readonly count?: number;
  /** Cap on simultaneous articulated figures. */
  readonly maxFigures?: number;
  readonly minSeparation?: number;
  /** Continuous murmur emitters riding with pedestrians. */
  readonly murmurEmitters?: number;
  readonly initialEra?: EraId;
  /** Register the tick on the `SceneContext`. Defaults to `true`. */
  readonly autoRegister?: boolean;
}

/**
 * Simulated street life. Owns the figures, the state machine, the era wardrobe
 * morph and the pedestrian audio, and ticks from the shared `SceneContext`.
 */
export class CrowdSystem implements EraBlendable {
  readonly version = CROWD_VERSION;
  readonly id = CROWD_SYSTEM_ID;
  readonly group: THREE.Group;
  readonly pool: FigurePool;
  readonly minSeparation: number;

  private readonly scene: SceneContext;
  private readonly random: RandomSource;
  private readonly pedestrians: CrowdPedestrian[] = [];
  private readonly registration: SystemRegistration | null;
  private readonly ownsPool: boolean;
  private readonly murmurEmitterCount: number;
  private readonly audioEmitterIds: string[] = [];
  private readonly murmurAnchors: THREE.Object3D[] = [];

  private audioHost: PedestrianAudioHost | null = null;
  private audioSeed = 1;
  private eraState: EraId;
  private eraFromState: EraId;
  private eraToState: EraId;
  private blendState = 1;
  private morph: BlendedOutfit;
  private elapsedState = 0;
  private tickCountState = 0;
  private disposedState = false;

  constructor(options: CrowdSystemOptions) {
    if (!options || !options.scene) {
      throw new TypeError('CrowdSystem needs a SceneContext.');
    }

    this.scene = options.scene;
    this.random = options.scene.random.fork('pedestrians');
    this.minSeparation = options.minSeparation ?? DEFAULT_MIN_SEPARATION;
    this.murmurEmitterCount = Math.max(0, Math.floor(options.murmurEmitters ?? DEFAULT_MURMUR_EMITTERS));

    this.group = new THREE.Group();
    this.group.name = CROWD_GROUP_NAME;
    this.group.userData.chronoSystem = CROWD_SYSTEM_ID;
    (options.parent ?? options.scene.scene).add(this.group);

    const capacity = options.maxFigures ?? DEFAULT_MAX_FIGURES;
    this.ownsPool = options.pool === undefined;
    this.pool =
      options.pool ??
      new FigurePool({
        library: options.library ?? null,
        capacity,
        random: this.random.fork('figures') as unknown as FigurePoolRandom,
        parent: this.group,
      });

    const count = Math.max(1, Math.min(Math.floor(options.count ?? DEFAULT_CROWD_COUNT), this.pool.capacity));
    for (let index = 0; index < count; index += 1) {
      this.pedestrians.push(this.createPedestrian(index, count));
    }

    this.eraState = options.initialEra ?? DEFAULT_ERA;
    this.eraFromState = this.eraState;
    this.eraToState = this.eraState;
    this.morph = blendOutfits(outfitFor(this.eraState), outfitFor(this.eraState), 1);
    this.applyOutfitBlend();

    this.registration =
      (options.autoRegister ?? true)
        ? this.scene.registerSystem(
            CROWD_SYSTEM_ID,
            (context: SceneContext, frame: FrameInfo) => this.tick(context, frame),
            { order: CROWD_SYSTEM_ORDER },
          )
        : null;

    if (options.audio) this.attachAudio(options.audio);
  }

  /* ---------------- state ---------------- */

  /** Era the crowd is heading to (the timeline's current selection). */
  get era(): EraId {
    return this.eraState;
  }

  /** Era the wardrobe currently reads as; swaps at the tween midpoint. */
  get outfitEra(): EraId {
    return this.morph.era;
  }

  /** Eased tween progress in `[0, 1]`. */
  get outfitBlend(): number {
    return this.blendState;
  }

  /** Current morph, including the crossfaded garment colours. */
  get outfitMorph(): BlendedOutfit {
    return this.morph;
  }

  get count(): number {
    return this.pedestrians.length;
  }

  /** Seconds simulated so far. */
  get elapsed(): number {
    return this.elapsedState;
  }

  get tickCount(): number {
    return this.tickCountState;
  }

  /** Tick registration, or `null` when the crowd runs unregistered. */
  get systemRegistration(): SystemRegistration | null {
    return this.registration;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** Immutable snapshots of every pedestrian, in creation order. */
  get snapshots(): readonly PedestrianSnapshot[] {
    return this.pedestrians.map((pedestrian) => pedestrian.snapshot(this.morph.era));
  }

  /** How many pedestrians are doing each activity right now. */
  get stateCounts(): Readonly<Record<PedestrianState, number>> {
    const counts: Record<PedestrianState, number> = {
      walking: 0,
      idle: 0,
      talking: 0,
      crossing: 0,
      'window-shopping': 0,
    };
    for (const pedestrian of this.pedestrians) counts[pedestrian.state] += 1;
    return counts;
  }

  /** Sims one pedestrian by id (tests and harnesses). */
  pedestrian(id: string): PedestrianSnapshot | null {
    const found = this.pedestrians.find((pedestrian) => pedestrian.id === id);
    return found ? found.snapshot(this.morph.era) : null;
  }

  /* ---------------- era blending ---------------- */

  /** `EraBlendable`: starts (or snaps) a wardrobe change. */
  setEra(era: EraId, options: EraTransitionOptions = {}): void {
    const next = assertEraId(era);
    const durationMs = options.durationMs ?? 1200;
    const immediate = options.immediate === true || durationMs <= 0;

    this.eraState = next;
    this.eraFromState = next;
    this.eraToState = next;
    this.blendState = immediate ? 1 : 0;
    this.applyOutfitBlend();
  }

  /**
   * `EraBlendable`: one tween frame. Garment colours crossfade the whole way and
   * the discrete silhouette pieces swap at the midpoint, so a settled crowd is
   * pixel-identical to its era's authored outfit.
   */
  updateEraTransition(progress: number, transition: EraTransitionInfo): void {
    if (this.disposedState) return;
    const t = clamp01(progress);
    this.eraFromState = transition.from;
    this.eraToState = transition.to;
    this.blendState = t;
    if (!transition.active || t >= 1) {
      this.eraState = transition.to;
      this.eraFromState = transition.to;
      this.blendState = 1;
    }
    this.applyOutfitBlend();
  }

  private applyOutfitBlend(): void {
    const from: EraOutfit = outfitFor(this.eraFromState);
    const to: EraOutfit = outfitFor(this.eraToState);
    this.morph = blendOutfits(from, to, this.blendState);
    for (const pedestrian of this.pedestrians) {
      pedestrian.figure.applyOutfitBlend(this.morph);
    }
  }

  /* ---------------- audio ---------------- */

  /**
   * Registers the crowd murmur cue (once) and binds a looping murmur emitter to
   * the first few pedestrians, so the bed moves with the crowd instead of
   * sitting at a fixed point. Footsteps are one-shot voices fired per step.
   */
  attachAudio(audio: PedestrianAudioHost): void {
    this.detachAudio();
    this.audioHost = audio;

    if (!audio.hasCue(CROWD_MURMUR_CUE)) audio.registerCue(createCrowdMurmurCue());
    if (typeof audio.registerCueAlias === 'function') {
      audio.registerCueAlias('murmur', CROWD_MURMUR_CUE);
      audio.registerCueAlias('chatter', CROWD_MURMUR_CUE);
    }

    const anchors = Math.min(this.murmurEmitterCount, this.pedestrians.length);
    for (let index = 0; index < anchors; index += 1) {
      const pedestrian = this.pedestrians[index];
      const id = `${CROWD_MURMUR_EMITTER_PREFIX}-${index}`;
      // A head-height anchor parented to the figure: the emitter then tracks
      // the pedestrian (and their pace) instead of sitting at a fixed point.
      const anchor = new THREE.Object3D();
      anchor.name = `${CROWD_MURMUR_EMITTER_PREFIX}-anchor-${index}`;
      anchor.position.set(0, MURMUR_EMITTER_HEIGHT, 0);
      pedestrian.figure.root.add(anchor);
      this.murmurAnchors.push(anchor);

      audio.unregisterEmitter(id);
      audio.registerEmitter({
        id,
        cue: CROWD_MURMUR_CUE,
        bus: 'ambience',
        position: { x: pedestrian.position.x, y: MURMUR_EMITTER_HEIGHT, z: pedestrian.position.z },
        object: anchor,
        gain: MURMUR_EMITTER_GAIN,
        rate: 0.9 + index * 0.05,
        refDistance: 7,
        maxDistance: 70,
        autoStart: true,
      });
      this.audioEmitterIds.push(id);
    }
  }

  /** Removes every emitter this crowd registered. */
  detachAudio(): void {
    for (const id of this.audioEmitterIds) this.audioHost?.unregisterEmitter(id);
    this.audioEmitterIds.length = 0;
    for (const anchor of this.murmurAnchors) anchor.removeFromParent();
    this.murmurAnchors.length = 0;
    this.audioHost = null;
  }

  /** Emitter ids currently registered by the crowd. */
  get murmurEmitterIds(): readonly string[] {
    return [...this.audioEmitterIds];
  }

  /** Audio host currently attached, or `null` when the crowd is silent. */
  get audio(): PedestrianAudioHost | null {
    return this.audioHost;
  }

  /** Scene-graph root of one pedestrian (audio anchors, picking, harnesses). */
  pedestrianObject(id: string): THREE.Object3D | null {
    const found = this.pedestrians.find((pedestrian) => pedestrian.id === id);
    return found ? found.figure.root : null;
  }

  private nextAudioSeed(): number {
    this.audioSeed = (this.audioSeed * 1103515245 + 12345) & 0x7fffffff;
    return this.audioSeed;
  }

  /* ---------------- simulation ---------------- */

  /** One frame: move everyone, resolve overlaps, pose, then speak. */
  tick(_context: SceneContext, frame: FrameInfo): void {
    if (this.disposedState) return;
    const delta = Math.min(Math.max(Number.isFinite(frame?.delta) ? frame.delta : 0, 0), MAX_TICK_SECONDS);
    this.elapsedState += delta;
    this.tickCountState += 1;

    this.driveFollowing();
    for (const pedestrian of this.pedestrians) this.stepPedestrian(pedestrian, delta);
    for (const pedestrian of this.pedestrians) this.placePedestrian(pedestrian);
    this.resolveOverlaps();
    for (const pedestrian of this.pedestrians) this.animatePedestrian(pedestrian);
    this.updateAudio(delta);

    this.group.userData.chronoPedestrianCount = this.pedestrians.length;
    this.group.userData.chronoOutfitEra = this.morph.era;
  }

  /** Car-following: walkers ease off behind whoever is in front of them. */
  private driveFollowing(): void {
    for (const pedestrian of this.pedestrians) {
      if (pedestrian.state !== 'walking' || pedestrian.pendingCrossing) {
        pedestrian.speedFactor = 1;
        continue;
      }
      let ahead = FOLLOW_LOOKAHEAD;
      for (const other of this.pedestrians) {
        if (other === pedestrian) continue;
        if (other.direction !== pedestrian.direction) continue;
        if (Math.abs(other.lateral - pedestrian.lateral) > FOLLOWING_GAP * 0.8) continue;
        const gap = wrapMetres(pedestrian.direction * (other.s - pedestrian.s));
        if (gap < ahead) ahead = gap;
      }
      pedestrian.speedFactor = clamp(ahead / FOLLOW_LOOKAHEAD, 0.12, 1);
    }
  }

  private stepPedestrian(pedestrian: CrowdPedestrian, delta: number): void {
    switch (pedestrian.state) {
      case 'crossing':
        this.stepCrossing(pedestrian, delta);
        return;
      case 'window-shopping':
        this.stepWindowShopping(pedestrian, delta);
        return;
      case 'talking':
      case 'idle':
        this.stepStanding(pedestrian, delta);
        return;
      case 'walking':
      default:
        this.stepWalking(pedestrian, delta);
    }
  }

  private stepWalking(pedestrian: CrowdPedestrian, delta: number): void {
    pedestrian.speed = pedestrian.baseSpeed * pedestrian.speedFactor;
    pedestrian.s = wrapMetres(pedestrian.s + pedestrian.direction * pedestrian.speed * delta);
    pedestrian.animationPhase =
      (pedestrian.animationPhase + (pedestrian.speed / STRIDE_CYCLE_LENGTH) * delta) % 1;

    // A crossing beat walks to the kerb first; the road is crossed on the zebra.
    if (pedestrian.pendingCrossing) {
      this.tryBeginCrossing(pedestrian);
      return;
    }

    pedestrian.stateTimer -= delta;
    if (pedestrian.stateTimer <= 0) this.advanceBeat(pedestrian);
  }

  private stepStanding(pedestrian: CrowdPedestrian, delta: number): void {
    pedestrian.stateTimer -= delta;
    if (pedestrian.stateTimer <= 0) this.advanceBeat(pedestrian);
  }

  private stepWindowShopping(pedestrian: CrowdPedestrian, delta: number): void {
    const ramp = WINDOW_SHOPPING_BLEND_SECONDS;
    const progressIn = pedestrian.stateDuration - pedestrian.stateTimer;
    pedestrian.windowBlend = clamp01(
      Math.min(progressIn / ramp, Math.max(0, pedestrian.stateTimer) / ramp, 1),
    );
    pedestrian.stateTimer -= delta;
    if (pedestrian.stateTimer <= 0) {
      pedestrian.windowBlend = 0;
      this.advanceBeat(pedestrian);
    }
  }

  private stepCrossing(pedestrian: CrowdPedestrian, delta: number): void {
    const run = pedestrian.crossing;
    if (!run) {
      this.advanceBeat(pedestrian);
      return;
    }

    const rate = CROSSING_SPEED / run.anchor.length;
    if (run.leg === 'out') {
      run.progress += rate * delta;
      if (run.progress >= 1) {
        run.progress = 1;
        run.leg = 'dwell';
        run.dwell = CROSSING_KERB_DWELL_SECONDS;
      }
    } else if (run.leg === 'dwell') {
      run.dwell -= delta;
      if (run.dwell <= 0) run.leg = 'back';
    } else {
      run.progress -= rate * delta;
      if (run.progress <= 0) {
        run.progress = 0;
        pedestrian.crossing = null;
        pedestrian.pendingCrossing = false;
        pedestrian.windowBlend = 0;
        this.advanceBeat(pedestrian);
        return;
      }
    }

    pedestrian.speed = CROSSING_SPEED;
    pedestrian.animationPhase =
      (pedestrian.animationPhase + (CROSSING_SPEED / STRIDE_CYCLE_LENGTH) * delta) % 1;
  }

  /** Steps off the kerb when the next crosswalk is underfoot. */
  private tryBeginCrossing(pedestrian: CrowdPedestrian): boolean {
    let best: CrosswalkStop | null = null;
    let bestAhead = Number.POSITIVE_INFINITY;

    for (const stop of CROSSWALK_STOPS) {
      const ahead = wrapMetres(pedestrian.direction * (stop.loopParam - pedestrian.s));
      if (ahead < bestAhead) {
        bestAhead = ahead;
        best = stop;
      }
    }

    if (!best || bestAhead > CROSSWALK_TRIGGER_DISTANCE) return false;

    pedestrian.s = best.loopParam;
    pedestrian.state = 'crossing';
    pedestrian.windowBlend = 0;
    pedestrian.pendingCrossing = false;
    pedestrian.crossing = { anchor: best.anchor, progress: 0, leg: 'out', dwell: 0 };
    return true;
  }

  /** Moves to the next itinerary entry. */
  private advanceBeat(pedestrian: CrowdPedestrian): void {
    pedestrian.beatIndex = (pedestrian.beatIndex + 1) % pedestrian.itinerary.length;
    const beat = pedestrian.itinerary[pedestrian.beatIndex];
    pedestrian.stateTimer = beat.duration;
    pedestrian.stateDuration = beat.duration;
    pedestrian.windowBlend = 0;

    switch (beat.activity) {
      case 'window-shopping':
        pedestrian.state = 'window-shopping';
        pedestrian.talkPartner = null;
        break;
      case 'crossing':
        // Walk until a kerb comes underfoot; the timer is irrelevant here.
        pedestrian.state = 'walking';
        pedestrian.stateTimer = Number.POSITIVE_INFINITY;
        pedestrian.pendingCrossing = true;
        break;
      case 'talking':
        pedestrian.state = 'talking';
        this.pairTalker(pedestrian);
        break;
      case 'idle':
        pedestrian.state = 'idle';
        pedestrian.talkPartner = null;
        break;
      case 'walking':
      default:
        pedestrian.state = 'walking';
        pedestrian.talkPartner = null;
        break;
    }
  }

  /** Finds someone to talk to, drafting a nearby walker if nobody is free. */
  private pairTalker(pedestrian: CrowdPedestrian): void {
    const partner = this.nearest(pedestrian, TALK_PARTNER_RANGE, (other) => other.state === 'talking');
    if (partner) {
      pedestrian.talkPartner = partner.id;
      partner.talkPartner = pedestrian.id;
      return;
    }

    const candidate = this.nearest(
      pedestrian,
      TALK_PARTNER_RANGE,
      (other) => other.state === 'walking' && !other.pendingCrossing,
    );
    if (!candidate) {
      pedestrian.talkPartner = null;
      return;
    }

    candidate.state = 'talking';
    candidate.stateTimer = TALK_PARTNER_MIN_SECONDS;
    candidate.stateDuration = TALK_PARTNER_MIN_SECONDS;
    candidate.windowBlend = 0;
    candidate.talkPartner = pedestrian.id;
    pedestrian.talkPartner = candidate.id;
  }

  private nearest(
    pedestrian: CrowdPedestrian,
    range: number,
    predicate: (other: CrowdPedestrian) => boolean,
  ): CrowdPedestrian | null {
    let best: CrowdPedestrian | null = null;
    let bestSquared = range * range;
    for (const other of this.pedestrians) {
      if (other === pedestrian || !predicate(other)) continue;
      const dx = other.position.x - pedestrian.position.x;
      const dz = other.position.z - pedestrian.position.z;
      const squared = dx * dx + dz * dz;
      if (squared < bestSquared) {
        bestSquared = squared;
        best = other;
      }
    }
    return best;
  }

  /* ---------------- placement ---------------- */

  private placePedestrian(pedestrian: CrowdPedestrian): void {
    const loopPoint = BlockLayout.pointOnSidewalkLoop(pedestrian.s / SIDEWALK_LOOP_METRES);
    const inward = inwardNormal(loopPoint);

    const run = pedestrian.crossing;
    if (pedestrian.state === 'crossing' && run) {
      pedestrian.position = crosswalkPoint(run.anchor, run.progress, pedestrian.lateral);
      const sign = run.leg === 'back' ? -1 : 1;
      pedestrian.yaw = yawFromDirection({
        x: (run.anchor.far.x - run.anchor.near.x) * sign,
        z: (run.anchor.far.z - run.anchor.near.z) * sign,
      });
      return;
    }

    const offset =
      pedestrian.state === 'window-shopping'
        ? pedestrian.lateral +
          (WINDOW_SHOPPING_INSET - pedestrian.lateral) * clamp01(pedestrian.windowBlend)
        : pedestrian.lateral;

    pedestrian.position = clampToSidewalkBand({
      x: loopPoint.x + inward.x * offset,
      z: loopPoint.z + inward.z * offset,
    });

    if (pedestrian.state === 'window-shopping' && pedestrian.windowBlend > 0.3) {
      // Nose to the glass: face the storefront, not the way they were walking.
      pedestrian.yaw = yawFromDirection(inward);
      return;
    }

    if (pedestrian.state === 'talking' && pedestrian.talkPartner) {
      const partner = this.pedestrians.find((other) => other.id === pedestrian.talkPartner);
      if (partner) {
        const dx = partner.position.x - pedestrian.position.x;
        const dz = partner.position.z - pedestrian.position.z;
        const length = Math.hypot(dx, dz);
        if (length > 0.05) {
          pedestrian.yaw = Math.atan2(dx / length, dz / length);
          return;
        }
      }
    }

    pedestrian.yaw = yawFromDirection(loopTangent(pedestrian.s, pedestrian.direction));
  }

  /**
   * Pushes apart any pair closer than `minSeparation`, clamping each result back
   * onto the pavement (or into the zebra band while crossing). This is what the
   * "no clipping through each other" guarantee rests on.
   */
  private resolveOverlaps(): void {
    const minimum = this.minSeparation;
    for (let iteration = 0; iteration < SEPARATION_ITERATIONS; iteration += 1) {
      let moved = false;
      for (let index = 0; index < this.pedestrians.length; index += 1) {
        const a = this.pedestrians[index];
        for (let other = index + 1; other < this.pedestrians.length; other += 1) {
          const b = this.pedestrians[other];
          const dx = b.position.x - a.position.x;
          const dz = b.position.z - a.position.z;
          const distance = Math.hypot(dx, dz);
          if (distance >= minimum) continue;
          const push = (minimum - distance) / 2 + 0.001;
          const nx = distance > 1e-5 ? dx / distance : 1;
          const nz = distance > 1e-5 ? dz / distance : 0;
          a.position = this.legalisePosition(a, {
            x: a.position.x - nx * push,
            z: a.position.z - nz * push,
          });
          b.position = this.legalisePosition(b, {
            x: b.position.x + nx * push,
            z: b.position.z + nz * push,
          });
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  private legalisePosition(pedestrian: CrowdPedestrian, point: Vec2): Vec2 {
    const run = pedestrian.crossing;
    if (pedestrian.state === 'crossing' && run) return clampToCrosswalk(point, run.anchor);
    return clampToSidewalkBand(point);
  }

  /* ---------------- animation + audio ---------------- */

  private animatePedestrian(pedestrian: CrowdPedestrian): void {
    const kind: FigurePoseKind =
      pedestrian.state === 'crossing'
        ? 'cross'
        : pedestrian.state === 'window-shopping'
          ? 'window-shopping'
          : pedestrian.state === 'talking'
            ? 'talk'
            : pedestrian.state === 'idle'
              ? 'idle'
              : 'walk';

    pedestrian.figure.poseFor(kind, this.elapsedState, pedestrian.animationPhase);
    pedestrian.figure.place(pedestrian.position, pedestrian.yaw);
  }

  /** Footsteps per step phase, murmur bursts from every conversation. */
  private updateAudio(delta: number): void {
    const audio = this.audioHost;
    if (!audio || !audio.isUnlocked) return;

    for (const pedestrian of this.pedestrians) {
      const moving = pedestrian.state === 'walking' || pedestrian.state === 'crossing';
      if (moving) {
        const marker = Math.floor(pedestrian.animationPhase * 2);
        if (marker !== pedestrian.stepMarker) {
          pedestrian.stepMarker = marker;
          const speed = pedestrian.state === 'crossing' ? CROSSING_SPEED : pedestrian.speed;
          audio.play(FOOTSTEP_CUE, {
            position: { x: pedestrian.position.x, y: 0.06, z: pedestrian.position.z },
            gain: FOOTSTEP_GAIN * (0.7 + 0.6 * (speed / DEFAULT_WALK_SPEED)),
            rate: clamp(speed / 1.35, 0.6, 1.6),
            seed: this.nextAudioSeed(),
            era: this.eraState,
          });
        }
      } else {
        pedestrian.stepMarker = -1;
      }

      if (pedestrian.state === 'talking') {
        pedestrian.murmurTimer -= delta;
        if (pedestrian.murmurTimer <= 0) {
          pedestrian.murmurTimer =
            MURMUR_BURST_MIN_SECONDS + (pedestrian.index % 5) * MURMUR_BURST_SPREAD_SECONDS;
          audio.play(CROWD_MURMUR_CUE, {
            position: {
              x: pedestrian.position.x,
              y: MURMUR_EMITTER_HEIGHT,
              z: pedestrian.position.z,
            },
            gain: MURMUR_BURST_GAIN,
            rate: 0.9 + (pedestrian.index % 4) * 0.06,
            loop: false,
            seed: this.nextAudioSeed(),
            era: this.eraState,
          });
        }
      }
    }
  }

  /* ---------------- construction helpers ---------------- */

  private createPedestrian(index: number, count: number): CrowdPedestrian {
    const id = `pedestrian-${index}`;
    const figure = this.pool.acquire(id);
    if (!figure) {
      throw new Error(`Crowd could not acquire a figure for "${id}"; pool capacity reached.`);
    }

    const direction: 1 | -1 = index % 2 === 0 ? 1 : -1;
    const itinerary = buildItinerary(this.random, index);
    const lateral =
      direction === 1 ? this.random.float(0.28, 0.95) : this.random.float(-0.95, -0.28);
    let s = wrapMetres((index / Math.max(1, count)) * SIDEWALK_LOOP_METRES + this.random.float(-2, 2));

    // Pedestrians whose first special beat is a crossing start just short of a
    // kerb, so the block shows a street crossing within the first seconds
    // instead of after a full lap.
    if (itinerary[1]?.activity === 'crossing') {
      let nearest = Number.POSITIVE_INFINITY;
      for (const stop of CROSSWALK_STOPS) {
        const ahead = wrapMetres(direction * (stop.loopParam - s));
        if (ahead < nearest) nearest = ahead;
      }
      if (Number.isFinite(nearest)) {
        s = wrapMetres(s + direction * (nearest - this.random.float(3, 8)));
      }
    }

    const pedestrian = new CrowdPedestrian({
      index,
      id,
      figure,
      s,
      direction,
      lateral,
      baseSpeed: DEFAULT_WALK_SPEED * (1 + this.random.float(-WALK_SPEED_SPREAD, WALK_SPEED_SPREAD)),
      itinerary,
      murmurTimer: 1 + this.random.float(0, 1.2),
    });

    this.placePedestrian(pedestrian);
    pedestrian.figure.poseFor('walk', 0, pedestrian.animationPhase);
    pedestrian.figure.place(pedestrian.position, pedestrian.yaw);
    return pedestrian;
  }

  /** Releases the crowd: tick, audio, figures and the scene group. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.registration?.dispose();
    this.detachAudio();
    if (this.ownsPool) this.pool.dispose();
    this.group.removeFromParent();
    this.group.clear();
    this.pedestrians.length = 0;
  }
}

/** Creates a crowd system (the `create` half of the crowd lifecycle). */
export function createCrowdSystem(options: CrowdSystemOptions): CrowdSystem {
  return new CrowdSystem(options);
}

/**
 * Builds a single stand-alone figure wearing one era's outfit. Handy for
 * portraits, close-ups and per-era silhouette comparison.
 */
export function createOutfitSample(era: EraId, variant = 0.9): PedestrianFigure {
  const figure = createPedestrianFigure({ id: `${era}-sample`, variant });
  figure.applyOutfit(OUTFITS[era]);
  return figure;
}
