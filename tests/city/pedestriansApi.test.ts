/**
 * Chrono City — pedestrian crowd composition suite.
 *
 * Proves the street-life contract end to end against the *real* shared systems
 * (no doubles for the parts under test):
 *
 *  - outfits read the `era-contracts` descriptors, stay distinct across the five
 *    years and crossfade (colours) / mid-swap (silhouettes) when blended;
 *  - figures built by the factory measure as five distinct silhouettes and their
 *    walk/idle/talk/window-shopping loops actually move the rig;
 *  - the crowd ticks through the real `SceneContext` tick registry: pedestrians
 *    walk the `BlockLayout` sidewalk ring, never leave the pavement or enter the
 *    block, never overlap, cross on the shared crosswalk anchors and pause at the
 *    storefront band;
 *  - a real `TimelineRuntime` drives the wardrobe: tween progress is strictly
 *    between the endpoints mid-flight and lands exactly on the target colours;
 *  - a real `AudioDirector` (against an in-memory Web Audio stub) receives
 *    footstep and crowd-murmur calls *positioned at pedestrians*, only after the
 *    audio context is unlocked, and the looping murmur emitters ride with them;
 *  - the API registers per-year inspectables and tears everything down again.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { BLOCK_HALF_DEPTH, BLOCK_HALF_WIDTH, BlockLayout } from '../../src/core/blockLayout';
import { ERA_IDS } from '../../src/core/eraContracts';
import { createSceneContext, type SceneContext, type SceneContextOptions } from '../../src/core/sceneContext';
import { getEraDescriptor } from '../../src/era/eraDescriptors';
import { createTimelineRuntime, type TimelineRuntime } from '../../src/era/timelineRuntime';
import {
  createMaterialLibraryFromScene,
  type MaterialLibrary,
} from '../../src/materials/materialLibrary';
import {
  createInspectionRegistry,
  type InspectionRegistry,
} from '../../src/interaction/inspectionRegistry';
import {
  createAudioDirector,
  type AudioDirector,
  type AudioEngineContext,
  type PlayCueOptions,
} from '../../src/audio/audioDirector';
import { FOOTSTEP_CUE, createSfxLibrary } from '../../src/audio/sfxSynth';
import {
  CROWD_GROUP_NAME,
  CROWD_MURMUR_CUE,
  CROWD_MURMUR_EMITTER_PREFIX,
  CROWD_SYSTEM_ID,
  CROWD_SYSTEM_ORDER,
  DEFAULT_MIN_SEPARATION,
  MURMUR_EMITTER_HEIGHT,
  PEDESTRIAN_STATES,
  SIDEWALK_LOOP_METRES,
  clampToSidewalkBand,
  createOutfitSample,
  distanceFromBlock,
  type PedestrianAudioHost,
  type PedestrianSnapshot,
  type PedestrianState,
} from '../../src/city/pedestrians/crowdSystem';
import { FigurePool, type PedestrianFigure } from '../../src/city/pedestrians/figureFactory';
import { OUTFITS, OUTFIT_SWAP_MIDPOINT, blendOutfits } from '../../src/city/pedestrians/outfits';
import {
  CROWD_INSPECTABLE_ID,
  PEDESTRIAN_INSPECTABLE_PREFIX,
  PEDESTRIANS_API_VERSION,
  PEDESTRIANS_BLENDABLE_ID,
  PedestriansApi,
  createPedestriansApi,
  getPedestriansApi,
  integratePedestriansGlobal,
  type PedestriansApi as PedestriansApiHandle,
} from '../../src/city/pedestrians/pedestriansApi';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

const openContexts: SceneContext[] = [];
const openDirectors: AudioDirector[] = [];
const openApis: PedestriansApiHandle[] = [];
const openTimelines: TimelineRuntime[] = [];
const openFigures: PedestrianFigure[] = [];
const openPools: FigurePool[] = [];

function createStubRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const stub = {
    domElement: canvas,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    render: () => undefined,
    setAnimationLoop: () => undefined,
    dispose: () => undefined,
  };
  return stub as unknown as THREE.WebGLRenderer;
}

interface SceneHarness {
  readonly context: SceneContext;
  readonly materials: MaterialLibrary;
}

/** A real `SceneContext` (stub renderer, no GPU) plus a seeded material library. */
function createHarness(options: SceneContextOptions = {}): SceneHarness {
  const context = createSceneContext({
    createRenderer: createStubRenderer,
    autoResize: false,
    autoStart: false,
    ...options,
  });
  openContexts.push(context);
  return { context, materials: createMaterialLibraryFromScene(context) };
}

function trackApi(api: PedestriansApiHandle): PedestriansApiHandle {
  openApis.push(api);
  return api;
}

function trackFigure(figure: PedestrianFigure): PedestrianFigure {
  openFigures.push(figure);
  return figure;
}

/** Runs `seconds` of 60 fps frames through the real tick registry. */
function runFrames(context: SceneContext, seconds: number, step = 1 / 60): number {
  const frames = Math.round(seconds / step);
  for (let frame = 0; frame < frames; frame += 1) context.tick(step);
  return frames;
}

function distanceBetween(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Closest pair distance over a set of snapshots. */
function closestPair(snapshots: readonly PedestrianSnapshot[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < snapshots.length; index += 1) {
    for (let other = index + 1; other < snapshots.length; other += 1) {
      minimum = Math.min(minimum, distanceBetween(snapshots[index].position, snapshots[other].position));
    }
  }
  return minimum;
}

afterEach(() => {
  for (const api of openApis) api.dispose();
  openApis.length = 0;
  for (const timeline of openTimelines) timeline.dispose();
  openTimelines.length = 0;
  for (const director of openDirectors) director.dispose();
  openDirectors.length = 0;
  for (const figure of openFigures) figure.dispose();
  openFigures.length = 0;
  for (const pool of openPools) pool.dispose();
  openPools.length = 0;
  for (const context of openContexts) context.dispose();
  openContexts.length = 0;
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Web Audio stub                                                      */
/* ------------------------------------------------------------------ */

interface StubParam {
  value: number;
  setValueAtTime(value: number, time: number): StubParam;
  linearRampToValueAtTime(value: number, time: number): StubParam;
  exponentialRampToValueAtTime(value: number, time: number): StubParam;
  setTargetAtTime(value: number, time: number, constant: number): StubParam;
  cancelScheduledValues(time: number): StubParam;
  cancelAndHoldAtTime(time: number): StubParam;
  setValueCurveAtTime(values: Float32Array, startTime: number, duration: number): StubParam;
}

function createStubParam(value = 0): StubParam {
  const param: StubParam = {
    value,
    setValueAtTime(next: number) {
      param.value = next;
      return param;
    },
    linearRampToValueAtTime(next: number) {
      param.value = next;
      return param;
    },
    exponentialRampToValueAtTime(next: number) {
      param.value = next;
      return param;
    },
    setTargetAtTime(next: number) {
      param.value = next;
      return param;
    },
    cancelScheduledValues() {
      return param;
    },
    cancelAndHoldAtTime() {
      return param;
    },
    setValueCurveAtTime() {
      return param;
    },
  };
  return param;
}

function isStubParam(target: unknown): target is StubParam {
  return Boolean(target) && typeof (target as StubParam).setValueAtTime === 'function';
}

class StubNode {
  readonly kind: string;
  readonly outputs: StubNode[] = [];

  constructor(kind: string) {
    this.kind = kind;
  }

  connect(target: StubNode | StubParam): unknown {
    if (isStubParam(target)) return target;
    this.outputs.push(target);
    return target;
  }

  disconnect(): void {
    this.outputs.length = 0;
  }
}

class StubSource extends StubNode {
  onended: (() => void) | null = null;

  start(): void {
    /* scheduled voices never need to run in the stub */
  }

  stop(): void {
    /* the stub keeps voices alive; the director's caps still apply */
  }

  addEventListener(): void {
    /* no `ended` events in the stub */
  }

  removeEventListener(): void {
    /* no `ended` events in the stub */
  }
}

class StubGain extends StubNode {
  readonly gain = createStubParam(1);

  constructor() {
    super('gain');
  }
}

class StubPanner extends StubNode {
  readonly positionX = createStubParam(0);
  readonly positionY = createStubParam(0);
  readonly positionZ = createStubParam(0);
  panningModel = 'equalpower';
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  coneInnerAngle = 360;
  coneOuterAngle = 360;
  coneOuterGain = 0;

  constructor() {
    super('panner');
  }
}

class StubOscillator extends StubSource {
  type = 'sine';
  readonly frequency = createStubParam(440);
  readonly detune = createStubParam(0);

  constructor() {
    super('oscillator');
  }
}

class StubBufferSource extends StubSource {
  buffer: StubBuffer | null = null;
  loop = false;
  readonly playbackRate = createStubParam(1);
  readonly detune = createStubParam(0);

  constructor() {
    super('bufferSource');
  }
}

class StubBiquadFilter extends StubNode {
  type = 'lowpass';
  readonly frequency = createStubParam(350);
  readonly Q = createStubParam(1);
  readonly gain = createStubParam(0);
  readonly detune = createStubParam(0);

  constructor() {
    super('biquad');
  }
}

class StubBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel] as Float32Array;
  }
}

class StubListener {
  readonly positionX = createStubParam(0);
  readonly positionY = createStubParam(0);
  readonly positionZ = createStubParam(0);
  readonly forwardX = createStubParam(0);
  readonly forwardY = createStubParam(0);
  readonly forwardZ = createStubParam(-1);
  readonly upX = createStubParam(0);
  readonly upY = createStubParam(1);
  readonly upZ = createStubParam(0);
}

class StubAudioContext {
  readonly destination = new StubNode('destination');
  readonly listener = new StubListener();
  readonly nodes: StubNode[] = [];
  sampleRate = 48000;
  currentTime = 0;
  state: AudioContextState = 'suspended';

  createGain(): StubGain {
    return this.track(new StubGain());
  }

  createPanner(): StubPanner {
    return this.track(new StubPanner());
  }

  createOscillator(): StubOscillator {
    return this.track(new StubOscillator());
  }

  createBufferSource(): StubBufferSource {
    return this.track(new StubBufferSource());
  }

  createBiquadFilter(): StubBiquadFilter {
    return this.track(new StubBiquadFilter());
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): StubBuffer {
    return new StubBuffer(numberOfChannels, length, sampleRate);
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  private track<T extends StubNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}

interface AudioHarness {
  readonly stub: StubAudioContext;
  readonly director: AudioDirector;
  /** Every cue call the crowd made, captured before it reaches the director. */
  readonly calls: Array<{ cue: string; position?: { x: number; y: number; z: number }; loop?: boolean }>;
  readonly host: PedestrianAudioHost;
}

/**
 * Builds a real `AudioDirector` over the in-memory Web Audio stub and a
 * pass-through host that records what the crowd asks for while still forwarding
 * it to the director, so both the *call* and the resulting voice are verifiable.
 */
function createAudioHarness(): AudioHarness {
  const stub = new StubAudioContext();
  const context = stub as unknown as AudioEngineContext;
  const director = createAudioDirector({
    createAudioContext: () => context,
    maxVoices: 96,
    seed: 7,
  });
  director.registerCues(createSfxLibrary());
  openDirectors.push(director);

  const calls: AudioHarness['calls'] = [];
  const host: PedestrianAudioHost = {
    get isUnlocked() {
      return director.isUnlocked;
    },
    play(cue: string, options: PlayCueOptions = {}) {
      calls.push({ cue, position: options.position, loop: options.loop });
      return director.play(cue, options);
    },
    registerEmitter: (options) => director.registerEmitter(options),
    unregisterEmitter: (id: string) => director.unregisterEmitter(id),
    registerCue: (definition) => director.registerCue(definition),
    registerCueAlias: (alias: string, target: string) => director.registerCueAlias(alias, target),
    hasCue: (name: string) => director.hasCue(name),
  };

  return { stub, director, calls, host };
}

/* ------------------------------------------------------------------ */
/* Outfits                                                             */
/* ------------------------------------------------------------------ */

describe('per-era pedestrian outfits', () => {
  it('derives every year from the era descriptor and keeps the silhouettes distinct', () => {
    const silhouetteKeys = ERA_IDS.map((era) => OUTFITS[era].silhouetteKey);
    expect(new Set(silhouetteKeys).size).toBe(ERA_IDS.length);

    for (const era of ERA_IDS) {
      const outfit = OUTFITS[era];
      const fashion = getEraDescriptor(era).fashion;

      expect(outfit.era).toBe(era);
      expect(outfit.year).toBe(Number.parseInt(era, 10));
      expect(outfit.style).toBe(fashion.style);
      expect(outfit.silhouettes).toEqual(fashion.silhouettes);
      expect(outfit.hatProbability).toBe(fashion.hats);
      expect(outfit.formalRatio).toBe(fashion.formalRatio);
      expect(outfit.notes).toBe(fashion.notes);

      // Garment colours are drawn from the descriptor palette, never invented.
      for (const colour of [
        outfit.colors.hat,
        outfit.colors.outerwear,
        outfit.colors.top,
        outfit.colors.legs,
        outfit.colors.dress,
        outfit.colors.accent,
      ]) {
        expect(outfit.palette).toContain(colour);
      }
    }
  });

  it('matches the requested wardrobe for each year', () => {
    // 1945 — hats, suits and dresses.
    expect(OUTFITS['1945'].tags).toEqual(expect.arrayContaining(['hats', 'suits', 'dresses']));
    expect(OUTFITS['1945'].form.hat).toBe('brimmed');
    expect(OUTFITS['1945'].dressRatio).toBeGreaterThan(0.25);
    expect(OUTFITS['1945'].form.coatLength).toBeGreaterThan(0.8);

    // 1965 — slim mod tailoring.
    expect(OUTFITS['1965'].tags).toEqual(expect.arrayContaining(['mod', 'tailoring']));
    expect(OUTFITS['1965'].form.hat).toBe('pillbox');
    expect(OUTFITS['1965'].form.shoulderWidth).toBeLessThan(OUTFITS['1945'].form.shoulderWidth);

    // 1985 — punk and power suits.
    expect(OUTFITS['1985'].tags).toEqual(expect.arrayContaining(['punk', 'power-suit']));
    expect(OUTFITS['1985'].form.hat).toBe('mohawk');
    expect(OUTFITS['1985'].form.shoulderWidth).toBeGreaterThan(1.2);

    // 2005 — casual denim.
    expect(OUTFITS['2005'].tags).toEqual(expect.arrayContaining(['casual', 'denim']));
    expect(OUTFITS['2005'].form.legs).toBe('bootcut');

    // 2025 — techwear.
    expect(OUTFITS['2025'].tags).toEqual(expect.arrayContaining(['techwear']));
    expect(OUTFITS['2025'].form.legs).toBe('wide-leg');
    expect(OUTFITS['2025'].form.hat).toBe('hood');
  });

  it('crossfades colours across the whole tween and swaps the silhouette at the midpoint', () => {
    const from = OUTFITS['1945'];
    const to = OUTFITS['2025'];

    const start = blendOutfits(from, to, 0);
    const end = blendOutfits(from, to, 1);
    const middle = blendOutfits(from, to, OUTFIT_SWAP_MIDPOINT);

    // Settled states are exact, so nothing pops at rest.
    expect(start.colors).toEqual(from.colors);
    expect(end.colors).toEqual(to.colors);
    expect(start.form).toBe(from.form);
    expect(end.form).toBe(to.form);
    expect(end.blending).toBe(false);
    expect(start.blending).toBe(false);

    // Mid-tween the colours are genuinely between the two seasons.
    expect(middle.blending).toBe(true);
    expect(middle.colors.legs).not.toBe(from.colors.legs);
    expect(middle.colors.legs).not.toBe(to.colors.legs);
    expect(middle.colors.outerwear).not.toBe(from.colors.outerwear);
    expect(middle.colors.outerwear).not.toBe(to.colors.outerwear);

    // Discrete pieces switch exactly at the midpoint, never halfway through.
    expect(blendOutfits(from, to, OUTFIT_SWAP_MIDPOINT - 0.01).form).toBe(from.form);
    expect(blendOutfits(from, to, OUTFIT_SWAP_MIDPOINT).form).toBe(to.form);
    expect(blendOutfits(from, to, OUTFIT_SWAP_MIDPOINT - 0.01).era).toBe(from.era);
    expect(blendOutfits(from, to, OUTFIT_SWAP_MIDPOINT).era).toBe(to.era);
  });
});

/* ------------------------------------------------------------------ */
/* Figures                                                             */
/* ------------------------------------------------------------------ */

describe('articulated low-poly figures', () => {
  it('builds a distinguishable silhouette for each year', () => {
    const signatures = ERA_IDS.map((era) => trackFigure(createOutfitSample(era, 0.9)).metrics.silhouette);
    expect(new Set(signatures).size).toBe(ERA_IDS.length);

    const padded = trackFigure(createOutfitSample('1985', 0.9)).metrics;
    const slim = trackFigure(createOutfitSample('1965', 0.9)).metrics;
    const dresses = trackFigure(createOutfitSample('1945', 0.1)).metrics;
    const suits = trackFigure(createOutfitSample('1945', 0.9)).metrics;

    // 1985 pads the shoulders, 1965 cuts them slim.
    expect(padded.shoulderWidth).toBeGreaterThan(slim.shoulderWidth);
    // A 1945 brimmed hat is wider than a 1965 pillbox.
    expect(trackFigure(createOutfitSample('1945', 0.9)).metrics.width).toBeGreaterThan(slim.width);
    // 1985's crest is the tallest headwear of the five years.
    expect(padded.height).toBeGreaterThan(trackFigure(createOutfitSample('2005', 0.9)).metrics.height);
    // A dress and a suit of the same year are not the same silhouette.
    expect(dresses.silhouette).not.toBe(suits.silhouette);

    // Feet rest on the ground rather than floating.
    for (const era of ERA_IDS) {
      expect(trackFigure(createOutfitSample(era, 0.9)).metrics.groundClearance).toBeLessThan(0.08);
    }
  });

  it('wears the era palette on the matching garments', () => {
    const figure = trackFigure(createOutfitSample('2005', 0.9));
    expect(figure.materials.legs.color.getHex()).toBe(OUTFITS['2005'].colors.legs);
    expect(figure.materials.outerwear.color.getHex()).toBe(OUTFITS['2005'].colors.outerwear);
    expect(figure.materials.shoes.color.getHex()).toBe(OUTFITS['2005'].colors.shoes);

    const morph = blendOutfits(OUTFITS['2005'], OUTFITS['2025'], 0.5);
    figure.applyOutfitBlend(morph);
    expect(figure.materials.legs.color.getHex()).toBe(morph.colors.legs);
    expect(figure.materials.legs.color.getHex()).not.toBe(OUTFITS['2005'].colors.legs);
    expect(figure.materials.legs.color.getHex()).not.toBe(OUTFITS['2025'].colors.legs);

    figure.applyOutfit(OUTFITS['2025']);
    expect(figure.materials.legs.color.getHex()).toBe(OUTFITS['2025'].colors.legs);
  });

  it('plays walk, idle, talk and window-shopping loops on the rig', () => {
    const figure = trackFigure(createOutfitSample('2005', 0.9));
    const { legLeft, legRight, forearmRight, head } = figure.joints;

    // Walk: hips swing in antiphase and the cycle is periodic.
    figure.poseWalk(0.25);
    const left = legLeft.rotation.x;
    const right = legRight.rotation.x;
    expect(left).not.toBeCloseTo(0, 4);
    expect(Math.sign(left)).toBe(-Math.sign(right));

    figure.poseWalk(0.25 + 1);
    expect(legLeft.rotation.x).toBeCloseTo(left, 6);

    figure.poseWalk(0.75);
    expect(legLeft.rotation.x).toBeCloseTo(right, 6);

    // Idle: quiet weight shift, hips nowhere near the walk swing.
    figure.poseIdle(0.9);
    expect(Math.abs(legLeft.rotation.x)).toBeLessThan(0.1);
    expect(legLeft.rotation.x).not.toBeCloseTo(left, 4);

    // Talk: the head turns and the gesturing forearm moves over time.
    figure.poseTalk(0);
    const headAtStart = head.rotation.y;
    const armAtStart = forearmRight.rotation.x;
    figure.poseTalk(0.45);
    expect(head.rotation.y).not.toBeCloseTo(headAtStart, 4);
    expect(forearmRight.rotation.x).not.toBeCloseTo(armAtStart, 4);
    expect(Math.abs(head.rotation.x)).toBeLessThan(0.4);

    // Window shopping: leans towards the glass and looks up at the display.
    figure.poseWindowShop(0.3);
    expect(figure.joints.spine.rotation.x).toBeGreaterThan(0);
    expect(head.rotation.x).toBeLessThan(-0.1);
  });

  it('caps and recycles figures instead of rebuilding them', () => {
    const pool = new FigurePool({ capacity: 3, seed: 11 });
    openPools.push(pool);

    const figures = pool.acquireMany(3, 'crowd');
    expect(figures).toHaveLength(3);
    expect(pool.created).toBe(3);
    expect(pool.size).toBe(3);
    expect(pool.acquire('crowd-3')).toBeNull();

    expect(pool.release(figures[0])).toBe(true);
    const reused = pool.acquire('crowd-3');
    expect(reused).not.toBeNull();
    expect(reused?.id).toBe('crowd-3');
    // The body was recycled, not rebuilt: the pool grew no further.
    expect(pool.created).toBe(3);
    expect(reused?.root.name).toContain('crowd-3');
  });

  it('keeps placements on the sidewalk band the shared layout defines', () => {
    for (const point of [
      { x: 0, z: 0 },
      { x: 200, z: -200 },
      { x: BlockLayout.sidewalk.centerX, z: -BlockLayout.sidewalk.centerZ },
      { x: BLOCK_HALF_WIDTH - 1, z: BLOCK_HALF_DEPTH - 1 },
    ]) {
      const clamped = clampToSidewalkBand(point);
      expect(BlockLayout.isOnSidewalk(clamped)).toBe(true);
      expect(BlockLayout.isInsideBlock(clamped)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Crowd                                                               */
/* ------------------------------------------------------------------ */

describe('crowd street life through the scene context', () => {
  it('runs 20 seconds of crowds that stay on the pavement without clipping', () => {
    const { context, materials } = createHarness();
    const api = trackApi(createPedestriansApi({ scene: context, materials, count: 16 }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const seen = new Set<PedestrianState>();
    const offGeometry: string[] = [];
    const insideBlock: string[] = [];
    let minimumSeparation = Number.POSITIVE_INFINITY;
    let crossingSamples = 0;
    let windowSamples = 0;
    let talkSamples = 0;
    let walkSamples = 0;

    const frames = Math.round(20 / (1 / 60));
    for (let frame = 0; frame < frames; frame += 1) {
      context.tick(1 / 60);
      if (frame % 5 !== 0) continue;

      const snapshots = api.crowd.snapshots;
      minimumSeparation = Math.min(minimumSeparation, closestPair(snapshots));

      for (const snapshot of snapshots) {
        seen.add(snapshot.state);
        switch (snapshot.state) {
          case 'crossing':
            crossingSamples += 1;
            // Street crossings happen on the shared crosswalk geometry only.
            expect(BlockLayout.isOnCrosswalk(snapshot.position)).toBe(true);
            break;
          case 'window-shopping':
            if (snapshot.windowShopping > 0.6) {
              windowSamples += 1;
              // Stepped in to the storefront band beside the block face.
              expect(distanceFromBlock(snapshot.position)).toBeLessThan(1);
            }
            break;
          case 'talking':
            talkSamples += 1;
            break;
          case 'walking':
            walkSamples += 1;
            break;
          default:
            break;
        }

        if (!BlockLayout.isOnSidewalk(snapshot.position) && !BlockLayout.isOnCrosswalk(snapshot.position)) {
          offGeometry.push(`${snapshot.id}@${snapshot.state}(${snapshot.position.x},${snapshot.position.z})`);
        }
        if (BlockLayout.isInsideBlock(snapshot.position, -0.05)) insideBlock.push(snapshot.id);
        expect(snapshot.distanceAlongLoop).toBeGreaterThanOrEqual(0);
        expect(snapshot.distanceAlongLoop).toBeLessThan(SIDEWALK_LOOP_METRES);
      }
    }

    expect(api.crowd.tickCount).toBe(frames);
    expect(api.crowd.elapsed).toBeCloseTo(20, 1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(offGeometry).toEqual([]);
    expect(insideBlock).toEqual([]);

    // Every street-life behaviour shows up inside one 20 second window.
    expect([...seen].sort()).toEqual([...PEDESTRIAN_STATES].sort());
    expect(walkSamples).toBeGreaterThan(0);
    expect(crossingSamples).toBeGreaterThan(0);
    expect(windowSamples).toBeGreaterThan(0);
    expect(talkSamples).toBeGreaterThan(0);

    // Nobody clips through anybody: bodies stay at least half a metre apart.
    expect(minimumSeparation).toBeGreaterThanOrEqual(0.5);
    expect(api.crowd.minSeparation).toBe(DEFAULT_MIN_SEPARATION);
  });

  it('animates pooled phases, places figures in the scene and queues behind leaders', () => {
    const { context, materials } = createHarness();
    const api = trackApi(createPedestriansApi({ scene: context, materials, count: 12 }));

    expect(api.crowd.systemRegistration?.id).toBe(CROWD_SYSTEM_ID);
    expect(api.crowd.systemRegistration?.order).toBe(CROWD_SYSTEM_ORDER);
    expect(context.scene.getObjectByName(CROWD_GROUP_NAME)).toBe(api.group);
    expect(api.group.children).toHaveLength(api.crowd.count);

    const before = api.crowd.snapshots;
    runFrames(context, 2);
    const after = api.crowd.snapshots;

    const advanced = after.filter((snapshot, index) => {
      const previous = before[index];
      return (
        snapshot.animationPhase !== previous.animationPhase ||
        snapshot.distanceAlongLoop !== previous.distanceAlongLoop
      );
    });
    expect(advanced.length).toBeGreaterThan(api.crowd.count / 2);

    // Figures follow their pedestrians in the graph, at pedestrian positions.
    for (const snapshot of after) {
      const object = api.crowd.pedestrianObject(snapshot.id);
      expect(object).not.toBeNull();
      expect(object?.position.x).toBeCloseTo(snapshot.position.x, 6);
      expect(object?.position.z).toBeCloseTo(snapshot.position.z, 6);
    }

    // Walkers ease off behind the person in front of them instead of merging.
    const distances = api.crowd.snapshots.map((snapshot) => snapshot.speed);
    expect(distances.every((speed) => speed > 0 && speed <= 1.7)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Era transitions                                                     */
/* ------------------------------------------------------------------ */

describe('era wardrobe transitions', () => {
  it('morphs outfits progressively through the TimelineRuntime tween', () => {
    const { context, materials } = createHarness();
    const timeline = createTimelineRuntime({ context, initialEra: '2025' });
    openTimelines.push(timeline);
    const api = trackApi(createPedestriansApi({ scene: context, timeline, materials, count: 8 }));

    expect(timeline.hasBlendable(PEDESTRIANS_BLENDABLE_ID)).toBe(true);
    expect(api.blendable).not.toBeNull();
    expect(api.outfitEra).toBe('2025');
    expect(api.outfitBlend).toBe(1);

    const garment = api.pool.figures[0].materials.legs;
    expect(garment.color.getHex()).toBe(OUTFITS['2025'].colors.legs);

    timeline.selectEra('1945');
    expect(api.outfitBlend).toBe(0);

    // A quarter of the tween: colours have moved, silhouette has not.
    timeline.advance(300);
    expect(api.outfitBlend).toBeGreaterThan(0);
    expect(api.outfitBlend).toBeLessThan(1);
    expect(api.outfitEra).toBe('2025');
    expect(garment.color.getHex()).not.toBe(OUTFITS['2025'].colors.legs);
    expect(garment.color.getHex()).not.toBe(OUTFITS['1945'].colors.legs);

    // Past the midpoint: the silhouette (and the reported season) switches.
    timeline.advance(400);
    expect(api.outfitEra).toBe('1945');

    // Settled: the wardrobe lands exactly on the target palette, and stays there.
    timeline.advance(1000);
    expect(api.outfitBlend).toBe(1);
    expect(api.outfitEra).toBe('1945');
    expect(garment.color.getHex()).toBe(OUTFITS['1945'].colors.legs);

    timeline.advance(200);
    expect(garment.color.getHex()).toBe(OUTFITS['1945'].colors.legs);
    expect(api.crowd.outfitMorph.blending).toBe(false);
  });

  it('drives the crowd and the timeline from one SceneContext frame loop', () => {
    const { context, materials } = createHarness();
    const timeline = createTimelineRuntime({ context, initialEra: '1945' });
    openTimelines.push(timeline);
    const api = trackApi(createPedestriansApi({ scene: context, timeline, materials, count: 10 }));

    timeline.selectEra('1985');
    let sawPartial = false;
    // 1200 ms of 60 fps frames: half a tween's worth of progress per second.
    for (let frame = 0; frame < 90; frame += 1) {
      context.tick(1 / 60);
      if (api.outfitBlend > 0 && api.outfitBlend < 1) sawPartial = true;
    }

    expect(sawPartial).toBe(true);
    expect(api.crowd.tickCount).toBe(90);
    expect(api.outfitBlend).toBe(1);
    expect(api.outfitEra).toBe('1985');
    expect(api.pool.figures[0].materials.top.color.getHex()).toBe(OUTFITS['1985'].colors.top);
  });
});

/* ------------------------------------------------------------------ */
/* Audio                                                               */
/* ------------------------------------------------------------------ */

describe('pedestrian SFX', () => {
  it('fires footsteps and crowd murmur from pedestrian positions after unlock', async () => {
    const { context, materials } = createHarness();
    const audio = createAudioHarness();
    const api = trackApi(
      createPedestriansApi({ scene: context, materials, audio: audio.host, count: 12 }),
    );

    // Audio is locked: the crowd stays silent.
    for (let frame = 0; frame < 180; frame += 1) {
      context.tick(1 / 60);
      audio.director.tick(context);
    }
    expect(audio.director.isUnlocked).toBe(false);
    expect(audio.calls).toHaveLength(0);

    // First user gesture unlocks the context.
    await expect(audio.director.unlock()).resolves.toBe(true);
    expect(audio.director.isUnlocked).toBe(true);

    for (let frame = 0; frame < 420; frame += 1) {
      context.tick(1 / 60);
      audio.director.tick(context);
    }

    // Footsteps fire from the pedestrians' own positions.
    const footsteps = audio.calls.filter((call) => call.cue === FOOTSTEP_CUE);
    expect(footsteps.length).toBeGreaterThan(0);
    const snapshots = api.crowd.snapshots;
    const footstepNearPedestrian = footsteps.some((call) => {
      if (!call.position) return false;
      return snapshots.some((snapshot) => distanceBetween(snapshot.position, call.position!) < 0.8);
    });
    expect(footstepNearPedestrian).toBe(true);
    for (const call of footsteps) expect(call.position).toBeDefined();

    // ...and the real director turned them into positional voices.
    const footstepVoices = audio.director.activeVoices.filter((voice) => voice.cue === FOOTSTEP_CUE);
    expect(footstepVoices.length).toBeGreaterThan(0);
    expect(footstepVoices.every((voice) => voice.positional)).toBe(true);

    // Crowd murmur: cue registered, conversation bursts positional.
    expect(audio.director.hasCue(CROWD_MURMUR_CUE)).toBe(true);
    const murmurs = audio.calls.filter((call) => call.cue === CROWD_MURMUR_CUE);
    expect(murmurs.length).toBeGreaterThan(0);
    expect(murmurs.some((call) => call.loop === false && Boolean(call.position))).toBe(true);

    // Looping murmur emitters are registered and ride with the pedestrians.
    for (let index = 0; index < 4; index += 1) {
      const emitter = audio.director.getEmitter(`${CROWD_MURMUR_EMITTER_PREFIX}-${index}`);
      expect(emitter).toBeDefined();
      expect(emitter?.cue).toBe(CROWD_MURMUR_CUE);
      expect(emitter?.isPlaying).toBe(true);
    }

    const anchor = audio.director.getEmitter(`${CROWD_MURMUR_EMITTER_PREFIX}-0`);
    const anchorSnapshot = snapshots[0];
    expect(anchor).toBeDefined();
    // Bound to a head-height anchor parented to the pedestrian's figure.
    expect(anchor!.position.y).toBeCloseTo(MURMUR_EMITTER_HEIGHT, 5);
    expect(distanceBetween(anchor!.position, anchorSnapshot.position)).toBeLessThan(0.3);
    expect(anchor!.gain).toBeGreaterThan(0);
    expect(anchor!.attenuation).toBeGreaterThanOrEqual(0);

    // Detaching removes every emitter again.
    api.crowd.detachAudio();
    expect(audio.director.emitterCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* API lifecycle                                                       */
/* ------------------------------------------------------------------ */

describe('pedestrians API', () => {
  it('registers per-year inspectables for the crowd and every pedestrian', () => {
    const { context, materials } = createHarness();
    const registry: InspectionRegistry = createInspectionRegistry();
    const api = trackApi(createPedestriansApi({ scene: context, materials, registry, count: 6 }));

    expect(api.version).toBe(PEDESTRIANS_API_VERSION);
    expect(registry.size).toBe(7);
    expect(api.inspectableIds).toHaveLength(7);
    expect(registry.has(CROWD_INSPECTABLE_ID)).toBe(true);
    expect(registry.pickTargets()).toContain(api.crowd.group);

    const pedestrianId = `${PEDESTRIAN_INSPECTABLE_PREFIX}-0`;
    expect(registry.has(pedestrianId)).toBe(true);
    const copy1945 = registry.resolve(pedestrianId, '1945');
    const copy2025 = registry.resolve(pedestrianId, '2025');
    expect(copy1945).not.toBeNull();
    expect(copy2025).not.toBeNull();
    expect(copy1945?.name).toContain('1945');
    expect(copy2025?.name).toContain('2025');
    expect(copy1945?.blurb).not.toBe(copy2025?.blurb);
    expect(copy1945?.blurb.toLowerCase()).toContain('hat');
    expect(copy2025?.blurb.toLowerCase()).toContain('tech');
    expect(copy1945?.source).toBe('era');
    expect(copy2025?.hasEraCopy).toBe(true);
  });

  it('publishes the handle for overlays and tears everything down on dispose', () => {
    const { context, materials } = createHarness();
    const registry = createInspectionRegistry();
    const api = trackApi(createPedestriansApi({ scene: context, materials, registry, count: 4 }));

    integratePedestriansGlobal(api);
    expect(getPedestriansApi()).toBe(api);
    expect((window as unknown as Record<string, unknown>).__chronoCityPedestrians).toBe(api);

    const group = api.group;
    expect(group.parent).toBe(context.scene);

    api.dispose();
    openApis.splice(openApis.indexOf(api), 1);

    expect(getPedestriansApi()).toBeNull();
    expect(registry.size).toBe(0);
    expect(group.parent).toBeNull();
    expect(context.scene.getObjectByName(CROWD_GROUP_NAME)).toBeUndefined();
    expect(context.scene.children).not.toContain(group);

    // The tick is unregistered: the frame loop no longer reaches the crowd.
    const ticks = api.crowd.tickCount;
    context.tick(1 / 60);
    expect(api.crowd.tickCount).toBe(ticks);
  });

  it('exposes the aggregate namespace used by integration code', () => {
    expect(PedestriansApi.version).toBe(PEDESTRIANS_API_VERSION);
    expect(PedestriansApi.systemId).toBe(CROWD_SYSTEM_ID);
    expect(PedestriansApi.systemOrder).toBe(CROWD_SYSTEM_ORDER);
    expect(PedestriansApi.groupName).toBe(CROWD_GROUP_NAME);
    expect(PedestriansApi.murmurCue).toBe(CROWD_MURMUR_CUE);
    expect(typeof PedestriansApi.create).toBe('function');
    expect(typeof PedestriansApi.get).toBe('function');
  });

  it('runs without a timeline, materials, registry or audio', () => {
    const { context } = createHarness();
    const api = trackApi(createPedestriansApi({ scene: context, count: 3 }));

    expect(api.timeline).toBeNull();
    expect(api.registry).toBeNull();
    expect(api.blendable).toBeNull();
    expect(api.audio).toBeNull();
    expect(api.crowd.count).toBe(3);
    expect(api.selectEra('1985')).toBe('1985');
    expect(api.outfitEra).toBe('1985');
    expect(api.materials.stats.textures).toBeGreaterThan(0);
  });
});
